export const hotel = {
  provider: "fixture", provider_accommodation_id: "garden", name: "Demo Garden House", accommodation_type: "hotel",
  latitude: 35.69, longitude: 139.69, address: null, star_rating: 3, guest_rating: 8.8, guest_rating_scale: 10,
  review_count: 850, nightly_price: "85.00", total_price: "510.00", taxes_and_fees: null, taxes_included: null,
  advertised_price: null, currency: "USD", distance_km: .5, amenities: ["Demo Wi-Fi"], image_url: null,
  booking_url: null, available: null, recommendation_score: .9,
  scores: { budget_fit: 1, guest_quality: .88, location: .9, preference: 1, property_quality: .6, review_confidence: .9 },
  labels: ["Best Match", "Best Value"], within_stay_budget: true, comparable_price: true,
};
export function hotelResults(changes = {}) {
  return { provider: "fixture", demo: true, cached: false, searched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 900_000).toISOString(), hotel_nights: 6, rooms: 1,
    stay_budget: "875.00", currency: "USD", candidates: [hotel], returned_before_filters: 1,
    attribution: "Demo accommodation data — fictional properties, prices and reviews.", ...changes };
}
export const hotelTrip = {
  id: "00000000-0000-4000-8000-000000000010", owner_id: "00000000-0000-4000-8000-000000000001",
  destination_name: "Tokyo", destination_display_name: "Tokyo, Japan", destination_provider: "open_meteo",
  destination_provider_id: "1850147", destination_latitude: 35.6895, destination_longitude: 139.6917,
  destination_country: "Japan", destination_admin1: "Tokyo", destination_timezone: "Asia/Tokyo",
  start_date: "2099-04-12", end_date: "2099-04-18", travelers_count: 2, currency: "USD",
  budget_total: 2500, budget_style: "balanced", accommodation_preferences: ["hotel"],
};
