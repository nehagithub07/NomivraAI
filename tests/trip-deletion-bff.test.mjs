import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const ownTrip = "33333333-3333-4333-8333-333333333333";
const otherTrip = "44444444-4444-4444-8444-444444444444";

function setup({ anonymous = false, failure = null } = {}) {
  const state = { records: [{ id: ownTrip, owner_id: owner }, { id: otherTrip, owner_id: other }], writes: 0, revalidated: [] };
  const db = { from(table) {
    assert.equal(table, "trips");
    const filters = [];
    const query = {
      delete() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      select(columns) { assert.equal(columns, "id"); return query; },
      async maybeSingle() {
        state.writes++;
        if (failure instanceof Error) throw failure;
        if (failure) return { data: null, error: failure };
        const row = state.records.find(row => filters.every(([key, value]) => row[key] === value));
        if (row) state.records = state.records.filter(candidate => candidate !== row);
        return { data: row ? { id: row.id } : null, error: null };
      },
    };
    return query;
  } };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    function local(name) {
      if (name === "server-only") return {};
      if (name === "next/cache") return { revalidatePath: pathname => state.revalidated.push(pathname) };
      if (name === "@/lib/auth/session") return { getCurrentUser: async () => anonymous ? null : { id: owner } };
      if (name === "@/lib/supabase/server") return { createClient: async () => db };
      if (name.startsWith("@/")) return load(path.resolve("src", name.slice(2) + ".ts"));
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name + ".ts"));
      return require(name);
    }
    new Function("require", "module", "exports", code)(local, loaded, loaded.exports);
    return loaded.exports;
  }
  const route = load(path.resolve("src/app/api/trips/[tripId]/route.ts"));
  const remove = (id = ownTrip, { body = "{}", origin = "https://nomvira.test", type = "application/json" } = {}) => route.DELETE(
    new Request(`https://nomvira.test/api/trips/${id}`, { method: "DELETE", headers: { origin, "content-type": type }, body }),
    { params: Promise.resolve({ tripId: id }) },
  );
  return { state, remove };
}

test("trip deletion removes exactly the owned trip and refreshes list/dashboard data", async () => {
  const { state, remove } = setup();
  const response = await remove();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(state.records, [{ id: otherTrip, owner_id: other }]);
  assert.deepEqual(state.revalidated, ["/trips", "/"]);
  assert.equal((await remove()).status, 404);
});

test("foreign and unknown trips have the same response and preserve all records", async () => {
  const { state, remove } = setup();
  const foreign = await remove(otherTrip);
  const unknown = await remove("55555555-5555-4555-8555-555555555555");
  assert.equal(foreign.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await foreign.json(), await unknown.json());
  assert.equal(state.records.length, 2);
  assert.deepEqual(state.revalidated, []);
});

test("unauthenticated, cross-origin and invalid requests never reach deletion", async () => {
  const anonymous = setup({ anonymous: true });
  assert.equal((await anonymous.remove()).status, 401);
  assert.equal(anonymous.state.writes, 0);
  const { state, remove } = setup();
  assert.equal((await remove(ownTrip, { origin: "https://untrusted.example" })).status, 403);
  assert.equal((await remove("not-a-uuid")).status, 422);
  assert.equal((await remove(ownTrip, { body: JSON.stringify({ owner_id: other }) })).status, 422);
  assert.equal((await remove(ownTrip, { type: "text/plain" })).status, 415);
  assert.equal((await remove(ownTrip, { body: "invalid json" })).status, 400);
  assert.equal((await remove(ownTrip, { body: " ".repeat(4097) })).status, 413);
  assert.equal(state.writes, 0);
  assert.equal(state.records.length, 2);
});

test("database and network failures remain private and never claim successful deletion", async () => {
  for (const failure of [{ code: "42501", message: "PRIVATE DATABASE DETAIL" }, new Error("PRIVATE NETWORK DETAIL")]) {
    const { state, remove } = setup({ failure });
    const response = await remove();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /PRIVATE/);
    assert.equal(state.records.length, 2);
    assert.deepEqual(state.revalidated, []);
  }
});
