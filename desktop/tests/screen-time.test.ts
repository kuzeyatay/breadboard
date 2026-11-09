import { test } from "node:test";
import assert from "node:assert/strict";
import { observedScreenTime, screenTimeActivity, screenTimeExcluded, screenTimePreferences, screenTimeUrl } from "../src/main/screen-time-policy";

const preferences = { enabled: true, excluded: [] };
const sample = { pid: 42, process: "electron", title: "Breadboard", idleSeconds: 0 };
const context = { userId: "7", tab: { id: 3, title: "Signals and systems", url: "http://127.0.0.1:3000/garden/signals?token=private", browser: false, private: false } };

test("foreground Breadboard tab names are retained without credentials or query strings", () => {
  const activity = screenTimeActivity(sample, context, preferences, 42)!;
  assert.equal(activity.app, "Breadboard"); assert.equal(activity.title, "Signals and systems"); assert.equal(activity.url, "/garden/signals");
  assert.equal(activity.kind, "breadboard");
  assert.equal(screenTimeActivity({ ...sample, pid: 8, process: "Code", title: "file.ts" }, context, preferences, 42)?.kind, "app");
  assert.equal(screenTimeActivity({ ...sample, pid: 8, process: "Code", title: "file.ts" }, context, preferences, 42)?.title, "file.ts");
});

test("private, idle, locked, signed-out, paused and excluded activity is never recorded", () => {
  assert.equal(screenTimeActivity(sample, { ...context, tab: { ...context.tab, private: true } }, preferences, 42), null);
  assert.equal(screenTimeActivity({ ...sample, title: "Secret - InPrivate" }, context, preferences, 42), null);
  assert.equal(screenTimeActivity({ ...sample, idleSeconds: 300 }, context, preferences, 42), null);
  assert.equal(screenTimeActivity({ ...sample, process: "LockApp" }, context, preferences, 42), null);
  assert.equal(screenTimeActivity(sample, { userId: null }, preferences, 42), null);
  assert.equal(screenTimeActivity(sample, { userId: "7" }, preferences, 42), null);
  assert.equal(screenTimeActivity(sample, context, { ...preferences, enabled: false }, 42), null);
  assert.equal(screenTimeActivity(sample, context, { ...preferences, excluded: ["Breadboard::Signals"] }, 42), null);
  assert.equal(screenTimeActivity(sample, { ...context, userId: "../7" }, preferences, 42), null);
});

test("exclusion matching supports whole apps, scoped titles and unscoped titles", () => {
  assert.ok(screenTimeExcluded("Breadboard", "My notes", ["breadboard::"]));
  assert.ok(screenTimeExcluded("Breadboard", "My notes", ["::notes"]));
  assert.ok(screenTimeExcluded("Code", "My notes", ["notes"]));
  assert.equal(screenTimeExcluded("Code", "My notes", ["Breadboard::notes"]), false);
  assert.deepEqual(screenTimePreferences({ enabled: false, excluded: [null, "", "  My notes  "] }), { enabled: false, excluded: ["My notes"] });
});

test("sleep, stalled sampling and reversed clocks cannot become foreground time", () => {
  const activity = screenTimeActivity(sample, context, preferences, 42)!;
  const previous = { at: 10000, activity };
  assert.equal(observedScreenTime(previous, 12000)?.end, 12000);
  assert.equal(observedScreenTime(previous, 9000), null);
  assert.equal(observedScreenTime(previous, 10000), null);
  assert.equal(observedScreenTime(previous, 70000), null);
  assert.equal(observedScreenTime(null, 10000), null);
});

test("website metadata excludes unsafe schemes and URL secrets", () => {
  assert.deepEqual(screenTimeUrl("https://www.example.org/paper?secret=1#chapter", true), { url: "https://www.example.org/paper", domain: "example.org" });
  assert.deepEqual(screenTimeUrl("https://user:secret@example.org", true), {});
  assert.deepEqual(screenTimeUrl("javascript:alert(1)", true), {});
});
