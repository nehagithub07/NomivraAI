import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { connect, type ConnectionOptions, type TLSSocket } from "node:tls";
import { buildConnector } from "undici";

type Dependencies = {
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
  openTls?: (options: ConnectionOptions) => TLSSocket;
  timeoutMs?: number;
  staggerMs?: number;
};

// TCP can connect while TLS stalls on one resolved address. Select the first
// certificate-verified TLS socket, before Undici sends any HTTP/authentication data.
export function createSupabaseConnector({
  resolve = async hostname => await lookup(hostname, { all: true }),
  openTls = options => connect(options),
  timeoutMs = 15_000,
  staggerMs = 250,
}: Dependencies = {}): buildConnector.connector {
  const standard = buildConnector({ timeout: timeoutMs, rejectUnauthorized: true });
  return (options, callback) => {
    if (options.protocol !== "https:" || options.httpSocket || isIP(options.hostname)) return standard(options, callback);
    let settled = false, remaining = 0;
    const sockets: TLSSocket[] = [], timers: ReturnType<typeof setTimeout>[] = [];
    const cleanup = (winner: TLSSocket | null) => {
      clearTimeout(deadline);
      timers.forEach(clearTimeout);
      for (const socket of sockets) if (socket !== winner) socket.destroy();
    };
    const finish = (error: Error | null, socket: TLSSocket | null) => {
      if (settled) { socket?.destroy(); return; }
      if (error && --remaining > 0) return;
      settled = true;
      cleanup(socket);
      if (error) callback(error, null);
      else if (socket) callback(null, socket);
    };
    const deadline = setTimeout(() => {
      remaining = 1;
      finish(Object.assign(new Error("Supabase connection timed out"), { code: "UND_ERR_CONNECT_TIMEOUT" }), null);
    }, timeoutMs);

    Promise.resolve().then(() => resolve(options.hostname)).then(addresses => {
      if (settled) return;
      const unique = [...new Map(addresses.map(address => [address.address, address])).values()].slice(0, 4);
      remaining = unique.length;
      if (!remaining) {
        finish(Object.assign(new Error("Supabase address lookup failed"), { code: "ENOTFOUND" }), null);
        return;
      }
      unique.forEach((address, index) => {
        const start = () => {
          if (settled) return;
          try {
            const socket = openTls({
              host: address.address, port: Number(options.port) || 443,
              servername: options.servername || options.hostname,
              rejectUnauthorized: true, ALPNProtocols: ["http/1.1"],
              ...(options.localAddress ? { localAddress: options.localAddress } : {}),
            });
            sockets.push(socket);
            socket.once("secureConnect", () => finish(null, socket));
            socket.once("error", error => finish(error, null));
          } catch (error) {
            finish(error instanceof Error ? error : new Error("Supabase connection failed"), null);
          }
        };
        if (index === 0) start();
        else timers.push(setTimeout(start, index * staggerMs));
      });
    }).catch(error => {
      remaining = 1;
      finish(error instanceof Error ? error : new Error("Supabase address lookup failed"), null);
    });
  };
}
