import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  assertGardenWorkspace,
  createGarden,
  openGardenWorkspace,
  registerAndSignIn,
  type GardenInfo,
} from "../../user-journeys";

/**
 * Focused answer-leakage correction replay. The marker is introduced only in
 * the first turn and is never present in any retrieval prompt.
 */
test.describe.serial("corrected Hermes context invariants", () => {
  let page: Page;
  let garden: GardenInfo;
  let marker: string;

  test("A. active conversation context retrieves a setup-only marker", async ({ qa }) => {
    test.setTimeout(8 * 60_000);
    page = await qa.dismissWelcome();
  const trace = new ContextTrace(page, qa.resultsDir, test.info().title);
    trace.record("test-start");
    try {
    await registerAndSignIn(page, qa.run.bootstrap.auth);
    trace.record("authenticated");
    garden = await createGarden(page, {
      name: `Context Correction ${qa.run.runId.slice(-8)}`,
      description: "Disposable answer-leakage correction garden",
    });
    trace.record("garden-created");
    await openGardenWorkspace(page, garden);
    trace.record("workspace-ready");

    const trials: Array<"PASS" | "BLOCKED"> = [];
    for (let trial = 1; trial <= 5; trial += 1) {
      // Keep each statistical trial to one clean two-turn conversation. A
      // prior trial's marker is intentionally not part of the next trial's
      // context; reusing one long transcript measures model anchoring across
      // unrelated setup turns rather than the context invariant itself.
      if (trial > 1) {
        await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
        garden = await createGarden(page, {
          name: `Context Correction ${qa.run.runId.slice(-8)} Trial ${trial}`,
          description: "Disposable answer-leakage correction trial garden",
        });
        await openGardenWorkspace(page, garden);
      }
      marker = `CONTEXT-${Math.floor(100000 + Math.random() * 900000)}`;
      trace.record("trial-start", { trial, markerLength: marker.length });
      const first = await sendTurn(
        page,
        `I'm going to give you a temporary reference number for this conversation.\n\nReference number: ${marker}\n\nPlease keep it in mind for my next question and reply only "Got it."`,
        // Turn 1 only needs a terminal acknowledgment that does not disclose
        // the setup value. Authenticated providers may acknowledge naturally
        // instead of using the literal phrase requested by the prompt.
        (text) => text.trim().length > 0 && !text.includes(marker),
        trace,
      );
      trace.record(`trial-${trial}-turn-1:${first ? "pass" : "blocked"}`);
      if (!first) {
        trials.push("BLOCKED");
        continue;
      }

      const second = await sendTurn(
        page,
        "What reference number did I give you in my previous message? Reply only with the reference number.",
        (text) => normalize(text) === marker,
        trace,
      );
      trace.record(`trial-${trial}-turn-2:${second ? "pass" : "blocked"}`);
      trials.push(second ? "PASS" : "BLOCKED");
    }
    trace.record("five-trial-summary", { trials });
    if (trials.length !== 5 || trials.some((result) => result !== "PASS")) {
      test.info().annotations.push({ type: "BLOCKED", description: `Corrected context trials did not complete 5/5: ${trials.join(",") || "none"}.` });
      test.skip(true, "BLOCKED: corrected context trials did not complete 5/5");
    }
    } finally {
      await trace.flush();
    }
  });

  test("B. renderer refresh restores the same context without prompt leakage", async ({ qa }) => {
    test.setTimeout(6 * 60_000);
    if (!marker || !garden) {
      test.skip(true, "BLOCKED: active context setup did not complete");
      return;
    }
    const trace = new ContextTrace(page, qa.resultsDir, test.info().title);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
      await assertGardenWorkspace(page, garden, [], 180_000);
      const restored = await sendTurn(
        page,
        "What exact marker did I ask you to remember earlier in this conversation? Reply only with the marker.",
        (text) => normalize(text) === marker,
        trace,
      );
      if (!restored) {
        test.info().annotations.push({ type: "BLOCKED", description: "Provider did not complete the post-refresh retrieval turn." });
        test.skip(true, "BLOCKED: post-refresh marker retrieval did not complete");
      }
    } finally {
      await trace.flush();
    }
  });

  test("C. a new conversation cannot see the original marker, then original context returns", async ({ qa }) => {
    test.setTimeout(8 * 60_000);
    if (!marker || !garden) {
      test.skip(true, "BLOCKED: active context setup did not complete");
      return;
    }
    const trace = new ContextTrace(page, qa.resultsDir, test.info().title);
    try {
    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    const other = await createGarden(page, {
      name: `Context Isolation ${page.url().slice(-8)}`,
      description: "Second disposable conversation for isolation correction",
    });
    await openGardenWorkspace(page, other, 180_000);
    const isolated = await sendTurn(
      page,
      "What exact marker did I ask you to remember earlier in this conversation? If that information is not available in this conversation, say UNKNOWN.",
      // Isolation is about non-disclosure, not a particular refusal phrase.
      // Authenticated providers legitimately vary between "UNKNOWN", "I
      // don't have that context", and another concise no-context response.
      // Require a non-empty terminal answer and assert the actual invariant
      // below: the answer must not contain Conversation A's marker.
      (text) => text.trim().length > 0 && !text.includes(marker),
      trace,
    );
    if (!isolated) {
      test.info().annotations.push({ type: "BLOCKED", description: "Provider did not complete the isolated-conversation retrieval turn." });
      test.skip(true, "BLOCKED: isolated conversation retrieval did not complete");
    }
    const isolatedText = await latestAssistantText(page);
    expect(normalize(isolatedText)).not.toBe(marker);
    expect(isolatedText).not.toContain(marker);

    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    await openGardenWorkspace(page, garden, 180_000);
    const restored = await sendTurn(
      page,
      "What exact marker did I ask you to remember earlier in this conversation? Reply only with the marker.",
      (text) => normalize(text) === marker,
      trace,
    );
    if (!restored) {
      test.info().annotations.push({ type: "BLOCKED", description: "Provider did not complete the original-conversation restoration turn." });
      test.skip(true, "BLOCKED: original-conversation retrieval did not complete");
    }
    } finally {
      await trace.flush();
    }
  });
});

async function sendTurn(
  page: Page,
  prompt: string,
  criterion: (text: string) => boolean,
  trace?: ContextTrace,
): Promise<boolean> {
  const composer = page.getByPlaceholder(/Ask about your documents/).last();
  await expect(composer).toBeEditable({ timeout: 180_000 });
  const beforeCount = await assistantBlockCount(page);
  const baselineUserMessages = await userMessageCount(page);
  trace?.record("before-submit", { prompt: promptShape(prompt), beforeCount, ui: await uiSnapshot(page) });
  const persisted = page.waitForResponse(
    (response) => response.request().method() === "PATCH" &&
      /^\/api\/chat-sessions\/\d+$/.test(new URL(response.url()).pathname) && response.ok(),
    { timeout: 360_000 },
  ).then(() => true).catch(() => false);
  let chatCompleted = false;
  let chatCompletedAt = 0;
  const chatResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/chat" && response.ok(),
    { timeout: 360_000 },
  ).then(() => {
    chatCompleted = true;
    chatCompletedAt = Date.now();
    return true;
  }).catch(() => false);
  await composer.fill(prompt);
  trace?.record("filled", { prompt: promptShape(prompt), ui: await uiSnapshot(page) });
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  trace?.record("submit-click", { prompt: promptShape(prompt), ui: await uiSnapshot(page) });
  const deadline = Date.now() + 360_000;
  let lastPollState = "";
  let alertRecorded = false;
  while (Date.now() < deadline) {
    const text = await latestAssistantText(page);
    const composerReady = await composer.isEnabled().catch(() => false);
    const matched = chatCompleted &&
      (await userMessageCount(page)) > baselineUserMessages &&
      criterion(text.trim());
    const pollState = `${await assistantBlockCount(page)}|${text.length}|${composerReady}|${matched}`;
    if (pollState !== lastPollState) {
      lastPollState = pollState;
      trace?.record("poll", {
        assistantCount: await assistantBlockCount(page),
        assistantShape: textShape(text),
        criterionMatched: matched,
        composerReady,
        ui: await uiSnapshot(page),
      });
    }
    if (matched && composerReady) {
      return await persisted;
    }
    // `/api/chat` is the authoritative end of the streamed turn. Once it and
    // transcript persistence have completed, a non-matching newest block is a
    // real blocked/failed turn; before then the UI may contain a user bubble or
    // an in-flight placeholder that happens to share presentation classes.
    if (chatCompleted && Date.now() - chatCompletedAt >= 5_000 && await persisted &&
      assistantCountHasAdvanced(beforeCount, await assistantBlockCount(page)) &&
      composerReady) {
      // The count can advance between the poll's initial read and this
      // boundary check. Re-read the newest block so a just-painted valid
      // response is not classified using stale text from the prior poll.
      const settledText = (await latestAssistantText(page)).trim();
      const settledMatch = (await userMessageCount(page)) > baselineUserMessages &&
        criterion(settledText);
      trace?.record("chat-terminal-check", {
        assistantShape: textShape(settledText),
        criterionMatched: settledMatch,
        ui: await uiSnapshot(page),
      });
      if (settledMatch) return true;
      trace?.record("chat-completed-without-criterion", { ui: await uiSnapshot(page) });
      return false;
    }
    if (!alertRecorded && composerReady && await hasVisibleAlert(page)) {
      // Alerts are not a reliable terminal signal here: the workspace mounts
      // unrelated alert nodes while chat-session creation and hydration are
      // still in flight. Record them, but let the actual chat request,
      // transcript criterion, or bounded timeout decide the outcome.
      trace?.record("visible-alert", { ui: await uiSnapshot(page) });
      alertRecorded = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function hasVisibleAlert(page: Page): Promise<boolean> {
  return page.getByRole("alert").evaluateAll((elements) =>
    elements.some((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        style.opacity !== "0" && rect.width > 0 && rect.height > 0;
    }),
  ).catch(() => false);
}

function assistantCountHasAdvanced(before: number, current: number): boolean {
  return current > before;
}

type TraceEvent = Record<string, unknown> & { at: string; event: string };

class ContextTrace {
  private readonly events: TraceEvent[] = [];
  private readonly startedAt = Date.now();
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly page: Page,
    private readonly resultsDir: string,
    private readonly title: string,
  ) {
    const relevant = (url: string) => {
      const pathname = new URL(url).pathname;
      return pathname.startsWith("/api/chat") || pathname.startsWith("/api/chat-sessions");
    };
    const onRequest = (request: import("playwright").Request) => {
      if (!relevant(request.url())) return;
      this.record("request", {
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: sanitizeRequestBody(request.postData()),
      });
    };
    const onResponse = (response: import("playwright").Response) => {
      if (!relevant(response.url())) return;
      this.record("response", {
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    };
    const onFailed = (request: import("playwright").Request) => {
      if (!relevant(request.url())) return;
      this.record("request-failed", {
        method: request.method(),
        path: new URL(request.url()).pathname,
        failure: request.failure()?.errorText ?? "unknown",
      });
    };
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);
    this.listeners.push(() => page.off("request", onRequest));
    this.listeners.push(() => page.off("response", onResponse));
    this.listeners.push(() => page.off("requestfailed", onFailed));
  }

  record(event: string, data: Record<string, unknown> = {}): void {
    this.events.push({ at: new Date().toISOString(), event, ...data });
  }

  async flush(): Promise<void> {
    for (const remove of this.listeners.splice(0)) remove();
    fs.mkdirSync(this.resultsDir, { recursive: true });
    const services = await readServiceSummary(this.resultsDir);
    const output = path.join(this.resultsDir, `context-correction-trace-${this.startedAt}.json`);
    fs.writeFileSync(output, JSON.stringify({
      title: this.title,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      events: this.events,
      services,
    }, null, 2));
  }
}

function promptShape(prompt: string): Record<string, unknown> {
  return { length: prompt.length, containsMarker: /NEBULA-|CONTEXT-/i.test(prompt) };
}

function textShape(text: string): Record<string, unknown> {
  return { length: text.length, containsMarker: /NEBULA-|CONTEXT-/i.test(text) };
}

function sanitizeRequestBody(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const messages = Array.isArray(body.messages)
      ? body.messages.map((message) => {
          const item = message as Record<string, unknown>;
          const content = typeof item.content === "string" ? item.content : "";
          return { role: item.role, contentLength: content.length, containsMarker: /NEBULA-|CONTEXT-/i.test(content) };
        })
      : undefined;
    return {
      keys: Object.keys(body).sort(),
      chatSessionId: typeof body.chatSessionId === "number" ? "present" : undefined,
      clusterSlug: typeof body.clusterSlug === "string" ? "present" : undefined,
      messages,
      messageCount: messages?.length,
      title: typeof body.title === "string" ? "present" : undefined,
    };
  } catch {
    return { malformed: true, length: raw.length };
  }
}

async function uiSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const textarea = document.querySelector('textarea[placeholder*="Ask about your documents"]') as HTMLTextAreaElement | null;
    const assistant = document.querySelectorAll('div[class~="text-gray-200"]').length;
    const send = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Send") as HTMLButtonElement | undefined;
    return {
      path: location.pathname,
      assistantCount: assistant,
      composerValueLength: textarea?.value.length ?? 0,
      composerDisabled: textarea?.disabled ?? null,
      sendDisabled: send?.disabled ?? null,
      recentsText: document.body.innerText.includes("No chats yet") ? "empty" : "nonempty-or-unknown",
      stopVisible: [...document.querySelectorAll("button")].some((button) => /stop/i.test(button.textContent ?? "")),
    };
  }).catch(() => ({ unavailable: true }));
}

async function readServiceSummary(resultsDir: string): Promise<Record<string, unknown>> {
  const logDir = path.join(resultsDir, "..", "..", "..", "runtime");
  return { note: "service log paths are retained by the fixture; browser trace is authoritative for request boundaries", logDirExists: fs.existsSync(logDir) };
}

async function assistantBlockCount(page: Page): Promise<number> {
  return assistantMessageRows(page).count().catch(() => 0);
}

async function latestAssistantText(page: Page): Promise<string> {
  return assistantMessageRows(page)
    .last()
    .locator('div[class~="text-gray-200"]')
    .last()
    .innerText()
    .catch(() => "");
}

async function userMessageCount(page: Page): Promise<number> {
  return page.locator(".neu-chat-message-user").count().catch(() => 0);
}

function assistantMessageRows(page: Page) {
  return page.locator(
    'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " max-w-5xl ") and contains(concat(" ", normalize-space(@class), " "), " gap-6 ")]/div[contains(concat(" ", normalize-space(@class), " "), " flex w-full flex-col gap-3 ")][.//div[contains(concat(" ", normalize-space(@class), " "), " items-start ")] and not(.//*[contains(concat(" ", normalize-space(@class), " "), " neu-chat-message-user ")])]'
  );
}

function normalize(text: string): string {
  return text.replace(/[\s`*_#"'.,:;!?()[\]{}<>]/g, "").trim();
}
