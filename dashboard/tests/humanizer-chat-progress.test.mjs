import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await esbuild.build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { useAutoHumanize, applyAutoHumanizeOutcome } from "@/app/components/humanizer/use-auto-humanize";
      import ActivityPanel from "@/app/components/hermes/activity-panel";
      import AssistantMessageActions from "@/app/components/assistant-message-actions";
      import { messageRewriteReview } from "@/app/components/humanizer/rewrite-status";
      const root = createRoot(document.getElementById("root"));
      window.messages = [];
      function Harness(props) {
        const progress = useAutoHumanize({ ...props, onComplete(message, outcome) {
          window.messages = applyAutoHumanizeOutcome(window.messages, message, outcome);
          window.renderChat({ ...window.props, messages: window.messages });
        }});
        const answer = props.messages.findLast(m => m.role === "assistant");
        return answer ? <><ActivityPanel activities={[]} connection={props.active ? "streaming" : "idle"}
          pendingPermission={null} onPermissionDecision={() => {}} answerContent={answer.content}
          responseDurationMs={5000} progressNotes={["I’m explaining charge and fields."]} /><p data-answer>{answer.content}</p>
          <AssistantMessageActions content={answer.content} humanizerReview={messageRewriteReview(answer)}
            naturalRewrite={progress(answer)}
            branch={{ current: 1, total: 2, onPrevious() {}, onNext() {} }} /></> : null;
      }
      window.renderChat = props => {
        window.props = props; window.messages = props.messages;
        flushSync(() => root.render(<Harness {...props} />));
      };
    `,
    loader: "jsx", resolveDir: root,
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@": path.join(root, "src") }, logLevel: "silent",
});

let browser;
before(async () => {
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"]
    .find(candidate => candidate && fs.existsSync(candidate));
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); });

const messages = [
  { role: "user", clientMessageId: "turn-charge-question", content: "i am still confused, what is charge and what is a magnbetic field" },
  { role: "assistant", clientMessageId: "turn-charge-question", content: "Original explanation of charge and magnetic fields." },
];
const candidate = { rewrittenText: "Natural explanation.", unchanged: false,
  scores: { original: { score: 20 }, rewrite: { score: 5 }, delta: -15, tied: false, worsened: false },
  integrity: { passed: true, issues: [] } };
const versions = { total: 2, activeIndex: 1, derived: true, origins: ["original", "humanizer"] };

async function setup(t, { enabled = true, response = candidate, status = 200, holdSave = false, saveStatus = 200 } = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  if (!holdSave) releaseSave();
  t.after(() => { release(); releaseSave(); });
  const calls = [];
  await page.route("http://rewrite.test/**", async route => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    if (url === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    calls.push({ url, body: request.postDataJSON() });
    if (url === "/api/humanizer/rewrite") {
      await gate;
      await route.fulfill({ status, json: response }).catch(() => {});
    } else if (url === "/api/humanizer/versions") {
      await saveGate;
      await route.fulfill({ status: saveStatus, json: { content: response.rewrittenText, versions } }).catch(() => {});
    } else await route.fulfill({ json: {} });
  });
  await page.goto("http://rewrite.test/");
  await page.evaluate(enabled => localStorage.setItem("breadboard:humanizer-mode", String(enabled)), enabled);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const render = async (active, currentMessages = messages, conversationId = "conv_charge") => {
    await page.evaluate(props => window.renderChat(props), { active, messages: currentMessages, conversationId });
  };
  return { page, calls, release, releaseSave, render };
}

test("the original stays visible until the rewrite is saved, with separate status beside More actions", async t => {
  const { page, calls, release, releaseSave, render } = await setup(t, { holdSave: true });
  await page.clock.install();
  await render(true);
  assert.equal(calls.length, 0, "do not rewrite the unfinished response");
  await render(false);
  const status = page.getByLabel("Assistant response actions").getByRole("status");
  await status.getByText("Writing naturally…", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-answer]").innerText(), messages[1].content);
  assert.equal(await status.evaluate(node => node.previousElementSibling.querySelector("button")?.getAttribute("aria-label")), "More response actions");
  const meta = page.locator(".assistant-response-meta");
  assert.equal(await meta.getAttribute("data-response-state"), "complete");
  const completedMetrics = await meta.innerText();
  assert.match(completedMetrics, /^Thought.*5s/);
  await page.clock.fastForward(5000);
  assert.equal(await meta.innerText(), completedMetrics, "rewriting must not extend the response timer");
  await page.getByRole("button", { name: /^Thought/ }).click();
  const thinking = page.getByRole("list", { name: "Thinking updates" });
  assert.equal(await thinking.innerText(), "I’m explaining charge and fields.");
  await render(false, [...messages]);
  assert.equal(calls.length, 1, "transcript rerenders must not cancel or duplicate rewriting");
  const saving = page.waitForRequest("**/api/humanizer/versions");
  release();
  await saving;
  assert.equal(await page.locator("[data-answer]").innerText(), messages[1].content, "the candidate is not shown before it is saved");
  assert.equal(await status.innerText(), "Writing naturally…");
  releaseSave();
  await page.getByText(candidate.rewrittenText, { exact: true }).waitFor();
  assert.equal(await thinking.innerText(), "I’m explaining charge and fields.");
  assert.equal(await meta.innerText(), completedMetrics);
  assert.deepEqual(calls.map(call => call.url), ["/api/humanizer/rewrite", "/api/humanizer/versions"]);
  assert.equal(calls[1].body.messageId, messages[1].clientMessageId);
  assert.equal(calls[1].body.expectedContent, messages[1].content);
  assert.equal(await page.evaluate(() => window.messages[0].content), messages[0].content);
  assert.match(await page.getByLabel("Assistant response actions").innerText(), /Style score 20 → 5/);
});

test("disabled switches and reopened history do not request a rewrite", async t => {
  const off = await setup(t, { enabled: false });
  await off.render(true); await off.render(false);
  const history = await setup(t);
  await history.render(false);
  await history.render(true);
  await history.render(false, messages, "conv_different_history");
  assert.equal(off.calls.length, 0);
  assert.equal(history.calls.length, 0);
});

test("an unavailable rewriter explains the failure and preserves the answer", async t => {
  const { page, calls, release, render } = await setup(t, { status: 503, response: { error: "unavailable" } });
  await render(true); await render(false);
  await page.getByLabel("Assistant response actions").getByText("Writing naturally…", { exact: true }).waitFor();
  release();
  await page.getByLabel("Assistant response actions").getByText("The local rewriter is unavailable. Original answer kept.", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-answer]").innerText(), messages[1].content);
  assert.equal(calls.length, 1);
  assert.equal(await page.locator('[data-response-state="active"]').count(), 0);
});

test("turning the switch off cancels pending rewriting without adopting a version", async t => {
  const { page, calls, release, render } = await setup(t);
  const reviewed = [messages[0], { ...messages[1], humanizerReview: {
    original: 0, rewrite: 0, delta: 0, tied: true, worsened: false, adopted: false, disposition: "kept_tied",
  } }];
  await render(true, reviewed); await render(false, reviewed);
  await page.getByLabel("Assistant response actions").getByText("Writing naturally…", { exact: true }).waitFor();
  await page.evaluate(() => {
    localStorage.setItem("breadboard:humanizer-mode", "false");
    window.dispatchEvent(new Event("breadboard:humanizer-mode-change"));
  });
  await page.getByLabel("Assistant response actions").getByText("Natural rewrite cancelled. Original answer kept.", { exact: true }).waitFor();
  release();
  assert.equal(await page.locator("[data-answer]").innerText(), messages[1].content);
  assert.equal(calls.length, 1);
});

test("late rewrite completion preserves edits and newer turns", async t => {
  const { page, release, render } = await setup(t);
  await render(true); await render(false);
  await page.getByLabel("Assistant response actions").getByText("Writing naturally…", { exact: true }).waitFor();
  const newer = [...messages.slice(0, 1), { ...messages[1], content: "Edited explanation." },
    { role: "user", clientMessageId: "next-turn-123", content: "What produces the field?" }];
  await render(true, newer);
  release();
  await page.waitForFunction(() => document.body.innerText.includes("Rewritten naturally"));
  assert.deepEqual(await page.evaluate(() => window.messages), newer);
});

test("every transcript owner shows rewriting in its action row, separately from Thinking", () => {
  for (const file of ["src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/garden/garden-assistant.tsx", "src/app/gardens/[clusterSlug]/workspace-client.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /useAutoHumanize\(/, file);
    assert.match(source, /<AssistantMessageActions\b(?:(?!\/>)[\s\S])*naturalRewrite=/, file);
    assert.doesNotMatch(source, /<ActivityPanel\b(?:(?!\/>)[\s\S])*naturalRewrite=/, file);
    assert.match(source, /applyAutoHumanizeOutcome\(/, file);
    assert.match(source, /humanizerReview=\{messageRewriteReview\(/, file);
  }
});

test("a failed save keeps the complete original and reports the failure below it", async t => {
  const { page, release, render } = await setup(t, { saveStatus: 409 });
  await render(true); await render(false); release();
  await page.getByLabel("Assistant response actions").getByText("The natural rewrite could not be saved. Original answer kept.", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-answer]").innerText(), messages[1].content);
  assert.equal(await page.locator('[data-response-state="active"]').count(), 0);
});

test("server-side cancellation uses the same cancellation status and keeps the original", async t => {
  const { page, release, render, calls } = await setup(t, { status: 409, response: { code: "cancelled" } });
  await render(true); await render(false); release();
  await page.getByLabel("Assistant response actions").getByText("Natural rewrite cancelled. Original answer kept.", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-answer]").innerText(), messages[1].content);
  assert.equal(calls.length, 1);
});

test("a declined rewrite displays both scores and explicitly keeps the original", async t => {
  const response = { ...candidate, scores: { original: { score: 0 }, rewrite: { score: 0 }, delta: 0, tied: true, worsened: false } };
  const { page, release, render, calls } = await setup(t, { response });
  await render(true); await render(false); release();
  await page.getByLabel("Assistant response actions").getByText("Style score 0 → 0 · original kept").waitFor();
  assert.equal(await page.locator("[data-answer]").innerText(), messages[1].content);
  assert.equal(calls.length, 1);
});

test("a restored garden message displays its persisted version score", async t => {
  const { page, render, calls } = await setup(t);
  const restored = [...messages.slice(0, 1), { ...messages[1], content: candidate.rewrittenText,
    contentVersions: { ...versions, review: { original: 20, rewrite: 5, delta: -15, tied: false, worsened: false } } }];
  await render(false, restored);
  await page.getByLabel("Assistant response actions").getByText("Style score 20 → 5").waitFor();
  assert.equal(calls.length, 0);
});
