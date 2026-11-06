import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import { installQuartzNavigationProgress } from '../../quartz/quartz/components/scripts/navigationProgress.mjs';

test('Quartz navigation shares the green shell bar above the navbar', { timeout: 30_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const hostOrigin = 'http://localhost:53281', quartzOrigin = 'http://localhost:53282';
  const globals = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
  const progressCss = globals.slice(globals.indexOf('.bb-nav-progress {'), globals.indexOf('@keyframes learn-progress-pulse'));
  const css = await postcss([tailwindcss({ base: root })]).process(`
    @import "tailwindcss" source(none);
    @source "./src/app/components/navigation-progress-bar.tsx";
    ${progressCss}
  `, { from: path.join(root, 'navigation-progress-fixture.css') });
  const host = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, { useRef, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import NavigationProgress from './src/app/components/navigation-progress';
      import { usePageLoading } from './src/app/components/use-page-loading';
      import { useQuartzNavigationProgress } from './src/app/garden/use-quartz-navigation-progress';
      function Garden() {
        const ref = useRef(null);
        useQuartzNavigationProgress(ref, '${quartzOrigin}');
        return <iframe ref={ref} title="Garden" src="${quartzOrigin}/initial" />;
      }
      function App() {
        const [show, setShow] = useState(true), [pending, setPending] = useState(false);
        window.removeGarden = () => setShow(false);
        window.setShellPending = setPending;
        usePageLoading(pending);
        return <><NavigationProgress /><nav style={{height: 80}}>Navigation</nav>{show && <Garden />}</>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    plugins: [{ name: 'router-fixture', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const usePathname = () => location.pathname;
        export const useSearchParams = () => new URLSearchParams(location.search);
      ` }));
    } }],
  });
  const spa = await build({ entryPoints: [path.resolve(root, '../quartz/quartz/components/scripts/spa.inline.ts')], bundle: true, write: false, platform: 'browser', format: 'iife' });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseDestination;
  const destinationReady = new Promise(resolve => { releaseDestination = resolve; });
  t.after(() => releaseDestination());
  await page.route(`${hostOrigin}/**`, route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html data-theme="light"><head><style>${css.css}</style></head>
    <body><div id="root"></div><script>${host.outputFiles[0].text}</script></body></html>
  ` }));
  await page.route(`${quartzOrigin}/**`, async route => {
    const destination = new URL(route.request().url()).pathname === '/destination';
    if (destination) await destinationReady;
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
      <title>${destination ? 'Destination' : 'Initial'}</title>
      <style data-persist>:root{--secondary:#4f6f68}.navigation-progress{position:fixed;top:0;height:3px;width:80%;background:var(--secondary)}</style>
      <script data-persist>(${installQuartzNavigationProgress.toString()})();</script>
      </head><body><article>${destination ? 'Destination' : 'Initial'}</article>
      <a href="/destination">Next page</a>
      ${destination ? '' : '<div class="navigation-progress"></div>'}
      <script data-persist>${spa.outputFiles[0].text}</script></body></html>` });
  });
  await page.goto(hostOrigin);
  const bar = page.locator('.bb-nav-progress');
  const busy = value => page.waitForFunction(value => document.querySelector('.bb-nav-progress')?.getAttribute('aria-busy') === String(value), value);
  const reader = page.frameLocator('iframe');
  await busy(true);
  assert.equal(await reader.locator('.navigation-progress').evaluate(el => getComputedStyle(el).display), 'none');
  assert.equal((await bar.boundingBox()).y, 0);
  assert.equal((await page.locator('iframe').boundingBox()).y, 80);
  assert.equal(await bar.locator('div').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(79, 111, 104)');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.equal(await bar.locator('div').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(145, 183, 161)');

  // Initial document readiness and SPA navigation both use the same host bar.
  await reader.locator('.navigation-progress').evaluate(el => el.remove());
  await busy(false);
  await reader.getByRole('link', { name: 'Next page' }).click();
  await busy(true);
  assert.equal(await reader.locator('article').innerText(), 'Initial');
  assert.equal(await reader.locator('.navigation-progress').evaluate(el => getComputedStyle(el).display), 'none');
  await page.evaluate(() => window.setShellPending(true));
  releaseDestination();
  await reader.locator('article').filter({ hasText: /^Destination$/ }).waitFor();
  assert.equal(await bar.getAttribute('aria-busy'), 'true', 'Quartz completion must not finish other shell work');
  await page.evaluate(() => window.setShellPending(false));
  await busy(false);

  // A removed frame releases its loading token even without a completion message.
  await reader.locator('article').evaluate(() => {
    const el = document.createElement('div'); el.className = 'navigation-progress'; document.body.append(el);
  });
  await busy(true);
  await page.evaluate(() => window.removeGarden());
  await busy(false);
  await page.evaluate(() => window.postMessage({ type: 'second-brain:navigation-progress', pending: true }, location.origin));
  assert.equal(await bar.getAttribute('aria-busy'), 'false');

  // Standalone Quartz retains its own visible loader.
  await page.goto(`${quartzOrigin}/initial`);
  assert.notEqual(await page.locator('.navigation-progress').evaluate(el => getComputedStyle(el).display), 'none');
  assert.deepEqual(errors, []);
});
