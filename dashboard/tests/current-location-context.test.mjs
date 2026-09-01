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
  requestUsesShoppingLocation,
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

test("English requests use current location only for local decisions", () => {
  for (const request of [
    "What are the best museums near me?",
    "What's the weather?",
    "Recommend a good restaurant",
    "Find a coffee shop within walking distance",
    "How long is the commute from here?",
    "Is there a Bluetooth trackpad I can buy?",
    "Recommend a laptop for video editing",
  ]) {
    assert.equal(requestUsesCurrentLocation(request), true, request);
  }

  for (const request of [
    "Explain how museum curation works",
    "Summarize this document",
    "What else?",
  ]) {
    assert.equal(requestUsesCurrentLocation(request), false, request);
  }
});

test("shopping requests use current location as a country-level market", () => {
  for (const request of [
    "Is there a Bluetooth trackpad I can buy?",
    "Recommend a laptop for video editing",
    "Welke draadloze muis kan ik kopen?",
  ]) {
    assert.equal(requestUsesShoppingLocation(request), true, request);
  }
  assert.equal(requestUsesShoppingLocation("Explain how a trackpad works"), false);
  assert.equal(
    requestUsesShoppingLocation("What else?", ["Recommend a laptop"]),
    true,
  );
  assert.equal(
    requestUsesShoppingLocation(
      "Recommend a laptop without using my location",
    ),
    false,
  );
});

test("Turkish requests and bounded local follow-ups use current location", () => {
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
    false,
    "an unrelated intervening request ends the local thread",
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

test("the rendered hint is ephemeral, coarse, and limited to relevant fresh turns", () => {
  const rendered = renderCurrentLocationContext({
    request: "What are the best museums near me?",
    location: location(),
    now: NOW,
  });
  assert.match(rendered, /# approximate_current_location/);
  assert.match(rendered, /Approximate coordinates: 41\.01, 28\.98\./);
  assert.doesNotMatch(rendered, /41\.008237|28\.978359/);
  assert.match(rendered, /Captured at: 2026-08-11T11:58:14\.000Z\./);
  assert.match(rendered, /Device time zone: Europe\/Istanbul\./);
  assert.match(rendered, /A place the user names explicitly always wins/);
  assert.match(rendered, /Do not infer a home, residence, identity, or exact position/);

  assert.equal(
    renderCurrentLocationContext({
      request: "Explain how video codecs work",
      location: location(),
      now: NOW,
    }),
    "",
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

test("the browser attaches a fresh opted-in fix only after local-intent classification", () => {
  const client = source("../src/app/components/hermes/use-agent-session.ts");
  assert.match(
    client,
    /const currentLocation =[\s\S]{0,700}?locationPreference\.useForAnswers[\s\S]{0,300}?locationPreference\.state === "available"[\s\S]{0,300}?requestUsesCurrentLocation\(trimmed, priorLocationRequests\)/,
  );
  assert.match(
    client,
    /streamDirectTurn\(\{[\s\S]{0,400}?currentLocation,/,
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
    /const runtimeSystem = currentLocationContext[\s\S]{0,160}?baseSystem[\s\S]{0,160}?currentLocationContext/,
  );
});

test("direct-provider turns render relevant location into their non-persisted prompt", () => {
  const direct = source("../src/lib/conversations/direct-turn-service.ts");
  assert.match(
    direct,
    /instructions: directSystemPrompt\([\s\S]{0,900}?renderCurrentLocationContext\(\{[\s\S]{0,350}?request: input\.text[\s\S]{0,350}?location: input\.currentLocation/,
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
