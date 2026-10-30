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
    useState<RouteResponse | null>(null);

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
          day_number: String(dayNumber),
          mode,
        });

      const response = await fetch(
        `/api/trips/${tripId}/routing?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const data = await response
        .json()
        .catch(() => null);

      if (!response.ok) {
        const code =
          typeof data?.error?.code === "string"
            ? data.error.code
            : "ROUTING_FAILED";

        const message =
          typeof data?.error?.message === "string"
            ? data.error.message
            : "Travel times are temporarily unavailable.";

        console.error(
          "[routing] request_failed",
          {
            status: response.status,
            code,
            message,
            dayNumber,
            mode,
          },
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

      setRoute(parsed.data);

    } catch (cause) {
      console.error(
        "[routing] request_exception",
        cause,
      );

      setErrorCode(
        "ROUTING_NETWORK_ERROR",
      );

      setError(
        "Travel times are temporarily unavailable.",
      );

    } finally {
      setLoading(false);
    }
  }


  function changeMode(
    nextMode: RoutingMode,
  ) {
    setMode(nextMode);

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
            changeMode("walking")
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
            changeMode("driving")
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
              {route.mode === "walking"
                ? "Walking"
                : "Driving"}

              {route.cached
                ? " · Cached"
                : ""}
            </p>
          </div>

          {route.segments.map(
            (segment, index) => (
              <div
                key={`${segment.from_index}-${segment.to_index}-${index}`}
                className="rounded-xl border p-3"
              >
                <p className="type-meta font-medium">
                  {segment.from_label ??
                    `Stop ${index + 1}`}
                  {" → "}
                  {segment.to_label ??
                    `Stop ${index + 2}`}
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
                      Long transfer between these activities.
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