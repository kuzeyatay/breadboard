import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const stylesheet = fileURLToPath(new URL('../src/app/globals.css', import.meta.url));
const styles = (await postcss([tailwind()]).process(await fs.readFile(stylesheet, 'utf8'), {from:stylesheet})).css;

test('editing a draft keeps the metal filter mounted and unmounting releases it', { timeout: 60000 }, async t => {
  const bundle = await build({
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import MetalSendButton from './src/app/components/effects/metal-send-button';
      function App() {
        const [draft,setDraft] = useState(''), [mounted,setMounted] = useState(true);
        window.setMounted = value => flushSync(()=>setMounted(value));
        return <><textarea value={draft} onChange={e=>setDraft(e.target.value)}/>
          {mounted && <MetalSendButton disabled={!draft.trim()}><button disabled={!draft.trim()}>Send</button></MetalSendButton>}</>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
  });
  const browser = await chromium.launch({headless:true, ...(process.platform === 'win32' ? {channel:'msedge'} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Use the app's complete stylesheet: unrelated root :has() rules used to
  // turn both filter churn and React's textarea.defaultValue writes into a
  // full-transcript style recalculation on every key.
  await page.setContent(`<style>${styles}button{width:44px;height:44px}</style><main id="transcript"></main><div id="root"></div>`);
  await page.evaluate(() => {
    document.querySelector('#transcript').innerHTML = '<p><span>Existing message</span></p>'.repeat(10000);
    window.filterMutations = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (node instanceof Element && node.querySelector('filter[id^="mfx-bend-"]')) window.filterMutations++;
      }
    }).observe(document.body, {childList:true});
  });
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const filter = page.locator('filter[id^="mfx-bend-"]');
  await filter.waitFor({state:'attached'});
  const originalId = await filter.getAttribute('id');
  await page.evaluate(() => { window.filterMutations = 0; });
  const cdp = await page.context().newCDPSession(page);
  const trace = [];
  cdp.on('Tracing.dataCollected', ({value}) => trace.push(...value));
  await cdp.send('Tracing.start', {categories:'devtools.timeline'});
  await page.locator('textarea').pressSequentially('Typing must not recreate the send effect.', {delay:1});
  const tracingComplete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await tracingComplete;
  const restyles = trace.filter(event => event.name === 'UpdateLayoutTree');
  assert.ok(restyles.length > 0, 'the browser recorded style updates while typing');
  assert.ok(Math.max(...restyles.map(event => event.args?.elementCount ?? 0)) < 1000,
    'editing the composer never restyles the 20,000-element transcript');
  assert.equal(await filter.getAttribute('id'), originalId, 'filter identity survives each React draft update');
  assert.equal(await page.evaluate(() => filterMutations), 0, 'typing never removes or inserts a body-level filter');
  assert.equal(await page.locator('button').isEnabled(), true);
  await page.locator('textarea').fill('');
  assert.equal(await page.locator('button').isDisabled(), true);
  assert.equal(await filter.getAttribute('id'), originalId, 'enabled/disabled changes preserve the effect');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await filter.getAttribute('id'), originalId, 'motion preference changes preserve the effect');
  await page.evaluate(() => setMounted(false));
  assert.equal(await filter.count(), 0, 'unmount removes the filter');
  await page.evaluate(() => setMounted(true));
  await filter.waitFor({state:'attached'});
  assert.notEqual(await filter.getAttribute('id'), originalId, 'remount creates a fresh filter');
  assert.deepEqual(errors, []);
});

test('bounded selectors preserve page surfaces, attached quotes and sidebar action space', {timeout:30000}, async t => {
  const browser = await chromium.launch({headless:true, ...(process.platform === 'win32' ? {channel:'msedge'} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<style>${styles}</style><div class="desktop-title-bar"></div><div class="bb-page-toast-host"></div><main class="bb-notification-overlay-page"></main>`);
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.desktop-title-bar').evaluate(el=>getComputedStyle(el).display), 'none');
  assert.equal(await page.locator('.bb-page-toast-host').evaluate(el=>getComputedStyle(el).display), 'none');
  await page.setContent(`<style>${styles}</style><main data-dashboard-page></main>`);
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).scrollbarWidth), 'none');
  await page.setContent(`<style>${styles}</style><div class="browser-shell"><main class="browser-start-page" data-native-page="true"></main></div>`);
  for (const selector of ['html','body','.browser-shell']) {
    assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
  await page.setContent(`<style>${styles}</style><div class="neu-composer"><div class="bb-composer-header"><div class="bb-composer-queue">Queued message</div><div class="bb-composer-selection-attached" data-composer-selection-attached>Quote</div></div></div><ul><li data-sidebar="menu-item"><button class="bb-sidebar-menu-button" data-sidebar="menu-button">Chat</button><button data-sidebar="menu-action">Actions</button></li></ul>`);
  assert.equal(await page.locator('.bb-composer-queue').evaluate(el=>getComputedStyle(el).marginInlineStart), '12px');
  assert.equal(await page.locator('.bb-composer-selection-attached').evaluate(el=>getComputedStyle(el).marginInlineStart), '0px');
  assert.equal(await page.locator('.bb-sidebar-menu-button').evaluate(el=>getComputedStyle(el).paddingRight), '32px');
  await page.locator('[data-sidebar="menu-action"]').evaluate(el=>el.remove());
  assert.equal(await page.locator('.bb-sidebar-menu-button').evaluate(el=>getComputedStyle(el).paddingRight), '0px');
});
