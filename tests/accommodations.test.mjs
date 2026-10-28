import test from "node:test";
import assert from "node:assert/strict";
import { accommodationSchema, hotelResponseSchema, hotelSearchBodySchema, hotelSelectionBodySchema } from "../src/lib/accommodations/validation.ts";
import { filterAndSortHotels, defaultHotelFilters, moneyMinor } from "../src/lib/accommodations/catalog.ts";
import { hotelNights, roomsForTravelers, accommodationContext } from "../src/lib/accommodations/context.ts";
import { hotelErrorMessage } from "../src/lib/accommodations/errors.ts";
import { hotel, hotelResults, hotelTrip } from "./hotel-fixtures.mjs";

test("hotel nights exclude checkout and rooms use explicit adults-only occupancy assumption", () => {
  assert.equal(hotelNights("2099-04-12", "2099-04-18"), 6);
  assert.equal(hotelNights("2099-04-12", "2099-04-12"), 0);
  assert.equal(hotelNights("2027-03-27", "2027-03-29"), 2);
  assert.deepEqual([1,2,3,4,5,20].map(roomsForTravelers), [1,1,2,2,3,10]);
  assert.equal(accommodationContext(hotelTrip).destination_provider, "open_meteo");
  assert.equal("owner_id" in accommodationContext(hotelTrip), false);
});
test("normalized accommodation distinguishes stars, guest scale, price basis and demo provenance", () => {
  assert.equal(accommodationSchema.safeParse(hotel).success, true);
  assert.equal(accommodationSchema.safeParse({ ...hotel, guest_rating: 8.8, guest_rating_scale: 5 }).success, false);
  assert.equal(accommodationSchema.safeParse({ ...hotel, star_rating: 8.8 }).success, false);
  assert.equal(accommodationSchema.safeParse({ ...hotel, nightly_price: 85 }).success, false);
  assert.equal(hotelResponseSchema.safeParse(hotelResults()).success, true);
  assert.equal(hotelResponseSchema.safeParse(hotelResults({ demo: false })).success, false);
  for (const url of ["javascript:alert(1)", "https://booking.com.attacker.test/a", "http://booking.com/a", "https://name:secret@booking.com/a"]) assert.equal(accommodationSchema.safeParse({ ...hotel, booking_url: url }).success, false);
});
test("browser search and selection cannot provide authoritative trip or candidate data", () => {
  assert.equal(hotelSearchBodySchema.safeParse({ refresh: true }).success, true);
  for (const body of [{ owner_id: "other" }, { destination: "Paris" }, { dates: [] }, { budget: 1 }, { api_key: "private" }]) assert.equal(hotelSearchBodySchema.safeParse(body).success, false);
  assert.equal(hotelSelectionBodySchema.safeParse({ provider: "stayapi", price: 1 }).success, false);
});
test("price filters and sorting use decimal minor units and never mix currencies or unknowns", () => {
  const cheap = { ...hotel, provider_accommodation_id: "cheap", total_price: "510.09" };
  const dear = { ...hotel, provider_accommodation_id: "dear", total_price: "510.10" };
  const unknown = { ...hotel, provider_accommodation_id: "unknown", total_price: null, comparable_price: false };
  const foreign = { ...hotel, provider_accommodation_id: "foreign", total_price: "1.00", currency: "EUR", comparable_price: false };
  const items = [unknown, dear, foreign, cheap], filters = { ...defaultHotelFilters };
  assert.equal(moneyMinor("510.09"), 51009);
  assert.equal(filterAndSortHotels(items, filters, "price_asc")[0].provider_accommodation_id, "cheap");
  assert.equal(filterAndSortHotels(items, filters, "price_desc")[0].provider_accommodation_id, "dear");
  assert.deepEqual(filterAndSortHotels(items, { ...filters, maxPrice: "510.09" }, "recommended").map(c => c.provider_accommodation_id), ["cheap"]);
  assert.deepEqual(filterAndSortHotels(items, { ...filters, minPrice: "510.10", maxPrice: "511.00" }, "recommended").map(c => c.provider_accommodation_id), ["dear"]);
  assert.equal(items[0], unknown); // Sorting never mutates the loaded candidate pool.
});
test("local star, type, normalized review and distance filters combine without requests", () => {
  const apartment = { ...hotel, provider_accommodation_id: "apartment", accommodation_type: "apartment", star_rating: null, guest_rating: 4.6, guest_rating_scale: 5, distance_km: 3 };
  const four = { ...hotel, provider_accommodation_id: "four", star_rating: 4, guest_rating: 9, distance_km: 1 };
  assert.equal(filterAndSortHotels([apartment], { ...defaultHotelFilters }, "recommended").length, 1);
  assert.equal(filterAndSortHotels([apartment], { ...defaultHotelFilters, stars: "3" }, "recommended").length, 0);
  assert.equal(filterAndSortHotels([apartment, four], { ...defaultHotelFilters, type: "apartment", minRating: ".9", maxDistance: "5" }, "recommended")[0].provider_accommodation_id, "apartment");
  assert.equal(filterAndSortHotels([apartment, four], { ...defaultHotelFilters }, "guest_rating")[0].provider_accommodation_id, "apartment");
  assert.equal(filterAndSortHotels([apartment, four], { ...defaultHotelFilters }, "distance")[0].provider_accommodation_id, "four");
});
test("hotel recovery messages do not echo arbitrary provider or database details", () => {
  assert.match(hotelErrorMessage("ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED"), /allowance/);
  assert.match(hotelErrorMessage("selection_expired"), /Search again/);
  assert.match(hotelErrorMessage("selection_conflict"), /another tab/);
  assert.equal(hotelErrorMessage("PRIVATE database password"), hotelErrorMessage(undefined));
});
