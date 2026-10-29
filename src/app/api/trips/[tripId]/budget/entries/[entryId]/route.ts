import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { deleteBudgetEntrySchema, updateBudgetEntrySchema } from "@/lib/budget/validation";
import { deleteBudgetEntry, loadOwnedBudgetTrip, updateBudgetEntry } from "@/lib/budget/server";

export const runtime = "nodejs";
type Props = { params: Promise<{ tripId: string; entryId: string }> };
export async function PATCH(request: Request, { params }: Props) {
  return travelRoute(request, updateBudgetEntrySchema, async (body, userId) => {
    const db = await createClient({ writable: true }), { tripId, entryId } = await params;
    return updateBudgetEntry(db, await loadOwnedBudgetTrip(db, tripId, userId), entryId, body);
  });
}
export async function DELETE(request: Request, { params }: Props) {
  return travelRoute(request, deleteBudgetEntrySchema, async (_, userId) => {
    const db = await createClient({ writable: true }), { tripId, entryId } = await params;
    return deleteBudgetEntry(db, await loadOwnedBudgetTrip(db, tripId, userId), entryId);
  });
}
