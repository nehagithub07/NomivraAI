import Link from "next/link";
import { useEffect, useState } from "react";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { Button } from "@/components/ui/button";
import type { CompanionCard, PublicAction } from "@/lib/companion/validation";

const text = (value: unknown, fallback = "Unknown") => typeof value === "string" || typeof value === "number" ? String(value) : fallback;
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [];
const strings = (value: unknown) => Array.isArray(value) ? value.filter(v => typeof v === "string").join(", ") : "";
function money(amount: unknown, currency: unknown) {
  if ((typeof amount !== "string" && typeof amount !== "number") || !Number.isFinite(Number(amount))) return "Unknown";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: text(currency, "USD") }).format(Number(amount)); }
  catch { return `${text(currency)} ${amount}`; }
}
export function CompanionResultCard({ card, tripId }: { card: CompanionCard; tripId: string }) {
  const d = card.data;
  let body: React.ReactNode;
  switch (card.tool_name) {
    case "get_budget_summary": body = <><p className="type-meta text-muted-foreground">Remaining budget · {text(d.status).replaceAll("_", " ")}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{money(d.remaining_budget, d.currency)}</p><p className="type-small mt-2 text-muted-foreground">Committed {money(d.committed_costs, d.currency)} of {money(d.total_budget, d.currency)}. Unknown costs are excluded.</p><Link href={`/trips/${tripId}/budget`} className="type-small mt-3 inline-block underline underline-offset-4">Review budget</Link></>; break;
    case "get_selected_hotel": body = <><p className="type-meta text-muted-foreground">Selected stay</p><p className="type-card mt-2">{d.selected ? text(d.name, "Saved stay · details expired") : "No stay selected"}</p>{d.guest_rating != null && <p className="type-small mt-2">Guest rating {text(d.guest_rating)} / {text(d.guest_rating_scale)}</p>}{d.total_price != null && <p className="type-small mt-2">Quoted total {money(d.total_price, d.currency)} · may exclude local charges</p>}<p className="type-meta mt-2 text-muted-foreground">A saved preference does not confirm a booking.</p></>; break;
    case "get_itinerary": body = <><p className="type-meta text-muted-foreground">{d.available ? `Itinerary version ${text(d.version)}` : "No itinerary saved"}{d.stale ? " · Trip details have changed" : ""}</p><div className="mt-3 space-y-4">{records(d.days).map(day => <div key={text(day.date)}><p className="type-small font-semibold">Day {text(day.day_number)} · {text(day.date)}</p><ul className="type-small mt-2 space-y-1 text-muted-foreground">{records(day.items).map((item, index) => <li key={index}><span className="capitalize">{text(item.period)}</span> · {text(item.title)}</li>)}</ul></div>)}</div></>; break;
    case "get_weather": body = <><p className="type-meta text-muted-foreground">Forecast · {text(d.availability).replaceAll("_", " ")}</p>{!records(d.days).length && <p className="type-small mt-2 text-muted-foreground">No current forecast is loaded for that date. Open Weather to load available forecasts.</p>}<div className="mt-3 space-y-3">{records(d.days).map(day => <div key={text(day.date)}><p className="type-small font-semibold">{text(day.date)} · {text(day.condition)}</p><p className="type-small mt-1 text-muted-foreground">{text(day.temperature_max_c)}°C / {text(day.temperature_min_c)}°C · {day.precipitation_probability_max == null ? "Rain chance unknown" : `Rain ${text(day.precipitation_probability_max)}%`}</p></div>)}</div>{records(d.conflicts).map((c, i) => <p key={i} className="type-small mt-3">{text(c.date)} · {text(c.title)}: {text(c.message)}</p>)}<p className="type-meta mt-3 text-muted-foreground">{d.fetched_at ? `Fetched ${text(d.fetched_at)} · ` : ""}<a className="underline" href="https://open-meteo.com/">Open-Meteo</a> · <a className="underline" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Conditions may change.</p><Link href={`/trips/${tripId}/weather`} className="type-small mt-3 inline-block underline underline-offset-4">Review weather</Link></>; break;
    case "get_trip_overview": body = <><p className="type-card">{text(d.destination)}{d.country ? `, ${text(d.country)}` : ""}</p><p className="type-small mt-2 text-muted-foreground">{text(d.start_date)} – {text(d.end_date)} · {text(d.travelers)} travelers</p></>; break;
    case "get_trip_preferences": body = <><p className="type-small">{text(d.travel_pace)} pace · {text(d.budget_style)} budget</p><p className="type-small mt-2 text-muted-foreground">Interests: {strings(d.interests) || "None saved"}</p><p className="type-small mt-2 text-muted-foreground">Dietary preferences: {strings(d.dietary_preferences) || "None saved"}</p></>; break;
    default: body = <><p className="type-meta text-muted-foreground">{card.tool_name === "get_saved_food" ? "Saved food spots" : "Existing recommendations"}</p><ul className="mt-3 space-y-3">{records(d.options).map((option, i) => <li key={i}><p className="type-small font-semibold">{text(option.name)}</p><p className="type-meta mt-1 text-muted-foreground">{[option.category, strings(option.dietary_tags), option.total_price != null ? money(option.total_price, option.currency) : null].filter(Boolean).join(" · ")}</p></li>)}</ul>{!records(d.options).length && <p className="type-small mt-2">No matching current options. Use the trip tabs to discover or refresh recommendations.</p>}{d.source != null && <p className="type-meta mt-3 text-muted-foreground">Source: {text(d.source)}</p>}{d.notice != null && <p className="type-meta mt-2 text-muted-foreground">{text(d.notice)}</p>}</>;
  }
  return <SurfaceCard variant="muted" className="p-4 sm:p-5">{body}</SurfaceCard>;
}
export function CompanionConfirmation({ action, busy, onAction }: { action: PublicAction; busy: boolean; onAction: (id: string, operation: "confirm" | "cancel") => void }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(action.expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [action.expires_at]);
  const status = expired && action.status === "pending" ? "expired" : action.status;
  return <SurfaceCard className="border-primary/20 p-5" aria-label="Proposed trip change"><p className="type-card">{text(action.preview.title, "Review proposed change")}</p>
    {action.preview.current != null && <p className="type-small mt-3 text-muted-foreground">Current: {text(action.preview.current)}</p>}
    {action.preview.proposed != null && <p className="type-small mt-2">Proposed: {text(action.preview.proposed)}</p>}
    <p className="type-meta mt-3 text-muted-foreground">{text(action.preview.detail, "Review before confirming.")}</p>
    {status === "pending" ? <><p className="type-meta mt-2 text-muted-foreground">Confirmation expires in five minutes.</p><div className="mt-4 flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={busy} onClick={() => onAction(action.id, "cancel")}>Cancel</Button><Button type="button" disabled={busy || action.preview.confirmable === false} onClick={() => onAction(action.id, "confirm")}>Confirm change</Button></div></> : <p role="status" className="type-small mt-4 font-medium">{action.result?.message ? text(action.result.message) : ({ confirmed: "Confirmation received. Reload the relevant trip tab to check progress. This action will not run twice.", executed: "Change saved.", cancelled: "Cancelled. No change was made.", expired: "This proposal expired. Ask for the change again.", failed: "The result could not be confirmed. Review your trip before trying again." })[status]}</p>}
  </SurfaceCard>;
}
