import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripNavigation } from "@/components/nomvira/trips/trip-navigation";
import { ItineraryWorkspace } from "@/components/nomvira/itineraries/itinerary-workspace";
import { getTrip } from "@/lib/trips/queries";
import { createClient } from "@/lib/supabase/server";
import { getItinerary, getItineraryVersions } from "@/lib/itineraries/server";
import { getPersistedPlaces } from "@/lib/destinations/persistence";
import type { SavedItinerary, ItineraryVersionSummary } from "@/lib/itineraries/validation";

type Props = { params: Promise<{ tripId: string }>; searchParams: Promise<{ version?: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip ? `Itinerary for ${trip.destination_name}` : "Trip not found" };
}
export default async function ItineraryPage({ params, searchParams }: Props) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  const { version } = await searchParams;
  if (version && !z.uuid().safeParse(version).success) notFound();
  const db = await createClient();
  let itinerary: SavedItinerary | null = null, versions: ItineraryVersionSummary[] = [], loadFailed = false, canGenerate = false;
  try {
    const [saved, history, places] = await Promise.all([getItinerary(db, trip, version), getItineraryVersions(db, trip.id), getPersistedPlaces(db, trip.id)]);
    itinerary = saved; versions = history;
    const days = Math.round((Date.parse(trip.end_date) - Date.parse(trip.start_date)) / 86400000) + 1;
    canGenerate = places.length > 0 && trip.destination_provider === "open_meteo" && Boolean(trip.destination_provider_id) && trip.destination_latitude !== null && trip.destination_longitude !== null && days >= 1 && days <= 14;
  } catch { loadFailed = true; }
  if (version && !itinerary && !loadFailed) notFound();
  return <><PageHeader title={`Itinerary for ${trip.destination_name}`} description="A personalized plan built from your preferences and real saved places." />
    <TripNavigation tripId={trip.id} active="itinerary" />
    <ItineraryWorkspace key={itinerary?.id ?? "new"} tripId={trip.id} initialItinerary={itinerary} versions={versions}
      canGenerate={canGenerate} loadFailed={loadFailed} tripBudget={trip.budget_total} currency={trip.currency} />
  </>;
}
