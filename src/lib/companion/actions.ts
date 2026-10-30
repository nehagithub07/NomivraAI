import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TripWithInterests } from "@/lib/trips/queries";
import { callTravelApi, internalKey, TravelError } from "@/lib/destinations/backend";
import { signProof } from "@/lib/destinations/proof";
import { itineraryTripContext } from "@/lib/itineraries/context";
import { buildTrustedPlanningInput, generateTripItinerary, getItinerary, loadOwnedItineraryTrip } from "@/lib/itineraries/server";
import { itineraryDocumentSchema } from "@/lib/itineraries/validation";
import { adaptTripWeather, compactItinerary } from "@/lib/weather/server";
import { createBudgetEntry } from "@/lib/budget/server";
import { createBudgetEntrySchema } from "@/lib/budget/validation";
import { getStaySelection, getCachedHotels } from "@/lib/accommodations/server";
import { signedHotelSchema } from "@/lib/accommodations/validation";
import { signedFoodSchema } from "@/lib/food/validation";
import { getCachedFood, verifyFoodSelection } from "@/lib/food/server";
import { buildCompanionContext } from "./context";
import { actionSchema, writeTools, type PendingAction, type PublicAction, type ToolCall } from "./validation";
import { checkDate } from "./tools";

type DB = SupabaseClient<Database>;
export function companionDatabaseError(error: { code?: string; message?: string }) {
  if (["PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"].includes(error.code ?? "")) return new TravelError("COMPANION_SETUP_REQUIRED", "Trip chat needs a database setup update.");
  if (error.message === "COMPANION_RATE_LIMITED") return new TravelError("COMPANION_RATE_LIMITED", "Please wait a moment before sending another message.", 429);
  if (error.code === "42501") return new TravelError("not_found", "Trip or action not found.", 404);
  return new TravelError("COMPANION_CONTEXT_CHANGED", "Reload your trip before requesting this change again.", 409);
}
export function signedCompanionProof(kind: string, trip: TripWithInterests, extra: Record<string, unknown>) {
  const payload = JSON.stringify({ kind, user_id: trip.owner_id, trip_id: trip.id, expires_at: Math.floor(Date.now() / 1000) + 180, ...extra });
  return { p_payload: payload, p_signature: signProof(payload, internalKey()) };
}
export const publicAction = (a: PendingAction): PublicAction => ({ id: a.id, tool_name: a.tool_name, preview: a.preview, status: a.status === "pending" && Date.parse(a.expires_at) <= Date.now() ? "expired" : a.status, result: a.result, expires_at: a.expires_at });
async function editDocument(db: DB, trip: TripWithInterests, name: string, args: Record<string, unknown>) {
  const parent = await getItinerary(db, trip);
  if (!parent || parent.stale || !parent.document_hash) throw new TravelError("COMPANION_CONTEXT_CHANGED", "Load a current itinerary first.", 409);
  const result = await callTravelApi("companion/itinerary/edit", { context: await buildTrustedPlanningInput(db, trip), original: compactItinerary(parent), tool_name: name, arguments: args }, z.object({ itinerary: itineraryDocumentSchema }).strict());
  return { parent, document: result.itinerary };
}
function hotelCandidate(trip: TripWithInterests, args: Record<string, unknown>) {
  const found = getCachedHotels(trip.owner_id, trip)?.candidates.find(c => c.provider === "stayapi" && c.provider_accommodation_id === args.provider_accommodation_id);
  const candidate = found ? signedHotelSchema.parse(found) : null;
  if (!candidate?.selection_proof) throw new TravelError("COMPANION_INVALID_ARGUMENTS", "Search Hotels again and choose a current recommendation.", 422);
  return candidate;
}
function foodCandidate(trip: TripWithInterests, args: Record<string, unknown>) {
  const found = getCachedFood(trip.owner_id, trip)?.candidates.find(c => c.provider === "geoapify" && c.provider_place_id === args.provider_place_id);
  const candidate = found ? signedFoodSchema.parse(found) : null;
  if (!candidate?.selection_proof || candidate.dietary_conflicts.some(d => trip.dietary_preferences.some(p => p === d))) throw new TravelError("COMPANION_INVALID_ARGUMENTS", "Choose a current Food recommendation that meets your preferences.", 422);
  verifyFoodSelection(candidate.selection_proof, trip, trip.owner_id);
  return candidate;
}
export async function prepareCompanionAction(db: DB, trip: TripWithInterests, call: ToolCall, message: string) {
  if (!writeTools.has(call.name) || call.permission !== "WRITE_CONFIRMATION_REQUIRED") throw new TravelError("COMPANION_INVALID_TOOL", "That action is unavailable.", 422);
  const context = await buildCompanionContext(db, trip);
  const { arguments: args } = await callTravelApi("companion/actions/validate", { context, tool_name: call.name, arguments: call.arguments, original_message: message }, z.object({ arguments: z.record(z.string(), z.unknown()) }).strict());
  let preview: Record<string, unknown>;
  switch (call.name) {
    case "move_itinerary_activity":
    case "replace_itinerary_activity": {
      const { parent, document } = await editDocument(db, trip, call.name, args);
      const source = parent.itinerary.days.find(d => d.items.some(i => i.candidate_type === "attraction" && i.candidate_id === args.candidate_id))!;
      const item = source.items.find(i => i.candidate_id === args.candidate_id)!;
      const target = document.days.find(d => d.items.some(i => i.candidate_id === (args.replacement_candidate_id ?? args.candidate_id)))!;
      const next = target.items.find(i => i.candidate_id === (args.replacement_candidate_id ?? args.candidate_id))!;
      preview = { title: call.name === "move_itinerary_activity" ? "Move this activity?" : "Replace this activity?", current: `${item.title} · ${source.date} ${item.period}`, proposed: `${next.title} · ${target.date} ${next.period}`, detail: "This creates a new itinerary version. Your previous version stays saved." };
      break;
    }
    case "select_hotel": {
      const next = hotelCandidate(trip, args), old = await getStaySelection(db, trip.id);
      const current = old && getCachedHotels(trip.owner_id, trip)?.candidates.find(c => c.provider_accommodation_id === old.provider_accommodation_id);
      preview = { title: "Change your selected stay?", current: current?.name ?? old?.selected_name ?? (old ? "Your saved stay (details expired)" : "No stay selected"), proposed: next.name, detail: "Saves your preference. This does not make a booking or lock a price." }; break;
    }
    case "save_food_selection":
      preview = { title: "Save this food spot?", proposed: foodCandidate(trip, args).name, detail: "Saves a reference. This does not reserve a table." }; break;
    case "add_budget_entry":
      checkDate(typeof args.expense_date === "string" ? args.expense_date : null, trip);
      createBudgetEntrySchema.parse({ ...args, id: randomUUID() });
      preview = { title: "Add this budget entry?", proposed: `${args.currency} ${args.amount} · ${args.description}`, detail: `${args.entry_type} · ${args.category}${args.expense_date ? ` · ${args.expense_date}` : ""}` }; break;
    case "create_itinerary_version":
    case "adapt_itinerary_for_weather":
      await buildTrustedPlanningInput(db, trip);
      if (call.name === "adapt_itinerary_for_weather" && !context.itinerary_version) throw new TravelError("COMPANION_CONTEXT_CHANGED", "Generate a current itinerary before adapting it.", 409);
      preview = { title: call.name === "create_itinerary_version" ? "Generate a new itinerary version?" : "Adapt your itinerary for weather?", proposed: call.name === "create_itinerary_version" ? "Plan with your saved places and preferences" : "Use the existing weather adaptation engine", detail: "Your previous itinerary remains available. Weather adaptation saves a new version only when a valid improvement exists." }; break;
    default: throw new TravelError("COMPANION_INVALID_TOOL", "That action is unavailable.", 422);
  }
  const stay = await getStaySelection(db, trip.id), itinerary = await getItinerary(db, trip);
  const storedPreview = call.name === "select_hotel" ? { title: preview.title, current: "Current saved stay reference", proposed: "Chosen stay reference · current details required", detail: preview.detail } : preview;
  const id = randomUUID(), document = JSON.stringify({ tool_name: call.name, arguments: args, preview: storedPreview,
    snapshot: { trip_context: itineraryTripContext(trip), itinerary_id: itinerary?.id ?? null, hotel_id: stay?.id ?? null, original_message: message } });
  const { error } = await db.rpc("prepare_companion_action", { ...signedCompanionProof("companion_action", trip, { action_id: id, document_hash: createHash("sha256").update(document).digest("hex") }), p_document: document });
  if (error) throw companionDatabaseError(error);
  return { id, tool_name: call.name, preview, status: "pending" as const, result: null, expires_at: new Date(Date.now() + 300_000).toISOString() };
}

async function executeEdit(db: DB, trip: TripWithInterests, action: PendingAction) {
  const { parent, document } = await editDocument(db, trip, action.tool_name, action.arguments);
  const { data: id, error } = await db.rpc("begin_companion_itinerary_edit", { p_trip_id: trip.id, p_request_id: action.id, p_parent_version_id: parent.id });
  if (error || !id) throw companionDatabaseError(error ?? {});
  const proofBase = { version_id: id };
  try {
    const text = JSON.stringify(document);
    const result = await db.rpc("complete_companion_itinerary_edit", { ...signedCompanionProof("itinerary_version", trip, { ...proofBase, generation_reason: "companion_edit", parent_version_id: parent.id, parent_document_hash: parent.document_hash, provider: parent.provider, model_name: parent.model_name, prompt_version: "companion-edit-v1", demo: parent.demo, trip_context: itineraryTripContext(trip), document_hash: createHash("sha256").update(text).digest("hex") }), p_document: text });
    if (result.error) throw companionDatabaseError(result.error);
    const saved = await getItinerary(db, trip, id);
    if (!saved) throw new TravelError("COMPANION_PERSISTENCE_UNAVAILABLE", "Reload your itinerary to check the result.");
    return { message: `Your change is saved in itinerary version ${saved.version_number}.`, version: saved.version_number };
  } catch (error) {
    await db.rpc("fail_itinerary_generation", signedCompanionProof("itinerary_failure", trip, proofBase));
    throw error;
  }
}
export async function handleCompanionAction(db: DB, tripId: string, userId: string, actionId: string, operation: "confirm" | "cancel") {
  if (!z.uuid().safeParse(actionId).success) throw new TravelError("not_found", "Action not found.", 404);
  const trip = await loadOwnedItineraryTrip(db, tripId, userId);
  const { data, error } = await db.rpc("claim_companion_action", signedCompanionProof("companion_claim", trip, { action_id: actionId, operation }));
  if (error) throw companionDatabaseError(error);
  const claim = z.object({ claimed: z.boolean(), action: actionSchema }).parse(data), action = claim.action;
  if (!claim.claimed) return { action: publicAction(action) };
  let result: Record<string, unknown>, status: "executed" | "failed" = "executed";
  try {
    // Revalidate current ownership, arguments, candidates and expiring provider proofs.
    const context = await buildCompanionContext(db, trip);
    await callTravelApi("companion/actions/validate", { context, tool_name: action.tool_name, arguments: action.arguments, original_message: action.snapshot.original_message }, z.object({ arguments: z.record(z.string(), z.unknown()) }).strict());
    switch (action.tool_name) {
      case "add_budget_entry": {
        const args = createBudgetEntrySchema.parse({ ...action.arguments, id: action.id });
        checkDate(args.expense_date ?? null, trip);
        await createBudgetEntry(db, trip, args); result = { message: "Your budget entry is saved." }; break;
      }
      case "select_hotel": {
        const candidate = hotelCandidate(trip, action.arguments);
        const saved = await db.rpc("select_trip_accommodation", { p_payload: candidate.selection_proof!.payload, p_signature: candidate.selection_proof!.signature, p_expected_id: typeof action.snapshot.hotel_id === "string" ? action.snapshot.hotel_id : null });
        if (saved.error) throw companionDatabaseError(saved.error);
        result = { message: "Your stay preference is saved. No booking was made." }; break;
      }
      case "save_food_selection": {
        const candidate = foodCandidate(trip, action.arguments);
        const saved = await db.rpc("save_trip_food", { p_payload: candidate.selection_proof!.payload, p_signature: candidate.selection_proof!.signature });
        if (saved.error) throw companionDatabaseError(saved.error);
        result = { message: "Your food spot is saved. No reservation was made." }; break;
      }
      case "move_itinerary_activity": case "replace_itinerary_activity": result = await executeEdit(db, trip, action); break;
      case "create_itinerary_version": {
        const saved = await generateTripItinerary(db, trip, userId, action.id, true);
        result = { message: `Itinerary version ${saved.itinerary.version_number} is saved.`, version: saved.itinerary.version_number }; break;
      }
      case "adapt_itinerary_for_weather": {
        const saved = await adaptTripWeather(db, trip, userId, action.id, z.uuid().parse(action.snapshot.itinerary_id));
        result = { message: saved.changed ? `Weather adaptation is saved in version ${saved.itinerary.version_number}.` : saved.explanation, version: saved.itinerary.version_number }; break;
      }
      default: throw new TravelError("COMPANION_INVALID_TOOL", "This action is unavailable.", 422);
    }
  } catch {
    status = "failed"; result = { message: "The change could not be confirmed. Review the relevant trip tab before requesting it again." };
  }
  const finished = await db.rpc("finish_companion_action", signedCompanionProof("companion_result", trip, { action_id: actionId, status, result }));
  if (finished.error) throw new TravelError("COMPANION_PERSISTENCE_UNAVAILABLE", "Reload your trip to check the result. This action will not run again automatically.");
  return { action: publicAction({ ...action, status, result }) };
}
