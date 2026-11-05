import "server-only";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Database,
} from "@/lib/supabase/database.types";

import {
  normalizedPlaceSchema,
  type NormalizedPlace,
} from "./validation";

import {
  TravelError,
} from "./backend";


function importance(
  place: NormalizedPlace,
) {
  let score = 0;

  if (place.tags.wikidata || place.tags.wikipedia) {
    score += 20;
  }

  if (place.tags.wikipedia && place.tags.wikidata) {
    score += 2;
  }

  if (place.tags.website) {
    score += 1;
  }

  if (
    ["theme_park", "zoo", "aquarium"].includes(
      place.tags.tourism ?? "",
    )
  ) {
    score += 16;
  }

  if (["monument", "castle", "palace", "archaeological_site"].includes(place.tags.historic ?? "")) score += 10;
  score += ({ monument: 4, historic: 3, museum: 2, viewpoint: 2, gallery: 1, park: 1, attraction: 0, arts_centre: 0 })[place.category];

  return score;
}


export async function getPersistedPlaces(
  db: SupabaseClient<Database>,
  tripId: string,
): Promise<NormalizedPlace[]> {
  const {
    data,
    error,
  } = await db
    .from("trip_place_candidates")
    .select(
      "distance_km, places(provider, provider_place_id, name, category, latitude, longitude, metadata)",
    )
    .eq("trip_id", tripId)
    .eq("source", "overpass")
    .limit(30);

  if (error) {
    throw new TravelError(
      "database_unavailable",
      "We couldn't load saved places. Please try again.",
    );
  }

  const places =
    (data || []).flatMap(
      (candidate) => {
        if (!candidate.places) {
          return [];
        }

        const result =
          normalizedPlaceSchema.safeParse({
            ...candidate.places,

            distance_km:
              Number(
                candidate.distance_km,
              ),

            tags:
              candidate.places
                .metadata || {},
          });

        return result.success
          ? [result.data]
          : [];
      },
    );

  return places.sort(
    (a, b) =>
      importance(b) -
        importance(a) ||
      a.distance_km -
        b.distance_km ||
      a.name.localeCompare(
        b.name,
      ),
  );
}
