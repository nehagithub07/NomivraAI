import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { defaultPreferences, memoryCommandSchema } from "../src/lib/memory/validation.ts";
import { itineraryTrip } from "./itinerary-fixtures.mjs";

const require = createRequire(import.meta.url), owner = itineraryTrip.owner_id;
function load(file, db, signedIn = true) {
  const cache = new Map();
  function at(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    function local(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/auth/session") return { getCurrentUser: async () => signedIn ? { id: owner } : null };
      if (name === "@/lib/supabase/server") return { createClient: async () => db };
      if (name.startsWith("@/")) return at(path.resolve("src", `${name.slice(2)}.ts`));
      if (name.startsWith(".")) return at(path.resolve(path.dirname(filename), name.endsWith(".ts") ? name : `${name}.ts`));
      return require(name);
    }
    new Function("require", "module", "exports", code)(local, loaded, loaded.exports);
    return loaded.exports;
  }
  return at(path.resolve(file));
}
function database() {
  const state = { profiles: [], memories: [], calls: [], unavailable: false, onMatch: null };
  const db = {
    from(table) {
      const filters = [];
      const rows = () => (table === "travel_preferences" ? state.profiles : state.memories).filter(row => filters.every(([key, value]) => row[key] === value));
      const result = () => ({ data: rows(), error: state.unavailable ? { code: "42P01" } : null });
      const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, in() { return query; }, abortSignal() { return query; }, order() { return query; }, limit() { return query; }, async maybeSingle() { return { ...result(), data: rows()[0] ?? null }; }, then(a, b) { return Promise.resolve(result()).then(a, b); } };
      return query;
    },
    rpc(name, args) {
      const operation = (async () => {
      state.calls.push([name, args]);
      if (state.unavailable) return { data: null, error: { code: "42P01" } };
      if (name === "update_travel_preferences") {
        state.profiles = [{ user_id: owner, preferences: args.p_preferences, memory_enabled: args.p_enabled }];
        if (!args.p_enabled) state.memories = [];
      }
      if (name === "save_travel_memory") {
        if (!state.profiles[0]?.memory_enabled) return { data: null, error: { code: "42501" } };
        const row = { id: randomUUID(), user_id: owner, kind: args.p_kind, feedback: args.p_feedback, preferences: args.p_preferences, source_trip_id: null, content: JSON.stringify(args.p_preferences), created_at: new Date().toISOString(), embedding_model: "gemini-embedding-001" };
        state.memories.push(row); return { data: row.id, error: null };
      }
      if (name === "claim_travel_memory_index") return { data: [], error: null };
      if (name === "match_travel_memories") {
        const data = structuredClone(state.memories);
        state.onMatch?.(); return { data, error: null };
      }
      if (name === "delete_travel_memory") {
        state.memories = args.p_id ? state.memories.filter(m => m.id !== args.p_id) : [];
        if (args.p_reset) state.profiles = [];
      }
      return { data: null, error: null };
      })(); operation.abortSignal = () => operation; return operation;
    },
  };
  return { db, state };
}
const request = body => new Request("http://localhost/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function configure(t) {
  for (const [key, value] of Object.entries({ NOMVIRA_INTERNAL_API_KEY: "test-private-internal-key-not-a-real-secret", NOMVIRA_API_URL: "http://backend.test" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
}

test("memory BFF rejects anonymous, cross-origin, oversized and unapproved content", async () => {
  const { db } = database();
  const route = load("src/app/api/memory/route.ts", db);
  const anon = load("src/app/api/memory/route.ts", db, false);
  const valid = { action: "preferences", preferences: defaultPreferences, memoryEnabled: false };
  assert.equal((await anon.POST(request(valid))).status, 401);
  const cross = request(valid); cross.headers.set("Origin", "https://foreign.test");
  assert.equal((await route.POST(cross)).status, 403);
  assert.equal((await route.POST(request({ ...valid, user_id: randomUUID() }))).status, 422);
  assert.equal((await route.POST(request({ ...valid, preferences: { ...defaultPreferences, api_key: "secret" } }))).status, 422);
  assert.equal((await route.POST(request({ action: "remember", content: "private chat" }))).status, 422);
  assert.equal((await route.POST(request({ content: "x".repeat(5000) }))).status, 413);
  assert.equal(memoryCommandSchema.safeParse({ action: "delete", id: "invalid" }).success, false);
});

test("a stalled optional memory read falls back within its total deadline", async t => {
  const { retrieveTravelMemories } = load("src/lib/memory/server.ts", {});
  const stalled = { from() { const query = { select() { return query; }, eq() { return query; }, abortSignal() { return query; }, maybeSingle() { return new Promise(() => {}); } }; return query; } };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = retrieveTravelMemories(stalled, owner, itineraryTrip);
  t.mock.timers.tick(8000);
  assert.deepEqual(await pending, []);
});

test("preferences persist across reads, memories require consent, and reset clears state", async () => {
  const { db } = database(), route = load("src/app/api/memory/route.ts", db);
  const remember = { action: "remember", kind: "feedback", feedback: "avoid", preferences: defaultPreferences };
  assert.equal((await route.POST(request(remember))).status, 403);
  const preferences = { ...defaultPreferences, travelPace: "relaxed", interests: ["nature"] };
  assert.equal((await route.POST(request({ action: "preferences", preferences, memoryEnabled: true }))).status, 200);
  const read = () => route.GET(new Request("http://localhost/api/memory")).then(r => r.json());
  assert.deepEqual((await read()).preferences, preferences);
  const saved = await route.POST(request(remember)).then(r => r.json());
  assert.equal(saved.memories.length, 1);
  await route.POST(request({ action: "delete", id: saved.memories[0].id }));
  assert.equal((await read()).memories.length, 0);
  await route.POST(request(remember));
  await route.POST(request({ action: "reset" }));
  assert.deepEqual((await read()).preferences, defaultPreferences);
  assert.equal((await read()).memoryEnabled, false);
  assert.equal((await read()).memories.length, 0);
});

test("retrieval is consented, bounded, grounded and excludes conversation input", async t => {
  configure(t);
  const { db, state } = database(), service = load("src/lib/memory/server.ts", db);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++;
    const input = JSON.parse(init.body);
    assert.equal(input.user_id, owner); assert.equal(input.purpose, "query");
    assert.doesNotMatch(input.text, /private-chat|secret-api-key|2099/);
    return Response.json({ model: "gemini-embedding-001", embedding: [1, ...Array(767).fill(0)] });
  });
  assert.deepEqual(await service.retrieveTravelMemories(db, owner, itineraryTrip), []);
  assert.equal(calls, 0);
  await service.executeMemoryCommand(db, owner, { action: "preferences", preferences: defaultPreferences, memoryEnabled: true });
  await service.executeMemoryCommand(db, owner, { action: "remember", kind: "feedback", feedback: "avoid", preferences: defaultPreferences });
  const rows = await service.retrieveTravelMemories(db, owner, { ...itineraryTrip, special_requests: "private-chat secret-api-key" });
  assert.equal(rows.length, 1); assert.equal(rows[0].feedback, "avoid");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["feedback", "id", "kind", "preferences"]);
  assert.equal(state.calls.find(([n]) => n === "match_travel_memories")[1].p_limit, 5);
  assert.deepEqual(await service.retrieveTravelMemories(db, randomUUID(), itineraryTrip), []);
  state.onMatch = () => { state.memories = []; };
  assert.deepEqual(await service.retrieveTravelMemories(db, owner, itineraryTrip), []);
  state.onMatch = () => { state.profiles[0].memory_enabled = false; };
  assert.deepEqual(await service.retrieveTravelMemories(db, owner, itineraryTrip), []);
});

test("database and embedding failures preserve empty-context travel behavior", async t => {
  configure(t);
  const { db, state } = database(), service = load("src/lib/memory/server.ts", db);
  state.unavailable = true;
  assert.equal((await service.getMemoryState(db, owner)).available, false);
  assert.deepEqual(await service.retrieveTravelMemories(db, owner, itineraryTrip), []);
  state.unavailable = false;
  await service.executeMemoryCommand(db, owner, { action: "preferences", preferences: defaultPreferences, memoryEnabled: true });
  await service.executeMemoryCommand(db, owner, { action: "remember", kind: "preference", feedback: "prefer", preferences: defaultPreferences });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("provider failed"); });
  assert.deepEqual(await service.retrieveTravelMemories(db, owner, itineraryTrip), []);
});
