const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, clipboard, Menu, nativeImage, webContents } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const dir = process.argv[2];
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const original = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage(), bookmark: clipboard.readBookmark().title };
  try {
    const dashboard = path.resolve(__dirname, '../../../dashboard');
    const requireDashboard = createRequire(path.join(dashboard, 'package.json'));
    const script = requireDashboard('esbuild').buildSync({
      stdin: { contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import KeyboardShortcutsPanel from './src/app/profile/keyboard-shortcuts-panel';
        function App() {
          const [draft, setDraft] = useState('Original message');
          return <>
            <textarea id="chat" value={draft} onChange={e => setDraft(e.target.value)} onPaste={e => {
              window.pasteCount = (window.pasteCount || 0) + 1;
              window.imagePaste = Array.from(e.clipboardData.files).some(f => f.type.startsWith('image/'));
            }} />
            <output id="draft">{draft}</output>
            <div id="shortcuts" style={{width:400,marginTop:20}}><KeyboardShortcutsPanel /></div>
          </>;
        }
        createRoot(document.getElementById('root')).render(<App />);
      `, resolveDir: dashboard, loader: 'tsx' },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    }).outputFiles[0].text;
    const browserHtml = `<!doctype html><meta charset="utf-8"><style>body{padding:80px 24px 24px}input,textarea,[contenteditable]{display:block;margin:16px;width:300px;min-height:28px}iframe{height:80px}</style>
      <input id="address" value="Original address"><textarea id="editor">Original text</textarea>
      <div id="rich" contenteditable="true">Rich text</div>
      <input id="readonly" readonly value="Read only"><input id="disabled" disabled value="Disabled">
      <iframe src="/frame"></iframe><a id="link" href="/target">Normal link</a>
      <script>window.pastes=0;document.addEventListener('paste',()=>window.pastes++);</script>`;
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8');
      res.end(req.url === '/app.js' ? script : req.url === '/frame' ? '<textarea id="frame-editor">Frame text</textarea>' :
        req.url === '/external' ? browserHtml : '<!doctype html><meta charset="utf-8"><body style="margin:24px;background:#111827;color:#ddd"><div id="root"></div><script src="/app.js"></script>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const loading = path.join(dir, 'loading.html');
    fs.writeFileSync(loading, '<!doctype html>');
    const preload = path.resolve(__dirname, '../../dist/preload/preload.js');
    const manager = new TabManager({
      allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
      preloadPath: preload, loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
      theme: () => 'dark', openWindow() {}, browserPreferencesConfigDir: dir,
    });
    manager.setBrowserUrl(origin + '/browser');
    const window = new BrowserWindow({ show: false, width: 900, height: 840, webPreferences: { preload, contextIsolation: true, sandbox: true } });
    manager.attach(window);
    await window.loadURL(origin + '/dashboard');
    window.setPosition(24, 24);
    window.setAlwaysOnTop(true);
    window.showInactive();
    let menus = 0;
    Menu.prototype.popup = function(options) { menus++; options?.callback?.(); };
    const click = async (contents, selector) => {
      console.log('Right-click', selector, contents.getURL());
      window.focus(); contents.focus();
      const point = await contents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'});
        const r = el.getBoundingClientRect(); return { x:Math.round(r.x+12), y:Math.round(r.y+12) };
      })()`);
      const context = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No context event: ' + selector)), 5000);
        contents.once('context-menu', (_event, params) => { clearTimeout(timeout); resolve(params); });
      });
      contents.sendInputEvent({ type: 'mouseMove', ...point });
      await new Promise(resolve => setTimeout(resolve, 80));
      contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point });
      contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point });
      return context;
    };
    const value = (contents, selector) => contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).value`);
    const select = (contents, selector) => contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).select()`);
    const chat = window.webContents;
    await until(() => chat.executeJavaScript('!!document.querySelector("#chat")'), 'React chat ready');
    clipboard.writeText('Pasted message ✓');
    await select(chat, '#chat');
    await click(chat, '#chat');
    await until(async () => await value(chat, '#chat') === 'Pasted message ✓', 'chat paste');
    assert.equal(await chat.executeJavaScript('document.querySelector("#draft").textContent'), 'Pasted message ✓', 'React draft state updated');
    assert.equal(await chat.executeJavaScript('window.pasteCount'), 1, 'one real paste event');
    chat.undo();
    await until(async () => await value(chat, '#chat') === 'Original message', 'native undo');
    clipboard.writeImage(nativeImage.createFromBitmap(Buffer.from([0, 128, 255, 255]), { width: 1, height: 1 }));
    await click(chat, '#chat');
    await until(() => chat.executeJavaScript('window.imagePaste === true'), 'chat image paste handler');
    assert.equal(menus, 0, 'chat right-click bypasses menus');

    // Search the real profile component with native input, including its empty state.
    await chat.executeJavaScript('document.querySelector("input[type=search]").focus()');
    chat.insertText('private');
    await until(() => chat.executeJavaScript('document.querySelectorAll("#shortcuts dt").length === 2'), 'shortcut filtering');
    await select(chat, 'input[type=search]');
    chat.insertText('no matching shortcut');
    await until(() => chat.executeJavaScript('!!document.querySelector("#shortcuts [role=status]")'), 'shortcut empty state');
    await select(chat, 'input[type=search]');
    chat.insertText('');
    await until(() => chat.executeJavaScript('document.querySelectorAll("#shortcuts dt").length > 20'), 'shortcut list restored');
    if (process.env.BREADBOARD_SHORTCUTS_SCREENSHOT) {
      const source = fs.readFileSync(path.join(dashboard, 'src/app/profile/keyboard-shortcuts-panel.tsx'), 'utf8');
      const candidates = [...source.matchAll(/className="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/));
      const compiler = await requireDashboard('@tailwindcss/node').compile('@import "tailwindcss";', { base: dashboard, onDependency() {} });
      await chat.insertCSS(compiler.build(candidates) + 'body{font-family:Arial,sans-serif}.neu-surface-raised{background:#171b25}');
      for (const width of [400, 320]) {
        await chat.executeJavaScript(`document.querySelector('#shortcuts').style.width='${width}px'`);
        await chat.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const bounds = await chat.executeJavaScript(`(() => {const el=document.querySelector('#shortcuts');const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height),overflow:el.scrollWidth>el.clientWidth};})()`);
        assert.equal(bounds.overflow, false, 'shortcut card fits at ' + width);
        const { overflow, ...clip } = bounds;
        const screenshot = process.env.BREADBOARD_SHORTCUTS_SCREENSHOT.replace(/\.png$/, '-' + width + '.png');
        fs.writeFileSync(screenshot, (await chat.capturePage(clip)).toPNG());
      }
    }

    // A different origin uses the sandboxed browser path.
    const external = origin.replace('127.0.0.1', 'localhost') + '/external';
    await manager.handleCommand(chat, { type: 'browser', url: external });
    let page;
    await until(() => {
      page = webContents.getAllWebContents().find(c => c.getURL() === external);
      return page && !page.isLoading() && window.contentView.children.some(view => view.webContents === page);
    }, 'browser page');
    for (const selector of ['#address', '#editor']) {
      clipboard.writeText('Right-click paste ✓');
      await select(page, selector);
      await click(page, selector);
      await until(async () => await value(page, selector) === 'Right-click paste ✓', selector + ' paste');
    }
    await select(page, '#address');
    clipboard.writeText('Clicked field');
    await click(page, '#editor');
    await until(async () => (await value(page, '#editor')).includes('Clicked field'), 'paste focuses the clicked field');
    assert.equal(await value(page, '#address'), 'Right-click paste ✓', 'previously focused field stays unchanged');
    clipboard.write({ text: 'Formatted paste', html: '<b>Formatted paste</b>' });
    await page.executeJavaScript('document.querySelector("#rich").focus();const range=document.createRange();range.selectNodeContents(document.querySelector("#rich"));getSelection().removeAllRanges();getSelection().addRange(range)');
    await click(page, '#rich');
    await until(() => page.executeJavaScript('document.querySelector("#rich").textContent === "Formatted paste"'), 'rich paste');
    assert.ok(await page.executeJavaScript(`!!document.querySelector('#rich b, #rich [style*="bold"], #rich [style*="700"]')`), 'formatting preserved');
    assert.equal(menus, 0, 'editable browser right-click bypasses menus');
    await click(page, '#readonly');
    await click(page, '#disabled');
    assert.equal(await value(page, '#readonly'), 'Read only');
    assert.equal(await value(page, '#disabled'), 'Disabled');

    clipboard.writeText('Inside frame');
    await page.executeJavaScript('const field=document.querySelector("iframe").contentDocument.querySelector("textarea");field.focus();field.select()');
    await click(page, 'iframe');
    await until(() => page.executeJavaScript('document.querySelector("iframe").contentDocument.querySelector("textarea").value === "Inside frame"'), 'iframe paste');
    const beforeLink = menus;
    await click(page, '#link');
    assert.equal(menus, beforeLink + 1, 'links still open context menus');
    clipboard.clear();
    const previousText = await value(page, '#editor');
    await select(page, '#editor');
    await click(page, '#editor');
    assert.equal(await value(page, '#editor'), previousText, 'empty clipboard preserves text');
    assert.equal(await page.executeJavaScript('typeof window.breadboardDesktop'), 'undefined', 'no desktop bridge exposed to sites');
    console.log('PASS: native paste, React state, image attachments, undo, rich text, read-only/disabled fields, iframes, empty clipboard, context menus, shortcut search');
    fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
  } finally { clipboard.write(original); }
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
