"use client";

import { Coffee, MapPin, Martini, Utensils, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { foodCategoryLabels } from "@/lib/food/catalog";
import type { FoodCandidate } from "@/lib/food/validation";
import { optionLabel } from "@/lib/trips/options";

export function DietaryIndicators({ tags }: { tags: string[] }) {
  return tags.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{[...new Set(tags.map(tag => tag.replace(/\.only$/, "")))].map(tag => <span className="type-meta inline-flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1" key={tag}><Leaf className="size-3.5" aria-hidden="true" />{optionLabel(tag)} options indicated</span>)}</div> : null;
}
export function FoodCard({ food, saved, saving, disabled, onSave, onDetails, badgesActive }: {
  food: FoodCandidate; saved: boolean; saving: boolean; disabled: boolean; badgesActive: boolean;
  onSave: () => void; onDetails: (button: HTMLButtonElement) => void;
}) {
  const Icon = food.category === "cafe" ? Coffee : food.category === "bar" || food.category === "pub" ? Martini : Utensils;
  return <article aria-label={food.name} className={`min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm ${saved ? "border-foreground" : "border-border"}`}>
    <div className="relative flex h-32 items-center justify-center bg-surface-secondary" aria-label={`${foodCategoryLabels[food.category]} illustration`} role="img"><div className="flex size-20 items-center justify-center rounded-full border border-border/70 bg-background shadow-sm"><Icon strokeWidth={1.25} className="size-9 text-muted-foreground" aria-hidden="true" /></div><span className="type-meta absolute right-3 bottom-3 rounded-full bg-card px-2.5 py-1">{foodCategoryLabels[food.category]}</span></div>
    <div className="p-5"><h3 className="type-body font-semibold wrap-anywhere">{food.name}</h3><p className="type-small mt-1 text-muted-foreground wrap-anywhere">{[...food.cuisine_types, foodCategoryLabels[food.category]].join(" · ")}</p>
      <DietaryIndicators tags={food.dietary_tags} />
      {food.address && <p className="type-small mt-3 text-muted-foreground wrap-anywhere">{food.address}</p>}
      {food.distance_km !== null && <p className="type-small mt-3 flex items-start gap-1.5 text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{food.distance_km < 0.1 ? "Less than 0.1" : food.distance_km.toFixed(1)} km from destination center</p>}
      {badgesActive && food.labels.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{food.labels.filter(label => label !== "Best Match").map(label => <span key={label} className={`type-meta rounded-full px-2.5 py-1 font-medium ${label === "Nomivra Pick" ? "bg-accent text-accent-foreground" : "bg-surface-secondary"}`}>{label}</span>)}</div>}
      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4"><Button variant="secondary" onClick={event => onDetails(event.currentTarget)}>Details</Button><Button onClick={onSave} disabled={disabled || saved} loading={saving}>{saved ? "Saved to trip" : "Save"}</Button></div>
    </div>
  </article>;
}
