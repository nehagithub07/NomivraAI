import test from "node:test";
import assert from "node:assert/strict";
import { createTripFormSchema, defaultTripValues, moneyMinorUnits, normalizeBudget, tripSubmissionContextSchema } from "../src/lib/trips/validation.ts";
import { durationLabel, isDateOnly, todayInTimeZone, travelersLabel, tripDuration } from "../src/lib/trips/dates.ts";
import { mapTripFormToDatabase } from "../src/lib/trips/mapping.ts";
import { formatTripBudget } from "../src/lib/travel-format.ts";
import { destination } from "./destination-fixtures.mjs";
import { tripSaveFailure } from "../src/lib/trips/save-errors.ts";

const today = "2026-10-28";
const schema = createTripFormSchema(today);
const valid = { ...defaultTripValues, destination: "  Tokyo, Japan  ", startDate: "2027-04-12", endDate: "2027-04-18", budget: "2500.50", interests: ["food", "culture"],
  resolvedDestination: destination,
  destinationProof: { payload: "test-only-proof", signature: "0".repeat(64) },
};

test("missing trip schema reports incomplete setup without exposing database details", () => {
  for (const code of ["PGRST202", "PGRST204", "PGRST205", "42703", "42883"]) {
    const result = tripSaveFailure({ code, message: "PRIVATE DATABASE DETAILS", details: "PRIVATE SECRET" });
    assert.equal(result.status, "error");
    assert.ok(result.message.includes("setup update"));
    assert.equal(result.message.includes("PRIVATE"), false);
  }
  assert.equal(tripSaveFailure({ code: "42501", message: "PRIVATE" }).message.includes("PRIVATE"), false);
});

test("valid trip trims text and defaults to one traveler with balanced preferences", () => {
  const data = schema.parse(valid);
  assert.equal(data.destination, "Tokyo, Japan");
  assert.equal(data.travelers, 1);
  assert.equal(data.budgetStyle, "balanced");
  assert.deepEqual(data.accommodationPreferences, ["hotel"]);
  assert.deepEqual(data.dietaryPreferences, []);
});

test("calendar days are valid, date-only, inclusive, and unaffected by DST", () => {
  assert.equal(tripDuration("2027-04-12", "2027-04-18"), 7);
  assert.equal(tripDuration(today, today), 1);
  assert.equal(tripDuration("2026-03-07", "2026-03-09"), 3);
  assert.equal(tripDuration("2028-02-28", "2028-03-01"), 3);
  assert.equal(tripDuration("2027-04-18", "2027-04-12"), 0);
  for (const invalid of ["2026-02-29", "2026-02-31", "2026-13-01", "2026-1-01", "2026-00-12", "0000-01-01", "2027-04-12T00:00:00Z"]) assert.equal(isDateOnly(invalid), false, invalid);
  assert.equal(isDateOnly("2028-02-29"), true);
  assert.equal(durationLabel(1), "1 day");
  assert.equal(travelersLabel(1), "1 traveler");
  assert.equal(travelersLabel(2), "2 travelers");
});

test("past starts and reversed ranges fail; same-day trips today succeed", () => {
  assert.equal(schema.safeParse({ ...valid, startDate: "2026-10-27" }).success, false);
  assert.equal(schema.safeParse({ ...valid, endDate: "2027-04-11" }).success, false);
  assert.equal(schema.safeParse({ ...valid, startDate: today, endDate: today }).success, true);
});

test("today follows the user's IANA time zone at calendar boundaries", () => {
  const instant = new Date("2026-10-28T00:30:00Z");
  assert.equal(todayInTimeZone("Asia/Calcutta", instant), "2026-10-28");
  assert.equal(todayInTimeZone("America/Los_Angeles", instant), "2026-10-27");
  assert.equal(todayInTimeZone("Pacific/Kiritimati", new Date("2026-10-28T13:00:00Z")), "2026-10-29");
  assert.equal(tripSubmissionContextSchema.safeParse({ timeZone: "not-a-zone" }).success, false);
});

test("date-step validation still runs when an unrelated step has invalid input", () => {
  const result = schema.safeParse({ ...valid, travelers: Number.NaN, startDate: "2026-10-27", endDate: "2026-10-26" });
  assert.equal(result.success, false);
  const fields = result.error.issues.map((issue) => issue.path[0]);
  assert.ok(fields.includes("travelers"));
  assert.ok(fields.includes("startDate"));
  assert.ok(fields.includes("endDate"));
});

test("invalid amounts, excess precision, non-finite values, and unsupported currencies are rejected", () => {
  for (const budget of ["", "0", "0.00", "-1", "NaN", "Infinity", "1e5", "12.345", "1,000", "100000000.01", 2500, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(schema.safeParse({ ...valid, budget }).success, false, String(budget));
  }
  for (const budget of ["0.01", "100000000", "2500.5", "000025.00"]) assert.equal(schema.safeParse({ ...valid, budget }).success, true, budget);
  assert.equal(schema.safeParse({ ...valid, currency: "XYZ" }).success, false);
  assert.equal(normalizeBudget("000025.5"), "25.50");
  assert.equal(moneyMinorUnits("2500.01"), 250001);
  assert.ok(formatTripBudget("2500.50", "USD").includes("2,500.50"));
});

test("destination, travelers, interest limits, preferences, and special requests are validated", () => {
  for (const destination of ["  ", "a", "x".repeat(1001), "Tokyo\nJapan"]) assert.equal(schema.safeParse({ ...valid, destination }).success, false);
  for (const travelers of [0, 21, 1.5, Number.NaN, "2"]) assert.equal(schema.safeParse({ ...valid, travelers }).success, false);
  for (const interests of [[], ["unknown"], ["food", "food"], ["food", "history", "culture", "nature", "adventure", "art", "shopping", "nightlife", "beaches"]]) assert.equal(schema.safeParse({ ...valid, interests }).success, false);
  assert.equal(schema.safeParse({ ...valid, accommodationPreferences: [] }).success, false);
  assert.equal(schema.safeParse({ ...valid, dietaryPreferences: ["none", "vegan"] }).success, false);
  assert.equal(schema.safeParse({ ...valid, dietaryPreferences: ["vegan", "vegan"] }).success, false);
  assert.equal(schema.safeParse({ ...valid, specialRequests: "x".repeat(501) }).success, false);
});

test("explicit mapping excludes attacker-controlled ownership, status, and location fields", () => {
  const parsed = schema.parse({ ...valid, owner_id: "attacker", status: "active", destination_latitude: 42 });
  const mapped = mapTripFormToDatabase(parsed, "Asia/Calcutta");
  assert.equal(mapped.p_destination_name, "Tokyo");
  assert.equal(mapped.p_budget_total, "2500.50");
  assert.equal(mapped.p_time_zone, "Asia/Calcutta");
  assert.equal(mapped.p_special_requests, null);
  assert.equal("owner_id" in mapped, false);
  assert.equal("p_owner_id" in mapped, false);
  assert.equal("p_status" in mapped, false);
  assert.equal("p_destination_latitude" in mapped, false);
  assert.equal("days" in mapped, false);
});
