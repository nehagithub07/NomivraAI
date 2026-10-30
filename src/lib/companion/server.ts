import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadOwnedItineraryTrip } from "@/lib/itineraries/server";
import { callTravelApi, TravelError } from "@/lib/destinations/backend";
import { buildCompanionContext, hydrateCompanionRecommendations } from "./context";
import { getCachedHotels, getStaySelection } from "@/lib/accommodations/server";
import { persistableCompanionResponse } from "./retention";
import { companionDatabaseError, prepareCompanionAction, publicAction, signedCompanionProof } from "./actions";
import { readCompanionTool } from "./tools";
import { actionSchema, cardSchema, stepSchema, writeTools, type ChatMessage, type ChatState, type PublicAction, type CompanionResponse } from "./validation";

type DB = SupabaseClient<Database>;
export async function getCompanionState(db: DB, tripId: string, userId: string): Promise<ChatState> {
  const trip = await loadOwnedItineraryTrip(db, tripId, userId);
  const { data: conversation, error } = await db.from("companion_conversations").select("id").eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
  if (error) throw companionDatabaseError(error);
  const { data: rows, error: actionError } = await db.from("companion_pending_actions").select("*").eq("trip_id", tripId).eq("user_id", userId).order("created_at", { ascending: false }).limit(40);
  if (actionError) throw companionDatabaseError(actionError);
  const parsedActions = (rows ?? []).map(a => actionSchema.parse(a));
  if (parsedActions.some(a => a.tool_name === "select_hotel" && a.status === "pending" && Date.parse(a.expires_at) > Date.now())) await hydrateCompanionRecommendations(trip);
  const hotelCache = getCachedHotels(userId, trip);
  const stay = parsedActions.some(a => a.tool_name === "select_hotel") ? await getStaySelection(db, tripId) : null;
  const current = stay && hotelCache?.candidates.find(h => h.provider_accommodation_id === stay.provider_accommodation_id);
  const actions = parsedActions.map(a => {
    const safe = publicAction(a);
    if (a.tool_name !== "select_hotel" || safe.status !== "pending") return safe;
    const hotel = hotelCache?.candidates.find(h => h.provider === "stayapi" && h.provider_accommodation_id === a.arguments.provider_accommodation_id);
    return { ...safe, preview: { ...safe.preview, current: current?.name ?? (stay ? "Saved stay · details expired" : "No stay selected"), proposed: hotel?.name ?? "Chosen stay details expired. Search Hotels and request the change again.", confirmable: !!hotel } };
  });
  if (!conversation) return { messages: [], actions };
  const { data, error: messageError } = await db.from("companion_messages").select("id,role,content,created_at,metadata").eq("conversation_id", conversation.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(40);
  if (messageError) throw companionDatabaseError(messageError);
  const messages: ChatMessage[] = data.reverse().map(m => {
    const response = z.object({ cards: z.array(cardSchema).max(5).optional(), suggested_actions: z.array(z.string()).max(3).optional(), pending_action_id: z.uuid().optional(), reference_date: z.iso.date().nullable().optional() }).passthrough().safeParse(m.metadata.response);
    return { id: m.id, role: m.role, content: m.content, created_at: m.created_at, ...(response.success ? { cards: response.data.cards, suggested_actions: response.data.suggested_actions, pending_action_id: response.data.pending_action_id, reference_date: response.data.reference_date } : {}) };
  });
  return { messages, actions };
}
async function boundedRead<T>(operation: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TravelError("COMPANION_TOOL_TIMEOUT", "Trip information took too long.")), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function sendCompanionMessage(db: DB, tripId: string, userId: string, requestId: string, message: string) {
  const trip = await loadOwnedItineraryTrip(db, tripId, userId);
  const { data, error } = await db.rpc("begin_companion_message", { p_trip_id: tripId, p_request_id: requestId, p_content: message });
  if (error) throw companionDatabaseError(error);
  const reservation = z.object({ conversation_id: z.uuid(), duplicate: z.boolean(), response: z.unknown().optional() }).parse(data);
  if (reservation.duplicate) {
    if (!reservation.response) throw new TravelError("COMPANION_RATE_LIMITED", "This message is still processing. Reload in a moment.", 429);
    return getCompanionState(db, tripId, userId);
  }
  const deadline = Date.now() + 85_000;
  let response: CompanionResponse | null = null, pending: PublicAction | undefined, failure: unknown;
  try {
    const state = await getCompanionState(db, tripId, userId);
    const context = await boundedRead(() => buildCompanionContext(db, trip), 18_000);
    const reference = state.messages.findLast(m => m.role === "assistant" && m.reference_date)?.reference_date;
    if (reference && reference >= trip.start_date && reference <= trip.end_date) context.reference_date = reference;
    const history = state.messages.filter(m => m.id !== requestId).slice(-12).map(m => ({ role: m.role, content: m.content }));
    let step = await callTravelApi("companion/chat", { user_id: userId, trip_id: tripId, message, context, history }, stepSchema);
    let count = 0;
    while (!step.response) {
      if (!step.continuation_id || !step.calls.length || (count += step.calls.length) > 5 || Date.now() > deadline) throw new TravelError("COMPANION_TOOL_LIMIT", "Please ask one smaller trip question at a time.", 422);
      const results = [];
      for (const call of step.calls) {
        try {
          const write = writeTools.has(call.name);
          if (write !== (call.permission === "WRITE_CONFIRMATION_REQUIRED")) throw new Error();
          if (write) {
            if (pending) throw new Error();
            pending = await prepareCompanionAction(db, trip, call, message);
            results.push({ call_id: call.id, name: call.name, status: "confirmation_required", data: { preview: pending.preview } });
          } else {
            const result = await boundedRead(() => readCompanionTool(db, trip, call), Math.min(18_000, Math.max(1, deadline - Date.now())));
            if (Buffer.byteLength(JSON.stringify(result)) > 32000) throw new Error();
            results.push({ call_id: call.id, name: call.name, status: "ok", data: result });
          }
        } catch (error) {
          results.push({ call_id: call.id, name: call.name, status: error instanceof z.ZodError || error instanceof TravelError && error.status === 422 ? "invalid_arguments" : "unavailable", data: { message: "This trip data or action is unavailable. Check the relevant trip tab or clarify your request." } });
        }
      }
      step = await callTravelApi("companion/chat", { user_id: userId, trip_id: tripId, continuation_id: step.continuation_id, results }, stepSchema);
    }
    response = step.response;
  } catch (error) { failure = error; }
  const retained = response ? persistableCompanionResponse(response) : { message: "I couldn't complete that request. Your saved trip is safe. Check the relevant trip tab or try again.", cards: [] };
  const document = JSON.stringify({ ...retained, suggested_actions: response?.suggested_actions ?? [], ...(pending ? { pending_action_id: pending.id } : {}), model: response?.model_name ?? null, prompt_version: response?.prompt_version ?? "v1", tool_audit: response?.tool_audit ?? [], reference_date: response?.reference_date ?? null });
  const saved = await db.rpc("finish_companion_message", { ...signedCompanionProof("companion_message", trip, { request_id: requestId, document_hash: createHash("sha256").update(document).digest("hex") }), p_document: document });
  if (saved.error) throw new TravelError("COMPANION_PERSISTENCE_UNAVAILABLE", "Reload to check the saved chat before sending again.");
  if (failure) throw failure;
  const state = await getCompanionState(db, tripId, userId);
  // Current provider facts are transient; durable history retains permitted fields only.
  if (response) state.messages = state.messages.map(m => m.id === saved.data ? { ...m, content: response.message, cards: response.cards } : m);
  return state;
}
