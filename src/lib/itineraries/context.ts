import type { TripWithInterests } from "@/lib/trips/queries";

// Kept aligned with nomvira_private.itinerary_trip_context. JSONB comparison is order independent.
export function itineraryTripContext(trip: TripWithInterests) {
  return {
    destination_provider: trip.destination_provider, destination_provider_id: trip.destination_provider_id,
    destination_name: trip.destination_name, destination_country: trip.destination_country,
    destination_latitude: trip.destination_latitude, destination_longitude: trip.destination_longitude,
    destination_timezone: trip.destination_timezone, start_date: trip.start_date, end_date: trip.end_date,
    travelers_count: trip.travelers_count, budget_total: Number(trip.budget_total), currency: trip.currency,
    budget_style: trip.budget_style, travel_pace: trip.travel_pace,
    accommodation_preferences: trip.accommodation_preferences, dietary_preferences: trip.dietary_preferences,
    special_requests: trip.special_requests, interests: trip.trip_interests.map(i => i.interest).sort(),
  };
}
export function sameContext(first: Record<string, unknown>, second: Record<string, unknown>) {
  return Object.keys(first).length === Object.keys(second).length && Object.entries(first).every(([key, value]) => JSON.stringify(value) === JSON.stringify(second[key]));
}
