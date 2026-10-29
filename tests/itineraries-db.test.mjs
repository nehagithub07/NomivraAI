import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signProof } from "../src/lib/destinations/proof.ts";
import { itineraryTripContext } from "../src/lib/itineraries/context.ts";
import { foodContext } from "../src/lib/food/context.ts";
import { destination, place } from "./destination-fixtures.mjs";
import { itineraryDocument } from "./itinerary-fixtures.mjs";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", KEY = "test-internal-application-key-never-real";
const epoch = () => Math.floor(Date.now() / 1000);
const sign = proof => { const payload = JSON.stringify(proof); return [payload, signProof(payload, KEY)]; };
async function asUser(db, user, run, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || ""]);
    const result = await run(); await db.exec("commit"); return result;
  } catch (error) { await db.exec("rollback"); throw error; }
}

test("itinerary migration enforces atomic versions, signed persistence, trusted IDs, idempotency and RLS", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;insert into auth.users values ('${A}'),('${B}');`);
    for (const file of ["20261028000100_create_trips.sql", "20261028000200_destination_intelligence.sql", "20261028000300_open_destination_providers.sql", "20261028000400_accommodation_selections.sql", "20261029000500_food_selections.sql", "20261029000600_itinerary_versions.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    await db.query("insert into nomvira_private.application_secrets(name,value) values ('internal_api_key',$1)", [KEY]);
    const form = { p_start_date: "2099-04-12", p_end_date: "2099-04-13", p_travelers_count: 2, p_budget_total: "2500.00", p_currency: "USD", p_budget_style: "balanced", p_travel_pace: "balanced", p_accommodation_preferences: ["hotel"], p_dietary_preferences: ["vegetarian"], p_special_requests: null, p_interests: ["food", "history"], p_time_zone: "UTC" };
    const tripId = (await asUser(db, A, () => db.query("select public.create_resolved_trip($1::jsonb,$2,$3) id", [form, ...sign({ kind: "destination", user_id: A, resolved_at: epoch(), expires_at: epoch() + 3600, destination })]))).rows[0].id;
    const trip = { ...(await db.query("select to_jsonb(t) trip from public.trips t where id=$1", [tripId])).rows[0].trip, trip_interests: [{ interest: "food" }, { interest: "history" }] };
    const attractions = Array.from({ length: 4 }, (_, i) => ({ ...place, provider_place_id: `node/${i + 1}`, name: `Real Museum ${i + 1}` }));
    await asUser(db, A, () => db.query("select public.persist_trip_place_candidates($1,$2)", sign({ kind: "discovery", user_id: A, trip_id: tripId, refreshed_at: epoch(), expires_at: epoch() + 300, places: attractions })));
    await asUser(db, A, () => db.query("select public.save_trip_food($1,$2)", sign({ kind: "food_selection", user_id: A, trip_id: tripId, expires_at: epoch() + 900, provider: "geoapify", provider_place_id: "saved-food", name: "Real Saved Cafe", category: "cafe", context: foodContext(trip) })));
    function document() {
      const value = itineraryDocument();
      value.days[0].items[0].candidate_id = "node/1"; value.days[0].items[0].title = "Real Museum 1";
      return value;
    }
    async function reserve(requestId = randomUUID(), regenerate = true, owner = A) {
      return (await asUser(db, owner, () => db.query("select public.begin_itinerary_generation($1,$2,$3) id", [tripId, requestId, regenerate]))).rows[0].id;
    }
    const coolDown = () => db.query("update public.itinerary_versions set created_at=now()-interval '1 minute' where trip_id=$1", [tripId]);
    function completion(versionId, value = document(), patch = {}) {
      const text = JSON.stringify(value);
      const proof = { kind: "itinerary_version", user_id: A, trip_id: tripId, version_id: versionId, expires_at: epoch() + 180,
        trip_context: itineraryTripContext(trip), document_hash: createHash("sha256").update(text).digest("hex"), provider: "gemini", model_name: "gemini-3.8-flash", prompt_version: "v1", demo: false, ...patch };
      return [...sign(proof), text];
    }
    const complete = (versionId, value, patch, owner = A) => asUser(db, owner, () => db.query("select public.complete_itinerary_generation($1,$2,$3) id", completion(versionId, value, patch)));
    const fail = id => asUser(db, A, () => db.query("select public.fail_itinerary_generation($1,$2)", sign({ kind: "itinerary_failure", user_id: A, trip_id: tripId, version_id: id, expires_at: epoch() + 180 })));
    let first, second;
    await t.test("first generation is reserved once and requires a signed exact document", async () => {
      const requestId = randomUUID(); first = await reserve(requestId);
      await assert.rejects(reserve(requestId), /ITINERARY_IN_PROGRESS/);
      await assert.rejects(reserve(), /ITINERARY_IN_PROGRESS/);
      const args = completion(first);
      await assert.rejects(asUser(db, A, () => db.query("select public.complete_itinerary_generation($1,$2,$3)", [args[0], "0".repeat(64), args[2]])), /Invalid application proof/);
      await assert.rejects(asUser(db, A, () => db.query("select public.complete_itinerary_generation($1,$2,$3)", [args[0], args[1], args[2].replace("Real Museum", "Tampered Museum")])), /Invalid itinerary digest/);
      assert.equal((await complete(first)).rows[0].id, first);
      assert.equal((await complete(first)).rows[0].id, first);
      assert.equal(await reserve(requestId), first);
      assert.equal(await reserve(randomUUID(), false), first);
      assert.equal((await db.query("select count(*)::int n from public.itinerary_versions")).rows[0].n, 1);
      assert.equal((await db.query("select count(*)::int n from public.itinerary_days")).rows[0].n, 2);
      assert.equal((await db.query("select title from public.itinerary_items where candidate_type='attraction'")).rows[0].title, "Real Museum 1");
    });
    await t.test("regeneration is throttled and keeps the current version until atomic completion", async () => {
      await assert.rejects(reserve(), /ITINERARY_RATE_LIMITED/);
      await coolDown(); second = await reserve();
      assert.equal((await db.query("select id from public.itinerary_versions where is_current")).rows[0].id, first);
      assert.equal((await db.query("select version_number from public.itinerary_versions where id=$1", [second])).rows[0].version_number, 2);
    });
    await t.test("unknown attraction/food/hotel IDs, duplicate places, invalid dates and capacity roll back", async () => {
      const cases = [
        value => { value.days[0].items[0].candidate_id = "node/99999"; },
        value => { value.days[0].items[0].candidate_type = "food"; value.days[0].items[0].candidate_provider = "geoapify"; value.days[0].items[0].candidate_id = "invented-food"; },
        value => { value.days[0].items[0].candidate_type = "hotel"; value.days[0].items[0].candidate_provider = "stayapi"; value.days[0].items[0].candidate_id = randomUUID(); },
        value => { value.days[0].items.push({ ...value.days[0].items[0] }); },
        value => { value.days[1].date = "2099-05-01"; },
        value => { value.days[1].day_number = 9; },
        value => { value.days[0].items[0].candidate_provider = null; },
        value => { value.days[0].items[0].latitude = 0; },
        value => { value.days[0].items[0].period = "evening"; value.days[0].items.push({ ...value.days[1].items[0], period: "morning" }); },
        value => { value.days[0].items = attractions.map(a => ({ ...value.days[0].items[0], candidate_id: a.provider_place_id, title: a.name })); },
      ];
      for (const mutate of cases) { const value = document(); mutate(value); await assert.rejects(complete(second, value)); }
      assert.equal((await db.query("select count(*)::int n from public.itinerary_days where itinerary_version_id=$1", [second])).rows[0].n, 0);
      assert.equal((await db.query("select id from public.itinerary_versions where is_current")).rows[0].id, first);
      const value = document(); value.days[0].items.push({ ...value.days[0].items[0], candidate_type: "food", candidate_provider: "geoapify", candidate_id: "saved-food", title: "Real Saved Cafe", category: "cafe", period: "evening", latitude: null, longitude: null });
      await complete(second, value);
      const versions = (await db.query("select version_number,is_current,status from public.itinerary_versions order by version_number")).rows;
      assert.deepEqual(versions, [{ version_number: 1, is_current: false, status: "ready" }, { version_number: 2, is_current: true, status: "ready" }]);
    });
    await t.test("RLS protects all three tables, RPC ownership and immutable generated rows", async () => {
      for (const [table, count] of [["itinerary_versions", 2], ["itinerary_days", 4], ["itinerary_items", 5]]) {
        assert.equal((await asUser(db, A, () => db.query(`select * from public.${table}`))).rows.length, count);
      }
      for (const table of ["itinerary_versions", "itinerary_days", "itinerary_items"]) {
        assert.equal((await asUser(db, B, () => db.query(`select * from public.${table}`))).rows.length, 0);
        await assert.rejects(asUser(db, null, () => db.query(`select * from public.${table}`), "anon"), /permission denied/);
        await assert.rejects(asUser(db, A, () => db.query(`delete from public.${table}`)), /permission denied/);
        await assert.rejects(asUser(db, A, () => db.query(`update public.${table} set id=id`)), /permission denied/);
      }
      await assert.rejects(reserve(randomUUID(), true, B), /Trip not found/);
      await assert.rejects(complete(first, document(), { user_id: B }, B), /Trip not found/);
      await assert.rejects(asUser(db, null, () => db.query("select public.begin_itinerary_generation($1,$2,true)", [tripId, randomUUID()]), "anon"), /permission denied/);
      await assert.rejects(asUser(db, A, () => db.query("insert into public.itinerary_versions(trip_id,request_id,version_number,trip_context) values ($1,$2,99,'{}')", [tripId, randomUUID()])), /permission denied/);
    });
    await t.test("changed trip context and failed attempts preserve the current version", async () => {
      await coolDown(); const id = await reserve();
      await db.query("update public.trips set budget_total=2510 where id=$1", [tripId]);
      await assert.rejects(complete(id), /ITINERARY_CONTEXT_CHANGED/);
      await fail(id);
      assert.equal((await db.query("select status from public.itinerary_versions where id=$1", [id])).rows[0].status, "failed");
      assert.equal((await db.query("select id from public.itinerary_versions where is_current")).rows[0].id, second);
      await fail(second); // A delayed failure acknowledgement cannot invalidate a ready version.
      assert.equal((await db.query("select status from public.itinerary_versions where id=$1", [second])).rows[0].status, "ready");
    });
    await t.test("abandoned leases recover and owned trip deletion cascades through history", async () => {
      await coolDown(); const abandoned = await reserve();
      await db.query("update public.itinerary_versions set created_at=now()-interval '4 minutes' where id=$1", [abandoned]);
      await reserve();
      assert.equal((await db.query("select status from public.itinerary_versions where id=$1", [abandoned])).rows[0].status, "failed");
      await asUser(db, A, () => db.query("delete from public.trips where id=$1", [tripId]));
      for (const table of ["itinerary_versions", "itinerary_days", "itinerary_items"]) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n, 0);
    });
  } finally { await db.close(); }
});
