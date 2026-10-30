import {
  createClient,
} from "@/lib/supabase/server";

import {
  travelRoute,
} from "@/lib/destinations/bff";

import {
  loadOwnedItineraryTrip,
} from "@/lib/itineraries/server";

import {
  getTripDayRoute,
} from "@/lib/routing/server";

import {
  routingQuerySchema,
} from "@/lib/routing/validation";


export const runtime = "nodejs";


export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      tripId: string;
    }>;
  },
) {
  return travelRoute(
    request,
    routingQuerySchema,
    async (
      query,
      userId,
    ) => {
      const db = await createClient();

      const trip =
        await loadOwnedItineraryTrip(
          db,
          (await params).tripId,
          userId,
        );

      return getTripDayRoute(
        db,
        trip,
        query.day_number,
        query.mode,
      );
    },
  );
}