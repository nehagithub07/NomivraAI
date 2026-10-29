import { z } from "zod";

export const budgetCategories = ["accommodation", "food", "activities", "transport", "miscellaneous"] as const;
export const categoryLabels: Record<typeof budgetCategories[number], string> = {
  accommodation: "Accommodation", food: "Food", activities: "Activities", transport: "Transport", miscellaneous: "Other",
};
const currency = z.enum(["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"]);
// No browser arithmetic: request and response amounts travel as decimal strings.
export const expenseAmountSchema = z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/).refine(value => Number(value) <= 100000000);
const signedMoney = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/);
const date = z.iso.date().refine(value => value >= "1900-01-01");
const entryFields = {
  category: z.enum(budgetCategories), entry_type: z.enum(["planned", "actual"]),
  description: z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/),
  amount: expenseAmountSchema, currency, expense_date: date.nullable().optional(),
};
export const createBudgetEntrySchema = z.object({ id: z.uuid(), ...entryFields }).strict();
export const updateBudgetEntrySchema = z.object(entryFields).partial().strict().refine(value => Object.keys(value).length > 0);
export const emptyBudgetSchema = z.object({}).strict();
export const deleteBudgetEntrySchema = z.object({}).strict();
export const budgetEntrySchema = createBudgetEntrySchema.extend({
  trip_id: z.uuid(), source: z.literal("manual"), expense_date: date.nullable(),
  created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
});
export const budgetSummarySchema = z.object({
  trip_id: z.uuid(), currency, budget_style: z.enum(["budget", "balanced", "premium"]),
  total_budget: signedMoney, known_costs: signedMoney, planned_costs: signedMoney, actual_costs: signedMoney,
  committed_costs: signedMoney, remaining_budget: signedMoney, actual_remaining_budget: signedMoney,
  percent_used: signedMoney, budget_status: z.enum(["healthy", "watch", "over_budget"]),
  allocations: z.array(z.object({ category: z.enum(budgetCategories), percentage: z.number().int().min(0).max(100), amount: signedMoney })).length(5),
  categories: z.array(z.object({ category: z.enum(budgetCategories), allocated: signedMoney, known: signedMoney,
    planned: signedMoney, actual: signedMoney, committed: signedMoney, remaining: signedMoney, percent_used: signedMoney.nullable() })).length(5),
  hotel: z.object({ selection_id: z.uuid().nullable(), source: z.literal("hotel_selection"), provider: z.literal("stayapi").nullable(),
    amount: signedMoney.nullable(), quote_expires_at: z.iso.datetime({ offset: true }).nullable(), included: z.boolean(),
    exclusion_reason: z.enum(["unavailable", "expired", "currency_mismatch", "manual_replacement"]).nullable() }),
  unknown_costs: z.object({ food: z.null(), activities: z.null() }),
  trip_days: z.number().int().positive(), hotel_nights: z.number().int().nonnegative(), remaining_days: z.number().int().nonnegative(),
  budget_per_traveler: signedMoney, recommended_daily_flexible_spend: signedMoney.nullable(), daily_flexible_spend_per_traveler: signedMoney.nullable(),
  entries: z.array(budgetEntrySchema).max(1000), insights: z.array(z.string().max(500)), warnings: z.array(z.string().max(500)),
});
export type CreateBudgetEntry = z.infer<typeof createBudgetEntrySchema>;
export type UpdateBudgetEntry = z.infer<typeof updateBudgetEntrySchema>;
export type BudgetEntry = z.infer<typeof budgetEntrySchema>;
export type TripBudgetSummary = z.infer<typeof budgetSummarySchema>;
