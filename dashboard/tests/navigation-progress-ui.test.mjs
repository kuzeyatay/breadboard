import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';

test('navigation progress survives redirects, repeated starts, and interrupted completion', { timeout: 45_000 }, async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const globals = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  const progressCss = globals.slice(globals.indexOf('.bb-nav-progress {'), globals.indexOf('@keyframes learn-progress-pulse'));
  const css = await postcss([tailwindcss({ base: root })]).process(`
    @import "tailwindcss" source(none);
    @source "./src/app/components/navigation-progress.tsx";
    ${progressCss}
  `, { from: `${root}/navigation-progress-fixture.css` });
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, { StrictMode, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import NavigationProgress, { startNavigationProgress, cancelNavigationProgress } from './src/app/components/navigation-progress';
      import { usePageLoading } from './src/app/components/use-page-loading';
      const listeners = new Set();
      let desktop = { enabled: true, activeId: 1, selfId: 1, tabs: [], extensions: [], navigationPending: false };
      window.breadboardDesktop = {
        getTabsState: async () => desktop,
        onTabsState(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        tabs: async () => true,
      };
      window.setNativePending = navigationPending => flushSync(() => {
        desktop = { ...desktop, navigationPending };
        listeners.forEach(listener => listener(desktop));
      });
      window.start = () => flushSync(startNavigationProgress);
      window.cancel = () => flushSync(cancelNavigationProgress);
      function App() {
        const [pending, setPending] = useState(false);
        const [, render] = useState(0);
        usePageLoading(pending);
        window.setPagePending = value => flushSync(() => setPending(value));
        window.commitRoute = path => {
          history.pushState({}, '', path);
          flushSync(() => render(value => value + 1));
        };
        return <><NavigationProgress /><main>Current website remains visible</main></>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'router-fixture', setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const usePathname = () => location.pathname;
        export const useSearchParams = () => new URLSearchParams(location.search);
      `, loader: 'js' }));
    } }],
  });
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? bundle.outputFiles[0].text :
      `<!doctype html><html><head><style>${css.css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/start`);
  await page.waitForFunction(() => typeof window.commitRoute === 'function');
  const state = () => page.locator('[role="progressbar"]').evaluate(bar => ({
    busy: bar.getAttribute('aria-busy') === 'true',
    hidden: bar.getAttribute('aria-hidden') === 'true',
    progress: Number(bar.getAttribute('aria-valuenow')),
  }));
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const tick = ms => page.clock.runFor(ms);
  const rememberFill = () => page.evaluate(() => { window.previousFill = document.querySelector('[role="progressbar"]').firstElementChild; });
  const sameFill = () => page.evaluate(() => window.previousFill === document.querySelector('[role="progressbar"]').firstElementChild);

  // Route updates without pending work, including hash history, stay invisible.
  await page.evaluate(() => window.commitRoute('/idle'));
  await tick(500);
  assert.deepEqual(await state(), { busy: false, hidden: true, progress: 0 });
  await page.evaluate(() => { history.pushState({}, '', '#section'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await tick(500);
  assert.equal((await state()).hidden, true);

  // Duplicate start events must not postpone progress forever.
  await page.evaluate(() => window.start());
  await rememberFill();
  for (let i = 0; i < 8; i++) {
    await tick(100);
    await page.evaluate(() => window.start());
  }
  assert.ok((await state()).progress > 20, 'frequent starts still advance');
  assert.equal(await sameFill(), true, 'one continuous bar for overlapping starts');
  await page.evaluate(() => window.cancel());
  assert.equal((await state()).hidden, true);
  await tick(500);

  // A brief stop between website loads is a redirect, not a completed cycle.
  await page.evaluate(() => window.setPagePending(true));
  await tick(800);
  await rememberFill();
  const beforeRedirect = (await state()).progress;
  await page.evaluate(() => window.setPagePending(false));
  await tick(50);
  assert.equal((await state()).busy, true);
  await page.evaluate(() => window.setPagePending(true));
  await tick(500);
  assert.equal(await sameFill(), true);
  assert.ok((await state()).progress >= beforeRedirect);
  assert.equal((await state()).busy, true);

  // A route commit/native reveal cannot complete ongoing page work.
  await page.evaluate(() => { window.setNativePending(true); window.commitRoute('/next'); });
  await tick(200);
  await page.evaluate(() => window.setNativePending(false));
  await tick(200);
  assert.equal((await state()).busy, true);

  // Restart both during the completion sweep and during the fade. The old
  // cycle must neither animate backwards nor hide/reset the new cycle later.
  for (const completionAge of [130, 360]) {
    await page.evaluate(() => window.setPagePending(false));
    await tick(completionAge);
    assert.equal((await state()).busy, false);
    await rememberFill();
    await page.evaluate(() => window.setPagePending(true));
    await tick(20);
    assert.equal(await sameFill(), false, 'new load gets a fresh fill');
    const restart = await page.locator('[role="progressbar"] > div').evaluate(fill => ({
      right: fill.getBoundingClientRect().right,
      width: fill.getBoundingClientRect().width,
      transition: getComputedStyle(fill).transitionProperty,
    }));
    assert.ok(restart.right <= 100, `new fill starts near the left edge: ${restart.right}`);
    assert.equal(restart.width, 1000, 'fill uses fixed geometry');
    assert.equal(restart.transition, 'transform');
    await tick(650);
    assert.equal((await state()).busy, true);
    assert.equal((await state()).hidden, false);
    assert.ok((await state()).progress > 8);
  }

  // Even the backstop must not clear real, long-running browser work.
  await page.clock.fastForward(121_000);
  assert.equal((await state()).busy, true);
  await page.evaluate(() => window.setPagePending(false));
  await tick(120);
  assert.deepEqual(await state(), { busy: false, hidden: false, progress: 100 });
  await tick(210);
  assert.equal((await state()).hidden, true);
  await tick(200);
  assert.equal((await state()).progress, 0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.start());
  const motion = await page.locator('[role="progressbar"]').evaluate(bar => ({
    fade: getComputedStyle(bar).transitionDuration,
    fill: getComputedStyle(bar.firstElementChild).transitionDuration,
  }));
  assert.deepEqual(motion, { fade: '0s', fill: '0s' });
  await page.evaluate(() => window.cancel());
  assert.deepEqual(errors, []);
});
