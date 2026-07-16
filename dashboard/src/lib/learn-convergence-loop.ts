/**
 * Convergence coordinator (Parts 9-11, 19).
 *
 * The authoritative repair coordinator for a Learn run. Each round runs the
 * required deterministic-first order: structural freeze → projection reset (when
 * structure changed) → semantic reconciliation → deterministic typed repairs →
 * targeted verified ChatMock repairs → rebuild + revalidate. It enforces
 * monotonic progress (a round must reduce blockers or change the state
 * fingerprint toward resolution) and never lets a resolved blocker be silently
 * reintroduced.
 *
 * The heavy semantic engines and the ChatMock repair models are INJECTED so the
 * coordinator is deterministic and unit-testable, and so the same loop wraps the
 * real pipeline in production. `finalizeGardenExport` remains the final
 * serialization gate — it is no longer where mixed-generation structure is first
 * discovered.
 */

import type { LearningUnitContract } from "./learning-unit-contract.ts";
import type { LearnBuildWorkspace } from "./learn-build-workspace.ts";
import { readActiveBuildManifest } from "./learn-build-manifest.ts";
import {
  reconcileActiveLearnStructure,
  type LearnStructureReconciliationResult,
} from "./learn-structure-reconciliation.ts";
import {
  resetDisposableLearnProjections,
  isRecoverableLearnIssue,
} from "./learn-projection-reset.ts";

// ---------------------------------------------------------------------------
// Finalization mode flag (Part 11)
// ---------------------------------------------------------------------------

export type LearnFinalizationMode = "legacy" | "convergent";

/** The finalization mode. Defaults to `legacy` (the current, integration-tested
 * pipeline). `convergent` opts into the isolated-workspace convergence flow and
 * becomes the default only after the fresh integration tests pass. */
export function learnFinalizationMode(): LearnFinalizationMode {
  return String(process.env.LEARN_FINALIZATION_MODE ?? "").trim().toLowerCase() === "convergent"
    ? "convergent"
    : "legacy";
}

// ---------------------------------------------------------------------------
// Issue / operation model
// ---------------------------------------------------------------------------

export interface GardenIssue {
  issueId: string;
  type: string;
  severity: "blocking" | "warning";
  reason: string;
}

export interface GardenBuildOperation {
  operationId: string;
  kind: "deterministic" | "verified_model";
  targetIssueId: string;
  description: string;
}

export interface IssueRecurrenceRecord {
  issueId: string;
  firstSeenRound: number;
  lastSeenRound: number;
  occurrenceCount: number;
  resolvedRound?: number;
  reintroducedByOperationId?: string;
}

// ---------------------------------------------------------------------------
// Options / result types (Part 9)
// ---------------------------------------------------------------------------

export interface LearnConvergenceOptions {
  maxRounds: number;
  maxDeterministicOperationsPerRound: number;
  maxChatMockCallsPerRound: number;
  maxTotalChatMockCalls: number;
  enableChatMockRepairs: boolean;
  strictMode: boolean;
}

export const DEFAULT_CONVERGENCE_OPTIONS: LearnConvergenceOptions = {
  maxRounds: 5,
  maxDeterministicOperationsPerRound: 100,
  maxChatMockCallsPerRound: 3,
  maxTotalChatMockCalls: 10,
  enableChatMockRepairs: true,
  strictMode: false,
};

export interface LearnConvergenceRound {
  round: number;
  fingerprintBefore: string;
  fingerprintAfter: string;
  structuralIssuesBefore: GardenIssue[];
  semanticIssuesBefore: GardenIssue[];
  deterministicOperations: GardenBuildOperation[];
  modelPackets: unknown[];
  modelDecisionsReceived: number;
  modelDecisionsVerified: number;
  modelDecisionsRejected: number;
  changedFiles: string[];
  blockerCountBefore: number;
  blockerCountAfter: number;
  rolledBackOperations: string[];
}

export interface LearnConvergenceResult {
  passed: boolean;
  rounds: LearnConvergenceRound[];
  initialBlockerCount: number;
  finalBlockerCount: number;
  deterministicRepairs: number;
  verifiedChatMockRepairs: number;
  rejectedChatMockRepairs: number;
  unresolvedIssues: GardenIssue[];
  acceptedSnapshotCreated: boolean;
  projectionValidationPassed: boolean;
  issueRecurrence: IssueRecurrenceRecord[];
  stoppedReason:
    | "accepted"
    | "no_progress"
    | "chatmock_unavailable"
    | "budget_exhausted"
    | "non_repairable_issue"
    | "projection_failure"
    | "io_failure";
}

/**
 * The injectable pipeline hooks. Splitting structural (owned by this module) from
 * semantic (owned by the existing engines) lets the loop stay deterministic and
 * testable while wrapping the real engines in production.
 */
export interface ConvergenceEngines {
  /** Run the semantic reconciliation engines for one round; returns the current
   * garden issues and the files it changed. Deterministic-only when
   * `enableChatMock` is false. */
  runSemanticPass: (input: {
    round: number;
    enableChatMock: boolean;
    chatMockBudget: number;
  }) => Promise<{
    issues: GardenIssue[];
    deterministicOperations: GardenBuildOperation[];
    modelPackets: unknown[];
    modelDecisionsReceived: number;
    modelDecisionsVerified: number;
    modelDecisionsRejected: number;
    changedFiles: string[];
    chatMockUnavailable?: boolean;
  }>;
  /** Regenerate a unit's missing/foreign page. Returns the changed files. */
  regenerateUnitPages?: (unitIds: string[]) => Promise<string[]>;
  /** A stable fingerprint of the current semantic garden state. */
  stateFingerprint: () => string;
  /** Create the accepted snapshot once blockers are zero. */
  createAcceptedSnapshot?: () => Promise<boolean>;
  /** Validate the rendered staging projection. */
  validateProjection?: () => Promise<boolean>;
}

function toGardenIssue(structural: LearnStructureReconciliationResult["issuesBefore"][number]): GardenIssue {
  return {
    issueId: structural.issueId,
    type: structural.type,
    severity: structural.severity,
    reason: structural.reason,
  };
}

/**
 * Run the convergence loop over an isolated workspace.
 */
export async function runLearnConvergenceLoop(
  workspace: LearnBuildWorkspace,
  contract: LearningUnitContract[],
  engines: ConvergenceEngines,
  options: Partial<LearnConvergenceOptions> = {},
): Promise<LearnConvergenceResult> {
  const opts = { ...DEFAULT_CONVERGENCE_OPTIONS, ...options };
  const gardenDir = workspace.stagingGardenDir;
  const rounds: LearnConvergenceRound[] = [];
  const recurrence = new Map<string, IssueRecurrenceRecord>();
  let totalChatMock = 0;
  let deterministicRepairs = 0;
  let verifiedChatMockRepairs = 0;
  let rejectedChatMockRepairs = 0;
  let initialBlockerCount = -1;
  let stoppedReason: LearnConvergenceResult["stoppedReason"] = "no_progress";
  let previousBlockerCount = Number.POSITIVE_INFINITY;
  let previousFingerprint = "";
  let unresolvedIssues: GardenIssue[] = [];
  let acceptedSnapshotCreated = false;
  let projectionValidationPassed = false;

  for (let round = 1; round <= opts.maxRounds; round += 1) {
    const manifest = readActiveBuildManifest(gardenDir);
    if (!manifest) {
      stoppedReason = "io_failure";
      break;
    }
    const fingerprintBefore = engines.stateFingerprint();

    // 1-5. Structural freeze BEFORE any semantic work; reset projections if the
    //      structure changed so nothing merges with prior-build output.
    const structural = reconcileActiveLearnStructure(gardenDir, contract, manifest);
    const structuralIssues = structural.issuesBefore.map(toGardenIssue);
    const changedFiles: string[] = [
      ...structural.pagesRemoved,
      ...structural.pagesQuarantined,
      ...structural.staleSectionsRemoved,
    ];
    let regenerated: string[] = [];
    if (structural.pagesRegenerated.length > 0 && engines.regenerateUnitPages) {
      regenerated = await engines.regenerateUnitPages(structural.pagesRegenerated);
      changedFiles.push(...regenerated);
    }
    if (structural.changed || regenerated.length > 0) {
      const reset = resetDisposableLearnProjections(gardenDir, manifest);
      changedFiles.push(...reset.removed);
    }

    // 6-15. Semantic reconciliation (deterministic first; ChatMock only when
    //        enabled and budget remains).
    const chatMockBudget = Math.max(0, Math.min(opts.maxChatMockCallsPerRound, opts.maxTotalChatMockCalls - totalChatMock));
    const enableChatMock = opts.enableChatMockRepairs && chatMockBudget > 0;
    const semantic = await engines.runSemanticPass({ round, enableChatMock, chatMockBudget });
    totalChatMock += semantic.modelDecisionsReceived;
    deterministicRepairs += semantic.deterministicOperations.length;
    verifiedChatMockRepairs += semantic.modelDecisionsVerified;
    rejectedChatMockRepairs += semantic.modelDecisionsRejected;
    changedFiles.push(...semantic.changedFiles);

    const allIssues = [...structuralIssues, ...semantic.issues];
    const blockers = allIssues.filter((issue) => issue.severity === "blocking");
    const blockerCountBefore = round === 1
      ? blockers.length + structural.pagesRegenerated.length
      : previousBlockerCount;
    if (initialBlockerCount < 0) initialBlockerCount = blockers.length;

    // Track recurrence / monotonic progress (Part 19).
    trackRecurrence(recurrence, blockers, round);
    const fingerprintAfter = engines.stateFingerprint();

    rounds.push({
      round,
      fingerprintBefore,
      fingerprintAfter,
      structuralIssuesBefore: structuralIssues,
      semanticIssuesBefore: semantic.issues,
      deterministicOperations: semantic.deterministicOperations,
      modelPackets: semantic.modelPackets,
      modelDecisionsReceived: semantic.modelDecisionsReceived,
      modelDecisionsVerified: semantic.modelDecisionsVerified,
      modelDecisionsRejected: semantic.modelDecisionsRejected,
      changedFiles: [...new Set(changedFiles)],
      blockerCountBefore,
      blockerCountAfter: blockers.length,
      rolledBackOperations: [],
    });
    unresolvedIssues = blockers;

    // Stop conditions.
    if (blockers.length === 0) {
      acceptedSnapshotCreated = engines.createAcceptedSnapshot ? await engines.createAcceptedSnapshot() : true;
      projectionValidationPassed = engines.validateProjection ? await engines.validateProjection() : true;
      stoppedReason = acceptedSnapshotCreated && projectionValidationPassed ? "accepted" : "projection_failure";
      break;
    }
    if (semantic.chatMockUnavailable && blockers.some((issue) => !isDeterministic(issue))) {
      stoppedReason = "chatmock_unavailable";
      break;
    }
    if (blockers.some((issue) => !isRecoverableLearnIssue(issue))) {
      stoppedReason = "non_repairable_issue";
      break;
    }
    // Monotonic progress: blockers must fall OR the fingerprint must change
    // toward resolution. Otherwise stop as no-progress (avoids churn).
    const madeProgress = blockers.length < previousBlockerCount || fingerprintAfter !== previousFingerprint;
    if (!madeProgress) {
      stoppedReason = "no_progress";
      break;
    }
    if (totalChatMock >= opts.maxTotalChatMockCalls && blockers.some((issue) => !isDeterministic(issue))) {
      stoppedReason = "budget_exhausted";
      break;
    }
    previousBlockerCount = blockers.length;
    previousFingerprint = fingerprintAfter;
  }

  return {
    passed: stoppedReason === "accepted",
    rounds,
    initialBlockerCount: Math.max(0, initialBlockerCount),
    finalBlockerCount: unresolvedIssues.length,
    deterministicRepairs,
    verifiedChatMockRepairs,
    rejectedChatMockRepairs,
    unresolvedIssues,
    acceptedSnapshotCreated,
    projectionValidationPassed,
    issueRecurrence: [...recurrence.values()],
    stoppedReason,
  };
}

const DETERMINISTIC_ISSUE_TYPES = new Set([
  "foreign_build_page",
  "unknown_learning_unit",
  "duplicate_unit_page",
  "missing_unit_page",
  "manifest_path_mismatch",
  "unexpected_section",
  "stale_section_index",
  "stale_generated_visual",
  "stale_generated_registry",
  "stale_claim_mapping",
  "tag_projection_drift",
  "duplicate_visual_projection",
  "stale_source_coverage",
]);

function isDeterministic(issue: GardenIssue): boolean {
  return DETERMINISTIC_ISSUE_TYPES.has(issue.type);
}

function trackRecurrence(
  recurrence: Map<string, IssueRecurrenceRecord>,
  blockers: GardenIssue[],
  round: number,
): void {
  const active = new Set(blockers.map((issue) => issue.issueId));
  for (const issue of blockers) {
    const record = recurrence.get(issue.issueId);
    if (record) {
      record.lastSeenRound = round;
      record.occurrenceCount += 1;
      if (record.resolvedRound !== undefined) {
        // Reintroduced after being resolved — a churn signal (Part 19).
        record.reintroducedByOperationId = `round-${round}`;
        record.resolvedRound = undefined;
      }
    } else {
      recurrence.set(issue.issueId, {
        issueId: issue.issueId,
        firstSeenRound: round,
        lastSeenRound: round,
        occurrenceCount: 1,
      });
    }
  }
  // Mark issues resolved this round.
  for (const record of recurrence.values()) {
    if (!active.has(record.issueId) && record.resolvedRound === undefined) {
      record.resolvedRound = round;
    }
  }
}
