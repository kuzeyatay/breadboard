import assert from "node:assert/strict";
import test from "node:test";
import { readPageAppearance, writePageAppearance, pageAppearanceKey } from "../src/lib/page-appearance.ts";
import { readLocalWeatherCode, localRainIntensity, LOCAL_WEATHER_READING_KEY, LOCAL_WEATHER_RETAIN_MS } from "../src/lib/local-weather-reading.ts";
import { CURRENT_LOCATION_STORAGE_KEY } from "../src/lib/current-location.ts";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("rain is independent of the background, light/dark mode and account", () => {
  const store = storage();
  const save = patch => writePageAppearance(store, "me", "new-tab", patch);
  save({background: {theme: "light", value: "spotify-random-colors"}});
  save({rain: {theme: "light", mode: "weather"}});
  save({rain: {theme: "dark", mode: "on"}});
  assert.deepEqual(readPageAppearance(store, "me", "new-tab"), {
    backgrounds: {light: "spotify-random-colors", dark: "none"}, rain: {light: "weather", dark: "on"},
  });
  save({background: {theme: "light", value: "alpine-dawn"}});
  assert.equal(readPageAppearance(store, "me", "new-tab").rain.light, "weather");
  save({rain: {theme: "light", mode: "off"}});
  assert.deepEqual(readPageAppearance(store, "me", "new-tab").rain, {dark: "on"});
  assert.equal(readPageAppearance(store, "other", "new-tab").rain, undefined);
  store.setItem(pageAppearanceKey("me", "browser"), JSON.stringify({rain: {light: "bad", dark: true}}));
  assert.equal(readPageAppearance(store, "me", "browser").rain, undefined);
});

test("weather rain follows precipitation codes, never clouds, fog, snow or unknown readings", () => {
  for (const code of [0, 1, 2, 3, 45, 48, 71, 73, 75, 77, 85, 86, -1, 999, "off", "waiting"]) assert.equal(localRainIntensity(code), "none");
  for (const code of [51, 53, 55, 56, 57, 61, 80]) assert.equal(localRainIntensity(code), "light");
  for (const code of [63, 66, 81]) assert.equal(localRainIntensity(code), "steady");
  for (const code of [65, 67, 82, 95, 96, 99]) assert.equal(localRainIntensity(code), "heavy");
});

test("weather effects reject expired readings, another location and disabled location sharing", () => {
  const store = storage();
  const now = Date.now();
  const location = {useForAnswers: true, snapshot: {latitude: 52, longitude: 5, accuracyMeters: 100, timeZone: "Europe/Amsterdam", capturedAt: new Date(now).toISOString()}};
  const reading = {locationKey: "52,5", code: 63, at: now};
  store.setItem(CURRENT_LOCATION_STORAGE_KEY, JSON.stringify(location));
  store.setItem(LOCAL_WEATHER_READING_KEY, JSON.stringify(reading));
  assert.equal(readLocalWeatherCode(store, now), 63);
  assert.equal(readLocalWeatherCode(store, now + LOCAL_WEATHER_RETAIN_MS), "waiting");
  assert.equal(readLocalWeatherCode(store, now - 1), "waiting");
  store.setItem(LOCAL_WEATHER_READING_KEY, JSON.stringify({...reading, locationKey: "53,5"}));
  assert.equal(readLocalWeatherCode(store, now), "waiting");
  store.setItem(CURRENT_LOCATION_STORAGE_KEY, JSON.stringify({...location, useForAnswers: false}));
  assert.equal(readLocalWeatherCode(store, now), "off");
});
