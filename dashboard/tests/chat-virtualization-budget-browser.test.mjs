import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');

test('long math answers keep a screen of neighbors and remain reachable in both directions', { timeout: 30_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, logLevel: 'silent',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef,useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
      import List from '@/app/components/chat/virtualized-message-list';
      import {useChatVirtualBridge} from '@/app/components/use-chat-auto-scroll';
      const sizes=[60,900,60,1000,60,900,60,1000,18638,148,5400,168,3102,260,15530];
      const items=sizes.map((height,id)=>({id,height}));
      const key=item=>item.id,estimate=item=>Math.min(900,item.height);
      const render=item=><article style={{height:item.height}}>{Array.from({length:Math.ceil(item.height/4)},(_,n)=><span key={n}>x</span>)}</article>;
      function App(){const scroll=useRef(null),bridge=useChatVirtualBridge();
        const [,mounted]=useState(false);useEffect(()=>mounted(true),[]);
        window.jump=index=>bridge.scrollToIndex(index,'auto');
        window.bottom=()=>bridge.scrollToEnd('auto');
        return <div id='scroller' ref={scroll} style={{height:900,overflow:'auto'}}>
          <List items={items} getItemKey={key} estimateSize={estimate} renderItem={render} scrollRef={scroll}
            bridge={bridge} gap={20} surface='budget-fixture'/></div>;
      }createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  page.setDefaultTimeout(5_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.bottom && document.querySelector('[data-chat-virtual-list] > [data-index]'));
  const waitForBottom = async () => {
    try {
      await page.waitForFunction(() => {
        const scroller = document.getElementById('scroller');
        return document.querySelector('[data-index="14"]') && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 2;
      });
    } catch (error) {
      throw new Error(JSON.stringify(await page.evaluate(() => ({
        top: document.getElementById('scroller').scrollTop,
        height: document.getElementById('scroller').scrollHeight,
        rows: [...document.querySelector('[data-chat-virtual-list]').children].map(row => ({index:row.dataset.index,top:row.getBoundingClientRect().top,height:row.getBoundingClientRect().height})),
      }))), { cause: error });
    }
  };
  await page.evaluate(() => window.bottom());
  await waitForBottom();
  const snapshot = await page.evaluate(() => ({
    rows: [...document.querySelector('[data-chat-virtual-list]').children].map(row => Number(row.dataset.index)),
    nodes: document.getElementsByTagName('*').length,
  }));
  assert.deepEqual(snapshot.rows, [14], 'the visible answer already covers the buffer above the viewport');
  assert.ok(snapshot.nodes < 5_000, `too many offscreen math nodes: ${snapshot.nodes}`);
  await page.evaluate(() => window.jump(0));
  await page.waitForFunction(() => document.querySelector('[data-index="0"]') && document.getElementById('scroller').scrollTop < 2);
  await page.evaluate(() => window.bottom());
  await waitForBottom();

  await page.evaluate(() => window.jump(8));
  await page.waitForFunction(() => document.querySelector('[data-index="8"]')?.offsetHeight === 18638);
  const start = await page.locator('[data-index="8"]').evaluate(row =>
    row.getBoundingClientRect().top - document.getElementById('scroller').getBoundingClientRect().top + document.getElementById('scroller').scrollTop);
  const rows = () => page.locator('[data-chat-virtual-list] > [data-index]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.index)));
  const scroll = offset => page.evaluate(async offset => {
    document.getElementById('scroller').scrollTop = offset;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, offset);
  await scroll(start + 4_000);
  assert.deepEqual(await rows(), [8], 'distant answers unmount while reading the middle of a long answer');
  // Stay in the same visible row and keep scrolling active: TanStack's normal
  // visible-index notifications never fire while approaching either edge.
  for (let offset = 3_800; offset >= 800; offset -= 200) await scroll(start + offset);
  assert.deepEqual(await rows(), [7, 8], 'the previous answer mounts before it becomes visible');
  await scroll(start + 10_000);
  assert.deepEqual(await rows(), [8]);
  for (let offset = 10_200; offset <= 17_000; offset += 200) await scroll(start + offset);
  assert.deepEqual(await rows(), [8, 9], 'the next prompt mounts before it becomes visible');
  const selection = await page.locator('[data-index="8"] article').evaluate(article => {
    const range = document.createRange(); range.selectNodeContents(article);
    const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
    const text = selected.toString(); selected.removeAllRanges(); return text;
  });
  assert.equal(selection.length, Math.ceil(18638 / 4), 'the entire long answer stays selectable');
  assert.deepEqual(errors, []);
  t.diagnostic(JSON.stringify(snapshot));
});
