import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { BambuStore, digest, type SavedPrinter } from "./store.ts";
import { inspectSlicedFile, MAX_FILE_BYTES } from "./inspection.ts";
import { validateReview, modelName } from "./compatibility.ts";
import { fail, isActive, TERMINAL_STATES, type JobScope, type PrintJob, type PrintReview, type StagedFile, type Telemetry, type JobView, type ExecutionSnapshot } from "./types.ts";
import type { PrinterAccess, PrinterAdapter } from "./adapter.ts";

const now = () => new Date().toISOString();
const recent = (value: string | undefined, milliseconds = 15_000) => Boolean(value && Date.now() - Date.parse(value) < milliseconds && Date.parse(value) <= Date.now() + 1000);
export function matchesJob(job: PrintJob, telemetry: Telemetry): boolean {
  if (!job.attempt || !telemetry.connected || !recent(telemetry.identityObservedAt)) return false;
  const filename = telemetry.filename?.split(/[\\/]/).at(-1);
  return filename === job.attempt.remoteFilename && (!telemetry.taskId || telemetry.taskId === job.attempt.id);
}
function reviewRevision(job: PrintJob, revision: unknown) {
  if (!Number.isSafeInteger(revision) || revision !== job.revision) fail("This review has changed. Reload it and review the current file and setup.", "stale_review");
}
function editable(job: PrintJob) {
  if (isActive(job.state) || TERMINAL_STATES.includes(job.state)) fail("This job cannot be edited. Create a new draft for another print.", "job_immutable");
}

/** Durable state machine. The only service allowed to dispatch to the private adapter. */
export class BambuJobService {
  private ticking: Promise<void> | null = null;
  store: BambuStore;
  private storageRoot: string;
  private adapter: PrinterAdapter;
  private credentials: (printer: SavedPrinter) => Promise<PrinterAccess>;
  constructor(store: BambuStore, storageRoot: string, adapter: PrinterAdapter, credentials: (printer: SavedPrinter) => Promise<PrinterAccess>) { this.store = store; this.storageRoot = storageRoot; this.adapter = adapter; this.credentials = credentials; }
  create(scope: JobScope) { return this.store.create(scope); }
  async testPrinter(userId: number, id: string) {
    const printer = this.store.printer(id, userId);
    try {
      const telemetry = await this.adapter.test(await this.credentials(printer));
      const current = this.store.printer(id, userId);
      if (current.config.revision !== printer.config.revision) return { printer: current.config, telemetry: null };
      printer.config.reachable = telemetry.reachable ?? telemetry.connected;
      printer.config.authenticated = telemetry.authenticated ?? telemetry.connected;
      const wrongModel = telemetry.model && modelName(telemetry.model) !== modelName(printer.config.model);
      printer.config.startCapability = !telemetry.connected || wrongModel || !printer.config.developerModeConfirmed ? "blocked" : "eligible_unverified";
      printer.config.message = !telemetry.connected ? "No fresh authenticated status. Check the serial, access code and LAN/Developer Mode." : wrongModel ? "Reported printer identity does not match the configured model." : "Status authenticated. Physical start support remains unverified until an approved job is observed starting.";
      // A read-only test updates observed inventory, but never silently edits physical configuration.
      printer.config.lastTestAt = now();
      this.store.savePrinter(printer);
      return { printer: printer.config, telemetry };
    } catch {
      const current = this.store.printer(id, userId);
      if (current.config.revision !== printer.config.revision) return { printer: current.config, telemetry: null };
      printer.config.reachable = false; printer.config.authenticated = false; printer.config.startCapability = "not_tested";
      printer.config.lastTestAt = now(); printer.config.message = "Could not authenticate a fresh status read. Check the address, serial, access code and LAN/Developer Mode.";
      this.store.savePrinter(printer);
      return { printer: printer.config, telemetry: null };
    }
  }
  artifactPath(fileId: string, part = "source.3mf") {
    if (!/^[0-9a-f-]{36}$/.test(fileId) || !/^(source\.3mf|plate_[1-9][0-9]{0,2}\.png)$/.test(part)) fail("Invalid staged artifact.", "invalid_artifact", 400);
    return path.join(this.storageRoot, fileId, part);
  }
  async stage(id: string, userId: number, conversation: string, revision: unknown, bytes: Buffer, filename: string): Promise<PrintJob> {
    const job = this.store.transaction(() => {
      const j = this.store.get(id, userId, conversation); editable(j); reviewRevision(j, revision);
      if (j.state === "validating") fail("This job is already validating a file.", "validation_pending");
      j.revision++; j.approval = null; j.review = null; j.state = "validating"; j.message = null; j.blockers = [];
      this.store.save(j, "file_validation_started"); return j;
    });
    try {
      if (bytes.length > MAX_FILE_BYTES) fail("Export a sliced file below 128 MiB.", "archive_size", 400);
      const inspected = await inspectSlicedFile(bytes, filename);
      const fileId = randomUUID(), filePath = this.artifactPath(fileId);
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await fs.writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
      for (const [plateId, thumbnail] of inspected.thumbnails) await fs.writeFile(this.artifactPath(fileId, `plate_${plateId}.png`), thumbnail, { flag: "wx", mode: 0o600 });
      const staged: StagedFile = { id: fileId, name: path.basename(filename.replace(/\\/g, "/")).slice(0, 180), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), plates: inspected.plates };
      return this.store.transaction(() => {
        const current = this.store.get(id, userId, conversation);
        if (current.state !== "validating" || current.revision !== job.revision) fail("File selection was superseded.", "stale_validation");
        current.file = staged; current.state = "review_required"; this.store.save(current, "file_staged_and_hashed"); return current;
      });
    } catch (error) {
      this.store.transaction(() => {
        const current = this.store.get(id);
        if (current.state !== "validating" || current.revision !== job.revision) return;
        current.state = "blocked"; current.file = null; current.message = error instanceof Error && "code" in error ? error.message : "The sliced file could not be inspected. Export it again from Bambu Studio.";
        current.blockers = [current.message]; this.store.save(current, "file_rejected");
      });
      throw error;
    }
  }
  review(id: string, userId: number, conversation: string, revision: unknown, input: PrintReview) {
    return this.store.transaction(() => {
      const job = this.store.get(id, userId, conversation); editable(job); reviewRevision(job, revision);
      if (job.state === "validating") fail("Wait for file inspection.", "validation_pending");
      if (!input || typeof input !== "object" || typeof input.printerId !== "string") fail("Select a saved printer and a printable plate.", "invalid_review", 400);
      const printer = this.store.printer(input.printerId, userId);
      const plate = job.file?.plates.find(p => p.id === input.plateId);
      if (!plate) fail("Select one of this sliced file's printable plates.", "invalid_plate", 400);
      // Drop any extra model/browser supplied fields rather than storing executable data.
      const review: PrintReview = { printerId: input.printerId, printerRevision: printer.config.revision, plateId: input.plateId, mapping: Array.isArray(input.mapping) ? input.mapping.slice(0,17).map(m => ({ filamentIndex: m.filamentIndex, sourceId: String(m.sourceId), acceptColorSubstitution: m.acceptColorSubstitution === true })) : [], options: input.options };
      job.blockers = validateReview(review, plate, printer.config);
      job.review = review; job.revision++; job.approval = null; job.message = null;
      job.state = job.blockers.length ? "blocked" : "awaiting_approval";
      this.store.save(job, "review_changed_consent_invalidated"); return job;
    });
  }
  approve(id: string, userId: number, conversation: string, revision: unknown, confirmations: { plateClear: unknown; physicalSetup: unknown }): PrintJob {
    return this.store.transaction(() => {
      const job = this.store.get(id, userId, conversation); reviewRevision(job, revision);
      // The same click/retry observes the consumed attempt; it never issues another one.
      if (isActive(job.state) && job.approval) return job;
      if (job.state !== "awaiting_approval" || !job.review || !job.file || confirmations.plateClear !== true || confirmations.physicalSetup !== true) fail("Review the file and mapping, then confirm the clear plate and physical setup.", "approval_required", 403);
      const printer = this.store.printer(job.review.printerId, userId), plate = job.file.plates.find(p => p.id === job.review!.plateId)!;
      if (job.review.printerRevision !== printer.config.revision) fail("Printer configuration changed after this review. Check the current setup again.", "printer_revision_changed");
      const blockers = validateReview(job.review, plate, printer.config);
      if (blockers.length) fail(blockers.join(" "), "compatibility_blocked");
      const snapshot: ExecutionSnapshot = { scope: job.scope, jobId: job.id, revision: job.revision, fileId: job.file.id, fileSha256: job.file.sha256, fileSize: job.file.size, plate, printerId: printer.config.id, physicalIdentity: printer.physicalIdentity, printerRevision: printer.config.revision, review: job.review, sources: printer.config.sources.filter(s => job.review!.mapping.some(m => m.sourceId === s.id)), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
      this.store.lock(printer.physicalIdentity, job.id);
      job.approval = { snapshot, digest: digest(snapshot), expiresAt: snapshot.expiresAt, consumedAt: null };
      job.state = "approved"; this.store.save(job, "trusted_user_approved"); return job;
    });
  }
  private validateSnapshot(job: PrintJob, printer: SavedPrinter) {
    const a = job.approval, s = a?.snapshot;
    if (!a || !s || a.digest !== digest(s) || s.expiresAt !== a.expiresAt || Date.parse(a.expiresAt) <= Date.now() || s.jobId !== job.id || s.revision !== job.revision || digest(s.scope) !== digest(job.scope) || s.fileSha256 !== job.file?.sha256 || s.fileId !== job.file.id || s.fileSize !== job.file.size || digest(s.review) !== digest(job.review) || s.printerId !== printer.config.id || s.physicalIdentity !== printer.physicalIdentity || s.printerRevision !== printer.config.revision) fail("Approval expired or the execution setup changed. Review and approve again.", "approval_invalid", 403);
    return s;
  }
  private readiness(telemetry: Telemetry, snapshot: ExecutionSnapshot, printer: SavedPrinter) {
    if (!telemetry.connected || !recent(telemetry.stateObservedAt) || !["idle","completed","cancelled"].includes(telemetry.state ?? "") || telemetry.printError) fail("The printer is busy, offline or not freshly confirmed ready. This job will not queue automatically.", "printer_not_ready");
    if ((telemetry.nozzleDiameter && telemetry.nozzleDiameter !== snapshot.plate.nozzle) || (telemetry.model && modelName(telemetry.model) !== modelName(printer.config.model))) fail("Live printer configuration differs from the approved slice.", "live_configuration_changed");
    const sources = telemetry.sources !== undefined ? telemetry.sources : printer.config.sources;
    const blockers = validateReview(snapshot.review, snapshot.plate, printer.config, sources);
    for (const approved of snapshot.sources) {
      const current = sources.find(s => s.id === approved.id);
      if (!current || !current.available || current.material.toUpperCase() !== approved.material.toUpperCase() || current.color !== approved.color) blockers.push("Physical filament inventory changed since review.");
    }
    if (blockers.length) fail([...new Set(blockers)].join(" "), "live_mapping_changed");
  }
  private async dispatch(id: string) {
    const job = this.store.transaction(() => {
      const current = this.store.get(id);
      if (current.state !== "approved" || current.approval?.consumedAt) return null;
      const printer = this.store.printer(current.review!.printerId, current.scope.userId);
      this.validateSnapshot(current, printer); this.store.lock(printer.physicalIdentity, current.id);
      current.approval!.consumedAt = now(); current.attempt = { id: String(Math.floor(Math.random() * 2_000_000_000) + 1), remoteFilename: `bb_${randomUUID().replace(/-/g, "")}.3mf`, startIntentAt: null, startedObservedAt: null };
      current.state = "uploading"; this.store.save(current, "approval_consumed_upload_intent"); return current;
    });
    if (!job) return;
    try {
      const printer = this.store.printer(job.review!.printerId, job.scope.userId), access = await this.credentials(printer), snapshot = this.validateSnapshot(job, printer);
      this.readiness(await this.adapter.observe(access, true), snapshot, printer);
      const filePath = this.artifactPath(snapshot.fileId), bytes = await fs.readFile(filePath);
      if (bytes.length !== snapshot.fileSize || createHash("sha256").update(bytes).digest("hex") !== snapshot.fileSha256) fail("The staged file changed. Select the file again.", "staged_file_changed");
      const upload = await this.adapter.upload(access, { attemptId: job.attempt!.id, remoteFilename: job.attempt!.remoteFilename, localPath: filePath, sha256: snapshot.fileSha256, size: snapshot.fileSize });
      const current = this.store.get(id);
      if (current.state !== "uploading") fail("Upload was cancelled. No start command was sent.", "upload_cancelled");
      const freshPrinter = this.store.printer(printer.config.id);
      this.validateSnapshot(current, freshPrinter);
      this.readiness(await this.adapter.observe(access, true), snapshot, freshPrinter);
      this.store.transaction(() => {
        const j = this.store.get(id); if (j.state !== "uploading") fail("Upload cancelled before start.", "upload_cancelled");
        j.uploadVerified = upload.verified; j.uploadBytes = snapshot.fileSize;
        j.attempt!.startIntentAt = now(); j.state = "start_requested";
        this.store.save(j, "start_intent_persisted");
      });
      // This protocol is nontransactional: one invocation only, never an automatic retry.
      await this.adapter.start(access, { remoteFilename: job.attempt!.remoteFilename, attemptId: job.attempt!.id, snapshot });
      const sent = this.store.get(id);
      if (sent.state === "start_requested") { sent.state = "start_unconfirmed"; sent.message = "Start sent. Waiting for telemetry that identifies this job."; this.store.save(sent, "start_sent_unconfirmed"); }
    } catch (error) {
      this.store.transaction(() => {
        const current = this.store.get(id);
        if (TERMINAL_STATES.includes(current.state)) { this.store.unlock(id); return; }
        if (current.attempt?.startIntentAt) {
          current.state = "start_unconfirmed"; current.message = "The start outcome is unconfirmed. The printer may be running. Inspect it; Breadboard will not resend this command.";
        } else {
          current.state = "blocked"; current.approval = null; current.revision++; this.store.unlock(id);
          current.message = error instanceof Error && "code" in error ? error.message : "Upload or readiness verification failed. Review again before another attempt.";
          current.blockers = [current.message];
        }
        this.store.save(current, current.attempt?.startIntentAt ? "start_outcome_ambiguous" : "dispatch_blocked");
      });
    }
  }
  uploadProgress(attemptId: string, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return;
    const job = this.store.active().find(j => j.attempt?.id === attemptId && j.state === "uploading");
    if (job && bytes <= (job.file?.size ?? 0) && bytes >= (job.uploadBytes ?? 0)) { job.uploadBytes = bytes; this.store.save(job); }
  }
  observe(id: string, telemetry: Telemetry) {
    this.store.transaction(() => {
      const job = this.store.get(id);
      if (job.telemetry && Date.parse(telemetry.observedAt) <= Date.parse(job.telemetry.observedAt)) return;
      if (isActive(job.state) && telemetry.connected && !matchesJob(job, telemetry)) {
        // An external job's percentage is never displayed as this task's progress.
        job.telemetry = { ...job.telemetry, observedAt: telemetry.observedAt, connected: true, identityObservedAt: undefined };
        if (telemetry.filename && job.attempt && telemetry.filename.split(/[\\/]/).at(-1) !== job.attempt.remoteFilename) job.message = "The printer reports a different job. These are this task's last known values; inspect the printer before resolving it.";
        this.store.save(job); return;
      }
      job.telemetry = { ...job.telemetry, ...telemetry };
      if (!isActive(job.state) || !telemetry.connected || !matchesJob(job, telemetry) || !recent(telemetry.stateObservedAt)) { this.store.save(job); return; }
      if (["preparing", "printing", "paused"].includes(telemetry.state ?? "")) {
        job.attempt!.startedObservedAt ??= telemetry.observedAt;
        if (job.state !== "cancel_requested") job.state = telemetry.state as "preparing" | "printing" | "paused";
        job.message = telemetry.state === "paused" ? telemetry.stage ?? "Printer paused. Check its display before resuming." : null;
        if ((job.pendingControl === "pause" && telemetry.state === "paused") || (job.pendingControl === "resume" && ["printing","preparing"].includes(telemetry.state!))) job.pendingControl = null;
        const printer = this.store.printer(job.review!.printerId); printer.config.startCapability = "verified"; this.store.savePrinter(printer);
      }
      if (job.attempt!.startIntentAt && ["completed", "failed", "cancelled"].includes(telemetry.state ?? "")) {
        job.state = telemetry.state === "failed" && job.pendingControl === "cancel" && !telemetry.printError ? "cancelled" : telemetry.state as "completed" | "failed" | "cancelled";
        job.pendingControl = null; job.finishedAt = telemetry.observedAt;
        job.message = job.state === "failed" ? "The printer reported that this job failed. Check its display." : null;
        this.store.unlock(job.id); this.store.save(job, `printer_confirmed_${job.state}`); return;
      }
      this.store.save(job);
    });
  }
  async control(id: string, userId: number, conversation: string, command: "pause" | "resume" | "cancel", confirmed: unknown) {
    const job = this.store.get(id, userId, conversation);
    if (command === "cancel" && confirmed !== true) fail("Confirm cancellation of this physical print.", "cancel_confirmation_required", 403);
    if (!["pause","resume","cancel"].includes(command)) fail("Unsupported control.", "invalid_control", 400);
    if (job.pendingControl) return job;
    if ((command === "pause" && !["preparing", "printing"].includes(job.state)) || (command === "resume" && job.state !== "paused") || (command === "cancel" && !["preparing", "printing", "paused"].includes(job.state))) fail("This control is unavailable in the current state. Resolve an unconfirmed start by inspecting the printer.", "invalid_control_state");
    const access = await this.credentials(this.store.printer(job.review!.printerId, userId));
    const telemetry = await this.adapter.observe(access, true);
    if (!matchesJob(job, telemetry) || !recent(telemetry.stateObservedAt) || !["preparing","printing","paused"].includes(telemetry.state ?? "")) fail("The active printer job is not confirmed as this widget's job. No command was sent.", "unrelated_print");
    const claimed = this.store.transaction(() => {
      const current = this.store.get(id, userId, conversation);
      if (current.pendingControl) return false;
      if (current.state !== job.state) fail("Printer state changed. Refresh before controlling it.", "control_race");
      current.pendingControl = command; if (command === "cancel") current.state = "cancel_requested";
      this.store.save(current, `${command}_intent`); return true;
    });
    if (claimed) {
      try { await this.adapter.control(access, { command, remoteFilename: job.attempt!.remoteFilename, taskId: job.attempt!.id }); }
      catch { const current = this.store.get(id); current.message = "Control outcome is unconfirmed. Check the printer; Breadboard will not repeat the command automatically."; this.store.save(current, "control_outcome_ambiguous"); }
    }
    return this.store.get(id, userId, conversation);
  }
  async resolveInspected(id: string, userId: number, conversation: string, revision: unknown, inspected: unknown) {
    const job = this.store.get(id, userId, conversation); reviewRevision(job, revision);
    if (!isActive(job.state) || !job.attempt?.startIntentAt || inspected !== true) fail("Inspect the printer and confirm that no print is running before closing an unresolved job.", "inspection_required", 403);
    const telemetry = await this.adapter.observe(await this.credentials(this.store.printer(job.review!.printerId, userId)), true);
    if (!telemetry.connected || telemetry.state !== "idle" || !recent(telemetry.stateObservedAt)) fail("The printer must freshly report idle. Use its own display to inspect an unconfirmed or unrelated print.", "printer_not_idle");
    return this.store.transaction(() => {
      const current = this.store.get(id, userId, conversation); reviewRevision(current, revision);
      if (current.state !== job.state) fail("The job changed during inspection. Read its latest status.", "inspection_race");
      current.state = "cancelled"; current.finishedAt = now(); current.pendingControl = null; current.revision++;
      current.telemetry = telemetry;
      current.message = "Closed after your physical inspection and a fresh idle report. The earlier print outcome remains unknown; no stop or restart command was sent.";
      this.store.unlock(id); this.store.save(current, "user_inspected_idle_outcome_unknown"); return current;
    });
  }
  cancelDraft(id: string, userId: number, conversation: string) {
    return this.store.transaction(() => {
      const job = this.store.get(id, userId, conversation);
      if (!["approved","uploading"].includes(job.state)) editable(job);
      if (job.attempt?.startIntentAt) fail("This job may have started. Use the physical print controls.", "physical_cancel_required");
      const uploading = job.state === "uploading";
      job.state = "cancelled"; job.finishedAt = now(); job.approval = null; job.revision++;
      if (!uploading) this.store.unlock(id);
      this.store.save(job, "draft_cancelled_no_stop_command"); return job;
    });
  }
  again(id: string, userId: number, conversation: string) {
    const previous = this.store.get(id, userId, conversation);
    if (!TERMINAL_STATES.includes(previous.state)) fail("Finish or cancel the current job first.", "job_active");
    return this.store.transaction(() => {
      const next = this.store.create(previous.scope, `again:${id}`);
      if (!next.file && previous.file) { next.file = previous.file; next.state = "review_required"; this.store.save(next, "print_again_fresh_draft"); }
      previous.nextJobId = next.id; this.store.save(previous, "new_draft_linked");
      return next;
    });
  }
  recover() {
    for (const row of this.store.db.prepare("SELECT job_id FROM bambu_printer_locks").all() as {job_id:string}[]) {
      const job = this.store.get(row.job_id);
      if (TERMINAL_STATES.includes(job.state) && !job.attempt?.startIntentAt) { this.store.unlock(job.id); this.store.save(job, "cancelled_transfer_lock_released_after_restart"); }
    }
    for (const job of this.store.active()) {
      if (["approved", "uploading"].includes(job.state)) { job.state = "blocked"; job.approval = null; job.revision++; job.message = "Breadboard restarted before a start intent. Review and approve again; no upload or start was replayed."; job.blockers = [job.message]; this.store.unlock(job.id); }
      else if (job.state === "start_requested") { job.state = "start_unconfirmed"; job.message = "Breadboard restarted during dispatch. Inspect the printer while status is reconciled; no start will be resent."; }
      this.store.save(job, "runtime_restored_without_dispatch_replay");
    }
    this.recoverInspections();
  }
  recoverInspections() {
    for (const row of this.store.db.prepare("SELECT id FROM bambu_print_jobs WHERE state = 'validating'").all() as { id: string }[]) { const job = this.store.get(row.id); job.state = "needs_file"; job.revision++; job.message = "File inspection was interrupted. Choose the file again."; this.store.save(job); }
  }
  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.tickOnce().finally(() => { this.ticking = null; }); return this.ticking;
  }
  private async tickOnce() {
    for (const job of this.store.active()) {
      if (job.state === "approved") {
        try { await this.dispatch(job.id); }
        catch { const current = this.store.get(job.id); if (current.state === "approved") { current.state = "blocked"; current.approval = null; current.revision++; current.message = "Approval expired or setup changed. Review again."; current.blockers = [current.message]; this.store.unlock(current.id); this.store.save(current, "approval_rejected"); } }
      } else if (job.review) {
        try { this.observe(job.id, await this.adapter.observe(await this.credentials(this.store.printer(job.review.printerId)))); }
        catch { this.observe(job.id, { observedAt: now(), connected: false }); }
      }
    }
  }
  view(id: string, userId: number, conversation: string): JobView {
    const job = this.store.get(id, userId, conversation);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Approval authority is deliberately omitted from all renderer views.
    const { approval: _approval, ...display } = job;
    return { job: display, printers: this.store.printers(userId), printer: job.review ? this.store.printer(job.review.printerId, userId).config : null, stale: !job.telemetry?.connected || !recent(job.telemetry.observedAt, 30_000) || (isActive(job.state) && !matchesJob(job, job.telemetry)) };
  }
}
