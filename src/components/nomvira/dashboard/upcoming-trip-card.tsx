import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { TripRow } from "@/lib/supabase/database.types";
import { durationLabel, tripDuration, travelersLabel } from "@/lib/trips/dates";
import { optionLabel } from "@/lib/trips/options";
import { formatTripBudget, formatTripDates } from "@/lib/travel-format";

export function UpcomingTripCard({ trip }: { trip: TripRow }) {
  return (
    <SurfaceCard size="panel" className="min-w-0 p-5 sm:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="type-meta font-medium tracking-[0.12em] text-muted-foreground uppercase">Next on your horizon</p>
        <Badge>{optionLabel(trip.status)}</Badge>
      </div>
      <h3 className="type-section flex items-start gap-3 text-[1.75rem] wrap-anywhere sm:text-[2rem]">
        <MapPin className="mt-1 size-6 text-accent-foreground" aria-hidden="true" />{trip.destination_name}
      </h3>
      <div className="type-small mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-muted-foreground">
        <span className="inline-flex items-start gap-2"><CalendarDays className="mt-0.5 size-4" aria-hidden="true" />{formatTripDates(trip.start_date, trip.end_date)} · {durationLabel(tripDuration(trip.start_date, trip.end_date))}</span>
        <span className="inline-flex items-center gap-2"><Users className="size-4" aria-hidden="true" />{travelersLabel(trip.travelers_count)}</span>
      </div>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5 border-t pt-5">
        <div className="min-w-0">
          <p className="type-meta flex items-center gap-2 text-muted-foreground"><Wallet className="size-4" aria-hidden="true" />Total trip budget</p>
          <p className="type-card mt-2 wrap-anywhere">{formatTripBudget(trip.budget_total, trip.currency)}</p>
          <p className="type-small mt-1 text-muted-foreground">{optionLabel(trip.budget_style)} budget · {optionLabel(trip.travel_pace)} pace</p>
        </div>
        <Button asChild className="w-full sm:w-auto"><Link href={`/trips/${trip.id}`}>View trip<ArrowRight aria-hidden="true" /></Link></Button>
      </div>
    </SurfaceCard>
  );
}
