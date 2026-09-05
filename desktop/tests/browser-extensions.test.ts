import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BROWSER_EXTENSIONS_STATE_FILE,
  normalizeBrowserExtensionPaths,
  readBrowserExtensionPaths,
  writeBrowserExtensionPaths,
} from "../src/main/browser-extensions";

test("browser extension paths are durable, bounded and deduplicated", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-extensions-"));
  try {
    const first = path.join(fixture, "first");
    const second = path.join(fixture, "second");
    writeBrowserExtensionPaths(fixture, [first, first, second]);
    assert.deepEqual(readBrowserExtensionPaths(fixture), [first, second]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fixture, BROWSER_EXTENSIONS_STATE_FILE), "utf8")),
      { version: 1, paths: [first, second] },
    );
    assert.deepEqual(normalizeBrowserExtensionPaths([null, 4, "", first]), [first]);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("an unreadable browser extension record starts empty", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-extensions-"));
  try {
    fs.writeFileSync(path.join(fixture, BROWSER_EXTENSIONS_STATE_FILE), "not json");
    assert.deepEqual(readBrowserExtensionPaths(fixture), []);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
