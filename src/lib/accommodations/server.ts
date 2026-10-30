import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TripRow } from "@/lib/supabase/database.types";
import { internalKey, TravelError } from "@/lib/destinations/backend";
import { signProof } from "@/lib/destinations/proof";
import { accommodationContext, hotelNights, roomsForTravelers } from "./context";
import { hotelResponseSchema, selectionSchema, type HotelSearchResults } from "./validation";
import { todayInTimeZone } from "@/lib/trips/dates";

const recentSearches = new Map<string, HotelSearchResults>();
function searchKey(userId: string, trip: TripRow, demo = false) { return JSON.stringify([userId, trip.id, accommodationContext(trip), demo]); }
export function getCachedHotels(userId: string, trip: TripRow, demo = false): HotelSearchResults | null {
  const key = searchKey(userId, trip, demo), cached = recentSearches.get(key);
  if (cached && Date.parse(cached.expires_at) > Date.now()) return structuredClone({ ...cached, cached: true });
  recentSearches.delete(key);
  return null;
}
export function selectionFailure(error: { code?: string }) {
  if (["PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"].includes(error.code || "")) return new TravelError("setup_required", "Stay selection needs a database setup update.");
  if (error.code === "40001") return new TravelError("selection_conflict", "Your stay changed. Reload before replacing it.", 409);
  if (error.code === "22023" || error.code === "28000") return new TravelError("selection_expired", "Search hotels again before selecting a stay.", 409);
  return new TravelError("persistence_unavailable", "We couldn't save this stay. Please try again.");
}
export async function loadOwnedHotelTrip(db: SupabaseClient<Database>, tripId: string, userId: string) {
  const { data, error } = await db.from("trips").select("*").eq("id", tripId).eq("owner_id", userId).maybeSingle();
  if (error) throw new TravelError("database_unavailable", "We couldn't load your trip.");
  if (!data) throw new TravelError("not_found", "Trip not found.", 404);
  return data;
}
export async function getStaySelection(db: SupabaseClient<Database>, tripId: string) {
  const { data, error } = await db.from("trip_accommodation_selections").select("*").eq("trip_id", tripId).maybeSingle();
  if (error) throw selectionFailure(error);
  return data ? selectionSchema.parse(data) : null;
}
export function validateHotelTrip(trip: TripRow) {
  if (trip.destination_provider !== "open_meteo" || !trip.destination_provider_id || trip.destination_latitude === null || trip.destination_longitude === null) throw new TravelError("unresolved_destination", "Hotel search needs a confirmed destination.", 409);
  const nights = hotelNights(trip.start_date, trip.end_date);
  if (!Number.isFinite(nights) || nights < 1 || nights > 90 || trip.start_date < todayInTimeZone(trip.destination_timezone || "UTC")) throw new TravelError("invalid_stay", "Choose a future hotel stay of 1–90 nights.", 422);
}
const providerCodes = new Set(["ACCOMMODATION_CONFIGURATION_ERROR", "ACCOMMODATION_PROVIDER_AUTH_ERROR", "ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED", "ACCOMMODATION_PROVIDER_UNAVAILABLE", "ACCOMMODATION_PROVIDER_INVALID_RESPONSE", "ACCOMMODATION_DESTINATION_UNRESOLVED", "ACCOMMODATION_RATE_LIMITED"]);
export async function searchTripHotels(trip: TripRow, userId: string, refresh = false, demo = false, cacheOnly = false): Promise<HotelSearchResults> {
  validateHotelTrip(trip);
  if (demo && process.env.NODE_ENV === "production") throw new TravelError("ACCOMMODATION_CONFIGURATION_ERROR", "Demo search is disabled in production.");
  const cached = getCachedHotels(userId, trip, demo);
  if (cached && !refresh) return cached;
  const base = process.env.NOMVIRA_API_URL;
  if (!base) throw new TravelError("ACCOMMODATION_CONFIGURATION_ERROR", "Hotel search isn't configured.");
  let key: string;
  try { key = internalKey(); } catch { throw new TravelError("ACCOMMODATION_CONFIGURATION_ERROR", "Hotel search isn't configured."); }
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v1/accommodations/search`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Nomvira-Internal-Key": key },
      body: JSON.stringify({
        user_id: userId, destination_key: `${trip.destination_provider}:${trip.destination_provider_id}`,
        destination_name: trip.destination_display_name || trip.destination_name,
        destination_country: trip.destination_country, destination_admin1: trip.destination_admin1, destination_timezone: trip.destination_timezone,
        latitude: trip.destination_latitude, longitude: trip.destination_longitude,
        check_in: trip.start_date, check_out: trip.end_date, travelers: trip.travelers_count,
        rooms: roomsForTravelers(trip.travelers_count), currency: trip.currency,
        accommodation_preferences: trip.accommodation_preferences,
        trip_budget: String(trip.budget_total), budget_style: trip.budget_style, refresh, demo, ...(cacheOnly ? { cache_only: true } : {}),
      }), cache: "no-store", signal: AbortSignal.timeout(cacheOnly ? 5_000 : 40_000), redirect: "error",
    });
  } catch { throw new TravelError("ACCOMMODATION_PROVIDER_UNAVAILABLE", "Hotel search is temporarily unavailable."); }
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const candidate = failure?.error?.code;
    const code = typeof candidate === "string" && providerCodes.has(candidate) ? candidate : "ACCOMMODATION_PROVIDER_UNAVAILABLE";
    throw new TravelError(code, "Hotel search is temporarily unavailable.", response.status === 429 ? 429 : 503);
  }
  const parsed = hotelResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || (parsed.data.demo && process.env.NODE_ENV === "production")) throw new TravelError("ACCOMMODATION_CONFIGURATION_ERROR", "Hotel search returned unavailable data.");
  const result = parsed.data;
  const expires = Math.min(Math.floor(Date.parse(result.expires_at) / 1000), Math.floor(Date.now() / 1000) + 1800);
  if (expires <= Math.floor(Date.now() / 1000)) throw new TravelError("ACCOMMODATION_PROVIDER_UNAVAILABLE", "Hotel results have expired.");
  const signed: HotelSearchResults = { ...result, expires_at: new Date(expires * 1000).toISOString(), candidates: result.candidates.map(candidate => {
    const payload = JSON.stringify({ kind: "accommodation_selection", user_id: userId, trip_id: trip.id,
      expires_at: expires, provider: candidate.provider, provider_accommodation_id: candidate.provider_accommodation_id,
      selected_name: result.demo ? candidate.name : null, context: accommodationContext(trip) });
    return { ...candidate, selection_proof: { payload, signature: signProof(payload, key) } };
  }) };
  recentSearches.set(searchKey(userId, trip, demo), signed);
  if (recentSearches.size > 128) recentSearches.delete(recentSearches.keys().next().value!);
  return structuredClone(signed);
}
