import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PDFDocument } from '@cantoo/pdf-lib';

test('Garden citations open encoded reader URLs while unusable links stay plain text', { timeout: 60000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const lesson = 'Concepts/24. electronic-circuits-2-course-introduction-and-integrated-circuit-research-context/prerequisite-review-of-networks-and-mosfet-circuits';
  const content = `[Opening-session sequence](garden:ec-2/${lesson.replaceAll(' ', '%20')}.md) · [Course topic list](garden:ec-2/sources/lecture1-1-introduction.md) · [Unavailable](sandbox:/mnt/data/book.pdf)`;
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import ChatMarkdown from './src/app/components/chat-markdown';
      createRoot(document.getElementById('root')).render(<><input aria-label="Draft" defaultValue="Keep my chat"/><ChatMarkdown content={${JSON.stringify(content)}}/></>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('content-type', 'text/html');
    // The destination fixture records what the real Garden reader receives.
    if (url.pathname === '/garden/ec-2') {
      requests.push(url.searchParams.get('note'));
      res.end('<!doctype html><h1>Garden reader destination</h1>');
      return;
    }
    res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/gardens/ec-2`);
  for (const [label, note] of [['Opening-session sequence', lesson], ['Course topic list', 'sources/lecture1-1-introduction']]) {
    const [reader] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: label, exact: true }).click()]);
    await reader.waitForLoadState();
    assert.equal(new URL(reader.url()).pathname, '/garden/ec-2');
    assert.equal(new URL(reader.url()).searchParams.get('note'), note);
    assert.equal(requests.at(-1), note);
    await reader.close();
  }
  assert.equal(await page.getByRole('link', { name: 'Unavailable' }).count(), 0);
  assert.equal(await page.getByText('Unavailable', { exact: true }).count(), 1);
  assert.equal(await page.locator('a[href=""]').count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Keep my chat');
  assert.deepEqual(errors, []);
});

test('chat citations open the real PDF reader at page 607 and retain the chat', { timeout: 60000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import ChatMarkdown from './src/app/components/chat-markdown';
      import PdfViewer from './src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client';
      const pdf = location.pathname.startsWith('/gardens/math-2/pdf/');
      createRoot(document.getElementById('root')).render(pdf
        ? <PdfViewer clusterSlug="math-2" documentSlug="calculus" title="Calculus" sourceUrl="/fixture.pdf" readOnly />
        : <><input aria-label="Draft" defaultValue="Keep my chat"/><ChatMarkdown content={
          '[Math 2, §10.3, printed pp. 585–587](/math-2/assets/calculus-source.pdf#page=607)'
        }/></>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [{ name: 'surrounding-ui', setup(builder) {
      builder.onResolve({ filter: /^(next\/navigation|next\/link|@\/app\/components\/(pdf-assistant|pdf-tools-panel|fastread-reader|navbar-flower-wind))$/ }, args => ({path: args.path, namespace:'fixture'}));
      builder.onLoad({filter:/.*/, namespace:'fixture'}, args => ({loader:'jsx', resolveDir:root, contents: args.path === 'next/navigation'
        ? 'export const useRouter=()=>({back(){history.back()},push(url){location.href=url}}); export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search);'
        : args.path === 'next/link'
          ? 'import React from "react"; export default function Link(props){return <a {...props}/>;}'
          : 'export default function Component(){return null;}'}));
    }}],
  });
  const doc = await PDFDocument.create();
  for (let i=0;i<610;i++) doc.addPage([400,500]);
  const bytes = await doc.save();
  const pdfAssets = { 'pdf.mjs':'build/pdf.mjs', 'pdf.worker.mjs':'build/pdf.worker.mjs',
    'pdf_viewer.mjs':'web/pdf_viewer.mjs', 'pdf_viewer.css':'web/pdf_viewer.css' };
  const server = http.createServer((req,res) => {
    if (req.url === '/app.js') {res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if (req.url === '/fixture.pdf') {res.setHeader('content-type','application/pdf');res.end(bytes);return;}
    const asset = pdfAssets[req.url?.replace('/api/pdfjs/','')];
    if (asset) {res.setHeader('content-type',asset.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,'node_modules/pdfjs-dist',asset)));return;}
    res.setHeader('content-type','text/html');
    res.end('<!doctype html><style>#viewerContainer{position:absolute;top:180px;bottom:0;left:0;right:0;overflow:auto}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  const context=await browser.newContext();
  const errors=[];
  context.on('page', pg => pg.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.goto(origin+'/chat');
  await page.evaluate(()=>localStorage.setItem('sb:pdf-last-page:math-2:calculus','42'));
  const citation=page.getByRole('link',{name:/Math 2/});
  assert.equal(await citation.getAttribute('href'),'/gardens/math-2/pdf/calculus#page=607');
  const [reader]=await Promise.all([context.waitForEvent('page'),citation.click()]);
  await reader.waitForFunction(()=>document.querySelector('[aria-label="Page number"]')?.value==='607',null,{timeout:10000}).catch(async error=>{
    throw new Error(`${error.message}\n${JSON.stringify(errors)}\n${await reader.evaluate(()=>document.body.innerText)}`);
  });
  assert.ok(reader.url().endsWith('/gardens/math-2/pdf/calculus#page=607'));
  assert.equal(await page.getByRole('textbox',{name:'Draft'}).inputValue(),'Keep my chat');
  await reader.getByRole('textbox',{name:'Page number'}).fill('608');
  await reader.getByRole('textbox',{name:'Page number'}).press('Enter');
  await reader.waitForFunction(()=>localStorage.getItem('sb:pdf-last-page:math-2:calculus')==='608');
  await reader.close();
  assert.equal(await page.getByRole('textbox',{name:'Draft'}).inputValue(),'Keep my chat');
  assert.deepEqual(errors,[]);
});
