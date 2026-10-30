import type { Metadata } from "next";
import Link from "next/link";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { getTrips } from "@/lib/trips/queries";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "AI Companion" };

export default async function CompanionPage() {
  const trips = await getTrips();
  return (
    <>
      <PageHeader
        title="AI Companion"
        description="A thoughtful travel companion, wherever you’re headed."
      />
      <div className="grid gap-4 sm:grid-cols-2">{trips.map(trip => <SurfaceCard key={trip.id} className="p-6"><h2 className="type-card">{trip.destination_name}</h2><p className="type-small mt-2 text-muted-foreground">{trip.start_date} – {trip.end_date}</p><Link className="type-small mt-4 inline-flex min-h-11 items-center font-medium underline underline-offset-4" href={`/trips/${trip.id}/companion`}>Open trip companion</Link></SurfaceCard>)}</div>
      {!trips.length && <SurfaceCard className="p-6"><p>Create a trip to start planning with your companion.</p><Link href="/trips/new" className="mt-4 inline-block underline underline-offset-4">Create a trip</Link></SurfaceCard>}
    </>
  );
}
