import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signProof } from "../src/lib/destinations/proof.ts";
import { accommodationContext } from "../src/lib/accommodations/context.ts";
import { destination } from "./destination-fixtures.mjs";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const KEY = "test-internal-application-key-never-real";
const epoch = () => Math.floor(Date.now()/1000);
const signed = body => { const payload = JSON.stringify(body); return [payload, signProof(payload, KEY)]; };
async function asUser(db, owner, run, role = "authenticated") {
  await db.exec("begin");
  try { await db.exec(`set local role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner || ""]); const value = await run(); await db.exec("commit"); return value; }
  catch (error) { await db.exec("rollback"); throw error; }
}
test("accommodation selection migration verifies ownership, context, replacement and retention", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;insert into auth.users values ('${A}'),('${B}');`);
    for (const file of ["20261028000100_create_trips.sql", "20261028000200_destination_intelligence.sql", "20261028000300_open_destination_providers.sql", "20261028000400_accommodation_selections.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    await db.query("insert into nomvira_private.application_secrets(name,value) values ('internal_api_key',$1)", [KEY]);
    const form = { p_start_date: "2099-04-12", p_end_date: "2099-04-18", p_travelers_count: 2, p_budget_total: "2500.00", p_currency: "USD", p_budget_style: "balanced", p_travel_pace: "balanced", p_accommodation_preferences: ["hotel"], p_dietary_preferences: [], p_special_requests: null, p_interests: ["culture"], p_time_zone: "UTC" };
    async function createTrip(owner) {
      const args = signed({ kind: "destination", user_id: owner, resolved_at: epoch(), expires_at: epoch()+3600, destination });
      return (await asUser(db, owner, () => db.query("select public.create_resolved_trip($1::jsonb,$2,$3) id", [form, ...args]))).rows[0].id;
    }
    const tripA = await createTrip(A), tripB = await createTrip(B);
    const trip = (await db.query("select to_jsonb(t) trip from public.trips t where id=$1", [tripA])).rows[0].trip;
    const context = accommodationContext(trip);
    const proof = changes => signed({ kind: "accommodation_selection", user_id: A, trip_id: tripA, provider: "fixture", provider_accommodation_id: "garden", selected_name: "Demo Garden House", expires_at: epoch()+900, context, ...changes });
    const select = (args = proof({}), expected = null, owner = A) => asUser(db, owner, () => db.query("select public.select_trip_accommodation($1,$2,$3) id", [...args, expected]));
    let selectionId;
    await t.test("stores one owned demo choice without changing canonical destination", async () => {
      selectionId = (await select()).rows[0].id;
      const row = (await asUser(db, A, () => db.query("select * from public.trip_accommodation_selections"))).rows[0];
      assert.equal(row.selected_name, "Demo Garden House"); assert.equal(row.trip_id, tripA);
      const destinationRow = (await db.query("select destination_provider,destination_provider_id from public.trips where id=$1", [tripA])).rows[0];
      assert.deepEqual(destinationRow, { destination_provider: "open_meteo", destination_provider_id: "1850147" });
    });
    await t.test("replaces explicitly and stores live identifiers without provider metadata", async () => {
      await assert.rejects(select(proof({ provider_accommodation_id: "other" })), /Selection changed/);
      selectionId = (await select(proof({ provider: "stayapi", provider_accommodation_id: "12345", selected_name: "Do not persist", price: "999", available: true }), selectionId)).rows[0].id;
      const rows = (await db.query("select * from public.trip_accommodation_selections")).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].selected_name, null);
      assert.equal(rows[0].provider, "stayapi"); assert.equal(rows[0].provider_accommodation_id, "12345");
      assert.equal("price" in rows[0], false); assert.equal("available" in rows[0], false);
      assert.deepEqual(rows[0].search_context, context);
    });
    await t.test("denies forgery, expiry, cross-purpose and changed trip context atomically", async () => {
      const [payload, signature] = proof({});
      await assert.rejects(select([payload.replace("garden", "tampered"), signature], selectionId), /Invalid application proof/);
      for (const changes of [{ expires_at: epoch()-1 }, { kind: "destination" }]) await assert.rejects(select(proof(changes), selectionId), /Expired or invalid/);
      await assert.rejects(select(proof({ context: { ...context, budget_total: 1 } }), selectionId), /Trip changed/);
      await assert.rejects(select(proof({ provider: "stayapi", provider_accommodation_id: "../invalid" }), selectionId), /check constraint/);
      assert.equal((await db.query("select id from public.trip_accommodation_selections where trip_id=$1", [tripA])).rows[0].id, selectionId);
    });
    await t.test("RLS denies other owners and anonymous clients; browser cannot insert/update", async () => {
      assert.equal((await asUser(db, B, () => db.query("select * from public.trip_accommodation_selections"))).rows.length, 0);
      assert.equal((await asUser(db, B, () => db.query("delete from public.trip_accommodation_selections where trip_id=$1 returning id", [tripA]))).rows.length, 0);
      await assert.rejects(select(proof({ user_id: B }), null, B), /Trip not found/);
      await assert.rejects(select(proof({}), null, B), /Expired or invalid/);
      await assert.rejects(asUser(db, A, () => db.query("update public.trip_accommodation_selections set provider_accommodation_id='attacker'")), /permission denied/);
      await assert.rejects(asUser(db, A, () => db.query("insert into public.trip_accommodation_selections(trip_id,provider,provider_accommodation_id,search_context) values ($1,'fixture','fake','{}')", [tripA])), /permission denied/);
      await assert.rejects(asUser(db, null, () => db.query("select * from public.trip_accommodation_selections"), "anon"), /permission denied/);
      await assert.rejects(asUser(db, null, () => db.query("select public.select_trip_accommodation($1,$2,null)", proof({})), "anon"), /permission denied/);
    });
    await t.test("changed dates invalidate proof, and owned trip deletion cascades", async () => {
      await asUser(db, A, () => db.query("update public.trips set end_date='2099-04-19' where id=$1", [tripA]));
      await assert.rejects(select(proof({}), selectionId), /Trip changed/);
      await asUser(db, A, () => db.query("delete from public.trips where id=$1", [tripA]));
      assert.equal((await db.query("select count(*)::int n from public.trip_accommodation_selections")).rows[0].n, 0);
      assert.equal((await db.query("select id from public.trips where id=$1", [tripB])).rows.length, 1);
    });
  } finally { await db.close(); }
});
