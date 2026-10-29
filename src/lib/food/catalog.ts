import type { FoodCandidate, FoodSort } from "./validation.ts";

export const foodCategoryLabels = { restaurant: "Restaurant", cafe: "Cafe", bar: "Bar", pub: "Pub", fast_food: "Fast food", food_court: "Food court", dessert: "Dessert", other: "Other" };
export const cuisineOptions = ["Indian", "Italian", "Japanese", "Chinese", "Mexican", "Thai", "Korean", "French", "Mediterranean", "American", "Vietnamese", "Spanish", "Greek", "Seafood", "Sushi", "Pizza", "Ramen", "Burger", "Vegetarian-friendly"];
export const defaultFoodCategories = ["restaurant", "cafe", "bar", "pub", "fast_food", "food_court"] as const;
export type FoodFilters = { category: string; cuisine: string; diets: string[]; confirmedOnly: boolean; distanceKm: number };
export const defaultFoodFilters: FoodFilters = { category: "", cuisine: "", diets: [], confirmedOnly: false, distanceKm: 5 };
export function matchesDiets(candidate: Pick<FoodCandidate, "dietary_tags">, diets: string[]) {
  const tags = new Set(candidate.dietary_tags.map(tag => tag.replace(/\.only$/, "")));
  if (tags.has("vegan")) tags.add("vegetarian");
  return diets.every(diet => tags.has(diet));
}
export function filterAndSortFood(candidates: FoodCandidate[], filters: FoodFilters, sort: FoodSort) {
  const filtered = candidates.filter(c => (!filters.category || c.category === filters.category)
    && (!filters.cuisine || c.cuisine_types.some(cuisine => cuisine.toLowerCase() === filters.cuisine.toLowerCase()))
    && c.distance_km !== null && c.distance_km <= filters.distanceKm
    && !c.dietary_conflicts.some(diet => filters.diets.includes(diet))
    && (!filters.confirmedOnly || matchesDiets(c, filters.diets)));
  const tie = (a: FoodCandidate, b: FoodCandidate) => a.name.localeCompare(b.name, "en") || a.provider.localeCompare(b.provider) || a.provider_place_id.localeCompare(b.provider_place_id);
  return filtered.sort((a, b) => sort === "name" ? tie(a, b) : sort === "distance" ? (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) || tie(a, b) : b.recommendation_score - a.recommendation_score || tie(a, b));
}
