const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { app, BrowserWindow, ipcMain, webContents } = require("electron");
const { TabManager, REVEAL_MAX_WAIT_MS } = require("../../dist/main/tab-manager.js");
const { IPC_CHANNELS } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const readyDocuments = new Set();
app.on("web-contents-created", (_event, contents) => {
  contents.on("dom-ready", () => readyDocuments.add(contents.id));
});

const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const requireDashboard = createRequire(path.join(dashboard, "package.json"));
  // Exercise the real browser client, native bridge, progress bar and CSS.
  // Keep account services and decorative widgets out of this local fixture.
  const stubs = {
    "next/navigation": `export const usePathname = () => '/browser'; export const useSearchParams = () => new URLSearchParams();`,
    "next/dynamic": `export default () => () => null;`,
    "@/app/components/hermes/dashboard-agent-terminal": `export default () => null;`,
    "@/app/components/hermes/use-chat-greeting": `export const useChatGreeting = () => ({greeting: {}});`,
    "@/app/components/page-appearance": `export default () => null;`,
    "@/app/components/use-page-appearance": `export const usePageAppearance = () => ({ready: true, hasWallpaper: false, theme: 'light'}); export const useActivePageAppearance = usePageAppearance;`,
    "./browser-home-widgets": `export const AnimatedBrowserGreeting = () => null; export const BrowserQuickLinks = () => null; export const BrowserSiteIcon = () => null; export const ResilientSiteImage = () => null; export const BrowserSketchOutline = () => null; export const GoogleGlyph = () => null; export const SearchGlyph = () => null; export const websiteIconUrl = () => '';`,
    "./browser-home-accessories": `export default () => null;`,
    "./browser-downloads": `export default () => null;`,
    "./use-browser-saved-items": `export const useBrowserSavedItems = () => ({items: [], ready: true, saving: false, save: async () => true});`,
    "./use-browser-recent-searches": `export const useBrowserRecentSearches = () => ({items: [], ready: true,
      remember: async () => { if (window.holdSearchSave) await new Promise(resolve => { window.releaseSearchSave = resolve; }); return true; }});`,
  };
  const bundle = await requireDashboard("esbuild").build({
    stdin: { loader: "tsx", resolveDir: dashboard, contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import BrowserClient from '@/app/browser/browser-client';
      import NavigationProgress from '@/app/components/navigation-progress';
      createRoot(document.getElementById('root')).render(<><NavigationProgress />
        <div className="browser-shell"><BrowserClient showFlowers={false} restoreOwnerKey="navigation-test" /></div></>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": path.join(dashboard, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "account-stubs", setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path: specifier }) => {
        if (specifier in stubs) return { path: specifier, namespace: "stub" };
        if (specifier.endsWith(".module.css")) return { path: specifier, namespace: "css-stub" };
      });
      build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: specifier }) => ({ contents: stubs[specifier], loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({ contents: `export default {};`, loader: "js" }));
    } }],
  });
  const css = fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8");
  const shellServer = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/global.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    res.setHeader("Content-Type", "text/html");
    if (req.url !== "/browser") return res.end('<!doctype html><title>Previous dashboard</title><body style="background:magenta">Previous dashboard</body>');
    res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/global.css"><style>body{margin:0} :root{--paper-bg:#faf8f4;--ink:#222;--breadboard-navbar-height:68px;--font-schibsted:Arial;--font-source-sans:Arial} [role=progressbar]{position:fixed;inset:0 0 auto;height:4px;z-index:10000}[role=progressbar]>div{height:100%;background:#0969da}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  let releaseDocument, releaseImage;
  const external = http.createServer((req, res) => {
    if (req.url === "/held-image") {
      releaseImage = () => { res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'); };
      return;
    }
    if (!["/first", "/second", "/third", "/link", "/redirect", "/linked"].includes(req.url)) { res.writeHead(204); return res.end(); }
    if (req.url === "/redirect") { res.writeHead(302, { Location: "/linked" }); return res.end(); }
    const send = () => {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><title>Destination</title><body style="background:#123456">Destination<img src="/held-image"></body>');
    };
    releaseDocument = send;
  });
  const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const origin = await listen(shellServer), web = await listen(external);
  const loading = path.join(dir, "loading.html");
  fs.writeFileSync(loading, "<!doctype html>");
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    preloadPath, loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
    theme: () => "light", openWindow: () => {},
  });
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  let holdNavigation = false, releaseNavigation;
  ipcMain.handle(IPC_CHANNELS.tabsCommand, async (event, command) => {
    if (holdNavigation && command.type === "browser-navigate") {
      await new Promise(resolve => { releaseNavigation = resolve; });
    }
    return manager.handleCommand(event.sender, command);
  });
  ipcMain.handle("breadboard:get-browser-history", () => ({ items: [], error: null }));
  ipcMain.handle("breadboard:get-browser-downloads", () => ({ items: [], error: null }));
  await window.loadURL(origin + "/dashboard");
  const baseId = manager.stateFor(window.webContents).activeId;
  manager.handleCommand(window.webContents, { type: "browser" });
  const chrome = await until(() => webContents.getAllWebContents().find(wc => wc.getURL() === origin + "/browser"), "browser shell");
  window.setOpacity(0);
  window.showInactive();
  const active = () => manager.stateFor(chrome).tabs.find(tab => tab.id === manager.stateFor(chrome).activeId);
  const browserId = active().id;
  const command = value => assert.equal(manager.handleCommand(chrome, value), true);
  const presentation = () => chrome.executeJavaScript(`(() => {
    const home = document.querySelector('.browser-start-page');
    const bar = document.querySelector('[role=progressbar]');
    return home && bar && {
      native: home.dataset.nativePage, visibility: getComputedStyle(home).visibility,
      background: getComputedStyle(document.querySelector('.browser-shell')).backgroundColor,
      search: Boolean(home.querySelector('input[type=search]')),
      searchText: home.querySelector('input[type=search]')?.value,
      address: document.querySelector('[aria-label="Address and search"]').value,
      busy: bar.getAttribute('aria-busy'), hidden: bar.getAttribute('aria-hidden'),
    };
  })()`);
  await until(async () => (await presentation())?.hidden === "true" && !active().loading, "idle browser home");
  const homePresentation = await presentation();
  assert.equal(homePresentation.visibility, "visible");
  assert.notEqual(homePresentation.background, "rgba(0, 0, 0, 0)");
  const assertHome = async label => {
    const value = await presentation();
    assert.equal(value.native, "false", label);
    assert.equal(value.visibility, "visible", label);
    assert.equal(value.search, true, label);
    assert.equal(value.background, homePresentation.background, label);
    assert.equal(value.busy, "true", label);
  };

  // A slow recent-search save and IPC handoff must use the same blue bar,
  // retaining the submitted omnibox text even after its delayed blur handler.
  await chrome.executeJavaScript('window.holdSearchSave = true');
  holdNavigation = true;
  await chrome.executeJavaScript(`(() => {
    const input = document.querySelector('[aria-label="Address and search"]');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(web + "/first")});
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await chrome.executeJavaScript(`document.querySelector('.browser-address-form').requestSubmit()`);
  await until(() => chrome.executeJavaScript('typeof window.releaseSearchSave === "function"'), "held recent-search save");
  await until(async () => (await presentation()).busy === "true", "blue bar during save");
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal((await presentation()).address, web + "/first", "blur must retain the submitted address before native state arrives");
  await chrome.executeJavaScript('window.holdSearchSave = false; window.releaseSearchSave()');
  await until(() => releaseNavigation, "held IPC handoff");
  await assertHome("IPC handoff retains home with the blue bar");
  assert.equal((await presentation()).address, web + "/first");
  holdNavigation = false; releaseNavigation(); releaseNavigation = null;
  await until(() => releaseDocument && active().loading, "held navigation");
  await until(async () => (await presentation()).busy === "true", "blue bar running");
  await assertHome("waiting for the response must retain browser home");
  releaseDocument(); releaseDocument = null;
  const page = await until(() => webContents.getAllWebContents().find(wc => wc.getURL() === web + "/first"), "destination document");
  await until(() => releaseImage && readyDocuments.has(page.id), "DOM ready with a pending resource");
  assert.equal(page.isLoading(), true);
  assert.equal(window.contentView.children.some(view => view.webContents === page), false, "DOM readiness must not reveal the page before loading finishes");
  await assertHome("DOM-ready still retains browser home while the blue bar runs");
  releaseImage(); releaseImage = null;
  await until(async () => !active().loading && (await presentation()).native === "true", "destination revealed");
  await until(() => window.contentView.children.some(view => view.webContents === page), "native view attached after shell reveal");
  await until(async () => (await presentation()).hidden === "true", "blue bar complete");

  // Later navigation keeps the existing native page; it never exposes home.
  command({ type: "browser-navigate", input: web + "/second" });
  await until(() => releaseDocument && active().loading, "second held navigation");
  assert.equal(window.contentView.children.some(view => view.webContents === page), true);
  assert.equal(page.getURL(), web + "/first", "the outgoing document stays current until the response arrives");
  assert.equal((await presentation()).native, "true");
  command({ type: "browser-stop" });
  releaseDocument(); releaseDocument = null;
  await until(() => !active().loading, "cancelled navigation");

  command({ type: "back" });
  await until(async () => (await presentation()).native === "false", "back to home");
  command({ type: "forward" });
  await until(async () => (await presentation()).native === "true", "forward to the loaded page");
  command({ type: "back" });
  await until(async () => (await presentation()).native === "false", "home before another navigation");
  // The central search field also retains its value throughout submission.
  await chrome.executeJavaScript(`(() => {
    const input = document.querySelector('input[type=search]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(web + "/third")});
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await chrome.executeJavaScript(`document.querySelector('.browser-home-search').requestSubmit()`);
  await until(() => releaseDocument && active().loading, "navigation from virtual home");
  await until(async () => (await presentation()).busy === "true", "home blue bar restarted");
  await assertHome("a new URL from virtual home must keep that home visible");
  assert.equal((await presentation()).searchText, web + "/third", "submitting the central search must not empty it");
  command({ type: "activate", id: baseId });
  releaseDocument(); releaseDocument = null;
  await until(() => releaseImage, "background image requested");
  releaseImage(); releaseImage = null;
  await until(() => !manager.stateFor(chrome).tabs.find(tab => tab.id === browserId).loading, "background load completed");
  assert.equal(manager.stateFor(chrome).activeId, baseId, "late page completion must not steal focus");
  command({ type: "activate", id: browserId });
  await until(() => window.contentView.children.some(view => view.webContents === page), "loaded browser reselected");
  assert.equal((await presentation()).native, "true");

  // Ordinary result clicks keep the same native view, including redirects.
  await page.executeJavaScript(`(() => {
    const link = document.createElement('a'); link.href = ${JSON.stringify(web + "/redirect")};
    document.body.append(link); link.click();
  })()`, true);
  await until(() => releaseDocument && active().loading, "redirected result request");
  await until(async () => (await presentation()).busy === "true", "result click blue bar");
  assert.equal(page.getURL(), web + "/third");
  assert.equal((await presentation()).native, "true");
  assert.equal(window.contentView.children.some(view => view.webContents === page), true);
  releaseDocument(); releaseDocument = null;
  await until(() => releaseImage, "redirected result image");
  releaseImage(); releaseImage = null;
  await until(() => !active().loading && page.getURL() === web + "/linked", "redirected result loaded");

  // Google can open results with target=_blank. The ready browser shell must
  // not replace the results with its home while the new website is still cold.
  await page.executeJavaScript(`(() => {
    const link = document.createElement('a'); link.href = ${JSON.stringify(web + "/link")};
    link.target = '_blank'; link.rel = 'noopener'; document.body.append(link); link.click();
  })()`, true);
  await until(() => releaseDocument && manager.stateFor(chrome).activeId !== browserId, "new-tab result request");
  const linkedId = manager.stateFor(chrome).activeId;
  const linkedChrome = await until(() => webContents.getAllWebContents().find(wc =>
    wc.getURL() === origin + "/browser" && manager.stateFor(wc)?.selfId === linkedId && readyDocuments.has(wc.id)), "new-tab shell ready");
  await until(async () => (await presentation()).busy === "true", "outgoing result blue bar");
  const assertOutgoing = () => {
    assert.equal(manager.stateFor(chrome).navigationPending, true);
    assert.equal(window.contentView.children.some(view => view.webContents === page), true, "results remain attached");
    const shell = window.contentView.children.find(view => view.webContents === linkedChrome);
    assert.ok(shell && shell.getBounds().y < 0, "destination home remains offscreen");
    assert.equal(window.contentView.children.some(view => view.webContents.getURL().includes('loading.html')), false, "result navigation uses only the top bar");
  };
  assertOutgoing();
  await new Promise(resolve => setTimeout(resolve, REVEAL_MAX_WAIT_MS + 100));
  assertOutgoing();
  releaseDocument(); releaseDocument = null;
  const linkedPage = await until(() => webContents.getAllWebContents().find(wc => wc.getURL() === web + "/link"), "new result document");
  await until(() => releaseImage && readyDocuments.has(linkedPage.id), "new result pending image");
  assertOutgoing();
  releaseImage(); releaseImage = null;
  await until(() => !manager.stateFor(chrome).navigationPending && window.contentView.children.some(view => view.webContents === linkedPage), "new result revealed");
  assert.equal(window.contentView.children.some(view => view.webContents === page), false);
  await until(async () => (await presentation()).hidden === "true", "outgoing result bar complete");
  window.destroy();
  shellServer.closeAllConnections(); external.closeAllConnections();
  await Promise.all([shellServer, external].map(server => new Promise(resolve => server.close(resolve))));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
