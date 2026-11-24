import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compile } from "tailwindcss";

test("a goal handoff streams the second response and retains a colliding follow-up", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAgentSession, isActiveAgentRunState} from './src/app/components/hermes/use-agent-session';
      import {useQueuedFollowUps} from './src/app/components/hermes/queued-follow-ups';
      import GoalCard from './src/app/components/hermes/goal-card';
      import ActivityPanel from './src/app/components/hermes/activity-panel';
      import {readFollowUps} from './src/lib/chat-follow-up-queue';
      function Chat() {
        const chat = useAgentSession('dashboard_terminal', {pageSlug: 'goal-test'});
        window.chat = chat;
        window.queued = () => readFollowUps(chat.sessionId);
        useQueuedFollowUps({
          conversationKey: chat.sessionId,
          runInFlight: chat.loadingSession || isActiveAgentRunState(chat.runState), steerableRunActive: false,
          onRestoreDraft: () => {}, onSendQueued: (text, attachments, textSelection) =>
            chat.send(text, {attachments, textSelection}),
        });
        const last = chat.messages.filter(row => row.role === 'assistant').at(-1);
        return <><main>{chat.messages.filter(row => !row.internalAgentContinuation).map(row =>
          <p key={row.id}>{row.content}</p>)}</main>
          {last && <ActivityPanel activities={chat.activities} connection={chat.connection}
            reasoning={last.reasoning} answerContent={last.content} responseStartedAt={last.responseStartedAt}
            responseCompletedAt={last.responseCompletedAt} pendingPermission={null} onPermissionDecision={() => {}} />}
          <footer>{chat.sessionId && <GoalCard sessionId={chat.sessionId} refreshKey={chat.runState}/>}
          <textarea aria-label="Message"/></footer></>;
      }
      createRoot(document.getElementById('root')).render(<Chat/>);
    ` },
    jsx: "automatic", bundle: true, write: false, platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "unrelated-artifacts", setup(builder) {
      builder.onResolve({ filter: /^\.\/inline-artifact-cards$/ }, () => ({ path: "cards", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const primeInlineArtifacts = async () => [];" }));
    } }],
  });
  const sourceCss = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const shimmer = sourceCss.slice(sourceCss.indexOf("@keyframes thinking-shimmer"), sourceCss.indexOf("@keyframes thinking-token-arrow-down"));
  const theme = readFileSync(new URL("../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  const utilities = (await compile(theme + "\n@tailwind utilities;")).build(["mb-2", "flex", "min-h-9", "h-4", "w-4", "h-6", "w-6"]);
  const sessionId = "conv_fixture_goal";
  const turnId = "goal:fixture:second";
  const startedAt = new Date(Date.now() - 8000).toISOString();
  const first = [{ id: "u1", role: "user", content: "Check my project" }, { id: "a1", role: "assistant", content: "First answer" }];
  const second = [{ id: "u2", role: "user", clientMessageId: turnId, goalContinuation: true, internalAgentContinuation: true, content: "Continue" },
    { id: "a2", role: "assistant", clientMessageId: turnId, goalContinuation: true, responseStartedAt: startedAt, createdAt: startedAt }];
  let phase = "first";
  let posts = 0;
  let stream;
  let userStream;
  const accepted = [];
  let attachments = 0;
  const frame = (type, payload = {}) => "data: " + JSON.stringify({ type, payload }) + "\n\n";
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = data => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
    if (url.pathname === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
    else if (url.pathname === "/") res.end('<!doctype html><style>' + utilities + shimmer +
      'footer{position:fixed;bottom:0;left:0;right:0} textarea{display:block}</style><div id="root"></div><script src="/bundle.js"></script>');
    else if (url.pathname === "/api/hermes/sessions") json({ sessions: [{ id: sessionId, pageSlug: "goal-test" }] });
    else if (url.pathname.endsWith("/messages") && req.method === "POST") {
      posts++;
      if (phase !== "done") {
        phase = "second"; res.statusCode = 409; json({ code: "conversation_turn_active" });
      } else {
        const parts = [];
        for await (const part of req) parts.push(part);
        const message = JSON.parse(Buffer.concat(parts)).text;
        accepted.push(message);
        json({ accepted: true, runId: "reply-" + posts });
        userStream.end(frame("assistant.delta", {text: "Received " + message}) + frame("done"));
      }
    } else if (url.pathname.endsWith("/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(": connected\n\n");
      if (url.searchParams.get("runId") === "run-two") {
        attachments++; stream = res;
        res.write(frame("reasoning.status", { label: "Checking the project", detail: "Inspecting the exported project." }));
      } else userStream = res;
    } else if (url.pathname.endsWith("/goal")) json({
      goal: { goalId: "fixture", objective: "Check my project", status: phase === "done" ? "complete" : "active",
        createdAt: startedAt, updatedAt: startedAt, turnsUsed: 1, tokensUsed: 9, timeUsedSeconds: 8 },
      turn: phase === "first" ? null : { clientMessageId: turnId, status: phase === "done" ? "complete" : "pending" },
    });
    else if (url.pathname.endsWith("/" + sessionId)) json({ session: { id: sessionId, pageSlug: "goal-test",
      messages: phase === "first" ? first : [...first, second[0], { ...second[1], pending: phase === "second",
        status: phase === "second" ? "pending" : "complete", content: phase === "done" ? "Second answer" : "" }],
      activeRun: phase === "second" ? { id: "run-two", instruction: "Continue", clientMessageId: turnId, startedAt } : null,
    } });
    else json({});
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    page.setDefaultTimeout(6500);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByText("First answer", { exact: true }).waitFor();
    for (const width of [1280, 420]) {
      await page.setViewportSize({ width, height: 700 });
      await page.locator("[data-goal-card]").waitFor();
      assert.equal(await page.evaluate(() => document.querySelector("textarea").getBoundingClientRect().top -
        document.querySelector("[data-goal-card]").getBoundingClientRect().bottom), 8);
    }
    // The scheduler takes the slot between the click and the dispatch acknowledgment.
    await page.evaluate(() => { void window.chat.send("Mendix is installed"); });
    await page.locator('[data-response-state="active"] .thinking-shimmer').getByText("Checking the project").waitFor();
    assert.deepEqual(await page.evaluate(() => window.queued().map(row => row.text)), ["Mendix is installed"]);
    await page.evaluate(() => window.chat.send("Use the existing project"));
    const label = page.locator(".thinking-shimmer");
    assert.equal(await label.evaluate(el => getComputedStyle(el).animationName), "thinking-shimmer");
    const meta = page.locator('[data-response-state="active"]');
    const clock = await meta.innerText();
    await page.waitForFunction(previous => document.querySelector('[data-response-state="active"]').innerText !== previous, clock);
    await meta.getByRole("button").click();
    await page.getByText("Inspecting the exported project.", { exact: true }).waitFor();
    // Reload the chat while its automatic response still owns the slot.
    await page.reload();
    await page.getByText("Checking the project", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.queued().map(row => row.text)), ["Mendix is installed", "Use the existing project"]);
    phase = "done";
    stream.end(frame("assistant.delta", { text: "Second answer" }) + frame("done"));
    await page.getByText("Second answer", { exact: true }).waitFor();
    await page.locator('[data-response-state="complete"]').waitFor();
    await page.getByText("First answer", { exact: true }).waitFor();
    await page.getByText("Received Use the existing project", {exact: true}).waitFor();
    assert.deepEqual(accepted, ["Mendix is installed", "Use the existing project"]);
    assert.equal(posts, 3); assert.equal(attachments, 2); assert.deepEqual(errors, []);
    // With an idle viewer, focus the goal card after a detached turn has begun.
    phase = "first";
    await page.reload(); await page.getByText("First answer", { exact: true }).waitFor();
    await page.locator("[data-goal-card]").waitFor();
    phase = "second";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("Checking the project", { exact: true }).waitFor();
    assert.equal(posts, 3); assert.equal(attachments, 3);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
