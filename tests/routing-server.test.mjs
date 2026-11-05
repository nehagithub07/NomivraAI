import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const tripId = "8b7cdb2c-83cb-460b-9a80-6a08c4bead30";
const key = "test-internal-key-that-is-at-least-32-characters";

function loadServer({ itinerary, places }) {
  const cache = new Map();
  function moduleAt(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} };
    cache.set(filename, loaded);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    function localRequire(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/itineraries/server") {
        return { getItinerary: async () => itinerary };
      }
      if (name === "@/lib/destinations/persistence") {
        return { getPersistedPlaces: async () => places };
      }
      if (name === "@/lib/destinations/backend") {
        return {
          internalKey: () => key,
          TravelError: class TravelError extends Error {},
        };
      }
      if (name === "./validation") {
        return {
          routeResponseSchema: {
            safeParse: (data) => ({ success: true, data }),
          },
        };
      }
      if (name.startsWith("@/")) {
        return moduleAt(path.resolve("src", `${name.slice(2)}.ts`));
      }
      if (name.startsWith(".")) {
        return moduleAt(path.resolve(path.dirname(filename), `${name}.ts`));
      }
      return require(name);
    }
    new Function("require", "module", "exports", source)(
      localRequire,
      loaded,
      loaded.exports,
    );
    return loaded.exports;
  }
  return moduleAt(path.resolve("src/lib/routing/server.ts"));
}

test("routing resolves legacy attraction coordinates from persisted places", async (t) => {
  const previousBase = process.env.NOMVIRA_API_URL;
  process.env.NOMVIRA_API_URL = "http://backend.test";
  t.after(() => {
    if (previousBase === undefined) delete process.env.NOMVIRA_API_URL;
    else process.env.NOMVIRA_API_URL = previousBase;
  });

  const expectedPoints = [
    { latitude: 17.385, longitude: 78.486, label: "Charminar" },
    { latitude: 17.361, longitude: 78.474, label: "Golconda Fort" },
  ];
  const itinerary = {
    itinerary: {
      days: [
        {
          day_number: 1,
          items: [
            {
              candidate_type: "attraction",
              candidate_id: "node/1",
              title: "Charminar",
              latitude: null,
              longitude: null,
            },
            {
              candidate_type: "food",
              candidate_id: "node/3",
              title: "Food stop",
              latitude: null,
              longitude: null,
            },
            {
              candidate_type: "attraction",
              candidate_id: "node/2",
              title: "Golconda Fort",
              latitude: null,
              longitude: null,
            },
          ],
        },
      ],
    },
  };
  const places = [
    {
      provider_place_id: "node/1",
      latitude: expectedPoints[0].latitude,
      longitude: expectedPoints[0].longitude,
    },
    {
      provider_place_id: "node/2",
      latitude: expectedPoints[1].latitude,
      longitude: expectedPoints[1].longitude,
    },
    { provider_place_id: "node/3", latitude: 17.4, longitude: 78.5 },
  ];

  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://backend.test/api/v1/routing/route");
    assert.equal(options.headers["X-Nomvira-Internal-Key"], key);
    assert.deepEqual(JSON.parse(options.body), {
      points: expectedPoints,
      mode: "driving",
    });
    return Response.json({ route: "resolved" });
  });

  const { getTripDayRoute } = loadServer({ itinerary, places });
  const result = await getTripDayRoute({}, { id: tripId }, 1, "driving");

  assert.deepEqual(result, { route: "resolved" });
});
