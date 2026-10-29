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
const discoveryProviderCodes = new Set(["PLACES_RATE_LIMITED", "PLACES_PROVIDER_RATE_LIMITED", "PLACES_PROVIDER_CONNECT_TIMEOUT", "PLACES_PROVIDER_CONNECTION_ERROR", "PLACES_PROVIDER_UNAVAILABLE", "PLACES_PROVIDER_INVALID_RESPONSE", "PLACES_PROVIDER_INVALID_REQUEST"]);
const itineraryProviderCodes = new Set(["ITINERARY_CONFIGURATION_ERROR", "ITINERARY_INVALID_TRIP", "ITINERARY_INVALID_CONTEXT", "ITINERARY_MISSING_PLACES", "ITINERARY_RATE_LIMITED", "ITINERARY_PROVIDER_RATE_LIMITED", "ITINERARY_PROVIDER_AUTH_ERROR", "ITINERARY_PROVIDER_TIMEOUT", "ITINERARY_PROVIDER_UNAVAILABLE", "ITINERARY_PROVIDER_INVALID_RESPONSE", "ITINERARY_VALIDATION_FAILED"]);
export async function callTravelApi<T>(endpoint: "destinations/search" | "places/discover" | "itineraries/generate" | "budget/summary" | "budget/entries/validate", body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  if (endpoint.startsWith("budget/")) return callBudgetApi(endpoint, body, schema);
  const key = internalKey(), base = process.env.NOMVIRA_API_URL;
  if (!base) throw new TravelError("configuration_error", "Destination search is temporarily unavailable.");
  const searching = endpoint === "destinations/search";
  const planning = endpoint === "itineraries/generate";
  const url = new URL(`${base.replace(/\/$/, "")}/api/v1/${endpoint}`);
  if (searching) for (const [name, value] of Object.entries(body)) if (value !== undefined) url.searchParams.set(name, String(value));
  let response: Response;
  try {
    response = await fetch(url, {
      method: searching ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Nomvira-Internal-Key": key },
      ...(searching ? {} : { body: JSON.stringify(body) }),
      // Discovery can wait up to 8 seconds, then spend up to 45 seconds in Overpass.
      cache: "no-store", signal: AbortSignal.timeout(searching ? 15_000 : planning ? 75_000 : 60_000), redirect: "error",
    });
  } catch { throw new TravelError(planning ? "ITINERARY_PROVIDER_UNAVAILABLE" : "provider_unavailable", planning ? "AI planning is temporarily unavailable." : searching ? "Destination search is temporarily unavailable." : "We couldn't load places right now. Your trip is safe."); }
  if (!response.ok) {
    // Keep trusted error categories; never forward raw upstream bodies or messages.
    const limited = response.status === 429;
    let code = planning ? "ITINERARY_PROVIDER_UNAVAILABLE" : limited ? "provider_rate_limited" : "provider_unavailable";
    if (!searching) {
      const failure = await response.json().catch(() => null);
      const upstreamCode = failure?.error?.code;
      if (typeof upstreamCode === "string" && (planning ? itineraryProviderCodes : discoveryProviderCodes).has(upstreamCode)) code = upstreamCode;
      console.warn(planning ? "[itinerary] backend_failed" : "[places] discovery_backend_failed", JSON.stringify({ code, status: response.status }));
    }
    if (planning) throw new TravelError(code, "AI planning could not complete. Your previous itinerary is safe.", limited ? 429 : [409, 422, 502].includes(response.status) ? response.status : 503);
    throw new TravelError(code, searching ? "Destination search is temporarily unavailable. Please try again." : code === "PLACES_RATE_LIMITED" ? "Place discovery is busy. Please try again shortly." : code === "PLACES_PROVIDER_RATE_LIMITED" ? "Place discovery is temporarily busy. Please try again shortly." : "We couldn't load places right now. Your trip is safe.", limited ? 429 : 503);
  }
  try { return schema.parse(await response.json()); }
  catch { throw new TravelError(planning ? "ITINERARY_PROVIDER_INVALID_RESPONSE" : "invalid_provider_response", planning ? "AI planning returned an unavailable plan." : searching ? "Destination search is temporarily unavailable." : "We couldn't load places right now. Your trip is safe."); }
}

async function callBudgetApi<T>(endpoint: string, body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const base = process.env.NOMVIRA_API_URL;
  if (!base) throw new TravelError("BUDGET_UNAVAILABLE", "Budget tracking is temporarily unavailable.");
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v1/${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Nomvira-Internal-Key": internalKey() },
      body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error",
    });
  } catch { throw new TravelError("BUDGET_UNAVAILABLE", "Budget tracking is temporarily unavailable."); }
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    if (failure?.error?.code === "BUDGET_CURRENCY_MISMATCH") throw new TravelError("BUDGET_CURRENCY_MISMATCH", "Use your trip's currency for expenses.", 422);
    throw new TravelError("BUDGET_UNAVAILABLE", "We couldn't calculate your budget. Check your expense details or try again later.", response.status === 422 ? 422 : response.status === 429 ? 429 : 503);
  }
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new TravelError("BUDGET_INVALID_RESPONSE", "We couldn't confirm your budget. Please reload.");
  return parsed.data;
}
