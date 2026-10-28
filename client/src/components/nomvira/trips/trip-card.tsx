import Link from "next/link";
import { ArrowUpRight, CalendarDays, MapPin, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { TripRow } from "@/lib/supabase/database.types";
import { durationLabel, travelersLabel, tripDuration } from "@/lib/trips/dates";
import { optionLabel } from "@/lib/trips/options";
import { formatTripBudget, formatTripDates } from "@/lib/travel-format";

export function TripCard({ trip }: { trip: TripRow }) {
  return (
    <SurfaceCard variant="interactive" className="h-full">
      <Link href={`/trips/${trip.id}`} className="block h-full min-w-0 rounded-xl p-5 focus-visible:outline-offset-[-3px] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent"><MapPin className="size-5 text-accent-foreground" aria-hidden="true" /></span>
          <Badge variant="outline">{optionLabel(trip.status)}</Badge>
        </div>
        <h2 className="type-card mt-5 flex items-start justify-between gap-2 wrap-anywhere">{trip.destination_name}<ArrowUpRight className="mt-1 size-4 text-muted-foreground" aria-hidden="true" /></h2>
        <p className="type-small mt-3 flex items-start gap-2 text-muted-foreground"><CalendarDays className="mt-0.5 size-4" aria-hidden="true" />{formatTripDates(trip.start_date, trip.end_date)}</p>
        <p className="type-small mt-2 flex items-center gap-2 text-muted-foreground"><Users className="size-4" aria-hidden="true" />{durationLabel(tripDuration(trip.start_date, trip.end_date))} · {travelersLabel(trip.travelers_count)}</p>
        <p className="type-small mt-5 flex flex-wrap items-center gap-2 border-t pt-4 font-medium wrap-anywhere"><Wallet className="size-4 text-muted-foreground" aria-hidden="true" />{formatTripBudget(trip.budget_total, trip.currency)}</p>
      </Link>
    </SurfaceCard>
  );
}
