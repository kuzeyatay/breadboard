import assert from "node:assert/strict";
import test from "node:test";

import { currentLocationLabel } from "../src/lib/current-location-label.ts";

function place(overrides = {}) {
  return {
    id: "osm:relation:1",
    name: "Westminster",
    displayName: "Westminster, Greater London, England, United Kingdom",
    lat: 51.5,
    lon: -0.12,
    source: "openstreetmap",
    provenance: { provider: "OpenStreetMap/Nominatim", retrievedAt: new Date(0).toISOString() },
    ...overrides,
  };
}

test("current location uses the minimal city and country format", () => {
  assert.equal(
    currentLocationLabel(place({ address: { city: "London", country: "United Kingdom" } })),
    "London, United Kingdom",
  );
});

test("current location falls back through district, state, and place name", () => {
  assert.equal(
    currentLocationLabel(place({ address: { district: "South Lakeland", country: "United Kingdom" } })),
    "South Lakeland, United Kingdom",
  );
  assert.equal(
    currentLocationLabel(place({ name: "Singapore", address: { country: "Singapore" } })),
    "Singapore",
  );
  assert.equal(currentLocationLabel(null), null);
});
