import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { travelRoute } from "@/lib/destinations/bff";
import { executeMemoryCommand, getMemoryState } from "@/lib/memory/server";
import { memoryCommandSchema } from "@/lib/memory/validation";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return travelRoute(request, z.strictObject({}), async (_, userId) => getMemoryState(await createClient(), userId));
}
export async function POST(request: Request) {
  return travelRoute(request, memoryCommandSchema, async (body, userId) => executeMemoryCommand(await createClient(), userId, body));
}
