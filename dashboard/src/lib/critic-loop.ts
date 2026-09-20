// Breadboard end-stage LLM critic loop.
//
// Deterministic validation + `FinalGardenState` catch structural drift and the
// semantic classes we can encode as rules. This module adds a *final* semantic
// auditor: a ChatMock (OpenAI-compatible) critic that reviews a compact packet
// built from the FINAL exported garden, returns structured JSON issues, and
// drives targeted repair rounds until no blocking issues remain or the repair
// budget is exhausted.
//
// It never fails garden generation. A garden is always a draft if it exists; it
// is only `publishReady` when deterministic validation AND the critic find no
// blocking issues. Zero runtime deps beyond fs/path so it runs under
// `node --experimental-strip-types`.

import { createHash } from "node:crypto";
import type { AcceptedCriticResidue, CriticPolicySnapshot } from "./learn-accepted-residues.ts";
import { LEARN_FOUNDATION_RULES, LEARN_FOUNDATION_REVIEW_RULES } from "./learn-pedagogy.ts";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  applyAnchorCriticDecision,
  auditCanonicalRegistryIntegrity,
  auditFinalGardenState,
  auditLegacyAnchorsFromFinalLedger,
  buildAnchorConfirmationPackets,
  buildAnchorEvidenceCriticIssues,
  buildFinalGardenState,
  reconcileFinalGardenState,
  repairCriticSourceAnchorExactText,
  repairCriticWorkedExampleMisclassification,
  sanitizeSourceAnchorIds,
  unresolvedLowConfidenceAnchorIds,
  verifySourceTextRelevance,
  verifySourceVisualRepresentation,
  type AnchorConfirmationPacket,
  type AnchorCriticDecision,
  type AppliedAnchorDecision,
  type CanonicalSourceAnchor,
  type FinalAuditResult,
  type FinalGardenState,
} from "./final-garden-state.ts";
import { finalizeGardenExport } from "./garden-finalize.ts";
import { declinedLessonMatches, parseJsonObjectResponse } from "./learn-utils.ts";
import { prepareUnitReanchor, type UnitReanchorCandidate } from "./learn-unit-reanchor.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CriticSeverity = "blocking" | "warning" | "cosmetic";

export type CriticIssueType =
  | "formula_anchor_mismatch"
  | "source_anchor_mismatch"
  | "source_coverage_contradiction"
  | "stale_caveat"
  | "section_index_template_prose"
  | "template_zettelkasten_handle"
  | "repeated_opening"
  | "explanation_gap"
  | "visual_grounding_mismatch"
  | "worked_example_misclassified"
  | "repair_provenance_error"
  | "debug_artifact_leak"
  | "other";

export type CriticRepairTarget =
  | "unit_page"
  | "section_index"
  | "learning_unit_contract"
  | "source_anchor_ledger"
  | "source_coverage"
  | "planning_doc"
  | "visual_spec"
  | "repair_log"
  | "global";

export interface CriticIssue {
  id: string;
  severity: CriticSeverity;
  type: CriticIssueType;
  pagePath?: string;
  sectionPath?: string;
  visualId?: string;
  sourceAnchorIds?: string[];
  problem: string;
  evidence: string;
  expected: string;
  repairTarget: CriticRepairTarget;
  suggestedRepair: string;
}

export interface ArtifactRepairRequest {
  id: string;
  issueIds: string[];
  targetKind: CriticRepairTarget;
  targetPath?: string;
  affectedUnitIds?: string[];
  affectedAnchorIds?: string[];
  formulaKindRepairs?: FormulaKindRepairRequest[];
  textAnchorExactTextRepairs?: TextAnchorExactTextRepairRequest[];
  instructions: string[];
  evidence: string[];
}

export interface FormulaKindRepairRequest {
  issueId: string;
  pagePath?: string;
  formulaIndex?: number;
  sourceAnchorIds?: string[];
  expectedKind: "worked_example";
  basedOnFormula?: string;
  evidence?: string;
}

export interface TextAnchorExactTextRepairRequest {
  issueId: string;
  anchorIds: string[];
  pagePath?: string;
  evidence?: string;
  problem?: string;
}

/** A formula sent to the critic — NEVER truncated (Fix 1). */
export interface CriticFormulaRecord {
  kind: "source_definition" | "source_derived_definition" | "worked_example" | "conceptual_helper";
  text: string;
  sourceAnchor?: string;
  basedOnFormula?: string;
  packetTruncated: false;
  fullLength: number;
}

/** Any other large field, with truncation made EXPLICIT (Fix 2). */
export interface CriticExcerpt {
  text: string;
  fullLength: number;
  packetTruncated: boolean;
  truncationReason?: "token_budget" | "excerpt_limit";
  sourcePath?: string;
  startOffset?: number;
  endOffset?: number;
}

/** Per-source-visual representation summary so the critic sees that a STATIC
 *  embed (not only a visual JSON) counts as represented (Fix 3). */
export interface CriticSourceVisualSummary {
  anchorId: string;
  title: string;
  assignedPages: string[];
  markdownEmbeds: Array<{ pagePath: string; assetPath: string }>;
  ledgerUsage?: { conceptUsage?: string; cropStatus?: string; assignedPageId?: string };
  interactiveVisualIds: string[];
  omissionReason?: string;
  represented: boolean;
  representationModes: string[];
}

export interface CriticReviewPacket {
  gardenTitle: string;
  /** Complete declared scope/background, so review respects the entry level. */
  scopeContract?: CriticExcerpt;
  orientationPages?: Array<{ path: string; bodyText: CriticExcerpt }>;
  sections: Array<{
    title: string;
    indexExcerpt: CriticExcerpt;
    indexBodyText?: CriticExcerpt;
    pages: Array<{
      path: string;
      title: string;
      learningUnitId: string;
      learningUnitContract?: FinalGardenState["learningUnitContract"]["units"][number];
      openingExcerpt: CriticExcerpt;
      frontmatterSummary: {
        sourceAnchors: string[];
        sourceFormulaAnchors: string[];
        formulas: CriticFormulaRecord[];
        tags: string[];
        visuals: string[];
      };
      bodyExcerpts: CriticExcerpt[];
      /** Complete final Markdown body. Claim fulfillment must never be judged
       * from a truncated opening excerpt. */
      bodyText: CriticExcerpt;
    }>;
  }>;
  sourceAnchors: Array<{
    id: string;
    kind: string;
    title: string;
    semanticSummary: string;
    exactText?: CriticExcerpt;
    formulaFamily?: string;
    confidence?: string;
  }>;
  visualSummaries: Array<{
    id: string;
    pagePath: string;
    title: string;
    type: string;
    sourceAnchors: string[];
    anchorRoles?: unknown[];
  }>;
  sourceCoverageSummary: CriticExcerpt;
  /** Fix 3: representation status of each source-visual anchor (static or interactive). */
  sourceVisualSummaries: CriticSourceVisualSummary[];
  deterministicValidationSummary: string;
  /** Global note reminding the critic that packetTruncated:true is an excerpt. */
  evidenceNote: string;
}

/** Result of independently verifying a critic issue against full state (Fix 3). */
export interface CriticIssueVerificationResult {
  issueId: string;
  verified: boolean;
  severity: "confirmed_blocking" | "confirmed_warning" | "unsupported" | "insufficient_evidence";
  checkedFiles: string[];
  fullStateEvidence?: string[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Critic issue INSTANCE identity (Fix 4/5/6)
//
// A critic issue is not a stable object across rounds. The same `issueId` can be
// re-emitted in a later round with *different evidence* (e.g. after a partial
// repair), and two different problems can happen to share an id. So finalization
// must NOT collapse verification state by `issueId` alone — an id that was
// `unsupported` once must not permanently suppress a genuinely-`confirmed_blocking`
// occurrence of that id later. We therefore model each per-round occurrence as a
// distinct INSTANCE (keyed partly by an evidence hash), group instances by a
// round-independent STABLE IDENTITY, and take the LATEST instance's verdict.
// ---------------------------------------------------------------------------

/** One verified occurrence of a critic issue in ONE round. Same `issueId` in two
 *  rounds with different evidence ⇒ two DISTINCT instances (different `evidenceHash`). */
export interface CriticIssueInstanceKey {
  issueId: string;
  round: number;
  issueType: CriticIssueType;
  targetPath?: string;
  targetAnchorId?: string;
  evidenceHash: string;
}

export interface VerifiedCriticIssueInstance {
  key: CriticIssueInstanceKey;
  issue: CriticIssue;
  verification: CriticIssueVerificationResult;
}

/** Round- and evidence-independent identity of "the same problem", used to
 *  collapse per-round instances and select the latest verdict. */
export interface CriticIssueStableIdentity {
  issueType: CriticIssueType;
  targetPath?: string;
  targetAnchorId?: string;
  normalizedProblemKey: string;
}

/** Result of collapsing instances to a final, per-identity verdict. */
export interface FinalCriticIssueResolution {
  blockers: CriticIssue[];
  warnings: CriticIssue[];
  unsupportedDiagnostics: VerifiedCriticIssueInstance[];
  insufficientEvidenceDiagnostics: VerifiedCriticIssueInstance[];
  resolvedIdentities: CriticIssueStableIdentity[];
  byIdentity: Array<{ identityKey: string; identity: CriticIssueStableIdentity; latest: VerifiedCriticIssueInstance }>;
}

function issueTargetPath(issue: CriticIssue): string | undefined {
  return issue.pagePath ?? issue.sectionPath ?? undefined;
}

function issueEvidenceHash(issue: CriticIssue): string {
  const basis = `${issue.evidence ?? ""}\0${issue.problem ?? ""}\0${issue.expected ?? ""}`;
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

function normalizedProblemKey(problem: string): string {
  return String(problem ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ").slice(0, 160);
}

function exactSourceFormulaProjectionKey(text: string | undefined): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function criticIssueStableIdentity(issue: CriticIssue): CriticIssueStableIdentity {
  return {
    issueType: issue.type,
    targetPath: issueTargetPath(issue),
    targetAnchorId: issue.sourceAnchorIds?.[0],
    normalizedProblemKey: normalizedProblemKey(issue.problem),
  };
}

export function criticIssueStableIdentityKey(id: CriticIssueStableIdentity): string {
  return [id.issueType, id.targetPath ?? "", id.targetAnchorId ?? "", id.normalizedProblemKey].join("");
}

function buildCriticIssueInstance(issue: CriticIssue, round: number, verification: CriticIssueVerificationResult): VerifiedCriticIssueInstance {
  return {
    key: {
      issueId: issue.id,
      round,
      issueType: issue.type,
      targetPath: issueTargetPath(issue),
      targetAnchorId: issue.sourceAnchorIds?.[0],
      evidenceHash: issueEvidenceHash(issue),
    },
    issue,
    verification,
  };
}

/**
 * Fix 4/5/6: collapse per-round instances to a final verdict per STABLE IDENTITY.
 * For each identity we take the LATEST (highest-round) instance and classify it:
 *   confirmed_blocking (still active) → blocker
 *   confirmed_warning  (still active) → warning
 *   unsupported                        → diagnostic (never blocks/warns)
 *   insufficient_evidence              → diagnostic (surfaced; does not block)
 *   not present in the final review    → resolved (neither)
 * There is NO global "ever-unsupported by issueId" set: an id whose latest
 * instance is confirmed_blocking IS a blocker even if an earlier instance of the
 * same id (different evidence) verified as unsupported.
 */
export function resolveFinalCriticIssues(
  instances: VerifiedCriticIssueInstance[],
  activeIssues: CriticIssue[],
  _strictPublish: boolean,
): FinalCriticIssueResolution {
  // Latest (highest-round) verified instance per stable identity. `>=` so that a
  // later occurrence of the same identity supersedes an earlier one.
  const latestByIdentity = new Map<string, VerifiedCriticIssueInstance>();
  for (const inst of instances) {
    const k = criticIssueStableIdentityKey(criticIssueStableIdentity(inst.issue));
    const cur = latestByIdentity.get(k);
    if (!cur || inst.key.round >= cur.key.round) latestByIdentity.set(k, inst);
  }
  const activeKeys = new Set(activeIssues.map((i) => criticIssueStableIdentityKey(criticIssueStableIdentity(i))));

  const blockers: CriticIssue[] = [];
  const warnings: CriticIssue[] = [];
  const byIdentity: FinalCriticIssueResolution["byIdentity"] = [];
  const seenActive = new Set<string>();

  // Drive final blocking/warning classification from the AUTHORITATIVE active set
  // (the last review's deduped issues, which reflect the final state). For each
  // active issue we consult its LATEST instance's verdict: if the latest verdict
  // is unsupported/insufficient-evidence, it is a false positive and is dropped;
  // otherwise the tier follows the issue's DECLARED severity (cosmetic ⇒ neither).
  for (const issue of activeIssues) {
    const k = criticIssueStableIdentityKey(criticIssueStableIdentity(issue));
    if (seenActive.has(k)) continue;
    seenActive.add(k);
    const latest = latestByIdentity.get(k);
    const sev = latest?.verification.severity;
    if (sev === "unsupported" || sev === "insufficient_evidence") continue; // latest verdict = not a real problem
    if (issue.severity === "blocking") blockers.push(issue);
    else if (issue.severity === "warning") warnings.push(issue);
    // cosmetic ⇒ neither
  }

  // Diagnostics (reporting only): latest-per-identity false positives and the
  // identities the critic stopped reporting (resolved).
  const unsupportedDiagnostics: VerifiedCriticIssueInstance[] = [];
  const insufficientEvidenceDiagnostics: VerifiedCriticIssueInstance[] = [];
  const resolvedIdentities: CriticIssueStableIdentity[] = [];
  for (const [k, latest] of latestByIdentity) {
    const identity = criticIssueStableIdentity(latest.issue);
    byIdentity.push({ identityKey: k, identity, latest });
    const sev = latest.verification.severity;
    if (sev === "unsupported") unsupportedDiagnostics.push(latest);
    else if (sev === "insufficient_evidence") insufficientEvidenceDiagnostics.push(latest);
    else if (!activeKeys.has(k)) resolvedIdentities.push(identity);
  }
  return { blockers, warnings, unsupportedDiagnostics, insufficientEvidenceDiagnostics, resolvedIdentities, byIdentity };
}

export interface CriticLoopOptions {
  enabled: boolean;
  maxRounds: number;
  maxIssuesPerRound: number;
  maxTotalRepairAttempts: number;
  criticModel: string;
  repairModel?: string;
  strictPublish: boolean;
  /** See readMeasurementReviewPolicy in learn-accepted-residues.ts. */
  measurementReviewNewFindings?: "block" | "warn";
}

export const DEFAULT_CRITIC_LOOP_OPTIONS: CriticLoopOptions = {
  enabled: true,
  // A repair can legitimately reveal a deeper semantic inconsistency on the
  // next whole-garden audit. Keep enough bounded rounds to repair a sequence
  // of newly exposed blockers; maxTotalRepairAttempts remains the hard request
  // budget and prevents an unconditional retry loop.
  maxRounds: 8,
  maxIssuesPerRound: 12,
  maxTotalRepairAttempts: 25,
  criticModel: "chatmock",
  repairModel: "chatmock",
  strictPublish: true,
};

export type CriticAvailabilityStatus = "available" | "unavailable" | "errored" | "disabled";

export type GardenLifecycleStatus =
  | "draft_generated"
  | "repairing"
  | "needs_review"
  | "publish_ready"
  | "publish_failed_structural";

export interface GardenAcceptanceStatus {
  draftGenerated: boolean;
  accepted: boolean;
  publishReady: boolean;
  lifecycleStatus: GardenLifecycleStatus;

  deterministicPass: boolean;
  criticRequired: boolean;
  criticAvailable: boolean;
  criticRan: boolean;
  criticPass: boolean;

  criticAvailabilityStatus: CriticAvailabilityStatus;
  criticUnavailableReason?: string;

  unresolvedBlockingIssues: CriticIssue[];
  warnings: CriticIssue[];
  repairRoundsUsed: number;
  reason?: string;
}

export type CriticIssueResolutionStatus =
  | "resolved"
  | "still_present"
  | "replaced_by_new_issue"
  | "unrepairable"
  | "not_attempted";

export interface CriticIssueResolution {
  issueId: string;
  originalIssue: CriticIssue;
  repairRequestId?: string;
  status: CriticIssueResolutionStatus;
  evidence?: string;
}

export interface RepairProvenanceRecord {
  requestId: string;
  targetKind: CriticRepairTarget;
  targetPath?: string;
  executorAttempted: Array<"model" | "deterministic">;
  executorUsed: "model" | "deterministic" | "none";
  modelFailureReason?: string;
  modelCandidateAttempts?: number;
  modelValidationFeedback?: string[];
  reanchor?: { attempted: boolean; applied: boolean; anchorIds?: string[]; problem?: string };
  changed: boolean;
}

export interface CriticRoundRecord {
  round: number;
  blockingIssues: number;
  warnings: number;
  repairsAttempted: number;
  repairsResolved: number;
  issueTypes: string[];
  resolutions: CriticIssueResolution[];
  provenance: RepairProvenanceRecord[];
  anchorDecisions?: AppliedAnchorDecision[];
  /** Fix 6: critic-issue verification accounting for this round. */
  reportedIssues?: number;
  verifiedBlockingIssues?: number;
  verifiedWarnings?: number;
  unsupportedIssues?: number;
  insufficientEvidenceIssues?: number;
  issueVerifications?: CriticIssueVerificationResult[];
  falsePositives?: Array<{ issue: CriticIssue; verification: CriticIssueVerificationResult }>;
}

/** Stable id prefix marking a deterministic low-confidence anchor issue, so it
 *  routes to the anchor-confirmation critic rather than the generic repair. */
export const ANCHOR_EVIDENCE_ISSUE_PREFIX = "anchor-evidence-";

/** Convert deterministic anchor-evidence issues into CriticIssues for the loop. */
export function anchorEvidenceCriticIssues(state: FinalGardenState): CriticIssue[] {
  return buildAnchorEvidenceCriticIssues(state).map((issue) => ({
    id: `${ANCHOR_EVIDENCE_ISSUE_PREFIX}${issue.sourceAnchorIds[0]}`,
    severity: "blocking" as CriticSeverity,
    type: "source_anchor_mismatch" as CriticIssueType,
    pagePath: issue.pagePath,
    sourceAnchorIds: issue.sourceAnchorIds,
    problem: issue.problem,
    evidence: issue.evidence,
    expected: "Confirm with exact source text, replace with a stronger anchor, or remove/repair the grounding.",
    repairTarget: "source_anchor_ledger" as CriticRepairTarget,
    suggestedRepair: issue.suggestedRepair,
  }));
}

export interface CriticLoopResult {
  status: GardenAcceptanceStatus;
  rounds: CriticRoundRecord[];
  finalBlockingIssues: CriticIssue[];
  finalWarnings: CriticIssue[];
  /** Fix 4/5/6: per-stable-identity latest-verdict resolution (diagnostics). */
  finalResolution?: FinalCriticIssueResolution;
  /** Fix 12/13/14: the single canonical acceptance decision all reports share. */
  finalDecision?: FinalAcceptanceDecision;
  /** Blocking findings a person accepted for this garden: still true, still
   * reported, no longer holding publication. Present only when non-empty. */
  acceptedResidues?: CriticIssue[];
  appliedAcceptancePolicy?: {
    snapshot?: CriticPolicySnapshot;
    effectiveMaxRounds: number;
    effectiveMeasurementReviewNewFindings: "block" | "warn";
    matches: Array<{ issue: CriticIssue; exceptions: AcceptedCriticResidue[] }>;
  };
  /** Blocking findings the final measurement review raised for the first time
   * on untouched pages, published as warnings under the "warn" policy. Present
   * only when non-empty. */
  demotedMeasurementFindings?: CriticIssue[];
}

/** The critic: reviews a packet, returns structured issues. ChatMock in prod. */
export type CriticFn = (packet: CriticReviewPacket) => Promise<CriticIssue[]> | CriticIssue[];

export interface CriticRepairOutcome {
  attempted: number;
  resolved: number;
  provenance?: RepairProvenanceRecord[];
}

/** Applies one round's repairs. The default (below) runs model-first for
 *  semantic targets then deterministic finalization; tests can inject their own. */
export type ArtifactRepairFn = (
  gardenDir: string,
  gardenSlug: string,
  requests: ArtifactRepairRequest[],
  ctx: { round: number; issuesById?: Map<string, CriticIssue> },
) => Promise<CriticRepairOutcome> | CriticRepairOutcome;

// Model repair (ChatMock) for semantic page/section rewrites.
export interface ModelRepairInput {
  repairStage?: "reanchor" | "page";
  issue: CriticIssue;
  repairRequest: ArtifactRepairRequest;
  finalGardenStateExcerpt: unknown;
  currentMarkdown?: string;
  learningUnitContract?: unknown;
  sourceAnchors?: unknown[];
  /** For a source_anchor_mismatch: other anchors in the same source whose text
   * matches the issue's topic, so the repair can re-anchor rather than only
   * rephrase. See reanchorCandidates. */
  reanchorCandidates?: CanonicalSourceAnchor[];
  previousPageSummary?: string;
  nextPageSummary?: string;
  /** A rejected candidate gets one bounded, fresh semantic retry carrying the
   * exact validation findings. Including the attempt in the request payload
   * also prevents durable Council receipt reuse from replaying the same invalid
   * answer. */
  candidateAttempt?: number;
  priorCandidateValidationFeedback?: string[];
  /** Set when `currentMarkdown` holds only the learning units this repair may
   * change, rather than the whole contract. The reply is then expected to be
   * those units alone; see mergePartialLearningUnitContract. */
  scopedLearningUnitIds?: string[];
}

export interface ModelRepairOutput {
  targetPath: string;
  revisedMarkdown?: string;
  revisedJson?: unknown;
  notes?: string[];
}

export type ModelRepairFn = (input: ModelRepairInput) => Promise<ModelRepairOutput | null> | ModelRepairOutput | null;

export interface ModelCandidateValidationResult {
  passed: boolean;
  problems?: string[];
}

export type ModelCandidateValidator = (
  gardenDir: string,
  gardenSlug: string,
) => boolean | ModelCandidateValidationResult;

// ---------------------------------------------------------------------------
// Review packet
// ---------------------------------------------------------------------------

function firstProseParagraphs(body: string, count: number): string[] {
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*\*\*(?:Question|Answer)\.?\*\*.*$/gim, " ");
  return prose
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 40)
    .slice(0, count);
}

/** Wrap a possibly-truncated string with explicit truncation metadata (Fix 2). */
function makeExcerpt(full: string, limit: number, opts: { sourcePath?: string; reason?: "token_budget" | "excerpt_limit" } = {}): CriticExcerpt {
  const text = String(full ?? "");
  const truncated = text.length > limit;
  return {
    text: truncated ? text.slice(0, limit) : text,
    fullLength: text.length,
    packetTruncated: truncated,
    ...(truncated ? { truncationReason: opts.reason ?? "excerpt_limit", startOffset: 0, endOffset: limit } : {}),
    ...(opts.sourcePath ? { sourcePath: opts.sourcePath } : {}),
  };
}

/** Build a representation summary per source-visual anchor (Fix 3). */
function buildSourceVisualSummaries(state: FinalGardenState): CriticSourceVisualSummary[] {
  let ledger: Array<Record<string, unknown>> = [];
  try { ledger = JSON.parse(fs.readFileSync(path.join(state.rootPath, ".breadboard", "source-visuals.json"), "utf-8")); } catch { ledger = []; }
  const anchorIds = new Set<string>();
  for (const page of state.pages) for (const id of page.sourceVisualIds) anchorIds.add(id);
  for (const [id, a] of Object.entries(state.sourceAnchors)) if (a.kind === "figure" || a.kind === "table" || a.kind === "graph") anchorIds.add(id);
  const summaries: CriticSourceVisualSummary[] = [];
  for (const anchorId of [...anchorIds].sort()) {
    const rep = verifySourceVisualRepresentation(anchorId, state);
    const anchor = state.sourceAnchors[anchorId];
    const entry = ledger.find((v) => String(v.sourceVisualId ?? v.anchorId ?? "") === anchorId);
    const markdownEmbeds: Array<{ pagePath: string; assetPath: string }> = [];
    for (const page of state.pages) {
      if (!page.sourceVisualIds.includes(anchorId)) continue;
      for (const m of page.body.matchAll(/!\[[^\]]*\]\(\s*<?([^)>\s]+)>?[^)]*\)/g)) {
        const url = m[1].toLowerCase();
        const num = (anchorId.match(/\.P(\d+)\./i) ?? [])[1];
        const code = (anchorId.match(/\.([A-Za-z]\d+)$/i) ?? [])[1]?.toLowerCase();
        if (url.includes(anchorId.toLowerCase()) || (num && url.includes(`page-${num}`) && (!code || url.includes(code)))) {
          markdownEmbeds.push({ pagePath: page.rel, assetPath: m[1] });
        }
      }
    }
    summaries.push({
      anchorId,
      title: anchor?.title ?? anchor?.caption ?? anchorId,
      assignedPages: rep.pagePaths,
      markdownEmbeds,
      ledgerUsage: entry ? { conceptUsage: String(entry.conceptUsage ?? ""), cropStatus: String(entry.cropStatus ?? ""), assignedPageId: String(entry.assignedPageId ?? "") } : undefined,
      interactiveVisualIds: rep.visualIds,
      omissionReason: rep.representationModes.includes("explicit_omission") ? (rep.evidence.find((e) => /omission/i.test(e)) ?? "justified omission") : undefined,
      represented: rep.represented,
      representationModes: rep.representationModes,
    });
  }
  return summaries;
}

const CRITIC_FORMULA_KINDS = new Set(["source_definition", "source_derived_definition", "worked_example", "conceptual_helper"]);

/** Full formula records for the critic — never truncated (Fix 1). */
function criticFormulaRecords(state: FinalGardenState, pageRel: string): CriticFormulaRecord[] {
  return state.formulas
    .filter((f) => f.pageRel === pageRel)
    .map((f) => {
      const declared = String(f.declaredKind ?? "");
      const kind = (CRITIC_FORMULA_KINDS.has(declared)
        ? declared
        : f.structuralKind === "worked_example"
          ? "worked_example"
          : f.structuralKind === "definition"
            ? "source_definition"
            : "conceptual_helper") as CriticFormulaRecord["kind"];
      return {
        kind,
        text: f.text, // full LaTeX, exact, never sliced
        sourceAnchor: f.sourceAnchor,
        basedOnFormula: f.basedOnFormula,
        packetTruncated: false as const,
        fullLength: f.text.length,
      };
    });
}

function summarizeAudit(audit: FinalAuditResult): string {
  if (audit.ok) return "deterministic FinalGardenState audit: PASS (no blocking issues).";
  const byRule = Object.entries(audit.byRule).map(([rule, ps]) => `${rule}: ${ps.length}`).join(", ");
  return `deterministic FinalGardenState audit: FAIL (${audit.problems.length} problems — ${byRule}).`;
}

/** Compact review packet built ONLY from the final exported state. */
export function buildCriticReviewPacket(state: FinalGardenState, deterministicValidationSummary?: string): CriticReviewPacket {
  const audit = auditFinalGardenState(state);
  const unitById = new Map(state.learningUnitContract.units.map((unit) => [unit.id, unit]));
  const pagesBySection = new Map<string, FinalGardenState["pages"]>();
  const sectionDir = (rel: string): string => rel.split("/").slice(0, 2).join("/");
  for (const page of state.pages) {
    const key = sectionDir(page.rel);
    (pagesBySection.get(key) ?? pagesBySection.set(key, []).get(key)!).push(page);
  }
  const sectionByDir = new Map(state.sections.map((s) => [s.rel.replace(/\/_index\.md$/i, ""), s]));

  // Preserve the model-authored curriculum order. Lexicographic path sorting
  // places a numbered chapter 10 between chapters 1 and 2, which makes an
  // otherwise-correct export look structurally out of order to the semantic
  // critic. Contract order is the durable authority even when section titles
  // are not numbered; natural path order is only a fallback for pages absent
  // from the contract.
  const unitOrder = new Map(
    state.learningUnitContract.units.map((unit, index) => [unit.id, index]),
  );
  const sectionContractOrder = (pages: FinalGardenState["pages"]): number => {
    let earliest = Number.MAX_SAFE_INTEGER;
    for (const page of pages) {
      const order = unitOrder.get(page.learningUnitId);
      if (order !== undefined && order < earliest) earliest = order;
    }
    return earliest;
  };

  const sections = [...pagesBySection.entries()]
    .sort((a, b) => {
      const contractDelta = sectionContractOrder(a[1]) - sectionContractOrder(b[1]);
      return contractDelta || a[0].localeCompare(b[0], undefined, { numeric: true });
    })
    .map(([dir, pages]) => {
      const section = sectionByDir.get(dir);
      const sortedPages = [...pages].sort((a, b) => a.subsectionNumber.localeCompare(b.subsectionNumber, undefined, { numeric: true }));
      const indexFull = (section?.body ?? "").replace(/```[\s\S]*?```/g, " ").replace(/^#.*$/gm, " ").replace(/\s+/g, " ").trim();
      return {
        title: section?.title ?? dir.split("/").pop() ?? dir,
        indexExcerpt: makeExcerpt(indexFull, 320, { sourcePath: section?.rel }),
        indexBodyText: makeExcerpt(section?.body ?? "", Math.max(1, section?.body.length ?? 0), { sourcePath: section?.rel }),
        pages: sortedPages.map((page) => ({
          path: page.rel,
          title: page.title,
          learningUnitId: page.learningUnitId,
          learningUnitContract: unitById.get(page.learningUnitId),
          openingExcerpt: makeExcerpt(firstProseParagraphs(page.body, 1).join(" "), 400, { sourcePath: page.rel }),
          frontmatterSummary: {
            sourceAnchors: page.sourceAnchors,
            sourceFormulaAnchors: page.sourceFormulaAnchors,
            formulas: criticFormulaRecords(state, page.rel),
            tags: page.tags,
            visuals: page.visualIds,
          },
          bodyExcerpts: firstProseParagraphs(page.body, 3).map((p) => makeExcerpt(p, 300, { sourcePath: page.rel })),
          bodyText: makeExcerpt(page.body, Math.max(1, page.body.length), { sourcePath: page.rel }),
        })),
      };
    });

  const sourceAnchors = Object.values(state.sourceAnchors).map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    semanticSummary: a.semanticSummary ?? a.title,
    exactText: a.exactText ? makeExcerpt(a.exactText, 240) : undefined,
    formulaFamily: a.formulaFamily,
    confidence: typeof a.confidence === "string" ? a.confidence : undefined,
  }));

  const visualSummaries = state.visuals.map((v) => ({
    id: v.id,
    pagePath: v.pageRel ?? "",
    title: v.type,
    type: v.type,
    sourceAnchors: [...v.anchorIds, ...v.textAnchorIds],
    anchorRoles: v.anchorRoles,
  }));

  return {
    gardenTitle: state.slug,
    scopeContract: state.planningDocs.scopeContract
      ? makeExcerpt(state.planningDocs.scopeContract, state.planningDocs.scopeContract.length, { sourcePath: ".breadboard/planning/Scope Contract.md" })
      : undefined,
    orientationPages: [
      ...(state.orientationPages ?? []),
      ...state.sections.filter((section) => !pagesBySection.has(section.rel.replace(/\/_index\.md$/i, ""))),
    ].map((page) => ({
      path: page.rel,
      bodyText: makeExcerpt(page.body, Math.max(1, page.body.length), { sourcePath: page.rel }),
    })),
    sections,
    sourceAnchors,
    visualSummaries,
    sourceCoverageSummary: makeExcerpt((state.planningDocs.sourceCoverage ?? "").replace(/^---[\s\S]*?---/, "").replace(/\s+/g, " ").trim(), 1200, { sourcePath: ".breadboard/planning/Source Coverage.md" }),
    sourceVisualSummaries: buildSourceVisualSummaries(state),
    deterministicValidationSummary: deterministicValidationSummary ?? summarizeAudit(audit),
    evidenceNote: "Formulas are complete (packetTruncated:false). Any field with packetTruncated:true is only an excerpt — do NOT infer that the underlying garden artifact is truncated or malformed from where an excerpt ends; inspect the full FinalGardenState value before issuing a truncation blocker. A source figure is REPRESENTED (see sourceVisualSummaries.represented) when its crop is embedded and explained (markdown_source_embed/source_visual_ledger) OR a grounded interactive visual exists — do not require an interactive visual for a static figure.",
  };
}

// ---------------------------------------------------------------------------
// Critic prompt + response parsing (ChatMock)
// ---------------------------------------------------------------------------

export const CRITIC_SYSTEM_PROMPT = `You are Breadboard's final semantic critic. You review the FINAL exported state of a generated learning garden and report only genuine semantic errors that deterministic validators cannot reliably judge.

EVIDENCE TRUTHFULNESS (read first):
- Formula records are COMPLETE (packetTruncated:false); their "text" is the full LaTeX. Never report a formula as truncated or malformed based on where a formula string appears to end.
- A field marked packetTruncated:true is only an EXCERPT. Do NOT infer that the underlying garden artifact is truncated or malformed from the excerpt ending. Request or inspect the full FinalGardenState value (via its sourcePath) before issuing any truncation/malformed blocker.
- A visual source is REPRESENTED if its source crop is embedded and explained in the page — an interactive visual is NOT required. Do not require an interactive visual when the static source figure itself is appropriate. Before reporting a missing/unrepresented figure, check sourceVisualSummaries: representationModes may be markdown_source_embed, source_visual_ledger, or interactive_visual — any of these means the figure IS represented. Check sourceVisualIds, Markdown image embeds, the source-visual ledger usage, and visual JSON; do not assume only .breadboard/visuals/*.json counts.

Deterministic validators already ran; do not re-report anything unless the final state truly contradicts itself or the source. Focus on MEANING, not field agreement:
- Fields agreeing on a WRONG value is still an error (a page and its contract both citing the wrong source formula anchor is wrong).
- A formula's math must match the metric family of the source formula anchor it claims (a surrogate-gradient or accuracy formula grounded to the normalized-energy-efficiency anchor is wrong).
- A numeric worked example labeled as a symbolic source definition is wrong.
- Source Coverage must match the final pages and visual JSON.
- Caveats claiming source material is unavailable when anchors/exact text exist are stale.
- Section index prose that reuses generic templates ("introduces the core idea", "so the pieces connect into one picture") is wrong.
- Zettelkasten handles that describe a tag's function instead of a durable claim are template-like.
- Two pages opening with the same paraphrased scenario is a repeated opening.
- A text anchor with no exact source text when the source clearly explains the concept is too generic.
- A visual grounded to anchors that do not match its title/purpose is mismatched.
- Debug repair files shipped in the export must be flagged.
- A learner page containing the generating model's own voice (first-person notes such as "I'm using the pasted contract..." or "I'll treat the pasted text as the request...") or chat transport syntax such as \`:::writing{...}\` / a closing \`:::\` is a BLOCKING debug_artifact_leak targeting unit_page, never a warning.
- Repair-log entries attributing a change to the wrong target are provenance errors.
- Every page must answer its model-authored learningQuestion and actually teach every knowledgeClaims[].text in its learningUnitContract, using the cited canonical source evidence. A claimId or tag in frontmatter is metadata, not proof that the prose fulfilled the claim. Compare against bodyText, which is complete and never truncated. Report an omitted or contradicted model-authored claim as a blocking "other" issue targeting unit_page, and include its evidence anchor ids.

${LEARN_FOUNDATION_RULES}
${LEARN_FOUNDATION_REVIEW_RULES}

Return ONLY a JSON object: {"issues": CriticIssue[]}. Each issue:
{
  "id": "kebab-unique",
  "severity": "blocking" | "warning" | "cosmetic",
  "type": one of formula_anchor_mismatch|source_anchor_mismatch|source_coverage_contradiction|stale_caveat|section_index_template_prose|template_zettelkasten_handle|repeated_opening|explanation_gap|visual_grounding_mismatch|worked_example_misclassified|repair_provenance_error|debug_artifact_leak|other,
  "pagePath"?, "sectionPath"?, "visualId"?, "sourceAnchorIds"?: string[],
  "problem": one sentence,
  "evidence": the exact text/field proving it,
  "expected": what a correct artifact would show,
  "repairTarget": unit_page|section_index|learning_unit_contract|source_anchor_ledger|source_coverage|planning_doc|visual_spec|repair_log|global,
  "suggestedRepair": one actionable instruction
}
Every fixable content issue must name exactly one concrete pagePath or sectionPath and its matching file-scoped repairTarget. Split a problem spanning multiple files into one issue per file; never aggregate file repairs under repairTarget "global".
Use "blocking" only for genuine semantic errors; "warning"/"cosmetic" for polish. If the garden is clean, return {"issues": []}. Output JSON only, no prose.`;

export function buildCriticUserPrompt(packet: CriticReviewPacket): string {
  return `Review this final garden. Report only genuine semantic errors as JSON {"issues":[...]}.\n\n${JSON.stringify(packet, null, 1)}`;
}

const VALID_TYPES = new Set<CriticIssueType>([
  "formula_anchor_mismatch", "source_anchor_mismatch", "source_coverage_contradiction", "stale_caveat",
  "section_index_template_prose", "template_zettelkasten_handle", "repeated_opening", "visual_grounding_mismatch",
  "explanation_gap",
  "worked_example_misclassified", "repair_provenance_error", "debug_artifact_leak", "other",
]);
const VALID_TARGETS = new Set<CriticRepairTarget>([
  "unit_page", "section_index", "learning_unit_contract", "source_anchor_ledger", "source_coverage",
  "planning_doc", "visual_spec", "repair_log", "global",
]);

/** Parse a critic model response into validated issues.
 *
 * This boundary is deliberately all-or-nothing. The critic is a publication
 * gate, so malformed output must surface as critic unavailability instead of
 * being indistinguishable from the one valid clean verdict: {"issues": []}.
 */
export function parseCriticIssues(text: string): CriticIssue[] {
  const stripped = String(text ?? "").trim();
  if (!stripped) {
    throw new Error("Critic response validation failed: response was empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (strictError) {
    // The ChatGPT web chat models open even this report with a sentence
    // ("I'm reading the pasted review packet as the request itself. ...");
    // on 2026-09-15 a complete 22-issue report failed the whole Learn run for
    // that alone. Only that leading prose is dropped: trailing prose, a
    // second object or no object at all still fail this gate.
    try {
      parsed = parseJsonObjectResponse(stripped);
    } catch {
      const error = strictError;
      throw new Error(
        `Critic response validation failed: invalid JSON (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('Critic response validation failed: top level must be an object with an "issues" array.');
  }
  const envelope = parsed as Record<string, unknown>;
  if (!Array.isArray(envelope.issues)) {
    throw new Error('Critic response validation failed: top-level "issues" must be an array.');
  }

  const requiredString = (record: Record<string, unknown>, key: string, index: number): string => {
    if (typeof record[key] !== "string" || !record[key].trim()) {
      throw new Error(`Critic response validation failed: issues[${index}].${key} must be a non-empty string.`);
    }
    return record[key].trim();
  };
  const optionalString = (record: Record<string, unknown>, key: string, index: number): string | undefined => {
    if (record[key] === undefined) return undefined;
    if (typeof record[key] !== "string" || !record[key].trim()) {
      throw new Error(`Critic response validation failed: issues[${index}].${key} must be a non-empty string when present.`);
    }
    return record[key].trim();
  };

  const issues: CriticIssue[] = [];
  const seenIds = new Set<string>();
  for (const [i, item] of envelope.issues.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Critic response validation failed: issues[${i}] must be an object.`);
    }
    const r = item as Record<string, unknown>;
    const id = requiredString(r, "id", i);
    if (seenIds.has(id)) {
      throw new Error(`Critic response validation failed: duplicate issue id "${id}".`);
    }
    seenIds.add(id);
    if (r.severity !== "blocking" && r.severity !== "warning" && r.severity !== "cosmetic") {
      throw new Error(`Critic response validation failed: issues[${i}].severity is invalid.`);
    }
    if (!VALID_TYPES.has(r.type as CriticIssueType)) {
      throw new Error(`Critic response validation failed: issues[${i}].type is invalid.`);
    }
    if (!VALID_TARGETS.has(r.repairTarget as CriticRepairTarget)) {
      throw new Error(`Critic response validation failed: issues[${i}].repairTarget is invalid.`);
    }

    let sourceAnchorIds: string[] | undefined;
    if (r.sourceAnchorIds !== undefined) {
      if (
        !Array.isArray(r.sourceAnchorIds) ||
        r.sourceAnchorIds.some((value) => typeof value !== "string" || !value.trim())
      ) {
        throw new Error(
          `Critic response validation failed: issues[${i}].sourceAnchorIds must contain only non-empty strings.`,
        );
      }
      sourceAnchorIds = r.sourceAnchorIds.map((value) => value.trim());
    }

    issues.push({
      id,
      severity: r.severity,
      type: r.type as CriticIssueType,
      pagePath: optionalString(r, "pagePath", i),
      sectionPath: optionalString(r, "sectionPath", i),
      visualId: optionalString(r, "visualId", i),
      sourceAnchorIds,
      problem: requiredString(r, "problem", i),
      evidence: requiredString(r, "evidence", i),
      expected: requiredString(r, "expected", i),
      repairTarget: r.repairTarget as CriticRepairTarget,
      suggestedRepair: requiredString(r, "suggestedRepair", i),
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Independent critic-issue verification against full FinalGardenState (Fix 3/4)
// ---------------------------------------------------------------------------

/** Is a LaTeX formula string syntactically complete (balanced, no cut command)? */
export function isFormulaSyntacticallyComplete(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  let depth = 0;
  for (const ch of t) {
    if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth < 0) return false; }
  }
  if (depth !== 0) return false;
  if ((t.match(/\\left\b/g) ?? []).length !== (t.match(/\\right\b/g) ?? []).length) return false;
  if (/\\$/.test(t)) return false;               // dangling backslash
  if (/(\.\.\.|…)\s*$/.test(t)) return false;     // visible ellipsis cut
  if (/\\[a-zA-Z]+\{[^}]*$/.test(t)) return false; // command with unclosed argument
  return true;
}

const TRUNCATION_RE = /truncat|cut off|cut short|cutoff|incomplete|malformed|ends? abruptly|missing (?:the )?(?:rest|end|closing)|appears? (?:cut|shortened)|not complete/i;

const DEFAULT_TEMPLATE_PHRASES = [
  "introduces the core idea", "so the pieces connect into one picture", "one step at a time",
  "connect into one picture", "brings the ideas together", "builds on the previous",
];

/**
 * Fix 3/4: independently verify a critic issue against the FULL FinalGardenState
 * before it can become a blocking repair request. Truncation/malformed claims are
 * checked against complete formula/body text; other listed types get targeted
 * deterministic checks. Types without a specific check are trusted (confirmed) so
 * the critic is not weakened.
 */
export function verifyCriticIssueAgainstFinalState(issue: CriticIssue, state: FinalGardenState): CriticIssueVerificationResult {
  const issueId = issue.id;
  const confirmedSeverity = issue.severity === "warning" ? "confirmed_warning" : "confirmed_blocking";
  const text = `${issue.problem} ${issue.evidence} ${issue.expected}`;
  const mentionsTruncation = TRUNCATION_RE.test(text);
  const pageFormulas = (rel?: string) => state.formulas.filter((f) => !rel || f.pageRel === rel);
  const targetFiles = issue.pagePath ? [issue.pagePath] : issue.sectionPath ? [issue.sectionPath] : [];

  // Deterministic anchor-evidence issues are already verified by the audit.
  if (issue.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX)) {
    return { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: [".breadboard/source-anchors.json"], reason: "deterministic anchor-evidence issue (already verified by the final-state audit)" };
  }

  // Default when a check cannot locate its target: TRUST the critic (do not
  // weaken it). Only affirmative counter-evidence downgrades an issue.
  const trust = (checkedFiles: string[], reason: string): CriticIssueVerificationResult =>
    ({ issueId, verified: true, severity: confirmedSeverity, checkedFiles, reason });

  // (a0) Missing/unrepresented source-visual claim — verify against ALL modes
  //      (static embed, ledger, interactive) before it can block (Fix 2).
  const mentionsMissingVisual = /(unrepresented|not (?:visualized|represented|shown)|missing (?:visual|figure|diagram|representation)|no (?:visual|figure|diagram)|figure .*not|architecture (?:figure|diagram|visual))/i.test(text);
  if (issue.type === "visual_grounding_mismatch" || mentionsMissingVisual) {
    const anchorIds = [...new Set([...(issue.sourceAnchorIds ?? []), ...(text.match(/S\d+\.P\d+\.[A-Za-z]\d+/g) ?? [])])];
    if (anchorIds.length > 0) {
      const reps = anchorIds.map((id) => verifySourceVisualRepresentation(id, state));
      const represented = reps.filter((r) => r.represented);
      if (represented.length === anchorIds.length && represented.length > 0) {
        return { issueId, verified: false, severity: "unsupported", checkedFiles: [...new Set(represented.flatMap((r) => r.pagePaths))], fullStateEvidence: represented.flatMap((r) => r.evidence).slice(0, 4), reason: `source figure is embedded and explained as a static source visual (${represented.map((r) => `${r.anchorId}: ${r.representationModes.join("+")}`).join("; ")})` };
      }
      const missing = reps.filter((r) => !r.represented);
      if (missing.length > 0) {
        return { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: targetFiles, fullStateEvidence: missing.map((r) => r.reason), reason: `${missing.map((r) => r.anchorId).join(", ")} is not represented by any static embed, interactive visual, or justified omission` };
      }
    }
  }

  // (a) Formula truncation / malformed formula — the known packet false positive.
  if (mentionsTruncation && /formula|equation|latex|\\|expression|brace/i.test(text)) {
    const anchorIds = new Set(issue.sourceAnchorIds ?? []);
    const candidates = pageFormulas(issue.pagePath).filter((f) => anchorIds.size === 0 || anchorIds.has(f.sourceAnchor ?? "") || anchorIds.has(f.basedOnFormula ?? ""));
    const pool = candidates.length ? candidates : pageFormulas(issue.pagePath);
    const files = [...new Set(pool.map((f) => f.pageRel))];
    if (pool.length === 0) return trust(targetFiles, "no formula located to check; trusting the critic verdict");
    const incomplete = pool.filter((f) => !isFormulaSyntacticallyComplete(f.text));
    if (incomplete.length === 0) {
      return { issueId, verified: false, severity: "unsupported", checkedFiles: files, fullStateEvidence: pool.map((f) => f.text), reason: "Full FinalGardenState formula is complete (balanced braces, no cut commands); only the packet excerpt was truncated" };
    }
    return { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: files, fullStateEvidence: incomplete.map((f) => f.text), reason: "Full formula is syntactically incomplete (unbalanced braces or a cut command)" };
  }

  // (b) Worked-example misclassification.
  if (issue.type === "worked_example_misclassified") {
    const pool = pageFormulas(issue.pagePath);
    const files = issue.pagePath ? [issue.pagePath] : [...new Set(pool.map((f) => f.pageRel))];
    if (pool.length === 0) return trust(files, "no formulas located to check; trusting the critic verdict");
    // The canonical export contract deliberately preserves an identity-reviewed
    // source formula verbatim. Some source formulas are themselves concrete
    // numerical examples, so structural arithmetic alone cannot contradict the
    // `source_definition` metadata role when the entry is an exact reviewed
    // projection. The finalizer makes the same exemption; keeping the critic's
    // independent verifier aligned prevents an impossible repair loop where the
    // critic demands relabeling and the strict source-projection gate rejects it.
    const misclassified = pool.filter((f) => {
      if (f.structuralKind !== "worked_example" || f.declaredKind !== "source_definition") {
        return false;
      }
      const sourceAnchor = String(f.sourceAnchor ?? "").trim();
      const reviewedExactText = sourceAnchor
        ? state.sourceAnchors[sourceAnchor]?.exactText
        : undefined;
      const reviewedGrounding = /^(source-anchored|source-derived)$/.test(String(f.groundingStatus ?? "").trim());
      return !reviewedGrounding || !reviewedExactText ||
        exactSourceFormulaProjectionKey(f.text) !== exactSourceFormulaProjectionKey(reviewedExactText);
    });
    if (misclassified.length > 0) {
      return { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: files, fullStateEvidence: misclassified.map((f) => f.text), reason: "a numeric worked example is labeled source_definition in the full record" };
    }
    return { issueId, verified: false, severity: "unsupported", checkedFiles: files, reason: "no noncanonical numeric substitution is mislabeled as source_definition; any numeric source_definition is an exact identity-reviewed source projection" };
  }

  // (c) Source-anchor mismatch — inspect the full canonical anchor record.
  if (issue.type === "source_anchor_mismatch") {
    const ids = issue.sourceAnchorIds ?? [];
    const anchors = ids.map((id) => state.sourceAnchors[id]).filter(Boolean);
    if (anchors.length === 0) return trust([".breadboard/source-anchors.json"], "referenced anchor not resolvable here; trusting the critic verdict");
    for (const anchor of anchors) {
      if (anchor.criticConfirmed) continue;
      if (!anchor.exactText) {
        return { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: [".breadboard/source-anchors.json"], reason: `anchor ${anchor.id} has no exactText (cannot be source-grounded)` };
      }
      const relevance = verifySourceTextRelevance({ id: anchor.id, title: anchor.title, kind: anchor.kind, conceptKeywords: anchor.conceptKeywords, semanticSummary: anchor.semanticSummary }, anchor.exactText);
      if (relevance.decision === "irrelevant") {
        return { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: [".breadboard/source-anchors.json"], fullStateEvidence: [anchor.exactText.slice(0, 160)], reason: `anchor ${anchor.id} exactText does not support its concept (relevance: irrelevant; ${relevance.reason})` };
      }
    }
    return { issueId, verified: false, severity: "unsupported", checkedFiles: [".breadboard/source-anchors.json"], reason: "the full anchor record's exactText is relevant/critic-confirmed; the compact summary was misleading" };
  }

  // (d) Section prose / repeated opening — inspect the FULL markdown, not excerpts.
  if (issue.type === "section_index_template_prose") {
    const key = (issue.sectionPath ?? "").replace(/\/_index\.md$/, "");
    const section = state.sections.find((s) => s.rel === issue.sectionPath || (key && s.rel.startsWith(key)));
    if (!section) return trust(targetFiles, "section not located; trusting the critic verdict");
    const hasTemplate = DEFAULT_TEMPLATE_PHRASES.some((p) => section.body.toLowerCase().includes(p));
    return hasTemplate
      ? { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: [section.rel], reason: "full section index body contains template scaffold prose" }
      : { issueId, verified: false, severity: "unsupported", checkedFiles: [section.rel], reason: "full section index body does not contain template scaffold prose (the excerpt was misleading)" };
  }
  if (issue.type === "repeated_opening") {
    const target = state.pages.find((p) => p.rel === issue.pagePath);
    if (!target) return trust(targetFiles, "page not located; trusting the critic verdict");
    const opening = (s: string) => firstProseParagraphs(s, 1).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
    const targetOpening = opening(target.body);
    const duplicate = targetOpening.length >= 40 && state.pages.some((p) => p.rel !== target.rel && opening(p.body) === targetOpening);
    return duplicate
      ? { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: [target.rel], reason: "another page shares the same full opening paragraph" }
      : { issueId, verified: false, severity: "unsupported", checkedFiles: [target.rel], reason: "no other page shares this full opening; the short excerpt looked similar but the full openings differ" };
  }

  // (e) Everything else: trust the critic (do not weaken it).
  return trust(targetFiles, "no deterministic contradiction found; trusting the critic verdict");
}

/** Minimal shape of an OpenAI-compatible chat client (ChatMock or the SDK). The
 *  `create` signature is intentionally permissive so the overloaded OpenAI SDK
 *  method and a test double both satisfy it. */
export interface ChatCompletionClientLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat: { completions: { create: (...args: any[]) => Promise<any> } };
}

/** ChatMock-backed critic (OpenAI-compatible chat completion). */
export function createChatMockCritic(opts: {
  client: ChatCompletionClientLike;
  model: string;
  timeoutMs?: number;
}): CriticFn {
  return async (packet: CriticReviewPacket): Promise<CriticIssue[]> => {
    const response = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: "system", content: CRITIC_SYSTEM_PROMPT },
          { role: "user", content: buildCriticUserPrompt(packet) },
        ],
        response_format: { type: "json_object" },
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
    );
    return parseCriticIssues(response.choices?.[0]?.message?.content ?? "");
  };
}

// ---------------------------------------------------------------------------
// ChatMock anchor confirmation (low-confidence source anchors)
// ---------------------------------------------------------------------------

/** Judges one low-confidence anchor packet, returns a structured decision. */
export type AnchorCriticFn = (packet: AnchorConfirmationPacket) => Promise<AnchorCriticDecision | null> | AnchorCriticDecision | null;

export const ANCHOR_CRITIC_SYSTEM_PROMPT = `You are Breadboard's source-anchor confirmation critic. A deterministic scorer flagged a GENERATED semantic source anchor as weakly grounded (low confidence). Using ONLY the source passages provided, decide whether the anchor is genuinely supported.

Return ONLY a JSON object with this exact shape:
{
  "anchorId": string,
  "decision": "confirm" | "replace" | "create_better_anchor" | "reject",
  "confidence": "high" | "medium" | "low",
  "reason": one sentence citing the source,
  "confirmedExactText": string,           // REQUIRED for confirm; verbatim source sentence that supports the anchor
  "replacementAnchorId": string,          // REQUIRED for replace; must be one of existingAlternativeAnchors
  "betterAnchor": {                        // REQUIRED for create_better_anchor
    "id": string, "kind": "text"|"abstract"|"intro"|"guidance", "sourceId": string, "page": number,
    "title": string, "exactText": string, "semanticSummary": string, "conceptKeywords": string[]
  },
  "requiredRepairs": [ { "targetKind": "unit_page"|"learning_unit_contract"|"source_anchor_ledger"|"source_coverage", "targetPath"?: string, "instructions": string[] } ]
}

Rules:
- confirm ONLY if a candidate/nearby passage clearly supports the anchor's title and semantic summary; set confidence high|medium and quote the exact supporting sentence in confirmedExactText. Do not confirm on one weak keyword.
- replace when an existing alternative anchor covers the concept better; set replacementAnchorId to its id.
- create_better_anchor when a NEARBY passage supports the concept better than the candidate; provide betterAnchor with a verbatim exactText.
- reject when no passage supports the anchor; provide requiredRepairs describing how to fix the page/contract grounding.
Output JSON only, no prose.`;

export function buildAnchorCriticPrompt(packet: AnchorConfirmationPacket): string {
  return `Judge this low-confidence source anchor. Return one JSON decision object.\n\n${JSON.stringify(packet, null, 1)}`;
}

/** Parse a ChatMock anchor decision. Tolerant of fences / {decision:...} wraps. */
export function parseAnchorCriticDecision(text: string): AnchorCriticDecision | null {
  const stripped = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); }
  catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  const r = parsed as Record<string, unknown>;
  if (!r || typeof r !== "object") return null;
  const decision = String(r.decision ?? "");
  if (!["confirm", "replace", "create_better_anchor", "reject"].includes(decision)) return null;
  const anchorId = String(r.anchorId ?? "").trim();
  if (!anchorId) return null;
  const confidence = ["high", "medium", "low"].includes(String(r.confidence)) ? String(r.confidence) as AnchorCriticDecision["confidence"] : "low";
  return {
    anchorId,
    decision: decision as AnchorCriticDecision["decision"],
    confidence,
    reason: String(r.reason ?? "").trim(),
    confirmedExactText: r.confirmedExactText ? String(r.confirmedExactText) : undefined,
    replacementAnchorId: r.replacementAnchorId ? String(r.replacementAnchorId) : undefined,
    betterAnchor: r.betterAnchor && typeof r.betterAnchor === "object" ? r.betterAnchor as AnchorCriticDecision["betterAnchor"] : undefined,
    requiredRepairs: Array.isArray(r.requiredRepairs) ? r.requiredRepairs as AnchorCriticDecision["requiredRepairs"] : undefined,
  };
}

/** Terminal protocol failure after an anchor-critic request fulfilled without a
 * usable structured decision. Provider exceptions are never wrapped in this
 * error; they cross the request boundary by exact identity. */
export class AnchorCriticProtocolError extends Error {
  constructor(message: string) {
    super(`Anchor critic response validation failed: ${message}`);
    this.name = "AnchorCriticProtocolError";
  }
}

/** Strict production boundary around the tolerant standalone parser. */
export function parseAnchorCriticDecisionStrict(text: string): AnchorCriticDecision {
  if (!String(text ?? "").trim()) {
    throw new AnchorCriticProtocolError("response was empty.");
  }
  const decision = parseAnchorCriticDecision(text);
  if (!decision) {
    throw new AnchorCriticProtocolError("response did not contain a structured decision.");
  }
  return decision;
}

/** ChatMock-backed anchor confirmation critic (OpenAI-compatible). */
export function createChatMockAnchorCritic(opts: {
  client: ChatCompletionClientLike;
  model: string;
  timeoutMs?: number;
}): AnchorCriticFn {
  return async (packet: AnchorConfirmationPacket): Promise<AnchorCriticDecision | null> => {
    const response = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: "system", content: ANCHOR_CRITIC_SYSTEM_PROMPT },
          { role: "user", content: buildAnchorCriticPrompt(packet) },
        ],
        response_format: { type: "json_object" },
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
    );
    return parseAnchorCriticDecisionStrict(response.choices?.[0]?.message?.content ?? "");
  };
}

// ---------------------------------------------------------------------------
// Issue -> repair request mapping
// ---------------------------------------------------------------------------

function repairTargetPath(issue: CriticIssue): string | undefined {
  switch (issue.repairTarget) {
    case "unit_page": return issue.pagePath;
    case "section_index": return issue.sectionPath ?? (issue.pagePath ? `${issue.pagePath.split("/").slice(0, 2).join("/")}/_index.md` : undefined);
    case "visual_spec": return issue.visualId ? `.breadboard/visuals/${issue.visualId}.json` : undefined;
    case "learning_unit_contract": return ".breadboard/learning-unit-contract.json";
    case "source_anchor_ledger": return ".breadboard/source-anchors.json";
    case "source_coverage": return ".breadboard/planning/Source Coverage.md";
    case "repair_log": return ".breadboard/repair-log.json";
    default: return undefined;
  }
}

function issueText(issue: CriticIssue): string {
  return [issue.problem, issue.evidence, issue.expected, issue.suggestedRepair].filter(Boolean).join("\n");
}

function extractFormulaIndex(issue: CriticIssue): number | undefined {
  const match = issueText(issue).match(/\bformulas?\s*\[\s*(\d+)\s*\]|\bformula\s+(?:index\s*)?(\d+)\b/i);
  const raw = match?.[1] ?? match?.[2];
  return raw === undefined ? undefined : Number.parseInt(raw, 10);
}

function extractAnchorIds(issue: CriticIssue): string[] {
  const explicit = issue.sourceAnchorIds ?? [];
  const mined = issueText(issue).match(/\bS\d+\.P\d+\.[A-Za-z0-9_.-]+\b|scopeContract\.[A-Za-z0-9_.-]+/g) ?? [];
  return [...new Set([...explicit, ...mined].map(String).filter(Boolean))];
}

function sourceAnchorIssueNeedsExactTextRepair(issue: CriticIssue): boolean {
  if (issue.type !== "source_anchor_mismatch") return false;
  if (issue.repairTarget === "source_anchor_ledger") return true;
  const text = issueText(issue);
  return /\bexactText\b|verbatim|quoted?|passage|excerpt|source text|wrong source|does not support|irrelevant|mismatch/i.test(text);
}

function concreteRepairTargets(
  issue: CriticIssue,
  state?: Pick<FinalGardenState, "pages" | "sourceUsages" | "formulas">,
): Array<{
  targetKind: CriticRepairTarget;
  targetPath?: string;
  anchorIds?: string[];
}> {
  const explicitPath = repairTargetPath(issue);
  if (explicitPath || issue.repairTarget !== "global" || !state) {
    return [{
      targetKind: issue.repairTarget,
      targetPath: explicitPath,
      anchorIds: extractAnchorIds(issue),
    }];
  }
  const anchorIds = new Set(issue.sourceAnchorIds ?? []);
  if (anchorIds.size === 0) {
    return [{ targetKind: issue.repairTarget }];
  }
  const anchorsByPage = new Map<string, Set<string>>();
  const addPageAnchor = (pageRel: string, anchorId: string): void => {
    if (!anchorIds.has(anchorId)) return;
    const pageAnchors = anchorsByPage.get(pageRel) ?? new Set<string>();
    pageAnchors.add(anchorId);
    anchorsByPage.set(pageRel, pageAnchors);
  };
  for (const page of state.pages) {
    for (const anchorId of [
      ...page.sourceAnchors,
      ...page.sourceFormulaAnchors,
      ...page.sourceVisualIds,
      ...page.formulas.flatMap((formula) =>
        [formula.sourceAnchor, formula.basedOnFormula].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ]) {
      addPageAnchor(page.rel, anchorId);
    }
  }
  for (const usage of state.sourceUsages) {
    addPageAnchor(usage.pageRel, usage.anchorId);
  }
  for (const formula of state.formulas) {
    if (formula.sourceAnchor) addPageAnchor(formula.pageRel, formula.sourceAnchor);
    if (formula.basedOnFormula) addPageAnchor(formula.pageRel, formula.basedOnFormula);
  }
  if (anchorsByPage.size === 0) {
    return [{ targetKind: issue.repairTarget }];
  }
  return [...anchorsByPage].map(([targetPath, pageAnchors]) => ({
    targetKind: "unit_page",
    targetPath,
    anchorIds: [...pageAnchors],
  }));
}

/** Group blocking issues into targeted repair requests (one per target+path).
 * A verified global finding with explicit anchors is expanded to the concrete
 * lesson files that reference those anchors, so the model repair boundary
 * never receives an unexecutable target. */
export function criticIssuesToRepairRequests(
  issues: CriticIssue[],
  state?: Pick<FinalGardenState, "pages" | "sourceUsages" | "formulas">,
): ArtifactRepairRequest[] {
  const groups = new Map<string, ArtifactRepairRequest>();
  for (const issue of issues) {
    for (const target of concreteRepairTargets(issue, state)) {
      const key = `${target.targetKind}::${target.targetPath ?? ""}`;
      let req = groups.get(key);
      if (!req) {
        req = {
          id: `repair-${target.targetKind}-${groups.size + 1}`,
          issueIds: [],
          targetKind: target.targetKind,
          targetPath: target.targetPath,
          affectedUnitIds: [],
          affectedAnchorIds: [],
          formulaKindRepairs: [],
          textAnchorExactTextRepairs: [],
          instructions: [],
          evidence: [],
        };
        groups.set(key, req);
      }
      req.issueIds.push(issue.id);
      if (issue.suggestedRepair) req.instructions.push(issue.suggestedRepair);
      if (issue.evidence) req.evidence.push(issue.evidence);
      const anchorIds = target.anchorIds ?? extractAnchorIds(issue);
      for (const id of anchorIds) if (!req.affectedAnchorIds!.includes(id)) req.affectedAnchorIds!.push(id);
      if (issue.type === "worked_example_misclassified") {
        req.formulaKindRepairs!.push({
          issueId: issue.id,
          pagePath: target.targetPath ?? issue.pagePath,
          formulaIndex: extractFormulaIndex(issue),
          sourceAnchorIds: anchorIds.filter((id) => /\.E\d+$/i.test(id)),
          expectedKind: "worked_example",
          basedOnFormula: anchorIds.find((id) => /\.E\d+$/i.test(id)),
          evidence: issue.evidence,
        });
      }
      if (sourceAnchorIssueNeedsExactTextRepair(issue) && anchorIds.length > 0) {
        req.textAnchorExactTextRepairs!.push({
          issueId: issue.id,
          anchorIds,
          pagePath: target.targetPath ?? issue.pagePath,
          evidence: issue.evidence,
          problem: issue.problem,
        });
      }
    }
  }
  return [...groups.values()].map((req) => ({
    ...req,
    affectedUnitIds: req.affectedUnitIds!.length ? req.affectedUnitIds : undefined,
    affectedAnchorIds: req.affectedAnchorIds!.length ? req.affectedAnchorIds : undefined,
    formulaKindRepairs: req.formulaKindRepairs!.length ? req.formulaKindRepairs : undefined,
    textAnchorExactTextRepairs: req.textAnchorExactTextRepairs!.length ? req.textAnchorExactTextRepairs : undefined,
  }));
}

// ---------------------------------------------------------------------------
// ChatMock model repair (semantic page/section rewrites)
// ---------------------------------------------------------------------------

/** Semantic critic issue types that a MODEL page/section rewrite handles first;
 *  the deterministic layer only fixes the mechanical classes. */
const MODEL_FIRST_ISSUE_TYPES = new Set<CriticIssueType>([
  "explanation_gap",
  "section_index_template_prose",
  "template_zettelkasten_handle",
  "repeated_opening",
  "formula_anchor_mismatch",
  "source_anchor_mismatch",
  "worked_example_misclassified",
  "visual_grounding_mismatch",
]);
const MODEL_FIRST_TARGETS = new Set<CriticRepairTarget>(["unit_page", "section_index"]);

function requestIsModelFirst(req: ArtifactRepairRequest, issuesById?: Map<string, CriticIssue>): boolean {
  if (!MODEL_FIRST_TARGETS.has(req.targetKind)) return false;
  const issues = req.issueIds.map((id) => issuesById?.get(id)).filter(Boolean) as CriticIssue[];
  return issues.length === 0 || issues.some((i) => MODEL_FIRST_ISSUE_TYPES.has(i.type));
}

export const MODEL_REPAIR_SYSTEM_PROMPT = `You repair one file of a Breadboard learning garden to remove a specific semantic issue a critic found. Return ONLY the full revised content of the target file — no commentary, no code fences.

${LEARN_FOUNDATION_RULES}

Hard requirements:
- Return the ENTIRE target file, not a diff.
- Preserve the YAML frontmatter block and every required key (title, knowledge_type/breadboardType, learningUnitId, generated_by, tags, sourceAnchors, sourceFormulaAnchors, formulas, visualIds). Change only what the issue requires.
- Unless the issue explicitly targets metadata, preserve the YAML frontmatter verbatim and change only learner-facing prose or display math in the body.
- Preserve source anchors and formula anchors UNLESS the issue is a source/formula anchor mismatch, in which case ground to the correct one named in the issue.
- Never add a source or formula anchor that is absent from the target page's Learning Unit Contract. If a critic asks for excluded material, repair the prose within the existing contract instead of expanding the source scope.
- Preserve every existing exact source-formula transcription and its metadata. If the source transcription itself contains a typo, convention conflict, or misleading special case, keep the exact source display visibly labeled as the source form and add the corrected relationship as unanchored explanatory math; never silently rewrite the source projection.
- Preserve every \`\`\`breadboard-visual\`\`\` block verbatim.
- Preserve contract-backed Zettelkasten tags, unless the issue is a template handle — then replace only the flagged handle with a concrete durable claim.
- Remove exactly the flagged issue; do not introduce generic scaffold prose ("introduces the core idea", "so the pieces connect into one picture", "one step at a time").
- For explanation_gap, supply the missing meaning or reasoning before the passage that depends on it. Use a brief concrete explanation built from simpler ideas; an acronym expansion, synonym, glossary link, or promise to explain later is insufficient. Preserve correct teaching elsewhere and keep orientation pages concise.
- Keep the learner-facing voice; never mention "the paper", "the source", or "this document".
Output the revised file content only.`;

export function buildModelRepairPrompt(input: ModelRepairInput): { system: string; user: string } {
  const { issue, repairRequest } = input;
  if (input.repairStage === "reanchor") return {
    system: "Repair the evidence bindings of exactly one learning unit. Return JSON only, or null if the offered passages do not support its learning question. Never change the question, title, claims, required artifacts, or any other unit. Never claim that the selected sources lack evidence just because this bounded candidate list lacks it.",
    user: JSON.stringify({
      problem: issue.problem, expected: issue.expected, evidence: issue.evidence,
      unit: input.learningUnitContract,
      assignedEvidence: input.sourceAnchors,
      candidates: input.reanchorCandidates,
      instructions: 'Return {"learningUnits":[the complete revised unit]}. Change only sourceAnchors, semanticConcepts[].evidenceAnchors, and knowledgeClaims[].evidenceAnchors/derivationAnchors. Choose new anchors only from candidates, whose exactText is canonical evidence. Preserve correct existing bindings. Bind each claim to a passage that actually supports it; topic word overlap alone is insufficient. If the current bindings already suffice, return null. This is one bounded attempt; unsupported units remain unresolved.',
    }),
  };
  const validationFeedback = (input.priorCandidateValidationFeedback ?? [])
    .map((problem) => String(problem).trim())
    .filter(Boolean);
  const user = [
    `Target file: ${repairRequest.targetPath ?? "(unknown)"}`,
    `Issue type: ${issue.type}`,
    `Problem: ${issue.problem}`,
    `Evidence: ${issue.evidence}`,
    `Expected: ${issue.expected}`,
    `Instructions: ${repairRequest.instructions.join(" ") || issue.suggestedRepair}`,
    input.learningUnitContract ? `Learning Unit Contract: ${JSON.stringify(input.learningUnitContract)}` : "",
    input.sourceAnchors ? `Relevant source anchors: ${JSON.stringify(input.sourceAnchors)}` : "",
    input.repairStage === "page" ? "The unit has gained validated canonical evidence bindings. Update the page's sourceAnchors to match the Learning Unit Contract and teach the original learning question from the exact passages above. Preserve all other required metadata and artifacts." : "",
    input.scopedLearningUnitIds?.length && input.reanchorCandidates?.length
      ? [
          "This unit's assigned evidence does not cover what it teaches. The same source contains passages that do. Re-anchor the unit: replace the mismatched anchor ids in its sourceAnchors (and in any semanticConcepts/knowledgeClaims evidenceAnchors that cite them) with the ids of the candidates below that actually support the taught material. Choose from these candidates only; do not invent anchor ids. When the target is the learning-unit contract itself, changing its anchors is the repair, not a violation of it.",
          `Re-anchoring candidates from the same source: ${JSON.stringify(
            input.reanchorCandidates.map((anchor) => ({
              id: anchor.id,
              page: anchor.page,
              title: anchor.title,
              excerpt: (anchor.exactText ?? anchor.semanticSummary ?? "").slice(0, 280),
            })),
          )}`,
        ].join("\n")
      : "",
    input.previousPageSummary ? `Previous page: ${input.previousPageSummary}` : "",
    input.nextPageSummary ? `Next page: ${input.nextPageSummary}` : "",
    validationFeedback.length > 0
      ? [
          `Candidate attempt ${Math.max(2, input.candidateAttempt ?? 2)} must differ from the rejected candidate.`,
          "The previous candidate was rolled back because it failed these exact validation checks:",
          ...validationFeedback.map((problem) => `- ${problem}`),
          "Repair the original issue while preserving every contract/source projection named above.",
        ].join("\n")
      : "",
    "",
    input.scopedLearningUnitIds?.length
      ? `Only these learning units may change: ${input.scopedLearningUnitIds.join(", ")}. The rest of the contract is unchanged and is not shown.`
      : "",
    input.scopedLearningUnitIds?.length ? "The learning units you may revise:" : "Current file content:",
    "-----",
    input.currentMarkdown ?? "(none)",
    "-----",
    input.scopedLearningUnitIds?.length
      ? 'Return only a JSON object of the form {"learningUnits": [ ... ]} containing exactly those units, revised. Keep each unit\'s "id" unchanged. Do not return the rest of the contract.'
      : "Return the full revised file content only.",
    // Seen 2026-09-15: asked for a ~190k-character learning-unit contract,
    // the ChatGPT web Thinking model wrote it to its own sandbox and replied
    // with "[learning-unit-contract.json](sandbox:/mnt/data/...)". Nothing
    // outside that sandbox can read the file, so the repair had no candidate.
    "Write that content directly in your reply as plain text. Do not create, save or attach a file, do not use a code sandbox, and never answer with a download link or file reference instead of the content.",
  ].filter(Boolean).join("\n");
  return { system: MODEL_REPAIR_SYSTEM_PROMPT, user };
}

/** Parse a model repair response into structured output for the target file. */
export function parseModelRepairOutput(text: string, targetPath: string): ModelRepairOutput | null {
  const stripped = String(text ?? "").trim().replace(/^```(?:json|markdown|md)?\s*/i, "").replace(/```$/i, "").trim();
  // JSON null is the provider explicitly returning no repair candidate. Treat
  // fenced and unfenced forms exactly like an empty response so the strict
  // active-Learn repair boundary stops instead of re-observing the blocker and
  // issuing another model request in a later critic round.
  if (!stripped || stripped === "null") return null;
  if (/\.json$/i.test(targetPath)) {
    try {
      return { targetPath, revisedJson: JSON.parse(stripped) };
    } catch {
      // The ChatGPT web chat models put a sentence before the object; a
      // 189k-character learning-unit contract repair was discarded as "no
      // candidate" on 2026-09-15 for that alone.
      try {
        return { targetPath, revisedJson: parseJsonObjectResponse(stripped) };
      } catch {
        return null;
      }
    }
  }
  return { targetPath, revisedMarkdown: stripLeadingCommentaryBeforeFrontmatter(stripped) };
}

/** A page repair must start with its frontmatter. A short sentence of
 * assistant commentary before the opening `---` is dropped; anything longer,
 * or a page without frontmatter, is returned unchanged for validation to judge. */
function stripLeadingCommentaryBeforeFrontmatter(markdown: string): string {
  if (markdown.startsWith("---")) return markdown;
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/m.exec(markdown);
  if (!match || match.index === 0) return markdown;
  const prefix = markdown.slice(0, match.index).trim();
  if (prefix.length > 600 || /^#{1,6}\s|^```|^:::/m.test(prefix)) return markdown;
  return markdown.slice(match.index);
}

/** ChatMock-backed model repair (OpenAI-compatible chat completion). */
export function createChatMockModelRepair(opts: {
  client: ChatCompletionClientLike;
  model: string;
  timeoutMs?: number;
}): ModelRepairFn {
  return async (input: ModelRepairInput): Promise<ModelRepairOutput | null> => {
    if (!input.repairRequest.targetPath) return null;
    const { system, user } = buildModelRepairPrompt(input);
    const response = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
    );
    return parseModelRepairOutput(response.choices?.[0]?.message?.content ?? "", input.repairRequest.targetPath);
  };
}

// ---------------------------------------------------------------------------
// Repair application (model-first for semantics, deterministic for mechanics)
// ---------------------------------------------------------------------------

function pageSummary(state: FinalGardenState, rel: string): string | undefined {
  const page = state.pages.find((p) => p.rel === rel);
  if (!page) return undefined;
  return `${page.title}: ${firstProseParagraphs(page.body, 1).join(" ").slice(0, 160)}`;
}

function adjacentPageSummaries(state: FinalGardenState, rel: string): { previous?: string; next?: string } {
  const ordered = [...state.pages].sort((a, b) => a.rel.localeCompare(b.rel));
  const idx = ordered.findIndex((p) => p.rel === rel);
  if (idx < 0) return {};
  return {
    previous: idx > 0 ? pageSummary(state, ordered[idx - 1].rel) : undefined,
    next: idx < ordered.length - 1 ? pageSummary(state, ordered[idx + 1].rel) : undefined,
  };
}

/** How large a contract has to be before its repair is scoped to units. */
const LEARNING_UNIT_CONTRACT_SCOPED_REPAIR_CHARS = 60_000;

/**
 * The slice of the learning-unit contract a repair should actually be shown.
 *
 * Returns null whenever the whole file is still a reasonable thing to ask for:
 * a different target, a small contract, a request that does not say which
 * units it affects, or a contract this code cannot parse. In those cases the
 * caller keeps the existing whole-file behaviour untouched.
 */
function scopedLearningUnitContractRepair(
  request: ArtifactRepairRequest,
  wholeFile: string | undefined,
  state?: FinalGardenState,
  issue?: CriticIssue,
): { currentMarkdown: string; unitIds: string[] } | null {
  if (!request.targetPath || !/learning-unit-contract\.json$/i.test(request.targetPath)) return null;
  if (!wholeFile || wholeFile.length < LEARNING_UNIT_CONTRACT_SCOPED_REPAIR_CHARS) return null;
  const unitIds = (request.affectedUnitIds ?? []).filter((id): id is string => typeof id === "string" && !!id);
  // A contract issue usually names the page it came from rather than the unit,
  // and affectedUnitIds is optional - so scoping that trusted it alone never
  // engaged, and the repair kept asking for the whole 198 KB file
  // (telecom-1, 2026-09-18). The page carries its unit id, which is the same
  // answer by a different route.
  if (unitIds.length === 0 && issue?.pagePath && state) {
    const page = state.pages.find((candidate) => candidate.rel === issue.pagePath);
    if (typeof page?.learningUnitId === "string" && page.learningUnitId) unitIds.push(page.learningUnitId);
  }
  if (unitIds.length === 0) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(wholeFile) as Record<string, unknown>;
  } catch {
    return null;
  }
  const units = parsed.learningUnits;
  if (!Array.isArray(units)) return null;
  const wanted = units.filter((unit) => {
    const id = (unit as { id?: unknown } | null)?.id;
    return typeof id === "string" && unitIds.includes(id);
  });
  if (wanted.length === 0) return null;
  return {
    currentMarkdown: JSON.stringify({ learningUnits: wanted }, null, 2),
    unitIds: wanted.map((unit) => String((unit as { id?: unknown }).id)),
  };
}

/**
 * The stable part of a critic issue id: its leading unit token ("u19"). The
 * rest is model-authored wording that drifts between runs.
 */
function criticIssueUnitToken(issueId: string): string | null {
  const match = /^(u\d+)-/i.exec(issueId.trim());
  return match ? match[1].toLowerCase() : null;
}

function normalizedResiduePagePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim().toLowerCase();
}

/**
 * Build the matcher for accepted residues.
 *
 * Critic issue ids are model-authored and do not survive a run: the same
 * finding was "u19-step-graded-source-anchor-mismatch", then
 * "u19-step-graded-source-mismatch", then "step-graded-fiber-source-mismatch"
 * with the unit prefix gone altogether (telecom-1, 2026-09-18). What a person
 * actually accepts is a finding of a given kind on a given page, and the page
 * path is the one field the critic reports stably. So the primary entry form
 * is `page:<type>:<pagePath>`; an exact id is still honoured for the run it
 * was read from, and `<unit>:<type>` keeps working while the critic includes
 * a unit token. Anything that does not parse matches by exact id only, so a
 * malformed entry can never widen the gate.
 */
function acceptedResidueMatcher(entries: readonly string[]): (issue: CriticIssue) => boolean {
  const exact = new Set<string>();
  const byUnitAndType = new Set<string>();
  const byPageAndType = new Set<string>();
  const pagelessByType = new Set<string>();
  for (const raw of entries) {
    const entry = String(raw ?? "").trim();
    if (!entry) continue;
    exact.add(entry);
    // `page:*:<path>` accepts every finding on that page. Used when a page
    // has been accepted as a whole - the fibre pages of telecom-1 produced a
    // differently-typed finding on each pass as repairs pushed them back and
    // forth, and recording them one type at a time only chased the critic.
    const byPage = /^page:([a-z_*]+):(.+)$/i.exec(entry);
    if (byPage) {
      byPageAndType.add(`${byPage[1].toLowerCase()}|${normalizedResiduePagePath(byPage[2])}`);
      continue;
    }
    // `type:<type>` accepts findings of one type that carry NO page at all -
    // a section index promising a lesson the plan never generated, say
    // (source_coverage_contradiction on telecom-1, 2026-09-19). Deliberately
    // restricted to page-less findings: a typed residue never reaches a
    // finding that names a page, so it cannot silence a real page defect.
    const byType = /^type:([a-z_]+)$/i.exec(entry);
    if (byType) {
      pagelessByType.add(byType[1].toLowerCase());
      continue;
    }
    const explicit = /^(u\d+):([a-z_]+)$/i.exec(entry);
    if (explicit) {
      byUnitAndType.add(`${explicit[1].toLowerCase()}:${explicit[2].toLowerCase()}`);
      continue;
    }
    const unit = criticIssueUnitToken(entry);
    if (unit && /source|anchor/i.test(entry)) byUnitAndType.add(`${unit}:source_anchor_mismatch`);
  }
  return (issue) => {
    if (exact.has(issue.id)) return true;
    const type = String(issue.type).toLowerCase();
    if (issue.pagePath) {
      const page = normalizedResiduePagePath(issue.pagePath);
      if (byPageAndType.has(`${type}|${page}`) || byPageAndType.has(`*|${page}`)) return true;
    } else if (pagelessByType.has(type)) {
      return true;
    }
    const unit = criticIssueUnitToken(issue.id);
    return unit !== null && byUnitAndType.has(`${unit}:${type}`);
  };
}

/** How many alternative anchors to offer a re-anchoring repair. */
const REANCHOR_CANDIDATE_LIMIT = 12;

const REANCHOR_STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "into", "than", "then", "their", "which", "while", "where",
  "does", "not", "its", "own", "are", "for", "but", "has", "have", "been", "should", "would", "could",
  "unit", "page", "contract", "evidence", "teaches", "taught", "assigned", "selected", "describe", "describes",
  "material", "topics", "claims", "source", "sources", "canonical", "directly", "supports", "support",
]);

function reanchorTerms(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((term) => term.replace(/^-+|-+$/g, ""))
      .filter((term) => term.length >= 4 && !REANCHOR_STOPWORDS.has(term)),
  )];
}

/**
 * Anchors in the same source that the repair could re-anchor a unit to.
 *
 * A source_anchor_mismatch says a unit teaches what its assigned evidence does
 * not cover. Until now the repair was shown only that unit's existing anchors
 * - Keiser page 49, a glass-air reflection example, for a unit about plastic
 * fibre - and asked to fix the mismatch. It could not: the pages that do
 * cover plastic fibre and index profiles exist in the same 2.6 MB source, but
 * nothing ever put them in front of the model. Six identical attempts across
 * three runs changed nothing (telecom-1 U19 and U20, 2026-09-18).
 *
 * This ranks the source's other text anchors by how many of the issue's own
 * words appear in their title, excerpt and keywords, and offers the best of
 * them. The repair decides; this only makes the decision possible. Candidates
 * are drawn from the same source ids the unit is already bound to, so a
 * re-anchoring never quietly pulls in a different book.
 */
export function reanchorCandidates(
  state: FinalGardenState,
  issue: CriticIssue,
  currentAnchorIds: ReadonlySet<string>,
): CanonicalSourceAnchor[] {
  if (!["source_anchor_mismatch", "explanation_gap", "other"].includes(issue.type)) return [];
  const sourceIds = new Set(
    [...currentAnchorIds]
      .map((id) => state.sourceAnchors[id]?.sourceId)
      .filter((id): id is string => typeof id === "string" && !!id),
  );
  if (sourceIds.size === 0) return [];
  const terms = reanchorTerms(`${issue.problem} ${issue.expected} ${issue.evidence}`);
  if (terms.length === 0) return [];
  const scored = Object.values(state.sourceAnchors)
    .filter((anchor) =>
      anchor.kind !== "figure" &&
      typeof anchor.exactText === "string" && anchor.exactText.length > 0 && anchor.exactText.length <= 8_000 &&
      anchor.sourceId !== undefined &&
      sourceIds.has(anchor.sourceId) &&
      !currentAnchorIds.has(anchor.id),
    )
    .map((anchor) => {
      const haystack = `${anchor.title} ${anchor.exactText ?? ""} ${(anchor.conceptKeywords ?? []).join(" ")}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { anchor, score };
    })
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || (a.anchor.page ?? 0) - (b.anchor.page ?? 0));
  let chars = 0;
  return scored.filter(({ anchor }) => {
    const length = anchor.exactText!.length;
    if (chars + length > 36_000) return false;
    chars += length;
    return true;
  }).slice(0, REANCHOR_CANDIDATE_LIMIT).map((entry) => entry.anchor);
}

function buildModelRepairInput(state: FinalGardenState, gardenDir: string, request: ArtifactRepairRequest, issue: CriticIssue): ModelRepairInput {
  const abs = request.targetPath ? path.join(gardenDir, request.targetPath) : undefined;
  const wholeFile = abs && fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : undefined;
  // Ask for the units that changed rather than a file the model will not
  // return. See mergePartialLearningUnitContract for why 198 KB is past what
  // this repair can get back.
  const scoped = scopedLearningUnitContractRepair(request, wholeFile, state, issue);
  const currentMarkdown = scoped?.currentMarkdown ?? wholeFile;
  const targetPage = request.targetPath
    ? state.pages.find((page) => page.rel === request.targetPath)
    : undefined;
  const learningUnitContract = targetPage
    ? state.learningUnitContract.units.find((unit) => unit.id === targetPage.learningUnitId)
    : undefined;
  const anchorIds = new Set(request.affectedAnchorIds ?? issue.sourceAnchorIds ?? []);
  if (learningUnitContract) {
    for (const anchorId of learningUnitContract.sourceAnchors) anchorIds.add(anchorId);
    for (const artifact of learningUnitContract.sourceFigures) anchorIds.add(artifact.id);
    for (const artifact of learningUnitContract.sourceFormulas) anchorIds.add(artifact.id);
    for (const artifact of learningUnitContract.sourceTables) anchorIds.add(artifact.id);
    for (const concept of learningUnitContract.semanticConcepts ?? []) {
      for (const anchorId of concept.evidenceAnchors) anchorIds.add(anchorId);
    }
    for (const claim of learningUnitContract.knowledgeClaims ?? []) {
      for (const anchorId of claim.evidenceAnchors) anchorIds.add(anchorId);
      for (const anchorId of claim.derivationAnchors ?? []) anchorIds.add(anchorId);
    }
  }
  const relevantAnchors = Object.values(state.sourceAnchors).filter((a) => anchorIds.has(a.id));
  const reanchorOptions = reanchorCandidates(state, issue, anchorIds);
  const adj = request.targetPath ? adjacentPageSummaries(state, request.targetPath) : {};
  return {
    issue,
    repairRequest: request,
    finalGardenStateExcerpt: { pages: state.pages.length, anchors: Object.keys(state.sourceAnchors).length },
    currentMarkdown,
    learningUnitContract,
    sourceAnchors: relevantAnchors.length ? relevantAnchors : undefined,
    reanchorCandidates: reanchorOptions.length ? reanchorOptions : undefined,
    previousPageSummary: adj.previous,
    nextPageSummary: adj.next,
    scopedLearningUnitIds: scoped?.unitIds,
  };
}

/** Write and validate a model repair candidate; reverts if it breaks the state. */
function fmArrayFromMarkdown(markdown: string, key: string): string[] {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const match = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
  if (!match) return [];
  return (match[1] ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function modelMarkdownHasInvalidAnchorLabels(markdown: string): boolean {
  for (const key of ["sourceAnchors", "sourceFormulaAnchors"]) {
    const values = fmArrayFromMarkdown(markdown, key);
    if (sanitizeSourceAnchorIds(values).rejectedLabels.length > 0) return true;
  }
  const blocks = markdown.match(/```breadboard-visual\r?\n[\s\S]*?\r?\n```/g) ?? [];
  for (const block of blocks) {
    const raw = block.replace(/^```breadboard-visual\r?\n/, "").replace(/\r?\n```$/, "");
    try {
      if (modelJsonHasInvalidAnchorLabels(JSON.parse(raw))) return true;
    } catch {
      // Invalid visual JSON is handled by the normal parse/build path.
    }
  }
  return false;
}

function modelJsonHasInvalidAnchorLabels(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const spec = value as Record<string, unknown>;
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  for (const item of anchors) {
    if (typeof item === "string" && sanitizeSourceAnchorIds([item]).rejectedLabels.length > 0) return true;
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of ["figureId", "tableId", "equationId", "questionId", "textAnchorId"]) {
      const raw = typeof record[key] === "string" ? String(record[key]).trim() : "";
      if (raw && sanitizeSourceAnchorIds([raw]).rejectedLabels.length > 0) return true;
    }
  }
  return false;
}

function markdownFrontmatterKeys(markdown: string): Set<string> {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return new Set(
    fm
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );
}

function introducedAuditProblems(before: FinalAuditResult | null, after: FinalAuditResult): string[] {
  if (!before) return [];
  const existing = new Set(before.problems);
  return after.problems.filter((problem) => !existing.has(problem));
}

interface ModelRepairApplicationResult {
  accepted: boolean;
  feedback: string[];
}

function normalizeModelCandidateValidation(
  result: boolean | ModelCandidateValidationResult,
): ModelCandidateValidationResult {
  if (typeof result === "boolean") return { passed: result };
  if (result && typeof result.passed === "boolean") {
    return {
      passed: result.passed,
      problems: (result.problems ?? []).map((problem) => String(problem).trim()).filter(Boolean),
    };
  }
  return { passed: false, problems: ["candidate validator returned an invalid result"] };
}

/**
 * Accept a contract repair that returns only the learning units it changed.
 *
 * The learning-unit contract is the one repair target too large to echo back.
 * telecom-1's is 197,617 characters, and at that size the ChatGPT web model
 * does not reply with the file at all: on 2026-09-15 it wrote the content to
 * its own sandbox and answered with a `sandbox:/mnt/data/...` link, and on
 * 2026-09-18 it simply returned nothing, twice, which no retry can fix. The
 * units are 80% of the file and carry stable ids, so a repair can send back
 * just the ones it rewrote - about 5 KB instead of 198 KB - and they are
 * merged here by id.
 *
 * Deliberately narrow: this only engages for the contract, only when the
 * candidate contains `learningUnits` and nothing else, and only for ids the
 * contract already has. A whole-file candidate, any other JSON target, and an
 * unparseable baseline all pass through exactly as before, so the change
 * cannot silently accept a partial write anywhere it was not intended.
 */
function mergePartialLearningUnitContract(
  targetPath: string,
  before: string | null,
  revised: unknown,
): { value: unknown; problem?: string } {
  if (!/learning-unit-contract\.json$/i.test(targetPath) || before === null) return { value: revised };
  if (!revised || typeof revised !== "object" || Array.isArray(revised)) return { value: revised };
  const candidate = revised as Record<string, unknown>;
  const units = candidate.learningUnits;
  if (!Array.isArray(units) || Object.keys(candidate).some((key) => key !== "learningUnits")) {
    return { value: revised };
  }
  let current: Record<string, unknown>;
  try {
    current = JSON.parse(before) as Record<string, unknown>;
  } catch {
    return { value: revised, problem: "the contract being repaired is not valid JSON, so a partial candidate cannot be merged" };
  }
  const currentUnits = current.learningUnits;
  if (!Array.isArray(currentUnits)) {
    return { value: revised, problem: "the contract being repaired has no learningUnits array to merge into" };
  }
  const replacements = new Map<string, unknown>();
  for (const unit of units) {
    const id = (unit as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id) {
      return { value: revised, problem: "a returned learning unit has no id, so it cannot be matched to the contract" };
    }
    if (!currentUnits.some((existing) => (existing as { id?: unknown } | null)?.id === id)) {
      return { value: revised, problem: `the candidate returns learning unit ${id}, which the contract does not contain` };
    }
    replacements.set(id, unit);
  }
  if (replacements.size === 0) return { value: revised, problem: "the candidate returned no learning units" };
  return {
    value: {
      ...current,
      learningUnits: currentUnits.map((existing) => {
        const id = (existing as { id?: unknown } | null)?.id;
        return typeof id === "string" && replacements.has(id) ? replacements.get(id) : existing;
      }),
    },
  };
}

function applyModelRepairOutput(
  gardenDir: string,
  gardenSlug: string,
  out: ModelRepairOutput,
  validateCandidate?: ModelCandidateValidator,
  reanchor?: UnitReanchorCandidate,
): ModelRepairApplicationResult {
  const abs = path.join(gardenDir, out.targetPath);
  const reject = (...feedback: string[]): ModelRepairApplicationResult => ({
    accepted: false,
    feedback: feedback.map((problem) => String(problem).trim()).filter(Boolean),
  });
  if (!fs.existsSync(path.dirname(abs))) return reject(`target directory does not exist: ${path.dirname(out.targetPath)}`);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
  if (reanchor && fs.readFileSync(path.join(gardenDir, ".breadboard/learning-unit-contract.json"), "utf-8") !== reanchor.contractBefore) {
    return reject("Learning unit contract changed while the re-anchor candidate was being authored.");
  }
  const restore = (): void => {
    if (before !== null) fs.writeFileSync(abs, before, "utf-8");
    else fs.rmSync(abs, { force: true });
    if (reanchor) fs.writeFileSync(path.join(gardenDir, ".breadboard/learning-unit-contract.json"), reanchor.contractBefore, "utf-8");
  };
  let beforeAudit: FinalAuditResult | null = null;
  try {
    beforeAudit = auditFinalGardenState(buildFinalGardenState(gardenDir, gardenSlug));
  } catch {
    // A partial legacy garden may not yet have an auditable baseline. The
    // post-write parse boundary below still applies in that case.
  }
  if (out.revisedMarkdown !== undefined) {
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(out.revisedMarkdown)) return reject("candidate markdown is missing its YAML frontmatter block");
    if (modelMarkdownHasInvalidAnchorLabels(out.revisedMarkdown)) return reject("candidate introduces an invalid source-anchor label");
    if (before !== null && out.revisedMarkdown.trim() === before.trim()) return reject("candidate is unchanged from the current target file");
    if (before !== null) {
      const revisedKeys = markdownFrontmatterKeys(out.revisedMarkdown);
      for (const key of markdownFrontmatterKeys(before)) {
        if (!revisedKeys.has(key)) return reject(`candidate removed required frontmatter key: ${key}`);
      }
    }
    fs.writeFileSync(abs, out.revisedMarkdown.endsWith("\n") ? out.revisedMarkdown : `${out.revisedMarkdown}\n`, "utf-8");
  } else if (out.revisedJson !== undefined) {
    if (modelJsonHasInvalidAnchorLabels(out.revisedJson)) return reject("candidate introduces an invalid source-anchor label");
    const merged = mergePartialLearningUnitContract(out.targetPath, before, out.revisedJson);
    if (merged.problem) return reject(merged.problem);
    fs.writeFileSync(abs, `${JSON.stringify(merged.value, null, 2)}\n`, "utf-8");
  } else {
    return reject("candidate contains neither revisedMarkdown nor revisedJson");
  }
  try {
    if (reanchor) fs.writeFileSync(path.join(gardenDir, ".breadboard/learning-unit-contract.json"), reanchor.contractAfter, "utf-8");
    const afterState = buildFinalGardenState(gardenDir, gardenSlug);
    const afterAudit = auditFinalGardenState(afterState);
    const feedback = introducedAuditProblems(beforeAudit, afterAudit).map(
      (problem) => `candidate introduced final-state audit problem: ${problem}`,
    );
    if (reanchor && declinedLessonMatches(out.revisedMarkdown ?? "", {
      title: String(reanchor.unit.title ?? ""), learningQuestion: String(reanchor.unit.learningQuestion ?? ""),
    }).length) feedback.push("Re-anchored candidate still declines to teach its learning objective.");
    if (reanchor) {
      const page = afterState.pages.find((entry) => entry.rel === out.targetPath);
      const expected = reanchor.unit.sourceAnchors as string[];
      if (!page || expected.some((id) => !page.sourceAnchors.includes(id)) || page.sourceAnchors.some((id) => !expected.includes(id))) {
        feedback.push("Re-anchored page sourceAnchors must match the revised unit bindings.");
      }
    }
    if (validateCandidate) {
      const validation = normalizeModelCandidateValidation(validateCandidate(gardenDir, gardenSlug));
      if (!validation.passed) {
        feedback.push(
          ...(validation.problems?.length
            ? validation.problems.map((problem) => `candidate failed final-export validation: ${problem}`)
            : ["candidate failed final-export validation"]),
        );
      }
    }
    if (feedback.length > 0) {
      restore();
      return reject(...feedback);
    }
    return { accepted: true, feedback: [] };
  } catch (error) {
    restore();
    return reject(`candidate validation threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applyTargetedDeterministicRepair(gardenDir: string, gardenSlug: string, req: ArtifactRepairRequest): TargetedRepairSummary {
  const changed: string[] = [];
  const notes: string[] = [];
  let attempted = false;
  let resolved = false;
  const mark = (rel: string): void => { if (rel && !changed.includes(rel)) changed.push(rel); };

  for (const spec of req.formulaKindRepairs ?? []) {
    attempted = true;
    const out = repairCriticWorkedExampleMisclassification(gardenDir, gardenSlug, {
      pagePath: spec.pagePath ?? req.targetPath,
      formulaIndex: spec.formulaIndex,
      sourceAnchorIds: spec.sourceAnchorIds?.length ? spec.sourceAnchorIds : req.affectedAnchorIds,
      evidence: spec.evidence,
    });
    out.changed.forEach(mark);
    notes.push(...out.notes);
    resolved = resolved || out.resolved;
  }

  for (const spec of req.textAnchorExactTextRepairs ?? []) {
    attempted = true;
    const out = repairCriticSourceAnchorExactText(gardenDir, gardenSlug, {
      sourceAnchorIds: spec.anchorIds.length ? spec.anchorIds : req.affectedAnchorIds,
      pagePath: spec.pagePath ?? req.targetPath,
      evidence: spec.evidence,
      problem: spec.problem,
    });
    out.changed.forEach(mark);
    notes.push(...out.notes);
    resolved = resolved || out.resolved;
  }

  return { attempted, resolved, changed, notes };
}

interface TargetedRepairSummary {
  attempted: boolean;
  resolved: boolean;
  changed: string[];
  notes: string[];
}

/** Production repair. Legacy callers may retain deterministic mechanical
 * repair; active Learn disables it so a model rejection remains a blocker. */
export function makeCriticArtifactRepair(opts: {
  modelRepair?: ModelRepairFn;
  deterministicFinalize?: (gardenDir: string, gardenSlug: string) => void;
  /** Optional production hard gate for the complete export contract. Active
   * Learn supplies the same strict formula/visual audit used before promotion,
   * so a semantic repair cannot introduce a later finalization failure. */
  validateModelCandidate?: ModelCandidateValidator;
  /** Number of distinct candidates allowed for one critic target. Attempts after
   * the first receive the exact rejection findings and use a fresh request
   * payload. The default remains one for backward-compatible callers. */
  maxModelCandidateAttempts?: number;
  allowDeterministicRepairs?: boolean;
} = {}): ArtifactRepairFn {
  const allowDeterministicRepairs = opts.allowDeterministicRepairs !== false;
  const maxModelCandidateAttempts = Math.max(1, Math.floor(opts.maxModelCandidateAttempts ?? 1));
  const reanchorAttemptedUnits = new Set<string>();
  const finalize = opts.deterministicFinalize ?? ((gardenDir: string, gardenSlug: string) => {
    try { finalizeGardenExport({ gardenDir, gardenSlug }); }
    catch { try { reconcileFinalGardenState(gardenDir, gardenSlug); } catch { /* best effort */ } }
  });
  return async (gardenDir, gardenSlug, requests, ctx) => {
    const provenance: RepairProvenanceRecord[] = [];
    const handledByModel = new Set<string>();
    if (allowDeterministicRepairs) {
      for (const req of requests) {
        const targeted = applyTargetedDeterministicRepair(gardenDir, gardenSlug, req);
        if (!targeted.attempted || targeted.changed.length === 0) continue;
        provenance.push({
          requestId: req.id,
          targetKind: req.targetKind,
          targetPath: req.targetPath,
          executorAttempted: ["deterministic"],
          executorUsed: "deterministic",
          changed: true,
        });
        handledByModel.add(req.id);
      }
    }
    if (opts.modelRepair) {
      for (const req of requests) {
        if (allowDeterministicRepairs && !requestIsModelFirst(req, ctx.issuesById)) continue;
        if (handledByModel.has(req.id)) continue;
        const issue = ctx.issuesById?.get(req.issueIds[0]);
        if (!issue) continue;
        const state = buildFinalGardenState(gardenDir, gardenSlug);
        const attempted: Array<"model" | "deterministic"> = ["model"];
        let used: RepairProvenanceRecord["executorUsed"] = "none";
        let modelFailureReason: string | undefined;
        let changed = false;
        let modelCandidateAttempts = 0;
        let modelValidationFeedback: string[] = [];
        // A thrown provider/model request is not semantic evidence and cannot
        // authorize another critic round. Preserve the exact thrown object by
        // allowing it to escape this repair boundary unchanged.
        let baseInput = buildModelRepairInput(state, gardenDir, req, issue);
        let reanchor: UnitReanchorCandidate | undefined;
        let reanchorRecord: RepairProvenanceRecord["reanchor"];
        const reanchorUnitId = (baseInput.learningUnitContract as { id?: string } | undefined)?.id;
        if (req.targetKind === "unit_page" && reanchorUnitId && !reanchorAttemptedUnits.has(reanchorUnitId) && baseInput.reanchorCandidates?.length) {
          reanchorAttemptedUnits.add(reanchorUnitId);
          reanchorRecord = { attempted: true, applied: false };
          const contractPath = ".breadboard/learning-unit-contract.json";
          const unitId = reanchorUnitId;
          const contractBefore = fs.readFileSync(path.join(gardenDir, contractPath), "utf-8");
          const authoredUnit = JSON.parse(contractBefore).learningUnits?.find((unit: { id: string }) => unit.id === unitId);
          // One evidence-selection call per target, followed by the existing
          // bounded page candidates. No full re-plan and no policy mutation.
          const proposal = await opts.modelRepair({
            ...baseInput, repairStage: "reanchor", scopedLearningUnitIds: [unitId], learningUnitContract: authoredUnit,
            repairRequest: { ...req, targetKind: "learning_unit_contract", targetPath: contractPath },
          });
          if (proposal) {
            try {
              if (proposal.targetPath !== contractPath) throw new Error("Re-anchor candidate changed its target path.");
              reanchor = prepareUnitReanchor(contractBefore, unitId, proposal.revisedJson, baseInput.reanchorCandidates.map((a) => a.id));
              const ids = reanchor.unit.sourceAnchors as string[];
              reanchorRecord.anchorIds = ids;
              baseInput = { ...baseInput, repairStage: "page", learningUnitContract: reanchor.unit,
                sourceAnchors: Object.values(state.sourceAnchors).filter((anchor) => ids.includes(anchor.id)), reanchorCandidates: undefined };
            } catch (error) {
              reanchorRecord.problem = error instanceof Error ? error.message : String(error);
            }
          } else reanchorRecord.problem = "No supported re-anchoring selected from the bounded candidates.";
        }
        for (let candidateAttempt = 1; candidateAttempt <= maxModelCandidateAttempts; candidateAttempt += 1) {
          modelCandidateAttempts = candidateAttempt;
          const out = await Promise.resolve(opts.modelRepair({
            ...baseInput,
            candidateAttempt,
            priorCandidateValidationFeedback: candidateAttempt > 1 ? modelValidationFeedback : undefined,
          }));
          if (!out) {
            if (!allowDeterministicRepairs) {
              throw new Error(
                `Model repair for ${req.targetPath ?? req.id} returned no nonempty candidate; no semantic retry was issued.`,
              );
            }
            modelFailureReason = "model returned no valid candidate";
            break;
          }
          const application = out.targetPath !== req.targetPath
            ? { accepted: false, feedback: ["candidate changed the requested target path"] }
            : applyModelRepairOutput(
            gardenDir,
            gardenSlug,
            out,
            opts.validateModelCandidate,
            reanchor,
          );
          if (application.accepted) {
            if (reanchorRecord) reanchorRecord.applied = Boolean(reanchor);
            used = "model";
            changed = true;
            break;
          }
          modelValidationFeedback = application.feedback;
          modelFailureReason = `returned model candidate failed target or safety validation${
            modelValidationFeedback.length ? `: ${modelValidationFeedback.join("; ")}` : ""
          }`;
        }
        if (!changed && allowDeterministicRepairs) attempted.push("deterministic");
        provenance.push({
          requestId: req.id,
          targetKind: req.targetKind,
          targetPath: req.targetPath,
          executorAttempted: attempted,
          executorUsed: used,
          modelFailureReason,
          modelCandidateAttempts,
          modelValidationFeedback: modelValidationFeedback.length ? modelValidationFeedback : undefined,
          reanchor: reanchorRecord,
          changed,
        });
        handledByModel.add(req.id);
      }
    }
    if (allowDeterministicRepairs) {
      finalize(gardenDir, gardenSlug);
      for (const p of provenance) {
        if (p.executorUsed === "none") p.executorUsed = "deterministic";
      }
    }
    for (const req of requests) {
      if (handledByModel.has(req.id)) continue;
      provenance.push({
        requestId: req.id,
        targetKind: req.targetKind,
        targetPath: req.targetPath,
        executorAttempted: allowDeterministicRepairs ? ["deterministic"] : [],
        executorUsed: allowDeterministicRepairs ? "deterministic" : "none",
        changed: allowDeterministicRepairs,
      });
    }
    return { attempted: requests.length, resolved: 0, provenance };
  };
}

/** Backward-compatible default: deterministic finalization only (no model). */
export function makeDefaultArtifactRepair(): ArtifactRepairFn {
  return makeCriticArtifactRepair();
}

/** Give explicit objective refusals one repair opportunity before strict export
 * validation would stop the run. Each unit is attempted once; export remains
 * the hard gate and the semantic critic still reviews the resulting lesson. */
export async function repairDeclinedLearningObjectives(args: {
  gardenDir: string; gardenSlug: string; modelRepair: ModelRepairFn;
  validateModelCandidate?: ModelCandidateValidator;
}): Promise<CriticRepairOutcome> {
  const state = buildFinalGardenState(args.gardenDir, args.gardenSlug);
  const issues: CriticIssue[] = [];
  for (const page of state.pages) {
    const unit = state.learningUnitContract.units.find((entry) => entry.id === page.learningUnitId);
    if (!unit || !page.rel.startsWith("learning/")) continue;
    const raw = fs.readFileSync(path.join(args.gardenDir, page.rel), "utf-8");
    const refusals = declinedLessonMatches(raw, { title: unit.title, learningQuestion: unit.learningQuestion });
    if (!refusals.length) continue;
    issues.push({ id: `${unit.id}-declined-learning-objective`, severity: "blocking", type: "source_anchor_mismatch",
      pagePath: page.rel, sourceAnchorIds: unit.sourceAnchors, repairTarget: "unit_page",
      problem: `The lesson declines to answer its learning question: ${unit.learningQuestion}`,
      evidence: refusals.map((entry) => entry.snippet).join("\n"), expected: unit.learningQuestion,
      suggestedRepair: "Check canonical evidence for a bounded unit re-anchor, then teach the original objective. Missing assigned evidence is not proof that the selected sources lack it.",
    });
  }
  if (!issues.length) return { attempted: 0, resolved: 0, provenance: [] };
  const repair = makeCriticArtifactRepair({ modelRepair: args.modelRepair, validateModelCandidate: args.validateModelCandidate, allowDeterministicRepairs: false, maxModelCandidateAttempts: 2 });
  const result = await repair(args.gardenDir, args.gardenSlug, criticIssuesToRepairRequests(issues, state), {
    round: 0, issuesById: new Map(issues.map((issue) => [issue.id, issue])),
  });
  fs.writeFileSync(path.join(args.gardenDir, ".breadboard/declined-objective-repairs.json"), `${JSON.stringify({ issues, ...result }, null, 2)}\n`);
  return result;
}

// ---------------------------------------------------------------------------
// Issue-resolution tracking (direct, not inferred from count drops)
// ---------------------------------------------------------------------------

function issueTargetKey(i: CriticIssue): string {
  return `${i.repairTarget}::${i.pagePath ?? i.sectionPath ?? i.visualId ?? ""}`;
}

/** Match previous-round issues against the next round's issues to classify each
 *  as resolved / still_present / replaced_by_new_issue. */
export function computeIssueResolutions(
  previous: CriticIssue[],
  next: CriticIssue[],
  requestsByIssueId?: Map<string, string>,
): CriticIssueResolution[] {
  const nextByTarget = new Map<string, CriticIssue[]>();
  for (const c of next) {
    const key = issueTargetKey(c);
    (nextByTarget.get(key) ?? nextByTarget.set(key, []).get(key)!).push(c);
  }
  return previous.map((p) => {
    const base = { issueId: p.id, originalIssue: p, repairRequestId: requestsByIssueId?.get(p.id) };
    if (next.some((c) => c.id === p.id)) return { ...base, status: "still_present", evidence: p.evidence };
    const sameTypeTarget = next.find((c) => c.type === p.type && issueTargetKey(c) === issueTargetKey(p));
    if (sameTypeTarget) return { ...base, status: "still_present", evidence: sameTypeTarget.evidence };
    const sameTargetDiffType = (nextByTarget.get(issueTargetKey(p)) ?? []).find((c) => c.type !== p.type);
    if (sameTargetDiffType) return { ...base, status: "replaced_by_new_issue", evidence: sameTargetDiffType.problem };
    return { ...base, status: "resolved" };
  });
}

// ---------------------------------------------------------------------------
// The critic loop
// ---------------------------------------------------------------------------

export interface RunCriticLoopArgs {
  gardenDir: string;
  gardenSlug: string;
  critic: CriticFn;
  /** ChatMock anchor-confirmation critic for low-confidence source anchors. When
   *  absent, low-confidence anchors remain blocking (still surfaced as issues). */
  anchorConfirm?: AnchorCriticFn;
  options?: Partial<CriticLoopOptions>;
  repair?: ArtifactRepairFn;
  deterministicPass?: boolean;
  /**
   * Blocking issues a person has read and accepted for this garden.
   *
   * Strict publish otherwise requires an empty blocking set, which is right:
   * an unreviewed blocker must stop a publication. But some findings are
   * true and not worth another day of regeneration - telecom-1 ended with two
   * units whose evidence does not cover everything they teach, correctly
   * flagged, in a module whose other 29 lessons are clean (2026-09-18). An
   * accepted residue is that judgement made explicitly: named issue ids, held
   * in the garden, still reported and still listed in the critic record. It
   * never silences a finding - it only stops one holding publication.
   */
  acceptedResidueIssueIds?: string[];
  acceptedResiduePolicy?: CriticPolicySnapshot;
  /** True when finalize reported a structural/critical problem (draft may be
   *  unusable); drives the publish_failed_structural lifecycle. */
  structuralFailure?: boolean;
  writeReports?: boolean;
  /**
   * Fix 2: FINALIZATION enforcement. When true (the production pipeline, which
   * migrates legacy anchors BEFORE the loop), any legacy text_concept record that
   * remains unresolved in the FINAL ledger blocks publish-readiness, derived
   * directly from the ledger (never from a migration report). Left false for
   * loop-mechanics unit tests that feed a non-final (un-migrated) garden.
   */
  enforceLegacyFinalization?: boolean;
}

function finalizeStatus(args: {
  draftGenerated: boolean;
  deterministicPass: boolean;
  structuralFailure: boolean;
  strictPublish: boolean;
  criticEnabled: boolean;
  criticRan: boolean;
  criticErrored: boolean;
  criticErrorMessage?: string;
  blocking: CriticIssue[];
  warnings: CriticIssue[];
  roundsUsed: number;
  unresolvedLowConfidenceAnchors: number;
}): GardenAcceptanceStatus {
  const availability: CriticAvailabilityStatus = !args.criticEnabled
    ? "disabled"
    : args.criticErrored
      ? (args.criticRan ? "errored" : "unavailable")
      : "available";
  const criticAvailable = availability === "available";
  // In strict mode the critic is REQUIRED for publish-readiness, whether it is
  // disabled, unreachable, or errored.
  const criticRequired = args.strictPublish;
  const criticPass = args.criticRan && !args.criticErrored && args.blocking.length === 0;

  const publishReady = args.structuralFailure
    ? false
    : args.strictPublish
      ? args.deterministicPass && args.criticRan && criticPass && args.blocking.length === 0
      : args.deterministicPass;

  const lifecycleStatus: GardenLifecycleStatus = args.structuralFailure
    ? "publish_failed_structural"
    : publishReady
      ? "publish_ready"
      : "needs_review";

  const reason = args.structuralFailure
    ? "publish_failed_structural"
    : args.unresolvedLowConfidenceAnchors > 0 && !criticAvailable
      ? "critic_unavailable_with_unresolved_anchor"
      : !args.deterministicPass
        ? (args.unresolvedLowConfidenceAnchors > 0 ? "unresolved_low_confidence_anchor" : "deterministic_validation_failed")
        : publishReady
          ? undefined
          : !criticAvailable
            ? "critic_unavailable"
            : args.unresolvedLowConfidenceAnchors > 0
              ? "unresolved_low_confidence_anchor"
              : "unresolved_critic_issues";

  return {
    draftGenerated: args.draftGenerated,
    accepted: publishReady,
    publishReady,
    lifecycleStatus,
    deterministicPass: args.deterministicPass,
    criticRequired,
    criticAvailable,
    criticRan: args.criticRan,
    criticPass,
    criticAvailabilityStatus: availability,
    criticUnavailableReason: criticAvailable || !args.criticEnabled ? undefined : (args.criticErrorMessage ?? "critic did not run"),
    unresolvedBlockingIssues: args.blocking,
    warnings: args.warnings,
    repairRoundsUsed: args.roundsUsed,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Fix 12/13/14: ONE canonical acceptance decision derived from the SAME rebuilt,
// post-migration FinalGardenState. Deterministic failures take precedence over
// critic availability; critic unavailability is reported separately, never as a
// substitute for a deterministic failure. Every report reads these same counts.
// ---------------------------------------------------------------------------

export type FinalAcceptancePrimaryReason =
  | "accepted"
  | "deterministic_validation_failed"
  | "verified_critic_blockers"
  | "critic_unavailable_with_unresolved_semantic_issues"
  | "repair_budget_exhausted";

export interface FinalAcceptanceDecision {
  draftGenerated: boolean;
  deterministicPass: boolean;
  criticRan: boolean;
  criticAvailable: boolean;
  criticPass: boolean;
  accepted: boolean;
  publishReady: boolean;
  lifecycleStatus: GardenLifecycleStatus;
  primaryReason: FinalAcceptancePrimaryReason;
  deterministicBlockers: CriticIssue[];
  verifiedCriticBlockers: CriticIssue[];
  verifiedWarnings: CriticIssue[];
  criticAvailabilityProblem?: string;
  deterministicBlockerCount: number;
  verifiedCriticBlockerCount: number;
  verifiedWarningCount: number;
}

const DETERMINISTIC_ANCHOR_EVIDENCE_RULE = "anchor_evidence";

/** Collect ALL deterministic anchor/graph blockers from the rebuilt final state:
 *  missing canonical anchors, dangling embedded-visual anchors, incomplete
 *  replacement closure, and legacy-migration persistence failures. Low-confidence
 *  anchor evidence is EXCLUDED here — it is a critic-resolvable issue, surfaced
 *  through the anchor-evidence critic path, not a hard deterministic failure. */
export function collectDeterministicBlockers(state: FinalGardenState, opts?: { includeLegacy?: boolean }): CriticIssue[] {
  const out: CriticIssue[] = [];
  const seen = new Set<string>();
  const push = (type: CriticIssueType, problem: string, target: CriticRepairTarget): void => {
    if (seen.has(problem)) return;
    seen.add(problem);
    out.push({ id: `det-${createHash("sha1").update(problem).digest("hex").slice(0, 12)}`, severity: "blocking", type, pagePath: undefined, sourceAnchorIds: undefined, problem, evidence: problem, expected: "resolve deterministically (no dangling or legacy references)", repairTarget: target, suggestedRepair: "fix the source-anchor graph and re-run finalization" });
  };
  let audit: FinalAuditResult | undefined;
  try { audit = auditFinalGardenState(state); } catch { audit = undefined; }
  if (audit) {
    const evidenceProblems = new Set(audit.byRule[DETERMINISTIC_ANCHOR_EVIDENCE_RULE] ?? []);
    for (const p of audit.problems) if (!evidenceProblems.has(p)) push("source_anchor_mismatch", p, "source_anchor_ledger");
  }
  try { for (const p of auditCanonicalRegistryIntegrity(state).problems) push("source_anchor_mismatch", p, "source_anchor_ledger"); } catch { /* ignore */ }
  // Legacy-persistence is a FINALIZATION concern (opt-in), matching the pipeline's
  // enforceLegacyFinalization gate — un-migrated loop-mechanics gardens are not
  // penalized for grandfathered numeric anchors.
  if (opts?.includeLegacy !== false) {
    try { for (const p of auditLegacyAnchorsFromFinalLedger(state).problems) push("source_anchor_mismatch", p, "source_anchor_ledger"); } catch { /* ignore */ }
  }
  return out;
}

/**
 * Fix 12/13/14: compute the single canonical acceptance decision. `primaryReason`
 * follows the strict precedence: deterministic_validation_failed >
 * verified_critic_blockers > critic_unavailable_with_unresolved_semantic_issues >
 * repair_budget_exhausted > accepted.
 */
export function computeFinalAcceptanceDecision(
  state: FinalGardenState,
  args: {
    draftGenerated: boolean;
    strictPublish: boolean;
    criticRan: boolean;
    criticAvailable: boolean;
    criticAvailabilityProblem?: string;
    verifiedCriticBlockers: CriticIssue[];
    verifiedWarnings: CriticIssue[];
    repairBudgetExhausted?: boolean;
    includeLegacyAsDeterministic?: boolean;
  },
): FinalAcceptanceDecision {
  const deterministicBlockers = collectDeterministicBlockers(state, { includeLegacy: args.includeLegacyAsDeterministic !== false });
  const deterministicPass = deterministicBlockers.length === 0;
  const verifiedCriticBlockers = args.verifiedCriticBlockers;
  const verifiedWarnings = args.verifiedWarnings;
  const criticPass = args.criticRan && args.criticAvailable && verifiedCriticBlockers.length === 0;
  const semanticUnresolved = verifiedCriticBlockers.length > 0 || (args.strictPublish && !args.criticAvailable);

  const publishReady = args.draftGenerated
    && deterministicPass
    && verifiedCriticBlockers.length === 0
    && (args.strictPublish ? (args.criticRan && args.criticAvailable) : true);

  // Strict precedence — deterministic failures win over critic availability.
  const primaryReason: FinalAcceptancePrimaryReason = !deterministicPass
    ? "deterministic_validation_failed"
    : verifiedCriticBlockers.length > 0
      ? "verified_critic_blockers"
      : args.strictPublish && !args.criticAvailable && semanticUnresolved
        ? "critic_unavailable_with_unresolved_semantic_issues"
        : args.repairBudgetExhausted
          ? "repair_budget_exhausted"
          : "accepted";

  const lifecycleStatus: GardenLifecycleStatus = publishReady ? "publish_ready" : "needs_review";

  return {
    draftGenerated: args.draftGenerated,
    deterministicPass,
    criticRan: args.criticRan,
    criticAvailable: args.criticAvailable,
    criticPass,
    accepted: publishReady,
    publishReady,
    lifecycleStatus,
    primaryReason,
    deterministicBlockers,
    verifiedCriticBlockers,
    verifiedWarnings,
    criticAvailabilityProblem: args.criticAvailable ? undefined : args.criticAvailabilityProblem,
    deterministicBlockerCount: deterministicBlockers.length,
    verifiedCriticBlockerCount: verifiedCriticBlockers.length,
    verifiedWarningCount: verifiedWarnings.length,
  };
}

export async function runCriticLoop(args: RunCriticLoopArgs): Promise<CriticLoopResult> {
  const options: CriticLoopOptions = { ...DEFAULT_CRITIC_LOOP_OPTIONS, ...(args.options ?? {}) };
  const policyRecords: AcceptedCriticResidue[] = args.acceptedResiduePolicy?.records ??
    (args.acceptedResidueIssueIds ?? []).map((issueId) => ({ issueId }));
  const isAcceptedResidue = acceptedResidueMatcher(policyRecords.map((entry) => entry.issueId));
  const repair = args.repair ?? makeDefaultArtifactRepair();
  const rounds: CriticRoundRecord[] = [];
  const draftGenerated = fs.existsSync(path.join(args.gardenDir, "learning"));
  const detPass = () => args.deterministicPass ?? auditFinalGardenState(buildFinalGardenState(args.gardenDir, args.gardenSlug)).ok;

  const anchorCountNow = (): number => {
    try { return unresolvedLowConfidenceAnchorIds(buildFinalGardenState(args.gardenDir, args.gardenSlug)).length; }
    catch { return 0; }
  };

  // Every verified per-round issue occurrence, for latest-verdict-per-identity
  // finalization (Fix 4/5/6). Never keyed globally by issueId.
  const allInstances: VerifiedCriticIssueInstance[] = [];
  let finalResolution: FinalCriticIssueResolution | undefined;

  const finish = (blocking: CriticIssue[], warnings: CriticIssue[], criticRan: boolean, criticErrored: boolean, criticErrorMessage?: string): CriticLoopResult => {
    // Fix 4/5/6: final blockers/warnings come from the LATEST verified instance
    // per stable identity — NOT a global "ever-unsupported by issueId" filter. An
    // id whose latest occurrence is confirmed_blocking blocks even if an earlier
    // occurrence (different evidence) verified unsupported; conversely an id whose
    // latest occurrence is unsupported never leaks in as a blocker.
    //
    // Deterministic anchor-evidence issues are ground truth (not ChatMock-verified
    // through instances), so they pass through directly.
    const anchorBlocking = blocking.filter((i) => i.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX));
    const chatActive = [
      ...blocking.filter((i) => !i.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX)),
      ...warnings.filter((i) => i.severity === "warning" && !i.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX)),
    ];
    const resolution = resolveFinalCriticIssues(allInstances, chatActive, options.strictPublish);
    finalResolution = resolution;
    const allVerifiedBlocking = [...anchorBlocking, ...resolution.blockers];
    // An accepted residue is reported exactly like any other finding - it
    // simply no longer decides publication. It remains in acceptedResidues
    // and the policy report with the exact matching exception and reason.
    // Critic issue ids are not stable across runs: the same U19 finding came
    // back as "u19-step-graded-source-anchor-mismatch" one run and
    // "u19-step-graded-source-mismatch" the next (2026-09-18). An acceptance
    // keyed on the exact id therefore silently stops matching. What is stable
    // is the unit and the kind of finding, so an accepted residue matches on
    // the unit prefix of the id plus the issue type, with the exact id still
    // honoured when it does match.
    const acceptedResidues = allVerifiedBlocking.filter(isAcceptedResidue);
    const verifiedBlocking = allVerifiedBlocking.filter((issue) => !isAcceptedResidue(issue));
    const verifiedWarnings = resolution.warnings;
    const status = finalizeStatus({
      draftGenerated,
      deterministicPass: detPass(),
      structuralFailure: Boolean(args.structuralFailure),
      strictPublish: options.strictPublish,
      criticEnabled: options.enabled,
      criticRan,
      criticErrored,
      criticErrorMessage,
      blocking: verifiedBlocking,
      warnings: verifiedWarnings,
      roundsUsed: rounds.length,
      unresolvedLowConfidenceAnchors: anchorCountNow(),
    });
    // Fix 2 (FINALIZATION only): a garden that still carries unresolved legacy
    // text_concept records in its FINAL ledger is not publish-ready, derived
    // directly from the ledger and independent of any migration report. Applied
    // only when the caller (the production pipeline, which migrates first) opts
    // in; loop-mechanics unit tests feed non-final gardens and do not.
    if (args.enforceLegacyFinalization && status.publishReady) {
      let legacyRemaining = 0;
      try { legacyRemaining = auditLegacyAnchorsFromFinalLedger(buildFinalGardenState(args.gardenDir, args.gardenSlug)).legacyAnchors.length; }
      catch { legacyRemaining = 0; }
      if (legacyRemaining > 0) {
        status.publishReady = false;
        status.accepted = false;
        status.lifecycleStatus = "needs_review";
        status.reason = "unresolved_legacy_anchor";
      }
    }
    // Fix 12/13/14: one canonical acceptance decision from the rebuilt final
    // state. Deterministic blockers (missing anchors, dangling embedded visuals,
    // incomplete closure, legacy persistence) take precedence over critic
    // availability. Non-anchor-evidence verified critic blockers are the semantic
    // blockers; deterministic ones are computed from the state itself.
    // The canonical decision is ADDITIVE: it never loosens the loop status. It can
    // only ADD blocking (a hard deterministic failure the loop status missed) —
    // never flip a needs_review garden to publish_ready.
    let finalDecision: FinalAcceptanceDecision | undefined;
    try {
      const decisionState = buildFinalGardenState(args.gardenDir, args.gardenSlug);
      finalDecision = computeFinalAcceptanceDecision(decisionState, {
        draftGenerated,
        strictPublish: options.strictPublish,
        criticRan,
        criticAvailable: !criticErrored && criticRan,
        criticAvailabilityProblem: criticErrored ? (criticErrorMessage ?? "critic did not run") : undefined,
        verifiedCriticBlockers: resolution.blockers.filter((issue) => !isAcceptedResidue(issue)),
        verifiedWarnings: resolution.warnings,
        repairBudgetExhausted: totalAttempts >= options.maxTotalRepairAttempts,
        includeLegacyAsDeterministic: Boolean(args.enforceLegacyFinalization),
      });
      // A HARD deterministic failure (missing anchor / dangling / cycle / legacy)
      // must block publish and take precedence — but never override the loop's
      // own (narrower) publish decision when it already blocks.
      if (!finalDecision.deterministicPass && status.publishReady) {
        status.publishReady = false;
        status.accepted = false;
        status.lifecycleStatus = "needs_review";
        status.reason = "deterministic_validation_failed";
      }
    } catch { /* keep finalizeStatus result */ }

    const result: CriticLoopResult = {
      status,
      rounds,
      finalBlockingIssues: verifiedBlocking,
      finalWarnings: verifiedWarnings,
      finalResolution: resolution,
      finalDecision,
      ...(acceptedResidues.length ? { acceptedResidues } : {}),
      appliedAcceptancePolicy: {
        snapshot: args.acceptedResiduePolicy,
        effectiveMaxRounds: options.maxRounds,
        effectiveMeasurementReviewNewFindings: options.measurementReviewNewFindings ?? "block",
        matches: acceptedResidues.map((issue) => ({
          issue,
          exceptions: policyRecords.filter((entry) => acceptedResidueMatcher([entry.issueId])(issue)),
        })),
      },
      ...(demotedMeasurementFindings.length ? { demotedMeasurementFindings } : {}),
    };
    if (args.writeReports !== false) writeCriticReports(args.gardenDir, result);
    return result;
  };

  if (!options.enabled) return finish([], [], false, false);

  // Merge deterministic low-confidence anchor issues with the VERIFIED ChatMock
  // issues for a round. Every ChatMock issue is independently checked against the
  // full FinalGardenState; unsupported/insufficient-evidence issues are recorded
  // as false positives and never become blocking (Fix 3/5).
  const verifiedReview = (state: FinalGardenState, criticIssues: CriticIssue[], round: number) => {
    const verifications = criticIssues.map((i) => verifyCriticIssueAgainstFinalState(i, state));
    // Instances are keyed per-issue-per-round (with an evidence hash), NOT by
    // issueId, so the finalizer can take the latest verdict per stable identity.
    const instances = criticIssues.map((i, idx) => buildCriticIssueInstance(i, round, verifications[idx]));
    const verByIdx = new Map<CriticIssue, CriticIssueVerificationResult>(criticIssues.map((i, idx) => [i, verifications[idx]]));
    const kept = criticIssues.filter((i) => {
      const v = verByIdx.get(i);
      return v && (v.severity === "confirmed_blocking" || v.severity === "confirmed_warning");
    });
    const falsePositives = criticIssues
      .filter((i) => { const v = verByIdx.get(i); return v && (v.severity === "unsupported" || v.severity === "insufficient_evidence"); })
      .map((i) => ({ issue: i, verification: verByIdx.get(i)! }));
    const anchorIssues = anchorEvidenceCriticIssues(state);
    const merged = [...anchorIssues, ...kept];
    const seen = new Set<string>();
    const issues: CriticIssue[] = [];
    for (const issue of merged) { if (seen.has(issue.id)) continue; seen.add(issue.id); issues.push(issue); }
    return {
      issues,
      blocking: issues.filter((i) => i.severity === "blocking"),
      warnings: issues.filter((i) => i.severity === "warning"),
      verifications,
      instances,
      falsePositives,
      reportedIssues: criticIssues.length + anchorIssues.length,
    };
  };

  let totalAttempts = 0;
  let prevBlocking: CriticIssue[] | null = null;
  /** The previous round's blocking set and repair count, to detect a loop that
   * is repeating one attempt without moving. */
  let prevBlockingKey = "";
  let prevBlockingKeys = new Set<string>();
  let prevAttempted = 0;
  let prevRequestsByIssue = new Map<string, string>();
  let prevRoundIdx = -1;
  let endedClean = false;
  let lastBlocking: CriticIssue[] = [];
  let lastWarnings: CriticIssue[] = [];
  /** Stable across rounds: the unit and the kind of finding, not the
   * model-authored id, which drifts from round to round. */
  const stableKey = (item: CriticIssue) => `${criticIssueUnitToken(item.id) ?? item.id}:${item.type}`;
  /** Findings the measurement review raised for the first time and the
   * "warn" policy published as warnings; reported so nobody has to infer it. */
  const demotedMeasurementFindings: CriticIssue[] = [];

  const requireCriticIssues = (value: CriticIssue[] | null | undefined): CriticIssue[] => {
    if (!Array.isArray(value)) {
      throw new Error('Critic response validation failed: critic returned no structured "issues" array.');
    }
    return value;
  };

  for (let round = 1; round <= options.maxRounds; round += 1) {
    const state = buildFinalGardenState(args.gardenDir, args.gardenSlug);
    const packet = buildCriticReviewPacket(state);
    // The critic call is single-shot. Any provider, transport, cancellation, or
    // strict parsing exception crosses this boundary by exact identity; reports
    // are emitted only for completed reviews and can never replace that error.
    const criticIssues = requireCriticIssues(
      await Promise.resolve(args.critic(packet)),
    ).slice(0, options.maxIssuesPerRound);
    const review = verifiedReview(state, criticIssues, round);
    allInstances.push(...review.instances);
    // Keep accepted findings in the verified instances/report, but do not
    // spend repair rounds rewriting pages the operator deliberately accepted.
    const blocking = review.blocking.filter((issue) => !isAcceptedResidue(issue));
    const { warnings } = review;
    const verificationFields = {
      reportedIssues: review.reportedIssues,
      verifiedBlockingIssues: blocking.length,
      verifiedWarnings: warnings.length,
      unsupportedIssues: review.falsePositives.filter((f) => f.verification.severity === "unsupported").length,
      insufficientEvidenceIssues: review.falsePositives.filter((f) => f.verification.severity === "insufficient_evidence").length,
      issueVerifications: review.verifications,
      ...(review.falsePositives.length ? { falsePositives: review.falsePositives } : {}),
    };
    lastBlocking = review.blocking;
    lastWarnings = warnings;

    // Directly classify the previous round's issues against this fresh review.
    if (prevBlocking && prevRoundIdx >= 0) {
      const resolutions = computeIssueResolutions(prevBlocking, blocking, prevRequestsByIssue);
      rounds[prevRoundIdx].resolutions = resolutions;
      rounds[prevRoundIdx].repairsResolved = resolutions.filter((r) => r.status === "resolved").length;
    }

    if (blocking.length === 0) {
      rounds.push({ round, blockingIssues: 0, warnings: warnings.length, repairsAttempted: 0, repairsResolved: 0, issueTypes: [], resolutions: [], provenance: [], ...verificationFields });
      endedClean = true;
      break;
    }
    if (totalAttempts >= options.maxTotalRepairAttempts) {
      rounds.push({ round, blockingIssues: blocking.length, warnings: warnings.length, repairsAttempted: 0, repairsResolved: 0, issueTypes: [...new Set(blocking.map((i) => i.type))], resolutions: [], provenance: [], ...verificationFields });
      break;
    }

    // Route low-confidence anchor issues to the anchor-confirmation critic; the
    // rest go to the generic (model-first) repair.
    const anchorBlocking = blocking.filter((i) => i.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX));
    const genericBlocking = blocking.filter((i) => !i.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX));

    let anchorDecisions: AppliedAnchorDecision[] = [];
    if (anchorBlocking.length > 0 && args.anchorConfirm) {
      // As above, a rejected request or terminal protocol failure escapes
      // unchanged and stops the loop before another anchor/prose model call.
      anchorDecisions = await applyAnchorDecisions(args.gardenDir, args.gardenSlug, args.anchorConfirm, state);
      // Rebuild derived artifacts + evidence report after applying decisions.
      try { reconcileFinalGardenState(args.gardenDir, args.gardenSlug); } catch { /* best effort */ }
    }

    // Fix 6: rejected (unsupported) anchors become targeted page-repair requests
    // so model repair can reground/revise the page. If model repair is
    // unavailable they simply do not resolve and the anchor stays blocking.
    const rejectedRequests: ArtifactRepairRequest[] = anchorDecisions
      .filter((d) => d.decision === "reject")
      .flatMap((d) => (d.rejectedRepairRequests ?? [])
        .filter((rr) => rr.targetKind === "unit_page")
        .flatMap((rr) => rr.affectedPages.map((pagePath, idx) => ({
          id: `reject-${rr.rejectedAnchorId}-${idx}`,
          issueIds: [`${ANCHOR_EVIDENCE_ISSUE_PREFIX}${rr.rejectedAnchorId}`],
          targetKind: "unit_page" as CriticRepairTarget,
          targetPath: pagePath,
          affectedAnchorIds: [rr.rejectedAnchorId],
          instructions: rr.instructions,
          evidence: [`Rejected unsupported anchor ${rr.rejectedAnchorId}; reground or revise this page.`],
        }))));

    const requestsByIssue = new Map<string, string>();
    let outcome: CriticRepairOutcome = { attempted: 0, resolved: 0, provenance: [] };
    const genericRequests = genericBlocking.length > 0
      ? criticIssuesToRepairRequests(genericBlocking, state)
      : [];
    const allRequests = [...genericRequests, ...rejectedRequests].slice(0, options.maxTotalRepairAttempts - totalAttempts);
    if (allRequests.length > 0) {
      const issuesById = new Map(blocking.map((i) => [i.id, i]));
      for (const r of allRequests) for (const iid of r.issueIds) requestsByIssue.set(iid, r.id);
      outcome = await Promise.resolve(repair(args.gardenDir, args.gardenSlug, allRequests, { round, issuesById }));
    }
    const anchorAttempts = anchorDecisions.filter((d) => d.applied).length;
    totalAttempts += outcome.attempted + anchorAttempts;
    rounds.push({
      round, blockingIssues: blocking.length, warnings: warnings.length,
      repairsAttempted: outcome.attempted + anchorAttempts, repairsResolved: 0,
      issueTypes: [...new Set(blocking.map((i) => i.type))],
      resolutions: [], provenance: outcome.provenance ?? [],
      ...(anchorDecisions.length ? { anchorDecisions } : {}),
      ...verificationFields,
    });
    // Stop once repairing stops changing anything. telecom-1 spent rounds 3
    // through 8 re-attempting one repair against the same two issues, every
    // round reporting "attempted 1, resolved 0" with both still present
    // (2026-09-18) - roughly 45 minutes of model calls that could not have
    // succeeded, since nothing about the attempt differed. The issues remain
    // blocking either way; this only stops paying to rediscover that.
    // Compare on what is stable across rounds - the unit and issue type - not
    // the model-authored id, which drifts. And stop only when the round added
    // no issue that was not already stuck: a round whose set is "the same two
    // stuck ones plus a newly found error" has found something repairable,
    // and stopping there strands the new finding untried (telecom-1 U27's
    // carried-vs-offered traffic contradiction, 2026-09-18, surfaced in the
    // round the coarse version cut off).
    const blockingKeys = new Set(blocking.map(stableKey));
    const blockingKey = [...blockingKeys].sort().join("|");
    const introducedNew = [...blockingKeys].some((key) => !prevBlockingKeys.has(key));
    if (
      round > 1 &&
      blockingKey &&
      blockingKey === prevBlockingKey &&
      !introducedNew &&
      prevAttempted > 0 &&
      outcome.attempted + anchorAttempts > 0
    ) {
      prevBlocking = blocking;
      prevRequestsByIssue = requestsByIssue;
      prevRoundIdx = rounds.length - 1;
      break;
    }
    prevBlockingKey = blockingKey;
    prevBlockingKeys = blockingKeys;
    prevAttempted = outcome.attempted + anchorAttempts;
    prevBlocking = blocking;
    prevRequestsByIssue = requestsByIssue;
    prevRoundIdx = rounds.length - 1;
  }

  // If the loop repaired in its final iteration but never re-reviewed, do ONE
  // measurement review so finalBlockingIssues reflects the post-repair state and
  // the last repair round gets accurate resolution accounting.
  if (!endedClean && prevBlocking && prevRoundIdx >= 0 && rounds[prevRoundIdx].resolutions.length === 0) {
    const state = buildFinalGardenState(args.gardenDir, args.gardenSlug);
    const measurementRound = (rounds[rounds.length - 1]?.round ?? 0) + 1;
    const finalReview = verifiedReview(
      state,
      requireCriticIssues(
        await Promise.resolve(args.critic(buildCriticReviewPacket(state))),
      ).slice(0, options.maxIssuesPerRound),
      measurementRound,
    );
    // A finding this review raises for the first time, on a page no repair
    // touched, cannot be repaired by this run - there is no round after the
    // measurement. Under the "warn" policy it is published as a warning and
    // reported as demoted; anything already known, or on a repaired page (a
    // possible regression), keeps blocking. See readMeasurementReviewPolicy.
    let measuredBlocking = finalReview.blocking;
    let measuredWarnings = finalReview.warnings;
    if (options.measurementReviewNewFindings === "warn") {
      // "Known" means the critic confirmed the same kind of finding on the
      // same unit or page in an earlier review. A false positive it retracted
      // does not count, and neither does a different kind of finding on a
      // page it once mentioned: run 7 (2026-09-19) kept three fresh findings
      // blocking only because their pages had appeared in round 1 as
      // retracted "misclassified example" reports.
      const confirmed = allInstances.filter(
        (instance) => instance.verification.severity === "confirmed_blocking" || instance.verification.severity === "confirmed_warning",
      );
      const knownKeys = new Set(confirmed.map((instance) => stableKey(instance.issue)));
      const knownPageTypes = new Set(
        confirmed
          .filter((instance) => instance.issue.pagePath)
          .map((instance) => `${instance.issue.type}|${instance.issue.pagePath}`),
      );
      const repairedPaths = new Set(
        (rounds[prevRoundIdx].provenance ?? []).map((record) => record.targetPath).filter((targetPath): targetPath is string => Boolean(targetPath)),
      );
      const demoted = finalReview.blocking.filter((issue) =>
        !issue.id.startsWith(ANCHOR_EVIDENCE_ISSUE_PREFIX) &&
        !knownKeys.has(stableKey(issue)) &&
        !(issue.pagePath && (knownPageTypes.has(`${issue.type}|${issue.pagePath}`) || repairedPaths.has(issue.pagePath))),
      );
      if (demoted.length > 0) {
        for (const issue of demoted) {
          issue.severity = "warning";
          demotedMeasurementFindings.push(issue);
        }
        measuredBlocking = finalReview.blocking.filter((issue) => !demoted.includes(issue));
        measuredWarnings = [...finalReview.warnings, ...demoted];
      }
    }
    allInstances.push(...finalReview.instances);
    lastBlocking = measuredBlocking;
    lastWarnings = measuredWarnings;
    const resolutions = computeIssueResolutions(prevBlocking, lastBlocking, prevRequestsByIssue);
    rounds[prevRoundIdx].resolutions = resolutions;
    rounds[prevRoundIdx].repairsResolved = resolutions.filter((r) => r.status === "resolved").length;
  }

  return finish(lastBlocking, lastWarnings, true, false);
}

/** Build a decision packet per unresolved low-confidence anchor, ask the critic,
 *  and apply each structured decision. Provider failures retain exact identity;
 *  a fulfilled null is a terminal protocol failure rather than retry evidence. */
async function applyAnchorDecisions(
  gardenDir: string,
  gardenSlug: string,
  anchorConfirm: AnchorCriticFn,
  state: FinalGardenState,
): Promise<AppliedAnchorDecision[]> {
  const packets = buildAnchorConfirmationPackets(gardenDir, state);
  const applied: AppliedAnchorDecision[] = [];
  for (const packet of packets) {
    const decision = await Promise.resolve(anchorConfirm(packet));
    if (!decision) {
      throw new AnchorCriticProtocolError(`critic returned no decision for anchor "${packet.anchor.id}".`);
    }
    applied.push(applyAnchorCriticDecision(gardenDir, gardenSlug, decision));
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * Fix 12/24: force the validation report to agree with the canonical decision.
 * It can never show "0 FAIL"/"Accepted: yes" while deterministicPass is false —
 * the header counts are raised to include deterministic + verified-critic blockers
 * and an authoritative "Final Acceptance Decision" section is written.
 */
export function reconcileValidationReportWithDecision(gardenDir: string, d: FinalAcceptanceDecision): void {
  const p = path.join(gardenDir, ".breadboard", "validation-report.md");
  // Fix 11: the canonical finalize writer is the ONLY report creator. This
  // function amends an existing report; it never fabricates one from nothing
  // (a stub would lack the required sections and shadow the real writer).
  if (!fs.existsSync(p)) return;
  let text = fs.readFileSync(p, "utf-8");
  const blockerTotal = d.deterministicBlockerCount + d.verifiedCriticBlockerCount;
  text = text.replace(/^Accepted: .*$/m, `Accepted: ${d.accepted ? "yes" : "no"}`);
  text = text.replace(/^Check results: (\d+) PASS, (\d+) WARN, (\d+) FAIL, (\d+) SKIP$/m, (_full, pass, warn, fail, skip) => {
    const failN = Math.max(Number(fail), blockerTotal);
    return `Check results: ${pass} PASS, ${warn} WARN, ${failN} FAIL, ${skip} SKIP`;
  });
  const section = [
    "## Final Acceptance Decision",
    "",
    `Primary reason: ${d.primaryReason}`,
    `Deterministic pass: ${d.deterministicPass}`,
    `Publish ready: ${d.publishReady}`,
    `Critic available: ${d.criticAvailable}${d.criticAvailabilityProblem ? ` (${d.criticAvailabilityProblem})` : ""}`,
    `Deterministic blockers: ${d.deterministicBlockerCount}`,
    `Verified critic blockers: ${d.verifiedCriticBlockerCount}`,
    `Verified warnings: ${d.verifiedWarningCount}`,
    "",
    ...(d.deterministicBlockers.length ? d.deterministicBlockers.map((b) => `- [deterministic] ${String(b.problem).replace(/\r?\n/g, " ")}`) : ["- No deterministic blockers."]),
    ...d.verifiedCriticBlockers.map((b) => `- [critic] ${String(b.problem).replace(/\r?\n/g, " ")}`),
    "",
  ].join("\n");
  const re = /## Final Acceptance Decision[\s\S]*?(?=\n## |\s*$)/;
  text = re.test(text) ? text.replace(re, `${section}`) : `${text.replace(/\s*$/, "")}\n\n${section}\n`;
  fs.writeFileSync(p, text.endsWith("\n") ? text : `${text}\n`, "utf-8");
}

export function writeCriticReports(gardenDir: string, result: CriticLoopResult): void {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });

  // Fix 12/14: acceptance-status carries the canonical decision + shared counts so
  // every consumer (UI, reports) reads the same deterministic/critic breakdown.
  const acceptance = result.finalDecision
    ? { ...result.status, finalDecision: result.finalDecision, deterministicBlockerCount: result.finalDecision.deterministicBlockerCount, verifiedCriticBlockerCount: result.finalDecision.verifiedCriticBlockerCount, verifiedWarningCount: result.finalDecision.verifiedWarningCount }
    : result.status;
  fs.writeFileSync(path.join(bd, "acceptance-status.json"), `${JSON.stringify({ ...acceptance, acceptedResidues: result.acceptedResidues ?? [], appliedAcceptancePolicy: result.appliedAcceptancePolicy }, null, 2)}\n`, "utf-8");
  if (result.finalDecision) reconcileValidationReportWithDecision(gardenDir, result.finalDecision);

  fs.writeFileSync(
    path.join(bd, "critic-issues.json"),
    `${JSON.stringify({ blocking: result.finalBlockingIssues, warnings: result.finalWarnings, acceptedResidues: result.acceptedResidues ?? [], appliedAcceptancePolicy: result.appliedAcceptancePolicy }, null, 2)}\n`,
    "utf-8",
  );

  const s = result.status;
  const mdCell = (value: string | undefined): string => String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim()
    .slice(0, 220) || "-";
  let deterministicProblems: string[] = [];
  try {
    deterministicProblems = auditFinalGardenState(buildFinalGardenState(gardenDir)).problems;
  } catch {
    deterministicProblems = [];
  }
  const loop = {
    enabled: s.criticAvailabilityStatus !== "disabled",
    criticAvailabilityStatus: s.criticAvailabilityStatus,
    criticRequired: s.criticRequired,
    lifecycleStatus: s.lifecycleStatus,
    rounds: result.rounds.map((r) => ({
      round: r.round,
      blockingIssues: r.blockingIssues,
      warnings: r.warnings,
      repairsAttempted: r.repairsAttempted,
      repairsResolved: r.repairsResolved,
      resolutions: r.resolutions.map((res) => ({ issueId: res.issueId, type: res.originalIssue.type, target: res.originalIssue.repairTarget, status: res.status, repairRequestId: res.repairRequestId })),
      provenance: r.provenance,
      ...(r.anchorDecisions && r.anchorDecisions.length
        ? { anchorDecisions: r.anchorDecisions.map((d) => ({
            anchorId: d.anchorId,
            decision: d.decision,
            applied: d.applied,
            ...(d.replacementAnchorId ? { replacementAnchorId: d.replacementAnchorId } : {}),
            ...(d.betterAnchorId ? { betterAnchorId: d.betterAnchorId } : {}),
            ...(d.createdAnchorId ? { createdAnchorId: d.createdAnchorId } : {}),
            ...(d.verification ? { verification: { matchType: d.verification.matchType, ok: d.verification.ok, similarity: d.verification.similarity, page: d.verification.page } } : {}),
            ...(d.relevance ? { relevance: { decision: d.relevance.decision, ok: d.relevance.ok, anchorFamily: d.relevance.anchorFamily, textFamily: d.relevance.textFamily, wrongFamilyPenalty: d.relevance.wrongFamilyPenalty, totalScore: d.relevance.totalScore, reason: d.relevance.reason } } : {}),
            ...(d.semanticCompatibility ? { semanticCompatibility: d.semanticCompatibility } : {}),
            ...(d.followUpIssue ? { followUpIssue: true } : {}),
            ...(d.invalidReason ? { invalidReason: d.invalidReason } : {}),
          })) }
        : {}),
      // Fix 6: critic-issue verification accounting for the round.
      ...(r.reportedIssues != null ? { reportedIssues: r.reportedIssues } : {}),
      ...(r.verifiedBlockingIssues != null ? { verifiedBlockingIssues: r.verifiedBlockingIssues } : {}),
      ...(r.verifiedWarnings != null ? { verifiedWarnings: r.verifiedWarnings } : {}),
      ...(r.unsupportedIssues != null ? { unsupportedIssues: r.unsupportedIssues } : {}),
      ...(r.insufficientEvidenceIssues != null ? { insufficientEvidenceIssues: r.insufficientEvidenceIssues } : {}),
      ...(r.issueVerifications && r.issueVerifications.length ? { issueVerifications: r.issueVerifications } : {}),
    })),
    finalBlockingIssues: result.finalBlockingIssues.length,
    acceptedResidues: result.acceptedResidues ?? [],
    appliedAcceptancePolicy: result.appliedAcceptancePolicy,
    publishReady: s.publishReady,
    ...(result.finalBlockingIssues.length > 0 ? { unresolvedBlockingIssues: result.finalBlockingIssues } : {}),
    ...((() => {
      const fps = result.rounds.flatMap((r) => r.falsePositives ?? []);
      return fps.length ? { unsupportedCriticIssues: fps.map((f) => ({ issueId: f.issue.id, type: f.issue.type, problem: f.issue.problem, verification: f.verification.severity, reason: f.verification.reason })) } : {};
    })()),
  };
  fs.writeFileSync(path.join(bd, "critic-loop.json"), `${JSON.stringify(loop, null, 2)}\n`, "utf-8");

  const lines = [
    "# Breadboard Critic Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Lifecycle status: ${s.lifecycleStatus}`,
    `Draft generated: ${s.draftGenerated ? "yes" : "no"}`,
    `Deterministic validation: ${s.deterministicPass ? "pass" : "fail"}`,
    `Critic validation: ${s.criticPass ? "pass" : s.criticAvailabilityStatus === "available" ? "fail" : s.criticAvailabilityStatus}`,
    `Critic required (strict): ${s.criticRequired ? "yes" : "no"}`,
    `Critic availability: ${s.criticAvailabilityStatus}${s.criticUnavailableReason ? ` (${s.criticUnavailableReason})` : ""}`,
    `Blocking issues: ${result.finalBlockingIssues.length}`,
    `Warnings: ${result.finalWarnings.length}`,
    `Repair rounds used: ${s.repairRoundsUsed}`,
    `Publish-ready: ${s.publishReady ? "yes" : "no"}`,
    `Accepted: ${s.accepted ? "yes" : "no"}`,
    ...(s.reason ? [`Reason: ${s.reason}`] : []),
    "",
    "## Operator policy applied",
    "",
    `Policy version: ${result.appliedAcceptancePolicy?.snapshot?.version ?? "not recorded"}`,
    `Policy SHA-256: ${result.appliedAcceptancePolicy?.snapshot?.sha256 ?? "not recorded"}`,
    `Policy captured: ${result.appliedAcceptancePolicy?.snapshot?.capturedAt ?? "not recorded"}`,
    `Effective maximum rounds: ${result.appliedAcceptancePolicy?.effectiveMaxRounds ?? "not recorded"}`,
    `New measurement findings: ${result.appliedAcceptancePolicy?.effectiveMeasurementReviewNewFindings ?? "not recorded"}`,
    "",
    "## Recorded exceptions",
    "",
    ...(result.appliedAcceptancePolicy?.snapshot?.records.length ? result.appliedAcceptancePolicy.snapshot.records.flatMap((entry) => [
      `- Exception/scope: ${entry.issueId.replace(/\r?\n/g, " ")}`,
      `  Accepted: ${entry.acceptedAt ?? "not recorded"}`,
      `  Reason: ${(entry.reason ?? "not recorded").replace(/\r?\n/g, " ")}`,
      "",
    ]) : ["- None recorded.", ""]),
    "## Accepted findings",
    "",
    ...(result.acceptedResidues?.length ? result.acceptedResidues.flatMap((issue) => [
      `- Issue: ${mdCell(issue.id)}; type: ${mdCell(issue.type)}; page: ${mdCell(issue.pagePath ?? issue.sectionPath)}`,
      `  Problem: ${mdCell(issue.problem)}`,
      ...(result.appliedAcceptancePolicy?.matches.find((match) => match.issue.id === issue.id)?.exceptions ?? []).flatMap((entry) => [
        `  Exception/scope: ${entry.issueId.replace(/\r?\n/g, " ")}`,
        `  Accepted: ${entry.acceptedAt ?? "not recorded"}`,
        `  Reason: ${(entry.reason ?? "not recorded").replace(/\r?\n/g, " ")}`,
      ]),
      "",
    ]) : ["- None.", ""]),
    "## Rounds",
    "",
    "| Round | Blocking | Warnings | Repairs attempted | Resolved | Still present | Replaced |",
    "|---|---|---|---|---|---|---|",
    ...(result.rounds.length > 0
      ? result.rounds.map((r) => {
          const still = r.resolutions.filter((x) => x.status === "still_present").length;
          const repl = r.resolutions.filter((x) => x.status === "replaced_by_new_issue").length;
          return `| ${r.round} | ${r.blockingIssues} | ${r.warnings} | ${r.repairsAttempted} | ${r.repairsResolved} | ${still} | ${repl} |`;
        })
      : ["| — | — | — | — | — | — | — |"]),
    "",
    "## Unresolved blocking issues",
    "",
    ...(result.finalBlockingIssues.length > 0
      ? [
          "| Type | Target | Anchors | Problem | Expected | Suggested repair |",
          "|---|---|---|---|---|---|",
          ...result.finalBlockingIssues.map((i) =>
            `| ${mdCell(i.type)} | ${mdCell(i.pagePath ?? i.sectionPath ?? i.visualId ?? i.repairTarget)} | ${mdCell((i.sourceAnchorIds ?? []).join(", "))} | ${mdCell(i.problem)} | ${mdCell(i.expected)} | ${mdCell(i.suggestedRepair)} |`,
          ),
        ]
      : ["- None."]),
    "",
    ...(result.demotedMeasurementFindings?.length
      ? [
          "## Measurement-review findings published as warnings",
          "",
          "Raised for the first time by the final measurement review on pages no repair touched; published under the garden's `measurementReviewNewFindings: \"warn\"` policy for a person to read.",
          "",
          "| Type | Target | Problem | Suggested repair |",
          "|---|---|---|---|",
          ...result.demotedMeasurementFindings.map((i) =>
            `| ${mdCell(i.type)} | ${mdCell(i.pagePath ?? i.sectionPath ?? i.visualId ?? i.repairTarget)} | ${mdCell(i.problem)} | ${mdCell(i.suggestedRepair)} |`,
          ),
          "",
        ]
      : []),
    "## Deterministic audit blockers",
    "",
    ...(deterministicProblems.length > 0
      ? deterministicProblems.slice(0, 40).map((problem) => `- ${mdCell(problem)}`)
      : ["- None."]),
    "",
    "## Verified Warnings",
    "",
    ...(result.finalWarnings.length > 0
      ? result.finalWarnings.map((i) => `- **[${i.type}]** ${i.problem} (${i.pagePath ?? i.sectionPath ?? "global"})`)
      : ["- None."]),
    "",
    "## Unsupported Critic Issues",
    "",
    ...(() => {
      const fps = result.rounds.flatMap((r) => (r.falsePositives ?? []).filter((f) => f.verification.severity === "unsupported").map((f) => ({ round: r.round, f })));
      if (fps.length === 0) return ["- None."];
      return [
        "| Issue | Reported Problem | Verification Result | Reason |",
        "|---|---|---|---|",
        ...fps.map(({ f }) => `| ${mdCell(f.issue.id)} | ${mdCell(f.issue.problem)} | ${f.verification.severity} | ${mdCell(f.verification.reason)} |`),
      ];
    })(),
    "",
    "## Insufficient-Evidence Critic Issues",
    "",
    ...(() => {
      const rows = result.rounds.flatMap((r) => (r.falsePositives ?? []).filter((f) => f.verification.severity === "insufficient_evidence"));
      if (rows.length === 0) return ["- None."];
      return [
        "| Issue | Reported Problem | Reason |",
        "|---|---|---|",
        ...rows.map((f) => `| ${mdCell(f.issue.id)} | ${mdCell(f.issue.problem)} | ${mdCell(f.verification.reason)} |`),
      ];
    })(),
    "",
    "## Anchor Confirmation Decisions",
    "",
    ...(() => {
      const decisions = result.rounds.flatMap((r) => (r.anchorDecisions ?? []).map((d) => ({ round: r.round, d })));
      if (decisions.length === 0) return ["- None."];
      return decisions.map(({ round, d }) =>
        `- Round ${round}: **${d.anchorId}** → ${d.decision}${d.applied ? "" : " (not applied)"}${d.replacementAnchorId ? ` → ${d.replacementAnchorId}` : ""}${d.betterAnchorId ? ` → ${d.betterAnchorId}` : ""}${d.verification ? ` [source: ${d.verification.matchType}]` : ""}${d.relevance ? ` [relevance: ${d.relevance.decision}]` : ""}${d.semanticCompatibility ? ` [compat: ${d.semanticCompatibility.ok ? "ok" : "incompatible"}]` : ""}${d.invalidReason ? ` [${d.invalidReason}]` : ""}${d.reason ? ` — ${d.reason}` : ""}`,
      );
    })(),
    "",
    "## Anchor Decision Verification",
    "",
    "| Anchor | Decision | Applied | Source Text Match | Relevance | Compatibility | Reason |",
    "|---|---|---:|---|---|---|---|",
    ...(() => {
      const decisions = result.rounds.flatMap((r) => r.anchorDecisions ?? []);
      if (decisions.length === 0) return ["| — | — | — | — | — | — | — |"];
      return decisions.map((d) => `| ${d.anchorId} | ${d.decision} | ${d.applied ? "yes" : "no"} | ${d.verification ? d.verification.matchType : (d.decision === "replace" ? "n/a" : "—")} | ${d.relevance ? d.relevance.decision : "—"} | ${d.semanticCompatibility ? (d.semanticCompatibility.ok ? "ok" : "incompatible") : "—"} | ${(d.invalidReason ?? d.reason ?? "").replace(/\|/g, "\\|").slice(0, 80)} |`);
    })(),
    "",
  ];
  fs.writeFileSync(path.join(bd, "critic-report.md"), `${lines.join("\n")}\n`, "utf-8");

  // Surface the publish-readiness verdict inside the deterministic validation
  // report so a critic-blocked garden is never presented as fully accepted.
  const reportPath = path.join(bd, "validation-report.md");
  if (fs.existsSync(reportPath)) {
    let report = fs.readFileSync(reportPath, "utf-8")
      .replace(/\n## Critic Publish Readiness[\s\S]*$/m, "")
      .replace(/^Accepted:\s+(?:yes|no)\s*$/gm, `Accepted: ${s.accepted ? "yes" : "no"}`)
      .replace(/\s+$/, "");
    report += [
      "",
      "",
      "## Critic Publish Readiness",
      "",
      `Lifecycle status: ${s.lifecycleStatus}`,
      `Deterministic validation: ${s.deterministicPass ? "pass" : "fail"}`,
      `Critic validation: ${s.criticPass ? "pass" : s.criticAvailabilityStatus === "available" ? "fail" : s.criticAvailabilityStatus}`,
      `Overall accepted: ${s.accepted ? "yes" : "no"}`,
      `Publish-ready: ${s.publishReady ? "yes" : "no"}`,
      `Blocking issues: ${result.finalBlockingIssues.length}, Warnings: ${result.finalWarnings.length}`,
      ...(s.reason ? [`Reason: ${s.reason}`] : []),
      "",
    ].join("\n");
    fs.writeFileSync(reportPath, `${report}\n`, "utf-8");
  }
}
