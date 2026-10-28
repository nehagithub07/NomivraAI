import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { normalizedPlaceSchema, type NormalizedPlace } from "./validation";
import { TravelError } from "./backend";

export async function getPersistedPlaces(db: SupabaseClient<Database>, tripId: string): Promise<NormalizedPlace[]> {
  const { data, error } = await db.from("trip_place_candidates").select("distance_km, places(provider, provider_place_id, name, category, latitude, longitude, metadata)")
    .eq("trip_id", tripId).eq("source", "overpass").order("distance_km", { ascending: true }).limit(30);
  if (error) throw new TravelError("database_unavailable", "We couldn't load saved places. Please try again.");
  return (data || []).flatMap((candidate) => {
    if (!candidate.places) return [];
    const result = normalizedPlaceSchema.safeParse({ ...candidate.places, distance_km: Number(candidate.distance_km), tags: candidate.places.metadata || {} });
    return result.success ? [result.data] : [];
  });
}
