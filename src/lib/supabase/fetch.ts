import "server-only";
import { Agent } from "undici";
import { createSupabaseConnector } from "./connector";

const processState = globalThis as typeof globalThis & { __nomviraSupabaseAgent?: Agent };
const dispatcher = processState.__nomviraSupabaseAgent ??= new Agent({
  connect: createSupabaseConnector(), connections: 4, keepAliveTimeout: 10_000, keepAliveMaxTimeout: 60_000,
});

export const supabaseFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, cache: "no-store", dispatcher,
  signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : input instanceof Request ? [input.signal] : [])]),
} as RequestInit & { dispatcher: Agent });
