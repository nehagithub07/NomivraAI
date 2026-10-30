import { z } from "zod";

export const coordinatesSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
export const destinationSearchRequestSchema = z.object({
  q: z.string().trim().min(3).max(100).regex(/^[^\u0000-\u001f\u007f]+$/),
  language: z.string().regex(/^[a-z]{2,3}$/).optional(),
  limit: z.coerce.number().int().min(1).max(10).optional(),
  country_code: z.string().regex(/^[A-Z]{2}$/).optional(),
}).strict();
const optionalText = z.string().max(160).nullable();
export const resolvedDestinationSchema = coordinatesSchema.extend({
  provider: z.literal("open_meteo"), provider_location_id: z.string().regex(/^[1-9][0-9]{0,14}$/),
  name: z.string().trim().min(1).max(160), display_name: z.string().min(1).max(600),
  country: optionalText, country_code: z.string().regex(/^[A-Z]{2}$/).nullable(),
  admin1: optionalText, admin2: optionalText, timezone: z.string().max(100).nullable(),
  feature_code: z.string().max(20).nullable(), population: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});
export const destinationProofSchema = z.object({ payload: z.string().max(20000), signature: z.string().regex(/^[a-f0-9]{64}$/) });
export const destinationSearchResponseSchema = z.object({ destinations: z.array(resolvedDestinationSchema).max(10) });
export const signedDestinationSchema = resolvedDestinationSchema.extend({ proof: destinationProofSchema });
export const signedSearchResponseSchema = z.object({ destinations: z.array(signedDestinationSchema).max(10) });
export const placeCategories = ["attraction", "museum", "viewpoint", "historic", "monument", "park", "gallery", "arts_centre"] as const;
const tagNames = ["tourism", "historic", "leisure", "website", "opening_hours", "wikidata", "wikipedia", "amenity"] as const;
export const normalizedPlaceSchema = coordinatesSchema.extend({
  provider: z.literal("openstreetmap"), provider_place_id: z.string().regex(/^(node|way|relation)\/[1-9][0-9]{0,18}$/),
  name: z.string().trim().min(1).max(500), category: z.enum(placeCategories),
  distance_km: z.number().nonnegative().max(40080),
  tags: z.partialRecord(z.enum(tagNames), z.string().max(500)),
});
export const discoveryResponseSchema = coordinatesSchema.extend({ radius_meters: z.number().int().min(100).max(30000), places: z.array(normalizedPlaceSchema).max(30) });
export type DestinationSuggestion = z.infer<typeof signedDestinationSchema>;
export type ResolvedDestination = z.infer<typeof resolvedDestinationSchema>;
export type NormalizedPlace = z.infer<typeof normalizedPlaceSchema>;
