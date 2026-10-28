"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { BedDouble, Check, ExternalLink, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { signedHotelResponseSchema, selectionSchema, type HotelCandidate, type HotelSearchResults, type HotelSort, type StaySelection } from "@/lib/accommodations/validation";
import { defaultHotelFilters, filterAndSortHotels, type HotelFilters } from "@/lib/accommodations/catalog";
import { hotelErrorMessage } from "@/lib/accommodations/errors";
import { HotelFilterFields } from "./hotel-filters";
import { HotelCard, hotelMoney } from "./hotel-card";

async function failureMessage(response: Response) {
  const body = await response.json().catch(() => null);
  return hotelErrorMessage(body?.error?.code ?? (response.status === 401 ? "unauthorized" : undefined));
}
export function HotelSkeletons() {
  return <div role="status" aria-label="Searching accommodations" className="space-y-4"><span className="sr-only">Finding stays for your trip</span>{[0, 1, 2].map(index => <div key={index} aria-hidden="true" className="grid overflow-hidden rounded-2xl border bg-card sm:grid-cols-[10rem_1fr]">
    <Skeleton className="h-40 rounded-none sm:h-full" /><div className="space-y-4 p-6"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /><div className="flex justify-between gap-3 pt-5"><Skeleton className="h-8 w-24" /><Skeleton className="h-11 w-28" /></div></div>
  </div>)}</div>;
}

export function HotelsWorkspace({ tripId, currency, initialResults, initialSelection, selectionLoadFailed = false, canSearch, currentContext, allowDemo = false }: {
  tripId: string; currency: string; initialResults: HotelSearchResults | null; initialSelection: StaySelection | null;
  selectionLoadFailed?: boolean; canSearch: boolean; currentContext: Record<string, unknown>; allowDemo?: boolean;
}) {
  const router = useRouter();
  const [results, setResults] = useState(initialResults), [selection, setSelection] = useState(initialSelection);
  const [filters, setFilters] = useState<HotelFilters>({ ...defaultHotelFilters }), [sort, setSort] = useState<HotelSort>("recommended");
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string>(), [announcement, setAnnouncement] = useState("");
  const [offerDemo, setOfferDemo] = useState(false);
  const [expired, setExpired] = useState(false), [filtersOpen, setFiltersOpen] = useState(false);
  const [pending, setPending] = useState<HotelCandidate | null>(null), [details, setDetails] = useState<HotelCandidate | null>(null);
  const searchLock = useRef(false), mutationLock = useRef(false), abort = useRef<AbortController | null>(null);
  const demoRequested = useRef(false);
  const replaceTrigger = useRef<HTMLButtonElement | null>(null), selectedPanel = useRef<HTMLDivElement | null>(null);
  const detailsTrigger = useRef<HTMLButtonElement | null>(null), searchButton = useRef<HTMLButtonElement | null>(null);
  const visible = useMemo(() => filterAndSortHotels(results?.candidates || [], filters, sort), [results, filters, sort]);
  const selectedCandidate = results?.candidates.find(candidate => candidate.provider === selection?.provider && candidate.provider_accommodation_id === selection?.provider_accommodation_id);
  const contextMatches = selection ? Object.entries(currentContext).every(([key, value]) => JSON.stringify(value) === JSON.stringify(selection.search_context[key])) : true;
  const selectedName = selectedCandidate?.name || selection?.selected_name || "Stay saved to this trip";
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!results) return;
    const timer = window.setTimeout(() => { setResults(null); setDetails(null); setPending(null); setExpired(true); }, Math.max(0, Date.parse(results.expires_at) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [results]);

  async function search(refresh = false, demo = demoRequested.current) {
    if (searchLock.current) return;
    searchLock.current = true; abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError(undefined); setOfferDemo(false);
    try {
      const response = await fetch(`/api/trips/${tripId}/hotels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh, demo }), cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
      if (!response.ok) { setError(await failureMessage(response)); setOfferDemo(response.status === 429 || response.status === 503); return; }
      const parsed = z.object({ results: signedHotelResponseSchema }).parse(await response.json());
      setResults(parsed.results); setExpired(false);
      demoRequested.current = demo;
      setAnnouncement(`${parsed.results.candidates.length} matching accommodations loaded${parsed.results.demo ? " using demo data" : ""}.`);
    } catch { if (!controller.signal.aborted) { setError(hotelErrorMessage(undefined)); setOfferDemo(true); } }
    finally { setLoading(false); searchLock.current = false; }
  }
  async function save(candidate: HotelCandidate) {
    if (mutationLock.current) return;
    if (!results || Date.parse(results.expires_at) <= Date.now()) { setError(hotelErrorMessage("selection_expired")); setPending(null); return; }
    mutationLock.current = true; setSaving(candidate.provider_accommodation_id); setError(undefined); setOfferDemo(false);
    try {
      const response = await fetch(`/api/trips/${tripId}/accommodation-selection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proof: candidate.selection_proof, expected_selection_id: selection?.id || null }) });
      if (!response.ok) { setError(await failureMessage(response)); setPending(null); return; }
      const data = z.object({ selection: selectionSchema }).parse(await response.json());
      setSelection(data.selection); setPending(null); setAnnouncement(`${candidate.name} selected for your trip.`); router.refresh();
    } catch { setError(hotelErrorMessage("selection_unconfirmed")); setPending(null); }
    finally { mutationLock.current = false; setSaving(null); }
  }
  async function clearSelection() {
    if (!selection || mutationLock.current) return;
    mutationLock.current = true; setSaving("clear"); setError(undefined); setOfferDemo(false);
    try {
      const response = await fetch(`/api/trips/${tripId}/accommodation-selection`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_selection_id: selection.id }) });
      if (!response.ok) { setError(await failureMessage(response)); return; }
      setSelection(null); setAnnouncement("Stay selection removed."); router.refresh();
    } catch { setError(hotelErrorMessage("selection_unconfirmed")); }
    finally { mutationLock.current = false; setSaving(null); }
  }
  function choose(candidate: HotelCandidate, button: HTMLButtonElement) {
    replaceTrigger.current = button;
    if (selection) setPending(candidate); else void save(candidate);
  }

  return <div className="min-w-0">
    <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    {selection && <div ref={selectedPanel} tabIndex={-1} className="mb-6 rounded-2xl border bg-card p-5 outline-none sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="type-meta flex flex-wrap items-center gap-2 font-medium"><Check className="size-4" aria-hidden="true" />Your selected stay{selection.provider === "fixture" && <span className="rounded-full bg-accent px-2 py-1 text-accent-foreground">Demo selection</span>}</p><h2 className="type-body mt-2 font-semibold wrap-anywhere">{selectedName}</h2>
        <p className="type-small mt-2 text-muted-foreground">{!contextMatches ? "Trip details changed since this choice. Search again to review your stay." : selectedCandidate ? "Saved as your trip preference. Arrange a reservation with the provider when you're ready." : "Your choice is saved. Search to load its latest details and prices."}</p></div>
        <Button variant="ghost" loading={saving === "clear"} disabled={!!saving || loading} onClick={() => void clearSelection()}>Remove selection</Button></div>
    </div>}
    {selectionLoadFailed && <p className="type-small mb-5 text-muted-foreground">Your saved stay couldn&apos;t be loaded. Saving a choice may need a setup update.</p>}
    {results?.demo && <div role="note" className="mb-5 rounded-xl border bg-accent p-4"><p className="type-small font-semibold text-accent-foreground">Demo accommodation data</p><p className="type-small mt-1 text-muted-foreground">Fictional properties, prices and reviews for development. These are not live offers or confirmed availability.</p></div>}
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">{results ? <><p className="type-small font-medium">{visible.length} matching {visible.length === 1 ? "stay" : "stays"}</p><p className="type-meta mt-1 text-muted-foreground">Suggested stay budget: {hotelMoney(results.stay_budget, results.currency)} · {results.rooms} {results.rooms === 1 ? "room" : "rooms"}</p></> : <p className="type-small text-muted-foreground">Compare stays for your trip dates and preferences.</p>}</div>
      <Button ref={searchButton} onClick={() => void search(!!results)} disabled={!canSearch || loading || !!saving} loading={loading}>{results && <RefreshCw className="size-4" aria-hidden="true" />}{results ? "Refresh prices" : "Find stays"}</Button>
    </div>
    {error && <div className="mb-5 rounded-xl border border-destructive/20 bg-card p-4"><p role="alert" className="type-small text-destructive">{error}</p>{offerDemo && allowDemo && canSearch && <Button variant="secondary" className="mt-3" disabled={loading || !!saving} onClick={() => void search(false, true)}>Browse demo stays</Button>}</div>}
    {expired && <p role="status" className="type-small mb-5 text-muted-foreground">These results have expired. Search again before selecting a stay.</p>}
    {!canSearch && <p className="type-small mb-5 text-muted-foreground">Hotel search needs a confirmed destination and a future stay of 1–90 nights. Same-day trips have no hotel nights.</p>}
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside aria-label="Accommodation filters" className="hidden min-w-0 rounded-2xl border bg-card p-5 lg:block"><h2 className="type-body mb-5 font-semibold">Filters</h2><HotelFilterFields filters={filters} onChange={setFilters} prefix="desktop" currency={currency} disabled={!results || loading} /></aside>
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-xs"><Label htmlFor="hotel-sort">Sort stays</Label><select id="hotel-sort" className="field-control type-small mt-2 h-12 w-full min-w-0 px-3" value={sort} disabled={!results || loading} onChange={event => setSort(event.target.value as HotelSort)}>
            <option value="recommended">Recommended</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="guest_rating">Guest rating</option><option value="distance">Distance</option>
          </select></div>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetTrigger asChild><Button variant="secondary" className="h-12 lg:hidden" disabled={!results || loading}><SlidersHorizontal className="size-4" aria-hidden="true" />Filters</Button></SheetTrigger><SheetContent closeLabel="Close filters" className="w-80 p-6"><SheetTitle className="type-section pr-7">Filters</SheetTitle><SheetDescription className="type-small mt-2 mb-6 text-muted-foreground">Refine these stays by price, guest rating and distance.</SheetDescription><HotelFilterFields filters={filters} onChange={setFilters} prefix="mobile" currency={currency} /><Button className="mt-6" onClick={() => setFiltersOpen(false)}>Show {visible.length} stays</Button></SheetContent></Sheet>
        </div>
        {loading && !results ? <HotelSkeletons /> : results ? <>
          {visible.length ? <div className="space-y-4">{visible.map(hotel => <HotelCard key={`${hotel.provider}/${hotel.provider_accommodation_id}`} hotel={hotel} demo={results.demo} nights={results.hotel_nights} rooms={results.rooms} tripCurrency={currency}
            selected={contextMatches && hotel.provider === selection?.provider && hotel.provider_accommodation_id === selection.provider_accommodation_id}
            disabled={loading || !!saving} saving={saving === hotel.provider_accommodation_id} onSelect={choose} onDetails={(candidate, button) => { detailsTrigger.current = button; setDetails(candidate); }} />)}</div>
            : <SurfaceCard size="panel" className="p-7 text-center"><BedDouble className="mx-auto mb-4 size-8 text-muted-foreground" aria-hidden="true" /><h2 className="type-body font-semibold">{results.candidates.length ? "No stays match these filters" : "No matching stays found"}</h2><p className="type-small mt-2 text-muted-foreground">{results.candidates.length ? "Try a wider price, rating or distance range." : "No eligible accommodations were returned for this trip's dates and preferences."}</p>{results.candidates.length > 0 && <Button variant="secondary" className="mt-5" onClick={() => setFilters({ ...defaultHotelFilters })}>Reset filters</Button>}</SurfaceCard>}
          <p className="type-meta mt-5 text-muted-foreground">{results.attribution}{results.cached && " Recent cached results."}</p>
          <p className="type-meta mt-2 text-muted-foreground">Recommendations consider your budget, guest-review confidence, location, stay preferences and property class.</p>
        </> : <SurfaceCard size="panel" className="flex min-h-72 flex-col items-center justify-center p-7 text-center"><div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-surface-secondary"><BedDouble className="size-7" aria-hidden="true" /></div><h2 className="type-section">A stay that fits your trip</h2><p className="type-small mt-3 max-w-md text-muted-foreground">Find accommodation options, compare guest reviews and stay totals, then save your choice to this trip.</p></SurfaceCard>}
      </div>
    </div>
    <Dialog.Root open={pending !== null} onOpenChange={open => { if (!open && !saving) setPending(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30" /><Dialog.Content
      onCloseAutoFocus={event => { event.preventDefault(); if (replaceTrigger.current?.isConnected && !replaceTrigger.current.disabled) replaceTrigger.current.focus(); else selectedPanel.current?.focus(); }}
      className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-6 shadow-lg outline-none"><Dialog.Title className="type-section">Replace your selected stay?</Dialog.Title><Dialog.Description className="type-small mt-3 text-muted-foreground">Your saved choice will change to {pending?.name}. This updates your trip preference.</Dialog.Description><div className="mt-6 flex flex-wrap justify-end gap-3"><Dialog.Close asChild><Button variant="secondary" disabled={!!saving}>Keep current stay</Button></Dialog.Close><Button loading={!!saving} onClick={() => { if (pending) void save(pending); }}>Replace stay</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={details !== null} onOpenChange={open => { if (!open) setDetails(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30" /><Dialog.Content onCloseAutoFocus={event => { event.preventDefault(); if (detailsTrigger.current?.isConnected) detailsTrigger.current.focus(); else searchButton.current?.focus(); }} className="fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-6 shadow-lg outline-none"><Dialog.Title className="type-section pr-10 wrap-anywhere">{details?.name}</Dialog.Title><Dialog.Description className="type-small mt-3 text-muted-foreground">{results?.demo ? "Demo property details. Fictional development data." : "Details supplied by the accommodation provider."}</Dialog.Description>
      {details?.address && <p className="type-small mt-5 wrap-anywhere">{details.address}</p>}{details && details.amenities.length > 0 && <div className="mt-5"><h3 className="type-body font-medium">Amenities</h3><ul className="type-small mt-3 list-disc space-y-2 pl-5 text-muted-foreground">{details.amenities.map((amenity, index) => <li key={index}>{amenity}</li>)}</ul></div>}
      {details?.booking_url && <a className="type-small mt-6 inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4" href={details.booking_url} target="_blank" rel="noopener noreferrer">View provider booking option<ExternalLink className="size-4" aria-hidden="true" /></a>}
      <Dialog.Close asChild><Button variant="ghost" size="icon" className="absolute top-4 right-4" aria-label="Close hotel details"><X className="size-4" aria-hidden="true" /></Button></Dialog.Close>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
