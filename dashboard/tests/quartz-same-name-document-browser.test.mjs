import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { withCanonicalQuartzReader } from '../../quartz/quartz/components/scripts/canonicalReader.mjs';

const dashboard = path.resolve(import.meta.dirname, '..');
const lib = path.join(dashboard, 'src/lib');
const hostOrigin = 'http://localhost:53325', readerOrigin = 'http://localhost:53326';

test('Circuits.pdf opens through both canonical transports when its note and garden share a name', { timeout: 30_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quartz-same-name-'));
  const prior = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = root;
  let browser;
  try {
    const stubs = {
      'next/server': 'export const NextResponse=Response;',
      '@/lib/server-auth': `export const requireReadableClusterFromSlug=async slug=>{
        if(slug!=='circuits')throw Error('Wrong garden');return {userId:1,cluster:{id:1,slug,user_id:1}};};
        export const requireOwnedClusterFromSlug=requireReadableClusterFromSlug;
        export const routeErrorResponse=e=>Response.json({error:e.message},{status:403});`,
      '@/lib/db': 'export default {};',
      '@/lib/quartz-publish': 'export async function publishQuartzAfterMutation(){}',
      '@/lib/garden-mutation-lease': 'export const acquireGardenMutationLease=()=>({release(){}});export const assertGardenMutationWritePaths=()=>{};',
      '@/lib/markdown-folder-title.ts': 'export const markdownFolderTitle=()=>"Sources";',
      '@/lib/knowledge': `import fs from 'node:fs';import path from 'node:path';
        export const normalizeTopicTags=t=>t;export const refreshClusterIndex=()=>{};
        export const walkClusterMarkdown=root=>{const files=[];const walk=(dir,folder='')=>{
          for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
            const filePath=path.join(dir,entry.name),relPath=folder?folder+'/'+entry.name:entry.name;
            if(entry.isDirectory())walk(filePath,relPath);
            else if(entry.name.endsWith('.md'))files.push({entry:entry.name,filePath,relPath,folder});
          }};walk(root);return files;};`,
    };
    const server = await build({ entryPoints: [path.join(dashboard, 'src/app/api/documents/[slug]/route.ts')],
      bundle: true, platform: 'node', format: 'cjs', write: false,
      plugins: [{ name: 'source-fixture', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (stubs[args.path]) return { path: args.path, namespace: 'fixture' };
          if (args.path === '@/lib/generated/quartz-reader.mjs') return { path: path.join(dashboard, '../quartz/quartz/reader.ts') };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'ts', resolveDir: lib }));
        builder.onLoad({ filter: /(?:\.scss|\.inline\.(?:ts|js))$/ }, () => ({ contents: '', loader: 'text' }));
      } }],
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', server.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const host = await build({ stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
      import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
      import Bridge from './src/app/garden/garden-document-editor-bridge';
      import {useCanonicalQuartzDocument} from './src/app/garden/use-canonical-quartz-document';
      const note=new URLSearchParams(location.search).get('note'),full=new URLSearchParams(location.search).get('full');
      function Host(){const ref=useRef(null);const [active,setActive]=useState({cluster:'circuits',slug:note});
        const reader=useCanonicalQuartzDocument(ref,'${readerOrigin}',active,setActive);
        return <>{reader.error&&<p role='alert'>{reader.error}</p>}<iframe ref={ref} src={'${readerOrigin}/'+full}/><Bridge iframeRef={ref} quartzOrigin='${readerOrigin}'/></>;}
      createRoot(document.getElementById('root')).render(<Host/>);
    ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
    const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage(); page.setDefaultTimeout(5_000);
    const failures = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${hostOrigin}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/documents/')) {
        const response = await module.exports.GET(new Request(url), {
          params: Promise.resolve({ slug: decodeURIComponent(url.pathname.slice('/api/documents/'.length)) }),
        });
        const body = await response.text();
        if (!response.ok) failures.push(body);
        return route.fulfill({ status: response.status, contentType: 'application/json', body });
      }
      return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${host.outputFiles[0].text}</script>` });
    });
    await page.route(`${readerOrigin}/**`, route => {
      const slug = new URL(route.request().url()).pathname.slice(1);
      return route.fulfill({ contentType: 'text/html', body: withCanonicalQuartzReader(`<html><head><title>Old publication</title></head>
        <body data-slug="${slug}"><h1 class="article-title">Old publication</h1>
        <div class="markdown-actions" data-note-slug="${slug}"><button>Edit</button></div>
        <article class="popover-hint"><p>Old publication</p></article></body></html>`) });
    });
    for (const folder of ['sources', '']) {
      const dir = path.join(root, 'circuits', folder); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'circuits.md');
      const relative = folder ? `${folder}/circuits` : 'circuits';
      fs.writeFileSync(file, '---\ntitle: Circuits.pdf\nknowledge_type: source-document\n---\n\n# Circuit fundamentals\n\nThe saved source is readable.\n');
      for (const note of [relative, encodeURIComponent(relative)]) {
        await page.goto(`${hostOrigin}/?${new URLSearchParams({ note, full: `circuits/${relative}` })}`);
        const frame = page.frameLocator('iframe');
        await frame.getByRole('heading', { name: 'Circuits.pdf', exact: true }).waitFor();
        await frame.getByText('The saved source is readable.', { exact: true }).waitFor();
        await frame.locator('html[data-canonical-pending]').waitFor({ state: 'detached' });
        assert.equal(await frame.getByText('Could not load the saved page.', { exact: false }).count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.match(await frame.locator('.content-meta').textContent(), /words/);
      }
      fs.unlinkSync(file);
    }
    assert.deepEqual(failures, []);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (prior === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
