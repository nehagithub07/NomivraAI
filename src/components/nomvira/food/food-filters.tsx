"use client";

import { Button } from "@/components/ui/button";
import { cuisineOptions, foodCategoryLabels, defaultFoodCategories, type FoodFilters } from "@/lib/food/catalog";
import { foodDiets } from "@/lib/food/validation";
import { optionLabel } from "@/lib/trips/options";

const selectClass = "type-small mt-2 min-h-11 w-full min-w-0 rounded-xl border bg-card px-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
export function FoodFiltersPanel({ id, filters, cuisines, onChange, onReset }: {
  id: string; filters: FoodFilters; cuisines: string[]; onChange: (filters: FoodFilters) => void; onReset: () => void;
}) {
  const choices = [...new Set([...cuisineOptions, ...cuisines])].sort((a, b) => a.localeCompare(b));
  return <div className="space-y-5">
    <label htmlFor={`${id}-category`} className="type-small block font-medium">Food type<select id={`${id}-category`} value={filters.category} className={selectClass} onChange={event => onChange({ ...filters, category: event.target.value })}><option value="">All food types</option>{defaultFoodCategories.map(category => <option key={category} value={category}>{foodCategoryLabels[category]}</option>)}</select></label>
    <label htmlFor={`${id}-cuisine`} className="type-small block font-medium">Cuisine<select id={`${id}-cuisine`} value={filters.cuisine} className={selectClass} onChange={event => onChange({ ...filters, cuisine: event.target.value })}><option value="">Any cuisine</option>{choices.map(cuisine => <option key={cuisine}>{cuisine}</option>)}</select></label>
    <fieldset><legend className="type-small font-medium">Dietary preference</legend><div className="mt-2">{foodDiets.map(diet => <label key={diet} className="type-small flex min-h-11 cursor-pointer items-center gap-3"><input className="size-4 accent-black" type="checkbox" checked={filters.diets.includes(diet)} onChange={event => onChange({ ...filters, diets: event.target.checked ? [...filters.diets, diet] : filters.diets.filter(value => value !== diet) })} />{optionLabel(diet)}</label>)}</div><p className="type-meta text-muted-foreground">None selected means no preference.</p></fieldset>
    <label className="type-small flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" className="size-4 shrink-0 accent-black" checked={filters.confirmedOnly} onChange={event => onChange({ ...filters, confirmedOnly: event.target.checked })} />Only provider-indicated dietary matches</label>
    <label htmlFor={`${id}-distance`} className="type-small block font-medium">Distance from destination center<select id={`${id}-distance`} className={selectClass} value={filters.distanceKm} onChange={event => onChange({ ...filters, distanceKm: Number(event.target.value) })}>{[1, 3, 5, 10, 15].map(distance => <option key={distance} value={distance}>Within {distance} km</option>)}</select></label>
    <Button className="w-full" variant="secondary" onClick={onReset}>Reset filters</Button>
  </div>;
}
