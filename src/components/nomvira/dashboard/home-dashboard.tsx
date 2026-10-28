import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/nomvira/empty-state";
import { SectionHeading } from "@/components/nomvira/section-heading";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { TripRow } from "@/lib/supabase/database.types";
import type { DashboardData } from "@/lib/mock/dashboard";
import { DestinationSearch } from "./destination-search";
import { UpcomingTripCard } from "./upcoming-trip-card";
import { RecommendedDestinations } from "./recommended-destinations";
import { NomviraInsightCard } from "./nomvira-insight-card";
import { RecentTrips } from "./recent-trips";

function DashboardGreeting({ firstName }: { firstName: string }) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="type-small text-muted-foreground">
          Welcome back, {firstName}
        </p>
        <Badge variant="outline" className="bg-transparent font-normal">
          Explore your next chapter
        </Badge>
      </div>
      <h1 className="type-page max-w-3xl text-[1.75rem] text-balance md:text-[2rem] xl:text-[2.5rem]">
        Where will Nomvira take you next?
      </h1>
    </div>
  );
}

export function DashboardEmptyState() {
  return (
    <EmptyState
      icon={Compass}
      title="Your next adventure starts here."
      description="Tell NomviraAI where you’d like to go, and make a little room for the journey ahead."
      action={
        <Button asChild>
          <Link href="/trips/new">
            Plan your first trip
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    />
  );
}

export function HomeDashboard({ data, upcomingTrip, upcomingError = false }: {
  data: DashboardData; upcomingTrip: TripRow | null; upcomingError?: boolean;
}) {
  return (
    <div className="min-w-0">
      <DashboardGreeting firstName={data.user.firstName} />
      <DestinationSearch />
      <div className="mt-10 space-y-10 md:mt-12 md:space-y-12">
        {upcomingError ? (
          <SurfaceCard className="p-6" role="alert">
            <p className="type-body">We couldn&apos;t load your upcoming trip. Please try again.</p>
            <Link href="/trips" className="type-small mt-3 inline-flex min-h-11 items-center gap-2 font-medium">Go to My Trips<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </SurfaceCard>
        ) : upcomingTrip ? (
          <section aria-labelledby="upcoming-trip-title">
            <SectionHeading
              id="upcoming-trip-title"
              title="Your upcoming trip"
              trailing={
                <Link
                  href="/trips"
                  className="type-small inline-flex min-h-11 items-center gap-2 font-medium"
                >
                  View all trips
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              }
            />
            <UpcomingTripCard trip={upcomingTrip} />
          </section>
        ) : (
          <DashboardEmptyState />
        )}
        <RecommendedDestinations destinations={data.recommendations} />
        <div className="grid gap-8 xl:grid-cols-[0.95fr_1.05fr] xl:gap-6">
          <NomviraInsightCard insight={data.insight} />
          <RecentTrips trips={data.recentTrips} />
        </div>
      </div>
      <p className="type-meta mt-8 text-muted-foreground">
        Your upcoming trip uses your saved details. Recommendations, insights,
        and recent trip examples are sample content.
      </p>
    </div>
  );
}
