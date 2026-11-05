"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import {
  routeResponseSchema,
  type RouteResponse,
  type RoutingMode,
} from "@/lib/routing/validation";


function minutes(seconds: number) {
  return Math.max(
    1,
    Math.round(seconds / 60),
  );
}


function distance(meters: number) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}


function routingErrorMessage(
  code: string,
  fallback: string,
) {
  switch (code) {
    case "ROUTING_NOT_ENOUGH_POINTS":
      return "This day needs at least two mapped places before travel times can be calculated.";

    case "ROUTING_ITINERARY_REQUIRED":
      return "Generate an itinerary before calculating travel times.";

    case "ROUTING_DAY_NOT_FOUND":
      return "This itinerary day could not be found.";

    case "ROUTE_NOT_FOUND":
      return "No walking or driving route could be found between these places.";

    case "ROUTING_PROVIDER_RATE_LIMITED":
      return "The routing service is busy right now. Please try again shortly.";

    case "ROUTING_PROVIDER_CONNECT_TIMEOUT":
    case "ROUTING_PROVIDER_READ_TIMEOUT":
    case "ROUTING_PROVIDER_WRITE_TIMEOUT":
    case "ROUTING_PROVIDER_POOL_TIMEOUT":
    case "ROUTING_PROVIDER_TIMEOUT":
      return "The routing service took too long to respond. Please try again.";

    case "ROUTING_PROVIDER_AUTH_ERROR":
      return "Travel-time routing is temporarily unavailable because the routing provider could not be authenticated.";

    case "ROUTING_CONFIGURATION_ERROR":
      return "Travel-time routing is not configured correctly.";

    case "ROUTING_REQUEST_TOO_LARGE":
      return "There are too many mapped stops in this route. Try calculating a shorter route.";

    case "ROUTING_PROVIDER_INVALID_REQUEST":
      return "The routing service could not process these locations.";

    case "ROUTING_PROVIDER_INVALID_RESPONSE":
      return "The routing provider returned an invalid response. Please try again.";

    case "ROUTING_PROVIDER_UNAVAILABLE":
      return "The routing service is temporarily unavailable. Please try again.";

    default:
      return fallback;
  }
}


export function DayRouteSummary({
  tripId,
  dayNumber,
}: {
  tripId: string;
  dayNumber: number;
}) {
  const [mode, setMode] =
    useState<RoutingMode>("driving");

  const [route, setRoute] =
    useState<RouteResponse | null>(
      null,
    );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [errorCode, setErrorCode] =
    useState("");


  async function load() {
    if (loading) {
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
            String(dayNumber),

          mode,
        });

      const response =
        await fetch(
          `/api/trips/${encodeURIComponent(
            tripId,
          )}/routing?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

      const data =
        await response
          .json()
          .catch(() => null);

      /*
       * The API can legitimately return errors such as
       * ROUTING_NOT_ENOUGH_POINTS.
       *
       * These are handled UI states, so use console.warn()
       * rather than console.error(). Next.js development
       * mode can otherwise display handled errors in the
       * red console-error overlay.
       */
      if (!response.ok) {
        const code =
          typeof data?.error
            ?.code === "string"
            ? data.error.code
            : "ROUTING_FAILED";

        const fallbackMessage =
          typeof data?.error
            ?.message ===
          "string"
            ? data.error.message
            : "Travel times are temporarily unavailable.";

        const message =
          routingErrorMessage(
            code,
            fallbackMessage,
          );

        console.warn(
          `[routing] request_failed status=${response.status} code=${code} day=${dayNumber} mode=${mode}`,
        );

        setErrorCode(code);
        setError(message);

        return;
      }

      const parsed =
        routeResponseSchema.safeParse(
          data,
        );

      if (!parsed.success) {
        /*
         * Invalid payloads are also handled gracefully.
         * Avoid console.error() so they do not create a
         * Next.js development error overlay.
         */
        console.warn(
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

      setRoute(parsed.data);
    } catch (cause) {
      /*
       * Network errors, aborted requests, or unexpected
       * fetch failures are presented in the component
       * instead of triggering the development overlay.
       */
      console.warn(
        "[routing] request_exception",
        cause,
      );

      setErrorCode(
        "ROUTING_NETWORK_ERROR",
      );

      setError(
        "Travel times are temporarily unavailable. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }


  function changeMode(
    nextMode: RoutingMode,
  ) {
    if (
      loading ||
      nextMode === mode
    ) {
      return;
    }

    setMode(nextMode);

    /*
     * Route results are mode-specific.
     * Clear the previous result when switching
     * between walking and driving.
     */
    setRoute(null);
    setError("");
    setErrorCode("");
  }


  return (
    <div className="mb-5 rounded-2xl border bg-surface-secondary p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={
            mode === "walking"
              ? "default"
              : "secondary"
          }
          disabled={loading}
          onClick={() =>
            changeMode(
              "walking",
            )
          }
        >
          Walk
        </Button>

        <Button
          size="sm"
          variant={
            mode === "driving"
              ? "default"
              : "secondary"
          }
          disabled={loading}
          onClick={() =>
            changeMode(
              "driving",
            )
          }
        >
          Drive
        </Button>

        <Button
          size="sm"
          variant="accent"
          loading={loading}
          disabled={loading}
          onClick={load}
        >
          Load travel times
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border p-3"
        >
          <p className="type-meta text-muted-foreground">
            {error}
          </p>

          {process.env.NODE_ENV ===
            "development" &&
            errorCode && (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {errorCode}
              </p>
            )}
        </div>
      )}

      {route && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border p-3">
            <p className="type-small font-medium">
              Day {dayNumber} route
            </p>

            <p className="type-meta mt-1 text-muted-foreground">
              {minutes(
                route.total_duration_seconds,
              )}{" "}
              min
              {" · "}
              {distance(
                route.total_distance_meters,
              )}
              {" · "}
              {route.mode ===
              "walking"
                ? "Walking"
                : "Driving"}

              {route.cached
                ? " · Cached"
                : ""}
            </p>
          </div>

          {route.segments.map(
            (
              segment,
              index,
            ) => (
              <div
                key={`${segment.from_index}-${segment.to_index}-${index}`}
                className="rounded-xl border p-3"
              >
                <p className="type-meta font-medium">
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
                  {minutes(
                    segment.duration_seconds,
                  )}{" "}
                  min
                  {" · "}
                  {distance(
                    segment.distance_meters,
                  )}
                </p>

                {segment.warning ===
                  "long_transfer" && (
                    <p className="type-meta mt-2 text-amber-700">
                      Long transfer
                      between these
                      activities.
                    </p>
                  )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}