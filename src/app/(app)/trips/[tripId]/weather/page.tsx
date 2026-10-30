import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripNavigation } from "@/components/nomvira/trips/trip-navigation";
import { WeatherWorkspace } from "@/components/nomvira/weather/weather-workspace";
import { getTrip } from "@/lib/trips/queries";

type Props = { params: Promise<{ tripId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip ? `Weather in ${trip.destination_name}` : "Trip not found" };
}
export default async function WeatherPage({ params }: Props) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  return <><PageHeader title={`Weather in ${trip.destination_name}`} description="Real forecasts to help you plan your days. Forecasts may change." />
    <TripNavigation tripId={trip.id} active="weather" /><WeatherWorkspace tripId={trip.id} />
  </>;
}
