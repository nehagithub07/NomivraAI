import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TripWithInterests } from "@/lib/trips/queries";
import { getBudgetSummary } from "@/lib/budget/server";
import { getItinerary } from "@/lib/itineraries/server";
import { getTripWeather } from "@/lib/weather/server";
import { getStaySelection, getCachedHotels } from "@/lib/accommodations/server";
import { getFoodSelections, getCachedFood } from "@/lib/food/server";
import { matchesDiets } from "@/lib/food/catalog";
import { getPersistedPlaces } from "@/lib/destinations/persistence";
import { TravelError } from "@/lib/destinations/backend";
import { writeTools, type ToolCall } from "./validation";

type DB = SupabaseClient<Database>;
const findSchema = z.object({ query: z.string().max(80).default(""), category: z.string().max(40).nullable().default(null), dietary_preference: z.enum(["vegetarian", "vegan", "halal", "kosher", "gluten_free"]).nullable().default(null), limit: z.number().int().min(1).max(10).default(5), cuisine: z.string().max(80).nullable().default(null), near_selected_hotel: z.boolean().default(false), max_total: z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/).nullable().default(null) }).strict();
const dateSchema = z.object({ date: z.iso.date().nullable().default(null) }).strict();
export function checkDate(value: string | null, trip: TripWithInterests) {
  if (value && (value < trip.start_date || value > trip.end_date)) throw new TravelError("COMPANION_INVALID_DATE", "Choose a day within this trip.", 422);
}
function filter<T extends { name: string | null; category?: string | null; dietary_tags?: string[]; dietary_conflicts?: string[]; cuisine_types?: string[] }>(items: T[], args: z.infer<typeof findSchema>) {
  return items.filter(item => (!args.query || item.name?.toLowerCase().includes(args.query.toLowerCase())) &&
    (!args.category || item.category === args.category) && (!args.cuisine || item.cuisine_types?.some(c => c.toLowerCase().includes(args.cuisine!.toLowerCase()))) && (!args.dietary_preference ||
      item.dietary_tags && matchesDiets({ dietary_tags: item.dietary_tags }, [args.dietary_preference]) && !item.dietary_conflicts?.includes(args.dietary_preference))).slice(0, args.limit);
}
export async function readCompanionTool(db: DB, trip: TripWithInterests, call: ToolCall): Promise<Record<string, unknown>> {
  if (writeTools.has(call.name) || call.permission !== "READ") throw new TravelError("COMPANION_INVALID_TOOL", "That read tool is not available.", 422);
  switch (call.name) {
    case "get_trip_overview":
      z.object({}).strict().parse(call.arguments);
      return { destination: trip.destination_name, country: trip.destination_country, start_date: trip.start_date, end_date: trip.end_date, travelers: trip.travelers_count, timezone: trip.destination_timezone };
    case "get_trip_preferences":
      z.object({}).strict().parse(call.arguments);
      return { budget_style: trip.budget_style, travel_pace: trip.travel_pace, interests: trip.trip_interests.map(i => i.interest), dietary_preferences: trip.dietary_preferences, accommodation_preferences: trip.accommodation_preferences };
    case "get_budget_summary": {
      z.object({}).strict().parse(call.arguments);
      const b = await getBudgetSummary(db, trip);
      return { total_budget: b.total_budget, remaining_budget: b.remaining_budget, actual_remaining_budget: b.actual_remaining_budget, currency: b.currency, status: b.budget_status, planned_costs: b.planned_costs, actual_costs: b.actual_costs, committed_costs: b.committed_costs, excludes_unknown_costs: true, warnings: b.warnings };
    }
    case "get_itinerary": {
      const { date } = dateSchema.parse(call.arguments); checkDate(date, trip);
      const saved = await getItinerary(db, trip);
      if (!saved) return { available: false, days: [] };
      return { available: true, stale: saved.stale, version: saved.version_number,
        days: saved.itinerary.days.filter(d => !date || d.date === date).map(d => ({ date: d.date, day_number: d.day_number, theme: d.theme,
          items: d.items.map(i => ({ candidate_id: i.candidate_id, candidate_type: i.candidate_type, title: i.title.slice(0, 160), period: i.period, category: i.category, reason: i.reason.slice(0, 160) })) })) };
    }
    case "get_weather": {
      const { date } = dateSchema.parse(call.arguments); checkDate(date, trip);
      const report = await getTripWeather(db, trip), f = report.forecast;
      return { availability: f.availability, fetched_at: f.fetched_at, expires_at: f.expires_at, timezone: f.timezone, source: "Open-Meteo",
        days: f.days.filter(d => !date || d.date === date).map(d => ({ date: d.date, condition: d.condition, temperature_max_c: d.temperature_max_c, temperature_min_c: d.temperature_min_c, precipitation_probability_max: d.precipitation_probability_max,
          periods: d.periods.map(p => ({ period: p.period, condition: p.condition, temperature_c: p.temperature_c, precipitation_probability: p.precipitation_probability, risk: p.risk.level })) })),
        conflicts: report.conflicts.filter(c => !date || c.date === date).slice(0, 20).map(c => ({ date: c.date, period: c.period, title: c.title, message: c.message })), uncovered_ranges: f.uncovered_ranges };
    }
    case "get_selected_hotel": {
      z.object({}).strict().parse(call.arguments);
      const stay = await getStaySelection(db, trip.id), cache = getCachedHotels(trip.owner_id, trip);
      const h = stay && cache?.candidates.find(c => c.provider === stay.provider && c.provider_accommodation_id === stay.provider_accommodation_id);
      return { selected: !!stay, name: h?.name ?? stay?.selected_name ?? null, details_available: !!h, total_price: h?.comparable_price ? h.total_price : null, currency: h?.currency ?? null, guest_rating: h?.guest_rating ?? null, guest_rating_scale: h?.guest_rating_scale ?? null, quote_expires_at: h ? cache!.expires_at : null, booked: false };
    }
    case "find_hotel_options": {
      const args = findSchema.parse(call.arguments), cache = getCachedHotels(trip.owner_id, trip);
      const items = cache?.candidates.filter(c => c.provider === "stayapi").map(h => ({ provider_accommodation_id: h.provider_accommodation_id, name: h.name, total_price: h.comparable_price ? h.total_price : null, currency: h.currency, guest_rating: h.guest_rating, guest_rating_scale: h.guest_rating_scale })) ?? [];
      items.sort((a, b) => (a.total_price !== null && a.currency === trip.currency ? Number(a.total_price) : Infinity) - (b.total_price !== null && b.currency === trip.currency ? Number(b.total_price) : Infinity));
      return { options: filter(items.filter(h => !args.max_total || h.currency === trip.currency && h.total_price !== null && Number(h.total_price) <= Number(args.max_total)), args), source: "StayAPI", expires_at: cache?.expires_at ?? null, notice: "Only existing unexpired recommendations. Open Hotels to search again. Selection does not book." };
    }
    case "get_saved_food":
    case "find_food_options": {
      const args = findSchema.parse(call.arguments), cache = getCachedFood(trip.owner_id, trip);
      const candidates = cache?.candidates.filter(c => c.provider === "geoapify") ?? [];
      const saved = call.name === "get_saved_food" ? await getFoodSelections(db, trip.id) : null;
      const items = saved ? saved.filter(s => s.provider === "geoapify").map(s => {
        const recent = candidates.find(c => c.provider_place_id === s.provider_place_id);
        return { provider_place_id: s.provider_place_id, name: s.name, category: s.category, dietary_tags: recent?.dietary_tags ?? [], dietary_conflicts: recent?.dietary_conflicts ?? [], cuisine_types: recent?.cuisine_types ?? [], distance_km: recent?.distance_km ?? null };
      }) : candidates.filter(c => !c.dietary_conflicts.some(d => trip.dietary_preferences.some(p => p === d))).map(c => ({ provider_place_id: c.provider_place_id, name: c.name, category: c.category, dietary_tags: c.dietary_tags, dietary_conflicts: c.dietary_conflicts, cuisine_types: c.cuisine_types, distance_km: c.distance_km }));
      let options: (typeof items[number] & { distance_from_hotel_km?: number })[] = items;
      if (args.near_selected_hotel) {
        const stay = await getStaySelection(db, trip.id);
        const hotel = stay && getCachedHotels(trip.owner_id, trip)?.candidates.find(h => h.provider_accommodation_id === stay.provider_accommodation_id);
        if (hotel?.latitude == null || hotel?.longitude == null) return { options: [], notice: "Current hotel coordinates are unavailable. Search Hotels for current details first." };
        const lat = hotel.latitude, lon = hotel.longitude;
        options = items.flatMap(item => {
          const c = candidates.find(c => c.provider_place_id === item.provider_place_id);
          if (!c) return [];
          const rad = Math.PI / 180, a = Math.sin((c.latitude-lat)*rad/2)**2 + Math.cos(lat*rad)*Math.cos(c.latitude*rad)*Math.sin((c.longitude-lon)*rad/2)**2;
          return [{ ...item, distance_from_hotel_km: Math.round(6371*2*Math.asin(Math.min(1,Math.sqrt(a)))*100)/100 }];
        }).filter(item => item.distance_from_hotel_km <= 5).sort((a,b) => a.distance_from_hotel_km-b.distance_from_hotel_km);
      }
      return { options: filter(options, args), source: "Geoapify / OpenStreetMap", notice: "Dietary suitability only reflects known metadata. Distances are straight-line, not route distances. Open Food to search again." };
    }
    case "get_discovered_places":
    case "find_trip_places": {
      const args = findSchema.parse(call.arguments), places = await getPersistedPlaces(db, trip.id);
      return { options: filter(places.map(p => ({ candidate_id: p.provider_place_id, name: p.name, category: p.category, distance_km: p.distance_km })), args), source: "OpenStreetMap" };
    }
    default: throw new TravelError("COMPANION_INVALID_TOOL", "That tool is not available.", 422);
  }
}
