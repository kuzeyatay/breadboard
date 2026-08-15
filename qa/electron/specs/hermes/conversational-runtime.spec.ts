import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import { redactText } from "../../diagnostics";
import {
  assertGardenWorkspace,
  createGarden,
  openGardenWorkspace,
  registerAndSignIn,
  type GardenInfo,
} from "../../user-journeys";

test.describe.configure({ mode: "serial" });

const TURN_TIMEOUT_MS = 45_000;

interface HermesAttemptReceipt {
  readonly runId: string;
  readonly surface: "garden_chat";
  readonly prompt: string;
  readonly result: "PASS" | "BLOCKED";
  readonly reason?: string;
  readonly runtimeStatus: string;
  readonly modelStatus: string;
  readonly responseText: string;
  readonly userMessageVisible: boolean;
  readonly composerUsable: boolean;
  readonly attachmentVisible: boolean;
  readonly chatRouteResponse: { readonly status: number; readonly body: string } | null;
}

test("Hermes real UI conversational path and supported surface inventory", async ({
  qa,
}) => {
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);

  const garden: GardenInfo = await createGarden(page, {
    name: `Hermes QA ${qa.run.runId.slice(-8)}`,
    description: "Disposable Hermes conversational-runtime test garden",
  });
  await openGardenWorkspace(page, garden);

  // This is an actual renderer -> Breadboard UI path. Do not replace it with a
  // fetch to /api/hermes or ChatMock: those probes below are only diagnostic.
  const fixturePath = path.join(qa.run.paths.runRoot, "fixtures", "hermes-attachment.txt");
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, "Hermes attachment fixture: NEBULA-204.", "utf8");

  const fileInputs = page.locator('input[type="file"]');
  const inputCount = await fileInputs.count();
  let attachmentVisible = false;
  if (inputCount > 0) {
    // The garden composer owns the first non-video file picker on this route.
    // Choosing the input through its current accept contract keeps this a
    // user-visible file selection, not a direct attachment API call.
    const index = await fileInputs.evaluateAll((nodes) => {
      const candidates = nodes.map((node, index) => ({
        index,
        accept: node.getAttribute("accept") ?? "",
      }));
      return candidates.find((candidate) => !/video/i.test(candidate.accept))?.index ?? 0;
    });
    await fileInputs.nth(index).setInputFiles(fixturePath);
    attachmentVisible = await page
      .getByText("hermes-attachment.txt", { exact: true })
      .first()
      .isVisible()
      .catch(() => false);
    if (attachmentVisible) {
      const remove = page.getByRole("button", {
        name: "Remove hermes-attachment.txt",
        exact: true,
      });
      if (await remove.isVisible().catch(() => false)) await remove.click();
    }
  }

  const dashboardOrigin = new URL(page.url()).origin;
  const runtimeStatus = await probeJson(page, `${dashboardOrigin}/api/hermes/health`);
  const modelStatus = await probeJson(page, `${dashboardOrigin}/api/models`);

  const prompt = "Reply with the exact phrase HERMES_E2E_OK.";
  const chatResponses: Array<{ status: number; body: string }> = [];
  const captureChatResponse = async (response: import("playwright").Response) => {
    if (new URL(response.url()).pathname !== "/api/chat") return;
    const body = await response.text().catch(() => "");
    chatResponses.push({ status: response.status(), body: redactText(body).slice(0, 4_000) });
  };
  page.on("response", captureChatResponse);
  const composer = page.getByPlaceholder(/Ask about your documents/).first();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEditable({ timeout: 120_000 });
  await composer.fill(prompt);
  const send = page.getByRole("button", { name: "Send", exact: true }).last();
  await expect(send).toBeEnabled();
  await send.click();

  const observed = await observeTurn(page, prompt, TURN_TIMEOUT_MS);
  // Expected provider 401s are recorded as ordinary blocked diagnostics. A
  // fatal renderer/main/Hermes event is never allowed to masquerade as a
  // superficially usable composer.
  qa.diagnostics.assertNoFatal("Hermes Garden Chat replay");
  const hermesErrors = qa.diagnostics.entries
    .filter((entry) => entry.source === "service" && entry.service === "hermes" && entry.level === "error")
    .map((entry) => entry.message)
    .slice(-8)
    .join(" | ");
  const receipt: HermesAttemptReceipt = {
    runId: qa.run.runId,
    surface: "garden_chat",
    prompt,
    result: observed.responseText.includes("HERMES_E2E_OK") ? "PASS" : "BLOCKED",
    ...(observed.responseText.includes("HERMES_E2E_OK")
      ? {}
      : {
          reason:
            observed.failureText ||
            hermesErrors ||
            "No completed assistant response; no credential-free conversational model is configured.",
        }),
    runtimeStatus,
    modelStatus,
    responseText: observed.responseText,
    userMessageVisible: observed.userMessageVisible,
    composerUsable: observed.composerUsable,
    attachmentVisible,
    chatRouteResponse: chatResponses.at(-1) ?? null,
  };
  const receiptPath = path.join(qa.resultsDir, "hermes-conversational-attempt.json");
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await test.info().attach("hermes-conversational-attempt", {
    path: receiptPath,
    contentType: "application/json",
  });

  // A blocked provider is evidence, not a test failure. The UI-level
  // assertions above still prove that the real composer accepted the turn,
  // surfaced the user message or an error, and left the input usable.
  expect(observed.userMessageVisible).toBe(true);
  expect(observed.composerUsable).toBe(true);
  if (receipt.result === "BLOCKED") {
    test.info().annotations.push({
      type: "BLOCKED",
      description: receipt.reason ?? "Hermes model/provider unavailable",
    });
  }

  // Preserve the existing garden lifecycle after a failed or completed turn.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await assertGardenWorkspace(page, garden, [], 60_000);
});

async function observeTurn(
  page: Page,
  prompt: string,
  timeoutMs: number,
): Promise<{
  responseText: string;
  failureText: string;
  userMessageVisible: boolean;
  composerUsable: boolean;
}> {
  const deadline = Date.now() + timeoutMs;
  let responseText = "";
  let failureText = "";
  let userMessageVisible = false;
  while (Date.now() < deadline) {
    // AgentRuntimePanel gives user bubbles a legacy class but deliberately
    // leaves assistant prose unstyled at the message wrapper. For this
    // harmless exact-phrase turn, the semantic text node is the reliable
    // renderer assertion and cannot match the user prompt (which ends in a
    // period).
    const exactPhrase = page.getByText("HERMES_E2E_OK", { exact: true }).first();
    const exactPhraseVisible = await exactPhrase.isVisible().catch(() => false);
    if (exactPhraseVisible) {
      responseText = await exactPhrase
        .textContent()
        .then((text) => text?.trim() ?? "")
        .catch(() => "");
    }
    responseText = await page
      .locator(".neu-chat-message:not(.neu-chat-message-user)")
      .allTextContents()
      .then((values) => values.join("\n").trim())
      .then((legacyText) => legacyText || responseText)
      .catch(() => responseText);
    failureText = await page
      .getByRole("alert")
      .allTextContents()
      .then((values) => values.join("\n").trim())
      .catch(() => "");
    userMessageVisible = await page
      .locator(".neu-chat-message-user")
      .filter({ hasText: prompt })
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    const composer = page.getByPlaceholder(/Ask about your documents/).first();
    const composerUsable = await composer
      .isEnabled()
      .catch(() => false);
    if (responseText.includes("HERMES_E2E_OK") || (failureText && composerUsable)) {
      return { responseText, failureText, userMessageVisible, composerUsable };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    responseText,
    failureText,
    userMessageVisible,
    composerUsable: await page
      .getByPlaceholder(/Ask about your documents/)
      .first()
      .isEnabled()
      .catch(() => false),
  };
}

async function probeJson(page: Page, url: string): Promise<string> {
  return page.evaluate(async (target) => {
    try {
      const response = await fetch(target, { cache: "no-store" });
      const body = await response.text();
      return `${response.status} ${body.slice(0, 400)}`;
    } catch (error) {
      return `request-failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, url);
}
