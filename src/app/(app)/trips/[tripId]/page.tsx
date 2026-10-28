import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { TripSummary } from "@/components/nomvira/trips/trip-summary";
import { getTrip } from "@/lib/trips/queries";
import { durationLabel, tripDuration, travelersLabel } from "@/lib/trips/dates";
import { optionLabel } from "@/lib/trips/options";
import { formatTripDates } from "@/lib/travel-format";

type TripPageProps = { params: Promise<{ tripId: string }> };

export async function generateMetadata({
  params,
}: TripPageProps): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip ? `${trip.destination_name} trip` : "Trip not found" };
}

export default async function TripOverviewPage({ params }: TripPageProps) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  return (
    <>
      <Link href="/trips" className="type-small mb-5 inline-flex min-h-11 items-center gap-2 font-medium"><ArrowLeft className="size-4" aria-hidden="true" />Back to My Trips</Link>
      <PageHeader title={trip.destination_name}
        description={`${formatTripDates(trip.start_date, trip.end_date)} · ${durationLabel(tripDuration(trip.start_date, trip.end_date))} · ${travelersLabel(trip.travelers_count)}`}
        actions={<Badge>{optionLabel(trip.status)}</Badge>} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SurfaceCard size="panel" className="min-w-0 p-5 sm:p-8">
          <h2 className="type-section mb-6">Your trip at a glance</h2>
          <TripSummary values={{
            destination: trip.destination_name, startDate: trip.start_date, endDate: trip.end_date,
            travelers: trip.travelers_count, budget: String(trip.budget_total), currency: trip.currency,
            budgetStyle: trip.budget_style, interests: trip.trip_interests.map(({ interest }) => interest),
            travelPace: trip.travel_pace, accommodationPreferences: trip.accommodation_preferences,
            dietaryPreferences: trip.dietary_preferences, specialRequests: trip.special_requests || "",
          }} />
        </SurfaceCard>
        <EmptyState icon={Route} title="Your itinerary hasn't been generated yet."
          description="NomviraAI will use your trip preferences, real travel data, and AI planning to build your personalized itinerary."
          action={<div><Button disabled>Generate itinerary</Button><p className="type-meta mt-3 text-muted-foreground">Coming in the next step</p></div>} />
      </div>
    </>
  );
}
