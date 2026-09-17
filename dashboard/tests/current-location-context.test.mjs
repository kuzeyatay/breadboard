import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CURRENT_LOCATION_MAX_AGE_MS,
  normalizeCurrentLocationSnapshot,
} from "../src/lib/current-location.ts";
import {
  parseCurrentLocationPayload,
  renderCurrentLocationContext,
  requestUsesCurrentLocation,
} from "../src/lib/hermes/current-location-context.ts";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

function location(overrides = {}) {
  return {
    latitude: 41.008237,
    longitude: 28.978359,
    capturedAt: "2026-08-11T11:58:14.000Z",
    accuracyMeters: 82.6,
    timeZone: "Europe/Istanbul",
    ...overrides,
  };
}

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("the route parser shares validation, coarse rounding, and freshness rules", () => {
  assert.deepEqual(parseCurrentLocationPayload(location(), NOW), {
    latitude: 41.01,
    longitude: 28.98,
    capturedAt: "2026-08-11T11:58:14.000Z",
    accuracyMeters: 83,
    timeZone: "Europe/Istanbul",
  });

  assert.equal(
    parseCurrentLocationPayload(
      location({
        capturedAt: new Date(NOW - CURRENT_LOCATION_MAX_AGE_MS - 1).toISOString(),
      }),
      NOW,
    ),
    null,
  );
  assert.equal(parseCurrentLocationPayload(location({ latitude: 91 }), NOW), null);
  assert.equal(
    parseCurrentLocationPayload(location({ timeZone: "Invalid/Somewhere" }), NOW),
    null,
  );

  const normalized = normalizeCurrentLocationSnapshot(location(), NOW);
  assert.ok(normalized);
  assert.equal(normalized.latitude, 41.01);
  assert.equal(normalized.longitude, 28.98);
});

test("enabled location is available for every turn regardless of topic or language", () => {
  for (const request of [
    "What are the best museums near me?",
    "What's the weather?",
    "Recommend a good restaurant",
    "Find a coffee shop within walking distance",
    "How long is the commute from here?",
    "Is there a Bluetooth trackpad I can buy?",
    "Recommend a laptop for video editing",
    "where can i buy these tests",
    "Explain how museum curation works",
    "Summarize this document",
    "What else?",
    "And those?",
    "Waar kan ik dit krijgen?",
    "これをどこで入手できますか？",
    "👍",
  ]) {
    assert.equal(requestUsesCurrentLocation(request), true, request);
    assert.match(renderCurrentLocationContext({ request, location: location(), now: NOW }), /# approximate_current_location/);
  }
  assert.equal(requestUsesCurrentLocation("  "), false);
});

test("location remains available across topic changes and short follow-ups", () => {
  for (const request of [
    "Yakınımda ilginç müzeler var mı?",
    "Bana yakın iyi restoran öner",
    "Hava nasıl?",
    "Buradan ulaşım süresi ne kadar?",
  ]) {
    assert.equal(requestUsesCurrentLocation(request), true, request);
  }

  assert.equal(
    requestUsesCurrentLocation("What else?", [
      "Recommend a good restaurant near me",
    ]),
    true,
  );
  assert.equal(
    requestUsesCurrentLocation("Başka ne var?", [
      "Yakınımda ilginç müzeler var mı?",
    ]),
    true,
  );
  assert.equal(
    requestUsesCurrentLocation("What else?", [
      "Recommend a restaurant near me",
      "Explain binary trees",
    ]),
    true,
    "context availability no longer depends on classifying earlier messages",
  );
});

test("explicit location opt-outs override otherwise local requests", () => {
  for (const request of [
    "Recommend restaurants without using my location",
    "Do not use my current location for the weather",
    "Konumumu kullanmadan restoran öner",
    "Konumumu yok say, hava nasıl?",
  ]) {
    assert.equal(requestUsesCurrentLocation(request), false, request);
  }

  assert.equal(
    requestUsesCurrentLocation("What else without using my location?", [
      "Recommend a restaurant near me",
    ]),
    false,
  );
});

test("the rendered hint keeps the detected area, coarse coordinates, and freshness", () => {
  const rendered = renderCurrentLocationContext({
    request: "What are the best museums near me?",
    location: location({ label: "Istanbul, Türkiye" }),
    now: NOW,
  });
  assert.match(rendered, /# approximate_current_location/);
  assert.match(rendered, /Approximate coordinates: 41\.01, 28\.98\./);
  assert.doesNotMatch(rendered, /41\.008237|28\.978359/);
  assert.match(rendered, /Captured at: 2026-08-11T11:58:14\.000Z\./);
  assert.match(rendered, /Device time zone: Europe\/Istanbul\./);
  assert.match(rendered, /Approximate area .*"Istanbul, Türkiye"/);
  assert.match(rendered, /substitute a default country/);
  assert.match(rendered, /earlier assistant assumption/);
  assert.match(rendered, /A place the user names explicitly always wins/);
  assert.match(rendered, /Do not infer a home, residence, identity, or exact position/);

  assert.match(
    renderCurrentLocationContext({
      request: "Explain how video codecs work",
      location: location(),
      now: NOW,
    }),
    /# approximate_current_location/,
  );
  assert.equal(
    renderCurrentLocationContext({
      request: "Recommend restaurants without using my location",
      location: location(),
      now: NOW,
    }),
    "",
  );
  assert.equal(
    renderCurrentLocationContext({
      request: "What's the weather?",
      location: location({
        capturedAt: new Date(NOW - CURRENT_LOCATION_MAX_AGE_MS - 1).toISOString(),
      }),
      now: NOW,
    }),
    "",
  );
});

test("the detected country follows the fix even when the time zone differs", () => {
  for (const fix of [
    { latitude: 52.37, longitude: 4.90, label: "Amsterdam, Netherlands" },
    { latitude: 35.68, longitude: 139.69, label: "Tokyo, Japan" },
    { latitude: -33.87, longitude: 151.21, label: "Sydney, Australia" },
  ]) {
    const rendered = renderCurrentLocationContext({
      request: "And those?",
      location: location({ ...fix, timeZone: "Europe/London" }),
      now: NOW,
    });
    assert.ok(rendered.includes(JSON.stringify(fix.label)));
    assert.ok(rendered.includes(`${fix.latitude.toFixed(2)}, ${fix.longitude.toFixed(2)}`));
    assert.doesNotMatch(rendered, /United Kingdom|Istanbul/);
  }
  assert.equal(renderCurrentLocationContext({ request: "And those?", now: NOW }), "");
});

test("both message routes independently parse the untrusted location payload", () => {
  const agentRoute = source(
    "../src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
  );
  const directRoute = source(
    "../src/app/api/hermes/sessions/[sessionId]/direct/route.ts",
  );

  for (const route of [agentRoute, directRoute]) {
    assert.match(
      route,
      /parseCurrentLocationPayload\(body\.currentLocation\) \?\? undefined/,
    );
  }
  assert.match(agentRoute, /currentLocation:[\s\S]{0,100}?parseCurrentLocationPayload/);
  assert.match(directRoute, /currentLocation:[\s\S]{0,100}?parseCurrentLocationPayload/);
});

test("both chat transports share location preparation after the turn can be stopped", () => {
  const client = source("../src/app/components/hermes/use-agent-session.ts");
  assert.match(
    client,
    /const currentLocation = options\?\.internalAgentContinuation !== true\s*\? await getCurrentLocationForTurn\(trimmed\)\s*: undefined;\s*if \(turnWasStopped\(\)\) return;/,
  );
  assert.doesNotMatch(client, /priorLocationRequests|requestUsesCurrentLocation/);
  assert.match(
    client,
    /streamDirectTurn\(\{[\s\S]{0,800}?currentLocation,/,
  );
  const agentRequest = client.indexOf(
    "/api/hermes/sessions/${activeSessionId}/messages",
  );
  const agentLocation = client.indexOf("currentLocation,", agentRequest);
  assert.ok(agentRequest >= 0 && agentLocation > agentRequest);
  assert.ok(agentLocation - agentRequest < 3_000);

  const directRequest = client.indexOf(
    "/api/hermes/sessions/${input.sessionId}/direct",
  );
  const directLocation = client.indexOf(
    "currentLocation: input.currentLocation",
    directRequest,
  );
  assert.ok(directRequest >= 0 && directLocation > directRequest);
  assert.ok(directLocation - directRequest < 1_000);
});

test("agent turns persist the base prompt but run with the ephemeral location prompt", () => {
  const turns = source("../src/lib/conversations/turn-service.ts");
  const begin = turns.indexOf("const run = beginRuntimeRun({");
  const dispatch = turns.indexOf("const dispatch = async", begin);
  const startRun = turns.indexOf(".startRun({", dispatch);
  assert.ok(begin >= 0 && dispatch > begin && startRun > dispatch);

  const persistedRun = turns.slice(begin, dispatch);
  assert.match(persistedRun, /system: baseSystem/);
  assert.doesNotMatch(persistedRun, /system: runtimeSystem/);

  const liveDispatch = turns.slice(startRun, startRun + 1_500);
  assert.match(liveDispatch, /system: runtimeSystem/);
  assert.match(
    turns,
    /const runtimeSystem = \[baseSystem, currentLocationContext, browserContext\]/,
  );
});

test("direct-provider turns render device location into their non-persisted prompt", () => {
  const direct = source("../src/lib/conversations/direct-turn-service.ts");
  assert.match(
    direct,
    /instructions: directSystemPrompt\([\s\S]{0,900}?renderCurrentLocationContext\(\{[\s\S]{0,350}?request: requestText[\s\S]{0,350}?location: input\.currentLocation/,
  );
  assert.match(
    direct,
    /currentLocationContext,[\s\S]{0,240}?readerComprehensionPrompt\(\),[\s\S]{0,80}?\.filter\(Boolean\)/,
  );
  assert.match(direct, /store: false/);
  assert.match(
    direct,
    /input\.internalAgentContinuation[\s\S]{0,120}?\? ""[\s\S]{0,120}?: renderCurrentLocationContext/,
  );
});
