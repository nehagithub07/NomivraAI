"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BedDouble, CalendarDays, MapPin, Sparkles, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { itineraryErrorMessage } from "@/lib/itineraries/errors";
import { savedItinerarySchema, budgetSummarySchema, type BudgetSummary, type SavedItinerary, type ItineraryVersionSummary } from "@/lib/itineraries/validation";
import { formatTripBudget } from "@/lib/travel-format";
import { WeatherWorkspace, WeatherDaySummary } from "@/components/nomvira/weather/weather-workspace";
import type { WeatherReport } from "@/lib/weather/validation";
import {
  DayRouteSummary,
} from "@/components/nomvira/maps/day-route-summary";

const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
export function ItineraryWorkspace({ tripId, initialItinerary, versions: initialVersions, canGenerate, loadFailed, tripBudget, currency }: {
  tripId: string; initialItinerary: SavedItinerary | null; versions: ItineraryVersionSummary[];
  canGenerate: boolean; loadFailed: boolean; tripBudget: number; currency: string;
}) {
  const [saved, setSaved] = useState(initialItinerary), [versions, setVersions] = useState(initialVersions);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [budget, setBudget] = useState<BudgetSummary | null>(null);
  const [weather, setWeather] = useState<WeatherReport | null>(null), [weatherBusy, setWeatherBusy] = useState(false);
  const active = useRef(false), requestId = useRef<string | null>(null);
  async function generate() {
    if (active.current || weatherBusy || !canGenerate || loadFailed || (saved && !saved.is_current)) return;
    active.current = true; setPending(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/trips/${tripId}/itinerary/generate`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId.current, regenerate: Boolean(saved) }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const code = result?.error?.code;
        setError(itineraryErrorMessage(code));
        if (!["ITINERARY_IN_PROGRESS", "ITINERARY_PERSISTENCE_UNAVAILABLE"].includes(code)) requestId.current = null;
        return;
      }
      const next = savedItinerarySchema.parse(result.itinerary);
      setSaved(next); setBudget(result.budget ? budgetSummarySchema.parse(result.budget) : null);
      setVersions(previous => [{ id: next.id, version_number: next.version_number, created_at: next.created_at, is_current: true },
        ...previous.filter(v => v.id !== next.id).map(v => ({ ...v, is_current: false }))].slice(0, 20));
      requestId.current = null;
    } catch { setError(itineraryErrorMessage("ITINERARY_PERSISTENCE_UNAVAILABLE")); }
    finally { active.current = false; setPending(false); }
  }
  return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <SurfaceCard size="panel" className="p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-2xl"><h2 className="type-section">{saved ? saved.itinerary.title : "Plan your trip with AI"}</h2>
          <p className="type-body mt-2 text-muted-foreground">{saved ? saved.itinerary.summary : "We'll use your trip preferences and real places you've discovered to build a personalized day-by-day itinerary."}</p>
          <p className="type-meta mt-3 text-muted-foreground">Generation sends your planning preferences and saved place details to Gemini. Costs and travel times are never guessed.</p></div>
        {(!saved || saved.is_current) && <Button type="button" onClick={generate} loading={pending} disabled={!canGenerate || loadFailed || weatherBusy}>
          <Sparkles className="size-4" aria-hidden="true" />{pending ? "Building your itinerary..." : saved ? "Generate new version" : "Generate itinerary"}</Button>}
      </div>
      {loadFailed && <p role="alert" className="type-small mt-4 text-destructive">We couldn&apos;t load itinerary planning. Your trip is saved. Please try again later.</p>}
      {!canGenerate && !loadFailed && <p className="type-small mt-4 text-muted-foreground">AI planning supports confirmed trips of 1–14 days. <Link href={`/trips/${tripId}`} className="font-medium underline underline-offset-4">Discover places in Overview</Link> before generating.</p>}
      {pending && <p role="status" className="type-small mt-4 text-muted-foreground">Building your itinerary... Your previous version stays saved.</p>}
      {error && <div role="alert" className="type-small mt-4 text-destructive">{error} <Link href={`/trips/${tripId}/itinerary`} className="font-medium underline underline-offset-4">Check saved itinerary</Link></div>}
    </SurfaceCard>
    {saved && <>
      <WeatherWorkspace key={saved.id} tripId={tripId} itinerary={saved} compact planningPending={pending}
        onForecast={setWeather} onBusyChange={setWeatherBusy} onAdapted={next => {
          setSaved(next); setWeather(null);
          setVersions(previous => [{ id: next.id, version_number: next.version_number, created_at: next.created_at, is_current: next.is_current }, ...previous.filter(v => v.id !== next.id).map(v => ({ ...v, is_current: false }))].slice(0, 20));
        }} />
      <div className="flex flex-wrap items-center gap-3"><Badge><Sparkles className="mr-1 size-3.5" aria-hidden="true" />{saved.demo ? "Development fixture planner" : "AI-planned with NomivraAI"}</Badge>
        <span className="type-small text-muted-foreground">Version {saved.version_number}{saved.is_current ? " · Current" : " · Previous version"}</span>
        {saved.generation_reason === "weather_adaptation" && <span className="type-meta text-muted-foreground">Weather adaptation{saved.weather_fetched_at ? ` · Forecast fetched ${new Date(saved.weather_fetched_at).toLocaleDateString("en-US", { timeZone: "UTC" })}` : ""}</span>}
        {saved.generation_reason === "companion_edit" && <span className="type-meta text-muted-foreground">Companion edit</span>}
        {versions.map(v => <Link key={v.id} href={`/trips/${tripId}/itinerary${v.is_current ? "" : `?version=${v.id}`}`} aria-current={saved.id === v.id ? "page" : undefined}
          className="type-meta inline-flex min-h-11 items-center rounded-full border px-4 hover:bg-muted">Version {v.version_number}</Link>)}
      </div>
      {saved.stale && <p role="status" className="type-small rounded-2xl border bg-muted p-4">This version was made for earlier trip preferences. Generate a new version to use your current trip.</p>}
      {saved.itinerary.warnings.length > 0 && <SurfaceCard className="p-5"><h3 className="type-small font-semibold">Planning notes</h3><ul className="type-small mt-3 list-disc space-y-2 pl-5 text-muted-foreground">{saved.itinerary.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></SurfaceCard>}
      <SurfaceCard className="p-5"><h3 className="type-small font-semibold">Known budget</h3>
        <p className="type-small mt-2">Trip budget: {formatTripBudget(budget?.trip_budget ?? tripBudget, budget?.currency ?? currency)}</p>
        {budget?.known_accommodation_total !== null && budget?.known_accommodation_total !== undefined && <p className="type-small mt-1">Current accommodation quote: {formatTripBudget(budget.known_accommodation_total, budget.currency)} · Remaining before unpriced costs: {formatTripBudget(budget.remaining_known_budget!, budget.currency)}</p>}
        <p className="type-meta mt-2 text-muted-foreground">Attraction and meal prices are unknown. Hotel quotes expire and are not kept in itinerary versions. Remaining budget is unknown without a current matching-currency quote.</p>
      </SurfaceCard>
      <div className="space-y-6">{saved.itinerary.days.map(day => <SurfaceCard key={day.date} size="panel" className="p-5 sm:p-8">
        <div className="mb-6 flex items-start gap-3"><CalendarDays className="mt-1 size-5 text-muted-foreground" aria-hidden="true" /><div><h2 className="type-section">Day {day.day_number} — {day.theme}</h2><p className="type-small mt-1 text-muted-foreground">{dateLabel(day.date)}</p></div></div>
        <div className="mb-5"><WeatherDaySummary day={weather?.forecast.days.find(d => d.date === day.date)} availability={weather?.forecast.availability} /></div>
        <DayRouteSummary
  tripId={tripId}
  dayNumber={day.day_number}
/>
        <ol className="space-y-5 border-l pl-5 sm:pl-7">{day.items.map((item, i) => {
          const Icon = item.candidate_type === "food" ? Utensils : item.candidate_type === "hotel" ? BedDouble : MapPin;
          return <li key={`${i}-${item.candidate_id}`} className="relative rounded-2xl border bg-background p-4 sm:p-5">
            <span className="type-meta font-semibold uppercase tracking-wider text-muted-foreground">{item.period}</span>
            <h3 className="type-card mt-2 flex items-start gap-2"><Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{item.title}</h3>
            {item.category && <p className="type-meta mt-1 capitalize text-muted-foreground">{item.category.replaceAll("_", " ")}</p>}
            <p className="type-small mt-3 text-muted-foreground">{item.reason}</p>
            {item.notes && <p className="type-meta mt-2 text-muted-foreground">{item.notes}</p>}
            {item.opening_hours && <p className="type-meta mt-2 text-muted-foreground">Source opening-hours data: {item.opening_hours}</p>}
          </li>;
        })}</ol>
      </SurfaceCard>)}</div>
      <p className="type-meta text-muted-foreground">Planning by NomivraAI · Place facts: <a href="https://www.openstreetmap.org/copyright" className="underline underline-offset-4">© OpenStreetMap contributors · ODbL</a>. Saved food references from <a href="https://www.geoapify.com/" className="underline underline-offset-4">Geoapify</a>. Hotel references use your selected StayAPI accommodation.</p>
    </>}
  </div>;
}
