import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

test('Terminal lighting shares random and album palettes, blend phase, and playback changes across tabs', {timeout: 60_000}, async () => {
  const bundle = await build({
    stdin: {resolveDir: path.resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Background from './src/app/components/spotify-ambient-background';
      import {SpotifyAmbientProvider, useSpotifyAmbientSource, usePublishSpotifyAmbient} from './src/app/components/spotify-ambient-context';
      function App() {
        const [sample, setSample] = React.useState(undefined);
        const [active, setActive] = React.useState(true);
        window.publishSource = setSample; window.setActive = setActive;
        usePublishSpotifyAmbient(sample ?? null, sample !== undefined && active, sample?.revision);
        const source = useSpotifyAmbientSource();
        return <><output>{source?.name ?? 'idle'}</output>
          <div id="main"><Background theme="dark" randomColors/></div>
          <div id="preview"><Background theme="dark" randomColors/></div></>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode>
        <SpotifyAmbientProvider ownerKey={new URLSearchParams(location.search).get('owner') ?? 'same-user'}><App/></SpotifyAmbientProvider>
      </React.StrictMode>);
    `}, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: 'sync.js',
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  try {
    const context = await browser.newContext();
    const requests = [];
    const errors = [];
    // Start mid-blend. Every page uses the same wall clock, but each is mounted
    // at a different time; new pages must join the ongoing animation phase.
    const offset = 6_000 - Date.now() % 20_000;
    await context.addInitScript(offset => {
      const originalNow = Date.now;
      Date.now = () => originalNow() + offset + (window.lightingClockOffset ?? 0);
    }, offset);
    await context.route('https://ambient-sync.test/**', route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (url.pathname === '/app.js') return route.fulfill({contentType: 'text/javascript', body: js});
      if (url.pathname === '/style.css') return route.fulfill({contentType: 'text/css', body: css});
      if (url.pathname.startsWith('/cover/')) {
        const colors = url.pathname.endsWith('one') ? ['#e53e4e', '#17b6cf', '#7850d4'] : ['#eab42a', '#2fbd73', '#ce793a'];
        return route.fulfill({contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32">${colors.map((color, index) => `<rect x="${index * 32}" width="32" height="32" fill="${color}"/>`).join('')}</svg>`});
      }
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>'});
    });
    let clockOffset = 0;
    const open = async (suffix = '') => {
      const page = await context.newPage();
      await page.addInitScript(offset => { window.lightingClockOffset = offset; }, clockOffset);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`https://ambient-sync.test/${suffix}`);
      await expect(page.locator('#main [data-spotify-background]')).toHaveAttribute('data-active', 'true');
      return page;
    };
    const bg = page => page.locator('#main [data-spotify-background]');
    const snapshot = page => page.evaluate(() => {
      const read = root => [...document.querySelectorAll(root + ' [data-ambient-layer][data-active="true"] > span')].map(node => ({
        target: node.style.backgroundColor,
        previous: node.style.getPropertyValue('--ambient-previous-color'),
        color: (() => {
          const a = getComputedStyle(node, '::before').backgroundColor.match(/[\d.]+/g).map(Number);
          const b = getComputedStyle(node, '::after').backgroundColor.match(/[\d.]+/g).map(Number);
          const blend = Number(getComputedStyle(node, '::after').opacity);
          return 'rgb(' + a.map((value, i) => value + (b[i] - value) * blend).join(' ') + ')';
        })(),
        animations: node.getAnimations({subtree: true}).map(animation => ({time: animation.currentTime, duration: animation.effect.getTiming().duration})),
      }));
      return {now: Date.now(), main: read('#main'), preview: read('#preview')};
    });
    const assertSynced = async (pages, mode) => {
      for (const page of pages) await expect(bg(page)).toHaveAttribute('data-color-source', mode);
      const samples = await Promise.all(pages.map(snapshot));
      const targets = samples[0].main.map(light => light.target);
      const previous = samples[0].main.map(light => light.previous);
      for (const sample of samples) {
        assert.deepEqual(sample.main.map(light => light.target), targets, 'tabs use the same target colors');
        assert.deepEqual(sample.main.map(light => light.previous), previous, 'tabs start each blend from the same colors');
        assert.deepEqual(sample.preview.map(light => light.target), targets, 'the picker preview uses the same palette');
        for (const light of [...sample.main, ...sample.preview]) {
          for (const animation of light.animations.slice(0, 2)) {
            const period = animation.duration * 2;
            const gap = Math.abs((Number(animation.time) % period) - (sample.now % period));
            assert(Math.min(gap, period - gap) < 150, `drift and pulse match the shared wall-clock phase: ${JSON.stringify({mode, gap, sample})}`);
          }
          if (mode === 'random') {
            const gap = Math.abs(Number(light.animations[2].time) % 20_000 - sample.now % 20_000);
            assert(Math.min(gap, 20_000 - gap) < 150, 'a newly opened tab joins the in-progress random blend');
          }
        }
      }
      for (const sample of samples.slice(1)) {
        for (let i = 0; i < 3; i++) {
          const a = samples[0].main[i].color.match(/[\d.]+/g).map(Number);
          const b = sample.main[i].color.match(/[\d.]+/g).map(Number);
          // Separate renderer processes may answer hundreds of milliseconds
          // apart under load. Allow only the color travel possible in that gap.
          const tolerance = 4 + Math.abs(samples[0].now - sample.now) * 0.2;
          assert(a.every((channel, n) => Math.abs(channel - b[n]) < tolerance), `rendered ${mode} colors follow the same blend: ${JSON.stringify({a: samples[0], b: sample})}`);
        }
      }
    };
    const expectCrossfade = async (page, from, to) => {
      const outgoing = bg(page).locator(`[data-ambient-layer="${from}"]`);
      const incoming = bg(page).locator(`[data-ambient-layer="${to}"]`);
      await expect.poll(() => incoming.evaluate(node => {
        const opacity = Number(getComputedStyle(node).opacity);
        return opacity > 0.01 && opacity < 0.99;
      })).toBe(true);
      assert(Number(await outgoing.evaluate(node => getComputedStyle(node).opacity)) > 0,
        'the previous color field remains visible during the blend');
      await expect(outgoing.locator('span')).toHaveCount(3);
      await expect.poll(() => incoming.evaluate(node => getComputedStyle(node).opacity)).toBe('1');
      await expect.poll(() => outgoing.evaluate(node => getComputedStyle(node).opacity)).toBe('0');
    };
    const first = await open();
    const second = await open();
    await assertSynced([first, second], 'random');
    const original = await snapshot(first);
    clockOffset = 20_000;
    await Promise.all([first, second].map(page => page.evaluate(() => {
      window.lightingClockOffset = 20_000;
      window.dispatchEvent(new Event('focus'));
    })));
    await expect.poll(async () => (await snapshot(first)).main[0].target).not.toBe(original.main[0].target);
    await assertSynced([first, second], 'random');
    const track = name => ({name, artist: 'Test Artist', imageUrl: `https://ambient-sync.test/cover/${name}`, playing: true, revision: Date.now()});
    await expect.poll(() => bg(first).locator('[data-ambient-layer="random"]').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    await first.evaluate(track => window.publishSource(track), track('one'));
    await expectCrossfade(first, 'random', 'spotify');
    await assertSynced([first, second], 'spotify');
    await second.evaluate(track => window.publishSource(track), track('one'));
    await second.evaluate(() => window.setActive(false));
    await first.evaluate(track => window.publishSource(track), track('two'));
    await expect.poll(async () => (await snapshot(first)).main.some(light => light.target === 'rgb(234, 180, 42)')).toBe(true);
    await assertSynced([first, second], 'spotify');
    await second.evaluate(() => window.setActive(true));
    await expect(second.locator('output')).toHaveText('two');
    const joined = await open();
    await expect(joined.locator('output')).toHaveText('two');
    await assertSynced([first, second, joined], 'spotify');
    assert.equal(requests.filter(url => url.startsWith('/cover/')).length, 2, 'late tabs and previews reuse the published album palette');
    const otherAccount = await open('?owner=someone-else');
    await expect(otherAccount.locator('output')).toHaveText('idle');
    await expect(bg(otherAccount)).toHaveAttribute('data-color-source', 'random');
    await first.evaluate(track => window.publishSource({...track, playing: false}), track('two'));
    await assertSynced([first, second, joined], 'spotify');
    const joinedPaused = await open();
    await expect(joinedPaused.locator('output')).toHaveText('two');
    await assertSynced([first, second, joined, joinedPaused], 'spotify');
    assert.equal(requests.filter(url => url.startsWith('/cover/')).length, 2, 'a new tab reuses the paused track palette');
    await first.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(bg(first)).toHaveAttribute('data-playing', 'false');
    await second.evaluate(track => window.publishSource(track), track('one'));
    await expect(first.locator('output')).toHaveText('one');
    await first.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await assertSynced([first, second, joined], 'spotify');
    await expect.poll(() => bg(first).locator('[data-ambient-layer="spotify"]').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    await second.evaluate(() => window.publishSource(null));
    await expectCrossfade(first, 'spotify', 'random');
    await assertSynced([first, second, joined], 'random');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
