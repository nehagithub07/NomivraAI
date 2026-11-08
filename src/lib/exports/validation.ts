import { z } from "zod";

const coordinate = { latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable() };
const money = z.string().regex(/^-?\d{1,12}(?:\.\d{1,2})?$/);
export const exportDocumentSchema = z.strictObject({
  version: z.literal(1), exportedAt: z.iso.datetime({ offset: true }),
  destination: z.string().min(1).max(160), startDate: z.iso.date(), endDate: z.iso.date(),
  days: z.array(z.strictObject({
    dayNumber: z.number().int().min(1).max(14), date: z.iso.date(), theme: z.string().max(80),
    items: z.array(z.strictObject({
      type: z.enum(["attraction", "food", "hotel", "free_time"]),
      title: z.string().min(1).max(500), period: z.enum(["morning", "afternoon", "evening"]),
      ...coordinate,
    })).max(7),
  })).max(14),
  hotel: z.strictObject({ name: z.string().max(500).nullable(), ...coordinate }).nullable(),
  food: z.array(z.strictObject({ name: z.string().min(1).max(300), category: z.string().max(80) })).max(50),
  budget: z.strictObject({
    currency: z.enum(["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"]), total: money,
    planned: money.nullable(), actual: money.nullable(), remaining: money.nullable(),
  }).nullable(),
  notices: z.array(z.enum(["itinerary_unavailable", "hotel_unavailable", "food_unavailable", "budget_unavailable", "stale_itinerary", "demo_excluded"])).max(6),
});
export type ExportDocument = z.infer<typeof exportDocumentSchema>;
export const shareOptionsSchema = z.strictObject({ hotel: z.boolean(), food: z.boolean(), budget: z.boolean() });
export type ShareOptions = z.infer<typeof shareOptionsSchema>;
export const shareCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), requestId: z.uuid(), revision: z.uuid().nullable(), expiresInDays: z.enum(["1", "7", "30"]), options: shareOptionsSchema, approved: z.literal(true) }),
  z.strictObject({ action: z.literal("revoke") }),
]);
export const noticeLabels: Record<ExportDocument["notices"][number], string> = {
  itinerary_unavailable: "The saved itinerary is unavailable. No activities have been invented.",
  hotel_unavailable: "Selected hotel details are unavailable.",
  food_unavailable: "Saved food spots are unavailable.",
  budget_unavailable: "Budget totals are shown where saved; the detailed calculation is unavailable.",
  stale_itinerary: "This itinerary was created for earlier trip preferences.",
  demo_excluded: "Demo content was excluded from this document.",
};

export function shareDocument(document: ExportDocument, options: ShareOptions): ExportDocument {
  const safe = exportDocumentSchema.parse(document);
  return {
    ...safe,
    days: safe.days.map(day => ({ ...day, items: day.items.filter(i => (i.type !== "hotel" || options.hotel) && (i.type !== "food" || options.food)) })),
    hotel: options.hotel ? safe.hotel : null, food: options.food ? safe.food : [], budget: options.budget ? safe.budget : null,
    notices: safe.notices.filter(n => (n !== "hotel_unavailable" || options.hotel) && (n !== "food_unavailable" || options.food) && (n !== "budget_unavailable" || options.budget)),
  };
}

export function mapLink(point: { latitude: number | null; longitude: number | null }): string | null {
  if (point.latitude === null || point.longitude === null || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return null;
  return `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=16/${point.latitude}/${point.longitude}`;
}
export function directionsLink(day: ExportDocument["days"][number]): string | null {
  const points = day.items.filter(p => mapLink(p));
  if (points.length < 2) return null;
  const first = points[0], last = points.at(-1)!;
  const query = new URLSearchParams({ api: "1", origin: `${first.latitude},${first.longitude}`, destination: `${last.latitude},${last.longitude}` });
  return `https://www.google.com/maps/dir/?${query}`;
}
