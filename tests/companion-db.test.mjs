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
import { buildTripDatabaseSetup } from "../scripts/prepare-trip-database.mjs";

const A="00000000-0000-4000-8000-000000000001",B="00000000-0000-4000-8000-000000000002",KEY="test-internal-application-key-never-real";
const epoch=()=>Math.floor(Date.now()/1000), hash=s=>createHash("sha256").update(s).digest("hex");
const sign=proof=>{const payload=JSON.stringify(proof);return [payload,signProof(payload,KEY)];};
async function asUser(db,user,run,role="authenticated") {
  await db.exec("begin");
  try {await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||""]);const result=await run();await db.exec("commit");return result;}
  catch(error){await db.exec("rollback");throw error;}
}
test("companion SQL: owned private chat, signed actions, replay/expiry guards and immutable itinerary edits",async t=>{
  const db=new PGlite({extensions:{pgcrypto}});
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;insert into auth.users values('${A}'),('${B}');`);
    const names=["20261028000100_create_trips.sql","20261028000200_destination_intelligence.sql","20261028000300_open_destination_providers.sql","20261028000400_accommodation_selections.sql","20261029000500_food_selections.sql","20261029000600_itinerary_versions.sql","20261029000700_trip_budget_entries.sql","20261030000800_weather_adaptation.sql","20261030000900_ai_companion.sql"];
    const migrations=await Promise.all(names.map(n=>readFile(new URL(`../supabase/migrations/${n}`,import.meta.url),"utf8")));
    for(const sql of migrations) await db.exec(sql);
    await db.query("insert into nomvira_private.application_secrets(name,value) values('internal_api_key',$1)",[KEY]);
    const setup=buildTripDatabaseSetup(migrations[1],migrations[2],KEY,...migrations.slice(3));
    await db.exec(setup); // Full setup is safe to rerun with Step 12 installed.
    const form={p_start_date:"2099-04-12",p_end_date:"2099-04-13",p_travelers_count:2,p_budget_total:"2500.00",p_currency:"USD",p_budget_style:"balanced",p_travel_pace:"balanced",p_accommodation_preferences:["hotel"],p_dietary_preferences:[],p_special_requests:null,p_interests:["history"],p_time_zone:"UTC"};
    const tripId=(await asUser(db,A,()=>db.query("select public.create_resolved_trip($1::jsonb,$2,$3) id",[form,...sign({kind:"destination",user_id:A,resolved_at:epoch(),expires_at:epoch()+3600,destination})]))).rows[0].id;
    const trip={...(await db.query("select to_jsonb(t) trip from public.trips t where id=$1",[tripId])).rows[0].trip,trip_interests:[{interest:"history"}]};
    const proof=(kind,extra={})=>({kind,user_id:A,trip_id:tripId,expires_at:epoch()+180,...extra});
    const req=randomUUID();let conversationId;
    const begin=(user=A,id=req)=>asUser(db,user,()=>db.query("select public.begin_companion_message($1,$2,'What is my itinerary?') data",[tripId,id]));
    await t.test("owner can create a chat; non-owner and anon cannot",async()=>{
      await assert.rejects(begin(B),/Trip not found/);
      await assert.rejects(asUser(db,null,()=>db.query("select public.begin_companion_message($1,$2,'hello')",[tripId,req]),"anon"),/permission denied/);
      const data=(await begin()).rows[0].data;conversationId=data.conversation_id;assert.equal(data.duplicate,false);
      assert.equal((await begin()).rows[0].data.duplicate,true);
      await assert.rejects(begin(A,randomUUID()),/COMPANION_RATE_LIMITED/);
    });
    await t.test("assistant persistence requires the signed exact document and replays idempotently",async()=>{
      const doc=JSON.stringify({message:"Here is your saved trip.",cards:[],tool_audit:[{tool_name:"get_trip_overview",status:"ok"}],model:"gemini-3.8-flash",prompt_version:"v1"});
      const signed=sign(proof("companion_message",{request_id:req,document_hash:hash(doc)}));
      await assert.rejects(asUser(db,A,()=>db.query("select public.finish_companion_message($1,$2,$3)",[signed[0],"0".repeat(64),doc])),/Invalid application proof/);
      await assert.rejects(asUser(db,A,()=>db.query("select public.finish_companion_message($1,$2,$3)",[...signed,doc+" "])),/COMPANION_CONFLICT/);
      const save=()=>asUser(db,A,()=>db.query("select public.finish_companion_message($1,$2,$3) id",[...signed,doc]));
      assert.equal((await save()).rows[0].id,(await save()).rows[0].id);
      assert.equal((await begin()).rows[0].data.response.message,"Here is your saved trip.");
      assert.equal((await db.query("select count(*)::int n from public.companion_messages")).rows[0].n,2);
    });
    const snapshot={trip_context:itineraryTripContext(trip),hotel_id:null,itinerary_id:null,original_message:"Add USD 35 dinner expense"};
    async function prepare(overrides={}) {
      const id=randomUUID(),doc=JSON.stringify({tool_name:"add_budget_entry",arguments:{amount:"35.00",currency:"USD",entry_type:"actual",category:"food",description:"Dinner"},snapshot,preview:{title:"Add expense?",proposed:"USD 35 Dinner"},...overrides});
      await asUser(db,A,()=>db.query("select public.prepare_companion_action($1,$2,$3)",[...sign(proof("companion_action",{action_id:id,document_hash:hash(doc)})),doc]));return id;
    }
    const claim=(id,operation="confirm",user=A)=>asUser(db,user,()=>db.query("select public.claim_companion_action($1,$2) data",sign(proof("companion_claim",{action_id:id,operation}))));
    await t.test("a proposal has no domain effect; confirmation is claimed once; duplicate is idempotent",async()=>{
      const id=await prepare();
      assert.equal((await db.query("select count(*)::int n from public.trip_budget_entries")).rows[0].n,0);
      assert.equal((await claim(id)).rows[0].data.claimed,true);
      assert.equal((await claim(id)).rows[0].data.claimed,false);
      await asUser(db,A,()=>db.query("select public.finish_companion_action($1,$2)",sign(proof("companion_result",{action_id:id,status:"executed",result:{message:"Saved"}}))));
      const duplicate=(await claim(id)).rows[0].data;assert.equal(duplicate.claimed,false);assert.equal(duplicate.action.result.message,"Saved");
    });
    await t.test("cancelled and expired actions can never execute",async()=>{
      const cancelled=await prepare();assert.equal((await claim(cancelled,"cancel")).rows[0].data.action.status,"cancelled");assert.equal((await claim(cancelled)).rows[0].data.claimed,false);
      const expired=await prepare();await db.query("update public.companion_pending_actions set expires_at=now()-interval '1 second' where id=$1",[expired]);
      assert.equal((await claim(expired)).rows[0].data.action.status,"expired");assert.equal((await claim(expired)).rows[0].data.claimed,false);
    });
    await t.test("foreign actions and stale trip snapshots are rejected",async()=>{
      const id=await prepare();await assert.rejects(claim(id,"confirm",B),/invalid application proof|Trip not found/i);
      await assert.rejects(claim(randomUUID()),/Action not found/);
      await db.query("update public.trips set travel_pace='relaxed' where id=$1",[tripId]);
      await assert.rejects(claim(id),/COMPANION_CONTEXT_CHANGED/);
      await db.query("update public.trips set travel_pace='balanced' where id=$1",[tripId]);
    });
    await t.test("RLS hides all private chat/action rows; direct writes are denied",async()=>{
      for(const table of ["companion_conversations","companion_messages","companion_pending_actions"]){
        assert.equal((await asUser(db,B,()=>db.query(`select * from public.${table}`))).rows.length,0);
        assert.ok((await asUser(db,A,()=>db.query(`select * from public.${table}`))).rows.length);
        await assert.rejects(asUser(db,A,()=>db.query(`delete from public.${table}`)),/permission denied/);
      }
      await assert.rejects(asUser(db,A,()=>db.query("insert into public.companion_messages(conversation_id,role,content) values($1,'assistant','Forged success')",[conversationId])),/permission denied/);
      await assert.rejects(asUser(db,A,()=>db.query("update public.companion_pending_actions set status='executed'")),/permission denied/);
    });
    await t.test("companion edit saves a NEW version and retains previous items unchanged",async()=>{
      await asUser(db,A,()=>db.query("select public.persist_trip_place_candidates($1,$2)",sign(proof("discovery",{refreshed_at:epoch(),places:[{...place,provider_place_id:"node/123",name:"Tokyo Museum"}]}))));
      const doc=itineraryDocument(),text=JSON.stringify(doc),digest=hash(text);
      const first=(await asUser(db,A,()=>db.query("select public.begin_itinerary_generation($1,$2,true) id",[tripId,randomUUID()]))).rows[0].id;
      const versionProof=(id,extra={})=>proof("itinerary_version",{version_id:id,trip_context:itineraryTripContext(trip),provider:"gemini",model_name:"gemini-3.8-flash",prompt_version:"v1",demo:false,document_hash:digest,...extra});
      await asUser(db,A,()=>db.query("select public.complete_itinerary_generation($1,$2,$3)",[...sign(versionProof(first)),text]));
      const before=(await db.query("select to_jsonb(i) value from public.itinerary_items i join public.itinerary_days d on d.id=i.itinerary_day_id where d.itinerary_version_id=$1",[first])).rows;
      await db.query("update public.itinerary_versions set created_at=now()-interval '1 minute' where id=$1",[first]);
      const second=(await asUser(db,A,()=>db.query("select public.begin_companion_itinerary_edit($1,$2,$3) id",[tripId,randomUUID(),first]))).rows[0].id;
      doc.days[0].items[0].period="afternoon";const next=JSON.stringify(doc);
      const signed=sign(versionProof(second,{parent_version_id:first,parent_document_hash:digest,generation_reason:"companion_edit",document_hash:hash(next)}));
      await assert.rejects(asUser(db,A,()=>db.query("select public.complete_itinerary_generation($1,$2,$3)",[...signed,next])),/WEATHER_CONTEXT_CHANGED/);
      await asUser(db,A,()=>db.query("select public.complete_companion_itinerary_edit($1,$2,$3)",[...signed,next]));
      assert.equal((await db.query("select generation_reason from public.itinerary_versions where id=$1",[second])).rows[0].generation_reason,"companion_edit");
      assert.deepEqual((await db.query("select to_jsonb(i) value from public.itinerary_items i join public.itinerary_days d on d.id=i.itinerary_day_id where d.itinerary_version_id=$1",[first])).rows,before);
      assert.equal((await db.query("select count(*)::int n from public.itinerary_versions where status='ready'")).rows[0].n,2);
    });
    await t.test("deleting the parent trip cascades private companion data",async()=>{
      await db.query("delete from public.trips where id=$1",[tripId]);
      for(const table of ["companion_conversations","companion_messages","companion_pending_actions"])assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
    });
  } finally {await db.close();}
});
