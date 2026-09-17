const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, webContents } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { writeTabSession } = require("../../dist/main/tab-session.js");
const dir = process.argv[2];
const phase = process.argv[3];
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});

const until = async (probe, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out: " + label);
};

app.whenReady().then(async () => {
  // The restored tab's service is not answering yet: its socket is dropped, so
  // the page fails to load exactly the way it does when the dashboard is still
  // starting. Flipping `answering` is that service coming up.
  let answering = false;
  let reconnectRequests = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/reconnect") {
      reconnectRequests += 1;
      if (!answering) {
        req.destroy();
        return;
      }
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body>${url.pathname}</body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  writeTabSession(dir, {
    version: 1,
    windows: [
      {
        activeIndex: 0,
        tabs: [{ kind: "dashboard", url: "/reconnect", anchored: true, title: "Reconnect" }],
      },
    ],
  });
  const startup = path.join(dir, "startup.html");
  const recovery = path.join(dir, "recovery.html");
  fs.writeFileSync(startup, "<!doctype html><html><body>Loading</body></html>");
  fs.writeFileSync(recovery, "<!doctype html><html><body>Reconnecting</body></html>");
  const manager = new WindowManager({
    startupHtmlPath: startup,
    recoveryHtmlPath: recovery,
    loadingHtmlPath: startup,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    minimumStartupVisibleMs: 0,
    tabSessionConfigDir: dir,
    // "abandoned" keeps the service down so the bounded wait has to release the
    // loading screen on its own.
    startupPageLoadMaxWaitMs: 20_000,
    allowed: {
      origins: new Set([origin]),
      localFiles: new Set([
        pathToFileURL(startup).toString(),
        pathToFileURL(recovery).toString(),
      ]),
    },
  });
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  manager.tabs.setBrowserUrl(origin + "/browser");
  await manager.showStartupScreen();
  const loadingWindow = manager.window;
  let shown = false;
  const showing = manager.showDashboard(origin + "/dashboard", origin + "/new-tab").then(() => {
    shown = true;
  });
  manager.markStartupContinued();

  const restoredContents = () =>
    webContents
      .getAllWebContents()
      .filter((contents) => manager.tabs.windowFor(contents))
      .find((contents) => contents.getURL().startsWith(pathToFileURL(recovery).toString()));

  // The failed tab reaches the reconnect scene, and startup keeps waiting.
  await until(() => restoredContents() !== undefined, "the restored tab shows the reconnect scene");
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  assert.equal(shown, false, "startup must not hand off while a restored tab is reconnecting");
  assert.equal(manager.window, loadingWindow, "the loading screen stays up during reconnection");

  if (phase === "abandoned") {
    // A service that never arrives may not hold the app forever: the bounded
    // reconnect allowance releases the loading screen without it.
    await until(() => shown, "startup gives up on an unreachable tab", 40_000);
    await showing;
    assert.equal(loadingWindow.isDestroyed(), true, "the loading window is replaced");
    assert.ok(reconnectRequests > 1, "the tab kept retrying its page");
  } else {
    answering = true;
    await until(() => shown, "startup hands off once the tab reconnects", 40_000);
    await showing;
    assert.equal(loadingWindow.isDestroyed(), true, "the loading window is replaced");
    const restored = webContents
      .getAllWebContents()
      .filter((contents) => manager.tabs.windowFor(contents))
      .map((contents) => contents.getURL());
    assert.ok(
      restored.includes(origin + "/reconnect"),
      "the reconnected page is what the window reveals, not the reconnect scene: " +
        restored.join(", "),
    );
    assert.equal(
      restored.some((url) => url.startsWith(pathToFileURL(recovery).toString())),
      false,
      "no tab is still showing the reconnect scene at reveal",
    );
  }

  manager.tabs.freezeSession();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
