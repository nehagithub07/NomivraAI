import test from "node:test";
import assert from "node:assert/strict";
import { generationBodySchema, generationResponseSchema, itineraryDocumentSchema } from "../src/lib/itineraries/validation.ts";
import { itineraryErrorMessage } from "../src/lib/itineraries/errors.ts";
import { itineraryTripContext, sameContext } from "../src/lib/itineraries/context.ts";
import { generationResult, itineraryDocument, itineraryTrip } from "./itinerary-fixtures.mjs";

test("itinerary browser generation accepts only an idempotency key and explicit regeneration", () => {
  const body = { request_id: "00000000-0000-4000-8000-000000000009" };
  assert.deepEqual(generationBodySchema.parse(body), { ...body, regenerate: false });
  for (const patch of [{ latitude: 10 }, { attractions: [] }, { trip: {} }, { user_id: itineraryTrip.owner_id }, { request_id: "invalid" }]) assert.equal(generationBodySchema.safeParse({ ...body, ...patch }).success, false);
});
test("itinerary contracts reject factual extra fields, malformed output and contradictory fixtures", () => {
  assert.ok(generationResponseSchema.safeParse(generationResult()).success);
  const data = itineraryDocument(); data.days[0].items[0].drive_minutes = 12;
  assert.equal(itineraryDocumentSchema.safeParse(data).success, false);
  assert.equal(generationResponseSchema.safeParse({ ...generationResult(), demo: true }).success, false);
  assert.equal(generationResponseSchema.safeParse({ ...generationResult(), budget: { ...generationResult().budget, restaurant_cost: "45.00" } }).success, false);
});
test("trip context excludes identity/auth and detects preference changes independent of key order", () => {
  const context = itineraryTripContext(itineraryTrip);
  assert.ok(!("owner_id" in context) && !("id" in context));
  assert.ok(sameContext(context, Object.fromEntries(Object.entries(context).reverse())));
  assert.ok(!sameContext(context, { ...context, travel_pace: "packed" }));
  assert.ok(!sameContext(context, { ...context, interests: ["nature"] }));
});
test("itinerary errors preserve recovery advice without revealing arbitrary provider errors", () => {
  assert.match(itineraryErrorMessage("ITINERARY_MISSING_PLACES"), /Discover places/);
  assert.match(itineraryErrorMessage("ITINERARY_VALIDATION_FAILED"), /reliable plan/);
  assert.match(itineraryErrorMessage("ITINERARY_CONTEXT_CHANGED"), /changed/);
  assert.match(itineraryErrorMessage("ITINERARY_PROVIDER_RATE_LIMITED"), /Wait/);
  assert.match(itineraryErrorMessage("ITINERARY_PERSISTENCE_UNAVAILABLE"), /Check again/);
  assert.match(itineraryErrorMessage("auth_unavailable"), /verify your sign-in/);
  assert.equal(itineraryErrorMessage("PRIVATE provider details"), itineraryErrorMessage(undefined));
});
