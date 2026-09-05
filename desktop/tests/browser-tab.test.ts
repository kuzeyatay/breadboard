import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TabsState } from "../src/shared/ipc-contract";

/** The browser boundary and the two-view layout require real Electron. */
test(
  "Chromium pages live below trusted Breadboard chrome and share its tab model",
  { skip: process.platform !== "win32" },
  () => {
    const desktopRoot = path.resolve(__dirname, "..", "..");
    const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
    const windowManager = path.join(desktopRoot, "dist", "main", "window-manager.js");
    const security = path.join(desktopRoot, "dist", "main", "security.js");
    const browserAgentSession = path.join(
      desktopRoot,
      "dist",
      "main",
      "browser-agent-session.js",
    );
    const ipcContract = path.join(desktopRoot, "dist", "shared", "ipc-contract.js");
    const preload = path.join(desktopRoot, "dist", "preload", "preload.js");
    for (const required of [
      electron,
      windowManager,
      security,
      browserAgentSession,
      ipcContract,
      preload,
    ]) {
      assert.ok(fs.existsSync(required), `missing integration-test input: ${required}`);
    }

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-chromium-tab-"));
    const resultFile = path.join(fixture, "result.json");
    const startupFile = path.join(fixture, "startup.html");
    const recoveryFile = path.join(fixture, "recovery.html");
    const loadingFile = path.join(fixture, "loading.html");
    for (const file of [startupFile, recoveryFile, loadingFile]) {
      fs.writeFileSync(file, "<!doctype html><html><body>fixture</body></html>");
    }
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
    fs.writeFileSync(
      path.join(fixture, "main.cjs"),
      `const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { WindowManager } = require(${JSON.stringify(windowManager)});
const { installGlobalSecurity } = require(${JSON.stringify(security)});
const {
  browserAgentBootstrapUrl,
  configureBrowserAgentDebugging,
  resolveBrowserAgentDebuggingPort,
} = require(${JSON.stringify(browserAgentSession)});
const { IPC_CHANNELS, isTabsCommand } = require(${JSON.stringify(ipcContract)});
const { REVEAL_FRAME_PROBE } = require(path.join(path.dirname(${JSON.stringify(windowManager)}), "first-paint.js"));
const resultFile = ${JSON.stringify(resultFile)};
const browserAgentRunId = "job_" + "a".repeat(64);
const browserAgentTargetUrl = browserAgentBootstrapUrl(browserAgentRunId);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (probe, label, timeoutMs = 15000) => {
  const started = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for " + label);
    await sleep(25);
  }
};
const listen = (server) => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve("http://127.0.0.1:" + server.address().port));
});
const close = (server) => new Promise((resolve) => server.close(resolve));
app.setPath("userData", path.join(${JSON.stringify(fixture)}, "electron-user-data"));
const browserAgentDebuggingPort = configureBrowserAgentDebugging(
  app.commandLine,
  app.getPath("userData"),
);
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const created = [];
  let releaseShellResponse;
  let releaseNewTabResponse;
  let holdNewTab = false;
  let releaseShellFrame;
  const shellFrameGate = new Promise((resolve) => { releaseShellFrame = resolve; });
  let shellFrameWaiting = false;
  app.on("web-contents-created", (_event, contents) => {
    created.push(contents);
    const execute = contents.executeJavaScript.bind(contents);
    contents.executeJavaScript = async (code, ...args) => {
      if (code === REVEAL_FRAME_PROBE && contents.getURL().endsWith("/browser")) {
        shellFrameWaiting = true;
        await shellFrameGate;
      }
      return execute(code, ...args);
    };
  });
  let holdFirstBrowserShell = true;
  const shellServer = http.createServer((request, response) => {
    const title = request.url === "/browser" ? "Browser shell" : "Dashboard";
    if (request.url === "/browser" && holdFirstBrowserShell) {
      holdFirstBrowserShell = false;
      releaseShellResponse = () => send();
      return;
    }
    if (request.url === "/new-tab" && holdNewTab) {
      releaseNewTabResponse = () => send();
      return;
    }
    send();
    function send() {
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<!doctype html><html><head><title>' + title + '</title></head><body>' +
      '<script>window.__states=[];window.breadboardDesktop.onTabsState(s=>window.__states.push(s))<\\/script>' +
      title + '</body></html>');
    }
  });
  const webServer = http.createServer((request, response) => {
    const name = request.url.replace(/^\\/+/, "") || "one";
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<!doctype html><html><head><title>Web ' + name + '</title></head>' +
      '<body style="background:#294f46;color:white">web ' + name +
      (name === "one" ? '<iframe src="/frame"></iframe>' : '') +
      (name === "frame" ? '<script>history.pushState(null,"","/frame-state")<\\/script>' : '') +
      '</body></html>');
  });
  const shellOrigin = await listen(shellServer);
  const webOrigin = await listen(webServer);
  const allowed = {
    origins: new Set([shellOrigin]),
    localFiles: new Set([
      require("node:url").pathToFileURL(${JSON.stringify(startupFile)}).toString(),
      require("node:url").pathToFileURL(${JSON.stringify(recoveryFile)}).toString(),
      require("node:url").pathToFileURL(${JSON.stringify(loadingFile)}).toString(),
    ]),
  };
  installGlobalSecurity(allowed);
  let browserAgentReady = null;
  const manager = new WindowManager({
    allowed,
    startupHtmlPath: ${JSON.stringify(startupFile)},
    recoveryHtmlPath: ${JSON.stringify(recoveryFile)},
    loadingHtmlPath: ${JSON.stringify(loadingFile)},
    preloadPath: ${JSON.stringify(preload)},
    minimumStartupVisibleMs: 0,
    onBrowserAgentPageReady: async (runId, targetUrl) => {
      const cdpPort = await resolveBrowserAgentDebuggingPort(
        browserAgentDebuggingPort,
        targetUrl,
      );
      browserAgentReady = { runId, targetUrl, cdpPort };
      return cdpPort !== null;
    },
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, (event) => manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) =>
    isTabsCommand(command) ? manager.tabs.handleCommand(event.sender, command) : false,
  );
  manager.tabs.setBrowserUrl(shellOrigin + "/browser");
  manager.tabs.setNewTabUrl(shellOrigin + "/new-tab");
  const window = manager.createMainWindow();
  await window.loadURL(shellOrigin + "/dashboard");
  window.show();
  const base = window.webContents;
  const stateIn = (contents) => contents.executeJavaScript("window.breadboardDesktop.getTabsState()");
  const command = (contents, value) =>
    contents.executeJavaScript("window.breadboardDesktop.tabs(" + JSON.stringify(value) + ")");

  const opened = await command(base, { type: "browser", url: webOrigin + "/one" });
  const loadingView = await until(() => window.contentView.children.find((view) =>
    view.webContents.getURL().includes("loading.html")), "cold browser loading view");
  const coldLoadingTop = loadingView.getBounds().y;
  await until(() => releaseShellResponse, "held browser shell request");
  releaseShellResponse();
  await until(() => shellFrameWaiting, "DOM-ready browser shell awaiting its compositor frame");
  // A resize forces a loading-view layout while the arriving shell has DOM
  // but remains parked offscreen. The previous page's navbar is still visible.
  const [loadingWidth, loadingHeight] = window.getContentSize();
  const loadingResize = new Promise((resolve) => window.once("resize", resolve));
  window.setContentSize(loadingWidth - 10, loadingHeight - 10);
  await loadingResize;
  const domReadyLoadingTop = loadingView.getBounds().y;
  const loadingShellView = window.contentView.children.find((view) =>
    view.webContents.getURL().endsWith("/browser"));
  const loadingShellStillOffscreen = loadingShellView.getBounds().y < 0;
  releaseShellFrame();
  const first = await until(async () => {
    const state = await stateIn(base);
    return state.tabs.length === 2 && state.tabs[1].browser && !state.tabs[1].loading ? state : null;
  }, "first browser page");
  const shellContents = await until(() => created.find((contents) =>
    !contents.isDestroyed() && contents.getURL() === shellOrigin + "/browser"), "trusted browser shell");
  const webContents = await until(() => created.find((contents) =>
    !contents.isDestroyed() && contents.getURL() === webOrigin + "/one"), "sandboxed web page");
  await sleep(100);
  const afterSubframeNavigation = await stateIn(base);
  await until(() => window.contentView.children.some((view) => view.webContents === webContents), "web view attachment");
  const webView = window.contentView.children.find((view) => view.webContents === webContents);
  const shellView = window.contentView.children.find((view) => view.webContents === shellContents);
  const webBounds = webView && webView.getBounds();
  const shellBounds = shellView && shellView.getBounds();

  // Use the exact plus-button command, keeping the new route cold. The old
  // shell is still visible and must receive its own browser state, not lose
  // its toolbar because the selected tab is now the internal new-tab page.
  holdNewTab = true;
  const plusOpened = await command(shellContents, { type: "new" });
  await until(() => releaseNewTabResponse, "held plus-button new tab");
  const retainedShellState = await stateIn(shellContents);
  const retainedShellPush = await until(async () => {
    const state = await shellContents.executeJavaScript("window.__states.at(-1)");
    return state?.activeId === retainedShellState.activeId ? state : null;
  }, "outgoing browser receives new selection");
  const plusLoadingTop = loadingView.getBounds().y;
  const retainedShellVisible = window.contentView.children.includes(shellView) &&
    shellView.getBounds().y === 0;
  holdNewTab = false;
  releaseNewTabResponse();
  await command(shellContents, { type: "close", id: retainedShellState.activeId });
  await until(() => !window.contentView.children.includes(loadingView), "return to browser after plus");

  const noBridge = await webContents.executeJavaScript("typeof window.breadboardDesktop");
  const browserPartition = webContents.session === session.fromPartition("persist:breadboard-browser");
  const startsWithLightScheme = await until(
    async () => !(await webContents.executeJavaScript(
      "window.matchMedia('(prefers-color-scheme: dark)').matches",
    )),
    "light browser colour scheme",
  );
  manager.rememberTheme("dark");
  const followsDarkScheme = await until(
    () => webContents.executeJavaScript(
      "window.matchMedia('(prefers-color-scheme: dark)').matches",
    ),
    "dark browser colour scheme",
  );
  manager.rememberTheme("light");
  const navigated = await command(shellContents, { type: "browser-navigate", input: webOrigin + "/two" });
  await until(() => webContents.getURL() === webOrigin + "/two", "address navigation");
  await command(shellContents, { type: "back" });
  await until(() => webContents.getURL() === webOrigin + "/one", "browser history");
  // A successful popup now returns a native Window, which cannot cross IPC.
  const popupOpened = await webContents.executeJavaScript("window.open(" + JSON.stringify(webOrigin + "/popup") + ") !== null");
  if (!popupOpened) throw new Error("browser popup was reported as blocked");
  const popupState = await until(async () => {
    const state = await stateIn(base);
    return state.tabs.length === 3 && state.tabs[2].browser ? state : null;
  }, "window.open browser tab");

  await command(shellContents, { type: "activate", id: first.tabs[0].id });
  await until(
    () => !window.contentView.children.some((view) => view.webContents === webContents),
    "browser page detachment",
  );
  const browserViewsAfterLeaving = window.contentView.children.filter(
    (view) => view.webContents === webContents || view.webContents === shellContents,
  ).length;
  const closed = await command(base, { type: "close", id: first.tabs[1].id });
  await until(async () => (await stateIn(base)).tabs.length === 2, "browser tab close");
  const reopened = await command(base, { type: "reopen" });
  const reopenedState = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return state.tabs.length === 3 && active && active.browser && !active.loading ? state : null;
  }, "browser tab reopen");
  const browserAgentOpened = await command(base, {
    type: "browser-agent",
    runId: browserAgentRunId,
  });
  const browserAgentState = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return state.tabs.length === 4 && active && active.title === "Agent Browser" && active.browser
      ? state
      : null;
  }, "browser-agent tab");
  const browserAgentContents = await until(() => created.find((contents) =>
    !contents.isDestroyed() && contents.getURL() === browserAgentTargetUrl), "browser-agent page");
  const browserAgentNoBridge = await browserAgentContents.executeJavaScript(
    "typeof window.breadboardDesktop",
  );
  const newTabOpened = await command(base, {
    type: "open",
    url: shellOrigin + "/new-tab",
  });
  const newTabContents = await until(
    () =>
      created.find(
        (contents) =>
          !contents.isDestroyed() && contents.getURL() === shellOrigin + "/new-tab",
      ),
    "new-tab page",
  );
  const beforeReplace = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return active && active.url === shellOrigin + "/new-tab" ? state : null;
  }, "active new-tab page");
  const replaced = await command(newTabContents, {
    type: "browser",
    replaceCurrent: true,
    url: webOrigin + "/replacement",
  });
  const replacedState = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return state.tabs.length === beforeReplace.tabs.length &&
      active &&
      active.browser &&
      active.browser.address.endsWith("/replacement")
      ? state
      : null;
  }, "browser replacing new-tab page");
  const newTabRetired = await until(
    () => newTabContents.isDestroyed(),
    "replaced new-tab renderer disposal",
  );
  const knownBrowserShellIds = new Set(created
    .filter((contents) => !contents.isDestroyed() && contents.getURL() === shellOrigin + "/browser")
    .map((contents) => contents.id));
  const blankBrowserPagesBeforeHome = created.filter((contents) =>
    !contents.isDestroyed() &&
    contents.session === session.fromPartition("persist:breadboard-browser") &&
    contents.getURL() === ""
  ).length;
  const homeTabOpened = await command(base, { type: "browser" });
  const homeShellContents = await until(() => created.find((contents) =>
    !contents.isDestroyed() &&
    contents.getURL() === shellOrigin + "/browser" &&
    !knownBrowserShellIds.has(contents.id)), "fresh browser home shell");
  const browserHomeState = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return active && active.browser && active.browser.address === "" ? state : null;
  }, "fresh browser home state");
  const blankBrowserPagesAfterHome = created.filter((contents) =>
    !contents.isDestroyed() &&
    contents.session === session.fromPartition("persist:breadboard-browser") &&
    contents.getURL() === ""
  ).length;
  const homeUsesOnlyTrustedRenderer =
    blankBrowserPagesAfterHome === blankBrowserPagesBeforeHome;
  const homeNavigated = await command(homeShellContents, {
    type: "browser-navigate",
    input: webOrigin + "/from-home",
  });
  const homePageContents = await until(() => created.find((contents) =>
    !contents.isDestroyed() && contents.getURL() === webOrigin + "/from-home"), "page opened from browser home");
  const firstPageFromHome = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return active && active.browser && active.browser.address.endsWith("/from-home") && active.browser.canGoBack
      ? state
      : null;
  }, "first page from browser home has Back");
  const backToHome = await command(homeShellContents, { type: "back" });
  const returnedHome = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return active && active.browser && active.browser.address === "" && active.browser.canGoForward
      ? state
      : null;
  }, "Back returns to browser home");
  const homePageDetached = !window.contentView.children.some(
    (view) => view.webContents === homePageContents,
  );
  const forwardFromHome = await command(homeShellContents, { type: "forward" });
  const returnedToPage = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return active && active.browser && active.browser.address.endsWith("/from-home") ? state : null;
  }, "Forward restores page from browser home");
  const beforeTrustedLink = await stateIn(base);
  const dashboardUrlBeforeTrustedLinks = base.getURL();
  await base.executeJavaScript(
    "location.href = " + JSON.stringify(webOrigin + "/clicked-from-dashboard"),
  );
  const trustedLinkState = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return state.tabs.length === beforeTrustedLink.tabs.length + 1 &&
      active && active.browser && active.browser.address.endsWith("/clicked-from-dashboard")
      ? state
      : null;
  }, "dashboard web link in a Breadboard browser tab");
  const dashboardStayedLocal = base.getURL() === dashboardUrlBeforeTrustedLinks;
  await base.executeJavaScript(
    "window.open(" + JSON.stringify(webOrigin + "/opened-from-dashboard") + ", '_blank')",
  );
  const trustedWindowOpenState = await until(async () => {
    const state = await stateIn(base);
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return state.tabs.length === trustedLinkState.tabs.length + 1 &&
      active && active.browser && active.browser.address.endsWith("/opened-from-dashboard")
      ? state
      : null;
  }, "dashboard window.open in a Breadboard browser tab");
  fs.writeFileSync(resultFile, JSON.stringify({
    opened,
    coldLoadingTop,
    domReadyLoadingTop,
    loadingShellStillOffscreen,
    plusOpened,
    retainedShellState,
    retainedShellPush,
    plusLoadingTop,
    retainedShellVisible,
    first,
    afterSubframeNavigation,
    noBridge,
    browserPartition,
    startsWithLightScheme,
    followsDarkScheme,
    navigated,
    shellBounds,
    webBounds,
    popupState,
    browserViewsAfterLeaving,
    closed,
    reopened,
    reopenedState,
    browserAgentOpened,
    browserAgentState,
    browserAgentReady,
    browserAgentNoBridge,
    newTabOpened,
    beforeReplace,
    replaced,
    replacedState,
    newTabRetired,
    homeTabOpened,
    browserHomeState,
    homeUsesOnlyTrustedRenderer,
    homeNavigated,
    firstPageFromHome,
    backToHome,
    returnedHome,
    homePageDetached,
    forwardFromHome,
    returnedToPage,
    trustedLinkState,
    dashboardStayedLocal,
    trustedWindowOpenState,
  }));
  window.destroy();
  await close(shellServer);
  await close(webServer);
  app.quit();
}).catch((error) => {
  fs.writeFileSync(resultFile, JSON.stringify({ error: error && error.stack ? error.stack : String(error) }));
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
      timeout: 40_000,
      env: electronEnv,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.opened, true);
    assert.equal(result.loadingShellStillOffscreen, true);
    assert.equal(result.coldLoadingTop, 101);
    assert.equal(result.plusOpened, true);
    assert.equal(result.retainedShellVisible, true, "the outgoing navbar remains onscreen during plus loading");
    assert.equal(result.plusLoadingTop, 101, "the plus loader meets the retained navbar");
    for (const state of [result.retainedShellState, result.retainedShellPush] as TabsState[]) {
      assert.notEqual(state.selfId, state.activeId);
      assert.equal(state.selfId, result.first.tabs[1].id, "reads and pushes identify the owning browser tab");
      assert.equal(state.tabs.find((tab) => tab.id === state.selfId)?.browser?.address.endsWith("/one"), true);
      assert.equal(state.tabs.find((tab) => tab.id === state.activeId)?.browser, undefined);
    }
    assert.equal(
      result.domReadyLoadingTop,
      101,
      "DOM-ready must not expose a 34px gap while the browser chrome is still offscreen",
    );
    assert.equal(result.noBridge, "undefined", "untrusted pages never receive the desktop bridge");
    assert.equal(result.browserPartition, true, "browser storage is isolated from the dashboard");
    assert.equal(result.startsWithLightScheme, true, "browser pages start in Breadboard light mode");
    assert.equal(result.followsDarkScheme, true, "browser pages follow a live Breadboard theme change");
    assert.equal(result.navigated, true);
    assert.equal(result.first.tabs[1].browser.address.endsWith("/one"), true);
    assert.equal(
      result.afterSubframeNavigation.tabs[1].browser.address.endsWith("/one"),
      true,
      "an iframe pushState must not replace the top-level browser address",
    );
    assert.equal(result.first.tabs[1].browser.canGoBack, false);
    assert.equal(result.first.tabs[1].title, "Web one");
    assert.equal(result.shellBounds.y, 0);
    assert.equal(
      result.webBounds.y,
      135,
      "the web begins below the 32px tabs, 69px toolbar, and 34px bookmarks strip",
    );
    assert.equal(result.webBounds.x, 40, "the trusted Terminal launcher remains visible");
    assert.equal(
      result.webBounds.width,
      result.shellBounds.width - 40,
      "the sandboxed page cannot cover the trusted browser rail",
    );
    assert.equal(result.popupState.tabs[2].browser.address.endsWith("/popup"), true);
    assert.equal(
      result.browserViewsAfterLeaving,
      0,
      "both browser views detach when its tab leaves",
    );
    assert.equal(result.closed, true);
    assert.equal(result.reopened, true);
    const reopenedTab = result.reopenedState.tabs.find(
      (tab: { id: number }) => tab.id === result.reopenedState.activeId,
    );
    assert.equal(reopenedTab.browser.address.endsWith("/one"), true);
    assert.equal(result.browserAgentOpened, true);
    assert.equal(result.browserAgentNoBridge, "undefined");
    assert.equal(result.browserAgentReady.runId, `job_${"a".repeat(64)}`);
    assert.equal(
      result.browserAgentReady.targetUrl,
      `about:blank#breadboard-browser-agent=job_${"a".repeat(64)}`,
    );
    assert.equal(Number.isInteger(result.browserAgentReady.cdpPort), true);
    assert.equal(result.browserAgentReady.cdpPort >= 1_024, true);
    const browserAgentTab = result.browserAgentState.tabs.find(
      (tab: { id: number }) => tab.id === result.browserAgentState.activeId,
    );
    assert.equal(browserAgentTab.title, "Agent Browser");
    assert.equal(browserAgentTab.browser.address, "");
    assert.equal(result.newTabOpened, true);
    assert.equal(result.replaced, true);
    assert.equal(
      result.replacedState.tabs.length,
      result.beforeReplace.tabs.length,
      "replacing the Where to tab does not add another tab",
    );
    assert.equal(
      result.replacedState.tabs.some(
        (tab: { url: string }) => tab.url.endsWith("/new-tab"),
      ),
      false,
    );
    const replacementBrowserTab = result.replacedState.tabs.find(
      (tab: { id: number }) => tab.id === result.replacedState.activeId,
    );
    assert.equal(replacementBrowserTab.browser.address.endsWith("/replacement"), true);
    assert.equal(result.newTabRetired, true);
    assert.equal(result.homeTabOpened, true);
    const browserHomeTab = result.browserHomeState.tabs.find(
      (tab: { id: number }) => tab.id === result.browserHomeState.activeId,
    );
    assert.equal(browserHomeTab.title, "Browser");
    assert.equal(
      result.homeUsesOnlyTrustedRenderer,
      true,
      "browser home does not allocate an unused sandboxed renderer",
    );
    assert.equal(result.homeNavigated, true);
    const firstPageFromHome = result.firstPageFromHome.tabs.find(
      (tab: { id: number }) => tab.id === result.firstPageFromHome.activeId,
    );
    assert.equal(firstPageFromHome.browser.canGoBack, true, "the first page opened from browser home enables Back");
    assert.equal(result.backToHome, true);
    const returnedHome = result.returnedHome.tabs.find(
      (tab: { id: number }) => tab.id === result.returnedHome.activeId,
    );
    assert.equal(returnedHome.title, "Browser");
    assert.equal(returnedHome.browser.address, "", "Back returns to the trusted browser home");
    assert.equal(result.homePageDetached, true, "browser home is interactive after Back");
    assert.equal(result.forwardFromHome, true);
    const returnedToPage = result.returnedToPage.tabs.find(
      (tab: { id: number }) => tab.id === result.returnedToPage.activeId,
    );
    assert.equal(returnedToPage.browser.address.endsWith("/from-home"), true, "Forward restores the live web page");
    const trustedLinkTab = result.trustedLinkState.tabs.find(
      (tab: { id: number }) => tab.id === result.trustedLinkState.activeId,
    );
    assert.equal(
      trustedLinkTab.browser.address.endsWith("/clicked-from-dashboard"),
      true,
      "a normal external link from Breadboard opens in its built-in browser",
    );
    assert.equal(
      result.dashboardStayedLocal,
      true,
      "an external link never navigates the trusted Breadboard renderer",
    );
    const trustedWindowOpenTab = result.trustedWindowOpenState.tabs.find(
      (tab: { id: number }) => tab.id === result.trustedWindowOpenState.activeId,
    );
    assert.equal(
      trustedWindowOpenTab.browser.address.endsWith("/opened-from-dashboard"),
      true,
      "a target-blank external link from Breadboard opens in its built-in browser",
    );
    fs.rmSync(fixture, { recursive: true, force: true });
  },
);
