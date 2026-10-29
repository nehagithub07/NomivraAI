import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
function load(file, adapters = {}) {
  const cache = new Map();
  function moduleAt(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
      if (name === "server-only") return {};
      if (name === "next/cache") return { revalidatePath() {} };
      if (name === "next/headers") return { headers: async () => new Headers(), cookies: async () => ({ set() {} }) };
      if (name === "next/navigation") return { redirect: target => { throw Object.assign(new Error("TEST_REDIRECT"), { target }); } };
      if (name === "@/lib/supabase/config" || (name === "./config" && filename.endsWith("proxy.ts"))) return { getSupabaseConfig: () => adapters.configured === false ? null : ({ url: "https://test.supabase.co", key: "sb_publishable_test" }), getSiteOrigin: () => "http://localhost:3000" };
      if (name === "@/lib/supabase/server") return { createClient: async options => { adapters.onClient?.(options); if (adapters.clientFailure) throw adapters.clientFailure; return { auth: {
        getUser: async () => ({ data: { user: adapters.user || null }, error: adapters.error || null }),
        signInWithPassword: async credentials => { adapters.onCredentials?.(credentials); return { error: adapters.error || null }; },
      } }; } };
      if (name === "@supabase/ssr") return { createServerClient: (_url, _key, options) => ({ auth: { getUser: async () => {
        if (adapters.refreshedCookies) options.cookies.setAll(adapters.refreshedCookies, { "Cache-Control": "private, no-store" });
        return { data: { user: adapters.user || null }, error: adapters.error || null };
      } } }) };
      if (name.startsWith("@/")) return moduleAt(path.resolve("src", `${name.slice(2)}.ts`));
      if (name.startsWith(".")) return moduleAt(path.resolve(path.dirname(filename), name.endsWith(".ts") ? name : `${name}.ts`));
      return require(name);
    };
    new Function("require", "module", "exports", source)(localRequire, loaded, loaded.exports);
    return loaded.exports;
  }
  return moduleAt(path.resolve(file));
}
const form = () => { const data = new FormData(); data.set("email", "test@example.com"); data.set("password", "synthetic-test-password"); return data; };
const networkError = { name: "AuthRetryableFetchError", status: 0, message: "PRIVATE network details with a token" };

test("sign-in returns a connection error for an unreachable auth service without mislabeling credentials", async () => {
  let received;
  const { signIn } = load("src/lib/auth/actions.ts", { error: networkError, onCredentials: value => { received = value; } });
  const result = await signIn({}, form());
  assert.equal(result.status, "error"); assert.match(result.message, /connect to sign-in/);
  assert.equal(result.message.includes("PRIVATE"), false);
  assert.equal(received.email, "test@example.com");
});

test("invalid credentials and provider rate limits retain their original sign-in handling", async () => {
  for (const [error, pattern] of [[{ name: "AuthApiError", code: "invalid_credentials", status: 400 }, /Email or password is incorrect/], [{ name: "AuthApiError", status: 429 }, /Too many attempts/]]) {
    const result = await load("src/lib/auth/actions.ts", { error }).signIn({}, form());
    assert.equal(result.status, "error"); assert.match(result.message, pattern);
  }
});

test("transient getUser failure stays unauthenticated and logs safe diagnostics without a console exception", async t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  t.mock.method(console, "error", () => assert.fail("Handled network failures must not produce a console error overlay"));
  const { getCurrentUser } = load("src/lib/auth/session.ts", { error: networkError, onClient: options => assert.equal(options.writable, true) });
  assert.equal(await getCurrentUser(true), null);
  assert.deepEqual(warnings, [["[auth] user_verification_unavailable", { reason: "connection_failed", status: 0 }]]);
  assert.ok(!JSON.stringify(warnings).includes("PRIVATE"));
});

test("an ordinary missing session is quiet, and verified users remain unchanged", async t => {
  t.mock.method(console, "warn", () => assert.fail("Missing sessions should not log a service failure"));
  assert.equal(await load("src/lib/auth/session.ts", { error: { name: "AuthSessionMissingError", status: 400 } }).getCurrentUser(), null);
  const user = { id: "00000000-0000-4000-8000-000000000001" };
  assert.equal(await load("src/lib/auth/session.ts", { user }).getCurrentUser(), user);
});

test("API verification distinguishes an auth service outage from a missing or invalid session", async t => {
  t.mock.method(console, "warn", () => {});
  for (const error of [networkError, { name: "AuthApiError", status: 503 }, { name: "AuthApiError", status: 429 }]) {
    await assert.rejects(load("src/lib/auth/session.ts", { error }).getCurrentUser(true, { failOnUnavailable: true }), { name: "AuthVerificationUnavailableError" });
  }
  for (const error of [{ name: "AuthSessionMissingError", status: 400 }, { name: "AuthApiError", code: "bad_jwt", status: 401 }]) {
    assert.equal(await load("src/lib/auth/session.ts", { error }).getCurrentUser(true, { failOnUnavailable: true }), null);
  }
  await assert.rejects(load("src/lib/auth/session.ts", { clientFailure: new Error("PRIVATE") }).getCurrentUser(true, { failOnUnavailable: true }), { name: "AuthVerificationUnavailableError" });
});

test("unexpected auth exceptions fail closed without logging their raw contents", async t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  assert.equal(await load("src/lib/auth/session.ts", { clientFailure: new Error("PRIVATE cookies and request URL") }).getCurrentUser(), null);
  assert.deepEqual(warnings, [["[auth] user_verification_unavailable", { reason: "unexpected_error" }]]);
});

const request = (pathname, method = "GET", action = false) => new NextRequest(`http://localhost:3000${pathname}`, { method, headers: action ? { "next-action": "test-action" } : {} });
test("proxy lets Server Actions return their own authentication result while keeping ordinary protected requests guarded", async () => {
  const { updateSession } = load("src/lib/supabase/proxy.ts", { error: networkError });
  for (const pathname of ["/", "/trips/new", "/saved"]) {
    const action = await updateSession(request(pathname, "POST", true));
    assert.equal(action.status, 200); assert.equal(action.headers.get("x-middleware-next"), "1"); assert.equal(action.headers.get("location"), null);
    for (const method of ["GET", "POST"]) {
      const response = await updateSession(request(pathname, method));
      assert.equal(response.status, 307); assert.equal(new URL(response.headers.get("location")).pathname, "/login");
    }
  }
});

test("authenticated auth-page GETs redirect but their Server Action responses keep the React protocol", async () => {
  const { updateSession } = load("src/lib/supabase/proxy.ts", { user: { id: "verified-user" } });
  assert.equal((await updateSession(request("/login"))).status, 307);
  const action = await updateSession(request("/login", "POST", true));
  assert.equal(action.status, 200); assert.equal(action.headers.get("location"), null);
});

test("Server Action handling preserves refreshed cookies and private response headers", async () => {
  const { updateSession } = load("src/lib/supabase/proxy.ts", { user: { id: "verified-user" }, refreshedCookies: [{ name: "test-session", value: "test-refreshed-value", options: { path: "/", httpOnly: true } }] });
  const response = await updateSession(request("/", "POST", true));
  assert.equal(response.cookies.get("test-session").value, "test-refreshed-value");
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
