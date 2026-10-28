import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signProof } from "../src/lib/destinations/proof.ts";
import { destination, place } from "./destination-fixtures.mjs";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const KEY = "test-internal-application-key-never-real";
const form = { p_destination_name: "Untrusted browser name", p_start_date: "2099-04-12", p_end_date: "2099-04-18", p_travelers_count: 2, p_budget_total: "2500.50", p_currency: "USD", p_budget_style: "balanced", p_travel_pace: "balanced", p_accommodation_preferences: ["hotel"], p_dietary_preferences: [], p_special_requests: null, p_interests: ["food", "culture"], p_time_zone: "UTC" };
const now = () => Math.floor(Date.now() / 1000);
const signed = object => { const payload = JSON.stringify(object); return [payload, signProof(payload, KEY)]; };
const resolution = (changes = {}) => signed({ kind: "destination", user_id: A, resolved_at: now(), expires_at: now() + 3600, destination, ...changes });
async function asUser(db, userId, run, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId || ""]);
    const value = await run(); await db.exec("commit"); return value;
  } catch (error) { await db.exec("rollback"); throw error; }
}
test("forward migration, canonical destination/OSM persistence, RLS and legacy preservation", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      insert into auth.users values ('${A}'),('${B}');`);
    const migrate = async filename => db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"));
    await migrate("20261028000100_create_trips.sql");
    await db.query("insert into public.trips(owner_id,destination_name,start_date,end_date,travelers_count,budget_total,currency) values ($1,'Legacy trip','2099-04-12','2099-04-18',1,100,'USD')", [A]);
    await migrate("20261028000200_destination_intelligence.sql");
    await db.query("update public.trips set destination_place_id='old-google-id',destination_latitude=40,destination_longitude=10,destination_content_expires_at=now()-interval '1 day' where destination_name='Legacy trip'");
    await migrate("20261028000300_open_destination_providers.sql");
    await db.query("insert into nomvira_private.application_secrets(name,value) values ('internal_api_key',$1)", [KEY]);
    let tripId;
    const create = (proof = resolution(), userId = A, input = form) => asUser(db, userId, () => db.query("select public.create_resolved_trip($1::jsonb,$2,$3) id", [input, ...proof]));
    await t.test("retains old trips and stores canonical open-provider metadata", async () => {
      tripId = (await create()).rows[0].id;
      const trips = (await asUser(db, A, () => db.query("select * from public.trips"))).rows;
      assert.equal(trips.length, 2);
      const legacy = trips.find(row => row.destination_name === "Legacy trip");
      assert.equal(legacy.destination_provider, "google"); assert.equal(legacy.destination_provider_id, "old-google-id");
      const trip = trips.find(row => row.id === tripId);
      assert.equal(trip.destination_name, "Tokyo"); assert.equal(trip.destination_display_name, "Tokyo, Japan");
      assert.equal(trip.destination_provider, "open_meteo"); assert.equal(trip.destination_provider_id, "1850147");
      assert.equal(trip.destination_country_code, "JP"); assert.equal(trip.destination_admin1, "Tokyo");
      assert.equal(trip.destination_population, 9733276); assert.equal(trip.destination_feature_code, "PPLC");
      assert.equal(trip.destination_latitude, destination.latitude); assert.equal(trip.destination_timezone, "Asia/Tokyo");
      assert.equal(trip.destination_utc_offset_minutes, 540); assert.equal(trip.destination_content_expires_at, null);
      assert.equal((await db.query("select count(*)::int n from public.trip_interests where trip_id=$1", [tripId])).rows[0].n, 2);
      const singleCharacter = await create(resolution({ destination: { ...destination, name: "津", display_name: "津, Japan" } }));
      assert.equal((await db.query("select destination_name from public.trips where id=$1", [singleCharacter.rows[0].id])).rows[0].destination_name, "津");
    });
    await t.test("rejects tampering, cross-user/expired proofs and arbitrary browser writes", async () => {
      const [payload, signature] = resolution();
      await assert.rejects(create([payload.replace("35.6895", "42"), signature]), /Invalid application proof/);
      await assert.rejects(create(resolution({ expires_at: now() - 1 })), /Expired or invalid/);
      await assert.rejects(create(resolution(), B), /Expired or invalid/);
      await assert.rejects(asUser(db, A, () => db.query("select * from nomvira_private.application_secrets")), /permission denied/);
      await assert.rejects(asUser(db, A, () => db.query("update public.trips set destination_latitude=42 where id=$1", [tripId])), /permission denied/);
      await asUser(db, A, () => db.query("update public.trips set special_requests='Early mornings' where id=$1", [tripId]));
      const before = (await db.query("select count(*)::int n from public.trips")).rows[0].n;
      await assert.rejects(create(resolution(), A, { ...form, p_interests: ["invalid"] }), /check constraint/);
      assert.equal((await db.query("select count(*)::int n from public.trips")).rows[0].n, before);
    });
    const batch = (changes = {}) => signed({ kind: "discovery", user_id: A, trip_id: tripId, expires_at: now() + 300, refreshed_at: now(), places: [place], ...changes });
    const persist = (proof = batch(), userId = A) => asUser(db, userId, () => db.query("select public.persist_trip_place_candidates($1,$2)", proof));
    await t.test("persists real names/categories/coordinates, filtered tags, distance and deduplicates", async () => {
      await persist(); await persist();
      assert.equal((await db.query("select count(*)::int n from public.places")).rows[0].n, 1);
      assert.equal((await db.query("select count(*)::int n from public.trip_place_candidates")).rows[0].n, 1);
      const row = (await asUser(db, A, () => db.query("select * from public.places"))).rows[0];
      assert.equal(row.name, place.name); assert.equal(row.category, "museum"); assert.equal(row.content_expires_at, null);
      assert.deepEqual(row.metadata, place.tags);
      assert.equal(Number((await db.query("select distance_km from public.trip_place_candidates")).rows[0].distance_km), 1.5);
      await persist(batch({ places: [{ ...place, tags: { ...place.tags, phone: "private" } }] }));
      assert.equal((await db.query("select metadata from public.places")).rows[0].metadata.phone, undefined);
    });
    await t.test("isolates provider reads and denies all untrusted global writes", async () => {
      for (const table of ["places", "trip_place_candidates"]) {
        assert.equal((await asUser(db, B, () => db.query(`select * from public.${table}`))).rows.length, 0);
        for (const query of [`delete from public.${table}`, `update public.${table} set id=gen_random_uuid()`]) await assert.rejects(asUser(db, A, () => db.query(query)), /permission denied/);
        await assert.rejects(asUser(db, "", () => db.query(`select * from public.${table}`), "anon"), /permission denied/);
      }
      await assert.rejects(persist(batch({ user_id: B }), B), /Trip not found/);
      await assert.rejects(persist(batch({ places: [{ ...place, provider_place_id: "../fake" }] })), /check constraint/);
    });
    await t.test("old retention cleanup cannot expire open-provider destination/place data", async () => {
      await db.exec("select nomvira_private.purge_expired_provider_content()");
      const trips = (await db.query("select * from public.trips")).rows;
      assert.equal(trips.find(row => row.destination_name === "Legacy trip").destination_latitude, null);
      assert.equal(trips.find(row => row.id === tripId).destination_latitude, destination.latitude);
      assert.equal((await db.query("select latitude from public.places")).rows[0].latitude, place.latitude);
    });
  } finally { await db.close(); }
});
