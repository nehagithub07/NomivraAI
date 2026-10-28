import Link from "next/link";

export function TripNavigation({ tripId, active }: { tripId: string; active: "overview" | "hotels" }) {
  return <nav aria-label="Trip navigation" className="mb-6 flex gap-6 border-b">
    {([{ key: "overview", label: "Overview", href: `/trips/${tripId}` }, { key: "hotels", label: "Hotels", href: `/trips/${tripId}/hotels` }] as const).map(item => <Link key={item.key}
      href={item.href} aria-current={active === item.key ? "page" : undefined}
      className={`type-small -mb-px inline-flex min-h-12 items-center border-b-2 px-1 font-medium ${active === item.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item.label}</Link>)}
  </nav>;
}
