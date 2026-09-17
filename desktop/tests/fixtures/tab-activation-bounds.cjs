// Selecting a tab lays the whole window out. Every hidden tab in that window
// used to be handed the same full-window rectangle it already had, so a window
// with many tabs paid a compositor call per tab to change nothing. This counts
// the calls that actually reach the native views across a few switches.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, WebContentsView } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");

const dir = process.argv[2];
const resultFile = path.join(dir, "result.json");

// Count every rectangle that reaches a native view.
let boundsCalls = 0;
const setBounds = WebContentsView.prototype.setBounds;
WebContentsView.prototype.setBounds = function (bounds) {
  boundsCalls += 1;
  return setBounds.call(this, bounds);
};

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
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><body>${request.url}</body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const startup = path.join(dir, "startup.html");
  fs.writeFileSync(startup, "<!doctype html><html><body>start</body></html>");

  const manager = new WindowManager({
    startupHtmlPath: startup,
    recoveryHtmlPath: startup,
    loadingHtmlPath: startup,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    minimumStartupVisibleMs: 0,
    allowed: {
      origins: new Set([origin]),
      localFiles: new Set([pathToFileURL(startup).toString()]),
    },
  });
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  manager.tabs.setBrowserUrl(origin + "/browser");
  await manager.showStartupScreen();
  manager.markStartupContinued();
  await manager.showDashboard(origin + "/dashboard", origin + "/new-tab");
  const window = manager.window;

  // A window with several tabs, as an ordinary session has.
  const opened = [];
  for (let index = 0; index < 6; index += 1) {
    const state = manager.tabs.stateFor(window.webContents);
    manager.tabs.handleCommand(window.webContents, {
      type: "open",
      url: `${origin}/page-${index}`,
      background: true,
    });
    const next = manager.tabs.stateFor(window.webContents);
    const added = next.tabs.find((tab) => !state.tabs.some((old) => old.id === tab.id));
    if (added) opened.push(added.id);
  }
  await until(
    () => manager.tabs.stateFor(window.webContents).tabs.length >= 7,
    "every tab is open",
  );
  // Let the first layout of each new view settle before measuring.
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const tabCount = manager.tabs.stateFor(window.webContents).tabs.length;
  const switches = [opened[0], opened[1], opened[2], opened[0], opened[1]];
  boundsCalls = 0;
  for (const id of switches) {
    manager.tabs.handleCommand(window.webContents, { type: "activate", id });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const perSwitch = boundsCalls / switches.length;

  const result = {
    tabCount,
    switches: switches.length,
    boundsCalls,
    perSwitch,
    activeAfterSwitches: manager.tabs.stateFor(window.webContents).activeId,
    expectedActive: switches[switches.length - 1],
  };
  fs.writeFileSync(resultFile, JSON.stringify(result));

  // The window still switched correctly...
  assert.equal(result.activeAfterSwitches, result.expectedActive,
    "the last selected tab is the active one");
  // ...and a switch no longer costs a native call per tab in the window.
  assert.ok(
    perSwitch < tabCount,
    `a switch sent ${perSwitch} bounds calls for ${tabCount} tabs; unchanged layouts must be free`,
  );

  for (const open of BrowserWindow.getAllWindows()) open.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch((error) => {
  try {
    fs.writeFileSync(resultFile, JSON.stringify({ error: String(error && error.stack || error) }));
  } catch {}
  console.error(error && error.stack || error);
  app.exit(1);
});
