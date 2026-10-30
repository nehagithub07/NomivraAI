import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TripWithInterests } from "@/lib/trips/queries";
import { getPersistedPlaces } from "@/lib/destinations/persistence";
import { callTravelApi, internalKey, TravelError } from "@/lib/destinations/backend";
import { signProof } from "@/lib/destinations/proof";
import { getCachedHotels, getStaySelection } from "@/lib/accommodations/server";
import { accommodationContext } from "@/lib/accommodations/context";
import { getCachedFood, getFoodSelections } from "@/lib/food/server";
import { generationResponseSchema, savedItinerarySchema, type ItineraryVersionSummary } from "./validation";
import { itineraryTripContext, sameContext } from "./context";

type DB = SupabaseClient<Database>;
function databaseFailure(error: { code?: string; message?: string }): TravelError {
  const messages = ["ITINERARY_IN_PROGRESS", "ITINERARY_RATE_LIMITED", "ITINERARY_INVALID_TRIP", "ITINERARY_ATTEMPT_FAILED", "ITINERARY_CONTEXT_CHANGED"];
  if (messages.includes(error.message || "")) return new TravelError(error.message!, "Itinerary planning could not complete.", error.message === "ITINERARY_RATE_LIMITED" ? 429 : 409);
  if (["PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"].includes(error.code || "")) return new TravelError("ITINERARY_SETUP_REQUIRED", "Itinerary planning needs a database setup update.");
  return new TravelError("ITINERARY_PERSISTENCE_UNAVAILABLE", "We couldn't confirm the saved itinerary.");
}
export async function loadOwnedItineraryTrip(db: DB, tripId: string, userId: string): Promise<TripWithInterests> {
  if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
  const { data, error } = await db.from("trips").select("*, trip_interests(interest)").eq("id", tripId).eq("owner_id", userId).maybeSingle();
  if (error) throw new TravelError("database_unavailable", "We couldn't load your trip.");
  if (!data || data.owner_id !== userId) throw new TravelError("not_found", "Trip not found.", 404);
  return data;
}
export async function getItineraryVersions(db: DB, tripId: string): Promise<ItineraryVersionSummary[]> {
  const { data, error } = await db.from("itinerary_versions").select("id,version_number,created_at,is_current").eq("trip_id", tripId).eq("status", "ready").order("version_number", { ascending: false }).limit(20);
  if (error) throw databaseFailure(error);
  return data;
}
export async function getItinerary(db: DB, trip: TripWithInterests, versionId?: string) {
  let query = db.from("itinerary_versions").select("*, itinerary_days(*, itinerary_items(*))").eq("trip_id", trip.id).eq("status", "ready");
  query = versionId ? query.eq("id", versionId) : query.eq("is_current", true);
  const { data, error } = await query.maybeSingle();
  if (error) throw databaseFailure(error);
  if (!data) return null;
  return savedItinerarySchema.parse({
    id: data.id, version_number: data.version_number, created_at: data.created_at, is_current: data.is_current,
    provider: data.provider, model_name: data.model_name, prompt_version: data.prompt_version, demo: data.demo,
    generation_reason: data.generation_reason ?? "initial", parent_version_id: data.parent_version_id ?? null,
    weather_fetched_at: data.weather_fetched_at ?? null, document_hash: data.document_hash ?? null,
    stale: !sameContext(data.trip_context, itineraryTripContext(trip)),
    itinerary: { title: data.title, summary: data.summary, warnings: data.warnings,
      days: data.itinerary_days.sort((a, b) => a.day_number - b.day_number).map(day => ({
        date: day.trip_date, day_number: day.day_number, theme: day.theme,
        items: day.itinerary_items.sort((a, b) => a.position - b.position).map(item => ({
          candidate_type: item.candidate_type, candidate_id: item.candidate_id, candidate_provider: item.candidate_provider,
          period: item.period, title: item.title, reason: item.reason, notes: item.notes, category: item.category,
          latitude: item.latitude, longitude: item.longitude, opening_hours: item.opening_hours,
        })),
      })),
    },
  });
}
export async function buildTrustedPlanningInput(db: DB, trip: TripWithInterests) {
  const days = Math.round((Date.parse(trip.end_date) - Date.parse(trip.start_date)) / 86400000) + 1;
  if (trip.destination_provider !== "open_meteo" || !trip.destination_provider_id || trip.destination_latitude === null || trip.destination_longitude === null || !(days >= 1 && days <= 14)) throw new TravelError("ITINERARY_INVALID_TRIP", "AI planning supports confirmed trips of 1–14 days.", 422);
  const attractions = await getPersistedPlaces(db, trip.id);
  if (!attractions.length) throw new TravelError("ITINERARY_MISSING_PLACES", "Discover places before generating your itinerary.", 409);
  const [selections, stay] = await Promise.all([getFoodSelections(db, trip.id), getStaySelection(db, trip.id)]);
  const cachedFood = getCachedFood(trip.owner_id, trip), cachedHotels = getCachedHotels(trip.owner_id, trip);
  const selectedHotel = stay?.provider === "stayapi" && sameContext(stay.search_context, accommodationContext(trip)) ? stay : null;
  const details = selectedHotel && cachedHotels?.candidates.find(c => c.provider === "stayapi" && c.provider_accommodation_id === selectedHotel.provider_accommodation_id);
  return {
    trip_id: trip.id, destination_name: trip.destination_name, country: trip.destination_country,
    timezone: trip.destination_timezone, start_date: trip.start_date, end_date: trip.end_date,
    travelers: trip.travelers_count, budget_total: String(trip.budget_total), currency: trip.currency,
    budget_style: trip.budget_style, travel_pace: trip.travel_pace,
    interests: trip.trip_interests.map(i => i.interest), accommodation_preferences: trip.accommodation_preferences,
    dietary_preferences: trip.dietary_preferences, special_requests: trip.special_requests,
    attractions: attractions.map(p => ({ candidate_id: p.provider_place_id, name: p.name, category: p.category,
      latitude: p.latitude, longitude: p.longitude, distance_km: p.distance_km, opening_hours: p.tags.opening_hours ?? null })),
    food: selections.filter(s => s.provider === "geoapify").slice(0, 20).map(s => {
      const recent = cachedFood?.candidates.find(c => c.provider === "geoapify" && c.provider_place_id === s.provider_place_id);
      return { candidate_id: s.provider_place_id, provider: "geoapify", name: s.name, category: s.category,
        cuisine_types: recent?.cuisine_types ?? [], dietary_tags: recent?.dietary_tags ?? [],
        dietary_conflicts: recent?.dietary_conflicts ?? [], latitude: recent?.latitude ?? null,
        longitude: recent?.longitude ?? null, distance_km: recent?.distance_km ?? null,
        recommendation_score: recent?.recommendation_score ?? null };
    }),
    hotel: selectedHotel ? { candidate_id: selectedHotel.id, provider: "stayapi", provider_accommodation_id: selectedHotel.provider_accommodation_id,
      name: details?.name ?? null, latitude: details?.latitude ?? null, longitude: details?.longitude ?? null,
      total_price: details?.comparable_price ? details.total_price : null, currency: details?.currency ?? null,
      guest_rating: details?.guest_rating ?? null, guest_rating_scale: details?.guest_rating_scale ?? null,
      quote_expires_at: details ? cachedHotels!.expires_at : null } : null,
  };
}
export async function generateTripItinerary(db: DB, trip: TripWithInterests, userId: string, requestId: string, regenerate: boolean) {
  const context = await buildTrustedPlanningInput(db, trip);
  const key = internalKey();
  const { data: versionId, error: reservationError } = await db.rpc("begin_itinerary_generation", { p_trip_id: trip.id, p_request_id: requestId, p_regenerate: regenerate });
  if (reservationError || !versionId) throw databaseFailure(reservationError || {});
  const expires_at = Math.floor(Date.now() / 1000) + 180;
  const proofBase = { user_id: userId, trip_id: trip.id, version_id: versionId, expires_at };
  try {
    const existing = await getItinerary(db, trip, versionId);
    if (existing) return { itinerary: existing, budget: null };
    const generated = await callTravelApi("itineraries/generate", { user_id: userId, context }, generationResponseSchema);
    if (generated.demo && process.env.NODE_ENV === "production") throw new TravelError("ITINERARY_CONFIGURATION_ERROR", "Development planning is disabled in production.");
    const document = JSON.stringify(generated.itinerary);
    const payload = JSON.stringify({ ...proofBase, kind: "itinerary_version", provider: generated.provider, model_name: generated.model_name,
      prompt_version: generated.prompt_version, demo: generated.demo, trip_context: itineraryTripContext(trip), document_hash: createHash("sha256").update(document).digest("hex") });
    const { error } = await db.rpc("complete_itinerary_generation", { p_payload: payload, p_signature: signProof(payload, key), p_document: document });
    if (error) throw databaseFailure(error);
    const saved = await getItinerary(db, trip, versionId);
    if (!saved) throw new TravelError("ITINERARY_PERSISTENCE_UNAVAILABLE", "We couldn't confirm the saved itinerary.");
    return { itinerary: saved, budget: generated.budget };
  } catch (error) {
    const payload = JSON.stringify({ ...proofBase, kind: "itinerary_failure" });
    // Never hide the original failure. A ready version cannot be marked failed.
    await db.rpc("fail_itinerary_generation", { p_payload: payload, p_signature: signProof(payload, key) }).then(() => {}, () => {});
    throw error;
  }
}
