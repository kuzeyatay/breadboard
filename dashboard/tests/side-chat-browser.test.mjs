import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
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
      import {readNotificationViewTargets} from '@/lib/notification-view-presence';
      window.isViewed=id=>readNotificationViewTargets().some(target=>target.surface==='dashboard_terminal' && target.chatId===id);
      const gardenSlug = new URLSearchParams(location.search).get('garden') || undefined;
      createRoot(document.getElementById('root')).render(<WorkspaceSideChat gardenSlug={gardenSlug} messages={[{role:'user',content:'Parent question'}, {role:'assistant',content:'Parent answer'}]}>
        <main style={{height:'100vh', padding:30}}>
          <div id="page-pixels" style={{position:'fixed',right:60,top:120,width:30,height:30,background:'rgb(240,0,180)'}} />
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
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { sessions: [], artifacts: [], highlights: [], bots: [], groups: { skills: [], mcp: [], prompts: [], agents: [] }, models: ["gpt-5.6-sol"], capabilities: [], modelsHealth: {} } });
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
  await expect(panel.locator("header")).toHaveText("0: Side chat");
  await expect(panel.locator("blockquote")).toHaveCount(0);
  await expect(panel.getByText("User: Parent question", { exact: false })).toHaveCount(0);
  await send();
  assert.equal(creations[0].sideChat, true);
  assert.equal(creations[0].temporary, true);
  assert.equal(creations[0].restoreLastConversation, false);
  assert.equal(turns[0].textSelection.quote, "User: Parent question\n\nAssistant: Parent answer");
  assert.equal(turns[0].textSelection.sourceMessageId, "side-chat-context");
  const assertViewPixel = async (turn, expected) => {
    const view = turn.attachments.find(item => item.context === "workspace");
    assert.ok(view?.dataUrl.startsWith("data:image/jpeg;base64,"));
    const pixel = await sharp(Buffer.from(view.dataUrl.split(",")[1], "base64"))
      .extract({left:1205,top:135,width:1,height:1}).removeAlpha().raw().toBuffer();
    assert.ok(expected.every((channel, i) => Math.abs(channel - pixel[i]) < 10), `workspace pixel was ${[...pixel]}`);
  };
  await assertViewPixel(turns[0], [240, 0, 180]);
  await expect(page.getByRole("navigation", { name: "Side chats" }).locator('[aria-current="true"]')).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(panel.getByText("Current Breadboard view.jpg", {exact:true})).toHaveCount(0);
  // The main-chat snapshot is model context, not a quote on the first message.
  await expect(panel.getByText("Selected text:", { exact: false })).toHaveCount(0);
  await expect(panel.locator("header")).toHaveText("0: Explain this passage");
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
  await page.locator("#page-pixels").evaluate(node => { node.style.backgroundColor = "rgb(15, 140, 70)"; });
  await expect(panel.locator("blockquote")).toHaveCount(0);
  await expect(panel.getByText("A workspace passage to discuss", { exact: true })).toHaveCount(0);
  await send();
  assert.equal(turns.at(-1).textSelection.quote, "A workspace passage to discuss");
  await assertViewPixel(turns.at(-1), [15, 140, 70]);
  await expect(panel.getByText("Selected text:", { exact: false })).toHaveCount(1);
  await panel.getByRole("button", { name: "Star message", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Unstar message", exact: true })).toBeEnabled();
  await expect(panel.locator("header")).toHaveText("0: Explain this passage");
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
  await page.evaluate(() => { window.breadboardDesktop = { captureWorkspaceView: async () => null }; });
  await send();
  assert.ok(turns.at(-1).attachments.some(item => item.context === "workspace" && item.type === "text" && item.text.includes("unavailable")));
  await expect(panel.getByText("The workspace view was unavailable for this question.", { exact: true })).toBeVisible();
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

  // Up to four side chats tile like tmux panes inside one resizable dock.
  await page.setViewportSize({ width: 1280, height: 900 });
  const panes = page.getByRole("dialog", { name: "Side chat", exact: true });
  const bar = page.getByRole("navigation", { name: "Side chats" });
  await start();
  await page.getByRole("button", { name: "New side chat" }).click();
  await expect(panes).toHaveCount(2);
  await expect(bar).toContainText("2/4");
  await bar.getByRole("button", { name: "New side chat" }).click();
  await bar.getByRole("button", { name: "New side chat" }).click();
  await expect(panes).toHaveCount(4);
  await expect(bar.getByRole("button", { name: "New side chat" })).toBeDisabled();
  await page.getByRole("region", { name: "Messages", exact: true }).click({ button: "right", position: { x: 8, y: 8 } });
  await page.getByRole("menuitem", { name: "Start side chat", exact: true }).click();
  await expect(bar).toContainText("Close one to start another");
  await expect(panes).toHaveCount(4);
  const boxes = await Promise.all([0, 1, 2, 3].map(index => panes.nth(index).boundingBox()));
  assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2 && boxes[0].x < boxes[1].x, "panes 0 and 1 share the top row");
  assert.ok(boxes[2].y > boxes[0].y + 50 && Math.abs(boxes[0].x - boxes[2].x) < 2, "pane 2 sits under pane 0");
  const panesBefore = page.locator("[data-side-chat-pane]");
  await panes.nth(3).locator("textarea").first().focus();
  await expect(bar.getByRole("button", { name: /^3:/ })).toHaveAttribute("aria-current", "true");
  const dock = page.locator("[data-side-chat-dock]");
  const handle = page.getByRole("separator", { name: "Resize side chat" });
  const before = await dock.boundingBox();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 2, grip.y + 200);
  await page.mouse.down();
  await page.mouse.move(grip.x - 150, grip.y + 200, { steps: 5 });
  await page.mouse.up();
  const after = await dock.boundingBox();
  assert.ok(after.width > before.width + 100, `dock widened from ${before.width} to ${after.width}`);
  assert.equal(await page.evaluate(() => localStorage.getItem("breadboard:side-chat:width")), String(Math.round(after.width)));
  await expect(panesBefore).toHaveCount(4);
  // Empty panes close without a prompt once confirmed; closing one keeps the rest.
  await panes.nth(1).getByRole("button", { name: "Close side chat" }).click();
  await confirmClose();
  await expect(panes).toHaveCount(3);
  const three = await Promise.all([0, 1, 2].map(index => panes.nth(index).boundingBox()));
  assert.ok(three[0].height > three[1].height * 1.8, "with three panes the first spans both rows");
  assert.deepEqual(errors, []);
});
