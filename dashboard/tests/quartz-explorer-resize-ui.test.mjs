import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

const quartz = path.resolve(import.meta.dirname, '../../quartz');
const requireQuartz = createRequire(path.join(quartz, 'package.json'));
const sass = requireQuartz('sass');

test('Quartz navigation recovers when its pane crosses the mobile breakpoint', { timeout: 60000 }, async (t) => {
  // Render the real Explorer templates and run their script with the real layout
  // styles, so the collapsed 19px tree and overflow mask cannot pass unnoticed.
  const component = await esbuild.build({
    stdin: { resolveDir: quartz, loader: 'tsx', contents: `
      import { render } from 'preact-render-to-string';
      import Explorer from './quartz/components/Explorer';
      const Tree = Explorer({showTitle:false});
      export default render(<Tree cfg={{locale:'en-US'}} fileData={{frontmatter:{}}}/>);
    ` },
    bundle: true, write: false, format: 'esm', platform: 'node', keepNames: true,
    jsx: 'automatic', jsxImportSource: 'preact', loader: { '.scss': 'text' },
    plugins: [{ name: 'inline-resource', setup(build) {
      build.onLoad({ filter: /\.inline\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const { default: tree } = await import('data:text/javascript;base64,' + Buffer.from(component.outputFiles[0].text).toString('base64'));
  const script = await esbuild.build({
    entryPoints: [path.join(quartz, 'quartz/components/scripts/explorer.inline.ts')],
    bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  const css = sass.compileString(`
    @use 'quartz/styles/custom.scss';
    @use 'quartz/components/styles/explorer.scss';
  `, { loadPaths: [quartz] }).css;
  const chapter = 'electromagnetism-1/learning/fields';
  const entries = [
    ['electromagnetism-1/index', 'EM 1'],
    ['electromagnetism-1/learning/index', 'Learning'],
    [chapter + '/index', 'Fields'],
    ...Array.from({ length: 60 }, (_, i) => [chapter + '/lesson-' + (i + 1), 'Lesson ' + (i + 1)]),
  ];
  const index = Object.fromEntries(entries.map(([slug, title]) => [slug, { slug, title, filePath: slug + '.md', tags: [], links: [] }]));
  const html = `<!doctype html><html><head><style>${css}
    :root {--light:#e6f0e6;--dark:#16251c;--darkgray:#263c30;--gray:#52675a;--secondary:#4f6f68;--tertiary:#527e72;--lightgray:#a6bdad;--bodyFont:Arial;--headerFont:Arial}
  </style></head><body><div class="page"><div id="quartz-body">
    <aside class="sidebar left"><div class="flex-component"><button>Search</button></div>${tree}</aside>
    <div class="center"><header class="page-header"><h1>Electromagnetic fields</h1></header><article>${'<p>Article content remains in place while navigating the tree.</p>'.repeat(100)}</article></div>
    <aside class="sidebar right"></aside>
  </div></div><script>
    window.cleanups=[];window.addCleanup=fn=>window.cleanups.push(fn);
    const fetchData=Promise.resolve(${JSON.stringify(index)});
  </script><script>${script.outputFiles[0].text}</script><script>
    document.dispatchEvent(new CustomEvent('nav',{detail:{url:location.pathname.slice(1)}}));
  </script></body></html>`;
  const server = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 760, height: 925 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/${chapter}/lesson-30`);
  await page.waitForSelector('.mobile-explorer:not(.hide-until-loaded)');
  const state = () => page.evaluate(() => {
    const explorer = document.querySelector('.explorer');
    const list = explorer.querySelector('.explorer-ul');
    return {
      collapsed: explorer.classList.contains('collapsed'),
      expanded: explorer.getAttribute('aria-expanded'),
      buttonExpanded: explorer.querySelector('.mobile-explorer').getAttribute('aria-expanded'),
      contentExpanded: explorer.querySelector('.explorer-content').getAttribute('aria-expanded'),
      locked: document.documentElement.classList.contains('mobile-no-scroll'),
      height: explorer.clientHeight, listHeight: list.clientHeight,
      scrollHeight: list.scrollHeight, scrollTop: list.scrollTop,
      pageY: window.scrollY, pageX: window.scrollX,
    };
  });
  const resize = async width => {
    await page.setViewportSize({ width, height: 925 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  assert.equal((await state()).collapsed, true);
  assert.equal((await state()).locked, false);
  assert.equal((await state()).pageY, 0, 'selecting a tree entry must not scroll the article');
  for (const width of [1379, 1100, 801]) {
    await resize(width);
    const current = await state();
    assert.equal(current.collapsed, false, `desktop tree must reopen at ${width}px`);
    assert.equal(current.expanded, 'true');
    assert.equal(current.buttonExpanded, 'true');
    assert.equal(current.contentExpanded, 'true');
    assert.equal(current.locked, false);
    assert.ok(current.height > 400 && current.listHeight > 400, 'tree must occupy usable sidebar height');
    assert.ok(current.scrollHeight > current.listHeight, 'long navigation remains scrollable');
    assert.equal(current.pageY, 0);
    assert.equal(current.pageX, 0);
  }
  await page.locator('.explorer-ul').evaluate(list => { list.scrollTop = 500; });
  assert.ok((await state()).scrollTop >= 499);

  await resize(800);
  assert.equal((await state()).collapsed, true);
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  assert.equal((await state()).collapsed, false);
  assert.equal((await state()).locked, true);
  await resize(700);
  assert.equal((await state()).collapsed, false, 'resizing within mobile keeps an open menu open');
  assert.equal((await state()).locked, true);
  await resize(1379);
  assert.equal((await state()).collapsed, false);
  assert.equal((await state()).locked, false, 'desktop must release the mobile scroll lock');

  await resize(390);
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.getByRole('link', { name: 'Lesson 2', exact: true }).click();
  await page.waitForURL('**/lesson-2');
  await page.waitForSelector('.mobile-explorer:not(.hide-until-loaded)');
  assert.equal((await state()).collapsed, true);
  await resize(1379);
  assert.equal((await state()).collapsed, false, 'navigation from mobile must not strand the desktop tree');
  assert.deepEqual(errors, []);
});
