import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { signProof, verifyProof } from "../src/lib/destinations/proof.ts";
import { foodContext } from "../src/lib/food/context.ts";
import { foodResults, foodTrip } from "./food-fixtures.mjs";

const require = createRequire(import.meta.url), KEY = "test-internal-application-key-never-real", tripId = foodTrip.id, userId = foodTrip.owner_id;
function load(file, adapters = {}) {
  const cache = new Map();
  function moduleAt(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
      if (name === "server-only") return {};
      if (name === "@/lib/auth/session") return { getCurrentUser: async writable => { adapters.onAuth?.(writable); return adapters.user === null ? null : { id: adapters.user || userId }; } };
      if (name === "@/lib/supabase/server") return { createClient: async () => adapters.db };
      if (name.startsWith("@/")) return moduleAt(path.resolve("src", `${name.slice(2)}.ts`));
      if (name.startsWith(".")) return moduleAt(path.resolve(path.dirname(filename), name.endsWith(".ts") ? name : `${name}.ts`));
      return require(name);
    };
    new Function("require", "module", "exports", source)(localRequire, loaded, loaded.exports);
    return loaded.exports;
  }
  return moduleAt(path.resolve(file));
}
function configure(t) {
  for (const [name, value] of Object.entries({ NOMVIRA_INTERNAL_API_KEY: KEY, NOMVIRA_API_URL: "http://backend.test:8000", NODE_ENV: "development" })) {
    const old = process.env[name]; process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
}
function database(trip = foodTrip) {
  const state = { trip: structuredClone(trip), selections: [], filters: [], writes: [], rpcError: null, readError: null };
  const db = { from(table) {
    let deleting = false, expected;
    return { select() { return this; }, order() { return this; }, eq(key, value) { state.filters.push([table, key, value]); if (key === "id") expected = value; return this; }, delete() { deleting = true; return this; },
      async maybeSingle() { return { data: state.trip, error: null }; },
      then(resolve) { if (deleting) state.selections = state.selections.filter(row => row.id !== expected); return Promise.resolve({ data: state.selections, error: state.readError }).then(resolve); },
    };
  }, async rpc(name, args) {
    state.writes.push([name, args]); if (state.rpcError) return { data: null, error: state.rpcError };
    const proof = JSON.parse(args.p_payload);
    if (!state.selections.some(row => row.provider_place_id === proof.provider_place_id)) state.selections.push({ id: `00000000-0000-4000-8000-${String(state.selections.length + 1).padStart(12,"0")}`, trip_id: tripId, provider: proof.provider, provider_place_id: proof.provider_place_id, name: proof.name, category: proof.category, saved_at: new Date().toISOString() });
    return { data: state.selections.at(-1).id, error: null };
  } };
  return { db, state };
}
const context = () => ({ params: Promise.resolve({ tripId }) });
const request = (body = {}, method = "POST", headers = {}) => new Request(`http://localhost:3000/api/trips/${tripId}/food`, { method, headers: { ...(method !== "GET" ? { "content-type": "application/json" } : {}), ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
const proofFor = changes => { const payload = JSON.stringify({ kind: "food_selection", user_id: userId, trip_id: tripId, provider: "geoapify", provider_place_id: "place-one", name: "Provider Restaurant", category: "restaurant", expires_at: Math.floor(Date.now()/1000)+900, context: foodContext(foodTrip), ...changes }); return { payload, signature: signProof(payload, KEY) }; };
const searchFile = "src/app/api/trips/[tripId]/food/route.ts", selectionFile = "src/app/api/trips/[tripId]/food-selections/route.ts";

test("food BFF authenticates independently and rejects cross-origin and trusted-field overrides", async t => {
  configure(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("No upstream allowed"); });
  assert.equal((await load(searchFile, { user: null, onAuth: value => assert.equal(value, true) }).POST(request(), context())).status, 401);
  const { db } = database(), { POST } = load(searchFile, { db });
  assert.equal((await POST(request({}, "POST", { origin: "https://attacker.test" }), context())).status, 403);
  for (const body of [{ owner_id: userId }, { latitude: 1 }, { longitude: 2 }, { budget_total: 1 }, { limit: 500 }]) assert.equal((await POST(request(body), context())).status, 422);
  for (const trip of [null, { ...foodTrip, owner_id: "other" }, { ...foodTrip, destination_provider: null }]) assert.ok((await load(searchFile, { db: database(trip).db }).POST(request(), context())).status >= 400);
  assert.equal(calls, 0);
});
test("food search uses canonical trip coordinates/diets, signs results and caches default options", async t => {
  configure(t); const { db, state } = database(); let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; assert.equal(url, "http://backend.test:8000/api/v1/food/search");
    const body = JSON.parse(options.body); assert.equal(body.latitude, foodTrip.destination_latitude); assert.equal(body.longitude, foodTrip.destination_longitude); assert.deepEqual(body.dietary_preferences, ["vegetarian"]); assert.equal(body.limit, 20);
    assert.equal(options.headers["X-Nomvira-Internal-Key"], KEY); assert.equal("apiKey" in options.headers, false);
    return Response.json(foodResults());
  });
  const { GET, POST } = load(searchFile, { db });
  assert.deepEqual(await (await GET(request({}, "GET"), context())).json(), { results: null }); assert.equal(calls, 0);
  const response = await POST(request(), context()); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const result = (await response.json()).results, proof = result.candidates[0].selection_proof;
  assert.ok(verifyProof(proof.payload, proof.signature, KEY)); assert.deepEqual(JSON.parse(proof.payload).context, foodContext(foodTrip));
  assert.ok(state.filters.some(([, key, value]) => key === "owner_id" && value === userId));
  assert.equal((await (await GET(request({}, "GET"), context())).json()).results.cached, true);
  assert.equal((await (await POST(request({ radius_meters: 5000, dietary_preferences: ["vegetarian"], cuisine_preferences: [], strict_dietary: false }), context())).json()).results.cached, true);
  assert.equal(calls, 1);
});
test("food BFF hides provider errors, rejects ratings and disables production fixtures", async t => {
  configure(t); const { db } = database(); let status = 429, result = null;
  t.mock.method(globalThis, "fetch", async () => result ? Response.json(result) : Response.json({ error: { code: "FOOD_PROVIDER_RATE_LIMITED", message: "PRIVATE API KEY" } }, { status }));
  const { POST } = load(searchFile, { db });
  let response = await POST(request(), context()); assert.equal(response.status, 429); assert.ok(!(await response.text()).includes("PRIVATE"));
  status = 200; result = foodResults(); result.candidates[0].rating = 4.7;
  assert.equal((await POST(request(), context())).status, 503);
  result = foodResults({ provider: "fixture", demo: true }); result.candidates[0].provider = "fixture";
  process.env.NODE_ENV = "production";
  assert.equal((await POST(request(), context())).status, 503);
  assert.equal((await POST(request({ demo: true }), context())).status, 503);
});
test("food saving supports multiple associations, duplicates and scoped removal", async t => {
  configure(t); const { db, state } = database(), { POST, DELETE } = load(selectionFile, { db });
  for (const id of ["one", "two", "one"]) assert.equal((await POST(request({ proof: proofFor({ provider_place_id: id }) }), context())).status, 200);
  assert.equal(state.selections.length, 2); assert.equal(state.writes[0][0], "save_trip_food");
  const id = state.selections[0].id;
  assert.equal((await DELETE(request({ selection_id: id }, "DELETE"), context())).status, 200);
  assert.equal(state.selections.length, 1);
  assert.ok(state.filters.some(([table, key, value]) => table === "trip_food_selections" && key === "trip_id" && value === tripId));
});
test("food saving rejects forged, expired, foreign-purpose, changed-context and production demo proofs", async t => {
  configure(t); const { db, state } = database(), { POST } = load(selectionFile, { db });
  const good = proofFor({}), bad = { ...good, payload: good.payload.replace("place-one", "tampered") };
  for (const proof of [bad, proofFor({ user_id: "other" }), proofFor({ kind: "accommodation_selection" }), proofFor({ expires_at: 1 }), proofFor({ context: { ...foodContext(foodTrip), destination_latitude: 0 } })]) assert.equal((await POST(request({ proof }), context())).status, 409);
  process.env.NODE_ENV = "production";
  assert.equal((await POST(request({ proof: proofFor({ provider: "fixture" }) }), context())).status, 409);
  assert.equal(state.writes.length, 0);
});
test("food persistence errors are safe and a committed but unread save reports uncertainty", async t => {
  configure(t); const { db, state } = database(), { POST } = load(selectionFile, { db });
  state.rpcError = { code: "PGRST202", message: "PRIVATE SQL" };
  let response = await POST(request({ proof: proofFor({}) }), context()); assert.equal((await response.json()).error.code, "setup_required");
  assert.equal(state.selections.length, 0);
  state.rpcError = null; state.readError = { code: "PGRST000", message: "PRIVATE SQL" };
  response = await POST(request({ proof: proofFor({}) }), context()); assert.equal((await response.json()).error.code, "selection_unconfirmed"); assert.equal(state.selections.length, 1);
});
