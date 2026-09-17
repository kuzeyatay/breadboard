import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { fail, type PrintJob, type PrinterConfig, type JobScope } from "./types.ts";

export function ensureBambuSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bambu_printers (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      physical_identity TEXT NOT NULL UNIQUE, host TEXT NOT NULL, serial TEXT NOT NULL,
      config_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bambu_print_jobs (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      conversation_id INTEGER, conversation_public_id TEXT NOT NULL,
      runtime_session_id INTEGER NOT NULL, run_id TEXT NOT NULL, originating_turn_id TEXT NOT NULL,
      draft_key TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, record_json TEXT NOT NULL,
      UNIQUE(user_id, run_id, draft_key)
    );
    CREATE INDEX IF NOT EXISTS bambu_job_conversation ON bambu_print_jobs(user_id, conversation_public_id);
    CREATE INDEX IF NOT EXISTS bambu_job_state ON bambu_print_jobs(state);
    CREATE TABLE IF NOT EXISTS bambu_printer_locks (
      physical_identity TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES bambu_print_jobs(id)
    );
    CREATE TABLE IF NOT EXISTS bambu_runtime_leases (lease_id TEXT PRIMARY KEY);
  `);
}
export interface SavedPrinter { config: PrinterConfig; userId: number; host: string; serial: string; physicalIdentity: string; }
export const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
export class BambuStore {
  db: Database.Database;
  constructor(db: Database.Database) { this.db = db; ensureBambuSchema(db); }
  transaction<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  printer(id: string, userId?: number): SavedPrinter {
    const row = this.db.prepare("SELECT * FROM bambu_printers WHERE id = ?").get(id) as { config_json: string; user_id: number; host: string; serial: string; physical_identity: string } | undefined;
    if (!row || (userId !== undefined && userId !== row.user_id)) fail("Printer not found.", "printer_not_found", 404);
    return { config: JSON.parse(row.config_json), userId: row.user_id, host: row.host, serial: row.serial, physicalIdentity: row.physical_identity };
  }
  printers(userId: number): PrinterConfig[] {
    return (this.db.prepare("SELECT config_json FROM bambu_printers WHERE user_id = ? ORDER BY id").all(userId) as { config_json: string }[]).map(row => JSON.parse(row.config_json));
  }
  savePrinter(printer: SavedPrinter) {
    this.db.prepare(`INSERT INTO bambu_printers VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, host = excluded.host, serial = excluded.serial`).run(printer.config.id, printer.userId, printer.physicalIdentity, printer.host, printer.serial, JSON.stringify(printer.config));
  }
  lock(physicalIdentity: string, jobId: string) {
    const lock = this.db.prepare("SELECT job_id FROM bambu_printer_locks WHERE physical_identity = ?").get(physicalIdentity) as { job_id: string } | undefined;
    if (lock && lock.job_id !== jobId) fail("This printer already has an approved or unresolved Breadboard job. Resolve that job first.", "printer_locked");
    this.db.prepare("INSERT OR IGNORE INTO bambu_printer_locks VALUES (?, ?)").run(physicalIdentity, jobId);
  }
  isLocked(physicalIdentity: string) { return Boolean(this.db.prepare("SELECT 1 FROM bambu_printer_locks WHERE physical_identity = ?").get(physicalIdentity)); }
  unlock(jobId: string) { this.db.prepare("DELETE FROM bambu_printer_locks WHERE job_id = ?").run(jobId); }
  get(id: string, userId?: number, conversationPublicId?: string): PrintJob {
    const row = this.db.prepare("SELECT record_json FROM bambu_print_jobs WHERE id = ?").get(id) as { record_json: string } | undefined;
    if (!row) fail("Print job not found.", "job_not_found", 404);
    const job: PrintJob = JSON.parse(row.record_json);
    if ((userId !== undefined && job.scope.userId !== userId) || (conversationPublicId !== undefined && job.scope.conversationPublicId !== conversationPublicId)) fail("Print job not found in this conversation.", "job_not_found", 404);
    return job;
  }
  save(job: PrintJob, event?: string) {
    const now = new Date().toISOString();
    job.updatedAt = now;
    if (event) job.audit = [...job.audit, { at: now, event }].slice(-100);
    this.db.prepare("UPDATE bambu_print_jobs SET revision = ?, state = ?, record_json = ? WHERE id = ?").run(job.revision, job.state, JSON.stringify(job), job.id);
  }
  active(): PrintJob[] {
    return (this.db.prepare("SELECT record_json FROM bambu_print_jobs WHERE state IN ('approved','uploading','start_requested','start_unconfirmed','preparing','printing','paused','cancel_requested')").all() as { record_json: string }[]).map(row => JSON.parse(row.record_json));
  }
  create(scope: JobScope, draftKey = "initial"): PrintJob {
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM bambu_print_jobs WHERE user_id = ? AND run_id = ? AND draft_key = ?").get(scope.userId, scope.runId, draftKey) as { id: string } | undefined;
      if (existing) return this.get(existing.id, scope.userId, scope.conversationPublicId);
      const id = randomUUID(), now = new Date().toISOString();
      const job: PrintJob = { id, resourceId: `printer:${id}`, scope, revision: 1, state: "needs_file", file: null, review: null, blockers: [], createdAt: now, updatedAt: now, finishedAt: null, telemetry: null, uploadBytes: null, uploadVerified: null, approval: null, attempt: null, pendingControl: null, message: null, audit: [{ at: now, event: "draft_created" }] };
      this.db.prepare("INSERT INTO bambu_print_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, scope.userId, scope.conversationId, scope.conversationPublicId, scope.runtimeSessionId, scope.runId, scope.originatingTurnId, draftKey, job.revision, job.state, JSON.stringify(job));
      return job;
    });
  }
}
