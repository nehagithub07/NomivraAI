import { z } from "zod";


export const foodCategories = [
  "restaurant",
  "cafe",
  "bar",
  "pub",
  "fast_food",
  "food_court",
  "dessert",
  "other",
] as const;


export const foodDiets = [
  "vegetarian",
  "vegan",
  "halal",
  "kosher",
  "gluten_free",
] as const;


export const foodLabels = [
  "Nomivra Pick",
  "Best Match",
  "Nearby Pick",
  "Diet-Friendly",
  "Cuisine Match",
  "Cafe Pick",
  "Local Food Pick",
  "Highly Rated",
] as const;


export const foodRatingSources = [
  "google_maps",
] as const;


const category =
  z.enum(foodCategories);


const safeWebsite =
  z
    .string()
    .max(2000)
    .url()
    .refine(
      value => {
        try {
          const url =
            new URL(value);

          return (
            url.protocol ===
              "https:"
            &&
            !url.username
            &&
            !url.password
            &&
            (
              !url.port
              ||
              url.port ===
                "443"
            )
          );

        } catch {
          return false;
        }
      },
      {
        message:
          "Website must be a safe HTTPS URL.",
      },
    )
    .nullable();


const foodScoresSchema =
  z
    .object({
      dietary_match:
        z
          .number()
          .min(0)
          .max(1),

      cuisine_match:
        z
          .number()
          .min(0)
          .max(1),

      distance:
        z
          .number()
          .min(0)
          .max(1),

      category_preference:
        z
          .number()
          .min(0)
          .max(1),

      data_quality:
        z
          .number()
          .min(0)
          .max(1),
    })
    .strict();


export const foodSchema =
  z
    .object({
      provider:
        z.enum([
          "google_maps",
          "geoapify",
          "fixture",
        ]),

      provider_place_id:
        z
          .string()
          .min(1)
          .max(512),

      name:
        z
          .string()
          .min(1)
          .max(300),

      category,

      cuisine_types:
        z
          .array(
            z
              .string()
              .max(100),
          )
          .max(40),

      latitude:
        z
          .number()
          .min(-90)
          .max(90),

      longitude:
        z
          .number()
          .min(-180)
          .max(180),

      address:
        z
          .string()
          .max(600)
          .nullable(),

      distance_km:
        z
          .number()
          .min(0)
          .max(50)
          .nullable(),

      dietary_tags:
        z
          .array(
            z
              .string()
              .max(40),
          )
          .max(20),

      dietary_conflicts:
        z
          .array(
            z
              .string()
              .max(40),
          )
          .max(10),

      opening_hours:
        z
          .string()
          .max(600)
          .nullable(),

      website:
        safeWebsite,

      price_level:
        z
          .string()
          .max(80)
          .nullable(),

      /*
       * Live Geoapify candidates are enriched
       * with verified Google Maps ratings.
       */
      rating:
        z
          .number()
          .min(0)
          .max(5)
          .nullable(),

      rating_scale:
        z
          .number()
          .positive()
          .max(5)
          .nullable(),

      review_count:
        z
          .number()
          .int()
          .nonnegative()
          .max(
            2_147_483_647,
          )
          .nullable(),

      rating_source:
        z
          .enum(
            foodRatingSources,
          )
          .nullable().default(null),

      /*
       * Ranking position returned by
       * Google Maps search.
       */
      popularity_rank:
        z
          .number()
          .int()
          .min(1)
          .max(200)
          .nullable().default(null),

      recommendation_score:
        z
          .number()
          .min(0)
          .max(1),

      scores:
        foodScoresSchema,

      labels:
        z
          .array(
            z.enum(
              foodLabels,
            ),
          )
          .max(
            foodLabels.length,
          ),

      dietary_match:
        z.enum([
          "confirmed",
          "unknown",
          "not_requested",
        ]),
    })
    .strict()
    .superRefine(
      (
        value,
        context,
      ) => {
        /*
         * Rating fields must stay internally
         * consistent.
         */
        const hasRating =
          value.rating
          !== null;

        const hasScale =
          value.rating_scale
          !== null;

        const hasSource =
          value.rating_source
          !== null;


        if (
          hasRating
          !== hasScale
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "rating_scale",
            ],

            message:
              "Rating and rating scale must be provided together.",
          });
        }


        /*
         * For live Geoapify recommendations,
         * a restaurant must have been matched
         * to a verified Google Maps rating.
         */
        if (
          value.provider !== "fixture"
        ) {
          if (
            value.rating_source
            !== "google_maps"
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,

              path: [
                "rating_source",
              ],

              message:
                "Live food recommendations require a verified rating source.",
            });
          }


          if (
            value.rating
            === null
            ||
            value.rating
            < 4
            ||
            value.rating
            > 5
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,

              path: [
                "rating",
              ],

              message:
                "Live food recommendations must have a verified rating of 4.0 or higher.",
            });
          }


          if (
            value.rating_scale
            !== 5
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,

              path: [
                "rating_scale",
              ],

              message:
                "Google Maps food ratings must use a 5-point scale.",
            });
          }
        }


        /*
         * A source without a rating should not
         * claim review/popularity metadata.
         */
        if (
          !hasRating
          &&
          (
            value.review_count
            !== null
            ||
            hasSource
            ||
            value.popularity_rank
            !== null
          )
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "rating",
            ],

            message:
              "Rating metadata cannot be present without a rating.",
          });
        }
      },
    );


export const foodResponseSchema =
  z
    .object({
      provider:
        z.enum([
          "google_maps",
          "geoapify",
          "fixture",
        ]),

      demo:
        z.boolean(),

      cached:
        z.boolean(),

      searched_at:
        z.iso.datetime({
          offset: true,
        }),

      expires_at:
        z.iso.datetime({
          offset: true,
        }),

      radius_meters:
        z
          .number()
          .int()
          .min(100)
          .max(15_000),

      dietary_fallback:
        z.boolean(),

      candidates:
        z
          .array(
            foodSchema,
          )
          .max(40),
    })
    .strict()
    .superRefine(
      (
        value,
        context,
      ) => {
        if (
          value.demo
          !==
          (
            value.provider
            === "fixture"
          )
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "demo",
            ],

            message:
              "Demo state does not match the provider.",
          });
        }


        for (
          let index = 0;
          index <
          value.candidates.length;
          index += 1
        ) {
          const candidate =
            value.candidates[
              index
            ];

          if (
            candidate.provider
            !== value.provider
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,

              path: [
                "candidates",
                index,
                "provider",
              ],

              message:
                "Candidate provider does not match the response provider.",
            });
          }
        }
      },
    );


export const foodProofSchema =
  z
    .object({
      payload:
        z
          .string()
          .min(1)
          .max(3500),

      signature:
        z
          .string()
          .regex(
            /^[a-f0-9]{64}$/,
          ),
    })
    .strict();


export const signedFoodSchema =
  foodSchema.and(
    z
      .object({
        selection_proof:
          foodProofSchema,
      })
      .strict(),
  );


export const signedFoodResponseSchema =
  foodResponseSchema.and(
    z
      .object({
        candidates:
          z
            .array(
              signedFoodSchema,
            )
            .max(40),
      })
      .strict(),
  );


/*
 * This is the browser → Next.js BFF input.
 *
 * destination_name is intentionally NOT accepted
 * from the browser. server.ts derives it from the
 * authenticated trip before calling FastAPI.
 */
export const foodSearchBodySchema =
  z
    .object({
      radius_meters:
        z
          .number()
          .int()
          .min(100)
          .max(15_000)
          .optional(),

      categories:
        z
          .array(
            category,
          )
          .min(1)
          .max(8)
          .optional(),

      dietary_preferences:
        z
          .array(
            z.enum(
              foodDiets,
            ),
          )
          .max(5)
          .optional(),

      cuisine_preferences:
        z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(80),
          )
          .max(10)
          .optional(),

      strict_dietary:
        z
          .boolean()
          .optional(),

      demo:
        z
          .boolean()
          .optional(),
    })
    .strict();


export const foodSelectionBodySchema =
  z
    .object({
      proof:
        foodProofSchema,
    })
    .strict();


export const foodRemoveBodySchema =
  z
    .object({
      selection_id:
        z.uuid(),
    })
    .strict();


export const foodSelectionSchema =
  z
    .object({
      id:
        z.uuid(),

      trip_id:
        z.uuid(),

      provider:
        z.enum([
          "google_maps",
          "geoapify",
          "fixture",
        ]),

      provider_place_id:
        z
          .string()
          .min(1)
          .max(512),

      name:
        z
          .string()
          .min(1)
          .max(300),

      category,

      saved_at:
        z.iso.datetime({
          offset: true,
        }),
    })
    .strict();


export type FoodCandidate =
  z.infer<
    typeof signedFoodSchema
  >;


export type FoodResults =
  z.infer<
    typeof signedFoodResponseSchema
  >;


export type FoodSelection =
  z.infer<
    typeof foodSelectionSchema
  >;


export type FoodSearchOptions =
  z.infer<
    typeof foodSearchBodySchema
  >;


export type FoodSort =
  | "recommended"
  | "distance"
  | "name";
