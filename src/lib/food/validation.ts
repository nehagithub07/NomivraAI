import { z } from "zod";

export const foodCategories = ["restaurant", "cafe", "bar", "pub", "fast_food", "food_court", "dessert", "other"] as const;
export const foodDiets = ["vegetarian", "vegan", "halal", "kosher", "gluten_free"] as const;
const category = z.enum(foodCategories);
const safeWebsite = z.string().max(2000).url().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443"); } catch { return false; }
}).nullable();
export const foodSchema = z.object({
  provider: z.enum(["geoapify", "fixture"]), provider_place_id: z.string().min(1).max(512), name: z.string().min(1).max(300), category,
  cuisine_types: z.array(z.string().max(100)).max(40), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  address: z.string().max(600).nullable(), distance_km: z.number().min(0).max(16).nullable(),
  dietary_tags: z.array(z.string().max(40)).max(20), dietary_conflicts: z.array(z.string().max(40)).max(10),
  opening_hours: z.string().max(600).nullable(), website: safeWebsite, price_level: z.string().max(80).nullable(),
  rating: z.number().min(0).nullable(), rating_scale: z.number().positive().nullable(), review_count: z.number().int().nonnegative().nullable(),
  recommendation_score: z.number().min(0).max(1),
  scores: z.object({ dietary_match: z.number().min(0).max(1), cuisine_match: z.number().min(0).max(1), distance: z.number().min(0).max(1), category_preference: z.number().min(0).max(1), data_quality: z.number().min(0).max(1) }),
  labels: z.array(z.enum(["Nomivra Pick", "Best Match", "Nearby Pick", "Diet-Friendly", "Cuisine Match", "Cafe Pick", "Local Food Pick"])).max(7),
  dietary_match: z.enum(["confirmed", "unknown", "not_requested"]),
}).refine(value => value.provider !== "geoapify" || (value.rating === null && value.rating_scale === null && value.review_count === null));
export const foodResponseSchema = z.object({
  provider: z.enum(["geoapify", "fixture"]), demo: z.boolean(), cached: z.boolean(),
  searched_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
  radius_meters: z.number().int().min(100).max(15000), dietary_fallback: z.boolean(), candidates: z.array(foodSchema).max(40),
}).refine(value => value.demo === (value.provider === "fixture") && value.candidates.every(c => c.provider === value.provider));
export const foodProofSchema = z.object({ payload: z.string().max(3500), signature: z.string().regex(/^[a-f0-9]{64}$/) });
export const signedFoodSchema = foodSchema.and(z.object({ selection_proof: foodProofSchema }));
export const signedFoodResponseSchema = foodResponseSchema.and(z.object({ candidates: z.array(signedFoodSchema).max(40) }));
export const foodSearchBodySchema = z.object({
  radius_meters: z.number().int().min(100).max(15000).optional(),
  categories: z.array(category).min(1).max(8).optional(),
  dietary_preferences: z.array(z.enum(foodDiets)).max(5).optional(),
  cuisine_preferences: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  strict_dietary: z.boolean().optional(), demo: z.boolean().optional(),
}).strict();
export const foodSelectionBodySchema = z.object({ proof: foodProofSchema }).strict();
export const foodRemoveBodySchema = z.object({ selection_id: z.uuid() }).strict();
export const foodSelectionSchema = z.object({
  id: z.uuid(), trip_id: z.uuid(), provider: z.enum(["geoapify", "fixture"]), provider_place_id: z.string().min(1).max(512),
  name: z.string().min(1).max(300), category, saved_at: z.iso.datetime({ offset: true }),
});
export type FoodCandidate = z.infer<typeof signedFoodSchema>;
export type FoodResults = z.infer<typeof signedFoodResponseSchema>;
export type FoodSelection = z.infer<typeof foodSelectionSchema>;
export type FoodSearchOptions = z.infer<typeof foodSearchBodySchema>;
export type FoodSort = "recommended" | "distance" | "name";
