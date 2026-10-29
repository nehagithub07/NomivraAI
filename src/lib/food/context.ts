import type { TripRow } from "@/lib/supabase/database.types";

export function foodContext(trip: TripRow) {
  return { destination_provider: trip.destination_provider, destination_provider_id: trip.destination_provider_id,
    destination_latitude: trip.destination_latitude, destination_longitude: trip.destination_longitude,
    dietary_preferences: trip.dietary_preferences };
}
