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

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  applyAnchorCriticDecision,
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
  type FinalAuditResult,
  type FinalGardenState,
} from "./final-garden-state.ts";
import { finalizeGardenExport } from "./garden-finalize.ts";

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
  sections: Array<{
    title: string;
    indexExcerpt: CriticExcerpt;
    pages: Array<{
      path: string;
      title: string;
      openingExcerpt: CriticExcerpt;
      frontmatterSummary: {
        sourceAnchors: string[];
        sourceFormulaAnchors: string[];
        formulas: CriticFormulaRecord[];
        tags: string[];
        visuals: string[];
      };
      bodyExcerpts: CriticExcerpt[];
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
  const basis = `${issue.evidence ?? ""} ${issue.problem ?? ""} ${issue.expected ?? ""}`;
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

function normalizedProblemKey(problem: string): string {
  return String(problem ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ").slice(0, 160);
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
}

export const DEFAULT_CRITIC_LOOP_OPTIONS: CriticLoopOptions = {
  enabled: true,
  maxRounds: 3,
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
  issue: CriticIssue;
  repairRequest: ArtifactRepairRequest;
  finalGardenStateExcerpt: unknown;
  currentMarkdown?: string;
  learningUnitContract?: unknown;
  sourceAnchors?: unknown[];
  previousPageSummary?: string;
  nextPageSummary?: string;
}

export interface ModelRepairOutput {
  targetPath: string;
  revisedMarkdown?: string;
  revisedJson?: unknown;
  notes?: string[];
}

export type ModelRepairFn = (input: ModelRepairInput) => Promise<ModelRepairOutput | null> | ModelRepairOutput | null;

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
  const pagesBySection = new Map<string, FinalGardenState["pages"]>();
  const sectionDir = (rel: string): string => rel.split("/").slice(0, 2).join("/");
  for (const page of state.pages) {
    const key = sectionDir(page.rel);
    (pagesBySection.get(key) ?? pagesBySection.set(key, []).get(key)!).push(page);
  }
  const sectionByDir = new Map(state.sections.map((s) => [s.rel.replace(/\/_index\.md$/i, ""), s]));

  const sections = [...pagesBySection.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, pages]) => {
      const section = sectionByDir.get(dir);
      const sortedPages = [...pages].sort((a, b) => a.subsectionNumber.localeCompare(b.subsectionNumber, undefined, { numeric: true }));
      const indexFull = (section?.body ?? "").replace(/```[\s\S]*?```/g, " ").replace(/^#.*$/gm, " ").replace(/\s+/g, " ").trim();
      return {
        title: section?.title ?? dir.split("/").pop() ?? dir,
        indexExcerpt: makeExcerpt(indexFull, 320, { sourcePath: section?.rel }),
        pages: sortedPages.map((page) => ({
          path: page.rel,
          title: page.title,
          openingExcerpt: makeExcerpt(firstProseParagraphs(page.body, 1).join(" "), 400, { sourcePath: page.rel }),
          frontmatterSummary: {
            sourceAnchors: page.sourceAnchors,
            sourceFormulaAnchors: page.sourceFormulaAnchors,
            formulas: criticFormulaRecords(state, page.rel),
            tags: page.tags,
            visuals: page.visualIds,
          },
          bodyExcerpts: firstProseParagraphs(page.body, 3).map((p) => makeExcerpt(p, 300, { sourcePath: page.rel })),
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
- Repair-log entries attributing a change to the wrong target are provenance errors.

Return ONLY a JSON object: {"issues": CriticIssue[]}. Each issue:
{
  "id": "kebab-unique",
  "severity": "blocking" | "warning" | "cosmetic",
  "type": one of formula_anchor_mismatch|source_anchor_mismatch|source_coverage_contradiction|stale_caveat|section_index_template_prose|template_zettelkasten_handle|repeated_opening|visual_grounding_mismatch|worked_example_misclassified|repair_provenance_error|debug_artifact_leak|other,
  "pagePath"?, "sectionPath"?, "visualId"?, "sourceAnchorIds"?: string[],
  "problem": one sentence,
  "evidence": the exact text/field proving it,
  "expected": what a correct artifact would show,
  "repairTarget": unit_page|section_index|learning_unit_contract|source_anchor_ledger|source_coverage|planning_doc|visual_spec|repair_log|global,
  "suggestedRepair": one actionable instruction
}
Use "blocking" only for genuine semantic errors; "warning"/"cosmetic" for polish. If the garden is clean, return {"issues": []}. Output JSON only, no prose.`;

export function buildCriticUserPrompt(packet: CriticReviewPacket): string {
  return `Review this final garden. Report only genuine semantic errors as JSON {"issues":[...]}.\n\n${JSON.stringify(packet, null, 1)}`;
}

const VALID_TYPES = new Set<CriticIssueType>([
  "formula_anchor_mismatch", "source_anchor_mismatch", "source_coverage_contradiction", "stale_caveat",
  "section_index_template_prose", "template_zettelkasten_handle", "repeated_opening", "visual_grounding_mismatch",
  "worked_example_misclassified", "repair_provenance_error", "debug_artifact_leak", "other",
]);
const VALID_TARGETS = new Set<CriticRepairTarget>([
  "unit_page", "section_index", "learning_unit_contract", "source_anchor_ledger", "source_coverage",
  "planning_doc", "visual_spec", "repair_log", "global",
]);

/** Parse a critic model response into validated issues. Tolerant of fences and
 *  either a bare array or {issues:[...]}. Invalid issues are dropped. */
export function parseCriticIssues(text: string): CriticIssue[] {
  const stripped = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.issues)
      ? (parsed as Record<string, unknown>).issues as unknown[]
      : [];
  const issues: CriticIssue[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const severity = String(r.severity ?? "").toLowerCase();
    if (severity !== "blocking" && severity !== "warning" && severity !== "cosmetic") continue;
    const type = (VALID_TYPES.has(r.type as CriticIssueType) ? r.type : "other") as CriticIssueType;
    const repairTarget = (VALID_TARGETS.has(r.repairTarget as CriticRepairTarget) ? r.repairTarget : "global") as CriticRepairTarget;
    const problem = String(r.problem ?? "").trim();
    if (!problem) continue;
    issues.push({
      id: String(r.id ?? `critic-${i + 1}`),
      severity: severity as CriticSeverity,
      type,
      pagePath: r.pagePath ? String(r.pagePath) : undefined,
      sectionPath: r.sectionPath ? String(r.sectionPath) : undefined,
      visualId: r.visualId ? String(r.visualId) : undefined,
      sourceAnchorIds: Array.isArray(r.sourceAnchorIds) ? r.sourceAnchorIds.map(String) : undefined,
      problem,
      evidence: String(r.evidence ?? "").trim(),
      expected: String(r.expected ?? "").trim(),
      repairTarget,
      suggestedRepair: String(r.suggestedRepair ?? "").trim(),
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
    const misclassified = pool.filter((f) => f.structuralKind === "worked_example" && f.declaredKind === "source_definition");
    if (misclassified.length > 0) {
      return { issueId, verified: true, severity: "confirmed_blocking", checkedFiles: files, fullStateEvidence: misclassified.map((f) => f.text), reason: "a numeric worked example is labeled source_definition in the full record" };
    }
    return { issueId, verified: false, severity: "unsupported", checkedFiles: files, reason: "no numeric substitution is mislabeled as source_definition in the full formula records" };
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
    return parseAnchorCriticDecision(response.choices?.[0]?.message?.content ?? "");
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

/** Group blocking issues into targeted repair requests (one per target+path). */
export function criticIssuesToRepairRequests(issues: CriticIssue[]): ArtifactRepairRequest[] {
  const groups = new Map<string, ArtifactRepairRequest>();
  for (const issue of issues) {
    const targetPath = repairTargetPath(issue);
    const key = `${issue.repairTarget}::${targetPath ?? ""}`;
    let req = groups.get(key);
    if (!req) {
      req = {
        id: `repair-${issue.repairTarget}-${groups.size + 1}`,
        issueIds: [],
        targetKind: issue.repairTarget,
        targetPath,
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
    const anchorIds = extractAnchorIds(issue);
    for (const id of anchorIds) if (!req.affectedAnchorIds!.includes(id)) req.affectedAnchorIds!.push(id);
    if (issue.type === "worked_example_misclassified") {
      req.formulaKindRepairs!.push({
        issueId: issue.id,
        pagePath: issue.pagePath,
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
        pagePath: issue.pagePath,
        evidence: issue.evidence,
        problem: issue.problem,
      });
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

Hard requirements:
- Return the ENTIRE target file, not a diff.
- Preserve the YAML frontmatter block and every required key (title, knowledge_type/breadboardType, learningUnitId, generated_by, tags, sourceAnchors, sourceFormulaAnchors, formulas, visualIds). Change only what the issue requires.
- Preserve source anchors and formula anchors UNLESS the issue is a source/formula anchor mismatch, in which case ground to the correct one named in the issue.
- Preserve every \`\`\`breadboard-visual\`\`\` block verbatim.
- Preserve contract-backed Zettelkasten tags, unless the issue is a template handle — then replace only the flagged handle with a concrete durable claim.
- Remove exactly the flagged issue; do not introduce generic scaffold prose ("introduces the core idea", "so the pieces connect into one picture", "one step at a time").
- Keep the learner-facing voice; never mention "the paper", "the source", or "this document".
Output the revised file content only.`;

export function buildModelRepairPrompt(input: ModelRepairInput): { system: string; user: string } {
  const { issue, repairRequest } = input;
  const user = [
    `Target file: ${repairRequest.targetPath ?? "(unknown)"}`,
    `Issue type: ${issue.type}`,
    `Problem: ${issue.problem}`,
    `Evidence: ${issue.evidence}`,
    `Expected: ${issue.expected}`,
    `Instructions: ${repairRequest.instructions.join(" ") || issue.suggestedRepair}`,
    input.sourceAnchors ? `Relevant source anchors: ${JSON.stringify(input.sourceAnchors).slice(0, 1200)}` : "",
    input.previousPageSummary ? `Previous page: ${input.previousPageSummary}` : "",
    input.nextPageSummary ? `Next page: ${input.nextPageSummary}` : "",
    "",
    "Current file content:",
    "-----",
    input.currentMarkdown ?? "(none)",
    "-----",
    "Return the full revised file content only.",
  ].filter(Boolean).join("\n");
  return { system: MODEL_REPAIR_SYSTEM_PROMPT, user };
}

/** Parse a model repair response into structured output for the target file. */
export function parseModelRepairOutput(text: string, targetPath: string): ModelRepairOutput | null {
  const stripped = String(text ?? "").trim().replace(/^```(?:json|markdown|md)?\s*/i, "").replace(/```$/i, "").trim();
  if (!stripped) return null;
  if (/\.json$/i.test(targetPath)) {
    try {
      return { targetPath, revisedJson: JSON.parse(stripped) };
    } catch {
      return null;
    }
  }
  return { targetPath, revisedMarkdown: stripped };
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

function buildModelRepairInput(state: FinalGardenState, gardenDir: string, request: ArtifactRepairRequest, issue: CriticIssue): ModelRepairInput {
  const abs = request.targetPath ? path.join(gardenDir, request.targetPath) : undefined;
  const currentMarkdown = abs && fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : undefined;
  const anchorIds = new Set(issue.sourceAnchorIds ?? request.affectedAnchorIds ?? []);
  const relevantAnchors = Object.values(state.sourceAnchors).filter((a) => anchorIds.has(a.id)).slice(0, 8);
  const adj = request.targetPath ? adjacentPageSummaries(state, request.targetPath) : {};
  return {
    issue,
    repairRequest: request,
    finalGardenStateExcerpt: { pages: state.pages.length, anchors: Object.keys(state.sourceAnchors).length },
    currentMarkdown,
    learningUnitContract: undefined,
    sourceAnchors: relevantAnchors.length ? relevantAnchors : undefined,
    previousPageSummary: adj.previous,
    nextPageSummary: adj.next,
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

function applyModelRepairOutput(gardenDir: string, gardenSlug: string, out: ModelRepairOutput): boolean {
  const abs = path.join(gardenDir, out.targetPath);
  if (!fs.existsSync(path.dirname(abs))) return false;
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
  if (out.revisedMarkdown !== undefined) {
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(out.revisedMarkdown)) return false; // must keep frontmatter
    if (modelMarkdownHasInvalidAnchorLabels(out.revisedMarkdown)) return false;
    if (before !== null && out.revisedMarkdown.trim() === before.trim()) return false;
    fs.writeFileSync(abs, out.revisedMarkdown.endsWith("\n") ? out.revisedMarkdown : `${out.revisedMarkdown}\n`, "utf-8");
  } else if (out.revisedJson !== undefined) {
    if (modelJsonHasInvalidAnchorLabels(out.revisedJson)) return false;
    fs.writeFileSync(abs, `${JSON.stringify(out.revisedJson, null, 2)}\n`, "utf-8");
  } else {
    return false;
  }
  try {
    buildFinalGardenState(gardenDir, gardenSlug); // sanity: still parses
    return true;
  } catch {
    if (before !== null) fs.writeFileSync(abs, before, "utf-8");
    return false;
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

/** Production repair: MODEL-first for semantic page/section issues, then the
 *  FULL deterministic finalization for mechanical fixes and as a fallback. */
export function makeCriticArtifactRepair(opts: {
  modelRepair?: ModelRepairFn;
  deterministicFinalize?: (gardenDir: string, gardenSlug: string) => void;
} = {}): ArtifactRepairFn {
  const finalize = opts.deterministicFinalize ?? ((gardenDir: string, gardenSlug: string) => {
    try { finalizeGardenExport({ gardenDir, gardenSlug }); }
    catch { try { reconcileFinalGardenState(gardenDir, gardenSlug); } catch { /* best effort */ } }
  });
  return async (gardenDir, gardenSlug, requests, ctx) => {
    const provenance: RepairProvenanceRecord[] = [];
    const handledByModel = new Set<string>();
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
    if (opts.modelRepair) {
      for (const req of requests) {
        if (!requestIsModelFirst(req, ctx.issuesById)) continue;
        if (handledByModel.has(req.id)) continue;
        const issue = ctx.issuesById?.get(req.issueIds[0]);
        if (!issue) continue;
        const state = buildFinalGardenState(gardenDir, gardenSlug);
        const attempted: Array<"model" | "deterministic"> = ["model"];
        let used: RepairProvenanceRecord["executorUsed"] = "none";
        let modelFailureReason: string | undefined;
        let changed = false;
        try {
          const out = await Promise.resolve(opts.modelRepair(buildModelRepairInput(state, gardenDir, req, issue)));
          if (out && applyModelRepairOutput(gardenDir, gardenSlug, out)) { used = "model"; changed = true; }
          else modelFailureReason = "model returned no valid candidate";
        } catch (error) {
          modelFailureReason = error instanceof Error ? error.message : String(error);
        }
        if (!changed) attempted.push("deterministic"); // deterministic finalize below is the fallback
        provenance.push({ requestId: req.id, targetKind: req.targetKind, targetPath: req.targetPath, executorAttempted: attempted, executorUsed: used, modelFailureReason, changed });
        handledByModel.add(req.id);
      }
    }
    // Deterministic finalization: mechanical fixes + fallback for failed model repairs.
    finalize(gardenDir, gardenSlug);
    for (const p of provenance) {
      if (p.executorUsed === "none") p.executorUsed = "deterministic"; // finalize was the fallback
    }
    for (const req of requests) {
      if (handledByModel.has(req.id)) continue;
      provenance.push({ requestId: req.id, targetKind: req.targetKind, targetPath: req.targetPath, executorAttempted: ["deterministic"], executorUsed: "deterministic", changed: true });
    }
    return { attempted: requests.length, resolved: 0, provenance };
  };
}

/** Backward-compatible default: deterministic finalization only (no model). */
export function makeDefaultArtifactRepair(): ArtifactRepairFn {
  return makeCriticArtifactRepair();
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

export async function runCriticLoop(args: RunCriticLoopArgs): Promise<CriticLoopResult> {
  const options: CriticLoopOptions = { ...DEFAULT_CRITIC_LOOP_OPTIONS, ...(args.options ?? {}) };
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
    const verifiedBlocking = [...anchorBlocking, ...resolution.blockers];
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
    const result: CriticLoopResult = { status, rounds, finalBlockingIssues: verifiedBlocking, finalWarnings: verifiedWarnings, finalResolution: resolution };
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
  let prevRequestsByIssue = new Map<string, string>();
  let prevRoundIdx = -1;
  let endedClean = false;
  let lastBlocking: CriticIssue[] = [];
  let lastWarnings: CriticIssue[] = [];

  for (let round = 1; round <= options.maxRounds; round += 1) {
    const state = buildFinalGardenState(args.gardenDir, args.gardenSlug);
    const anchorIssues = anchorEvidenceCriticIssues(state);
    const packet = buildCriticReviewPacket(state);
    let criticIssues: CriticIssue[];
    try {
      criticIssues = (await Promise.resolve(args.critic(packet))).slice(0, options.maxIssuesPerRound);
    } catch (error) {
      // Prose critic unavailable — low-confidence anchors still block.
      return finish([...(prevBlocking ?? []), ...anchorIssues.filter((a) => !(prevBlocking ?? []).some((p) => p.id === a.id))], lastWarnings, round > 1, true, error instanceof Error ? error.message : String(error));
    }
    const review = verifiedReview(state, criticIssues, round);
    allInstances.push(...review.instances);
    const { blocking, warnings } = review;
    const verificationFields = {
      reportedIssues: review.reportedIssues,
      verifiedBlockingIssues: blocking.length,
      verifiedWarnings: warnings.length,
      unsupportedIssues: review.falsePositives.filter((f) => f.verification.severity === "unsupported").length,
      insufficientEvidenceIssues: review.falsePositives.filter((f) => f.verification.severity === "insufficient_evidence").length,
      issueVerifications: review.verifications,
      ...(review.falsePositives.length ? { falsePositives: review.falsePositives } : {}),
    };
    lastBlocking = blocking;
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
      try {
        anchorDecisions = await applyAnchorDecisions(args.gardenDir, args.gardenSlug, args.anchorConfirm, state);
      } catch (error) {
        // Anchor critic unavailable — keep the anchors blocking.
        return finish(blocking, warnings, true, true, error instanceof Error ? error.message : String(error));
      }
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
    const genericRequests = genericBlocking.length > 0 ? criticIssuesToRepairRequests(genericBlocking) : [];
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
    prevBlocking = blocking;
    prevRequestsByIssue = requestsByIssue;
    prevRoundIdx = rounds.length - 1;
  }

  // If the loop repaired in its final iteration but never re-reviewed, do ONE
  // measurement review so finalBlockingIssues reflects the post-repair state and
  // the last repair round gets accurate resolution accounting.
  if (!endedClean && prevBlocking && prevRoundIdx >= 0 && rounds[prevRoundIdx].resolutions.length === 0) {
    try {
      const state = buildFinalGardenState(args.gardenDir, args.gardenSlug);
      const measurementRound = (rounds[rounds.length - 1]?.round ?? 0) + 1;
      const finalReview = verifiedReview(state, (await Promise.resolve(args.critic(buildCriticReviewPacket(state)))).slice(0, options.maxIssuesPerRound), measurementRound);
      allInstances.push(...finalReview.instances);
      lastBlocking = finalReview.blocking;
      lastWarnings = finalReview.warnings;
      const resolutions = computeIssueResolutions(prevBlocking, lastBlocking, prevRequestsByIssue);
      rounds[prevRoundIdx].resolutions = resolutions;
      rounds[prevRoundIdx].repairsResolved = resolutions.filter((r) => r.status === "resolved").length;
    } catch (error) {
      return finish(lastBlocking, lastWarnings, true, true, error instanceof Error ? error.message : String(error));
    }
  }

  return finish(lastBlocking, lastWarnings, true, false);
}

/** Build a decision packet per unresolved low-confidence anchor, ask the critic,
 *  and apply each structured decision. Throws if the critic itself is
 *  unavailable so the loop can mark the run critic-errored. */
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
      applied.push({ anchorId: packet.anchor.id, decision: "reject", applied: false, reason: "critic returned no decision", changed: [], invalidReason: "no_decision" });
      continue;
    }
    applied.push(applyAnchorCriticDecision(gardenDir, gardenSlug, decision));
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function writeCriticReports(gardenDir: string, result: CriticLoopResult): void {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });

  fs.writeFileSync(path.join(bd, "acceptance-status.json"), `${JSON.stringify(result.status, null, 2)}\n`, "utf-8");

  fs.writeFileSync(
    path.join(bd, "critic-issues.json"),
    `${JSON.stringify({ blocking: result.finalBlockingIssues, warnings: result.finalWarnings }, null, 2)}\n`,
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
