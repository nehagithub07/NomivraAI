import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { TravelError } from "@/lib/destinations/backend";
import { hotelSearchBodySchema } from "@/lib/accommodations/validation";
import { getCachedHotels, loadOwnedHotelTrip, searchTripHotels } from "@/lib/accommodations/server";

type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, { params }: Context) {
  return travelRoute(request, z.object({}).strict(), async (_body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const trip = await loadOwnedHotelTrip(await createClient({ writable: true }), tripId, userId);
    // A read never spends provider quota, even on a cache miss.
    return { results: getCachedHotels(userId, trip) };
  });
}
export async function POST(request: Request, { params }: Context) {
  return travelRoute(request, hotelSearchBodySchema, async (body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const trip = await loadOwnedHotelTrip(await createClient({ writable: true }), tripId, userId);
    return { results: await searchTripHotels(trip, userId, body.refresh === true, body.demo === true) };
  });
}
