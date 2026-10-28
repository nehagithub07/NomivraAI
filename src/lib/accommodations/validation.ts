import { z } from "zod";

export const accommodationTypes = ["hotel", "hostel", "apartment", "homestay", "guest_house", "resort", "vacation_rental", "other"] as const;
const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).nullable();
const safeUrl = z.string().max(2000).url().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443"); } catch { return false; }
}).nullable();
const sourceUrl = (domain: string) => safeUrl.refine(value => {
  if (value === null) return true;
  const host = new URL(value).hostname;
  return host === domain || host.endsWith(`.${domain}`);
});
export const accommodationSchema = z.object({
  provider: z.enum(["stayapi", "fixture"]), provider_accommodation_id: z.string().min(1).max(160),
  name: z.string().min(1).max(300), accommodation_type: z.enum(accommodationTypes).nullable(),
  latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(),
  address: z.string().max(600).nullable(), star_rating: z.number().min(0).max(5).nullable(),
  guest_rating: z.number().min(0).nullable(), guest_rating_scale: z.number().positive().max(100).nullable(),
  review_count: z.number().int().nonnegative().nullable(),
  nightly_price: money, total_price: money, taxes_and_fees: money, advertised_price: money,
  taxes_included: z.boolean().nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  distance_km: z.number().min(0).max(40080).nullable(), amenities: z.array(z.string().max(100)).max(40),
  image_url: sourceUrl("bstatic.com"), booking_url: sourceUrl("booking.com"), available: z.boolean().nullable(),
  recommendation_score: z.number().min(0).max(1),
  scores: z.object({ budget_fit: z.number().min(0).max(1), guest_quality: z.number().min(0).max(1),
    location: z.number().min(0).max(1), preference: z.number().min(0).max(1),
    property_quality: z.number().min(0).max(1), review_confidence: z.number().min(0).max(1) }),
  labels: z.array(z.enum(["Best Match", "Best Value", "Budget Friendly", "Best Rated", "Premium"])).max(5),
  within_stay_budget: z.boolean().nullable(), comparable_price: z.boolean(),
}).refine(value => value.guest_rating === null || (value.guest_rating_scale !== null && value.guest_rating <= value.guest_rating_scale));
export const hotelResponseSchema = z.object({
  provider: z.enum(["stayapi", "fixture"]), demo: z.boolean(), cached: z.boolean(),
  searched_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
  hotel_nights: z.number().int().min(1).max(90), rooms: z.number().int().min(1).max(10),
  stay_budget: z.string().regex(/^\d+(?:\.\d{1,2})?$/), currency: z.string().regex(/^[A-Z]{3}$/),
  candidates: z.array(accommodationSchema).max(50), returned_before_filters: z.number().int().min(0).max(50),
  attribution: z.string().max(300),
}).refine(value => value.demo === (value.provider === "fixture") && value.candidates.every(candidate => candidate.provider === value.provider));
export const selectionProofSchema = z.object({ payload: z.string().max(3000), signature: z.string().regex(/^[a-f0-9]{64}$/) });
export const signedHotelSchema = accommodationSchema.and(z.object({ selection_proof: selectionProofSchema }));
export const signedHotelResponseSchema = hotelResponseSchema.and(z.object({ candidates: z.array(signedHotelSchema).max(50) }));
export const hotelSearchBodySchema = z.object({ refresh: z.boolean().optional(), demo: z.boolean().optional() }).strict();
export const hotelSelectionBodySchema = z.object({ proof: selectionProofSchema, expected_selection_id: z.uuid().nullable() }).strict();
export const clearSelectionBodySchema = z.object({ expected_selection_id: z.uuid() }).strict();
export const selectionSchema = z.object({
  id: z.uuid(), trip_id: z.uuid(), provider: z.enum(["stayapi", "fixture"]),
  provider_accommodation_id: z.string().min(1).max(160), selected_name: z.string().max(300).nullable(),
  search_context: z.record(z.string(), z.unknown()), selected_at: z.iso.datetime({ offset: true }),
});
export type HotelCandidate = z.infer<typeof signedHotelSchema>;
export type HotelSearchResults = z.infer<typeof signedHotelResponseSchema>;
export type StaySelection = z.infer<typeof selectionSchema>;
export type HotelSort = "recommended" | "price_asc" | "price_desc" | "guest_rating" | "distance";
