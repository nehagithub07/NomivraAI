import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { internalKey, TravelError } from "@/lib/destinations/backend";
import { verifyProof } from "@/lib/destinations/proof";
import { accommodationContext } from "@/lib/accommodations/context";
import { clearSelectionBodySchema, hotelSelectionBodySchema } from "@/lib/accommodations/validation";
import { getStaySelection, loadOwnedHotelTrip, selectionFailure } from "@/lib/accommodations/server";

type Context = { params: Promise<{ tripId: string }> };
export async function POST(request: Request, { params }: Context) {
  return travelRoute(request, hotelSelectionBodySchema, async (body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const db = await createClient({ writable: true });
    const trip = await loadOwnedHotelTrip(db, tripId, userId);
    try {
      if (!verifyProof(body.proof.payload, body.proof.signature, internalKey())) throw new Error();
      const proof = z.object({ kind: z.literal("accommodation_selection"), user_id: z.literal(userId),
        trip_id: z.literal(tripId), provider: z.enum(["stayapi", "fixture"]),
        expires_at: z.number().int().min(Math.floor(Date.now() / 1000) + 1).max(Math.floor(Date.now() / 1000) + 1800),
        context: z.record(z.string(), z.unknown()) }).parse(JSON.parse(body.proof.payload));
      if (JSON.stringify(proof.context) !== JSON.stringify(accommodationContext(trip))) throw new Error();
      if (proof.provider === "fixture" && process.env.NODE_ENV === "production") throw new Error();
    } catch { throw new TravelError("selection_expired", "Search again before selecting a stay.", 409); }
    const { error } = await db.rpc("select_trip_accommodation", {
      p_payload: body.proof.payload, p_signature: body.proof.signature, p_expected_id: body.expected_selection_id,
    });
    if (error) throw selectionFailure(error);
    try { return { selection: await getStaySelection(db, tripId) }; }
    catch { throw new TravelError("selection_unconfirmed", "Reload to check your saved stay."); }
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return travelRoute(request, clearSelectionBodySchema, async (body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const db = await createClient({ writable: true });
    await loadOwnedHotelTrip(db, tripId, userId);
    const { data, error } = await db.from("trip_accommodation_selections").delete().eq("trip_id", tripId).eq("id", body.expected_selection_id).select("id");
    if (error) throw selectionFailure(error);
    if (!data.length) throw new TravelError("selection_conflict", "Reload to see your current selected stay.", 409);
    return { selection: null };
  });
}
