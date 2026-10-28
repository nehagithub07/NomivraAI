import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { signProof, verifyProof } from "../src/lib/destinations/proof.ts";
import { defaultTripValues } from "../src/lib/trips/validation.ts";
import { destination, place } from "./destination-fixtures.mjs";

const require = createRequire(import.meta.url);
const userId = "00000000-0000-4000-8000-000000000001", tripId = "00000000-0000-4000-8000-000000000002";
const key = "test-internal-application-key-never-real";
function load(file, adapters = {}) {
  const cache = new Map();
  function moduleAt(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
      if (name === "server-only") return {};
      if (name === "next/cache") return { revalidatePath: () => {} };
      if (name === "@/lib/auth/session") return { getCurrentUser: async (writable) => { adapters.onAuth?.(writable); return adapters.user === null ? null : { id: userId }; } };
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
function env(t, name, value) {
  const previous = process.env[name]; process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
}
function configure(t) { env(t, "NOMVIRA_INTERNAL_API_KEY", key); env(t, "NOMVIRA_API_URL", "http://backend.test:8000"); }
const search = (query = "q=Tokyo", headers = {}) => new Request(`http://localhost:3000/api/destinations/search?${query}`, { headers });
const post = (body = {}) => new Request(`http://localhost:3000/api/trips/${tripId}/discover-places`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("search and discovery independently require verified Supabase identity", async () => {
  const searchHandler = load("src/app/api/destinations/search/route.ts", { user: null, onAuth: (writable) => assert.equal(writable, true) });
  assert.equal((await searchHandler.GET(search())).status, 401);
  const discovery = load("src/app/api/trips/[tripId]/discover-places/route.ts", { user: null });
  assert.equal((await discovery.POST(post(), { params: Promise.resolve({ tripId }) })).status, 401);
});
test("GET BFF rejects short/oversized, duplicate, foreign-origin and arbitrary parameters", async () => {
  const { GET } = load("src/app/api/destinations/search/route.ts");
  for (const query of ["q=To", "q=" + "x".repeat(2200), "q=Tokyo&q=Paris", "q=Tokyo&url=https://evil.test"]) assert.equal((await GET(search(query))).status, 422);
  assert.equal((await GET(search("q=Tokyo", { origin: "https://foreign.test" }))).status, 403);
});
test("search sanitizes forwarding and signs canonical results without a second provider call", async t => {
  configure(t); let count = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    count++; const parsed = new URL(url);
    assert.equal(parsed.origin, "http://backend.test:8000"); assert.equal(parsed.pathname, "/api/v1/destinations/search");
    assert.equal(parsed.searchParams.get("q"), "Tokyo"); assert.equal(options.method, "GET");
    assert.equal(options.headers["X-Nomvira-Internal-Key"], key); assert.equal("cookie" in options.headers, false);
    assert.equal(options.cache, "no-store"); return Response.json({ destinations: [{ ...destination, private: "never expose" }] });
  });
  const response = await load("src/app/api/destinations/search/route.ts").GET(search("q=%20Tokyo%20&limit=8", { cookie: "private-cookie" }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const data = (await response.json()).destinations[0];
  assert.equal(verifyProof(data.proof.payload, data.proof.signature, key), true);
  assert.deepEqual(JSON.parse(data.proof.payload).destination, destination);
  assert.equal(JSON.parse(data.proof.payload).user_id, userId); assert.equal("private" in data, false); assert.equal(count, 1);
});
test("provider errors are safe and missing internal configuration fails closed", async t => {
  configure(t); t.mock.method(globalThis, "fetch", async () => new Response("PRIVATE PROVIDER ERROR", { status: 403 }));
  const { GET } = load("src/app/api/destinations/search/route.ts");
  const failure = await GET(search()); assert.equal(failure.status, 503); assert.equal((await failure.text()).includes("PRIVATE"), false);
  env(t, "NOMVIRA_INTERNAL_API_KEY", ""); assert.equal((await GET(search())).status, 503);
});
test("discovery uses owned trip coordinates, persists signed results and reuses saved places", async t => {
  configure(t); let calls = 0, writes = 0, table, persisted = [];
  let trip = { destination_provider: "open_meteo", destination_provider_id: "1850147", destination_latitude: destination.latitude, destination_longitude: destination.longitude };
  const filters = [];
  const db = { from(name) { table = name; return this; }, select() { return this; }, eq(...args) { filters.push(args); return this; }, order() { return this; }, async limit() { assert.equal(table, "trip_place_candidates"); return { data: persisted, error: null }; }, async maybeSingle() { return { data: trip, error: null }; }, async rpc(name, args) {
    writes++; assert.equal(name, "persist_trip_place_candidates"); assert.equal(verifyProof(args.p_payload, args.p_signature, key), true);
    const proof = JSON.parse(args.p_payload); assert.equal(proof.user_id, userId); assert.equal(proof.trip_id, tripId); assert.equal(proof.kind, "discovery"); assert.deepEqual(proof.places, [place]);
    return { data: 1, error: null };
  } };
  t.mock.method(globalThis, "fetch", async (_url, options) => { calls++; assert.deepEqual(JSON.parse(options.body), { latitude: destination.latitude, longitude: destination.longitude }); return Response.json({ latitude: destination.latitude, longitude: destination.longitude, radius_meters: 10000, places: [place] }); });
  const { POST } = load("src/app/api/trips/[tripId]/discover-places/route.ts", { db });
  const invoke = (body = {}) => POST(post(body), { params: Promise.resolve({ tripId }) });
  assert.deepEqual(await (await invoke()).json(), { places: [place] });
  assert.ok(filters.some(([name, value]) => name === "owner_id" && value === userId));
  persisted = [{ distance_km: 1.5, places: { ...place, metadata: place.tags } }];
  assert.deepEqual(await (await invoke()).json(), { places: [place] }); assert.equal(calls, 1);
  assert.equal((await invoke({ latitude: 50, longitude: 10 })).status, 422);
  trip = null; assert.equal((await invoke()).status, 404);
  trip = { destination_provider: null }; assert.equal((await invoke()).status, 409);
  assert.equal(writes, 1);
});
test("create trip verifies user-bound proof and ignores browser coordinate tampering", async t => {
  configure(t); let calls = 0;
  const now = Math.floor(Date.now() / 1000), payload = JSON.stringify({ kind: "destination", user_id: userId, expires_at: now + 3600, resolved_at: now, destination });
  const values = { ...defaultTripValues, destination: "Tokyo, Japan", startDate: "2099-04-12", endDate: "2099-04-18", budget: "2500", interests: ["food"], resolvedDestination: { ...destination, latitude: 42 }, destinationProof: { payload, signature: signProof(payload, key) } };
  const db = { async rpc(name, args) { calls++; assert.equal(name, "create_resolved_trip"); assert.equal(args.p_payload, payload); assert.equal(args.p_form.p_destination_name, "Tokyo"); assert.equal("p_destination_latitude" in args.p_form, false); return { data: tripId, error: null }; } };
  const { createTrip } = load("src/lib/trips/actions.ts", { db });
  assert.deepEqual(await createTrip(values, { timeZone: "UTC" }), { status: "success", tripId });
  const invalid = await createTrip({ ...values, destinationProof: { ...values.destinationProof, payload: payload.replace("35.6895", "42") } }, { timeZone: "UTC" });
  assert.equal(invalid.status, "error"); assert.ok(invalid.fieldErrors.destination);
  const expired = await load("src/lib/trips/actions.ts", { user: null }).createTrip(values, { timeZone: "UTC" });
  assert.equal(expired.sessionExpired, true); assert.equal(calls, 1);
});
