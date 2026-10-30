import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { loadOwnedItineraryTrip } from "@/lib/itineraries/server";
import { adaptTripWeather } from "@/lib/weather/server";
import { adaptWeatherBodySchema } from "@/lib/weather/validation";

export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, adaptWeatherBodySchema, async (body, userId) => {
    const db = await createClient({ writable: true });
    return adaptTripWeather(db, await loadOwnedItineraryTrip(db, (await params).tripId, userId), userId, body.request_id, body.expected_version_id);
  });
}
