import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  BREADBOARD_DARK_TITLE_BAR,
  BREADBOARD_TITLE_BAR,
  BREADBOARD_VOICE_TITLE_BAR,
  backgroundColorForSurface,
  backgroundColorForTheme,
  isWindowSurface,
  mainWindowOptions,
  popupBackgroundColor,
  titleBarForSurface,
  titleBarForTheme,
} from "../src/main/window-options";
import {
  DASHBOARD_PAINT_MAX_WAIT_MS,
  DEFAULT_MINIMUM_STARTUP_VISIBLE_MS,
  FIRST_PAINT_MAX_WAIT_MS,
  FIRST_PAINT_PROBE_MAX_WAIT_MS,
  LOCAL_PAGE_LOAD_WATCHDOG_MS,
  LOCAL_PAGE_RECOVERY_DELAYS_MS,
  WELCOME_GATE_MAX_WAIT_MS,
  WINDOW_VISIBILITY_FALLBACK_MS,
  WindowManager,
  isFullScreenShortcut,
  localPageRecoveryDelayMs,
  remainingStartupVisibleMs,
} from "../src/main/window-manager";

/** A window fake with just enough surface for the recovery paths. */
function fakeWindow(url: string) {
  const webContents = new EventEmitter() as EventEmitter & {
    getURL: () => string;
    stop: () => void;
    executeJavaScript: (code: string, gesture?: boolean) => Promise<unknown>;
  };
  webContents.getURL = () => url;
  const stopped: string[] = [];
  webContents.stop = () => {
    stopped.push(webContents.getURL());
  };
  webContents.executeJavaScript = async () => true;
  const loaded: string[] = [];
  const files: string[] = [];
  const window = Object.assign(new EventEmitter(), {
    webContents,
    stopped,
    loaded,
    files,
    isDestroyed: () => false,
    destroy: () => {},
    // A navigation that answers nothing: no events, and a promise that never
    // settles. This is the shape a restarting dev server can leave behind.
    loadURL: (target: string) => {
      loaded.push(target);
      return new Promise<void>(() => {});
    },
    loadFile: async (file: string) => {
      files.push(file);
    },
  });
  return window;
}

/** Let queued promise callbacks run while the clock is mocked. */
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

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
  assert.deepEqual(options.titleBarOverlay, {
    color: "#faf7ef",
    symbolColor: "#13201b",
    height: 32,
  });
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.webviewTag, false);
  assert.equal(options.webPreferences?.preload, "C:\\app\\preload.js");
  // The dashboard is rendered in a hidden window behind the welcome screen.
  // Throttled, that render never finishes and the handoff lands on a page of
  // empty frames — so Breadboard windows keep running out of sight.
  assert.equal(options.webPreferences?.backgroundThrottling, false);
});

test("non-Windows windows retain native title bars", () => {
  const options = mainWindowOptions("/app/preload.js", undefined, "darwin");
  assert.equal(options.titleBarStyle, undefined);
  assert.equal(options.titleBarOverlay, undefined);
});

test("dark window chrome meshes with the charcoal application palette", () => {
  assert.deepEqual(titleBarForTheme("light"), BREADBOARD_TITLE_BAR);
  assert.deepEqual(titleBarForTheme("dark"), BREADBOARD_DARK_TITLE_BAR);
  assert.deepEqual(BREADBOARD_DARK_TITLE_BAR, {
    color: "#20211f",
    symbolColor: "#e6ebe5",
    height: 32,
  });
  assert.equal(backgroundColorForTheme("light"), "#e6f0e6");
  assert.equal(backgroundColorForTheme("dark"), "#18181a");

  const darkOptions = mainWindowOptions(
    "C:\\app\\preload.js",
    undefined,
    "win32",
    "dark",
  );
  assert.equal(darkOptions.backgroundColor, "#18181a");
  assert.deepEqual(darkOptions.titleBarOverlay, BREADBOARD_DARK_TITLE_BAR);
});

test("a window waits in the colour of the page it is opening", () => {
  // Chat paints its own palette edge to edge; a window that waited in
  // Breadboard's green would flash the wrong app before turning cream.
  assert.equal(popupBackgroundColor("http://localhost:3000/buzz", "light"), "#e6e6b6");
  assert.equal(popupBackgroundColor("http://localhost:3000/buzz", "dark"), "#4a4616");
  // A room deep-link is still Chat.
  assert.equal(
    popupBackgroundColor("http://localhost:3000/buzz/room_abc", "light"),
    "#e6e6b6",
  );
  // A path that merely starts with the same letters is not.
  assert.equal(
    popupBackgroundColor("http://localhost:3000/buzzer", "light"),
    backgroundColorForTheme("light"),
  );
  // Everything else waits in Breadboard's own paper.
  assert.equal(
    popupBackgroundColor("http://localhost:3000/pomodoro", "light"),
    backgroundColorForTheme("light"),
  );
  // An unreadable target must not throw on the way to a window.
  assert.equal(popupBackgroundColor("not a url", "dark"), backgroundColorForTheme("dark"));
});

test("the startup scene stays visible long enough to perceive its motion", () => {
  assert.equal(DEFAULT_MINIMUM_STARTUP_VISIBLE_MS, 2_200);
  assert.equal(WINDOW_VISIBILITY_FALLBACK_MS, 1_500);
  assert.equal(remainingStartupVisibleMs(1_000, 1_500), 1_700);
  assert.equal(remainingStartupVisibleMs(1_000, 3_500), 0);
  assert.equal(remainingStartupVisibleMs(2_000, 1_500), 2_200);
});

test("a failed local page reload retries quickly and then settles into a bounded backoff", () => {
  assert.deepEqual(LOCAL_PAGE_RECOVERY_DELAYS_MS, [250, 500, 1_000, 2_000, 5_000]);
  assert.deepEqual(
    [-2, 0, 1, 2, 3, 4, 5, 99].map(localPageRecoveryDelayMs),
    [250, 250, 500, 1_000, 2_000, 5_000, 5_000, 5_000],
  );
  // Well past a cold route compile: the watchdog breaks deadlocks, and a slow
  // load that is still making progress must never be mistaken for one.
  assert.equal(LOCAL_PAGE_LOAD_WATCHDOG_MS, 90_000);
});

test("a failed dashboard navigation reloads the last owned URL", async () => {
  const target = "http://127.0.0.1:3000/dashboard";
  const manager = new WindowManager({
    allowed: { origins: new Set(["http://127.0.0.1:3000"]) },
    startupHtmlPath: "C:\\app\\startup\\index.html",
    preloadPath: "C:\\app\\preload.js",
  });
  const webContents = new EventEmitter() as EventEmitter & {
    getURL: () => string;
  };
  webContents.getURL = () => "chrome-error://chromewebdata/";
  const loaded: string[] = [];
  const window = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
    loadURL: async (url: string) => {
      loaded.push(url);
    },
  });

  (
    manager as unknown as {
      installLocalPageRecovery: (window: unknown, url: string) => void;
    }
  ).installLocalPageRecovery(window, target);
  webContents.emit(
    "did-fail-load",
    {},
    -102,
    "Connection refused",
    target,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 320));

  assert.deepEqual(loaded, [target]);
  window.emit("closed");
});

test("a navigation that answers nothing is abandoned instead of ending the retry loop", async () => {
  const target = "http://127.0.0.1:3000/dashboard";
  const manager = new WindowManager({
    allowed: { origins: new Set(["http://127.0.0.1:3000"]) },
    startupHtmlPath: "C:\\app\\startup\\index.html",
    preloadPath: "C:\\app\\preload.js",
  });
  const window = fakeWindow("chrome-error://chromewebdata/");

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    (
      manager as unknown as {
        installLocalPageRecovery: (window: unknown, url: string) => void;
      }
    ).installLocalPageRecovery(window, target);
    window.webContents.emit("did-fail-load", {}, -102, "Connection refused", target, true);

    mock.timers.tick(LOCAL_PAGE_RECOVERY_DELAYS_MS[0]);
    await flush();
    assert.deepEqual(window.loaded, [target], "the first retry should have been attempted");

    // The load reports neither success nor failure — the state the stranded
    // reconnect scene was found in. Everything short of the watchdog is silent.
    mock.timers.tick(LOCAL_PAGE_LOAD_WATCHDOG_MS - 1);
    await flush();
    assert.deepEqual(window.loaded, [target], "a load in progress must not be interrupted");

    mock.timers.tick(1);
    await flush();
    assert.equal(window.stopped.length, 1, "the hung navigation should be abandoned");

    mock.timers.tick(LOCAL_PAGE_RECOVERY_DELAYS_MS[1]);
    await flush();
    assert.deepEqual(window.loaded, [target, target], "the loop should still be asking");
  } finally {
    mock.timers.reset();
    window.emit("closed");
  }
});

test("a reconnecting window keeps asking after a load finishes on an error page", async () => {
  const target = "http://127.0.0.1:3000/dashboard";
  const manager = new WindowManager({
    allowed: { origins: new Set(["http://127.0.0.1:3000"]) },
    startupHtmlPath: "C:\\app\\startup\\index.html",
    recoveryHtmlPath: "C:\\app\\startup\\recovery.html",
    preloadPath: "C:\\app\\preload.js",
  });
  const failed = fakeWindow(target);
  const replacement = fakeWindow("chrome-error://chromewebdata/");
  const internals = manager as unknown as {
    mainWindow: unknown;
    buildWindow: () => unknown;
    parkOffscreen: (window: unknown) => void;
    installLocalPageRecovery: (window: unknown, url: string) => void;
  };
  internals.mainWindow = failed;
  internals.buildWindow = () => replacement;
  internals.parkOffscreen = () => {};

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    internals.installLocalPageRecovery(failed, target);
    failed.webContents.emit("did-fail-load", {}, -102, "Connection refused", target, true);
    await flush();
    assert.deepEqual(
      failed.files,
      ["C:\\app\\startup\\recovery.html"],
      "the visible window should show the reconnect scene",
    );

    mock.timers.tick(LOCAL_PAGE_RECOVERY_DELAYS_MS[0]);
    await flush();
    assert.deepEqual(replacement.loaded, [target]);

    // Chromium finishes loading its own error document for a refused
    // connection. Treating that as an outcome is what used to end the loop.
    replacement.webContents.emit("did-finish-load");
    await flush();
    mock.timers.tick(LOCAL_PAGE_RECOVERY_DELAYS_MS[1]);
    await flush();
    assert.deepEqual(
      replacement.loaded,
      [target, target],
      "an error document must not be mistaken for a recovered dashboard",
    );
  } finally {
    mock.timers.reset();
    failed.emit("closed");
    replacement.emit("closed");
  }
});

test("the first-paint probe cannot outlast a wedged renderer", async () => {
  const manager = new WindowManager({
    allowed: { origins: new Set() },
    startupHtmlPath: "C:\\app\\startup\\index.html",
    preloadPath: "C:\\app\\preload.js",
  });
  // The probe caps itself inside the page, so the ceiling around it only has to
  // outlast that; a renderer too busy to run its own timer is what it is for.
  assert.equal(FIRST_PAINT_MAX_WAIT_MS, FIRST_PAINT_PROBE_MAX_WAIT_MS + 3_000);

  const window = fakeWindow("http://127.0.0.1:3000/dashboard");
  window.webContents.executeJavaScript = () => new Promise<unknown>(() => {});
  const waited = Date.now();
  await (
    manager as unknown as {
      waitForFirstPaint: (window: unknown, maxWaitMs?: number) => Promise<void>;
    }
  ).waitForFirstPaint(window, 40);
  assert.ok(Date.now() - waited < 1_000, "the wait should have been capped");
});

test("the dashboard waits behind the welcome screen", async () => {
  const manager = new WindowManager({
    allowed: { origins: new Set() },
    startupHtmlPath: "C:\\app\\startup\\index.html",
    preloadPath: "C:\\app\\preload.js",
  });

  // Nobody has clicked yet, so the gate stays shut.
  let opened = false;
  const pending = manager.waitForStartupContinue().then(() => {
    opened = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, false);

  manager.markStartupContinued();
  await pending;
  assert.equal(opened, true);

  // A dismissal that lands before anyone waits is remembered, so the order the
  // renderer and the service supervisor finish in cannot deadlock startup.
  await manager.waitForStartupContinue();

  // ...and the failsafe is generous enough that it never races a real person.
  assert.equal(WELCOME_GATE_MAX_WAIT_MS, 300_000);
});

test("the startup screen keeps loading until the dashboard behind it has painted", async () => {
  const manager = new WindowManager({
    allowed: { origins: new Set() },
    startupHtmlPath: "C:\\app\\startup\\index.html",
    preloadPath: "C:\\app\\preload.js",
  });

  // Nothing is preloading yet, so the welcome must not be held back for a
  // window that was never started — that would stall the one case already fine.
  const idle = Date.now();
  await manager.waitForDashboardPaint(500);
  assert.ok(Date.now() - idle < 400, "an absent preload should not be waited on");

  // Reaching the preload through the private field keeps this a unit test of
  // the wait rather than of Electron's window lifecycle.
  let settle: (outcome: "loaded" | "failed") => void = () => {};
  (manager as unknown as { dashboardPreload: unknown }).dashboardPreload = {
    window: { isDestroyed: () => false },
    url: "http://127.0.0.1:3000/",
    settled: new Promise<"loaded" | "failed">((resolve) => {
      settle = resolve;
    }),
  };

  // A dashboard that never paints is capped, so it cannot trap anyone here.
  const capped = Date.now();
  await manager.waitForDashboardPaint(60);
  assert.ok(Date.now() - capped >= 40, "the wait should have hit its cap");

  // One that does paint releases the greeting immediately.
  settle("loaded");
  const painted = Date.now();
  await manager.waitForDashboardPaint(10_000);
  assert.ok(Date.now() - painted < 500, "a painted dashboard should not be waited on");

  // Generous, because waiting here is the whole point: it is time the click
  // does not spend. Reaching it means giving up and offering the welcome anyway.
  assert.equal(DASHBOARD_PAINT_MAX_WAIT_MS, 60_000);
});

test("a fresh startup screen asks for the welcome to be dismissed again", async () => {
  const manager = new WindowManager({
    allowed: { origins: new Set() },
    startupHtmlPath: "C:\\app\\startup\\index.html",
    preloadPath: "C:\\app\\preload.js",
    welcomeGateMaxWaitMs: 20,
  });
  manager.markStartupContinued();
  await manager.waitForStartupContinue();

  // showStartupScreen() needs a real window; reaching the same reset through the
  // private field keeps this a unit test of the gate rather than of Electron.
  (manager as unknown as { startupContinued: boolean }).startupContinued = false;
  const started = Date.now();
  await manager.waitForStartupContinue();
  assert.ok(Date.now() - started >= 15, "the gate should have waited for the failsafe");
});

test("fullscreen shortcuts handle F11 directly with a keyboard fallback", () => {
  const input = {
    type: "keyDown",
    key: "F11",
    control: false,
    meta: false,
    shift: false,
    isAutoRepeat: false,
  };
  assert.equal(isFullScreenShortcut(input), true);
  assert.equal(isFullScreenShortcut({ ...input, type: "keyUp" }), false);
  assert.equal(isFullScreenShortcut({ ...input, isAutoRepeat: true }), false);
  assert.equal(
    isFullScreenShortcut({ ...input, key: "f", control: true, shift: true }),
    true,
  );
  assert.equal(isFullScreenShortcut({ ...input, key: "f", control: true }), false);
});

test("a full-screen surface takes the window chrome with it", () => {
  // Voice mode paints the whole window terracotta; a cream caption strip across
  // the top of it reads as a bug rather than as the app frame.
  assert.deepEqual(titleBarForSurface("voice"), BREADBOARD_VOICE_TITLE_BAR);
  assert.deepEqual(BREADBOARD_VOICE_TITLE_BAR, {
    color: "#c1543c",
    symbolColor: "#fdeade",
    height: 32,
  });
  assert.equal(backgroundColorForSurface("voice"), "#c1543c");

  // The themes still resolve the way they did.
  assert.deepEqual(titleBarForSurface("light"), BREADBOARD_TITLE_BAR);
  assert.deepEqual(titleBarForSurface("dark"), BREADBOARD_DARK_TITLE_BAR);
  assert.deepEqual(titleBarForTheme("dark"), titleBarForSurface("dark"));
  assert.equal(backgroundColorForTheme("light"), backgroundColorForSurface("light"));

  // Anything else is refused, so the renderer cannot paint arbitrary chrome.
  assert.equal(isWindowSurface("voice"), true);
  assert.equal(isWindowSurface("light"), true);
  assert.equal(isWindowSurface("sepia"), false);
  assert.equal(isWindowSurface(undefined), false);
});
