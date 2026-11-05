import assert from "node:assert/strict";
import test from "node:test";
import {
  getSignatureDishes,
  getDestinationFoodGuide,
  HYDERABAD_DISH_SOURCE,
} from "../src/lib/food/signature-dishes.ts";

test("Hyderabad signature dishes come from the cited destination source", () => {
  assert.deepEqual(getSignatureDishes("Hyderabad, Telangana"), [
    "Hyderabadi Biryani",
    "Hyderabadi Haleem",
    "Double ka Meetha",
    "Khubani ka Meetha",
    "Mirchi ka Salan",
  ]);
  assert.match(HYDERABAD_DISH_SOURCE.url, /^https:\/\/www\.incredibleindia\.gov\.in\//);
});

test("unknown destinations do not receive invented signature dishes", () => {
  assert.deepEqual(getSignatureDishes("Tokyo"), []);
});

test("city aliases resolve exactly and city food guides respect the country", () => {
  assert.deepEqual(getSignatureDishes("HYD"), getSignatureDishes("Hyderabad"));
  assert.ok(getSignatureDishes("Mumbai, Maharashtra").includes("Vada Pav"));
  assert.deepEqual(getSignatureDishes("Not Hyderabad"), []);
  assert.equal(getDestinationFoodGuide("Hyderabad", "Pakistan"), null);
});
