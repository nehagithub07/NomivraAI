"use client";

import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Check, LoaderCircle, MapPin, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { TripFormValues } from "@/lib/trips/validation";
import { signedSearchResponseSchema, resolvedDestinationSchema, type DestinationSuggestion } from "@/lib/destinations/validation";
import { FieldError, useWizardField } from "../wizard-field";
import { ProviderAttribution } from "../provider-attribution";

type State = "idle" | "typing" | "loading" | "results" | "empty" | "error" | "selected";
type SearchCache = Map<string, { expiresAt: number; suggestions: DestinationSuggestion[] }>;
function cachedSuggestions(cache: SearchCache, query: string) {
  const key = query.trim().toLocaleLowerCase(), entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.suggestions;
  cache.delete(key); return undefined;
}
export function DestinationStep() {
  const { register, control, setValue, clearErrors } = useFormContext<TripFormValues>();
  const query = useWatch({ control, name: "destination" });
  const destination = useWatch({ control, name: "resolvedDestination" });
  const [state, setState] = useState<State>(destination ? "selected" : "idle");
  const [suggestions, setSuggestions] = useState<DestinationSuggestion[]>([]);
  const [active, setActive] = useState(-1), [open, setOpen] = useState(false), [retry, setRetry] = useState(0);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null), input = useRef<HTMLInputElement | null>(null);
  const recentSearches = useRef<SearchCache>(new Map());
  const accessible = useWizardField("destination"), field = register("destination");
  useEffect(() => {
    if (destination || query.trim().length < 3 || cachedSuggestions(recentSearches.current, query)) return;
    const id = ++sequence.current, abort = new AbortController(); controller.current = abort;
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(`/api/destinations/search?${new URLSearchParams({ q: query.trim(), limit: "8" })}`, { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = signedSearchResponseSchema.parse(await response.json());
        if (sequence.current !== id) return;
        recentSearches.current.set(query.trim().toLocaleLowerCase(), { expiresAt: Date.now() + 60_000, suggestions: data.destinations });
        if (recentSearches.current.size > 32) {
          const oldest = recentSearches.current.keys().next().value;
          if (oldest !== undefined) recentSearches.current.delete(oldest);
        }
        setSuggestions(data.destinations); setActive(-1); setOpen(document.activeElement === input.current);
        setState(data.destinations.length ? "results" : "empty");
      } catch { if (!abort.signal.aborted && sequence.current === id) { setState("error"); setSuggestions([]); } }
    }, 300);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [query, destination, retry]);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  function edit(value: string) {
    sequence.current++; controller.current?.abort();
    setValue("destination", value, { shouldDirty: true }); setValue("resolvedDestination", null); setValue("destinationProof", null);
    const cached = value.trim().length >= 3 ? cachedSuggestions(recentSearches.current, value) : undefined;
    setState(cached ? (cached.length ? "results" : "empty") : value.trim().length >= 3 ? "typing" : "idle");
    setSuggestions(cached || []); setActive(-1); setOpen(true); clearErrors("destination");
  }
  function select(suggestion: DestinationSuggestion) {
    sequence.current++; controller.current?.abort();
    const resolved = resolvedDestinationSchema.parse(suggestion);
    setValue("destination", resolved.display_name); setValue("resolvedDestination", resolved); setValue("destinationProof", suggestion.proof);
    clearErrors(["destination", "resolvedDestination", "destinationProof"]); setSuggestions([]); setOpen(false); setState("selected"); input.current?.focus();
  }
  const expanded = open && !destination && state === "results" && suggestions.length > 0;
  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(`destination-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);
  return <div className="max-w-xl">
    <Label htmlFor="destination">Destination</Label>
    <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); } }}>
      <MapPin className="pointer-events-none absolute top-4 left-4 size-4 text-muted-foreground" aria-hidden="true" />
      <Input id="destination" {...field} ref={(node) => { field.ref(node); input.current = node; }} {...accessible}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls="destination-results"
        aria-activedescendant={expanded && active >= 0 ? `destination-option-${active}` : undefined}
        placeholder="Search a city, region, or island" autoComplete="off" maxLength={destination ? 600 : 100} className="pr-12 pl-11"
        value={query} readOnly={!!destination} onChange={(event) => edit(event.target.value.slice(0, 100))} onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); return; }
          if (event.key === "Tab") { setOpen(false); return; }
          if (["ArrowDown", "ArrowUp"].includes(event.key) && suggestions.length) {
            event.preventDefault(); setOpen(true); setActive((current) => event.key === "ArrowDown" ? (current + 1) % suggestions.length : (current <= 0 ? suggestions.length - 1 : current - 1));
          }
          if (event.key === "Enter" && expanded) { event.preventDefault(); if (active >= 0) select(suggestions[active]); }
        }} />
      {state === "loading" && <LoaderCircle className="absolute top-4 right-4 size-4 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />}
      {destination && <Button type="button" size="icon" variant="ghost" aria-label="Clear destination" className="absolute top-0.5 right-0.5" onClick={() => { edit(""); input.current?.focus(); }}><X className="size-4" /></Button>}
      <div hidden={!expanded} className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border bg-card p-1 shadow-lg">
        <ul id="destination-results" role="listbox" aria-label="Matching destinations" className="max-h-64 overflow-y-auto">
          {suggestions.map((suggestion, index) => <li key={suggestion.provider_location_id} role="presentation">
            <button type="button" role="option" id={`destination-option-${index}`} aria-selected={active === index} tabIndex={-1}
              className={`flex min-h-14 w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-surface-secondary ${active === index ? "bg-surface-secondary" : ""}`}
              onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => select(suggestion)}>
              <MapPin className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0"><span className="type-small block font-medium wrap-anywhere">{suggestion.name}</span><span className="type-meta block text-muted-foreground wrap-anywhere">{suggestion.display_name}</span></span>
            </button>
          </li>)}
        </ul>
        <div className="border-t px-3 pb-2"><ProviderAttribution provider="open_meteo" /></div>
      </div>
    </div>
    <FieldError name="destination" />
    <div role="status" aria-live="polite" className="type-small mt-3 text-muted-foreground">
      {state === "idle" && "Type at least three characters, then select a destination."}
      {state === "typing" && "Keep typing to find your destination."}
      {state === "loading" && "Searching destinations…"}
      {state === "empty" && "No matching destinations found. Try a different spelling."}
      {state === "results" && `${suggestions.length} destinations found. Use the arrow keys to choose.`}
      {state === "error" && <><span>Destination search is temporarily unavailable. Please try again.</span><Button variant="ghost" size="sm" onClick={() => { setState("typing"); setRetry((value) => value + 1); input.current?.focus(); }}>Try again</Button></>}
      {destination && <span className="flex items-center gap-2"><Check className="size-4 text-primary" aria-hidden="true" />{destination.timezone || "Destination confirmed. Timezone is not available."}</span>}
    </div>
    {destination && <ProviderAttribution provider="open_meteo" />}
  </div>;
}
