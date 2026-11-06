import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('a citation loads its reader while eight other Garden views remain open', { timeout: 30_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const native = { acquired: 0, released: 0 };
  globalThis.__quartzCapacityTest = native;
  const leaseBundle = await build({
    entryPoints: [path.join(root, 'src/lib/quartz-view-lease.ts')],
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'native-service-boundary', setup(builder) {
      builder.onResolve({ filter: /^(server-only|@\/lib\/(supervisor-control|quartz-publish))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
        args.path === 'server-only' ? '' : args.path.endsWith('quartz-publish')
          ? 'export async function ensureQuartzPublicationForView() {}'
          : `export async function acquireServiceLease() { globalThis.__quartzCapacityTest.acquired++; return {id:'shared-reader',targetId:'quartz'}; }
             export async function releaseSupervisorLease() { globalThis.__quartzCapacityTest.released++; }`,
      }));
    } }],
  });
  const lease = await import(`data:text/javascript;base64,${Buffer.from(leaseBundle.outputFiles[0].text).toString('base64')}`);
  const clientBundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import ChatMarkdown from './src/app/components/chat-markdown';
      import GardenQuartzFrame from './src/app/garden/garden-quartz-frame';
      const reader = location.pathname.startsWith('/garden/');
      createRoot(document.getElementById('root')).render(reader
        ? <GardenQuartzFrame title="Cited document" src="/document"/>
        : <><input aria-label="Draft" defaultValue="Keep my chat"/>
          <ChatMarkdown content="[Course topic list](garden:ec-2/sources/lecture1-1-introduction.md)"/>
          {Array.from({length:8},(_,i)=><GardenQuartzFrame key={i} title={'Existing reader '+i} src={'/document?existing='+i}/>)}</>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const views = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/quartz/view-lease') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const { viewId } = JSON.parse(Buffer.concat(chunks).toString());
      try {
        if (req.method === 'POST') {
          await lease.renewQuartzViewLease(1, viewId); views.add(viewId);
        } else {
          await lease.releaseQuartzViewLease(1, viewId); views.delete(viewId);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(error.status ?? 500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    if (url.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(clientBundle.outputFiles[0].text); return; }
    res.setHeader('content-type', 'text/html');
    res.end(url.pathname === '/document'
      ? '<!doctype html><article><h1>Lecture 1.1: Introduction</h1><p>Network analysis and MOSFET circuit review.</p></article>'
      : '<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([...views].map(id => lease.releaseQuartzViewLease(1, id)));
    await new Promise(resolve => server.close(resolve));
    delete globalThis.__quartzCapacityTest;
  });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(10_000);
    const errors = [];
    context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/chat`);
    for (let i = 0; i < 8; i++) {
      await page.frameLocator('iframe[title="Existing reader '+i+'"]').getByRole('heading', { name: 'Lecture 1.1: Introduction' }).waitFor();
    }
    assert.equal(views.size, 8);
    const [reader] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Course topic list' }).click()]);
    await reader.frameLocator('iframe').getByRole('heading', { name: 'Lecture 1.1: Introduction' }).waitFor();
    assert.equal(views.size, 9);
    assert.equal(native.acquired, 1);
    assert.equal(native.released, 0);
    assert.equal(await reader.getByRole('alert').count(), 0);
    assert.equal(new URL(reader.url()).searchParams.get('note'), 'sources/lecture1-1-introduction');
    await reader.close();
    assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Keep my chat');
    assert.equal(await page.locator('iframe').count(), 8);
    assert.equal(native.released, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
