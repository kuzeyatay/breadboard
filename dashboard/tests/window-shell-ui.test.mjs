import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

test("built shell preserves tab alignment, browser chrome and the top green progress bar", { timeout: 30_000 }, async t => {
  const root = path.resolve(import.meta.dirname, "../../desktop/dist/window-shell");
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, "." + new URL(request.url, "http://local").pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : "text/html");
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 200 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Set();
    window.commands = [];
    window.state = { enabled: true, persistentShell: true, activeId: 3, selfId: 3, presentedId: 3,
      presentationStatus: "presented", presentationRevision: 1, browserOwnerKey: "fixture", extensions: [],
      groups: [{ id: "cyan", name: "", color: "cyan", collapsed: true }, { id: "blue", name: "", color: "blue", collapsed: true }, { id: "purple", name: "", color: "purple", collapsed: false }],
      tabs: [{ id: 1, groupId: "cyan", title: "One", url: "/one", generation: 1, loading: false },
        { id: 2, groupId: "blue", title: "Two", url: "/two", generation: 1, loading: false },
        { id: 3, groupId: "purple", title: "Workspace", url: "/gardens/example", generation: 1, loading: false },
        { id: 4, groupId: "purple", title: "Browser", url: "https://example.org", generation: 1, loading: false,
          browser: { address: "https://example.org", canGoBack: false, canGoForward: false, terminalOpen: false } }] };
    window.publish = update => { window.state = { ...window.state, ...update }; for (const fn of listeners) fn(window.state); };
    window.breadboardDesktop = {
      getTabsState: async () => window.state,
      onTabsState: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      tabs: async command => { window.commands.push(command); return true; },
      getBrowserBookmarks: async () => [], getBrowserRecentSearches: async () => [],
      setBrowserBookmarks: async () => true,
      setBrowserRecentSearches: async () => true, getBrowserDownloads: async () => ({ items: [], error: null }),
      onBrowserDownloads: () => () => {},
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.getByRole("tab", { name: "Workspace", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => {
    const group = document.querySelector('[data-group-marker="purple"]');
    const tab = document.querySelector('[data-tab-id="3"]');
    const lineTop = node => node.getBoundingClientRect().top + parseFloat(getComputedStyle(node).borderTopWidth) + parseFloat(getComputedStyle(node, "::after").top);
    return { border: getComputedStyle(group).borderTopWidth, groupLine: lineTop(group), tabLine: lineTop(tab), strip: document.querySelector(".desktop-title-bar").getBoundingClientRect().height };
  });
  assert.equal(geometry.border, "0px", "the original reset removes native button borders");
  assert.equal(geometry.groupLine, geometry.tabLine, "group underline joins the tabs without a step");
  assert.equal(geometry.strip, 32);
  await page.evaluate(() => window.publish({ presentationStatus: "pending" }));
  await page.waitForFunction(() => document.querySelector('.bb-nav-progress[aria-busy="true"]'));
  assert.deepEqual(await page.locator(".bb-nav-progress").evaluate(n => ({ y: n.getBoundingClientRect().y, height: n.getBoundingClientRect().height, color: getComputedStyle(n.firstElementChild).backgroundColor })),
    { y: 0, height: 4, color: "rgb(79, 111, 104)" });
  await page.getByRole("button", { name: "Close Workspace", exact: true }).click();
  assert.ok(await page.evaluate(() => window.commands.some(c => c.type === "close" && c.id === 3)), "progress cannot intercept the close button");
  await page.evaluate(() => window.publish({ activeId: 4, selfId: 4, presentedId: 4, presentationStatus: "presented" }));
  await page.getByRole("toolbar", { name: "Browser navigation" }).waitFor();
  assert.equal(await page.locator(".browser-bookmarks-bar").evaluate(n => n.getBoundingClientRect().bottom), 135, "toolbar stays aligned with the native website inset");
  await page.waitForFunction(() => document.querySelector('.bb-nav-progress[aria-hidden="true"]'));
  await page.evaluate(() => window.publish({ tabs: window.state.tabs.map(t => t.id === 4 ? { ...t, pageLoading: true } : t) }));
  await page.waitForFunction(() => document.querySelector('.bb-nav-progress[aria-busy="true"]'));
  const screenshot = path.resolve(import.meta.dirname, "../../docs/qa/tab-controls-2026-09-25/shell.png");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bb-nav-progress')).opacity === "1");
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, clip: { x: 0, y: 0, width: 1100, height: 136 } });
  assert.deepEqual(errors, []);
});
