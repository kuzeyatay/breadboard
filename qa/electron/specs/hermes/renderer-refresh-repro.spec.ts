import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  assertGardenWorkspace,
  createGarden,
  openGardenWorkspace,
  registerAndSignIn,
  type GardenInfo,
} from "../../user-journeys";

/**
 * Focused reproduction for the historical renderer-refresh persistence FAIL.
 *
 * This deliberately records the server-side session shape as metadata only
 * (roles, lengths, and marker presence), while the pass/fail assertion stays
 * on the real Electron renderer. It must run before any product repair so a
 * stale UI assertion cannot be mistaken for a persistence regression.
 */
test("reproduce renderer refresh persistence with authenticated Hermes", async ({ qa }) => {
  test.setTimeout(8 * 60_000);
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  const garden: GardenInfo = await createGarden(page, {
    name: `Hermes Refresh Repro ${qa.run.runId.slice(-8)}`,
    description: "Disposable renderer-refresh persistence reproduction",
  });
  await openGardenWorkspace(page, garden);

  const marker = "HERMES_REFRESH_OK";
  const prompt = `Reply with exactly ${marker}.`;
  const sessionRequests: Array<{
    method: string;
    status?: number;
    messageShape?: readonly { role: string; contentLength: number; markerHits: readonly string[] }[];
  }> = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith("/api/chat-sessions")) return;
    const body = request.postData();
    if (!body) {
      sessionRequests.push({ method: request.method() });
      return;
    }
    try {
      const parsed = JSON.parse(body) as { messages?: unknown };
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      sessionRequests.push({
        method: request.method(),
        messageShape: messages.flatMap((message) => {
          if (!message || typeof message !== "object") return [];
          const value = message as Record<string, unknown>;
          const content = typeof value.content === "string" ? value.content : "";
          return [{
            role: typeof value.role === "string" ? value.role : "unknown",
            contentLength: content.length,
            markerHits: [marker, "HERMES_REFRESH_SECOND_OK"].filter((candidate) => content.includes(candidate)),
          }];
        }),
      });
    } catch {
      sessionRequests.push({ method: request.method() });
    }
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith("/api/chat-sessions")) return;
    const entry = sessionRequests.at(-1);
    if (entry) entry.status = response.status();
  });
  const composer = page.getByPlaceholder(/Ask about your documents/).first();
  await expect(composer).toBeEditable({ timeout: 120_000 });
  await composer.fill(prompt);
  const persistedResponse = page.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname;
      return response.request().method() === "PATCH" &&
        /^\/api\/chat-sessions\/\d+$/.test(pathname) &&
        response.ok();
    },
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "Send", exact: true }).last().click();

  const first = await waitForExactAssistantMarker(page, marker, 120_000);
  await persistedResponse;
  const before = await waitForPersistedTranscript(page, garden, marker, 30_000);
  const composerAfterFirst = await composer.isEnabled().catch(() => false);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await assertGardenWorkspace(page, garden, [], 120_000);
  const after = await waitForExactAssistantMarker(page, marker, 45_000);
  const afterSession = await sessionSummary(page, garden);

  const receipt = {
    schemaVersion: 1,
    runId: qa.run.runId,
    generatedAt: new Date().toISOString(),
    workflow: "send -> wait -> renderer reload -> wait -> send again",
    marker,
    before,
    composerAfterFirst,
    sessionRequests,
    afterReload: { markerVisible: after, session: afterSession },
    result: first && after ? "PASS" : "FAIL",
    diagnosis: first
      ? after
        ? "The completed assistant turn survived a real renderer reload."
        : "The server session was inspected after reload but the exact assistant marker was not visible in the renderer."
      : "The initial authenticated provider turn did not complete, so refresh persistence was not exercised.",
  } as const;
  const receiptPath = path.join(qa.resultsDir, "renderer-refresh-reproduction.json");
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await test.info().attach("renderer-refresh-reproduction", {
    path: receiptPath,
    contentType: "application/json",
  });

  expect(first, "initial authenticated turn must complete before refresh").toBe(true);
  expect(after, "completed assistant marker must survive renderer refresh").toBe(true);
}
);

interface SessionSummary {
  readonly sessionId: number | null;
  readonly sessions: readonly {
    readonly id: number;
    readonly messageCount: number;
    readonly roles: readonly string[];
    readonly markerHits: readonly string[];
    readonly updatedAt: string;
  }[];
}

async function sessionSummary(page: Page, garden: GardenInfo): Promise<SessionSummary> {
  return page.evaluate(async (clusterSlug) => {
    const response = await fetch(`/api/chat-sessions?clusterSlug=${encodeURIComponent(clusterSlug)}`);
    if (!response.ok) throw new Error(`chat session diagnostic failed: ${response.status}`);
    const payload = (await response.json()) as { sessions?: unknown };
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const normalized = sessions.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate as Record<string, unknown>;
      const id = Number(value.id);
      if (!Number.isInteger(id)) return [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const roles: string[] = [];
      const markerHits: string[] = [];
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const item = message as Record<string, unknown>;
        if (typeof item.role === "string") roles.push(item.role);
        if (typeof item.content === "string") {
          for (const marker of ["HERMES_REFRESH_OK", "HERMES_REFRESH_SECOND_OK"]) {
            if (item.content.includes(marker)) markerHits.push(marker);
          }
        }
      }
      return [{
        id,
        messageCount: messages.length,
        roles,
        markerHits: [...new Set(markerHits)],
        updatedAt: typeof value.updated_at === "string" ? value.updated_at : "",
      }];
    });
    const selected = normalized.find((session) => session.markerHits.length > 0);
    return {
      sessionId: selected?.id ?? null,
      sessions: normalized,
    };
  }, garden.slug);
}

async function waitForPersistedTranscript(
  page: Page,
  garden: GardenInfo,
  marker: string,
  timeoutMs: number,
): Promise<SessionSummary> {
  const deadline = Date.now() + timeoutMs;
  let latest = await sessionSummary(page, garden);
  while (Date.now() < deadline) {
    const session = latest.sessions.find((candidate) =>
      candidate.markerHits.includes(marker),
    );
    if (session && session.messageCount >= 2 && session.roles.includes("user") && session.roles.includes("assistant")) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    latest = await sessionSummary(page, garden);
  }
  throw new Error(`Persisted transcript did not contain user and assistant rows for ${marker}.`);
}

async function waitForExactAssistantMarker(
  page: Page,
  marker: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exact = page.getByText(marker, { exact: true }).first();
    if (await exact.isVisible().catch(() => false)) {
      const isUser = await exact.evaluate((node) => Boolean(node.closest(".neu-chat-message-user"))).catch(() => true);
      if (!isUser) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
