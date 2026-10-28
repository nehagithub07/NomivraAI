import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { buildTripDatabaseSetup } from "../scripts/prepare-trip-database.mjs";
import { signProof } from "../src/lib/destinations/proof.ts";
import { destination } from "./destination-fixtures.mjs";

const userId = "00000000-0000-4000-8000-000000000001", key = "test-internal-application-key-never-real";
const files = ["20261028000100_create_trips.sql", "20261028000200_destination_intelligence.sql", "20261028000300_open_destination_providers.sql", "20261028000400_accommodation_selections.sql"];
const migrations = await Promise.all(files.map(name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")));

for (const installed of [1, 2, 3, 4]) test(`prepared database setup upgrades stage ${installed}, saves a signed trip and is safe to rerun`, async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      insert into auth.users values ('${userId}');`);
    for (let index = 0; index < installed; index++) await db.exec(migrations[index]);
    const setup = buildTripDatabaseSetup(migrations[1], migrations[2], key, migrations[3]);
    await db.exec(setup);
    assert.equal((await db.query("select to_regclass('public.trip_accommodation_selections')::text as name")).rows[0].name, "trip_accommodation_selections");
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ kind: "destination", user_id: userId, resolved_at: now, expires_at: now + 3600, destination });
    const form = { p_destination_name: "Tokyo", p_start_date: "2099-04-12", p_end_date: "2099-04-18", p_travelers_count: 1, p_budget_total: "2500.50", p_currency: "USD", p_budget_style: "balanced", p_travel_pace: "balanced", p_accommodation_preferences: ["hotel"], p_dietary_preferences: [], p_special_requests: null, p_interests: ["culture"], p_time_zone: "UTC" };
    await db.exec("begin;set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const result = await db.query("select public.create_resolved_trip($1::jsonb,$2,$3) as id", [form, payload, signProof(payload, key)]);
    await db.exec("commit");
    assert.ok(result.rows[0].id);
    await db.exec(setup);
    const row = (await db.query("select destination_provider, destination_provider_id from public.trips where id=$1", [result.rows[0].id])).rows[0];
    assert.deepEqual(row, { destination_provider: "open_meteo", destination_provider_id: "1850147" });
    assert.equal((await db.query("select count(*)::int n from public.trip_interests")).rows[0].n, 1);
  } finally { await db.close(); }
});
