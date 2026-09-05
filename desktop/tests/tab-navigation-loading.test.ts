import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("notification navigation and page replacement retain content while explicit cold tabs use the startup loader", {
  skip: process.platform !== "win32",
}, () => {
  const desktopRoot = path.resolve(__dirname, "..", "..");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tab-navigation-loading-"));
  const resultFile = path.join(fixture, "result.json");
  const loadingFile = path.join(fixture, "loading.html");
  const windowManager = path.join(desktopRoot, "dist", "main", "window-manager.js");
  const preload = path.join(desktopRoot, "dist", "preload", "preload.js");
  const dashboardRoot = path.resolve(desktopRoot, "..", "dashboard");
  const { buildSync } = require(path.join(dashboardRoot, "node_modules", "esbuild"));
  const routerStub = path.join(fixture, "navigation.js");
  fs.writeFileSync(routerStub, `
    export const usePathname = () => window.location.pathname;
    export const useSearchParams = () => new URLSearchParams(window.location.search);
    export const useRouter = () => ({ push: href => { window.pushedHref = href; } });
  `);
  const bundle = buildSync({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import NavigationProgress from './src/app/components/navigation-progress';
        import { Toaster } from './src/app/components/toast';
        import { openDesktopNotificationTarget } from './src/lib/desktop-notification-overlay';
        function App() {
          const [toasts, setToasts] = useState([]);
          window.showNotice = () => setToasts([{ id: 'notice', type: 'success',
            message: 'A response is ready', target: {
              surface: 'garden_chat', gardenSlug: 'notification', chatId: '42',
            } }]);
          return <><NavigationProgress /><Toaster toasts={toasts}
            onDismiss={() => setToasts([])}
            onOpenChat={location.pathname === '/notification-overlay' ? openDesktopNotificationTarget : undefined}
          /></>;
        }
        createRoot(document.getElementById('root')).render(<App />);
      `,
      resolveDir: dashboardRoot, loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "next/navigation": routerStub, "@": path.join(dashboardRoot, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  fs.writeFileSync(path.join(fixture, "app.js"), bundle.outputFiles[0].text);
  fs.writeFileSync(loadingFile, "<!doctype html><body>Startup loader</body>");
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
  fs.writeFileSync(path.join(fixture, "main.cjs"), `
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { app, ipcMain } = require("electron");
const { WindowManager } = require(${JSON.stringify(windowManager)});
const { REVEAL_MAX_WAIT_MS } = require(${JSON.stringify(path.join(desktopRoot, "dist", "main", "tab-manager.js"))});
const resultFile = ${JSON.stringify(resultFile)};
const loadingFile = ${JSON.stringify(loadingFile)};
app.setPath("userData", ${JSON.stringify(path.join(fixture, "user-data"))});
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Timed out: " + label);
};
app.whenReady().then(async () => {
  let holdBrowser = false;
  let releaseBrowser = null;
  let releaseNotification = null;
  const server = http.createServer((request, response) => {
    if (request.url === "/app.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(fs.readFileSync(${JSON.stringify(path.join(fixture, "app.js"))}));
      return;
    }
    const send = () => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>" + request.url + "</title><body>" + request.url + '<div id="root"></div><script src="/app.js"></script></body>');
    };
    if (request.url === "/browser" && holdBrowser) releaseBrowser = send;
    else if (request.url.startsWith("/gardens/notification")) releaseNotification = send;
    else send();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loadingFile).toString()]) },
    startupHtmlPath: loadingFile,
    recoveryHtmlPath: loadingFile,
    loadingHtmlPath: loadingFile,
    preloadPath: ${JSON.stringify(preload)},
    minimumStartupVisibleMs: 0,
  });
  manager.tabs.setBrowserUrl(origin + "/browser");
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  ipcMain.handle("breadboard:get-tabs-state", event => manager.tabs.stateFor(event.sender));
  ipcMain.handle("breadboard:tabs-command", (event, value) => manager.tabs.handleCommand(event.sender, value));
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  const base = window.webContents;
  await base.loadURL(origin + "/new-tab");
  const state = () => manager.tabs.stateFor(front()?.webContents ?? base);
  const command = (sender, value) => manager.tabs.handleCommand(sender, value);
  const loader = () => window.contentView.children.find(view =>
    !view.webContents.isDestroyed() && view.webContents.getURL().includes("loading.html"));
  const front = () => window.contentView.children.find(view =>
    !view.webContents.isDestroyed() && !view.webContents.getURL().includes("loading.html") &&
    !view.webContents.getURL().includes("/notification-overlay") &&
    view.getBounds().y === 0);
  const active = () => state().tabs.find(tab => tab.id === state().activeId);
  const release = () => { holdBrowser = false; releaseBrowser(); releaseBrowser = null; };
  const bar = contents => contents.executeJavaScript('(() => { const bar = document.querySelector("[role=progressbar]"); return bar && { busy: bar.getAttribute("aria-busy"), hidden: bar.getAttribute("aria-hidden") }; })()');

  // Right-clicking plus issues this browser command without replaceCurrent.
  holdBrowser = true;
  assert.equal(command(base, { type: "browser" }), true);
  await until(() => releaseBrowser && loader(), "cold browser opened via plus");
  assert.equal(active().loading, true);
  release();
  const firstBrowser = await until(() => !loader() && front(), "first browser revealed");
  const firstBrowserId = state().activeId;
  await until(() => !active().loading, "browser shell ready");
  const baseId = state().tabs.find(tab => tab.url === origin + "/new-tab").id;
  command(base, { type: "activate", id: baseId });
  await until(() => !front() && !loader(), "base tab selected");
  command(base, { type: "activate", id: firstBrowserId });
  assert.equal(Boolean(loader()), false, "ready tabs never need the startup scene");
  assert.equal(state().navigationPending, false, "selecting an already loaded tab is not page navigation");
  await until(() => front() === firstBrowser, "ready browser selected");
  assert.deepEqual(await bar(firstBrowser.webContents), { busy: "false", hidden: "true" });
  command(base, { type: "activate", id: baseId });

  // A base page stays visible too: retiring it must wait for the replacement.
  holdBrowser = true;
  assert.equal(command(base, { type: "browser", replaceCurrent: true }), true);
  await until(() => releaseBrowser, "held base replacement");
  await new Promise(resolve => setTimeout(resolve, REVEAL_MAX_WAIT_MS + 100));
  assert.equal(Boolean(loader()), false);
  assert.equal(base.getURL(), origin + "/new-tab");
  assert.equal(Boolean(front()), false);
  assert.equal(active().loading, true);
  release();
  const baseReplacement = await until(() => front(), "base replacement revealed");
  await until(() => base.getURL() === "about:blank", "base retired after reveal");

  // New-tab pages backed by child views use the same navigation feedback.
  command(baseReplacement.webContents, { type: "new" });
  const launcher = await until(() => {
    const view = front();
    return view && view.webContents.getURL() === origin + "/new-tab" && !loader() ? view : null;
  }, "launcher view revealed");
  const launcherContents = launcher.webContents;
  const launcherId = state().activeId;
  await until(async () => (await bar(launcherContents))?.hidden === "true", "launcher hydrated");
  for (const id of [firstBrowserId, launcherId, firstBrowserId, launcherId]) {
    command(launcherContents, { type: "activate", id });
    assert.equal(state().navigationPending, false, "switching between loaded child views stays idle");
    await until(() => front() === (id === firstBrowserId ? firstBrowser : launcher), "loaded child selected");
    assert.deepEqual(await bar(front().webContents), { busy: "false", hidden: "true" });
  }

  // A background tab may have its document ready without ever being shown.
  command(launcherContents, { type: "open", url: origin + "/background", background: true });
  const backgroundId = state().tabs.find(tab => tab.url === origin + "/background").id;
  await until(() => !state().tabs.find(tab => tab.id === backgroundId).loading, "background tab loaded");
  command(launcherContents, { type: "activate", id: backgroundId });
  assert.equal(state().navigationPending, false, "first reveal of an already loaded background tab stays idle");
  await until(() => front()?.webContents.getURL() === origin + "/background", "background tab revealed");
  await until(async () => (await bar(front().webContents))?.hidden === "true", "background tab hydrated");
  command(launcherContents, { type: "activate", id: launcherId });
  assert.equal(state().navigationPending, false);
  await until(() => front() === launcher, "launcher reselected");
  const countBefore = manager.tabs.stateFor(launcherContents).tabs.length;
  holdBrowser = true;
  command(launcherContents, { type: "browser", replaceCurrent: true });
  await until(() => releaseBrowser, "held launcher replacement");
  const replacementState = manager.tabs.stateFor(launcherContents);
  const replacementId = replacementState.activeId;
  assert.equal(replacementState.tabs.length, countBefore);
  assert.equal(Boolean(loader()), false);
  assert.equal(front(), launcher, "the current launcher remains visible throughout the wait");
  assert.equal(launcherContents.isDestroyed(), false);
  command(firstBrowser.webContents, { type: "activate", id: replacementId });
  await until(loader, "clicking the pending replacement requests the startup scene");
  command(firstBrowser.webContents, { type: "activate", id: firstBrowserId });
  await until(() => front() === firstBrowser && !loader(), "switch away to a ready tab");
  command(firstBrowser.webContents, { type: "activate", id: replacementId });
  await until(loader, "returning to the unready tab uses the startup scene");
  release();
  await until(() => !loader() && launcherContents.isDestroyed(), "replacement revealed and old page disposed");

  // Click the actual notification arrow in its separate renderer. The blue
  // bar belongs to the outgoing page and stays busy beyond the frame timeout.
  const outgoing = front();
  const outgoingId = state().activeId;
  manager.tabs.setNotificationOverlayUrl(origin + "/notification-overlay");
  const overlay = await until(() => window.contentView.children.find(view =>
    view.webContents.getURL() === origin + "/notification-overlay"), "notification renderer");
  await until(() => overlay.webContents.executeJavaScript('typeof window.showNotice === "function"'), "notification hydrated");
  await overlay.webContents.executeJavaScript('window.showNotice()');
  await until(() => overlay.webContents.executeJavaScript('Boolean(document.querySelector("button[title^=Open]"))'), "notification arrow");
  await overlay.webContents.executeJavaScript('document.querySelector("button[title^=Open]").click()');
  await until(() => releaseNotification, "notification destination request");
  await until(async () => (await bar(outgoing.webContents))?.busy === "true", "outgoing blue bar running");
  await new Promise(resolve => setTimeout(resolve, REVEAL_MAX_WAIT_MS + 100));
  assert.equal(Boolean(loader()), false, "notification navigation must never use the startup loader");
  assert.equal(front(), outgoing, "the current page remains visible until the response arrives");
  assert.equal(state().navigationPending, true);
  assert.deepEqual(await bar(outgoing.webContents), { busy: "true", hidden: "false" });
  releaseNotification();
  releaseNotification = null;
  const destination = await until(() => front() !== outgoing && front(), "notification destination revealed");
  assert.equal(destination.webContents.getURL(), origin + "/gardens/notification?chat=42");
  assert.equal(state().navigationPending, false);
  await until(async () => (await bar(outgoing.webContents))?.hidden === "true", "outgoing bar cleared");
  await until(async () => (await bar(destination.webContents))?.hidden === "true", "destination bar cleared");
  assert.equal(Boolean(loader()), false);

  // Switching away cancels a pending reveal and clears the bar. A late
  // response must not steal focus back from the tab the person selected.
  command(overlay.webContents, { type: "open", url: origin + "/gardens/notification?chat=43" });
  await until(() => releaseNotification, "second notification request");
  await until(async () => (await bar(destination.webContents))?.busy === "true", "second navigation bar");
  command(destination.webContents, { type: "activate", id: outgoingId });
  await until(() => front() === outgoing, "returned to outgoing tab");
  releaseNotification();
  await until(() => state().tabs.every(tab => !tab.loading), "background response completed");
  assert.equal(front(), outgoing);
  assert.equal(state().navigationPending, false);
  await until(async () => (await bar(outgoing.webContents))?.hidden === "true", "cancelled bar cleared");

  // A page-local notice uses the router and starts the same progress bar.
  await outgoing.webContents.executeJavaScript('window.showNotice()');
  await until(() => outgoing.webContents.executeJavaScript('Boolean(document.querySelector("button[title^=Open]"))'), "page notification arrow");
  await outgoing.webContents.executeJavaScript('document.querySelector("button[title^=Open]").click()');
  await until(async () => (await bar(outgoing.webContents))?.busy === "true", "web fallback blue bar");
  assert.equal(await outgoing.webContents.executeJavaScript('window.pushedHref'), "/gardens/notification?chat=42");
  assert.equal(outgoing.webContents.getURL(), origin + "/browser", "the page did not hard reload");
  fs.writeFileSync(resultFile, JSON.stringify({ ok: true }));
  window.destroy();
  await new Promise(resolve => server.close(resolve));
  app.quit();
}).catch(error => {
  fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack }));
  app.exit(1);
});
`);
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe"), [fixture], {
    cwd: fixture, env, encoding: "utf8", timeout: 30000, windowsHide: true,
  });
  const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : null;
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, result?.error ?? run.stderr);
  assert.equal(result?.ok, true, result?.error);
});
