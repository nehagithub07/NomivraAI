import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripNavigation } from "@/components/nomvira/trips/trip-navigation";
import { CompanionWorkspace } from "@/components/nomvira/companion/companion-workspace";
import { getTrip } from "@/lib/trips/queries";

type Props = { params: Promise<{ tripId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip ? `Companion · ${trip.destination_name}` : "Trip not found" };
}
export default async function CompanionPage({ params }: Props) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  return <><PageHeader title="AI Travel Companion" description={`Practical guidance for your ${trip.destination_name} trip.`} />
    <TripNavigation tripId={trip.id} active="companion" /><CompanionWorkspace tripId={trip.id} destination={trip.destination_name} />
  </>;
}
