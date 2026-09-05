import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test(
  "real Electron window loads the sandboxed preload bridge",
  { skip: process.platform !== "win32" },
  () => {
    const desktopRoot = path.resolve(__dirname, "..", "..");
    const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
    const windowManager = path.join(desktopRoot, "dist", "main", "window-manager.js");
    const ipcContract = path.join(desktopRoot, "dist", "shared", "ipc-contract.js");
    const preload = path.join(desktopRoot, "dist", "preload", "preload.js");
    for (const required of [electron, windowManager, ipcContract, preload]) {
      assert.ok(fs.existsSync(required), `missing integration-test input: ${required}`);
    }

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-electron-integration-"));
    const resultFile = path.join(fixture, "result.json");
    const htmlFile = path.join(fixture, "index.html");
    const recoveryFile = path.join(fixture, "recovery.html");
    const dashboardFile = path.join(fixture, "dashboard.html");
    fs.writeFileSync(htmlFile, "<!doctype html><html><body>bridge fixture</body></html>");
    fs.writeFileSync(
      recoveryFile,
      "<!doctype html><html><head><title>fixture recovery</title></head><body>reconnecting</body></html>",
    );
    fs.writeFileSync(
      dashboardFile,
      "<!doctype html><html><head><title>fixture dashboard</title></head><body>dashboard</body></html>",
    );
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
    fs.writeFileSync(
      path.join(fixture, "main.cjs"),
      `const fs = require("node:fs");
const { app, ipcMain } = require("electron");
const { WindowManager } = require(${JSON.stringify(windowManager)});
const { IPC_CHANNELS } = require(${JSON.stringify(ipcContract)});
const resultFile = ${JSON.stringify(resultFile)};
app.whenReady().then(async () => {
  ipcMain.handle(IPC_CHANNELS.getVersions, () => ({ app: "0.1.0", electron: process.versions.electron }));
  ipcMain.handle(IPC_CHANNELS.getStartupState, () => ({ phase: "preparing", message: "Preparing", services: [] }));
  ipcMain.handle(IPC_CHANNELS.setTheme, () => true);
  const manager = new WindowManager({
    startupHtmlPath: ${JSON.stringify(htmlFile)},
    recoveryHtmlPath: ${JSON.stringify(recoveryFile)},
    preloadPath: ${JSON.stringify(preload)},
    initialTheme: "dark",
    allowed: {
      origins: new Set(),
      localFiles: new Set([
        require("node:url").pathToFileURL(${JSON.stringify(htmlFile)}).toString(),
        require("node:url").pathToFileURL(${JSON.stringify(recoveryFile)}).toString(),
        require("node:url").pathToFileURL(${JSON.stringify(dashboardFile)}).toString(),
      ]),
    },
  });
  await manager.showStartupScreen();
  const window = manager.window;
  const sameWindow = manager.createMainWindow() === window;
  const visible = window.isVisible();
  const startupThemeQuery = new URL(window.webContents.getURL()).searchParams.get("theme");
  const keys = await window.webContents.executeJavaScript("Object.keys(window.breadboardDesktop).sort()");
  const versions = await window.webContents.executeJavaScript("window.breadboardDesktop.getVersions()");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "F11" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const f11EnteredFullScreen = window.isFullScreen();
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "F11" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const f11ExitedFullScreen = !window.isFullScreen();
  // Reproduce the normal maximized launch. The replacement must enter this
  // native state while it is still transparent, not animate into it after the
  // welcome is dismissed.
  if (!window.isMaximized()) {
    await new Promise((resolve) => {
      window.once("maximize", resolve);
      window.maximize();
    });
  }
  await window.webContents.executeJavaScript(
    "window.__breadboardStatePromise = new Promise((resolve) => { const off = window.breadboardDesktop.onStartupState((state) => { off(); resolve(state); }); }); true",
  );
  manager.sendToRenderer(IPC_CHANNELS.startupState, { phase: "ready", message: "Ready", services: [] });
  const state = await window.webContents.executeJavaScript("window.__breadboardStatePromise");
  const preferences = window.webContents.getLastWebPreferences();

  // The dashboard is rendered out of sight while the welcome is up, then takes
  // the startup window's place instead of navigating it.
  const startupBounds = window.getBounds();
  const dashboardUrl = require("node:url").pathToFileURL(${JSON.stringify(dashboardFile)}).toString();
  // Start the handoff but leave the welcome standing, so the preloading window
  // can be inspected in the state it spends the whole startup screen in.
  const swapped = manager.showDashboard(dashboardUrl);
  const preload = await new Promise((resolve) => {
    const poll = () => (manager.dashboardPreload ? resolve(manager.dashboardPreload) : setTimeout(poll, 20));
    poll();
  });
  await preload.settled;
  const preloadWindow = preload.window;
  const preloading = {
    isTheMainWindow: preloadWindow === manager.window,
    opacity: preloadWindow.getOpacity(),
    offScreen: preloadWindow.getPosition()[0] < -10000,
    startupBounds,
    preloadBounds: preloadWindow.getBounds(),
    // Within a pixel: bounds round-trip through the display's scale factor, so
    // an exact match is not available on every machine. What matters is that
    // the page is not laid out at one size and revealed at another.
    sizedLikeTheStartupWindow:
      Math.abs(preloadWindow.getBounds().width - startupBounds.width) <= 2 &&
      Math.abs(preloadWindow.getBounds().height - startupBounds.height) <= 2,
    maximizedBeforeWelcomeDismissal: preloadWindow.isMaximized(),
    // The whole point of the arrangement: a window that is merely hidden runs
    // its scripts and its animation frames but is never rasterized, so the swap
    // would reveal a window with nothing painted in it.
    paints: await preloadWindow.webContents.executeJavaScript(
      "performance.getEntriesByType('paint').map((entry) => entry.name)",
    ),
  };
  let maximizeEventsAfterWelcomeDismissal = 0;
  preloadWindow.on("maximize", () => {
    maximizeEventsAfterWelcomeDismissal += 1;
  });
  manager.markStartupContinued();
  await swapped;
  const dashboardWindow = manager.window;
  const swap = {
    replacedTheStartupWindow: dashboardWindow !== window && window.isDestroyed(),
    visible: dashboardWindow.isVisible(),
    opacity: dashboardWindow.getOpacity(),
    onScreen: dashboardWindow.getPosition()[0] > -10000,
    keptBounds: JSON.stringify(dashboardWindow.getBounds()) === JSON.stringify(startupBounds),
    title: await dashboardWindow.webContents.executeJavaScript("document.title"),
    url: dashboardWindow.webContents.getURL(),
    windowCount: require("electron").BrowserWindow.getAllWindows().length,
    maximizeEventsAfterWelcomeDismissal,
  };

  // A dashboard renderer can disappear while the supervised Next.js service
  // restarts. The visible window should become a local recovery scene while a
  // fresh dashboard paints offscreen, then be replaced in one finished swap.
  const recoveryPage = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("recovery page did not appear")), 10_000);
    dashboardWindow.webContents.on("did-finish-load", async () => {
      if (dashboardWindow.isDestroyed()) return;
      const title = await dashboardWindow.webContents.executeJavaScript("document.title");
      if (title !== "fixture recovery") return;
      clearTimeout(timer);
      resolve({
        title,
        visible: dashboardWindow.isVisible(),
        theme: new URL(dashboardWindow.webContents.getURL()).searchParams.get("theme"),
      });
    });
  });
  dashboardWindow.webContents.forcefullyCrashRenderer();
  const recovery = await recoveryPage;
  const recoveredWindow = await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (manager.window && manager.window !== dashboardWindow) return resolve(manager.window);
      if (Date.now() - started > 15_000) return reject(new Error("dashboard was not recovered"));
      setTimeout(poll, 20);
    };
    poll();
  });
  const recovered = {
    replacedFailedWindow: dashboardWindow.isDestroyed(),
    visible: recoveredWindow.isVisible(),
    opacity: recoveredWindow.getOpacity(),
    onScreen: recoveredWindow.getPosition()[0] > -10000,
    keptBounds: JSON.stringify(recoveredWindow.getBounds()) === JSON.stringify(startupBounds),
    title: await recoveredWindow.webContents.executeJavaScript("document.title"),
    url: recoveredWindow.webContents.getURL(),
    windowCount: require("electron").BrowserWindow.getAllWindows().length,
  };

  fs.writeFileSync(resultFile, JSON.stringify({
    keys,
    versions,
    state,
    sameWindow,
    visible,
    startupThemeQuery,
    f11EnteredFullScreen,
    f11ExitedFullScreen,
    preferences,
    preloading,
    swap,
    recovery,
    recovered,
  }));
  recoveredWindow.destroy();
  app.quit();
}).catch((error) => {
  fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error) }));
  app.exit(1);
});`,
    );

    const electronEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    };
    delete electronEnv["ELECTRON_RUN_AS_NODE"];
    const run = spawnSync(electron, [fixture], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 30_000,
      env: electronEnv,
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `electron stderr: ${run.stderr}`);
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
      error?: string;
      keys: string[];
      versions: { app: string; electron: string };
      state: { phase: string; message: string };
      sameWindow: boolean;
      visible: boolean;
      startupThemeQuery: string | null;
      f11EnteredFullScreen: boolean;
      f11ExitedFullScreen: boolean;
      preferences: Record<string, unknown>;
      preloading: {
        isTheMainWindow: boolean;
        opacity: number;
        offScreen: boolean;
        sizedLikeTheStartupWindow: boolean;
        maximizedBeforeWelcomeDismissal: boolean;
        startupBounds: Record<string, number>;
        preloadBounds: Record<string, number>;
        paints: string[];
      };
      swap: {
        replacedTheStartupWindow: boolean;
        visible: boolean;
        opacity: number;
        onScreen: boolean;
        keptBounds: boolean;
        title: string;
        url: string;
        windowCount: number;
        maximizeEventsAfterWelcomeDismissal: number;
      };
      recovery: {
        title: string;
        visible: boolean;
        theme: string | null;
      };
      recovered: {
        replacedFailedWindow: boolean;
        visible: boolean;
        opacity: number;
        onScreen: boolean;
        keptBounds: boolean;
        title: string;
        url: string;
        windowCount: number;
      };
    };
    assert.equal(result.error, undefined, result.error);
    assert.deepEqual(result.keys, [
      "allowThemeLocation",
      "awaitDashboardReady",
      "closeTeachController",
      "continueToDashboard",
      "copyDiagnostics",
      "getBrowserBookmarks",
      "getBrowserNavigation",
      "getBrowserShortcuts",
      "getClickyState",
      "getCurrentLocationPreference",
      "getStartupSound",
      "getStartupState",
      "getTabsState",
      "getVersions",
      "launchClicky",
      "onNotificationToast",
      "onStartupState",
      "onTabsState",
      "openClickyProject",
      "openLogsFolder",
      "openMicrophoneSettings",
      "openTeachController",
      "pickFolder",
      "publishNotificationToast",
      "quit",
      "resizeNotificationOverlay",
      "restartBreadboard",
      "retryService",
      "setBrowserBookmarks",
      "setBrowserNavigation",
      "setBrowserShortcuts",
      "setCurrentLocationPreference",
      "setStartupSound",
      "setTheme",
      "tabs",
    ]);
    assert.equal(result.versions.app, "0.1.0");
    assert.equal(result.state.phase, "ready");
    assert.equal(result.sameWindow, true);
    assert.equal(result.visible, true);
    assert.equal(result.startupThemeQuery, "dark");
    assert.equal(result.f11EnteredFullScreen, true);
    assert.equal(result.f11ExitedFullScreen, true);
    assert.equal(result.preferences["contextIsolation"], true);
    assert.equal(result.preferences["nodeIntegration"], false);
    assert.equal(result.preferences["sandbox"], true);

    // While the welcome is up the dashboard is out of sight but genuinely
    // rendering. A merely hidden window would report no paint entries at all —
    // it runs its scripts and never rasterizes — and revealing that is what
    // leaves the app showing a flat sheet of its background colour.
    assert.deepEqual(result.preloading.paints, ["first-paint", "first-contentful-paint"]);
    assert.equal(result.preloading.isTheMainWindow, false);
    assert.equal(result.preloading.opacity, 0);
    // Windows places a maximized window on its display even when it was parked
    // offscreen first. Opacity is what keeps that already-final native frame
    // invisible behind the welcome.
    assert.equal(result.preloading.maximizedBeforeWelcomeDismissal, true);
    // Painted at the size it will be revealed at, or the swap is a full relayout.
    assert.equal(
      result.preloading.sizedLikeTheStartupWindow,
      true,
      `preload ${JSON.stringify(result.preloading.preloadBounds)} vs startup ${JSON.stringify(result.preloading.startupBounds)}`,
    );

    // The dashboard was already rendered when the welcome was dismissed, so the
    // click swapped windows rather than starting a page load.
    assert.equal(result.swap.replacedTheStartupWindow, true);
    assert.equal(result.swap.visible, true);
    assert.equal(result.swap.opacity, 1);
    assert.equal(result.swap.onScreen, true);
    assert.equal(result.swap.keptBounds, true);
    assert.equal(result.swap.title, "fixture dashboard");
    assert.match(result.swap.url, /dashboard\.html\?theme=dark$/);
    // Exactly one window survives the swap; a hidden leftover would keep the
    // app alive after the last visible window closed.
    assert.equal(result.swap.windowCount, 1);
    assert.equal(result.swap.maximizeEventsAfterWelcomeDismissal, 0);

    assert.equal(result.recovery.title, "fixture recovery");
    assert.equal(result.recovery.visible, true);
    assert.equal(result.recovery.theme, "dark");
    assert.equal(result.recovered.replacedFailedWindow, true);
    assert.equal(result.recovered.visible, true);
    assert.equal(result.recovered.opacity, 1);
    assert.equal(result.recovered.onScreen, true);
    assert.equal(result.recovered.keptBounds, true);
    assert.equal(result.recovered.title, "fixture dashboard");
    assert.match(result.recovered.url, /dashboard\.html\?theme=dark$/);
    assert.equal(result.recovered.windowCount, 1);
  },
);
