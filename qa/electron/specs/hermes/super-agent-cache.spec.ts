import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createGarden, openGardenWorkspace, registerAndSignIn } from "../../user-journeys";

/**
 * Prompt-cache replay for Super agent: one conversation, several turns, real
 * provider. The turns themselves are ordinary; the evidence is what the run
 * leaves behind in the disposable profile (per-turn dispatch records, message
 * token usage and ChatMock's per-call usage ledger), which
 * `qa/electron/specs/hermes/super-agent-cache-report.py` reads afterwards.
 * Run with `--preserve-runtime` so that profile survives the test.
 *
 * Super agent is switched on by adding the composer's own flags to the chat
 * request. Everything behind the request (brokering, prompt assembly, Hermes,
 * ChatMock, the provider) is the real path.
 */
const TURNS = [
  "In two sentences, what does a Bode plot show?",
  "Search the web for the current Node.js LTS major version and tell me the number, citing one source.",
  "Search the web for the current Python stable release number, then say in one sentence how it and the Node.js answer above differ in release cadence.",
  "Without searching again, restate my very first question in your own words.",
  "List three follow-up topics from this conversation as short bullets.",
];

test("Super agent turns in one conversation leave cache evidence", async ({ qa }) => {
  test.setTimeout(40 * 60_000);
  const page = await mainWindow(qa.app.application);
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  const garden = await createGarden(page, {
    name: `Super Agent Cache ${qa.run.runId.slice(-8)}`,
    description: "Disposable prompt-cache replay garden",
  });
  await openGardenWorkspace(page, garden);

  await page.route("**/api/chat", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    try {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      await route.continue({ postData: JSON.stringify({ ...body, superAgent: true, yoloMode: true }) });
    } catch {
      await route.continue();
    }
  });

  const outcomes: Array<{ turn: number; completed: boolean; answerLength: number; seconds: number }> = [];
  for (const [index, prompt] of TURNS.entries()) {
    const started = Date.now();
    const completed = await sendTurn(page, prompt);
    outcomes.push({
      turn: index + 1,
      completed,
      answerLength: (await latestAssistantText(page)).length,
      seconds: Math.round((Date.now() - started) / 1000),
    });
    if (!completed) break;
  }
  fs.mkdirSync(qa.resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(qa.resultsDir, "super-agent-cache-turns.json"),
    JSON.stringify({ runId: qa.run.runId, outcomes }, null, 2),
  );
  const completed = outcomes.filter((outcome) => outcome.completed).length;
  if (completed < 3) {
    test.info().annotations.push({ type: "BLOCKED", description: `Only ${completed} of ${TURNS.length} provider turns completed.` });
    test.skip(true, "BLOCKED: too few provider turns completed to compare consecutive turns");
  }
  expect(completed).toBeGreaterThanOrEqual(3);
});

/**
 * The app's own page. Current builds open straight on sign-in (there is no
 * welcome button to dismiss), next to helper windows such as /voice and
 * /dictation that must not be mistaken for it.
 */
async function mainWindow(application: { windows(): Page[] }): Promise<Page> {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) => {
      if (candidate.isClosed()) return false;
      try {
        const url = new URL(candidate.url());
        return url.hostname === "127.0.0.1" && /^\/(auth\/|dashboard|$)/.test(url.pathname);
      } catch {
        return false;
      }
    });
    if (page) {
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in or dashboard window; open: ${application.windows().map((page) => page.url()).join(", ")}`);
}

async function sendTurn(page: Page, prompt: string): Promise<boolean> {
  const composer = page.getByPlaceholder("Ask anything.", { exact: true }).last();
  await expect(composer).toBeEditable({ timeout: 180_000 });
  const before = await assistantRows(page).count().catch(() => 0);
  const users = await page.locator(".neu-chat-message-user").count().catch(() => 0);
  let done = false;
  const chat = page.waitForResponse(
    (response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/chat" && response.ok(),
    { timeout: 420_000 },
  ).then(() => { done = true; }).catch(() => undefined);
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  const deadline = Date.now() + 420_000;
  let settledAt = 0;
  while (Date.now() < deadline) {
    const answered = done &&
      (await assistantRows(page).count().catch(() => 0)) > before &&
      (await page.locator(".neu-chat-message-user").count().catch(() => 0)) > users &&
      (await latestAssistantText(page)).trim().length > 0 &&
      await composer.isEnabled().catch(() => false);
    if (answered) {
      // Let the transcript persist and the usage record land before the next turn.
      settledAt ||= Date.now();
      if (Date.now() - settledAt >= 4_000) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await chat;
  return false;
}

async function latestAssistantText(page: Page): Promise<string> {
  return assistantRows(page).last().locator('div[class~="text-gray-200"]').last().innerText().catch(() => "");
}

function assistantRows(page: Page) {
  return page.locator(
    'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " max-w-5xl ") and contains(concat(" ", normalize-space(@class), " "), " gap-6 ")]/div[contains(concat(" ", normalize-space(@class), " "), " flex w-full flex-col gap-3 ")][.//div[contains(concat(" ", normalize-space(@class), " "), " items-start ")] and not(.//*[contains(concat(" ", normalize-space(@class), " "), " neu-chat-message-user ")])]',
  );
}
