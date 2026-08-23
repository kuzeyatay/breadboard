import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_WALKING_MAX_DISTANCE_METERS,
  automaticTravelMode,
  automaticWalkingRouteIsTooLong,
} from "../src/lib/map/travel-mode.ts";
import { mapRouteArgsSchema } from "../src/lib/map/schemas.ts";

const origin = { lat: 41.0082, lon: 28.9784 };

test("automatic routes walk nearby and drive farther away", () => {
  assert.equal(
    automaticTravelMode(origin, { lat: 41.0182, lon: 28.9784 }),
    "walking",
  );
  assert.equal(
    automaticTravelMode(origin, { lat: 41.1082, lon: 28.9784 }),
    "driving",
  );
});

test("map routes default to automatic mode", () => {
  const parsed = mapRouteArgsSchema.parse({
    origin: { reference: "current_location" },
    destination: { reference: "selected" },
  });
  assert.equal(parsed.mode, "auto");
});

test("an unexpectedly long walking result is retried as driving only in Auto", () => {
  const route = {
    mode: "walking",
    distanceMeters: AUTO_WALKING_MAX_DISTANCE_METERS + 1,
  };
  assert.equal(automaticWalkingRouteIsTooLong("auto", route), true);
  assert.equal(automaticWalkingRouteIsTooLong("walking", route), false);
});
