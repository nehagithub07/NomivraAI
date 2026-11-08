import { z } from "zod";
import { travelRoute } from "@/lib/destinations/bff";
import { createClient } from "@/lib/supabase/server";
import { loadOwnedItineraryTrip } from "@/lib/itineraries/server";
import { buildExportDocument } from "@/lib/exports/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, z.strictObject({}), async (_, userId) => {
    const db = await createClient(), trip = await loadOwnedItineraryTrip(db, (await params).tripId, userId);
    return buildExportDocument(db, trip);
  });
}
