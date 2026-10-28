import { z } from "zod";
import {
  accommodationTypes, budgetStyles, currencyCodes, dietaryPreferences,
  travelPaces, tripInterests,
} from "./options.ts";
import { isDateOnly, isTimeZone } from "./dates.ts";

export const maximumBudget = 100_000_000;

// Keep money as decimal text until PostgreSQL casts it to NUMERIC. No float arithmetic.
export function moneyMinorUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function normalizeBudget(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}

const unique = (values: string[]) => new Set(values).size === values.length;
const dateOnly = z.string().refine(isDateOnly, "Choose a valid calendar date.");
const budget = z.string().trim()
  .regex(/^\d{1,9}(?:\.\d{1,2})?$/, "Enter an amount with up to two decimal places.")
  .refine((value) => {
    const minor = moneyMinorUnits(value);
    return Number.isSafeInteger(minor) && minor > 0 && minor <= maximumBudget * 100;
  }, "Budget must be greater than 0 and no more than 100,000,000.");

export const tripFormSchema = z.object({
  destination: z.string().trim().min(2, "Enter a destination with at least 2 characters.")
    .max(160, "Use 160 characters or fewer.")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Enter a destination on one line."),
  startDate: dateOnly,
  endDate: dateOnly,
  travelers: z.number().int("Enter a whole number.").min(1, "At least 1 traveler is required.").max(20, "A maximum of 20 travelers is supported."),
  budget,
  currency: z.enum(currencyCodes, { error: "Choose a supported currency." }),
  budgetStyle: z.enum(budgetStyles),
  interests: z.array(z.enum(tripInterests)).min(1, "Choose at least one interest.")
    .max(8, "Choose up to 8 interests.").refine(unique, "Choose each interest only once."),
  travelPace: z.enum(travelPaces),
  accommodationPreferences: z.array(z.enum(accommodationTypes))
    .min(1, "Choose at least one accommodation type.").max(accommodationTypes.length).refine(unique),
  // An empty array means no preference; it cannot contradict another selection.
  dietaryPreferences: z.array(z.enum(dietaryPreferences)).max(dietaryPreferences.length).refine(unique),
  specialRequests: z.string().trim().max(500, "Use 500 characters or fewer.")
    .refine((value) => !value.includes("\u0000"), "Remove unsupported characters."),
}).refine((values) => !isDateOnly(values.startDate) || !isDateOnly(values.endDate) || values.endDate >= values.startDate, {
  path: ["endDate"], message: "The end date must be on or after the start date.",
  when: (payload) => z.object({ startDate: dateOnly, endDate: dateOnly }).safeParse(payload.value).success,
});

export function createTripFormSchema(today: string) {
  return tripFormSchema.refine((values) => !isDateOnly(values.startDate) || values.startDate >= today, {
    path: ["startDate"], message: "Choose today or a future date.",
    when: (payload) => z.object({ startDate: dateOnly }).safeParse(payload.value).success,
  });
}

export const tripSubmissionContextSchema = z.object({
  timeZone: z.string().min(1).max(100).refine(isTimeZone),
});

export type TripFormValues = z.infer<typeof tripFormSchema>;
export type TripField = keyof TripFormValues;
export type CreateTripResult =
  | { status: "success"; tripId: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<TripField, string[]>>; sessionExpired?: boolean };

export const defaultTripValues: TripFormValues = {
  destination: "", startDate: "", endDate: "", travelers: 1, budget: "",
  currency: "USD", budgetStyle: "balanced", interests: [], travelPace: "balanced",
  accommodationPreferences: ["hotel"], dietaryPreferences: [], specialRequests: "",
};
