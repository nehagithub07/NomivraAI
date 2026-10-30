import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { getCompanionState, sendCompanionMessage } from "@/lib/companion/server";
import { emptyBodySchema, messageBodySchema } from "@/lib/companion/validation";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, { params }: Context) {
  return travelRoute(request, emptyBodySchema, async (_, userId) => getCompanionState(await createClient(), (await params).tripId, userId));
}
export async function POST(request: Request, { params }: Context) {
  return travelRoute(request, messageBodySchema, async (body, userId) => sendCompanionMessage(await createClient(), (await params).tripId, userId, body.request_id, body.message));
}
