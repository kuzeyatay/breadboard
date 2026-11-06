import {
  listSourceRepairs, readSourceRepair, sourceRepairConfig, readRepairJournal,
  writeRepairJournal, updateSourceRepair, verifySourceRepairReleaseAsync,
  verifyRepairBaseSource,
  type SourceRepairJournal, type SourceRepairRequest,
} from "./source-repair";

export interface SourceRepairActivationHost {
  quiesce(): Promise<{ workers: number; leases: number }>;
  resumeAdmission(): Promise<void>;
  restart(): Promise<boolean>;
  healthy(releaseId: string | null): Promise<boolean>;
  log(message: string): void;
}

/** Lives in Electron, outside the dashboard/runtime it can replace. */
export class SourceRepairActivator {
  private working = false;
  private retryAfter = 0;
  constructor(private readonly dataRoot: string, private readonly baseRoot: string,
    private readonly host: SourceRepairActivationHost) {}

  async tick(): Promise<void> {
    if (this.working || Date.now() < this.retryAfter) return;
    this.working = true;
    try {
      const journal = readRepairJournal(this.dataRoot);
      if (journal.phase === "probation" && journal.repairId) {
        const request = readSourceRepair(this.dataRoot, journal.repairId);
        if (!request) throw new Error("The provisional release lost its task checkpoint.");
        if (request.stage === "committed") {
          writeRepairJournal(this.dataRoot, { ...journal, phase: "stable", repairId: null });
          this.host.log("Source repair verified by the resumed task; release committed.");
        } else if (["rollback_requested", "cancelled", "failed"].includes(request.stage) || Date.now() > request.deadline) {
          await this.rollback(journal, request.reason ?? "The provisional release did not complete its task.");
        } else if (!(await this.host.healthy(journal.active?.id ?? null))) {
          updateSourceRepair(this.dataRoot, request.id, { stage: "rollback_requested", reason: "The provisional release failed its health check." });
          await this.rollback(journal, "The provisional release failed its health check.");
        }
        return;
      }
      if (journal.phase === "rolling_back") { await this.rollback(journal, "Retrying interrupted rollback."); return; }
      if (journal.phase !== "stable" || !sourceRepairConfig(this.dataRoot)?.enabled) return;
      const request = listSourceRepairs(this.dataRoot).find(item => item.stage === "ready");
      if (!request) return;
      if (Date.now() > request.deadline) {
        updateSourceRepair(this.dataRoot, request.id, { stage: "blocked", reason: "Repair expired before a quiet activation boundary." });
        return;
      }
      if ((request.parentReleaseId ?? null) !== (journal.active?.id ?? null) || !request.release) {
        updateSourceRepair(this.dataRoot, request.id, { stage: "blocked", reason: "The active source changed while this repair was being verified." });
        return;
      }
      try {
        await verifySourceRepairReleaseAsync(this.dataRoot, this.baseRoot, request.release);
        await verifyRepairBaseSource(journal.active?.root ?? this.baseRoot, request.release);
      }
      catch (error) {
        updateSourceRepair(this.dataRoot, request.id, { stage: "blocked", reason: error instanceof Error ? error.message : "Release verification failed." });
        return;
      }
      if (!(await this.quiet())) return;
      if (readSourceRepair(this.dataRoot, request.id)?.stage !== "ready") {
        await this.host.resumeAdmission();
        return;
      }
      await this.activate(journal, request);
    } catch (error) {
      this.host.log(`Source repair activation deferred: ${error instanceof Error ? error.message : String(error)}`);
      this.retryAfter = Date.now() + 15_000;
      // A failed passive check must never leave admission closed.
      try { await this.host.resumeAdmission(); } catch { /* the runtime may be restarting */ }
    } finally { this.working = false; }
  }

  private async quiet(): Promise<boolean> {
    const activity = await this.host.quiesce();
    if (activity.workers === 0 && activity.leases === 0) return true;
    await this.host.resumeAdmission();
    this.retryAfter = Date.now() + 15_000;
    return false;
  }

  private async activate(journal: SourceRepairJournal, request: SourceRepairRequest): Promise<void> {
    const provisional: SourceRepairJournal = { version: 1, phase: "activating",
      active: request.release!, previous: journal.active, repairId: request.id, updatedAt: Date.now() };
    // Persist rollback before touching the runtime. Boot treats an interrupted
    // activation as unverified and selects previous, including the base build.
    writeRepairJournal(this.dataRoot, provisional);
    updateSourceRepair(this.dataRoot, request.id, { stage: "activating" });
    this.host.log("Activating the tested source repair at a quiet boundary.");
    let healthy = false;
    try {
      healthy = await this.host.restart();
      for (let index = 0; healthy && index < 3; index++) {
        if (index > 0) await new Promise(resolve => setTimeout(resolve, 1000));
        healthy = readSourceRepair(this.dataRoot, request.id)?.stage !== "cancelled" && await this.host.healthy(request.id);
      }
    } catch { healthy = false; }
    if (!healthy) {
      writeRepairJournal(this.dataRoot, { ...provisional, phase: "rolling_back" });
      updateSourceRepair(this.dataRoot, request.id, { stage: "rollback_requested", reason: "The candidate did not become healthy." });
      // A failed startup has admitted no task. If startup did complete, wait
      // for any newly admitted work before stopping it for rollback.
      await this.rollback({ ...provisional, phase: "rolling_back" }, "The candidate did not become healthy.");
      return;
    }
    writeRepairJournal(this.dataRoot, { ...provisional, phase: "probation", healthyAt: Date.now() });
    updateSourceRepair(this.dataRoot, request.id, { stage: "probation" });
    this.host.log("Repair is healthy; the saved task may now resume.");
  }

  private async rollback(journal: SourceRepairJournal, reason: string): Promise<void> {
    if (!(await this.quiet())) return;
    writeRepairJournal(this.dataRoot, { ...journal, phase: "rolling_back", active: journal.previous });
    if (!(await this.host.restart()) || !(await this.host.healthy(journal.previous?.id ?? null))) {
      throw new Error("Rollback is retained in the journal; the previous release could not be confirmed healthy.");
    }
    writeRepairJournal(this.dataRoot, { version: 1, phase: "stable", active: journal.previous,
      previous: null, repairId: null, updatedAt: Date.now() });
    if (journal.repairId) updateSourceRepair(this.dataRoot, journal.repairId, { stage: "rolled_back", reason });
    this.host.log("Rolled back to the last verified release; saved task data was preserved.");
  }
}
