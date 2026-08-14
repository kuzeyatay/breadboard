// Grounding enforcement that does not depend on the model complying.
//
// Two layers are exercised here. The request-side classifier decides, before a
// turn is dispatched, whether the answer will need verified map data — and does
// it structurally, so "what is a roundabout?" is left alone while "is there a
// roundabout outside Metropol İstanbul?" is not. The answer-side check then
// reads the finished text against the evidence the turn actually produced, and
// reports a geographic assertion with nothing behind it.

import assert from "node:assert/strict";
import test from "node:test";

import {
  assessGeographicGrounding,
  isMapTool,
  MAP_FACT_TOOL_NAMES,
  renderGeographicGroundingDirective,
  requiresGeographicGrounding,
  requiresGeographicGroundingInContext,
} from "../src/lib/map/grounding.ts";
import {
  assessVerification,
  activityLabelForTool,
  evidenceKindForTool,
} from "../src/lib/hermes/evidence.ts";

const evidence = (overrides = {}) => ({
  id: "e1",
  kind: "map",
  title: "map_route",
  success: true,
  timestamp: "2026-08-11T09:00:00.000Z",
  details: { toolName: "map_route" },
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* Request-side classification                                         */
/* ------------------------------------------------------------------ */

test("questions about particular places require map data", () => {
  const required = [
    "Where is Metropol İstanbul?",
    "How far is Küçükyalı Marmaray from Metropol İstanbul?",
    "How long does it take to walk from Küçükyalı Marmaray to Metropol İstanbul?",
    "Take me to Metropol İstanbul.",
    "Is Kadıköy close to Üsküdar?",
    "What's the nearest pharmacy?",
    "Where is the nearest McDonald's?",
    "What's this place's address?",
    "Find bowling places near Metropol İstanbul.",
    "Is there a roundabout outside Metropol İstanbul?",
    "What time does the Pera Museum open?",
    "Which route is faster, via Bağdat Caddesi or the coast road?",
  ];
  for (const request of required) {
    const verdict = requiresGeographicGrounding(request);
    assert.equal(verdict.required, true, `should require grounding: ${request}`);
    assert.ok(verdict.asks.length > 0, `should name an ask: ${request}`);
  }
});

test("geography as a subject, rather than a place, needs no map call", () => {
  const notRequired = [
    "What is a roundabout?",
    "Explain how a roundabout works.",
    "Why do cities grow around rivers?",
    "What does 'cul-de-sac' mean?",
    "Write a short story about a walk to the lighthouse.",
    "Refactor the distance helper in src/lib/map/format.ts.",
    "Summarize this document.",
    "How does GPS trilateration work?",
    "Deep Research found comprehension declining at around 250 words per minute in Acklin and Papesh.",
  ];
  for (const request of notRequired) {
    const verdict = requiresGeographicGrounding(request);
    assert.equal(verdict.required, false, `should not require grounding: ${request}`);
  }
});

test("around still identifies an actual place lookup", () => {
  for (const request of [
    "What is around Eindhoven?",
    "Find cafes around Strijp-S.",
    "Show me pharmacies around Kadikoy.",
  ]) {
    assert.equal(
      requiresGeographicGrounding(request).required,
      true,
      `should require grounding: ${request}`,
    );
  }
});

test("a bare intent with nothing to aim at is not over-classified", () => {
  // "How long does it take?" on its own has no referent, and Breadboard holds
  // no place — so the classifier does not manufacture an obligation.
  assert.equal(requiresGeographicGrounding("How long does it take?").required, false);
  assert.equal(requiresGeographicGrounding("Is it far?").required, false);
});

test("structured state supplies the referent a sentence leaves out", () => {
  const request = "How long would it take to walk there?";
  assert.equal(requiresGeographicGrounding(request).required, true, "'there' is a referent");

  const followUp = "And how long by car?";
  assert.equal(requiresGeographicGrounding(followUp).required, false);
  assert.equal(
    requiresGeographicGroundingInContext(followUp, {
      selectedPlaceId: "osm:way:123",
      activeRoute: undefined,
    }).required,
    true,
    "a selected place makes the same follow-up a geographic question",
  );
});

test("an explicit opt-out is honoured", () => {
  const verdict = requiresGeographicGrounding(
    "Without using the map, roughly how far is Ankara from İstanbul?",
  );
  assert.equal(verdict.required, false);
  assert.match(verdict.reason, /opted out/);
});

test("the directive names the obligation only when there is one", () => {
  assert.equal(renderGeographicGroundingDirective({ required: false, asks: [], reason: "x" }), "");
  const directive = renderGeographicGroundingDirective(
    requiresGeographicGrounding("How far is Metropol İstanbul from Küçükyalı?"),
  );
  assert.match(directive, /^# geographic_grounding_required/);
  assert.match(directive, /could not be verified/);
  assert.match(directive, /do not pass names or coordinates/);
});

/* ------------------------------------------------------------------ */
/* Answer-side enforcement                                             */
/* ------------------------------------------------------------------ */

test("a travel time with no routing result behind it is reported", () => {
  const verdict = assessGeographicGrounding({
    groundingRequired: true,
    answer: "It's about 1.8 km, roughly 23 minutes on foot.",
    successfulMapFactTools: [],
  });
  assert.equal(verdict.satisfied, false);
  assert.ok(verdict.unsupportedClaims.some((claim) => /Travel-time/.test(claim)));
  assert.ok(verdict.unsupportedClaims.some((claim) => /Distance/.test(claim)));
});

test("the same answer with a routing result behind it is clean", () => {
  const verdict = assessGeographicGrounding({
    groundingRequired: true,
    answer: "It's about 1.8 km, roughly 23 minutes on foot.",
    successfulMapFactTools: ["map_search", "map_route"],
  });
  assert.equal(verdict.satisfied, true);
  assert.deepEqual(verdict.unsupportedClaims, []);
});

test("a required turn with no map result at all is still ungrounded", () => {
  // Even a hedged answer: the obligation was decided from the request, so an
  // answer cannot escape it by being vague.
  const verdict = assessGeographicGrounding({
    groundingRequired: true,
    answer: "I believe the two are fairly close together.",
    successfulMapFactTools: [],
  });
  assert.equal(verdict.satisfied, false);
  assert.equal(verdict.unsupportedClaims.length, 1);
  assert.match(verdict.unsupportedClaims[0], /needed verified map data/);
});

test("a state read is not a geographic fact", () => {
  // map_get_viewport says what the screen shows; it verifies nothing about the
  // world, so it cannot stand in for a search or a route.
  const verdict = assessGeographicGrounding({
    groundingRequired: true,
    answer: "The nearest pharmacy is on Bağdat Caddesi.",
    successfulMapFactTools: ["map_get_viewport", "map_get_selected_place"],
  });
  assert.equal(verdict.satisfied, false);
  assert.ok(verdict.unsupportedClaims.length > 0);
  for (const tool of ["map_get_viewport", "map_get_selected_place", "map_get_current_location"]) {
    assert.ok(isMapTool(tool));
    assert.ok(!MAP_FACT_TOOL_NAMES.includes(tool), `${tool} must not count as a fact source`);
  }
});

/* ------------------------------------------------------------------ */
/* The verification summary the UI shows                               */
/* ------------------------------------------------------------------ */

test("map tools are their own evidence class", () => {
  for (const tool of [
    "map_search",
    "map_route",
    "map_nearby",
    "map_reverse",
    "map_place_details",
  ]) {
    assert.equal(evidenceKindForTool(tool), "map", tool);
  }
  assert.equal(activityLabelForTool("map_route"), "Checking the map");
  // A shell command must never pass for a verified geographic fact.
  assert.notEqual(evidenceKindForTool("bash"), "map");
});

test("an invented opening time is contradicted, a verified one is not", () => {
  const invented = assessVerification("The museum opens at 09:00 every day.", []);
  assert.equal(invented.state, "contradicted");
  assert.ok(invented.unsupportedClaims.some((claim) => /Opening-hours/.test(claim)));

  const verified = assessVerification("The museum opens at 09:00 every day.", [
    evidence({ title: "map_place_details" }),
  ]);
  assert.deepEqual(verified.unsupportedClaims, []);
  assert.equal(verified.state, "verified");
});

test("a required geographic turn with no map evidence cannot read as verified", () => {
  const summary = assessVerification(
    "They're quite close — you can walk it easily.",
    [{ ...evidence({ kind: "web_search", id: "w1", title: "websearch" }) }],
    { geographicGroundingRequired: true },
  );
  assert.equal(summary.state, "contradicted");
  assert.match(summary.unsupportedClaims[0], /needed verified map data/);
});

test("a coordinate stated without a lookup is reported", () => {
  const summary = assessVerification(
    "Metropol İstanbul is at latitude 40.9558, longitude 29.1206.",
    [],
  );
  assert.ok(summary.unsupportedClaims.some((claim) => /Coordinate/.test(claim)));
});

test("ordinary answers are untouched by the geographic rules", () => {
  const summary = assessVerification(
    "A roundabout is a circular junction where traffic yields on entry.",
    [],
  );
  assert.deepEqual(summary.unsupportedClaims, []);
  assert.equal(summary.state, "not_applicable");
});
