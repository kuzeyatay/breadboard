import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("chat answers preserve a reader's scroll position", { timeout: 60_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import React, {useEffect, useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
        import {useChatAutoScroll, useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
        const key = item => item.id;
        const estimate = item => item.height;
        const render = item => <article style={{height: item.height}}>Message {item.id}</article>;
        function App() {
          const [loaded, setLoaded] = useState(false);
          useEffect(() => { setLoaded(true); }, []);
          const [state, setState] = useState({
            responding: false, response: 0, revision: 0, conversation: 'saved-chat',
            items: Array.from({length: 40}, (_, id) => ({id, height: 120})),
          });
          const bridge = useChatVirtualBridge();
          const virtual = window.virtualTranscript;
          const scroll = useChatAutoScroll({
            enabled: loaded,
            isResponding: state.responding,
            responseKey: String(state.response),
            contentKey: String(state.revision),
            conversationKey: state.conversation,
            virtual: virtual ? bridge : undefined,
          });
          window.chat = {
            begin: () => setState(s => ({...s, responding: true, response: s.response + 1})),
            restart: () => setState(s => ({...s, responding: true})),
            grow: (finish = false) => setState(s => ({...s,
              responding: finish ? false : s.responding, revision: s.revision + 1,
              items: s.items.map((item, index) => index === s.items.length - 1 ? {...item, height: item.height + 160} : item),
            })),
            open: () => setState(s => ({...s, responding: false, conversation: 'other-chat'})),
          };
          return <>
            <div id="scroller" ref={scroll.ref} tabIndex={0}
              data-revision={state.revision} data-responding={state.responding}
              style={{height: 480, width: 600, overflowY: 'auto', overflowAnchor: 'none'}}>
              {virtual ? <VirtualizedMessageList surface="scroll-regression"
                items={state.items} getItemKey={key} estimateSize={estimate} renderItem={render}
                scrollRef={scroll.ref} bridge={bridge} gap={0} resetKey={state.conversation}/>
                : <div>{state.items.map(item => <React.Fragment key={item.id}>{render(item)}</React.Fragment>)}</div>}
            </div>
            <button onClick={scroll.scrollToBottom} hidden={!scroll.awayFromBottom}>Jump to newest</button>
          </>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      `,
    },
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

  for (const virtual of [false, true]) {
    await t.test(virtual ? "virtualized transcript" : "ordinary transcript", async (t) => {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      t.after(() => page.close());
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      t.after(() => assert.deepEqual(errors, []));
      await page.setContent('<!doctype html><div id="root"></div>');
      await page.evaluate(value => { window.virtualTranscript = value; }, virtual);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const scroller = page.locator("#scroller");
      const top = () => scroller.evaluate(element => element.scrollTop);
      const distance = () => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
      const settle = () => page.evaluate(() => new Promise(resolve => {
        let frames = 0;
        const step = () => ++frames === 16 ? resolve() : requestAnimationFrame(step);
        requestAnimationFrame(step);
      }));
      const grow = async (finish = false) => {
        const revision = Number(await scroller.getAttribute("data-revision"));
        await page.evaluate(value => window.chat.grow(value), finish);
        await expect(scroller).toHaveAttribute("data-revision", String(revision + 1));
        await settle();
      };
      const readEarlier = async () => {
        await scroller.hover();
        await page.mouse.wheel(0, -900);
        await expect.poll(distance).toBeGreaterThan(500);
        await settle();
        return top();
      };
      const assertParked = async parked => {
        await settle();
        assert.ok(Math.abs(await top() - parked) <= 2, "an answer moved the reader to the bottom");
        await expect(page.getByRole("button", { name: "Jump to newest" })).toBeVisible();
      };

      // Opening history still lands at its newest message.
      await expect.poll(distance).toBeLessThanOrEqual(2);
      await settle();

      // A reader may already be in history before a response starts.
      let parked = await readEarlier();
      await page.evaluate(() => window.chat.begin());
      await expect(scroller).toHaveAttribute("data-responding", "true");
      await assertParked(parked);
      await grow();
      await assertParked(parked);
      await grow(true);
      await assertParked(parked);

      // An explicit jump resumes following, including the final response batch.
      await page.getByRole("button", { name: "Jump to newest" }).click();
      await expect.poll(distance).toBeLessThanOrEqual(2);
      await page.evaluate(() => window.chat.begin());
      await grow();
      await expect.poll(distance).toBeLessThanOrEqual(2);
      await grow(true);
      await expect.poll(distance).toBeLessThanOrEqual(2);

      // Scrolling away during a response also survives completion, a reconnect,
      // and a queued prompt acquiring a new response key.
      await page.evaluate(() => window.chat.begin());
      await grow();
      parked = await readEarlier();
      await grow(true);
      await assertParked(parked);
      await page.evaluate(() => window.chat.restart());
      await grow();
      await assertParked(parked);
      await page.evaluate(() => window.chat.begin());
      await grow();
      await assertParked(parked);

      await page.evaluate(() => window.chat.open());
      await expect.poll(distance).toBeLessThanOrEqual(2);
    });
  }
});
