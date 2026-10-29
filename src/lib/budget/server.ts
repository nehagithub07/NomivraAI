import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TripRow, BudgetEntryRow } from "@/lib/supabase/database.types";
import { getCachedHotels, getStaySelection } from "@/lib/accommodations/server";
import { accommodationContext } from "@/lib/accommodations/context";
import { callTravelApi, TravelError } from "@/lib/destinations/backend";
import { budgetEntrySchema, budgetSummarySchema, createBudgetEntrySchema, type CreateBudgetEntry, type UpdateBudgetEntry } from "./validation";

type DB = SupabaseClient<Database>;
export function budgetDatabaseFailure(error: { code?: string; message?: string }): TravelError {
  if (error.code === "23505") return new TravelError("BUDGET_DUPLICATE_ENTRY", "This expense was already added. Reload your budget before adding it again.", 409);
  if (["PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"].includes(error.code || "")) return new TravelError("BUDGET_SETUP_REQUIRED", "Budget tracking needs a database setup update.");
  if (error.message === "BUDGET_ENTRY_LIMIT") return new TravelError("BUDGET_ENTRY_LIMIT", "This trip has reached the 1,000 expense limit.", 409);
  if (error.code === "22023" || error.code === "23514") return new TravelError("BUDGET_INVALID_ENTRY", "Check your expense amount, currency and details.", 422);
  if (error.code === "42501") return new TravelError("not_found", "Trip or expense not found.", 404);
  return new TravelError("BUDGET_DATABASE_UNAVAILABLE", "We couldn't confirm your budget changes. Reload before trying again.");
}
export async function loadOwnedBudgetTrip(db: DB, tripId: string, userId: string): Promise<TripRow> {
  if (!z.uuid().safeParse(tripId).success) throw new TravelError("not_found", "Trip not found.", 404);
  const { data, error } = await db.from("trips").select("*").eq("id", tripId).eq("owner_id", userId).maybeSingle();
  if (error) throw budgetDatabaseFailure(error);
  if (!data || data.owner_id !== userId) throw new TravelError("not_found", "Trip not found.", 404);
  return data;
}
const parseRow = (row: BudgetEntryRow) => budgetEntrySchema.parse({ ...row, amount: String(row.amount) });
export async function getBudgetSummary(db: DB, trip: TripRow) {
  const { data, error } = await db.from("trip_budget_entries").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }).order("id").limit(1001);
  if (error) throw budgetDatabaseFailure(error);
  if (data.length > 1000) throw new TravelError("BUDGET_ENTRY_LIMIT", "This trip has too many expenses to summarize safely.", 409);
  const selection = await getStaySelection(db, trip.id);
  const matching = selection?.provider === "stayapi" && isDeepStrictEqual(selection.search_context, accommodationContext(trip)) ? selection : null;
  const cache = getCachedHotels(trip.owner_id, trip);
  const quote = matching && cache && !cache.demo && cache.provider === "stayapi"
    ? cache.candidates.find(c => c.provider === "stayapi" && c.provider_accommodation_id === matching.provider_accommodation_id) : null;
  return callTravelApi("budget/summary", {
    trip_id: trip.id, budget_total: String(trip.budget_total), currency: trip.currency,
    budget_style: trip.budget_style, travelers: trip.travelers_count, start_date: trip.start_date, end_date: trip.end_date,
    timezone: trip.destination_timezone, entries: data.map(parseRow),
    hotel: matching ? { selection_id: matching.id, provider: "stayapi", source: "hotel_selection",
      amount: quote?.comparable_price ? quote.total_price : null, currency: quote?.currency ?? null,
      quote_expires_at: quote ? cache!.expires_at : null } : null,
  }, budgetSummarySchema);
}
async function validatedEntry(trip: TripRow, entry: CreateBudgetEntry) {
  return callTravelApi("budget/entries/validate", { currency: trip.currency, entry }, createBudgetEntrySchema);
}
export async function createBudgetEntry(db: DB, trip: TripRow, body: CreateBudgetEntry) {
  const valid = await validatedEntry(trip, body);
  const { data, error } = await db.from("trip_budget_entries").insert({ ...valid, amount: valid.amount, trip_id: trip.id, expense_date: valid.expense_date ?? null }).select("*").single();
  if (error) throw budgetDatabaseFailure(error);
  return { entry: parseRow(data) };
}
export async function updateBudgetEntry(db: DB, trip: TripRow, entryId: string, patch: UpdateBudgetEntry) {
  if (!z.uuid().safeParse(entryId).success) throw new TravelError("not_found", "Expense not found.", 404);
  const { data: existing, error: readError } = await db.from("trip_budget_entries").select("*").eq("trip_id", trip.id).eq("id", entryId).maybeSingle();
  if (readError) throw budgetDatabaseFailure(readError);
  if (!existing) throw new TravelError("not_found", "Expense not found.", 404);
  const row = parseRow(existing);
  await validatedEntry(trip, createBudgetEntrySchema.parse({
    id: row.id, category: row.category, entry_type: row.entry_type, description: row.description,
    amount: row.amount, currency: row.currency, expense_date: row.expense_date, ...patch,
  }));
  // Write only requested fields so independent edits cannot revert each other.
  const { data, error } = await db.from("trip_budget_entries").update(patch).eq("trip_id", trip.id).eq("id", entryId).select("*").maybeSingle();
  if (error) throw budgetDatabaseFailure(error);
  if (!data) throw new TravelError("not_found", "Expense not found.", 404);
  return { entry: parseRow(data) };
}
export async function deleteBudgetEntry(db: DB, trip: TripRow, entryId: string) {
  if (!z.uuid().safeParse(entryId).success) throw new TravelError("not_found", "Expense not found.", 404);
  const { data, error } = await db.from("trip_budget_entries").delete().eq("trip_id", trip.id).eq("id", entryId).select("id").maybeSingle();
  if (error) throw budgetDatabaseFailure(error);
  if (!data) throw new TravelError("not_found", "Expense not found.", 404);
  return { deleted: true };
}
