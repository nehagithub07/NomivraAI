import type { Metadata } from "next";
import Link from "next/link";
import { Luggage, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripCard } from "@/components/nomvira/trips/trip-card";
import { getTrips } from "@/lib/trips/queries";

export const metadata: Metadata = { title: "My Trips" };

export default async function TripsPage() {
  const trips = await getTrips();
  return (
    <>
      <PageHeader
        title="My Trips"
        description="Plan, manage, and revisit your journeys."
        actions={<Button asChild><Link href="/trips/new"><Plus aria-hidden="true" />New Trip</Link></Button>}
      />
      {trips.length ? (
        <ul aria-label="Your trips" className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {trips.map((trip) => <li key={trip.id} className="min-w-0"><TripCard trip={trip} /></li>)}
        </ul>
      ) : <EmptyState
        icon={Luggage}
        title="Your next adventure starts here."
        description="Create your first trip and NomviraAI will help you plan it."
        action={
          <Button asChild>
            <Link href="/trips/new">
              <Plus aria-hidden="true" />
              Plan a trip
            </Link>
          </Button>
        }
      />}
    </>
  );
}
