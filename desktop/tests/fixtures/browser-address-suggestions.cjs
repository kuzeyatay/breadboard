const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, webContents } = require("electron");
const { TabManager, BROWSER_CONTENT_TOP_INSET } = require("../../dist/main/tab-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});

const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const requireDashboard = createRequire(path.join(dashboard, "package.json"));
  const ts = requireDashboard("typescript");
  const client = fs.readFileSync(path.join(dashboard, "src/app/browser/browser-client.tsx"), "utf8");
  const source = ts.createSourceFile("browser-client.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Render the production list and measurement hook without loading unrelated
  // dashboard services. The glyph's drawing has no bearing on list geometry.
  const list = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "BrowserSuggestionList");
  assert.ok(list, "production suggestion list exists");
  const bundle = requireDashboard("esbuild").buildSync({
    stdin: { resolveDir: dashboard, loader: "tsx", contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useBrowserAddressSuggestions } from './src/app/browser/use-browser-address-suggestions';
      const STROKE = {};
      const BrowserSuggestionGlyph = () => <svg className="browser-suggestion-glyph" />;
      ${list.getText(source)}
      function App() {
        const [count, setCount] = useState(2);
        const [open, setOpen] = useState(false);
        window.setCount = setCount;
        window.setOpen = setOpen;
        const dropdownRef = useBrowserAddressSuggestions(open && count > 0);
        const suggestions = Array.from({length: count}, (_, i) => ({source:'history', value:String(i), label:i === 0 ? 'framed' : 'search ' + i}));
        return <div className="browser-toolbar" style={{marginTop:32}}>
          <div className="browser-address-form">
            <input aria-label="Address" defaultValue="https://example.com/" onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} />
            {open && count > 0 && <BrowserSuggestionList id="suggestions" address dropdownRef={dropdownRef} suggestions={suggestions}
              highlighted={0} onHighlight={() => {}} onChoose={() => setOpen(false)} onRemoveHistory={() => setCount(n => n - 1)} />}
          </div>
        </div>;
      }
      const root = createRoot(document.getElementById('root'));
      window.unmount = () => root.unmount();
      root.render(<App />);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles[0].text;
  const css = fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8");
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle); }
    if (req.url === "/global.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/global.css"><style>body{margin:0;font-family:Arial}*,::before,::after{box-sizing:border-box} :root{--font-schibsted:Arial;--font-source-sans:Arial}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  const external = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><title>Example page</title><body style="margin:0;background:#101827;color:white"><h1 style="margin:0;padding:16px">Page starts here</h1><div style="height:3000px">Web content</div></body>');
  });
  const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const origin = await listen(server), web = await listen(external);
  const loading = path.join(dir, "loading.html");
  fs.writeFileSync(loading, "<!doctype html>");
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath, loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
    theme: () => "light", openWindow: () => {},
  });
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  await window.loadURL(origin + "/dashboard");
  await manager.handleCommand(window.webContents, { type: "browser", url: web });
  let chrome, page;
  await until(() => {
    chrome = webContents.getAllWebContents().find(wc => wc.getURL() === origin + "/browser");
    page = webContents.getAllWebContents().find(wc => wc.getURL() === web + "/");
    return chrome && page && !chrome.isLoading() && !page.isLoading();
  }, "chrome and page load");
  await until(() => chrome.executeJavaScript("typeof window.setCount === 'function'"), "React renders");
  const pageView = () => window.contentView.children.find(view => view.webContents?.id === page.id);
  await until(pageView, "web page attaches");
  // Chromium delivers ResizeObserver updates only while the view can paint.
  window.showInactive();
  assert.equal(pageView().getBounds().y, BROWSER_CONTENT_TOP_INSET);
  const aligned = async label => {
    let bottom = 0;
    try {
      await until(async () => {
        bottom = await chrome.executeJavaScript(`(() => {
          const dropdown = document.getElementById('suggestions');
          if (!dropdown) return 0;
          // Compare the final edge independently of the entrance animation.
          for (const animation of dropdown.getAnimations()) animation.finish();
          return dropdown.getBoundingClientRect().bottom;
        })()`);
        return bottom > 0 && Math.abs(pageView().getBounds().y - Math.max(BROWSER_CONTENT_TOP_INSET, Math.ceil(bottom))) <= 1;
      }, label);
    } catch (error) {
      console.error({ bottom, bounds: pageView().getBounds(), dropdown: await chrome.executeJavaScript("document.getElementById('suggestions')?.outerHTML") });
      throw error;
    }
    const bounds = pageView().getBounds();
    assert.equal(bounds.y + bounds.height, window.getContentSize()[1], "page fills the remaining height");
    return bounds.y;
  };
  await chrome.executeJavaScript("window.setOpen(true)");
  const twoTop = await aligned("two suggestions meet page without a blank strip");
  assert.ok(twoTop < BROWSER_CONTENT_TOP_INSET + 120, "two rows never reserve the old 312px gap");
  await chrome.executeJavaScript("document.querySelector('.browser-suggestion-remove').click()");
  const oneTop = await aligned("removing a result shrinks reserved space");
  assert.ok(oneTop < twoTop);
  await chrome.executeJavaScript("window.setCount(8)");
  const eightTop = await aligned("all eight results stay above the native page");
  assert.ok(eightTop > twoTop);
  window.setContentSize(900, 430);
  const compactTop = await aligned("short window uses the dropdown's scroll limit");
  assert.ok(compactTop < eightTop);
  await chrome.executeJavaScript("window.setOpen(false)");
  await until(() => pageView().getBounds().y === BROWSER_CONTENT_TOP_INSET, "close releases reserved space");
  await chrome.executeJavaScript("window.setOpen(true)");
  await aligned("reopen restores measured space");
  await chrome.executeJavaScript("window.setCount(0)");
  await until(() => pageView().getBounds().y === BROWSER_CONTENT_TOP_INSET, "empty results release reserved space");
  await chrome.executeJavaScript("window.setCount(2)");
  await aligned("results return");
  await chrome.executeJavaScript("window.unmount()");
  await until(() => pageView().getBounds().y === BROWSER_CONTENT_TOP_INSET, "unmount releases reserved space");
  window.destroy();
  server.close();
  external.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
