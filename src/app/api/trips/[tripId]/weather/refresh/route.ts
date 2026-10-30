import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { loadOwnedItineraryTrip } from "@/lib/itineraries/server";
import { getTripWeather } from "@/lib/weather/server";
import { weatherReadSchema } from "@/lib/weather/validation";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, weatherReadSchema, async (body, userId) => {
    const db = await createClient({ writable: true });
    return getTripWeather(db, await loadOwnedItineraryTrip(db, (await params).tripId, userId), true, body.version_id);
  });
}
