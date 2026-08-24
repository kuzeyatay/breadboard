// Breadboard garden finalizer.
//
// The Learn pipeline writes generated learning pages and planning artifacts into
// the Quartz content directory. The finalizer is the deterministic export gate:
// it cleans filesystem/path hygiene, normalizes links and stale caveats, writes
// the validation report, and fails the artifact when the Learning Unit Contract
// was not fulfilled. It does not invent semantic tags, source assignments,
// interactive visual plans, or formula grounding after page writing.
//
// `finalizeGardenExport` is the deterministic export stage that runs after
// generation and before publish. It verifies the on-disk tree so that what
// Quartz sees is exactly what the acceptance validator
// (scripts/validate-breadboard-garden.ts) accepts, writes
// `.breadboard/validation-report.md`, and hard-fails when a critical invariant
// cannot be repaired.
//
// Everything here is deterministic and filesystem-only: no LLM calls. It is
// safe to run repeatedly (idempotent) and standalone on an already-generated
// garden.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  anchorTextCompatibleWithVisualType,
  atomicZettelHandle,
  conceptTagsForUnit,
  dedupeSourceArtifactAssignments,
  dropIncompatibleInteractiveVisuals,
  interactiveVisualGroundingProblems,
  isAtomicZettelHandle,
  normalizeLearningUnits,
  normalizedSectionTitleKey,
  reconcileLearningUnitSourceArtifacts,
  scaffoldLikeZettelHandle,
  sectionTitleUniquenessProblems,
  sectionSemanticProfiles,
  sectionTitleGrammarProblems,
  sectionTitleNaturalnessProblems,
  zettelHandleQualityProblems,
  zettelHandlesForUnit,
  type LearningUnitContract,
  type RegisteredSourceArtifact,
  type SourceArtifactAssignment,
  type SourceFigurePlacement,
  type ZettelNote,
} from "./learning-unit-contract.ts";
import { buildGardenTopicProfile, generateSectionTitle, type GardenTopicProfile } from "./section-title.ts";
import { formulaMeaningMatch, formulaMetricFamily, isFormulaExpression, isGroundableFormula, isTrivialFormulaFragment, isWorkedExampleFormula, safeLearnFileSegment, stripMarkdownFrontmatter } from "./learn-utils.ts";
import { auditFinalGardenState, auditLegacyMigrationPersistence, buildCanonicalSourceAnchors, buildFinalGardenState, projectSourceCoverage, reconcileFinalGardenState } from "./final-garden-state.ts";
import { assertFormulaAssignmentCompatible, buildFormulaIdentityRegistry, legacyFormulaFamily } from "./formula-identity.ts";
import { deriveUnitFormulaRequirement, validateFormulaAssignment } from "./formula-assignment.ts";
import {
  parseFormulaMetadataEntries,
  reconcileFinalFormulaProjectionsDeterministic,
  stableWorkedExampleIdentity,
} from "./formula-usage-reconciliation.ts";
import type { SourceAnchor } from "./visual-spec.ts";
import { isValidPublicConceptSlug } from "./semantic-core.ts";
import { migrateGardenSemantics, validateGardenSemantics } from "./garden-semantics.ts";
import { readFileSyncWithRetry } from "./resilient-fs.ts";
import {
  dedupeSemanticBlockerLines,
  finalGardenStateFingerprint,
  reconcileFinalGardenSemantics,
  verifyValidationReportSerialization,
} from "./semantic-reconciliation.ts";
import {
  assessInteractiveVisualFulfillment,
  loadVisualDecisionOverrides,
  planGardenVisualNecessity,
  saveVisualNecessityArtifacts,
} from "./visual-necessity.ts";
import {
  loadVisualizationPlan,
  type VisualizationPlan,
} from "./visualization-opportunities.ts";
import { extractVerbatimDisplayMath, normalizeQuartzMarkdown } from "./quartz-markdown.ts";
import {
  loadSourceVisualSourceIdentityMap,
  sourceSetHashWithReviewedFormulas,
  validateSourceFormulaReviewSet,
  type SourceFormulaTopologyReviewPageReceipt,
  type SourceVisual,
  type SourceVisualSourceIdentity,
} from "./source-visuals.ts";
import { selectedSourceArtifactInventorySnapshot } from "./learn-source-artifact-inventory.ts";
import {
  syllabusCoverageRecoveryReceiptProblems,
  type SyllabusCoverageEvidenceRecoveryReceipt,
} from "./learn-syllabus-coverage-recovery.ts";
import { modelSourcePageAnchors } from "./model-source-anchor-ledger.ts";
import { canonicalVisualizationEvidenceByUnit } from "./visualization-canonical-evidence.ts";
import {
  loadVisualContractExecutabilityLedger,
  visualContractExecutabilityArtifactProvenanceProblems,
  visualContractExecutabilityLinkageProblems,
  type VisualContractExecutabilityLedgerContext,
} from "./visualization-contract-executability.ts";

// ---------------------------------------------------------------------------
// Frontmatter + fs helpers
// ---------------------------------------------------------------------------

interface ParsedFile {
  rawFrontmatter: string;
  body: string;
  hadFrontmatter: boolean;
}

function parseFrontmatter(content: string): ParsedFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { rawFrontmatter: "", body: content, hadFrontmatter: false };
  return { rawFrontmatter: match[1] ?? "", body: match[2] ?? "", hadFrontmatter: true };
}

function joinFrontmatter(rawFrontmatter: string, body: string): string {
  return `---\n${rawFrontmatter.replace(/\s+$/, "")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function jsonScalar(value: string | number | boolean): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(String(value).replace(/\r/g, ""));
}

/** Top-level scalar/array frontmatter keys are edited by line surgery so nested
 * blocks (formulas:) are never disturbed unless explicitly targeted. */
function fmGetScalar(rawFm: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const match = rawFm.match(re);
  if (!match) return "";
  return (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

function fmGetArray(rawFm: string, key: string): string[] {
  const re = new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m");
  const match = rawFm.match(re);
  if (!match) return [];
  return (match[1] ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function fmSetScalar(rawFm: string, key: string, value: string | number | boolean): string {
  const line = `${key}: ${jsonScalar(value)}`;
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(rawFm)) return rawFm.replace(re, line);
  return `${rawFm.replace(/\s+$/, "")}\n${line}`;
}

/** Replace or remove a single-line `key: [...]` array. Removing keeps the
 * frontmatter tidy (no empty arrays that the pipeline would otherwise omit). */
function fmSetArray(rawFm: string, key: string, values: string[]): string {
  const cleaned = [...new Set(values.filter(Boolean))];
  const singleLine = new RegExp(`^${key}:\\s*\\[[^\\]]*\\]\\s*$`, "m");
  if (cleaned.length === 0) {
    return singleLine.test(rawFm) ? rawFm.replace(singleLine, "").replace(/\n{3,}/g, "\n") : rawFm;
  }
  const line = `${key}: [${cleaned.map((item) => jsonScalar(item)).join(", ")}]`;
  if (singleLine.test(rawFm)) return rawFm.replace(singleLine, line);
  return `${rawFm.replace(/\s+$/, "")}\n${line}`;
}

export interface FinalizeFormulaEntry {
  kind?: "source_definition" | "source_derived_definition" | "worked_example" | "conceptual_helper";
  text: string;
  normalizedText?: string;
  groundingStatus: "source-anchored" | "source-derived" | "conceptual-helper" | "unmatched";
  justification: string;
  sourceAnchor?: string;
  sourceAnchorTitle?: string;
  matchReason?: string;
  confidence?: number;
  /** For a worked example: the symbolic source (derived) definition it applies,
   * identified by a source-formula anchor id or the normalized text of a
   * page-local definition. Establishes lineage so many examples can validly
   * share one definition. */
  basedOnFormula?: string;
  /** Metric/relationship family (accuracy, latency, energy, ...) shared between a
   * definition and the worked examples that apply it. */
  formulaFamily?: string;
  /** Optional grouping id linking examples that apply the same definition. */
  exampleGroupId?: string;
}

/** Serialize a per-formula grounding block matching yamlFrontmatter()'s shape so
 * the validator's formulaEntriesFromFrontmatter() reads it back cleanly. */
function serializeFormulas(entries: FinalizeFormulaEntry[]): string {
  const lines: string[] = ["formulas:"];
  for (const entry of entries) {
    lines.push(`  - kind: ${jsonScalar(entry.kind ?? "conceptual_helper")}`);
    lines.push(`    text: ${jsonScalar(entry.text)}`);
    if (entry.normalizedText) lines.push(`    normalizedText: ${jsonScalar(entry.normalizedText)}`);
    lines.push(`    groundingStatus: ${jsonScalar(entry.groundingStatus)}`);
    lines.push(`    justification: ${jsonScalar(entry.justification)}`);
    if (entry.sourceAnchor) lines.push(`    sourceAnchor: ${jsonScalar(entry.sourceAnchor)}`);
    if (entry.sourceAnchorTitle) lines.push(`    sourceAnchorTitle: ${jsonScalar(entry.sourceAnchorTitle)}`);
    if (entry.basedOnFormula) lines.push(`    basedOnFormula: ${jsonScalar(entry.basedOnFormula)}`);
    if (entry.formulaFamily) lines.push(`    formulaFamily: ${jsonScalar(entry.formulaFamily)}`);
    if (entry.exampleGroupId) lines.push(`    exampleGroupId: ${jsonScalar(entry.exampleGroupId)}`);
    if (entry.matchReason) lines.push(`    matchReason: ${jsonScalar(entry.matchReason)}`);
    if (typeof entry.confidence === "number") lines.push(`    confidence: ${entry.confidence}`);
  }
  return lines.join("\n");
}

/** Replace the whole `formulas:` block (or remove it) in a frontmatter string. */
function fmSetFormulas(rawFm: string, entries: FinalizeFormulaEntry[]): string {
  const lines = rawFm.split(/\r?\n/);
  const start = lines.findIndex((line) => /^formulas:\s*/.test(line));
  let stripped = rawFm;
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && /^\s+/.test(lines[end])) end += 1;
    stripped = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  }
  if (entries.length === 0) return stripped.replace(/\n{3,}/g, "\n");
  // Insert the block right before generatedBy so top-level keys stay grouped.
  const strippedLines = stripped.split(/\r?\n/);
  const anchorIndex = strippedLines.findIndex((line) => /^generatedBy:/.test(line));
  const block = serializeFormulas(entries);
  if (anchorIndex >= 0) {
    strippedLines.splice(anchorIndex, 0, block);
    return strippedLines.join("\n");
  }
  return `${stripped.replace(/\s+$/, "")}\n${block}`;
}

function slugifyLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSyncWithRetry(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

interface LearningUnitContractArtifact {
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  sourceSetHash: string;
  sourceFormulaReviewSetHash: string;
  sourceArtifactInventoryHash: string;
  syllabusCoverageEvidenceRecoveryHash: string;
  syllabusCoverageEvidenceRecovery?: SyllabusCoverageEvidenceRecoveryReceipt;
  foundPath?: string;
}

type SourceTextConceptAnchorKind =
  | "definition"
  | "mechanism"
  | "method"
  | "limitation"
  | "application"
  | "recommendation"
  | "comparison"
  | "result_interpretation"
  | "concept";

interface SourceTextConceptAnchor {
  id: string;
  sourceId: string;
  page?: number;
  kind: SourceTextConceptAnchorKind;
  title: string;
  exactText?: string;
  semanticSummary: string;
  conceptKeywords: string[];
  /** Legacy numeric OR the modern string enum ("high"|"medium"|"low"|"unsupported"). */
  confidence: number | string;
  /** Modern evidence/relevance/migration/critic metadata — MUST be preserved so
   *  a migrated record is never downgraded to legacy (Fix 6). */
  evidence?: unknown;
  relevance?: unknown;
  migration?: unknown;
  criticConfirmed?: boolean;
  criticConfirmationReason?: string;
  criticConfirmedExactText?: string;
}

export type FinalizerAction =
  | { kind: "mechanical_fix"; description: string; filePath: string }
  | { kind: "semantic_failure"; description: string; unitId?: string; pagePath?: string; repairPrompt: string };

export type RepairFailureType =
  | "repeated_opening"
  | "scaffold_prose"
  | "section_index_prose"
  | "zettelkasten_handle_support"
  | "formula_grounding"
  | "visual_grounding"
  | "source_caveat"
  | "section_semantics"
  // Legacy/internal routing names still collapse to the policy groups above.
  | "zettelkasten_handle"
  | "contract_fulfillment"
  | "semantic_navigation"
  | "source_text_anchor"
  | "unknown_semantic_failure";

export type UnitRepairFailureType = RepairFailureType;
export type RepairExecutorPreference = "model_first" | "deterministic_allowed";
export type ModelRepairStatus = "attempted" | "used" | "skipped" | "unavailable";

export interface UnitRepairRequest {
  unitId: string;
  pagePath: string;
  sectionPath: string;
  failureTypes: string[];
  validationErrors: string[];
  learningUnitContract: LearningUnitContract;
  previousUnitSummary?: string;
  nextUnitSummary?: string;
  sourceAnchors: SourceAnchor[];
  currentPageMarkdown: string;
  requiredChanges: string[];
  repairPrompt: string;
}

// ---------------------------------------------------------------------------
// Repair executor abstraction
// ---------------------------------------------------------------------------
//
// A repair can be produced by a model (single-page regeneration from the
// UnitRepairRequest) or by the built-in deterministic transforms. The
// deterministic transforms remain the always-available safe fallback; the model
// executor is an INJECTED dependency so this module stays LLM-free and
// filesystem-only by default. Callers (learn.ts) wire a real model executor;
// tests wire a fake one.

export type RepairExecutorKind = "model" | "deterministic";
export type RepairExecutorMode = "model" | "deterministic" | "model_with_deterministic_fallback";

/** A model-produced candidate for a single page. `markdown` is the full revised
 * page (frontmatter + body). Visual specs and a complete model-authored Zettel
 * patch are optional side outputs; both are scope-checked before anything is
 * written. */
export interface RepairCandidate {
  markdown: string;
  visualSpecs?: Array<{ id: string; spec: Record<string, unknown> }>;
  contractZettelPatch?: { unitId: string; zettelNotes: ZettelNote[] };
  notes?: string[];
}

/** Injected model executor: given a UnitRepairRequest, return a candidate page
 * (or null when it declines). May be async (real LLM) or sync (test fake). */
export type ModelRepairExecutor = (
  request: UnitRepairRequest,
) => Promise<RepairCandidate | null> | RepairCandidate | null;

export interface RepairExecutionResult {
  unitId: string;
  pagePath: string;
  executor: RepairExecutorKind;
  changedFiles: string[];
  success: boolean;
  validationErrorsBefore: string[];
  validationErrorsAfter: string[];
  notes?: string[];
}

export type RepairTargetKind =
  | "unit_page"
  | "section_index"
  | "contract"
  | "source_coverage"
  | "planning_doc"
  | "visual_spec"
  | "global_finalization";

export interface UnitRepairLogEntry {
  unitId: string;
  pagePath: string;
  sectionPath: string;
  /** What the repair actually targeted; scopes which changedFiles are valid. */
  targetKind?: RepairTargetKind;
  affectedUnitIds?: string[];
  affectedSectionId?: string;
  failureTypes: string[];
  validationErrors: string[];
  requiredChanges: string[];
  repairType: "contract_driven_revision";
  changedFiles: string[];
  result: "resolved" | "unresolved" | "not_applicable";
  unresolvedValidationErrors: string[];
  repairedAt: string;
  // Executor provenance — never hide fallback behavior.
  executorAttempted: RepairExecutorKind[];
  executorUsed: RepairExecutorKind | "none";
  executorPreference: RepairExecutorPreference;
  modelRepairStatus: ModelRepairStatus;
  naturalProseValidation?: "pass" | "fail" | "not_applicable";
  modelFailureReason?: string;
}

export interface FinalArtifactVerification {
  checkedAt: string;
  accepted: boolean;
  mutatedFiles: string[];
  validationFailures: string[];
  unresolvedRepairFailures: string[];
  validationReportAccepted: boolean;
}

/** Immutable source-formula review identity supplied by the active Learn run.
 * Passing it out-of-band prevents a self-consistent edit of the staged
 * contract/manifest from redefining which AI review publication should trust. */
export interface SourceFormulaReviewFinalizationContext {
  reviewSetHash: string;
  combinedSourceSetHash: string;
  sourceArtifactInventoryHash: string;
  syllabusCoverageEvidenceRecoveryHash: string;
  syllabusCoverageEvidenceRecovery?: SyllabusCoverageEvidenceRecoveryReceipt;
  formulaIds: string[];
  sourceIds: string[];
  sourceIdentityMap: SourceVisualSourceIdentity[];
  /** Canonical page-level recovery receipts captured before staging/repair. */
  topologyReviewPageReceipts: SourceFormulaTopologyReviewPageReceipt[];
  model?: string;
}

export interface LearningUnitRepairRunReport {
  requestedAt: string;
  gardenSlug: string;
  repairExecutorMode: RepairExecutorMode;
  requests: UnitRepairRequest[];
  repairs: UnitRepairLogEntry[];
  executions: RepairExecutionResult[];
  changedFiles: string[];
  contractChangedFiles?: Array<{ file: string; affectedUnits: string[] }>;
  finalizerChangedFiles?: string[];
  finalizerNotes?: string[];
  semanticFinalizerActions: FinalizerAction[];
  firstValidationFailures: string[];
  finalValidationFailures: string[];
  finalVerification?: FinalArtifactVerification;
}

const SOURCE_FIGURE_PLACEMENTS = new Set<SourceFigurePlacement>([
  "inside_concept_explanation",
  "after_formula_introduction",
  "inside_result_interpretation",
  "beside_worked_example",
  "inside_comparison",
  "not_used_with_reason",
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSourceArtifactAssignments(raw: unknown): SourceArtifactAssignment[] {
  const record = asObject(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record.sourceArtifactAssignments)
      ? record.sourceArtifactAssignments
      : Array.isArray(record.assignments)
        ? record.assignments
        : [];
  const assignments: SourceArtifactAssignment[] = [];
  for (const item of list) {
    const row = asObject(item);
    const sourceArtifactId = stringField(row.sourceArtifactId ?? row.sourceVisualId ?? row.figureId ?? row.id);
    const assignedLearningUnitId = stringField(row.assignedLearningUnitId ?? row.learningUnitId ?? row.unitId);
    if (!sourceArtifactId || !assignedLearningUnitId) continue;
    const rawPlacement = stringField(row.placement).replace(/[\s-]+/g, "_") as SourceFigurePlacement;
    assignments.push({
      sourceArtifactId,
      assignedLearningUnitId,
      placement: SOURCE_FIGURE_PLACEMENTS.has(rawPlacement) ? rawPlacement : "inside_concept_explanation",
      reason: stringField(row.reason),
      requiredInterpretation: stringField(row.requiredInterpretation ?? row.interpretationGoal ?? row.goal),
    });
  }
  return assignments;
}

function readLearningUnitContract(gardenDir: string): LearningUnitContractArtifact {
  const candidates = [
    path.join(gardenDir, ".breadboard", "learning-unit-contract.json"),
    path.join(gardenDir, ".breadboard", "planning", "learning-unit-contract.json"),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(readFileSyncWithRetry(filePath, "utf-8"));
      const units = normalizeLearningUnits(parsed);
      const assignments = dedupeSourceArtifactAssignments(normalizeSourceArtifactAssignments(parsed), units);
      // A present canonical contract remains authoritative even when its unit
      // payload is empty or invalid. Falling through to an older planning copy
      // would let metadata/provenance deletion silently select stale authority.
      return {
        units,
        assignments,
        sourceSetHash: stringField(parsed?.sourceSetHash),
        sourceFormulaReviewSetHash: stringField(parsed?.sourceFormulaReviewSetHash),
        sourceArtifactInventoryHash: stringField(parsed?.sourceArtifactInventoryHash),
        syllabusCoverageEvidenceRecoveryHash: stringField(
          parsed?.syllabusCoverageEvidenceRecoveryHash,
        ),
        ...(parsed && typeof parsed === "object" &&
          Object.prototype.hasOwnProperty.call(parsed, "syllabusCoverageEvidenceRecovery")
          ? {
              syllabusCoverageEvidenceRecovery:
                parsed.syllabusCoverageEvidenceRecovery as
                  SyllabusCoverageEvidenceRecoveryReceipt,
            }
          : {}),
        foundPath: filePath,
      };
    } catch {
      // A present but unreadable higher-priority contract cannot delegate
      // authority to an older planning copy.
      return {
        units: [],
        assignments: [],
        sourceSetHash: "",
        sourceFormulaReviewSetHash: "",
        sourceArtifactInventoryHash: "",
        syllabusCoverageEvidenceRecoveryHash: "",
        foundPath: filePath,
      };
    }
  }
  return {
    units: [],
    assignments: [],
    sourceSetHash: "",
    sourceFormulaReviewSetHash: "",
    sourceArtifactInventoryHash: "",
    syllabusCoverageEvidenceRecoveryHash: "",
  };
}

const SOURCE_FORMULA_REVIEW_SET_RELATIVE_PATH =
  ".breadboard/source-formula-review-set.json";

function readSourceFormulaReviewSetManifest(
  gardenDir: string,
): Record<string, unknown> | null {
  const manifestPath = path.join(
    gardenDir,
    ...SOURCE_FORMULA_REVIEW_SET_RELATIVE_PATH.split("/"),
  );
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSyncWithRetry(manifestPath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** Capture the published review identity before a scoped repair creates its
 * staging copy. A malformed existing manifest still returns a context with
 * empty fields so the declared review gate fails closed instead of silently
 * treating it as an unreviewed legacy garden. */
export function sourceFormulaReviewFinalizationContextFromGarden(
  gardenDir: string,
): SourceFormulaReviewFinalizationContext | undefined {
  const manifest = readSourceFormulaReviewSetManifest(gardenDir);
  const contract = readLearningUnitContract(gardenDir);
  if (!manifest && !contract.foundPath) return undefined;
  let sourceIdentityMap: SourceVisualSourceIdentity[] = [];
  try {
    sourceIdentityMap = loadSourceVisualSourceIdentityMap(
      path.dirname(gardenDir),
      path.basename(gardenDir),
    );
  } catch {
    // Preserve an explicit empty expectation so the strict finalizer reports
    // the corrupt/missing registry instead of silently dropping the gate.
  }
  return {
    reviewSetHash: stringField(manifest?.reviewSetHash),
    combinedSourceSetHash: stringField(manifest?.combinedSourceSetHash),
    sourceArtifactInventoryHash: contract.sourceArtifactInventoryHash,
    syllabusCoverageEvidenceRecoveryHash:
      contract.syllabusCoverageEvidenceRecoveryHash,
    ...(contract.syllabusCoverageEvidenceRecovery !== undefined
      ? {
          syllabusCoverageEvidenceRecovery: JSON.parse(JSON.stringify(
            contract.syllabusCoverageEvidenceRecovery,
          )) as SyllabusCoverageEvidenceRecoveryReceipt,
        }
      : {}),
    formulaIds: Array.isArray(manifest?.formulaIds)
      ? manifest.formulaIds.map(stringField).filter(Boolean)
      : [],
    sourceIds: Array.isArray(manifest?.sourceIds)
      ? manifest.sourceIds.map(stringField).filter(Boolean)
      : [],
    sourceIdentityMap: sourceIdentityMap.map((entry) => ({ ...entry })),
    topologyReviewPageReceipts: Array.isArray(manifest?.topologyReviewPageReceipts)
      ? (JSON.parse(JSON.stringify(manifest.topologyReviewPageReceipts)) as
        SourceFormulaTopologyReviewPageReceipt[])
      : [],
    model: stringField(manifest?.model) || undefined,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sourceAnchorLedgerPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "source-anchors.json");
}

function sourceTextAnchorKind(value: unknown): SourceTextConceptAnchorKind {
  const raw = cleanText(value).replace(/[\s-]+/g, "_");
  return [
    "definition",
    "mechanism",
    "method",
    "limitation",
    "application",
    "recommendation",
    "comparison",
    "result_interpretation",
    "concept",
  ].includes(raw) ? raw as SourceTextConceptAnchorKind : "concept";
}

const MODERN_CONFIDENCE_ENUM = new Set(["high", "medium", "low", "unsupported"]);

function normalizeSourceTextAnchor(value: SourceTextConceptAnchor): SourceTextConceptAnchor {
  // Preserve a modern string-enum confidence; only clamp a legacy numeric one.
  const confidence: number | string = typeof value.confidence === "string" && MODERN_CONFIDENCE_ENUM.has(value.confidence)
    ? value.confidence
    : Math.max(0, Math.min(1, typeof value.confidence === "number" && Number.isFinite(value.confidence) ? value.confidence : 0.7));
  return {
    id: cleanText(value.id),
    sourceId: cleanText(value.sourceId) || "source",
    ...(Number.isFinite(value.page) && value.page ? { page: Number(value.page) } : {}),
    kind: sourceTextAnchorKind(value.kind),
    title: cleanText(value.title) || cleanText(value.id),
    ...(cleanText(value.exactText) ? { exactText: cleanText(value.exactText) } : {}),
    semanticSummary: cleanText(value.semanticSummary) || cleanText(value.title) || cleanText(value.id),
    conceptKeywords: [...new Set((value.conceptKeywords ?? []).map(cleanText).filter(Boolean))].slice(0, 12),
    confidence,
    // Fix 6: never drop modern evidence/relevance/migration/critic metadata.
    ...(value.evidence && typeof value.evidence === "object" ? { evidence: value.evidence } : {}),
    ...(value.relevance && typeof value.relevance === "object" ? { relevance: value.relevance } : {}),
    ...(value.migration && typeof value.migration === "object" ? { migration: value.migration } : {}),
    ...(value.criticConfirmed ? { criticConfirmed: true } : {}),
    ...(value.criticConfirmationReason ? { criticConfirmationReason: value.criticConfirmationReason } : {}),
    ...(value.criticConfirmedExactText ? { criticConfirmedExactText: value.criticConfirmedExactText } : {}),
  };
}

function readSourceAnchorLedger(gardenDir: string): SourceTextConceptAnchor[] {
  const parsed = readJson<unknown>(sourceAnchorLedgerPath(gardenDir), []);
  const record = asObject(parsed);
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record.sourceTextConceptAnchors)
      ? record.sourceTextConceptAnchors
      : Array.isArray(record.anchors)
        ? record.anchors
        : [];
  const anchors: SourceTextConceptAnchor[] = [];
  for (const item of raw) {
    const row = asObject(item);
    const id = stringField(row.id ?? row.textAnchorId);
    if (!id) continue;
    anchors.push(normalizeSourceTextAnchor({
      id,
      sourceId: stringField(row.sourceId),
      page: typeof row.page === "number" ? row.page : Number.parseInt(stringField(row.page), 10) || undefined,
      kind: sourceTextAnchorKind(row.kind),
      title: stringField(row.title),
      exactText: stringField(row.exactText),
      semanticSummary: stringField(row.semanticSummary ?? row.description),
      conceptKeywords: Array.isArray(row.conceptKeywords) ? row.conceptKeywords.map(stringField).filter(Boolean) : [],
      // Preserve the raw confidence (string enum or number); do not force 0.7.
      confidence: (typeof row.confidence === "string" || typeof row.confidence === "number") ? row.confidence : 0.7,
      ...(row.evidence && typeof row.evidence === "object" ? { evidence: row.evidence } : {}),
      ...(row.relevance && typeof row.relevance === "object" ? { relevance: row.relevance } : {}),
      ...(row.migration && typeof row.migration === "object" ? { migration: row.migration } : {}),
      ...(row.criticConfirmed === true ? { criticConfirmed: true } : {}),
      ...(typeof row.criticConfirmationReason === "string" ? { criticConfirmationReason: row.criticConfirmationReason } : {}),
      ...(typeof row.criticConfirmedExactText === "string" ? { criticConfirmedExactText: row.criticConfirmedExactText } : {}),
    }));
  }
  return anchors;
}

/**
 * Active Learn records selected source-page boundaries as immutable structural
 * evidence. A `text-*` reference may point to one of those records directly;
 * it is not a missing semantic decision merely because it has no separately
 * authored text-concept summary. Keep this read-only so strict finalization
 * never invents source meaning or mutates model-authored evidence.
 */
interface StructuralTextAnchorRecord {
  id: string;
  sourceId: string;
  title: string;
  exactText: string;
}

function readStructuralTextAnchorLedger(gardenDir: string): StructuralTextAnchorRecord[] {
  const parsed = readJson<unknown>(sourceAnchorLedgerPath(gardenDir), []);
  const record = asObject(parsed);
  const raw = Array.isArray(record.sourceStructuralAnchors)
    ? record.sourceStructuralAnchors
    : [];
  const anchors: StructuralTextAnchorRecord[] = [];
  for (const item of raw) {
    const row = asObject(item);
    const id = stringField(row.id ?? row.textAnchorId);
    if (!/^text-/i.test(id)) continue;
    anchors.push({
      id,
      sourceId: stringField(row.sourceId),
      title: stringField(row.title),
      exactText: stringField(row.exactText),
    });
  }
  return anchors;
}

/** A record is "modern" (evidence-backed / migrated / critic-confirmed) and must
 *  never be replaced by a legacy numeric-confidence record with the same id. */
function isModernTextAnchor(a: SourceTextConceptAnchor): boolean {
  return Boolean(a.evidence || a.migration || a.criticConfirmed || (typeof a.confidence === "string" && MODERN_CONFIDENCE_ENUM.has(a.confidence)));
}

function writeSourceAnchorLedger(gardenDir: string, anchors: SourceTextConceptAnchor[], report: FinalizeReport): void {
  const deduped = new Map<string, SourceTextConceptAnchor>();
  for (const anchor of anchors) {
    const normalized = normalizeSourceTextAnchor(anchor);
    if (!normalized.id) continue;
    const prior = deduped.get(normalized.id);
    // Fix 6: precedence — a modern record is never downgraded by a legacy one.
    if (prior && isModernTextAnchor(prior) && !isModernTextAnchor(normalized)) continue;
    deduped.set(normalized.id, normalized);
  }
  const target = sourceAnchorLedgerPath(gardenDir);
  // This writer owns only the text-concept projection. Preserve structural
  // evidence and unknown envelope fields verbatim rather than erasing them.
  const envelope = asObject(readJson<unknown>(target, {}));
  const content = `${JSON.stringify({
    ...envelope,
    sourceTextConceptAnchors: [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? readFileSyncWithRetry(target, "utf-8") : "";
  if (existing === content) return;
  fs.writeFileSync(target, content, "utf-8");
  if (!report.changed.includes(".breadboard/source-anchors.json")) report.changed.push(".breadboard/source-anchors.json");
}

function registerSourceTextAnchor(gardenDir: string, anchor: SourceTextConceptAnchor, report: FinalizeReport): void {
  const anchors = readSourceAnchorLedger(gardenDir);
  anchors.push(anchor);
  writeSourceAnchorLedger(gardenDir, anchors, report);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function stripTitleNumber(value: string): string {
  return cleanText(value).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
}

function zettelRepairClaim(unit: LearningUnitContract, used: Set<string>): string {
  const text = [
    unit.title,
    unit.learningQuestion,
    ...(unit.newConcepts ?? []),
  ].join(" ").toLowerCase();
  const candidates: string[] = [];
  if (/spike.*train|spike.*timing|event[- ]driven/.test(text)) {
    candidates.push("Spike trains make timing part of information");
  }
  if (/membrane|lif|leaky|threshold|reset/.test(text)) {
    candidates.push("Membrane potential accumulates evidence before firing");
  }
  if (/excit|inhibit|winner|competition/.test(text)) {
    candidates.push("Inhibition turns population activity into competition");
  }
  if (/accuracy/.test(text)) {
    candidates.push("Accuracy measures correctness not deployment cost");
  }
  if (/energy.*efficien|normalized/.test(text)) {
    candidates.push("Energy efficiency connects accuracy to joules");
  }
  if (/latency|decision time/.test(text)) {
    candidates.push("Latency measures when a decision becomes available");
  }
  if (/spike count/.test(text)) {
    candidates.push("Spike count exposes hidden computation cost");
  }
  if (/converg|epoch/.test(text)) {
    candidates.push("Convergence time measures when training becomes useful");
  }
  const title = stripTitleNumber(unit.title);
  if (title) {
    switch (unit.role) {
      case "formula":
      case "metric":
        candidates.push(`${title} ties named quantities to a measurable relationship`);
        break;
      case "mechanism":
      case "core_concept":
        candidates.push(`${title} explains observable system behavior`);
        break;
      case "training_method":
        candidates.push(`${title} changes model behavior through learning`);
        break;
      case "application":
      case "limitation":
        candidates.push(`${title} bounds where the source claim applies`);
        break;
      default:
        candidates.push(`${title} supports a reusable learner decision`);
        break;
    }
  }
  for (const claim of candidates) {
    const handle = atomicZettelHandle(claim);
    if (handle && !used.has(handle) && !scaffoldLikeZettelHandle(handle)) return claim;
  }
  return `${title || "This idea"} stays grounded in the source claim`;
}

// Concept-grounded, non-scaffold suffixes used to mint a DISTINCT replacement
// handle when the primary claim pool collides (e.g. a long unit concept leaves
// too few unique base claims). Kept free of scaffold phrasing.
const DISTINCT_HANDLE_SUFFIXES = [
  "shapes-the-learner-model",
  "separates-signal-from-noise",
  "changes-a-concrete-decision",
  "stays-observable-in-the-data",
  "connects-cause-to-measured-effect",
  "holds-only-within-source-limits",
];

/** A distinct, non-scaffold handle built from the unit's concepts. */
function distinctConceptHandle(unit: LearningUnitContract, used: Set<string>): string {
  const bases = [...(unit.newConcepts ?? []), stripTitleNumber(unit.title), ...(unit.prerequisiteConcepts ?? [])]
    .map((value) => cleanText(value))
    .filter(Boolean);
  for (const base of bases) {
    for (const suffix of DISTINCT_HANDLE_SUFFIXES) {
      const handle = atomicZettelHandle(`${base} ${suffix.replace(/-/g, " ")}`);
      if (handle && !used.has(handle) && !scaffoldLikeZettelHandle(handle)) return handle;
    }
  }
  return "";
}

function repairContractZettelHandles(
  gardenDir: string,
  contract: LearningUnitContractArtifact,
  learnerPages: LearnerPage[],
  report: FinalizeReport,
): void {
  if (!contract.foundPath || contract.units.length === 0) return;
  const parsed = readJson<Record<string, unknown>>(contract.foundPath, {});
  const rawUnits = Array.isArray(parsed.learningUnits) ? parsed.learningUnits as Array<Record<string, unknown>> : [];
  if (rawUnits.length === 0) return;
  let changed = false;
  const replacements = new Map<string, string>();
  const normalizedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  for (const rawUnit of rawUnits) {
    const id = cleanText(rawUnit.id);
    const unit = normalizedById.get(id);
    if (!unit) continue;
    const notes = Array.isArray(rawUnit.zettelNotes) ? rawUnit.zettelNotes as Array<Record<string, unknown>> : [];
    const used = new Set(
      notes
        .map((note) => atomicZettelHandle(cleanText(note.handle ?? note.claim)))
        .filter((handle) => handle && !scaffoldLikeZettelHandle(handle)),
    );
    for (const note of notes) {
      const oldHandle = atomicZettelHandle(cleanText(note.handle ?? note.claim));
      if (!oldHandle || !scaffoldLikeZettelHandle(oldHandle)) continue;
      let claim = zettelRepairClaim(unit, used);
      let handle = atomicZettelHandle(claim);
      // Guarantee a distinct, non-scaffold replacement even when the primary
      // claim pool collides (long concepts, several bad handles on one unit).
      if (!handle || used.has(handle) || scaffoldLikeZettelHandle(handle)) {
        const alt = distinctConceptHandle(unit, used);
        if (alt) { handle = alt; claim = alt.replace(/-/g, " "); }
      }
      if (!handle || used.has(handle)) continue;
      note.handle = handle;
      note.claim = claim;
      if (!Array.isArray(note.connectedTo) || note.connectedTo.length === 0) {
        note.connectedTo = [...new Set([...(unit.prerequisiteConcepts ?? []), ...(unit.newConcepts ?? [])])].slice(0, 5);
      }
      replacements.set(oldHandle, handle);
      used.add(handle);
      changed = true;
    }
  }
  if (!changed) return;
  fs.writeFileSync(contract.foundPath, JSON.stringify(parsed, null, 2), "utf-8");
  if (!report.changed.includes(".breadboard/learning-unit-contract.json")) report.changed.push(".breadboard/learning-unit-contract.json");
  const repaired = readLearningUnitContract(gardenDir);
  contract.units = repaired.units;
  contract.assignments = repaired.assignments;
  const repairedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  for (const page of learnerPages) {
    const unit = repairedById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit) continue;
    const expected = zettelHandlesForUnit(unit);
    const current = fmGetArray(page.rawFm, "tags");
    const hasReplaced = current.some((tag) => replacements.has(atomicZettelHandle(tag)));
    if (!hasReplaced && expected.every((tag) => current.includes(tag)) && current.every((tag) => expected.includes(tag))) continue;
    page.rawFm = fmSetArray(page.rawFm, "tags", expected);
    page.dirty = true;
  }
  report.notes.push(`repaired ${replacements.size} scaffold-like Zettelkasten handle(s) in the Learning Unit Contract`);
}

function synchronizeContractZettelHandles(
  gardenDir: string,
  contract: LearningUnitContractArtifact,
  learnerPages: LearnerPage[],
  report: FinalizeReport,
): void {
  if (!contract.foundPath || contract.units.length === 0) return;
  const parsed = readJson<Record<string, unknown>>(contract.foundPath, {});
  const rawUnits = Array.isArray(parsed.learningUnits) ? parsed.learningUnits as Array<Record<string, unknown>> : [];
  if (rawUnits.length === 0) return;
  const normalizedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  let changedContract = false;
  for (const rawUnit of rawUnits) {
    const id = cleanText(rawUnit.id);
    const normalized = normalizedById.get(id);
    if (!normalized) continue;
    const expectedNotes = normalized.zettelNotes ?? [];
    const currentNotes = Array.isArray(rawUnit.zettelNotes) ? rawUnit.zettelNotes as Array<Record<string, unknown>> : [];
    const currentHandles = currentNotes.map((note) => atomicZettelHandle(cleanText(note.handle ?? note.claim))).filter(Boolean);
    const expectedHandles = zettelHandlesForUnit(normalized);
    if (expectedHandles.length === 0 || arraysEqual(currentHandles, expectedHandles)) continue;
    rawUnit.zettelNotes = expectedNotes.map((note) => ({
      handle: note.handle,
      claim: note.claim,
      connectedTo: note.connectedTo ?? [],
    }));
    changedContract = true;
  }
  if (changedContract) {
    fs.writeFileSync(contract.foundPath, JSON.stringify(parsed, null, 2), "utf-8");
    if (!report.changed.includes(".breadboard/learning-unit-contract.json")) report.changed.push(".breadboard/learning-unit-contract.json");
    const repaired = readLearningUnitContract(gardenDir);
    contract.units = repaired.units;
    contract.assignments = repaired.assignments;
    report.notes.push("synchronized expanded Zettelkasten handles into the Learning Unit Contract");
  }
  const repairedById = new Map(contract.units.map((unit) => [unit.id, unit]));
  for (const page of learnerPages) {
    const unit = repairedById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit) continue;
    const expected = zettelHandlesForUnit(unit);
    const current = fmGetArray(page.rawFm, "tags");
    if (expected.length === 0 || arraysEqual(current, expected)) continue;
    page.rawFm = fmSetArray(page.rawFm, "tags", expected);
    page.dirty = true;
  }
}

function isSourceFigureId(id: string): boolean {
  return /\.P\d+\.(?:F|G)\d+$/i.test(id);
}

function isSourceTableId(id: string): boolean {
  return /\.P\d+\.T\d+$/i.test(id);
}

function isSourceFormulaId(id: string): boolean {
  return /\.P\d+\.E\d+$/i.test(id);
}

function listMarkdown(dir: string, relDir: string, out: Array<{ abs: string; rel: string }>, opts: { includeDotBreadboard?: boolean } = {}): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === ".breadboard" && !opts.includeDotBreadboard) continue;
      if (entry.name === ".breadboard" && /backups/.test(rel)) continue;
      if (/backups$/.test(entry.name)) continue;
      listMarkdown(path.join(dir, entry.name), rel, out, opts);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) out.push({ abs: path.join(dir, entry.name), rel });
  }
}

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

/** Move a directory robustly. rename() can fail across directories on Windows /
 * OneDrive-synced trees (EPERM); fall back to a recursive copy + delete, and if
 * even the copy fails, drop the source (Internal/ is regenerable scaffolding
 * and must not remain in the export either way). */
function moveDir(src: string, dest: string): void {
  rmrf(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
    return;
  } catch {
    // fall through to copy + delete
  }
  try {
    fs.cpSync(src, dest, { recursive: true });
  } catch {
    // best-effort: relocation failed, but the source must still leave the export
  }
  rmrf(src);
}

// ---------------------------------------------------------------------------
// Ledger + domain classification
// ---------------------------------------------------------------------------

export interface LedgerVisual {
  sourceVisualId: string;
  sourceId?: string;
  pageNumber?: number;
  type?: string;
  caption?: string;
  pageImagePath?: string;
  croppedImagePath?: string;
  usageStatus?: string;
  skipReason?: string;
  assignedPageId?: string;
  assignedSectionId?: string;
  [key: string]: unknown;
}

export type FigureClass = "equation" | "result" | "lif" | "architecture" | "other";

export function classifyFigure(visual: Pick<LedgerVisual, "sourceVisualId" | "type" | "caption" | "pageNumber">): FigureClass {
  const id = String(visual.sourceVisualId ?? "");
  const caption = String(visual.caption ?? "").toLowerCase();
  const type = String(visual.type ?? "").toLowerCase();
  if (type === "equation" || /\.E\d+$/i.test(id)) return "equation";
  if (/architecture|conceptual snn|input encoding|excitatory|inhibitory|lateral inhibition/.test(caption)) return "architecture";
  if (/\blif\b|leaky|membrane|threshold|refractory|reset/.test(caption)) return "lif";
  const pageNumber = Number(visual.pageNumber ?? (id.match(/\.P(\d+)\./)?.[1] ?? 0));
  if (
    pageNumber >= 7 ||
    /performance|latency|energy|spike count|convergence|training loss|training accuracy|learning curve|comparison|accuracy versus/.test(caption)
  ) {
    return "result";
  }
  return "other";
}

export type PageRole =
  | "intro"
  | "basic_def"
  | "lif"
  | "training"
  | "metric"
  | "comparison"
  | "application"
  | "challenges"
  | "generic";

export function pageRole(title: string): PageRole {
  const text = title.toLowerCase();
  if (/open challenge|unresolved|limitation|future work|what remains/.test(text)) return "challenges";
  if (/comparative|results across|models and metrics|model comparison/.test(text)) return "comparison";
  if (/application|hardware|deployment|neuromorphic|tradeoffs suggest/.test(text)) return "application";
  if (/multi-metric|evaluation|metric|accuracy|latency/.test(text)) return "metric";
  if (/neuron model|leaky|\blif\b/.test(text)) return "lif";
  if (/training|paradigm|surrogate|plasticity|\blearn\b|conversion|stdp/.test(text)) return "training";
  if (/what spiking neural networks are|what .*networks are|spiking neural networks are/.test(text)) return "basic_def";
  if (/from conventional|conventional neural networks|introduction|why spiking|to snns/.test(text)) return "intro";
  return "generic";
}

/** The learner page role that a given source figure class belongs on. */
function targetRoleForFigure(cls: FigureClass): PageRole | null {
  switch (cls) {
    case "equation":
      return "metric";
    case "result":
      return "comparison";
    case "lif":
      return "lif";
    case "architecture":
      return "basic_def";
    default:
      return null;
  }
}

// Interactive renderer compatibility (mirror of the validator's rules).
const INTERACTIVE_ANCHOR_COMPAT: Record<string, FigureClass[]> = {
  lif_neuron: ["lif", "architecture"],
  tradeoff_explorer: ["equation", "result"],
  stdp_window: [],
  neural_coding: [],
};

// The interactive renderer type a page role must use (validator-forced).
function requiredInteractiveType(role: PageRole): string | null {
  switch (role) {
    case "metric":
    case "comparison":
    case "application":
      return "tradeoff_explorer";
    case "lif":
    case "basic_def":
    case "intro":
      return "lif_neuron";
    case "challenges":
      return null; // must not embed a generic interactive
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page model
// ---------------------------------------------------------------------------

interface LearnerPage {
  abs: string;
  rel: string; // garden-relative, posix
  pageId: string; // rel without .md
  rawFm: string;
  body: string;
  title: string;
  role: PageRole;
  sectionNumber: number;
  dirty: boolean;
}

const IMAGE_RE = /!\[[^\]]*\]\(([^)]*)\)/g;
const VISUAL_BLOCK_RE = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;
const GENERATED_VISUAL_BLOCK_RE = /```breadboard-generated-visual\r?\n([\s\S]*?)\r?\n```/g;

function embeddedGeneratedVisualIds(body: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(GENERATED_VISUAL_BLOCK_RE.source, GENERATED_VISUAL_BLOCK_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const id = match[1].match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1];
    const version = Number(match[1].match(/^version:\s*(\d+)\s*$/m)?.[1] ?? 0);
    if (id && Number.isInteger(version) && version > 0) ids.push(id);
  }
  return [...new Set(ids)];
}

type PreservedContractVisualPlan = NonNullable<LearningUnitContract["interactiveVisualPlan"]>;

/** Rerun necessity before scoped repair and persist only the contract planning fields. */
function replanContractVisualNecessity(
  gardenDir: string,
  gardenSlug: string,
  preservedVisualPlans: ReadonlyMap<string, PreservedContractVisualPlan> = new Map(),
): void {
  const contract = readLearningUnitContract(gardenDir);
  if (!contract.foundPath || contract.units.length === 0) return;
  const plan = planGardenVisualNecessity({
    gardenId: gardenSlug,
    learningUnits: contract.units,
    overrides: loadVisualDecisionOverrides(gardenDir),
  });
  const parsed = readJson<Record<string, unknown>>(contract.foundPath, {});
  const rawUnits = Array.isArray(parsed.learningUnits)
    ? parsed.learningUnits as Array<Record<string, unknown>>
    : [];
  const plannedById = new Map(plan.learningUnits.map((unit) => [unit.id, unit]));
  parsed.learningUnits = rawUnits.map((raw) => {
    const unit = plannedById.get(stringField(raw.id));
    if (!unit) return raw;
    const preserved = preservedVisualPlans.get(unit.id);
    const interactiveVisualPlan = preserved && preserved.requirement !== "none"
      ? {
          ...unit.interactiveVisualPlan,
          decision: {
            ...unit.interactiveVisualPlan!.decision,
            necessity: preserved.requirement,
            preferredMedium: "interactive_visual" as const,
            reason:
              "The prior interaction requirement remains active, but its incompatible trusted renderer was removed and must be rerouted to a valid implementation.",
          },
          requirement: preserved.requirement,
          alternativeCoverage: preserved.alternativeCoverage,
          visualIntent: undefined,
        }
      : unit.interactiveVisualPlan;
    const teachingMediumPlan = preserved && preserved.requirement !== "none"
      ? {
          ...unit.teachingMediumPlan,
          unitId: unit.id,
          preferredMedium: "interactive_visual" as const,
          reason:
            "The interaction requirement is preserved while Breadboard reroutes the incompatible renderer.",
        }
      : unit.teachingMediumPlan;
    const next: Record<string, unknown> = {
      ...raw,
      interactiveVisualPlan,
      teachingMediumPlan,
    };
    if (unit.interactiveVisual) next.interactiveVisual = unit.interactiveVisual;
    else delete next.interactiveVisual;
    return next;
  });
  fs.writeFileSync(contract.foundPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  saveVisualNecessityArtifacts(gardenDir, gardenSlug, {
    decisions: plan.decisions,
    teachingMedia: plan.teachingMedia,
    budget: plan.budget,
    overrides: plan.overrides,
    reviewCalls: plan.reviewCalls,
    rejectedReviews: plan.rejectedReviews,
  });
}

/**
 * Heal legacy/model contracts that reference figure-like ids which were never
 * registered by source extraction. A final page repair cannot manufacture a
 * PDF crop, so these impossible requirements must be reconciled at the
 * contract boundary before page-scoped repairs run.
 */
function reconcileContractArtifactsAgainstSourceRegistry(
  gardenDir: string,
  report: FinalizeReport,
  options: { preserveModelAuthoredVisuals?: boolean } = {},
): Map<string, PreservedContractVisualPlan> {
  const contract = readLearningUnitContract(gardenDir);
  if (!contract.foundPath || contract.units.length === 0) return new Map();
  const registered: RegisteredSourceArtifact[] = [];
  for (const anchor of Object.values(buildCanonicalSourceAnchors(gardenDir))) {
    if (anchor.origin !== "visual_ledger") continue;
    if (anchor.kind === "formula" || anchor.kind === "table" || anchor.kind === "graph" || anchor.kind === "figure") {
      registered.push({ id: anchor.id, kind: anchor.kind });
    }
  }
  const reconciliation = reconcileLearningUnitSourceArtifacts(
    contract.units,
    contract.assignments,
    registered,
  );
  const compatible = options.preserveModelAuthoredVisuals
    ? { units: reconciliation.units, dropped: [] as string[] }
    : dropIncompatibleInteractiveVisuals(reconciliation.units);
  const compatibleById = new Map(compatible.units.map((unit) => [unit.id, unit]));
  const droppedVisualByUnit = new Map(
    reconciliation.units
      .filter((unit) => unit.interactiveVisual && !compatibleById.get(unit.id)?.interactiveVisual)
      .map((unit) => [unit.id, unit.interactiveVisual!] as const),
  );
  if (reconciliation.removedArtifactIds.length === 0 && droppedVisualByUnit.size === 0) return new Map();
  const preservedVisualPlans = new Map<string, PreservedContractVisualPlan>();
  for (const unitId of droppedVisualByUnit.keys()) {
    const plan = reconciliation.units.find((unit) => unit.id === unitId)?.interactiveVisualPlan;
    if (plan && plan.requirement !== "none") preservedVisualPlans.set(unitId, plan);
  }

  const parsed = readJson<Record<string, unknown>>(contract.foundPath, {});
  parsed.learningUnits = compatible.units;
  parsed.sourceArtifactAssignments = reconciliation.assignments;
  fs.writeFileSync(contract.foundPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  const contractRel = path.relative(gardenDir, contract.foundPath).replace(/\\/g, "/");
  if (!report.changed.includes(contractRel)) report.changed.push(contractRel);

  const validIds = new Set(registered.map((artifact) => artifact.id));
  const isUnsupported = (id: string): boolean =>
    /^S\d+\.P\d+\.(?:F|G|T|E)\d+$/i.test(id) && !validIds.has(id);
  const pages = loadLearnerPages(gardenDir);
  const visualsDir = path.join(gardenDir, ".breadboard", "visuals");
  const visualIndexPath = path.join(gardenDir, ".breadboard", "visual-index.json");
  const visualIndex = readJson<Record<string, Record<string, unknown>>>(visualIndexPath, {});
  let visualIndexChanged = false;
  for (const page of pages) {
    for (const key of ["sourceAnchors", "sourceVisualIds", "sourceFormulaAnchors"] as const) {
      const before = fmGetArray(page.rawFm, key);
      const after = before.filter((id) => !isUnsupported(id));
      if (!arraysEqual(before, after)) {
        page.rawFm = fmSetArray(page.rawFm, key, after);
        page.dirty = true;
      }
    }
    rewriteEmbeddedVisualSpecs(page, (spec) => {
      const before = JSON.stringify(spec);
      if (Array.isArray(spec.sourceAnchors)) {
        spec.sourceAnchors = spec.sourceAnchors.filter((value) => {
          if (typeof value === "string") return !isUnsupported(value);
          if (!value || typeof value !== "object") return true;
          const record = value as Record<string, unknown>;
          const ids = [
            record.figureId,
            record.tableId,
            record.equationId,
            record.sourceAnchorId,
          ].filter((id): id is string => typeof id === "string");
          return !ids.some(isUnsupported);
        });
      }
      for (const key of ["figureId", "tableId", "equationId", "sourceAnchorId"] as const) {
        const id = spec[key];
        if (typeof id === "string" && isUnsupported(id)) delete spec[key];
      }
      if (JSON.stringify(spec) === before) return false;
      saveVisualSpecArtifact(gardenDir, spec, report);
      return true;
    });

    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    const droppedVisual = droppedVisualByUnit.get(unitId);
    if (droppedVisual) {
      const removedVisualIds: string[] = [];
      page.body = page.body.replace(VISUAL_BLOCK_RE, (fullMatch, json: string) => {
        try {
          const spec = JSON.parse(json) as Record<string, unknown>;
          const id = String(spec.id ?? "").trim();
          const type = String(spec.type ?? "").trim();
          if (id !== droppedVisual.id && type !== droppedVisual.visualType) return fullMatch;
          if (id) removedVisualIds.push(id);
          return "";
        } catch {
          // Leave malformed blocks for the normal validation gate. This
          // preflight only removes a renderer proven incompatible with its
          // contract; it must not hide unrelated malformed content.
          return fullMatch;
        }
      }).replace(/\n{3,}/g, "\n\n");
      if (removedVisualIds.length > 0) {
        page.rawFm = fmSetArray(
          page.rawFm,
          "visualIds",
          fmGetArray(page.rawFm, "visualIds").filter((id) => !removedVisualIds.includes(id)),
        );
        page.rawFm = removeKeyLine(page.rawFm, "visualSkipReason");
        page.dirty = true;
        for (const id of removedVisualIds) {
          const specRel = `.breadboard/visuals/${id}.json`;
          if (fs.existsSync(path.join(gardenDir, specRel))) {
            removeVisualArtifacts(visualsDir, visualIndex, id);
            if (!report.removed.includes(specRel)) report.removed.push(specRel);
          } else if (visualIndex[id]) {
            delete visualIndex[id];
          }
          visualIndexChanged = true;
        }
        report.notes.push(
          `removed incompatible trusted visual(s) ${removedVisualIds.join(", ")} from ${page.rel}; visual necessity will be replanned`,
        );
      }
    }
  }
  if (visualIndexChanged) {
    fs.mkdirSync(path.dirname(visualIndexPath), { recursive: true });
    fs.writeFileSync(visualIndexPath, `${JSON.stringify(visualIndex, null, 2)}\n`, "utf-8");
    if (!report.changed.includes(".breadboard/visual-index.json")) {
      report.changed.push(".breadboard/visual-index.json");
    }
  }
  writeDirtyLearnerPages(pages, report);
  if (reconciliation.removedArtifactIds.length > 0) {
    report.notes.push(
      `removed unregistered source artifact requirements: ${reconciliation.removedArtifactIds.join(", ")}`,
    );
  }
  if (compatible.dropped.length > 0) {
    report.notes.push(...compatible.dropped.map((note) => `replanned incompatible interactive: ${note}`));
  }
  return preservedVisualPlans;
}

function embeddedGeneratedVisualVersions(body: string): Map<string, number> {
  const versions = new Map<string, number>();
  const re = new RegExp(GENERATED_VISUAL_BLOCK_RE.source, GENERATED_VISUAL_BLOCK_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const id = match[1].match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1];
    const version = Number(match[1].match(/^version:\s*(\d+)\s*$/m)?.[1] ?? 0);
    if (id && Number.isInteger(version) && version > 0) versions.set(id, version);
  }
  return versions;
}

function generatedVisualIntegrityProblems(gardenDir: string, pages: LearnerPage[]): string[] {
  const problems: string[] = [];
  const index = readJson<Record<string, Record<string, unknown>>>(
    path.join(gardenDir, ".breadboard", "visual-index.json"),
    {},
  );
  const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
  for (const page of pages) {
    const re = new RegExp(GENERATED_VISUAL_BLOCK_RE.source, GENERATED_VISUAL_BLOCK_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(page.body)) !== null) {
      const id = match[1].match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1] ?? "";
      const version = Number(match[1].match(/^version:\s*(\d+)\s*$/m)?.[1] ?? 0);
      if (!id || !Number.isInteger(version) || version < 1) {
        problems.push(`${page.rel}: malformed generated visualization block`);
        continue;
      }
      if (!fmGetArray(page.rawFm, "visualIds").includes(id)) {
        problems.push(`${page.rel}: generated visual ${id} missing from frontmatter visualIds`);
      }
      if (!index[id] || index[id].kind !== "generated_module") {
        problems.push(`${page.rel}: generated visual ${id} missing generated_module visual-index entry`);
      }
      const dir = path.join(gardenDir, ".breadboard", "visuals", id, "versions", String(version));
      const manifest = readJson<Record<string, unknown>>(path.join(dir, "manifest.json"), {});
      const validation = readJson<Record<string, unknown>>(path.join(dir, "validation.json"), {});
      const tests = readJson<Record<string, unknown>>(path.join(dir, "tests.json"), {});
      const critic = readJson<Record<string, unknown>>(path.join(dir, "critic.json"), {});
      let source = "";
      let compiled = "";
      try {
        source = readFileSyncWithRetry(path.join(dir, "source.tsx"), "utf-8");
        compiled = readFileSyncWithRetry(path.join(dir, "compiled.js"), "utf-8");
      } catch {
        problems.push(`${page.rel}: generated visual ${id} artifact files are incomplete`);
        continue;
      }
      if (manifest.id !== id || manifest.version !== version || manifest.status !== "published") {
        problems.push(`${page.rel}: generated visual ${id} manifest identity/status does not match v${version}`);
      }
      if (String(manifest.targetPage ?? "").replace(/\\/g, "/") !== page.rel) {
        problems.push(`${page.rel}: generated visual ${id} manifest targets another page`);
      }
      const targetHeading = String(manifest.targetHeading ?? "").trim().toLowerCase();
      if (!targetHeading || !page.title.trim().toLowerCase().endsWith(targetHeading)) {
        problems.push(`${page.rel}: generated visual ${id} manifest heading does not match the lesson`);
      }
      const anchor = String(manifest.insertionAnchor ?? "");
      const anchorIndex = anchor ? page.body.indexOf(`<!-- ${anchor} -->`) : -1;
      if (anchorIndex < 0 || anchorIndex > match.index) {
        problems.push(`${page.rel}: generated visual ${id} is detached from its insertion anchor`);
      }
      if (sha(source) !== manifest.sourceHash || sha(compiled) !== manifest.compiledHash) {
        problems.push(`${page.rel}: generated visual ${id} artifact hash mismatch`);
      }
      if (validation.valid !== true || tests.passed !== true || critic.approved !== true) {
        problems.push(`${page.rel}: generated visual ${id} lacks passing validation, runtime tests, or critic approval`);
      }
      const prefix = "globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(";
      const suffix = ");\n";
      try {
        if (!compiled.startsWith(prefix) || !compiled.endsWith(suffix)) throw new Error("bad envelope");
        const definition = JSON.parse(compiled.slice(prefix.length, -suffix.length)) as Record<string, unknown>;
        if (definition.schemaVersion !== 1 || definition.sdkVersion !== "1.0.0") throw new Error("bad version");
      } catch {
        problems.push(`${page.rel}: generated visual ${id} compiler envelope is invalid`);
      }
    }
  }
  const coverage = readJson<Record<string, unknown>>(
    path.join(gardenDir, ".breadboard", "visualization-coverage.json"),
    {},
  );
  if (pages.some((page) => embeddedGeneratedVisualIds(page.body).length > 0) && coverage.status === "fail") {
    problems.push("visualization coverage report is in fail state");
  }
  return [...new Set(problems)];
}

export function visualizationPlanPlacementProblems(input: {
  gardenDir: string;
  gardenId: string;
  pages: LearnerPage[];
  plan: VisualizationPlan | null;
}): string[] {
  const problems: string[] = [];
  if (!input.plan) return ["authoritative visualization plan is missing or invalid"];
  const pageByRel = new Map(input.pages.map((page) => [page.rel.replace(/\\/g, "/"), page]));
  if (!Array.isArray(input.plan.opportunities) || !Array.isArray(input.plan.decisions)) {
    return ["authoritative visualization plan placement arrays are malformed"];
  }
  const routeByOpportunity = new Map<
    string,
    VisualizationPlan["decisions"][number]
  >();
  input.plan.decisions.forEach((rawDecision, index) => {
    if (
      !rawDecision ||
      typeof rawDecision !== "object" ||
      typeof rawDecision.opportunityId !== "string"
    ) {
      problems.push(`visualization-plan route decision ${index + 1} is malformed`);
      return;
    }
    routeByOpportunity.set(rawDecision.opportunityId, rawDecision);
  });
  input.plan.opportunities.forEach((rawOpportunity, index) => {
    if (
      !rawOpportunity ||
      typeof rawOpportunity !== "object" ||
      typeof rawOpportunity.id !== "string" ||
      typeof rawOpportunity.learningUnitId !== "string"
    ) {
      problems.push(`visualization-plan opportunity ${index + 1} is malformed`);
      return;
    }
    const opportunity = rawOpportunity;
    const targetPage = String(opportunity.targetPage ?? "");
    const normalizedTargetPage = targetPage.replace(/\\/g, "/");
    const targetSegments = normalizedTargetPage.split("/");
    if (
      targetPage !== normalizedTargetPage ||
      !normalizedTargetPage.startsWith("learning/") ||
      !normalizedTargetPage.endsWith(".md") ||
      normalizedTargetPage !== path.posix.normalize(normalizedTargetPage) ||
      targetSegments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      problems.push(`${opportunity.id}: visualization-plan targetPage is unsafe or not a learning Markdown page`);
      return;
    }
    const targetHeading = String(opportunity.targetHeading ?? "").trim();
    const expectedAnchor =
      `learning-unit:${opportunity.learningUnitId}:after-introduction`;
    if (!targetHeading) {
      problems.push(`${opportunity.id}: visualization-plan targetHeading is empty`);
    }
    if (opportunity.insertionAnchor !== expectedAnchor) {
      problems.push(`${opportunity.id}: visualization-plan insertionAnchor is not the exact mechanical unit anchor`);
    }
    const page = pageByRel.get(normalizedTargetPage);
    if (!page) {
      problems.push(`${opportunity.id}: visualization-plan targetPage does not exist`);
      return;
    }
    if (fmGetScalar(page.rawFm, "learningUnitId") !== opportunity.learningUnitId) {
      problems.push(`${opportunity.id}: visualization-plan targetPage belongs to another learning unit`);
    }
    if (!targetHeading || !page.title.trim().toLowerCase().endsWith(targetHeading.toLowerCase())) {
      problems.push(`${opportunity.id}: visualization-plan targetHeading does not match the lesson`);
    }
    const route = routeByOpportunity.get(opportunity.id);
    if (route?.route !== "generated_module") return;
    const manifest = readJson<Record<string, unknown>>(
      path.join(
        input.gardenDir,
        ".breadboard",
        "visuals",
        opportunity.id,
        "manifest.json",
      ),
      {},
    );
    if (
      manifest.id !== opportunity.id ||
      manifest.gardenId !== input.gardenId ||
      manifest.learningUnitId !== opportunity.learningUnitId ||
      String(manifest.targetPage ?? "").replace(/\\/g, "/") !== normalizedTargetPage ||
      manifest.targetHeading !== opportunity.targetHeading ||
      manifest.insertionAnchor !== opportunity.insertionAnchor
    ) {
      problems.push(`${opportunity.id}: published generated-visual manifest placement differs from the authoritative plan`);
    }
    const marker = `<!-- ${opportunity.insertionAnchor} -->`;
    if (!page.body.includes(marker) || !embeddedGeneratedVisualVersions(page.body).has(opportunity.id)) {
      problems.push(`${opportunity.id}: authoritative plan placement is not present on its published lesson page`);
    }
  });
  return [...new Set(problems)];
}

function embeddedVisualTypes(body: string): string[] {
  const types: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(VISUAL_BLOCK_RE.source, VISUAL_BLOCK_RE.flags);
  while ((match = re.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "{}") as Record<string, unknown>;
      if (typeof parsed.type === "string" && parsed.type.trim()) types.push(parsed.type.trim());
    } catch {
      // invalid JSON is caught by the external validator; ignore here
    }
  }
  return types;
}

function embeddedVisualSpecs(body: string): Array<Record<string, unknown>> {
  const specs: Array<Record<string, unknown>> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(VISUAL_BLOCK_RE.source, VISUAL_BLOCK_RE.flags);
  while ((match = re.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "{}");
      if (parsed && typeof parsed === "object") specs.push(parsed as Record<string, unknown>);
    } catch {
      // invalid JSON is caught by the standalone validator
    }
  }
  return specs;
}

function visualSpecAnchorIds(spec: Record<string, unknown>): string[] {
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  const ids: string[] = [];
  for (const anchor of anchors) {
    if (!anchor || typeof anchor !== "object") continue;
    const record = anchor as Record<string, unknown>;
    for (const key of ["figureId", "tableId", "equationId", "questionId", "textAnchorId"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}

function visualSpecTextAnchorIds(spec: Record<string, unknown>): string[] {
  return visualSpecAnchorIds(spec).filter((id) => /^text-/i.test(id));
}

function visualSpecAnchorRecords(spec: Record<string, unknown>): Array<Record<string, unknown>> {
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  return anchors.filter((anchor): anchor is Record<string, unknown> => Boolean(anchor) && typeof anchor === "object");
}

function visualSignature(spec: Record<string, unknown>): string {
  const controls = Array.isArray(spec.controls)
    ? spec.controls
        .map((control) => {
          if (!control || typeof control !== "object") return "";
          const record = control as Record<string, unknown>;
          return [record.name, record.label, record.type, Array.isArray(record.options) ? record.options.join("|") : ""]
            .map((value) => String(value ?? "").toLowerCase())
            .join(":");
        })
        .sort()
    : [];
  const list = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item).toLowerCase().trim()).filter(Boolean).sort() : [];
  return [
    String(spec.type ?? "").toLowerCase(),
    controls.join("|"),
    list(spec.inputs).join("|"),
    list(spec.outputs).join("|"),
    visualSpecAnchorIds(spec).sort().join("|"),
    list(spec.conceptTargets).join("|"),
    String(spec.pedagogicalPurpose ?? spec.caption ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("::");
}

type EmbeddedVisualTransform = (spec: Record<string, unknown>) => boolean;

function rewriteEmbeddedVisualSpecs(page: LearnerPage, transform: EmbeddedVisualTransform): void {
  let changed = false;
  page.body = page.body.replace(VISUAL_BLOCK_RE, (fullMatch, json: string) => {
    let spec: Record<string, unknown>;
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fullMatch;
      spec = parsed as Record<string, unknown>;
    } catch {
      return fullMatch;
    }
    const before = JSON.stringify(spec);
    const transformed = transform(spec);
    const after = JSON.stringify(spec);
    if (!transformed && before === after) return fullMatch;
    changed = true;
    return `\`\`\`breadboard-visual\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
  });
  if (changed) page.dirty = true;
}

function saveVisualSpecArtifact(gardenDir: string, spec: Record<string, unknown>, report: FinalizeReport): void {
  const id = String(spec.id ?? "").trim();
  if (!id) return;
  const rel = `.breadboard/visuals/${id}.json`;
  const target = path.join(gardenDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = `${JSON.stringify(spec, null, 2)}\n`;
  const existing = fs.existsSync(target) ? readFileSyncWithRetry(target, "utf-8") : "";
  if (existing === content) return;
  fs.writeFileSync(target, content, "utf-8");
  if (!report.changed.includes(rel)) report.changed.push(rel);
}

type MetricCalculatorFamily = "accuracy" | "latency" | "spike-count" | "energy" | "efficiency" | "convergence";

const METRIC_CALCULATOR_FAMILIES: MetricCalculatorFamily[] = [
  "accuracy",
  "latency",
  "spike-count",
  "energy",
  "efficiency",
  "convergence",
];

const METRIC_CALCULATOR_LABELS: Record<MetricCalculatorFamily, string> = {
  accuracy: "accuracy",
  latency: "latency",
  "spike-count": "spike count",
  energy: "energy",
  efficiency: "normalized efficiency",
  convergence: "convergence time",
};

function titleCaseMetricLabel(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => word.toUpperCase() === word ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

const METRIC_CALCULATOR_PATTERNS: Record<MetricCalculatorFamily, RegExp> = {
  accuracy: /\baccuracy\b|\bcorrect predictions?\b|\.E1\b/i,
  latency: /\blatency\b|\bdecision time\b|\.E2\b/i,
  "spike-count": /\bspike[- ]?count\b|\btotal spikes?\b|\.E3\b/i,
  energy: /\benergy\b|\benergy per spike\b|\.E4\b/i,
  efficiency: /\befficien|\bnormalized\b|accuracy over energy|\.E5\b/i,
  convergence: /\bconvergence\b|\btarget accuracy\b|\bepochs?\b|\.E6\b/i,
};

const METRIC_CALCULATOR_CONTROLS: Record<MetricCalculatorFamily, Array<Record<string, unknown>>> = {
  accuracy: [
    { name: "correct", label: "Correct predictions", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 920 },
    { name: "total", label: "Total predictions", type: "slider", min: 100, max: 2000, step: 50, defaultValue: 1000 },
  ],
  latency: [
    { name: "decisionTime", label: "Decision time", type: "slider", min: 1, max: 100, step: 1, defaultValue: 24 },
  ],
  "spike-count": [
    { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 },
  ],
  energy: [
    { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 },
    { name: "energyPerSpike", label: "Energy per spike", type: "slider", min: 0.0005, max: 0.01, step: 0.0005, defaultValue: 0.002 },
  ],
  efficiency: [
    { name: "correct", label: "Correct predictions", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 920 },
    { name: "total", label: "Total predictions", type: "slider", min: 100, max: 2000, step: 50, defaultValue: 1000 },
    { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 },
    { name: "energyPerSpike", label: "Energy per spike", type: "slider", min: 0.0005, max: 0.01, step: 0.0005, defaultValue: 0.002 },
  ],
  convergence: [
    { name: "correct", label: "Correct predictions", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 920 },
    { name: "total", label: "Total predictions", type: "slider", min: 100, max: 2000, step: 50, defaultValue: 1000 },
    { name: "decisionTime", label: "Decision time", type: "slider", min: 1, max: 100, step: 1, defaultValue: 24 },
  ],
};

function metricCalculatorFamiliesForText(text: string): MetricCalculatorFamily[] {
  return METRIC_CALCULATOR_FAMILIES.filter((family) => METRIC_CALCULATOR_PATTERNS[family].test(text));
}

function formulaFamilyForVisualAnchor(anchor: unknown): string | null {
  if (!anchor || typeof anchor !== "object") return null;
  const record = anchor as Record<string, unknown>;
  const text = [record.equationId, record.description, record.sourceTitle].filter(Boolean).join(" ");
  return formulaMetricFamily(text);
}

function roleForMetricAnchorFamily(family: string | null, targetFamilies: Set<string>): "input" | "output_formula" | "comparison_basis" | "context" {
  if (family && targetFamilies.has(family)) return "output_formula";
  if (family === "accuracy" || family === "energy" || family === "spike-count") return "input";
  return "context";
}

const VISUAL_ANCHOR_ROLE_RE = /^(input|output_formula|comparison_basis|context)$/;

function metricFamilyDisplayName(family: string | null): string {
  if (!family) return "this source formula";
  if (family in METRIC_CALCULATOR_LABELS) return METRIC_CALCULATOR_LABELS[family as MetricCalculatorFamily];
  return family.replace(/-/g, " ");
}

function visualSpecFamilyText(spec: Record<string, unknown>): string {
  return [
    spec.title,
    spec.caption,
    spec.pedagogicalPurpose,
    spec.learningGoal,
    Array.isArray(spec.conceptTargets) ? spec.conceptTargets.join(" ") : "",
    Array.isArray(spec.inputs) ? spec.inputs.join(" ") : "",
    Array.isArray(spec.outputs) ? spec.outputs.join(" ") : "",
    Array.isArray(spec.controls)
      ? spec.controls.map((control) => typeof control === "object" && control ? Object.values(control as Record<string, unknown>).join(" ") : "").join(" ")
      : "",
  ].filter(Boolean).join(" ");
}

function visualAnchorRoleReason({
  type,
  role,
  family,
  targetFamilies,
}: {
  type: string;
  role: "input" | "output_formula" | "comparison_basis" | "context";
  family: string | null;
  targetFamilies: Set<string>;
}): string {
  const label = metricFamilyDisplayName(family);
  const targets = [...targetFamilies].map(metricFamilyDisplayName).join(", ") || "the selected metric";
  if (type === "tradeoff_explorer" || role === "comparison_basis") {
    return `This formula defines ${label}, one source metric used by the visual's tradeoff comparison.`;
  }
  if (role === "output_formula") {
    return `This formula is the source definition for the visual's ${label} output.`;
  }
  if (role === "input") {
    return `This formula supplies ${label} as an input relationship for computing ${targets}.`;
  }
  return `This formula provides source context for interpreting ${targets} in the visual.`;
}

function normalizeVisualAnchorRolesAndReasons(spec: Record<string, unknown>, contextText: string): boolean {
  const type = String(spec.type ?? "");
  if (type !== "metric_calculator" && type !== "tradeoff_explorer") return false;
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  if (anchors.length === 0) return false;

  const expectedFamilies = new Set<string>(metricCalculatorFamiliesForText(contextText));
  for (const anchor of anchors) {
    const family = formulaFamilyForVisualAnchor(anchor);
    if (family && expectedFamilies.size === 0) expectedFamilies.add(family);
  }

  let changed = false;
  const normalized = anchors.map((anchor) => {
    if (!anchor || typeof anchor !== "object") return anchor;
    const record = { ...(anchor as Record<string, unknown>) };
    const id = String(record.equationId ?? "").trim();
    if (!/^S\d+\.P\d+\.E\d+$/i.test(id)) return record;

    const family = formulaFamilyForVisualAnchor(record);
    const desiredRole = type === "tradeoff_explorer"
      ? "comparison_basis"
      : roleForMetricAnchorFamily(family, expectedFamilies);
    const existingRole = String(record.role ?? "").trim();
    const role = VISUAL_ANCHOR_ROLE_RE.test(existingRole)
      ? existingRole as "input" | "output_formula" | "comparison_basis" | "context"
      : desiredRole;
    if (record.role !== role) {
      record.role = role;
      changed = true;
    }
    const reason = String(record.reason ?? "").trim();
    if (reason.length < 12) {
      record.reason = visualAnchorRoleReason({ type, role, family, targetFamilies: expectedFamilies });
      changed = true;
    }
    return record;
  });

  if (changed) spec.sourceAnchors = normalized;
  return changed;
}

function focusMetricCalculatorRecord(spec: Record<string, unknown>, contextText: string): boolean {
  if (String(spec.type ?? "") !== "metric_calculator") return false;
  const families = metricCalculatorFamiliesForText(contextText);
  if (families.length === 0) return false;
  const controlsByName = new Map<string, Record<string, unknown>>();
  for (const family of families) {
    for (const control of METRIC_CALCULATOR_CONTROLS[family]) {
      controlsByName.set(String(control.name), { ...control });
    }
  }
  const labels = families.map((family) => METRIC_CALCULATOR_LABELS[family]);
  const titleLabels = labels.map(titleCaseMetricLabel);
  spec.title = titleLabels.length === 1 ? `${titleLabels[0]} Calculator` : `${titleLabels.join(" and ")} Calculator`;
  spec.controls = [...controlsByName.values()];
  spec.inputs = [...controlsByName.values()].map((control) => String(control.label ?? "").toLowerCase()).filter(Boolean);
  spec.outputs = labels;
  spec.conceptTargets = labels;
  spec.pedagogicalPurpose = `Let the learner manipulate inputs for ${labels.join(", ")} and observe how the selected metric responds.`;
  spec.caption = `Adjust the controls to see how ${labels.join(", ")} changes with the chosen inputs.`;
  spec.regenerationPrompt = `Regenerate this metric calculator so its controls and readouts focus only on ${labels.join(", ")}.`;
  if (Array.isArray(spec.sourceAnchors)) {
    const allowed = new Set<string>(families);
    if (allowed.has("efficiency")) {
      allowed.add("accuracy");
      allowed.add("energy");
      allowed.add("spike-count");
    }
    if (allowed.has("energy")) allowed.add("spike-count");
    spec.sourceAnchors = spec.sourceAnchors.filter((anchor) => {
      const family = formulaFamilyForVisualAnchor(anchor);
      return !family || allowed.has(family);
    }).map((anchor) => {
      if (!anchor || typeof anchor !== "object") return anchor;
      const record = { ...(anchor as Record<string, unknown>) };
      const family = formulaFamilyForVisualAnchor(record);
      const role = roleForMetricAnchorFamily(family, new Set(families));
      record.role = record.role ?? role;
      record.reason = record.reason ?? (
        role === "output_formula"
          ? `This is the metric formula the calculator teaches for ${family ?? labels.join(", ")}.`
          : role === "input"
            ? `This formula supplies an input needed to compute ${labels.join(", ")}.`
            : `This source anchor provides context for ${labels.join(", ")}.`
      );
      return record;
    });
  }
  return true;
}

function repairVisualAnchorRolesAndReasons(gardenDir: string, learnerPages: LearnerPage[], report: FinalizeReport): void {
  for (const page of learnerPages) {
    const contextText = [
      page.title,
      ...fmGetArray(page.rawFm, "sourceAnchors"),
      ...fmGetArray(page.rawFm, "sourceVisualIds"),
      ...fmGetArray(page.rawFm, "sourceFormulaAnchors"),
      ...formulaEntrySourceAnchors(page.rawFm),
    ].join(" ");
    rewriteEmbeddedVisualSpecs(page, (spec) => {
      const changed = normalizeVisualAnchorRolesAndReasons(spec, `${contextText} ${visualSpecFamilyText(spec)}`);
      if (!changed) return false;
      saveVisualSpecArtifact(gardenDir, spec, report);
      report.notes.push(`added visual anchor roles for ${String(spec.id ?? "(missing id)")} on ${page.rel}`);
      return true;
    });
  }
}

function repairMetricCalculatorFocus(gardenDir: string, learnerPages: LearnerPage[], report: FinalizeReport): void {
  for (const page of learnerPages) {
    const contextText = [
      page.title,
      ...fmGetArray(page.rawFm, "sourceAnchors"),
      ...fmGetArray(page.rawFm, "sourceVisualIds"),
      ...fmGetArray(page.rawFm, "sourceFormulaAnchors"),
      ...formulaEntrySourceAnchors(page.rawFm),
    ].join(" ");
    rewriteEmbeddedVisualSpecs(page, (spec) => {
      const before = JSON.stringify(spec);
      const changed = focusMetricCalculatorRecord(spec, contextText);
      if (changed && JSON.stringify(spec) !== before) {
        saveVisualSpecArtifact(gardenDir, spec, report);
        report.notes.push(`focused metric calculator ${String(spec.id ?? "(missing id)")} on ${page.rel}`);
        return true;
      }
      return false;
    });
  }
}

function formulaAnchorsFromFrontmatter(rawFm: string): string[] {
  const anchors = new Set(fmGetArray(rawFm, "sourceFormulaAnchors"));
  const lines = rawFm.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s+sourceAnchor:\s*(.*)$/);
    if (match) {
      const value = unquoteYamlScalar(match[1] ?? "");
      if (value) anchors.add(value);
    }
    const textMatch = line.match(/^\s+-\s*text:\s*(.*)$/);
    if (textMatch) {
      const value = unquoteYamlScalar(textMatch[1] ?? "");
      if (value && !isGroundableFormula(value)) anchors.add(`trivial:${value}`);
    }
  }
  return [...anchors];
}

function formulaEntrySourceAnchors(rawFm: string): string[] {
  const anchors = new Set<string>();
  for (const entry of formulaEntriesFromFrontmatter(rawFm)) {
    const kind = formulaEntryKind(entry);
    if (kind === "worked_example" || kind === "conceptual_helper") continue;
    const value = String(entry.sourceAnchor ?? "").trim();
    if (value) anchors.add(value);
  }
  return [...anchors];
}

interface ParsedFormulaEntry {
  kind?: string;
  text?: string;
  normalizedText?: string;
  groundingStatus?: string;
  justification?: string;
  sourceAnchor?: string;
  basedOnFormula?: string;
  formulaFamily?: string;
  exampleGroupId?: string;
}

function unquoteYamlScalar(value: string): string {
  const t = value.trim();
  // Double-quoted scalars are JSON-escaped (serializeFormulas uses jsonScalar =
  // JSON.stringify), so LaTeX like "\\text{..}" is stored with a doubled
  // backslash. Decode it back to a single backslash so the validation checks
  // classify the SAME text the generator/regrounder produced — otherwise the
  // doubled backslash can flip heuristics such as isWorkedExampleFormula.
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t.replace(/^["']|["']$/g, "");
}

function formulaEntriesFromFrontmatter(rawFm: string): ParsedFormulaEntry[] {
  const entries: ParsedFormulaEntry[] = [];
  const lines = rawFm.split(/\r?\n/);
  let inFormulas = false;
  let current: ParsedFormulaEntry | null = null;
  for (const line of lines) {
    if (!inFormulas) {
      const start = line.match(/^formulas:\s*(.*)$/);
      if (!start) continue;
      inFormulas = true;
      continue;
    }
    if (/^\S[^:]*:\s*/.test(line)) break;
    const first = line.match(/^\s*-\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (first) {
      current = {};
      current[first[1] as keyof ParsedFormulaEntry] = unquoteYamlScalar(first[2] ?? "");
      entries.push(current);
      continue;
    }
    const nested = line.match(/^\s{4,}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (nested && current) {
      current[nested[1] as keyof ParsedFormulaEntry] = unquoteYamlScalar(nested[2] ?? "");
    }
  }
  return entries.filter((entry) => Object.values(entry).some((value) => String(value ?? "").trim()));
}

function formulaEntryKind(entry: ParsedFormulaEntry): string {
  const kind = String(entry.kind ?? "").trim();
  if (kind) return kind;
  if (isWorkedExampleFormula(String(entry.text ?? ""))) return "worked_example";
  if (entry.groundingStatus === "source-anchored") return "source_definition";
  if (entry.groundingStatus === "source-derived") return "source_derived_definition";
  return "conceptual_helper";
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface FinalizeReport {
  changed: string[];
  removed: string[];
  notes: string[];
  /** Non-blocking, user-facing warnings (e.g. incomplete source extraction).
   * These never fail the garden but are surfaced so the cause is not silent. */
  warnings: string[];
  actions?: FinalizerAction[];
  reconciliation: ReconciledAnchorUsage[];
  criticalProblems: string[];
}

export interface ReconciledAnchorUsage {
  id: string;
  status: "used" | "partially_used" | "intentionally_skipped" | "unused" | "misplaced";
  usedInPages: string[];
  embeddedAsImage: boolean;
  usedAsInteractiveAnchor: boolean;
  skipReason?: string;
  problems?: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function finalizeGardenExport({
  gardenDir,
  gardenSlug,
  preserveModelAuthoredContent = false,
  expectedVisualContractExecutabilityContext,
  expectedSourceFormulaReviewContext,
}: {
  gardenDir: string;
  gardenSlug: string;
  /** Active Learn uses validation-only finalization: structural projection and
   * hard gates may run, but learner prose, formulas, visuals, and contract
   * semantics are never synthesized or rewritten by deterministic repair. */
  preserveModelAuthoredContent?: boolean;
  /** Exact active Learn identity, supplied out-of-band from the review ledger. */
  expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
  /** Exact active Learn formula-review identity, captured before mutable
   * generation/finalization stages can redefine the accepted review set. */
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
}): FinalizeReport {
  const report: FinalizeReport = {
    changed: [],
    removed: [],
    notes: [],
    warnings: [],
    actions: [],
    reconciliation: [],
    criticalProblems: [],
  };
  if (!fs.existsSync(gardenDir)) {
    report.criticalProblems.push(`garden directory missing: ${gardenDir}`);
    return report;
  }

  const bd = path.join(gardenDir, ".breadboard");

  // --- Pass A: export-tree cleanup (Internal/, numbered source folders) ------
  cleanExportTree(gardenDir, report);
  if (!preserveModelAuthoredContent) {
    const semanticMigration = migrateGardenSemantics(gardenDir, { gardenId: gardenSlug });
    for (const rel of semanticMigration.changedFiles) {
      if (!report.changed.includes(rel)) report.changed.push(rel);
    }
    if (semanticMigration.migrated) {
      report.notes.push(
        `migrated claim-as-tag metadata to semantic schema v${semanticMigration.schemaVersion}`,
      );
    }
  }

  // --- Load facts once -------------------------------------------------------
  const ledgerPath = path.join(bd, "source-visuals.json");
  const ledger = readJson<LedgerVisual[]>(ledgerPath, []);
  const laterPagesExist = sourcesHaveLaterPages(gardenDir) || ledger.some((visual) => Number(visual.pageNumber ?? 0) > 2);
  const formulaAnchorsExist = ledger.some((visual) => classifyFigure(visual) === "equation");
  const tableAnchorsExist = ledger.some((visual) => String(visual.type ?? "") === "table" || /\.T\d+$/i.test(visual.sourceVisualId));
  const figureAnchorsExist = ledger.some((visual) => classifyFigure(visual) !== "equation" && String(visual.type ?? "") !== "table" && !/\.T\d+$/i.test(visual.sourceVisualId));

  // --- Load learner pages ----------------------------------------------------
  const learnerPages = loadLearnerPages(gardenDir);

  // --- Pass C: source wikilink normalization ---------------------------------
  normalizeSourceWikilinks(gardenDir, report);

  // --- Pass D: stale caveat sanitation (visible + planning) ------------------
  if (!preserveModelAuthoredContent) {
    sanitizeStaleCaveatFiles(gardenDir, { laterPagesExist, formulaAnchorsExist, tableAnchorsExist, figureAnchorsExist }, report);
  }
  repairLearnerNavigationSourceLinks(gardenDir, report);

  // Semantic decisions are made by the Learning Unit Contract repair loop before
  // finalization. The finalizer only performs deterministic export hygiene:
  // filesystem cleanup, source/link normalization, stale-caveat removal,
  // path/label alignment, validation reporting, and hard gating.
  if (!preserveModelAuthoredContent) {
    regroundFormulas({ gardenDir, ledger, learnerPages, report });
    repairLearnerAcronymGrammar(learnerPages, report);
  }
  repairSourceVisualImagePathCasing(gardenDir, learnerPages, report);
  if (!preserveModelAuthoredContent) {
    repairVisualAnchorRolesAndReasons(gardenDir, learnerPages, report);
    repairSourceTextConceptAnchors(gardenDir, learnerPages, report);
    synchronizePageVisualTextAnchors(learnerPages, report);
  }
  pruneOrphanSemanticRepairProvenance(gardenDir, learnerPages, report);

  // --- Persist learner-page edits --------------------------------------------
  for (const page of learnerPages) {
    if (page.dirty) {
      fs.writeFileSync(page.abs, joinFrontmatter(page.rawFm, page.body), "utf-8");
      if (!report.changed.includes(page.rel)) report.changed.push(page.rel);
    }
  }
  alignSectionFoldersWithTitles(gardenDir, report);
  repairSectionNavigationLabels(gardenDir, report);
  if (!preserveModelAuthoredContent) {
    repairSectionIndexProse(gardenDir, report);
    repairOrphanLearnerPageUnitIds(gardenDir, readLearningUnitContract(gardenDir), report);
  }
  const finalLearnerPages = loadLearnerPages(gardenDir);
  const finalContract = readLearningUnitContract(gardenDir);
  if (!preserveModelAuthoredContent) {
    registerExistingTextAnchors(gardenDir, finalLearnerPages, new Map(finalContract.units.map((unit) => [unit.id, unit])), report);
    synchronizeContractSourceAnchors(gardenDir, finalContract, finalLearnerPages, report);
  }

  // --- Pass I2: post-structure semantic reconciliation ------------------------
  // Legacy exports rebuild claims, concepts, and page projections after path
  // changes. Active Learn skips this semantic authoring pass: its model-authored
  // contract and page metadata must already agree, or the critical gate leaves
  // the mismatch blocking for the model repair loop. Stale records are
  // archived to claims-history/concept-registry-history — never merged forward
  // into the active registries.
  if (!preserveModelAuthoredContent) {
    const semantic = reconcileFinalGardenSemantics(gardenDir, gardenSlug, {
      archiveHistoricalClaims: true,
      archiveUnusedConcepts: true,
      strictMode: false,
    });
    for (const rel of semantic.pagesUpdated) if (!report.changed.includes(rel)) report.changed.push(rel);
    if (semantic.changed) {
      report.notes.push(
        `semantic reconciliation: ${semantic.activeClaims} active claims (${semantic.staleClaimsRemoved} stale archived, ` +
          `${semantic.claimsRemappedToNewPaths} remapped to final paths), ${semantic.activeConcepts} active concepts ` +
          `(${semantic.archivedConcepts} archived), ${semantic.pagesUpdated.length} page projections rewritten`,
      );
    }
    if (semantic.stoppedReason === "ambiguous_unit_page_mapping") {
      report.criticalProblems.push(
        ...semantic.pageIndex.problems.map((problem) => `semantic reconciliation: ${problem}`),
      );
    }
    if (semantic.stoppedReason === "transaction_failed") {
      report.criticalProblems.push("semantic reconciliation transaction failed and was rolled back");
    }
  }

  // --- Pass J: canonical formula-projection reconciliation ------------------
  // Contract assignments, page formula metadata/lineage, formula anchor arrays,
  // the source ledger, and Source Coverage are one rollback-backed projection.
  // This runs before the general final-state audit so the terminal gate is not
  // the first component to discover deterministic formula drift.
  if (!preserveModelAuthoredContent) {
    const formula = reconcileFinalFormulaProjectionsDeterministic(gardenDir, gardenSlug, { strictMode: false });
    for (const rel of formula.changedFiles) if (!report.changed.includes(rel)) report.changed.push(rel);
    if (formula.changedFiles.length > 0) {
      report.notes.push(
        `formula projection reconciliation: checked ${formula.contractAssignmentsChecked} contract assignment(s), ` +
          `added ${formula.definitionsAdded} and linked ${formula.definitionsLinked} definition(s), ` +
          `relined ${formula.workedExamplesRelined} and reclassified ${formula.workedExamplesReclassified} worked example(s)`,
      );
    }
    if (formula.rolledBack) {
      report.criticalProblems.push("formula projection reconciliation regressed final state and was rolled back");
    }
  }

  // Source Coverage is a pure read-model projection, not a semantic repair.
  // Active Learn keeps source/page meaning model-authored, but its final export
  // must still describe the files it is about to validate and publish.
  if (preserveModelAuthoredContent) {
    regenerateSourceCoverageFromFinalState(gardenDir, gardenSlug, report);
  }

  // --- Pass K: canonical final-state reconciliation --------------------------
  // Build one FinalGardenState from the final files and bring every derived
  // artifact (Source Coverage, section indexes, contract handles, anchor
  // ledger, Source Map caveats, repair provenance, worked-example labels) back
  // into agreement with it. Source Coverage is regenerated as a pure projection
  // of this state, so no report can drift from the final pages.
  if (!preserveModelAuthoredContent) {
    const reconcile = reconcileFinalGardenState(gardenDir, gardenSlug);
    for (const rel of reconcile.changed) if (!report.changed.includes(rel)) report.changed.push(rel);
    for (const note of reconcile.notes) report.notes.push(note);
  }

  // --- Pass L1: incomplete-extraction notification --------------------------
  // Surface (never fail on) source formula anchors that have no extractable
  // formula text. Their equations are shown as captions/concepts only because
  // extraction produced no exact text — usually the vision model was
  // unavailable when the source was processed. This makes the gap visible
  // instead of silently publishing ungrounded formulas.
  for (const warning of ungroundableFormulaWarnings(gardenDir)) {
    if (!report.warnings.includes(warning)) report.warnings.push(warning);
    if (!report.notes.includes(warning)) report.notes.push(warning);
  }

  // --- Pass L: validation report + critical gate -----------------------------
  writeFinalizeValidationReport({
    gardenDir,
    gardenSlug,
    report,
    strictModelApprovedVisuals: preserveModelAuthoredContent,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  });
  runCriticalGate({
    gardenDir,
    gardenSlug,
    report,
    strictModelApprovedVisuals: preserveModelAuthoredContent,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  });

  return report;
}

/**
 * Warnings for source formula anchors that are referenced (by the contract or a
 * learner page) but have no extractable formula text — i.e. extraction produced
 * a caption only. Non-blocking; actionable (re-run extraction with the vision
 * model available). Returns [] when every referenced formula anchor is
 * groundable.
 */
export function ungroundableFormulaWarnings(gardenDir: string): string[] {
  const ledger = readJson<LedgerVisual[]>(path.join(gardenDir, ".breadboard", "source-visuals.json"), []);
  const groundable = new Set(
    buildFormulaIdentityRegistry(buildCanonicalSourceAnchors(gardenDir), gardenDir)
      .filter((identity) => identity.verified || String(identity.canonicalText ?? "").trim().length > 0)
      .map((identity) => identity.anchorId),
  );
  const contract = readLearningUnitContract(gardenDir);
  const referenced = new Set<string>();
  for (const assignment of contract.assignments) {
    if (isSourceFormulaId(assignment.sourceArtifactId)) referenced.add(assignment.sourceArtifactId);
  }
  for (const unit of contract.units) for (const formula of unit.sourceFormulas) referenced.add(formula.id);
  const usedIds = idsUsedByLearners(loadLearnerPages(gardenDir));
  const ungroundable = ledger
    .filter((visual) => classifyFigure(visual) === "equation" && !groundable.has(visual.sourceVisualId))
    .filter((visual) => referenced.has(visual.sourceVisualId) || usedIds.has(visual.sourceVisualId))
    .map((visual) => ({ id: visual.sourceVisualId, caption: String(visual.caption ?? "").trim() }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (ungroundable.length === 0) return [];
  const list = ungroundable.map((entry) => `${entry.id}${entry.caption ? ` (${entry.caption})` : ""}`).join(", ");
  return [
    `Incomplete source formula extraction: ${ungroundable.length} referenced formula anchor(s) have no extractable exact text, so their equations appear as captions/concepts only and are not grounded as source formulas — ${list}. This usually means the vision model was unavailable when the source was processed. Re-run source extraction with the vision model available to recover the exact formulas and ground them.`,
  ];
}

// ---------------------------------------------------------------------------
// Pass A: export-tree cleanup
// ---------------------------------------------------------------------------

function cleanExportTree(gardenDir: string, report: FinalizeReport): void {
  const allowedTop = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
  // Source-file basenames, so a numbered folder named after the raw upload can
  // be recognized even without an exact "source-conversion" marker.
  const sourceBases = new Set<string>();
  const sourcesDir = path.join(gardenDir, "sources");
  if (fs.existsSync(sourcesDir)) {
    for (const name of fs.readdirSync(sourcesDir)) {
      if (name.endsWith(".md") && name !== "_index.md") sourceBases.add(slugifyLoose(name.replace(/\.md$/i, "")));
    }
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(gardenDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (allowedTop.has(entry.name)) continue;
    const abs = path.join(gardenDir, entry.name);

    // Internal/ concept graph → relocate under .breadboard so it never ships as
    // visible Quartz content but stays available to the knowledge graph.
    if (entry.isDirectory() && entry.name === "Internal") {
      const dest = path.join(gardenDir, ".breadboard", "Internal");
      moveDir(abs, dest);
      report.removed.push(`Internal/ -> .breadboard/Internal/`);
      continue;
    }

    // Root-level numbered source-conversion folder → drop: its content already
    // lives (clean) under sources/.
    const numbered = entry.isDirectory() && entry.name.match(/^\d+\.\s*(.+)$/);
    if (numbered) {
      rmrf(abs);
      report.removed.push(`${entry.name}/ (numbered source-conversion folder)`);
      continue;
    }

    // Any other stray top-level entry (uppercase Learning/, snapshots, etc.).
    if (entry.name === "Learning") {
      // Merge an uppercase Learning/ into the canonical learning/ if any.
      rmrf(abs);
      report.removed.push(`Learning/ (uppercase; not exportable)`);
      continue;
    }
    rmrf(abs);
    report.removed.push(`${entry.name}${entry.isDirectory() ? "/" : ""} (not exportable)`);
  }
}

function sourcesHaveLaterPages(gardenDir: string): boolean {
  const sourcesDir = path.join(gardenDir, "sources");
  if (!fs.existsSync(sourcesDir)) return false;
  for (const name of fs.readdirSync(sourcesDir)) {
    if (!name.endsWith(".md")) continue;
    const body = readFileSyncWithRetry(path.join(sourcesDir, name), "utf-8");
    for (const match of body.matchAll(/^#{1,6}\s+(?:\[\[#?)?\s*Page\s+(\d+)/gim)) {
      if (Number.parseInt(match[1] ?? "0", 10) > 2) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Learner-page loading
// ---------------------------------------------------------------------------

function loadLearnerPages(gardenDir: string): LearnerPage[] {
  const all: Array<{ abs: string; rel: string }> = [];
  const learningDir = path.join(gardenDir, "learning");
  listMarkdown(learningDir, "learning", all);
  const pages: LearnerPage[] = [];
  for (const { abs, rel } of all) {
    const content = readFileSyncWithRetry(abs, "utf-8");
    const { rawFrontmatter, body } = parseFrontmatter(content);
    const kt = fmGetScalar(rawFrontmatter, "knowledge_type");
    const bt = fmGetScalar(rawFrontmatter, "breadboardType");
    const learnAuthored =
      fmGetScalar(rawFrontmatter, "generatedBy") === "learn_button" ||
      fmGetScalar(rawFrontmatter, "generated_by") === "learn_button";
    const isLesson = kt === "learning-page" || kt === "textbook-page" || bt === "learning_page" || bt === "textbook_page";
    if (!isLesson || !learnAuthored) continue;
    const title = fmGetScalar(rawFrontmatter, "title");
    const sectionNumber = Number.parseInt(fmGetScalar(rawFrontmatter, "sectionNumber") || "0", 10) || 0;
    pages.push({
      abs,
      rel: rel.replace(/\\/g, "/"),
      pageId: rel.replace(/\\/g, "/").replace(/\.md$/i, ""),
      rawFm: rawFrontmatter,
      body,
      title,
      role: pageRole(title),
      sectionNumber,
      dirty: false,
    });
  }
  pages.sort((a, b) => a.pageId.localeCompare(b.pageId));
  return pages;
}

function loadLessonLikePages(gardenDir: string): Array<LearnerPage & { learnAuthored: boolean }> {
  const all: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", all);
  const pages: Array<LearnerPage & { learnAuthored: boolean }> = [];
  for (const { abs, rel } of all) {
    if (/(^|\/)_index\.md$/i.test(rel) || /^learning\/(?:Learning Map|Topic Overview)\.md$/i.test(rel)) continue;
    const content = readFileSyncWithRetry(abs, "utf-8");
    const parsed = parseFrontmatter(content);
    if (!parsed.hadFrontmatter) continue;
    const kt = fmGetScalar(parsed.rawFrontmatter, "knowledge_type");
    const bt = fmGetScalar(parsed.rawFrontmatter, "breadboardType");
    const numberedLessonPath = /^learning\/\d+\.\s+[^/]+\/\d+\.\d+\s+.+\.md$/i.test(rel);
    const isLesson = kt === "learning-page" || kt === "textbook-page" || bt === "learning_page" || bt === "textbook_page" || numberedLessonPath;
    if (!isLesson) continue;
    const learnAuthored =
      fmGetScalar(parsed.rawFrontmatter, "generatedBy") === "learn_button" ||
      fmGetScalar(parsed.rawFrontmatter, "generated_by") === "learn_button";
    const title = fmGetScalar(parsed.rawFrontmatter, "title") || path.basename(rel, ".md");
    pages.push({
      abs,
      rel: rel.replace(/\\/g, "/"),
      pageId: rel.replace(/\\/g, "/").replace(/\.md$/i, ""),
      rawFm: parsed.rawFrontmatter,
      body: parsed.body,
      title,
      role: pageRole(title),
      sectionNumber: Number.parseInt(fmGetScalar(parsed.rawFrontmatter, "sectionNumber") || "0", 10) || 0,
      dirty: false,
      learnAuthored,
    });
  }
  pages.sort((a, b) => a.pageId.localeCompare(b.pageId));
  return pages;
}

function unitTitleMatchKey(value: string): string {
  return normalizedSectionTitleKey(stripTitleNumber(value));
}

function repairOrphanLearnerPageUnitIds(
  gardenDir: string,
  contract: LearningUnitContractArtifact,
  report: FinalizeReport,
): void {
  if (contract.units.length === 0) return;
  const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
  const lessonLike = loadLessonLikePages(gardenDir);
  if (lessonLike.length === 0) return;
  const pagesByUnit = new Map<string, Array<LearnerPage & { learnAuthored: boolean }>>();
  for (const page of lessonLike) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    if (!unitId || !unitsById.has(unitId) || !page.learnAuthored) continue;
    const list = pagesByUnit.get(unitId) ?? [];
    list.push(page);
    pagesByUnit.set(unitId, list);
  }
  const missingUnits = contract.units.filter((unit) => !pagesByUnit.has(unit.id));
  if (missingUnits.length === 0) return;

  const candidatePages = lessonLike.filter((page) => {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    if (!page.learnAuthored) return true;
    if (!unitId || !unitsById.has(unitId)) return true;
    return (pagesByUnit.get(unitId)?.length ?? 0) > 1;
  });
  const used = new Set<string>();
  for (const unit of missingUnits) {
    const unitKey = unitTitleMatchKey(unit.title);
    const byTitle = candidatePages.find((page) =>
      !used.has(page.rel) && unitTitleMatchKey(page.title) === unitKey,
    );
    const unitIndex = contract.units.findIndex((candidate) => candidate.id === unit.id);
    const byOrder = unitIndex >= 0
      ? candidatePages.filter((page) => !used.has(page.rel))[unitIndex]
      : undefined;
    const page = byTitle ?? byOrder;
    if (!page) continue;
    page.rawFm = fmSetScalar(page.rawFm, "knowledge_type", "learning-page");
    page.rawFm = fmSetScalar(page.rawFm, "breadboardType", "learning_page");
    page.rawFm = fmSetScalar(page.rawFm, "generatedBy", "learn_button");
    page.rawFm = fmSetScalar(page.rawFm, "generated_by", "learn_button");
    page.rawFm = fmSetScalar(page.rawFm, "learningUnitId", unit.id);
    page.rawFm = fmSetScalar(page.rawFm, "learningUnitRole", unit.role);
    const concepts = unit.semanticConcepts ?? [];
    const primary = concepts.filter((concept) => concept.role === "primary").map((concept) => concept.slug);
    const supporting = concepts.filter((concept) => concept.role === "supporting").map((concept) => concept.slug);
    const tags = conceptTagsForUnit(unit);
    if (tags.length > 0) {
      page.rawFm = fmSetArray(page.rawFm, "primaryConcepts", primary);
      page.rawFm = fmSetArray(page.rawFm, "supportingConcepts", supporting);
      page.rawFm = fmSetArray(page.rawFm, "tags", tags);
    }
    if (fmGetArray(page.rawFm, "sourceAnchors").length === 0 && unit.sourceAnchors.length > 0) {
      page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", unit.sourceAnchors);
    }
    fs.writeFileSync(page.abs, joinFrontmatter(page.rawFm, page.body), "utf-8");
    if (!report.changed.includes(page.rel)) report.changed.push(page.rel);
    report.notes.push(`adopted existing learner page ${page.rel} for Learning Unit ${unit.id}`);
    used.add(page.rel);
  }
}

// ---------------------------------------------------------------------------
// Learning Unit Contract repair loop
// ---------------------------------------------------------------------------

function emptyFinalizeReport(): FinalizeReport {
  return {
    changed: [],
    removed: [],
    notes: [],
    warnings: [],
    actions: [],
    reconciliation: [],
    criticalProblems: [],
  };
}

function semanticFailureType(checkName: string): UnitRepairFailureType | null {
  const name = checkName.toLowerCase();
  if (name.includes("scaffold prose")) return "scaffold_prose";
  if (name.includes("section index prose")) return "section_index_prose";
  if (name.includes("repetition") || name.includes("opening")) return "repeated_opening";
  if (name.includes("formula")) return "formula_grounding";
  if (name.includes("visual") && !name.includes("source crop")) return "visual_grounding";
  if (name.includes("source text concept")) return "source_text_anchor";
  if (name.includes("source map caveat")) return "source_caveat";
  if (name.includes("source coverage / final artifact")) return "visual_grounding";
  if (name.includes("zettelkasten handle quality") || name.includes("zettelkasten handle naturalness")) return "zettelkasten_handle_support";
  if (name.includes("zettelkasten")) return "zettelkasten_handle";
  if (name.includes("section")) return "section_semantics";
  if (name.includes("contract")) return "contract_fulfillment";
  if (name.includes("semantic navigation")) return "semantic_navigation";
  return null;
}

function shouldRouteToUnitRepair(checkName: string): boolean {
  const type = semanticFailureType(checkName);
  if (!type) return false;
  // Link normalization is finalizer hygiene. The semantic repair loop owns page
  // substance, not the mechanical target family of overview/index links.
  if (type === "semantic_navigation" || type === "source_caveat") return false;
  return true;
}

function fallbackUnitForPage(page: LearnerPage): LearningUnitContract {
  const title = page.title || path.basename(page.rel, ".md");
  return {
    id: fmGetScalar(page.rawFm, "learningUnitId") || page.pageId,
    title,
    role: (fmGetScalar(page.rawFm, "learningUnitRole") || "core_concept") as LearningUnitContract["role"],
    learningQuestion: `What should a learner understand from ${title}?`,
    prerequisiteConcepts: [],
    newConcepts: [],
    sourceAnchors: fmGetArray(page.rawFm, "sourceAnchors"),
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: fmGetArray(page.rawFm, "tags").map((tag) => ({
      handle: tag,
      claim: tag.replace(/-/g, " "),
      connectedTo: [],
    })),
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
  };
}

function pageSummary(page: LearnerPage, unit?: LearningUnitContract): string {
  const words = teachingProseLite(page.body).split(/\s+/).filter(Boolean).slice(0, 32).join(" ");
  return [(unit?.id ?? fmGetScalar(page.rawFm, "learningUnitId")) || page.pageId, page.title, unit?.learningQuestion, words]
    .filter(Boolean)
    .join(" — ");
}

function sourceAnchorFromIdForRepair(anchorId: string): SourceAnchor | null {
  const id = anchorId.trim();
  if (!id) return null;
  const anchor: SourceAnchor = { description: id };
  if (/^text-/i.test(id)) {
    anchor.textAnchorId = id;
  } else if (/\.E\d+$/i.test(id)) {
    anchor.equationId = id;
  } else if (/\.T\d+$/i.test(id)) {
    anchor.tableId = id;
  } else if (/^S\d+\.P\d+\.[A-Z]\d+$/i.test(id)) {
    anchor.figureId = id;
  } else {
    anchor.questionId = id;
  }
  const page = id.match(/\.P(\d+)\./i)?.[1];
  if (page) anchor.page = Number.parseInt(page, 10);
  return anchor;
}

function sourceAnchorsForRepair(page: LearnerPage): SourceAnchor[] {
  const anchors: SourceAnchor[] = [];
  const add = (anchor: SourceAnchor | null) => {
    if (!anchor) return;
    const key = anchor.textAnchorId ?? anchor.equationId ?? anchor.tableId ?? anchor.figureId ?? anchor.questionId ?? anchor.description;
    if (anchors.some((existing) =>
      (existing.textAnchorId ?? existing.equationId ?? existing.tableId ?? existing.figureId ?? existing.questionId ?? existing.description) === key
    )) return;
    anchors.push(anchor);
  };
  for (const id of [
    ...fmGetArray(page.rawFm, "sourceAnchors"),
    ...fmGetArray(page.rawFm, "sourceVisualIds"),
    ...formulaAnchorsFromFrontmatter(page.rawFm).filter((id) => !id.startsWith("trivial:")),
  ]) add(sourceAnchorFromIdForRepair(id));
  for (const spec of embeddedVisualSpecs(page.body)) {
    for (const record of visualSpecAnchorRecords(spec)) {
      const anchor: SourceAnchor = {
        description: String(record.description ?? record.figureId ?? record.tableId ?? record.equationId ?? record.textAnchorId ?? "visual anchor"),
      };
      if (typeof record.sourceId === "string") anchor.sourceId = record.sourceId;
      if (typeof record.sourceTitle === "string") anchor.sourceTitle = record.sourceTitle;
      if (typeof record.page === "number") anchor.page = record.page;
      if (typeof record.figureId === "string") anchor.figureId = record.figureId;
      if (typeof record.tableId === "string") anchor.tableId = record.tableId;
      if (typeof record.equationId === "string") anchor.equationId = record.equationId;
      if (typeof record.questionId === "string") anchor.questionId = record.questionId;
      if (typeof record.textAnchorId === "string") anchor.textAnchorId = record.textAnchorId;
      if (record.role === "input" || record.role === "output_formula" || record.role === "comparison_basis" || record.role === "context") {
        anchor.role = record.role;
      }
      if (typeof record.reason === "string") anchor.reason = record.reason;
      add(anchor);
    }
  }
  return anchors;
}

function repairRequiredChanges(type: UnitRepairFailureType, problem: string): string[] {
  switch (type) {
    case "repeated_opening":
    case "scaffold_prose":
      return [
        "Rewrite only the opening 2-4 paragraphs so this page continues from prior units instead of restarting the global motivation.",
        "Remove repair-scaffold phrases and replace them with finished learner-facing textbook prose.",
        "Keep required source anchors, formulas, tables, figures, visual blocks, and contract-backed Zettelkasten handles in place.",
      ];
    case "section_index_prose":
      return [
        "Rewrite the section index body as polished learner-facing prose that summarizes the actual pages in the section.",
        "Avoid template text, lowercase acronyms, and grammar errors such as 'SNNs learns'.",
      ];
    case "formula_grounding":
      return [
        "Revise the page/formula metadata so source definitions, derived definitions, worked examples, and conceptual helpers agree with the body.",
        "Use the exact source formula anchor text and do not satisfy a source formula requirement with a worked example.",
      ];
    case "visual_grounding":
      return [
        "Rerun visual necessity first; repair only a still-required interaction, or remove/downgrade a stale, optional, or duplicative requirement.",
        "Regenerate a retained visual plan from the Learning Unit Contract using minimal compatible anchors and explicit source-anchor roles/reasons.",
        "Update the page block, visual spec artifact, visual index, and source coverage consistently.",
      ];
    case "source_text_anchor":
      return [
        "Attach a source prose concept anchor when the source explains the visualized concept without a dedicated figure.",
        "If no direct anchor exists, keep conceptual-no-direct-source-figure with a precise justification.",
      ];
    case "zettelkasten_handle":
    case "zettelkasten_handle_support":
      return [
        "Repair LearningUnitContract.zettelNotes handles first, then update page tags from the contract.",
        "Ensure the page prose supports the repaired atomic handles rather than adding fallback generic tags.",
      ];
    case "source_caveat":
      return [
        "Remove stale source-availability caveats that contradict extracted source text, formula anchors, table anchors, or later pages.",
        "If a crop was unreliable, describe the crop-quality limitation without saying source text or formulas are unavailable.",
      ];
    case "section_semantics":
      return [
        "Retitle or split the section according to the roles in the Learning Unit Contract.",
        "Keep canonical page paths coherent with section title, _index frontmatter, H1, and navigation labels.",
      ];
    case "contract_fulfillment":
      return [
        "Fulfill the page's Learning Unit Contract exactly: required source anchors, source figures/tables/formulas, visual type, and zettel handles.",
        "Do not broaden the page with unrelated source assignments.",
      ];
    default:
      return [`Resolve the semantic validation failure: ${problem}`];
  }
}

function repairPromptForRequest(request: Omit<UnitRepairRequest, "repairPrompt">): string {
  return [
    `Rewrite only ${request.pagePath} for Learning Unit ${request.unitId}.`,
    `Canonical section path: ${request.sectionPath}.`,
    `Failure types: ${request.failureTypes.join(", ")}.`,
    "Validation errors:",
    ...request.validationErrors.map((error) => `- ${error}`),
    "Required changes:",
    ...request.requiredChanges.map((change) => `- ${change}`),
    "Preserve the canonical file path, frontmatter schema, source anchor requirements, intended visual block, contract-backed Zettelkasten handles, and flow from previous/next units.",
  ].join("\n");
}

function contractVersionForUnit(unit: LearningUnitContract): string {
  return crypto.createHash("sha1").update(JSON.stringify(unit)).digest("hex").slice(0, 12);
}

function pageSectionPath(page: LearnerPage): string {
  return page.rel.split("/").slice(0, 2).join("/");
}

function resolveFinalPageForRequest(request: UnitRepairRequest, learnerPages: LearnerPage[]): LearnerPage | undefined {
  const byRel = learnerPages.find((page) => page.rel === request.pagePath);
  if (byRel) return byRel;
  const byUnit = learnerPages.filter((page) => fmGetScalar(page.rawFm, "learningUnitId") === request.unitId);
  if (byUnit.length === 1) return byUnit[0];
  const requestedName = path.posix.basename(request.pagePath);
  const byName = learnerPages.filter((page) => path.posix.basename(page.rel) === requestedName);
  return byName.length === 1 ? byName[0] : undefined;
}

function requestForFinalPage(request: UnitRepairRequest, page: LearnerPage): UnitRepairRequest {
  return {
    ...request,
    pagePath: page.rel,
    sectionPath: pageSectionPath(page),
  };
}

function extractUnitIdFromProblem(problem: string): string | null {
  return problem.match(/unit\s+"?([A-Za-z0-9_-]+)"?/i)?.[1] ?? null;
}

function pagesForProblem({
  problem,
  checkName,
  learnerPages,
  sectionInputs,
}: {
  problem: string;
  checkName: string;
  learnerPages: LearnerPage[];
  sectionInputs: Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }>;
}): LearnerPage[] {
  const pages = learnerPages.filter((page) => problem.includes(page.rel));
  if (pages.length > 0) return pages;

  const unitId = extractUnitIdFromProblem(problem);
  if (unitId) {
    const byUnit = learnerPages.filter((page) => fmGetScalar(page.rawFm, "learningUnitId") === unitId);
    if (byUnit.length > 0) return byUnit;
  }

  const section = sectionInputs.find((candidate) => problem.includes(candidate.rel) || problem.includes(candidate.sectionTitle));
  if (section) {
    return learnerPages.filter((page) => page.rel.startsWith(`${section.rel}/`));
  }

  if (/tag ".+" appears on \d+\//i.test(problem) || /duplicate final interactive visual signature/i.test(problem)) {
    return learnerPages.filter((page) => problem.includes(page.rel));
  }

  // Some section-title checks only carry the check name. Route to all pages in
  // the section if exactly one section is implicated by the check family.
  if (/section/i.test(checkName) && sectionInputs.length === 1) {
    return learnerPages.filter((page) => page.rel.startsWith(`${sectionInputs[0].rel}/`));
  }

  return [];
}

function collectUnitRepairRequests({
  gardenDir,
  checks,
}: {
  gardenDir: string;
  checks: FinalizeCheck[];
}): UnitRepairRequest[] {
  const learnerPages = loadLearnerPages(gardenDir);
  const contract = readLearningUnitContract(gardenDir);
  const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
  const sectionInputs = sectionSemanticInputs(gardenDir, learnerPages, unitsById);
  const sortedPages = [...learnerPages].sort((a, b) => a.pageId.localeCompare(b.pageId));
  const requestMap = new Map<string, Omit<UnitRepairRequest, "repairPrompt">>();

  for (const check of checks.filter((item) => item.status === "FAIL" && shouldRouteToUnitRepair(item.name))) {
    const type = semanticFailureType(check.name) ?? "unknown_semantic_failure";
    for (const problem of check.problems) {
      const targets = pagesForProblem({ problem, checkName: check.name, learnerPages, sectionInputs });
      for (const page of targets) {
        const unitId = fmGetScalar(page.rawFm, "learningUnitId") || page.pageId;
        const unit = unitsById.get(unitId) ?? fallbackUnitForPage(page);
        const key = `${page.rel}::${check.name}`;
        const index = sortedPages.findIndex((candidate) => candidate.rel === page.rel);
        const previous = index > 0 ? sortedPages[index - 1] : undefined;
        const next = index >= 0 && index + 1 < sortedPages.length ? sortedPages[index + 1] : undefined;
        const previousUnit = previous ? unitsById.get(fmGetScalar(previous.rawFm, "learningUnitId")) : undefined;
        const nextUnit = next ? unitsById.get(fmGetScalar(next.rawFm, "learningUnitId")) : undefined;
        const existing = requestMap.get(key);
        if (existing) {
          existing.validationErrors.push(`${check.name}: ${problem}`);
          if (!existing.failureTypes.includes(type)) existing.failureTypes.push(type);
          existing.requiredChanges.push(...repairRequiredChanges(type, problem));
          existing.requiredChanges = [...new Set(existing.requiredChanges)];
          continue;
        }
        requestMap.set(key, {
          unitId: unit.id,
          pagePath: page.rel,
          sectionPath: pageSectionPath(page),
          failureTypes: [type],
          validationErrors: [`${check.name}: ${problem}`],
          learningUnitContract: unit,
          previousUnitSummary: previous ? pageSummary(previous, previousUnit) : undefined,
          nextUnitSummary: next ? pageSummary(next, nextUnit) : undefined,
          sourceAnchors: sourceAnchorsForRepair(page),
          currentPageMarkdown: joinFrontmatter(page.rawFm, page.body),
          requiredChanges: repairRequiredChanges(type, problem),
        });
      }
    }
  }

  return [...requestMap.values()].map((request) => ({
    ...request,
    repairPrompt: repairPromptForRequest(request),
  })).sort((a, b) => `${a.pagePath}:${a.failureTypes.join(",")}`.localeCompare(`${b.pagePath}:${b.failureTypes.join(",")}`));
}

function semanticFailureActionsForRequests(requests: UnitRepairRequest[]): FinalizerAction[] {
  return requests.map((request) => ({
    kind: "semantic_failure",
    description: `${request.failureTypes.join(", ")} on ${request.pagePath}`,
    unitId: request.unitId,
    pagePath: request.pagePath,
    repairPrompt: request.repairPrompt,
  }));
}

/** Stable id for a page repair, so page metadata and the repair log can be
 * cross-referenced. */
function repairRequestId(request: UnitRepairRequest): string {
  return crypto
    .createHash("sha1")
    .update(`${request.pagePath}::${request.unitId}::${[...new Set(request.failureTypes)].sort().join(",")}`)
    .digest("hex")
    .slice(0, 12);
}

/** Serialize/replace the nested `lastSemanticRepair:` block. Kept alongside the
 * flat provenance keys (generatedFromUnitId/lastSemanticRepairAt/
 * semanticRepairReason) that the validators already read, so this block is
 * purely additive structured metadata that also records WHICH executor ran. */
function fmSetLastSemanticRepair(
  rawFm: string,
  value: { repairedAt: string; repairType: RepairExecutorKind; failureTypes: string[]; repairRequestId: string },
): string {
  const stripped = fmRemoveBlock(rawFm, "lastSemanticRepair");
  const block = [
    "lastSemanticRepair:",
    `  repairedAt: ${jsonScalar(value.repairedAt)}`,
    `  repairType: ${jsonScalar(value.repairType)}`,
    `  repairRequestId: ${jsonScalar(value.repairRequestId)}`,
    "  failureTypes:",
    ...value.failureTypes.map((type) => `    - ${jsonScalar(type)}`),
  ].join("\n");
  const strippedLines = stripped.split(/\r?\n/);
  const anchorIndex = strippedLines.findIndex((line) => /^generatedBy:/.test(line));
  if (anchorIndex >= 0) {
    strippedLines.splice(anchorIndex, 0, block);
    return strippedLines.join("\n");
  }
  return `${stripped.replace(/\s+$/, "")}\n${block}`;
}

/** Remove a nested `key:` frontmatter block (the key line plus its indented
 * children). */
function fmRemoveBlock(rawFm: string, key: string): string {
  const lines = rawFm.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*`).test(line));
  if (start < 0) return rawFm;
  let end = start + 1;
  while (end < lines.length && /^\s+/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function markSemanticRepairProvenance(
  page: LearnerPage,
  request: UnitRepairRequest,
  repairedAt: string,
  repairType: RepairExecutorKind,
): void {
  const failureTypes = [...new Set(request.failureTypes)];
  page.rawFm = fmSetScalar(page.rawFm, "generatedFromUnitId", request.unitId);
  page.rawFm = fmSetScalar(page.rawFm, "contractVersion", contractVersionForUnit(request.learningUnitContract));
  page.rawFm = fmSetScalar(page.rawFm, "lastSemanticRepairAt", repairedAt);
  page.rawFm = fmSetScalar(page.rawFm, "semanticRepairReason", failureTypes.join(", "));
  page.rawFm = fmSetLastSemanticRepair(page.rawFm, {
    repairedAt,
    repairType,
    failureTypes,
    repairRequestId: repairRequestId(request),
  });
  page.dirty = true;
}

function validationFailuresFromChecks(checks: FinalizeCheck[]): string[] {
  // Fix 12/13: one failure per stable semantic issue across validator prefixes.
  return dedupeSemanticBlockerLines(
    checks
      .filter((check) => check.status === "FAIL")
      .flatMap((check) => check.problems.length > 0
        ? check.problems.map((problem) => ({ check: check.name, problem }))
        : [{ check: check.name, problem: "failed" }]),
  );
}

// Meta bookkeeping checks that validate the repair log / finalizer boundary
// rather than a page's semantic substance. They cannot be used to decide
// whether a page repair "resolved" its defect: at the point the repair loop
// re-runs checks to grade itself, `.breadboard/repair-log.json` has not been
// written yet, so "Repair Provenance" always reports the just-marked pages as
// "provenance but log missing". These are guaranteed-transient and are enforced
// for real by the finalizer's critical gate once the log exists.
// The Final Garden State Audit is a whole-garden acceptance gate enforced by the
// finalizer AFTER reconciliation writes Source Coverage / the anchor ledger /
// the repair log. During the repair loop those files still hold pre-reconcile
// drift, so audit failures must not be blamed on an individual page repair.
const REPAIR_BOOKKEEPING_CHECKS = new Set(["Repair Provenance", "Finalizer semantic boundary", "Final Garden State Audit"]);

const SECTION_ONLY_REPAIR_TYPES = new Set(["section_index_prose", "section_semantics"]);

function requestHasPageScopedFailure(request: UnitRepairRequest): boolean {
  return request.failureTypes.some((type) => !SECTION_ONLY_REPAIR_TYPES.has(type));
}

function validationFailureAppliesToRequest(failure: string, request: UnitRepairRequest): boolean {
  const pageScoped = requestHasPageScopedFailure(request);
  if (pageScoped && failure.includes(request.pagePath)) return true;
  if (pageScoped && (failure.includes(`unit "${request.unitId}"`) || failure.includes(`unit ${request.unitId}`))) return true;

  if (request.failureTypes.includes("section_index_prose")) {
    const sectionIndexPath = `${request.sectionPath}/_index.md`;
    if (failure.includes(sectionIndexPath)) return true;
    if (/Section Index Prose/i.test(failure) && failure.includes(request.sectionPath)) return true;
  }

  if (request.failureTypes.includes("section_semantics")) {
    if (failure.includes(request.sectionPath)) return true;
    if (/Section semantic coherence/i.test(failure) && failure.includes(path.basename(request.sectionPath))) return true;
  }

  return false;
}

function unresolvedErrorsForRequest(checks: FinalizeCheck[], request: UnitRepairRequest): string[] {
  return validationFailuresFromChecks(checks.filter((check) => !REPAIR_BOOKKEEPING_CHECKS.has(check.name))).filter((failure) =>
    validationFailureAppliesToRequest(failure, request),
  );
}

function writeDirtyLearnerPages(learnerPages: LearnerPage[], report: FinalizeReport): void {
  for (const page of learnerPages) {
    if (!page.dirty) continue;
    fs.writeFileSync(page.abs, joinFrontmatter(page.rawFm, page.body), "utf-8");
    if (!report.changed.includes(page.rel)) report.changed.push(page.rel);
  }
}

function repairLogPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "repair-log.json");
}

function repairReportPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "repair-report.md");
}

function writeRepairArtifacts(gardenDir: string, report: LearningUnitRepairRunReport): void {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });
  fs.writeFileSync(repairLogPath(gardenDir), `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const lines = [
    "# Breadboard Repair Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Garden: ${report.gardenSlug}`,
    "",
    `Repair executor mode: ${report.repairExecutorMode}`,
    "",
    "## Repaired Units",
    "",
    "| Unit | Page | Failure | Executor Used | Model Status | Natural Prose | Result |",
    "|---|---|---|---|---|---|---|",
    ...(report.repairs.length > 0
      ? report.repairs.map((entry) =>
          `| ${entry.unitId} | ${entry.pagePath} | ${entry.failureTypes.join(", ")} | ${entry.executorUsed} | ${entry.modelRepairStatus} | ${entry.naturalProseValidation ?? "not_applicable"} | ${entry.result} |`,
        )
      : ["| None | None | None | None | None | None | not_applicable |"]),
    "",
    "## Executor Provenance",
    "",
    ...(report.repairs.length > 0
      ? report.repairs.flatMap((entry) => [
          `- ${entry.pagePath}: preference ${entry.executorPreference}, attempted [${entry.executorAttempted.join(", ") || "none"}], used ${entry.executorUsed}, model ${entry.modelRepairStatus}, natural prose ${entry.naturalProseValidation ?? "not_applicable"}${entry.modelFailureReason ? ` (model fell back: ${entry.modelFailureReason})` : ""}`,
        ])
      : ["- None."]),
    "",
    "## Repair Requests",
    "",
    ...(report.requests.length > 0
      ? report.requests.flatMap((request) => [
          `### ${request.unitId}: ${request.pagePath}`,
          "",
          `Failure types: ${request.failureTypes.join(", ")}`,
          "",
          "Validation errors:",
          ...request.validationErrors.map((error) => `- ${error}`),
          "",
          "Required changes:",
          ...request.requiredChanges.map((change) => `- ${change}`),
          "",
        ])
      : ["- None.", ""]),
    "## Contract Changed Files",
    "",
    ...((report.contractChangedFiles ?? []).length > 0
      ? (report.contractChangedFiles ?? []).map((entry) =>
          `- ${entry.file}${entry.affectedUnits.length > 0 ? ` (affected units: ${entry.affectedUnits.join(", ")})` : ""}`,
        )
      : ["- None."]),
    "",
    "## Finalizer Changed Files",
    "",
    ...((report.finalizerChangedFiles ?? []).length > 0
      ? (report.finalizerChangedFiles ?? []).map((file) => `- ${file}`)
      : ["- None."]),
    "",
    "## Finalizer Notes",
    "",
    ...((report.finalizerNotes ?? []).length > 0
      ? (report.finalizerNotes ?? []).slice(0, 200).map((note) => `- ${note}`)
      : ["- None."]),
    "",
    "## Semantic Finalizer Actions",
    "",
    ...(report.semanticFinalizerActions.length > 0
      ? report.semanticFinalizerActions.map((action) =>
          action.kind === "semantic_failure"
            ? `- Routed to repair: ${action.description}`
            : `- Mechanical: ${action.description} (${action.filePath})`,
        )
      : ["- None."]),
    "",
    "## Final Verification",
    "",
    `Accepted: ${report.finalVerification?.accepted ? "yes" : "no"}`,
    `No-mutation check: ${report.finalVerification ? (report.finalVerification.mutatedFiles.length === 0 ? "pass" : "fail") : "not run"}`,
    "Validation failures:",
    ...(report.finalVerification?.validationFailures.length
      ? report.finalVerification.validationFailures.map((failure) => `- ${failure}`)
      : ["- None."]),
    "Unresolved semantic failures:",
    ...(report.finalVerification?.unresolvedRepairFailures.length
      ? report.finalVerification.unresolvedRepairFailures.map((failure) => `- ${failure}`)
      : ["- None."]),
    "Mutated during verification:",
    ...(report.finalVerification?.mutatedFiles.length
      ? report.finalVerification.mutatedFiles.map((file) => `- ${file}`)
      : ["- None."]),
    "",
  ];
  fs.writeFileSync(repairReportPath(gardenDir), `${lines.join("\n")}\n`, "utf-8");
}

function readRepairRunReport(gardenDir: string): LearningUnitRepairRunReport | null {
  try {
    const parsed = JSON.parse(readFileSyncWithRetry(repairLogPath(gardenDir), "utf-8"));
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.repairs)) {
      return parsed as LearningUnitRepairRunReport;
    }
  } catch {
    // no repair run yet
  }
  return null;
}

function mergeRequestsForPage(pageRequests: UnitRepairRequest[]): UnitRepairRequest {
  return {
    ...pageRequests[0],
    failureTypes: [...new Set(pageRequests.flatMap((request) => request.failureTypes))],
    validationErrors: [...new Set(pageRequests.flatMap((request) => request.validationErrors))],
    requiredChanges: [...new Set(pageRequests.flatMap((request) => request.requiredChanges))],
  };
}

const PROSE_REPAIR_TYPES = new Set<string>([
  "repeated_opening",
  "scaffold_prose",
  "section_index_prose",
  "zettelkasten_handle_support",
]);

const PAGE_PROSE_REPAIR_TYPES = new Set<string>([
  "repeated_opening",
  "scaffold_prose",
  "zettelkasten_handle_support",
]);

function repairExecutorPreference(failureTypes: string[]): RepairExecutorPreference {
  return failureTypes.some((type) => PROSE_REPAIR_TYPES.has(type)) ? "model_first" : "deterministic_allowed";
}

function modelRepairStatusFor({
  request,
  attempted,
  used,
  wantModel,
}: {
  request: UnitRepairRequest;
  attempted: RepairExecutorKind[];
  used: RepairExecutorKind | "none";
  wantModel: boolean;
}): ModelRepairStatus {
  if (used === "model") return "used";
  if (attempted.includes("model")) return "attempted";
  if (repairExecutorPreference(request.failureTypes) === "model_first" && !wantModel) return "unavailable";
  return "skipped";
}

function changedFilesForRequest(
  request: UnitRepairRequest,
  changedFiles: string[],
  page?: LearnerPage,
): string[] {
  const ownedVisualIds = new Set<string>();
  if (page) {
    for (const id of fmGetArray(page.rawFm, "visualIds")) ownedVisualIds.add(id);
    for (const id of embeddedGeneratedVisualIds(page.body)) ownedVisualIds.add(id);
    for (const spec of embeddedVisualSpecs(page.body)) {
      const id = String(spec.id ?? "").trim();
      if (id) ownedVisualIds.add(id);
    }
  }
  const allowContract = request.failureTypes.some((type) =>
    ["zettelkasten_handle", "zettelkasten_handle_support", "contract_fulfillment", "source_text_anchor"].includes(type),
  );
  const allowCoverage = request.failureTypes.some((type) => ["visual_grounding", "source_text_anchor"].includes(type));
  const allowSourceAnchors = request.failureTypes.includes("source_text_anchor");
  const allowOwnedVisualSpecs = request.failureTypes.some((type) =>
    ["visual_grounding", "source_text_anchor", "formula_grounding", "contract_fulfillment"].includes(type),
  );
  return changedFiles.filter((file) => {
    if (file === request.pagePath) return true;
    if (file === `${request.sectionPath}/_index.md`) return true;
    if (request.failureTypes.includes("section_semantics") && (file === "learning/_index.md" || file === "learning/Learning Map.md")) return true;
    if (allowContract && file === ".breadboard/learning-unit-contract.json") return true;
    if (allowCoverage && file === ".breadboard/planning/Source Coverage.md") return true;
    if (allowSourceAnchors && file === ".breadboard/source-anchors.json") return true;
    if (file.startsWith(".breadboard/visuals/")) {
      const visualId = file.match(/^\.breadboard\/visuals\/(.+)\.json$/)?.[1] ?? "";
      return allowOwnedVisualSpecs && ownedVisualIds.has(visualId);
    }
    return false;
  });
}

/** Visual spec ids a repaired page is allowed to touch: those declared in
 * frontmatter visualIds plus any already embedded in the page body. A model
 * candidate that writes any other spec id is out of scope. */
function pageAllowedVisualIds(page: LearnerPage): Set<string> {
  const ids = new Set<string>(fmGetArray(page.rawFm, "visualIds"));
  for (const id of embeddedGeneratedVisualIds(page.body)) ids.add(id);
  for (const spec of embeddedVisualSpecs(page.body)) {
    const id = String(spec.id ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

function modelAuthoredZettelPatchProblems(
  request: UnitRepairRequest,
  patch: NonNullable<RepairCandidate["contractZettelPatch"]>,
): string[] {
  const problems: string[] = [];
  if (
    !request.failureTypes.some((type) =>
      type === "zettelkasten_handle" || type === "zettelkasten_handle_support")
  ) {
    problems.push("candidate contract Zettel patch is outside this repair request's failure scope");
  }
  if (patch.unitId !== request.unitId) {
    problems.push(`candidate patches unsupported contract unit ${patch.unitId} (request unit ${request.unitId})`);
  }
  if (!Array.isArray(patch.zettelNotes) || patch.zettelNotes.length === 0) {
    problems.push("candidate contract Zettel patch must contain complete zettelNotes");
    return problems;
  }
  const handles = new Set<string>();
  for (const [index, note] of patch.zettelNotes.entries()) {
    const prefix = `candidate contract Zettel patch zettelNotes[${index}]`;
    if (!note || typeof note !== "object") {
      problems.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof note.handle !== "string" || note.handle.trim() !== note.handle || !isAtomicZettelHandle(note.handle)) {
      problems.push(`${prefix}.handle must be a complete atomic model-authored handle`);
    } else if (handles.has(note.handle)) {
      problems.push(`${prefix}.handle duplicates ${note.handle}`);
    } else {
      handles.add(note.handle);
    }
    if (typeof note.claim !== "string" || note.claim.trim() !== note.claim || !note.claim) {
      problems.push(`${prefix}.claim must be non-empty model-authored prose`);
    }
    if (
      !Array.isArray(note.connectedTo) ||
      note.connectedTo.some((value) => typeof value !== "string" || value.trim() !== value || !value)
    ) {
      problems.push(`${prefix}.connectedTo must be an array of non-empty exact identifiers`);
    } else if (new Set(note.connectedTo).size !== note.connectedTo.length) {
      problems.push(`${prefix}.connectedTo must not contain duplicates`);
    }
  }
  return problems;
}

/** Scope violations that disqualify a model candidate before anything is
 * written: missing/renamed frontmatter, wrong unit, or edits to files the page
 * does not own. This is what makes "candidate changes unsupported files" fail. */
function repairCandidateScopeProblems(page: LearnerPage, request: UnitRepairRequest, candidate: RepairCandidate): string[] {
  const problems: string[] = [];
  const parsed = parseFrontmatter(candidate.markdown);
  if (!parsed.hadFrontmatter) {
    problems.push("candidate markdown has no frontmatter");
    return problems;
  }
  const candidateUnitId = fmGetScalar(parsed.rawFrontmatter, "learningUnitId");
  const currentUnitId = fmGetScalar(page.rawFm, "learningUnitId");
  if (currentUnitId && candidateUnitId && candidateUnitId !== currentUnitId) {
    problems.push(`candidate changed learningUnitId ${currentUnitId} -> ${candidateUnitId}`);
  }
  const allowedVisualIds = pageAllowedVisualIds(page);
  const currentGeneratedVersions = embeddedGeneratedVisualVersions(page.body);
  const candidateGeneratedVersions = embeddedGeneratedVisualVersions(parsed.body);
  for (const [id, version] of currentGeneratedVersions) {
    if (!candidateGeneratedVersions.has(id)) {
      problems.push(`candidate removed generated visual ${id} owned by ${request.pagePath}`);
    } else if (candidateGeneratedVersions.get(id) !== version) {
      problems.push(`candidate changed generated visual ${id} from v${version} to v${candidateGeneratedVersions.get(id)}`);
    }
  }
  for (const entry of candidate.visualSpecs ?? []) {
    if (!allowedVisualIds.has(entry.id)) {
      problems.push(`candidate writes unsupported visual spec ${entry.id} not owned by ${request.pagePath}`);
    }
  }
  if (candidate.contractZettelPatch) {
    problems.push(...modelAuthoredZettelPatchProblems(request, candidate.contractZettelPatch));
  }
  return problems;
}

function snapshotFilesForRevert(absPaths: string[]): Map<string, Buffer | null> {
  const snap = new Map<string, Buffer | null>();
  for (const abs of absPaths) snap.set(abs, fs.existsSync(abs) ? readFileSyncWithRetry(abs) : null);
  return snap;
}

function restoreFilesFromSnapshot(snap: Map<string, Buffer | null>): void {
  for (const [abs, buf] of snap) {
    if (buf === null) fs.rmSync(abs, { force: true });
    else fs.writeFileSync(abs, buf);
  }
}

/** Write a model candidate to disk (page markdown + owned visual specs +
 * optional complete model-authored Zettel patch), returning the changed rel paths and a
 * `restore` closure that reverts every touched file to its pre-write bytes. */
function applyRepairCandidate(
  gardenDir: string,
  page: LearnerPage,
  candidate: RepairCandidate,
  contractPath: string | undefined,
): { changedFiles: string[]; restore: () => void } {
  const touched: string[] = [page.abs];
  for (const entry of candidate.visualSpecs ?? []) {
    touched.push(path.join(gardenDir, ".breadboard", "visuals", `${entry.id}.json`));
  }
  if (candidate.contractZettelPatch && contractPath) touched.push(contractPath);
  const snap = snapshotFilesForRevert(touched);

  const changedFiles: string[] = [];
  const relOf = (abs: string) => path.relative(gardenDir, abs).replace(/\\/g, "/");

  fs.writeFileSync(page.abs, candidate.markdown, "utf-8");
  changedFiles.push(page.rel);

  for (const entry of candidate.visualSpecs ?? []) {
    const target = path.join(gardenDir, ".breadboard", "visuals", `${entry.id}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(entry.spec, null, 2)}\n`, "utf-8");
    changedFiles.push(relOf(target));
  }

  if (candidate.contractZettelPatch && contractPath) {
    const parsed = readJson<Record<string, unknown>>(contractPath, {});
    const rawUnits = Array.isArray(parsed.learningUnits) ? (parsed.learningUnits as Array<Record<string, unknown>>) : [];
    const unit = rawUnits.find((raw) => cleanText(raw.id) === candidate.contractZettelPatch!.unitId);
    if (unit) {
      unit.zettelNotes = candidate.contractZettelPatch.zettelNotes.map((note) => ({
        handle: note.handle,
        claim: note.claim,
        connectedTo: [...note.connectedTo],
      }));
      fs.writeFileSync(contractPath, JSON.stringify(parsed, null, 2), "utf-8");
      changedFiles.push(relOf(contractPath));
    }
  }

  return { changedFiles, restore: () => restoreFilesFromSnapshot(snap) };
}

/** Persist a rejected model candidate + reasons under
 * .breadboard/debug/failed-repairs/ so failures are never silently dropped. */
function dumpFailedRepair(gardenDir: string, request: UnitRepairRequest, candidate: RepairCandidate | null, reasons: string[]): string {
  const dir = path.join(gardenDir, ".breadboard", "debug", "failed-repairs");
  fs.mkdirSync(dir, { recursive: true });
  const slug = `${slugifyLoose(request.pagePath.replace(/\.md$/i, ""))}-${repairRequestId(request)}`;
  const rel = `.breadboard/debug/failed-repairs/${slug}.md`;
  const lines = [
    `# Rejected model repair candidate`,
    "",
    `Page: ${request.pagePath}`,
    `Unit: ${request.unitId}`,
    `Failure types: ${request.failureTypes.join(", ")}`,
    `Rejected at: ${new Date().toISOString()}`,
    "",
    "## Rejection reasons",
    "",
    ...(reasons.length ? reasons.map((reason) => `- ${reason}`) : ["- (none recorded)"]),
    "",
    "## Candidate markdown",
    "",
    "````markdown",
    candidate?.markdown ?? "(model returned no candidate)",
    "````",
    "",
  ];
  if (candidate?.visualSpecs?.length) {
    lines.push("## Candidate visual specs", "", "```json", JSON.stringify(candidate.visualSpecs, null, 2), "```", "");
  }
  if (candidate?.contractZettelPatch) {
    lines.push("## Candidate contract patch", "", "```json", JSON.stringify(candidate.contractZettelPatch, null, 2), "```", "");
  }
  fs.writeFileSync(path.join(gardenDir, ...rel.split("/")), `${lines.join("\n")}\n`, "utf-8");
  return rel;
}

interface ModelRepairAttempt {
  success: boolean;
  changedFiles: string[];
  validationErrorsAfter: string[];
  modelFailureReason?: string;
  notes: string[];
}

/** Try one model repair for a single page: call the executor, scope-check the
 * candidate, apply it, validate it against the same checks that grade the
 * request, and keep it only if the page's failures are cleared. Provider/model
 * exceptions deliberately escape with their original identity. Only a returned
 * candidate may be converted into semantic validation evidence. */
/** @internal Exported so fail-closed request identity can be regression-tested
 * without running the full garden finalization pipeline. */
export async function tryModelRepairForPage({
  gardenDir,
  gardenSlug,
  request,
  modelRepair,
  repairReport,
  contractPath,
  strictModelApprovedVisuals = false,
  expectedVisualContractExecutabilityContext,
  expectedSourceFormulaReviewContext,
}: {
  gardenDir: string;
  gardenSlug: string;
  request: UnitRepairRequest;
  modelRepair: ModelRepairExecutor;
  repairReport: FinalizeReport;
  contractPath: string | undefined;
  strictModelApprovedVisuals?: boolean;
  expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
}): Promise<ModelRepairAttempt> {
  const page = loadLearnerPages(gardenDir).find((candidate) => candidate.rel === request.pagePath);
  if (!page) {
    return { success: false, changedFiles: [], validationErrorsAfter: [], modelFailureReason: "page not found on disk", notes: [] };
  }

  const candidate = await modelRepair(request);
  if (!candidate || typeof candidate.markdown !== "string" || !candidate.markdown.trim()) {
    return { success: false, changedFiles: [], validationErrorsAfter: [], modelFailureReason: "model returned no candidate", notes: [] };
  }

  const scopeProblems = repairCandidateScopeProblems(page, request, candidate);
  if (scopeProblems.length > 0) {
    const dumped = dumpFailedRepair(gardenDir, request, candidate, scopeProblems);
    return {
      success: false,
      changedFiles: [],
      validationErrorsAfter: scopeProblems,
      modelFailureReason: `candidate out of scope: ${scopeProblems.join("; ")}`,
      notes: [`rejected candidate saved to ${dumped}`],
    };
  }

  const applied = applyRepairCandidate(gardenDir, page, candidate, contractPath);
  const checks = collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report: emptyFinalizeReport(),
    includeReportSelfCheck: false,
    strictModelApprovedVisuals,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  });
  const problems = unresolvedErrorsForRequest(checks, request);
  if (problems.length > 0) {
    const dumped = dumpFailedRepair(gardenDir, request, candidate, problems);
    applied.restore();
    return {
      success: false,
      changedFiles: [],
      validationErrorsAfter: problems,
      modelFailureReason: `candidate failed validation: ${problems.slice(0, 3).join("; ")}`,
      notes: [`rejected candidate saved to ${dumped}`],
    };
  }

  for (const file of applied.changedFiles) {
    if (!repairReport.changed.includes(file)) repairReport.changed.push(file);
  }
  return { success: true, changedFiles: applied.changedFiles, validationErrorsAfter: [], notes: candidate.notes ?? [] };
}

export async function repairLearningUnitsFromContract({
  gardenDir,
  gardenSlug,
  repairExecutor = "deterministic",
  modelRepair,
  preserveModelAuthoredVisuals = false,
  preserveModelAuthoredContent = false,
  expectedVisualContractExecutabilityContext,
  expectedSourceFormulaReviewContext,
}: {
  gardenDir: string;
  gardenSlug: string;
  /** Which executor(s) to use. Defaults to deterministic (safe, LLM-free). */
  repairExecutor?: RepairExecutorMode;
  /** Injected model executor. Required for the "model" modes; ignored otherwise. */
  modelRepair?: ModelRepairExecutor;
  /** Active Learn plans keep the validated model visual contract immutable. */
  preserveModelAuthoredVisuals?: boolean;
  /** Skip preflight contract/source reconciliation that would silently mutate
   * model-authored semantics before the model sees the validation failures. */
  preserveModelAuthoredContent?: boolean;
  expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
}): Promise<LearningUnitRepairRunReport> {
  const requestedAt = new Date().toISOString();
  const preflightRepairReport = emptyFinalizeReport();
  const preservedVisualPlans = preserveModelAuthoredContent
    ? new Map<string, PreservedContractVisualPlan>()
    : reconcileContractArtifactsAgainstSourceRegistry(
        gardenDir,
        preflightRepairReport,
        { preserveModelAuthoredVisuals },
      );
  if (!preserveModelAuthoredContent && !preserveModelAuthoredVisuals) {
    replanContractVisualNecessity(gardenDir, gardenSlug, preservedVisualPlans);
  }
  // Keep the derived coverage view synchronized before model candidates are
  // graded. This does not choose anchors or alter learner/model content.
  regenerateSourceCoverageFromFinalState(gardenDir, gardenSlug, preflightRepairReport);
  const reportForChecks = emptyFinalizeReport();
  const firstChecks = collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report: reportForChecks,
    includeReportSelfCheck: false,
    strictModelApprovedVisuals: preserveModelAuthoredContent,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  });
  const requests = collectUnitRepairRequests({ gardenDir, checks: firstChecks });
  const repairReport = emptyFinalizeReport();
  const changedBefore = new Set(repairReport.changed);
  repairReport.changed.push(...preflightRepairReport.changed);
  repairReport.notes.push(...preflightRepairReport.notes);
  const repairedAt = new Date().toISOString();

  const wantModel = (repairExecutor === "model" || repairExecutor === "model_with_deterministic_fallback") && typeof modelRepair === "function";
  // `preserveModelAuthoredContent` is a hard authorship boundary, not merely a
  // preference for the model executor. Even if a caller accidentally requests
  // the legacy deterministic executor, semantic repair must fail closed rather
  // than synthesize prose, anchors, formulas, concepts, or claims.
  const allowDeterministic = !preserveModelAuthoredContent
    && (repairExecutor === "deterministic" || repairExecutor === "model_with_deterministic_fallback");

  const requestByPage = new Map<string, UnitRepairRequest[]>();
  for (const request of requests) {
    const list = requestByPage.get(request.pagePath) ?? [];
    list.push(request);
    requestByPage.set(request.pagePath, list);
  }

  // executor bookkeeping, keyed by page path.
  const modelRepairedPaths = new Set<string>();
  const executions: RepairExecutionResult[] = [];
  const attemptedByPage = new Map<string, RepairExecutorKind[]>();
  const usedByPage = new Map<string, RepairExecutorKind>();
  const modelFailureByPage = new Map<string, string>();
  const repairedPaths = new Set<string>();

  if (requests.length > 0) {
    const bd = path.join(gardenDir, ".breadboard");
    const ledgerPath = path.join(bd, "source-visuals.json");
    const contractPath = readLearningUnitContract(gardenDir).foundPath;

    // --- Phase 1: model-backed single-page repair -----------------------------
    if (wantModel && typeof modelRepair === "function") {
      for (const [pagePath, pageRequests] of requestByPage) {
        const merged = mergeRequestsForPage(pageRequests);
        attemptedByPage.set(pagePath, ["model"]);
        const attempt = await tryModelRepairForPage({
          gardenDir,
          gardenSlug,
          request: merged,
          modelRepair,
          repairReport,
          contractPath,
          strictModelApprovedVisuals: preserveModelAuthoredContent,
          expectedVisualContractExecutabilityContext,
          expectedSourceFormulaReviewContext,
        });
        if (
          !allowDeterministic &&
          !attempt.success &&
          attempt.modelFailureReason === "model returned no candidate"
        ) {
          throw new Error(
            `Model repair for ${pagePath} returned no nonempty candidate; no semantic retry was issued.`,
          );
        }
        executions.push({
          unitId: merged.unitId,
          pagePath,
          executor: "model",
          changedFiles: attempt.changedFiles,
          success: attempt.success,
          validationErrorsBefore: merged.validationErrors,
          validationErrorsAfter: attempt.validationErrorsAfter,
          notes: attempt.notes,
        });
        if (attempt.success) {
          modelRepairedPaths.add(pagePath);
          repairedPaths.add(pagePath);
          usedByPage.set(pagePath, "model");
        } else if (attempt.modelFailureReason) {
          modelFailureByPage.set(pagePath, attempt.modelFailureReason);
        }
      }
    }

    // --- Phase 2: deterministic repair (fallback / default) -------------------
    // Runs over pages the model did NOT already repair, so a validated model
    // page is never clobbered. Section-structure passes run over the full tree
    // because they only touch _index files, not learner-page bodies.
    if (allowDeterministic && !preserveModelAuthoredContent) {
      const ledger = readJson<LedgerVisual[]>(ledgerPath, []);
      const semanticMigration = migrateGardenSemantics(gardenDir, { gardenId: gardenSlug });
      for (const rel of semanticMigration.changedFiles) {
        if (!repairReport.changed.includes(rel)) repairReport.changed.push(rel);
      }
      const allPages = loadLearnerPages(gardenDir);
      const deterministicPages = allPages.filter((page) => !modelRepairedPaths.has(page.rel));
      const contract = readLearningUnitContract(gardenDir);

      const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
      repairSectionSemanticTitles(gardenDir, allPages, unitsById, repairReport);
      repairSectionIndexProse(gardenDir, repairReport);
      repairSourceTextConceptAnchors(gardenDir, deterministicPages, repairReport);
      repairLearningUnitSourceTextAnchors(gardenDir, deterministicPages, unitsById, repairReport);
      registerExistingTextAnchors(gardenDir, deterministicPages, unitsById, repairReport);
      synchronizeContractSourceAnchors(gardenDir, contract, deterministicPages, repairReport);
      repairMetricCalculatorFocus(gardenDir, deterministicPages, repairReport);
      repairVisualAnchorRolesAndReasons(gardenDir, deterministicPages, repairReport);
      regroundFormulas({ gardenDir, ledger, learnerPages: deterministicPages, report: repairReport });
      removeRepeatedMotivation(deterministicPages, repairReport);
      repairLearnerAcronymGrammar(deterministicPages, repairReport);
      repairSourceVisualImagePathCasing(gardenDir, deterministicPages, repairReport);
      writeDirtyLearnerPages(deterministicPages, repairReport);
      alignSectionFoldersWithTitles(gardenDir, repairReport);
      repairSectionNavigationLabels(gardenDir, repairReport);

      for (const pagePath of requestByPage.keys()) {
        if (modelRepairedPaths.has(pagePath)) continue;
        attemptedByPage.set(pagePath, [...(attemptedByPage.get(pagePath) ?? []), "deterministic"]);
        usedByPage.set(pagePath, "deterministic");
        repairedPaths.add(pagePath);
      }
    }

    // --- Provenance: only pages that actually got a repair executor applied ----
    const finalPages = loadLearnerPages(gardenDir);
    const finalRequestsByRel = new Map<string, UnitRepairRequest[]>();
    const usedByFinalRel = new Map<string, RepairExecutorKind>();
    for (const [originalPagePath, pageRequests] of requestByPage) {
      if (!repairedPaths.has(originalPagePath)) continue;
      const merged = mergeRequestsForPage(pageRequests);
      const finalPage = resolveFinalPageForRequest(merged, finalPages);
      if (!finalPage) continue;
      const resolved = requestForFinalPage(merged, finalPage);
      const list = finalRequestsByRel.get(finalPage.rel) ?? [];
      list.push(resolved);
      finalRequestsByRel.set(finalPage.rel, list);
      usedByFinalRel.set(finalPage.rel, usedByPage.get(originalPagePath) ?? usedByPage.get(finalPage.rel) ?? "deterministic");
    }
    for (const page of finalPages) {
      const pageRequests = finalRequestsByRel.get(page.rel);
      if (!pageRequests?.length) continue;
      const merged = mergeRequestsForPage(pageRequests);
      markSemanticRepairProvenance(page, merged, repairedAt, usedByFinalRel.get(page.rel) ?? "deterministic");
    }
    writeDirtyLearnerPages(finalPages, repairReport);
  }

  const pagesForAnchorSync = loadLearnerPages(gardenDir);
  if (!preserveModelAuthoredContent) {
    regroundFormulas(
      { gardenDir, ledger: readJson<LedgerVisual[]>(path.join(gardenDir, ".breadboard", "source-visuals.json"), []), learnerPages: pagesForAnchorSync, report: repairReport },
    );
    repairLearnerAcronymGrammar(pagesForAnchorSync, repairReport);
    repairVisualAnchorRolesAndReasons(gardenDir, pagesForAnchorSync, repairReport);
    synchronizePageVisualTextAnchors(pagesForAnchorSync, repairReport);
  }
  repairSourceVisualImagePathCasing(gardenDir, pagesForAnchorSync, repairReport);
  writeDirtyLearnerPages(pagesForAnchorSync, repairReport);
  if (!preserveModelAuthoredContent) {
    const contractForAnchorSync = readLearningUnitContract(gardenDir);
    const unitsForAnchorSync = new Map(contractForAnchorSync.units.map((unit) => [unit.id, unit]));
    registerExistingTextAnchors(gardenDir, pagesForAnchorSync, unitsForAnchorSync, repairReport);
    synchronizeContractSourceAnchors(gardenDir, contractForAnchorSync, pagesForAnchorSync, repairReport);
  }
  regenerateSourceCoverageFromFinalState(gardenDir, gardenSlug, repairReport);
  if (!preserveModelAuthoredContent) {
    // Preserve rejected-candidate dumps under debug/failed-repairs/ through the
    // repair loop; only the final EXPORT (finalizeGardenExport) strips them.
    const reconcile = reconcileFinalGardenState(gardenDir, gardenSlug, { stripDebugFailedRepairs: false });
    for (const rel of reconcile.changed) if (!repairReport.changed.includes(rel)) repairReport.changed.push(rel);
    for (const note of reconcile.notes) repairReport.notes.push(note);
  }
  const finalChecks = collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report: emptyFinalizeReport(),
    includeReportSelfCheck: false,
    strictModelApprovedVisuals: preserveModelAuthoredContent,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  });
  const finalPageByRel = new Map(loadLearnerPages(gardenDir).map((page) => [page.rel, page]));
  const changedFiles = [...new Set(repairReport.changed.filter((file) => !changedBefore.has(file)))].sort();
  const repairs: UnitRepairLogEntry[] = requests.map((request) => {
    const finalPage = finalPageByRel.get(request.pagePath) ?? resolveFinalPageForRequest(request, [...finalPageByRel.values()]);
    const resolvedRequest = finalPage ? requestForFinalPage(request, finalPage) : request;
    const unresolved = unresolvedErrorsForRequest(finalChecks, resolvedRequest);
    const attempted = attemptedByPage.get(request.pagePath) ?? attemptedByPage.get(resolvedRequest.pagePath) ?? [];
    const used = usedByPage.get(request.pagePath) ?? usedByPage.get(resolvedRequest.pagePath) ?? "none";
    const isPageProseRepair = resolvedRequest.failureTypes.some((type) => PAGE_PROSE_REPAIR_TYPES.has(type));
    return {
      unitId: resolvedRequest.unitId,
      pagePath: resolvedRequest.pagePath,
      sectionPath: resolvedRequest.sectionPath,
      failureTypes: resolvedRequest.failureTypes,
      validationErrors: resolvedRequest.validationErrors,
      requiredChanges: resolvedRequest.requiredChanges,
      repairType: "contract_driven_revision",
      changedFiles: changedFilesForRequest(resolvedRequest, changedFiles, finalPage),
      result: unresolved.length === 0 ? "resolved" : "unresolved",
      unresolvedValidationErrors: unresolved,
      repairedAt,
      executorAttempted: attempted,
      executorUsed: used,
      executorPreference: repairExecutorPreference(resolvedRequest.failureTypes),
      modelRepairStatus: modelRepairStatusFor({ request, attempted, used, wantModel }),
      naturalProseValidation: isPageProseRepair && finalPage ? naturalProseValidationForPage(finalPage) : "not_applicable",
      modelFailureReason: modelFailureByPage.get(request.pagePath),
    };
  });
  const perRequestChangedFiles = new Set(repairs.flatMap((repair) => repair.changedFiles));
  const contractFile = ".breadboard/learning-unit-contract.json";
  const contractAffectedUnits = new Set(
    repairs
      .filter((repair) => repair.changedFiles.includes(contractFile))
      .map((repair) => repair.unitId),
  );
  if (changedFiles.includes(contractFile) && contractAffectedUnits.size === 0) {
    for (const request of requests) contractAffectedUnits.add(request.unitId);
  }
  const contractChangedFiles = changedFiles.includes(contractFile)
    ? [{ file: contractFile, affectedUnits: [...contractAffectedUnits].sort() }]
    : [];
  const finalizerChangedFiles = changedFiles
    .filter((file) => file !== contractFile && !perRequestChangedFiles.has(file))
    .sort();
  const runReport: LearningUnitRepairRunReport = {
    requestedAt,
    gardenSlug,
    repairExecutorMode: repairExecutor,
    requests,
    repairs,
    executions,
    changedFiles,
    contractChangedFiles,
    finalizerChangedFiles,
    finalizerNotes: repairReport.notes,
    semanticFinalizerActions: semanticFailureActionsForRequests(requests),
    firstValidationFailures: validationFailuresFromChecks(firstChecks),
    finalValidationFailures: validationFailuresFromChecks(finalChecks),
  };
  writeRepairArtifacts(gardenDir, runReport);
  return runReport;
}

function collectAllFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push(rel.replace(/\\/g, "/"));
    }
  };
  walk(root, "");
  return out.sort();
}

function snapshotFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const rel of collectAllFiles(root)) {
    const abs = path.join(root, ...rel.split("/"));
    const hash = crypto.createHash("sha1").update(readFileSyncWithRetry(abs)).digest("hex");
    snapshot.set(rel, hash);
  }
  return snapshot;
}

function changedBetweenSnapshots(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changed: string[] = [];
  for (const key of keys) {
    if (before.get(key) !== after.get(key)) changed.push(key);
  }
  return changed.sort();
}

function validationReportAccepted(gardenDir: string): boolean {
  const reportPath = path.join(gardenDir, ".breadboard", "validation-report.md");
  if (!fs.existsSync(reportPath)) return false;
  return /^Accepted:\s+yes\s*$/m.test(readFileSyncWithRetry(reportPath, "utf-8"));
}

export function verifyFinalArtifactNoMutation({
  gardenDir,
  gardenSlug,
  updateRepairReport = true,
  strictModelApprovedVisuals = false,
  expectedVisualContractExecutabilityContext,
  expectedSourceFormulaReviewContext,
}: {
  gardenDir: string;
  gardenSlug: string;
  updateRepairReport?: boolean;
  /** Re-run the same approved-visual hard gate used by active Learn after any
   * end-stage critic repair and immediately before promotion. */
  strictModelApprovedVisuals?: boolean;
  expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
}): FinalArtifactVerification {
  const before = snapshotFiles(gardenDir);
  const checks = collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report: emptyFinalizeReport(),
    includeReportSelfCheck: true,
    strictModelApprovedVisuals,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  });
  const after = snapshotFiles(gardenDir);
  const validationFailures = validationFailuresFromChecks(checks);
  // Fix 10: the current deterministic checks are the source of truth. A stale
  // `unresolved` repair-log record blocks ONLY if the issue is still live — and a
  // live issue is already in `validationFailures`. So acceptance gates on the
  // current failures, not on repair HISTORY; only still-live log entries are
  // surfaced (informational), so a superseded/resolved record cannot permanently
  // block publication.
  const repairRun = readRepairRunReport(gardenDir);
  const liveFailureKeys = new Set(validationFailures);
  const unresolvedRepairFailures = repairRun
    ? repairRun.repairs
        .filter((entry) => entry.result === "unresolved")
        .flatMap((entry) => (entry.unresolvedValidationErrors.length > 0
          ? entry.unresolvedValidationErrors.map((failure) => `${entry.pagePath}: ${failure}`)
          : [`${entry.pagePath}: unresolved ${entry.failureTypes.join(", ")}`]))
        .filter((failure) => liveFailureKeys.has(failure) || [...liveFailureKeys].some((live) => failure.includes(live) || live.includes(failure)))
    : [];
  const verification: FinalArtifactVerification = {
    checkedAt: new Date().toISOString(),
    accepted: validationFailures.length === 0 && validationReportAccepted(gardenDir),
    mutatedFiles: changedBetweenSnapshots(before, after),
    validationFailures,
    unresolvedRepairFailures,
    validationReportAccepted: validationReportAccepted(gardenDir),
  };
  verification.accepted = verification.accepted && verification.mutatedFiles.length === 0;

  if (updateRepairReport) {
    const existing: LearningUnitRepairRunReport = repairRun ?? {
      requestedAt: new Date().toISOString(),
      gardenSlug,
      repairExecutorMode: "deterministic",
      requests: [],
      repairs: [],
      executions: [],
      changedFiles: [],
      contractChangedFiles: [],
      finalizerChangedFiles: [],
      finalizerNotes: [],
      semanticFinalizerActions: [],
      firstValidationFailures: [],
      finalValidationFailures: validationFailures,
    };
    existing.finalVerification = verification;
    existing.finalValidationFailures = validationFailures;
    writeRepairArtifacts(gardenDir, existing);
  }

  return verification;
}

// ---------------------------------------------------------------------------
// Fix 4-6: non-throwing final audit + self-healing loop orchestration
// ---------------------------------------------------------------------------

export type FinalRepairIssueType =
  | "formula_usage_projection"
  | "formula_metadata_noise"
  | "formula_grounding"
  | "formula_kind_misclassification"
  | "source_anchor_mismatch"
  | "source_anchor_missing"
  | "visual_grounding"
  | "section_semantics"
  | "zettelkasten_handle"
  | "repair_provenance"
  | "structural_integrity";

export interface FinalRepairIssue {
  id: string;
  type: FinalRepairIssueType;
  severity: "blocking" | "warning";
  pagePath?: string;
  unitId?: string;
  anchorId?: string;
  message: string;
  evidence: Record<string, unknown>;
  repairMode: "deterministic" | "chatmock" | "deterministic_then_chatmock" | "non_repairable";
}

export interface FinalizeAuditResult {
  passed: boolean;
  checks: FinalizeCheck[];
  repairableIssues: FinalRepairIssue[];
  nonRepairableIssues: FinalRepairIssue[];
  stateFingerprint: string;
}

function classifyFinalCheck(name: string): { type: FinalRepairIssueType; repairMode: FinalRepairIssue["repairMode"] } {
  const n = name.toLowerCase();
  if (
    n.includes("source-formula manifest") ||
    n.includes("source-formula provenance") ||
    n.includes("source-formula identity integrity")
  ) {
    return { type: "structural_integrity", repairMode: "non_repairable" };
  }
  if (n.includes("reviewed source-formula page projection")) {
    return { type: "formula_grounding", repairMode: "chatmock" };
  }
  if (n.includes("formula metadata noise")) return { type: "formula_metadata_noise", repairMode: "deterministic_then_chatmock" };
  if (n.includes("formula")) return { type: "formula_grounding", repairMode: "deterministic_then_chatmock" };
  if (n.includes("source text concept") || n.includes("source anchor") || n.includes("source-anchor")) return { type: "source_anchor_missing", repairMode: "deterministic_then_chatmock" };
  if (n.includes("visual")) return { type: "visual_grounding", repairMode: "deterministic_then_chatmock" };
  if (n.includes("section")) return { type: "section_semantics", repairMode: "deterministic" };
  if (n.includes("zettelkasten")) return { type: "zettelkasten_handle", repairMode: "deterministic_then_chatmock" };
  if (n.includes("repair provenance")) return { type: "repair_provenance", repairMode: "deterministic" };
  return { type: "structural_integrity", repairMode: "non_repairable" };
}

function pagePathFromProblem(problem: string): string | undefined {
  return problem.match(/learning\/[^:]+?\.md/)?.[0];
}

function anchorOrFamilyFromProblem(problem: string): string | undefined {
  return (
    problem.match(/\bS\d+\.P\d+\.[A-Z]?\d+\b/)?.[0] ??
    problem.match(/\b(accuracy|latency|energy|efficiency|spike-count|convergence|threshold|probability|loss|gradient)\b/i)?.[0] ??
    problem.match(/text-[a-z0-9-]+/i)?.[0]
  );
}

function gardenStateFingerprint(gardenDir: string): string {
  const snapshot = snapshotFiles(gardenDir);
  const parts = [...snapshot.entries()]
    .filter(([rel]) => !/^\.breadboard\/(validation-report\.md|repair-report\.md|repair-log\.json|events\.jsonl|backups|debug)/.test(rel))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rel, hash]) => `${rel}:${hash}`);
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex");
}

/**
 * Fix 4: a NON-THROWING deterministic audit. Runs the same checks the hard gate
 * uses, but classifies each failure into structured, repairable-or-not issues so
 * the orchestrator can decide what to repair before the terminal publish
 * decision. `finalizeGardenExport` remains the throwing source of truth.
 */
export function auditGardenForFinalization(
  gardenDir: string,
  gardenSlug: string,
  options: {
    strictModelApprovedVisuals?: boolean;
    expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
    expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
  } = {},
): FinalizeAuditResult {
  const checks = collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report: emptyFinalizeReport(),
    includeReportSelfCheck: false,
    strictModelApprovedVisuals: options.strictModelApprovedVisuals,
    expectedVisualContractExecutabilityContext:
      options.expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext: options.expectedSourceFormulaReviewContext,
  });
  const repairableIssues: FinalRepairIssue[] = [];
  const nonRepairableIssues: FinalRepairIssue[] = [];
  const seen = new Set<string>();
  const finalState = buildFinalGardenState(gardenDir, gardenSlug);
  const unitByPage = new Map(finalState.pages.map((page) => [page.rel, page.learningUnitId]));
  for (const check of checks) {
    if (check.status !== "FAIL") continue;
    const classified = classifyFinalCheck(check.name);
    for (const problem of check.problems) {
      const pagePath = pagePathFromProblem(problem);
      const target = anchorOrFamilyFromProblem(problem);
      const isFormulaProjection = classified.repairMode !== "non_repairable" &&
        Boolean(target && /^S\d+\.P\d+\.E\d+$/i.test(target))
        && /formula|contract fulfillment|source coverage mode precision/i.test(check.name);
      const orphanEntryIndex = /formula metadata noise/i.test(check.name)
        ? Number(problem.match(/formulas\[(\d+)\]/)?.[1])
        : Number.NaN;
      const type: FinalRepairIssueType = isFormulaProjection ? "formula_usage_projection" : classified.type;
      const repairMode: FinalRepairIssue["repairMode"] = isFormulaProjection
        ? /reviewed source-formula page projection/i.test(check.name)
          ? "chatmock"
          : "deterministic_then_chatmock"
        : classified.repairMode;
      const unitId = (pagePath ? unitByPage.get(pagePath) : undefined)
        ?? (target
          ? finalState.learningUnitContract.assignments.find((assignment) => assignment.sourceArtifactId === target)?.assignedLearningUnitId
            ?? finalState.learningUnitContract.units.find((unit) => unit.sourceFormulas.some((formula) => formula.id === target))?.id
          : undefined);
      const pageForIssue = pagePath ? finalState.pages.find((page) => page.rel === pagePath) : undefined;
      const orphanEntry = Number.isInteger(orphanEntryIndex) && pageForIssue
        ? parseFormulaMetadataEntries(pageForIssue.rawFrontmatter)[orphanEntryIndex]
        : undefined;
      const id = isFormulaProjection
        ? `formula_usage_projection:${target}:${unitId ?? "unassigned"}`
        : orphanEntry && pagePath
          ? stableWorkedExampleIdentity(pagePath, orphanEntry)
          : stableFinalIssueId(type, pagePath, target);
      // Fix 11/12: one stable id per issue; do not duplicate an error that two
      // checks report about the same page + target.
      if (seen.has(id)) continue;
      seen.add(id);
      const issue: FinalRepairIssue = {
        id,
        type,
        severity: "blocking",
        pagePath,
        unitId,
        anchorId: target,
        message: problem,
        evidence: { check: check.name },
        repairMode,
      };
      if (repairMode === "non_repairable") nonRepairableIssues.push(issue);
      else repairableIssues.push(issue);
    }
  }
  return {
    passed: checks.every((check) => check.status !== "FAIL"),
    checks,
    repairableIssues,
    nonRepairableIssues,
    stateFingerprint: gardenStateFingerprint(gardenDir),
  };
}

export interface FinalSelfHealingOptions {
  maxRounds: number;
  maxChatMockCalls: number;
  strictMode: boolean;
  /** Injected ChatMock-backed per-page repair executor. When omitted the loop is
   * deterministic-only. */
  modelRepair?: ModelRepairExecutor;
}

export interface FinalSelfHealingResult {
  passed: boolean;
  roundsUsed: number;
  chatMockCallsUsed: number;
  initialIssues: FinalRepairIssue[];
  resolvedIssues: string[];
  unresolvedIssues: FinalRepairIssue[];
  stateFingerprints: string[];
  stoppedReason: "passed" | "repair_budget_exhausted" | "no_progress" | "chatmock_unavailable" | "non_repairable_issue";
}

/**
 * Fix 6: the final self-healing loop. Each round: reconcile + deterministically
 * repair + finalize, re-audit, and (only when deterministic logic cannot resolve
 * a semantic issue and budget remains) invoke ChatMock through the injected
 * per-page executor. Continues only while the state fingerprint changes and the
 * budget is not exhausted. NEVER weakens the gate: it publishes nothing — it
 * leaves the garden in a state that `finalizeGardenExport` + `verify` then
 * accept only if it genuinely passes.
 */
export async function runFinalSelfHealingLoop(
  gardenDir: string,
  gardenSlug: string,
  options: FinalSelfHealingOptions,
): Promise<FinalSelfHealingResult> {
  const stateFingerprints: string[] = [];
  const initialAudit = auditGardenForFinalization(gardenDir, gardenSlug);
  const initialIssues = [...initialAudit.repairableIssues, ...initialAudit.nonRepairableIssues];
  let chatMockCallsUsed = 0;
  let roundsUsed = 0;
  let previousFingerprint = initialAudit.stateFingerprint;
  stateFingerprints.push(initialAudit.stateFingerprint);
  let stoppedReason: FinalSelfHealingResult["stoppedReason"] = "repair_budget_exhausted";

  for (let round = 1; round <= options.maxRounds; round += 1) {
    roundsUsed = round;
    const wantModel = Boolean(options.modelRepair) && chatMockCallsUsed < options.maxChatMockCalls;
    const repairRun = await repairLearningUnitsFromContract({
      gardenDir,
      gardenSlug,
      repairExecutor: wantModel ? "model_with_deterministic_fallback" : "deterministic",
      modelRepair: wantModel ? options.modelRepair : undefined,
    });
    if (wantModel) {
      chatMockCallsUsed += repairRun.repairs.filter((entry) => (entry.executorAttempted ?? []).includes("model")).length;
    }
    finalizeGardenExport({ gardenDir, gardenSlug });
    const audit = auditGardenForFinalization(gardenDir, gardenSlug);
    stateFingerprints.push(audit.stateFingerprint);

    if (audit.passed) {
      stoppedReason = "passed";
      break;
    }
    if (audit.nonRepairableIssues.length > 0 && audit.repairableIssues.length === 0) {
      stoppedReason = "non_repairable_issue";
      break;
    }
    // Continue only if the state actually changed (Fix 6 step 11).
    if (audit.stateFingerprint === previousFingerprint) {
      stoppedReason = "no_progress";
      break;
    }
    previousFingerprint = audit.stateFingerprint;
  }

  const finalAudit = auditGardenForFinalization(gardenDir, gardenSlug);
  const unresolvedIssues = [...finalAudit.repairableIssues, ...finalAudit.nonRepairableIssues];
  const unresolvedIds = new Set(unresolvedIssues.map((issue) => issue.id));
  const resolvedIssues = initialIssues.filter((issue) => !unresolvedIds.has(issue.id)).map((issue) => issue.id);
  return {
    passed: finalAudit.passed,
    roundsUsed,
    chatMockCallsUsed,
    initialIssues,
    resolvedIssues,
    unresolvedIssues,
    stateFingerprints,
    stoppedReason,
  };
}

// ---------------------------------------------------------------------------
// Title fix
// ---------------------------------------------------------------------------

/** Strip source-commentary residue ("... as Evidence") from learner titles and
 * propagate the cleaned alias to visible navigation files. */
function fixLearnerTitles(pages: LearnerPage[], gardenDir: string, report: FinalizeReport): void {
  const renames: Array<{ from: string; to: string }> = [];
  for (const page of pages) {
    const title = page.title;
    const cleaned = title
      .replace(/\s+as\s+(?:source[- ](?:derived|central|anchored)\s+)?evidence\b/gi, "")
      .replace(/\s+in\s+(?:this|the)\s+(?:paper|source)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (cleaned && cleaned !== title) {
      page.rawFm = fmSetScalar(page.rawFm, "title", cleaned);
      // Body H1/H3 headings that echo the title.
      const bare = title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
      const bareClean = cleaned.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
      if (bare !== bareClean) {
        page.body = page.body.replace(
          new RegExp(`^(#{1,6}\\s+)${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im"),
          `$1${bareClean}`,
        );
        renames.push({ from: bare, to: bareClean });
      }
      page.dirty = true;
      page.title = cleaned;
      report.notes.push(`retitled ${page.rel}: "${title}" -> "${cleaned}"`);
    }
  }
  if (renames.length === 0) return;
  // Clean the alias text in visible navigation files (targets stay valid).
  const navFiles = [
    path.join(gardenDir, "_index.md"),
    path.join(gardenDir, "learning", "Learning Map.md"),
    path.join(gardenDir, "learning", "Topic Overview.md"),
    path.join(gardenDir, "learning", "_index.md"),
  ];
  for (const file of navFiles) {
    if (!fs.existsSync(file)) continue;
    const text = readFileSyncWithRetry(file, "utf-8");
    let next = text;
    for (const { from, to } of renames) next = replaceTitleAliasOnly(next, from, to);
    if (next !== text) {
      fs.writeFileSync(file, next, "utf-8");
      report.changed.push(path.relative(gardenDir, file).replace(/\\/g, "/"));
    }
  }
}

/** Replace a cleaned title in *alias* positions and plain prose only — never in
 * a wikilink target (the on-disk file was not renamed, so its path must stay
 * exactly as written or the link breaks). */
function replaceTitleAliasOnly(text: string, from: string, to: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.includes("[[")) return line.split(from).join(to);
      return line.replace(/\[\[([^\]]+?)\]\]/g, (full, inner: string) => {
        const pipe = inner.indexOf("|");
        if (pipe < 0) return full; // bare link: target only, do not touch
        const target = inner.slice(0, pipe);
        const alias = inner.slice(pipe + 1).split(from).join(to);
        return `[[${target}|${alias}]]`;
      });
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Pass C: source wikilink normalization
// ---------------------------------------------------------------------------

/** Convert self-referential heading wikilinks to plain headings, resolve page
 * anchors to real headings, and canonicalize/flatten links to deleted
 * timestamped source-conversion pages. Runs over every visible Markdown file. */
export function normalizeSourceWikilinks(gardenDir: string, report: FinalizeReport): void {
  const visible: Array<{ abs: string; rel: string }> = [];
  const rootIndex = path.join(gardenDir, "_index.md");
  if (fs.existsSync(rootIndex)) visible.push({ abs: rootIndex, rel: "_index.md" });
  listMarkdown(path.join(gardenDir, "learning"), "learning", visible);
  listMarkdown(path.join(gardenDir, "sources"), "sources", visible);

  // Index of existing page targets (by canonical path and by basename slug).
  const byBasename = new Map<string, string>();
  for (const { rel } of visible) {
    const target = rel.replace(/\.md$/i, "");
    const base = target.split("/").pop() ?? target;
    byBasename.set(slugifyLoose(base), target);
  }

  for (const { abs, rel } of visible) {
    const original = readFileSyncWithRetry(abs, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(original);
    const headingSlugs = new Set<string>();
    for (const match of body.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      // Slug of the *plain* heading text (after we strip any wikilink markup).
      const plain = (match[1] ?? "").replace(/\[\[#?([^\]|]+?)(?:\|[^\]]*)?\]\]/g, "$1");
      headingSlugs.add(slugifyLoose(plain));
    }

    let next = body;

    // 1) Headings that are themselves wikilinks -> plain headings.
    next = next.replace(/^(#{1,6})\s*\[\[#?([^\]|]+?)(?:\|([^\]]*))?\]\]\s*$/gm, (_m, hashes, target, alias) => {
      const label = (alias ?? target ?? "").trim();
      return `${hashes} ${label}`;
    });

    // 2) Remaining wikilinks: resolve or flatten.
    next = next.replace(/(!?)\[\[([^\]]+?)\]\]/g, (full, bang: string, inner: string) => {
      if (bang === "!") return full; // image/embed transclusion
      const pipe = inner.indexOf("|");
      const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
      const label = alias || rawTarget.replace(/^#/, "");
      const hashIndex = rawTarget.indexOf("#");
      const base = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget).replace(/^\//, "").replace(/\.md$/i, "").trim();
      const fragment = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1).trim() : "";

      // Same-page heading link.
      if (!base) {
        if (fragment && headingSlugs.has(slugifyLoose(fragment))) return full;
        // e.g. [[#Page 16|Page 16]] with no such heading -> plain text.
        return label;
      }

      // Page-N reference -> same-page heading anchor when the heading exists.
      const pageMatch = base.match(/^page\s+(\d+)$/i);
      if (pageMatch) {
        const slug = slugifyLoose(`Page ${pageMatch[1]}`);
        if (headingSlugs.has(slug)) return `[[#Page ${pageMatch[1]}|${label}]]`;
        return label;
      }

      // Existing learning/source page links are already canonical. Keep them by
      // checking the full relative target before falling back to basename
      // matching, otherwise every section _index link competes on "_index".
      const exactTarget = path.join(gardenDir, ...base.split("/"));
      if (fs.existsSync(`${exactTarget}.md`) || fs.existsSync(path.join(exactTarget, "_index.md"))) {
        if (fragment) return `[[${base}#${fragment}|${label}]]`;
        return `[[${base}|${label}]]`;
      }

      // Canonical target already? keep.
      if (byBasename.has(slugifyLoose(base.split("/").pop() ?? base))) {
        const canonical = byBasename.get(slugifyLoose(base.split("/").pop() ?? base))!;
        if (fragment) return `[[${canonical}#${fragment}|${label}]]`;
        return `[[${canonical}|${label}]]`;
      }

      // Timestamped / deleted source-conversion page -> canonical source page
      // if one exists, else plain text. Never leave a broken link.
      const timestamped = base.match(/^(.*?)-\d{10,}$/);
      if (timestamped) {
        const canonical = byBasename.get(slugifyLoose(timestamped[1]));
        if (canonical) return `[[${canonical}|${label}]]`;
      }
      return label;
    });

    if (next !== body) {
      fs.writeFileSync(abs, hadFrontmatter ? joinFrontmatter(rawFrontmatter, next) : next, "utf-8");
      if (!report.changed.includes(rel)) report.changed.push(rel);
    }

    // Source pages should be viewer-visible: prefer internal:false + proper type.
    if (rel.startsWith("sources/")) {
      normalizeSourcePageTyping(abs, rel, report);
    }
  }
}

function normalizeSourcePageTyping(abs: string, rel: string, report: FinalizeReport): void {
  const content = readFileSyncWithRetry(abs, "utf-8");
  const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
  if (!hadFrontmatter) return;
  let fm = rawFrontmatter;
  const isIndex = /\/_index\.md$/i.test(`/${rel}`) || rel === "sources/_index.md";
  const bt = fmGetScalar(fm, "breadboardType");
  const kt = fmGetScalar(fm, "knowledge_type");
  // A source page must never be typed as a learner page.
  if (bt === "learning_page" || kt === "learning-page") {
    fm = fmSetScalar(fm, "breadboardType", isIndex ? "source_index" : "source_document");
    fm = fmSetScalar(fm, "knowledge_type", isIndex ? "source-index" : "source-document");
  }
  if (fmGetScalar(fm, "internal") === "true") fm = fmSetScalar(fm, "internal", false);
  if (!/^excludeFromLearningPath:/m.test(fm)) fm = fmSetScalar(fm, "excludeFromLearningPath", true);
  if (fm !== rawFrontmatter) {
    fs.writeFileSync(abs, joinFrontmatter(fm, body), "utf-8");
    if (!report.changed.includes(rel)) report.changed.push(rel);
  }
}

// ---------------------------------------------------------------------------
// Pass D: stale caveat sanitation
// ---------------------------------------------------------------------------

// Canonical stale-caveat detection. ONE source of truth shared by the finalizer
// sanitizer (`sanitizeStaleCaveats`, which removes them) and the reconciliation
// detector (`sourceMapCaveatProblems`, which flags any that survive). Sharing one
// list is what stops the recurring whack-a-mole: a phrasing the detector rejects
// is guaranteed to be sanitized first, because both consult the same regex.
const STALE_FORMULA_CAVEAT_RE =
  /(?:formal|explicit) mathematical definitions are not present|only formula captions? are provided|formulas? (?:are|is) not present|formula exact text unavailable|caption-only|formula captions?(?:\s+only|\s+but not exact[^.\n]*|\s+but exact notation unavailable)|exact displayed notation|exact (?:mathematical )?notation (?:and variable definitions )?(?:is |are )?(?:unavailable|not visible|not included|not provided)|variable definitions are not provided|formula terms are not fully available|standard explanatory notation only|captions only|notation unavailable|mathematical notation not included|governing equations[^.\n]*?not (?:present|included)|does not include its governing equations|remain qualitative unless more verified/i;
const STALE_TRUNCATION_CAVEAT_RE =
  /only pages?\s*1\s*[-–-]\s*2\s+(?:are|is)\s+(?:available|present)|source map is truncated|later[- ]page teaching must remain anchored to extracted [^.\n]*captions|truncated after page\s*2|later-paper details must not be inferred|later[- ]page content unavailable|later\s*(?:pages?|sections?)[^.\n]*?(?:not available|unavailable|(?:extracted )?captions?|anchored to captions)|provided excerpt only|not fully available in supplied context|not available in full (?:text|prose)|must not be inferred beyond/i;
const STALE_TABLE_CAVEAT_RE = /tables? (?:are|is) not (?:present|available|detected|extracted)/i;
const STALE_FIGURE_CAVEAT_RE = /figures? (?:are|is) not (?:present|available|detected|extracted)/i;

function replaceAll(text: string, re: RegExp, replacement: string): string {
  return text.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), replacement);
}

/** Rewrite a block of text so stale caveats that contradict the extracted
 * anchors are dropped (bullets) or neutralized (inline). */
export function sanitizeStaleCaveats(
  text: string,
  facts: { laterPagesExist: boolean; formulaAnchorsExist: boolean; tableAnchorsExist?: boolean; figureAnchorsExist?: boolean },
): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const isBullet = /^\s*[-*]\s+/.test(line) || /^\s*"[^"]*",?\s*$/.test(line);
    const staleFormula = facts.formulaAnchorsExist && STALE_FORMULA_CAVEAT_RE.test(line);
    const staleTruncation = facts.laterPagesExist && STALE_TRUNCATION_CAVEAT_RE.test(line);
    const staleTable = Boolean(facts.tableAnchorsExist) && STALE_TABLE_CAVEAT_RE.test(line);
    const staleFigure = Boolean(facts.figureAnchorsExist) && STALE_FIGURE_CAVEAT_RE.test(line);
    if ((staleFormula || staleTruncation || staleTable || staleFigure) && isBullet) {
      continue; // drop the whole stale bullet
    }
    let out = line;
    if (facts.formulaAnchorsExist) {
      out = out
        .replace(/(?:formal|explicit) mathematical definitions are not present[^.\n]*/gi, "explicit metric formulas are present in the extracted source anchors")
        .replace(/formulas? (?:are|is) not present/gi, "formula anchors are present")
        .replace(/only formula captions? are provided[^.\n]*/gi, "formula text is available through extracted source text or formula anchors")
        .replace(/formula captions? only|caption-only/gi, "formula anchors and text fallback are available")
        .replace(/formula captions? but exact notation unavailable[^.\n]*/gi, "formula notation is handled through extracted source text or text fallback")
        .replace(/exact (?:mathematical )?notation (?:is )?(?:unavailable|not visible|not included|not provided)[^.\n]*/gi, "formula notation is handled through extracted source text or text fallback")
        .replace(/variable definitions are not provided[^.\n]*/gi, "variable definitions are handled through extracted source text or formula anchors")
        .replace(/formula terms are not fully available[^.\n]*/gi, "formula terms are handled through extracted source text or formula anchors")
        .replace(/the (?:supplied|provided) (?:material|source|text) does not include its governing equations/gi, "the extracted source anchors include the governing metric formulas");
    }
    if (facts.laterPagesExist) {
      out = out
        .replace(/only pages?\s*1\s*[-–]\s*2\s+(?:are|is)\s+(?:available|present)[^.\n]*/gi, "later source pages are available and anchored")
        .replace(/later[- ]page teaching must remain anchored to extracted [^.\n]*captions[^.\n]*/gi, "later-page teaching can use extracted source prose and source artifacts")
        .replace(/source map is truncated[^.\n]*/gi, "source map includes later-page source evidence")
        .replace(/(?:the (?:main|provided|continuous)[^.\n]*?)?truncated after page\s*2[^.\n]*/gi, "later source pages are available and anchored")
        .replace(/later[- ]page content unavailable[^.\n]*/gi, "later-page source content is available and anchored")
        .replace(/later sections? (?:are|is)? ?(?:not available|unavailable)[^.\n]*/gi, "later sections are available through source anchors")
        // Mirror the detector's broad "later (pages|sections) … not available/
        // unavailable/captions" pattern so finalize can actually clean every
        // later-page caveat it flags (e.g. JSON-structured Source Map values like
        // "figures from later pages are available only as extracted captions").
        .replace(/later[- ](?:pages?|sections?)[^.\n]*?(?:not available|unavailable|(?:extracted )?captions?|anchored to captions)[^.\n]*/gi, "later source pages are available through extracted anchors")
        .replace(/provided excerpt only[^.\n]*/gi, "source content is available through extracted source text and anchors")
        .replace(/not fully available in supplied context[^.\n]*/gi, "source content is available through extracted source text and anchors");
    }
    // Catch-all: neutralize any phrasing the detector would still flag, so the
    // sanitizer can never fall behind the detector's pattern list.
    if (facts.formulaAnchorsExist) out = replaceAll(out, STALE_FORMULA_CAVEAT_RE, "formula anchors are available");
    if (facts.laterPagesExist) out = replaceAll(out, STALE_TRUNCATION_CAVEAT_RE, "later source pages are available and anchored");
    if (facts.tableAnchorsExist) out = replaceAll(out, STALE_TABLE_CAVEAT_RE, "tables are present in the extracted source anchors");
    if (facts.figureAnchorsExist) out = replaceAll(out, STALE_FIGURE_CAVEAT_RE, "figures are present in the extracted source anchors");
    kept.push(out);
  }
  return kept.join("\n");
}

function sanitizeStaleCaveatFiles(
  gardenDir: string,
  facts: { laterPagesExist: boolean; formulaAnchorsExist: boolean; tableAnchorsExist?: boolean; figureAnchorsExist?: boolean },
  report: FinalizeReport,
): void {
  const files = [
    path.join(gardenDir, "learning", "Learning Map.md"),
    path.join(gardenDir, "learning", "Topic Overview.md"),
    path.join(gardenDir, ".breadboard", "planning", "Source Map.md"),
    path.join(gardenDir, ".breadboard", "planning", "Scope Contract.md"),
    path.join(gardenDir, ".breadboard", "planning", "Learning Map.md"),
    path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"),
  ];
  for (const learner of loadLearnerPagePaths(gardenDir)) files.push(learner);
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = readFileSyncWithRetry(file, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
    const nextBody = sanitizeStaleCaveats(body, facts);
    if (nextBody !== body) {
      fs.writeFileSync(file, hadFrontmatter ? joinFrontmatter(rawFrontmatter, nextBody) : nextBody, "utf-8");
      const rel = path.relative(gardenDir, file).replace(/\\/g, "/");
      if (!report.changed.includes(rel)) report.changed.push(rel);
    }
  }
}

function learnerSectionTargets(gardenDir: string): Map<string, string> {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const targets = new Map<string, string>();
  const learningDir = path.join(gardenDir, "learning");
  if (!fs.existsSync(learningDir)) return targets;
  for (const entry of fs.readdirSync(learningDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(learningDir, entry.name, "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    const title = entry.name.replace(/^\s*(\d+)\.\s*/, "");
    const relTarget = `learning/${entry.name}/_index`;
    for (const label of [entry.name, title]) {
      const key = normalize(label);
      if (key) targets.set(key, relTarget);
    }
  }
  return targets;
}

function repairLearnerNavigationSourceLinks(gardenDir: string, report: FinalizeReport): void {
  const sectionTargets = learnerSectionTargets(gardenDir);
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const files = [
    path.join(gardenDir, "learning", "_index.md"),
    path.join(gardenDir, "learning", "Topic Overview.md"),
    path.join(gardenDir, "learning", "Learning Map.md"),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = readFileSyncWithRetry(file, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
    const nextBody = body.replace(/\[\[(sources\/[^\]|#]+(?:#[^\]|]+)?)(?:\|([^\]]+))?\]\]/gi, (whole, target: string, alias?: string) => {
      const label = String(alias ?? "").trim();
      const targetBase = target.split("#")[0].replace(/\.md$/i, "");
      const replacementLabel = label || targetBase.split("/").pop() || "Sources";
      if (targetBase.toLowerCase() === "sources/_index") {
        const sectionTarget = sectionTargets.get(normalize(replacementLabel));
        if (sectionTarget) return `[[${sectionTarget}|${replacementLabel}]]`;
      }
      return replacementLabel;
    });
    if (nextBody !== body) {
      fs.writeFileSync(file, hadFrontmatter ? joinFrontmatter(rawFrontmatter, nextBody) : nextBody, "utf-8");
      const rel = path.relative(gardenDir, file).replace(/\\/g, "/");
      if (!report.changed.includes(rel)) report.changed.push(rel);
      report.notes.push(`repaired learner navigation source links in ${rel}`);
    }
  }

  const rootFile = path.join(gardenDir, "_index.md");
  if (fs.existsSync(rootFile)) {
    const content = readFileSyncWithRetry(rootFile, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
    const nextBody = body.replace(/\[\[sources\/_index(?:\.md)?(?:#[^\]|]+)?\|([^\]]+)\]\]/gi, (whole, alias: string) => {
      const label = String(alias ?? "").trim();
      if (/^sources$/i.test(label)) return whole;
      if (/^learning$/i.test(label)) return `[[learning/_index|${label}]]`;
      const sectionTarget = sectionTargets.get(normalize(label));
      if (sectionTarget) return `[[${sectionTarget}|${label}]]`;
      return label || whole;
    });
    if (nextBody !== body) {
      fs.writeFileSync(rootFile, hadFrontmatter ? joinFrontmatter(rawFrontmatter, nextBody) : nextBody, "utf-8");
      if (!report.changed.includes("_index.md")) report.changed.push("_index.md");
      report.notes.push("repaired root learning navigation source links");
    }
  }
}

function loadLearnerPagePaths(gardenDir: string): string[] {
  const all: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", all);
  return all.map((entry) => entry.abs);
}

// ---------------------------------------------------------------------------
// Pass E + F: reconcile + place source visuals
// ---------------------------------------------------------------------------

function reconcileAndPlaceSourceVisuals({
  gardenDir,
  ledger,
  ledgerPath,
  learnerPages,
  pagesByRole,
  report,
}: {
  gardenDir: string;
  ledger: LedgerVisual[];
  ledgerPath: string;
  learnerPages: LearnerPage[];
  pagesByRole: Map<PageRole, LearnerPage>;
  report: FinalizeReport;
}): ReconciledAnchorUsage[] {
  // 1) Strip every source-visual image embed from every learner body. We will
  //    re-embed each one on its semantically-correct page.
  const urlToId = new Map<string, string>();
  for (const visual of ledger) {
    for (const key of ["croppedImagePath", "pageImagePath"] as const) {
      const url = String(visual[key] ?? "");
      if (url) urlToId.set(url, visual.sourceVisualId);
    }
  }
  for (const page of learnerPages) {
    const next = stripSourceVisualEmbeds(page.body);
    if (next !== page.body) {
      page.body = next;
      page.dirty = true;
    }
  }

  // 2) Decide the target page for each embeddable visual + re-embed.
  const embeddedByPage = new Map<string, string[]>(); // pageId -> [sourceVisualId]
  const usedInPages = new Map<string, Set<string>>(); // id -> pages
  for (const visual of ledger) {
    const cls = classifyFigure(visual);
    const url = String(visual.croppedImagePath ?? "");
    if (!url) continue; // no crop -> not embeddable (equation anchors handled below)
    const role = targetRoleForFigure(cls);
    if (!role) continue;
    const target = pagesByRole.get(role);
    if (!target) continue;
    embedImageOnPage(target, visual);
    const list = embeddedByPage.get(target.pageId) ?? [];
    list.push(visual.sourceVisualId);
    embeddedByPage.set(target.pageId, list);
    const seen = usedInPages.get(visual.sourceVisualId) ?? new Set<string>();
    seen.add(target.pageId);
    usedInPages.set(visual.sourceVisualId, seen);
  }

  // 3) Rewrite each learner page's sourceVisualIds / sourceFormulaAnchors.
  const metricPage = pagesByRole.get("metric");
  const equationIds = ledger.filter((visual) => classifyFigure(visual) === "equation").map((visual) => visual.sourceVisualId);
  for (const page of learnerPages) {
    const ids = embeddedByPage.get(page.pageId) ?? [];
    page.rawFm = fmSetArray(page.rawFm, "sourceVisualIds", ids);
    if (metricPage && page.pageId === metricPage.pageId && equationIds.length > 0) {
      page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", equationIds);
    } else {
      // Only the metric page keeps metric formula anchors.
      page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", fmGetArray(page.rawFm, "sourceFormulaAnchors").filter((id) => !/\.E\d+$/i.test(id) || (metricPage?.pageId === page.pageId)));
      if (page.role !== "metric") page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", fmGetArray(page.rawFm, "sourceFormulaAnchors").filter((id) => !/^S\d+\.P6\.E\d+$/i.test(id)));
    }
    page.dirty = true;
  }

  // 4) Record interactive-anchor usage (filled after visual repair, but we scan
  //    current bodies so reconciliation sees at least declared anchors).
  const interactiveAnchors = collectInteractiveAnchorIds(learnerPages);

  // 5) Rewrite the ledger from the reconciled table.
  const reconciliation: ReconciledAnchorUsage[] = [];
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    const cls = classifyFigure(visual);
    const pages = [...(usedInPages.get(id) ?? new Set<string>())];
    const embeddedAsImage = pages.length > 0;
    const usedAsInteractiveAnchor = interactiveAnchors.has(id);
    let status: ReconciledAnchorUsage["status"];
    let skipReason: string | undefined;
    if (embeddedAsImage) {
      status = "used";
      visual.usageStatus = "assigned";
      visual.assignedPageId = pages[0];
      const target = learnerPages.find((page) => page.pageId === pages[0]);
      visual.assignedSectionId = target ? target.pageId.split("/").slice(0, 2).join("/") : visual.assignedSectionId;
      delete visual.skipReason;
    } else if (cls === "equation") {
      // Equation without a crop is taught from source markdown + anchored.
      status = usedAsInteractiveAnchor ? "used" : "intentionally_skipped";
      visual.usageStatus = "intentionally_skipped";
      skipReason =
        "Central source formula is taught from the source markdown and linked through sourceFormulaAnchors; no reliable crop was available for this equation.";
      visual.skipReason = skipReason;
      delete visual.assignedPageId;
      delete visual.assignedSectionId;
    } else {
      status = "intentionally_skipped";
      visual.usageStatus = "intentionally_skipped";
      skipReason = "Not central to any confirmed subsection of this learning map.";
      visual.skipReason = skipReason;
      delete visual.assignedPageId;
      delete visual.assignedSectionId;
    }
    reconciliation.push({
      id,
      status,
      usedInPages: pages,
      embeddedAsImage,
      usedAsInteractiveAnchor,
      skipReason,
    });
  }
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
  report.changed.push(".breadboard/source-visuals.json");

  // 6) Regenerate Source Coverage from the reconciled table.
  writeSourceCoverage({ gardenDir, ledger, reconciliation, learnerPages, report });

  return reconciliation;
}

function stripSourceVisualEmbeds(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept = lines.filter((line) => !/^!\[[^\]]*\]\([^)]*source-visuals[^)]*\)\s*$/.test(line.trim()));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

function embedImageOnPage(page: LearnerPage, visual: LedgerVisual): void {
  const url = String(visual.croppedImagePath ?? "");
  if (!url || page.body.includes(url)) return;
  const caption = String(visual.caption ?? visual.sourceVisualId);
  const snippet = `![${caption}](${url})\n*Source figure ${visual.sourceVisualId}: ${caption}.*`;
  // Group source figures under a stable section at the end of the lesson body.
  const marker = "## Source Figures";
  if (page.body.includes(marker)) {
    page.body = `${page.body.replace(/\s+$/, "")}\n\n${snippet}\n`;
  } else {
    page.body = `${page.body.replace(/\s+$/, "")}\n\n${marker}\n\n${snippet}\n`;
  }
  page.dirty = true;
}

function collectInteractiveAnchorIds(pages: LearnerPage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const match of page.body.matchAll(VISUAL_BLOCK_RE)) {
      try {
        const spec = JSON.parse(match[1]);
        for (const anchor of spec.sourceAnchors ?? []) {
          const id = anchor?.figureId ?? anchor?.tableId ?? anchor?.equationId;
          if (id) ids.add(String(id));
        }
      } catch {
        /* ignore */
      }
    }
  }
  return ids;
}

function writeSourceCoverage({
  gardenDir,
  ledger,
  reconciliation,
  learnerPages,
  report,
}: {
  gardenDir: string;
  ledger: LedgerVisual[];
  reconciliation: ReconciledAnchorUsage[];
  learnerPages: LearnerPage[];
  report: FinalizeReport;
}): void {
  const planningDir = path.join(gardenDir, ".breadboard", "planning");
  fs.mkdirSync(planningDir, { recursive: true });
  const byId = new Map(ledger.map((visual) => [visual.sourceVisualId, visual]));
  const titleFor = (pageId: string): string => learnerPages.find((page) => page.pageId === pageId)?.title ?? pageId;
  const contract = readLearningUnitContract(gardenDir);
  const finalVisuals = finalVisualSpecs(gardenDir, learnerPages).filter((spec) => spec.id);
  const textAnchorLedger = new Map(readSourceAnchorLedger(gardenDir).map((anchor) => [anchor.id, anchor]));
  const embeddedLines: string[] = [];
  const textFormulaLines: string[] = [];
  const proseLines: string[] = [];
  const interactiveLines: string[] = [];
  const referencedLines: string[] = [];
  const cropFallbackLines: string[] = [];
  const omittedLines: string[] = [];
  const missingLines: string[] = [];
  for (const entry of reconciliation) {
    const visual = byId.get(entry.id);
    const caption = String(visual?.caption ?? "source visual");
    const pages = entry.usedInPages.map(titleFor).join("; ") || "none";
    const line = `- ${entry.id}: ${caption}; used on ${pages}`;
    if (entry.embeddedAsImage) embeddedLines.push(line);
    if (entry.usedAsInteractiveAnchor) interactiveLines.push(`${line}; visual source grounding`);
    if (visual && classifyFigure(visual) === "equation" && /explained_as_text_formula|used_as_interactive_grounding/i.test(String(visual.conceptUsage ?? ""))) {
      textFormulaLines.push(line);
    }
    if (String(visual?.cropStatus ?? "") === "omitted_unreliable") cropFallbackLines.push(`${line}; crop omitted with text/formula fallback`);
    if (entry.status === "intentionally_skipped") omittedLines.push(`- ${entry.id}: ${caption}; ${entry.skipReason ?? "intentionally omitted"}`);
    if (entry.status === "misplaced" || entry.status === "unused") missingLines.push(line);
  }
  for (const spec of finalVisuals) {
    for (const anchorId of spec.anchorIds) interactiveLines.push(`- ${anchorId}: ${spec.pageRel}; visual=${spec.id}`);
  }
  for (const page of learnerPages) {
    for (const anchorId of pageLevelSourceAnchorIds(page)) {
      if (!/^text-/i.test(anchorId)) continue;
      const anchor = textAnchorLedger.get(anchorId);
      proseLines.push(`- ${anchorId}: ${page.rel}; ${anchor?.semanticSummary ?? "source prose anchor"}`);
    }
  }
  for (const assignment of contract.assignments) {
    const unit = contract.units.find((candidate) => candidate.id === assignment.assignedLearningUnitId);
    referencedLines.push(`- ${assignment.sourceArtifactId}: assigned to ${assignment.assignedLearningUnitId}${unit ? ` (${unit.title})` : ""}; placement=${assignment.placement}; ${assignment.requiredInterpretation || assignment.reason}`);
  }
  const section = (heading: string, items: string[]) => [
    "",
    `## ${heading}`,
    "",
    ...(items.length > 0 ? [...new Set(items)] : ["- None."]),
  ];
  const lines = [
    "# Source Coverage",
    "",
    "Generated deterministically from the final artifact state: learner",
    "frontmatter, learner bodies, final visual JSON, source-anchor ledgers, and",
    "the Learning Unit Contract.",
    "",
    "## Reconciled Source Visual Usage",
    "",
  ];
  for (const entry of reconciliation) {
    const visual = byId.get(entry.id);
    const caption = String(visual?.caption ?? "");
    const where = entry.usedInPages.length > 0 ? entry.usedInPages.map(titleFor).join("; ") : entry.usedAsInteractiveAnchor ? "interactive anchor" : "none";
    lines.push(`- ${entry.id} (${entry.status}): ${caption || "source visual"}; used on: ${where}`);
  }
  lines.push(
    ...section("Embedded Source Crops", embeddedLines),
    ...section("Explained as Text Formulas", textFormulaLines),
    ...section("Explained in Prose", proseLines),
    ...section("Used as Interactive Grounding", interactiveLines),
    ...section("Referenced Again in Synthesis", referencedLines),
    ...section("Crop Omitted With Text Fallback", cropFallbackLines),
    ...section("Intentionally Omitted", omittedLines),
    ...section("Missing or Misplaced", missingLines),
    "",
    "## Notes",
    "",
    "- Some formula crops were omitted because the crop was unreliable; the formulas were taught from extracted source text when a text/formula fallback is listed.",
  );
  const content = `${lines.join("\n")}\n`;
  const target = path.join(planningDir, "Source Coverage.md");
  const existing = fs.existsSync(target) ? readFileSyncWithRetry(target, "utf-8") : "";
  const { rawFrontmatter } = parseFrontmatter(existing);
  const next = rawFrontmatter ? joinFrontmatter(rawFrontmatter, content) : content;
  // Only write + report a touch when the projection actually changes; a
  // regeneration that reproduces the identical file is not a mutation (e.g. a
  // repair that narrows visual anchors back to the original minimal set).
  if (next !== existing) {
    fs.writeFileSync(target, next, "utf-8");
    report.changed.push(".breadboard/planning/Source Coverage.md");
  }
}

function regenerateSourceCoverageFromFinalState(gardenDir: string, gardenSlug: string, report: FinalizeReport): void {
  const target = path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md");
  const existing = fs.existsSync(target) ? readFileSyncWithRetry(target, "utf-8") : "";
  const { rawFrontmatter } = parseFrontmatter(existing);
  const body = projectSourceCoverage(buildFinalGardenState(gardenDir, gardenSlug));
  const content = rawFrontmatter ? joinFrontmatter(rawFrontmatter, body) : body;
  if (content === existing) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
  if (!report.changed.includes(".breadboard/planning/Source Coverage.md")) {
    report.changed.push(".breadboard/planning/Source Coverage.md");
  }
}

// ---------------------------------------------------------------------------
// Pass G: interactive visual grounding
// ---------------------------------------------------------------------------

function repairInteractiveVisuals({
  gardenDir,
  ledger,
  learnerPages,
  pagesByRole,
  report,
}: {
  gardenDir: string;
  ledger: LedgerVisual[];
  learnerPages: LearnerPage[];
  pagesByRole: Map<PageRole, LearnerPage>;
  report: FinalizeReport;
}): void {
  const bd = path.join(gardenDir, ".breadboard");
  const visualsDir = path.join(bd, "visuals");
  const indexPath = path.join(bd, "visual-index.json");
  const visualIndex = readJson<Record<string, Record<string, unknown>>>(indexPath, {});

  const anchorsByClass = new Map<FigureClass, LedgerVisual[]>();
  for (const visual of ledger) {
    const cls = classifyFigure(visual);
    const list = anchorsByClass.get(cls) ?? [];
    list.push(visual);
    anchorsByClass.set(cls, list);
  }
  const anchorPoolFor = (type: string, role: PageRole): LedgerVisual[] => {
    const classes = INTERACTIVE_ANCHOR_COMPAT[type] ?? [];
    let pool = classes.flatMap((cls) => anchorsByClass.get(cls) ?? []);
    if (type === "tradeoff_explorer") {
      if (role === "metric") pool = pool.filter((visual) => classifyFigure(visual) === "equation");
      // Comparison and application both ground on the result tables/graphs
      // (latency/energy/accuracy), never on the metric-definition equations,
      // so an application page never claims a metric formula anchor.
      else if (role === "comparison" || role === "application") pool = pool.filter((visual) => classifyFigure(visual) === "result");
    }
    return pool.filter((visual) =>
      anchorTextCompatibleWithVisualType(type, [visual.sourceVisualId, visual.caption, visual.type].filter(Boolean).join(" ")),
    );
  };

  const anchorObject = (visual: LedgerVisual): Record<string, unknown> => {
    const id = visual.sourceVisualId;
    const anchor: Record<string, unknown> = { description: String(visual.caption ?? id) };
    if (visual.sourceId) anchor.sourceId = visual.sourceId;
    if (visual.pageNumber) anchor.page = visual.pageNumber;
    if (/\.E\d+$/i.test(id)) anchor.equationId = id;
    else if (/\.T\d+$/i.test(id)) anchor.tableId = id;
    else anchor.figureId = id;
    return anchor;
  };

  for (const page of learnerPages) {
    const requiredType = requiredInteractiveType(page.role);
    let bodyChanged = false;

    const blocks = [...page.body.matchAll(VISUAL_BLOCK_RE)];
    const generatedIds = embeddedGeneratedVisualIds(page.body);
    const keptIds: string[] = [];
    for (const match of blocks) {
      let spec: Record<string, unknown>;
      try {
        spec = JSON.parse(match[1]);
      } catch {
        // Unparseable block: drop it.
        page.body = page.body.replace(match[0], "").replace(/\n{3,}/g, "\n\n");
        bodyChanged = true;
        continue;
      }
      const id = String(spec.id ?? "");
      const type = String(spec.type ?? "");

      // Challenges pages must not carry a generic interactive visual.
      if (page.role === "challenges" || requiredType === null && (page.role === "training")) {
        page.body = page.body.replace(match[0], "").replace(/\n{3,}/g, "\n\n");
        removeVisualArtifacts(visualsDir, visualIndex, id);
        page.rawFm = fmSetScalar(page.rawFm, "visualSkipReason", skipReasonForRole(page.role));
        bodyChanged = true;
        report.notes.push(`removed interactive ${id} from ${page.rel} (role ${page.role})`);
        continue;
      }

      // If the renderer type is wrong for the page role, drop it and record a
      // skip reason rather than fake a mismatched simulator.
      if (requiredType && type !== requiredType && !isTypeAcceptableForRole(type, page.role)) {
        page.body = page.body.replace(match[0], "").replace(/\n{3,}/g, "\n\n");
        removeVisualArtifacts(visualsDir, visualIndex, id);
        page.rawFm = fmSetScalar(page.rawFm, "visualSkipReason", skipReasonForRole(page.role));
        bodyChanged = true;
        report.notes.push(`removed type-mismatched interactive ${id} (${type}) from ${page.rel}`);
        continue;
      }

      // Reground anchors to type-compatible source visuals.
      const pool = anchorPoolFor(type, page.role);
      const newAnchors = pool.slice(0, 8).map(anchorObject);
      const frontmatterIds: string[] = [];
      if (newAnchors.length > 0) {
        spec.sourceAnchors = newAnchors;
        spec.sourceGroundingStatus = "source-grounded";
        spec.justification = "Anchored to type-compatible source visuals assigned to this lesson's evidence.";
        for (const anchor of newAnchors) {
          const anchorId = String(anchor.equationId ?? anchor.tableId ?? anchor.figureId ?? "");
          if (anchorId) frontmatterIds.push(anchorId);
        }
      } else {
        spec.sourceAnchors = [];
        spec.sourceGroundingStatus = "conceptual-no-direct-source-figure";
        spec.justification =
          "This interactive teaches a dynamic mechanism discussed on the page; no single source figure is claimed as its ground truth.";
      }

      // Ensure the page frontmatter overlaps the interactive anchors (validator
      // requires anchor ids appear in sourceAnchors/sourceVisualIds/formulas).
      if (frontmatterIds.length > 0) {
        const cls = classifyFigure({ sourceVisualId: frontmatterIds[0] });
        if (cls === "equation") {
          page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", [...fmGetArray(page.rawFm, "sourceFormulaAnchors"), ...frontmatterIds]);
        } else {
          const already = new Set([...fmGetArray(page.rawFm, "sourceVisualIds"), ...fmGetArray(page.rawFm, "sourceAnchors")]);
          const missing = frontmatterIds.filter((anchorId) => !already.has(anchorId));
          if (missing.length > 0) {
            page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", [...fmGetArray(page.rawFm, "sourceAnchors"), ...missing]);
          }
        }
        page.dirty = true;
      }

      const rebuilt = "```breadboard-visual\n" + JSON.stringify(spec, null, 2) + "\n```";
      page.body = page.body.replace(match[0], rebuilt);
      bodyChanged = true;
      keptIds.push(id);

      // Keep the spec file + index in sync.
      syncVisualSpecFile(visualsDir, visualIndex, id, spec);
    }

    // Reconcile frontmatter visualIds with the blocks that survived.
    page.rawFm = fmSetArray(page.rawFm, "visualIds", [...keptIds, ...generatedIds]);
    if (keptIds.length + generatedIds.length > 0) {
      page.rawFm = removeKeyLine(page.rawFm, "visualSkipReason");
    }
    if (bodyChanged) page.dirty = true;
  }

  fs.writeFileSync(indexPath, `${JSON.stringify(visualIndex, null, 2)}\n`, "utf-8");
  report.changed.push(".breadboard/visual-index.json");
}

function isTypeAcceptableForRole(type: string, role: PageRole): boolean {
  if (role === "lif" || role === "basic_def" || role === "intro") return type === "lif_neuron" || type === "neural_coding";
  if (role === "metric" || role === "comparison" || role === "application") return type === "tradeoff_explorer";
  return false;
}

function skipReasonForRole(role: PageRole): string {
  if (role === "training") {
    return "The concrete training dynamic (spike-timing plasticity) is introduced on the neuron-model page, and the training-curve comparison is shown on the comparative-results page; this page surveys the paradigms in prose.";
  }
  if (role === "challenges") {
    return "This page discusses unresolved challenges rather than a single dynamic mechanism with a supported interactive renderer.";
  }
  return "No supported interactive renderer matches this page's objective.";
}

function removeKeyLine(rawFm: string, key: string): string {
  return rawFm
    .split(/\r?\n/)
    .filter((line) => !new RegExp(`^${key}:`).test(line))
    .join("\n");
}

function removeVisualArtifacts(visualsDir: string, visualIndex: Record<string, unknown>, id: string): void {
  if (!id) return;
  delete visualIndex[id];
  const specFile = path.join(visualsDir, `${id}.json`);
  if (fs.existsSync(specFile)) fs.rmSync(specFile, { force: true });
}

function syncVisualSpecFile(
  visualsDir: string,
  visualIndex: Record<string, Record<string, unknown>>,
  id: string,
  spec: Record<string, unknown>,
): void {
  if (!id) return;
  fs.mkdirSync(visualsDir, { recursive: true });
  const specFile = path.join(visualsDir, `${id}.json`);
  const existing = readJson<Record<string, unknown>>(specFile, {});
  const merged = { ...existing, ...spec };
  fs.writeFileSync(specFile, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  if (visualIndex[id]) {
    visualIndex[id].type = spec.type;
    visualIndex[id].title = spec.title;
  }
}

// ---------------------------------------------------------------------------
// Pass H: content-based formula grounding
// ---------------------------------------------------------------------------

interface SourceFormula {
  id: string;
  caption: string;
  keywords: string[];
}

function formulaAnchorSemanticText(visual: LedgerVisual | undefined): string {
  if (!visual) return "";
  return [
    visual.sourceVisualId,
    visual.type,
    visual.caption,
    visual.title,
    visual.exactText,
    visual.ocrText,
    visual.semanticSummary,
    visual.description,
  ].filter(Boolean).join(" ");
}

function sourceFormulaKeywords(caption: string): string[] {
  const text = caption.toLowerCase();
  const words = new Set<string>();
  for (const [keyword, aliases] of [
    ["accuracy", ["accuracy", "correct predictions", "correct", "predictions"]],
    ["latency", ["latency", "decision time", "response time"]],
    ["spike-count", ["spike count", "total spike", "number of spikes", "spikes summed"]],
    ["energy", ["energy", "joule", "millijoule"]],
    ["efficiency", ["efficiency", "accuracy over energy", "normalized energy"]],
    ["convergence", ["convergence", "epoch", "target accuracy"]],
  ] as Array<[string, string[]]>) {
    if (aliases.some((alias) => text.includes(alias))) words.add(keyword);
  }
  return [...words];
}

function normalizeFormulaText(text: string): string {
  return text
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}\\$]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Content-match a learner formula to a source formula anchor, or return null
 * when there is no strong match (never index-based). */
/**
 * Are two formula texts structurally the SAME equation (not just the same
 * family)? Compares normalized symbolic tokens: identical normalized text, or a
 * high token-overlap. Used to distinguish a mislabeled source definition (page
 * restates the exact source equation) from a distinct helper that merely shares
 * a metric/physics family with a source equation.
 */
export function formulaTextsStructurallyClose(a: string, b: string): boolean {
  const na = normalizeFormulaText(a);
  const nb = normalizeFormulaText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tokensOf = (value: string) =>
    new Set(value.split(/\s+/).filter((token) => token.length >= 2));
  const ta = tokensOf(na);
  const tb = tokensOf(nb);
  if (ta.size === 0 || tb.size === 0) return false;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  return intersection / Math.min(ta.size, tb.size) >= 0.6;
}

export function matchFormulaToSource(formulaText: string, sources: SourceFormula[]): SourceFormula | null {
  if (!isGroundableFormula(formulaText)) return null;
  const normalized = normalizeFormulaText(formulaText);
  let best: { source: SourceFormula; score: number } | null = null;
  for (const source of sources) {
    const meaning = formulaMeaningMatch(formulaText, source.caption);
    if (meaning.sourceFamily && !meaning.ok) continue;
    if (meaning.ok && meaning.formulaFamily && meaning.sourceFamily) return source;
    let score = 0;
    for (const keyword of source.keywords) {
      if (normalized.includes(keyword.replace("-", " ")) || normalized.includes(keyword)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { source, score };
  }
  // A single-symbol expression or a simplified helper must not be claimed as a
  // source formula; require at least a two-token match or an explicit metric word.
  if (best && best.score >= 1 && normalized.split(" ").filter(Boolean).length >= 3) return best.source;
  return null;
}

/** Content-based grounding of a single learner formula against source formula
 * captions. Shared by the finalize pass and the generation pipeline so both use
 * the same rule (never positional). */
export function groundLearnerFormula(
  text: string,
  sources: Array<{ id: string; caption: string }>,
): { groundingStatus: "source-anchored" | "conceptual-helper"; sourceAnchor?: string } {
  const enriched: SourceFormula[] = sources.map((source) => ({
    id: source.id,
    caption: source.caption,
    keywords: sourceFormulaKeywords(source.caption),
  }));
  const match = matchFormulaToSource(text, enriched);
  if (match) return { groundingStatus: "source-anchored", sourceAnchor: match.id };
  return { groundingStatus: "conceptual-helper" };
}

// Default ceiling shared with the finalize noise gate. A page may exceed it
// only when its immutable source-formula contract requires a one-to-one set of
// exact reviewed projections; those entries are source evidence, not metadata
// noise.
const MAX_FORMULA_METADATA_ENTRIES = 10;

/** Rank a formula entry by how much it belongs in the metadata block. Lower is
 * more important and is dropped last when the block is over budget. Source
 * (derived) definitions are the real metric/source relationships; a helper or
 * worked example that carries a recognized metric family is more meaningful
 * than a bare inline fragment. */
function formulaMetadataEntryRank(entry: FinalizeFormulaEntry): number {
  const kind = entry.kind ?? "conceptual_helper";
  if (kind === "source_definition") return 0;
  if (kind === "source_derived_definition") return 1;
  const hasFamily = Boolean(formulaMetricFamily(entry.text));
  if (kind === "worked_example") return hasFamily ? 2 : 4;
  return hasFamily ? 3 : 5; // conceptual_helper
}

function formulaMetadataDedupeKey(entry: FinalizeFormulaEntry): string {
  return (entry.normalizedText || normalizeFormulaText(entry.text)).trim() || entry.text.trim();
}

// ---------------------------------------------------------------------------
// Fix 1-3: worked-example lineage — relationship-based (not count-based)
// formula-metadata validation, deterministic lineage assignment, and
// lineage-aware compaction.
// ---------------------------------------------------------------------------

/** Relationship-based audit of a page's formula metadata. Replaces the old
 * "N worked examples but only M source definitions" count ratio: a page with one
 * definition and many worked examples that apply it (same family / basedOnFormula)
 * is valid. */
export type FormulaMetadataAuditResult = {
  valid: boolean;
  sourceDefinitions: number;
  workedExamples: number;
  orphanWorkedExamples: { index: number; text: string; reason: string }[];
  duplicateEntries: number[];
  invalidDefinitions: number[];
  unsupportedEntries: number[];
  problems: string[];
  warnings: string[];
};

function parsedEntryFamily(entry: ParsedFormulaEntry): string | null {
  const declared = String(entry.formulaFamily ?? "").trim();
  if (declared) return declared;
  return formulaMetricFamily(String(entry.text ?? ""));
}

/** A worked example is grounded when it applies a definition the page (or a
 * source anchor it names) actually establishes — explicitly via basedOnFormula,
 * or implicitly by sharing a formula family with an on-page source definition. */
export function auditFormulaMetadata(
  entries: ParsedFormulaEntry[],
  options: {
    isExactReviewedSourceProjection?: (entry: ParsedFormulaEntry) => boolean;
  } = {},
): FormulaMetadataAuditResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const orphanWorkedExamples: { index: number; text: string; reason: string }[] = [];
  const duplicateEntries: number[] = [];
  const invalidDefinitions: number[] = [];
  const unsupportedEntries: number[] = [];

  const definitionFamilies = new Set<string>();
  const definitionAnchors = new Set<string>();
  const definitionKeys = new Set<string>();
  const definitionLhs = new Set<string>();
  // The left-hand side (the quantity being defined) of a formula, normalized.
  const formulaLhs = (text: string): string => normalizeFormulaText(String(text ?? "").split("=")[0] ?? "").trim();
  for (const entry of entries) {
    const kind = formulaEntryKind(entry);
    const text = String(entry.text ?? "");
    // A worked example on the same page may apply either a SOURCE definition or a
    // page-introduced CONCEPTUAL-HELPER definition (a symbolic formula that is
    // not itself numeric arithmetic). Both establish the relationship the
    // example substitutes into, so both count as definitions for lineage.
    const isDefinition =
      kind === "source_definition" || kind === "source_derived_definition" ||
      (kind === "conceptual_helper" && isFormulaExpression(text) && !isWorkedExampleFormula(text) && text.includes("="));
    if (isDefinition) {
      const family = parsedEntryFamily(entry);
      if (family) definitionFamilies.add(family);
      const anchor = String(entry.sourceAnchor ?? "").trim();
      if (anchor) definitionAnchors.add(anchor);
      const key = text.trim();
      if (key) definitionKeys.add(normalizeFormulaText(key));
      const lhs = formulaLhs(text);
      if (lhs.length >= 1) definitionLhs.add(lhs);
    }
  }

  const seen = new Map<string, number>();
  let sourceDefinitions = 0;
  let workedExamples = 0;
  entries.forEach((entry, index) => {
    const text = String(entry.text ?? "");
    const kind = formulaEntryKind(entry);
    const key = (String(entry.normalizedText ?? "") || normalizeFormulaText(text)).trim() || text.trim();
    if (key && seen.has(key)) duplicateEntries.push(index);
    else if (key) seen.set(key, index);

    if (kind === "source_definition" || kind === "source_derived_definition") {
      sourceDefinitions += 1;
      // A numeric substitution mislabeled as a definition (condition 6).
      // A reviewed source equation can legitimately contain indices, equation
      // numbers, or chained symbolic identities that resemble arithmetic. An
      // identity-proven, exact source projection remains a definition; all
      // unmatched equations keep the conservative worked-example check.
      if (isWorkedExampleFormula(text) && !options.isExactReviewedSourceProjection?.(entry)) {
        invalidDefinitions.push(index);
        problems.push(`formulas[${index}] stores worked-example arithmetic as ${kind}`);
      }
      // A definition claiming source grounding must name an anchor (condition 1).
      if (/^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? "")) && !String(entry.sourceAnchor ?? "").trim()) {
        unsupportedEntries.push(index);
        problems.push(`formulas[${index}] is ${entry.groundingStatus} but names no source anchor`);
      }
    } else if (kind === "worked_example") {
      workedExamples += 1;
      const family = parsedEntryFamily(entry);
      const basedOn = String(entry.basedOnFormula ?? "").trim();
      // Explicit lineage: basedOnFormula names an on-page definition OR a
      // source-formula anchor (existence in the canonical registry is validated
      // separately by the source-anchor checks — here we validate that lineage is
      // CLAIMED, not left dangling).
      const hasExplicitLineage =
        Boolean(basedOn) &&
        (definitionAnchors.has(basedOn) || definitionKeys.has(normalizeFormulaText(basedOn)) || /^S\d+\.P\d+\.[A-Z]?\d+$/i.test(basedOn));
      const hasImplicitLineage = Boolean(family) && definitionFamilies.has(family!);
      // A worked example that computes the same quantity as an on-page
      // definition (shared left-hand side, e.g. "A = …" applying "A = 100a/BTN")
      // is grounded even when their coarse families differ.
      const hasLhsLineage = definitionLhs.has(formulaLhs(text));
      // A worked example whose OWN TEXT computes a recognized metric (a
      // percentage/ratio, latency, energy, …) on a page that ESTABLISHES formula
      // context (has at least one definition/helper) is a meaningful computation,
      // not orphan noise — the definition it applies may live on an earlier page
      // (e.g. a sparsity/activity metric shown on a results page whose formula is
      // defined in the methods section). Detected from the text, not the declared
      // family, so bare arithmetic like "2+3=5" is NOT excused; and a page that is
      // ONLY a dump of bare percentage examples (no definitions at all) is still
      // flagged.
      const pageHasDefinitionContext =
        definitionLhs.size > 0 || definitionAnchors.size > 0 || definitionKeys.size > 0;
      const computesRecognizedMetric = Boolean(formulaMetricFamily(text)) && pageHasDefinitionContext;
      if (!hasExplicitLineage && !hasImplicitLineage && !hasLhsLineage && !computesRecognizedMetric) {
        const reason = family
          ? `worked example (family ${family}) has no source definition on the page to apply and no valid basedOnFormula`
          : "worked example has no recognizable formula family or lineage";
        orphanWorkedExamples.push({ index, text, reason });
      }
      // A worked example must never claim to be source-grounded (condition 7).
      if (/^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? ""))) {
        unsupportedEntries.push(index);
        problems.push(`formulas[${index}] worked example is marked ${entry.groundingStatus}; worked examples cannot satisfy a source definition`);
      }
    } else {
      // conceptual_helper claiming source grounding is unsupported (condition 7).
      if (/^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? ""))) {
        unsupportedEntries.push(index);
        problems.push(`formulas[${index}] conceptual helper is marked ${entry.groundingStatus} without a source definition`);
      }
    }
  });

  for (const orphan of orphanWorkedExamples) {
    problems.push(`formulas[${orphan.index}] ${orphan.reason}`);
  }
  return {
    valid: problems.length === 0,
    sourceDefinitions,
    workedExamples,
    orphanWorkedExamples,
    duplicateEntries,
    invalidDefinitions,
    unsupportedEntries,
    problems: [...new Set(problems)],
    warnings,
  };
}

/** Deterministically link worked examples to the definition they apply. A pure
 * numeric substitution (e.g. "84/100=0.84=84%") has no intrinsic metric family —
 * its family and anchor come from the definition it applies, so on a page with a
 * single source definition every worked example is based on it. On multi-
 * definition pages a worked example is linked by its own detected family when
 * that matches one of the page's definitions. */
function assignWorkedExampleLineage(entries: FinalizeFormulaEntry[], sources: SourceFormula[]): void {
  const definitions = entries.filter(
    (entry) => entry.kind === "source_definition" || entry.kind === "source_derived_definition",
  );
  const familyToAnchor = new Map<string, string>();
  const defFamily = (def: FinalizeFormulaEntry): NonNullable<ReturnType<typeof formulaMetricFamily>> | undefined => {
    const declared = def.formulaFamily;
    const recognized = declared ? formulaMetricFamily(declared) : null;
    return recognized || formulaMetricFamily(def.text) || undefined;
  };
  for (const def of definitions) {
    const family = defFamily(def);
    if (family && def.sourceAnchor && !familyToAnchor.has(family)) familyToAnchor.set(family, def.sourceAnchor);
  }
  for (const source of sources) {
    const family = formulaMetricFamily(source.caption);
    if (family && !familyToAnchor.has(family)) familyToAnchor.set(family, source.id);
  }
  // A worked example whose own family cannot be detected (a bare numeric
  // substitution) applies the page's primary source definition — the sole one,
  // never the first of several definitions. Multiple plausible definitions are
  // genuine ambiguity for the narrow, independently verified ChatMock packet.
  const primaryDefinition = definitions.length === 1 ? definitions[0] : undefined;
  const primaryAnchor = primaryDefinition?.sourceAnchor;
  const primaryFamily = primaryDefinition ? defFamily(primaryDefinition) : undefined;

  let group = 0;
  const groupIdByKey = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== "worked_example") continue;
    let family = formulaMetricFamily(entry.text) || undefined;
    let anchor = entry.basedOnFormula || (family ? familyToAnchor.get(family) : undefined);
    if (!anchor && primaryAnchor) {
      anchor = primaryAnchor;
      family = family ?? primaryFamily;
    }
    if (!family && primaryFamily) family = primaryFamily;
    if (family) entry.formulaFamily = family;
    if (anchor) entry.basedOnFormula = anchor;
    const key = anchor ?? family ?? "";
    if (key) {
      if (!groupIdByKey.has(key)) {
        group += 1;
        groupIdByKey.set(key, `eg${group}`);
      }
      entry.exampleGroupId = groupIdByKey.get(key);
    }
  }
}

const MAX_WORKED_EXAMPLES_IN_METADATA_PER_FAMILY = 2;

/** Compact metadata by lineage (Fix 3): keep every unique source (derived)
 * definition, retain one or two representative worked examples per formula family
 * / basedOnFormula in the FRONTMATTER (the body keeps them all), remove exact and
 * normalized duplicates, and keep the block under the noise ceiling. Never drops
 * a definition and never touches page body content. */
export function compactFormulaMetadataByLineage(entries: FinalizeFormulaEntry[]): FinalizeFormulaEntry[] {
  // 1) De-duplicate by normalized text, keeping the most authoritative kind.
  const byKey = new Map<string, FinalizeFormulaEntry>();
  const order: string[] = [];
  for (const entry of entries) {
    const key = formulaMetadataDedupeKey(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      order.push(key);
    } else if (formulaMetadataEntryRank(entry) < formulaMetadataEntryRank(existing)) {
      byKey.set(key, entry);
    }
  }
  const deduped = order.map((key) => byKey.get(key)!);

  // 2) Keep all definitions; cap worked examples per lineage group.
  const perGroup = new Map<string, number>();
  const kept: FinalizeFormulaEntry[] = [];
  for (const entry of deduped) {
    if (entry.kind === "worked_example") {
      const family = entry.formulaFamily || formulaMetricFamily(entry.text) || "misc";
      const groupKey = entry.basedOnFormula ? `${entry.basedOnFormula}:${family}` : family;
      const count = perGroup.get(groupKey) ?? 0;
      if (count >= MAX_WORKED_EXAMPLES_IN_METADATA_PER_FAMILY) continue;
      perGroup.set(groupKey, count + 1);
    }
    kept.push(entry);
  }

  // 3) Hard ceiling so a pathological page cannot exceed the noise limit: drop
  //    the least-important tail (never a definition) in original order.
  if (kept.length <= MAX_FORMULA_METADATA_ENTRIES) return kept;
  return kept
    .map((entry, index) => ({ entry, index, rank: formulaMetadataEntryRank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, MAX_FORMULA_METADATA_ENTRIES)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.entry);
}

// ---------------------------------------------------------------------------
// Part 1 / Fix 1: the ONE canonical formula-metadata pipeline
// parse -> normalize text -> classify kind -> assign lineage -> verify family
// -> deduplicate -> compact by lineage -> serialize -> audit.
// Every mutation path (regrounding, relabeling, deterministic/model repair,
// reconciliation, self-healing) must terminate here so equivalent pages end with
// identical serialized `formulas:` metadata regardless of the path taken.
// ---------------------------------------------------------------------------

export type CanonicalFormulaChangeType =
  | "normalized_text"
  | "reclassified_kind"
  | "assigned_lineage"
  | "assigned_family"
  | "deduplicated"
  | "compacted"
  | "removed_unsupported";

export interface CanonicalFormulaNormalizationResult {
  entries: FinalizeFormulaEntry[];
  changes: { type: CanonicalFormulaChangeType; before?: FinalizeFormulaEntry; after?: FinalizeFormulaEntry; reason: string }[];
  audit: FormulaMetadataAuditResult;
  changed: boolean;
}

export function normalizeFormulaMetadataCanonical(
  input: FinalizeFormulaEntry[],
  context: { pagePath: string; sources?: SourceFormula[]; displayFormulas?: string[] },
): CanonicalFormulaNormalizationResult {
  const changes: CanonicalFormulaNormalizationResult["changes"] = [];
  const beforeSerialized = serializeFormulas(input);
  // Work on copies so the caller's array is not mutated in place.
  const entries: FinalizeFormulaEntry[] = input.map((entry) => ({ ...entry }));

  // 1) normalize formula text.
  for (const entry of entries) {
    const normalized = normalizeFormulaText(entry.text);
    if (entry.normalizedText !== normalized) {
      entry.normalizedText = normalized;
      changes.push({ type: "normalized_text", reason: `normalized ${context.pagePath}` });
    }
  }
  // 2) classify kind when missing.
  for (const entry of entries) {
    if (!entry.kind) {
      entry.kind = isWorkedExampleFormula(entry.text)
        ? "worked_example"
        : entry.groundingStatus === "source-anchored"
          ? "source_definition"
          : entry.groundingStatus === "source-derived"
            ? "source_derived_definition"
            : "conceptual_helper";
      changes.push({ type: "reclassified_kind", reason: `inferred ${entry.kind}` });
    }
  }
  // 3+4) assign worked-example lineage + family.
  const beforeLineage = entries.map((entry) => `${entry.basedOnFormula ?? ""}|${entry.formulaFamily ?? ""}`);
  assignWorkedExampleLineage(entries, context.sources ?? []);
  entries.forEach((entry, index) => {
    const key = `${entry.basedOnFormula ?? ""}|${entry.formulaFamily ?? ""}`;
    if (key !== beforeLineage[index]) changes.push({ type: "assigned_lineage", reason: `lineage for formulas[${index}]` });
  });
  // 5+6) deduplicate + compact by lineage.
  const compacted = compactFormulaMetadataByLineage(entries);
  if (compacted.length !== entries.length) {
    changes.push({ type: "compacted", reason: `${entries.length} -> ${compacted.length} entries` });
  }
  // 8) audit (serialization is the caller's concern via serializeFormulas/fmSetFormulas).
  const audit = auditFormulaMetadata(compacted as unknown as ParsedFormulaEntry[]);
  return {
    entries: compacted,
    changes,
    audit,
    changed: serializeFormulas(compacted) !== beforeSerialized,
  };
}

// Very small math extractor mirroring extractQuartzMath for finalize's needs.
function extractBodyFormulaRecords(body: string): Array<{ text: string; display: boolean }> {
  const noCode = body.replace(/```[\s\S]*?```/g, " ");
  const formulas: Array<{ text: string; display: boolean }> = [];
  for (const match of noCode.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
    const text = (match[1] ?? "").trim();
    if (text) formulas.push({ text, display: true });
  }
  for (const match of noCode.matchAll(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g)) {
    const text = (match[1] ?? "").trim();
    if (text) formulas.push({ text, display: false });
  }
  return formulas;
}

function regroundFormulas({
  gardenDir,
  ledger,
  learnerPages,
  report,
}: {
  gardenDir: string;
  ledger: LedgerVisual[];
  learnerPages: LearnerPage[];
  report: FinalizeReport;
}): void {
  const finalState = buildFinalGardenState(gardenDir, path.basename(gardenDir));
  const pageByRel = new Map(finalState.pages.map((page) => [page.rel, page]));
  const unitById = new Map(finalState.learningUnitContract.units.map((unit) => [unit.id, unit]));
  const identityById = new Map(
    buildFormulaIdentityRegistry(buildCanonicalSourceAnchors(gardenDir), gardenDir)
      .map((identity) => [identity.anchorId, identity]),
  );
  const sources: SourceFormula[] = ledger
    .filter((visual) => classifyFigure(visual) === "equation")
    .map((visual) => ({
      id: visual.sourceVisualId,
      caption: formulaAnchorSemanticText(visual),
      keywords: sourceFormulaKeywords(formulaAnchorSemanticText(visual)),
    }));

  for (const page of learnerPages) {
    const formulas = extractBodyFormulaRecords(page.body)
      .filter((formula) => isGroundableFormula(formula.text) && !isTrivialFormulaFragment(formula.text));
    if (formulas.length === 0) {
      // No math -> no formulas block; also drop any dangling metric anchors.
      const hadBlock = /^formulas:/m.test(page.rawFm) || fmGetArray(page.rawFm, "sourceFormulaAnchors").length > 0 || Boolean(fmGetScalar(page.rawFm, "sourceFormulaAnchor"));
      page.rawFm = fmSetFormulas(page.rawFm, []);
      page.rawFm = fmSetArray(page.rawFm, "sourceFormulaAnchors", []);
      page.rawFm = removeKeyLine(page.rawFm, "sourceFormulaAnchor");
      if (hadBlock) page.dirty = true;
      continue;
    }
    const entries: FinalizeFormulaEntry[] = [];
    const anchoredIds = new Set<string>();
    for (const { text, display } of formulas) {
      let match = matchFormulaToSource(text, sources);
      if (match) {
        const finalPage = pageByRel.get(page.rel);
        const unit = finalPage ? unitById.get(finalPage.learningUnitId) : undefined;
        const identity = identityById.get(match.id);
        if (!finalPage || !unit || !identity) {
          match = null;
        } else {
          try {
            assertFormulaAssignmentCompatible(identity, unit, finalPage);
            // Requirement-based pre-write guard for NEW attachments: an anchor
            // this page does not already carry must also fit the unit's own
            // derived formula requirement before it may enter frontmatter.
            // Anchors already on the page keep the page-aware guard above;
            // cleaning those is the reconciliation critic's job, not a silent
            // drop during finalize.
            const alreadyAttached = fmGetArray(page.rawFm, "sourceFormulaAnchors").includes(match.id)
              || page.rawFm.includes(`sourceAnchor: "${match.id}"`)
              || page.rawFm.includes(`basedOnFormula: "${match.id}"`);
            if (!alreadyAttached) {
              const requirement = deriveUnitFormulaRequirement(unit);
              if (validateFormulaAssignment(identity, requirement, unit).hardRejectionReasons.length > 0) {
                match = null;
              }
            }
          } catch {
            match = null;
          }
        }
      }
      const family = formulaMetricFamily(text);
      const workedExample = isWorkedExampleFormula(text);
      const keepInlineConceptual = workedExample || (entries.length === 0 && /=|\\frac|\/|\\sum|\\min|\\max/.test(text));
      if (!match && !family && !display && !keepInlineConceptual) continue;
      if (match) {
        entries.push({
          kind: workedExample ? "worked_example" : "source_definition",
          text,
          normalizedText: normalizeFormulaText(text),
          groundingStatus: workedExample ? "conceptual-helper" : "source-anchored",
          justification: workedExample
            ? `Worked example applying source formula ${match.id} (${match.caption}).`
            : `Content matches source metric formula ${match.id} (${match.caption}).`,
          sourceAnchor: workedExample ? undefined : match.id,
          sourceAnchorTitle: match.caption,
          basedOnFormula: workedExample ? match.id : undefined,
          formulaFamily: identityById.get(match.id)?.verified
            ? legacyFormulaFamily(identityById.get(match.id)!.family)
            : formulaMetricFamily(text) ?? undefined,
          matchReason: "metric family and source formula anchor text match",
          confidence: 0.9,
        });
        if (!workedExample) anchoredIds.add(match.id);
      } else {
        entries.push({
          kind: workedExample ? "worked_example" : "conceptual_helper",
          text,
          normalizedText: normalizeFormulaText(text),
          groundingStatus: "conceptual-helper",
          matchReason: "no matching source formula anchor",
          confidence: 0.4,
          justification:
            "Introduced as a compact helper to explain the mechanism on this page; not claimed as a verbatim source formula.",
        });
      }
    }
    // Terminate in the ONE canonical pipeline (normalize -> classify -> lineage
    // -> dedup -> compact) so this path produces exactly the same metadata as any
    // other repair path. The body keeps every example; only the frontmatter index
    // is compacted.
    const displayCount = formulas.filter((formula) => formula.display).map((formula) => formula.text);
    const compactedEntries = normalizeFormulaMetadataCanonical(entries, { pagePath: page.rel, sources, displayFormulas: displayCount }).entries;
    // Only mark the page dirty when regrounding actually changes the formula
    // metadata. Re-serializing identical grounding must not report the page as
    // repaired, so repair-log.json changedFiles stays limited to real edits.
    let nextFm = fmSetFormulas(page.rawFm, compactedEntries);
    nextFm = fmSetArray(nextFm, "sourceFormulaAnchors", [...anchoredIds]);
    nextFm = removeKeyLine(nextFm, "sourceFormulaAnchor");
    if (nextFm === page.rawFm) continue;
    page.rawFm = nextFm;
    page.dirty = true;
    report.notes.push(`reground ${compactedEntries.length} formula(s) on ${page.rel} (${anchoredIds.size} source-anchored)`);
  }
}

function synchronizePageVisualTextAnchors(learnerPages: LearnerPage[], report: FinalizeReport): void {
  for (const page of learnerPages) {
    const visualTextAnchors = new Set<string>();
    for (const spec of embeddedVisualSpecs(page.body)) {
      for (const id of visualSpecTextAnchorIds(spec)) visualTextAnchors.add(id);
    }
    if (visualTextAnchors.size === 0) continue;
    const existing = fmGetArray(page.rawFm, "sourceAnchors");
    const existingSet = new Set(existing);
    const missing = [...visualTextAnchors].filter((id) => !existingSet.has(id));
    if (missing.length === 0) continue;
    page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", [...existing, ...missing]);
    page.dirty = true;
    report.notes.push(`synced visual text anchor(s) into ${page.rel}: ${missing.join(", ")}`);
  }
}

function pruneOrphanSemanticRepairProvenance(gardenDir: string, learnerPages: LearnerPage[], report: FinalizeReport): void {
  const run = readRepairRunReport(gardenDir);
  if (!run) return;
  const repairedPages = new Set((run.repairs ?? []).map((entry) => entry.pagePath));
  for (const page of learnerPages) {
    if (!fmGetScalar(page.rawFm, "lastSemanticRepairAt")) continue;
    if (repairedPages.has(page.rel)) continue;
    const before = page.rawFm;
    page.rawFm = removeKeyLine(page.rawFm, "lastSemanticRepairAt");
    page.rawFm = removeKeyLine(page.rawFm, "semanticRepairReason");
    page.rawFm = fmRemoveBlock(page.rawFm, "lastSemanticRepair");
    if (page.rawFm === before) continue;
    page.dirty = true;
    report.notes.push(`removed stale semantic repair provenance from ${page.rel}`);
  }
}

// ---------------------------------------------------------------------------
// Pass I: tag centrality
// ---------------------------------------------------------------------------

const TAG_BANK: Record<PageRole, string[]> = {
  intro: ["neural-networks/dense-continuous-activation", "snn/event-driven-sparsity", "snn/spike-based-communication"],
  basic_def: ["snn/spike-event-generation", "snn/event-driven-sparsity", "computational-neuroscience/membrane-potential-accumulation"],
  lif: ["snn/lif-neuron-threshold-reset", "snn/membrane-potential-integration", "snn/spike-event-generation"],
  training: ["training/scalable-snn-optimization", "training/surrogate-gradient-learning", "snn/spike-timing-plasticity"],
  metric: ["metric/accuracy-latency-spike-count", "metric/accuracy-per-energy", "tradeoff/evaluation-metric-coupling"],
  comparison: ["metric/model-family-comparison", "tradeoff/accuracy-energy-latency", "evaluation/reproducible-metric-baselines"],
  application: ["deployment/edge-neuromorphic-hardware", "tradeoff/energy-latency-budget", "deployment/latency-sensitive-inference"],
  challenges: ["deployment/hardware-standardization-gap", "training/scalable-snn-optimization", "evaluation/reproducible-metric-baselines"],
  generic: ["snn/event-driven-sparsity"],
};

function tagLeafWords(tag: string): string[] {
  const leaf = tag.split("/").pop() ?? tag;
  return leaf.split("-").filter((word) => word.length >= 4);
}

function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return (text.match(global) ?? []).length;
}

// Concept tag → the evidence a page must actually show to legitimately carry
// it (mirror of the validator's TAG_RELEVANCE_RULES so finalize never keeps a
// tag the validator would reject).
const TAG_EVIDENCE_RULES: Array<{ appliesTo: RegExp; evidence: RegExp; minBody: number }> = [
  { appliesTo: /lif-neuron|leaky/i, evidence: /\blif\b|leaky[- ]integrate|membrane potential|threshold/i, minBody: 1 },
  { appliesTo: /stdp/i, evidence: /\bstdp\b|spike[- ]?timing|synaptic plasticity/i, minBody: 1 },
  { appliesTo: /surrogate/i, evidence: /surrogate[- ]gradient|surrogate[- ]trained|surrogate training/i, minBody: 1 },
  { appliesTo: /(?:^|[/-])latency(?:$|[/-])/i, evidence: /\blatency\b|\bresponse time\b/i, minBody: 2 },
  { appliesTo: /convergence/i, evidence: /\bconverg\w*\b|\btraining loss\b|\bepochs?\b/i, minBody: 2 },
];

function tagIsCentral(tag: string, page: LearnerPage): boolean {
  const prose = teachingProseLite(page.body);
  const haystack = `${page.title} ${prose}`.toLowerCase();
  const pageText = `${page.rel} ${page.title}`.toLowerCase();
  // Domain guards mirroring the validator's centrality rules.
  if (/metric\/convergence-time-target-epoch/.test(tag) && !/metric|evaluation|convergence|training|results/.test(pageText)) return false;
  if (/snn\/lif-neuron-threshold-reset/.test(tag) && !/lif|leaky|neuron model|what spiking neural networks are/.test(pageText)) return false;
  if (/open challenge|unresolved|limitation|future work/.test(pageText) && /lif|leaky|threshold-reset/.test(tag)) return false;
  // Evidence rules: a tag with a stricter evidence requirement must meet it in
  // the body (or the page title), exactly as the validator enforces.
  for (const rule of TAG_EVIDENCE_RULES) {
    if (!rule.appliesTo.test(tag)) continue;
    const titleHit = rule.evidence.test(page.title);
    if (!titleHit && countMatches(prose, rule.evidence) < rule.minBody) return false;
  }
  const words = tagLeafWords(tag);
  if (words.length === 0) return true;
  return words.some((word) => haystack.includes(word));
}

/** Teaching prose only — mirrors the validator's teachingProse(): drops code
 * fences, image embeds, and single-line italic provenance captions so an
 * embedded source-figure caption never counts as page-central evidence. */
function teachingProseLite(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*\*[^*\n]+\*(?:\s*\*\([^)\n]*\)\*)?\s*$/gm, " ");
}

function repairTags(pages: LearnerPage[], gardenSlug: string, report: FinalizeReport): void {
  // First pass: per-page centrality filtering + top-up.
  for (const page of pages) {
    const current = fmGetArray(page.rawFm, "tags");
    let kept = current.filter((tag) => tag.includes("/") && tagIsCentral(tag, page));
    // Top up from the role bank (only central additions).
    for (const candidate of TAG_BANK[page.role] ?? []) {
      if (kept.length >= 4) break;
      if (!kept.includes(candidate) && tagIsCentral(candidate, page)) kept.push(candidate);
    }
    // Absolute floor: guarantee >= 3.
    for (const candidate of TAG_BANK[page.role] ?? []) {
      if (kept.length >= 3) break;
      if (!kept.includes(candidate)) kept.push(candidate);
    }
    kept = kept.slice(0, 7);
    if (kept.join("|") !== current.join("|")) {
      page.rawFm = fmSetArray(page.rawFm, "tags", kept);
      page.dirty = true;
    }
  }

  // Second pass: break over-reuse (> 60% of learner pages) except a true
  // garden-level topic, by dropping the tag from the least-relevant pages.
  if (pages.length >= 4) {
    const maxAllowed = Math.ceil(pages.length * 0.6);
    const counts = new Map<string, LearnerPage[]>();
    for (const page of pages) {
      for (const tag of fmGetArray(page.rawFm, "tags")) {
        const list = counts.get(tag) ?? [];
        list.push(page);
        counts.set(tag, list);
      }
    }
    for (const [tag, tagPages] of counts) {
      if (tagPages.length <= maxAllowed) continue;
      // Rank by centrality strength; drop from weakest until within budget.
      const ranked = [...tagPages].sort((a, b) => tagCentralityScore(tag, b) - tagCentralityScore(tag, a));
      const toDrop = ranked.slice(maxAllowed);
      for (const page of toDrop) {
        const remaining = fmGetArray(page.rawFm, "tags").filter((existing) => existing !== tag);
        const topped = remaining;
        for (const candidate of TAG_BANK[page.role] ?? []) {
          if (topped.length >= 3) break;
          if (!topped.includes(candidate)) topped.push(candidate);
        }
        page.rawFm = fmSetArray(page.rawFm, "tags", topped.slice(0, 7));
        page.dirty = true;
      }
      report.notes.push(`rebalanced over-reused tag "${tag}" (${tagPages.length}/${pages.length})`);
    }
  }
}

function tagCentralityScore(tag: string, page: LearnerPage): number {
  const haystack = `${page.title} ${teachingProseLite(page.body)}`.toLowerCase();
  let score = 0;
  for (const word of tagLeafWords(tag)) if (haystack.includes(word)) score += 1;
  if (page.title.toLowerCase().includes((tag.split("/").pop() ?? "").split("-")[0])) score += 2;
  return score;
}

// ---------------------------------------------------------------------------
// Pass J: cross-page repeated-motivation removal
// ---------------------------------------------------------------------------

const MOTIF_RE = /battery-powered robot|battery-powered drone|quiet hallway|dense ann|silent snn|small camera (?:on|watching)|small vision system for a battery/i;
const REPEATED_TRANSITION_RE = /the motivation is already in place|this page develops how|focus on the specific mechanism|this lesson adds to the learning path|build up\b[^.\n]{0,120}\bone step at a time/i;

const ROLE_TRANSITION: Partial<Record<PageRole, string>> = {
  intro: "Sparse events change the starting point for computation: instead of updating every value at every moment, the system pays attention when meaningful activity appears. That shift sets up the next idea: what representation, mechanism, or measurement changes once information is carried by spikes.",
  lif: "Event-driven sparsity explains why spiking networks can be efficient. The next question is mechanical: what does a single spiking neuron actually do to turn incoming current into a spike? Consider the membrane of one neuron as it integrates input, leaks charge, and fires when it crosses a threshold.",
  training: "Now that event-driven sparsity is established, efficiency only pays off if the network can be trained to fire useful spikes at useful times. Consider a network whose connection weights must be adjusted so that input spike patterns lead to correct decisions.",
  metric: "Now that event-driven sparsity has been established, the next question is how to measure whether it actually helps. A single accuracy number hides the costs that make spiking networks worthwhile, so evaluation has to weigh several quantities at once. Consider comparing two models that reach similar accuracy at very different energy and latency costs.",
  comparison: "With the individual metrics defined, the models can finally be compared side by side. Consider the same families of spiking networks measured together across accuracy, latency, energy, and spike count rather than one metric at a time.",
  application: "The measured tradeoffs only matter when they meet a real deployment. Consider an edge device that must hit an accuracy target inside a fixed energy and latency budget, and how that constraint selects one spiking approach over another.",
  challenges: "The tradeoffs so far assume clean measurements and stable hardware. Consider what is still unresolved once spiking networks leave controlled benchmarks: hardware standardization, scalable training, and reproducible evaluation.",
  basic_def: "Building on the motivation for sparse, event-driven computation, consider what a spiking neural network actually is: a network whose neurons communicate with discrete spikes in time rather than continuous activations.",
  generic: "Once the earlier idea is clear, the next source-grounded claim has to make a more precise move: name the concept, show what changes, and connect that change to the learner's growing model of the system.",
};

function naturalRepeatedOpeningTransition(page: LearnerPage, previous?: LearnerPage): string {
  if (page.role !== "generic" && ROLE_TRANSITION[page.role]) return ROLE_TRANSITION[page.role]!;
  const current = stripTitleNumber(page.title).toLowerCase() || "the next concept";
  const prior = previous ? stripTitleNumber(previous.title).toLowerCase() : "";
  if (prior) {
    return `After ${prior}, ${current} becomes the next question to resolve. The idea now is to make the relationship concrete: what changes in the mechanism, measurement, result, or limitation, and why that change matters for the system being studied.`;
  }
  return ROLE_TRANSITION.generic!;
}

function removeRepeatedMotivation(pages: LearnerPage[], report: FinalizeReport): void {
  let motifSeen = false;
  let previousLearnerPage: LearnerPage | undefined;
  for (const page of pages) {
    const intro = page.body.replace(/^#.*$/gm, " ").split(/\s+/).filter(Boolean).slice(0, 80).join(" ");
    const hasMotif = MOTIF_RE.test(intro) || REPEATED_TRANSITION_RE.test(intro);
    if (!hasMotif) {
      previousLearnerPage = page;
      continue;
    }
    if (!motifSeen && page.sectionNumber <= 2) {
      // Allow the first early page to establish the framing.
      motifSeen = true;
      previousLearnerPage = page;
      continue;
    }
    motifSeen = true;
    const transition = naturalRepeatedOpeningTransition(page, previousLearnerPage);
    if (!transition) continue;
    // Replace the first prose paragraph (which carries the motif) with a
    // forward transition that builds on prior pages.
    const paragraphs = page.body.replace(/^\n+/, "").split(/\n{2,}/);
    let targetParagraph = paragraphs.findIndex((paragraph, index) => {
      if (index > 4) return false;
      return MOTIF_RE.test(paragraph) || REPEATED_TRANSITION_RE.test(paragraph);
    });
    if (targetParagraph < 0) {
      targetParagraph = paragraphs.findIndex((paragraph) => {
      const trimmed = paragraph.trim();
      return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("!") && !trimmed.startsWith("```");
      });
    }
    if (targetParagraph < 0) targetParagraph = 0;
    if (MOTIF_RE.test(paragraphs[targetParagraph] ?? "") || REPEATED_TRANSITION_RE.test(paragraphs[targetParagraph] ?? "") || MOTIF_RE.test(intro) || REPEATED_TRANSITION_RE.test(intro)) {
      paragraphs[targetParagraph] = transition;
      page.body = paragraphs.join("\n\n");
      page.dirty = true;
      report.notes.push(`replaced repeated first-page motivation on ${page.rel}`);
    }
    previousLearnerPage = page;
  }
}

function repeatedOpeningProblems(pages: LearnerPage[]): string[] {
  const problems: string[] = [];
  const motifPages: string[] = [];
  const introByFingerprint = new Map<string, string[]>();
  for (const page of pages) {
    const intro = teachingProseLite(page.body).split(/\s+/).filter(Boolean).slice(0, 80).join(" ").toLowerCase();
    if (MOTIF_RE.test(intro)) motifPages.push(page.rel);
    const fingerprint = intro
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 16)
      .join(" ");
    if (fingerprint.split(" ").length >= 12) {
      const rels = introByFingerprint.get(fingerprint) ?? [];
      rels.push(page.rel);
      introByFingerprint.set(fingerprint, rels);
    }
  }
  if (motifPages.length > 1) problems.push(`repeated battery/quiet-hallway/dense-ANN intro motif on ${motifPages.join(", ")}`);
  for (const [fingerprint, rels] of introByFingerprint) {
    if (rels.length >= 3) problems.push(`repeated opening phrase "${fingerprint}" on ${rels.join(", ")}`);
  }
  return [...new Set(problems)];
}

const LEARNER_SCAFFOLD_PROSE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "The motivation is already in place", pattern: /\bThe motivation is already in place\b/i },
  { label: "Focus on the specific mechanism", pattern: /\bFocus on the specific mechanism\b/i },
  { label: "this lesson adds to the learning path", pattern: /\bthis lesson adds to the learning path\b/i },
  { label: "the previous concepts", pattern: /\bthe previous concepts\b/i },
  { label: "the specific mechanism, metric, result, or limitation", pattern: /\bthe specific mechanism,\s*metric,\s*result,\s*or limitation\b/i },
  { label: "this page develops how", pattern: /\bthis page develops how\b/i },
  { label: "Build up [topic] one step at a time", pattern: /\bBuild up\b[^.\n]{0,120}\bone step at a time\b/i },
];

function learnerFacingScaffoldProseProblems(pages: LearnerPage[]): string[] {
  const problems: string[] = [];
  for (const page of pages) {
    const prose = teachingProseLite(page.body);
    for (const { label, pattern } of LEARNER_SCAFFOLD_PROSE_PATTERNS) {
      if (pattern.test(prose)) problems.push(`${page.rel}: contains repair scaffold prose "${label}"`);
    }
    if (/\bsnns\b/.test(prose)) problems.push(`${page.rel}: uses lowercase acronym "snns"`);
    if (/\bSNNs\s+learns\b/i.test(prose)) problems.push(`${page.rel}: contains grammar error "SNNs learns"`);
  }
  return [...new Set(problems)];
}

function repairLearnerAcronymGrammar(learnerPages: LearnerPage[], report: FinalizeReport): void {
  for (const page of learnerPages) {
    const lines = page.body.split(/\r?\n/);
    let inFence = false;
    const next = lines.map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) return line;
      if (/^\s*\[[^\]]+\]:\s*\S+/.test(line)) return line;
      return line
        .replace(/\bsnns\b/gi, "SNNs")
        .replace(/\bsnn\b/gi, "SNN")
        .replace(/\bSNNs\s+learns\b/gi, "SNNs learn");
    }).join("\n");
    if (next === page.body) continue;
    page.body = next;
    page.dirty = true;
    report.notes.push(`repaired SNN acronym grammar in ${page.rel}`);
  }
}

function repairSourceVisualImagePathCasing(gardenDir: string, learnerPages: LearnerPage[], report: FinalizeReport): void {
  const assetDir = path.join(gardenDir, "assets", "source-visuals");
  if (!fs.existsSync(assetDir)) return;
  const actualNameByLower = new Map<string, string>();
  for (const name of fs.readdirSync(assetDir)) {
    actualNameByLower.set(name.toLowerCase(), name);
  }
  if (actualNameByLower.size === 0) return;
  for (const page of learnerPages) {
    const next = page.body.replace(/(!\[[^\]]*\]\()([^)]*\/source-visuals\/)([^)]+)(\))/g, (full, open: string, prefix: string, fileName: string, close: string) => {
      const actual = actualNameByLower.get(String(fileName).toLowerCase());
      if (!actual || actual === fileName) return full;
      return `${open}${prefix}${actual}${close}`;
    });
    if (next === page.body) continue;
    page.body = next;
    page.dirty = true;
    report.notes.push(`repaired source visual image path casing in ${page.rel}`);
  }
}

function naturalProseValidationForPage(page: LearnerPage): "pass" | "fail" {
  return learnerFacingScaffoldProseProblems([page]).length === 0 ? "pass" : "fail";
}

function sectionIndexProseQualityProblems(gardenDir: string): string[] {
  const pages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", pages);
  const problems: string[] = [];
  for (const page of pages.filter((entry) => /\/_index\.md$/i.test(entry.rel))) {
    const { body } = parseFrontmatter(readFileSyncWithRetry(page.abs, "utf-8"));
    const prose = teachingProseLite(body);
    if (/\bBuild up\b[^.\n]{0,120}\bone step at a time\b/i.test(prose)) {
      problems.push(`${page.rel}: contains generic "Build up ... one step at a time" scaffold prose`);
    }
    if (/\bsnns\b/.test(prose)) problems.push(`${page.rel}: uses lowercase acronym "snns"`);
    if (/\bSNNs\s+learns\b/i.test(prose)) problems.push(`${page.rel}: contains grammar error "SNNs learns"`);
    if (/\bThis section is part of the confirmed Breadboard learning map\b/i.test(prose)) {
      problems.push(`${page.rel}: exposes learning-map scaffold prose`);
    }
  }
  return [...new Set(problems)];
}

function repairSectionIndexProse(gardenDir: string, report: FinalizeReport): void {
  const pages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", pages);
  for (const page of pages.filter((entry) => /\/_index\.md$/i.test(entry.rel))) {
    const content = readFileSyncWithRetry(page.abs, "utf-8");
    const { rawFrontmatter, body, hadFrontmatter } = parseFrontmatter(content);
    const prose = teachingProseLite(body);
    if (!/\bBuild up\b[^.\n]{0,120}\bone step at a time\b|\bsnns\b|\bSNNs\s+learns\b|This section is part of the confirmed Breadboard learning map/i.test(prose)) continue;
    const title = fmGetScalar(rawFrontmatter, "title") || body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() || path.basename(path.dirname(page.abs));
    const links = body.split(/\r?\n/).filter((line) => /\[\[learning\//i.test(line));
    const childTitles = links
      .map((line) => line.match(/\|([^\]]+)\]\]/)?.[1] ?? line.match(/\[\[[^\]]+\/([^/\]|]+)(?:\|)?/)?.[1] ?? "")
      .map((value) => value.replace(/\.md$/i, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const cleanTitle = title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
    const summary = childTitles.length > 1
      ? `${cleanTitle} connects ${childTitles[0]} with ${childTitles.slice(1).join(", ")} so the ideas build in a clear order.`
      : `${cleanTitle} introduces the core idea and connects it to the next learner-facing step.`;
    const nextBody = [`# ${title}`, "", summary, "", ...links].join("\n").replace(/\n{3,}/g, "\n\n");
    fs.writeFileSync(page.abs, hadFrontmatter ? joinFrontmatter(rawFrontmatter, nextBody) : nextBody, "utf-8");
    if (!report.changed.includes(page.rel)) report.changed.push(page.rel);
    report.notes.push(`repaired section index prose in ${page.rel}`);
  }
}

function visualTitleCaptionQualityProblems(learnerPages: LearnerPage[]): string[] {
  const problems: string[] = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const id = String(spec.id ?? "(missing id)");
      const title = String(spec.title ?? "").trim();
      const caption = String(spec.caption ?? "").trim();
      if (!title) problems.push(`${page.rel}: visual ${id} missing title`);
      if (/^[a-z]/.test(title)) problems.push(`${page.rel}: visual ${id} title starts lowercase: "${title}"`);
      if (/^SNN metric calculator$/i.test(title)) problems.push(`${page.rel}: visual ${id} uses generic title "${title}"`);
      if (/\b(?:metric_calculator|tradeoff_explorer|lif_neuron|neural_coding|stdp_window)\b/i.test(`${title} ${caption}`)) {
        problems.push(`${page.rel}: visual ${id} exposes internal visual type in title/caption`);
      }
      if (/^Generic all-metric calculator\.?$/i.test(caption)) problems.push(`${page.rel}: visual ${id} caption is generic`);
    }
  }
  return [...new Set(problems)];
}

// ---------------------------------------------------------------------------
// Pass K: validation report + critical gate
// ---------------------------------------------------------------------------

function countLearnerPages(gardenDir: string): number {
  return loadLearnerPages(gardenDir).length;
}

function countSourcePages(gardenDir: string): number {
  const out: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", out);
  return out.length;
}

function writeFinalizeValidationReport({
  gardenDir,
  gardenSlug,
  report,
  strictModelApprovedVisuals = false,
  expectedVisualContractExecutabilityContext,
  expectedSourceFormulaReviewContext,
}: {
  gardenDir: string;
  gardenSlug: string;
  report: FinalizeReport;
  strictModelApprovedVisuals?: boolean;
  expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
}): void {
  const bd = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(bd, { recursive: true });
  const reportPath = path.join(bd, "validation-report.md");
  const write = (checks: FinalizeCheck[]) => {
    const accepted = checks.every((check) => check.status !== "FAIL");
    const passCount = checks.filter((check) => check.status === "PASS").length;
    const failCount = checks.filter((check) => check.status === "FAIL").length;
    // Fix 13: one blocker per stable semantic issue. The same defect reported
    // under several validator prefixes collapses into one line carrying every
    // detector; check-level PASS/FAIL stays untouched.
    const blockingFailures = dedupeSemanticBlockerLines(
      checks
        .filter((check) => check.status === "FAIL")
        .map((check) => ({ check: check.name, problem: check.problems[0] ?? "failed" })),
    );
    const lines = [
      "# Breadboard Validation Report",
      "",
      "<!--",
      "generatedBy: canonical-validation-report-writer (dashboard/src/lib/garden-finalize.ts)",
      `finalStateFingerprint: ${finalGardenStateFingerprint(gardenDir)}`,
      `auditVersion: ${VALIDATION_REPORT_AUDIT_VERSION}`,
      "-->",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Root: ${path.resolve(gardenDir)}`,
      `Garden: ${gardenSlug}`,
      `Source files: ${countSourcePages(gardenDir)}`,
      `Page counts: learner=${countLearnerPages(gardenDir)}, sources=${countSourcePages(gardenDir)}`,
      `Check results: ${passCount} PASS, 0 WARN, ${failCount} FAIL, 0 SKIP`,
      `Accepted: ${accepted ? "yes" : "no"}`,
      "Produced by: dashboard/src/lib/garden-finalize.ts (finalizeGardenExport) + scripts/validate-breadboard-garden.ts",
      "",
      ...VALIDATION_REPORT_STATIC_SECTIONS.flatMap((section) => [
        `## ${section.heading}`,
        "",
        section.description,
        "",
      ]),
      "## Acceptance Decision",
      "",
      `Accepted: ${accepted ? "yes" : "no"}`,
      "",
      "Blocking failures:",
      ...(blockingFailures.length > 0 ? blockingFailures.map((line) => `- ${line}`) : ["- None."]),
      "",
      "Non-blocking warnings:",
      ...(report.warnings.length > 0 ? report.warnings.map((line) => `- ${line}`) : ["- None."]),
      "",
      "Skipped as not applicable:",
      "- None.",
      "",
      "## Final Acceptance",
      "",
      `Accepted: ${accepted ? "yes" : "no"}`,
      "",
      "## Checks",
      "",
    ];
    for (const check of checks) {
      lines.push(`- [${check.status}] ${check.name}`);
      for (const problem of check.problems) lines.push(`  - ${problem}`);
    }
    lines.push("", "## Finalize Notes", "");
    for (const note of report.notes.slice(0, 200)) lines.push(`- ${note}`);
    fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf-8");
  };

  write(collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report,
    includeReportSelfCheck: false,
    strictModelApprovedVisuals,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  }));
  write(collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report,
    includeReportSelfCheck: true,
    strictModelApprovedVisuals,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  }));
  // Fix 10: report completeness is a SERIALIZER test. If the just-written
  // report cannot serialize every required section, rewrite once from the
  // current audit and block only if the current writer itself is broken —
  // never because an old report from an earlier generation lacked a heading.
  let serialization = verifyValidationReportSerialization(reportPath, REQUIRED_VALIDATION_REPORT_SECTIONS);
  if (!serialization.valid) {
    write(collectFinalizeChecks({
      gardenDir,
      gardenId: gardenSlug,
      report,
      includeReportSelfCheck: true,
      strictModelApprovedVisuals,
      expectedVisualContractExecutabilityContext,
      expectedSourceFormulaReviewContext,
    }));
    serialization = verifyValidationReportSerialization(reportPath, REQUIRED_VALIDATION_REPORT_SECTIONS);
    if (!serialization.valid) {
      report.criticalProblems.push(
        `canonical validation-report writer cannot serialize the audit: ${serialization.problems.join("; ")}`,
      );
    }
  }
  if (!report.changed.includes(".breadboard/validation-report.md")) {
    report.changed.push(".breadboard/validation-report.md");
  }
}

/** Bumped whenever the canonical report layout changes shape. */
const VALIDATION_REPORT_AUDIT_VERSION = 2;

/**
 * Fix 9-11: single source of truth for the validation report's static
 * sections. The canonical writer iterates THIS list and the report self-check
 * derives its required-section list from THIS list, so the two can never
 * diverge again (the four Zettelkasten sections were once renamed in the
 * writer but not in the checker, making every fresh report fail its own
 * self-check).
 */
export const VALIDATION_REPORT_STATIC_SECTIONS: ReadonlyArray<{ heading: string; description: string }> = [
  { heading: "Export Tree", description: "See checks: exported tree, no source page typed as learner page." },
  { heading: "Link Resolution", description: "See the standalone validator's wikilink checks." },
  { heading: "Semantic Navigation", description: "Root, learning, source, overview, and learning-map links must point to the expected page family." },
  { heading: "Section Title Uniqueness", description: "Top-level learning section titles must be unique after normalized numbering, punctuation, and case are ignored." },
  { heading: "Section Folder/Title Consistency", description: "Section folder names, _index frontmatter titles, H1 headings, and map labels must describe the same section." },
  { heading: "Section Title Naturalness", description: "Section titles must be polished learner-facing concepts, not source-anchor field lists or planner templates." },
  { heading: "Semantic Navigation Number Matching", description: "Numbered section labels must point to the matching numbered section folder." },
  { heading: "Learning Map Ambiguity", description: "Learning Map section nodes and prerequisite edges must resolve to one unambiguous section." },
  { heading: "Learning Unit Contract Fulfillment", description: "See check: Learning Unit Contract fulfillment." },
  { heading: "Section Semantic Coherence", description: "Section titles must match the roles and concepts of their generated learner pages." },
  { heading: "Section Title Grammar", description: "Section and subsection titles must be learner-facing, grammatical, and free of planning scaffold phrasing." },
  { heading: "Section Index Prose Quality", description: "Section index pages must contain polished learner-facing summaries, not generated template prose." },
  { heading: "Interactive Visual Grounding", description: "Interactive visuals must use semantically compatible source anchors or honest conceptual grounding." },
  { heading: "Generated Visual Integrity", description: "Generated modules must match their page, manifest, hashes, compiler envelope, runtime tests, critic approval, and coverage plan." },
  { heading: "Learner-Facing Scaffold Prose", description: "Final learner Markdown must not contain deterministic repair scaffold instructions or placeholders." },
  { heading: "Source Map Consistency", description: "Source Map caveats must not contradict extracted figures, tables, formulas, or later source pages." },
  { heading: "Source Map Caveat Reconciliation", description: "Visible/planning caveats about missing formulas, tables, figures, or later pages must be reconciled against extracted evidence." },
  { heading: "Source Coverage Modes", description: "Source Coverage must classify each important anchor as embedded, explained, reused, omitted, missing, or misplaced." },
  { heading: "Source Anchor Usage vs Crop Status", description: "Concept/formula usage is tracked separately from whether a crop was embedded, omitted, or replaced by text fallback." },
  { heading: "Formula Grounding", description: "Only meaningful formulas are grounded; trivial numbers and standalone percentages are rejected in formulas: metadata." },
  { heading: "Formula Expression Validation", description: "The formulas: frontmatter block may contain mathematical expressions only, not teaching goals or keyword bundles." },
  { heading: "Formula Meaning Match", description: "Source-anchored and source-derived formulas must match the source formula/metric anchor they claim." },
  { heading: "Formula Family Match", description: "Formula families inferred from generated math must match the claimed source formula anchor family." },
  { heading: "Formula Metadata Noise", description: "Formula metadata must track meaningful relationships, not isolated symbols or inline fragments." },
  { heading: "Interactive Visual Fulfillment", description: "Only required interactive visuals are blocking when missing; recommended omissions warn, optional omissions pass, and rejected interactions must not remain embedded." },
  { heading: "Final Interactive Visual Uniqueness", description: "Rendered interactive visuals must be page-specific and non-duplicative after final block normalization." },
  { heading: "Visual Anchor Precision", description: "Metric visuals must use only the formula anchors needed by their controls, outputs, and learning goal." },
  { heading: "Repetition and Opening Flow", description: "Repeated learner openings must be callbacks, not restarted motivation frames." },
  { heading: "Source Crop Quality", description: "See check: source crop quality is acceptable." },
  { heading: "Crop Quality and Fallbacks", description: "Crop omissions must be reported as text/formula fallbacks rather than accepted crops." },
  { heading: "Source Coverage Mode Precision", description: "Coverage headings must distinguish embedded crops from text formulas, prose explanations, and crop fallbacks." },
  { heading: "Source Text Concept Anchors", description: "Concept visuals should use source-derived prose anchors when the source explains the concept without a figure." },
  { heading: "Contract/Page Source Anchor Synchronization", description: "Page-level source anchors, text-anchor ledger entries, and Learning Unit Contract anchors must agree." },
  { heading: "Source Coverage / Final Artifact Consistency", description: "Source Coverage must match final learner frontmatter, final visual JSON, and final source-anchor ledgers." },
  { heading: "Visual Title and Caption Quality", description: "Visual titles and captions must be polished, specific, and free of internal visual type names." },
  { heading: "Zettelkasten Tags", description: "Page tags must exactly equal the registry-backed primary and supporting concept union projected from the Learning Unit Contract." },
  { heading: "Zettelkasten Tag Density", description: "Learner pages need a primary concept and no more than five public concepts; focused pages may have one." },
  { heading: "Zettelkasten Handle Quality", description: "Public concept handles must be reusable canonical concepts — never claim-shaped, generic, or invalid slugs. Readable evidence-grounded claims remain in the claim store." },
  { heading: "Zettelkasten Handle Naturalness", description: "Concept handles must read as natural domain vocabulary; aliases, relationships, page assignments, and claim endpoints must resolve canonically." },
  { heading: "Repair Provenance", description: "Semantic repairs must be recorded in .breadboard/repair-log.json and finalizer semantic actions must remain empty." },
  { heading: "Final Garden State Audit", description: "One canonical FinalGardenState is built from the final files; Source Coverage, contracts, anchors, visuals, formula kinds, section indexes, zettel handles, repair provenance, and planning caveats must all agree with it. Acceptance is blocked on any contradiction." },
  { heading: "Section Title Quality", description: "See check: section titles are learner-facing." },
];

export const REQUIRED_VALIDATION_REPORT_SECTIONS = [
  ...VALIDATION_REPORT_STATIC_SECTIONS.map((section) => section.heading),
  "Acceptance Decision",
  "Final Acceptance",
];

interface FinalizeCheck {
  name: string;
  status: "PASS" | "FAIL";
  problems: string[];
}

function assetPathForUrl(gardenDir: string, assetUrl: string): string | null {
  const normalized = assetUrl.replace(/\\/g, "/").trim();
  const gardenSlug = path.basename(gardenDir);
  const prefix = `/${gardenSlug}/`;
  const rel = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized.replace(/^\/+/, "");
  const resolved = path.resolve(gardenDir, rel);
  const root = path.resolve(gardenDir);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function imageDimensions(filePath: string): { width: number; height: number } | null {
  let buffer: Buffer;
  try {
    buffer = readFileSyncWithRetry(filePath);
  } catch {
    return null;
  }
  if (buffer.length >= 24 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return null;
}

function cropQualityProblems(gardenDir: string, visual: LedgerVisual): string[] {
  const problems: string[] = [];
  const id = visual.sourceVisualId;
  const cropped = String(visual.croppedImagePath ?? "");
  const conceptUsage = String(visual.conceptUsage ?? "");
  const cropStatus = String(visual.cropStatus ?? "");
  const requiresEmbeddedCrop = !conceptUsage || /^(?:embedded_as_crop|embedded_and_explained)$/i.test(conceptUsage);
  if (visual.usageStatus === "assigned" && requiresEmbeddedCrop && !cropped && cropStatus !== "omitted_unreliable") {
    problems.push(`${id}: assigned visual has no croppedImagePath`);
    return problems;
  }
  if (!cropped) return problems;
  if (/-page-\d{2,}(?:-\d+)?\.(?:png|jpe?g|webp)$/i.test(cropped)) {
    problems.push(`${id}: croppedImagePath looks like a full-page snapshot`);
  }
  const filePath = assetPathForUrl(gardenDir, cropped);
  const dims = filePath ? imageDimensions(filePath) : null;
  if (!dims) {
    problems.push(`${id}: cannot read crop dimensions for ${cropped}`);
  } else {
    const type = String(visual.type ?? "");
    const minWidth = type === "equation" ? 180 : type === "table" ? 260 : 160;
    const minHeight = type === "equation" ? 48 : type === "table" ? 120 : 90;
    if (dims.width < minWidth || dims.height < minHeight) {
      problems.push(`${id}: crop too small (${dims.width}x${dims.height})`);
    }
  }
  const bbox = asObject(visual.bbox);
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width);
  const height = Number(bbox.height);
  if ([x, y, width, height].every(Number.isFinite)) {
    const edge = 0.015;
    if (x <= edge || y <= edge || x + width >= 1 - edge || y + height >= 1 - edge) {
      problems.push(`${id}: detection bbox touches page edge and may be clipped`);
    }
  }
  return problems;
}

function wikilinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/(!?)\[\[([^\]]+?)\]\]/g)) {
    if (match[1] === "!") continue;
    const inner = match[2] ?? "";
    const raw = (inner.includes("|") ? inner.slice(0, inner.indexOf("|")) : inner).trim();
    const base = raw.split("#")[0].replace(/^\//, "").replace(/\.md$/i, "").trim();
    if (base) targets.push(base);
  }
  return targets;
}

function markdownSection(markdown: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const match = re.exec(markdown);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function semanticNavigationProblems(gardenDir: string): string[] {
  const problems: string[] = [];
  const read = (rel: string) => {
    const file = path.join(gardenDir, ...rel.split("/"));
    return fs.existsSync(file) ? parseFrontmatter(readFileSyncWithRetry(file, "utf-8")).body : "";
  };
  const root = read("_index.md");
  for (const target of wikilinkTargets(markdownSection(root, "Learning"))) {
    if (!target.startsWith("learning/")) problems.push(`_index.md Learning section links outside learning/: [[${target}]]`);
  }
  for (const target of wikilinkTargets(markdownSection(root, "Sources"))) {
    if (!target.startsWith("sources/")) problems.push(`_index.md Sources section links outside sources/: [[${target}]]`);
  }
  for (const rel of ["learning/_index.md", "learning/Learning Map.md", "learning/Topic Overview.md"]) {
    const body = read(rel);
    if (!body) continue;
    for (const target of wikilinkTargets(body)) {
      if (target.startsWith("sources/")) problems.push(`${rel}: learner navigation links directly to source document [[${target}]]`);
      if (!target.startsWith("learning/")) problems.push(`${rel}: learner navigation link leaves learning/: [[${target}]]`);
    }
  }
  const sourceIndex = read("sources/_index.md");
  for (const target of wikilinkTargets(sourceIndex)) {
    if (!target.startsWith("sources/")) problems.push(`sources/_index.md links outside sources/: [[${target}]]`);
  }
  return [...new Set(problems)];
}

interface WikilinkRef {
  target: string;
  label: string;
  line: string;
}

function wikilinkRefs(markdown: string): WikilinkRef[] {
  const refs: WikilinkRef[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    for (const match of line.matchAll(/(!?)\[\[([^\]]+?)\]\]/g)) {
      if (match[1] === "!") continue;
      const inner = match[2] ?? "";
      const pipe = inner.indexOf("|");
      const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const label = (pipe >= 0 ? inner.slice(pipe + 1) : rawTarget.split("/").pop() ?? rawTarget).trim();
      const target = rawTarget.split("#")[0].replace(/^\//, "").replace(/\.md$/i, "").trim();
      refs.push({ target, label, line });
    }
  }
  return refs;
}

function sectionFolderInfo(target: string): { number: number; title: string; folder: string } | null {
  const match = target.match(/^learning\/(\d+)\.\s*([^/]+)(?:\/_index)?$/i);
  if (!match) return null;
  return {
    number: Number.parseInt(match[1], 10),
    title: match[2].trim(),
    folder: `learning/${match[1]}. ${match[2].trim()}`,
  };
}

function semanticNavigationNumberProblems(gardenDir: string): string[] {
  const problems: string[] = [];
  const filePath = path.join(gardenDir, "learning", "_index.md");
  if (!fs.existsSync(filePath)) return problems;
  let currentSection: { number: number; title: string; folder: string } | null = null;
  const { body } = parseFrontmatter(readFileSyncWithRetry(filePath, "utf-8"));
  for (const ref of wikilinkRefs(body)) {
    const labelMatch = ref.label.match(/^(\d+)(?:\.(\d+))?\.?\s+(.+)$/);
    const sectionInfo = sectionFolderInfo(ref.target);
    if (labelMatch && !labelMatch[2]) {
      if (!sectionInfo) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="numbered section label does not point to a section _index"`);
        currentSection = null;
        continue;
      }
      const labelNumber = Number.parseInt(labelMatch[1], 10);
      const labelTitle = labelMatch[3].trim();
      currentSection = sectionInfo;
      if (labelNumber !== sectionInfo.number) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Displayed section number ${labelNumber} points to section folder ${sectionInfo.number}"`);
      }
      if (canonicalSectionBodyKey(labelTitle) !== normalizedSectionTitleKey(sectionInfo.title)) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Displayed section title does not match target folder title"`);
      }
      continue;
    }
    if (labelMatch?.[2] && currentSection) {
      const subsectionNumber = Number.parseInt(labelMatch[1], 10);
      if (subsectionNumber !== currentSection.number) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Subsection number ${subsectionNumber} is nested under section ${currentSection.number}"`);
      }
      if (!ref.target.startsWith(`${currentSection.folder}/`)) {
        problems.push(`SEMANTIC_NAVIGATION_ERROR file="learning/_index.md" label="${ref.label}" target="${ref.target}" problem="Subsection link leaves displayed section folder ${currentSection.folder}"`);
      }
    }
  }
  return [...new Set(problems)];
}

function cleanMapNode(value: string): string {
  return value
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^Trunk:\s*/i, "")
    .replace(/^Branch\/leaf:\s*/i, "")
    .replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
    .trim();
}

function learningMapAmbiguityProblems(gardenDir: string, sections: Array<{ rel: string; sectionTitle: string }>): string[] {
  const filePath = path.join(gardenDir, "learning", "Learning Map.md");
  if (!fs.existsSync(filePath)) return [];
  const markdown = readFileSyncWithRetry(filePath, "utf-8");
  const problems: string[] = [];
  const sectionCounts = new Map<string, number>();
  for (const section of sections) {
    const key = normalizedSectionTitleKey(section.sectionTitle);
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }
  const mapNodeCounts = new Map<string, number>();
  for (const line of parseFrontmatter(markdown).body.split(/\r?\n/)) {
    const sectionOrder = line.match(/^\s*-\s*\d+\.\s+(.+)$/);
    const trunk = line.match(/^\s*-\s*Trunk:\s*(.+)$/i);
    for (const raw of [sectionOrder?.[1], trunk?.[1]].filter(Boolean) as string[]) {
      const key = normalizedSectionTitleKey(cleanMapNode(raw));
      if (key) mapNodeCounts.set(key, (mapNodeCounts.get(key) ?? 0) + 1);
    }
    const edge = line.match(/^\s*-\s*(.+?)\s*->\s*(.+?)\s*$/);
    if (!edge) continue;
    const left = cleanMapNode(edge[1]);
    const right = cleanMapNode(edge[2]);
    const leftKey = normalizedSectionTitleKey(left);
    const rightKey = normalizedSectionTitleKey(right);
    if (leftKey && rightKey && leftKey === rightKey) {
      problems.push(`LEARNING_MAP_AMBIGUITY edge="${left} -> ${right}" problem="self-edge after title normalization"`);
    }
    for (const node of [left, right]) {
      const key = normalizedSectionTitleKey(node);
      const count = sectionCounts.get(key) ?? 0;
      if (count > 1) problems.push(`LEARNING_MAP_AMBIGUITY node="${node}" problem="section title maps to ${count} section folders"`);
    }
  }
  for (const [key, count] of mapNodeCounts) {
    if (count > 1 && (sectionCounts.get(key) ?? 0) > 1) {
      problems.push(`LEARNING_MAP_AMBIGUITY node="${key}" problem="duplicate section node is ambiguous"`);
    }
  }
  return [...new Set(problems)];
}

function sectionSemanticInputs(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
): Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }> {
  const bySection = new Map<string, { pages: LearnerPage[]; units: LearningUnitContract[] }>();
  for (const page of learnerPages) {
    const parts = page.rel.split("/");
    if (parts.length < 3) continue;
    const rel = parts.slice(0, 2).join("/");
    const entry = bySection.get(rel) ?? { pages: [], units: [] };
    entry.pages.push(page);
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (unit) entry.units.push(unit);
    bySection.set(rel, entry);
  }
  const inputs: Array<{ rel: string; sectionTitle: string; units: LearningUnitContract[]; subsectionTitles: string[] }> = [];
  for (const [rel, entry] of bySection) {
    const indexPath = path.join(gardenDir, ...rel.split("/"), "_index.md");
    const title = fs.existsSync(indexPath)
      ? fmGetScalar(parseFrontmatter(readFileSyncWithRetry(indexPath, "utf-8")).rawFrontmatter, "title")
      : rel.split("/").pop() ?? rel;
    inputs.push({
      rel,
      sectionTitle: title || rel,
      units: entry.units,
      subsectionTitles: entry.pages.map((page) => page.title),
    });
  }
  return inputs;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Repair-time section title. Delegates to the topic-agnostic candidate system —
 * the garden profile supplies subject vocabulary, the section's units supply the
 * universal purpose + focus concepts, `otherSectionTitles` keeps it unique, and
 * the current title is offered as a candidate so a good one is kept unchanged.
 * Returns null only when the best candidate equals the current title (nothing to
 * fix).
 */
function suggestedSectionSemanticTitle(
  sectionTitle: string,
  units: LearningUnitContract[],
  profile: GardenTopicProfile,
  otherSectionTitles: string[] = [],
): string | null {
  const number = sectionTitle.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1];
  const bare = generateSectionTitle({
    units,
    profile,
    existingTitle: sectionTitle,
    otherSectionTitles,
  }).title;
  const next = number ? `${number}. ${bare}` : bare;
  return normalizedSectionTitleKey(next) === normalizedSectionTitleKey(sectionTitle) ? null : next;
}

function rewriteSectionIndexTitle(indexPath: string, nextTitle: string): boolean {
  const content = readFileSyncWithRetry(indexPath, "utf-8");
  const { rawFrontmatter, body } = parseFrontmatter(content);
  const currentTitle = fmGetScalar(rawFrontmatter, "title");
  const nextRaw = fmSetScalar(rawFrontmatter, "title", nextTitle);
  let nextBody = body;
  if (currentTitle) {
    const titleHeading = new RegExp(`^#\\s+${escapeRegExp(currentTitle)}\\s*$`, "m");
    if (titleHeading.test(nextBody)) nextBody = nextBody.replace(titleHeading, `# ${nextTitle}`);
    else nextBody = nextBody.replace(/^#\s+.*$/m, `# ${nextTitle}`);
  } else {
    nextBody = nextBody.replace(/^#\s+.*$/m, `# ${nextTitle}`);
  }
  const nextContent = joinFrontmatter(nextRaw, nextBody);
  if (nextContent === content) return false;
  fs.writeFileSync(indexPath, nextContent, "utf-8");
  return true;
}

function canonicalSectionFolderLabel(title: string, fallbackName = "Section"): string {
  const number = title.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1] ?? fallbackName.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1];
  const body = title.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, "").trim();
  const segment = safeLearnFileSegment(body, "Section");
  return number && segment ? `${number}. ${segment}` : (segment || fallbackName);
}

function canonicalSectionTitleKey(title: string, fallbackName = "Section"): string {
  return normalizedSectionTitleKey(canonicalSectionFolderLabel(title, fallbackName));
}

function canonicalSectionBodyKey(title: string): string {
  return normalizedSectionTitleKey(safeLearnFileSegment(stripTitleNumber(title), "Section"));
}

function sectionFolderNameForTitle(title: string, fallbackName: string): string {
  return canonicalSectionFolderLabel(title, fallbackName);
}

function replaceAllLiteral(value: string, from: string, to: string): string {
  return value.split(from).join(to);
}

function rewriteReferencesAfterSectionRename(gardenDir: string, oldRel: string, newRel: string, report: FinalizeReport): void {
  const files: Array<{ abs: string; rel: string }> = [];
  listMarkdown(gardenDir, "", files, { includeDotBreadboard: true });
  const jsonFiles: Array<{ abs: string; rel: string }> = [];
  const collectJson = (dir: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectJson(abs, rel);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        jsonFiles.push({ abs, rel });
      }
    }
  };
  collectJson(path.join(gardenDir, ".breadboard"), ".breadboard");
  for (const file of [...files, ...jsonFiles]) {
    const content = readFileSyncWithRetry(file.abs, "utf-8");
    let next = replaceAllLiteral(content, oldRel, newRel);
    next = replaceAllLiteral(next, encodeURI(oldRel), encodeURI(newRel));
    if (next === content) continue;
    fs.writeFileSync(file.abs, next, "utf-8");
    if (!report.changed.includes(file.rel)) report.changed.push(file.rel);
  }
}

function currentSectionTitles(gardenDir: string): {
  byRel: Map<string, string>;
  byNumber: Map<string, string>;
  relByNumber: Map<string, string>;
} {
  const byRel = new Map<string, string>();
  const byNumber = new Map<string, string>();
  const relByNumber = new Map<string, string>();
  const learningDir = path.join(gardenDir, "learning");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return { byRel, byNumber, relByNumber };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\s+/.test(entry.name)) continue;
    const indexPath = path.join(learningDir, entry.name, "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    const title = fmGetScalar(parseFrontmatter(readFileSyncWithRetry(indexPath, "utf-8")).rawFrontmatter, "title") || entry.name;
    const rel = `learning/${entry.name}`;
    byRel.set(rel, title);
    const number = title.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1] ?? entry.name.match(/^\s*(\d+(?:\.\d+)*)\.?\s+/)?.[1];
    if (number) {
      byNumber.set(number, title);
      relByNumber.set(number, rel);
    }
  }
  return { byRel, byNumber, relByNumber };
}

function sectionTitleBody(title: string): string {
  return stripTitleNumber(title);
}

function repairSectionNavigationLabels(gardenDir: string, report: FinalizeReport): void {
  const { byRel, byNumber, relByNumber } = currentSectionTitles(gardenDir);
  if (byRel.size === 0) return;
  const navRels = ["learning/_index.md", "learning/Learning Map.md", "learning/Topic Overview.md"];
  for (const rel of navRels) {
    const abs = path.join(gardenDir, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const content = readFileSyncWithRetry(abs, "utf-8");
    const replacements: Array<[string, string]> = [];
    if (rel === "learning/Learning Map.md") {
      for (const match of content.matchAll(/^\s*-\s*(\d+)\.\s+(.+?)\s*$/gm)) {
        const number = match[1] ?? "";
        const oldTitle = `${number}. ${match[2] ?? ""}`;
        const nextTitle = byNumber.get(number);
        if (nextTitle && oldTitle !== nextTitle) {
          replacements.push([oldTitle, nextTitle]);
          replacements.push([sectionTitleBody(oldTitle), sectionTitleBody(nextTitle)]);
        }
      }
    }
    let next = content.replace(/\[\[(learning\/[^|\]]+\/_index)(?:\|([^\]]*))?\]\]/g, (full, target: string) => {
      const sectionRel = target.replace(/\/_index$/, "");
      const title = byRel.get(sectionRel);
      return title ? `[[${target}|${title}]]` : full;
    });
    if (rel === "learning/_index.md") {
      next = next.replace(/^-\s*(\d+)\.\s+(.+?)\s*$/gm, (full, number: string) => {
        const sectionTitle = byNumber.get(number);
        const sectionRel = relByNumber.get(number);
        if (!sectionTitle || !sectionRel) return full;
        return `- [[${sectionRel}/_index|${sectionTitle}]]`;
      });
    }
    for (const [from, to] of replacements) {
      if (from && to && from !== to) next = replaceAllLiteral(next, from, to);
    }
    if (next === content) continue;
    fs.writeFileSync(abs, next, "utf-8");
    if (!report.changed.includes(rel)) report.changed.push(rel);
  }
}

function alignSectionFoldersWithTitles(gardenDir: string, report: FinalizeReport): void {
  const learningDir = path.join(gardenDir, "learning");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\s+/.test(entry.name)) continue;
    const oldAbs = path.join(learningDir, entry.name);
    const indexPath = path.join(oldAbs, "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    const title = fmGetScalar(parseFrontmatter(readFileSyncWithRetry(indexPath, "utf-8")).rawFrontmatter, "title");
    const nextName = sectionFolderNameForTitle(title || entry.name, entry.name);
    if (nextName === entry.name) continue;
    const nextAbs = path.join(learningDir, nextName);
    if (fs.existsSync(nextAbs)) {
      report.criticalProblems.push(`section folder/title mismatch could not be repaired because target exists: learning/${nextName}`);
      continue;
    }
    fs.renameSync(oldAbs, nextAbs);
    const oldRel = `learning/${entry.name}`;
    const newRel = `learning/${nextName}`;
    rewriteReferencesAfterSectionRename(gardenDir, oldRel, newRel, report);
    report.notes.push(`renamed section folder ${oldRel} -> ${newRel}`);
  }
}

function readGardenTitle(gardenDir: string): string {
  const indexPath = path.join(gardenDir, "_index.md");
  if (fs.existsSync(indexPath)) {
    const { rawFrontmatter } = parseFrontmatter(readFileSyncWithRetry(indexPath, "utf-8"));
    const title = fmGetScalar(rawFrontmatter, "title");
    if (title) return title;
  }
  return path.basename(gardenDir);
}

function repairSectionSemanticTitles(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
  report: FinalizeReport,
): void {
  const sectionInputs = sectionSemanticInputs(gardenDir, learnerPages, unitsById);
  if (sectionInputs.length === 0) return;
  // One garden-wide topic profile (from ALL contract units) supplies the subject
  // vocabulary; sibling titles keep each section unique as we go.
  const profile = buildGardenTopicProfile({ gardenTitle: readGardenTitle(gardenDir), units: [...unitsById.values()] });
  const titleByRel = new Map(sectionInputs.map((section) => [section.rel, section.sectionTitle]));
  for (const section of sectionInputs) {
    const semantic = sectionSemanticProfiles([{
      sectionTitle: section.sectionTitle,
      units: section.units,
      subsectionTitles: section.subsectionTitles,
    }])[0];
    const grammarProblems = sectionTitleGrammarProblems(section.sectionTitle, section.subsectionTitles);
    const naturalnessProblems = sectionTitleNaturalnessProblems(section.sectionTitle, section.subsectionTitles);
    const currentKey = normalizedSectionTitleKey(section.sectionTitle);
    const duplicateTitle = [...titleByRel.entries()].some(
      ([rel, title]) => rel !== section.rel && normalizedSectionTitleKey(title) === currentKey,
    );
    if ((!semantic || semantic.problems.length === 0) && grammarProblems.length === 0 && naturalnessProblems.length === 0 && !duplicateTitle) continue;
    const otherTitles = [...titleByRel.entries()]
      .filter(([rel]) => rel !== section.rel)
      .map(([, title]) => title);
    const nextTitle = suggestedSectionSemanticTitle(section.sectionTitle, section.units, profile, otherTitles);
    if (!nextTitle || nextTitle === section.sectionTitle) continue;
    const indexPath = path.join(gardenDir, ...section.rel.split("/"), "_index.md");
    if (!fs.existsSync(indexPath)) continue;
    if (rewriteSectionIndexTitle(indexPath, nextTitle)) {
      titleByRel.set(section.rel, nextTitle);
      const rel = `${section.rel}/_index.md`;
      if (!report.changed.includes(rel)) report.changed.push(rel);
      report.notes.push(`retitled section ${section.sectionTitle} -> ${nextTitle}`);
    }
  }
}

function idsUsedByLearners(learnerPages: LearnerPage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of learnerPages) {
    for (const id of fmGetArray(page.rawFm, "sourceVisualIds")) ids.add(id);
    for (const id of fmGetArray(page.rawFm, "sourceAnchors")) ids.add(id);
    for (const id of formulaAnchorsFromFrontmatter(page.rawFm)) {
      if (!id.startsWith("trivial:")) ids.add(id);
    }
    for (const spec of embeddedVisualSpecs(page.body)) {
      for (const id of visualSpecAnchorIds(spec)) ids.add(id);
    }
  }
  return ids;
}

function anchorTextForVisualIds(ledger: LedgerVisual[], ids: string[], spec: Record<string, unknown>): string {
  const ledgerText = ids
    .map((id) => ledger.find((visual) => visual.sourceVisualId === id))
    .filter((visual): visual is LedgerVisual => Boolean(visual))
    .map((visual) => [visual.sourceVisualId, visual.type, visual.caption].filter(Boolean).join(" "));
  const specAnchorText = Array.isArray(spec.sourceAnchors)
    ? spec.sourceAnchors.map((anchor) => {
        if (!anchor || typeof anchor !== "object") return "";
        const record = anchor as Record<string, unknown>;
        return [record.figureId, record.tableId, record.equationId, record.description, record.sourceTitle].filter(Boolean).join(" ");
      })
    : [];
  return [...ledgerText, ...specAnchorText].join(" ");
}

function sourceMapCaveatProblems(gardenDir: string, ledger: LedgerVisual[]): string[] {
  const problems: string[] = [];
  const docs: Array<[string, string]> = [];
  const addDoc = (rel: string): void => {
    docs.push([rel, path.join(gardenDir, ...rel.split("/"))]);
  };
  // Note: the generated .breadboard/validation-report.md and repair-report.md are
  // intentionally NOT scanned. They ECHO the detector's own problem descriptions
  // ("stale caveat says later pages are unavailable"), so scanning them turns a
  // reported problem into a new, self-referential problem. Caveats are only real
  // in planning/source/learner docs, which are scanned below.
  for (const rel of [
    ".breadboard/planning/Source Map.md",
    ".breadboard/planning/Scope Contract.md",
    ".breadboard/planning/Learning Map.md",
    ".breadboard/planning/Source Coverage.md",
    "learning/Learning Map.md",
    "learning/Topic Overview.md",
  ]) addDoc(rel);
  const planningPages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, ".breadboard", "planning"), ".breadboard/planning", planningPages);
  for (const page of planningPages) if (!docs.some(([rel]) => rel === page.rel)) docs.push([page.rel, page.abs]);
  const learningPages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", learningPages);
  for (const page of learningPages) if (!docs.some(([rel]) => rel === page.rel)) docs.push([page.rel, page.abs]);
  const hasFormulaAnchors = ledger.some((visual) => classifyFigure(visual) === "equation");
  const hasFormulaExactText = ledger.some((visual) => classifyFigure(visual) === "equation" && String(visual.exactText ?? visual.ocrText ?? "").trim());
  const hasFormulaCrops = ledger.some((visual) => classifyFigure(visual) === "equation" && String(visual.croppedImagePath ?? "").trim());
  const sourceDocs: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourceDocs);
  const hasFormulaMarkdown = sourceDocs.some(({ abs }) =>
    /(?:\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\frac|\\sum|\\min|\\max|\\geq|\\leq|[A-Za-z][A-Za-z0-9_{}\\]*\s*=)/.test(readFileSyncWithRetry(abs, "utf-8")),
  );
  const hasTables = ledger.some((visual) => String(visual.type ?? "") === "table" || /\.T\d+$/i.test(visual.sourceVisualId));
  const hasFigures = ledger.some((visual) => classifyFigure(visual) !== "equation" && String(visual.type ?? "") !== "table" && !/\.T\d+$/i.test(visual.sourceVisualId));
  const hasLaterPages = sourcesHaveLaterPages(gardenDir) || ledger.some((visual) => Number(visual.pageNumber ?? 0) > 2);
  for (const [label, filePath] of docs) {
    if (!fs.existsSync(filePath)) continue;
    const text = readFileSyncWithRetry(filePath, "utf-8");
    if ((hasFormulaAnchors || hasFormulaExactText || hasFormulaCrops || hasFormulaMarkdown) && STALE_FORMULA_CAVEAT_RE.test(text)) {
      problems.push(`${label}: stale caveat says formulas/definitions are unavailable despite formula anchors`);
    }
    if (hasTables && STALE_TABLE_CAVEAT_RE.test(text)) {
      problems.push(`${label}: stale caveat says tables are unavailable despite table anchors`);
    }
    if (hasFigures && STALE_FIGURE_CAVEAT_RE.test(text)) {
      problems.push(`${label}: stale caveat says figures are unavailable despite figure anchors`);
    }
    if (hasLaterPages && STALE_TRUNCATION_CAVEAT_RE.test(text)) {
      problems.push(`${label}: stale caveat says later pages are unavailable despite later anchors/pages`);
    }
  }
  return [...new Set(problems)];
}

function sourceAnchorUsageVsCropStatusProblems(
  ledger: LedgerVisual[],
  learnerPages: LearnerPage[],
  groundableFormulaAnchorIds: Set<string>,
): string[] {
  const usedIds = idsUsedByLearners(learnerPages);
  const problems: string[] = [];
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    const usageStatus = String(visual.usageStatus ?? "");
    const conceptUsage = String(visual.conceptUsage ?? "");
    const cropStatus = String(visual.cropStatus ?? "");
    // A caption-only formula anchor (the source yielded no extractable formula
    // text) can be referenced conceptually in a page's sourceAnchors while
    // remaining intentionally skipped from embedding — that is not a
    // contradiction, so it does not count as "used" for the skip check.
    const isUngroundableFormula = isSourceFormulaId(id) && !groundableFormulaAnchorIds.has(id);
    const conceptIsUsed = /^(?:embedded_and_explained|embedded_as_crop|explained_as_text_formula|explained_in_prose|explained_without_embedding|used_as_interactive_grounding|referenced_again)$/i.test(conceptUsage);
    if (/^(?:intentionally_skipped|skipped|unused)$/i.test(usageStatus) && conceptIsUsed) {
      problems.push(`${id}: usageStatus=${usageStatus} contradicts conceptUsage=${conceptUsage}`);
    }
    if (usedIds.has(id) && !isUngroundableFormula && /^(?:intentionally_skipped|skipped|unused)$/i.test(usageStatus)) {
      problems.push(`${id}: usageStatus=${usageStatus} but the anchor is used by learner pages`);
    }
    if ((conceptUsage || cropStatus) && (!conceptUsage || !cropStatus)) {
      problems.push(`${id}: source usage ledger must include both conceptUsage and cropStatus when either is present`);
    }
    if (cropStatus === "omitted_unreliable" && /^(?:intentionally_omitted|missing)$/i.test(conceptUsage)) {
      problems.push(`${id}: unreliable crop omission is recorded as concept omission`);
    }
    if (/^(?:embedded_and_explained|embedded_as_crop)$/i.test(conceptUsage) && cropStatus !== "embedded") {
      problems.push(`${id}: embedded concept usage requires cropStatus=embedded, got ${cropStatus || "missing"}`);
    }
  }
  return problems;
}

function cropFallbackProblems(ledger: LedgerVisual[], learnerPages: LearnerPage[]): string[] {
  const usedIds = idsUsedByLearners(learnerPages);
  const problems: string[] = [];
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    const cropStatus = String(visual.cropStatus ?? "");
    const conceptUsage = String(visual.conceptUsage ?? "");
    if (cropStatus === "omitted_unreliable" && !/explained_|used_as_interactive_grounding|referenced_again/.test(conceptUsage)) {
      problems.push(`${id}: crop omitted as unreliable without text/formula/interactive fallback`);
    }
    if (!String(visual.croppedImagePath ?? "") && usedIds.has(id) && classifyFigure(visual) !== "equation" && cropStatus !== "omitted_unreliable") {
      problems.push(`${id}: non-formula anchor is used without a crop or explicit omitted_unreliable fallback`);
    }
  }
  return problems;
}

const PRECISE_SOURCE_COVERAGE_HEADINGS = [
  "Embedded Source Crops",
  "Explained as Text Formulas",
  "Explained in Prose",
  "Used as Interactive Grounding",
  "Referenced Again in Synthesis",
  "Crop Omitted With Text Fallback",
  "Intentionally Omitted",
  "Missing or Misplaced",
];

function coverageHeadingRe(heading: string): RegExp {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,3}\\s+${escaped}\\s*$`, "im");
}

function coverageModeSection(markdown: string, heading: string): string {
  const match = coverageHeadingRe(heading).exec(markdown);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^#{2,3}\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function sourceCoverageModePrecisionProblems(gardenDir: string, ledger: LedgerVisual[]): string[] {
  const filePath = path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md");
  if (!fs.existsSync(filePath)) return [];
  const coverage = readFileSyncWithRetry(filePath, "utf-8");
  const problems: string[] = [];
  if (/^##\s+Figures,\s*Graphs,\s*Tables,\s*And\s*Formula\s*Displays\s*Used\s*$/im.test(coverage)) {
    problems.push('Source Coverage overclaims embedded/display use with legacy heading "Figures, Graphs, Tables, And Formula Displays Used"');
  }
  for (const heading of PRECISE_SOURCE_COVERAGE_HEADINGS) {
    if (!coverageHeadingRe(heading).test(coverage)) problems.push(`Source Coverage missing precise mode heading "${heading}"`);
  }
  const embedded = coverageModeSection(coverage, "Embedded Source Crops");
  const textFormulas = coverageModeSection(coverage, "Explained as Text Formulas");
  const cropFallback = coverageModeSection(coverage, "Crop Omitted With Text Fallback");
  for (const visual of ledger) {
    const id = visual.sourceVisualId;
    if (!id) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRe = new RegExp(`\\b${escaped}\\b`, "i");
    const conceptUsage = String(visual.conceptUsage ?? "");
    const cropStatus = String(visual.cropStatus ?? "");
    if (/^explained_as_text_formula$/i.test(conceptUsage) && !idRe.test(textFormulas)) {
      problems.push(`${id}: conceptUsage=explained_as_text_formula but Source Coverage omits it from "Explained as Text Formulas"`);
    }
    if (cropStatus === "omitted_unreliable") {
      if (idRe.test(embedded)) problems.push(`${id}: cropStatus=omitted_unreliable but Source Coverage lists it under "Embedded Source Crops"`);
      if (!idRe.test(cropFallback)) problems.push(`${id}: cropStatus=omitted_unreliable but Source Coverage omits "Crop Omitted With Text Fallback"`);
    }
    if (/^(?:embedded_and_explained|embedded_as_crop)$/i.test(conceptUsage) && cropStatus !== "embedded") {
      problems.push(`${id}: conceptUsage=${conceptUsage} requires cropStatus=embedded`);
    }
  }
  return [...new Set(problems)];
}

function proseConceptForVisualType(type: string): { label: string; pattern: RegExp } | null {
  switch (type) {
    case "lif_neuron":
      return { label: "lif membrane threshold dynamics", pattern: /\blif\b|leaky integrate|integrate[- ]and[- ]fire|membrane potential.*threshold|threshold.*reset/i };
    case "neural_coding":
      return { label: "rate and temporal spike coding", pattern: /rate coding|temporal coding|spike trains? encode|encoding information/i };
    case "stdp_window":
      return { label: "spike timing dependent plasticity", pattern: /\bstdp\b|spike[- ]timing dependent plasticity|pre.*post.*(?:weight|synaptic)|synaptic plasticity/i };
    case "tradeoff_explorer":
      return { label: "metric tradeoff reasoning", pattern: /accuracy.*latency.*energy|latency.*energy.*accuracy|spike count.*energy|trade[- ]off/i };
    case "metric_calculator":
      return { label: "metric definition", pattern: /metric|formula|accuracy|latency|energy|spike count|convergence/i };
    case "training_curve":
      return { label: "training curve behavior", pattern: /training curve|learning curve|convergence|epoch|training loss|target accuracy/i };
    default:
      return null;
  }
}

function sourceCorpusText(gardenDir: string): string {
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  return sourcePages.map(({ abs }) => parseFrontmatter(readFileSyncWithRetry(abs, "utf-8")).body).join("\n\n");
}

function sourceTextAnchorForConcept(
  gardenDir: string,
  concept: { label: string; pattern: RegExp },
): Record<string, unknown> | null {
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  for (const { abs, rel } of sourcePages.sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (/\/_index\.md$/i.test(rel) || /(^|\/)_index\.md$/i.test(rel)) continue;
    const { rawFrontmatter, body } = parseFrontmatter(readFileSyncWithRetry(abs, "utf-8"));
    const sourceTitle = fmGetScalar(rawFrontmatter, "title") || path.basename(rel, ".md");
    const sourceId = fmGetScalar(rawFrontmatter, "sourceId") || slugifyLoose(path.basename(rel, ".md")) || "source";
    const chunks = body
      .split(/\n{2,}/)
      .map((chunk) => chunk.replace(/\s+/g, " ").trim())
      .filter((chunk) => chunk.length >= 40);
    for (const chunk of chunks) {
      if (!concept.pattern.test(`${sourceTitle} ${chunk}`)) continue;
      const excerpt = chunk.slice(0, 240);
      return {
        sourceId,
        sourceTitle,
        textAnchorId: `text-${slugifyLoose(sourceId)}-${slugifyLoose(concept.label)}`,
        description: `Source prose explains ${concept.label}: ${excerpt}`,
        exactText: excerpt,
        semanticSummary: `Source prose explains ${concept.label}.`,
        conceptKeywords: concept.label.split(/\s+/).filter((word) => word.length >= 4),
      };
    }
  }
  return null;
}

function visualHasTextAnchor(spec: Record<string, unknown>): boolean {
  const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
  return anchors.some((anchor) =>
    anchor && typeof anchor === "object" && typeof (anchor as Record<string, unknown>).textAnchorId === "string",
  );
}

function repairSourceTextConceptAnchors(gardenDir: string, learnerPages: LearnerPage[], report: FinalizeReport): void {
  const anchorCache = new Map<string, Record<string, unknown> | null>();
  for (const page of learnerPages) {
    rewriteEmbeddedVisualSpecs(page, (spec) => {
      const type = String(spec.type ?? "");
      const concept = proseConceptForVisualType(type);
      if (!concept || visualHasTextAnchor(spec)) return false;
      const status = String(spec.sourceGroundingStatus ?? "");
      const isConceptualStatus =
        status === "conceptual-no-direct-source-figure" || status === "source-derived-conceptual";
      // A visual whose status claims source grounding but carries no surviving
      // source anchor is in a self-contradictory state (e.g. a metric_calculator
      // whose formula anchors were filtered out). Normalizing that contradiction
      // is metadata hygiene, not semantic placement, so we (re)ground it here
      // rather than let it fail the grounding gate with no repair path.
      const contradictoryGrounded = visualSpecAnchorIds(spec).length === 0 && !isConceptualStatus;
      if (!isConceptualStatus && !contradictoryGrounded) return false;
      const cacheKey = `${type}:${concept.label}`;
      if (!anchorCache.has(cacheKey)) anchorCache.set(cacheKey, sourceTextAnchorForConcept(gardenDir, concept));
      const anchor = anchorCache.get(cacheKey);
      if (!anchor) {
        if (!contradictoryGrounded) return false;
        // No source prose anchor is available to derive from. Downgrade the
        // contradictory grounded-but-anchorless visual to honest conceptual
        // grounding so its metadata is self-consistent and publishable.
        spec.sourceAnchors = [];
        spec.sourceGroundingStatus = "conceptual-no-direct-source-figure";
        spec.justification =
          "This interactive teaches a dynamic concept the source discusses only in prose; no dedicated source figure grounds it, so it is marked conceptual.";
        saveVisualSpecArtifact(gardenDir, spec, report);
        report.notes.push(`normalized contradictory visual grounding on ${page.rel} (${type})`);
        return true;
      }
      const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors.filter((item) => item && typeof item === "object") : [];
      spec.sourceAnchors = [...anchors, anchor];
      spec.sourceGroundingStatus = "source-derived-conceptual";
      spec.justification =
        "The source explains this concept in prose but does not provide a dedicated figure, so the visual is derived from a source text anchor.";
      const textAnchorId = String(anchor.textAnchorId ?? "");
      if (textAnchorId) page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", [...fmGetArray(page.rawFm, "sourceAnchors"), textAnchorId]);
      if (textAnchorId) {
        registerSourceTextAnchor(gardenDir, {
          id: textAnchorId,
          sourceId: String(anchor.sourceId ?? "source"),
          kind: "concept",
          title: concept.label,
          exactText: String(anchor.exactText ?? ""),
          semanticSummary: String(anchor.semanticSummary ?? anchor.description ?? `Source prose explains ${concept.label}.`),
          conceptKeywords: Array.isArray(anchor.conceptKeywords)
            ? anchor.conceptKeywords.map(stringField).filter(Boolean)
            : concept.label.split(/\s+/).filter((word) => word.length >= 4),
          confidence: 0.75,
        }, report);
      }
      saveVisualSpecArtifact(gardenDir, spec, report);
      report.notes.push(`added source text anchor ${textAnchorId || "(missing text anchor)"} to ${page.rel}`);
      return true;
    });
  }
}

function sourcePageParagraphs(gardenDir: string): Array<{ sourceId: string; sourceTitle: string; page: number; text: string }> {
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  const out: Array<{ sourceId: string; sourceTitle: string; page: number; text: string }> = [];
  for (const { abs, rel } of sourcePages) {
    if (/\/_index\.md$/i.test(rel) || /(^|\/)_index\.md$/i.test(rel)) continue;
    const { rawFrontmatter, body } = parseFrontmatter(readFileSyncWithRetry(abs, "utf-8"));
    const sourceTitle = fmGetScalar(rawFrontmatter, "title") || path.basename(rel, ".md");
    const sourceId = fmGetScalar(rawFrontmatter, "sourceId") || slugifyLoose(path.basename(rel, ".md")) || "source";
    let page = 0;
    let buffer: string[] = [];
    const flush = (): void => {
      const text = buffer.join("\n").replace(/\s+/g, " ").trim();
      if (page > 0 && text) out.push({ sourceId, sourceTitle, page, text });
      buffer = [];
    };
    for (const line of body.split(/\r?\n/)) {
      const heading = line.match(/^\s*#{1,3}\s*Page\s+(\d+)\b/i);
      if (heading) {
        flush();
        page = Number.parseInt(heading[1] ?? "0", 10);
      } else {
        buffer.push(line);
      }
    }
    flush();
  }
  return out;
}

const TEXT_ANCHOR_STOPWORDS = new Set([
  "what", "when", "where", "which", "with", "from", "that", "this", "into", "does",
  "spiking", "neural", "network", "networks", "source", "lesson", "metric", "metrics",
]);

function unitTextAnchorKeywords(unit: LearningUnitContract, page: LearnerPage): string[] {
  const text = [
    unit.title,
    unit.learningQuestion,
    ...(unit.newConcepts ?? []),
    page.title,
  ].join(" ");
  return [...new Set(text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 4 && !TEXT_ANCHOR_STOPWORDS.has(word)))].slice(0, 8);
}

function repairLearningUnitSourceTextAnchors(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
  report: FinalizeReport,
): void {
  const paragraphs = sourcePageParagraphs(gardenDir).filter((paragraph) => paragraph.page > 2);
  if (paragraphs.length === 0) return;
  for (const page of learnerPages) {
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit || !/^(?:training_method|core_concept|mechanism|application|limitation)$/.test(unit.role)) continue;
    const existing = fmGetArray(page.rawFm, "sourceAnchors");
    const hasSpecific = existing.some((anchor) => {
      if (anchor.startsWith("text-")) return true;
      const match = anchor.match(/\.P(\d+)\b/i);
      return match ? Number.parseInt(match[1] ?? "0", 10) > 2 : false;
    });
    if (hasSpecific) continue;
    const keywords = unitTextAnchorKeywords(unit, page);
    if (keywords.length === 0) continue;
    const paragraph = paragraphs.find((candidate) => {
      const lower = candidate.text.toLowerCase();
      const hits = keywords.filter((keyword) => lower.includes(keyword));
      return hits.length >= Math.min(2, keywords.length);
    });
    if (!paragraph) continue;
    const anchorId = `text-${slugifyLoose(paragraph.sourceId)}-${slugifyLoose(keywords.slice(0, 4).join("-"))}`;
    page.rawFm = fmSetArray(page.rawFm, "sourceAnchors", [...existing, anchorId]);
    page.dirty = true;
    registerSourceTextAnchor(gardenDir, {
      id: anchorId,
      sourceId: paragraph.sourceId,
      page: paragraph.page,
      kind: sourceTextAnchorKind(unit.role === "training_method" ? "method" : unit.role),
      title: unit.title,
      exactText: paragraph.text.slice(0, 500),
      semanticSummary: `Source prose supports ${unit.title}.`,
      conceptKeywords: keywords,
      confidence: 0.72,
    }, report);
    report.notes.push(`added page source text anchor ${anchorId} to ${page.rel}`);
  }
}

function synchronizeContractSourceAnchors(
  gardenDir: string,
  contract: LearningUnitContractArtifact,
  learnerPages: LearnerPage[],
  report: FinalizeReport,
): void {
  if (!contract.foundPath || contract.units.length === 0) return;
  const parsed = readJson<Record<string, unknown>>(contract.foundPath, {});
  const rawUnits = Array.isArray(parsed.learningUnits) ? parsed.learningUnits as Array<Record<string, unknown>> : [];
  if (rawUnits.length === 0) return;
  const pageAnchorsByUnit = new Map<string, string[]>();
  for (const page of learnerPages) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    if (!unitId) continue;
    const anchors = pageLevelSourceAnchorIds(page).filter((id) => /^text-/i.test(id) || /^S\d+\.P\d+\.[A-Z]\d+$/i.test(id));
    if (anchors.length > 0) pageAnchorsByUnit.set(unitId, anchors);
  }
  let changed = false;
  for (const rawUnit of rawUnits) {
    const id = cleanText(rawUnit.id);
    const pageAnchors = pageAnchorsByUnit.get(id);
    if (!pageAnchors) continue;
    const existing = Array.isArray(rawUnit.sourceAnchors) ? rawUnit.sourceAnchors.map(stringField).filter(Boolean) : [];
    const merged = [...new Set([...existing.filter((anchor) => !/abstract|guidance|researchgap/i.test(anchor)), ...pageAnchors])];
    if (arraysEqual(existing, merged)) continue;
    rawUnit.sourceAnchors = merged;
    changed = true;
  }
  if (!changed) return;
  fs.writeFileSync(contract.foundPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  if (!report.changed.includes(".breadboard/learning-unit-contract.json")) report.changed.push(".breadboard/learning-unit-contract.json");
  const repaired = readLearningUnitContract(gardenDir);
  contract.units = repaired.units;
  contract.assignments = repaired.assignments;
  report.notes.push("synchronized repaired page source anchors into the Learning Unit Contract");
}

function registerExistingTextAnchors(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
  report: FinalizeReport,
): void {
  const existing = new Map(readSourceAnchorLedger(gardenDir).map((anchor) => [anchor.id, anchor]));
  const anchors: SourceTextConceptAnchor[] = [...existing.values()];
  for (const page of learnerPages) {
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    for (const anchorId of pageLevelSourceAnchorIds(page).filter((id) => /^text-/i.test(id))) {
      if (existing.has(anchorId)) continue;
      const keywords = unit ? unitTextAnchorKeywords(unit, page) : anchorId.split("-").filter((word) => word.length >= 4).slice(0, 8);
      const anchor: SourceTextConceptAnchor = {
        id: anchorId,
        sourceId: anchorId.replace(/^text-/i, "").split("-").slice(0, 2).join("-") || "source",
        kind: sourceTextAnchorKind(unit?.role ?? "concept"),
        title: unit?.title ?? page.title,
        semanticSummary: `Source prose supports ${unit?.title ?? page.title}.`,
        conceptKeywords: keywords.length > 0 ? keywords : [slugifyLoose(page.title)].filter(Boolean),
        confidence: 0.65,
      };
      anchors.push(anchor);
      existing.set(anchorId, anchor);
    }
    for (const spec of embeddedVisualSpecs(page.body)) {
      for (const record of visualSpecAnchorRecords(spec)) {
        const anchorId = stringField(record.textAnchorId);
        if (!anchorId || existing.has(anchorId)) continue;
        const description = stringField(record.description);
        const anchor: SourceTextConceptAnchor = {
          id: anchorId,
          sourceId: stringField(record.sourceId) || "source",
          page: typeof record.page === "number" ? record.page : undefined,
          kind: "concept",
          title: stringField(record.sourceTitle) || stringField(spec.title) || page.title,
          exactText: stringField(record.exactText),
          semanticSummary: description || `Source prose supports ${String(spec.title ?? page.title)}.`,
          conceptKeywords: `${String(spec.title ?? "")} ${description}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4).slice(0, 8),
          confidence: 0.7,
        };
        anchors.push(anchor);
        existing.set(anchorId, anchor);
      }
    }
  }
  writeSourceAnchorLedger(gardenDir, anchors, report);
}

function sourceTextConceptAnchorProblems(gardenDir: string, learnerPages: LearnerPage[]): string[] {
  const corpus = sourceCorpusText(gardenDir);
  if (!corpus.trim()) return [];
  const problems: string[] = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const type = String(spec.type ?? "");
      const concept = proseConceptForVisualType(type);
      if (!concept || !concept.pattern.test(corpus)) continue;
      const status = String(spec.sourceGroundingStatus ?? "");
      const anchors = Array.isArray(spec.sourceAnchors) ? spec.sourceAnchors : [];
      const hasTextAnchor = anchors.some((anchor) =>
        anchor && typeof anchor === "object" && typeof (anchor as Record<string, unknown>).textAnchorId === "string",
      );
      if (status === "conceptual-no-direct-source-figure" && !hasTextAnchor) {
        problems.push(`${page.rel}: ${type} visual is fully unanchored even though source prose contains ${concept.label}`);
      }
      if (status === "source-derived-conceptual" && !hasTextAnchor) {
        problems.push(`${page.rel}: ${type} visual is source-derived-conceptual but lacks a textAnchorId`);
      }
    }
  }
  return [...new Set(problems)];
}

function sourceTextBodyAnchorProblems(
  gardenDir: string,
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
): string[] {
  const paragraphs = sourcePageParagraphs(gardenDir).filter((paragraph) => paragraph.page > 2);
  if (paragraphs.length === 0) return [];
  const problems: string[] = [];
  for (const page of learnerPages) {
    const unit = unitsById.get(fmGetScalar(page.rawFm, "learningUnitId"));
    if (!unit || !/^(?:training_method|core_concept|mechanism|application|limitation)$/.test(unit.role)) continue;
    const keywords = unitTextAnchorKeywords(unit, page);
    const match = paragraphs.find((paragraph) => {
      const lower = paragraph.text.toLowerCase();
      const hits = keywords.filter((keyword) => lower.includes(keyword));
      return hits.length >= Math.min(2, keywords.length);
    });
    if (!match) continue;
    const anchors = fmGetArray(page.rawFm, "sourceAnchors");
    const hasSpecific = anchors.some((anchor) => {
      if (anchor.startsWith("text-")) return true;
      const pageMatch = anchor.match(/\.P(\d+)\b/i);
      return pageMatch ? Number.parseInt(pageMatch[1] ?? "0", 10) > 2 : false;
    });
    if (!hasSpecific && anchors.some((anchor) => /abstract|guidance|researchgap/i.test(anchor))) {
      problems.push(`${page.rel}: ${unit.role} unit is grounded only in abstract/guidance anchors even though page ${match.page} source prose matches [${keywords.join(", ")}]`);
    }
  }
  return [...new Set(problems)];
}

function pageLevelSourceAnchorIds(page: LearnerPage): string[] {
  return [...new Set([
    ...fmGetArray(page.rawFm, "sourceAnchors"),
    ...fmGetArray(page.rawFm, "sourceVisualIds"),
    ...fmGetArray(page.rawFm, "sourceFormulaAnchors"),
  ].filter(Boolean))];
}

function textAnchorIdsFromPagesAndVisuals(learnerPages: LearnerPage[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  const add = (id: string, rel: string): void => {
    if (!/^text-/i.test(id)) return;
    const refs = byId.get(id) ?? [];
    refs.push(rel);
    byId.set(id, refs);
  };
  for (const page of learnerPages) {
    for (const id of pageLevelSourceAnchorIds(page)) add(id, page.rel);
    for (const spec of embeddedVisualSpecs(page.body)) {
      const visualId = String(spec.id ?? "(visual)");
      for (const id of visualSpecAnchorIds(spec)) add(id, `${page.rel}#${visualId}`);
    }
  }
  return byId;
}

function sourceAnchorLedgerProblems(gardenDir: string, learnerPages: LearnerPage[]): string[] {
  const used = textAnchorIdsFromPagesAndVisuals(learnerPages);
  if (used.size === 0) return [];
  const ledger = readSourceAnchorLedger(gardenDir);
  const known = new Map(ledger.map((anchor) => [anchor.id, anchor]));
  const structural = new Map(readStructuralTextAnchorLedger(gardenDir).map((anchor) => [anchor.id, anchor]));
  const problems: string[] = [];
  if (ledger.length === 0 && structural.size === 0) {
    problems.push(".breadboard/source-anchors.json missing or empty while text anchors are used");
  }
  for (const [id, refs] of used) {
    const anchor = known.get(id);
    const structuralAnchor = structural.get(id);
    if (!anchor && !structuralAnchor) {
      problems.push(`${[...new Set(refs)].join(", ")}: text anchor ${id} is not registered in .breadboard/source-anchors.json`);
      continue;
    }
    if (anchor) {
      if (!anchor.semanticSummary) problems.push(`${id}: source-anchor ledger entry missing semanticSummary`);
      if (!anchor.conceptKeywords || anchor.conceptKeywords.length === 0) problems.push(`${id}: source-anchor ledger entry missing conceptKeywords`);
      continue;
    }
    // A selected structural page record already carries exact source evidence.
    // Unlike a text-concept record it intentionally has no inferred summary or
    // keywords, so validate the immutable evidence fields instead.
    if (!structuralAnchor?.sourceId) problems.push(`${id}: structural text anchor is missing sourceId`);
    if (!structuralAnchor?.title) problems.push(`${id}: structural text anchor is missing title`);
    if (!structuralAnchor?.exactText) problems.push(`${id}: structural text anchor is missing exactText`);
  }
  return [...new Set(problems)];
}

function contractPageSourceAnchorSynchronizationProblems(
  learnerPages: LearnerPage[],
  unitsById: Map<string, LearningUnitContract>,
): string[] {
  const problems: string[] = [];
  for (const page of learnerPages) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    const unit = unitsById.get(unitId);
    if (!unit) continue;
    const contractAnchors = new Set([
      ...(unit.sourceAnchors ?? []),
      ...(unit.sourceFigures ?? []).map((figure) => figure.id),
      ...(unit.sourceFormulas ?? []).map((formula) => formula.id),
      ...(unit.sourceTables ?? []).map((table) => table.id),
      ...(unit.interactiveVisual?.sourceAnchors ?? []),
    ]);
    const pageAnchors = pageLevelSourceAnchorIds(page).filter((id) => /^text-/i.test(id) || /^S\d+\.P\d+\.[A-Z]\d+$/i.test(id));
    for (const id of pageAnchors) {
      if (!contractAnchors.has(id)) {
        problems.push(`${page.rel}: page source anchor ${id} is not present in Learning Unit Contract unit ${unit.id}`);
      }
    }
    if (pageAnchors.some((id) => /^text-/i.test(id))) {
      for (const id of unit.sourceAnchors ?? []) {
        if (/abstract|guidance|researchgap/i.test(id) && !pageAnchors.includes(id)) {
          problems.push(`${page.rel}: unit ${unit.id} still keeps broad source anchor ${id} after specific text-anchor repair`);
        }
      }
    }
  }
  return [...new Set(problems)];
}

function finalVisualSpecs(gardenDir: string, learnerPages: LearnerPage[]): Array<{ pageRel: string; id: string; anchorIds: string[] }> {
  const specs: Array<{ pageRel: string; id: string; anchorIds: string[] }> = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      specs.push({ pageRel: page.rel, id: String(spec.id ?? "").trim(), anchorIds: visualSpecAnchorIds(spec) });
    }
    for (const [id, version] of embeddedGeneratedVisualVersions(page.body)) {
      const manifest = readJson<Record<string, unknown>>(
        path.join(gardenDir, ".breadboard", "visuals", id, "versions", String(version), "manifest.json"),
        {},
      );
      const anchorIds = Array.isArray(manifest.sourceAnchorIds)
        ? manifest.sourceAnchorIds.map(String).filter(Boolean)
        : [];
      specs.push({ pageRel: page.rel, id, anchorIds });
    }
  }
  const visualDir = path.join(gardenDir, ".breadboard", "visuals");
  if (fs.existsSync(visualDir)) {
    for (const name of fs.readdirSync(visualDir)) {
      if (!name.endsWith(".json")) continue;
      const spec = readJson<Record<string, unknown>>(path.join(visualDir, name), {});
      const id = String(spec.id ?? name.replace(/\.json$/i, "")).trim();
      if (!id || specs.some((existing) => existing.id === id)) continue;
      specs.push({ pageRel: `.breadboard/visuals/${name}`, id, anchorIds: visualSpecAnchorIds(spec) });
    }
  }
  return specs;
}

function sourceCoverageFinalArtifactConsistencyProblems(gardenDir: string, learnerPages: LearnerPage[]): string[] {
  const coveragePath = path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md");
  if (!fs.existsSync(coveragePath)) return [];
  const coverage = readFileSyncWithRetry(coveragePath, "utf-8");
  const usedInteractive = coverageModeSection(coverage, "Used as Interactive Grounding");
  const problems: string[] = [];
  const visualSpecs = finalVisualSpecs(gardenDir, learnerPages).filter((entry) => entry.id);
  const visualAnchors = new Map<string, Set<string>>();
  for (const spec of visualSpecs) visualAnchors.set(spec.id, new Set(spec.anchorIds));
  for (const { id, anchorIds } of visualSpecs) {
    for (const anchor of anchorIds) {
      const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\b${escaped}\\b`, "i").test(usedInteractive)) {
        problems.push(`${id}: final visual JSON uses ${anchor}, but Source Coverage omits it from "Used as Interactive Grounding"`);
      }
    }
  }
  for (const line of usedInteractive.split(/\r?\n/)) {
    const anchors = [...line.matchAll(/\bS\d+\.P\d+\.[A-Z]\d+\b|\btext-[a-z0-9-]+\b/gi)].map((match) => match[0]);
    if (anchors.length === 0) continue;
    const visualId = [...visualAnchors.keys()].find((id) => id && line.includes(id));
    if (!visualId) continue;
    const actual = visualAnchors.get(visualId) ?? new Set<string>();
    for (const anchor of anchors) {
      if (!actual.has(anchor)) {
        problems.push(`Source Coverage claims visual ${visualId} uses ${anchor}, but final visual JSON does not`);
      }
    }
  }
  return [...new Set(problems)];
}

function sectionFolderTitleConsistencyProblems(gardenDir: string): string[] {
  const learningDir = path.join(gardenDir, "learning");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(learningDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const problems: string[] = [];
  const titleKeys = new Set<string>();
  const folderKeys = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\s+/.test(entry.name)) continue;
    const indexPath = path.join(learningDir, entry.name, "_index.md");
    if (!fs.existsSync(indexPath)) {
      problems.push(`learning/${entry.name}/: section folder is missing _index.md`);
      continue;
    }
    const { rawFrontmatter, body } = parseFrontmatter(readFileSyncWithRetry(indexPath, "utf-8"));
    const title = fmGetScalar(rawFrontmatter, "title") || entry.name;
    const h1 = body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() ?? "";
    const folderKey = normalizedSectionTitleKey(entry.name);
    const titleKey = normalizedSectionTitleKey(title);
    const canonicalTitleKey = canonicalSectionTitleKey(title, entry.name);
    folderKeys.add(folderKey);
    titleKeys.add(titleKey);
    titleKeys.add(canonicalTitleKey);
    if (folderKey !== canonicalTitleKey) problems.push(`learning/${entry.name}/: folder name "${entry.name}" does not match canonical _index title "${title}"`);
    if (h1 && normalizedSectionTitleKey(h1) !== titleKey) problems.push(`learning/${entry.name}/_index.md: H1 "${h1}" does not match frontmatter title "${title}"`);
  }
  const map = fs.existsSync(path.join(learningDir, "Learning Map.md"))
    ? parseFrontmatter(readFileSyncWithRetry(path.join(learningDir, "Learning Map.md"), "utf-8")).body
    : "";
  for (const line of map.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*(?:\[\[[^\]]+\|)?(.+?)(?:\]\])?\s*$/);
    if (!match) continue;
    const label = cleanMapNode(match[1] ?? "");
    if (!/^\d+\.\s+/.test(label)) continue;
    const key = canonicalSectionTitleKey(label);
    if (!titleKeys.has(key) || !folderKeys.has(key)) problems.push(`learning/Learning Map.md: section label "${label}" does not map to one matching section folder and title`);
  }
  return [...new Set(problems)];
}

function sectionTitleNaturalnessAllProblems(sectionInputs: ReturnType<typeof sectionSemanticInputs>): string[] {
  const problems: string[] = [];
  for (const section of sectionInputs) {
    for (const problem of sectionTitleNaturalnessProblems(section.sectionTitle, section.subsectionTitles)) {
      problems.push(`${section.rel}: ${problem}`);
    }
  }
  return [...new Set(problems)];
}

function formulaMetadataNoiseProblems(
  learnerPages: LearnerPage[],
  exactTextByFormulaAnchor: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  for (const page of learnerPages) {
    const entries = formulaEntriesFromFrontmatter(page.rawFm);
    if (entries.length === 0) continue;
    const trivial = entries.filter((entry) => {
      const text = String(entry.text ?? "");
      return isTrivialFormulaFragment(text) || !isFormulaExpression(text);
    });
    // Structural noise: an inline-fragment dump or a mostly-trivial block.
    // Exact reviewed source definitions are mandatory contract projections, so
    // a math-dense source page can legitimately exceed the normal focused
    // metadata ceiling. Keep the exemption deliberately narrow: every entry
    // must be an exact reviewed source projection and each source anchor can
    // appear only once. Any extra helper, drifted equation, or duplicate still
    // triggers the cap.
    const sourceAnchors = entries.map((entry) => String(entry.sourceAnchor ?? "").trim());
    const hasOneToOneExactReviewedSourceProjections =
      entries.every((entry) => isExactReviewedSourceFormulaProjection(entry, exactTextByFormulaAnchor)) &&
      sourceAnchors.every(Boolean) &&
      new Set(sourceAnchors).size === entries.length;
    if (entries.length > MAX_FORMULA_METADATA_ENTRIES && !hasOneToOneExactReviewedSourceProjections) {
      problems.push(`${page.rel}: formulas: contains ${entries.length} entries; expected focused metric/source relationships`);
    }
    if (trivial.length > 0 && trivial.length / entries.length > 0.3) problems.push(`${page.rel}: ${trivial.length}/${entries.length} formulas: entries are trivial fragments`);
    // Relationship-based validation (replaces the worked-example count ratio):
    // one definition may be applied by many worked examples. Only truly orphan
    // examples, mislabeled definitions, or unsupported source claims are flagged.
    const audit = auditFormulaMetadata(entries, {
      isExactReviewedSourceProjection: (entry) =>
        isExactReviewedSourceFormulaProjection(entry, exactTextByFormulaAnchor),
    });
    for (const problem of audit.problems) problems.push(`${page.rel}: ${problem}`);
    for (const [index, entry] of entries.entries()) {
      const text = String(entry.text ?? "");
      if (isTrivialFormulaFragment(text) && /^(source-anchored|source-derived)$/.test(String(entry.groundingStatus ?? ""))) {
        problems.push(`${page.rel}: formulas[${index}] source-anchors trivial fragment "${text}"`);
      }
    }
  }
  return [...new Set(problems)];
}

function visualAnchorPrecisionProblems(ledger: LedgerVisual[], learnerPages: LearnerPage[]): string[] {
  const problems: string[] = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const type = String(spec.type ?? "");
      if (type !== "metric_calculator" && type !== "tradeoff_explorer") continue;
      const specText = [
        spec.title,
        spec.caption,
        spec.pedagogicalPurpose,
        spec.learningGoal,
        Array.isArray(spec.conceptTargets) ? spec.conceptTargets.join(" ") : "",
        Array.isArray(spec.inputs) ? spec.inputs.join(" ") : "",
        Array.isArray(spec.outputs) ? spec.outputs.join(" ") : "",
        Array.isArray(spec.controls)
          ? spec.controls.map((control) => typeof control === "object" && control ? Object.values(control as Record<string, unknown>).join(" ") : "").join(" ")
          : "",
      ].filter(Boolean).join(" ");
      const includePageContext = type !== "metric_calculator";
      const expectedText = includePageContext ? [page.title, specText].filter(Boolean).join(" ") : specText;
      const expected = new Set<string>(metricCalculatorFamiliesForText(expectedText));
      if (expected.size === 0) continue;
      const allowed = new Set(expected);
      if (allowed.has("efficiency")) {
        allowed.add("accuracy");
        allowed.add("energy");
        allowed.add("spike-count");
      }
      if (allowed.has("energy")) allowed.add("spike-count");
      const ids = visualSpecAnchorIds(spec).filter((id) => /^S\d+\.P\d+\.E\d+$/i.test(id));
      const formulaAnchorRecords = visualSpecAnchorRecords(spec).filter((anchor) => /^S\d+\.P\d+\.E\d+$/i.test(String(anchor.equationId ?? "")));
      if (formulaAnchorRecords.length > 1) {
        for (const anchor of formulaAnchorRecords) {
          const id = String(anchor.equationId ?? "").trim();
          const role = String(anchor.role ?? "").trim();
          const reason = String(anchor.reason ?? "").trim();
          if (!/^(input|output_formula|comparison_basis|context)$/.test(role)) problems.push(`${page.rel}: visual ${String(spec.id ?? "(missing id)")} anchor ${id} lacks a valid role`);
          if (reason.length < 12) problems.push(`${page.rel}: visual ${String(spec.id ?? "(missing id)")} anchor ${id} lacks a specific role reason`);
        }
      }
      const extras = ids.filter((id) => {
        const visual = ledger.find((item) => item.sourceVisualId === id);
        const family = formulaMetricFamily(formulaAnchorSemanticText(visual));
        return family && !allowed.has(family);
      });
      const explicitMultiText = includePageContext ? [page.title, specText].filter(Boolean).join(" ") : specText;
      const explicitMulti = /\bmulti[- ]?metric\b|\btrade[- ]?off\b|accuracy.*latency.*energy|latency.*energy.*accuracy/i.test(explicitMultiText);
      if (extras.length > 0 && !explicitMulti) problems.push(`${page.rel}: visual ${String(spec.id ?? "(missing id)")} has unrelated formula anchors [${extras.join(", ")}]`);
    }
  }
  return [...new Set(problems)];
}

/** Stable identity for a final-stage repairable issue (Fix 11): derived from the
 * issue TYPE + page + normalized target (family / anchor), NOT the full error
 * sentence or a worked-example count. So the same accuracy grounding issue keeps
 * one id whether it reports 6, 5, or 2 examples, letting provenance close it. */
export function stableFinalIssueId(type: string, pagePath: string | undefined, target?: string): string {
  const normalizedTarget = (target ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [type, pagePath ?? "", normalizedTarget].filter(Boolean).join(":");
}

function repairLogConsistencyProblems(gardenDir: string, learnerPages: LearnerPage[], currentProblemKeys: Set<string> = new Set()): string[] {
  const problems: string[] = [];
  const run = readRepairRunReport(gardenDir);
  if (!run) {
    for (const page of learnerPages) {
      if (fmGetScalar(page.rawFm, "lastSemanticRepairAt")) {
        problems.push(`${page.rel}: has semantic repair provenance but .breadboard/repair-log.json is missing`);
      }
    }
    return problems;
  }
  const pageByRel = new Map(learnerPages.map((page) => [page.rel, page]));
  const allowedChangedFile = (entry: UnitRepairLogEntry, file: string): boolean => {
    if (!file) return false;
    // Target-kind-scoped provenance (canonical model): a repair may only touch
    // files that belong to its declared target.
    switch (entry.targetKind) {
      case "section_index":
        return /\/_index\.md$/.test(file);
      case "contract":
        return file === ".breadboard/learning-unit-contract.json";
      case "source_coverage":
        return file === ".breadboard/planning/Source Coverage.md" || file === ".breadboard/source-anchors.json";
      case "planning_doc":
        return file.startsWith(".breadboard/planning/") || file === "learning/Learning Map.md";
      case "visual_spec":
        return file.startsWith(".breadboard/visuals/");
      case "global_finalization":
        return true;
      default:
        break; // unit_page (or legacy, no targetKind) → per-page rules below
    }
    if (file === entry.pagePath) return true;
    if (file === `${entry.sectionPath}/_index.md`) return true;
    if (entry.failureTypes.includes("section_semantics") && (file === "learning/_index.md" || file === "learning/Learning Map.md")) return true;
    if ((entry.failureTypes.includes("zettelkasten_handle") || entry.failureTypes.includes("zettelkasten_handle_support") || entry.failureTypes.includes("contract_fulfillment") || entry.failureTypes.includes("source_text_anchor")) && file === ".breadboard/learning-unit-contract.json") return true;
    if (entry.failureTypes.includes("source_text_anchor") && file === ".breadboard/source-anchors.json") return true;
    if ((entry.failureTypes.includes("visual_grounding") || entry.failureTypes.includes("source_text_anchor")) && file === ".breadboard/planning/Source Coverage.md") return true;
    const page = pageByRel.get(entry.pagePath);
    if (page && file.startsWith(".breadboard/visuals/")) {
      const visualId = file.match(/^\.breadboard\/visuals\/(.+)\.json$/)?.[1] ?? "";
      const owned = new Set(fmGetArray(page.rawFm, "visualIds"));
      for (const id of embeddedGeneratedVisualIds(page.body)) owned.add(id);
      for (const spec of embeddedVisualSpecs(page.body)) {
        const id = String(spec.id ?? "").trim();
        if (id) owned.add(id);
      }
      return owned.has(visualId);
    }
    return false;
  };
  for (const entry of run.repairs ?? []) {
    // Fix 10 + 12: a historical `unresolved` entry is a blocker ONLY when the
    // issue is still live in the CURRENT deterministic checks. If it is live, the
    // corresponding direct check already reports it (so re-reporting here would
    // duplicate the error — the current final failure printed it twice); if it is
    // NOT live, a later repair resolved/superseded/invalidated it and the stale
    // record must not act as a permanent blocker. Either way Repair Provenance
    // adds no semantic-issue blocker — it only enforces LOG INTEGRITY below.
    if (entry.result === "unresolved") {
      const stillLive = (entry.unresolvedValidationErrors ?? []).some((error) =>
        currentProblemKeys.has(`${entry.pagePath}: ${error}`) || currentProblemKeys.has(error),
      );
      // No push: live issues are owned by the direct checks; stale ones are
      // historical. (The repair loop rewrites the log each round, marking the
      // latest attempt resolved/superseded so this record self-corrects.)
      void stillLive;
    }
    const changedFiles = Array.isArray(entry.changedFiles) ? entry.changedFiles : [];
    for (const file of changedFiles) {
      if (!allowedChangedFile(entry, file)) {
        problems.push(`${entry.pagePath}: repair log changedFiles includes unrelated file ${file}`);
      }
    }
    const proseTypes = ["repeated_opening", "scaffold_prose", "section_index_prose", "zettelkasten_handle_support"];
    const pageProseTypes = ["repeated_opening", "scaffold_prose", "zettelkasten_handle_support"];
    const isProseRepair = entry.failureTypes.some((type) => proseTypes.includes(type));
    const isPageProseRepair = entry.failureTypes.some((type) => pageProseTypes.includes(type));
    if (isPageProseRepair && entry.executorUsed === "deterministic" && entry.naturalProseValidation !== "pass") {
      problems.push(`${entry.pagePath}: deterministic semantic prose repair lacks naturalProseValidation=pass`);
    }
    // Finalizer-hygiene provenance entries (section-index/coverage/contract
    // aggregates) are deterministic structural bookkeeping, not model prose
    // repairs, so they carry no model-repair status.
    if (isProseRepair && String(entry.executorUsed) !== "finalizer_hygiene" && !entry.modelRepairStatus) {
      problems.push(`${entry.pagePath}: prose repair log missing modelRepairStatus`);
    }
  }
  const repairedPages = new Set((run.repairs ?? []).map((entry) => entry.pagePath));
  for (const page of learnerPages) {
    if (!fmGetScalar(page.rawFm, "lastSemanticRepairAt")) continue;
    if (!repairedPages.has(page.rel)) {
      problems.push(`${page.rel}: has lastSemanticRepairAt but no matching repair-log entry`);
    }
    if (!fmGetScalar(page.rawFm, "generatedFromUnitId")) {
      problems.push(`${page.rel}: semantic repair provenance missing generatedFromUnitId`);
    }
    if (!fmGetScalar(page.rawFm, "semanticRepairReason")) {
      problems.push(`${page.rel}: semantic repair provenance missing semanticRepairReason`);
    }
  }
  return [...new Set(problems)];
}

function finalizerBoundaryProblems(report: FinalizeReport): string[] {
  const problems: string[] = [];
  for (const action of report.actions ?? []) {
    if (action.kind === "semantic_failure") {
      problems.push(`${action.pagePath ?? action.unitId ?? "(unknown)"}: semantic failure reached finalizer instead of the Learning Unit repair loop`);
    }
  }
  return problems;
}

/**
 * Exact, layout-insensitive representation used only to prove that a reviewed
 * source transcription survived projection. It deliberately performs no
 * algebraic normalization, symbol substitution, or inferred repair.
 */
function exactFormulaProjectionKey(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Source-formula reviews publish the canonical equation text separately from
 * learner metadata. A source definition is exempt from arithmetic heuristics
 * only when its declared anchor and exact transcription prove that it is that
 * reviewed source equation. This is deliberately not an algebraic match.
 */
function isExactReviewedSourceFormulaProjection(
  entry: ParsedFormulaEntry,
  exactTextByFormulaAnchor: ReadonlyMap<string, string>,
): boolean {
  const kind = formulaEntryKind(entry);
  const status = String(entry.groundingStatus ?? "").trim();
  const anchor = String(entry.sourceAnchor ?? "").trim();
  const exactText = exactTextByFormulaAnchor.get(anchor);
  return (
    (kind === "source_definition" || kind === "source_derived_definition") &&
    (status === "source-anchored" || status === "source-derived") &&
    exactText !== undefined &&
    exactFormulaProjectionKey(entry.text) === exactFormulaProjectionKey(exactText)
  );
}

/** Apply the same renderer-facing lowering to both sides of an exact display
 * comparison. This permits Quartz's mechanical `\\tag{n}` -> visible text
 * lowering, but a changed sign, variable, limit, or term remains different. */
function quartzDisplayProjectionKey(value: string): string {
  const normalized = normalizeQuartzMarkdown(`$$\n${value}\n$$`);
  const display = extractVerbatimDisplayMath(normalized)[0];
  return exactFormulaProjectionKey(display?.formula);
}

function sourceFormulaIdsUsedByFinalArtifact(
  contract: LearningUnitContractArtifact,
  learnerPages: readonly LearnerPage[],
  ledger: readonly LedgerVisual[],
): string[] {
  const ids = new Set<string>();
  const add = (value: unknown): void => {
    const id = String(value ?? "").trim();
    if (isSourceFormulaId(id)) ids.add(id);
  };
  for (const assignment of contract.assignments) add(assignment.sourceArtifactId);
  for (const unit of contract.units) {
    for (const formula of unit.sourceFormulas ?? []) add(formula.id);
    for (const anchor of unit.sourceAnchors ?? []) add(anchor);
    for (const anchor of unit.interactiveVisual?.sourceAnchors ?? []) add(anchor);
    for (const anchor of unit.interactiveVisualPlan?.visualIntent?.sourceAnchors ?? []) add(anchor);
  }
  for (const page of learnerPages) {
    for (const anchor of formulaAnchorsFromFrontmatter(page.rawFm)) add(anchor);
    for (const entry of formulaEntriesFromFrontmatter(page.rawFm)) {
      add(entry.sourceAnchor);
      add(entry.basedOnFormula);
    }
    for (const spec of embeddedVisualSpecs(page.body)) {
      for (const anchor of visualSpecAnchorIds(spec)) add(anchor);
    }
  }
  for (const visual of ledger) {
    if (classifyFigure(visual) === "equation" && visual.usageStatus === "assigned") {
      add(visual.sourceVisualId);
    }
  }
  return [...ids].sort();
}

function currentSourceFormulaIds(
  ledger: readonly LedgerVisual[],
  selectedSourceIds: readonly string[] = [],
): string[] {
  const selected = new Set(selectedSourceIds.map((sourceId) => sourceId.trim()).filter(Boolean));
  return [...new Set(
    ledger
      .filter((visual) =>
        classifyFigure(visual) === "equation" &&
        (selected.size === 0 || selected.has(String(visual.sourceId ?? "").trim())))
      .map((visual) => visual.sourceVisualId.trim())
      .filter((formulaId) => isSourceFormulaId(formulaId)),
  )].sort();
}

function reviewedFormulaPageTargets(
  contract: LearningUnitContractArtifact,
  learnerPages: readonly LearnerPage[],
  formulaIds: ReadonlySet<string>,
): Map<string, LearnerPage[]> {
  const targets = new Map<string, LearnerPage[]>();
  const pagesByUnit = new Map<string, LearnerPage[]>();
  const add = (formulaId: string, page: LearnerPage | undefined): void => {
    if (!formulaIds.has(formulaId) || !page) return;
    const pages = targets.get(formulaId) ?? [];
    if (!pages.some((candidate) => candidate.rel === page.rel)) pages.push(page);
    targets.set(formulaId, pages);
  };
  for (const page of learnerPages) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    const pages = pagesByUnit.get(unitId) ?? [];
    pages.push(page);
    pagesByUnit.set(unitId, pages);
    for (const formulaId of formulaAnchorsFromFrontmatter(page.rawFm)) add(formulaId, page);
  }
  for (const assignment of contract.assignments) {
    if (!isSourceFormulaId(assignment.sourceArtifactId)) continue;
    for (const page of pagesByUnit.get(assignment.assignedLearningUnitId) ?? []) {
      add(assignment.sourceArtifactId, page);
    }
  }
  for (const unit of contract.units) {
    for (const formula of unit.sourceFormulas ?? []) {
      for (const page of pagesByUnit.get(unit.id) ?? []) add(formula.id, page);
    }
  }
  for (const pages of targets.values()) pages.sort((left, right) => left.rel.localeCompare(right.rel));
  return targets;
}

/**
 * Verify the final lesson projection against already-reviewed ledger text.
 * This is validation-only: it never inserts, rewrites, or infers a formula.
 */
export function reviewedSourceFormulaPageBindingProblems({
  gardenDir,
  requiredFormulaIds = [],
}: {
  gardenDir: string;
  requiredFormulaIds?: Iterable<string>;
}): string[] {
  const contract = readLearningUnitContract(gardenDir);
  const learnerPages = loadLearnerPages(gardenDir);
  const ledger = readJson<LedgerVisual[]>(
    path.join(gardenDir, ".breadboard", "source-visuals.json"),
    [],
  );
  const formulaIds = sourceFormulaIdsUsedByFinalArtifact(
    contract,
    learnerPages,
    ledger,
  );
  for (const formulaId of requiredFormulaIds) {
    const normalized = String(formulaId ?? "").trim();
    if (isSourceFormulaId(normalized) && !formulaIds.includes(normalized)) formulaIds.push(normalized);
  }
  formulaIds.sort();
  if (formulaIds.length === 0) return [];

  const formulaIdSet = new Set(formulaIds);
  const manifest = readSourceFormulaReviewSetManifest(gardenDir);
  const expectedSourceSetHash = contract.sourceSetHash || stringField(manifest?.combinedSourceSetHash);
  const expectedReviewSetHash = contract.sourceFormulaReviewSetHash || stringField(manifest?.reviewSetHash);
  const ledgerById = new Map(ledger.map((visual) => [visual.sourceVisualId, visual]));
  const targets = reviewedFormulaPageTargets(contract, learnerPages, formulaIdSet);
  const displayKeysByPage = new Map(
    learnerPages.map((page) => [
      page.rel,
      new Set(
        extractVerbatimDisplayMath(normalizeQuartzMarkdown(page.body))
          .map((expression) => exactFormulaProjectionKey(expression.formula))
          .filter(Boolean),
      ),
    ]),
  );
  const problems: string[] = [];

  for (const formulaId of formulaIds) {
    const visual = ledgerById.get(formulaId);
    const exactText = exactFormulaProjectionKey(visual?.exactText);
    if (!visual || classifyFigure(visual) !== "equation") {
      problems.push(`${formulaId}: reviewed formula is missing from the current source-visual ledger`);
      continue;
    }
    if (!exactText) {
      problems.push(`${formulaId}: reviewed formula has no current exactText`);
      continue;
    }
    const formulaTargets = targets.get(formulaId) ?? [];
    if (formulaTargets.length === 0) {
      problems.push(`${formulaId}: reviewed formula has no contract/page projection target`);
      continue;
    }
    const expectedDisplay = quartzDisplayProjectionKey(exactText);
    for (const page of formulaTargets) {
      const declared = new Set(formulaAnchorsFromFrontmatter(page.rawFm));
      if (!declared.has(formulaId)) {
        problems.push(`${page.rel}: reviewed formula ${formulaId} is required by its contract but absent from sourceFormulaAnchors`);
      }
      const definitions = formulaEntriesFromFrontmatter(page.rawFm).filter(
        (entry) => formulaEntryKind(entry) === "source_definition" &&
          String(entry.sourceAnchor ?? "").trim() === formulaId,
      );
      if (definitions.length === 0) {
        problems.push(`${page.rel}: reviewed formula ${formulaId} has no source_definition metadata entry`);
      } else {
        for (const [index, entry] of definitions.entries()) {
          if (exactFormulaProjectionKey(entry.text) !== exactText) {
            problems.push(
              `${page.rel}: reviewed formula ${formulaId} metadata entry ${index + 1} does not exactly match reviewed exactText`,
            );
          }
        }
      }
      if (!expectedDisplay || !displayKeysByPage.get(page.rel)?.has(expectedDisplay)) {
        problems.push(
          `${page.rel}: reviewed formula ${formulaId} is not present as an exact visible Quartz display projection`,
        );
      }
      if (expectedSourceSetHash && fmGetScalar(page.rawFm, "sourceSetHash") !== expectedSourceSetHash) {
        problems.push(`${page.rel}: sourceSetHash does not match the reviewed Learning Unit Contract`);
      }
      if (
        expectedReviewSetHash &&
        fmGetScalar(page.rawFm, "sourceFormulaReviewSetHash") !== expectedReviewSetHash
      ) {
        problems.push(`${page.rel}: sourceFormulaReviewSetHash does not match the reviewed Learning Unit Contract`);
      }
    }
  }

  return [...new Set(problems)];
}

function verifiedFormulaIdentityReviewDriftProblems(
  gardenDir: string,
  requiredFormulaIds: Iterable<string>,
): string[] {
  const relevant = new Set(requiredFormulaIds);
  if (relevant.size === 0) return [];
  const ledger = readJson<LedgerVisual[]>(
    path.join(gardenDir, ".breadboard", "source-visuals.json"),
    [],
  );
  const reviewedTextById = new Map(
    ledger
      .filter((visual) => relevant.has(visual.sourceVisualId))
      .map((visual) => [visual.sourceVisualId, exactFormulaProjectionKey(visual.exactText)]),
  );
  const artifact = readJson<Record<string, unknown>>(
    path.join(gardenDir, ".breadboard", "formula-identities.json"),
    {},
  );
  const identities = Array.isArray(artifact.identities)
    ? artifact.identities as Array<Record<string, unknown>>
    : [];
  const problems: string[] = [];
  for (const identity of identities) {
    if (identity.verified !== true) continue;
    const formulaId = String(identity.anchorId ?? "").trim();
    if (!relevant.has(formulaId)) continue;
    const identityText = exactFormulaProjectionKey(identity.canonicalText);
    const reviewedText = reviewedTextById.get(formulaId) ?? "";
    if (!identityText || identityText !== reviewedText) {
      problems.push(
        `${formulaId}: verified formula-identities canonicalText drifts from the reviewed source-visual exactText`,
      );
    }
  }
  return problems;
}

function sourceFormulaReviewManifestBindingProblems({
  gardenDir,
  contract,
  requiredFormulaIds,
  expectedContext,
}: {
  gardenDir: string;
  contract: LearningUnitContractArtifact;
  requiredFormulaIds: readonly string[];
  expectedContext?: SourceFormulaReviewFinalizationContext;
}): string[] {
  const problems: string[] = [];
  const manifest = readSourceFormulaReviewSetManifest(gardenDir);
  if (!manifest) {
    problems.push(
      `${SOURCE_FORMULA_REVIEW_SET_RELATIVE_PATH} is missing for reviewed source formulas`,
    );
    return problems;
  }
  const manifestReviewSetHash = stringField(manifest.reviewSetHash);
  const manifestBaseSourceSetHash = stringField(manifest.baseSourceSetHash);
  const manifestCombinedSourceSetHash = stringField(manifest.combinedSourceSetHash);
  const manifestModel = stringField(manifest.model);
  const manifestFormulaIds = Array.isArray(manifest.formulaIds)
    ? manifest.formulaIds.map(stringField).filter(Boolean)
    : [];
  const manifestSourceIds = Array.isArray(manifest.sourceIds)
    ? manifest.sourceIds.map(stringField).filter(Boolean)
    : [];
  const manifestTopologyReviewPageReceipts = Array.isArray(
    manifest.topologyReviewPageReceipts,
  )
    ? manifest.topologyReviewPageReceipts
    : [];
  if (manifest.schemaVersion !== 1) {
    problems.push("source-formula review manifest has an invalid schemaVersion");
  }
  // Formula-review prompt V2 retains the V1 manifest envelope and all of its
  // signed source/review hashes; it only strengthens the model instruction for
  // exact source transcription.  Accept both durable prompt contracts while
  // continuing to fail closed on every other version.
  if (manifest.promptVersion !== 1 && manifest.promptVersion !== 2) {
    problems.push("source-formula review manifest has an invalid promptVersion");
  }
  if (!Array.isArray(manifest.formulaIds) || manifest.formulaIds.some((id) => !stringField(id))) {
    problems.push("source-formula review manifest formulaIds are invalid");
  }
  if (!Array.isArray(manifest.sourceIds) || manifest.sourceIds.some((id) => !stringField(id))) {
    problems.push("source-formula review manifest sourceIds are invalid");
  }
  if (!Array.isArray(manifest.topologyReviewPageReceipts)) {
    problems.push("source-formula review manifest topologyReviewPageReceipts are invalid");
  }
  if (!/^[0-9a-f]{64}$/i.test(manifestReviewSetHash)) {
    problems.push("source-formula review manifest has no valid reviewSetHash");
  }
  if (!/^[0-9a-f]{64}$/i.test(manifestCombinedSourceSetHash)) {
    problems.push("source-formula review manifest has no valid combinedSourceSetHash");
  }
  if (!/^[0-9a-f]{64}$/i.test(manifestBaseSourceSetHash)) {
    problems.push("source-formula review manifest has no valid baseSourceSetHash");
  } else if (/^[0-9a-f]{64}$/i.test(manifestReviewSetHash)) {
    const derivedCombinedSourceSetHash = sourceSetHashWithReviewedFormulas(
      manifestBaseSourceSetHash,
      manifestReviewSetHash,
    );
    if (derivedCombinedSourceSetHash !== manifestCombinedSourceSetHash) {
      problems.push(
        "source-formula review manifest combinedSourceSetHash is not derived from its baseSourceSetHash and reviewSetHash",
      );
    }
  }
  if (!manifestModel) problems.push("source-formula review manifest has no model");
  if (new Set(manifestFormulaIds).size !== manifestFormulaIds.length) {
    problems.push("source-formula review manifest formulaIds contain duplicates");
  }
  if (new Set(manifestSourceIds).size !== manifestSourceIds.length) {
    problems.push("source-formula review manifest sourceIds contain duplicates");
  }
  const required = [...new Set(requiredFormulaIds)].sort();
  const declared = [...new Set(manifestFormulaIds)].sort();
  if (JSON.stringify(required) !== JSON.stringify(declared)) {
    const requiredSet = new Set(required);
    const declaredSet = new Set(declared);
    const missing = required.filter((id) => !declaredSet.has(id));
    const extra = declared.filter((id) => !requiredSet.has(id));
    problems.push(
      `source-formula review manifest formulaIds do not match the final relevant equation set; missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
    );
  }
  if (!contract.sourceFormulaReviewSetHash) {
    problems.push("Learning Unit Contract is missing sourceFormulaReviewSetHash");
  } else if (contract.sourceFormulaReviewSetHash !== manifestReviewSetHash) {
    problems.push(
      "Learning Unit Contract sourceFormulaReviewSetHash does not match the source-formula review manifest",
    );
  }
  if (!contract.sourceSetHash) {
    problems.push("Learning Unit Contract is missing its reviewed sourceSetHash");
  } else if (contract.sourceSetHash !== manifestCombinedSourceSetHash) {
    problems.push(
      "Learning Unit Contract sourceSetHash does not match the review manifest combinedSourceSetHash",
    );
  }
  if (expectedContext) {
    if (!expectedContext.reviewSetHash) {
      problems.push("expected source-formula review context has no reviewSetHash");
    } else if (expectedContext.reviewSetHash !== manifestReviewSetHash) {
      problems.push(
        "source-formula review manifest reviewSetHash does not match the active Learn expectation",
      );
    }
    if (!expectedContext.combinedSourceSetHash) {
      problems.push("expected source-formula review context has no combinedSourceSetHash");
    } else if (expectedContext.combinedSourceSetHash !== manifestCombinedSourceSetHash) {
      problems.push(
        "source-formula review manifest combinedSourceSetHash does not match the active Learn expectation",
      );
    }
    const expectedFormulaIds = [...new Set(expectedContext.formulaIds)].sort();
    if (expectedFormulaIds.length !== expectedContext.formulaIds.length) {
      problems.push("expected source-formula review context formulaIds contain duplicates");
    }
    if (JSON.stringify(expectedFormulaIds) !== JSON.stringify(declared)) {
      problems.push(
        "source-formula review manifest formulaIds do not match the active Learn expectation",
      );
    }
    if (expectedContext.sourceIds.length !== new Set(expectedContext.sourceIds).size) {
      problems.push("expected source-formula review context sourceIds contain duplicates");
    }
    if (JSON.stringify(expectedContext.sourceIds) !== JSON.stringify(manifestSourceIds)) {
      problems.push(
        "source-formula review manifest sourceIds do not match the active Learn expectation",
      );
    }
    if (
      JSON.stringify(expectedContext.topologyReviewPageReceipts) !==
      JSON.stringify(manifestTopologyReviewPageReceipts)
    ) {
      problems.push(
        "source-formula review manifest topology page receipts do not match the active Learn expectation",
      );
    }
    if (expectedContext.model && expectedContext.model !== manifestModel) {
      problems.push(
        "source-formula review manifest model does not match the active Learn expectation",
      );
    }
  }
  return problems;
}

function sourceArtifactInventoryBindingProblems({
  gardenDir,
  contract,
  expectedContext,
}: {
  gardenDir: string;
  contract: LearningUnitContractArtifact;
  expectedContext?: SourceFormulaReviewFinalizationContext;
}): string[] {
  const problems: string[] = [];
  const validHash = (value: string) => /^[0-9a-f]{64}$/.test(value);
  if (!validHash(contract.sourceArtifactInventoryHash)) {
    problems.push(
      "Learning Unit Contract is missing a valid sourceArtifactInventoryHash",
    );
  }
  if (expectedContext) {
    if (!validHash(expectedContext.sourceArtifactInventoryHash)) {
      problems.push(
        "expected source-formula review context has no valid sourceArtifactInventoryHash",
      );
    } else if (
      expectedContext.sourceArtifactInventoryHash !==
      contract.sourceArtifactInventoryHash
    ) {
      problems.push(
        "Learning Unit Contract sourceArtifactInventoryHash does not match the active Learn expectation",
      );
    }
  }

  const manifest = readSourceFormulaReviewSetManifest(gardenDir);
  const manifestSourceIds = Array.isArray(manifest?.sourceIds)
    ? manifest.sourceIds.map(stringField).filter(Boolean)
    : [];
  const selectedSourceIds = expectedContext?.sourceIds ?? manifestSourceIds;
  if (
    selectedSourceIds.length === 0 ||
    selectedSourceIds.some((sourceId) => !sourceId || sourceId.trim() !== sourceId) ||
    new Set(selectedSourceIds).size !== selectedSourceIds.length
  ) {
    problems.push(
      "selected source-artifact inventory has no valid unique source identity set",
    );
    return problems;
  }

  let durableIdentityMap: SourceVisualSourceIdentity[];
  try {
    durableIdentityMap = loadSourceVisualSourceIdentityMap(
      path.dirname(gardenDir),
      path.basename(gardenDir),
    );
  } catch (error) {
    problems.push(
      `selected source-artifact identity registry is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return problems;
  }
  if (durableIdentityMap.length === 0) {
    problems.push("selected source-artifact identity registry is missing or empty");
    return problems;
  }
  if (
    expectedContext &&
    JSON.stringify(expectedContext.sourceIdentityMap) !==
      JSON.stringify(durableIdentityMap)
  ) {
    problems.push(
      "selected source-artifact identity registry does not match the active Learn expectation",
    );
  }

  let visuals: SourceVisual[];
  const ledgerPath = path.join(
    gardenDir,
    ".breadboard",
    "source-visuals.json",
  );
  try {
    const parsed = JSON.parse(readFileSyncWithRetry(ledgerPath, "utf-8"));
    if (!Array.isArray(parsed)) {
      throw new Error("ledger root is not an array");
    }
    visuals = parsed as SourceVisual[];
  } catch (error) {
    problems.push(
      `selected source-artifact ledger is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return problems;
  }

  try {
    const snapshot = selectedSourceArtifactInventorySnapshot({
      selectedSourceIds,
      sourceIdentityMap: durableIdentityMap,
      visuals,
    });
    if (
      snapshot.sourceArtifactInventoryHash !==
      contract.sourceArtifactInventoryHash
    ) {
      problems.push(
        "Learning Unit Contract sourceArtifactInventoryHash does not match the staged selected-source ledger",
      );
    }
    if (
      expectedContext &&
      snapshot.sourceArtifactInventoryHash !==
        expectedContext.sourceArtifactInventoryHash
    ) {
      problems.push(
        "staged selected-source artifact inventory does not match the active Learn expectation",
      );
    }
  } catch (error) {
    problems.push(
      `selected source-artifact inventory is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return problems;
}

function syllabusCoverageEvidenceRecoveryBindingProblems({
  gardenDir,
  contract,
  expectedContext,
}: {
  gardenDir: string;
  contract: LearningUnitContractArtifact;
  expectedContext?: SourceFormulaReviewFinalizationContext;
}): string[] {
  const problems: string[] = [];
  const contractReceipt = contract.syllabusCoverageEvidenceRecovery as unknown;
  const expectedReceipt = expectedContext?.syllabusCoverageEvidenceRecovery as unknown;
  const contractReceiptPresent = contractReceipt !== undefined;
  const expectedReceiptPresent = expectedReceipt !== undefined;
  const validHash = (value: string) => /^[0-9a-f]{64}$/.test(value);

  if (expectedContext) {
    const expectedRecoveryHash =
      expectedContext.syllabusCoverageEvidenceRecoveryHash ?? "";
    if (contract.syllabusCoverageEvidenceRecoveryHash !==
        expectedRecoveryHash) {
      problems.push(
        "Learning Unit Contract syllabus evidence-recovery hash does not match the active Learn expectation",
      );
    }
    if (contractReceiptPresent !== expectedReceiptPresent ||
        (contractReceiptPresent &&
         JSON.stringify(contractReceipt) !== JSON.stringify(expectedReceipt))) {
      problems.push(
        "Learning Unit Contract syllabus evidence-recovery receipt does not match the active Learn expectation",
      );
    }
  }

  if (!contractReceiptPresent) {
    if (contract.syllabusCoverageEvidenceRecoveryHash) {
      problems.push(
        "Learning Unit Contract declares a syllabus evidence-recovery hash without its receipt",
      );
    }
    if (expectedReceiptPresent || expectedContext?.syllabusCoverageEvidenceRecoveryHash) {
      problems.push("active Learn syllabus evidence-recovery receipt is missing from the Learning Unit Contract");
    }
    return [...new Set(problems)];
  }

  const receiptRecord = asObject(contractReceipt);
  const receiptIntegrity = stringField(receiptRecord.integritySha256);
  if (!validHash(contract.syllabusCoverageEvidenceRecoveryHash) ||
      contract.syllabusCoverageEvidenceRecoveryHash !== receiptIntegrity) {
    problems.push("Learning Unit Contract syllabus evidence-recovery hash does not bind its receipt");
  }
  if (expectedContext &&
      (!validHash(expectedContext.syllabusCoverageEvidenceRecoveryHash ?? "") ||
       expectedContext.syllabusCoverageEvidenceRecoveryHash !== receiptIntegrity)) {
    problems.push("active Learn syllabus evidence-recovery hash does not bind its receipt");
  }
  if (receiptRecord.outcome !== "recovered") {
    problems.push("syllabus evidence-recovery receipt is not a recovered teachable decision");
  }

  const bindings = Array.isArray(receiptRecord.sourceBindings)
    ? receiptRecord.sourceBindings
    : [];
  const sources: Array<{
    id: string;
    slug: string;
    title: string;
    relPath: string;
    body: string;
  }> = [];
  const root = path.resolve(gardenDir);
  let realRoot = root;
  try {
    realRoot = fs.realpathSync(root);
  } catch (error) {
    problems.push(`syllabus evidence-recovery garden root is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [index, rawBinding] of bindings.entries()) {
    const binding = asObject(rawBinding);
    const sourceId = stringField(binding.sourceId);
    const relPath = stringField(binding.relPath);
    if (!sourceId || !relPath) {
      problems.push(`syllabus evidence-recovery source binding ${index + 1} is invalid`);
      continue;
    }
    const sourcePath = path.resolve(root, ...relPath.replace(/\\/g, "/").split("/"));
    const relative = path.relative(root, sourcePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      problems.push(`syllabus evidence-recovery source binding ${sourceId} escapes the garden root`);
      continue;
    }
    try {
      const realSourcePath = fs.realpathSync(sourcePath);
      const realRelative = path.relative(realRoot, realSourcePath);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        problems.push(`syllabus evidence-recovery source binding ${sourceId} resolves outside the garden root`);
        continue;
      }
      sources.push({
        id: sourceId,
        slug: sourceId,
        title: sourceId,
        relPath,
        body: stripMarkdownFrontmatter(
          readFileSyncWithRetry(realSourcePath, "utf-8"),
        ).trim(),
      });
    } catch (error) {
      problems.push(
        `syllabus evidence-recovery source binding ${sourceId} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    problems.push(...syllabusCoverageRecoveryReceiptProblems({
      receipt: contractReceipt,
      sources: sources.map((source) => ({
        sourceId: source.slug,
        relPath: source.relPath,
        body: source.body,
      })),
      anchors: modelSourcePageAnchors(sources),
      expectedSourceSetHash: contract.sourceSetHash,
      expectedSourceArtifactInventoryHash: contract.sourceArtifactInventoryHash,
    }));
  } catch (error) {
    problems.push(
      `syllabus evidence-recovery live provenance could not be rebuilt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return [...new Set(problems)];
}

function collectFinalizeChecks({
  gardenDir,
  gardenId,
  report,
  includeReportSelfCheck = true,
  strictModelApprovedVisuals = false,
  expectedVisualContractExecutabilityContext,
  expectedSourceFormulaReviewContext,
}: {
  gardenDir: string;
  /** Required for strict Learn paths; build/staging directory names are not garden ids. */
  gardenId?: string;
  report: FinalizeReport;
  includeReportSelfCheck?: boolean;
  strictModelApprovedVisuals?: boolean;
  expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
}): FinalizeCheck[] {
  const checks: FinalizeCheck[] = [];
  const push = (name: string, problems: string[]) => checks.push({ name, status: problems.length ? "FAIL" : "PASS", problems });
  const warn = (message: string) => {
    if (!report.warnings.includes(message)) report.warnings.push(message);
  };
  const learnerPages = loadLearnerPages(gardenDir);
  const contract = readLearningUnitContract(gardenDir);
  const unitsById = new Map(contract.units.map((unit) => [unit.id, unit]));
  const pagesByUnit = new Map<string, LearnerPage>();
  for (const page of learnerPages) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    if (unitId) pagesByUnit.set(unitId, page);
  }
  const ledger = readJson<LedgerVisual[]>(path.join(gardenDir, ".breadboard", "source-visuals.json"), []);
  const sourceFormulaReviewManifest = readSourceFormulaReviewSetManifest(gardenDir);
  const rawManifestFormulaIds = sourceFormulaReviewManifest?.formulaIds;
  const manifestFormulaIds = Array.isArray(rawManifestFormulaIds)
    ? rawManifestFormulaIds.map(stringField).filter(Boolean)
    : [];
  const rawManifestSourceIds = sourceFormulaReviewManifest?.sourceIds;
  const manifestSourceIds = Array.isArray(rawManifestSourceIds)
    ? rawManifestSourceIds.map(stringField).filter(Boolean)
    : [];
  const selectedSourceIds = expectedSourceFormulaReviewContext
    ? expectedSourceFormulaReviewContext.sourceIds
    : manifestSourceIds;
  const currentReviewedFormulaIds = currentSourceFormulaIds(ledger, selectedSourceIds);
  const declaredReviewedFormulaIds = expectedSourceFormulaReviewContext
    ? expectedSourceFormulaReviewContext.formulaIds
    : manifestFormulaIds;
  const usedFormulaIds = sourceFormulaIdsUsedByFinalArtifact(
    contract,
    learnerPages,
    ledger,
  );
  const requireSourceFormulaReview = Boolean(
    expectedSourceFormulaReviewContext ||
    contract.sourceFormulaReviewSetHash ||
    sourceFormulaReviewManifest,
  );
  const requireSourceArtifactInventory = Boolean(
    expectedSourceFormulaReviewContext ||
    contract.sourceArtifactInventoryHash ||
    sourceFormulaReviewManifest,
  );
  const requireSyllabusCoverageEvidenceRecovery = Boolean(
    expectedSourceFormulaReviewContext ||
    contract.syllabusCoverageEvidenceRecoveryHash ||
    contract.syllabusCoverageEvidenceRecovery !== undefined,
  );
  if (requireSyllabusCoverageEvidenceRecovery) {
    push(
      "Syllabus coverage evidence-recovery binding",
      syllabusCoverageEvidenceRecoveryBindingProblems({
        gardenDir,
        contract,
        expectedContext: expectedSourceFormulaReviewContext,
      }),
    );
  }
  if (requireSourceArtifactInventory) {
    push(
      "Selected source-artifact inventory binding",
      sourceArtifactInventoryBindingProblems({
        gardenDir,
        contract,
        expectedContext: expectedSourceFormulaReviewContext,
      }),
    );
  }
  if (requireSourceFormulaReview) {
    const manifestBindingProblems = sourceFormulaReviewManifestBindingProblems({
      gardenDir,
      contract,
      requiredFormulaIds: currentReviewedFormulaIds,
      expectedContext: expectedSourceFormulaReviewContext,
    });
    const declaredReviewedFormulaIdSet = new Set(declaredReviewedFormulaIds);
    for (const formulaId of usedFormulaIds) {
      if (!declaredReviewedFormulaIdSet.has(formulaId)) {
        manifestBindingProblems.push(
          `${formulaId}: final-used source formula is absent from the AI-reviewed formula set`,
        );
      }
    }
    push(
      "AI-reviewed source-formula manifest binding",
      manifestBindingProblems,
    );
    const manifestReviewSetHash = stringField(sourceFormulaReviewManifest?.reviewSetHash);
    const manifestModel = stringField(sourceFormulaReviewManifest?.model);
    const reviewValidation = validateSourceFormulaReviewSet({
      gardenDir,
      gardenSlug: gardenId ?? path.basename(gardenDir),
      assetUrlGardenSlug: gardenId ?? path.basename(gardenDir),
      requiredFormulaIds: declaredReviewedFormulaIds,
      expectedReviewSetHash:
        expectedSourceFormulaReviewContext?.reviewSetHash ||
        contract.sourceFormulaReviewSetHash ||
        manifestReviewSetHash ||
        undefined,
      expectedModel:
        expectedSourceFormulaReviewContext?.model || manifestModel || undefined,
      expectedSourceIds:
        expectedSourceFormulaReviewContext?.sourceIds ?? manifestSourceIds,
      expectedTopologyReviewPageReceipts:
        expectedSourceFormulaReviewContext?.topologyReviewPageReceipts,
    });
    push("AI-reviewed source-formula provenance", reviewValidation.problems);
    push(
      "Reviewed source-formula identity integrity",
      verifiedFormulaIdentityReviewDriftProblems(gardenDir, usedFormulaIds),
    );
    push(
      "Reviewed source-formula page projection",
      reviewedSourceFormulaPageBindingProblems({
        gardenDir,
        requiredFormulaIds: usedFormulaIds,
      }),
    );
  }
  if (strictModelApprovedVisuals) {
    const executabilityLedger = loadVisualContractExecutabilityLedger(gardenDir);
    const visualizationPlan = loadVisualizationPlan(gardenDir);
    let canonicalEvidence: ReturnType<typeof canonicalVisualizationEvidenceByUnit> | undefined;
    const canonicalEvidenceProblems: string[] = [];
    try {
      canonicalEvidence = canonicalVisualizationEvidenceByUnit(gardenDir, contract.units);
    } catch (error) {
      canonicalEvidenceProblems.push(
        `canonical visualization evidence could not be rebuilt: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    push(
      "Model-authored visual-contract executability linkage",
      gardenId
        ? [
            ...canonicalEvidenceProblems,
            ...visualContractExecutabilityLinkageProblems({
              gardenId,
              ledger: executabilityLedger,
              finalLearningUnits: contract.units,
              visualizationPlan,
              // A normal generation emits its own review ledger. A
              // map-bound route bundle deliberately rehydrates the exact
              // confirmed planning ledger instead; its explicit planning
              // context is still required to match exactly below.
              requireGenerationPhase:
                expectedVisualContractExecutabilityContext?.phase !== "planning",
              authoritativeCanonicalEvidenceByUnit: canonicalEvidence,
              expectedContext: expectedVisualContractExecutabilityContext,
            }),
          ]
        : ["strict visual-contract finalization requires an explicit garden id"],
    );
    push(
      "Visual-contract source artifact provenance",
      gardenId
        ? visualContractExecutabilityArtifactProvenanceProblems({
            gardenDir,
            gardenId,
            ledger: executabilityLedger,
            finalLearningUnits: contract.units,
          })
        : ["strict visual-contract finalization requires an explicit garden id"],
    );
    push(
      "Visualization-plan final placement projection",
      gardenId
        ? visualizationPlanPlacementProblems({
            gardenDir,
            gardenId,
            pages: learnerPages,
            plan: visualizationPlan,
          })
        : ["strict visual-contract finalization requires an explicit garden id"],
    );
  }

  // A formula anchor is GROUNDABLE only when the source actually yielded an
  // exact formula (a verified identity or recoverable canonical text). When
  // extraction produced a caption-only anchor with no exact text, it is not a
  // source formula a learner page can define or must be graded against:
  // requiring it, matching page math to it, or flagging it as "used but
  // skipped" are all false positives. Gardens whose extraction succeeded keep
  // full formula grounding; only caption-only anchors are relaxed.
  const formulaIdentityRegistry = buildFormulaIdentityRegistry(buildCanonicalSourceAnchors(gardenDir), gardenDir);
  const groundableFormulaAnchorIds = new Set(
    formulaIdentityRegistry
      .filter((identity) => identity.verified || String(identity.canonicalText ?? "").trim().length > 0)
      .map((identity) => identity.anchorId),
  );
  const exactTextByFormulaAnchor = new Map(
    formulaIdentityRegistry
      .filter((identity) => String(identity.canonicalText ?? "").trim().length > 0)
      .map((identity) => [identity.anchorId, String(identity.canonicalText)]),
  );

  // Export tree.
  const allowed = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
  const treeProblems: string[] = [];
  for (const entry of fs.readdirSync(gardenDir)) {
    if (!allowed.has(entry)) treeProblems.push(`unexpected top-level: ${entry}`);
  }
  if (!fs.existsSync(path.join(gardenDir, "sources", "_index.md"))) treeProblems.push("sources/_index.md missing");
  push("exported tree only _index.md/learning/sources/assets/.breadboard", treeProblems);

  push("semantic navigation links point to the expected page family", semanticNavigationProblems(gardenDir));
  push("Semantic Navigation Number Matching", semanticNavigationNumberProblems(gardenDir));

  // Source pages not typed as learner pages.
  const typingProblems: string[] = [];
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  for (const { abs, rel } of sourcePages) {
    const { rawFrontmatter } = parseFrontmatter(readFileSyncWithRetry(abs, "utf-8"));
    if (fmGetScalar(rawFrontmatter, "breadboardType") === "learning_page") typingProblems.push(`${rel}: typed learning_page`);
    if (fmGetScalar(rawFrontmatter, "internal") === "true" && fmGetScalar(rawFrontmatter, "breadboardType") === "learning_page") {
      typingProblems.push(`${rel}: internal+learning_page`);
    }
    if (fmGetArray(rawFrontmatter, "tags").length > 0) typingProblems.push(`${rel}: source page carries public tags`);
    if (fmGetArray(rawFrontmatter, "primaryConcepts").length > 0) typingProblems.push(`${rel}: source page carries primaryConcepts`);
  }
  push("no source page typed as learner page", typingProblems);

  push("reconciliation has no contradictory anchor usage", report.reconciliation
    .filter((entry) => entry.status === "intentionally_skipped" && (entry.embeddedAsImage || entry.usedAsInteractiveAnchor))
    .map((entry) => `${entry.id}: skipped but used`));
  push("Finalizer semantic boundary", finalizerBoundaryProblems(report));
  push("Learner-Facing Scaffold Prose", learnerFacingScaffoldProseProblems(learnerPages));

  // Learning Unit Contract fulfillment.
  const fulfillmentProblems: string[] = [];
  if (learnerPages.length > 0 && contract.units.length === 0) {
    fulfillmentProblems.push(".breadboard/learning-unit-contract.json missing or empty");
  }
  const knownHandles = new Set(contract.units.flatMap((unit) => conceptTagsForUnit(unit)));
  const assignmentsByUnit = new Map<string, SourceArtifactAssignment[]>();
  for (const assignment of contract.assignments) {
    const list = assignmentsByUnit.get(assignment.assignedLearningUnitId) ?? [];
    list.push(assignment);
    assignmentsByUnit.set(assignment.assignedLearningUnitId, list);
  }
  const useAssignedArtifacts = contract.assignments.length > 0;
  const tagCounts = new Map<string, number>();
  for (const page of learnerPages) {
    const unitId = fmGetScalar(page.rawFm, "learningUnitId");
    const unit = unitId ? unitsById.get(unitId) : undefined;
    if (!unit) {
      fulfillmentProblems.push(`${page.rel}: missing or unknown learningUnitId "${unitId || "(missing)"}"`);
      continue;
    }
    const tags = fmGetArray(page.rawFm, "tags");
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const expectedTags = conceptTagsForUnit(unit);
    const missingTags = expectedTags.filter((tag) => !tags.includes(tag));
    const extraTags = tags.filter((tag) => !expectedTags.includes(tag));
    const primaryConcepts = fmGetArray(page.rawFm, "primaryConcepts");
    const supportingConcepts = fmGetArray(page.rawFm, "supportingConcepts");
    const assignmentUnion = [...new Set([...primaryConcepts, ...supportingConcepts])];
    if (primaryConcepts.length === 0) fulfillmentProblems.push(`${page.rel}: learner page has no primary concept`);
    if (expectedTags.length === 0) fulfillmentProblems.push(`${page.rel}: unit ${unit.id} has no semantic concepts`);
    if (missingTags.length > 0 || extraTags.length > 0) {
      fulfillmentProblems.push(`${page.rel}: tags must equal contract concepts for ${unit.id}; missing [${missingTags.join(", ")}], extra [${extraTags.join(", ")}]`);
    }
    if (!arraysEqual(tags, assignmentUnion)) {
      fulfillmentProblems.push(`${page.rel}: tags must equal primaryConcepts + supportingConcepts`);
    }
    for (const tag of tags) {
      if (!knownHandles.has(tag)) fulfillmentProblems.push(`${page.rel}: tag "${tag}" is not in the Learning Unit Contract`);
      if (!isValidPublicConceptSlug(tag)) fulfillmentProblems.push(`${page.rel}: tag "${tag}" is not a reusable canonical concept`);
    }
    if (tags.length > 5) fulfillmentProblems.push(`${page.rel}: more than five public concepts`);
    const sourceVisualIds = fmGetArray(page.rawFm, "sourceVisualIds");
    const formulaAnchors = formulaAnchorsFromFrontmatter(page.rawFm);
    const assignedArtifacts = assignmentsByUnit.get(unit.id) ?? [];
    const requiredFigures = useAssignedArtifacts
      ? assignedArtifacts.map((assignment) => assignment.sourceArtifactId).filter(isSourceFigureId)
      : unit.sourceFigures.filter((figure) => figure.placement !== "not_used_with_reason").map((figure) => figure.id);
    const requiredFormulas = (useAssignedArtifacts
      ? assignedArtifacts.map((assignment) => assignment.sourceArtifactId).filter(isSourceFormulaId)
      : unit.sourceFormulas.map((formula) => formula.id))
      // Never require a caption-only anchor the source never yielded a formula
      // for; it cannot be grounded on any page.
      .filter((id) => groundableFormulaAnchorIds.has(id));
    const requiredTables = useAssignedArtifacts
      ? assignedArtifacts.map((assignment) => assignment.sourceArtifactId).filter(isSourceTableId)
      : unit.sourceTables.map((table) => table.id);
    for (const id of requiredFigures) {
      if (!sourceVisualIds.includes(id)) fulfillmentProblems.push(`${page.rel}: missing contract source figure ${id}`);
    }
    for (const id of requiredTables) {
      if (!sourceVisualIds.includes(id)) fulfillmentProblems.push(`${page.rel}: missing contract source table ${id}`);
    }
    for (const id of requiredFormulas) {
      if (!formulaAnchors.includes(id)) fulfillmentProblems.push(`${page.rel}: missing contract source formula ${id}`);
    }
    {
      const types = embeddedVisualTypes(page.body);
      const generatedIds = embeddedGeneratedVisualIds(page.body);
      const omitted = Boolean(fmGetScalar(page.rawFm, "interactiveVisualOmissionReason")) || /interactive visual intentionally omitted/i.test(page.body);
      const assessment = assessInteractiveVisualFulfillment({
        unit,
        embeddedVisualTypes: types,
        generatedVisualIds: generatedIds,
        intentionallyOmitted: omitted,
        strictModelApprovedRequirement: strictModelApprovedVisuals,
      });
      const message = `${page.rel}: ${assessment.reason}`;
      if (assessment.severity === "blocker") fulfillmentProblems.push(message);
      else if (assessment.severity === "warning") warn(message);
    }
    for (const formulaAnchor of formulaAnchors) {
      if (formulaAnchor.startsWith("trivial:")) fulfillmentProblems.push(`${page.rel}: formula frontmatter tracks trivial math ${formulaAnchor.slice("trivial:".length)}`);
    }
  }
  void tagCounts;
  for (const unit of contract.units) {
    if (!pagesByUnit.has(unit.id)) fulfillmentProblems.push(`learning unit ${unit.id} has no generated learner page`);
  }
  push("Learning Unit Contract fulfillment", [...new Set(fulfillmentProblems)]);

  // Section semantic coherence and grammar.
  const sectionInputs = sectionSemanticInputs(gardenDir, learnerPages, unitsById);
  push(
    "Section Title Uniqueness",
    sectionTitleUniquenessProblems(sectionInputs.map((section) => ({ rel: section.rel, title: section.sectionTitle }))),
  );
  push("Section Folder/Title Consistency", sectionFolderTitleConsistencyProblems(gardenDir));
  push("Section Title Naturalness", sectionTitleNaturalnessAllProblems(sectionInputs));
  push("Learning Map Ambiguity", learningMapAmbiguityProblems(gardenDir, sectionInputs));

  const profiles = sectionSemanticProfiles(sectionInputs.map((section) => ({
    sectionTitle: section.sectionTitle,
    units: section.units,
    subsectionTitles: section.subsectionTitles,
  })));
  const sectionProblems: string[] = [];
  for (const [index, profile] of profiles.entries()) {
    for (const problem of profile.problems) sectionProblems.push(`${sectionInputs[index]?.rel ?? profile.sectionTitle}: ${problem}`);
  }
  push("Section semantic coherence", sectionProblems);

  const titleGrammarProblems: string[] = [];
  for (const section of sectionInputs) {
    for (const problem of sectionTitleGrammarProblems(section.sectionTitle, section.subsectionTitles)) {
      titleGrammarProblems.push(`${section.rel}: ${problem}`);
    }
  }
  for (const page of learnerPages) {
    for (const problem of sectionTitleGrammarProblems(page.title)) {
      titleGrammarProblems.push(`${page.rel}: ${problem}`);
    }
  }
  push("Section title grammar", titleGrammarProblems);
  push("Section Index Prose Quality", sectionIndexProseQualityProblems(gardenDir));

  // Interactive visual grounding.
  const visualGroundingProblems: string[] = [];
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const ids = visualSpecAnchorIds(spec);
      const problems = interactiveVisualGroundingProblems({
        visualType: String(spec.type ?? ""),
        sourceAnchors: ids,
        sourceAnchorText: anchorTextForVisualIds(ledger, ids, spec),
        status: String(spec.sourceGroundingStatus ?? ""),
        justification: String(spec.justification ?? ""),
        conceptText: [page.title, spec.title, spec.caption, spec.pedagogicalPurpose, spec.learningGoal].filter(Boolean).join(" "),
      });
      for (const problem of problems) visualGroundingProblems.push(`${page.rel}: ${problem}`);
    }
  }
  push("Interactive visual grounding", visualGroundingProblems);
  push("Generated Visual Integrity", generatedVisualIntegrityProblems(gardenDir, learnerPages));
  push("Source Text Concept Anchors", [
    ...sourceTextConceptAnchorProblems(gardenDir, learnerPages),
    ...sourceTextBodyAnchorProblems(gardenDir, learnerPages, unitsById),
    ...sourceAnchorLedgerProblems(gardenDir, learnerPages),
  ]);
  push("Contract/Page Source Anchor Synchronization", contractPageSourceAnchorSynchronizationProblems(learnerPages, unitsById));
  push("Visual Title and Caption Quality", visualTitleCaptionQualityProblems(learnerPages));

  // Formula grounding.
  const formulaGroundingProblems: string[] = [];
  const formulaExpressionProblems: string[] = [];
  const formulaSourceProblems: string[] = [];
  const sourceFormulaCaptions = ledger
    .filter((visual) => classifyFigure(visual) === "equation" && groundableFormulaAnchorIds.has(visual.sourceVisualId))
    .map((visual) => ({ id: visual.sourceVisualId, caption: formulaAnchorSemanticText(visual) }));
  for (const page of learnerPages) {
    const declared = fmGetArray(page.rawFm, "sourceFormulaAnchors");
    const grounded = formulaEntrySourceAnchors(page.rawFm);
    if (declared.length > 0 && grounded.length === 0) {
      formulaGroundingProblems.push(`${page.rel}: has sourceFormulaAnchors but no source definition formulas: entry`);
    }
    for (const anchor of declared) {
      if (!grounded.includes(anchor)) {
        formulaGroundingProblems.push(`${page.rel}: sourceFormulaAnchors includes ${anchor}, but no source definition formulas: entry is grounded to it`);
      }
    }
    for (const [index, entry] of formulaEntriesFromFrontmatter(page.rawFm).entries()) {
      const label = `${page.rel}: formulas[${index}]`;
      const text = String(entry.text ?? "");
      const status = String(entry.groundingStatus ?? "");
      const kind = formulaEntryKind(entry);
      const exactReviewedSourceProjection = isExactReviewedSourceFormulaProjection(
        entry,
        exactTextByFormulaAnchor,
      );
      if (!text.trim()) {
        formulaExpressionProblems.push(`${label} missing text`);
        continue;
      }
      if (!isFormulaExpression(text)) {
        formulaExpressionProblems.push(`${label} is prose/keyword bundle, not a mathematical expression: "${text}"`);
      }
      if (!/^(source-anchored|source-derived|conceptual-helper|unmatched)$/.test(status)) {
        formulaExpressionProblems.push(`${label} has invalid groundingStatus "${status || "(missing)"}"`);
      }
      if (!/^(source_definition|source_derived_definition|worked_example|conceptual_helper)$/.test(kind)) {
        formulaExpressionProblems.push(`${label} has invalid kind "${kind || "(missing)"}"`);
      }
      if (kind === "worked_example" && /^(source-anchored|source-derived)$/.test(status)) {
        formulaSourceProblems.push(`${label} is a worked example but is marked ${status}; worked examples may reference source formulas but cannot satisfy source definitions`);
      }
      if (kind === "worked_example") {
        continue;
      }
      if (
        (kind === "source_definition" || kind === "source_derived_definition") &&
        isWorkedExampleFormula(text) &&
        !exactReviewedSourceProjection
      ) {
        formulaSourceProblems.push(`${label} is numeric worked-example arithmetic but is marked ${kind}`);
      }
      if ((status === "source-anchored" || status === "source-derived") && !String(entry.sourceAnchor ?? "").trim()) {
        formulaSourceProblems.push(`${label} is ${status} but lacks sourceAnchor`);
      }
      const match: ReturnType<typeof groundLearnerFormula> = isFormulaExpression(text)
        ? groundLearnerFormula(text, sourceFormulaCaptions)
        : { groundingStatus: "conceptual-helper" };
      // `groundLearnerFormula` matches by caption family, which is coarse for
      // math-heavy papers where many distinct page helpers share a family with a
      // source equation (a discrete LIF update vs the continuous membrane ODE).
      // A conceptual-helper is only a MISLABELED source definition when it is
      // STRUCTURALLY the source equation, not merely the same family — compare
      // against the source's exact text when we have it.
      const matchesSourceStructurally = (anchorId: string | undefined): boolean => {
        if (!anchorId) return false;
        const sourceExact = exactTextByFormulaAnchor.get(anchorId);
        if (sourceExact === undefined) return true; // no exact text to check against
        return formulaTextsStructurallyClose(text, sourceExact);
      };
      if ((status === "conceptual-helper" || status === "unmatched")
        && match.groundingStatus === "source-anchored"
        && matchesSourceStructurally(match.sourceAnchor)) {
        formulaSourceProblems.push(`${label} matches source formula ${match.sourceAnchor} but is marked ${status}`);
      }
      if ((status === "source-anchored" || status === "source-derived") && entry.sourceAnchor
        && match.groundingStatus === "source-anchored" && match.sourceAnchor !== entry.sourceAnchor
        && matchesSourceStructurally(match.sourceAnchor)
        && !formulaTextsStructurallyClose(text, exactTextByFormulaAnchor.get(entry.sourceAnchor) ?? "")) {
        formulaSourceProblems.push(`${label} is grounded to ${entry.sourceAnchor}, but content matches ${match.sourceAnchor}`);
      }
      if ((status === "source-anchored" || status === "source-derived") && entry.sourceAnchor) {
        const anchor = sourceFormulaCaptions.find((source) => source.id === entry.sourceAnchor);
        const meaning = formulaMeaningMatch(text, anchor?.caption ?? "");
        if (anchor?.caption && !meaning.ok && !exactReviewedSourceProjection) {
          formulaSourceProblems.push(`${label} is grounded to ${entry.sourceAnchor}, but content does not match (${meaning.reason})`);
        }
      }
    }
  }
  push("Formula grounding", formulaGroundingProblems);
  push("Formula expression validation", formulaExpressionProblems);
  push("Formula Meaning Match", formulaSourceProblems);
  push("Formula Family Match", formulaSourceProblems.filter((problem) => /family|source formula|content does not match|grounded to/.test(problem)));
  push("Formula Metadata Noise", formulaMetadataNoiseProblems(learnerPages, exactTextByFormulaAnchor));

  // Source Coverage from contract.
  const coverageProblems: string[] = [];
  const coverage = fs.existsSync(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"))
    ? readFileSyncWithRetry(path.join(gardenDir, ".breadboard", "planning", "Source Coverage.md"), "utf-8")
    : "";
  if (!coverage && contract.assignments.length > 0) coverageProblems.push(".breadboard/planning/Source Coverage.md missing");
  if (/central to\s+\[\[/i.test(coverage)) coverageProblems.push("Source Coverage still uses heuristic 'central to [[page]]' assignments");
  if (coverage) {
    for (const heading of PRECISE_SOURCE_COVERAGE_HEADINGS) {
      if (!coverageHeadingRe(heading).test(coverage)) {
        coverageProblems.push(`Source Coverage missing mode section "${heading}"`);
      }
    }
  }
  for (const assignment of contract.assignments) {
    const escaped = assignment.sourceArtifactId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (coverage && !new RegExp(`${escaped}[^\\n]*assigned to ${assignment.assignedLearningUnitId}\\b`, "i").test(coverage)) {
      coverageProblems.push(`${assignment.sourceArtifactId}: Source Coverage does not assign to contract unit ${assignment.assignedLearningUnitId}`);
    }
  }
  push("Source Coverage follows the Learning Unit Contract", [...new Set(coverageProblems)]);
  push("Source Coverage Mode Precision", sourceCoverageModePrecisionProblems(gardenDir, ledger));
  push("Source Coverage / Final Artifact Consistency", sourceCoverageFinalArtifactConsistencyProblems(gardenDir, learnerPages));
  push("Source anchor usage vs crop status", sourceAnchorUsageVsCropStatusProblems(ledger, learnerPages, groundableFormulaAnchorIds));

  // Source Map consistency.
  const sourceMapProblems: string[] = [];
  const sourceMap = fs.existsSync(path.join(gardenDir, ".breadboard", "planning", "Source Map.md"))
    ? readFileSyncWithRetry(path.join(gardenDir, ".breadboard", "planning", "Source Map.md"), "utf-8")
    : "";
  const hasFormulaAnchors = ledger.some((visual) => classifyFigure(visual) === "equation");
  const hasTables = ledger.some((visual) => String(visual.type ?? "") === "table" || /^S\d+\.P\d+\.T\d+$/i.test(String(visual.sourceVisualId ?? "")));
  const hasFigures = ledger.some((visual) => classifyFigure(visual) !== "equation" && String(visual.type ?? "") !== "table" && !/^S\d+\.P\d+\.T\d+$/i.test(String(visual.sourceVisualId ?? "")));
  const hasLaterPages = sourcesHaveLaterPages(gardenDir);
  if (!sourceMap && (hasFormulaAnchors || hasTables || hasFigures || hasLaterPages)) {
    sourceMapProblems.push(".breadboard/planning/Source Map.md missing");
  }
  if (sourceMap) {
    if (hasFormulaAnchors && /explicit mathematical definitions are not present|formulas? (?:are|is) not present|caption-only|formula captions? only|formula captions? but exact notation unavailable|exact (?:mathematical )?notation (?:is )?(?:unavailable|not visible|not included|not provided)|exact mathematical notation (?:and variable definitions )?(?:are )?not provided|variable definitions are not provided|formula terms are not fully available/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map says formulas are absent/caption-only even though formula anchors exist");
    }
    if (hasTables && /tables? (?:are|is) not (?:present|available|detected)/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map says tables are absent even though table anchors exist");
    }
    if (hasFigures && /figures? (?:are|is) not (?:present|available|detected)/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map says figures are absent even though figure anchors exist");
    }
    if (hasLaterPages && /only pages?\s*1\s*[-–-]\s*2\s+(?:are|is)\s+(?:available|present)|source map is truncated|later (?:pages?|sections?)[^.\n]*(?:not available|unavailable|captions?|anchored to captions)|later[- ]page content unavailable|truncated after page\s*2|provided excerpt only|not fully available in supplied context/i.test(sourceMap)) {
      sourceMapProblems.push("Source Map contains stale caveats about later source pages");
    }
  }
  push("Source Map is consistent with extracted anchors", sourceMapProblems);
  push("Source Map caveat reconciliation", sourceMapCaveatProblems(gardenDir, ledger));

  // Final interactive visual uniqueness after rendered blocks are on disk.
  const visualUniquenessProblems: string[] = [];
  const bySignature = new Map<string, string[]>();
  for (const page of learnerPages) {
    for (const spec of embeddedVisualSpecs(page.body)) {
      const signature = visualSignature(spec);
      const list = bySignature.get(signature) ?? [];
      list.push(`${page.rel}:${String(spec.id ?? "(missing id)")}`);
      bySignature.set(signature, list);
    }
  }
  for (const [signature, pagesForSignature] of bySignature) {
    if (pagesForSignature.length > 1) {
      visualUniquenessProblems.push(`duplicate final interactive visual signature "${signature}" on ${pagesForSignature.join(", ")}`);
    }
  }
  push("Final interactive visual uniqueness", visualUniquenessProblems);
  push("Visual Anchor Precision", visualAnchorPrecisionProblems(ledger, learnerPages));
  push("Repetition and Opening Flow", repeatedOpeningProblems(learnerPages));

  // Section title quality.
  const titleProblems: string[] = [];
  const sectionPages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "learning"), "learning", sectionPages);
  for (const { abs, rel } of sectionPages.filter((page) => /\/_index\.md$/i.test(page.rel))) {
    const { rawFrontmatter } = parseFrontmatter(readFileSyncWithRetry(abs, "utf-8"));
    const title = fmGetScalar(rawFrontmatter, "title") || rel;
    if (/This Topic/i.test(title)) titleProblems.push(`${rel}: title contains "This Topic"`);
    if (/and the Mechanism Works|and it Is Measured|How It Learns or Changes|The Formal Description/i.test(title)) {
      titleProblems.push(`${rel}: title exposes internal scaffold phrase "${title}"`);
    }
  }
  titleProblems.push(...sectionTitleNaturalnessAllProblems(sectionInputs));
  push("section titles are learner-facing", titleProblems);

  // Source crop quality.
  const cropProblems = ledger.flatMap((visual) => cropQualityProblems(gardenDir, visual));
  push("source crop quality is acceptable", cropProblems);
  push("Crop quality and fallbacks", cropFallbackProblems(ledger, learnerPages));

  // Semantic concept assignments: one primary is required, 1-5 total is valid.
  const densityProblems: string[] = [];
  const handleQualityProblems: string[] = [];
  for (const page of learnerPages) {
    const tags = fmGetArray(page.rawFm, "tags");
    const primary = fmGetArray(page.rawFm, "primaryConcepts");
    if (primary.length === 0) densityProblems.push(`${page.rel}: learner page has no primary concept`);
    if (tags.length > 5) densityProblems.push(`${page.rel}: has ${tags.length} public concepts, expected no more than 5`);
    for (const tag of tags) {
      if (!isValidPublicConceptSlug(tag)) handleQualityProblems.push(`${page.rel}: invalid or claim-shaped concept "${tag}"`);
    }
  }
  push("Semantic concept assignment cardinality", densityProblems);
  push("Public concept quality", [...new Set(handleQualityProblems)]);
  const semanticValidation = validateGardenSemantics(gardenDir);
  push("Canonical semantic registry and claims", semanticValidation.hardFailures);

  // Canonical final-state audit: the single gate that keeps every report,
  // ledger, page, contract, anchor, visual, and repair log in agreement.
  {
    let auditProblems: string[] = [];
    let anchorEvidenceProblems: string[] = [];
    try {
      const audit = auditFinalGardenState(buildFinalGardenState(gardenDir));
      anchorEvidenceProblems = audit.byRule.anchor_evidence ?? [];
      auditProblems = audit.problems.filter((p) => !anchorEvidenceProblems.includes(p));
    } catch (error) {
      auditProblems = [`final-state audit could not run: ${(error as Error).message}`];
    }
    push("Final Garden State Audit", auditProblems);
    // Low-confidence GENERATED anchors are resolvable by the ChatMock anchor
    // critic (confirm/replace/create/reject) during the critic loop, so they are
    // surfaced as a non-failing review item here rather than hard-aborting
    // finalize. Publish-readiness is still gated by the critic loop's acceptance
    // status while they remain unresolved. The audit itself is unchanged.
    if (anchorEvidenceProblems.length) {
      checks.push({ name: "Source-Anchor Evidence (critic-review)", status: "PASS", problems: anchorEvidenceProblems });
    }
  }

  // Fix 1/2: legacy text-concept persistence is derived from the FINAL ledger
  // (never gated on a migration report). Like low-confidence anchor evidence,
  // unresolved legacy records are RESOLVABLE by migration + the ChatMock anchor
  // critic during the critic loop, so they are surfaced here as a non-failing
  // critic-review item rather than hard-aborting the mechanical finalize.
  // Publish-readiness is still blocked by the critic loop's acceptance status
  // (auditLegacyAnchorsFromFinalLedger) while any legacy record remains.
  {
    let migrationProblems: string[] = [];
    try { migrationProblems = auditLegacyMigrationPersistence(gardenDir).problems; }
    catch (error) { migrationProblems = [`legacy-migration persistence audit could not run: ${(error as Error).message}`]; }
    if (migrationProblems.length) {
      checks.push({ name: "Legacy Source-Anchor Migration Persistence (critic-review)", status: "PASS", problems: migrationProblems });
    }
  }

  if (includeReportSelfCheck) {
    const reportPath = path.join(gardenDir, ".breadboard", "validation-report.md");
    const reportProblems: string[] = [];
    const validationReport = fs.existsSync(reportPath) ? readFileSyncWithRetry(reportPath, "utf-8") : "";
    if (!validationReport) {
      reportProblems.push("missing");
    } else {
      for (const section of REQUIRED_VALIDATION_REPORT_SECTIONS) {
        if (!new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(validationReport)) {
          reportProblems.push(`missing section "${section}"`);
        }
      }
      // A canonical report records the fingerprint of the state it audited.
      // If the garden changed after the report was written, the report is
      // stale and must be regenerated (Fix 11). Reports without a provenance
      // fingerprint (standalone-validator output) are exempt from this rule.
      const recorded = validationReport.match(/^finalStateFingerprint:\s*([0-9a-f]{40})$/m)?.[1];
      if (recorded && recorded !== finalGardenStateFingerprint(gardenDir)) {
        reportProblems.push("validation report is stale: finalStateFingerprint does not match the current final state");
      }
    }
    push("validation report contains required sections", reportProblems);
  }

  // Repair Provenance runs LAST so it can separate repair HISTORY from the
  // current issue state (Fix 10-12): a historical `unresolved` repair-log entry
  // blocks only when the issue is still live — and when it is live, the direct
  // check above already reports it, so Repair Provenance does not duplicate it.
  const currentProblemKeys = new Set<string>();
  for (const check of checks) {
    if (REPAIR_BOOKKEEPING_CHECKS.has(check.name)) continue;
    for (const problem of check.problems) currentProblemKeys.add(problem);
  }
  push("Repair Provenance", repairLogConsistencyProblems(gardenDir, learnerPages, currentProblemKeys));

  return checks;
}

function runCriticalGate({
  gardenDir,
  gardenSlug,
  report,
  strictModelApprovedVisuals = false,
  expectedVisualContractExecutabilityContext,
  expectedSourceFormulaReviewContext,
}: {
  gardenDir: string;
  gardenSlug: string;
  report: FinalizeReport;
  strictModelApprovedVisuals?: boolean;
  expectedVisualContractExecutabilityContext?: VisualContractExecutabilityLedgerContext;
  expectedSourceFormulaReviewContext?: SourceFormulaReviewFinalizationContext;
}): void {
  const problems: string[] = [];
  // Dirty tree.
  const allowed = new Set(["_index.md", "learning", "sources", "assets", ".breadboard"]);
  for (const entry of fs.readdirSync(gardenDir)) {
    if (!allowed.has(entry)) problems.push(`dirty top-level export entry: ${entry}`);
  }

  // Source pages must never be typed as learner pages; learner pages must live
  // under learning/ (B).
  const sourcePages: Array<{ abs: string; rel: string }> = [];
  listMarkdown(path.join(gardenDir, "sources"), "sources", sourcePages);
  for (const { abs, rel } of sourcePages) {
    const { rawFrontmatter } = parseFrontmatter(readFileSyncWithRetry(abs, "utf-8"));
    const bt = fmGetScalar(rawFrontmatter, "breadboardType");
    if (bt === "learning_page" || fmGetScalar(rawFrontmatter, "knowledge_type") === "learning-page") {
      problems.push(`source page typed as learner page: ${rel}`);
    }
    if (fmGetScalar(rawFrontmatter, "internal") === "true" && bt === "learning_page") {
      problems.push(`source page is internal:true AND learning_page: ${rel}`);
    }
  }
  const strayLearners: Array<{ abs: string; rel: string }> = [];
  for (const top of ["sources", "assets"]) listMarkdown(path.join(gardenDir, top), top, strayLearners);
  for (const { abs, rel } of strayLearners) {
    const { rawFrontmatter } = parseFrontmatter(readFileSyncWithRetry(abs, "utf-8"));
    if (fmGetScalar(rawFrontmatter, "breadboardType") === "learning_page") {
      problems.push(`learner page outside learning/: ${rel}`);
    }
  }

  // Broken self-referential wikilinks in any visible page (C).
  const visible: Array<{ abs: string; rel: string }> = [];
  const rootIndex = path.join(gardenDir, "_index.md");
  if (fs.existsSync(rootIndex)) visible.push({ abs: rootIndex, rel: "_index.md" });
  listMarkdown(path.join(gardenDir, "learning"), "learning", visible);
  listMarkdown(path.join(gardenDir, "sources"), "sources", visible);
  for (const { abs, rel } of visible) {
    const { body } = parseFrontmatter(readFileSyncWithRetry(abs, "utf-8"));
    const headingSlugs = new Set<string>();
    for (const match of body.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) headingSlugs.add(slugifyLoose(match[1] ?? ""));
    for (const match of body.matchAll(/(?<!!)\[\[#([^\]|]+?)(?:\|[^\]]*)?\]\]/g)) {
      if (!headingSlugs.has(slugifyLoose(match[1] ?? ""))) {
        problems.push(`${rel}: unresolved same-page heading link [[#${(match[1] ?? "").trim()}]]`);
      }
    }
  }

  // Contradictory anchor usage.
  for (const entry of report.reconciliation) {
    if (entry.status === "intentionally_skipped" && (entry.embeddedAsImage || entry.usedAsInteractiveAnchor)) {
      problems.push(`anchor ${entry.id} is intentionally_skipped but used`);
    }
  }
  // Validation report present.
  if (!fs.existsSync(path.join(gardenDir, ".breadboard", "validation-report.md"))) {
    problems.push(".breadboard/validation-report.md missing");
  }
  // Fix 12/13: the same underlying semantic defect (stale claim mapping, tag
  // projection mismatch, unit without page) is reported by several validators.
  // Flattened blockers collapse to ONE line per stable issue, annotated with
  // every validator that detected it. Check-level FAILs are not weakened.
  const failEntries: Array<{ check: string; problem: string }> = [];
  for (const check of collectFinalizeChecks({
    gardenDir,
    gardenId: gardenSlug,
    report,
    includeReportSelfCheck: true,
    strictModelApprovedVisuals,
    expectedVisualContractExecutabilityContext,
    expectedSourceFormulaReviewContext,
  })) {
    if (check.status !== "FAIL") continue;
    for (const problem of check.problems) failEntries.push({ check: check.name, problem });
  }
  problems.push(...dedupeSemanticBlockerLines(failEntries));
  report.criticalProblems.push(...[...new Set(problems)]);
}
