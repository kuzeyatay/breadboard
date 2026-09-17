import { isLearnRunningStatus } from "./learn-stage-labels.ts";

interface LearnOperationSnapshot {
  job?: { id: string; status: string } | null;
  humanizer?: { status: string } | null;
  runtimeJob?: { jobId: string; jobType: string; state: string } | null;
  publicationRecovery?: { active: boolean } | null;
}

const ACTIVE_RUNTIME_STATES = new Set([
  "queued", "admitted", "starting", "running", "checkpointing", "cancelling",
]);

/** A finished lesson row can still have a separate rewrite worker owning it. */
export function learnOperationActivity(
  snapshot: LearnOperationSnapshot | null | undefined,
  humanizerRequestBusy = false,
) {
  const status = snapshot?.job?.status ?? "idle";
  const humanizerActive = humanizerRequestBusy ||
    snapshot?.humanizer?.status === "running" ||
    snapshot?.humanizer?.status === "restoring_ai";
  const runtime = snapshot?.runtimeJob;
  const runtimeActive = runtime?.jobType === "learn" &&
    ACTIVE_RUNTIME_STATES.has(runtime.state);
  const active = humanizerActive || runtimeActive ||
    isLearnRunningStatus(status) || status === "paused" ||
    snapshot?.publicationRecovery?.active === true;
  // Never send a completed generation's ID to cancel its later rewrite.
  const cancelJobId = runtimeActive ? runtime.jobId :
    !humanizerActive && (isLearnRunningStatus(status) ||
      status === "paused" || status === "awaiting_confirmation")
      ? snapshot?.job?.id ?? null : null;
  return { active, humanizerActive, cancelJobId };
}
