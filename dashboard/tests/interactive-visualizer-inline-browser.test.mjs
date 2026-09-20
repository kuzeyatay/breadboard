import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { withInteractiveVisualizerInlineLayout } from '../src/lib/hermes/interactive-visualizer-inline.ts';

const root = path.resolve(import.meta.dirname, '..');
const storedPreview = `<!doctype html><html><head><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}
body{padding:12px;font:16px system-ui;background:#faf8f1}
#app{height:100vh;overflow:hidden}h1{font-size:20px;margin:0 0 12px}
canvas{display:block;width:100%;height:340px;background:#14202a}
.controls{height:90px;max-height:90px;overflow-y:auto}
.row{display:flex;flex-wrap:wrap;gap:12px;padding:16px 0;border-bottom:1px solid #ddd}
.row label{flex:1 1 240px}.row input{flex:1 1 240px;min-width:0}
#details{height:960px}button{margin:12px 0;padding:12px}
</style></head><body><main id="app"><h1>Compass and charge</h1><canvas width="600" height="340"></canvas>
<section class="controls"><div class="row"><label for="strength">Field strength</label><input id="strength" type="range" min="0" max="10" value="3"></div>
<div class="row"><label for="speed">Charge speed</label><input id="speed" type="range" min="0" max="10" value="4"></div></section>
<button id="toggle">Show details</button><div id="details" hidden>Expanded details</div><output id="value">3</output></main><script>
const protocol='breadboard:interactive-visualizer:v1',channel=new URLSearchParams(location.search).get('channel');
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),field=document.querySelector('#strength');
function draw(){ctx.clearRect(0,0,600,340);ctx.fillStyle='#e7bd4f';ctx.fillRect(40,140,Number(field.value)*30,30);document.querySelector('#value').value=field.value}
field.addEventListener('input',draw);draw();
document.querySelector('#toggle').onclick=()=>{document.querySelector('#details').hidden=!document.querySelector('#details').hidden};
// Deliberately no ready message: previews may finish before React subscribes.
addEventListener('message',event=>{if(event.source!==parent||event.data.channel!==channel)return;if(event.data.type==='host-theme')document.documentElement.dataset.theme=event.data.theme});
new ResizeObserver(()=>parent.postMessage({protocol,channel,type:'resize',height:document.documentElement.scrollHeight},'*')).observe(document.body);
</script></body></html>`;

test('inline chat fits saved visualizers, exposes working controls and resizes without inner scrolling', { timeout: 60_000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import Visualizer from './src/app/components/hermes/inline-interactive-visualizer';
      const artifact={id:'compass',version:1,title:'Compass and charge',status:'ready',previewAvailable:true};
      createRoot(document.getElementById('root')).render(<><Visualizer artifact={artifact}/><p id="artifact-card">Interactive model · HTML</p></>);
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    plugins: [{ name: 'artifact-url', setup(builder) {
      builder.onResolve({ filter: /^\.\/artifact-viewer$/ }, () => ({ path: 'artifact-url', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const artifactUrl=()=>'/preview?version=1';` }));
    } }],
  });
  const preview = withInteractiveVisualizerInlineLayout(storedPreview);
  assert.equal(withInteractiveVisualizerInlineLayout(preview), preview);
  const executablePath = [process.env.GENERATED_VISUAL_BROWSER_EXECUTABLE, chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
  assert.ok(executablePath, 'A Chromium browser is required for the inline layout regression');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 800 }, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:53149/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/preview') {
        assert.equal(url.searchParams.get('presentation'), 'inline');
        assert.ok(url.searchParams.get('channel'));
        return route.fulfill({ contentType: 'text/html', body: preview });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="light"><style>body{margin:0;padding:12px}iframe{display:block;width:100%;border:0}#root{max-width:900px;margin:auto}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>` });
    });
    await page.goto('http://localhost:53149/');
    const iframe = page.locator('iframe');
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    const fits = async () => {
      await frame.waitForFunction(() => {
        const html = document.documentElement;
        const controls = [...document.querySelectorAll('input,button,output')];
        return html.scrollHeight <= innerHeight + 1 && html.scrollWidth <= innerWidth + 1 &&
          controls.every(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }) &&
          [...document.querySelectorAll('body,#app,.controls')].every(node => node.scrollHeight <= node.clientHeight + 1);
      });
      assert.equal(await frame.evaluate(() => scrollY), 0);
    };
    await fits();
    const original = await frame.locator('canvas').evaluate(node => node.toDataURL());
    const field = frame.getByLabel('Field strength');
    await field.focus();await field.press('ArrowRight');
    assert.equal(await field.inputValue(), '4');
    assert.notEqual(await frame.locator('canvas').evaluate(node => node.toDataURL()), original);
    // A pointer can reach the second control below the previously clipped panel.
    await frame.getByLabel('Charge speed').click();
    assert.notEqual(await frame.getByLabel('Charge speed').inputValue(), '4');
    const compactHeight = await iframe.evaluate(node => node.clientHeight);
    await frame.getByRole('button', { name: 'Show details' }).click();
    await page.waitForFunction(() => document.querySelector('iframe').clientHeight > 1200);
    await fits();
    await frame.getByRole('button', { name: 'Show details' }).click();
    await page.waitForFunction(height => document.querySelector('iframe').clientHeight === height, compactHeight);
    // Forged resize traffic from the parent does not resize the opaque sandbox.
    await page.evaluate(() => {
      const channel = new URL(document.querySelector('iframe').src).searchParams.get('channel');
      postMessage({ protocol: 'breadboard:interactive-visualizer:v1', channel, type: 'inline-resize', height: 9999 }, '*');
    });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForFunction(height => document.querySelector('iframe').clientHeight > height, compactHeight);
    await fits();
    const narrowHeight = await iframe.evaluate(node => node.clientHeight);
    await page.setViewportSize({ width: 980, height: 800 });
    await page.waitForFunction(height => document.querySelector('iframe').clientHeight < height, narrowHeight);
    await fits();
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await frame.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    // Newly inserted, constrained panels also expand without a frame reload.
    await frame.evaluate(() => {
      const panel=document.createElement('section');panel.className='controls';
      panel.innerHTML='<div style="height:180px">New controls</div><label>Dipole angle<input type="range" value="50"></label>';
      document.querySelector('#app').append(panel);
    });
    await fits();
    await frame.getByLabel('Dipole angle').focus();
    await frame.getByLabel('Dipole angle').press('ArrowRight');
    assert.equal(await frame.getByLabel('Dipole angle').inputValue(), '51');
    if (process.env.INLINE_VISUALIZER_SCREENSHOT) {
      await page.screenshot({ path: process.env.INLINE_VISUALIZER_SCREENSHOT, fullPage: true });
    }
    // Wheel scrolling belongs to the chat document, never the embedded page.
    await page.setViewportSize({ width: 980, height: 430 });
    await frame.locator('h1').hover();await page.mouse.wheel(0, 250);
    await page.waitForFunction(() => scrollY > 0);
    assert.equal(await frame.evaluate(() => scrollY), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
