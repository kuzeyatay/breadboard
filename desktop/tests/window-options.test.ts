import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BREADBOARD_TITLE_BAR,
  mainWindowOptions,
} from "../src/main/window-options";

test("main window options enforce renderer isolation", () => {
  const options = mainWindowOptions(
    "C:\\app\\preload.js",
    "C:\\app\\icon.ico",
    "win32",
  );
  assert.equal(options.show, false);
  assert.equal(options.title, "Breadboard");
  assert.equal(options.icon, "C:\\app\\icon.ico");
  assert.equal(options.backgroundColor, "#e6f0e6");
  assert.equal(options.titleBarStyle, "hidden");
  assert.deepEqual(options.titleBarOverlay, BREADBOARD_TITLE_BAR);
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.webviewTag, false);
  assert.equal(options.webPreferences?.preload, "C:\\app\\preload.js");
});

test("non-Windows windows retain native title bars", () => {
  const options = mainWindowOptions("/app/preload.js", undefined, "darwin");
  assert.equal(options.titleBarStyle, undefined);
  assert.equal(options.titleBarOverlay, undefined);
});
