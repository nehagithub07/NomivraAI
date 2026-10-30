import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { verifyProof } from "../src/lib/destinations/proof.ts";
import { place } from "./destination-fixtures.mjs";
import { itineraryTripContext } from "../src/lib/itineraries/context.ts";
import { generationResult, itineraryTrip, itineraryVersionId, versionRow } from "./itinerary-fixtures.mjs";

const require = createRequire(import.meta.url), KEY = "test-internal-application-key-never-real";
function load(file, adapters = {}) {
  const cache = new Map();
  function moduleAt(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    function localRequire(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/auth/session") return { getCurrentUser: async () => adapters.user === null ? null : { id: itineraryTrip.owner_id } };
      if (name === "@/lib/supabase/server") return { createClient: async () => adapters.db };
      if (name === "@/lib/destinations/persistence") return { getPersistedPlaces: async () => adapters.places ?? [place] };
      if (name === "@/lib/accommodations/server") return { getStaySelection: async () => null, getCachedHotels: () => null };
      if (name === "@/lib/food/server") return { getFoodSelections: async () => adapters.food ?? [], getCachedFood: () => adapters.cachedFood ?? null };
      if (name.startsWith("@/")) return moduleAt(path.resolve("src", `${name.slice(2)}.ts`));
      if (name.startsWith(".")) return moduleAt(path.resolve(path.dirname(filename), `${name}.ts`));
      return require(name);
    }
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
function database() {
  const state = { trip: structuredClone(itineraryTrip), version: null, writes: [], filters: [], reservationError: null, commitError: null };
  const db = {
    from(table) {
      const filters = {};
      return { select() { return this; }, eq(name, value) { filters[name] = value; state.filters.push([table, name, value]); return this; },
        async maybeSingle() { return { data: table === "trips" ? state.trip : state.version?.status === "ready" && (!filters.id || filters.id === state.version.id) ? state.version : null, error: null }; },
      };
    },
    async rpc(name, args) {
      state.writes.push([name, args]);
      if (name === "begin_itinerary_generation") {
        if (state.reservationError) return { data: null, error: state.reservationError };
        if (state.version?.status === "generating") return { data: null, error: { code: "40001", message: "ITINERARY_IN_PROGRESS" } };
        if (!state.version || state.version.status !== "ready") state.version = { id: itineraryVersionId, status: "generating" };
        return { data: state.version.id, error: null };
      }
      assert.equal(verifyProof(args.p_payload, args.p_signature, KEY), true);
      const proof = JSON.parse(args.p_payload);
      assert.equal(proof.user_id, itineraryTrip.owner_id); assert.equal(proof.trip_id, itineraryTrip.id);
      if (name === "complete_itinerary_generation") {
        assert.equal(proof.document_hash, createHash("sha256").update(args.p_document).digest("hex"));
        assert.deepEqual(proof.trip_context, itineraryTripContext(state.trip));
        if (state.commitError) return { data: null, error: state.commitError };
        state.version = versionRow(JSON.parse(args.p_document), { trip_context: proof.trip_context, demo: proof.demo, provider: proof.provider });
      } else if (state.version.status === "generating") state.version.status = "failed";
      return { data: itineraryVersionId, error: null };
    },
  };
  return { db, state };
}
function request(body = { request_id: randomUUID() }, headers = {}) {
  return new Request(`http://localhost:3000/api/trips/${itineraryTrip.id}/itinerary/generate`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const invoke = (POST, req = request()) => POST(req, { params: Promise.resolve({ tripId: itineraryTrip.id }) });
const route = "src/app/api/trips/[tripId]/itinerary/generate/route.ts";

test("itinerary BFF independently authenticates, verifies ownership/origin and rejects browser context", async t => {
  configure(t); const { db, state } = database();
  t.mock.method(globalThis, "fetch", () => assert.fail("No provider call for rejected requests"));
  assert.equal((await invoke(load(route, { db, user: null }).POST)).status, 401);
  const { POST } = load(route, { db });
  assert.equal((await invoke(POST, request(undefined, { origin: "https://foreign.test" }))).status, 403);
  assert.equal((await invoke(POST, request({ request_id: randomUUID(), attractions: [place] }))).status, 422);
  state.trip.owner_id = randomUUID(); assert.equal((await invoke(POST)).status, 404);
  assert.equal(state.writes.length, 0);
});

test("itinerary BFF uses only owned persisted candidates, signs the full validated document and reuses a ready version", async t => {
  configure(t); const { db, state } = database(); let calls = 0;
  const timeouts = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => { timeouts.push(milliseconds); return new AbortController().signal; });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; assert.equal(new URL(url).pathname, "/api/v1/itineraries/generate");
    assert.equal(options.headers["X-Nomvira-Internal-Key"], KEY); assert.equal(options.cache, "no-store");
    const body = JSON.parse(options.body); assert.equal(body.user_id, itineraryTrip.owner_id);
    assert.equal(body.context.attractions[0].candidate_id, place.provider_place_id);
    assert.ok(!("owner_id" in body.context) && !("authorization" in body.context));
    assert.equal(body.context.food.length, 1); assert.equal(body.context.food[0].name, "Saved Real Cafe");
    assert.equal(body.context.food[0].recommendation_score, 0.95);
    return Response.json(generationResult());
  });
  const { POST } = load(route, { db, food: [{ provider: "geoapify", provider_place_id: "saved-food", name: "Saved Real Cafe", category: "cafe" }, { provider: "fixture", provider_place_id: "demo", name: "Demo", category: "cafe" }], cachedFood: { candidates: [{ provider: "geoapify", provider_place_id: "saved-food", recommendation_score: 0.95 }] } });
  const first = await invoke(POST); assert.equal(first.status, 200);
  assert.equal((await first.json()).itinerary.id, itineraryVersionId);
  assert.ok(state.filters.some(([table, key, value]) => table === "trips" && key === "owner_id" && value === itineraryTrip.owner_id));
  assert.equal(state.writes.filter(([name]) => name === "complete_itinerary_generation").length, 1);
  assert.equal((await invoke(POST)).status, 200); assert.equal(calls, 1);
  assert.deepEqual(timeouts, [90_000]);
});

test("missing attractions stop before generation reservation or any LLM request", async t => {
  configure(t); const { db, state } = database();
  t.mock.method(globalThis, "fetch", () => assert.fail("Missing candidates must not call Gemini"));
  const response = await invoke(load(route, { db, places: [] }).POST);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "ITINERARY_MISSING_PLACES");
  assert.equal(state.writes.length, 0);
});

test("backend failure codes stay safe, never retry immediately and mark the pending attempt failed", async t => {
  configure(t);
  for (const [status, code] of [[429, "ITINERARY_PROVIDER_RATE_LIMITED"], [503, "ITINERARY_PROVIDER_TIMEOUT"], [502, "ITINERARY_VALIDATION_FAILED"]]) {
    const { db, state } = database(); let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: { code, message: "PRIVATE provider details" } }, { status }); });
    const response = await invoke(load(route, { db }).POST);
    assert.equal(response.status, status); const body = await response.json();
    assert.equal(body.error.code, code); assert.ok(!JSON.stringify(body).includes("PRIVATE"));
    assert.equal(calls, 1); assert.equal(state.version.status, "failed");
    assert.equal(state.writes.filter(([name]) => name === "complete_itinerary_generation").length, 0);
  }
});

test("malformed backend results, production fixtures and persistence errors do not replace the saved plan", async t => {
  configure(t);
  for (const scenario of ["malformed", "fixture", "save_error"]) {
    const { db, state } = database();
    if (scenario === "save_error") state.commitError = { code: "28000", message: "PRIVATE signing details" };
    if (scenario === "fixture") process.env.NODE_ENV = "production";
    t.mock.method(globalThis, "fetch", async () => Response.json(scenario === "malformed" ? { fake: "PRIVATE" } : scenario === "fixture" ? { ...generationResult(), provider: "fixture", demo: true } : generationResult()));
    const response = await invoke(load(route, { db }).POST);
    assert.ok(response.status >= 500); assert.ok(!(await response.text()).includes("PRIVATE"));
    assert.equal(state.version.status, "failed");
    process.env.NODE_ENV = "development";
  }
});

test("a concurrent request is stopped by the database reservation before another backend call", async t => {
  configure(t); const { db } = database(); let calls = 0, complete, entered;
  const waiting = new Promise(resolve => { complete = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, "fetch", async () => { calls++; entered(); await waiting; return Response.json(generationResult()); });
  const { POST } = load(route, { db }); const first = invoke(POST); await started;
  const second = await invoke(POST); assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "ITINERARY_IN_PROGRESS");
  complete(); assert.equal((await first).status, 200); assert.equal(calls, 1);
});
