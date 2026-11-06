import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import postcss from 'postcss';

const root = path.resolve(import.meta.dirname, '..');
const fixture = '**Question.** Why is the circuit second order?\n\n<details><summary>Answer</summary>\n\n**Answer.** The capacitor current is \\(i=C\\,dv_C/dt\\).\n\n</details>\n\nNext question.\n\n<details><summary>Second answer</summary>\n\nA different explanation.\n\n</details>';
const options = { bundle: true, write: false, jsx: 'automatic', alias: { '@': path.join(root, 'src') }, logLevel: 'silent' };
const nodeBundle = await build({ ...options, entryPoints: [path.join(root, 'src/app/components/chat-markdown.tsx')],
  platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'] });
const module = { exports: {} };
new Function('require', 'module', 'exports', nodeBundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const ChatMarkdown = module.exports.default;
const render = (content, props = {}) => renderToStaticMarkup(React.createElement(ChatMarkdown, { content, ...props }));

test('lesson answers become native disclosures with formatted text and equations', () => {
  const html = render(fixture);
  assert.equal((html.match(/<details>/g) ?? []).length, 2);
  assert.match(html, /<summary>Answer<\/summary>/);
  assert.match(html, /<strong>Answer\.<\/strong>/);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /&lt;\/?(?:details|summary)/);
  assert.match(html, /<\/details>\s*<p>Next question\.<\/p>/);
});

test('compact and nested disclosure markup parses its body as Markdown', () => {
  const html = render('<details open><summary>**Outer**</summary>\nA **worked example**.\n\n<details><summary>Inner</summary>\n\n- One\n- Two\n\n</details>\n</details>');
  assert.match(html, /<details open=""><summary><strong>Outer<\/strong><\/summary>/);
  assert.match(html, /<strong>worked example<\/strong>/);
  assert.match(html, /<details><summary>Inner<\/summary>\s*<ul>/);
  assert.match(html, /<li>One<\/li>/);
  assert.doesNotMatch(html, /&lt;\/?(?:details|summary)/);
});

test('code examples keep literal details tags, including code inside a disclosure', () => {
  const html = render('`<details><summary>Example</summary></details>`\n\n```html\n<details><summary>Example</summary></details>\n```\n\n<details><summary>Answer</summary>\n```html\n</details>\n```\n</details>');
  assert.equal((html.match(/<details>/g) ?? []).length, 1);
  assert.match(html, /&lt;details&gt;&lt;summary&gt;Example/);
  assert.match(html, /&lt;\/details&gt;/);
});

test('disclosure attributes and other HTML cannot become executable chat markup', () => {
  const html = render('<details ontoggle="alert(1)" style="position:fixed"><summary onclick="alert(2)">Answer</summary>\n\n<script>alert(3)</script>\n\n<img src=x onerror="alert(4)">\n\n[Bad link](javascript:alert)\n\n</details>');
  assert.match(html, /<details><summary>Answer<\/summary>/);
  assert.doesNotMatch(html, /<(?:script|img)\b|<[^>]*\bon(?:toggle|click|error)=|<details[^>]*style=|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test('highlights inside answers retain their annotation identity', () => {
  const html = render(fixture, { textAnnotations: [{ id: 'answer-highlight', start: 0, end: 3, quote: 'The capacitor current', kind: 'highlight', color: 'green' }] });
  assert.match(html, /<details>[\s\S]*data-chat-selection-id="answer-highlight"/);
});

test('disclosures toggle independently with mouse and keyboard and survive streaming updates', { timeout: 30000 }, async () => {
  const styles = postcss.parse(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'));
  const css = styles.nodes.filter(node => node.type === 'rule' && /\.chat-markdown (?:details|summary)/.test(node.selector))
    .map(node => node.toString()).join('\n');
  const bundle = await build({ ...options, platform: 'browser', format: 'iife',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import ChatMarkdown from './src/app/components/chat-markdown';
      function App(){const [content,setContent]=useState(${JSON.stringify(fixture)});window.setContent=setContent;
      return <ChatMarkdown content={content}/>;}createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else { res.setHeader('content-type', 'text/html'); res.end(`<style>${css}</style><div id="root"></div><script src="/app.js"></script>`); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const first = page.locator('details').nth(0), second = page.locator('details').nth(1);
    const answer = first.locator('p');
    await first.locator('summary').waitFor();
    assert.equal(await answer.isVisible(), false);
    await first.locator('summary').click();
    assert.equal(await answer.isVisible(), true);
    assert.equal(await second.evaluate(el => el.open), false);
    await page.evaluate(content => window.setContent(content + '\n\nMore text.'), fixture);
    await page.getByText('More text.', { exact: true }).waitFor();
    assert.equal(await first.evaluate(el => el.open), true);
    await first.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await answer.isVisible(), false);
    await page.keyboard.press('Space');
    assert.equal(await answer.isVisible(), true);
    await page.setViewportSize({ width: 390, height: 800 });
    await second.locator('summary').click();
    assert.equal(await second.locator('p').isVisible(), true);
    await page.reload();
    await page.locator('summary').first().waitFor();
    assert.equal(await first.evaluate(el => el.open), false);
    const streamed = '<details><summary>Streamed answer</summary>\n\nA partial explanation';
    await page.evaluate(content => window.setContent(content), streamed);
    await page.getByText('Streamed answer', { exact: true }).click();
    await page.evaluate(content => window.setContent(content + ' is now complete.\n\n</details>'), streamed);
    await page.getByText('A partial explanation is now complete.', { exact: true }).waitFor();
    assert.equal(await first.evaluate(el => el.open), true);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
