import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { expect, test } from "../../fixtures";
import {
  assertAuthenticatedDashboard,
  ensureAuthenticatedDashboard,
  openTerminal,
  registerAndSignIn,
} from "../../user-journeys";

const RUN_TIMEOUT_MS = 45 * 60_000;
const QUESTION =
  "/agents:max-research explain how skeletal-muscle hypertrophy is triggered and give evidence-based starting weekly set ranges for a balanced, lean physique";

interface RuntimeJobRow {
  readonly state: string;
  readonly failure_code: string | null;
  readonly failure_message: string | null;
}

interface SqliteDatabase {
  pragma(value: string): unknown;
  prepare(sql: string): {
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown[];
  };
  close(): void;
}

type SqliteConstructor = new (
  filename: string,
  options: { readonly: boolean },
) => SqliteDatabase;

test("Max Research completes through the real UI at Ultra reasoning", async ({ qa }) => {
  test.setTimeout(RUN_TIMEOUT_MS + 5 * 60_000);
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  await ensureAuthenticatedDashboard(page, undefined, 120_000);
  await assertAuthenticatedDashboard(page, undefined, 120_000);
  await openTerminal(page, 120_000);

  const composer = page.getByPlaceholder(/Ask anything/).last();
  await expect(composer).toBeEditable({ timeout: 120_000 });

  const intelligence = page.getByTitle(/reasoning/i).last();
  await intelligence.click();
  const ultra = page.getByRole("button").filter({ hasText: /^Ultra/ }).last();
  await expect(ultra).toBeVisible({ timeout: 20_000 });
  await ultra.click();
  await expect(intelligence).toHaveAttribute("title", /Ultra reasoning/);
  const closeIntelligence = page.getByRole("button", {
    name: "Close intelligence menu",
    exact: true,
  });
  if (await closeIntelligence.isVisible().catch(() => false)) {
    await closeIntelligence.click();
  }

  await composer.fill(QUESTION);
  const launchResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/max-research/runs",
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  const launchResponse = await launchResponsePromise;
  const launchBody = (await launchResponse.json()) as {
    ok?: boolean;
    run?: { runId?: string };
    error?: string;
  };
  expect(launchResponse.ok(), JSON.stringify(launchBody)).toBe(true);
  expect(launchBody.ok, JSON.stringify(launchBody)).toBe(true);
  expect(launchBody.run?.runId).toMatch(/^job_[0-9a-f]{64}$/u);

  const card = page.locator(".bb-agent-run-card").filter({ hasText: "Max Research" }).last();
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expectMaxResearchRoster(card, 120_000);
  const startedAt = Date.now();
  const terminal = await waitForTerminalCard(card, RUN_TIMEOUT_MS);

  qa.diagnostics.assertNoFatal("Max Research Ultra QA run");
  expect(terminal.outcome, terminal.text).toBe("completed");
  expect(terminal.text).toContain("Get Doc");
  expect(terminal.text).not.toContain("Every research participant produced nothing");
  expect(terminal.text.length).toBeGreaterThan(500);

  // A card can reconstruct a terminal application event from the checkpoint
  // even if Runtime rejects the worker's result envelope. Check the trusted
  // row too, so a green UI cannot hide a failed completion proof.
  const runtimeJob = readRuntimeJob(
    qa.run.paths.repoRoot,
    qa.run.paths.dataDir,
    launchBody.run!.runId!,
  );
  expect(runtimeJob.state, JSON.stringify(runtimeJob)).toBe("succeeded");
  expect(runtimeJob.failure_code, JSON.stringify(runtimeJob)).toBeNull();
  expect(runtimeJob.failure_message, JSON.stringify(runtimeJob)).toBeNull();

  const receipt = {
    schemaVersion: 1,
    runId: qa.run.runId,
    maxResearchRunId: launchBody.run!.runId!,
    surface: "dashboard_terminal",
    reasoningEffort: "max",
    question: QUESTION,
    outcome: terminal.outcome,
    runtimeJobState: runtimeJob.state,
    runtimeFailureCode: runtimeJob.failure_code,
    elapsedMs: Date.now() - startedAt,
    cardText: terminal.text,
  } as const;
  const receiptPath = path.join(qa.resultsDir, "max-research-ultra-receipt.json");
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await test.info().attach("max-research-ultra-receipt", {
    path: receiptPath,
    contentType: "application/json",
  });
});

test("an explicit Max Research request survives leaving Terminal after two seconds", async ({ qa }) => {
  test.setTimeout(10 * 60_000);
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  await ensureAuthenticatedDashboard(page, undefined, 120_000);
  await assertAuthenticatedDashboard(page, undefined, 120_000);
  await openTerminal(page, 120_000);

  const intelligence = page.getByTitle(/reasoning/i).last();
  await intelligence.click();
  const superAgent = page.getByRole("switch", { name: /Super agent/i }).last();
  await expect(superAgent).toBeVisible({ timeout: 20_000 });
  if ((await superAgent.getAttribute("aria-checked")) !== "true") {
    await superAgent.click();
  }
  await expect(superAgent).toHaveAttribute("aria-checked", "true");
  const yolo = page.getByRole("switch", { name: /YOLO mode/i }).last();
  await expect(yolo).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", {
    name: "Close intelligence menu",
    exact: true,
  }).click();

  const question =
    "Do max research on skeletal-muscle hypertrophy and evidence-based starting weekly set ranges for a balanced physique.";
  const composer = page.getByPlaceholder(/Ask anything/).last();
  await composer.fill(question);
  let hermesTurnPosts = 0;
  const countHermesTurn = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      /^\/api\/hermes\/sessions\/[^/]+\/messages$/u.test(
        new URL(request.url()).pathname,
      )
    ) {
      hermesTurnPosts += 1;
    }
  };
  page.on("request", countHermesTurn);
  const sentAt = Date.now();
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  await page.waitForTimeout(2_000);
  const leftAfterMs = Date.now() - sentAt;

  // Match the production failure exactly: leave almost immediately, without
  // waiting for the launch response or any assistant turn to finish.
  await page.goto(new URL("/calendar", page.url()).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  // Super Agent owns this turn. Its server-side `agent_launch` starts and
  // attaches Max Research even though the renderer that sent the question is
  // no longer displaying Terminal.
  await expect.poll(
    () =>
      readPrivateMaxResearchTurnByQuestion(
        qa.run.paths.repoRoot,
        qa.run.paths.dataDir,
        question,
      ),
    { timeout: 180_000, intervals: [500, 1_000] },
  ).not.toBeNull();
  const turn = readPrivateMaxResearchTurnByQuestion(
    qa.run.paths.repoRoot,
    qa.run.paths.dataDir,
    question,
  );
  expect(turn).not.toBeNull();
  expect(turn!.maxResearchRunId).toMatch(/^job_[0-9a-f]{64}$/u);
  expect(turn!.delegatedAgentRun).toBe(true);
  page.off("request", countHermesTurn);
  expect(
    hermesTurnPosts,
    "plain-language Max Research under Super Agent must go through its model turn",
  ).toBe(1);

  await page.goto(new URL("/dashboard", page.url()).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await ensureAuthenticatedDashboard(page, undefined, 120_000);
  await openTerminal(page, 120_000);
  const privateCard = page
    .locator(".bb-agent-run-card")
    .filter({ hasText: "Max Research" })
    .last();
  await expect(privateCard).toBeHidden({ timeout: 120_000 });
  // The hidden observer still receives the plan. That proves both sides of the
  // contract at once: no worker card is presented, and the run has all five
  // participants rather than silently dropping unavailable ones.
  await expectMaxResearchRoster(privateCard, 120_000);
  await expect(privateCard).toBeHidden();

  // This scenario proves private durable delivery and the roster, not another
  // twenty-minute synthesis. Stop
  // its isolated QA job after the durable hand-off is visible.
  const abort = await page.evaluate(async (runId) => {
    const response = await fetch(
      `/api/max-research/runs/${encodeURIComponent(runId)}/abort`,
      { method: "POST" },
    );
    return { ok: response.ok, body: await response.json() };
  }, turn!.maxResearchRunId);
  expect(abort.ok, JSON.stringify(abort.body)).toBe(true);

  qa.diagnostics.assertNoFatal("Max Research navigation recovery");
  const receipt = {
    schemaVersion: 1,
    runId: qa.run.runId,
    conversationId: turn!.conversationPublicId,
    originClientMessageId: turn!.clientMessageId,
    maxResearchRunId: turn!.maxResearchRunId,
    leftFor: "/calendar",
    returnedTo: "/dashboard",
    leftAfterMs,
    hermesTurnPosts,
    privateDelegation: true,
    cardVisible: false,
    participantCount: 5,
    recovered: true,
  } as const;
  const receiptPath = path.join(
    qa.resultsDir,
    "max-research-navigation-recovery-receipt.json",
  );
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await test.info().attach("max-research-navigation-recovery-receipt", {
    path: receiptPath,
    contentType: "application/json",
  });
});

interface PersistedMaxResearchTurn {
  readonly conversationPublicId: string;
  readonly clientMessageId: string;
  readonly maxResearchRunId: string;
  readonly delegatedAgentRun: boolean;
}

function openBrainDatabase(repoRoot: string, dataDir: string): SqliteDatabase {
  const require = createRequire(path.join(repoRoot, "dashboard", "package.json"));
  const Database = require("better-sqlite3") as SqliteConstructor;
  const database = new Database(path.join(dataDir, "database", "brain.db"), {
    readonly: true,
  });
  database.pragma("query_only = ON");
  database.pragma("busy_timeout = 5000");
  return database;
}

function readPrivateMaxResearchTurnByQuestion(
  repoRoot: string,
  dataDir: string,
  question: string,
): PersistedMaxResearchTurn | null {
  const database = openBrainDatabase(repoRoot, dataDir);
  try {
    const row = database.prepare(`
      SELECT
        conversations.public_id AS conversation_public_id,
        assistant.client_message_id,
        json_extract(assistant.metadata, '$.externalAgentRun.runId') AS run_id,
        json_extract(assistant.metadata, '$.delegatedAgentRun') AS delegated_agent_run
      FROM conversation_messages AS user_message
      JOIN conversation_messages AS assistant
        ON assistant.conversation_id = user_message.conversation_id
       AND assistant.client_message_id = user_message.client_message_id
       AND assistant.role = 'assistant'
      JOIN conversations
        ON conversations.id = assistant.conversation_id
      WHERE user_message.role = 'user'
        AND user_message.surface = 'dashboard_terminal'
        AND user_message.content = ?
        AND json_extract(assistant.metadata, '$.externalAgentRun.kind') = 'max_research'
      ORDER BY assistant.id DESC
      LIMIT 1
    `).get(question) as {
      conversation_public_id: string;
      client_message_id: string;
      run_id: string;
      delegated_agent_run: number;
    } | undefined;
    if (!row) return null;
    return {
      conversationPublicId: row.conversation_public_id,
      clientMessageId: row.client_message_id,
      maxResearchRunId: row.run_id,
      delegatedAgentRun: row.delegated_agent_run === 1,
    };
  } finally {
    database.close();
  }
}

async function expectMaxResearchRoster(
  card: import("@playwright/test").Locator,
  timeoutMs: number,
): Promise<void> {
  await expect.poll(
    () => card.textContent().catch(() => ""),
    { timeout: timeoutMs, intervals: [500, 1_000] },
  ).toMatch(/Agents\s*[·.]\s*\d+\/5/iu);
  const text = await card.textContent();
  for (const participant of [
    "Deep Research",
    "Agent Reach",
    "Get Doc",
    "OpenScience",
    "ARIS",
  ]) {
    expect(text, `Max Research roster is missing ${participant}`).toContain(participant);
  }
}

function readRuntimeJob(repoRoot: string, dataDir: string, jobId: string): RuntimeJobRow {
  const require = createRequire(path.join(repoRoot, "dashboard", "package.json"));
  const Database = require("better-sqlite3") as SqliteConstructor;
  const database = new Database(path.join(dataDir, "runtime-v2", "runtime-v2.sqlite3"), {
    readonly: true,
  });
  try {
    database.pragma("query_only = ON");
    database.pragma("busy_timeout = 5000");
    const row = database.prepare(`
      SELECT state, failure_code, failure_message
      FROM runtime_jobs
      WHERE job_id = ?
    `).get(jobId) as RuntimeJobRow | undefined;
    if (!row) throw new Error(`Max Research Runtime job disappeared: ${jobId}`);
    return row;
  } finally {
    database.close();
  }
}

async function waitForTerminalCard(
  card: import("@playwright/test").Locator,
  timeoutMs: number,
): Promise<{ outcome: "completed" | "failed"; text: string }> {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await card.innerText().catch(() => "");
    const header = text.split(/\r?\n/u).slice(0, 3).join(" ");
    if (/Max Research\s+done\b/iu.test(header)) {
      return { outcome: "completed", text };
    }
    if (/Max Research\s+failed\b/iu.test(header)) {
      return { outcome: "failed", text };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Max Research did not reach a terminal card in time. Last card:\n${text}`);
}
