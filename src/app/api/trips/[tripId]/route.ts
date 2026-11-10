import { revalidatePath } from "next/cache";
import { z } from "zod";
import { travelRoute } from "@/lib/destinations/bff";
import { TravelError } from "@/lib/destinations/backend";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, z.strictObject({}), async (_, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) {
      throw new TravelError("invalid_request", "Check your trip details.", 422);
    }
    const db = await createClient();
    // One owner-scoped mutation; RLS and foreign-key cascades remain authoritative.
    const { data, error } = await db.from("trips").delete()
      .eq("id", tripId).eq("owner_id", userId).select("id").maybeSingle();
    if (error) throw new TravelError("TRIP_DELETE_FAILED", "We couldn't confirm deletion. Refresh My Trips before trying again.");
    if (!data) throw new TravelError("not_found", "Trip not found.", 404);
    revalidatePath("/trips");
    revalidatePath("/");
    return { deleted: true };
  });
}
