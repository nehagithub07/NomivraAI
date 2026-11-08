import test from "node:test";
import assert from "node:assert/strict";
import { exportDocumentSchema, shareDocument, mapLink, directionsLink } from "../src/lib/exports/validation.ts";
import { imagePdf } from "../src/lib/exports/pdf.ts";

import { exportDocument as documentFixture } from "./export-fixtures.mjs";

test("export/share allowlist excludes profile, memory, conversations and internal IDs", () => {
  assert.deepEqual(exportDocumentSchema.parse(documentFixture), documentFixture);
  for (const key of ["owner_id", "trip_id", "memories", "conversation", "special_requests", "api_key"]) assert.equal(exportDocumentSchema.safeParse({ ...documentFixture, [key]: "private" }).success, false);
  assert.equal(exportDocumentSchema.safeParse({ ...documentFixture, days: [{ ...documentFixture.days[0], items: [{ ...documentFixture.days[0].items[0], candidate_id: "private" }] }] }).success, false);
  const minimal = shareDocument(documentFixture, { hotel: false, food: false, budget: false });
  assert.equal(minimal.hotel, null); assert.equal(minimal.budget, null); assert.deepEqual(minimal.food, []);
  assert.deepEqual(minimal.days[0].items.map(i => i.type), ["attraction"]);
  assert.doesNotMatch(JSON.stringify(minimal), /Selected hotel|Saved cafe|1000\.00/);
  assert.deepEqual(shareDocument(documentFixture, { hotel: true, food: true, budget: true }), documentFixture);
});

test("map/directions links use only verified coordinates and handle missing locations", () => {
  assert.equal(mapLink({ latitude: null, longitude: 135 }), null);
  assert.equal(mapLink({ latitude: NaN, longitude: 135 }), null);
  assert.equal(mapLink({ latitude: 99, longitude: 135 }), null);
  assert.equal(new URL(mapLink({ latitude: 0, longitude: 0 })).hostname, "www.openstreetmap.org");
  const route = new URL(directionsLink(documentFixture.days[0]));
  assert.equal(route.searchParams.get("origin"), "35,135");
  assert.equal(route.searchParams.get("destination"), "35.1,135.1");
  assert.equal(directionsLink({ ...documentFixture.days[0], items: [] }), null);
});

test("PDF has correct cross-reference offsets, pages and safe clickable links", () => {
  const jpeg = Uint8Array.from([255, 216, 255, 217]);
  const data = imagePdf([{ jpeg, links: [{ url: mapLink({ latitude: 35, longitude: 135 }), x: 40, y: 80, width: 150, height: 15 }] }, { jpeg, links: [] }]);
  const content = new TextDecoder("latin1").decode(data);
  assert.match(content, /^%PDF-1.4/); assert.match(content, /\/Count 2/); assert.match(content, /\/Subtype \/Link/);
  const start = Number(content.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(data.subarray(start, start + 4)), "xref");
  const xref = content.slice(start).split("\n");
  const count = Number(xref[1].split(" ")[1]);
  for (let id = 1; id < count; id++) {
    const offset = Number(xref[id + 2].slice(0, 10));
    assert.equal(new TextDecoder().decode(data.subarray(offset, offset + `${id} 0 obj`.length)), `${id} 0 obj`);
  }
  assert.throws(() => imagePdf([]));
  assert.throws(() => imagePdf([{ jpeg, links: [{ url: "javascript:alert(1)", x: 0, y: 0, width: 10, height: 10 }] }]));
});
