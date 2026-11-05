import "server-only";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import { z } from "zod";

import type {
  Database,
  TripRow,
} from "@/lib/supabase/database.types";

import {
  internalKey,
  TravelError,
} from "@/lib/destinations/backend";

import {
  signProof,
  verifyProof,
} from "@/lib/destinations/proof";

import {
  foodContext,
} from "./context";

import {
  defaultFoodCategories,
} from "./catalog";

import {
  foodCategories,
  foodResponseSchema,
  foodSelectionSchema,
  type FoodResults,
  type FoodSearchOptions,
} from "./validation";


const DEFAULT_FOOD_RADIUS_METERS =
  10_000;

const MAX_CLIENT_CACHE_ENTRIES =
  128;

const MAX_RESULT_LIFETIME_SECONDS =
  30 * 60;


const recentSearches =
  new Map<string, FoodResults>();


const providerCodes = new Set([
  "FOOD_CONFIGURATION_ERROR",
  "FOOD_PROVIDER_AUTH_ERROR",
  "FOOD_PROVIDER_RATE_LIMITED",
  "FOOD_PROVIDER_UNAVAILABLE",
  "FOOD_PROVIDER_INVALID_RESPONSE",
  "FOOD_PROVIDER_INVALID_REQUEST",
  "FOOD_PROVIDER_TIMEOUT",
  "FOOD_PROVIDER_CONNECTION_ERROR",
  "FOOD_RATE_LIMITED",
  "FOOD_CACHE_MISS",
]);


function uniqueSorted(
  values: string[],
) {
  return [
    ...new Set(
      values.map(
        value =>
          value.trim(),
      ).filter(Boolean),
    ),
  ].sort(
    (a, b) =>
      a.localeCompare(b),
  );
}


function destinationName(
  trip: TripRow,
) {
  const displayName =
    trip.destination_display_name
      ?.trim();

  if (displayName) {
    return displayName;
  }

  return (
    trip.destination_name
      ?.trim()
    ||
    "Destination"
  );
}


function searchKey(
  userId: string,
  trip: TripRow,
  options: FoodSearchOptions,
) {
  return JSON.stringify([
    userId,

    trip.id,

    foodContext(
      trip,
    ),

    {
      destination_name:
        destinationName(
          trip,
        ),

      radius_meters:
        options.radius_meters
        ??
        DEFAULT_FOOD_RADIUS_METERS,

      categories:
        options.categories
        ??
        defaultFoodCategories,

      dietary_preferences:
        uniqueSorted(
          options.dietary_preferences
          ??
          trip.dietary_preferences
          ??
          [],
        ),

      cuisine_preferences:
        uniqueSorted(
          options.cuisine_preferences
          ??
          [],
        ),

      strict_dietary:
        options.strict_dietary
        ??
        false,

      demo:
        options.demo
        ??
        false,
    },
  ]);
}


export function getCachedFood(
  userId: string,
  trip: TripRow,
  options: FoodSearchOptions = {},
): FoodResults | null {
  const key =
    searchKey(
      userId,
      trip,
      options,
    );

  const cached =
    recentSearches.get(
      key,
    );


  if (!cached) {
    return null;
  }


  const expiresAt =
    Date.parse(
      cached.expires_at,
    );


  const valid =
    Number.isFinite(
      expiresAt,
    )
    &&
    expiresAt
    >
    Date.now();


  const allowedEnvironment =
    !(
      cached.demo
      &&
      process.env.NODE_ENV
      === "production"
    );


  if (
    valid
    &&
    allowedEnvironment
  ) {
    return structuredClone({
      ...cached,
      cached: true,
    });
  }


  recentSearches.delete(
    key,
  );

  return null;
}


export function foodSelectionFailure(
  error: {
    code?: string;
  },
) {
  if (
    [
      "PGRST202",
      "PGRST204",
      "PGRST205",
      "42703",
      "42883",
      "42P01",
    ].includes(
      error.code
      ??
      "",
    )
  ) {
    return new TravelError(
      "setup_required",
      "Saving food spots needs a database setup update.",
    );
  }


  if (
    [
      "22023",
      "28000",
    ].includes(
      error.code
      ??
      "",
    )
  ) {
    return new TravelError(
      "selection_expired",
      "Search food again before saving this place.",
      409,
    );
  }


  return new TravelError(
    "persistence_unavailable",
    "We couldn't update your saved food spots. Please try again.",
  );
}


export async function loadOwnedFoodTrip(
  db: SupabaseClient<Database>,
  tripId: string,
  userId: string,
) {
  const {
    data,
    error,
  } = await db
    .from("trips")
    .select("*")
    .eq(
      "id",
      tripId,
    )
    .eq(
      "owner_id",
      userId,
    )
    .maybeSingle();


  if (error) {
    throw new TravelError(
      "database_unavailable",
      "We couldn't load your trip.",
    );
  }


  if (
    !data
    ||
    data.owner_id
    !== userId
  ) {
    throw new TravelError(
      "not_found",
      "Trip not found.",
      404,
    );
  }


  return data;
}


export async function getFoodSelections(
  db: SupabaseClient<Database>,
  tripId: string,
) {
  const {
    data,
    error,
  } = await db
    .from(
      "trip_food_selections",
    )
    .select("*")
    .eq(
      "trip_id",
      tripId,
    )
    .order(
      "saved_at",
      {
        ascending:
          false,
      },
    );


  if (error) {
    throw foodSelectionFailure(
      error,
    );
  }


  return z
    .array(
      foodSelectionSchema,
    )
    .parse(
      data,
    );
}


export function validateFoodTrip(
  trip: TripRow,
) {
  if (
    trip.destination_provider
      !== "open_meteo"
    ||
    !trip.destination_provider_id
    ||
    trip.destination_latitude
      === null
    ||
    trip.destination_longitude
      === null
  ) {
    throw new TravelError(
      "unresolved_destination",
      "Food search needs a confirmed destination.",
      409,
    );
  }
}


function providerStatus(
  code: string,
  responseStatus: number,
) {
  if (
    code
    === "FOOD_CACHE_MISS"
  ) {
    return 404;
  }

  if (
    code
    === "FOOD_PROVIDER_RATE_LIMITED"
    ||
    code
    === "FOOD_RATE_LIMITED"
    ||
    responseStatus
    === 429
  ) {
    return 429;
  }

  if (
    code
    === "FOOD_PROVIDER_INVALID_REQUEST"
    ||
    code
    === "FOOD_PROVIDER_INVALID_RESPONSE"
  ) {
    return 502;
  }

  return 503;
}


function providerMessage(
  code: string,
) {
  switch (code) {
    case "FOOD_CACHE_MISS":
      return "No current food recommendations are cached.";

    case "FOOD_PROVIDER_RATE_LIMITED":
    case "FOOD_RATE_LIMITED":
      return "Food recommendations are temporarily busy. Please try again shortly.";

    case "FOOD_CONFIGURATION_ERROR":
    case "FOOD_PROVIDER_AUTH_ERROR":
      return "Food recommendations aren't configured correctly right now.";

    case "FOOD_PROVIDER_INVALID_REQUEST":
      return "The food provider couldn't process this search.";

    default:
      return "We couldn't load food recommendations right now. Your trip is safe — please try again.";
  }
}


export async function searchTripFood(
  trip: TripRow,
  userId: string,
  options: FoodSearchOptions,
  cacheOnly = false,
): Promise<FoodResults> {
  validateFoodTrip(
    trip,
  );


  if (
    options.demo
    &&
    process.env.NODE_ENV
    === "production"
  ) {
    throw new TravelError(
      "FOOD_CONFIGURATION_ERROR",
      "Demo food search is disabled in production.",
      503,
    );
  }


  const cached =
    getCachedFood(
      userId,
      trip,
      options,
    );


  if (cached) {
    return cached;
  }


  const base =
    process.env.NOMVIRA_API_URL;


  if (!base) {
    throw new TravelError(
      "FOOD_CONFIGURATION_ERROR",
      "Food search isn't configured.",
      503,
    );
  }


  let key: string;


  try {
    key =
      internalKey();

  } catch {
    throw new TravelError(
      "FOOD_CONFIGURATION_ERROR",
      "Food search isn't configured.",
      503,
    );
  }


  const dietaryPreferences =
    uniqueSorted(
      options.dietary_preferences
      ??
      trip.dietary_preferences
      ??
      [],
    );


  const cuisinePreferences =
    uniqueSorted(
      options.cuisine_preferences
      ??
      [],
    );


  const categories =
    options.categories
    ??
    defaultFoodCategories;


  const radiusMeters =
    options.radius_meters
    ??
    DEFAULT_FOOD_RADIUS_METERS;


  const body = {
    user_id:
      userId,

    latitude:
      trip.destination_latitude,

    longitude:
      trip.destination_longitude,

    /*
     * Required by the Google Maps rating
     * enrichment service.
     *
     * Example:
     * "Hyderabad, Telangana, India"
     */
    destination_name:
      destinationName(
        trip,
      ),

    radius_meters:
      radiusMeters,

    categories,

    dietary_preferences:
      dietaryPreferences,

    cuisine_preferences:
      cuisinePreferences,

    strict_dietary:
      options.strict_dietary
      ??
      false,

    demo:
      options.demo
      ??
      false,

    limit:
      20,

    ...(
      cacheOnly
        ? {
            cache_only:
              true,
          }
        : {}
    ),
  };


  let response: Response;


  try {
    response =
      await fetch(
        `${
          base.replace(
            /\/$/,
            "",
          )
        }/api/v1/food/search`,

        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-Nomvira-Internal-Key":
              key,
          },

          body:
            JSON.stringify(
              body,
            ),

          cache:
            "no-store",

          /*
           * Live food search can now perform:
           *
           * Geoapify
           *   +
           * StayAPI Google Maps rating enrichment
           *
           * so 30 seconds is too aggressive.
           */
          signal:
            AbortSignal.timeout(
              cacheOnly
                ? 5_000
                : 45_000,
            ),

          redirect:
            "error",
        },
      );

  } catch (error) {
    console.error(
      "[food] backend_request_failed",
      {
        tripId:
          trip.id,

        cacheOnly,

        error:
          error
          instanceof Error
            ? error.name
            : "unknown",
      },
    );


    throw new TravelError(
      "FOOD_PROVIDER_UNAVAILABLE",
      "We couldn't load food recommendations right now. Your trip is safe — please try again.",
      503,
    );
  }


  if (!response.ok) {
    const failure =
      await response
        .json()
        .catch(
          () => null,
        );


    const candidate =
      failure
      ?.error
      ?.code;


    const code =
      typeof candidate
      === "string"
      &&
      providerCodes.has(
        candidate,
      )
        ? candidate
        : "FOOD_PROVIDER_UNAVAILABLE";


    console.error(
      "[food] backend_failed",
      {
        code,
        status:
          response.status,
      },
    );


    throw new TravelError(
      code,
      providerMessage(
        code,
      ),
      providerStatus(
        code,
        response.status,
      ),
    );
  }


  const raw =
    await response
      .json()
      .catch(
        () => null,
      );


  const parsed =
    foodResponseSchema.safeParse(
      raw,
    );


  if (!parsed.success) {
    console.error(
      "[food] invalid_backend_response",
      parsed.error.flatten(),
    );


    throw new TravelError(
      "FOOD_PROVIDER_INVALID_RESPONSE",
      "Food search returned unavailable data.",
      502,
    );
  }


  if (
    parsed.data.demo
    &&
    process.env.NODE_ENV
    === "production"
  ) {
    throw new TravelError(
      "FOOD_PROVIDER_INVALID_RESPONSE",
      "Food search returned unavailable data.",
      502,
    );
  }


  const result =
    parsed.data;


  const parsedExpires =
    Date.parse(
      result.expires_at,
    );


  if (
    !Number.isFinite(
      parsedExpires,
    )
  ) {
    throw new TravelError(
      "FOOD_PROVIDER_INVALID_RESPONSE",
      "Food search returned an invalid expiration time.",
      502,
    );
  }


  const nowSeconds =
    Math.floor(
      Date.now()
      /
      1000,
    );


  const providerExpires =
    Math.floor(
      parsedExpires
      /
      1000,
    );


  const expires =
    Math.min(
      providerExpires,

      nowSeconds
      +
      MAX_RESULT_LIFETIME_SECONDS,
    );


  if (
    expires
    <= nowSeconds
  ) {
    throw new TravelError(
      "FOOD_PROVIDER_UNAVAILABLE",
      "These food results have expired. Search again.",
      503,
    );
  }


  const signed:
    FoodResults = {
      ...result,

      expires_at:
        new Date(
          expires
          *
          1000,
        ).toISOString(),

      candidates:
        result.candidates.map(
          candidate => {
            const payload =
              JSON.stringify({
                kind:
                  "food_selection",

                user_id:
                  userId,

                trip_id:
                  trip.id,

                expires_at:
                  expires,

                provider:
                  candidate.provider,

                provider_place_id:
                  candidate.provider_place_id,

                name:
                  candidate.name,

                category:
                  candidate.category,

                context:
                  foodContext(
                    trip,
                  ),
              });


            return {
              ...candidate,

              selection_proof: {
                payload,

                signature:
                  signProof(
                    payload,
                    key,
                  ),
              },
            };
          },
        ),
    };


  const keyForCache =
    searchKey(
      userId,
      trip,
      options,
    );


  recentSearches.set(
    keyForCache,
    signed,
  );


  /*
   * Prevent an unbounded server-process cache.
   */
  while (
    recentSearches.size
    >
    MAX_CLIENT_CACHE_ENTRIES
  ) {
    const firstKey =
      recentSearches
        .keys()
        .next()
        .value;


    if (
      typeof firstKey
      !== "string"
    ) {
      break;
    }


    recentSearches.delete(
      firstKey,
    );
  }


  return structuredClone(
    signed,
  );
}


export function verifyFoodSelection(
  proof: {
    payload: string;
    signature: string;
  },

  trip: TripRow,

  userId: string,
) {
  try {
    const key =
      internalKey();


    if (
      !verifyProof(
        proof.payload,
        proof.signature,
        key,
      )
    ) {
      throw new Error(
        "Invalid signature"
      );
    }


    const now =
      Math.floor(
        Date.now()
        /
        1000,
      );


    const schema =
      z.object({
        kind:
          z.literal(
            "food_selection",
          ),

        user_id:
          z.literal(
            userId,
          ),

        trip_id:
          z.literal(
            trip.id,
          ),

        /*
         * Even after Google Maps enrichment,
         * Geoapify remains the authoritative
         * restaurant identity/provider.
         */
        provider:
          z.enum([
            "google_maps",
            "geoapify",
            "fixture",
          ]),

        provider_place_id:
          z.string()
            .min(1)
            .max(512),

        name:
          z.string()
            .min(1)
            .max(300),

        category:
          z.enum(
            foodCategories,
          ),

        expires_at:
          z.number()
            .int()
            .min(
              now + 1,
            )
            .max(
              now
              +
              MAX_RESULT_LIFETIME_SECONDS,
            ),

        context:
          z.record(
            z.string(),
            z.unknown(),
          ),
      });


    const data =
      schema.parse(
        JSON.parse(
          proof.payload,
        ),
      );


    const expectedContext =
      foodContext(
        trip,
      );


    if (
      JSON.stringify(
        data.context,
      )
      !==
      JSON.stringify(
        expectedContext,
      )
    ) {
      throw new Error(
        "Trip context changed"
      );
    }


    if (
      data.provider
      === "fixture"
      &&
      process.env.NODE_ENV
      === "production"
    ) {
      throw new Error(
        "Fixture selections are disabled"
      );
    }


    return data;

  } catch {
    throw new TravelError(
      "selection_expired",
      "Search food again before saving this place.",
      409,
    );
  }
}
