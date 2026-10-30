import { z } from "zod";


export const routingModeSchema = z.enum([
  "walking",
  "driving",
]);


export const routingQuerySchema = z.object({
  day_number: z.coerce.number().int().min(1).max(14),
  mode: routingModeSchema.default("walking"),
}).strict();


const routeSegmentSchema = z.object({
  from_index: z.number().int().nonnegative(),
  to_index: z.number().int().positive(),

  from_label: z.string().nullable(),
  to_label: z.string().nullable(),

  distance_meters: z.number().nonnegative(),
  duration_seconds: z.number().nonnegative(),

  warning: z.literal("long_transfer").nullable(),
}).strict();


export const routeResponseSchema = z.object({
  provider: z.literal("openrouteservice"),

  mode: routingModeSchema,

  total_distance_meters: z.number().nonnegative(),
  total_duration_seconds: z.number().nonnegative(),

  segments: z.array(routeSegmentSchema),

  geometry: z.object({
    type: z.literal("LineString"),

    coordinates: z.array(
      z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ])
    ).min(2),
  }).strict(),

  cached: z.boolean(),
}).strict();


export type RoutingMode =
  z.infer<typeof routingModeSchema>;

export type RouteResponse =
  z.infer<typeof routeResponseSchema>;