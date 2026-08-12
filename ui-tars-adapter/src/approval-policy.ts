// Approval policy: sensitive-action classification, allowed-domain matching,
// and a single-use / time-boxed / replay-safe approval registry.
//
// This is an EXECUTION boundary, not a cosmetic UI state. The registry is the
// authority the runtime consults before executing an intercepted action.

import crypto from "node:crypto";
import type {
  ApprovalActionType,
  ApprovalMode,
  ApprovalRequest,
  RiskLevel,
  UITarsAgentConfiguration,
} from "./types.ts";

/** A structured, upstream-agnostic description of a proposed operator action. */
export interface ProposedAction {
  toolName: string;
  action: ApprovalActionType;
  /** Human-readable target (selector text, url, label). Already sanitized. */
  target: string;
  /** For navigate: the destination URL. */
  targetUrl?: string;
  /** Runtime-detected form-submission intent (DOM-inspected). */
  submitIntent?: boolean;
  isDownload?: boolean;
  isUpload?: boolean;
  readsClipboard?: boolean;
  /** Arbitrary JS execution (browser_evaluate) — always high risk. */
  isEval?: boolean;
}

export interface Classification {
  sensitive: boolean;
  risk: RiskLevel;
  explanation: string;
}

/**
 * Domain allowlist match. An EMPTY allowlist means "no domain restriction".
 * A non-empty allowlist permits only listed apex domains and their subdomains.
 */
export function hostAllowed(host: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return allowedDomains.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    return h === dom || h.endsWith(`.${dom}`);
  });
}

/** Parse a host from a URL string; returns null if unparseable. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Decide whether a proposed action requires approval under the given config.
 * In `every_action` mode, everything requires approval.
 */
export function classify(
  action: ProposedAction,
  config: Pick<UITarsAgentConfiguration, "approvalMode" | "allowedDomains">,
): Classification {
  const everything = config.approvalMode === ("every_action" as ApprovalMode);

  // A desktop session can see the real screen and operate the real mouse and
  // keyboard. It is always an explicit, high-risk approval, independent of the
  // per-action policy selected for the rest of the run.
  if (action.action === "desktop_control") {
    return {
      sensitive: true,
      risk: "high",
      explanation: "Controls the actual desktop, mouse, and keyboard for this run",
    };
  }

  // Leaving the configured allowlist is always sensitive (high).
  if (action.action === "navigate" && action.targetUrl) {
    const host = hostOf(action.targetUrl);
    if (host && !hostAllowed(host, config.allowedDomains)) {
      return { sensitive: true, risk: "high", explanation: "Navigation leaves the allowed-domain list" };
    }
  }

  if (action.isEval) {
    return { sensitive: true, risk: "high", explanation: "Executes arbitrary page JavaScript" };
  }
  if (action.submitIntent || action.action === "submit") {
    // MVP: ALL form submissions require approval (deterministic).
    return { sensitive: true, risk: "high", explanation: "Submits a form" };
  }
  if (action.isUpload || action.action === "upload") {
    return { sensitive: true, risk: "high", explanation: "Uploads a local file" };
  }
  if (action.isDownload || action.action === "download") {
    return { sensitive: true, risk: "high", explanation: "Downloads a file" };
  }
  if (action.readsClipboard) {
    return { sensitive: true, risk: "medium", explanation: "Reads clipboard contents" };
  }

  if (everything) {
    return { sensitive: true, risk: "low", explanation: `Action requires approval (${action.action})` };
  }
  return { sensitive: false, risk: "low", explanation: "" };
}

// --------------------------------------------------------------------------
// Approval registry — single-use, expiring, replay-safe.
// --------------------------------------------------------------------------

export type ApprovalErrorCode = "not_found" | "expired" | "already_decided" | "run_mismatch";

export class ApprovalError extends Error {
  code: ApprovalErrorCode;
  constructor(code: ApprovalErrorCode) {
    super(code);
    this.name = "ApprovalError";
    this.code = code;
  }
}

interface ApprovalRecord {
  request: ApprovalRequest;
  decision: "pending" | "approved" | "rejected";
  decidedByUserId?: number;
  decidedAt?: string;
  /** Resolver wired to the paused onBeforeToolCall promise. */
  resolve?: (decision: "approved" | "rejected") => void;
}

export const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;

export class ApprovalRegistry {
  private records = new Map<string, ApprovalRecord>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Create a single-use approval request bound to one exact action. */
  create(params: {
    runId: string;
    action: ApprovalActionType;
    target: string;
    explanation: string;
    risk: RiskLevel;
    screenshotBefore?: string;
    ttlMs?: number;
    resolve?: (decision: "approved" | "rejected") => void;
  }): ApprovalRequest {
    const nowMs = this.now();
    const ttl = params.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
    const request: ApprovalRequest = {
      actionId: crypto.randomUUID(),
      runId: params.runId,
      action: params.action,
      target: params.target,
      explanation: params.explanation,
      risk: params.risk,
      ...(params.screenshotBefore ? { screenshotBefore: params.screenshotBefore } : {}),
      requestedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + ttl).toISOString(),
    };
    this.records.set(request.actionId, {
      request,
      decision: "pending",
      ...(params.resolve ? { resolve: params.resolve } : {}),
    });
    return request;
  }

  get(actionId: string): ApprovalRequest | undefined {
    return this.records.get(actionId)?.request;
  }

  isExpired(actionId: string): boolean {
    const rec = this.records.get(actionId);
    if (!rec) return false;
    return this.now() > Date.parse(rec.request.expiresAt);
  }

  /**
   * Decide an approval. Enforces: existence, run ownership, not-expired,
   * single-use (replay rejection). Returns the decision on success.
   */
  decide(
    actionId: string,
    decision: "approved" | "rejected",
    opts: { runId?: string; userId?: number } = {},
  ): "approved" | "rejected" {
    const rec = this.records.get(actionId);
    if (!rec) throw new ApprovalError("not_found");
    if (opts.runId !== undefined && rec.request.runId !== opts.runId) {
      throw new ApprovalError("run_mismatch");
    }
    if (rec.decision !== "pending") throw new ApprovalError("already_decided");
    if (this.now() > Date.parse(rec.request.expiresAt)) {
      // Mark it terminal so it cannot be retried.
      rec.decision = "rejected";
      rec.decidedAt = new Date(this.now()).toISOString();
      rec.resolve?.("rejected");
      throw new ApprovalError("expired");
    }
    rec.decision = decision;
    rec.decidedAt = new Date(this.now()).toISOString();
    if (opts.userId !== undefined) rec.decidedByUserId = opts.userId;
    rec.resolve?.(decision);
    return decision;
  }

  /** Invalidate (reject) all pending approvals for a run — e.g. on abort. */
  invalidateRun(runId: string): void {
    for (const rec of this.records.values()) {
      if (rec.request.runId === runId && rec.decision === "pending") {
        rec.decision = "rejected";
        rec.decidedAt = new Date(this.now()).toISOString();
        rec.resolve?.("rejected");
      }
    }
  }

  pendingForRun(runId: string): ApprovalRequest[] {
    return [...this.records.values()]
      .filter((r) => r.request.runId === runId && r.decision === "pending")
      .map((r) => r.request);
  }
}
