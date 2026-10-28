import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CloudSun,
  MapPin,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { UpcomingTrip } from "@/lib/mock/dashboard";
import { formatTravelCurrency, formatTripDates } from "@/lib/travel-format";

export function UpcomingTripCard({ trip }: { trip: UpcomingTrip }) {
  const remaining = trip.totalBudget - trip.budgetUsed;
  const progress =
    trip.totalBudget > 0
      ? Math.min(100, Math.max(0, (trip.budgetUsed / trip.totalBudget) * 100))
      : 0;
  const amount = (value: number) => formatTravelCurrency(value, trip.currency);

  return (
    <SurfaceCard
      size="panel"
      className="grid overflow-hidden xl:grid-cols-[3fr_2fr]"
    >
      <div className="min-w-0 p-5 sm:p-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="type-meta font-medium tracking-[0.12em] text-muted-foreground uppercase">
            Next on your horizon
          </p>
          <Badge>{trip.status}</Badge>
        </div>
        <h3 className="type-section text-[1.75rem] sm:text-[2rem]">
          {trip.destination}
          <span className="font-normal text-muted-foreground">
            , {trip.country}
          </span>
        </h3>
        <div className="type-small mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="size-4" aria-hidden="true" />
            <span>
              {formatTripDates(trip.startDate, trip.endDate)}
              <span aria-hidden="true"> · </span>
              {trip.days} days
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            <Users className="size-4" aria-hidden="true" />
            {trip.travelers} travelers
          </span>
        </div>
        <dl className="mt-6 grid grid-cols-3 gap-3 border-t pt-6 sm:gap-6">
          <div className="min-w-0">
            <dt className="type-meta flex items-center gap-1.5 text-muted-foreground">
              <Wallet
                className="hidden size-3.5 min-[400px]:block"
                aria-hidden="true"
              />
              Budget {remaining >= 0 ? "left" : "over"}
            </dt>
            <dd className="mt-2">
              <span className="type-card block text-xl tabular-nums">
                {amount(Math.abs(remaining))}
              </span>
              <span className="type-meta mt-1 block text-muted-foreground">
                {amount(trip.budgetUsed)} of {amount(trip.totalBudget)}
              </span>
              <div
                role="progressbar"
                aria-label={`Trip budget in ${trip.currency}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                aria-valuetext={`${amount(trip.budgetUsed)} of ${amount(trip.totalBudget)} planned; ${amount(Math.abs(remaining))} ${remaining >= 0 ? "remaining" : "over budget"}`}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-nomvira-orange"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="type-meta flex items-center gap-1.5 text-muted-foreground">
              <CloudSun
                className="hidden size-3.5 min-[400px]:block"
                aria-hidden="true"
              />
              Weather
            </dt>
            <dd className="mt-2">
              <span className="type-card block text-xl tabular-nums">
                {trip.weatherTemperature}°C
              </span>
              <span className="type-meta mt-1 block text-muted-foreground">
                {trip.weatherCondition}
              </span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="type-meta flex items-center gap-1.5 text-muted-foreground">
              <MapPin
                className="hidden size-3.5 min-[400px]:block"
                aria-hidden="true"
              />
              Your plans
            </dt>
            <dd className="mt-2">
              <span className="type-card block text-xl tabular-nums">
                {trip.activitiesPlanned}
              </span>
              <span className="type-meta mt-1 block text-muted-foreground">
                Activities planned
              </span>
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <span className="type-meta text-muted-foreground">
            A little planning. A lot to look forward to.
          </span>
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/trips/${trip.id}`}>
              Continue planning
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
      <div className="relative order-first h-40 overflow-hidden bg-surface-secondary sm:h-52 xl:order-last xl:h-auto xl:min-h-96">
        <Image
          src={trip.visual.src}
          alt={trip.visual.alt}
          fill
          sizes="(min-width: 1280px) 40vw, 100vw"
          className="object-cover"
          preload
        />
        <div className="absolute right-4 bottom-4 flex items-center gap-2 rounded-md border border-card/60 bg-card/95 px-3 py-2">
          <MapPin
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="type-meta">Somewhere worth the journey</span>
        </div>
      </div>
    </SurfaceCard>
  );
}
