const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, Menu, clipboard, ipcMain, nativeTheme, desktopCapturer, screen } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
    if (await probe()) return;
    await sleep(25);
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const originalClipboard = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
  const nativePopup = Menu.prototype.popup;
  try {
    nativeTheme.themeSource = 'dark';
    const text = 'Selected words for search and translation.';
    const serve = (req, res) => {
      if (req.url === '/api/text-highlights') { res.setHeader('Content-Type', 'application/json'); res.end('{"entries":[]}'); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><title>Selection controls</title><style>
        body{margin:0;padding:32px;background:#202124;color:#eee;font:16px Arial;line-height:1.6}
        h1{font-size:24px;font-weight:500}input{display:block;margin-top:20px}a{color:#9ac5ff}
      </style><h1>Selection controls in every tab</h1><p id="selection">${text}</p>
      <p id="outside">Another paragraph outside the selection.</p>
      <input id="editor" value="Editable text"><input id="password" type="password" value="Keep private">
      <p><a id="link" href="/linked">An ordinary link</a></p>`);
    };
    const server = http.createServer(serve), external = http.createServer(serve);
    const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
    const origin = await listen(server), web = await listen(external);
    const scene = path.join(dir, 'scene.html');
    fs.writeFileSync(scene, '<!doctype html><body>Startup</body>');
    const manager = new WindowManager({ allowed: { origins: new Set([origin]), localFiles: new Set() },
      startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
      preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs: 0 });
    for (const name of ['bookmarks', 'recent-searches']) ipcMain.handle('breadboard:get-browser-' + name, () => []);
    ipcMain.handle('breadboard:get-browser-downloads', () => ({ items: [], error: null }));
    const window = manager.createMainWindow();
    window.setOpacity(0); window.showInactive();
    const tabs = manager.tabs;
    const host = tabs.hosts.get(window.id);
    const base = manager.page(window);
    tabs.setBrowserUrl(origin + '/browser');
    await base.loadURL(origin + '/dashboard');
    await until(() => host.shellEnabled && !host.pending, 'app tab');
    const command = value => tabs.handleCommand(active()?.contents ?? base, value);
    const active = () => host.tabs.find(tab => tab.id === host.activeId);
    const activate = async id => { command({ type: 'activate', id }); await until(() => host.activeId === id && !host.pending, 'tab activated'); };
    let menu;
    Menu.prototype.popup = function(options) { menu = this; options.callback?.(); };
    const click = async (contents, point, button = 'left') => {
      window.focus(); contents.focus();
      contents.sendInputEvent({ type: 'mouseMove', ...point });
      await sleep(30);
      contents.sendInputEvent({ type: 'mouseDown', button, clickCount: 1, ...point });
      contents.sendInputEvent({ type: 'mouseUp', button, clickCount: 1, ...point });
    };
    const select = contents => contents.executeJavaScript(`(() => {
      document.activeElement.blur(); const range = document.createRange(); range.selectNodeContents(document.querySelector('#selection'));
      getSelection().removeAllRanges(); getSelection().addRange(range);
      const r = range.getBoundingClientRect(); return {x:Math.ceil(r.x+4), y:Math.round(r.y+r.height/2)};
    })()`);
    const open = async (contents, button = 'left') => {
      menu = undefined;
      await click(contents, await select(contents), button);
      await until(() => menu, button + ' selection menu');
      assert.equal(await contents.executeJavaScript('getSelection().toString()'), text, 'opening the menu preserves selection');
      return menu;
    };
    const choose = async (opened, id) => {
      const item = opened.getMenuItemById(id);
      assert.ok(item?.enabled, `${id} enabled`);
      item.click(item, window, {});
      await new Promise(resolve => setImmediate(resolve));
    };
    const checkCopy = async contents => {
      clipboard.writeText('before');
      await choose(await open(contents), 'copy');
      await until(() => clipboard.readText() === text, 'selected text copied');
    };

    // Begin with a genuine drag, then click the selected passage. The menu
    // must not interfere with making a selection in the first place.
    const drag = await base.executeJavaScript(`(() => {
      const range=document.createRange();range.selectNodeContents(document.querySelector('#selection'));
      const r=range.getBoundingClientRect();getSelection().removeAllRanges();return {x:Math.floor(r.left),end:Math.ceil(r.right),y:Math.round(r.y+r.height/2)};
    })()`);
    window.focus(); base.focus();
    base.sendInputEvent({ type: 'mouseMove', x: drag.x, y: drag.y });
    base.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: drag.x, y: drag.y });
    base.sendInputEvent({ type: 'mouseMove', modifiers: ['leftButtonDown'], x: drag.end, y: drag.y });
    base.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: drag.end, y: drag.y });
    await until(async () => await base.executeJavaScript('getSelection().toString()') === text, 'drag selects text');
    assert.equal(menu, undefined, 'drag is not a context-menu click');
    await click(base, { x: drag.x + 4, y: drag.y });
    await until(() => menu, 'left-click after dragging');
    await choose(menu, 'copy');
    await until(() => clipboard.readText() === text, 'dragged text copied');
    await select(base);
    menu = undefined; base.focus();
    base.sendInputEvent({ type: 'keyDown', keyCode: 'F10', modifiers: ['shift'] });
    base.sendInputEvent({ type: 'keyUp', keyCode: 'F10', modifiers: ['shift'] });
    await until(() => menu, 'keyboard selection menu');
    await choose(menu, 'copy');
    assert.equal(clipboard.readText(), text);
    await checkCopy(base);
    await choose(await open(base, 'right'), 'copy-quote');
    assert.equal(clipboard.readText(), `> ${text}\n\n${origin}/dashboard`);
    await choose(await open(base), 'copy-highlight-link');
    assert.equal(clipboard.readText(), `${origin}/dashboard#:~:text=${encodeURIComponent(text)}`);
    await choose(await open(base), 'select-all');
    await until(async () => (await base.executeJavaScript('getSelection().toString()')).includes('Another paragraph'), 'select all');

    const outbound = [];
    const openBrowserTab = tabs.openBrowserTab.bind(tabs);
    tabs.openBrowserTab = (owner, url, ...rest) => {
      if (/^https:\/\/(www\.google|translate\.google)\.com\//.test(url ?? '')) { outbound.push(url); return null; }
      return openBrowserTab(owner, url, ...rest);
    };
    await choose(await open(base), 'search');
    assert.equal(new URL(outbound.at(-1)).searchParams.get('q'), text);
    await choose(await open(base), 'translate-text-dutch');
    assert.equal(new URL(outbound.at(-1)).searchParams.get('tl'), 'nl');
    assert.equal(new URL(outbound.at(-1)).searchParams.get('text'), text);
    await choose(await open(base), 'ask');
    await until(() => !host.pending && active().browser?.terminalOpen, 'selection in assistant');
    assert.equal(active().browser.selection.text, text);
    assert.equal(active().browser.selection.url, origin + '/dashboard');

    const home = active();
    assert.equal(home.sharedChrome, true, 'home uses the shared browser renderer');
    await until(() => home.loaded, 'browser home loaded');
    await checkCopy(home.contents);
    // Another app tab uses a different WebContents and the same installation.
    assert.equal(tabs.openLocalTab(base, origin + '/notes', false), true);
    await until(() => !host.pending && active().contents.getURL() === origin + '/notes' && active().loaded, 'notes tab');
    await checkCopy(active().contents);

    command({ type: 'browser', url: web + '/article' });
    await until(() => !host.pending && active().browser?.ready && active().browser?.attached, 'web tab');
    const browserTab = active(), page = browserTab.browser.contents;
    assert.equal(browserTab.contents, home.contents, 'browser controls reuse the home renderer');
    await checkCopy(browserTab.contents);
    await checkCopy(page);
    await choose(await open(page, 'right'), 'copy-highlight-link');
    assert.equal(clipboard.readText(), `${web}/article#:~:text=${encodeURIComponent(text)}`);
    const stale = await open(page);
    await activate(host.base.id);
    await activate(browserTab.id);
    clipboard.writeText('Keep this clipboard');
    await choose(stale, 'copy-quote');
    assert.equal(clipboard.readText(), 'Keep this clipboard', 'switching away and back invalidates a menu');

    // Ordinary clicks still collapse selections; fields keep normal caret behavior.
    menu = undefined;
    await select(page);
    await click(page, await page.executeJavaScript(`(() => { const r=document.querySelector('#outside').getBoundingClientRect(); return {x:r.x+8,y:r.y+8}; })()`));
    await sleep(100);
    assert.equal(menu, undefined, 'outside click does not open a menu');
    for (const id of ['editor', 'password']) {
      await page.executeJavaScript(`document.querySelector('#${id}').focus();document.querySelector('#${id}').select()`);
      await click(page, await page.executeJavaScript(`(() => {const r=document.querySelector('#${id}').getBoundingClientRect();return {x:r.x+12,y:r.y+10};})()`));
      assert.equal(menu, undefined, id + ' does not open a selection menu');
    }
    command({ type: 'browser-menu', x: 20, y: 20, profileLabel: 'Fixture' });
    await choose(menu, 'new-private-tab');
    await until(() => !host.pending && active().browser?.privatePartition, 'private tab');
    command({ type: 'browser-navigate', input: web + '/private' });
    await until(() => !host.pending && active().browser?.ready && active().browser?.attached, 'private page');
    const privatePage = active().browser.contents;
    await checkCopy(privatePage);
    const beforeNavigation = await open(privatePage);
    await privatePage.loadURL(web + '/replacement');
    clipboard.writeText('Keep after navigation');
    await choose(beforeNavigation, 'copy-quote');
    assert.equal(clipboard.readText(), 'Keep after navigation', 'navigation invalidates a menu');
    await until(() => active().browser?.ready, 'replacement ready');
    await checkCopy(privatePage);

    if (process.env.BREADBOARD_SELECTION_MENU_SCREENSHOT) {
      nativeTheme.themeSource = 'dark';
      window.setOpacity(1); window.setBounds({ x: 24, y: 24, width: 1000, height: 760 }); window.show(); window.focus();
      Menu.prototype.popup = function(options) { menu = this; return nativePopup.call(this, { ...options, x: 155, y: 225 }); };
      await open(privatePage);
      await sleep(250);
      const display = screen.getDisplayMatching(window.getBounds());
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor } });
      const source = sources.find(source => source.display_id === String(display.id));
      const bounds = window.getContentBounds(), scale = source.thumbnail.getSize().width / display.bounds.width;
      fs.writeFileSync(process.env.BREADBOARD_SELECTION_MENU_SCREENSHOT, source.thumbnail.crop({ x: Math.round((bounds.x-display.bounds.x)*scale), y: Math.round((bounds.y-display.bounds.y)*scale), width: Math.round(bounds.width*scale), height: Math.round(bounds.height*scale) }).toPNG());
      menu.closePopup(window);
    }
    console.log('PASS: left/right selection menus, shared chrome, internal tabs, private tabs, clipboard, links, search, translation, assistant, and stale actions');
    fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
    window.destroy(); server.close(); external.close();
  } finally { Menu.prototype.popup = nativePopup; clipboard.write(originalClipboard); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
