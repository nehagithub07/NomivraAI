import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripNavigation } from "@/components/nomvira/trips/trip-navigation";
import { HotelsWorkspace } from "@/components/nomvira/hotels/hotels-workspace";
import { getTrip } from "@/lib/trips/queries";
import { formatTripDates } from "@/lib/travel-format";
import { travelersLabel } from "@/lib/trips/dates";
import { accommodationContext, hotelNights, roomsForTravelers } from "@/lib/accommodations/context";
import { getCachedHotels, getStaySelection, validateHotelTrip } from "@/lib/accommodations/server";
import { createClient } from "@/lib/supabase/server";
import type { StaySelection } from "@/lib/accommodations/validation";

type Props = { params: Promise<{ tripId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip ? `Hotels in ${trip.destination_name}` : "Trip not found" };
}
export default async function HotelsPage({ params }: Props) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  let selection: StaySelection | null = null, selectionLoadFailed = false, canSearch = true;
  try { selection = await getStaySelection(await createClient(), trip.id); } catch { selectionLoadFailed = true; }
  try { validateHotelTrip(trip); } catch { canSearch = false; }
  const nights = hotelNights(trip.start_date, trip.end_date), rooms = roomsForTravelers(trip.travelers_count);
  return <><PageHeader title={`Hotels in ${trip.destination_name}`} description={`${formatTripDates(trip.start_date, trip.end_date)} · ${nights} ${nights === 1 ? "night" : "nights"} · ${travelersLabel(trip.travelers_count)} · ${rooms} ${rooms === 1 ? "room" : "rooms"}`} />
    <TripNavigation tripId={trip.id} active="hotels" />
    <HotelsWorkspace tripId={trip.id} currency={trip.currency} initialResults={getCachedHotels(trip.owner_id, trip)} initialSelection={selection} selectionLoadFailed={selectionLoadFailed} canSearch={canSearch} currentContext={accommodationContext(trip)} allowDemo={process.env.NODE_ENV === "development"} />
  </>;
}
