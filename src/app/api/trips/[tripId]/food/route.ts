import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { TravelError } from "@/lib/destinations/backend";
import { foodSearchBodySchema } from "@/lib/food/validation";
import { getCachedFood, loadOwnedFoodTrip, searchTripFood } from "@/lib/food/server";

type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, { params }: Context) {
  return travelRoute(request, z.object({}).strict(), async (_body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const trip = await loadOwnedFoodTrip(await createClient({ writable: true }), tripId, userId);
    return { results: getCachedFood(userId, trip) };
  });
}
export async function POST(request: Request, { params }: Context) {
  return travelRoute(request, foodSearchBodySchema, async (body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const trip = await loadOwnedFoodTrip(await createClient({ writable: true }), tripId, userId);
    return { results: await searchTripFood(trip, userId, body) };
  });
}
