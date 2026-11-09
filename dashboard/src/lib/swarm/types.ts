// Conversation-owned coordination. Runtime V2 remains the authority for jobs;
// these records describe assignments and refer to those jobs, never own PIDs.
import type { CapabilitySurface } from "../hermes/capability-combinations.ts";
import type { UnifiedWorkflowSelection } from "../workflows/unified-command.ts";
import type { CapabilityDecision } from "../hermes/capability-policy.ts";

export type SwarmMode = "parallel" | "durable";
export type SwarmStatus = "running" | "paused" | "budget_limited" | "awaiting_input" | "verifying" | "completed" | "cancelling" | "cancelled" | "failed";
export type SwarmTaskStatus = "queued" | "awaiting_approval" | "blocked" | "starting" | "running" | "verifying" | "completed" | "failed" | "uncertain" | "cancelling" | "cancelled";
export type SwarmExecutor =
  | { kind: "runtime"; id: string }
  | { kind: "persona"; id: string }
  | { kind: "native"; id: string }
  | { kind: "workflow"; id: string }
  | { kind: "chat"; id: string };

export interface SwarmInputReference {
  kind: "attachment" | "artifact" | "garden_source" | "repository";
  id: string;
  revision?: string;
}

export interface SwarmTaskSpec {
  key: string;
  title: string;
  brief: string;
  executor: SwarmExecutor;
  dependsOn: string[];
  acceptance: string[];
  inputs: SwarmInputReference[];
  /** A review is a distinct assignment and must follow the work it reviews. */
  verifies?: string;
  tokenBudget: number;
}

export interface SwarmPlan {
  objective: string;
  reason: string;
  benefit: "coverage" | "independent_verification" | "parallel_deliverables";
  mode: SwarmMode;
  tasks: SwarmTaskSpec[];
}

export interface SwarmLimits {
  maxTasks: number;
  maxParallel: number;
  maxWorkerSlots: number;
  maxAttemptsPerTask: number;
  maxTokens: number;
  maxDurationMs: number;
}

/** Sealed by the authenticated turn, never taken from tool arguments. */
export interface SwarmAuthority {
  userId: number;
  conversationId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  sourceRunId: string;
  originClientMessageId: string;
  surface: CapabilitySurface;
  gardenId: number | null;
  gardenSlug: string | null;
  model: string;
  reasoningEffort: string;
  standingApproval: boolean;
  allowedTools: string[];
  allowedAgentIds: string[];
  workflowSelection?: UnifiedWorkflowSelection;
  /** Only server-resolved references from the originating conversation. */
  inputReferences: SwarmInputReference[];
  capability?: CapabilityDecision;
  goalId?: string;
}

export interface PreparedSwarmTask extends SwarmTaskSpec {
  requiresApproval: boolean;
  workerSlots: number;
  /** Server-derived exclusive resources, in addition to Runtime admission. */
  resources: string[];
}

export interface SwarmRun {
  id: string;
  authority: SwarmAuthority;
  requestId: string;
  objective: string;
  reason: string;
  benefit: SwarmPlan["benefit"];
  mode: SwarmMode;
  status: SwarmStatus;
  limits: SwarmLimits;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deadlineAt: number;
  chargedTokens: number;
  reservedTokens: number;
}

export interface SwarmTask extends PreparedSwarmTask {
  runId: string;
  status: SwarmTaskStatus;
  attemptCount: number;
  activeAttemptId: string | null;
  summary: string;
  error: string | null;
}

/** An opaque handle interpreted only by the registered executor adapter. */
export interface SwarmHandle {
  kind: SwarmExecutor["kind"];
  id: string;
  runId: string;
  conversationId?: number;
}

export interface SwarmAttempt {
  id: string;
  runId: string;
  taskKey: string;
  number: number;
  requestId: string;
  status: "starting" | "running" | "verifying" | "completed" | "failed" | "uncertain" | "cancelling" | "cancelled";
  handle: SwarmHandle | null;
  reservedTokens: number;
  chargedTokens: number;
  reportedTokens: number;
  usageComplete: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface SwarmEvidence {
  id: string;
  runId: string;
  taskKey: string;
  attemptId: string;
  title: string;
  summary: string;
  kind: "observation" | "inference" | "dispute" | "artifact" | "validation";
  /** A source URL, artifact/version identity, or a saved tool/result receipt. */
  reference: string;
  createdAt: number;
}

export type SwarmEvidenceInput = Pick<SwarmEvidence, "title" | "summary" | "kind" | "reference">;
export interface SwarmVerification {
  criterion: string;
  passed: boolean;
  evidenceIds: string[];
}

export interface SwarmLease { runId: string; owner: string; fence: number }
export interface SwarmEvent { sequence: number; runId: string; type: string; taskKey: string | null; detail: Record<string, unknown>; at: number }
export interface SwarmSnapshot { run: SwarmRun; tasks: SwarmTask[]; attempts: SwarmAttempt[]; evidence: SwarmEvidence[]; events: SwarmEvent[] }

export class SwarmError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SwarmError";
    this.code = code;
    this.status = status;
  }
}
