import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { OnBeforeRequestListenerDetails, Session, WebContents } from "electron";
import { FiltersEngine } from "../src/main/browser-adblocker-engine";
import { BrowserAdBlocker, adBlockSite } from "../src/main/browser-adblocker";
import { isTabsCommand } from "../src/shared/ipc-contract";
import { runElectronFixture } from "./helpers/run-electron-fixture";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-adblock-unit-"));
  const engine = FiltersEngine.parse("||ads.example^\n@@||ads.example/allowed.js$script\n||third.example^$third-party\n||typed.example^$image");
  const blocker = new BrowserAdBlocker(dir, () => {}, undefined, engine);
  const makeSession = () => {
    let registrations = 0;
    let listener: (details: OnBeforeRequestListenerDetails, callback: (response: { cancel?: boolean }) => void) => void;
    const session = { getPreloads: () => [], setPreloads: () => {}, protocol: { handle: () => {} }, webRequest: { onBeforeRequest(_filter: unknown, hook: typeof listener) { registrations++; listener = hook; } } } as unknown as Session;
    return { session, registrations: () => registrations, request(url: string, source: string, id = 1, resourceType = "script") {
      let calls = 0, blocked = false;
      listener({ url, referrer: source, webContentsId: id, resourceType } as OnBeforeRequestListenerDetails, response => { calls++; blocked = response.cancel === true; });
      assert.equal(calls, 1, "Every request callback is completed exactly once");
      return blocked;
    } };
  };
  const makePage = (session: Session, id = 1, url = "https://news.example/article", privateBrowsing = false) => {
    const page = Object.assign(new EventEmitter(), { id, session, getURL: () => url, isDestroyed: () => false, mainFrame: { framesInSubtree: [] } }) as unknown as WebContents;
    blocker.attachPage(page, privateBrowsing);
    return page;
  };
  return { dir, engine, blocker, makeSession, makePage, cleanup() {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

test("native filtering honors rule exceptions, types, third-party rules and top-level navigation", t => {
  const f = fixture(); t.after(f.cleanup);
  const s = f.makeSession(), page = f.makePage(s.session); t.after(() => page.emit("destroyed"));
  f.blocker.attachSession(s.session);
  assert.equal(s.registrations(), 1);
  assert.equal(s.request("https://ads.example/ad.js", "https://news.example"), true);
  assert.equal(s.request("https://ads.example/allowed.js", "https://news.example"), false);
  assert.equal(s.request("https://third.example/ad.js", "https://news.example"), true);
  assert.equal(s.request("https://third.example/ad.js", "https://third.example"), false);
  assert.equal(s.request("https://typed.example/ad", "https://news.example", 1, "image"), true);
  assert.equal(s.request("https://typed.example/app.js", "https://news.example"), false);
  assert.equal(s.request("https://ads.example/", "https://news.example", 1, "mainFrame"), false);
  assert.equal(s.request("https://ads.example/frame", "https://news.example", 1, "subFrame"), true);
  assert.equal(s.request("https://ads.example/ad.js", "", 1), true, "no-referrer pages use the tracked top-level URL");
  assert.equal(s.request("https://ads.example/ad.js", "https://news.example", 2), false, "unregistered extension contents are unaffected");
  assert.equal(f.blocker.snapshot(page).blocked, 5);
  page.emit("did-start-navigation", {}, "https://next.example", true, true);
  assert.equal(f.blocker.snapshot(page).blocked, 5, "same-document navigation keeps the counter");
  page.emit("did-start-navigation", {}, "https://next.example", false, true);
  assert.equal(f.blocker.snapshot(page).blocked, 0);
});

test("site pauses cover nested-frame requests, persist, and cannot leak to another host", t => {
  const f = fixture(); t.after(f.cleanup);
  const s = f.makeSession(), page = f.makePage(s.session); t.after(() => page.emit("destroyed"));
  assert.equal(f.blocker.setSiteEnabled("https://NEWS.example/article", false, s.session), true);
  assert.equal(s.request("https://ads.example/ad.js", "https://embedded.example/frame"), false);
  const saved = JSON.parse(fs.readFileSync(path.join(f.dir, "browser-adblocker.json"), "utf8"));
  assert.deepEqual(saved.allowedSites, ["news.example"]);
  assert.equal(JSON.stringify(saved).includes("article"), false);
  const restored = new BrowserAdBlocker(f.dir, () => {}, undefined, f.engine);
  assert.equal(restored.snapshot(undefined, "https://news.example").siteEnabled, false);
  assert.equal(restored.snapshot(undefined, "https://other.news.example").siteEnabled, true);
  page.emit("did-start-navigation", {}, "https://other.example", false, true);
  assert.equal(s.request("https://ads.example/ad.js", "https://other.example"), true);
  assert.equal(f.blocker.setEnabled(false, s.session), true);
  assert.equal(s.request("https://ads.example/ad.js", "https://other.example"), false);
  assert.equal(new BrowserAdBlocker(f.dir, () => {}, undefined, f.engine).snapshot().enabled, false);
});

test("private toggles and site exceptions never modify normal settings or persist", t => {
  const f = fixture(); t.after(f.cleanup);
  const regular = f.makeSession(), privateSession = f.makeSession();
  const regularPage = f.makePage(regular.session), privatePage = f.makePage(privateSession.session, 2, "https://news.example", true);
  t.after(() => { regularPage.emit("destroyed"); privatePage.emit("destroyed"); });
  f.blocker.setSiteEnabled("https://news.example", false, privateSession.session);
  assert.equal(privateSession.request("https://ads.example/ad.js", "https://frame.example", 2), false);
  assert.equal(regular.request("https://ads.example/ad.js", "https://news.example"), true);
  f.blocker.setEnabled(false, privateSession.session);
  assert.equal(f.blocker.snapshot(privatePage).enabled, false);
  assert.equal(f.blocker.snapshot(regularPage).enabled, true);
  assert.equal(fs.existsSync(path.join(f.dir, "browser-adblocker.json")), false);
  const nextPrivate = f.makeSession();
  f.blocker.attachSession(nextPrivate.session, true);
  assert.equal(f.blocker.snapshot(undefined, "https://news.example", nextPrivate.session).siteEnabled, true);
});

test("malformed settings and unsupported URLs fail safely; invalid IPC toggles are rejected", t => {
  const f = fixture(); t.after(f.cleanup);
  fs.writeFileSync(path.join(f.dir, "browser-adblocker.json"), '{"enabled":"false","allowedSites":["news.example/path",null,"news.example"]}');
  const restored = new BrowserAdBlocker(f.dir, () => {}, undefined, f.engine);
  assert.equal(restored.snapshot().enabled, true);
  assert.equal(restored.snapshot(undefined, "https://news.example").siteEnabled, false);
  for (const input of ["file:///tmp/a", "chrome-extension://id/a", "about:blank", "not a URL"]) assert.equal(adBlockSite(input), null);
  assert.equal(adBlockSite("https://NEWS.Example.:443/a"), "news.example");
  for (const enabled of [null, undefined, "false", 0]) assert.equal(isTabsCommand({ type: "browser-adblock-enabled", enabled }), false);
  assert.equal(isTabsCommand({ type: "browser-adblock-enabled", enabled: false }), true);
  assert.equal(isTabsCommand({ type: "browser-adblock-site-enabled", enabled: true }), false);
  assert.equal(isTabsCommand({ type: "browser-adblock-site-enabled", enabled: true, site: "news.example" }), true);
});

test("native blocker works offline in real browser tabs and responds to Extensions controls", { timeout: 90_000 }, async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-adblock-electron-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-adblocker.cjs"), dir], desktop, env, 70_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
