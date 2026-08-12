import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RECALL_SETTINGS,
  MAX_EXCLUDED_WINDOWS,
  applyRecallSettingsPatch,
  isExcluded,
  matchesExcludedWindow,
  normalizeExcludedWindows,
  recallAutoStartDecision,
  shapeSearchResults,
  truncateCapturedText,
} from "../src/lib/recall/policy.ts";

test("capture is opt-in: the default settings record nothing", () => {
  assert.equal(DEFAULT_RECALL_SETTINGS.captureEnabled, false);
  assert.deepEqual(DEFAULT_RECALL_SETTINGS.excludedWindows, []);
  // The agent may read history, but only history that capture actually made.
  assert.equal(DEFAULT_RECALL_SETTINGS.agentAccess, true);
  // Starting or stopping the recorder always asks first out of the box.
  assert.equal(DEFAULT_RECALL_SETTINGS.agentControl, "ask");
  // And nothing records unattended until asked for separately.
  assert.equal(DEFAULT_RECALL_SETTINGS.autoStartCapture, false);
});

const READY_TO_AUTO_START = {
  featureEnabled: true,
  settings: { autoStartCapture: true, captureEnabled: true },
  engineRunning: false,
  installed: true,
};

test("opening Breadboard starts capture only after both opt-ins", () => {
  assert.equal(recallAutoStartDecision(READY_TO_AUTO_START), "start");

  // Allowing capture is not the same as asking for it to begin on its own.
  assert.equal(
    recallAutoStartDecision({
      ...READY_TO_AUTO_START,
      settings: { autoStartCapture: false, captureEnabled: true },
    }),
    "not_opted_in",
  );
  // And the auto-start flag alone can never record: capture is still the master
  // switch, so a stale flag on a user who has since revoked capture is inert.
  assert.equal(
    recallAutoStartDecision({
      ...READY_TO_AUTO_START,
      settings: { autoStartCapture: true, captureEnabled: false },
    }),
    "capture_disabled",
  );
  // The build-wide switch outranks anything either flag says.
  assert.equal(
    recallAutoStartDecision({ ...READY_TO_AUTO_START, featureEnabled: false }),
    "feature_disabled",
  );
});

test("an unattended start never adds a second recorder, and never needs an install", () => {
  assert.equal(
    recallAutoStartDecision({ ...READY_TO_AUTO_START, engineRunning: true }),
    "already_running",
  );
  // A running engine is proof of an install, so liveness is checked first and
  // a stale install probe can never be the reason a second one is launched.
  assert.equal(
    recallAutoStartDecision({ ...READY_TO_AUTO_START, engineRunning: true, installed: false }),
    "already_running",
  );
  assert.equal(
    recallAutoStartDecision({ ...READY_TO_AUTO_START, installed: false }),
    "not_installed",
  );
});

test("exclusion entries are cleaned, de-duplicated, and bounded", () => {
  assert.deepEqual(normalizeExcludedWindows(["  1Password  ", "1PASSWORD", "", 42, null]), [
    "1Password",
  ]);
  // Control characters and quotes cannot ride into an argv item.
  assert.deepEqual(normalizeExcludedWindows(['Bank"; rm -rf / ']), ["Bank; rm -rf /"]);
  const many = Array.from({ length: MAX_EXCLUDED_WINDOWS + 25 }, (_, i) => `app-${i}`);
  assert.equal(normalizeExcludedWindows(many).length, MAX_EXCLUDED_WINDOWS);
  assert.deepEqual(normalizeExcludedWindows("not an array"), []);
});

test("exclusion matching follows the engine's App::Title semantics", () => {
  const slackHr = { appName: "Slack", windowName: "#hr - Acme" };
  const slackEng = { appName: "Slack", windowName: "#engineering - Acme" };
  const notes = { appName: "Notes", windowName: "#hr planning" };

  // Scoped to one window of one app.
  assert.equal(matchesExcludedWindow(slackHr, "Slack::#hr"), true);
  assert.equal(matchesExcludedWindow(slackEng, "Slack::#hr"), false);
  assert.equal(matchesExcludedWindow(notes, "Slack::#hr"), false);

  // `::title` matches the title in any app.
  assert.equal(matchesExcludedWindow(notes, "::#hr"), true);
  assert.equal(matchesExcludedWindow(slackEng, "::#hr"), false);

  // `App::` blocks the whole app, as does the bare app name.
  assert.equal(matchesExcludedWindow(slackEng, "Slack::"), true);
  assert.equal(matchesExcludedWindow(slackEng, "slack"), true);

  // Matching is case-insensitive and never matches on an empty pattern.
  assert.equal(matchesExcludedWindow(slackHr, "   "), false);
  assert.equal(isExcluded(slackHr, ["Firefox", "SLACK::#HR"]), true);
  assert.equal(isExcluded(slackEng, ["Firefox", "Slack::#hr"]), false);
});

test("a patch cannot widen a limit past what the UI offers", () => {
  const patched = applyRecallSettingsPatch(DEFAULT_RECALL_SETTINGS, {
    maxResults: 5000,
    defaultLookbackHours: 999999,
    agentControl: "whenever-i-feel-like-it",
    somethingElse: true,
  });
  assert.equal(patched.maxResults, 50);
  assert.equal(patched.defaultLookbackHours, 24 * 90);
  // An unrecognized control mode falls back rather than opening the gate.
  assert.equal(patched.agentControl, "ask");
  assert.equal("somethingElse" in patched, false);

  // Below-range values clamp up rather than disabling the limit entirely.
  const floored = applyRecallSettingsPatch(DEFAULT_RECALL_SETTINGS, {
    maxResults: 0,
    defaultLookbackHours: -3,
  });
  assert.equal(floored.maxResults, 1);
  assert.equal(floored.defaultLookbackHours, 1);
});

test("omitted fields in a patch are left alone", () => {
  const base = {
    ...DEFAULT_RECALL_SETTINGS,
    excludedWindows: ["Bank"],
    maxResults: 20,
    autoStartCapture: true,
  };
  const patched = applyRecallSettingsPatch(base, { agentAccess: false });
  assert.equal(patched.agentAccess, false);
  assert.deepEqual(patched.excludedWindows, ["Bank"]);
  assert.equal(patched.maxResults, 20);
  assert.equal(patched.autoStartCapture, true);
});

test("auto-start is a real, storable choice and not a widened default", () => {
  assert.equal(
    applyRecallSettingsPatch(DEFAULT_RECALL_SETTINGS, { autoStartCapture: true }).autoStartCapture,
    true,
  );
  const off = applyRecallSettingsPatch(
    { ...DEFAULT_RECALL_SETTINGS, autoStartCapture: true },
    { autoStartCapture: false },
  );
  assert.equal(off.autoStartCapture, false);
  // A junk value keeps whatever the user last chose rather than turning
  // unattended recording on by accident.
  assert.equal(
    applyRecallSettingsPatch(DEFAULT_RECALL_SETTINGS, { autoStartCapture: "maybe" })
      .autoStartCapture,
    false,
  );
});

const rows = [
  {
    type: "OCR",
    timestamp: "2026-08-06T09:00:00Z",
    appName: "Slack",
    windowName: "#hr - Acme",
    text: "salary review for Robin",
    frameId: 11,
    speaker: null,
  },
  {
    type: "OCR",
    timestamp: "2026-08-06T09:05:00Z",
    appName: "VS Code",
    windowName: "service.ts",
    text: "export async function searchRecall",
    frameId: 12,
    speaker: null,
  },
  {
    type: "Audio",
    timestamp: "2026-08-06T09:06:00Z",
    appName: "zoom.us",
    windowName: "Standup",
    text: "let us ship it on Friday",
    frameId: null,
    speaker: "Robin",
  },
];

test("results captured before an exclusion existed are still filtered out", () => {
  const shaped = shapeSearchResults(rows, {
    excludedWindows: ["Slack::#hr"],
    limit: 10,
    maxTextChars: 500,
    range: { start: "24h ago", end: "now" },
    hasMore: false,
  });
  assert.equal(shaped.hits.length, 2);
  assert.equal(
    shaped.hits.some((hit) => hit.text.includes("salary")),
    false,
    "an excluded window must not be readable after the fact",
  );
  // Hiding is reported, not silent, so a thin answer is explainable.
  assert.match(shaped.summary, /1 hidden by your exclusions/);
});

test("an all-excluded page reads as empty and says why", () => {
  const shaped = shapeSearchResults(rows.slice(0, 1), {
    excludedWindows: ["Slack"],
    limit: 10,
    maxTextChars: 500,
    range: { start: "24h ago", end: "now" },
    hasMore: false,
  });
  assert.deepEqual(shaped.hits, []);
  assert.match(shaped.summary, /hidden by your exclusions/);
});

test("the result cap and text cap are both applied, and truncation is flagged", () => {
  const shaped = shapeSearchResults(rows, {
    excludedWindows: [],
    limit: 2,
    maxTextChars: 10,
    range: { start: "3h ago", end: "now" },
    hasMore: false,
  });
  assert.equal(shaped.hits.length, 2);
  assert.equal(shaped.truncated, true, "dropping rows to the cap must be reported");
  for (const hit of shaped.hits) {
    assert.ok(hit.text.length <= 11, `"${hit.text}" should be truncated`);
  }
});

test("audio rows keep their speaker and are labelled as audio", () => {
  const shaped = shapeSearchResults(rows, {
    excludedWindows: [],
    limit: 10,
    maxTextChars: 500,
    range: { start: "3h ago", end: "now" },
    hasMore: false,
  });
  const audio = shaped.hits.find((hit) => hit.kind === "audio");
  assert.ok(audio, "the audio row should survive");
  assert.equal(audio.speaker, "Robin");
  assert.equal(shaped.hits.filter((hit) => hit.kind === "screen").length, 2);
});

test("text shorter than the cap is left exactly as captured", () => {
  assert.equal(truncateCapturedText("short", 100), "short");
  assert.equal(truncateCapturedText("abcdefghij", 5), "abcde\u2026");
});
