import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("a long markdown chat preserves its layout cache, scrolls, streams and releases old rows", { timeout: 60_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useCallback, useMemo, useRef, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
      import ChatMessageRail from './src/app/components/chat-message-rail';
      import ChatMarkdown from './src/app/components/chat-markdown';
      import {useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
      window.metrics = {estimates: 0, renders: {}};
      const estimateSize = () => { window.metrics.estimates++; return 300; };
      function App() {
        const [items, setItems] = useState(() => Array.from({length: 2000}, (_, index) => ({
          id: index, role: index % 2 ? 'assistant' : 'user',
          content: index % 2 ? ('Answer **' + index + '**\\n\\n' + 'A detailed explanation with enough text to wrap across several lines. '.repeat(14)) : 'Question ' + index,
        })));
        const scrollRef = useRef(null);
        const bridge = useChatVirtualBridge();
        const railItems = useMemo(() => items.flatMap((item, rowIndex) => item.role === 'user' ? [{rowIndex, label: item.content}] : []), [items]);
        const renderItem = useCallback(item => {
          window.metrics.renders[item.id] = (window.metrics.renders[item.id] || 0) + 1;
          return <article data-message-id={item.id}><ChatMarkdown content={item.content}/></article>;
        }, []);
        window.appendText = () => setItems(previous => previous.map((item, index) => index === previous.length - 1 ? {...item, content: item.content + '\\n\\nSTREAMED UPDATE'} : item));
        window.replaceMiddle = () => setItems(previous => previous.map((item, index) => index === 1000 ? {...item, id: 'replacement', content: 'Replaced middle question'} : item));
        window.jump = index => bridge.scrollToIndex(index, 'auto');
        return <>
          <div id="scroller" ref={scrollRef} style={{height: 600, width: 700, overflowY: 'auto', overflowAnchor: 'none'}}>
            <VirtualizedMessageList surface="browser-performance" items={items} scrollRef={scrollRef} bridge={bridge}
              initialRect={{width: 700, height: 600}} gap={20} getItemKey={item => item.id} estimateSize={estimateSize} renderItem={renderItem}/>
          </div>
          <ChatMessageRail surface="browser-performance" items={railItems} scrollRef={scrollRef} bridge={bridge}/>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: `
    body {font: 16px/24px Arial; margin: 20px} article {padding: 12px}
    [data-chat-message-rail] {position: fixed; right: 20px; top: 20px}
    [role=toolbar] {height: 600px; overflow-y: auto; display: flex; flex-direction: column}
    [role=toolbar] button {min-height: 14px; width: 28px}
  ` });
  await page.evaluate(() => {
    const NativeObserver = window.ResizeObserver;
    window.observedRows = new Set();
    window.ResizeObserver = class {
      targets = new Set();
      observer;
      constructor(callback) {
        this.observer = new NativeObserver(callback);
        window.observedRows.add(this.targets);
      }
      observe(target, options) { this.targets.add(target); this.observer.observe(target, options); }
      unobserve(target) { this.targets.delete(target); this.observer.unobserve(target); }
      disconnect() { this.targets.clear(); this.observer.disconnect(); }
    };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const list = page.locator("[data-chat-virtual-list]");
  await expect(list).toHaveAttribute("data-message-count", "2000");
  await expect(page.locator('[data-message-id="0"]')).toBeVisible();
  const settle = () => page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const tick = () => ++frames >= 45 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }));
  await settle();

  const before = await page.evaluate(() => ({...window.metrics.renders}));
  await page.locator("#scroller").evaluate(element => { element.scrollTop += 30; });
  await settle();
  const after = await page.evaluate(() => window.metrics.renders);
  for (const [key, count] of Object.entries(before)) assert.equal(after[key], count, `scroll rerendered message ${key}`);

  await page.evaluate(() => { window.metrics.estimates = 0; window.appendText(); });
  await settle();
  assert.equal(await page.evaluate(() => window.metrics.estimates), 0, "streaming invalidated the unseen history");

  for (const index of [1000, 1500, 1999]) {
    await page.evaluate(index => window.jump(index), index);
    await expect(page.locator(`[data-message-id="${index}"]`)).toBeVisible();
    await settle();
    const geometry = await page.locator("[data-chat-virtual-list] > [data-index]").evaluateAll(rows => rows.map(row => {
      const rect = row.getBoundingClientRect();
      return {index: Number(row.dataset.index), top: rect.top, bottom: rect.bottom};
    }));
    assert.ok(geometry.length < 30, `${geometry.length} rows mounted for 2000 messages`);
    for (let row = 1; row < geometry.length; row++) {
      assert.ok(geometry[row].top >= geometry[row - 1].bottom + 19, `messages overlap at ${geometry[row].index}`);
    }
  }
  await expect(page.locator('[data-message-id="1999"]')).toContainText("STREAMED UPDATE");
  await page.evaluate(() => window.appendText());
  await expect(page.locator('[data-message-id="1999"]')).toContainText(/STREAMED UPDATE[\s\S]*STREAMED UPDATE/);

  // A changed key in the middle must invalidate offsets even though count and
  // the first/last identities stayed the same.
  await page.evaluate(() => { window.replaceMiddle(); window.jump(1000); });
  await expect(page.locator('[data-message-id="replacement"]')).toBeVisible();
  await settle();
  const retained = await page.evaluate(() => [...window.observedRows].flatMap(targets => [...targets]).filter(target => !target.isConnected).length);
  assert.equal(retained, 0, "resize observers retain detached message trees");
  assert.deepEqual(errors, []);
  t.diagnostic("2,000 messages: bounded mounted rows, no scroll-only content renders, no history re-estimates on streaming, no overlapping or retained detached rows");
});
