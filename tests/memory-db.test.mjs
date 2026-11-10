import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { defaultPreferences } from "../src/lib/memory/validation.ts";
import { buildTripDatabaseSetup } from "../scripts/prepare-trip-database.mjs";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const embedding = JSON.stringify([1, ...Array(767).fill(0)]);
const unrelated = JSON.stringify([0, 1, ...Array(766).fill(0)]);
async function asUser(db, user, operation, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
    const result = await operation(); await db.exec("commit"); return result;
  } catch (error) { await db.exec("rollback"); throw error; }
}

test("memory SQL: persistence, consent, pgvector ownership, deletion and bounded indexing", async t => {
  const db = new PGlite({ extensions: { pgcrypto, vector } });
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated;
      insert into auth.users values('${A}'),('${B}');`);
    // Use the existing trip contract and policies, plus the unmodified pgvector migration.
    await db.exec(await readFile(new URL("../supabase/migrations/20261028000100_create_trips.sql", import.meta.url), "utf8"));
    await db.exec("create schema if not exists extensions; grant usage on schema extensions to authenticated");
    await db.exec(await readFile(new URL("../supabase/migrations/20261106001200_personalization_memory.sql", import.meta.url), "utf8"));
    const query = (user, sql, args = [], role) => asUser(db, user, () => db.query(sql, args), role);
    const prefs = { ...defaultPreferences, interests: ["nature"], dietaryPreferences: ["vegetarian"] };
    const saveProfile = (user, enabled = true) => query(user, "select public.update_travel_preferences($1::jsonb,$2)", [prefs, enabled]);
    const save = async (user, kind = "preference", feedback = "prefer", p = prefs, trip = null) => (await query(user, "select public.save_travel_memory($1,$2::jsonb,$3,$4) id", [kind, p, feedback, trip])).rows[0].id;
    const index = (user, id, content, values = embedding) => query(user, "select public.index_travel_memory($1,$2,$3::extensions.vector)", [id, content, values]);
    const match = (user, limit = 5, values = embedding) => query(user, "select * from public.match_travel_memories($1::extensions.vector,$2)", [values, limit]);
    let id, content;
    await t.test("explicit consent, closed vocabulary and preference persistence", async () => {
      await assert.rejects(save(A), /consent required/);
      await assert.rejects(query(null, "select public.update_travel_preferences($1::jsonb,true)", [prefs], "anon"), /permission denied/);
      await saveProfile(A); await saveProfile(B);
      assert.deepEqual((await query(A, "select preferences from public.travel_preferences")).rows[0].preferences, prefs);
      assert.equal((await query(B, "select * from public.travel_preferences where user_id=$1", [A])).rows.length, 0);
      for (const invalid of [{ ...prefs, api_key: "secret" }, { ...prefs, travelPace: "secret" }, { ...prefs, interests: ["nature", "nature"] }, { ...prefs, travelPace: null }]) {
        await assert.rejects(query(A, "select public.update_travel_preferences($1::jsonb,true)", [invalid]), /Invalid preferences/);
      }
      await assert.rejects(query(A, "insert into public.travel_preferences(user_id,preferences) values($1,$2)", [A, prefs]), /permission denied/);
      id = await save(A); assert.equal(await save(A), id); // exact snapshot deduplication
      content = (await query(A, "select content from public.travel_memories where id=$1", [id])).rows[0].content;
    });
    await t.test("index leases prevent repeated calls and stale writes; vectors stay owner scoped", async () => {
      assert.equal((await query(A, "select * from public.claim_travel_memory_index()" )).rows.length, 1);
      assert.equal((await query(A, "select * from public.claim_travel_memory_index()" )).rows.length, 0);
      assert.equal((await query(B, "select * from public.claim_travel_memory_index($1)", [id])).rows.length, 0);
      await index(B, id, content);
      assert.equal((await match(A)).rows.length, 0);
      await index(A, id, "stale content"); assert.equal((await match(A)).rows.length, 0);
      await index(A, id, content);
      assert.equal((await match(A)).rows[0].id, id);
      assert.equal((await match(B)).rows.length, 0);
      assert.equal((await match(A, 5, unrelated)).rows.length, 0);
      await assert.rejects(query(null, "select * from public.match_travel_memories($1::extensions.vector,5)", [embedding], "anon"), /permission denied/);
      await assert.rejects(index(A, id, content, "[1,2]"), /Invalid embedding/);
    });
    await t.test("trip memory verifies ownership, reads actual saved choices and excludes sensitive text", async () => {
      const tripId = randomUUID();
      await db.query(`insert into public.trips(id,owner_id,destination_name,start_date,end_date,travelers_count,budget_total,currency,budget_style,travel_pace,accommodation_preferences,dietary_preferences,special_requests)
        values($1,$2,'Private location','2099-04-12','2099-04-13',1,100,'USD','balanced','relaxed',array['hotel'],array['vegan'],'secret conversation or API key')`, [tripId, A]);
      await db.query("insert into public.trip_interests(trip_id,interest) values($1,'nature')", [tripId]);
      await assert.rejects(save(B, "trip", "prefer", prefs, tripId), /Trip not found/);
      const tripMemory = await save(A, "trip", "prefer", prefs, tripId);
      const row = (await query(A, "select * from public.travel_memories where id=$1", [tripMemory])).rows[0];
      assert.equal(row.preferences.travelPace, "relaxed");
      assert.deepEqual(row.preferences.dietaryPreferences, ["vegan"]);
      assert.doesNotMatch(row.content, /Private location|secret conversation|API key|2099/);
      assert.equal((await query(B, "delete from public.trips where id=$1 returning id", [tripId])).rows.length, 0);
      assert.equal((await query(A, "select id from public.travel_memories where id=$1", [tripMemory])).rows.length, 1);
      assert.equal((await query(A, "delete from public.trips where id=$1 returning id", [tripId])).rows.length, 1);
      assert.equal((await query(A, "select * from public.travel_memories where id=$1", [tripMemory])).rows.length, 0);
      assert.equal((await query(A, "select user_id from public.travel_preferences")).rows.length, 1);
    });
    await t.test("retrieval returns no more than five and deleted records cannot be resurrected", async () => {
      for (let i = 0; i < 6; i++) {
        const memoryId = await save(A, "feedback", i % 2 ? "avoid" : "prefer", { ...prefs, interests: [["food"], ["art"], ["history"], ["culture"], ["shopping"], ["beaches"]][i] });
        const doc = (await query(A, "select content from public.travel_memories where id=$1", [memoryId])).rows[0].content;
        await index(A, memoryId, doc);
      }
      assert.equal((await match(A, 1000)).rows.length, 5);
      assert.equal((await query(A, "select * from public.claim_travel_memory_index()" )).rows.length, 0);
      await query(B, "select public.delete_travel_memory($1)", [id]);
      assert.equal((await query(A, "select id from public.travel_memories where id=$1", [id])).rows.length, 1);
      await query(A, "select public.delete_travel_memory($1)", [id]);
      await index(A, id, content);
      assert.equal((await query(A, "select id from public.travel_memories where id=$1", [id])).rows.length, 0);
      await saveProfile(A, false); await index(A, id, content);
      assert.equal((await match(A)).rows.length, 0);
      assert.equal((await query(A, "select * from public.travel_memories")).rows.length, 0);
      assert.deepEqual((await query(A, "select preferences from public.travel_preferences")).rows[0].preferences, prefs);
      await query(A, "select public.delete_travel_memory(null,true)");
      assert.equal((await query(A, "select * from public.travel_preferences")).rows.length, 0);
      assert.equal((await query(B, "select * from public.travel_preferences")).rows.length, 1);
    });
  } finally { await db.close(); }
});

test("database preparation installs Step 14 atomically and is safe to rerun", async () => {
  const db = new PGlite({ extensions: { pgcrypto, vector } });
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated;`);
    const names = ["20261028000100_create_trips.sql", "20261028000200_destination_intelligence.sql", "20261028000300_open_destination_providers.sql"];
    const migrations = await Promise.all(names.map(n => readFile(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8")));
    for (const sql of migrations) await db.exec(sql);
    const memory = await readFile(new URL("../supabase/migrations/20261106001200_personalization_memory.sql", import.meta.url), "utf8");
    const sql = buildTripDatabaseSetup(...migrations.slice(1), "test-memory-internal-key-not-a-real-secret", ...Array(7).fill(""), memory);
    await db.exec(sql); await db.exec(sql);
    assert.equal((await db.query("select to_regclass('public.travel_memories')::text name")).rows[0].name, "travel_memories");
    assert.equal((await db.query("select count(*)::int n from public.travel_preferences")).rows[0].n, 0);
  } finally { await db.close(); }
});
