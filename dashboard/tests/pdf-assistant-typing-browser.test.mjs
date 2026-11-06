import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('typing in the PDF assistant does not parse settled answers again', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import PdfAssistant from './src/app/components/pdf-assistant';
      window.markdownParses=0;
      function App(){
        const container=useRef(null),pdf=useRef(null);
        return <><div ref={container}/><PdfAssistant documentKey="pdf:typing" title="Circuit questions"
          fileName="circuits.pdf" pageNumber={133} pageCount={227} loading={false} selectionEnabled={false}
          containerRef={container} pdfDocumentRef={pdf} getBytes={async()=>new Uint8Array()}/></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: 'bundle.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty' },
    plugins: [{ name: 'typing-fixture', setup(builder) {
      const stubs = {
        'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
        'next/dynamic': 'export default function dynamic(){return ()=>null}',
        'next/navigation': 'export const useRouter=()=>({push(){},replace(){}}); export const usePathname=()=>"/pdf"; export const useSearchParams=()=>new URLSearchParams();',
      };
      builder.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
      // Observe the real markdown renderer without replacing its memo boundary,
      // annotation handling, or the expensive remark/rehype/KaTeX pipeline.
      builder.onLoad({ filter: /[\\/]chat-markdown\.tsx$/ }, a => ({
        contents: readFileSync(a.path, 'utf8').replace('}: Props) {', '}: Props) { window.markdownParses++;'),
        loader: 'tsx',
      }));
    } }],
  });
  const executablePath = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
  ].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  t.after(() => { if (errors.length) t.diagnostic(JSON.stringify(errors)); });
  const messages = Array.from({ length: 12 }, (_, index) => [
    { id: `u-${index}`, clientMessageId: `turn-${index}`, role: 'user', content: `Explain circuit ${index}.` },
    { id: `a-${index}`, clientMessageId: `turn-${index}`, role: 'assistant', content:
      `Circuit ${index}: the transfer function is\n\n$$T(s)=\\frac{sRC}{1+3sRC+(sRC)^2}$$\n\n` +
      '| Component | Value |\n|---|---|\n| R | 100 kΩ |\n| C | 10 nF |\n'.repeat(8) },
  ]).flat();
  await page.route('http://localhost:38473/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>.hidden{display:none}</style><div id="root"></div>' });
    let body = null;
    if (url.pathname === '/api/hermes/sessions') body = { sessions: [{ id: 'conv_typing', pageSlug: 'pdf:typing', title: 'Circuits' }] };
    if (url.pathname === '/api/hermes/sessions/conv_typing') body = { session: { id: 'conv_typing', messages, runState: 'idle' } };
    if (url.pathname.includes('text-highlights')) body = { entries: [] };
    if (url.pathname.includes('models')) body = { models: [] };
    if (url.pathname === '/api/starred-messages') body = { messages: [] };
    return route.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body ?? {}) });
  });
  await page.goto('http://localhost:38473/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole('button', { name: 'Open PDF assistant', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.katex'));
  await page.waitForTimeout(300);
  const field = page.getByPlaceholder('Ask about this PDF…');
  await field.fill('');
  const before = await page.evaluate(() => window.markdownParses);
  assert.ok(before > 0, 'the fixture must render real equations before typing');
  const question = 'I have a question on FL06, how do you find Q?';
  const started = performance.now();
  await field.pressSequentially(question, { delay: 5 });
  assert.equal(await field.inputValue(), question);
  const after = await page.evaluate(() => window.markdownParses);
  t.diagnostic(`Typing ${question.length} characters: ${Math.round(performance.now() - started)} ms; ${after - before} repeated markdown parses`);
  assert.equal(after, before, `typing reparsed ${after - before} settled markdown answers`);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('breadboard:chat-drafts'))['pdf:typing:conv_typing'].text), question);
  await page.getByRole('button', { name: 'Close PDF assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Open PDF assistant', exact: true }).click();
  assert.equal(await field.inputValue(), question, 'opening the panel preserves the current draft');
  // Reopening may mount virtual rows that were removed while hidden.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const beforeClear = await page.evaluate(() => window.markdownParses);
  await field.fill('');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('breadboard:chat-drafts'))['pdf:typing:conv_typing']), undefined);
  assert.equal(await page.evaluate(() => window.markdownParses), beforeClear, 'clearing a draft must not parse history either');
  assert.deepEqual(errors, []);
});
