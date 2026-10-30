import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TripWithInterests } from "@/lib/trips/queries";
import { callTravelApi, internalKey, TravelError } from "@/lib/destinations/backend";
import { signProof } from "@/lib/destinations/proof";
import { buildTrustedPlanningInput, getItinerary } from "@/lib/itineraries/server";
import { itineraryTripContext } from "@/lib/itineraries/context";
import type { SavedItinerary } from "@/lib/itineraries/validation";
import { adaptationResponseSchema, weatherReportSchema } from "./validation";

type DB = SupabaseClient<Database>;
export function trustedWeatherContext(trip: TripWithInterests, cacheOnly = true, refresh = false) {
  if (trip.destination_provider !== "open_meteo" || !trip.destination_provider_id || trip.destination_latitude === null || trip.destination_longitude === null || !trip.destination_timezone) throw new TravelError("WEATHER_CONTEXT_CHANGED", "Weather needs a confirmed destination and timezone.", 409);
  return { latitude: trip.destination_latitude, longitude: trip.destination_longitude, timezone: trip.destination_timezone,
    start_date: trip.start_date, end_date: trip.end_date, cache_only: cacheOnly, refresh };
}
export async function getTripWeather(db: DB, trip: TripWithInterests, refresh = false, versionId?: string) {
  // An unavailable itinerary must not prevent independent weather browsing.
  const saved = await getItinerary(db, trip, versionId).catch(() => null);
  const current = saved && !saved.stale ? saved : null;
  return callTravelApi("weather/forecast", { forecast: trustedWeatherContext(trip, !refresh, refresh),
    version_id: current?.id ?? null,
    items: current?.itinerary.days.flatMap(day => day.items.map((item, index) => ({
      date: day.date, period: item.period, itinerary_item_id: `${day.date}:${index}`, candidate_id: item.candidate_id,
      candidate_type: item.candidate_type, category: item.category, title: item.title,
    }))) ?? [],
  }, weatherReportSchema);
}
function adaptationDatabaseError(error: { code?: string; message?: string }) {
  if (["PGRST202", "PGRST204", "42883", "42703"].includes(error.code ?? "")) return new TravelError("WEATHER_SETUP_REQUIRED", "Weather adaptation needs a database setup update.");
  const code = error.message ?? "";
  if (["WEATHER_CONTEXT_CHANGED", "ITINERARY_CONTEXT_CHANGED"].includes(code)) return new TravelError("WEATHER_CONTEXT_CHANGED", "Your itinerary changed. Reload before adapting.", 409);
  if (["ITINERARY_RATE_LIMITED", "ITINERARY_IN_PROGRESS", "ITINERARY_ATTEMPT_FAILED"].includes(code)) return new TravelError(code, "Wait a little, then check the saved itinerary.", code === "ITINERARY_RATE_LIMITED" ? 429 : 409);
  return new TravelError("ITINERARY_PERSISTENCE_UNAVAILABLE", "We couldn't confirm the saved adaptation.");
}
export function compactItinerary(saved: SavedItinerary) {
  return { days: saved.itinerary.days.map(day => ({ date: day.date, day_number: day.day_number,
    theme: day.theme.toLowerCase(), items: day.items.map(item => ({
      candidate_type: item.candidate_type, candidate_id: item.candidate_id, period: item.period,
      reason_code: item.candidate_type === "attraction" ? "pace_balance" : item.candidate_type === "food" ? "food_option" : item.candidate_type === "hotel" ? "selected_stay" : "free_time",
    })) })), warnings: [] };
}
export async function adaptTripWeather(db: DB, trip: TripWithInterests, userId: string, requestId: string, expectedVersion: string) {
  const parent = await getItinerary(db, trip);
  if (!parent || parent.stale || parent.id !== expectedVersion || !parent.document_hash) throw new TravelError("WEATHER_CONTEXT_CHANGED", "Load the current itinerary before adapting.", 409);
  const context = await buildTrustedPlanningInput(db, trip);
  const key = internalKey();
  const { data: versionId, error: reservationError } = await db.rpc("begin_weather_adaptation", { p_trip_id: trip.id, p_request_id: requestId, p_parent_version_id: parent.id });
  if (reservationError || !versionId) throw adaptationDatabaseError(reservationError || {});
  const proofBase = { user_id: userId, trip_id: trip.id, version_id: versionId, expires_at: Math.floor(Date.now() / 1000) + 180 };
  const fail = async () => {
    const payload = JSON.stringify({ ...proofBase, kind: "itinerary_failure" });
    await db.rpc("fail_itinerary_generation", { p_payload: payload, p_signature: signProof(payload, key) }).then(() => {}, () => {});
  };
  try {
    const existing = await getItinerary(db, trip, versionId);
    if (existing) return { itinerary: existing, changed: true, explanation: "Your weather adaptation is already saved." };
    const generated = await callTravelApi("itineraries/adapt-weather", { user_id: userId, context,
      parent_version_id: parent.id, original: compactItinerary(parent), forecast: trustedWeatherContext(trip, false),
    }, adaptationResponseSchema);
    if (generated.parent_version_id !== parent.id || (generated.demo && process.env.NODE_ENV === "production")) throw new TravelError("WEATHER_CONTEXT_CHANGED", "Reload your itinerary before adapting.", 409);
    if (!generated.changed) { await fail(); return { itinerary: parent, changed: false, explanation: generated.explanation }; }
    if (!generated.weather_fetched_at) throw new TravelError("WEATHER_CONTEXT_CHANGED", "A current forecast is required.", 409);
    // Keep the descriptions of unchanged choices. Factual fields still come from
    // the current trusted candidates and retain the database's existing checks.
    for (const day of generated.itinerary.days) {
      const previous = parent.itinerary.days.find(d => d.date === day.date);
      for (const item of day.items) {
        const unchanged = previous?.items.find(old => old.period === item.period && old.candidate_type === item.candidate_type && old.candidate_id === item.candidate_id);
        if (unchanged) { item.reason = unchanged.reason; item.notes = unchanged.notes; }
      }
    }
    const document = JSON.stringify(generated.itinerary);
    const payload = JSON.stringify({ ...proofBase, kind: "itinerary_version", generation_reason: "weather_adaptation",
      parent_version_id: parent.id, parent_document_hash: parent.document_hash,
      weather_fetched_at: generated.weather_fetched_at, provider: generated.provider, model_name: generated.model_name,
      prompt_version: generated.prompt_version, demo: generated.demo, trip_context: itineraryTripContext(trip),
      document_hash: createHash("sha256").update(document).digest("hex") });
    const { error } = await db.rpc("complete_weather_adaptation", { p_payload: payload, p_signature: signProof(payload, key), p_document: document });
    if (error) throw adaptationDatabaseError(error);
    const saved = await getItinerary(db, trip, versionId);
    if (!saved) throw new TravelError("ITINERARY_PERSISTENCE_UNAVAILABLE", "We couldn't confirm the saved adaptation.");
    return { itinerary: saved, changed: true, explanation: generated.explanation };
  } catch (error) { await fail(); throw error; }
}
