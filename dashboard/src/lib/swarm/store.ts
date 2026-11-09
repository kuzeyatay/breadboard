import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { prepareSwarmTasks, taskFingerprint, validateSwarmLimits, validateSwarmPlan, type ExecutorAdmission } from "./policy.ts";
import { SwarmError, type PreparedSwarmTask, type SwarmAttempt, type SwarmAuthority, type SwarmEvidence,
  type SwarmEvidenceInput, type SwarmEvent, type SwarmExecutor, type SwarmHandle, type SwarmLease,
  type SwarmLimits, type SwarmPlan, type SwarmRun, type SwarmSnapshot, type SwarmStatus,
  type SwarmTask, type SwarmTaskStatus, type SwarmVerification } from "./types.ts";

interface RunRow {
  id: string; user_id: number; conversation_id: number; request_id: string; plan_hash: string;
  authority_json: string; objective: string; reason: string; benefit: SwarmPlan["benefit"];
  mode: SwarmPlan["mode"]; status: SwarmStatus; limits_json: string; revision: number;
  created_at: number; updated_at: number; deadline_at: number; lease_owner: string | null;
  lease_fence: number; lease_until: number;
}
interface TaskRow { run_id: string; task_key: string; spec_json: string; status: SwarmTaskStatus;
  approved: number; attempt_count: number; active_attempt_id: string | null; summary: string; error: string | null }
interface AttemptRow { id: string; run_id: string; task_key: string; number: number; request_id: string;
  status: SwarmAttempt["status"]; handle_json: string | null; reserved_tokens: number; charged_tokens: number;
  reported_tokens: number; usage_complete: number; started_at: number; updated_at: number }

const ACTIVE_ATTEMPTS = "('starting','running','cancelling')";
const TERMINAL_RUNS = new Set<SwarmStatus>(["completed", "cancelled", "failed"]);
const TERMINAL_ATTEMPTS = new Set<SwarmAttempt["status"]>(["verifying", "completed", "failed", "cancelled", "uncertain"]);

export function ensureSwarmSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS swarm_runs (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, plan_hash TEXT NOT NULL, authority_json TEXT NOT NULL,
      objective TEXT NOT NULL, reason TEXT NOT NULL, benefit TEXT NOT NULL, mode TEXT NOT NULL,
      status TEXT NOT NULL, limits_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL,
      lease_owner TEXT, lease_fence INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
      UNIQUE(conversation_id, request_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS swarm_one_coordinator ON swarm_runs(conversation_id)
      WHERE status NOT IN ('completed','cancelled','failed');
    CREATE TABLE IF NOT EXISTS swarm_tasks (
      run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE, task_key TEXT NOT NULL,
      spec_json TEXT NOT NULL, status TEXT NOT NULL, approved INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0, active_attempt_id TEXT,
      summary TEXT NOT NULL DEFAULT '', error TEXT, PRIMARY KEY(run_id,task_key)
    );
    CREATE TABLE IF NOT EXISTS swarm_attempts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_key TEXT NOT NULL, number INTEGER NOT NULL,
      request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, handle_json TEXT,
      reserved_tokens INTEGER NOT NULL, charged_tokens INTEGER NOT NULL DEFAULT 0,
      reported_tokens INTEGER NOT NULL DEFAULT 0, usage_complete INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY(run_id,task_key) REFERENCES swarm_tasks(run_id,task_key) ON DELETE CASCADE,
      UNIQUE(run_id,task_key,number)
    );
    CREATE TABLE IF NOT EXISTS swarm_resources (
      resource TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES swarm_attempts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS swarm_evidence (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_key TEXT NOT NULL,
      attempt_id TEXT NOT NULL REFERENCES swarm_attempts(id) ON DELETE CASCADE,
      title TEXT NOT NULL, summary TEXT NOT NULL, kind TEXT NOT NULL, reference TEXT NOT NULL,
      fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(run_id,task_key) REFERENCES swarm_tasks(run_id,task_key) ON DELETE CASCADE,
      UNIQUE(attempt_id,fingerprint)
    );
    CREATE TABLE IF NOT EXISTS swarm_verifications (
      run_id TEXT NOT NULL, task_key TEXT NOT NULL, attempt_id TEXT NOT NULL,
      checks_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(run_id,task_key) REFERENCES swarm_tasks(run_id,task_key) ON DELETE CASCADE,
      PRIMARY KEY(run_id,task_key,attempt_id)
    );
    CREATE TABLE IF NOT EXISTS swarm_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
      type TEXT NOT NULL, task_key TEXT, detail_json TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS swarm_events_run ON swarm_events(run_id,sequence);
    CREATE TRIGGER IF NOT EXISTS swarm_preserve_cancellation BEFORE DELETE ON conversations
      WHEN EXISTS (SELECT 1 FROM swarm_runs WHERE conversation_id=OLD.id AND status NOT IN ('completed','cancelled','failed'))
      BEGIN SELECT RAISE(ABORT,'Team workers must stop before their conversation is deleted.'); END;
  `);
}

function taskFrom(row: TaskRow): SwarmTask {
  return { ...JSON.parse(row.spec_json) as PreparedSwarmTask, runId: row.run_id,
    status: row.status, attemptCount: row.attempt_count, activeAttemptId: row.active_attempt_id,
    summary: row.summary, error: row.error };
}
function attemptFrom(row: AttemptRow): SwarmAttempt {
  return { id: row.id, runId: row.run_id, taskKey: row.task_key, number: row.number,
    requestId: row.request_id, status: row.status, handle: row.handle_json ? JSON.parse(row.handle_json) : null,
    reservedTokens: row.reserved_tokens, chargedTokens: row.charged_tokens,
    reportedTokens: row.reported_tokens, usageComplete: row.usage_complete === 1,
    startedAt: row.started_at, updatedAt: row.updated_at };
}

/** Real SQLite transactions protect admission across route bundles and restarts. */
export class SwarmStore {
  readonly db: Database.Database;
  readonly now: () => number;
  constructor(db: Database.Database, now: () => number = Date.now) {
    this.db = db; this.now = now; ensureSwarmSchema(db);
  }

  private owned(userId: number, runId: string): RunRow {
    const row = this.db.prepare(`SELECT r.* FROM swarm_runs r JOIN conversations c ON c.id=r.conversation_id
      WHERE r.id=? AND r.user_id=? AND c.user_id=?`).get(runId, userId, userId) as RunRow | undefined;
    if (!row) throw new SwarmError("swarm_not_found", "This team is unavailable.", 404);
    return row;
  }

  private event(runId: string, type: string, taskKey: string | null, detail: Record<string, unknown> = {}): void {
    this.db.prepare("INSERT INTO swarm_events(run_id,type,task_key,detail_json,at) VALUES (?,?,?,?,?)")
      .run(runId, type, taskKey, JSON.stringify(detail), this.now());
    this.db.prepare("UPDATE swarm_runs SET updated_at=? WHERE id=?").run(this.now(), runId);
  }

  private task(runId: string, key: string): TaskRow {
    const row = this.db.prepare("SELECT * FROM swarm_tasks WHERE run_id=? AND task_key=?").get(runId, key) as TaskRow | undefined;
    if (!row) throw new SwarmError("swarm_task_not_found", "Assignment not found.", 404);
    return row;
  }

  private attempt(runId: string, attemptId: string): AttemptRow {
    const row = this.db.prepare("SELECT * FROM swarm_attempts WHERE run_id=? AND id=?").get(runId, attemptId) as AttemptRow | undefined;
    if (!row) throw new SwarmError("swarm_attempt_not_found", "Attempt not found.", 404);
    return row;
  }

  private fenced(lease: SwarmLease): RunRow {
    const row = this.db.prepare("SELECT * FROM swarm_runs WHERE id=? AND lease_owner=? AND lease_fence=? AND lease_until>?")
      .get(lease.runId, lease.owner, lease.fence, this.now()) as RunRow | undefined;
    if (!row) throw new SwarmError("swarm_stale_coordinator", "This coordinator no longer owns the team.", 409);
    return row;
  }

  private totals(runId: string): { charged: number; reserved: number } {
    return this.db.prepare(`SELECT COALESCE(SUM(charged_tokens),0) AS charged,
      COALESCE(SUM(CASE WHEN status IN ${ACTIVE_ATTEMPTS} THEN MAX(0,reserved_tokens-charged_tokens) ELSE 0 END),0) AS reserved
      FROM swarm_attempts WHERE run_id=?`).get(runId) as { charged: number; reserved: number };
  }

  get(userId: number, runId: string): SwarmRun {
    const row = this.owned(userId, runId);
    const totals = this.totals(runId);
    return { id: row.id, authority: JSON.parse(row.authority_json), requestId: row.request_id,
      objective: row.objective, reason: row.reason, benefit: row.benefit, mode: row.mode, status: row.status,
      limits: JSON.parse(row.limits_json), revision: row.revision, createdAt: row.created_at,
      updatedAt: row.updated_at, deadlineAt: row.deadline_at, chargedTokens: totals.charged, reservedTokens: totals.reserved };
  }

  create(input: { authority: SwarmAuthority; requestId: string; plan: unknown; limits: SwarmLimits;
    admission: (executor: SwarmExecutor) => ExecutorAdmission }): SwarmRun {
    const limits = validateSwarmLimits(input.limits);
    const plan = validateSwarmPlan(input.plan, limits);
    const tasks = prepareSwarmTasks(plan, input.authority, limits, input.admission);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(input.requestId)) throw new SwarmError("swarm_request_id", "Provide a stable request identifier.");
    const hash = createHash("sha256").update(JSON.stringify({ plan, limits, tasks })).digest("hex");
    const runId = this.db.transaction(() => {
      const owner = this.db.prepare("SELECT user_id FROM conversations WHERE id=?").get(input.authority.conversationId) as { user_id: number } | undefined;
      if (owner?.user_id !== input.authority.userId) throw new SwarmError("swarm_conversation_scope", "The conversation is unavailable.", 403);
      const existing = this.db.prepare("SELECT * FROM swarm_runs WHERE conversation_id=? AND request_id=?")
        .get(input.authority.conversationId, input.requestId) as RunRow | undefined;
      if (existing) {
        if (existing.plan_hash !== hash) throw new SwarmError("swarm_request_conflict", "This request identifier already belongs to a different plan.", 409);
        return existing.id;
      }
      if (this.db.prepare("SELECT 1 FROM swarm_runs WHERE conversation_id=? AND status NOT IN ('completed','cancelled','failed')").get(input.authority.conversationId)) {
        throw new SwarmError("swarm_already_active", "Continue or stop the current team before starting another.", 409);
      }
      const id = `swarm_${randomUUID()}`;
      const now = this.now();
      this.db.prepare(`INSERT INTO swarm_runs(id,user_id,conversation_id,request_id,plan_hash,authority_json,objective,reason,benefit,mode,status,limits_json,created_at,updated_at,deadline_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'running',?,?,?,?)`).run(id, input.authority.userId, input.authority.conversationId, input.requestId, hash,
        JSON.stringify(input.authority), plan.objective, plan.reason, plan.benefit, plan.mode, JSON.stringify(limits), now, now, now + limits.maxDurationMs);
      const insert = this.db.prepare("INSERT INTO swarm_tasks(run_id,task_key,spec_json,status,approved) VALUES (?,?,?,?,?)");
      for (const task of tasks) insert.run(id, task.key, JSON.stringify(task), task.requiresApproval ? "awaiting_approval" : "queued", task.requiresApproval ? 0 : 1);
      this.event(id, "team.created", null, { objective: plan.objective, reason: plan.reason, tasks: tasks.length });
      this.refresh(id);
      return id;
    }).immediate();
    return this.get(input.authority.userId, runId);
  }

  snapshot(userId: number, runId: string, afterSequence = 0): SwarmSnapshot {
    const run = this.get(userId, runId);
    const tasks = (this.db.prepare("SELECT * FROM swarm_tasks WHERE run_id=? ORDER BY rowid").all(runId) as TaskRow[]).map(taskFrom);
    const attempts = (this.db.prepare("SELECT * FROM swarm_attempts WHERE run_id=? ORDER BY started_at,rowid").all(runId) as AttemptRow[]).map(attemptFrom);
    const evidence = this.db.prepare(`SELECT id,run_id AS runId,task_key AS taskKey,attempt_id AS attemptId,title,summary,kind,reference,created_at AS createdAt
      FROM swarm_evidence WHERE run_id=? ORDER BY created_at,rowid`).all(runId) as SwarmEvidence[];
    const events = (this.db.prepare("SELECT * FROM swarm_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 500").all(runId, afterSequence) as Array<{
      sequence: number; run_id: string; type: string; task_key: string | null; detail_json: string; at: number;
    }>).map(row => ({ sequence: row.sequence, runId: row.run_id, type: row.type, taskKey: row.task_key, detail: JSON.parse(row.detail_json), at: row.at } as SwarmEvent));
    return { run, tasks, attempts, evidence, events };
  }

  pending(): Array<{ id: string; userId: number; conversationId: number }> {
    return this.db.prepare(`SELECT id,user_id AS userId,conversation_id AS conversationId FROM swarm_runs
      WHERE status NOT IN ('completed','cancelled','failed') ORDER BY created_at`).all() as Array<{ id: string; userId: number; conversationId: number }>;
  }

  acquireLease(userId: number, runId: string, owner: string, ttlMs = 30_000): SwarmLease | null {
    this.owned(userId, runId);
    if (!owner || owner.length > 180 || ttlMs < 1_000 || ttlMs > 120_000) throw new SwarmError("swarm_lease", "Invalid coordinator lease.");
    return this.db.transaction(() => {
      const row = this.owned(userId, runId);
      if (TERMINAL_RUNS.has(row.status) || (row.lease_owner && row.lease_until > this.now() && row.lease_owner !== owner)) return null;
      const fence = row.lease_fence + (row.lease_owner === owner && row.lease_until > this.now() ? 0 : 1);
      this.db.prepare("UPDATE swarm_runs SET lease_owner=?,lease_fence=?,lease_until=? WHERE id=?").run(owner, fence, this.now() + ttlMs, runId);
      return { runId, owner, fence };
    }).immediate();
  }

  releaseLease(lease: SwarmLease): void {
    this.db.prepare("UPDATE swarm_runs SET lease_owner=NULL,lease_until=0 WHERE id=? AND lease_owner=? AND lease_fence=?")
      .run(lease.runId, lease.owner, lease.fence);
  }

  /** Atomic reservations precede any side effect, including executor startup. */
  claimNext(lease: SwarmLease): { task: SwarmTask; attempt: SwarmAttempt } | null {
    return this.db.transaction(() => {
      const row = this.fenced(lease);
      if (row.status !== "running") return null;
      const limits = JSON.parse(row.limits_json) as SwarmLimits;
      if (this.now() >= row.deadline_at) { this.limitRun(row.id, "The team reached its time budget."); return null; }
      const tasks = (this.db.prepare("SELECT * FROM swarm_tasks WHERE run_id=? ORDER BY rowid").all(row.id) as TaskRow[]).map(taskFrom);
      const active = tasks.filter(task => ["starting", "running", "cancelling"].includes(task.status));
      if (active.length >= limits.maxParallel) return null;
      const usedSlots = active.reduce((sum, task) => sum + task.workerSlots, 0);
      const totals = this.totals(row.id);
      const candidates = tasks.filter(task => task.status === "queued" && task.dependsOn.every(key => {
        const dependency = tasks.find(item => item.key === key);
        return dependency?.status === "completed" || (task.verifies === key && dependency?.status === "verifying");
      }));
      let budgetBlocked = false;
      for (const task of candidates) {
        if (usedSlots + task.workerSlots > limits.maxWorkerSlots) continue;
        if (task.attemptCount >= limits.maxAttemptsPerTask) continue;
        if (totals.charged + totals.reserved + task.tokenBudget > limits.maxTokens) { budgetBlocked = true; continue; }
        if (task.resources.some(resource => this.db.prepare("SELECT 1 FROM swarm_resources WHERE resource=?").get(resource))) continue;
        const id = `attempt_${randomUUID()}`;
        const requestId = `${row.id}:${task.key}:${task.attemptCount + 1}`;
        this.db.prepare(`INSERT INTO swarm_attempts(id,run_id,task_key,number,request_id,status,reserved_tokens,started_at,updated_at)
          VALUES (?,?,?,?,?,'starting',?,?,?)`).run(id, row.id, task.key, task.attemptCount + 1, requestId, task.tokenBudget, this.now(), this.now());
        for (const resource of task.resources) this.db.prepare("INSERT INTO swarm_resources(resource,attempt_id) VALUES (?,?)").run(resource, id);
        this.db.prepare("UPDATE swarm_tasks SET status='starting',attempt_count=attempt_count+1,active_attempt_id=?,error=NULL WHERE run_id=? AND task_key=?").run(id, row.id, task.key);
        this.event(row.id, "task.starting", task.key, { attemptId: id, requestId });
        return { task: taskFrom(this.task(row.id, task.key)), attempt: attemptFrom(this.attempt(row.id, id)) };
      }
      if (budgetBlocked && !active.length) this.limitRun(row.id, "The remaining token budget cannot admit the next assignment.");
      return null;
    }).immediate();
  }

  private limitRun(runId: string, reason: string): void {
    this.db.prepare("UPDATE swarm_runs SET status='budget_limited' WHERE id=? AND status NOT IN ('cancelling','cancelled','completed','failed')").run(runId);
    this.event(runId, "team.budget_limited", null, { reason });
  }

  attach(lease: SwarmLease, attemptId: string, handle: SwarmHandle): void {
    this.db.transaction(() => {
      this.fenced(lease);
      const attempt = this.attempt(lease.runId, attemptId);
      const task = taskFrom(this.task(lease.runId, attempt.task_key));
      if (handle.kind !== task.executor.kind || handle.id !== task.executor.id || typeof handle.runId !== "string" || !handle.runId || handle.runId.length > 256) throw new SwarmError("swarm_handle", "Executor returned an invalid run handle.", 502);
      if (attempt.handle_json) {
        if (attempt.handle_json !== JSON.stringify(handle)) throw new SwarmError("swarm_handle_conflict", "This attempt already owns another run.", 409);
        return;
      }
      if (!["starting", "cancelling", "uncertain"].includes(attempt.status)) throw new SwarmError("swarm_attempt_state", "This attempt can no longer accept a run.", 409);
      const status = attempt.status === "cancelling" ? "cancelling" : "running";
      this.db.prepare("UPDATE swarm_attempts SET handle_json=?,status=?,updated_at=? WHERE id=?").run(JSON.stringify(handle), status, this.now(), attemptId);
      this.db.prepare("UPDATE swarm_tasks SET status=? WHERE run_id=? AND task_key=?").run(status, lease.runId, attempt.task_key);
      this.event(lease.runId, "task.attached", attempt.task_key, { attemptId, handle });
    }).immediate();
  }

  reportUsage(lease: SwarmLease, attemptId: string, totalTokens: number, complete: boolean): void {
    this.db.transaction(() => {
      const run = this.fenced(lease);
      const attempt = this.attempt(lease.runId, attemptId);
      if (!Number.isSafeInteger(totalTokens) || totalTokens < 0) throw new SwarmError("swarm_usage", "Invalid usage receipt.");
      // A replayed or older cumulative receipt cannot refund spent tokens.
      const reported = Math.max(totalTokens, attempt.reported_tokens);
      const usageComplete = attempt.usage_complete === 1 || complete;
      const terminal = TERMINAL_ATTEMPTS.has(attempt.status);
      const charged = terminal && !usageComplete ? Math.max(reported, attempt.reserved_tokens) : reported;
      this.db.prepare("UPDATE swarm_attempts SET reported_tokens=?,charged_tokens=?,usage_complete=?,updated_at=? WHERE id=?")
        .run(reported, charged, usageComplete ? 1 : 0, this.now(), attemptId);
      if (this.totals(lease.runId).charged > (JSON.parse(run.limits_json) as SwarmLimits).maxTokens) this.limitRun(lease.runId, "Observed usage exhausted the team budget.");
      else if (reported > attempt.reserved_tokens) this.limitRun(lease.runId, "Observed usage exhausted an assignment's token budget.");
    }).immediate();
  }

  evidence(lease: SwarmLease, attemptId: string, inputs: readonly SwarmEvidenceInput[]): string[] {
    return this.db.transaction(() => {
      this.fenced(lease);
      const attempt = this.attempt(lease.runId, attemptId);
      if (inputs.length > 100) throw new SwarmError("swarm_evidence_limit", "Save at most 100 evidence records at once.");
      const ids: string[] = [];
      for (const input of inputs) {
        if (!input || !input.title?.trim() || input.title.length > 300 || typeof input.summary !== "string" || input.summary.length > 16_000 || !input.reference?.trim() || input.reference.length > 2_000 || !["observation", "inference", "dispute", "artifact", "validation"].includes(input.kind)) throw new SwarmError("swarm_evidence", "Evidence needs a bounded title, summary, kind and source reference.");
        const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const previous = this.db.prepare("SELECT id FROM swarm_evidence WHERE attempt_id=? AND fingerprint=?").get(attemptId, fingerprint) as { id: string } | undefined;
        if (previous) { ids.push(previous.id); continue; }
        const id = `evidence_${randomUUID()}`;
        this.db.prepare("INSERT INTO swarm_evidence(id,run_id,task_key,attempt_id,title,summary,kind,reference,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(id, lease.runId, attempt.task_key, attemptId, input.title.trim(), input.summary, input.kind, input.reference.trim(), fingerprint, this.now());
        ids.push(id);
      }
      if (ids.length) this.event(lease.runId, "task.evidence", attempt.task_key, { evidenceIds: ids });
      return ids;
    }).immediate();
  }

  settle(lease: SwarmLease, attemptId: string, outcome: "completed" | "failed" | "cancelled" | "uncertain", summary: string, error?: string): void {
    this.db.transaction(() => {
      const run = this.fenced(lease);
      const attempt = this.attempt(lease.runId, attemptId);
      if (TERMINAL_ATTEMPTS.has(attempt.status) && !(attempt.status === "uncertain" && outcome !== "uncertain")) return;
      // Cancellation owns the outcome even when an executor finishes concurrently.
      const stopped = attempt.status === "cancelling" || run.status === "cancelling";
      const status = outcome === "uncertain" ? "uncertain" : stopped ? "cancelled" : outcome === "completed" ? "verifying" : outcome;
      const charged = attempt.usage_complete ? attempt.reported_tokens : Math.max(attempt.reserved_tokens, attempt.reported_tokens);
      this.db.prepare("UPDATE swarm_attempts SET status=?,charged_tokens=?,updated_at=? WHERE id=?").run(status, charged, this.now(), attemptId);
      this.db.prepare("UPDATE swarm_tasks SET status=?,summary=?,error=? WHERE run_id=? AND task_key=?")
        .run(status, summary.slice(0, 48_000), error?.slice(0, 2_000) ?? null, lease.runId, attempt.task_key);
      // Uncertain means the job might still be acting. Preserve its locks.
      if (status !== "uncertain") this.db.prepare("DELETE FROM swarm_resources WHERE attempt_id=?").run(attemptId);
      this.event(lease.runId, `task.${status}`, attempt.task_key, { attemptId, summary: summary.slice(0, 1_000), ...(error ? { error: error.slice(0, 2_000) } : {}) });
      this.refresh(run.id);
    }).immediate();
  }

  observedRunning(lease: SwarmLease, attemptId: string): void {
    this.db.transaction(() => {
      this.fenced(lease);
      const attempt = this.attempt(lease.runId, attemptId);
      if (attempt.status !== "uncertain" || !attempt.handle_json) return;
      this.db.prepare("UPDATE swarm_attempts SET status='running',updated_at=? WHERE id=?").run(this.now(), attemptId);
      this.db.prepare("UPDATE swarm_tasks SET status='running',error=NULL WHERE run_id=? AND task_key=?").run(lease.runId, attempt.task_key);
      this.event(lease.runId, "task.reconciled", attempt.task_key, { attemptId, status: "running" });
      this.refresh(lease.runId);
    }).immediate();
  }

  checkpoint(lease: SwarmLease, type: string, taskKey: string | null, detail: Record<string, unknown>): void {
    this.db.transaction(() => {
      this.fenced(lease);
      if (JSON.stringify(detail).length > 4_000) throw new SwarmError("swarm_checkpoint", "Checkpoint metadata is too large.");
      // Transient observation errors can recur while a service recovers. Keep
      // one bounded diagnostic rather than growing a log on every poll.
      const previous = this.db.prepare("SELECT type,detail_json FROM swarm_events WHERE run_id=? AND task_key IS ? ORDER BY sequence DESC LIMIT 1")
        .get(lease.runId, taskKey) as { type: string; detail_json: string } | undefined;
      if (previous?.type !== type || previous.detail_json !== JSON.stringify(detail)) this.event(lease.runId, type, taskKey, detail);
    }).immediate();
  }

  stopActiveForBudget(lease: SwarmLease): void {
    this.db.transaction(() => {
      const run = this.fenced(lease);
      if (run.status !== "budget_limited") return;
      this.db.prepare("UPDATE swarm_tasks SET status='cancelling' WHERE run_id=? AND status IN ('starting','running','uncertain')").run(run.id);
      this.db.prepare("UPDATE swarm_attempts SET status='cancelling' WHERE run_id=? AND status IN ('starting','running','uncertain')").run(run.id);
    }).immediate();
  }

  verify(userId: number, runId: string, taskKey: string, checks: SwarmVerification[]): void {
    this.db.transaction(() => {
      const run = this.owned(userId, runId);
      if (TERMINAL_RUNS.has(run.status) || run.status === "cancelling") throw new SwarmError("swarm_stopped", "This team is no longer accepting results.", 409);
      const row = this.task(runId, taskKey);
      const task = taskFrom(row);
      if (task.status !== "verifying" || !task.activeAttemptId) throw new SwarmError("swarm_verification_state", "Wait for the assignment's actual result before verifying it.", 409);
      if (!Array.isArray(checks) || checks.length !== task.acceptance.length || new Set(checks.map(check => check.criterion)).size !== checks.length) throw new SwarmError("swarm_verification", "Verify each original completion criterion exactly once.");
      for (const check of checks) {
        if (!task.acceptance.includes(check.criterion) || typeof check.passed !== "boolean" || !Array.isArray(check.evidenceIds) || !check.evidenceIds.length || check.evidenceIds.length > 20) throw new SwarmError("swarm_verification", "Every check needs its original criterion, verdict and evidence.");
        for (const id of check.evidenceIds) {
          const evidence = this.db.prepare("SELECT task_key,attempt_id FROM swarm_evidence WHERE id=? AND run_id=?").get(id, runId) as { task_key: string; attempt_id: string } | undefined;
          if (!evidence) throw new SwarmError("swarm_verification_scope", "Verification references evidence outside this team.", 403);
          const evidenceTask = taskFrom(this.task(runId, evidence.task_key));
          if (evidenceTask.activeAttemptId !== evidence.attempt_id || (evidence.task_key !== taskKey && evidenceTask.verifies !== taskKey)) throw new SwarmError("swarm_verification_scope", "Use current evidence from this assignment or its reviewer.", 403);
        }
      }
      const status = checks.every(check => check.passed) ? "completed" : "failed";
      this.db.prepare("INSERT INTO swarm_verifications(run_id,task_key,attempt_id,checks_json,created_at) VALUES (?,?,?,?,?)")
        .run(runId, taskKey, task.activeAttemptId, JSON.stringify(checks), this.now());
      this.db.prepare("UPDATE swarm_tasks SET status=?,error=? WHERE run_id=? AND task_key=?").run(status, status === "failed" ? "The result did not meet its completion criteria." : null, runId, taskKey);
      this.db.prepare("UPDATE swarm_attempts SET status=? WHERE id=?").run(status, task.activeAttemptId);
      this.event(runId, "task.verified", taskKey, { passed: status === "completed", checks });
      this.refresh(runId);
    }).immediate();
  }

  approve(userId: number, runId: string, taskKey: string): void {
    this.db.transaction(() => {
      const run = this.owned(userId, runId);
      if (TERMINAL_RUNS.has(run.status) || run.status === "cancelling") throw new SwarmError("swarm_stopped", "The team was stopped.", 409);
      const task = this.task(runId, taskKey);
      if (task.status !== "awaiting_approval") throw new SwarmError("swarm_approval_state", "This assignment is not waiting for approval.", 409);
      this.db.prepare("UPDATE swarm_tasks SET status='queued',approved=1 WHERE run_id=? AND task_key=?").run(runId, taskKey);
      this.event(runId, "task.approved", taskKey);
      this.refresh(runId);
    }).immediate();
  }

  retry(userId: number, runId: string, taskKey: string, correctedBrief: string): void {
    this.db.transaction(() => {
      const run = this.owned(userId, runId);
      if (TERMINAL_RUNS.has(run.status) || run.status === "cancelling") throw new SwarmError("swarm_stopped", "The team was stopped.", 409);
      const task = taskFrom(this.task(runId, taskKey));
      if (task.status !== "failed") throw new SwarmError("swarm_retry_state", "Only an observed failed attempt can be retried. Reconcile uncertain work first.", 409);
      if (task.attemptCount >= (JSON.parse(run.limits_json) as SwarmLimits).maxAttemptsPerTask) throw new SwarmError("swarm_attempt_limit", "This assignment reached its attempt limit.", 409);
      if (!correctedBrief.trim() || correctedBrief.length > 8_000 || correctedBrief.trim().startsWith("/") || taskFingerprint({ ...task, brief: correctedBrief }) === taskFingerprint(task)) throw new SwarmError("swarm_retry_correction", "Describe the correction before retrying the failed work.");
      const spec = JSON.parse(this.task(runId, taskKey).spec_json) as PreparedSwarmTask;
      spec.brief = correctedBrief.trim();
      this.db.prepare("UPDATE swarm_tasks SET status='queued',spec_json=?,active_attempt_id=NULL,error=NULL WHERE run_id=? AND task_key=?").run(JSON.stringify(spec), runId, taskKey);
      this.event(runId, "task.retry_requested", taskKey);
      this.refresh(runId);
    }).immediate();
  }

  control(userId: number, runId: string, action: "pause" | "resume" | "cancel"): SwarmRun {
    this.db.transaction(() => {
      const run = this.owned(userId, runId);
      if (TERMINAL_RUNS.has(run.status)) return;
      if (action === "cancel") {
        this.db.prepare("UPDATE swarm_runs SET status='cancelling' WHERE id=?").run(runId);
        this.db.prepare("UPDATE swarm_tasks SET status='cancelled' WHERE run_id=? AND status IN ('queued','awaiting_approval','blocked','verifying','failed')").run(runId);
        this.db.prepare("UPDATE swarm_tasks SET status='cancelling' WHERE run_id=? AND status IN ('starting','running','uncertain')").run(runId);
        this.db.prepare("UPDATE swarm_attempts SET status='cancelling' WHERE run_id=? AND status IN ('starting','running','uncertain')").run(runId);
      } else {
        if (run.status === "cancelling") throw new SwarmError("swarm_stopped", "A cancelled team cannot resume.", 409);
        if (action === "resume" && (this.now() >= run.deadline_at || this.totals(runId).charged >= (JSON.parse(run.limits_json) as SwarmLimits).maxTokens)) throw new SwarmError("swarm_budget", "The team has no remaining budget.", 409);
        this.db.prepare("UPDATE swarm_runs SET status=? WHERE id=?").run(action === "pause" ? "paused" : "running", runId);
      }
      this.event(runId, `team.${action}`, null);
      this.refresh(runId);
    }).immediate();
    return this.get(userId, runId);
  }

  /** Only ledger state changes here. Process outcomes come from executor receipts. */
  private refresh(runId: string): void {
    const run = this.db.prepare("SELECT * FROM swarm_runs WHERE id=?").get(runId) as RunRow;
    if (TERMINAL_RUNS.has(run.status)) return;
    const allTasks = (this.db.prepare("SELECT * FROM swarm_tasks WHERE run_id=?").all(runId) as TaskRow[]).map(taskFrom);
    // Propagate failed prerequisites. Repeating the pass covers a chain without
    // depending on insertion order; a corrected predecessor unblocks it again.
    for (let pass = 0; pass < allTasks.length; pass++) {
      let changed = false;
      for (const task of allTasks) {
        if (!["queued", "blocked"].includes(task.status)) continue;
        const blocked = task.dependsOn.some(key => allTasks.some(other => other.key === key && ["failed", "uncertain", "cancelled", "blocked"].includes(other.status)));
        const next = blocked ? "blocked" : "queued";
        if (next === task.status) continue;
        task.status = next; changed = true;
        this.db.prepare("UPDATE swarm_tasks SET status=?,error=? WHERE run_id=? AND task_key=?")
          .run(next, blocked ? "A prerequisite needs attention." : null, runId, task.key);
        this.event(runId, `task.${next}`, task.key);
      }
      if (!changed) break;
    }
    const tasks = allTasks;
    let status = run.status;
    if (run.status === "cancelling") {
      if (!tasks.some(task => ["starting", "running", "cancelling", "uncertain"].includes(task.status))) status = "cancelled";
    } else if (tasks.every(task => task.status === "completed")) status = "completed";
    else if (!["paused", "budget_limited"].includes(run.status)) {
      if (tasks.some(task => ["queued", "starting", "running"].includes(task.status))) status = "running";
      else if (tasks.some(task => task.status === "verifying")) status = "verifying";
      else status = "awaiting_input";
    }
    if (status !== run.status) {
      this.db.prepare("UPDATE swarm_runs SET status=? WHERE id=?").run(status, runId);
      this.event(runId, `team.${status}`, null);
    }
  }
}
