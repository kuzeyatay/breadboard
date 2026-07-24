// Breadboard-owned, normalized domain types for the UI-TARS adapter.
//
// These are STABLE Breadboard types. Upstream Agent TARS event/tool shapes are
// deliberately kept out of this file so no Breadboard code depends on upstream
// churn — the only place upstream types appear is agent-tars-runtime.ts.

/** The MVP operator is browser-only. `computer` is intentionally unsupported. */
export type OperatorType = "browser";

export type BrowserStrategy = "gui" | "dom" | "hybrid";

export type ApprovalMode = "every_action" | "sensitive_actions";

/**
 * Validated UI-TARS agent configuration. This is the NON-secret portion — the
 * provider API key is stored separately and injected via env, never present here.
 */
export interface UITarsAgentConfiguration {
  operator: OperatorType;
  browserStrategy: BrowserStrategy;

  provider: string;
  model: string;
  endpoint?: string;

  maxSteps: number;
  timeoutMs: number;

  approvalMode: ApprovalMode;
  allowedDomains: string[];

  allowDownloads: boolean;
  allowClipboard: boolean;
  allowFileUpload: boolean;
}

/** Explicit, validated run state machine. Terminal states never re-open. */
export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "aborted"
  | "runtime_lost";

export const TERMINAL_STATES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "aborted",
  "runtime_lost",
]);

/** Stable Breadboard-owned normalized event types. */
export type NormalizedEventType =
  | "run.queued"
  | "run.started"
  | "run.status"
  | "observation.screenshot"
  | "observation.page"
  | "action.proposed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "action.started"
  | "action.completed"
  | "action.failed"
  | "artifact.created"
  | "run.completed"
  | "run.failed"
  | "run.aborted"
  | "runtime.disconnected";

/**
 * A normalized event. `payload` holds only normalized fields plus a bounded
 * diagnostic blob — never raw unbounded upstream payloads, and never secrets,
 * cookies, headers, or provider request bodies.
 */
export interface NormalizedEvent {
  runId: string;
  sequenceNumber: number;
  type: NormalizedEventType;
  at: string; // ISO timestamp
  payload: Record<string, unknown>;
}

export type RiskLevel = "low" | "medium" | "high";

export type ApprovalActionType =
  | "click"
  | "type"
  | "submit"
  | "upload"
  | "download"
  | "navigate";

/** A pending approval — authorizes exactly ONE action, single-use, time-boxed. */
export interface ApprovalRequest {
  actionId: string;
  runId: string;
  action: ApprovalActionType;
  target: string;
  explanation: string;
  risk: RiskLevel;
  screenshotBefore?: string;
  requestedAt: string;
  expiresAt: string;
}

export type ApprovalDecision = "approved" | "rejected";

export interface RunFailure {
  code: string;
  message: string;
}
