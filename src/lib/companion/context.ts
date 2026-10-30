import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TripWithInterests } from "@/lib/trips/queries";
import { getItinerary } from "@/lib/itineraries/server";
import { getStaySelection, searchTripHotels } from "@/lib/accommodations/server";
import { getFoodSelections, searchTripFood } from "@/lib/food/server";
import { getPersistedPlaces } from "@/lib/destinations/persistence";
import { getBudgetSummary } from "@/lib/budget/server";
import { getTripWeather } from "@/lib/weather/server";

export async function hydrateCompanionRecommendations(trip: TripWithInterests) {
  // Cache-only service reads survive Vercel route isolation. Neither cache miss
  // spends provider quota; the existing service enforces that boundary.
  await Promise.allSettled([
    searchTripHotels(trip, trip.owner_id, false, false, true),
    searchTripFood(trip, trip.owner_id, {}, true),
  ]);
}
export async function buildCompanionContext(db: SupabaseClient<Database>, trip: TripWithInterests) {
  await hydrateCompanionRecommendations(trip);
  const [itinerary, stay, food, places, budget, weather] = await Promise.all([
    getItinerary(db, trip).catch(() => null), getStaySelection(db, trip.id).catch(() => null),
    getFoodSelections(db, trip.id).catch(() => []), getPersistedPlaces(db, trip.id).catch(() => []),
    getBudgetSummary(db, trip).catch(() => null), getTripWeather(db, trip).catch(() => null),
  ]);
  return {
    destination: trip.destination_name, country: trip.destination_country, timezone: trip.destination_timezone,
    start_date: trip.start_date, end_date: trip.end_date, travelers: trip.travelers_count,
    currency: trip.currency, budget_style: trip.budget_style, travel_pace: trip.travel_pace,
    interests: trip.trip_interests.map(i => i.interest), dietary_preferences: trip.dietary_preferences,
    accommodation_preferences: trip.accommodation_preferences,
    itinerary_version: itinerary && !itinerary.stale ? itinerary.id : null,
    selected_hotel: !!stay, selected_hotel_name: null,
    saved_food_count: food.length, discovered_place_count: places.length,
    reference_date: null as string | null,
    budget_summary: budget ? { total_budget: budget.total_budget, remaining_budget: budget.remaining_budget, currency: budget.currency, status: budget.budget_status } : null,
    weather_availability: weather?.forecast.availability ?? "unavailable",
  };
}
