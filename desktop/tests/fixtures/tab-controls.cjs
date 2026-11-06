const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, ipcMain } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const esbuild = require("../../../dashboard/node_modules/esbuild");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await sleep(20);
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const bundle = esbuild.buildSync({
    stdin: { resolveDir: dashboard, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import TitleBar from './src/app/components/desktop-title-bar';
      createRoot(document.getElementById('root')).render(<TitleBar/>);
    ` },
    bundle: true, write: false, outfile: "bundle.js", format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_BREADBOARD_PERF_TRACE": '"0"' },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const globals = fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8");
  const tabCss = globals.slice(globals.indexOf(".desktop-title-bar {"), globals.indexOf(".browser-extensions-menu {"));
  let releaseCold;
  const server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(js); return; }
    res.setHeader("content-type", "text/html");
    if (req.url === "/cold") { releaseCold = () => res.end("<!doctype html><body>Cold website</body>"); return; }
    if (req.url === "/website") { res.end("<!doctype html><title>Website</title><body>Website</body>"); return; }
    res.end(`<!doctype html><title>${req.url}</title><style>
      :root{--paper-surface:#eee;--ink:#222;--ink-muted:#666;--botanical:green}
      body{margin:0;font:13px Arial}button{font:inherit}*{box-sizing:border-box}
      ${tabCss}\n${css}</style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading</body>");
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) },
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"), minimumStartupVisibleMs: 0,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) =>
    isTabsCommand(command) ? manager.tabs.handleCommand(event.sender, command) : false);
  for (const name of ["getBrowserBookmarks", "getBrowserRecentSearches"]) ipcMain.handle(IPC_CHANNELS[name], () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({items:[],error:null}));
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  const base = manager.page(window);
  await base.loadURL(origin + "/dashboard");
  const host = manager.tabs.hosts.get(window.id);
  const controls = host.shell.contents;
  const baseId = host.base.id;
  const command = value => manager.tabs.handleCommand(base, value);
  const hasButton = (contents, selector) => contents.mainFrame.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`);
  const click = async (contents, selector) => {
    const point = await contents.mainFrame.executeJavaScript(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    contents.focus();
    contents.sendInputEvent({ type: "mouseMove", ...point });
    contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  };
  manager.tabs.setBrowserUrl(origin + "/browser");
  command({ type: "browser", url: origin + "/website" });
  const outgoing = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending, "website visible");
  command({ type: "browser", url: origin + "/cold" });
  const cold = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => releaseCold && cold.loaded, "replacement shell ready while its website is delayed");
  await until(() => hasButton(controls, `[data-tab-id="${cold.id}"]`), "outgoing strip shows new selection");
  // The user's first close works, but the old renderer is still the visible
  // strip. Previously its frozen buttons were all rejected from here on.
  await controls.mainFrame.executeJavaScript(`document.querySelector('[data-tab-id="${outgoing.id}"]').focus()`);
  await click(controls, `[data-tab-id="${outgoing.id}"] .bb-tab-close`);
  await until(() => !host.tabs.includes(outgoing), "browser tab closed by its button");
  assert.equal(outgoing.contents.isDestroyed(), false);
  await until(async () => !await hasButton(controls, `[data-tab-id="${outgoing.id}"]`), "closed tab disappears from the retained strip");
  // Hover before reading the button's rectangle: background-tab controls only
  // occupy space on hover or focus, just as in the real app.
  await controls.mainFrame.executeJavaScript(`document.querySelector('[data-tab-id="${baseId}"]').focus()`);
  await click(controls, `[data-tab-id="${baseId}"] .bb-tab-anchor`);
  await until(() => host.base.anchored, "anchor remains usable on retained strip");
  await click(controls, `[data-tab-id="${baseId}"] .bb-tab-anchor`);
  await until(() => !host.base.anchored, "unanchor remains usable on retained strip");
  await click(controls, `[data-tab-id="${cold.id}"] .bb-tab-close`);
  await until(() => !host.tabs.includes(cold) && !host.pending, "second close cancels slow browser and returns to dashboard");
  assert.equal(host.activeId, baseId);
  assert.equal(outgoing.contents.isDestroyed(), false, "one shared home/panel document survives browser closes");
  assert.equal(outgoing.browser.contents, null, "closed website is disposed");
  assert.equal(host.retainedTabControls.size, 0);
  assert.equal(host.tabs.length, 1);
  releaseCold();
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
