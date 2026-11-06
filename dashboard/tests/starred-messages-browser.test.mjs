import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

test("saved messages open draggable popups; right-click goes to the chat", { timeout: 60_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cssPath = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));
  const css = (await postcss([tailwindcss({ base: root })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState, useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import AssistantMessageActions, {MessageActionsSlot} from './src/app/components/assistant-message-actions';
      import StarredMessagesPanel from './src/app/components/hermes/starred-messages-panel';
      import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
      import {useChatAutoScroll, useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
      import {useStarredMessageJump} from './src/app/components/use-starred-message-jump';
      import {wholeMessageReply} from './src/lib/chat-text-selection';
      const content = 'Whole reply ' + 'long answer '.repeat(500) + 'FINAL SENTENCE';
      const rows = Array.from({length: 80}, (_, id) => ({message: {id: id === 4 ? undefined : 'msg_' + id, clientMessageId: id === 4 ? 'client-turn-one' : undefined, role: 'assistant'}}));
      const key = row => row.message.id ?? row.message.clientMessageId;
      const estimate = () => 160;
      const render = row => <article style={{height:160}}>{row.message.id}</article>;
      function App() {
        const [chatId, setChatId] = useState('conv_other');
        const [loading, setLoading] = useState(false);
        const [target, setTarget] = useState(null);
        const [selection, setSelection] = useState(null);
        const composer = useRef(null);
        const bridge = useChatVirtualBridge();
        const scroll = useChatAutoScroll({isResponding:false, responseKey:'fixed', contentKey:chatId, conversationKey:chatId, enabled:!loading, virtual:bridge});
        useStarredMessageJump({target, chatId, loading, rows, bridge, scrollRef:scroll.ref, scrollToMessage:scroll.scrollToMessage});
        return <>
          <MessageActionsSlot conversationId="conv_one" messageId="client-turn-one" onReply={text => {
            const reply = wholeMessageReply('msg_4', text); window.reply = reply; setSelection(reply); composer.current.focus();
          }}><AssistantMessageActions content={content}/></MessageActionsSlot>
          <textarea aria-label="Chat composer" ref={composer}/>
          {selection ? <p data-reply>{selection.quote}</p> : null}
          <output data-active-chat>{chatId}</output>
          <StarredMessagesPanel gardenSlug={new URLSearchParams(location.search).get('garden') ?? undefined} onOpenMessage={message => {
            setTarget({chatId:message.chatId, messageId:message.messageId, clientMessageId:message.clientMessageId, requestId:Date.now()});
            if (chatId !== message.chatId) {
              setLoading(true); setChatId(message.chatId); setTimeout(() => setLoading(false), 60);
            }
          }}/>
          <div id="scroller" ref={scroll.ref} style={{height:480, overflowY:'auto', overflowAnchor:'none'}}>
            {!loading && <VirtualizedMessageList surface="starred-test" items={rows} getItemKey={key} estimateSize={estimate} renderItem={render}
              scrollRef={scroll.ref} bridge={bridge} gap={0} resetKey={chatId}/>}
          </div>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let stars = [];
  let failSave = false;
  let failRead = false;
  const fullAnswer = '# Full saved answer\n\n**Formatted response** with $x^2$.\n\n' + 'Long answer. '.repeat(300) + '\n\nFINAL SENTENCE';
  const message = {conversationId:'conv_one', chatId:'conv_one', messageId:'msg_4', clientMessageId:'client-turn-one', title:'Saved chat', preview:'Saved response', gardenSlug:null, starredAt:'2026-09-19'};
  await page.route("https://starred.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/starred-messages' && url.searchParams.has('message')) {
      if (failRead) return route.fulfill({status:404, json:{detail:'This starred message is no longer available.'}});
      return route.fulfill({json:{message:{messageId:url.searchParams.get('message'), content:fullAnswer}}});
    }
    if (route.request().url().endsWith('/api/starred-messages')) {
      if (route.request().method() === 'PUT') {
        if (failSave) return route.fulfill({status:500, json:{error:'Could not save star'}});
        stars = route.request().postDataJSON().starred ? [message] : [];
      }
      return route.fulfill({json:{messages:stars}});
    }
    if (route.request().url().includes('/api/')) return route.fulfill({json:{}});
    return route.fulfill({contentType:'text/html', body:'<!doctype html><div id="root"></div>'});
  });
  await page.goto("https://starred.test/");
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button', {name:'Reply to message'}).click();
  await expect(page.getByRole('textbox', {name:'Chat composer'})).toBeFocused();
  assert.ok(await page.evaluate(() => window.reply.quote.length > 4000 && window.reply.quote.endsWith('FINAL SENTENCE')));
  await expect(page.getByRole('button', {name:'Star message', exact:true})).toBeEnabled();
  failSave = true;
  await page.getByRole('button', {name:'Star message', exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Could not save star');
  await expect(page.getByRole('button', {name:'Star message', exact:true})).toHaveAttribute('aria-pressed','false');
  failSave = false;
  await page.getByRole('button', {name:'Star message', exact:true}).click();
  await expect(page.getByRole('button', {name:'Saved chat Saved response'})).toBeVisible();
  await page.reload();
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await expect(page.getByRole('button', {name:'Unstar message', exact:true}).first()).toHaveAttribute('aria-pressed','true');
  const savedButton = page.getByRole('button', {name:'Saved chat Saved response'});
  await savedButton.click();
  const popup = page.getByRole('dialog', {name:'Starred message', exact:true});
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('heading', {name:'Full saved answer'})).toBeVisible();
  await expect(popup.locator('strong')).toHaveText('Formatted response');
  await expect(popup.locator('.katex')).toBeVisible();
  await expect(popup).toContainText('FINAL SENTENCE');
  await expect(page.locator('[data-active-chat]')).toHaveText('conv_other');
  await expect(page).toHaveURL('https://starred.test/');
  await expect(page.locator('[data-starred-message-target]')).toHaveCount(0);
  const before = await popup.boundingBox();
  const handle = popup.getByRole('button', {name:'Move starred message'});
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2 + 70, {steps:5});
  await page.mouse.up();
  await expect.poll(async () => (await popup.boundingBox()).x).toBeGreaterThan(before.x + 100);
  await handle.focus();
  const moved = await popup.boundingBox();
  await handle.press('ArrowLeft');
  await expect.poll(async () => (await popup.boundingBox()).x).toBe(moved.x - 10);
  await handle.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(savedButton).toBeFocused();
  // A failed read remains in the popup and can be retried without navigating.
  failRead = true;
  await savedButton.press('Enter');
  await expect(popup.getByRole('alert')).toContainText('no longer available');
  failRead = false;
  await popup.getByRole('button', {name:'Retry'}).click();
  await expect(popup).toContainText('FINAL SENTENCE');
  await popup.getByRole('button', {name:'Close starred message'}).click();
  await savedButton.click({button:'right'});
  await expect(popup).toHaveCount(0);
  await page.getByRole('menuitem', {name:'Go to chat'}).click();
  const savedRow = page.locator('#scroller [data-index="4"]');
  await expect(savedRow).toHaveAttribute('data-starred-message-target','');
  await expect(savedRow).toBeFocused();
  const offset = () => savedRow.evaluate(element => element.getBoundingClientRect().top - document.querySelector('#scroller').getBoundingClientRect().top);
  await expect.poll(offset).toBeLessThan(3);
  await expect.poll(offset).toBeGreaterThan(-3);
  // The default landing must not pull the viewport back to the newest answer.
  await page.waitForTimeout(1400);
  await expect.poll(offset).toBeLessThan(3);
  await expect.poll(offset).toBeGreaterThan(-3);
  await savedButton.click({button:'right'});
  await page.getByRole('menuitem', {name:'Go to chat'}).click();
  await expect(savedRow).toHaveAttribute('data-starred-message-target','');
  await page.getByRole('button', {name:'Unstar message', exact:true}).first().click();
  await expect(page.getByText('No starred messages yet.', {exact:false})).toBeVisible();
  assert.deepEqual(stars, []);
  // Cross-garden stars also preview in place; their explicit menu link keeps
  // the original garden/chat/message destination.
  stars = [{...message, conversationId:'conv_garden', chatId:'42', messageId:'msg_42', gardenSlug:'my-garden'}];
  await page.reload();
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await savedButton.click();
  await expect(popup).toContainText('FINAL SENTENCE');
  await expect(page).toHaveURL('https://starred.test/');
  await expect(page.locator('[data-active-chat]')).toHaveText('conv_other');
  await popup.getByRole('button', {name:'Close starred message'}).click();
  await savedButton.click({button:'right'});
  await expect(page.getByRole('menuitem', {name:'Go to chat'})).toHaveAttribute('href','/gardens/my-garden?chat=42&message=msg_42');
  await page.getByRole('menuitem', {name:'Go to chat'}).click();
  await expect(page).toHaveURL('https://starred.test/gardens/my-garden?chat=42&message=msg_42');
  // The same menu in a garden preserves that garden's active chat on click.
  await page.goto('https://starred.test/?garden=my-garden');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await savedButton.click();
  await expect(popup).toContainText('FINAL SENTENCE');
  await expect(page.locator('[data-active-chat]')).toHaveText('conv_other');
  await page.setViewportSize({width:390, height:640});
  await expect.poll(async () => {
    const rect = await popup.boundingBox();
    return rect.x >= 16 && rect.y >= 16 && rect.x + rect.width <= 374 && rect.y + rect.height <= 624;
  }).toBe(true);
  await popup.getByRole('button', {name:'Close starred message'}).click();
  await savedButton.click({button:'right'});
  await page.getByRole('menuitem', {name:'Go to chat'}).click();
  await expect(page.locator('[data-active-chat]')).toHaveText('42');
  // Reader stars belong in this Garden, but must not open a numeric workspace chat.
  stars = [{...message, conversationId:'conv_pdf', chatId:'conv_pdf', messageId:'msg_43', gardenSlug:'my-garden', workspaceChat:false}];
  await page.reload();
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await savedButton.click();
  await expect(popup).toContainText('FINAL SENTENCE');
  await popup.getByRole('button', {name:'Close starred message'}).click();
  await savedButton.click({button:'right'});
  await expect(page.getByRole('menuitem', {name:'Go to chat'})).toHaveAttribute('href','/dashboard?terminalChat=conv_pdf&message=msg_43');
  await page.getByRole('menuitem', {name:'Go to chat'}).click();
  await expect(page).toHaveURL('https://starred.test/dashboard?terminalChat=conv_pdf&message=msg_43');
  assert.deepEqual(errors, []);
});

test("starred jumps survive transcript refreshes and late row measurements", { timeout: 60_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  // Use the actual surface gates: a slow artifact request must not hold a
  // restored starred message offscreen in either chat surface.
  const loadingGate = (path, name) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    return ["openingStarredMessage", name].map(variable => {
      const declaration = source.match(new RegExp("const " + variable + " =[^;]+;"));
      assert.ok(declaration, variable);
      return declaration[0];
    }).join("\n");
  };
  const terminalGate = loadingGate("../src/app/components/hermes/agent-runtime-panel.tsx", "conversationLoading");
  const gardenGate = loadingGate("../src/app/gardens/[clusterSlug]/workspace-client.tsx", "chatContentLoading");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
      import {useChatAutoScroll, useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
      import {useStarredMessageJump} from './src/app/components/use-starred-message-jump';
      const initialRows = Array.from({length: 300}, (_, index) => ({
        message: {id:'msg_' + index, role:'assistant'}, height: index % 2 ? 1600 : 80,
      }));
      const key = row => row.message.id;
      const estimate = () => 160;
      function Message({row}) {
        const [ready, setReady] = useState(false);
        useEffect(() => { const timer = setTimeout(() => setReady(true), 80); return () => clearTimeout(timer); }, []);
        return <article style={{height:ready ? row.height : 80}}>{row.message.id}</article>;
      }
      const render = row => <Message row={row}/>;
      function terminalLoading(starredMessageTarget, loadingTranscript) {
        const sessionId = '42', visibleConversationJustCreated = false, artifactsReady = false;
        ${terminalGate}
        return conversationLoading;
      }
      function gardenLoading(starredMessageTarget, loadingChats) {
        const activeChatId = 42, visibleChatJustCreated = false, inlineArtifactsReady = false, activeTranscriptPending = false;
        ${gardenGate}
        return chatContentLoading;
      }
      function App() {
        const [rows, setRows] = useState(initialRows);
        const [target, setTarget] = useState(null);
        const [restoring, setRestoring] = useState(false);
        const loading = terminalLoading(target, restoring) || gardenLoading(target, restoring);
        const bridge = useChatVirtualBridge();
        const scroll = useChatAutoScroll({isResponding:false, responseKey:'saved', contentKey:'saved', conversationKey:'42', enabled:!loading, virtual:bridge});
        useStarredMessageJump({target, chatId:42, loading, rows, bridge, scrollRef:scroll.ref,
          scrollToMessage:index => {
            scroll.scrollToMessage(index);
            // A history refresh can land in the same frame as the jump.
            setRows(current => [...current]);
          }});
        return <>
          <button onClick={() => {
            setTarget({chatId:'42', messageId:'msg_40', requestId:Date.now()});
            setRestoring(true); setTimeout(() => setRestoring(false), 100);
          }}>Open saved message</button>
          <button onClick={() => setTarget({chatId:'42', messageId:'msg_180', requestId:Date.now()})}>Open another message</button>
          <main id="scroller" ref={scroll.ref} style={{height:480, width:600, overflowY:'auto', overflowAnchor:'none'}}>
            <div style={{paddingTop:20, paddingBottom:100}}>
              {!loading && <VirtualizedMessageList surface="starred-long" items={rows} getItemKey={key} estimateSize={estimate}
                renderItem={render} scrollRef={scroll.ref} bridge={bridge} gap={20} resetKey="42"/>}
            </div>
          </main>
        </>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
    ` },
    bundle:true, write:false, platform:"browser", format:"iife", jsx:"automatic",
    define:{"process.env.NODE_ENV":'"production"'},
  });
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  for (const [name, index] of [["Open saved message", 40], ["Open another message", 180], ["Open saved message", 40]]) {
    await page.getByRole('button', {name, exact:true}).click();
    const row = page.locator('#scroller [data-index="' + index + '"]');
    await expect(row).toHaveAttribute('data-starred-message-target', '', {timeout:1500});
    await expect(row).toBeFocused();
    const offset = () => row.evaluate(element => element.getBoundingClientRect().top - document.querySelector('#scroller').getBoundingClientRect().top);
    await expect.poll(offset, {timeout:1500}).toBeGreaterThanOrEqual(-2);
    await expect.poll(offset, {timeout:1500}).toBeLessThanOrEqual(24);
    await page.waitForTimeout(400);
    await expect.poll(offset).toBeGreaterThanOrEqual(-2);
    await expect.poll(offset).toBeLessThanOrEqual(24);
  }
  assert.deepEqual(errors, []);
});
