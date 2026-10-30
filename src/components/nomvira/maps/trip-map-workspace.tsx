"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  Button,
} from "@/components/ui/button";

import {
  SurfaceCard,
} from "@/components/nomvira/surface-card";

import {
  TripMap,
  type TripMapPoint,
} from "./trip-map";

import {
  routeResponseSchema,
  type RouteResponse,
  type RoutingMode,
} from "@/lib/routing/validation";

import type {
  SavedItinerary,
} from "@/lib/itineraries/validation";


function durationLabel(
  seconds: number,
) {
  const minutes =
    Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours =
    Math.floor(minutes / 60);

  const remaining =
    minutes % 60;

  return remaining
    ? `${hours} hr ${remaining} min`
    : `${hours} hr`;
}


function distanceLabel(
  meters: number,
) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(
    meters / 1000
  ).toFixed(1)} km`;
}


export function TripMapWorkspace({
  tripId,
  itinerary,
  discoveredPlaces,
  center,
  mapStyleUrl,
}: {
  tripId: string;

  itinerary:
    | SavedItinerary
    | null;

  discoveredPlaces: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }[];

  center: {
    latitude: number;
    longitude: number;
  };

  mapStyleUrl: string;
}) {
  const firstDay =
    itinerary?.itinerary.days[0]
      ?.day_number ?? 1;

  const [
    dayNumber,
    setDayNumber,
  ] = useState(firstDay);

  const [
    mode,
    setMode,
  ] = useState<RoutingMode>(
    "walking",
  );

  const [
    route,
    setRoute,
  ] =
    useState<RouteResponse | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");


  const day =
    itinerary?.itinerary.days.find(
      (item) =>
        item.day_number ===
        dayNumber,
    );


  const itineraryPoints =
    useMemo<TripMapPoint[]>(
      () =>
        (day?.items ?? [])
          .filter(
            (item) =>
              item.latitude !==
                null &&
              item.longitude !==
                null,
          )
          .map(
            (item, index) => ({
              id:
                item.candidate_id ??
                `${dayNumber}-${index}`,

              name: item.title,

              latitude:
                item.latitude!,

              longitude:
                item.longitude!,

              kind:
                "itinerary",

              order:
                index + 1,
            }),
          ),

      [
        day,
        dayNumber,
      ],
    );


  const points =
    useMemo<TripMapPoint[]>(
      () => [
        ...discoveredPlaces.map(
          (place) => ({
            ...place,
            kind:
              "discovered" as const,
          }),
        ),

        ...itineraryPoints,
      ],

      [
        discoveredPlaces,
        itineraryPoints,
      ],
    );


  async function loadRoute(
    nextMode = mode,
    nextDay = dayNumber,
  ) {
    setLoading(true);
    setError("");
    setRoute(null);

    try {
      const params =
        new URLSearchParams({
          day_number:
            String(nextDay),

          mode: nextMode,
        });

      const response =
        await fetch(
          `/api/trips/${tripId}/routing?${params}`,
          {
            cache: "no-store",
          },
        );

      const body =
        await response
          .json()
          .catch(() => null);

      if (!response.ok) {
        setError(
          body?.error?.message ??
            "Route information is unavailable.",
        );

        return;
      }

      const parsed =
        routeResponseSchema.safeParse(
          body,
        );

      if (!parsed.success) {
        setError(
          "Route information is unavailable.",
        );

        return;
      }

      setRoute(parsed.data);

    } catch {
      setError(
        "Route information is unavailable.",
      );

    } finally {
      setLoading(false);
    }
  }


  function chooseDay(
    value: number,
  ) {
    setDayNumber(value);
    setRoute(null);
    setError("");
  }


  function chooseMode(
    value: RoutingMode,
  ) {
    setMode(value);
    setRoute(null);
    setError("");
  }


  return (
    <div className="space-y-6">
      <SurfaceCard
        size="panel"
        className="p-5 sm:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="type-section">
              Trip map
            </h2>

            <p className="type-small mt-2 text-muted-foreground">
              Explore your saved places and calculate real travel routes for each itinerary day.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={
                mode === "walking"
                  ? "accent"
                  : "secondary"
              }
              size="sm"
              onClick={() =>
                chooseMode(
                  "walking",
                )
              }
            >
              Walking
            </Button>

            <Button
              variant={
                mode === "driving"
                  ? "accent"
                  : "secondary"
              }
              size="sm"
              onClick={() =>
                chooseMode(
                  "driving",
                )
              }
            >
              Driving
            </Button>
          </div>
        </div>

        {itinerary && (
          <div className="mt-5 flex flex-wrap gap-2">
            {itinerary.itinerary.days.map(
              (item) => (
                <Button
                  key={
                    item.day_number
                  }
                  size="sm"
                  variant={
                    item.day_number ===
                    dayNumber
                      ? "default"
                      : "secondary"
                  }
                  onClick={() =>
                    chooseDay(
                      item.day_number,
                    )
                  }
                >
                  Day{" "}
                  {item.day_number}
                </Button>
              ),
            )}
          </div>
        )}

        <div className="mt-5">
          <Button
            onClick={() =>
              loadRoute()
            }
            loading={loading}
            disabled={
              itineraryPoints.length <
              2
            }
          >
            Calculate real route
          </Button>
        </div>

        {error && (
          <p
            role="alert"
            className="type-small mt-4 text-destructive"
          >
            {error}
          </p>
        )}
      </SurfaceCard>

      <TripMap
        points={points}
        route={route}
        center={center}
        styleUrl={mapStyleUrl}
      />

      {route && (
        <SurfaceCard className="p-5">
          <h3 className="type-small font-semibold">
            Day {dayNumber} route
          </h3>

          <p className="type-small mt-2 text-muted-foreground">
            {durationLabel(
              route.total_duration_seconds,
            )}
            {" · "}
            {distanceLabel(
              route.total_distance_meters,
            )}
            {" · "}
            {mode === "walking"
              ? "Walking"
              : "Driving"}
          </p>

          <div className="mt-5 space-y-4">
            {route.segments.map(
              (
                segment,
                index,
              ) => (
                <div
                  key={index}
                  className="rounded-xl border p-4"
                >
                  <p className="type-small font-medium">
                    {segment.from_label ??
                      `Stop ${
                        index + 1
                      }`}
                    {" → "}
                    {segment.to_label ??
                      `Stop ${
                        index + 2
                      }`}
                  </p>

                  <p className="type-meta mt-1 text-muted-foreground">
                    {durationLabel(
                      segment.duration_seconds,
                    )}
                    {" · "}
                    {distanceLabel(
                      segment.distance_meters,
                    )}
                  </p>

                  {segment.warning ===
                    "long_transfer" && (
                    <p className="type-meta mt-2 text-amber-700">
                      Long transfer between these activities.
                    </p>
                  )}
                </div>
              ),
            )}
          </div>

          <p className="type-meta mt-5 text-muted-foreground">
            Route distance and travel time provided by openrouteservice using OpenStreetMap routing data. Times are planning estimates, not live traffic.
          </p>
        </SurfaceCard>
      )}
    </div>
  );
}