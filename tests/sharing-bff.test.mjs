import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { itineraryTrip } from "./itinerary-fixtures.mjs";
import { exportDocument } from "./export-fixtures.mjs";
import { verifyProof } from "../src/lib/destinations/proof.ts";

const require = createRequire(import.meta.url), KEY = "test-sharing-application-key-not-a-real-secret";
const owner = itineraryTrip.owner_id, tripId = itineraryTrip.id;
function load(file, adapter = {}) {
  const cache = new Map();
  function at(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    function local(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/auth/session") return { getCurrentUser: async () => adapter.anonymous ? null : { id: owner } };
      if (name === "@/lib/supabase/server") return { createClient: async () => adapter.db };
      if (name === "@/lib/supabase/config") return { getSiteOrigin: () => "https://nomvira.test", getSupabaseConfig: () => ({ url: "https://supabase.test", key: "sb_publishable_test" }) };
      if (name === "@/lib/supabase/fetch") return { supabaseFetch: globalThis.fetch };
      if (name === "@supabase/supabase-js") return { createClient: (...args) => { adapter.onAnonymous?.(...args); return adapter.db; } };
      if (name === "@/lib/exports/server") return { buildExportDocument: async () => { adapter.onExport?.(); return structuredClone(exportDocument); } };
      if (name === "@/lib/itineraries/server") return {
        loadOwnedItineraryTrip: async (_db, id, userId) => {
          if (id !== tripId || userId !== owner || adapter.foreign) {
            const { TravelError } = at(path.resolve("src/lib/destinations/backend.ts"));
            throw new TravelError("not_found", "Trip not found.", 404);
          }
          return itineraryTrip;
        }, getItinerary: async () => adapter.itinerary ?? null,
      };
      if (name === "@/lib/accommodations/server") return { getStaySelection: async () => adapter.stay ?? null, getCachedHotels: () => null };
      if (name === "@/lib/food/server") return { getFoodSelections: async () => { if (adapter.foodError) throw Error("private database details"); return adapter.food ?? []; } };
      if (name === "@/lib/budget/server") return { getBudgetSummary: async () => { if (adapter.budgetError) throw Error("private provider details"); return adapter.budget ?? { planned_costs: "123.45", actual_costs: "56.78", remaining_budget: "901.23" }; } };
      if (name.startsWith("@/")) return at(path.resolve("src", `${name.slice(2)}.ts`));
      if (name.startsWith(".")) return at(path.resolve(path.dirname(filename), name.endsWith(".ts") ? name : `${name}.ts`));
      return require(name);
    }
    new Function("require", "module", "exports", code)(local, loaded, loaded.exports);
    return loaded.exports;
  }
  return at(path.resolve(file));
}
function database() {
  const state = { share: null, unavailable: false, writes: 0, publicDocument: exportDocument };
  const db = {
    from() {
      const filters = [];
      const query = { select() { return query; }, eq(k, v) { filters.push([k, v]); return query; }, async maybeSingle() { return { data: state.share && filters.every(([k, v]) => state.share[k] === v) ? state.share : null, error: state.unavailable ? { code: "42P01" } : null }; } };
      return query;
    },
    rpc(name, args) {
      const result = async () => {
        if (state.unavailable) return { data: null, error: { code: "42P01", message: "PRIVATE detail" } };
        if (name === "get_shared_trip") return { data: state.publicDocument, error: null };
        state.writes++;
        if (name === "create_trip_share") {
          assert.ok(verifyProof(args.p_payload, args.p_signature, KEY));
          const proof = JSON.parse(args.p_payload);
          assert.equal(proof.user_id, owner); assert.equal(proof.trip_id, tripId);
          assert.equal(proof.document_hash, createHash("sha256").update(args.p_document).digest("hex"));
          assert.doesNotMatch(args.p_document, /owner_id|trip_id|candidate_id|special_requests|Selected hotel|Saved cafe|1000\.00/);
          state.share = { trip_id: tripId, owner_id: owner, request_id: proof.request_id, revision: randomUUID(), token_hash: proof.token_hash, token_cipher: proof.token_cipher, expires_at: proof.share_expires_at, options: proof.options };
        }
        if (name === "revoke_trip_share") state.share = { trip_id: tripId, owner_id: owner, revision: randomUUID(), request_id: null, token_hash: null, token_cipher: null, expires_at: null };
        return { data: state.share, error: null };
      };
      const promise = result(); promise.abortSignal = () => promise; return promise;
    },
  };
  return { db, state };
}
function configure(t) { const old = process.env.NOMVIRA_INTERNAL_API_KEY; process.env.NOMVIRA_INTERNAL_API_KEY = KEY; t.after(() => old === undefined ? delete process.env.NOMVIRA_INTERNAL_API_KEY : process.env.NOMVIRA_INTERNAL_API_KEY = old); }
const context = { params: Promise.resolve({ tripId }) };
const command = () => ({ action: "create", requestId: randomUUID(), revision: null, expiresInDays: "7", options: { hotel: false, food: false, budget: false }, approved: true });
const request = (body, headers = {}) => new Request(`https://nomvira.test/api/trips/${tripId}/share`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("export/share routes authenticate, enforce ownership, origin, limits and explicit approval", async () => {
  const { db } = database();
  const share = load("src/app/api/trips/[tripId]/share/route.ts", { db });
  const anon = load("src/app/api/trips/[tripId]/share/route.ts", { db, anonymous: true });
  assert.equal((await anon.POST(request(command()), context)).status, 401);
  assert.equal((await share.POST(request(command(), { Origin: "https://foreign.test" }), context)).status, 403);
  assert.equal((await share.POST(request({ ...command(), approved: false }), context)).status, 422);
  assert.equal((await share.POST(request({ ...command(), snapshot: { private: true } }), context)).status, 422);
  assert.equal((await share.POST(request({ ...command(), expiresInDays: "365" }), context)).status, 422);
  assert.equal((await share.POST(request({ content: "x".repeat(5000) }), context)).status, 413);
  const foreign = load("src/app/api/trips/[tripId]/share/route.ts", { db, foreign: true });
  assert.equal((await foreign.POST(request(command()), context)).status, 404);
  for (const anonymous of [true, false]) {
    const route = load("src/app/api/trips/[tripId]/export/route.ts", { db, anonymous, foreign: true });
    assert.equal((await route.GET(new Request("https://nomvira.test/api/trips/trip/export"), context)).status, anonymous ? 401 : 404);
  }
});

test("owner creates/copies/revokes a link; duplicate submission creates no new snapshot", async t => {
  configure(t); const { db, state } = database(); let exports = 0;
  const route = load("src/app/api/trips/[tripId]/share/route.ts", { db, onExport: () => exports++ });
  const body = command();
  const first = await route.POST(request(body), context).then(r => r.json());
  assert.equal(first.active, true); assert.match(first.url, /^https:\/\/nomvira.test\/share\/[\w-]{43}$/);
  const second = await route.POST(request(body), context).then(r => r.json());
  assert.equal(second.url, first.url); assert.equal(exports, 1); assert.equal(state.writes, 1);
  const read = await route.GET(new Request("https://nomvira.test/api/trips/trip/share"), context).then(r => r.json());
  assert.equal(read.url, first.url);
  assert.deepEqual(read.options, body.options);
  state.share.options = { hotel: true, food: false, budget: true };
  const restored = await route.GET(new Request("https://nomvira.test/api/trips/trip/share"), context).then(r => r.json());
  assert.deepEqual(restored.options, state.share.options);
  assert.equal((await route.POST(request({ action: "revoke" }), context)).status, 200);
  assert.equal(state.share.token_cipher, null);
});

test("token encryption is bound to the trip and rejects tampering", t => {
  configure(t); const tokens = load("src/lib/sharing/tokens.ts");
  const token = "a".repeat(43), sealed = tokens.sealShareToken(token, tripId);
  assert.equal(tokens.openShareToken(sealed, tripId), token);
  assert.notEqual(sealed, token); assert.notEqual(tokens.shareTokenHash(token), token);
  assert.throws(() => tokens.openShareToken(sealed, randomUUID()));
  const tampered = Buffer.from(sealed, "base64url"); tampered[0] ^= 1;
  assert.throws(() => tokens.openShareToken(tampered.toString("base64url"), tripId));
});

test("public capability uses a cookie-free anonymous client and rejects private fields", async () => {
  const { db, state } = database(); let clients = 0;
  const service = load("src/lib/sharing/server.ts", { db, onAnonymous: (_url, key, options) => { clients++; assert.equal(key, "sb_publishable_test"); assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false); assert.equal(options.global.headers, undefined); } });
  assert.equal(await service.getSharedTrip("invalid"), null); assert.equal(clients, 0);
  assert.deepEqual(await service.getSharedTrip("a".repeat(43)), exportDocument);
  state.publicDocument = { ...exportDocument, memories: ["PRIVATE"] };
  await assert.rejects(service.getSharedTrip("a".repeat(43)));
  state.publicDocument = null; assert.equal(await service.getSharedTrip("a".repeat(43)), null);
  state.unavailable = true; await assert.rejects(service.getSharedTrip("a".repeat(43)), /temporarily unavailable/);
});

test("export falls back without inventing provider facts and preserves budget engine totals", async () => {
  const adapter = { foodError: true, budgetError: true };
  let service = load("src/lib/exports/server.ts", adapter);
  const fallback = await service.buildExportDocument({}, itineraryTrip);
  assert.deepEqual(fallback.days, []); assert.deepEqual(fallback.food, []); assert.equal(fallback.hotel, null);
  assert.equal(fallback.budget.total, String(itineraryTrip.budget_total)); assert.equal(fallback.budget.remaining, null);
  assert.ok(fallback.notices.includes("budget_unavailable")); assert.doesNotMatch(JSON.stringify(fallback), /PRIVATE|special_requests|owner_id/);
  service = load("src/lib/exports/server.ts", { itinerary: { demo: true }, food: [{ provider: "fixture", name: "FAKE venue", category: "cafe" }] });
  const data = await service.buildExportDocument({}, itineraryTrip);
  assert.equal(data.budget.planned, "123.45"); assert.equal(data.budget.actual, "56.78"); assert.equal(data.budget.remaining, "901.23");
  assert.deepEqual(data.days, []); assert.deepEqual(data.food, []); assert.ok(data.notices.includes("demo_excluded"));
  service = load("src/lib/exports/server.ts", { food: Array.from({ length: 51 }, (_, i) => ({ provider: "geoapify", name: `Saved food ${i}`, category: "cafe" })) });
  const bounded = await service.buildExportDocument({}, itineraryTrip);
  assert.equal(bounded.food.length, 50); assert.equal(bounded.food[49].name, "Saved food 49");
});
