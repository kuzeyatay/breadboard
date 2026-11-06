import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { pdfAssistantDocumentKey } from '../src/lib/pdf-assistant.ts';

test('PDF assistant dragging previews without reflowing the document or conversation', { timeout: 90_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pdf = await PDFDocument.create();
  for (let n = 1; n <= 227; n++) pdf.addPage([600, 800]).drawText(`Circuit notes, page ${n}`, { x: 40, y: 740 });
  const bytes = await pdf.save();
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Viewer from './src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client';
      window.assistantRenders=0; window.markdownParses=0; window.pdfScaleChanges=0;
      const app=createRoot(document.getElementById('root')); window.dispose=()=>app.unmount();
      app.render(<Viewer title="Circuit notes" sourceUrl="/fixture.pdf" readOnly showNavbarFlowers={false}/>);
    ` },
    bundle: true, write: false, outfile: 'bundle.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' },
    plugins: [{ name: 'resize-fixture', setup(builder) {
      const stubs = {
        'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
        'next/dynamic': 'export default function dynamic(){return ()=>null}',
        'next/navigation': 'export const useRouter=()=>({push(){},replace(){},back(){},refresh(){}}); export const usePathname=()=>"/pdf"; export const useSearchParams=()=>new URLSearchParams();',
        '@/app/components/navigation-progress': 'export const startNavigationProgress=()=>{};',
        '@/app/components/startup-readiness': 'export const useStartupLoading=()=>{};',
        '@/app/components/navbar-flower-wind': 'export default function Flowers(){return null}',
        '@/app/components/breadboard-loader': 'export default function Loader(){return null}',
        '@/app/components/fastread-reader': 'export default function Reader(){return null}',
        '@/app/components/pdf-tools-panel': 'export default function Tools(){return null}',
      };
      builder.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
      for (const [filter, counter] of [
        [/[\\/]pdf-assistant\.tsx$/, 'assistantRenders'],
        [/[\\/]chat-markdown\.tsx$/, 'markdownParses'],
      ]) builder.onLoad({ filter }, a => ({
        contents: readFileSync(a.path, 'utf8').replace('}: Props) {', `}: Props) { window.${counter}++;`), loader: 'tsx',
      }));
    } }],
  });
  const css = (await postcss([tailwind({ base: root })]).process(
    '@import "tailwindcss" source(none); @source "../src/app/components"; @source "../src/app/gardens";',
    { from: path.join(root, 'tests/pdf-resize-fixture.css') },
  )).css;
  const messages = Array.from({ length: 12 }, (_, n) => [
    { id: `u-${n}`, clientMessageId: `turn-${n}`, role: 'user', content: `Explain circuit ${n}.` },
    { id: `a-${n}`, clientMessageId: `turn-${n}`, role: 'assistant', content:
      `Circuit ${n}:\n\n$$T(s)=\\frac{sRC}{1+3sRC+(sRC)^2}$$\n\n` +
      '| Component | Value |\n|---|---|\n| R | 100 kΩ |\n| C | 10 nF |\n'.repeat(8) },
  ]).flat();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') {
      response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return;
    }
    if (url.pathname === '/fixture.pdf') {
      response.setHeader('content-type', 'application/pdf'); response.end(bytes); return;
    }
    if (url.pathname.startsWith('/api/pdfjs/')) {
      const name = path.basename(url.pathname);
      const asset = path.join(root, 'node_modules/pdfjs-dist', name === 'pdf.mjs' || name === 'pdf.worker.mjs' ? 'build' : 'web', name);
      if (!existsSync(asset)) { response.writeHead(404); response.end(); return; }
      response.setHeader('content-type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
      let source = readFileSync(asset, 'utf8');
      if (name === 'pdf_viewer.mjs') source += `
        const originalDispatch=EventBus.prototype.dispatch;
        EventBus.prototype.dispatch=function(name,...args){
          if(name==='scalechanging') window.pdfScaleChanges++;
          return originalDispatch.call(this,name,...args);
        };`;
      response.end(source); return;
    }
    if (url.pathname.startsWith('/api/')) {
      let body = null;
      if (url.pathname === '/api/hermes/commands') body = { groups: { skills: [], mcp: [], prompts: [], agents: [] }, runtime: { enabled: true } };
      if (url.pathname === '/api/hermes/sessions') body = { sessions: [{ id: 'conv_resize', pageSlug: pdfAssistantDocumentKey('/fixture.pdf'), title: 'Circuits' }] };
      if (url.pathname === '/api/hermes/sessions/conv_resize') body = { session: { id: 'conv_resize', messages, runState: 'idle' } };
      if (url.pathname.includes('text-highlights')) body = { entries: [] };
      if (url.pathname.includes('models')) body = { models: [] };
      if (url.pathname === '/api/starred-messages') body = { messages: [] };
      response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(body ?? {})); return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><meta charset="utf-8"><style>${css}
      html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}
      :root{--selection-highlight-blue:#78b9fc;--paper-bg:#fff;--ink:#222;--line:#aaa}
    </style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => { if (errors.length) t.diagnostic(JSON.stringify(errors)); });
  await page.addInitScript(() => { window.process = { env: {} }; });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const field = page.getByRole('textbox', { name: 'Page number', exact: true });
  await expect(field).toBeEnabled();
  await page.getByRole('button', { name: 'Open PDF assistant', exact: true }).click();
  await expect(page.locator('.katex').first()).toBeVisible();
  await field.fill('14'); await field.press('Enter');
  await expect(page.locator('.page[data-page-number="14"] canvas')).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Resize PDF assistant' });
  const panel = page.getByRole('complementary', { name: 'PDF assistant' });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = () => page.evaluate(() => ({
    renders: window.assistantRenders, parses: window.markdownParses, scales: window.pdfScaleChanges,
    width: document.querySelector('#pdf-assistant-panel').getBoundingClientRect().width,
    pdfWidth: document.querySelector('#viewerContainer').clientWidth,
  }));
  await settle();
  const before = await metrics();
  assert.ok(before.parses > 0 && before.scales > 0, 'exercise real math answers and PDF.js scaling');
  const startDrag = async () => {
    const box = await divider.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y); await page.mouse.down(); return point;
  };
  let point = await startDrag();
  await page.mouse.move(point.x - 220, point.y, { steps: 60 });
  await settle();
  const during = await metrics();
  t.diagnostic(`60 drag movements: ${during.renders - before.renders} assistant renders, ${during.scales - before.scales} PDF rescalings, ${during.parses - before.parses} markdown parses`);
  assert.deepEqual(during, before, 'dragging must leave both expensive pane layouts untouched');
  const preview = await divider.boundingBox();
  assert.ok(Math.abs(preview.x + preview.width / 2 - (point.x - 220)) < 2, 'blue guide tracks the pointer');
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '640');
  await expect.poll(async () => (await metrics()).scales).toBe(before.scales + 1);
  await expect(field).toHaveValue('14');
  assert.equal((await panel.boundingBox()).width, 640);

  // Escape, pointer cancellation, capture loss, and focus loss all discard a preview.
  for (const cancel of ['escape', 'pointercancel', 'capture', 'blur']) {
    point = await startDrag();
    await page.mouse.move(point.x + 80, point.y, { steps: 8 });
    if (cancel === 'escape') await page.keyboard.press('Escape');
    else await divider.evaluate((element, kind) => {
      if (kind === 'blur') window.dispatchEvent(new Event('blur'));
      else if (kind === 'capture') element.releasePointerCapture(1);
      else element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    }, cancel);
    await page.mouse.up(); await settle();
    await expect(divider).toHaveAttribute('aria-valuenow', '640');
    assert.equal(await divider.evaluate(element => element.style.transform), '', `${cancel} removes preview`);
  }
  await divider.focus(); await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '620');
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '640');
  point = await startDrag(); await page.mouse.move(point.x - 600, point.y, { steps: 10 }); await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '720');
  point = await startDrag(); await page.mouse.move(point.x + 800, point.y, { steps: 10 }); await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '340');

  // A numeric zoom stays fixed, and a final release need not have a preceding move.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await settle();
  const fixedZoom = (await metrics()).scales;
  point = await startDrag();
  await divider.evaluate((element, x) => element.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 1, clientX: x, bubbles: true,
  })), point.x - 60);
  await page.mouse.up(); await settle();
  await expect(divider).toHaveAttribute('aria-valuenow', '400');
  assert.equal((await metrics()).scales, fixedZoom, 'resizing preserves a numeric PDF zoom');

  point = await startDrag(); await page.mouse.move(point.x - 80, point.y);
  await page.setViewportSize({ width: 1024, height: 900 }); await page.mouse.up(); await settle();
  await expect(divider).toHaveAttribute('aria-valuenow', '400');
  assert.equal(await divider.evaluate(element => element.style.transform), '', 'window resizing cancels a drag');
  point = await startDrag(); await page.mouse.move(point.x - 800, point.y); await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '665.6');
  await divider.focus(); await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '665.6');

  // Closing during a drag must discard the guide and preserve the settled width.
  point = await startDrag(); await page.mouse.move(point.x + 80, point.y);
  await page.getByRole('button', { name: 'Close PDF assistant' }).evaluate(element => element.click());
  await page.mouse.up();
  await page.getByRole('button', { name: 'Open PDF assistant' }).click();
  await expect(divider).toHaveAttribute('aria-valuenow', '665.6');
  assert.equal(await divider.evaluate(element => element.style.transform), '');
  point = await startDrag(); await page.mouse.move(point.x + 80, point.y);
  await page.evaluate(() => window.dispose()); await page.mouse.up(); await settle();
  assert.deepEqual(errors, []);
});
