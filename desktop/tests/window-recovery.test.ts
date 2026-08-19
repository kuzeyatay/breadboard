import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The reconnect scene has to lift on its own, and for a long time it did not.
 *
 * A dashboard window that loses its page is retired to the local reconnect
 * scene while a replacement retries the URL offscreen, and both windows share
 * one recovery state. Retiring the window is itself a cross-origin navigation
 * (http: to file:), which tears down the old renderer and fires
 * render-process-gone on the window that is no longer being retried. That
 * handler used to clear the watchdog belonging to the replacement's in-flight
 * load, then return without scheduling anything, because a replacement already
 * existed. Every step of the retry loop is armed by the step before it, so with
 * nothing armed the loop was over: the scene stayed up until the app was killed.
 *
 * This reproduces it against a real server that stops answering, with the
 * timings turned down, and asserts the dashboard comes back.
 */
test(
  "a reconnect survives the retired window's renderer going away",
  { skip: process.platform !== "win32" },
  () => {
    const desktopRoot = path.resolve(__dirname, "..", "..");
    const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
    const windowManager = path.join(desktopRoot, "dist", "main", "window-manager.js");
    const preload = path.join(desktopRoot, "dist", "preload", "preload.js");
    for (const required of [electron, windowManager, preload]) {
      assert.ok(fs.existsSync(required), `missing integration-test input: ${required}`);
    }

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-window-recovery-"));
    const resultFile = path.join(fixture, "result.json");
    // Written as the fixture goes, so a run that hangs instead of failing still
    // says where it stopped. A hung Electron writes no result at all.
    const traceFile = path.join(fixture, "trace.log");
    const startupFile = path.join(fixture, "index.html");
    const recoveryFile = path.join(fixture, "recovery.html");
    fs.writeFileSync(startupFile, "<!doctype html><html><body>startup fixture</body></html>");
    fs.writeFileSync(
      recoveryFile,
      "<!doctype html><html><head><title>fixture recovery</title></head><body>reconnecting</body></html>",
    );
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
    fs.writeFileSync(
      path.join(fixture, "main.cjs"),
      `const fs = require("node:fs");
const http = require("node:http");
const { app } = require("electron");
const { WindowManager } = require(${JSON.stringify(windowManager)});
const resultFile = ${JSON.stringify(resultFile)};
const traceFile = ${JSON.stringify(traceFile)};
const log = [];
const trace = (step) => fs.appendFileSync(traceFile, step + "\\n");
process.on("uncaughtException", (error) => {
  trace("uncaught: " + (error && error.stack ? error.stack : String(error)));
});

// Stands in for the supervised Next.js dev server: it answers, then holds
// requests open without ever replying (a restarting server behind a socket that
// still accepts), then answers again.
let mode = "ok";
const held = [];
const server = http.createServer((request, response) => {
  if (mode === "hang") {
    held.push(response);
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<!doctype html><html><head><title>fixture dashboard</title></head><body>dashboard</body></html>");
});

app.whenReady().then(async () => {
  trace("ready");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dashboardUrl = "http://127.0.0.1:" + server.address().port + "/dashboard";
  trace("listening " + dashboardUrl);

  const manager = new WindowManager({
    startupHtmlPath: ${JSON.stringify(startupFile)},
    recoveryHtmlPath: ${JSON.stringify(recoveryFile)},
    preloadPath: ${JSON.stringify(preload)},
    initialTheme: "light",
    minimumStartupVisibleMs: 0,
    // Long enough that the retired renderer can be killed with a request
    // provably still in flight under it, short enough to abandon within a run.
    loadWatchdogMs: 4_000,
    recoveryHeartbeatMs: 400,
    allowed: {
      origins: new Set(["http://127.0.0.1:" + server.address().port]),
      localFiles: new Set([
        require("node:url").pathToFileURL(${JSON.stringify(startupFile)}).toString(),
        require("node:url").pathToFileURL(${JSON.stringify(recoveryFile)}).toString(),
      ]),
    },
    log: (line) => { log.push(line); trace("[log] " + line); },
  });

  await manager.showStartupScreen();
  trace("startup shown");
  manager.markStartupContinued();
  await manager.showDashboard(dashboardUrl);
  trace("dashboard shown");
  const dashboardWindow = manager.window;
  const startedOnTheDashboard =
    (await dashboardWindow.webContents.executeJavaScript("document.title")) === "fixture dashboard";

  // Every probe below reads the main process, never the renderer: the window
  // under test spends this run with a renderer that has been killed, and
  // executeJavaScript against one of those never settles at all.
  const urlOf = (window) =>
    !window || window.isDestroyed() ? "" : window.webContents.getURL();
  const showingRecoveryScene = (window) => urlOf(window).includes("recovery.html");
  const showingDashboard = (window) => urlOf(window).startsWith(dashboardUrl);
  const titleOf = async (window) => {
    if (!window || window.isDestroyed()) return null;
    return Promise.race([
      window.webContents.executeJavaScript("document.title").catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
  };
  const waitFor = (check, label, timeoutMs) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (check()) return resolve(Date.now() - started);
        if (Date.now() - started > timeoutMs) return reject(new Error(label));
        setTimeout(poll, 25);
      };
      poll();
    });

  // The server stops answering, then the renderer loses its page. Recovery
  // starts, and every retry it makes from here is held open by the server.
  mode = "hang";
  trace("server hanging; crashing the dashboard renderer");
  dashboardWindow.webContents.forcefullyCrashRenderer();
  await waitFor(
    () => showingRecoveryScene(dashboardWindow),
    "the reconnect scene never appeared",
    15_000,
  );
  const showedTheReconnectScene = true;
  trace("reconnect scene up");

  // The first retry is now in flight and will never be answered: the server is
  // holding it, exactly as a restarted dev server orphans the request it was
  // mid-way through. Nothing but the watchdog can end it, which is what makes
  // the next line load-bearing.
  await new Promise((resolve) => setTimeout(resolve, 800));

  // The bug. Retiring a live http: page to a local file: page swaps renderers,
  // and the discarded one reports here. Forcing it makes the race deterministic
  // rather than dependent on how Chromium retires that process.
  trace("crashing the retired window's renderer with a request in flight");
  dashboardWindow.webContents.forcefullyCrashRenderer();
  await waitFor(
    () => showingRecoveryScene(dashboardWindow),
    "the reconnect scene did not come back after its own renderer died",
    15_000,
  );
  const sceneSurvivedTheSecondCrash = true;
  trace("reconnect scene survived");

  // Nothing about the server has changed yet, so the scene is still correct.
  const stillReconnecting = manager.window === dashboardWindow;

  // The server answers new requests again, while the request it already had is
  // left hanging for good. Only a retry loop that still knows to abandon that
  // one and ask again can notice — which is the whole contract under test.
  mode = "ok";
  trace("server answering new requests; waiting for the swap");

  const recoveredAfterMs = await waitFor(
    () =>
      manager.window && manager.window !== dashboardWindow && showingDashboard(manager.window),
    "the dashboard never came back; the reconnect scene was stranded",
    30_000,
  );

  const recovered = manager.window;
  const recoveredTitle = await titleOf(recovered);
  fs.writeFileSync(
    resultFile,
    JSON.stringify({
      startedOnTheDashboard,
      showedTheReconnectScene,
      sceneSurvivedTheSecondCrash,
      stillReconnecting,
      recoveredAfterMs,
      recoveredTitle,
      recoveredVisible: recovered.isVisible(),
      recoveredOnScreen: recovered.getPosition()[0] > -10000,
      recoveredOpacity: recovered.getOpacity(),
      replacedFailedWindow: dashboardWindow.isDestroyed(),
      windowCount: require("electron").BrowserWindow.getAllWindows().length,
      log,
    }),
  );
  trace("recovered");
  recovered.destroy();
  server.close();
  for (const response of held.splice(0)) response.destroy();
  app.exit(0);
}).catch((error) => {
  trace("failed: " + (error && error.stack ? error.stack : String(error)));
  fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error), log }));
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
      timeout: 90_000,
      env: electronEnv,
    });
    const trace = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, "utf8") : "(no trace)";
    assert.equal(run.error, undefined, `${run.error?.message}\nfixture got as far as:\n${trace}`);
    assert.equal(run.status, 0, `electron stderr: ${run.stderr}\ntrace:\n${trace}`);

    const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
      error?: string;
      startedOnTheDashboard: boolean;
      showedTheReconnectScene: boolean;
      sceneSurvivedTheSecondCrash: boolean;
      stillReconnecting: boolean;
      recoveredAfterMs: number;
      recoveredTitle: string | null;
      recoveredVisible: boolean;
      recoveredOnScreen: boolean;
      recoveredOpacity: number;
      replacedFailedWindow: boolean;
      windowCount: number;
      log: string[];
    };
    assert.equal(result.error, undefined, `${result.error}\n${(result.log ?? []).join("\n")}`);

    const logged = result.log.join("\n");
    assert.ok(result.startedOnTheDashboard, "fixture never reached the dashboard");
    assert.ok(result.showedTheReconnectScene, "the reconnect scene never appeared");
    assert.ok(
      result.sceneSurvivedTheSecondCrash,
      `the reconnect scene did not survive its own renderer dying:\n${logged}`,
    );
    assert.ok(result.stillReconnecting, "recovery finished before the server came back");

    // The swap is the whole point: the scene lifts and the dashboard is back in
    // a window that is visible, on screen, and opaque.
    assert.ok(result.replacedFailedWindow, "the failed window was not retired");
    assert.equal(result.recoveredTitle, "fixture dashboard");
    assert.equal(result.recoveredVisible, true);
    assert.equal(result.recoveredOnScreen, true);
    assert.equal(result.recoveredOpacity, 1);
    assert.equal(result.windowCount, 1, "recovery leaked a window");
    assert.ok(
      logged.includes("dashboard came back"),
      `recovery was never reported as finished:\n${logged}`,
    );
  },
);
