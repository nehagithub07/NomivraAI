import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TripWithInterests } from "@/lib/trips/queries";
import { internalKey, TravelError } from "@/lib/destinations/backend";
import { defaultPreferences, memoryCommandSchema, memoryRecordSchema, preferencesSchema, type MemoryState } from "./validation";

type DB = SupabaseClient<Database>;
const fields = "id,kind,feedback,preferences,source_trip_id,content,created_at" as const;

export async function getMemoryState(db: DB, userId: string): Promise<MemoryState> {
  const fallback: MemoryState = { preferences: defaultPreferences, memoryEnabled: false, memories: [], available: false };
  try {
    const { data: profile, error } = await db.from("travel_preferences").select("preferences,memory_enabled").eq("user_id", userId).maybeSingle();
    if (error) return fallback;
    const { data, error: memoryError } = await db.from("travel_memories").select(fields).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
    if (memoryError) return fallback;
    return {
      preferences: profile ? preferencesSchema.parse(profile.preferences) : defaultPreferences,
      memoryEnabled: profile?.memory_enabled ?? false,
      memories: z.array(memoryRecordSchema).max(200).parse(data ?? []), available: true,
    };
  } catch { return fallback; }
}

async function embed(userId: string, text: string, purpose: "document" | "query", signal?: AbortSignal) {
  const base = process.env.NOMVIRA_API_URL;
  if (!base) throw new Error("Memory unavailable");
  const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/memory/embed`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(6000), ...(signal ? [signal] : [])]),
    headers: { "Content-Type": "application/json", "X-Nomvira-Internal-Key": internalKey() },
    body: JSON.stringify({ user_id: userId, text, purpose }),
  });
  if (!response.ok) throw new Error("Memory unavailable");
  const result = z.object({ model: z.literal("gemini-embedding-001"), embedding: z.array(z.number().finite()).length(768) }).parse(await response.json());
  if (!result.embedding.some(v => v !== 0)) throw new Error("Memory unavailable");
  return JSON.stringify(result.embedding);
}

async function indexPending(db: DB, userId: string, id?: string, signal?: AbortSignal) {
  const claim = db.rpc("claim_travel_memory_index", id ? { p_id: id } : {});
  const { data, error } = await (signal ? claim.abortSignal(signal) : claim);
  if (error) return;
  const pending = z.array(z.object({ id: z.uuid(), content: z.string().max(2000) })).max(3).parse(data);
  await Promise.all(pending.map(async row => {
    try {
      const vector = await embed(userId, row.content, "document", signal);
      // Compare exact content; a concurrent delete or opt-out cannot recreate a row.
      const write = db.rpc("index_travel_memory", { p_id: row.id, p_content: row.content, p_embedding: vector });
      await (signal ? write.abortSignal(signal) : write);
    } catch { /* Retry is bounded by the database lease; core trip workflows continue. */ }
  }));
}

export async function executeMemoryCommand(db: DB, userId: string, input: z.infer<typeof memoryCommandSchema>) {
  const command = memoryCommandSchema.parse(input);
  let error: { code?: string } | null;
  let id: string | undefined;
  switch (command.action) {
    case "preferences":
      ({ error } = await db.rpc("update_travel_preferences", { p_preferences: command.preferences, p_enabled: command.memoryEnabled }));
      break;
    case "remember": case "trip": {
      const result = await db.rpc("save_travel_memory", {
        p_kind: command.action === "trip" ? "trip" : command.kind,
        p_preferences: command.action === "trip" ? defaultPreferences : command.preferences,
        p_feedback: command.feedback,
        ...(command.action === "trip" ? { p_trip_id: command.tripId } : {}),
      });
      error = result.error; id = result.data ?? undefined;
      break;
    }
    default:
      ({ error } = await db.rpc("delete_travel_memory", {
        ...(command.action === "delete" ? { p_id: command.id } : {}),
        p_reset: command.action === "reset",
      }));
  }
  if (error) throw new TravelError("MEMORY_SAVE_FAILED", "Could not save this change. Check memory consent and the selected trip, then try again.", error.code === "42501" ? 403 : error.code === "22023" ? 422 : 503);
  if (id) await indexPending(db, userId, id).catch(() => undefined);
  const state = await getMemoryState(db, userId);
  if (!state.available) throw new TravelError("MEMORY_UNAVAILABLE", "Reload to check your preferences and memories.");
  return state;
}

export async function retrieveTravelMemories(db: DB, userId: string, trip: TripWithInterests) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      retrieveWithSignal(db, userId, trip, controller.signal),
      new Promise<[]>(resolve => { timer = setTimeout(() => { controller.abort(); resolve([]); }, 8000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function retrieveWithSignal(db: DB, userId: string, trip: TripWithInterests, signal: AbortSignal) {
  try {
    if (trip.owner_id !== userId) return [];
    const { data: profile, error } = await db.from("travel_preferences").select("memory_enabled").eq("user_id", userId).abortSignal(signal).maybeSingle();
    if (error || !profile?.memory_enabled) return [];
    await indexPending(db, userId, undefined, signal);
    const indexed = await db.from("travel_memories").select("id").eq("user_id", userId).eq("embedding_model", "gemini-embedding-001").limit(1).abortSignal(signal);
    if (indexed.error || !indexed.data?.length) return [];
    // Deliberately exclude chat, special requests, dates and location from embedding input.
    const query = preferencesSchema.parse({
      interests: trip.trip_interests.map(i => i.interest), travelPace: trip.travel_pace,
      budgetStyle: trip.budget_style, dietaryPreferences: trip.dietary_preferences,
      accommodationPreferences: trip.accommodation_preferences,
    });
    const vector = await embed(userId, JSON.stringify(query), "query", signal);
    const result = await db.rpc("match_travel_memories", { p_embedding: vector, p_limit: 5 }).abortSignal(signal);
    if (result.error) return [];
    const rows = z.array(memoryRecordSchema).max(5).parse(result.data);
    if (!rows.length) return [];
    // Recheck consent and existence after network calls and concurrent deletion.
    const [current, existing] = await Promise.all([
      db.from("travel_preferences").select("memory_enabled").eq("user_id", userId).abortSignal(signal).maybeSingle(),
      db.from("travel_memories").select("id").eq("user_id", userId).in("id", rows.map(m => m.id)).abortSignal(signal),
    ]);
    if (current.error || !current.data?.memory_enabled || existing.error) return [];
    const allowed = new Set((existing.data ?? []).map(m => m.id));
    return rows.filter(m => allowed.has(m.id)).map(({ id, kind, feedback, preferences }) => ({ id, kind, feedback, preferences }));
  } catch { return []; }
}
