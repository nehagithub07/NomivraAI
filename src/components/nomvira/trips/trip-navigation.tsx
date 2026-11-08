
import Link from "next/link";

export function TripNavigation({
  tripId,
  active,
}: {
  tripId: string;
  active:
    | "overview"
    | "hotels"
    | "food"
    | "itinerary"
    | "budget"
    | "weather"
    | "companion"
    | "export"
    | "map";
}) {
  return (
    <nav aria-label="Trip navigation" tabIndex={0} className="export-controls mb-6 flex gap-x-5 overflow-x-auto border-b sm:gap-x-6">
      {(
        [
          { key: "overview", label: "Overview", href: `/trips/${tripId}` },
          { key: "hotels", label: "Hotels", href: `/trips/${tripId}/hotels` },
          { key: "food", label: "Food", href: `/trips/${tripId}/food` },
          { key: "itinerary", label: "Itinerary", href: `/trips/${tripId}/itinerary` },
          { key: "budget", label: "Budget", href: `/trips/${tripId}/budget` },
          { key: "weather", label: "Weather", href: `/trips/${tripId}/weather` },
          { key: "companion", label: "Companion", href: `/trips/${tripId}/companion` },
          { key: "map", label: "Map", href: `/trips/${tripId}/map` },
          { key: "export", label: "Export & Share", href: `/trips/${tripId}/export` },
        ] as const
      ).map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={`type-small -mb-px inline-flex min-h-12 shrink-0 items-center whitespace-nowrap border-b-2 px-1 font-medium focus-visible:outline-offset-[-4px] ${
            active === item.key
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
