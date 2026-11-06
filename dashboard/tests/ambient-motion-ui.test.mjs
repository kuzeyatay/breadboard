import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
const root = process.env.BREADBOARD_DASHBOARD_ROOT ?? path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'package.json'));
const {build} = require('esbuild');
const {chromium, expect} = require('@playwright/test');

test('Terminal color motion stays smooth in a visible, unfocused window', {timeout: 60_000}, async t => {
  const bundle = await build({stdin: {resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Background from './src/app/components/spotify-ambient-background';
    import {UserIdleRuntime} from './src/app/components/effects/use-user-idle';
    createRoot(document.getElementById('root')).render(<><UserIdleRuntime/><Background theme="dark" spotifyColors={false} randomColors/></>);
  `}, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: 'motion.js'});
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  const open = async () => {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    await page.addInitScript(() => {
      const now = Date.now;
      const offset = 6_000 - now() % 20_000;
      Date.now = () => now() + offset;
    });
    await page.route('https://ambient-motion.test/**', route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/app.js') return route.fulfill({contentType: 'text/javascript', body: js});
      if (name === '/style.css') return route.fulfill({contentType: 'text/css', body: css});
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>'});
    });
    await page.goto('https://ambient-motion.test');
    await expect(page.locator('[data-spotify-background]')).toHaveAttribute('data-playing', 'true');
    return page;
  };
  try {
    await t.test('blur and inactivity do not freeze a visible background; hidden pages still pause', async () => {
      const page = await open();
      try {
        const bg = page.locator('[data-spotify-background]');
        const light = page.locator('[data-ambient-layer="random"] > span').first();
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await expect(page.locator('html')).toHaveAttribute('data-user-idle', '');
        await expect(bg).toHaveAttribute('data-playing', 'true');
        const before = await light.evaluate(node => node.getAnimations({subtree: true})[0].currentTime);
        await expect.poll(() => light.evaluate(node => node.getAnimations({subtree: true})[0].currentTime)).toBeGreaterThan(before + 100);
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(bg).toHaveAttribute('data-playing', 'false');
        await light.evaluate(async node => { await Promise.all(node.getAnimations({subtree: true}).map(animation => animation.ready)); });
        const paused = await light.evaluate(node => node.getAnimations({subtree: true})[0].currentTime);
        await page.waitForTimeout(150);
        assert.equal(await light.evaluate(node => node.getAnimations({subtree: true})[0].currentTime), paused);
        await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
        await expect(bg).toHaveAttribute('data-playing', 'true');
      } finally { await page.close(); }
    });
    await t.test('late palette updates hold the last color instead of flashing the previous cycle', async () => {
      const page = await open();
      try {
        const colors = await page.locator('[data-ambient-layer="random"] > span').first().evaluate(async node => {
          const animations = node.getAnimations({subtree: true});
          for (const animation of animations) animation.pause();
          const palette = animations.find(animation => /palette/i.test(animation.animationName));
          const read = () => {
            const before = getComputedStyle(node, '::before'), after = getComputedStyle(node, '::after');
            if (after.content === 'none') return getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number);
            const a = before.backgroundColor.match(/[\d.]+/g).map(Number);
            const b = after.backgroundColor.match(/[\d.]+/g).map(Number);
            return a.map((value, i) => value + (b[i] - value) * Number(after.opacity));
          };
          palette.currentTime = 19_950;
          await new Promise(requestAnimationFrame);
          const end = read();
          palette.currentTime = 20_050;
          await new Promise(requestAnimationFrame);
          return {end, delayed: read()};
        });
        assert.deepEqual(colors.delayed, colors.end, 'a delayed timer cannot expose the previous palette again');
      } finally { await page.close(); }
    });
    await t.test('steady color blending does not repaint the full background on each frame', async () => {
      const page = await open();
      try {
        await expect(page.locator('[data-ambient-layer="random"]')).toHaveCSS('opacity', '1');
        const cdp = await page.context().newCDPSession(page);
        await expect(page.locator('[data-spotify-background]')).toHaveAttribute('data-playing', 'true');
        const started = await page.locator('[data-ambient-layer="random"] > span').first().evaluate(node => node.getAnimations()[0].currentTime);
        const events = [];
        cdp.on('Tracing.dataCollected', message => events.push(...message.value));
        await cdp.send('Tracing.start', {categories: 'devtools.timeline', transferMode: 'ReportEvents'});
        await page.waitForTimeout(800);
        const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        await completed;
        const ended = await page.locator('[data-ambient-layer="random"] > span').first().evaluate(node => node.getAnimations()[0].currentTime);
        assert(ended > started + 500, 'painting is measured while the background actually moves');
        const paints = events.filter(event => event.name === 'Paint').length;
        t.diagnostic(`Background paint events over 800 ms: ${paints}`);
        assert(paints <= 4, `steady light motion should composite existing layers, observed ${paints} paints`);
        await cdp.detach();
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
