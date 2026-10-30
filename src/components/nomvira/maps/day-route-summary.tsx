"use client";

import {
  useState,
} from "react";

import {
  Button,
} from "@/components/ui/button";

import {
  routeResponseSchema,
  type RouteResponse,
  type RoutingMode,
} from "@/lib/routing/validation";


function minutes(
  seconds: number,
) {
  return Math.max(
    1,
    Math.round(
      seconds / 60,
    ),
  );
}


export function DayRouteSummary({
  tripId,
  dayNumber,
}: {
  tripId: string;
  dayNumber: number;
}) {
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


  async function load() {
    setLoading(true);
    setError("");

    try {
      const params =
        new URLSearchParams({
          day_number:
            String(dayNumber),

          mode,
        });

      const response =
        await fetch(
          `/api/trips/${tripId}/routing?${params}`,
          {
            cache: "no-store",
          },
        );

      const data =
        await response
          .json()
          .catch(() => null);

      if (!response.ok) {
        setError(
          data?.error?.message ??
            "Travel times are unavailable.",
        );

        return;
      }

      const parsed =
        routeResponseSchema.safeParse(
          data,
        );

      if (!parsed.success) {
        setError(
          "Travel times are unavailable.",
        );

        return;
      }

      setRoute(parsed.data);

    } catch {
      setError(
        "Travel times are unavailable.",
      );

    } finally {
      setLoading(false);
    }
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
          onClick={() => {
            setMode("walking");
            setRoute(null);
          }}
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
          onClick={() => {
            setMode("driving");
            setRoute(null);
          }}
        >
          Drive
        </Button>

        <Button
          size="sm"
          variant="accent"
          loading={loading}
          onClick={load}
        >
          Load travel times
        </Button>
      </div>

      {error && (
        <p className="type-meta mt-3 text-muted-foreground">
          {error}
        </p>
      )}

      {route && (
        <div className="mt-4 space-y-2">
          {route.segments.map(
            (
              segment,
              index,
            ) => (
              <p
                key={index}
                className="type-meta text-muted-foreground"
              >
                {segment.from_label ??
                  `Stop ${
                    index + 1
                  }`}
                {" → "}
                {segment.to_label ??
                  `Stop ${
                    index + 2
                  }`}
                {": "}
                {minutes(
                  segment.duration_seconds,
                )}
                {" min · "}
                {(
                  segment.distance_meters /
                  1000
                ).toFixed(1)}
                {" km"}

                {segment.warning ===
                  "long_transfer"
                  ? " · Long transfer"
                  : ""}
              </p>
            ),
          )}
        </div>
      )}
    </div>
  );
}