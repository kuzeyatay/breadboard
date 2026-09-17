import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('anchored navigation preserves the screen and back trail while allowing internal moves', { timeout: 45_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { installAnchoredTabNavigation } from './src/lib/anchored-tab-navigation';
      import { subscribeDesktopTabs } from './src/lib/desktop-browser-tabs';
      import { isSameTabScreen, ANCHORED_TAB_NAVIGATION_MESSAGE } from '../desktop/src/main/tab-navigation-policy';
      const listeners = new Set();
      // The receiving page's selfId, not the window's activeId, owns the lock.
      let state = { enabled: true, selfId: 1, activeId: 2, tabs: [{ id: 1, anchored: true }, { id: 2, anchored: false }], extensions: [] };
      window.breadboardDesktop = {
        getTabsState: async () => state,
        onTabsState(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        tabs: async ({ url }) => {
          window.checks++;
          const allowed = !state.tabs[0].anchored || isSameTabScreen(location.href, url);
          if (!allowed) document.querySelector('[role=alert]').textContent = ANCHORED_TAB_NAVIGATION_MESSAGE;
          return allowed;
        },
      };
      window.checks = 0;
      window.consumed = 0;
      const showRoute = () => document.querySelector('output').textContent = location.pathname + location.search + location.hash;
      const router = {
        push(href) { history.pushState({}, '', href); showRoute(); },
        replace(href) { history.replaceState({}, '', href); showRoute(); },
      };
      window.router = router;
      const detach = subscribeDesktopTabs(() => {});
      // Exercise the effect's setup-cleanup-setup cycle as in React StrictMode.
      installAnchoredTabNavigation(router)();
      window.cleanup = installAnchoredTabNavigation(router);
      window.setAnchored = value => { state.tabs[0].anchored = value; listeners.forEach(listener => listener(state)); };
      window.clearNotice = () => document.querySelector('[role=alert]').textContent = '';
      window.addEventListener('popstate', showRoute);
      document.querySelectorAll('a[data-client-link]').forEach(link => link.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target) return;
        event.preventDefault();
        if (link.id === 'back') window.consumed++;
        router.push(link.getAttribute('href'));
      }));
      document.querySelector('#push').onclick = () => router.push('/gardens/demo');
      document.querySelector('#replace').onclick = () => router.replace('/profile');
      document.querySelector('#internal').onclick = () => router.push('/garden/demo?note=two#example');
      document.querySelector('#history-back').onclick = () => history.back();
      document.querySelector('#history-forward').onclick = () => history.forward();
      showRoute();
      window.ready = true;
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? bundle.outputFiles[0].text : `<!doctype html>
      <input aria-label="Draft" value="Unsent note">
      <output></output><div role="alert"></div>
      <a id="back" data-client-link href="/gardens/demo">Back to workspace</a>
      <a id="note" data-client-link href="/garden/demo?note=three">Another note</a>
      <a id="new-tab" data-client-link target="_blank" href="/gardens/demo">Workspace in new tab</a>
      <button id="push">Push workspace</button><button id="replace">Replace with profile</button>
      <button id="internal">Open note</button>
      <button id="history-back">Back</button><button id="history-forward">Forward</button>
      <script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
  ].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin + '/garden/demo');
  await page.waitForFunction(() => window.ready);
  const notice = page.getByRole('alert');
  const blocked = async (selector, expected = '/garden/demo') => {
    await page.evaluate(() => window.clearNotice());
    await page.click(selector);
    await page.waitForFunction(() => document.querySelector('[role=alert]').textContent !== '');
    assert.equal(await notice.textContent(), 'Unanchor the page to move to a different screen.');
    assert.equal(page.url(), origin + expected);
    assert.equal(await page.locator('output').textContent(), expected);
    assert.equal(await page.getByRole('textbox').inputValue(), 'Unsent note');
  };
  await blocked('#back');
  assert.equal(await page.evaluate(() => window.consumed), 0, 'a blocked BackLink must not unwind the trail');
  await blocked('#push');
  await blocked('#replace');
  await page.click('#internal');
  await page.waitForURL(origin + '/garden/demo?note=two#example');
  await page.click('#note');
  await page.waitForURL(origin + '/garden/demo?note=three');
  await page.click('#history-back');
  await page.waitForURL(origin + '/garden/demo?note=two#example');
  await page.click('#history-forward');
  await page.waitForURL(origin + '/garden/demo?note=three');

  const checks = await page.evaluate(() => window.checks);
  const popupPromise = page.waitForEvent('popup');
  await page.click('#new-tab');
  const popup = await popupPromise;
  await popup.close();
  assert.equal(await page.evaluate(() => window.checks), checks, 'new tabs bypass the current page lock');
  await page.locator('#back').dispatchEvent('click', { ctrlKey: true, button: 0 });
  assert.equal(await page.evaluate(() => window.checks), checks, 'modified clicks bypass the current page lock');

  await page.evaluate(() => { window.setAnchored(false); window.router.push('/gardens/demo'); });
  await page.waitForURL(origin + '/gardens/demo');
  await page.evaluate(() => window.setAnchored(true));
  await blocked('#history-back', '/gardens/demo');
  await page.evaluate(() => window.setAnchored(false));
  await page.click('#history-back');
  await page.waitForURL(origin + '/garden/demo?note=three');
  await page.evaluate(() => window.setAnchored(true));
  await blocked('#history-forward', '/garden/demo?note=three');

  await page.evaluate(() => window.setAnchored(false));
  await page.click('#back');
  await page.waitForURL(origin + '/gardens/demo');
  assert.equal(await page.evaluate(() => window.consumed), 1);
  await page.evaluate(() => { window.setAnchored(true); window.cleanup(); window.router.replace('/profile'); });
  await page.waitForURL(origin + '/profile');
  assert.deepEqual(errors, []);
});
