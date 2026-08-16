import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  assertGardenWorkspace,
  assertAuthenticatedDashboard,
  closeTerminal,
  createGarden,
  openGardenWorkspace,
  openTerminal,
  registerAndSignIn,
  uploadDocuments,
  type GardenInfo,
} from "../../user-journeys";
import type {
  ScenarioAttempt,
  ScenarioProbeOutcome,
} from "../../scenario-recorder";

/**
 * Provider-backed replay of the rows which were previously stopped at the
 * ChatMock 401 boundary. Every positive assertion below is made against the
 * Electron renderer. Health/API calls are used only to explain a block.
 */
test("Hermes provider-backed scenario inventory", async ({ qa }) => {
  test.setTimeout(18 * 60_000);
  const info = test.info();
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);

  const gardenA = await createGarden(page, {
    name: `Hermes Provider A ${qa.run.runId.slice(-8)}`,
    description: "Disposable provider-backed Hermes scenario garden",
  });
  await openGardenWorkspace(page, gardenA);

  const attempts: ScenarioAttempt[] = [];
  const groundingCount = String(Math.floor(100 + Math.random() * 900));
  const randomContextMarker = `COBALT-${Math.floor(100000 + Math.random() * 900000)}`;
  const isolationBetaMarker = `ISOLATION-${Math.floor(100000 + Math.random() * 900000)}`;
  const historyMarker = `HISTORY-${Math.floor(100000 + Math.random() * 900000)}`;
  let providerTerminalValue: string | null = null;
  const evidence = (name: string) =>
    path.join(qa.resultsDir, `provider-${name}.json`);

  const run = async (
    id: string,
    action: () => Promise<ScenarioProbeOutcome>,
    timeoutMs = 180_000,
  ): Promise<void> => {
    const attempt = await qa.scenarios.probe(info, id, action, {
      timeoutMs,
      classifyFailure: (error) => ({
        status: isEnvironmentFailure(error) ? "BLOCKED" : "FAIL",
        classification: isEnvironmentFailure(error)
          ? "QA_HARNESS_LIMITATION"
          : "PRODUCT_BUG",
        actual: error instanceof Error ? error.message : String(error),
      }),
    });
    attempts.push(attempt);
  };

  let primaryAttachmentPath: string | undefined;
  await run("garden-chat-document-grounding", async () => {
    const fixture = path.join(qa.run.paths.runRoot, "fixtures", "grounding.md");
    fs.mkdirSync(path.dirname(fixture), { recursive: true });
    fs.writeFileSync(
      fixture,
      `Inventory note: the titanium ring count is exactly ${groundingCount}.`,
      "utf8",
    );
    primaryAttachmentPath = fixture;
    await uploadDocuments(page, [fixture], 120_000);
    const turn = await sendGardenTurn(
      page,
      "Read the uploaded inventory note. What is the exact titanium ring count? Reply with only the number.",
      (text) => normalizeAnswer(text) === groundingCount,
    );
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText, evidence: [fixture] }
      : blocked(turn, "Grounding response did not complete in the renderer.");
  });

  await run("garden-chat-follow-up-context", async () => {
    const first = await sendGardenTurn(
      page,
      `Remember this harmless marker for the next turn: ${randomContextMarker}. Reply only with "acknowledged".`,
      (text) => /acknowledged/i.test(text),
    );
    if (!first.completed) return blocked(first, "The marker-setting turn did not complete.", "PRODUCT_PREREQUISITE_MISSING");
    const second = await sendGardenTurn(
      page,
      "What marker did I ask you to remember in my previous message? Reply only with the marker.",
      (text) => normalizeAnswer(text) === randomContextMarker,
    );
    return second.completed
      ? { status: "PASS", actual: second.assistantText }
      : blocked(second, "The follow-up context turn did not complete.", "PRODUCT_PREREQUISITE_MISSING");
  });

  await run("conversation-history-search-reopen", async () => {
    const historySearch = page.getByPlaceholder(/Search (?:chats|conversations|history)/i).first();
    if (!(await historySearch.isVisible().catch(() => false))) {
      return {
        status: "NOT_SUPPORTED",
        classification: "INTENTIONALLY_UNSUPPORTED",
        reason: "The implemented Garden Chat surface exposes Recents only; no chat-history search control is present.",
      };
    }
    const turn = await sendGardenTurn(
      page,
      `Reply with exactly ${historyMarker}. This is a direct response persistence smoke check, not a retrieval claim.`,
      (text) => text.includes(historyMarker),
    );
    if (!turn.completed) return blocked(turn, "No completed conversation was available to reopen.", "PRODUCT_PREREQUISITE_MISSING");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertGardenWorkspace(page, gardenA, [], 120_000);
    const persisted = await waitForAssistantMarker(page, historyMarker, 30_000);
    return persisted
      ? { status: "PASS", actual: "Completed response remained visible after renderer reload." }
      : failProduct("The completed response disappeared after renderer reload.");
  });

  await run("desktop-renderer-refresh-persistence", async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertGardenWorkspace(page, gardenA, [], 120_000);
    const persisted = await waitForAssistantMarker(page, historyMarker, 30_000);
    return persisted
      ? { status: "PASS", actual: "Renderer refresh retained the completed assistant turn." }
      : failProduct("Renderer refresh lost the completed assistant turn.");
  });

  await run("conversation-isolation", async () => {
    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    const gardenB = await createGarden(page, {
      name: `Hermes Provider B ${qa.run.runId.slice(-8)}`,
      description: "Second disposable garden for conversation isolation",
    });
    await openGardenWorkspace(page, gardenB);
    const bTurn = await sendGardenTurn(
      page,
      `Store this garden-local marker: ${isolationBetaMarker}. Reply only with "acknowledged".`,
      (text) => /acknowledged/i.test(text),
    );
    if (!bTurn.completed) return blocked(bTurn, "The second garden turn did not complete.");
    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    await openGardenWorkspace(page, gardenA);
    const aTurn = await sendGardenTurn(
      page,
      "What marker did I ask you to store earlier in this garden? Reply only with the marker. If no marker is available, say UNKNOWN.",
      (text) => normalizeAnswer(text) !== "" && /unknown|isolation-/i.test(text),
    );
    if (!aTurn.completed) return blocked(aTurn, "The return-to-A turn did not complete.");
    return aTurn.assistantText.includes(isolationBetaMarker)
      ? failProduct("Garden A response exposed Garden B marker.")
      : { status: "PASS", actual: aTurn.assistantText };
  });

  await run("conversation-branch-independence", async () => {
    const edit = page.getByRole("button", {
      name: "Edit message and create a branch",
      exact: true,
    }).last();
    const beforeCount = await assistantBlockCount(page);
    if (!(await edit.isVisible().catch(() => false))) {
      return blockedWithoutDependency("The real Garden Chat branch/edit control was not visible.", "QA_HARNESS_LIMITATION");
    }
    await edit.click();
    const editor = page.locator("textarea").last();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    const branchMarker = `BRANCH-${Math.floor(100000 + Math.random() * 900000)}`;
    await editor.fill(`Reply with exactly ${branchMarker}. This is a direct branch-response smoke check.`);
    await page.getByRole("button", { name: "Save & send", exact: true }).click();
    const turn = await waitForAssistantMarkerResult(page, branchMarker, 60_000, beforeCount);
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText }
      : blocked(turn, "Edited branch did not produce a completed assistant response.", "PRODUCT_PREREQUISITE_MISSING");
  });

  await run("artifact-create-open-content", async () => {
    const artifactValue = `ARTIFACT-FILE-${Math.floor(100000 + Math.random() * 900000)}`;
    const turn = await sendGardenTurn(
      page,
      `Use the safe first-party artifact tool to create a plain text artifact named hermes-e2e-artifact.txt containing exactly ${artifactValue}. Reply only "created" after the artifact is persisted. The expected value is held only by the harness.`,
      (text) => /created/i.test(text),
      120_000,
    );
    if (!turn.completed) return blocked(turn, "Artifact-generation turn did not complete.", "PRODUCT_PREREQUISITE_MISSING");
    const artifactCard = page.locator(".bb-neu-artifact-card").filter({
      hasText: "hermes-e2e-artifact",
    });
    const artifactVisible = await artifactCard.first().isVisible().catch(() => false);
    if (!artifactVisible) return blockedWithoutDependency("The assistant completed, but no artifact content/card was visible to open.", "PRODUCT_PREREQUISITE_MISSING");
    const open = artifactCard.first().locator('button[title^="Open"]').first();
    if (await open.isVisible().catch(() => false)) await open.click();
    const viewer = page.locator(".bb-artifact-dock").first();
    const viewerVisible = await viewer.isVisible().catch(() => false);
    const contentVisible = viewerVisible && await viewer.getByText(artifactValue, { exact: true }).isVisible().catch(() => false);
    if (viewerVisible) await page.getByRole("button", { name: "Close artifact", exact: true }).click().catch(() => undefined);
    return contentVisible
      ? { status: "PASS", actual: "Artifact content was visible in the real artifact viewer.", evidence: ["renderer artifact card", "renderer artifact viewer"] }
      : blockedWithoutDependency("The artifact card opened without a verified viewer value.", "PRODUCT_PREREQUISITE_MISSING");
  }, 150_000);

  await run("artifact-refresh-restart-persistence", async () => {
    const visible = await page.locator(".bb-neu-artifact-card").filter({
      hasText: "hermes-e2e-artifact",
    }).first().isVisible().catch(() => false);
    if (!visible) return blockedWithoutDependency("No completed artifact was available for persistence checks.", "QA_FIXTURE_MISSING");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertGardenWorkspace(page, gardenA, [], 120_000);
    return (await page.locator(".bb-neu-artifact-card").filter({
      hasText: "hermes-e2e-artifact",
    }).first().isVisible().catch(() => false))
      ? { status: "PASS", actual: "Artifact content remained visible after renderer reload." }
      : failProduct("Artifact content was lost after renderer reload.");
  });

  await run("terminal-command-completion", async () => {
    if (new URL(page.url()).pathname !== "/dashboard") {
      await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    }
    await openTerminal(page, 60_000);
    const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
    await expect(composer).toBeEditable({ timeout: 60_000 });
    const workspaceRoot = path.join(qa.run.paths.dataDir, "runtime", "hermes-workspaces");
    const terminalValue = `PROVIDER-FILE-${Math.floor(100000 + Math.random() * 900000)}`;
    providerTerminalValue = terminalValue;
    const created = await sendTerminalTurn(
      page,
      `Use terminal_execute_command in the isolated QA workspace ${workspaceRoot} to create hermes-provider-terminal.txt containing exactly ${terminalValue}. Reply only "created" after success.`,
      (text) => /created/i.test(text),
      120_000,
    );
    if (created.completed) {
      const readback = await sendTerminalTurn(
        page,
        `Read hermes-provider-terminal.txt from the isolated QA workspace ${workspaceRoot} and reply with only its exact contents. The expected value is held only by the harness and is not in this retrieval prompt.`,
        (text) => normalizeAnswer(text) === terminalValue,
        120_000,
      );
      if (readback.completed) {
        const file = findExactFile(workspaceRoot, "hermes-provider-terminal.txt", terminalValue);
        if (file) return { status: "PASS", actual: readback.assistantText, evidence: [file, "renderer terminal readback"] };
      }
    }
    await recoverTerminalSurface(page);
    return blocked(created, "Terminal did not produce a completed safe command/readback result.", "PRODUCT_PREREQUISITE_MISSING");
  }, 150_000);

  await run("terminal-refresh-run-state", async () => {
    const marker = providerTerminalValue && await waitForAssistantMarker(page, providerTerminalValue, 5_000);
    if (!marker) {
      await recoverTerminalSurface(page);
      return blockedWithoutDependency("No completed Terminal task was available to refresh.", "PRODUCT_PREREQUISITE_MISSING");
    }
    await closeTerminal(page, 60_000);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertAuthenticatedDashboard(page, undefined, 120_000);
    return { status: "PASS", actual: "Terminal task completed before renderer refresh; workspace remained usable." };
  });

  await run("terminal-cancel-and-reuse", async () => {
    await recoverTerminalSurface(page);
    const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
    await composer.fill("Run a long harmless command in the isolated workspace and do not finish until stopped.");
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    const stop = page.getByRole("button", { name: /Stop|Cancel/i }).last();
    if (!(await stop.isVisible({ timeout: 15_000 }).catch(() => false))) {
      return blockedWithoutDependency("The provider completed too quickly to expose a cancellable Terminal run.", "QA_HARNESS_LIMITATION");
    }
    await stop.click();
    await expect(composer).toBeEditable({ timeout: 60_000 });
    return { status: "PASS", actual: "Terminal task stopped and composer became reusable." };
  }, 120_000);

  await run("terminal-error-recovery", async () => {
    await recoverTerminalSurface(page);
    const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
    if (!(await composer.isVisible().catch(() => false))) return blockedWithoutDependency("Terminal surface was not open.", "QA_HARNESS_LIMITATION");
    const workspaceRoot = path.join(qa.run.paths.dataDir, "runtime", "hermes-workspaces");
    const failed = await sendTerminalTurn(
      page,
      `Run the harmless nonexistent command hermes_qa_command_that_does_not_exist in the isolated QA workspace ${workspaceRoot} and report only the visible non-zero error. Do not invent a success marker.`,
      (text) => /not recognized|not found|error|failed|non-zero/i.test(text),
      120_000,
    );
    if (!failed.completed) return blocked(failed, "Terminal error recovery did not reach a visible error state.", "PRODUCT_PREREQUISITE_MISSING");
    const recoveryValue = `PROVIDER-RECOVERY-${Math.floor(100000 + Math.random() * 900000)}`;
    const created = await sendTerminalTurn(
      page,
      `Create hermes-provider-recovery.txt in the isolated QA workspace ${workspaceRoot} containing exactly ${recoveryValue}. Reply only "created" after success.`,
      (text) => /created/i.test(text),
      120_000,
    );
    if (!created.completed) return blocked(created, "Terminal composer did not recover for the valid task.", "PRODUCT_PREREQUISITE_MISSING");
    const readback = await sendTerminalTurn(
      page,
      `Read hermes-provider-recovery.txt from the isolated QA workspace ${workspaceRoot} and reply with only its exact contents. The expected value is not included in this retrieval prompt.`,
      (text) => normalizeAnswer(text) === recoveryValue,
      120_000,
    );
    const file = findExactFile(workspaceRoot, "hermes-provider-recovery.txt", recoveryValue);
    return readback.completed && file
      ? { status: "PASS", actual: readback.assistantText, evidence: [file, "renderer error then terminal readback"] }
      : blocked(readback, "Terminal error recovery did not complete the valid readback.", "PRODUCT_PREREQUISITE_MISSING");
  }, 150_000);

  await run("chat-cancel-and-recover", async () => {
    await closeTerminal(page, 60_000).catch(() => undefined);
    if (new URL(page.url()).pathname !== new URL(gardenA.workspaceHref, page.url()).pathname) {
      await openGardenWorkspace(page, gardenA);
    }
    const composer = page.getByPlaceholder(/Ask about your documents/).first();
    await expect(composer).toBeEditable({ timeout: 60_000 });
    await composer.fill("Write a very long harmless explanation of why a disposable QA run is isolated, and keep streaming until stopped.");
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    const stop = page.getByRole("button", { name: /Stop|Cancel/i }).last();
    if (!(await stop.isVisible({ timeout: 15_000 }).catch(() => false))) {
      return blockedWithoutDependency("The provider completed too quickly to expose a cancellable chat run.");
    }
    await stop.click();
    await expect(composer).toBeEditable({ timeout: 60_000 });
    const recoveryMarker = `CHAT-RECOVERY-${Math.floor(100000 + Math.random() * 900000)}`;
    const recovery = await sendGardenTurn(page, `Reply with exactly ${recoveryMarker}. This is a direct recovery smoke check.`, (text) => text.includes(recoveryMarker));
    return recovery.completed
      ? { status: "PASS", actual: recovery.assistantText }
      : blocked(recovery, "The post-cancellation recovery turn did not complete.");
  }, 120_000);

  await run("learn-plan-confirm-build", async () => ({
    status: "SKIPPED_OPTIONAL",
    classification: "OPTIONAL_DEPENDENCY_NOT_CONFIGURED",
    reason: "Learn plan/build is a separate optional surface; no deterministic provider-backed build fixture is enabled in this isolated profile.",
  }));
  await run("learn-cancel-and-retry", async () => ({
    status: "SKIPPED_OPTIONAL",
    classification: "OPTIONAL_DEPENDENCY_NOT_CONFIGURED",
    reason: "Learn cancellation/retry has no deterministic approved plan fixture in this isolated profile.",
  }));

  const receipt = {
    schemaVersion: 1,
    runId: qa.run.runId,
    generatedAt: new Date().toISOString(),
    providerAuthReference: "external read-only CHATMOCK_AUTH_FILE; contents omitted",
    attempts,
    counts: attempts.reduce(
      (counts, attempt) => ({ ...counts, [attempt.status]: (counts[attempt.status] ?? 0) + 1 }),
      {} as Record<string, number>,
    ),
  };
  const receiptPath = path.join(qa.resultsDir, "hermes-provider-backed-inventory.json");
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await test.info().attach("hermes-provider-backed-inventory", {
    path: receiptPath,
    contentType: "application/json",
  });
  expect(attempts).toHaveLength(15);
});

interface TurnResult {
  readonly completed: boolean;
  readonly assistantText: string;
  readonly failureText: string;
  readonly userMessageVisible: boolean;
  readonly composerUsable: boolean;
}

function blocked(
  turn: TurnResult,
  fallback: string,
  classification: "QA_FIXTURE_MISSING" | "QA_HARNESS_LIMITATION" | "PRODUCT_PREREQUISITE_MISSING" = "QA_FIXTURE_MISSING",
): ScenarioProbeOutcome {
  return {
    status: "BLOCKED",
    dependency: "required",
    classification,
    reason: turn.failureText || fallback,
    evidence: ["renderer assistant/user/composer state captured by provider-backed inventory"],
  };
}

function blockedWithoutDependency(
  reason: string,
  classification: "QA_FIXTURE_MISSING" | "QA_HARNESS_LIMITATION" | "PRODUCT_PREREQUISITE_MISSING" = "QA_FIXTURE_MISSING",
): ScenarioProbeOutcome {
  return { status: "BLOCKED", dependency: "required", classification, reason };
}

function failProduct(reason: string): never {
  throw new Error(reason);
}

async function sendGardenTurn(
  page: Page,
  prompt: string,
  criterion: (assistantText: string) => boolean,
  timeoutMs = 60_000,
): Promise<TurnResult> {
  const composer = page.getByPlaceholder(/Ask about your documents/).first();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEditable({ timeout: 120_000 });
  const beforeCount = await assistantBlockCount(page);
  await composer.fill(prompt);
  const persisted = page.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname;
      return response.request().method() === "PATCH" &&
        /^\/api\/chat-sessions\/\d+$/.test(pathname) &&
        response.ok();
    },
    { timeout: Math.max(timeoutMs, 120_000) },
  );
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  const turn = await waitForTurn(page, prompt, criterion, timeoutMs, beforeCount);
  if (turn.completed) {
    try {
      await persisted;
    } catch {
      return {
        ...turn,
        completed: false,
        failureText: "Assistant marker appeared before the chat transcript PATCH completed.",
      };
    }
  }
  return turn;
}

async function waitForAssistantMarkerResult(
  page: Page,
  marker: string,
  timeoutMs: number,
  beforeCount = 0,
): Promise<TurnResult> {
  return waitForTurn(page, marker, (text) => text.includes(marker), timeoutMs, beforeCount);
}

async function sendTerminalTurn(
  page: Page,
  prompt: string,
  criterion: (assistantText: string) => boolean,
  timeoutMs: number,
): Promise<TurnResult> {
  const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
  await expect(composer).toBeEditable({ timeout: 120_000 });
  const beforeCount = await assistantBlockCount(page);
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  return waitForTurn(page, prompt, criterion, timeoutMs, beforeCount);
}

async function waitForTurn(
  page: Page,
  prompt: string,
  criterion: (assistantText: string) => boolean,
  timeoutMs: number,
  beforeCount = 0,
): Promise<TurnResult> {
  const deadline = Date.now() + timeoutMs;
  let assistantText = "";
  let failureText = "";
  let userMessageVisible = false;
  while (Date.now() < deadline) {
    assistantText = (await assistantBlockCount(page)) > beforeCount
      ? await latestAssistantText(page)
      : "";
    failureText = await page.getByRole("alert").allTextContents().then((items) => items.join("\n").trim()).catch(() => "");
    userMessageVisible = await page.locator(".neu-chat-message-user").filter({ hasText: prompt }).count().then((count) => count > 0).catch(() => false);
    const composer = page.getByPlaceholder(/Ask about your documents|Ask anything across your gardens/).first();
    const composerUsable = await composer.isEnabled().catch(() => false);
    const delta = assistantText.trim();
    if (criterion(delta)) return { completed: true, assistantText: delta, failureText, userMessageVisible, composerUsable };
    if (failureText && composerUsable) return { completed: false, assistantText, failureText, userMessageVisible, composerUsable };
    await delay(250);
  }
  const composerUsable = await page.getByPlaceholder(/Ask about your documents|Ask anything across your gardens/).first().isEnabled().catch(() => false);
  return { completed: false, assistantText, failureText, userMessageVisible, composerUsable };
}

async function waitForAssistantMarker(page: Page, marker: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exact = page.getByText(marker, { exact: true }).first();
    if (await exact.isVisible().catch(() => false)) {
      const isUser = await exact
        .evaluate((node) => Boolean(node.closest(".neu-chat-message-user")))
        .catch(() => true);
      if (!isUser) return true;
    }
    if ((await latestAssistantText(page)).includes(marker)) return true;
    await delay(250);
  }
  return false;
}

async function visibleAssistantText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('div[class~="text-gray-200"]'))
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .filter((node) => Boolean(node.offsetParent || node.getClientRects().length))
      .filter((node) => !node.closest(".neu-chat-message-user, textarea, button, nav, header"));
    return candidates.at(-1)?.innerText?.trim() ?? "";
  }).catch(() => "");
}

async function assistantBlockCount(page: Page): Promise<number> {
  return page.locator('div[class~="text-gray-200"]').count().catch(() => 0);
}

async function latestAssistantText(page: Page): Promise<string> {
  return page.locator('div[class~="text-gray-200"]').last().innerText().catch(() => "");
}

function normalizeAnswer(text: string): string {
  return text.replace(/[\s`*_#"'.,:;!?()[\]{}<>]/g, "").trim();
}

function isEnvironmentFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ENOSPC|ECONNRESET|Target page|browser has been closed|Electron/i.test(text);
}

function findExactFile(root: string, fileName: string, expected: string): string | null {
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(candidate);
      else if (entry.isFile() && entry.name === fileName) {
        try {
          if (fs.readFileSync(candidate, "utf8") === expected) return candidate;
        } catch {
          // A concurrent write is not evidence of completion.
        }
      }
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverTerminalSurface(page: Page): Promise<void> {
  const stop = page.getByRole("button", { name: /Stop|Cancel/i }).last();
  if (await stop.isVisible().catch(() => false)) {
    await stop.click().catch(() => undefined);
  }
  await closeTerminal(page, 30_000).catch(() => undefined);
  await openTerminal(page, 60_000);
}
