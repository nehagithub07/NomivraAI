import type { HotelCandidate, HotelSort } from "./validation.ts";

export type HotelFilters = { stars: string; minPrice: string; maxPrice: string; type: string; minRating: string; maxDistance: string };
export const defaultHotelFilters: HotelFilters = { stars: "", minPrice: "", maxPrice: "", type: "", minRating: "", maxDistance: "" };
// Prices remain decimal strings. Integer minor units avoid floating point money comparisons.
export function moneyMinor(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function filterAndSortHotels(candidates: HotelCandidate[], filters: HotelFilters, order: HotelSort) {
  const filtered = candidates.filter(candidate => {
    if (filters.stars && (candidate.star_rating === null || candidate.star_rating < Number(filters.stars))) return false;
    if (filters.type && candidate.accommodation_type !== filters.type) return false;
    if (filters.minRating && (candidate.guest_rating === null || !candidate.guest_rating_scale || candidate.guest_rating / candidate.guest_rating_scale < Number(filters.minRating))) return false;
    if (filters.maxDistance && (candidate.distance_km === null || candidate.distance_km > Number(filters.maxDistance))) return false;
    if (filters.maxPrice && (!candidate.comparable_price || candidate.total_price === null || moneyMinor(candidate.total_price) > moneyMinor(filters.maxPrice))) return false;
    if (filters.minPrice && (!candidate.comparable_price || candidate.total_price === null || moneyMinor(candidate.total_price) < moneyMinor(filters.minPrice))) return false;
    return true;
  });
  const tie = (a: HotelCandidate, b: HotelCandidate) => `${a.provider}/${a.provider_accommodation_id}`.localeCompare(`${b.provider}/${b.provider_accommodation_id}`, "en");
  return filtered.sort((a, b) => {
    if (order === "price_asc" || order === "price_desc") {
      const ak = a.comparable_price && a.total_price !== null, bk = b.comparable_price && b.total_price !== null;
      if (ak !== bk) return ak ? -1 : 1;
      const difference = ak && bk ? moneyMinor(a.total_price!) - moneyMinor(b.total_price!) : 0;
      return (order === "price_desc" ? -difference : difference) || tie(a, b);
    }
    if (order === "guest_rating") {
      if ((a.guest_rating === null) !== (b.guest_rating === null)) return a.guest_rating === null ? 1 : -1;
      return (b.guest_rating ?? 0) / (b.guest_rating_scale || 1) - (a.guest_rating ?? 0) / (a.guest_rating_scale || 1)
        || b.scores.review_confidence - a.scores.review_confidence || tie(a, b);
    }
    if (order === "distance") {
      if ((a.distance_km === null) !== (b.distance_km === null)) return a.distance_km === null ? 1 : -1;
      return (a.distance_km ?? 0) - (b.distance_km ?? 0) || tie(a, b);
    }
    return b.recommendation_score - a.recommendation_score || tie(a, b);
  });
}
