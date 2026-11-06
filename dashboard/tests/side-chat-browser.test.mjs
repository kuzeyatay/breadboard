import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");

test("workspace side chats send independently, discard on close, and reopen starred answers", { timeout: 120_000 }, async (t) => {
  const bundle = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    outdir: "side-chat-test-bundle",
    alias: { "@": path.join(root, "src") }, define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    loader: { ".wasm": "dataurl" },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import WorkspaceSideChat from '@/app/components/hermes/workspace-side-chat';
      import SideChatSurface from '@/app/components/side-chat-surface';
      import StarredMessagesPanel from '@/app/components/hermes/starred-messages-panel';
      import LinkContextMenu from '@/app/components/link-context-menu';
      import {isChatNotificationTargetViewed} from '@/lib/chat-notification-inbox';
      window.isViewed=id=>isChatNotificationTargetViewed({surface:'dashboard_terminal',chatId:id});
      const gardenSlug = new URLSearchParams(location.search).get('garden') || undefined;
      createRoot(document.getElementById('root')).render(<WorkspaceSideChat gardenSlug={gardenSlug} messages={[{role:'user',content:'Parent question'}, {role:'assistant',content:'Parent answer'}]}>
        <main style={{height:'100vh', padding:30}}>
          <SideChatSurface>
            <section aria-label="Messages" style={{minHeight:120,padding:20}}>
              <p id="selection">A workspace passage to discuss</p>
              <LinkContextMenu href="/example"><a href="/example">Existing link</a></LinkContextMenu>
            </section>
          </SideChatSurface>
          <textarea aria-label="Main chat draft" defaultValue="Keep this draft"/>
          <div style={{width:300,height:400}}><StarredMessagesPanel gardenSlug={gardenSlug} onOpenMessage={()=>{throw new Error('Side chat opened as main chat')}}/></div>
        </main>
      </WorkspaceSideChat>);
    ` },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, "utf8"), { from: stylesheet })).css;
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  const sessions = new Map();
  const creations = [];
  const turns = [];
  const discarded = [];
  let stars = [];
  let failClose = false;
  let delayCreation;
  await page.route("https://side-chat.test/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.method() === "POST" || req.method() === "PUT" ? req.postDataJSON() : null;
    if (url.pathname === "/api/hermes/sessions" && req.method() === "POST") {
      creations.push(body);
      const id = `conv_side_${creations.length}`;
      const session = { id, title: "Side chat", surface: body.surface, messages: [], temporary: true, gardenId: body.gardenSlug ?? null };
      sessions.set(id, session);
      if (delayCreation) await delayCreation;
      return route.fulfill({ json: { session } });
    }
    const direct = url.pathname.match(/^\/api\/hermes\/sessions\/([^/]+)\/direct$/);
    if (direct) {
      turns.push(body);
      const session = sessions.get(direct[1]);
      session.messages.push({ id: `msg_${turns.length * 2}`, clientMessageId: body.clientMessageId, role: "user", content: body.text },
        { id: `msg_${turns.length * 2 + 1}`, clientMessageId: body.clientMessageId, role: "assistant", content: "Side answer from the model", status: "completed" });
      return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"delta","text":"Side answer from the model"}\n\ndata: [DONE]\n\n' });
    }
    const sessionPath = url.pathname.match(/^\/api\/hermes\/sessions\/([^/]+)$/);
    if (sessionPath) {
      const id = sessionPath[1];
      if (req.method() === "DELETE") {
        if (failClose) return route.fulfill({ status: 500, json: { error: "Try again" } });
        assert.equal(url.searchParams.get("discardSideChat"), "1");
        discarded.push(id);
        const retained = stars.some(star => star.conversationId === id);
        if (!retained) sessions.delete(id);
        return route.fulfill({ json: { retained, deleted: !retained } });
      }
      return route.fulfill({ json: { session: sessions.get(id) } });
    }
    if (url.pathname === "/api/starred-messages") {
      if (req.method() === "PUT") {
        const session = sessions.get(body.conversationId);
        const message = session.messages.find(m => m.role === "assistant" && (m.id === body.messageId || m.clientMessageId === body.messageId));
        stars = body.starred ? [{ conversationId: session.id, chatId: session.id, messageId: message.id, clientMessageId: message.clientMessageId,
          title: "Side chat", preview: message.content, gardenSlug: session.gardenId, starredAt: "2026-10-05", sideChat: true }] : [];
      }
      if (url.searchParams.has("message")) return route.fulfill({ json: { message: { messageId: stars[0].messageId, content: stars[0].preview } } });
      return route.fulfill({ json: { messages: stars } });
    }
    if (url.pathname === "/api/assistant-preferences") return route.fulfill({ json: { model: "gpt-5.6-sol", reasoningEffort: "medium", agentMode: false, superAgent: false } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { sessions: [], artifacts: [], highlights: [], bots: [], models: ["gpt-5.6-sol"], capabilities: [], modelsHealth: {} } });
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
  });
  async function load(query = "") {
    await page.goto(`https://side-chat.test/${query}`);
    await page.evaluate(() => {
      localStorage.setItem("breadboard:agent-mode", "false");
      localStorage.setItem("breadboard-active-conversation", "conv_main");
      localStorage.setItem("breadboard-active-conversation:dashboard_terminal:global", "conv_main");
    });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
  }
  const panel = page.getByRole("dialog", { name: "Side chat", exact: true });
  const confirmation = page.getByRole("alertdialog", { name: "Are you sure?" });
  async function confirmClose() {
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("This chat is temporary. You can star a message to keep it.");
    await confirmation.getByRole("button", { name: "Close chat", exact: true }).click();
  }
  async function start(target = page.getByRole("region", { name: "Messages", exact: true })) {
    await target.click({ button: "right", position: { x: 8, y: 8 } });
    await page.getByRole("menuitem", { name: "Start side chat", exact: true }).click();
    await expect(panel).toBeVisible();
  }
  async function send() {
    const composer = panel.locator("textarea").first();
    await expect(composer).toBeFocused();
    await composer.fill("Explain this passage");
    await composer.press("Enter");
    await expect(panel.getByText("Side answer from the model", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Star message", exact: true })).toBeEnabled();
  }
  await load();
  await start();
  await expect(panel.locator("header")).toHaveText("Side chat");
  await expect(panel.locator("blockquote")).toHaveCount(0);
  await expect(panel.getByText("User: Parent question", { exact: false })).toHaveCount(0);
  await send();
  assert.equal(creations[0].sideChat, true);
  assert.equal(creations[0].temporary, true);
  assert.equal(creations[0].restoreLastConversation, false);
  assert.equal(turns[0].textSelection.quote, "User: Parent question\n\nAssistant: Parent answer");
  await expect(page.getByLabel("Main chat draft")).toHaveValue("Keep this draft");
  await panel.getByRole("button", { name: "Close side chat" }).click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  assert.equal(discarded.length, 0);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(panel.getByText("Side answer from the model", { exact: true })).toBeVisible();
  assert.equal(discarded.length, 0);
  failClose = true;
  await panel.getByRole("button", { name: "Close side chat" }).click();
  await confirmClose();
  await expect(panel.getByRole("alert")).toContainText("Could not close");
  failClose = false;
  await panel.getByRole("button", { name: "Close side chat" }).click();
  await confirmClose();
  await expect(panel).toHaveCount(0);
  assert.equal(sessions.size, 0);
  await start(page.getByRole("link", { name: "Existing link" }));
  await panel.getByRole("button", { name: "Close side chat" }).click();
  await confirmClose();
  // Capture the selection before the context menu takes focus.
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.getElementById("selection"));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  });
  await start(page.locator("#selection"));
  await expect(panel.locator("blockquote")).toHaveCount(0);
  await expect(panel.getByText("A workspace passage to discuss", { exact: true })).toHaveCount(0);
  await send();
  assert.equal(turns.at(-1).textSelection.quote, "A workspace passage to discuss");
  await panel.getByRole("button", { name: "Star message", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Unstar message", exact: true })).toBeEnabled();
  await expect(panel.locator("header")).toHaveText("Side chat");
  if (process.env.BREADBOARD_SIDE_CHAT_SCREENSHOT) await page.screenshot({ path: process.env.BREADBOARD_SIDE_CHAT_SCREENSHOT });
  const savedId = stars[0].conversationId;
  assert.equal(await page.evaluate(id => window.isViewed(id), savedId), true);
  await panel.getByRole("button", { name: "Close side chat" }).click();
  await expect(panel).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);
  assert.ok(sessions.has(savedId));
  assert.equal(await page.evaluate(id => window.isViewed(id), savedId), false);
  const savedRow = page.getByRole("button", { name: /Side chat Side answer/ });
  await savedRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Go to chat" }).click();
  await expect(panel.getByText("Side answer from the model", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(id => window.isViewed(id), savedId), true);
  assert.equal(await page.evaluate(() => localStorage.getItem("breadboard-active-conversation")), "conv_main");
  assert.equal(await page.evaluate(() => localStorage.getItem("breadboard-active-conversation:dashboard_terminal:global")), "conv_main");
  await panel.getByRole("button", { name: "Unstar message", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Star message", exact: true })).toBeEnabled();
  await panel.locator("textarea").first().press("Escape");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(panel).toBeVisible();
  await panel.locator("textarea").first().press("Escape");
  await confirmClose();
  await expect(panel).toHaveCount(0);
  assert.ok(!sessions.has(savedId));
  await load("?garden=physics");
  await start();
  await send();
  assert.equal(creations.at(-1).surface, "garden_chat");
  assert.equal(creations.at(-1).gardenSlug, "physics");
  await panel.getByRole("button", { name: "Star message", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Unstar message", exact: true })).toBeEnabled();
  const gardenStar = stars[0];
  await panel.getByRole("button", { name: "Close side chat" }).click();
  await load(`?garden=physics&sideChat=${gardenStar.conversationId}&message=${gardenStar.messageId}`);
  await expect(panel.getByText("Side answer from the model", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 700 });
  const bounds = await panel.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 700);
  await panel.getByRole("button", { name: "Close side chat" }).click();
  // Closing while the first create request is in flight must not leak a chat.
  let release;
  delayCreation = new Promise(resolve => { release = resolve; });
  await start();
  await panel.locator("textarea").first().fill("Close while creating");
  await panel.locator("textarea").first().press("Enter");
  await expect.poll(() => creations.length).toBe(4);
  await panel.getByRole("button", { name: "Close side chat" }).click();
  await confirmClose();
  await expect(panel).toHaveCount(0);
  release();
  await expect.poll(() => discarded.includes("conv_side_4")).toBe(true);
  assert.deepEqual(errors, []);
});
