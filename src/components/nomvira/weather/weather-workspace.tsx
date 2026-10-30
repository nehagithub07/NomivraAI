"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cloud, CloudFog, CloudLightning, CloudOff, CloudRain, CloudSun, Snowflake, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { savedItinerarySchema, type SavedItinerary } from "@/lib/itineraries/validation";
import { weatherErrorMessage, weatherReportSchema, type WeatherDay, type WeatherReport } from "@/lib/weather/validation";

const icons = { sun: Sun, cloud_sun: CloudSun, cloud: Cloud, fog: CloudFog, rain: CloudRain, snow: Snowflake, storm: CloudLightning, unknown: CloudOff };
const temp = (value: number | null) => value === null ? "Unknown" : `${Math.round(value)}°C`;
const availabilityText = {
  not_yet_available: "Forecast not available yet. Your trip is too far away for a daily forecast. Check again closer to departure.",
  past_trip: "This trip has ended. Historical weather and weather adaptation are not available.",
  unavailable: "No current forecast is loaded. Load a forecast when your trip is within the supported window.",
  partially_available: "Only part of your trip has forecast coverage. Uncovered dates are not estimated.",
  available: "Forecast available for your trip. Conditions may change.",
};

export function WeatherDaySummary({ day, availability }: { day?: WeatherDay; availability?: string }) {
  if (!day) return <p className="type-meta mt-3 text-muted-foreground">{availability === "not_yet_available" ? "Forecast not available yet" : availability === "past_trip" ? "Live forecast is unavailable for this past date" : "Forecast unavailable for this date"}</p>;
  const Icon = icons[day.icon as keyof typeof icons] ?? CloudOff;
  return <div className="type-small mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground"><Icon className="size-4" aria-hidden="true" /><span>{temp(day.temperature_max_c)} / {temp(day.temperature_min_c)}</span><span>{day.condition}</span><span>{day.precipitation_probability_max === null ? "Rain probability unknown" : `Rain ${day.precipitation_probability_max}%`}</span></div>;
}

export function WeatherWorkspace({ tripId, itinerary, compact = false, planningPending = false, onForecast, onAdapted, onBusyChange }: {
  tripId: string; itinerary?: SavedItinerary; compact?: boolean; planningPending?: boolean;
  onForecast?: (report: WeatherReport | null) => void; onAdapted?: (itinerary: SavedItinerary) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [report, setReport] = useState<WeatherReport | null>(null), [loading, setLoading] = useState(true);
  const [adapting, setAdapting] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const active = useRef(false), requestId = useRef<string | null>(null);
  const versionId = itinerary?.id;
  useEffect(() => {
    const controller = new AbortController();
    async function loadCache() {
      try {
        const response = await fetch(`/api/trips/${tripId}/weather${versionId ? `?version_id=${versionId}` : ""}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const body = await response.json().catch(() => null);
        if (!response.ok) { if (!controller.signal.aborted) setError(weatherErrorMessage(body?.error?.code)); return; }
        const next = weatherReportSchema.parse(body);
        if (!controller.signal.aborted) { setReport(next); onForecast?.(next); }
      } catch { if (!controller.signal.aborted) setError(weatherErrorMessage(null)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void loadCache();
    return () => controller.abort();
  }, [tripId, versionId, onForecast]);

  async function refresh() {
    if (active.current || loading || adapting) return;
    active.current = true; setLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/trips/${tripId}/weather/refresh`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(versionId ? { version_id: versionId } : {}), signal: AbortSignal.timeout(20_000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(weatherErrorMessage(body?.error?.code)); return; }
      const next = weatherReportSchema.parse(body); setReport(next); onForecast?.(next);
    } catch { setError(weatherErrorMessage(null)); }
    finally { active.current = false; setLoading(false); }
  }
  async function adapt() {
    if (active.current || loading || planningPending || !itinerary?.is_current || itinerary.stale || !report?.conflicts.length || report.analyzed_version_id !== itinerary.id) return;
    active.current = true; setAdapting(true); onBusyChange?.(true); setError(""); setNotice("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/trips/${tripId}/itinerary/adapt-weather`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId.current, expected_version_id: itinerary.id }), signal: AbortSignal.timeout(110_000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error?.code; setError(weatherErrorMessage(code));
        if (!["ITINERARY_PERSISTENCE_UNAVAILABLE", "ITINERARY_IN_PROGRESS"].includes(code)) requestId.current = null;
        return;
      }
      const saved = savedItinerarySchema.parse(body.itinerary);
      if (body.changed === true) onAdapted?.(saved);
      else setNotice("No suitable improvement is needed or available. Your saved itinerary is unchanged. Review any remaining weather conflicts before visiting.");
      requestId.current = null;
    } catch { setError(weatherErrorMessage("ITINERARY_PERSISTENCE_UNAVAILABLE")); }
    finally { active.current = false; setAdapting(false); onBusyChange?.(false); }
  }
  const forecast = report?.forecast;
  const conflicts = report?.analyzed_version_id === versionId || !versionId ? report?.conflicts ?? [] : [];
  return <section aria-label="Trip weather" className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
    <SurfaceCard className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><h2 className="type-card">{compact ? "Weather and your plan" : "Trip forecast"}</h2>
      <p className="type-small mt-2 text-muted-foreground">{forecast ? availabilityText[forecast.availability] : "Weather is optional. Your saved trip and itinerary stay available."}</p></div>
      <div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" onClick={refresh} loading={loading} disabled={adapting || forecast?.availability === "past_trip"}>{loading ? "Checking forecast..." : forecast?.fetched_at ? "Refresh forecast" : "Load forecast"}</Button>
        {compact && itinerary?.is_current && !itinerary.stale && <Button type="button" onClick={adapt} loading={adapting} disabled={loading || planningPending || !conflicts.length || report?.analyzed_version_id !== versionId}>{adapting ? "Adapting itinerary..." : "Adapt itinerary"}</Button>}
      </div></div>
      {forecast?.fetched_at && <p className="type-meta mt-3 text-muted-foreground">Forecast fetched {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: forecast.timezone }).format(new Date(forecast.fetched_at))} ({forecast.timezone}){forecast.cached ? " · Cached forecast" : ""}</p>}
      {loading && <p role="status" className="type-small mt-3 text-muted-foreground">Checking cached weather. This does not change your itinerary.</p>}
      {adapting && <p role="status" className="type-small mt-3 text-muted-foreground">Adapting the plan using verified forecasts. Your previous version stays saved.</p>}
      {error && <p role="alert" className="type-small mt-4 text-destructive">{error}</p>}
      {notice && <p role="status" className="type-small mt-4">{notice}</p>}
      {!!conflicts.length && <div className="mt-5 rounded-xl border bg-muted p-4"><h3 className="type-small font-semibold">Weather may affect {conflicts.length} {conflicts.length === 1 ? "activity" : "activities"}</h3>
        <ul className="type-small mt-3 space-y-2 text-muted-foreground">{conflicts.map(item => <li key={item.itinerary_item_id}>{item.date} · {item.period} · {item.title}: {item.message}</li>)}</ul>
        <p className="type-meta mt-3 text-muted-foreground">Adaptation makes the smallest validated change and saves a new version. Budget expenses stay unchanged.</p>
        {!compact && <Link href={`/trips/${tripId}/itinerary`} className="type-small mt-3 inline-flex min-h-11 items-center font-medium underline underline-offset-4">Review itinerary and adapt</Link>}
      </div>}
      {forecast?.days.length && !conflicts.length && report?.analyzed_version_id ? <p className="type-small mt-4 text-muted-foreground">No forecast-covered outdoor conflicts detected. Unknown venue exposure or missing weather may still affect plans.</p> : null}
      {forecast?.availability === "not_yet_available" && compact && <p className="type-meta mt-3 text-muted-foreground">Weather adaptation becomes available when the forecast enters the supported window.</p>}
      {!!forecast?.uncovered_ranges.length && <ul className="type-meta mt-4 space-y-1 text-muted-foreground">{forecast.uncovered_ranges.map((gap, i) => <li key={i}>{gap.start_date} – {gap.end_date}: {gap.reason === "past" ? "Past dates are not forecast" : gap.reason === "outside_forecast_window" ? "Outside the forecast window" : "Forecast data unavailable"}</li>)}</ul>}
    </SurfaceCard>
    {!compact && <div className="grid gap-4 lg:grid-cols-2">{forecast?.days.map(day => <SurfaceCard key={day.date} className="p-5"><h2 className="type-card">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</h2><WeatherDaySummary day={day} />
      <details className="mt-4 border-t pt-4"><summary className="type-small cursor-pointer font-medium">Morning, afternoon and evening</summary><div className="mt-4 space-y-4">{day.periods.map(p => <div key={p.period}><h3 className="type-small font-medium capitalize">{p.period}</h3><p className="type-small mt-1 text-muted-foreground">{p.condition} · {temp(p.temperature_c)} · {p.precipitation_probability === null ? "Rain chance unknown" : `Rain ${p.precipitation_probability}%`}{p.wind_speed_kmh === null ? "" : ` · Wind ${Math.round(p.wind_speed_kmh)} km/h`}</p><p className="type-meta mt-1 text-muted-foreground">{({ low: "Lower outdoor disruption", moderate: "Some outdoor disruption", high: "Higher outdoor disruption", unknown: "Limited weather data" })[p.risk.level]}</p></div>)}</div></details>
    </SurfaceCard>)}</div>}
    <p className="type-meta text-muted-foreground">Weather data by <a href="https://open-meteo.com/" className="underline underline-offset-4">Open-Meteo</a>, <a href="https://creativecommons.org/licenses/by/4.0/" className="underline underline-offset-4">CC BY 4.0</a>. Travel-disruption guidance is not an official warning. Follow local authorities for severe-weather information.</p>
  </section>;
}
