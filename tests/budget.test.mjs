import test from "node:test";
import assert from "node:assert/strict";
import { createBudgetEntrySchema, updateBudgetEntrySchema } from "../src/lib/budget/validation.ts";

const body = { id: "00000000-0000-4000-8000-000000000001", category: "transport", entry_type: "planned", description: "Airport train", amount: "28.00", currency: "USD", expense_date: null };
test("budget input preserves decimal strings, zero costs and planned/actual semantics", () => {
  assert.equal(createBudgetEntrySchema.parse(body).amount, "28.00");
  assert.equal(createBudgetEntrySchema.parse({ ...body, amount: "0" }).amount, "0");
  assert.deepEqual(updateBudgetEntrySchema.parse({ entry_type: "actual" }), { entry_type: "actual" });
  assert.deepEqual(updateBudgetEntrySchema.parse({ expense_date: null }), { expense_date: null });
});
test("budget input rejects invalid money, categories, dates, provenance and context injection", () => {
  for (const patch of [{ amount: "-1" }, { amount: "1.001" }, { amount: 28 }, { amount: "NaN" },
    { amount: "100000001" }, { category: "flight" }, { currency: "XYZ" }, { expense_date: "2099-02-30" },
    { description: " " }, { source: "hotel_selection" }, { trip_id: body.id }, { known_costs: "600" }]) {
    assert.equal(createBudgetEntrySchema.safeParse({ ...body, ...patch }).success, false, JSON.stringify(patch));
  }
  for (const patch of [{}, { amount: null }, { entry_type: null }, { source: "provider" }, { id: body.id }]) {
    assert.equal(updateBudgetEntrySchema.safeParse(patch).success, false);
  }
});
