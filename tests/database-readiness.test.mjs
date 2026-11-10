import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("readiness SQL reports missing and protected objects without reading private records", async () => {
  const db = new PGlite();
  try {
    const sql = await readFile(new URL("../supabase/diagnostics/readiness.sql", import.meta.url), "utf8");
    const missing = await db.exec(sql);
    assert.equal(missing[0].rows.length, 13);
    assert(missing[0].rows.every(row => !row.table_present && !row.rls_enabled));
    assert(missing[1].rows.every(row => !row.function_present));
    await db.exec(`
      create role anon;
      create table public.trip_shares(private_payload text);
      insert into public.trip_shares values('NEVER_REPORT_PRIVATE_PAYLOAD');
      alter table public.trip_shares enable row level security;
      create policy test_policy on public.trip_shares for select using(false);
      create function public.get_shared_trip(text) returns jsonb language sql as $$ select null::jsonb $$;
      create function public.save_travel_memory(text) returns void language sql as $$ select $$;
      revoke all on function public.save_travel_memory(text) from public, anon;
    `);
    const present = await db.exec(sql);
    const share = present[0].rows.find(row => row.table_name === "trip_shares");
    assert(share.table_present && share.rls_enabled && share.policy_present);
    assert.equal(present[1].rows.find(row => row.function_name === "get_shared_trip").anonymous_execute, true);
    assert.equal(present[1].rows.find(row => row.function_name === "save_travel_memory").anonymous_execute, false);
    assert(!JSON.stringify(present).includes("NEVER_REPORT_PRIVATE_PAYLOAD"));
    assert.equal((await db.query("select count(*)::int n from trip_shares")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
