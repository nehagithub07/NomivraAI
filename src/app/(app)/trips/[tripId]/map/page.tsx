import type {
  Metadata,
} from "next";

import {
  notFound,
} from "next/navigation";

import {
  PageHeader,
} from "@/components/nomvira/layout/page-header";

import {
  TripNavigation,
} from "@/components/nomvira/trips/trip-navigation";

import {
  TripMapWorkspace,
} from "@/components/nomvira/maps/trip-map-workspace";

import {
  getTrip,
} from "@/lib/trips/queries";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  getItinerary,
} from "@/lib/itineraries/server";

import {
  getPersistedPlaces,
} from "@/lib/destinations/persistence";


type Props = {
  params: Promise<{
    tripId: string;
  }>;
};


export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { tripId } = await params;

  const trip = await getTrip(
    tripId,
  );

  return {
    title: trip
      ? `Map of ${trip.destination_name}`
      : "Trip not found",
  };
}


export default async function MapPage({
  params,
}: Props) {
  const { tripId } = await params;

  const trip =
    await getTrip(tripId);

  // Only return a real 404 when the trip itself
  // does not exist / cannot be accessed.
  if (!trip) {
    notFound();
  }

  // Missing coordinates should NOT turn the
  // entire route into a 404.
  if (
    trip.destination_latitude === null ||
    trip.destination_longitude === null
  ) {
    return (
      <>
        <PageHeader
          title={`Map of ${trip.destination_name}`}
          description="Map information isn't available for this trip yet."
        />

        <TripNavigation
          tripId={trip.id}
          active="map"
        />

        <div className="rounded-2xl border bg-white p-6">
          <h2 className="font-semibold">
            Destination coordinates unavailable
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            This trip does not have resolved destination
            coordinates yet. Re-select the destination or
            create a new trip using destination autocomplete
            before using maps and routing.
          </p>
        </div>
      </>
    );
  }

  const db =
    await createClient();

  let itinerary = null;

  try {
    itinerary =
      await getItinerary(
        db,
        trip,
      );
  } catch {
    itinerary = null;
  }

  let places: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }[] = [];

  try {
    const saved =
      await getPersistedPlaces(
        db,
        trip.id,
      );

    places = saved
      .filter(
        (place) =>
          typeof place.latitude === "number" &&
          typeof place.longitude === "number",
      )
      .map(
        (place) => ({
          id:
            place.provider_place_id,

          name:
            place.name,

          latitude:
            place.latitude,

          longitude:
            place.longitude,
        }),
      );
  } catch {
    places = [];
  }

  const mapStyleUrl =
    process.env
      .NEXT_PUBLIC_MAP_STYLE_URL ??
    "https://tiles.openfreemap.org/styles/liberty";

  return (
    <>
      <PageHeader
        title={`Map of ${trip.destination_name}`}
        description="Explore your saved places and calculate real walking or driving routes."
      />

      <TripNavigation
        tripId={trip.id}
        active="map"
      />

      <TripMapWorkspace
        tripId={trip.id}
        itinerary={itinerary}
        discoveredPlaces={places}
        center={{
          latitude:
            trip.destination_latitude,
          longitude:
            trip.destination_longitude,
        }}
        mapStyleUrl={
          mapStyleUrl
        }
      />
    </>
  );
}