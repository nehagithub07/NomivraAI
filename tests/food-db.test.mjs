import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signProof } from "../src/lib/destinations/proof.ts";
import { foodContext } from "../src/lib/food/context.ts";
import { destination } from "./destination-fixtures.mjs";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", KEY = "test-internal-application-key-never-real";
const epoch = () => Math.floor(Date.now()/1000);
const signed = body => { const payload = JSON.stringify(body); return [payload, signProof(payload, KEY)]; };
async function asUser(db, owner, run, role = "authenticated") {
  await db.exec("begin");
  try { await db.exec(`set local role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner || ""]); const value = await run(); await db.exec("commit"); return value; }
  catch (error) { await db.exec("rollback"); throw error; }
}
test("food migration enforces multiple owned saves, uniqueness, signed identity and isolation", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;insert into auth.users values ('${A}'),('${B}');`);
    for (const file of ["20261028000100_create_trips.sql", "20261028000200_destination_intelligence.sql", "20261028000300_open_destination_providers.sql", "20261028000400_accommodation_selections.sql", "20261029000500_food_selections.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    await db.query("insert into nomvira_private.application_secrets(name,value) values ('internal_api_key',$1)", [KEY]);
    const form = { p_start_date: "2099-04-12", p_end_date: "2099-04-18", p_travelers_count: 2, p_budget_total: "2500.00", p_currency: "USD", p_budget_style: "balanced", p_travel_pace: "balanced", p_accommodation_preferences: ["hotel"], p_dietary_preferences: ["vegetarian"], p_special_requests: null, p_interests: ["food"], p_time_zone: "UTC" };
    async function createTrip(owner) {
      return (await asUser(db, owner, () => db.query("select public.create_resolved_trip($1::jsonb,$2,$3) id", [form, ...signed({ kind: "destination", user_id: owner, resolved_at: epoch(), expires_at: epoch()+3600, destination })]))).rows[0].id;
    }
    const tripA = await createTrip(A), tripB = await createTrip(B);
    const trip = (await db.query("select to_jsonb(t) trip from public.trips t where id=$1", [tripA])).rows[0].trip;
    const proof = changes => signed({ kind: "food_selection", user_id: A, trip_id: tripA, provider: "geoapify", provider_place_id: "place-a", name: "Provider-supplied Restaurant", category: "restaurant", expires_at: epoch()+900, context: foodContext(trip), ...changes });
    const save = (changes = {}, owner = A) => asUser(db, owner, () => db.query("select public.save_trip_food($1,$2) id", proof(changes)));
    let firstId;
    await t.test("saves multiple places and repeated saves keep the same association", async () => {
      firstId = (await save()).rows[0].id;
      const duplicate = (await save()).rows[0].id;
      assert.equal(firstId, duplicate);
      await save({ provider_place_id: "place-b", name: "Provider Cafe", category: "cafe" });
      assert.equal((await asUser(db, A, () => db.query("select * from public.trip_food_selections"))).rows.length, 2);
      const names = (await db.query("select name from public.trip_food_selections order by name")).rows.map(row => row.name);
      assert.deepEqual(names, ["Provider Cafe", "Provider-supplied Restaurant"]);
    });
    await t.test("RLS hides other trips, anonymous clients and denies direct forged writes", async () => {
      assert.equal((await asUser(db, B, () => db.query("select * from public.trip_food_selections"))).rows.length, 0);
      assert.equal((await asUser(db, B, () => db.query("delete from public.trip_food_selections where trip_id=$1 returning id", [tripA]))).rows.length, 0);
      await assert.rejects(save({ user_id: B }, B), /Trip not found/);
      await assert.rejects(save({}, B), /Expired or invalid/);
      await assert.rejects(asUser(db, A, () => db.query("insert into public.trip_food_selections(trip_id,provider,provider_place_id,name,category) values ($1,'geoapify','fake','fake','restaurant')", [tripA])), /permission denied/);
      await assert.rejects(asUser(db, A, () => db.query("update public.trip_food_selections set name='fake'")), /permission denied/);
      await assert.rejects(asUser(db, null, () => db.query("select * from public.trip_food_selections"), "anon"), /permission denied/);
      await assert.rejects(asUser(db, null, () => db.query("select public.save_trip_food($1,$2)", proof({})), "anon"), /permission denied/);
    });
    await t.test("database independently rejects forgery, expiry, purpose and changed context", async () => {
      const [payload, signature] = proof({});
      await assert.rejects(asUser(db, A, () => db.query("select public.save_trip_food($1,$2)", [payload.replace("place-a", "tampered"), signature])), /Invalid application proof/);
      for (const patch of [{ expires_at: epoch()-1 }, { kind: "accommodation_selection" }]) await assert.rejects(save(patch), /Expired or invalid/);
      await assert.rejects(save({ context: { ...foodContext(trip), destination_latitude: 0 } }), /Trip changed/);
      await assert.rejects(save({ category: "invalid", provider_place_id: "bad" }), /check constraint/);
      assert.equal((await db.query("select count(*)::int n from public.trip_food_selections")).rows[0].n, 2);
    });
    await t.test("owned removal deletes one association and trip deletion cascades", async () => {
      await asUser(db, A, () => db.query("delete from public.trip_food_selections where trip_id=$1 and id=$2", [tripA, firstId]));
      assert.equal((await db.query("select count(*)::int n from public.trip_food_selections")).rows[0].n, 1);
      await asUser(db, A, () => db.query("update public.trips set dietary_preferences=array['vegan'] where id=$1", [tripA]));
      await assert.rejects(save(), /Trip changed/);
      await asUser(db, A, () => db.query("delete from public.trips where id=$1", [tripA]));
      assert.equal((await db.query("select count(*)::int n from public.trip_food_selections")).rows[0].n, 0);
      assert.equal((await db.query("select id from public.trips where id=$1", [tripB])).rows.length, 1);
    });
  } finally { await db.close(); }
});
