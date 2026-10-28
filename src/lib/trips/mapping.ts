import type { CreateTripArguments } from "@/lib/supabase/database.types";
import { normalizeBudget, type TripFormValues } from "./validation.ts";

export function mapTripFormToDatabase(values: TripFormValues, timeZone: string): CreateTripArguments {
  return {
    p_destination_name: values.destination,
    p_start_date: values.startDate,
    p_end_date: values.endDate,
    p_travelers_count: values.travelers,
    p_budget_total: normalizeBudget(values.budget),
    p_currency: values.currency,
    p_budget_style: values.budgetStyle,
    p_travel_pace: values.travelPace,
    p_accommodation_preferences: values.accommodationPreferences,
    p_dietary_preferences: values.dietaryPreferences,
    p_special_requests: values.specialRequests || null,
    p_interests: values.interests,
    p_time_zone: timeZone,
  };
}
