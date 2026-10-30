import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, TripRow } from "@/lib/supabase/database.types";
import { internalKey, TravelError } from "@/lib/destinations/backend";
import { signProof, verifyProof } from "@/lib/destinations/proof";
import { foodContext } from "./context";
import { defaultFoodCategories } from "./catalog";
import { foodCategories, foodResponseSchema, foodSelectionSchema, type FoodResults, type FoodSearchOptions } from "./validation";

const recentSearches = new Map<string, FoodResults>();
const searchKey = (userId: string, trip: TripRow, options: FoodSearchOptions) => JSON.stringify([userId, trip.id, foodContext(trip), {
  radius_meters: options.radius_meters ?? 5000, categories: options.categories ?? defaultFoodCategories,
  dietary_preferences: [...new Set(options.dietary_preferences ?? trip.dietary_preferences)].sort(),
  cuisine_preferences: [...new Set(options.cuisine_preferences ?? [])].sort(), strict_dietary: options.strict_dietary ?? false, demo: options.demo ?? false,
}]);
export function getCachedFood(userId: string, trip: TripRow, options: FoodSearchOptions = {}): FoodResults | null {
  const key = searchKey(userId, trip, options), cached = recentSearches.get(key);
  if (cached && Date.parse(cached.expires_at) > Date.now() && !(cached.demo && process.env.NODE_ENV === "production")) return structuredClone({ ...cached, cached: true });
  recentSearches.delete(key);
  return null;
}
export function foodSelectionFailure(error: { code?: string }) {
  if (["PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"].includes(error.code || "")) return new TravelError("setup_required", "Saving food spots needs a database setup update.");
  if (["22023", "28000"].includes(error.code || "")) return new TravelError("selection_expired", "Search food again before saving this place.", 409);
  return new TravelError("persistence_unavailable", "We couldn't update your saved food spots. Please try again.");
}
export async function loadOwnedFoodTrip(db: SupabaseClient<Database>, tripId: string, userId: string) {
  const { data, error } = await db.from("trips").select("*").eq("id", tripId).eq("owner_id", userId).maybeSingle();
  if (error) throw new TravelError("database_unavailable", "We couldn't load your trip.");
  if (!data || data.owner_id !== userId) throw new TravelError("not_found", "Trip not found.", 404);
  return data;
}
export async function getFoodSelections(db: SupabaseClient<Database>, tripId: string) {
  const { data, error } = await db.from("trip_food_selections").select("*").eq("trip_id", tripId).order("saved_at", { ascending: false });
  if (error) throw foodSelectionFailure(error);
  return z.array(foodSelectionSchema).parse(data);
}
export function validateFoodTrip(trip: TripRow) {
  if (trip.destination_provider !== "open_meteo" || !trip.destination_provider_id || trip.destination_latitude === null || trip.destination_longitude === null) throw new TravelError("unresolved_destination", "Food search needs a confirmed destination.", 409);
}
const providerCodes = new Set(["FOOD_CONFIGURATION_ERROR", "FOOD_PROVIDER_AUTH_ERROR", "FOOD_PROVIDER_RATE_LIMITED", "FOOD_PROVIDER_UNAVAILABLE", "FOOD_PROVIDER_INVALID_RESPONSE", "FOOD_RATE_LIMITED"]);
export async function searchTripFood(trip: TripRow, userId: string, options: FoodSearchOptions, cacheOnly = false): Promise<FoodResults> {
  validateFoodTrip(trip);
  if (options.demo && process.env.NODE_ENV === "production") throw new TravelError("FOOD_CONFIGURATION_ERROR", "Demo food search is disabled in production.");
  const cached = getCachedFood(userId, trip, options);
  if (cached) return cached;
  const base = process.env.NOMVIRA_API_URL;
  if (!base) throw new TravelError("FOOD_CONFIGURATION_ERROR", "Food search isn't configured.");
  let key: string;
  try { key = internalKey(); } catch { throw new TravelError("FOOD_CONFIGURATION_ERROR", "Food search isn't configured."); }
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v1/food/search`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Nomvira-Internal-Key": key },
      body: JSON.stringify({ user_id: userId, latitude: trip.destination_latitude, longitude: trip.destination_longitude,
        dietary_preferences: options.dietary_preferences ?? trip.dietary_preferences, ...options, limit: 20, ...(cacheOnly ? { cache_only: true } : {}) }),
      cache: "no-store", signal: AbortSignal.timeout(cacheOnly ? 5_000 : 30_000), redirect: "error",
    });
  } catch { throw new TravelError("FOOD_PROVIDER_UNAVAILABLE", "We couldn't load food recommendations right now. Your trip is safe — please try again."); }
  if (!response.ok) {
    const failure = await response.json().catch(() => null), candidate = failure?.error?.code;
    const code = typeof candidate === "string" && providerCodes.has(candidate) ? candidate : "FOOD_PROVIDER_UNAVAILABLE";
    throw new TravelError(code, "We couldn't load food recommendations right now. Your trip is safe — please try again.", response.status === 429 ? 429 : 503);
  }
  const parsed = foodResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || (parsed.data.demo && process.env.NODE_ENV === "production")) throw new TravelError("FOOD_PROVIDER_INVALID_RESPONSE", "Food search returned unavailable data.");
  const result = parsed.data, expires = Math.min(Math.floor(Date.parse(result.expires_at) / 1000), Math.floor(Date.now() / 1000) + 1800);
  if (expires <= Date.now() / 1000) throw new TravelError("FOOD_PROVIDER_UNAVAILABLE", "These food results have expired. Search again.");
  const signed: FoodResults = { ...result, expires_at: new Date(expires * 1000).toISOString(), candidates: result.candidates.map(candidate => {
    const payload = JSON.stringify({ kind: "food_selection", user_id: userId, trip_id: trip.id, expires_at: expires,
      provider: candidate.provider, provider_place_id: candidate.provider_place_id, name: candidate.name, category: candidate.category, context: foodContext(trip) });
    return { ...candidate, selection_proof: { payload, signature: signProof(payload, key) } };
  }) };
  recentSearches.set(searchKey(userId, trip, options), signed);
  if (recentSearches.size > 128) recentSearches.delete(recentSearches.keys().next().value!);
  return structuredClone(signed);
}
export function verifyFoodSelection(proof: { payload: string; signature: string }, trip: TripRow, userId: string) {
  try {
    if (!verifyProof(proof.payload, proof.signature, internalKey())) throw new Error();
    const data = z.object({ kind: z.literal("food_selection"), user_id: z.literal(userId), trip_id: z.literal(trip.id),
      provider: z.enum(["geoapify", "fixture"]), provider_place_id: z.string().min(1).max(512), name: z.string().min(1).max(300), category: z.enum(foodCategories),
      expires_at: z.number().int().min(Math.floor(Date.now() / 1000) + 1).max(Math.floor(Date.now() / 1000) + 1800), context: z.record(z.string(), z.unknown()),
    }).parse(JSON.parse(proof.payload));
    if (JSON.stringify(data.context) !== JSON.stringify(foodContext(trip))) throw new Error();
    if (data.provider === "fixture" && process.env.NODE_ENV === "production") throw new Error();
  } catch { throw new TravelError("selection_expired", "Search food again before saving this place.", 409); }
}
