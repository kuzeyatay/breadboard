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
  appendGardenEvent,
  generateVisualSpec,
  saveVisualSpec,
} from "@/lib/visuals";
import {
  assignSourceFigureIds,
  buildVisualBlock,
  validateVisualSpec,
  type SourceAnchor,
  type SourceFigure,
  type VisualSpec,
} from "@/lib/visual-spec";
import {
  buildTextbookPageFrontmatter,
  containsRawVisualPlaceholder,
  ensureQuestionBlock,
  fallbackLearningMapFromSources,
  normalizeLearningMapCandidate,
  parseJsonCandidate,
  removeRawVisualPlaceholders,
  safeLearnFileSegment,
  sourceSetHashForSources,
  stripMarkdownFence,
  stripMarkdownFrontmatter,
  textbookPageFileName,
  textbookSectionFolder,
  wikilinkForRelPath,
  yamlFrontmatter,
  type LearnConceptSummary,
  type LearnContextSummary,
  type LearnSourceSummary,
  type LearnStatus,
  type LearningSectionPlan,
  type LearningSubsectionPlan,
  type ProposedLearningMap,
} from "@/lib/learn-utils";

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

interface GeneratedPageRecord {
  title: string;
  relPath: string;
  sourceAnchors: string[];
  visualIds: string[];
  sourceFigureIds: string[];
}

const SOURCE_MAP_PROMPT = `You create the Source Map for a Breadboard learning garden.
Return ONLY JSON. Include:
- sources: each source title, role, source id/slug, central concepts, formulas, examples, questions, and caveats
- figures: figures/graphs/tables/formula displays with labels when provided
- sourceAnchors: compact anchors that later pages can cite
- missingOrUnclear: unclear or missing source material
Stay source-aware. If source-only mode is true, do not add outside facts.`;

const SCOPE_CONTRACT_PROMPT = `You create the Scope Contract for a Breadboard e-textbook.
Return ONLY JSON with included, excluded, background, deferred, sourceEmphasis, and caveats.
The contract must protect source scope: no unsupported expansion, no disconnected topic cards, and no final Generated Subtopics pages.`;

const TOPIC_MAP_PROMPT = `You create the Learning Spine / Topic Map for a Breadboard e-textbook.
Return ONLY JSON with this shape:
{
  "title": "Textbook title",
  "summary": "short description",
  "sections": [
    {
      "title": "Section title",
      "purpose": "why this section comes here",
      "sourceAnchors": ["..."],
      "subsections": [
        {
          "title": "Subsection title",
          "purpose": "what the learner does here",
          "sourceAnchors": ["..."],
          "visualOpportunities": ["..."],
          "conceptTags": ["..."]
        }
      ]
    }
  ],
  "warnings": ["..."]
}
First job: section names and order. Do not generate final textbook prose yet. Do not publish generated subtopics.`;

const OVERVIEW_PROMPT = `Write Learning/Topic Overview.md as the first page of a Breadboard e-textbook.
Return Markdown body only, no frontmatter. Include what the garden is about, how to learn it, recommended reading order,
links to sections/subsections using wikilink-style labels when useful, high-level concept tags, and source scope caveats.
Do not create disconnected notes and do not include raw visual placeholders.`;

const SUBSECTION_PROMPT = `Write one flowing Breadboard textbook subsection from the uploaded sources.
Return Markdown body only, no frontmatter, no code fence around the whole page.
Rules:
- Start with a high-level introduction to the subsection.
- Write as one flowing textbook section, not disconnected mini-sections.
- Avoid over-segmentation and excessive headings.
- Build intuition before notation; introduce terms only when needed.
- Derive formulas step by step and define every symbol.
- Explain each object and give examples immediately after concepts.
- Use source-central formulas, figures, graphs, tables, examples, and questions when relevant.
- Include 1-2 questions using exactly:
  **Question.** ...
  **Answer.** ...
- End by synthesizing the chain of reasoning.
- Never leave [Interactive visual: ...] or any bracketed visual placeholder.
- Do not generate arbitrary executable JavaScript.`;

const REVISION_PROMPT = `Revise the textbook page for flow, correctness, source coverage, and readability.
Return Markdown body only, no frontmatter.
Keep it a flowing textbook subsection. Remove raw visual placeholders. Keep or add 1-2 **Question.** / **Answer.** pairs.
If source-only mode is true, do not add unsupported facts; say when source material is missing.`;

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

function updateLearnJob(jobId: string, updates: Partial<LearnJob>): LearnJob {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE id = ?")
    .get(jobId) as LearnJobRow | undefined;
  if (!row) throw new Error(`Learn job ${jobId} not found`);
  const current = rowToJob(row)!;
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

function pageNumberBefore(markdown: string, index: number): number | undefined {
  const prefix = markdown.slice(0, index);
  const matches = [...prefix.matchAll(/^#{1,4}\s+(?:page|p\.?)\s*([0-9]+)\b/gim)];
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  const parsed = Number.parseInt(last[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferFigureKind(caption: string, url = ""): SourceFigure["kind"] {
  const text = `${caption} ${url}`.toLowerCase();
  if (/\b(table|tabular|matrix)\b/.test(text)) return "table";
  if (/\b(graph|plot|curve|axis|axes)\b/.test(text)) return "graph";
  if (/\b(photo|image|snapshot)\b/.test(text)) return "photo";
  if (/\b(formula|equation|derivation)\b/.test(text)) return "formula";
  return "diagram";
}

function extractSourceFiguresFromMarkdown(
  source: LearnSourceSummary,
  sourceIndex: number,
): SourceFigure[] {
  const body = source.body ?? "";
  const rawFigures: Array<Partial<SourceFigure> & { page?: number }> = [];

  for (const match of body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const caption = cleanGeneratedText((match[1] || match[2] || "Source figure").trim());
    rawFigures.push({
      sourceId: source.slug,
      page: pageNumberBefore(body, match.index ?? 0),
      kind: inferFigureKind(caption, match[2]),
      caption,
      suggestedVisualUse: "Create a source_figure_explainer or matching safe visual block.",
      relevanceNotes: `Source image in ${source.title}`,
    });
  }

  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (/^\s*\|.+\|\s*$/.test(lines[index]) && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      rawFigures.push({
        sourceId: source.slug,
        kind: "table",
        caption: `Table near line ${index + 1} in ${source.title}`,
        ocrText: lines.slice(index, Math.min(index + 6, lines.length)).join("\n"),
        suggestedVisualUse: "Use as a comparison_table or source_figure_explainer.",
      });
    }
  }

  return assignSourceFigureIds(sourceIndex, rawFigures).map((figure) => ({
    ...figure,
    sourceId: figure.sourceId ?? source.slug,
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
    .filter((node) => node.type === "textbook-page")
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
  const sourceFigures = sources.flatMap((source, index) =>
    extractSourceFiguresFromMarkdown(source, index + 1),
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
  };
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
}): Promise<CouncilCallResult> {
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
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  system: string;
  user: string;
  sourceContext: unknown;
  councilModeOverride?: CouncilMode;
}): Promise<CouncilCallResult & { parsed: unknown | null }> {
  const result = await callCouncilText({
    client,
    model,
    taskType,
    gardenId,
    system,
    user,
    sourceContext,
    councilModeOverride,
  });
  return { ...result, parsed: parseJsonCandidate(result.content) };
}

function sourceCoveragePlan(
  context: LearnSourceContext,
  learningMap: ProposedLearningMap,
): unknown {
  return {
    sourceSetHash: context.sourceSetHash,
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
      assignedSubsection: "",
      suggestedVisualTreatment: figure.suggestedVisualUse ?? "source_figure_explainer",
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

    const sourceMapCall = await callCouncilJson({
      client,
      model,
      taskType: "source_map",
      gardenId,
      system: SOURCE_MAP_PROMPT,
      user: JSON.stringify(
        { sourceOnly, sourceContext: promptSourceContext },
        null,
        2,
      ),
      sourceContext: promptSourceContext,
      councilModeOverride: "full_council",
    });
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

    const scopeCall = await callCouncilJson({
      client,
      model,
      taskType: "scope_contract",
      gardenId,
      system: SCOPE_CONTRACT_PROMPT,
      user: JSON.stringify({ sourceOnly, sourceMap, sources: promptSourceContext }, null, 2),
      sourceContext: { sourceMap, sources: promptSourceContext },
      councilModeOverride: "full_council",
    });
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

    const topicMapCall = await callCouncilJson({
      client,
      model,
      taskType: "topic_map",
      gardenId,
      system: TOPIC_MAP_PROMPT,
      user: JSON.stringify(
        {
          sourceOnly,
          sourceMap,
          scopeContract,
          sources: promptSourceContext,
          responseShape: "ProposedLearningMap JSON",
        },
        null,
        2,
      ),
      sourceContext: { sourceMap, scopeContract, sources: promptSourceContext },
      councilModeOverride: "full_council",
    });
    const learningMap = normalizeLearningMapCandidate(topicMapCall.parsed, context, {
      sourceOnly,
      createdAt: nowIso(),
    });
    const coveragePlan = sourceCoveragePlan(context, learningMap);
    const storedMap = insertLearnMap({
      gardenId,
      jobId: job.id,
      sourceMap,
      scopeContract,
      learningMap,
      coveragePlan,
      sourceSetHash: context.sourceSetHash,
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

function learningPageFrontmatter(
  title: string,
  type: string,
  gardenId: string,
  textbookVersionId: string,
  sourceSetHash: string,
): string {
  const bodyForTags = `${title} ${type} ${gardenId}`;
  return yamlFrontmatter({
    title,
    date: nowIso(),
    knowledge_type: type,
    breadboardType: type.replace(/-/g, "_"),
    gardenId,
    generatedBy: "learn_button",
    generated_by: "learn_button",
    textbookVersion: textbookVersionId,
    textbookVersionId,
    sourceSetHash,
    tags: normalizeTopicTags([title, "learning map"], bodyForTags, 6, bodyForTags),
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
    lines.push(`- ${sectionNumber}. ${section.title}`);
    section.subsections.forEach((subsection, subsectionIndex) => {
      const relPath = `${textbookSectionFolder(sectionNumber, section.title)}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsection.title,
      )}`;
      lines.push(
        `  - ${sectionNumber}.${subsectionIndex + 1} ${wikilinkForRelPath(relPath, subsection.title)}`,
      );
    });
  });
  lines.push("", "## Prerequisite Chain", "");
  map.sections.forEach((section, index) => {
    const previous = index === 0 ? "Start here" : map.sections[index - 1].title;
    lines.push(`- ${previous} -> ${section.title}`);
  });
  lines.push("", "## Trunk, Branch, Leaf Concepts", "");
  map.sections.forEach((section) => {
    lines.push(`- Trunk: ${section.title}`);
    section.subsections.forEach((subsection) => {
      lines.push(`  - Branch/leaf: ${subsection.title}`);
    });
  });
  lines.push("", "## Bridge Concepts", "");
  lines.push("- Bridges are introduced where adjacent subsections share source anchors or concept tags.");
  lines.push("", "## Warnings", "");
  lines.push(...(map.warnings.length > 0 ? map.warnings.map((warning) => `- ${warning}`) : ["- None."]));
  return `${lines.join("\n")}\n`;
}

function renderTopicOverviewFallback(map: ProposedLearningMap, context: LearnSourceContext): string {
  const lines = [
    "# Topic Overview",
    "",
    `${context.gardenTitle} is organized as a source-aware textbook built from ${context.sources.length} uploaded source${context.sources.length === 1 ? "" : "s"}.`,
    "",
    "## How To Learn This Garden",
    "",
    "Read the sections in order. Each subsection introduces the next idea only after the source-backed motivation is clear.",
    "",
    "## Recommended Reading Order",
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    lines.push(`- ${sectionNumber}. ${section.title}`);
    section.subsections.forEach((subsection, subsectionIndex) => {
      const relPath = `${textbookSectionFolder(sectionNumber, section.title)}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsection.title,
      )}`;
      lines.push(`  - ${wikilinkForRelPath(relPath, `${sectionNumber}.${subsectionIndex + 1} ${subsection.title}`)}`);
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
  lines.push(...(tags.length > 0 ? tags.map((tag) => `- ${tag}`) : ["- Source-grounded learning path"]));
  lines.push("", "## Source Scope Caveats", "");
  lines.push(...(map.warnings.length > 0 ? map.warnings.map((warning) => `- ${warning}`) : ["- The textbook stays within the uploaded source scope unless explicitly updated."]));
  return `${lines.join("\n")}\n`;
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

function sourceCoverageMarkdown({
  context,
  generatedPages,
  unusedFigureReasons,
}: {
  context: LearnSourceContext;
  generatedPages: GeneratedPageRecord[];
  unusedFigureReasons: Map<string, string>;
}): string {
  const usedFigures = new Set(generatedPages.flatMap((page) => page.sourceFigureIds));
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
  lines.push("- Formula, example, and question coverage is tracked through source anchors on the generated textbook pages.");
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
  fs.writeFileSync(filePath, content, "utf-8");
  return { filePath, backedUpTo };
}

function chooseSourceFiguresForSubsection(
  context: LearnSourceContext,
  subsection: LearningSubsectionPlan,
  section: LearningSectionPlan,
): SourceFigure[] {
  const haystack = [
    subsection.title,
    subsection.purpose,
    ...subsection.sourceAnchors,
    ...section.sourceAnchors,
  ]
    .join(" ")
    .toLowerCase();
  const direct = context.sourceFigures.filter((figure) => {
    const source = context.sources.find((item) => item.slug === figure.sourceId);
    return (
      (source && haystack.includes(source.title.toLowerCase())) ||
      (figure.caption && haystack.includes(figure.caption.toLowerCase().slice(0, 40))) ||
      (figure.sourceId && haystack.includes(figure.sourceId.toLowerCase()))
    );
  });
  return (direct.length > 0 ? direct : context.sourceFigures).slice(0, 2);
}

function sourceAnchorsForVisual(
  anchors: string[],
  sourceFigures: SourceFigure[],
): SourceAnchor[] {
  const fromFigures: SourceAnchor[] = sourceFigures.map((figure) => ({
    sourceId: figure.sourceId,
    page: figure.page,
    figureId: figure.figureId,
    description: figure.caption ?? figure.relevanceNotes ?? figure.kind,
  }));
  const fromAnchors: SourceAnchor[] = anchors.slice(0, 4).map((description) => ({
    description,
  }));
  return [...fromFigures, ...fromAnchors].slice(0, 8);
}

function fallbackVisualSpec({
  gardenId,
  pageId,
  title,
  anchors,
  conceptTags,
  sourceFigures,
}: {
  gardenId: string;
  pageId: string;
  title: string;
  anchors: string[];
  conceptTags: string[];
  sourceFigures: SourceFigure[];
}): VisualSpec {
  const candidate = {
    id: makeId("vis"),
    gardenId,
    pageId,
    type: sourceFigures.length > 0 ? "source_figure_explainer" : "concept_diagram",
    title,
    sourceAnchors: sourceAnchorsForVisual(anchors, sourceFigures),
    conceptTargets: conceptTags.length > 0 ? conceptTags.slice(0, 8) : [title],
    pedagogicalPurpose:
      "Provide a safe visual checkpoint that ties the prose to source anchors and core concepts.",
    props: {
      nodes: conceptTags.slice(0, 8),
      sourceFigures: sourceFigures.map((figure) => figure.figureId),
    },
    caption:
      sourceFigures.length > 0
        ? "Source-anchored explainer for the figure or table used in this subsection."
        : "Conceptual checkpoint for this subsection.",
    regenerationPrompt: `Regenerate a clearer source-aware visual for ${title}.`,
    createdAt: nowIso(),
    version: 1,
  };
  const { spec } = validateVisualSpec(candidate);
  if (!spec) {
    throw new Error("Fallback visual spec failed validation");
  }
  return spec;
}

function insertVisualAfterIntro(markdown: string, visualBlock: string): string {
  if (markdown.includes("```breadboard-visual")) return markdown;
  const parts = markdown.trim().split(/\n{2,}/);
  if (parts.length <= 1) return `${markdown.trim()}\n\n${visualBlock}\n`;
  const insertAt = parts[0].startsWith("# ") && parts.length > 2 ? 2 : 1;
  return [...parts.slice(0, insertAt), visualBlock, ...parts.slice(insertAt)].join("\n\n");
}

async function ensureVisualBlocks({
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
}): Promise<{ markdown: string; visualIds: string[]; sourceFigureIds: string[] }> {
  let visual: VisualSpec | null = null;
  const opportunity =
    subsection.visualOpportunities[0] ??
    sourceFigures[0]?.suggestedVisualUse ??
    `Clarify ${subsection.title} with a source-aware visual.`;

  try {
    const generated = await generateVisualSpec(client, model, {
      gardenId,
      pageId,
      sectionTitle,
      subsectionTitle: subsection.title,
      pageMarkdown: markdown,
      sourceContext,
      sourceFigures,
      visualOpportunity: opportunity,
      councilModeOverride: sourceFigures.length > 0 ? "full_council" : "lite_council",
    });
    visual = generated.spec;
  } catch {
    visual = null;
  }

  if (!visual) {
    visual = fallbackVisualSpec({
      gardenId,
      pageId,
      title: `${subsection.title} visual`,
      anchors: subsection.sourceAnchors,
      conceptTags: subsection.conceptTags,
      sourceFigures,
    });
  }

  saveVisualSpec(contentPath, gardenId, visual, pageRelPath.replace(/\.md$/i, ""));
  appendLearnEvent(contentPath, gardenId, "learn_visual_created", {
    jobId,
    textbookVersionId,
    pageId,
    visualId: visual.id,
    councilRunId: visual.id,
    sourceIds: [...new Set(visual.sourceAnchors.map((anchor) => anchor.sourceId).filter(Boolean))],
  });
  for (const anchor of visual.sourceAnchors) {
    if (!anchor.figureId) continue;
    appendLearnEvent(contentPath, gardenId, "learn_source_figure_linked", {
      jobId,
      textbookVersionId,
      pageId,
      visualId: visual.id,
      figureId: anchor.figureId,
      sourceId: anchor.sourceId,
    });
  }

  const block = buildVisualBlock(visual);
  let nextMarkdown = containsRawVisualPlaceholder(markdown)
    ? removeRawVisualPlaceholders(markdown, block)
    : markdown;
  nextMarkdown = insertVisualAfterIntro(nextMarkdown, block);
  return {
    markdown: nextMarkdown,
    visualIds: [visual.id],
    sourceFigureIds: visual.sourceAnchors
      .map((anchor) => anchor.figureId)
      .filter((figureId): figureId is string => Boolean(figureId)),
  };
}

function fallbackSubsectionMarkdown({
  sectionNumber,
  subsectionNumber,
  subsection,
  anchors,
  sourceFigures,
}: {
  sectionNumber: number;
  subsectionNumber: number;
  subsection: LearningSubsectionPlan;
  anchors: string[];
  sourceFigures: SourceFigure[];
}): string {
  const title = `${sectionNumber}.${subsectionNumber} ${subsection.title}`;
  const figureLines =
    sourceFigures.length > 0
      ? sourceFigures.map((figure) => `- ${figure.figureId}: ${figure.caption ?? figure.kind}`).join("\n")
      : "- No central source figures were assigned to this subsection.";
  return [
    `# ${title}`,
    "",
    `${subsection.purpose || `This subsection introduces ${subsection.title} through the uploaded source material.`}`,
    "",
    "The safest way to read this part is to begin with the source anchors, identify the objects being discussed, and then connect each definition or formula to the example that motivated it.",
    "",
    "## Source Anchors",
    "",
    ...(anchors.length > 0 ? anchors.map((anchor) => `- ${anchor}`) : ["- General uploaded source context."]),
    "",
    "## Source Figures",
    "",
    figureLines,
    "",
    "**Question.** What should you verify before using this subsection in a problem?",
    "",
    "**Answer.** Verify which source anchor supports the claim, what each symbol or object refers to, and whether the subsection is using a figure, formula, or example from the uploaded material.",
    "",
    "The chain of reasoning in this subsection is therefore source first: locate the anchor, name the objects, connect the formula or example, and then use the visual checkpoint to test the idea.",
  ].join("\n");
}

function cleanCouncilMarkdown(value: string, fallback: string): string {
  const cleaned = stripMarkdownFrontmatter(stripMarkdownFence(cleanGeneratedText(value))).trim();
  return cleaned || fallback;
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
}): Promise<{ job: LearnJob; textbookVersionId: string; pageCount: number }> {
  const map =
    (confirmedLearningMapId ? getLearnMapById(confirmedLearningMapId) : null) ??
    getLatestConfirmedLearnMap(gardenId);
  if (!map || map.status !== "confirmed") {
    throw new Error("Confirm a learning map before generating the textbook");
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
  const textbookVersionId = makeId("textbook");
  const backupDir = `.breadboard/backups/${textbookVersionId}`;
  const generatedAt = nowIso();
  const generatedPages: GeneratedPageRecord[] = [];
  const unusedFigureReasons = new Map<string, string>();

  try {
    appendLearnEvent(contentPath, gardenId, "learn_textbook_generation_started", {
      jobId: job.id,
      textbookVersionId,
      learningMapId: map.id,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      status: "generating_textbook",
      currentStep: "Writing overview pages",
      progressPercent: 3,
      confirmedLearningMapId: map.id,
      latestTextbookVersionId: textbookVersionId,
      sourceSetHash: context.sourceSetHash,
    });

    let overviewBody = "";
    try {
      const overviewCall = await callCouncilText({
        client,
        model,
        taskType: "source_synthesis",
        gardenId,
        pageId: "Learning/Topic Overview",
        system: OVERVIEW_PROMPT,
        user: JSON.stringify(
          {
            learningMap: map.learningMap,
            sourceMap: map.sourceMap,
            scopeContract: map.scopeContract,
            sourceOnly,
          },
          null,
          2,
        ),
        sourceContext: { sourceMap: map.sourceMap, scopeContract: map.scopeContract, sources: promptSources(context) },
        councilModeOverride: "full_council",
      });
      overviewBody = cleanCouncilMarkdown(
        overviewCall.content,
        renderTopicOverviewFallback(map.learningMap, context),
      );
    } catch {
      overviewBody = renderTopicOverviewFallback(map.learningMap, context);
    }

    const learningRelPaths = [
      {
        relPath: "Learning/Topic Overview.md",
        title: "Topic Overview",
        type: "topic-overview",
        body: overviewBody,
      },
      {
        relPath: "Learning/Learning Map.md",
        title: "Learning Map",
        type: "learning-map",
        body: renderLearningMapMarkdown(map.learningMap),
      },
      {
        relPath: "Learning/Source Map.md",
        title: "Source Map",
        type: "source-map",
        body: sourceMapMarkdown(map.sourceMap, context),
      },
      {
        relPath: "Learning/Scope Contract.md",
        title: "Scope Contract",
        type: "scope-contract",
        body: scopeContractMarkdown(map.scopeContract),
      },
    ];

    for (const page of learningRelPaths) {
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
      const sectionFolder = textbookSectionFolder(sectionNumber, section.title);
      const sectionIndexRelPath = `${sectionFolder}/_index.md`;
      writeMarkdownWithBackup({
        clusterDir,
        relPath: sectionIndexRelPath,
        textbookVersionId,
        content:
          yamlFrontmatter({
            title: `${sectionNumber}. ${section.title}`,
            date: generatedAt,
            knowledge_type: "textbook-section",
            breadboardType: "textbook_section",
            gardenId,
            generatedBy: "learn_button",
            textbookVersion: textbookVersionId,
            sourceSetHash: context.sourceSetHash,
          }) +
          `# ${sectionNumber}. ${section.title}\n\n${section.purpose || "This section is part of the confirmed Breadboard learning map."}\n`,
      });

      for (let subsectionIndex = 0; subsectionIndex < section.subsections.length; subsectionIndex += 1) {
        const subsection = section.subsections[subsectionIndex];
        const subsectionNumber = subsectionIndex + 1;
        const pageTitle = `${sectionNumber}.${subsectionNumber} ${subsection.title}`;
        const pageFileName = textbookPageFileName(sectionNumber, subsectionNumber, subsection.title);
        const pageRelPath = `${sectionFolder}/${pageFileName}`;
        const pageId = pageRelPath.replace(/\.md$/i, "");
        const anchors =
          subsection.sourceAnchors.length > 0
            ? subsection.sourceAnchors
            : section.sourceAnchors.length > 0
              ? section.sourceAnchors
              : context.sources.map((source) => source.title);
        const sourceFigures = chooseSourceFiguresForSubsection(context, subsection, section);
        const pageSourceContext = {
          sourceMap: map.sourceMap,
          scopeContract: map.scopeContract,
          learningSpine: map.learningMap,
          subsectionPlan: subsection,
          sourceAnchors: anchors,
          sourceFigures,
          sourceOnly,
        };

        appendLearnEvent(contentPath, gardenId, "learn_textbook_page_started", {
          jobId: job.id,
          textbookVersionId,
          pageId,
          sourceIds: context.sources.map((source) => source.slug),
        });
        updateLearnJob(job.id, {
          status: "generating_textbook",
          currentStep: "Writing textbook subsection",
          progressPercent: 10 + Math.floor((completed / Math.max(1, totalSubsections)) * 70),
          currentSectionTitle: section.title,
          currentPageTitle: pageTitle,
        });

        if (includeSourceSnapshots) {
          snapshotSourceContext({
            clusterDir,
            textbookVersionId,
            pageId,
            sourceContext: pageSourceContext,
          });
        }

        const fallback = fallbackSubsectionMarkdown({
          sectionNumber,
          subsectionNumber,
          subsection,
          anchors,
          sourceFigures,
        });
        let pageBody = fallback;
        let subsectionRunId: string | undefined;
        let revisionRunId: string | undefined;

        try {
          const generated = await callCouncilText({
            client,
            model,
            taskType: "subsection_generation",
            gardenId,
            pageId,
            system: SUBSECTION_PROMPT,
            user: JSON.stringify(pageSourceContext, null, 2),
            sourceContext: pageSourceContext,
            councilModeOverride: "full_council",
          });
          subsectionRunId = generated.councilRunId;
          pageBody = cleanCouncilMarkdown(generated.content, fallback);
        } catch {
          pageBody = fallback;
        }

        try {
          const revised = await callCouncilText({
            client,
            model,
            taskType: "full_page_revision",
            gardenId,
            pageId,
            system: REVISION_PROMPT,
            user: JSON.stringify(
              {
                pageMarkdown: pageBody,
                sourceOnly,
                sourceContext: pageSourceContext,
              },
              null,
              2,
            ),
            sourceContext: pageSourceContext,
            councilModeOverride: "full_council",
          });
          revisionRunId = revised.councilRunId;
          pageBody = cleanCouncilMarkdown(revised.content, pageBody);
        } catch {
          // Keep the generated or fallback page body.
        }

        pageBody = ensureQuestionBlock(pageBody, subsection.title);

        updateLearnJob(job.id, {
          status: "generating_visuals",
          currentStep: "Creating visual block",
          currentSectionTitle: section.title,
          currentPageTitle: pageTitle,
        });
        const visualized = await ensureVisualBlocks({
          client,
          model,
          contentPath,
          gardenId,
          jobId: job.id,
          textbookVersionId,
          pageId,
          pageRelPath,
          markdown: pageBody,
          sectionTitle: section.title,
          subsection,
          sourceContext: pageSourceContext,
          sourceFigures,
        });
        pageBody = visualized.markdown;
        if (containsRawVisualPlaceholder(pageBody)) {
          pageBody = removeRawVisualPlaceholders(
            pageBody,
            buildVisualBlock(
              fallbackVisualSpec({
                gardenId,
                pageId,
                title: `${subsection.title} visual`,
                anchors,
                conceptTags: subsection.conceptTags,
                sourceFigures,
              }),
            ),
          );
        }

        const conceptTags = normalizeTopicTags(
          subsection.conceptTags,
          pageBody,
          10,
          `${subsection.title}\n${pageBody}`,
        );
        const finalContent =
          buildTextbookPageFrontmatter({
            gardenId,
            sectionNumber,
            subsectionNumber,
            title: pageTitle,
            sourceAnchors: anchors,
            conceptTags,
            visualIds: visualized.visualIds,
            textbookVersionId,
            sourceSetHash: context.sourceSetHash,
            generatedAt,
          }) + `${pageBody.trim()}\n`;

        updateLearnJob(job.id, {
          status: "writing_quartz",
          currentStep: "Writing Quartz Markdown",
          currentSectionTitle: section.title,
          currentPageTitle: pageTitle,
        });
        writeMarkdownWithBackup({
          clusterDir,
          relPath: pageRelPath,
          content: finalContent,
          textbookVersionId,
        });
        generatedPages.push({
          title: pageTitle,
          relPath: pageRelPath,
          sourceAnchors: anchors,
          visualIds: visualized.visualIds,
          sourceFigureIds: visualized.sourceFigureIds,
        });
        appendLearnEvent(contentPath, gardenId, "learn_textbook_page_written", {
          jobId: job.id,
          textbookVersionId,
          pageId,
          councilRunId: revisionRunId ?? subsectionRunId,
          sourceIds: context.sources.map((source) => source.slug),
        });
        completed += 1;
      }
    }

    for (const figure of context.sourceFigures) {
      if (!generatedPages.some((page) => page.sourceFigureIds.includes(figure.figureId))) {
        unusedFigureReasons.set(figure.figureId, "Not selected as central for the confirmed subsection order.");
      }
    }

    writeMarkdownWithBackup({
      clusterDir,
      relPath: "Learning/Source Coverage.md",
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
        }),
    });

    updateLearnJob(job.id, {
      status: "building_navigation",
      currentStep: "Refreshing Quartz navigation",
      progressPercent: 95,
      currentSectionTitle: undefined,
      currentPageTitle: undefined,
    });
    refreshClusterIndex(contentPath, gardenId);
    await publishQuartzAfterMutation(`learn textbook generation in ${gardenId}`);

    insertLearnVersion({
      id: textbookVersionId,
      gardenId,
      jobId: job.id,
      learningMapId: map.id,
      sourceSetHash: context.sourceSetHash,
      pageCount: generatedPages.length + learningRelPaths.length + 1,
      backupDir,
    });

    appendLearnEvent(contentPath, gardenId, "learn_textbook_generation_completed", {
      jobId: job.id,
      textbookVersionId,
      pageCount: generatedPages.length,
      sourceIds: context.sources.map((source) => source.slug),
    });
    const finalJob = updateLearnJob(job.id, {
      status: "complete",
      currentStep: "Textbook complete",
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
    const message = error instanceof Error ? error.message : "Textbook generation failed";
    appendLearnEvent(contentPath, gardenId, "learn_failed", {
      jobId: job.id,
      textbookVersionId,
      error: message,
    });
    updateLearnJob(job.id, {
      status: "failed",
      currentStep: "Textbook generation failed",
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
  });
}

export function cancelLatestLearnJob({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): LearnJob | null {
  const latest = getLatestLearnJob(gardenId);
  if (!latest) return null;
  const next = updateLearnJob(latest.id, {
    status: "cancelled",
    currentStep: "Cancelled",
  });
  appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
    jobId: latest.id,
  });
  return next;
}

function activeStatus(status: LearnStatus): boolean {
  return [
    "planning",
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
  if (sourceSetChanged && (hasTextbook || latestVersion)) return "Update Textbook with New Sources";
  if (confirmedMap && !latestVersion) return "Generate Textbook";
  if (hasTextbook || latestVersion) return "Regenerate Textbook";
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
  const confirmedMap = getLatestConfirmedLearnMap(gardenId);
  const latestVersion = getLatestLearnVersion(gardenId);
  const knowledge = scanClusterKnowledge(contentPath, gardenId);
  const hasTextbook = knowledge.stats.textbookPages > 0;
  const sourceSetChanged =
    Boolean(latestVersion) && latestVersion?.source_set_hash !== context.sourceSetHash;

  return {
    job: latestJob,
    proposedLearningMap:
      latestJob?.status === "awaiting_confirmation" || latestProposed?.status === "proposed"
        ? latestProposed?.learningMap ?? null
        : null,
    confirmedLearningMapId: confirmedMap?.id,
    latestTextbookVersionId: latestVersion?.id,
    hasSources: context.sources.length > 0,
    sourceCount: context.sources.length,
    hasTextbook,
    sourceSetChanged,
    buttonLabel: buttonLabelForSnapshot({
      latestJob,
      confirmedMap,
      latestVersion,
      hasTextbook,
      sourceSetChanged,
    }),
  };
}
