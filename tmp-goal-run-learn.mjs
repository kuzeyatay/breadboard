import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";

const gardenSlug = "electromagnetism-1";
const syllabusSourceId = "studyguide-5epf0";
let expectedModel;
let expectedReasoningEffort;
const runtimeDatabasePath = path.join(
  process.env.APPDATA ?? "",
  "breadboard-desktop",
  "Data",
  "database",
  "brain.db",
);
const runtimeV2DatabasePath = path.join(
  process.env.APPDATA ?? "",
  "breadboard-desktop",
  "Data",
  "runtime-v2",
  "runtime-v2.sqlite3",
);
const baseUrl =
  process.argv.find((value) => value.startsWith("--base="))?.slice(7) ||
  "http://127.0.0.1:3000";
const resumeConfirmedMapId =
  process.argv.find((value) => value.startsWith("--resume-confirmed-map="))?.slice(23).trim() ||
  "";
const forceReplaceJobId =
  process.argv.find((value) => value.startsWith("--force-replace-job="))?.slice(20).trim() ||
  "";
const cancelOnly = process.argv.includes("--cancel-only");

async function readJsonWithRetry(
  url,
  init = {},
  { label = "Read-only request", attempts = 4, timeoutMs = 60_000 } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => ({}));
      if (
        response.ok ||
        ![408, 425, 429, 500, 502, 503, 504].includes(response.status) ||
        attempt === attempts
      ) {
        return { response, payload };
      }
      lastError = new Error(`${label} returned transient HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error(`${label} could not be observed after ${attempts} attempts`, {
    cause: lastError,
  });
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

async function liveDocumentInventory(cookie) {
  const { response, payload } = await readJsonWithRetry(
    `${baseUrl}/api/documents?clusterSlug=${encodeURIComponent(gardenSlug)}`,
    {
      headers: { Cookie: cookie, "Cache-Control": "no-cache" },
    },
    { label: "Live Garden inventory" },
  );
  if (!response.ok || !Array.isArray(payload?.documents)) {
    throw new Error(
      `Live Garden inventory failed: HTTP ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload.documents;
}

function pendingLearnCancellation() {
  if (!fs.statSync(runtimeDatabasePath, { throwIfNoEntry: false })?.isFile()) {
    return null;
  }
  const database = new DatabaseSync(runtimeDatabasePath, { readOnly: true });
  try {
    return database
      .prepare(`
        SELECT id, current_step AS currentStep
        FROM learn_jobs
        WHERE garden_id = ? AND status = 'cancelled'
          AND current_step LIKE 'Cancellation requested;%'
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(gardenSlug) ?? null;
  } finally {
    database.close();
  }
}

function learnRecoveryIsQuiescent() {
  if (!fs.statSync(runtimeV2DatabasePath, { throwIfNoEntry: false })?.isFile()) {
    return false;
  }
  const database = new DatabaseSync(runtimeV2DatabasePath, { readOnly: true });
  try {
    const row = database
      .prepare(`
        SELECT COUNT(*) AS active
        FROM runtime_jobs
        WHERE state IN ('queued', 'running')
          AND stage = 'learn-recovery'
      `)
      .get();
    return Number(row?.active ?? 0) === 0;
  } finally {
    database.close();
  }
}

function pendingLearnPublication() {
  if (!fs.statSync(runtimeDatabasePath, { throwIfNoEntry: false })?.isFile()) {
    return null;
  }
  const database = new DatabaseSync(runtimeDatabasePath, { readOnly: true });
  try {
    return database
      .prepare(`
        SELECT reason, last_error AS lastError, updated_at AS updatedAt
        FROM learn_publication_retries
        WHERE garden_id = ?
        LIMIT 1
      `)
      .get(gardenSlug) ?? null;
  } finally {
    database.close();
  }
}

function completedLearnVersion(versionId) {
  if (!fs.statSync(runtimeDatabasePath, { throwIfNoEntry: false })?.isFile()) {
    return null;
  }
  const database = new DatabaseSync(runtimeDatabasePath, { readOnly: true });
  try {
    return database
      .prepare(`
        SELECT id, garden_id AS gardenId, job_id AS jobId,
          learning_map_id AS learningMapId, page_count AS pageCount,
          source_set_hash AS sourceSetHash,
          source_artifact_inventory_hash AS sourceArtifactInventoryHash
        FROM learn_versions
        WHERE id = ? AND garden_id = ?
        LIMIT 1
      `)
      .get(versionId, gardenSlug) ?? null;
  } finally {
    database.close();
  }
}

async function waitForLearnPublicationRecovery({ timeoutMs = 20 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    const pending = pendingLearnPublication();
    if (!pending) return;
    if (!announced) {
      process.stdout.write(
        `${JSON.stringify({ event: "learn-publication-recovery-wait", ...pending })}\n`,
      );
      announced = true;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Learn publication recovery did not quiesce: ${JSON.stringify(pending)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

function auditUploadedSourceCoverage(sources) {
  const slugs = new Set();
  const invalid = [];
  for (const source of sources) {
    if (
      typeof source?.slug !== "string" ||
      !source.slug.trim() ||
      typeof source?.sourceFile !== "string" ||
      !source.sourceFile.trim() ||
      slugs.has(source.slug)
    ) {
      invalid.push(source?.slug ?? source?.sourceFile ?? "unknown source");
      continue;
    }
    slugs.add(source.slug);
  }
  if (invalid.length > 0) {
    throw new Error(`Uploaded source inventory is invalid: ${invalid.join(", ")}`);
  }
  const unretained = sources.filter(
    (source) =>
      ["audio", "video"].includes(source.sourceType.toLowerCase()) &&
      !source.sourceMedia,
  );
  if (unretained.length > 0) {
    throw new Error(
      `Media sources lack retained playback assets: ${unretained.map((source) => source.slug).join(", ")}`,
    );
  }
  return sources.length;
}

async function authenticatedCookie() {
  const env = readEnvFile(path.join("dashboard", ".env.local"));
  const desktopConfigPath = path.join(
    ".runtime",
    "desktop-config",
    "desktop-config.json",
  );
  const desktopConfig = fs.existsSync(desktopConfigPath)
    ? JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"))
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
    const { response: session, payload } = await readJsonWithRetry(
      `${baseUrl}/api/auth/session`,
      { headers: { Cookie: cookie } },
      { label: "Local authentication session" },
    );
    if (session.ok && String(payload?.user?.id ?? "") === "1") return cookie;
  }
  throw new Error("No local authentication secret matched the running server.");
}

const cookie = await authenticatedCookie();
const activePreferences = await fetch(`${baseUrl}/api/assistant-preferences`, {
  headers: { Cookie: cookie, "Cache-Control": "no-cache" },
  signal: AbortSignal.timeout(30_000),
});
const activePreferencePayload = await activePreferences.json().catch(() => ({}));
if (
  !activePreferences.ok ||
  typeof activePreferencePayload?.model !== "string" ||
  !activePreferencePayload.model.trim() ||
  typeof activePreferencePayload?.reasoningEffort !== "string" ||
  !activePreferencePayload.reasoningEffort.trim()
) {
  throw new Error(
    `Active Learn model preference could not be read: HTTP ${activePreferences.status} ${JSON.stringify(activePreferencePayload)}`,
  );
}
expectedModel = activePreferencePayload.model;
expectedReasoningEffort = activePreferencePayload.reasoningEffort;
const liveDocuments = await liveDocumentInventory(cookie);
const sources = liveDocuments.filter((document) => document?.type === "source-document");
const auditedSourceCount = auditUploadedSourceCoverage(sources);
const syllabus = sources.find((source) => source.slug === syllabusSourceId);
if (!syllabus) throw new Error(`Learn syllabus ${syllabusSourceId} is missing.`);
const includedSourceIds = sources
  .filter((source) => source.slug !== syllabusSourceId)
  .map((source) => source.slug)
  .sort();
if (includedSourceIds.length !== 35) {
  throw new Error(
    `Learn source inventory changed: expected 35 teaching sources plus the syllabus, found ${includedSourceIds.length}.`,
  );
}

const headers = { Cookie: cookie, "Content-Type": "application/json" };
const pendingCancellation = pendingLearnCancellation();
if (pendingCancellation) {
  if (learnRecoveryIsQuiescent()) {
    process.stdout.write(
      `${JSON.stringify({
        event: "learn-cancellation-cleanup-complete",
        jobId: pendingCancellation.id,
        alreadySettled: true,
      })}\n`,
    );
  } else {
  const cancellation = await fetch(
    `${baseUrl}/api/gardens/${gardenSlug}/learn/cancel`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedJobId: pendingCancellation.id }),
      signal: AbortSignal.timeout(10 * 60_000),
    },
  );
  const cancellationPayload = await cancellation.json().catch(() => ({}));
  const cancellationSettled =
    cancellationPayload?.job?.status === "cancelled" &&
    (cancellationPayload?.job?.currentStep === "Cancelled; latest Learn changes rolled back" ||
      (cancellationPayload?.job?.currentStep?.startsWith("Cancellation requested;") &&
        learnRecoveryIsQuiescent()));
  if (!cancellation.ok || cancellationPayload?.success !== true || !cancellationSettled) {
    throw new Error(
      `Pending Learn cancellation did not finish safely: HTTP ${cancellation.status} ${JSON.stringify(cancellationPayload)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      event: "learn-cancellation-cleanup-complete",
      jobId: pendingCancellation.id,
    })}\n`,
  );
  }
}
await waitForLearnPublicationRecovery();
const statusUrl = `${baseUrl}/api/gardens/${gardenSlug}/learn/status`;
const { response: preflight, payload: preflightPayload } = await readJsonWithRetry(
  statusUrl,
  { headers: { Cookie: cookie, "Cache-Control": "no-cache" } },
  { label: "Learn preflight status" },
);
if (!preflight.ok) {
  throw new Error(
    `Learn preflight failed: HTTP ${preflight.status} ${JSON.stringify(preflightPayload)}`,
  );
}
const activeStatuses = new Set([
  "planning",
  "generating_learning_pages",
  "generating_textbook",
  "generating_visuals",
  "writing_quartz",
  "building_navigation",
  "analyzing_issues",
  "repairing",
  "revalidating",
  "publishing_repair",
  "paused",
  "awaiting_confirmation",
]);
const planBody = {
  includedSourceIds,
  syllabusSourceId,
  sourceOnly: true,
  includeSourceSnapshots: false,
  skipManualReview: true,
  expectedModel,
};
const preflightJob = preflightPayload?.job;
const preflightUpdatedAt = Date.parse(preflightJob?.updatedAt ?? "");
if (forceReplaceJobId && preflightJob?.id !== forceReplaceJobId) {
  throw new Error(
    `Refusing to replace unexpected Learn job: expected ${forceReplaceJobId}, found ${preflightJob?.id ?? "none"}.`,
  );
}
const abandonedActiveJob =
  activeStatuses.has(preflightJob?.status) &&
  (preflightJob?.id === forceReplaceJobId ||
    (Number.isFinite(preflightUpdatedAt) &&
      Date.now() - preflightUpdatedAt > 20 * 60_000));
if (abandonedActiveJob) {
  const cancellation = await fetch(
    `${baseUrl}/api/gardens/${gardenSlug}/learn/cancel`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedJobId: preflightJob.id }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const cancellationPayload = await cancellation.json().catch(() => ({}));
  if (!cancellation.ok || cancellationPayload?.success !== true) {
    throw new Error(
      `Abandoned Learn job cancellation failed: HTTP ${cancellation.status} ${JSON.stringify(cancellationPayload)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      event: "learn-abandoned-job-cancelled",
      jobId: preflightJob.id,
      status: preflightJob.status,
      updatedAt: preflightJob.updatedAt,
    })}\n`,
  );
  if (cancelOnly) process.exit(0);
}
if (cancelOnly) {
  throw new Error("No active Learn job matched the requested cancellation target.");
}
if (activeStatuses.has(preflightJob?.status) && !abandonedActiveJob) {
  const activeJob = preflightJob;
  const activeSourceIds = [...(activeJob.sourceIds ?? [])].sort();
  if (
    activeJob.model !== expectedModel ||
    JSON.stringify(activeSourceIds) !== JSON.stringify(includedSourceIds) ||
    activeJob.syllabusSourceId !== syllabusSourceId
  ) {
    throw new Error(
      `Active Learn job does not match the audited request: ${JSON.stringify({
        id: activeJob.id,
        status: activeJob.status,
        model: activeJob.model,
        sourceIds: activeSourceIds,
        syllabusSourceId: activeJob.syllabusSourceId,
      })}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      event: "learn-resumed",
      jobId: activeJob.id,
      status: activeJob.status,
      model: expectedModel,
      reasoningEffort: expectedReasoningEffort,
      reasoningLabel: "Ultra",
      selectedSourceCount: includedSourceIds.length,
      syllabusSourceId,
      auditedSourceCount,
    })}\n`,
  );
} else {
  const operation = resumeConfirmedMapId ? "generate" : "plan";
  const start = await fetch(
    `${baseUrl}/api/gardens/${gardenSlug}/learn/${operation}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(resumeConfirmedMapId
        ? {
            includedSourceIds,
            sourceOnly: true,
            includeSourceSnapshots: false,
            confirmedLearningMapId: resumeConfirmedMapId,
            expectedModel,
          }
        : planBody),
    },
  );
  const startPayload = await start.json().catch(() => ({}));
  if (
    start.status !== 202 ||
    startPayload?.accepted !== true ||
    typeof startPayload?.jobId !== "string"
  ) {
    throw new Error(
      `Learn ${operation} was not accepted: HTTP ${start.status} ${JSON.stringify(startPayload)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      event: resumeConfirmedMapId ? "learn-generation-reaccepted" : "learn-accepted",
      runtimeJobId: startPayload.jobId,
      ...(resumeConfirmedMapId
        ? { confirmedLearningMapId: resumeConfirmedMapId }
        : { planningJobId: startPayload.jobId }),
      model: expectedModel,
      reasoningEffort: expectedReasoningEffort,
      reasoningLabel: "Ultra",
      selectedSourceCount: includedSourceIds.length,
      syllabusSourceId,
      auditedSourceCount,
    })}\n`,
  );
}

let lastSignature = "";
let completed = null;
for (;;) {
  const { response, payload } = await readJsonWithRetry(
    statusUrl,
    { headers: { Cookie: cookie, "Cache-Control": "no-cache" } },
    { label: "Learn status" },
  );
  if (!response.ok || !payload?.job) {
    throw new Error(
      `Learn status failed: HTTP ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  const view = {
    id: payload.job.id,
    status: payload.job.status,
    mode: payload.job.mode,
    model: payload.job.model,
    step: payload.job.currentStep,
    progress: payload.job.progressPercent,
    section: payload.job.currentSectionTitle ?? null,
    page: payload.job.currentPageTitle ?? null,
    error: payload.job.error ?? null,
    sourceCount: payload.job.sourceIds?.length ?? null,
    syllabusSourceId: payload.job.syllabusSourceId ?? null,
    versionId: payload.latestTextbookVersionId ?? null,
  };
  const signature = JSON.stringify(view);
  if (signature !== lastSignature) {
    process.stdout.write(`${JSON.stringify({ event: "learn-progress", ...view })}\n`);
    lastSignature = signature;
  }
  if (["failed", "cancelled"].includes(payload.job.status)) {
    throw new Error(
      `Learn ${payload.job.status}: ${payload.job.error ?? payload.job.currentStep ?? "unknown error"}`,
    );
  }
  if (payload.job.status === "complete") {
    completed = payload;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

const finalJob = completed.job;
const selectedAtCompletion = [...(finalJob.sourceIds ?? [])].sort();
const finalVersion = completedLearnVersion(completed.latestTextbookVersionId);
if (
  finalJob.mode !== "generate" ||
  finalJob.model !== expectedModel ||
  JSON.stringify(selectedAtCompletion) !== JSON.stringify(includedSourceIds) ||
  finalJob.syllabusSourceId !== syllabusSourceId ||
  completed.sourceSetChanged !== false ||
  completed.hasTextbook !== true ||
  typeof completed.latestTextbookVersionId !== "string" ||
  !completed.latestTextbookVersionId.trim() ||
  !finalVersion ||
  finalVersion.jobId !== finalJob.id ||
  finalVersion.learningMapId !== finalJob.confirmedLearningMapId ||
  !Number.isInteger(finalVersion.pageCount) ||
  finalVersion.pageCount <= 0
) {
  throw new Error(
    `Learn completion contract failed: ${JSON.stringify({ completed, finalVersion })}`,
  );
}

const usage = finalJob.tokenUsage;
const policy = usage?.requestPolicy;
if (
  !usage ||
  !policy ||
  policy.model !== expectedModel ||
  policy.reasoningEffort !== expectedReasoningEffort ||
  policy.reasoningSummary !== "detailed" ||
  policy.consistent !== true ||
  Number(policy.observedCalls) <= 0 ||
  Number(usage.startedCalls) !== Number(usage.completedCalls)
) {
  throw new Error(`Learn model-policy audit failed: ${JSON.stringify(usage)}`);
}
const finalDocuments = await liveDocumentInventory(cookie);
const pageCount = finalDocuments.filter(
  (document) => document?.type === "textbook-page",
).length;
if (pageCount <= 0 || finalJob.latestTextbookVersionId !== completed.latestTextbookVersionId) {
  throw new Error(
    `Learn version audit failed: ${JSON.stringify({ pageCount, jobVersionId: finalJob.latestTextbookVersionId, latestTextbookVersionId: completed.latestTextbookVersionId })}`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    event: "learn-complete",
    jobId: finalJob.id,
    versionId: completed.latestTextbookVersionId,
    learningMapId: finalJob.confirmedLearningMapId,
    pageCount: finalVersion.pageCount,
    model: policy.model,
    reasoningEffort: policy.reasoningEffort,
    reasoningLabel: "Ultra",
    policyConsistent: policy.consistent,
    policyObservedCalls: policy.observedCalls,
    selectedSourceCount: includedSourceIds.length,
    syllabusSourceId,
    auditedSourceCount,
  })}\n`,
);
