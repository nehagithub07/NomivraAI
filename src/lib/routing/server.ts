import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
} from "@/lib/supabase/database.types";

import type {
  TripWithInterests,
} from "@/lib/trips/queries";

import {
  getItinerary,
} from "@/lib/itineraries/server";

import {
  internalKey,
  TravelError,
} from "@/lib/destinations/backend";

import {
  routeResponseSchema,
  type RouteResponse,
  type RoutingMode,
} from "./validation";


const allowedCodes = new Set([
  "ROUTING_CONFIGURATION_ERROR",
  "ROUTING_PROVIDER_AUTH_ERROR",
  "ROUTING_PROVIDER_RATE_LIMITED",
  "ROUTING_PROVIDER_TIMEOUT",
  "ROUTING_PROVIDER_UNAVAILABLE",
  "ROUTING_PROVIDER_INVALID_RESPONSE",
  "ROUTING_PROVIDER_INVALID_REQUEST",
  "ROUTE_NOT_FOUND",
]);


export async function getTripDayRoute(
  db: SupabaseClient<Database>,
  trip: TripWithInterests,
  dayNumber: number,
  mode: RoutingMode,
): Promise<RouteResponse> {
  const saved = await getItinerary(
    db,
    trip,
  );

  if (!saved) {
    throw new TravelError(
      "ROUTING_ITINERARY_REQUIRED",
      "Generate an itinerary before calculating routes.",
      409,
    );
  }

  const day = saved.itinerary.days.find(
    (item) => item.day_number === dayNumber,
  );

  if (!day) {
    throw new TravelError(
      "ROUTING_DAY_NOT_FOUND",
      "That itinerary day was not found.",
      404,
    );
  }

  const points = day.items
    .filter(
      (item) =>
        item.latitude !== null &&
        item.longitude !== null,
    )
    .map((item) => ({
      latitude: item.latitude!,
      longitude: item.longitude!,
      label: item.title,
    }));

  if (points.length < 2) {
    throw new TravelError(
      "ROUTING_NOT_ENOUGH_POINTS",
      "This day needs at least two mapped places to calculate a route.",
      409,
    );
  }

  const base = process.env.NOMVIRA_API_URL;

  if (!base) {
    throw new TravelError(
      "ROUTING_CONFIGURATION_ERROR",
      "Routing isn't configured.",
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `${base.replace(/\/$/, "")}/api/v1/routing/route`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "X-Nomvira-Internal-Key": internalKey(),
        },

        body: JSON.stringify({
          points,
          mode,
        }),

        cache: "no-store",

        signal: AbortSignal.timeout(
          25_000,
        ),

        redirect: "error",
      },
    );

  } catch {
    throw new TravelError(
      "ROUTING_PROVIDER_TIMEOUT",
      "Route information is temporarily unavailable.",
    );
  }

  if (!response.ok) {
    const failure = await response
      .json()
      .catch(() => null);

    const candidate =
      failure?.error?.code;

    const code =
      typeof candidate === "string" &&
      allowedCodes.has(candidate)
        ? candidate
        : "ROUTING_PROVIDER_UNAVAILABLE";

    throw new TravelError(
      code,
      "Route information is temporarily unavailable.",
      response.status === 429
        ? 429
        : response.status === 404
          ? 404
          : response.status === 409
            ? 409
            : 503,
    );
  }

  const parsed =
    routeResponseSchema.safeParse(
      await response.json().catch(() => null),
    );

  if (!parsed.success) {
    throw new TravelError(
      "ROUTING_PROVIDER_INVALID_RESPONSE",
      "Route information is temporarily unavailable.",
      502,
    );
  }

  return parsed.data;
}