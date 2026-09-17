const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, clipboard, ipcMain, webContents, nativeTheme, nativeImage, desktopCapturer, screen } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const { readBrowserBookmarks, writeBrowserBookmarks } = require('../../dist/main/browser-bookmarks.js');
const dir = process.argv[2];
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const originalClipboard = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage(), bookmark: clipboard.readBookmark().title };
  try {
  const dashboard = path.resolve(__dirname, '../../../dashboard');
  const requireDashboard = createRequire(path.join(dashboard, 'package.json'));
  const script = requireDashboard('esbuild').buildSync({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { useBrowserSavedItems } from './src/app/browser/use-browser-saved-items';
      import { useBrowserContextBookmark } from './src/app/browser/use-browser-context-bookmark';
      import { browserBookmarksControl } from './src/lib/desktop-browser-tabs';
      const normalize = value => value && typeof value.url === 'string' ? {
        ...value, title: value.title.slice(0, 100), iconUrl: value.iconUrl || new URL('/favicon.ico', value.url).href
      } : null;
      const normalizeList = value => Array.isArray(value) ? value.map(normalize).filter(Boolean) : [];
      function App() {
        const store = useBrowserSavedItems('fixture', 'context-bookmarks', browserBookmarksControl, normalizeList);
        useBrowserContextBookmark(store, normalize, 40);
        window.bookmarksReady = store.ready;
        return <div style={{padding:16}}>Breadboard browser <span>{store.items.map(item => item.title).join(' · ')}</span></div>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    `, resolveDir: dashboard, loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/app.js' ? script : '<!doctype html><title>Browser</title><body style="margin:0;background:#202124;color:#eee;font:14px Arial"><div id="root"></div><script src="/app.js"></script>');
  });
  const external = http.createServer((req, res) => {
    if (req.url === '/download.txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="context-download.txt"');
      return res.end('Saved from the context menu.');
    }
    if (req.url === '/image.png') {
      res.setHeader('Content-Type', 'image/png');
      return res.end(nativeImage.createFromBitmap(Buffer.from([0, 128, 255, 255]), { width: 1, height: 1 }).toPNG());
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>Context menu fixture</title><style>
      body{background:#202124;color:#ddd;font:16px Arial;padding:24px;margin:0}a{color:#a8c7fa;display:block;width:max-content;margin-bottom:24px}
      h1{font-size:22px;font-weight:500}textarea{display:block;margin:24px 0;width:350px;height:70px}#blank{height:100px;margin-top:20px}
    </style><h1>Browser right-click controls</h1>
    <a id="link" href="/destination?id=42&utm_source=fixture#details">A &amp; B browser guide</a>
    <a id="download" href="/download.txt">Download example</a>
    <p id="selection">Selected words for search and translation.</p>
    <textarea id="editor">Original editable text</textarea>
    <img id="image" src="/image.png" width="60" height="60" alt="Example image"><div id="blank">Page background</div>`);
  });
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const origin = await listen(server), web = await listen(external);
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const windows = [];
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => 'dark',
    openWindow: (url, privateBrowsing) => windows.push({ url, privateBrowsing }), browserPreferencesConfigDir: dir,
  });
  manager.setBrowserUrl(origin + '/browser');
  manager.setNewTabUrl(origin + '/new-tab');
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  ipcMain.handle(IPC_CHANNELS.getBrowserBookmarks, (_event, owner) => readBrowserBookmarks(dir, owner));
  ipcMain.handle(IPC_CHANNELS.setBrowserBookmarks, (_event, owner, items) => { writeBrowserBookmarks(dir, owner, items); return true; });
  const window = new BrowserWindow({ show: false, width: 1000, height: 840, webPreferences: {
    preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true,
  } });
  manager.attach(window);
  await window.loadURL(origin + '/dashboard');
  window.setPosition(24, 24);
  window.setAlwaysOnTop(true);
  window.showInactive();
  await manager.handleCommand(window.webContents, { type: 'browser', url: web + '/source' });
  let chrome, page;
  const ready = async expectedUrl => {
    await until(() => {
      const state = manager.stateFor(window.webContents);
      const active = state.tabs.find(tab => tab.id === state.activeId);
      chrome = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/browser' && manager.stateFor(contents)?.selfId === active?.id);
      page = webContents.getAllWebContents().find(contents => contents.getURL() === expectedUrl);
      return chrome && page && !page.isLoading() && window.contentView.children.some(view => view.webContents === page);
    }, 'visible browser page');
    await until(() => chrome.executeJavaScript('window.bookmarksReady === true'), 'bookmark store restored');
  };
  await ready(web + '/source');
  await page.executeJavaScript(`window.fixtureEvents=[]; for(const type of ['mousedown','mouseup','contextmenu']) document.addEventListener(type,event=>window.fixtureEvents.push({type,x:event.clientX,y:event.clientY,target:event.target.id}));`);
  assert.equal(await page.executeJavaScript('typeof window.breadboardDesktop'), 'undefined');
  let menu, nativeParams;
  const nativePopup = Menu.prototype.popup;
  Menu.prototype.popup = function(options) { menu = this; options.callback?.(); };
  const rightClick = async selector => {
    menu = undefined;
    window.focus();
    page.focus();
    page.once('context-menu', (_event, params) => { nativeParams = params; });
    const point = await page.executeJavaScript(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:Math.round(r.x+Math.min(16,r.width/2)),y:Math.round(r.y+Math.min(10,r.height/2))};
    })()`);
    page.sendInputEvent({ type: 'mouseMove', ...point });
    await new Promise(resolve => setTimeout(resolve, 80));
    page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point });
    page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point });
    try { await until(() => menu, 'native context menu from right-click'); }
    catch (error) {
      if (process.env.BREADBOARD_CONTEXT_MENU_SCREENSHOT) fs.writeFileSync(process.env.BREADBOARD_CONTEXT_MENU_SCREENSHOT, (await window.capturePage()).toPNG());
      console.error('Context diagnostics', { point, nativeParams: nativeParams && {linkURL:nativeParams.linkURL,x:nativeParams.x,y:nativeParams.y}, events:await page.executeJavaScript('window.fixtureEvents'),
        visible: window.isVisible(), focused:page.isFocused(), contentSize:window.getContentSize(), zoom:page.getZoomFactor(),
        pageBounds:window.contentView.children.find(view=>view.webContents===page)?.getBounds(),
        pageId:page.id, state:manager.stateFor(chrome), handlers:page.listenerCount('context-menu'), children:window.contentView.children.map(view=>({url:view.webContents?.getURL(),bounds:view.getBounds()})) });
      throw error;
    }
    return menu;
  };
  const choose = async (selector, id) => {
    const opened = await rightClick(selector);
    const item = opened.getMenuItemById(id);
    assert.ok(item?.enabled, `${id} enabled; available: ${opened.items.map(item => item.id).join(', ')}`);
    item.click(item, window, {});
    await new Promise(resolve => setImmediate(resolve));
  };
  const linked = web + '/destination?id=42&utm_source=fixture#details';
  await choose('#link', 'copy-link');
  assert.equal(clipboard.readText(), linked);
  await choose('#link', 'copy-clean-link');
  assert.equal(clipboard.readText(), web + '/destination?id=42#details');
  await choose('#link', 'bookmark-link');
  await until(() => readBrowserBookmarks(dir, 'fixture')?.some(item => item.url === linked), 'bookmark persisted');
  await until(() => chrome.executeJavaScript('window.bookmarksReady'), 'bookmark store settled');
  await choose('#link', 'bookmark-link');
  assert.equal(readBrowserBookmarks(dir, 'fixture').length, 1, 'bookmark is idempotent');
  await choose('#link', 'open-link-window');
  await choose('#link', 'open-link-private');
  assert.deepEqual(windows, [{ url: linked, privateBrowsing: false }, { url: linked, privateBrowsing: true }]);
  const sourceId = manager.stateFor(chrome).activeId;
  await choose('#link', 'open-link-tab');
  await until(() => manager.stateFor(chrome).tabs.some(tab => tab.browser?.address === linked), 'link opens in a real tab');
  assert.equal(manager.stateFor(chrome).activeId, sourceId, 'new link tab stays in background');

  // Native downloads use the page session and the normal download lifecycle.
  let downloaded = false;
  page.session.once('will-download', (_event, item) => {
    item.setSavePath(path.join(dir, 'download.txt'));
    item.once('done', (_event, state) => { assert.equal(state, 'completed'); downloaded = true; });
  });
  await choose('#download', 'save-link');
  await until(() => downloaded, 'link downloaded');
  assert.equal(fs.readFileSync(path.join(dir, 'download.txt'), 'utf8'), 'Saved from the context menu.');
  await choose('#image', 'copy-image');
  await until(() => !clipboard.readImage().isEmpty(), 'native image copied');

  await page.executeJavaScript('document.querySelector("#editor").focus(); document.querySelector("#editor").select()');
  await choose('#editor', 'copy');
  await until(() => clipboard.readText() === 'Original editable text', 'native editable selection copied');
  clipboard.writeText('Pasted through right click');
  await choose('#editor', 'paste-plain');
  await until(async () => await page.executeJavaScript('document.querySelector("#editor").value') === 'Pasted through right click', 'paste edits page input');

  const outbound = [];
  const openBrowserTab = manager.openBrowserTab.bind(manager);
  manager.openBrowserTab = function(host, url, ...args) {
    if (url?.startsWith('https://www.google.com/') || url?.startsWith('https://translate.google.com/')) { outbound.push(url); return null; }
    return openBrowserTab(host, url, ...args);
  };
  await page.executeJavaScript('document.activeElement.blur(); const range=document.createRange(); range.selectNodeContents(document.querySelector("#selection")); getSelection().removeAllRanges(); getSelection().addRange(range)');
  await choose('#selection', 'search');
  assert.equal(new URL(outbound.at(-1)).searchParams.get('q'), 'Selected words for search and translation.');
  await choose('#selection', 'translate-text');
  assert.equal(new URL(outbound.at(-1)).searchParams.get('text'), 'Selected words for search and translation.');
  await choose('#selection', 'ask');
  const browserState = manager.stateFor(chrome).tabs.find(tab => tab.id === sourceId).browser;
  assert.equal(browserState.terminalOpen, true);
  assert.equal(browserState.selection.text, 'Selected words for search and translation.');
  await manager.handleCommand(chrome, { type: 'browser-terminal', open: false });
  await page.executeJavaScript('getSelection().removeAllRanges()');
  await choose('#blank', 'bookmark-page');
  await until(() => readBrowserBookmarks(dir, 'fixture').some(item => item.url === web + '/source'), 'page bookmark saved');

  // A queued click must not operate on a replacement document.
  await rightClick('#link');
  const stale = menu.getMenuItemById('copy-link');
  clipboard.writeText('Keep this clipboard');
  await page.loadURL(web + '/after-navigation');
  stale.click(stale, window, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clipboard.readText(), 'Keep this clipboard');

  await manager.handleCommand(chrome, { type: 'browser-menu', x: 10, y: 10, profileLabel: 'Fixture' });
  const newPrivateTab = menu.getMenuItemById('new-private-tab');
  newPrivateTab.click(newPrivateTab, window, {});
  await until(() => manager.stateFor(window.webContents).tabs.some(tab => tab.browser?.private), 'private tab created');
  await until(() => {
    const activeId = manager.stateFor(window.webContents).activeId;
    chrome = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/browser' && manager.stateFor(contents)?.selfId === activeId);
    return chrome && !chrome.isLoading();
  }, 'private shell loaded');
  await manager.handleCommand(chrome, { type: 'browser-navigate', input: web + '/private' });
  await ready(web + '/private');
  assert.equal(manager.stateFor(chrome).tabs.find(tab => tab.id === manager.stateFor(chrome).selfId).browser.private, true);
  await choose('#link', 'open-link-window');
  assert.equal(windows.at(-1).privateBrowsing, true, 'new windows preserve private mode');
  const privateSession = page.session;
  await choose('#link', 'open-link-tab');
  await until(() => webContents.getAllWebContents().some(contents => contents.getURL() === linked && contents.session === privateSession), 'private link tab shares only the private profile');

  // Optional visual receipt, captured from an isolated fixture instead of the user's app.
  if (process.env.BREADBOARD_CONTEXT_MENU_SCREENSHOT) {
    nativeTheme.themeSource = 'dark';
    Menu.prototype.popup = function(options) { menu = this; return nativePopup.call(this, { ...options, x: 110, y: 205 }); };
    window.show();
    window.focus();
    await rightClick('#link');
    await new Promise(resolve => setTimeout(resolve, 300));
    const display = screen.getDisplayMatching(window.getBounds());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor } });
    const source = sources.find(source => source.display_id === String(display.id));
    const content = window.getContentBounds();
    const scale = source.thumbnail.getSize().width / display.bounds.width;
    const capture = source.thumbnail.crop({ x: Math.round((content.x - display.bounds.x) * scale), y: Math.round((content.y - display.bounds.y) * scale),
      width: Math.round(content.width * scale), height: Math.round(content.height * scale) });
    fs.writeFileSync(process.env.BREADBOARD_CONTEXT_MENU_SCREENSHOT, capture.toPNG());
  }
  Menu.prototype.popup = nativePopup;
  for (const owned of BrowserWindow.getAllWindows()) owned.destroy();
  server.close(); external.close();
  console.log('PASS: native right-click, copy/clean link, bookmarks, window privacy, tab routing, download, image copy, editing, search, translation, assistant and stale-menu protection');
  } finally { clipboard.write(originalClipboard); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
