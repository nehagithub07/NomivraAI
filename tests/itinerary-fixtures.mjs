import { foodTrip } from "./food-fixtures.mjs";
export const itineraryTrip = { ...foodTrip, start_date: "2099-04-12", end_date: "2099-04-13", travel_pace: "balanced", special_requests: null, trip_interests: [{ interest: "history" }, { interest: "food" }] };
export const itineraryVersionId = "00000000-0000-4000-8000-000000000004";
export function itineraryDocument() {
  return { title: "Your Tokyo itinerary", summary: "A plan using saved places.", warnings: ["Opening hours have not been verified."],
    days: [
      { date: "2099-04-12", day_number: 1, theme: "Culture", items: [{ candidate_type: "attraction", candidate_id: "node/123", candidate_provider: "openstreetmap", period: "morning", title: "Tokyo Museum", reason: "Chosen to reflect your stated interests.", notes: null, category: "museum", latitude: 35.7, longitude: 139.7, opening_hours: null }] },
      { date: "2099-04-13", day_number: 2, theme: "Relaxation", items: [{ candidate_type: "free_time", candidate_id: null, candidate_provider: null, period: "morning", title: "Free time", reason: "Unscheduled time.", notes: null, category: null, latitude: null, longitude: null, opening_hours: null }] },
    ],
  };
}
export function generationResult() {
  return { provider: "gemini", model_name: "gemini-3.8-flash", prompt_version: "v1", demo: false, itinerary: itineraryDocument(),
    budget: { currency: "USD", trip_budget: "2500.00", known_accommodation_total: null, remaining_known_budget: null, excludes_unknown_costs: true } };
}
export function versionRow(document = itineraryDocument(), patch = {}) {
  return { id: itineraryVersionId, trip_id: itineraryTrip.id, version_number: 1, status: "ready", is_current: true,
    provider: "gemini", model_name: "gemini-3.8-flash", prompt_version: "v1", demo: false, title: document.title, summary: document.summary,
    warnings: document.warnings, created_at: new Date().toISOString(), trip_context: {},
    itinerary_days: document.days.map((day, i) => ({ id: `day-${i}`, day_number: day.day_number, trip_date: day.date, theme: day.theme,
      itinerary_items: day.items.map((item, position) => ({ ...item, id: `item-${i}-${position}`, position: position + 1 })) })), ...patch };
}
