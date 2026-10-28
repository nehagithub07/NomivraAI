import Link from "next/link";
import { ArrowRight, ArrowUpRight, Luggage } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/nomvira/section-heading";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { RecentTrip } from "@/lib/mock/dashboard";
import { formatTripDates } from "@/lib/travel-format";

export function RecentTripCard({ trip }: { trip: RecentTrip }) {
  return (
    <SurfaceCard variant="interactive">
      <Link
        href={`/trips/${trip.id}`}
        aria-label={`Revisit ${trip.destination}, ${trip.country}`}
        className="flex min-w-0 items-center gap-4 rounded-xl p-4 focus-visible:outline-offset-[-3px]"
      >
        <span className="hidden size-14 shrink-0 items-center justify-center rounded-lg bg-muted sm:flex">
          <Luggage
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="type-card text-base">
            {trip.destination}
            <span className="font-normal text-muted-foreground">
              , {trip.country}
            </span>
          </h3>
          <p className="type-meta mt-1 text-muted-foreground">
            {formatTripDates(trip.startDate, trip.endDate)}
            <span aria-hidden="true"> · </span>
            {trip.days} days
          </p>
          <Badge
            variant="outline"
            className="mt-2 min-h-6 px-2 py-1 text-[0.6875rem]"
          >
            {trip.status}
          </Badge>
        </div>
        <ArrowUpRight
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </SurfaceCard>
  );
}

export function RecentTrips({ trips }: { trips: RecentTrip[] }) {
  return (
    <section aria-labelledby="recent-trips-title" className="min-w-0">
      <SectionHeading
        id="recent-trips-title"
        title="Recent trips"
        trailing={
          <Link
            href="/trips"
            className="type-small inline-flex min-h-11 items-center gap-2 font-medium"
          >
            View all
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />
      {trips.length > 0 ? (
        <ul className="space-y-3">
          {trips.map((trip) => (
            <li key={trip.id}>
              <RecentTripCard trip={trip} />
            </li>
          ))}
        </ul>
      ) : (
        <SurfaceCard variant="muted" className="p-6">
          <Luggage
            className="mb-3 size-5 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="type-card">The memories are still ahead.</h3>
          <p className="type-small mt-2 text-muted-foreground">
            Your completed journeys will have a home here.
          </p>
        </SurfaceCard>
      )}
    </section>
  );
}
