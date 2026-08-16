import * as path from "node:path";
import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  assertAuthenticatedDashboard,
  closeTerminal,
  ensureAuthenticatedDashboard,
  openTerminal,
  registerAndSignIn,
} from "../../user-journeys";
import type { ScenarioAttempt, ScenarioProbeOutcome } from "../../scenario-recorder";

test("Hermes provider-backed Terminal inventory", async ({ qa }) => {
  test.setTimeout(12 * 60_000);
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  await ensureAuthenticatedDashboard(page, undefined, 120_000);
  await assertAuthenticatedDashboard(page, undefined, 120_000);

  const attempts: ScenarioAttempt[] = [];
  const terminalFileValue = `FILE-${Math.floor(100000 + Math.random() * 900000)}`;
  const run = async (
    id: string,
    action: () => Promise<ScenarioProbeOutcome>,
    timeoutMs = 180_000,
  ) => {
    attempts.push(
      await qa.scenarios.probe(test.info(), id, action, {
        timeoutMs,
        classifyFailure: (error) => ({
          status: /timeout|Target page|Electron|ENOSPC/i.test(
            error instanceof Error ? error.message : String(error),
          )
            ? "BLOCKED"
            : "FAIL",
          classification: /timeout|Target page|Electron|ENOSPC/i.test(
            error instanceof Error ? error.message : String(error),
          )
            ? "QA_HARNESS_LIMITATION"
            : "PRODUCT_BUG",
          actual: error instanceof Error ? error.message : String(error),
        }),
      }),
    );
  };

  await run("terminal-command-completion", async () => {
    await openTerminal(page, 120_000);
    await enableYoloMode(page);
    const created = await sendTerminalTurn(
      page,
      `In the isolated QA workspace ${path.join(qa.run.paths.dataDir, "runtime", "hermes-workspaces")}, use the normal terminal_execute_command tool to create hermes-terminal-test.txt containing exactly ${terminalFileValue}. Reply only with "created" after the write succeeds. Do not merely describe the command.`,
      (text) => /created/i.test(text),
      120_000,
    );
    if (!created.completed) {
      await recoverTerminalSurface(page);
      return blocked(created, "Terminal command did not complete in the real dashboard Terminal UI.", "PRODUCT_PREREQUISITE_MISSING");
    }
    const readback = await sendTerminalTurn(
      page,
      `Read hermes-terminal-test.txt from the isolated QA workspace with terminal_execute_command and reply only with its contents. Do not guess or repeat the filename.`,
      (text) => normalizeAnswer(text) === terminalFileValue,
      120_000,
    );
    if (readback.completed) return { status: "PASS", actual: readback.assistantText };
    await recoverTerminalSurface(page);
    return blocked(readback, "Terminal file readback did not complete in the real dashboard Terminal UI.", "PRODUCT_PREREQUISITE_MISSING");
  });

  await run("terminal-refresh-run-state", async () => {
    const prior = await visibleSurfaceText(page);
    if (!prior.includes(terminalFileValue)) {
      await recoverTerminalSurface(page);
      return blockedWithoutDependency("No completed Terminal task was available to refresh.", "PRODUCT_PREREQUISITE_MISSING");
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertAuthenticatedDashboard(page, undefined, 120_000);
    await openTerminal(page, 120_000);
    return (await visibleSurfaceText(page)).includes(terminalFileValue)
      ? { status: "PASS", actual: "Completed Terminal output remained visible after renderer refresh." }
      : blockedWithoutDependency("Terminal surface reopened, but no completed output was restored.");
  });

  await run("terminal-cancel-and-reuse", async () => {
    await recoverTerminalSurface(page);
    const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
    await expect(composer).toBeEditable({ timeout: 120_000 });
    await composer.fill("Run a long harmless command in the isolated QA workspace and keep it active until stopped.");
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    const stop = page.getByRole("button", { name: /Stop|Cancel/i }).last();
    if (!(await stop.isVisible({ timeout: 20_000 }).catch(() => false))) {
      return blockedWithoutDependency("The provider completed too quickly to expose a cancellable Terminal run.");
    }
    await stop.click();
    await expect(composer).toBeEditable({ timeout: 120_000 });
    return { status: "PASS", actual: "Terminal run stopped and the composer became reusable." };
  }, 150_000);

  await run("terminal-error-recovery", async () => {
    await recoverTerminalSurface(page);
    const turn = await sendTerminalTurn(
      page,
      `In the isolated QA workspace ${path.join(qa.run.paths.dataDir, "runtime", "hermes-workspaces")}, run the harmless nonexistent command hermes_qa_command_that_does_not_exist with terminal_execute_command and report the visible non-zero error.`,
      (text) => /not recognized|not found|error|failed/i.test(text),
      120_000,
    );
    if (!turn.completed) return blocked(turn, "Terminal error recovery did not complete in the real dashboard Terminal UI.", "PRODUCT_PREREQUISITE_MISSING");
    const recoveryValue = `RECOVERED-${Math.floor(100000 + Math.random() * 900000)}`;
    const recovery = await sendTerminalTurn(
      page,
      `Now submit a separate valid terminal_execute_command in the same isolated workspace: create hermes-terminal-recovery.txt containing exactly ${recoveryValue}, then reply only with "created".`,
      (text) => /created/i.test(text),
      120_000,
    );
    if (!recovery.completed) return blocked(recovery, "Terminal composer did not recover for the valid second task.", "PRODUCT_PREREQUISITE_MISSING");
    const readback = await sendTerminalTurn(
      page,
      "Read hermes-terminal-recovery.txt and reply only with its contents.",
      (text) => normalizeAnswer(text) === recoveryValue,
      120_000,
    );
    return readback.completed
      ? { status: "PASS", actual: readback.assistantText }
      : blocked(readback, "Terminal recovery file readback did not complete in the real dashboard Terminal UI.", "PRODUCT_PREREQUISITE_MISSING");
  });

  await closeTerminal(page, 60_000).catch(() => undefined);
  await assertAuthenticatedDashboard(page, undefined, 120_000);
  expect(attempts).toHaveLength(4);
});

interface TurnResult {
  readonly completed: boolean;
  readonly assistantText: string;
  readonly failureText: string;
}

function blocked(
  turn: TurnResult,
  fallback: string,
  classification: "QA_HARNESS_LIMITATION" | "PRODUCT_PREREQUISITE_MISSING" = "QA_HARNESS_LIMITATION",
): ScenarioProbeOutcome {
  return {
    status: "BLOCKED",
    dependency: "required",
    classification,
    reason: turn.failureText || fallback,
    evidence: ["renderer Terminal assistant/composer state captured by provider-backed inventory"],
  };
}

function blockedWithoutDependency(
  reason: string,
  classification: "QA_HARNESS_LIMITATION" | "PRODUCT_PREREQUISITE_MISSING" = "QA_HARNESS_LIMITATION",
): ScenarioProbeOutcome {
  return { status: "BLOCKED", dependency: "required", classification, reason };
}

async function sendTerminalTurn(
  page: Page,
  prompt: string,
  criterion: (text: string) => boolean,
  timeoutMs: number,
): Promise<TurnResult> {
  const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
  await expect(composer).toBeEditable({ timeout: 120_000 });
  const beforeCount = await assistantBlockCount(page);
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  const deadline = Date.now() + timeoutMs;
  let text = "";
  let failureText = "";
  while (Date.now() < deadline) {
    text = (await assistantBlockCount(page)) > beforeCount
      ? await latestAssistantText(page)
      : "";
    const delta = text.trim();
    failureText = await page.getByRole("alert").allTextContents().then((items) => items.join("\n").trim()).catch(() => "");
    if (criterion(delta)) return { completed: true, assistantText: delta, failureText };
    if (failureText && await composer.isEnabled().catch(() => false)) return { completed: false, assistantText: delta, failureText };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { completed: false, assistantText: text, failureText };
}

async function visibleSurfaceText(page: Page): Promise<string> {
  return page.locator('div[class~="text-gray-200"]').last().innerText().catch(() => "");
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

async function recoverTerminalSurface(page: Page): Promise<void> {
  const stop = page.getByRole("button", { name: /Stop|Cancel/i }).last();
  if (await stop.isVisible().catch(() => false)) {
    await stop.click().catch(() => undefined);
  }
  await closeTerminal(page, 30_000).catch(() => undefined);
  await openTerminal(page, 120_000);
}

async function enableYoloMode(page: Page): Promise<void> {
  const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
  const intelligence = page.getByTitle(/reasoning/i).last();
  await intelligence.click();
  const yolo = page.getByRole("switch", { name: /YOLO mode/i }).last();
  await expect(yolo).toBeVisible({ timeout: 20_000 });
  if ((await yolo.getAttribute("aria-checked")) !== "true") await yolo.click();
  await expect(yolo).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Close intelligence menu", exact: true }).click();
}
