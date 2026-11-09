import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');

test('composer glow travels smoothly without stalling or restarting', { timeout: 60_000 }, async t => {
  const bundle = await build({
    bundle: true, write: false, outfile: 'beam.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import ComposerBorderBeam from '@/app/components/effects/composer-border-beam';
      function App() {
        const [active, setActive] = useState(true), [mounted, setMounted] = useState(true);
        window.setActive = setActive;
        window.setMounted = setMounted;
        return mounted && <div id="size" style={{width:1024,height:62}}>
          <ComposerBorderBeam active={active} className="fixture">
            <div className="composer"><button>/</button><button>+</button>
              <span>Prepare a workout checklist for Lower B tomorrow at 15:00, including warm-ups, sets, rep ranges, rest time…</span>
              <button>Ultra⌄</button><button>↑</button>
            </div>
          </ComposerBorderBeam>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
  });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1160, height: 300 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<style>
    body{margin:60px;background:#0f1310;color:#879187;font:14px Arial}
    .fixture{position:relative;height:100%}
    .composer{height:100%;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:8px;background:#202820;border-radius:30px;box-shadow:inset 0 1px 2px #ffffff22}
    .composer span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    button{border:0;border-radius:30px;background:#202820;color:#c1ccc1;height:44px;min-width:44px;box-shadow:3px 3px 8px #0005,-2px -2px 8px #ffffff05}
  </style><div id="root"></div>`);
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  const beam = page.locator('[data-beam="composer"]');
  const light = beam.locator('span').first();
  await expect.poll(() => light.evaluate(node => node.getAnimations().length)).toBe(1);
  await expect(beam).toHaveCSS('opacity', '0.7');

  await t.test('every frame advances evenly on desktop, mobile and expanded drafts, including the loop seam', async () => {
    for (const [width, height] of [[1024, 62], [320, 60], [700, 180]]) {
      await page.locator('#size').evaluate((node, size) => {
        node.style.width = size[0] + 'px'; node.style.height = size[1] + 'px';
      }, [width, height]);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const speeds = await light.evaluate(node => {
        const animation = node.getAnimations()[0];
        animation.pause();
        const duration = animation.effect.getTiming().duration;
        const step = 1000 / 60;
        const values = [];
        let previous;
        for (let time = 0; time < duration + 3 * step; time += step) {
          animation.currentTime = time;
          const matrix = new DOMMatrix(getComputedStyle(node).transform);
          if (previous) values.push(Math.hypot(matrix.m41 - previous.x, matrix.m42 - previous.y) / step * 1000);
          previous = { x: matrix.m41, y: matrix.m42 };
        }
        return { min: Math.min(...values), max: Math.max(...values) };
      });
      assert(speeds.min > 88 && speeds.max < 92, `${width}×${height}: expected steady 90px/s, got ${JSON.stringify(speeds)}`);
    }
  });

  await t.test('blur keeps the glow moving; draft, visibility and reduced motion pause without losing phase', async () => {
    await page.evaluate(() => window.setActive(false));
    await expect(beam).toHaveCSS('opacity', '0');
    await page.evaluate(() => window.setActive(true));
    await expect(beam).toHaveCSS('opacity', '0.7');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const started = await light.evaluate(node => node.getAnimations()[0].currentTime);
    await expect.poll(() => light.evaluate(node => node.getAnimations()[0].currentTime)).toBeGreaterThan(started + 100);
    for (const pause of ['draft', 'hidden', 'offscreen', 'reduced']) {
      if (pause === 'draft') await page.evaluate(() => window.setActive(false));
      if (pause === 'hidden') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      if (pause === 'offscreen') await page.locator('#size').evaluate(node => { node.style.transform = 'translateY(1000px)'; });
      if (pause === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect.poll(() => light.evaluate(node => node.getAnimations()[0].playState)).toBe('paused');
      await light.evaluate(node => node.getAnimations()[0].ready);
      const paused = await light.evaluate(node => node.getAnimations()[0].currentTime);
      await page.waitForTimeout(120);
      assert.equal(await light.evaluate(node => node.getAnimations()[0].currentTime), paused, pause);
      if (pause === 'draft') await page.evaluate(() => window.setActive(true));
      if (pause === 'hidden') await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      if (pause === 'offscreen') await page.locator('#size').evaluate(node => { node.style.transform = ''; });
      if (pause === 'reduced') await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect.poll(() => light.evaluate(node => node.getAnimations()[0].currentTime)).toBeGreaterThan(paused + 50);
    }
  });

  await t.test('loops survive a busy main thread and steady motion does not repaint', async () => {
    const loop = await light.evaluate(async node => {
      const animation = node.getAnimations()[0];
      const duration = animation.effect.getTiming().duration;
      animation.currentTime = duration - 100;
      await new Promise(requestAnimationFrame);
      const until = performance.now() + 350;
      while (performance.now() < until) { /* Simulate chat rendering across the loop seam. */ }
      await new Promise(requestAnimationFrame);
      return { same: animation === node.getAnimations()[0], elapsed: animation.currentTime - duration, state: animation.playState };
    });
    assert(loop.same && loop.elapsed > 100 && loop.state === 'running', JSON.stringify(loop));
    await expect(beam).toHaveCSS('opacity', '0.7');
    const cdp = await page.context().newCDPSession(page);
    const events = [];
    cdp.on('Tracing.dataCollected', message => events.push(...message.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
    await page.waitForTimeout(800);
    const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    await completed;
    const paints = events.filter(event => event.name === 'Paint').length;
    t.diagnostic(`Composer paint events over 800 ms: ${paints}`);
    assert(paints <= 4, `expected composited motion, saw ${paints} paints`);
    await cdp.detach();
  });

  await t.test('unmount cancels the animations', async () => {
    await light.evaluate(node => { window.lastBeamAnimation = node.getAnimations()[0]; });
    await page.evaluate(() => window.setMounted(false));
    await expect(beam).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.lastBeamAnimation.playState), 'idle');
  });
  assert.deepEqual(errors, []);
});
