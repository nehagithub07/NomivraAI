import { z } from "zod";
import { generationResponseSchema } from "../itineraries/validation.ts";

const nullableNumber = z.number().finite().nullable();
const period = z.enum(["morning", "afternoon", "evening"]);
const risk = z.enum(["low", "moderate", "high", "unknown"]);
const setting = z.enum(["indoor", "outdoor", "mixed", "unknown"]);
const instant = z.iso.datetime({ offset: true });
export const weatherPeriodSchema = z.object({
  period, temperature_c: nullableNumber, apparent_temperature_c: nullableNumber,
  apparent_temperature_max_c: nullableNumber, apparent_temperature_min_c: nullableNumber,
  precipitation_probability: z.number().int().min(0).max(100).nullable(), precipitation_mm: nullableNumber,
  weather_code: z.number().int().nullable(), condition: z.string().max(80), icon: z.string().max(30),
  wind_speed_kmh: nullableNumber, complete: z.boolean(), risk: z.object({ level: risk, reasons: z.array(z.string().max(60)).max(10) }),
});
export const dailyWeatherSchema = z.object({
  date: z.iso.date(), weather_code: z.number().int().nullable(), condition: z.string().max(80), icon: z.string().max(30),
  temperature_max_c: nullableNumber, temperature_min_c: nullableNumber, apparent_temperature_max_c: nullableNumber,
  apparent_temperature_min_c: nullableNumber, precipitation_probability_max: z.number().int().min(0).max(100).nullable(),
  precipitation_sum_mm: nullableNumber, wind_speed_max_kmh: nullableNumber, sunrise: instant.nullable(), sunset: instant.nullable(),
  periods: z.array(weatherPeriodSchema).max(3),
});
export const weatherForecastSchema = z.object({
  provider: z.literal("open_meteo"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  timezone: z.string().max(100), start_date: z.iso.date(), end_date: z.iso.date(), fetched_at: instant.nullable(), expires_at: instant.nullable(), cached: z.boolean(),
  availability: z.enum(["available", "partially_available", "not_yet_available", "past_trip", "unavailable"]),
  days: z.array(dailyWeatherSchema).max(16),
  uncovered_ranges: z.array(z.object({ start_date: z.iso.date(), end_date: z.iso.date(), reason: z.enum(["past", "outside_forecast_window", "missing_data"]) })).max(20),
});
export const weatherConflictSchema = z.object({
  date: z.iso.date(), period, itinerary_item_id: z.string().max(80), candidate_id: z.string().max(512).nullable(), title: z.string().max(500),
  risk_level: risk, reason_codes: z.array(z.string().max(60)), setting, suitability_score: z.number().min(0).max(100), message: z.string().max(600),
});
export const weatherReportSchema = z.object({ forecast: weatherForecastSchema, analyzed_version_id: z.uuid().nullable(), conflicts: z.array(weatherConflictSchema).max(98) });
// generationResponseSchema has a refinement, so safeExtend retains demo/provider integrity checks.
export const adaptationResponseSchema = generationResponseSchema.safeExtend({
  changed: z.boolean(), parent_version_id: z.uuid(), weather_fetched_at: instant.nullable(),
  remaining_conflicts: z.array(weatherConflictSchema).max(98), explanation: z.string().max(500),
});
export const weatherBodySchema = z.object({}).strict();
export const weatherReadSchema = z.object({ version_id: z.uuid().optional() }).strict();
export const adaptWeatherBodySchema = z.object({ request_id: z.uuid(), expected_version_id: z.uuid() }).strict();
export type WeatherReport = z.infer<typeof weatherReportSchema>;
export type WeatherDay = z.infer<typeof dailyWeatherSchema>;

export function weatherErrorMessage(code: unknown): string {
  if (code === "unauthorized") return "Sign in again to use weather. Your trip is saved.";
  if (code === "WEATHER_CONTEXT_CHANGED") return "Your trip or itinerary changed. Reload before adapting.";
  if (code === "WEATHER_SETUP_REQUIRED") return "Weather adaptation needs a database setup update.";
  if (["WEATHER_RATE_LIMITED", "WEATHER_PROVIDER_RATE_LIMITED", "ITINERARY_RATE_LIMITED", "ITINERARY_PROVIDER_RATE_LIMITED"].includes(String(code))) return "Weather or planning is busy. Wait a minute before trying again.";
  if (code === "ITINERARY_IN_PROGRESS") return "An itinerary is already being built. Wait a little, then reload.";
  if (code === "ITINERARY_PERSISTENCE_UNAVAILABLE") return "We couldn't confirm the saved adaptation. Reload your itinerary before trying again.";
  return "Weather is temporarily unavailable. Your trip and itinerary are safe.";
}
