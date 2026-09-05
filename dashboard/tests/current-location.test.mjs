import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_LOCATION_CHANGE_EVENT,
  CURRENT_LOCATION_MAX_AGE_MS,
  CURRENT_LOCATION_STORAGE_KEY,
  announceCurrentLocationChange,
  clearStoredCurrentLocationPreference,
  getStoredCurrentLocationPreference,
  isCurrentLocationFresh,
  normalizeCurrentLocationSnapshot,
  subscribeCurrentLocation,
  writeStoredCurrentLocationPreference,
} from "../src/lib/current-location.ts";

function memoryStorage(initial = new Map()) {
  const values = new Map(initial);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

const now = new Date("2026-08-11T12:00:00.000Z");

test("current location uses a separate device-local snapshot and a 24 hour lifetime", () => {
  assert.equal(CURRENT_LOCATION_STORAGE_KEY, "breadboard:current-location");
  assert.equal(CURRENT_LOCATION_CHANGE_EVENT, "breadboard:current-location-change");
  assert.equal(CURRENT_LOCATION_MAX_AGE_MS, 24 * 60 * 60 * 1_000);
});

test("an untrusted fix is validated and reduced to two-decimal coordinates", () => {
  assert.deepEqual(
    normalizeCurrentLocationSnapshot(
      {
        latitude: 41.008237,
        longitude: 28.978359,
        capturedAt: "2026-08-11T11:58:14Z",
        accuracyMeters: 82.6,
        timeZone: "Europe/Istanbul",
      },
      now,
    ),
    {
      latitude: 41.01,
      longitude: 28.98,
      capturedAt: "2026-08-11T11:58:14.000Z",
      accuracyMeters: 83,
      timeZone: "Europe/Istanbul",
    },
  );
});

test("invalid coordinates, capture metadata and time zones are rejected", () => {
  const valid = {
    latitude: 41,
    longitude: 29,
    capturedAt: now.toISOString(),
    accuracyMeters: 100,
    timeZone: "Europe/Istanbul",
  };
  for (const patch of [
    { latitude: 91 },
    { longitude: -181 },
    { latitude: Number.NaN },
    { accuracyMeters: -1 },
    { accuracyMeters: 100_001 },
    { accuracyMeters: Number.POSITIVE_INFINITY },
    { capturedAt: "not-a-date" },
    { capturedAt: "2026-08-11T12:06:00.000Z" },
    { timeZone: "Middle/Nowhere" },
    { timeZone: "<script>" },
  ]) {
    assert.equal(
      normalizeCurrentLocationSnapshot({ ...valid, ...patch }, now),
      null,
      JSON.stringify(patch),
    );
  }
});

test("freshness includes the 24 hour boundary and rejects older or future fixes", () => {
  const snapshot = normalizeCurrentLocationSnapshot(
    {
      latitude: 41,
      longitude: 29,
      capturedAt: now.toISOString(),
      accuracyMeters: 100,
      timeZone: "UTC",
    },
    now,
  );
  assert.ok(snapshot);
  assert.equal(
    isCurrentLocationFresh(snapshot, now.getTime() + CURRENT_LOCATION_MAX_AGE_MS),
    true,
  );
  assert.equal(
    isCurrentLocationFresh(snapshot, now.getTime() + CURRENT_LOCATION_MAX_AGE_MS + 1),
    false,
  );
  assert.equal(
    isCurrentLocationFresh(
      { ...snapshot, capturedAt: "2026-08-11T12:06:00.000Z" },
      now,
    ),
    false,
  );
});

test("the stored answer consent is independent from whether a fix is available", () => {
  const storage = memoryStorage();
  assert.deepEqual(getStoredCurrentLocationPreference(storage, now), {
    useForAnswers: false,
    snapshot: null,
    state: "off",
  });

  assert.deepEqual(
    writeStoredCurrentLocationPreference(
      storage,
      { useForAnswers: true, snapshot: null },
      now,
    ),
    { useForAnswers: true, snapshot: null, state: "unavailable" },
  );

  const snapshot = {
    latitude: 41.008,
    longitude: 28.978,
    capturedAt: now.toISOString(),
    accuracyMeters: 120.4,
    timeZone: "Europe/Istanbul",
  };
  assert.equal(
    writeStoredCurrentLocationPreference(
      storage,
      { useForAnswers: true, snapshot },
      now,
    ).state,
    "available",
  );
  const raw = JSON.parse(storage.getItem(CURRENT_LOCATION_STORAGE_KEY));
  assert.equal(raw.snapshot.latitude, 41.01);
  assert.equal(raw.snapshot.longitude, 28.98);

  const stale = getStoredCurrentLocationPreference(
    storage,
    now.getTime() + CURRENT_LOCATION_MAX_AGE_MS + 1,
  );
  assert.equal(stale.useForAnswers, true);
  assert.equal(stale.state, "stale");
  assert.ok(stale.snapshot, "a stale fix remains visible so the profile can offer Refresh");

  assert.deepEqual(clearStoredCurrentLocationPreference(storage), {
    useForAnswers: false,
    snapshot: null,
    state: "off",
  });
  assert.equal(storage.getItem(CURRENT_LOCATION_STORAGE_KEY), null);
});

test("corrupt or unavailable storage fails closed and event helpers are server-safe", () => {
  assert.equal(
    getStoredCurrentLocationPreference({ getItem: () => "{" }, now).state,
    "off",
  );
  assert.equal(
    getStoredCurrentLocationPreference({
      getItem() {
        throw new Error("storage disabled");
      },
    }, now).state,
    "off",
  );
  assert.doesNotThrow(() => announceCurrentLocationChange());
  const unsubscribe = subscribeCurrentLocation(() => undefined);
  assert.equal(typeof unsubscribe, "function");
  assert.doesNotThrow(unsubscribe);
});
