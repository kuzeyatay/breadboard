import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Browser navigation against a real Electron window and a real local server.
 *
 * Tabs are `WebContentsView`s the shell stacks inside one window, and almost
 * everything about them — whether the preload bridge reaches a page inside a
 * view, whether a page's commands find the window it is in, what a Ctrl+Tab
 * delivered to a view does, what happens to the window when its last tab
 * closes — can only be seen with the real thing. The fixture pages are plain
 * HTML that subscribe to the tab state the way the dashboard's strip does.
 */
test(
  "a window carries tabs that open, switch, close and reopen like a browser's",
  { skip: process.platform !== "win32" },
  () => {
    const desktopRoot = path.resolve(__dirname, "..", "..");
    const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
    const windowManager = path.join(desktopRoot, "dist", "main", "window-manager.js");
    const windowOptions = path.join(desktopRoot, "dist", "main", "window-options.js");
    const ipcContract = path.join(desktopRoot, "dist", "shared", "ipc-contract.js");
    const preload = path.join(desktopRoot, "dist", "preload", "preload.js");
    for (const required of [electron, windowManager, ipcContract, preload]) {
      assert.ok(fs.existsSync(required), `missing integration-test input: ${required}`);
    }

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tab-manager-"));
    const resultFile = path.join(fixture, "result.json");
    const traceFile = path.join(fixture, "trace.log");
    const startupFile = path.join(fixture, "index.html");
    const recoveryFile = path.join(fixture, "recovery.html");
    const loadingFile = path.join(fixture, "loading.html");
    const loadingColour = "#c7a43a";
    fs.writeFileSync(startupFile, "<!doctype html><html><body>startup fixture</body></html>");
    fs.writeFileSync(
      loadingFile,
      `<!doctype html><html><body style="margin:0;min-height:100vh;background:${loadingColour}">loading fixture</body></html>`,
    );
    fs.writeFileSync(
      recoveryFile,
      "<!doctype html><html><head><title>fixture recovery</title></head><body>reconnecting</body></html>",
    );
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
    fs.writeFileSync(
      path.join(fixture, "main.cjs"),
      `const fs = require("node:fs");
const http = require("node:http");
const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require("electron");
// Every page the shell creates, so background tabs — which are not in the
// window's view tree until they come to the front — can still be found.
const created = [];
app.on("web-contents-created", (_event, contents) => created.push(contents));
const { WindowManager } = require(${JSON.stringify(windowManager)});
const { BREADBOARD_TITLE_BAR } = require(${JSON.stringify(windowOptions)});
const { IPC_CHANNELS, isTabsCommand } = require(${JSON.stringify(ipcContract)});
const resultFile = ${JSON.stringify(resultFile)};
const traceFile = ${JSON.stringify(traceFile)};
const trace = (step) => fs.appendFileSync(traceFile, step + "\\n");
process.on("uncaughtException", (error) => {
  trace("uncaught: " + (error && error.stack ? error.stack : String(error)));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (probe, label, timeoutMs = 10_000) => {
  const started = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for " + label);
    await sleep(25);
  }
};
// Every page records the tab states it is sent, the way the dashboard's strip
// draws them, so the test can read what a page inside a view was told. Each
// place has a colour of its own so a screen capture can say which page is
// the window's paint.
const PAGE_COLOURS = { garden: "#1f372f", fresh: "#5a2d82" };
const PAGE_NAVBAR_COLOUR = "#246d58";
const page = (title) => \`<!doctype html><html><head><title>\${title}</title><style>html,body{min-height:100%;margin:0;background:\${PAGE_COLOURS[title] || "#2d3b55"};color:#f3efe5}header{height:101px;background:\${PAGE_NAVBAR_COLOUR}}</style></head><body><header aria-label="Garden navbar"></header>
<script>
window.__states = [];
window.breadboardDesktop.onTabsState((state) => { window.__states.push(state); });
</script>\${title}</body></html>\`;
const server = http.createServer((request, response) => {
  const title = request.url.replace(/^\\/+/, "").replace(/\\?.*$/, "") || "home";
  const send = () => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page(title));
  };
  // A route compile or server component can leave a new tab without a first
  // document for a moment. Make that gap deterministic so the test can prove
  // the shared loading field covers its body without replacing the navbar.
  if (request.url === "/fresh?cold=1") setTimeout(send, 5_000);
  else send();
});
// The last tab closing closes the window; the fixture still has a result to
// write after that, so the app must not quit on its own.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const origin = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve("http://127.0.0.1:" + server.address().port));
  });
  trace("listening " + origin);
  const manager = new WindowManager({
    startupHtmlPath: ${JSON.stringify(startupFile)},
    recoveryHtmlPath: ${JSON.stringify(recoveryFile)},
    loadingHtmlPath: ${JSON.stringify(loadingFile)},
    preloadPath: ${JSON.stringify(preload)},
    minimumStartupVisibleMs: 0,
    allowed: {
      origins: new Set([origin]),
      localFiles: new Set([
        require("node:url").pathToFileURL(${JSON.stringify(startupFile)}).toString(),
        require("node:url").pathToFileURL(${JSON.stringify(recoveryFile)}).toString(),
        require("node:url").pathToFileURL(${JSON.stringify(loadingFile)}).toString(),
      ]),
    },
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, (event) => manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) =>
    isTabsCommand(command) ? manager.tabs.handleCommand(event.sender, command) : false,
  );
  manager.tabs.setNewTabUrl(origin + "/fresh");

  const window = manager.createMainWindow();
  // The window's own contents are the persistent shell; its first tab is a view.
  const base = manager.page(window);
  await base.loadURL(origin + "/dashboard");
  window.show();
  // The screen captures below must see this window and nothing over it. Other
  // fixtures running alongside open windows of their own, so this one keeps to
  // a corner and stays on top.
  window.setBounds({ x: 24, y: 24, width: 760, height: 540 });
  window.setAlwaysOnTop(true);
  const stateIn = (contents) => contents.executeJavaScript("window.breadboardDesktop.getTabsState()");
  const command = (contents, value) =>
    contents.executeJavaScript("window.breadboardDesktop.tabs(" + JSON.stringify(value) + ")");
  const isOwnedPage = (contents) => {
    const url = contents.getURL();
    return url === "" || url.startsWith(origin + "/");
  };
  // What is actually on the screen at the middle of the window's tab body.
  // Capturing a page's own webContents proves nothing about the screen: the
  // window's capturePage sees only its own page, never the views over it.
  const screenPixelInWindow = async (contentOffsetY) => {
    const display = screen.getDisplayMatching(window.getBounds());
    const scale = display.scaleFactor;
    const thumbnailSize = {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    };
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const source =
      sources.find((candidate) => String(candidate.display_id) === String(display.id)) || sources[0];
    const image = source.thumbnail;
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const content = window.getContentBounds();
    const px = Math.round(((content.x - display.bounds.x + content.width / 2) * size.width) / display.bounds.width);
    const y = contentOffsetY === undefined
      ? 32 + (content.height - 32) / 2
      : contentOffsetY;
    const py = Math.round(((content.y - display.bounds.y + y) * size.height) / display.bounds.height);
    const offset = (py * size.width + px) * 4;
    const hex = (value) => value.toString(16).padStart(2, "0");
    // A window that is minimized for a moment has no content area to sample.
    if (size.width < 1 || size.height < 1 || offset < 0 || bitmap.length < offset + 4) return { hasPixels: false, colour: "" };
    return {
      hasPixels: true,
      colour: "#" + hex(bitmap[offset + 2]) + hex(bitmap[offset + 1]) + hex(bitmap[offset]),
    };
  };
  const screenPixelAtWindowCenter = () => screenPixelInWindow();
  // Tab pages of the window: everything created that is not some window's own page.
  const viewsOf = (win) =>
    created
      .filter((contents) => !contents.isDestroyed() && contents !== win.webContents)
      .filter((contents) => !BrowserWindow.getAllWindows().some((w) => w.webContents === contents))
      .filter((contents) => manager.tabs.windowFor(contents) === win && manager.tabs.stateFor(contents).selfId !== null)
      .filter(isOwnedPage)
      .map((contents) => ({ webContents: contents }));
  // Earlier tabs may stay attached beneath it; only the frontmost page is seen.
  const visibleViews = (win) =>
    win.contentView.children
      .filter((child) => child.webContents && isOwnedPage(child.webContents))
      .filter((child) => child.getBounds().x === 0 && child.getBounds().y === BREADBOARD_TITLE_BAR.height)
      .slice(-1)
      .map((view) => ({ webContents: view.webContents }));

  // The window's own page is its first tab.
  const initial = await stateIn(base);
  trace("initial " + JSON.stringify(initial));

  // "Open in new tab" from the context menu: beside this page, in the background.
  const openedInBackground = await command(base, { type: "open", url: origin + "/garden", background: true });
  const afterBackgroundOpen = await until(async () => {
    const state = await stateIn(base);
    return state.tabs.length === 2 ? state : null;
  }, "the background tab");
  const gardenId = afterBackgroundOpen.tabs[1].id;
  const gardenView = await until(
    () => viewsOf(window).find((view) => view.webContents.getURL().endsWith("/garden")),
    "the garden tab view",
  );
  await until(() => !gardenView.webContents.isLoading(), "the garden tab to load");
  const backgroundStaysBehind = {
    active: afterBackgroundOpen.activeId,
    visibleViews: visibleViews(window).length,
    // The bridge reaches a page inside a view, and that page is told the same
    // strip as the window's own page.
    stateSeenInsideView: await stateIn(gardenView.webContents),
    statesPushedToView: await gardenView.webContents.executeJavaScript("window.__states.length"),
    ownerWindowFound: manager.tabs.windowFor(gardenView.webContents) === window,
  };

  // Clicking the tab in the strip brings it to the front once it has painted.
  await command(base, { type: "activate", id: gardenId });
  await until(
    () =>
      visibleViews(window)[0]?.webContents === gardenView.webContents &&
      visibleViews(window).length === 1,
    "the garden view to be shown",
  );
  const afterActivate = {
    state: await stateIn(gardenView.webContents),
    title: window.getTitle(),
  };

  // Ctrl+Tab inside the view cycles back to the window's own page.
  // A busy page may not yield an idle callback for seconds. Once that page has
  // already painted, returning to it must reuse its compositor frame instead
  // of making tab navigation wait for another readiness probe.
  await gardenView.webContents.executeJavaScript(
    "window.requestIdleCallback = () => 1; true",
  );
  gardenView.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["control"] });
  await until(
    () => visibleViews(window).length === 1 && visibleViews(window)[0].webContents === base,
    "Ctrl+Tab to return to the first tab",
  );
  const afterCtrlTab = await stateIn(base);

  // Put the second tab back in front. The next cold tab is therefore a real
  // view-to-view handoff: the exact third-tab path where an inert full-window
  // snapshot used to swallow the caption strip's close and plus presses.
  const warmReactivateStarted = Date.now();
  await command(base, { type: "activate", id: gardenId });
  await until(
    () =>
      visibleViews(window)[0]?.webContents === gardenView.webContents &&
      visibleViews(window).length === 1,
    "the second tab to be in place before opening the third",
  );
  const warmReactivateMs = Date.now() - warmReactivateStarted;
  // Deliberately not waiting for it to settle: a tab still in its first-frame
  // check must stay on screen when the next one has to load out of sight.

  // Ctrl+T opens the new-tab page in front; a link tab sits beside its opener,
  // a blank one goes to the end. Changing the URL invalidates the prepared
  // launcher, so this click exercises a cold load and its shared loading field.
  manager.tabs.setNewTabUrl(origin + "/fresh?cold=1");
  gardenView.webContents.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers: ["control"] });
  const afterCtrlT = await until(async () => {
    const state = await stateIn(base);
    return state.tabs.length === 3 ? state : null;
  }, "Ctrl+T");
  // A new-tab page has its own readiness: while it is cold the previous tab
  // stays on screen with the live strip, and no loading screen covers either.
  const priorHeldDuringColdLoad = visibleViews(window)[0]?.webContents === gardenView.webContents;
  const loadingFieldAttached = window.contentView.children.some(
    (child) => child.webContents && child.webContents.getURL().includes("loading.html"),
  );
  const stateSeenInPrior = await stateIn(gardenView.webContents);
  const arriving = await until(
    () => {
      const front = visibleViews(window);
      return front.length === 1 && front[0].webContents !== gardenView.webContents ? front[0] : null;
    },
    "the cold tab to take over the tab area",
    15_000,
  );
  const [contentWidth, contentHeight] = window.getContentSize();
  const arrivingView = window.contentView.children.find((child) => child.webContents === arriving.webContents);
  const fillsTabArea = (bounds) =>
    bounds.x === 0 &&
    bounds.y === BREADBOARD_TITLE_BAR.height &&
    bounds.width === contentWidth &&
    bounds.height === contentHeight - BREADBOARD_TITLE_BAR.height;
  const transitionLayout = {
    priorHeldDuringColdLoad,
    loadingFieldAttached,
    stateSeenInPrior,
    arrivingFillsTabArea: fillsTabArea(arrivingView.getBounds()),
  };
  await until(() => !arriving.webContents.isLoading() && arriving.webContents.getURL() !== "", "the cold tab to finish loading", 15_000);
  const freshView = arriving;
  const freshFillsWindow = fillsTabArea(arrivingView.getBounds());
  const screenAfterHandoff = await until(async () => {
    const pixel = await screenPixelAtWindowCenter();
    return pixel.colour === PAGE_COLOURS.fresh ? pixel : null;
  }, "the screen to show the fresh tab", 8_000);
  trace("afterCtrlT " + JSON.stringify(afterCtrlT));
  await until(() => !freshView.webContents.isLoading(), "the fresh tab to load");
  const freshTitle = await freshView.webContents.executeJavaScript("document.title");
  trace("fresh title read");

  // Ctrl+W in the front tab closes it and the tab to its left takes over.
  freshView.webContents.sendInputEvent({ type: "keyDown", keyCode: "W", modifiers: ["control"] });
  const afterCtrlW = await until(async () => {
    const state = await stateIn(base);
    return state.tabs.length === 2 ? state : null;
  }, "Ctrl+W");
  trace("Ctrl+W completed");
  await until(
    () => visibleViews(window)[0]?.webContents.getURL().endsWith("/garden"),
    "the garden tab to return after closing the fresh tab",
  );
  // A replacement new-tab page may already be warming in the background; it
  // is not part of the strip. What matters here is that closing the front tab
  // leaves exactly one page attached to the window.
  const attachedViewsAfterClose = visibleViews(window).length;

  // Ctrl+Shift+T brings the closed one back.
  base.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers: ["control", "shift"] });
  const afterReopen = await until(async () => {
    const state = await stateIn(base);
    return state.tabs.length === 3 ? state : null;
  }, "Ctrl+Shift+T");
  trace("Ctrl+Shift+T completed");
  await until(
    () =>
      visibleViews(window)[0]?.webContents.getURL().includes("/fresh?cold=1") &&
      visibleViews(window).length === 1,
    "the reopened tab to be shown",
    15_000,
  );

  // Closing the window's own page while other tabs remain keeps the window:
  // that page is parked blank underneath and the next tab comes forward.
  await command(gardenView.webContents, { type: "close", id: initial.tabs[0].id });
  const afterBaseClose = await until(async () => {
    const state = await stateIn(gardenView.webContents);
    return state.tabs.length === 2 ? state : null;
  }, "closing the window's own page");
  await until(() => base.getURL() === "about:blank", "the window's own page to be parked");
  trace("base retired");
  const windowSurvivedBaseClose = !window.isDestroyed() && BrowserWindow.getAllWindows().length === 1;

  // A local window.open that asks for a popup is a window of its own, not a tab.
  await gardenView.webContents.executeJavaScript("window.open(" + JSON.stringify(origin + "/popup") + ", '_blank', 'popup'); true");
  await until(() => BrowserWindow.getAllWindows().length === 2, "the popup window");
  const popup = BrowserWindow.getAllWindows().find((candidate) => candidate !== window);
  await until(() => manager.page(popup).getURL().endsWith("/popup"), "the popup to reach its page");
  const popupState = await stateIn(manager.page(popup));
  popup.destroy();
  trace("popup closed");

  // Closing the remaining tabs closes the window, as it does in a browser.
  const closed = new Promise((resolve) => window.once("closed", resolve));
  for (const tab of afterBaseClose.tabs) {
    const front = visibleViews(window)[0];
    // The last close destroys its renderer before executeJavaScript can return.
    manager.tabs.handleCommand(front.webContents, { type: "close", id: tab.id });
    await sleep(100);
    if (window.isDestroyed()) break;
  }
  await Promise.race([closed, sleep(5_000)]);
  const windowClosedWithLastTab = window.isDestroyed();

  fs.writeFileSync(resultFile, JSON.stringify({
    initial,
    openedInBackground,
    afterBackgroundOpen,
    backgroundStaysBehind,
    afterActivate,
    afterCtrlTab,
    warmReactivateMs,
    afterCtrlT,
    transitionLayout,
    freshFillsWindow,
    screenAfterHandoff,
    freshTitle,
    afterCtrlW,
    attachedViewsAfterClose,
    afterReopen,
    afterBaseClose,
    windowSurvivedBaseClose,
    popupState,
    windowClosedWithLastTab,
  }));
  server.close();
  app.quit();
}).catch((error) => {
  for (const win of BrowserWindow.getAllWindows()) {
    trace("views " + JSON.stringify(win.contentView.children.map((child) => ({ url: child.webContents?.getURL(), bounds: child.getBounds() }))));
  }
  fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error) }));
  server.close();
  app.exit(1);
});
`,
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
    const trace = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, "utf8") : "";
    const partial = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, "utf8") : "";
    assert.equal(
      run.status,
      0,
      `electron stderr: ${run.stderr}\n\nresult: ${partial}\n\ntrace:\n${trace}`,
    );
    assert.ok(fs.existsSync(resultFile), `no result written; stderr: ${run.stderr}\ntrace:\n${trace}`);
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    assert.equal(result.error, undefined, `fixture error: ${result.error}\ntrace:\n${trace}`);

    const titles = (state: { tabs: Array<{ title: string }> }) => state.tabs.map((tab) => tab.title);

    assert.equal(result.initial.enabled, true);
    assert.deepEqual(titles(result.initial), ["dashboard"]);
    assert.equal(result.initial.activeId, result.initial.tabs[0].id);

    assert.equal(result.openedInBackground, true);
    assert.equal(result.backgroundStaysBehind.active, result.initial.tabs[0].id);
    assert.equal(result.backgroundStaysBehind.visibleViews, 1, "only the first tab is on screen");
    assert.deepEqual(titles(result.backgroundStaysBehind.stateSeenInsideView), ["dashboard", "garden"]);
    assert.ok(result.backgroundStaysBehind.statesPushedToView >= 1);

    assert.equal(result.afterActivate.state.activeId, result.afterBackgroundOpen.tabs[1].id);
    assert.equal(result.afterActivate.title, "garden");

    assert.equal(result.afterCtrlTab.activeId, result.initial.tabs[0].id);
    assert.ok(
      result.warmReactivateMs < 750,
      `a painted tab should reactivate without waiting for page idle (${result.warmReactivateMs}ms)`,
    );

    // Ctrl+T's page is rendered ahead of time when it can be, so the third tab
    // may already carry its title the moment it appears.
    assert.deepEqual(titles(result.afterCtrlT).slice(0, 2), ["dashboard", "garden"]);
    assert.ok(["", "fresh"].includes(result.afterCtrlT.tabs[2].title));
    assert.equal(result.afterCtrlT.activeId, result.afterCtrlT.tabs[2].id);
    assert.equal(result.transitionLayout.priorHeldDuringColdLoad, true, "the previous tab stays on screen while a new-tab page is cold");
    assert.equal(result.transitionLayout.loadingFieldAttached, false, "the shell's progress bar replaces a loading screen");
    assert.equal(result.transitionLayout.arrivingFillsTabArea, true, "the ready tab owns the area below the title bar");
    assert.equal(result.transitionLayout.stateSeenInPrior.tabs.length, 3);
    assert.equal(
      result.transitionLayout.stateSeenInPrior.activeId,
      result.afterCtrlT.tabs[2].id,
      "the live strip on the previous page must carry the third-tab controls",
    );
    assert.equal(result.freshFillsWindow, true);
    assert.equal(
      result.screenAfterHandoff.colour,
      "#5a2d82",
      "the screen must show the fresh tab once it has painted",
    );
    assert.equal(result.freshTitle, "fresh");

    assert.deepEqual(titles(result.afterCtrlW), ["dashboard", "garden"]);
    assert.equal(result.afterCtrlW.activeId, result.afterCtrlW.tabs[1].id);
    assert.equal(result.attachedViewsAfterClose, 1);

    assert.equal(result.afterReopen.tabs.length, 3);
    assert.equal(result.afterReopen.activeId, result.afterReopen.tabs[2].id);

    assert.deepEqual(
      result.afterBaseClose.tabs.map((tab: { id: number }) => tab.id),
      result.afterReopen.tabs.slice(1).map((tab: { id: number }) => tab.id),
    );
    // The page in front was not the one closed, so it stays in front.
    assert.equal(result.afterBaseClose.activeId, result.afterReopen.activeId);
    assert.equal(result.windowSurvivedBaseClose, true);
    // A background tab's view is not in the window's view tree, so Electron
    // cannot name its window; the manager can, which is what the theme and
    // location requests a tab makes rely on.
    assert.equal(result.backgroundStaysBehind.ownerWindowFound, true);

    assert.deepEqual(titles(result.popupState), ["popup"]);
    assert.equal(result.windowClosedWithLastTab, true);

    fs.rmSync(fixture, { recursive: true, force: true });
  },
);
