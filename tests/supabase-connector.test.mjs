import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { Agent } from "undici";
import { createSupabaseConnector } from "../src/lib/supabase/connector.ts";

const options = { hostname: "project.supabase.co", host: "project.supabase.co", protocol: "https:", port: "443" };
const addresses = [{ address: "192.0.2.1", family: 4 }, { address: "192.0.2.2", family: 4 }];
const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  destroyed = false;
  destroy() { this.destroyed = true; return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
}
function run(dependencies) {
  let calls = 0;
  const result = new Promise(resolve => createSupabaseConnector(dependencies)(options, (error, socket) => { calls++; resolve({ error, socket }); }));
  return { result, calls: () => calls };
}

test("a stalled TLS handshake falls back while preserving hostname verification and closing unused sockets", async () => {
  const sockets = [], attempted = [];
  const request = run({ resolve: async () => addresses, staggerMs: 1, timeoutMs: 500, openTls: settings => {
    const socket = new Socket(); sockets.push(socket); attempted.push(settings);
    if (settings.host === addresses[1].address) setImmediate(() => socket.emit("secureConnect"));
    return socket;
  } });
  const result = await request.result;
  assert.equal(result.error, null); assert.equal(result.socket, sockets[1]); assert.equal(request.calls(), 1);
  assert.equal(sockets[0].destroyed, true); assert.equal(sockets[1].destroyed, false);
  for (const settings of attempted) { assert.equal(settings.servername, options.hostname); assert.equal(settings.rejectUnauthorized, true); }
  sockets[0].emit("secureConnect"); assert.equal(request.calls(), 1);
});

test("a healthy first address avoids unnecessary additional handshakes", async () => {
  let attempts = 0;
  const request = run({ resolve: async () => addresses, staggerMs: 30, openTls: () => {
    attempts++; const socket = new Socket(); setImmediate(() => socket.emit("secureConnect")); return socket;
  } });
  assert.equal((await request.result).error, null);
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(attempts, 1);
});

test("certificate failures never become authenticated connections", async () => {
  const request = run({ resolve: async () => addresses, staggerMs: 1, openTls: () => {
    const socket = new Socket(); setImmediate(() => socket.emit("error", Object.assign(new Error("Certificate mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }))); return socket;
  } });
  const result = await request.result;
  assert.equal(result.error.code, "ERR_TLS_CERT_ALTNAME_INVALID"); assert.equal(result.socket, null); assert.equal(request.calls(), 1);
});

test("lookup and handshake waiting have a bounded deadline and late DNS results cannot open sockets", async () => {
  let completeLookup, attempts = 0;
  const request = run({ resolve: () => new Promise(resolve => { completeLookup = resolve; }), timeoutMs: 10, openTls: () => { attempts++; return new Socket(); } });
  assert.equal((await request.result).error.code, "UND_ERR_CONNECT_TIMEOUT");
  completeLookup(addresses); await tick(); assert.equal(attempts, 0); assert.equal(request.calls(), 1);
});

test("handshake deadlines close all pending sockets", async () => {
  const sockets = [];
  const request = run({ resolve: async () => addresses, staggerMs: 1, timeoutMs: 15, openTls: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  assert.equal((await request.result).error.code, "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(sockets.length, 2); assert.ok(sockets.every(socket => socket.destroyed));
});

test("DNS failures and empty DNS records complete safely", async () => {
  for (const resolve of [async () => { throw Object.assign(new Error("Lookup failed"), { code: "ENOTFOUND" }); }, async () => []]) {
    const request = run({ resolve, openTls: () => assert.fail("No TLS connection without an address") });
    assert.equal((await request.result).error.code, "ENOTFOUND"); assert.equal(request.calls(), 1);
  }
});

test("DNS candidates are deduplicated and limited", async () => {
  let attempts = 0;
  const request = run({ resolve: async () => [...Array(2).fill(addresses[0]), ...Array.from({ length: 8 }, (_, index) => ({ address: `192.0.2.${index+2}`, family: 4 }))], staggerMs: 1, timeoutMs: 30, openTls: () => { attempts++; return new Socket(); } });
  await request.result; assert.equal(attempts, 4);
});

test("plain HTTP development endpoints still work and a request is sent once", async () => {
  let calls = 0;
  const server = createServer((_request, response) => { calls++; response.end("ok"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const dispatcher = new Agent({ connect: createSupabaseConnector() });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { dispatcher });
    assert.equal(await response.text(), "ok"); assert.equal(calls, 1);
  } finally { await dispatcher.close(); await new Promise(resolve => server.close(resolve)); }
});
