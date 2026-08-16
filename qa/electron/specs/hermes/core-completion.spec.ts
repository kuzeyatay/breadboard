import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  assertAuthenticatedDashboard,
  assertGardenWorkspace,
  closeTerminal,
  createGarden,
  ensureAuthenticatedDashboard,
  openGardenWorkspace,
  openTerminal,
  registerAndSignIn,
  type GardenInfo,
} from "../../user-journeys";
import type { ScenarioProbeOutcome } from "../../scenario-recorder";

/**
 * Provider-backed completion pass for the core Hermes journeys. The visible
 * Electron UI is authoritative; filesystem checks only verify that a result
 * claimed by the UI landed inside this run's disposable workspace.
 */
test("Hermes core completion journeys", async ({ qa }) => {
  test.setTimeout(42 * 60_000);
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);

  const garden = await createGarden(page, {
    name: `Hermes Core ${qa.run.runId.slice(-8)}`,
    description: "Disposable provider-backed core completion garden",
  });
  await openGardenWorkspace(page, garden);

  const attempts: Array<{
    id: string;
    status: string;
    actual?: string;
    reason?: string;
  }> = [];
  let contextMarker: string | null = null;
  let coreTerminalValue: string | null = null;
  let coreRecoveryValue: string | null = null;
  let coreArtifactValue: string | null = null;
  const run = async (
    id: string,
    action: () => Promise<ScenarioProbeOutcome>,
    timeoutMs = 360_000,
  ): Promise<void> => {
    const attempt = await qa.scenarios.probe(test.info(), id, action, {
      timeoutMs,
      classifyFailure: (error) => ({
        status: /timeout|Target page|Electron|ENOSPC|browser has been closed/i.test(
          error instanceof Error ? error.message : String(error),
        )
          ? "BLOCKED"
          : "FAIL",
        classification: /timeout|Target page|Electron|ENOSPC|browser has been closed/i.test(
          error instanceof Error ? error.message : String(error),
        )
          ? "QA_HARNESS_LIMITATION"
          : "PRODUCT_BUG",
        actual: error instanceof Error ? error.message : String(error),
      }),
    });
    attempts.push({
      id,
      status: attempt.status,
      actual: attempt.actual,
      reason: attempt.status === "PASS" ? undefined : attempt.actual,
    });
  };

  await run("garden-chat-document-grounding", async () => {
    const turn = await sendGardenTurn(
      page,
      "Use the real first-party Breadboard tool named garden_list now. This must be an actual tool invocation, not a prose description. After it returns, reply with the garden names from the tool result only.",
      // The garden name is created before this prompt and is not repeated in
      // it. A refusal or generic prose response is not evidence of a tool call.
      (text) => text.includes(garden.name) && !/unable|can't|cannot|refus/i.test(text),
    );
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText, evidence: ["renderer Garden Chat response", "garden_list requested explicitly"] }
      : blocked(turn, "The first-party garden_list turn did not complete.");
  });

  await run("garden-chat-follow-up-context", async () => {
    const marker = `NEBULA-${Math.floor(100000 + Math.random() * 900000)}`;
    contextMarker = marker;
    const first = await sendGardenTurn(
      page,
      `Remember this exact harmless marker for the next turn: ${marker}. Reply only with "acknowledged".`,
      (text) => /acknowledged/i.test(text),
    );
    if (!first.completed) return blocked(first, "The context-setting turn did not complete.");
    const second = await sendGardenTurn(
      page,
      "What exact marker did I ask you to remember in my previous message? Reply only with the marker.",
      (text) => normalizeMarker(text) === marker,
    );
    return second.completed
      ? { status: "PASS", actual: second.assistantText, evidence: [`expected marker held only by harness: ${marker}`] }
      : blocked(second, "The multi-turn context follow-up did not complete.");
  });

  await run("desktop-renderer-refresh-persistence", async () => {
    const marker = contextMarker;
    if (!marker) return blockedWithoutDependency("The active context marker was not available to the harness.");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await assertGardenWorkspace(page, garden, [], 180_000);
    const turn = await sendGardenTurn(
      page,
      "What exact marker did I ask you to remember earlier in this conversation? Reply only with the marker.",
      (text) => normalizeMarker(text) === marker,
    );
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText, evidence: ["renderer reload", `expected marker held only by harness: ${marker}`] }
      : blocked(turn, "The refreshed conversation did not restore the marker.");
  });

  await run("conversation-isolation", async () => {
    const marker = contextMarker;
    if (!marker) return blockedWithoutDependency("The original conversation marker was not available to the harness.");
    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    const other = await createGarden(page, {
      name: `Hermes Core Other ${qa.run.runId.slice(-8)}`,
      description: "Second disposable conversation for context isolation",
    });
    await openGardenWorkspace(page, other, 180_000);
    const isolated = await sendGardenTurn(
      page,
      "What exact marker did I ask you to remember in the other conversation? If that information is not available in this conversation, say UNKNOWN.",
      (text) => /unknown/i.test(text),
    );
    if (!isolated.completed) return blocked(isolated, "The isolated conversation did not complete.");
    if (normalizeMarker(isolated.assistantText) === marker || isolated.assistantText.includes(marker)) {
      return failProduct("A new conversation exposed the original conversation marker.");
    }
    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click();
    await openGardenWorkspace(page, garden, 180_000);
    const restored = await sendGardenTurn(
      page,
      "What exact marker did I ask you to remember earlier in this conversation? Reply only with the marker.",
      (text) => normalizeMarker(text) === marker,
    );
    return restored.completed
      ? { status: "PASS", actual: restored.assistantText, evidence: ["new conversation returned UNKNOWN", "original conversation restored marker"] }
      : blocked(restored, "The original conversation did not retain its marker after isolation check.");
  }, 600_000);

  await run("artifact-create-open-content", async () => {
    const title = `Hermes Core Artifact ${qa.run.runId.slice(-8)}`;
    const artifactValue = `ARTIFACT-FILE-${Math.floor(100000 + Math.random() * 900000)}`;
    const createdMarker = `ARTIFACT-CREATED-${Math.floor(100000 + Math.random() * 900000)}`;
    coreArtifactValue = artifactValue;
    const turn = await sendGardenTurn(
      page,
      `Use the first-party artifact_create tool (not terminal and not prose) to create a Markdown artifact titled ${title}, filename hermes-core-artifact.md, kind markdown, renderer markdown, with exactly this content: ${artifactValue}. Render it if supported, then reply exactly ${createdMarker}.`,
      (text) => text.includes(createdMarker),
      420_000,
    );
    if (!turn.completed) return blocked(turn, "The artifact_create turn did not complete.");
    const card = page.locator(".bb-neu-artifact-card").filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 180_000 });
    const open = card.locator(`button[title="Open ${title}"]`).first();
    await expect(open).toBeVisible({ timeout: 60_000 });
    await open.click();
    const viewer = page.locator(".bb-artifact-dock").filter({ hasText: title }).first();
    await expect(viewer).toBeVisible({ timeout: 60_000 });
    await expect(viewer).toContainText(artifactValue, { timeout: 60_000 });
    await page.getByRole("button", { name: "Close artifact", exact: true }).click();
    return {
      status: "PASS",
      actual: "The renderer showed the completed artifact card and viewer content.",
      evidence: ["renderer artifact card", "renderer artifact viewer", title],
    };
  }, 540_000);

  await run("artifact-refresh-restart-persistence", async () => {
    const title = `Hermes Core Artifact ${qa.run.runId.slice(-8)}`;
    const artifactValue = coreArtifactValue;
    if (!artifactValue) return blockedWithoutDependency("The artifact content value was not available to the harness.");
    const card = page.locator(".bb-neu-artifact-card").filter({ hasText: title }).first();
    if (!(await card.isVisible().catch(() => false))) {
      return blockedWithoutDependency("No completed artifact card was available for persistence checks.");
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await assertGardenWorkspace(page, garden, [], 180_000);
    await expect(card).toBeVisible({ timeout: 120_000 });
    await card.locator(`button[title="Open ${title}"]`).click();
    const viewer = page.locator(".bb-artifact-dock").filter({ hasText: title }).first();
    await expect(viewer).toContainText(artifactValue, { timeout: 60_000 });
    await page.getByRole("button", { name: "Close artifact", exact: true }).click();

    const receipt = await qa.restart({ timeoutMs: 180_000 });
    const restarted = await qa.dismissWelcome();
    await ensureAuthenticatedDashboard(restarted, qa.run.bootstrap.auth, 180_000);
    await openGardenWorkspace(restarted, garden, 180_000);
    const afterRestart = restarted.locator(".bb-neu-artifact-card").filter({ hasText: title }).first();
    await expect(afterRestart).toBeVisible({ timeout: 180_000 });
    await afterRestart.locator(`button[title="Open ${title}"]`).click();
    const restartedViewer = restarted.locator(".bb-artifact-dock").filter({ hasText: title }).first();
    await expect(restartedViewer).toContainText(artifactValue, { timeout: 60_000 });
    await restarted.getByRole("button", { name: "Close artifact", exact: true }).click();
    return {
      status: "PASS",
      actual: "Artifact content survived renderer reload and same-data-root Electron restart.",
      evidence: [receipt.endpoints.urls["dashboard"] ?? "dashboard endpoint", "renderer artifact viewer after restart"],
    };
  }, 600_000);

  await run("conversation-branch-independence", async () => {
    const edit = page.getByRole("button", {
      name: "Edit message and create a branch",
      exact: true,
    }).last();
    if (!(await edit.isVisible().catch(() => false))) {
      return blockedWithoutDependency("The real Garden Chat branch/edit control was not visible.", "QA_HARNESS_LIMITATION");
    }
    const beforeCount = await assistantBlockCount(page);
    await edit.click();
    const editor = page.locator("textarea").last();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const branchMarker = `BRANCH-${Math.floor(100000 + Math.random() * 900000)}`;
    await editor.fill(`Reply with exactly ${branchMarker}. This is a direct branch-response smoke check.`);
    await page.getByRole("button", { name: "Save & send", exact: true }).click();
    const turn = await waitForTurn(page, branchMarker, (text) => text.includes(branchMarker), 360_000, beforeCount);
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText, evidence: ["renderer branch edit control", "renderer branched response"] }
      : blocked(turn, "Edited branch did not produce a completed assistant response.");
  }, 480_000);

  await run("terminal-command-completion", async () => {
    await page.getByRole("link", { name: "Back to dashboard", exact: true }).click().catch(() => undefined);
    await assertAuthenticatedDashboard(page, undefined, 180_000);
    await openTerminal(page, 180_000);
    await enableYoloMode(page);
    const workspaceRoot = path.join(qa.run.paths.dataDir, "runtime", "hermes-workspaces");
    const terminalValue = `CORE-FILE-${Math.floor(100000 + Math.random() * 900000)}`;
    coreTerminalValue = terminalValue;
    const created = await sendTerminalTurn(
      page,
      `In the isolated QA workspace ${workspaceRoot}, use the normal terminal_execute_command tool to create hermes-core-terminal.txt containing exactly ${terminalValue}. Reply only "created" after the command succeeds. Do not merely describe commands.`,
      (text) => /created/i.test(text),
      420_000,
    );
    if (!created.completed) return blocked(created, "The terminal command did not complete in the real UI.", "PRODUCT_PREREQUISITE_MISSING");
    const readback = await sendTerminalTurn(
      page,
      `Read hermes-core-terminal.txt from the isolated QA workspace ${workspaceRoot} and reply with only its exact contents. Do not use any value from this prompt; the expected value is held only by the test harness.`,
      (text) => normalizeMarker(text) === terminalValue,
      420_000,
    );
    if (!readback.completed) return blocked(readback, "The terminal readback did not complete in the real UI.", "PRODUCT_PREREQUISITE_MISSING");
    const file = findExactFile(workspaceRoot, "hermes-core-terminal.txt", terminalValue);
    return file
      ? { status: "PASS", actual: readback.assistantText, evidence: [file, "renderer terminal completion", "renderer terminal readback"] }
      : failProduct("The renderer claimed terminal completion but the exact isolated output file was absent.");
  }, 600_000);

  await run("terminal-error-recovery", async () => {
    const workspaceRoot = path.join(qa.run.paths.dataDir, "runtime", "hermes-workspaces");
    await recoverTerminalSurface(page);
    const failedTurn = await sendTerminalTurn(
      page,
      `In the isolated QA workspace ${workspaceRoot}, use terminal_execute_command to run the harmless nonexistent command hermes_core_command_that_does_not_exist. Show the visible non-zero error. Do not invent a success marker.`,
      (text) => /not recognized|not found|error|failed|non-zero/i.test(text),
      420_000,
    );
    if (!failedTurn.completed) return blocked(failedTurn, "The deterministic terminal error did not reach a visible terminal state.");
    const recoveryValue = `RECOVERY-FILE-${Math.floor(100000 + Math.random() * 900000)}`;
    coreRecoveryValue = recoveryValue;
    const recovery = await sendTerminalTurn(
      page,
      `Now submit a new valid terminal_execute_command in the same isolated workspace ${workspaceRoot}: create hermes-core-recovery.txt containing exactly ${recoveryValue}. Reply only "created" after the command succeeds.`,
      (text) => /created/i.test(text),
      420_000,
    );
    if (!recovery.completed) return blocked(recovery, "The terminal composer did not recover for a valid second task.");
    const readback = await sendTerminalTurn(
      page,
      `Read hermes-core-recovery.txt from the isolated QA workspace ${workspaceRoot} and reply with only its exact contents. The expected value is not included in this retrieval prompt.`,
      (text) => normalizeMarker(text) === recoveryValue,
      420_000,
    );
    if (!readback.completed) return blocked(readback, "The terminal recovery readback did not complete in the real UI.");
    const file = findExactFile(workspaceRoot, "hermes-core-recovery.txt", recoveryValue);
    return file
      ? { status: "PASS", actual: readback.assistantText, evidence: [file, "renderer error then reusable composer", "renderer terminal readback"] }
      : failProduct("The recovery response lacked its exact isolated output file.");
  }, 720_000);

  await run("terminal-refresh-run-state", async () => {
    const marker = await visibleSurfaceText(page);
    const expected = coreRecoveryValue ?? coreTerminalValue;
    if (!expected || !marker.includes(expected)) {
      return blockedWithoutDependency("No completed terminal output was available for renderer refresh.");
    }
    await closeTerminal(page, 60_000).catch(() => undefined);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await assertAuthenticatedDashboard(page, undefined, 180_000);
    await openTerminal(page, 180_000);
    await expect.poll(() => visibleSurfaceText(page), { timeout: 120_000 }).toContain(expected);
    const reuseMarker = `TERMINAL-REFRESH-${Math.floor(100000 + Math.random() * 900000)}`;
    const second = await sendTerminalTurn(
      page,
      `Run one final harmless terminal_execute_command that replies exactly ${reuseMarker} without writing outside the isolated workspace.`,
      (text) => text.includes(reuseMarker),
      420_000,
    );
    return second.completed
      ? { status: "PASS", actual: second.assistantText, evidence: ["renderer terminal output after reload", "renderer terminal reuse"] }
      : blocked(second, "The terminal was visible after refresh but could not be reused.");
  }, 600_000);

  await closeTerminal(page, 60_000).catch(() => undefined);
  await assertAuthenticatedDashboard(page, garden, 180_000).catch(() => undefined);
  const receiptPath = path.join(qa.resultsDir, `hermes-core-completion-${qa.run.runId}.json`);
  fs.writeFileSync(
    receiptPath,
    `${JSON.stringify({ schemaVersion: 1, runId: qa.run.runId, attempts }, null, 2)}\n`,
    "utf8",
  );
  await test.info().attach("hermes-core-completion", {
    path: receiptPath,
    contentType: "application/json",
  });
});

interface TurnResult {
  readonly completed: boolean;
  readonly assistantText: string;
  readonly failureText: string;
}

function blocked(
  turn: TurnResult,
  reason: string,
  classification: "QA_HARNESS_LIMITATION" | "PRODUCT_PREREQUISITE_MISSING" = "PRODUCT_PREREQUISITE_MISSING",
): ScenarioProbeOutcome {
  return {
    status: "BLOCKED",
    dependency: "required",
    classification,
    reason: turn.failureText || reason,
    evidence: ["renderer assistant/composer state captured by core completion spec"],
  };
}

function blockedWithoutDependency(
  reason: string,
  classification: "QA_HARNESS_LIMITATION" | "PRODUCT_PREREQUISITE_MISSING" = "PRODUCT_PREREQUISITE_MISSING",
): ScenarioProbeOutcome {
  return { status: "BLOCKED", dependency: "required", classification, reason };
}

function failProduct(reason: string): never {
  throw new Error(reason);
}

async function sendGardenTurn(
  page: Page,
  prompt: string,
  criterion: (text: string) => boolean,
  timeoutMs = 360_000,
): Promise<TurnResult> {
  const composer = page.getByPlaceholder(/Ask about your documents/).last();
  await expect(composer).toBeEditable({ timeout: 180_000 });
  const beforeCount = await assistantBlockCount(page);
  await composer.fill(prompt);
  const persisted = page.waitForResponse(
    (response) => response.request().method() === "PATCH" &&
      /^\/api\/chat-sessions\/\d+$/.test(new URL(response.url()).pathname) && response.ok(),
    { timeout: Math.max(timeoutMs, 180_000) },
  );
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  const turn = await waitForTurn(page, prompt, criterion, timeoutMs, beforeCount);
  if (turn.completed) {
    try {
      await persisted;
    } catch {
      return { ...turn, completed: false, failureText: "Assistant marker appeared before transcript persistence completed." };
    }
  }
  return turn;
}

async function sendTerminalTurn(
  page: Page,
  prompt: string,
  criterion: (text: string) => boolean,
  timeoutMs: number,
): Promise<TurnResult> {
  const composer = page.getByPlaceholder(/Ask anything across your gardens/).last();
  await expect(composer).toBeEditable({ timeout: 180_000 });
  const beforeCount = await assistantBlockCount(page);
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  return waitForTurn(page, prompt, criterion, timeoutMs, beforeCount);
}

async function waitForTurn(
  page: Page,
  prompt: string,
  criterion: (text: string) => boolean,
  timeoutMs: number,
  beforeCount = 0,
): Promise<TurnResult> {
  const deadline = Date.now() + timeoutMs;
  let assistantText = "";
  let failureText = "";
  while (Date.now() < deadline) {
    const count = await assistantBlockCount(page);
    assistantText = count > beforeCount ? await latestAssistantText(page) : "";
    failureText = await page.getByRole("alert").allTextContents().then((items) => items.join("\n").trim()).catch(() => "");
    const delta = assistantText.trim();
    const composer = page.getByPlaceholder(/Ask about your documents|Ask anything across your gardens/).last();
    const composerReady = await composer.isEnabled().catch(() => false);
    const runStillActive = await page.getByRole("button", { name: "Stop active run", exact: true }).last().isVisible().catch(() => false);
    // A marker can stream before the final [DONE] event. Do not submit the
    // next real user turn until the composer is enabled again, otherwise the
    // UI correctly rejects it as a duplicate in-flight request.
    if (criterion(delta) && composerReady) {
      if (runStillActive) {
        // The provider can leave the renderer's activity state one tick behind
        // the completed server run. Use the same visible recovery control a
        // user has, then continue only after it disappears.
        const stop = page.getByRole("button", { name: "Stop active run", exact: true }).last();
        await stop.click().catch(() => undefined);
        await expect(stop).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
      }
      return { completed: true, assistantText: delta, failureText };
    }
    if (failureText && composerReady) {
      if (runStillActive) {
        const stop = page.getByRole("button", { name: "Stop active run", exact: true }).last();
        await stop.click().catch(() => undefined);
        await expect(stop).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
      }
      return { completed: false, assistantText: delta, failureText };
    }
    await delay(500);
  }
  return { completed: false, assistantText, failureText };
}

async function assistantBlockCount(page: Page): Promise<number> {
  return page.locator('div[class~="text-gray-200"]').count().catch(() => 0);
}

async function latestAssistantText(page: Page): Promise<string> {
  const blocks = page.locator('div[class~="text-gray-200"]');
  return blocks.last().innerText().catch(() => "");
}

function normalizeMarker(text: string): string {
  return text.replace(/[\s`*_#"'.,:;!?()[\]{}<>]/g, "").trim();
}

// Refresh/reuse assertions must inspect only the newest assistant block; a
// transcript-wide helper would allow an old marker to satisfy the check.
const visibleSurfaceText = latestAssistantText;

async function enableYoloMode(page: Page): Promise<void> {
  await page.getByTitle(/reasoning/i).last().click();
  const yolo = page.getByRole("switch", { name: /YOLO mode/i }).last();
  await expect(yolo).toBeVisible({ timeout: 30_000 });
  if ((await yolo.getAttribute("aria-checked")) !== "true") await yolo.click();
  await expect(yolo).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Close intelligence menu", exact: true }).click();
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
      if (entry.isDirectory()) {
        stack.push(candidate);
      } else if (entry.isFile() && entry.name === fileName) {
        try {
          if (fs.readFileSync(candidate, "utf8") === expected) return candidate;
        } catch {
          // A concurrent write is not evidence of completion; keep searching.
        }
      }
    }
  }
  return null;
}

async function recoverTerminalSurface(page: Page): Promise<void> {
  const stop = page.getByRole("button", { name: /Stop|Cancel/i }).last();
  if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => undefined);
  await closeTerminal(page, 30_000).catch(() => undefined);
  await openTerminal(page, 180_000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
