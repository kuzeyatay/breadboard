import test from "node:test";
import assert from "node:assert/strict";
import {
  FAMILIAR_ADDRESSEES, CREATIVE_ADDRESSEES, GREETING_WEATHER_MAX_AGE_MS,
  cachedGreetingWeather, greetingHour, locationAddressees, normalizeGreetingWeather,
  pickNewTabAddressee, timeAddressees, weatherAddressees,
} from "../src/app/new-tab/new-tab-greetings.ts";

const draws = (...values) => () => values.shift() ?? 0;
const location = { latitude: 52.37, longitude: 4.9, timeZone: "Europe/Amsterdam" };
const rain = { code: 61, temperatureC: 14, isDay: true };

test("the pool keeps familiar nicknames and frequently selects creative ones", () => {
  for (const name of ["sailor", "bub", "champ", "chief"]) assert.ok(FAMILIAR_ADDRESSEES.includes(name));
  assert.ok(CREATIVE_ADDRESSEES.length >= 40);
  assert.equal(pickNewTabAddressee({}, [], draws(0.1, 0)), "sailor");
  assert.equal(pickNewTabAddressee({}, [], draws(0.4, 0)), "cosmic gardener");
  // No available signals still produces a complete greeting.
  assert.ok(CREATIVE_ADDRESSEES.includes(pickNewTabAddressee({}, [], draws(0.9, 0))));
});

test("time-dependent names follow the active time zone, including midnight", () => {
  const now = new Date("2026-09-05T22:30:00Z");
  assert.equal(greetingHour(now, "Europe/Amsterdam"), 0);
  assert.equal(greetingHour(now, "America/New_York"), 18);
  assert.equal(pickNewTabAddressee({ hour: 0 }, [], draws(0.9, 0, 0)), "night owl");
  assert.equal(pickNewTabAddressee({ hour: 7 }, [], draws(0.9, 0, 0)), "early bird");
  for (const hour of [-1, 24, NaN, undefined]) assert.deepEqual(timeAddressees(hour), []);
  assert.equal(greetingHour(now, "invented/zone"), now.getHours());
});

test("contextual selection can use weather or location rather than time", () => {
  const context = { hour: 12, weather: rain, location };
  assert.equal(pickNewTabAddressee(context, [], draws(0.9, 0.5, 0)), "puddle skipper");
  assert.equal(pickNewTabAddressee(context, [], draws(0.9, 0.9, 0)), "canal captain");
  assert.ok(FAMILIAR_ADDRESSEES.includes(pickNewTabAddressee(context, [], draws(0.1, 0))));
});

test("weather distinguishes rain, fog, snow, storms, temperature and daylight", () => {
  const names = (code, temperatureC = 14, isDay = true) => weatherAddressees({ code, temperatureC, isDay });
  assert.ok(names(61).includes("puddle skipper"));
  assert.ok(names(45).includes("fog navigator"));
  assert.ok(names(85).includes("snow fox"));
  assert.ok(names(95).includes("storm watcher"));
  assert.ok(names(0, -2).includes("frost scout"));
  assert.ok(names(0, 32).includes("shade seeker"));
  assert.ok(names(0).includes("sunbeam"));
  assert.ok(names(0, 14, false).includes("stargazer"));
  assert.ok(!names(0, 14, false).includes("sunbeam"));
});

test("place-based nicknames use actual coordinates, never a time zone alone", () => {
  assert.ok(locationAddressees(location).includes("polder pilot"));
  assert.ok(!locationAddressees({ ...location, latitude: -40 }).includes("polder pilot"));
  assert.ok(locationAddressees({ ...location, latitude: -40 }).includes("southern star"));
  assert.ok(locationAddressees({ ...location, latitude: 0 }).includes("equator explorer"));
  assert.deepEqual(locationAddressees(null), []);
  assert.deepEqual(locationAddressees({ ...location, latitude: 91 }), []);
});

test("recent nicknames do not repeat, even when a contextual pool is exhausted", () => {
  let recent = [];
  for (let index = 0; index < 100; index++) {
    const next = pickNewTabAddressee({ hour: 18 }, recent, draws(0.9, 0, 0));
    assert.ok(!recent.includes(next));
    recent = [...recent, next].slice(-8);
  }
});

test("only fresh weather for the active location can affect a greeting", () => {
  const now = 1_000_000;
  const cached = { latitude: location.latitude, longitude: location.longitude, readAt: now - 1, weather: rain };
  assert.deepEqual(cachedGreetingWeather(cached, location, now), rain);
  assert.equal(cachedGreetingWeather(cached, null, now), null);
  assert.equal(cachedGreetingWeather(cached, { ...location, longitude: 5 }, now), null);
  assert.equal(cachedGreetingWeather({ ...cached, readAt: now - GREETING_WEATHER_MAX_AGE_MS }, location, now), null);
  assert.equal(cachedGreetingWeather({ ...cached, readAt: now + 1 }, location, now), null);
  for (const invalid of [null, {}, { ...rain, code: 999 }, { ...rain, temperatureC: NaN }, { ...rain, isDay: "yes" }]) {
    assert.equal(normalizeGreetingWeather(invalid), null);
  }
});
