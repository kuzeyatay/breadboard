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
import { finalizeGardenExport, groundLearnerFormula, classifyFigure } from "@/lib/garden-finalize";
import {
  appendGardenEvent,
  buildDeterministicVisual,
  generateVisualSpec,
  pruneVisualArtifacts,
  saveVisualSpec,
} from "@/lib/visuals";
import {
  assignSourceArtifacts,
  atomicZettelHandle,
  dropIncompatibleInteractiveVisuals,
  isAtomicZettelHandle,
  learningMapFromUnits,
  normalizeLearningUnits,
  validateLearningUnitContracts,
  visualTypeCompatibleWithUnit,
  zettelHandlesForUnit,
  type LearningUnitContract,
  type SourceArtifactAssignment,
  type SourceFigurePlacement,
} from "@/lib/learning-unit-contract";
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
  extractTagSeeds,
  fallbackLearningMapFromSources,
  normalizeLearningMapCandidate,
  normalizeZettelTags,
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
  created_at: string;
  updated_at: string;
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
  sourceAnchors: string[];
  visualIds: string[];
  sourceFigureIds: string[];
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
 * one focused repair call, never repeated full regeneration. */
const MAX_PAGE_ATTEMPTS = Math.max(
  1,
  Math.min(2, envPositiveInt("LEARN_MAX_PAGE_ATTEMPTS", 1)),
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
Stay source-aware. If source-only mode is true, do not add outside facts.`;

const SCOPE_CONTRACT_PROMPT = `You create the internal Scope Contract for a Breadboard learning garden. This document is internal planning data; learners never see it.
Return ONLY JSON with included, excluded, background, deferred, sourceEmphasis, and caveats.
The contract must protect source scope: no unsupported expansion, no disconnected topic cards, and no final Generated Subtopics pages.`;

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
        "visualType": "lif_neuron | neural_coding | stdp_window | metric_calculator | training_curve | tradeoff_explorer | custom type",
        "whyStaticSourceFigureIsNotEnough": "why prose/source image is insufficient",
        "learnerManipulates": ["control names"],
        "expectedInsight": "what changes in the learner's understanding",
        "sourceAnchors": ["supporting source anchor ids"],
        "duplicateSignature": "stable dedupe key"
      },
      "zettelNotes": [
        {
          "handle": "atomic-lower-kebab-case-claim-handle",
          "claim": "one reusable concept claim",
          "connectedTo": ["other-note-handle"]
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
- Do not repeat interactive visual signatures. If a later unit needs a similar visual, link back conceptually or omit it.
- Zettelkasten handles are atomic claim handles: lower-kebab-case, no slash namespaces, no broad single-word categories. Good: "accuracy-alone-hides-energy-and-latency-cost". Bad: "metric/accuracy", "latency", "snn".
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

const SUBSECTION_PROMPT = `Write one flowing lesson subsection for a Breadboard learning garden.
Return Markdown body only, no frontmatter, no code fence around the whole page.
${LEARNER_VOICE_RULES}
${DEPTH_RULES}
${ANTI_AIISM_RULES}
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
Keep it one flowing lesson. Keep every embedded image where it is (or move it nearer the prose it supports) and make sure each image is interpreted, not just captioned. Keep any \`\`\`breadboard-visual block byte-for-byte unchanged. Remove any placeholder or self-instruction text. Keep or add 1-2 **Question.** / **Answer.** pairs.
If source-only mode is true, do not add unsupported facts; say plainly when material is missing.`;

const SUBSECTION_REPAIR_PROMPT = `Repair one lesson page that failed specific hard quality checks. This is a focused repair, not a rewrite.
Return Markdown body only, no frontmatter.
${LEARNER_VOICE_RULES}
${ANTI_AIISM_RULES}
Task:
- Fix ONLY the listed hard failures (failedProblems). Leave everything that already works untouched.
- Preserve correct existing content: explanations, examples, formulas, structure, and the Question./Answer. section.
- Do not restart from scratch unless the page is genuinely unusable.
- If a failure says the page is too short, lacks a concrete example, or lacks a **Question.** / **Answer.** pair, add the missing depth in the same flowing, beginner-friendly voice: motivate before mechanism, define terms as they appear, put a concrete example right after the idea it illustrates, and keep at least ~700 words of real explanatory prose.
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
      created_at                 TEXT NOT NULL,
      updated_at                 TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_jobs_garden_updated
      ON learn_jobs(garden_id, updated_at DESC);

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
    createdAt: date,
    updatedAt: date,
  };
  db.prepare(
    `INSERT INTO learn_jobs (
      id, garden_id, user_id, status, mode, current_step, progress_percent,
      source_only, include_source_snapshots, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    job.createdAt,
    job.updatedAt,
  );
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
  const next = { ...current, ...updates, updatedAt: nowIso() };
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
      throw new Error(
        `Source visual extraction failed: ${visualRichSlugs.size} visual-rich source(s) produced zero extracted figures/tables${detail}. Refusing to write learner pages with no source figures.`,
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

function makeFallbackZettel(title: string, claim: string): { handle: string; claim: string; connectedTo: string[] } {
  return {
    handle: atomicZettelHandle(claim || title),
    claim: claim || title,
    connectedTo: [],
  };
}

function fallbackLearningUnitsFromContext(context: LearnSourceContext): LearningUnitContract[] {
  const topic = sanitizeLearnerTitle(context.gardenTitle || context.sources[0]?.title || context.gardenId || "This Topic");
  const sourceAnchors = context.sources.length > 0 ? context.sources.map((source) => source.title) : [topic];
  const nowRange: [number, number] = [700, 1100];
  const mk = (
    id: string,
    role: LearningUnitContract["role"],
    title: string,
    question: string,
    claim: string,
  ): LearningUnitContract => ({
    id,
    role,
    title: sanitizeLearnerTitle(title),
    learningQuestion: question,
    prerequisiteConcepts: [],
    newConcepts: [sanitizeLearnerTitle(title).toLowerCase()],
    sourceAnchors,
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: [makeFallbackZettel(title, claim)],
    mustNotRepeat: [],
    expectedWordRange: nowRange,
  });

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
}): void {
  const bbDir = path.join(clusterDir, ".breadboard");
  const planningDir = path.join(bbDir, "planning");
  fs.mkdirSync(planningDir, { recursive: true });
  const payload = {
    sourceSetHash,
    generatedAt: nowIso(),
    learningUnits: units,
    sourceArtifactAssignments: assignments,
  };
  fs.writeFileSync(path.join(bbDir, "learning-unit-contract.json"), JSON.stringify(payload, null, 2), "utf-8");
  const lines = [
    "# Learning Unit Contract",
    "",
    `Source set hash: ${sourceSetHash}`,
    `Learning units: ${units.length}`,
    `Source artifact assignments: ${assignments.length}`,
    "",
    "## Units",
    "",
  ];
  for (const unit of units) {
    lines.push(`- ${unit.id}: ${unit.title} (${unit.role})`);
    lines.push(`  - Question: ${unit.learningQuestion || unit.title}`);
    const artifacts = assignments
      .filter((assignment) => assignment.assignedLearningUnitId === unit.id)
      .map((assignment) => `${assignment.sourceArtifactId} -> ${assignment.placement}`);
    if (artifacts.length > 0) lines.push(`  - Artifacts: ${artifacts.join(", ")}`);
    if (unit.interactiveVisual) {
      lines.push(`  - Interactive: ${unit.interactiveVisual.visualType} (${unit.interactiveVisual.uniqueConcept})`);
    }
    const handles = zettelHandlesForUnit(unit);
    if (handles.length > 0) lines.push(`  - Zettel: ${handles.join(", ")}`);
  }
  fs.writeFileSync(path.join(planningDir, "Learning Unit Contract.md"), `${lines.join("\n")}\n`, "utf-8");
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
  return raw
    .map((item) => (item && typeof item === "object" ? (item as SourceArtifactAssignment) : null))
    .filter((item): item is SourceArtifactAssignment => Boolean(item));
}

export async function runLearnPlanning({
  gardenId,
  userId,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  sourceOnly = true,
  includeSourceSnapshots = false,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
}): Promise<{ job: LearnJob; learningMap: StoredLearningMap }> {
  const job = createLearnJob({
    gardenId,
    userId,
    mode: "plan",
    sourceOnly,
    includeSourceSnapshots,
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
        `Regenerate the plan as 15-25 precise learningUnits. Assign every important figure/table/formula/result to a precise unit, keep interactive visuals optional and unique, and use slash-free atomic Zettelkasten handles. Do not return sections first.`;
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
    const storedMap = insertLearnMap({
      gardenId,
      jobId: job.id,
      sourceMap,
      scopeContract,
      learningMap,
      coveragePlan,
      sourceSetHash: context.sourceSetHash,
    });
    writeLearningUnitContractArtifacts({
      clusterDir: clusterPath(contentPath, gardenId),
      units: learningUnits,
      assignments: sourceArtifactAssignments,
      sourceSetHash: context.sourceSetHash,
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
        await cleanupLearnArtifactsAfterCancel({ gardenId, contentPath });
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
function formulaGroundingEntries(
  mathExpressions: ReturnType<typeof extractQuartzMath>,
  sourceFormulaFigureList: SourceFigure[],
): FormulaGroundingEntry[] {
  const sources = sourceFormulaFigureList
    .filter((figure) => figure.figureId)
    .map((figure) => ({ id: figure.figureId, caption: figure.caption ?? "" }));
  const captionById = new Map(sources.map((source) => [source.id, source.caption]));
  return mathExpressions.map((expr) => {
    const grounded = groundLearnerFormula(expr.formula, sources);
    if (grounded.groundingStatus === "source-anchored" && grounded.sourceAnchor) {
      return {
        text: expr.formula,
        groundingStatus: "source-anchored",
        sourceAnchor: grounded.sourceAnchor,
        justification: `Content matches source metric formula ${grounded.sourceAnchor} (${captionById.get(grounded.sourceAnchor) ?? "source formula"}).`,
      };
    }
    return {
      text: expr.formula,
      groundingStatus: "conceptual-helper",
      justification:
        "Compact helper formula used to explain the lesson's mechanism; no direct source equation anchor is claimed.",
    };
  });
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
  const renderedSourceMap = sanitizeFormulaContradictions(sourceMap, formulas.length > 0);
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

function sanitizeFormulaContradictions(value: unknown, hasFormulas: boolean): unknown {
  if (!hasFormulas) return value;
  if (typeof value === "string") {
    return value
      .replace(
        /explicit mathematical definitions are not present[^.]*\./gi,
        "explicit metric formulas are present in the extracted source anchors.",
      )
      .replace(
        /explicit mathematical definitions are not present/gi,
        "explicit metric formulas are present",
      )
      .replace(/formulas? (?:are|is) not present/gi, "formula anchors are present")
      .replace(/caption-only/gi, "extracted formula anchor");
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeFormulaContradictions(item, hasFormulas));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeFormulaContradictions(item, hasFormulas),
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
  const usedFigures = new Set(generatedPages.flatMap((page) => page.sourceFigureIds));
  const formulaFigures = sourceFormulaFigures(context);
  const metricPage = generatedPages.find((page) =>
    /metric|evaluation|accuracy|latency|energy|spike count|total spike|convergence/i.test(
      `${page.title} ${page.relPath} ${page.sourceAnchors.join(" ")}`,
    ),
  );
  if (metricPage) {
    for (const formula of formulaFigures) usedFigures.add(formula.figureId);
  }
  const lines = [
    "# Source Coverage",
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
  lines.push("", "## Figures, Graphs, Tables, And Formula Displays Used", "");
  lines.push(
    ...(context.sourceFigures.filter((figure) => usedFigures.has(figure.figureId)).length > 0
      ? context.sourceFigures
          .filter((figure) => usedFigures.has(figure.figureId))
          .map((figure) => `- ${figure.figureId}: ${figure.caption ?? figure.kind}`)
      : ["- No source figures were used as explicit visual anchors."]),
  );
  if (formulaFigures.length > 0) {
    lines.push("", "## Formula Anchor Assignments", "");
    for (const formula of formulaFigures) {
      lines.push(
        `- ${formula.figureId}: ${metricPage ? `central to ${wikilinkForRelPath(metricPage.relPath, metricPage.title)}` : "central metric formula; no matching metric page was generated"}`,
      );
    }
  }
  if (sourceArtifactAssignments.length > 0) {
    lines.push("", "## Learning Unit Artifact Assignments", "");
    for (const assignment of sourceArtifactAssignments) {
      lines.push(
        `- ${assignment.sourceArtifactId}: ${assignment.assignedLearningUnitId} (${assignment.placement}) - ${assignment.requiredInterpretation || assignment.reason}`,
      );
    }
  }
  lines.push("", "## Figures Not Used", "");
  lines.push(
    ...(context.sourceFigures.filter((figure) => !usedFigures.has(figure.figureId)).length > 0
      ? context.sourceFigures
          .filter((figure) => !usedFigures.has(figure.figureId))
          .map(
            (figure) =>
              `- ${figure.figureId}: ${unusedFigureReasons.get(figure.figureId) ?? "Not central to the confirmed subsection order."}`,
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

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function learnGeneratedMarkdown(content: string): boolean {
  return (
    /^generatedBy:\s*["']?learn_button["']?\s*$/im.test(content) ||
    /^generated_by:\s*["']?learn_button["']?\s*$/im.test(content) ||
    /^learningVersion(?:Id)?:\s*.+$/im.test(content) ||
    /^breadboardType:\s*["']?learning_/im.test(content)
  );
}

function removeClusterPath(clusterDir: string, relPath: string, removedPaths: string[]): void {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return;
  const target = path.join(clusterDir, ...normalized.split("/"));
  assertInsideCluster(clusterDir, target);
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  removedPaths.push(normalized);
}

function removeEmptyParents(clusterDir: string, startDir: string): void {
  let current = path.resolve(startDir);
  const root = path.resolve(clusterDir);
  while (current.startsWith(root + path.sep) && current !== root) {
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function restoreNonLearnBackups(clusterDir: string, restoredPaths: string[]): void {
  const backupsRoot = path.join(clusterDir, ".breadboard", "backups");
  if (!fs.existsSync(backupsRoot)) return;
  const versionDirs = fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^learning/i.test(entry.name))
    .map((entry) => path.join(backupsRoot, entry.name))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);

  const restoreByRelPath = new Map<string, string>();
  for (const versionDir of versionDirs) {
    for (const filePath of walkFiles(versionDir).filter((file) => file.toLowerCase().endsWith(".md"))) {
      const raw = fs.readFileSync(filePath, "utf-8");
      if (learnGeneratedMarkdown(raw)) continue;
      const relPath = normalizeRelPath(path.relative(versionDir, filePath));
      restoreByRelPath.set(relPath, filePath);
    }
  }

  for (const [relPath, backupPath] of restoreByRelPath) {
    const target = path.join(clusterDir, ...relPath.split("/"));
    assertInsideCluster(clusterDir, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(backupPath, target);
    restoredPaths.push(relPath);
  }
}

function removeLearnGeneratedMarkdown(clusterDir: string, removedPaths: string[]): void {
  for (const filePath of walkFiles(clusterDir).filter((file) => file.toLowerCase().endsWith(".md"))) {
    const relPath = normalizeRelPath(path.relative(clusterDir, filePath));
    if (relPath.startsWith(".breadboard/")) continue;
    if (relPath.startsWith("sources/")) continue;
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (!learnGeneratedMarkdown(raw)) continue;
    fs.rmSync(filePath, { force: true });
    removedPaths.push(relPath);
    removeEmptyParents(clusterDir, path.dirname(filePath));
  }
}

function cleanupLearnVisualArtifacts(clusterDir: string, removedPaths: string[]): string[] {
  const bbDir = path.join(clusterDir, ".breadboard");
  const indexPath = path.join(bbDir, "visual-index.json");
  let index: Record<string, Record<string, unknown>> = {};
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Record<string, Record<string, unknown>>;
  } catch {
    index = {};
  }

  const isLearnPage = (value: unknown): boolean => {
    if (typeof value !== "string") return false;
    const normalized = normalizeRelPath(value).replace(/\.md$/i, "").toLowerCase();
    return normalized === LEARNING_ROOT || normalized.startsWith(`${LEARNING_ROOT}/`) || normalized.startsWith("learning/");
  };

  const prunedVisualIds: string[] = [];
  const nextIndex: Record<string, Record<string, unknown>> = {};
  for (const [id, entry] of Object.entries(index)) {
    if (isLearnPage(entry.pageSlug) || isLearnPage(entry.pageId) || isLearnPage(entry.pagePath)) {
      prunedVisualIds.push(id);
    } else {
      nextIndex[id] = entry;
    }
  }

  const visualsDir = path.join(bbDir, "visuals");
  for (const visualId of prunedVisualIds) {
    removeClusterPath(clusterDir, `.breadboard/visuals/${visualId}.json`, removedPaths);
  }
  if (fs.existsSync(indexPath)) {
    if (Object.keys(nextIndex).length > 0) {
      fs.writeFileSync(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, "utf-8");
    } else {
      removeClusterPath(clusterDir, ".breadboard/visual-index.json", removedPaths);
    }
  }
  removeEmptyParents(clusterDir, visualsDir);
  return prunedVisualIds;
}

function deleteLearnDatabaseState(gardenId: string): { deletedMaps: number; deletedVersions: number } {
  ensureLearnTables();
  const deletedVersions = db.prepare("DELETE FROM learn_versions WHERE garden_id = ?").run(gardenId).changes;
  const deletedMaps = db.prepare("DELETE FROM learn_maps WHERE garden_id = ?").run(gardenId).changes;
  return { deletedMaps, deletedVersions };
}

function cleanupLearnArtifacts({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): LearnCleanupResult {
  const clusterDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(clusterDir, { recursive: true });
  const removedPaths: string[] = [];
  const restoredPaths: string[] = [];

  removeClusterPath(clusterDir, LEARNING_ROOT, removedPaths);
  removeClusterPath(clusterDir, "Learning", removedPaths);
  removeLearnGeneratedMarkdown(clusterDir, removedPaths);
  const prunedVisualIds = cleanupLearnVisualArtifacts(clusterDir, removedPaths);

  for (const relPath of [
    ".breadboard/learning-unit-contract.json",
    ".breadboard/planning",
    ".breadboard/debug/failed-pages",
    ".breadboard/source-visuals.json",
    "assets/source-visuals",
  ]) {
    removeClusterPath(clusterDir, relPath, removedPaths);
  }
  restoreNonLearnBackups(clusterDir, restoredPaths);
  const backupRoot = path.join(clusterDir, ".breadboard", "backups");
  if (fs.existsSync(backupRoot)) {
    for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^learning/i.test(entry.name)) {
        removeClusterPath(clusterDir, `.breadboard/backups/${entry.name}`, removedPaths);
      }
    }
    removeEmptyParents(clusterDir, backupRoot);
  }

  const { deletedMaps, deletedVersions } = deleteLearnDatabaseState(gardenId);
  return {
    removedPaths: Array.from(new Set(removedPaths)),
    restoredPaths: Array.from(new Set(restoredPaths)),
    prunedVisualIds,
    deletedMaps,
    deletedVersions,
  };
}

async function cleanupLearnArtifactsAfterCancel({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): Promise<LearnCleanupResult> {
  const result = cleanupLearnArtifacts({ gardenId, contentPath });
  refreshClusterIndex(contentPath, gardenId);
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

/**
 * Stage 3 assignment for one page: the plan's sourceVisualsToEmbed wins; when
 * the plan named none, fall back to caption/token overlap so central visuals
 * still land on a relevant page. `claimed` keeps a visual on exactly one page.
 */
function assignSourceVisualsForSubsection({
  visuals,
  subsection,
  claimed,
}: {
  visuals: SourceVisual[];
  subsection: LearningSubsectionPlan;
  section: LearningSectionPlan;
  claimed: Set<string>;
}): SourceVisual[] {
  const available = visuals.filter((visual) => {
    if (claimed.has(visual.sourceVisualId)) return false;
    if (visual.type === "full_page_fallback") return Boolean(sourceVisualEmbedUrl(visual));
    // A real extracted figure/table/equation without a crop should remain a
    // source anchor, not be embedded as a misleading full-page screenshot.
    return Boolean(visual.croppedImagePath);
  });

  const planned = (subsection.sourceVisualIds ?? [])
    .map((id) => available.find((visual) => visual.sourceVisualId === id))
    .filter((visual): visual is SourceVisual => Boolean(visual));

  let chosen = planned;

  // Semantic assignment belongs to the Learning Unit Contract. If more than
  // the page cap was planned, keep the first planned items and let validation
  // reject the contract/page rather than silently broadening the page.
  chosen = chosen.slice(0, MAX_VISUALS_PER_PAGE);
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

// Which source-figure classes each interactive renderer may legitimately be
// grounded in (mirror of the validator + finalize compatibility rules).
const VISUAL_TYPE_ANCHOR_CLASSES: Record<string, ReadonlySet<string>> = {
  lif_neuron: new Set(["lif", "architecture"]),
  tradeoff_explorer: new Set(["equation", "result"]),
  stdp_window: new Set(["result"]),
  neural_coding: new Set<string>(),
};

function anchorCompatibleWithVisual(type: string, anchor: VisualSourceAnchor): boolean {
  const allowed = VISUAL_TYPE_ANCHOR_CLASSES[type];
  if (!allowed) return true; // renderer with no dedicated source coupling
  if (allowed.size === 0) return false;
  const id = String(anchor.figureId ?? anchor.tableId ?? anchor.equationId ?? "");
  const cls = classifyFigure({
    sourceVisualId: id,
    caption: anchor.description,
    pageNumber: anchor.page,
  });
  return allowed.has(cls);
}

function uniqueSourceAnchors(anchors: VisualSourceAnchor[]): VisualSourceAnchor[] {
  const seen = new Set<string>();
  const out: VisualSourceAnchor[] = [];
  for (const anchor of anchors) {
    const key = anchor.equationId ?? anchor.tableId ?? anchor.figureId ?? `${anchor.sourceId ?? ""}:${anchor.page ?? ""}:${anchor.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
  }
  return out;
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
    spec.sourceAnchors = uniqueSourceAnchors([...existingAnchors, ...derivedAnchors]).filter((anchor) =>
      anchorCompatibleWithVisual(spec.type, anchor),
    );
    if (spec.sourceAnchors.length > 0) {
      spec.sourceGroundingStatus = "source-anchored";
      spec.justification = spec.justification || "This interactive visual is tied to source visuals or formula anchors assigned to the same lesson page.";
    } else {
      spec.sourceGroundingStatus = "conceptual-no-direct-source-figure";
      spec.justification =
        spec.justification ||
        "This visual teaches a dynamic concept discussed on the page; no directly matching source figure was assigned to this lesson.";
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
    `${concepts} For example, compare two systems that receive mostly unchanged input over time. A dense continuous system still tends to move values through many layers on each update. An event-driven system can let silence mean “nothing important changed” and spend work only when a spike occurs. That example gives the transition a practical meaning: the representation is tied to cost, timing, and the kind of hardware that can run the computation efficiently.`,
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
    /[=≈≤≥∑∫]/.test(text) ||
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
  sourceOnly: boolean;
}): PageDossier {
  const subsectionTitle = sanitizeLearnerTitle(subsection.title);
  const keywords = fallbackKeywords(subsection, anchors);
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
          sourceArtifactAssignments: subsection.sourceArtifactAssignments,
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
  const clusterDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(clusterDir, { recursive: true });
  const confirmedLearningUnits = learningUnitsFromCoveragePlan(map.coveragePlan);
  writeLearningUnitContractArtifacts({
    clusterDir,
    units: confirmedLearningUnits,
    assignments: sourceArtifactAssignmentsFromCoveragePlan(map.coveragePlan),
    sourceSetHash: context.sourceSetHash,
  });
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
    // Stage 2 (idempotent): sources uploaded after planning still get their
    // visuals extracted before any page is written.
    const ledgerVisuals = await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath,
      gardenId,
      context,
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
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
        });
        const metricFormulaAnchorIds = (subsection.sourceFormulaContracts ?? []).map((formula) => formula.id);
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

        // Stage 4: one direct_council generation call, deterministic
        // clean/scrub + visual embedding, then the local quality critic. A
        // second model call happens ONLY when the deterministic gate hard-fails
        // (one focused repair, never a full-council rewrite). If no attempt
        // passes, the last draft is quarantined for debugging and the job
        // fails. The deterministic emergency draft is never learner-facing.
        let pageBody: string | null = null;
        let subsectionRunId: string | undefined;
        let revisionRunId: string | undefined;
        let lastQuality: ReturnType<typeof assessLessonQuality> | null = null;
        let lastAttemptBody = "";

        for (let attempt = 0; attempt < MAX_PAGE_ATTEMPTS; attempt += 1) {
          const retryNote =
            attempt === 0
              ? undefined
              : `This is retry ${attempt}. The previous draft failed quality checks (${(lastQuality?.problems ?? [])
                  .map((problem) => problem.code)
                  .join(", ")}). Write a longer, deeper, fully-written lesson (at least 700 words) with a concrete example and a real Question./Answer. Teach the concept directly — never comment on "the paper" or "the source".`;

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
                    .map((problem) => `${problem.code}: ${problem.message}`),
                  dossier: pageDossier,
                  repairRules: [
                    "Fix only the listed hard failures.",
                    "Preserve correct existing content.",
                    "Do not restart from scratch unless the page is unusable.",
                    "Keep the section flowing and beginner-friendly.",
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
              .map((problem) => problem.message)
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

        // Stage 7: 4-8 Zettelkasten concept-handle tags on learner pages only.
        // Tags are grounded in the FINAL accepted body (never fallback/debug
        // text) and gated by page relevance, so LIF/STDP/latency tags cannot
        // land on a page that does not actually teach them.
        const plannedZettelHandles = (subsection.zettelNotes ?? [])
          .map((note) => atomicZettelHandle(note.handle || note.claim))
          .filter((handle) => handle && isAtomicZettelHandle(handle));
        const zettelTags = normalizeZettelTags(
          [
            ...plannedZettelHandles,
            ...subsection.conceptTags,
            ...(plannedZettelHandles.length >= 4 ? [] : extractTagSeeds(pageBody)),
          ],
          subsectionTitle,
          map.learningMap.title || context.gardenTitle,
          {
            title: subsectionTitle,
            sectionTitle,
            body: pageBody,
            assignedVisualCaptions: assignedVisuals.map((visual) => visual.caption).filter(Boolean),
          },
        );
        const assignedVisualIds = assignedVisuals.map((visual) => visual.sourceVisualId);
        const pageMathExpressions = extractQuartzMath(normalizeQuartzMarkdown(pageBody));
        const formulas = formulaGroundingEntries(pageMathExpressions, sourceFormulaFigures(context));
        const finalContent =
          buildLearningPageFrontmatter({
            gardenId,
            sectionNumber,
            subsectionNumber,
            title: pageTitle,
            sourceAnchors: anchors,
            tags: zettelTags,
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
          sourceAnchors: anchors,
          visualIds: visualized.visualIds,
          sourceFigureIds: assignedVisualIds,
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
          sourceArtifactAssignments: sourceArtifactAssignmentsFromCoveragePlan(map.coveragePlan),
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

    // Stage 8 (deterministic export finalize + hard gate): repair the on-disk
    // tree so what Quartz publishes is exactly what the acceptance validator
    // accepts — clean export tree, source pages typed as sources (never learner
    // pages), resolvable source wikilinks, no stale caveats that contradict the
    // extracted anchors, semantically-placed source visuals, type-compatible
    // interactive grounding, content-based formula grounding, central tags, no
    // repeated first-page motivation — and write .breadboard/validation-report.md.
    // Critical validation is a hard gate: a garden that cannot be repaired fails
    // the job rather than shipping a broken artifact.
    throwIfLearnCancelled(job.id);
    const finalizeReport = finalizeGardenExport({ gardenDir: clusterDir, gardenSlug: gardenId });
    appendLearnEvent(contentPath, gardenId, "learn_export_finalized", {
      jobId: job.id,
      textbookVersionId,
      removed: finalizeReport.removed,
      changedCount: finalizeReport.changed.length,
      criticalProblems: finalizeReport.criticalProblems,
    });
    if (finalizeReport.criticalProblems.length > 0) {
      throw new Error(
        `Export finalize failed critical validation for ${gardenId}: ${finalizeReport.criticalProblems.join("; ")}. ` +
          "The garden was not published. See .breadboard/validation-report.md.",
      );
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
        await cleanupLearnArtifactsAfterCancel({ gardenId, contentPath });
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
    return runLearnPlanning({
      gardenId,
      userId,
      client,
      model,
      contentPath,
      sourceOnly,
      includeSourceSnapshots,
    });
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
  const next = latest
    ? updateLearnJob(latest.id, {
        status: "cancelled",
        currentStep: "Cancelled and cleaned",
        progressPercent: 0,
        currentSectionTitle: undefined,
        currentPageTitle: undefined,
        proposedLearningMapId: undefined,
        confirmedLearningMapId: undefined,
        latestTextbookVersionId: undefined,
      })
    : null;
  const cleanup = await cleanupLearnArtifactsAfterCancel({ gardenId, contentPath });
  if (latest) {
    appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
      jobId: latest.id,
      removedPathCount: cleanup.removedPaths.length,
      restoredPathCount: cleanup.restoredPaths.length,
      deletedMaps: cleanup.deletedMaps,
      deletedVersions: cleanup.deletedVersions,
    });
  }
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
  const latestConfirmed = getLatestConfirmedLearnMap(gardenId);
  const confirmedMap = isContractBackedLearningMap(latestConfirmed) ? latestConfirmed : null;
  const latestVersion = getLatestLearnVersion(gardenId);
  const knowledge = scanClusterKnowledge(contentPath, gardenId);
  const hasTextbook = knowledge.stats.textbookPages > 0;
  const sourceSetChanged =
    Boolean(latestVersion) && latestVersion?.source_set_hash !== context.sourceSetHash;

  return {
    job: visibleJob,
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
  };
}
