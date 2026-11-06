import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import katex from 'katex';

const root = path.resolve(import.meta.dirname, '..');

test('the Markdown component refreshes containment after edits and releases short replies', { timeout: 30_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
      import ChatMarkdown from './src/app/components/chat-markdown';
      function App(){const [content,setContent]=useState(Array.from({length:100},(_,i)=>'Paragraph '+i+' with **formatting**.').join('\\n\\n'));window.update=setContent;return <ChatMarkdown content={content}/>;}
      createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
    ` } });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => document.querySelector('.chat-markdown > p')?.style.contentVisibility === 'auto');
  await page.evaluate(() => window.update(Array.from({length:110},(_,i)=>'Edited paragraph '+i+'.').join('\n\n')));
  await page.waitForFunction(() => document.querySelectorAll('.chat-markdown > p').length === 110 && document.querySelector('.chat-markdown > p').style.contentVisibility === 'auto');
  await page.evaluate(() => window.update('A short reply.'));
  await page.waitForFunction(() => document.querySelector('.chat-markdown')?.textContent === 'A short reply.');
  assert.equal(await page.locator('.chat-markdown > p').evaluate(x => x.style.contentVisibility), '');
  assert.deepEqual(errors, []);
});

test('long math replies skip offscreen rendering without losing layout, selection or resize', { timeout: 60_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, format: 'iife', platform: 'browser',
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import {containLongChatMarkdown} from './src/lib/chat-markdown-containment';
      window.contain = () => { window.cleanup = containLongChatMarkdown(document.querySelector('article')); };
    ` } });
  const math = katex.renderToString(String.raw`A(s)=\frac{A_0}{(1+s/\omega_1)(1+s/\omega_2)}\quad v_o=\left(1+\frac{R_2}{R_1}\right)v_i`, { displayMode: true });
  const blocks = Array.from({ length: 180 }, (_, i) => `<p>Section ${i}: A paragraph that wraps when the reader resizes the chat. ${'Amplifier gain and frequency response. '.repeat(5)}</p>${math}`).join('');
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<style>${fs.readFileSync(path.join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8')}</style>
    <style>main{height:700px;overflow:auto}article{width:900px;font:14px/24px Arial}p{margin:14px 0}.katex-display{padding:4px 0}</style>
    <main><article>${blocks}<details><summary>Answer</summary><p>Disclosure remains interactive.</p></details><p><img alt='late image'></p></article></main>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const naturalHeight = await page.locator('article').evaluate(x => x.offsetHeight);
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const measureStyleWork = async () => {
    const before = (await session.send('Performance.getMetrics')).metrics.find(x => x.name === 'RecalcStyleDuration').value;
    await page.evaluate(async () => {
      const article = document.querySelector('article');
      for (let i = 0; i < 24; i++) {
        article.style.color = i % 2 ? 'rgb(30,30,30)' : 'rgb(31,31,31)';
        document.querySelector('main').scrollTop = 5000 + i * 40;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    });
    return (await session.send('Performance.getMetrics')).metrics.find(x => x.name === 'RecalcStyleDuration').value - before;
  };
  const before = await measureStyleWork();
  await page.evaluate(() => window.contain());
  await page.waitForFunction(() => document.querySelector('article > p').style.contentVisibility === 'auto');
  assert.equal(await page.locator('article').evaluate(x => x.offsetHeight), naturalHeight, 'measured placeholders preserve the complete reply height');
  const after = await measureStyleWork();
  assert.ok(after < before * 0.6, `offscreen style work should fall substantially: ${before}s -> ${after}s`);
  t.diagnostic(JSON.stringify({ beforeStyleMs: before * 1000, afterStyleMs: after * 1000 }));
  assert.equal(await page.locator('details').evaluate(x => x.style.contentVisibility), '');
  assert.equal(await page.locator('img').evaluate(x => x.parentElement.style.contentVisibility), '');

  // Native selection can still span the entire answer, including skipped blocks.
  const selectAll = () => page.locator('article').evaluate(x => {
    const range = document.createRange(); range.selectNodeContents(x);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const text = selection.toString(); selection.removeAllRanges(); return text;
  });
  const containedText = await selectAll();
  assert.match(containedText, /Section 0:/);
  assert.match(containedText, /Section 179:/);
  await page.evaluate(() => window.cleanup());
  assert.equal(await selectAll(), containedText);
  assert.equal(await page.locator('article > p').first().evaluate(x => x.getAttribute('style')), '');

  await page.evaluate(() => { window.contain(); document.querySelector('article').style.width = '420px'; });
  await page.waitForFunction(() => document.querySelector('article > p').style.contentVisibility === 'auto');
  await page.waitForTimeout(100);
  const narrowHeight = await page.locator('article').evaluate(x => x.offsetHeight);
  await page.evaluate(() => window.cleanup());
  assert.equal(await page.locator('article').evaluate(x => x.offsetHeight), narrowHeight, 'resizing replaces cached heights with the new wrapping');
  assert.ok(narrowHeight > naturalHeight);
  await page.evaluate(() => window.contain());
  await page.waitForFunction(() => document.querySelector('article > p').style.contentVisibility === 'auto');
  assert.equal(await page.evaluate(() => window.find('Section 179:')), true);
  assert.equal(await page.evaluate(() => getSelection().toString()), 'Section 179:');
  // window.find selects the match but does not scroll a nested scroller in
  // headless Edge. Explicit navigation must still reveal its retained DOM.
  await page.locator('article > p').filter({ hasText: 'Section 179:' }).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('main').scrollTop > 10_000);
  await page.locator('summary').click();
  assert.equal(await page.locator('details').evaluate(x => x.open), true);
  assert.deepEqual(errors, []);
});
