import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { emptyBudgetSchema } from "@/lib/budget/validation";
import { getBudgetSummary, loadOwnedBudgetTrip } from "@/lib/budget/server";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return travelRoute(request, emptyBudgetSchema, async (_, userId) => {
    const db = await createClient({ writable: true });
    return getBudgetSummary(db, await loadOwnedBudgetTrip(db, (await params).tripId, userId));
  });
}
