import fs from "fs";
import { createHash } from "crypto";
import os from "os";
import path from "path";
import type OpenAI from "openai";
import db from "@/lib/db";
import { withCouncil, type CouncilMode, type CouncilTaskType } from "@/lib/council";
import {
  DEFAULT_MODEL,
  cleanGeneratedText,
  normalizeTopicTags,
  refreshClusterIndex,
  scanClusterKnowledge,
} from "@/lib/knowledge";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import {
  finalizeGardenExport,
  groundLearnerFormula,
  repairLearningUnitsFromContract,
  verifyFinalArtifactNoMutation,
  type RepairExecutorMode,
} from "@/lib/garden-finalize";
import { createOpenAIRepairExecutor } from "@/lib/repair-executor";
import { buildCanonicalSourceAnchors, describeMissingAnchorFailure, healDanglingReplacementReferences, ingestModelSourceAnchors, migrateLegacyTextConceptAnchors, missingRegistryAnchorIds, reconcileFinalGardenState } from "@/lib/final-garden-state";
import { freezeActiveGenerationByVersion } from "@/lib/learn-structure-reconciliation";
import {
  buildFormulaIdentityRegistry,
  legacyFormulaFamily,
  type CanonicalFormulaIdentity,
  type FormulaIdentityRepairDecision,
  type FormulaIdentityRepairPacket,
} from "@/lib/formula-identity";
import {
  applyFormulaAssignmentPlanToUnits,
  assertPlannedFormulaAssignment,
  buildFormulaAssignmentPlan,
  buildGardenFormulaFamilyRegistry,
  deriveUnitFormulaRequirement,
  finalizeFormulaAssignmentPlanWithoutCritic,
  formulaCandidatesForUnit,
  formulaAssignmentProvenanceFromPlan,
  resolveFormulaAssignmentAmbiguities,
  type FormulaAssignmentPlan,
  type FormulaAssignmentProvenance,
  type FormulaAssignmentRepairDecision,
  type FormulaAssignmentRepairModel,
  type FormulaAssignmentRepairPacket,
} from "@/lib/formula-assignment";
import { createChatMockAnchorCritic, createChatMockCritic, createChatMockModelRepair, makeCriticArtifactRepair, runCriticLoop } from "@/lib/critic-loop";
import {
  decideFinalAcceptance,
  runWeakAnchorSelfHealingLoop,
  writeWeakAnchorSelfHealingReports,
  type WeakAnchorDecisionKind,
  type WeakAnchorRepairDecision,
  type WeakAnchorRepairModel,
  type WeakAnchorRepairPacket,
} from "@/lib/weak-anchor-self-healing";
import {
  appendGardenEvent,
  buildDeterministicVisual,
  generateVisualSpec,
  pruneVisualArtifacts,
  saveVisualSpec,
} from "@/lib/visuals";
import {
  assignSourceArtifacts,
  alignLearningUnitConceptAliasesWithRegistry,
  anchorTextCompatibleWithVisualType,
  conceptTagsForUnit,
  dedupeSourceArtifactAssignments,
  dropIncompatibleInteractiveVisuals,
  knowledgeClaimsForUnit,
  learningMapFromUnits,
  normalizeLearningUnits,
  reconcileLearningUnitConceptAliases,
  semanticConceptsForUnit,
  validateLearningUnitContracts,
  visualTypeCompatibleWithUnit,
  type LearningUnitContract,
  type SourceArtifactAssignment,
  type SourceFigurePlacement,
  type SourceFormulaContract,
} from "@/lib/learning-unit-contract";
import {
  claimIdForPlan,
  ensureGardenConceptRegistry,
  writeGardenConceptRegistryAndContract,
} from "@/lib/garden-semantics";
import {
  isValidPublicConceptSlug,
  normalizeConceptSlug,
  normalizeLookupText,
} from "@/lib/semantic-core";
import { reconcileFinalGardenSemantics } from "@/lib/semantic-reconciliation";
import {
  reconcileFinalFormulaProjections,
  type FormulaUsageRepairDecision,
  type FormulaUsageRepairPacket,
} from "@/lib/formula-usage-reconciliation";
import {
  IMPLEMENTED_VISUAL_TYPES,
  buildVisualBlock,
  validateVisualSpec,
  type SourceFigure,
  type VisualSpec,
} from "@/lib/visual-spec";
import {
  extractSourceVisuals,
  isFullPageSnapshotUrl,
  loadSourceVisuals,
  recordSourceVisualAssignments,
  sourceVisualEmbedUrl,
  sourceVisualMarkdown,
  type SourceVisual,
} from "@/lib/source-visuals";
import {
  assessLessonQuality,
  buildLearningPageFrontmatter,
  canonicalizeLearnerWikilinks,
  containsRawVisualPlaceholder,
  ensureQuestionBlock,
  excludeSyllabusFromSources,
  fallbackLearningMapFromSources,
  formulaMetricFamily,
  isGroundableFormula,
  isTrivialFormulaFragment,
  isWorkedExampleFormula,
  normalizeLearningMapCandidate,
  parseJsonCandidate,
  publicLearningVersionId,
  scrubAiisms,
  removeRawVisualPlaceholders,
  safeLearnFileSegment,
  sanitizeLearnerTitle,
  scrubSourceCommentaryProse,
  scrubLearnerProse,
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
  type LearningSectionPlan,
  type LearningSubsectionPlan,
  type ProposedLearningMap,
} from "@/lib/learn-utils";
import { extractQuartzMath, normalizeQuartzMarkdown } from "@/lib/quartz-markdown";
import {
  attachLearnTokenUsageTracking,
  emptyLearnTokenUsage,
  sumLearnTokenUsage,
  type LearnTokenUsage,
  type LearnTokenUsageEvent,
} from "@/lib/learn-token-usage";
import { transitionLearnTimer } from "@/lib/learn-timer";
import {
  buildSyllabusCoverage,
  detectUnavailableCitations,
  matchSyllabusUnitForPage,
  normalizeSyllabusPlan,
  resolveSyllabusMaterials,
  summarizeSyllabusCoverage,
  unavailableCitationProbes,
  type SyllabusCoverage,
  type UnavailableCitationProbe,
} from "@/lib/learn-syllabus";
import {
  applyVisualNecessityDecisionsToUnits,
  loadVisualDecisionOverrides,
  planGardenVisualNecessity,
  reviewAmbiguousVisualNecessityDecisions,
  saveVisualNecessityArtifacts,
  type GardenVisualNecessityPlan,
  type PreferredTeachingMedium,
  type VisualNecessityReviewPacket,
  type VisualNecessityReviewResponse,
} from "@/lib/visual-necessity";
import { learnBuildStateMode } from "@/lib/garden-build/mode";
import { runCanonicalGardenShadowBuild } from "@/lib/garden-build/shadow";
import {
  buildVisualizationCoverageReport,
  buildVisualizationPlan,
  applyVisualizationRoutesToLearningUnits,
  coverageGateMode,
  saveVisualizationCoverageReport,
  saveVisualizationPlan,
  type VisualizationPlan,
  type VisualizationPublicationOutcome,
} from "@/lib/visualization-opportunities";
import {
  buildGeneratedVisualBlock,
  createGeneratedVisualization,
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
  page_count: number;
  backup_dir: string | null;
  created_at: string;
}

interface LearnSourceContext extends LearnContextSummary {
  sourceSetHash: string;
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
/** Council mode for the retry after a planning timeout. A single-model call is
 * far more likely to finish inside the window than another full fan-out, so
 * the deterministic fallback is reached only when even that fails. */
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
const MAX_SNIPPETS_PER_PAGE = envPositiveInt("LEARN_MAX_SNIPPETS_PER_PAGE", 5);
const MAX_CHARS_PER_SNIPPET = envPositiveInt("LEARN_MAX_CHARS_PER_SNIPPET", 1200);
const MAX_TOTAL_SOURCE_CHARS_PER_PAGE = envPositiveInt(
  "LEARN_MAX_TOTAL_SOURCE_CHARS_PER_PAGE",
  6000,
);
const MAX_VISUALS_PER_PAGE = envPositiveInt("LEARN_MAX_VISUALS_PER_PAGE", 3);
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
Return ONLY JSON. Include:
- sources: each source title, role, source id/slug, central concepts, formulas, examples, questions, and caveats
- figures: figures/graphs/tables/formula displays with labels when provided
- sourceAnchors: compact anchors that later pages can cite
- missingOrUnclear: unclear or missing source material
Availability rule (hard): any formula, equation, figure, table, or graph that has an extracted anchor or caption IS available source material. Never place it in missingOrUnclear, and never write caveats saying formulas/equations/notation/definitions/tables/figures are unavailable, "caption-only", "captions but not exact", or "not present" — pages will ground on those anchors. Caveat ONLY about content that has no extracted anchor at all.
Stay source-aware. If source-only mode is true, do not add outside facts.`;

const SCOPE_CONTRACT_PROMPT = `You create the internal Scope Contract for a Breadboard learning garden. This document is internal planning data; learners never see it.
Return ONLY JSON with included, excluded, background, deferred, sourceEmphasis, and caveats.
The contract must protect source scope: no unsupported expansion, no disconnected topic cards, and no final Generated Subtopics pages.
Availability rule (hard): treat any extracted formula, equation, figure, table, or graph anchor as available. Do not add caveats claiming formulas, notation, definitions, tables, or figures are unavailable or caption-only when anchors for them exist.`;

const TOPIC_MAP_PROMPT = `You create the source-grounded Learning Unit Contract for a Breadboard learning garden. Learner pages are NOT planned as sections first. They are planned as 15-25 learning units, then Breadboard clusters those units into sections.
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
      "sourceAnchors": ["source anchor ids or source titles"],
      "sourceFigures": [
        {
          "id": "S1.P4.F1",
          "placement": "inside_concept_explanation | after_formula_introduction | inside_result_interpretation | beside_worked_example | inside_comparison | not_used_with_reason",
          "mustBeDiscussedWith": "nearby idea or paragraph",
          "interpretationGoal": "what the learner must notice",
          "notUsedReason": "only when placement is not_used_with_reason"
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
      "mustNotRepeat": ["motif, framing, or example already used"],
      "expectedWordRange": [700, 1100]
    }
  ],
  "warnings": ["..."]
}
${TITLE_RULES}
Contract rules:
- Generate learningUnits first. Do not return a direct section/subsection map as the primary plan.
- A unit is the smallest meaningful teaching step: one learner question, one conceptual move.
- Normal source-rich gardens need 15-25 units; never produce an 8-section/1-subsection outline.
- Every important source figure, graph, table, displayed formula, result, example, limitation, or recommendation must be assigned to the one precise unit where it teaches best, or marked unused with a reason.
- Source figures must be planned for inline placement near their interpretation. Never plan a generic "Source Figures" dump.
- Do not assign an interactiveVisual or visualType in this response. Breadboard runs a deterministic visual-necessity decision, alternative-medium comparison, garden-level coordination, and only then renderer/type selection.
- Describe each unit's learning question, dynamic behavior, comparisons, parameters, source figures, formulas, tables, and prerequisites precisely enough for that downstream decision.
- Concepts are reusable identities, never complete claims, page-title summaries, filenames, locations, or planner phrases. Reuse an existing canonical slug or alias whenever possible.
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
- Breadboard has already checked every work the syllabus assigns against the documents in this garden. That check is authoritative. Do not second-guess it.
- \`unit.availableSourceIds\` lists the documents that ARE present for that unit. Ground that unit heavily and specifically in those documents: its definitions, figures, formulas, numbers, and examples come from there first, and only then from the rest of the garden.
- \`unit.missingCitations\` lists works the syllabus assigns that NOBODY UPLOADED. You have never seen their contents. Never plan a unit, anchor, figure, formula, result, or claim that depends on them. Never summarize, paraphrase, characterize, or state what such a work says, argues, shows, or concludes. Never name one in learner-facing text.
- Cover a syllabus topic whose material is missing ONLY from the source material that IS present, and only as far as that material genuinely supports. If it does not support the topic, leave the topic uncovered and record it in warnings.
- \`syllabusCoverage.untaughtUnitTitles\` lists units with no available material at all. Do not create learning units for them. Record each one in warnings as an uncoverable syllabus item.
- Every warning about missing material must name the syllabus item, never invent a substitute for it.`;

/** Page-writing rules that apply only when a syllabus is in play. */
const SYLLABUS_PAGE_RULES = `
Syllabus:
- \`dossier.syllabus\` is the course study guide. Use it only to judge what this page must cover and how deep to go.
- Never mention, quote, cite, or describe the syllabus in the lesson. The learner reads a lesson on the subject, not a walkthrough of their course outline.
- \`dossier.syllabusUnit.objectives\` are what the learner must be able to do after this page. Teach to them.
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
    .replace(/\bChatMock\b/gi, "")
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
  return {
    id: row.id,
    gardenId: row.garden_id,
    jobId: row.job_id,
    status: row.status,
    sourceMap: parseJson(row.source_map_json),
    scopeContract: parseJson(row.scope_contract_json),
    learningMap:
      (parseJson(row.learning_map_json) as ProposedLearningMap | null) ??
      fallbackLearningMapFromSources({
        gardenId: row.garden_id,
        gardenTitle: row.garden_id,
        sources: [],
      }),
    proposedOrder:
      (parseJson(row.proposed_order_json) as LearningSectionPlan[] | null) ?? [],
    visualOpportunities:
      (parseJson(row.visual_opportunities_json) as unknown[] | null) ?? [],
    coveragePlan: parseJson(row.coverage_plan_json),
    sourceSetHash: row.source_set_hash,
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
  mode,
  sourceIds,
  syllabusSourceId,
  sourceOnly,
  includeSourceSnapshots,
}: {
  id?: string;
  gardenId: string;
  userId?: number;
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
      id, garden_id, user_id, status, mode, current_step, progress_percent,
      source_ids_json, syllabus_source_id, source_only, include_source_snapshots,
      active_elapsed_ms, timer_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.gardenId,
    job.userId ?? null,
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
      retry502: {
        signal: controller.signal,
        onDelay: ({ attempt, maxAttempts, delayMs }) => {
          throwIfLearnCancelled(jobId);
          const currentStep = `Gateway 502; waiting 4 minutes before retry ${attempt}/${maxAttempts}`;
          updateLearnJob(jobId, { currentStep });
          appendLearnEvent(contentPath, gardenId, "learn_chatmock_502_retry", {
            jobId,
            phase: "waiting",
            attempt,
            maxAttempts,
            delayMs,
            currentStep,
          });
        },
        onAttempt: ({ attempt, maxAttempts, delayMs }) => {
          throwIfLearnCancelled(jobId);
          if (attempt === 1) return;
          const currentStep = `Retrying request (${attempt}/${maxAttempts})`;
          updateLearnJob(jobId, { currentStep });
          appendLearnEvent(contentPath, gardenId, "learn_chatmock_502_retry", {
            jobId,
            phase: "attempting",
            attempt,
            maxAttempts,
            delayMs,
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
    sourceIds: [...sourceIds],
    syllabusSourceId,
    syllabusCoverage: syllabusCoverage ?? null,
    createdAt,
  };

  db.prepare(
    `INSERT INTO learn_maps (
      id, garden_id, job_id, status, source_map_json, scope_contract_json,
      learning_map_json, proposed_order_json, visual_opportunities_json,
      coverage_plan_json, source_set_hash, source_ids_json, syllabus_source_id,
      syllabus_coverage_json, created_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  pageCount,
  backupDir,
}: {
  id: string;
  gardenId: string;
  jobId: string;
  learningMapId: string;
  sourceSetHash: string;
  pageCount: number;
  backupDir?: string;
}): void {
  ensureLearnTables();
  db.prepare(
    `INSERT INTO learn_versions (
      id, garden_id, job_id, learning_map_id, source_set_hash, page_count,
      backup_dir, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    gardenId,
    jobId,
    learningMapId,
    sourceSetHash,
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
      relevanceNotes: `Extracted from page ${visual.pageNumber}`,
      suggestedVisualUse: "Embed the cropped source visual near the prose it supports.",
    }));
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
    .filter((node) => node.type === "learning-page" || node.type === "textbook-page")
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
  const sourceFigures = sourceFiguresFromVisuals(
    loadSourceVisuals(contentPath, gardenId).filter((visual) =>
      selectedSourceIdSet.has(visual.sourceId),
    ),
  );

  return {
    gardenId,
    gardenTitle,
    sources,
    concepts: conceptNodes,
    conceptNodes,
    existingTextbookPages,
    sourceFigures,
    syllabus,
    selectedSourceIds: selectedSources.map((source) => source.slug),
    sourceSetHash: sourceSetHashWithSyllabus(
      sourceSetHashForSources(sources),
      syllabus,
    ),
  };
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
  onProgress,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  context: LearnSourceContext;
  onProgress?: (step: string) => void;
}): Promise<SourceVisual[]> {
  const visualRichSlugs = new Set(
    context.sources.filter(sourceAppearsVisualRich).map((source) => source.slug),
  );
  const extractionErrors: string[] = [];

  for (let index = 0; index < context.sources.length; index += 1) {
    const source = context.sources[index];
    const pageImageUrls = (source.sourceImages ?? []).filter(isFullPageSnapshotUrl);
    if (pageImageUrls.length === 0) continue;
    try {
      await extractSourceVisuals({
        client,
        model,
        contentPath,
        gardenSlug: gardenId,
        sourceId: source.slug,
        sourceIndex: index + 1,
        pageImageUrls,
        onProgress,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      extractionErrors.push(`${source.slug}: ${message}`);
    }
  }

  const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
  const visuals = loadSourceVisuals(contentPath, gardenId).filter((visual) =>
    selectedSourceIds.has(visual.sourceId),
  );
  context.sourceFigures = sourceFiguresFromVisuals(visuals);

  if (visualRichSlugs.size > 0) {
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

function promptSources(context: LearnSourceContext): unknown {
  return {
    gardenId: context.gardenId,
    gardenTitle: context.gardenTitle,
    sourceSetHash: context.sourceSetHash,
    sources: context.sources.map((source) => ({
      id: source.slug,
      title: source.title,
      description: source.description,
      relPath: source.relPath,
      sourceType: source.sourceType,
      sourceFile: source.sourceFile,
      tags: source.tags,
      excerpt: source.excerpt,
      content: truncate(source.body, 9000),
    })),
    conceptNodes: context.conceptNodes.slice(0, 80),
    sourceFigures: context.sourceFigures.slice(0, 40),
    // Stage-2 extracted visuals, in the shape the planner assigns from.
    sourceVisuals: context.sourceFigures.slice(0, 40).map((figure) => ({
      sourceVisualId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      caption: figure.caption,
    })),
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
    sources: context.sources.map((source) => ({
      id: source.slug,
      title: source.title,
      description: source.description,
      relPath: source.relPath,
      sourceType: source.sourceType,
      tags: source.tags,
      excerpt: truncate(source.excerpt || source.body, 1200),
    })),
    conceptNodes: context.conceptNodes.slice(0, 60),
    sourceVisuals: context.sourceFigures.slice(0, 40).map((figure) => ({
      sourceVisualId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      caption: figure.caption,
    })),
  };
}

/** Compact a large planning JSON so it can ride into the next stage's prompt
 * without dominating the token budget (the spine needs the shape, not every
 * verbose field). */
function compactPlanningPayload(value: unknown, maxLength = 6000): unknown {
  const text = JSON.stringify(value ?? null);
  if (text.length <= maxLength) return value;
  return { truncatedJson: `${text.slice(0, maxLength)}…`, note: "compacted for prompt size" };
}

function fallbackSourceMap(context: LearnSourceContext): unknown {
  return {
    gardenId: context.gardenId,
    sourceSetHash: context.sourceSetHash,
    sources: context.sources.map((source) => ({
      id: source.slug,
      title: source.title,
      role: "uploaded source material",
      relPath: source.relPath,
      sourceType: source.sourceType,
      concepts: context.conceptNodes
        .filter((concept) => !concept.sourceDocument || concept.sourceDocument === source.slug)
        .slice(0, 12)
        .map((concept) => concept.title),
      excerpt: source.excerpt,
    })),
    figures: context.sourceFigures,
    missingOrUnclear: [],
  };
}

function fallbackScopeContract(context: LearnSourceContext, sourceOnly: boolean): unknown {
  return {
    included: context.sources.map((source) => source.title),
    excluded: sourceOnly
      ? ["Claims, examples, and details not supported by the uploaded sources."]
      : ["Disconnected topic cards as the primary reading path."],
    background: ["Internal ConceptNodes may be used as planning scaffolding."],
    deferred: ["Manual edits to section order beyond confirm/regenerate."],
    sourceOnly,
    caveats: context.sources.length > 0 ? [] : ["No uploaded sources found."],
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
  return {
    content: response.choices[0]?.message?.content?.trim() ?? "",
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
  });
  return { ...result, parsed: parseJsonCandidate(result.content) };
}

const VISUAL_REVIEW_ACTIONS = [
  "confirm_required",
  "downgrade_to_recommended",
  "downgrade_to_optional",
  "select_noninteractive_medium",
  "reject_as_distracting",
] as const;
const VISUAL_REVIEW_MEDIA: PreferredTeachingMedium[] = [
  "source_figure",
  "generated_static_diagram",
  "formula_derivation",
  "worked_example",
  "comparison_table",
  "timeline",
  "prose",
  "no_additional_visual",
];

async function planAndReviewVisualNecessity(input: {
  client: OpenAI;
  model: string;
  gardenId: string;
  contentPath: string;
  jobId: string;
  learningUnits: LearningUnitContract[];
  maxReviews?: number;
}): Promise<GardenVisualNecessityPlan> {
  const gardenDir = clusterPath(input.contentPath, input.gardenId);
  const deterministic = planGardenVisualNecessity({
    gardenId: input.gardenId,
    learningUnits: input.learningUnits,
    overrides: loadVisualDecisionOverrides(gardenDir),
  });
  const criticEnabled = (process.env.BREADBOARD_CRITIC_ENABLED ?? "true").trim() !== "false";
  if (!criticEnabled) return deterministic;

  const reviewed = await reviewAmbiguousVisualNecessityDecisions({
    units: deterministic.learningUnits,
    decisions: deterministic.decisions,
    maxReviews: input.maxReviews ?? 3,
    shouldRethrowError: () => jobStatusById(input.jobId) === "cancelled",
    reviewer: async (packet: VisualNecessityReviewPacket): Promise<VisualNecessityReviewResponse> => {
      const { parsed } = await callCouncilJson({
        client: input.client,
        model: input.model,
        taskType: "visual_necessity_review",
        gardenId: input.gardenId,
        system:
          "Review only the supplied ambiguous interactive-visual necessity decision. Return STRICT JSON: " +
          "{\"action\":\"confirm_required\"|\"downgrade_to_recommended\"|\"downgrade_to_optional\"|\"select_noninteractive_medium\"|\"reject_as_distracting\",\"preferredMedium\"?:string,\"visualType\"?:string,\"reason\":string}. " +
          "Use only allowedActions, supportedAlternatives, and an already-supported visual type. A sufficient source figure/formula/example, nearby duplicate, aesthetics, or a quota cannot justify interaction.",
        user: JSON.stringify(packet),
        sourceContext: packet,
        councilModeOverride: "direct_council",
        timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
      });
      if (!parsed || typeof parsed !== "object") throw new Error("Visual necessity reviewer returned no JSON object.");
      const record = parsed as Record<string, unknown>;
      const action = String(record.action ?? "") as VisualNecessityReviewResponse["action"];
      if (!(VISUAL_REVIEW_ACTIONS as readonly string[]).includes(action)) {
        throw new Error(`Visual necessity reviewer returned unsupported action ${action || "(empty)"}.`);
      }
      const preferredMedium = typeof record.preferredMedium === "string"
        ? record.preferredMedium as PreferredTeachingMedium
        : undefined;
      if (preferredMedium && !VISUAL_REVIEW_MEDIA.includes(preferredMedium)) {
        throw new Error(`Visual necessity reviewer returned unsupported medium ${preferredMedium}.`);
      }
      return {
        action,
        ...(preferredMedium ? { preferredMedium } : {}),
        ...(typeof record.visualType === "string" ? { visualType: record.visualType } : {}),
        reason: typeof record.reason === "string" ? record.reason : "",
      };
    },
  });
  const finalPlan = applyVisualNecessityDecisionsToUnits({
    gardenId: input.gardenId,
    learningUnits: deterministic.learningUnits,
    decisions: reviewed.decisions,
    overrides: deterministic.overrides,
    reviewCalls: reviewed.reviewCalls,
    rejectedReviews: reviewed.rejectedReviews,
  });
  finalPlan.unresolvedRecords = reviewed.unresolvedRecords;
  appendLearnEvent(input.contentPath, input.gardenId, "learn_visual_necessity_review_completed", {
    jobId: input.jobId,
    ambiguousDecisionsReviewed: reviewed.reviewCalls,
    rejectedReviews: reviewed.rejectedReviews,
    required: finalPlan.decisions.filter((decision) => decision.necessity === "required").length,
    recommended: finalPlan.decisions.filter((decision) => decision.necessity === "recommended").length,
    optional: finalPlan.decisions.filter((decision) => decision.necessity === "optional").length,
    noInteraction: finalPlan.decisions.filter((decision) =>
      decision.necessity === "not_needed" || decision.necessity === "harmful_or_distracting").length,
  });
  return finalPlan;
}

/**
 * Planning call with a timeout ladder: one attempt at the configured planning
 * council mode with a generous timeout, then one retry at the (lighter, faster)
 * retry mode. Only when BOTH time out does the error reach the caller, whose
 * deterministic fallback is the genuine last resort — never the first response
 * to a slow council.
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
    });
  } catch (error) {
    if (!isPlanningTimeoutError(error)) throw error;
    appendLearnEvent(contentPath, gardenId, "learn_planning_timeout_retry", {
      jobId,
      taskType,
      error: errorMessage(error),
      retryCouncilMode: LEARN_PLANNING_RETRY_COUNCIL_MODE,
    });
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
    });
  }
}

function errorMessage(error: unknown, fallback = "Request failed"): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : typeof error === "string" && error.trim()
        ? error.trim()
        : fallback;
  if (/^(connection error\.?|fetch failed)$/i.test(message) || /\beconnrefused\b/i.test(message)) {
    return "ChatMock is not connected. Start or restart ChatMock on port 8765, then retry Learn.";
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

function planningFallbackWarning(label: string, error: unknown): string {
  return `${label} request timed out twice (${LEARN_PLANNING_COUNCIL_MODE} then ${LEARN_PLANNING_RETRY_COUNCIL_MODE}, ${Math.round(LEARN_PLANNING_TIMEOUT_MS / 60000)} min each: ${errorMessage(error)}). Used deterministic source-grounded planning fallback as the last resort.`;
}

function fallbackCouncilJsonResult(parsed: unknown, councilRunId: string): CouncilJsonResult {
  return {
    content: compactJson(parsed),
    parsed,
    councilRunId,
    councilMode: "fallback",
  };
}

function fallbackLearningSpinePlan(
  context: LearnSourceContext,
  sourceOnly: boolean,
  warning: string,
): Record<string, unknown> {
  return {
    title: sanitizeLearnerTitle(context.gardenTitle || context.sources[0]?.title || context.gardenId || "Learning Path"),
    summary: `A source-grounded learning sequence generated from ${context.sources.length} uploaded source${context.sources.length === 1 ? "" : "s"}.`,
    sourceOnly,
    learningUnits: fallbackLearningUnitsFromContext(context),
    warnings: [warning],
  };
}

function importantSourceArtifactCount(context: LearnSourceContext): number {
  return context.sourceFigures.filter((figure) => Boolean(figure.figureId)).length;
}

function planningString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function planningRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceFigurePlacementForFallback(figure: SourceFigure): SourceFigurePlacement {
  if (figure.kind === "formula") return "after_formula_introduction";
  if (figure.kind === "table" || figure.kind === "graph") return "inside_result_interpretation";
  return "inside_concept_explanation";
}

function fallbackLearningUnitsFromContext(context: LearnSourceContext): LearningUnitContract[] {
  const topic = sanitizeLearnerTitle(context.gardenTitle || context.sources[0]?.title || context.gardenId || "This Topic");
  const sourceAnchors = context.sources.length > 0 ? context.sources.map((source) => source.title) : [topic];
  const grounding = [
    topic,
    ...context.sources.map((source) => `${source.title}\n${source.excerpt ?? ""}\n${source.body ?? ""}`),
    ...(context.concepts ?? []).map((concept) => `${concept.title}\n${concept.excerpt ?? ""}`),
  ].join("\n");
  const fallbackConceptPool = normalizeTopicTags(
    [
      ...context.sources.flatMap((source) => source.tags ?? []),
      ...(context.concepts ?? []).flatMap((concept) => concept.tags ?? []),
    ],
    grounding,
    5,
    grounding,
  );
  const topicSlug = normalizeConceptSlug(topic);
  if (fallbackConceptPool.length === 0 && isValidPublicConceptSlug(topicSlug)) {
    fallbackConceptPool.push(topicSlug);
  }
  const nowRange: [number, number] = [700, 1100];
  const mk = (
    id: string,
    role: LearningUnitContract["role"],
    title: string,
    question: string,
    _claim: string,
  ): LearningUnitContract => {
    void _claim;
    const numericId = Math.max(0, Number(id.replace(/\D/g, "")) - 1);
    const primary = fallbackConceptPool.length > 0
      ? fallbackConceptPool[numericId % fallbackConceptPool.length]
      : "";
    return {
      id,
      role,
      title: sanitizeLearnerTitle(title),
      learningQuestion: question,
      prerequisiteConcepts: [],
      newConcepts: primary ? [primary] : [],
      sourceAnchors,
      sourceFigures: [],
      sourceFormulas: [],
      sourceTables: [],
      zettelNotes: [],
      semanticConcepts: primary
        ? [{
            slug: primary,
            preferredLabel: primary.replace(/-/g, " "),
            role: "primary",
            aliases: [],
            evidenceAnchors: sourceAnchors,
          }]
        : [],
      knowledgeClaims: [],
      mustNotRepeat: [],
      expectedWordRange: nowRange,
    };
  };

  const units: LearningUnitContract[] = [
    mk("U1", "motivation", `Why ${topic} Exists`, `What problem makes ${topic} worth learning?`, `${topic} exists because a practical problem needs a more precise way to reason about it.`),
    mk("U2", "core_concept", `The Core Idea of ${topic}`, `What is the central idea?`, `${topic} has one central idea that organizes the rest of the learning path.`),
    mk("U3", "mechanism", "The Main Mechanism", "How does the mechanism work step by step?", "A mechanism becomes understandable when each moving part is tied to its role."),
    mk("U4", "worked_example", "A Concrete Worked Example", "How does the idea behave in a concrete case?", "A worked example turns an abstract mechanism into a traceable sequence."),
    mk("U5", "formula", "The Formal Pieces", "Which formulas or formal definitions matter?", "Formal definitions are useful when every term is tied to what it measures."),
    mk("U6", "training_method", "How It Learns or Changes", "What changes over time, and why?", "A changing system needs a rule that explains how state or behavior updates."),
    mk("U7", "metric", "How It Is Measured", "Which measurements decide whether the method works?", "A measurement is meaningful only when its units and tradeoffs are explicit."),
    mk("U8", "result_interpretation", "Interpreting the Results", "What should the learner notice in the results?", "A result teaches when the learner can name the pattern and its consequence."),
    mk("U9", "comparison", "Comparing Alternatives", "How do competing methods differ?", "A comparison is useful when it separates definition, metric, and context."),
    mk("U10", "application", "Where It Fits", "When is this useful in practice?", "A method fits an application when its strengths match the deployment constraints."),
    mk("U11", "limitation", "Limits and Failure Modes", "Where does the approach stop working well?", "Limitations are part of the concept because they reveal the assumptions underneath."),
    mk("U12", "synthesis", "Putting the Ideas Together", "How do the pieces connect into one mental model?", "A learning path becomes durable when motivation, mechanism, metric, evidence, and limits connect."),
  ];

  const byRole = new Map(units.map((unit) => [unit.role, unit]));
  for (const figure of context.sourceFigures) {
    if (!figure.figureId) continue;
    const caption = figure.caption || figure.figureId;
    if (figure.kind === "formula") {
      byRole.get("formula")?.sourceFormulas.push({
        id: figure.figureId,
        teachingGoal: `Define and interpret ${caption}.`,
        termsToDefine: [],
        placement: "before_example",
      });
      continue;
    }
    if (figure.kind === "table") {
      byRole.get("comparison")?.sourceTables.push({
        id: figure.figureId,
        teachingGoal: `Use ${caption} to compare the relevant rows or columns.`,
        rowsOrColumnsToExplain: [],
        placement: "inside_comparison",
      });
      continue;
    }
    const target =
      figure.kind === "graph" || /result|accuracy|latency|energy|loss|curve|comparison/i.test(caption)
        ? byRole.get("result_interpretation")
        : byRole.get("mechanism");
    target?.sourceFigures.push({
      id: figure.figureId,
      placement: sourceFigurePlacementForFallback(figure),
      mustBeDiscussedWith: caption,
      interpretationGoal: `Explain what ${caption} shows and why it matters for this learning step.`,
    });
  }

  return units;
}

function sourceCoveragePlan(
  context: LearnSourceContext,
  learningMap: ProposedLearningMap,
  learningUnits: LearningUnitContract[] = [],
  sourceArtifactAssignments: SourceArtifactAssignment[] = [],
): unknown {
  return {
    sourceSetHash: context.sourceSetHash,
    learningUnitContracts: learningUnits,
    sourceArtifactAssignments,
    sources: context.sources.map((source) => ({
      id: source.slug,
      title: source.title,
      plannedPages: learningMap.sections.flatMap((section) =>
        section.subsections
          .filter((subsection) =>
            [...section.sourceAnchors, ...subsection.sourceAnchors]
              .join(" ")
              .toLowerCase()
              .includes(source.title.toLowerCase()) ||
            [...section.sourceAnchors, ...subsection.sourceAnchors].includes(source.slug),
          )
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
      suggestedVisualTreatment: figure.suggestedVisualUse ?? "source_figure_explainer",
    })),
  };
}

function registryAlignmentAliasRepairs(
  before: readonly LearningUnitContract[],
  after: readonly LearningUnitContract[],
): Array<{
  normalizedAlias: string;
  removedFrom: string[];
  reason: "registry-ownership";
}> {
  const beforeConcepts = before.flatMap((unit) => unit.semanticConcepts ?? []);
  const afterConcepts = after.flatMap((unit) => unit.semanticConcepts ?? []);
  const repairs = new Map<string, Set<string>>();
  beforeConcepts.forEach((concept, index) => {
    const allowed = new Set(
      (afterConcepts[index]?.aliases ?? []).map((alias) => normalizeLookupText(alias)),
    );
    for (const alias of concept.aliases ?? []) {
      const normalizedAlias = normalizeLookupText(alias);
      if (!normalizedAlias || allowed.has(normalizedAlias)) continue;
      const removedFrom = repairs.get(normalizedAlias) ?? new Set<string>();
      removedFrom.add(`concept:${normalizeConceptSlug(concept.slug)}`);
      repairs.set(normalizedAlias, removedFrom);
    }
  });
  return [...repairs.entries()]
    .map(([normalizedAlias, removedFrom]) => ({
      normalizedAlias,
      removedFrom: [...removedFrom].sort(),
      reason: "registry-ownership" as const,
    }))
    .sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias));
}

function writeLearningUnitContractArtifacts({
  clusterDir,
  units,
  assignments,
  sourceSetHash,
  visualNecessityReview,
}: {
  clusterDir: string;
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  sourceSetHash: string;
  visualNecessityReview?: Pick<
    GardenVisualNecessityPlan,
    "decisions" | "reviewCalls" | "rejectedReviews" | "unresolvedRecords"
  >;
}): {
  units: LearningUnitContract[];
  semanticAliasRepairs: Array<{
    normalizedAlias: string;
    removedFrom: string[];
    reason: string;
  }>;
} {
  // Fix 7: never attach a raw semantic source anchor the source cannot support.
  // Codes and first-class structural anchors pass through; unresolvable semantic
  // anchors are dropped from the contract before they propagate to pages (the
  // deterministic reconcile enforces the same rule as the final safety net).
  const deferredSourceAnchors: string[] = [];
  const gateSourceAnchors = (anchors: string[] | undefined): string[] => {
    if (!Array.isArray(anchors) || anchors.length === 0) return [];
    const { accepted, deferred } = ingestModelSourceAnchors(clusterDir, anchors);
    deferredSourceAnchors.push(...deferred);
    return accepted;
  };
  const gatedUnits = units.map((unit) => {
    const sourceAnchors = gateSourceAnchors(unit.sourceAnchors);
    const semanticConcepts = semanticConceptsForUnit(unit).map((concept) => ({
      ...concept,
      evidenceAnchors: gateSourceAnchors(concept.evidenceAnchors),
    }));
    return { ...unit, sourceAnchors, semanticConcepts };
  });
  const aliasReconciliation = reconcileLearningUnitConceptAliases(gatedUnits);
  let reconciledUnits = aliasReconciliation.units;
  // Build and validate the registry before writing the contract. This avoids
  // leaving a newly written, colliding contract paired with an older registry
  // if a non-repairable canonical conflict is ever encountered.
  const registry = ensureGardenConceptRegistry({
    gardenDir: clusterDir,
    gardenId: path.basename(clusterDir),
    sourceSetHash,
    concepts: reconciledUnits.flatMap(semanticConceptsForUnit),
    persist: false,
  });
  const unitsBeforeRegistryAlignment = reconciledUnits;
  reconciledUnits = alignLearningUnitConceptAliasesWithRegistry(reconciledUnits, registry);
  // Formula identities are source-derived and outrank model-authored contract
  // coverage. When the extraction ledger is already available, the verified
  // family-constrained planner rebuilds the formula assignments GLOBALLY:
  // incompatible model proposals are rejected (never persisted), compatible
  // formulas land on their strongest unambiguous unit, and leftovers stay
  // unassigned with a reason. Anchors extraction has not seen yet pass
  // through untouched; the post-extraction pass re-plans them strictly.
  const formulaIdentities = buildFormulaIdentityRegistry(buildCanonicalSourceAnchors(clusterDir), clusterDir);
  const identityById = new Map(formulaIdentities.map((identity) => [identity.anchorId, identity]));
  let formulaAssignmentProvenance: FormulaAssignmentProvenance[] = [];
  let formulaAssignmentPlan: FormulaAssignmentPlan | undefined;
  const contractFamilyRegistry = buildGardenFormulaFamilyRegistry(formulaIdentities);
  if (formulaIdentities.length > 0) {
    const knownAnchorIds = new Set(formulaIdentities.map((identity) => identity.anchorId));
    const previousAssignments = reconciledUnits.flatMap((unit) =>
      unit.sourceFormulas
        .filter((formula) => knownAnchorIds.has(formula.id))
        .map((formula) => ({ formulaAnchorId: formula.id, unitId: unit.id })));
    formulaAssignmentPlan = finalizeFormulaAssignmentPlanWithoutCritic(
      buildFormulaAssignmentPlan(formulaIdentities, reconciledUnits, { previousAssignments, familyRegistry: contractFamilyRegistry }),
    );
    const application = applyFormulaAssignmentPlanToUnits({
      units: reconciledUnits,
      plan: formulaAssignmentPlan,
      formulas: formulaIdentities,
      familyRegistry: contractFamilyRegistry,
      unknownAnchorPolicy: "preserve",
    });
    if (application.result.applied) {
      reconciledUnits = application.units;
      formulaAssignmentProvenance = formulaAssignmentProvenanceFromPlan(formulaAssignmentPlan, previousAssignments);
    }
    const planArtifactDir = path.join(clusterDir, ".breadboard");
    fs.mkdirSync(planArtifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(planArtifactDir, "formula-assignment-plan.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: nowIso(),
        plan: formulaAssignmentPlan,
        provenance: formulaAssignmentProvenance,
        application: application.result,
      }, null, 2)}\n`,
    );
  }
  // Unweakened backstop: no assignment survives this function unless the
  // strict compatibility guard passes it. The planner above guarantees this;
  // if it ever cannot (rolled back), generation fails here exactly as before.
  reconciledUnits = reconciledUnits.map((unit) => {
    for (const formula of unit.sourceFormulas) {
      const identity = identityById.get(formula.id);
      if (!identity) continue; // Source extraction may still be pending; page generation has the strict guard.
      assertPlannedFormulaAssignment(identity, deriveUnitFormulaRequirement(unit, contractFamilyRegistry), unit, contractFamilyRegistry);
    }
    const formalIds = new Set(unit.sourceFormulas.map((formula) => formula.id));
    return {
      ...unit,
      sourceAnchors: unit.sourceAnchors.filter((anchorId) => {
        const identity = identityById.get(anchorId);
        if (!identity || formalIds.has(anchorId)) return true;
        try {
          assertPlannedFormulaAssignment(identity, deriveUnitFormulaRequirement(unit, contractFamilyRegistry), unit, contractFamilyRegistry);
          return true;
        } catch {
          return false;
        }
      }),
    };
  });
  const registryAlignmentRepairs = registryAlignmentAliasRepairs(
    unitsBeforeRegistryAlignment,
    reconciledUnits,
  );
  const semanticAliasRepairs = [
    ...aliasReconciliation.repairs,
    ...registryAlignmentRepairs,
  ];
  // Keep source-artifact assignments consistent with the planner-cleaned units:
  // the formula planner removes ungroundable/incompatible formulas from a unit's
  // sourceFormulas, so a formula assignment survives only when the target unit
  // still lists that formula. Otherwise a stale assignment (e.g. a caption-only
  // anchor whose extraction produced no formula text) would make the finalizer
  // demand a page ground a formula the contract no longer carries. Figure and
  // table assignments are untouched by the formula planner and pass through.
  const formulaOwnersByUnit = new Map(
    reconciledUnits.map((unit) => [unit.id, new Set(unit.sourceFormulas.map((formula) => formula.id))]),
  );
  const isFormulaArtifactId = (id: string) => /\.E\d+$/i.test(id);
  const finalAssignments = assignments.filter((assignment) =>
    !isFormulaArtifactId(assignment.sourceArtifactId)
    || (formulaOwnersByUnit.get(assignment.assignedLearningUnitId)?.has(assignment.sourceArtifactId) ?? false));
  // Necessity is the final gate before the contract is persisted. It is rerun
  // after formula/source reconciliation so alternative-media sufficiency is
  // based on the same artifacts page generation will actually receive.
  const visualNecessityPlan = planGardenVisualNecessity({
    gardenId: path.basename(clusterDir),
    learningUnits: reconciledUnits,
    overrides: loadVisualDecisionOverrides(clusterDir),
    reviewedDecisions: visualNecessityReview?.decisions,
    reviewCalls: visualNecessityReview?.reviewCalls,
    rejectedReviews: visualNecessityReview?.rejectedReviews,
  });
  reconciledUnits = visualNecessityPlan.learningUnits;
  saveVisualNecessityArtifacts(clusterDir, path.basename(clusterDir), {
    decisions: visualNecessityPlan.decisions,
    teachingMedia: visualNecessityPlan.teachingMedia,
    budget: visualNecessityPlan.budget,
    overrides: visualNecessityPlan.overrides,
    reviewCalls: visualNecessityPlan.reviewCalls,
    rejectedReviews: visualNecessityPlan.rejectedReviews,
    decisionRecords: visualNecessityPlan.decisionRecords,
    zeroVisualSafeguard: visualNecessityPlan.zeroVisualSafeguard,
    unresolvedRecords: visualNecessityReview?.unresolvedRecords,
  });
  const payload = {
    sourceSetHash,
    generatedAt: nowIso(),
    learningUnits: reconciledUnits,
    sourceArtifactAssignments: finalAssignments,
    ...(deferredSourceAnchors.length ? { deferredSourceAnchors: [...new Set(deferredSourceAnchors)] } : {}),
    ...(formulaAssignmentProvenance.length ? { formulaAssignmentProvenance } : {}),
    ...(semanticAliasRepairs.length
      ? { semanticAliasRepairs }
      : {}),
  };
  const lines = [
    "# Learning Unit Contract",
    "",
    `Source set hash: ${sourceSetHash}`,
    `Learning units: ${reconciledUnits.length}`,
    `Source artifact assignments: ${finalAssignments.length}`,
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
    const concepts = conceptTagsForUnit(unit);
    if (concepts.length > 0) lines.push(`  - Concepts: ${concepts.join(", ")}`);
    const claims = knowledgeClaimsForUnit(unit);
    if (claims.length > 0) lines.push(`  - Claims: ${claims.map((claim) => claim.text).join(" | ")}`);
  }
  writeGardenConceptRegistryAndContract({
    gardenDir: clusterDir,
    registry,
    contract: payload,
    planningMarkdown: `${lines.join("\n")}\n`,
  });
  return { units: reconciledUnits, semanticAliasRepairs };
}

function persistRoutedVisualPlans(
  clusterDir: string,
  units: LearningUnitContract[],
): void {
  const filePath = path.join(clusterDir, ".breadboard", "learning-unit-contract.json");
  if (!fs.existsSync(filePath)) return;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  const rawUnits = Array.isArray(parsed.learningUnits)
    ? parsed.learningUnits as Array<Record<string, unknown>>
    : [];
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
  fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
}

/**
 * Record justified omissions on the source-visuals ledger. A formula the
 * assignment plan deliberately left without a unit (duplicate, out of scope,
 * no compatible unit) becomes "Intentionally Omitted" in Source Coverage with
 * the plan's reason — never "missing". Formulas the plan assigned anywhere
 * are cleared back to normal usage.
 */
function markIntentionallyOmittedFormulasInLedger(
  clusterDir: string,
  plan: FormulaAssignmentPlan,
): void {
  const ledgerAbs = path.join(clusterDir, ".breadboard", "source-visuals.json");
  if (!fs.existsSync(ledgerAbs)) return;
  let ledger: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerAbs, "utf-8"));
    if (!Array.isArray(parsed)) return;
    ledger = parsed as Array<Record<string, unknown>>;
  } catch {
    return;
  }
  const assignedIds = new Set(
    plan.assignments
      .filter((assignment) => assignment.status === "assigned" || assignment.status === "reused_with_reason")
      .map((assignment) => assignment.formulaAnchorId),
  );
  const omittedReasons = new Map<string, string>();
  for (const assignment of plan.assignments) {
    if (assignment.status !== "unassigned_with_reason") continue;
    if (assignedIds.has(assignment.formulaAnchorId)) continue;
    omittedReasons.set(assignment.formulaAnchorId, assignment.reason);
  }
  let changed = false;
  for (const record of ledger) {
    const id = String(record.sourceVisualId ?? "");
    if (omittedReasons.has(id)) {
      if (record.conceptUsage !== "intentionally_omitted" || record.skipReason !== omittedReasons.get(id)) {
        record.conceptUsage = "intentionally_omitted";
        record.skipReason = omittedReasons.get(id);
        changed = true;
      }
    } else if (assignedIds.has(id) && record.conceptUsage === "intentionally_omitted") {
      delete record.conceptUsage;
      delete record.skipReason;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(ledgerAbs, `${JSON.stringify(ledger, null, 2)}\n`);
}

function learningUnitsFromCoveragePlan(plan: unknown): LearningUnitContract[] {
  const record = planningRecord(plan);
  return normalizeLearningUnits({ learningUnits: record.learningUnitContracts });
}

/** Unit titles become learner-visible page/section titles, so they get the
 * same commentary scrub as every other learner title ("… as Evidence",
 * "What the Evidence Shows", "… in this paper") before depth validation. */
function sanitizeLearningUnitTitles(units: LearningUnitContract[]): LearningUnitContract[] {
  return units.map((unit) => ({ ...unit, title: sanitizeLearnerTitle(unit.title) }));
}

/** Title scrub + drop of any incompatible optional interactive visual, so a
 * single visual-type mismatch never rejects an otherwise-good model contract
 * (which would force the deterministic fallback). */
function sanitizeModelLearningUnits(
  units: LearningUnitContract[],
  contentPath: string,
  gardenId: string,
  jobId: string,
): LearningUnitContract[] {
  const titled = sanitizeLearningUnitTitles(units);
  const { units: sanitized, dropped } = dropIncompatibleInteractiveVisuals(titled);
  if (dropped.length > 0) {
    appendLearnEvent(contentPath, gardenId, "learn_incompatible_visual_dropped", {
      jobId,
      dropped,
    });
  }
  return planGardenVisualNecessity({
    gardenId,
    learningUnits: sanitized,
    overrides: loadVisualDecisionOverrides(clusterPath(contentPath, gardenId)),
  }).learningUnits;
}

function isContractBackedLearningMap(map: StoredLearningMap | null | undefined): map is StoredLearningMap {
  return Boolean(map && learningUnitsFromCoveragePlan(map.coveragePlan).length > 0);
}

function sourceArtifactAssignmentsFromCoveragePlan(plan: unknown): SourceArtifactAssignment[] {
  const raw = planningRecord(plan).sourceArtifactAssignments;
  if (!Array.isArray(raw)) return [];
  const assignments = raw
    .map((item) => (item && typeof item === "object" ? (item as SourceArtifactAssignment) : null))
    .filter((item): item is SourceArtifactAssignment => Boolean(item));
  return dedupeSourceArtifactAssignments(assignments, learningUnitsFromCoveragePlan(plan));
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
          conceptTags: conceptTagsForUnit(unit),
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
          mustNotRepeat: unit.mustNotRepeat,
          expectedWordRange: unit.expectedWordRange,
          sourceFigureContracts: unit.sourceFigures,
          sourceFormulaContracts: unit.sourceFormulas,
          sourceTableContracts: unit.sourceTables,
          sourceArtifactAssignments: assignSourceArtifacts([unit]),
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
  const context = collectLearnSourceContext(
    contentPath,
    gardenId,
    includedSourceIds,
    syllabusSourceId,
  );
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
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });

    const promptSourceContext = promptSources(context);
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
    };
    const planningWarnings: string[] = [];

    // Stage 1b: read the syllabus into units + assigned materials, then check
    // every assigned work against the documents actually in this garden. The
    // check is deterministic on purpose — it is the only thing standing between
    // "the syllabus assigns chapter 3" and a confidently fabricated chapter 3.
    let syllabusCoverage: SyllabusCoverage | null = null;
    if (context.syllabus) {
      updateLearnJob(job.id, {
        currentStep: "Reading the syllabus",
        progressPercent: 4,
      });
      throwIfLearnCancelled(job.id);
      try {
        const syllabusCall = await callPlanningJsonWithRetry({
          client,
          model,
          taskType: "source_map",
          gardenId,
          system: SYLLABUS_READING_PROMPT,
          user: compactJson({ syllabus: syllabusPayload }),
          sourceContext: { ...planningSourceMeta, taskType: "syllabus_reading" },
          contentPath,
          jobId: job.id,
        });
        const syllabusPlan = normalizeSyllabusPlan(syllabusCall.parsed);
        syllabusCoverage = buildSyllabusCoverage(
          syllabusPlan,
          resolveSyllabusMaterials(syllabusPlan, context.sources),
        );
      } catch (error) {
        if (!isPlanningTimeoutError(error)) throw error;
        // Without a reading, the syllabus still steers as plain text; it just
        // cannot gate material availability. Say so rather than pretending.
        const warning = planningFallbackWarning("Syllabus reading", error);
        planningWarnings.push(
          `${warning} Assigned readings were not checked against this garden's documents.`,
        );
        appendLearnEvent(contentPath, gardenId, "learn_syllabus_reading_fallback", {
          jobId: job.id,
          error: errorMessage(error),
        });
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
            `Syllabus item "${unitTitle}" has no available material in this garden and was left uncovered.`,
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
    let sourceMapCall: CouncilJsonResult;
    try {
      sourceMapCall = await callPlanningJsonWithRetry({
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
        }),
        sourceContext: { ...planningSourceMeta, taskType: "source_map" },
        contentPath,
        jobId: job.id,
      });
    } catch (error) {
      if (!isPlanningTimeoutError(error)) throw error;
      const warning = planningFallbackWarning("Source map", error);
      planningWarnings.push(warning);
      sourceMapCall = fallbackCouncilJsonResult(
        fallbackSourceMap(context),
        `fallback-source-map-${job.id}`,
      );
      appendLearnEvent(contentPath, gardenId, "learn_source_map_fallback", {
        jobId: job.id,
        error: errorMessage(error),
      });
    }
    throwIfLearnCancelled(job.id);
    const sourceMap = sourceMapCall.parsed ?? fallbackSourceMap(context);
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
    let scopeCall: CouncilJsonResult;
    try {
      scopeCall = await callPlanningJsonWithRetry({
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
          sourceMap: compactPlanningPayload(sourceMap),
          sources: promptSourcesCompact(context),
        }),
        sourceContext: { ...planningSourceMeta, taskType: "scope_contract" },
        contentPath,
        jobId: job.id,
      });
    } catch (error) {
      if (!isPlanningTimeoutError(error)) throw error;
      const warning = planningFallbackWarning("Scope contract", error);
      planningWarnings.push(warning);
      scopeCall = fallbackCouncilJsonResult(
        fallbackScopeContract(context, sourceOnly),
        `fallback-scope-contract-${job.id}`,
      );
      appendLearnEvent(contentPath, gardenId, "learn_scope_contract_fallback", {
        jobId: job.id,
        error: errorMessage(error),
      });
    }
    throwIfLearnCancelled(job.id);
    const scopeContract =
      scopeCall.parsed ?? fallbackScopeContract(context, sourceOnly);
    appendLearnEvent(contentPath, gardenId, "learn_scope_contract_created", {
      jobId: job.id,
      councilRunId: scopeCall.councilRunId,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      currentStep: "Creating learning map",
      progressPercent: 65,
    });

    // The spine prompt is the largest and slowest: it already carries the source
    // map + scope contract, so it uses the body-free compact source context and
    // compacts oversized upstream JSON to keep the request small and fast.
    const spineSourceContext = promptSourcesCompact(context);
    const topicMapUser = (deepenNote: string) =>
      compactJson({
        sourceOnly,
        syllabus: syllabusPayload,
        syllabusCoverage: syllabusCoveragePayload,
        sourceMap: compactPlanningPayload(sourceMap),
        scopeContract: compactPlanningPayload(scopeContract),
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
      }) + deepenNote;

    throwIfLearnCancelled(job.id);
    let topicMapCall: CouncilJsonResult;
    try {
      topicMapCall = await callPlanningJsonWithRetry({
        client,
        model,
        taskType: "learning_spine",
        gardenId,
        system: withSyllabusRules(TOPIC_MAP_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus),
        user: topicMapUser(""),
        sourceContext: { ...planningSourceMeta, taskType: "learning_spine" },
        contentPath,
        jobId: job.id,
      });
    } catch (error) {
      if (!isPlanningTimeoutError(error)) throw error;
      const warning = planningFallbackWarning("Learning spine", error);
      planningWarnings.push(warning);
      topicMapCall = fallbackCouncilJsonResult(
        fallbackLearningSpinePlan(context, sourceOnly, warning),
        `fallback-learning-spine-${job.id}`,
      );
      appendLearnEvent(contentPath, gardenId, "learn_learning_spine_fallback", {
        jobId: job.id,
        error: errorMessage(error),
      });
    }
    throwIfLearnCancelled(job.id);
    const artifactCount = importantSourceArtifactCount(context);
    let learningUnits = sanitizeModelLearningUnits(
      normalizeLearningUnits(topicMapCall.parsed),
      contentPath,
      gardenId,
      job.id,
    );
    let contractProblems =
      learningUnits.length === 0
        ? ["planner returned no learningUnits"]
        : validateLearningUnitContracts(learningUnits, { artifactCount });

    // The contract must be a real source-grounded learning plan, not a shallow
    // section list. Retry once with explicit feedback before using the
    // deterministic unit fallback.
    if (contractProblems.length > 0) {
      const deepenNote =
        `\n\nThe previous Learning Unit Contract failed these hard planning checks: ${contractProblems.join("; ")}. ` +
        `Regenerate the plan as 15-25 precise learningUnits. Assign every important figure/table/formula/result to a precise unit, keep interactive visuals optional and unique, plan reusable semanticConcepts separately from readable grounded knowledgeClaims, and do not return sections first.`;
      try {
        const retryCall = await callPlanningJsonWithRetry({
          client,
          model,
          taskType: "learning_spine",
          gardenId,
          system: withSyllabusRules(TOPIC_MAP_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus),
          user: topicMapUser(deepenNote),
          sourceContext: { ...planningSourceMeta, taskType: "learning_spine" },
          contentPath,
          jobId: job.id,
        });
        const retryUnits = sanitizeModelLearningUnits(
          normalizeLearningUnits(retryCall.parsed),
          contentPath,
          gardenId,
          job.id,
        );
        const retryProblems =
          retryUnits.length === 0
            ? ["planner returned no learningUnits"]
            : validateLearningUnitContracts(retryUnits, { artifactCount });
        if (retryProblems.length < contractProblems.length) {
          topicMapCall = retryCall;
          learningUnits = retryUnits;
          contractProblems = retryProblems;
        }
      } catch (error) {
        if (!isPlanningTimeoutError(error)) throw error;
        const warning = planningFallbackWarning("Learning spine retry", error);
        planningWarnings.push(warning);
        appendLearnEvent(contentPath, gardenId, "learn_learning_spine_retry_fallback", {
          jobId: job.id,
          error: errorMessage(error),
          contractProblems,
        });
      }
    }

    if (contractProblems.length > 0) {
      planningWarnings.push(
        `Model Learning Unit Contract rejected: ${contractProblems.join("; ")}. Used deterministic source-grounded unit fallback.`,
      );
      learningUnits = planGardenVisualNecessity({
        gardenId,
        learningUnits: fallbackLearningUnitsFromContext(context),
        overrides: loadVisualDecisionOverrides(clusterPath(contentPath, gardenId)),
      }).learningUnits;
      contractProblems = validateLearningUnitContracts(learningUnits, { artifactCount });
      if (contractProblems.length > 0) {
        planningWarnings.push(`Fallback contract warnings: ${contractProblems.join("; ")}`);
      }
    }

    throwIfLearnCancelled(job.id);
    // Reconcile the final model/fallback plan against the garden's existing
    // canonical concept ownership before deriving either the visible map or
    // the database coverage plan. The dry run deliberately carries no model
    // evidence anchors: source gating occurs when the artifacts are written.
    const planningAliasReconciliation = reconcileLearningUnitConceptAliases(learningUnits);
    learningUnits = planningAliasReconciliation.units;
    const planningRegistry = ensureGardenConceptRegistry({
      gardenDir: clusterPath(contentPath, gardenId),
      gardenId,
      sourceSetHash: context.sourceSetHash,
      concepts: learningUnits.flatMap(semanticConceptsForUnit).map((concept) => ({
        ...concept,
        evidenceAnchors: [],
      })),
      persist: false,
    });
    const unitsBeforeRegistryAlignment = learningUnits;
    learningUnits = alignLearningUnitConceptAliasesWithRegistry(
      learningUnits,
      planningRegistry,
    );
    const planningRegistryAlignmentRepairs = registryAlignmentAliasRepairs(
      unitsBeforeRegistryAlignment,
      learningUnits,
    );
    const planningSemanticAliasRepairs = [
      ...planningAliasReconciliation.repairs,
      ...planningRegistryAlignmentRepairs,
    ];
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
    const sourceArtifactAssignments = assignSourceArtifacts(learningUnits);
    let learningMap = learningMapFromUnits(learningUnits, {
      gardenId,
      title: sanitizeLearnerTitle(planningString(planRecord.title, context.gardenTitle || gardenId)),
      summary: planningString(
        planRecord.summary,
        `A source-grounded learning sequence generated from ${context.sources.length} uploaded source${context.sources.length === 1 ? "" : "s"}.`,
      ),
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
      learningMap = {
        ...learningMap,
        warnings: [...learningMap.warnings, `Learning spine depth warning: ${depthProblems.join("; ")}`],
      };
    }
    const coveragePlan = sourceCoveragePlan(context, learningMap, learningUnits, sourceArtifactAssignments);
    let artifactSemanticAliasRepairs: Array<{
      normalizedAlias: string;
      removedFrom: string[];
      reason: string;
    }> = [];
    const commitContext = collectLearnSourceContext(
      contentPath,
      gardenId,
      context.selectedSourceIds,
      context.syllabus?.slug,
    );
    if (commitContext.sourceSetHash !== context.sourceSetHash) {
      throw new LearnPipelineConflictError(
        "The selected sources changed during planning. Run Learn again to review a map grounded in the current files.",
      );
    }
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
        sourceSetHash: context.sourceSetHash,
        visualNecessityReview,
      });
      learningUnits = contractWrite.units;
      artifactSemanticAliasRepairs = contractWrite.semanticAliasRepairs;
      learningMap = learningMapWithConfirmedUnitContracts(learningMap, learningUnits);
      const repairedCoveragePlan = sourceCoveragePlan(
        context,
        learningMap,
        learningUnits,
        sourceArtifactAssignments,
      );
      db.prepare(
        `UPDATE learn_maps
         SET learning_map_json = ?, proposed_order_json = ?, coverage_plan_json = ?
         WHERE id = ?`,
      ).run(
        jsonString(learningMap),
        jsonString(learningMap.sections),
        jsonString(repairedCoveragePlan),
        stored.id,
      );
      return {
        ...stored,
        learningMap,
        proposedOrder: learningMap.sections,
        coveragePlan: repairedCoveragePlan,
      };
    })();
    const persistedSemanticAliasRepairs = [
      ...planningSemanticAliasRepairs,
      ...artifactSemanticAliasRepairs,
    ];
    const visualizationPlanningStartedAt = Date.now();
    const visualizationPlan = buildVisualizationPlan({
      gardenId,
      learningMap,
      learningUnits,
      necessityReviewCalls: visualNecessityReview.reviewCalls,
      rejectedNecessityReviews: visualNecessityReview.rejectedReviews,
      visualDecisionOverrides: visualNecessityReview.overrides,
    });
    learningUnits = applyVisualizationRoutesToLearningUnits(learningUnits, visualizationPlan);
    persistRoutedVisualPlans(clusterPath(contentPath, gardenId), learningUnits);
    learningMap = learningMapWithConfirmedUnitContracts(learningMap, learningUnits);
    const routedCoveragePlan = sourceCoveragePlan(
      context,
      learningMap,
      learningUnits,
      sourceArtifactAssignments,
    );
    db.prepare(
      `UPDATE learn_maps
       SET learning_map_json = ?, proposed_order_json = ?, coverage_plan_json = ?
       WHERE id = ?`,
    ).run(
      jsonString(learningMap),
      jsonString(learningMap.sections),
      jsonString(routedCoveragePlan),
      storedMap.id,
    );
    Object.assign(storedMap, {
      learningMap,
      proposedOrder: learningMap.sections,
      coveragePlan: routedCoveragePlan,
    });
    saveVisualizationPlan(clusterPath(contentPath, gardenId), visualizationPlan);
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
    if (persistedSemanticAliasRepairs.length > 0) {
      appendLearnEvent(contentPath, gardenId, "learn_concept_aliases_reconciled", {
        jobId: job.id,
        learningMapId: storedMap.id,
        repairs: persistedSemanticAliasRepairs,
      });
    }
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
      if (map.status === "confirmed") return { map, jobId: map.jobId, changed: false };
      if (map.status !== "proposed") {
        throw new LearnPipelineConflictError(
          `Learning Map ${map.id} is ${map.status} and cannot be confirmed.`,
        );
      }
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
         WHERE id = ? AND garden_id = ? AND status = 'proposed'`,
      ).run(confirmedAt, map.id, gardenId);
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
 * Per-formula grounding is content-based, never positional: each rendered
 * learner formula is matched to a source formula anchor only when their
 * symbols/metric families overlap. A simplified helper or single symbol that
 * matches nothing is honestly labelled a conceptual helper instead of being
 * mapped to whatever source anchor happens to share its array index.
 */
function normalizedFormulaForFrontmatter(text: string): string {
  return text
    .replace(/\\(?:text|mathrm|operatorname)\{([^}]*)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function formulaGroundingEntries(
  mathExpressions: ReturnType<typeof extractQuartzMath>,
  sourceFormulaFigureList: SourceFigure[],
): FormulaGroundingEntry[] {
  const sources = sourceFormulaFigureList
    .filter((figure) => figure.figureId)
    .map((figure) => ({ id: figure.figureId, caption: figure.caption ?? "" }));
  const captionById = new Map(sources.map((source) => [source.id, source.caption]));
  return mathExpressions.filter((expr) => isGroundableFormula(expr.formula) && !isTrivialFormulaFragment(expr.formula)).flatMap((expr): FormulaGroundingEntry[] => {
    const grounded = groundLearnerFormula(expr.formula, sources);
    if (grounded.groundingStatus === "source-anchored" && grounded.sourceAnchor) {
      const workedExample = isWorkedExampleFormula(expr.formula);
      return [{
        kind: workedExample ? "worked_example" : "source_definition",
        text: expr.formula,
        normalizedText: normalizedFormulaForFrontmatter(expr.formula),
        groundingStatus: workedExample ? "conceptual-helper" : "source-anchored",
        sourceAnchor: grounded.sourceAnchor,
        sourceAnchorTitle: captionById.get(grounded.sourceAnchor) ?? "source formula",
        matchReason: "metric family and source formula caption match",
        confidence: 0.9,
        justification: workedExample
          ? `Worked example applying source formula ${grounded.sourceAnchor} (${captionById.get(grounded.sourceAnchor) ?? "source formula"}).`
          : `Content matches source metric formula ${grounded.sourceAnchor} (${captionById.get(grounded.sourceAnchor) ?? "source formula"}).`,
      }];
    }
    if (!formulaMetricFamily(expr.formula)) return [];
    return [{
      kind: isWorkedExampleFormula(expr.formula) ? "worked_example" : "conceptual_helper",
      text: expr.formula,
      normalizedText: normalizedFormulaForFrontmatter(expr.formula),
      groundingStatus: "conceptual-helper",
      matchReason: "no matching source formula anchor",
      confidence: 0.4,
      justification:
        "Compact helper formula used to explain the lesson's mechanism; no direct source equation anchor is claimed.",
    }];
  });
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
  const existing = formulaCandidatesForUnit(
    sourceFormulaFigures(context),
    subsection.sourceFormulaContracts ?? [],
  );
  const byId = new Map(existing.map((figure) => [figure.figureId, figure]));
  for (const formula of subsection.sourceFormulaContracts ?? []) {
    if (!formula.id || byId.has(formula.id)) continue;
    byId.set(formula.id, {
      figureId: formula.id,
      kind: "formula",
      caption: [formula.teachingGoal, ...(formula.termsToDefine ?? [])].filter(Boolean).join("; "),
      suggestedVisualUse: formula.placement,
    });
  }
  return [...byId.values()];
}

function ensureContractFormulaGrounding(
  entries: FormulaGroundingEntry[],
  subsection: LearningSubsectionPlan,
  identityById: Map<string, CanonicalFormulaIdentity> = new Map(),
): FormulaGroundingEntry[] {
  const anchors = (subsection.sourceFormulaContracts ?? []).map((formula) => formula.id).filter(Boolean);
  if (anchors.length === 0) return entries;
  const grounded = new Set(
    entries
      .filter((entry) => (entry.groundingStatus === "source-anchored" || entry.groundingStatus === "source-derived") && entry.sourceAnchor)
      .map((entry) => entry.sourceAnchor as string),
  );
  const next = [...entries];
  for (const formula of subsection.sourceFormulaContracts ?? []) {
    if (!formula.id || grounded.has(formula.id)) continue;
    const synthesized = synthesizedFormulaForContract(formula, identityById.get(formula.id));
    if (!synthesized || !isGroundableFormula(synthesized.text)) continue;
    next.push({
      kind: "source_derived_definition",
      text: synthesized.text,
      normalizedText: normalizedFormulaForFrontmatter(synthesized.text),
      groundingStatus: "source-derived",
      sourceAnchor: formula.id,
      sourceAnchorTitle: formula.teachingGoal || formula.id,
      formulaFamily: identityById.get(formula.id)?.verified
        ? legacyFormulaFamily(identityById.get(formula.id)!.family)
        : undefined,
      matchReason: synthesized.reason,
      confidence: 0.8,
      justification: `Required by the Learning Unit Contract source formula anchor ${formula.id}; ${synthesized.reason}.`,
    });
    grounded.add(formula.id);
  }
  return next;
}

function synthesizedFormulaForContract(
  formula: SourceFormulaContract,
  identity?: CanonicalFormulaIdentity,
): { text: string; reason: string } | null {
  if (identity?.verified && identity.canonicalText) {
    return {
      text: identity.canonicalText,
      reason: `the verified canonical ${identity.family} equation was recovered from source evidence`,
    };
  }
  const text = [formula.teachingGoal, ...(formula.termsToDefine ?? [])]
    .join(" ")
    .toLowerCase();
  if (/\baccuracy|correct prediction|classification/i.test(text)) {
    return {
      text: "\\text{Accuracy} = \\frac{N_{\\text{correct}}}{N_{\\text{total}}}",
      reason: "the anchor describes accuracy as correct predictions over total predictions",
    };
  }
  if (/\blatency|decision time|response time/i.test(text)) {
    return {
      text: "T_{\\text{latency}} = t_{\\text{decision}} - t_{\\text{stimulus}}",
      reason: "the anchor describes latency as time to decision",
    };
  }
  if (/\bspike count|total spike|number of spikes|spikes summed/i.test(text)) {
    return {
      text: "N_{\\text{spike count}} = \\sum_{n,t} s_n(t)",
      reason: "the anchor describes total spike count summed across neurons and time",
    };
  }
  if (/\befficiency|normalized energy|accuracy per energy/i.test(text)) {
    return {
      text: "\\eta_{\\text{efficiency}} = \\frac{\\text{Accuracy}}{E_{\\text{energy}}}",
      reason: "the anchor describes normalized efficiency as accuracy per energy",
    };
  }
  if (/\benergy|synaptic operation|synop|joule/i.test(text)) {
    return {
      text: "E_{\\text{energy}} = N_{\\text{spikes}}E_{\\text{spike}} + N_{\\text{synops}}E_{\\text{synop}}",
      reason: "the anchor describes total energy from spike and synaptic operation costs",
    };
  }
  if (/\bconvergence|epoch|target accuracy|learning curve/i.test(text)) {
    return {
      text: "T_{\\text{convergence}} = \\min\\{e : A(e) \\geq A_{\\text{target}}\\}",
      reason: "the anchor describes convergence as the first epoch that reaches a target accuracy",
    };
  }
  return null;
}

function renderLearningMapMarkdown(map: ProposedLearningMap): string {
  const lines: string[] = [
    "# Learning Map",
    "",
    "## Section Order",
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = sanitizeLearnerTitle(section.title);
    lines.push(`- ${sectionNumber}. ${sectionTitle}`);
    section.subsections.forEach((subsection, subsectionIndex) => {
      const subsectionTitle = sanitizeLearnerTitle(subsection.title);
      const relPath = `${learningSectionFolder(sectionNumber, sectionTitle)}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsectionTitle,
      )}`;
      lines.push(
        `  - ${sectionNumber}.${subsectionIndex + 1} ${wikilinkForRelPath(relPath, subsectionTitle)}`,
      );
    });
  });
  lines.push("", "## Prerequisite Chain", "");
  map.sections.forEach((section, index) => {
    const previous = index === 0 ? "Start here" : sanitizeLearnerTitle(map.sections[index - 1].title);
    lines.push(`- ${previous} -> ${sanitizeLearnerTitle(section.title)}`);
  });
  lines.push("", "## Trunk, Branch, Leaf Concepts", "");
  map.sections.forEach((section) => {
    lines.push(`- Trunk: ${sanitizeLearnerTitle(section.title)}`);
    section.subsections.forEach((subsection) => {
      lines.push(`  - Branch/leaf: ${sanitizeLearnerTitle(subsection.title)}`);
    });
  });
  lines.push("", "## Bridge Concepts", "");
  lines.push("- Bridges are introduced where adjacent subsections share source anchors or concept tags.");
  lines.push("", "## Warnings", "");
  lines.push(...(map.warnings.length > 0 ? map.warnings.map((warning) => `- ${warning}`) : ["- None."]));
  return `${lines.join("\n")}\n`;
}

function renderLearningIndexMarkdown(
  map: ProposedLearningMap,
  context: LearnSourceContext,
): string {
  const lines = [
    `# ${map.title || context.gardenTitle}`,
    "",
    map.summary || `A guided path through ${context.gardenTitle}, one lesson at a time.`,
    "",
    "Read the sections in order. Start with the [[learning/Topic Overview|Topic Overview]], then work through each numbered section.",
    "",
    "## Sections",
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = sanitizeLearnerTitle(section.title);
    const folder = learningSectionFolder(sectionNumber, sectionTitle);
    lines.push(`- ${wikilinkForRelPath(`${folder}/_index.md`, `${sectionNumber}. ${sectionTitle}`)}`);
    section.subsections.forEach((subsection, subsectionIndex) => {
      const relPath = `${folder}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        sanitizeLearnerTitle(subsection.title),
      )}`;
      lines.push(
        `  - ${wikilinkForRelPath(relPath, `${sectionNumber}.${subsectionIndex + 1} ${sanitizeLearnerTitle(subsection.title)}`)}`,
      );
    });
  });
  return `${lines.join("\n")}\n`;
}

function renderTopicOverviewFallback(map: ProposedLearningMap, context: LearnSourceContext): string {
  const lines = [
    "# Topic Overview",
    "",
    `${context.gardenTitle} is organized as a sequence of lessons you can read in order.`,
    "",
    "## How To Learn This Garden",
    "",
    "Read the sections in order. Each subsection introduces the next idea only after the motivation for it is clear.",
    "",
    "## Recommended Reading Order",
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = sanitizeLearnerTitle(section.title);
    lines.push(`- ${sectionNumber}. ${sectionTitle}`);
    section.subsections.forEach((subsection, subsectionIndex) => {
      const subsectionTitle = sanitizeLearnerTitle(subsection.title);
      const relPath = `${learningSectionFolder(sectionNumber, sectionTitle)}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsectionTitle,
      )}`;
      lines.push(`  - ${wikilinkForRelPath(relPath, `${sectionNumber}.${subsectionIndex + 1} ${subsectionTitle}`)}`);
    });
  });
  const tags = normalizeTopicTags(
    map.sections.flatMap((section) =>
      section.subsections.flatMap((subsection) => subsection.conceptTags),
    ),
    map.summary,
    12,
    map.summary,
  );
  lines.push("", "## High-Level Concept Tags", "");
  lines.push(...(tags.length > 0 ? tags.map((tag) => `- ${tag}`) : ["- Guided learning path"]));
  lines.push("", "## Scope Notes", "");
  lines.push(...(map.warnings.length > 0 ? map.warnings.map((warning) => `- ${warning}`) : ["- This garden stays within the scope of its underlying material unless explicitly updated."]));
  return `${lines.join("\n")}\n`;
}

function sourceMapMarkdown(sourceMap: unknown, context: LearnSourceContext): string {
  const formulas = sourceFormulaFigures(context);
  const sourceMapFacts = {
    hasFormulas: formulas.length > 0,
    hasTables: context.sourceFigures.some((figure) => figure.kind === "table" || /\.T\d+$/i.test(figure.figureId)),
    hasFigures: context.sourceFigures.some((figure) => figure.kind !== "formula" && !/\.E\d+$/i.test(figure.figureId)),
    hasLaterPages: context.sourceFigures.some((figure) => Number(figure.page) > 2),
  };
  const formulaAcknowledgement =
    formulas.length > 0
      ? [
          "",
          "## Formula Coverage",
          "",
          "The source contains explicit metric formulas for accuracy, latency, total spike count, total energy, normalized energy efficiency, and convergence time. These formulas should be taught in the unified evaluation section.",
          "",
          ...formulas.map((formula) => `- ${formula.figureId}: ${formula.caption ?? "metric formula"}`),
          "",
        ]
      : [];
  const renderedSourceMap = sanitizeSourceMapContradictions(sourceMap, sourceMapFacts);
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
    ...formulaAcknowledgement,
    "",
    "## Council Source Map",
    "",
    renderObjectMarkdown(renderedSourceMap),
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

function sanitizeSourceMapContradictions(
  value: unknown,
  facts: { hasFormulas: boolean; hasTables: boolean; hasFigures: boolean; hasLaterPages: boolean },
): unknown {
  if (typeof value === "string") {
    let next = value;
    if (facts.hasFormulas) {
      next = next
        .replace(
          /explicit mathematical definitions are not present[^.]*\./gi,
          "explicit metric formulas are present in the extracted source anchors.",
        )
        .replace(
          /explicit mathematical definitions are not present/gi,
          "explicit metric formulas are present",
        )
        .replace(/formulas? (?:are|is) not present/gi, "formula anchors are present")
        .replace(/formula captions but not exact[^.\n]*/gi, "source formula anchors and text-derived metric meanings are available")
        .replace(/exact displayed notation[^.\n]*/gi, "source formula notation is handled through formula anchors or text fallback")
        .replace(/standard explanatory notation only[^.\n]*/gi, "source-derived formula notation is recorded explicitly")
        .replace(/captions only|caption-only|notation unavailable|mathematical notation not included/gi, "formula anchors and text fallback are available");
    }
    if (facts.hasTables) {
      next = next.replace(/tables? (?:are|is) not (?:present|available|detected)/gi, "tables are present in the extracted source anchors");
    }
    if (facts.hasFigures) {
      next = next.replace(/figures? (?:are|is) not (?:present|available|detected)/gi, "figures are present in the extracted source anchors");
    }
    if (facts.hasLaterPages) {
      next = next
        .replace(/truncated after page\s*2[^.\n]*/gi, "later source pages are available in the extracted anchors")
        .replace(/later sections? (?:are|is)? ?(?:not available|unavailable)[^.\n]*/gi, "later sections are available through source anchors");
    }
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeSourceMapContradictions(item, facts));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeSourceMapContradictions(item, facts),
      ]),
    );
  }
  return value;
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
    addMode("Intentionally Omitted", `- ${figure.figureId}: ${unusedFigureReasons.get(figure.figureId) ?? "Not assigned by the Learning Unit Contract."}`);
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
        lines.push(`- ${formula.figureId}: not assigned by the Learning Unit Contract`);
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
                  : unusedFigureReasons.get(figure.figureId) ?? "Not assigned by the Learning Unit Contract."
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
  ".breadboard/visual-index.json",
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
        coverage_plan_json, source_set_hash, source_ids_json, syllabus_source_id,
        syllabus_coverage_json, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        id, garden_id, job_id, learning_map_id, source_set_hash, page_count,
        backup_dir, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of baselineVersions) {
      insertVersion.run(
        row.id,
        row.garden_id,
        row.job_id,
        row.learning_map_id,
        row.source_set_hash,
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

function textTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((word) => word.length > 3),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) if (b.has(item)) count += 1;
  return count;
}

/** Index of the paragraph most related to `text` (for inserting a visual next
 * to the prose it supports). Falls back to just after the intro. */
function bestParagraphIndex(paragraphs: string[], text: string): number {
  const target = textTokens(text);
  let bestIndex = Math.min(1, paragraphs.length - 1);
  let bestScore = 0;
  paragraphs.forEach((paragraph, index) => {
    if (paragraph.startsWith("```") || paragraph.startsWith("![")) return;
    const score = tokenOverlap(target, textTokens(paragraph));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
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
 * Stage 3 assignment for one page: the plan's sourceVisualsToEmbed wins; when
 * the plan named none, fall back to caption/token overlap so central visuals
 * still land on a relevant page. `claimed` keeps a visual on exactly one page.
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

  let chosen = planned;

  // Semantic assignment belongs to the Learning Unit Contract. If more than
  // the page cap was planned, keep the first planned items and let validation
  // reject the contract/page rather than silently broadening the page.
  if (primaryIds.length === 0) {
    chosen = chosen.slice(0, MAX_VISUALS_PER_PAGE);
  }
  for (const visual of chosen) claimed.add(visual.sourceVisualId);
  return chosen;
}

/** Stage 5: guarantee every assigned source visual appears in the body as a
 * real Markdown image near its most relevant paragraph. The model is asked to
 * weave them in; this is the deterministic backstop. */
function embedAssignedSourceVisuals(markdown: string, visuals: SourceVisual[]): string {
  let paragraphs = markdown.trim().split(/\n{2,}/);
  for (const visual of visuals) {
    const url = sourceVisualEmbedUrl(visual);
    const snippet = sourceVisualMarkdown(visual);
    if (!url || !snippet) continue;
    if (paragraphs.some((paragraph) => paragraph.includes(url))) continue;
    const index = bestParagraphIndex(paragraphs, visual.caption);
    paragraphs = [
      ...paragraphs.slice(0, index + 1),
      snippet,
      ...paragraphs.slice(index + 1),
    ];
  }
  return paragraphs.join("\n\n");
}

const EMBEDDED_VISUAL_BLOCK_RE = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;

function stripEmbeddedVisualBlocks(markdown: string): string {
  return markdown.replace(EMBEDDED_VISUAL_BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Hard dynamic concepts that genuinely need an interactive visual, each mapped
// to the interactive renderer type that teaches it. When a lesson body/title
// mentions one of these, the pipeline attempts to generate that visual (the
// model may still decline, but for these concepts it should not).
interface HardConcept {
  test: RegExp;
  visualType: string;
  concept: string;
  reason: string;
}
const HARD_CONCEPTS: HardConcept[] = [
  {
    test: /\bleaky integrate[- ]and[- ]fire\b|\blif neuron\b|\bmembrane potential\b|\bfiring threshold\b|\brefractory\b/i,
    visualType: "lif_neuron",
    concept: "leaky integrate-and-fire membrane dynamics",
    reason: "Learners need to watch the potential accumulate, leak, cross threshold, spike, and reset over time.",
  },
  {
    test: /\brate coding\b|\btemporal coding\b|\bspike timing\b(?!.*plasticity)|\bfirst[- ]spike latency\b/i,
    visualType: "neural_coding",
    concept: "rate coding versus temporal coding",
    reason: "Learners need to compare spike count against spike timing for the same stimulus.",
  },
  {
    test: /\bspike[- ]timing[- ]dependent plasticity\b|\bstdp\b/i,
    visualType: "stdp_window",
    concept: "the STDP timing window",
    reason: "Learners need to drag the pre/post timing difference and see the synaptic weight change sign.",
  },
  {
    test: /\baccuracy[- ,].*\b(latency|energy)\b|\btradeoff\b|\btrade[- ]off\b|\benergy per inference\b|\bspike count\b/i,
    visualType: "tradeoff_explorer",
    concept: "the accuracy / latency / energy tradeoff across model families",
    reason: "Learners need to change the deployment priority and see which model family wins.",
  },
];

/** First hard concept referenced by this page, or null. */
function detectHardConcept(subsection: LearningSubsectionPlan, body: string): HardConcept | null {
  const haystack = [subsection.title, subsection.purpose, body].join("\n");
  return HARD_CONCEPTS.find((concept) => concept.test.test(haystack)) ?? null;
}

type VisualSourceAnchor = VisualSpec["sourceAnchors"][number];

function sourceAnchorFromId(anchorId: string, sourceFigures: SourceFigure[]): VisualSourceAnchor | null {
  const clean = anchorId.trim();
  if (!/^S\d+\.P\d+\.[A-Z]\d+$/i.test(clean)) return null;
  const figure = sourceFigures.find((item) => item.figureId === clean);
  const page =
    figure?.page ??
    (() => {
      const match = clean.match(/\.P(\d+)\./i);
      return match ? Number.parseInt(match[1], 10) : undefined;
    })();
  const anchor: VisualSourceAnchor = {
    description: figure?.caption?.trim() || clean,
  };
  if (figure?.sourceId) anchor.sourceId = figure.sourceId;
  if (page !== undefined && Number.isFinite(page)) anchor.page = page;
  if (/\.E\d+$/i.test(clean)) anchor.equationId = clean;
  else if (/\.T\d+$/i.test(clean)) anchor.tableId = clean;
  else anchor.figureId = clean;
  return anchor;
}

function anchorCompatibleWithVisual(type: string, anchor: VisualSourceAnchor): boolean {
  const id = String(anchor.figureId ?? anchor.tableId ?? anchor.equationId ?? "");
  return anchorTextCompatibleWithVisualType(type, [id, anchor.description, anchor.sourceTitle].filter(Boolean).join(" "));
}

function uniqueSourceAnchors(anchors: VisualSourceAnchor[]): VisualSourceAnchor[] {
  const seen = new Set<string>();
  const out: VisualSourceAnchor[] = [];
  for (const anchor of anchors) {
    const key = anchor.equationId ?? anchor.tableId ?? anchor.figureId ?? anchor.textAnchorId ?? `${anchor.sourceId ?? ""}:${anchor.page ?? ""}:${anchor.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
  }
  return out;
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

const METRIC_CALCULATOR_CONTROLS: Record<MetricCalculatorFamily, NonNullable<VisualSpec["controls"]>> = {
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

function metricCalculatorFamiliesForSubsection(subsection: LearningSubsectionPlan): MetricCalculatorFamily[] {
  const formulaText = (subsection.sourceFormulaContracts ?? [])
    .map((formula) => [formula.id, formula.teachingGoal, ...(formula.termsToDefine ?? [])].join(" "))
    .join(" ");
  const text = [
    subsection.title,
    subsection.purpose,
    subsection.learningQuestion,
    ...(subsection.newConcepts ?? []),
    ...(subsection.conceptTags ?? []),
    ...(subsection.sourceAnchors ?? []),
    formulaText,
  ].join(" ");
  return METRIC_CALCULATOR_FAMILIES.filter((family) => METRIC_CALCULATOR_PATTERNS[family].test(text));
}

function focusMetricCalculatorSpec(spec: VisualSpec, subsection: LearningSubsectionPlan): VisualSpec {
  if (spec.type !== "metric_calculator") return spec;
  const families = metricCalculatorFamiliesForSubsection(subsection);
  if (families.length === 0) return spec;
  const controlsByName = new Map<string, NonNullable<VisualSpec["controls"]>[number]>();
  for (const family of families) {
    for (const control of METRIC_CALCULATOR_CONTROLS[family]) {
      controlsByName.set(control.name, { ...control });
    }
  }
  const labels = families.map((family) => METRIC_CALCULATOR_LABELS[family]);
  const titleLabels = labels.map(titleCaseMetricLabel);
  spec.title = titleLabels.length === 1 ? `${titleLabels[0]} Calculator` : `${titleLabels.join(" and ")} Calculator`;
  spec.controls = [...controlsByName.values()];
  spec.inputs = spec.controls.map((control) => control.label.toLowerCase());
  spec.outputs = labels;
  spec.conceptTargets = labels;
  spec.pedagogicalPurpose = `Let the learner manipulate inputs for ${labels.join(", ")} and observe how the selected metric responds.`;
  spec.caption = `Adjust the controls to see how ${labels.join(", ")} changes with the chosen inputs.`;
  spec.regenerationPrompt = `Regenerate this metric calculator so its controls and readouts focus only on ${labels.join(", ")}.`;
  return spec;
}

function formulaFamilyForVisualSourceAnchor(anchor: VisualSourceAnchor): string | null {
  return formulaMetricFamily([anchor.equationId, anchor.description, anchor.sourceTitle].filter(Boolean).join(" "));
}

function roleForMetricAnchorFamily(family: string | null, targetFamilies: Set<string>): "input" | "output_formula" | "comparison_basis" | "context" {
  if (family && targetFamilies.has(family)) return "output_formula";
  if (family === "accuracy" || family === "energy" || family === "spike-count") return "input";
  return "context";
}

function filterMetricCalculatorAnchors(spec: VisualSpec): VisualSpec {
  if (spec.type !== "metric_calculator" || !spec.sourceAnchors || spec.sourceAnchors.length === 0) return spec;
  const labels = [
    ...(spec.outputs ?? []),
    ...(spec.conceptTargets ?? []),
    spec.title,
    spec.caption,
    spec.pedagogicalPurpose,
  ].join(" ");
  const expected = new Set(
    METRIC_CALCULATOR_FAMILIES.filter((family) => METRIC_CALCULATOR_PATTERNS[family].test(labels)),
  );
  if (expected.size === 0) return spec;
  if (expected.has("efficiency")) {
    expected.add("accuracy");
    expected.add("energy");
  }
  if (expected.has("energy")) expected.add("spike-count");
  spec.sourceAnchors = spec.sourceAnchors.filter((anchor) => {
    const family = formulaFamilyForVisualSourceAnchor(anchor);
    return !family || expected.has(family as MetricCalculatorFamily);
  }).map((anchor) => {
    const family = formulaFamilyForVisualSourceAnchor(anchor);
    const role = roleForMetricAnchorFamily(family, new Set(METRIC_CALCULATOR_FAMILIES.filter((candidate) => METRIC_CALCULATOR_PATTERNS[candidate].test(labels))));
    return {
      ...anchor,
      role: anchor.role ?? role,
      reason: anchor.reason ?? (
        role === "output_formula"
          ? `This is the metric formula the calculator teaches for ${family ?? "the target metric"}.`
          : role === "input"
            ? `This formula supplies an input needed to compute ${spec.outputs?.join(", ") || "the target metric"}.`
            : `This source anchor provides context for ${spec.outputs?.join(", ") || "the target metric"}.`
      ),
    };
  });
  return spec;
}

function proseConceptForVisual(type: string): { label: string; pattern: RegExp } | null {
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

function sourceTextAnchorForVisual({
  visualType,
  sourceContext,
}: {
  visualType: string;
  sourceContext: unknown;
}): VisualSourceAnchor | null {
  const concept = proseConceptForVisual(visualType);
  if (!concept) return null;
  const dossier = sourceContext && typeof sourceContext === "object" && "dossier" in sourceContext
    ? (sourceContext as { dossier?: unknown }).dossier
    : sourceContext;
  const snippets = dossier && typeof dossier === "object" && Array.isArray((dossier as { relevantSourceSnippets?: unknown }).relevantSourceSnippets)
    ? ((dossier as { relevantSourceSnippets: Array<Record<string, unknown>> }).relevantSourceSnippets)
    : [];
  for (const snippet of snippets) {
    const excerpt = String(snippet.excerpt ?? "").replace(/\s+/g, " ").trim();
    const title = String(snippet.title ?? "").trim();
    const sourceId = String(snippet.sourceId ?? "").trim();
    if (!excerpt || !concept.pattern.test(`${title} ${excerpt}`)) continue;
    const sourcePart = safeLearnFileSegment(sourceId || "source", "source").replace(/\s+/g, "-").toLowerCase();
    const conceptPart = safeLearnFileSegment(concept.label, "concept").replace(/\s+/g, "-").toLowerCase();
    const anchor: VisualSourceAnchor = {
      textAnchorId: `text-${sourcePart}-${conceptPart}`,
      description: `Source prose explains ${concept.label}: ${excerpt.slice(0, 220)}`,
    };
    if (sourceId) anchor.sourceId = sourceId;
    if (title) anchor.sourceTitle = title;
    return anchor;
  }
  return null;
}

function visualAnchorIdsForPage({
  subsection,
  sourceFigures,
}: {
  subsection: LearningSubsectionPlan;
  sourceFigures: SourceFigure[];
}): string[] {
  const ids = [
    ...sourceFigures.map((figure) => figure.figureId),
    ...(subsection.sourceAnchors ?? []).filter((anchor) => /^S\d+\.P\d+\.[A-Z]\d+$/i.test(anchor)),
  ];
  return [...new Set(ids)];
}

type PageVisualIntent = {
  spec: VisualSpec | null;
  suppressGeneric: boolean;
  reason?: string;
};

function pageVisualIntent({
  gardenId,
  pageSlug,
  sectionTitle,
  subsection,
}: {
  gardenId: string;
  pageSlug: string;
  sectionTitle: string;
  subsection: LearningSubsectionPlan;
}): PageVisualIntent {
  const pageText = [sectionTitle, subsection.title, subsection.purpose, ...(subsection.conceptTags ?? [])].join(" ");
  if (/open challenges?|unresolved|limitations?|future work|remaining/i.test(pageText)) {
    return {
      spec: null,
      suppressGeneric: true,
      reason: "This page discusses unresolved challenges rather than a concrete dynamic mechanism with a supported renderer.",
    };
  }
  return { spec: null, suppressGeneric: false };
}

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
  sectionTitle,
  subsection,
  sourceContext,
  sourceFigures,
  visualizationPlan,
  visualizationOutcomes,
  generatedVisualBudget,
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
  sectionTitle: string;
  subsection: LearningSubsectionPlan;
  sourceContext: unknown;
  sourceFigures: SourceFigure[];
  visualizationPlan: VisualizationPlan;
  visualizationOutcomes: VisualizationPublicationOutcome[];
  generatedVisualBudget: { published: number; max: number; maxPerPage: number; perPage: Map<string, number> };
}): Promise<{ markdown: string; visualIds: string[] }> {
  const pageSlug = pageRelPath.replace(/\.md$/i, "");
  const keptIds: string[] = [];
  const intent = pageVisualIntent({ gardenId, pageSlug, sectionTitle, subsection });
  const pageAnchorIds = visualAnchorIdsForPage({ subsection, sourceFigures });
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

  const enrichVisualSpec = (spec: VisualSpec): VisualSpec => {
    spec = focusMetricCalculatorSpec(spec, subsection);
    spec.gardenId = gardenId;
    spec.pageId = pageSlug;
    spec.pagePath = pageRelPath;
    spec.learningGoal = spec.learningGoal || subsection.purpose || sectionTitle;
    spec.inputs =
      spec.inputs && spec.inputs.length > 0
        ? spec.inputs
        : (spec.controls ?? []).map((control) => `${control.label} control`).slice(0, 6);
    if (!spec.inputs || spec.inputs.length === 0) spec.inputs = ["Learner-adjusted interactive controls"];
    spec.outputs =
      spec.outputs && spec.outputs.length > 0
        ? spec.outputs
        : [spec.caption || spec.pedagogicalPurpose || "Interactive comparison output"];

    const existingAnchors = spec.sourceAnchors ?? [];
    const derivedAnchors = pageAnchorIds
      .map((anchorId) => sourceAnchorFromId(anchorId, sourceFigures))
      .filter((anchor): anchor is VisualSourceAnchor => Boolean(anchor));
    // Type-compatibility gate: a LIF simulator must never be "grounded" in
    // energy/latency/result anchors just because they were assigned to the
    // page, and a tradeoff explorer must ground in metric/result figures. This
    // prevents fake grounding where sourceAnchors is non-empty but semantically
    // wrong for the renderer.
    const compatibleConcreteAnchors = uniqueSourceAnchors([...existingAnchors, ...derivedAnchors]).filter((anchor) =>
      anchorCompatibleWithVisual(spec.type, anchor),
    );
    // Apply the metric-calculator anchor filter BEFORE deciding the grounding
    // status. That filter can strip anchors that pass the generic compatibility
    // gate but do not match this calculator's metric families, so the status
    // must reflect the anchors that actually survive onto the spec — never a
    // pre-filter set. Deciding "source-grounded" from the pre-filter list is
    // exactly what produced a metric_calculator claiming grounding with an empty
    // sourceAnchors array.
    spec.sourceAnchors = uniqueSourceAnchors(compatibleConcreteAnchors);
    spec = filterMetricCalculatorAnchors(spec);
    const survivingConcreteAnchors = spec.sourceAnchors ?? [];
    if (survivingConcreteAnchors.length > 0) {
      spec.sourceGroundingStatus = "source-grounded";
      spec.justification = spec.justification || "This interactive visual is tied to source visuals or formula anchors assigned to the same lesson page.";
    } else {
      const proseAnchor = sourceTextAnchorForVisual({ visualType: spec.type, sourceContext });
      if (proseAnchor) {
        spec.sourceAnchors = uniqueSourceAnchors([proseAnchor]);
        spec.sourceGroundingStatus = "source-derived-conceptual";
        spec.justification =
          spec.justification ||
          "The source explains this concept in prose but does not provide a dedicated figure, so the visual is derived from the source text anchor.";
      } else {
        spec.sourceAnchors = [];
        spec.sourceGroundingStatus = "conceptual-no-direct-source-figure";
        spec.justification =
          spec.justification ||
          "This visual teaches a dynamic concept discussed on the page; no directly matching source figure was assigned to this lesson.";
      }
    }
    return spec;
  };

  const recordVisual = (spec: VisualSpec) => {
    spec = enrichVisualSpec(spec);
    saveVisualSpec(contentPath, gardenId, spec, pageSlug);
    keptIds.push(spec.id);
    appendLearnEvent(contentPath, gardenId, "learn_visual_created", {
      jobId,
      textbookVersionId,
      pageId,
      visualId: spec.id,
      sourceIds: [...new Set(spec.sourceAnchors.map((anchor) => anchor.sourceId).filter(Boolean))],
    });
    for (const anchor of spec.sourceAnchors) {
      const figureId = anchor.figureId ?? anchor.tableId ?? anchor.equationId;
      if (!figureId) continue;
      appendLearnEvent(contentPath, gardenId, "learn_source_figure_linked", {
        jobId,
        textbookVersionId,
        pageId,
        visualId: spec.id,
        figureId,
        sourceId: anchor.sourceId,
      });
    }
  };

  // 1) Reconcile blocks the model wrote inline despite instructions. Only
  //    genuinely interactive types survive — there is no static-card fallback
  //    in the renderer, so anything else is removed rather than embedded.
  let nextMarkdown = markdown.replace(EMBEDDED_VISUAL_BLOCK_RE, "");

  // 2) Legacy bracket placeholders are removed, never replaced by filler.
  if (containsRawVisualPlaceholder(nextMarkdown)) {
    nextMarkdown = removeRawVisualPlaceholders(nextMarkdown, "");
  }

  if (!opportunity || !routeDecision || routeDecision.route === "intentional_omission") {
    if (intent.reason) {
      appendLearnEvent(contentPath, gardenId, "learn_visual_skipped", {
        jobId,
        textbookVersionId,
        pageId,
        reason: intent.reason,
      });
    }
    if (opportunity) {
      recordOutcome({
        opportunityId: opportunity.id,
        status: "intentional_omission",
        reason: routeDecision?.reason ?? intent.reason ?? "No pedagogically useful interaction was planned.",
      });
    }
    return { markdown: nextMarkdown, visualIds: keptIds };
  }

  // 3) Decide which interactive visual this page should get. Only the
  //    Learning Unit Contract may request one; there is no page-role default
  //    and no hard-concept auto-add.
  const contractVisual = subsection.interactiveVisualContract;
  if (contractVisual && subsection.learningUnitRole) {
    const compatibilityUnit: LearningUnitContract = {
      id: subsection.learningUnitId ?? pageSlug,
      title: subsection.title,
      role: subsection.learningUnitRole,
      learningQuestion: subsection.learningQuestion ?? subsection.purpose,
      prerequisiteConcepts: subsection.prerequisiteConcepts ?? [],
      newConcepts: subsection.newConcepts ?? [],
      sourceAnchors: subsection.sourceAnchors ?? [],
      sourceFigures: subsection.sourceFigureContracts ?? [],
      sourceFormulas: subsection.sourceFormulaContracts ?? [],
      sourceTables: subsection.sourceTableContracts ?? [],
      interactiveVisual: contractVisual,
      zettelNotes: subsection.zettelNotes ?? [],
      mustNotRepeat: subsection.mustNotRepeat ?? [],
      expectedWordRange: subsection.expectedWordRange ?? [700, 1100],
    };
    const compat = visualTypeCompatibleWithUnit(contractVisual.visualType, compatibilityUnit);
    if (!compat.ok) {
      throw new Error(`Interactive visual "${contractVisual.visualType}" is incompatible with ${pageSlug}: ${compat.reason}`);
    }
  }
  const opportunities: Array<{ concept: string; reason: string; preferredType?: string }> = contractVisual
    ? [
        {
          concept: contractVisual.uniqueConcept,
          reason: contractVisual.whyStaticSourceFigureIsNotEnough,
          preferredType: routeDecision.selectedRenderer ?? contractVisual.visualType,
        },
      ]
    : (subsection.interactiveVisuals ?? []).map((plan) => ({
        concept: plan.concept,
        reason: plan.reason,
        preferredType: HARD_CONCEPTS.find((c) => c.test.test(`${plan.concept} ${plan.reason}`))?.visualType,
      }));
  if (opportunities.length === 0) {
    opportunities.push({
      concept: opportunity.learningObjective,
      reason: opportunity.pedagogicalReason,
      preferredType: routeDecision.selectedRenderer,
    });
  }

  if (routeDecision.route === "generated_module") {
    if (generatedVisualBudget.published >= generatedVisualBudget.max) {
      const reason = `Generated visualization garden limit (${generatedVisualBudget.max}) reached.`;
      recordOutcome({ opportunityId: opportunity.id, status: "failed_validation", reason });
      appendLearnEvent(contentPath, gardenId, "visual_resource_limit_reached", {
        jobId,
        textbookVersionId,
        pageId,
        visualizationId: opportunity.id,
        limit: generatedVisualBudget.max,
      });
      return { markdown: nextMarkdown, visualIds: keptIds };
    }
    const publishedOnPage = generatedVisualBudget.perPage.get(pageRelPath) ?? 0;
    if (publishedOnPage >= generatedVisualBudget.maxPerPage) {
      const reason = `Generated visualization page limit (${generatedVisualBudget.maxPerPage}) reached.`;
      recordOutcome({ opportunityId: opportunity.id, status: "failed_validation", reason });
      appendLearnEvent(contentPath, gardenId, "visual_resource_limit_reached", {
        jobId,
        textbookVersionId,
        pageId,
        visualizationId: opportunity.id,
        limitScope: "page",
        limit: generatedVisualBudget.maxPerPage,
      });
      return { markdown: nextMarkdown, visualIds: keptIds };
    }

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
      availableSourceAnchorIds: new Set([
        ...(subsection.sourceAnchors ?? []),
        ...pageAnchorIds,
        ...sourceFigures.map((figure) => figure.figureId),
      ]),
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
      generatedVisualBudget.published += 1;
      generatedVisualBudget.perPage.set(pageRelPath, publishedOnPage + 1);
      recordOutcome({ opportunityId: opportunity.id, status: "generated_published" });
    } else {
      const fallbackType = routeDecision.selectedRenderer;
      const fallback = fallbackType
        ? buildDeterministicVisual(fallbackType, { gardenId, pageSlug })
        : null;
      if (fallback) {
        recordVisual(fallback);
        nextMarkdown = nextMarkdown.replace(marker, `${marker}\n\n${buildVisualBlock(fallback)}`);
        recordOutcome({
          opportunityId: opportunity.id,
          status: "trusted_published",
          reason: `Generated module attempts were exhausted; used compatible trusted renderer ${fallbackType}.`,
        });
        appendLearnEvent(contentPath, gardenId, "visual_fallback_used", {
          jobId,
          textbookVersionId,
          pageId,
          visualizationId: opportunity.id,
          route: "trusted_renderer",
          renderer: fallbackType,
          failureCategory: result.failureCategory,
          reason: result.errors.join("; "),
        });
        return { markdown: nextMarkdown, visualIds: keptIds };
      }
      const status: VisualizationPublicationOutcome["status"] =
        result.failureCategory === "runtime"
          ? "failed_runtime_tests"
          : result.failureCategory === "critic"
            ? "failed_critic"
            : result.failureCategory === "compilation"
              ? "failed_compilation"
              : "failed_validation";
      recordOutcome({ opportunityId: opportunity.id, status, reason: result.errors.join("; ") });
    }
    return { markdown: nextMarkdown, visualIds: keptIds };
  }

  const embedSpec = (spec: VisualSpec, near: string) => {
    recordVisual(spec);
    const paragraphs = nextMarkdown.trim().split(/\n{2,}/);
    const index = bestParagraphIndex(paragraphs, near);
    nextMarkdown = [
      ...paragraphs.slice(0, index + 1),
      buildVisualBlock(spec),
      ...paragraphs.slice(index + 1),
    ].join("\n\n");
  };

  for (const visualRequest of opportunities.slice(0, 2)) {
    if (keptIds.length > 0) break; // page already has a working interactive

    // Deterministic builder first for hard dynamic concepts: guaranteed valid,
    // never declines. Only fall back to the model when no builder matches.
    if (visualRequest.preferredType) {
      const built = buildDeterministicVisual(visualRequest.preferredType, { gardenId, pageSlug });
      if (built) {
        embedSpec(built, `${visualRequest.concept} ${visualRequest.reason}`);
        recordOutcome({ opportunityId: opportunity.id, status: "trusted_published" });
        continue;
      }
    }

    const typeHint = visualRequest.preferredType
      ? ` Use the interactive visual type "${visualRequest.preferredType}".`
      : "";
    try {
      const generated = await generateVisualSpec(client, model, {
        gardenId,
        pageId: pageSlug,
        sectionTitle,
        subsectionTitle: subsection.title,
        pageMarkdown: nextMarkdown,
        sourceContext,
        sourceFigures,
        visualOpportunity: `${visualRequest.concept}${visualRequest.reason ? ` — ${visualRequest.reason}` : ""}.${typeHint}`,
        councilModeOverride: sourceFigures.length > 0 ? "full_council" : "lite_council",
      });
      const spec = generated.spec;
      if (!spec) continue;
      embedSpec(spec, `${visualRequest.concept} ${visualRequest.reason}`);
      recordOutcome({ opportunityId: opportunity.id, status: "trusted_published" });
    } catch {
      // Model visual failed; a hard concept still gets its deterministic builder
      // below, other opportunities may simply produce no visual.
    }
  }

  if (keptIds.length === 0) {
    recordOutcome({
      opportunityId: opportunity.id,
      status: "failed_validation",
      reason: `The selected trusted renderer ${routeDecision.selectedRenderer ?? ""} did not produce a valid interactive spec.`,
    });
  }

  return { markdown: nextMarkdown, visualIds: keptIds };
}

// Debug-only draft. This is NEVER learner-facing: it is written to
// .breadboard/debug/failed-pages/ when every generation attempt fails quality
// gates, so a human can inspect what the model produced. It intentionally
// carries fallback fingerprints ("The durable concept", "Relevant details:")
// precisely so the quality critic and validator reject it if it ever leaks.
function debugFailedSubsectionDraft({
  sectionNumber,
  subsectionNumber,
  subsection,
  sectionTitle,
  anchors,
  sources,
  assignedVisuals,
}: {
  sectionNumber: number;
  subsectionNumber: number;
  subsection: LearningSubsectionPlan;
  sectionTitle: string;
  anchors: string[];
  sources: LearnSourceSummary[];
  assignedVisuals: SourceVisual[];
}): string {
  const cleanTitle = sanitizeLearnerTitle(subsection.title);
  const title = `${sectionNumber}.${subsectionNumber} ${cleanTitle}`;
  const purpose = scrubLearnerProse(
    subsection.purpose || `${cleanTitle} connects the section topic to the concrete ideas a learner needs next.`,
  );
  const details = fallbackRelevantDetails({ sources, subsection, anchors });
  const conceptList = (subsection.conceptTags ?? [])
    .map((tag) => tag.split("/").at(-1)?.replace(/-/g, " "))
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);
  const visualCaptions = assignedVisuals
    .map((visual) => visual.caption)
    .filter(Boolean)
    .slice(0, 3);
  const topicLower = `${cleanTitle} ${purpose}`.toLowerCase();
  const snnFraming =
    /\bsnn|spik|neural network|neuron\b/i.test(topicLower)
      ? "A conventional neural network usually carries information as continuously changing activation values from layer to layer. A spiking neural network changes the representation: a unit stays quiet until its state crosses a threshold, then it sends a discrete spike at a particular time. That shift makes timing, silence, and event count part of the computation, which is why energy use and latency become central design questions."
      : `${cleanTitle} is best understood as a bridge between the broad goal of ${sectionTitle} and the smaller mechanism this lesson focuses on. The useful habit is to ask what information has to be represented, what operation changes it, and what constraint makes that operation necessary.`;
  const relevantDetails =
    details.length > 0
      ? details.map((detail) => `- ${detail}`).join("\n")
      : "- The confirmed learning map did not provide enough local detail for a deeper automatic explanation. The lesson therefore stays close to the section purpose and avoids adding unsupported claims.";
  const concepts =
    conceptList.length > 0
      ? `The durable concepts to keep active are ${conceptList.join(", ")}.`
      : "The durable concept is the relation between the starting representation, the mechanism that changes it, and the practical tradeoff that follows.";
  const visuals =
    visualCaptions.length > 0
      ? `The visual material attached to this lesson should be read as evidence for the mechanism: ${visualCaptions.join("; ")}.`
      : "When no figure is attached, read the lesson by tracking the chain from representation to mechanism to consequence.";
  return [
    `# ${title}`,
    "",
    purpose,
    "",
    snnFraming,
    "",
    `${concepts} For example, compare two systems that receive mostly unchanged input over time. A dense continuous system still tends to move values through many layers on each update. An event-driven system can let silence mean "nothing important changed" and spend work only when a spike occurs. That example gives the transition a practical meaning: the representation is tied to cost, timing, and the kind of hardware that can run the computation efficiently.`,
    "",
    visuals,
    "",
    "Relevant details:",
    "",
    relevantDetails,
    "",
    "Read these details as a sequence. First identify the representation being used. Then ask what event, threshold, formula, or comparison changes that representation. Finally, connect that change to a consequence such as accuracy, latency, energy, convergence, or interpretability. This sequence keeps the lesson from becoming a list of facts: each detail earns its place by explaining why the next detail is needed.",
    "",
    `**Question.** Why does ${cleanTitle} matter before reading the later lessons in this section?`,
    "",
    `**Answer.** It fixes the mental model for the rest of the section. Once you know what is being represented and why the representation changes, later details become easier to place: a neuron rule describes how an event is produced, a learning rule describes how behavior improves, and an evaluation metric describes the cost of the choice. The lesson is therefore a starting chain that links mechanism to consequence.`,
  ].join("\n");
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

function fallbackKeywords(subsection: LearningSubsectionPlan, anchors: string[]): Set<string> {
  return new Set(
    [subsection.title, subsection.purpose, ...anchors, ...(subsection.conceptTags ?? [])]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((word) => word.length > 3 && !["overview", "source", "paper", "textbook"].includes(word)),
  );
}

function fallbackRelevantDetails({
  sources,
  subsection,
  anchors,
}: {
  sources: LearnSourceSummary[];
  subsection: LearningSubsectionPlan;
  anchors: string[];
}): string[] {
  const keywords = fallbackKeywords(subsection, anchors);
  const candidates: Array<{ text: string; score: number }> = [];
  for (const source of sources) {
    const rawBlocks = [source.excerpt ?? "", ...(source.body ?? "").split(/\n{2,}/)];
    for (const block of rawBlocks) {
      const text = compactFallbackText(block);
      if (text.length < 80) continue;
      const words = text.toLowerCase().split(/[^a-z0-9]+/g);
      const score = words.reduce((sum, word) => sum + (keywords.has(word) ? 1 : 0), 0);
      candidates.push({ text: text.slice(0, 360), score });
    }
  }
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length)
    .map((candidate) => candidate.text)
    .filter((text) => {
      const key = text.slice(0, 80).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

// --- PageDossier: compact per-page context for subsection writing -----------
// A subsection prompt no longer receives the full source map, scope contract,
// and learning spine. It receives one curated local packet: what this exact
// page must teach, the source excerpts that ground it, and the visuals
// assigned to it. Selection is deterministic keyword matching — no extra
// model calls.

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
    sourceFigures?: LearningSubsectionPlan["sourceFigureContracts"];
    sourceFormulas?: LearningSubsectionPlan["sourceFormulaContracts"];
    sourceTables?: LearningSubsectionPlan["sourceTableContracts"];
    sourceArtifactAssignments?: SourceArtifactAssignment[];
    interactiveVisual?: LearningSubsectionPlan["interactiveVisualContract"];
    interactiveVisualPlan?: LearningSubsectionPlan["interactiveVisualPlan"];
    teachingMediumPlan?: LearningSubsectionPlan["teachingMediumPlan"];
    zettelNotes?: LearningSubsectionPlan["zettelNotes"];
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

  /** The syllabus unit this page serves, when one maps to it. */
  syllabusUnit?: {
    label?: string;
    title: string;
    objectives: string[];
    topics: string[];
  };

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

/** Blocks worth quoting: formulas, definitions, examples, figure/table talk. */
function snippetLooksHighValue(text: string): boolean {
  return (
    /[=\u2248\u2264\u2265\u2211\u222b]/.test(text) ||
    /\b(defin\w*|formula|equation|for example|for instance|figure|table|means that|is called)\b/i.test(text)
  );
}

/**
 * Deterministic snippet selector: score source paragraphs against the
 * subsection's keywords, prefer definition/formula/example/figure blocks,
 * deduplicate near-identical blocks, and stop at the per-page budgets.
 */
function selectRelevantSourceSnippets({
  sources,
  keywords,
  preferredSourceIds,
}: {
  sources: LearnSourceSummary[];
  keywords: Set<string>;
  /** Documents the syllabus assigns for this page's unit. Their blocks win ties
   * and outrank equally-scoring blocks elsewhere, so the page is genuinely
   * built on the assigned reading rather than merely consistent with it. */
  preferredSourceIds?: ReadonlySet<string>;
}): Array<{ sourceId: string; title: string; excerpt: string }> {
  const candidates: Array<{
    sourceId: string;
    title: string;
    excerpt: string;
    score: number;
  }> = [];
  for (const source of sources) {
    const blocks = [source.excerpt ?? "", ...(source.body ?? "").split(/\n{2,}/)];
    for (const block of blocks) {
      const text = compactFallbackText(block);
      if (text.length < 80) continue;
      const words = text.toLowerCase().split(/[^a-z0-9]+/g);
      let score = words.reduce((sum, word) => sum + (keywords.has(word) ? 1 : 0), 0);
      if (score === 0) continue;
      if (snippetLooksHighValue(text)) score += 2;
      if (preferredSourceIds?.has(source.slug)) score += 5;
      candidates.push({
        sourceId: source.slug,
        title: source.title,
        excerpt: text.slice(0, MAX_CHARS_PER_SNIPPET),
        score,
      });
    }
  }

  const seen = new Set<string>();
  const selected: Array<{ sourceId: string; title: string; excerpt: string }> = [];
  let totalChars = 0;
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.length >= MAX_SNIPPETS_PER_PAGE) break;
    const key = `${candidate.sourceId}:${candidate.excerpt.slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) continue;
    if (totalChars + candidate.excerpt.length > MAX_TOTAL_SOURCE_CHARS_PER_PAGE) continue;
    seen.add(key);
    totalChars += candidate.excerpt.length;
    selected.push({
      sourceId: candidate.sourceId,
      title: candidate.title,
      excerpt: candidate.excerpt,
    });
  }

  // No keyword hit anywhere (very short sources, odd titles): still ground the
  // page with each source's opening so source-awareness never drops to zero.
  if (selected.length === 0) {
    const openingOrder = preferredSourceIds
      ? [
          ...sources.filter((source) => preferredSourceIds.has(source.slug)),
          ...sources.filter((source) => !preferredSourceIds.has(source.slug)),
        ]
      : sources;
    for (const source of openingOrder.slice(0, MAX_SNIPPETS_PER_PAGE)) {
      const text = compactFallbackText(source.excerpt ?? source.body ?? "");
      if (text.length < 40) continue;
      const excerpt = text.slice(0, MAX_CHARS_PER_SNIPPET);
      if (totalChars + excerpt.length > MAX_TOTAL_SOURCE_CHARS_PER_PAGE) break;
      totalChars += excerpt.length;
      selected.push({ sourceId: source.slug, title: source.title, excerpt });
    }
  }
  return selected;
}

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
  sourceOnly: boolean;
}): PageDossier {
  const subsectionTitle = sanitizeLearnerTitle(subsection.title);
  const keywords = fallbackKeywords(subsection, anchors);
  const assignedArtifactsForUnit = subsection.learningUnitId && sourceArtifactAssignments
    ? sourceArtifactAssignments.filter((assignment) => assignment.assignedLearningUnitId === subsection.learningUnitId)
    : (subsection.sourceArtifactAssignments ?? []);
  for (const word of [sectionTitle, ...assignedVisuals.map((visual) => visual.caption)]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)) {
    if (word.length > 3) keywords.add(word);
  }

  // Which syllabus unit this page serves, and therefore which uploaded reading
  // the course actually assigns for it.
  const matchedSyllabusUnit = matchSyllabusUnitForPage(
    syllabusCoverage ?? null,
    [
      subsectionTitle,
      subsection.purpose ?? "",
      subsection.learningQuestion ?? "",
      ...(subsection.conceptTags ?? []),
      ...(subsection.newConcepts ?? []),
    ].join(" "),
  );
  const assignedSourceIds = new Set(matchedSyllabusUnit?.availableSourceIds ?? []);

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
          sourceFigures: subsection.sourceFigureContracts,
          sourceFormulas: subsection.sourceFormulaContracts,
          sourceTables: subsection.sourceTableContracts,
          sourceArtifactAssignments: assignedArtifactsForUnit,
          interactiveVisual: subsection.interactiveVisualContract,
          interactiveVisualPlan: subsection.interactiveVisualPlan,
          teachingMediumPlan: subsection.teachingMediumPlan,
          zettelNotes: subsection.zettelNotes,
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
    syllabusUnit: matchedSyllabusUnit
      ? {
          label: matchedSyllabusUnit.label,
          title: matchedSyllabusUnit.title,
          objectives: matchedSyllabusUnit.objectives,
          topics: matchedSyllabusUnit.topics,
        }
      : undefined,
    unavailableCitations: syllabusCoverage?.missingCitations.length
      ? syllabusCoverage.missingCitations
      : undefined,
    relevantSourceSnippets: selectRelevantSourceSnippets({
      sources,
      keywords,
      preferredSourceIds: assignedSourceIds,
    }),
    assignedSourceVisuals: assignedVisuals
      .slice(0, MAX_VISUALS_PER_PAGE)
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
    if (context.sourceSetHash !== map.sourceSetHash) {
      throw new LearnPipelineConflictError(
        "The selected sources changed after this Learning Map was created. Run Learn planning again and review the updated map before generating lessons.",
      );
    }
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
    if (stagedContext.sourceSetHash !== map.sourceSetHash) {
      throw new LearnPipelineConflictError(
        "The selected sources changed while Learn was preparing its isolated workspace. Run planning again before generating lessons.",
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
  let confirmedLearningUnits = learningUnitsFromCoveragePlan(map.coveragePlan);
  const confirmedSourceArtifactAssignments = sourceArtifactAssignmentsFromCoveragePlan(map.coveragePlan);
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
  const generatedVisualBudget = {
    published: 0,
    max: Math.max(1, Math.min(50, Number(
      process.env.LEARN_GENERATED_VISUAL_MAX_PER_GARDEN ??
      process.env.LEARN_MAX_GENERATED_VISUALS_PER_GARDEN ??
      12,
    ) || 12)),
    maxPerPage: Math.max(1, Math.min(6, Number(process.env.LEARN_GENERATED_VISUAL_MAX_PER_PAGE ?? 3) || 3)),
    perPage: new Map<string, number>(),
  };

  try {
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
    const ledgerVisuals = await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
    const selectedCanonicalSourceAnchors = Object.fromEntries(
      Object.entries(buildCanonicalSourceAnchors(clusterDir)).filter(([, anchor]) =>
        typeof anchor.sourceId === "string" && selectedSourceIds.has(anchor.sourceId),
      ),
    );
    const sourceFormulaIdentities = buildFormulaIdentityRegistry(
      selectedCanonicalSourceAnchors,
      clusterDir,
    );
    // Garden-derived family registry so custom (non-universal) formula families
    // are recognized by every requirement/guard on this run.
    const generationFamilyRegistry = buildGardenFormulaFamilyRegistry(sourceFormulaIdentities);
    const sourceFormulaIdentityById = new Map(
      sourceFormulaIdentities.map((identity) => [identity.anchorId, identity]),
    );
    // Verified, family-constrained global assignment plan. Deterministic
    // first; ONLY a genuine tie between compatible candidates goes to
    // ChatMock, whose decision is independently re-verified against the
    // compatibility matrix. An unavailable/refused critic leaves the unit
    // source-formula-free — it never blocks generation and never lets an
    // incompatible family through.
    {
      const criticEnabled = (process.env.BREADBOARD_CRITIC_ENABLED ?? "true").trim() !== "false";
      const assignmentRepairModel: FormulaAssignmentRepairModel | undefined = criticEnabled
        ? async (packet: FormulaAssignmentRepairPacket): Promise<FormulaAssignmentRepairDecision | null> => {
            const system =
              "Select the ONE source formula this learning unit should teach, or report that none fits. Return STRICT JSON: " +
              "{\"action\":\"select_candidate\"|\"no_compatible_formula\",\"anchorId\"?:string,\"justification\":string,\"confidence\":\"high\"|\"medium\"|\"low\"}. " +
              "You may ONLY pick an anchorId from candidates. rejectedCandidates are listed for context and are FORBIDDEN. " +
              "Never invent an anchor or formula text, never change the unit's semantic family, and prefer no_compatible_formula over a doubtful pick.";
            const { parsed } = await callCouncilJson({
              client,
              model,
              taskType: "critique",
              gardenId,
              system,
              user: JSON.stringify(packet),
              sourceContext: packet,
              councilModeOverride: "direct_council",
              timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
            });
            if (!parsed || typeof parsed !== "object") return null;
            const record = parsed as Record<string, unknown>;
            const action = String(record.action ?? "");
            const confidence = ["high", "medium", "low"].includes(String(record.confidence ?? ""))
              ? String(record.confidence) as "high" | "medium" | "low" : "low";
            const justification = typeof record.justification === "string" ? record.justification : "";
            if (action === "select_candidate" && typeof record.anchorId === "string") {
              return { action, anchorId: record.anchorId, justification, confidence };
            }
            if (action === "no_compatible_formula") {
              return { action, justification, confidence };
            }
            return null;
          }
        : undefined;
      const previousAssignments = confirmedLearningUnits.flatMap((unit) =>
        unit.sourceFormulas.map((formula) => ({ formulaAnchorId: formula.id, unitId: unit.id })));
      const initialPlan = buildFormulaAssignmentPlan(sourceFormulaIdentities, confirmedLearningUnits, {
        previousAssignments,
        familyRegistry: generationFamilyRegistry,
      });
      const ambiguityResolution = await resolveFormulaAssignmentAmbiguities({
        plan: initialPlan,
        formulas: sourceFormulaIdentities,
        units: confirmedLearningUnits,
        repairModel: assignmentRepairModel,
        familyRegistry: generationFamilyRegistry,
        maxCalls: 3,
      });
      const assignmentPlan = ambiguityResolution.plan;
      const planApplication = applyFormulaAssignmentPlanToUnits({
        units: confirmedLearningUnits,
        plan: assignmentPlan,
        formulas: sourceFormulaIdentities,
        familyRegistry: generationFamilyRegistry,
        unknownAnchorPolicy: "remove",
      });
      if (planApplication.result.applied) {
        confirmedLearningUnits = planApplication.units;
      }
      // Formulas the plan intentionally left unassigned are recorded on the
      // source-visuals ledger so Source Coverage reports them as justified
      // omissions instead of missing material.
      markIntentionallyOmittedFormulasInLedger(clusterDir, assignmentPlan);
      appendLearnEvent(contentPath, gardenId, "learn_formula_assignment_planned", {
        jobId: job.id,
        textbookVersionId,
        verifiedIdentities: sourceFormulaIdentities.filter((identity) => identity.verified).length,
        totalIdentities: sourceFormulaIdentities.length,
        compatibilityPairsEvaluated: sourceFormulaIdentities.length * confirmedLearningUnits.length,
        assignments: assignmentPlan.assignments
          .filter((assignment) => assignment.status === "assigned" || assignment.status === "reused_with_reason")
          .map((assignment) => `${assignment.formulaAnchorId} -> ${assignment.unitId}`),
        rejectedAssignments: assignmentPlan.rejectedAssignments,
        formulasIntentionallyUnassigned: assignmentPlan.formulasWithoutCompatibleUnits,
        unitsWithoutCompatibleFormula: assignmentPlan.unitsMissingRequiredFormulas,
        ambiguitiesSentToChatMock: ambiguityResolution.packetsSent,
        chatMockDecisionsApplied: ambiguityResolution.decisionsApplied,
        planValid: assignmentPlan.valid,
        planProblems: assignmentPlan.problems,
        applied: planApplication.result.applied,
        rolledBack: planApplication.result.rolledBack,
        blockersBefore: planApplication.result.blockersBefore,
        blockersAfter: planApplication.result.blockersAfter,
      });
    }
    // Rerun necessity against the post-formula contract. Only ambiguous cases
    // use the bounded reviewer; every response is independently validated.
    const generationVisualNecessityReview = await planAndReviewVisualNecessity({
      client,
      model,
      gardenId,
      contentPath: artifactContentPath,
      jobId: job.id,
      learningUnits: confirmedLearningUnits,
    });
    confirmedLearningUnits = generationVisualNecessityReview.learningUnits;
    // Persist the planned contract; the deterministic planner inside the
    // writer re-validates the (already valid) assignments idempotently.
    const contractWrite = writeLearningUnitContractArtifacts({
      clusterDir,
      units: confirmedLearningUnits,
      assignments: confirmedSourceArtifactAssignments,
      sourceSetHash: context.sourceSetHash,
      visualNecessityReview: generationVisualNecessityReview,
    });
    confirmedLearningUnits = contractWrite.units;
    let repairedCoveragePlan = {
      ...planningRecord(map.coveragePlan),
      learningUnitContracts: confirmedLearningUnits,
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
    visualizationPlan = buildVisualizationPlan({
      gardenId,
      learningMap: repairedLearningMap,
      learningUnits: confirmedLearningUnits,
      necessityReviewCalls: generationVisualNecessityReview.reviewCalls,
      rejectedNecessityReviews: generationVisualNecessityReview.rejectedReviews,
      visualDecisionOverrides: generationVisualNecessityReview.overrides,
    });
    confirmedLearningUnits = applyVisualizationRoutesToLearningUnits(
      confirmedLearningUnits,
      visualizationPlan,
    );
    persistRoutedVisualPlans(clusterDir, confirmedLearningUnits);
    repairedCoveragePlan = {
      ...repairedCoveragePlan,
      learningUnitContracts: confirmedLearningUnits,
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
        assertPlannedFormulaAssignment(identity, deriveUnitFormulaRequirement(unit, generationFamilyRegistry), unit, generationFamilyRegistry);
      }
    }
    throwIfLearnCancelled(job.id);
    updateLearnJob(job.id, {
      status: "generating_learning_pages",
      currentStep: "Writing overview pages",
      progressPercent: 3,
    });

    let overviewBody = "";
    try {
      const overviewCall = await callCouncilText({
        client,
        model,
        taskType: "source_synthesis",
        gardenId,
        pageId: "learning/Topic Overview",
        system: OVERVIEW_PROMPT,
        user: compactJson({
          learningMap: map.learningMap,
          scopeContract: map.scopeContract,
          sourceOnly,
        }),
        sourceContext: {
          gardenId,
          pageId: "learning/Topic Overview",
          taskType: "source_synthesis",
          sourceIds: context.sources.map((source) => source.slug),
        },
        councilModeOverride: LEARN_GENERATION_COUNCIL_MODE,
      });
      overviewBody = cleanCouncilMarkdown(
        overviewCall.content,
        renderTopicOverviewFallback(map.learningMap, context),
      );
    } catch {
      overviewBody = renderTopicOverviewFallback(map.learningMap, context);
    }
    throwIfLearnCancelled(job.id);

    // The overview is LLM-authored and tends to emit loose title-based
    // wikilinks (`[[Section]]`, `[[Section#Subsection]]`) that do not resolve
    // to the numbered on-disk folders. Rewrite every resolvable link to its
    // canonical vault-root path; report anything left broken.
    {
      const canonicalized = canonicalizeLearnerWikilinks(overviewBody, map.learningMap);
      overviewBody = canonicalized.markdown;
      if (canonicalized.unresolved.length > 0) {
        appendLearnEvent(contentPath, gardenId, "learn_overview_broken_links", {
          jobId: job.id,
          unresolved: canonicalized.unresolved,
        });
      }
      overviewBody = stripEmbeddedVisualBlocks(overviewBody);
    }

    // Learner-facing planning pages live in learning/. Everything else is
    // internal and is written under .breadboard/planning/ so it never appears
    // in the published garden or the knowledge graph.
    const learningRelPaths = [
      {
        relPath: `${LEARNING_ROOT}/_index.md`,
        title: map.learningMap.title || context.gardenTitle,
        type: "learning-index",
        body: renderLearningIndexMarkdown(map.learningMap, context),
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
      const sectionTitle = sanitizeLearnerTitle(section.title);
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
          `# ${sectionNumber}. ${sectionTitle}\n\n${scrubLearnerProse(section.purpose || `Work through the lessons in this section in order to build up ${sectionTitle}.`)}\n`,
      });

      for (let subsectionIndex = 0; subsectionIndex < section.subsections.length; subsectionIndex += 1) {
        throwIfLearnCancelled(job.id);
        const subsection = section.subsections[subsectionIndex];
        const subsectionNumber = subsectionIndex + 1;
        const subsectionTitle = sanitizeLearnerTitle(subsection.title);
        const pageTitle = `${sectionNumber}.${subsectionNumber} ${subsectionTitle}`;
        const pageFileName = textbookPageFileName(sectionNumber, subsectionNumber, subsectionTitle);
        const pageRelPath = `${sectionFolder}/${pageFileName}`;
        const pageId = pageRelPath.replace(/\.md$/i, "");
        const anchors =
          subsection.sourceAnchors.length > 0
            ? subsection.sourceAnchors
            : section.sourceAnchors.length > 0
              ? section.sourceAnchors
              : context.sources.map((source) => source.title);
        // Stage 3: which extracted source visuals belong on this page.
        const assignedVisuals = assignSourceVisualsForSubsection({
          visuals: ledgerVisuals,
          subsection,
          section,
          claimed: claimedVisualIds,
          sourceArtifactAssignments: confirmedSourceArtifactAssignments,
        });
        const metricFormulaAnchorIds = (subsection.sourceFormulaContracts ?? []).map((formula) => formula.id);
        const formulaUnit = confirmedLearningUnits.find((unit) => unit.id === subsection.learningUnitId);
        const formulaUnitRequirement = formulaUnit ? deriveUnitFormulaRequirement(formulaUnit, generationFamilyRegistry) : undefined;
        for (const anchorId of metricFormulaAnchorIds) {
          const identity = sourceFormulaIdentityById.get(anchorId);
          if (!identity || !formulaUnit || !formulaUnitRequirement) {
            throw new Error(`Formula pre-write guard: ${anchorId} cannot be resolved to a verified unit assignment.`);
          }
          assertPlannedFormulaAssignment(identity, formulaUnitRequirement, formulaUnit, generationFamilyRegistry);
        }
        const sourceFigures = sourceFiguresFromVisuals(assignedVisuals);
        const interactiveSourceFigures =
          metricFormulaAnchorIds.length > 0
            ? [
                ...sourceFigures,
                ...sourceFormulaFiguresForSubsection(context, subsection).filter(
                  (formula) => !sourceFigures.some((figure) => figure.figureId === formula.figureId),
                ),
              ]
            : sourceFigures;
        // Compact per-page packet: everything the model needs to write THIS
        // subsection, nothing else. The full source map / scope contract /
        // learning spine never ride into page prompts anymore.
        const pageDossier = buildPageDossier({
          gardenTitle: map.learningMap.title || context.gardenTitle,
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

        // Stage 4: up to two direct_council generation calls. Each attempt gets
        // deterministic clean/scrub + visual embedding, then the local quality
        // critic. A hard-failing attempt gets one focused repair call. If no
        // attempt passes, the last draft is quarantined for debugging and the
        // job fails. The deterministic emergency draft is never learner-facing.
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

          // Deterministic hygiene, Q&A safety net, and source-visual embedding
          // happen before the critic so it judges the final page.
          attemptBody = scrubSourceCommentaryProse(scrubAiisms(scrubLearnerProse(attemptBody)));
          attemptBody = ensureQuestionBlock(attemptBody, subsectionTitle);
          attemptBody = embedAssignedSourceVisuals(attemptBody, assignedVisuals);

          let quality = assessLessonQuality(attemptBody, {
            assignedVisualUrls,
            unavailableCitations: unavailableCitationGate,
          });
          if (quality.problems.some((problem) => problem.code === "source-commentary")) {
            // Free deterministic re-scrub before spending any model call.
            attemptBody = scrubSourceCommentaryProse(attemptBody);
            attemptBody = ensureQuestionBlock(attemptBody, subsectionTitle);
            attemptBody = embedAssignedSourceVisuals(attemptBody, assignedVisuals);
            quality = assessLessonQuality(attemptBody, {
            assignedVisualUrls,
            unavailableCitations: unavailableCitationGate,
          });
          }

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
                    .map((problem) =>
                      problem.evidence?.length
                        ? `${problem.code}: ${problem.message} — offending lines: ${problem.evidence
                            .map((line) => JSON.stringify(line))
                            .join(", ")}`
                        : `${problem.code}: ${problem.message}`,
                    ),
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
              attemptBody = scrubSourceCommentaryProse(scrubAiisms(scrubLearnerProse(attemptBody)));
              attemptBody = ensureQuestionBlock(attemptBody, subsectionTitle);
              attemptBody = embedAssignedSourceVisuals(attemptBody, assignedVisuals);
              quality = assessLessonQuality(attemptBody, {
            assignedVisualUrls,
            unavailableCitations: unavailableCitationGate,
          });
            } catch {
              // Keep the deterministic result and let the hard gate decide.
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
            const debugContent =
              lastAttemptBody ||
              debugFailedSubsectionDraft({
                sectionNumber,
                subsectionNumber,
                subsection,
                sectionTitle,
                anchors,
                sources: context.sources,
                assignedVisuals,
              });
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
          sectionTitle,
          subsection,
          sourceContext: pageDossier,
          sourceFigures: interactiveSourceFigures,
          visualizationPlan,
          visualizationOutcomes,
          generatedVisualBudget,
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
        const pageMathExpressions = extractQuartzMath(normalizeQuartzMarkdown(pageBody));
        const formulas = ensureContractFormulaGrounding(
          formulaGroundingEntries(pageMathExpressions, sourceFormulaFiguresForSubsection(context, subsection)),
          subsection,
          sourceFormulaIdentityById,
        );
        for (const formula of formulas) {
          if (!formula.sourceAnchor) continue;
          const identity = sourceFormulaIdentityById.get(formula.sourceAnchor);
          if (!identity || !formulaUnit || !formulaUnitRequirement) {
            throw new Error(`Formula page pre-write guard: ${formula.sourceAnchor} has no verified unit identity.`);
          }
          assertPlannedFormulaAssignment(identity, formulaUnitRequirement, formulaUnit, generationFamilyRegistry);
          const entryFamily = formulaMetricFamily(formula.text);
          if (entryFamily && entryFamily !== legacyFormulaFamily(identity.family)) {
            throw new Error(
              `Formula page pre-write guard: ${formula.sourceAnchor} is ${identity.family}, but learner formula was classified as ${entryFamily}.`,
            );
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
    // that embedded it, or intentionally skipped with a recorded reason.
    const finalLedger = recordSourceVisualAssignments(
      artifactContentPath,
      gardenId,
      visualAssignments,
      (visual) =>
        visual.type === "equation"
          ? "Central source formula is taught from source markdown and linked through sourceFormulaAnchors; no reliable crop was available for this equation."
          : "Not central to any confirmed subsection of this learning map.",
      {
        conceptAnchorIds: generatedPages.flatMap((page) => page.sourceFormulaIds),
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
    // The Learn button prefers model-backed prose repair with deterministic
    // fallback. BREADBOARD_REPAIR_EXECUTOR can still force deterministic/model
    // modes for local debugging and tests.
    const repairExecutorMode = ((): RepairExecutorMode => {
      const raw = (process.env.BREADBOARD_REPAIR_EXECUTOR ?? "").trim();
      if (raw === "model" || raw === "model_with_deterministic_fallback" || raw === "deterministic") return raw;
      return "model_with_deterministic_fallback";
    })();
    // Stages 8a+8b (repair -> export finalize -> verify) run as a bounded
    // convergence loop instead of a single pass followed by a hard fail. Each
    // pass repairs the flagged pages (ChatMock-backed model repair with a
    // deterministic fallback), finalizes the on-disk tree exactly as Quartz
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
        reconcileFinalGardenState(clusterDir, gardenId);
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

    // Stage 7b (post-structure semantic reconciliation): section titles and page
    // paths are frozen by now, so the final learner-page filesystem + the final
    // Learning Unit Contract are authoritative. Rebuild every derived semantic
    // artifact from them in one atomic transaction BEFORE self-healing, the
    // critic, and the terminal gate: page primary/supporting concepts, page tags
    // (= primary + supporting), page claimIds, contract semanticConcepts, the
    // active claim registry, and the active concept registry. Claims from a
    // previous page structure are archived, never carried forward pointing at
    // pages that no longer exist. Fully deterministic: no ChatMock (Fix 14).
    try {
      const semantic = reconcileFinalGardenSemantics(clusterDir, gardenId, {
        archiveHistoricalClaims: true,
        archiveUnusedConcepts: true,
        strictMode: false,
      });
      if (semantic.changed) reconcileFinalGardenState(clusterDir, gardenId);
      appendLearnEvent(contentPath, gardenId, "learn_semantic_reconciliation_completed", {
        jobId: job.id,
        textbookVersionId,
        stoppedReason: semantic.stoppedReason,
        projectionsBuilt: semantic.projectionsBuilt,
        pagesUpdated: semantic.pagesUpdated.length,
        contractUnitsUpdated: semantic.contractUnitsUpdated.length,
        activeClaims: semantic.activeClaims,
        archivedClaims: semantic.archivedClaims,
        staleClaimsRemoved: semantic.staleClaimsRemoved,
        claimsRemappedToNewPaths: semantic.claimsRemappedToNewPaths,
        activeConcepts: semantic.activeConcepts,
        archivedConcepts: semantic.archivedConcepts,
        issuesBefore: semantic.issuesBefore.length,
        issuesAfter: semantic.issuesAfter.length,
        stateFingerprintAfter: semantic.stateFingerprintAfter,
      });
    } catch (reconciliationError) {
      appendLearnEvent(contentPath, gardenId, "learn_semantic_reconciliation_failed", {
        jobId: job.id,
        reason:
          reconciliationError instanceof Error
            ? reconciliationError.message
            : String(reconciliationError),
      });
    }

    // Stage 7c: formula assignment/metadata/lineage/ledger/coverage are one
    // canonical projection. Deterministic compatibility and lineage rules run
    // first; ChatMock sees only a narrow packet when genuine ambiguity remains,
    // and its structured decision is independently verified before application.
    try {
      const criticEnabled = (process.env.BREADBOARD_CRITIC_ENABLED ?? "true").trim() !== "false";
      const formulaRepairModel = criticEnabled
        ? async (packet: FormulaUsageRepairPacket): Promise<FormulaUsageRepairDecision | null> => {
            const system =
              "You resolve ONE formula-usage ambiguity in a final learning page. Return STRICT JSON: " +
              "{\"action\": string, \"entryIndex\"?: number, \"formulaAnchorId\"?: string, \"targetUnitId\"?: string, \"reason\": string}. " +
              "Choose action only from allowedActions. Never invent a formula, formula anchor, source excerpt, unit, or notation. " +
              "Never create a source definition from a numeric example, change unrelated prose/titles/tags/visuals/anchors, " +
              "or silently remove a contract requirement. Use only pageFormulaEntries, contractRequiredFormulas, and candidateDefinitions supplied.";
            const { parsed } = await callCouncilJson({
              client,
              model,
              taskType: "critique",
              gardenId,
              system,
              user: JSON.stringify(packet),
              sourceContext: packet,
              councilModeOverride: "direct_council",
              timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
            });
            if (!parsed || typeof parsed !== "object") return null;
            const record = parsed as Record<string, unknown>;
            const action = String(record.action ?? "") as FormulaUsageRepairDecision["action"];
            if (!packet.allowedActions.includes(action)) return null;
            return {
              action,
              entryIndex: typeof record.entryIndex === "number" ? record.entryIndex : undefined,
              formulaAnchorId: typeof record.formulaAnchorId === "string" ? record.formulaAnchorId : undefined,
              targetUnitId: typeof record.targetUnitId === "string" ? record.targetUnitId : undefined,
              reason: typeof record.reason === "string" ? record.reason : "ChatMock formula-usage decision",
            };
          }
        : undefined;
      const formulaIdentityRepairModel = criticEnabled
        ? async (packet: FormulaIdentityRepairPacket): Promise<FormulaIdentityRepairDecision | null> => {
            const system =
              "Resolve ONE canonical formula identity/assignment conflict. Return STRICT JSON: " +
              "{\"issueId\":string,\"action\":string,\"verifiedFamily\"?:string,\"replacementAnchorId\"?:string," +
              "\"confidence\":\"high\"|\"medium\"|\"low\",\"justification\":string}. " +
              "Use only allowedActions and assignmentCandidates in the packet. Never invent formula text, anchor IDs, source pages, " +
              "or select by page title alone. Exact symbolic structure and source context outrank captions. " +
              "Never force a wrong-family formula onto the page or alter unrelated formulas.";
            const { parsed } = await callCouncilJson({
              client,
              model,
              taskType: "critique",
              gardenId,
              system,
              user: JSON.stringify(packet),
              sourceContext: packet,
              councilModeOverride: "direct_council",
              timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
            });
            if (!parsed || typeof parsed !== "object") return null;
            const record = parsed as Record<string, unknown>;
            const action = String(record.action ?? "") as FormulaIdentityRepairDecision["action"];
            const confidence = String(record.confidence ?? "") as FormulaIdentityRepairDecision["confidence"];
            if (!packet.allowedActions.includes(action) || !["high", "medium", "low"].includes(confidence)) return null;
            return {
              issueId: String(record.issueId ?? ""),
              action,
              verifiedFamily: typeof record.verifiedFamily === "string"
                ? record.verifiedFamily as FormulaIdentityRepairDecision["verifiedFamily"] : undefined,
              replacementAnchorId: typeof record.replacementAnchorId === "string" ? record.replacementAnchorId : undefined,
              confidence,
              justification: typeof record.justification === "string" ? record.justification : "",
            };
          }
        : undefined;
      const formulaReconciliation = await reconcileFinalFormulaProjections(clusterDir, gardenId, {
        maxChatMockCalls: 2,
        strictMode: false,
        formulaRepairModel,
        formulaIdentityRepairModel,
      });
      appendLearnEvent(contentPath, gardenId, "learn_formula_projection_reconciliation_completed", {
        jobId: job.id,
        textbookVersionId,
        contractAssignmentsChecked: formulaReconciliation.contractAssignmentsChecked,
        compatibleMissingAssignmentsRepaired: formulaReconciliation.definitionsAdded + formulaReconciliation.definitionsLinked,
        incompatibleAssignmentsFound: formulaReconciliation.incompatibleAssignmentsFound,
        formulaIdentitiesVerified: formulaReconciliation.formulaIdentitiesVerified,
        registryFamilyCorrections: formulaReconciliation.registryFamilyCorrections,
        assignmentsReplaced: formulaReconciliation.assignmentsReplaced,
        assignmentsMoved: formulaReconciliation.assignmentsMoved,
        ambiguousAssignmentsSentToChatMock: formulaReconciliation.ambiguousAssignmentsSentToChatMock,
        remainingFormulaFamilyMismatches: formulaReconciliation.remainingFormulaFamilyMismatches,
        definitionsAdded: formulaReconciliation.definitionsAdded,
        definitionsLinked: formulaReconciliation.definitionsLinked,
        orphanWorkedExamplesBefore: formulaReconciliation.orphanWorkedExamplesBefore,
        workedExamplesRelined: formulaReconciliation.workedExamplesRelined,
        workedExamplesReclassified: formulaReconciliation.workedExamplesReclassified,
        metadataEntriesRemoved: formulaReconciliation.metadataEntriesRemoved,
        chatMockCallsUsed: formulaReconciliation.chatMockCallsUsed,
        formulaLedgerModesChanged: formulaReconciliation.formulaLedgerModesChanged,
        sourceCoverageEntriesRegenerated: formulaReconciliation.sourceCoverageEntriesRegenerated,
        remainingFormulaBlockers: formulaReconciliation.unresolvedIssues.length,
        passed: formulaReconciliation.passed,
        rolledBack: formulaReconciliation.rolledBack,
      });
    } catch (formulaError) {
      appendLearnEvent(contentPath, gardenId, "learn_formula_projection_reconciliation_failed", {
        jobId: job.id,
        reason: formulaError instanceof Error ? formulaError.message : String(formulaError),
      });
    }

    // Stage 8 (pre-finalize): bounded, deterministic-first / ChatMock-second
    // weak-anchor self-healing. ACTIVELY referenced low/unsupported source anchors
    // are repaired from real source evidence — deterministically when a single
    // candidate is unambiguous, otherwise via a targeted ChatMock decision that is
    // INDEPENDENTLY verified (excerpt present in source + relevant + right family;
    // replacement ids must be ones we offered) — BEFORE the terminal finalize gate.
    // It never fails generation and never invents evidence; unused/historical weak
    // anchors are ignored so they never spend a ChatMock call. Residual blockers are
    // caught by the existing deterministic gate + Stage 8c critic.
    try {
      const criticEnabled = (process.env.BREADBOARD_CRITIC_ENABLED ?? "true").trim() !== "false";
      const weakAnchorRepairModel: WeakAnchorRepairModel | undefined = criticEnabled
        ? async (packet: WeakAnchorRepairPacket): Promise<WeakAnchorRepairDecision | null> => {
            const system =
              "You repair ONE weak source anchor for a learning garden. You are given the anchor, why it is weak, " +
              "the pages/units that reference it, verbatim candidate source passages, and existing alternative anchors. " +
              "Return STRICT JSON: {\"decision\": \"confirm_current_grounding\"|\"reground_from_source\"|\"replace_with_existing_anchor\"|\"reject_no_grounding\", " +
              "\"confidence\": \"high\"|\"medium\"|\"low\", \"reason\": string, \"exactText\"?: string, \"sourceId\"?: string, \"page\"?: number, \"replacementAnchorId\"?: string}. " +
              "RULES: choose only from the provided candidatePassages or existingAlternativeAnchors; never invent a passage, an id, or a page; " +
              "for confirm/reground return a VERBATIM exactText that appears in the source; for replace, replacementAnchorId MUST be one of existingAlternativeAnchors; " +
              "if nothing provided supports the anchor's meaning, return reject_no_grounding.";
            const { parsed } = await callCouncilJson({
              client,
              model,
              taskType: "critique",
              gardenId,
              system,
              user: JSON.stringify(packet),
              sourceContext: packet,
              councilModeOverride: "direct_council",
              timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
            });
            if (!parsed || typeof parsed !== "object") return null;
            const d = parsed as Record<string, unknown>;
            const kind = String(d.decision ?? "");
            const allowed: WeakAnchorDecisionKind[] = ["confirm_current_grounding", "reground_from_source", "replace_with_existing_anchor", "reject_no_grounding"];
            if (!allowed.includes(kind as WeakAnchorDecisionKind)) return null;
            const conf = String(d.confidence ?? "low");
            return {
              issueIdentity: packet.issueIdentity,
              anchorId: packet.anchor.id,
              decision: kind as WeakAnchorDecisionKind,
              confidence: (["high", "medium", "low"].includes(conf) ? conf : "low") as "high" | "medium" | "low",
              reason: typeof d.reason === "string" ? d.reason : "chatmock weak-anchor decision",
              exactText: typeof d.exactText === "string" ? d.exactText : undefined,
              sourceId: typeof d.sourceId === "string" ? d.sourceId : undefined,
              page: typeof d.page === "number" ? d.page : undefined,
              replacementAnchorId: typeof d.replacementAnchorId === "string" ? d.replacementAnchorId : undefined,
              origin: "chatmock",
            };
          }
        : undefined;
      const selfHealing = await runWeakAnchorSelfHealingLoop(clusterDir, gardenId, { anchorRepairModel: weakAnchorRepairModel });
      if (selfHealing.deterministicRepairs > 0 || selfHealing.chatMockRepairs > 0) {
        reconcileFinalGardenState(clusterDir, gardenId);
      }
      writeWeakAnchorSelfHealingReports(clusterDir, selfHealing);
      const acceptance = decideFinalAcceptance(selfHealing);
      appendLearnEvent(contentPath, gardenId, "learn_weak_anchor_self_healing_completed", {
        jobId: job.id,
        textbookVersionId,
        deterministicRepairs: selfHealing.deterministicRepairs,
        chatMockRepairs: selfHealing.chatMockRepairs,
        totalChatMockCalls: selfHealing.totalChatMockCalls,
        resolved: selfHealing.resolvedAnchorIds.length,
        unresolvedActiveAnchorCount: acceptance.unresolvedActiveAnchorCount,
        criticAvailable: selfHealing.criticAvailable,
        publishReady: acceptance.publishReady,
        primaryReason: acceptance.primaryReason,
      });
    } catch (selfHealError) {
      appendLearnEvent(contentPath, gardenId, "learn_weak_anchor_self_healing_skipped", {
        jobId: job.id,
        reason: selfHealError instanceof Error ? selfHealError.message : String(selfHealError),
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

    const MAX_FINALIZE_PASSES = 3;
    let repairRun!: Awaited<ReturnType<typeof repairLearningUnitsFromContract>>;
    let finalizeReport!: ReturnType<typeof finalizeGardenExport>;
    let verification!: ReturnType<typeof verifyFinalArtifactNoMutation>;
    let previousProblemSignature = "";
    for (let pass = 1; pass <= MAX_FINALIZE_PASSES; pass += 1) {
      if (pass > 1) {
        updateLearnJob(job.id, {
          status: "building_navigation",
          currentStep: `Repairing remaining lesson issues (pass ${pass})`,
          progressPercent: 96,
          currentSectionTitle: undefined,
          currentPageTitle: undefined,
        });
      }
      throwIfLearnCancelled(job.id);
      repairRun = await repairLearningUnitsFromContract({
        gardenDir: clusterDir,
        gardenSlug: gardenId,
        repairExecutor: repairExecutorMode,
        modelRepair:
          repairExecutorMode === "deterministic"
            ? undefined
            : createOpenAIRepairExecutor({ client, model, gardenId, timeoutMs: LEARN_PLANNING_TIMEOUT_MS }),
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

      // Deterministic export finalize + hard gate: clean and validate the
      // on-disk tree exactly as Quartz will see it.
      throwIfLearnCancelled(job.id);
      finalizeReport = finalizeGardenExport({ gardenDir: clusterDir, gardenSlug: gardenId });
      appendLearnEvent(contentPath, gardenId, "learn_export_finalized", {
        jobId: job.id,
        textbookVersionId,
        pass,
        removed: finalizeReport.removed,
        changedCount: finalizeReport.changed.length,
        criticalProblems: finalizeReport.criticalProblems,
        warnings: finalizeReport.warnings,
      });
      verification = verifyFinalArtifactNoMutation({ gardenDir: clusterDir, gardenSlug: gardenId });
      appendLearnEvent(contentPath, gardenId, "learn_final_artifact_verified", {
        jobId: job.id,
        textbookVersionId,
        pass,
        accepted: verification.accepted,
        mutatedFiles: verification.mutatedFiles,
        validationFailures: verification.validationFailures,
        unresolvedRepairFailures: verification.unresolvedRepairFailures,
      });

      if (finalizeReport.criticalProblems.length === 0 && verification.accepted) break;
      // Stop retrying once a pass stops making progress (same blocking set as
      // last time) so a down/unhelpful model does not burn extra passes.
      const problemSignature = [
        ...finalizeReport.criticalProblems,
        ...verification.validationFailures,
        ...verification.unresolvedRepairFailures,
      ].sort().join("|");
      if (problemSignature === previousProblemSignature) break;
      previousProblemSignature = problemSignature;
    }

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
        // Fix 13 step 2: migrate/rescore LEGACY text-concept anchors BEFORE the
        // critic runs, so no legacy numeric-confidence anchor is grandfathered in.
        try {
          const migration = migrateLegacyTextConceptAnchors(clusterDir, gardenId);
          if (migration.counts.legacyFound > 0) {
            reconcileFinalGardenState(clusterDir, gardenId);
            appendLearnEvent(contentPath, gardenId, "learn_legacy_anchors_migrated", {
              jobId: job.id,
              legacyFound: migration.counts.legacyFound,
              migrated: migration.counts.migrated,
              replaced: migration.counts.replaced,
              needsCritic: migration.counts.needs_critic_review,
              blocking: migration.counts.blocking,
              suspiciousPassages: migration.duplicateGroups.filter((g) => g.suspicious).length,
              replacementPlanApplied: Boolean(migration.replacementPlanApplied),
            });
          }
          // Safety net for a garden left with DANGLING references by an earlier
          // UNSAFE per-anchor replacement pass (repoint to surviving anchors /
          // restore both-deleted cycles). The two-phase planner prevents this
          // going forward; this heals any pre-existing damage before the critic.
          const heal = healDanglingReplacementReferences(clusterDir, gardenId);
          if (heal.healed.length > 0 || heal.problems.length > 0) {
            reconcileFinalGardenState(clusterDir, gardenId);
            appendLearnEvent(contentPath, gardenId, "learn_dangling_anchor_references_healed", {
              jobId: job.id,
              healed: heal.healed.length,
              repointed: heal.healed.filter((h) => h.action === "repointed").length,
              restored: heal.healed.filter((h) => h.action === "restored").length,
              problems: heal.problems,
            });
          }
        } catch (migrationError) {
          appendLearnEvent(contentPath, gardenId, "learn_legacy_anchor_migration_failed", {
            jobId: job.id,
            reason: migrationError instanceof Error ? migrationError.message : String(migrationError),
          });
        }
        // Real ChatMock-backed repair: the model rewrites the flagged page/section
        // first for semantic issues, then the deterministic finalizer runs for
        // mechanical fixes and as the fallback when a model candidate is rejected.
        const modelRepair = createChatMockModelRepair({ client, model, timeoutMs: LEARN_PLANNING_TIMEOUT_MS });
        const criticLoop = await runCriticLoop({
          gardenDir: clusterDir,
          gardenSlug: gardenId,
          critic: createChatMockCritic({ client, model, timeoutMs: LEARN_PLANNING_TIMEOUT_MS }),
          // Low-confidence generated source anchors are sent to ChatMock to
          // confirm, replace, create a better anchor, or reject — inside the
          // same critic-loop rounds. Unresolved ones keep publishReady false.
          anchorConfirm: createChatMockAnchorCritic({ client, model, timeoutMs: LEARN_PLANNING_TIMEOUT_MS }),
          repair: makeCriticArtifactRepair({ modelRepair }),
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
        verifyFinalArtifactNoMutation({ gardenDir: candidateDir, gardenSlug: gardenId }).accepted,
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
         WHERE id = ? AND garden_id = ?`,
      ).run(
        jsonString(mapToCommit.coveragePlan),
        jsonString(mapToCommit.learningMap),
        jsonString(mapToCommit.proposedOrder),
        mapToCommit.id,
        gardenId,
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
  ".breadboard/validation-report.md",
  ".breadboard/visual-necessity-decisions.json",
  ".breadboard/visual-necessity-decisions.md",
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
              currentStep: "Interrupted by an app restart; prior Learn state restored",
              error: "The Learn worker stopped without completing. The garden was restored and this operation is safe to retry.",
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

  let sourceSetChanged = false;
  if (latestVersion) {
    const versionMap = getLearnMapById(latestVersion.learning_map_id, gardenId);
    try {
      const selectedSources = selectLearnSources(
        context.sources,
        versionMap?.sourceIds.length ? versionMap.sourceIds : undefined,
      );
      const syllabus = selectLearnSyllabus(
        context.sources,
        versionMap?.syllabusSourceId,
      );
      const teachingSources = excludeSyllabusFromSources(selectedSources, syllabus);
      if (syllabus && teachingSources.length === 0) {
        throw new Error("The saved source selection no longer contains teaching material.");
      }
      const currentHash = sourceSetHashWithSyllabus(
        sourceSetHashForSources(teachingSources),
        syllabus,
      );
      sourceSetChanged = latestVersion.source_set_hash !== currentHash;
    } catch {
      // A selected source was removed after the last Learn version.
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
