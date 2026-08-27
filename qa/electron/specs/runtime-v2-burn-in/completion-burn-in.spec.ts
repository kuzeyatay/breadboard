import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import {
  RuntimeV2BurnInRecorder,
  type BrowserAgentAvailabilityProbe,
  type PostizActivationResult,
  type PostizStopResult,
  type PostizStatusProbe,
} from "../../runtime-v2-burn-in-recorder";
import {
  assertAuthenticatedDashboard,
  createGarden,
  ensureAuthenticatedDashboard,
  openGardenWorkspace,
  registerAndSignIn,
  uploadDocuments,
  type GardenInfo,
} from "../../user-journeys";

/**
 * Completion-quality Runtime V2 evidence. Every action below runs through the
 * real Electron renderer and real dashboard/Runtime V2 boundaries. There are
 * deliberately no optional, skipped, mocked, or canned-success paths. External
 * prerequisites are probed with a fixed deadline and produce a truthful
 * BLOCKED receipt which the completion validator rejects; they are never
 * silently omitted or counted as a pass.
 */
test("actual Electron Runtime V2 completion burn-in", async ({ qa }, testInfo) => {
  test.setTimeout(9 * 60 * 60_000);
  expect(process.env["BREADBOARD_RUNTIME_V2_BURN_IN"]).toBe("1");

  let page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth, 180_000);
  const garden = await createGarden(page, {
    name: `Runtime V2 Burn In ${qa.run.runId.slice(-8)}`,
    description: "Disposable actual-Electron memory burn-in garden",
  }, 180_000);
  await openGardenWorkspace(page, garden, 180_000);

  const inputDirectory = path.join(qa.run.paths.tempDir, "runtime-v2-burn-in-inputs");
  fs.mkdirSync(inputDirectory, { recursive: true });
  const inputFiles = Array.from({ length: 15 }, (_, index) => {
    const ordinal = index + 1;
    const file = path.join(inputDirectory, `runtime-v2-ingestion-${ordinal}.md`);
    fs.writeFileSync(
      file,
      `# Runtime V2 ingestion ${ordinal}\n\n` +
        `This is disposable source ${ordinal} for the actual Electron burn-in. ` +
        `Its unique evidence marker is INGEST-${qa.run.runId}-${ordinal}.\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return file;
  });

  const recorder = new RuntimeV2BurnInRecorder(qa);
  try {
    await recorder.initialize();

    // Ingestion first gives Learn a real source set. Every upload uses the
    // visible Add documents UI and waits for the durable completed result.
    for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
      const file = inputFiles[ordinal - 1]!;
      await recorder.measureSequential("ingestion", ordinal, async () => {
        await uploadDocuments(page, [file], 15 * 60_000);
      });
    }

    // Planning is a real prerequisite job, but the 10 counted Learn operations
    // are the generation plus nine complete destructive rebuilds.
    await recorder.prepareOperation("learn", async () => {
      await openLearnPanel(page);
      await page.getByRole("button", { name: "Learn", exact: true }).click();
    });

    await recorder.measureSequential("learn", 1, async () => {
      const confirm = page.getByRole("button", { name: "Confirm and Learn", exact: true });
      await expect(confirm).toBeVisible({ timeout: 15 * 60_000 });
      await confirm.click();
    });
    for (let ordinal = 2; ordinal <= 10; ordinal += 1) {
      await recorder.measureSequential("learn", ordinal, () => startFullLearnRebuild(page));
    }

    for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
      await recorder.measureSequential("artifact", ordinal, () =>
        renderDocxArtifact(page, qa.run.runId, `sequential-${ordinal}`));
    }

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      const file = inputFiles[9 + cycle]!;
      const ingestionMarker = `INGEST-${qa.run.runId}-${10 + cycle}`;
      let uploadedTitle = path.basename(file, path.extname(file));
      await recorder.measureMixedCycle(cycle, {
        gardenChatRetrieval: () => verifyGardenRetrieval(page, qa.run.runId, cycle),
        learn: () => startFullLearnRebuild(page),
        ingestion: async () => {
          const uploaded = await uploadDocuments(page, [file], 15 * 60_000);
          uploadedTitle = uploaded[0]?.displayedTitle ?? uploadedTitle;
        },
        artifact: () => renderDocxArtifact(page, qa.run.runId, `mixed-${cycle}`),
        browserAgent: async () => {
          const evidence = await recorder.measureBrowserAgent(
            cycle,
            await probeBrowserAgentAvailability(page),
            () => startBrowserAgentFromUi(page),
            () => stopBrowserAgentFromUi(page),
          );
          return evidence;
        },
        quartzBuild: () => verifyQuartzBuild(page, garden, uploadedTitle, ingestionMarker),
        postiz: async () => {
          const evidence = await recorder.measurePostiz(
            cycle,
            await probePostizStatus(page, true),
            () => activatePostizThroughRuntime(page),
            () => stopPostizThroughRuntime(page),
            () => probePostizStatus(page, false),
          );
          return evidence;
        },
      });
    }

    // Phase 3 requires a full five-minute settled sample immediately after the
    // mixed workload. The recorder uses the configured measurement cadence.
    await recorder.measurePostMixedSample();

    await recorder.measureCancellation(
      () => startFullLearnRebuild(page),
      async () => {
        const cancel = page.getByRole("button", { name: "Cancel", exact: true }).last();
        await expect(cancel).toBeVisible({ timeout: 5 * 60_000 });
        await cancel.click();
      },
    );

    // Admission denial is observed only when the machine naturally enters the
    // reserve-unavailable window. The recorder refuses to manufacture pressure.
    await recorder.measureAdmissionDenial(() => startFullLearnRebuild(page));

    await recorder.measureRestart(async () => {
      await qa.restart({ timeoutMs: 180_000 });
      page = await qa.dismissWelcome();
      await ensureAuthenticatedDashboard(page, qa.run.bootstrap.auth, 180_000);
      await openGardenWorkspace(page, garden, 180_000);
    });

    await recorder.measureIdleStop("gbrain", async () => {
      const response = await page.evaluate(async (gardenSlug) => {
        // Status is deliberately read-only and will not wake a stopped
        // service. A real sync first acquires GBrain through Runtime V2; the
        // subsequent health read proves the vendored backend, then releases
        // the final lease so its durable idle deadline can be measured.
        const sync = await fetch("/api/gbrain/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gardenId: gardenSlug }),
        });
        const syncBody = await sync.text();
        if (!sync.ok) {
          return { ok: false, status: sync.status, body: syncBody };
        }
        const result = await fetch(`/api/gbrain/status?gardenId=${encodeURIComponent(gardenSlug)}`, {
          cache: "no-store",
        });
        return {
          ok: result.ok,
          status: result.status,
          body: `${syncBody}\n${await result.text()}`,
        };
      }, garden.slug);
      if (!response.ok || !response.body.includes('"backend":"gbrain"')) {
        throw new Error(`GBrain did not return real-backend readiness (${response.status}): ${response.body}`);
      }
      await page.goto(new URL("/dashboard", page.url()).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 180_000,
      });
      await assertAuthenticatedDashboard(page, garden, 180_000);
      return { backend: "gbrain" };
    });

    // This is a minimum-duration gate, not a Playwright timeout. It samples
    // until the run has covered 21,600,000 ms and a final settled window.
    await recorder.measureEndurance();

    await recorder.measureQuit(async () => {
      await qa.shutdown({ timeoutMs: 180_000 });
    });

    const receiptPath = recorder.writeReceipt();
    await testInfo.attach("runtime-v2-burn-in-receipt", {
      path: receiptPath,
      contentType: "application/json",
    });
  } finally {
    recorder.close();
  }
});

async function openLearnPanel(page: Page): Promise<void> {
  const open = page.getByRole("button", { name: "Open Learn panel", exact: true });
  if (await open.isVisible().catch(() => false)) await open.click();
  await expect(page.getByText("Source-only", { exact: true })).toBeVisible({ timeout: 180_000 });
}

async function startFullLearnRebuild(page: Page): Promise<void> {
  await openLearnPanel(page);
  const rebuild = page.getByRole("button", { name: "Rebuild entire garden", exact: true });
  await expect(rebuild).toBeVisible({ timeout: 30 * 60_000 });
  await rebuild.click();
  const dialog = page.getByRole("alertdialog", { name: "Rebuild the entire garden?" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Rebuild garden", exact: true }).click();
}

async function verifyGardenRetrieval(page: Page, runId: string, ordinal: number): Promise<void> {
  const expectedMarker = `INGEST-${runId}-${ordinal}`;
  const prompt =
    `Read the uploaded source named runtime-v2-ingestion-${ordinal}. ` +
    "Reply only with its unique evidence marker; do not infer or invent a marker.";
  await sendGardenTurn(page, prompt, expectedMarker, 15 * 60_000);
}

async function verifyQuartzBuild(
  page: Page,
  garden: GardenInfo,
  uploadedTitle: string,
  expectedMarker: string,
): Promise<void> {
  const sourceLink = page.getByRole("link", { name: uploadedTitle, exact: true });
  await expect(sourceLink).toBeVisible({ timeout: 15 * 60_000 });
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/garden/${garden.slug}`, { timeout: 5 * 60_000 }),
    sourceLink.click(),
  ]);
  await expect(
    page.frameLocator("iframe").getByText(expectedMarker, { exact: false }).first(),
  ).toBeVisible({ timeout: 5 * 60_000 });
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === new URL(garden.workspaceHref, url).pathname,
      { timeout: 5 * 60_000 },
    ),
    page.getByRole("link", { name: /Back to garden/ }).click(),
  ]);
}

async function renderDocxArtifact(page: Page, runId: string, identity: string): Promise<void> {
  const safeIdentity = identity.replace(/[^a-z0-9-]/giu, "-").toLowerCase();
  const title = `Runtime V2 DOCX ${safeIdentity}`;
  const contentMarker = `DOCX-CONTENT-${runId}-${identity}`;
  const completionMarker = `DOCX-READY-${runId}-${identity}`;
  const prompt =
    `Use the real first-party artifact_create tool to create a document artifact titled ${title}, ` +
    `filename runtime-v2-${safeIdentity}.docx, kind document, renderer docx, with exactly this ` +
    `plain-text content: ${contentMarker}. Then invoke artifact_render on that exact artifact. ` +
    `Do not use terminal, office_run, office_export, Markdown renderer, or prose as a substitute. ` +
    `After artifact_render returns a ready artifact, reply exactly ${completionMarker}.`;
  await sendGardenTurn(page, prompt, completionMarker, 15 * 60_000);
  const card = page.locator(".bb-neu-artifact-card").filter({ hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5 * 60_000 });
}

async function probeBrowserAgentAvailability(page: Page): Promise<BrowserAgentAvailabilityProbe> {
  return page.evaluate(async () => {
    const checkedAt = new Date().toISOString();
    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/agent-browser/agents", {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as {
        available?: unknown;
        reason?: unknown;
        agents?: unknown;
      };
      const agents = Array.isArray(body.agents)
        ? body.agents.filter((value): value is Record<string, unknown> =>
            Boolean(value) && typeof value === "object" && !Array.isArray(value))
        : [];
      const agent = agents.find(({ runtimeState }) => runtimeState === "available") ?? agents[0] ?? null;
      return {
        checkedAt,
        httpStatus: response.status,
        probeLatencyMs: Math.round(performance.now() - startedAt),
        runtimeAvailable: body.available === true,
        reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
        agentId: typeof agent?.id === "string" ? agent.id : null,
        agentRuntimeState: typeof agent?.runtimeState === "string" ? agent.runtimeState : null,
      };
    } catch (error) {
      return {
        checkedAt,
        httpStatus: 0,
        probeLatencyMs: Math.round(performance.now() - startedAt),
        runtimeAvailable: false,
        reason: error instanceof Error ? error.message.slice(0, 500) : "availability_probe_failed",
        agentId: null,
        agentRuntimeState: null,
      };
    } finally {
      window.clearTimeout(timer);
    }
  });
}

async function startBrowserAgentFromUi(page: Page): Promise<void> {
  const cards = page.locator(".bb-agent-run-card").filter({ hasText: "Agent Browser" });
  const previousCount = await cards.count();
  const composer = page.getByPlaceholder(/Ask about your documents/).last();
  await expect(composer).toBeEditable({ timeout: 180_000 });
  await composer.fill(
    "/agents:agent-browser Open https://example.com and keep inspecting the page until I press Stop. " +
      "Do not finish the run on your own.",
  );
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  await expect(cards).toHaveCount(previousCount + 1, { timeout: 5 * 60_000 });
  await expect(cards.last().getByRole("button", { name: "Stop", exact: true })).toBeVisible({
    timeout: 5 * 60_000,
  });
}

async function stopBrowserAgentFromUi(page: Page): Promise<void> {
  const card = page.locator(".bb-agent-run-card").filter({ hasText: "Agent Browser" }).last();
  const stop = card.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible({ timeout: 60_000 });
  await stop.click();
}

async function probePostizStatus(page: Page, probeDocker: boolean): Promise<PostizStatusProbe> {
  return page.evaluate(async (includeDockerProbe) => {
    const checkedAt = new Date().toISOString();
    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        `/api/socials-manager/stack${includeDockerProbe ? "?probe=docker" : ""}`,
        { cache: "no-store", signal: controller.signal },
      );
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const status = body.status && typeof body.status === "object" && !Array.isArray(body.status)
        ? body.status as Record<string, unknown>
        : {};
      const coordinator = status.coordinator && typeof status.coordinator === "object" &&
          !Array.isArray(status.coordinator)
        ? status.coordinator as Record<string, unknown>
        : null;
      return {
        checkedAt,
        httpStatus: response.status,
        probeLatencyMs: Math.round(performance.now() - startedAt),
        mode: typeof body.mode === "string" ? body.mode : "unknown",
        state: typeof status.state === "string" ? status.state : "unknown",
        reachable: status.reachable === true,
        coordinator,
        reason: typeof status.reason === "string"
          ? status.reason.slice(0, 500)
          : typeof body.error === "string"
            ? body.error.slice(0, 500)
            : null,
      };
    } catch (error) {
      return {
        checkedAt,
        httpStatus: 0,
        probeLatencyMs: Math.round(performance.now() - startedAt),
        mode: "unknown",
        state: "unknown",
        reachable: false,
        coordinator: null,
        reason: error instanceof Error ? error.message.slice(0, 500) : "availability_probe_failed",
      };
    } finally {
      window.clearTimeout(timer);
    }
  }, probeDocker);
}

async function activatePostizThroughRuntime(page: Page): Promise<PostizActivationResult> {
  return page.evaluate(async () => {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch("/api/socials-manager/stack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const status = body.status && typeof body.status === "object" && !Array.isArray(body.status)
        ? body.status as Record<string, unknown>
        : {};
      return {
        httpStatus: response.status,
        actionLatencyMs: Math.round(performance.now() - startedAt),
        ready: status.ready === true,
        state: typeof status.state === "string" ? status.state : "unknown",
        ownership: typeof status.ownership === "string" ? status.ownership : "unknown",
        reason: typeof status.reason === "string"
          ? status.reason.slice(0, 500)
          : typeof body.error === "string"
            ? body.error.slice(0, 500)
            : null,
      };
    } catch (error) {
      return {
        httpStatus: 0,
        actionLatencyMs: Math.round(performance.now() - startedAt),
        ready: false,
        state: "failed",
        ownership: "unknown",
        reason: error instanceof Error ? error.message.slice(0, 500) : "activation_failed",
      };
    } finally {
      window.clearTimeout(timer);
    }
  });
}

async function stopPostizThroughRuntime(page: Page): Promise<PostizStopResult> {
  return page.evaluate(async () => {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch("/api/socials-manager/stack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      return {
        httpStatus: response.status,
        actionLatencyMs: Math.round(performance.now() - startedAt),
        stopped: body.stopped === true,
        reason: typeof body.error === "string" ? body.error.slice(0, 500) : null,
      };
    } catch (error) {
      return {
        httpStatus: 0,
        actionLatencyMs: Math.round(performance.now() - startedAt),
        stopped: false,
        reason: error instanceof Error ? error.message.slice(0, 500) : "cleanup_failed",
      };
    } finally {
      window.clearTimeout(timer);
    }
  });
}

async function sendGardenTurn(
  page: Page,
  prompt: string,
  completionMarker: string,
  timeoutMs: number,
): Promise<void> {
  const composer = page.getByPlaceholder(/Ask about your documents/).last();
  await expect(composer).toBeEditable({ timeout: 180_000 });
  const assistant = page.locator('div[class~="text-gray-200"]');
  const beforeCount = await assistant.count();
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  await expect.poll(async () => {
    const count = await assistant.count();
    if (count <= beforeCount) return "";
    return (await assistant.last().innerText()).trim();
  }, { timeout: timeoutMs, message: `Expected real artifact completion marker ${completionMarker}` })
    .toContain(completionMarker);
  await expect(composer).toBeEditable({ timeout: timeoutMs });
  const visibleErrors = await page.getByRole("alert").allTextContents();
  if (visibleErrors.some((value) => value.trim())) {
    throw new Error(`Artifact renderer exposed an error: ${visibleErrors.join(" | ")}`);
  }
}
