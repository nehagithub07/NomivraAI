import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TripWithInterests } from "@/lib/trips/queries";
import { getItinerary } from "@/lib/itineraries/server";
import { getStaySelection, getCachedHotels } from "@/lib/accommodations/server";
import { getFoodSelections } from "@/lib/food/server";
import { getBudgetSummary } from "@/lib/budget/server";
import { accommodationContext } from "@/lib/accommodations/context";
import { isDeepStrictEqual } from "node:util";
import { exportDocumentSchema, type ExportDocument } from "./validation";

export async function buildExportDocument(db: SupabaseClient<Database>, trip: TripWithInterests): Promise<ExportDocument> {
  // Saved/cached reads only. Export never calls Gemini or refreshes provider searches.
  const [itinerary, stay, food, budget] = await Promise.allSettled([
    getItinerary(db, trip), getStaySelection(db, trip.id), getFoodSelections(db, trip.id), getBudgetSummary(db, trip),
  ]);
  const notices: ExportDocument["notices"] = [];
  const saved = itinerary.status === "fulfilled" && !itinerary.value?.demo ? itinerary.value : null;
  if (!saved) notices.push("itinerary_unavailable");
  if (itinerary.status === "fulfilled" && itinerary.value?.demo) notices.push("demo_excluded");
  if (saved?.stale) notices.push("stale_itinerary");
  const selection = stay.status === "fulfilled" && stay.value?.provider === "stayapi" ? stay.value : null;
  const cache = getCachedHotels(trip.owner_id, trip);
  const hotel = selection && isDeepStrictEqual(selection.search_context, accommodationContext(trip)) && cache && !cache.demo
    ? cache.candidates.find(c => c.provider === "stayapi" && c.provider_accommodation_id === selection.provider_accommodation_id) : null;
  if (stay.status === "rejected" || selection && !hotel) notices.push("hotel_unavailable");
  if (food.status === "rejected") notices.push("food_unavailable");
  if (budget.status === "rejected") notices.push("budget_unavailable");
  const totals = budget.status === "fulfilled" ? budget.value : null;
  return exportDocumentSchema.parse({
    version: 1, exportedAt: new Date().toISOString(), destination: trip.destination_name,
    startDate: trip.start_date, endDate: trip.end_date,
    days: saved?.itinerary.days.map(day => ({
      dayNumber: day.day_number, date: day.date, theme: day.theme,
      items: day.items.map(item => ({ type: item.candidate_type, title: item.title, period: item.period, latitude: item.latitude, longitude: item.longitude })),
    })) ?? [],
    hotel: selection ? { name: hotel?.name ?? null, latitude: hotel?.latitude ?? null, longitude: hotel?.longitude ?? null } : null,
    food: food.status === "fulfilled" ? food.value.filter(f => f.provider !== "fixture").slice(0, 50).map(f => ({ name: f.name, category: f.category })) : [],
    budget: { currency: trip.currency, total: String(trip.budget_total), planned: totals?.planned_costs ?? null, actual: totals?.actual_costs ?? null, remaining: totals?.remaining_budget ?? null },
    notices,
  });
}
