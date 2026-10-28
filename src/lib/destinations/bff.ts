import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { TravelError } from "./backend";

export const travelJson = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function travelRoute<T>(request: Request, schema: z.ZodType<T>, run: (data: T, userId: string) => Promise<unknown>) {
  try {
    // Route handlers do not inherit app layout authentication.
    // This route owns cookie refresh and authorization in one verified lookup.
    const user = await getCurrentUser(true);
    if (!user) return travelJson({ error: { code: "unauthorized", message: "Sign in to continue." } }, 401);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return travelJson({ error: { code: "forbidden", message: "Request not allowed." } }, 403);
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.search.length > 2048 || new Set(url.searchParams.keys()).size !== url.searchParams.size) return travelJson({ error: { code: "invalid_request", message: "Check your search details." } }, 422);
      const query = schema.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) return travelJson({ error: { code: "invalid_request", message: "Check your search details." } }, 422);
      return travelJson(await run(query.data, user.id));
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) return travelJson({ error: { code: "invalid_request", message: "Send a JSON request." } }, 415);
    // Bound streamed input too; Content-Length alone is client-controlled.
    const reader = request.body?.getReader();
    if (!reader) return travelJson({ error: { code: "invalid_request", message: "Check your request details." } }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return travelJson({ error: { code: "invalid_request", message: "Request is too large." } }, 413); }
      chunks.push(value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return travelJson({ error: { code: "invalid_request", message: "Check your request details." } }, 400); }
    const data = schema.safeParse(parsed);
    if (!data.success) return travelJson({ error: { code: "invalid_request", message: "Check your request details." } }, 422);
    return travelJson(await run(data.data, user.id));
  } catch (error) {
    if (error instanceof TravelError) return travelJson({ error: { code: error.code, message: error.message } }, error.status);
    return travelJson({ error: { code: "unavailable", message: "We couldn't complete this request. Please try again." } }, 503);
  }
}
