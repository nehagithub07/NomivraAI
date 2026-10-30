import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { handleCompanionAction } from "@/lib/companion/actions";
import { emptyBodySchema } from "@/lib/companion/validation";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ tripId: string; actionId: string }> };
export async function POST(request: Request, { params }: Context) {
  return travelRoute(request, emptyBodySchema, async (_, userId) => {
    const { tripId, actionId } = await params;
    return handleCompanionAction(await createClient(), tripId, userId, actionId, "confirm");
  });
}
