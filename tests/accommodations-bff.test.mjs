import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { signProof, verifyProof } from "../src/lib/destinations/proof.ts";
import { accommodationContext } from "../src/lib/accommodations/context.ts";
import { hotelResults, hotelTrip } from "./hotel-fixtures.mjs";

const require = createRequire(import.meta.url), KEY = "test-internal-application-key-never-real";
const tripId = hotelTrip.id, userId = hotelTrip.owner_id;
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
  for (const [name,value] of Object.entries({ NOMVIRA_INTERNAL_API_KEY: KEY, NOMVIRA_API_URL: "http://backend.test:8000", NODE_ENV: "development" })) {
    const old = process.env[name]; process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
}
function database(initialTrip = hotelTrip) {
  const state = { trip: structuredClone(initialTrip), selection: null, filters: [], writes: [], rpcError: null };
  const db = { from(table) {
    let deleting = false, expected;
    return { select() { return this; }, eq(key,value) { state.filters.push([table,key,value]); if(key === "id") expected = value; return this; }, delete() { deleting = true; return this; },
      async maybeSingle() { return { data: table === "trips" ? state.trip : state.selection, error: table === "trips" ? null : state.selectionReadError || null }; },
      then(resolve) { const removed = deleting && state.selection?.id === expected; if(removed) state.selection = null; return Promise.resolve({ data: removed ? [{ id: expected }] : [], error: null }).then(resolve); },
    };
  }, async rpc(name,args) {
    state.writes.push([name,args]);
    if (state.rpcError) return { data: null, error: state.rpcError };
    const proof = JSON.parse(args.p_payload);
    state.selection = { id: "00000000-0000-4000-8000-000000000020", trip_id: tripId, provider: proof.provider, provider_accommodation_id: proof.provider_accommodation_id,
      selected_name: proof.provider === "fixture" ? proof.selected_name : null, selected_at: new Date().toISOString(), search_context: proof.context };
    return { data: state.selection.id, error: null };
  } };
  return { db, state };
}
const context = () => ({ params: Promise.resolve({ tripId }) });
const hotelRequest = (body = {}, method = "POST", headers = {}) => new Request(`http://localhost:3000/api/trips/${tripId}/hotels`, { method, headers: { ...(method !== "GET" ? { "content-type": "application/json" } : {}), ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
const selectionRequest = (body, method = "POST") => new Request(`http://localhost:3000/api/trips/${tripId}/accommodation-selection`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const proofFor = changes => {
  const payload = JSON.stringify({ kind: "accommodation_selection", user_id: userId, trip_id: tripId, provider: "fixture", provider_accommodation_id: "garden", selected_name: "Demo Garden House", expires_at: Math.floor(Date.now()/1000)+900, context: accommodationContext(hotelTrip), ...changes });
  return { payload, signature: signProof(payload, KEY) };
};

test("hotel BFF independently authenticates; rejects foreign origins and browser trip overrides", async t => {
  configure(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not call backend"); });
  assert.equal((await load("src/app/api/trips/[tripId]/hotels/route.ts", { user: null, onAuth: writable => assert.equal(writable,true) }).POST(hotelRequest(),context())).status,401);
  const { db } = database();
  const { POST } = load("src/app/api/trips/[tripId]/hotels/route.ts", { db });
  assert.equal((await POST(hotelRequest({},"POST",{origin:"https://attacker.test"}),context())).status,403);
  for (const body of [{ owner_id: "other" }, { destination: "Paris" }, { start_date: "2000-01-01" }, { rooms: 1 }, { budget: 1 }]) assert.equal((await POST(hotelRequest(body),context())).status,422);
  assert.equal(calls,0);
});
test("hotel reads never call providers; search derives trip context and caches signed results", async t => {
  configure(t); const { db,state } = database(); let calls=0;
  t.mock.method(globalThis,"fetch",async (url,options) => {
    calls++; assert.equal(url,"http://backend.test:8000/api/v1/accommodations/search");
    const body=JSON.parse(options.body); assert.equal(body.user_id,userId); assert.equal(body.check_in,hotelTrip.start_date); assert.equal(body.check_out,hotelTrip.end_date);
    assert.equal(body.travelers,2); assert.equal(body.rooms,1); assert.equal(body.trip_budget,"2500"); assert.equal(body.destination_key,"open_meteo:1850147");
    assert.equal(options.headers["X-Nomvira-Internal-Key"],KEY); assert.equal("cookie" in options.headers,false); assert.equal("X-API-Key" in options.headers,false);
    return Response.json(hotelResults());
  });
  const { GET,POST }=load("src/app/api/trips/[tripId]/hotels/route.ts",{db});
  assert.deepEqual(await (await GET(hotelRequest({},"GET"),context())).json(),{results:null}); assert.equal(calls,0);
  const response=await POST(hotelRequest(),context()); assert.equal(response.status,200); assert.equal(response.headers.get("cache-control"),"no-store");
  const results=(await response.json()).results,proof=results.candidates[0].selection_proof;
  assert.ok(verifyProof(proof.payload,proof.signature,KEY)); assert.equal(JSON.parse(proof.payload).trip_id,tripId); assert.deepEqual(JSON.parse(proof.payload).context,accommodationContext(hotelTrip));
  assert.ok(state.filters.some(([,key,value])=>key==="owner_id"&&value===userId));
  assert.equal((await (await GET(hotelRequest({},"GET"),context())).json()).results.cached,true);
  assert.equal((await (await POST(hotelRequest(),context())).json()).results.cached,true); assert.equal(calls,1);
  await POST(hotelRequest({refresh:true}),context()); assert.equal(calls,2);
});
test("unowned and same-day trips never trigger hotel searches",async t=>{
  configure(t);t.mock.method(globalThis,"fetch",async()=>{throw new Error("No provider call allowed");});
  for(const [trip,status] of [[null,404],[{...hotelTrip,end_date:hotelTrip.start_date},422],[{...hotelTrip,destination_provider:null},409]]){
    const {db}=database(trip);const {POST}=load("src/app/api/trips/[tripId]/hotels/route.ts",{db});
    assert.equal((await POST(hotelRequest(),context())).status,status);
  }
});
test("provider quota and auth errors retain safe codes; fixture responses are blocked in production",async t=>{
  configure(t);const {db}=database();let code="ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED",status=429;
  t.mock.method(globalThis,"fetch",async()=>status===200?Response.json(hotelResults()):Response.json({error:{code,message:"PRIVATE provider body"}},{status}));
  const {POST}=load("src/app/api/trips/[tripId]/hotels/route.ts",{db});
  let response=await POST(hotelRequest(),context());assert.equal(response.status,429);assert.equal((await response.json()).error.code,code);
  code="ACCOMMODATION_PROVIDER_AUTH_ERROR";status=503;response=await POST(hotelRequest(),context());assert.equal((await response.text()).includes("PRIVATE"),false);
  process.env.NODE_ENV="production";status=200;response=await POST(hotelRequest(),context());assert.equal(response.status,503);
  assert.equal((await POST(hotelRequest({demo:true}),context())).status,503);
});
test("stay selection verifies signed current trip data before a restricted RPC",async t=>{
  configure(t);const {db,state}=database();const {POST}=load("src/app/api/trips/[tripId]/accommodation-selection/route.ts",{db});
  const proof=proofFor({});const response=await POST(selectionRequest({proof,expected_selection_id:null}),context());assert.equal(response.status,200);
  assert.equal(state.writes[0][0],"select_trip_accommodation");assert.equal(state.writes[0][1].p_payload,proof.payload);assert.equal(state.selection.selected_name,"Demo Garden House");
  for(const invalid of [{...proof,payload:proof.payload.replace("garden","tampered")},proofFor({user_id:"00000000-0000-4000-8000-000000000099"}),proofFor({expires_at:1}),proofFor({context:{...accommodationContext(hotelTrip),budget_total:1}})]) assert.equal((await POST(selectionRequest({proof:invalid,expected_selection_id:state.selection.id}),context())).status,409);
  assert.equal(state.writes.length,1);
});
test("selection conflicts and setup failures preserve the existing choice; owned deletion is scoped",async t=>{
  configure(t);const {db,state}=database();const {POST,DELETE}=load("src/app/api/trips/[tripId]/accommodation-selection/route.ts",{db});
  state.selection={id:"00000000-0000-4000-8000-000000000030"};
  for(const [code,expected] of [["40001","selection_conflict"],["PGRST202","setup_required"],["42501","persistence_unavailable"]]){
    state.rpcError={code,message:"PRIVATE database details"};const response=await POST(selectionRequest({proof:proofFor({}),expected_selection_id:state.selection.id}),context());
    const body=await response.json();assert.equal(body.error.code,expected);assert.ok(!JSON.stringify(body).includes("PRIVATE"));assert.equal(state.selection.id,"00000000-0000-4000-8000-000000000030");
  }
  const response=await DELETE(selectionRequest({expected_selection_id:state.selection.id},"DELETE"),context());assert.equal(response.status,200);assert.equal(state.selection,null);
});
test("a failed follow-up read after a committed selection asks to check the saved choice",async t=>{
  configure(t);const {db,state}=database();state.selectionReadError={code:"PGRST000",message:"PRIVATE network details"};
  const {POST}=load("src/app/api/trips/[tripId]/accommodation-selection/route.ts",{db});
  const response=await POST(selectionRequest({proof:proofFor({}),expected_selection_id:null}),context());
  assert.equal((await response.json()).error.code,"selection_unconfirmed");assert.equal(state.writes.length,1);assert.equal(state.selection.provider_accommodation_id,"garden");
});
