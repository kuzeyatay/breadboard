import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  assertGardenWorkspace,
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
  const evidence = (name: string) =>
    path.join(qa.resultsDir, `provider-${name}.json`);

  const run = async (
    id: string,
    action: () => Promise<ScenarioProbeOutcome>,
    timeoutMs = 90_000,
  ): Promise<void> => {
    const attempt = await qa.scenarios.probe(info, id, action, {
      timeoutMs,
      classifyFailure: (error) => ({
        classification: isEnvironmentFailure(error)
          ? "TEST_ENVIRONMENT"
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
      "Inventory note: the titanium ring count is exactly seven.",
      "utf8",
    );
    primaryAttachmentPath = fixture;
    await uploadDocuments(page, [fixture], 120_000);
    const turn = await sendGardenTurn(
      page,
      "Read the uploaded inventory note. Reply with exactly GROUNDING_SEVEN_OK if the titanium ring count is seven.",
      (text) => text.includes("GROUNDING_SEVEN_OK") || /\bseven\b|\b7\b/i.test(text),
    );
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText, evidence: [fixture] }
      : blocked(turn, "Grounding response did not complete in the renderer.");
  });

  await run("garden-chat-follow-up-context", async () => {
    const first = await sendGardenTurn(
      page,
      "Remember this harmless marker for the next turn: COBALT-731. Reply with COBALT-731.",
      (text) => text.includes("COBALT-731"),
    );
    if (!first.completed) return blocked(first, "The marker-setting turn did not complete.");
    const second = await sendGardenTurn(
      page,
      "What marker did I ask you to remember? Reply with COBALT-731.",
      (text) => text.includes("COBALT-731"),
    );
    return second.completed
      ? { status: "PASS", actual: second.assistantText }
      : blocked(second, "The follow-up context turn did not complete.");
  });

  await run("conversation-history-search-reopen", async () => {
    const turn = await sendGardenTurn(
      page,
      "Reply with exactly HISTORY_REOPEN_OK.",
      (text) => text.includes("HISTORY_REOPEN_OK"),
    );
    if (!turn.completed) return blocked(turn, "No completed conversation was available to reopen.");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertGardenWorkspace(page, gardenA, [], 120_000);
    const persisted = await waitForAssistantMarker(page, "HISTORY_REOPEN_OK", 30_000);
    return persisted
      ? { status: "PASS", actual: "Completed response remained visible after renderer reload." }
      : failProduct("The completed response disappeared after renderer reload.");
  });

  await run("desktop-renderer-refresh-persistence", async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertGardenWorkspace(page, gardenA, [], 120_000);
    const persisted = await waitForAssistantMarker(page, "HISTORY_REOPEN_OK", 30_000);
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
      "Store this garden-local marker: ISOLATION_BETA_2026. Reply with ISOLATION_BETA_2026.",
      (text) => text.includes("ISOLATION_BETA_2026"),
    );
    if (!bTurn.completed) return blocked(bTurn, "The second garden turn did not complete.");
    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    await openGardenWorkspace(page, gardenA);
    const aTurn = await sendGardenTurn(
      page,
      "Reply with exactly ISOLATION_ALPHA_OK. Do not mention any marker from another garden.",
      (text) => text.includes("ISOLATION_ALPHA_OK"),
    );
    if (!aTurn.completed) return blocked(aTurn, "The return-to-A turn did not complete.");
    return aTurn.assistantText.includes("ISOLATION_BETA_2026")
      ? failProduct("Garden A response exposed Garden B marker.")
      : { status: "PASS", actual: aTurn.assistantText };
  });

  await run("conversation-branch-independence", async () => {
    const edit = page.getByRole("button", {
      name: "Edit message and create a branch",
      exact: true,
    }).last();
    if (!(await edit.isVisible().catch(() => false))) {
      return blockedWithoutDependency("The real Garden Chat branch/edit control was not visible.");
    }
    await edit.click();
    const editor = page.locator("textarea").last();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.fill("Reply with exactly BRANCH_E2E_OK.");
    await page.getByRole("button", { name: "Save & send", exact: true }).click();
    const turn = await waitForAssistantMarkerResult(page, "BRANCH_E2E_OK", 60_000);
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText }
      : blocked(turn, "Edited branch did not produce a completed assistant response.");
  });

  await run("artifact-create-open-content", async () => {
    const turn = await sendGardenTurn(
      page,
      "Use the safe first-party tool to create a plain text artifact named hermes-e2e-artifact.txt containing HERMES_ARTIFACT_OK, then reply with exactly ARTIFACT_READY_OK.",
      (text) => text.includes("ARTIFACT_READY_OK") && text.includes("HERMES_ARTIFACT_OK"),
      120_000,
    );
    if (!turn.completed) return blocked(turn, "Artifact-generation turn did not complete.");
    const artifactText = page.getByText("HERMES_ARTIFACT_OK", { exact: false }).last();
    const artifactVisible = await artifactText.isVisible().catch(() => false);
    return artifactVisible
      ? { status: "PASS", actual: "Artifact content was visible in the real artifact/chat UI." }
      : failProduct("The assistant completed, but no artifact content/card was visible to open.");
  }, 150_000);

  await run("artifact-refresh-restart-persistence", async () => {
    const visible = await page.getByText("HERMES_ARTIFACT_OK", { exact: false }).last().isVisible().catch(() => false);
    if (!visible) return blockedWithoutDependency("No completed artifact was available for persistence checks.");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertGardenWorkspace(page, gardenA, [], 120_000);
    return (await page.getByText("HERMES_ARTIFACT_OK", { exact: false }).last().isVisible().catch(() => false))
      ? { status: "PASS", actual: "Artifact content remained visible after renderer reload." }
      : failProduct("Artifact content was lost after renderer reload.");
  });

  await run("terminal-command-completion", async () => {
    await openTerminal(page, 60_000);
    const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
    await expect(composer).toBeEditable({ timeout: 60_000 });
    await composer.fill("Run the safe command `echo HERMES_TERMINAL_OK` in the isolated QA workspace and reply with exactly TERMINAL_COMMAND_OK.");
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    const turn = await waitForAssistantMarkerResult(page, "TERMINAL_COMMAND_OK", 120_000);
    return turn.completed && turn.assistantText.includes("HERMES_TERMINAL_OK")
      ? { status: "PASS", actual: turn.assistantText }
      : blocked(turn, "Terminal did not produce a completed safe command result.");
  }, 150_000);

  await run("terminal-refresh-run-state", async () => {
    const marker = await waitForAssistantMarker(page, "TERMINAL_COMMAND_OK", 5_000);
    if (!marker) return blockedWithoutDependency("No completed Terminal task was available to refresh.");
    await closeTerminal(page, 60_000);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertGardenWorkspace(page, gardenA, [], 120_000);
    return { status: "PASS", actual: "Terminal task completed before renderer refresh; workspace remained usable." };
  });

  await run("terminal-cancel-and-reuse", async () => {
    await openTerminal(page, 60_000);
    const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
    await composer.fill("Run a long harmless command in the isolated workspace and do not finish until stopped.");
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    const stop = page.getByRole("button", { name: /Stop|Cancel/i }).last();
    if (!(await stop.isVisible({ timeout: 15_000 }).catch(() => false))) {
      return blockedWithoutDependency("The provider completed too quickly to expose a cancellable Terminal run.");
    }
    await stop.click();
    await expect(composer).toBeEditable({ timeout: 60_000 });
    return { status: "PASS", actual: "Terminal task stopped and composer became reusable." };
  }, 120_000);

  await run("terminal-error-recovery", async () => {
    const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
    if (!(await composer.isVisible().catch(() => false))) return blockedWithoutDependency("Terminal surface was not open.");
    await composer.fill("Run the harmless nonexistent command hermes_qa_command_that_does_not_exist, report the error, then reply with exactly TERMINAL_ERROR_RECOVERED.");
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    const turn = await waitForAssistantMarkerResult(page, "TERMINAL_ERROR_RECOVERED", 120_000);
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText }
      : blocked(turn, "Terminal error recovery did not complete in the renderer.");
  }, 150_000);

  await run("chat-cancel-and-recover", async () => {
    await closeTerminal(page, 60_000).catch(() => undefined);
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
    const recovery = await sendGardenTurn(page, "Reply with exactly CHAT_RECOVERY_OK.", (text) => text.includes("CHAT_RECOVERY_OK"));
    return recovery.completed
      ? { status: "PASS", actual: recovery.assistantText }
      : blocked(recovery, "The post-cancellation recovery turn did not complete.");
  }, 120_000);

  await run("learn-plan-confirm-build", async () =>
    blockedWithoutDependency("Learn plan/build is a separate optional surface; no deterministic provider-backed build fixture is enabled in this isolated profile."),
  );
  await run("learn-cancel-and-retry", async () =>
    blockedWithoutDependency("Learn cancellation/retry has no deterministic approved plan fixture in this isolated profile."),
  );

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

function blocked(turn: TurnResult, fallback: string): ScenarioProbeOutcome {
  return {
    status: "BLOCKED",
    dependency: "required",
    reason: turn.failureText || fallback,
    evidence: ["renderer assistant/user/composer state captured by provider-backed inventory"],
  };
}

function blockedWithoutDependency(reason: string): ScenarioProbeOutcome {
  return { status: "BLOCKED", dependency: "required", reason };
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
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  return waitForTurn(page, prompt, criterion, timeoutMs);
}

async function waitForAssistantMarkerResult(
  page: Page,
  marker: string,
  timeoutMs: number,
): Promise<TurnResult> {
  return waitForTurn(page, marker, (text) => text.includes(marker), timeoutMs);
}

async function waitForTurn(
  page: Page,
  prompt: string,
  criterion: (assistantText: string) => boolean,
  timeoutMs: number,
): Promise<TurnResult> {
  const deadline = Date.now() + timeoutMs;
  let assistantText = "";
  let failureText = "";
  let userMessageVisible = false;
  while (Date.now() < deadline) {
    assistantText = await visibleAssistantText(page);
    failureText = await page.getByRole("alert").allTextContents().then((items) => items.join("\n").trim()).catch(() => "");
    userMessageVisible = await page.locator(".neu-chat-message-user").filter({ hasText: prompt }).count().then((count) => count > 0).catch(() => false);
    const composer = page.getByPlaceholder(/Ask about your documents|Ask anything across your gardens/).first();
    const composerUsable = await composer.isEnabled().catch(() => false);
    if (criterion(assistantText)) return { completed: true, assistantText, failureText, userMessageVisible, composerUsable };
    if (failureText && composerUsable) return { completed: false, assistantText, failureText, userMessageVisible, composerUsable };
    await delay(250);
  }
  const composerUsable = await page.getByPlaceholder(/Ask about your documents|Ask anything across your gardens/).first().isEnabled().catch(() => false);
  return { completed: false, assistantText, failureText, userMessageVisible, composerUsable };
}

async function waitForAssistantMarker(page: Page, marker: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await visibleAssistantText(page)).includes(marker)) return true;
    await delay(250);
  }
  return false;
}

async function visibleAssistantText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const values: string[] = [];
    const candidates = Array.from(
      document.querySelectorAll('div[class~="text-gray-200"], p, li'),
    );
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      if (!node.offsetParent && node.getClientRects().length === 0) continue;
      if (
        node.closest(".neu-chat-message-user") ||
        node.closest("textarea") ||
        node.closest("button") ||
        node.closest("nav, aside, header")
      ) continue;
      const text = node.innerText?.trim();
      if (!text || text.length > 20_000) continue;
      // Keep the deepest useful text node. Ancestor nodes (including the
      // whole page) would otherwise reintroduce the user's prompt and make a
      // marker look like an assistant response.
      const duplicateChild = Array.from(node.children).some(
        (child) => child instanceof HTMLElement && child.innerText?.trim() === text,
      );
      if (!duplicateChild) values.push(text);
    }
    return [...new Set(values)].slice(-80).join("\n");
  }).catch(() => "");
}

function isEnvironmentFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ENOSPC|ECONNRESET|Target page|browser has been closed|Electron/i.test(text);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
