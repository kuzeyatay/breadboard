import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("reading from the newest message to the oldest preserves every section", { timeout: 60_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
      import {useChatAutoScroll, useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
      const items = Array.from({length: 24}, (_, id) => ({id, height: id % 2 ? 1440 : 80}));
      const key = item => item.id;
      const estimate = item => item.id % 2 ? 300 : 80;
      function Message({item}) {
        const [ready, setReady] = useState(!window.deferredContent);
        useEffect(() => {
          const timer = setTimeout(() => setReady(true), 40);
          return () => clearTimeout(timer);
        }, []);
        return <article data-message-id={item.id} data-ready={ready}
          style={{height: ready ? item.height : 80}}>Message {item.id}</article>;
      }
      const render = item => <Message item={item}/>;
      function App() {
        const [loaded, setLoaded] = useState(false);
        useEffect(() => { setLoaded(true); }, []);
        const bridge = useChatVirtualBridge();
        const scroll = useChatAutoScroll({enabled: loaded, isResponding: false, responseKey: 'saved',
          contentKey: 'saved', conversationKey: 'saved-chat', virtual: bridge});
        return <>
          <main id="scroller" className="bb-chat-scroller" ref={scroll.ref} tabIndex={0}
            style={{height: 480, width: 600, overflowY: 'auto', padding: '24px 16px 100px', boxSizing: 'border-box'}}>
            <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
              <VirtualizedMessageList surface="garden-chat" items={items} getItemKey={key}
                estimateSize={estimate} renderItem={render} scrollRef={scroll.ref}
                bridge={bridge} gap={24} resetKey="saved-chat"/>
              <footer>Chat disclaimer</footer>
            </div>
          </main>
          <button onClick={scroll.scrollToBottom} hidden={!scroll.awayFromBottom}>Jump to newest</button>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const scrollerCss = css.match(/^\.bb-chat-scroller \{[^}]*\}/m)?.[0];
  assert.ok(scrollerCss, "missing shared transcript styles");

  for (const deferred of [false, true]) {
    await t.test(deferred ? "content settles after mounting" : "finished messages", async (t) => {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      t.after(() => page.close());
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      t.after(() => assert.deepEqual(errors, []));
      await page.setContent('<!doctype html><div id="root"></div>');
      await page.addStyleTag({ content: scrollerCss });
      await page.evaluate(value => { window.deferredContent = value; }, deferred);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const scroller = page.locator("#scroller");
      const frames = (count = 8) => page.evaluate(count => new Promise(resolve => {
        const step = () => --count <= 0 ? resolve() : requestAnimationFrame(step);
        requestAnimationFrame(step);
      }), count);
      const position = () => scroller.evaluate(element => {
        const top = element.getBoundingClientRect().top;
        const rows = [...element.querySelectorAll('[data-index]')];
        const row = rows.find(row => row.getBoundingClientRect().bottom > top);
        const index = Number(row.dataset.index);
        let before = 0;
        for (let id = 0; id < index; id++) before += (id % 2 ? 1440 : 80) + 24;
        return { logical: before + top - row.getBoundingClientRect().top,
          index, top: element.scrollTop, distance: element.scrollHeight - element.clientHeight - element.scrollTop };
      });
      await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
      await frames(60);
      await scroller.hover();
      let previous = await position();
      for (let step = 0; step < 230 && previous.top > 0; step++) {
        await page.mouse.wheel(0, -240);
        await frames();
        const current = await position();
        const travelled = previous.logical - current.logical;
        assert.ok(travelled >= -2 && travelled <= 482,
          `history jumped or skipped content on step ${step}: ${JSON.stringify({previous, current, travelled})}`);
        previous = current;
      }
      assert.equal(previous.top, 0, "could not reach the oldest message");
      assert.equal(previous.index, 0, "the beginning of the conversation was skipped");
    });
  }
});
