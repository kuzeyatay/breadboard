import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BrowserPreferenceStore } from "../src/main/browser-preferences";
import { isTabsCommand } from "../src/shared/ipc-contract";
import { notificationOrigin, TRANSLATION_LANGUAGES } from "../src/shared/browser-preferences";

test("notification permissions persist by origin, pause globally, and can be reset", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-preferences-"));
  try {
    const store = new BrowserPreferenceStore(dir);
    assert.equal(store.permission("https://example.org/a"), "default");
    assert.ok(store.update({ type: "browser-notification-permission", origin: "https://example.org", permission: "granted" }));
    assert.equal(store.permission("https://example.org/b"), "granted");
    assert.equal(store.permission("https://sub.example.org"), "default");
    assert.equal(store.permission("https://example.org:8443"), "default");
    assert.ok(store.update({ type: "browser-notifications-enabled", enabled: false }));
    assert.equal(new BrowserPreferenceStore(dir).permission("https://example.org"), "denied");
    assert.ok(store.update({ type: "browser-notifications-enabled", enabled: true }));
    assert.equal(store.permission("https://example.org"), "granted");
    assert.ok(store.update({ type: "browser-notification-permission", origin: "https://example.org", permission: "default" }));
    assert.equal(new BrowserPreferenceStore(dir).permission("https://example.org"), "default");
    fs.writeFileSync(path.join(dir, "browser-preferences.json"), "broken");
    const broken = new BrowserPreferenceStore(dir);
    assert.equal(broken.permission("https://example.org"), "denied");
    assert.equal(broken.update({ type: "browser-notifications-enabled", enabled: true }), false);
    assert.equal(fs.readFileSync(path.join(dir, "browser-preferences.json"), "utf8"), "broken");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("web permissions and translation commands reject unsafe origins and malformed payloads", () => {
  for (const value of ["http://example.org", "https://user:pass@example.org", "file:///test", "data:text/html,a", "null"]) assert.equal(notificationOrigin(value), null);
  assert.equal(notificationOrigin("http://localhost:4351/test"), "http://localhost:4351");
  for (const language of TRANSLATION_LANGUAGES) assert.ok(isTabsCommand({ type: "browser-translate", language }));
  assert.equal(isTabsCommand({ type: "browser-translate", language: "en;alert(1)" }), false);
  assert.equal(isTabsCommand({ type: "browser-notification-permission", origin: "https://example.org/path", permission: "granted" }), false);
  assert.equal(isTabsCommand({ type: "browser-notification-permission", origin: "https://example.org", permission: "yes" }), false);
  assert.equal(isTabsCommand({ type: "browser-notifications-enabled", enabled: "true" }), false);
});
