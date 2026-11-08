import { z } from "zod";
import { accommodationTypes, budgetStyles, dietaryPreferences, travelPaces, tripInterests } from "../trips/options.ts";

const unique = (values: string[]) => new Set(values).size === values.length;
export const preferencesSchema = z.strictObject({
  interests: z.array(z.enum(tripInterests)).max(8).refine(unique),
  travelPace: z.enum(travelPaces),
  budgetStyle: z.enum(budgetStyles),
  dietaryPreferences: z.array(z.enum(dietaryPreferences)).max(5).refine(unique),
  accommodationPreferences: z.array(z.enum(accommodationTypes)).min(1).max(5).refine(unique),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  interests: [], travelPace: "balanced", budgetStyle: "balanced",
  dietaryPreferences: [], accommodationPreferences: ["hotel"],
};
export const memoryCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("preferences"), preferences: preferencesSchema, memoryEnabled: z.boolean() }),
  z.strictObject({ action: z.literal("remember"), kind: z.enum(["preference", "feedback"]), preferences: preferencesSchema, feedback: z.enum(["prefer", "avoid"]) }),
  z.strictObject({ action: z.literal("trip"), tripId: z.uuid(), feedback: z.enum(["prefer", "avoid"]) }),
  z.strictObject({ action: z.literal("delete"), id: z.uuid() }),
  z.strictObject({ action: z.literal("clear") }),
  z.strictObject({ action: z.literal("reset") }),
]);
export const memoryRecordSchema = z.object({
  id: z.uuid(), kind: z.enum(["preference", "feedback", "trip"]),
  feedback: z.enum(["prefer", "avoid"]), preferences: preferencesSchema,
  source_trip_id: z.uuid().nullable(), content: z.string().max(2000),
  created_at: z.string(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type MemoryState = { preferences: Preferences; memoryEnabled: boolean; memories: MemoryRecord[]; available: boolean };
