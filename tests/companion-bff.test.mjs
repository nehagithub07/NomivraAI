import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { verifyProof } from "../src/lib/destinations/proof.ts";
import { itineraryTripContext } from "../src/lib/itineraries/context.ts";
import { itineraryTrip, versionRow } from "./itinerary-fixtures.mjs";
import { place } from "./destination-fixtures.mjs";

const require=createRequire(import.meta.url),KEY="test-internal-application-key-never-real",conversationId=randomUUID();
const routes={messages:"src/app/api/trips/[tripId]/companion/messages/route.ts",confirm:"src/app/api/trips/[tripId]/companion/actions/[actionId]/confirm/route.ts",cancel:"src/app/api/trips/[tripId]/companion/actions/[actionId]/cancel/route.ts"};
const budget={total_budget:"2500.00",remaining_budget:"1275.00",actual_remaining_budget:"1400.00",currency:"USD",budget_status:"healthy",planned_costs:"125.00",actual_costs:"1100.00",committed_costs:"1225.00",warnings:[]};
function configure(t){for(const [key,value] of Object.entries({NOMVIRA_INTERNAL_API_KEY:KEY,NOMVIRA_API_URL:"http://backend.test:8000",NODE_ENV:"development"})){const old=process.env[key];process.env[key]=value;t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old);}}
function database(){
  const state={trip:structuredClone(itineraryTrip),messages:[],actions:[],writes:[],expenses:[],filters:[],persistError:false};
  const parent=versionRow(undefined,{trip_context:itineraryTripContext(itineraryTrip),document_hash:"a".repeat(64)});
  const db={from(table){const filters={};const query={select(){return this;},eq(k,v){filters[k]=v;state.filters.push([table,k,v]);return this;},order(){return this;},limit(){return this;},
    async maybeSingle(){return {data:table==="trips"?state.trip:table==="itinerary_versions"?parent:table==="companion_conversations"?{id:conversationId}:null,error:null};},
    then(resolve,reject){const rows=table==="companion_messages"?[...state.messages].reverse():table==="companion_pending_actions"?state.actions:[];return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return query;},
    async rpc(name,args){state.writes.push([name,args]);if(name==="begin_companion_message"){
      const existing=state.messages.find(m=>m.id===args.p_request_id);if(existing)return {data:{conversation_id:conversationId,duplicate:true,response:state.messages.find(m=>m.reply_to===existing.id)?.metadata.response},error:null};
      state.messages.push({id:args.p_request_id,role:"user",content:args.p_content,created_at:new Date().toISOString(),metadata:{}});return {data:{conversation_id:conversationId,duplicate:false},error:null};
    }
    assert.ok(verifyProof(args.p_payload,args.p_signature,KEY));const proof=JSON.parse(args.p_payload);
    assert.equal(proof.user_id,itineraryTrip.owner_id);assert.equal(proof.trip_id,itineraryTrip.id);
    if(name==="finish_companion_message"){
      if(state.persistError)return {data:null,error:{code:"PRIVATE"}};
      const doc=JSON.parse(args.p_document);state.messages.push({id:randomUUID(),reply_to:proof.request_id,role:"assistant",content:doc.message,created_at:new Date().toISOString(),metadata:{response:doc}});
    } else if(name==="prepare_companion_action"){
      const doc=JSON.parse(args.p_document);state.actions.push({id:proof.action_id,...doc,status:"pending",result:null,expires_at:new Date(Date.now()+300000).toISOString()});
    } else if(name==="claim_companion_action"){
      const a=state.actions.find(a=>a.id===proof.action_id);if(!a)return {data:null,error:{code:"42501"}};
      const claimed=a.status==="pending"&&proof.operation==="confirm";if(a.status==="pending")a.status=Date.parse(a.expires_at)<=Date.now()?"expired":proof.operation==="cancel"?"cancelled":"confirmed";
      return {data:{claimed:claimed&&a.status==="confirmed",action:structuredClone(a)},error:null};
    } else if(name==="finish_companion_action"){
      const a=state.actions.find(a=>a.id===proof.action_id);a.status=proof.status;a.result=proof.result;
    }
    return {data:randomUUID(),error:null};
  }};return {state,db};
}
function load(file,{db,state,user=true,weather,hotel=null,food=null,budgetHangs=false,stay=null}={}){
  const cache=new Map();let budgetReads=0;
  function moduleAt(filename){
    if(cache.has(filename))return cache.get(filename).exports;const loaded={exports:{}};cache.set(filename,loaded);
    const code=ts.transpileModule(readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    function localRequire(name){
      if(name==="server-only")return {};
      if(name==="@/lib/auth/session")return {getCurrentUser:async()=>user?{id:itineraryTrip.owner_id}:null};
      if(name==="@/lib/supabase/server")return {createClient:async()=>db};
      if(name==="@/lib/destinations/persistence")return {getPersistedPlaces:async()=>[place]};
      if(name==="@/lib/accommodations/server")return {getStaySelection:async()=>stay,getCachedHotels:()=>hotel,searchTripHotels:async()=>hotel};
      if(name==="@/lib/food/server")return {getFoodSelections:async()=>[{provider:"geoapify",provider_place_id:"saved-food",name:"Saved Cafe",category:"cafe"}],getCachedFood:()=>food,searchTripFood:async()=>food};
      if(name==="@/lib/budget/server")return {getBudgetSummary:async()=>budgetHangs&&++budgetReads>1?new Promise(()=>{}):budget,createBudgetEntry:async(_tripDb,_trip,args)=>{state.expenses.push(args);return {entry:args};}};
      if(name==="@/lib/weather/server")return {getTripWeather:async()=>weather??{forecast:{availability:"unavailable",fetched_at:null,expires_at:null,timezone:"Asia/Tokyo",days:[],uncovered_ranges:[]},conflicts:[]}};
      if(name.startsWith("@/"))return moduleAt(path.resolve("src",`${name.slice(2)}.ts`));
      if(name.startsWith("."))return moduleAt(path.resolve(path.dirname(filename),name.endsWith(".ts")?name:`${name}.ts`));
      return require(name);
    }
    new Function("require","module","exports",code)(localRequire,loaded,loaded.exports);return loaded.exports;
  }return moduleAt(path.resolve(file));
}
const req=(method="GET",body,headers={})=>new Request("http://localhost:3000/api/trips/trip/companion/messages",{method,headers:{...(method==="GET"?{}:{"content-type":"application/json"}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const invoke=(handler,request,actionId=randomUUID())=>handler(request,{params:Promise.resolve({tripId:itineraryTrip.id,actionId})});
const answer=(patch={})=>({message:"Here are your saved facts.",cards:[],suggested_actions:[],pending_call:null,tool_audit:[],prompt_version:"v1",model_name:"gemini-3.8-flash",demo:false,...patch});
const step=(patch={})=>({continuation_id:null,calls:[],response:null,...patch});

test("all companion BFF routes authenticate, verify trip owner/origin and reject forged browser context/arguments",async t=>{
  configure(t);const fixture=database();t.mock.method(globalThis,"fetch",()=>assert.fail("Rejected request reached backend"));
  for(const [file,method,body] of [[routes.messages,"GET"],[routes.messages,"POST",{request_id:randomUUID(),message:"hello"}],[routes.confirm,"POST",{}],[routes.cancel,"POST",{}]]){
    assert.equal((await invoke(load(file,{...fixture,user:false})[method],req(method,body))).status,401);
    const owner=fixture.state.trip.owner_id;fixture.state.trip.owner_id=randomUUID();assert.equal((await invoke(load(file,fixture)[method],req(method,body))).status,404);fixture.state.trip.owner_id=owner;
    assert.equal((await invoke(load(file,fixture)[method],req(method,body,{origin:"https://foreign.test"}))).status,403);
  }
  for(const patch of [{context:{}},{user_id:randomUUID()},{trip_id:randomUUID()},{tools:[]}])assert.equal((await invoke(load(routes.messages,fixture).POST,req("POST",{request_id:randomUUID(),message:"hello",...patch}))).status,422);
  assert.equal((await invoke(load(routes.confirm,fixture).POST,req("POST",{arguments:{amount:"999"}}))).status,422);
  assert.equal(fixture.state.writes.length,0);
});

test("owned chat builds trusted compact context, executes budget tool, sanitizes/persists cards and idempotently replays",async t=>{
  configure(t);const fixture=database();let calls=0;const body={request_id:randomUUID(),message:"How much budget is left?"};
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    calls++;assert.equal(new URL(url).pathname,"/api/v1/companion/chat");assert.equal(options.headers["X-Nomvira-Internal-Key"],KEY);const input=JSON.parse(options.body);assert.ok(!JSON.stringify(input).includes(KEY));
    if(calls===1){assert.equal(input.context.destination,itineraryTrip.destination_name);assert.equal(input.context.budget_summary.remaining_budget,"1275.00");assert.equal(input.context.saved_food_count,1);assert.equal(input.context.discovered_place_count,1);assert.equal(input.context.special_requests,undefined);return Response.json(step({continuation_id:"a".repeat(40),calls:[{id:"budget-call",name:"get_budget_summary",arguments:{},permission:"READ"}]}));}
    assert.equal(input.results[0].data.remaining_budget,"1275.00");assert.equal(input.results[0].data.trip_id,undefined);assert.equal(input.results[0].data.entries,undefined);
    return Response.json(step({response:answer({cards:[{tool_name:"get_budget_summary",data:input.results[0].data}]})}));
  });
  const route=load(routes.messages,fixture);const response=await invoke(route.POST,req("POST",body));assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");const result=await response.json();assert.equal(result.messages.length,2);assert.equal(result.messages[1].cards[0].data.remaining_budget,"1275.00");
  assert.equal((await invoke(route.POST,req("POST",body))).status,200);assert.equal(calls,2);assert.equal(fixture.state.expenses.length,0);
});

test("read tools use existing itinerary, weather, selected hotel, food and places without writes or raw provider payloads",async t=>{
  configure(t);const fixture=database();const {readCompanionTool}=load("src/lib/companion/tools.ts",fixture);
  for(const [name,args] of [["get_trip_overview",{}],["get_trip_preferences",{}],["get_budget_summary",{}],["get_itinerary",{date:"2099-04-12"}],["get_weather",{}],["get_selected_hotel",{}],["get_saved_food",{}],["get_discovered_places",{}],["find_trip_places",{query:"museum"}],["find_food_options",{}],["find_hotel_options",{}]]){
    const result=await readCompanionTool(fixture.db,fixture.state.trip,{id:"c",name,arguments:args,permission:"READ"});assert.ok(result);for(const key of ["selection_proof","signature","trip_id","owner_id","raw","payload"])assert.ok(!JSON.stringify(result).includes(`"${key}"`));
    if(name==="get_itinerary")assert.equal(result.days[0].items[0].candidate_id,"node/123");
    if(name==="get_saved_food")assert.equal(result.options[0].name,"Saved Cafe");
    if(name==="get_selected_hotel")assert.equal(result.selected,false);
  }
  await assert.rejects(readCompanionTool(fixture.db,fixture.state.trip,{id:"c",name:"execute_sql",arguments:{},permission:"READ"}));
  await assert.rejects(readCompanionTool(fixture.db,fixture.state.trip,{id:"c",name:"get_itinerary",arguments:{date:"2000-01-01"},permission:"READ"}));assert.equal(fixture.state.writes.length,0);
});

test("write proposals do not execute until structured confirmation; duplicate confirmation executes once; cancel/expiry never execute",async t=>{
  configure(t);const fixture=database();let chatCalls=0;const args={description:"Dinner",category:"food",entry_type:"actual",amount:"35.00",currency:"USD",expense_date:null};
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    const input=JSON.parse(options.body);
    if(new URL(url).pathname.endsWith("/actions/validate"))return Response.json({arguments:input.arguments});
    chatCalls++;return Response.json(chatCalls%2===1?step({continuation_id:"a".repeat(40),calls:[{id:"write",name:"add_budget_entry",arguments:args,permission:"WRITE_CONFIRMATION_REQUIRED"}]}):step({response:answer({message:"Review the proposal."})}));
  });
  const route=load(routes.messages,fixture);assert.equal((await invoke(route.POST,req("POST",{request_id:randomUUID(),message:"Add USD 35 dinner expense"}))).status,200);assert.equal(fixture.state.expenses.length,0);assert.equal(fixture.state.actions[0].status,"pending");
  const id=fixture.state.actions[0].id,confirm=load(routes.confirm,fixture).POST;
  assert.equal((await invoke(confirm,req("POST",{}),id)).status,200);assert.equal(fixture.state.expenses.length,1);assert.equal(fixture.state.expenses[0].amount,"35.00");
  assert.equal((await invoke(confirm,req("POST",{}),id)).status,200);assert.equal(fixture.state.expenses.length,1);
  for(const status of ["cancelled","expired"]){const a={...structuredClone(fixture.state.actions[0]),id:randomUUID(),status:status==="cancelled"?"pending":"expired"};fixture.state.actions.push(a);
    if(status==="cancelled")assert.equal((await invoke(load(routes.cancel,fixture).POST,req("POST",{}),a.id)).status,200);
    await invoke(confirm,req("POST",{}),a.id);assert.equal(fixture.state.expenses.length,1);
  }
});

test("foreign hotel/food candidates cannot become proposals; provider errors and persistence failures remain safe",async t=>{
  configure(t);const fixture=database();const {prepareCompanionAction}=load("src/lib/companion/actions.ts",fixture);
  t.mock.method(globalThis,"fetch",async(_url,options)=>Response.json({arguments:JSON.parse(options.body).arguments}));
  for(const [name,args] of [["select_hotel",{provider_accommodation_id:"99999"}],["save_food_selection",{provider_place_id:"foreign-place"}]])await assert.rejects(prepareCompanionAction(fixture.db,fixture.state.trip,{id:"c",name,arguments:args,permission:"WRITE_CONFIRMATION_REQUIRED"},"Select this place"));
  assert.equal(fixture.state.actions.length,0);
  t.mock.method(globalThis,"fetch",async()=>Response.json({error:{code:"COMPANION_PROVIDER_RATE_LIMITED",message:"PRIVATE_SECRET"}},{status:429}));
  const result=await invoke(load(routes.messages,fixture).POST,req("POST",{request_id:randomUUID(),message:"hello"}));assert.equal(result.status,429);assert.ok(!(await result.text()).includes("PRIVATE_SECRET"));assert.equal(fixture.state.messages.length,2);
  fixture.state.persistError=true;t.mock.method(globalThis,"fetch",async()=>Response.json(step({response:answer()})));
  const failed=await invoke(load(routes.messages,fixture).POST,req("POST",{request_id:randomUUID(),message:"hello again"}));assert.equal(failed.status,503);
});

test("tool timeouts return unavailable to Gemini; only twelve recent visible messages are sent",async t=>{
  configure(t);const fixture=database();
  fixture.state.messages=Array.from({length:30},(_,i)=>({id:randomUUID(),role:i%2?"assistant":"user",content:`Prior ${i}`,created_at:new Date().toISOString(),metadata:{}}));
  const original=globalThis.setTimeout;t.mock.method(globalThis,"setTimeout",(fn,ms,...args)=>original(fn,Math.min(ms,5),...args));let calls=0;
  t.mock.method(globalThis,"fetch",async(_url,options)=>{
    const input=JSON.parse(options.body);calls++;
    if(calls===1){assert.equal(input.history.length,12);assert.equal(input.history[0].content,"Prior 18");return Response.json(step({continuation_id:"a".repeat(40),calls:[{id:"c",name:"get_budget_summary",arguments:{},permission:"READ"}]}));}
    assert.equal(input.results[0].status,"unavailable");return Response.json(step({response:answer({message:"Budget is temporarily unavailable."})}));
  });
  const result=await invoke(load(routes.messages,{...fixture,budgetHangs:true}).POST,req("POST",{request_id:randomUUID(),message:"Budget?"}));assert.equal(result.status,200);assert.equal(calls,2);assert.equal(fixture.state.expenses.length,0);
});

test("selected stay and dietary/near-hotel retrieval use real current metadata, with no raw provider data",async t=>{
  configure(t);const fixture=database();
  const hotel={expires_at:new Date(Date.now()+300000).toISOString(),candidates:[{provider:"stayapi",provider_accommodation_id:"123",name:"Real Stay",latitude:35.69,longitude:139.69,total_price:"720.00",currency:"USD",comparable_price:true,guest_rating:8.6,guest_rating_scale:10,raw:{api_key:KEY},selection_proof:{payload:"PRIVATE",signature:"PRIVATE"}}]};
  const food={candidates:[{provider:"geoapify",provider_place_id:"a",name:"Real Vegan Cafe",category:"cafe",dietary_tags:["vegan.only"],dietary_conflicts:[],cuisine_types:["Japanese"],distance_km:1,latitude:35.6901,longitude:139.69,raw:{api_key:KEY}},{provider:"geoapify",provider_place_id:"b",name:"Unknown Diet",category:"cafe",dietary_tags:[],dietary_conflicts:[],cuisine_types:[],distance_km:1,latitude:35.69,longitude:139.69}]};
  const {readCompanionTool}=load("src/lib/companion/tools.ts",{...fixture,hotel,food,stay:{provider:"stayapi",provider_accommodation_id:"123"}});
  const selected=await readCompanionTool(fixture.db,fixture.state.trip,{id:"c",name:"get_selected_hotel",arguments:{},permission:"READ"});assert.equal(selected.name,"Real Stay");assert.equal(selected.total_price,"720.00");assert.equal(selected.booked,false);assert.ok(!JSON.stringify(selected).includes(KEY));
  const options=await readCompanionTool(fixture.db,fixture.state.trip,{id:"c",name:"find_food_options",arguments:{dietary_preference:"vegetarian",near_selected_hotel:true},permission:"READ"});assert.equal(options.options.length,1);assert.equal(options.options[0].name,"Real Vegan Cafe");assert.ok(options.options[0].distance_from_hotel_km<1);assert.ok(!JSON.stringify(options).includes(KEY));assert.equal(fixture.state.writes.length,0);
});
