const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, webContents } = require("electron");
const { TabManager, BROWSER_CONTENT_TOP_INSET } = require("../../dist/main/tab-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const { waitForViewportFrame } = require("../../dist/main/first-paint.js");
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
  // Render the production list and overlay hook without loading unrelated
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
        return <div className="browser-shell"><div className="browser-toolbar" style={{marginTop:32}}>
          <div className="browser-address-form">
            <input aria-label="Address" defaultValue="https://example.com/" onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} />
            {open && count > 0 && <BrowserSuggestionList id="suggestions" address dropdownRef={dropdownRef} suggestions={suggestions}
              highlighted={0} onHighlight={() => {}} onChoose={() => setOpen(false)} onRemoveHistory={() => setCount(n => n - 1)} />}
          </div>
        </div><main className="browser-start-page" data-native-page="true" data-has-wallpaper="true" style={{background:'magenta'}} /></div>;
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
    res.end('<!doctype html><title>Example page</title><body style="margin:0;background:#101827;color:white"><h1 style="margin:0;padding:16px">Page starts here</h1><div style="height:3000px">Web content</div><script>window.resizeCount=0;window.addEventListener("resize",()=>window.resizeCount++);document.addEventListener("click",()=>window.pageClicked=true)</script></body>');
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
  const commands = [];
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => {
    commands.push(command);
    return isTabsCommand(command) && manager.handleCommand(event.sender, command);
  });
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
  // Composite the trusted renderer over the native page, not only DOM geometry.
  window.setPosition(24, 24);
  if (process.env.BB_ADDRESS_INPUT_ONLY) window.setOpacity(0);
  else window.setAlwaysOnTop(true);
  window.showInactive();
  assert.equal(pageView().getBounds().y, BROWSER_CONTENT_TOP_INSET);
  const chromeView = () => window.contentView.children.find(view => view.webContents?.id === chrome.id);
  const chromeAbovePage = () => window.contentView.children.indexOf(chromeView()) > window.contentView.children.indexOf(pageView());
  const metrics = () => page.executeJavaScript('({width:innerWidth,height:innerHeight,scrollY,resizeCount})');
  await page.executeJavaScript('window.scrollTo(0, 180)');
  await until(async () => (await metrics()).scrollY === 180, 'page scroll position');
  const initialBounds = pageView().getBounds();
  await waitForViewportFrame(page, [initialBounds.width, initialBounds.height]);
  const initialMetrics = await metrics();
  const captureOverlay = async () => {
    const display = screen.getDisplayMatching(window.getBounds());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    }});
    const source = sources.find(source => String(source.display_id) === String(display.id));
    assert.ok(source, 'test window display is capturable');
    const image = source.thumbnail;
    const size = image.getSize();
    const content = window.getContentBounds();
    const sx = size.width / display.bounds.width, sy = size.height / display.bounds.height;
    return image.crop({x:Math.round((content.x-display.bounds.x)*sx),y:Math.round((content.y-display.bounds.y)*sy),
      width:Math.round(content.width*sx),height:Math.round(content.height*sy)}).resize({width:content.width,height:content.height});
  };
  const overlaid = async label => {
    try { await until(chromeAbovePage, label); } catch (error) {
      console.error({commands, children:window.contentView.children.map(view => view.webContents?.id), chrome:chrome.id, page:page.id,
        dom:await chrome.executeJavaScript("({active:document.activeElement?.outerHTML,dropdown:document.getElementById('suggestions')?.outerHTML})")});
      throw error;
    }
    const bottom = await chrome.executeJavaScript(`(() => {
      const dropdown = document.getElementById('suggestions');
      for (const animation of dropdown.getAnimations()) animation.finish();
      return dropdown.getBoundingClientRect().bottom;
    })()`);
    assert.ok(bottom > BROWSER_CONTENT_TOP_INSET, 'dropdown overlaps native page');
    assert.equal(pageView().getBounds().y, BROWSER_CONTENT_TOP_INSET, 'page never moves below recents');
    assert.equal(pageView().getBounds().y + pageView().getBounds().height, window.getContentSize()[1]);
    assert.equal(await chrome.executeJavaScript("getComputedStyle(document.body).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.equal(await chrome.executeJavaScript("getComputedStyle(document.querySelector('.browser-shell')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.equal(await chrome.executeJavaScript("getComputedStyle(document.querySelector('.browser-start-page')).visibility"), 'hidden', 'wallpaper cannot cover the native page');
    return bottom;
  };
  chrome.focus();
  await chrome.executeJavaScript("document.querySelector('input').focus(); window.setOpen(true)");
  const twoBottom = await overlaid("two suggestions overlay the page");
  assert.deepEqual(pageView().getBounds(), initialBounds);
  assert.deepEqual(await metrics(), initialMetrics, 'opening recents preserves page viewport, scroll and resize count');
  await chrome.executeJavaScript("document.querySelector('.browser-suggestion-remove').click()");
  await until(async () => await chrome.executeJavaScript("document.querySelectorAll('.browser-suggestion-row').length") === 1, 'history removal');
  const oneBottom = await overlaid("removing a result leaves page in place");
  assert.ok(oneBottom < twoBottom);
  await chrome.executeJavaScript("window.setCount(8)");
  await until(async () => await chrome.executeJavaScript("document.querySelectorAll('.browser-suggestion-row').length") === 8, 'eight results');
  const eightBottom = await overlaid("all eight results stay above the native page");
  assert.ok(eightBottom > twoBottom);
  assert.deepEqual(pageView().getBounds(), initialBounds);
  assert.deepEqual(await metrics(), initialMetrics, 'changing result count never reflows or scrolls the page');
  const host = manager.hosts.get(window.id);
  const addChildView = window.contentView.addChildView;
  let reordered = 0;
  window.contentView.addChildView = function(...args) {
    reordered++;
    return addChildView.apply(this, args);
  };
  try {
    for (let update = 0; update < 5; update++) {
      manager.layout(host);
      manager.syncBrowser(host);
      manager.handleCommand(chrome, { type: 'browser-address-suggestions', open: true });
    }
    assert.equal(reordered, 0, 'routine updates leave the focused toolbar in its native view stack');
    assert.ok(chromeAbovePage(), 'suggestions remain above the page');
  } finally {
    window.contentView.addChildView = addChildView;
  }
  if (process.env.BB_ADDRESS_INPUT_ONLY) {
    window.destroy();
    server.close();
    external.close();
    app.exit(0);
    return;
  }
  let capture;
  const pixel = (image, x, y) => {
    const bitmap = image.toBitmap(), offset = (y * image.getSize().width + x) * 4;
    return [bitmap[offset+2],bitmap[offset+1],bitmap[offset]];
  };
  await until(async () => {
    capture = await captureOverlay();
    return JSON.stringify(pixel(capture, 60, 220)) === '[16,24,39]';
  }, 'actual native page remains visible beside recents');
  assert.notDeepEqual(pixel(capture, 600, 220), [16,24,39], 'recents paints over the same native page');
  if (process.env.BB_ADDRESS_OVERLAY_QA) {
    fs.mkdirSync(process.env.BB_ADDRESS_OVERLAY_QA, {recursive:true});
    fs.writeFileSync(path.join(process.env.BB_ADDRESS_OVERLAY_QA, 'recents-overlay.png'), capture.toPNG());
  }
  window.setContentSize(900, 430);
  await until(async () => await chrome.executeJavaScript('innerHeight') < 500, 'renderer resize');
  const compactBottom = await overlaid("short window uses the dropdown's scroll limit");
  assert.ok(compactBottom < eightBottom);
  chrome.sendInputEvent({type:'keyDown', keyCode:'Escape'});
  chrome.sendInputEvent({type:'keyUp', keyCode:'Escape'});
  await until(() => !chromeAbovePage(), 'Escape restores native page input');
  await chrome.executeJavaScript("window.setOpen(true)");
  await overlaid("reopen restores overlay");
  chrome.sendInputEvent({type:'mouseDown', x:860, y:405, button:'left', clickCount:1});
  chrome.sendInputEvent({type:'mouseUp', x:860, y:405, button:'left', clickCount:1});
  await until(() => !chromeAbovePage(), 'outside click dismisses recents');
  page.sendInputEvent({type:'mouseDown', x:700, y:220, button:'left', clickCount:1});
  page.sendInputEvent({type:'mouseUp', x:700, y:220, button:'left', clickCount:1});
  await until(() => page.executeJavaScript('window.pageClicked === true'), 'page receives clicks after dismissal');
  await chrome.executeJavaScript("window.setOpen(true)");
  await overlaid("open before close");
  await chrome.executeJavaScript("window.setOpen(false)");
  await until(() => !chromeAbovePage(), "close restores page above chrome");
  await chrome.executeJavaScript("window.setOpen(true)");
  await overlaid("reopen after close");
  await chrome.executeJavaScript("window.setCount(0)");
  await until(() => !chromeAbovePage(), "empty results restore page input");
  await chrome.executeJavaScript("window.setCount(2)");
  await overlaid("results return");
  await chrome.executeJavaScript("window.unmount()");
  await until(() => !chromeAbovePage(), "unmount restores page input");
  window.destroy();
  server.close();
  external.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
