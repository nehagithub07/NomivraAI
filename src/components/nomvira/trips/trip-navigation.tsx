import Link from "next/link";

export function TripNavigation({ tripId, active }: { tripId: string; active: "overview" | "hotels" | "food" | "itinerary" | "budget" | "weather" | "companion" }) {
  return <nav aria-label="Trip navigation" className="mb-6 flex flex-wrap gap-x-6 border-b">
    {([{ key: "overview", label: "Overview", href: `/trips/${tripId}` }, { key: "hotels", label: "Hotels", href: `/trips/${tripId}/hotels` }, { key: "food", label: "Food", href: `/trips/${tripId}/food` }, { key: "itinerary", label: "Itinerary", href: `/trips/${tripId}/itinerary` }, { key: "budget", label: "Budget", href: `/trips/${tripId}/budget` }, { key: "weather", label: "Weather", href: `/trips/${tripId}/weather` }, { key: "companion", label: "Companion", href: `/trips/${tripId}/companion` }] as const).map(item => <Link key={item.key}
      href={item.href} aria-current={active === item.key ? "page" : undefined}
      className={`type-small -mb-px inline-flex min-h-12 items-center border-b-2 px-1 font-medium ${active === item.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item.label}</Link>)}
  </nav>;
}
