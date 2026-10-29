import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { generationBodySchema } from "@/lib/itineraries/validation";
import { generateTripItinerary, loadOwnedItineraryTrip } from "@/lib/itineraries/server";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, generationBodySchema, async (body, userId) => {
    const db = await createClient({ writable: true });
    const trip = await loadOwnedItineraryTrip(db, (await params).tripId, userId);
    return generateTripItinerary(db, trip, userId, body.request_id, body.regenerate);
  });
}
