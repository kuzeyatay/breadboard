import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { chromium, expect } from '@playwright/test';
import { interactionHydrationBootstrapScript } from '../src/app/components/interaction-hydration-bridge.ts';

const root = path.resolve(import.meta.dirname, '..');

for (const activation of ['click', 'Enter']) test(`Terminal home hydrates independently and preserves an early ${activation}`, { timeout: 60_000 }, async () => {
  // Keep the real home dock and hydration gate. Only the large chat module is
  // replaced, so its separate network request can be held indefinitely.
  const app = `
    import Gate from './src/app/components/interaction-hydration-gate';
    import Terminal from './src/app/components/hermes/lazy-dashboard-agent-terminal';
    import {BrowserDock} from './src/app/browser/browser-home-widgets';
    export default function App() { return <Gate>
      <input aria-label="Search the web" />
      <BrowserDock openConnections={()=>{}} openPanel={null} setPanelOpen={()=>{}} />
      <Terminal scope="mine" restoreOwnerKey="hydration-test" initialChatId="saved-chat" />
    </Gate>; }
  `;
  const fixturePlugin = { name: 'chat-boundary', setup(builder) {
    // Next's App Router compiler aliases this import; esbuild needs the same
    // implementation rather than the package's legacy Pages Router default.
    builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: path.join(root, 'node_modules/next/dist/shared/lib/app-dynamic.js') }));
    builder.onResolve({ filter: /^home-fixture$/ }, () => ({ path: 'home-fixture', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: app, loader: 'tsx', resolveDir: root }));
    builder.onResolve({ filter: /\/dashboard-agent-terminal$/ }, () => ({ path: 'chat-engine', namespace: 'chat' }));
    builder.onLoad({ filter: /.*/, namespace: 'chat' }, () => ({ loader: 'tsx', resolveDir: root, contents: `
      import {useEffect, useState} from 'react';
      export default function Terminal({initialChatId}) {
        const [open,setOpen]=useState(false);
        useEffect(()=>{window.chatHydrated=true;window.restoredChat=initialChatId},[]);
        const activate=()=>{window.terminalActivations=(window.terminalActivations??0)+1;setOpen(value=>!value)};
        return <section data-terminal-dock><header role="button" tabIndex={0} onClick={activate}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate()}}}>Open terminal</header>
          {open && <textarea aria-label="Terminal message" />}</section>;
      }
    ` }));
  } };
  const shared = { absWorkingDir: root, bundle: true, write: false, jsx: 'automatic', logLevel: 'silent', plugins: [fixturePlugin] };
  const server = await build({ ...shared, platform: 'node', format: 'cjs', packages: 'external',
    stdin: { contents: `export {default} from 'home-fixture'`, resolveDir: root, loader: 'tsx' }, outfile: 'fixture.cjs' });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', server.outputFiles.find(file => file.path.endsWith('.cjs')).text)(createRequire(import.meta.url), mod, mod.exports);
  const html = await new Promise((resolve, reject) => {
    const output = new PassThrough(); let markup = '';
    output.on('data', chunk => { markup += chunk; }); output.on('end', () => resolve(markup));
    const stream = renderToPipeableStream(createElement(mod.exports.default), {
      onAllReady() { stream.pipe(output); }, onError: reject,
    });
  });
  assert.match(html, /data-terminal-dock/);
  const client = await build({ ...shared, platform: 'browser', format: 'esm', splitting: true, outdir: 'hydration-fixture',
    stdin: { contents: `import {hydrateRoot} from 'react-dom/client'; import App from 'home-fixture';
      hydrateRoot(document.getElementById('root'), <App/>);`, resolveDir: root, loader: 'tsx' } });
  const files = new Map(client.outputFiles.map(file => [path.basename(file.path), file.text]));
  const chatFile = [...files.keys()].find(name => name.startsWith('chat-engine-') && name.endsWith('.js'));
  assert.ok(chatFile, 'the terminal must have a separately loadable chunk');
  let releaseChat;
  const chatGate = new Promise(resolve => { releaseChat = resolve; });
  let chatRequested = false;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.process = { env: {} };
      window.EventSource = class { close() {} };
      localStorage.setItem('breadboard:current-location', JSON.stringify({ useForAnswers: false }));
    });
    await page.route('https://home-hydration.test/**', async route => {
      const url = new URL(route.request().url());
      const filename = path.basename(url.pathname);
      if (files.has(filename)) {
        if (filename === chatFile) { chatRequested = true; await chatGate; }
        return route.fulfill({ contentType: filename.endsWith('.css') ? 'text/css' : 'text/javascript', body: files.get(filename) });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { connected: false, status: 'disconnected', engine: { ready: false, deviceId: null }, history: [], cities: [] } });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8">
        <script>${interactionHydrationBootstrapScript}</script></head><body>
        <style>.browser-dock {width:1000px;height:120px;position:relative;display:flex}
          .browser-sketch-outline {position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
          [data-terminal-dock] {position:fixed;bottom:0;left:0;height:42px;width:100%}</style>
        <div id="root">${html}</div><script type="module" src="/stdin.js"></script></body></html>` });
    });
    await page.goto('https://home-hydration.test', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => chatRequested).toBe(true);
    await expect.poll(async () => ({ errors, clock: await page.locator('.browser-dock-time strong').textContent({ timeout: 1000 }).catch(() => null) }))
      .toMatchObject({ errors: [], clock: expect.stringMatching(/^\d/) });
    await expect(page.locator('.browser-dock svg.browser-sketch-outline path').first()).toBeAttached();
    await page.getByRole('textbox', { name: 'Search the web' }).fill('ready before chat');
    await expect(page.getByRole('textbox', { name: 'Search the web' })).toHaveValue('ready before chat');
    assert.equal(await page.evaluate(() => window.chatHydrated), undefined);
    // SSR keeps the original dock in place throughout the delayed hydration.
    await expect(page.getByRole('button', { name: 'Open terminal' })).toBeVisible();
    if (activation === 'click') await page.getByRole('button', { name: 'Open terminal' }).click();
    else { await page.getByRole('button', { name: 'Open terminal' }).focus(); await page.keyboard.press(activation); }
    releaseChat();
    await expect.poll(() => page.evaluate(() => window.chatHydrated)).toBe(true);
    assert.deepEqual(errors, []);
    await expect(page.getByRole('textbox', { name: 'Terminal message' })).toBeVisible();
    assert.equal(await page.evaluate(() => window.terminalActivations), 1);
    assert.equal(await page.evaluate(() => window.restoredChat), 'saved-chat');
    assert.deepEqual(errors, []);
  } finally { releaseChat(); await browser.close(); }
});

test('home startup excludes agent editors and rich notification rendering', async t => {
  // Model Next's server-action and dynamic-import boundaries, then audit the
  // real transitive entry graph. A new eager path to these modules regresses
  // hydration even if the Terminal wrapper itself still says "lazy".
  const result = await build({ absWorkingDir: root, entryPoints: ['src/app/dashboard/dashboard-client.tsx'],
    bundle: true, write: false, metafile: true, minify: true, platform: 'browser', format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'next-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.kind === 'dynamic-import' || args.path.endsWith('.css')
        ? { path: args.path, external: true } : null);
      builder.onLoad({ filter: /[\\/]app[\\/]actions[\\/].*\.tsx?$/ }, ({ path: filename }) => ({ loader: 'js',
        contents: [...fs.readFileSync(filename, 'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)]
          .map(match => `export const ${match[1]}=()=>{};`).join('\n'),
      }));
    } }],
  });
  const forbidden = Object.keys(result.metafile.inputs).filter(name => /\/dashboard-agent-terminal\.tsx|\/chat-markdown\.tsx|katex\.mjs|metal-fx\/dist/.test(name));
  assert.deepEqual(forbidden, []);
  t.diagnostic(`Initial minified home graph: ${Object.values(result.metafile.outputs).reduce((total, file) => total + file.bytes, 0)} bytes`);
});
