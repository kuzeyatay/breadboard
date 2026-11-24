// The "flag website as AI" button in a real browser. The rail button and the
// address bar are the real components, styled by the real globals.css. Behind
// them: the real Crumbs client core and indexer, and a stand-in AT Protocol
// network. The desktop bridge is a stub that does what tab-manager.ts does for
// `browser-ai-flags` and `browser-ai-flag-confirm` (the native question is
// answered by the test). BREADBOARD_AIFLAG_SCREENSHOTS=<dir> saves screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { CrumbsError, createCrumbs } from '../src/lib/crumbs/core.ts';
import { openDatabase } from '../../crumbs/lib/db.mjs';
import { serve } from '../../crumbs/lib/http.mjs';
import { createIndexer, settings as indexerSettings } from '../../crumbs/indexer.mjs';
import { did, startFakeNetwork } from '../../crumbs/test/fake-network.mjs';

process.env.NEXTAUTH_SECRET = 'aiflag-ui-test-secret-0123456789';
const shots = process.env.BREADBOARD_AIFLAG_SCREENSHOTS;

test('flag a website as AI: ask once, red flag, shared counts outline the address yellow then red', { timeout: 180000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const ui = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import BrowserAiFlag from './src/app/browser/browser-ai-flag';
    import BrowserNavigation from './src/app/browser/browser-navigation';
    import {useDesktopTabs} from './src/app/components/use-desktop-tabs';
    function App(){ const state=useDesktopTabs(); const tab=state?.tabs[0]; if(!tab) return null;
      return <div style={{display:'flex',flexDirection:'column',height:'100vh'}}>
        <BrowserNavigation tab={tab} showFlowers={false} restoreOwnerKey="test" onPanel={()=>{}}/>
        <div style={{display:'flex',flex:1}}>
          <nav className="browser-side-rail" aria-label="Browser tools"><div className="browser-rail-actions">
            <BrowserAiFlag url={tab.browser.address} askFirst={state.browserPreferences?.aiFlagConfirm!==false}/>
          </div></nav>
          <main style={{flex:1,padding:24}}>{tab.browser.address}</main>
        </div></div>; }
    createRoot(document.getElementById('root')).render(<App/>);` },
    outfile: 'ui.js', bundle: true, write: false, metafile: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' } });
  const js = ui.outputFiles.find(file => file.path.endsWith('.js')).text;
  // The real stylesheet, compiled the way desktop/scripts/copy-static.mjs compiles the shell's.
  const modules = path.join(root, 'node_modules');
  const { default: postcss } = await import(pathToFileURL(path.join(modules, 'postcss/lib/postcss.mjs')).href);
  const { default: tailwind } = await import(pathToFileURL(path.join(modules, '@tailwindcss/postcss/dist/index.mjs')).href);
  const globals = path.join(root, 'src/app/globals.css');
  const sources = Object.keys(ui.metafile.inputs).filter(file => !file.includes('node_modules') && /\.[jt]sx?$/.test(file))
    .map(file => `@source "${path.resolve(root, file).replaceAll('\\', '/')}";`).join('\n');
  const css = (await postcss([tailwind({ base: path.dirname(globals), optimize: false })]).process(fs.readFileSync(globals, 'utf8').replace(/^@source[^;]+;/gm, sources), { from: globals })).css;

  // ---- The network: AT accounts, the real indexer (outline at 2 and 3 flags) ----
  const net = await startFakeNetwork(); t.after(() => net.close());
  const people = [[did(41), 'me.test'], [did(42), 'bob.test'], [did(43), 'carol.test']];
  for (const [id, handle] of people) net.account(id, handle);
  const indexerDb = await openDatabase({ file: ':memory:' }); t.after(() => indexerDb.close());
  const indexer = await createIndexer({ db: indexerDb, config: { ...indexerSettings({}), aiFlagWarn: 2, aiFlagAlert: 3 } });
  const indexerServer = await serve({ port: 0, host: '127.0.0.1', handler: indexer.api, name: 'indexer' });
  t.after(() => { indexerServer.closeAllConnections(); indexerServer.close(); });
  process.env.CRUMBS_INDEXER_URL = `http://127.0.0.1:${indexerServer.address().port}`;
  process.env.CRUMBS_ORG_STORE_URL = 'http://127.0.0.1:9';
  const breadboards = [];
  for (const [id, handle] of people) {
    const db = new Database(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users VALUES(1, 'local')");
    const crumbs = createCrumbs({ db });
    const { url } = await crumbs.startSignIn(1, { handle, origin: 'http://localhost:3000', returnTo: '/' });
    await crumbs.finishSignIn(net.approve(url, id));
    breadboards.push(crumbs);
  }
  const [me, bob, carol] = breadboards;

  // ---- My Breadboard: the page and src/app/api/crumbs (ai-flags / ai-flag) ----
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      if (url.pathname === '/ui.js') return send(200, 'text/javascript', js);
      if (url.pathname === '/ui.css') return send(200, 'text/css', css);
      if (url.pathname === '/api/crumbs' && req.method === 'GET' && url.searchParams.get('view') === 'ai-flags')
        return send(200, 'application/json', JSON.stringify(await me.aiFlags(1, url.searchParams.get('url'))));
      if (url.pathname === '/api/crumbs' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        assert.equal(input.action, 'ai-flag');
        return send(200, 'application/json', JSON.stringify(await me.aiFlag(1, input.url, input.on)));
      }
      return send(200, 'text/html', `<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script>${BRIDGE}</script><script src="/ui.js"></script></body></html>`);
    } catch (error) { send(error instanceof CrumbsError ? error.status : 500, 'application/json', JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 420 }, colorScheme: 'dark' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}.png`) }); } };
  const flag = page.getByRole('button', { name: /flag/i });
  const outline = async () => { await page.waitForTimeout(250); return page.locator('form.browser-address-form').evaluate(form => ({ level: form.dataset.aiFlag ?? null, border: getComputedStyle(form).borderTopColor })); };
  const flagLook = async () => { await page.waitForTimeout(250); return flag.evaluate(button => ({ pressed: button.getAttribute('aria-pressed'), color: getComputedStyle(button).color, fill: button.querySelector('svg').getAttribute('fill'), disabled: button.disabled })); };
  const open = async address => { await page.goto(`${origin}/?address=${encodeURIComponent(address)}`); await page.waitForFunction(() => window.commands?.some(c => c.type === 'browser-ai-flags')); await page.waitForTimeout(150); };
  const RED = 'rgb(229, 72, 77)', YELLOW = 'rgb(227, 176, 8)';

  // 1. An unflagged website: the flag is plain, the address has no outline.
  await open('https://www.slop.example/posts/1');
  const plain = await flagLook();
  assert.deepEqual([plain.pressed, plain.fill, plain.disabled], ['false', 'none', false]);
  assert.notEqual(plain.color, RED);
  assert.equal((await outline()).level, null);
  await shot('1-unflagged');

  // 2. Cancelling the question flags nothing.
  await page.evaluate(() => { window.answer = { ok: false, dontAsk: false }; });
  await flag.click();
  await page.waitForFunction(() => window.commands.some(c => c.type === 'browser-ai-flag-confirm'));
  assert.equal((await flagLook()).pressed, 'false');
  assert.equal((await me.aiFlags(1, 'https://slop.example/')).count, 0);

  // 3. Confirming with "Don't show this again": the flag turns red, and is a record in my own AT account.
  await page.evaluate(() => { window.answer = { ok: true, dontAsk: true }; });
  await flag.click();
  await page.waitForFunction(() => document.querySelector('.browser-ai-flag')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(await page.evaluate(() => window.commands.filter(c => c.type === 'browser-ai-flag-confirm').map(c => c.site)), ['slop.example', 'slop.example']);
  const look = await flagLook();
  assert.equal(look.color, RED); assert.equal(look.fill, 'currentColor');
  assert.ok(net.state.records.has(`at://${people[0][0]}/com.breadboard.aiflag/slop.example`));
  assert.equal((await outline()).level, null, 'one flag is not enough for an outline');
  await shot('2-flagged-red');

  // 4. Bob flags it too: the address is outlined yellow.
  await bob.aiFlag(1, 'https://slop.example/elsewhere', true);
  await open('https://slop.example/posts/2');
  assert.deepEqual(await outline(), { level: 'yellow', border: YELLOW });
  assert.equal((await flagLook()).color, RED, 'my flag stays red on another page of the same site');
  await shot('3-yellow-outline');

  // 5. Carol too: red.
  await carol.aiFlag(1, 'https://slop.example/', true);
  await open('https://slop.example/posts/3');
  assert.deepEqual(await outline(), { level: 'red', border: RED });
  await shot('4-red-outline');

  // 6. Clicking my red flag takes it back without asking; back to yellow.
  const asked = await page.evaluate(() => window.commands.filter(c => c.type === 'browser-ai-flag-confirm').length);
  await flag.click();
  await page.waitForFunction(() => document.querySelector('.browser-ai-flag')?.getAttribute('aria-pressed') === 'false');
  await page.waitForFunction(() => document.querySelector('form.browser-address-form')?.dataset.aiFlag === 'yellow');
  assert.notEqual((await flagLook()).color, RED);

  // 7. "Don't show this again" was kept: flagging again is one click, no question.
  await flag.click();
  await page.waitForFunction(() => document.querySelector('form.browser-address-form')?.dataset.aiFlag === 'red');
  assert.equal(await page.evaluate(() => window.commands.filter(c => c.type === 'browser-ai-flag-confirm').length), asked);
  assert.equal((await flagLook()).color, RED);

  // 8. Another site has its own count, and a page that looks private cannot be flagged.
  await open('https://news.example.org/');
  assert.equal((await outline()).level, null);
  assert.equal((await flagLook()).pressed, 'false');
  await open('https://mail.example.com/inbox');
  assert.equal((await flagLook()).disabled, true);
  await shot('5-private-page');
  assert.deepEqual(errors, []);
});

// The desktop bridge stub. It keeps the tab state the shell would broadcast and
// mirrors tab-manager.ts: the outline is shown only while the reported site is
// the tab's own, and "Don't show this again" is saved in browser preferences.
const BRIDGE = `(() => {
  const address = new URLSearchParams(location.search).get('address') || 'https://slop.example/';
  const prefs = JSON.parse(sessionStorage.getItem('prefs') || '{"notificationsEnabled":true,"sites":{},"translationLanguage":"en"}');
  let flags = null; const listeners = new Set(); window.commands = [];
  const host = url => new URL(url).hostname.toLowerCase().replace(/^www\\./, '');
  const state = () => ({ enabled: true, activeId: 1, extensions: [], presentationRevision: 0, browserPreferences: prefs, tabs: [{ id: 1, generation: 1, title: 'Page', url: address, loading: false,
    browser: { address, pageReady: true, canGoBack: false, canGoForward: false, terminalOpen: false, terminalWidth: 0,
      ...(flags && flags.site === host(address) ? { aiFlagLevel: flags.level } : {}) } }] });
  const publish = () => { const next = state(); for (const listener of listeners) listener(next); };
  window.breadboardDesktop = {
    getTabsState: async () => state(),
    onTabsState: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    tabs: async command => {
      window.commands.push(command);
      if (command.type === 'browser-ai-flags') { flags = command.site && command.level ? { site: command.site, level: command.level } : null; publish(); return true; }
      if (command.type === 'browser-ai-flag-confirm') {
        const answer = window.answer || { ok: false };
        if (answer.ok && answer.dontAsk) { prefs.aiFlagConfirm = false; sessionStorage.setItem('prefs', JSON.stringify(prefs)); publish(); }
        return answer.ok;
      }
      return true;
    },
  };
})();`;
