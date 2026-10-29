import "server-only";
import { z } from "zod";

export class TravelError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}
export function internalKey() {
  const key = process.env.NOMVIRA_INTERNAL_API_KEY;
  if (!key || key.length < 32) throw new TravelError("configuration_error", "Destination search is temporarily unavailable.");
  return key;
}
export async function callTravelApi<T>(endpoint: "destinations/search" | "places/discover", body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const key = internalKey(), base = process.env.NOMVIRA_API_URL;
  if (!base) throw new TravelError("configuration_error", "Destination search is temporarily unavailable.");
  const searching = endpoint === "destinations/search";
  const url = new URL(`${base.replace(/\/$/, "")}/api/v1/${endpoint}`);
  if (searching) for (const [name, value] of Object.entries(body)) if (value !== undefined) url.searchParams.set(name, String(value));
  let response: Response;
  try {
    response = await fetch(url, {
      method: searching ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Nomvira-Internal-Key": key },
      ...(searching ? {} : { body: JSON.stringify(body) }),
      // Discovery can wait up to 8 seconds, then spend up to 45 seconds in Overpass.
      cache: "no-store", signal: AbortSignal.timeout(searching ? 15_000 : 60_000), redirect: "error",
    });
  } catch { throw new TravelError("provider_unavailable", searching ? "Destination search is temporarily unavailable." : "We couldn't load places right now. Your trip is safe."); }
  if (!response.ok) {
    // Keep trusted error categories; never forward raw upstream bodies or messages.
    const limited = response.status === 429;
    let code = limited ? "provider_rate_limited" : "provider_unavailable";
    if (!searching) {
      const failure = await response.json().catch(() => null);
      const upstreamCode = failure?.error?.code;
      if (limited && (upstreamCode === "PLACES_RATE_LIMITED" || upstreamCode === "PLACES_PROVIDER_RATE_LIMITED")) code = upstreamCode;
      console.warn("[places] discovery_backend_failed", { code, status: response.status });
    }
    throw new TravelError(code, searching ? "Destination search is temporarily unavailable. Please try again." : code === "PLACES_RATE_LIMITED" ? "Place discovery is busy. Please try again shortly." : code === "PLACES_PROVIDER_RATE_LIMITED" ? "Place discovery is temporarily busy. Please try again shortly." : "We couldn't load places right now. Your trip is safe.", limited ? 429 : 503);
  }
  try { return schema.parse(await response.json()); }
  catch { throw new TravelError("invalid_provider_response", searching ? "Destination search is temporarily unavailable." : "We couldn't load places right now. Your trip is safe."); }
}
