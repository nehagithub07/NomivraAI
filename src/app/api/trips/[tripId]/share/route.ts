import { z } from "zod";
import { travelRoute } from "@/lib/destinations/bff";
import { createClient } from "@/lib/supabase/server";
import { loadOwnedItineraryTrip } from "@/lib/itineraries/server";
import { executeShareCommand, getShareState } from "@/lib/sharing/server";
import { shareCommandSchema } from "@/lib/exports/validation";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, { params }: Context) {
  return travelRoute(request, z.strictObject({}), async (_, userId) => {
    const db = await createClient(), trip = await loadOwnedItineraryTrip(db, (await params).tripId, userId);
    return getShareState(db, trip.id, userId);
  });
}
export async function POST(request: Request, { params }: Context) {
  return travelRoute(request, shareCommandSchema, async (body, userId) => executeShareCommand(await createClient(), (await params).tripId, userId, body));
}
