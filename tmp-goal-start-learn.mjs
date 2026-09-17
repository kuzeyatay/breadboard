import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const baseUrl =
  process.argv.find((value) => value.startsWith("--base="))?.slice(7) ?? "";
const action =
  process.argv.find((value) => value.startsWith("--action="))?.slice(9) ??
  "status";
const expectedJobId =
  process.argv.find((value) => value.startsWith("--job="))?.slice(6) ?? "";
const gardenSlug = "electromagnetism-1";
const learnModel = "cliproxy/gemini-3.8-flash-high";
const learnReasoningEffort = "high";
const sourceIds = [
  "engineering-electromagnetics-9th-ed-9nbsped-compress",
  "5epf0-lecture1",
  "5epf0-lecture2",
  "5epf0-lecture3",
  "5epf0-lecture4",
  "5epf0-lecture5",
  "5epf0-lecture6",
  "electrostatics-solutions-5epf0-tutorial-problems-2024",
  "formulasheet-1",
  "studyguide-5epf0",
  "tutorials-5epf0-2026",
  "5epf0-2024-09-04-1330-eindhoven-university-of-technology-enter",
  "5epf0-2024-09-06-0845-eindhoven-university-of-technology-enter",
  "5epf0-2024-09-11-1330-eindhoven-university-of-technology-enter",
  "5epf0-2024-09-13-0845-eindhoven-university-of-technology-enter",
  "5epf0-2024-09-18-1330-eindhoven-university-of-technology-enter",
  "5epf0-2024-09-25-1330-eindhoven-university-of-technology-enter",
  "5epf0-2024-10-02-1330-eindhoven-university-of-technology-enter",
  "5epf0-2024-10-04-0845-eindhoven-university-of-technology-enter",
  "5epf0-2024-10-09-1330-eindhoven-university-of-technology-enter",
  "5epf0-2024-10-11-0845-eindhoven-university-of-technology-enter",
  "5epf0-2024-10-16-1330-eindhoven-university-of-technology-enter",
  "5epf0-2024-10-18-0845-eindhoven-university-of-technology-enter",
  "5epf0-2024-10-23-1330-eindhoven-university-of-technology-enter",
  "5epf0-2025-09-03-1330-eindhoven-university-of-technology-enter",
  "5epf0-2025-09-05-0845-eindhoven-university-of-technology-enter",
  "5epf0-2025-09-10-1330-eindhoven-university-of-technology-enter",
  "5epf0-2025-09-12-0845-eindhoven-university-of-technology-enter",
  "5epf0-2025-09-17-1330-eindhoven-university-of-technology-enter",
  "5epf0-2025-10-03-0845-eindhoven-university-of-technology-enter",
  "5epf0-2025-10-08-1330-eindhoven-university-of-technology-enter",
  "5epf0-2025-10-10-0845-eindhoven-university-of-technology-enter",
  "5epf0-2025-10-15-1330-eindhoven-university-of-technology-enter",
  "5epf0-2025-10-17-0845-eindhoven-university-of-technology-enter",
  "5epf0-2025-10-22-1330-eindhoven-university-of-technology-enter",
  "5epf0-2025-10-24-0845-eindhoven-university-of-technology-enter",
];

if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseUrl)) {
  throw new Error("Usage: --base=http://127.0.0.1:<port> [--action=status|start]");
}
if (!new Set(["cancel", "generate", "status", "start", "watch"]).has(action)) {
  throw new Error(`Unsupported action: ${action}`);
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^['"]|['"]$/gu, ""),
        ];
      }),
  );
}

async function authenticatedCookie() {
  const env = readEnvFile(path.join("dashboard", ".env.local"));
  const configPath = path.join(
    ".runtime",
    "desktop-config",
    "desktop-config.json",
  );
  const desktopConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : null;
  const database = new DatabaseSync("dashboard/db/brain.db", {
    readOnly: true,
  });
  const user = database
    .prepare("SELECT id, username, email FROM users WHERE id = 1")
    .get();
  database.close();
  if (!user) throw new Error("Breadboard user 1 is unavailable.");
  const secrets = [env.NEXTAUTH_SECRET, desktopConfig?.nextAuthSecret].filter(
    (secret, index, values) =>
      typeof secret === "string" &&
      secret.trim() &&
      values.indexOf(secret) === index,
  );
  for (const secret of secrets) {
    const token = await encode({
      secret,
      token: {
        id: String(user.id),
        sub: String(user.id),
        name: user.username,
        email: user.email,
      },
      maxAge: 24 * 60 * 60,
    });
    const cookie = `next-auth.session-token=${token}`;
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && String(payload?.user?.id ?? "") === "1") return cookie;
  }
  throw new Error("No local authentication secret matched the running server.");
}

async function request(cookie, pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `${init.method ?? "GET"} ${pathname} failed (${response.status}): ${JSON.stringify(payload)}`,
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function statusSummary(payload) {
  const job = payload?.job ?? null;
  return {
    success: payload?.success === true,
    confirmedLearningMapId: payload?.confirmedLearningMapId ?? null,
    syllabusSourceId: payload?.syllabusSourceId ?? null,
    selectedSourceIds: payload?.selectedSourceIds ?? null,
    hasTextbook: payload?.hasTextbook ?? null,
    latestTextbookVersionId: payload?.latestTextbookVersionId ?? null,
    job: job
      ? {
          id: job.id ?? null,
          status: job.status ?? null,
          mode: job.mode ?? null,
          operation: job.operation ?? null,
          phase: job.phase ?? null,
          currentStep: job.currentStep ?? null,
          model: job.model ?? null,
          tokenUsage: job.tokenUsage ?? null,
          error: job.error ?? null,
        }
      : null,
  };
}

const cookie = await authenticatedCookie();
const before = await request(
  cookie,
  `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/status`,
);

if (action === "cancel") {
  if (!expectedJobId) throw new Error("--action=cancel requires --job=<Learn job id>");
  const cancelled = await request(
    cookie,
    `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ expectedJobId }),
    },
  );
  const after = await request(
    cookie,
    `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/status`,
  );
  process.stdout.write(
    `${JSON.stringify({ event: "learn-cancelled", cancelled, status: statusSummary(after) }, null, 2)}\n`,
  );
  process.exit(0);
}

if (action === "watch") {
  const terminalStates = new Set([
    "cancelled",
    "completed",
    "failed",
    "resource_exhausted",
    "succeeded",
  ]);
  let previousLifecycle = "";
  let lastEmittedAt = 0;
  for (;;) {
    const current = await request(
      cookie,
      `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/status`,
    );
    const summary = statusSummary(current);
    const lifecycle = JSON.stringify({
      status: summary.job?.status ?? null,
      mode: summary.job?.mode ?? null,
      error: summary.job?.error ?? null,
      confirmedLearningMapId: summary.confirmedLearningMapId,
      hasTextbook: summary.hasTextbook,
      latestTextbookVersionId: summary.latestTextbookVersionId,
    });
    const now = Date.now();
    if (lifecycle !== previousLifecycle || now - lastEmittedAt >= 50_000) {
      const usage = summary.job?.tokenUsage;
      process.stdout.write(
        `${JSON.stringify({
          event: "learn-status",
          jobId: summary.job?.id ?? null,
          status: summary.job?.status ?? null,
          mode: summary.job?.mode ?? null,
          step: summary.job?.currentStep ?? null,
          model: summary.job?.model ?? null,
          selectedSourceCount: summary.selectedSourceIds?.length ?? null,
          confirmedLearningMapId: summary.confirmedLearningMapId,
          hasTextbook: summary.hasTextbook,
          latestTextbookVersionId: summary.latestTextbookVersionId,
          calls: usage
            ? {
                started: usage.startedCalls ?? null,
                completed: usage.completedCalls ?? null,
                inFlight: usage.inFlightCalls ?? null,
              }
            : null,
          requestPolicy: usage?.requestPolicy ?? null,
          error: summary.job?.error ?? null,
        })}\n`,
      );
      previousLifecycle = lifecycle;
      lastEmittedAt = now;
    }
    const state = String(summary.job?.status ?? "").toLowerCase();
    if (terminalStates.has(state)) process.exit(state === "failed" ? 1 : 0);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

if (action === "status") {
  process.stdout.write(`${JSON.stringify(statusSummary(before), null, 2)}\n`);
  process.exit(0);
}

const preferences = await request(cookie, "/api/assistant-preferences", {
  method: "PATCH",
  body: JSON.stringify({
    model: learnModel,
    reasoningEffort: learnReasoningEffort,
  }),
});
if (
  preferences.model !== learnModel ||
  preferences.reasoningEffort !== learnReasoningEffort
) {
  throw new Error(`Learn preference verification failed: ${JSON.stringify(preferences)}`);
}

const activeStates = new Set(["queued", "starting", "running", "cancelling", "canceling"]);
if (activeStates.has(String(before?.job?.status ?? "").toLowerCase())) {
  if (before.job.model !== learnModel) {
    throw new Error(
      `An active Learn job is using ${before.job.model ?? "an unknown model"}; refusing to start a competing run.`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ event: "learn-already-active", preferences, status: statusSummary(before) }, null, 2)}\n`,
  );
  process.exit(0);
}

if (action === "generate") {
  const confirmedLearningMapId = before?.confirmedLearningMapId;
  if (typeof confirmedLearningMapId !== "string" || !confirmedLearningMapId) {
    throw new Error("No confirmed Learning Map is available for generation.");
  }
  const generated = await request(
    cookie,
    `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/generate`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedModel: learnModel,
        confirmedLearningMapId,
        includedSourceIds: sourceIds,
        sourceOnly: true,
        includeSourceSnapshots: false,
      }),
    },
  );
  if (generated.accepted !== true || typeof generated.jobId !== "string") {
    throw new Error(`Learn generation was not accepted: ${JSON.stringify(generated)}`);
  }
  const after = await request(
    cookie,
    `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/status`,
  );
  if (after?.job?.id !== generated.jobId || after?.job?.model !== learnModel) {
    throw new Error(
      `Learn generation status did not confirm the submitted model/job: ${JSON.stringify(statusSummary(after))}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ event: "learn-generation-started", preferences, accepted: generated, status: statusSummary(after) }, null, 2)}\n`,
  );
  process.exit(0);
}

const started = await request(
  cookie,
  `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/plan`,
  {
    method: "POST",
    body: JSON.stringify({
      expectedModel: learnModel,
      includedSourceIds: sourceIds,
      syllabusSourceId: null,
      sourceOnly: true,
      includeSourceSnapshots: false,
      skipManualReview: true,
    }),
  },
);
if (started.accepted !== true || typeof started.jobId !== "string") {
  throw new Error(`Learn was not accepted as a background job: ${JSON.stringify(started)}`);
}

const after = await request(
  cookie,
  `/api/gardens/${encodeURIComponent(gardenSlug)}/learn/status`,
);
if (after?.job?.id !== started.jobId || after?.job?.model !== learnModel) {
  throw new Error(
    `Learn status did not confirm the submitted model/job: ${JSON.stringify(statusSummary(after))}`,
  );
}
process.stdout.write(
  `${JSON.stringify({ event: "learn-started", preferences, accepted: started, status: statusSummary(after) }, null, 2)}\n`,
);
