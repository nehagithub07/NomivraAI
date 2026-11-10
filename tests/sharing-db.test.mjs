import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signProof } from "../src/lib/destinations/proof.ts";
import { shareDocument } from "../src/lib/exports/validation.ts";
import { destination } from "./destination-fixtures.mjs";
import { buildTripDatabaseSetup } from "../scripts/prepare-trip-database.mjs";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", KEY = "test-sharing-application-key-not-a-real-secret";
const hash = s => createHash("sha256").update(s).digest("hex"), epoch = () => Math.floor(Date.now() / 1000);
async function asUser(db, user, sql, args = [], role = "authenticated") {
  await db.exec("begin");
  try { await db.exec(`set local role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]); const result = await db.query(sql, args); await db.exec("commit"); return result; }
  catch (error) { await db.exec("rollback"); throw error; }
}
test("sharing SQL: signed allowlist, owner isolation, anonymous read, rotation, revocation and expiry", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; insert into auth.users values('${A}'),('${B}');`);
    const names = ["20261028000100_create_trips.sql", "20261028000200_destination_intelligence.sql", "20261028000300_open_destination_providers.sql"];
    const migrations = await Promise.all(names.map(n => readFile(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8")));
    for (const sql of migrations) await db.exec(sql);
    const sharing = await readFile(new URL("../supabase/migrations/20261106001300_trip_sharing.sql", import.meta.url), "utf8");
    const setup = buildTripDatabaseSetup(...migrations.slice(1), KEY, ...Array(8).fill(""), sharing);
    await db.exec(setup); await db.exec(setup);
    const form = { p_start_date: "2099-04-12", p_end_date: "2099-04-13", p_travelers_count: 1, p_budget_total: "1000.00", p_currency: "USD", p_budget_style: "balanced", p_travel_pace: "balanced", p_accommodation_preferences: ["hotel"], p_dietary_preferences: [], p_special_requests: "PRIVATE request never share", p_interests: ["history"], p_time_zone: "UTC" };
    const payload = JSON.stringify({ kind: "destination", user_id: A, resolved_at: epoch(), expires_at: epoch() + 180, destination });
    const tripId = (await asUser(db, A, "select public.create_resolved_trip($1::jsonb,$2,$3) id", [form, payload, signProof(payload, KEY)])).rows[0].id;
    const updatedAt = (await db.query("select updated_at::text updated_at from public.trips where id=$1", [tripId])).rows[0].updated_at;
    const options = { hotel: false, food: false, budget: false };
    const doc = { version: 1, exportedAt: new Date().toISOString(), destination: "Kyoto", startDate: form.p_start_date, endDate: form.p_end_date, days: [{ dayNumber: 1, date: form.p_start_date, theme: "Discovery", items: [{ type: "attraction", title: "Saved temple", period: "morning", latitude: 35, longitude: 135 }] }], hotel: null, food: [], budget: null, notices: [] };
    let state = null, token = randomBytes(32).toString("base64url");
    function proof(extra = {}, document = doc) {
      return { kind: "trip_share", user_id: A, trip_id: tripId, trip_updated_at: updatedAt, expires_at: epoch() + 180, request_id: randomUUID(), revision: state?.revision ?? null, options,
        token_hash: hash(token), token_cipher: "x".repeat(95), share_expires_at: new Date(Date.now() + 86400000).toISOString(), document_hash: hash(JSON.stringify(document)), ...extra };
    }
    async function create(user = A, p = proof(), document = doc) {
      const signed = JSON.stringify(p);
      return (await asUser(db, user, "select public.create_trip_share($1,$2,$3) data", [signed, signProof(signed, KEY), JSON.stringify(document)])).rows[0].data;
    }
    const read = input => asUser(db, null, "select public.get_shared_trip($1) data", [input], "anon");
    await t.test("proof and ownership checks precede publishing; no anonymous table access or writes", async () => {
      await assert.rejects(create(B, proof({ user_id: B })), /Trip not found/);
      await assert.rejects(create(B), /invalid application proof/i);
      await assert.rejects(asUser(db, null, "select * from public.trip_shares", [], "anon"), /permission denied/);
      await assert.rejects(asUser(db, A, "insert into public.trip_shares(trip_id,owner_id) values($1,$2)", [tripId, A]), /permission denied/);
      await assert.rejects(asUser(db, null, "select public.revoke_trip_share($1)", [tripId], "anon"), /permission denied/);
      const signed = JSON.stringify(proof());
      await assert.rejects(asUser(db, A, "select public.create_trip_share($1,$2,$3)", [signed, "0".repeat(64), JSON.stringify(doc)]), /Invalid application proof/);
      state = await create();
      assert.equal((await asUser(db, B, "select * from public.trip_shares")).rows.length, 0);
    });
    await t.test("anonymous capability returns only the approved snapshot; invalid tokens return null", async () => {
      assert.deepEqual((await read(token)).rows[0].data, doc);
      assert.equal((await read(randomBytes(32).toString("base64url"))).rows[0].data, null);
      assert.equal((await read("invalid token")).rows[0].data, null);
      assert.doesNotMatch(JSON.stringify((await read(token)).rows[0].data), /owner_id|trip_id|token|PRIVATE|memories|special_requests/);
    });
    await t.test("signed snapshots still reject unknown nested fields and unchecked extras", async () => {
      for (const bad of [{ ...doc, memories: ["PRIVATE"] }, { ...doc, budget: { total: "1000.00" } }, { ...doc, days: [{ ...doc.days[0], items: [{ ...doc.days[0].items[0], owner_id: A }] }] }, { ...doc, days: [{ ...doc.days[0], items: [{ ...doc.days[0].items[0], type: "hotel" }] }] }]) {
        await assert.rejects(create(A, proof({}, bad), bad), /Invalid share document/);
      }
      assert.deepEqual(shareDocument(doc, options), doc);
    });
    await t.test("creation retries are idempotent and rotation invalidates the previous token", async () => {
      const previous = token; token = randomBytes(32).toString("base64url");
      const p = proof(); state = await create(A, p);
      assert.equal((await create(A, p)).revision, state.revision);
      assert.equal((await read(previous)).rows[0].data, null);
      assert.deepEqual((await read(token)).rows[0].data, doc);
    });
    await t.test("revocation removes snapshot/cipher and rejects a stale in-flight create", async () => {
      const stale = proof();
      await assert.rejects(asUser(db, B, "select public.revoke_trip_share($1)", [tripId]), /Trip not found/);
      await asUser(db, A, "select public.revoke_trip_share($1)", [tripId]);
      assert.equal((await read(token)).rows[0].data, null);
      state = (await asUser(db, A, "select * from public.trip_shares where trip_id=$1", [tripId])).rows[0];
      assert.equal(state.snapshot, null); assert.equal(state.token_cipher, null); assert.equal(state.token_hash, null);
      await assert.rejects(create(A, stale), /SHARE_CONTEXT_CHANGED/);
      state = await create();
      await db.query("update public.trip_shares set expires_at=now()-interval '1 second' where trip_id=$1", [tripId]);
      assert.equal((await read(token)).rows[0].data, null);
      await db.query("update public.trip_shares set expires_at=now()+interval '1 day' where trip_id=$1", [tripId]);
      assert.deepEqual((await read(token)).rows[0].data, doc);
      assert.equal((await asUser(db, B, "delete from public.trips where id=$1 returning id", [tripId])).rows.length, 0);
      assert.deepEqual((await read(token)).rows[0].data, doc);
      assert.equal((await asUser(db, A, "delete from public.trips where id=$1 returning id", [tripId])).rows.length, 1);
      assert.equal((await db.query("select * from public.trip_shares")).rows.length, 0);
      assert.equal((await read(token)).rows[0].data, null);
    });
  } finally { await db.close(); }
});
