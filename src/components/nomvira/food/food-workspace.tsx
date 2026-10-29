"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FoodCard, DietaryIndicators } from "./food-card";
import { FoodFiltersPanel } from "./food-filters";
import { FoodAttribution } from "./food-attribution";
import { FoodSkeletons } from "./food-skeletons";
import { defaultFoodFilters, foodCategoryLabels, filterAndSortFood, type FoodFilters } from "@/lib/food/catalog";
import { foodErrorMessage } from "@/lib/food/errors";
import { foodCategories, foodDiets, foodSelectionSchema, signedFoodResponseSchema, type FoodCandidate, type FoodResults, type FoodSelection, type FoodSort, type FoodSearchOptions } from "@/lib/food/validation";
import { z } from "zod";

export function FoodWorkspace({ tripId, initialResults, initialSelections, initialDiets, selectionLoadFailed, canSearch, allowDemo }: {
  tripId: string; initialResults: FoodResults | null; initialSelections: FoodSelection[]; initialDiets: string[];
  selectionLoadFailed: boolean; canSearch: boolean; allowDemo: boolean;
}) {
  const [results, setResults] = useState(initialResults), [selections, setSelections] = useState(initialSelections);
  const initialFilters = { ...defaultFoodFilters, diets: initialDiets };
  const [filters, setFilters] = useState<FoodFilters>(initialFilters), [searchedFilters, setSearchedFilters] = useState(JSON.stringify(initialFilters));
  const [sort, setSort] = useState<FoodSort>("recommended"), [loading, setLoading] = useState(false), [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [selectionsUnavailable, setSelectionsUnavailable] = useState(selectionLoadFailed);
  const [details, setDetails] = useState<FoodCandidate | null>(null), [removing, setRemoving] = useState<FoodSelection | null>(null), [filtersOpen, setFiltersOpen] = useState(false);
  const detailsTrigger = useRef<HTMLButtonElement | null>(null), removeTrigger = useRef<HTMLButtonElement | null>(null);
  const savedHeading = useRef<HTMLHeadingElement | null>(null);
  const candidates = results?.candidates ?? [], visible = filterAndSortFood(candidates, filters, sort);
  const savedKey = (candidate: { provider: string; provider_place_id: string }) => `${candidate.provider}:${candidate.provider_place_id}`;
  const savedKeys = new Set(selections.map(savedKey));
  const preferencesChanged = JSON.stringify(filters) !== searchedFilters;

  useEffect(() => {
    if (!results) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(results.expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [results]);

  async function search(demo = false) {
    setLoading(true); setError(null); setNotice("");
    let failureMessage = foodErrorMessage();
    const options: FoodSearchOptions = { radius_meters: filters.distanceKm * 1000,
      ...(filters.category ? { categories: [foodCategories.find(category => category === filters.category)!] } : {}),
      dietary_preferences: foodDiets.filter(diet => filters.diets.includes(diet)), cuisine_preferences: filters.cuisine ? [filters.cuisine] : [],
      strict_dietary: filters.confirmedOnly, ...(demo ? { demo: true } : {}) };
    try {
      const response = await fetch(`/api/trips/${tripId}/food`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) });
      const body = await response.json();
      if (!response.ok) { failureMessage = foodErrorMessage(body?.error?.code); throw new Error(); }
      const parsed = signedFoodResponseSchema.safeParse(body.results);
      if (!parsed.success) throw new Error(foodErrorMessage());
      setResults(parsed.data); setExpired(false); setSearchedFilters(JSON.stringify(filters));
      setNotice(`${parsed.data.candidates.length} food spots found.`);
    } catch { setError(failureMessage); }
    finally { setLoading(false); }
  }
  async function mutate(candidate: FoodCandidate | FoodSelection, method: "POST" | "DELETE") {
    const name = candidate.name;
    setSaving(savedKey(candidate)); setError(null); setNotice("");
    let failureMessage = foodErrorMessage("persistence_unavailable");
    try {
      const response = await fetch(`/api/trips/${tripId}/food-selections`, { method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "POST" && "selection_proof" in candidate ? { proof: candidate.selection_proof } : { selection_id: (candidate as FoodSelection).id }) });
      const body = await response.json();
      if (!response.ok) { failureMessage = foodErrorMessage(body?.error?.code); throw new Error(); }
      const parsed = z.array(foodSelectionSchema).safeParse(body.selections);
      if (!parsed.success) { failureMessage = foodErrorMessage("selection_unconfirmed"); throw new Error(); }
      setSelections(parsed.data); setSelectionsUnavailable(false); setNotice(method === "POST" ? `${name} saved to your trip.` : `${name} removed from your trip.`);
      if (method === "DELETE") setRemoving(null);
    } catch { setError(failureMessage); }
    finally { setSaving(null); }
  }

  return <div className="space-y-6">
    <section aria-labelledby="saved-food-title" className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="saved-food-title" ref={savedHeading} tabIndex={-1} className="type-body font-semibold">Saved food spots <span className="text-muted-foreground">({selections.length})</span></h2><p className="type-meta text-muted-foreground">Saved for your trip · scheduling comes later</p></div>
      {selectionsUnavailable && <p className="type-small mt-3 text-muted-foreground">Your saved places couldn&apos;t be loaded. Reload to check them; saving may need a database setup update.</p>}
      {selections.length === 0 && !selectionsUnavailable && <p className="type-small mt-3 text-muted-foreground">Save a breakfast cafe, a local restaurant, or somewhere for the evening.</p>}
      {selections.length > 0 && <ul className="mt-4 divide-y">{selections.map(selection => <li key={selection.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="type-small font-medium wrap-anywhere">{selection.name}</p><p className="type-meta text-muted-foreground">{foodCategoryLabels[selection.category]}{selection.provider === "fixture" ? " · Demo place" : " · Geoapify"}</p></div><Button variant="secondary" disabled={saving !== null} aria-label={`Remove ${selection.name} from trip`} onClick={event => { removeTrigger.current = event.currentTarget; setError(null); setRemoving(selection); }}>Remove</Button></li>)}</ul>}
      {selections.some(selection => selection.provider === "geoapify") && <div className="mt-4"><FoodAttribution /></div>}
    </section>

    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-3"><label className="sr-only" htmlFor="food-sort">Sort food spots</label><select id="food-sort" className="type-small min-h-11 max-w-full rounded-xl border bg-card px-3" value={sort} onChange={event => setSort(event.target.value as FoodSort)}><option value="recommended">Recommended</option><option value="distance">Distance</option><option value="name">Name A–Z</option></select>
      <div className="lg:hidden"><Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetTrigger asChild><Button variant="secondary"><SlidersHorizontal className="size-4" aria-hidden="true" />Filters</Button></SheetTrigger><SheetContent closeLabel="Close food filters" className="w-80 p-5 pt-20"><SheetTitle className="type-body font-semibold">Food filters</SheetTitle><SheetDescription className="type-small mb-5 text-muted-foreground">Refine loaded places. Search again to find more.</SheetDescription><FoodFiltersPanel id="mobile-food" filters={filters} cuisines={candidates.flatMap(c => c.cuisine_types)} onChange={setFilters} onReset={() => setFilters({ ...defaultFoodFilters })} /><Button className="mt-5" onClick={() => setFiltersOpen(false)}>Show results</Button></SheetContent></Sheet></div>
      </div><Button disabled={!canSearch || loading || saving !== null} loading={loading} onClick={() => search()}>{results ? "Search food again" : "Find food spots"}</Button></div>
    {!canSearch && <p role="status" className="type-small rounded-xl border bg-card p-4">Food search needs a confirmed trip destination.</p>}
    <div aria-live="polite" className="sr-only">{notice}</div>
    {error && <div role="alert" className="type-small rounded-xl border bg-card p-4"><p>{error}</p>{allowDemo && <Button className="mt-3" variant="secondary" disabled={loading} onClick={() => search(true)}>Browse demo food spots</Button>}</div>}

    <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside aria-label="Food filters" className="hidden rounded-2xl border bg-card p-5 lg:block"><h2 className="type-body mb-5 font-semibold">Your food preferences</h2><FoodFiltersPanel id="desktop-food" filters={filters} cuisines={candidates.flatMap(c => c.cuisine_types)} onChange={setFilters} onReset={() => setFilters({ ...defaultFoodFilters })} /></aside>
      <section aria-label="Food recommendations" className="min-w-0 space-y-5">
        <p className="type-small text-muted-foreground">Filters refine the loaded places. Search again to find more and update recommendation scores.</p>
        {preferencesChanged && results && <p role="status" className="type-small rounded-xl border bg-card p-4">Preferences changed. Search again to update recommendations.</p>}
        {results?.demo && <div className="type-small rounded-xl border border-accent bg-accent/30 p-4"><p className="font-semibold">Demo food data</p><p className="mt-1">These places are fictional development examples.</p></div>}
        {(filters.diets.length > 0 || results?.dietary_fallback) && <p className="type-small text-muted-foreground">Some results may not have confirmed dietary information. Dietary information is provider-supplied. Confirm directly with the restaurant when necessary.</p>}
        {loading ? <FoodSkeletons /> : expired ? <div role="status" className="rounded-2xl border bg-card p-6"><p className="type-small">These results have expired. Search again before saving a place. Your saved food spots remain available.</p></div> : !results ? <div className="rounded-2xl border bg-card px-5 py-14 text-center"><Utensils className="mx-auto size-9 text-muted-foreground" strokeWidth={1.25} aria-hidden="true" /><h2 className="type-body mt-5 font-semibold">Find your next food stop</h2><p className="type-small mx-auto mt-2 max-w-sm text-muted-foreground">Discover restaurants, cafes and local food around your destination. Start with a search.</p></div> : visible.length === 0 ? <div className="rounded-2xl border bg-card p-8 text-center"><h2 className="type-body font-semibold">No food spots match these filters.</h2><p className="type-small mt-3 text-muted-foreground">Try increasing the distance, removing a cuisine filter, or relaxing dietary filters, then search again.</p></div> : <><p className="type-small text-muted-foreground">{visible.length} food spots · straight-line distances</p><div className="grid gap-5 sm:grid-cols-2">{visible.map(food => <FoodCard key={savedKey(food)} food={food} badgesActive={!preferencesChanged} saved={savedKeys.has(savedKey(food))} saving={saving === savedKey(food)} disabled={saving !== null || expired} onSave={() => mutate(food, "POST")} onDetails={button => { detailsTrigger.current = button; setDetails(food); }} />)}</div></>}
        {results && <><p className="type-meta text-muted-foreground">Nomivra Pick is the highest deterministic recommendation score, based on your active preferences, distance and supplied information.</p><FoodAttribution demo={results.demo} /></>}
      </section>
    </div>

    <Sheet open={details !== null} onOpenChange={open => { if (!open) setDetails(null); }}><SheetContent className="w-96 p-6 pt-20" closeLabel="Close food details" onCloseAutoFocus={event => { event.preventDefault(); detailsTrigger.current?.focus(); }}><SheetTitle className="type-body font-semibold wrap-anywhere">{details?.name}</SheetTitle><SheetDescription className="type-small mt-2 text-muted-foreground">{details && [foodCategoryLabels[details.category], ...details.cuisine_types].join(" · ")}</SheetDescription>{details && <div className="type-small mt-5 space-y-5"><DietaryIndicators tags={details.dietary_tags} />{details.address && <p className="wrap-anywhere">{details.address}</p>}{details.distance_km !== null && <p>{details.distance_km.toFixed(1)} km from destination center</p>}{details.opening_hours ? <div><p className="font-medium">Provider-supplied opening hours</p><p className="mt-1 wrap-anywhere">{details.opening_hours}</p></div> : <p className="text-muted-foreground">Opening hours not supplied.</p>}{details.website && <a className="inline-flex min-h-11 items-center font-medium underline underline-offset-4" href={details.website} target="_blank" rel="noopener noreferrer">Visit website</a>}<p className="text-muted-foreground">Dietary information is provider-supplied. Confirm directly with the restaurant when necessary.</p><FoodAttribution demo={results?.demo} /></div>}</SheetContent></Sheet>
    <Sheet open={removing !== null} onOpenChange={open => { if (!open && !saving) setRemoving(null); }}><SheetContent role="alertdialog" className="w-96 p-6 pt-20" closeLabel="Cancel removal" onCloseAutoFocus={event => { event.preventDefault(); if (removeTrigger.current?.isConnected) removeTrigger.current.focus(); else savedHeading.current?.focus(); }}><SheetTitle className="type-body font-semibold">Remove this food spot?</SheetTitle><SheetDescription className="type-small mt-3 text-muted-foreground">{removing?.name} will be removed from this trip. You can save it again from search results.</SheetDescription>{error && <p role="alert" className="type-small mt-4">{error}</p>}<div className="mt-6 flex flex-wrap gap-3"><Button variant="secondary" disabled={saving !== null} onClick={() => setRemoving(null)}>Keep place</Button><Button loading={saving !== null} disabled={saving !== null} onClick={() => removing && mutate(removing, "DELETE")}>Remove from trip</Button></div></SheetContent></Sheet>
  </div>;
}
