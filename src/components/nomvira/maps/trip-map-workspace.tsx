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
  const minutes = Math.max(
    1,
    Math.round(seconds / 60),
  );

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(
    minutes / 60,
  );

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
    return `${Math.round(
      meters,
    )} m`;
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


  // Driving is currently the safer default.
  const [
    mode,
    setMode,
  ] = useState<RoutingMode>(
    "driving",
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


  const [
    errorCode,
    setErrorCode,
  ] = useState("");


  const day =
    itinerary?.itinerary.days.find(
      (item) =>
        item.day_number ===
        dayNumber,
    );


  /*
   * Persisted discovered attractions are authoritative.
   *
   * This also lets older itinerary items recover coordinates
   * from the persisted attraction candidate when their
   * itinerary snapshot has null coordinates.
   */
  const discoveredPlaceMap =
    useMemo(
      () =>
        new Map(
          discoveredPlaces.map(
            (place) => [
              place.id,
              place,
            ],
          ),
        ),

      [discoveredPlaces],
    );


  const itineraryPoints =
    useMemo<TripMapPoint[]>(
      () => {
        if (!day) {
          return [];
        }

        return day.items.flatMap(
          (item, index) => {
            let latitude =
              item.latitude;

            let longitude =
              item.longitude;


            /*
             * Attraction candidate IDs are OpenStreetMap
             * provider IDs, so we can safely backfill them
             * from persisted discovered places.
             */
            if (
              (
                latitude === null ||
                longitude === null
              ) &&
              item.candidate_type ===
                "attraction" &&
              item.candidate_id
            ) {
              const persisted =
                discoveredPlaceMap.get(
                  item.candidate_id,
                );

              if (persisted) {
                latitude =
                  persisted.latitude;

                longitude =
                  persisted.longitude;
              }
            }


            if (
              latitude === null ||
              longitude === null
            ) {
              return [];
            }


            return [
              {
                id:
                  item.candidate_id ??
                  `${dayNumber}-${index}`,

                name: item.title,

                latitude,
                longitude,

                kind:
                  "itinerary" as const,

                order:
                  index + 1,
              },
            ];
          },
        );
      },

      [
        day,
        dayNumber,
        discoveredPlaceMap,
      ],
    );


  /*
   * Avoid drawing a normal discovered-place marker directly
   * underneath an itinerary-number marker for the same POI.
   */
  const itineraryIds =
    useMemo(
      () =>
        new Set(
          itineraryPoints.map(
            (point) => point.id,
          ),
        ),

      [itineraryPoints],
    );


  const points =
    useMemo<TripMapPoint[]>(
      () => [
        ...discoveredPlaces
          .filter(
            (place) =>
              !itineraryIds.has(
                place.id,
              ),
          )
          .map(
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
        itineraryIds,
        itineraryPoints,
      ],
    );


  const canCalculateRoute =
    itineraryPoints.length >= 2;


  async function loadRoute(
    nextMode = mode,
    nextDay = dayNumber,
  ) {
    if (
      loading ||
      itineraryPoints.length < 2
    ) {
      return;
    }


    setLoading(true);
    setError("");
    setErrorCode("");
    setRoute(null);


    try {
      const params =
        new URLSearchParams({
          day_number:
            String(nextDay),

          mode:
            nextMode,
        });


      const response =
        await fetch(
          `/api/trips/${tripId}/routing?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );


      const body =
        await response
          .json()
          .catch(
            () => null,
          );


      if (!response.ok) {
        const code =
          typeof body?.error
            ?.code === "string"
            ? body.error.code
            : "ROUTING_FAILED";


        const message =
          typeof body?.error
            ?.message === "string"
            ? body.error.message
            : "Route information is temporarily unavailable.";


        console.error(
          "[routing] route_failed",
          {
            status:
              response.status,

            code,
            message,

            tripId,
            dayNumber:
              nextDay,

            mode:
              nextMode,

            routableStops:
              itineraryPoints.length,
          },
        );


        setErrorCode(
          code,
        );

        setError(
          message,
        );

        return;
      }


      const parsed =
        routeResponseSchema.safeParse(
          body,
        );


      if (!parsed.success) {
        console.error(
          "[routing] invalid_response",
          parsed.error.flatten(),
        );


        setErrorCode(
          "ROUTING_INVALID_RESPONSE",
        );

        setError(
          "The routing service returned an invalid response.",
        );

        return;
      }


      setRoute(
        parsed.data,
      );

    } catch (cause) {
      console.error(
        "[routing] request_exception",
        cause,
      );


      setErrorCode(
        "ROUTING_NETWORK_ERROR",
      );

      setError(
        "Route information is temporarily unavailable.",
      );

    } finally {
      setLoading(false);
    }
  }


  function chooseDay(
    value: number,
  ) {
    setDayNumber(
      value,
    );

    setRoute(null);
    setError("");
    setErrorCode("");
  }


  function chooseMode(
    value: RoutingMode,
  ) {
    setMode(
      value,
    );

    setRoute(null);
    setError("");
    setErrorCode("");
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
              disabled={loading}
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
              disabled={loading}
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
                  disabled={loading}
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


        <div className="mt-5 rounded-xl border p-4">
          <p className="type-small font-medium">
            Day {dayNumber}
          </p>

          <p className="type-meta mt-1 text-muted-foreground">
            {
              itineraryPoints.length
            }{" "}
            mapped{" "}
            {itineraryPoints.length ===
            1
              ? "stop"
              : "stops"}{" "}
            available for routing
          </p>


          {!canCalculateRoute && (
            <p className="type-meta mt-2 text-amber-700">
              At least 2 mapped itinerary stops are required to calculate a route.
            </p>
          )}


          <div className="mt-4">
            <Button
              onClick={() =>
                loadRoute()
              }
              loading={
                loading
              }
              disabled={
                loading ||
                !canCalculateRoute
              }
            >
              {canCalculateRoute
                ? "Calculate real route"
                : "Need 2 mapped stops"}
            </Button>
          </div>
        </div>


        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-destructive/20 p-4"
          >
            <p className="type-small text-destructive">
              {error}
            </p>


            {process.env
              .NODE_ENV ===
              "development" &&
              errorCode && (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {errorCode}
                </p>
              )}
          </div>
        )}
      </SurfaceCard>


      <TripMap
        points={points}
        route={route}
        center={center}
        styleUrl={
          mapStyleUrl
        }
      />


      {route && (
        <SurfaceCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="type-small font-semibold">
                Day{" "}
                {dayNumber} route
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
                {route.mode ===
                "walking"
                  ? "Walking"
                  : "Driving"}
              </p>
            </div>


            {route.cached && (
              <span className="type-meta rounded-full border px-3 py-1 text-muted-foreground">
                Cached
              </span>
            )}
          </div>


          <div className="mt-5 space-y-4">
            {route.segments.map(
              (
                segment,
                index,
              ) => (
                <div
                  key={`${segment.from_index}-${segment.to_index}-${index}`}
                  className="rounded-xl border p-4"
                >
                  <p className="type-small font-medium">
                    {segment.from_label ??
                      `Stop ${
                        index +
                        1
                      }`}
                    {" → "}
                    {segment.to_label ??
                      `Stop ${
                        index +
                        2
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
            Route distance and travel time are provided by openrouteservice using OpenStreetMap routing data. Times are planning estimates and do not include live traffic.
          </p>
        </SurfaceCard>
      )}
    </div>
  );
}