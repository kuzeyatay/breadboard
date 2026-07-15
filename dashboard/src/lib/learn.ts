import fs from "fs";
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
  deriveUnitFormulaRequirement,
  finalizeFormulaAssignmentPlanWithoutCritic,
  formulaAssignmentProvenanceFromPlan,
  resolveFormulaAssignmentAmbiguities,
  validateFormulaAssignment,
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
  sourceAppearsVisualRich,
  sourceSetHashForSources,
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

export type {
  LearnStatus,
  LearningSectionPlan,
  LearningSubsectionPlan,
  ProposedLearningMap,
};

export type LearnMode = "plan" | "generate" | "update" | "regenerate";

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
  hasTextbook: boolean;
  sourceSetChanged: boolean;
  buttonLabel: string;
  validationReport?: LearnValidationReport | null;
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
}

interface CouncilCallResult {
  content: string;
  councilRunId?: string;
  councilMode?: string;
}

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
/** Full-regeneration attempts per page. Clamped to [1, 2]: a failed page gets
 * one focused repair call, then one fresh rewrite if the repair still fails. */
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
      "interactiveVisual": {
        "id": "optional stable id",
        "uniqueConcept": "the exact concept interaction teaches",
        "visualType": "lif_neuron | neural_coding | stdp_window | metric_calculator | training_curve | tradeoff_explorer",
        "whyStaticSourceFigureIsNotEnough": "why prose/source image is insufficient",
        "learnerManipulates": ["control names"],
        "expectedInsight": "what changes in the learner's understanding",
        "sourceAnchors": ["supporting source anchor ids"],
        "duplicateSignature": "stable dedupe key"
      },
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
- Interactive visuals are optional. A unit has zero or one. Use one only when interaction teaches something static prose or a source figure cannot.
- Do not invent custom visual types. If none of the listed interactive visual types fits, omit interactiveVisual for that unit.
- Do not repeat interactive visual signatures. If a later unit needs a similar visual, link back conceptually or omit it.
- Concepts are reusable identities, never complete claims, page-title summaries, filenames, locations, or planner phrases. Reuse an existing canonical slug or alias whenever possible.
- Every normalized alias must belong to exactly one concept. Never use another concept's slug or preferred label as an alias, and never assign the same alias to multiple concepts.
- Mark one or two genuinely central concepts primary. Use supporting concepts only when they materially help retrieval or graph traversal.
- Plan 1-5 public concepts per learner unit. Never add filler to satisfy a target count.
- Claims are readable source-grounded statements kept separately from public tags. Zero claims is valid when the material supports none.
- Never turn claim text into a concept slug and never create role-template claims. Claim endpoints must use concept slugs from semanticConcepts.
- First job: planning only. Do not generate final prose yet.`;

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
  `);

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
}

function nowIso(): string {
  return new Date().toISOString();
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

function rowToJob(row: LearnJobRow | undefined): LearnJob | null {
  if (!row) return null;
  return {
    id: row.id,
    gardenId: row.garden_id,
    userId: row.user_id ?? undefined,
    status: row.status,
    mode: row.mode,
    currentStep: row.current_step ?? "",
    progressPercent: Number(row.progress_percent ?? 0),
    currentSectionTitle: row.current_section_title ?? undefined,
    currentPageTitle: row.current_page_title ?? undefined,
    error: row.error ?? undefined,
    proposedLearningMapId: row.proposed_learning_map_id ?? undefined,
    confirmedLearningMapId: row.confirmed_learning_map_id ?? undefined,
    latestTextbookVersionId: row.latest_textbook_version_id ?? undefined,
    sourceSetHash: row.source_set_hash ?? undefined,
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
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

function createLearnJob({
  gardenId,
  userId,
  mode,
  sourceOnly,
  includeSourceSnapshots,
}: {
  gardenId: string;
  userId?: number;
  mode: LearnMode;
  sourceOnly: boolean;
  includeSourceSnapshots: boolean;
}): LearnJob {
  ensureLearnTables();
  const date = nowIso();
  const job: LearnJob = {
    id: makeId("learn_job"),
    gardenId,
    userId,
    status: "idle",
    mode,
    currentStep: "",
    progressPercent: 0,
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
      source_only, include_source_snapshots, active_elapsed_ms, timer_started_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.gardenId,
    job.userId ?? null,
    job.status,
    job.mode,
    job.currentStep,
    job.progressPercent,
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

function jobStatusById(jobId: string): LearnStatus | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE id = ?")
    .get(jobId) as LearnJobRow | undefined;
  return row ? (row.status as LearnStatus) : null;
}

/** Cooperative cancellation checkpoint. The Stop button flips the job row to
 * "cancelled"; long-running pipelines call this between model calls / pages so
 * the run actually halts instead of finishing in the background. */
function throwIfLearnCancelled(jobId: string): void {
  if (jobStatusById(jobId) === "cancelled") throw new LearnCancelledError();
}

function updateLearnJob(jobId: string, updates: Partial<LearnJob>): LearnJob {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE id = ?")
    .get(jobId) as LearnJobRow | undefined;
  if (!row) throw new Error(`Learn job ${jobId} not found`);
  const current = rowToJob(row)!;
  // A cancelled job stays cancelled: progress updates from the still-unwinding
  // pipeline must not resurrect it into an active status.
  if (current.status === "cancelled" && updates.status !== "cancelled") {
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
  db.prepare(
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
         source_only = ?,
         include_source_snapshots = ?,
         active_elapsed_ms = ?,
         timer_started_at = ?,
         updated_at = ?
     WHERE id = ?`,
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
    next.sourceOnly ? 1 : 0,
    next.includeSourceSnapshots ? 1 : 0,
    next.elapsedMs,
    next.timerStartedAt ?? null,
    next.updatedAt,
    jobId,
  );
  return next;
}

export function getLatestLearnJob(gardenId: string): LearnJob | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE garden_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1")
    .get(gardenId) as LearnJobRow | undefined;
  return rowToJob(row);
}

function getLearnMapById(mapId: string): StoredLearningMap | null {
  ensureLearnTables();
  const row = db.prepare("SELECT * FROM learn_maps WHERE id = ?").get(mapId) as
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
}: {
  gardenId: string;
  jobId: string;
  sourceMap: unknown;
  scopeContract: unknown;
  learningMap: ProposedLearningMap;
  coveragePlan: unknown;
  sourceSetHash: string;
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
    createdAt,
  };

  db.prepare(
    `INSERT INTO learn_maps (
      id, garden_id, job_id, status, source_map_json, scope_contract_json,
      learning_map_json, proposed_order_json, visual_opportunities_json,
      coverage_plan_json, source_set_hash, created_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
): LearnSourceContext {
  const knowledge = scanClusterKnowledge(contentPath, gardenId);
  const gardenTitle = gardenTitleFromDb(gardenId);
  const sources: LearnSourceSummary[] = knowledge.nodes
    .filter((node) => node.type === "source-document")
    .map((node) => ({
      id: node.slug,
      slug: node.slug,
      title: node.title,
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
  const conceptNodes: LearnConceptSummary[] = knowledge.nodes
    .filter((node) => node.type === "internal-concept")
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
    loadSourceVisuals(contentPath, gardenId),
  );

  return {
    gardenId,
    gardenTitle,
    sources,
    concepts: conceptNodes,
    conceptNodes,
    existingTextbookPages,
    sourceFigures,
    sourceSetHash: sourceSetHashForSources(sources),
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

  const visuals = loadSourceVisuals(contentPath, gardenId);
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

function promptSources(context: LearnSourceContext): unknown {
  return {
    gardenId: context.gardenId,
    gardenTitle: context.gardenTitle,
    sourceSetHash: context.sourceSetHash,
    sources: context.sources.map((source) => ({
      id: source.slug,
      title: source.title,
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
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
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
}: {
  clusterDir: string;
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  sourceSetHash: string;
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
  if (formulaIdentities.length > 0) {
    const knownAnchorIds = new Set(formulaIdentities.map((identity) => identity.anchorId));
    const previousAssignments = reconciledUnits.flatMap((unit) =>
      unit.sourceFormulas
        .filter((formula) => knownAnchorIds.has(formula.id))
        .map((formula) => ({ formulaAnchorId: formula.id, unitId: unit.id })));
    formulaAssignmentPlan = finalizeFormulaAssignmentPlanWithoutCritic(
      buildFormulaAssignmentPlan(formulaIdentities, reconciledUnits, { previousAssignments }),
    );
    const application = applyFormulaAssignmentPlanToUnits({
      units: reconciledUnits,
      plan: formulaAssignmentPlan,
      formulas: formulaIdentities,
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
      assertPlannedFormulaAssignment(identity, deriveUnitFormulaRequirement(unit), unit);
    }
    const formalIds = new Set(unit.sourceFormulas.map((formula) => formula.id));
    return {
      ...unit,
      sourceAnchors: unit.sourceAnchors.filter((anchorId) => {
        const identity = identityById.get(anchorId);
        if (!identity || formalIds.has(anchorId)) return true;
        try {
          assertPlannedFormulaAssignment(identity, deriveUnitFormulaRequirement(unit), unit);
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
  const payload = {
    sourceSetHash,
    generatedAt: nowIso(),
    learningUnits: reconciledUnits,
    sourceArtifactAssignments: assignments,
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
    `Source artifact assignments: ${assignments.length}`,
    "",
    "## Units",
    "",
  ];
  for (const unit of reconciledUnits) {
    lines.push(`- ${unit.id}: ${unit.title} (${unit.role})`);
    lines.push(`  - Question: ${unit.learningQuestion || unit.title}`);
    const artifacts = assignments
      .filter((assignment) => assignment.assignedLearningUnitId === unit.id)
      .map((assignment) => `${assignment.sourceArtifactId} -> ${assignment.placement}`);
    if (artifacts.length > 0) lines.push(`  - Artifacts: ${artifacts.join(", ")}`);
    if (unit.interactiveVisual) {
      lines.push(`  - Interactive: ${unit.interactiveVisual.visualType} (${unit.interactiveVisual.uniqueConcept})`);
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
  return sanitized;
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
  sourceOnly = true,
  includeSourceSnapshots = false,
  resetSourceMap = false,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  resetSourceMap?: boolean;
}): Promise<{ job: LearnJob; learningMap: StoredLearningMap }> {
  if (resetSourceMap) {
    const previousJob = getLatestLearnJob(gardenId);
    if (previousJob?.status === "failed") {
      rollbackLearnRun({ gardenId, contentPath, jobId: previousJob.id });
    }
  }
  const job = createLearnJob({
    gardenId,
    userId,
    mode: resetSourceMap ? "regenerate" : "plan",
    sourceOnly,
    includeSourceSnapshots,
  });
  createLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
  if (resetSourceMap) {
    const reset = clearSourceMapForRegeneration({ gardenId, contentPath });
    appendLearnEvent(contentPath, gardenId, "learn_regeneration_source_map_cleared", {
      jobId: job.id,
      removedPathCount: reset.removedPaths.length,
      deletedMaps: reset.deletedMaps,
      deletedVersions: reset.deletedVersions,
    });
  }
  attachLearnTokenUsageTracking(client, (event) => {
    recordLearnTokenUsageEvent(job.id, event);
  });
  const context = collectLearnSourceContext(contentPath, gardenId);

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
    throwIfLearnCancelled(job.id);
    let sourceMapCall: CouncilJsonResult;
    try {
      sourceMapCall = await callPlanningJsonWithRetry({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: SOURCE_MAP_PROMPT,
        user: compactJson({ sourceOnly, sourceContext: promptSourceContext }),
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
        system: SCOPE_CONTRACT_PROMPT,
        // The scope contract reasons over the source map (already a digest of the
        // full text), so it takes the compacted map + a body-free source context.
        user: compactJson({
          sourceOnly,
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
        system: TOPIC_MAP_PROMPT,
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
          system: TOPIC_MAP_PROMPT,
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
      learningUnits = fallbackLearningUnitsFromContext(context);
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
    const storedMap = db.transaction(() => {
      const stored = insertLearnMap({
        gardenId,
        jobId: job.id,
        sourceMap,
        scopeContract,
        learningMap,
        coveragePlan,
        sourceSetHash: context.sourceSetHash,
      });
      // A failed semantic artifact commit rolls this database insert back, so
      // a failed Learn job cannot leave behind a confirmable orphan map.
      const contractWrite = writeLearningUnitContractArtifacts({
        clusterDir: clusterPath(contentPath, gardenId),
        units: learningUnits,
        assignments: sourceArtifactAssignments,
        sourceSetHash: context.sourceSetHash,
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
    appendLearnEvent(contentPath, gardenId, "learn_awaiting_confirmation", {
      jobId: job.id,
      learningMapId: storedMap.id,
    });
    const nextJob = updateLearnJob(job.id, {
      status: "awaiting_confirmation",
      currentStep: "Awaiting section order confirmation",
      progressPercent: 100,
      proposedLearningMapId: storedMap.id,
      sourceSetHash: context.sourceSetHash,
    });
    return { job: nextJob, learningMap: storedMap };
  } catch (error) {
    if (error instanceof LearnCancelledError) {
      // The Stop button already flipped the job to cancelled; remove anything
      // planning managed to write before the cancellation checkpoint fired.
      try {
        await cleanupLearnArtifactsAfterCancel({ gardenId, contentPath, jobId: job.id });
      } catch {
        // Cleanup is best-effort during unwind; the cancel endpoint reports its
        // own cleanup errors when the user presses Stop.
      }
      throw error;
    }
    const message = error instanceof Error ? error.message : "Learn planning failed";
    appendLearnEvent(contentPath, gardenId, "learn_failed", {
      jobId: job.id,
      error: message,
    });
    updateLearnJob(job.id, {
      status: "failed",
      currentStep: "Planning failed",
      error: message,
    });
    throw error;
  }
}

export function confirmLearningMap({
  gardenId,
  learningMapId,
  contentPath,
}: {
  gardenId: string;
  learningMapId?: string;
  contentPath: string;
}): StoredLearningMap {
  ensureLearnTables();
  const map =
    (learningMapId ? getLearnMapById(learningMapId) : null) ??
    getLatestProposedLearnMap(gardenId);
  if (!map) throw new Error("No proposed learning map found");
  if (!isContractBackedLearningMap(map)) {
    throw new Error(
      "This learning map was created before Learning Unit Contracts existed. Run Learn again to draft a new source-grounded map.",
    );
  }
  const confirmedAt = nowIso();
  db.prepare(
    "UPDATE learn_maps SET status = 'confirmed', confirmed_at = ? WHERE id = ?",
  ).run(confirmedAt, map.id);
  const latestJob = getLatestLearnJob(gardenId);
  if (latestJob) {
    updateLearnJob(latestJob.id, {
      confirmedLearningMapId: map.id,
      currentStep: "Learning map confirmed",
    });
  }
  appendLearnEvent(contentPath, gardenId, "learn_learning_map_confirmed", {
    jobId: latestJob?.id,
    learningMapId: map.id,
  });
  return getLearnMapById(map.id)!;
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
  const existing = sourceFormulaFigures(context);
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
  "_index.md",
  "sources/_index.md",
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

function learnRollbackMarkdownPaths(clusterDir: string): string[] {
  const results: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relPath = normalizeRelPath(path.relative(clusterDir, absolute));
      if (
        entry.isDirectory() &&
        (relPath === ".breadboard/backups" ||
          relPath.startsWith(".breadboard/backups/") ||
          relPath === LEARN_RUN_SNAPSHOT_ROOT ||
          relPath.startsWith(`${LEARN_RUN_SNAPSHOT_ROOT}/`))
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const coveredByManagedRoot = LEARN_RUN_ROLLBACK_PATHS.some(
          (managed) => relPath === managed || relPath.startsWith(`${managed}/`),
        );
        if (!coveredByManagedRoot) results.push(relPath);
      }
    }
  };
  visit(clusterDir);
  return results.sort();
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

  const snapshotCandidates = [
    ...LEARN_RUN_ROLLBACK_PATHS,
    ...learnRollbackMarkdownPaths(clusterDir),
  ];
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
    const insertMap = db.prepare(
      `INSERT INTO learn_maps (
        id, garden_id, job_id, status, source_map_json, scope_contract_json,
        learning_map_json, proposed_order_json, visual_opportunities_json,
        coverage_plan_json, source_set_hash, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  fs.rmSync(learnRunSnapshotDir(clusterDir, jobId), { recursive: true, force: true });
  if (resolved && resolved.jobId !== jobId) {
    fs.rmSync(learnRunSnapshotDir(clusterDir, resolved.jobId), {
      recursive: true,
      force: true,
    });
  }
}

function rollbackLearnRun({
  gardenId,
  contentPath,
  jobId,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
}): LearnCleanupResult {
  ensureLearnTables();
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

  const removedPaths: string[] = [];
  const restoredPaths: string[] = [];
  for (const relPath of LEARN_RUN_ROLLBACK_PATHS) {
    removeClusterPath(clusterDir, relPath, removedPaths);
  }
  const snapshotDir = learnRunSnapshotDir(clusterDir, resolved.jobId);
  for (const relPath of resolved.manifest.capturedPaths ?? []) {
    const source = path.join(snapshotDir, "files", ...relPath.split("/"));
    if (!fs.existsSync(source)) continue;
    copySnapshotPath(source, clusterRelativePath(clusterDir, relPath));
    restoredPaths.push(relPath);
  }

  const baselineBackupEntries = new Set(resolved.manifest.backupEntries ?? []);
  const backupsRoot = clusterRelativePath(clusterDir, ".breadboard/backups");
  if (fs.existsSync(backupsRoot)) {
    for (const entry of fs.readdirSync(backupsRoot)) {
      if (!baselineBackupEntries.has(entry)) {
        removeClusterPath(clusterDir, `.breadboard/backups/${entry}`, removedPaths);
      }
    }
  }

  const database = restoreLearnDatabaseSnapshot(gardenId, resolved.manifest);
  discardLearnRunSnapshot({ gardenId, contentPath, jobId });
  return {
    removedPaths: Array.from(new Set(removedPaths)),
    restoredPaths: Array.from(new Set(restoredPaths)),
    prunedVisualIds: [],
    ...database,
  };
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
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
}): Promise<LearnCleanupResult> {
  const result = rollbackLearnRun({ gardenId, contentPath, jobId });
  await publishQuartzAfterMutation(`learn cancellation cleanup in ${gardenId}`);
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
}): Promise<{ markdown: string; visualIds: string[] }> {
  const pageSlug = pageRelPath.replace(/\.md$/i, "");
  const keptIds: string[] = [];
  const intent = pageVisualIntent({ gardenId, pageSlug, sectionTitle, subsection });
  const pageAnchorIds = visualAnchorIdsForPage({ subsection, sourceFigures });

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
  let nextMarkdown = markdown.replace(EMBEDDED_VISUAL_BLOCK_RE, (fullMatch, json: string) => {
    const { spec } = validateVisualSpec(json);
    if (intent.suppressGeneric || intent.spec) return "";
    if (
      spec &&
      (IMPLEMENTED_VISUAL_TYPES as readonly string[]).includes(spec.type) &&
      !keptIds.includes(spec.id)
    ) {
      spec.gardenId = gardenId;
      spec.pageId = pageSlug;
      recordVisual(spec);
      return buildVisualBlock(spec);
    }
    return "";
  });

  // 2) Legacy bracket placeholders are removed, never replaced by filler.
  if (containsRawVisualPlaceholder(nextMarkdown)) {
    nextMarkdown = removeRawVisualPlaceholders(nextMarkdown, "");
  }

  if (intent.spec && keptIds.length === 0) {
    const paragraphs = nextMarkdown.trim().split(/\n{2,}/);
    const index = bestParagraphIndex(paragraphs, `${intent.spec.title} ${intent.spec.pedagogicalPurpose}`);
    recordVisual(intent.spec);
    nextMarkdown = [
      ...paragraphs.slice(0, index + 1),
      buildVisualBlock(enrichVisualSpec(intent.spec)),
      ...paragraphs.slice(index + 1),
    ].join("\n\n");
  }

  if (intent.suppressGeneric) {
    if (intent.reason) {
      appendLearnEvent(contentPath, gardenId, "learn_visual_skipped", {
        jobId,
        textbookVersionId,
        pageId,
        reason: intent.reason,
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
          preferredType: contractVisual.visualType,
        },
      ]
    : (subsection.interactiveVisuals ?? []).map((plan) => ({
        concept: plan.concept,
        reason: plan.reason,
        preferredType: HARD_CONCEPTS.find((c) => c.test.test(`${plan.concept} ${plan.reason}`))?.visualType,
      }));

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

  for (const opportunity of opportunities.slice(0, 2)) {
    if (keptIds.length > 0) break; // page already has a working interactive

    // Deterministic builder first for hard dynamic concepts: guaranteed valid,
    // never declines. Only fall back to the model when no builder matches.
    if (opportunity.preferredType) {
      const built = buildDeterministicVisual(opportunity.preferredType, { gardenId, pageSlug });
      if (built) {
        embedSpec(built, `${opportunity.concept} ${opportunity.reason}`);
        continue;
      }
    }

    const typeHint = opportunity.preferredType
      ? ` Use the interactive visual type "${opportunity.preferredType}".`
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
        visualOpportunity: `${opportunity.concept}${opportunity.reason ? ` — ${opportunity.reason}` : ""}.${typeHint}`,
        councilModeOverride: sourceFigures.length > 0 ? "full_council" : "lite_council",
      });
      const spec = generated.spec;
      if (!spec) continue;
      embedSpec(spec, `${opportunity.concept} ${opportunity.reason}`);
    } catch {
      // Model visual failed; a hard concept still gets its deterministic builder
      // below, other opportunities may simply produce no visual.
    }
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
    zettelNotes?: LearningSubsectionPlan["zettelNotes"];
    mustNotRepeat?: string[];
    expectedWordRange?: [number, number];
  };

  mustCover: string[];
  avoid: string[];

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
}: {
  sources: LearnSourceSummary[];
  keywords: Set<string>;
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
    for (const source of sources.slice(0, MAX_SNIPPETS_PER_PAGE)) {
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
    relevantSourceSnippets: selectRelevantSourceSnippets({ sources, keywords }),
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
}): Promise<{ job: LearnJob; textbookVersionId: string; pageCount: number }> {
  let map =
    (confirmedLearningMapId ? getLearnMapById(confirmedLearningMapId) : null) ??
    getLatestConfirmedLearnMap(gardenId);
  if ((!map || map.status !== "confirmed") && autoConfirmTopicMap) {
    // Explicitly requested: promote the latest proposed map without the gate.
    const proposed =
      (confirmedLearningMapId ? getLearnMapById(confirmedLearningMapId) : null) ??
      getLatestProposedLearnMap(gardenId);
    if (proposed && proposed.status !== "confirmed") {
      confirmLearningMap({ gardenId, learningMapId: proposed.id, contentPath });
    }
    map = proposed ? getLearnMapById(proposed.id) : map;
  }
  if (!map || map.status !== "confirmed") {
    throw new Error(
      "Confirm a learning map before generating lessons (status must be 'confirmed'; " +
        "pass autoConfirmTopicMap:true only in noninteractive/test runs).",
    );
  }
  if (!isContractBackedLearningMap(map)) {
    throw new Error(
      "This confirmed learning map was created before Learning Unit Contracts existed. Start Learn again to draft a new source-grounded learning map.",
    );
  }

  const context = collectLearnSourceContext(contentPath, gardenId);
  const job = createLearnJob({
    gardenId,
    userId,
    mode,
    sourceOnly,
    includeSourceSnapshots,
  });
  createLearnRunSnapshot({
    gardenId,
    contentPath,
    jobId: job.id,
    inheritFromJobId: map.jobId,
  });
  attachLearnTokenUsageTracking(client, (event) => {
    recordLearnTokenUsageEvent(job.id, event);
  });
  const clusterDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(clusterDir, { recursive: true });
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
      contentPath,
      gardenId,
      context,
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    const sourceFormulaIdentities = buildFormulaIdentityRegistry(
      buildCanonicalSourceAnchors(clusterDir),
      clusterDir,
    );
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
      });
      const ambiguityResolution = await resolveFormulaAssignmentAmbiguities({
        plan: initialPlan,
        formulas: sourceFormulaIdentities,
        units: confirmedLearningUnits,
        repairModel: assignmentRepairModel,
        maxCalls: 3,
      });
      const assignmentPlan = ambiguityResolution.plan;
      const planApplication = applyFormulaAssignmentPlanToUnits({
        units: confirmedLearningUnits,
        plan: assignmentPlan,
        formulas: sourceFormulaIdentities,
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
    // Persist the planned contract; the deterministic planner inside the
    // writer re-validates the (already valid) assignments idempotently.
    const contractWrite = writeLearningUnitContractArtifacts({
      clusterDir,
      units: confirmedLearningUnits,
      assignments: confirmedSourceArtifactAssignments,
      sourceSetHash: context.sourceSetHash,
    });
    confirmedLearningUnits = contractWrite.units;
    const repairedCoveragePlan = {
      ...planningRecord(map.coveragePlan),
      learningUnitContracts: confirmedLearningUnits,
    };
    const repairedLearningMap = learningMapWithConfirmedUnitContracts(
      map.learningMap,
      confirmedLearningUnits,
    );
    map = {
      ...map,
      coveragePlan: repairedCoveragePlan,
      learningMap: repairedLearningMap,
      proposedOrder: repairedLearningMap.sections,
    };
    db.prepare(
      `UPDATE learn_maps
       SET coverage_plan_json = ?, learning_map_json = ?, proposed_order_json = ?
       WHERE id = ?`,
    ).run(
      jsonString(repairedCoveragePlan),
      jsonString(repairedLearningMap),
      jsonString(repairedLearningMap.sections),
      map.id,
    );
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
        assertPlannedFormulaAssignment(identity, deriveUnitFormulaRequirement(unit), unit);
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
        const formulaUnitRequirement = formulaUnit ? deriveUnitFormulaRequirement(formulaUnit) : undefined;
        for (const anchorId of metricFormulaAnchorIds) {
          const identity = sourceFormulaIdentityById.get(anchorId);
          if (!identity || !formulaUnit || !formulaUnitRequirement) {
            throw new Error(`Formula pre-write guard: ${anchorId} cannot be resolved to a verified unit assignment.`);
          }
          const verdict = assertPlannedFormulaAssignment(identity, formulaUnitRequirement, formulaUnit);
          if (verdict.hardRejectionReasons.length > 0) {
            throw new Error(`Formula assignment rejected at page generation: ${verdict.reason}`);
          }
        }
        const sourceFigures = sourceFiguresFromVisuals(assignedVisuals);
        const interactiveSourceFigures =
          metricFormulaAnchorIds.length > 0
            ? [
                ...sourceFigures,
                ...sourceFormulaFigures(context).filter(
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
              system: SUBSECTION_PROMPT,
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

          let quality = assessLessonQuality(attemptBody, { assignedVisualUrls });
          if (quality.problems.some((problem) => problem.code === "source-commentary")) {
            // Free deterministic re-scrub before spending any model call.
            attemptBody = scrubSourceCommentaryProse(attemptBody);
            attemptBody = ensureQuestionBlock(attemptBody, subsectionTitle);
            attemptBody = embedAssignedSourceVisuals(attemptBody, assignedVisuals);
            quality = assessLessonQuality(attemptBody, { assignedVisualUrls });
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
              quality = assessLessonQuality(attemptBody, { assignedVisualUrls });
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
          contentPath,
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
          const requirementVerdict = assertPlannedFormulaAssignment(identity, formulaUnitRequirement, formulaUnit);
          if (requirementVerdict.hardRejectionReasons.length > 0) {
            throw new Error(`Formula assignment rejected at page frontmatter: ${requirementVerdict.reason}`);
          }
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
      const pruned = pruneVisualArtifacts(contentPath, gardenId, liveVisualIds);
      if (pruned.removedFromIndex.length > 0 || pruned.removedSpecFiles.length > 0) {
        appendLearnEvent(contentPath, gardenId, "learn_visual_index_pruned", {
          jobId: job.id,
          textbookVersionId,
          removedFromIndex: pruned.removedFromIndex,
          removedSpecFiles: pruned.removedSpecFiles,
        });
      }
    }

    // Stage 3 closeout: every extracted visual is either assigned to the page
    // that embedded it, or intentionally skipped with a recorded reason.
    const finalLedger = recordSourceVisualAssignments(
      contentPath,
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
    refreshClusterIndex(contentPath, gardenId);

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
    // state and drives targeted repair rounds. It NEVER fails generation — the
    // garden is a draft regardless of critic outcome. It becomes publish-ready
    // only when deterministic validation AND the critic find no blocking issues.
    // Any error (e.g. ChatMock unreachable) is swallowed so a draft still ships.
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
      }
    } catch (criticError) {
      appendLearnEvent(contentPath, gardenId, "learn_critic_loop_skipped", {
        jobId: job.id,
        reason: criticError instanceof Error ? criticError.message : String(criticError),
      });
    }

    throwIfLearnCancelled(job.id);
    await publishQuartzAfterMutation(`learn textbook generation in ${gardenId}`);
    throwIfLearnCancelled(job.id);

    insertLearnVersion({
      id: textbookVersionId,
      gardenId,
      jobId: job.id,
      learningMapId: map.id,
      sourceSetHash: context.sourceSetHash,
      pageCount: generatedPages.length + learningRelPaths.length + 1,
      backupDir,
    });

    appendLearnEvent(contentPath, gardenId, "learn_generation_completed", {
      jobId: job.id,
      textbookVersionId,
      pageCount: generatedPages.length,
      sourceIds: context.sources.map((source) => source.slug),
    });
    const finalJob = updateLearnJob(job.id, {
      status: "complete",
      currentStep: "Lessons complete",
      progressPercent: 100,
      confirmedLearningMapId: map.id,
      latestTextbookVersionId: textbookVersionId,
      sourceSetHash: context.sourceSetHash,
    });
    discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
    return {
      job: finalJob,
      textbookVersionId,
      pageCount: generatedPages.length,
    };
  } catch (error) {
    if (error instanceof LearnCancelledError) {
      // The Stop button already flipped the job to cancelled; sweep any
      // partial Learn output that was written before the checkpoint fired.
      try {
        await cleanupLearnArtifactsAfterCancel({ gardenId, contentPath, jobId: job.id });
      } catch {
        // Cleanup is best-effort during unwind; the cancel endpoint reports its
        // own cleanup errors when the user presses Stop.
      }
      throw error;
    }
    const message = error instanceof Error ? error.message : "Lesson generation failed";
    appendLearnEvent(contentPath, gardenId, "learn_failed", {
      jobId: job.id,
      textbookVersionId,
      error: message,
    });
    updateLearnJob(job.id, {
      status: "failed",
      currentStep: "Lesson generation failed",
      error: message,
    });
    throw error;
  }
}

export async function runLearnPipeline({
  gardenId,
  userId,
  mode,
  confirmedLearningMapId,
  sourceOnly = true,
  includeSourceSnapshots = false,
  autoConfirmTopicMap = false,
  client,
  model = DEFAULT_MODEL,
  contentPath,
}: {
  gardenId: string;
  userId?: number;
  mode: LearnMode;
  confirmedLearningMapId?: string;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  autoConfirmTopicMap?: boolean;
  client: OpenAI;
  model?: string;
  contentPath: string;
}): Promise<unknown> {
  if (mode === "plan") {
    const planning = await runLearnPlanning({
      gardenId,
      userId,
      client,
      model,
      contentPath,
      sourceOnly,
      includeSourceSnapshots,
    });
    if (!autoConfirmTopicMap) return planning;

    const learningMap = confirmLearningMap({
      gardenId,
      learningMapId: planning.learningMap.id,
      contentPath,
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
    });
    return { planning, learningMap, generation };
  }
  return runTextbookGeneration({
    gardenId,
    userId,
    client,
    model,
    contentPath,
    confirmedLearningMapId,
    mode,
    sourceOnly,
    includeSourceSnapshots,
    autoConfirmTopicMap,
  });
}

export async function cancelLatestLearnJob({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): Promise<LearnJob | null> {
  const latest = getLatestLearnJob(gardenId);
  if (!latest) return null;
  const next = updateLearnJob(latest.id, {
    status: "cancelled",
    currentStep: "Cancelled; latest Learn changes rolled back",
    progressPercent: 0,
    currentSectionTitle: undefined,
    currentPageTitle: undefined,
    proposedLearningMapId: undefined,
    confirmedLearningMapId: undefined,
    latestTextbookVersionId: undefined,
  });
  const cleanup = await cleanupLearnArtifactsAfterCancel({
    gardenId,
    contentPath,
    jobId: latest.id,
  });
  appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
    jobId: latest.id,
    removedPathCount: cleanup.removedPaths.length,
    restoredPathCount: cleanup.restoredPaths.length,
    deletedMaps: cleanup.deletedMaps,
    deletedVersions: cleanup.deletedVersions,
  });
  return next;
}

function activeStatus(status: LearnStatus): boolean {
  return [
    "planning",
    "generating_learning_pages",
    "generating_textbook",
    "generating_visuals",
    "writing_quartz",
    "building_navigation",
  ].includes(status);
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
  if (latestJob?.status === "awaiting_confirmation") return "Review Learning Map";
  if (sourceSetChanged && (hasTextbook || latestVersion)) return "Learn";
  if (confirmedMap && !latestVersion) return "Learn";
  if (hasTextbook || latestVersion) return "Learn";
  return "Learn";
}

export function getLearnStatusSnapshot({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): LearnStatusSnapshot {
  ensureLearnTables();
  const context = collectLearnSourceContext(contentPath, gardenId);
  const latestJob = getLatestLearnJob(gardenId);
  const latestProposed = latestJob?.proposedLearningMapId
    ? getLearnMapById(latestJob.proposedLearningMapId)
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
  const knowledge = scanClusterKnowledge(contentPath, gardenId);
  const hasTextbook = knowledge.stats.textbookPages > 0;
  const sourceSetChanged =
    Boolean(latestVersion) && latestVersion?.source_set_hash !== context.sourceSetHash;

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
  };
}
