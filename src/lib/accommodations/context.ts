import type { TripRow } from "@/lib/supabase/database.types";

export const ADULTS_PER_ROOM = 2;
export function roomsForTravelers(travelers: number) { return Math.ceil(travelers / ADULTS_PER_ROOM); }
export function accommodationContext(trip: TripRow) {
  return {
    destination_provider: trip.destination_provider,
    destination_provider_id: trip.destination_provider_id,
    destination_latitude: trip.destination_latitude,
    destination_longitude: trip.destination_longitude,
    start_date: trip.start_date, end_date: trip.end_date, travelers_count: trip.travelers_count,
    currency: trip.currency, budget_total: Number(trip.budget_total), budget_style: trip.budget_style,
    accommodation_preferences: trip.accommodation_preferences,
  };
}
export function hotelNights(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}
