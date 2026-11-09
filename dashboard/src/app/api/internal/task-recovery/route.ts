import { createRecoveryHandoffHandler } from "@/lib/hermes/task-recovery-handoff.ts";
import { resumeAbandonedRuntimeRuns } from "@/lib/hermes/run-recovery.ts";
import { reconcileSourceRepairs } from "@/lib/source-repair/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The existing native recovery schedule calls this finite handoff. Only the
// dashboard owns job admission. Durable checkpoints still enforce task owner,
// Stop, supersession, deadlines and idempotent submission/replay.
export const POST = createRecoveryHandoffHandler(async () => {
  const reconciled = process.env.BREADBOARD_SOURCE_REPAIR_READY === "1" ? await reconcileSourceRepairs() : 0;
  return { version: 1, reconciled, resumed: resumeAbandonedRuntimeRuns() };
});
