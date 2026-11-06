import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { BrowserNotificationPages } from "../src/main/browser-notification-pages";

test("notification startup URLs persist app paths and migrate grants only once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-notification-pages-"));
  const sites = { "https://example.org": "granted", "https://blocked.org": "denied" } as const;
  const history = [{ url: "https://blocked.org/inbox" }, { url: "https://example.org/web" }];
  try {
    const store = new BrowserNotificationPages(dir, sites, history);
    assert.deepEqual(store.urls(), ["https://example.org/web"]);
    store.remember("https://example.org/web/inbox");
    for (const url of ["http://unsafe.org/", "https://user:pass@example.org/", "file:///tmp/page"]) store.remember(url);
    const reopened = new BrowserNotificationPages(dir, sites, []);
    assert.deepEqual(reopened.urls(), ["https://example.org/web/inbox"]);
    reopened.reconcile({ "https://example.org": "denied" });
    assert.deepEqual(new BrowserNotificationPages(dir, sites, history).urls(), [], "revoked sites do not remigrate");
    reopened.remember("https://example.org/web");
    reopened.clear();
    assert.deepEqual(new BrowserNotificationPages(dir, sites, history).urls(), [], "sign-in reset does not resurrect history");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("invalid saved receivers are preserved and never loaded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-notification-pages-"));
  const file = path.join(dir, "browser-notification-pages.json");
  try {
    for (const contents of ["broken", JSON.stringify({ version: 1, pages: { "https://example.org": "https://other.org/web" } })]) {
      fs.writeFileSync(file, contents);
      const store = new BrowserNotificationPages(dir, { "https://example.org": "granted" }, []);
      store.remember("https://example.org/web");
      assert.deepEqual(store.urls(), []);
      assert.equal(fs.readFileSync(file, "utf8"), contents);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
