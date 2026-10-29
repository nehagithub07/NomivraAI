import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { TravelError } from "@/lib/destinations/backend";
import { foodSelectionBodySchema, foodRemoveBodySchema } from "@/lib/food/validation";
import { getFoodSelections, loadOwnedFoodTrip, foodSelectionFailure, verifyFoodSelection } from "@/lib/food/server";

type Context = { params: Promise<{ tripId: string }> };
export async function POST(request: Request, { params }: Context) {
  return travelRoute(request, foodSelectionBodySchema, async (body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const db = await createClient({ writable: true }), trip = await loadOwnedFoodTrip(db, tripId, userId);
    verifyFoodSelection(body.proof, trip, userId);
    const { error } = await db.rpc("save_trip_food", { p_payload: body.proof.payload, p_signature: body.proof.signature });
    if (error) throw foodSelectionFailure(error);
    try { return { selections: await getFoodSelections(db, tripId) }; }
    catch { throw new TravelError("selection_unconfirmed", "Reload to check your saved food spots."); }
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return travelRoute(request, foodRemoveBodySchema, async (body, userId) => {
    const { tripId } = await params;
    if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
    const db = await createClient({ writable: true });
    await loadOwnedFoodTrip(db, tripId, userId);
    const { error } = await db.from("trip_food_selections").delete().eq("trip_id", tripId).eq("id", body.selection_id);
    if (error) throw foodSelectionFailure(error);
    try { return { selections: await getFoodSelections(db, tripId) }; }
    catch { throw new TravelError("selection_unconfirmed", "Reload to check your saved food spots."); }
  });
}
