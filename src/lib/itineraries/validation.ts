import { z } from "zod";

const itemSchema = z.object({
  candidate_type: z.enum(["attraction", "food", "hotel", "free_time"]),
  candidate_id: z.string().min(1).max(512).nullable(),
  candidate_provider: z.enum(["openstreetmap", "geoapify", "stayapi"]).nullable(),
  period: z.enum(["morning", "afternoon", "evening"]),
  title: z.string().min(1).max(500), reason: z.string().max(300), notes: z.string().max(500).nullable(),
  category: z.string().max(80).nullable(), latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(), opening_hours: z.string().max(500).nullable(),
}).strict();
export const itineraryDocumentSchema = z.object({
  title: z.string().min(1).max(200), summary: z.string().max(500),
  days: z.array(z.object({ date: z.iso.date(), day_number: z.number().int().min(1).max(14), theme: z.string().max(80), items: z.array(itemSchema).min(1).max(7) }).strict()).min(1).max(14),
  warnings: z.array(z.string().max(500)).max(20),
}).strict();
export const budgetSummarySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/), trip_budget: z.string().regex(/^\d+\.\d{2}$/),
  known_accommodation_total: z.string().regex(/^\d+\.\d{2}$/).nullable(),
  remaining_known_budget: z.string().regex(/^-?\d+\.\d{2}$/).nullable(), excludes_unknown_costs: z.literal(true),
}).strict();
export const generationResponseSchema = z.object({
  provider: z.enum(["gemini", "fixture"]), model_name: z.string().min(1).max(100),
  prompt_version: z.string().min(1).max(32), demo: z.boolean(),
  itinerary: itineraryDocumentSchema, budget: budgetSummarySchema,
}).strict().refine(result => result.demo === (result.provider === "fixture"));
export const generationBodySchema = z.object({ request_id: z.uuid(), regenerate: z.boolean().default(false) }).strict();
export const savedItinerarySchema = z.object({
  id: z.uuid(), version_number: z.number().int().positive(), created_at: z.iso.datetime({ offset: true }),
  is_current: z.boolean(), provider: z.enum(["gemini", "fixture"]), model_name: z.string(), prompt_version: z.string(),
  demo: z.boolean(), stale: z.boolean(), itinerary: itineraryDocumentSchema,
});
export type SavedItinerary = z.infer<typeof savedItinerarySchema>;
export type ItineraryDocument = z.infer<typeof itineraryDocumentSchema>;
export type BudgetSummary = z.infer<typeof budgetSummarySchema>;
export type ItineraryVersionSummary = { id: string; version_number: number; created_at: string; is_current: boolean };
