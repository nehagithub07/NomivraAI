import test from "node:test";
import assert from "node:assert/strict";
import { destinationSearchRequestSchema, discoveryResponseSchema, resolvedDestinationSchema } from "../src/lib/destinations/validation.ts";
import { createTripFormSchema, defaultTripValues } from "../src/lib/trips/validation.ts";
import { signProof, verifyProof } from "../src/lib/destinations/proof.ts";
import { destination, place } from "./destination-fixtures.mjs";
import { discoveryErrorMessage } from "../src/lib/destinations/discovery-errors.ts";

test("search query requires 3–100 characters and rejects arbitrary provider parameters", () => {
  assert.equal(destinationSearchRequestSchema.safeParse({ q: " Tokyo ", limit: "8" }).success, true);
  for (const q of ["T", "To", " ", "x".repeat(101), "Tokyo\nJapan"]) assert.equal(destinationSearchRequestSchema.safeParse({ q }).success, false);
  assert.equal(destinationSearchRequestSchema.safeParse({ q: "Tokyo", url: "https://evil.test" }).success, false);
  assert.equal(destinationSearchRequestSchema.safeParse({ q: "Tokyo", country_code: "WORLD" }).success, false);
});
test("resolution proofs reject payload, signature and key tampering", () => {
  const key = "test-internal-application-key-never-real", payload = JSON.stringify({ user_id: "user", destination });
  const signature = signProof(payload, key);
  assert.equal(verifyProof(payload, signature, key), true);
  assert.equal(verifyProof(payload.replace("35.6895", "42"), signature, key), false);
  assert.equal(verifyProof(payload, signature.slice(1), key), false);
  assert.equal(verifyProof(payload, signature, `${key}-wrong`), false);
  assert.equal(verifyProof(payload, signature, ""), false);
});
test("typing alone cannot satisfy a canonical destination requirement", () => {
  const result = createTripFormSchema("2026-10-28").safeParse({ ...defaultTripValues, destination: "asdfasdf" });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path[0] === "destination" && issue.message.includes("Select a destination")));
  assert.equal(resolvedDestinationSchema.safeParse({ ...destination, provider_location_id: "../123" }).success, false);
});
test("discovery response enforces radius, count, OSM IDs, coordinates and tag allowlist", () => {
  const value = { latitude: 35.6, longitude: 139.6, radius_meters: 10000, places: [place] };
  assert.equal(discoveryResponseSchema.safeParse(value).success, true);
  assert.equal(discoveryResponseSchema.safeParse({ ...value, places: Array(31).fill(place) }).success, false);
  assert.equal(discoveryResponseSchema.safeParse({ ...value, radius_meters: 20001 }).success, false);
  for (const changes of [{ latitude: 91 }, { provider_place_id: "123" }, { distance_km: -1 }, { tags: { phone: "private" } }]) assert.equal(discoveryResponseSchema.safeParse({ ...value, places: [{ ...place, ...changes }] }).success, false);
});

test("discovery errors explain recovery without showing arbitrary server details", () => {
  assert.match(discoveryErrorMessage("provider_unavailable"), /service is temporarily unavailable/);
  assert.match(discoveryErrorMessage("provider_rate_limited"), /wait a little/);
  assert.match(discoveryErrorMessage("persistence_unavailable"), /found places but couldn't save/);
  assert.match(discoveryErrorMessage("unauthorized"), /Sign in again/);
  assert.equal(discoveryErrorMessage("PRIVATE PROVIDER DETAILS"), discoveryErrorMessage(undefined));
});
