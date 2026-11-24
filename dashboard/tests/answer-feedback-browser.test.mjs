import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

test("feedback on a Garden answer reaches the next turn and can be changed or removed", { timeout: 60_000 }, async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const directory = mkdtempSync(path.join(os.tmpdir(), "breadboard-feedback-test-"));
  const previousDirectory = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = directory;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === "@/lib/server-auth") return { shortCircuit: true, url: "data:text/javascript," +
      "export const requireUserId=async()=>1; export class RouteError extends Error{}; export function routeErrorResponse(e){throw e}" };
    if (specifier === "next/server") return next("next/server.js", context);
    if (specifier.startsWith("@/")) return next(new URL("../src/" + specifier.slice(2), import.meta.url).href, context);
    return next(specifier, context);
  } });
  const { default: db } = await import("../src/lib/db.ts");
  t.after(() => {
    hooks.deregister();
    db.close();
    if (previousDirectory === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  });
  const store = await import("../src/lib/conversations/store.ts");
  const api = await import("../src/app/api/answer-signals/route.ts");
  const { answerFeedbackContext } = await import("../src/lib/hermes/answer-signals.ts");
  db.exec(`
    INSERT INTO users(id, username, email, password_hash) VALUES (1,'reader','reader@example.test','x');
    INSERT INTO clusters(id, user_id, name, slug) VALUES (1,1,'Garden','garden');
    INSERT INTO chat_sessions(id, cluster_id, user_id, title) VALUES (42,1,1,'Feedback');
  `);
  const chat = store.ensureConversationForLegacyChatSession(42, 1);
  const messageId = "client-answer-test";
  const { assistantMessage } = store.reserveConversationTurn({
    conversation: chat, clientMessageId: messageId, surface: "garden_chat", content: "How do I start?",
  });
  // Seed a completed answer without launching the chat-completion hooks.
  db.prepare("UPDATE conversation_messages SET status = 'complete', content = ? WHERE id = ?").run("Measure twice.", assistantMessage.id);
  const answer = store.getConversationMessageById(assistantMessage.id);
  const bundle = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") }, stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import AssistantMessageActions, {MessageActionsSlot} from './src/app/components/assistant-message-actions';
      createRoot(document.querySelector('main')).render(
        <MessageActionsSlot conversationId={location.hash ? '${chat.public_id}' : '42'}
          messageId={location.hash ? 'msg_${answer.id}' : '${messageId}'} canStar={false}>
          <AssistantMessageActions content="Measure twice."/>
        </MessageActionsSlot>);
    ` } });
  const cssPath = path.join(root, "src/app/globals.css");
  const css = (await postcss([tailwindcss({ base: root })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 400 } });
  let failWrite = false;
  await page.route("http://feedback.test/**", async route => {
    const request = route.request();
    if (request.url().includes("/api/answer-signals")) {
      const method = request.method();
      if (failWrite && method === "POST") return route.fulfill({ status: 503, json: {} });
      const response = await api[method](new Request(request.url(), { method, body: request.postData() }));
      return route.fulfill({ status: response.status, json: await response.json() });
    }
    if (request.url().includes("/api/")) return route.fulfill({ json: {} });
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><body><main style="margin:30px 8px"></main></body></html>' });
  });
  const mount = async () => {
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  };
  await page.goto("http://feedback.test/");
  await mount();
  const trigger = page.getByRole("button", { name: "Response feedback" });
  const good = page.getByRole("menuitemcheckbox", { name: "Good response" });
  const bad = page.getByRole("menuitemcheckbox", { name: "Bad response" });
  const menu = page.getByRole("menu");
  await trigger.click();
  await expect(good).toBeVisible();
  await expect(bad).toBeVisible();
  const anchor = await trigger.boundingBox(), popup = await menu.boundingBox();
  assert.equal(popup.width, 168);
  assert.equal(popup.height, 84);
  assert.ok(Math.abs(popup.x - anchor.x) < 1 && popup.y >= anchor.y + anchor.height);
  await expect(menu).toHaveCSS("background-color", "rgb(41, 41, 41)");
  if (process.env.BREADBOARD_FEEDBACK_PREVIEW) await page.screenshot({ path: process.env.BREADBOARD_FEEDBACK_PREVIEW });
  await good.click();
  await expect(trigger).toHaveAccessibleDescription("Good response");
  assert.match(answerFeedbackContext(chat, [answer]), /helpful/);
  await page.goto("http://feedback.test/?restored#restored");
  await mount();
  await expect(trigger).toHaveAccessibleDescription("Good response");
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(good).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(bad).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Incorrect information" })).toBeFocused();
  await page.getByRole("menuitem", { name: "Too long" }).click();
  await expect(trigger).toHaveAccessibleDescription("Bad response");
  await expect(menu).toHaveCount(0);
  assert.match(answerFeedbackContext(chat, [answer]), /concise/);
  await trigger.click();
  failWrite = true;
  await good.click();
  await expect(menu.getByRole("alert")).toContainText("Try again");
  await expect(bad).toBeChecked();
  failWrite = false;
  await bad.click();
  await expect(menu).toHaveCount(0);
  assert.equal(answerFeedbackContext(chat, [answer]), "");
});
