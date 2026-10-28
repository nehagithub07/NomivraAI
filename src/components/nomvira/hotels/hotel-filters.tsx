"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { accommodationTypes } from "@/lib/accommodations/validation";
import { defaultHotelFilters, type HotelFilters } from "@/lib/accommodations/catalog";
import { optionLabel } from "@/lib/trips/options";

export function HotelFilterFields({ filters, onChange, prefix, currency, disabled = false }: {
  filters: HotelFilters; onChange: (value: HotelFilters) => void; prefix: string; currency: string; disabled?: boolean;
}) {
  function field(key: keyof HotelFilters, value: string) {
    if ((key === "minPrice" || key === "maxPrice") && value && !/^\d{1,10}(?:\.\d{0,2})?$/.test(value)) return;
    onChange({ ...filters, [key]: value });
  }
  const selectClass = "field-control type-small mt-2 h-12 w-full min-w-0 px-3";
  return <fieldset disabled={disabled} className="space-y-5">
    <legend className="sr-only">Filter accommodation results</legend>
    <div><Label htmlFor={`${prefix}-stars`}>Star classification</Label><select id={`${prefix}-stars`} className={selectClass} value={filters.stars} onChange={event => field("stars", event.target.value)}>
      <option value="">Any classification</option><option value="3">3-star and above</option><option value="4">4-star and above</option><option value="5">5-star</option>
    </select><p className="type-meta mt-2 text-muted-foreground">Unclassified stays are hidden only when you set a star filter.</p></div>
    <fieldset><legend className="type-small font-medium">Stay total ({currency})</legend><div className="mt-2 grid grid-cols-2 gap-2">
      <div><Label htmlFor={`${prefix}-min-price`}>Minimum</Label><Input id={`${prefix}-min-price`} aria-label={`Minimum stay total (${currency})`} className="mt-2" type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" placeholder="Any" value={filters.minPrice} onChange={event => field("minPrice", event.target.value)} /></div>
      <div><Label htmlFor={`${prefix}-price`}>Maximum</Label><Input id={`${prefix}-price`} aria-label={`Maximum stay total (${currency})`} className="mt-2" type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" placeholder="Any" value={filters.maxPrice} onChange={event => field("maxPrice", event.target.value)} /></div>
      </div><p className="type-meta mt-2 text-muted-foreground">Uses known totals in your trip currency.</p></fieldset>
    <div><Label htmlFor={`${prefix}-type`}>Accommodation type</Label><select id={`${prefix}-type`} className={selectClass} value={filters.type} onChange={event => field("type", event.target.value)}>
      <option value="">All matching types</option>{accommodationTypes.map(type => <option key={type} value={type}>{optionLabel(type.replaceAll("_", " "))}</option>)}
    </select></div>
    <div><Label htmlFor={`${prefix}-rating`}>Guest rating</Label><select id={`${prefix}-rating`} className={selectClass} value={filters.minRating} onChange={event => field("minRating", event.target.value)}>
      <option value="">Any guest rating</option><option value="0.7">7/10 equivalent or higher</option><option value="0.8">8/10 equivalent or higher</option><option value="0.9">9/10 equivalent or higher</option>
    </select></div>
    <div><Label htmlFor={`${prefix}-distance`}>Distance from destination</Label><select id={`${prefix}-distance`} className={selectClass} value={filters.maxDistance} onChange={event => field("maxDistance", event.target.value)}>
      <option value="">Any distance</option>{[1, 5, 10, 20, 30].map(distance => <option key={distance} value={distance}>Within {distance} km</option>)}
    </select><p className="type-meta mt-2 text-muted-foreground">Straight-line distance, not travel time.</p></div>
    <Button variant="secondary" className="w-full" onClick={() => onChange({ ...defaultHotelFilters })}>Clear filters</Button>
  </fieldset>;
}
