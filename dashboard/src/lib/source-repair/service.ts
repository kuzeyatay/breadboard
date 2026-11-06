import path from "node:path";
import { pathToFileURL } from "node:url";
import { sourceRepairAuthority } from "./authority.ts";
import { repairDataRoot, repairTaskStillCurrent, releaseRepairCheckpoint } from "./checkpoint.ts";
import { submitRuntimeJob, inspectRuntimeJob, cancelRuntimeJob } from "../supervisor-control.ts";
import { scheduleTaskRecovery } from "../hermes/task-recovery.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";

/** Invoked by the existing restart-safe recovery schedule. No new daemon. */
export async function reconcileSourceRepairs(): Promise<number> {
  const data = repairDataRoot(); if (!data) return 0;
  const controller = sourceRepairAuthority(); if (!controller) return 0;
  const { listSourceRepairs, readSourceRepair, updateSourceRepair, cancelSourceRepair, readRepairJournal } = controller;
  let resumed = 0;
  for (const request of listSourceRepairs(data)) {
    if (["committed", "blocked", "failed"].includes(request.stage)) continue;
    const authority = { userId: request.userId, gardenId: null, conversationId: null };
    if (request.stage === "cancelled" || !repairTaskStillCurrent(request)) {
      cancelSourceRepair(data, request.id);
      if (request.jobId) await cancelRuntimeJob(authority, request.jobId).catch(() => undefined);
      continue;
    }
    if (Date.now() > request.deadline && !["probation", "activating", "rollback_requested", "rolled_back"].includes(request.stage)) {
      updateSourceRepair(data, request.id, { stage: "blocked", reason: "Automatic repair reached its deadline; saved task progress is preserved." });
      if (request.jobId) await cancelRuntimeJob(authority, request.jobId).catch(() => undefined);
      continue;
    }
    if (request.stage === "probation" || request.stage === "rolled_back") {
      const journal = readRepairJournal(data);
      const replay = request.stage === "probation";
      if (replay ? journal.phase !== "probation" || journal.active?.id !== request.id : journal.phase !== "stable") continue;
      const runId = releaseRepairCheckpoint(request, replay);
      if (runId) { scheduleTaskRecovery(request.conversationId, runId); resumed++; }
      continue;
    }
    if (["ready", "activating", "rollback_requested"].includes(request.stage)) continue;
    try {
      const job = request.jobId ? await inspectRuntimeJob(authority, request.jobId) : await submitRuntimeJob(authority, {
        jobType: "source-repair", idempotencyKey: `source-repair:${request.id}${request.generation ? `:${request.generation}` : ""}`,
        requestPayload: { protocolVersion: 1, operation: "source-repair", repairId: request.id },
      });
      if (job.jobType !== "source-repair" || job.workerKind !== "source-repair-node" || job.gardenId !== null || job.conversationId !== null) throw new Error("Repair job authority mismatch.");
      if (!request.jobId) updateSourceRepair(data, request.id, { jobId: job.jobId });
      if (["failed", "cancelled", "resource_exhausted", "interrupted", "uncertain", "succeeded"].includes(job.state) &&
          ["queued", "preparing", "testing", "building"].includes(readSourceRepair(data, request.id)?.stage ?? "")) {
        updateSourceRepair(data, request.id, { stage: "blocked", reason: job.failureMessage || "The isolated repair worker ended before verification completed." });
      }
    } catch (error) {
      // Admission may be temporarily unavailable. The same idempotency key and
      // two-hour durable deadline bound retries without duplicate repair jobs.
      updateSourceRepair(data, request.id, { reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return resumed;
}

/** Runs only inside the registered native job with its memory/process budget. */
export async function runSourceRepairJob(repairId: string, userId: number, signal?: AbortSignal): Promise<unknown> {
  const data = repairDataRoot(); if (!data) throw new Error("Repair storage unavailable.");
  const controller = sourceRepairAuthority(); if (!controller) throw new Error("Automatic source repair requires a developer checkout.");
  const { readSourceRepair } = controller;
  const request = readSourceRepair(data, repairId);
  if (!request || request.userId !== userId || !repairTaskStillCurrent(request)) throw new Error("Repair task is no longer authorized.");
  const abort = new AbortController();
  const timer = setInterval(() => {
    try { if (readSourceRepair(data, repairId)?.stage === "cancelled" || !repairTaskStillCurrent(request)) abort.abort(); }
    catch { abort.abort(); }
  }, 2000);
  timer.unref();
  try {
    // The fixed controller stays in the original installation, never in a
    // model-edited worktree. It accepts an id, not arbitrary commands or paths.
    const engine = await import(/* webpackIgnore: true */ pathToFileURL(path.join(request.baseRoot, "scripts/self-repair/engine.mjs")).href);
    return await engine.executeSourceRepair({ dataRoot: data, repairId, endpoint: localChatmockBaseUrl(), apiKey: chatmockApiKeyValue(),
      signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal });
  } finally { clearInterval(timer); }
}
