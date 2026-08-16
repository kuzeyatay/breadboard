import fs from "fs";
import { createHash } from "crypto";
import os from "os";
import path from "path";
import type OpenAI from "openai";
import db from "@/lib/db";
import { withCouncil, type CouncilMode, type CouncilTaskType } from "@/lib/council";
import { scrubbed } from "@/lib/watermarks/scrub-text";
import {
  DEFAULT_MODEL,
  cleanGeneratedText,
  refreshClusterIndex,
  scanClusterKnowledge,
} from "@/lib/knowledge";
import { isLearnAuthoredLesson } from "@/lib/learning-garden";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import {
  auditGardenForFinalization,
  finalizeGardenExport,
  repairLearningUnitsFromContract,
  sourceFormulaReviewFinalizationContextFromGarden,
  verifyFinalArtifactNoMutation,
  type SourceFormulaReviewFinalizationContext,
  type UnitRepairRequest,
} from "@/lib/garden-finalize";
import { createOpenAIRepairExecutor } from "@/lib/repair-executor";
import {
  buildCanonicalSourceAnchors,
  describeMissingAnchorFailure,
  missingRegistryAnchorIds,
  type CanonicalSourceAnchor,
} from "@/lib/final-garden-state";
import { freezeActiveGenerationByVersion } from "@/lib/learn-structure-reconciliation";
import { createChatMockAnchorCritic, createChatMockCritic, createChatMockModelRepair, makeCriticArtifactRepair, runCriticLoop } from "@/lib/critic-loop";
import {
  appendGardenEvent,
  pruneVisualArtifacts,
} from "@/lib/visuals";
import {
  learningMapFromModelAuthoredUnits,
  modelAuthoredLearningUnitParseProblems,
  modelAuthoredSourceArtifactOmissionParseProblems,
  normalizeLearningUnits,
  projectModelAuthoredSourceArtifactAssignments,
  projectModelAuthoredSourceArtifactOmissions,
  reconcileLearningUnitSourceArtifacts,
  sameSourceArtifactAssignmentRecords,
  sourceArtifactCoverageProblems,
  sourceArtifactOwnershipProblems,
  validateLearningUnitContracts,
  type LearningUnitContract,
  type RegisteredSourceArtifact,
  type SourceArtifactAssignment,
  type SourceArtifactOmission,
} from "@/lib/learning-unit-contract";
import {
  buildModelAuthoredConceptRegistry,
  claimIdForPlan,
  projectModelAuthoredClaimsToStore,
  writeGardenConceptRegistryAndContract,
} from "@/lib/garden-semantics";
import {
  type SourceFigure,
} from "@/lib/visual-spec";
import {
  extractSourceVisuals,
  computeSourceFormulaReviewSetHash,
  ensureSourcePdfPageSnapshots,
  isFullPageSnapshotUrl,
  loadSourceFormulaReviewSetManifest,
  resolveSourceVisualSourceIdentityMap,
  loadSourceVisuals,
  recordSourceVisualAssignments,
  reviewRequiredSourceFormulaExactText,
  saveSourceFormulaReviewSetManifest,
  sourceSetHashWithReviewedFormulas,
  sourceVisualCachedPageImageUrls,
  sourceVisualSourceIdentityMapHash,
  sourceVisualEmbedUrl,
  sourceVisualMarkdown,
  validateSourceFormulaReviewSet,
  type SourceVisual,
  type SourceFormulaReviewResult,
  type SourceVisualSourceIdentity,
} from "@/lib/source-visuals";
import {
  selectedSourceArtifactInventorySnapshot,
  sourceMapArtifactInventoryTransition,
} from "@/lib/learn-source-artifact-inventory";
import {
  assessLessonQuality,
  buildLearningPageFrontmatter,
  canonicalizeLearnerWikilinks,
  containsRawVisualPlaceholder,
  excludeSyllabusFromSources,
  formatQualityProblemForRepair,
  parseJsonCandidate,
  publicLearningVersionId,
  removeRawVisualPlaceholders,
  safeLearnFileSegment,
  sanitizeLearnerTitle,
  selectLearnSources,
  selectLearnSyllabus,
  sourceAppearsVisualRich,
  sourceSetHashForSources,
  sourceSetHashWithSyllabus,
  stripMarkdownFence,
  stripMarkdownFrontmatter,
  textbookPageFileName,
  textbookSectionFolder,
  validateLearningMapDepth,
  wikilinkForRelPath,
  yamlFrontmatter,
  type LearnConceptSummary,
  type LearnContextSummary,
  type LearnSourceSummary,
  type LearnStatus,
  type FormulaGroundingEntry,
  type QualityProblem,
  type LearningSectionPlan,
  type LearningSubsectionPlan,
  type ProposedLearningMap,
} from "@/lib/learn-utils";
import { extractVerbatimDisplayMath, normalizeQuartzMarkdown } from "@/lib/quartz-markdown";
import {
  attachLearnTokenUsageTracking,
  emptyLearnTokenUsage,
  sumLearnTokenUsage,
  type LearnTokenUsage,
  type LearnTokenUsageEvent,
} from "@/lib/learn-token-usage";
import { transitionLearnTimer } from "@/lib/learn-timer";
import {
  authoredSyllabusLocatorCatalog,
  buildSyllabusCoverageSourceCatalog,
  detectUnavailableCitations,
  modelAuthoredSyllabusPlanProblems,
  projectModelAuthoredSyllabusPlan,
  projectModelAuthoredSyllabusCoverage,
  summarizeSyllabusCoverage,
  syllabusCoverageDecisionProblems,
  unavailableCitationProbes,
  type SyllabusCoverage,
  type SyllabusPlan,
  type UnavailableCitationProbe,
} from "@/lib/learn-syllabus";
import {
  runSyllabusCoverageEvidenceRecovery,
  syllabusCoverageHasTeachableUnits,
  syllabusCoverageRecoveryReceiptProblems,
  type SyllabusCoverageEvidenceRecoveryReceipt,
  type SyllabusCoverageRecoveryProviderRequest,
} from "@/lib/learn-syllabus-coverage-recovery";
import {
  loadVisualDecisionOverrides,
  saveVisualNecessityArtifacts,
  type GardenVisualNecessityPlan,
} from "@/lib/visual-necessity";
import {
  buildModelVisualNecessityPacket,
  runModelVisualNecessityPlanning,
} from "@/lib/model-visual-necessity";
import { runLearningSpineTargetedRepair } from "@/lib/model-learning-spine-repair";
import {
  describeLearningSpineRepairAttempts,
  learningSpineFullRepairFeedback,
  recordLearningSpineFullRepairCandidate,
  startLearningSpineFullRepairLineage,
  type LearningSpineFullRepairFeedback,
} from "@/lib/learning-spine-full-repair";
import {
  modelSourcePageAnchors,
  selectedStructuralSourcePageHints,
  type ModelSourcePageAnchorRecord,
  type SelectedStructuralSourcePageHint,
} from "@/lib/model-source-anchor-ledger";
import { learnBuildStateMode } from "@/lib/garden-build/mode";
import { runCanonicalGardenShadowBuild } from "@/lib/garden-build/shadow";
import {
  buildVisualizationCoverageReport,
  applyVisualizationRoutesToLearningUnits,
  coverageGateMode,
  saveVisualizationCoverageReport,
  saveVisualizationPlan,
  type VisualizationPlan,
  type VisualizationPublicationOutcome,
} from "@/lib/visualization-opportunities";
import {
  buildVisualizationContractRepairPrompt,
  buildVisualizationPlanWithContractRepair,
  type VisualizationContractRepairPacket,
} from "@/lib/visualization-contract-repair";
import {
  canonicalVisualizationEvidenceByUnit,
  declaredVisualizationSourceAnchorIdsForUnit as declaredSourceAnchorIdsForUnit,
} from "@/lib/visualization-canonical-evidence";
import {
  AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH,
  renderAuthoritativeLearningUnitContractMarkdown,
} from "@/lib/learning-unit-contract-markdown";
import {
  buildVisualContractExecutabilityLedger,
  buildFinalVisualizationPlanFromRoutedContracts,
  reviewVisualizationPlanExecutability,
  saveVisualContractExecutabilityLedger,
  strictVisualContractExecutabilityResponseOrExactRaw,
  VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH,
  type VisualContractExecutabilityProviderRequest,
} from "@/lib/visualization-contract-executability";
import {
  buildGeneratedVisualBlock,
  createGeneratedVisualization,
  GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
} from "@/lib/generated-visuals";
import {
  normalizeLearnOperationMode,
  type LearnOperationMode,
  type LegacyLearnOperationMode,
  type StartLearnOperationRequest,
} from "@/lib/learn-operation-mode";
import { executeLearnScopedRepair, type LearnScopedRepairResult } from "@/lib/learn-scoped-repair";
import {
  acquireGardenLearnLease,
  acquireGardenLearnLock,
  LOCK_STALE_MS,
  promoteStagingGarden,
  type GardenLearnLease,
} from "@/lib/learn-atomic-promotion";
import {
  createLearnBuildWorkspace,
  defaultWorkspaceRoot,
  disposeLearnBuildWorkspace,
  fingerprintDurableGardenState,
  verifyAuthoritativeSourceAnchorLedger,
  type LearnBuildWorkspace,
} from "@/lib/learn-build-workspace";
import {
  clearGeneratedLearnState,
  type LearnFilesystemClearResult,
} from "@/lib/learn-clear";
import {
  clearLearnDatabaseRecords,
  type LearnDatabaseClearResult,
} from "@/lib/learn-clear-database";
import { clearLearnSemanticChunks } from "@/lib/semantic-retrieval";
import type { GardenIssue } from "@/lib/garden-build/issues";

export type {
  LearnStatus,
  LearningSectionPlan,
  LearningSubsectionPlan,
  ProposedLearningMap,
};

export type LearnMode = LearnOperationMode;

export interface LearnJob {
  id: string;
  gardenId: string;
  userId?: number;
  model: string;
  status: LearnStatus;
  mode: LearnMode;
  currentStep: string;
  progressPercent: number;
  currentSectionTitle?: string;
  currentPageTitle?: string;
  error?: string;
  proposedLearningMapId?: string;
  confirmedLearningMapId?: string;
  latestTextbookVersionId?: string;
  sourceSetHash?: string;
  sourceIds: string[];
  /** Slug of the document designated as this run's syllabus (study guide). */
  syllabusSourceId?: string;
  sourceOnly: boolean;
  includeSourceSnapshots: boolean;
  tokenUsage: LearnTokenUsage;
  elapsedMs: number;
  timerStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredLearningMap {
  id: string;
  gardenId: string;
  jobId: string;
  status: "proposed" | "confirmed";
  sourceMap: unknown;
  scopeContract: unknown;
  learningMap: ProposedLearningMap;
  proposedOrder: LearningSectionPlan[];
  visualOpportunities: unknown[];
  coveragePlan: unknown;
  sourceSetHash: string;
  /** Exact selected-source visual inventory supplied to the authored Source Map. */
  sourceArtifactInventoryHash: string;
  sourceIds: string[];
  /** Slug of the document this map was planned against as its syllabus. Page
   * generation re-reads it so lessons follow the same study guide the plan did. */
  syllabusSourceId?: string;
  /** The syllabus read into units + the availability check of every work it
   * assigns. Persisted so page writing gates on the same answer planning did,
   * without a second model call that could resolve differently. */
  syllabusCoverage?: SyllabusCoverage | null;
  createdAt: string;
  confirmedAt?: string;
}

export interface LearnStatusSnapshot {
  job: LearnJob | null;
  proposedLearningMap: ProposedLearningMap | null;
  confirmedLearningMapId?: string;
  latestTextbookVersionId?: string;
  hasSources: boolean;
  sourceCount: number;
  selectedSourceIds: string[];
  selectedSourceCount: number;
  /** Document designated as the syllabus, or null when the run has none. */
  syllabusSourceId: string | null;
  /** What the syllabus asked for versus what this garden can actually teach.
   * Null until a run has read the syllabus. */
  syllabusCoverage: {
    unitCount: number;
    materialCount: number;
    availableCount: number;
    missingCount: number;
    genericCount: number;
    missingCitations: string[];
  } | null;
  hasTextbook: boolean;
  sourceSetChanged: boolean;
  buttonLabel: string;
  validationReport?: LearnValidationReport | null;
  scopedRepair?: LearnScopedRepairSummary | null;
}

export interface LearnScopedRepairSummary {
  repairId: string;
  issueCount: number;
  unitIds: string[];
  pageIds: string[];
  sectionIds: string[];
  visualIds: string[];
  allowedFiles: string[];
  changedFiles: string[];
  modelCalls: number;
  blockersBefore: number;
  blockersAfter: number;
  unaffectedPageHashesVerified: boolean;
  accepted: boolean;
  publishReady: boolean;
  reason: string;
}

export interface LearnValidationReport {
  relativePath: string;
  url: string;
  markdown: string;
  truncated: boolean;
  accepted?: boolean;
  generatedAt?: string;
}

interface LearnJobRow {
  id: string;
  garden_id: string;
  user_id: number | null;
  model: string | null;
  status: LearnStatus;
  mode: LearnMode;
  current_step: string | null;
  progress_percent: number | null;
  current_section_title: string | null;
  current_page_title: string | null;
  error: string | null;
  proposed_learning_map_id: string | null;
  confirmed_learning_map_id: string | null;
  latest_textbook_version_id: string | null;
  source_set_hash: string | null;
  source_ids_json: string | null;
  syllabus_source_id: string | null;
  source_only: number | null;
  include_source_snapshots: number | null;
  active_elapsed_ms: number | null;
  timer_started_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LearnJobTokenUsageRow {
  job_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  started_requests: number | null;
  completed_requests: number | null;
  reported_requests: number | null;
  estimated_requests: number | null;
  usage_updated_at: string | null;
}

interface LearnMapRow {
  id: string;
  garden_id: string;
  job_id: string;
  status: "proposed" | "confirmed";
  source_map_json: string;
  scope_contract_json: string;
  learning_map_json: string;
  proposed_order_json: string;
  visual_opportunities_json: string;
  coverage_plan_json: string;
  source_set_hash: string;
  source_artifact_inventory_hash: string;
  source_ids_json: string | null;
  syllabus_source_id: string | null;
  syllabus_coverage_json: string | null;
  created_at: string;
  confirmed_at: string | null;
}

interface LearnVersionRow {
  id: string;
  garden_id: string;
  job_id: string;
  learning_map_id: string;
  source_set_hash: string;
  source_artifact_inventory_hash: string;
  page_count: number;
  backup_dir: string | null;
  created_at: string;
}

interface LearnSourceContext extends LearnContextSummary {
  baseSourceSetHash: string;
  sourceSetHash: string;
  sourceFormulaReviewSetHash?: string;
  /** Versioned canonical inventory of every selected planner-visible source artifact. */
  sourceArtifactInventoryHash: string;
  /** Durable garden-global S<n> ownership; never compacted to this run's selection. */
  sourceVisualSourceIdentityMap: SourceVisualSourceIdentity[];
  sourceFigures: SourceFigure[];
  existingTextbookPages: LearnSourceSummary[];
  conceptNodes: LearnConceptSummary[];
  /** The designated study guide, kept out of `sources` so it steers the lessons
   * instead of becoming one of them. */
  syllabus: LearnSourceSummary | null;
  /** Every document the user selected, syllabus included. Persisted on the job
   * and map so a confirmed run re-derives exactly this split later. */
  selectedSourceIds: string[];
}

interface CouncilCallResult {
  content: string;
  councilRunId?: string;
  councilMode?: string;
}

/**
 * Fallback model for Learn.
 *
 * Learn used to be pinned to this model on the grounds that a Council workload
 * should not drift with the interactive assistant's picker. That is no longer
 * the behaviour: the Learn panel runs on whatever model the user has selected,
 * so one choice governs every AI call Breadboard makes. This constant is what
 * that resolution falls back to when the user has expressed no preference.
 *
 * The trade-off is real — a model with a smaller context window or weaker
 * instruction-following will produce a weaker garden here than it does in chat.
 */
export const LEARN_MODEL = "gpt-5.6-sol";
export const LEARN_REASONING = {
  effort: "high",
  summary: "detailed",
} as const;

type CouncilJsonResult = CouncilCallResult & { parsed: unknown | null };

interface GeneratedPageRecord {
  title: string;
  relPath: string;
  learningUnitId?: string;
  sourceAnchors: string[];
  visualIds: string[];
  sourceFigureIds: string[];
  sourceFormulaIds: string[];
  sourceTableIds: string[];
}

// --- Learn generation token-budget configuration ----------------------------
// Planning, page writing, and repair use configurable council modes guarded by
// deterministic quality gates. Defaults are token-efficient; env vars can
// loosen them for slower, heavier reasoning when needed.

const COUNCIL_MODE_VALUES: readonly CouncilMode[] = [
  "direct_council",
  "lite_council",
  "full_council",
  "evolution_council",
];

function envCouncilMode(name: string, fallback: CouncilMode): CouncilMode {
  const value = process.env[name];
  return (COUNCIL_MODE_VALUES as readonly string[]).includes(value ?? "")
    ? (value as CouncilMode)
    : fallback;
}

function envPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function envClampedPositiveInt(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(minimum, Math.min(maximum, envPositiveInt(name, fallback)));
}

const LEARN_FINALIZE_MAX_ROUNDS = envClampedPositiveInt(
  "LEARN_FINALIZE_MAX_ROUNDS",
  8,
  1,
  12,
);
const LEARN_FINALIZE_MAX_RUNTIME_MS = envClampedPositiveInt(
  "LEARN_FINALIZE_MAX_RUNTIME_MS",
  45 * 60 * 1000,
  30 * 1000,
  2 * 60 * 60 * 1000,
);

/** Council mode for normal subsection/page writing. Never full_council by default. */
const LEARN_GENERATION_COUNCIL_MODE = envCouncilMode(
  "LEARN_GENERATION_COUNCIL_MODE",
  "direct_council",
);
/**
 * Council mode for planning. `direct_council` is a single upstream model call
 * per stage; `lite_council` fans out to three sequential calls (candidate →
 * review → synthesis) and `full_council` to many. Planning runs THREE stages
 * back to back (source map → scope contract → learning spine), so a fan-out
 * mode multiplies upstream latency by ~3–9x and is the reason planning kept
 * exceeding the request timeout. Default to the single-call path; raise the env
 * var only when you deliberately want heavier planning deliberation.
 */
const LEARN_PLANNING_COUNCIL_MODE = envCouncilMode(
  "LEARN_PLANNING_COUNCIL_MODE",
  "direct_council",
);
/** Council mode for revision/repair calls. Never full_council by default. */
const LEARN_REVISION_COUNCIL_MODE = envCouncilMode(
  "LEARN_REVISION_COUNCIL_MODE",
  "direct_council",
);
/**
 * Per-call planning timeout. A chatmock council request fans out to several
 * upstream model calls (each allowed up to 10 minutes server-side), so the
 * default OpenAI-client timeout of 10 minutes aborts planning calls that were
 * still legitimately working — which is why "Request timed out." fallbacks
 * fired on every Learn press. The client must outwait the council.
 */
const LEARN_PLANNING_TIMEOUT_MS = envPositiveInt(
  "LEARN_PLANNING_TIMEOUT_MS",
  25 * 60 * 1000,
);
const LEARN_VISUAL_MAX_REPEATED_INTERACTION_SIGNATURE = 1;
/** Council mode for the retry after a planning timeout. A single-model call is
 * far more likely to finish inside the window than another full fan-out, so
 * both attempts fail, planning fails closed without a synthetic curriculum. */
const LEARN_PLANNING_RETRY_COUNCIL_MODE = envCouncilMode(
  "LEARN_PLANNING_RETRY_COUNCIL_MODE",
  "direct_council",
);
/** Explicit full-generation attempts per page. This loop is never entered by
 * scoped repair; only generate/full_rebuild may create fresh page drafts. */
const MAX_PAGE_ATTEMPTS = Math.max(
  1,
  Math.min(2, envPositiveInt("LEARN_MAX_PAGE_ATTEMPTS", 2)),
);
const MAX_TOTAL_SOURCE_CHARS_PER_PAGE = envPositiveInt(
  "LEARN_MAX_TOTAL_SOURCE_CHARS_PER_PAGE",
  24_000,
);
/** Developer-only escape hatch: revise every page even when the quality gate
 * passes. Off by default — revision is normally hard-fail-only. */
const LEARN_ENABLE_UNCONDITIONAL_REVISION =
  process.env.LEARN_ENABLE_UNCONDITIONAL_REVISION === "true";

/** Compact JSON for prompts. Pretty-printed JSON is reserved for debug
 * artifacts on disk; whitespace in prompt JSON is pure token waste. */
function compactJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function logPromptBudget(
  label: string,
  system: string,
  user: string,
  sourceContext?: unknown,
): void {
  if (process.env.LEARN_LOG_PROMPT_BUDGET === "false") return;

  const sourceText = sourceContext ? JSON.stringify(sourceContext) : "";
  const totalChars = system.length + user.length + sourceText.length;

  console.log(`[learn-token-budget] ${label}`, {
    systemChars: system.length,
    userChars: user.length,
    sourceContextChars: sourceText.length,
    totalChars,
    approxInputTokens: approxTokens(system + user + sourceText),
  });
}

// Voice rules shared by every prose-producing prompt. The generated garden is a
// standalone lesson on the topic; the uploaded source grounds it silently.
const LEARNER_VOICE_RULES = `Voice rules (hard requirements):
- Write a direct lesson on the topic itself, never a commentary on the uploaded document.
- The learner must feel they are reading a lesson on the topic, not a review of a PDF.
- NEVER use the word "textbook" anywhere.
- NEVER frame content as "the paper says", "the source frames", "in this paper", "the source material explains", "source-derived", "source-central", "according to the source". The source grounds the content silently.
- Teaching sentences take the concept as their subject ("A spiking neuron carries information in discrete events"), never the document ("The paper introduces spiking neurons").
- Stay within what the source material supports; grounding is silent, not narrated.`;

const TITLE_RULES = `Title rules (hard requirements):
- Titles name the concept the learner will understand, standalone.
- Bad: "Why the Source Turns from Conventional Neural Networks to SNNs", "What Spiking Neural Networks Are in This Paper", "Source-Derived Comparative Results", "The Named Neuron Model LIF as Source-Central Evidence".
- Good: "Why Spiking Neural Networks Exist", "Spikes, Timing, and Event-Driven Computation", "The Leaky Integrate-and-Fire Neuron", "How SNNs Learn", "Accuracy, Latency, Energy, and Spike Count", "Choosing an SNN Training Strategy".
- Never contain "paper", "source", "textbook", or "overview" in a title.`;

const SOURCE_MAP_PROMPT = `You create the internal Source Map for a Breadboard learning garden. This document is internal planning data; learners never see it.
Return ONLY JSON with this exact top-level shape:
{
  "sources": [{
    "id": "exact supplied source id",
    "title": "exact supplied source title",
    "role": "what this source contributes",
    "centralConcepts": ["concise source-grounded concept"],
    "formulas": ["registered formula id plus concise purpose"],
    "examples": ["concise source-grounded example"],
    "questions": ["question the material can answer"],
    "caveats": ["only genuinely unsupported or unclear material"]
  }],
  "figures": [{
    "id": "exact id from supplied sourceVisuals",
    "sourceId": "exact supplied source id",
    "kind": "figure | graph | table | formula",
    "caption": "concise caption",
    "teachingValue": "what this registered artifact can teach"
  }],
  "sourceAnchors": [{
    "id": "exact id copied from supplied canonicalSourceAnchors",
    "sourceId": "exact supplied source id",
    "title": "short anchor title",
    "summary": "concise supported content"
  }],
  "missingOrUnclear": ["only genuinely missing or unclear content"]
}
Return exactly one sources entry for every supplied source id and no unknown source. Keep the map concise: at most 30 central concepts, at most 40 selected sourceAnchors per source, and at most 20 entries in each other per-source list.
Every figures id must be copied from supplied sourceVisuals; prose mentions do not create registered artifacts.
Every sourceAnchors id must be copied verbatim from supplied canonicalSourceAnchors and must retain its matching sourceId. The catalog records structural Markdown pages and registered source artifacts; you decide which evidence matters, while code only verifies and projects your choices. Never invent, rewrite, or fuzzy-match an anchor id.
Availability rule (hard): any formula, equation, figure, table, or graph that has an extracted anchor or caption IS available source material. Never place it in missingOrUnclear, and never write caveats saying formulas/equations/notation/definitions/tables/figures are unavailable, "caption-only", "captions but not exact", or "not present" — pages will ground on those anchors. Caveat ONLY about content that has no extracted anchor at all.
Stay source-aware. If source-only mode is true, do not add outside facts.`;

const SCOPE_CONTRACT_PROMPT = `You create the internal Scope Contract for a Breadboard learning garden. This document is internal planning data; learners never see it.
Return ONLY JSON with exactly these six arrays of concise strings: included, excluded, background, deferred, sourceEmphasis, and caveats. included and sourceEmphasis must be non-empty. Do not return prose outside the JSON object.
The contract must protect source scope: no unsupported expansion, no disconnected topic cards, and no final Generated Subtopics pages.
Availability rule (hard): treat any extracted formula, equation, figure, table, or graph anchor as available. Do not add caveats claiming formulas, notation, definitions, tables, or figures are unavailable or caption-only when anchors for them exist.`;

const TOPIC_MAP_PROMPT = `You create the source-grounded Learning Unit Contract and its section spine for a Breadboard learning garden. Author 15-25 learning units first, then assign every unit to a model-authored section in the same response. Code will validate and project your section decisions verbatim; it will not cluster, title, or explain sections for you.
Return ONLY JSON with this shape:
{
  "title": "Topic title (the subject itself, e.g. 'Spiking Neural Networks')",
  "summary": "short description of what the learner will be able to do",
  "learningUnits": [
    {
      "id": "U1",
      "title": "One precise teaching step",
      "role": "motivation | core_concept | mechanism | formula | worked_example | training_method | metric | result_interpretation | comparison | application | limitation | synthesis",
      "learningQuestion": "one conceptual learner question this unit answers",
      "prerequisiteConcepts": ["..."],
      "newConcepts": ["..."],
      "syllabusUnitIds": ["exact syllabusCoverage.units[].unitId; empty when no syllabus is supplied"],
      "sourceAnchors": ["exact canonical source anchor ids"],
      "sourceFigures": [
        {
          "id": "S1.P4.F1",
          "placement": "inside_concept_explanation | after_formula_introduction | inside_result_interpretation | beside_worked_example | inside_comparison",
          "mustBeDiscussedWith": "nearby idea or paragraph",
          "interpretationGoal": "what the learner must notice"
        }
      ],
      "sourceFormulas": [
        {
          "id": "S1.P6.E1",
          "teachingGoal": "what the formula teaches",
          "termsToDefine": ["symbol or term"],
          "placement": "before_example | inside_metric_definition | inside_result_interpretation"
        }
      ],
      "sourceTables": [
        {
          "id": "S1.P7.T1",
          "teachingGoal": "what the comparison/result table teaches",
          "rowsOrColumnsToExplain": ["row or column"],
          "placement": "inside_comparison | inside_result_interpretation"
        }
      ],
      "semanticConcepts": [
        {
          "slug": "stable-reusable-concept-slug",
          "preferredLabel": "Human-readable concept label",
          "role": "primary | supporting",
          "aliases": ["acronym or equivalent label"],
          "evidenceAnchors": ["source anchor ids"]
        }
      ],
      "knowledgeClaims": [
        {
          "text": "One readable source-grounded statement.",
          "subject": "canonical-concept-slug",
          "predicate": "prerequisite-of | causes | enables | derived-from | measured-by | contrasts-with | example-of | part-of | applies-to | limits | emits-when | related-to",
          "object": "optional-canonical-concept-slug",
          "evidenceAnchors": ["source anchor ids"]
        }
      ],
      "zettelNotes": [
        {
          "handle": "canonical-atomic-handle",
          "claim": "one readable atomic note",
          "connectedTo": ["another-canonical-handle"]
        }
      ],
      "mustNotRepeat": ["motif, framing, or example already used"],
      "expectedWordRange": [700, 1100],
      "sectionPlan": {
        "id": "S1",
        "title": "A specific learner-facing section title",
        "purpose": "What this section teaches and why these units belong together",
        "singleSubsectionReason": "required only when this section intentionally contains one unit"
      }
    }
  ],
  "sourceArtifactOmissions": [
    {
      "sourceArtifactId": "exact id copied from extractedSourceArtifacts",
      "reason": "specific source-grounded reason this artifact should not be taught in this garden"
    }
  ],
  "warnings": ["..."]
}
${TITLE_RULES}
Contract rules:
- Generate learningUnits first and encode their section ownership in each unit's sectionPlan object. Do not return a separate nested section/subsection map.
- Author syllabusUnitIds from exact supplied syllabusCoverage unit IDs. With a syllabus, every learning unit must name at least one syllabus unit it serves; without one, return an empty array. Code never guesses this mapping from title overlap.
- Author 4-7 sections in learner order. A section normally owns 2-5 contiguous units. If one unit must stand alone, repeat a precise singleSubsectionReason on that section's unit. Reuse the exact same section id, title, purpose, and singleSubsectionReason on every unit assigned to that section.
- Section titles and purposes are learner-facing semantic content. They must be specific to this garden; code will never synthesize or repair them.
- A unit is the smallest meaningful teaching step: one learner question, one conceptual move.
- Normal source-rich gardens need 15-25 units; never produce an 8-section/1-subsection outline.
- Partition every entry in extractedSourceArtifacts exactly once. Assign it to the one precise unit where it teaches best, or put its exact id in the garden-wide sourceArtifactOmissions array with your specific reason. Never forget an artifact, assign it twice, both assign and omit it, or invent a generic omission reason.
- sourceArtifactOmissions is required even when empty. Omissions are not learning-unit ownership: do not use sourceFigures.placement="not_used_with_reason" in the active contract.
- IDs in sourceFigures, sourceTables, and sourceFormulas may ONLY be copied verbatim from extractedSourceArtifacts. A figure-like ID mentioned in source prose is not a registered artifact and must never be used unless that exact ID is present in extractedSourceArtifacts.
- Every structured artifact ID (Sx.Py.Fn, Sx.Py.Gn, Sx.Py.Tn, or Sx.Py.En) used anywhere in a unit, including sourceAnchors and evidenceAnchors, must be present in extractedSourceArtifacts with the matching kind.
- Source figures must be planned for inline placement near their interpretation. Never plan a generic "Source Figures" dump.
- Do not assign an interactiveVisual or visualType in this response. A separate whole-garden AI review authors visual necessity, alternative-medium choice, and a typed learner-control contract after this learning spine passes validation.
- Describe each unit's learning question, dynamic behavior, comparisons, parameters, source figures, formulas, tables, and prerequisites precisely enough for that source-grounded model review. Code validates its evidence and behavior but never invents a pedagogical visual decision.
- Concepts are reusable identities, never complete claims, page-title summaries, filenames, locations, or planner phrases. Reuse an existing canonical slug or alias whenever possible.
- Every unit must explicitly contain semanticConcepts with one or two primary concepts. Code will never infer missing concepts or claims from titles, roles, or zettel notes.
- When a semanticConcept slug appears in multiple units, author exactly the same preferredLabel and exactly the same aliases array (the same values in the same order) for every occurrence. The concept registry rejects inconsistent repeated identities; code will never choose or merge a label or alias set for you.
- Every normalized alias must belong to exactly one concept. Never use another concept's slug or preferred label as an alias, and never assign the same alias to multiple concepts.
- Mark one or two genuinely central concepts primary. Use supporting concepts only when they materially help retrieval or graph traversal.
- Plan 1-5 public concepts per learner unit. Never add filler to satisfy a target count.
- Claims are readable source-grounded statements kept separately from public tags. Zero claims is valid when the material supports none.
- Never turn claim text into a concept slug and never create role-template claims. Claim endpoints must use concept slugs from semanticConcepts.
- First job: planning only. Do not generate final prose yet.`;

const SYLLABUS_READING_PROMPT = `You read a course syllabus / study guide and extract its structure. This is internal planning data; learners never see it.
Return ONLY JSON with this shape:
{
  "courseTitle": "the course's own title, if stated",
  "units": [
    {
      "id": "SU1",
      "label": "the syllabus's own numbering, e.g. 'Week 1', 'Module 2', 'Session 3'",
      "title": "what this unit teaches",
      "objectives": ["a learning objective or outcome exactly as the syllabus states it"],
      "topics": ["a topic this unit covers"],
      "materialIds": ["ids of the referencedMaterials this unit assigns"]
    }
  ],
  "referencedMaterials": [
    {
      "id": "R1",
      "citation": "the reference exactly as the syllabus writes it",
      "title": "the work's title alone, without chapter/page numbers",
      "authors": ["surname or full name as written"],
      "kind": "textbook | chapter | paper | reading | lecture | slides | dataset | video | other",
      "locator": "the assigned part, e.g. 'ch. 3', 'pp. 40-58'",
      "required": true
    }
  ]
}
Extraction rules:
- Extract only what the syllabus actually says. Never invent a unit, objective, topic, author, or reading.
- Every book, chapter, paper, article, dataset, slide deck, or handout the syllabus points at belongs in referencedMaterials — required and optional alike, with "required" set accordingly.
- Put the work's own title in "title" and the assigned part in "locator". "Smith, Neural Dynamics, ch. 3" has title "Neural Dynamics" and locator "ch. 3".
- A reference with no identifiable work ("Readings TBD", "Lecture 4 slides") still belongs in the list; leave "title" empty.
- Link each unit to its readings through materialIds. A unit that assigns nothing gets an empty list.
- If the document has no unit/week structure, return one unit covering the whole course.
- If the document is not a syllabus or study guide at all, return empty units and referencedMaterials.`;

const SYLLABUS_COVERAGE_PROMPT = `You decide which exact syllabus materials are present in the user's selected source documents and which syllabus units those sources can teach. This is a semantic evidence review. Code will only validate your JSON, exact IDs, copied citations, completeness, and internal consistency; code will never match titles, infer availability, or decide teachability for you.

Return ONLY JSON with this exact shape:
{
  "resolutions": [
    {
      "materialId": "exact referencedMaterials id",
      "citation": "exact citation copied byte-for-byte from referencedMaterials",
      "status": "available | missing | generic",
      "sourceIds": ["exact selected source id that satisfies this full citation"],
      "matchReason": "specific canonical raw page or unpaged source evidence for this verdict"
    }
  ],
  "units": [
    {
      "unitId": "exact syllabus unit id",
      "availableSourceIds": ["exact selected source id that can support this unit"],
      "missingCitations": ["exact citation of each assigned material you resolved missing"],
      "teachable": true,
      "coverageReason": "what the selected sources do or do not support for this unit"
    }
  ]
}

Hard rules:
- Return exactly one resolution for every referenced material and exactly one coverage record for every syllabus unit, in the supplied order. Never omit or add records.
- Judge each material from the supplied source catalog. \`selectedSourceCatalog.sourceRecords[].navigationMetadata\` (including title, description, excerpt, and planningIndex) is generated navigation context and can never prove a bibliographic title, author, chapter, page, or locator. Exact sourceId, sourceFile, and relPath are routing identity only. \`canonicalRawPageEvidence.pages\` and \`unpagedEvidence\` are the bounded verbatim source material: each page record carries its exact sourceId, pageNumber, and complete raw text in document order. Use only exact supplied source IDs.
- \`selectedSourceCatalog.authoredLocators\` copies the syllabus's locator strings verbatim. It never selects a source page or establishes that a source satisfies one. The catalog may omit complete raw pages only because of its explicit transport bounds. An omittedPageCount or truncated flag is transport metadata, never proof that a citation is present. When the supplied canonical raw evidence does not visibly establish the full citation's title/authors and locator, author \`missing\`; never infer it from navigation metadata, a filename, subject overlap, or a locator string alone.
- "available" requires direct evidence that an uploaded source satisfies the FULL citation. Match title/authors AND any locator such as chapter, section, or page range. A matching book title alone never proves that an assigned chapter or page range is present. Put one or more satisfying source IDs in sourceIds.
- "missing" means the citation identifies a work or assigned part but the supplied evidence does not establish that it is present. Use an empty sourceIds array. Do not guess from subject overlap.
- "generic" is only for a reference that identifies no checkable work, such as "Readings TBD". Use an empty sourceIds array.
- Preserve each citation exactly as supplied. In each unit, missingCitations must contain exactly its assigned materials resolved "missing", in syllabus material order. Distinct assigned material IDs can copy the same exact citation: retain one occurrence for every such missing material ID and never de-duplicate it. Generic references are not missing citations.
- For each unit, independently author whether the selected sources genuinely support its objectives and topics in full. teachable is the sole authorization for the planner to generate lessons. If true, select every source the planner should ground it in.
- An unteachable unit may still have partial or direct source support. When an assigned material is available, list at least one exact selected source for that material in availableSourceIds, keep teachable false if the evidence cannot support the unit in full, and explain that limitation in coverageReason. Use an empty availableSourceIds array only when no selected source directly supports an assigned available material. Never flip teachable merely to satisfy an array condition.
- A missing REQUIRED material is strong evidence against teachability, but another uploaded source may support the unit if its supplied content directly covers the objectives and topics; explain that evidence. A missing OPTIONAL material does not by itself make the unit unteachable. Required/optional is semantic input for your verdict, never a code rule.
- If an assigned material is available, the unit's availableSourceIds must include at least one source selected for that material.
- Never claim that a source contains a chapter, fact, process, example, or result that is not visible in the supplied evidence.`;

/**
 * Extra planning rules that apply only when the user designated a syllabus.
 * A syllabus is the course's own statement of what must be learned, so it
 * outranks the planner's judgment about scope, ordering, and emphasis — but it
 * can never invent material the sources do not support.
 */
const SYLLABUS_PLANNING_RULES = `
Syllabus (hard requirements):
- A syllabus (study guide / course outline) was provided as \`syllabus\`, already read into \`syllabusCoverage\`. It states what this course must teach, in what order, and to what depth.
- The syllabus is NOT source material and is NOT a topic. Never write a page about the syllabus, never cite it as a source, never treat its headings as content to summarize, and never mention it in learner-facing text.
- Treat \`syllabusCoverage.units\` as the required plan: work through them in order, cover each unit's objectives and topics, and match the depth each is given. An item the syllabus treats as central earns a full learning unit; background or optional items earn proportionally less.
- Source material that no syllabus unit covers is out of scope. Exclude it rather than adding units for it.

Material availability (hard requirements — this is what stops fabrication):
- A separate source-grounded model has already reviewed every work the syllabus assigns against the exact selected-source catalog. Its authored coverage decision is authoritative for this run. Do not second-guess it.
- \`unit.availableSourceIds\` lists documents with direct support for at least part of that unit. For a unit whose \`teachable\` verdict is true, ground it heavily and specifically in those documents: its definitions, figures, formulas, numbers, and examples come from there first, and only then from the rest of the garden.
- \`unit.teachable\` is the sole authorization to create learning units. If it is false, do not plan or generate a learning unit for that syllabus item even when \`availableSourceIds\` records partial support. Partial support never overrides an unteachable verdict.
- \`unit.missingCitations\` lists works the syllabus assigns that NOBODY UPLOADED. You have never seen their contents. Never plan a unit, anchor, figure, formula, result, or claim that depends on them. Never summarize, paraphrase, characterize, or state what such a work says, argues, shows, or concludes. Never name one in learner-facing text.
- Cover a syllabus topic whose material is missing ONLY from the source material that IS present, and only as far as that material genuinely supports. If it does not support the topic, leave the topic uncovered and record it in warnings.
- \`syllabusCoverage.untaughtUnitTitles\` lists units the coverage review judged unteachable from the selected sources, including units with only partial support. Do not create learning units for them. Record each one in warnings as an uncoverable syllabus item.
- Every warning about missing material must name the syllabus item, never invent a substitute for it.`;

/** Page-writing rules that apply only when a syllabus is in play. */
const SYLLABUS_PAGE_RULES = `
Syllabus:
- \`dossier.syllabus\` is the course study guide. Use it only to judge what this page must cover and how deep to go.
- Never mention, quote, cite, or describe the syllabus in the lesson. The learner reads a lesson on the subject, not a walkthrough of their course outline.
- \`dossier.syllabusUnits[].objectives\` are what the learner must be able to do after this page. Teach to them.
- \`dossier.unavailableCitations\` lists works the course assigns that are NOT in this garden. You have never read them. Never name, quote, summarize, paraphrase, or state the findings of anything on that list, and never imply the page is based on one. Teach only from the source material provided in this dossier.`;

/** Append syllabus rules to a base prompt only when a syllabus is present, so
 * runs without one keep their existing prompts byte-for-byte. */
function withSyllabusRules(basePrompt: string, rules: string, hasSyllabus: boolean): string {
  return hasSyllabus ? `${basePrompt}\n${rules}` : basePrompt;
}

const OVERVIEW_PROMPT = `Write the Topic Overview page: the first page a learner reads in this Breadboard learning garden.
Return Markdown body only, no frontmatter.
${LEARNER_VOICE_RULES}
Include what the topic is about, how to learn it, the recommended reading order with wikilink-style labels for sections/subsections, and honest scope notes (what this garden does and does not cover) phrased around the topic, not around the uploaded files.
Do not create disconnected notes and do not include raw visual placeholders.`;

// Concrete style rules reused by the writing and revision prompts.
const DEPTH_RULES = `Teach from first principles so a motivated beginner with minimal background understands the concept:
1. Open with the simplest concrete situation that makes the concept necessary. A short scenario ("Imagine a sensor watching a mostly still scene…") beats an abstract statement.
2. Explain why the concept is needed — what breaks or is wasteful without it.
3. Build the mechanism one step at a time. Each sentence should add one idea the previous sentence set up.
4. Introduce a term only at the moment the learner needs it, and explain it in plain words the first time.
5. Introduce a formula only after motivating it, then define every symbol and say what the formula lets you compute.
6. Put at least one concrete example, analogy, or worked interpretation right after the idea it illustrates.
7. Weave assigned source figures/tables into the flow and INTERPRET them (what the shape/trend/number means), never just caption them.
8. Mention a common beginner confusion only when it genuinely helps, and resolve it by explaining the correct picture.
9. End by connecting the chain of ideas into a mental model — not a bullet summary and not a list of formulas.
Write at least ~700 words of real explanatory prose. Aim for genuine understanding, not coverage.`;

const ANTI_AIISM_RULES = `Banned writing patterns — do NOT use these:
- "The first/second/next/big idea is…", "X is not a side detail", "X is not just Y", "The point is not…", "This is not only X but also Y", "It is important to note that…", "This matters because…", "This highlights/underscores…", "The key takeaway is…", "In summary…".
Do not teach through contrastive negation (telling the learner what something is NOT). Explain directly what it IS, why it exists, how it works, and how to think about it.
Weak: "A second limitation appears in how information is represented. Continuous activations carry information through changing numerical values."
Strong: "Imagine a sensor watching a mostly still scene. A dense network keeps re-processing whole arrays of values even when nothing changes. A spiking system assumes silence is meaningful: when something changes, it sends a single event — a spike — at a particular time, and that timing is part of the message."`;

const PLACEHOLDER_FREE_PROSE_RULES = `Final-prose rules (hard requirements):
- Every line must be finished learner-facing prose, not a note about what someone should write later.
- Never include scaffold commands such as insert, add the example here, write the details here, fill in, expand this later, TODO, placeholder, lorem ipsum, or to be written.
- Never leave empty bullets, ellipsis-only bullets, bracketed instructions, or notes to yourself.
- If a source detail is thin or missing, write the supported explanation plainly instead of describing what should be added later.`;

const SUBSECTION_PROMPT = `Write one flowing lesson subsection for a Breadboard learning garden.
Return Markdown body only, no frontmatter, no code fence around the whole page.
${LEARNER_VOICE_RULES}
${DEPTH_RULES}
${ANTI_AIISM_RULES}
${PLACEHOLDER_FREE_PROSE_RULES}
Mechanics:
- One flowing lesson, not disconnected mini-sections; avoid over-segmentation and excessive headings.
- Treat dossier.learningUnit as the contract for this page: answer its learningQuestion, introduce its newConcepts, respect mustNotRepeat, use only its planned source artifacts, and use its zettelNotes as conceptual anchors.
- The first paragraph must connect to prior ideas unless this is the first unit; later pages must not restart the whole motivation.
- If assignedSourceVisuals are provided, embed EACH one inline exactly where it supports the prose using its provided markdown snippet, with an interpretation of what the figure shows directly beside it. Never dump images at the end and never repeat a caption without interpreting it.
- For every source formula in dossier.learningUnit.sourceFormulaContracts, reproduce the canonical equation transcription from relevantSourceSnippets verbatim as a displayed equation, then teach the model-authored teachingGoal and define every listed term. Do not substitute an equivalent formula or invent a different notation.
- Never create a generic "## Source Figures" section. Every source figure/table/formula belongs inside the explanation where the contract placed it.
- Do NOT write any \`\`\`breadboard-visual code block yourself — interactive visuals are attached by the pipeline afterwards.
- Never leave [Interactive visual: ...] or any bracketed placeholder, and never write instructions to yourself (e.g. "use the page 10 materials").
- Include 1-2 real questions a learner would ask, using exactly:
  **Question.** ...
  **Answer.** ...
- Do not generate arbitrary executable JavaScript.`;

const REVISION_PROMPT = `Revise this lesson page so a beginner genuinely understands it.
Return Markdown body only, no frontmatter.
${LEARNER_VOICE_RULES}
${DEPTH_RULES}
${ANTI_AIISM_RULES}
${PLACEHOLDER_FREE_PROSE_RULES}
Keep it one flowing lesson. Keep every embedded image where it is (or move it nearer the prose it supports) and make sure each image is interpreted, not just captioned. Keep any \`\`\`breadboard-visual block byte-for-byte unchanged. Remove any placeholder or self-instruction text. Keep or add 1-2 **Question.** / **Answer.** pairs.
If source-only mode is true, do not add unsupported facts; say plainly when material is missing.`;

const SUBSECTION_REPAIR_PROMPT = `Repair one lesson page that failed specific hard quality checks. This is a focused repair, not a rewrite.
Return Markdown body only, no frontmatter.
${LEARNER_VOICE_RULES}
${ANTI_AIISM_RULES}
${PLACEHOLDER_FREE_PROSE_RULES}
Task:
- Fix ONLY the listed hard failures (failedProblems). Leave everything that already works untouched.
- Preserve correct existing content: explanations, examples, formulas, structure, and the Question./Answer. section.
- Do not restart from scratch unless the page is genuinely unusable.
- If a failure says the page is too short, lacks a concrete example, or lacks a **Question.** / **Answer.** pair, add the missing depth in the same flowing, beginner-friendly voice: motivate before mechanism, define terms as they appear, put a concrete example right after the idea it illustrates, and keep at least ~700 words of real explanatory prose.
- If failedProblems includes placeholder or empty-bullet-scaffold, replace the offending scaffold with finished explanatory sentences. Do not merely delete it unless the surrounding paragraph remains coherent and complete.
- Rewrite any sentence that comments on "the paper", "the source", "source-derived", or similar document framing so it teaches the concept directly.
- Keep every embedded image markdown where it is and keep any \`\`\`breadboard-visual block byte-for-byte unchanged.
- Remove placeholder or self-instruction text.
- If source-only mode is true, do not add unsupported facts.
- Return only the final Markdown.`;

function ensureLearnTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learn_jobs (
      id                         TEXT PRIMARY KEY,
      garden_id                  TEXT NOT NULL,
      user_id                    INTEGER,
      model                      TEXT NOT NULL DEFAULT 'gpt-5.6-sol',
      status                     TEXT NOT NULL,
      mode                       TEXT NOT NULL,
      current_step               TEXT,
      progress_percent           INTEGER NOT NULL DEFAULT 0,
      current_section_title      TEXT,
      current_page_title         TEXT,
      error                      TEXT,
      proposed_learning_map_id   TEXT,
      confirmed_learning_map_id  TEXT,
      latest_textbook_version_id TEXT,
      source_set_hash            TEXT,
      source_ids_json            TEXT NOT NULL DEFAULT '[]',
      syllabus_source_id         TEXT,
      source_only                INTEGER NOT NULL DEFAULT 1,
      include_source_snapshots   INTEGER NOT NULL DEFAULT 0,
      active_elapsed_ms          INTEGER NOT NULL DEFAULT 0,
      timer_started_at           TEXT,
      created_at                 TEXT NOT NULL,
      updated_at                 TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_jobs_garden_updated
      ON learn_jobs(garden_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS learn_job_token_usage (
      job_id                TEXT PRIMARY KEY REFERENCES learn_jobs(id) ON DELETE CASCADE,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      total_tokens          INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens   INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
      started_requests      INTEGER NOT NULL DEFAULT 0,
      completed_requests    INTEGER NOT NULL DEFAULT 0,
      reported_requests     INTEGER NOT NULL DEFAULT 0,
      estimated_requests    INTEGER NOT NULL DEFAULT 0,
      usage_updated_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS learn_maps (
      id                        TEXT PRIMARY KEY,
      garden_id                 TEXT NOT NULL,
      job_id                    TEXT NOT NULL,
      status                    TEXT NOT NULL,
      source_map_json           TEXT NOT NULL,
      scope_contract_json       TEXT NOT NULL,
      learning_map_json         TEXT NOT NULL,
      proposed_order_json       TEXT NOT NULL,
      visual_opportunities_json TEXT NOT NULL,
      coverage_plan_json        TEXT NOT NULL,
      source_set_hash           TEXT NOT NULL,
      source_artifact_inventory_hash TEXT NOT NULL,
      source_ids_json           TEXT NOT NULL DEFAULT '[]',
      syllabus_source_id        TEXT,
      syllabus_coverage_json    TEXT,
      created_at                TEXT NOT NULL,
      confirmed_at              TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_learn_maps_garden_created
      ON learn_maps(garden_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS learn_versions (
      id                  TEXT PRIMARY KEY,
      garden_id           TEXT NOT NULL,
      job_id              TEXT NOT NULL,
      learning_map_id     TEXT NOT NULL,
      source_set_hash     TEXT NOT NULL,
      source_artifact_inventory_hash TEXT NOT NULL,
      page_count          INTEGER NOT NULL DEFAULT 0,
      backup_dir          TEXT,
      created_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_versions_garden_created
      ON learn_versions(garden_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS learn_clear_operations (
      id                  TEXT PRIMARY KEY,
      garden_id           TEXT NOT NULL,
      phase               TEXT NOT NULL,
      previous_garden_dir TEXT,
      pre_clear_fingerprint TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_clear_operations_updated
      ON learn_clear_operations(updated_at ASC);

    CREATE TABLE IF NOT EXISTS learn_publication_retries (
      garden_id   TEXT PRIMARY KEY,
      reason      TEXT NOT NULL,
      last_error  TEXT,
      requested_at TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `);

  const duplicateClearJournal = db
    .prepare(
      `SELECT garden_id, COUNT(*) AS operation_count
       FROM learn_clear_operations
       GROUP BY garden_id HAVING COUNT(*) > 1 LIMIT 1`,
    )
    .get() as { garden_id: string; operation_count: number } | undefined;
  if (duplicateClearJournal) {
    throw new Error(
      `Garden ${duplicateClearJournal.garden_id} has ${duplicateClearJournal.operation_count} unresolved Learn Clear journals; refusing to guess recovery order.`,
    );
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_learn_clear_operations_garden
     ON learn_clear_operations(garden_id)`,
  );

  const learnJobColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_jobs)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnJobColumns.has("active_elapsed_ms")) {
    db.exec(
      "ALTER TABLE learn_jobs ADD COLUMN active_elapsed_ms INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!learnJobColumns.has("timer_started_at")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN timer_started_at TEXT");
  }
  if (!learnJobColumns.has("source_ids_json")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN source_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!learnJobColumns.has("syllabus_source_id")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN syllabus_source_id TEXT");
  }
  if (!learnJobColumns.has("model")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-5.6-sol'");
  }

  const learnMapColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_maps)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnMapColumns.has("source_ids_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN source_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!learnMapColumns.has("syllabus_source_id")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN syllabus_source_id TEXT");
  }
  if (!learnMapColumns.has("syllabus_coverage_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN syllabus_coverage_json TEXT");
  }
  if (!learnMapColumns.has("source_artifact_inventory_hash")) {
    db.exec(
      "ALTER TABLE learn_maps ADD COLUMN source_artifact_inventory_hash TEXT NOT NULL DEFAULT ''",
    );
  }

  const learnVersionColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_versions)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnVersionColumns.has("source_artifact_inventory_hash")) {
    db.exec(
      "ALTER TABLE learn_versions ADD COLUMN source_artifact_inventory_hash TEXT NOT NULL DEFAULT ''",
    );
  }

  const learnClearOperationColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_clear_operations)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnClearOperationColumns.has("pre_clear_fingerprint")) {
    db.exec("ALTER TABLE learn_clear_operations ADD COLUMN pre_clear_fingerprint TEXT");
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function pendingLearnClearOperation(gardenId: string): { id: string; phase: string } | null {
  ensureLearnTables();
  return (db
    .prepare(
      `SELECT id, phase FROM learn_clear_operations
       WHERE garden_id = ? ORDER BY created_at ASC LIMIT 1`,
    )
    .get(gardenId) as { id: string; phase: string } | undefined) ?? null;
}

function assertNoPendingLearnClear(gardenId: string): void {
  const pending = pendingLearnClearOperation(gardenId);
  if (pending) {
    throw new LearnPipelineConflictError(
      `Interrupted Learn Clear ${pending.id} (${pending.phase}) must recover before this garden can be changed.`,
    );
  }
}

function queueLearnPublicationRetry(
  gardenId: string,
  reason: string,
  error: unknown,
): string {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO learn_publication_retries (
       garden_id, reason, last_error, requested_at, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(garden_id) DO UPDATE SET
       reason = excluded.reason,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(gardenId, reason, errorMessage(error), timestamp, timestamp);
  return timestamp;
}

function clearLearnPublicationRetry(gardenId: string, updateToken: string): void {
  db.prepare(
    `DELETE FROM learn_publication_retries
     WHERE garden_id = ? AND updated_at = ?`,
  ).run(gardenId, updateToken);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSourceIds(value: string | null | undefined): string[] {
  const parsed = value ? parseJson(value) : null;
  if (!Array.isArray(parsed)) return [];
  return Array.from(
    new Set(
      parsed
        .filter((sourceId): sourceId is string => typeof sourceId === "string")
        .map((sourceId) => sourceId.trim())
        .filter(Boolean),
    ),
  );
}

function learnTokenUsageForJob(jobId: string): LearnTokenUsage {
  const row = db
    .prepare("SELECT * FROM learn_job_token_usage WHERE job_id = ?")
    .get(jobId) as LearnJobTokenUsageRow | undefined;
  if (!row) return emptyLearnTokenUsage();

  const startedCalls = Number(row.started_requests ?? 0);
  const completedCalls = Number(row.completed_requests ?? 0);
  const reportedCalls = Number(row.reported_requests ?? 0);
  return {
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    cachedInputTokens: Number(row.cached_input_tokens ?? 0),
    reasoningTokens: Number(row.reasoning_tokens ?? 0),
    estimated: Number(row.estimated_requests ?? 0) > 0,
    startedCalls,
    completedCalls,
    reportedCalls,
    unreportedCalls: Math.max(0, completedCalls - reportedCalls),
    inFlightCalls: Math.max(0, startedCalls - completedCalls),
  };
}

/** A user-visible Learn workflow crosses two persisted jobs: planning creates
 * the learning map, then generation consumes that confirmed map. Aggregate the
 * map's planning job with only the currently visible generation/regeneration
 * job, so historical generation attempts are not counted again. */
function learnTokenUsageForWorkflow(job: LearnJob): LearnTokenUsage {
  const jobIds = new Set([job.id]);
  const learningMapId = job.confirmedLearningMapId ?? job.proposedLearningMapId;
  if (learningMapId) {
    const mapOwner = db
      .prepare("SELECT garden_id, job_id FROM learn_maps WHERE id = ?")
      .get(learningMapId) as { garden_id: string; job_id: string } | undefined;
    if (mapOwner?.garden_id === job.gardenId && mapOwner.job_id) {
      jobIds.add(mapOwner.job_id);
    }
  }
  return sumLearnTokenUsage(
    Array.from(jobIds, (jobId) => learnTokenUsageForJob(jobId)),
  );
}

function learnTimerForWorkflow(job: LearnJob): {
  elapsedMs: number;
  timerStartedAt?: string;
} {
  let elapsedMs = job.elapsedMs;
  const learningMapId = job.confirmedLearningMapId ?? job.proposedLearningMapId;
  if (learningMapId) {
    const mapOwner = db
      .prepare(
        `SELECT j.id, j.active_elapsed_ms
         FROM learn_maps m
         JOIN learn_jobs j ON j.id = m.job_id
         WHERE m.id = ? AND m.garden_id = ?`,
      )
      .get(learningMapId, job.gardenId) as
      | { id: string; active_elapsed_ms: number | null }
      | undefined;
    if (mapOwner && mapOwner.id !== job.id) {
      elapsedMs += Number(mapOwner.active_elapsed_ms ?? 0);
    }
  }
  return {
    elapsedMs,
    ...(job.timerStartedAt ? { timerStartedAt: job.timerStartedAt } : {}),
  };
}

function recordLearnTokenUsageEvent(jobId: string, event: LearnTokenUsageEvent): void {
  const updatedAt = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO learn_job_token_usage (job_id, usage_updated_at)
     VALUES (?, ?)`,
  ).run(jobId, updatedAt);

  if (event.type === "started") {
    db.prepare(
      `UPDATE learn_job_token_usage
       SET started_requests = started_requests + 1,
           usage_updated_at = ?
       WHERE job_id = ?`,
    ).run(updatedAt, jobId);
    return;
  }

  const usage = event.usage;
  db.prepare(
    `UPDATE learn_job_token_usage
     SET input_tokens = input_tokens + ?,
         output_tokens = output_tokens + ?,
         total_tokens = total_tokens + ?,
         cached_input_tokens = cached_input_tokens + ?,
         reasoning_tokens = reasoning_tokens + ?,
         completed_requests = completed_requests + 1,
         reported_requests = reported_requests + ?,
         estimated_requests = estimated_requests + ?,
         usage_updated_at = ?
     WHERE job_id = ?`,
  ).run(
    usage?.inputTokens ?? 0,
    usage?.outputTokens ?? 0,
    usage?.totalTokens ?? 0,
    usage?.cachedInputTokens ?? 0,
    usage?.reasoningTokens ?? 0,
    usage ? 1 : 0,
    usage?.estimated ? 1 : 0,
    updatedAt,
    jobId,
  );
}

function userFacingLearnText(value: string): string {
  const text = value
    .replace(/\bChatMock\b/gi, "the AI service")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function rowToJob(row: LearnJobRow | undefined): LearnJob | null {
  if (!row) return null;
  return {
    id: row.id,
    gardenId: row.garden_id,
    userId: row.user_id ?? undefined,
    model: row.model?.trim() || LEARN_MODEL,
    status: row.status,
    mode: normalizeLearnOperationMode(row.mode),
    currentStep: userFacingLearnText(row.current_step ?? ""),
    progressPercent: Number(row.progress_percent ?? 0),
    currentSectionTitle: row.current_section_title ?? undefined,
    currentPageTitle: row.current_page_title ?? undefined,
    error: row.error ? userFacingLearnText(row.error) : undefined,
    proposedLearningMapId: row.proposed_learning_map_id ?? undefined,
    confirmedLearningMapId: row.confirmed_learning_map_id ?? undefined,
    latestTextbookVersionId: row.latest_textbook_version_id ?? undefined,
    sourceSetHash: row.source_set_hash ?? undefined,
    sourceIds: parseSourceIds(row.source_ids_json),
    syllabusSourceId: row.syllabus_source_id ?? undefined,
    sourceOnly: Boolean(row.source_only ?? 1),
    includeSourceSnapshots: Boolean(row.include_source_snapshots ?? 0),
    tokenUsage: learnTokenUsageForJob(row.id),
    elapsedMs: Math.max(0, Number(row.active_elapsed_ms ?? 0)),
    timerStartedAt: row.timer_started_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMap(row: LearnMapRow | undefined): StoredLearningMap | null {
  if (!row) return null;
  // The learning map is model-authored or it does not exist. A row whose stored
  // map is missing or unparseable is not a usable plan: reading it back as a
  // synthesized map would hand the garden a curriculum the model never wrote.
  const learningMap = parseJson(row.learning_map_json) as ProposedLearningMap | null;
  const coveragePlan = parseJson(row.coverage_plan_json);
  if (!learningMap || !Array.isArray(learningMap.sections) || learningMap.sections.length === 0) {
    return null;
  }
  return {
    id: row.id,
    gardenId: row.garden_id,
    jobId: row.job_id,
    status: row.status,
    sourceMap: parseJson(row.source_map_json),
    scopeContract: parseJson(row.scope_contract_json),
    learningMap,
    proposedOrder:
      (parseJson(row.proposed_order_json) as LearningSectionPlan[] | null) ?? [],
    visualOpportunities:
      (parseJson(row.visual_opportunities_json) as unknown[] | null) ?? [],
    coveragePlan,
    sourceSetHash: row.source_set_hash,
    sourceArtifactInventoryHash: row.source_artifact_inventory_hash ?? "",
    sourceIds: parseSourceIds(row.source_ids_json),
    syllabusSourceId: row.syllabus_source_id ?? undefined,
    syllabusCoverage:
      (parseJson(row.syllabus_coverage_json ?? "") as SyllabusCoverage | null) ?? null,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

function createLearnJob({
  id,
  gardenId,
  userId,
  model,
  mode,
  sourceIds,
  syllabusSourceId,
  sourceOnly,
  includeSourceSnapshots,
}: {
  id?: string;
  gardenId: string;
  userId?: number;
  model: string;
  mode: LearnMode;
  sourceIds: string[];
  syllabusSourceId?: string;
  sourceOnly: boolean;
  includeSourceSnapshots: boolean;
}): LearnJob {
  ensureLearnTables();
  const date = nowIso();
  const job: LearnJob = {
    id: id ?? makeId("learn_job"),
    gardenId,
    userId,
    model,
    status: "idle",
    mode,
    currentStep: "",
    progressPercent: 0,
    sourceIds: [...sourceIds],
    syllabusSourceId,
    sourceOnly,
    includeSourceSnapshots,
    tokenUsage: emptyLearnTokenUsage(),
    elapsedMs: 0,
    timerStartedAt: date,
    createdAt: date,
    updatedAt: date,
  };
  db.prepare(
    `INSERT INTO learn_jobs (
      id, garden_id, user_id, model, status, mode, current_step, progress_percent,
      source_ids_json, syllabus_source_id, source_only, include_source_snapshots,
      active_elapsed_ms, timer_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.gardenId,
    job.userId ?? null,
    job.model,
    job.status,
    job.mode,
    job.currentStep,
    job.progressPercent,
    jsonString(job.sourceIds),
    job.syllabusSourceId ?? null,
    job.sourceOnly ? 1 : 0,
    job.includeSourceSnapshots ? 1 : 0,
    job.elapsedMs,
    job.timerStartedAt ?? null,
    job.createdAt,
    job.updatedAt,
  );
  db.prepare(
    `INSERT OR IGNORE INTO learn_job_token_usage (job_id, usage_updated_at)
     VALUES (?, ?)`,
  ).run(job.id, job.createdAt);
  return job;
}

/** Thrown when the user pressed Stop: the run aborts at the next checkpoint
 * and the job stays "cancelled" instead of being marked failed. */
export class LearnCancelledError extends Error {
  constructor() {
    super("Learn run stopped by the user.");
    this.name = "LearnCancelledError";
  }
}

const activeLearnAbortControllers = new Map<string, AbortController>();
const leaseLostLearnJobs = new Set<string>();
const LEARN_JOB_HEARTBEAT_INTERVAL_MS = 15_000;
const LEARN_CANCELLATION_REQUESTED_STEP =
  "Cancellation requested; waiting for the Learn worker to stop";
/** Publication is a short, non-cancellable commit section. Cancelling after the
 * atomic swap but before the DB/version commit could otherwise strand a valid
 * tree behind a cancelled job. */
const committingLearnJobs = new Set<string>();

function abortLearnWorkerAfterLeaseLoss(jobId: string): void {
  leaseLostLearnJobs.add(jobId);
  const controller = activeLearnAbortControllers.get(jobId);
  if (!controller?.signal.aborted) {
    controller?.abort(
      new LearnPipelineConflictError(
        "This Learn worker lost its fenced garden lease to another process.",
      ),
    );
  }
}

function jobStatusById(jobId: string): LearnStatus | null {
  const row = db
    .prepare("SELECT status FROM learn_jobs WHERE id = ?")
    .get(jobId) as { status?: LearnStatus } | undefined;
  return row?.status ?? null;
}

/** Cooperative cancellation checkpoint. The Stop button flips the job row to
 * "cancelled"; long-running pipelines call this between model calls / pages so
 * the run actually halts instead of finishing in the background. */
function throwIfLearnCancelled(jobId: string): void {
  if (leaseLostLearnJobs.has(jobId)) {
    throw new LearnPipelineConflictError(
      "This Learn worker lost its fenced garden lease to another process.",
    );
  }
  const status = jobStatusById(jobId);
  if (status === "cancelled") throw new LearnCancelledError();
  if (status === "failed") {
    throw new LearnPipelineConflictError(
      "This Learn worker lost ownership after recovery marked its job failed.",
    );
  }
}

function isLearnCancellation(jobId: string, error: unknown): boolean {
  return error instanceof LearnCancelledError || jobStatusById(jobId) === "cancelled";
}

function attachLearnJobModelTracking({
  client,
  jobId,
  gardenId,
  contentPath,
}: {
  client: OpenAI;
  jobId: string;
  gardenId: string;
  contentPath: string;
}): () => void {
  const controller = new AbortController();
  activeLearnAbortControllers.set(jobId, controller);
  if (leaseLostLearnJobs.has(jobId)) {
    controller.abort(
      new LearnPipelineConflictError(
        "This Learn worker lost its fenced garden lease to another process.",
      ),
    );
  }
  const cancellationPoll = setInterval(() => {
    try {
      if (jobStatusById(jobId) === "cancelled" && !controller.signal.aborted) {
        controller.abort(new LearnCancelledError());
      }
    } catch {
      // The request still has the immediate cancel-path abort. Ignore polling
      // failures during process/database teardown rather than throwing from a timer.
    }
  }, 500);
  cancellationPoll.unref();
  const jobHeartbeat = setInterval(() => {
    try {
      if (leaseLostLearnJobs.has(jobId)) return;
      const status = jobStatusById(jobId);
      if (status && activeStatus(status)) {
        db.prepare("UPDATE learn_jobs SET updated_at = ? WHERE id = ?").run(nowIso(), jobId);
      }
    } catch {
      // Recovery treats a missing heartbeat as abandoned only after the garden
      // lease is stale too, so a transient database failure is harmless here.
    }
  }, LEARN_JOB_HEARTBEAT_INTERVAL_MS);
  jobHeartbeat.unref();

  attachLearnTokenUsageTracking(
    client,
    (event) => recordLearnTokenUsageEvent(jobId, event),
    {
      retryTransport: {
        signal: controller.signal,
        onDelay: ({ attempt, maxAttempts, delayMs, retryCause }) => {
          throwIfLearnCancelled(jobId);
          const currentStep = `Model transport unavailable; waiting 4 minutes before retry ${attempt}/${maxAttempts}`;
          updateLearnJob(jobId, { currentStep });
          appendLearnEvent(contentPath, gardenId, "learn_model_transport_retry", {
            jobId,
            phase: "waiting",
            attempt,
            maxAttempts,
            delayMs,
            retryCause,
            currentStep,
          });
        },
        onAttempt: ({ attempt, maxAttempts, delayMs, retryCause }) => {
          throwIfLearnCancelled(jobId);
          if (attempt === 1) return;
          const currentStep = `Retrying model transport (${attempt}/${maxAttempts})`;
          updateLearnJob(jobId, { currentStep });
          appendLearnEvent(contentPath, gardenId, "learn_model_transport_retry", {
            jobId,
            phase: "attempting",
            attempt,
            maxAttempts,
            delayMs,
            retryCause,
            currentStep,
          });
        },
      },
    },
  );

  return () => {
    clearInterval(cancellationPoll);
    clearInterval(jobHeartbeat);
    if (activeLearnAbortControllers.get(jobId) === controller) {
      activeLearnAbortControllers.delete(jobId);
    }
    leaseLostLearnJobs.delete(jobId);
  };
}

function updateLearnJob(jobId: string, updates: Partial<LearnJob>): LearnJob {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE id = ?")
    .get(jobId) as LearnJobRow | undefined;
  if (!row) throw new Error(`Learn job ${jobId} not found`);
  const current = rowToJob(row)!;
  // Terminal jobs stay fenced against a suspended/stale worker. Failed may
  // transition only to cancelled when the user explicitly discards its run;
  // retries always create a new job and lease.
  if (current.status === "cancelled" && updates.status !== "cancelled") {
    return current;
  }
  if (
    current.status === "failed" &&
    updates.status !== "failed" &&
    updates.status !== "cancelled"
  ) {
    return current;
  }
  if (current.status === "complete" && updates.status !== "complete") {
    return current;
  }
  const updatedAt = nowIso();
  const nextStatus = updates.status ?? current.status;
  const timer = transitionLearnTimer(
    { elapsedMs: current.elapsedMs, startedAt: current.timerStartedAt },
    nextStatus,
    updatedAt,
  );
  const next = {
    ...current,
    ...updates,
    elapsedMs: timer.elapsedMs,
    timerStartedAt: timer.startedAt,
    updatedAt,
  };
  const result = db.prepare(
    `UPDATE learn_jobs
     SET status = ?,
         mode = ?,
         model = ?,
         current_step = ?,
         progress_percent = ?,
         current_section_title = ?,
         current_page_title = ?,
         error = ?,
         proposed_learning_map_id = ?,
         confirmed_learning_map_id = ?,
         latest_textbook_version_id = ?,
         source_set_hash = ?,
         source_ids_json = ?,
         source_only = ?,
         include_source_snapshots = ?,
         active_elapsed_ms = ?,
         timer_started_at = ?,
         updated_at = ?
     WHERE id = ? AND status = ?`,
  ).run(
    next.status,
    next.mode,
    next.model,
    next.currentStep,
    Math.max(0, Math.min(100, Math.round(next.progressPercent))),
    next.currentSectionTitle ?? null,
    next.currentPageTitle ?? null,
    next.error ?? null,
    next.proposedLearningMapId ?? null,
    next.confirmedLearningMapId ?? null,
    next.latestTextbookVersionId ?? null,
    next.sourceSetHash ?? null,
    jsonString(next.sourceIds),
    next.sourceOnly ? 1 : 0,
    next.includeSourceSnapshots ? 1 : 0,
    next.elapsedMs,
    next.timerStartedAt ?? null,
    next.updatedAt,
    jobId,
    current.status,
  );
  if (result.changes === 0) {
    const concurrent = db
      .prepare("SELECT * FROM learn_jobs WHERE id = ?")
      .get(jobId) as LearnJobRow | undefined;
    if (!concurrent) throw new Error(`Learn job ${jobId} disappeared during update`);
    return rowToJob(concurrent)!;
  }
  return next;
}

function updateLearnJobExpectStatus(
  jobId: string,
  updates: Partial<LearnJob> & { status: LearnStatus },
): LearnJob {
  const updated = updateLearnJob(jobId, updates);
  if (updated.status !== updates.status) {
    throw new LearnPipelineConflictError(
      `Learn job ${jobId} changed to ${updated.status} before it could commit ${updates.status}.`,
    );
  }
  return updated;
}

export function getLatestLearnJob(gardenId: string): LearnJob | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE garden_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(gardenId) as LearnJobRow | undefined;
  return rowToJob(row);
}

function getLearnJobById(jobId: string): LearnJob | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE id = ?")
    .get(jobId) as LearnJobRow | undefined;
  return rowToJob(row);
}

interface UnresolvedLearnJobRow {
  id: string;
  status: LearnStatus;
  current_step: string;
}

function learnJobNeedsExclusiveResolution(
  job: Pick<UnresolvedLearnJobRow, "status" | "current_step">,
): boolean {
  return (
    recoverableLearnStatus(job.status) ||
    job.status === "awaiting_confirmation" ||
    (job.status === "cancelled" &&
      job.current_step === LEARN_CANCELLATION_REQUESTED_STEP)
  );
}

function unresolvedLearnJob(
  gardenId: string,
  allowedJobId?: string,
): UnresolvedLearnJobRow | null {
  ensureLearnTables();
  const rows = db
    .prepare(
      `SELECT id, status, current_step
       FROM learn_jobs
       WHERE garden_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(gardenId) as UnresolvedLearnJobRow[];
  return (
    rows.find(
      (job) =>
        job.id !== allowedJobId && learnJobNeedsExclusiveResolution(job),
    ) ?? null
  );
}

/**
 * Older releases could leave a manual planning row awaiting forever after a
 * newer generation or scoped repair committed. Reconcile only that provably
 * superseded state, and only while the caller owns the garden lease.
 */
function reconcileSupersededAwaitingLearnJobs(gardenId: string): string[] {
  ensureLearnTables();
  const awaiting = db
    .prepare(
      `SELECT rowid AS job_rowid, id, created_at
       FROM learn_jobs
       WHERE garden_id = ? AND status = 'awaiting_confirmation'
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(gardenId) as Array<{
      job_rowid: number;
      id: string;
      created_at: string;
    }>;
  const reconciled: string[] = [];
  for (const waiting of awaiting) {
    const newer = db
      .prepare(
        `SELECT newer.rowid AS job_rowid, newer.id, newer.mode, newer.status
         FROM learn_jobs AS newer
         WHERE newer.garden_id = ?
           AND (newer.created_at > ? OR (newer.created_at = ? AND newer.rowid > ?))
           AND newer.status = 'complete'
           AND (
             newer.mode = 'repair'
             OR EXISTS (
               SELECT 1 FROM learn_versions AS version
               WHERE version.garden_id = newer.garden_id
                 AND version.job_id = newer.id
             )
           )
         ORDER BY newer.created_at DESC, newer.rowid DESC
         LIMIT 1`,
      )
      .get(
        gardenId,
        waiting.created_at,
        waiting.created_at,
        waiting.job_rowid,
      ) as
      | { job_rowid: number; id: string; mode: LearnMode; status: LearnStatus }
      | undefined;
    if (!newer) continue;
    updateLearnJobExpectStatus(waiting.id, {
      status: "complete",
      currentStep: `Planning result superseded by committed Learn job ${newer.id}`,
      progressPercent: 100,
      error: undefined,
    });
    reconciled.push(waiting.id);
  }
  return reconciled;
}

function assertNoUnresolvedLearnJob(
  gardenId: string,
  allowedJobId?: string,
): void {
  const conflict = unresolvedLearnJob(gardenId, allowedJobId);
  if (!conflict) return;
  throw new LearnPipelineConflictError(
    `Learn operation ${conflict.id} (${conflict.status}) must finish, be cancelled, or recover before another operation can change this garden.`,
  );
}

function getLearnMapById(mapId: string, gardenId: string): StoredLearningMap | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_maps WHERE id = ? AND garden_id = ?")
    .get(mapId, gardenId) as
    | LearnMapRow
    | undefined;
  return rowToMap(row);
}

function getLatestProposedLearnMap(gardenId: string): StoredLearningMap | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_maps WHERE garden_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(gardenId) as LearnMapRow | undefined;
  return rowToMap(row);
}

function getLatestConfirmedLearnMap(gardenId: string): StoredLearningMap | null {
  ensureLearnTables();
  const row = db
    .prepare(
      "SELECT * FROM learn_maps WHERE garden_id = ? AND status = 'confirmed' ORDER BY confirmed_at DESC, created_at DESC LIMIT 1",
    )
    .get(gardenId) as LearnMapRow | undefined;
  return rowToMap(row);
}

function insertLearnMap({
  gardenId,
  jobId,
  sourceMap,
  scopeContract,
  learningMap,
  coveragePlan,
  sourceSetHash,
  sourceArtifactInventoryHash,
  sourceIds,
  syllabusSourceId,
  syllabusCoverage,
}: {
  gardenId: string;
  jobId: string;
  sourceMap: unknown;
  scopeContract: unknown;
  learningMap: ProposedLearningMap;
  coveragePlan: unknown;
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  sourceIds: string[];
  syllabusSourceId?: string;
  syllabusCoverage?: SyllabusCoverage | null;
}): StoredLearningMap {
  ensureLearnTables();
  const createdAt = nowIso();
  const stored: StoredLearningMap = {
    id: makeId("learn_map"),
    gardenId,
    jobId,
    status: "proposed",
    sourceMap,
    scopeContract,
    learningMap,
    proposedOrder: learningMap.sections,
    visualOpportunities: learningMap.sections.flatMap((section) =>
      section.subsections.flatMap((subsection) =>
        subsection.visualOpportunities.map((opportunity) => ({
          section: section.title,
          subsection: subsection.title,
          opportunity,
        })),
      ),
    ),
    coveragePlan,
    sourceSetHash,
    sourceArtifactInventoryHash,
    sourceIds: [...sourceIds],
    syllabusSourceId,
    syllabusCoverage: syllabusCoverage ?? null,
    createdAt,
  };

  db.prepare(
    `INSERT INTO learn_maps (
      id, garden_id, job_id, status, source_map_json, scope_contract_json,
      learning_map_json, proposed_order_json, visual_opportunities_json,
      coverage_plan_json, source_set_hash, source_artifact_inventory_hash,
      source_ids_json, syllabus_source_id, syllabus_coverage_json, created_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    stored.id,
    stored.gardenId,
    stored.jobId,
    stored.status,
    jsonString(stored.sourceMap),
    jsonString(stored.scopeContract),
    jsonString(stored.learningMap),
    jsonString(stored.proposedOrder),
    jsonString(stored.visualOpportunities),
    jsonString(stored.coveragePlan),
    stored.sourceSetHash,
    stored.sourceArtifactInventoryHash,
    jsonString(stored.sourceIds),
    stored.syllabusSourceId ?? null,
    stored.syllabusCoverage ? jsonString(stored.syllabusCoverage) : null,
    stored.createdAt,
    null,
  );
  return stored;
}

function getLatestLearnVersion(gardenId: string): LearnVersionRow | null {
  ensureLearnTables();
  return (db
    .prepare("SELECT * FROM learn_versions WHERE garden_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(gardenId) as LearnVersionRow | undefined) ?? null;
}

function insertLearnVersion({
  id,
  gardenId,
  jobId,
  learningMapId,
  sourceSetHash,
  sourceArtifactInventoryHash,
  pageCount,
  backupDir,
}: {
  id: string;
  gardenId: string;
  jobId: string;
  learningMapId: string;
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  pageCount: number;
  backupDir?: string;
}): void {
  ensureLearnTables();
  db.prepare(
    `INSERT INTO learn_versions (
      id, garden_id, job_id, learning_map_id, source_set_hash,
      source_artifact_inventory_hash, page_count, backup_dir, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    gardenId,
    jobId,
    learningMapId,
    sourceSetHash,
    sourceArtifactInventoryHash,
    pageCount,
    backupDir ?? null,
    nowIso(),
  );
}

function appendLearnEvent(
  contentPath: string,
  gardenId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  appendGardenEvent(contentPath, gardenId, type, {
    gardenId,
    timestamp: nowIso(),
    ...data,
  });
}

function gardenTitleFromDb(gardenId: string): string {
  try {
    const row = db.prepare("SELECT name FROM clusters WHERE slug = ?").get(gardenId) as
      | { name?: string }
      | undefined;
    return row?.name?.trim() || gardenId;
  } catch {
    return gardenId;
  }
}

function stripLocalFrontmatter(value: string): string {
  return stripMarkdownFrontmatter(value).trim();
}

/** Page snapshot URLs stored in a source note's frontmatter (source_images). */
function sourcePageImageUrls(rawContent: string): string[] {
  const match = rawContent.match(/^source_images:\s*\[([^\]]*)\]/m);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** SourceFigure view of the extracted SourceVisual ledger, for the visual-spec
 * anchor plumbing. Full-page fallbacks are excluded — they are not figures. */
function sourceFiguresFromVisuals(visuals: SourceVisual[]): SourceFigure[] {
  return visuals
    .filter((visual) => visual.type !== "full_page_fallback")
    .map((visual) => ({
      figureId: visual.sourceVisualId,
      sourceId: visual.sourceId,
      page: visual.pageNumber || undefined,
      kind:
        visual.type === "table"
          ? ("table" as const)
          : visual.type === "graph"
            ? ("graph" as const)
            : visual.type === "equation"
              ? ("formula" as const)
              : ("diagram" as const),
      caption: visual.caption,
      ...(visual.exactText ? { ocrText: visual.exactText } : {}),
    }));
}

/**
 * Return the exact selected visual ledger projection consumed by Source Map
 * prompts. This is deliberately broader than the reviewed-equation hash: a
 * late figure, graph, table, or diagram changes the model's required complete
 * artifact partition just as materially as a new equation does.
 */
function selectedSourceArtifactInventoryForContext(
  context: LearnSourceContext,
  visuals: readonly SourceVisual[],
) {
  return selectedSourceArtifactInventorySnapshot({
    selectedSourceIds: context.sources.map((source) => source.slug),
    sourceIdentityMap: context.sourceVisualSourceIdentityMap,
    visuals,
  });
}

function refreshSelectedSourceArtifactInventory(
  contentPath: string,
  gardenId: string,
  context: LearnSourceContext,
) {
  const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
  const ledger = loadSourceVisuals(contentPath, gardenId);
  const visuals = ledger.filter((visual) =>
    selectedSourceIds.has(visual.sourceId),
  );
  const inventory = selectedSourceArtifactInventoryForContext(context, ledger);
  context.sourceFigures = sourceFiguresFromVisuals(visuals);
  context.sourceArtifactInventoryHash = inventory.sourceArtifactInventoryHash;
  return inventory;
}

const STRUCTURED_SOURCE_ARTIFACT_RE = /^S(\d+)\.P(\d+)\.(?:F|G|T|E)\d+$/i;

function stableSourceVisualIndex(
  context: LearnSourceContext,
  sourceId: string,
): number {
  const sourceIndex = context.sourceVisualSourceIdentityMap.find(
    (entry) => entry.sourceId === sourceId,
  )?.sourceIndex;
  if (!sourceIndex) {
    throw new Error(`Stable source-visual identity is missing for source "${sourceId}".`);
  }
  return sourceIndex;
}

function registeredArtifactsFromFigures(sourceFigures: SourceFigure[]): RegisteredSourceArtifact[] {
  return sourceFigures.map((figure) => ({
    id: figure.figureId,
    kind:
      figure.kind === "table"
        ? ("table" as const)
        : figure.kind === "formula"
          ? ("formula" as const)
          : figure.kind === "graph"
            ? ("graph" as const)
            : ("figure" as const),
  }));
}

function registeredArtifactsForGarden(clusterDir: string): RegisteredSourceArtifact[] {
  const artifacts: RegisteredSourceArtifact[] = [];
  for (const anchor of Object.values(buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false }))) {
    if (anchor.origin !== "visual_ledger") continue;
    if (anchor.kind === "formula" || anchor.kind === "table" || anchor.kind === "graph" || anchor.kind === "figure") {
      artifacts.push({ id: anchor.id, kind: anchor.kind });
    }
  }
  return artifacts;
}

function structuredArtifactIdsFromUnits(units: LearningUnitContract[]): string[] {
  const ids = new Set<string>();
  const add = (value: string | undefined) => {
    const id = value?.trim() ?? "";
    if (STRUCTURED_SOURCE_ARTIFACT_RE.test(id)) ids.add(id);
  };
  for (const unit of units) {
    unit.sourceAnchors.forEach(add);
    unit.sourceFigures.forEach((artifact) => add(artifact.id));
    unit.sourceFormulas.forEach((artifact) => add(artifact.id));
    unit.sourceTables.forEach((artifact) => add(artifact.id));
    unit.interactiveVisual?.sourceAnchors.forEach(add);
    unit.interactiveVisualPlan?.decision.evidence.sourceAnchorIds.forEach(add);
    unit.interactiveVisualPlan?.visualIntent?.sourceAnchors.forEach(add);
    unit.semanticConcepts?.forEach((concept) => concept.evidenceAnchors.forEach(add));
    unit.knowledgeClaims?.forEach((claim) => {
      claim.evidenceAnchors.forEach(add);
      claim.derivationAnchors?.forEach(add);
    });
    add(unit.teachingMediumPlan?.sourceFigureAnchorId);
    unit.teachingMediumPlan?.formulaAnchorIds?.forEach(add);
  }
  return [...ids].sort();
}

/**
 * Candidate artifact labels emitted into each source's own Markdown during
 * ingestion. They are hints, not evidence: remap the local source number to
 * the durable garden-global source slot, then let PDF rendering + vision decide
 * which exact ids are real before the planner can use them.
 */
function structuredArtifactIdsMentionedBySources(context: LearnSourceContext): string[] {
  const ids = new Set<string>();
  context.sources.forEach((source) => {
    const sourceIndex = stableSourceVisualIndex(context, source.slug);
    const re = /\bS\d+\.P(\d+)\.([FGTE])(\d+)\b/gi;
    for (const match of (source.body ?? "").matchAll(re)) {
      const pageNumber = Number.parseInt(match[1], 10);
      const ordinal = Number.parseInt(match[3], 10);
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) continue;
      if (!Number.isSafeInteger(ordinal) || ordinal < 1) continue;
      ids.add(`S${sourceIndex}.P${pageNumber}.${match[2].toUpperCase()}${ordinal}`);
    }
  });
  return [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

/**
 * Resolve late-page artifact references against the preserved full PDF. PDF
 * upload keeps a small eager snapshot cache for responsiveness, but Learn is
 * not allowed to treat that cache boundary as the end of the source. Any
 * structured id proposed by a contract causes that exact PDF page to be
 * rendered and scanned before the id is accepted.
 */
async function ensureReferencedSourceArtifactsExtracted({
  client,
  model,
  contentPath,
  gardenId,
  context,
  units,
  candidateArtifactIds = [],
  explicitPageHints = [],
  checkpoint,
  onProgress,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  context: LearnSourceContext;
  units: LearningUnitContract[];
  candidateArtifactIds?: readonly string[];
  explicitPageHints?: readonly Pick<SelectedStructuralSourcePageHint, "sourceId" | "sourceIndex" | "pageNumber">[];
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}): Promise<{
  requestedIds: string[];
  requestedPages: Array<{ sourceIndex: number; pageNumber: number }>;
  discoveredIds: string[];
  unresolvedIds: string[];
  scanErrors: string[];
}> {
  const registeredBefore = new Set(context.sourceFigures.map((figure) => figure.figureId));
  const requestedIds = [...new Set([
    ...structuredArtifactIdsFromUnits(units),
    ...candidateArtifactIds.filter((id) => STRUCTURED_SOURCE_ARTIFACT_RE.test(id)),
  ])].filter((id) => !registeredBefore.has(id));
  const pagesBySourceIndex = new Map<number, Set<number>>();
  const sourceIdentityById = new Map(
    context.sourceVisualSourceIdentityMap.map((entry) => [entry.sourceId, entry.sourceIndex]),
  );
  const selectedSourceByStableIndex = new Map(
    context.sources.map((source) => [stableSourceVisualIndex(context, source.slug), source]),
  );
  const scanErrors: string[] = [];
  const addRequestedPage = (sourceIndex: number, pageNumber: number) => {
    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 1) return;
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return;
    const pages = pagesBySourceIndex.get(sourceIndex) ?? new Set<number>();
    pages.add(pageNumber);
    pagesBySourceIndex.set(sourceIndex, pages);
  };
  for (const id of requestedIds) {
    const match = id.match(STRUCTURED_SOURCE_ARTIFACT_RE);
    if (!match) continue;
    const sourceIndex = Number.parseInt(match[1], 10);
    const pageNumber = Number.parseInt(match[2], 10);
    addRequestedPage(sourceIndex, pageNumber);
  }
  for (const hint of explicitPageHints) {
    const stableSourceIndex = sourceIdentityById.get(hint.sourceId);
    if (stableSourceIndex) addRequestedPage(stableSourceIndex, hint.pageNumber);
  }

  const requestedPages = [...pagesBySourceIndex]
    .flatMap(([sourceIndex, pageNumbers]) => [...pageNumbers].map((pageNumber) => ({
      sourceIndex,
      pageNumber,
    })))
    .sort((left, right) =>
      left.sourceIndex - right.sourceIndex || left.pageNumber - right.pageNumber,
    );

  for (const [sourceIndex, pageNumbers] of pagesBySourceIndex) {
    checkpoint?.();
    const source = selectedSourceByStableIndex.get(sourceIndex);
    if (!source?.sourcePdf) continue;
    const sortedPages = [...pageNumbers].sort((left, right) => left - right);
    onProgress?.(
      `Rendering referenced source page${sortedPages.length === 1 ? "" : "s"} ${sortedPages.join(", ")}...`,
    );
    const pageImageUrls = await ensureSourcePdfPageSnapshots({
      contentPath,
      gardenSlug: gardenId,
      sourceId: source.slug,
      sourcePdfUrl: source.sourcePdf,
      pageNumbers: sortedPages,
      checkpoint,
      onProgress,
    });
    if (pageImageUrls.length === 0) continue;
    // Scan each demanded page independently. A stubborn page must not discard
    // registrations already proven on the other pages, and the per-page scan
    // cache makes retries resume instead of spending the same vision tokens.
    for (const pageImageUrl of pageImageUrls) {
      let registered = false;
      let lastError = "";
      for (let attempt = 1; attempt <= 3 && !registered; attempt += 1) {
        checkpoint?.();
        try {
          await extractSourceVisuals({
            client,
            model,
            contentPath,
            gardenSlug: gardenId,
            sourceId: source.slug,
            sourceIndex,
            pageImageUrls: [pageImageUrl],
            checkpoint,
            onProgress,
          });
          registered = true;
        } catch (error) {
          lastError = errorMessage(error);
          if (attempt < 3) {
            onProgress?.(`Retrying source visual scan (${attempt + 1}/3)...`);
          }
        }
      }
      if (!registered) scanErrors.push(`${pageImageUrl}: ${lastError || "visual scan failed"}`);
    }
  }

  const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
  const visualLedger = loadSourceVisuals(contentPath, gardenId);
  const visuals = visualLedger.filter((visual) =>
    selectedSourceIds.has(visual.sourceId),
  );
  context.sourceFigures = sourceFiguresFromVisuals(visuals);
  context.sourceArtifactInventoryHash = selectedSourceArtifactInventoryForContext(
    context,
    visualLedger,
  ).sourceArtifactInventoryHash;
  const registeredAfter = new Set(context.sourceFigures.map((figure) => figure.figureId));
  return {
    requestedIds,
    requestedPages,
    discoveredIds: context.sourceFigures
      .map((figure) => figure.figureId)
      .filter((figureId) => !registeredBefore.has(figureId)),
    unresolvedIds: requestedIds.filter((id) => !registeredAfter.has(id)),
    scanErrors,
  };
}

export function collectLearnSourceContext(
  contentPath: string,
  gardenId: string,
  includedSourceIds?: readonly string[],
  syllabusSourceId?: string | null,
): LearnSourceContext {
  // Context collection is a read path. Legacy source migration belongs to an
  // explicit owner-authorized ingestion/migration operation, never a status
  // request or a generation preflight.
  const knowledge = scanClusterKnowledge(contentPath, gardenId, {
    migrateSources: false,
  });
  const gardenTitle = gardenTitleFromDb(gardenId);
  const availableSources: LearnSourceSummary[] = knowledge.nodes
    .filter((node) => node.type === "source-document")
    .map((node) => ({
      id: node.slug,
      slug: node.slug,
      title: node.title,
      description: node.description,
      relPath: node.relPath,
      sourceType: node.sourceType,
      sourceFile: node.sourceFile,
      sourcePdf: node.sourcePdf,
      date: node.date,
      wordCount: node.wordCount,
      excerpt: node.excerpt,
      body: stripLocalFrontmatter(node.content),
      tags: node.tags,
      sourceImages: sourcePageImageUrls(node.content),
    }));
  const selectedSources = selectLearnSources(availableSources, includedSourceIds);
  // The syllabus resolves against every document, not just the selected ones, so
  // a study guide can steer a run without also being taught as subject matter.
  const syllabus = selectLearnSyllabus(availableSources, syllabusSourceId);
  const sources = excludeSyllabusFromSources(selectedSources, syllabus);
  if (syllabus && sources.length === 0) {
    throw new Error(
      `"${syllabus.title}" is set as the syllabus, so it is not taught as source material. Select at least one other document for Learn.`,
    );
  }
  const selectedSourceIdSet = new Set(sources.map((source) => source.slug));
  const sourceVisualSourceIdentityMap = resolveSourceVisualSourceIdentityMap({
    contentPath,
    gardenSlug: gardenId,
    sourceIds: sources.map((source) => source.slug),
    persist: false,
  });
  const conceptNodes: LearnConceptSummary[] = knowledge.nodes
    .filter(
      (node) =>
        node.type === "internal-concept" &&
        (includedSourceIds === undefined
          ? // No explicit selection means every document is in play — except
            // concepts mined from the syllabus, which describe the course rather
            // than the subject and would otherwise re-enter through this door.
            node.sourceDocument !== syllabus?.slug
          : Boolean(node.sourceDocument && selectedSourceIdSet.has(node.sourceDocument))),
    )
    .map((node) => ({
      title: node.title,
      excerpt: node.excerpt,
      sourceDocument: node.sourceDocument,
      locations: node.locations,
      tags: node.tags,
    }));
  const existingTextbookPages: LearnSourceSummary[] = knowledge.nodes
    .filter(isLearnAuthoredLesson)
    .map((node) => ({
      id: node.slug,
      slug: node.slug,
      title: node.title,
      relPath: node.relPath,
      date: node.date,
      wordCount: node.wordCount,
      excerpt: node.excerpt,
      body: stripLocalFrontmatter(node.content),
      tags: node.tags,
    }));
  // Figures come from the Stage-2 SourceVisual ledger (cropped, captioned).
  // Before extraction has run the list is simply empty — full-page snapshots
  // are never presented as figures.
  const sourceVisualLedger = loadSourceVisuals(contentPath, gardenId);
  const selectedSourceVisuals = sourceVisualLedger.filter((visual) =>
    selectedSourceIdSet.has(visual.sourceId),
  );
  const sourceFigures = sourceFiguresFromVisuals(selectedSourceVisuals);
  const sourceArtifactInventoryHash = selectedSourceArtifactInventorySnapshot({
    selectedSourceIds: sources.map((source) => source.slug),
    sourceIdentityMap: sourceVisualSourceIdentityMap,
    visuals: sourceVisualLedger,
  }).sourceArtifactInventoryHash;

  const baseSourceSetHash = sourceSetHashWithSyllabus(
    sourceSetHashForSources(sources),
    syllabus,
  );
  const selectedSourceOrder = sources.map((source) => source.slug);
  const selectedFormulaIds = selectedSourceVisuals
    .filter((visual) => visual.type === "equation")
    .map((visual) => visual.sourceVisualId)
    .sort();
  const reviewManifest = loadSourceFormulaReviewSetManifest(contentPath, gardenId);
  let sourceFormulaReviewSetHash: string | undefined;
  let sourceSetHash = baseSourceSetHash;
  if (
    reviewManifest &&
    reviewManifest.baseSourceSetHash === baseSourceSetHash &&
    JSON.stringify(reviewManifest.sourceIds) === JSON.stringify(selectedSourceOrder) &&
    reviewManifest.sourceIdentityMapHash ===
      sourceVisualSourceIdentityMapHash(sourceVisualSourceIdentityMap) &&
    JSON.stringify(reviewManifest.sourceIdentityMap) ===
      JSON.stringify(sourceVisualSourceIdentityMap) &&
    JSON.stringify(reviewManifest.formulaIds) === JSON.stringify(selectedFormulaIds)
  ) {
    try {
      const recomputedReviewSetHash = computeSourceFormulaReviewSetHash(
        loadSourceVisuals(contentPath, gardenId),
        reviewManifest.formulaIds,
        reviewManifest.sourceIds,
        sourceVisualSourceIdentityMap,
        reviewManifest.topologyReviewPageReceipts,
      );
      if (recomputedReviewSetHash === reviewManifest.reviewSetHash) {
        sourceFormulaReviewSetHash = recomputedReviewSetHash;
      }
    } catch {
      // Status/context reads treat incomplete or stale review provenance as an
      // unreviewed source set. Pipeline/finalization paths run the full gate.
    }
    if (sourceFormulaReviewSetHash) {
      sourceSetHash = sourceSetHashWithReviewedFormulas(
        baseSourceSetHash,
        sourceFormulaReviewSetHash,
      );
    }
  }

  return {
    gardenId,
    gardenTitle,
    sources,
    concepts: conceptNodes,
    conceptNodes,
    existingTextbookPages,
    sourceFigures,
    sourceVisualSourceIdentityMap,
    syllabus,
    selectedSourceIds: selectedSources.map((source) => source.slug),
    sourceArtifactInventoryHash,
    baseSourceSetHash,
    sourceSetHash,
    ...(sourceFormulaReviewSetHash ? { sourceFormulaReviewSetHash } : {}),
  };
}

async function reviewAndBindSourceFormulas({
  client,
  model,
  contentPath,
  gardenId,
  context,
  checkpoint,
  onProgress,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  context: LearnSourceContext;
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}): Promise<SourceFormulaReviewResult> {
  checkpoint?.();
  const selectedSourceIds = context.sources.map((source) => source.slug);
  const selectedSourceIdSet = new Set(selectedSourceIds);
  const sourceIdentityMap = context.sourceVisualSourceIdentityMap;
  const sourceIdentityMapHash = sourceVisualSourceIdentityMapHash(sourceIdentityMap);
  const formulaIds = loadSourceVisuals(contentPath, gardenId)
    .filter((visual) => selectedSourceIdSet.has(visual.sourceId) && visual.type === "equation")
    .map((visual) => visual.sourceVisualId)
    .sort();
  const currentLedger = loadSourceVisuals(contentPath, gardenId);
  const existingManifest = loadSourceFormulaReviewSetManifest(contentPath, gardenId);
  if (
    existingManifest &&
    existingManifest.model === model &&
    existingManifest.baseSourceSetHash === context.baseSourceSetHash &&
    JSON.stringify(existingManifest.sourceIds) === JSON.stringify(selectedSourceIds) &&
    existingManifest.sourceIdentityMapHash === sourceIdentityMapHash &&
    JSON.stringify(existingManifest.sourceIdentityMap) === JSON.stringify(sourceIdentityMap) &&
    JSON.stringify(existingManifest.formulaIds) === JSON.stringify(formulaIds)
  ) {
    let stableHash = "";
    try {
      stableHash = computeSourceFormulaReviewSetHash(
        currentLedger,
        formulaIds,
        selectedSourceIds,
        sourceIdentityMap,
        existingManifest.topologyReviewPageReceipts,
      );
    } catch {
      stableHash = "";
    }
    if (stableHash === existingManifest.reviewSetHash) {
      const existingValidation = validateSourceFormulaReviewSet({
        contentPath,
        gardenSlug: gardenId,
        requiredFormulaIds: formulaIds,
        expectedReviewSetHash: existingManifest.reviewSetHash,
        expectedModel: model,
        expectedSourceIds: selectedSourceIds,
        sourceIdentityMap,
        expectedTopologyReviewPageReceipts: existingManifest.topologyReviewPageReceipts,
      });
      if (existingValidation.problems.length === 0) {
        refreshSelectedSourceArtifactInventory(contentPath, gardenId, context);
        context.sourceFormulaReviewSetHash = existingManifest.reviewSetHash;
        context.sourceSetHash = existingManifest.combinedSourceSetHash;
        const reviewedFormulas = currentLedger.filter((visual) => formulaIds.includes(visual.sourceVisualId));
        return {
          visuals: currentLedger,
          formulaIds,
          reviewedFormulaSetHash: existingManifest.reviewSetHash,
          approvedFormulaIds: reviewedFormulas
            .filter((visual) => visual.formulaReview?.decision === "approved")
            .map((visual) => visual.sourceVisualId)
            .sort(),
          replacementFormulaIds: reviewedFormulas
            .filter((visual) => visual.formulaReview?.decision === "replaced")
            .map((visual) => visual.sourceVisualId)
            .sort(),
          newlyReplacedFormulaIds: [],
          cacheHitFormulaIds: [...formulaIds],
          modelCalls: 0,
          topologyReviewPageReceipts: [...existingManifest.topologyReviewPageReceipts],
        };
      }
    }
  }
  const review = await reviewRequiredSourceFormulaExactText({
    client,
    model,
    contentPath,
    gardenSlug: gardenId,
    selectedSourceIds,
    sourceIdentityMap,
    requiredFormulaIds: formulaIds,
    checkCancelled: checkpoint,
    onProgress,
  });
  checkpoint?.();
  // V5 whole-page recovery may merge, split, retire, or discover equation
  // slots. From this point onward the model-reviewed active inventory is
  // authoritative; the pre-review ledger ids must never be validated or
  // promoted into the manifest after a topology change.
  const reviewedFormulaIds = [...review.formulaIds];
  const projectedFormulaIds = review.visuals
    .filter((visual) => selectedSourceIdSet.has(visual.sourceId) && visual.type === "equation")
    .map((visual) => visual.sourceVisualId)
    .sort();
  if (JSON.stringify(reviewedFormulaIds) !== JSON.stringify(projectedFormulaIds)) {
    throw new Error(
      "Accepted source-formula review inventory does not match its projected active equation ledger.",
    );
  }
  const validation = validateSourceFormulaReviewSet({
    contentPath,
    gardenSlug: gardenId,
    requiredFormulaIds: reviewedFormulaIds,
    expectedReviewSetHash: review.reviewedFormulaSetHash,
    expectedModel: model,
    expectedSourceIds: selectedSourceIds,
    sourceIdentityMap,
    expectedTopologyReviewPageReceipts: review.topologyReviewPageReceipts,
  });
  if (validation.problems.length > 0) {
    throw new Error(
      `Accepted source-formula review provenance failed strict validation: ${validation.problems.join("; ")}`,
    );
  }
  const combinedSourceSetHash = sourceSetHashWithReviewedFormulas(
    context.baseSourceSetHash,
    review.reviewedFormulaSetHash,
  );
  saveSourceFormulaReviewSetManifest(contentPath, gardenId, {
    schemaVersion: 1,
    promptVersion: 1,
    model,
    sourceIds: selectedSourceIds,
    sourceIdentityMap: [...sourceIdentityMap],
    sourceIdentityMapHash,
    formulaIds: reviewedFormulaIds,
    topologyReviewPageReceipts: review.topologyReviewPageReceipts,
    reviewSetHash: review.reviewedFormulaSetHash,
    baseSourceSetHash: context.baseSourceSetHash,
    combinedSourceSetHash,
    createdAt: nowIso(),
  });
  refreshSelectedSourceArtifactInventory(contentPath, gardenId, context);
  context.sourceFormulaReviewSetHash = review.reviewedFormulaSetHash;
  context.sourceSetHash = combinedSourceSetHash;
  return review;
}

/**
 * Stage 2: make sure every source's meaningful visuals are extracted into the
 * SourceVisual ledger (idempotent per source). For a visual-rich PDF this is
 * mandatory: if extraction yields zero real figures/tables (only full-page
 * fallbacks, or nothing), the whole job fails rather than silently producing
 * learner pages with no source figures.
 */
async function ensureSourceVisualsExtracted({
  client,
  model,
  contentPath,
  gardenId,
  context,
  deferEmptyVisualCheck = false,
  checkpoint,
  onProgress,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  context: LearnSourceContext;
  /** Let an immediate follow-up on-demand scan satisfy a visual-rich source. */
  deferEmptyVisualCheck?: boolean;
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}): Promise<SourceVisual[]> {
  context.sourceVisualSourceIdentityMap = resolveSourceVisualSourceIdentityMap({
    contentPath,
    gardenSlug: gardenId,
    sourceIds: context.sources.map((source) => source.slug),
    persist: true,
  });
  const visualRichSlugs = new Set(
    context.sources.filter(sourceAppearsVisualRich).map((source) => source.slug),
  );
  const extractionErrors: string[] = [];

  for (let index = 0; index < context.sources.length; index += 1) {
    checkpoint?.();
    const source = context.sources[index];
    const sourceIndex = stableSourceVisualIndex(context, source.slug);
    const pageImageUrls = [...new Set([
      ...(source.sourceImages ?? []).filter(isFullPageSnapshotUrl),
      ...sourceVisualCachedPageImageUrls(contentPath, gardenId, source.slug),
    ])];
    if (pageImageUrls.length === 0) continue;
    try {
      await extractSourceVisuals({
        client,
        model,
        contentPath,
        gardenSlug: gardenId,
        sourceId: source.slug,
        sourceIndex,
        pageImageUrls,
        checkpoint,
        onProgress,
      });
    } catch (error) {
      checkpoint?.();
      const message = error instanceof Error ? error.message : String(error);
      extractionErrors.push(`${source.slug}: ${message}`);
    }
  }

  const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
  const visualLedger = loadSourceVisuals(contentPath, gardenId);
  const visuals = visualLedger.filter((visual) =>
    selectedSourceIds.has(visual.sourceId),
  );
  context.sourceFigures = sourceFiguresFromVisuals(visuals);
  context.sourceArtifactInventoryHash = selectedSourceArtifactInventoryForContext(
    context,
    visualLedger,
  ).sourceArtifactInventoryHash;

  if (!deferEmptyVisualCheck && visualRichSlugs.size > 0) {
    const realFigures = visuals.filter(
      (visual) => visual.type !== "full_page_fallback" && visualRichSlugs.has(visual.sourceId),
    );
    if (realFigures.length === 0) {
      const detail = extractionErrors.length > 0 ? ` (${extractionErrors.join("; ")})` : "";
      // Distinguish a retryable model/infra failure from a source that genuinely
      // has no detectable figures, so the user knows whether to retry or not.
      const guidance = extractionErrors.length > 0
        ? " The visual-detection model returned errors and may be unavailable — retry generation once it is reachable."
        : " No meaningful figures or tables were detected in the source page snapshots.";
      throw new Error(
        `Source visual extraction failed: ${visualRichSlugs.size} visual-rich source(s) produced zero extracted figures/tables${detail}.${guidance} Refusing to write learner pages with no source figures.`,
      );
    }
  }

  return visuals;
}

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}\n[truncated]`;
}

/** How much of the study guide the planner sees. Syllabi are short documents;
 * this is generous enough for a full course outline without crowding out the
 * source material it is meant to organize. */
const MAX_SYLLABUS_PROMPT_CHARS = 12000;
/** Page writing only needs the outline as orientation, not the whole guide. */
const MAX_SYLLABUS_DOSSIER_CHARS = 3000;

/** The designated study guide, in the shape planning prompts read it. */
function promptSyllabus(
  context: LearnSourceContext,
  maxChars = MAX_SYLLABUS_PROMPT_CHARS,
): unknown {
  const syllabus = context.syllabus;
  if (!syllabus) return undefined;
  return {
    id: syllabus.slug,
    title: syllabus.title,
    description: syllabus.description,
    sourceFile: syllabus.sourceFile,
    content: truncate(syllabus.body, maxChars),
  };
}

function cleanStructuralAnchorText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function structuralAnchorTitle(text: string, fallback: string): string {
  const heading = text
    .split("\n")
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1]?.trim())
    .find((value): value is string => Boolean(value));
  return (heading || fallback).slice(0, 180);
}

/**
 * Project Markdown page boundaries into canonical text evidence. Code does not
 * decide what a page means or where it belongs; the planning model receives
 * this catalog and authors those semantic choices.
 */
function structuralSourceTextAnchorCatalog(context: LearnSourceContext): ModelSourcePageAnchorRecord[] {
  const anchors: ModelSourcePageAnchorRecord[] = modelSourcePageAnchors(context.sources);
  const paginatedSourceIds = new Set(anchors.map((anchor) => anchor.sourceId));
  context.sources.forEach((source) => {
    if (paginatedSourceIds.has(source.slug)) return;
    const body = String(source.body ?? "").replace(/\r\n/g, "\n");
    if (!body.trim()) return;

    // Non-paginated Markdown is divided only at paragraph boundaries and a
    // fixed transport ceiling. Segment numbers are structural positions.
    const paragraphs = body.split(/\n{2,}/).map(cleanStructuralAnchorText).filter(Boolean);
    const segments: string[] = [];
    let current = "";
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length + 2 > 12_000) {
        segments.push(current);
        current = paragraph;
      } else {
        current = current ? `${current}\n\n${paragraph}` : paragraph;
      }
    }
    if (current) segments.push(current);
    segments.forEach((exactText, segmentIndex) => {
      const page = segmentIndex + 1;
      const title = structuralAnchorTitle(exactText, `${source.title} — segment ${page}`);
      anchors.push({
        id: `text-${source.slug.replace(/[^A-Za-z0-9_.-]+/g, "-")}-segment-${page}`,
        sourceId: source.slug,
        page,
        kind: "guidance",
        title,
        exactText,
        provenance: {
          origin: "selected_source_markdown_page",
          sourceRelPath: source.relPath,
          extraction: "exact_markdown_page_block",
        },
      });
    });
  });
  return anchors;
}

function structuralSourceAnchorPromptCatalog(
  anchors: readonly ModelSourcePageAnchorRecord[],
): Array<Record<string, unknown>> {
  return anchors.map((anchor) => ({
    id: anchor.id,
    sourceId: anchor.sourceId,
    page: anchor.page,
    title: anchor.title,
    excerpt: compactFallbackText(anchor.exactText).slice(0, 240),
  }));
}

function persistSelectedStructuralSourceAnchors(input: {
  clusterDir: string;
  sourceMap: unknown;
  selectedSourceIds: readonly string[];
  catalog: readonly ModelSourcePageAnchorRecord[];
}): void {
  const sourceMap = planningRecord(input.sourceMap);
  const selectedIds = new Set(
    (Array.isArray(sourceMap.sourceAnchors) ? sourceMap.sourceAnchors : [])
      .map((entry) => planningRecord(entry).id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const catalogById = new Map(input.catalog.map((anchor) => [anchor.id, anchor]));
  const selectedRecords = [...selectedIds]
    .map((id) => catalogById.get(id))
    .filter((anchor): anchor is ModelSourcePageAnchorRecord => Boolean(anchor));
  const selectedRecordIds = new Set(selectedRecords.map((record) => record.id.toLowerCase()));
  const ledgerPath = path.join(input.clusterDir, ".breadboard", "source-anchors.json");
  const ledger = fs.existsSync(ledgerPath)
    ? planningRecord(JSON.parse(fs.readFileSync(ledgerPath, "utf-8")))
    : {};
  const selectedSourceIds = new Set(input.selectedSourceIds);
  const existingStructural = Array.isArray(ledger.sourceStructuralAnchors)
      ? ledger.sourceStructuralAnchors.filter((entry) => {
        const sourceId = planningRecord(entry).sourceId;
        const id = planningRecord(entry).id;
        const isProjectedPageText =
          typeof id === "string" && /^text-[A-Za-z0-9_.-]+-(?:page|segment)-\d+$/i.test(id);
        if (!isProjectedPageText) return true;
        if (typeof id === "string" && selectedRecordIds.has(id.toLowerCase())) return false;
        return typeof sourceId !== "string" || !selectedSourceIds.has(sourceId);
      })
    : [];
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify({
    ...ledger,
    sourceStructuralAnchors: [...existingStructural, ...selectedRecords],
  }, null, 2)}\n`, "utf-8");
}

function sourcePlanningIndex(body: string | undefined, maxChars: number): string {
  const text = String(body ?? "");
  const boundary = text.search(/^##\s+Internal planning\s*$/im);
  return truncate(boundary > 0 ? text.slice(0, boundary) : text, maxChars);
}

function promptSources(context: LearnSourceContext): unknown {
  const maxIndexCharsPerSource = Math.max(
    18_000,
    Math.floor(120_000 / Math.max(1, context.sources.length)),
  );
  return {
    gardenId: context.gardenId,
    gardenTitle: context.gardenTitle,
    sourceSetHash: context.sourceSetHash,
    sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    sources: context.sources.map((source) => ({
      id: source.slug,
      sourceNumber: stableSourceVisualIndex(context, source.slug),
      title: source.title,
      description: source.description,
      relPath: source.relPath,
      sourceType: source.sourceType,
      sourceFile: source.sourceFile,
      tags: source.tags,
      excerpt: source.excerpt,
      content: sourcePlanningIndex(source.body, maxIndexCharsPerSource),
    })),
    conceptNodes: context.conceptNodes.slice(0, 80),
    sourceFigures: context.sourceFigures,
    // Stage-2 extracted visuals, in the shape the planner assigns from.
    sourceVisuals: context.sourceFigures.map((figure) => ({
      sourceVisualId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      caption: figure.caption,
    })),
  };
}

/** Exact selected-source evidence for the model-authored syllabus coverage
 * decision. The per-source bound is transport-only: strings are copied from
 * the source record, never summarized, ranked, or matched by code. */
function promptSyllabusCoverageSourceCatalog(
  context: LearnSourceContext,
  syllabusPlan: SyllabusPlan,
): unknown {
  return {
    sourceRecords: buildSyllabusCoverageSourceCatalog(context.sources),
    // These exact strings remain syllabus input. They do not choose or match a
    // source page; the coverage model decides whether the raw source prefix
    // proves each locator.
    authoredLocators: authoredSyllabusLocatorCatalog(syllabusPlan.referencedMaterials),
  };
}

/** Body-free source context for downstream planning stages. The learning-spine
 * call already receives the source map and scope contract (which digested the
 * full text), so re-sending every 9k-char body only inflates the prompt and the
 * upstream latency. Keep titles, excerpts, tags, and figure metadata. */
function promptSourcesCompact(context: LearnSourceContext): unknown {
  return {
    gardenId: context.gardenId,
    gardenTitle: context.gardenTitle,
    sourceSetHash: context.sourceSetHash,
    sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    sources: context.sources.map((source) => ({
      id: source.slug,
      sourceNumber: stableSourceVisualIndex(context, source.slug),
      title: source.title,
      description: source.description,
      relPath: source.relPath,
      sourceType: source.sourceType,
      tags: source.tags,
      excerpt: truncate(source.excerpt || source.body, 1200),
    })),
    conceptNodes: context.conceptNodes.slice(0, 60),
    sourceVisuals: context.sourceFigures.map((figure) => ({
      sourceVisualId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      caption: figure.caption,
    })),
  };
}

async function callCouncilText({
  client,
  model,
  taskType,
  gardenId,
  pageId,
  system,
  user,
  sourceContext,
  councilModeOverride,
  timeoutMs,
  preserveExactContent = false,
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  pageId?: string;
  system: string;
  user: string;
  sourceContext: unknown;
  councilModeOverride?: CouncilMode;
  /** Per-request timeout override. When set, SDK-internal retries are disabled
   * so the caller's own retry ladder controls what happens on a timeout. */
  timeoutMs?: number;
  /** Structured-output callers need the exact provider text when strict JSON
   * parsing fails so a bounded AI rereview can see and wholly rewrite it. */
  preserveExactContent?: boolean;
}): Promise<CouncilCallResult> {
  logPromptBudget(
    `${taskType}${pageId ? ` ${pageId}` : ""} (${councilModeOverride ?? "default"})`,
    system,
    user,
    sourceContext,
  );
  const response = await client.chat.completions.create(
    withCouncil(
      {
        model,
        reasoning: LEARN_REASONING,
        messages: [
          { role: "system" as const, content: system },
          { role: "user" as const, content: user },
        ],
      },
      {
        taskType,
        gardenId,
        pageId,
        sourceContext,
        councilModeOverride,
      },
    ),
    timeoutMs ? { timeout: timeoutMs, maxRetries: 0 } : undefined,
  );
  const typed = response as typeof response & {
    councilRunId?: string;
    councilMode?: string;
  };
  const exactContent = response.choices[0]?.message?.content ?? "";
  return {
    // Every piece of prose the pipeline writes into a garden page comes through
    // here, so this is where invisible-Unicode marks come out of it — before
    // any anchor is assigned or any gate counts a line. Only invisible
    // characters go; formulas, anchors and fenced blocks are untouched.
    // Strict structured callers can opt into the exact provider bytes so a
    // malformed response reaches their bounded AI rereview without reshaping.
    content: preserveExactContent ? exactContent : scrubbed(exactContent.trim()),
    councilRunId: typed.councilRunId ?? response.id,
    councilMode: typed.councilMode,
  };
}

async function callCouncilJson({
  client,
  model,
  taskType,
  gardenId,
  system,
  user,
  sourceContext,
  councilModeOverride = "full_council",
  timeoutMs,
  preserveExactContent = false,
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  system: string;
  user: string;
  sourceContext: unknown;
  councilModeOverride?: CouncilMode;
  timeoutMs?: number;
  preserveExactContent?: boolean;
}): Promise<CouncilJsonResult> {
  const result = await callCouncilText({
    client,
    model,
    taskType,
    gardenId,
    system,
    user,
    sourceContext,
    councilModeOverride,
    timeoutMs,
    preserveExactContent,
  });
  return { ...result, parsed: parseJsonCandidate(result.content) };
}

async function requestVisualizationContractRepair(input: {
  client: OpenAI;
  model: string;
  gardenId: string;
  packet: VisualizationContractRepairPacket;
}): Promise<unknown> {
  const { parsed } = await callCouncilJson({
    client: input.client,
    model: input.model,
    taskType: "visualization_generation",
    gardenId: input.gardenId,
    system: buildVisualizationContractRepairPrompt(input.packet).system,
    user: buildVisualizationContractRepairPrompt(input.packet).user,
    sourceContext: input.packet,
    councilModeOverride: "direct_council",
    timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
  });
  return parsed;
}

async function requestVisualizationContractExecutabilityReview(input: {
  client: OpenAI;
  model: string;
  gardenId: string;
  request: VisualContractExecutabilityProviderRequest;
}): Promise<unknown> {
  const result = await callCouncilText({
    client: input.client,
    model: input.model,
    taskType: "visual_necessity_review",
    gardenId: input.gardenId,
    system: input.request.system,
    user: input.request.user,
    // The complete contract and canonical evidence are already present once
    // in the user payload. Council routing receives only bounded audit metadata.
    sourceContext: {
      gardenId: input.gardenId,
      taskType: "visual_contract_executability_review",
      attempt: input.request.attempt,
      unitIds: input.request.unitIds,
      previousProblemCount: input.request.problems.length,
      requestPurpose: input.request.requestPurpose,
      semanticCandidatesBeforeRequest: input.request.semanticCandidatesBeforeRequest,
      protocolRetriesBeforeRequest: input.request.protocolRetriesBeforeRequest,
    },
    councilModeOverride: "direct_council",
    timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
    preserveExactContent: true,
  });
  // Preserve exact provider text—even valid JSON—so the bounded reviewer can
  // separate raw protocol retries from parsed semantic candidates without
  // JSON.parse/JSON.stringify normalizing model numbers. A true Council
  // transport exception deliberately escapes this boundary unchanged.
  return strictVisualContractExecutabilityResponseOrExactRaw(result.content);
}

async function planAndReviewVisualNecessity(input: {
  client: OpenAI;
  model: string;
  gardenId: string;
  contentPath: string;
  jobId: string;
  learningUnits: LearningUnitContract[];
}): Promise<GardenVisualNecessityPlan> {
  const gardenDir = clusterPath(input.contentPath, input.gardenId);
  const overrides = loadVisualDecisionOverrides(gardenDir);
  const packet = buildModelVisualNecessityPacket({
    gardenId: input.gardenId,
    learningUnits: input.learningUnits,
    canonicalEvidenceByUnit: canonicalVisualizationEvidenceByUnit(gardenDir, input.learningUnits),
    // These are safety ceilings, not targets. Allowing every unit keeps code
    // out of the pedagogical decision; the model must justify the actual set.
    budget: {
      maximumInteractiveUnits: input.learningUnits.length,
      maximumRequiredInteractiveUnits: input.learningUnits.length,
      maximumRepeatedInteractionSignature: LEARN_VISUAL_MAX_REPEATED_INTERACTION_SIGNATURE,
    },
    sectionByUnit: Object.fromEntries(
      input.learningUnits.flatMap((unit) =>
        unit.sectionPlan?.id ? [[unit.id, unit.sectionPlan.id]] : []),
    ),
    overrides,
  });
  const run = await runModelVisualNecessityPlanning({
    packet,
    learningUnits: input.learningUnits,
    provider: async (request) => {
      throwIfLearnCancelled(input.jobId);
      const { parsed } = await callCouncilJson({
        client: input.client,
        model: input.model,
        taskType: "visual_necessity_review",
        gardenId: input.gardenId,
        system: request.system,
        user: request.user,
        // Evidence is already present once in the user payload. Keep council
        // routing metadata compact so the same garden packet is not charged or
        // reasoned over twice.
        sourceContext: {
          gardenId: input.gardenId,
          taskType: "visual_necessity_review",
          attempt: request.attempt,
          unitIds: packet.units.map((unit) => unit.unitId),
        },
        councilModeOverride: "direct_council",
        timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
      });
      // Malformed/absent structured model output is a semantic validation
      // failure and must enter the bounded model-repair loop. Only an actual
      // callCouncilJson transport exception escapes this provider.
      return parsed;
    },
    targetedRepairProvider: async (request) => {
      throwIfLearnCancelled(input.jobId);
      const { parsed } = await callCouncilJson({
        client: input.client,
        model: input.model,
        taskType: "visual_necessity_review",
        gardenId: input.gardenId,
        system: request.system,
        user: request.user,
        // The user payload contains only failed unit packets and their exact
        // canonical evidence. Routing metadata stays compact and never repeats
        // the complete garden or the untouched decision records.
        sourceContext: {
          gardenId: input.gardenId,
          taskType: "visual_necessity_targeted_repair",
          attempt: request.attempt,
          unitIds: request.unitIds,
        },
        councilModeOverride: "direct_council",
        timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
      });
      // Let the targeted response validator reject malformed model output;
      // transport exceptions still propagate from callCouncilJson unchanged.
      return parsed;
    },
  });
  appendLearnEvent(input.contentPath, input.gardenId, "learn_visual_necessity_review_completed", {
    jobId: input.jobId,
    decisionSource: "model_batch",
    modelCalls: run.calls,
    rejectedReviews: run.repairCalls,
    targetedRepairCalls: run.targetedRepairCalls,
    required: run.plan.counts.required,
    recommended: run.plan.counts.recommended,
    optional: run.plan.counts.optional,
    noInteraction: run.plan.counts.nonInteractive,
  });
  return {
    learningUnits: run.plan.learningUnits,
    decisions: run.plan.decisions,
    teachingMedia: run.plan.teachingMedia,
    budget: run.plan.budget,
    overrides: packet.overrides,
    reviewCalls: run.calls,
    rejectedReviews: run.repairCalls,
    decisionRecords: run.plan.decisionRecords,
    zeroVisualSafeguard: run.plan.zeroVisualSafeguard,
    unresolvedRecords: [],
  };
}

/**
 * Planning call with a timeout ladder: one attempt at the configured planning
 * council mode with a generous timeout, then one retry at the (lighter, faster)
 * retry mode. If both time out, the error reaches the caller and the isolated
 * Learn workspace is discarded; no semantic planning fallback is created.
 */
async function callPlanningJsonWithRetry({
  client,
  model,
  taskType,
  gardenId,
  system,
  user,
  sourceContext,
  contentPath,
  jobId,
  preserveExactContent = false,
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  system: string;
  user: string;
  sourceContext: unknown;
  contentPath: string;
  jobId: string;
  preserveExactContent?: boolean;
}): Promise<CouncilJsonResult> {
  try {
    return await callCouncilJson({
      client,
      model,
      taskType,
      gardenId,
      system,
      user,
      sourceContext,
      councilModeOverride: LEARN_PLANNING_COUNCIL_MODE,
      timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
      preserveExactContent,
    });
  } catch (error) {
    if (!isPlanningTimeoutError(error)) throw error;
    appendLearnEvent(contentPath, gardenId, "learn_planning_timeout_retry", {
      jobId,
      taskType,
      error: errorMessage(error),
      retryCouncilMode: LEARN_PLANNING_RETRY_COUNCIL_MODE,
    });
    throwIfLearnCancelled(jobId);
    return await callCouncilJson({
      client,
      model,
      taskType,
      gardenId,
      system,
      user,
      sourceContext,
      councilModeOverride: LEARN_PLANNING_RETRY_COUNCIL_MODE,
      timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
      preserveExactContent,
    });
  }
}

async function callValidatedPlanningJson({
  client,
  model,
  taskType,
  gardenId,
  system,
  user,
  sourceContext,
  contentPath,
  jobId,
  stageLabel,
  validate,
  preserveExactContent = false,
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  system: string;
  user: string;
  sourceContext: unknown;
  contentPath: string;
  jobId: string;
  stageLabel: string;
  validate: (value: unknown) => string[];
  preserveExactContent?: boolean;
}): Promise<CouncilJsonResult> {
  const originalRequest = parseJsonCandidate(user) ?? user;
  let result = await callPlanningJsonWithRetry({
    client,
    model,
    taskType,
    gardenId,
    system,
    user,
    sourceContext,
    contentPath,
    jobId,
    preserveExactContent,
  });
  let problems = validate(result.parsed);
  for (let repairAttempt = 1; repairAttempt <= 2 && problems.length > 0; repairAttempt += 1) {
    throwIfLearnCancelled(jobId);
    appendLearnEvent(contentPath, gardenId, "learn_planning_schema_repair_started", {
      jobId,
      taskType,
      stageLabel,
      repairAttempt,
      problems,
    });
    const invalidResponse = result.parsed ?? {
      unparsedResponse: result.content.slice(0, 12_000),
    };
    result = await callPlanningJsonWithRetry({
      client,
      model,
      taskType,
      gardenId,
      system:
        `${system}\n\nYour previous ${stageLabel} response failed the supplied hard validation problems. ` +
        "Return a complete corrected replacement JSON object. Do not explain, patch, omit required entries, or rely on code to fill anything in.",
      user: compactJson({
        originalRequest,
        invalidResponse,
        validationProblems: problems,
        repairAttempt,
      }),
      sourceContext: {
        gardenId,
        taskType,
        stageLabel,
        repairAttempt,
      },
      contentPath,
      jobId,
      preserveExactContent,
    });
    problems = validate(result.parsed);
    appendLearnEvent(contentPath, gardenId, "learn_planning_schema_repair_reviewed", {
      jobId,
      taskType,
      stageLabel,
      repairAttempt,
      remainingProblems: problems,
    });
  }
  if (problems.length > 0) {
    throw new Error(
      `${stageLabel} remained invalid after 3 bounded AI-authored attempts: ${problems.join("; ")}. No deterministic fallback was used.`,
    );
  }
  return result;
}

function sourceMapPlanProblems(input: {
  value: unknown;
  sourceIds: readonly string[];
  registeredArtifacts: readonly Pick<SourceFigure, "figureId" | "sourceId" | "kind" | "page">[];
  canonicalAnchors: readonly { id: string; sourceId: string }[];
}): string[] {
  const record = planningRecord(input.value);
  const problems: string[] = [];
  const rawSources = Array.isArray(record.sources) ? record.sources : [];
  if (!Array.isArray(record.sources)) problems.push("sources must be an array");
  const expectedSourceIds = new Set(input.sourceIds);
  const seenSourceIds = new Set<string>();
  rawSources.forEach((rawSource, index) => {
    const source = planningRecord(rawSource);
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || !expectedSourceIds.has(id)) {
      problems.push(`sources[${index}].id must be an exact supplied source id`);
    } else if (seenSourceIds.has(id)) {
      problems.push(`source ${id} appears more than once`);
    } else {
      seenSourceIds.add(id);
    }
    if (typeof source.title !== "string" || !source.title.trim()) {
      problems.push(`sources[${index}].title is required`);
    }
    if (typeof source.role !== "string" || !source.role.trim()) {
      problems.push(`sources[${index}].role is required`);
    }
    for (const field of ["centralConcepts", "formulas", "examples", "questions", "caveats"]) {
      if (!Array.isArray(source[field]) || !(source[field] as unknown[]).every((item) => typeof item === "string")) {
        problems.push(`sources[${index}].${field} must be an array of strings`);
      }
    }
  });
  for (const sourceId of expectedSourceIds) {
    if (!seenSourceIds.has(sourceId)) problems.push(`source ${sourceId} is missing from the Source Map`);
  }

  const figures = Array.isArray(record.figures) ? record.figures : [];
  if (!Array.isArray(record.figures)) problems.push("figures must be an array");
  const registeredArtifactById = new Map<string, {
    sourceId: string;
    kind: RegisteredSourceArtifact["kind"];
  }>();
  for (const artifact of input.registeredArtifacts) {
    const sourceId = typeof artifact.sourceId === "string" ? artifact.sourceId : "";
    if (!artifact.figureId || !sourceId) {
      problems.push("registered source artifacts require exact ids and source ids");
      continue;
    }
    if (registeredArtifactById.has(artifact.figureId)) {
      problems.push(`registered source artifact ${artifact.figureId} appears more than once`);
      continue;
    }
    const kind = artifact.kind === "table"
      ? "table"
      : artifact.kind === "formula"
        ? "formula"
        : artifact.kind === "graph"
          ? "graph"
          : "figure";
    registeredArtifactById.set(artifact.figureId, { sourceId, kind });
  }
  const registeredArtifactIds = new Set(registeredArtifactById.keys());
  const seenArtifactIds = new Set<string>();
  figures.forEach((rawFigure, index) => {
    const figure = planningRecord(rawFigure);
    const rawId = typeof figure.id === "string" ? figure.id : "";
    const id = rawId.trim();
    const rawSourceId = typeof figure.sourceId === "string" ? figure.sourceId : "";
    const sourceId = rawSourceId.trim();
    const registered = registeredArtifactById.get(id);
    if (!id || !registeredArtifactIds.has(id)) {
      problems.push(`figures[${index}].id must be copied from registered sourceVisuals`);
    } else if (rawId !== id) {
      problems.push(`figures[${index}].id must copy the registered artifact id exactly`);
    } else if (seenArtifactIds.has(id)) {
      problems.push(`registered artifact ${id} appears more than once`);
    } else {
      seenArtifactIds.add(id);
    }
    if (!expectedSourceIds.has(sourceId)) {
      problems.push(`figures[${index}].sourceId must be an exact supplied source id`);
    } else if (rawSourceId !== sourceId) {
      problems.push(`figures[${index}].sourceId must copy the registered source id exactly`);
    } else if (registered && registered.sourceId !== sourceId) {
      problems.push(`figures[${index}].sourceId must match registered artifact ${id}`);
    }
    const rawKind = typeof figure.kind === "string" ? figure.kind : "";
    if (!registered) {
      problems.push(`figures[${index}].kind must copy the registered artifact kind`);
    } else if (rawKind !== registered.kind) {
      problems.push(`figures[${index}].kind must match registered artifact ${id}`);
    }
  });
  for (const artifactId of registeredArtifactIds) {
    if (!seenArtifactIds.has(artifactId)) {
      problems.push(`registered source artifact ${artifactId} is missing from figures`);
    }
  }

  const anchors = Array.isArray(record.sourceAnchors) ? record.sourceAnchors : [];
  if (!Array.isArray(record.sourceAnchors)) problems.push("sourceAnchors must be an array");
  const canonicalAnchorById = new Map(input.canonicalAnchors.map((anchor) => [anchor.id, anchor]));
  const seenAnchorIds = new Set<string>();
  const anchoredSourceIds = new Set<string>();
  anchors.forEach((rawAnchor, index) => {
    const anchor = planningRecord(rawAnchor);
    const id = typeof anchor.id === "string" ? anchor.id.trim() : "";
    const canonical = canonicalAnchorById.get(id);
    if (!id || !canonical) {
      problems.push(`sourceAnchors[${index}].id must be copied from canonicalSourceAnchors`);
    } else if (seenAnchorIds.has(id)) {
      problems.push(`canonical source anchor ${id} appears more than once`);
    } else {
      seenAnchorIds.add(id);
    }
    const sourceId = typeof anchor.sourceId === "string" ? anchor.sourceId.trim() : "";
    if (!expectedSourceIds.has(sourceId)) {
      problems.push(`sourceAnchors[${index}].sourceId must be an exact supplied source id`);
    } else if (canonical && canonical.sourceId !== sourceId) {
      problems.push(`sourceAnchors[${index}].sourceId must match canonical anchor ${id}`);
    } else {
      anchoredSourceIds.add(sourceId);
    }
    if (typeof anchor.title !== "string" || !anchor.title.trim()) {
      problems.push(`sourceAnchors[${index}].title is required`);
    }
    if (typeof anchor.summary !== "string" || !anchor.summary.trim()) {
      problems.push(`sourceAnchors[${index}].summary is required`);
    }
  });
  for (const sourceId of expectedSourceIds) {
    if (!anchoredSourceIds.has(sourceId)) {
      problems.push(`source ${sourceId} must have at least one selected canonical source anchor`);
    }
  }
  if (!Array.isArray(record.missingOrUnclear) || !record.missingOrUnclear.every((item) => typeof item === "string")) {
    problems.push("missingOrUnclear must be an array of strings");
  }
  const authoredText = JSON.stringify(record);
  const unavailableClaim = (subject: RegExp) =>
    new RegExp(
      `${subject.source}[^.\\n]{0,100}(?:not (?:present|available|included|provided|detected)|unavailable|caption[- ]only)`,
      "i",
    ).test(authoredText);
  if (
    input.registeredArtifacts.some((artifact) => artifact.kind === "formula") &&
    unavailableClaim(/(?:formula|equation|mathematical notation|mathematical definition)s?/)
  ) {
    problems.push("Source Map contradicts the registry by claiming available formula/equation evidence is unavailable");
  }
  if (
    input.registeredArtifacts.some((artifact) => artifact.kind === "table") &&
    unavailableClaim(/tables?/)
  ) {
    problems.push("Source Map contradicts the registry by claiming available table evidence is unavailable");
  }
  if (
    input.registeredArtifacts.some((artifact) => artifact.kind !== "formula" && artifact.kind !== "table") &&
    unavailableClaim(/(?:figure|graph)s?/)
  ) {
    problems.push("Source Map contradicts the registry by claiming available figure/graph evidence is unavailable");
  }
  if (
    input.registeredArtifacts.some((artifact) => Number(artifact.page) > 24) &&
    /(?:truncated|available only|only available)[^.\n]{0,80}(?:page\s*24|first\s*24\s*pages)|later (?:pages|sections)[^.\n]{0,80}(?:not available|unavailable)/i.test(authoredText)
  ) {
    problems.push("Source Map contradicts the registry by claiming later source pages are unavailable");
  }
  return [...new Set(problems)];
}

function scopeContractProblems(value: unknown): string[] {
  const record = planningRecord(value);
  const problems: string[] = [];
  for (const field of ["included", "excluded", "background", "deferred", "sourceEmphasis", "caveats"]) {
    if (!Array.isArray(record[field]) || !(record[field] as unknown[]).every((item) => typeof item === "string")) {
      problems.push(`${field} must be an array of strings`);
    }
  }
  if (!Array.isArray(record.included) || record.included.length === 0) {
    problems.push("included must contain at least one model-authored scope item");
  }
  if (!Array.isArray(record.sourceEmphasis) || record.sourceEmphasis.length === 0) {
    problems.push("sourceEmphasis must contain at least one model-authored priority");
  }
  return [...new Set(problems)];
}

function errorMessage(error: unknown, fallback = "Request failed"): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : typeof error === "string" && error.trim()
        ? error.trim()
        : fallback;
  if (/^(connection error\.?|fetch failed)$/i.test(message) || /\beconnrefused\b/i.test(message)) {
    return "The AI service connection was lost during Learn. Retry Learn; if it fails again, restart Breadboard's AI service.";
  }
  return message;
}

function errorField(error: unknown, field: "name" | "code" | "status"): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isPlanningTimeoutError(error: unknown): boolean {
  const haystack = [
    errorMessage(error, ""),
    errorField(error, "name"),
    errorField(error, "code"),
    errorField(error, "status"),
  ]
    .join(" ")
    .toLowerCase();
  return /timeout|timed out|aborted|aborterror|etimedout|econnreset|socket hang up/.test(haystack);
}

function importantSourceArtifactCount(context: LearnSourceContext): number {
  return context.sourceFigures.filter((figure) => Boolean(figure.figureId)).length;
}

function modelAuthoredLearningMapMetadataProblems(value: unknown): string[] {
  const record = planningRecord(value);
  const problems: string[] = [];
  if (typeof record.title !== "string" || !record.title.trim()) {
    problems.push("planner returned no model-authored garden title");
  } else if (sanitizeLearnerTitle(record.title.trim()) !== record.title.trim()) {
    problems.push(
      `model-authored garden title violates learner-facing title rules; return it already corrected as "${sanitizeLearnerTitle(record.title.trim())}"`,
    );
  }
  if (typeof record.summary !== "string" || !record.summary.trim()) {
    problems.push("planner returned no model-authored garden summary");
  }
  return problems;
}

function modelAuthoredUnitTitleProblems(units: readonly LearningUnitContract[]): string[] {
  const problems: string[] = [];
  for (const unit of units) {
    if (unit.title && sanitizeLearnerTitle(unit.title) !== unit.title) {
      problems.push(
        `unit "${unit.id}": model-authored title violates learner-facing title rules; return it already corrected as "${sanitizeLearnerTitle(unit.title)}"`,
      );
    }
    const sectionTitle = unit.sectionPlan?.title;
    if (sectionTitle && sanitizeLearnerTitle(sectionTitle) !== sectionTitle) {
      problems.push(
        `section "${unit.sectionPlan?.id}": model-authored title violates learner-facing title rules; return it already corrected as "${sanitizeLearnerTitle(sectionTitle)}"`,
      );
    }
  }
  return [...new Set(problems)];
}

function planningRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function learningMapFromPlanningCandidate({
  candidate,
  units,
  gardenId,
  sourceOnly,
  createdAt,
  warnings = [],
}: {
  candidate: unknown;
  units: LearningUnitContract[];
  gardenId: string;
  sourceOnly: boolean;
  createdAt: string;
  warnings?: string[];
}): ProposedLearningMap {
  const record = planningRecord(candidate);
  if (typeof record.title !== "string" || typeof record.summary !== "string") {
    throw new Error("Model-authored learning-map title and summary are required.");
  }
  return learningMapFromModelAuthoredUnits(units, {
    gardenId,
    title: record.title,
    summary: record.summary,
    sourceOnly,
    createdAt,
    warnings,
  });
}

function modelAuthoredLearningMapDepthProblems({
  candidate,
  units,
  gardenId,
  sourceOnly,
  context,
}: {
  candidate: unknown;
  units: LearningUnitContract[];
  gardenId: string;
  sourceOnly: boolean;
  context: LearnSourceContext;
}): string[] {
  try {
    return validateLearningMapDepth(
      learningMapFromPlanningCandidate({
        candidate,
        units,
        gardenId,
        sourceOnly,
        createdAt: nowIso(),
      }),
      context,
    );
  } catch {
    // Exact metadata and section-projection failures are already reported by
    // their dedicated hard validators in the same candidate evaluation.
    return [];
  }
}

function sourceCoveragePlan(
  context: LearnSourceContext,
  learningMap: ProposedLearningMap,
  learningUnits: LearningUnitContract[] = [],
  sourceArtifactAssignments: SourceArtifactAssignment[] = [],
  sourceArtifactOmissions: SourceArtifactOmission[] = [],
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>> = {},
  syllabusCoverage: SyllabusCoverage | null = null,
): unknown {
  const syllabusCoverageEvidenceRecovery = syllabusCoverage?.evidenceRecovery;
  const syllabusCoverageEvidenceRecoveryHash =
    syllabusCoverageEvidenceRecovery?.integritySha256 ?? "";
  return {
    sourceSetHash: context.sourceSetHash,
    sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
    sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    syllabusCoverageEvidenceRecoveryHash,
    ...(syllabusCoverageEvidenceRecovery
      ? { syllabusCoverageEvidenceRecovery }
      : {}),
    learningUnitContracts: learningUnits,
    sourceArtifactAssignments,
    sourceArtifactOmissions,
    sources: context.sources.map((source) => ({
      id: source.slug,
      title: source.title,
      plannedPages: learningMap.sections.flatMap((section) =>
        section.subsections
          .filter((subsection) => {
            const anchorIds = [...section.sourceAnchors, ...subsection.sourceAnchors];
            return anchorIds.some((anchorId) => canonicalSourceAnchors[anchorId]?.sourceId === source.slug);
          })
          .map((subsection) => `${section.title} / ${subsection.title}`),
      ),
    })),
    figures: context.sourceFigures.map((figure) => ({
      figureId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      assignedLearningUnit:
        sourceArtifactAssignments.find((assignment) => assignment.sourceArtifactId === figure.figureId)
          ?.assignedLearningUnitId ?? "",
      omissionReason:
        sourceArtifactOmissions.find((omission) => omission.sourceArtifactId === figure.figureId)
          ?.reason ?? "",
      suggestedVisualTreatment: figure.suggestedVisualUse ?? "",
    })),
  };
}

function conceptRegistryAlignmentProblems(input: {
  clusterDir: string;
  sourceSetHash: string;
  units: readonly LearningUnitContract[];
}): string[] {
  try {
    buildModelAuthoredConceptRegistry({
      gardenId: path.basename(input.clusterDir),
      sourceSetHash: input.sourceSetHash,
      concepts: input.units.flatMap((unit) => unit.semanticConcepts ?? []),
    });
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function canonicalLearningSpineEvidenceByUnit(
  clusterDir: string,
  units: readonly LearningUnitContract[],
): Record<string, unknown[]> {
  const registry = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  return Object.fromEntries(units.map((unit) => [
    unit.id,
    declaredSourceAnchorIdsForUnit(unit).flatMap((anchorId) => {
      const anchor = registry[anchorId];
      if (!anchor) return [];
      return [{
        id: anchor.id,
        kind: anchor.kind,
        sourceId: anchor.sourceId,
        page: anchor.page,
        title: anchor.title,
        caption: anchor.caption,
        semanticSummary: anchor.semanticSummary,
        exactText: anchor.exactText,
      }];
    }),
  ]));
}

function sourceFormulaReviewSetHashFromCoveragePlan(value: unknown): string | undefined {
  const candidate = planningRecord(value).sourceFormulaReviewSetHash;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function sourceArtifactInventoryHashFromCoveragePlan(value: unknown): string | undefined {
  const candidate = planningRecord(value).sourceArtifactInventoryHash;
  return typeof candidate === "string" && /^[0-9a-f]{64}$/i.test(candidate)
    ? candidate.toLowerCase()
    : undefined;
}

function syllabusCoverageEvidenceRecoveryHashFromCoveragePlan(
  value: unknown,
): string | undefined {
  const candidate = planningRecord(value).syllabusCoverageEvidenceRecoveryHash;
  return typeof candidate === "string" && /^[0-9a-f]{64}$/.test(candidate)
    ? candidate
    : undefined;
}

function syllabusCoverageRecoverySources(
  context: LearnSourceContext,
): Array<{ sourceId: string; relPath: string; body?: string }> {
  return context.sources.map((source) => ({
    sourceId: source.slug,
    relPath: source.relPath,
    body: source.body,
  }));
}

function syllabusCoverageRecoveryBindingProblems(input: {
  context: LearnSourceContext;
  coveragePlan: unknown;
  syllabusCoverage: SyllabusCoverage | null | undefined;
}): string[] {
  const problems: string[] = [];
  if (input.context.syllabus && !input.syllabusCoverage) {
    return ["active syllabus has no persisted coverage decision"];
  }
  if (!input.context.syllabus && input.syllabusCoverage) {
    return ["persisted syllabus coverage has no active syllabus source"];
  }
  const receipt = input.syllabusCoverage?.evidenceRecovery as unknown;
  const receiptPresent = receipt !== undefined;
  const declaredReceipt = planningRecord(input.coveragePlan)
    .syllabusCoverageEvidenceRecovery;
  const declaredReceiptPresent = declaredReceipt !== undefined;
  const declaredHash = syllabusCoverageEvidenceRecoveryHashFromCoveragePlan(
    input.coveragePlan,
  );
  const rawDeclaredHash = planningRecord(input.coveragePlan)
    .syllabusCoverageEvidenceRecoveryHash;
  if (!receiptPresent) {
    if (declaredReceiptPresent) {
      problems.push("coverage plan carries a syllabus evidence-recovery receipt without persisted coverage provenance");
    }
    if (rawDeclaredHash !== undefined && rawDeclaredHash !== "") {
      problems.push("coverage plan declares a syllabus evidence-recovery hash without a receipt");
    }
    if (input.syllabusCoverage && !syllabusCoverageHasTeachableUnits(input.syllabusCoverage)) {
      problems.push("zero-teachable syllabus coverage cannot proceed without a recovered receipt");
    }
    return problems;
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return [...problems, "persisted syllabus evidence-recovery receipt is malformed"];
  }
  const typedReceipt = receipt as SyllabusCoverageEvidenceRecoveryReceipt;
  if (!declaredReceiptPresent ||
      JSON.stringify(declaredReceipt) !== JSON.stringify(typedReceipt)) {
    problems.push("coverage plan syllabus evidence-recovery receipt does not match persisted coverage provenance");
  }
  if (!declaredHash || declaredHash !== typedReceipt.integritySha256) {
    problems.push("coverage plan syllabus evidence-recovery hash does not match its receipt");
  }
  problems.push(...syllabusCoverageRecoveryReceiptProblems({
    receipt: typedReceipt,
    sources: syllabusCoverageRecoverySources(input.context),
    anchors: structuralSourceTextAnchorCatalog(input.context),
    coverage: input.syllabusCoverage ?? undefined,
    expectedSourceSetHash: input.context.sourceSetHash,
    expectedSourceArtifactInventoryHash: input.context.sourceArtifactInventoryHash,
  }));
  if (typedReceipt.outcome !== "recovered" ||
      !syllabusCoverageHasTeachableUnits(input.syllabusCoverage)) {
    problems.push("syllabus evidence recovery did not produce a teachable coverage decision");
  }
  return [...new Set(problems)];
}

function assertSyllabusCoverageRecoveryBinding(input: {
  context: LearnSourceContext;
  coveragePlan: unknown;
  syllabusCoverage: SyllabusCoverage | null | undefined;
  stage: string;
}): void {
  const problems = syllabusCoverageRecoveryBindingProblems(input);
  if (problems.length > 0) {
    throw new LearnPipelineConflictError(
      `${input.stage} syllabus coverage evidence recovery is stale or invalid: ${problems.join("; ")}`,
    );
  }
}

function exactCanonicalRepairSourceText(
  clusterDir: string,
  request: UnitRepairRequest,
): string | undefined {
  const registry = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  const requestedAnchorIds = request.sourceAnchors.flatMap((anchor) => [
    anchor.figureId,
    anchor.tableId,
    anchor.equationId,
    anchor.questionId,
    anchor.textAnchorId,
  ]).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const interactionAnchorIds = [
    ...(request.learningUnitContract.interactiveVisual?.sourceAnchors ?? []),
    ...(request.learningUnitContract.interactiveVisualPlan?.visualIntent?.sourceAnchors ?? []),
  ];
  const anchorIds = [...new Set([
    ...declaredSourceAnchorIdsForUnit(request.learningUnitContract),
    ...requestedAnchorIds,
    ...interactionAnchorIds,
  ])];
  const records = anchorIds.flatMap((anchorId) => {
    const anchor = registry[anchorId];
    if (!anchor) return [];
    const exactText = anchor.exactText?.trim();
    const registeredCaption =
      (anchor.kind === "figure" || anchor.kind === "graph" || anchor.kind === "table")
        ? anchor.caption?.trim()
        : "";
    const text = exactText || registeredCaption;
    return text ? [`[${anchorId}]\n${text}`] : [];
  });
  return records.length > 0 ? records.join("\n\n") : undefined;
}

function canonicalSourceAnchorProblems(
  clusterDir: string,
  units: readonly LearningUnitContract[],
): string[] {
  const registry = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  return units.flatMap((unit) => {
    const declared = declaredSourceAnchorIdsForUnit(unit);
    const problems = declared
      .filter((anchorId) => !registry[anchorId])
      .map((anchorId) => `unit "${unit.id}" references unregistered canonical source anchor "${anchorId}"`);
    if (!declared.some((anchorId) => Boolean(registry[anchorId]?.exactText))) {
      problems.push(
        `unit "${unit.id}" has no canonical exact-text source anchor; select at least one supplied Markdown page or verified formula anchor`,
      );
    }
    const exactTextChars = [...new Set(declared)].reduce(
      (total, anchorId) => total + (registry[anchorId]?.exactText?.trim().length ?? 0),
      0,
    );
    if (exactTextChars > MAX_TOTAL_SOURCE_CHARS_PER_PAGE) {
      problems.push(
        `unit "${unit.id}" selects ${exactTextChars} characters of exact source evidence, above the ${MAX_TOTAL_SOURCE_CHARS_PER_PAGE}-character page transport limit; choose fewer, more precise canonical anchors`,
      );
    }
    return problems;
  });
}

function syllabusUnitAssignmentProblems(
  units: readonly LearningUnitContract[],
  syllabusCoverage: SyllabusCoverage | null,
): string[] {
  if (!syllabusCoverage) {
    return units.flatMap((unit) =>
      (unit.syllabusUnitIds ?? []).length > 0
        ? [`unit "${unit.id}" must use an empty syllabusUnitIds array because no syllabus is active`]
        : []);
  }
  const coverageById = new Map(syllabusCoverage.units.map((unit) => [unit.unitId, unit]));
  return units.flatMap((unit) => {
    const ids = unit.syllabusUnitIds ?? [];
    const problems: string[] = [];
    if (ids.length === 0) {
      problems.push(`unit "${unit.id}" must select at least one exact syllabus unit id`);
    }
    for (const id of ids) {
      const syllabusUnit = coverageById.get(id);
      if (!syllabusUnit) {
        problems.push(`unit "${unit.id}" references unknown syllabus unit "${id}"`);
      } else if (!syllabusUnit.teachable) {
        problems.push(`unit "${unit.id}" references syllabus unit "${id}" that the coverage review judged unteachable`);
      }
    }
    return problems;
  });
}

function writeLearningUnitContractArtifacts({
  clusterDir,
  units,
  assignments,
  omissions,
  registeredArtifacts,
  sourceSetHash,
  sourceFormulaReviewSetHash,
  sourceArtifactInventoryHash,
  syllabusCoverageEvidenceRecovery,
  visualNecessityReview,
}: {
  clusterDir: string;
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  omissions: SourceArtifactOmission[];
  registeredArtifacts: RegisteredSourceArtifact[];
  sourceSetHash: string;
  sourceFormulaReviewSetHash?: string;
  sourceArtifactInventoryHash: string;
  syllabusCoverageEvidenceRecovery?: SyllabusCoverageEvidenceRecoveryReceipt;
  visualNecessityReview?: GardenVisualNecessityPlan;
}): {
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  omissions: SourceArtifactOmission[];
  removedArtifactIds: string[];
  semanticAliasRepairs: Array<{
    normalizedAlias: string;
    removedFrom: string[];
    reason: string;
  }>;
} {
  const deferredSourceAnchors: string[] = [];
  const canonicalSourceAnchors = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  const validateSourceAnchors = (anchors: string[] | undefined): void => {
    if (!Array.isArray(anchors) || anchors.length === 0) return;
    deferredSourceAnchors.push(...anchors.filter((anchor) => !canonicalSourceAnchors[anchor]));
  };
  for (const unit of units) {
    validateSourceAnchors(unit.sourceAnchors);
    for (const concept of unit.semanticConcepts ?? []) validateSourceAnchors(concept.evidenceAnchors);
    for (const claim of unit.knowledgeClaims ?? []) {
      validateSourceAnchors(claim.evidenceAnchors);
      validateSourceAnchors(claim.derivationAnchors);
    }
    validateSourceAnchors(unit.interactiveVisual?.sourceAnchors);
    validateSourceAnchors(unit.interactiveVisualPlan?.decision.evidence.sourceAnchorIds);
    validateSourceAnchors(unit.interactiveVisualPlan?.visualIntent?.sourceAnchors);
    for (const control of unit.interactiveVisualPlan?.controlContract ?? []) {
      validateSourceAnchors(control.evidence.map((evidence) => evidence.anchor));
    }
    validateSourceAnchors(unit.interactiveVisualPlan?.observable?.evidence.map((evidence) => evidence.anchor));
    validateSourceAnchors(unit.interactiveVisualPlan?.expectedInsightEvidence?.map((evidence) => evidence.anchor));
    validateSourceAnchors(unit.teachingMediumPlan?.sourceFigureAnchorId ? [unit.teachingMediumPlan.sourceFigureAnchorId] : []);
    validateSourceAnchors(unit.teachingMediumPlan?.formulaAnchorIds);
  }
  if (deferredSourceAnchors.length > 0) {
    throw new Error(
      `Model-authored source anchors could not be proven: ${[...new Set(deferredSourceAnchors)].join(", ")}. Repair the contract from registered source evidence.`,
    );
  }
  const ownershipProblems = sourceArtifactOwnershipProblems(units);
  if (ownershipProblems.length > 0) {
    throw new Error(`Model-authored source artifact ownership failed: ${ownershipProblems.join("; ")}`);
  }
  const artifactCoverageProblems = sourceArtifactCoverageProblems(
    units,
    omissions,
    registeredArtifacts,
  );
  if (artifactCoverageProblems.length > 0) {
    throw new Error(`Model-authored source artifact coverage failed: ${artifactCoverageProblems.join("; ")}`);
  }
  const expectedAssignments = projectModelAuthoredSourceArtifactAssignments(units);
  if (JSON.stringify(assignments) !== JSON.stringify(expectedAssignments)) {
    throw new Error("Source artifact assignment projection does not exactly match the model-authored Learning Unit Contract.");
  }
  const sourceArtifactReconciliation = reconcileLearningUnitSourceArtifacts(
    units,
    expectedAssignments,
    registeredArtifactsForGarden(clusterDir),
  );
  if (sourceArtifactReconciliation.removedArtifactIds.length > 0) {
    throw new Error(
      `Model-authored structured source artifacts are not registered: ${sourceArtifactReconciliation.removedArtifactIds.join(", ")}. Repair the contract instead of dropping them.`,
    );
  }
  const registryProblems = conceptRegistryAlignmentProblems({ clusterDir, sourceSetHash, units });
  if (registryProblems.length > 0) {
    throw new Error(`Model-authored concept registry alignment failed: ${registryProblems.join("; ")}`);
  }
  const registry = buildModelAuthoredConceptRegistry({
    gardenId: path.basename(clusterDir),
    sourceSetHash,
    concepts: units.flatMap((unit) => unit.semanticConcepts ?? []),
  });
  const reconciledUnits = units;
  const semanticAliasRepairs: Array<{
    normalizedAlias: string;
    removedFrom: string[];
    reason: string;
  }> = [];
  const finalAssignments = expectedAssignments;
  // Pedagogical visual decisions are model-authored before this writer runs.
  // This boundary may reconcile source registries mechanically, but it must
  // never replace those decisions with keyword scores, quotas, or inferred
  // media. Missing review data is therefore a hard planning error.
  if (!visualNecessityReview) {
    throw new Error("A validated model-authored visual-necessity plan is required before persisting the Learning Unit Contract.");
  }
  const decisionByUnit = new Map(
    visualNecessityReview.decisions.map((decision) => [decision.unitId, decision]),
  );
  const mediumByUnit = new Map(
    visualNecessityReview.teachingMedia.map((medium) => [medium.unitId, medium]),
  );
  const missingVisualPlans = reconciledUnits.filter((unit) =>
    !unit.interactiveVisualPlan ||
    !decisionByUnit.has(unit.id) ||
    !unit.teachingMediumPlan ||
    !mediumByUnit.has(unit.id));
  if (missingVisualPlans.length > 0) {
    throw new Error(
      `Model-authored visual-necessity coverage is missing for: ${missingVisualPlans.map((unit) => unit.id).join(", ")}`,
    );
  }
  saveVisualNecessityArtifacts(clusterDir, path.basename(clusterDir), {
    decisions: visualNecessityReview.decisions,
    teachingMedia: visualNecessityReview.teachingMedia,
    budget: visualNecessityReview.budget,
    overrides: visualNecessityReview.overrides,
    reviewCalls: visualNecessityReview.reviewCalls,
    rejectedReviews: visualNecessityReview.rejectedReviews,
    decisionRecords: visualNecessityReview.decisionRecords,
    zeroVisualSafeguard: visualNecessityReview.zeroVisualSafeguard,
    unresolvedRecords: visualNecessityReview.unresolvedRecords,
  });
  const payload = {
    sourceSetHash,
    sourceFormulaReviewSetHash,
    sourceArtifactInventoryHash,
    syllabusCoverageEvidenceRecoveryHash:
      syllabusCoverageEvidenceRecovery?.integritySha256 ?? "",
    ...(syllabusCoverageEvidenceRecovery
      ? { syllabusCoverageEvidenceRecovery }
      : {}),
    generatedAt: nowIso(),
    learningUnits: reconciledUnits,
    sourceArtifactAssignments: finalAssignments,
    sourceArtifactOmissions: omissions,
    ...(deferredSourceAnchors.length ? { deferredSourceAnchors: [...new Set(deferredSourceAnchors)] } : {}),
    ...(semanticAliasRepairs.length
      ? { semanticAliasRepairs }
      : {}),
  };
  const lines = [
    "# Learning Unit Contract",
    "",
    "<!--",
    "artifactRole: pre_executability_learning_unit_contract_summary",
    "interactionContractsAreAuthoritative: false",
    "supersededBy: .breadboard/learning-unit-contract.json, .breadboard/visualization-plan.json, .breadboard/visual-contract-executability-reviews.json",
    "-->",
    "",
    "> **Artifact role:** Pre-executability planning summary. Its interaction controls are not authoritative until the executability ledger and final JSON contract are persisted.",
    "",
    `Source set hash: ${sourceSetHash}`,
    `Source artifact inventory hash: ${sourceArtifactInventoryHash}`,
    `Learning units: ${reconciledUnits.length}`,
    `Source artifact assignments: ${finalAssignments.length}`,
    `Source artifact omissions: ${omissions.length}`,
    "",
    "## Units",
    "",
  ];
  for (const unit of reconciledUnits) {
    lines.push(`- ${unit.id}: ${unit.title} (${unit.role})`);
    lines.push(`  - Question: ${unit.learningQuestion || unit.title}`);
    const artifacts = finalAssignments
      .filter((assignment) => assignment.assignedLearningUnitId === unit.id)
      .map((assignment) => `${assignment.sourceArtifactId} -> ${assignment.placement}`);
    if (artifacts.length > 0) lines.push(`  - Artifacts: ${artifacts.join(", ")}`);
    if (unit.interactiveVisual) {
      lines.push(`  - Interactive: ${unit.interactiveVisual.visualType} (${unit.interactiveVisual.uniqueConcept})`);
    }
    if (unit.interactiveVisualPlan) {
      lines.push(
        `  - Interactive requirement: ${unit.interactiveVisualPlan.requirement} (${unit.interactiveVisualPlan.decision.reason})`,
      );
    }
    if (unit.teachingMediumPlan) {
      lines.push(`  - Preferred medium: ${unit.teachingMediumPlan.preferredMedium}`);
    }
    const concepts = (unit.semanticConcepts ?? []).map((concept) => concept.slug);
    if (concepts.length > 0) lines.push(`  - Concepts: ${concepts.join(", ")}`);
    const claims = unit.knowledgeClaims ?? [];
    if (claims.length > 0) lines.push(`  - Claims: ${claims.map((claim) => claim.text).join(" | ")}`);
  }
  if (omissions.length > 0) {
    lines.push("", "## Model-authored omissions", "");
    for (const omission of omissions) {
      lines.push(`- ${omission.sourceArtifactId}: ${omission.reason}`);
    }
  }
  writeGardenConceptRegistryAndContract({
    gardenDir: clusterDir,
    registry,
    contract: payload,
    planningMarkdown: `${lines.join("\n")}\n`,
    strictModelAuthored: true,
  });
  return {
    units: reconciledUnits,
    assignments: finalAssignments,
    omissions,
    removedArtifactIds: sourceArtifactReconciliation.removedArtifactIds,
    semanticAliasRepairs,
  };
}

function persistRoutedVisualPlans(
  clusterDir: string,
  units: LearningUnitContract[],
): void {
  const filePath = path.join(clusterDir, ".breadboard", "learning-unit-contract.json");
  if (!fs.existsSync(filePath)) {
    throw new Error("Cannot persist routed visuals because the Learning Unit Contract is missing.");
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  if (!Array.isArray(parsed.learningUnits)) {
    throw new Error("Cannot persist routed visuals because learningUnits is not an array.");
  }
  const rawUnits = parsed.learningUnits as Array<Record<string, unknown>>;
  const persistedIds = rawUnits.map((raw) => typeof raw?.id === "string" ? raw.id : "");
  const routedIds = units.map((unit) => unit.id);
  if (
    persistedIds.some((id) => !id) ||
    new Set(persistedIds).size !== persistedIds.length ||
    new Set(routedIds).size !== routedIds.length ||
    JSON.stringify(persistedIds) !== JSON.stringify(routedIds)
  ) {
    throw new Error(
      "Cannot persist routed visuals because persisted and in-memory learning-unit IDs do not match exactly.",
    );
  }
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  parsed.learningUnits = rawUnits.map((raw) => {
    const id = typeof raw.id === "string" ? raw.id : "";
    const unit = byId.get(id);
    if (!unit) return raw;
    const next: Record<string, unknown> = {
      ...raw,
      interactiveVisualPlan: unit.interactiveVisualPlan,
      teachingMediumPlan: unit.teachingMediumPlan,
    };
    if (unit.interactiveVisual) next.interactiveVisual = unit.interactiveVisual;
    else delete next.interactiveVisual;
    return next;
  });
  const jsonPayload = `${JSON.stringify(parsed, null, 2)}\n`;
  fs.writeFileSync(filePath, jsonPayload, "utf-8");
  const contractHash = createHash("sha256").update(jsonPayload).digest("hex");
  const planningMarkdownPath = path.join(
    clusterDir,
    ...AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH.split("/"),
  );
  fs.mkdirSync(path.dirname(planningMarkdownPath), { recursive: true });
  fs.writeFileSync(
    planningMarkdownPath,
    renderAuthoritativeLearningUnitContractMarkdown({
      units,
      authoritativeSourceSha256: contractHash,
    }),
    "utf-8",
  );
}

function learningUnitsFromCoveragePlan(plan: unknown): LearningUnitContract[] {
  const record = planningRecord(plan);
  const raw = { learningUnits: record.learningUnitContracts };
  const problems = modelAuthoredLearningUnitParseProblems(raw);
  if (problems.length > 0) {
    throw new Error(
      `Stored model-authored Learning Unit Contract is invalid: ${problems.join("; ")}`,
    );
  }
  return normalizeLearningUnits(
    raw,
    { modelAuthoredOnly: true },
  );
}

/** Reject incompatible legacy visual payloads before the dedicated model visual pass. */
function prematureVisualPlanningProblems(units: readonly LearningUnitContract[]): string[] {
  return units
    .filter((unit) => unit.interactiveVisual || unit.interactiveVisualPlan || unit.teachingMediumPlan)
    .map(
      (unit) =>
        `unit "${unit.id}" authored visual decisions during learning-spine planning; remove them so the dedicated whole-garden visual model can decide`,
    );
}

function isContractBackedLearningMap(map: StoredLearningMap | null | undefined): map is StoredLearningMap {
  if (!map || !/^[0-9a-f]{64}$/i.test(map.sourceArtifactInventoryHash)) return false;
  const coverageInventoryHash = sourceArtifactInventoryHashFromCoveragePlan(map.coveragePlan);
  const coverageRecord = planningRecord(map.coveragePlan);
  const persistedRecovery = map.syllabusCoverage?.evidenceRecovery as unknown;
  const plannedRecovery = coverageRecord.syllabusCoverageEvidenceRecovery;
  const persistedRecoveryPresent = persistedRecovery !== undefined;
  const plannedRecoveryPresent = plannedRecovery !== undefined;
  if (Boolean(map.syllabusSourceId) !== Boolean(map.syllabusCoverage)) return false;
  if (map.syllabusCoverage && !syllabusCoverageHasTeachableUnits(map.syllabusCoverage)) return false;
  if (persistedRecoveryPresent !== plannedRecoveryPresent) return false;
  if (persistedRecoveryPresent) {
    if (!persistedRecovery || typeof persistedRecovery !== "object" || Array.isArray(persistedRecovery)) {
      return false;
    }
    const receipt = persistedRecovery as SyllabusCoverageEvidenceRecoveryReceipt;
    if (receipt.outcome !== "recovered" ||
        !/^[0-9a-f]{64}$/.test(receipt.integritySha256) ||
        coverageRecord.syllabusCoverageEvidenceRecoveryHash !== receipt.integritySha256 ||
        JSON.stringify(plannedRecovery) !== JSON.stringify(receipt)) {
      return false;
    }
  } else if (coverageRecord.syllabusCoverageEvidenceRecoveryHash !== undefined &&
             coverageRecord.syllabusCoverageEvidenceRecoveryHash !== "") {
    return false;
  }
  return Boolean(
    coverageInventoryHash &&
    coverageInventoryHash === map.sourceArtifactInventoryHash.toLowerCase() &&
    learningUnitsFromCoveragePlan(map.coveragePlan).length > 0,
  );
}

function sourceArtifactAssignmentsFromCoveragePlan(plan: unknown): SourceArtifactAssignment[] {
  const raw = planningRecord(plan).sourceArtifactAssignments;
  if (!Array.isArray(raw)) return [];
  const assignments = raw
    .map((item) => (item && typeof item === "object" ? (item as SourceArtifactAssignment) : null))
    .filter((item): item is SourceArtifactAssignment => Boolean(item));
  const units = learningUnitsFromCoveragePlan(plan);
  const ownershipProblems = sourceArtifactOwnershipProblems(units);
  if (ownershipProblems.length > 0) {
    throw new Error(`Stored model-authored source artifact ownership is invalid: ${ownershipProblems.join("; ")}`);
  }
  const expected = projectModelAuthoredSourceArtifactAssignments(units);
  if (JSON.stringify(assignments) !== JSON.stringify(expected)) {
    throw new Error("Stored source artifact assignments do not exactly match the model-authored Learning Unit Contract.");
  }
  return assignments;
}

function sourceArtifactOmissionsFromCoveragePlan(plan: unknown): SourceArtifactOmission[] {
  const raw = {
    sourceArtifactOmissions: planningRecord(plan).sourceArtifactOmissions,
  };
  const problems = modelAuthoredSourceArtifactOmissionParseProblems(raw);
  if (problems.length > 0) {
    throw new Error(
      `Stored model-authored source artifact omissions are invalid: ${problems.join("; ")}`,
    );
  }
  return projectModelAuthoredSourceArtifactOmissions(raw);
}

function learningMapWithConfirmedUnitContracts(
  learningMap: ProposedLearningMap,
  units: LearningUnitContract[],
): ProposedLearningMap {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  return {
    ...learningMap,
    sections: learningMap.sections.map((section) => ({
      ...section,
      subsections: section.subsections.map((subsection) => {
        const unit = subsection.learningUnitId ? unitsById.get(subsection.learningUnitId) : undefined;
        if (!unit) return subsection;
        const interactiveVisuals = unit.interactiveVisual
          ? [
              {
                concept: unit.interactiveVisual.uniqueConcept,
                reason: unit.interactiveVisual.whyStaticSourceFigureIsNotEnough,
              },
            ]
          : [];
        return {
          ...subsection,
          sourceAnchors: unit.sourceAnchors,
          conceptTags: (unit.semanticConcepts ?? []).map((concept) => concept.slug),
          sourceVisualIds: [...new Set([
            ...unit.sourceFigures.filter((figure) => figure.placement !== "not_used_with_reason").map((figure) => figure.id),
            ...unit.sourceFormulas.map((formula) => formula.id),
            ...unit.sourceTables.map((table) => table.id),
          ])],
          interactiveVisuals,
          learningUnitRole: unit.role,
          learningQuestion: unit.learningQuestion,
          prerequisiteConcepts: unit.prerequisiteConcepts,
          newConcepts: unit.newConcepts,
          syllabusUnitIds: unit.syllabusUnitIds ?? [],
          mustNotRepeat: unit.mustNotRepeat,
          expectedWordRange: unit.expectedWordRange,
          sourceFigureContracts: unit.sourceFigures,
          sourceFormulaContracts: unit.sourceFormulas,
          sourceTableContracts: unit.sourceTables,
          sourceArtifactAssignments: projectModelAuthoredSourceArtifactAssignments([unit]),
          interactiveVisualContract: unit.interactiveVisual,
          interactiveVisualPlan: unit.interactiveVisualPlan,
          teachingMediumPlan: unit.teachingMediumPlan,
          zettelNotes: unit.zettelNotes,
        };
      }),
    })),
  };
}

export async function runLearnPlanning({
  gardenId,
  userId,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  includedSourceIds,
  syllabusSourceId,
  sourceOnly = true,
  includeSourceSnapshots = false,
  resetSourceMap = false,
  retainLeaseOnSuccess = false,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  includedSourceIds?: readonly string[];
  /** Slug of an uploaded document to use as the course study guide. */
  syllabusSourceId?: string | null;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  resetSourceMap?: boolean;
  /** Internal full-rebuild handoff: the caller must release retainedLease. */
  retainLeaseOnSuccess?: boolean;
}): Promise<{
  job: LearnJob;
  learningMap: StoredLearningMap;
  retainedLease?: GardenLearnLease;
}> {
  assertNoPendingLearnClear(gardenId);
  const gardenDir = clusterPath(contentPath, gardenId);
  const jobId = makeId("learn_job");
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId,
    buildId: `planning:${jobId}`,
  }, {
    onLeaseLost: () => abortLearnWorkerAfterLeaseLoss(jobId),
  });
  if (!leaseResult.acquired) {
    const message = `Another Learn operation (${leaseResult.conflict.jobId}) is already changing this garden.`;
    throw new LearnPipelineConflictError(message);
  }
  const lease = leaseResult.lease;
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
  } catch (error) {
    lease.release();
    throw error;
  }
  let context: LearnSourceContext;
  try {
    context = collectLearnSourceContext(
      contentPath,
      gardenId,
      includedSourceIds,
      syllabusSourceId,
    );
  } catch (error) {
    lease.release();
    throw error;
  }
  let leaseTransferred = false;
  let job: LearnJob;
  try {
    if (resetSourceMap) {
      const previousJob = getLatestLearnJob(gardenId);
      if (previousJob?.status === "failed") {
        await rollbackLearnRun({
          gardenId,
          contentPath,
          jobId: previousJob.id,
          lease,
        });
        if (!lease.heartbeat()) {
          throw new LearnPipelineConflictError(
            "Learn planning lost its lease after restoring the previous failed run.",
          );
        }
        discardLearnRunSnapshot({
          gardenId,
          contentPath,
          jobId: previousJob.id,
        });
      }
    }
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease before creating its job.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
    job = createLearnJob({
      id: jobId,
      gardenId,
      userId,
      model,
      mode: resetSourceMap ? "full_rebuild" : "plan",
      // The full selection is persisted, syllabus included, so a later run
      // reproduces exactly the same teaching-set/syllabus split.
      sourceIds: context.selectedSourceIds,
      syllabusSourceId: context.syllabus?.slug,
      sourceOnly,
      includeSourceSnapshots,
    });
  } catch (error) {
    lease.release();
    throw error;
  }
  let disposeModelTracking = (): void => {};
  try {
    createLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease while creating the rollback snapshot.",
      );
    }
    if (resetSourceMap) {
      const reset = clearSourceMapForRegeneration({ gardenId, contentPath });
      appendLearnEvent(contentPath, gardenId, "learn_regeneration_source_map_cleared", {
        jobId: job.id,
        removedPathCount: reset.removedPaths.length,
        deletedMaps: reset.deletedMaps,
        deletedVersions: reset.deletedVersions,
      });
    }
    disposeModelTracking = attachLearnJobModelTracking({
      client,
      jobId: job.id,
      gardenId,
      contentPath,
    });
  } catch (error) {
    const message = errorMessage(error, "Planning workspace could not be prepared");
    if (!lease.lost && !leaseLostLearnJobs.has(job.id)) {
      try {
        await rollbackLearnRun({ gardenId, contentPath, jobId: job.id, lease });
        updateLearnJobExpectStatus(job.id, {
          status: "failed",
          currentStep: "Planning could not start; prior Learn state restored",
          error: message,
        });
        discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
      } catch (rollbackError) {
        appendLearnEvent(
          contentPath,
          gardenId,
          "learn_planning_setup_rollback_failed",
          { jobId: job.id, error: errorMessage(rollbackError) },
        );
      }
    }
    lease.release();
    throw error;
  }

  try {
    updateLearnJob(job.id, {
      status: "planning",
      currentStep: "Extracting source visuals",
      progressPercent: 2,
      sourceSetHash: context.sourceSetHash,
    });
    // Stage 2 before planning: the planner assigns real extracted visuals.
    await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath,
      gardenId,
      context,
      deferEmptyVisualCheck: true,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });

    // Source Markdown can describe important figures from anywhere in the
    // retained PDF, including pages outside the small eager image cache. Scan
    // those mentioned pages now so extractedSourceArtifacts is complete before
    // the Learning Unit Contract is requested. A prose label alone is never
    // promoted; only the vision-registered result reaches the planner.
    const mentionedArtifactIds = structuredArtifactIdsMentionedBySources(context);
    if (mentionedArtifactIds.length > 0) {
      const discovery = await ensureReferencedSourceArtifactsExtracted({
        client,
        model,
        contentPath,
        gardenId,
        context,
        units: [],
        candidateArtifactIds: mentionedArtifactIds,
        checkpoint: () => throwIfLearnCancelled(job.id),
        onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
      });
      appendLearnEvent(contentPath, gardenId, "learn_source_markdown_artifacts_discovered", {
        jobId: job.id,
        candidateCount: mentionedArtifactIds.length,
        requestedIds: discovery.requestedIds,
        unresolvedIds: discovery.unresolvedIds,
        scanErrors: discovery.scanErrors,
      });
    }
    await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });

    const initialFormulaReview = await reviewAndBindSourceFormulas({
      client,
      model,
      contentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
      jobId: job.id,
      stage: "planning_initial",
      reviewSetHash: initialFormulaReview.reviewedFormulaSetHash,
      formulaCount: initialFormulaReview.formulaIds.length,
      replacementCount: initialFormulaReview.replacementFormulaIds.length,
      cacheHitCount: initialFormulaReview.cacheHitFormulaIds.length,
      modelCalls: initialFormulaReview.modelCalls,
    });

    const structuralSourceAnchors = structuralSourceTextAnchorCatalog(context);
    let canonicalSourceAnchorCatalog = [
      ...structuralSourceAnchorPromptCatalog(structuralSourceAnchors),
      ...context.sourceFigures.map((figure) => ({
        id: figure.figureId,
        sourceId: figure.sourceId,
        page: figure.page,
        title: figure.caption,
        kind: figure.kind,
      })),
    ];
    let promptSourceContext = promptSources(context);
    const hasSyllabus = Boolean(context.syllabus);
    const syllabusPayload = promptSyllabus(context);
    if (context.syllabus) {
      appendLearnEvent(contentPath, gardenId, "learn_syllabus_applied", {
        jobId: job.id,
        syllabusSourceId: context.syllabus.slug,
        syllabusTitle: context.syllabus.title,
      });
    }
    updateLearnJob(job.id, {
      status: "planning",
      currentStep: "Building source map",
      progressPercent: 5,
      sourceSetHash: context.sourceSetHash,
    });
    appendLearnEvent(contentPath, gardenId, "learn_planning_started", {
      jobId: job.id,
      sourceIds: context.sources.map((source) => source.slug),
    });

    // Planning sends the full context only in the user message; sourceContext
    // carries small routing metadata so council candidates/critics do not
    // duplicate the payload.
    const planningSourceMeta = {
      gardenId,
      sourceIds: context.sources.map((source) => source.slug),
      sourceSetHash: context.sourceSetHash,
      sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    };
    const planningWarnings: string[] = [];

    // Stage 1b: one model reads the syllabus, then a separate source-grounded
    // model authors every material-availability and unit-teachability verdict.
    // Code checks exact IDs/citations and completeness but makes no semantic
    // match or fallback decision.
    let syllabusCoverage: SyllabusCoverage | null = null;
    if (context.syllabus) {
      updateLearnJob(job.id, {
        currentStep: "Reading the syllabus",
        progressPercent: 4,
      });
      throwIfLearnCancelled(job.id);
      const syllabusCall = await callValidatedPlanningJson({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: SYLLABUS_READING_PROMPT,
        user: compactJson({ syllabus: syllabusPayload }),
        sourceContext: { ...planningSourceMeta, taskType: "syllabus_reading" },
        contentPath,
        jobId: job.id,
        stageLabel: "Syllabus reading",
        validate: modelAuthoredSyllabusPlanProblems,
      });
      const syllabusPlan = projectModelAuthoredSyllabusPlan(syllabusCall.parsed);
      const syllabusSourceIds = context.sources.map((source) => source.slug);
      updateLearnJob(job.id, {
        currentStep: "Checking syllabus coverage against selected sources",
        progressPercent: 4,
      });
      throwIfLearnCancelled(job.id);
      const coverageCall = await callValidatedPlanningJson({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: SYLLABUS_COVERAGE_PROMPT,
        user: compactJson({
          syllabusPlan,
          selectedSourceCatalog: promptSyllabusCoverageSourceCatalog(context, syllabusPlan),
        }),
        sourceContext: { ...planningSourceMeta, taskType: "syllabus_coverage" },
        contentPath,
        jobId: job.id,
        stageLabel: "Syllabus coverage review",
        validate: (value) =>
          syllabusCoverageDecisionProblems(value, syllabusPlan, syllabusSourceIds),
        preserveExactContent: true,
      });
      syllabusCoverage = projectModelAuthoredSyllabusCoverage(
        syllabusPlan,
        coverageCall.parsed,
        syllabusSourceIds,
      );

      // A complete all-false verdict makes the downstream Learning Unit
      // Contract impossible: the LUC author is forbidden to teach unteachable
      // syllabus units. Before asking for a map or contract, give an independent
      // model one bounded chance to select exact canonical page identities and
      // rereview the whole coverage decision from the complete selected pages.
      // Code never maps syllabus locators/topics/titles to source pages and it
      // never flips a semantic verdict.
      if (!syllabusCoverageHasTeachableUnits(syllabusCoverage)) {
        appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_started", {
          jobId: job.id,
          sourceSetHash: context.sourceSetHash,
          sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
          initialTeachableCount: 0,
          maximumSelectorCandidates: 1,
          maximumCoverageReviewCandidates: 1,
        });
        try {
          const recovery = await runSyllabusCoverageEvidenceRecovery({
            syllabusPlan,
            initialCoverageRaw: coverageCall.content,
            initialCoverageDecision: coverageCall.parsed,
            sources: context.sources.map((source) => ({
              sourceId: source.slug,
              relPath: source.relPath,
              body: source.body,
            })),
            anchors: structuralSourceAnchors,
            sourceSetHash: context.sourceSetHash,
            sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
            model,
            checkpoint: () => throwIfLearnCancelled(job.id),
            provider: async (request: SyllabusCoverageRecoveryProviderRequest) => {
              throwIfLearnCancelled(job.id);
              const result = await callPlanningJsonWithRetry({
                client,
                model,
                taskType: "source_map",
                gardenId,
                system: request.system,
                user: request.user,
                sourceContext: {
                  ...planningSourceMeta,
                  ...request.sourceContext,
                },
                contentPath,
                jobId: job.id,
                preserveExactContent: true,
              });
              throwIfLearnCancelled(job.id);
              return {
                rawResponse: result.content,
                councilRunId: result.councilRunId,
                model,
              };
            },
          });
          syllabusCoverage = recovery.coverage;
          const recoveryLiveContext = collectLearnSourceContext(
            contentPath,
            gardenId,
            context.selectedSourceIds,
            context.syllabus?.slug,
          );
          const recoveryDriftProblems = syllabusCoverageRecoveryReceiptProblems({
            receipt: recovery.receipt,
            sources: syllabusCoverageRecoverySources(recoveryLiveContext),
            anchors: structuralSourceTextAnchorCatalog(recoveryLiveContext),
            coverage: recovery.coverage,
            expectedSourceSetHash: recoveryLiveContext.sourceSetHash,
            expectedSourceArtifactInventoryHash:
              recoveryLiveContext.sourceArtifactInventoryHash,
          });
          if (recoveryLiveContext.sourceSetHash !== context.sourceSetHash ||
              recoveryLiveContext.sourceArtifactInventoryHash !==
                context.sourceArtifactInventoryHash ||
              recoveryDriftProblems.length > 0) {
            throw new LearnPipelineConflictError(
              `Selected source or syllabus evidence changed during bounded coverage recovery: ${recoveryDriftProblems.join("; ") || "live evidence hashes changed"}. No Source Map or Learning Unit Contract was requested.`,
            );
          }
          appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_reviewed", {
            jobId: job.id,
            outcome: recovery.receipt.outcome,
            receiptHash: recovery.receipt.integritySha256,
            selectedPages: recovery.receipt.selectedPages.map((page) => ({
              anchorId: page.anchorId,
              sourceId: page.sourceId,
              pageNumber: page.pageNumber,
              exactTextSha256: page.exactTextSha256,
            })),
            selectorCouncilRunId: recovery.receipt.selectorAttempts[0].councilRunId,
            coverageReviewCouncilRunId: recovery.receipt.coverageReviewAttempts[0].councilRunId,
            semanticCandidates: 2,
          });
          if (!recovery.recovered) {
            appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_terminal", {
              jobId: job.id,
              outcome: recovery.receipt.outcome,
              receiptHash: recovery.receipt.integritySha256,
              sourceMapRequested: false,
              learningUnitContractRequested: false,
            });
            throw new Error(
              "Independent exact-page syllabus coverage rereview still found zero teachable units. No Source Map or Learning Unit Contract was requested.",
            );
          }
        } catch (error) {
          appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_failed", {
            jobId: job.id,
            error: errorMessage(error),
            sourceMapRequested: false,
            learningUnitContractRequested: false,
          });
          throw error;
        }
      }

      if (syllabusCoverage) {
        const summary = summarizeSyllabusCoverage(syllabusCoverage);
        appendLearnEvent(contentPath, gardenId, "learn_syllabus_materials_resolved", {
          jobId: job.id,
          ...summary,
          missingCitations: syllabusCoverage.missingCitations,
          untaughtUnitTitles: syllabusCoverage.untaughtUnitTitles,
        });
        if (syllabusCoverage.missingCitations.length > 0) {
          planningWarnings.push(
            `The syllabus assigns ${syllabusCoverage.missingCitations.length} work(s) that are not in this garden: ${syllabusCoverage.missingCitations
              .slice(0, 8)
              .join("; ")}. Lessons will not be written from them — upload them to have them covered.`,
          );
        }
        for (const unitTitle of syllabusCoverage.untaughtUnitTitles.slice(0, 8)) {
          planningWarnings.push(
            `Syllabus item "${unitTitle}" could not be fully supported by the available source material and was left uncovered.`,
          );
        }
      }
    }
    const syllabusCoveragePayload = syllabusCoverage
      ? {
          courseTitle: syllabusCoverage.courseTitle,
          units: syllabusCoverage.units,
          missingCitations: syllabusCoverage.missingCitations,
          untaughtUnitTitles: syllabusCoverage.untaughtUnitTitles,
        }
      : undefined;

    throwIfLearnCancelled(job.id);
    const requestSourceMap = async () => {
      // Snapshot immediately before the model call. Rebuilding the prompt from
      // this exact ledger means a scan or cache mutation during a long model
      // call cannot be silently adopted as the call's baseline afterward.
      const artifactInventory = refreshSelectedSourceArtifactInventory(
        contentPath,
        gardenId,
        context,
      );
      canonicalSourceAnchorCatalog = [
        ...structuralSourceAnchorPromptCatalog(structuralSourceAnchors),
        ...context.sourceFigures.map((figure) => ({
          id: figure.figureId,
          sourceId: figure.sourceId,
          page: figure.page,
          title: figure.caption,
          kind: figure.kind,
        })),
      ];
      promptSourceContext = promptSources(context);
      planningSourceMeta.sourceSetHash = context.sourceSetHash;
      planningSourceMeta.sourceArtifactInventoryHash = context.sourceArtifactInventoryHash;
      const call = await callValidatedPlanningJson({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: withSyllabusRules(SOURCE_MAP_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus),
        user: compactJson({
          sourceOnly,
          syllabus: syllabusPayload,
          syllabusCoverage: syllabusCoveragePayload,
          sourceContext: promptSourceContext,
          canonicalSourceAnchors: canonicalSourceAnchorCatalog,
        }),
        sourceContext: { ...planningSourceMeta, taskType: "source_map" },
        contentPath,
        jobId: job.id,
        stageLabel: "Source Map",
        validate: (value) => sourceMapPlanProblems({
          value,
          sourceIds: context.sources.map((source) => source.slug),
          registeredArtifacts: context.sourceFigures,
          canonicalAnchors: canonicalSourceAnchorCatalog.map((anchor) => ({
            id: String(anchor.id),
            sourceId: String(anchor.sourceId),
          })),
        }),
      });
      return { call, artifactInventory };
    };
    let sourceMapRequest = await requestSourceMap();
    let sourceMapCall = sourceMapRequest.call;
    throwIfLearnCancelled(job.id);
    let sourceMap = sourceMapCall.parsed as Record<string, unknown>;
    let sourceMapArtifactInventory = sourceMapRequest.artifactInventory;
    let sourceMapReplanAttempted = false;

    // One complete re-authoring cycle is allowed when pages selected by the
    // Source Map reveal a different registered artifact inventory. The second
    // loop iteration checks even when the reauthored map selects no pages, so
    // concurrent ledger drift cannot be laundered into scope planning.
    for (;;) {
      persistSelectedStructuralSourceAnchors({
        clusterDir: clusterPath(contentPath, gardenId),
        sourceMap,
        selectedSourceIds: context.sources.map((source) => source.slug),
        catalog: structuralSourceAnchors,
      });
      const selectedSourcePageHints = selectedStructuralSourcePageHints({
        sourceMap,
        catalog: structuralSourceAnchors,
        selectedSources: context.sources,
      });
      if (selectedSourcePageHints.length > 0) {
        const selectedPageDiscovery = await ensureReferencedSourceArtifactsExtracted({
          client,
          model,
          contentPath,
          gardenId,
          context,
          units: [],
          explicitPageHints: selectedSourcePageHints,
          checkpoint: () => throwIfLearnCancelled(job.id),
          onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
        });
        appendLearnEvent(contentPath, gardenId, "learn_source_map_pages_scanned", {
          jobId: job.id,
          sourceMapAttempt: sourceMapReplanAttempted ? 2 : 1,
          selectedAnchorIds: selectedSourcePageHints.map((hint) => hint.anchorId),
          requestedPages: selectedPageDiscovery.requestedPages,
          discoveredArtifactIds: selectedPageDiscovery.discoveredIds,
          scanErrors: selectedPageDiscovery.scanErrors,
        });
        const postSelectionReview = await reviewAndBindSourceFormulas({
          client,
          model,
          contentPath,
          gardenId,
          context,
          checkpoint: () => throwIfLearnCancelled(job.id),
          onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
        });
        appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
          jobId: job.id,
          stage: sourceMapReplanAttempted
            ? "planning_source_map_pages_replan"
            : "planning_source_map_pages",
          reviewSetHash: postSelectionReview.reviewedFormulaSetHash,
          formulaCount: postSelectionReview.formulaIds.length,
          replacementCount: postSelectionReview.replacementFormulaIds.length,
          cacheHitCount: postSelectionReview.cacheHitFormulaIds.length,
          modelCalls: postSelectionReview.modelCalls,
        });
      }

      const postSelectedPageArtifactInventory = refreshSelectedSourceArtifactInventory(
        contentPath,
        gardenId,
        context,
      );
      const inventoryTransition = sourceMapArtifactInventoryTransition({
        before: sourceMapArtifactInventory,
        after: postSelectedPageArtifactInventory,
        replanAttempted: sourceMapReplanAttempted,
      });
      if (inventoryTransition === "stable") break;
      if (inventoryTransition === "fail") {
        throw new Error(
          "Selected source-artifact inventory changed again after the bounded Source Map replan. Start Learn planning again so no map can be confirmed against stale artifact evidence.",
        );
      }

      appendLearnEvent(contentPath, gardenId, "learn_source_artifact_inventory_changed", {
        jobId: job.id,
        stage: "planning_source_map_pages",
        beforeHash: sourceMapArtifactInventory.sourceArtifactInventoryHash,
        afterHash: postSelectedPageArtifactInventory.sourceArtifactInventoryHash,
        beforeArtifactCount: sourceMapArtifactInventory.artifacts.length,
        afterArtifactCount: postSelectedPageArtifactInventory.artifacts.length,
        action: "reauthor_source_map",
      });
      sourceMapReplanAttempted = true;
      sourceMapRequest = await requestSourceMap();
      sourceMapCall = sourceMapRequest.call;
      throwIfLearnCancelled(job.id);
      sourceMap = sourceMapCall.parsed as Record<string, unknown>;
      sourceMapArtifactInventory = sourceMapRequest.artifactInventory;
    }

    // The model request validates its own candidate, but run the same strict
    // registry check immediately before downstream scope reasoning as well.
    // This protects against a cache/scan race and proves the final Source Map
    // still partitions the exact current selected artifact inventory.
    const currentSourceMapArtifactProblems = sourceMapPlanProblems({
      value: sourceMap,
      sourceIds: context.sources.map((source) => source.slug),
      registeredArtifacts: context.sourceFigures,
      canonicalAnchors: canonicalSourceAnchorCatalog.map((anchor) => ({
        id: String(anchor.id),
        sourceId: String(anchor.sourceId),
      })),
    });
    if (currentSourceMapArtifactProblems.length > 0) {
      throw new Error(
        `The accepted Source Map is not valid against the current selected source-artifact inventory: ${currentSourceMapArtifactProblems.join("; ")}`,
      );
    }
    const sourceMapBoundArtifactInventoryHash =
      sourceMapArtifactInventory.sourceArtifactInventoryHash;
    appendLearnEvent(contentPath, gardenId, "learn_source_map_created", {
      jobId: job.id,
      councilRunId: sourceMapCall.councilRunId,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      currentStep: "Creating scope contract",
      progressPercent: 35,
    });

    throwIfLearnCancelled(job.id);
    const scopeCall = await callValidatedPlanningJson({
      client,
      model,
      taskType: "scope_contract",
      gardenId,
      system: withSyllabusRules(SCOPE_CONTRACT_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus),
      // The scope contract reasons over the source map (already a digest of the
      // full text), so it takes the compacted map + a body-free source context.
      // The syllabus stays in full: it is what defines the scope.
      user: compactJson({
        sourceOnly,
        syllabus: syllabusPayload,
        syllabusCoverage: syllabusCoveragePayload,
        sourceMap,
        sources: promptSourcesCompact(context),
      }),
      sourceContext: { ...planningSourceMeta, taskType: "scope_contract" },
      contentPath,
      jobId: job.id,
      stageLabel: "Scope Contract",
      validate: scopeContractProblems,
    });
    throwIfLearnCancelled(job.id);
    const scopeContract = scopeCall.parsed as Record<string, unknown>;
    appendLearnEvent(contentPath, gardenId, "learn_scope_contract_created", {
      jobId: job.id,
      councilRunId: scopeCall.councilRunId,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      currentStep: "Creating learning map",
      progressPercent: 65,
    });

    // The spine receives the complete validated Source Map and Scope Contract.
    // Only the duplicate raw-source context is body-free; semantic upstream
    // plans are never sliced into lossy `truncatedJson` strings.
    const spineSourceContext = promptSourcesCompact(context);
    const topicMapPlanningPacket = () => ({
      sourceOnly,
      syllabus: syllabusPayload,
      syllabusCoverage: syllabusCoveragePayload,
      sourceMap,
      scopeContract,
      sources: spineSourceContext,
      extractedSourceArtifacts: context.sourceFigures.map((figure) => ({
        id: figure.figureId,
        kind: figure.kind,
        sourceId: figure.sourceId,
        page: figure.page,
        caption: figure.caption,
        suggestedVisualUse: figure.suggestedVisualUse,
      })),
      responseShape: "LearningUnitContract JSON",
    });
    const topicMapUser = (repair?: LearningSpineFullRepairFeedback) =>
      compactJson({
        ...topicMapPlanningPacket(),
        ...(repair
          ? {
              repair: {
                ...repair,
                instruction:
                  "The strongest rejected candidate below failed these hard checks. Return a complete corrected replacement JSON object, not a patch or prose explanation. The bounded repairHistory records the exact hard-check history and whether each prior response became the next repair incumbent. Preserve valid source assignments and omission reasons, regenerate 15-25 precise learningUnits, partition every registered artifact exactly once between an owning unit and sourceArtifactOmissions, keep semanticConcepts separate from readable knowledgeClaims, and do not return sections first. If a semanticConcept slug appears in multiple units, every occurrence must use exactly the same preferredLabel and exactly the same aliases array in the same order; author that identity yourself because code will never choose or merge it.",
              },
            }
          : {}),
      });

    throwIfLearnCancelled(job.id);
    let topicMapCall = await callPlanningJsonWithRetry({
      client,
      model,
      taskType: "learning_spine",
      gardenId,
      system: withSyllabusRules(TOPIC_MAP_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus),
      user: topicMapUser(),
      sourceContext: { ...planningSourceMeta, taskType: "learning_spine" },
      contentPath,
      jobId: job.id,
      preserveExactContent: true,
    });
    throwIfLearnCancelled(job.id);
    let latestSourceArtifactProblems: string[] = [];
    const reconcilePlannedSourceArtifacts = async (
      candidateUnits: LearningUnitContract[],
      stage: "initial" | "repair",
    ): Promise<LearningUnitContract[]> => {
      let resolution: { requestedIds: string[]; unresolvedIds: string[] } = {
        requestedIds: [],
        unresolvedIds: [],
      };
      const reviewHashBeforeExtraction = context.sourceFormulaReviewSetHash;
      try {
        resolution = await ensureReferencedSourceArtifactsExtracted({
          client,
          model,
          contentPath,
          gardenId,
          context,
          units: candidateUnits,
          checkpoint: () => throwIfLearnCancelled(job.id),
          onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
        });
      } catch (error) {
        const warning = `Referenced source-page scan could not finish: ${errorMessage(error)}. Unverified artifact requirements remain invalid and must be repaired by the planning model.`;
        planningWarnings.push(warning);
        appendLearnEvent(contentPath, gardenId, "learn_referenced_source_scan_failed", {
          jobId: job.id,
          stage,
          reason: errorMessage(error),
        });
      }
      const reconciledFormulaReview = await reviewAndBindSourceFormulas({
        client,
        model,
        contentPath,
        gardenId,
        context,
        checkpoint: () => throwIfLearnCancelled(job.id),
        onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
      });
      planningSourceMeta.sourceSetHash = context.sourceSetHash;
      appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
        jobId: job.id,
        stage: `planning_contract_${stage}`,
        reviewSetHash: reconciledFormulaReview.reviewedFormulaSetHash,
        formulaCount: reconciledFormulaReview.formulaIds.length,
        replacementCount: reconciledFormulaReview.replacementFormulaIds.length,
        cacheHitCount: reconciledFormulaReview.cacheHitFormulaIds.length,
        modelCalls: reconciledFormulaReview.modelCalls,
      });
      if (
        context.sourceFormulaReviewSetHash !== reviewHashBeforeExtraction ||
        context.sourceArtifactInventoryHash !== sourceMapBoundArtifactInventoryHash
      ) {
        throw new Error(
          "Referenced-page extraction changed the reviewed source-formula or full source-artifact inventory after the Source Map and Scope Contract were authored. No map was committed; restart Learn planning so every semantic plan is authored from the complete reviewed ledger.",
        );
      }
      const reconciliation = reconcileLearningUnitSourceArtifacts(
        candidateUnits,
        [],
        registeredArtifactsFromFigures(context.sourceFigures),
      );
      if (reconciliation.removedArtifactIds.length > 0 || resolution.requestedIds.length > 0) {
        appendLearnEvent(contentPath, gardenId, "learn_source_artifacts_reconciled", {
          jobId: job.id,
          stage,
          requestedIds: resolution.requestedIds,
          unresolvedIds: resolution.unresolvedIds,
          removedArtifactIds: reconciliation.removedArtifactIds,
        });
      }
      latestSourceArtifactProblems = [
        ...(reconciliation.removedArtifactIds.length > 0
          ? [
            `model referenced unregistered structured source artifacts: ${reconciliation.removedArtifactIds.join(", ")}; return a complete replacement contract using only registered extractedSourceArtifacts`,
          ]
          : []),
      ];
      return candidateUnits;
    };

    let learningUnits = normalizeLearningUnits(topicMapCall.parsed, { modelAuthoredOnly: true });
    let sourceArtifactOmissions = projectModelAuthoredSourceArtifactOmissions(topicMapCall.parsed);
    learningUnits = await reconcilePlannedSourceArtifacts(learningUnits, "initial");
    let artifactCount = importantSourceArtifactCount(context);
    let contractProblems = [
      ...modelAuthoredLearningMapMetadataProblems(topicMapCall.parsed),
      ...modelAuthoredLearningUnitParseProblems(topicMapCall.parsed),
      ...modelAuthoredSourceArtifactOmissionParseProblems(topicMapCall.parsed),
      ...modelAuthoredUnitTitleProblems(learningUnits),
      ...prematureVisualPlanningProblems(learningUnits),
      ...sourceArtifactOwnershipProblems(learningUnits),
      ...sourceArtifactCoverageProblems(
        learningUnits,
        sourceArtifactOmissions,
        registeredArtifactsFromFigures(context.sourceFigures),
      ),
      ...latestSourceArtifactProblems,
      ...canonicalSourceAnchorProblems(clusterPath(contentPath, gardenId), learningUnits),
      ...syllabusUnitAssignmentProblems(learningUnits, syllabusCoverage ?? null),
      ...conceptRegistryAlignmentProblems({
        clusterDir: clusterPath(contentPath, gardenId),
        sourceSetHash: context.sourceSetHash,
        units: learningUnits,
      }),
      ...(
      learningUnits.length === 0
        ? ["planner returned no learningUnits"]
        : validateLearningUnitContracts(learningUnits, {
            artifactCount,
            requireModelAuthoredSemantics: true,
            requireModelAuthoredSections: true,
          })
      ),
      ...modelAuthoredLearningMapDepthProblems({
        candidate: topicMapCall.parsed,
        units: learningUnits,
        gardenId,
        sourceOnly,
        context,
      }),
    ];

    let fullRepairLineage = startLearningSpineFullRepairLineage({
      payload: {
        call: topicMapCall,
        units: learningUnits,
        sourceArtifactOmissions,
      },
      invalidResponse: topicMapCall.content,
      unitCount: learningUnits.length,
      validationProblems: contractProblems,
    });

    // Invalid pedagogy is repaired by the model that authored it. Keep the
    // strongest model-authored candidate across two bounded full-contract repairs;
    // code never invents a generic curriculum to make the gate go green.
    for (let repairAttempt = 1; repairAttempt <= 2 && contractProblems.length > 0; repairAttempt += 1) {
      const repairFeedback = learningSpineFullRepairFeedback(fullRepairLineage, repairAttempt);
      const retryCall = await callPlanningJsonWithRetry({
        client,
        model,
        taskType: "learning_spine",
        gardenId,
        system: withSyllabusRules(TOPIC_MAP_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus),
        user: topicMapUser(repairFeedback),
        sourceContext: {
          ...planningSourceMeta,
          taskType: "learning_spine_repair",
          repairAttempt,
          validationProblems: repairFeedback.validationProblems,
        },
        contentPath,
        jobId: job.id,
        preserveExactContent: true,
      });
      let retryUnits = normalizeLearningUnits(retryCall.parsed, { modelAuthoredOnly: true });
      const retrySourceArtifactOmissions = projectModelAuthoredSourceArtifactOmissions(retryCall.parsed);
      retryUnits = await reconcilePlannedSourceArtifacts(retryUnits, "repair");
      artifactCount = importantSourceArtifactCount(context);
      const retryProblems = [
        ...modelAuthoredLearningMapMetadataProblems(retryCall.parsed),
        ...modelAuthoredLearningUnitParseProblems(retryCall.parsed),
        ...modelAuthoredSourceArtifactOmissionParseProblems(retryCall.parsed),
        ...modelAuthoredUnitTitleProblems(retryUnits),
        ...prematureVisualPlanningProblems(retryUnits),
        ...sourceArtifactOwnershipProblems(retryUnits),
        ...sourceArtifactCoverageProblems(
          retryUnits,
          retrySourceArtifactOmissions,
          registeredArtifactsFromFigures(context.sourceFigures),
        ),
        ...latestSourceArtifactProblems,
        ...canonicalSourceAnchorProblems(clusterPath(contentPath, gardenId), retryUnits),
        ...syllabusUnitAssignmentProblems(retryUnits, syllabusCoverage ?? null),
        ...conceptRegistryAlignmentProblems({
          clusterDir: clusterPath(contentPath, gardenId),
          sourceSetHash: context.sourceSetHash,
          units: retryUnits,
        }),
        ...(
        retryUnits.length === 0
          ? ["planner returned no learningUnits"]
          : validateLearningUnitContracts(retryUnits, {
              artifactCount,
              requireModelAuthoredSemantics: true,
              requireModelAuthoredSections: true,
            })
        ),
        ...modelAuthoredLearningMapDepthProblems({
          candidate: retryCall.parsed,
          units: retryUnits,
          gardenId,
          sourceOnly,
          context,
        }),
      ];
      fullRepairLineage = recordLearningSpineFullRepairCandidate({
        lineage: fullRepairLineage,
        semanticAttempt: repairAttempt + 1,
        candidate: {
          payload: {
            call: retryCall,
            units: retryUnits,
            sourceArtifactOmissions: retrySourceArtifactOmissions,
          },
          invalidResponse: retryCall.content,
          unitCount: retryUnits.length,
          validationProblems: retryProblems,
        },
      });
      const lineageReview = fullRepairLineage.history.at(-1);
      appendLearnEvent(contentPath, gardenId, "learn_learning_spine_repair_reviewed", {
        jobId: job.id,
        repairAttempt,
        candidateUnitCount: retryUnits.length,
        promotedToIncumbent: lineageReview?.promotedToIncumbent ?? false,
        incumbentUnitCount: fullRepairLineage.incumbent.unitCount,
        problemsBefore: repairFeedback.validationProblems,
        problemsAfter: retryProblems,
      });
      topicMapCall = fullRepairLineage.incumbent.payload.call;
      learningUnits = fullRepairLineage.incumbent.payload.units;
      sourceArtifactOmissions = fullRepairLineage.incumbent.payload.sourceArtifactOmissions;
      contractProblems = fullRepairLineage.incumbent.validationProblems;
    }

    // A whole-spine rewrite can leave one local identity failure while
    // disturbing dozens of already valid units. After the original initial +
    // two full replacements are exhausted, let the model replace only the
    // complete unit records explicitly implicated by unit-index/id failures or
    // concept conflicts. Any global/unscoped problem fails closed. The merge is
    // structural only; the model authors every field and all semantic choices.
    let targetedRepairOutcome: { calls: number; status: string } | undefined;
    if (contractProblems.length > 0) {
      const incumbentCandidateBeforeTargetedRepair = planningRecord(topicMapCall.parsed);
      const targetedRepair = await runLearningSpineTargetedRepair({
        candidate: incumbentCandidateBeforeTargetedRepair,
        units: learningUnits,
        validationProblems: contractProblems,
        canonicalPlanningPacket: topicMapPlanningPacket(),
        canonicalEvidenceByUnit: canonicalLearningSpineEvidenceByUnit(
          clusterPath(contentPath, gardenId),
          learningUnits,
        ),
        maxAttempts: 2,
        provider: async (request) => {
          throwIfLearnCancelled(job.id);
          const result = await callPlanningJsonWithRetry({
            client,
            model,
            taskType: "learning_spine",
            gardenId,
            system: withSyllabusRules(request.system, SYLLABUS_PLANNING_RULES, hasSyllabus),
            user: request.user,
            sourceContext: {
              ...planningSourceMeta,
              taskType: "learning_spine_targeted_repair",
              repairAttempt: request.attempt,
              unitIds: request.unitIds,
            },
            contentPath,
            jobId: job.id,
          });
          // Null/malformed structured output is a semantic failure handled by
          // the bounded targeted loop. Provider/transport exceptions propagate
          // from callPlanningJsonWithRetry and consume no semantic attempt.
          return result.parsed;
        },
        validateCandidate: (candidate) => {
          const candidateUnits = normalizeLearningUnits(candidate, { modelAuthoredOnly: true });
          const candidateOmissions = projectModelAuthoredSourceArtifactOmissions(candidate);
          const unregisteredArtifacts = reconcileLearningUnitSourceArtifacts(
            candidateUnits,
            [],
            registeredArtifactsFromFigures(context.sourceFigures),
          ).removedArtifactIds;
          const candidateArtifactProblems = unregisteredArtifacts.length > 0
            ? [
                `model referenced unregistered structured source artifacts: ${unregisteredArtifacts.join(", ")}; return complete replacement units using only registered extractedSourceArtifacts`,
              ]
            : [];
          const problems = [
            ...modelAuthoredLearningMapMetadataProblems(candidate),
            ...modelAuthoredLearningUnitParseProblems(candidate),
            ...modelAuthoredSourceArtifactOmissionParseProblems(candidate),
            ...modelAuthoredUnitTitleProblems(candidateUnits),
            ...prematureVisualPlanningProblems(candidateUnits),
            ...sourceArtifactOwnershipProblems(candidateUnits),
            ...sourceArtifactCoverageProblems(
              candidateUnits,
              candidateOmissions,
              registeredArtifactsFromFigures(context.sourceFigures),
            ),
            ...candidateArtifactProblems,
            ...canonicalSourceAnchorProblems(clusterPath(contentPath, gardenId), candidateUnits),
            ...syllabusUnitAssignmentProblems(candidateUnits, syllabusCoverage ?? null),
            ...conceptRegistryAlignmentProblems({
              clusterDir: clusterPath(contentPath, gardenId),
              sourceSetHash: context.sourceSetHash,
              units: candidateUnits,
            }),
            ...(candidateUnits.length === 0
              ? ["planner returned no learningUnits"]
              : validateLearningUnitContracts(candidateUnits, {
                  artifactCount,
                  requireModelAuthoredSemantics: true,
                  requireModelAuthoredSections: true,
                })),
            ...modelAuthoredLearningMapDepthProblems({
              candidate,
              units: candidateUnits,
              gardenId,
              sourceOnly,
              context,
            }),
          ];
          return { units: candidateUnits, problems };
        },
      });
      for (const review of targetedRepair.reviews) {
        appendLearnEvent(contentPath, gardenId, "learn_learning_spine_targeted_repair_reviewed", {
          jobId: job.id,
          repairExecutorMode: "model",
          repairAttempt: review.attempt,
          unitIds: review.unitIds,
          responseProblems: review.responseProblems,
          problemsAfter: review.mergedProblems,
          accepted: review.accepted,
          introducedUnscopedProblems: review.introducedUnscopedProblems,
        });
      }
      appendLearnEvent(contentPath, gardenId, "learn_learning_spine_targeted_repair_completed", {
        jobId: job.id,
        repairExecutorMode: "model",
        status: targetedRepair.status,
        modelCalls: targetedRepair.calls,
        problemsBefore: contractProblems,
        problemsAfter: targetedRepair.problems,
        unscopedProblems: targetedRepair.unscopedProblems,
      });
      targetedRepairOutcome = {
        calls: targetedRepair.calls,
        status: targetedRepair.status,
      };
      if (targetedRepair.candidate !== incumbentCandidateBeforeTargetedRepair) {
        topicMapCall = {
          ...topicMapCall,
          parsed: targetedRepair.candidate,
          content: compactJson(targetedRepair.candidate),
        };
        learningUnits = targetedRepair.units;
        sourceArtifactOmissions = projectModelAuthoredSourceArtifactOmissions(targetedRepair.candidate);
      }
      contractProblems = targetedRepair.problems;
    }

    if (contractProblems.length > 0) {
      const attemptDescription = describeLearningSpineRepairAttempts({
        fullContractAttempts: 3,
        targetedCalls: targetedRepairOutcome?.calls ?? 0,
        targetedStatus: targetedRepairOutcome?.status ?? "not_run",
      });
      throw new Error(
        `The AI-authored Learning Unit Contract remained invalid ${attemptDescription}: ${contractProblems.join("; ")}. No fallback curriculum was written.`,
      );
    }

    throwIfLearnCancelled(job.id);
    const visualNecessityReview = await planAndReviewVisualNecessity({
      client,
      model,
      gardenId,
      contentPath,
      jobId: job.id,
      learningUnits,
    });
    // The visual reviewer intentionally converts model failures into an
    // unresolved decision. A user abort can surface through that same catch, so
    // re-check the durable job state before any map/artifact commit.
    throwIfLearnCancelled(job.id);
    learningUnits = visualNecessityReview.learningUnits;
    const planRecord = planningRecord(topicMapCall.parsed);
    const finalOwnershipProblems = sourceArtifactOwnershipProblems(learningUnits);
    if (finalOwnershipProblems.length > 0) {
      throw new Error(`Model-authored source artifact ownership remained invalid: ${finalOwnershipProblems.join("; ")}`);
    }
    const finalSourceArtifactCoverageProblems = sourceArtifactCoverageProblems(
      learningUnits,
      sourceArtifactOmissions,
      registeredArtifactsFromFigures(context.sourceFigures),
    );
    if (finalSourceArtifactCoverageProblems.length > 0) {
      throw new Error(
        `Model-authored source artifact coverage remained invalid: ${finalSourceArtifactCoverageProblems.join("; ")}`,
      );
    }
    let sourceArtifactAssignments = projectModelAuthoredSourceArtifactAssignments(learningUnits);
    let learningMap = learningMapFromPlanningCandidate({
      candidate: topicMapCall.parsed,
      units: learningUnits,
      gardenId,
      sourceOnly,
      createdAt: nowIso(),
      warnings: Array.from(
        new Set([
          ...(Array.isArray(planRecord.warnings) ? planRecord.warnings.filter((item): item is string => typeof item === "string") : []),
          ...planningWarnings,
        ]),
      ),
    });
    const depthProblems = validateLearningMapDepth(learningMap, context);
    if (depthProblems.length > 0) {
      throw new Error(
        `Learning spine depth invariant failed after bounded model repair: ${depthProblems.join("; ")}`,
      );
    }
    const coveragePlan = sourceCoveragePlan(
      context,
      learningMap,
      learningUnits,
      sourceArtifactAssignments,
      sourceArtifactOmissions,
      buildCanonicalSourceAnchors(clusterPath(contentPath, gardenId), { allowInferredFormulaText: false }),
      syllabusCoverage,
    );
    const commitContext = collectLearnSourceContext(
      contentPath,
      gardenId,
      context.selectedSourceIds,
      context.syllabus?.slug,
    );
    if (
      commitContext.sourceSetHash !== context.sourceSetHash ||
      commitContext.sourceArtifactInventoryHash !== context.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected sources or their registered artifact inventory changed during planning. Run Learn again to review a map grounded in the current files.",
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context: commitContext,
      coveragePlan,
      syllabusCoverage,
      stage: "Planning commit",
    });
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease before committing artifacts.",
      );
    }
    const storedMap = db.transaction(() => {
      const stored = insertLearnMap({
        gardenId,
        jobId: job.id,
        sourceMap,
        scopeContract,
        learningMap,
        coveragePlan,
        sourceSetHash: context.sourceSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
        sourceIds: context.selectedSourceIds,
        syllabusSourceId: context.syllabus?.slug,
        syllabusCoverage,
      });
      // A failed semantic artifact commit rolls this database insert back, so
      // a failed Learn job cannot leave behind a confirmable orphan map.
      const contractWrite = writeLearningUnitContractArtifacts({
        clusterDir: clusterPath(contentPath, gardenId),
        units: learningUnits,
        assignments: sourceArtifactAssignments,
        omissions: sourceArtifactOmissions,
        registeredArtifacts: registeredArtifactsFromFigures(context.sourceFigures),
        sourceSetHash: context.sourceSetHash,
        sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
        syllabusCoverageEvidenceRecovery: syllabusCoverage?.evidenceRecovery,
        visualNecessityReview,
      });
      learningUnits = contractWrite.units;
      sourceArtifactAssignments = contractWrite.assignments;
      sourceArtifactOmissions = contractWrite.omissions;
      learningMap = learningMapWithConfirmedUnitContracts(learningMap, learningUnits);
      const repairedCoveragePlan = sourceCoveragePlan(
        context,
        learningMap,
        learningUnits,
        sourceArtifactAssignments,
        sourceArtifactOmissions,
        buildCanonicalSourceAnchors(clusterPath(contentPath, gardenId), { allowInferredFormulaText: false }),
        syllabusCoverage,
      );
      const mapContractUpdate = db.prepare(
        `UPDATE learn_maps
         SET learning_map_json = ?, proposed_order_json = ?, coverage_plan_json = ?
         WHERE id = ? AND source_artifact_inventory_hash = ?`,
      ).run(
        jsonString(learningMap),
        jsonString(learningMap.sections),
        jsonString(repairedCoveragePlan),
        stored.id,
        context.sourceArtifactInventoryHash,
      );
      if (mapContractUpdate.changes !== 1) {
        throw new LearnPipelineConflictError(
          "The proposed Learning Map artifact-inventory binding changed before its contract could commit.",
        );
      }
      return {
        ...stored,
        learningMap,
        proposedOrder: learningMap.sections,
        coveragePlan: repairedCoveragePlan,
      };
    })();
    const visualizationPlanningStartedAt = Date.now();
    const canonicalVisualEvidence = canonicalVisualizationEvidenceByUnit(
      clusterPath(contentPath, gardenId),
      learningUnits,
    );
    const visualizationPlanning = await buildVisualizationPlanWithContractRepair({
      gardenId,
      learningMap,
      learningUnits,
      visualBudget: visualNecessityReview.budget,
      canonicalEvidenceByUnit: canonicalVisualEvidence,
      necessityReviewCalls: visualNecessityReview.reviewCalls,
      rejectedNecessityReviews: visualNecessityReview.rejectedReviews,
      visualDecisionOverrides: visualNecessityReview.overrides,
      repairProvider: (packet) => requestVisualizationContractRepair({
        client,
        model,
        gardenId,
        packet,
      }),
      maxRepairAttempts: 2,
      checkCancelled: () => throwIfLearnCancelled(job.id),
      onEvent: (type, data) => appendLearnEvent(contentPath, gardenId, type, {
        jobId: job.id,
        learningMapId: storedMap.id,
        ...data,
      }),
    });
    const planningExecutabilityContext = {
      phase: "planning" as const,
      jobId: job.id,
      model,
      learningMapId: storedMap.id,
    };
    const executabilityReview = await reviewVisualizationPlanExecutability({
      gardenId,
      learningMap,
      learningUnits: visualizationPlanning.learningUnits,
      initialPlan: visualizationPlanning.plan,
      canonicalEvidenceByUnit: canonicalVisualEvidence,
      auditContext: planningExecutabilityContext,
      maximumRepeatedInteractionSignature: LEARN_VISUAL_MAX_REPEATED_INTERACTION_SIGNATURE,
      provider: (request) => requestVisualizationContractExecutabilityReview({
        client,
        model,
        gardenId,
        request,
      }),
      checkCancelled: () => throwIfLearnCancelled(job.id),
      onEvent: (type, data) => appendLearnEvent(contentPath, gardenId, type, {
        jobId: job.id,
        learningMapId: storedMap.id,
        ...data,
      }),
    });
    learningUnits = executabilityReview.learningUnits;
    let visualizationPlan = executabilityReview.plan;
    learningUnits = applyVisualizationRoutesToLearningUnits(learningUnits, visualizationPlan);
    visualizationPlan = buildFinalVisualizationPlanFromRoutedContracts({
      gardenId,
      learningMap,
      finalRoutedLearningUnits: learningUnits,
      reviewedPlan: visualizationPlan,
      canonicalEvidenceByUnit: canonicalVisualEvidence,
    });
    // Construct and validate the complete audit envelope before any of the
    // reviewed contracts or plan are persisted. A malformed review/audit can
    // therefore never leave a partially published contract set behind.
    const planningExecutabilityLedger = buildVisualContractExecutabilityLedger({
      gardenId,
      context: planningExecutabilityContext,
      review: executabilityReview,
      finalRoutedLearningUnits: learningUnits,
      finalVisualizationPlan: visualizationPlan,
      structuralContractRepair: {
        source: visualizationPlanning.repairSource,
        ...visualizationPlanning.repairAudit,
      },
    });
    persistRoutedVisualPlans(clusterPath(contentPath, gardenId), learningUnits);
    learningMap = learningMapWithConfirmedUnitContracts(learningMap, learningUnits);
    const routedCoveragePlan = sourceCoveragePlan(
      context,
      learningMap,
      learningUnits,
      sourceArtifactAssignments,
      sourceArtifactOmissions,
      buildCanonicalSourceAnchors(clusterPath(contentPath, gardenId), { allowInferredFormulaText: false }),
      syllabusCoverage,
    );
    const routedMapUpdate = db.prepare(
      `UPDATE learn_maps
       SET learning_map_json = ?, proposed_order_json = ?, coverage_plan_json = ?
       WHERE id = ? AND source_artifact_inventory_hash = ?`,
    ).run(
      jsonString(learningMap),
      jsonString(learningMap.sections),
      jsonString(routedCoveragePlan),
      storedMap.id,
      context.sourceArtifactInventoryHash,
    );
    if (routedMapUpdate.changes !== 1) {
      throw new LearnPipelineConflictError(
        "The proposed Learning Map artifact-inventory binding changed during visual planning.",
      );
    }
    Object.assign(storedMap, {
      learningMap,
      proposedOrder: learningMap.sections,
      coveragePlan: routedCoveragePlan,
    });
    saveVisualizationPlan(clusterPath(contentPath, gardenId), visualizationPlan);
    saveVisualContractExecutabilityLedger({
      gardenDir: clusterPath(contentPath, gardenId),
      ledger: planningExecutabilityLedger,
    });
    appendLearnEvent(contentPath, gardenId, "visual_contract_executability_ledger_persisted", {
      jobId: job.id,
      learningMapId: storedMap.id,
      path: VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH,
      modelCalls: executabilityReview.calls,
      replacedUnitIds: executabilityReview.replacedUnitIds,
    });
    appendLearnEvent(contentPath, gardenId, "visual_opportunity_analysis_completed", {
      jobId: job.id,
      learningMapId: storedMap.id,
      opportunitiesDetected: visualizationPlan.opportunities.length,
      durationMs: Date.now() - visualizationPlanningStartedAt,
    });
    for (const opportunity of visualizationPlan.opportunities) {
      appendLearnEvent(contentPath, gardenId, "visual_opportunity_detected", {
        jobId: job.id,
        learningMapId: storedMap.id,
        visualizationId: opportunity.id,
        learningUnitId: opportunity.learningUnitId,
        priority: opportunity.priority,
        interactionGoal: opportunity.interactionGoal,
        sourceAnchors: opportunity.sourceAnchorIds,
      });
    }
    for (const decision of visualizationPlan.decisions) {
      appendLearnEvent(contentPath, gardenId, "visual_route_selected", {
        jobId: job.id,
        learningMapId: storedMap.id,
        visualizationId: decision.opportunityId,
        route: decision.route,
        selectedRenderer: decision.selectedRenderer,
        compatibilityScore: decision.compatibilityScore,
        reason: decision.reason,
        duplicateOf: decision.duplicateOf,
      });
    }
    const finalPlanningContext = collectLearnSourceContext(
      contentPath,
      gardenId,
      context.selectedSourceIds,
      context.syllabus?.slug,
    );
    if (
      finalPlanningContext.sourceSetHash !== storedMap.sourceSetHash ||
      finalPlanningContext.sourceArtifactInventoryHash !==
        storedMap.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected sources or their artifact inventory changed before the Learning Map became confirmable. No stale map was retained; run Learn planning again.",
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context: finalPlanningContext,
      coveragePlan: storedMap.coveragePlan,
      syllabusCoverage: storedMap.syllabusCoverage,
      stage: "Final planning",
    });
    appendLearnEvent(contentPath, gardenId, "learn_learning_unit_contract_created", {
      jobId: job.id,
      councilRunId: topicMapCall.councilRunId,
      learningMapId: storedMap.id,
      unitCount: learningUnits.length,
      assignmentCount: sourceArtifactAssignments.length,
    });
    appendLearnEvent(contentPath, gardenId, "learn_learning_map_created", {
      jobId: job.id,
      councilRunId: topicMapCall.councilRunId,
      learningMapId: storedMap.id,
      sourceIds: context.sources.map((source) => source.slug),
    });
    appendLearnEvent(
      contentPath,
      gardenId,
      retainLeaseOnSuccess
        ? "learn_automatic_generation_handoff_ready"
        : "learn_awaiting_confirmation",
      {
      jobId: job.id,
      learningMapId: storedMap.id,
      },
    );
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease before awaiting confirmation.",
      );
    }
    const nextJob = updateLearnJobExpectStatus(job.id, {
      status: retainLeaseOnSuccess ? "building_navigation" : "awaiting_confirmation",
      currentStep: retainLeaseOnSuccess
        ? "Planning complete; continuing to lesson generation"
        : "Awaiting section order confirmation",
      progressPercent: retainLeaseOnSuccess ? 55 : 100,
      proposedLearningMapId: storedMap.id,
      sourceSetHash: context.sourceSetHash,
    });
    leaseTransferred = retainLeaseOnSuccess;
    return {
      job: nextJob,
      learningMap: storedMap,
      retainedLease: retainLeaseOnSuccess ? lease : undefined,
    };
  } catch (error) {
    if (
      lease.lost ||
      leaseLostLearnJobs.has(job.id) ||
      !lease.heartbeat()
    ) {
      // A fenced recovery/takeover now owns cleanup. The stale worker must not
      // touch either the repository or SQLite after losing that authority.
      throw error;
    }
    if (isLearnCancellation(job.id, error)) {
      // The Stop button already flipped the job to cancelled; remove anything
      // planning managed to write before the cancellation checkpoint fired.
      try {
        const cleanup = await cleanupLearnArtifactsAfterCancel({
          gardenId,
          contentPath,
          jobId: job.id,
          lease,
        });
        updateLearnJob(job.id, {
          status: "cancelled",
          currentStep: "Cancelled; latest Learn changes rolled back",
        });
        discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
        appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
          jobId: job.id,
          removedPathCount: cleanup.removedPaths.length,
          restoredPathCount: cleanup.restoredPaths.length,
          deletedMaps: cleanup.deletedMaps,
          deletedVersions: cleanup.deletedVersions,
        });
      } catch {
        // Cleanup is best-effort during unwind; the cancel endpoint reports its
        // own cleanup errors when the user presses Stop.
      }
      throw new LearnCancelledError();
    }
    const message = errorMessage(error, "Learn planning failed");
    const failedJob = getLatestLearnJob(gardenId);
    const lastInternalStep = failedJob?.id === job.id ? failedJob.currentStep.trim() : "";
    let planningRolledBack = false;
    try {
      const rollback = await rollbackLearnRun({
        gardenId,
        contentPath,
        jobId: job.id,
        lease,
      });
      planningRolledBack = true;
      const publicationToken = queueLearnPublicationRetry(
        gardenId,
        "failed Learn planning rollback",
        new Error("Publication pending"),
      );
      appendLearnEvent(contentPath, gardenId, "learn_planning_rolled_back", {
        jobId: job.id,
        removedPathCount: rollback.removedPaths.length,
        restoredPathCount: rollback.restoredPaths.length,
        deletedMaps: rollback.deletedMaps,
        deletedVersions: rollback.deletedVersions,
      });
      void publishQuartzAfterMutation(
        `failed Learn planning rollback in ${gardenId}`,
        { requireSuccess: true },
      )
        .then(() => clearLearnPublicationRetry(gardenId, publicationToken))
        .catch((publicationError) => {
          queueLearnPublicationRetry(
            gardenId,
            "failed Learn planning rollback",
            publicationError,
          );
        });
    } catch (rollbackError) {
      if (lease.lost || !lease.heartbeat()) {
        throw rollbackError;
      }
      appendLearnEvent(contentPath, gardenId, "learn_planning_rollback_failed", {
        jobId: job.id,
        error: errorMessage(rollbackError, "Planning rollback failed"),
      });
    }
    appendLearnEvent(contentPath, gardenId, "learn_failed", {
      jobId: job.id,
      error: message,
    });
    updateLearnJob(job.id, {
      status: "failed",
      currentStep: lastInternalStep
        ? `Planning failed; last internal step: ${lastInternalStep}`
        : "Planning failed",
      error: message,
    });
    if (planningRolledBack) {
      discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
    }
    throw error;
  } finally {
    disposeModelTracking();
    if (!leaseTransferred) lease.release();
  }
}

export function confirmLearningMap({
  gardenId,
  learningMapId,
  contentPath,
  gardenLease,
}: {
  gardenId: string;
  learningMapId?: string;
  contentPath: string;
  /** Internal automatic handoff; external confirmation acquires its own lease. */
  gardenLease?: GardenLearnLease;
}): StoredLearningMap {
  ensureLearnTables();
  assertNoPendingLearnClear(gardenId);
  const gardenDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(gardenDir, { recursive: true });
  let lease = gardenLease;
  let ownsLease = false;
  if (lease) {
    if (lease.lost || !lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn lost its retained garden lease before map confirmation.",
      );
    }
  } else {
    const confirmationId = makeId("learn_confirm");
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: gardenId,
      jobId: confirmationId,
      buildId: `confirm:${confirmationId}`,
    });
    if (!leaseResult.acquired) {
      throw new LearnPipelineConflictError(
        `Another Learn operation (${leaseResult.conflict.jobId}) is changing this garden; confirmation was not applied.`,
      );
    }
    lease = leaseResult.lease;
    ownsLease = true;
  }
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn lost its garden lease before map confirmation.",
      );
    }
    const confirmTransaction = db.transaction(() => {
      const map = learningMapId
        ? getLearnMapById(learningMapId, gardenId)
        : getLatestProposedLearnMap(gardenId);
      if (learningMapId && !map) {
        throw new LearnPipelineConflictError(
          "The requested Learning Map does not belong to this garden or no longer exists.",
        );
      }
      if (!map) throw new Error("No proposed learning map found");
      assertNoUnresolvedLearnJob(gardenId, map.jobId);
      if (!isContractBackedLearningMap(map)) {
        throw new Error(
          "This learning map was created before Learning Unit Contracts existed. Run Learn again to draft a new source-grounded map.",
        );
      }
      const alreadyConfirmed = map.status === "confirmed";
      if (!alreadyConfirmed && map.status !== "proposed") {
        throw new LearnPipelineConflictError(
          `Learning Map ${map.id} is ${map.status} and cannot be confirmed.`,
        );
      }
      const confirmationContext = collectLearnSourceContext(
        contentPath,
        gardenId,
        map.sourceIds.length > 0 ? map.sourceIds : undefined,
        map.syllabusSourceId,
      );
      if (
        confirmationContext.sourceSetHash !== map.sourceSetHash ||
        confirmationContext.sourceArtifactInventoryHash !==
          map.sourceArtifactInventoryHash
      ) {
        throw new LearnPipelineConflictError(
          "The selected sources or their artifact inventory changed after this Learning Map was authored. Run Learn planning again before confirmation.",
        );
      }
      assertSyllabusCoverageRecoveryBinding({
        context: confirmationContext,
        coveragePlan: map.coveragePlan,
        syllabusCoverage: map.syllabusCoverage,
        stage: "Map confirmation",
      });
      if (alreadyConfirmed) return { map, jobId: map.jobId, changed: false };
      const planningJob = getLearnJobById(map.jobId);
      if (
        !planningJob ||
        planningJob.gardenId !== gardenId ||
        (planningJob.status !== "awaiting_confirmation" &&
          planningJob.status !== "building_navigation")
      ) {
        throw new LearnPipelineConflictError(
          "The proposed Learning Map is no longer the active planning result.",
        );
      }
      const confirmedAt = nowIso();
      const mapUpdate = db.prepare(
        `UPDATE learn_maps
         SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND garden_id = ? AND status = 'proposed'
           AND source_set_hash = ? AND source_artifact_inventory_hash = ?`,
      ).run(
        confirmedAt,
        map.id,
        gardenId,
        map.sourceSetHash,
        map.sourceArtifactInventoryHash,
      );
      if (mapUpdate.changes !== 1) {
        throw new LearnPipelineConflictError(
          "The Learning Map changed before confirmation could commit.",
        );
      }
      const updatedJob = updateLearnJob(planningJob.id, {
        confirmedLearningMapId: map.id,
        currentStep: "Learning map confirmed",
      });
      if (
        updatedJob.status === "cancelled" ||
        updatedJob.status === "failed" ||
        updatedJob.status === "complete"
      ) {
        throw new LearnPipelineConflictError(
          `The planning job became ${updatedJob.status} before confirmation committed.`,
        );
      }
      return {
        map: getLearnMapById(map.id, gardenId)!,
        jobId: planningJob.id,
        changed: true,
      };
    });
    const confirmed = confirmTransaction.immediate();
    if (confirmed.changed) {
      appendLearnEvent(contentPath, gardenId, "learn_learning_map_confirmed", {
        jobId: confirmed.jobId,
        learningMapId: confirmed.map.id,
      });
    }
    return confirmed.map;
  } finally {
    if (ownsLease) lease.release();
  }
}

function renderObjectMarkdown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return `\`\`\`json\n${JSON.stringify(value ?? {}, null, 2)}\n\`\`\``;
}

// Learner-visible planning pages: the learning/ index, Topic Overview, and
// Learning Map. Everything else (Source Map, Scope Contract, Source Coverage)
// is internal. No planning page carries public tags — tags are reserved for
// learner lessons.
const VISIBLE_PLANNING_TYPES = new Set([
  "learning-index",
  "topic-overview",
  "learning-map",
]);

function learningPageFrontmatter(
  title: string,
  type: string,
  gardenId: string,
  learningVersionId: string,
  sourceSetHash: string,
): string {
  const visibleVersionId = publicLearningVersionId(learningVersionId);
  return yamlFrontmatter({
    title,
    date: nowIso(),
    knowledge_type: type,
    breadboardType: type.replace(/-/g, "_"),
    gardenId,
    internal: VISIBLE_PLANNING_TYPES.has(type) ? undefined : "true",
    generatedBy: "learn_button",
    generated_by: "learn_button",
    learningVersion: visibleVersionId,
    learningVersionId: visibleVersionId,
    sourceSetHash,
  });
}

// All learner-facing lesson sections live under this folder so the garden root
// only ever shows learning/, assets/, and the garden _index.
const LEARNING_ROOT = "learning";

/** Section folder for a lesson section, nested under learning/. */
function learningSectionFolder(sectionNumber: number, title: string): string {
  return `${LEARNING_ROOT}/${textbookSectionFolder(sectionNumber, title)}`;
}

/**
 * Collapse layout whitespace for exact source-expression verification. No
 * LaTeX command, symbol, variable, or notation is rewritten or inferred.
 */
function normalizedFormulaForFrontmatter(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

function formulaGroundingEntries(
  contracts: readonly NonNullable<LearningSubsectionPlan["sourceFormulaContracts"]>[number][],
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>,
): FormulaGroundingEntry[] {
  return contracts.map((contract) => {
    const anchor = canonicalSourceAnchors[contract.id];
    const exactText = anchor?.kind === "formula" ? anchor.exactText?.trim() : "";
    if (!exactText) {
      throw new Error(
        `Formula projection failed: model-authored formula ${contract.id} has no verbatim canonical equation transcription.`,
      );
    }
    return {
      kind: "source_definition",
      text: exactText,
      normalizedText: normalizedFormulaForFrontmatter(exactText),
      groundingStatus: "source-anchored",
      sourceAnchor: contract.id,
      sourceAnchorTitle: anchor?.caption ?? anchor?.title ?? contract.id,
      matchReason: "exact model-authored sourceFormula contract projection",
      confidence: 1,
      justification: `The model-authored Learning Unit Contract assigns canonical source formula ${contract.id} to this page.`,
    };
  });
}

function assessModelAuthoredLessonQuality(
  body: string,
  options: {
    assignedVisualUrls: string[];
    unavailableCitations?: { detect: (prose: string) => string[] };
    subsection: LearningSubsectionPlan;
    canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>;
  },
): ReturnType<typeof assessLessonQuality> {
  const base = assessLessonQuality(body, {
    assignedVisualUrls: options.assignedVisualUrls,
    unavailableCitations: options.unavailableCitations,
  });
  const pageFormulas = new Set(
    extractVerbatimDisplayMath(body)
      .map((expression) => normalizedFormulaForFrontmatter(expression.formula))
      .filter(Boolean),
  );
  const formulaProblems: QualityProblem[] = (options.subsection.sourceFormulaContracts ?? [])
    .filter((formula) => {
      const anchor = options.canonicalSourceAnchors[formula.id];
      const exactText = anchor?.kind === "formula" ? anchor.exactText?.trim() : "";
      return !exactText || !pageFormulas.has(normalizedFormulaForFrontmatter(exactText));
    })
    .map((formula) => ({
      code: "missing-source-formula",
      message: `required source formula ${formula.id} is not reproduced verbatim as a displayed equation in the lesson`,
      hard: true,
      evidence: [
        options.canonicalSourceAnchors[formula.id]?.exactText ?? "canonical equation transcription unavailable",
        formula.teachingGoal,
        ...(formula.termsToDefine ?? []),
      ].filter(Boolean),
    }));
  const problems = [...base.problems, ...formulaProblems];
  return {
    ok: problems.length === 0,
    hardFail: problems.some((problem) => problem.hard),
    problems,
  };
}

function sourceFormulaFiguresForSubsection(
  context: LearnSourceContext,
  subsection: LearningSubsectionPlan,
): SourceFigure[] {
  // A page may only claim source-formula anchors selected for its own stable
  // learning unit. Supplying every extracted equation here allowed a helper
  // expression (for example spike count inside an energy derivation) to be
  // grounded to another unit's formula and then rejected by the pre-write
  // family guard. Pages without a formula contract get no source-formula
  // candidates; their math remains honestly conceptual unless reconciled later.
  const selectedIds = new Set((subsection.sourceFormulaContracts ?? []).map((formula) => formula.id));
  return sourceFormulaFigures(context).filter((formula) => selectedIds.has(formula.figureId));
}

function renderLearningMapMarkdown(map: ProposedLearningMap): string {
  const lines: string[] = [
    "# Learning Map",
    "",
    map.summary,
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = section.title;
    lines.push(`## ${sectionNumber}. ${sectionTitle}`, "", section.purpose, "");
    section.subsections.forEach((subsection, subsectionIndex) => {
      const subsectionTitle = subsection.title;
      const relPath = `${learningSectionFolder(sectionNumber, sectionTitle)}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsectionTitle,
      )}`;
      lines.push(`- ${sectionNumber}.${subsectionIndex + 1} ${wikilinkForRelPath(relPath, subsectionTitle)}`);
    });
    lines.push("");
  });
  if (map.warnings.length > 0) {
    lines.push("## Scope Notes", "", ...map.warnings.map((warning) => `- ${warning}`), "");
  }
  return `${lines.join("\n")}\n`;
}

function renderLearningIndexMarkdown(map: ProposedLearningMap): string {
  const lines = [
    `# ${map.title}`,
    "",
    map.summary,
    "",
    "## Sections",
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = section.title;
    const folder = learningSectionFolder(sectionNumber, sectionTitle);
    lines.push(`- ${wikilinkForRelPath(`${folder}/_index.md`, `${sectionNumber}. ${sectionTitle}`)}`);
    section.subsections.forEach((subsection, subsectionIndex) => {
      const relPath = `${folder}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsection.title,
      )}`;
      lines.push(
        `  - ${wikilinkForRelPath(relPath, `${sectionNumber}.${subsectionIndex + 1} ${subsection.title}`)}`,
      );
    });
  });
  return `${lines.join("\n")}\n`;
}

function validateTopicOverview(
  markdown: string,
  map: ProposedLearningMap,
): { markdown: string; problems: string[] } {
  const problems: string[] = [];
  const generalQuality = assessLessonQuality(markdown, { minWords: 250 });
  for (const problem of generalQuality.problems) {
    if (problem.code === "no-qa" || problem.code === "no-example") continue;
    problems.push(formatQualityProblemForRepair(problem));
  }
  if (/```breadboard-visual/i.test(markdown) || containsRawVisualPlaceholder(markdown)) {
    problems.push("overview contains an interactive-visual block or placeholder");
  }
  for (const section of map.sections) {
    if (!markdown.toLocaleLowerCase().includes(section.title.toLocaleLowerCase())) {
      problems.push(`overview reading order omits section "${section.title}"`);
    }
  }
  const canonicalized = canonicalizeLearnerWikilinks(markdown, map);
  if (canonicalized.unresolved.length > 0) {
    problems.push(`overview contains unresolved wikilinks: ${canonicalized.unresolved.join(", ")}`);
  }
  return { markdown: canonicalized.markdown, problems: [...new Set(problems)] };
}

function sourceMapMarkdown(sourceMap: unknown, context: LearnSourceContext): string {
  return [
    "# Source Map",
    "",
    "## Relevant Sources Found",
    "",
    ...context.sources.map((source) => `- ${wikilinkForRelPath(source.relPath, source.title)} - ${source.sourceType || "source"}, ${source.wordCount ?? 0} words`),
    "",
    "## Source Figures, Graphs, Tables, And Formula Displays",
    "",
    ...(context.sourceFigures.length > 0
      ? context.sourceFigures.map(
          (figure) =>
            `- ${figure.figureId}: ${figure.caption ?? figure.kind} (${figure.kind})${figure.page ? `, page ${figure.page}` : ""}`,
        )
      : ["- No source figures were detected from markdown snapshots."]),
    "",
    "## Council Source Map",
    "",
    renderObjectMarkdown(sourceMap),
    "",
  ].join("\n");
}

function scopeContractMarkdown(scopeContract: unknown): string {
  return ["# Scope Contract", "", renderObjectMarkdown(scopeContract), ""].join("\n");
}

function sourceFormulaFigures(context: LearnSourceContext): SourceFigure[] {
  return context.sourceFigures.filter(
    (figure) => figure.kind === "formula" || /\.E\d+$/i.test(figure.figureId),
  );
}

function sourceCoverageMarkdown({
  context,
  generatedPages,
  unusedFigureReasons,
  sourceArtifactAssignments = [],
}: {
  context: LearnSourceContext;
  generatedPages: GeneratedPageRecord[];
  unusedFigureReasons: Map<string, string>;
  sourceArtifactAssignments?: SourceArtifactAssignment[];
}): string {
  const pageByUnit = new Map(
    generatedPages
      .filter((page) => page.learningUnitId)
      .map((page) => [page.learningUnitId as string, page]),
  );
  const assignedIds = new Set(sourceArtifactAssignments.map((assignment) => assignment.sourceArtifactId));
  const usedFigures = new Set(generatedPages.flatMap((page) => page.sourceFigureIds));
  const usedFormulas = new Set(generatedPages.flatMap((page) => page.sourceFormulaIds));
  const usedTables = new Set(generatedPages.flatMap((page) => page.sourceTableIds));
  const allFulfilledIds = new Set([...usedFigures, ...usedFormulas, ...usedTables]);
  const formulaFigures = sourceFormulaFigures(context);
  const assignmentByArtifact = new Map<string, SourceArtifactAssignment[]>();
  for (const assignment of sourceArtifactAssignments) {
    const list = assignmentByArtifact.get(assignment.sourceArtifactId) ?? [];
    list.push(assignment);
    assignmentByArtifact.set(assignment.sourceArtifactId, list);
  }
  const statusForAssignment = (assignment: SourceArtifactAssignment): string => {
    const page = pageByUnit.get(assignment.assignedLearningUnitId);
    if (!page) return "missing: assigned unit has no generated page";
    if (allFulfilledIds.has(assignment.sourceArtifactId)) return "fulfilled";
    return "missing: assigned artifact not present in final page metadata";
  };
  const sourceArtifactKind = (id: string): "formula" | "table" | "figure" => {
    if (/\.E\d+$/i.test(id)) return "formula";
    if (/\.T\d+$/i.test(id)) return "table";
    return "figure";
  };
  const coverageModes = new Map<string, string[]>([
    ["Embedded Source Crops", []],
    ["Explained as Text Formulas", []],
    ["Explained in Prose", []],
    ["Used as Interactive Grounding", []],
    ["Referenced Again in Synthesis", []],
    ["Crop Omitted With Text Fallback", []],
    ["Intentionally Omitted", []],
    ["Missing or Misplaced", []],
  ]);
  const addMode = (mode: string, line: string) => {
    coverageModes.get(mode)?.push(line);
  };
  const authoredOmissionReason = (artifactId: string): string => {
    const reason = unusedFigureReasons.get(artifactId)?.trim();
    if (!reason) {
      throw new Error(
        `Source coverage cannot project ${artifactId}: its model-authored omission reason is missing.`,
      );
    }
    return reason;
  };
  for (const assignment of sourceArtifactAssignments) {
    const page = pageByUnit.get(assignment.assignedLearningUnitId);
    const target = page ? wikilinkForRelPath(page.relPath, page.title) : `unit ${assignment.assignedLearningUnitId}`;
    const kind = sourceArtifactKind(assignment.sourceArtifactId);
    const line = `- ${assignment.sourceArtifactId}: ${target}; placement=${assignment.placement}; ${assignment.requiredInterpretation || assignment.reason}`;
    if (!page || !allFulfilledIds.has(assignment.sourceArtifactId)) {
      addMode("Missing or Misplaced", line);
    } else if (kind === "formula") {
      addMode("Explained as Text Formulas", line);
      addMode("Crop Omitted With Text Fallback", line);
    } else if (usedFigures.has(assignment.sourceArtifactId) || usedTables.has(assignment.sourceArtifactId)) {
      addMode("Embedded Source Crops", line);
    } else {
      addMode("Explained in Prose", line);
    }
  }
  for (const page of generatedPages) {
    if (page.visualIds.length === 0) continue;
    const anchors = [...page.sourceFigureIds, ...page.sourceFormulaIds, ...page.sourceTableIds];
    for (const id of anchors) {
      addMode("Used as Interactive Grounding", `- ${id}: ${wikilinkForRelPath(page.relPath, page.title)}; interactive visualIds=${page.visualIds.join(", ")}`);
    }
  }
  for (const page of generatedPages.filter((page) => /synthesis/i.test(page.title))) {
    const anchors = [...page.sourceFigureIds, ...page.sourceFormulaIds, ...page.sourceTableIds];
    for (const id of anchors) {
      addMode("Referenced Again in Synthesis", `- ${id}: ${wikilinkForRelPath(page.relPath, page.title)}`);
    }
  }
  for (const figure of context.sourceFigures.filter((figure) => !allFulfilledIds.has(figure.figureId) && !assignedIds.has(figure.figureId))) {
    addMode("Intentionally Omitted", `- ${figure.figureId}: ${authoredOmissionReason(figure.figureId)}`);
  }
  const lines = [
    "# Source Coverage",
    "",
    "Coverage is derived from the Learning Unit Contract artifact assignments and final page fulfillment only. It does not use title or keyword heuristics.",
    "",
    "## Sources Used",
    "",
    ...context.sources.map((source) => `- ${source.title} (${source.slug})`),
    "",
    "## Generated Pages By Source Anchor",
    "",
  ];
  for (const page of generatedPages) {
    lines.push(`- ${wikilinkForRelPath(page.relPath, page.title)}: ${page.sourceAnchors.join("; ") || "general source context"}`);
  }
  lines.push("", "## Contract Artifact Fulfillment", "");
  if (sourceArtifactAssignments.length > 0) {
    for (const assignment of sourceArtifactAssignments) {
      const page = pageByUnit.get(assignment.assignedLearningUnitId);
      lines.push(
        `- ${assignment.sourceArtifactId}: assigned to ${assignment.assignedLearningUnitId}${page ? ` (${wikilinkForRelPath(page.relPath, page.title)})` : ""}; ${statusForAssignment(assignment)}; placement=${assignment.placement}; ${assignment.requiredInterpretation || assignment.reason}`,
      );
    }
  } else {
    lines.push("- No source artifacts were assigned by the Learning Unit Contract.");
  }
  for (const [mode, entries] of coverageModes) {
    lines.push("", `## ${mode}`, "");
    lines.push(...(entries.length > 0 ? [...new Set(entries)] : ["- None."]));
  }
  if (formulaFigures.length > 0) {
    lines.push("", "## Formula Anchor Assignments", "");
    for (const formula of formulaFigures) {
      const assignments = assignmentByArtifact.get(formula.figureId) ?? [];
      if (assignments.length === 0) {
        lines.push(`- ${formula.figureId}: omitted; ${authoredOmissionReason(formula.figureId)}`);
        continue;
      }
      for (const assignment of assignments) {
        const page = pageByUnit.get(assignment.assignedLearningUnitId);
        lines.push(
          `- ${formula.figureId}: assigned to ${assignment.assignedLearningUnitId}${page ? ` (${wikilinkForRelPath(page.relPath, page.title)})` : ""}; ${statusForAssignment(assignment)}`,
        );
      }
    }
  }
  lines.push("", "## Figures Not Used", "");
  lines.push(
    ...(context.sourceFigures.filter((figure) => !allFulfilledIds.has(figure.figureId)).length > 0
      ? context.sourceFigures
          .filter((figure) => !allFulfilledIds.has(figure.figureId))
          .map(
            (figure) =>
              `- ${figure.figureId}: ${
                assignedIds.has(figure.figureId)
                  ? "assigned by the Learning Unit Contract but not fulfilled in final page metadata"
                  : authoredOmissionReason(figure.figureId)
              }`,
          )
      : ["- None."]),
  );
  lines.push("", "## Notes", "");
  lines.push("- Formula, example, and question coverage is tracked through source anchors on the generated learning pages.");
  return `${lines.join("\n")}\n`;
}

function clusterPath(contentPath: string, gardenId: string): string {
  return path.join(contentPath, gardenId);
}

export function getLearnValidationReport({
  gardenId,
  contentPath,
  maxChars = 30_000,
}: {
  gardenId: string;
  contentPath: string;
  maxChars?: number;
}): LearnValidationReport | null {
  const reportRelPath = ".breadboard/validation-report.md";
  const reportPath = path.join(clusterPath(contentPath, gardenId), reportRelPath);
  let markdown: string;
  try {
    markdown = fs.readFileSync(reportPath, "utf-8");
  } catch {
    return null;
  }
  const generatedAt = markdown.match(/^Generated:\s*(.+)$/m)?.[1]?.trim();
  const acceptedRaw = markdown.match(/^Accepted:\s*(yes|no)$/m)?.[1]?.trim().toLowerCase();
  const truncated = markdown.length > maxChars;
  return {
    relativePath: reportRelPath,
    url: `/api/gardens/${encodeURIComponent(gardenId)}/learn/validation-report`,
    markdown: truncated ? `${markdown.slice(0, maxChars).replace(/\s+$/, "")}\n\n[report truncated in dialog]` : markdown,
    truncated,
    ...(acceptedRaw ? { accepted: acceptedRaw === "yes" } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  };
}

function getLearnScopedRepairSummary(gardenId: string, contentPath: string): LearnScopedRepairSummary | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(clusterPath(contentPath, gardenId), ".breadboard", "scoped-repair.json"), "utf8")) as Record<string, unknown>;
    const scope = raw.scope && typeof raw.scope === "object" ? raw.scope as Record<string, unknown> : {};
    const policy = raw.policy && typeof raw.policy === "object" ? raw.policy as Record<string, unknown> : {};
    const ids = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    return {
      repairId: String(raw.repairId ?? scope.repairId ?? ""),
      issueCount: ids(scope.issueIds).length,
      unitIds: ids(scope.unitIds), pageIds: ids(scope.pageIds), sectionIds: ids(scope.sectionIds), visualIds: ids(scope.visualIds),
      allowedFiles: ids(policy.allowedFiles), changedFiles: ids(raw.filesActuallyChanged),
      modelCalls: Number(raw.modelCalls ?? 0), blockersBefore: ids(raw.blockersBefore).length, blockersAfter: ids(raw.blockersAfter).length,
      unaffectedPageHashesVerified: raw.unaffectedPageHashesVerified === true,
      accepted: raw.accepted === true, publishReady: raw.publishReady === true,
      reason: String(raw.reason ?? ""),
    };
  } catch {
    return null;
  }
}

function assertInsideCluster(clusterDir: string, filePath: string): void {
  const resolvedCluster = path.resolve(clusterDir);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile !== resolvedCluster && !resolvedFile.startsWith(`${resolvedCluster}${path.sep}`)) {
    throw new Error("Refusing to write outside the garden directory");
  }
}

function backupExistingMarkdown({
  clusterDir,
  filePath,
  textbookVersionId,
}: {
  clusterDir: string;
  filePath: string;
  textbookVersionId: string;
}): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  assertInsideCluster(clusterDir, filePath);
  const relPath = path.relative(clusterDir, filePath);
  const backupPath = path.join(clusterDir, ".breadboard", "backups", textbookVersionId, relPath);
  assertInsideCluster(clusterDir, backupPath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
  return path.relative(clusterDir, backupPath).replace(/\\/g, "/");
}

function writeMarkdownWithBackup({
  clusterDir,
  relPath,
  content,
  textbookVersionId,
}: {
  clusterDir: string;
  relPath: string;
  content: string;
  textbookVersionId: string;
}): { filePath: string; backedUpTo?: string } {
  const filePath = path.join(clusterDir, ...relPath.split("/"));
  assertInsideCluster(clusterDir, filePath);
  const backedUpTo = backupExistingMarkdown({ clusterDir, filePath, textbookVersionId });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalizeQuartzMarkdown(content), "utf-8");
  return { filePath, backedUpTo };
}

interface LearnCleanupResult {
  removedPaths: string[];
  restoredPaths: string[];
  prunedVisualIds: string[];
  deletedMaps: number;
  deletedVersions: number;
}

interface LearnRunSnapshotManifest {
  schemaVersion: 1;
  gardenId: string;
  jobId: string;
  createdAt: string;
  inheritedFromJobId?: string;
  capturedPaths?: string[];
  backupEntries?: string[];
  learnMaps?: LearnMapRow[];
  learnVersions?: LearnVersionRow[];
}

const LEARN_RUN_SNAPSHOT_ROOT = ".breadboard/learn-run-snapshots";
const LEARN_RUN_ROLLBACK_PATHS = [
  LEARNING_ROOT,
  "Learning",
  "assets/source-visuals",
  ".breadboard/Internal",
  ".breadboard/debug/failed-pages",
  ".breadboard/debug/failed-repairs",
  ".breadboard/planning",
  ".breadboard/source-snapshots",
  ".breadboard/visuals",
  ".breadboard/learning-unit-contract.json",
  ".breadboard/concept-registry.json",
  ".breadboard/claims.json",
  ".breadboard/claims-history.json",
  ".breadboard/concept-registry-history.json",
  ".breadboard/semantic-migration.json",
  ".breadboard/source-visuals.json",
  ".breadboard/source-visual-source-index.json",
  ".breadboard/source-formula-reviews",
  ".breadboard/source-formula-review-set.json",
  ".breadboard/visual-index.json",
  ".breadboard/visual-contract-executability-reviews.json",
  ".breadboard/visual-decision-records.json",
  ".breadboard/visual-necessity-decisions.json",
  ".breadboard/visual-necessity-decisions.md",
  ".breadboard/visualization-plan.json",
  ".breadboard/visualization-coverage.json",
  ".breadboard/visualization-report.md",
  ".breadboard/source-anchors.json",
  ".breadboard/repair-log.json",
  ".breadboard/repair-report.md",
  ".breadboard/validation-report.md",
  ".breadboard/weak-anchor-self-healing.json",
  ".breadboard/weak-anchor-self-healing.md",
  ".breadboard/source-anchor-evidence.json",
  ".breadboard/source-anchor-evidence.md",
  ".breadboard/source-anchor-migration.json",
  ".breadboard/source-anchor-migration.md",
  ".breadboard/anchor-replacement-plan.json",
  ".breadboard/anchor-replacement-plan.md",
  ".breadboard/critic-issues.json",
  ".breadboard/critic-loop.json",
  ".breadboard/critic-report.md",
  ".breadboard/anchor-critic-decisions.json",
] as const;

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function clusterRelativePath(clusterDir: string, relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const result = path.join(clusterDir, ...normalized.split("/"));
  assertInsideCluster(clusterDir, result);
  return result;
}

function learnRunSnapshotDir(clusterDir: string, jobId: string): string {
  return clusterRelativePath(clusterDir, `${LEARN_RUN_SNAPSHOT_ROOT}/${jobId}`);
}

function readLearnRunSnapshot(clusterDir: string, jobId: string): LearnRunSnapshotManifest | null {
  const manifestPath = path.join(learnRunSnapshotDir(clusterDir, jobId), "manifest.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as LearnRunSnapshotManifest;
    return parsed.schemaVersion === 1 && parsed.jobId === jobId ? parsed : null;
  } catch {
    return null;
  }
}

function resolveLearnRunSnapshot(
  clusterDir: string,
  jobId: string,
): { jobId: string; manifest: LearnRunSnapshotManifest } | null {
  const visited = new Set<string>();
  let currentJobId = jobId;
  while (!visited.has(currentJobId)) {
    visited.add(currentJobId);
    const manifest = readLearnRunSnapshot(clusterDir, currentJobId);
    if (!manifest) return null;
    if (!manifest.inheritedFromJobId) return { jobId: currentJobId, manifest };
    currentJobId = manifest.inheritedFromJobId;
  }
  return null;
}

function copySnapshotPath(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function createLearnRunSnapshot({
  gardenId,
  contentPath,
  jobId,
  inheritFromJobId,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
  inheritFromJobId?: string;
}): void {
  ensureLearnTables();
  const clusterDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(clusterDir, { recursive: true });
  const snapshotDir = learnRunSnapshotDir(clusterDir, jobId);
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.mkdirSync(snapshotDir, { recursive: true });

  const inherited = inheritFromJobId
    ? resolveLearnRunSnapshot(clusterDir, inheritFromJobId)
    : null;
  if (inherited) {
    const manifest: LearnRunSnapshotManifest = {
      schemaVersion: 1,
      gardenId,
      jobId,
      createdAt: nowIso(),
      inheritedFromJobId: inherited.jobId,
    };
    fs.writeFileSync(
      path.join(snapshotDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
    return;
  }

  // Only Learn-owned projections are rollback material. Capturing arbitrary
  // Markdown here used to let Stop overwrite source/user notes edited after a
  // plan began.
  const snapshotCandidates = [...LEARN_RUN_ROLLBACK_PATHS];
  const capturedPaths = Array.from(new Set(snapshotCandidates)).filter((relPath) => {
    const source = clusterRelativePath(clusterDir, relPath);
    if (!fs.existsSync(source)) return false;
    copySnapshotPath(source, path.join(snapshotDir, "files", ...relPath.split("/")));
    return true;
  });
  const backupsRoot = clusterRelativePath(clusterDir, ".breadboard/backups");
  const backupEntries = fs.existsSync(backupsRoot)
    ? fs.readdirSync(backupsRoot).sort()
    : [];
  const manifest: LearnRunSnapshotManifest = {
    schemaVersion: 1,
    gardenId,
    jobId,
    createdAt: nowIso(),
    capturedPaths,
    backupEntries,
    learnMaps: db
      .prepare("SELECT * FROM learn_maps WHERE garden_id = ? ORDER BY created_at ASC")
      .all(gardenId) as LearnMapRow[],
    learnVersions: db
      .prepare("SELECT * FROM learn_versions WHERE garden_id = ? ORDER BY created_at ASC")
      .all(gardenId) as LearnVersionRow[],
  };
  fs.writeFileSync(
    path.join(snapshotDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

function removeClusterPath(clusterDir: string, relPath: string, removedPaths: string[]): void {
  const target = clusterRelativePath(clusterDir, relPath);
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  removedPaths.push(normalizeRelPath(relPath));
}

function restoreLearnDatabaseSnapshot(
  gardenId: string,
  manifest: LearnRunSnapshotManifest,
): { deletedMaps: number; deletedVersions: number } {
  const baselineMaps = manifest.learnMaps ?? [];
  const baselineVersions = manifest.learnVersions ?? [];
  const baselineMapIds = new Set(baselineMaps.map((row) => row.id));
  const baselineVersionIds = new Set(baselineVersions.map((row) => row.id));
  const currentMaps = db
    .prepare("SELECT id FROM learn_maps WHERE garden_id = ?")
    .all(gardenId) as Array<{ id: string }>;
  const currentVersions = db
    .prepare("SELECT id FROM learn_versions WHERE garden_id = ?")
    .all(gardenId) as Array<{ id: string }>;

  db.transaction(() => {
    db.prepare("DELETE FROM learn_versions WHERE garden_id = ?").run(gardenId);
    db.prepare("DELETE FROM learn_maps WHERE garden_id = ?").run(gardenId);
    // The document selection and syllabus are restored explicitly: without them
    // a rolled-back map would silently fall back to "every document, no
    // syllabus" and quietly widen the next run's scope.
    const insertMap = db.prepare(
      `INSERT INTO learn_maps (
        id, garden_id, job_id, status, source_map_json, scope_contract_json,
        learning_map_json, proposed_order_json, visual_opportunities_json,
        coverage_plan_json, source_set_hash, source_artifact_inventory_hash,
        source_ids_json, syllabus_source_id, syllabus_coverage_json, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of baselineMaps) {
      insertMap.run(
        row.id,
        row.garden_id,
        row.job_id,
        row.status,
        row.source_map_json,
        row.scope_contract_json,
        row.learning_map_json,
        row.proposed_order_json,
        row.visual_opportunities_json,
        row.coverage_plan_json,
        row.source_set_hash,
        row.source_artifact_inventory_hash ?? "",
        // Snapshots taken before these columns existed have no value to restore.
        row.source_ids_json ?? "[]",
        row.syllabus_source_id ?? null,
        row.syllabus_coverage_json ?? null,
        row.created_at,
        row.confirmed_at,
      );
    }
    const insertVersion = db.prepare(
      `INSERT INTO learn_versions (
        id, garden_id, job_id, learning_map_id, source_set_hash,
        source_artifact_inventory_hash, page_count, backup_dir, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of baselineVersions) {
      insertVersion.run(
        row.id,
        row.garden_id,
        row.job_id,
        row.learning_map_id,
        row.source_set_hash,
        row.source_artifact_inventory_hash ?? "",
        row.page_count,
        row.backup_dir,
        row.created_at,
      );
    }
  })();

  return {
    deletedMaps: currentMaps.filter((row) => !baselineMapIds.has(row.id)).length,
    deletedVersions: currentVersions.filter((row) => !baselineVersionIds.has(row.id)).length,
  };
}

function discardLearnRunSnapshot({
  gardenId,
  contentPath,
  jobId,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
}): void {
  const clusterDir = clusterPath(contentPath, gardenId);
  const resolved = resolveLearnRunSnapshot(clusterDir, jobId);
  fs.rmSync(learnRunSnapshotDir(clusterDir, jobId), {
    recursive: true,
    force: true,
  });
  if (resolved && resolved.jobId !== jobId) {
    fs.rmSync(learnRunSnapshotDir(clusterDir, resolved.jobId), {
      recursive: true,
      force: true,
    });
  }
}

async function rollbackLearnRun({
  gardenId,
  contentPath,
  jobId,
  lease,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
  lease: GardenLearnLease;
}): Promise<LearnCleanupResult> {
  ensureLearnTables();
  if (lease.lost || !lease.heartbeat()) {
    throw new LearnPipelineConflictError(
      "Learn rollback lost its fenced garden lease before staging.",
    );
  }
  const clusterDir = clusterPath(contentPath, gardenId);
  const resolved = resolveLearnRunSnapshot(clusterDir, jobId);
  if (!resolved || resolved.manifest.gardenId !== gardenId) {
    return {
      removedPaths: [],
      restoredPaths: [],
      prunedVisualIds: [],
      deletedMaps: 0,
      deletedVersions: 0,
    };
  }

  const durableFingerprintBefore = fingerprintDurableGardenState(clusterDir);
  const fileFingerprintsBefore = fingerprintGardenFiles(clusterDir);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-learn-rollback-"),
  );
  const stagingGardenDir = path.join(temporaryRoot, gardenId);
  let previousGardenDir: string | undefined;
  try {
    fs.cpSync(clusterDir, stagingGardenDir, { recursive: true, force: true });
    if (
      fingerprintDurableGardenState(stagingGardenDir) !==
      durableFingerprintBefore
    ) {
      throw new LearnPipelineConflictError(
        "The garden changed while Learn prepared its rollback candidate.",
      );
    }

    const removedPaths: string[] = [];
    const restoredPaths: string[] = [];
    for (const relPath of LEARN_RUN_ROLLBACK_PATHS) {
      removeClusterPath(stagingGardenDir, relPath, removedPaths);
    }
    const snapshotDir = learnRunSnapshotDir(clusterDir, resolved.jobId);
    for (const relPath of resolved.manifest.capturedPaths ?? []) {
      const source = path.join(snapshotDir, "files", ...relPath.split("/"));
      if (!fs.existsSync(source)) continue;
      copySnapshotPath(source, clusterRelativePath(stagingGardenDir, relPath));
      restoredPaths.push(relPath);
    }

    const baselineBackupEntries = new Set(resolved.manifest.backupEntries ?? []);
    const backupsRoot = clusterRelativePath(stagingGardenDir, ".breadboard/backups");
    if (fs.existsSync(backupsRoot)) {
      for (const entry of fs.readdirSync(backupsRoot)) {
        if (!baselineBackupEntries.has(entry)) {
          removeClusterPath(
            stagingGardenDir,
            `.breadboard/backups/${entry}`,
            removedPaths,
          );
        }
      }
    }

    const allowedMutationRoots = [
      ...LEARN_RUN_ROLLBACK_PATHS,
      ".breadboard/backups",
      ".breadboard/events.jsonl",
    ];
    const candidateViolations = gardenClearBoundaryViolations({
      before: fileFingerprintsBefore,
      candidateGardenDir: stagingGardenDir,
      allowedMutationRoots,
    });
    if (candidateViolations.length > 0) {
      throw new Error(
        `Learn rollback candidate changed protected content: ${candidateViolations
          .slice(0, 6)
          .join("; ")}`,
      );
    }

    const promotion = await promoteStagingGarden({
      stagingGardenDir,
      destinationGardenDir: clusterDir,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: `rollback:${jobId}`,
      verifyCurrentDestination: (destinationDir) =>
        lease.heartbeat() &&
        fingerprintDurableGardenState(destinationDir) === durableFingerprintBefore,
      prepareIncomingForCommit: (incomingDir, destinationDir) => {
        mergeLearnEventLedgers(destinationDir, incomingDir);
        return true;
      },
      verifyManifest: (candidateDir) =>
        gardenClearBoundaryViolations({
          before: fileFingerprintsBefore,
          candidateGardenDir: candidateDir,
          allowedMutationRoots,
        }).length === 0,
    });
    previousGardenDir = promotion.previousPreservedAt;
    if (!promotion.promoted) {
      if (previousGardenDir) {
        await restorePreviousPromotedGarden(
          clusterDir,
          previousGardenDir,
          () => lease.heartbeat(),
        );
        previousGardenDir = undefined;
      }
      throw new LearnPipelineConflictError(
        `Learn rollback was not published: ${promotion.reason}`,
      );
    }
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn rollback lost its fenced garden lease before restoring SQLite.",
      );
    }

    let database: ReturnType<typeof restoreLearnDatabaseSnapshot>;
    try {
      database = restoreLearnDatabaseSnapshot(gardenId, resolved.manifest);
    } catch (databaseError) {
      if (!previousGardenDir) throw databaseError;
      try {
        await restorePreviousPromotedGarden(
          clusterDir,
          previousGardenDir,
          () => lease.heartbeat(),
        );
        previousGardenDir = undefined;
      } catch (restoreError) {
        throw new Error(
          `Learn rollback database restore failed (${errorMessage(databaseError)}), and the pre-rollback garden could not be restored (${errorMessage(restoreError)}).`,
          { cause: databaseError },
        );
      }
      throw databaseError;
    }

    if (previousGardenDir) {
      try {
        fs.rmSync(previousGardenDir, { recursive: true, force: true });
        previousGardenDir = undefined;
      } catch (cleanupError) {
        console.warn(
          `[learn] Pre-rollback garden remains at ${previousGardenDir}:`,
          cleanupError,
        );
      }
    }
    return {
      removedPaths: Array.from(new Set(removedPaths)),
      restoredPaths: Array.from(new Set(restoredPaths)),
      prunedVisualIds: [],
      ...database,
    };
  } finally {
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch {
      // The rollback candidate is outside the repository and can be reclaimed
      // later if desktop sync or antivirus briefly retains a handle.
    }
  }
}

function clearSourceMapForRegeneration({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): LearnCleanupResult {
  const clusterDir = clusterPath(contentPath, gardenId);
  const removedPaths: string[] = [];
  removeClusterPath(clusterDir, ".breadboard/planning", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/learning-unit-contract.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-contract-executability-reviews.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-decision-records.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-necessity-decisions.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-necessity-decisions.md", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visualization-plan.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visualization-coverage.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visualization-report.md", removedPaths);
  const deletedVersions = db.prepare("DELETE FROM learn_versions WHERE garden_id = ?").run(gardenId).changes;
  const deletedMaps = db.prepare("DELETE FROM learn_maps WHERE garden_id = ?").run(gardenId).changes;
  return {
    removedPaths,
    restoredPaths: [],
    prunedVisualIds: [],
    deletedMaps,
    deletedVersions,
  };
}

async function cleanupLearnArtifactsAfterCancel({
  gardenId,
  contentPath,
  jobId,
  lease,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
  lease: GardenLearnLease;
}): Promise<LearnCleanupResult> {
  const result = await rollbackLearnRun({ gardenId, contentPath, jobId, lease });
  // The rollback above is the cancellation commit point. Rebuilding Quartz can
  // take minutes and must not keep the Cancel request (or its UI) stuck after
  // the database and garden have already returned to the prior valid state.
  const publicationToken = queueLearnPublicationRetry(
    gardenId,
    "Learn cancellation cleanup",
    new Error("Publication pending"),
  );
  void publishQuartzAfterMutation(`learn cancellation cleanup in ${gardenId}`, {
    requireSuccess: true,
  })
    .then(() => clearLearnPublicationRetry(gardenId, publicationToken))
    .catch((error) => {
      console.error("[learn] Background cancellation publication failed:", error);
      queueLearnPublicationRetry(gardenId, "Learn cancellation cleanup", error);
    });
  return result;
}

function isVisualSourceArtifactId(id: string): boolean {
  return /\.P\d+\.(?:F|G|T)\d+$/i.test(id);
}

function assignedVisualArtifactIdsForUnit(
  assignments: SourceArtifactAssignment[],
  unitId: string | undefined,
): string[] {
  if (!unitId) return [];
  return assignments
    .filter((assignment) => assignment.assignedLearningUnitId === unitId && isVisualSourceArtifactId(assignment.sourceArtifactId))
    .map((assignment) => assignment.sourceArtifactId);
}

/**
 * Stage 3 assignment for one page: project only the source visual IDs owned by
 * the model-authored Learning Unit Contract. `claimed` verifies one-page
 * ownership; code never ranks, substitutes, or caps the model's selection.
 */
function assignSourceVisualsForSubsection({
  visuals,
  subsection,
  claimed,
  sourceArtifactAssignments = [],
}: {
  visuals: SourceVisual[];
  subsection: LearningSubsectionPlan;
  section: LearningSectionPlan;
  claimed: Set<string>;
  sourceArtifactAssignments?: SourceArtifactAssignment[];
}): SourceVisual[] {
  const available = visuals.filter((visual) => {
    if (claimed.has(visual.sourceVisualId)) return false;
    if (visual.type === "full_page_fallback") return Boolean(sourceVisualEmbedUrl(visual));
    // A real extracted figure/table/equation without a crop should remain a
    // source anchor, not be embedded as a misleading full-page screenshot.
    return Boolean(visual.croppedImagePath);
  });

  const primaryIds = assignedVisualArtifactIdsForUnit(sourceArtifactAssignments, subsection.learningUnitId);
  const plannedIds = primaryIds.length > 0
    ? primaryIds
    : (sourceArtifactAssignments.length > 0 ? [] : (subsection.sourceVisualIds ?? []));
  const planned = plannedIds
    .map((id) => available.find((visual) => visual.sourceVisualId === id))
    .filter((visual): visual is SourceVisual => Boolean(visual));

  const chosen = planned;
  for (const visual of chosen) claimed.add(visual.sourceVisualId);
  return chosen;
}

const EMBEDDED_VISUAL_BLOCK_RE = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;

/**
 * Stage 6 reconciliation: one stable ID everywhere.
 *
 * - Model-authored ```breadboard-visual blocks are validated; valid ones are
 *   persisted to .breadboard/visuals/ + visual-index.json so the embedded ID,
 *   the spec file, and the index always agree. Invalid ones are removed —
 *   a broken visual never reaches the page.
 * - New interactive visuals are generated ONLY when the confirmed plan asked
 *   for them (interactiveVisuals), and only while the page has none.
 * - There is no generic fallback visual: a page that needs nothing gets nothing.
 *
 * Returns the final markdown and the IDs of the blocks actually embedded, which
 * callers must use verbatim as the page's frontmatter visualIds.
 */
async function reconcileInteractiveVisuals({
  client,
  model,
  contentPath,
  gardenId,
  jobId,
  textbookVersionId,
  pageId,
  pageRelPath,
  markdown,
  subsection,
  sourceContext,
  sourceFigures,
  visualizationPlan,
  visualizationOutcomes,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  jobId: string;
  textbookVersionId: string;
  pageId: string;
  pageRelPath: string;
  markdown: string;
  subsection: LearningSubsectionPlan;
  sourceContext: unknown;
  sourceFigures: SourceFigure[];
  visualizationPlan: VisualizationPlan;
  visualizationOutcomes: VisualizationPublicationOutcome[];
}): Promise<{ markdown: string; visualIds: string[] }> {
  const keptIds: string[] = [];
  const opportunity = visualizationPlan.opportunities.find(
    (candidate) => candidate.learningUnitId === subsection.learningUnitId,
  );
  const routeDecision = opportunity
    ? visualizationPlan.decisions.find((candidate) => candidate.opportunityId === opportunity.id)
    : undefined;
  if (opportunity) {
    opportunity.targetPage = pageRelPath;
    opportunity.targetHeading = subsection.title;
    opportunity.insertionAnchor = `learning-unit:${opportunity.learningUnitId}:after-introduction`;
  }
  const recordOutcome = (outcome: VisualizationPublicationOutcome) => {
    const index = visualizationOutcomes.findIndex((candidate) => candidate.opportunityId === outcome.opportunityId);
    if (index >= 0) visualizationOutcomes[index] = outcome;
    else visualizationOutcomes.push(outcome);
  };

  // 1) Reconcile blocks the model wrote inline despite instructions. Only
  //    genuinely interactive types survive — there is no static-card fallback
  //    in the renderer, so anything else is removed rather than embedded.
  let nextMarkdown = markdown.replace(EMBEDDED_VISUAL_BLOCK_RE, "");

  // 2) Legacy bracket placeholders are removed, never replaced by filler.
  if (containsRawVisualPlaceholder(nextMarkdown)) {
    nextMarkdown = removeRawVisualPlaceholders(nextMarkdown, "");
  }

  if (!opportunity) {
    return { markdown: nextMarkdown, visualIds: keptIds };
  }
  if (!routeDecision) {
    throw new Error(`Visualization plan is missing a route decision for model-authored opportunity "${opportunity.id}".`);
  }
  if (routeDecision.route === "intentional_omission") {
    recordOutcome({
      opportunityId: opportunity.id,
      status: "intentional_omission",
      reason: routeDecision.reason,
    });
    appendLearnEvent(contentPath, gardenId, "learn_visual_skipped", {
      jobId,
      textbookVersionId,
      pageId,
      visualizationId: opportunity.id,
      reason: routeDecision.reason,
    });
    return { markdown: nextMarkdown, visualIds: keptIds };
  }
  if (routeDecision.route !== "generated_module") {
    throw new Error(
      `Visualization opportunity "${opportunity.id}" selected unsupported route "${routeDecision.route}"; ` +
        "active Learn visuals must use the model-authored generated-module contract.",
    );
  }

  {
    const marker = `<!-- ${opportunity.insertionAnchor} -->`;
    if (!nextMarkdown.includes(marker)) {
      const blocks = nextMarkdown.trim().split(/\n{2,}/);
      const introductionIndex = blocks.findIndex((block) => {
        const trimmed = block.trim();
        return Boolean(trimmed) && !trimmed.startsWith("#") && !trimmed.startsWith("![") && !trimmed.startsWith("<!--");
      });
      const insertionIndex = introductionIndex >= 0 ? introductionIndex + 1 : Math.min(1, blocks.length);
      blocks.splice(insertionIndex, 0, marker);
      nextMarkdown = blocks.join("\n\n");
    }

    const result = await createGeneratedVisualization({
      client,
      model,
      gardenDir: path.join(contentPath, gardenId),
      opportunity,
      pageMarkdown: nextMarkdown,
      sourceContext,
      sourceFigureSummaries: sourceFigures,
      formulaDefinitions: subsection.sourceFormulaContracts ?? [],
      // Every interaction in this plan was explicitly selected by the model.
      // Give each one the same bounded repair budget; code may not silently
      // demote a recommended or optional model decision after planning.
      maxAttempts: GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
      availableSourceAnchorIds: new Set(
        Object.keys(buildCanonicalSourceAnchors(path.join(contentPath, gardenId), { allowInferredFormulaText: false })),
      ),
      onEvent: (event) => appendLearnEvent(contentPath, gardenId, event.type, {
        ...event.data,
        jobId,
        textbookVersionId,
        pageId,
      }),
      checkCancelled: () => throwIfLearnCancelled(jobId),
    });
    if (result.manifest) {
      const block = buildGeneratedVisualBlock(result.manifest.id, result.manifest.version);
      nextMarkdown = nextMarkdown.replace(marker, `${marker}\n\n${block}`);
      keptIds.push(result.manifest.id);
      recordOutcome({ opportunityId: opportunity.id, status: "generated_published" });
    } else {
      const status: VisualizationPublicationOutcome["status"] =
        result.failureCategory === "runtime"
          ? "failed_runtime_tests"
          : result.failureCategory === "critic"
            ? "failed_critic"
            : result.failureCategory === "compilation"
              ? "failed_compilation"
              : "failed_validation";
      recordOutcome({ opportunityId: opportunity.id, status, reason: result.errors.join("; ") });
      const criticReviewDidNotComplete =
        result.failureCategory === "critic" &&
        result.errors.some((error) => /^Critic review could not complete\b/i.test(error));
      if (criticReviewDidNotComplete) {
        throw new Error(
          `Model-approved ${opportunity.requirement} interactive visual "${opportunity.id}" compiled and passed its validation and runtime gates, ` +
            `but critic review could not complete: ${result.errors.join("; ")}.`,
        );
      }
      throw new Error(
        `Model-approved ${opportunity.requirement} interactive visual "${opportunity.id}" could not be generated after its bounded repair attempts` +
          `${result.failureCategory ? ` (${result.failureCategory})` : ""}: ${result.errors.join("; ") || "no valid visual was produced"}.`,
      );
    }
    return { markdown: nextMarkdown, visualIds: keptIds };
  }

  return { markdown: nextMarkdown, visualIds: keptIds };
}

function cleanCouncilMarkdown(value: string, fallback: string): string {
  const cleaned = stripMarkdownFrontmatter(stripMarkdownFence(cleanGeneratedText(value))).trim();
  return cleaned || fallback;
}

function compactFallbackText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[#>*_`|[\](){}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- PageDossier: compact per-page context for subsection writing -----------
// A subsection prompt no longer receives the full source map, scope contract,
// and learning spine. It receives one exact local projection of the
// model-authored contract, its cited canonical source excerpts, and its
// assigned visuals. Code does not choose semantically similar source text.

type PageDossier = {
  gardenTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
  subsectionPurpose?: string;
  learningGoal?: string;
  learningUnit?: {
    id?: string;
    role?: string;
    learningQuestion?: string;
    prerequisiteConcepts?: string[];
    newConcepts?: string[];
    syllabusUnitIds?: string[];
    sourceFigures?: LearningSubsectionPlan["sourceFigureContracts"];
    sourceFormulas?: LearningSubsectionPlan["sourceFormulaContracts"];
    sourceTables?: LearningSubsectionPlan["sourceTableContracts"];
    sourceArtifactAssignments?: SourceArtifactAssignment[];
    interactiveVisual?: LearningSubsectionPlan["interactiveVisualContract"];
    interactiveVisualPlan?: LearningSubsectionPlan["interactiveVisualPlan"];
    teachingMediumPlan?: LearningSubsectionPlan["teachingMediumPlan"];
    zettelNotes?: LearningSubsectionPlan["zettelNotes"];
    semanticConcepts?: LearningSubsectionPlan["semanticConcepts"];
    knowledgeClaims?: LearningSubsectionPlan["knowledgeClaims"];
    mustNotRepeat?: string[];
    expectedWordRange?: [number, number];
  };

  mustCover: string[];
  avoid: string[];

  /** The course study guide, when one was designated. Orientation only — it
   * never appears in the lesson. */
  syllabus?: {
    title: string;
    outline: string;
  };

  /** Exact syllabus units selected for this page by the learning-spine model. */
  syllabusUnits?: Array<{
    unitId: string;
    label?: string;
    title: string;
    objectives: string[];
    topics: string[];
  }>;

  /** Works the course assigns that this garden does not contain. The page must
   * not name, summarize, or teach from any of them. */
  unavailableCitations?: string[];

  relevantSourceSnippets: Array<{
    sourceId: string;
    title: string;
    excerpt: string;
  }>;

  assignedSourceVisuals: Array<{
    sourceVisualId: string;
    sourceId?: string;
    title?: string;
    caption?: string;
    type?: string;
    markdown?: string;
  }>;

  localAnchors?: string[];
  sourceOnly: boolean;
};

/** Short scope reminders for the dossier's avoid list. */
function scopeAvoidList(scopeContract: unknown): string[] {
  if (!scopeContract || typeof scopeContract !== "object") return [];
  const excluded = (scopeContract as Record<string, unknown>).excluded;
  if (!Array.isArray(excluded)) return [];
  return excluded
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 200))
    .slice(0, 5);
}

function exactSourceSnippetsForAnchors(input: {
  anchors: readonly string[];
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>;
  sources: readonly LearnSourceSummary[];
}): Array<{ sourceId: string; title: string; excerpt: string }> {
  const sourceById = new Map(input.sources.map((source) => [source.slug, source]));
  const snippets: Array<{ sourceId: string; title: string; excerpt: string }> = [];
  let projectedChars = 0;
  for (const anchorId of input.anchors) {
    const anchor = input.canonicalSourceAnchors[anchorId];
    if (!anchor?.exactText || !anchor.sourceId) continue;
    const source = sourceById.get(anchor.sourceId);
    if (!source) continue;
    const excerpt = anchor.exactText.trim();
    if (!excerpt) continue;
    projectedChars += excerpt.length;
    if (projectedChars > MAX_TOTAL_SOURCE_CHARS_PER_PAGE) {
      throw new Error(
        `Model-authored source evidence for this page exceeds the ${MAX_TOTAL_SOURCE_CHARS_PER_PAGE}-character transport limit. Repair the Learning Unit Contract with fewer, more precise canonical anchors.`,
      );
    }
    snippets.push({ sourceId: source.slug, title: source.title, excerpt });
  }
  return snippets;
}

function buildPageDossier({
  gardenTitle,
  sectionTitle,
  sectionPurpose,
  subsection,
  anchors,
  scopeContract,
  sources,
  syllabus,
  syllabusCoverage,
  assignedVisuals,
  sourceArtifactAssignments,
  canonicalSourceAnchors,
  sourceOnly,
}: {
  gardenTitle: string;
  sectionTitle: string;
  sectionPurpose?: string;
  subsection: LearningSubsectionPlan;
  anchors: string[];
  scopeContract: unknown;
  sources: LearnSourceSummary[];
  syllabus?: LearnSourceSummary | null;
  syllabusCoverage?: SyllabusCoverage | null;
  assignedVisuals: SourceVisual[];
  sourceArtifactAssignments?: SourceArtifactAssignment[];
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>;
  sourceOnly: boolean;
}): PageDossier {
  const subsectionTitle = subsection.title;
  const assignedArtifactsForUnit = subsection.learningUnitId && sourceArtifactAssignments
    ? sourceArtifactAssignments.filter((assignment) => assignment.assignedLearningUnitId === subsection.learningUnitId)
    : (subsection.sourceArtifactAssignments ?? []);

  const syllabusCoverageById = new Map(
    (syllabusCoverage?.units ?? []).map((unit) => [unit.unitId, unit]),
  );
  const matchedSyllabusUnits = (subsection.syllabusUnitIds ?? [])
    .map((unitId) => syllabusCoverageById.get(unitId))
    .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
  const dossierSourceAnchorIds = [...new Set([
    ...anchors,
    ...(subsection.semanticConcepts ?? []).flatMap((concept) => concept.evidenceAnchors),
    ...(subsection.knowledgeClaims ?? []).flatMap((claim) => [
      ...claim.evidenceAnchors,
      ...(claim.derivationAnchors ?? []),
    ]),
    ...(subsection.sourceFigureContracts ?? []).map((figure) => figure.id),
    ...(subsection.sourceFormulaContracts ?? []).map((formula) => formula.id),
    ...(subsection.sourceTableContracts ?? []).map((table) => table.id),
  ])];
  return {
    gardenTitle,
    sectionTitle,
    subsectionTitle,
    subsectionPurpose: subsection.purpose || undefined,
    learningGoal: sectionPurpose || undefined,
    learningUnit: subsection.learningUnitId
      ? {
          id: subsection.learningUnitId,
          role: subsection.learningUnitRole,
          learningQuestion: subsection.learningQuestion,
          prerequisiteConcepts: subsection.prerequisiteConcepts,
          newConcepts: subsection.newConcepts,
          syllabusUnitIds: subsection.syllabusUnitIds,
          sourceFigures: subsection.sourceFigureContracts,
          sourceFormulas: subsection.sourceFormulaContracts,
          sourceTables: subsection.sourceTableContracts,
          sourceArtifactAssignments: assignedArtifactsForUnit,
          interactiveVisual: subsection.interactiveVisualContract,
          interactiveVisualPlan: subsection.interactiveVisualPlan,
          teachingMediumPlan: subsection.teachingMediumPlan,
          zettelNotes: subsection.zettelNotes,
          semanticConcepts: subsection.semanticConcepts,
          knowledgeClaims: subsection.knowledgeClaims,
          mustNotRepeat: subsection.mustNotRepeat,
          expectedWordRange: subsection.expectedWordRange,
        }
      : undefined,
    mustCover: (subsection.conceptTags ?? [])
      .map((tag) => tag.split("/").at(-1)?.replace(/-/g, " ") ?? "")
      .filter(Boolean)
      .slice(0, 8),
    avoid: scopeAvoidList(scopeContract),
    syllabus: syllabus
      ? {
          title: syllabus.title,
          outline: truncate(syllabus.body, MAX_SYLLABUS_DOSSIER_CHARS),
        }
      : undefined,
    syllabusUnits: matchedSyllabusUnits.length > 0
      ? matchedSyllabusUnits.map((unit) => ({
          unitId: unit.unitId,
          label: unit.label,
          title: unit.title,
          objectives: unit.objectives,
          topics: unit.topics,
        }))
      : undefined,
    unavailableCitations: matchedSyllabusUnits.some((unit) => unit.missingCitations.length > 0)
      ? [...new Set(matchedSyllabusUnits.flatMap((unit) => unit.missingCitations))]
      : undefined,
    relevantSourceSnippets: exactSourceSnippetsForAnchors({
      anchors: dossierSourceAnchorIds,
      canonicalSourceAnchors,
      sources,
    }),
    assignedSourceVisuals: assignedVisuals
      .map((visual) => ({
        sourceVisualId: visual.sourceVisualId,
        sourceId: visual.sourceId,
        caption: visual.caption,
        type: visual.type,
        markdown: sourceVisualMarkdown(visual) ?? undefined,
      })),
    localAnchors: anchors.slice(0, 8),
    sourceOnly,
  };
}

function snapshotSourceContext({
  clusterDir,
  textbookVersionId,
  pageId,
  sourceContext,
}: {
  clusterDir: string;
  textbookVersionId: string;
  pageId: string;
  sourceContext: unknown;
}): void {
  const fileName = `${safeLearnFileSegment(pageId, "page").replace(/\s+/g, "-")}.json`;
  const filePath = path.join(clusterDir, ".breadboard", "source-snapshots", textbookVersionId, fileName);
  assertInsideCluster(clusterDir, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sourceContext, null, 2), "utf-8");
}

export async function runTextbookGeneration({
  gardenId,
  userId,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  confirmedLearningMapId,
  mode = "generate",
  sourceOnly = true,
  includeSourceSnapshots = false,
  autoConfirmTopicMap = false,
  gardenLease,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  confirmedLearningMapId?: string;
  mode?: Exclude<LearnMode, "plan">;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  /**
   * Noninteractive/test escape hatch. When true, a proposed (unconfirmed) topic
   * map is auto-promoted to confirmed so page generation can proceed without a
   * human review gate. Off by default: interactive runs MUST go through
   * `confirmLearningMap` after reviewing the proposed map.
   */
  autoConfirmTopicMap?: boolean;
  /** Internal full-rebuild handoff. The caller retains release ownership. */
  gardenLease?: GardenLearnLease;
}): Promise<{ job: LearnJob; textbookVersionId: string; pageCount: number }> {
  if (mode === "repair") {
    throw new Error("Scoped repair must use runLearnRepairOperation; it cannot enter the full page-generation loop.");
  }
  assertNoPendingLearnClear(gardenId);
  const repositoryGardenDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(repositoryGardenDir, { recursive: true });
  const jobId = gardenLease?.lock.jobId ?? makeId("learn_job");
  let lease: GardenLearnLease;
  let ownsLease = false;
  if (gardenLease) {
    if (gardenLease.lost || !gardenLease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "The full rebuild lost its garden lease before generation could start.",
      );
    }
    lease = gardenLease;
  } else {
    const leaseResult = acquireGardenLearnLease(repositoryGardenDir, {
      gardenSlug: gardenId,
      jobId,
      buildId: `generation:${jobId}`,
    }, {
      onLeaseLost: () => abortLearnWorkerAfterLeaseLoss(jobId),
    });
    if (!leaseResult.acquired) {
      const message = `Another Learn operation (${leaseResult.conflict.jobId}) is already changing this garden.`;
      throw new LearnPipelineConflictError(message);
    }
    lease = leaseResult.lease;
    ownsLease = true;
  }
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
  } catch (error) {
    if (ownsLease) lease.release();
    throw error;
  }

  let map: StoredLearningMap;
  let context: LearnSourceContext;
  let sourceFormulaReviewFinalizationContext!: SourceFormulaReviewFinalizationContext;
  let handoffJobId: string | undefined;
  try {
    let selectedMap = confirmedLearningMapId
      ? getLearnMapById(confirmedLearningMapId, gardenId)
      : getLatestConfirmedLearnMap(gardenId);
    if (confirmedLearningMapId && !selectedMap) {
      throw new LearnPipelineConflictError(
        "The requested confirmed Learning Map does not belong to this garden or no longer exists.",
      );
    }
    let proposedForAutoConfirm: StoredLearningMap | null = null;
    if ((!selectedMap || selectedMap.status !== "confirmed") && autoConfirmTopicMap) {
      proposedForAutoConfirm = confirmedLearningMapId
        ? getLearnMapById(confirmedLearningMapId, gardenId)
        : getLatestProposedLearnMap(gardenId);
    }
    const workflowMap = selectedMap ?? proposedForAutoConfirm;
    // A manual confirmation normally leaves its planning row waiting. It is
    // the one row this generation is allowed to hand off; every other active,
    // pending-cancel, or awaiting workflow must be reconciled first.
    const workflowJob = workflowMap ? getLearnJobById(workflowMap.jobId) : null;
    handoffJobId =
      workflowJob?.gardenId === gardenId &&
      (workflowJob.status === "awaiting_confirmation" ||
        workflowJob.status === "building_navigation")
        ? workflowJob.id
        : undefined;
    assertNoUnresolvedLearnJob(gardenId, handoffJobId);
    if (proposedForAutoConfirm) {
      // This mutation is deliberately inside the fenced garden lease.
      if (proposedForAutoConfirm.status !== "confirmed") {
        confirmLearningMap({
          gardenId,
          learningMapId: proposedForAutoConfirm.id,
          contentPath,
          gardenLease: lease,
        });
      }
      selectedMap = getLearnMapById(proposedForAutoConfirm.id, gardenId);
    }
    if (!selectedMap || selectedMap.status !== "confirmed") {
      throw new Error(
        "Confirm a learning map before generating lessons (status must be 'confirmed'; " +
          "pass autoConfirmTopicMap:true only in noninteractive/test runs).",
      );
    }
    if (!isContractBackedLearningMap(selectedMap)) {
      throw new Error(
        "This confirmed learning map was created before Learning Unit Contracts existed. Start Learn again to draft a new source-grounded learning map.",
      );
    }
    if (gardenLease && selectedMap.jobId !== jobId) {
      throw new LearnPipelineConflictError(
        "The retained planning lease does not own the confirmed Learning Map.",
      );
    }
    map = selectedMap;
    // Reload source state only after lease acquisition. A confirmed map owns
    // its exact document/syllabus selection, so a concurrent rebuild cannot
    // leave this worker generating from stale pre-lock bytes.
    context = collectLearnSourceContext(
      contentPath,
      gardenId,
      map.sourceIds.length > 0 ? map.sourceIds : undefined,
      map.syllabusSourceId,
    );
    const confirmedFormulaReviewSetHash = sourceFormulaReviewSetHashFromCoveragePlan(
      map.coveragePlan,
    );
    const confirmedArtifactInventoryHash =
      sourceArtifactInventoryHashFromCoveragePlan(map.coveragePlan);
    if (!confirmedFormulaReviewSetHash) {
      throw new LearnPipelineConflictError(
        "This confirmed Learning Map predates AI source-formula fidelity review. Run Learn planning again and review the new map before generating lessons.",
      );
    }
    if (context.sourceFormulaReviewSetHash !== confirmedFormulaReviewSetHash) {
      throw new LearnPipelineConflictError(
        "The reviewed source-formula evidence changed after this Learning Map was created. Run Learn planning again before generating lessons.",
      );
    }
    if (context.sourceSetHash !== map.sourceSetHash) {
      throw new LearnPipelineConflictError(
        "The selected sources changed after this Learning Map was created. Run Learn planning again and review the updated map before generating lessons.",
      );
    }
    if (
      !confirmedArtifactInventoryHash ||
      confirmedArtifactInventoryHash !== map.sourceArtifactInventoryHash ||
      context.sourceArtifactInventoryHash !== confirmedArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected source-artifact inventory changed after this Learning Map was created. Run Learn planning again before generating lessons.",
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context,
      coveragePlan: map.coveragePlan,
      syllabusCoverage: map.syllabusCoverage,
      stage: "Generation preflight",
    });
    const confirmedReviewManifest = loadSourceFormulaReviewSetManifest(contentPath, gardenId);
    if (
      !confirmedReviewManifest ||
      confirmedReviewManifest.reviewSetHash !== confirmedFormulaReviewSetHash ||
      confirmedReviewManifest.combinedSourceSetHash !== map.sourceSetHash ||
      JSON.stringify(confirmedReviewManifest.sourceIds) !==
        JSON.stringify(context.sources.map((source) => source.slug)) ||
      confirmedReviewManifest.sourceIdentityMapHash !==
        sourceVisualSourceIdentityMapHash(context.sourceVisualSourceIdentityMap) ||
      JSON.stringify(confirmedReviewManifest.sourceIdentityMap) !==
        JSON.stringify(context.sourceVisualSourceIdentityMap)
    ) {
      throw new LearnPipelineConflictError(
        "The promoted source-formula review manifest does not match the confirmed Learning Map. Run planning again before generation.",
      );
    }
    const confirmedReviewValidation = validateSourceFormulaReviewSet({
      contentPath,
      gardenSlug: gardenId,
      requiredFormulaIds: confirmedReviewManifest.formulaIds,
      expectedReviewSetHash: confirmedReviewManifest.reviewSetHash,
      expectedModel: confirmedReviewManifest.model,
      expectedSourceIds: confirmedReviewManifest.sourceIds,
      sourceIdentityMap: context.sourceVisualSourceIdentityMap,
      expectedTopologyReviewPageReceipts: confirmedReviewManifest.topologyReviewPageReceipts,
    });
    if (confirmedReviewValidation.problems.length > 0) {
      throw new LearnPipelineConflictError(
        `The promoted source-formula review evidence failed strict validation: ${confirmedReviewValidation.problems.join("; ")}`,
      );
    }
    sourceFormulaReviewFinalizationContext = {
      reviewSetHash: confirmedReviewManifest.reviewSetHash,
      combinedSourceSetHash: map.sourceSetHash,
      sourceArtifactInventoryHash: confirmedArtifactInventoryHash,
      syllabusCoverageEvidenceRecoveryHash:
        syllabusCoverageEvidenceRecoveryHashFromCoveragePlan(map.coveragePlan) ?? "",
      ...(map.syllabusCoverage?.evidenceRecovery !== undefined
        ? {
            syllabusCoverageEvidenceRecovery: JSON.parse(JSON.stringify(
              map.syllabusCoverage.evidenceRecovery,
            )) as SyllabusCoverageEvidenceRecoveryReceipt,
          }
        : {}),
      formulaIds: [...confirmedReviewManifest.formulaIds],
      sourceIds: [...confirmedReviewManifest.sourceIds],
      sourceIdentityMap: context.sourceVisualSourceIdentityMap.map((entry) => ({ ...entry })),
      topologyReviewPageReceipts: confirmedReviewManifest.topologyReviewPageReceipts.map(
        (receipt) => ({
          ...receipt,
          activeFormulaIds: [...receipt.activeFormulaIds],
        }),
      ),
      model: confirmedReviewManifest.model,
    };
  } catch (error) {
    if (ownsLease) lease.release();
    throw error;
  }

  let job: LearnJob;
  try {
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease before creating or adopting its job.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    const currentHandoffJob = handoffJobId
      ? getLearnJobById(handoffJobId)
      : null;
    handoffJobId =
      currentHandoffJob?.gardenId === gardenId &&
      (currentHandoffJob.status === "awaiting_confirmation" ||
        currentHandoffJob.status === "building_navigation")
        ? currentHandoffJob.id
        : undefined;
    assertNoUnresolvedLearnJob(gardenId, handoffJobId);
    if (gardenLease) {
      throwIfLearnCancelled(jobId);
      const retainedJob = getLearnJobById(jobId);
      if (!retainedJob || retainedJob.gardenId !== gardenId) {
        throw new LearnPipelineConflictError(
          "The retained planning job no longer exists for this garden.",
        );
      }
      job = updateLearnJob(jobId, {
        model,
        mode,
        sourceIds: context.selectedSourceIds,
        syllabusSourceId: context.syllabus?.slug,
        sourceOnly,
        includeSourceSnapshots,
        confirmedLearningMapId: map.id,
        currentStep: "Preparing isolated lesson workspace",
      });
      if (job.status === "cancelled" || job.status === "failed" || job.status === "complete") {
        throw new LearnPipelineConflictError(
          `The retained Learn workflow is already ${job.status}.`,
        );
      }
    } else {
      job = db.transaction(() => {
        const planningJob = getLearnJobById(map.jobId);
        if (
          planningJob?.gardenId === gardenId &&
          (planningJob.status === "awaiting_confirmation" ||
            planningJob.status === "building_navigation")
        ) {
          updateLearnJobExpectStatus(planningJob.id, {
            status: "complete",
            currentStep: `Learning map confirmed; lesson generation handed off to ${jobId}`,
            progressPercent: 100,
            confirmedLearningMapId: map.id,
          });
        }
        return createLearnJob({
          id: jobId,
          gardenId,
          userId,
          model,
          mode,
          sourceIds: context.selectedSourceIds,
          syllabusSourceId: context.syllabus?.slug,
          sourceOnly,
          includeSourceSnapshots,
        });
      }).immediate();
    }
  } catch (error) {
    if (ownsLease) lease.release();
    throw error;
  }

  let workspace: LearnBuildWorkspace | null = null;
  let disposeModelTracking = (): void => {};
  try {
    if (!gardenLease) {
      createLearnRunSnapshot({
        gardenId,
        contentPath,
        jobId: job.id,
        inheritFromJobId: map.jobId,
      });
      throwIfLearnCancelled(job.id);
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn generation lost its garden lease while creating the rollback snapshot.",
        );
      }
    }
    workspace = createLearnBuildWorkspace({
      gardenSlug: gardenId,
      jobId: job.id,
      mode:
        mode === "update_sources"
          ? "update"
          : mode === "generate"
            ? "generate"
            : "regenerate",
      repositoryGardenDir,
      contractFingerprint: createHash("sha256")
        .update(JSON.stringify(map.coveragePlan ?? null))
        .digest("hex"),
      sourceSetFingerprint: context.sourceSetHash,
      stagingDirectoryName: gardenId,
      requireAuthoritativeSourceAnchorLedger: true,
    });
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease while seeding the isolated workspace.",
      );
    }
    const stagedContext = collectLearnSourceContext(
      workspace.workspaceRoot,
      gardenId,
      map.sourceIds.length > 0 ? map.sourceIds : undefined,
      map.syllabusSourceId,
    );
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease while validating staged sources.",
      );
    }
    if (
      stagedContext.sourceFormulaReviewSetHash !==
      sourceFormulaReviewSetHashFromCoveragePlan(map.coveragePlan)
    ) {
      throw new LearnPipelineConflictError(
        "The staged reviewed source-formula evidence does not match the confirmed Learning Map. Run planning again before generating lessons.",
      );
    }
    if (stagedContext.sourceSetHash !== map.sourceSetHash) {
      throw new LearnPipelineConflictError(
        "The selected sources changed while Learn was preparing its isolated workspace. Run planning again before generating lessons.",
      );
    }
    if (
      stagedContext.sourceArtifactInventoryHash !==
      map.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected source-artifact inventory changed while Learn was preparing its isolated workspace. Run planning again before generating lessons.",
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context: stagedContext,
      coveragePlan: map.coveragePlan,
      syllabusCoverage: map.syllabusCoverage,
      stage: "Staged generation preflight",
    });
    // The workspace was seeded from the previously committed contract. Compare
    // its independent receipt copy to the confirmed-map expectation before a
    // generation writer can overwrite either field. This makes deletion from
    // the map/coverage plan observable instead of laundering it into a fresh
    // receipt-free contract.
    const stagedPersistedSourceContext =
      sourceFormulaReviewFinalizationContextFromGarden(workspace.stagingGardenDir);
    const expectedRecoveryReceipt =
      sourceFormulaReviewFinalizationContext.syllabusCoverageEvidenceRecovery;
    const stagedRecoveryReceipt =
      stagedPersistedSourceContext?.syllabusCoverageEvidenceRecovery;
    if (!stagedPersistedSourceContext ||
        stagedPersistedSourceContext.syllabusCoverageEvidenceRecoveryHash !==
          sourceFormulaReviewFinalizationContext.syllabusCoverageEvidenceRecoveryHash ||
        (stagedRecoveryReceipt !== undefined) !==
          (expectedRecoveryReceipt !== undefined) ||
        (stagedRecoveryReceipt !== undefined &&
          JSON.stringify(stagedRecoveryReceipt) !==
            JSON.stringify(expectedRecoveryReceipt))) {
      throw new LearnPipelineConflictError(
        "The staged Learning Unit Contract syllabus evidence-recovery receipt does not match the confirmed Learning Map. Run planning again before generation.",
      );
    }
    context = stagedContext;
    disposeModelTracking = attachLearnJobModelTracking({
      client,
      jobId: job.id,
      gardenId,
      contentPath,
    });
  } catch (error) {
    if (workspace) disposeLearnBuildWorkspace(workspace);
    if (ownsLease) lease.release();
    const message = errorMessage(error, "Generation workspace could not be prepared");
    updateLearnJob(job.id, {
      status: "failed",
      currentStep: "Generation could not start",
      error: message,
    });
    throw error;
  }
  const artifactContentPath = workspace.workspaceRoot;
  const clusterDir = workspace.stagingGardenDir;
  let previousPromotedGardenDir: string | undefined;
  let promotionCommitted = false;
  // Built once from the confirmed map's own availability check, so every page in
  // this run is judged against the same answer planning used. Empty when there
  // is no syllabus or nothing it assigns is missing, in which case the gate
  // costs nothing and never fires.
  const missingCitationProbes: UnavailableCitationProbe[] = unavailableCitationProbes(
    map.syllabusCoverage ?? null,
  );
  const unavailableCitationGate = missingCitationProbes.length
    ? { detect: (prose: string) => detectUnavailableCitations(prose, missingCitationProbes) }
    : undefined;
  let confirmedLearningUnits: LearningUnitContract[] = [];
  let confirmedSourceArtifactAssignments: SourceArtifactAssignment[] = [];
  let confirmedSourceArtifactOmissions: SourceArtifactOmission[] = [];
  // Version ids are learning_* so nothing named "textbook" can leak into a
  // visible file name, event, or frontmatter value.
  const textbookVersionId = makeId("learning");
  const backupDir = `.breadboard/backups/${textbookVersionId}`;
  const generatedAt = nowIso();
  const generatedPages: GeneratedPageRecord[] = [];
  const unusedFigureReasons = new Map<string, string>();
  // Stage 3 bookkeeping: which SourceVisual landed on which page.
  const visualAssignments = new Map<string, { pageId: string; sectionId?: string }>();
  const claimedVisualIds = new Set<string>();
  let visualizationPlan: VisualizationPlan | null = null;
  const visualizationOutcomes: VisualizationPublicationOutcome[] = [];

  try {
    confirmedLearningUnits = learningUnitsFromCoveragePlan(map.coveragePlan);
    confirmedSourceArtifactAssignments = sourceArtifactAssignmentsFromCoveragePlan(map.coveragePlan);
    confirmedSourceArtifactOmissions = sourceArtifactOmissionsFromCoveragePlan(map.coveragePlan);
    const storedSyllabusAssignmentProblems = syllabusUnitAssignmentProblems(
      confirmedLearningUnits,
      map.syllabusCoverage ?? null,
    );
    if (storedSyllabusAssignmentProblems.length > 0) {
      throw new Error(
        `The confirmed Learning Unit Contract needs model replanning before generation: ${storedSyllabusAssignmentProblems.join("; ")}`,
      );
    }
    appendLearnEvent(contentPath, gardenId, "learn_generation_started", {
      jobId: job.id,
      textbookVersionId,
      learningMapId: map.id,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      status: "generating_learning_pages",
      currentStep: "Extracting source visuals",
      progressPercent: 2,
      confirmedLearningMapId: map.id,
      latestTextbookVersionId: textbookVersionId,
      sourceSetHash: context.sourceSetHash,
    });
    // Stage 2 FIRST (idempotent): the required production order is
    // extract → verify formula identities → plan assignments → persist
    // contract → write pages. Extraction therefore precedes the contract
    // write, so every source formula has a canonical identity BEFORE any
    // assignment is persisted.
    let ledgerVisuals = await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      deferEmptyVisualCheck: true,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    let referencedArtifactResolution: { requestedIds: string[]; unresolvedIds: string[] } = {
      requestedIds: [],
      unresolvedIds: [],
    };
    try {
      referencedArtifactResolution = await ensureReferencedSourceArtifactsExtracted({
        client,
        model,
        contentPath: artifactContentPath,
        gardenId,
        context,
        units: confirmedLearningUnits,
        candidateArtifactIds: structuredArtifactIdsMentionedBySources(context),
        checkpoint: () => throwIfLearnCancelled(job.id),
        onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
      });
      ledgerVisuals = loadSourceVisuals(artifactContentPath, gardenId).filter((visual) =>
        context.sources.some((source) => source.slug === visual.sourceId),
      );
    } catch (error) {
      appendLearnEvent(contentPath, gardenId, "learn_referenced_source_scan_failed", {
        jobId: job.id,
        textbookVersionId,
        stage: "generation",
        reason: errorMessage(error),
      });
    }
    ledgerVisuals = await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    const generationFormulaReview = await reviewAndBindSourceFormulas({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    ledgerVisuals = generationFormulaReview.visuals.filter((visual) =>
      context.sources.some((source) => source.slug === visual.sourceId),
    );
    appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
      jobId: job.id,
      textbookVersionId,
      stage: "generation",
      reviewSetHash: generationFormulaReview.reviewedFormulaSetHash,
      formulaCount: generationFormulaReview.formulaIds.length,
      replacementCount: generationFormulaReview.replacementFormulaIds.length,
      newlyReplacedFormulaIds: generationFormulaReview.newlyReplacedFormulaIds,
      cacheHitCount: generationFormulaReview.cacheHitFormulaIds.length,
      modelCalls: generationFormulaReview.modelCalls,
    });
    const confirmedFormulaReviewSetHash = sourceFormulaReviewSetHashFromCoveragePlan(
      map.coveragePlan,
    );
    if (
      generationFormulaReview.newlyReplacedFormulaIds.length > 0 ||
      !confirmedFormulaReviewSetHash ||
      generationFormulaReview.reviewedFormulaSetHash !== confirmedFormulaReviewSetHash ||
      context.sourceSetHash !== map.sourceSetHash ||
      context.sourceArtifactInventoryHash !== map.sourceArtifactInventoryHash
    ) {
      throw new Error(
        `Source formula fidelity review or source-artifact extraction found evidence that is not bound to the confirmed Learning Map${
          generationFormulaReview.newlyReplacedFormulaIds.length > 0
            ? ` (new replacements: ${generationFormulaReview.newlyReplacedFormulaIds.join(", ")})`
            : ""
        }. No learner pages were written; run Learn planning again and confirm the fresh AI-authored map.`,
      );
    }
    if (
      JSON.stringify(generationFormulaReview.formulaIds) !==
        JSON.stringify(sourceFormulaReviewFinalizationContext.formulaIds) ||
      JSON.stringify(context.sources.map((source) => source.slug)) !==
        JSON.stringify(sourceFormulaReviewFinalizationContext.sourceIds) ||
      context.sourceArtifactInventoryHash !==
        sourceFormulaReviewFinalizationContext.sourceArtifactInventoryHash
    ) {
      throw new Error(
        "Generation discovered a different source-formula/source identity/artifact inventory than the confirmed review context. No learner pages were written; replan first.",
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context,
      coveragePlan: map.coveragePlan,
      syllabusCoverage: map.syllabusCoverage,
      stage: "Post-extraction generation",
    });
    const sourceArtifactReconciliation = reconcileLearningUnitSourceArtifacts(
      confirmedLearningUnits,
      confirmedSourceArtifactAssignments,
      registeredArtifactsFromFigures(context.sourceFigures),
    );
    if (sourceArtifactReconciliation.removedArtifactIds.length > 0) {
      throw new Error(
        `The confirmed model-authored contract references source artifacts that could not be registered after targeted extraction: ${sourceArtifactReconciliation.removedArtifactIds.join(", ")}. The contract was not rewritten; rerun planning so the model can repair it.`,
      );
    }
    if (!sameSourceArtifactAssignmentRecords(
      sourceArtifactReconciliation.assignments,
      confirmedSourceArtifactAssignments,
    )) {
      throw new Error(
        "Source artifact registry reconciliation attempted to rewrite the model-authored assignment projection. Repair the contract instead.",
      );
    }
    const confirmedArtifactCoverageProblems = sourceArtifactCoverageProblems(
      confirmedLearningUnits,
      confirmedSourceArtifactOmissions,
      registeredArtifactsFromFigures(context.sourceFigures),
    );
    if (confirmedArtifactCoverageProblems.length > 0) {
      throw new Error(
        `The confirmed model-authored artifact partition is invalid: ${confirmedArtifactCoverageProblems.join("; ")}. Rerun planning so the authoring model can repair it.`,
      );
    }
    appendLearnEvent(contentPath, gardenId, "learn_source_artifacts_reconciled", {
      jobId: job.id,
      textbookVersionId,
      stage: "generation",
      requestedIds: referencedArtifactResolution.requestedIds,
      unresolvedIds: referencedArtifactResolution.unresolvedIds,
      removedArtifactIds: sourceArtifactReconciliation.removedArtifactIds,
    });
    const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
    verifyAuthoritativeSourceAnchorLedger(workspace);
    const selectedCanonicalSourceAnchors = Object.fromEntries(
      Object.entries(buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false })).filter(([, anchor]) =>
        typeof anchor.sourceId === "string" && selectedSourceIds.has(anchor.sourceId),
      ),
    );
    const sourceFormulaIdentityById = new Map(
      Object.values(selectedCanonicalSourceAnchors)
        .filter((anchor) => anchor.kind === "formula" && Boolean(anchor.exactText?.trim()))
        .map((anchor) => [anchor.id, anchor]),
    );
    // Formula ownership and placement remain exactly as authored in the
    // confirmed contract. This gate verifies only that each claimed identity
    // exists in the canonical source registry.
    for (const unit of confirmedLearningUnits) {
      for (const formula of unit.sourceFormulas) {
        if (!sourceFormulaIdentityById.has(formula.id)) {
          throw new Error(
            `Model-authored formula assignment ${formula.id} on ${unit.id} has no canonical source record. Repair the learning-unit contract.`,
          );
        }
      }
    }
    // Rerun the whole-garden model decision against the post-formula contract;
    // every unit and every active interaction are independently validated.
    const generationVisualNecessityReview = await planAndReviewVisualNecessity({
      client,
      model,
      gardenId,
      contentPath: artifactContentPath,
      jobId: job.id,
      learningUnits: confirmedLearningUnits,
    });
    confirmedLearningUnits = generationVisualNecessityReview.learningUnits;
    verifyAuthoritativeSourceAnchorLedger(workspace);
    // Persist the model-authored visual plan. The writer may still reconcile
    // source/formula registry integrity, but it cannot replace visual pedagogy.
    const contractWrite = writeLearningUnitContractArtifacts({
      clusterDir,
      units: confirmedLearningUnits,
      assignments: confirmedSourceArtifactAssignments,
      omissions: confirmedSourceArtifactOmissions,
      registeredArtifacts: registeredArtifactsFromFigures(context.sourceFigures),
      sourceSetHash: context.sourceSetHash,
      sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
      sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
      syllabusCoverageEvidenceRecovery: map.syllabusCoverage?.evidenceRecovery,
      visualNecessityReview: generationVisualNecessityReview,
    });
    confirmedLearningUnits = contractWrite.units;
    confirmedSourceArtifactAssignments = contractWrite.assignments;
    confirmedSourceArtifactOmissions = contractWrite.omissions;
    let repairedCoveragePlan = {
      ...planningRecord(map.coveragePlan),
      learningUnitContracts: confirmedLearningUnits,
      sourceArtifactAssignments: confirmedSourceArtifactAssignments,
      sourceArtifactOmissions: confirmedSourceArtifactOmissions,
    };
    let repairedLearningMap = learningMapWithConfirmedUnitContracts(
      map.learningMap,
      confirmedLearningUnits,
    );
    map = {
      ...map,
      coveragePlan: repairedCoveragePlan,
      learningMap: repairedLearningMap,
      proposedOrder: repairedLearningMap.sections,
    };
    // Rebuild after formula assignment reconciliation so visualization
    // opportunities see the exact confirmed contracts that page generation
    // will use. The saved plan is the auditable routing control plane for this
    // run; page-specific target paths are filled as each unit is written.
    const visualizationPlanningStartedAt = Date.now();
    const generationCanonicalVisualEvidence = canonicalVisualizationEvidenceByUnit(
      clusterDir,
      confirmedLearningUnits,
    );
    const generationVisualizationPlanning = await buildVisualizationPlanWithContractRepair({
      gardenId,
      learningMap: repairedLearningMap,
      learningUnits: confirmedLearningUnits,
      visualBudget: generationVisualNecessityReview.budget,
      canonicalEvidenceByUnit: generationCanonicalVisualEvidence,
      necessityReviewCalls: generationVisualNecessityReview.reviewCalls,
      rejectedNecessityReviews: generationVisualNecessityReview.rejectedReviews,
      visualDecisionOverrides: generationVisualNecessityReview.overrides,
      repairProvider: (packet) => requestVisualizationContractRepair({
        client,
        model,
        gardenId,
        packet,
      }),
      maxRepairAttempts: 2,
      checkCancelled: () => throwIfLearnCancelled(job.id),
      onEvent: (type, data) => appendLearnEvent(contentPath, gardenId, type, {
        jobId: job.id,
        textbookVersionId,
        ...data,
      }),
    });
    const generationExecutabilityContext = {
      phase: "generation" as const,
      jobId: job.id,
      model,
      learningMapId: map.id,
      textbookVersionId,
    };
    const generationExecutabilityReview = await reviewVisualizationPlanExecutability({
      gardenId,
      learningMap: repairedLearningMap,
      learningUnits: generationVisualizationPlanning.learningUnits,
      initialPlan: generationVisualizationPlanning.plan,
      canonicalEvidenceByUnit: generationCanonicalVisualEvidence,
      auditContext: generationExecutabilityContext,
      maximumRepeatedInteractionSignature: LEARN_VISUAL_MAX_REPEATED_INTERACTION_SIGNATURE,
      provider: (request) => requestVisualizationContractExecutabilityReview({
        client,
        model,
        gardenId,
        request,
      }),
      checkCancelled: () => throwIfLearnCancelled(job.id),
      onEvent: (type, data) => appendLearnEvent(contentPath, gardenId, type, {
        jobId: job.id,
        textbookVersionId,
        ...data,
      }),
    });
    visualizationPlan = generationExecutabilityReview.plan;
    confirmedLearningUnits = generationExecutabilityReview.learningUnits;
    confirmedLearningUnits = applyVisualizationRoutesToLearningUnits(
      confirmedLearningUnits,
      visualizationPlan,
    );
    visualizationPlan = buildFinalVisualizationPlanFromRoutedContracts({
      gardenId,
      learningMap: repairedLearningMap,
      finalRoutedLearningUnits: confirmedLearningUnits,
      reviewedPlan: visualizationPlan,
      canonicalEvidenceByUnit: generationCanonicalVisualEvidence,
    });
    // As in planning, prove that the durable ledger can be built before any
    // generation-phase contract/plan artifact is replaced.
    const generationExecutabilityLedger = buildVisualContractExecutabilityLedger({
      gardenId,
      context: generationExecutabilityContext,
      review: generationExecutabilityReview,
      finalRoutedLearningUnits: confirmedLearningUnits,
      finalVisualizationPlan: visualizationPlan,
      structuralContractRepair: {
        source: generationVisualizationPlanning.repairSource,
        ...generationVisualizationPlanning.repairAudit,
      },
    });
    persistRoutedVisualPlans(clusterDir, confirmedLearningUnits);
    repairedCoveragePlan = {
      ...repairedCoveragePlan,
      learningUnitContracts: confirmedLearningUnits,
      sourceArtifactAssignments: confirmedSourceArtifactAssignments,
    };
    repairedLearningMap = learningMapWithConfirmedUnitContracts(
      repairedLearningMap,
      confirmedLearningUnits,
    );
    map = {
      ...map,
      coveragePlan: repairedCoveragePlan,
      learningMap: repairedLearningMap,
      proposedOrder: repairedLearningMap.sections,
    };
    saveVisualizationPlan(clusterDir, visualizationPlan);
    saveVisualContractExecutabilityLedger({
      gardenDir: clusterDir,
      ledger: generationExecutabilityLedger,
    });
    appendLearnEvent(contentPath, gardenId, "visual_contract_executability_ledger_persisted", {
      jobId: job.id,
      textbookVersionId,
      path: VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH,
      modelCalls: generationExecutabilityReview.calls,
      replacedUnitIds: generationExecutabilityReview.replacedUnitIds,
    });
    appendLearnEvent(contentPath, gardenId, "visual_opportunity_analysis_completed", {
      jobId: job.id,
      textbookVersionId,
      opportunitiesDetected: visualizationPlan.opportunities.length,
      durationMs: Date.now() - visualizationPlanningStartedAt,
    });
    for (const decision of visualizationPlan.decisions) {
      appendLearnEvent(contentPath, gardenId, "visual_route_selected", {
        jobId: job.id,
        textbookVersionId,
        visualizationId: decision.opportunityId,
        route: decision.route,
        selectedRenderer: decision.selectedRenderer,
        compatibilityScore: decision.compatibilityScore,
        reason: decision.reason,
        duplicateOf: decision.duplicateOf,
      });
      if (decision.route === "intentional_omission") {
        visualizationOutcomes.push({
          opportunityId: decision.opportunityId,
          status: "intentional_omission",
          reason: decision.reason,
        });
      }
    }
    if (contractWrite.semanticAliasRepairs.length > 0) {
      appendLearnEvent(contentPath, gardenId, "learn_concept_aliases_reconciled", {
        jobId: job.id,
        learningMapId: map.id,
        repairs: contractWrite.semanticAliasRepairs,
      });
    }
    // Strict pre-write gate (unchanged): every formula that can reach a
    // learner page must have a verified identity and must match its contract
    // unit. After the assignment plan this is a pure backstop; it stops the
    // run before page frontmatter is created if anything slipped through.
    for (const unit of confirmedLearningUnits) {
      for (const formula of unit.sourceFormulas) {
        const identity = sourceFormulaIdentityById.get(formula.id);
        if (!identity) throw new Error(`Formula pre-write guard: ${formula.id} has no canonical source record.`);
      }
    }
    throwIfLearnCancelled(job.id);
    updateLearnJob(job.id, {
      status: "generating_learning_pages",
      currentStep: "Writing overview pages",
      progressPercent: 3,
    });

    let overviewBody: string | null = null;
    let lastOverviewDraft = "";
    let lastOverviewProblems = ["no usable overview draft was returned"];
    for (let attempt = 0; attempt < 3 && !overviewBody; attempt += 1) {
      throwIfLearnCancelled(job.id);
      try {
        const overviewCall = await callCouncilText({
          client,
          model,
          taskType: "source_synthesis",
          gardenId,
          pageId: "learning/Topic Overview",
          system: OVERVIEW_PROMPT,
          user: compactJson({
            task: attempt === 0 ? "write_topic_overview" : "repair_topic_overview",
            learningMap: map.learningMap,
            scopeContract: map.scopeContract,
            sourceOnly,
            ...(attempt > 0
              ? {
                  previousMarkdown: lastOverviewDraft,
                  failedProblems: lastOverviewProblems,
                  instruction: "Return a complete corrected Markdown body. Do not explain the repair.",
                }
              : {}),
          }),
          sourceContext: {
            gardenId,
            pageId: "learning/Topic Overview",
            taskType: attempt === 0 ? "source_synthesis" : "source_synthesis_repair",
            sourceIds: context.sources.map((source) => source.slug),
            repairAttempt: attempt,
          },
          councilModeOverride: LEARN_GENERATION_COUNCIL_MODE,
        });
        lastOverviewDraft = cleanCouncilMarkdown(overviewCall.content, "").trim();
        if (!lastOverviewDraft) {
          lastOverviewProblems = ["model returned an empty overview"];
          continue;
        }
        const validated = validateTopicOverview(lastOverviewDraft, map.learningMap);
        lastOverviewProblems = validated.problems;
        appendLearnEvent(contentPath, gardenId, "learn_overview_reviewed", {
          jobId: job.id,
          attempt: attempt + 1,
          problems: validated.problems,
        });
        if (validated.problems.length === 0) overviewBody = validated.markdown;
      } catch (error) {
        lastOverviewProblems = [`overview model call failed: ${errorMessage(error)}`];
      }
    }
    if (!overviewBody) {
      throw new Error(
        `The AI-authored Topic Overview remained invalid after 3 bounded attempts: ${lastOverviewProblems.join("; ")}. No fallback overview was written.`,
      );
    }
    throwIfLearnCancelled(job.id);

    // Learner-facing planning pages live in learning/. Everything else is
    // internal and is written under .breadboard/planning/ so it never appears
    // in the published garden or the knowledge graph.
    const learningRelPaths = [
      {
        relPath: `${LEARNING_ROOT}/_index.md`,
        title: map.learningMap.title,
        type: "learning-index",
        body: renderLearningIndexMarkdown(map.learningMap),
      },
      {
        relPath: `${LEARNING_ROOT}/Topic Overview.md`,
        title: "Topic Overview",
        type: "topic-overview",
        body: overviewBody,
      },
      {
        relPath: `${LEARNING_ROOT}/Learning Map.md`,
        title: "Learning Map",
        type: "learning-map",
        body: renderLearningMapMarkdown(map.learningMap),
      },
    ];
    const internalPlanningPages = [
      {
        relPath: ".breadboard/planning/Source Map.md",
        title: "Source Map",
        type: "source-map",
        body: sourceMapMarkdown(map.sourceMap, context),
      },
      {
        relPath: ".breadboard/planning/Scope Contract.md",
        title: "Scope Contract",
        type: "scope-contract",
        body: scopeContractMarkdown(map.scopeContract),
      },
    ];

    for (const page of learningRelPaths) {
      throwIfLearnCancelled(job.id);
      writeMarkdownWithBackup({
        clusterDir,
        relPath: page.relPath,
        textbookVersionId,
        content:
          learningPageFrontmatter(
            page.title,
            page.type,
            gardenId,
            textbookVersionId,
            context.sourceSetHash,
          ) + page.body,
      });
    }
    for (const page of internalPlanningPages) {
      throwIfLearnCancelled(job.id);
      writeMarkdownWithBackup({
        clusterDir,
        relPath: page.relPath,
        textbookVersionId,
        content:
          learningPageFrontmatter(
            page.title,
            page.type,
            gardenId,
            textbookVersionId,
            context.sourceSetHash,
          ) + page.body,
      });
    }

    const totalSubsections = map.learningMap.sections.reduce(
      (count, section) => count + section.subsections.length,
      0,
    );
    let completed = 0;

    for (let sectionIndex = 0; sectionIndex < map.learningMap.sections.length; sectionIndex += 1) {
      const section = map.learningMap.sections[sectionIndex];
      const sectionNumber = sectionIndex + 1;
      // Older stored maps may predate title sanitation — enforce it at render.
      const sectionTitle = section.title;
      const sectionFolder = learningSectionFolder(sectionNumber, sectionTitle);
      const sectionIndexRelPath = `${sectionFolder}/_index.md`;
      throwIfLearnCancelled(job.id);
      writeMarkdownWithBackup({
        clusterDir,
        relPath: sectionIndexRelPath,
        textbookVersionId,
        content:
          yamlFrontmatter({
            title: `${sectionNumber}. ${sectionTitle}`,
            date: generatedAt,
            knowledge_type: "learning-section",
            breadboardType: "learning_section",
            gardenId,
            generatedBy: "learn_button",
            generated_by: "learn_button",
            learningVersion: publicLearningVersionId(textbookVersionId),
            sourceSetHash: context.sourceSetHash,
          }) +
          `# ${sectionNumber}. ${sectionTitle}\n\n${section.purpose}\n`,
      });

      for (let subsectionIndex = 0; subsectionIndex < section.subsections.length; subsectionIndex += 1) {
        throwIfLearnCancelled(job.id);
        const subsection = section.subsections[subsectionIndex];
        const subsectionNumber = subsectionIndex + 1;
        const subsectionTitle = subsection.title;
        const pageTitle = `${sectionNumber}.${subsectionNumber} ${subsectionTitle}`;
        const pageFileName = textbookPageFileName(sectionNumber, subsectionNumber, subsectionTitle);
        const pageRelPath = `${sectionFolder}/${pageFileName}`;
        const pageId = pageRelPath.replace(/\.md$/i, "");
        const anchors = subsection.sourceAnchors;
        // Stage 3: which extracted source visuals belong on this page.
        const assignedVisuals = assignSourceVisualsForSubsection({
          visuals: ledgerVisuals,
          subsection,
          section,
          claimed: claimedVisualIds,
          sourceArtifactAssignments: confirmedSourceArtifactAssignments,
        });
        const metricFormulaAnchorIds = (subsection.sourceFormulaContracts ?? []).map((formula) => formula.id);
        for (const anchorId of metricFormulaAnchorIds) {
          const identity = sourceFormulaIdentityById.get(anchorId);
          if (!identity) {
            throw new Error(`Formula pre-write guard: ${anchorId} cannot be resolved to a verified unit assignment.`);
          }
        }
        const sourceFigures = sourceFiguresFromVisuals(assignedVisuals);
        const pageSourceFormulaFigures = sourceFormulaFiguresForSubsection(context, subsection);
        const interactiveSourceFigures =
          metricFormulaAnchorIds.length > 0
            ? [
                ...sourceFigures,
                ...pageSourceFormulaFigures.filter(
                  (formula) => !sourceFigures.some((figure) => figure.figureId === formula.figureId),
                ),
              ]
            : sourceFigures;
        // Compact per-page packet: everything the model needs to write THIS
        // subsection, nothing else. The full source map / scope contract /
        // learning spine never ride into page prompts anymore.
        const pageDossier = buildPageDossier({
          gardenTitle: map.learningMap.title,
          sectionTitle,
          sectionPurpose: section.purpose,
          subsection,
          anchors,
          scopeContract: map.scopeContract,
          sources: context.sources,
          syllabus: context.syllabus,
          syllabusCoverage: map.syllabusCoverage,
          assignedVisuals,
          sourceArtifactAssignments: confirmedSourceArtifactAssignments,
          canonicalSourceAnchors: selectedCanonicalSourceAnchors,
          sourceOnly,
        });
        // sourceContext carries small routing metadata only during page
        // writing; the dossier lives in the user message.
        const pageSourceMeta = {
          gardenId,
          pageId,
          sourceIds: [...new Set(pageDossier.relevantSourceSnippets.map((s) => s.sourceId))],
          visualIds: pageDossier.assignedSourceVisuals.map((v) => v.sourceVisualId),
          sourceOnly,
        };

        appendLearnEvent(contentPath, gardenId, "learn_page_started", {
          jobId: job.id,
          textbookVersionId,
          pageId,
          sourceIds: context.sources.map((source) => source.slug),
        });
        updateLearnJob(job.id, {
          status: "generating_learning_pages",
          currentStep: "Writing lesson subsection",
          progressPercent: 10 + Math.floor((completed / Math.max(1, totalSubsections)) * 70),
          currentSectionTitle: sectionTitle,
          currentPageTitle: pageTitle,
        });

        if (includeSourceSnapshots) {
          snapshotSourceContext({
            clusterDir,
            textbookVersionId,
            pageId,
            sourceContext: { dossier: pageDossier, sourceContextMeta: pageSourceMeta },
          });
        }

        const assignedVisualUrls = assignedVisuals
          .map((visual) => sourceVisualEmbedUrl(visual))
          .filter((url): url is string => Boolean(url));

        // Stage 4: bounded model generation and repair. Code evaluates the
        // returned lesson but never rewrites its pedagogy, inserts a Q&A, adds
        // a formula, or places a source visual on the model's behalf.
        let pageBody: string | null = null;
        let subsectionRunId: string | undefined;
        let revisionRunId: string | undefined;
        let lastQuality: ReturnType<typeof assessLessonQuality> | null = null;
        let lastAttemptBody = "";

        for (let attempt = 0; attempt < MAX_PAGE_ATTEMPTS; attempt += 1) {
          const failedProblemCodes = (lastQuality?.problems ?? [])
            .filter((problem) => problem.hard)
            .map((problem) => problem.code);
          const placeholderFailure = failedProblemCodes.some(
            (code) => code === "placeholder" || code === "empty-bullet-scaffold",
          );
          const retryNote =
            attempt === 0
              ? undefined
              : [
                  `This is retry ${attempt}. The previous draft failed hard quality checks (${failedProblemCodes.join(", ") || "unknown"}).`,
                  placeholderFailure
                    ? "The previous draft contained scaffold/meta-instruction text. Replace it with final learner-facing explanation; do not include notes about what to insert, add, fill in, expand, cover, or explain later."
                    : "",
                  'Write a longer, deeper, fully-written lesson (at least 700 words) with a concrete example and a real Question./Answer. Teach the concept directly; never comment on "the paper" or "the source".',
                ]
                  .filter(Boolean)
                  .join(" ");

          let attemptBody: string | null = null;
          try {
            const generated = await callCouncilText({
              client,
              model,
              taskType: "subsection_generation",
              gardenId,
              pageId,
              system: withSyllabusRules(
                SUBSECTION_PROMPT,
                SYLLABUS_PAGE_RULES,
                Boolean(context.syllabus),
              ),
              user: compactJson({
                task: "write_subsection",
                dossier: pageDossier,
                instructions: {
                  style: "flowing beginner-friendly textbook subsection",
                  sourceAware: true,
                  includeQuestions: true,
                  includeVisualsWhereRelevant: true,
                },
                ...(retryNote ? { retryNote } : {}),
              }),
              sourceContext: { ...pageSourceMeta, taskType: "subsection_generation" },
              councilModeOverride: LEARN_GENERATION_COUNCIL_MODE,
            });
            subsectionRunId = generated.councilRunId;
            attemptBody = cleanCouncilMarkdown(generated.content, "").trim() || null;
          } catch {
            attemptBody = null;
          }
          // Generation failed outright: do not substitute fallback prose.
          if (!attemptBody) continue;

          // Developer-only escape hatch. Off by default: revision normally
          // happens only when the deterministic gate below hard-fails.
          if (LEARN_ENABLE_UNCONDITIONAL_REVISION) {
            try {
              const revised = await callCouncilText({
                client,
                model,
                taskType: "full_page_revision",
                gardenId,
                pageId,
                system: REVISION_PROMPT,
                user: compactJson({ pageMarkdown: attemptBody, sourceOnly, dossier: pageDossier }),
                sourceContext: { ...pageSourceMeta, taskType: "full_page_revision" },
                councilModeOverride: LEARN_REVISION_COUNCIL_MODE,
              });
              revisionRunId = revised.councilRunId;
              // Revision failure keeps the generated body; never the fallback.
              attemptBody = cleanCouncilMarkdown(revised.content, attemptBody);
            } catch {
              // Keep the generated attempt body.
            }
          }

          let quality = assessModelAuthoredLessonQuality(attemptBody, {
            assignedVisualUrls,
            unavailableCitations: unavailableCitationGate,
            subsection,
            canonicalSourceAnchors: selectedCanonicalSourceAnchors,
          });

          // Hard-fail-only repair: one focused call that fixes the listed
          // problems in place. Minor style issues never trigger a rewrite.
          if (quality.hardFail) {
            try {
              const repaired = await callCouncilText({
                client,
                model,
                taskType: "subsection_repair",
                gardenId,
                pageId,
                system: SUBSECTION_REPAIR_PROMPT,
                user: compactJson({
                  pageMarkdown: attemptBody,
                  failedProblems: quality.problems
                    .filter((problem) => problem.hard)
                    .map(formatQualityProblemForRepair),
                  dossier: pageDossier,
                  repairRules: [
                    "Fix only the listed hard failures.",
                    "Preserve correct existing content.",
                    "Do not restart from scratch unless the page is unusable.",
                    "Keep the section flowing and beginner-friendly.",
                    "Replace placeholder/meta-instruction text with finished learner-facing prose.",
                    "Remove empty or ellipsis-only bullets instead of returning scaffold bullets.",
                    "Keep source-only constraints.",
                    "Keep assigned visuals embedded where relevant.",
                    ...(unavailableCitationGate
                      ? [
                          "If unavailable-citation is listed, the page wrote about a work this garden does not contain. Delete every sentence that names, summarizes, or draws on it, and re-teach that point from the dossier's own source snippets — or drop the point entirely. Never replace it with a rephrased version of the same claim.",
                        ]
                      : []),
                    "Return only the final markdown.",
                  ],
                }),
                sourceContext: {
                  ...pageSourceMeta,
                  taskType: "subsection_repair",
                  failedProblemCount: quality.problems.length,
                },
                councilModeOverride: LEARN_REVISION_COUNCIL_MODE,
              });
              revisionRunId = repaired.councilRunId ?? revisionRunId;
              attemptBody = cleanCouncilMarkdown(repaired.content, attemptBody);
              quality = assessModelAuthoredLessonQuality(attemptBody, {
                assignedVisualUrls,
                unavailableCitations: unavailableCitationGate,
                subsection,
                canonicalSourceAnchors: selectedCanonicalSourceAnchors,
              });
            } catch {
              // Keep the model draft and let the hard gate decide.
            }
          }
          lastQuality = quality;
          lastAttemptBody = attemptBody;
          if (!quality.hardFail) {
            pageBody = attemptBody;
            break;
          }
        }

        throwIfLearnCancelled(job.id);
        if (pageBody === null) {
          // Quarantine the last draft for a human to inspect, then fail the job.
          // No fallback learner page is ever written.
          try {
            const debugRelPath = `.breadboard/debug/failed-pages/${safeLearnFileSegment(pageId, "page").replace(/\s+/g, "-")}.md`;
            const debugContent = lastAttemptBody ?? "";
            writeMarkdownWithBackup({
              clusterDir,
              relPath: debugRelPath,
              textbookVersionId,
              content: `<!-- FAILED QUALITY GATES — NOT A LEARNER PAGE -->\n\n${debugContent}\n`,
            });
          } catch {
            // Debug quarantine is best-effort; failing the job is what matters.
          }
          throw new Error(
            `Lesson "${pageTitle}" failed quality gates after ${MAX_PAGE_ATTEMPTS} attempts (${(lastQuality?.problems ?? [])
              .filter((problem) => problem.hard)
              .map((problem) =>
                problem.evidence?.length
                  ? `${problem.message} [${problem.evidence.map((line) => JSON.stringify(line)).join(", ")}]`
                  : problem.message,
              )
              .join("; ") || "no usable draft produced"}). No fallback learner page was written.`,
          );
        }

        updateLearnJob(job.id, {
          status: "generating_visuals",
          currentStep: "Reconciling interactive visuals",
          currentSectionTitle: sectionTitle,
          currentPageTitle: pageTitle,
        });
        // Stage 6: validated, ID-consistent, plan-selected interactives only.
        const visualized = await reconcileInteractiveVisuals({
          client,
          model,
          contentPath: artifactContentPath,
          gardenId,
          jobId: job.id,
          textbookVersionId,
          pageId,
          pageRelPath,
          markdown: pageBody,
          subsection,
          sourceContext: pageDossier,
          sourceFigures: interactiveSourceFigures,
          visualizationPlan,
          visualizationOutcomes,
        });
        pageBody = visualized.markdown;
        throwIfLearnCancelled(job.id);

        // Stage 7: public tags are the registry-backed union of primary and
        // supporting concepts. Readable claims remain in the claim store.
        const plannedConcepts = subsection.semanticConcepts ?? [];
        const primaryConcepts = plannedConcepts
          .filter((concept) => concept.role === "primary")
          .map((concept) => concept.slug);
        const supportingConcepts = plannedConcepts
          .filter((concept) => concept.role === "supporting")
          .map((concept) => concept.slug)
          .filter((slug) => !primaryConcepts.includes(slug));
        const zettelTags = [...new Set([...primaryConcepts, ...supportingConcepts])].slice(0, 5);
        const claimIds = (subsection.knowledgeClaims ?? []).map((claim) =>
          claimIdForPlan(subsection.learningUnitId ?? pageId, claim),
        );
        const assignedVisualIds = assignedVisuals.map((visual) => visual.sourceVisualId);
        const formulas = formulaGroundingEntries(
          subsection.sourceFormulaContracts ?? [],
          selectedCanonicalSourceAnchors,
        );
        for (const formula of formulas) {
          if (!formula.sourceAnchor) continue;
          if (!sourceFormulaIdentityById.has(formula.sourceAnchor)) {
            throw new Error(`Formula page pre-write guard: ${formula.sourceAnchor} has no verified unit identity.`);
          }
        }
        const finalContent =
          buildLearningPageFrontmatter({
            gardenId,
            sectionNumber,
            subsectionNumber,
            title: pageTitle,
            sourceAnchors: anchors,
            tags: zettelTags,
            primaryConcepts,
            supportingConcepts,
            claimIds,
            visualIds: visualized.visualIds,
            sourceVisualIds: assignedVisualIds,
            sourceFormulaAnchors: metricFormulaAnchorIds,
            formulas,
            learningUnitId: subsection.learningUnitId,
            learningUnitRole: subsection.learningUnitRole,
            learningVersionId: textbookVersionId,
            sourceSetHash: context.sourceSetHash,
            sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
            generatedAt,
          }) + `${pageBody.trim()}\n`;

        updateLearnJob(job.id, {
          status: "writing_quartz",
          currentStep: "Writing Quartz Markdown",
          currentSectionTitle: sectionTitle,
          currentPageTitle: pageTitle,
        });
        throwIfLearnCancelled(job.id);
        writeMarkdownWithBackup({
          clusterDir,
          relPath: pageRelPath,
          content: finalContent,
          textbookVersionId,
        });
        for (const visual of assignedVisuals) {
          visualAssignments.set(visual.sourceVisualId, {
            pageId,
            sectionId: sectionFolder,
          });
        }
        generatedPages.push({
          title: pageTitle,
          relPath: pageRelPath,
          learningUnitId: subsection.learningUnitId,
          sourceAnchors: anchors,
          visualIds: visualized.visualIds,
          sourceFigureIds: assignedVisualIds,
          sourceFormulaIds: metricFormulaAnchorIds,
          sourceTableIds: (subsection.sourceTableContracts ?? []).map((table) => table.id),
        });
        appendLearnEvent(contentPath, gardenId, "learn_page_written", {
          jobId: job.id,
          textbookVersionId,
          pageId,
          councilRunId: revisionRunId ?? subsectionRunId,
          sourceIds: context.sources.map((source) => source.slug),
        });
        completed += 1;
      }
    }

    // The contract owns claim semantics; once every final page path exists,
    // project those claims verbatim into the canonical store and require each
    // page's claimIds to match. No claim is derived from prose or zettel notes.
    const claimProjectionPages = generatedPages.map((page) => {
      if (!page.learningUnitId) {
        throw new Error(`Model-authored claim projection failed: ${page.relPath} has no learningUnitId.`);
      }
      return { learningUnitId: page.learningUnitId, relPath: page.relPath };
    });
    const claimProjection = projectModelAuthoredClaimsToStore({
      gardenDir: clusterDir,
      gardenId,
      sourceSetHash: context.sourceSetHash,
      units: confirmedLearningUnits,
      pages: claimProjectionPages,
    });
    appendLearnEvent(contentPath, gardenId, "learn_model_authored_claims_projected", {
      jobId: job.id,
      textbookVersionId,
      claimCount: claimProjection.claimCount,
      pageCount: claimProjection.pageCount,
      changedFiles: claimProjection.changedFiles,
    });

    // Stale-artifact cleanup: the visual index merges on every save, so IDs
    // from earlier runs linger. Rewrite it to exactly the interactive visuals
    // this run embedded, and delete orphan spec files, so the index never
    // advertises a visual no current page references.
    throwIfLearnCancelled(job.id);
    {
      const liveVisualIds = new Set(generatedPages.flatMap((page) => page.visualIds));
      const pruned = pruneVisualArtifacts(artifactContentPath, gardenId, liveVisualIds);
      if (pruned.removedFromIndex.length > 0 || pruned.removedSpecFiles.length > 0) {
        appendLearnEvent(contentPath, gardenId, "learn_visual_index_pruned", {
          jobId: job.id,
          textbookVersionId,
          removedFromIndex: pruned.removedFromIndex,
          removedSpecFiles: pruned.removedSpecFiles,
        });
      }
    }

    if (!visualizationPlan) throw new Error("Visualization plan was not initialized.");
    saveVisualizationPlan(clusterDir, visualizationPlan);
    const visualizationCoverage = buildVisualizationCoverageReport({
      plan: visualizationPlan,
      outcomes: visualizationOutcomes,
      gate: coverageGateMode(),
    });
    saveVisualizationCoverageReport(clusterDir, visualizationCoverage);
    appendLearnEvent(contentPath, gardenId, "visual_coverage_completed", {
      jobId: job.id,
      textbookVersionId,
      ...visualizationCoverage,
    });
    if (visualizationCoverage.trustedVisualsPublished + visualizationCoverage.generatedVisualsPublished === 0) {
      appendLearnEvent(contentPath, gardenId, "visual_zero_publish_warning", {
        jobId: job.id,
        textbookVersionId,
        opportunitiesDetected: visualizationCoverage.opportunitiesDetected,
        explanations: visualizationCoverage.explanations,
      });
    }
    if (visualizationCoverage.status === "fail") {
      throw new Error(
        `Visualization coverage gate failed: ${visualizationCoverage.explanations.join(" ") || "critical opportunities are uncovered"}`,
      );
    }

    // Stage 3 closeout: every extracted visual is either assigned to the page
    // that embedded it, taught from its canonical text identity, or omitted
    // with the planning model's exact reason. This is an exact projection of
    // the validated partition; closeout never authors a fallback rationale.
    const authoredArtifactDispositionReason = new Map<string, string>();
    for (const assignment of confirmedSourceArtifactAssignments) {
      authoredArtifactDispositionReason.set(
        assignment.sourceArtifactId,
        assignment.requiredInterpretation || assignment.reason,
      );
    }
    for (const omission of confirmedSourceArtifactOmissions) {
      authoredArtifactDispositionReason.set(omission.sourceArtifactId, omission.reason);
    }
    const finalLedger = recordSourceVisualAssignments(
      artifactContentPath,
      gardenId,
      visualAssignments,
      (visual) => authoredArtifactDispositionReason.get(visual.sourceVisualId) ?? "",
      {
        conceptAnchorIds: generatedPages.flatMap((page) => page.sourceFormulaIds),
        trackedArtifactIds: context.sourceFigures.map((figure) => figure.figureId),
      },
    );
    for (const visual of finalLedger) {
      if (visual.usageStatus === "intentionally_skipped" && visual.skipReason) {
        unusedFigureReasons.set(visual.sourceVisualId, visual.skipReason);
      }
    }

    throwIfLearnCancelled(job.id);
    writeMarkdownWithBackup({
      clusterDir,
      relPath: ".breadboard/planning/Source Coverage.md",
      textbookVersionId,
      content:
        learningPageFrontmatter(
          "Source Coverage",
          "source-coverage",
          gardenId,
          textbookVersionId,
          context.sourceSetHash,
        ) +
        sourceCoverageMarkdown({
          context,
          generatedPages,
          unusedFigureReasons,
          sourceArtifactAssignments: confirmedSourceArtifactAssignments,
        }),
    });

    updateLearnJob(job.id, {
      status: "building_navigation",
      currentStep: "Refreshing Quartz navigation",
      progressPercent: 95,
      currentSectionTitle: undefined,
      currentPageTitle: undefined,
    });
    throwIfLearnCancelled(job.id);
    refreshClusterIndex(artifactContentPath, gardenId, { migrateSources: false });

    updateLearnJob(job.id, {
      status: "building_navigation",
      currentStep: "Repairing semantic lesson issues",
      progressPercent: 96,
      currentSectionTitle: undefined,
      currentPageTitle: undefined,
    });
    throwIfLearnCancelled(job.id);
    // Learner-facing repair is model-only. Validation remains deterministic;
    // a rejected or unavailable model candidate leaves the blocker visible.
    const repairExecutorMode = "model" as const;
    // Stages 8a+8b (repair -> export finalize -> verify) run as a bounded
    // convergence loop instead of a single pass followed by a hard fail. Each
    // pass repairs the flagged pages with a model candidate, then validates
    // the on-disk tree exactly as Quartz
    // sees it, and verifies it. When the deterministic gate still finds
    // problems, ChatMock gets another focused pass: `collectUnitRepairRequests`
    // re-derives requests from exactly what still fails, and re-running the
    // repair loop also refreshes the repair-log so a page fixed by a later
    // deterministic pass is not blocked by a stale "unresolved" record. The
    // loop only gives up (and the terminal throw below fires) once ChatMock can
    // no longer make progress, so a healthy model self-heals gate failures
    // rather than ending generation on the first attempt.

    // Stage 7a (structural generation freeze): a Learn run must own exactly ONE
    // active generation before any semantic reconciliation. If a previous
    // generation's learner tree is still on disk (in-place generation left the
    // old pages behind), it now coexists with this run's pages — producing
    // duplicate unit mappings, obsolete unknown-unit pages (e.g. a dropped U24),
    // and stale-claim/tag cascades that the finalizer would otherwise surface as
    // a terminal "failed critical validation". This deterministic pass keeps the
    // pages whose embedded learningVersionId is THIS run's version and quarantines
    // every page from any other generation (and any page whose unit is not in the
    // current contract) out of the active tree, then removes emptied section
    // folders. It never consults modification time and never calls ChatMock; with
    // a single generation present it is a no-op.
    try {
      const generationFreeze = freezeActiveGenerationByVersion(clusterDir, confirmedLearningUnits, {
        currentVersion: publicLearningVersionId(textbookVersionId),
      });
      if (generationFreeze.changed) {
        appendLearnEvent(contentPath, gardenId, "learn_generation_freeze_completed", {
          jobId: job.id,
          textbookVersionId,
          currentVersion: generationFreeze.currentVersion,
          versionsSeen: generationFreeze.versionsSeen,
          pagesKept: generationFreeze.pagesKept.length,
          pagesQuarantined: generationFreeze.pagesQuarantined.length,
          staleSectionsRemoved: generationFreeze.staleSectionsRemoved,
          reason: generationFreeze.reason,
        });
      }
    } catch (freezeError) {
      appendLearnEvent(contentPath, gardenId, "learn_generation_freeze_skipped", {
        jobId: job.id,
        reason: freezeError instanceof Error ? freezeError.message : String(freezeError),
      });
    }

    // Canonical build-state migration is opt-in and diagnostic. Both `shadow`
    // and the reserved `canonical` value keep the legacy pipeline authoritative
    // in this phase: canonical state is imported, repaired in memory, rendered
    // outside the live garden, and parity diagnostics are written under
    // .breadboard/canonical-shadow. It never publishes or changes learner files.
    const buildStateMode = learnBuildStateMode();
    if (buildStateMode !== "legacy") {
      try {
        const shadow = await runCanonicalGardenShadowBuild(clusterDir, gardenId, {
          enableModelRepairs: false,
          writeDiagnostics: true,
        });
        appendLearnEvent(contentPath, gardenId, "learn_canonical_shadow_completed", {
          jobId: job.id,
          textbookVersionId,
          requestedMode: buildStateMode,
          buildId: shadow.repairedState.buildId,
          importedIssueCount: shadow.importIssues.length,
          typedAtSourceIssueCount: shadow.issueMetrics.typedAtSource,
          legacyAdapterIssueCount: shadow.issueMetrics.producedByLegacyAdapter,
          canonicalBlockerCount: shadow.finalIssues.filter((issue) => issue.severity === "blocking").length,
          canonicalWarningCount: shadow.finalIssues.filter((issue) => issue.severity !== "blocking").length,
          transactionCount: shadow.transactions.length,
          canonicalDeterministicRepairs: shadow.deterministicRepairCount,
          canonicalVerifiedModelRepairs: shadow.verifiedModelRepairCount,
          projectionIssueCount: shadow.projection?.issues.length ?? 0,
          semanticParityDifferenceCount: shadow.parity.semanticParityDifferenceCount,
          unexpectedRegressionCount: shadow.parity.unexpectedRegressionCount,
          acceptanceDisagreement: shadow.parity.acceptanceDisagreement,
          acceptedSnapshotCreated: Boolean(shadow.snapshot),
          stoppedReason: shadow.stoppedReason,
        });
      } catch (shadowError) {
        appendLearnEvent(contentPath, gardenId, "learn_canonical_shadow_failed", {
          jobId: job.id,
          textbookVersionId,
          requestedMode: buildStateMode,
          diagnosticOnly: true,
          reason: shadowError instanceof Error ? shadowError.message : String(shadowError),
        });
      }
    }

    // Final repair is an L3 local-write loop: let repair continue while the
    // meaningful garden state is changing, but bound it by both rounds and
    // wall-clock time. Reports, logs, and events are excluded from the audit
    // fingerprint, so bookkeeping churn cannot masquerade as repair progress.
    const finalizeLoopStartedAt = Date.now();
    const seenFailedStates = new Set<string>();
    let repairRun!: Awaited<ReturnType<typeof repairLearningUnitsFromContract>>;
    let finalizeReport!: ReturnType<typeof finalizeGardenExport>;
    let verification!: ReturnType<typeof verifyFinalArtifactNoMutation>;
    let passesUsed = 0;
    let lastStateFingerprint: string | undefined;
    let lastBlockerFingerprint: string | undefined;
    let finalizationStopReason: "passed" | "no_progress" | "max_rounds" | "max_runtime" = "max_rounds";
    for (let pass = 1; pass <= LEARN_FINALIZE_MAX_ROUNDS; pass += 1) {
      // Cancellation remains authoritative even when the retry budget has also
      // expired. A started pass is allowed to reach verification; the runtime
      // cap prevents starting another potentially expensive repair pass.
      throwIfLearnCancelled(job.id);
      if (pass > 1) {
        if (Date.now() - finalizeLoopStartedAt >= LEARN_FINALIZE_MAX_RUNTIME_MS) {
          finalizationStopReason = "max_runtime";
          break;
        }
        updateLearnJob(job.id, {
          status: "building_navigation",
          currentStep: `Repairing remaining lesson issues (pass ${pass})`,
          progressPercent: 96,
          currentSectionTitle: undefined,
          currentPageTitle: undefined,
        });
      }
      passesUsed = pass;
      repairRun = await repairLearningUnitsFromContract({
        gardenDir: clusterDir,
        gardenSlug: gardenId,
        repairExecutor: repairExecutorMode,
        preserveModelAuthoredVisuals: true,
        preserveModelAuthoredContent: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
        // Repair is model-only: there is no deterministic executor to fall back
        // to, so the repair pass always carries a live model executor.
        modelRepair: createOpenAIRepairExecutor({
          client,
          model,
          gardenId,
          timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
          sourceTextForRequest: (request) => exactCanonicalRepairSourceText(clusterDir, request),
        }),
      });
      appendLearnEvent(contentPath, gardenId, "learn_semantic_repair_completed", {
        jobId: job.id,
        textbookVersionId,
        pass,
        repairExecutorMode,
        requestCount: repairRun.requests.length,
        repairCount: repairRun.repairs.length,
        modelRepairCount: repairRun.repairs.filter((entry) => entry.executorUsed === "model").length,
        unresolvedCount: repairRun.repairs.filter((entry) => entry.result === "unresolved").length,
        changedFiles: repairRun.changedFiles,
      });

      // Validation-only export finalize + hard gate. Structural paths and
      // projections may be normalized, but learner content remains model-owned.
      throwIfLearnCancelled(job.id);
      finalizeReport = finalizeGardenExport({
        gardenDir: clusterDir,
        gardenSlug: gardenId,
        preserveModelAuthoredContent: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
      });
      appendLearnEvent(contentPath, gardenId, "learn_export_finalized", {
        jobId: job.id,
        textbookVersionId,
        pass,
        removed: finalizeReport.removed,
        changedCount: finalizeReport.changed.length,
        criticalProblems: finalizeReport.criticalProblems,
        warnings: finalizeReport.warnings,
      });
      verification = verifyFinalArtifactNoMutation({
        gardenDir: clusterDir,
        gardenSlug: gardenId,
        strictModelApprovedVisuals: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
      });
      appendLearnEvent(contentPath, gardenId, "learn_final_artifact_verified", {
        jobId: job.id,
        textbookVersionId,
        pass,
        accepted: verification.accepted,
        mutatedFiles: verification.mutatedFiles,
        validationFailures: verification.validationFailures,
        unresolvedRepairFailures: verification.unresolvedRepairFailures,
      });

      const audit = auditGardenForFinalization(clusterDir, gardenId, {
        strictModelApprovedVisuals: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
      });
      lastStateFingerprint = audit.stateFingerprint;
      if (finalizeReport.criticalProblems.length === 0 && verification.accepted) {
        finalizationStopReason = "passed";
        break;
      }

      const blockerSignature = JSON.stringify(
        [...new Set([
          ...finalizeReport.criticalProblems,
          ...verification.validationFailures,
          ...verification.unresolvedRepairFailures,
          ...verification.mutatedFiles.map((file) => `mutated during verification: ${file}`),
        ].map((problem) => problem.trim()).filter(Boolean))].sort(),
      );
      const blockerFingerprint = createHash("sha256").update(blockerSignature).digest("hex");
      lastBlockerFingerprint = blockerFingerprint;
      const failedStateKey = `${blockerFingerprint}:${audit.stateFingerprint}`;

      // Retry when either the blockers or meaningful on-disk state changed.
      // Repeating the same pair proves a fixed point (or a cycle returning to
      // one), so another model call would only spend tokens without progress.
      if (seenFailedStates.has(failedStateKey)) {
        finalizationStopReason = "no_progress";
        break;
      }
      seenFailedStates.add(failedStateKey);

      if (Date.now() - finalizeLoopStartedAt >= LEARN_FINALIZE_MAX_RUNTIME_MS) {
        finalizationStopReason = "max_runtime";
        break;
      }
      if (pass >= LEARN_FINALIZE_MAX_ROUNDS) {
        finalizationStopReason = "max_rounds";
        break;
      }

      appendLearnEvent(contentPath, gardenId, "learn_finalization_retry_scheduled", {
        jobId: job.id,
        textbookVersionId,
        pass,
        nextPass: pass + 1,
        blockerFingerprint,
        stateFingerprint: audit.stateFingerprint,
        elapsedMs: Date.now() - finalizeLoopStartedAt,
      });
    }

    appendLearnEvent(
      contentPath,
      gardenId,
      finalizationStopReason === "passed"
        ? "learn_finalization_loop_completed"
        : "learn_finalization_loop_stopped",
      {
        jobId: job.id,
        textbookVersionId,
        stoppedReason: finalizationStopReason,
        passesUsed,
        maxRounds: LEARN_FINALIZE_MAX_ROUNDS,
        elapsedMs: Date.now() - finalizeLoopStartedAt,
        maxRuntimeMs: LEARN_FINALIZE_MAX_RUNTIME_MS,
        stateFingerprint: lastStateFingerprint,
        blockerFingerprint: lastBlockerFingerprint,
      },
    );

    // Surface incomplete source-formula extraction as a distinct, non-blocking
    // signal so the cause (usually the vision model being unavailable at
    // extraction time) is visible rather than silently publishing ungrounded
    // formulas. Re-running extraction with the vision model recovers them. The
    // full text is also written to .breadboard/validation-report.md under
    // "Non-blocking warnings".
    if (finalizeReport.warnings.length > 0) {
      appendLearnEvent(contentPath, gardenId, "learn_source_formula_extraction_incomplete", {
        jobId: job.id,
        textbookVersionId,
        warnings: finalizeReport.warnings,
      });
    }

    if (finalizeReport.criticalProblems.length > 0) {
      // Fix 6: when the blocker is unregistered source anchors, lead with the
      // clear, actionable explanation before the raw audit lines.
      const missingAnchors = missingRegistryAnchorIds(finalizeReport.criticalProblems);
      const anchorGuidance = missingAnchors.length > 0 ? `${describeMissingAnchorFailure(missingAnchors)}\n\n` : "";
      throw new Error(
        `${anchorGuidance}Export finalize failed critical validation for ${gardenId}: ${finalizeReport.criticalProblems.join("; ")}. ` +
          "The garden was not published. See .breadboard/validation-report.md and .breadboard/repair-report.md.",
      );
    }
    if (!verification.accepted) {
      throw new Error(
        `Export verification failed for ${gardenId}: ${
          [
            ...verification.validationFailures,
            ...verification.unresolvedRepairFailures,
            ...verification.mutatedFiles.map((file) => `mutated during verification: ${file}`),
          ].join("; ") || "final artifact was not accepted"
        }. The garden was not published. See .breadboard/validation-report.md and .breadboard/repair-report.md.`,
      );
    }

    // Stage 8c (end-stage semantic critic): ChatMock reviews the FINAL exported
    // state and drives targeted repair rounds. When enabled, critic acceptance
    // is a publication gate alongside deterministic validation; an unavailable
    // critic or unresolved blocker leaves the published garden untouched.
    try {
      if ((process.env.BREADBOARD_CRITIC_ENABLED ?? "true").trim() !== "false") {
        // The model rewrites any flagged semantic content. Structural validators
        // re-audit the result without substituting heuristic lesson prose or a
        // canned visual contract for a rejected candidate.
        const modelRepair = createChatMockModelRepair({ client, model, timeoutMs: LEARN_PLANNING_TIMEOUT_MS });
        const criticLoop = await runCriticLoop({
          gardenDir: clusterDir,
          gardenSlug: gardenId,
          critic: createChatMockCritic({ client, model, timeoutMs: LEARN_PLANNING_TIMEOUT_MS }),
          // Low-confidence generated source anchors are sent to ChatMock to
          // confirm, replace, create a better anchor, or reject — inside the
          // same critic-loop rounds. Unresolved ones keep publishReady false.
          anchorConfirm: createChatMockAnchorCritic({ client, model, timeoutMs: LEARN_PLANNING_TIMEOUT_MS }),
          repair: makeCriticArtifactRepair({ modelRepair, allowDeterministicRepairs: false }),
          // Let the loop audit the live state so anchor resolution counts toward
          // publish-readiness. Deterministic critical failures already threw above.
          structuralFailure: false,
          // Fix 2: this is FINALIZATION on a migrated ledger — any legacy
          // text_concept record still unresolved keeps the garden out of
          // publish-ready, derived from the ledger (never a migration report).
          enforceLegacyFinalization: true,
        });
        appendLearnEvent(contentPath, gardenId, "learn_critic_loop_completed", {
          jobId: job.id,
          textbookVersionId,
          draftGenerated: criticLoop.status.draftGenerated,
          lifecycleStatus: criticLoop.status.lifecycleStatus,
          accepted: criticLoop.status.accepted,
          publishReady: criticLoop.status.publishReady,
          deterministicPass: criticLoop.status.deterministicPass,
          criticRequired: criticLoop.status.criticRequired,
          criticAvailabilityStatus: criticLoop.status.criticAvailabilityStatus,
          criticPass: criticLoop.status.criticPass,
          rounds: criticLoop.rounds.length,
          unresolvedBlocking: criticLoop.finalBlockingIssues.length,
          warnings: criticLoop.finalWarnings.length,
          reason: criticLoop.status.reason,
        });
        if (!criticLoop.status.publishReady || criticLoop.finalBlockingIssues.length > 0) {
          throw new Error(
            `Semantic critic did not approve publication: ${criticLoop.status.reason || `${criticLoop.finalBlockingIssues.length} blocking issue(s) remain`}.`,
          );
        }
      }
    } catch (criticError) {
      appendLearnEvent(contentPath, gardenId, "learn_critic_loop_failed", {
        jobId: job.id,
        reason: criticError instanceof Error ? criticError.message : String(criticError),
      });
      throw criticError;
    }

    throwIfLearnCancelled(job.id);
    mergeLearnEventLedgers(repositoryGardenDir, clusterDir);
    updateLearnJobExpectStatus(job.id, {
      status: "writing_quartz",
      currentStep: "Publishing validated garden",
      progressPercent: 99,
    });
    committingLearnJobs.add(job.id);
    const promotion = await promoteStagingGarden({
      stagingGardenDir: clusterDir,
      destinationGardenDir: repositoryGardenDir,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: job.id,
      verifyCurrentDestination: (destinationDir) =>
        lease.heartbeat() &&
        fingerprintDurableGardenState(destinationDir) === workspace!.durableInputFingerprint,
      prepareIncomingForCommit: (incomingDir, destinationDir) => {
        mergeLearnEventLedgers(destinationDir, incomingDir);
        return true;
      },
      verifyManifest: (candidateDir) =>
        verifyFinalArtifactNoMutation({
          gardenDir: candidateDir,
          gardenSlug: gardenId,
          strictModelApprovedVisuals: true,
          expectedVisualContractExecutabilityContext: generationExecutabilityContext,
          expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
        }).accepted,
    });
    previousPromotedGardenDir = promotion.previousPreservedAt;
    if (!promotion.promoted) {
      throw new LearnPipelineConflictError(
        `Validated Learn output was not published: ${promotion.reason}`,
      );
    }
    await publishQuartzAfterMutation(`learn textbook generation in ${gardenId}`, {
      requireSuccess: true,
    });
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease after Quartz publication.",
      );
    }

    appendLearnEvent(contentPath, gardenId, "learn_generation_completed", {
      jobId: job.id,
      textbookVersionId,
      pageCount: generatedPages.length,
      sourceIds: context.sources.map((source) => source.slug),
    });
    const mapToCommit = map;
    const finalJob = db.transaction(() => {
      const mapUpdate = db.prepare(
        `UPDATE learn_maps
         SET coverage_plan_json = ?, learning_map_json = ?, proposed_order_json = ?
         WHERE id = ? AND garden_id = ? AND status = 'confirmed'
           AND source_set_hash = ? AND source_artifact_inventory_hash = ?`,
      ).run(
        jsonString(mapToCommit.coveragePlan),
        jsonString(mapToCommit.learningMap),
        jsonString(mapToCommit.proposedOrder),
        mapToCommit.id,
        gardenId,
        mapToCommit.sourceSetHash,
        mapToCommit.sourceArtifactInventoryHash,
      );
      if (mapUpdate.changes !== 1) {
        throw new LearnPipelineConflictError(
          "The confirmed Learning Map disappeared before generation could commit.",
        );
      }
      insertLearnVersion({
        id: textbookVersionId,
        gardenId,
        jobId: job.id,
        learningMapId: mapToCommit.id,
        sourceSetHash: context.sourceSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
        pageCount: generatedPages.length + learningRelPaths.length + 1,
        backupDir,
      });
      return updateLearnJobExpectStatus(job.id, {
        status: "complete",
        currentStep: "Lessons complete",
        progressPercent: 100,
        confirmedLearningMapId: mapToCommit.id,
        latestTextbookVersionId: textbookVersionId,
        sourceSetHash: context.sourceSetHash,
      });
    })();
    // Filesystem publication, Quartz, and the SQLite version/job pair are now
    // committed. Everything after this point is best-effort garbage collection
    // and must never turn a successful run into a failed/rolled-back one.
    promotionCommitted = true;
    if (previousPromotedGardenDir && lease.heartbeat()) {
      try {
        fs.rmSync(previousPromotedGardenDir, { recursive: true, force: true });
        previousPromotedGardenDir = undefined;
      } catch (cleanupError) {
        console.warn(
          `[learn] Previous published garden remains at ${previousPromotedGardenDir}:`,
          cleanupError,
        );
      }
    }
    return {
      job: finalJob,
      textbookVersionId,
      pageCount: generatedPages.length,
    };
  } catch (error) {
    if (
      lease.lost ||
      leaseLostLearnJobs.has(job.id) ||
      !lease.heartbeat()
    ) {
      throw error;
    }
    if (previousPromotedGardenDir && !promotionCommitted) {
      let restored = false;
      try {
        await restorePreviousPromotedGarden(
          repositoryGardenDir,
          previousPromotedGardenDir,
          () => lease.heartbeat(),
        );
        if (!lease.heartbeat()) {
          throw new LearnPipelineConflictError(
            "Learn generation lost its lease after restoring the previous garden.",
          );
        }
        previousPromotedGardenDir = undefined;
        restored = true;
      } catch (restoreError) {
        appendLearnEvent(contentPath, gardenId, "learn_publication_restore_failed", {
          jobId: job.id,
          error: restoreError instanceof Error ? restoreError.message : String(restoreError),
        });
        updateLearnJob(job.id, {
          status: "writing_quartz",
          currentStep: "Filesystem restore pending retry",
          error: errorMessage(restoreError),
        });
        throw restoreError;
      }
      if (restored) {
        const publicationToken = queueLearnPublicationRetry(
          gardenId,
          "restored failed Learn generation",
          new Error("Publication pending"),
        );
        try {
          await publishQuartzAfterMutation(
            `rolled back failed Learn generation in ${gardenId}`,
            { requireSuccess: true },
          );
          clearLearnPublicationRetry(gardenId, publicationToken);
        } catch (republishError) {
          queueLearnPublicationRetry(
            gardenId,
            "restored failed Learn generation",
            republishError,
          );
          appendLearnEvent(contentPath, gardenId, "learn_publication_republish_queued", {
            jobId: job.id,
            error: errorMessage(republishError),
          });
        }
      }
    }
    if (isLearnCancellation(job.id, error)) {
      // The Stop button already flipped the job to cancelled; sweep any
      // partial Learn output that was written before the checkpoint fired.
      try {
        const cleanup = await cleanupLearnArtifactsAfterCancel({
          gardenId,
          contentPath,
          jobId: job.id,
          lease,
        });
        updateLearnJob(job.id, {
          status: "cancelled",
          currentStep: "Cancelled; latest Learn changes rolled back",
        });
        discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
        appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
          jobId: job.id,
          removedPathCount: cleanup.removedPaths.length,
          restoredPathCount: cleanup.restoredPaths.length,
          deletedMaps: cleanup.deletedMaps,
          deletedVersions: cleanup.deletedVersions,
        });
      } catch {
        // Cleanup is best-effort during unwind; the cancel endpoint reports its
        // own cleanup errors when the user presses Stop.
      }
      throw new LearnCancelledError();
    }
    const message = errorMessage(error, "Lesson generation failed");
    const failedJob = getLatestLearnJob(gardenId);
    const lastInternalStep = failedJob?.id === job.id ? failedJob.currentStep.trim() : "";
    appendLearnEvent(contentPath, gardenId, "learn_failed", {
      jobId: job.id,
      textbookVersionId,
      error: message,
    });
    updateLearnJob(job.id, {
      status: "failed",
      currentStep: lastInternalStep
        ? `Lesson generation failed; last internal step: ${lastInternalStep}`
        : "Lesson generation failed",
      error: message,
    });
    throw error;
  } finally {
    committingLearnJobs.delete(job.id);
    disposeModelTracking();
    if (workspace) disposeLearnBuildWorkspace(workspace);
    if (ownsLease) lease.release();
  }
}

export interface FullRebuildOptions {
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  includedSourceIds?: readonly string[];
  /** Slug of an uploaded document to use as the course study guide. */
  syllabusSourceId?: string | null;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  /** Destructive confirmation. The literal true is required at runtime too. */
  forceFullRebuild: true;
}

function mergeLearnEventLedgers(repositoryGardenDir: string, stagingGardenDir: string): void {
  const relative = path.join(".breadboard", "events.jsonl");
  const livePath = path.join(repositoryGardenDir, relative);
  const stagingPath = path.join(stagingGardenDir, relative);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const eventPath of [livePath, stagingPath]) {
    let raw = "";
    try {
      raw = fs.readFileSync(eventPath, "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line || seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  if (lines.length === 0) return;
  fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
  fs.writeFileSync(stagingPath, `${lines.join("\n")}\n`, "utf-8");
}

async function restorePreviousPromotedGarden(
  destinationGardenDir: string,
  previousGardenDir?: string,
  ownsLease?: () => boolean,
): Promise<void> {
  const failedDir = path.join(
    path.dirname(destinationGardenDir),
    `.${path.basename(destinationGardenDir)}.failed-commit-${Date.now().toString(36)}`,
  );
  const retryRename = async (
    source: string,
    destination: string,
    requireOwnership = true,
  ): Promise<string | null> => {
    let lastError = "";
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      if (requireOwnership && ownsLease && !ownsLease()) {
        return "lost the fenced garden lease before filesystem restore";
      }
      try {
        fs.renameSync(source, destination);
        return null;
      } catch (error) {
        lastError = errorMessage(error);
        if (attempt < 6) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(1_500, 100 * 2 ** (attempt - 1))),
          );
        }
      }
    }
    return lastError;
  };

  const hadDestination = fs.existsSync(destinationGardenDir);
  if (hadDestination) {
    const displaceError = await retryRename(destinationGardenDir, failedDir);
    if (displaceError) {
      throw new Error(
        `Could not move the current garden aside for restore; destination remains intact. ${displaceError}`,
      );
    }
  }

  let restoreError: string | null = null;
  if (previousGardenDir && fs.existsSync(previousGardenDir)) {
    restoreError = await retryRename(previousGardenDir, destinationGardenDir);
  } else if (hadDestination) {
    restoreError = "The retained previous garden is missing; refusing a destructive restore.";
  }

  if (restoreError) {
    let fallbackError: string | null = null;
    if (
      hadDestination &&
      !fs.existsSync(destinationGardenDir) &&
      fs.existsSync(failedDir)
    ) {
      // Restoring the tree we displaced is a compensating action: once this
      // worker made the destination absent it must repair that absence, even if
      // fencing was lost in the meantime. It never overwrites a new destination.
      fallbackError = await retryRename(failedDir, destinationGardenDir, false);
    }
    if (fallbackError) {
      throw new Error(
        `Previous garden restore failed (${restoreError}); restoring the displaced live garden also failed (${fallbackError}). Recovery copies remain at ${previousGardenDir ?? "(missing previous)"} and ${failedDir}.`,
      );
    }
    throw new Error(
      `Previous garden restore failed (${restoreError}); the displaced live garden was restored and the retained previous copy remains at ${previousGardenDir ?? "(missing previous)"}.`,
    );
  }
  if ((!ownsLease || ownsLease()) && fs.existsSync(failedDir)) {
    try {
      fs.rmSync(failedDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(
        `[learn] Restored the previous garden; displaced failed tree remains at ${failedDir}:`,
        cleanupError,
      );
    }
  }
}

export class LearnPipelineConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnPipelineConflictError";
  }
}

/** The only Learn flow allowed to discard and recreate the plan, contract,
 * learner pages, and visuals. It is never called as a repair fallback. */
export async function rebuildEntireGarden(
  gardenId: string,
  options: FullRebuildOptions,
): Promise<LearnJob> {
  if (options.forceFullRebuild !== true) {
    throw new Error("Rebuilding the entire garden requires explicit confirmation.");
  }
  let rebuildLease: GardenLearnLease | undefined;
  let planningJobId: string | undefined;
  try {
    const planning = await runLearnPlanning({
      gardenId,
      userId: options.userId,
      client: options.client,
      model: options.model ?? DEFAULT_MODEL,
      contentPath: options.contentPath,
      includedSourceIds: options.includedSourceIds,
      syllabusSourceId: options.syllabusSourceId,
      sourceOnly: options.sourceOnly ?? true,
      includeSourceSnapshots: options.includeSourceSnapshots ?? false,
      resetSourceMap: true,
      retainLeaseOnSuccess: true,
    });
    rebuildLease = planning.retainedLease;
    planningJobId = planning.job.id;
    if (!rebuildLease) {
      throw new Error("Full rebuild planning did not retain its garden lease.");
    }
    throwIfLearnCancelled(planning.job.id);
    const confirmed = confirmLearningMap({
      gardenId,
      learningMapId: planning.learningMap.id,
      contentPath: options.contentPath,
      gardenLease: rebuildLease,
    });
    const generation = await runTextbookGeneration({
      gardenId,
      userId: options.userId,
      client: options.client,
      model: options.model ?? DEFAULT_MODEL,
      contentPath: options.contentPath,
      confirmedLearningMapId: confirmed.id,
      mode: "full_rebuild",
      sourceOnly: options.sourceOnly ?? true,
      includeSourceSnapshots: options.includeSourceSnapshots ?? false,
      gardenLease: rebuildLease,
    });
    return generation.job;
  } catch (error) {
    if (
      planningJobId &&
      rebuildLease &&
      (rebuildLease.lost ||
        leaseLostLearnJobs.has(planningJobId) ||
        !rebuildLease.heartbeat())
    ) {
      throw error;
    }
    if (planningJobId && rebuildLease) {
      const rollback = await rollbackLearnRun({
        gardenId,
        contentPath: options.contentPath,
        jobId: planningJobId,
        lease: rebuildLease,
      });
      const publicationToken = queueLearnPublicationRetry(
        gardenId,
        "failed Learn rebuild rollback",
        new Error("Publication pending"),
      );
      appendLearnEvent(options.contentPath, gardenId, "learn_full_rebuild_rolled_back", {
        jobId: planningJobId,
        restoredPathCount: rollback.restoredPaths.length,
        deletedMaps: rollback.deletedMaps,
        deletedVersions: rollback.deletedVersions,
      });
      if (!isLearnCancellation(planningJobId, error)) {
        updateLearnJob(planningJobId, {
          status: "failed",
          currentStep: "Full rebuild failed; prior garden restored",
          error: errorMessage(error, "Full rebuild failed"),
        });
      }
      discardLearnRunSnapshot({
        gardenId,
        contentPath: options.contentPath,
        jobId: planningJobId,
      });
      try {
        await publishQuartzAfterMutation(`failed Learn rebuild rollback in ${gardenId}`, {
          requireSuccess: true,
        });
        clearLearnPublicationRetry(gardenId, publicationToken);
      } catch (publicationError) {
        queueLearnPublicationRetry(
          gardenId,
          "failed Learn rebuild rollback",
          publicationError,
        );
        // The prior filesystem state is already restored; publication can be
        // retried independently without sacrificing the original error.
      }
    }
    throw error;
  } finally {
    rebuildLease?.release();
  }
}

export class LearnRepairPendingMapError extends Error {
  constructor(jobId: string) {
    super(
      `Discard pending Learning Map ${jobId} before starting scoped repair.`,
    );
    this.name = "LearnRepairPendingMapError";
  }
}

export async function runLearnRepairOperation({
  gardenId,
  userId,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  request,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  request: StartLearnOperationRequest;
}): Promise<{ job: LearnJob; repair: LearnScopedRepairResult }> {
  if (request.mode !== "repair" || request.gardenId !== gardenId) {
    throw new Error("Repair request garden/mode does not match the Learn operation.");
  }
  const latestJob = getLatestLearnJob(gardenId);
  if (latestJob?.status === "awaiting_confirmation") {
    throw new LearnRepairPendingMapError(latestJob.id);
  }
  assertNoPendingLearnClear(gardenId);
  const gardenDir = clusterPath(contentPath, gardenId);
  const jobId = makeId("learn_job");
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId,
    buildId: `repair:${jobId}`,
  }, {
    onLeaseLost: () => abortLearnWorkerAfterLeaseLoss(jobId),
  });
  if (!leaseResult.acquired) {
    const message = `Another Learn operation (${leaseResult.conflict.jobId}) is already active for this garden.`;
    throw new LearnPipelineConflictError(message);
  }
  const lease = leaseResult.lease;
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
  } catch (error) {
    lease.release();
    throw error;
  }
  const context = collectLearnSourceContext(contentPath, gardenId);
  let job: LearnJob;
  try {
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn repair lost its garden lease before creating its job.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
    job = createLearnJob({
      id: jobId,
      gardenId,
      userId,
      model,
      mode: "repair",
      sourceIds: context.sources.map((source) => source.slug),
      sourceOnly: true,
      includeSourceSnapshots: false,
    });
  } catch (error) {
    lease.release();
    throw error;
  }
  let disposeModelTracking = () => {};
  let previousRepairGardenDir: string | undefined;
  let repairCommitRecorded = false;
  try {
    disposeModelTracking = attachLearnJobModelTracking({
      client,
      jobId: job.id,
      gardenId,
      contentPath,
    });
    createLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn repair lost its garden lease while creating the rollback snapshot.",
      );
    }
    updateLearnJob(job.id, { status: "analyzing_issues", currentStep: "Analyzing validation issues", progressPercent: 5 });
    appendLearnEvent(contentPath, gardenId, "learn_scoped_repair_started", { jobId: job.id, request });
    const repair = await executeLearnScopedRepair({
      gardenDir,
      gardenId,
      request,
      recoveryOwnerId: job.id,
      verifyLease: () => lease.heartbeat(),
      modelRepair: async (packet: unknown, issue: GardenIssue) => {
        const result = await callCouncilJson({
          client,
          model,
          taskType: "critique",
          gardenId,
          system: [
            "Repair exactly one typed Breadboard validation issue.",
            "Return STRICT JSON: {\"operations\":[typed operations] }.",
            "Use only entity IDs, source anchors, actions, and context present in the packet.",
            "Never return a directory, Markdown tree, replacement garden, unrestricted page, or invented source anchor.",
            "For visual-only failures, modify only the owned visual spec/block. For metadata failures, never rewrite prose.",
          ].join(" "),
          user: JSON.stringify(packet),
          sourceContext: packet,
          councilModeOverride: "direct_council",
          timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
        });
        appendLearnEvent(contentPath, gardenId, "learn_scoped_model_decision", {
          jobId: job.id, issueId: issue.issueId, issueType: issue.type, returnedTypedDecision: Boolean(result.parsed),
        });
        return result.parsed;
      },
      onProgress: ({ step, issue, scope }) => {
        throwIfLearnCancelled(job.id);
        const lower = step.toLowerCase();
        const status: LearnStatus = lower.includes("analyzing") ? "analyzing_issues"
          : lower.includes("revalidating") ? "revalidating"
            : lower.includes("publishing") ? "publishing_repair" : "repairing";
        if (status === "publishing_repair") {
          if (!lease.heartbeat()) {
            throw new LearnPipelineConflictError(
              "Learn repair lost its garden lease before publication.",
            );
          }
          committingLearnJobs.add(job.id);
        }
        const progressPercent = status === "analyzing_issues" ? 10 : status === "repairing" ? 55 : status === "revalidating" ? 85 : 95;
        const progressUpdate = {
          status, currentStep: step, progressPercent,
          currentPageTitle: issue?.target.pageId,
          currentSectionTitle: scope?.sectionIds.join(", ") || undefined,
        };
        if (status === "publishing_repair") {
          updateLearnJobExpectStatus(job.id, progressUpdate);
        } else {
          updateLearnJob(job.id, progressUpdate);
        }
      },
    });
    previousRepairGardenDir = repair.promotion.previousPreservedAt;
    throwIfLearnCancelled(job.id);
    if (!repair.transaction.committed || !repair.accepted || !repair.publishReady) {
      const remaining = repair.transaction.blockersAfter.length;
      throw new Error(`Scoped repair stopped without publishing because its safety/progress gate failed. ${remaining} blocker(s) remain. Inspect .breadboard/scoped-repair.md; Full rebuild remains a separate action.`);
    }
    updateLearnJobExpectStatus(job.id, { status: "publishing_repair", currentStep: "Publishing repaired projection", progressPercent: 96 });
    await publishQuartzAfterMutation(`scoped Learn repair in ${gardenId}`, {
      requireSuccess: true,
    });
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn repair lost its garden lease after Quartz publication.",
      );
    }
    appendLearnEvent(contentPath, gardenId, "learn_scoped_repair_completed", {
      jobId: job.id, repairId: repair.scope.repairId, changedFiles: repair.files.changedFiles,
      preservedPageCount: repair.scope.explicitlyExcludedPageIds.length,
      modelCalls: repair.transaction.modelCalls, blockersBefore: repair.transaction.blockersBefore.length,
      blockersAfter: repair.transaction.blockersAfter.length, accepted: repair.accepted, publishReady: repair.publishReady,
    });
    const finalJob = updateLearnJobExpectStatus(job.id, {
      status: "complete", currentStep: "Repair complete", progressPercent: 100,
      sourceSetHash: context.sourceSetHash,
    });
    repairCommitRecorded = true;
    try {
      fs.rmSync(learnRunSnapshotDir(gardenDir, job.id), {
        recursive: true,
        force: true,
      });
    } catch (snapshotCleanupError) {
      console.warn(
        `[learn] Completed repair snapshot remains for ${job.id}:`,
        snapshotCleanupError,
      );
    }
    if (previousRepairGardenDir && lease.heartbeat()) {
      try {
        fs.rmSync(previousRepairGardenDir, { recursive: true, force: true });
        previousRepairGardenDir = undefined;
      } catch (cleanupError) {
        console.warn(
          `[learn] Previous repaired garden remains at ${previousRepairGardenDir}:`,
          cleanupError,
        );
      }
    }
    return { job: finalJob, repair };
  } catch (error) {
    if (
      lease.lost ||
      leaseLostLearnJobs.has(job.id) ||
      !lease.heartbeat()
    ) {
      throw error;
    }
    if (previousRepairGardenDir && !repairCommitRecorded) {
      let restored = false;
      try {
        await restorePreviousPromotedGarden(
          gardenDir,
          previousRepairGardenDir,
          () => lease.heartbeat(),
        );
        if (!lease.heartbeat()) {
          throw new LearnPipelineConflictError(
            "Learn repair lost its lease after restoring the previous garden.",
          );
        }
        previousRepairGardenDir = undefined;
        restored = true;
      } catch (restoreError) {
        appendLearnEvent(contentPath, gardenId, "learn_repair_restore_failed", {
          jobId: job.id,
          error: errorMessage(restoreError, "Repair restore failed"),
        });
        updateLearnJob(job.id, {
          status: "publishing_repair",
          currentStep: "Repair filesystem restore pending retry",
          error: errorMessage(restoreError),
        });
        throw restoreError;
      }
      if (restored) {
        const publicationToken = queueLearnPublicationRetry(
          gardenId,
          "restored failed Learn repair",
          new Error("Publication pending"),
        );
        try {
          await publishQuartzAfterMutation(
            `rolled back failed Learn repair in ${gardenId}`,
            { requireSuccess: true },
          );
          clearLearnPublicationRetry(gardenId, publicationToken);
        } catch (republishError) {
          queueLearnPublicationRetry(
            gardenId,
            "restored failed Learn repair",
            republishError,
          );
          appendLearnEvent(contentPath, gardenId, "learn_repair_republish_queued", {
            jobId: job.id,
            error: errorMessage(republishError),
          });
        }
      }
    }
    if (isLearnCancellation(job.id, error)) {
      updateLearnJob(job.id, {
        status: "cancelled",
        currentStep: "Cancelled; scoped repair changes were not published",
        progressPercent: 0,
      });
      appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
        jobId: job.id,
        operation: "repair",
      });
      throw new LearnCancelledError();
    }
    const raw = errorMessage(error, "Learn repair failed");
    const message = raw.length > 700 ? `${raw.slice(0, 697)}...` : raw;
    appendLearnEvent(contentPath, gardenId, "learn_scoped_repair_failed", { jobId: job.id, error: message });
    updateLearnJob(job.id, { status: "failed", currentStep: "Repair stopped with remaining blockers", error: message });
    throw error;
  } finally {
    if (
      !lease.lost &&
      !leaseLostLearnJobs.has(job.id) &&
      lease.heartbeat() &&
      !previousRepairGardenDir
    ) {
      try {
        fs.rmSync(learnRunSnapshotDir(gardenDir, job.id), {
          recursive: true,
          force: true,
        });
      } catch {
        // Preserve the primary repair result; abandoned snapshot cleanup is
        // best-effort once no retained rollback tree remains.
      }
    }
    committingLearnJobs.delete(job.id);
    disposeModelTracking();
    lease.release();
  }
}

export async function runLearnPipeline({
  gardenId,
  userId,
  mode,
  confirmedLearningMapId,
  includedSourceIds,
  syllabusSourceId,
  sourceOnly = true,
  includeSourceSnapshots = false,
  autoConfirmTopicMap = false,
  client,
  model = DEFAULT_MODEL,
  contentPath,
}: {
  gardenId: string;
  userId?: number;
  mode: LegacyLearnOperationMode;
  confirmedLearningMapId?: string;
  includedSourceIds?: readonly string[];
  /** Slug of an uploaded document to use as the course study guide. */
  syllabusSourceId?: string | null;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  autoConfirmTopicMap?: boolean;
  client: OpenAI;
  model?: string;
  contentPath: string;
}): Promise<unknown> {
  const operationMode = normalizeLearnOperationMode(mode);
  if (operationMode === "repair") {
    return runLearnRepairOperation({
      gardenId, userId, client, model, contentPath,
      request: { gardenId, mode: "repair" },
    });
  }
  if (operationMode === "full_rebuild") {
    throw new Error("Use rebuildEntireGarden with explicit destructive confirmation.");
  }
  if (operationMode === "plan") {
    const planning = await runLearnPlanning({
      gardenId,
      userId,
      client,
      model,
      contentPath,
      includedSourceIds,
      syllabusSourceId,
      sourceOnly,
      includeSourceSnapshots,
      retainLeaseOnSuccess: autoConfirmTopicMap,
    });
    if (!autoConfirmTopicMap) return planning;
    const retainedLease = planning.retainedLease;
    if (!retainedLease) {
      throw new Error("Automatic Learn continuation did not retain its garden lease.");
    }
    try {
      throwIfLearnCancelled(planning.job.id);
      const learningMap = confirmLearningMap({
        gardenId,
        learningMapId: planning.learningMap.id,
        contentPath,
        gardenLease: retainedLease,
      });
      const generation = await runTextbookGeneration({
        gardenId,
        userId,
        client,
        model,
        contentPath,
        confirmedLearningMapId: learningMap.id,
        mode: "generate",
        sourceOnly,
        includeSourceSnapshots,
        gardenLease: retainedLease,
      });
      const publicPlanning = {
        job: planning.job,
        learningMap: planning.learningMap,
      };
      return { planning: publicPlanning, learningMap, generation };
    } catch (error) {
      if (
        !retainedLease.lost &&
        isLearnCancellation(planning.job.id, error)
      ) {
        try {
          const cleanup = await cleanupLearnArtifactsAfterCancel({
            gardenId,
            contentPath,
            jobId: planning.job.id,
            lease: retainedLease,
          });
          updateLearnJobExpectStatus(planning.job.id, {
            status: "cancelled",
            currentStep: "Cancelled; latest Learn changes rolled back",
            progressPercent: 0,
          });
          discardLearnRunSnapshot({
            gardenId,
            contentPath,
            jobId: planning.job.id,
          });
          appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
            jobId: planning.job.id,
            removedPathCount: cleanup.removedPaths.length,
            restoredPathCount: cleanup.restoredPaths.length,
            deletedMaps: cleanup.deletedMaps,
            deletedVersions: cleanup.deletedVersions,
          });
        } catch {
          // Leave the durable cancellation-request marker and snapshot intact;
          // startup recovery can retry after this retained lease is released.
        }
      }
      throw error;
    } finally {
      retainedLease.release();
    }
  }
  return runTextbookGeneration({
    gardenId,
    userId,
    client,
    model,
    contentPath,
    confirmedLearningMapId,
    mode: operationMode,
    sourceOnly,
    includeSourceSnapshots,
    autoConfirmTopicMap,
  });
}

export class LearnCancelConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnCancelConflictError";
  }
}

export async function cancelLatestLearnJob({
  gardenId,
  contentPath,
  expectedJobId,
}: {
  gardenId: string;
  contentPath: string;
  expectedJobId?: string;
}): Promise<LearnJob | null> {
  assertNoPendingLearnClear(gardenId);
  const latest = getLatestLearnJob(gardenId);
  if (!latest) {
    if (expectedJobId) {
      throw new LearnCancelConflictError(
        "The pending Learn operation no longer exists. Refresh and try again.",
      );
    }
    return null;
  }
  if (expectedJobId && latest.id !== expectedJobId) {
    throw new LearnCancelConflictError(
      `The visible Learn operation (${expectedJobId}) is no longer current. Refresh before cancelling ${latest.id}.`,
    );
  }
  if (
    committingLearnJobs.has(latest.id) ||
    latest.status === "writing_quartz" ||
    latest.status === "publishing_repair"
  ) {
    throw new LearnCancelConflictError(
      "Learn has finished validation and is atomically committing the garden. Wait for publication to complete before starting another operation.",
    );
  }
  const cancellationCleanupPending =
    latest.status === "cancelled" &&
    latest.currentStep === LEARN_CANCELLATION_REQUESTED_STEP;
  if (latest.status === "cancelled" && !cancellationCleanupPending) return latest;
  if (
    !cancellationCleanupPending &&
    !activeStatus(latest.status) &&
    latest.status !== "awaiting_confirmation"
  ) {
    throw new LearnCancelConflictError(
      `Learn operation ${latest.id} is already ${latest.status} and can no longer be cancelled.`,
    );
  }
  const activeController = activeLearnAbortControllers.get(latest.id);
  const next = cancellationCleanupPending
    ? latest
    : updateLearnJobExpectStatus(latest.id, {
        status: "cancelled",
        currentStep: LEARN_CANCELLATION_REQUESTED_STEP,
        progressPercent: 0,
        currentSectionTitle: undefined,
        currentPageTitle: undefined,
        proposedLearningMapId: undefined,
        confirmedLearningMapId: undefined,
        latestTextbookVersionId: undefined,
      });
  activeController?.abort(new LearnCancelledError());
  if (!cancellationCleanupPending) {
    appendLearnEvent(contentPath, gardenId, "learn_cancellation_requested", {
      jobId: latest.id,
    });
  }
  // The running worker owns rollback after it has left every write-capable
  // section. Rolling back here used to race the still-unwinding pipeline and
  // allowed artifacts to reappear after Stop returned.
  if (activeController) {
    return next;
  }
  const gardenDir = clusterPath(contentPath, gardenId);
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId: latest.id,
    buildId: `cancel:${latest.id}`,
  });
  if (!leaseResult.acquired) {
    // A worker in another process still owns the garden. Its durable status
    // poll will observe `cancelled`, abort, and perform rollback under its own
    // lease; this process must never race that cleanup.
    return next;
  }
  try {
    assertNoPendingLearnClear(gardenId);
    const cleanup = await cleanupLearnArtifactsAfterCancel({
      gardenId,
      contentPath,
      jobId: latest.id,
      lease: leaseResult.lease,
    });
    const cancelled = updateLearnJobExpectStatus(latest.id, {
      status: "cancelled",
      currentStep: "Cancelled; latest Learn changes rolled back",
      progressPercent: 0,
    });
    discardLearnRunSnapshot({ gardenId, contentPath, jobId: latest.id });
    appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
      jobId: latest.id,
      removedPathCount: cleanup.removedPaths.length,
      restoredPathCount: cleanup.restoredPaths.length,
      deletedMaps: cleanup.deletedMaps,
      deletedVersions: cleanup.deletedVersions,
    });
    return cancelled;
  } finally {
    leaseResult.lease.release();
  }
}

export class LearnClearConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnClearConflictError";
  }
}

export interface ClearLearnDataResult {
  gardenId: string;
  removedPaths: string[];
  removedLearnerPagePaths: string[];
  removedVisualIds: string[];
  removedEventCount: number;
  resetSourceVisualCount: number;
  deletedJobs: number;
  deletedTokenUsageRows: number;
  deletedMaps: number;
  deletedVersions: number;
  deletedSemanticChunks: number;
  deletedSemanticFtsRows: number;
  preservedFileCount: number;
  publicationAttempts: number;
}

interface GardenFileFingerprints {
  [relativePath: string]: string;
}

interface ClearLearnDatabaseResult extends LearnDatabaseClearResult {
  deletedChunks: number;
  deletedFtsRows: number;
}

type LearnClearOperationPhase =
  | "prepared"
  | "filesystem_promoted"
  | "restored_pending_publication"
  | "database_committed";

interface LearnClearOperationRow {
  id: string;
  garden_id: string;
  phase: LearnClearOperationPhase;
  previous_garden_dir: string | null;
  pre_clear_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

function clearRecoveryFingerprint(files: GardenFileFingerprints): string {
  const stableEntries = Object.entries(files)
    .filter(([relativePath]) => {
      const normalized = normalizeRelPath(relativePath).toLowerCase();
      return (
        normalized !== ".breadboard/events.jsonl" &&
        normalized !== ".breadboard/learn-build.lock.json"
      );
    })
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256")
    .update(JSON.stringify(stableEntries))
    .digest("hex");
}

function createLearnClearOperation(
  clearId: string,
  gardenId: string,
  preClearFingerprint: string,
): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO learn_clear_operations (
       id, garden_id, phase, previous_garden_dir, pre_clear_fingerprint,
       created_at, updated_at
     ) VALUES (?, ?, 'prepared', NULL, ?, ?, ?)`,
  ).run(clearId, gardenId, preClearFingerprint, timestamp, timestamp);
}

function updateLearnClearOperation(
  clearId: string,
  phase: LearnClearOperationPhase,
  previousGardenDir?: string | null,
): void {
  db.prepare(
    `UPDATE learn_clear_operations
     SET phase = ?, previous_garden_dir = ?, updated_at = ?
     WHERE id = ?`,
  ).run(phase, previousGardenDir ?? null, nowIso(), clearId);
}

function deleteLearnClearOperation(clearId: string): void {
  db.prepare("DELETE FROM learn_clear_operations WHERE id = ?").run(clearId);
}

const STATIC_LEARN_CLEAR_REMOVAL_ROOTS = [
  ".breadboard/internal",
  ".breadboard/backups",
  ".breadboard/build-workspace.json",
  ".breadboard/canonical-shadow",
  ".breadboard/debug/failed-pages",
  ".breadboard/debug/failed-repairs",
  ".breadboard/learn-run-snapshots",
  ".breadboard/planning",
  ".breadboard/quarantine",
  ".breadboard/source-snapshots",
  ".breadboard/acceptance-status.json",
  ".breadboard/active-build-manifest.json",
  ".breadboard/anchor-critic-decisions.json",
  ".breadboard/anchor-replacement-plan.json",
  ".breadboard/anchor-replacement-plan.md",
  ".breadboard/claims.json",
  ".breadboard/claims-history.json",
  ".breadboard/concept-registry.json",
  ".breadboard/concept-registry-history.json",
  ".breadboard/critic-issues.json",
  ".breadboard/critic-loop.json",
  ".breadboard/critic-report.md",
  ".breadboard/formula-assignment-plan.json",
  ".breadboard/formula-identities.json",
  ".breadboard/learn-build.lock.json",
  ".breadboard/learning-unit-contract.json",
  ".breadboard/repair-log.json",
  ".breadboard/repair-report.md",
  ".breadboard/render-manifest.json",
  ".breadboard/scoped-repair.json",
  ".breadboard/scoped-repair.md",
  ".breadboard/semantic-migration.json",
  ".breadboard/source-anchor-evidence.json",
  ".breadboard/source-anchor-evidence.md",
  ".breadboard/source-anchor-migration.json",
  ".breadboard/source-anchor-migration.md",
  ".breadboard/source-anchors.json",
  ".breadboard/source-visual-scan-cache.json",
  ".breadboard/validation-report.md",
  ".breadboard/visual-necessity-decisions.json",
  ".breadboard/visual-necessity-decisions.md",
  ".breadboard/visual-decision-records.json",
  ".breadboard/visual-contract-executability-reviews.json",
  ".breadboard/visualization-plan.json",
  ".breadboard/visualization-coverage.json",
  ".breadboard/visualization-coverage.md",
  ".breadboard/visualization-events.json",
  ".breadboard/visualization-report.md",
  ".breadboard/weak-anchor-self-healing.json",
  ".breadboard/weak-anchor-self-healing.md",
] as const;

const STATIC_LEARN_CLEAR_MODIFIED_FILES = new Set([
  ".breadboard/events.jsonl",
  ".breadboard/source-visuals.json",
  ".breadboard/visual-index.json",
]);

function hasIndependentLearnFrontmatter(gardenDir: string, relativePath: string): boolean {
  if (!relativePath.toLowerCase().endsWith(".md")) return false;
  const root = path.resolve(gardenDir);
  const target = path.resolve(root, ...relativePath.split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return false;
  let markdown: string;
  try {
    markdown = fs.readFileSync(target, "utf8");
  } catch {
    return false;
  }
  const raw = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)?.[1];
  if (!raw) return false;
  if (/^generated(?:By|_by)\s*:\s*["']?(?:learn|learn_button|breadboard_learn)["']?\s*$/im.test(raw)) {
    return true;
  }
  if (/^generatedByBuildId\s*:\s*\S+/im.test(raw)) return true;
  const hasPageId = /^pageId\s*:\s*\S+/im.test(raw);
  const hasUnitId = /^(?:learningUnitId|generatedFromUnitId)\s*:\s*\S+/im.test(raw);
  const hasVersion = /^learningVersion(?:Id)?\s*:\s*\S+/im.test(raw);
  return (hasPageId && hasUnitId) || (hasUnitId && hasVersion);
}

function learnClearMutationPolicyViolations(
  gardenDir: string,
  result: LearnFilesystemClearResult,
): string[] {
  const removedLearnerPages = new Set(
    result.removedLearnerPagePaths.map((item) => normalizeRelPath(item).toLowerCase()),
  );
  const removedVisualRoots = result.removedVisualIds.map(
    (visualId) => `.breadboard/visuals/${visualId}`.toLowerCase(),
  );
  const isStaticRemoval = (relativePath: string): boolean =>
    STATIC_LEARN_CLEAR_REMOVAL_ROOTS.some(
      (root) => relativePath === root || relativePath.startsWith(`${root}/`),
    );
  const violations: string[] = [];

  for (const item of result.removedPaths) {
    const normalized = normalizeRelPath(item).toLowerCase();
    const isLearningTree = normalized === "learning" || normalized.startsWith("learning/");
    const isOwnedVisual = removedVisualRoots.some(
      (root) => normalized === root || normalized === `${root}.json` || normalized.startsWith(`${root}/`),
    );
    const isVerifiedExternalPage =
      removedLearnerPages.has(normalized) &&
      !normalized.startsWith("sources/") &&
      !normalized.startsWith("assets/") &&
      !normalized.startsWith(".breadboard/") &&
      hasIndependentLearnFrontmatter(gardenDir, normalizeRelPath(item));
    if (!isLearningTree && !isStaticRemoval(normalized) && !isOwnedVisual && !isVerifiedExternalPage) {
      violations.push(`cleanup requested an unauthorized removal: ${item}`);
    }
  }
  for (const item of result.modifiedPaths) {
    const normalized = normalizeRelPath(item).toLowerCase();
    if (!STATIC_LEARN_CLEAR_MODIFIED_FILES.has(normalized)) {
      violations.push(`cleanup requested an unauthorized modification: ${item}`);
    }
  }
  return violations;
}

function fingerprintGardenFiles(gardenDir: string): GardenFileFingerprints {
  const fingerprints: GardenFileFingerprints = {};
  if (!fs.existsSync(gardenDir)) return fingerprints;

  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const relativePath = normalizeRelPath(path.relative(gardenDir, absolutePath));
        fingerprints[relativePath] = createHash("sha256")
          .update(`symlink:${fs.readlinkSync(absolutePath)}`)
          .digest("hex");
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeRelPath(path.relative(gardenDir, absolutePath));
      fingerprints[relativePath] = createHash("sha256")
        .update(fs.readFileSync(absolutePath))
        .digest("hex");
    }
  };
  visit(gardenDir);
  return fingerprints;
}

function pathWithinAllowedMutation(
  relativePath: string,
  allowedMutationRoots: readonly string[],
): boolean {
  const normalized = normalizeRelPath(relativePath).toLowerCase();
  return allowedMutationRoots.some((root) => {
    const normalizedRoot = normalizeRelPath(root).replace(/\/$/, "").toLowerCase();
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
}

function gardenClearBoundaryViolations({
  before,
  candidateGardenDir,
  allowedMutationRoots,
}: {
  before: GardenFileFingerprints;
  candidateGardenDir: string;
  allowedMutationRoots: readonly string[];
}): string[] {
  const after = fingerprintGardenFiles(candidateGardenDir);
  const violations: string[] = [];

  for (const [relativePath, fingerprint] of Object.entries(before)) {
    if (pathWithinAllowedMutation(relativePath, allowedMutationRoots)) continue;
    if (!after[relativePath]) violations.push(`protected file was removed: ${relativePath}`);
    else if (after[relativePath] !== fingerprint) {
      violations.push(`protected file changed: ${relativePath}`);
    }
  }
  for (const relativePath of Object.keys(after)) {
    if (before[relativePath] || pathWithinAllowedMutation(relativePath, allowedMutationRoots)) {
      continue;
    }
    violations.push(`unexpected file was created: ${relativePath}`);
  }
  return violations;
}

async function restoreGardenAfterClearDatabaseFailure({
  gardenDir,
  previousGardenDir,
  clearId,
  ownsLease,
}: {
  gardenDir: string;
  previousGardenDir: string;
  clearId: string;
  ownsLease?: () => boolean;
}): Promise<{ restored: boolean; reason: string }> {
  const parent = path.dirname(path.resolve(gardenDir));
  const previous = path.resolve(previousGardenDir);
  if (path.dirname(previous) !== parent) {
    return { restored: false, reason: "previous garden path escaped the garden parent" };
  }
  let lastError = "";
  const displacedCopies: string[] = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (ownsLease && !ownsLease()) {
      return {
        restored: false,
        reason: "lost the fenced garden lease before filesystem recovery",
      };
    }
    const displaced = path.resolve(
      parent,
      `.${path.basename(gardenDir)}.failed-clear-${clearId}-${attempt}-${Date.now().toString(36)}`,
    );
    if (path.dirname(displaced) !== parent) {
      return { restored: false, reason: "computed recovery path escaped the garden parent" };
    }
    let currentMovedAside = false;
    try {
      if (fs.existsSync(gardenDir)) {
        fs.renameSync(gardenDir, displaced);
        currentMovedAside = true;
        displacedCopies.push(displaced);
      }
      fs.renameSync(previous, gardenDir);
      if (!ownsLease || ownsLease()) {
        for (const displacedCopy of displacedCopies) {
          try {
            fs.rmSync(displacedCopy, { recursive: true, force: true });
          } catch {
            // The previous garden is already restored. Locked displaced copies
            // remain as explicit recovery material; never delete them before a
            // verified destination exists.
          }
        }
      }
      return { restored: true, reason: `restored previous garden on attempt ${attempt}` };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (currentMovedAside && !fs.existsSync(gardenDir) && fs.existsSync(displaced)) {
        try {
          fs.renameSync(displaced, gardenDir);
        } catch {
          // Retry can still recover from either sibling copy.
        }
      }
      if (attempt < 6) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(1_500, 100 * 2 ** (attempt - 1))));
      }
    }
  }
  return {
    restored: false,
    reason:
      `could not restore the previous garden after 6 attempts: ${lastError}` +
      (displacedCopies.length > 0
        ? `. Displaced garden copies were preserved at ${displacedCopies.join(", ")}`
        : ""),
  };
}

/**
 * Permanently remove generated Learn state for one garden. Source documents,
 * extracted source assets, and ordinary notes outside the generated Learning
 * tree are protected by a byte-fingerprint boundary before atomic promotion.
 */
export async function clearAllLearnData({
  gardenId,
  contentPath,
  confirmClearLearnData,
}: {
  gardenId: string;
  contentPath: string;
  confirmClearLearnData: true;
}): Promise<ClearLearnDataResult> {
  if (confirmClearLearnData !== true) {
    throw new Error("Clearing Learn data requires explicit confirmation.");
  }
  ensureLearnTables();
  assertNoPendingLearnClear(gardenId);

  const jobsAtStart = db
    .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ? ORDER BY updated_at DESC")
    .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
  const jobIdsAtStart = new Set(jobsAtStart.map((job) => job.id));
  const activeJob = jobsAtStart.find(
    (job) => activeStatus(job.status),
  );
  if (activeJob) {
    throw new LearnClearConflictError(
      `Stop the active Learn operation (${activeJob.id}) before clearing Learn data.`,
    );
  }

  const gardenDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(gardenDir, { recursive: true });
  const clearId = makeId("learn_clear");
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId: clearId,
    buildId: `clear:${clearId}`,
  });
  if (!leaseResult.acquired) {
    throw new LearnClearConflictError(
      `Another Learn operation (${leaseResult.conflict.jobId}) is still writing this garden. Stop it before clearing Learn data.`,
    );
  }
  const lease = leaseResult.lease;
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
  } catch (error) {
    lease.release();
    throw error;
  }

  let temporaryRoot: string | undefined;
  try {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-learn-clear-"));
    const jobsAfterLock = db
      .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ? ORDER BY updated_at DESC")
      .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
    const racingJob = jobsAfterLock.find(
      (job) => !jobIdsAtStart.has(job.id) || activeStatus(job.status),
    );
    if (racingJob) {
      throw new LearnClearConflictError(
        `A Learn operation (${racingJob.id}) started while Clear was acquiring the garden. Stop it and try again.`,
      );
    }

    const fingerprintsBefore = fingerprintGardenFiles(gardenDir);
    const stagingContentPath = path.join(temporaryRoot, "content");
    const stagingGardenDir = path.join(stagingContentPath, gardenId);
    fs.mkdirSync(stagingContentPath, { recursive: true });
    fs.cpSync(gardenDir, stagingGardenDir, { recursive: true, force: true });

    const filesystemResult = clearGeneratedLearnState(stagingGardenDir);
    const mutationPolicyViolations = learnClearMutationPolicyViolations(
      gardenDir,
      filesystemResult,
    );
    if (mutationPolicyViolations.length > 0) {
      throw new Error(
        `Learn clear was rolled back by the static mutation policy: ${mutationPolicyViolations
          .slice(0, 6)
          .join("; ")}`,
      );
    }
    const stagingLock = acquireGardenLearnLock(stagingGardenDir, {
      gardenSlug: gardenId,
      jobId: clearId,
      buildId: `clear:${clearId}`,
    });
    if (!stagingLock.acquired) {
      throw new LearnClearConflictError(
        `The staged garden unexpectedly contains another Learn lock (${stagingLock.conflict.jobId}).`,
      );
    }
    refreshClusterIndex(stagingContentPath, gardenId, { migrateSources: false });

    const allowedMutationRoots = Array.from(
      new Set([
        ...filesystemResult.removedPaths,
        ...filesystemResult.modifiedPaths,
        "_index.md",
        "sources/_index.md",
      ]),
    );
    const stagingViolations = gardenClearBoundaryViolations({
      before: fingerprintsBefore,
      candidateGardenDir: stagingGardenDir,
      allowedMutationRoots,
    });
    if (stagingViolations.length > 0) {
      throw new Error(
        `Learn clear was rolled back because protected garden content changed: ${stagingViolations
          .slice(0, 6)
          .join("; ")}`,
      );
    }

    // This SQLite journal is created before the filesystem swap and advanced
    // in the same transaction as database deletion. Startup recovery can
    // therefore distinguish rollback from post-commit cleanup after a crash.
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn Clear lost its garden lease while creating its staging copy.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
    createLearnClearOperation(
      clearId,
      gardenId,
      clearRecoveryFingerprint(fingerprintsBefore),
    );

    let promotedViolations: string[] = [];
    let destinationViolations: string[] = [];
    let concurrentLearnJobId: string | undefined;
    const publication = await promoteStagingGarden({
      stagingGardenDir,
      destinationGardenDir: gardenDir,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: clearId,
      verifyManifest: (candidateDir) => {
        promotedViolations = gardenClearBoundaryViolations({
          before: fingerprintsBefore,
          candidateGardenDir: candidateDir,
          allowedMutationRoots,
        });
        return promotedViolations.length === 0;
      },
      verifyCurrentDestination: (currentDestinationDir) => {
        if (!lease.heartbeat()) return false;
        const currentJobs = db
          .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ?")
          .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
        concurrentLearnJobId = currentJobs.find(
          (job) => !jobIdsAtStart.has(job.id) || activeStatus(job.status),
        )?.id;
        if (concurrentLearnJobId) return false;
        destinationViolations = gardenClearBoundaryViolations({
          before: fingerprintsBefore,
          candidateGardenDir: currentDestinationDir,
          allowedMutationRoots: [],
        });
        return destinationViolations.length === 0;
      },
    });
    if (!publication.promoted) {
      if (publication.previousPreservedAt) {
        const recovery = await restoreGardenAfterClearDatabaseFailure({
          gardenDir,
          previousGardenDir: publication.previousPreservedAt,
          clearId,
          ownsLease: () => lease.heartbeat(),
        });
        if (!recovery.restored) {
          throw new Error(
            `${publication.reason}; the Clear journal and retained garden were preserved because recovery could not finish: ${recovery.reason}`,
          );
        }
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after a failed promotion; its journal was retained for recovery.",
        );
      }
      deleteLearnClearOperation(clearId);
      const violations = [...destinationViolations, ...promotedViolations];
      const violationDetail = concurrentLearnJobId
        ? ` A concurrent Learn operation started (${concurrentLearnJobId}).`
        : violations.length > 0
        ? ` ${violations.slice(0, 6).join("; ")}`
        : "";
      throw new Error(`${publication.reason}${violationDetail}`);
    }
    updateLearnClearOperation(
      clearId,
      "filesystem_promoted",
      publication.previousPreservedAt,
    );

    try {
      await publishQuartzAfterMutation(`cleared Learn data in ${gardenId}`, {
        requireSuccess: true,
      });
    } catch (publicationError) {
      const previousGardenDir = publication.previousPreservedAt;
      const recovery = previousGardenDir
        ? await restoreGardenAfterClearDatabaseFailure({
            gardenDir,
            previousGardenDir,
            clearId,
            ownsLease: () => lease.heartbeat(),
          })
        : { restored: false, reason: "atomic promotion did not retain a previous garden" };
      if (!recovery.restored) {
        throw new Error(
          `Learn Clear publication failed (${errorMessage(publicationError)}), and filesystem recovery failed: ${recovery.reason}`,
          { cause: publicationError },
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after restoring a failed publication; its journal was retained for recovery.",
        );
      }
      updateLearnClearOperation(clearId, "restored_pending_publication");
      try {
        await publishQuartzAfterMutation(
          `rolled back failed Learn Clear publication in ${gardenId}`,
          { requireSuccess: true },
        );
      } catch (republishError) {
        throw new Error(
          `Learn Clear publication failed (${errorMessage(publicationError)}). The repository was restored, but republishing that restored garden also failed (${errorMessage(republishError)}).`,
          { cause: publicationError },
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after republishing the restored garden; its journal was retained for recovery.",
        );
      }
      deleteLearnClearOperation(clearId);
      throw publicationError;
    }

    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn Clear lost its garden lease after publication; the journal was retained for recovery.",
      );
    }

    let databaseResult: ClearLearnDatabaseResult;
    try {
      databaseResult = db.transaction(() => {
        const currentJobs = db
          .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ?")
          .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
        const concurrentJob = currentJobs.find(
          (job) => !jobIdsAtStart.has(job.id) || activeStatus(job.status),
        );
        if (concurrentJob) {
          throw new LearnClearConflictError(
            `A concurrent Learn operation started (${concurrentJob.id}); its database state was not cleared.`,
          );
        }
        const semantic = clearLearnSemanticChunks(
          {
            gardenSlug: gardenId,
            verifiedGeneratedPageRelPaths: filesystemResult.removedLearnerPagePaths,
          },
          db,
        );
        const learnRows = clearLearnDatabaseRecords(db, gardenId);
        updateLearnClearOperation(
          clearId,
          "database_committed",
          publication.previousPreservedAt,
        );
        return {
          ...semantic,
          ...learnRows,
        };
      })();
    } catch (error) {
      const previousGardenDir = publication.previousPreservedAt;
      const recovery = previousGardenDir
        ? await restoreGardenAfterClearDatabaseFailure({
            gardenDir,
            previousGardenDir,
            clearId,
            ownsLease: () => lease.heartbeat(),
          })
        : { restored: false, reason: "atomic promotion did not retain a previous garden" };
      if (!recovery.restored) {
        const databaseMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Learn data database cleanup failed (${databaseMessage}), and filesystem recovery failed: ${recovery.reason}`,
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after restoring a failed database commit; its journal was retained for recovery.",
        );
      }
      updateLearnClearOperation(clearId, "restored_pending_publication");
      try {
        await publishQuartzAfterMutation(
          `rolled back failed Learn Clear database commit in ${gardenId}`,
          { requireSuccess: true },
        );
      } catch (republishError) {
        throw new Error(
          `Learn data database cleanup failed (${errorMessage(error)}). The repository was restored, but republishing that restored garden also failed (${errorMessage(republishError)}).`,
          { cause: error },
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after republishing the database rollback; its journal was retained for recovery.",
        );
      }
      deleteLearnClearOperation(clearId);
      throw error;
    }

    if (publication.previousPreservedAt) {
      const previousGardenDir = path.resolve(publication.previousPreservedAt);
      try {
        if (path.dirname(previousGardenDir) !== path.dirname(path.resolve(gardenDir))) {
          throw new Error("previous garden cleanup path escaped the garden parent");
        }
        fs.rmSync(previousGardenDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(
          `[learn] Previous garden cleanup remains at ${publication.previousPreservedAt}:`,
          error,
        );
      }
    }
    deleteLearnClearOperation(clearId);

    const preservedFileCount = Object.keys(fingerprintsBefore).filter(
      (relativePath) => !pathWithinAllowedMutation(relativePath, allowedMutationRoots),
    ).length;
    return {
      gardenId,
      removedPaths: filesystemResult.removedPaths,
      removedLearnerPagePaths: filesystemResult.removedLearnerPagePaths,
      removedVisualIds: filesystemResult.removedVisualIds,
      removedEventCount: filesystemResult.removedEventCount,
      resetSourceVisualCount: filesystemResult.resetSourceVisualCount,
      deletedJobs: databaseResult.deletedJobs,
      deletedTokenUsageRows: databaseResult.deletedTokenUsageRows,
      deletedMaps: databaseResult.deletedMaps,
      deletedVersions: databaseResult.deletedVersions,
      deletedSemanticChunks: databaseResult.deletedChunks,
      deletedSemanticFtsRows: databaseResult.deletedFtsRows,
      preservedFileCount,
      publicationAttempts: publication.attempts,
    };
  } finally {
    try {
      if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch {
      // The clear result is already committed; a locked temp copy can be
      // reclaimed by the operating system later.
    }
    lease.release();
  }
}

export const LEARN_JOB_ABANDONED_AFTER_MS = LOCK_STALE_MS + 60_000;

interface AbandonedLearnJobRow {
  job_rowid: number;
  id: string;
  garden_id: string;
  mode: LearnMode;
  status: LearnStatus;
  current_step: string;
  created_at: string;
  updated_at: string;
}

function recoverableAbandonedJob(job: Pick<AbandonedLearnJobRow, "status" | "current_step">): boolean {
  return (
    recoverableLearnStatus(job.status) ||
    (job.status === "cancelled" &&
      job.current_step === LEARN_CANCELLATION_REQUESTED_STEP)
  );
}

function exactPreviousGardenForOwner(
  gardenDir: string,
  ownerId: string,
): string | null {
  const parent = path.dirname(gardenDir);
  const prefix = `.${path.basename(gardenDir)}.previous-`;
  const ownerSuffix = `-${createHash("sha256")
    .update(ownerId)
    .digest("hex")
    .slice(0, 16)}`;
  try {
    return (
      fs
        .readdirSync(parent, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith(prefix) &&
            entry.name.endsWith(ownerSuffix),
        )
        .map((entry) => path.join(parent, entry.name))
        .sort()
        .at(-1) ?? null
    );
  } catch {
    return null;
  }
}

function previousGardenForClearOperation(
  gardenDir: string,
  operation: LearnClearOperationRow,
): string | null {
  if (operation.previous_garden_dir) {
    const candidate = path.resolve(operation.previous_garden_dir);
    const expectedParent = path.dirname(path.resolve(gardenDir));
    const expectedSuffix = `-${createHash("sha256")
      .update(operation.id)
      .digest("hex")
      .slice(0, 16)}`;
    if (
      path.dirname(candidate) === expectedParent &&
      path.basename(candidate).startsWith(`.${path.basename(gardenDir)}.previous-`) &&
      path.basename(candidate).endsWith(expectedSuffix) &&
      fs.existsSync(candidate)
    ) {
      return candidate;
    }
  }
  return exactPreviousGardenForOwner(gardenDir, operation.id);
}

async function recoverInterruptedLearnClears(contentPath: string): Promise<void> {
  const operations = db
    .prepare(
      `SELECT id, garden_id, phase, previous_garden_dir, pre_clear_fingerprint, created_at, updated_at
       FROM learn_clear_operations
       ORDER BY created_at ASC`,
    )
    .all() as LearnClearOperationRow[];
  for (const operation of operations) {
    const gardenDir = clusterPath(contentPath, operation.garden_id);
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: operation.garden_id,
      jobId: operation.id,
      buildId: `clear-recovery:${operation.id}`,
    });
    if (!leaseResult.acquired) continue;
    try {
      const current = db
        .prepare(
          `SELECT id, garden_id, phase, previous_garden_dir, pre_clear_fingerprint, created_at, updated_at
           FROM learn_clear_operations WHERE id = ?`,
        )
        .get(operation.id) as LearnClearOperationRow | undefined;
      if (!current) continue;
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Interrupted Clear recovery lost its garden lease.",
        );
      }
      const previousGarden = previousGardenForClearOperation(gardenDir, current);

      if (current.phase === "database_committed") {
        if (previousGarden) {
          fs.rmSync(previousGarden, { recursive: true, force: true });
        }
        deleteLearnClearOperation(current.id);
        continue;
      }

      if (current.phase === "restored_pending_publication") {
        await publishQuartzAfterMutation(
          `resumed restored Learn Clear publication in ${current.garden_id}`,
          { requireSuccess: true },
        );
        if (!leaseResult.lease.heartbeat()) {
          throw new LearnPipelineConflictError(
            "Clear recovery lost its lease after restored publication.",
          );
        }
        deleteLearnClearOperation(current.id);
        continue;
      }

      if (!previousGarden) {
        const liveMatchesPreClear = Boolean(
          current.pre_clear_fingerprint &&
          fs.existsSync(gardenDir) &&
          clearRecoveryFingerprint(fingerprintGardenFiles(gardenDir)) ===
            current.pre_clear_fingerprint,
        );
        if (current.phase === "filesystem_promoted" && liveMatchesPreClear) {
          updateLearnClearOperation(current.id, "restored_pending_publication");
          await publishQuartzAfterMutation(
            `completed restored Learn Clear publication in ${current.garden_id}`,
            { requireSuccess: true },
          );
          if (!leaseResult.lease.heartbeat()) {
            throw new LearnPipelineConflictError(
              "Clear recovery lost its lease after restored publication.",
            );
          }
          deleteLearnClearOperation(current.id);
          continue;
        }
        if (current.phase === "filesystem_promoted") {
          throw new Error(
            "The Clear journal says the filesystem was promoted, but its exact retained garden is missing.",
          );
        }
        // Prepared with no owner-tagged backup means the process stopped before
        // the destination swap only when the full pre-clear fingerprint proves
        // the live tree is unchanged. Missing recovery evidence fails closed.
        if (liveMatchesPreClear) {
          deleteLearnClearOperation(current.id);
          continue;
        }
        throw new Error(
          "Prepared Clear has neither an exact retained garden nor a live pre-clear fingerprint match.",
        );
      }

      const recovery = await restoreGardenAfterClearDatabaseFailure({
        gardenDir,
        previousGardenDir: previousGarden,
        clearId: current.id,
        ownsLease: () => leaseResult.lease.heartbeat(),
      });
      if (!recovery.restored) throw new Error(recovery.reason);
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Clear recovery lost its lease after restoring the retained garden.",
        );
      }
      updateLearnClearOperation(current.id, "restored_pending_publication");
      await publishQuartzAfterMutation(
        `recovered interrupted Learn Clear in ${current.garden_id}`,
        { requireSuccess: true },
      );
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Clear recovery lost its lease after restored publication.",
        );
      }
      deleteLearnClearOperation(current.id);
    } catch (error) {
      console.error(
        `[learn] Could not recover interrupted Clear ${operation.id}:`,
        error,
      );
    } finally {
      leaseResult.lease.release();
    }
  }
}

interface LearnPublicationRetryRow {
  garden_id: string;
  reason: string;
  last_error: string | null;
  requested_at: string;
  updated_at: string;
}

async function recoverPendingLearnPublications(contentPath: string): Promise<void> {
  const pending = db
    .prepare(
      `SELECT garden_id, reason, last_error, requested_at, updated_at
       FROM learn_publication_retries ORDER BY requested_at ASC`,
    )
    .all() as LearnPublicationRetryRow[];
  for (const publication of pending) {
    if (pendingLearnClearOperation(publication.garden_id)) continue;
    const gardenDir = clusterPath(contentPath, publication.garden_id);
    const retryId = `learn_publish_${createHash("sha256")
      .update(`${publication.garden_id}:${publication.updated_at}`)
      .digest("hex")
      .slice(0, 16)}`;
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: publication.garden_id,
      jobId: retryId,
      buildId: `publication-retry:${retryId}`,
    });
    if (!leaseResult.acquired) continue;
    try {
      reconcileSupersededAwaitingLearnJobs(publication.garden_id);
      if (
        pendingLearnClearOperation(publication.garden_id) ||
        unresolvedLearnJob(publication.garden_id)
      ) {
        continue;
      }
      await publishQuartzAfterMutation(
        `retrying ${publication.reason} in ${publication.garden_id}`,
        { requireSuccess: true },
      );
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Publication retry lost its garden lease before acknowledging success.",
        );
      }
      db.prepare(
        `DELETE FROM learn_publication_retries
         WHERE garden_id = ? AND updated_at = ?`,
      ).run(publication.garden_id, publication.updated_at);
    } catch (error) {
      db.prepare(
        `UPDATE learn_publication_retries
         SET last_error = ?, updated_at = ?
         WHERE garden_id = ? AND updated_at = ?`,
      ).run(
        errorMessage(error),
        nowIso(),
        publication.garden_id,
        publication.updated_at,
      );
    } finally {
      leaseResult.lease.release();
    }
  }
}

function previousGardenForAbandonedJob(
  gardenDir: string,
  job: Pick<AbandonedLearnJobRow, "id">,
): string | null {
  const parent = path.dirname(gardenDir);
  const prefix = `.${path.basename(gardenDir)}.previous-`;
  let candidates: Array<{ path: string; name: string; promotedAt: number }> = [];
  try {
    candidates = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => ({
        path: path.join(parent, entry.name),
        name: entry.name,
        promotedAt: Number.parseInt(entry.name.slice(prefix.length), 36),
      }))
      .filter((candidate) => Number.isFinite(candidate.promotedAt))
      .sort((left, right) => right.promotedAt - left.promotedAt);
  } catch {
    return null;
  }
  const exactOwnerSuffix = `-${createHash("sha256")
    .update(job.id)
    .digest("hex")
    .slice(0, 16)}`;
  const exactOwned = candidates.find((candidate) =>
    candidate.name.endsWith(exactOwnerSuffix),
  );
  if (exactOwned) return exactOwned.path;

  const snapshotted = candidates.find((candidate) =>
    fs.existsSync(learnRunSnapshotDir(candidate.path, job.id)),
  );
  if (snapshotted) return snapshotted.path;
  return null;
}

/**
 * Recover work whose process disappeared. This is intentionally run by the
 * Node startup sweeper, never by a GET/status request: status remains a pure
 * read, while a stale job still becomes retryable after a restart. A recovery
 * must own the same fenced garden lease before touching either SQLite or files.
 */
export async function recoverAbandonedLearnJobs({
  contentPath,
  nowMs = Date.now(),
}: {
  contentPath: string;
  nowMs?: number;
}): Promise<{ recoveredJobIds: string[]; skippedJobIds: string[] }> {
  ensureLearnTables();
  await recoverInterruptedLearnClears(contentPath);
  const cutoff = new Date(nowMs - LEARN_JOB_ABANDONED_AFTER_MS).toISOString();
  const candidates = db
    .prepare(
      `SELECT rowid AS job_rowid, id, garden_id, mode, status, current_step, created_at, updated_at
       FROM learn_jobs
       WHERE updated_at <= ?
         AND (
           status IN (
             'idle', 'planning', 'analyzing_issues', 'repairing', 'revalidating',
             'publishing_repair', 'generating_learning_pages',
             'generating_textbook', 'generating_visuals', 'writing_quartz',
             'building_navigation'
           )
           OR (status = 'cancelled' AND current_step = ?)
         )
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(cutoff, LEARN_CANCELLATION_REQUESTED_STEP) as AbandonedLearnJobRow[];
  const recoveredJobIds: string[] = [];
  const skippedJobIds: string[] = [];

  for (const candidate of candidates) {
    try {
      if (!recoverableAbandonedJob(candidate)) continue;
      if (pendingLearnClearOperation(candidate.garden_id)) {
        skippedJobIds.push(candidate.id);
        continue;
      }
      const gardenDir = clusterPath(contentPath, candidate.garden_id);
      const leaseResult = acquireGardenLearnLease(gardenDir, {
        gardenSlug: candidate.garden_id,
        jobId: candidate.id,
        buildId: `recovery:${candidate.id}`,
      });
      if (!leaseResult.acquired) {
        skippedJobIds.push(candidate.id);
        continue;
      }
      const lease = leaseResult.lease;
      try {
        const current = db
          .prepare("SELECT rowid AS job_rowid, id, garden_id, mode, status, current_step, created_at, updated_at FROM learn_jobs WHERE id = ?")
          .get(candidate.id) as AbandonedLearnJobRow | undefined;
        if (
          !current ||
          !recoverableAbandonedJob(current) ||
          Date.parse(current.updated_at) > Date.parse(cutoff)
        ) {
          skippedJobIds.push(candidate.id);
          continue;
        }

        const newerJob = db
          .prepare(
            `SELECT rowid AS job_rowid, id, garden_id, mode, status, current_step, created_at, updated_at
             FROM learn_jobs
             WHERE garden_id = ?
               AND (created_at > ? OR (created_at = ? AND rowid > ?))
             ORDER BY created_at DESC, rowid DESC
             LIMIT 1`,
          )
          .get(
            current.garden_id,
            current.created_at,
            current.created_at,
            current.job_rowid,
          ) as AbandonedLearnJobRow | undefined;
        if (newerJob) {
          const newerVersionCommitted = Boolean(
            db.prepare(
              "SELECT 1 FROM learn_versions WHERE garden_id = ? AND job_id = ? LIMIT 1",
            ).get(current.garden_id, newerJob.id),
          );
          const newerGardenStateCommitted =
            newerJob.status === "awaiting_confirmation" ||
            (newerJob.status === "complete" &&
              (newerJob.mode === "repair" || newerVersionCommitted));
          if (newerGardenStateCommitted) {
            if (!lease.heartbeat()) {
              throw new LearnPipelineConflictError(
                "Abandoned-job recovery lost its lease before recording a superseded job.",
              );
            }
            const wasCancellation = current.status === "cancelled";
            updateLearnJobExpectStatus(
              current.id,
              wasCancellation
                ? {
                    status: "cancelled",
                    currentStep: `Cancelled operation superseded by newer Learn job ${newerJob.id}; no rollback applied`,
                    error: undefined,
                  }
                : {
                    status: "failed",
                    currentStep: `Interrupted operation superseded by newer Learn job ${newerJob.id}; no rollback applied`,
                    error:
                      "A newer Learn result was committed, so recovery preserved that newer garden instead of restoring this older snapshot.",
                  },
            );
            appendLearnEvent(
              contentPath,
              current.garden_id,
              "learn_abandoned_job_superseded",
              { jobId: current.id, newerJobId: newerJob.id },
            );
            recoveredJobIds.push(current.id);
            continue;
          }
          if (learnJobNeedsExclusiveResolution(newerJob)) {
            skippedJobIds.push(current.id);
            continue;
          }
        }

        const previousGarden = previousGardenForAbandonedJob(gardenDir, current);
        if (previousGarden) {
          await restorePreviousPromotedGarden(
            gardenDir,
            previousGarden,
            () => lease.heartbeat(),
          );
        }
        const hasRollbackSnapshot = Boolean(
          resolveLearnRunSnapshot(gardenDir, candidate.id),
        );
        if (
          !previousGarden &&
          !hasRollbackSnapshot &&
          current.status !== "idle"
        ) {
          throw new Error(
            "No exact retained garden or Learn snapshot exists; automatic recovery refused to guess.",
          );
        }
        const rollback = await rollbackLearnRun({
          gardenId: candidate.garden_id,
          contentPath,
          jobId: candidate.id,
          lease,
        });
        const publicationToken = queueLearnPublicationRetry(
          candidate.garden_id,
          "abandoned Learn job recovery",
          new Error("Publication pending"),
        );
        const cancellationRecovery = current.status === "cancelled";
        updateLearnJobExpectStatus(candidate.id, cancellationRecovery
          ? {
              status: "cancelled",
              currentStep: "Cancelled; latest Learn changes rolled back",
              error: undefined,
            }
          : {
              status: "failed",
              currentStep: "Unresponsive Learn worker recovered; prior Learn state restored",
              error: "Learn stopped responding before completion. Your garden was restored and is safe to retry.",
            });
        discardLearnRunSnapshot({
          gardenId: candidate.garden_id,
          contentPath,
          jobId: candidate.id,
        });
        appendLearnEvent(contentPath, candidate.garden_id, "learn_abandoned_job_recovered", {
          jobId: candidate.id,
          restoredPromotedGarden: Boolean(previousGarden),
          removedPathCount: rollback.removedPaths.length,
          restoredPathCount: rollback.restoredPaths.length,
          deletedMaps: rollback.deletedMaps,
          deletedVersions: rollback.deletedVersions,
        });
        try {
          await publishQuartzAfterMutation(
            `recovered abandoned Learn operation in ${candidate.garden_id}`,
            { requireSuccess: true },
          );
          clearLearnPublicationRetry(candidate.garden_id, publicationToken);
        } catch (error) {
          queueLearnPublicationRetry(
            candidate.garden_id,
            "abandoned Learn job recovery",
            error,
          );
          appendLearnEvent(
            contentPath,
            candidate.garden_id,
            "learn_abandoned_job_republish_failed",
            { jobId: candidate.id, error: errorMessage(error) },
          );
        }
        const abandonedWorkspace = defaultWorkspaceRoot(
          candidate.garden_id,
          candidate.id,
        );
        try {
          fs.rmSync(abandonedWorkspace, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(
            `[learn] Abandoned workspace remains at ${abandonedWorkspace}:`,
            cleanupError,
          );
        }
        recoveredJobIds.push(candidate.id);
      } finally {
        lease.release();
      }
    } catch (error) {
      if (!skippedJobIds.includes(candidate.id)) skippedJobIds.push(candidate.id);
      console.error(
        `[learn] Could not recover abandoned job ${candidate.id}; continuing sweep:`,
        error,
      );
      try {
        appendLearnEvent(
          contentPath,
          candidate.garden_id,
          "learn_abandoned_job_recovery_failed",
          { jobId: candidate.id, error: errorMessage(error) },
        );
      } catch {
        // A corrupt/unreadable garden must not prevent later candidates from
        // being recovered by this sweep.
      }
    }
  }

  // Publication retries run only after abandoned filesystem/database work has
  // been reconciled. Publishing first could expose an uncommitted promoted tree.
  await recoverPendingLearnPublications(contentPath);
  return { recoveredJobIds, skippedJobIds };
}

function activeStatus(status: LearnStatus): boolean {
  return [
    "planning",
    "analyzing_issues",
    "repairing",
    "revalidating",
    "publishing_repair",
    "generating_learning_pages",
    "generating_textbook",
    "generating_visuals",
    "writing_quartz",
    "building_navigation",
  ].includes(status);
}

function recoverableLearnStatus(status: LearnStatus): boolean {
  return status === "idle" || activeStatus(status);
}

function buttonLabelForSnapshot({
  latestJob,
  confirmedMap,
  latestVersion,
  hasTextbook,
  sourceSetChanged,
}: {
  latestJob: LearnJob | null;
  confirmedMap: StoredLearningMap | null;
  latestVersion: LearnVersionRow | null;
  hasTextbook: boolean;
  sourceSetChanged: boolean;
}): string {
  if (latestJob && activeStatus(latestJob.status)) return "Learning...";
  if (latestJob?.status === "awaiting_confirmation") {
    return hasTextbook || latestVersion ? "Repair issues" : "Review Learning Map";
  }
  if (sourceSetChanged && (hasTextbook || latestVersion)) return "Learn";
  if (confirmedMap && !latestVersion) return "Learn";
  if (hasTextbook || latestVersion) return "Repair issues";
  return "Learn";
}

const LEARN_STATUS_CONTEXT_CACHE_TTL_MS = 5_000;
const learnStatusContextCache = new Map<
  string,
  { context: LearnSourceContext; expiresAt: number }
>();

function collectLearnStatusContext(
  contentPath: string,
  gardenId: string,
): LearnSourceContext {
  const key = `${path.resolve(contentPath)}\0${gardenId}`;
  const now = Date.now();
  const cached = learnStatusContextCache.get(key);
  if (cached && cached.expiresAt > now) return cached.context;
  const context = collectLearnSourceContext(contentPath, gardenId);
  learnStatusContextCache.delete(key);
  learnStatusContextCache.set(key, {
    context,
    expiresAt: now + LEARN_STATUS_CONTEXT_CACHE_TTL_MS,
  });
  while (learnStatusContextCache.size > 64) {
    const oldestKey = learnStatusContextCache.keys().next().value as
      | string
      | undefined;
    if (!oldestKey) break;
    learnStatusContextCache.delete(oldestKey);
  }
  return context;
}

export function getLearnStatusSnapshot({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): LearnStatusSnapshot {
  ensureLearnTables();
  const context = collectLearnStatusContext(contentPath, gardenId);
  const latestJob = getLatestLearnJob(gardenId);
  const latestProposed = latestJob?.proposedLearningMapId
    ? getLearnMapById(latestJob.proposedLearningMapId, gardenId)
    : getLatestProposedLearnMap(gardenId);
  const contractProposed = isContractBackedLearningMap(latestProposed) ? latestProposed : null;
  const visibleJob =
    latestJob?.status === "awaiting_confirmation" && !contractProposed
      ? null
      : latestJob;
  const workflowTimer = visibleJob ? learnTimerForWorkflow(visibleJob) : null;
  const visibleJobWithWorkflowUsage = visibleJob && workflowTimer
    ? {
        ...visibleJob,
        tokenUsage: learnTokenUsageForWorkflow(visibleJob),
        elapsedMs: workflowTimer.elapsedMs,
        timerStartedAt: workflowTimer.timerStartedAt,
      }
    : null;
  const latestConfirmed = getLatestConfirmedLearnMap(gardenId);
  const confirmedMap = isContractBackedLearningMap(latestConfirmed) ? latestConfirmed : null;
  const latestVersion = getLatestLearnVersion(gardenId);
  const hasTextbook = context.existingTextbookPages.length > 0;
  const availableSourceIdSet = new Set(context.sources.map((source) => source.slug));
  const persistedSelectedSourceIds =
    (visibleJob?.sourceIds.length ? visibleJob.sourceIds : undefined) ??
    (contractProposed?.sourceIds.length ? contractProposed.sourceIds : undefined) ??
    (confirmedMap?.sourceIds.length ? confirmedMap.sourceIds : undefined);
  const selectedSourceIds = persistedSelectedSourceIds
    ? persistedSelectedSourceIds.filter((sourceId) => availableSourceIdSet.has(sourceId))
    : context.sources.map((source) => source.slug);
  const persistedSyllabusSourceId =
    visibleJob?.syllabusSourceId ??
    contractProposed?.syllabusSourceId ??
    confirmedMap?.syllabusSourceId ??
    null;
  // A syllabus the user has since deleted is reported as none, so the panel
  // never shows a designation that no longer resolves to a document.
  const syllabusSourceId =
    persistedSyllabusSourceId && availableSourceIdSet.has(persistedSyllabusSourceId)
      ? persistedSyllabusSourceId
      : null;
  const persistedCoverage =
    contractProposed?.syllabusCoverage ?? confirmedMap?.syllabusCoverage ?? null;
  const syllabusCoverage =
    syllabusSourceId && persistedCoverage
      ? {
          ...summarizeSyllabusCoverage(persistedCoverage),
          missingCitations: persistedCoverage.missingCitations,
        }
      : null;

  const versionMapCandidate = latestVersion
    ? getLearnMapById(latestVersion.learning_map_id, gardenId)
    : null;
  const versionMap = isContractBackedLearningMap(versionMapCandidate)
    ? versionMapCandidate
    : null;
  let sourceSetChanged = Boolean(latestVersion && !versionMap);
  const sourceBindingMap = latestVersion
    ? versionMap
    : contractProposed ?? confirmedMap;
  if (sourceBindingMap) {
    try {
      const selectedSources = selectLearnSources(
        context.sources,
        sourceBindingMap.sourceIds.length ? sourceBindingMap.sourceIds : undefined,
      );
      const syllabus = selectLearnSyllabus(
        context.sources,
        sourceBindingMap.syllabusSourceId,
      );
      const teachingSources = excludeSyllabusFromSources(selectedSources, syllabus);
      if (syllabus && teachingSources.length === 0) {
        throw new Error("The saved source selection no longer contains teaching material.");
      }
      const baseCurrentHash = sourceSetHashWithSyllabus(
        sourceSetHashForSources(teachingSources),
        syllabus,
      );
      let currentHash = baseCurrentHash;
      const selectedSourceOrder = teachingSources.map((source) => source.slug);
      const sourceIdentityMap = resolveSourceVisualSourceIdentityMap({
        contentPath,
        gardenSlug: gardenId,
        sourceIds: selectedSourceOrder,
        persist: false,
      });
      const selectedTeachingSourceIds = new Set(selectedSourceOrder);
      const ledgerVisuals = loadSourceVisuals(contentPath, gardenId);
      const formulaIds = ledgerVisuals
        .filter((visual) => selectedTeachingSourceIds.has(visual.sourceId) && visual.type === "equation")
        .map((visual) => visual.sourceVisualId)
        .sort();
      const manifest = loadSourceFormulaReviewSetManifest(contentPath, gardenId);
      if (
        manifest &&
        manifest.baseSourceSetHash === baseCurrentHash &&
        JSON.stringify(manifest.sourceIds) === JSON.stringify(selectedSourceOrder) &&
        manifest.sourceIdentityMapHash === sourceVisualSourceIdentityMapHash(sourceIdentityMap) &&
        JSON.stringify(manifest.sourceIdentityMap) === JSON.stringify(sourceIdentityMap) &&
        JSON.stringify(manifest.formulaIds) === JSON.stringify(formulaIds) &&
        computeSourceFormulaReviewSetHash(
          ledgerVisuals,
          formulaIds,
          selectedSourceOrder,
          sourceIdentityMap,
          manifest.topologyReviewPageReceipts,
        ) === manifest.reviewSetHash
      ) {
        currentHash = sourceSetHashWithReviewedFormulas(baseCurrentHash, manifest.reviewSetHash);
      }
      const currentArtifactInventoryHash = selectedSourceArtifactInventorySnapshot({
        selectedSourceIds: selectedSourceOrder,
        sourceIdentityMap,
        visuals: ledgerVisuals,
      }).sourceArtifactInventoryHash;
      const expectedSourceSetHash = latestVersion
        ? latestVersion.source_set_hash
        : sourceBindingMap.sourceSetHash;
      const expectedArtifactInventoryHash = latestVersion
        ? latestVersion.source_artifact_inventory_hash
        : sourceBindingMap.sourceArtifactInventoryHash;
      sourceSetChanged =
        expectedSourceSetHash !== currentHash ||
        !/^[0-9a-f]{64}$/.test(expectedArtifactInventoryHash) ||
        expectedArtifactInventoryHash !== currentArtifactInventoryHash ||
        (latestVersion !== null &&
          (latestVersion.source_set_hash !== sourceBindingMap.sourceSetHash ||
            latestVersion.source_artifact_inventory_hash !==
              sourceBindingMap.sourceArtifactInventoryHash));
    } catch {
      // A selected source/artifact was removed or its durable identity became invalid.
      sourceSetChanged = true;
    }
  }

  return {
    job: visibleJobWithWorkflowUsage,
    proposedLearningMap:
      visibleJob?.status === "awaiting_confirmation" || contractProposed?.status === "proposed"
        ? contractProposed?.learningMap ?? null
        : null,
    confirmedLearningMapId: confirmedMap?.id,
    latestTextbookVersionId: latestVersion?.id,
    hasSources: context.sources.length > 0,
    sourceCount: context.sources.length,
    selectedSourceIds,
    selectedSourceCount: selectedSourceIds.length,
    syllabusSourceId,
    syllabusCoverage,
    hasTextbook,
    sourceSetChanged,
    buttonLabel: buttonLabelForSnapshot({
      latestJob: visibleJob,
      confirmedMap,
      latestVersion,
      hasTextbook,
      sourceSetChanged,
    }),
    validationReport: visibleJob?.status === "failed"
      ? getLearnValidationReport({ gardenId, contentPath })
      : null,
    scopedRepair: getLearnScopedRepairSummary(gardenId, contentPath),
  };
}
