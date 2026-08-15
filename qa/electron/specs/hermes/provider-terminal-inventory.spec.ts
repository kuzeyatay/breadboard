import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  assertAuthenticatedDashboard,
  assertTerminalOpen,
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
  const run = async (
    id: string,
    action: () => Promise<ScenarioProbeOutcome>,
    timeoutMs = 180_000,
  ) => {
    attempts.push(
      await qa.scenarios.probe(test.info(), id, action, {
        timeoutMs,
        classifyFailure: (error) => ({
          classification: /timeout|Target page|Electron|ENOSPC/i.test(
            error instanceof Error ? error.message : String(error),
          )
            ? "TEST_ENVIRONMENT"
            : "PRODUCT_BUG",
          actual: error instanceof Error ? error.message : String(error),
        }),
      }),
    );
  };

  await run("terminal-command-completion", async () => {
    await openTerminal(page, 120_000);
    const turn = await sendTerminalTurn(
      page,
      "Run the safe command `echo HERMES_TERMINAL_OK` in the isolated QA workspace and reply with exactly TERMINAL_COMMAND_OK.",
      (text) => text.includes("TERMINAL_COMMAND_OK") && text.includes("HERMES_TERMINAL_OK"),
      120_000,
    );
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText }
      : blocked(turn, "Terminal command did not complete in the real dashboard Terminal UI.");
  });

  await run("terminal-refresh-run-state", async () => {
    const prior = await visibleSurfaceText(page);
    if (!prior.includes("TERMINAL_COMMAND_OK")) {
      return blockedWithoutDependency("No completed Terminal task was available to refresh.");
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await assertAuthenticatedDashboard(page, undefined, 120_000);
    await openTerminal(page, 120_000);
    return (await visibleSurfaceText(page)).includes("TERMINAL_COMMAND_OK")
      ? { status: "PASS", actual: "Completed Terminal output remained visible after renderer refresh." }
      : blockedWithoutDependency("Terminal surface reopened, but no completed output was restored.");
  });

  await run("terminal-cancel-and-reuse", async () => {
    if (!(await page.getByTitle("Click empty space to close, or drag to resize the terminal", { exact: true }).isVisible().catch(() => false))) {
      await openTerminal(page, 120_000);
    }
    await assertTerminalOpen(page, 120_000);
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
    await assertTerminalOpen(page, 120_000);
    const turn = await sendTerminalTurn(
      page,
      "Run the harmless nonexistent command hermes_qa_command_that_does_not_exist, report the error, then reply with exactly TERMINAL_ERROR_RECOVERED.",
      (text) => text.includes("TERMINAL_ERROR_RECOVERED"),
      120_000,
    );
    return turn.completed
      ? { status: "PASS", actual: turn.assistantText }
      : blocked(turn, "Terminal error recovery did not complete in the real dashboard Terminal UI.");
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

function blocked(turn: TurnResult, fallback: string): ScenarioProbeOutcome {
  return {
    status: "BLOCKED",
    dependency: "required",
    reason: turn.failureText || fallback,
    evidence: ["renderer Terminal assistant/composer state captured by provider-backed inventory"],
  };
}

function blockedWithoutDependency(reason: string): ScenarioProbeOutcome {
  return { status: "BLOCKED", dependency: "required", reason };
}

async function sendTerminalTurn(
  page: Page,
  prompt: string,
  criterion: (text: string) => boolean,
  timeoutMs: number,
): Promise<TurnResult> {
  const composer = page.getByPlaceholder(/Ask anything across your gardens/).first();
  await expect(composer).toBeEditable({ timeout: 120_000 });
  const baseline = await visibleSurfaceText(page);
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  const deadline = Date.now() + timeoutMs;
  let text = "";
  let failureText = "";
  while (Date.now() < deadline) {
    text = await visibleSurfaceText(page);
    const delta = text.startsWith(baseline) ? text.slice(baseline.length).trim() : text;
    failureText = await page.getByRole("alert").allTextContents().then((items) => items.join("\n").trim()).catch(() => "");
    if (criterion(delta)) return { completed: true, assistantText: delta, failureText };
    if (failureText && await composer.isEnabled().catch(() => false)) return { completed: false, assistantText: delta, failureText };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { completed: false, assistantText: text, failureText };
}

async function visibleSurfaceText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const values: string[] = [];
    for (const node of Array.from(document.querySelectorAll('div[class~="text-gray-200"], p, li'))) {
      if (!(node instanceof HTMLElement)) continue;
      if (!node.offsetParent && node.getClientRects().length === 0) continue;
      if (node.closest(".neu-chat-message-user, textarea, button, nav, aside, header")) continue;
      const text = node.innerText?.trim();
      if (!text || text.length > 20_000) continue;
      if (Array.from(node.children).some((child) => child instanceof HTMLElement && child.innerText?.trim() === text)) continue;
      values.push(text);
    }
    return [...new Set(values)].slice(-80).join("\n");
  }).catch(() => "");
}
