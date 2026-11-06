import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

test('private home keeps Terminal layout and sends searches only to its private browser', { timeout: 60_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import BrowserClient from './src/app/browser/browser-client';
      createRoot(document.getElementById('root')).render(<BrowserClient showFlowers={false} restoreOwnerKey="fixture"
        initialGreetingSignals={{}} home={<main aria-label="Regular Terminal">Regular Terminal</main>} />);
    ` },
    outfile: 'ui.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [{ name: 'unrelated-panels', setup(build) {
      build.onResolve({ filter: /(?:dashboard-agent-terminal|settings-dialog|use-chat-greeting)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('use-chat-greeting')
        ? 'export const useChatGreeting=()=>({greeting:null});' : 'export default function Panel(){return null}', loader: 'js' }));
    } }],
  });
  const globalsPath = path.join(root, 'src/app/globals.css');
  const globals = await postcss([tailwind({ base: root })]).process(fs.readFileSync(globalsPath, 'utf8'), { from: globalsPath });
  const css = globals.css + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/ui.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
    if (req.url === '/ui.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (req.url === '/api/browser/spotify/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': ready\n\n'); return; }
    if (req.url.startsWith('/api/')) {
      requests.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ connected: false, engine: { ready: false, status: 'stopped' }, playback: null, history: [], items: [], calendars: [] })); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html data-theme="light" data-breadboard-desktop="true" style="--breadboard-titlebar-height:0px"><head><link rel="stylesheet" href="/ui.css"></head><body><div class="browser-shell" id="root"></div><script src="/ui.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    const listeners = new Set();
    window.commands = []; window.historyWrites = 0;
    window.state = { enabled: true, selfId: 7, activeId: 7, extensions: [], tabs: [{ id: 7, generation: 1, title: 'Private', url: '/browser', loading: false,
      browser: { address: '', private: true, terminalOpen: false, terminalWidth: 640 } }] };
    window.breadboardDesktop = {
      getTabsState: async () => window.state,
      onTabsState: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      tabs: async command => { window.commands.push(command); return true; },
      getBrowserBookmarks: async () => [], getBrowserShortcuts: async () => [],
      setBrowserBookmarks: async () => true, setBrowserShortcuts: async () => true,
      getBrowserRecentSearches: async () => ['regular search'],
      setBrowserRecentSearches: async () => { window.historyWrites++; return true; },
      getBrowserHistory: async () => ({ items: [], error: null }), onBrowserHistoryChanged: () => () => {},
      getBrowserDownloads: async () => ({ items: [], error: null }), onBrowserDownloads: () => () => {},
    };
    window.updateBrowser = changes => {
      window.state = { ...window.state, tabs: window.state.tabs.map(tab => ({ ...tab, browser: { ...tab.browser, ...changes } })) };
      for (const listener of listeners) listener(window.state);
    };
    window.enablePersistentShell = () => {
      window.state = { ...window.state, persistentShell: true };
      for (const listener of listeners) listener(window.state);
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/browser`, { waitUntil: 'domcontentloaded' });
  const home = page.locator('[data-private-home]');
  await home.waitFor();
  const search = home.getByRole('combobox');
  assert.equal(await page.locator('.browser-start-copy, .browser-side-rail').count(), 0);
  assert.equal(await home.getByRole('heading', { level: 1 }).count(), 1);
  assert.equal(await home.getByText('Private browsing', { exact: true }).count(), 1);
  const widgets = home.getByRole('region', { name: 'Quick tools and widgets' });
  const widgetBounds = await widgets.boundingBox(), searchBounds = await search.boundingBox();
  assert.ok(widgetBounds.y + widgetBounds.height < searchBounds.y, 'widgets sit above the search, as on Terminal');
  assert.ok(searchBounds.width > 800, 'search uses Terminal content width');
  const lightColor = await home.evaluate(node => getComputedStyle(node).getPropertyValue('--botanical').trim());
  assert.equal(lightColor, '#7952a3');
  const capture = async name => {
    if (!process.env.BREADBOARD_PRIVATE_HOME_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.BREADBOARD_PRIVATE_HOME_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.BREADBOARD_PRIVATE_HOME_SCREENSHOT_DIR, name), fullPage: true });
  };
  await capture('private-light.png');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  assert.equal(await home.evaluate(node => getComputedStyle(node).getPropertyValue('--botanical').trim()), '#c29ae8');
  await capture('private-dark.png');
  await page.setViewportSize({ width: 540, height: 960 });
  await capture('private-narrow.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow windows have no horizontal overflow');
  await page.evaluate(() => window.enablePersistentShell());
  await page.locator('[data-browser-content-id="7"]').waitFor();
  await home.getByRole('button', { name: 'Add shortcut', exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await home.evaluate(node => node.scrollTop > 0), 'private home scrolls within the native shell in a narrow window');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await search.fill('private search phrase');
  await search.press('Enter');
  await page.waitForFunction(() => window.commands.some(command => command.type === 'browser-navigate' && command.input === 'private search phrase'));
  assert.equal(await page.evaluate(() => window.historyWrites), 0);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('private search phrase')), false);
  assert.ok(!requests.some(url => url.includes('/suggestions') || url.includes('/new-tab/search')), 'private queries never reach account search or remote autocomplete');
  await home.getByRole('button', { name: 'Open Terminal', exact: true }).click();
  await page.waitForFunction(() => window.commands.some(command => command.type === 'browser-terminal' && command.open));
  await page.evaluate(() => window.updateBrowser({ address: 'https://example.com/private', pageReady: true }));
  await home.waitFor({ state: 'hidden' });
  await page.locator('.browser-side-rail').waitFor();
  await page.evaluate(() => window.updateBrowser({ address: '', private: false }));
  await page.getByRole('main', { name: 'Regular Terminal' }).waitFor();
  assert.deepEqual(errors, []);
});
