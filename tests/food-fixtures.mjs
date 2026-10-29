import { hotelTrip } from "./hotel-fixtures.mjs";
export const foodTrip = { ...hotelTrip, dietary_preferences: ["vegetarian"] };
export function foodResults(changes = {}) {
  return { provider: "geoapify", demo: false, cached: false, searched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 900000).toISOString(), radius_meters: 5000, dietary_fallback: false,
    candidates: [{ provider: "geoapify", provider_place_id: "provider-place", name: "Provider Restaurant", category: "restaurant", cuisine_types: ["Japanese"],
      latitude: foodTrip.destination_latitude, longitude: foodTrip.destination_longitude, address: "Provider address", distance_km: 1.2,
      dietary_tags: ["vegetarian"], dietary_conflicts: [], opening_hours: null, website: null, price_level: null, rating: null, rating_scale: null, review_count: null,
      recommendation_score: .8, scores: { dietary_match: 1, cuisine_match: 1, distance: .7, category_preference: 1, data_quality: .5 }, labels: ["Nomivra Pick", "Best Match", "Diet-Friendly"], dietary_match: "confirmed" }], ...changes };
}
