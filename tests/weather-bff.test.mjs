import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { verifyProof } from "../src/lib/destinations/proof.ts";
import { place } from "./destination-fixtures.mjs";
import { itineraryTripContext } from "../src/lib/itineraries/context.ts";
import { itineraryTrip, itineraryVersionId, generationResult, versionRow } from "./itinerary-fixtures.mjs";

const require=createRequire(import.meta.url),KEY="test-internal-application-key-never-real",newId="00000000-0000-4000-8000-000000000088";
function load(file,adapters={}) {
  const cache=new Map();
  function moduleAt(filename){
    if(cache.has(filename))return cache.get(filename).exports;
    const loaded={exports:{}};cache.set(filename,loaded);
    const code=ts.transpileModule(readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    function localRequire(name){
      if(name==="server-only")return {};
      if(name==="@/lib/auth/session")return {getCurrentUser:async()=>adapters.user===null?null:{id:itineraryTrip.owner_id}};
      if(name==="@/lib/supabase/server")return {createClient:async()=>adapters.db};
      if(name==="@/lib/destinations/persistence")return {getPersistedPlaces:async()=>[place]};
      if(name==="@/lib/accommodations/server")return {getStaySelection:async()=>null,getCachedHotels:()=>null};
      if(name==="@/lib/food/server")return {getFoodSelections:async()=>[],getCachedFood:()=>null};
      if(name.startsWith("@/"))return moduleAt(path.resolve("src",`${name.slice(2)}.ts`));
      if(name.startsWith("."))return moduleAt(path.resolve(path.dirname(filename),name.endsWith(".ts")?name:`${name}.ts`));
      return require(name);
    }
    new Function("require","module","exports",code)(localRequire,loaded,loaded.exports);return loaded.exports;
  }
  return moduleAt(path.resolve(file));
}
function configure(t){for(const [key,value] of Object.entries({NOMVIRA_INTERNAL_API_KEY:KEY,NOMVIRA_API_URL:"http://backend.test:8000",NODE_ENV:"development"})){const old=process.env[key];process.env[key]=value;t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old);}}
function report(){return {forecast:{provider:"open_meteo",latitude:itineraryTrip.destination_latitude,longitude:itineraryTrip.destination_longitude,timezone:itineraryTrip.destination_timezone,start_date:itineraryTrip.start_date,end_date:itineraryTrip.end_date,fetched_at:null,expires_at:null,cached:false,availability:"not_yet_available",days:[],uncovered_ranges:[{start_date:itineraryTrip.start_date,end_date:itineraryTrip.end_date,reason:"outside_forecast_window"}]},analyzed_version_id:itineraryVersionId,conflicts:[]};}
function adaptation(changed=true){return {...generationResult(),changed,parent_version_id:itineraryVersionId,prompt_version:"weather-v1",weather_fetched_at:new Date().toISOString(),remaining_conflicts:[],explanation:changed?"Adjusted using verified forecasts.":"No meaningful change needed."};}
function database(){
  const parent=versionRow(undefined,{trip_context:itineraryTripContext(itineraryTrip),document_hash:"a".repeat(64),generation_reason:"initial",parent_version_id:null,weather_fetched_at:null});
  const state={trip:structuredClone(itineraryTrip),parent,version:null,writes:[],filters:[],reservationError:null,commitError:null,readError:false};
  const db={from(table){const filters={};return {select(){return this;},eq(key,value){filters[key]=value;state.filters.push([table,key,value]);return this;},
    async maybeSingle(){return {data:table==="trips"?state.trip:state.readError?null:filters.id===newId?(state.version?.status==="ready"?state.version:null):parent,error:state.readError&&table!=="trips"?{code:"PRIVATE"}:null};}};},
    async rpc(name,args){state.writes.push([name,args]);
      if(name==="begin_weather_adaptation"){
        if(state.reservationError)return {data:null,error:state.reservationError};
        state.version??={id:newId,status:"generating"};return {data:newId,error:null};
      }
      assert.ok(verifyProof(args.p_payload,args.p_signature,KEY));const proof=JSON.parse(args.p_payload);
      if(name==="complete_weather_adaptation"){
        assert.equal(proof.parent_document_hash,parent.document_hash);assert.equal(proof.parent_version_id,parent.id);
        assert.equal(proof.generation_reason,"weather_adaptation");assert.equal(proof.document_hash,createHash("sha256").update(args.p_document).digest("hex"));
        if(state.commitError)return {data:null,error:state.commitError};
        state.version=versionRow(JSON.parse(args.p_document),{id:newId,version_number:2,trip_context:itineraryTripContext(state.trip),generation_reason:"weather_adaptation",parent_version_id:parent.id,weather_fetched_at:proof.weather_fetched_at});
      }else if(state.version?.status==="generating")state.version.status="failed";
      return {data:newId,error:null};
    }};
  return {db,state};
}
const routes={GET:"src/app/api/trips/[tripId]/weather/route.ts",refresh:"src/app/api/trips/[tripId]/weather/refresh/route.ts",adapt:"src/app/api/trips/[tripId]/itinerary/adapt-weather/route.ts"};
function request(method="GET",body,headers={}){return new Request("http://localhost:3000/api/trips/test/weather",{method,headers:{...(method==="GET"?{}:{"content-type":"application/json"}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const invoke=(handler,req)=>handler(req,{params:Promise.resolve({tripId:itineraryTrip.id})});
const adaptBody=()=>({request_id:randomUUID(),expected_version_id:itineraryVersionId});

test("weather and adaptation authenticate independently, enforce origin/ownership and reject client facts",async t=>{
  configure(t);const {db,state}=database();t.mock.method(globalThis,"fetch",()=>assert.fail("Rejected requests cannot reach providers"));
  for(const [file,method,body] of [[routes.GET,"GET"],[routes.refresh,"POST",{}],[routes.adapt,"POST",adaptBody()]]){
    assert.equal((await invoke(load(file,{db,user:null})[method],request(method,body))).status,401);
    const owner=state.trip.owner_id;state.trip.owner_id=randomUUID();assert.equal((await invoke(load(file,{db})[method],request(method,body))).status,404);state.trip.owner_id=owner;
  }
  const {POST}=load(routes.adapt,{db});assert.equal((await invoke(POST,request("POST",adaptBody(),{origin:"https://foreign.test"}))).status,403);
  for(const patch of [{forecast:{}},{latitude:0},{candidates:[]},{budget_total:"1"}])assert.equal((await invoke(POST,request("POST",{...adaptBody(),...patch}))).status,422);
  assert.equal(state.writes.length,0);
});
test("weather uses canonical saved coordinates/dates/timezone; tab reads are cache-only, refresh is explicit",async t=>{
  configure(t);const {db,state}=database();const calls=[];
  t.mock.method(globalThis,"fetch",async(url,options)=>{assert.equal(new URL(url).pathname,"/api/v1/weather/forecast");assert.equal(options.headers["X-Nomvira-Internal-Key"],KEY);calls.push(JSON.parse(options.body));return Response.json(report());});
  assert.equal((await invoke(load(routes.GET,{db}).GET,request())).status,200);
  assert.equal(calls[0].forecast.latitude,state.trip.destination_latitude);assert.equal(calls[0].forecast.longitude,state.trip.destination_longitude);assert.equal(calls[0].forecast.timezone,state.trip.destination_timezone);assert.equal(calls[0].forecast.cache_only,true);assert.equal(calls[0].forecast.refresh,false);
  assert.equal(calls[0].items[0].candidate_id,"node/123");assert.ok(!JSON.stringify(calls).includes(KEY));
  assert.equal((await invoke(load(routes.refresh,{db}).POST,request("POST",{}))).status,200);assert.equal(calls[1].forecast.cache_only,false);assert.equal(calls[1].forecast.refresh,true);
});
test("missing itinerary does not block weather browsing and provider failures have no immediate retries",async t=>{
  configure(t);const {db,state}=database();state.readError=true;let calls=0;
  t.mock.method(globalThis,"fetch",async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).version_id,null);return Response.json(report());});
  assert.equal((await invoke(load(routes.GET,{db}).GET,request())).status,200);
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({error:{code:"WEATHER_PROVIDER_RATE_LIMITED",message:"PRIVATE"}},{status:429});});
  const result=await invoke(load(routes.refresh,{db}).POST,request("POST",{}));assert.equal(result.status,429);assert.equal(calls,2);assert.ok(!(await result.text()).includes("PRIVATE"));assert.equal(state.writes.length,0);
});
test("adaptation uses trusted candidate IDs, shared signed persistence and records a new source version",async t=>{
  configure(t);const {db,state}=database();const before=structuredClone(state.parent);
  t.mock.method(globalThis,"fetch",async(url,options)=>{assert.equal(new URL(url).pathname,"/api/v1/itineraries/adapt-weather");const body=JSON.parse(options.body);assert.equal(body.original.days[0].items[0].candidate_id,"node/123");assert.equal(body.context.attractions[0].provider_place_id,undefined);assert.equal(body.context.attractions[0].candidate_id,place.provider_place_id);assert.equal(body.forecast.cache_only,false);assert.equal(body.parent_version_id,itineraryVersionId);return Response.json(adaptation());});
  const response=await invoke(load(routes.adapt,{db}).POST,request("POST",adaptBody()));assert.equal(response.status,200);const result=await response.json();assert.equal(result.itinerary.id,newId);assert.equal(result.itinerary.generation_reason,"weather_adaptation");assert.equal(result.itinerary.parent_version_id,itineraryVersionId);assert.deepEqual(state.parent,before);
  assert.equal(state.writes.filter(([name])=>name==="complete_weather_adaptation").length,1);
  assert.ok(!state.writes.some(([name])=>name.includes("budget")));
});
test("no improvement returns original without publishing a duplicate itinerary version",async t=>{
  configure(t);const {db,state}=database();t.mock.method(globalThis,"fetch",async()=>Response.json(adaptation(false)));
  const response=await invoke(load(routes.adapt,{db}).POST,request("POST",adaptBody()));assert.equal(response.status,200);const result=await response.json();assert.equal(result.changed,false);assert.equal(result.itinerary.id,itineraryVersionId);assert.equal(state.version.status,"failed");assert.ok(!state.writes.some(([name])=>name==="complete_weather_adaptation"));
});
test("unchanged activities keep their saved reasons and notes in the new version",async t=>{
  configure(t);const {db,state}=database();
  t.mock.method(globalThis,"fetch",async()=>{
    const result=adaptation();result.itinerary.days[1].items[0].reason="A different generic explanation.";
    result.itinerary.days[1].items[0].notes="A different note.";return Response.json(result);
  });
  const response=await invoke(load(routes.adapt,{db}).POST,request("POST",adaptBody()));assert.equal(response.status,200);
  const saved=(await response.json()).itinerary;
  assert.equal(saved.itinerary.days[1].items[0].reason,state.parent.itinerary_days[1].itinerary_items[0].reason);
  assert.equal(saved.itinerary.days[1].items[0].notes,state.parent.itinerary_days[1].itinerary_items[0].notes);
});
test("stale parent, malformed Gemini and database conflict keep previous version safe",async t=>{
  configure(t);
  for(const scenario of ["stale","malformed","database"]){const {db,state}=database();if(scenario==="database")state.commitError={code:"22023",message:"WEATHER_CONTEXT_CHANGED"};let calls=0;
    t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(scenario==="malformed"?{PRIVATE:"bad"}:adaptation());});
    const body=adaptBody();if(scenario==="stale")body.expected_version_id=randomUUID();const response=await invoke(load(routes.adapt,{db}).POST,request("POST",body));assert.equal(response.status,scenario==="malformed"?503:409);assert.equal(state.parent.id,itineraryVersionId);assert.ok(!(await response.text()).includes("PRIVATE"));assert.equal(calls,scenario==="stale"?0:1);
  }
});
