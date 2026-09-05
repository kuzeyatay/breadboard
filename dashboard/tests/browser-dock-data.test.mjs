import assert from "node:assert/strict";
import test from "node:test";
import { batteryDuration, DEFAULT_CITY_IDS, finiteEstimate, normalizeCityIds, WORLD_CITIES, worldClock } from "../src/app/browser/browser-dock-data.ts";

test("world clocks account for the different US and European daylight-saving dates", () => {
  const beforeEuropeChanges = worldClock(new Date("2026-03-22T12:00:00Z"), "America/New_York", "Europe/Amsterdam");
  const afterEuropeChanges = worldClock(new Date("2026-03-29T12:00:00Z"), "America/New_York", "Europe/Amsterdam");
  assert.equal(beforeEuropeChanges.time, "08:00");
  assert.equal(beforeEuropeChanges.difference, "−5h");
  assert.equal(afterEuropeChanges.difference, "−6h");
});

test("world clocks handle date boundaries and quarter-hour offsets", () => {
  const tokyo = worldClock(new Date("2026-09-05T23:30:00Z"), "Asia/Tokyo", "America/New_York");
  assert.equal(tokyo.time, "08:30");
  assert.equal(tokyo.day, "Tomorrow");
  assert.equal(tokyo.daytime, true);
  assert.equal(worldClock(new Date("2026-09-05T00:00:00Z"), "Asia/Kathmandu", "UTC").difference, "+5h 45m");
  assert.equal(worldClock(new Date("2026-09-05T00:00:00Z"), "America/Los_Angeles", "UTC").day, "Yesterday");
});

test("all selectable city timezones are valid and coordinates are in range", () => {
  assert.equal(new Set(WORLD_CITIES.map((city) => city.id)).size, WORLD_CITIES.length);
  for (const city of WORLD_CITIES) {
    assert.doesNotThrow(() => worldClock(new Date("2026-09-05T12:00:00Z"), city.timezone, "UTC"));
    assert.ok(city.latitude >= -90 && city.latitude <= 90);
    assert.ok(city.longitude >= -180 && city.longitude <= 180);
  }
});

test("stored city selections tolerate malformed data, deduplicate, and keep an intentional empty list", () => {
  assert.deepEqual(normalizeCityIds(null), DEFAULT_CITY_IDS);
  assert.deepEqual(normalizeCityIds(["tokyo", "not-a-city", null, "tokyo", "london"]), ["tokyo", "london"]);
  assert.deepEqual(normalizeCityIds([]), []);
  assert.equal(normalizeCityIds(WORLD_CITIES.map((city) => city.id)).length, 8);
});

test("battery estimates never turn unknown or infinite readings into a duration", () => {
  for (const value of [undefined, Infinity, NaN, -1, "120"]) assert.equal(finiteEstimate(value), null);
  assert.equal(finiteEstimate(0), 0);
  assert.equal(batteryDuration(null), "Not available");
  assert.equal(batteryDuration(Infinity), "Not available");
  assert.equal(batteryDuration(0), "Not available");
  assert.equal(batteryDuration(5), "1m");
  assert.equal(batteryDuration(5400), "1h 30m");
});
