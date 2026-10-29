import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
async function asUser(db, user, run, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || ""]);
    const result = await run(); await db.exec("commit"); return result;
  } catch (error) { await db.exec("rollback"); throw error; }
}
test("budget migration enforces owned CRUD, precise currency-safe expenses and immutable provenance", async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      insert into auth.users values ('${A}'),('${B}');`);
    for (const file of ["20261028000100_create_trips.sql", "20261029000700_trip_budget_entries.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    const trip = (await db.query(`insert into public.trips(owner_id,destination_name,start_date,end_date,travelers_count,budget_total,currency)
      values ($1,'Tokyo','2099-04-12','2099-04-14',2,3000,'USD') returning id`, [A])).rows[0].id;
    const id = randomUUID();
    const insert = (amount = "28.00", currency = "USD", user = A, identity = id) => asUser(db, user, () => db.query(`insert into public.trip_budget_entries(id,trip_id,category,entry_type,description,amount,currency)
      values ($1,$2,'transport','planned','Airport train',$3,$4) returning *`, [identity, trip, amount, currency]));
    await t.test("owner creates and reads exact decimal values, duplicate identity is rejected", async () => {
      const created = (await insert()).rows[0];
      assert.equal(String(created.amount), "28.00"); assert.equal(created.source, "manual");
      await assert.rejects(insert(), /duplicate key/);
      assert.equal((await asUser(db, A, () => db.query("select * from public.trip_budget_entries"))).rows.length, 1);
    });
    await t.test("anonymous and other owners cannot read or mutate expenses", async () => {
      assert.equal((await asUser(db, B, () => db.query("select * from public.trip_budget_entries"))).rows.length, 0);
      assert.equal((await asUser(db, B, () => db.query("update public.trip_budget_entries set amount=500 where id=$1 returning id", [id]))).rows.length, 0);
      assert.equal((await asUser(db, B, () => db.query("delete from public.trip_budget_entries where id=$1 returning id", [id]))).rows.length, 0);
      await assert.rejects(insert("1", "USD", B, randomUUID()), /BUDGET_TRIP_NOT_FOUND|row-level security/);
      await assert.rejects(asUser(db, null, () => db.query("select * from public.trip_budget_entries"), "anon"), /permission denied/);
    });
    await t.test("database rejects foreign currency, excess decimals, negative and forged source", async () => {
      for (const amount of ["-0.01", "1.001", "100000001", "NaN"]) await assert.rejects(insert(amount, "USD", A, randomUUID()), /check constraint/);
      await assert.rejects(insert("12", "EUR", A, randomUUID()), /BUDGET_CURRENCY_MISMATCH/);
      await assert.rejects(asUser(db, A, () => db.query("update public.trip_budget_entries set source='hotel_selection' where id=$1", [id])), /permission denied/);
      await assert.rejects(asUser(db, A, () => db.query("update public.trip_budget_entries set trip_id=$1 where id=$2", [randomUUID(), id])), /permission denied/);
      await assert.rejects(asUser(db, A, () => db.query("update public.trip_budget_entries set expense_date='1899-12-31' where id=$1", [id])), /check constraint/);
      await assert.rejects(asUser(db, A, () => db.query("update public.trips set currency='EUR' where id=$1", [trip])), /BUDGET_CURRENCY_HAS_ENTRIES/);
      assert.equal((await db.query("select currency from public.trips where id=$1", [trip])).rows[0].currency, "USD");
    });
    await t.test("mark actual updates one record instead of duplicating its cost; zero is valid", async () => {
      await asUser(db, A, () => db.query("update public.trip_budget_entries set entry_type='actual',amount=0 where id=$1", [id]));
      const rows = (await asUser(db, A, () => db.query("select * from public.trip_budget_entries"))).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].entry_type, "actual"); assert.equal(Number(rows[0].amount), 0);
    });
    await t.test("entry count is bounded in PostgreSQL and cascades with its trip", async () => {
      await asUser(db, A, () => db.query(`insert into public.trip_budget_entries(trip_id,category,entry_type,description,amount,currency)
        select $1,'food','planned','Food allowance',0.10,'USD' from generate_series(1,999)`, [trip]));
      await assert.rejects(insert("1", "USD", A, randomUUID()), /BUDGET_ENTRY_LIMIT/);
      await asUser(db, A, () => db.query("delete from public.trip_budget_entries where id=$1", [id]));
      assert.equal((await db.query("select count(*)::int n from public.trip_budget_entries")).rows[0].n, 999);
      await asUser(db, A, () => db.query("delete from public.trips where id=$1", [trip]));
      assert.equal((await db.query("select count(*)::int n from public.trip_budget_entries")).rows[0].n, 0);
    });
  } finally { await db.close(); }
});
