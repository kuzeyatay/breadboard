import { createHash } from "node:crypto";
import type { Dir, Stats } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

import db from "@/lib/db";
import { modelAuthoredLearningUnitParseProblems } from "@/lib/learning-unit-contract";
import {
  isInternalConceptMetadata,
  isLearnAuthoredLesson,
  LEARNING_PAGE_TYPE,
  LEARNING_PAGE_TYPES,
  LEARNING_SECTION_TYPE,
  LEARNING_SECTION_TYPES,
} from "@/lib/learning-garden";
import { selectedSourceArtifactInventorySnapshot } from "@/lib/learn-source-artifact-inventory";
import {
  learnSourceBindingRecord,
  matchingLearnSourceNormalizationReceipt,
  sourceSetHashForBindingRecords,
} from "@/lib/learn-source-normalization-receipt";
import { failedGenerationRequiresReplanFromEvents } from "@/lib/learn-replan-recovery";
import type {
  SourceVisual,
  SourceVisualSourceIdentity,
} from "@/lib/source-visuals";
import type {
  LearnSourceSummary,
  LearnStatus,
  ProposedLearningMap,
} from "@/lib/learn-utils";

const LEARN_MODEL = "gpt-5.6-sol";
const SOURCE_FORMULA_REVIEW_SCHEMA_VERSION = 1;
const SOURCE_FORMULA_REVIEW_PROMPT_VERSION = 2;
const SHA256 = /^[0-9a-f]{64}$/i;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const STATUS_MARKDOWN_ENTRY_LIMIT = 16_384;
const STATUS_DIRECTORY_DEPTH_LIMIT = 64;
const STATUS_RELATIVE_PATH_BYTE_LIMIT = 4 * 1024;
const STATUS_FRONTMATTER_BYTE_LIMIT = 64 * 1024;
const STATUS_FRONTMATTER_TOTAL_BYTE_LIMIT = 32 * 1024 * 1024;
const STATUS_SOURCE_FILE_BYTE_LIMIT = 64 * 1024 * 1024;
const STATUS_SOURCE_TOTAL_BYTE_LIMIT = 256 * 1024 * 1024;
const STATUS_PENDING_WHITESPACE_LIMIT = 1024 * 1024;
const STATUS_STREAM_CHUNK_BYTES = 64 * 1024;
const STATUS_SOURCE_CACHE_LIMIT = 128;
const STATUS_METADATA_CACHE_LIMIT = 128;
const STATUS_SOURCE_VISUAL_LEDGER_BYTE_LIMIT = 16 * 1024 * 1024;
const STATUS_SOURCE_VISUAL_LIMIT = 16_384;
const STATUS_SOURCE_IDENTITY_BYTE_LIMIT = 1024 * 1024;
const STATUS_FORMULA_MANIFEST_BYTE_LIMIT = 8 * 1024 * 1024;
const STATUS_HUMANIZER_MANIFEST_BYTE_LIMIT = 64 * 1024;
const STATUS_SCOPED_REPAIR_BYTE_LIMIT = 1024 * 1024;
const STATUS_VALIDATION_REPORT_PREFIX_BYTES = 256 * 1024;
const STATUS_DATABASE_JSON_BYTE_LIMIT = 16 * 1024 * 1024;
const STATUS_CONTRACT_NODE_LIMIT = 16_384;
const STATUS_CONTRACT_CONTAINER_LIMIT = 4_096;
const STATUS_CONTRACT_DEPTH_LIMIT = 64;
const STATUS_CONTRACT_STRING_BYTE_LIMIT = 64 * 1024;
const STATUS_CONTRACT_STRING_TOTAL_BYTE_LIMIT = 8 * 1024 * 1024;
const STATUS_SOURCE_ID_LIMIT = 16_384;
const STATUS_SOURCE_ID_BYTE_LIMIT = 4 * 1024;
const STATUS_JOB_MESSAGE_CHAR_LIMIT = 64 * 1024;
const STATUS_JOB_TITLE_CHAR_LIMIT = 4 * 1024;
const STATUS_MODEL_CHAR_LIMIT = 512;

type LearnMode =
  | "plan"
  | "generate"
  | "repair"
  | "full_rebuild"
  | "update_sources";

interface LearnModelRequestPolicyReceipt {
  model: string | null;
  reasoningEffort: string | null;
  reasoningSummary: string | null;
  observedCalls: number;
  consistent: boolean;
}

interface LearnTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  estimated: boolean;
  startedCalls: number;
  completedCalls: number;
  reportedCalls: number;
  unreportedCalls: number;
  inFlightCalls: number;
  requestPolicy?: LearnModelRequestPolicyReceipt;
}

interface LearnJob {
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
  requiresReplan: boolean;
  proposedLearningMapId?: string;
  confirmedLearningMapId?: string;
  latestTextbookVersionId?: string;
  sourceSetHash?: string;
  sourceIds: string[];
  syllabusSourceId?: string;
  sourceOnly: boolean;
  includeSourceSnapshots: boolean;
  pausedFromStatus?: LearnStatus;
  tokenUsage: LearnTokenUsage;
  elapsedMs: number;
  timerStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface SyllabusCoverage {
  units: Array<{ teachable?: unknown }>;
  resolutions: Array<{ status?: unknown }>;
  missingCitations: string[];
  evidenceRecovery?: unknown;
}

interface StoredLearningMap {
  id: string;
  gardenId: string;
  jobId: string;
  status: "proposed" | "confirmed";
  learningMap: ProposedLearningMap;
  coveragePlan: unknown;
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  sourceIds: string[];
  syllabusSourceId?: string;
  syllabusCoverage?: SyllabusCoverage | null;
}

interface LearnVersionRow {
  id: string;
  learning_map_id: string;
  source_set_hash: string;
  source_artifact_inventory_hash: string;
}

interface LearnJobRow {
  id: string;
  garden_id: string;
  user_id: number | null;
  model: string | null;
  status: LearnStatus;
  mode: string;
  current_step: string | null;
  progress_percent: number | null;
  current_section_title: string | null;
  current_page_title: string | null;
  error: string | null;
  requires_replan: number | null;
  proposed_learning_map_id: string | null;
  confirmed_learning_map_id: string | null;
  latest_textbook_version_id: string | null;
  source_set_hash: string | null;
  source_ids_json: string | null;
  syllabus_source_id: string | null;
  source_only: number | null;
  include_source_snapshots: number | null;
  paused_from_status: LearnStatus | null;
  active_elapsed_ms: number | null;
  timer_started_at: string | null;
  created_at: string;
  updated_at: string;
}

const LEARN_JOB_STATUS_COLUMN_SPECS = [
  ["id", "''"],
  ["garden_id", "''"],
  ["user_id", "NULL"],
  ["model", "NULL"],
  ["status", "'idle'"],
  ["mode", "'plan'"],
  ["current_step", "NULL"],
  ["progress_percent", "0"],
  ["current_section_title", "NULL"],
  ["current_page_title", "NULL"],
  ["error", "NULL"],
  ["requires_replan", "0"],
  ["proposed_learning_map_id", "NULL"],
  ["confirmed_learning_map_id", "NULL"],
  ["latest_textbook_version_id", "NULL"],
  ["source_set_hash", "NULL"],
  ["source_ids_json", "'[]'"],
  ["syllabus_source_id", "NULL"],
  ["source_only", "1"],
  ["include_source_snapshots", "0"],
  ["paused_from_status", "NULL"],
  ["active_elapsed_ms", "0"],
  ["timer_started_at", "NULL"],
  ["created_at", "''"],
  ["updated_at", "''"],
] as const;

interface LearnMapRow {
  id: string;
  garden_id: string;
  job_id: string;
  status: "proposed" | "confirmed";
  learning_map_json: string;
  coverage_plan_json: string;
  source_set_hash: string;
  source_artifact_inventory_hash?: string | null;
  source_ids_json?: string | null;
  syllabus_source_id?: string | null;
  syllabus_coverage_json?: string | null;
}

const LEARN_MAP_STATUS_COLUMN_SPECS = [
  ["id", "''"],
  ["garden_id", "''"],
  ["job_id", "''"],
  ["status", "'proposed'"],
  ["learning_map_json", "'{}'"],
  ["coverage_plan_json", "'{}'"],
  ["source_set_hash", "''"],
  ["source_artifact_inventory_hash", "''"],
  ["source_ids_json", "'[]'"],
  ["syllabus_source_id", "NULL"],
  ["syllabus_coverage_json", "NULL"],
] as const;

const LEARN_VERSION_STATUS_COLUMN_SPECS = [
  ["id", "''"],
  ["learning_map_id", "''"],
  ["source_set_hash", "''"],
  ["source_artifact_inventory_hash", "''"],
] as const;

const LEARN_TOKEN_STATUS_COLUMN_SPECS = [
  ["input_tokens", "0"],
  ["output_tokens", "0"],
  ["total_tokens", "0"],
  ["cached_input_tokens", "0"],
  ["reasoning_tokens", "0"],
  ["started_requests", "0"],
  ["completed_requests", "0"],
  ["reported_requests", "0"],
  ["estimated_requests", "0"],
  ["request_model", "NULL"],
  ["reasoning_effort", "NULL"],
  ["reasoning_summary", "NULL"],
  ["policy_observed_requests", "0"],
  ["policy_mismatch_requests", "0"],
] as const;

export interface LearnValidationReport {
  relativePath: string;
  url: string;
  markdown: string;
  truncated: boolean;
  accepted?: boolean;
  generatedAt?: string;
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

export interface LearnHumanizerVersionState {
  schemaVersion: 1;
  versionId: string;
  requested: boolean;
  activeCopy: "ai" | "humanized";
  status: "ai" | "running" | "humanized" | "restoring_ai" | "failed";
  reason?: string;
  error?: string;
  updatedAt: string;
}

export interface LearnStatusSnapshot {
  job: LearnJob | null;
  proposedLearningMap: ProposedLearningMap | null;
  confirmedLearningMapId?: string;
  confirmedLearningMapModel?: string;
  latestTextbookVersionId?: string;
  humanizer: LearnHumanizerVersionState | null;
  hasSources: boolean;
  sourceCount: number;
  selectedSourceIds: string[];
  selectedSourceCount: number;
  syllabusSourceId: string | null;
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

type Frontmatter = Record<string, string | string[]>;

interface StatusKnowledgeNode {
  slug: string;
  relPath: string;
  title: string;
  description: string;
  type: string;
  sourceType: string;
  sourceFile: string;
  sourcePdf: string;
  breadboardType: string;
  draft: string;
  generatedBy: string;
  generated_by: string;
  internal: string;
  sourceDocument: string;
  date: string;
  sourceImages: string[];
  sourceProjection?: StatusSourceProjection;
}

interface StatusFileIdentity {
  realPath: string;
  key: string;
  size: number;
  bodyStart: number;
}

interface StatusSourceProjection {
  identity: StatusFileIdentity;
  bodyHash: string | null;
  wordCount: number | null;
}

interface StatusSourceSummary extends LearnSourceSummary {
  statusFile: StatusFileIdentity;
  statusBodyHash: string | null;
}

interface StatusMarkdownProjection {
  node: StatusKnowledgeNode | null;
  incomplete: boolean;
}

interface StatusMarkdownEntry {
  entry: string;
  filePath: string;
  relPath: string;
  stat: Stats;
  identity: StatusFileIdentity;
}

interface StatusKnowledgeScan {
  sources: StatusSourceSummary[];
  hasTextbook: boolean;
  incomplete: boolean;
}

const statusSourceProjectionCache = new Map<
  string,
  StatusMarkdownProjection
>();
const statusMetadataProjectionCache = new Map<
  string,
  StatusMarkdownProjection
>();

type StatusSourceVisual = SourceVisual;
type StatusSourceIdentity = SourceVisualSourceIdentity;

interface SourceFormulaTopologyReviewPageReceipt {
  recoveryProtocol: "v5" | "v6" | "v7";
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  recoveryCacheKey: string;
  recoveryCacheIntegritySha256: string;
  topologyReviewCacheKey: string;
  topologyReviewCacheIntegritySha256: string;
  activeFormulaIds: string[];
}

interface SourceFormulaReviewSetManifest {
  schemaVersion: 1;
  promptVersion: 2;
  model: string;
  sourceIds: string[];
  sourceIdentityMap: StatusSourceIdentity[];
  sourceIdentityMapHash: string;
  formulaIds: string[];
  topologyReviewPageReceipts: SourceFormulaTopologyReviewPageReceipt[];
  reviewSetHash: string;
  baseSourceSetHash: string;
  combinedSourceSetHash: string;
  createdAt: string;
}

function tableExists(tableName: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function statusSelectColumns(
  tableName: string,
  specs: readonly (readonly [name: string, fallbackSql: string])[],
): string {
  if (!/^[a-z_]+$/.test(tableName)) {
    throw new Error("Invalid Learn status table name.");
  }
  const available = new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>)
      .flatMap((column) =>
        typeof column.name === "string" ? [column.name] : [],
      ),
  );
  return specs
    .map(([name, fallbackSql]) => {
      if (!/^[a-z_]+$/.test(name)) {
        throw new Error("Invalid Learn status column name.");
      }
      return available.has(name)
        ? `"${name}"`
        : `${fallbackSql} AS "${name}"`;
    })
    .join(", ");
}

function parseJson(value: string | null | undefined): unknown {
  if (
    !value ||
    Buffer.byteLength(value, "utf8") > STATUS_DATABASE_JSON_BYTE_LIMIT
  ) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSourceIds(value: string | null | undefined): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length > STATUS_SOURCE_ID_LIMIT) return [];
  const sourceIds = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== "string") continue;
    const sourceId = value.trim();
    if (
      !sourceId ||
      Buffer.byteLength(sourceId, "utf8") > STATUS_SOURCE_ID_BYTE_LIMIT
    ) {
      continue;
    }
    sourceIds.add(sourceId);
  }
  return [...sourceIds];
}

function normalizeLearnOperationMode(value: unknown): LearnMode {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "regenerate" || mode === "repair") return "repair";
  if (mode === "update") return "update_sources";
  if (
    mode === "plan" ||
    mode === "generate" ||
    mode === "full_rebuild" ||
    mode === "update_sources"
  ) {
    return mode;
  }
  throw new Error(`Unsupported Learn operation mode: ${mode || "(missing)"}`);
}

function emptyLearnTokenUsage(): LearnTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    estimated: false,
    startedCalls: 0,
    completedCalls: 0,
    reportedCalls: 0,
    unreportedCalls: 0,
    inFlightCalls: 0,
  };
}

function boundedPolicyField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function learnTokenUsageForJob(jobId: string): LearnTokenUsage {
  if (!tableExists("learn_job_token_usage")) return emptyLearnTokenUsage();
  const row = db
    .prepare(
      `SELECT ${statusSelectColumns(
        "learn_job_token_usage",
        LEARN_TOKEN_STATUS_COLUMN_SPECS,
      )}
       FROM learn_job_token_usage WHERE job_id = ?`,
    )
    .get(jobId) as Record<string, unknown> | undefined;
  if (!row) return emptyLearnTokenUsage();
  const startedCalls = Number(row.started_requests ?? 0);
  const completedCalls = Number(row.completed_requests ?? 0);
  const reportedCalls = Number(row.reported_requests ?? 0);
  const observedCalls = Math.max(0, Number(row.policy_observed_requests ?? 0));
  const requestPolicy = observedCalls > 0
    ? {
        model: boundedPolicyField(row.request_model, 128),
        reasoningEffort: boundedPolicyField(row.reasoning_effort, 32),
        reasoningSummary: boundedPolicyField(row.reasoning_summary, 32),
        observedCalls,
        consistent:
          Boolean(
            boundedPolicyField(row.request_model, 128) &&
              boundedPolicyField(row.reasoning_effort, 32) &&
              boundedPolicyField(row.reasoning_summary, 32),
          ) && Number(row.policy_mismatch_requests ?? 0) === 0,
      }
    : undefined;
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
    ...(requestPolicy ? { requestPolicy } : {}),
  };
}

function sumLearnTokenUsage(usages: Iterable<LearnTokenUsage>): LearnTokenUsage {
  const total = emptyLearnTokenUsage();
  const policies: LearnModelRequestPolicyReceipt[] = [];
  for (const usage of usages) {
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.totalTokens += usage.totalTokens;
    total.cachedInputTokens += usage.cachedInputTokens;
    total.reasoningTokens += usage.reasoningTokens;
    total.estimated ||= usage.estimated;
    total.startedCalls += usage.startedCalls;
    total.completedCalls += usage.completedCalls;
    total.reportedCalls += usage.reportedCalls;
    total.unreportedCalls += usage.unreportedCalls;
    total.inFlightCalls += usage.inFlightCalls;
    if (usage.requestPolicy && usage.requestPolicy.observedCalls > 0) {
      policies.push(usage.requestPolicy);
    }
  }
  const baseline = policies[0];
  if (baseline) {
    total.requestPolicy = {
      model: baseline.model,
      reasoningEffort: baseline.reasoningEffort,
      reasoningSummary: baseline.reasoningSummary,
      observedCalls: policies.reduce((sum, policy) => sum + policy.observedCalls, 0),
      consistent: policies.every(
        (policy) =>
          policy.consistent &&
          policy.model === baseline.model &&
          policy.reasoningEffort === baseline.reasoningEffort &&
          policy.reasoningSummary === baseline.reasoningSummary,
      ),
    };
  }
  return total;
}

function userFacingLearnText(value: string): string {
  const text = value
    .slice(0, STATUS_JOB_MESSAGE_CHAR_LIMIT)
    .replace(/\bChatMock\b/gi, "the AI service")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function boundedOptionalStatusText(
  value: string | null | undefined,
  maximumChars: number,
): string | undefined {
  return typeof value === "string" ? value.slice(0, maximumChars) : undefined;
}

function rowToJob(row: LearnJobRow | undefined): LearnJob | null {
  if (!row) return null;
  return {
    id: row.id,
    gardenId: row.garden_id,
    userId: row.user_id ?? undefined,
    model: row.model?.trim().slice(0, STATUS_MODEL_CHAR_LIMIT) || LEARN_MODEL,
    status: row.status,
    mode: normalizeLearnOperationMode(row.mode),
    currentStep: userFacingLearnText(row.current_step ?? ""),
    progressPercent: Number(row.progress_percent ?? 0),
    currentSectionTitle: boundedOptionalStatusText(
      row.current_section_title,
      STATUS_JOB_TITLE_CHAR_LIMIT,
    ),
    currentPageTitle: boundedOptionalStatusText(
      row.current_page_title,
      STATUS_JOB_TITLE_CHAR_LIMIT,
    ),
    error: row.error ? userFacingLearnText(row.error) : undefined,
    requiresReplan: Boolean(row.requires_replan ?? 0),
    proposedLearningMapId: row.proposed_learning_map_id ?? undefined,
    confirmedLearningMapId: row.confirmed_learning_map_id ?? undefined,
    latestTextbookVersionId: row.latest_textbook_version_id ?? undefined,
    sourceSetHash: row.source_set_hash ?? undefined,
    sourceIds: parseSourceIds(row.source_ids_json),
    syllabusSourceId: row.syllabus_source_id ?? undefined,
    sourceOnly: Boolean(row.source_only ?? 1),
    includeSourceSnapshots: Boolean(row.include_source_snapshots ?? 0),
    pausedFromStatus: row.paused_from_status ?? undefined,
    tokenUsage: learnTokenUsageForJob(row.id),
    elapsedMs: Math.max(0, Number(row.active_elapsed_ms ?? 0)),
    timerStartedAt: row.timer_started_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function latestLearnJob(gardenId: string): LearnJob | null {
  if (!tableExists("learn_jobs")) return null;
  return rowToJob(
    db
      .prepare(
        `SELECT ${statusSelectColumns("learn_jobs", LEARN_JOB_STATUS_COLUMN_SPECS)}
         FROM learn_jobs
         WHERE garden_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(gardenId) as LearnJobRow | undefined,
  );
}

function learnJobById(jobId: string): LearnJob | null {
  if (!tableExists("learn_jobs")) return null;
  return rowToJob(
    db.prepare(
      `SELECT ${statusSelectColumns("learn_jobs", LEARN_JOB_STATUS_COLUMN_SPECS)}
       FROM learn_jobs WHERE id = ?`,
    ).get(jobId) as
      | LearnJobRow
      | undefined,
  );
}

function rowToMap(row: LearnMapRow | undefined): StoredLearningMap | null {
  if (!row) return null;
  const learningMap = parseJson(row.learning_map_json) as ProposedLearningMap | null;
  if (
    !learningMap ||
    !Array.isArray(learningMap.sections) ||
    learningMap.sections.length === 0
  ) {
    return null;
  }
  return {
    id: row.id,
    gardenId: row.garden_id,
    jobId: row.job_id,
    status: row.status,
    learningMap,
    coveragePlan: parseJson(row.coverage_plan_json),
    sourceSetHash: row.source_set_hash,
    sourceArtifactInventoryHash: row.source_artifact_inventory_hash ?? "",
    sourceIds: parseSourceIds(row.source_ids_json),
    syllabusSourceId: row.syllabus_source_id ?? undefined,
    syllabusCoverage:
      (parseJson(row.syllabus_coverage_json) as SyllabusCoverage | null) ?? null,
  };
}

function learnMapById(mapId: string, gardenId: string): StoredLearningMap | null {
  if (!tableExists("learn_maps")) return null;
  return rowToMap(
    db
      .prepare(
        `SELECT ${statusSelectColumns("learn_maps", LEARN_MAP_STATUS_COLUMN_SPECS)}
         FROM learn_maps WHERE id = ? AND garden_id = ?`,
      )
      .get(mapId, gardenId) as LearnMapRow | undefined,
  );
}

function latestLearnMap(gardenId: string): StoredLearningMap | null {
  if (!tableExists("learn_maps")) return null;
  return rowToMap(
    db
      .prepare(
        `SELECT ${statusSelectColumns("learn_maps", LEARN_MAP_STATUS_COLUMN_SPECS)}
         FROM learn_maps WHERE garden_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(gardenId) as LearnMapRow | undefined,
  );
}

function latestConfirmedLearnMap(gardenId: string): StoredLearningMap | null {
  if (!tableExists("learn_maps")) return null;
  return rowToMap(
    db
      .prepare(
        `SELECT ${statusSelectColumns("learn_maps", LEARN_MAP_STATUS_COLUMN_SPECS)}
         FROM learn_maps WHERE garden_id = ? AND status = 'confirmed'
         ORDER BY confirmed_at DESC, created_at DESC LIMIT 1`,
      )
      .get(gardenId) as LearnMapRow | undefined,
  );
}

function latestLearnVersion(gardenId: string): LearnVersionRow | null {
  if (!tableExists("learn_versions")) return null;
  return (
    (db
      .prepare(
        `SELECT ${statusSelectColumns(
          "learn_versions",
          LEARN_VERSION_STATUS_COLUMN_SPECS,
        )}
         FROM learn_versions
         WHERE garden_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(gardenId) as LearnVersionRow | undefined) ?? null
  );
}

function learnMapPlanningJob(
  map: Pick<StoredLearningMap, "id" | "jobId">,
  gardenId: string,
): LearnJob | null {
  const planningJob = learnJobById(map.jobId);
  return planningJob?.gardenId === gardenId &&
    planningJob.proposedLearningMapId === map.id
    ? planningJob
    : null;
}

function learnTokenUsageForWorkflow(job: LearnJob): LearnTokenUsage {
  const jobIds = new Set([job.id]);
  const learningMapId = job.confirmedLearningMapId ?? job.proposedLearningMapId;
  if (learningMapId && tableExists("learn_maps")) {
    const owner = db
      .prepare("SELECT garden_id, job_id FROM learn_maps WHERE id = ?")
      .get(learningMapId) as
      | { garden_id: string; job_id: string }
      | undefined;
    if (owner?.garden_id === job.gardenId && owner.job_id) jobIds.add(owner.job_id);
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
  if (learningMapId && tableExists("learn_maps") && tableExists("learn_jobs")) {
    const owner = db
      .prepare(
        `SELECT j.id, j.active_elapsed_ms
         FROM learn_maps m
         JOIN learn_jobs j ON j.id = m.job_id
         WHERE m.id = ? AND m.garden_id = ?`,
      )
      .get(learningMapId, job.gardenId) as
      | { id: string; active_elapsed_ms: number | null }
      | undefined;
    if (owner && owner.id !== job.id) elapsedMs += Number(owner.active_elapsed_ms ?? 0);
  }
  return {
    elapsedMs,
    ...(job.timerStartedAt ? { timerStartedAt: job.timerStartedAt } : {}),
  };
}

function parseYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseYamlValue(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return parseYamlArray(trimmed);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(rawFrontmatter: string): Frontmatter {
  const data: Frontmatter = {};
  for (const line of rawFrontmatter.trim().split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    data[line.slice(0, index).trim()] = parseYamlValue(
      line.slice(index + 1).trim(),
    );
  }
  return data;
}

function frontmatterString(data: Frontmatter, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function frontmatterArray(data: Frontmatter, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? [value]
      : [];
}

function inferKnowledgeType(data: Frontmatter): string {
  const explicit = frontmatterString(data, "knowledge_type");
  if (explicit) {
    if (LEARNING_PAGE_TYPES.has(explicit)) return LEARNING_PAGE_TYPE;
    if (LEARNING_SECTION_TYPES.has(explicit)) return LEARNING_SECTION_TYPE;
    return explicit;
  }
  const tags = frontmatterArray(data, "tags");
  const source = frontmatterString(data, "source");
  const generatedBy = frontmatterString(data, "generated_by");
  if (
    tags.includes("generated") ||
    source === "generated-chat" ||
    generatedBy === "chatmock"
  ) {
    return "generated-note";
  }
  if (frontmatterString(data, "source_document")) return "knowledge-topic";
  if (source && !tags.includes("generated")) return "source-document";
  return "note";
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function statusGardenDirectory(
  contentPath: string,
  gardenId: string,
): string | null {
  const root = fs.realpathSync.native(path.resolve(contentPath));
  const candidate = path.resolve(root, gardenId.trim());
  if (!pathIsWithin(root, candidate)) {
    throw new Error("The Learn status garden is outside its content authority.");
  }
  if (!fs.existsSync(candidate)) return null;
  const candidateStat = fs.lstatSync(candidate);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) {
    throw new Error("The Learn status garden is not a regular directory.");
  }
  const canonical = fs.realpathSync.native(candidate);
  if (!pathIsWithin(root, canonical) || !fs.statSync(canonical).isDirectory()) {
    throw new Error("The Learn status garden is not a contained directory.");
  }
  return canonical;
}

function statusFileIdentity(realPath: string, stat: Stats): StatusFileIdentity {
  return {
    realPath,
    key: [
      realPath,
      stat.dev,
      stat.ino,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
    ].join("\0"),
    size: stat.size,
    bodyStart: 0,
  };
}

function sameStatusFile(stat: Stats, expected: Stats): boolean {
  return (
    stat.isFile() &&
    stat.dev === expected.dev &&
    stat.ino === expected.ino &&
    stat.size === expected.size &&
    stat.mtimeMs === expected.mtimeMs &&
    stat.ctimeMs === expected.ctimeMs
  );
}

function walkMarkdown(clusterDir: string): {
  entries: StatusMarkdownEntry[];
  incomplete: boolean;
} {
  const entries: StatusMarkdownEntry[] = [];
  const pending = [{ directory: clusterDir, relativeDirectory: "", depth: 0 }];
  let visited = 0;
  let incomplete = false;
  while (pending.length > 0) {
    const current = pending.pop()!;
    let directory: Dir;
    try {
      const directoryStat = fs.lstatSync(current.directory);
      const canonicalDirectory = fs.realpathSync.native(current.directory);
      if (
        !directoryStat.isDirectory() ||
        directoryStat.isSymbolicLink() ||
        (canonicalDirectory !== clusterDir &&
          !pathIsWithin(clusterDir, canonicalDirectory))
      ) {
        incomplete = true;
        continue;
      }
      directory = fs.opendirSync(canonicalDirectory);
    } catch {
      incomplete = true;
      continue;
    }
    try {
      for (;;) {
        const entry = directory.readSync();
        if (!entry) break;
        visited += 1;
        if (visited > STATUS_MARKDOWN_ENTRY_LIMIT) {
          incomplete = true;
          pending.length = 0;
          break;
        }
        if (entry.isSymbolicLink()) {
          incomplete = true;
          continue;
        }
        if (entry.isDirectory()) {
          if (entry.name === "assets" || entry.name.startsWith(".")) continue;
          if (current.depth >= STATUS_DIRECTORY_DEPTH_LIMIT) {
            incomplete = true;
            continue;
          }
          const relativeDirectory = current.relativeDirectory
            ? `${current.relativeDirectory}/${entry.name}`
            : entry.name;
          if (
            Buffer.byteLength(relativeDirectory, "utf8") >
            STATUS_RELATIVE_PATH_BYTE_LIMIT
          ) {
            incomplete = true;
            continue;
          }
          pending.push({
            directory: path.join(current.directory, entry.name),
            relativeDirectory,
            depth: current.depth + 1,
          });
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const lower = entry.name.toLowerCase();
        if (lower === "_index.md" || lower === "index.md") continue;
        const filePath = path.join(current.directory, entry.name);
        const relPath = current.relativeDirectory
          ? `${current.relativeDirectory}/${entry.name}`
          : entry.name;
        if (Buffer.byteLength(relPath, "utf8") > STATUS_RELATIVE_PATH_BYTE_LIMIT) {
          incomplete = true;
          continue;
        }
        try {
          const stat = fs.lstatSync(filePath);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            incomplete = true;
            continue;
          }
          const realPath = fs.realpathSync.native(filePath);
          if (!pathIsWithin(clusterDir, realPath)) {
            incomplete = true;
            continue;
          }
          entries.push({
            entry: entry.name,
            filePath,
            relPath,
            stat,
            identity: statusFileIdentity(realPath, stat),
          });
        } catch {
          incomplete = true;
        }
      }
    } finally {
      directory.closeSync();
    }
  }
  entries.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return { entries, incomplete };
}

function cachedMarkdownProjection(
  key: string,
): StatusMarkdownProjection | null {
  for (const cache of [
    statusSourceProjectionCache,
    statusMetadataProjectionCache,
  ]) {
    const cached = cache.get(key);
    if (!cached) continue;
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  return null;
}

function cacheMarkdownProjection(
  key: string,
  projection: StatusMarkdownProjection,
): void {
  const sourceProjection = Boolean(projection.node?.sourceProjection);
  const cache = sourceProjection
    ? statusSourceProjectionCache
    : statusMetadataProjectionCache;
  const limit = sourceProjection
    ? STATUS_SOURCE_CACHE_LIMIT
    : STATUS_METADATA_CACHE_LIMIT;
  cache.delete(key);
  cache.set(key, projection);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function readStatusPrefix(descriptor: number, fileSize: number): Buffer {
  const length = Math.min(fileSize, STATUS_FRONTMATTER_BYTE_LIMIT + 4);
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(descriptor, buffer, offset, length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  return offset === length ? buffer : buffer.subarray(0, offset);
}

function streamTrimmedStatusBody(
  descriptor: number,
  bodyStart: number,
  bodyEnd: number,
  onText?: (value: string) => void,
): { bodyHash: string; wordCount: number } {
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(STATUS_STREAM_CHUNK_BYTES);
  const hash = createHash("sha256");
  let position = bodyStart;
  let pendingWhitespace = "";
  let started = false;
  let inWord = false;
  let wordCount = 0;

  const emit = (value: string): void => {
    if (!value) return;
    hash.update(value);
    onText?.(value);
    for (const match of value.matchAll(/\s+|\S+/gu)) {
      if (/^\s+$/u.test(match[0])) {
        inWord = false;
      } else {
        if (!inWord) wordCount += 1;
        inWord = true;
      }
    }
  };
  const accept = (chunk: string): void => {
    let value = chunk;
    if (!started) {
      value = value.replace(/^\s+/u, "");
      if (!value) return;
      started = true;
    }
    const candidate = pendingWhitespace + value;
    pendingWhitespace = "";
    const trailing = candidate.match(/\s+$/u)?.[0] ?? "";
    const stable = trailing
      ? candidate.slice(0, candidate.length - trailing.length)
      : candidate;
    emit(stable);
    pendingWhitespace = trailing;
    if (Buffer.byteLength(pendingWhitespace, "utf8") > STATUS_PENDING_WHITESPACE_LIMIT) {
      throw new Error("The Learn status source contains an overlong whitespace run.");
    }
  };

  while (position < bodyEnd) {
    const count = fs.readSync(
      descriptor,
      buffer,
      0,
      Math.min(buffer.length, bodyEnd - position),
      position,
    );
    if (count === 0) {
      throw new Error("The Learn status source changed while reading.");
    }
    position += count;
    accept(decoder.write(buffer.subarray(0, count)));
  }
  accept(decoder.end());
  return { bodyHash: hash.digest("hex"), wordCount };
}

function readMarkdownProjection(
  entry: StatusMarkdownEntry,
  remainingSourceBytes: number,
): StatusMarkdownProjection {
  const cacheKey = `${entry.identity.key}\0${entry.relPath}`;
  const cached = cachedMarkdownProjection(cacheKey);
  if (cached) {
    const cachedSize = cached.node?.sourceProjection?.identity.size ?? 0;
    if (cachedSize > remainingSourceBytes) {
      return {
        node: cached.node?.sourceProjection
          ? {
              ...cached.node,
              sourceProjection: {
                ...cached.node.sourceProjection,
                bodyHash: null,
                wordCount: null,
              },
            }
          : cached.node,
        incomplete: true,
      };
    }
    return cached;
  }

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(entry.identity.realPath, "r");
    const opened = fs.fstatSync(descriptor);
    if (!sameStatusFile(opened, entry.stat)) {
      return { node: null, incomplete: true };
    }
    const prefix = readStatusPrefix(descriptor, opened.size);
    let data: Frontmatter = {};
    let bodyStart = 0;
    if (prefix.subarray(0, 3).equals(Buffer.from("---"))) {
      const end = prefix.indexOf(Buffer.from("\n---"), 3);
      if (end === -1) {
        if (opened.size > prefix.byteLength) {
          return { node: null, incomplete: true };
        }
      } else {
        if (end > STATUS_FRONTMATTER_BYTE_LIMIT) {
          return { node: null, incomplete: true };
        }
        data = parseFrontmatter(prefix.subarray(3, end).toString("utf8"));
        bodyStart = end + 4;
      }
    }
    const slug = entry.entry.replace(/\.md$/, "");
    const type = isInternalConceptMetadata(data, entry.relPath)
      ? "internal-concept"
      : inferKnowledgeType(data);
    const identity = { ...entry.identity, bodyStart };
    const node: StatusKnowledgeNode = {
      slug,
      relPath: entry.relPath,
      title: frontmatterString(data, "title") || slug,
      description: frontmatterString(data, "description"),
      type,
      sourceType: frontmatterString(data, "source_type"),
      sourceFile: frontmatterString(data, "source_file"),
      sourcePdf: frontmatterString(data, "source_pdf"),
      breadboardType: frontmatterString(data, "breadboardType"),
      draft: frontmatterString(data, "draft"),
      generatedBy: frontmatterString(data, "generatedBy"),
      generated_by: frontmatterString(data, "generated_by"),
      internal: frontmatterString(data, "internal"),
      sourceDocument: frontmatterString(data, "source_document"),
      date: frontmatterString(data, "date") || opened.mtime.toISOString(),
      sourceImages: frontmatterArray(data, "source_images"),
    };
    if (type !== "source-document" && !isLearnAuthoredLesson(node)) {
      const projection = { node: null, incomplete: false };
      cacheMarkdownProjection(cacheKey, projection);
      return projection;
    }
    if (type === "source-document") {
      const permitted = Math.min(
        STATUS_SOURCE_FILE_BYTE_LIMIT,
        remainingSourceBytes,
      );
      if (opened.size > permitted) {
        const projection: StatusMarkdownProjection = {
          node: {
            ...node,
            sourceProjection: { identity, bodyHash: null, wordCount: null },
          },
          incomplete: true,
        };
        if (opened.size > STATUS_SOURCE_FILE_BYTE_LIMIT) {
          cacheMarkdownProjection(cacheKey, projection);
        }
        return projection;
      }
      const body = streamTrimmedStatusBody(descriptor, bodyStart, opened.size);
      if (!sameStatusFile(fs.fstatSync(descriptor), opened)) {
        throw new Error("The Learn status source changed while reading.");
      }
      node.sourceProjection = { identity, ...body };
    }
    const projection = { node, incomplete: false };
    cacheMarkdownProjection(cacheKey, projection);
    return projection;
  } catch {
    return { node: null, incomplete: true };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function scanStatusKnowledge(
  contentPath: string,
  gardenId: string,
): StatusKnowledgeScan {
  const clusterDir = statusGardenDirectory(contentPath, gardenId);
  if (!clusterDir) return { sources: [], hasTextbook: false, incomplete: false };
  const walked = walkMarkdown(clusterDir);
  const nodes: StatusKnowledgeNode[] = [];
  let incomplete = walked.incomplete;
  let sourceBytes = 0;
  let frontmatterBytes = 0;
  for (const entry of walked.entries) {
    frontmatterBytes += Math.min(
      entry.identity.size,
      STATUS_FRONTMATTER_BYTE_LIMIT + 4,
    );
    if (frontmatterBytes > STATUS_FRONTMATTER_TOTAL_BYTE_LIMIT) {
      incomplete = true;
      break;
    }
    const projection = readMarkdownProjection(
      entry,
      Math.max(0, STATUS_SOURCE_TOTAL_BYTE_LIMIT - sourceBytes),
    );
    incomplete ||= projection.incomplete;
    if (!projection.node) continue;
    nodes.push(projection.node);
    if (projection.node.type === "source-document") {
      sourceBytes += projection.node.sourceProjection?.identity.size ?? 0;
      if (sourceBytes > STATUS_SOURCE_TOTAL_BYTE_LIMIT) incomplete = true;
    }
  }

  const sourcesByFile = new Map<string, StatusKnowledgeNode[]>();
  for (const node of nodes) {
    if (node.type !== "source-document" || node.sourceType === "url") continue;
    const identity = path
      .basename(node.sourceFile.trim())
      .normalize("NFKC")
      .toLocaleLowerCase();
    if (!identity) continue;
    const matches = sourcesByFile.get(identity) ?? [];
    matches.push(node);
    sourcesByFile.set(identity, matches);
  }
  const superseded = new Set<string>();
  for (const matches of sourcesByFile.values()) {
    if (matches.length < 2) continue;
    matches.sort(
      (left, right) =>
        (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0) ||
        right.relPath.localeCompare(left.relPath),
    );
    for (const node of matches.slice(1)) superseded.add(node.slug);
  }
  const visible = nodes.filter(
    (node) =>
      !superseded.has(node.slug) &&
      !superseded.has(node.sourceDocument),
  );
  const toSummary = (node: StatusKnowledgeNode): StatusSourceSummary => ({
    id: node.slug,
    slug: node.slug,
    title: node.title,
    description: node.description,
    relPath: node.relPath,
    sourceType: node.sourceType,
    sourceFile: node.sourceFile,
    sourcePdf: node.sourcePdf,
    date: node.date,
    wordCount: node.sourceProjection?.wordCount ?? 0,
    sourceImages: node.sourceImages,
    statusFile: node.sourceProjection!.identity,
    statusBodyHash: node.sourceProjection?.bodyHash ?? null,
  });
  return {
    sources: visible.filter((node) => node.type === "source-document").map(toSummary),
    hasTextbook: visible.some(isLearnAuthoredLesson),
    incomplete,
  };
}

function sourceSetHashForSources(sources: StatusSourceSummary[]): string {
  const stable = sources
    .map((source) => {
      if (!source.statusBodyHash) {
        throw new Error("The Learn status source fingerprint is unavailable.");
      }
      return {
        slug: source.slug,
        relPath: source.relPath,
        title: source.title,
        description: source.description ?? "",
        sourceFile: source.sourceFile ?? "",
        date: source.date ?? "",
        wordCount: source.wordCount ?? 0,
        bodyHash: source.statusBodyHash,
      };
    })
    .sort((left, right) => left.relPath.localeCompare(right.relPath));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function sourceSetHashWithSyllabus(
  baseHash: string,
  syllabus: StatusSourceSummary | null,
): string {
  if (!syllabus) return baseHash;
  const hash = createHash("sha256")
    .update(baseHash)
    .update("\0syllabus\0")
    .update(syllabus.slug)
    .update("\0")
    .update(syllabus.title ?? "")
    .update("\0")
    .update(syllabus.description ?? "")
    .update("\0")
    .update(syllabus.relPath ?? "")
    .update("\0")
    .update(syllabus.sourceFile ?? "")
    .update("\0");
  const descriptor = fs.openSync(syllabus.statusFile.realPath, "r");
  try {
    const stat = fs.fstatSync(descriptor);
    const actualIdentity = statusFileIdentity(syllabus.statusFile.realPath, stat);
    if (actualIdentity.key !== syllabus.statusFile.key || stat.size > STATUS_SOURCE_FILE_BYTE_LIMIT) {
      throw new Error("The Learn status syllabus changed during projection.");
    }
    streamTrimmedStatusBody(
      descriptor,
      syllabus.statusFile.bodyStart,
      stat.size,
      (value) => hash.update(value),
    );
    if (statusFileIdentity(syllabus.statusFile.realPath, fs.fstatSync(descriptor)).key !==
        syllabus.statusFile.key) {
      throw new Error("The Learn status syllabus changed during projection.");
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

function selectSources(
  sources: StatusSourceSummary[],
  sourceIds?: readonly string[],
): StatusSourceSummary[] {
  if (sourceIds === undefined) return sources;
  const requested = Array.from(
    new Set(sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean)),
  );
  if (requested.length === 0) throw new Error("Select at least one document for Learn.");
  const available = new Set(sources.map((source) => source.slug));
  if (requested.some((sourceId) => !available.has(sourceId))) {
    throw new Error("The saved Learn source selection is no longer available.");
  }
  const requestedSet = new Set(requested);
  return sources.filter((source) => requestedSet.has(source.slug));
}

function selectSyllabus(
  sources: StatusSourceSummary[],
  syllabusSourceId?: string | null,
): StatusSourceSummary | null {
  const requested = syllabusSourceId?.trim() ?? "";
  if (!requested) return null;
  const syllabus = sources.find((source) => source.slug === requested);
  if (!syllabus) throw new Error("The saved Learn syllabus is no longer available.");
  return syllabus;
}

function persistedLearnSelection(
  latestJob: LearnJob | null,
  jobBoundMap: StoredLearningMap | null,
  confirmedMap: StoredLearningMap | null,
): {
  sourceIds: string[];
  syllabusSourceId: string | null;
  syllabusCoverage: SyllabusCoverage | null;
} | null {
  const owner = latestJob ?? jobBoundMap ?? confirmedMap;
  if (!owner) return null;
  const syllabusSourceId = owner.syllabusSourceId?.trim() || null;
  const boundMapSyllabusSourceId = jobBoundMap?.syllabusSourceId?.trim() || null;
  const boundMapId = latestJob
    ? latestJob.proposedLearningMapId ?? latestJob.confirmedLearningMapId
    : undefined;
  const coverageStatuses = new Set([
    "awaiting_confirmation",
    "generating_learning_pages",
    "generating_textbook",
    "generating_visuals",
    "writing_quartz",
    "building_navigation",
    "paused",
    "complete",
  ]);
  const latestJobOwnsCoverage = Boolean(
    latestJob &&
      coverageStatuses.has(latestJob.status) &&
      boundMapId === jobBoundMap?.id &&
      latestJob.sourceIds.length === jobBoundMap?.sourceIds.length &&
      latestJob.sourceIds.every(
        (sourceId, index) => sourceId === jobBoundMap?.sourceIds[index],
      ) &&
      syllabusSourceId === boundMapSyllabusSourceId,
  );
  const syllabusCoverage = latestJob
    ? latestJobOwnsCoverage
      ? (jobBoundMap?.syllabusCoverage ?? null)
      : null
    : ("syllabusCoverage" in owner ? owner.syllabusCoverage : null) ?? null;
  return {
    sourceIds: [...owner.sourceIds],
    syllabusSourceId,
    syllabusCoverage: syllabusSourceId ? syllabusCoverage : null,
  };
}

function planningRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function statusContractShapeIsBounded(value: unknown): boolean {
  const frames: Array<{
    values: unknown[];
    index: number;
    depth: number;
  }> = [{ values: [value], index: 0, depth: 0 }];
  let nodes = 0;
  let stringBytes = 0;
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    if (frame.index >= frame.values.length) {
      frames.pop();
      continue;
    }
    const node = frame.values[frame.index++];
    nodes += 1;
    if (nodes > STATUS_CONTRACT_NODE_LIMIT) return false;
    if (typeof node === "string") {
      const bytes = Buffer.byteLength(node, "utf8");
      stringBytes += bytes;
      if (
        bytes > STATUS_CONTRACT_STRING_BYTE_LIMIT ||
        stringBytes > STATUS_CONTRACT_STRING_TOTAL_BYTE_LIMIT
      ) {
        return false;
      }
      continue;
    }
    if (!node || typeof node !== "object") continue;
    if (frame.depth >= STATUS_CONTRACT_DEPTH_LIMIT) return false;
    const values = Array.isArray(node)
      ? node
      : Object.values(node as Record<string, unknown>);
    if (values.length > STATUS_CONTRACT_CONTAINER_LIMIT) return false;
    frames.push({ values, index: 0, depth: frame.depth + 1 });
  }
  return true;
}

function sourceFormulaReviewSetHashFromCoveragePlan(value: unknown): string | undefined {
  const candidate = planningRecord(value).sourceFormulaReviewSetHash;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function isStatusSyllabusCoverage(
  value: unknown,
): value is SyllabusCoverage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const coverage = value as Record<string, unknown>;
  return (
    Array.isArray(coverage.units) &&
    coverage.units.length <= STATUS_CONTRACT_CONTAINER_LIMIT &&
    coverage.units.every(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    ) &&
    Array.isArray(coverage.resolutions) &&
    coverage.resolutions.length <= STATUS_CONTRACT_CONTAINER_LIMIT &&
    coverage.resolutions.every(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    ) &&
    Array.isArray(coverage.missingCitations) &&
    coverage.missingCitations.length <= STATUS_CONTRACT_CONTAINER_LIMIT &&
    coverage.missingCitations.every((entry) => typeof entry === "string") &&
    statusContractShapeIsBounded(value)
  );
}

function isContractBackedLearningMap(
  map: StoredLearningMap | null | undefined,
): map is StoredLearningMap {
  if (!map || !SHA256.test(map.sourceArtifactInventoryHash)) return false;
  const coverage = planningRecord(map.coveragePlan);
  const coverageHash = coverage.sourceArtifactInventoryHash;
  if (
    typeof coverageHash !== "string" ||
    !SHA256.test(coverageHash) ||
    coverageHash.toLowerCase() !== map.sourceArtifactInventoryHash.toLowerCase()
  ) {
    return false;
  }
  const learningUnits = coverage.learningUnitContracts;
  if (
    !Array.isArray(learningUnits) ||
    learningUnits.length === 0 ||
    !statusContractShapeIsBounded(learningUnits) ||
    modelAuthoredLearningUnitParseProblems({ learningUnits }).length > 0
  ) {
    return false;
  }
  if (Boolean(map.syllabusSourceId) !== Boolean(map.syllabusCoverage)) return false;
  if (
    map.syllabusCoverage &&
    (!isStatusSyllabusCoverage(map.syllabusCoverage) ||
      !map.syllabusCoverage.units.some((unit) => unit.teachable))
  ) {
    return false;
  }
  const persistedRecovery = map.syllabusCoverage?.evidenceRecovery;
  const plannedRecovery = coverage.syllabusCoverageEvidenceRecovery;
  if (
    (persistedRecovery !== undefined) !==
    (plannedRecovery !== undefined)
  ) {
    return false;
  }
  if (persistedRecovery !== undefined) {
    if (
      !persistedRecovery ||
      typeof persistedRecovery !== "object" ||
      Array.isArray(persistedRecovery)
    ) {
      return false;
    }
    const receipt = persistedRecovery as Record<string, unknown>;
    if (
      receipt.outcome !== "recovered" ||
      typeof receipt.integritySha256 !== "string" ||
      !LOWERCASE_SHA256.test(receipt.integritySha256) ||
      coverage.syllabusCoverageEvidenceRecoveryHash !== receipt.integritySha256 ||
      JSON.stringify(plannedRecovery) !== JSON.stringify(receipt)
    ) {
      return false;
    }
  } else if (
    coverage.syllabusCoverageEvidenceRecoveryHash !== undefined &&
    coverage.syllabusCoverageEvidenceRecoveryHash !== ""
  ) {
    return false;
  }
  return true;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readBoundedStatusFile(
  filePath: string,
  maximumBytes: number,
  authorityRoot?: string,
): string | null {
  let descriptor: number | undefined;
  try {
    const before = fs.lstatSync(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size > maximumBytes
    ) {
      throw new Error("The Learn status artifact exceeds its read boundary.");
    }
    const realPath = fs.realpathSync.native(filePath);
    if (authorityRoot && !pathIsWithin(authorityRoot, realPath)) {
      throw new Error("The Learn status artifact is outside its garden authority.");
    }
    descriptor = fs.openSync(realPath, "r");
    const opened = fs.fstatSync(descriptor);
    if (!sameStatusFile(opened, before)) {
      throw new Error("The Learn status artifact changed while opening.");
    }
    const buffer = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (count === 0) break;
      offset += count;
    }
    if (
      offset !== opened.size ||
      !sameStatusFile(fs.fstatSync(descriptor), opened)
    ) {
      throw new Error("The Learn status artifact changed while reading.");
    }
    return buffer.toString("utf8");
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === "ENOENT") return null;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readBoundedStatusJson(
  filePath: string,
  maximumBytes: number,
  authorityRoot?: string,
): unknown | null {
  const raw = readBoundedStatusFile(filePath, maximumBytes, authorityRoot);
  if (raw === null) return null;
  return JSON.parse(raw) as unknown;
}

function readStatusFilePrefix(
  filePath: string,
  maximumBytes: number,
  authorityRoot?: string,
): { text: string; truncated: boolean } | null {
  let descriptor: number | undefined;
  try {
    const before = fs.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error("The Learn status artifact is not a regular file.");
    }
    const realPath = fs.realpathSync.native(filePath);
    if (authorityRoot && !pathIsWithin(authorityRoot, realPath)) {
      throw new Error("The Learn status artifact is outside its garden authority.");
    }
    descriptor = fs.openSync(realPath, "r");
    const opened = fs.fstatSync(descriptor);
    if (!sameStatusFile(opened, before)) {
      throw new Error("The Learn status artifact changed while opening.");
    }
    const length = Math.min(opened.size, maximumBytes);
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const count = fs.readSync(descriptor, buffer, offset, length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (!sameStatusFile(fs.fstatSync(descriptor), opened)) {
      throw new Error("The Learn status artifact changed while reading.");
    }
    const truncated = opened.size > offset;
    const decoder = new StringDecoder("utf8");
    const text = decoder.write(buffer.subarray(0, offset)) +
      (truncated ? "" : decoder.end());
    return { text, truncated };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === "ENOENT") return null;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function loadSourceVisuals(
  contentPath: string,
  gardenId: string,
): StatusSourceVisual[] {
  const gardenDir = statusGardenDirectory(contentPath, gardenId);
  if (!gardenDir) return [];
  const parsed = readBoundedStatusJson(
    path.join(gardenDir, ".breadboard", "source-visuals.json"),
    STATUS_SOURCE_VISUAL_LEDGER_BYTE_LIMIT,
    gardenDir,
  );
  if (parsed === null) return [];
  if (!Array.isArray(parsed)) {
    throw new Error("The Learn source-visual ledger is not an array.");
  }
  if (parsed.length > STATUS_SOURCE_VISUAL_LIMIT) {
    throw new Error("The Learn source-visual ledger exceeds its entry boundary.");
  }
  return parsed as StatusSourceVisual[];
}

function normalizedSourceIdentityMap(
  value: readonly StatusSourceIdentity[],
): StatusSourceIdentity[] {
  if (value.length > STATUS_SOURCE_VISUAL_LIMIT) {
    throw new Error("Source-visual source identity map exceeds its entry boundary.");
  }
  const sourceIds = new Set<string>();
  const indexes = new Set<number>();
  const normalized = value.map((entry) => {
    const sourceId = typeof entry?.sourceId === "string" ? entry.sourceId.trim() : "";
    const sourceIndex = Number(entry?.sourceIndex);
    if (!sourceId || !Number.isSafeInteger(sourceIndex) || sourceIndex < 1) {
      throw new Error("Source-visual source identity entry is invalid.");
    }
    if (sourceIds.has(sourceId) || indexes.has(sourceIndex)) {
      throw new Error("Source-visual source identity map contains a duplicate.");
    }
    sourceIds.add(sourceId);
    indexes.add(sourceIndex);
    return { sourceId, sourceIndex };
  });
  return normalized.sort(
    (left, right) =>
      left.sourceIndex - right.sourceIndex || left.sourceId.localeCompare(right.sourceId),
  );
}

function sourceIdentityMapHash(value: readonly StatusSourceIdentity[]): string {
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      sourceIdentityMap: normalizedSourceIdentityMap(value),
    }),
  );
}

function resolveSourceIdentityMap(
  contentPath: string,
  gardenId: string,
  sourceIds: readonly string[],
  visuals: readonly StatusSourceVisual[],
): StatusSourceIdentity[] {
  const normalizedSourceIds = sourceIds.map((sourceId) => sourceId.trim());
  if (
    normalizedSourceIds.some((sourceId) => !sourceId) ||
    new Set(normalizedSourceIds).size !== normalizedSourceIds.length
  ) {
    throw new Error(
      "Source-visual source identity resolution requires unique non-empty source ids.",
    );
  }
  const gardenDir = statusGardenDirectory(contentPath, gardenId);
  if (!gardenDir) {
    throw new Error("The Learn status garden is unavailable.");
  }
  const registryPath = path.join(
    gardenDir,
    ".breadboard",
    "source-visual-source-index.json",
  );
  let stored: StatusSourceIdentity[] = [];
  const registry = readBoundedStatusJson(
    registryPath,
    STATUS_SOURCE_IDENTITY_BYTE_LIMIT,
    gardenDir,
  );
  if (registry !== null) {
    if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
      throw new Error("Source-visual source identity registry is invalid.");
    }
    const parsed = registry as {
      schemaVersion?: unknown;
      sourceIdentityMap?: unknown;
    };
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sourceIdentityMap)) {
      throw new Error("Source-visual source identity registry has an invalid schema.");
    }
    stored = normalizedSourceIdentityMap(
      parsed.sourceIdentityMap as StatusSourceIdentity[],
    );
    if (JSON.stringify(stored) !== JSON.stringify(parsed.sourceIdentityMap)) {
      throw new Error("Source-visual source identity registry is not canonical.");
    }
  }
  const bySource = new Map(stored.map((entry) => [entry.sourceId, entry.sourceIndex]));
  const byIndex = new Map(stored.map((entry) => [entry.sourceIndex, entry.sourceId]));
  for (const visual of visuals) {
    if (typeof visual.sourceVisualId !== "string") {
      throw new Error("Source-visual ledger has an invalid visual id.");
    }
    const match = /^S([1-9]\d*)\.P[1-9]\d*\.[A-Z][1-9]\d*$/i.exec(
      visual.sourceVisualId.trim(),
    );
    const sourceId = typeof visual.sourceId === "string" ? visual.sourceId.trim() : "";
    if (!match || !sourceId) continue;
    const sourceIndex = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 1) continue;
    if (
      (bySource.has(sourceId) && bySource.get(sourceId) !== sourceIndex) ||
      (byIndex.has(sourceIndex) && byIndex.get(sourceIndex) !== sourceId)
    ) {
      throw new Error("Source-visual ledger conflicts with its identity registry.");
    }
    bySource.set(sourceId, sourceIndex);
    byIndex.set(sourceIndex, sourceId);
  }
  let nextIndex = 1;
  for (const sourceIndex of byIndex.keys()) {
    nextIndex = Math.max(nextIndex, sourceIndex + 1);
  }
  for (const sourceId of normalizedSourceIds) {
    if (bySource.has(sourceId)) continue;
    if (!Number.isSafeInteger(nextIndex)) {
      throw new Error("Source-visual source identity index is exhausted.");
    }
    bySource.set(sourceId, nextIndex++);
  }
  return normalizedSourceIdentityMap(
    Array.from(bySource, ([sourceId, sourceIndex]) => ({ sourceId, sourceIndex })),
  );
}

function pageNumberFromAssetUrl(assetUrl: string): number | undefined {
  const match = assetUrl.match(
    /-page-(\d{1,5})(?:-\d+)?\.(?:png|jpe?g|webp)$/i,
  );
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function normalizeTopologyReceipts(
  value: unknown,
): SourceFormulaTopologyReviewPageReceipt[] {
  if (!Array.isArray(value)) throw new Error("Formula topology receipts must be an array.");
  if (value.length > STATUS_SOURCE_VISUAL_LIMIT) {
    throw new Error("Formula topology receipts exceed their entry boundary.");
  }
  const pages = new Set<string>();
  const receipts = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Formula topology receipt is invalid.");
    }
    const record = item as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(record).sort()) !==
      JSON.stringify([
        "activeFormulaIds",
        "pageImagePath",
        "pageNumber",
        "recoveryCacheIntegritySha256",
        "recoveryCacheKey",
        "recoveryProtocol",
        "sourceId",
        "topologyReviewCacheIntegritySha256",
        "topologyReviewCacheKey",
      ])
    ) {
      throw new Error("Formula topology receipt has unsupported or missing fields.");
    }
    const sourceId = typeof record.sourceId === "string" ? record.sourceId.trim() : "";
    const pageNumber = record.pageNumber;
    const pageImagePath =
      typeof record.pageImagePath === "string" ? record.pageImagePath.trim() : "";
    const recoveryProtocol = record.recoveryProtocol;
    const recoveryCacheKey =
      typeof record.recoveryCacheKey === "string"
        ? record.recoveryCacheKey.trim()
        : "";
    const recoveryCacheIntegritySha256 =
      typeof record.recoveryCacheIntegritySha256 === "string"
        ? record.recoveryCacheIntegritySha256.trim()
        : "";
    const topologyReviewCacheKey =
      typeof record.topologyReviewCacheKey === "string"
        ? record.topologyReviewCacheKey.trim()
        : "";
    const topologyReviewCacheIntegritySha256 =
      typeof record.topologyReviewCacheIntegritySha256 === "string"
        ? record.topologyReviewCacheIntegritySha256.trim()
        : "";
    const activeFormulaIds = Array.isArray(record.activeFormulaIds)
      ? record.activeFormulaIds.map((entry) =>
          typeof entry === "string" ? entry.trim() : null,
        )
      : [];
    if (
      !sourceId ||
      (recoveryProtocol !== "v5" &&
        recoveryProtocol !== "v6" &&
        recoveryProtocol !== "v7") ||
      !Number.isSafeInteger(pageNumber) ||
      (pageNumber as number) < 1 ||
      !pageImagePath ||
      pageNumberFromAssetUrl(pageImagePath) !== pageNumber ||
      !SHA256.test(recoveryCacheKey) ||
      !SHA256.test(recoveryCacheIntegritySha256) ||
      !SHA256.test(topologyReviewCacheKey) ||
      !SHA256.test(topologyReviewCacheIntegritySha256) ||
      !Array.isArray(record.activeFormulaIds) ||
      activeFormulaIds.some((formulaId) => formulaId === null) ||
      activeFormulaIds.some((formulaId) => {
        const match = /^S\d+\.P(\d+)\.E\d+$/.exec(formulaId ?? "");
        return !match || Number.parseInt(match[1]!, 10) !== pageNumber;
      }) ||
      JSON.stringify(activeFormulaIds) !==
        JSON.stringify([...new Set(activeFormulaIds)].sort())
    ) {
      throw new Error("Formula topology receipt is invalid.");
    }
    const pageKey = `${sourceId}\0${pageNumber}`;
    if (pages.has(pageKey)) throw new Error("Formula topology receipt is duplicated.");
    pages.add(pageKey);
    return {
      recoveryProtocol: recoveryProtocol as "v5" | "v6" | "v7",
      sourceId,
      pageNumber: pageNumber as number,
      pageImagePath,
      recoveryCacheKey,
      recoveryCacheIntegritySha256,
      topologyReviewCacheKey,
      topologyReviewCacheIntegritySha256,
      activeFormulaIds: activeFormulaIds as string[],
    };
  });
  return receipts.sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) ||
      left.pageNumber - right.pageNumber ||
      left.pageImagePath.localeCompare(right.pageImagePath),
  );
}

function sourceSetHashWithReviewedFormulas(
  baseSourceSetHash: string,
  reviewSetHash: string,
): string {
  if (!baseSourceSetHash.trim() || !reviewSetHash.trim()) {
    throw new Error(
      "Base source-set hash and reviewed-formula-set hash are both required.",
    );
  }
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      baseSourceSetHash,
      sourceFormulaReviewSetHash: reviewSetHash,
    }),
  );
}

function loadFormulaManifest(
  contentPath: string,
  gardenId: string,
): SourceFormulaReviewSetManifest | null {
  try {
    const gardenDir = statusGardenDirectory(contentPath, gardenId);
    if (!gardenDir) return null;
    const value = readBoundedStatusJson(
      path.join(
        gardenDir,
        ".breadboard",
        "source-formula-review-set.json",
      ),
      STATUS_FORMULA_MANIFEST_BYTE_LIMIT,
      gardenDir,
    );
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !statusContractShapeIsBounded(value)
    ) {
      return null;
    }
    const parsed = value as SourceFormulaReviewSetManifest;
    const receipts = normalizeTopologyReceipts(parsed.topologyReviewPageReceipts);
    if (
      parsed.schemaVersion !== SOURCE_FORMULA_REVIEW_SCHEMA_VERSION ||
      parsed.promptVersion !== SOURCE_FORMULA_REVIEW_PROMPT_VERSION ||
      typeof parsed.model !== "string" ||
      !Array.isArray(parsed.sourceIds) ||
      parsed.sourceIds.length > STATUS_SOURCE_VISUAL_LIMIT ||
      !Array.isArray(parsed.sourceIdentityMap) ||
      parsed.sourceIdentityMap.length > STATUS_SOURCE_VISUAL_LIMIT ||
      typeof parsed.sourceIdentityMapHash !== "string" ||
      parsed.sourceIds.some(
        (sourceId) => typeof sourceId !== "string" || !sourceId.trim(),
      ) ||
      new Set(parsed.sourceIds).size !== parsed.sourceIds.length ||
      sourceIdentityMapHash(parsed.sourceIdentityMap) !== parsed.sourceIdentityMapHash ||
      !Array.isArray(parsed.formulaIds) ||
      parsed.formulaIds.length > STATUS_SOURCE_VISUAL_LIMIT ||
      parsed.formulaIds.some(
        (formulaId) => typeof formulaId !== "string" || !formulaId.trim(),
      ) ||
      JSON.stringify(parsed.formulaIds) !==
        JSON.stringify([...new Set(parsed.formulaIds)].sort()) ||
      JSON.stringify(parsed.topologyReviewPageReceipts) !== JSON.stringify(receipts) ||
      typeof parsed.reviewSetHash !== "string" ||
      typeof parsed.baseSourceSetHash !== "string" ||
      typeof parsed.combinedSourceSetHash !== "string" ||
      parsed.combinedSourceSetHash !==
        sourceSetHashWithReviewedFormulas(parsed.baseSourceSetHash, parsed.reviewSetHash)
    ) {
      return null;
    }
    return { ...parsed, topologyReviewPageReceipts: receipts };
  } catch {
    return null;
  }
}

function sourceFormulaStableRecord(visual: StatusSourceVisual): Record<string, unknown> {
  const review = visual.formulaReview;
  if (!review || visual.type !== "equation" || !visual.exactText?.trim()) {
    throw new Error("Source formula has no accepted review provenance.");
  }
  return {
    sourceVisualId: visual.sourceVisualId,
    sourceId: visual.sourceId,
    pageNumber: visual.pageNumber,
    bbox: visual.bbox,
    pageImagePath: visual.pageImagePath,
    croppedImagePath: visual.croppedImagePath,
    acceptedExactText: visual.exactText.trim(),
    acceptedCaption: visual.caption.trim(),
    decision: review.decision,
    identityAssessment: review.identityAssessment,
    schemaVersion: review.schemaVersion,
    promptVersion: review.promptVersion,
    model: review.model,
    pageImageSha256: review.pageImageSha256,
    equationCropSha256: review.equationCropSha256,
    canonicalPageTextSha256: review.canonicalPageTextSha256,
    sourcePdfSha256: review.sourcePdfSha256,
    reviewedPageImagePath: review.reviewedPageImagePath,
    reviewedEquationCropPath: review.reviewedEquationCropPath,
    cacheKey: review.cacheKey,
    artifactRecovery: review.artifactRecovery ?? null,
    artifactTopologyRecovery: review.artifactTopologyRecovery ?? null,
    artifactTopologyCandidateRepair: review.artifactTopologyCandidateRepair ?? null,
    artifactTopologyConsensusRepair: review.artifactTopologyConsensusRepair ?? null,
  };
}

function computeFormulaReviewSetHash(
  visuals: readonly StatusSourceVisual[],
  requiredFormulaIds: readonly string[],
  selectedSourceIds: readonly string[],
  sourceIdentityMap: readonly StatusSourceIdentity[],
  receipts: readonly SourceFormulaTopologyReviewPageReceipt[],
): string {
  const formulaIds = [...new Set(requiredFormulaIds.map((id) => id.trim()).filter(Boolean))]
    .sort();
  const byId = new Map<string, StatusSourceVisual>();
  const duplicateIds = new Set<string>();
  for (const visual of visuals) {
    if (byId.has(visual.sourceVisualId)) duplicateIds.add(visual.sourceVisualId);
    byId.set(visual.sourceVisualId, visual);
  }
  const relevantDuplicates = formulaIds.filter((formulaId) =>
    duplicateIds.has(formulaId),
  );
  if (relevantDuplicates.length > 0) {
    throw new Error("Duplicate required source formula ids exist.");
  }
  const records = formulaIds.map((formulaId) => {
    const visual = byId.get(formulaId);
    if (!visual) throw new Error("Required source formula is missing.");
    return sourceFormulaStableRecord(visual);
  });
  const normalizedReceipts = normalizeTopologyReceipts(receipts);
  const selectedSourceIdSet = new Set(selectedSourceIds);
  const formulaIdSet = new Set(formulaIds);
  const activeFormulaIdsByPage = new Map<string, string[]>();
  for (const visual of visuals) {
    if (visual.type !== "equation") continue;
    const pageKey = `${visual.sourceId}\0${visual.pageNumber}`;
    const active = activeFormulaIdsByPage.get(pageKey) ?? [];
    active.push(visual.sourceVisualId);
    activeFormulaIdsByPage.set(pageKey, active);
  }
  for (const active of activeFormulaIdsByPage.values()) active.sort();
  for (const receipt of normalizedReceipts) {
    if (selectedSourceIds.length > 0 && !selectedSourceIdSet.has(receipt.sourceId)) {
      throw new Error("Formula topology receipt belongs to an unselected source.");
    }
    const projectedActiveIds =
      activeFormulaIdsByPage.get(`${receipt.sourceId}\0${receipt.pageNumber}`) ?? [];
    if (
      JSON.stringify(projectedActiveIds) !==
        JSON.stringify(receipt.activeFormulaIds) ||
      receipt.activeFormulaIds.some((formulaId) => !formulaIdSet.has(formulaId))
    ) {
      throw new Error(
        "Formula topology receipt does not match the active formula inventory.",
      );
    }
  }
  return sha256(
    JSON.stringify({
      schemaVersion: SOURCE_FORMULA_REVIEW_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_REVIEW_PROMPT_VERSION,
      topologyReceiptBindingVersion: 2,
      selectedSourceIds,
      sourceIdentityMapHash: sourceIdentityMapHash(sourceIdentityMap),
      formulaIds,
      records,
      topologyReviewPageReceipts: normalizedReceipts,
    }),
  );
}

function readLearnHumanizerVersionState(
  gardenDir: string,
  versionId: string,
): LearnHumanizerVersionState {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(versionId)) {
    throw new Error("Invalid Learn version id for humanizer state");
  }
  try {
    const authorityRoot = fs.realpathSync.native(gardenDir);
    const parsed = readBoundedStatusJson(
      path.join(
        authorityRoot,
        ".breadboard",
        "humanizer",
        versionId,
        "manifest.json",
      ),
      STATUS_HUMANIZER_MANIFEST_BYTE_LIMIT,
      authorityRoot,
    ) as Partial<LearnHumanizerVersionState> | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !statusContractShapeIsBounded(parsed)
    ) {
      throw new Error("The Learn humanizer manifest is invalid.");
    }
    const activeCopy = parsed.activeCopy === "humanized" ? "humanized" : "ai";
    const allowed = ["ai", "running", "humanized", "restoring_ai", "failed"];
    const status = allowed.includes(String(parsed.status))
      ? (parsed.status as LearnHumanizerVersionState["status"])
      : activeCopy;
    if (parsed.schemaVersion === 1 && parsed.versionId === versionId) {
      return {
        schemaVersion: 1,
        versionId,
        requested: parsed.requested === true,
        activeCopy,
        status,
        ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
        ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
        updatedAt:
          typeof parsed.updatedAt === "string"
            ? parsed.updatedAt
            : new Date(0).toISOString(),
      };
    }
  } catch {
    // Old versions have no reversible-humanizer marker and are normal AI copies.
  }
  return {
    schemaVersion: 1,
    versionId,
    requested: false,
    activeCopy: "ai",
    status: "ai",
    updatedAt: new Date(0).toISOString(),
  };
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
  const relativePath = ".breadboard/validation-report.md";
  let projection: { text: string; truncated: boolean } | null;
  try {
    const gardenDir = statusGardenDirectory(contentPath, gardenId);
    if (!gardenDir) return null;
    projection = readStatusFilePrefix(
      path.join(gardenDir, relativePath),
      STATUS_VALIDATION_REPORT_PREFIX_BYTES,
      gardenDir,
    );
  } catch {
    return null;
  }
  if (!projection) return null;
  const markdown = projection.text;
  const generatedAt = markdown.match(/^Generated:\s*(.+)$/m)?.[1]?.trim();
  const acceptedRaw = markdown
    .match(/^Accepted:\s*(yes|no)$/m)?.[1]
    ?.trim()
    .toLowerCase();
  const truncated = projection.truncated || markdown.length > maxChars;
  return {
    relativePath,
    url: `/api/gardens/${encodeURIComponent(gardenId)}/learn/validation-report`,
    markdown: truncated
      ? `${markdown.slice(0, maxChars).replace(/\s+$/, "")}\n\n[report truncated in dialog]`
      : markdown,
    truncated,
    ...(acceptedRaw ? { accepted: acceptedRaw === "yes" } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  };
}

function getLearnScopedRepairSummary(
  gardenId: string,
  contentPath: string,
): LearnScopedRepairSummary | null {
  try {
    const gardenDir = statusGardenDirectory(contentPath, gardenId);
    if (!gardenDir) return null;
    const parsed = readBoundedStatusJson(
      path.join(gardenDir, ".breadboard", "scoped-repair.json"),
      STATUS_SCOPED_REPAIR_BYTE_LIMIT,
      gardenDir,
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !statusContractShapeIsBounded(parsed)
    ) {
      return null;
    }
    const raw = parsed as Record<string, unknown>;
    const scope =
      raw.scope && typeof raw.scope === "object"
        ? (raw.scope as Record<string, unknown>)
        : {};
    const policy =
      raw.policy && typeof raw.policy === "object"
        ? (raw.policy as Record<string, unknown>)
        : {};
    const ids = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
    return {
      repairId: String(raw.repairId ?? scope.repairId ?? ""),
      issueCount: ids(scope.issueIds).length,
      unitIds: ids(scope.unitIds),
      pageIds: ids(scope.pageIds),
      sectionIds: ids(scope.sectionIds),
      visualIds: ids(scope.visualIds),
      allowedFiles: ids(policy.allowedFiles),
      changedFiles: ids(raw.filesActuallyChanged),
      modelCalls: Number(raw.modelCalls ?? 0),
      blockersBefore: ids(raw.blockersBefore).length,
      blockersAfter: ids(raw.blockersAfter).length,
      unaffectedPageHashesVerified: raw.unaffectedPageHashesVerified === true,
      accepted: raw.accepted === true,
      publishReady: raw.publishReady === true,
      reason: String(raw.reason ?? ""),
    };
  } catch {
    return null;
  }
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
    "paused",
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
  if (latestJob?.status === "paused") return "Paused";
  if (latestJob && activeStatus(latestJob.status)) return "Learning...";
  if (latestJob?.status === "awaiting_confirmation") {
    return hasTextbook || latestVersion ? "Repair issues" : "Review Learning Map";
  }
  if (sourceSetChanged && (hasTextbook || latestVersion)) return "Learn";
  if (confirmedMap && !latestVersion) return "Learn";
  if (hasTextbook || latestVersion) return "Repair issues";
  return "Learn";
}

function learnSelectionDiffersFromMapBinding({
  selection,
  map,
  jobSourceSetHash,
}: {
  selection: {
    sourceIds: readonly string[];
    syllabusSourceId?: string | null;
  } | null;
  map: StoredLearningMap | null;
  jobSourceSetHash?: string;
}): boolean {
  if (!selection || !map) return false;
  const selectionSyllabus = selection.syllabusSourceId?.trim() || null;
  const mapSyllabus = map.syllabusSourceId?.trim() || null;
  return (
    selection.sourceIds.length !== map.sourceIds.length ||
    selection.sourceIds.some(
      (sourceId, index) => sourceId !== map.sourceIds[index],
    ) ||
    selectionSyllabus !== mapSyllabus ||
    Boolean(jobSourceSetHash && jobSourceSetHash !== map.sourceSetHash)
  );
}

function learnLifecycleMapBindingMismatch({
  versionMapId,
  confirmedMapId,
  jobMapId,
}: {
  versionMapId?: string;
  confirmedMapId?: string;
  jobMapId?: string;
}): boolean {
  if (!versionMapId) return false;
  return Boolean(
    (confirmedMapId && confirmedMapId !== versionMapId) ||
      (jobMapId && jobMapId !== versionMapId),
  );
}

/**
 * Read-only Learn status projection for long-lived Next processes. It performs
 * no schema migration, generation, provider call, compiler invocation, child
 * creation, or persistent caching of source bodies.
 */
export function getLearnStatusSnapshot({
  gardenId,
  contentPath,
}: {
  userId?: number;
  gardenId: string;
  contentPath: string;
}): LearnStatusSnapshot {
  const context = scanStatusKnowledge(contentPath, gardenId);
  const storedLatestJob = latestLearnJob(gardenId);
  const latestConfirmed = latestConfirmedLearnMap(gardenId);
  const confirmedMap = isContractBackedLearningMap(latestConfirmed)
    ? latestConfirmed
    : null;
  const confirmedMapPlanningJob = confirmedMap
    ? learnMapPlanningJob(confirmedMap, gardenId)
    : null;
  const legacyReplanRequired = Boolean(
    storedLatestJob &&
      storedLatestJob.status === "failed" &&
      storedLatestJob.mode === "generate" &&
      !storedLatestJob.requiresReplan &&
      failedGenerationRequiresReplanFromEvents({
        gardenDir: path.join(contentPath, gardenId),
        jobId: storedLatestJob.id,
        expectedFormulaReviewSetHash: confirmedMap
          ? sourceFormulaReviewSetHashFromCoveragePlan(confirmedMap.coveragePlan)
          : undefined,
      }),
  );
  const latestJob =
    legacyReplanRequired && storedLatestJob
      ? { ...storedLatestJob, requiresReplan: true }
      : storedLatestJob;
  const latestProposed = latestJob?.proposedLearningMapId
    ? learnMapById(latestJob.proposedLearningMapId, gardenId)
    : latestLearnMap(gardenId);
  const contractProposed = isContractBackedLearningMap(latestProposed)
    ? latestProposed
    : null;
  const visibleJob =
    latestJob?.status === "awaiting_confirmation" && !contractProposed
      ? null
      : latestJob;
  const workflowTimer = visibleJob ? learnTimerForWorkflow(visibleJob) : null;
  const visibleJobWithWorkflowUsage =
    visibleJob && workflowTimer
      ? {
          ...visibleJob,
          tokenUsage: learnTokenUsageForWorkflow(visibleJob),
          elapsedMs: workflowTimer.elapsedMs,
          timerStartedAt: workflowTimer.timerStartedAt,
        }
      : null;
  const latestVersion = latestLearnVersion(gardenId);
  const hasTextbook = context.hasTextbook;
  const availableSourceIdSet = new Set(
    context.sources.map((source) => source.slug),
  );
  const latestJobBoundMapId =
    latestJob?.proposedLearningMapId ?? latestJob?.confirmedLearningMapId;
  const latestJobBoundMapCandidate = latestJobBoundMapId
    ? learnMapById(latestJobBoundMapId, gardenId)
    : null;
  const latestJobBoundMap = isContractBackedLearningMap(latestJobBoundMapCandidate)
    ? latestJobBoundMapCandidate
    : null;
  const selection = persistedLearnSelection(
    latestJob,
    latestJob ? latestJobBoundMap : contractProposed,
    confirmedMap,
  );
  const selectedSourceIds = selection
    ? context.incomplete
      ? [...selection.sourceIds]
      : selection.sourceIds.filter((sourceId) => availableSourceIdSet.has(sourceId))
    : context.sources.map((source) => source.slug);
  const syllabusSourceId =
    selection?.syllabusSourceId &&
    (context.incomplete || availableSourceIdSet.has(selection.syllabusSourceId))
      ? selection.syllabusSourceId
      : null;
  const coverage = selection?.syllabusCoverage ?? null;
  const syllabusCoverage =
    syllabusSourceId && coverage
      ? {
          unitCount: coverage.units.length,
          materialCount: coverage.resolutions.length,
          availableCount: coverage.resolutions.filter(
            (entry) => entry.status === "available",
          ).length,
          missingCount: coverage.resolutions.filter(
            (entry) => entry.status === "missing",
          ).length,
          genericCount: coverage.resolutions.filter(
            (entry) => entry.status === "generic",
          ).length,
          missingCitations: coverage.missingCitations,
        }
      : null;

  const versionMapCandidate = latestVersion
    ? learnMapById(latestVersion.learning_map_id, gardenId)
    : null;
  const versionMap = isContractBackedLearningMap(versionMapCandidate)
    ? versionMapCandidate
    : null;
  const sourceBindingMap = latestVersion
    ? versionMap
    : contractProposed ?? confirmedMap;
  let sourceSetChanged =
    context.incomplete ||
    Boolean(latestVersion && !versionMap) ||
    learnLifecycleMapBindingMismatch({
      versionMapId: latestVersion?.learning_map_id,
      confirmedMapId: confirmedMap?.id,
      jobMapId: latestJobBoundMapId,
    }) ||
    learnSelectionDiffersFromMapBinding({
      selection,
      map: sourceBindingMap,
      jobSourceSetHash: latestJob?.sourceSetHash,
    });
  if (sourceBindingMap && !context.incomplete) {
    try {
      const selectedSources = selectSources(
        context.sources,
        sourceBindingMap.sourceIds.length ? sourceBindingMap.sourceIds : undefined,
      );
      const syllabus = selectSyllabus(
        context.sources,
        sourceBindingMap.syllabusSourceId,
      );
      const teachingSources = syllabus
        ? selectedSources.filter((source) => source.slug !== syllabus.slug)
        : selectedSources;
      if (syllabus && teachingSources.length === 0) {
        throw new Error("The saved source selection has no teaching material.");
      }
      const rawBaseCurrentHash = sourceSetHashWithSyllabus(
        sourceSetHashForSources(teachingSources),
        syllabus,
      );
      let baseCurrentHash = rawBaseCurrentHash;
      let currentHash = rawBaseCurrentHash;
      const sourceOrder = teachingSources.map((source) => source.slug);
      const visuals = loadSourceVisuals(contentPath, gardenId);
      const sourceIdentityMap = resolveSourceIdentityMap(
        contentPath,
        gardenId,
        sourceOrder,
        visuals,
      );
      const selectedSourceIdSet = new Set(sourceOrder);
      const formulaIds = visuals
        .filter(
          (visual) =>
            selectedSourceIdSet.has(visual.sourceId) &&
            visual.type === "equation",
        )
        .map((visual) => visual.sourceVisualId)
        .sort();
      const manifest = loadFormulaManifest(contentPath, gardenId);
      if (manifest && manifest.baseSourceSetHash !== rawBaseCurrentHash) {
        const currentBindingRecords = teachingSources.map((source) =>
          learnSourceBindingRecord({
            slug: source.slug,
            relPath: source.relPath,
            title: source.title,
            description: source.description,
            sourceFile: source.sourceFile,
            date: source.date,
            wordCount: source.wordCount,
            bodyHash: source.statusBodyHash ?? undefined,
          }),
        );
        const normalizationReceipt = matchingLearnSourceNormalizationReceipt({
          gardenDir: path.join(contentPath, gardenId),
          expectedCombinedSourceSetHash: manifest.combinedSourceSetHash,
          sourceIds: sourceOrder,
          current: currentBindingRecords,
        });
        if (normalizationReceipt) {
          const receiptBaseCurrentHash = sourceSetHashWithSyllabus(
            sourceSetHashForBindingRecords(normalizationReceipt.before),
            syllabus,
          );
          if (receiptBaseCurrentHash === manifest.baseSourceSetHash) {
            baseCurrentHash = receiptBaseCurrentHash;
            currentHash = receiptBaseCurrentHash;
          }
        }
      }
      if (
        manifest &&
        manifest.baseSourceSetHash === baseCurrentHash &&
        JSON.stringify(manifest.sourceIds) === JSON.stringify(sourceOrder) &&
        manifest.sourceIdentityMapHash === sourceIdentityMapHash(sourceIdentityMap) &&
        JSON.stringify(manifest.sourceIdentityMap) === JSON.stringify(sourceIdentityMap) &&
        JSON.stringify(manifest.formulaIds) === JSON.stringify(formulaIds) &&
        computeFormulaReviewSetHash(
          visuals,
          formulaIds,
          sourceOrder,
          sourceIdentityMap,
          manifest.topologyReviewPageReceipts,
        ) === manifest.reviewSetHash
      ) {
        currentHash = sourceSetHashWithReviewedFormulas(
          baseCurrentHash,
          manifest.reviewSetHash,
        );
      }
      const currentArtifactInventoryHash = selectedSourceArtifactInventorySnapshot({
        selectedSourceIds: sourceOrder,
        sourceIdentityMap,
        visuals,
      }).sourceArtifactInventoryHash;
      const expectedSourceSetHash = latestVersion
        ? latestVersion.source_set_hash
        : sourceBindingMap.sourceSetHash;
      const expectedArtifactInventoryHash = latestVersion
        ? latestVersion.source_artifact_inventory_hash
        : sourceBindingMap.sourceArtifactInventoryHash;
      sourceSetChanged =
        sourceSetChanged ||
        expectedSourceSetHash !== currentHash ||
        !SHA256.test(expectedArtifactInventoryHash) ||
        expectedArtifactInventoryHash !== currentArtifactInventoryHash ||
        Boolean(
          latestVersion &&
            (latestVersion.source_set_hash !== sourceBindingMap.sourceSetHash ||
              latestVersion.source_artifact_inventory_hash !==
                sourceBindingMap.sourceArtifactInventoryHash),
        );
    } catch {
      sourceSetChanged = true;
    }
  }

  return {
    job: visibleJobWithWorkflowUsage,
    proposedLearningMap:
      visibleJob?.status === "awaiting_confirmation" ||
      contractProposed?.status === "proposed"
        ? (contractProposed?.learningMap ?? null)
        : null,
    confirmedLearningMapId: confirmedMap?.id,
    confirmedLearningMapModel: confirmedMapPlanningJob?.model,
    latestTextbookVersionId: latestVersion?.id,
    humanizer: latestVersion
      ? readLearnHumanizerVersionState(
          path.join(contentPath, gardenId),
          latestVersion.id,
        )
      : null,
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
    validationReport:
      visibleJob?.status === "failed"
        ? getLearnValidationReport({ gardenId, contentPath })
        : null,
    scopedRepair: getLearnScopedRepairSummary(gardenId, contentPath),
  };
}
