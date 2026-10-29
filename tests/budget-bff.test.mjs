import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { itineraryTrip } from "./itinerary-fixtures.mjs";
import { accommodationContext } from "../src/lib/accommodations/context.ts";

const require = createRequire(import.meta.url), KEY = "test-internal-application-key-never-real";
const root = "src/app/api/trips/[tripId]/budget";
const body = () => ({ id: randomUUID(), category: "transport", entry_type: "planned", description: "Airport train", amount: "28.00", currency: "USD", expense_date: null });
function load(file, adapters = {}) {
  const cache = new Map();
  function moduleAt(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    function localRequire(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/auth/session") return { getCurrentUser: async () => adapters.user === null ? null : { id: itineraryTrip.owner_id } };
      if (name === "@/lib/supabase/server") return { createClient: async () => adapters.db };
      if (name === "@/lib/accommodations/server") return { getStaySelection: async () => adapters.selection ?? null, getCachedHotels: () => adapters.hotels ?? null };
      if (name.startsWith("@/")) return moduleAt(path.resolve("src", `${name.slice(2)}.ts`));
      if (name.startsWith(".")) return moduleAt(path.resolve(path.dirname(filename), `${name}.ts`));
      return require(name);
    }
    new Function("require", "module", "exports", code)(localRequire, loaded, loaded.exports);
    return loaded.exports;
  }
  return moduleAt(path.resolve(file));
}
function configure(t) {
  for (const [key, value] of Object.entries({ NOMVIRA_INTERNAL_API_KEY: KEY, NOMVIRA_API_URL: "http://backend.test:8000" })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
function database() {
  const state = { trip: structuredClone(itineraryTrip), rows: [], writes: [], filters: [], error: null };
  const db = { from(table) {
    const filters = {}; let action = "read", values;
    const q = {
      select() { return this; }, eq(key, value) { filters[key] = value; state.filters.push([table, key, value]); return this; },
      order() { return this; }, limit() { return Promise.resolve(run()); },
      insert(value) { action = "insert"; values = value; return this; },
      update(value) { action = "update"; values = value; return this; },
      delete() { action = "delete"; return this; },
      async maybeSingle() { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
      async single() { return this.maybeSingle(); },
    };
    function run() {
      if (state.error) return { data: null, error: state.error };
      if (table === "trips") return { data: state.trip, error: null };
      const existing = state.rows.find(row => Object.entries(filters).every(([key, value]) => row[key] === value));
      if (action === "insert") {
        if (state.rows.some(row => row.id === values.id)) return { data: null, error: { code: "23505" } };
        const row = { ...values, source: "manual", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        state.rows.push(row); state.writes.push([action, values]); return { data: row, error: null };
      }
      if (action !== "read") {
        if (!existing) return { data: null, error: null };
        state.writes.push([action, values]);
        if (action === "delete") state.rows = state.rows.filter(row => row !== existing);
        else Object.assign(existing, values);
        return { data: existing, error: null };
      }
      return { data: state.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)), error: null };
    }
    return q;
  } };
  return { db, state };
}
function summary() {
  const categories = ["accommodation", "food", "activities", "transport", "miscellaneous"];
  return {
    trip_id: itineraryTrip.id, currency: "USD", budget_style: "balanced", total_budget: "3000.00",
    known_costs: "0.00", planned_costs: "0.00", actual_costs: "0.00", committed_costs: "0.00",
    remaining_budget: "3000.00", actual_remaining_budget: "3000.00", percent_used: "0.00", budget_status: "healthy",
    allocations: categories.map((category, i) => ({ category, percentage: [35,25,20,12,8][i], amount: ["1050.00","750.00","600.00","360.00","240.00"][i] })),
    categories: categories.map(category => ({ category, allocated: "0.00", known: "0.00", planned: "0.00", actual: "0.00", committed: "0.00", remaining: "0.00", percent_used: "0.00" })),
    hotel: { selection_id: null, source: "hotel_selection", provider: null, amount: null, quote_expires_at: null, included: false, exclusion_reason: "unavailable" },
    unknown_costs: { food: null, activities: null }, trip_days: 3, hotel_nights: 2, remaining_days: 3,
    budget_per_traveler: "1500.00", recommended_daily_flexible_spend: "1000.00", daily_flexible_spend_per_traveler: "500.00",
    entries: [], insights: [], warnings: [],
  };
}
function request(method = "GET", data, headers = {}) {
  return new Request("http://localhost:3000/api/trips/test/budget", { method, headers: { ...(method === "GET" ? {} : { "content-type": "application/json" }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
const invoke = (handler, req, entryId = randomUUID()) => handler(req, { params: Promise.resolve({ tripId: itineraryTrip.id, entryId }) });

test("all budget BFF methods authenticate independently and check trip ownership before side effects", async t => {
  configure(t); const { db, state } = database();
  t.mock.method(globalThis, "fetch", () => assert.fail("Unauthorized requests cannot call backend"));
  for (const [file, method, data] of [["route.ts","GET"], ["entries/route.ts","POST",body()], ["entries/[entryId]/route.ts","PATCH",{ amount: "1" }], ["entries/[entryId]/route.ts","DELETE",{}]]) {
    assert.equal((await invoke(load(`${root}/${file}`, { db, user: null })[method], request(method, data))).status, 401);
    const owner = state.trip.owner_id; state.trip.owner_id = randomUUID();
    assert.equal((await invoke(load(`${root}/${file}`, { db })[method], request(method, data))).status, 404);
    state.trip.owner_id = owner;
  }
  assert.equal(state.writes.length, 0);
});
test("budget routes reject cross-origin and injected price/context/provenance", async t => {
  configure(t); const { db } = database();
  t.mock.method(globalThis, "fetch", () => assert.fail("Invalid request cannot call backend"));
  const { POST } = load(`${root}/entries/route.ts`, { db });
  assert.equal((await invoke(POST, request("POST", body(), { origin: "https://foreign.test" }))).status, 403);
  for (const patch of [{ source: "provider" }, { trip_id: randomUUID() }, { hotel: { amount: "1" } }, { amount: "-1" }]) assert.equal((await invoke(POST, request("POST", { ...body(), ...patch }))).status, 422);
});
test("summary uses only the canonical owned trip, persisted entries and matching real hotel quotes", async t => {
  configure(t); const { db, state } = database();
  const selection = { id: randomUUID(), provider: "stayapi", provider_accommodation_id: "123", search_context: accommodationContext(state.trip) };
  const hotels = { provider: "stayapi", demo: false, expires_at: "2099-04-12T12:00:00Z", candidates: [{ provider: "stayapi", provider_accommodation_id: "123", comparable_price: true, total_price: "600.00", currency: "USD" }] };
  let captured;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/v1/budget/summary"); assert.equal(options.headers["X-Nomvira-Internal-Key"], KEY);
    assert.equal(options.cache, "no-store"); captured = JSON.parse(options.body); return Response.json(summary());
  });
  const { GET } = load(`${root}/route.ts`, { db, selection, hotels });
  assert.equal((await invoke(GET, request())).status, 200);
  assert.equal(captured.budget_total, String(state.trip.budget_total));
  assert.equal(captured.travelers, state.trip.travelers_count); assert.equal(captured.hotel.amount, "600.00");
  assert.ok(!("owner_id" in captured)); assert.equal(captured.hotel.source, "hotel_selection");
  selection.search_context = {}; await invoke(GET, request()); assert.equal(captured.hotel, null);
  selection.search_context = accommodationContext(state.trip); hotels.demo = true;
  await invoke(GET, request()); assert.equal(captured.hotel.amount, null);
  assert.ok(state.filters.some(([table, key, value]) => table === "trips" && key === "owner_id" && value === itineraryTrip.owner_id));
});
test("create, edit, mark actual and remove maintain one owned row; duplicate identity returns 409", async t => {
  configure(t); const { db, state } = database(); let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; assert.equal(new URL(url).pathname, "/api/v1/budget/entries/validate");
    const data = JSON.parse(options.body); assert.equal(data.currency, state.trip.currency);
    return Response.json(data.entry);
  });
  const data = body(), { POST } = load(`${root}/entries/route.ts`, { db });
  assert.equal((await invoke(POST, request("POST", data))).status, 200);
  assert.equal(state.rows.length, 1); assert.equal(state.rows[0].source, "manual");
  assert.equal((await invoke(POST, request("POST", data))).status, 409);
  const { PATCH, DELETE } = load(`${root}/entries/[entryId]/route.ts`, { db });
  assert.equal((await invoke(PATCH, request("PATCH", { entry_type: "actual" }), data.id)).status, 200);
  assert.equal(state.rows.length, 1); assert.equal(state.rows[0].amount, "28.00"); assert.equal(state.rows[0].entry_type, "actual");
  assert.deepEqual(state.writes.at(-1)[1], { entry_type: "actual" });
  assert.equal((await invoke(PATCH, request("PATCH", { description: "Train payment", amount: "25.50" }), data.id)).status, 200);
  assert.equal(state.rows[0].amount, "25.50");
  assert.equal((await invoke(PATCH, request("PATCH", { amount: "1" }), randomUUID())).status, 404);
  const before = calls;
  assert.equal((await invoke(DELETE, request("DELETE", {}), data.id)).status, 200);
  assert.equal(calls, before); assert.equal(state.rows.length, 0);
  assert.equal((await invoke(DELETE, request("DELETE", {}), data.id)).status, 404);
});
test("currency failures, backend failures, malformed output and database errors stay safe without retries", async t => {
  configure(t);
  for (const mode of ["currency", "timeout", "malformed", "database"]) {
    const { db, state } = database(); let calls = 0;
    if (mode === "database") state.error = { code: "PRIVATE", message: "PRIVATE database details" };
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (mode === "timeout") throw new Error("PRIVATE backend details");
      if (mode === "currency") return Response.json({ error: { code: "BUDGET_CURRENCY_MISMATCH", message: "PRIVATE details" } }, { status: 422 });
      return Response.json({ PRIVATE: "bad response" });
    });
    const response = await invoke(load(`${root}/entries/route.ts`, { db }).POST, request("POST", body()));
    assert.equal(response.status, mode === "currency" ? 422 : 503); assert.ok(!(await response.text()).includes("PRIVATE"));
    assert.equal(state.writes.length, 0); assert.equal(calls, mode === "database" ? 0 : 1);
  }
});
