import test from "node:test";
import assert from "node:assert/strict";
import { adaptWeatherBodySchema, weatherReadSchema, weatherErrorMessage } from "../src/lib/weather/validation.ts";

const id = "00000000-0000-4000-8000-000000000001";
test("weather browser contracts accept only owned IDs and explicit actions", () => {
  assert.deepEqual(weatherReadSchema.parse({}), {});
  assert.equal(adaptWeatherBodySchema.parse({ request_id: id, expected_version_id: id }).request_id, id);
  for (const injection of [{ latitude: 0 }, { longitude: 0 }, { weather: {} }, { candidates: [] }, { refresh: true }]) {
    assert.equal(weatherReadSchema.safeParse(injection).success, false);
    assert.equal(adaptWeatherBodySchema.safeParse({ request_id: id, expected_version_id: id, ...injection }).success, false);
  }
});
test("weather failure messages stay safe and distinguish recovery", () => {
  assert.match(weatherErrorMessage("WEATHER_CONTEXT_CHANGED"), /Reload/);
  assert.match(weatherErrorMessage("WEATHER_PROVIDER_RATE_LIMITED"), /Wait/);
  assert.ok(!weatherErrorMessage("PRIVATE provider details").includes("PRIVATE"));
});
