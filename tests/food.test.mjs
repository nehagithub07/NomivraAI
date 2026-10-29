import test from "node:test";
import assert from "node:assert/strict";
import { foodResponseSchema, foodSearchBodySchema } from "../src/lib/food/validation.ts";
import { defaultFoodFilters, filterAndSortFood, matchesDiets } from "../src/lib/food/catalog.ts";
import { foodResults } from "./food-fixtures.mjs";

test("food contracts reject fabricated Geoapify ratings, unsafe websites and authoritative browser inputs", () => {
  const original = foodResults(), candidate = original.candidates[0];
  assert.ok(foodResponseSchema.safeParse(original).success);
  for (const patch of [{ rating: 4.7 }, { review_count: 30 }, { website: "javascript:alert(1)" }, { website: "https://user:password@example.com" }, { latitude: 91 }]) assert.equal(foodResponseSchema.safeParse({ ...original, candidates: [{ ...candidate, ...patch }] }).success, false);
  for (const patch of [{ latitude: 1 }, { owner_id: "attacker" }, { budget_total: 1 }, { radius_meters: 100000 }, { limit: 500 }, { categories: [] }, { rating_sort: true }]) assert.equal(foodSearchBodySchema.safeParse(patch).success, false);
  assert.ok(foodSearchBodySchema.safeParse({ categories: ["cafe", "bar"], dietary_preferences: ["vegan"] }).success);
});
test("food filters handle unknown diets honestly and sorting never needs a provider", () => {
  const original = foodResults().candidates[0];
  const unknown = { ...original, name: "Alpha", provider_place_id: "unknown", dietary_tags: [], dietary_match: "unknown", distance_km: .3, recommendation_score: .6 };
  const cafe = { ...original, name: "Cafe", provider_place_id: "cafe", category: "cafe", dietary_tags: ["vegan.only"], cuisine_types: ["New Cuisine"], distance_km: .7, recommendation_score: .7 };
  const pool = [original, unknown, cafe];
  assert.equal(matchesDiets(cafe, ["vegetarian", "vegan"]), true);
  assert.deepEqual(filterAndSortFood(pool, defaultFoodFilters, "name").map(c => c.name), ["Alpha", "Cafe", "Provider Restaurant"]);
  assert.deepEqual(filterAndSortFood(pool, defaultFoodFilters, "distance").map(c => c.provider_place_id), ["unknown", "cafe", "provider-place"]);
  assert.deepEqual(filterAndSortFood(pool, defaultFoodFilters, "recommended").map(c => c.provider_place_id), ["provider-place", "cafe", "unknown"]);
  assert.equal(filterAndSortFood(pool, { ...defaultFoodFilters, diets: ["vegetarian"], confirmedOnly: true }, "recommended").length, 2);
  assert.equal(filterAndSortFood(pool, { ...defaultFoodFilters, diets: ["vegetarian"] }, "recommended").length, 3);
  assert.equal(filterAndSortFood(pool, { ...defaultFoodFilters, category: "cafe", cuisine: "New Cuisine", distanceKm: 1 }, "recommended").length, 1);
  assert.equal(filterAndSortFood(pool, { ...defaultFoodFilters, cuisine: "Italian" }, "recommended").length, 0);
  assert.equal(filterAndSortFood([{ ...unknown, dietary_conflicts: ["vegan"] }], { ...defaultFoodFilters, diets: ["vegan"] }, "recommended").length, 0);
});
