import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BROWSER_BOOKMARKS_STATE_FILE,
  BROWSER_SHORTCUTS_STATE_FILE,
  readBrowserBookmarks,
  writeBrowserBookmarks,
  readBrowserShortcuts,
  writeBrowserShortcuts,
} from "../src/main/browser-bookmarks";
import { isBrowserBookmarks } from "../src/shared/ipc-contract";

const bookmark = {
  url: "https://example.com/",
  title: "Example",
  iconUrl: "https://example.com/favicon.ico",
};

test("browser bookmarks survive a new reader and remain scoped by profile", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-bookmarks-"));
  try {
    assert.equal(readBrowserBookmarks(fixture, "one@example.com"), null);
    writeBrowserBookmarks(fixture, "one@example.com", [bookmark]);
    writeBrowserBookmarks(fixture, "two@example.com", []);

    assert.deepEqual(readBrowserBookmarks(fixture, "one@example.com"), [bookmark]);
    assert.deepEqual(readBrowserBookmarks(fixture, "two@example.com"), []);
    assert.equal(readBrowserBookmarks(fixture, "three@example.com"), null);
    assert.equal(fs.existsSync(path.join(fixture, BROWSER_BOOKMARKS_STATE_FILE)), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("bookmark persistence rejects oversized, duplicate, and unsafe records", () => {
  assert.equal(isBrowserBookmarks([bookmark]), true);
  assert.equal(isBrowserBookmarks([bookmark, bookmark]), false);
  assert.equal(isBrowserBookmarks([{ ...bookmark, url: "file:///C:/secret.txt" }]), false);
  assert.equal(isBrowserBookmarks([{ ...bookmark, iconUrl: "javascript:alert(1)" }]), false);
  assert.equal(isBrowserBookmarks(Array.from({ length: 41 }, (_, index) => ({
    ...bookmark,
    url: `https://example.com/${index}`,
  }))), false);
});

test("bookmarks and start-page shortcuts survive separate processes and preserve deletions", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-saved-sites-restart-"));
  const modulePath = require.resolve("../src/main/browser-bookmarks");
  try {
    const writer = spawnSync(process.execPath, ["-e", `
      const store = require(${JSON.stringify(modulePath)});
      store.writeBrowserBookmarks(process.argv[1], "one@example.com", ${JSON.stringify([bookmark])});
      store.writeBrowserShortcuts(process.argv[1], "one@example.com", ${JSON.stringify([{ ...bookmark, title: "Shortcut" }])});
      store.writeBrowserShortcuts(process.argv[1], "two@example.com", []);
    `, fixture], { encoding: "utf8" });
    assert.equal(writer.status, 0, writer.stderr);
    const reader = spawnSync(process.execPath, ["-e", `
      const store = require(${JSON.stringify(modulePath)});
      console.log(JSON.stringify([
        store.readBrowserBookmarks(process.argv[1], "one@example.com"),
        store.readBrowserShortcuts(process.argv[1], "one@example.com"),
        store.readBrowserShortcuts(process.argv[1], "two@example.com")
      ]));
    `, fixture], { encoding: "utf8" });
    assert.equal(reader.status, 0, reader.stderr);
    assert.deepEqual(JSON.parse(reader.stdout), [[bookmark], [{ ...bookmark, title: "Shortcut" }], []]);
    writeBrowserShortcuts(fixture, "one@example.com", []);
    assert.deepEqual(readBrowserShortcuts(fixture, "one@example.com"), []);
    assert.deepEqual(readBrowserBookmarks(fixture, "one@example.com"), [bookmark]);
    assert.equal(fs.existsSync(path.join(fixture, BROWSER_SHORTCUTS_STATE_FILE)), true);
    assert.throws(() => writeBrowserShortcuts(fixture, "one@example.com", Array(9).fill(bookmark)), /Too many/);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("an unreadable saved-sites file is preserved instead of overwritten by a new save", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-saved-sites-corrupt-"));
  try {
    const file = path.join(fixture, BROWSER_BOOKMARKS_STATE_FILE);
    fs.writeFileSync(file, '{"owners":');
    assert.throws(() => readBrowserBookmarks(fixture, "one@example.com"));
    assert.throws(() => writeBrowserBookmarks(fixture, "one@example.com", [bookmark]));
    assert.equal(fs.readFileSync(file, "utf8"), '{"owners":');
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
