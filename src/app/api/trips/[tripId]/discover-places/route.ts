import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { callTravelApi, internalKey, TravelError } from "@/lib/destinations/backend";
import { travelRoute } from "@/lib/destinations/bff";
import { signProof } from "@/lib/destinations/proof";
import { discoveryResponseSchema, type NormalizedPlace } from "@/lib/destinations/validation";
import { getPersistedPlaces } from "@/lib/destinations/persistence";

// Authenticated requests for the same owned trip share one bounded backend fetch/write.
const inFlight = new Map<string, Promise<{ places: NormalizedPlace[] }>>();
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, z.object({}).strict(), async (_body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const db = await createClient({ writable: true });
    const { data: trip, error } = await db.from("trips").select("destination_provider, destination_provider_id, destination_latitude, destination_longitude")
      .eq("id", tripId).eq("owner_id", userId).maybeSingle();
    if (error) throw new TravelError("database_unavailable", "We couldn't load your trip. Please try again.");
    if (!trip) throw new TravelError("not_found", "Trip not found.", 404);
    if (trip.destination_provider !== "open_meteo" || !trip.destination_provider_id || trip.destination_latitude === null || trip.destination_longitude === null) throw new TravelError("unresolved_destination", "This trip's destination details are not available yet.", 409);
    console.info("[places] discovery_requested");
    const places = await getPersistedPlaces(db, tripId);
    if (places.length) {
      console.info("[places] discovery_reused", { count: places.length });
      return { places };
    }
    const key = `${userId}:${tripId}`, existing = inFlight.get(key);
    if (existing) {
      console.info("[places] discovery_joined");
      return existing;
    }
    const discovery = (async () => {
      const result = await callTravelApi("places/discover", { latitude: trip.destination_latitude, longitude: trip.destination_longitude }, discoveryResponseSchema);
      const now = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({ kind: "discovery", user_id: userId, trip_id: tripId, expires_at: now + 300, refreshed_at: now, places: result.places });
      const { error: saveError } = await db.rpc("persist_trip_place_candidates", { p_payload: payload, p_signature: signProof(payload, internalKey()) });
      if (saveError) throw new TravelError("persistence_unavailable", "We couldn't save places right now. Your trip is safe.");
      console.info("[places] discovery_persisted", { count: result.places.length });
      return { places: result.places };
    })();
    inFlight.set(key, discovery);
    try { return await discovery; }
    finally { inFlight.delete(key); }
  });
}
