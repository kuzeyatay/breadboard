// Surface-independent core of the shared OpenHarness dispatch pipeline.
//
// `dispatch.ts` owns the I/O (gateway calls, SSE, persistence). Everything that
// can be decided without I/O lives here so it is directly testable: turn
// preparation (plan -> broker -> decision), fallback policy, and completion
// reporting.
//
// The legacy pipeline was duplicated three times — the terminal messages route,
// `garden-chat-adapter.ts`, and the Quartz route each re-derived their own
// capability decision, system prompt, and event handling. That is why the three
// surfaces drifted apart in capability. There is now one preparation path.

import type { OpenHarnessSurface, OpenHarnessMode } from "./config.ts";
import type { ApprovedFilesystemRoot } from "./filesystem-paths.ts";
import { planTask, type TaskCapability, type TaskPlan } from "./task-plan.ts";
import {
  brokerCapabilities,
  type CapabilityGrant,
  type PendingPermission,
} from "./capability-broker.ts";
import type { CapabilityDecision } from "./capability-policy.ts";

export interface PrepareTurnInput {
  request: string;
  priorRequests?: string[];
  surface: OpenHarnessSurface;
  userId: number | null;
  grants: readonly ApprovedFilesystemRoot[];
  workspaceRoot: string;
  isolated?: boolean;
  confirmedPermissionIds?: readonly string[];
}

export interface PreparedTurn {
  plan: TaskPlan;
  grant: CapabilityGrant;
  /** Compatibility view for the gateway and the runtime store. */
  decision: CapabilityDecision;
  /** True when the turn must pause for the user before any step can run. */
  blocked: boolean;
  pendingPermissions: PendingPermission[];
}

/**
 * Plan the turn and broker its capabilities. No I/O: callers supply the user's
 * grants and workspace, and receive everything needed to configure the runtime.
 */
export function prepareTurn(input: PrepareTurnInput): PreparedTurn {
  const isolated = input.isolated === true || input.userId === null;
  const plan = planTask({
    request: input.request,
    priorRequests: input.priorRequests,
    authenticated: input.userId !== null,
    isolated,
  });
  const grant = brokerCapabilities({
    plan,
    surface: input.surface,
    userId: input.userId,
    grants: input.grants,
    workspaceRoot: input.workspaceRoot,
    isolated,
    confirmedPermissionIds: input.confirmedPermissionIds,
  });
  return {
    plan,
    grant,
    decision: decisionForGrant(grant, input.workspaceRoot),
    blocked: !grant.executable,
    pendingPermissions: grant.pendingPermissions,
  };
}

/**
 * Project a brokered grant onto the legacy `CapabilityDecision` shape, which the
 * gateway's permission application and the audit store still consume. The
 * projection is lossy by design: authority lives in the grant.
 */
export function decisionForGrant(
  grant: CapabilityGrant,
  workspaceRoot: string,
  now = new Date(),
): CapabilityDecision {
  const capabilities = new Set(grant.grantedCapabilities);
  // The legacy enum has only three values, so a mutating non-coding turn (an
  // organize/convert/transcribe task) has to land somewhere. It maps to
  // `scoped_implementation` because that is the legacy mode meaning "this turn
  // may mutate", and downstream consumers gate mutation on it. Reporting such a
  // turn as `technical_read` understated it in audit records and could let a
  // mode-gated consumer treat a write turn as read-only. `implementationRequired`
  // remains the honest answer to "is this coding?".
  const mutates =
    capabilities.has("coding") ||
    capabilities.has("filesystem_write") ||
    capabilities.has("destructive_filesystem");
  const mode = mutates
    ? "scoped_implementation"
    : capabilities.has("filesystem_read") || capabilities.has("command_execution")
      ? "technical_read"
      : "knowledge";
  return {
    mode,
    requestedOutcome: grant.plan.userGoal,
    implementationRequired: grant.plan.requiresCoding,
    decisionReason: grant.plan.rationale,
    decisionSource: "breadboard_server_policy_v1",
    authorizedRoots: [
      workspaceRoot,
      ...grant.authorizedRoots.map((root) => root.canonicalPath),
    ],
    authorizedPathPatterns: grant.permissionRules
      .filter((rule) => rule.action === "allow" && rule.permission === "read")
      .map((rule) => rule.pattern),
    allowedTools: Object.entries(grant.allowedTools)
      .filter(([, enabled]) => enabled)
      .map(([tool]) => tool),
    allowedOperations: [],
    allowedCommandPatterns: grant.permissionRules
      .filter((rule) => rule.action === "allow" && rule.permission === "bash")
      .map((rule) => rule.pattern),
    selectedConditionalSkills: [],
    selectedConnections: [],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    revokedAt: null,
  };
}

/**
 * Intersect a selected tool map with the brokered one.
 *
 * A slash-selected skill or MCP connection can only switch tools OFF, never on:
 * a brokered `false` is final. A tool the broker does not know about (an MCP
 * server's own namespaced tool) may still be selected, because the broker's map
 * only governs the runtime tools it is responsible for.
 */
export function mergeSelectedTools(
  brokered: Record<string, boolean>,
  selected?: Record<string, boolean>,
): Record<string, boolean> {
  const policy = { ...brokered };
  if (!selected) return policy;
  for (const [tool, enabled] of Object.entries(selected)) {
    policy[tool] = Boolean(enabled) && policy[tool] !== false;
  }
  return policy;
}

/**
 * The deny-everything baseline a session returns to after a turn is revoked,
 * expires, or is aborted.
 *
 * These reset sites previously called the legacy classifier with the string
 * "Resume default knowledge work." and relied on it *happening* to classify
 * that as knowledge-only. That works, but it makes a security-critical reset
 * depend on classifier behaviour for an arbitrary sentence. This states the
 * baseline directly instead: no tools, no roots, no command patterns.
 */
export function leastPrivilegeDecision(
  workspaceRoot: string,
  now = new Date(),
): CapabilityDecision {
  return {
    mode: "knowledge",
    requestedOutcome: "Resume default knowledge work.",
    implementationRequired: false,
    decisionReason:
      "The previous capability grant ended, so the session returned to its least-privileged baseline.",
    decisionSource: "breadboard_server_policy_v1",
    authorizedRoots: [workspaceRoot],
    authorizedPathPatterns: [],
    allowedTools: [],
    allowedOperations: [],
    allowedCommandPatterns: [],
    selectedConditionalSkills: [],
    selectedConnections: [],
    createdAt: now.toISOString(),
    expiresAt: null,
    revokedAt: null,
  };
}

/* ------------------------------------------------------------------ */
/* Fallback policy                                                     */
/* ------------------------------------------------------------------ */

export type FallbackDecision =
  | { allowed: false; reason: string; stage: string }
  | { allowed: true; visible: true; unavailableCapabilities: TaskCapability[] };

/**
 * Decide whether a failed OpenHarness turn may fall back to the legacy
 * ChatMock pipeline.
 *
 * In `required` mode it never may: the caller must surface a structured error
 * naming the failing stage and preserve the request for retry. In `preferred`
 * mode fallback is allowed but must be visible and must declare which
 * capabilities the legacy path cannot provide.
 */
export function decideFallback(
  mode: OpenHarnessMode,
  stage: string,
  plan: TaskPlan | null,
): FallbackDecision {
  if (mode === "required") {
    return {
      allowed: false,
      reason:
        "OPENHARNESS_MODE=required: the runtime failed and legacy ChatMock must not silently answer in its place.",
      stage,
    };
  }
  // Legacy ChatMock is a text-completion pipeline: it has none of the action
  // capabilities, so any plan that needs one is degraded in fallback.
  const unavailable = (plan?.requiredCapabilities ?? []).filter(
    (capability) => capability !== "conversation",
  );
  return { allowed: true, visible: true, unavailableCapabilities: unavailable };
}

/* ------------------------------------------------------------------ */
/* Completion reporting                                                */
/* ------------------------------------------------------------------ */

export interface ActionOutcome {
  description: string;
  status: "completed" | "failed" | "skipped" | "pending_approval";
  /** Evidence that the action really happened (a verified postcondition). */
  verification?: string;
  irreversible?: boolean;
}

export interface CompletionReport {
  outcome: "completed" | "partial" | "blocked" | "failed";
  completed: ActionOutcome[];
  failed: ActionOutcome[];
  skipped: ActionOutcome[];
  pendingApprovals: ActionOutcome[];
  irreversibleChanges: string[];
  /** Set when the runtime failed and the task should be retried. */
  retryable?: { stage: string; request: string };
}

/**
 * Build an honest completion report.
 *
 * A model's claim that it did something is not evidence. Only actions carrying
 * a verification string are reported as completed; the rest are reported as
 * what they actually are.
 */
export function buildCompletionReport(
  actions: readonly ActionOutcome[],
  options: { retryable?: { stage: string; request: string } } = {},
): CompletionReport {
  const completed = actions.filter(
    (action) => action.status === "completed" && Boolean(action.verification),
  );
  // A "completed" action with no verification has not been shown to have
  // happened, so it is downgraded rather than reported as success.
  const unverified = actions
    .filter((action) => action.status === "completed" && !action.verification)
    .map((action) => ({
      ...action,
      status: "skipped" as const,
      description: `${action.description} (reported by the agent but not verified)`,
    }));
  const failed = actions.filter((action) => action.status === "failed");
  const skipped = [
    ...actions.filter((action) => action.status === "skipped"),
    ...unverified,
  ];
  const pendingApprovals = actions.filter((action) => action.status === "pending_approval");

  const outcome: CompletionReport["outcome"] = options.retryable
    ? "failed"
    : pendingApprovals.length > 0 && completed.length === 0
      ? "blocked"
      : failed.length > 0 || skipped.length > 0 || pendingApprovals.length > 0
        ? completed.length > 0
          ? "partial"
          : "failed"
        : "completed";

  return {
    outcome,
    completed,
    failed,
    skipped,
    pendingApprovals,
    irreversibleChanges: actions
      .filter((action) => action.irreversible && action.status === "completed")
      .map((action) => action.description),
    ...(options.retryable ? { retryable: options.retryable } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export interface TurnDiagnostics {
  userId: number | null;
  surface: OpenHarnessSurface;
  gardenId: string | null;
  runtimeSessionId: number | null;
  openHarnessSessionId: string | null;
  intendedOutcome: string;
  requiredCapabilities: TaskCapability[];
  grantedCapabilities: TaskCapability[];
  withheldCapabilities: TaskCapability[];
  enabledTools: string[];
  approvedRoots: string[];
  pendingPermissions: string[];
  eventStreamConnected: boolean;
  fallbackUsed: boolean;
  backend: "openharness" | "legacy_chatmock";
  riskLevel: TaskPlan["riskLevel"];
}

/**
 * Redact the account segment of a home directory so diagnostics never leak a
 * username. The path's own separator style is preserved so the redacted value
 * still reads as the platform path it came from.
 */
export function redactPath(value: string): string {
  return value
    .replace(
      /^([A-Za-z]:)([\\/])Users\2[^\\/]+/i,
      (_match, drive: string, separator: string) =>
        `${drive}${separator}Users${separator}<user>`,
    )
    .replace(/^\/(home|Users)\/[^/]+/i, "/$1/<user>");
}

export function buildDiagnostics(
  prepared: PreparedTurn,
  context: {
    userId: number | null;
    surface: OpenHarnessSurface;
    gardenId?: string | null;
    runtimeSessionId?: number | null;
    openHarnessSessionId?: string | null;
    eventStreamConnected?: boolean;
    fallbackUsed?: boolean;
  },
): TurnDiagnostics {
  return {
    userId: context.userId,
    surface: context.surface,
    gardenId: context.gardenId ?? null,
    runtimeSessionId: context.runtimeSessionId ?? null,
    openHarnessSessionId: context.openHarnessSessionId ?? null,
    intendedOutcome: prepared.plan.intendedOutcome,
    requiredCapabilities: prepared.plan.requiredCapabilities,
    grantedCapabilities: prepared.grant.grantedCapabilities,
    withheldCapabilities: prepared.grant.withheldCapabilities,
    enabledTools: Object.entries(prepared.grant.allowedTools)
      .filter(([, enabled]) => enabled)
      .map(([tool]) => tool),
    approvedRoots: prepared.grant.authorizedRoots.map((root) =>
      redactPath(root.canonicalPath),
    ),
    pendingPermissions: prepared.pendingPermissions.map((item) => item.id),
    eventStreamConnected: context.eventStreamConnected ?? false,
    fallbackUsed: context.fallbackUsed ?? false,
    backend: context.fallbackUsed ? "legacy_chatmock" : "openharness",
    riskLevel: prepared.plan.riskLevel,
  };
}
