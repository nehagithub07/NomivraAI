import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signProof } from "../src/lib/destinations/proof.ts";
import { itineraryTripContext } from "../src/lib/itineraries/context.ts";
import { destination, place } from "./destination-fixtures.mjs";
import { itineraryDocument } from "./itinerary-fixtures.mjs";

const A="00000000-0000-4000-8000-000000000001",B="00000000-0000-4000-8000-000000000002",KEY="test-internal-application-key-never-real";
const epoch=()=>Math.floor(Date.now()/1000);
const sign=proof=>{const payload=JSON.stringify(proof);return [payload,signProof(payload,KEY)];};
async function asUser(db,user,run,role="authenticated") {
  await db.exec("begin");
  try {await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||""]);const result=await run();await db.exec("commit");return result;}
  catch(error){await db.exec("rollback");throw error;}
}
test("weather adaptation migration reuses signed validation, preserves history/budgets and enforces current-parent CAS",async t=>{
  const db=new PGlite({extensions:{pgcrypto}});
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;insert into auth.users values('${A}'),('${B}');`);
    for(const name of ["20261028000100_create_trips.sql","20261028000200_destination_intelligence.sql","20261028000300_open_destination_providers.sql","20261028000400_accommodation_selections.sql","20261029000500_food_selections.sql","20261029000600_itinerary_versions.sql","20261029000700_trip_budget_entries.sql","20261030000800_weather_adaptation.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8"));
    await db.query("insert into nomvira_private.application_secrets(name,value) values('internal_api_key',$1)",[KEY]);
    const form={p_start_date:"2099-04-12",p_end_date:"2099-04-13",p_travelers_count:2,p_budget_total:"2500.00",p_currency:"USD",p_budget_style:"balanced",p_travel_pace:"balanced",p_accommodation_preferences:["hotel"],p_dietary_preferences:[],p_special_requests:null,p_interests:["history"],p_time_zone:"UTC"};
    const tripId=(await asUser(db,A,()=>db.query("select public.create_resolved_trip($1::jsonb,$2,$3) id",[form,...sign({kind:"destination",user_id:A,resolved_at:epoch(),expires_at:epoch()+3600,destination})]))).rows[0].id;
    const trip={...(await db.query("select to_jsonb(t) trip from public.trips t where id=$1",[tripId])).rows[0].trip,trip_interests:[{interest:"history"}]};
    await asUser(db,A,()=>db.query("select public.persist_trip_place_candidates($1,$2)",sign({kind:"discovery",user_id:A,trip_id:tripId,refreshed_at:epoch(),expires_at:epoch()+300,places:[{...place,provider_place_id:"node/1",name:"Real Museum 1"}]})));
    await asUser(db,A,()=>db.query("insert into public.trip_budget_entries(trip_id,category,entry_type,description,amount,currency) values($1,'activities','planned','Museum ticket',25,'USD')",[tripId]));
    const doc=itineraryDocument();doc.days[0].items[0].candidate_id="node/1";doc.days[0].items[0].title="Real Museum 1";
    const text=JSON.stringify(doc),digest=createHash('sha256').update(text).digest('hex');
    const proof=(id,extra={})=>({kind:"itinerary_version",user_id:A,trip_id:tripId,version_id:id,expires_at:epoch()+180,trip_context:itineraryTripContext(trip),document_hash:digest,provider:"gemini",model_name:"gemini-3.8-flash",prompt_version:"v1",demo:false,...extra});
    const first=(await asUser(db,A,()=>db.query("select public.begin_itinerary_generation($1,$2,true) id",[tripId,randomUUID()]))).rows[0].id;
    await asUser(db,A,()=>db.query("select public.complete_itinerary_generation($1,$2,$3)",[...sign(proof(first)),text]));
    const oldSnapshot=(await db.query("select title,summary,document_hash,warnings from public.itinerary_versions where id=$1",[first])).rows[0];
    const oldItems=(await db.query("select to_jsonb(i) item from public.itinerary_items i join public.itinerary_days d on d.id=i.itinerary_day_id where d.itinerary_version_id=$1 order by i.position",[first])).rows;
    await db.query("update public.itinerary_versions set created_at=now()-interval '1 minute' where id=$1",[first]);
    const nonce=randomUUID();let second;
    const begin=(parent=first,owner=A,requestId=nonce)=>asUser(db,owner,()=>db.query("select public.begin_weather_adaptation($1,$2,$3) id",[tripId,requestId,parent]));
    const fetched=new Date().toISOString();
    const metadata={generation_reason:"weather_adaptation",parent_version_id:first,parent_document_hash:digest,weather_fetched_at:fetched,prompt_version:"weather-v1"};
    await t.test("only the owner can reserve adaptation; invalid/stale parents cannot reserve",async()=>{
      await assert.rejects(begin(first,B),/Trip not found/);
      await assert.rejects(begin(randomUUID()),/WEATHER_CONTEXT_CHANGED/);
      second=(await begin()).rows[0].id;
      await assert.rejects(begin(),/ITINERARY_IN_PROGRESS/);
      assert.equal((await db.query("select id from public.itinerary_versions where is_current")).rows[0].id,first);
    });
    await t.test("normal completion cannot bypass adaptation metadata checks",async()=>{
      await assert.rejects(asUser(db,A,()=>db.query("select public.complete_itinerary_generation($1,$2,$3)",[...sign(proof(second,metadata)),text])),/WEATHER_CONTEXT_CHANGED/);
      await assert.rejects(asUser(db,A,()=>db.query("select nomvira_private.complete_itinerary_generation($1,$2,$3)",[...sign(proof(second,metadata)),text])),/permission denied/);
      for(const patch of [{parent_document_hash:"0".repeat(64)},{weather_fetched_at:"2000-01-01T00:00:00Z"},{parent_version_id:randomUUID()}]) await assert.rejects(asUser(db,A,()=>db.query("select public.complete_weather_adaptation($1,$2,$3)",[...sign(proof(second,{...metadata,...patch})),text])),/WEATHER_CONTEXT_CHANGED/);
    });
    await t.test("signed semantic validation rejects unknown IDs atomically",async()=>{
      const bad=text.replace('node/1','node/999'),hash=createHash('sha256').update(bad).digest('hex');
      await assert.rejects(asUser(db,A,()=>db.query("select public.complete_weather_adaptation($1,$2,$3)",[...sign(proof(second,{...metadata,document_hash:hash})),bad])),/Invalid itinerary attraction/);
      assert.equal((await db.query("select status from public.itinerary_versions where id=$1",[second])).rows[0].status,"generating");
    });
    await t.test("new version is atomic, retains immutable previous content, metadata and manual expenses",async()=>{
      await asUser(db,A,()=>db.query("select public.complete_weather_adaptation($1,$2,$3)",[...sign(proof(second,metadata)),text]));
      await asUser(db,A,()=>db.query("select public.complete_weather_adaptation($1,$2,$3)",[...sign(proof(second,metadata)),text]));
      assert.equal((await begin()).rows[0].id,second);
      const row=(await db.query("select * from public.itinerary_versions where id=$1",[second])).rows[0];
      assert.equal(row.version_number,2);assert.equal(row.generation_reason,"weather_adaptation");assert.equal(row.parent_version_id,first);assert.ok(row.weather_fetched_at);assert.equal(row.is_current,true);
      assert.deepEqual((await db.query("select title,summary,document_hash,warnings from public.itinerary_versions where id=$1",[first])).rows[0],oldSnapshot);
      assert.deepEqual((await db.query("select to_jsonb(i) item from public.itinerary_items i join public.itinerary_days d on d.id=i.itinerary_day_id where d.itinerary_version_id=$1 order by i.position",[first])).rows,oldItems);
      assert.equal((await db.query("select amount::text from public.trip_budget_entries where trip_id=$1",[tripId])).rows[0].amount,"25");
    });
    await t.test("RLS still hides both versions and prevents direct metadata changes",async()=>{
      assert.equal((await asUser(db,B,()=>db.query("select * from public.itinerary_versions"))).rows.length,0);
      await assert.rejects(asUser(db,A,()=>db.query("update public.itinerary_versions set generation_reason='initial' where id=$1",[second])),/permission denied/);
      await assert.rejects(asUser(db,null,()=>db.query("select public.begin_weather_adaptation($1,$2,$3)",[tripId,randomUUID(),second]),"anon"),/permission denied/);
    });
  } finally {await db.close();}
});
