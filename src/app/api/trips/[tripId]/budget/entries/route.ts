import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { createBudgetEntrySchema } from "@/lib/budget/validation";
import { createBudgetEntry, loadOwnedBudgetTrip } from "@/lib/budget/server";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, createBudgetEntrySchema, async (body, userId) => {
    const db = await createClient({ writable: true });
    return createBudgetEntry(db, await loadOwnedBudgetTrip(db, (await params).tripId, userId), body);
  });
}
