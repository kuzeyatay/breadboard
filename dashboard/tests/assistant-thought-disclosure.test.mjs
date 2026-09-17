import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { noisyThinking, progressNotes as pdfProgressNotes, thinkingHeadings } from "./fixtures/assistant-thinking.mjs";

const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const bundle = await esbuild.build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import ActivityPanel from "@/app/components/hermes/activity-panel";
      import InlineDeepResearchRun from "@/app/components/hermes/inline-deep-research-run";
      import ChatMarkdown from "@/app/components/chat-markdown";
      import { assistantVisibleContent } from "@/lib/hermes/assistant-visible-content";
      import { delegatedThinkingUpdates } from "@/lib/hermes/super-agent-activity";
      const root = createRoot(document.getElementById("root"));
      window.renderPanels = (panels) => flushSync(() => root.render(
        panels.map(({ id, ...props }) => <div key={id} data-test-response={id}><ActivityPanel
          activities={[]} connection="idle" pendingPermission={null}
          onPermissionDecision={() => {}} {...props} />
          {props.answerContent && <ChatMarkdown content={props.answerContent} />}
        </div>)
      ));
      window.renderRecovery = (props) => flushSync(() => root.render(
        <InlineDeepResearchRun runId="research_saved" query="Research a training program" output="answer" persistedOutcome="failed" persistedContent={props.detail} onRetry={() => window.retryCount = (window.retryCount || 0) + 1} />
      ));
      window.renderHandoff = (message) => window.renderPanels([{
        id: "handoff", connection: "streaming", responseDurationMs: 72000,
        answerContent: assistantVisibleContent(message.content, message),
        progressNotes: delegatedThinkingUpdates(message),
      }]);
    `,
    loader: "jsx",
    resolveDir: dashboardRoot,
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: { "@": path.join(dashboardRoot, "src") },
  logLevel: "silent",
});

let browser;
let styles;
before(async () => {
  const stylesheet = path.join(dashboardRoot, "src/app/globals.css");
  styles = (await postcss([tailwindcss({ base: dashboardRoot })]).process(
    fs.readFileSync(stylesheet, "utf8"), { from: stylesheet },
  )).css;
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find((candidate) => candidate && fs.existsSync(candidate));
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); });

async function pageFor(t, panels) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route("http://response.test/", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.goto("http://response.test/");
  await page.addStyleTag({ content: styles });
  await page.addStyleTag({ content: 'body { margin: 0; padding: 24px; background: var(--paper-bg); font-family: Arial, sans-serif; color: var(--ink); } #root { max-width: 900px; margin: auto; }' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate((value) => window.renderPanels(value), panels);
  return page;
}

test("the final delegation status belongs only to the Thinking dropdown", async (t) => {
  const note = "Max Research is reviewing the evidence, while Deep Research builds your beginner-safe training plan with exercise progressions. I’ll combine both results into one calorie target, diet, supplement guide, timeline, and gym program when they return.";
  const message = {
    role: "assistant", content: note,
    progressNotes: ["This needs two parallel tracks: evidence review and a beginner-safe program."],
    verification: { externalAgents: [{ agentName: "Max Research" }, { agentName: "Deep Research" }] },
  };
  const page = await pageFor(t, []);
  await page.evaluate((value) => window.renderHandoff(value), message);
  const trigger = page.getByRole("button", { name: /^Thinking/ });
  assert.equal(await page.getByText(note, { exact: true }).count(), 0);
  await trigger.click();
  assert.deepEqual(await page.getByRole("list", { name: "Thinking updates" }).getByRole("listitem").allInnerTexts(), [...message.progressNotes, note]);
  assert.equal(await page.getByText(note, { exact: true }).count(), 1);
  await trigger.click();
  assert.equal(await page.getByText(note, { exact: true }).count(), 0);

  // A restored response uses the same metadata and starts collapsed.
  await page.evaluate(() => window.renderPanels([]));
  await page.evaluate((value) => window.renderHandoff(value), message);
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  assert.equal(await page.getByRole("list", { name: "Thinking updates" }).getByText(note, { exact: true }).isVisible(), true);
  if (process.env.THINKING_QA_DIR) {
    fs.mkdirSync(process.env.THINKING_QA_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.THINKING_QA_DIR, "handoff.png"), fullPage: true });
  }
});

test("thinking stays open on completion and can be collapsed and reopened by keyboard", async (t) => {
  const panel = { id: "turn-1", connection: "streaming", responseDurationMs: 1000, progressNotes: ["I’m checking the sources."] };
  const page = await pageFor(t, [panel]);
  const trigger = page.getByRole("button", { name: /^Thinking/ });
  await trigger.click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.equal(await page.getByRole("list", { name: "Thinking updates" }).innerText(), panel.progressNotes[0]);

  const completed = {
    ...panel,
    connection: "idle",
    reasoning: "Compare the two sources before answering.",
    progressNotes: ["I checked both sources."],
    activities: [{ id: "search", kind: "web_search", label: "Searched sources", status: "completed", detail: "Found two matching references.", startedAt: new Date(0).toISOString() }],
  };
  await page.evaluate((value) => window.renderPanels([value]), completed);
  const thought = page.getByRole("button", { name: /^Thought/ });
  assert.equal(await thought.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("[data-response-reasoning]").count(), 0);
  assert.deepEqual(await page.getByRole("list", { name: "Thinking updates" }).getByRole("listitem").allInnerTexts(), [...completed.progressNotes, completed.reasoning]);
  assert.equal(await page.getByRole("list", { name: "Response activity" }).count(), 0);
  assert.equal(await page.getByText("Found two matching references.").isVisible(), false);
  await thought.press("Enter");
  assert.equal(await thought.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("[data-response-progress]").isVisible(), false);
  await thought.press("Space");
  assert.equal(await thought.getAttribute("aria-expanded"), "true");
  assert.deepEqual(await page.getByRole("list", { name: "Thinking updates" }).getByRole("listitem").allInnerTexts(), [...completed.progressNotes, completed.reasoning]);
});

const weatherAnswer = `It’s partly cloudy in Eindhoven today.

\`\`\`weather-results
{"location":"Eindhoven","country":"The Netherlands","timezone":"Europe/Amsterdam","days":[{"date":"2026-09-05","temperatureC":17.4,"minC":15.2,"maxC":21.2,"code":2,"condition":"Partly cloudy","isDay":true}]}
\`\`\`

Source: [Open-Meteo](https://open-meteo.com/)`;

test("restored weather answer previews leave one weather card and a progress update", async (t) => {
  const page = await pageFor(t, [{
    id: "weather", reasoning: weatherAnswer, answerContent: weatherAnswer,
    responseDurationMs: 19000,
    usage: { inputTokens: 161000, outputTokens: 1000, totalTokens: 162000, scope: "response" },
    progressNotes: ["Checking Eindhoven’s live weather now."],
    activities: [
      { id: "capabilities", kind: "tool_metadata", label: "Inspecting capabilities", status: "completed", detail: "current weather forecast named location Eindhoven weather_forecast", startedAt: new Date(0).toISOString() },
      { id: "command", kind: "terminal", label: "Running command", status: "completed", startedAt: new Date(0).toISOString() },
    ],
  }]);
  const trigger = page.getByRole("button", { name: /^Thought/ });
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  assert.equal(await page.locator("[data-response-reasoning]").count(), 0);
  assert.equal(await page.locator(".chat-weather-card").count(), 1);
  assert.equal(await page.getByText("It’s partly cloudy in Eindhoven today.", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Open-Meteo" }).getAttribute("href"), "https://open-meteo.com/");
  assert.doesNotMatch(await page.locator("body").innerText(), /weather-results|temperatureC|weather_forecast/);
  assert.equal(await trigger.evaluate((el) => getComputedStyle(el).outlineStyle), "none", "pointer click does not draw a persistent box around the status");
  if (process.env.THINKING_QA_DIR) {
    fs.mkdirSync(process.env.THINKING_QA_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.THINKING_QA_DIR, "weather.png"), fullPage: true });
  }
});

test("truncated answer previews and pre-tool echoes stay out of saved reasoning", async (t) => {
  const answer = "Max Research is queued to investigate morning dopamine levels, effects, measurement methods, confounders, and common claims. It requires your Breadboard confirmation before it starts.\n\nThe review will compare evidence from human studies and distinguish findings about sleep, circadian timing, and individual differences. It will examine how researchers measure dopamine and which conclusions those measurements can support, with references for each finding. The final report will describe the limits of the evidence and identify questions that remain unresolved.";
  const note = "I’m starting Max Research on morning dopamine levels and effects.";
  const page = await pageFor(t, [
    { id: "preview", answerContent: answer, reasoning: answer.slice(0, 500), progressNotes: [note], stateLabel: "Delegating to Max Research agent · Starting", responseDurationMs: 45000, usage: { inputTokens: 162000, outputTokens: 1000, totalTokens: 163000, scope: "response" } },
    { id: "echo", reasoning: note, progressNotes: [note, note] },
  ]);
  await page.setViewportSize({ width: 375, height: 740 });
  for (const button of await page.locator(".assistant-response-trigger").all()) await button.click();
  assert.equal(await page.locator("[data-response-reasoning]").count(), 0);
  assert.deepEqual(await page.getByRole("list", { name: "Thinking updates" }).allInnerTexts(), [note, note]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const triggerParts = await page.locator(".assistant-response-trigger").first().evaluate((el) => {
    const metrics = el.querySelector(".assistant-response-metrics").getBoundingClientRect();
    const chevron = el.querySelector(".assistant-response-chevron").getBoundingClientRect();
    return { metricsRight: metrics.right, chevronLeft: chevron.left };
  });
  assert.ok(triggerParts.chevronLeft >= triggerParts.metricsRight, "the disclosure chevron never wraps onto its own line");
  if (process.env.THINKING_QA_DIR) {
    await page.screenshot({ path: path.join(process.env.THINKING_QA_DIR, "delegation-mobile.png"), fullPage: true });
  }
});

test("the expanded dropdown restores the full dotted timeline with formatted thoughts and no inner scrollbar", async (t) => {
  const progressNotes = [
    "I’m loading the exact derivations and notation before writing the chapter.",
    "The core setup is confirmed. Now I’m filling in the line, disk, flux, and Gauss-law derivations.",
    "The derivations are settled. I’m checking the matching textbook sections, then I’ll produce the complete chapter.",
    "The chapter is complete in substance. I’m placing it in a readable document and checking the rendered version.",
    "The document content is ready. I’m retrying without the unsupported skill tag.",
    "The DOCX preview rendered, but finalization lost its file. I’m switching to a stable rendered document format.",
    "The content is intact. I’m regenerating the missing output file once, then finalizing it.",
    "The DOCX renderer remains unavailable. I’m preserving the verified chapter as a downloadable Markdown document instead.",
  ];
  const page = await pageFor(t, [{
    id: "timeline", reasoning: "(⌐■_■) reflecting...**Planning agent launch****Preparing detailed brief**",
    progressNotes, responseDurationMs: 824000,
    usage: { inputTokens: 2590000, outputTokens: 10000, totalTokens: 2600000, scope: "response" },
  }]);
  const trigger = page.getByRole("button", { name: /^Thought/ });
  await page.keyboard.press("Tab");
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
  assert.equal(await trigger.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
  await trigger.press("Enter");
  const timeline = page.getByRole("list", { name: "Thinking updates" });
  assert.deepEqual(await timeline.getByRole("listitem").allInnerTexts(), [...progressNotes, "Planning agent launch", "Preparing detailed brief"]);
  assert.equal(await page.locator("[data-response-reasoning]").count(), 0);
  assert.doesNotMatch(await page.locator("body").innerText(), /reflecting|\*\*/);
  for (const width of [1165, 375]) {
    await page.setViewportSize({ width, height: 740 });
    const layout = await page.locator("[data-response-progress]").evaluate((el) => {
      const line = el.querySelector(":scope > span").getBoundingClientRect();
      const dots = [...el.querySelectorAll("li > span")].map((dot) => {
        const bounds = dot.getBoundingClientRect();
        return { center: bounds.x + bounds.width / 2, top: bounds.top, width: bounds.width, height: bounds.height };
      });
      return { client: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el).overflowY, line: { x: line.x, width: line.width, height: line.height }, dots };
    });
    assert.equal(layout.client, layout.scroll, "all progress updates expand in the chat without an inner scrollbar");
    assert.equal(layout.overflow, "visible");
    assert.equal(layout.line.width, 1);
    assert.ok(layout.line.height > layout.dots.at(-1).top - layout.dots[0].top - 16);
    assert.ok(layout.dots.every((dot) => dot.width === 8 && dot.height === 8 && Math.abs(dot.center - layout.line.x - 0.5) <= 0.5));
    assert.ok(layout.dots.slice(1).every((dot, index) => dot.top - layout.dots[index].top >= 36));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.THINKING_QA_DIR) {
      fs.mkdirSync(process.env.THINKING_QA_DIR, { recursive: true });
      await page.mouse.click(width - 8, 8);
      await page.screenshot({ path: path.join(process.env.THINKING_QA_DIR, `timeline-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.press("Space");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
});

test("saved progress timelines keep independent disclosures", async (t) => {
  const panels = [
    { id: "old", progressNotes: ["Progress from the first response."] },
    { id: "new", progressNotes: ["Progress from the second response."] },
  ];
  const page = await pageFor(t, panels);
  const buttons = page.getByRole("button", { name: /^Thought/ });
  assert.equal(await buttons.count(), 2);
  const ids = await buttons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-controls")));
  assert.equal(new Set(ids).size, 2);
  await buttons.nth(0).click();
  assert.equal(await buttons.nth(1).getAttribute("aria-expanded"), "false");
  assert.equal(await page.getByRole("list", { name: "Thinking updates" }).innerText(), panels[0].progressNotes[0]);
  await buttons.nth(1).click();
  assert.deepEqual(await page.getByRole("list", { name: "Thinking updates" }).allInnerTexts(), panels.map((panel) => panel.progressNotes[0]));
});

test("completed responses without details have no empty disclosure or invented zero-duration row", async (t) => {
  const page = await pageFor(t, [
    { id: "empty", reasoning: "   ", progressNotes: [" "], responseDurationMs: 0 },
    { id: "answer", answerContent: "A completed answer.", responseDurationMs: 5000 },
    { id: "spinner-only", reasoning: "(⌐■_■) reflecting...", responseDurationMs: 1000 },
  ]);
  assert.equal(await page.locator('[data-test-response="empty"]').innerText(), "");
  assert.equal(await page.getByRole("button", { name: /^Thought/ }).count(), 0);
  const meta = await page.locator('[data-test-response="answer"] .assistant-response-meta').innerText();
  assert.match(meta, /Thought/);
  assert.match(meta, /5s/);
  assert.equal(await page.locator("[data-response-progress]").count(), 0);
  assert.doesNotMatch(await page.locator("body").innerText(), /No thinking details|0s/);
});

test("failed agent responses keep thinking above the visible error and normal response controls below", async (t) => {
  const page = await pageFor(t, []);
  const detail = "Error: Deep Research ended before it could finish an answer. Please retry the request.\n" + "runtime_detail_".repeat(100);
  await page.evaluate((value) => window.renderRecovery({ agent: true, detail: value }), detail);
  assert.equal(await page.locator(".assistant-response-meta").count(), 1);
  assert.equal(await page.getByRole("button", { name: /Copy response|Read response aloud|More response actions/ }).count(), 3);
  assert.equal(await page.getByRole("button", { name: "Retry", exact: true }).count(), 0);
  assert.equal(await page.locator("details, .assistant-response-notice").count(), 0);
  assert.ok((await page.locator("body").innerText()).replace(/\s+/g, " ").includes(detail.replace(/\s+/g, " ")));
  await page.getByRole("button", { name: "Regenerate response", exact: true }).click();
  assert.equal(await page.evaluate(() => window.retryCount), 1);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.THINKING_QA_DIR) {
      fs.mkdirSync(process.env.THINKING_QA_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.THINKING_QA_DIR, `recovery-${width}.png`), fullPage: true });
    }
  }
  if (process.env.THINKING_QA_DIR) await page.screenshot({ path: path.join(process.env.THINKING_QA_DIR, "recovery.png"), fullPage: true });
});

test("live responses without progress show metadata without an empty dropdown", async (t) => {
  const panel = { id: "live", connection: "streaming" };
  const page = await pageFor(t, [panel]);
  assert.equal(await page.getByRole("button", { name: /^Thinking/ }).count(), 0);
  assert.match(await page.locator(".assistant-response-meta").innerText(), /Thinking/);
  await page.evaluate((value) => window.renderPanels([value]), { ...panel, connection: "idle", answerContent: "Done.", responseDurationMs: 1000 });
  assert.equal(await page.locator("[data-response-progress]").count(), 0);
  assert.equal(await page.getByRole("button", { name: /^Thought/ }).count(), 0);
  assert.equal(await page.getByText("Done.", { exact: true }).count(), 1);
});

test("the reported PDF thought stream is readable live and after restoring the conversation", async (t) => {
  const panel = {
    id: "pdf", connection: "streaming", responseDurationMs: 342000,
    responseStartedAt: "2026-09-09T09:37:18Z",
    reasoning: noisyThinking, progressNotes: pdfProgressNotes,
    activities: [{ id: "command", kind: "terminal", label: "Running command", status: "running", startedAt: "2026-09-09T09:37:18Z" }],
  };
  const page = await pageFor(t, []);
  await page.clock.install({ time: new Date("2026-09-09T09:43:00Z") });
  await page.evaluate(value => window.renderPanels([value]), panel);
  const toggle = page.locator(".assistant-response-trigger");
  assert.match(await toggle.innerText(), /5m 42s/);
  await toggle.click();
  const updates = page.getByRole("list", { name: "Thinking updates" });
  assert.deepEqual(await updates.getByRole("listitem").allInnerTexts(), [...pdfProgressNotes, ...thinkingHeadings]);
  assert.equal(await updates.locator("strong").count(), thinkingHeadings.length);
  assert.doesNotMatch(await updates.innerText(), /\*\*|processing\.\.\.|reflecting\.\.\.|pondering\.\.\./);

  for (const width of [1177, 375]) {
    await page.setViewportSize({ width, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.THINKING_QA_DIR) {
      fs.mkdirSync(process.env.THINKING_QA_DIR, { recursive: true });
      await page.mouse.click(width - 8, 8);
      await page.screenshot({ path: path.join(process.env.THINKING_QA_DIR, `pdf-thoughts-${width}.png`), fullPage: true });
    }
  }

  await page.evaluate(() => { window.savedThoughtNode = document.querySelector('[data-response-progress] li:last-child'); });
  const continued = { ...panel, reasoning: noisyThinking + "\nReading the PDF header." };
  await page.evaluate(value => window.renderPanels([value]), continued);
  assert.equal(await page.evaluate(() => window.savedThoughtNode === document.querySelector('[data-response-progress] li:last-child')), true);
  assert.match(await updates.getByRole("listitem").last().innerText(), /Reading the PDF header/);
  await page.evaluate(value => window.renderPanels([{ ...value, connection: "idle", activities: [], answerContent: "The notes are transcribed." }]), continued);
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.match(await toggle.innerText(), /^Thought/);
  await toggle.press("Space");
  assert.equal(await updates.count(), 0);
  await toggle.press("Enter");
  assert.equal(await updates.isVisible(), true);

  await page.evaluate(() => window.renderPanels([]));
  await page.evaluate(value => window.renderPanels([{ ...value, connection: "idle", activities: [] }]), continued);
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  assert.equal(await updates.getByRole("listitem").count(), pdfProgressNotes.length + thinkingHeadings.length);
});

test("a failed visualization keeps the ongoing chat header, timer and token indicator live", async (t) => {
  const page = await pageFor(t, []);
  await page.clock.install({ time: new Date("2026-09-09T08:08:20Z") });
  const startedAt = "2026-09-09T08:08:00Z";
  const panel = {
    id: "visualizer", connection: "streaming", responseStartedAt: startedAt,
    progressNotes: ["The mobile browser test failed. I’m checking the repair."],
    activities: [
      { id: "reasoning", kind: "reasoning", label: "Thinking", status: "running", startedAt },
      { id: "artifact-wire", kind: "artifact", label: "Could not build Wire", status: "failed", startedAt, completedAt: "2026-09-09T08:08:10Z" },
    ],
  };
  await page.evaluate(value => window.renderPanels([value]), panel);
  const meta = page.locator(".assistant-response-meta");
  const label = page.locator(".assistant-response-label");
  assert.equal(await meta.getAttribute("data-response-state"), "active");
  assert.equal(await label.textContent(), "Thinking");
  assert.match(await label.getAttribute("class"), /thinking-shimmer/);
  assert.match(await meta.innerText(), /20s/);
  await page.getByRole("button", { name: /^Thinking/ }).click();
  await page.clock.fastForward(3000);
  assert.match(await meta.innerText(), /23s/);
  assert.equal(await page.getByRole("list", { name: "Thinking updates" }).innerText(), panel.progressNotes[0]);
  assert.match(await page.locator("[data-response-progress] li > span").getAttribute("class"), /animate-pulse/);

  for (const props of [
    { connection: "connecting", expectedLabel: "Thinking" },
    { connection: "waiting", pendingClarification: { requestId: "q1", question: "Which view?", choices: [] }, expectedLabel: "Waiting for your answer" },
    { connection: "streaming", activities: [...panel.activities, { id: "repair", kind: "terminal", label: "Running command", status: "running", startedAt }], expectedLabel: "Running command" },
  ]) {
    const { expectedLabel, ...overrides } = props;
    await page.evaluate(value => window.renderPanels([value]), { ...panel, ...overrides });
    assert.equal(await meta.getAttribute("data-response-state"), "active");
    assert.equal(await label.textContent(), expectedLabel);
    assert.match(await meta.innerText(), /counting tokens/);
  }
});

test("thinking keeps its token indicator until usage arrives and retains the completed count", async (t) => {
  const page = await pageFor(t, []);
  await page.clock.install({ time: new Date("2026-09-09T08:08:03Z") });
  const panel = {
    id: "tokens", connection: "streaming",
    responseStartedAt: "2026-09-09T08:08:00Z",
  };
  const render = value => page.evaluate(value => window.renderPanels([value]), value);
  const meta = page.locator(".assistant-response-meta");
  const usage = {
    inputTokens: 1000, outputTokens: 200, totalTokens: 1200,
    cachedInputTokens: 0, reasoningTokens: 0, scope: "turn",
  };

  for (const unreported of [
    undefined,
    { ...usage, inputTokens: 0, outputTokens: 0, totalTokens: 0, responseDurationMs: 3000 },
    { ...usage, totalTokens: 900000, scope: "session" },
  ]) {
    await render({ ...panel, usage: unreported });
    assert.match(await meta.innerText(), /Thinking\s*\(3s · ↓ counting tokens\.\.\.\)/);
    assert.equal(await meta.locator(".thinking-token-arrow").count(), 1);
    assert.doesNotMatch(await meta.innerText(), /(?:0|900k) tokens/);
  }

  await render({ ...panel, usage });
  assert.match(await meta.innerText(), /3s · ↓ 1\.2k tokens/);
  assert.doesNotMatch(await meta.innerText(), /counting tokens/);
  assert.equal(await meta.locator(".thinking-token-arrow").count(), 1);

  await render({
    ...panel, connection: "idle", usage,
    answerContent: "Hello!", responseDurationMs: 4000,
  });
  assert.match(await meta.innerText(), /Thought\s*\(4s · ↓ 1\.2k tokens\)/);
  assert.equal(await meta.locator(".thinking-token-arrow").count(), 0);
  const completedText = await meta.innerText();
  await page.clock.fastForward(3000);
  assert.equal(await meta.innerText(), completedText);

  await render({ ...panel, connection: "idle", responseDurationMs: 4000, answerContent: "Hello!" });
  assert.doesNotMatch(await meta.innerText(), /tokens/);
});

test("visualization recovery settles only when the response ends and preserves real failures", async (t) => {
  const page = await pageFor(t, []);
  await page.clock.install({ time: new Date("2026-09-09T08:08:20Z") });
  const startedAt = "2026-09-09T08:08:00Z";
  const artifact = { id: "artifact-wire", kind: "artifact", label: "Could not build Wire", status: "failed", startedAt, completedAt: "2026-09-09T08:08:10Z" };
  const panel = { id: "visualizer", connection: "streaming", responseStartedAt: startedAt, progressNotes: ["Repairing the visualization."], activities: [artifact] };
  const render = value => page.evaluate(value => window.renderPanels([value]), value);
  const meta = page.locator(".assistant-response-meta");
  const label = page.locator(".assistant-response-label");
  await render(panel);
  assert.equal(await meta.getAttribute("data-response-state"), "active");
  assert.equal(await label.textContent(), "Thinking");

  // Publication can continue independently after the chat connection idles.
  await render({ ...panel, connection: "idle", activities: [{ ...artifact, status: "running", label: "Building Wire…", completedAt: undefined }] });
  assert.equal(await meta.getAttribute("data-response-state"), "active");
  assert.equal(await label.textContent(), "Building Wire…");
  const usage = { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, scope: "turn" };
  await render({ ...panel, connection: "idle", responseDurationMs: 25000, usage, answerContent: "The visualization is ready.", activities: [{ ...artifact, status: "completed", label: "Building Wire…" }] });
  assert.equal(await meta.getAttribute("data-response-state"), "complete");
  assert.equal(await label.textContent(), "Thought");
  assert.match(await meta.innerText(), /25s.*1\.2k tokens/);
  const completedMetrics = await meta.innerText();
  await page.clock.fastForward(3000);
  assert.equal(await meta.innerText(), completedMetrics);

  await render({ ...panel, connection: "idle", responseDurationMs: 25000 });
  assert.equal(await meta.getAttribute("data-response-state"), "failed");
  assert.equal(await label.textContent(), "Could not build Wire");
  assert.doesNotMatch(await meta.innerText(), /counting tokens/);
  // An explicit interruption still wins over stale activity.
  await render({ ...panel, stateFailed: true, stateLabel: "Interrupted" });
  assert.equal(await meta.getAttribute("data-response-state"), "failed");
  assert.equal(await label.textContent(), "Interrupted");
  assert.doesNotMatch(await label.getAttribute("class"), /thinking-shimmer/);
});
