// The map service, run for real against fake providers and an in-memory
// geographic-state database.
//
// These are the hallucination tests. Each one pins a place where an answer
// could quietly stop being a map result and start being a plausible sentence:
// a route computed from two remembered names, an empty POI answer filled in
// from memory, an ambiguous search silently resolved, a missing opening-hours
// tag invented, a duration derived from a distance.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { executeMapOperation, resolvePlaceRef } from "../src/lib/map/operations.ts";
import { MapServiceError } from "../src/lib/map/errors.ts";
import { formatDistance, formatDuration } from "../src/lib/map/format.ts";
import { decodePolyline } from "../src/lib/map/providers/polyline.ts";
import { buildOverpassQuery, overpassElementToPlace } from "../src/lib/map/providers/overpass.ts";
import { photonFeatureToPlace } from "../src/lib/map/providers/photon.ts";
import { nominatimPlaceToDetails } from "../src/lib/map/providers/nominatim.ts";
import { findCategory } from "../src/lib/map/categories.ts";
import {
  readGeographicContext,
  recordCurrentLocation,
  recordSelectedPlace,
  recordViewport,
} from "../src/lib/map/store.ts";
import { ensureMapSchema } from "../src/lib/map/schema.ts";

const KEY = { userId: 1, conversationId: 7 };

function createDatabase() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  ensureMapSchema(db);
  return db;
}

const RETRIEVED_AT = "2026-08-11T09:00:00.000Z";

function place(id, name, lat, lon, extra = {}) {
  return {
    id,
    name,
    displayName: `${name}, Istanbul`,
    lat,
    lon,
    source: "openstreetmap",
    provenance: { provider: "OpenStreetMap/Photon", retrievedAt: RETRIEVED_AT },
    ...extra,
  };
}

const METROPOL = place("osm:way:123", "Metropol İstanbul", 40.9558, 29.1206);
const KUCUKYALI = place("osm:node:456", "Küçükyalı", 40.9469, 29.1224);
const STARBUCKS_A = place("osm:node:900", "Starbucks", 41.0369, 28.9857);
const STARBUCKS_B = place("osm:node:901", "Starbucks", 40.9902, 29.0271);

/** A real Valhalla-shaped geometry, so the stored line has to survive intact. */
const ROUTE_GEOMETRY = {
  type: "LineString",
  coordinates: [
    [29.1224, 40.9469],
    [29.1215, 40.9502],
    [29.1206, 40.9558],
  ],
};

function providers(overrides = {}) {
  return {
    geocoder: {
      name: "OpenStreetMap/Photon",
      async search() {
        return [];
      },
      async reverse() {
        return null;
      },
      ...overrides.geocoder,
    },
    reverseGeocoder: {
      name: "OpenStreetMap/Nominatim",
      async search() {
        return [];
      },
      async reverse() {
        return null;
      },
      ...overrides.reverseGeocoder,
    },
    router: {
      name: "Valhalla/OpenStreetMap",
      async route({ origin, destination, mode }) {
        return {
          id: `route:${mode}:${origin.id}:${destination.id}`,
          origin,
          destination,
          mode,
          distanceMeters: 1834,
          durationSeconds: 1372,
          geometry: ROUTE_GEOMETRY,
          bounds: { north: 40.9558, south: 40.9469, east: 29.1224, west: 29.1206 },
          provenance: { provider: "Valhalla/OpenStreetMap", retrievedAt: RETRIEVED_AT },
        };
      },
      ...overrides.router,
    },
    poi: {
      name: "OpenStreetMap/Overpass",
      async nearby() {
        return [];
      },
      ...overrides.poi,
    },
    details: {
      name: "OpenStreetMap/Nominatim",
      async details() {
        return null;
      },
      ...overrides.details,
    },
  };
}

async function run(operation, args, options) {
  return executeMapOperation(operation, args, KEY, options);
}

/* ------------------------------------------------------------------ */
/* 1 + 2. Distance and travel time come from the router, never a guess  */
/* ------------------------------------------------------------------ */

test("a route answer carries the router's own distance and duration", async () => {
  const database = createDatabase();
  const p = providers();
  await run("map_search", { query: "Küçükyalı Marmaray" }, {
    database,
    providers: providers({ geocoder: { async search() { return [KUCUKYALI]; } } }),
  });
  await run("map_search", { query: "Metropol İstanbul" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });

  const outcome = await run(
    "map_route",
    {
      origin: { placeId: KUCUKYALI.id },
      destination: { placeId: METROPOL.id },
      mode: "walking",
    },
    { database, providers: p },
  );

  assert.equal(outcome.data.distanceMeters, 1834);
  assert.equal(outcome.data.durationSeconds, 1372);
  // Formatted once, from the router's numbers, so the model quotes rather than
  // converts. 1372 s is 22.87 min — a model estimating "1.8 km on foot" from a
  // 5 km/h rule of thumb would say 22 min by luck and 25 min by habit.
  assert.equal(outcome.data.distanceText, formatDistance(1834));
  assert.equal(outcome.data.durationText, formatDuration(1372));
  assert.equal(outcome.data.provenance.provider, "Valhalla/OpenStreetMap");
});

test("Auto retries an unexpectedly long walking route as driving", async () => {
  const database = createDatabase();
  await run("map_search", { query: "Kucukyali" }, {
    database,
    providers: providers({ geocoder: { async search() { return [KUCUKYALI]; } } }),
  });
  await run("map_search", { query: "Metropol" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  const requestedModes = [];
  const router = providers({
    router: {
      async route({ origin, destination, mode }) {
        requestedModes.push(mode);
        return {
          id: `route:${mode}:${origin.id}:${destination.id}`,
          origin,
          destination,
          mode,
          distanceMeters: mode === "walking" ? 5_500 : 4_200,
          durationSeconds: mode === "walking" ? 4_000 : 700,
          geometry: ROUTE_GEOMETRY,
          bounds: {
            north: 40.9558,
            south: 40.9469,
            east: 29.1224,
            west: 29.1206,
          },
          provenance: {
            provider: "Valhalla/OpenStreetMap",
            retrievedAt: RETRIEVED_AT,
          },
        };
      },
    },
  });

  const outcome = await run(
    "map_route",
    {
      origin: { placeId: KUCUKYALI.id },
      destination: { placeId: METROPOL.id },
      // Omitted on purpose: the schema defaults ordinary directions to Auto.
    },
    { database, providers: router },
  );

  assert.deepEqual(requestedModes, ["walking", "driving"]);
  assert.equal(outcome.data.mode, "driving");
  assert.equal(outcome.data.distanceMeters, 4_200);
});

test("a distance or travel-time question cannot be answered without routing", async () => {
  const database = createDatabase();
  // Nothing has been resolved, so there is no id to route between and no
  // coordinate argument to supply instead.
  await assert.rejects(
    run(
      "map_route",
      {
        origin: { placeId: "osm:way:123" },
        destination: { placeId: "osm:node:456" },
        mode: "walking",
      },
      { database, providers: providers() },
    ),
    (error) => error instanceof MapServiceError && error.code === "map_unknown_place",
  );
});

/* ------------------------------------------------------------------ */
/* 3. A failed routing request produces a failure, not an estimate     */
/* ------------------------------------------------------------------ */

test("a routing failure is a stated failure, with no fallback number", async () => {
  const database = createDatabase();
  await run("map_search", { query: "a" }, {
    database,
    providers: providers({ geocoder: { async search() { return [KUCUKYALI]; } } }),
  });
  await run("map_search", { query: "b" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });

  const failing = providers({
    router: {
      async route() {
        throw new MapServiceError(
          "map_route_failed",
          "I found both locations, but I couldn't calculate a verified route between them.",
          { provider: "Valhalla/OpenStreetMap" },
        );
      },
    },
  });
  await assert.rejects(
    run(
      "map_route",
      {
        origin: { placeId: KUCUKYALI.id },
        destination: { placeId: METROPOL.id },
        mode: "walking",
      },
      { database, providers: failing },
    ),
    (error) => {
      assert.ok(error instanceof MapServiceError);
      assert.equal(error.code, "map_route_failed");
      assert.match(error.message, /couldn't calculate a verified route/);
      return true;
    },
  );
  // And nothing was written: a failed route must not leave a half-route behind.
  assert.equal(readGeographicContext(KEY, database).activeRoute, undefined);
});

/* ------------------------------------------------------------------ */
/* 4. Empty POI results stay empty                                     */
/* ------------------------------------------------------------------ */

test("an empty nearby result says so instead of returning a place", async () => {
  const database = createDatabase();
  await run("map_search", { query: "Metropol İstanbul" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });

  const outcome = await run(
    "map_nearby",
    { center: { placeId: METROPOL.id }, category: "bowling", radiusMeters: 2000 },
    { database, providers: providers() },
  );

  assert.equal(outcome.data.resultCount, 0);
  assert.deepEqual(outcome.data.places, []);
  assert.equal(outcome.data.empty, true);
  assert.match(outcome.data.message, /couldn't find a matching place/i);
  assert.match(outcome.data.message, /do not supply one from memory/i);
  assert.deepEqual(readGeographicContext(KEY, database).nearbyPlaceIds, []);
});

test("nearby results are exactly the objects the POI provider returned", async () => {
  const database = createDatabase();
  await run("map_search", { query: "Metropol İstanbul" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  const lane = place("osm:way:777", "Metropol Bowling", 40.9561, 29.1211);
  const outcome = await run(
    "map_nearby",
    { center: { placeId: METROPOL.id }, category: "bowling", radiusMeters: 2000 },
    { database, providers: providers({ poi: { async nearby() { return [lane]; } } }) },
  );
  assert.deepEqual(
    outcome.data.places.map((item) => item.id),
    ["osm:way:777"],
  );
  assert.deepEqual(readGeographicContext(KEY, database).nearbyPlaceIds, ["osm:way:777"]);
});

/* ------------------------------------------------------------------ */
/* 5 + 13. Ambiguity is not resolved, and same-name places stay apart  */
/* ------------------------------------------------------------------ */

test("an ambiguous search selects nothing and asks", async () => {
  const database = createDatabase();
  const outcome = await run(
    "map_search",
    { query: "Starbucks" },
    {
      database,
      providers: providers({
        geocoder: { async search() { return [STARBUCKS_A, STARBUCKS_B]; } },
      }),
    },
  );
  assert.equal(outcome.data.ambiguous, true);
  assert.equal(outcome.data.selectedPlaceId, null);
  assert.match(outcome.data.message, /Ask the user which one/);
  assert.equal(readGeographicContext(KEY, database).selectedPlaceId, undefined);
});

test("two places sharing a name remain two entities with two ids", async () => {
  const database = createDatabase();
  await run("map_search", { query: "Starbucks" }, {
    database,
    providers: providers({
      geocoder: { async search() { return [STARBUCKS_A, STARBUCKS_B]; } },
    }),
  });
  const context = readGeographicContext(KEY, database);
  assert.equal(Object.keys(context.places).length, 2);
  assert.notEqual(STARBUCKS_A.id, STARBUCKS_B.id);
  assert.equal(context.places[STARBUCKS_A.id].lat, 41.0369);
  assert.equal(context.places[STARBUCKS_B.id].lat, 40.9902);
  // Resolving one leaves the other untouched and unselected.
  recordSelectedPlace(KEY, STARBUCKS_B, database);
  assert.equal(readGeographicContext(KEY, database).selectedPlaceId, STARBUCKS_B.id);
});

test("a single unambiguous hit is a resolution", async () => {
  const database = createDatabase();
  const outcome = await run("map_search", { query: "Metropol İstanbul" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  assert.equal(outcome.data.ambiguous, false);
  assert.equal(outcome.data.selectedPlaceId, METROPOL.id);
});

/* ------------------------------------------------------------------ */
/* 6. Stable place ids                                                 */
/* ------------------------------------------------------------------ */

test("place ids are the source's own OSM identity", () => {
  const photon = photonFeatureToPlace(
    {
      geometry: { type: "Point", coordinates: [29.1206, 40.9558] },
      properties: {
        osm_id: 123,
        osm_type: "W",
        name: "Metropol İstanbul",
        city: "İstanbul",
        osm_key: "shop",
        osm_value: "mall",
      },
    },
    RETRIEVED_AT,
  );
  assert.equal(photon.id, "osm:way:123");
  assert.equal(photon.synthesizedId, undefined);
  assert.equal(photon.provenance.provider, "OpenStreetMap/Photon");

  const overpass = overpassElementToPlace(
    { type: "node", id: 555, lat: 40.95, lon: 29.12, tags: { name: "Lane", leisure: "bowling_alley" } },
    RETRIEVED_AT,
  );
  assert.equal(overpass.id, "osm:node:555");
  assert.equal(overpass.category, "bowling");

  // A source with no identity at all is marked, so nothing downstream mistakes
  // a coordinate-derived key for an OSM object.
  const anonymous = photonFeatureToPlace(
    { geometry: { coordinates: [29.1, 40.9] }, properties: { name: "Somewhere" } },
    RETRIEVED_AT,
  );
  assert.match(anonymous.id, /^point:/);
  assert.equal(anonymous.synthesizedId, true);
});

test("a search result keeps its id all the way into stored state", async () => {
  const database = createDatabase();
  await run("map_search", { query: "Metropol" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  const context = readGeographicContext(KEY, database);
  assert.ok(context.places["osm:way:123"]);
  assert.deepEqual(context.lastSearchPlaceIds, ["osm:way:123"]);
});

/* ------------------------------------------------------------------ */
/* 7 + 8. One set of records for the map and the model                 */
/* ------------------------------------------------------------------ */

test("stored route geometry is byte-for-byte what the router returned", async () => {
  const database = createDatabase();
  await run("map_search", { query: "a" }, {
    database,
    providers: providers({ geocoder: { async search() { return [KUCUKYALI]; } } }),
  });
  await run("map_search", { query: "b" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  const outcome = await run(
    "map_route",
    { origin: { placeId: KUCUKYALI.id }, destination: { placeId: METROPOL.id }, mode: "walking" },
    { database, providers: providers() },
  );

  const stored = readGeographicContext(KEY, database).activeRoute;
  assert.deepEqual(stored.geometry, ROUTE_GEOMETRY);
  // The model never receives the geometry — only its size — so there is nothing
  // for it to paraphrase into a different line.
  assert.equal(outcome.data.geometryPointCount, ROUTE_GEOMETRY.coordinates.length);
  assert.equal(outcome.data.geometry, undefined);
});

test("the endpoints the model describes are the records the map draws", async () => {
  const database = createDatabase();
  await run("map_search", { query: "a" }, {
    database,
    providers: providers({ geocoder: { async search() { return [KUCUKYALI]; } } }),
  });
  await run("map_search", { query: "b" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  const outcome = await run(
    "map_route",
    { origin: { placeId: KUCUKYALI.id }, destination: { placeId: METROPOL.id }, mode: "driving" },
    { database, providers: providers() },
  );
  const stored = readGeographicContext(KEY, database).activeRoute;
  assert.equal(outcome.data.origin.id, stored.origin.id);
  assert.equal(outcome.data.destination.id, stored.destination.id);
  assert.equal(outcome.data.distanceMeters, stored.distanceMeters);
  assert.equal(outcome.data.durationSeconds, stored.durationSeconds);
});

/* ------------------------------------------------------------------ */
/* 9 + 14. "there", and a marker the user selected                     */
/* ------------------------------------------------------------------ */

test('"there" resolves through structured state, not language', async () => {
  const database = createDatabase();
  await run("map_search", { query: "Metropol İstanbul" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  recordCurrentLocation(
    KEY,
    { lat: 40.9469, lon: 29.1224, source: "device", capturedAt: RETRIEVED_AT },
    null,
    database,
  );

  const outcome = await run(
    "map_route",
    {
      origin: { reference: "current_location" },
      destination: { reference: "there" },
      mode: "walking",
    },
    { database, providers: providers() },
  );
  assert.equal(outcome.data.destination.id, METROPOL.id);
});

test("a place the user selected on the map is available to the agent", async () => {
  const database = createDatabase();
  // The user clicked a marker; nothing about the conversation said its name.
  recordSelectedPlace(KEY, METROPOL, database);
  const outcome = await run("map_get_selected_place", {}, { database, providers: providers() });
  assert.equal(outcome.data.selectedPlace.id, METROPOL.id);
  assert.equal(outcome.data.conversationalReferences.there, METROPOL.id);

  const nearby = await run(
    "map_nearby",
    { center: { reference: "selected" }, category: "cafe", radiusMeters: 500 },
    { database, providers: providers() },
  );
  assert.equal(nearby.data.center.id, METROPOL.id);
  assert.equal(nearby.data.centerResolvedVia, "selected");
});

test("an unresolvable reference asks rather than guesses", async () => {
  const database = createDatabase();
  await assert.rejects(
    run(
      "map_nearby",
      { center: { reference: "there" }, category: "cafe", radiusMeters: 500 },
      { database, providers: providers() },
    ),
    (error) => {
      assert.equal(error.code, "map_unresolved_reference");
      assert.match(error.message, /Ask the user which place they mean/);
      return true;
    },
  );
});

test("a stale fix is reported as stale rather than used as current", async () => {
  const database = createDatabase();
  const yesterday = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  recordCurrentLocation(
    KEY,
    { lat: 40.9469, lon: 29.1224, source: "device", capturedAt: yesterday },
    null,
    database,
  );
  const outcome = await run("map_get_current_location", {}, {
    database,
    providers: providers(),
  });
  assert.equal(outcome.data.available, true);
  assert.equal(outcome.data.stale, true);
  assert.match(outcome.data.message, /over a day old/);

  recordCurrentLocation(
    KEY,
    { lat: 40.9469, lon: 29.1224, source: "device", capturedAt: new Date().toISOString() },
    null,
    database,
  );
  const fresh = await run("map_get_current_location", {}, { database, providers: providers() });
  assert.equal(fresh.data.stale, false);
  assert.equal(fresh.data.message, undefined);
});

test("with no location at all, the agent is told to ask", async () => {
  const database = createDatabase();
  const outcome = await run("map_get_current_location", {}, {
    database,
    providers: providers(),
  });
  assert.equal(outcome.data.available, false);
  assert.match(outcome.data.message, /Ask them where they are/);
});

test("the viewport is a usable anchor for 'around here'", async () => {
  const database = createDatabase();
  recordViewport(
    KEY,
    {
      center: { lat: 41.0082, lon: 28.9784 },
      bounds: { north: 41.1, south: 40.9, east: 29.1, west: 28.8 },
      zoom: 12,
    },
    database,
  );
  const context = readGeographicContext(KEY, database);
  const resolved = resolvePlaceRef(context, { reference: "viewport_center" });
  assert.equal(resolved.place.lat, 41.0082);
  // Marked as Breadboard's own point, never as an OpenStreetMap object.
  assert.equal(resolved.place.synthesizedId, true);
  assert.equal(resolved.place.source, "breadboard");
});

/* ------------------------------------------------------------------ */
/* 10. Failures are explicit                                           */
/* ------------------------------------------------------------------ */

test("a search-service failure is reported as unverified, not as no results", async () => {
  const database = createDatabase();
  const failing = providers({
    geocoder: {
      async search() {
        throw new MapServiceError(
          "map_search_failed",
          "The map search service failed. (OpenStreetMap/Photon: the request timed out.)",
          { provider: "OpenStreetMap/Photon" },
        );
      },
    },
  });
  await assert.rejects(
    run("map_search", { query: "Metropol" }, { database, providers: failing }),
    (error) => {
      assert.equal(error.code, "map_search_failed");
      assert.match(error.message, /failed/);
      return true;
    },
  );
  assert.deepEqual(readGeographicContext(KEY, database).lastSearchPlaceIds, []);
});

test("an empty search says the location could not be found", async () => {
  const database = createDatabase();
  const outcome = await run("map_search", { query: "nowhere at all" }, {
    database,
    providers: providers(),
  });
  assert.equal(outcome.data.empty, true);
  assert.match(outcome.data.message, /couldn't find a matching location/i);
});

/* ------------------------------------------------------------------ */
/* 11. Missing details stay missing                                    */
/* ------------------------------------------------------------------ */

test("opening hours absent from OSM come back absent and named", async () => {
  const database = createDatabase();
  const details = nominatimPlaceToDetails(
    {
      osm_type: "way",
      osm_id: 123,
      lat: "40.9558",
      lon: "29.1206",
      name: "Metropol İstanbul",
      display_name: "Metropol İstanbul, Ataşehir, İstanbul",
      category: "shop",
      type: "mall",
      extratags: { website: "https://example.invalid" },
    },
    RETRIEVED_AT,
  );
  assert.equal(details.openingHours, undefined);
  assert.equal(details.website, "https://example.invalid");
  assert.ok(details.missingFields.includes("openingHours"));

  const outcome = await run(
    "map_place_details",
    { placeId: "osm:way:123" },
    { database, providers: providers({ details: { async details() { return details; } } }) },
  );
  assert.equal(outcome.data.openingHours, null);
  assert.ok(outcome.data.missingFields.includes("openingHours"));
  assert.match(outcome.data.message, /not recorded/);
});

test("a place with no record at all is reported as having none", async () => {
  const database = createDatabase();
  const outcome = await run(
    "map_place_details",
    { placeId: "osm:node:999999" },
    { database, providers: providers() },
  );
  assert.equal(outcome.data.empty, true);
  assert.match(outcome.data.message, /no record/);
});

/* ------------------------------------------------------------------ */
/* 12. Invalid arguments are rejected                                  */
/* ------------------------------------------------------------------ */

test("out-of-range coordinates never reach a provider", async () => {
  const database = createDatabase();
  let called = false;
  const watching = providers({
    reverseGeocoder: {
      async reverse() {
        called = true;
        return null;
      },
    },
  });
  for (const args of [
    { lat: 91, lon: 0 },
    { lat: -91, lon: 0 },
    { lat: 0, lon: 181 },
    { lat: 0, lon: -181 },
    { lat: Number.NaN, lon: 0 },
    { lat: "40.9", lon: 29.1 },
  ]) {
    await assert.rejects(
      run("map_reverse", args, { database, providers: watching }),
      (error) => error.code === "map_invalid_arguments",
    );
  }
  assert.equal(called, false);
});

test("bad modes, radii, limits and place ids are rejected", async () => {
  const database = createDatabase();
  recordSelectedPlace(KEY, METROPOL, database);
  const bad = [
    ["map_route", { origin: { reference: "selected" }, destination: { reference: "selected" }, mode: "teleport" }],
    ["map_nearby", { center: { reference: "selected" }, category: "cafe", radiusMeters: 1 }],
    ["map_nearby", { center: { reference: "selected" }, category: "cafe", radiusMeters: 999999 }],
    ["map_nearby", { center: { reference: "selected" }, category: "cafe", radiusMeters: 500, limit: 5000 }],
    ["map_place_details", { placeId: "../../etc/passwd" }],
    ["map_place_details", { placeId: "Metropol İstanbul" }],
    ["map_search", { query: "" }],
  ];
  for (const [operation, args] of bad) {
    await assert.rejects(
      run(operation, args, { database, providers: providers() }),
      (error) => error instanceof MapServiceError,
      `${operation} should have rejected ${JSON.stringify(args)}`,
    );
  }
});

test("a route cannot be asked for by name or by coordinate", async () => {
  const database = createDatabase();
  recordSelectedPlace(KEY, METROPOL, database);
  // The two shapes a model reaches for when it already "knows" where things are.
  for (const args of [
    { origin: { name: "Metropol İstanbul" }, destination: { name: "Mevlana" }, mode: "walking" },
    { origin: { lat: 40.9558, lon: 29.1206 }, destination: { lat: 40.9469, lon: 29.1224 }, mode: "walking" },
    { origin: "Metropol İstanbul", destination: "Mevlana", mode: "walking" },
  ]) {
    await assert.rejects(
      run("map_route", args, { database, providers: providers() }),
      (error) => error.code === "map_invalid_arguments",
      `map_route accepted ${JSON.stringify(args)}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 15. Prose does not move state                                       */
/* ------------------------------------------------------------------ */

test("nothing an agent can say edits a stored place", async () => {
  const database = createDatabase();
  await run("map_search", { query: "Metropol İstanbul" }, {
    database,
    providers: providers({ geocoder: { async search() { return [METROPOL]; } } }),
  });
  const before = readGeographicContext(KEY, database);

  // The only writes available are structured results. There is no operation
  // that takes a place description, and the one that takes coordinates returns
  // whatever the geocoder says is there rather than what the caller claimed.
  await assert.rejects(
    run(
      "map_place_details",
      { placeId: "osm:way:123", name: "Metropol İstanbul (actually in Ankara)" },
      { database, providers: providers() },
    ),
    (error) => error.code === "map_invalid_arguments",
  );

  const after = readGeographicContext(KEY, database);
  assert.deepEqual(after.places[METROPOL.id], before.places[METROPOL.id]);
  assert.equal(after.places[METROPOL.id].lat, 40.9558);
});

test("a reverse lookup reports the provider's answer, not the caller's", async () => {
  const database = createDatabase();
  const real = place("osm:node:12", "Küçükyalı Marmaray", 40.9469, 29.1224);
  const outcome = await run(
    "map_reverse",
    { lat: 40.9469, lon: 29.1224 },
    { database, providers: providers({ reverseGeocoder: { async reverse() { return real; } } }) },
  );
  assert.equal(outcome.data.place.id, "osm:node:12");
  assert.equal(outcome.data.place.name, "Küçükyalı Marmaray");
  assert.equal(readGeographicContext(KEY, database).selectedPlaceId, "osm:node:12");
});

/* ------------------------------------------------------------------ */
/* Provider translation                                                */
/* ------------------------------------------------------------------ */

test("categories become real OSM selectors, and an unknown one is refused", async () => {
  assert.deepEqual(findCategory("bowling").selectors, [
    '["leisure"="bowling_alley"]',
    '["sport"="10pin"]',
  ]);
  assert.equal(findCategory("teleport pads"), null);

  const query = buildOverpassQuery({
    center: { lat: 40.9558, lon: 29.1206 },
    selectors: findCategory("bowling").selectors,
    radiusMeters: 2000,
    timeoutSeconds: 25,
  });
  assert.match(query, /\[out:json\]\[timeout:25\]/);
  assert.match(query, /node\["leisure"="bowling_alley"\]\(around:2000,40\.9558,29\.1206\);/);
  assert.match(query, /relation\["sport"="10pin"\]\(around:2000,40\.9558,29\.1206\);/);
  assert.match(query, /out center tags;/);

  const database = createDatabase();
  recordSelectedPlace(KEY, METROPOL, database);
  await assert.rejects(
    run(
      "map_nearby",
      { center: { reference: "selected" }, category: "speakeasy", radiusMeters: 500 },
      { database, providers: providers() },
    ),
    (error) => error.code === "map_invalid_arguments",
  );
});

/** The reference encoder, so the decoder is checked against the real format. */
function encodePolyline(points, precision = 6) {
  const factor = 10 ** precision;
  let previousLat = 0;
  let previousLon = 0;
  let output = "";
  const chunk = (value) => {
    let remaining = value < 0 ? ~(value << 1) : value << 1;
    let encoded = "";
    while (remaining >= 0x20) {
      encoded += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
      remaining >>= 5;
    }
    return encoded + String.fromCharCode(remaining + 63);
  };
  for (const [lat, lon] of points) {
    const latitude = Math.round(lat * factor);
    const longitude = Math.round(lon * factor);
    output += chunk(latitude - previousLat) + chunk(longitude - previousLon);
    previousLat = latitude;
    previousLon = longitude;
  }
  return output;
}

test("encoded route shape decodes to the coordinates the router meant", () => {
  // Valhalla encodes shape at precision 6. Decoding it is a transport step: the
  // line MapLibre draws has to be the router's own vertices, not a resampling.
  const points = [
    [40.9469, 29.1224],
    [40.9502, 29.1215],
    [40.9558, 29.1206],
  ];
  const decoded = decodePolyline(encodePolyline(points, 6), 6);
  assert.equal(decoded.length, points.length);
  decoded.forEach(([lon, lat], index) => {
    assert.equal(lat.toFixed(6), points[index][0].toFixed(6));
    assert.equal(lon.toFixed(6), points[index][1].toFixed(6));
  });
  // Precision matters: reading a precision-6 shape at precision 5 would put the
  // route in the wrong hemisphere rather than fail loudly.
  const wrong = decodePolyline(encodePolyline(points, 6), 5);
  assert.notEqual(wrong[0][1].toFixed(3), points[0][0].toFixed(3));
});

test("formatting is derived from the verified number and nothing else", () => {
  assert.equal(formatDistance(1834), "1.8 km");
  assert.equal(formatDistance(420), "420 m");
  assert.equal(formatDuration(1372), "23 min");
  assert.equal(formatDuration(4500), "1 h 15 min");
});
