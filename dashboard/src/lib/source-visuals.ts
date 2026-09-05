// Stage 2 of the Breadboard pipeline: source visual extraction.
//
// Before any learning page is written, every meaningful visual in an uploaded
// source (figure, graph, table, equation, diagram) becomes a first-class
// SourceVisual object: detected per page via a vision call over the stored page
// snapshots, cropped out of the snapshot PNG where possible, and tracked in a
// ledger at .breadboard/source-visuals.json.
//
// Full-page screenshots are never figures. When detection or cropping fails,
// a page is represented (at most) by a "full_page_fallback" visual, which
// downstream stages may embed only as an explicit fallback.
//
// Stage 3 (learning page planning) then assigns every visual to a page or
// intentionally skips it with a reason — nothing disappears silently.

import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import os from "os";
import crypto from "crypto";
import type OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { modelTransportFailureEvidence } from "./http-502-retry.ts";
import { breadSystemPrompt } from "./assistant-identity.ts";
import { cropPng, resizePngToMaxDimension } from "./png-crop.ts";
import {
  publishExternalCacheFileAtomically,
  readFileSyncWithRetry,
} from "./resilient-fs.ts";
import { slugify } from "./tags.ts";

export type SourceVisualType =
  | "figure"
  | "graph"
  | "table"
  | "equation"
  | "diagram"
  | "full_page_fallback";

export type SourceVisualUsageStatus = "unused" | "assigned" | "intentionally_skipped";
export type SourceVisualConceptUsage =
  | "embedded_and_explained"
  | "explained_as_text_formula"
  | "explained_in_prose"
  | "used_as_interactive_grounding"
  | "referenced_again"
  | "intentionally_omitted";
export type SourceVisualCropStatus =
  | "embedded"
  | "available_not_embedded"
  | "omitted_unreliable"
  | "missing";

export interface SourceVisualBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceVisual {
  sourceVisualId: string;
  sourceId: string;
  pageNumber: number;
  type: SourceVisualType;
  caption: string;
  /** Verbatim model transcription for a detected display equation. */
  exactText?: string;
  /** AI-authored source-fidelity review linked to immutable page evidence. */
  formulaReview?: SourceFormulaReviewProvenance;
  /** Garden-relative URL ("/garden/assets/source-visuals/....png") when cropped. */
  croppedImagePath?: string;
  /** Garden-relative URL of the full page snapshot this visual came from. */
  pageImagePath?: string;
  bbox?: SourceVisualBBox;
  usageStatus: SourceVisualUsageStatus;
  conceptUsage?: SourceVisualConceptUsage;
  cropStatus?: SourceVisualCropStatus;
  assignedPageId?: string;
  assignedSectionId?: string;
  skipReason?: string;
}

const LEDGER_RELATIVE_PATH = path.join(".breadboard", "source-visuals.json");
const SCAN_CACHE_RELATIVE_PATH = path.join(".breadboard", "source-visual-scan-cache.json");
const SOURCE_IDENTITY_MAP_RELATIVE_PATH = path.join(
  ".breadboard",
  "source-visual-source-index.json",
);
const CROPPED_ASSETS_FOLDER = path.join("assets", "source-visuals");
export const MIN_SOURCE_VISUAL_DETECTION_TIMEOUT_MS = 5_000;
export const MAX_SOURCE_VISUAL_DETECTION_TIMEOUT_MS = 180_000;
// Sol Ultra vision calls regularly need more than 45 seconds even for the
// detector's low-detail 768px page image. Let one unambiguous request finish
// instead of aborting it and forcing a whole-job retry with unknown transport
// outcome. The environment override remains strictly bounded.
export const DEFAULT_SOURCE_VISUAL_DETECTION_TIMEOUT_MS =
  MAX_SOURCE_VISUAL_DETECTION_TIMEOUT_MS;
const DEFAULT_SOURCE_MODEL_HTTP_502_RETRY_BASE_DELAY_MS = 2_000;
const SOURCE_MODEL_HTTP_502_RETRY_MAX_DELAY_MS = 30_000;
const SOURCE_VISUAL_DETECTION_MAX_TRANSIENT_FAILURES = 5;
const SOURCE_VISUAL_DETECTION_MAX_SEMANTIC_ATTEMPTS = 3;
const DETECTOR_VERSION = 3;
const DETECTION_IMAGE_MAX_DIMENSION = 768;
const SOURCE_FORMULA_REVIEW_SCHEMA_VERSION = 1;
// V2 adds an explicit JSON transport rule and a bounded, field-scoped LaTeX
// escape recovery path. V1 receipts remain independently verifiable only by
// replaying their signed raw-JSON protocol below; new normal reviews always
// use V2 rather than silently certifying old responses under new rules.
const SOURCE_FORMULA_REVIEW_LEGACY_PROMPT_VERSION = 1;
const SOURCE_FORMULA_REVIEW_PROMPT_VERSION = 2;
const SOURCE_FORMULA_REVIEW_LEGACY_SYSTEM_PROMPT_SHA256 =
  "3fc92b3571daaa9ff3bfe2346d8d3617e10496b22e2706db714453b6f082f839";
const SOURCE_FORMULA_REVIEW_MAX_SEMANTIC_ATTEMPTS = 3;
const SOURCE_FORMULA_REVIEW_MAX_CONCURRENCY = 3;
// A successful whole-page recovery requires another normal formula review.
// That re-review can expose a different page's structured identity mismatch,
// so recovery/re-review is a small state machine rather than a one-shot
// retry. Bound both the total dispatch rounds and each exact evidence page;
// durable V4/V5/V6 receipts add the cross-run caps.
const SOURCE_FORMULA_REVIEW_MAX_RECOVERY_DISPATCH_ROUNDS = 3;
const SOURCE_FORMULA_REVIEW_MAX_RECOVERY_DISPATCHES_PER_EVIDENCE = 1;
const SOURCE_FORMULA_REVIEW_MAX_PAGE_TEXT_CHARS = 64_000;
const SOURCE_FORMULA_REVIEW_MAX_PAGE_BYTES = 25 * 1024 * 1024;
const SOURCE_FORMULA_REVIEW_MAX_FORMULAS_PER_PAGE = 64;
const SOURCE_FORMULA_REVIEW_MAX_EXACT_TEXT_CHARS = 12_000;
const SOURCE_FORMULA_REVIEW_MAX_CAPTION_CHARS = 2_000;
const SOURCE_FORMULA_REVIEW_MAX_REASON_CHARS = 2_000;
/** Ultra reasoning with a full page plus several high-detail formula crops can
 * legitimately exceed three minutes before returning a compact JSON review.
 * Give the single authoritative request a ten-minute answer window; transport
 * retries still receive a fresh bounded timer and remain cancellation-aware. */
export const SOURCE_FORMULA_REVIEW_FINAL_ATTEMPT_ALLOWANCE_MS = 600_000;
export const SOURCE_FORMULA_REVIEW_SCHEDULING_MARGIN_MS = 30_000;
export const DEFAULT_SOURCE_FORMULA_REVIEW_TIMEOUT_MS =
  SOURCE_FORMULA_REVIEW_FINAL_ATTEMPT_ALLOWANCE_MS +
  SOURCE_FORMULA_REVIEW_SCHEDULING_MARGIN_MS;
export const MIN_SOURCE_FORMULA_REVIEW_TIMEOUT_MS = 30_000;
export const MAX_SOURCE_FORMULA_REVIEW_TIMEOUT_MS = 1_800_000;
const SOURCE_FORMULA_REVIEW_RECORDS_RELATIVE_DIR = path.join(
  ".breadboard",
  "source-formula-reviews",
);
// A formula-review identity rejection can only be recovered by a separate
// high-detail whole-page authoring pass. This is deliberately independent from
// the low-detail general visual detector: it has a stricter response contract,
// records the rejected review it is responding to, and is allowed exactly once
// per exact page evidence within a bounded review/re-review call.
const SOURCE_FORMULA_ARTIFACT_RECOVERY_SCHEMA_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_RECOVERY_PROMPT_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_RECOVERY_DETECTOR_VERSION = 4;
const SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_SEMANTIC_ATTEMPTS = 3;
const SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_PAGE_BATCHES = 3;
const SOURCE_FORMULA_ARTIFACT_RECOVERY_CACHE_FOLDER = "formula-artifact-recovery-v1";
// V5 is deliberately separate from the strict same-slot V4 recovery. It is
// only available when the initial reviewer explicitly says that the page's
// formula topology changed (merge/split/retire/new formula), and requires a
// second independent topology confirmation before any ledger projection.
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SCHEMA_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_PROMPT_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION = 5;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_SEMANTIC_ATTEMPTS = 3;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_PAGE_BATCHES = 3;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SCHEMA_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_PROMPT_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_MAX_SEMANTIC_ATTEMPTS = 3;
// V6 does not alter a rejected V5 graph deterministically.  It preserves the
// rejected V5 candidate/review as immutable feedback and allows at most two
// fresh, complete successor candidates (three total candidates including V5).
// Every successor receives a new independent topology review before it can be
// projected, and a final rejection remains a durable evidence-level cap.
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION = 6;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES = 3;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_SEMANTIC_ATTEMPTS = 3;
// V7 is intentionally separate from V6.  It starts only when a *confirmed*
// V5/V6 topology candidate later receives a structured normal-formula-review
// topology rejection.  The raw normal review becomes immutable feedback for a
// fresh whole-page candidate; it is never translated into a local split,
// crop, equation, or graph patch.
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION = 7;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES = 3;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_SEMANTIC_ATTEMPTS = 3;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SCHEMA_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_PROMPT_VERSION = 1;
const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_MAX_SEMANTIC_ATTEMPTS = 3;
const SOURCE_FORMULA_REVIEW_MANIFEST_RELATIVE_PATH = path.join(
  ".breadboard",
  "source-formula-review-set.json",
);

export type SourceFormulaReviewDecision = "approved" | "replaced";
export type SourceFormulaIdentityAssessment =
  | "preserved"
  | "identity_mismatch"
  | "ambiguous"
  | "unreadable";

export interface SourceFormulaReviewProvenance {
  schemaVersion: 1;
  promptVersion: 1 | 2;
  model: string;
  reviewedAt: string;
  decision: SourceFormulaReviewDecision;
  identityAssessment: SourceFormulaIdentityAssessment;
  inputExactText: string;
  inputCaption: string;
  acceptedExactText: string;
  acceptedCaption: string;
  reason: string;
  pageImageSha256: string;
  equationCropSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  reviewedPageImagePath: string;
  reviewedEquationCropPath: string;
  requestSha256: string;
  responseSha256: string;
  cacheKey: string;
  cacheIntegritySha256: string;
  reviewRecordPath: string;
  semanticAttempt: number;
  /** Present only when a typed identity-mismatch recovery re-authored this page slot. */
  artifactRecovery?: SourceFormulaArtifactRecoveryProvenance;
  /** Present only when V5 re-authored the page's formula-slot topology. */
  artifactTopologyRecovery?: SourceFormulaArtifactTopologyRecoveryProvenance;
  /** Present only when V6 repaired a rejected V5 topology candidate. */
  artifactTopologyCandidateRepair?: SourceFormulaArtifactTopologyCandidateRepairProvenance;
  /** Present only when V7 repaired a normal-review disagreement after a confirmed topology candidate. */
  artifactTopologyConsensusRepair?: SourceFormulaArtifactTopologyConsensusRepairProvenance;
}

/** Immutable lineage for a model-authored whole-page source-artifact recovery. */
export interface SourceFormulaArtifactRecoveryProvenance {
  schemaVersion: 1;
  promptVersion: 1;
  model: string;
  recoveredAt: string;
  sourceVisualId: string;
  reviewerIdentityAssessment: "identity_mismatch" | null;
  reviewerReason: string | null;
  inputExactText: string;
  inputCaption: string;
  inputBBox: SourceVisualBBox;
  inputEquationCropSha256: string;
  recoveredExactText: string;
  recoveredCaption: string;
  recoveredBBox: SourceVisualBBox;
  recoveredEquationCropSha256: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  failedReviewCacheKey: string;
  failedReviewRequestSha256: string;
  failedReviewResponseSha256: string;
  requestSha256: string;
  responseSha256: string;
  cacheKey: string;
  cacheIntegritySha256: string;
  semanticAttempt: number;
}

/** Immutable lineage for a V5 model-authored formula topology recovery. */
export interface SourceFormulaArtifactTopologyRecoveryProvenance {
  schemaVersion: 1;
  promptVersion: 1;
  model: string;
  recoveredAt: string;
  sourceVisualId: string;
  priorSourceVisualIds: string[];
  recoveredExactText: string;
  recoveredCaption: string;
  recoveredBBox: SourceVisualBBox;
  recoveredEquationCropSha256: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  failedReviewCacheKey: string;
  failedReviewRequestSha256: string;
  failedReviewResponseSha256: string;
  requestSha256: string;
  responseSha256: string;
  cacheKey: string;
  cacheIntegritySha256: string;
  semanticAttempt: number;
  topologyReviewCacheKey: string;
  topologyReviewCacheIntegritySha256: string;
  topologyReviewRequestSha256: string;
  topologyReviewResponseSha256: string;
  topologyReviewSemanticAttempt: number;
}

/** Immutable V6 lineage. The master cycle is distinct from the final model
 * candidate, so no field falsely implies that C1 and C2/C3 are one receipt. */
export interface SourceFormulaArtifactTopologyCandidateRepairProvenance {
  schemaVersion: 1;
  promptVersion: 1;
  model: string;
  candidateOrdinal: number;
  recoveredAt: string;
  sourceVisualId: string;
  priorSourceVisualIds: string[];
  recoveredExactText: string;
  recoveredCaption: string;
  recoveredBBox: SourceVisualBBox;
  recoveredEquationCropSha256: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  cycleCacheKey: string;
  cycleCacheIntegritySha256: string;
  initialRecoveryCacheKey: string;
  initialRecoveryCacheIntegritySha256: string;
  initialTopologyReviewCacheKey: string;
  initialTopologyReviewCacheIntegritySha256: string;
  candidateCacheKey: string;
  candidateCacheIntegritySha256: string;
  candidateRequestSha256: string;
  candidateResponseSha256: string;
  candidateSemanticAttempt: number;
  topologyReviewCacheKey: string;
  topologyReviewCacheIntegritySha256: string;
  topologyReviewRequestSha256: string;
  topologyReviewResponseSha256: string;
  topologyReviewSemanticAttempt: number;
}

/** Immutable V7 lineage for a normal-review disagreement after topology confirmation. */
export interface SourceFormulaArtifactTopologyConsensusRepairProvenance {
  schemaVersion: 1;
  promptVersion: 1;
  model: string;
  candidateOrdinal: number;
  recoveredAt: string;
  sourceVisualId: string;
  priorSourceVisualIds: string[];
  recoveredExactText: string;
  recoveredCaption: string;
  recoveredBBox: SourceVisualBBox;
  recoveredEquationCropSha256: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  cycleCacheKey: string;
  cycleCacheIntegritySha256: string;
  baseProtocol: "v5" | "v6";
  baseCandidateCacheKey: string;
  baseCandidateIntegritySha256: string;
  baseTopologyReviewCacheKey: string;
  baseTopologyReviewCacheIntegritySha256: string;
  triggerFormulaReviewCacheKey: string;
  triggerFormulaReviewRequestSha256: string;
  triggerFormulaReviewResponseSha256: string;
  candidateCacheKey: string;
  candidateCacheIntegritySha256: string;
  candidateRequestSha256: string;
  candidateResponseSha256: string;
  candidateSemanticAttempt: number;
  topologyReviewCacheKey: string;
  topologyReviewCacheIntegritySha256: string;
  topologyReviewRequestSha256: string;
  topologyReviewResponseSha256: string;
  topologyReviewSemanticAttempt: number;
}

export interface SourceFormulaReviewSetManifest {
  schemaVersion: 1;
  promptVersion: 1 | 2;
  model: string;
  /** Selected teaching sources, in the exact order used by this Learn run. */
  sourceIds: string[];
  /** Garden-global S<n> ownership. This is deliberately not compacted to sourceIds. */
  sourceIdentityMap: SourceVisualSourceIdentity[];
  sourceIdentityMapHash: string;
  formulaIds: string[];
  /** Confirmed V5 page receipts, including zero-active-formula tombstones. */
  topologyReviewPageReceipts: SourceFormulaTopologyReviewPageReceipt[];
  reviewSetHash: string;
  baseSourceSetHash: string;
  combinedSourceSetHash: string;
  createdAt: string;
}

export interface SourceVisualSourceIdentity {
  sourceId: string;
  sourceIndex: number;
}

interface SourceVisualSourceIdentityRegistry {
  schemaVersion: 1;
  sourceIdentityMap: SourceVisualSourceIdentity[];
}

interface SourceVisualDetection {
  type: SourceVisualType;
  caption: string;
  exactText?: string;
  bbox?: SourceVisualBBox;
}

interface SourceVisualScanEntry {
  detectorVersion: number;
  fingerprint: string;
  detections: SourceVisualDetection[];
  /**
   * Accepted whole-page recovery evidence. This lives with the incremental
   * scan cache (which intentionally survives failed Learn staging rollback),
   * rather than under the rollback-owned formula-review records.
   */
  formulaArtifactRecovery?: SourceFormulaArtifactRecoveryCacheEnvelope;
  /**
   * V5 model-authored formula-topology recovery. Unlike V4 it may retire,
   * merge, split, or add formula slots, but is valid only with its independent
   * topology-review receipt.
   */
  formulaArtifactTopologyRecovery?: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
  /** Independent confirmation/rejection of the immutable V5 topology graph. */
  formulaArtifactTopologyReview?: SourceFormulaArtifactTopologyReviewEnvelope;
  /**
   * V6 bounded candidate-repair lineage. It starts only from a signed V5
   * topology-review rejection and retains every candidate/reviewer round.
   */
  formulaArtifactTopologyCandidateRepair?: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
  /**
   * V7 bounded consensus-repair lineage. It starts from a signed confirmed
   * V5/V6 topology candidate plus an exact structured normal-review rejection.
   */
  formulaArtifactTopologyConsensusRepair?: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope;
}

interface SourceVisualScanCache {
  schemaVersion: 1;
  sources: Record<string, Record<string, SourceVisualScanEntry>>;
}

export function sourceVisualDetectionTimeoutMs(
  raw = process.env.SOURCE_VISUAL_DETECTION_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SOURCE_VISUAL_DETECTION_TIMEOUT_MS;
  }
  return Math.max(
    MIN_SOURCE_VISUAL_DETECTION_TIMEOUT_MS,
    Math.min(parsed, MAX_SOURCE_VISUAL_DETECTION_TIMEOUT_MS),
  );
}

interface SourceModelCompletionResponse {
  choices: Array<{ message?: { content?: string | null } }>;
}

function sourceModelHttp502RetryDelayMs(retryNumber: number): number {
  const configuredBase = Number(process.env.SOURCE_MODEL_HTTP_502_RETRY_BASE_DELAY_MS);
  const baseDelayMs = Number.isFinite(configuredBase) && configuredBase > 0
    ? Math.min(SOURCE_MODEL_HTTP_502_RETRY_MAX_DELAY_MS, Math.floor(configuredBase))
    : DEFAULT_SOURCE_MODEL_HTTP_502_RETRY_BASE_DELAY_MS;
  return Math.min(
    SOURCE_MODEL_HTTP_502_RETRY_MAX_DELAY_MS,
    baseDelayMs *
      2 ** Math.min(4, Math.max(0, retryNumber - 1)),
  );
}

function isSourceModelHttp502(error: unknown): boolean {
  return modelTransportFailureEvidence(error).causes.some(
    ({ httpStatus }) => httpStatus === 502,
  );
}

async function waitForSourceModelHttp502Retry(
  delayMs: number,
  checkpoint?: () => void,
): Promise<void> {
  const deadline = Date.now() + delayMs;
  while (Date.now() < deadline) {
    checkpoint?.();
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
    );
  }
  checkpoint?.();
}

/** Source-image and formula-review calls are read-only model analyses with no
 * provider receipt to adopt. An HTTP 502 is therefore safe to replay as the
 * same immutable request. Give every retry a fresh per-attempt timeout and
 * keep the Learn cancellation checkpoint live. Callers may provide a bounded
 * deterministic fallback when a non-essential analysis must not stall Learn. */
async function createSourceModelCompletionWithHttp502Retry(input: {
  client: OpenAI;
  request: unknown;
  timeoutMs: number;
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
  stageLabel: string;
  fallbackAfterFailures?: number;
  fallbackContent?: string;
}): Promise<SourceModelCompletionResponse> {
  let retryNumber = 0;
  for (;;) {
    input.checkpoint?.();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      return await input.client.chat.completions.create(
        input.request as never,
        { signal: controller.signal, maxRetries: 0 },
      ) as unknown as SourceModelCompletionResponse;
    } catch (error) {
      const locallyTimedOut = controller.signal.aborted;
      if (!isSourceModelHttp502(error) && !locallyTimedOut) throw error;
      retryNumber += 1;
      if (
        Number.isInteger(input.fallbackAfterFailures) &&
        retryNumber >= Number(input.fallbackAfterFailures)
      ) {
        input.onProgress?.(
          `${locallyTimedOut ? "Model request timed out" : "HTTP 502"}; ` +
            `continuing without ${input.stageLabel} after ${retryNumber} failed attempts.`,
        );
        return {
          choices: [{ message: { content: input.fallbackContent ?? "[]" } }],
        };
      }
      const delayMs = sourceModelHttp502RetryDelayMs(retryNumber);
      input.onProgress?.(
        `${locallyTimedOut ? "Model request timed out" : "HTTP 502"}; ` +
          `automatically retrying ${input.stageLabel} (retry ${retryNumber})...`,
      );
      await waitForSourceModelHttp502Retry(delayMs, input.checkpoint);
    } finally {
      clearTimeout(timeout);
    }
  }
}

const TYPE_LETTER: Record<SourceVisualType, string> = {
  figure: "F",
  diagram: "F",
  graph: "G",
  table: "T",
  equation: "E",
  full_page_fallback: "P",
};

function expandedCropBBox(
  bbox: SourceVisualBBox,
  type: SourceVisualType,
): SourceVisualBBox {
  if (type === "full_page_fallback") return bbox;
  const minWidth =
    type === "equation" ? 0.5 : type === "table" ? 0.55 : type === "graph" ? 0.5 : 0.42;
  const minHeight =
    type === "equation" ? 0.075 : type === "table" ? 0.12 : type === "graph" ? 0.14 : 0.1;
  const padX = type === "equation" ? 0.035 : type === "table" ? 0.04 : 0.03;
  const padY = type === "equation" ? 0.025 : type === "table" ? 0.035 : 0.03;
  const width = Math.min(1, Math.max(bbox.width + padX * 2, minWidth));
  const height = Math.min(1, Math.max(bbox.height + padY * 2, minHeight));
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;
  return {
    x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
    y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
    width,
    height,
  };
}

const DETECTION_SYSTEM_PROMPT = breadSystemPrompt(`You identify the meaningful visuals on one page of an academic or educational document.
Return ONLY a JSON array (no fence, no commentary). Each element:
{
  "type": "figure" | "graph" | "table" | "equation" | "diagram",
  "caption": "short specific description of what the visual shows, e.g. 'LIF neuron membrane potential model'",
  "exactText": "for an equation, transcribe its complete displayed mathematical expression verbatim in LaTeX; omit for every other type",
  "bbox": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.3 }
}
Rules:
- bbox values are fractions of the page (0..1), measured from the top-left corner, and must tightly enclose the visual including its printed caption.
- Report real figures, plots/graphs, tables, numbered display equations, and diagrams only.
- Do NOT report running body text, headers, footers, page numbers, author blocks, references, or logos.
- Do NOT report the whole page as one visual.
- captions must describe content ("Latency comparison across models"), never position ("image at top").
- Every equation record must include a non-empty exactText transcription. If the expression cannot be read reliably, do not report it as an equation.
- If the page has no meaningful visuals, return [].`);

export function sourceVisualsLedgerPath(contentPath: string, gardenSlug: string): string {
  return path.join(contentPath, gardenSlug, LEDGER_RELATIVE_PATH);
}

export function sourceVisualScanCachePath(contentPath: string, gardenSlug: string): string {
  return path.join(contentPath, gardenSlug, SCAN_CACHE_RELATIVE_PATH);
}

function loadSourceVisualScanCache(
  contentPath: string,
  gardenSlug: string,
): SourceVisualScanCache {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(sourceVisualScanCachePath(contentPath, gardenSlug), "utf-8"),
    ) as Partial<SourceVisualScanCache>;
    if (parsed.schemaVersion === 1 && parsed.sources && typeof parsed.sources === "object") {
      return parsed as SourceVisualScanCache;
    }
  } catch {
    // A missing or damaged optimization cache is safe to rebuild.
  }
  return { schemaVersion: 1, sources: {} };
}

function saveSourceVisualScanCache(
  contentPath: string,
  gardenSlug: string,
  cache: SourceVisualScanCache,
): void {
  const cachePath = sourceVisualScanCachePath(contentPath, gardenSlug);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(cache, null, 2);
  fs.writeFileSync(temporaryPath, serialized, "utf-8");
  try {
    fs.renameSync(temporaryPath, cachePath);
  } catch {
    // Some Windows filesystems do not replace an existing file atomically.
    fs.writeFileSync(cachePath, serialized, "utf-8");
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup of the temporary cache file.
    }
  }
}

export function loadSourceVisuals(contentPath: string, gardenSlug: string): SourceVisual[] {
  try {
    const raw = fs.readFileSync(sourceVisualsLedgerPath(contentPath, gardenSlug), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SourceVisual[]) : [];
  } catch {
    return [];
  }
}

export function saveSourceVisuals(
  contentPath: string,
  gardenSlug: string,
  visuals: SourceVisual[],
): void {
  const ledgerPath = sourceVisualsLedgerPath(contentPath, gardenSlug);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const serialized = JSON.stringify(visuals, null, 2);
  const temporaryPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, "utf-8");
  try {
    fs.renameSync(temporaryPath, ledgerPath);
  } catch {
    // Windows cannot atomically replace an existing destination. Keep the old
    // ledger intact until a complete temporary payload exists, then replace it.
    fs.writeFileSync(ledgerPath, serialized, "utf-8");
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup after the platform replacement fallback.
    }
  }
}

export function sourceVisualSourceIdentityMapPath(
  contentPath: string,
  gardenSlug: string,
): string {
  return path.join(contentPath, gardenSlug, SOURCE_IDENTITY_MAP_RELATIVE_PATH);
}

function normalizedSourceVisualSourceIdentityMap(
  value: readonly SourceVisualSourceIdentity[],
): SourceVisualSourceIdentity[] {
  const sourceIds = new Set<string>();
  const sourceIndexes = new Set<number>();
  const normalized = value.map((entry) => {
    const sourceId = typeof entry?.sourceId === "string" ? entry.sourceId.trim() : "";
    const sourceIndex = Number(entry?.sourceIndex);
    if (!sourceId || !Number.isSafeInteger(sourceIndex) || sourceIndex < 1) {
      throw new Error("Source-visual source identity entries require a non-empty sourceId and positive integer sourceIndex.");
    }
    if (sourceIds.has(sourceId)) {
      throw new Error(`Source-visual source identity map assigns source "${sourceId}" more than once.`);
    }
    if (sourceIndexes.has(sourceIndex)) {
      throw new Error(`Source-visual source identity map assigns S${sourceIndex} more than once.`);
    }
    sourceIds.add(sourceId);
    sourceIndexes.add(sourceIndex);
    return { sourceId, sourceIndex };
  });
  return normalized.sort((left, right) =>
    left.sourceIndex - right.sourceIndex || left.sourceId.localeCompare(right.sourceId));
}

export function sourceVisualSourceIdentityMapHash(
  value: readonly SourceVisualSourceIdentity[],
): string {
  return sha256(JSON.stringify({
    schemaVersion: 1,
    sourceIdentityMap: normalizedSourceVisualSourceIdentityMap(value),
  }));
}

export function loadSourceVisualSourceIdentityMap(
  contentPath: string,
  gardenSlug: string,
): SourceVisualSourceIdentity[] {
  const registryPath = sourceVisualSourceIdentityMapPath(contentPath, gardenSlug);
  if (!fs.existsSync(registryPath)) return [];
  let parsed: Partial<SourceVisualSourceIdentityRegistry>;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as Partial<SourceVisualSourceIdentityRegistry>;
  } catch (error) {
    throw new Error(
      `Source-visual source identity registry is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sourceIdentityMap)) {
    throw new Error("Source-visual source identity registry has an invalid schema.");
  }
  const normalized = normalizedSourceVisualSourceIdentityMap(parsed.sourceIdentityMap);
  if (JSON.stringify(normalized) !== JSON.stringify(parsed.sourceIdentityMap)) {
    throw new Error("Source-visual source identity registry is not in canonical index order.");
  }
  return normalized;
}

function sourceIndexFromVisualId(sourceVisualId: string): number | null {
  const match = /^S([1-9]\d*)\.P[1-9]\d*\.[A-Z][1-9]\d*$/i.exec(sourceVisualId.trim());
  if (!match) return null;
  const sourceIndex = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(sourceIndex) && sourceIndex > 0 ? sourceIndex : null;
}

function mergeLedgerSourceIdentities(
  identities: readonly SourceVisualSourceIdentity[],
  visuals: readonly SourceVisual[],
): SourceVisualSourceIdentity[] {
  const sourceToIndex = new Map(identities.map((entry) => [entry.sourceId, entry.sourceIndex]));
  const indexToSource = new Map(identities.map((entry) => [entry.sourceIndex, entry.sourceId]));
  for (const visual of visuals) {
    const sourceId = typeof visual.sourceId === "string" ? visual.sourceId.trim() : "";
    const sourceIndex = sourceIndexFromVisualId(visual.sourceVisualId);
    if (!sourceId || sourceIndex === null) continue;
    const existingIndex = sourceToIndex.get(sourceId);
    if (existingIndex !== undefined && existingIndex !== sourceIndex) {
      throw new Error(
        `Source-visual ledger assigns source "${sourceId}" to both S${existingIndex} and S${sourceIndex}.`,
      );
    }
    const existingSource = indexToSource.get(sourceIndex);
    if (existingSource !== undefined && existingSource !== sourceId) {
      throw new Error(
        `Source-visual ledger assigns S${sourceIndex} to both "${existingSource}" and "${sourceId}".`,
      );
    }
    sourceToIndex.set(sourceId, sourceIndex);
    indexToSource.set(sourceIndex, sourceId);
  }
  return normalizedSourceVisualSourceIdentityMap(
    [...sourceToIndex].map(([sourceId, sourceIndex]) => ({ sourceId, sourceIndex })),
  );
}

function loadSourceVisualsForIdentityResolution(
  contentPath: string,
  gardenSlug: string,
): SourceVisual[] {
  const ledgerPath = sourceVisualsLedgerPath(contentPath, gardenSlug);
  if (!fs.existsSync(ledgerPath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
  } catch (error) {
    throw new Error(
      `Source-visual ledger is unreadable while resolving stable source identities: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "Source-visual ledger must be an array before stable source identities can be resolved.",
    );
  }
  return parsed as SourceVisual[];
}

function saveSourceVisualSourceIdentityMap(
  contentPath: string,
  gardenSlug: string,
  sourceIdentityMap: readonly SourceVisualSourceIdentity[],
): void {
  const registryPath = sourceVisualSourceIdentityMapPath(contentPath, gardenSlug);
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  const canonical = normalizedSourceVisualSourceIdentityMap(sourceIdentityMap);
  const serialized = `${JSON.stringify({
    schemaVersion: 1,
    sourceIdentityMap: canonical,
  }, null, 2)}\n`;
  const temporaryPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, "utf-8");
  try {
    fs.renameSync(temporaryPath, registryPath);
  } catch {
    fs.writeFileSync(registryPath, serialized, "utf-8");
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup after the Windows replacement fallback.
    }
  }
}

/**
 * Resolve durable garden-global ownership of S<n> slots. Selection order never
 * changes an existing slot. Existing ledger ids are treated as identity
 * evidence and conflicts fail closed; unseen selected sources receive a new,
 * never-reused slot. Set persist only from a lease-owned mutation path.
 */
export function resolveSourceVisualSourceIdentityMap({
  contentPath,
  gardenSlug,
  sourceIds,
  persist = false,
}: {
  contentPath: string;
  gardenSlug: string;
  sourceIds: readonly string[];
  persist?: boolean;
}): SourceVisualSourceIdentity[] {
  const normalizedSourceIds = sourceIds.map((sourceId) => sourceId.trim());
  if (
    normalizedSourceIds.some((sourceId) => !sourceId) ||
    new Set(normalizedSourceIds).size !== normalizedSourceIds.length
  ) {
    throw new Error("Source-visual source identity resolution requires unique non-empty source ids.");
  }
  const stored = loadSourceVisualSourceIdentityMap(contentPath, gardenSlug);
  const merged = mergeLedgerSourceIdentities(
    stored,
    loadSourceVisualsForIdentityResolution(contentPath, gardenSlug),
  );
  const sourceToIndex = new Map(merged.map((entry) => [entry.sourceId, entry.sourceIndex]));
  let nextIndex = merged.reduce((highest, entry) => Math.max(highest, entry.sourceIndex), 0) + 1;
  for (const sourceId of normalizedSourceIds) {
    if (sourceToIndex.has(sourceId)) continue;
    sourceToIndex.set(sourceId, nextIndex);
    nextIndex += 1;
  }
  const resolved = normalizedSourceVisualSourceIdentityMap(
    [...sourceToIndex].map(([sourceId, sourceIndex]) => ({ sourceId, sourceIndex })),
  );
  if (
    persist &&
    (!fs.existsSync(sourceVisualSourceIdentityMapPath(contentPath, gardenSlug)) ||
      JSON.stringify(resolved) !== JSON.stringify(stored))
  ) {
    saveSourceVisualSourceIdentityMap(contentPath, gardenSlug, resolved);
  }
  return resolved;
}

/** Resolve a garden-relative asset URL ("/garden/assets/x.png") to a disk path,
 * refusing anything that escapes the garden directory. */
function assetDiskPath(contentPath: string, gardenSlug: string, assetUrl: string): string | null {
  const normalized = assetUrl.trim().replace(/\\/g, "/");
  const prefix = `/${gardenSlug}/`;
  if (!normalized.startsWith(prefix)) return null;
  const contentDir = path.resolve(contentPath);
  const gardenDir = path.resolve(contentDir, gardenSlug);
  const gardenRelative = path.relative(contentDir, gardenDir);
  if (
    !gardenRelative ||
    gardenRelative.startsWith(`..${path.sep}`) ||
    gardenRelative === ".." ||
    path.isAbsolute(gardenRelative)
  ) {
    return null;
  }
  const resolved = path.resolve(gardenDir, normalized.slice(prefix.length));
  const relative = path.relative(gardenDir, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return resolved;
}

export interface EnsureSourcePdfPageSnapshotsOptions {
  contentPath: string;
  gardenSlug: string;
  /** Basename slug of the source note whose canonical page assets are needed. */
  sourceId: string;
  /** Garden-relative URL of the preserved original PDF. */
  sourcePdfUrl: string;
  /** Specific 1-based PDF page numbers to materialize. */
  pageNumbers: number[];
  desiredWidth?: number;
  /** Called before and after each page render so Learn can stop promptly. */
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}

/**
 * Materialize only the requested full-page PDF snapshots. Existing canonical
 * assets are reused, so a later Learn run can request pages mentioned by the
 * syllabus without re-rendering the entire book or mutating the source note.
 */
export async function ensureSourcePdfPageSnapshots(
  options: EnsureSourcePdfPageSnapshotsOptions,
): Promise<string[]> {
  const {
    contentPath,
    gardenSlug,
    sourceId,
    sourcePdfUrl,
    checkpoint,
    onProgress,
    desiredWidth = 1200,
  } = options;
  const garden = gardenSlug.trim();
  const sourceAssetId = slugify(sourceId) || "source";
  const seen = new Set<number>();
  const pageNumbers = options.pageNumbers.filter((pageNumber) => {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || seen.has(pageNumber)) return false;
    seen.add(pageNumber);
    return true;
  });
  if (pageNumbers.length === 0) return [];

  const pageAsset = (pageNumber: number): { diskPath: string; url: string } => {
    const fileName = `${sourceAssetId}-page-${String(pageNumber).padStart(3, "0")}.png`;
    const url = `/${garden}/assets/${fileName}`;
    const diskPath = assetDiskPath(contentPath, garden, url);
    if (!diskPath) throw new Error("Refusing to create a source snapshot outside the garden.");
    return { diskPath, url };
  };

  const assets = new Map(pageNumbers.map((pageNumber) => [pageNumber, pageAsset(pageNumber)]));
  const missingPages = pageNumbers.filter((pageNumber) => {
    const asset = assets.get(pageNumber);
    if (!asset) return true;
    try {
      const stat = fs.statSync(asset.diskPath);
      return !stat.isFile() || stat.size === 0;
    } catch {
      return true;
    }
  });
  if (missingPages.length === 0) {
    return pageNumbers.map((pageNumber) => assets.get(pageNumber)!.url);
  }

  const pdfPath = assetDiskPath(contentPath, garden, sourcePdfUrl);
  if (!pdfPath || path.extname(pdfPath).toLowerCase() !== ".pdf" || !fs.existsSync(pdfPath)) {
    throw new Error("The preserved source PDF is missing or is outside this garden.");
  }
  const gardenDir = fs.realpathSync(path.resolve(contentPath, garden));
  const realPdfPath = fs.realpathSync(pdfPath);
  const realPdfRelative = path.relative(gardenDir, realPdfPath);
  if (
    !realPdfRelative ||
    realPdfRelative.startsWith(`..${path.sep}`) ||
    realPdfRelative === ".." ||
    path.isAbsolute(realPdfRelative)
  ) {
    throw new Error("The preserved source PDF resolves outside this garden.");
  }

  const pdfBuffer = fs.readFileSync(realPdfPath);
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const info = await parser.getInfo();
    const invalidPages = missingPages.filter((pageNumber) => pageNumber > info.total);
    if (invalidPages.length > 0) {
      throw new Error(
        `Source PDF has ${info.total} page(s); requested page ${invalidPages.join(", ")}.`,
      );
    }

    const renderWidth = Number.isFinite(desiredWidth)
      ? Math.max(320, Math.min(2400, Math.round(desiredWidth)))
      : 1200;
    for (const pageNumber of missingPages) {
      checkpoint?.();
      onProgress?.(`Rendering source PDF page ${pageNumber}...`);
      const screenshot = await parser.getScreenshot({
        partial: [pageNumber],
        desiredWidth: renderWidth,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const page = screenshot.pages.find((candidate) => candidate.pageNumber === pageNumber);
      if (!page?.data?.length) {
        throw new Error(`Source PDF page ${pageNumber} could not be rendered.`);
      }
      const asset = assets.get(pageNumber)!;
      fs.mkdirSync(path.dirname(asset.diskPath), { recursive: true });
      const temporaryPath = `${asset.diskPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, Buffer.from(page.data));
      try {
        fs.renameSync(temporaryPath, asset.diskPath);
      } catch {
        fs.writeFileSync(asset.diskPath, Buffer.from(page.data));
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // Best-effort cleanup after a non-atomic Windows replacement.
        }
      }
      checkpoint?.();
    }
  } finally {
    await parser.destroy();
  }

  return pageNumbers.map((pageNumber) => assets.get(pageNumber)!.url);
}

function pageNumberFromAssetUrl(assetUrl: string): number | undefined {
  const match = assetUrl.match(/-page-(\d{1,5})(?:-\d+)?\.(?:png|jpe?g|webp)$/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function sourceFormulaSlotOrder(sourceVisualId: string): number {
  const match = /^S\d+\.P\d+\.E(\d+)$/i.exec(sourceVisualId.trim());
  const order = Number.parseInt(match?.[1] ?? "", 10);
  return Number.isSafeInteger(order) && order > 0 ? order : Number.MAX_SAFE_INTEGER;
}

function sourceFormulaInputOrder(left: SourceVisual, right: SourceVisual): number {
  return sourceFormulaSlotOrder(left.sourceVisualId) - sourceFormulaSlotOrder(right.sourceVisualId) ||
    left.sourceVisualId.localeCompare(right.sourceVisualId);
}

/** True for the stored full-page snapshot assets ("...-page-003.png"). */
export function isFullPageSnapshotUrl(assetUrl: string): boolean {
  return pageNumberFromAssetUrl(assetUrl) !== undefined;
}

/**
 * Return successful AI-scan page identities that survived a failed Learn run.
 * This is a read-only convergence aid: extraction still verifies the current
 * image fingerprint and strict detection payload before reusing any result.
 */
export function sourceVisualCachedPageImageUrls(
  contentPath: string,
  gardenSlug: string,
  sourceId: string,
): string[] {
  const sourceAssetId = slugify(sourceId) || "source";
  const canonicalPrefix = `/${gardenSlug}/assets/${sourceAssetId}-page-`;
  const sourceCache = loadSourceVisualScanCache(contentPath, gardenSlug).sources[sourceId] ?? {};
  const urls: string[] = [];
  for (const [pageUrl, cached] of Object.entries(sourceCache)) {
    if (
      !pageUrl.startsWith(canonicalPrefix) ||
      !isFullPageSnapshotUrl(pageUrl) ||
      !cached ||
      typeof cached.fingerprint !== "string" ||
      !Array.isArray(cached.detections)
    ) continue;
    const diskPath = assetDiskPath(contentPath, gardenSlug, pageUrl);
    if (!diskPath) continue;
    // A V5/V6/V7 recovery receipt may be the sole durable tombstone for an
    // all-retired formula page.  Keep an intact receipt discoverable even when
    // its snapshot asset is missing so extraction can restore that asset from
    // the current canonical PDF.  Never manufacture this candidate for a
    // generic/v3 cache entry.
    if (!fs.existsSync(diskPath)) {
      const recovery = cached.formulaArtifactTopologyRecovery;
      const candidateRepair = cached.formulaArtifactTopologyCandidateRepair;
      const consensusRepair = cached.formulaArtifactTopologyConsensusRepair;
      if (
        (
          cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
          recovery &&
          sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
            cached,
            pageUrl,
            cached.fingerprint,
          )
        ) ||
        (
          cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION &&
          candidateRepair &&
          sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(
            cached,
            pageUrl,
            cached.fingerprint,
          )
        ) ||
        (
          cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION &&
          consensusRepair &&
          sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(
            cached,
            pageUrl,
            cached.fingerprint,
          )
        )
      ) {
        urls.push(pageUrl);
      }
      continue;
    }
    let snapshotFingerprint = "";
    try {
      snapshotFingerprint = sha256(fs.readFileSync(diskPath));
      validateDetectionRecords(cached.detections);
    } catch {
      continue;
    }
    // This helper returns candidate pages, not cache hits. A changed ordinary
    // snapshot must still be returned so extraction can deliberately miss its
    // fingerprint and re-scan it. A v4 receipt whose exact page bytes still
    // match is immediately reusable; an intact receipt with changed bytes is
    // retained only as an extraction candidate so the live-hash guard below
    // can invalidate it and run normal detection instead.
    const reusableNormalScan = cached.detectorVersion === DETECTOR_VERSION;
    const reusableRecoveryScan =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_RECOVERY_DETECTOR_VERSION &&
      sourceFormulaArtifactRecoveryScanEntryMatches(cached, pageUrl, snapshotFingerprint);
    const reusableTopologyRecoveryScan =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
      sourceFormulaArtifactTopologyRecoveryScanEntryMatches(cached, pageUrl, snapshotFingerprint) &&
      Boolean(cached.formulaArtifactTopologyRecovery) &&
      sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
        contentPath,
        gardenSlug,
        cached.formulaArtifactTopologyRecovery!,
        snapshotFingerprint,
      ) &&
      sourceFormulaArtifactTopologyReviewScanEntryIsConfirmed(
        cached,
        cached.formulaArtifactTopologyRecovery!,
        snapshotFingerprint,
      );
    const reusableTopologyCandidateRepairScan =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION &&
      sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(cached, pageUrl, snapshotFingerprint) &&
      Boolean(cached.formulaArtifactTopologyCandidateRepair) &&
      sourceFormulaArtifactTopologyCandidateRepairHasCurrentEvidence(
        contentPath,
        gardenSlug,
        cached.formulaArtifactTopologyCandidateRepair!,
        snapshotFingerprint,
      ) &&
      sourceFormulaArtifactTopologyCandidateRepairScanEntryIsConfirmed(
        cached,
        pageUrl,
        snapshotFingerprint,
      );
    const reusableTopologyConsensusRepairScan =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION &&
      sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(cached, pageUrl, snapshotFingerprint) &&
      Boolean(cached.formulaArtifactTopologyConsensusRepair) &&
      sourceFormulaArtifactTopologyConsensusRepairHasCurrentEvidence(
        contentPath,
        gardenSlug,
        cached.formulaArtifactTopologyConsensusRepair!,
        snapshotFingerprint,
      );
    const intactRecoveryCandidate =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_RECOVERY_DETECTOR_VERSION &&
      sourceFormulaArtifactRecoveryScanEntryMatches(cached, pageUrl, cached.fingerprint);
    const intactTopologyRecoveryCandidate =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
      sourceFormulaArtifactTopologyRecoveryScanEntryMatches(cached, pageUrl, cached.fingerprint) &&
      sourceFormulaArtifactTopologyReviewScanEntryIsConfirmed(
        cached,
        cached.formulaArtifactTopologyRecovery!,
        cached.fingerprint,
      );
    const intactTopologyCandidateRepairCandidate =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION &&
      sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(cached, pageUrl, cached.fingerprint) &&
      sourceFormulaArtifactTopologyCandidateRepairScanEntryIsConfirmed(
        cached,
        pageUrl,
        cached.fingerprint,
      );
    const intactTopologyConsensusRepairCandidate =
      cached.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION &&
      sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(cached, pageUrl, cached.fingerprint);
    if (
      !reusableNormalScan &&
      !reusableRecoveryScan &&
      !reusableTopologyRecoveryScan &&
      !reusableTopologyCandidateRepairScan &&
      !reusableTopologyConsensusRepairScan &&
      !intactRecoveryCandidate &&
      !intactTopologyRecoveryCandidate &&
      !intactTopologyCandidateRepairCandidate &&
      !intactTopologyConsensusRepairCandidate
    ) continue;
    urls.push(pageUrl);
  }
  return [...new Set(urls)].sort((left, right) => {
    const leftPage = pageNumberFromAssetUrl(left) ?? 0;
    const rightPage = pageNumberFromAssetUrl(right) ?? 0;
    return leftPage - rightPage || left.localeCompare(right);
  });
}

/**
 * Prove that every supplied page snapshot has a successful detection receipt
 * for its current bytes. Empty detection arrays are valid evidence; a missing,
 * malformed, or stale receipt is not. This closes the gap where one scanned
 * page (or one productive source) could mask an unscanned sibling page.
 */
export function sourceVisualScanCoverageProblems(input: {
  contentPath: string;
  gardenSlug: string;
  sourceId: string;
  pageImageUrls: readonly string[];
}): string[] {
  const sourceCache = loadSourceVisualScanCache(input.contentPath, input.gardenSlug)
    .sources[input.sourceId] ?? {};
  const problems: string[] = [];
  for (const pageUrl of [...new Set(input.pageImageUrls.filter(isFullPageSnapshotUrl))]) {
    const pageNumber = pageNumberFromAssetUrl(pageUrl) ?? 0;
    const label = `source "${input.sourceId}" page ${pageNumber || pageUrl}`;
    const diskPath = assetDiskPath(input.contentPath, input.gardenSlug, pageUrl);
    if (!diskPath || !fs.existsSync(diskPath)) {
      problems.push(`${label} has no current page snapshot`);
      continue;
    }
    const entry = sourceCache[pageUrl];
    if (!entry) {
      problems.push(`${label} has no current visual-scan receipt`);
      continue;
    }
    let fingerprint = "";
    try {
      fingerprint = sha256(fs.readFileSync(diskPath));
      validateDetectionRecords(entry.detections);
    } catch (error) {
      problems.push(
        `${label} has a malformed visual-scan receipt (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    if (entry.fingerprint !== fingerprint) {
      problems.push(`${label} has a stale visual-scan receipt for different snapshot bytes`);
    }
  }
  return [...new Set(problems)];
}

type SourceFormulaReviewAction = "approve" | "replace" | "reject";
type SourceFormulaTopologyAssessment = "same_slot" | "topology_change";

export interface SourceFormulaReviewModelDecision {
  sourceVisualId: string;
  action: SourceFormulaReviewAction;
  acceptedExactText?: string;
  acceptedCaption?: string;
  identityAssessment: SourceFormulaIdentityAssessment;
  reason: string;
  /** Required for new identity_mismatch responses; old cached responses are same-slot. */
  topologyAssessment?: SourceFormulaTopologyAssessment;
}

interface SourceFormulaReviewInput {
  sourceVisualId: string;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  inputCaption: string;
  inputExactText: string;
  bbox: SourceVisualBBox;
  equationCropSha256: string;
}

interface SourceFormulaReviewPageEvidence {
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImage: Buffer;
  pageImageSha256: string;
  canonicalPageText: string;
  canonicalPageTextSha256: string;
  sourcePdfPath: string;
  sourcePdfSha256: string;
  inputs: SourceFormulaReviewInput[];
  crops: Map<string, Buffer>;
}

export interface SourceFormulaReviewPageRejection {
  sourceId: string;
  pageNumber: number;
  rejections: Array<{
    sourceVisualId: string;
    identityAssessment: Exclude<SourceFormulaIdentityAssessment, "preserved">;
    reason: string;
    topologyAssessment?: SourceFormulaTopologyAssessment;
  }>;
}

interface SourceFormulaReviewRejectedPage extends SourceFormulaReviewPageRejection {
  evidence: SourceFormulaReviewPageEvidence;
  failedReview: SourceFormulaArtifactRecoveryFailedReview;
}

interface SourceFormulaReviewCacheEnvelopeUnsigned {
  schemaVersion: 1;
  promptVersion: 1 | 2;
  cacheKey: string;
  model: string;
  sourceId: string;
  pageNumber: number;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  requestPayload: string;
  requestSha256: string;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  reviewedAt: string;
  inputVisuals: SourceFormulaReviewInput[];
  reviews: SourceFormulaReviewModelDecision[];
}

interface SourceFormulaReviewCacheEnvelope extends SourceFormulaReviewCacheEnvelopeUnsigned {
  integritySha256: string;
}

/** One formula slot as it existed immediately before whole-page recovery. */
interface SourceFormulaArtifactRecoveryInput {
  sourceVisualId: string;
  sourceId: string;
  pageNumber: number;
  inputCaption: string;
  inputExactText: string;
  inputBBox: SourceVisualBBox;
  inputEquationCropSha256: string;
  /** Only the typed reviewer rejection may authorize recovery for this slot. */
  reviewerIdentityAssessment: "identity_mismatch" | null;
  /** Parsed reviewer feedback, carried to the recovery prompt without rewriting. */
  reviewerReason: string | null;
}

interface SourceFormulaArtifactRecoveryReplacement {
  sourceVisualId: string;
  caption: string;
  exactText: string;
  bbox: SourceVisualBBox;
  equationCropSha256: string;
}

interface SourceFormulaArtifactRecoveryFailedReview {
  model: string;
  cacheKey: string;
  requestPayload: string;
  requestSha256: string;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  inputVisuals: SourceFormulaReviewInput[];
}

interface SourceFormulaArtifactRecoveryCacheEnvelopeUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  cacheKey: string;
  model: string;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  failedReview: SourceFormulaArtifactRecoveryFailedReview;
  requestPayload: string;
  requestSha256: string;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  recoveredAt: string;
  inputVisuals: SourceFormulaArtifactRecoveryInput[];
  detections: SourceVisualDetection[];
  replacements: SourceFormulaArtifactRecoveryReplacement[];
}

interface SourceFormulaArtifactRecoveryCacheEnvelope
  extends SourceFormulaArtifactRecoveryCacheEnvelopeUnsigned {
  integritySha256: string;
}

type SourceFormulaTopologyDisposition = "retain" | "merge" | "split" | "retire";

/** A model-authored active equation slot from a V5 whole-page inventory. */
interface SourceFormulaArtifactTopologyActiveSlot {
  sourceVisualId: string;
  caption: string;
  exactText: string;
  bbox: SourceVisualBBox;
  equationCropSha256: string;
  /** Exact inverse edges from the old page slots; [] means newly discovered. */
  priorSourceVisualIds: string[];
}

/** Every former formula slot has one explicit, model-authored disposition. */
interface SourceFormulaArtifactTopologyPriorResolution {
  sourceVisualId: string;
  disposition: SourceFormulaTopologyDisposition;
  activeSourceVisualIds: string[];
  reason: string;
}

interface SourceFormulaArtifactTopologyReviewEnvelopeUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  cacheKey: string;
  model: string;
  sourceId: string;
  pageNumber: number;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  recoveryCacheKey: string;
  recoveryCacheIntegritySha256: string;
  requestPayload: string;
  requestSha256: string;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  reviewedAt: string;
  status: "confirmed" | "rejected";
  reason: string;
  priorSlotResolutions: SourceFormulaArtifactTopologyPriorResolution[];
}

interface SourceFormulaArtifactTopologyReviewEnvelope
  extends SourceFormulaArtifactTopologyReviewEnvelopeUnsigned {
  integritySha256: string;
}

interface SourceFormulaArtifactTopologyRecoveryCacheEnvelopeUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  cacheKey: string;
  model: string;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  failedReview: SourceFormulaArtifactRecoveryFailedReview;
  requestPayload: string;
  requestSha256: string;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  recoveredAt: string;
  inputVisuals: SourceFormulaArtifactRecoveryInput[];
  detections: SourceVisualDetection[];
  activeFormulaSlots: SourceFormulaArtifactTopologyActiveSlot[];
  priorSlotResolutions: SourceFormulaArtifactTopologyPriorResolution[];
}

interface SourceFormulaArtifactTopologyRecoveryCacheEnvelope
  extends SourceFormulaArtifactTopologyRecoveryCacheEnvelopeUnsigned {
  integritySha256: string;
}

/** Fields an independently reviewed topology candidate must expose. */
interface SourceFormulaArtifactTopologyReviewCandidate {
  cacheKey: string;
  integritySha256: string;
  inputVisuals: SourceFormulaArtifactRecoveryInput[];
  activeFormulaSlots: SourceFormulaArtifactTopologyActiveSlot[];
  priorSlotResolutions: SourceFormulaArtifactTopologyPriorResolution[];
}

/**
 * A fresh V6 candidate.  It deliberately carries the exact raw prior
 * candidate/reviewer feedback in both its cache key material and request
 * payload; there is no local equation, bbox, or graph repair step.
 */
interface SourceFormulaArtifactTopologyCandidateRepairCandidateUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  cacheKey: string;
  model: string;
  candidateOrdinal: number;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  initialRecoveryCacheKey: string;
  initialRecoveryCacheIntegritySha256: string;
  initialTopologyReviewCacheKey: string;
  initialTopologyReviewCacheIntegritySha256: string;
  priorCandidateCacheKey: string;
  priorCandidateIntegritySha256: string;
  priorCandidateRawResponse: string;
  priorCandidateResponseSha256: string;
  priorTopologyReviewCacheKey: string;
  priorTopologyReviewCacheIntegritySha256: string;
  priorTopologyReviewRawResponse: string;
  priorTopologyReviewResponseSha256: string;
  priorTopologyReviewReason: string;
  requestPayload: string;
  requestSha256: string;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  recoveredAt: string;
  inputVisuals: SourceFormulaArtifactRecoveryInput[];
  detections: SourceVisualDetection[];
  activeFormulaSlots: SourceFormulaArtifactTopologyActiveSlot[];
  priorSlotResolutions: SourceFormulaArtifactTopologyPriorResolution[];
}

interface SourceFormulaArtifactTopologyCandidateRepairCandidate
  extends SourceFormulaArtifactTopologyCandidateRepairCandidateUnsigned {
  integritySha256: string;
}

interface SourceFormulaArtifactTopologyCandidateRepairHistoryEntry {
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate;
  /** Missing only after a transport/protocol failure; retry may review only it. */
  topologyReview?: SourceFormulaArtifactTopologyReviewEnvelope;
}

/**
 * Durable V6 cycle rooted in one rejected V5 C1/R1 pair.  `candidates` holds
 * C2/C3 in order; the final entry is the only one eligible for projection and
 * only when its independent reviewer confirms it.
 */
interface SourceFormulaArtifactTopologyCandidateRepairCacheEnvelopeUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  detectorVersion: 6;
  maxCandidates: 3;
  cacheKey: string;
  model: string;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  candidates: SourceFormulaArtifactTopologyCandidateRepairHistoryEntry[];
  startedAt: string;
  updatedAt: string;
}

interface SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope
  extends SourceFormulaArtifactTopologyCandidateRepairCacheEnvelopeUnsigned {
  integritySha256: string;
}

/**
 * V7 roots in a topology candidate that was independently confirmed, then
 * rejected by the ordinary formula reviewer. The root is explicit so V5 and
 * V6 receipts cannot be confused or silently rewritten.
 */
interface SourceFormulaArtifactTopologyConsensusRepairV5Base {
  protocol: "v5";
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
}

interface SourceFormulaArtifactTopologyConsensusRepairV6Base {
  protocol: "v6";
  candidateRepair: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
  terminalCandidateCacheKey: string;
  terminalCandidateIntegritySha256: string;
  terminalTopologyReviewCacheKey: string;
  terminalTopologyReviewCacheIntegritySha256: string;
}

type SourceFormulaArtifactTopologyConsensusRepairBase =
  | SourceFormulaArtifactTopologyConsensusRepairV5Base
  | SourceFormulaArtifactTopologyConsensusRepairV6Base;

/** Exact, signed-by-hashes normal-review feedback that authorized V7. */
interface SourceFormulaArtifactTopologyConsensusFormulaFeedback {
  failedReview: SourceFormulaArtifactRecoveryFailedReview;
  rejections: Array<{
    sourceVisualId: string;
    identityAssessment: Exclude<SourceFormulaIdentityAssessment, "preserved">;
    reason: string;
    topologyAssessment?: SourceFormulaTopologyAssessment;
  }>;
}

type SourceFormulaArtifactTopologyConsensusRepairFeedback =
  | { kind: "formula_review"; formulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback }
  | { kind: "empty_inventory_review"; emptyInventoryReview: SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelope }
  | { kind: "topology_review"; topologyReview: SourceFormulaArtifactTopologyReviewEnvelope };

/**
 * Ordinary formula review has one record per active slot. When a V7 candidate
 * proposes no active slots, use this equally signed page-level reviewer
 * receipt instead of treating an empty array as an implicit approval.
 */
interface SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelopeUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  cacheKey: string;
  model: string;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  consensusRepairCacheKey: string;
  candidateCacheKey: string;
  candidateCacheIntegritySha256: string;
  candidateRawResponse: string;
  candidateResponseSha256: string;
  requestPayload: string;
  requestSha256: string;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  reviewedAt: string;
  status: "confirmed" | "rejected";
  reason: string;
}

interface SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelope
  extends SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelopeUnsigned {
  integritySha256: string;
}

interface SourceFormulaArtifactTopologyConsensusRepairCandidateUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  cacheKey: string;
  model: string;
  candidateOrdinal: number;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  consensusRepairCacheKey: string;
  priorCandidateCacheKey: string;
  priorCandidateIntegritySha256: string;
  priorCandidateRawResponse: string;
  priorCandidateResponseSha256: string;
  priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback;
  requestPayload: string;
  requestSha256: string;
  repairHistory: Array<{ rawResponse: string; diagnostic: string }>;
  rawResponse: string;
  responseSha256: string;
  semanticAttempt: number;
  recoveredAt: string;
  inputVisuals: SourceFormulaArtifactRecoveryInput[];
  detections: SourceVisualDetection[];
  activeFormulaSlots: SourceFormulaArtifactTopologyActiveSlot[];
  priorSlotResolutions: SourceFormulaArtifactTopologyPriorResolution[];
}

interface SourceFormulaArtifactTopologyConsensusRepairCandidate
  extends SourceFormulaArtifactTopologyConsensusRepairCandidateUnsigned {
  integritySha256: string;
}

interface SourceFormulaArtifactTopologyConsensusRepairHistoryEntry {
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate;
  /** Missing only after transport/protocol failure; that review alone may retry. */
  topologyReview?: SourceFormulaArtifactTopologyReviewEnvelope;
  /** Present only after a confirmed candidate later receives a typed normal-review rejection. */
  formulaReviewFeedback?: SourceFormulaArtifactTopologyConsensusFormulaFeedback;
  /**
   * A zero-active inventory has no per-formula row on which to retain the
   * ordinary-review receipt. Keep an explicit page-level C/R/N review here,
   * so an all-retired page is not projected from C/R alone and a rejection
   * can author the next bounded candidate.
   */
  emptyInventoryFormulaReview?: SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelope;
}

interface SourceFormulaArtifactTopologyConsensusRepairCacheEnvelopeUnsigned {
  schemaVersion: 1;
  promptVersion: 1;
  detectorVersion: 7;
  maxCandidates: 3;
  cacheKey: string;
  model: string;
  sourceId: string;
  pageNumber: number;
  pageImagePath: string;
  pageImageSha256: string;
  canonicalPageTextSha256: string;
  sourcePdfSha256: string;
  systemPromptSha256: string;
  base: SourceFormulaArtifactTopologyConsensusRepairBase;
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback;
  candidates: SourceFormulaArtifactTopologyConsensusRepairHistoryEntry[];
  startedAt: string;
  updatedAt: string;
}

interface SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope
  extends SourceFormulaArtifactTopologyConsensusRepairCacheEnvelopeUnsigned {
  integritySha256: string;
}

interface SourceFormulaArtifactTopologyRecoveryPageOutcome {
  evidence: SourceFormulaReviewPageEvidence;
  envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
  /** Present only after the independent V5 topology reviewer confirmed it. */
  topologyReview?: SourceFormulaArtifactTopologyReviewEnvelope;
  cacheHit: boolean;
}

/** A V6 successor candidate may project only after its own final review confirms it. */
interface SourceFormulaArtifactTopologyCandidateRepairPageOutcome {
  evidence: SourceFormulaReviewPageEvidence;
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  cacheHit: boolean;
}

interface SourceFormulaArtifactTopologyConsensusRepairPageOutcome {
  evidence: SourceFormulaReviewPageEvidence;
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope;
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  cacheHit: boolean;
}

interface SourceFormulaArtifactRecoveryPageOutcome {
  evidence: SourceFormulaReviewPageEvidence;
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope;
  cacheHit: boolean;
}

interface SourceFormulaReviewPageOutcome {
  envelope: SourceFormulaReviewCacheEnvelope;
  evidence: SourceFormulaReviewPageEvidence;
  cacheHit: boolean;
}

export interface ReviewRequiredSourceFormulaExactTextOptions {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenSlug: string;
  /** Exact selected teaching-source order; this controls membership, not S<n> ownership. */
  selectedSourceIds: readonly string[];
  /** Garden-global stable S<n> ownership, including unselected/tombstoned slots. */
  sourceIdentityMap?: readonly SourceVisualSourceIdentity[];
  requiredFormulaIds: Iterable<string>;
  checkCancelled?: () => void;
  onProgress?: (step: string) => void;
  /** Test seam. Production caches outside Quartz under LOCALAPPDATA/Breadboard. */
  cacheRoot?: string;
  /** Test seam for stable audit assertions. */
  now?: () => string;
  /** Test seam; production renders directly from the preserved PDF bytes. */
  renderPdfPage?: (input: {
    sourceId: string;
    pageNumber: number;
    sourcePdfPath: string;
    sourcePdf: Buffer;
  }) => Promise<Buffer>;
}

export interface SourceFormulaReviewResult {
  visuals: SourceVisual[];
  formulaIds: string[];
  reviewedFormulaSetHash: string;
  approvedFormulaIds: string[];
  replacementFormulaIds: string[];
  newlyReplacedFormulaIds: string[];
  cacheHitFormulaIds: string[];
  modelCalls: number;
  /**
   * Page-level V5 receipts, including an allowed activeFormulaIds=[] tombstone.
   * Consumers must bind these alongside formula rows so a fully-retired page
   * cannot disappear from the final review lineage.
   */
  topologyReviewPageReceipts: SourceFormulaTopologyReviewPageReceipt[];
}

export interface SourceFormulaTopologyReviewPageReceipt {
  /** Exact durable recovery protocol; never infer this from cache-key shape. */
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

export interface SourceFormulaReviewValidationOptions {
  contentPath?: string;
  gardenSlug: string;
  /** Explicit evidence root for isolated/scoped staging whose basename is not the public slug. */
  gardenDir?: string;
  /** Slug retained by canonical asset URLs when gardenDir has a staging basename. */
  assetUrlGardenSlug?: string;
  requiredFormulaIds: Iterable<string>;
  expectedReviewSetHash?: string;
  expectedModel?: string;
  /** Selected teaching-source order for manifest membership checks. */
  expectedSourceIds?: readonly string[];
  /** Explicit stable S<n> ownership. Otherwise the durable garden registry is used. */
  sourceIdentityMap?: readonly SourceVisualSourceIdentity[];
  /** Immutable page-level V5 receipt set expected by the caller/manifest. */
  expectedTopologyReviewPageReceipts?: readonly SourceFormulaTopologyReviewPageReceipt[];
}

export interface SourceFormulaReviewValidationResult {
  formulaIds: string[];
  reviewSetHash: string;
  problems: string[];
}

export class SourceFormulaReviewProtocolError extends Error {
  constructor(message: string) {
    super(`Source formula review protocol error: ${message}`);
    this.name = "SourceFormulaReviewProtocolError";
  }
}

function assertNonemptySourceFormulaModelResponse(
  rawResponse: string,
  stage: string,
): void {
  const normalizedCandidate = sourceFormulaReviewJsonCandidate(rawResponse);
  if (!normalizedCandidate || normalizedCandidate === "null") {
    throw new SourceFormulaReviewProtocolError(
      normalizedCandidate === "null"
        ? `${stage} returned literal JSON null; no semantic repair request was issued`
        : `${stage} returned no nonempty candidate; no semantic repair request was issued`,
    );
  }
}

const sourceFormulaReviewRejectedDetails = new WeakMap<
  object,
  readonly SourceFormulaReviewRejectedPage[]
>();

export class SourceFormulaReviewRejectedError extends Error {
  readonly pageRejections: readonly SourceFormulaReviewPageRejection[];
  readonly modelCalls: number;

  constructor(
    pageRejections: readonly SourceFormulaReviewRejectedPage[],
    modelCalls: number,
  ) {
    const message = pageRejections.flatMap((page) => page.rejections.map((review) =>
      `${review.sourceVisualId} (${review.identityAssessment}): ${review.reason}`,
    )).join("; ");
    super(`Source formula review rejected source evidence: ${message}`);
    this.name = "SourceFormulaReviewRejectedError";
    this.pageRejections = pageRejections.map((page) => ({
      sourceId: page.sourceId,
      pageNumber: page.pageNumber,
      rejections: page.rejections.map((review) => ({ ...review })),
    }));
    this.modelCalls = modelCalls;
    sourceFormulaReviewRejectedDetails.set(this, pageRejections);
  }
}

function sourceFormulaReviewRejectedPageDetails(
  error: SourceFormulaReviewRejectedError,
): readonly SourceFormulaReviewRejectedPage[] {
  return sourceFormulaReviewRejectedDetails.get(error) ?? [];
}

const SOURCE_FORMULA_REVIEW_SYSTEM_PROMPT = breadSystemPrompt(`You independently review display-equation transcriptions from an educational source page.

The full-resolution PAGE IMAGE is the primary source evidence. The canonical page Markdown is corroborating searchable context and may itself contain OCR mistakes. The current exactText is an UNTRUSTED candidate produced by an earlier detector and may be wrong. Never preserve it merely for consistency, and never mechanically prefer either text record over what you can verify in the page image.

For every supplied sourceVisualId, inspect its normalized bbox and its labeled crop against the full page. Review the complete semantic record: both the equation transcription and its concise descriptive caption. Decide whether the ID/crop still identifies one complete displayed equation. Return ONLY one JSON object:
{"reviews":[{"sourceVisualId":"exact supplied id","action":"approve|replace|reject","acceptedExactText":"complete verbatim LaTeX for approve/replace","acceptedCaption":"accurate concise caption for approve/replace","identityAssessment":"preserved|identity_mismatch|ambiguous|unreadable","topologyAssessment":"same_slot|topology_change for identity_mismatch only","reason":"specific evidence-based reason"}]}

Rules:
- Return exactly one review for every supplied id, with no invented ids and no extra keys.
- approve means acceptedExactText and acceptedCaption exactly equal both supplied current fields.
- replace means you independently author the complete corrected record and at least one accepted field differs from its current value.
- acceptedExactText must preserve every visible sign, limit direction, prime, vector mark, subscript, superscript, equality, integral, differential, delimiter, and displayed equation number/tag.
- JSON-escape every literal LaTeX backslash in acceptedExactText: in the raw response, a LaTeX \\mathbf command must be encoded as \\\\mathbf. Do not emit a single backslash before any LaTeX command.
- acceptedCaption must accurately identify what this displayed equation states; do not inherit a misleading detector caption.
- identityAssessment=preserved is required for approve or replace: the bbox/crop must still denote that one equation even if its old transcription was wrong.
- Use reject with identity_mismatch when the bbox/id points at a different equation, merges/splits equations, or cannot safely retain the same identity.
- For identity_mismatch only, include topologyAssessment=topology_change when the full page proves that one or more supplied formula slots must be merged, split, retired, or replaced by a newly discovered formula slot. Otherwise include topologyAssessment=same_slot. Do not infer this from prose alone.
- Omit topologyAssessment for approve, replace, ambiguous, and unreadable.
- Use reject with ambiguous or unreadable whenever the complete equation cannot be established from the page image. Never guess.
- The reason must say what image evidence and corroborating Markdown evidence support the decision.`);

const SOURCE_FORMULA_ARTIFACT_RECOVERY_SYSTEM_PROMPT = breadSystemPrompt(`You are performing a one-time recovery of stale display-equation source artifacts after an independent reviewer rejected one or more crops with identity_mismatch.

Use the supplied fresh high-resolution PDF PAGE IMAGE as the primary authority. The source Markdown is corroborating context only. The prior detector fields are stale candidates, not facts. The failed reviewer response and each rejected reason are supplied verbatim; address them, but do not copy a stale crop or invent an equation.

Re-detect the WHOLE PAGE. Return ONLY one JSON object with exactly these keys:
{"detections":[{"type":"figure|graph|table|equation|diagram","caption":"...","exactText":"required only for equation","bbox":{"x":0,"y":0,"width":0,"height":0}}],"formulaReplacements":[{"sourceVisualId":"exact supplied id","caption":"...","exactText":"complete visible LaTex","bbox":{"x":0,"y":0,"width":0,"height":0}}]}

Rules:
- detections must list every meaningful visual on the page, never body prose/header/footer/page number/logo, in top-to-bottom reading order. Use the same strict detection schema described in the request.
- formulaReplacements must contain exactly one replacement for EVERY supplied formula slot, in exactly the supplied slot order. The IDs are opaque slots; preserve them verbatim and do not add, drop, remap, or merge slots.
- Every formulaReplacement must correspond exactly to the equation detection in the same formula-slot position. The number of equation detections must exactly equal the number of supplied formula slots.
- Each replacement bbox must tightly enclose one complete displayed equation. It must not be a text heading, prose paragraph, partial equation, merged equations, or the whole page.
- For slots marked identity_mismatch, choose a genuinely new bbox/crop; do not repeat the stale one.
- exactText must preserve every visible sign, limit direction, prime, vector mark, subscript, superscript, equality, integral, differential, delimiter, and displayed equation number/tag.
- If the full page cannot establish all supplied equation slots safely, do not guess: return a response that fails this contract rather than fabricating a replacement.`);

const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SYSTEM_PROMPT = breadSystemPrompt(`You are performing one bounded, model-authored formula-topology recovery after an independent reviewer proved that a source page's old equation slots no longer describe the page topology.

Use the supplied fresh high-resolution PDF PAGE IMAGE as primary authority. Re-detect the WHOLE PAGE; do not patch one bbox, infer a relation from Markdown alone, or use a stale crop. The failed reviewer response is supplied verbatim.

Return ONLY one JSON object with exactly these keys:
{"detections":[{"type":"figure|graph|table|equation|diagram","caption":"...","exactText":"required only for equation","bbox":{"x":0,"y":0,"width":0,"height":0}}],"activeFormulaSlots":[{"sourceVisualId":"model-authored active S#.P#.E# id","caption":"...","exactText":"complete visible LaTex","bbox":{"x":0,"y":0,"width":0,"height":0},"priorSourceVisualIds":["old supplied id", "..."]}],"priorSlotResolutions":[{"sourceVisualId":"every old supplied id in supplied order","disposition":"retain|merge|split|retire","activeSourceVisualIds":["active id", "..."],"reason":"specific full-page evidence"}]}

Rules:
- detections must contain every meaningful visual in top-to-bottom reading order; never include prose, headings, headers, footers, logos, or a whole-page box.
- equation detections and activeFormulaSlots must have identical count and order, with exactly matching caption, exactText, and bbox.
- activeFormulaSlots are the complete active formula inventory for this page. Their ids are model-authored opaque ids, must stay on this source/page, and may differ from old ids. [] priorSourceVisualIds is allowed only for a genuinely newly discovered equation.
- priorSlotResolutions must contain every supplied old formula id exactly once in supplied order. retain maps exactly that id to itself; merge maps one old id to one active id shared by multiple old ids; split maps one old id to two or more active ids; retire maps to no active id because the old slot is continuation/prose/not an equation.
- activeFormulaSlots.priorSourceVisualIds must be the exact inverse graph of priorSlotResolutions. Never invent an old id or omit one.
- Every active bbox must tightly enclose one complete displayed equation. If the page cannot establish all topology relations safely, return a response that fails this contract rather than guessing.`);

const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SYSTEM_PROMPT = breadSystemPrompt(`You independently verify a proposed model-authored formula-slot topology against a fresh high-resolution PDF page. The full PAGE IMAGE is primary evidence; the supplied candidate crops and old-slot graph are diagnostic only.

Return ONLY one JSON object. If and only if every proposed active formula and every old-slot relation is visibly correct, return:
{"status":"confirmed","reason":"specific evidence","priorSlotResolutions":[{"sourceVisualId":"old id","disposition":"retain|merge|split|retire","activeSourceVisualIds":["active id", "..."],"reason":"same exact proposed reason"}]}
Otherwise return:
{"status":"rejected","reason":"specific image-based reason"}

Rules:
- Do not repair, rename, add, remove, or reinterpret a graph. Confirm the exact supplied graph or reject it.
- A continuation line may be merged only when the full page visibly proves it belongs to the same complete displayed equation.
- Reject ambiguity, unreadability, guessed relationships, wrong page/source ids, stale crops, or a graph that does not describe every old slot.
- Never approve based only on Markdown or prior model text.`);

const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT = breadSystemPrompt(`You are authoring one bounded successor candidate after an independent reviewer rejected a prior whole-page formula-topology candidate.

Use the supplied fresh high-resolution PDF PAGE IMAGE as primary authority. The prior candidate and the reviewer rejection are diagnostic evidence and are supplied verbatim. Do not patch a single equation, bbox, sign, or graph edge mechanically. Re-detect the WHOLE PAGE and author a complete replacement inventory and complete old-slot-to-active-slot graph.

Return ONLY one JSON object with exactly these keys:
{"detections":[{"type":"figure|graph|table|equation|diagram","caption":"...","exactText":"required only for equation","bbox":{"x":0,"y":0,"width":0,"height":0}}],"activeFormulaSlots":[{"sourceVisualId":"model-authored active S#.P#.E# id","caption":"...","exactText":"complete visible LaTex","bbox":{"x":0,"y":0,"width":0,"height":0},"priorSourceVisualIds":["old supplied id", "..."]}],"priorSlotResolutions":[{"sourceVisualId":"every old supplied id in supplied order","disposition":"retain|merge|split|retire","activeSourceVisualIds":["active id", "..."],"reason":"specific full-page evidence"}]}

Rules:
- The raw reviewer rejection is feedback, not a requested text substitution. Inspect the page yourself and return a new complete candidate only.
- detections must contain every meaningful visual in top-to-bottom reading order; never include prose, headings, headers, footers, logos, or a whole-page box.
- equation detections and activeFormulaSlots must have identical count and order, with exactly matching caption, exactText, and bbox.
- activeFormulaSlots are the complete active formula inventory for this page. Their ids are opaque model-authored slots on this source/page; [] priorSourceVisualIds is allowed only for a genuinely newly discovered equation.
- priorSlotResolutions must contain every supplied old formula id exactly once in supplied order. retain maps exactly that id to itself; merge maps one old id to one active id shared by multiple old ids; split maps one old id to two or more active ids; retire maps to no active id.
- activeFormulaSlots.priorSourceVisualIds must be the exact inverse graph of priorSlotResolutions. Never invent an old id or omit one.
- Every active bbox must tightly enclose one complete displayed equation. If the page cannot establish all topology relations safely, return a response that fails this contract rather than guessing.`);

const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT = breadSystemPrompt(`You are authoring one bounded successor after two independent checks disagreed about a previously confirmed formula-topology candidate.

The supplied fresh high-resolution PDF PAGE IMAGE is primary authority. A prior whole-page candidate and its independent topology confirmation are supplied only as diagnostic history. A later ordinary formula reviewer rejected one or more of that candidate's active slots with identity_mismatch; that raw rejection is feedback, not a requested local edit. Do not patch a single bbox, equation, caption, identifier, or graph edge. Re-detect the WHOLE PAGE and author a complete replacement inventory and complete old-slot-to-active-slot graph.

Return ONLY one JSON object with exactly these keys:
{"detections":[{"type":"figure|graph|table|equation|diagram","caption":"...","exactText":"required only for equation","bbox":{"x":0,"y":0,"width":0,"height":0}}],"activeFormulaSlots":[{"sourceVisualId":"model-authored active S#.P#.E# id","caption":"...","exactText":"complete visible LaTex","bbox":{"x":0,"y":0,"width":0,"height":0},"priorSourceVisualIds":["old supplied id", "..."]}],"priorSlotResolutions":[{"sourceVisualId":"every original old supplied id in supplied order","disposition":"retain|merge|split|retire","activeSourceVisualIds":["active id", "..."],"reason":"specific full-page evidence"}]}

Rules:
- Return a fresh complete whole-page inventory in top-to-bottom reading order. Never preserve or mechanically transform the prior candidate merely because it was previously confirmed.
- Every equation detection and activeFormulaSlot must have identical order, caption, exactText, and bbox. Every active bbox must tightly enclose exactly one complete displayed equation.
- Account for every original old source slot exactly once in priorSlotResolutions and every active slot through the exact inverse graph. Active ids are model-authored opaque slots on this source/page; do not deterministically migrate ids from the prior candidate.
- Treat the raw ordinary-review rejection and any prior candidate/reviewer history as evidence to inspect, not instructions to substitute text or split/merge a specific slot. If the full page cannot establish the complete inventory and graph safely, return a response that fails this contract rather than guessing.`);

const SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SYSTEM_PROMPT = breadSystemPrompt(`You independently review a model-authored whole-page formula inventory that proposes zero active formulas. The fresh high-resolution PDF PAGE IMAGE is primary evidence. The supplied candidate is diagnostic only.

Return ONLY one JSON object:
{"status":"confirmed|rejected","reason":"specific image-based evidence"}

Rules:
- Return confirmed only if the page visibly contains no active displayed formula that the candidate omitted.
- Return rejected if any displayed formula, numbered equation, or mathematical display remains active on the page, or if the empty inventory cannot be established safely.
- Do not author a replacement inventory, bbox, caption, equation text, or topology graph. Your rejection is feedback for a separate bounded whole-page authoring pass.
- Never approve from Markdown or prior model text alone.`);

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** The timer bounds one logical source-formula review, including its bounded
 * transport retries. Explicit environment overrides may deliberately choose a
 * shorter operational cap, but the default must not contradict that schedule. */
export function sourceFormulaReviewTimeoutMs(configuredTimeout?: unknown): number {
  const parsed = Number(configuredTimeout ?? process.env.SOURCE_FORMULA_REVIEW_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SOURCE_FORMULA_REVIEW_TIMEOUT_MS;
  return Math.max(
    MIN_SOURCE_FORMULA_REVIEW_TIMEOUT_MS,
    Math.min(parsed, MAX_SOURCE_FORMULA_REVIEW_TIMEOUT_MS),
  );
}

function defaultSourceFormulaReviewCacheRoot(): string {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return localAppData
    ? path.join(localAppData, "Breadboard", "cache", "source-formula-reviews")
    : path.join(os.tmpdir(), "breadboard-source-formula-reviews");
}

function canonicalSourcePageMarkdown(
  contentPath: string,
  gardenSlug: string,
  sourceId: string,
  pageNumber: number,
): string | null {
  return canonicalSourcePageMarkdownFromGardenDir(
    path.resolve(contentPath, gardenSlug),
    sourceId,
    pageNumber,
  );
}

function canonicalSourcePageMarkdownFromGardenDir(
  gardenDirInput: string,
  sourceId: string,
  pageNumber: number,
): string | null {
  const gardenDir = path.resolve(gardenDirInput);
  const sourcePath = path.resolve(gardenDir, "sources", `${sourceId}.md`);
  const relative = path.relative(gardenDir, sourcePath);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative) ||
    !fs.existsSync(sourcePath)
  ) {
    return null;
  }
  const source = fs.readFileSync(sourcePath, "utf-8");
  const pagePattern = new RegExp(
    `(?:^|\\n)(#{1,6}\\s+Page\\s+${pageNumber}\\s*\\r?\\n[\\s\\S]*?)(?=\\r?\\n#{1,6}\\s+Page\\s+\\d+\\s*(?:\\r?\\n|$)|$)`,
    "i",
  );
  const page = pagePattern.exec(source)?.[1]?.trim() ?? "";
  return page || null;
}

function sourceMarkdownPath(
  contentPath: string,
  gardenSlug: string,
  sourceId: string,
): string | null {
  const gardenDir = path.resolve(contentPath, gardenSlug);
  const candidate = path.resolve(gardenDir, "sources", `${sourceId}.md`);
  const relative = path.relative(gardenDir, candidate);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative) ||
    !fs.existsSync(candidate)
  ) {
    return null;
  }
  return candidate;
}

function sourcePdfEvidence(
  contentPath: string,
  gardenSlug: string,
  sourceId: string,
): { sourcePdfPath: string; sourcePdfSha256: string; sourcePdf: Buffer } {
  const markdownPath = sourceMarkdownPath(contentPath, gardenSlug, sourceId);
  if (!markdownPath) {
    throw new Error(`Source formula review cannot find canonical source note ${sourceId}.md.`);
  }
  const markdown = fs.readFileSync(markdownPath, "utf-8");
  const frontmatter = markdown.startsWith("---")
    ? markdown.slice(3, markdown.indexOf("\n---", 3) >= 0 ? markdown.indexOf("\n---", 3) : 3)
    : "";
  const match = frontmatter.match(
    /^source_pdf\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\r\n#]+))\s*$/im,
  );
  const sourcePdfUrl = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  const sourcePdfPath = sourcePdfUrl
    ? assetDiskPath(contentPath, gardenSlug, sourcePdfUrl)
    : null;
  if (
    !sourcePdfPath ||
    path.extname(sourcePdfPath).toLowerCase() !== ".pdf" ||
    !fs.existsSync(sourcePdfPath)
  ) {
    throw new Error(
      `Source formula review requires the preserved source PDF declared by ${sourceId}.md.`,
    );
  }
  const gardenRealPath = fs.realpathSync(path.resolve(contentPath, gardenSlug));
  const sourcePdfRealPath = fs.realpathSync(sourcePdfPath);
  const realRelative = path.relative(gardenRealPath, sourcePdfRealPath);
  if (
    !realRelative ||
    realRelative === ".." ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error(`Preserved source PDF for ${sourceId} resolves outside the garden.`);
  }
  const pdf = fs.readFileSync(sourcePdfRealPath);
  if (pdf.length === 0) {
    throw new Error(`Preserved source PDF for ${sourceId} is empty.`);
  }
  return { sourcePdfPath: sourcePdfRealPath, sourcePdfSha256: sha256(pdf), sourcePdf: pdf };
}

function normalizedReviewInput(visual: SourceVisual, equationCropSha256: string): SourceFormulaReviewInput {
  if (!visual.pageImagePath?.trim()) {
    throw new Error(`Source formula ${visual.sourceVisualId} has no authoritative page image path.`);
  }
  if (!visual.bbox) {
    throw new Error(`Source formula ${visual.sourceVisualId} has no detector bbox for independent review.`);
  }
  return {
    sourceVisualId: visual.sourceVisualId,
    sourceId: visual.sourceId,
    pageNumber: visual.pageNumber,
    pageImagePath: visual.pageImagePath,
    inputCaption: visual.caption.trim(),
    inputExactText: visual.exactText?.trim() ?? "",
    bbox: {
      x: visual.bbox.x,
      y: visual.bbox.y,
      width: visual.bbox.width,
      height: visual.bbox.height,
    },
    equationCropSha256,
  };
}

async function sourceFormulaPageEvidence(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  visuals: readonly SourceVisual[],
): Promise<SourceFormulaReviewPageEvidence[]> {
  const grouped = new Map<string, SourceVisual[]>();
  for (const visual of visuals) {
    const key = `${visual.sourceId}\u0000${visual.pageNumber}`;
    const page = grouped.get(key) ?? [];
    page.push(visual);
    grouped.set(key, page);
  }
  const pageGroups = [...grouped.values()].sort((left, right) => {
    const leftFirst = left[0];
    const rightFirst = right[0];
    if (!leftFirst || !rightFirst) return left.length - right.length;
    return leftFirst.sourceId.localeCompare(rightFirst.sourceId) ||
      leftFirst.pageNumber - rightFirst.pageNumber;
  });
  const pdfEvidenceBySource = new Map<string, ReturnType<typeof sourcePdfEvidence>>();
  for (const pageVisuals of pageGroups) {
    const first = pageVisuals[0];
    if (first && !pdfEvidenceBySource.has(first.sourceId)) {
      pdfEvidenceBySource.set(
        first.sourceId,
        sourcePdfEvidence(options.contentPath, options.gardenSlug, first.sourceId),
      );
    }
  }
  const renderedPages = new Map<string, Buffer>();
  for (const [sourceId, sourcePdf] of pdfEvidenceBySource) {
    const pageNumbers = pageGroups
      .filter((page) => page[0]?.sourceId === sourceId)
      .map((page) => page[0]!.pageNumber);
    if (options.renderPdfPage) {
      for (const pageNumber of pageNumbers) {
        options.checkCancelled?.();
        renderedPages.set(
          `${sourceId}\u0000${pageNumber}`,
          await options.renderPdfPage({
            sourceId,
            pageNumber,
            sourcePdfPath: sourcePdf.sourcePdfPath,
            sourcePdf: sourcePdf.sourcePdf,
          }),
        );
      }
      continue;
    }
    const parser = new PDFParse({ data: sourcePdf.sourcePdf });
    try {
      const info = await parser.getInfo();
      for (const pageNumber of pageNumbers) {
        options.checkCancelled?.();
        if (pageNumber > info.total) {
          throw new Error(
            `Preserved source PDF ${sourceId} has ${info.total} page(s), not page ${pageNumber}.`,
          );
        }
        const screenshot = await parser.getScreenshot({
          partial: [pageNumber],
          desiredWidth: 1600,
          imageBuffer: true,
          imageDataUrl: false,
        });
        const rendered = screenshot.pages.find((page) => page.pageNumber === pageNumber)?.data;
        if (!rendered?.length) {
          throw new Error(`Preserved source PDF page ${sourceId} p.${pageNumber} could not be rendered.`);
        }
        renderedPages.set(`${sourceId}\u0000${pageNumber}`, Buffer.from(rendered));
      }
    } finally {
      await parser.destroy();
    }
  }
  return pageGroups
    .map((pageVisuals): SourceFormulaReviewPageEvidence => {
      const first = pageVisuals[0];
      if (!first) throw new Error("Source formula review received an empty page batch.");
      if (pageVisuals.length > SOURCE_FORMULA_REVIEW_MAX_FORMULAS_PER_PAGE) {
        throw new Error(
          `Source page ${first.sourceId} p.${first.pageNumber} has ${pageVisuals.length} equations, above the bounded ${SOURCE_FORMULA_REVIEW_MAX_FORMULAS_PER_PAGE}-formula review limit.`,
        );
      }
      const pageImagePaths = new Set(pageVisuals.map((visual) => visual.pageImagePath?.trim() ?? ""));
      if (pageImagePaths.size !== 1 || !first.pageImagePath?.trim()) {
        throw new Error(
          `Source page ${first.sourceId} p.${first.pageNumber} does not have one authoritative page-image binding.`,
        );
      }
      if (pageNumberFromAssetUrl(first.pageImagePath) !== first.pageNumber) {
        throw new Error(
          `Source formula identity ${first.sourceVisualId} claims page ${first.pageNumber} but its snapshot URL encodes a different page.`,
        );
      }
      const pageImage = renderedPages.get(`${first.sourceId}\u0000${first.pageNumber}`);
      if (!pageImage) {
        throw new Error(
          `Fresh PDF render is missing for ${first.sourceId} p.${first.pageNumber}.`,
        );
      }
      if (pageImage.length === 0 || pageImage.length > SOURCE_FORMULA_REVIEW_MAX_PAGE_BYTES) {
        throw new Error(
          `Source page image for ${first.sourceId} p.${first.pageNumber} must be 1-${SOURCE_FORMULA_REVIEW_MAX_PAGE_BYTES} bytes.`,
        );
      }
      const canonicalPageText = canonicalSourcePageMarkdown(
        options.contentPath,
        options.gardenSlug,
        first.sourceId,
        first.pageNumber,
      );
      if (!canonicalPageText) {
        throw new Error(
          `Canonical Markdown context is missing for ${first.sourceId} p.${first.pageNumber}.`,
        );
      }
      if (canonicalPageText.length > SOURCE_FORMULA_REVIEW_MAX_PAGE_TEXT_CHARS) {
        throw new Error(
          `Canonical Markdown context for ${first.sourceId} p.${first.pageNumber} exceeds the bounded ${SOURCE_FORMULA_REVIEW_MAX_PAGE_TEXT_CHARS}-character review limit.`,
        );
      }
      const sourcePdf = pdfEvidenceBySource.get(first.sourceId);
      if (!sourcePdf) throw new Error(`Preserved source PDF evidence is missing for ${first.sourceId}.`);
      const crops = new Map<string, Buffer>();
      const inputs = pageVisuals
        .sort(sourceFormulaInputOrder)
        .map((visual) => {
          const identityPage = Number.parseInt(
            /^S\d+\.P(\d+)\.E\d+$/.exec(visual.sourceVisualId)?.[1] ?? "",
            10,
          );
          if (identityPage !== visual.pageNumber) {
            throw new Error(
              `Source formula identity ${visual.sourceVisualId} does not encode ledger page ${visual.pageNumber}.`,
            );
          }
          if (visual.type !== "equation" || !visual.exactText?.trim() || !visual.caption?.trim()) {
            throw new Error(
              `Source formula ${visual.sourceVisualId} must have equation type, exactText, and caption before review.`,
            );
          }
          if (!visual.bbox) {
            throw new Error(`Source formula ${visual.sourceVisualId} has no detector bbox.`);
          }
          const crop = cropPng(pageImage, expandedCropBBox(visual.bbox, "equation"));
          if (!crop?.length) {
            throw new Error(
              `Source formula ${visual.sourceVisualId} could not be cropped from its authoritative page image.`,
            );
          }
          crops.set(visual.sourceVisualId, crop);
          return normalizedReviewInput(visual, sha256(crop));
        });
      return {
        sourceId: first.sourceId,
        pageNumber: first.pageNumber,
        pageImagePath: first.pageImagePath,
        pageImage,
        pageImageSha256: sha256(pageImage),
        canonicalPageText,
        canonicalPageTextSha256: sha256(canonicalPageText),
        sourcePdfPath: sourcePdf.sourcePdfPath,
        sourcePdfSha256: sourcePdf.sourcePdfSha256,
        inputs,
        crops,
      };
    })
    .sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId) || left.pageNumber - right.pageNumber,
    );
}

type SourceFormulaReviewProtocol = "v1" | "v2";

function sourceFormulaReviewProtocolMetadata(
  protocol: SourceFormulaReviewProtocol,
): { promptVersion: 1 | 2; systemPromptSha256: string } {
  if (protocol === "v1") {
    return {
      promptVersion: SOURCE_FORMULA_REVIEW_LEGACY_PROMPT_VERSION,
      systemPromptSha256: SOURCE_FORMULA_REVIEW_LEGACY_SYSTEM_PROMPT_SHA256,
    };
  }
  return {
    promptVersion: SOURCE_FORMULA_REVIEW_PROMPT_VERSION,
    systemPromptSha256: sha256(SOURCE_FORMULA_REVIEW_SYSTEM_PROMPT),
  };
}

function pageReviewKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  inputs: readonly SourceFormulaReviewInput[] = evidence.inputs,
  protocol: SourceFormulaReviewProtocol = "v2",
): Record<string, unknown> {
  const protocolMetadata = sourceFormulaReviewProtocolMetadata(protocol);
  return {
    schemaVersion: SOURCE_FORMULA_REVIEW_SCHEMA_VERSION,
    promptVersion: protocolMetadata.promptVersion,
    systemPromptSha256: protocolMetadata.systemPromptSha256,
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    inputVisuals: inputs,
  };
}

function pageReviewCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  inputs: readonly SourceFormulaReviewInput[] = evidence.inputs,
  protocol: SourceFormulaReviewProtocol = "v2",
): string {
  return sha256(JSON.stringify(pageReviewKeyMaterial(evidence, model, inputs, protocol)));
}

function pageReviewRequestPayload(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  inputs: readonly SourceFormulaReviewInput[] = evidence.inputs,
  protocol: SourceFormulaReviewProtocol = "v2",
): string {
  const protocolMetadata = sourceFormulaReviewProtocolMetadata(protocol);
  return JSON.stringify({
    task: "Independently review every supplied formula record against the page image and labeled crop. Return the exact JSON response shape from the system prompt.",
    systemPromptSha256: protocolMetadata.systemPromptSha256,
    ...pageReviewKeyMaterial(evidence, model, inputs, protocol),
    canonicalPageText: evidence.canonicalPageText,
  });
}

function sourceFormulaReviewAttemptPayload(
  basePayload: string,
  repairHistory: readonly { rawResponse: string; diagnostic: string }[],
): string {
  if (repairHistory.length === 0) return basePayload;
  const prior = repairHistory[repairHistory.length - 1];
  return `${basePayload}\n\nThe prior response was invalid. Rereview the complete page batch and return a full replacement response. Here is the exact prior raw response and strict parse diagnostic:\n${JSON.stringify(prior)}`;
}

/**
 * Accept the one provider-format variation that remains unambiguous: a complete
 * response wrapped in a single JSON (or language-less) Markdown fence. Do not
 * extract JSON from surrounding prose; raw responses remain the audited record.
 */
function sourceFormulaReviewJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Find the closing quote even when the response contains an invalid escape. */
function sourceFormulaReviewJsonStringEnd(candidate: string, start: number): number | null {
  if (candidate[start] !== '"') return null;
  for (let index = start + 1; index < candidate.length; index += 1) {
    if (candidate[index] === "\\") {
      if (index + 1 >= candidate.length) return null;
      index += 1;
      continue;
    }
    if (candidate[index] === '"') return index;
  }
  return null;
}

function sourceFormulaReviewFormulaTextCandidate(value: string): {
  value: string;
  repaired: boolean;
} {
  let repaired = false;
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      output += character;
      continue;
    }
    const next = value[index + 1];
    if (!next) {
      output += character;
      continue;
    }
    const validUnicodeEscape =
      next === "u" && /^[0-9a-f]{4}$/i.test(value.slice(index + 2, index + 6));
    if (next === '"' || next === "\\" || next === "/" || validUnicodeEscape) {
      output += validUnicodeEscape ? value.slice(index, index + 6) : character + next;
      index += validUnicodeEscape ? 5 : 1;
      continue;
    }
    const nextAfter = value[index + 2];
    const texControlWord =
      (next === "b" || next === "f" || next === "n" || next === "r" || next === "t") &&
      (nextAfter === "{" || (nextAfter !== undefined && /^[a-z]$/i.test(nextAfter)));
    const validShortEscape =
      next === "b" || next === "f" || next === "n" || next === "r" || next === "t";
    if (texControlWord || !validShortEscape) {
      output += "\\\\" + next;
      repaired = true;
      index += 1;
      continue;
    }
    output += character + next;
    index += 1;
  }
  return { value: output, repaired };
}

/**
 * On a strict JSON parse failure only, repair literal LaTeX escapes solely in
 * an acceptedExactText value. All other response bytes stay parser-strict.
 */
function sourceFormulaReviewFormulaEscapeCandidate(candidate: string): {
  candidate: string;
  repaired: boolean;
} {
  let repaired = false;
  let output = "";
  let index = 0;
  while (index < candidate.length) {
    const stringStart = candidate.indexOf('"', index);
    if (stringStart < 0) {
      output += candidate.slice(index);
      break;
    }
    output += candidate.slice(index, stringStart);
    const keyEnd = sourceFormulaReviewJsonStringEnd(candidate, stringStart);
    if (keyEnd === null) {
      output += candidate.slice(stringStart);
      break;
    }
    output += candidate.slice(stringStart, keyEnd + 1);
    index = keyEnd + 1;
    if (candidate.slice(stringStart + 1, keyEnd) !== "acceptedExactText") continue;

    let valueStart = index;
    while (/\s/.test(candidate[valueStart] ?? "")) valueStart += 1;
    if (candidate[valueStart] !== ":") continue;
    valueStart += 1;
    while (/\s/.test(candidate[valueStart] ?? "")) valueStart += 1;
    if (candidate[valueStart] !== '"') continue;
    const valueEnd = sourceFormulaReviewJsonStringEnd(candidate, valueStart);
    if (valueEnd === null) continue;
    const normalized = sourceFormulaReviewFormulaTextCandidate(
      candidate.slice(valueStart + 1, valueEnd),
    );
    output += candidate.slice(index, valueStart + 1);
    output += normalized.value;
    output += candidate[valueEnd];
    repaired ||= normalized.repaired;
    index = valueEnd + 1;
  }
  return { candidate: output, repaired };
}

function parseSourceFormulaReviewJson(raw: string): unknown {
  const candidate = sourceFormulaReviewJsonCandidate(raw);
  try {
    return JSON.parse(candidate);
  } catch (originalError) {
    const repaired = sourceFormulaReviewFormulaEscapeCandidate(candidate);
    if (!repaired.repaired) throw originalError;
    try {
      return JSON.parse(repaired.candidate);
    } catch {
      throw originalError;
    }
  }
}

/** V1 accepted only raw JSON; retain that exact signed grammar for receipts. */
function parseSourceFormulaReviewJsonV1(raw: string): unknown {
  return JSON.parse(raw);
}

/**
 * Whether two LaTeX transcriptions denote the same string up to cosmetic
 * drift a reviewing model introduces while echoing supplied text: Unicode
 * normalisation form, insignificant whitespace, and outer math delimiters.
 */
export function sourceFormulaReviewLatexEquivalent(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const canonical = (value: string): string => {
    let text = value.normalize("NFC").trim();
    for (const [open, close] of [["$$", "$$"], ["\\[", "\\]"], ["\\(", "\\)"], ["$", "$"]]) {
      if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, text.length - close.length).trim();
        break;
      }
    }
    return text.replace(/\s+/gu, "");
  };
  return canonical(left) === canonical(right);
}

/**
 * Whether two captions read the same up to Unicode normalisation form,
 * whitespace runs, and a trailing full stop.
 */
export function sourceFormulaReviewCaptionEquivalent(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const canonical = (value: string): string =>
    value.normalize("NFC").replace(/\s+/gu, " ").trim().replace(/\.$/u, "").toLowerCase();
  return canonical(left) === canonical(right);
}

function parseSourceFormulaReviewResponse(
  raw: unknown,
  inputs: readonly SourceFormulaReviewInput[],
  protocol: SourceFormulaReviewProtocol = "v2",
): SourceFormulaReviewModelDecision[] {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SourceFormulaReviewProtocolError("response was empty or missing");
  }
  let parsed: unknown;
  try {
    parsed = protocol === "v1"
      ? parseSourceFormulaReviewJsonV1(raw)
      : parseSourceFormulaReviewJson(raw);
  } catch (error) {
    throw new SourceFormulaReviewProtocolError(
      `response was not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SourceFormulaReviewProtocolError("top level must be an object");
  }
  const top = parsed as Record<string, unknown>;
  if (Object.keys(top).length !== 1 || !Array.isArray(top.reviews)) {
    throw new SourceFormulaReviewProtocolError('top level must contain only a "reviews" array');
  }
  if (top.reviews.length !== inputs.length) {
    throw new SourceFormulaReviewProtocolError(
      `reviews must contain exactly ${inputs.length} entries; received ${top.reviews.length}`,
    );
  }

  const inputById = new Map(inputs.map((input) => [input.sourceVisualId, input]));
  const seen = new Set<string>();
  const decisions = top.reviews.map((value, index): SourceFormulaReviewModelDecision => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SourceFormulaReviewProtocolError(`reviews[${index}] must be an object`);
    }
    const record = value as Record<string, unknown>;
    const allowedKeys = new Set([
      "sourceVisualId",
      "action",
      "acceptedExactText",
      "acceptedCaption",
      "identityAssessment",
      "topologyAssessment",
      "reason",
    ]);
    const extraKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
    if (extraKeys.length > 0) {
      throw new SourceFormulaReviewProtocolError(
        `reviews[${index}] has unsupported keys: ${extraKeys.join(", ")}`,
      );
    }
    const sourceVisualId = typeof record.sourceVisualId === "string"
      ? record.sourceVisualId.trim()
      : "";
    const input = inputById.get(sourceVisualId);
    if (!input) {
      throw new SourceFormulaReviewProtocolError(
        `reviews[${index}].sourceVisualId must be one supplied id; received "${sourceVisualId || "(missing)"}"`,
      );
    }
    if (seen.has(sourceVisualId)) {
      throw new SourceFormulaReviewProtocolError(`duplicate review for ${sourceVisualId}`);
    }
    seen.add(sourceVisualId);

    const requestedAction = record.action;
    if (
      requestedAction !== "approve" &&
      requestedAction !== "replace" &&
      requestedAction !== "reject"
    ) {
      throw new SourceFormulaReviewProtocolError(
        `reviews[${index}].action must be approve, replace, or reject`,
      );
    }
    let action: SourceFormulaReviewAction = requestedAction;
    const identityAssessment = record.identityAssessment;
    if (
      identityAssessment !== "preserved" &&
      identityAssessment !== "identity_mismatch" &&
      identityAssessment !== "ambiguous" &&
      identityAssessment !== "unreadable"
    ) {
      throw new SourceFormulaReviewProtocolError(
        `reviews[${index}].identityAssessment is invalid`,
      );
    }
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (!reason || reason.length > SOURCE_FORMULA_REVIEW_MAX_REASON_CHARS) {
      throw new SourceFormulaReviewProtocolError(
        `reviews[${index}].reason must be 1-${SOURCE_FORMULA_REVIEW_MAX_REASON_CHARS} characters`,
      );
    }
    const rawAcceptedExactText = typeof record.acceptedExactText === "string"
      ? record.acceptedExactText
      : undefined;
    let acceptedExactText = rawAcceptedExactText
      ? rawAcceptedExactText.trim()
      : undefined;
    let acceptedCaption = typeof record.acceptedCaption === "string"
      ? record.acceptedCaption.trim()
      : undefined;
    const topologyAssessment: SourceFormulaTopologyAssessment | undefined =
      typeof record.topologyAssessment === "string"
        ? record.topologyAssessment as SourceFormulaTopologyAssessment
        : undefined;
    if (action === "reject") {
      if (identityAssessment === "preserved") {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}] reject must identify identity_mismatch, ambiguous, or unreadable evidence`,
        );
      }
      if (acceptedExactText) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}] reject must not provide acceptedExactText`,
        );
      }
      if (acceptedCaption) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}] reject must not provide acceptedCaption`,
        );
      }
      if (identityAssessment === "identity_mismatch") {
        if (
          topologyAssessment !== "same_slot" &&
          topologyAssessment !== "topology_change"
        ) {
          throw new SourceFormulaReviewProtocolError(
            `reviews[${index}].topologyAssessment must explicitly be same_slot or topology_change for identity_mismatch`,
          );
        }
      } else if (topologyAssessment !== undefined) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}].topologyAssessment is only valid for identity_mismatch`,
        );
      }
    } else {
      if (identityAssessment !== "preserved") {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}] ${action} requires identityAssessment=preserved`,
        );
      }
      if (!acceptedExactText || acceptedExactText.length > SOURCE_FORMULA_REVIEW_MAX_EXACT_TEXT_CHARS) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}].acceptedExactText must be 1-${SOURCE_FORMULA_REVIEW_MAX_EXACT_TEXT_CHARS} characters`,
        );
      }
      if (
        protocol === "v2" &&
        rawAcceptedExactText &&
        /[\u0000-\u001F\u007F]/.test(rawAcceptedExactText)
      ) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}].acceptedExactText must not contain control characters`,
        );
      }
      if (!acceptedCaption || acceptedCaption.length > SOURCE_FORMULA_REVIEW_MAX_CAPTION_CHARS) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}].acceptedCaption must be 1-${SOURCE_FORMULA_REVIEW_MAX_CAPTION_CHARS} characters`,
        );
      }
      if (
        action === "approve" &&
        (acceptedExactText !== input.inputExactText || acceptedCaption !== input.inputCaption)
      ) {
        // Models routinely echo an approved transcription with cosmetic drift
        // (NFC form, LaTeX spacing, math delimiters, caption punctuation).
        // "approve" means "keep the supplied fields", so cosmetic drift keeps
        // them verbatim; a substantive rewrite is the model's replacement with
        // identity preserved, which is exactly what "replace" denotes. Either
        // way the page review no longer dies after three identical attempts.
        if (
          sourceFormulaReviewLatexEquivalent(acceptedExactText, input.inputExactText) &&
          sourceFormulaReviewCaptionEquivalent(acceptedCaption, input.inputCaption)
        ) {
          acceptedExactText = input.inputExactText;
          acceptedCaption = input.inputCaption;
        } else {
          action = "replace";
        }
      }
      if (topologyAssessment !== undefined) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}].topologyAssessment is only valid for identity_mismatch`,
        );
      }
      if (
        action === "replace" &&
        acceptedExactText === input.inputExactText &&
        acceptedCaption === input.inputCaption
      ) {
        throw new SourceFormulaReviewProtocolError(
          `reviews[${index}] replace must change acceptedExactText or acceptedCaption`,
        );
      }
    }
    return {
      sourceVisualId,
      action,
      ...(acceptedExactText ? { acceptedExactText } : {}),
      ...(acceptedCaption ? { acceptedCaption } : {}),
      identityAssessment,
      reason,
      ...(topologyAssessment ? { topologyAssessment } : {}),
    };
  });

  const missing = inputs
    .map((input) => input.sourceVisualId)
    .filter((sourceVisualId) => !seen.has(sourceVisualId));
  if (missing.length > 0) {
    throw new SourceFormulaReviewProtocolError(`missing reviews for ${missing.join(", ")}`);
  }
  return decisions.sort((left, right) => left.sourceVisualId.localeCompare(right.sourceVisualId));
}

function sourceFormulaReviewEnvelopeIntegrity(
  unsigned: SourceFormulaReviewCacheEnvelopeUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

function sourceFormulaReviewCacheDir(cacheRoot: string, cacheKey: string): string {
  return path.join(cacheRoot, cacheKey.slice(0, 2));
}

interface SourceFormulaExternalCacheWriteState {
  reviewDegraded: boolean;
  artifactRecoveryDegraded: boolean;
}

function reviewRecordFileName(cacheKey: string, integritySha256: string): string {
  return `${cacheKey}.${integritySha256}.json`;
}

function sourceFormulaReviewRecordRelativePath(
  cacheKey: string,
  integritySha256: string,
): string {
  return path.join(
    SOURCE_FORMULA_REVIEW_RECORDS_RELATIVE_DIR,
    reviewRecordFileName(cacheKey, integritySha256),
  ).replace(/\\/g, "/");
}

function cacheEnvelopeMatches(
  envelope: SourceFormulaReviewCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  expectedInputs: SourceFormulaReviewInput[],
  expectedCacheKey: string,
): boolean {
  try {
    if (!Array.isArray(envelope.repairHistory)) return false;
    for (const repair of envelope.repairHistory) {
      if (
        !repair ||
        typeof repair.rawResponse !== "string" ||
        typeof repair.diagnostic !== "string" ||
        !repair.diagnostic
      ) return false;
      try {
        parseSourceFormulaReviewResponse(repair.rawResponse, expectedInputs);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) {
          return false;
        }
      }
    }
    const expectedBasePayload = pageReviewRequestPayload(evidence, model, expectedInputs);
    const expectedRequestPayload = sourceFormulaReviewAttemptPayload(
      expectedBasePayload,
      envelope.repairHistory,
    );
    if (
      envelope.schemaVersion !== SOURCE_FORMULA_REVIEW_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_REVIEW_PROMPT_VERSION ||
      envelope.cacheKey !== expectedCacheKey ||
      envelope.model !== model ||
      envelope.sourceId !== evidence.sourceId ||
      envelope.pageNumber !== evidence.pageNumber ||
      envelope.pageImageSha256 !== evidence.pageImageSha256 ||
      envelope.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      envelope.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      envelope.systemPromptSha256 !== sha256(SOURCE_FORMULA_REVIEW_SYSTEM_PROMPT) ||
      envelope.requestPayload !== expectedRequestPayload ||
      envelope.requestSha256 !== sha256(expectedRequestPayload) ||
      envelope.responseSha256 !== sha256(envelope.rawResponse) ||
      !Number.isSafeInteger(envelope.semanticAttempt) ||
      envelope.semanticAttempt < 1 ||
      envelope.semanticAttempt > SOURCE_FORMULA_REVIEW_MAX_SEMANTIC_ATTEMPTS ||
      envelope.semanticAttempt !== envelope.repairHistory.length + 1 ||
      !envelope.reviewedAt ||
      JSON.stringify(envelope.inputVisuals) !== JSON.stringify(expectedInputs)
    ) {
      return false;
    }
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaReviewEnvelopeIntegrity(unsigned)) return false;
    const parsedReviews = parseSourceFormulaReviewResponse(envelope.rawResponse, expectedInputs);
    if (parsedReviews.some((review) => review.action === "reject")) return false;
    return JSON.stringify(parsedReviews) === JSON.stringify(envelope.reviews);
  } catch {
    return false;
  }
}

function loadSourceFormulaReviewCache(
  cacheRoot: string,
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  expectedInputs: SourceFormulaReviewInput[],
): SourceFormulaReviewCacheEnvelope | null {
  const cacheKey = pageReviewCacheKey(evidence, model, expectedInputs);
  const directory = sourceFormulaReviewCacheDir(cacheRoot, cacheKey);
  try {
    const parsed = JSON.parse(readFileSyncWithRetry(path.join(directory, `${cacheKey}.json`), "utf-8")) as
      SourceFormulaReviewCacheEnvelope;
    return cacheEnvelopeMatches(parsed, evidence, model, expectedInputs, cacheKey)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function saveSourceFormulaReviewCache(
  cacheRoot: string,
  evidence: SourceFormulaReviewPageEvidence,
  envelope: SourceFormulaReviewCacheEnvelope,
  writeState: SourceFormulaExternalCacheWriteState,
): void {
  if (writeState.reviewDegraded) return;
  const directory = sourceFormulaReviewCacheDir(cacheRoot, envelope.cacheKey);
  const finalPath = path.join(directory, `${envelope.cacheKey}.json`);
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  // External cache persistence is performance-only. Exhausted filesystem
  // retries degrade to an uncached result; durable garden evidence below is
  // still written and validated fail-closed.
  const published = publishExternalCacheFileAtomically({
    finalPath,
    content: serialized,
    validateWinner(content) {
      let existing: SourceFormulaReviewCacheEnvelope;
      try {
        existing = JSON.parse(content.toString("utf-8")) as SourceFormulaReviewCacheEnvelope;
      } catch {
        return false;
      }
      return cacheEnvelopeMatches(
        existing,
        evidence,
        envelope.model,
        envelope.inputVisuals,
        envelope.cacheKey,
      );
    },
  });
  if (published.status === "degraded") writeState.reviewDegraded = true;
}

function sourceFormulaReviewRecordDiskPath(
  contentPath: string,
  gardenSlug: string,
  relativePath: string,
): string | null {
  return sourceFormulaReviewRecordDiskPathFromGardenDir(
    path.resolve(contentPath, gardenSlug),
    relativePath,
  );
}

function sourceFormulaReviewRecordDiskPathFromGardenDir(
  gardenDirInput: string,
  relativePath: string,
): string | null {
  const normalized = relativePath.trim().replace(/\\/g, "/");
  if (!normalized.startsWith(".breadboard/source-formula-reviews/")) return null;
  const gardenDir = path.resolve(gardenDirInput);
  const candidate = path.resolve(gardenDir, ...normalized.split("/"));
  const relative = path.relative(gardenDir, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) return null;
  return candidate;
}

function loadPersistedSourceFormulaReviewRecord(
  contentPath: string,
  gardenSlug: string,
  relativePath: string,
): SourceFormulaReviewCacheEnvelope | null {
  const recordPath = sourceFormulaReviewRecordDiskPath(contentPath, gardenSlug, relativePath);
  if (!recordPath) return null;
  try {
    return JSON.parse(fs.readFileSync(recordPath, "utf-8")) as SourceFormulaReviewCacheEnvelope;
  } catch {
    return null;
  }
}

function persistSourceFormulaReviewRecord(
  contentPath: string,
  gardenSlug: string,
  envelope: SourceFormulaReviewCacheEnvelope,
): string {
  const relativePath = sourceFormulaReviewRecordRelativePath(
    envelope.cacheKey,
    envelope.integritySha256,
  );
  const recordPath = sourceFormulaReviewRecordDiskPath(contentPath, gardenSlug, relativePath);
  if (!recordPath) throw new Error("Refusing to persist formula-review evidence outside the garden.");
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  if (fs.existsSync(recordPath)) {
    if (fs.readFileSync(recordPath, "utf-8") !== serialized) {
      throw new Error(`Conflicting durable formula-review record already exists at ${relativePath}.`);
    }
    return relativePath;
  }
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  const temporaryPath = `${recordPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, "utf-8");
  try {
    fs.renameSync(temporaryPath, recordPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the atomic create failure.
    }
    if (!fs.existsSync(recordPath) || fs.readFileSync(recordPath, "utf-8") !== serialized) {
      throw error;
    }
  }
  return relativePath;
}

function sourceFormulaReviewedPageRelativePath(
  evidence: SourceFormulaReviewPageEvidence,
): string {
  const fileName = `${slugify(evidence.sourceId)}-page-${String(evidence.pageNumber).padStart(4, "0")}-${evidence.pageImageSha256}.png`;
  return path.join(SOURCE_FORMULA_REVIEW_RECORDS_RELATIVE_DIR, "evidence", fileName)
    .replace(/\\/g, "/");
}

function persistSourceFormulaReviewedPage(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): string {
  const relativePath = sourceFormulaReviewedPageRelativePath(evidence);
  const normalized = relativePath.replace(/\\/g, "/");
  const gardenDir = path.resolve(contentPath, gardenSlug);
  const evidencePath = path.resolve(gardenDir, ...normalized.split("/"));
  const relative = path.relative(gardenDir, evidencePath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) throw new Error("Refusing to persist reviewed PDF-page evidence outside the garden.");
  if (fs.existsSync(evidencePath)) {
    if (sha256(fs.readFileSync(evidencePath)) !== evidence.pageImageSha256) {
      throw new Error(`Conflicting reviewed PDF-page evidence already exists at ${relativePath}.`);
    }
    return relativePath;
  }
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, evidence.pageImage);
  try {
    fs.renameSync(temporaryPath, evidencePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the atomic create failure.
    }
    if (!fs.existsSync(evidencePath) || sha256(fs.readFileSync(evidencePath)) !== evidence.pageImageSha256) {
      throw error;
    }
  }
  return relativePath;
}

function sourceFormulaReviewedCropUrl(
  gardenSlug: string,
  sourceVisualId: string,
  cropSha256: string,
): string {
  return `/${gardenSlug}/assets/source-visuals/${slugify(sourceVisualId)}-reviewed-${cropSha256}.png`;
}

function sourceFormulaArtifactRecoveryVisualCropUrl(
  gardenSlug: string,
  sourceVisualId: string,
  cropSha256: string,
): string {
  return `/${gardenSlug}/assets/source-visuals/${slugify(sourceVisualId)}-recovered-${cropSha256}.png`;
}

function persistSourceFormulaReviewedCrop(
  contentPath: string,
  gardenSlug: string,
  sourceVisualId: string,
  crop: Buffer,
): string {
  const cropSha256 = sha256(crop);
  const url = sourceFormulaReviewedCropUrl(gardenSlug, sourceVisualId, cropSha256);
  const cropPath = assetDiskPath(contentPath, gardenSlug, url);
  if (!cropPath) throw new Error(`Refusing to persist reviewed crop for ${sourceVisualId} outside the garden.`);
  if (fs.existsSync(cropPath)) {
    if (sha256(fs.readFileSync(cropPath)) !== cropSha256) {
      throw new Error(`Conflicting reviewed equation crop already exists for ${sourceVisualId}.`);
    }
    return url;
  }
  fs.mkdirSync(path.dirname(cropPath), { recursive: true });
  const temporaryPath = `${cropPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, crop);
  try {
    fs.renameSync(temporaryPath, cropPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the atomic create failure.
    }
    if (!fs.existsSync(cropPath) || sha256(fs.readFileSync(cropPath)) !== cropSha256) throw error;
  }
  return url;
}

function persistSourceFormulaArtifactRecoveryVisualCrop(
  contentPath: string,
  gardenSlug: string,
  sourceVisualId: string,
  crop: Buffer,
): string {
  const cropSha256 = sha256(crop);
  const url = sourceFormulaArtifactRecoveryVisualCropUrl(
    gardenSlug,
    sourceVisualId,
    cropSha256,
  );
  const cropPath = assetDiskPath(contentPath, gardenSlug, url);
  if (!cropPath) {
    throw new Error("Refusing to persist recovered source visual crop outside the garden.");
  }
  if (fs.existsSync(cropPath)) {
    if (sha256(fs.readFileSync(cropPath)) !== cropSha256) {
      throw new Error("Conflicting recovered source visual crop already exists for " + sourceVisualId + ".");
    }
    return url;
  }
  fs.mkdirSync(path.dirname(cropPath), { recursive: true });
  const temporaryPath = cropPath + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temporaryPath, crop);
  try {
    fs.renameSync(temporaryPath, cropPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the atomic create failure.
    }
    if (!fs.existsSync(cropPath) || sha256(fs.readFileSync(cropPath)) !== cropSha256) {
      throw error;
    }
  }
  return url;
}

function sourceFormulaReviewOriginalInputs(
  evidence: SourceFormulaReviewPageEvidence,
  visualById: ReadonlyMap<string, SourceVisual>,
): SourceFormulaReviewInput[] | null {
  const original: SourceFormulaReviewInput[] = [];
  for (const current of evidence.inputs) {
    const visual = visualById.get(current.sourceVisualId);
    const provenance = visual?.formulaReview;
    if (
      !visual ||
      !provenance ||
      visual.exactText?.trim() !== provenance.acceptedExactText ||
      visual.caption.trim() !== provenance.acceptedCaption ||
      provenance.equationCropSha256 !== current.equationCropSha256
    ) return null;
    original.push({
      ...current,
      inputExactText: provenance.inputExactText,
      inputCaption: provenance.inputCaption,
    });
  }
  return original;
}

function linkedSourceFormulaReviewEnvelope(
  contentPath: string,
  gardenSlug: string,
  cacheRoot: string,
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  visualById: ReadonlyMap<string, SourceVisual>,
): SourceFormulaReviewCacheEnvelope | null {
  const originalInputs = sourceFormulaReviewOriginalInputs(evidence, visualById);
  if (!originalInputs) return null;
  const provenances = evidence.inputs.map((input) => visualById.get(input.sourceVisualId)?.formulaReview);
  const first = provenances[0];
  if (
    !first ||
    provenances.some((provenance) =>
      !provenance ||
      provenance.cacheKey !== first.cacheKey ||
      provenance.cacheIntegritySha256 !== first.cacheIntegritySha256 ||
      provenance.reviewRecordPath !== first.reviewRecordPath ||
      provenance.model !== model)
  ) return null;
  const expectedKey = pageReviewCacheKey(evidence, model, originalInputs);
  if (first.cacheKey !== expectedKey) return null;
  const persisted = loadPersistedSourceFormulaReviewRecord(
    contentPath,
    gardenSlug,
    first.reviewRecordPath,
  );
  if (
    persisted &&
    persisted.integritySha256 === first.cacheIntegritySha256 &&
    cacheEnvelopeMatches(persisted, evidence, model, originalInputs, expectedKey)
  ) return persisted;
  return loadSourceFormulaReviewCache(cacheRoot, evidence, model, originalInputs);
}

async function requestSourceFormulaPageReview(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
): Promise<SourceFormulaReviewCacheEnvelope> {
  const repairHistory: Array<{ rawResponse: string; diagnostic: string }> = [];
  const basePayload = pageReviewRequestPayload(evidence, options.model, evidence.inputs);
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_FORMULA_REVIEW_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    options.checkCancelled?.();
    const requestPayload = sourceFormulaReviewAttemptPayload(basePayload, repairHistory);
    options.onProgress?.(
      `Reviewing source formulas on ${evidence.sourceId} p.${evidence.pageNumber} (${semanticAttempt}/${SOURCE_FORMULA_REVIEW_MAX_SEMANTIC_ATTEMPTS})...`,
    );
    let rawResponse = "";
    {
      const content: Array<Record<string, unknown>> = [
        { type: "text", text: requestPayload },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${evidence.pageImage.toString("base64")}`,
            detail: "high",
          },
        },
      ];
      for (const input of evidence.inputs) {
        const crop = evidence.crops.get(input.sourceVisualId);
        if (!crop) throw new Error(`Missing formula crop for ${input.sourceVisualId}.`);
        content.push(
          {
            type: "text",
            text: `Labeled crop for ${input.sourceVisualId}; bbox=${JSON.stringify(input.bbox)}`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${crop.toString("base64")}`, detail: "high" },
          },
        );
      }
      const response = await createSourceModelCompletionWithHttp502Retry({
        client: options.client,
        request: {
          model: options.model,
          messages: [
            { role: "system", content: SOURCE_FORMULA_REVIEW_SYSTEM_PROMPT },
            { role: "user", content: content as never },
          ],
        },
        timeoutMs: sourceFormulaReviewTimeoutMs(),
        checkpoint: options.checkCancelled,
        onProgress: options.onProgress,
        stageLabel: `source formula review on ${evidence.sourceId} p.${evidence.pageNumber}`,
      });
      rawResponse = response.choices[0]?.message?.content ?? "";
    }
    assertNonemptySourceFormulaModelResponse(rawResponse, "formula page review");

    let reviews: SourceFormulaReviewModelDecision[];
    try {
      reviews = parseSourceFormulaReviewResponse(rawResponse, evidence.inputs);
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewProtocolError)) throw error;
      if (semanticAttempt >= SOURCE_FORMULA_REVIEW_MAX_SEMANTIC_ATTEMPTS) throw error;
      repairHistory.push({ rawResponse, diagnostic: error.message });
      continue;
    }
    const rejected = reviews.filter((review) => review.action === "reject");
    if (rejected.length > 0) {
      const failedReview: SourceFormulaArtifactRecoveryFailedReview = {
        model: options.model,
        cacheKey: pageReviewCacheKey(evidence, options.model, evidence.inputs),
        requestPayload,
        requestSha256: sha256(requestPayload),
        rawResponse,
        responseSha256: sha256(rawResponse),
        semanticAttempt,
        repairHistory: [...repairHistory],
        inputVisuals: evidence.inputs,
      };
      throw new SourceFormulaReviewRejectedError([{
        sourceId: evidence.sourceId,
        pageNumber: evidence.pageNumber,
        evidence,
        failedReview,
        rejections: rejected.map((review) => ({
          sourceVisualId: review.sourceVisualId,
          identityAssessment: review.identityAssessment as Exclude<
            SourceFormulaIdentityAssessment,
            "preserved"
          >,
          reason: review.reason,
          ...(review.topologyAssessment ? { topologyAssessment: review.topologyAssessment } : {}),
        })),
      }], semanticAttempt);
    }
    const cacheKey = pageReviewCacheKey(evidence, options.model, evidence.inputs);
    const unsigned: SourceFormulaReviewCacheEnvelopeUnsigned = {
      schemaVersion: SOURCE_FORMULA_REVIEW_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_REVIEW_PROMPT_VERSION,
      cacheKey,
      model: options.model,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImageSha256: evidence.pageImageSha256,
      canonicalPageTextSha256: evidence.canonicalPageTextSha256,
      sourcePdfSha256: evidence.sourcePdfSha256,
      systemPromptSha256: sha256(SOURCE_FORMULA_REVIEW_SYSTEM_PROMPT),
      requestPayload,
      requestSha256: sha256(requestPayload),
      repairHistory,
      rawResponse,
      responseSha256: sha256(rawResponse),
      semanticAttempt,
      reviewedAt: options.now?.() ?? new Date().toISOString(),
      inputVisuals: evidence.inputs,
      reviews,
    };
    return {
      ...unsigned,
      integritySha256: sourceFormulaReviewEnvelopeIntegrity(unsigned),
    };
  }
  throw new SourceFormulaReviewProtocolError("bounded semantic review attempts were exhausted");
}

function sourceFormulaArtifactRecoveryCacheRoot(cacheRoot: string): string {
  return path.join(cacheRoot, SOURCE_FORMULA_ARTIFACT_RECOVERY_CACHE_FOLDER);
}

function sameSourceVisualBBox(left: SourceVisualBBox, right: SourceVisualBBox): boolean {
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
}

function sourceFormulaArtifactRecoveryInputs(
  rejectedPage: SourceFormulaReviewRejectedPage,
): SourceFormulaArtifactRecoveryInput[] {
  const rejectedById = new Map(
    rejectedPage.rejections.map((review) => [review.sourceVisualId, review]),
  );
  if (
    rejectedById.size !== rejectedPage.rejections.length ||
    rejectedPage.rejections.some((review) => review.identityAssessment !== "identity_mismatch")
  ) {
    throw new SourceFormulaReviewRejectedError([rejectedPage], 0);
  }
  return rejectedPage.evidence.inputs.map((input) => {
    const rejection = rejectedById.get(input.sourceVisualId);
    return {
      sourceVisualId: input.sourceVisualId,
      sourceId: input.sourceId,
      pageNumber: input.pageNumber,
      inputCaption: input.inputCaption,
      inputExactText: input.inputExactText,
      inputBBox: { ...input.bbox },
      inputEquationCropSha256: input.equationCropSha256,
      reviewerIdentityAssessment: rejection?.identityAssessment === "identity_mismatch"
        ? "identity_mismatch"
        : null,
      reviewerReason: rejection?.identityAssessment === "identity_mismatch"
        ? rejection.reason
        : null,
    };
  });
}

function sourceFormulaArtifactRecoveryKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): Record<string, unknown> {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_RECOVERY_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_RECOVERY_PROMPT_VERSION,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_RECOVERY_SYSTEM_PROMPT),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImagePath: evidence.pageImagePath,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    failedReview,
    inputVisuals: inputs,
  };
}

function sourceFormulaArtifactRecoveryCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): string {
  return sha256(JSON.stringify(
    sourceFormulaArtifactRecoveryKeyMaterial(evidence, model, failedReview, inputs),
  ));
}

function sourceFormulaArtifactRecoveryRequestPayload(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): string {
  return JSON.stringify({
    task: "Use the fresh high-resolution PDF page image to re-detect every meaningful page visual and re-author every supplied formula slot. Return the exact JSON response shape from the system prompt.",
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_RECOVERY_SYSTEM_PROMPT),
    ...sourceFormulaArtifactRecoveryKeyMaterial(evidence, model, failedReview, inputs),
    canonicalPageText: evidence.canonicalPageText,
    // The raw rejected review is intentionally passed without a code-written
    // summary, so the recovery model receives the exact reviewer feedback.
    failedReviewerResponseVerbatim: failedReview.rawResponse,
  });
}

function sourceFormulaArtifactRecoveryAttemptPayload(
  basePayload: string,
  repairHistory: readonly { rawResponse: string; diagnostic: string }[],
): string {
  if (repairHistory.length === 0) return basePayload;
  const prior = repairHistory[repairHistory.length - 1];
  return basePayload +
    "\n\nThe prior whole-page recovery response was invalid. Re-detect the complete page and return a full replacement response. Here is the exact prior raw response and strict parse diagnostic:\n" +
    JSON.stringify(prior);
}

function strictSourceFormulaArtifactRecoveryBBox(
  value: unknown,
  label: string,
): SourceVisualBBox {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceFormulaReviewProtocolError(label + ".bbox must be an object");
  }
  const raw = value as Record<string, unknown>;
  const expectedKeys = ["height", "width", "x", "y"];
  if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(expectedKeys)) {
    throw new SourceFormulaReviewProtocolError(
      label + ".bbox must contain only x, y, width, and height",
    );
  }
  const validated = validateDetectionRecords([{
    type: "equation",
    caption: "recovery bbox validation",
    exactText: "x",
    bbox: raw,
  }])[0];
  if (!validated?.bbox) {
    throw new SourceFormulaReviewProtocolError(label + ".bbox did not validate");
  }
  return validated.bbox;
}

function sourceFormulaArtifactRecoveryResponse(
  raw: unknown,
  evidence: SourceFormulaReviewPageEvidence,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): {
  detections: SourceVisualDetection[];
  replacements: SourceFormulaArtifactRecoveryReplacement[];
} {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SourceFormulaReviewProtocolError("formula-artifact recovery response was empty or missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SourceFormulaReviewProtocolError(
      "formula-artifact recovery response was not valid JSON (" +
        (error instanceof Error ? error.message : String(error)) + ")",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SourceFormulaReviewProtocolError("formula-artifact recovery top level must be an object");
  }
  const top = parsed as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(top).sort()) !==
      JSON.stringify(["detections", "formulaReplacements"]) ||
    !Array.isArray(top.detections) ||
    !Array.isArray(top.formulaReplacements)
  ) {
    throw new SourceFormulaReviewProtocolError(
      'formula-artifact recovery top level must contain only "detections" and "formulaReplacements" arrays',
    );
  }
  const detections = validateDetectionRecords(top.detections);
  if (top.formulaReplacements.length !== inputs.length) {
    throw new SourceFormulaReviewProtocolError(
      "formula-artifact recovery must return exactly " + inputs.length +
        " formula replacements; received " + top.formulaReplacements.length,
    );
  }
  const crops = new Set<string>();
  const replacements = top.formulaReplacements.map((value, index): SourceFormulaArtifactRecoveryReplacement => {
    const label = "formulaReplacements[" + index + "]";
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SourceFormulaReviewProtocolError(label + " must be an object");
    }
    const record = value as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(record).sort()) !==
        JSON.stringify(["bbox", "caption", "exactText", "sourceVisualId"])
    ) {
      throw new SourceFormulaReviewProtocolError(
        label + " must contain only sourceVisualId, caption, exactText, and bbox",
      );
    }
    const input = inputs[index];
    const sourceVisualId = typeof record.sourceVisualId === "string" ? record.sourceVisualId : "";
    if (!input || sourceVisualId !== input.sourceVisualId) {
      throw new SourceFormulaReviewProtocolError(
        label + ".sourceVisualId must preserve the exact supplied page-slot order",
      );
    }
    const caption = typeof record.caption === "string" ? record.caption.trim() : "";
    const exactText = typeof record.exactText === "string" ? record.exactText.trim() : "";
    if (!caption || caption.length > SOURCE_FORMULA_REVIEW_MAX_CAPTION_CHARS) {
      throw new SourceFormulaReviewProtocolError(
        label + ".caption must be 1-" + SOURCE_FORMULA_REVIEW_MAX_CAPTION_CHARS + " characters",
      );
    }
    if (!exactText || exactText.length > SOURCE_FORMULA_REVIEW_MAX_EXACT_TEXT_CHARS) {
      throw new SourceFormulaReviewProtocolError(
        label + ".exactText must be 1-" + SOURCE_FORMULA_REVIEW_MAX_EXACT_TEXT_CHARS + " characters",
      );
    }
    const bbox = strictSourceFormulaArtifactRecoveryBBox(record.bbox, label);
    const crop = cropPng(evidence.pageImage, expandedCropBBox(bbox, "equation"));
    if (!crop?.length) {
      throw new SourceFormulaReviewProtocolError(label + ".bbox cannot be cropped from the fresh PDF render");
    }
    const equationCropSha256 = sha256(crop);
    if (crops.has(equationCropSha256)) {
      throw new SourceFormulaReviewProtocolError(
        label + ".bbox duplicates another formula slot's crop",
      );
    }
    crops.add(equationCropSha256);
    if (
      input.reviewerIdentityAssessment === "identity_mismatch" &&
      equationCropSha256 === input.inputEquationCropSha256
    ) {
      throw new SourceFormulaReviewProtocolError(
        label + ".bbox repeated the reviewer-rejected stale crop",
      );
    }
    return { sourceVisualId, caption, exactText, bbox, equationCropSha256 };
  });
  const equationDetections = detections.filter((detection) => detection.type === "equation");
  if (equationDetections.length !== replacements.length) {
    throw new SourceFormulaReviewProtocolError(
      "formula-artifact recovery must return exactly " + replacements.length +
        " equation detections; received " + equationDetections.length,
    );
  }
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index]!;
    const detection = equationDetections[index]!;
    if (
      detection.caption !== replacement.caption ||
      detection.exactText !== replacement.exactText ||
      !detection.bbox ||
      !sameSourceVisualBBox(detection.bbox, replacement.bbox)
    ) {
      throw new SourceFormulaReviewProtocolError(
        "formula-artifact recovery equation detection " + (index + 1) +
          " must exactly match its formula replacement",
      );
    }
  }
  return { detections, replacements };
}

function sourceFormulaArtifactTopologyRecoveryKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): Record<string, unknown> {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_PROMPT_VERSION,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SYSTEM_PROMPT),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImagePath: evidence.pageImagePath,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    failedReview,
    inputVisuals: inputs,
  };
}

function sourceFormulaArtifactTopologyRecoveryCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): string {
  return sha256(JSON.stringify(
    sourceFormulaArtifactTopologyRecoveryKeyMaterial(evidence, model, failedReview, inputs),
  ));
}

function sourceFormulaArtifactTopologyRecoveryRequestPayload(
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): string {
  return JSON.stringify({
    task: "Use the fresh high-resolution PDF page image to author a complete whole-page visual inventory and an exact old-slot to active-formula topology graph. Return the exact JSON response shape from the system prompt.",
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SYSTEM_PROMPT),
    ...sourceFormulaArtifactTopologyRecoveryKeyMaterial(evidence, model, failedReview, inputs),
    canonicalPageText: evidence.canonicalPageText,
    failedReviewerResponseVerbatim: failedReview.rawResponse,
  });
}

function sourceFormulaArtifactTopologyRecoveryAttemptPayload(
  basePayload: string,
  repairHistory: readonly { rawResponse: string; diagnostic: string }[],
): string {
  if (repairHistory.length === 0) return basePayload;
  const prior = repairHistory[repairHistory.length - 1];
  return basePayload +
    "\n\nThe prior topology recovery response was invalid. Re-detect the complete page and return a complete replacement graph. Here is the exact prior raw response and strict parse diagnostic:\n" +
    JSON.stringify(prior);
}

function sourceFormulaArtifactTopologySlotIdentity(
  sourceVisualId: string,
  sourceIndex: number,
  pageNumber: number,
): boolean {
  const match = /^S(\d+)\.P(\d+)\.E(\d+)$/i.exec(sourceVisualId.trim());
  return Boolean(
    match &&
    Number.parseInt(match[1]!, 10) === sourceIndex &&
    Number.parseInt(match[2]!, 10) === pageNumber &&
    Number.parseInt(match[3]!, 10) > 0,
  );
}

function sourceFormulaArtifactTopologyRecoveryResponse(
  raw: unknown,
  evidence: SourceFormulaReviewPageEvidence,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): {
  detections: SourceVisualDetection[];
  activeFormulaSlots: SourceFormulaArtifactTopologyActiveSlot[];
  priorSlotResolutions: SourceFormulaArtifactTopologyPriorResolution[];
} {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SourceFormulaReviewProtocolError("formula-artifact topology recovery response was empty or missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SourceFormulaReviewProtocolError(
      "formula-artifact topology recovery response was not valid JSON (" +
        (error instanceof Error ? error.message : String(error)) + ")",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SourceFormulaReviewProtocolError("formula-artifact topology recovery top level must be an object");
  }
  const top = parsed as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(top).sort()) !==
      JSON.stringify(["activeFormulaSlots", "detections", "priorSlotResolutions"]) ||
    !Array.isArray(top.detections) ||
    !Array.isArray(top.activeFormulaSlots) ||
    !Array.isArray(top.priorSlotResolutions)
  ) {
    throw new SourceFormulaReviewProtocolError(
      'formula-artifact topology recovery must contain only "detections", "activeFormulaSlots", and "priorSlotResolutions" arrays',
    );
  }
  const detections = validateDetectionRecords(top.detections);
  const sourceIndex = sourceIndexFromVisualId(inputs[0]?.sourceVisualId ?? "");
  if (sourceIndex === null) {
    throw new SourceFormulaReviewProtocolError("formula-artifact topology recovery cannot resolve the stable source slot");
  }
  const suppliedIds = inputs.map((input) => input.sourceVisualId);
  const suppliedIdSet = new Set(suppliedIds);
  if (top.priorSlotResolutions.length !== inputs.length) {
    throw new SourceFormulaReviewProtocolError(
      "formula-artifact topology recovery must resolve every supplied old formula slot exactly once",
    );
  }
  const crops = new Set<string>();
  const activeIds = new Set<string>();
  const activeFormulaSlots = top.activeFormulaSlots.map((value, index): SourceFormulaArtifactTopologyActiveSlot => {
    const label = "activeFormulaSlots[" + index + "]";
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SourceFormulaReviewProtocolError(label + " must be an object");
    }
    const record = value as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(record).sort()) !==
        JSON.stringify(["bbox", "caption", "exactText", "priorSourceVisualIds", "sourceVisualId"])
    ) {
      throw new SourceFormulaReviewProtocolError(
        label + " must contain only sourceVisualId, caption, exactText, bbox, and priorSourceVisualIds",
      );
    }
    const sourceVisualId = typeof record.sourceVisualId === "string" ? record.sourceVisualId.trim() : "";
    if (
      !sourceFormulaArtifactTopologySlotIdentity(sourceVisualId, sourceIndex, evidence.pageNumber) ||
      activeIds.has(sourceVisualId)
    ) {
      throw new SourceFormulaReviewProtocolError(label + ".sourceVisualId must be a unique active formula id on this source/page");
    }
    activeIds.add(sourceVisualId);
    const caption = typeof record.caption === "string" ? record.caption.trim() : "";
    const exactText = typeof record.exactText === "string" ? record.exactText.trim() : "";
    if (!caption || caption.length > SOURCE_FORMULA_REVIEW_MAX_CAPTION_CHARS) {
      throw new SourceFormulaReviewProtocolError(label + ".caption must be a bounded non-empty string");
    }
    if (!exactText || exactText.length > SOURCE_FORMULA_REVIEW_MAX_EXACT_TEXT_CHARS) {
      throw new SourceFormulaReviewProtocolError(label + ".exactText must be a bounded non-empty string");
    }
    if (!Array.isArray(record.priorSourceVisualIds) || record.priorSourceVisualIds.some((id) => typeof id !== "string")) {
      throw new SourceFormulaReviewProtocolError(label + ".priorSourceVisualIds must be a string array");
    }
    const priorSourceVisualIds = record.priorSourceVisualIds.map((id) => (id as string).trim());
    if (
      new Set(priorSourceVisualIds).size !== priorSourceVisualIds.length ||
      priorSourceVisualIds.some((id) => !suppliedIdSet.has(id)) ||
      JSON.stringify(priorSourceVisualIds) !== JSON.stringify(
        suppliedIds.filter((id) => priorSourceVisualIds.includes(id)),
      )
    ) {
      throw new SourceFormulaReviewProtocolError(label + ".priorSourceVisualIds must be unique supplied ids in exact supplied order");
    }
    const bbox = strictSourceFormulaArtifactRecoveryBBox(record.bbox, label);
    const crop = cropPng(evidence.pageImage, expandedCropBBox(bbox, "equation"));
    if (!crop?.length) {
      throw new SourceFormulaReviewProtocolError(label + ".bbox cannot be cropped from the fresh PDF render");
    }
    const equationCropSha256 = sha256(crop);
    if (crops.has(equationCropSha256)) {
      throw new SourceFormulaReviewProtocolError(label + ".bbox duplicates another active formula crop");
    }
    crops.add(equationCropSha256);
    return { sourceVisualId, caption, exactText, bbox, equationCropSha256, priorSourceVisualIds };
  });
  const resolutionByOldId = new Map<string, SourceFormulaArtifactTopologyPriorResolution>();
  const priorSlotResolutions = top.priorSlotResolutions.map((value, index): SourceFormulaArtifactTopologyPriorResolution => {
    const label = "priorSlotResolutions[" + index + "]";
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SourceFormulaReviewProtocolError(label + " must be an object");
    }
    const record = value as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(record).sort()) !==
        JSON.stringify(["activeSourceVisualIds", "disposition", "reason", "sourceVisualId"])
    ) {
      throw new SourceFormulaReviewProtocolError(
        label + " must contain only sourceVisualId, disposition, activeSourceVisualIds, and reason",
      );
    }
    const sourceVisualId = typeof record.sourceVisualId === "string" ? record.sourceVisualId.trim() : "";
    if (sourceVisualId !== suppliedIds[index] || resolutionByOldId.has(sourceVisualId)) {
      throw new SourceFormulaReviewProtocolError(label + ".sourceVisualId must preserve exact supplied old-slot order");
    }
    const disposition = record.disposition;
    if (disposition !== "retain" && disposition !== "merge" && disposition !== "split" && disposition !== "retire") {
      throw new SourceFormulaReviewProtocolError(label + ".disposition is invalid");
    }
    if (!Array.isArray(record.activeSourceVisualIds) || record.activeSourceVisualIds.some((id) => typeof id !== "string")) {
      throw new SourceFormulaReviewProtocolError(label + ".activeSourceVisualIds must be a string array");
    }
    const activeSourceVisualIds = record.activeSourceVisualIds.map((id) => (id as string).trim());
    if (
      new Set(activeSourceVisualIds).size !== activeSourceVisualIds.length ||
      activeSourceVisualIds.some((id) => !activeIds.has(id))
    ) {
      throw new SourceFormulaReviewProtocolError(label + ".activeSourceVisualIds must be unique active formula ids");
    }
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (!reason || reason.length > SOURCE_FORMULA_REVIEW_MAX_REASON_CHARS) {
      throw new SourceFormulaReviewProtocolError(label + ".reason must be a bounded non-empty string");
    }
    if (
      (disposition === "retain" && (activeSourceVisualIds.length !== 1 || activeSourceVisualIds[0] !== sourceVisualId)) ||
      (disposition === "merge" && activeSourceVisualIds.length !== 1) ||
      (disposition === "split" && activeSourceVisualIds.length < 2) ||
      (disposition === "retire" && activeSourceVisualIds.length !== 0)
    ) {
      throw new SourceFormulaReviewProtocolError(label + ".disposition does not match its active source ids");
    }
    const resolution = { sourceVisualId, disposition, activeSourceVisualIds, reason } as SourceFormulaArtifactTopologyPriorResolution;
    resolutionByOldId.set(sourceVisualId, resolution);
    return resolution;
  });
  const inverse = new Map<string, string[]>();
  for (const resolution of priorSlotResolutions) {
    for (const activeId of resolution.activeSourceVisualIds) {
      const oldIds = inverse.get(activeId) ?? [];
      oldIds.push(resolution.sourceVisualId);
      inverse.set(activeId, oldIds);
    }
  }
  for (const active of activeFormulaSlots) {
    const expectedOldIds = suppliedIds.filter((id) => (inverse.get(active.sourceVisualId) ?? []).includes(id));
    if (JSON.stringify(active.priorSourceVisualIds) !== JSON.stringify(expectedOldIds)) {
      throw new SourceFormulaReviewProtocolError(
        "formula-artifact topology recovery activeFormulaSlots and priorSlotResolutions are not exact inverse graphs",
      );
    }
    // An old opaque formula id cannot be retired/remapped and then silently
    // reused for an unrelated new equation.  That would make stale plan/map
    // references appear valid while changing their referent.  If an active
    // id happens to reuse an old id, its graph must explicitly retain that
    // exact old identity as one of its predecessors.
    if (
      suppliedIdSet.has(active.sourceVisualId) &&
      !active.priorSourceVisualIds.includes(active.sourceVisualId)
    ) {
      throw new SourceFormulaReviewProtocolError(
        "formula-artifact topology recovery cannot reuse a retired or remapped old formula id",
      );
    }
  }
  for (const resolution of priorSlotResolutions) {
    if (
      resolution.disposition === "merge" &&
      (inverse.get(resolution.activeSourceVisualIds[0] ?? "")?.length ?? 0) < 2
    ) {
      throw new SourceFormulaReviewProtocolError("formula-artifact topology recovery merge must join multiple old slots");
    }
  }
  const equationDetections = detections.filter((detection) => detection.type === "equation");
  if (equationDetections.length !== activeFormulaSlots.length) {
    throw new SourceFormulaReviewProtocolError(
      "formula-artifact topology recovery equation detections must exactly match activeFormulaSlots",
    );
  }
  for (let index = 0; index < activeFormulaSlots.length; index += 1) {
    const slot = activeFormulaSlots[index]!;
    const detection = equationDetections[index]!;
    if (
      detection.caption !== slot.caption ||
      detection.exactText !== slot.exactText ||
      !detection.bbox ||
      !sameSourceVisualBBox(detection.bbox, slot.bbox)
    ) {
      throw new SourceFormulaReviewProtocolError(
        "formula-artifact topology recovery equation detection " + (index + 1) +
          " must exactly match its active formula slot",
      );
    }
  }
  return { detections, activeFormulaSlots, priorSlotResolutions };
}

function sourceFormulaArtifactTopologyRecoveryEnvelopeIntegrity(
  unsigned: SourceFormulaArtifactTopologyRecoveryCacheEnvelopeUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

function sourceFormulaArtifactTopologyReviewEnvelopeIntegrity(
  unsigned: SourceFormulaArtifactTopologyReviewEnvelopeUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

function sourceFormulaArtifactTopologyRecoveryEnvelopeMatches(
  envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  expectedInputs: readonly SourceFormulaArtifactRecoveryInput[],
): boolean {
  try {
    const expectedCacheKey = sourceFormulaArtifactTopologyRecoveryCacheKey(
      evidence,
      model,
      failedReview,
      expectedInputs,
    );
    if (
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_PROMPT_VERSION ||
      envelope.cacheKey !== expectedCacheKey ||
      envelope.model !== model ||
      envelope.sourceId !== evidence.sourceId ||
      envelope.pageNumber !== evidence.pageNumber ||
      envelope.pageImagePath !== evidence.pageImagePath ||
      envelope.pageImageSha256 !== evidence.pageImageSha256 ||
      envelope.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      envelope.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      envelope.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SYSTEM_PROMPT) ||
      JSON.stringify(envelope.failedReview) !== JSON.stringify(failedReview) ||
      JSON.stringify(envelope.inputVisuals) !== JSON.stringify(expectedInputs) ||
      !Array.isArray(envelope.repairHistory) ||
      !Number.isSafeInteger(envelope.semanticAttempt) ||
      envelope.semanticAttempt < 1 ||
      envelope.semanticAttempt > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_SEMANTIC_ATTEMPTS ||
      envelope.semanticAttempt !== envelope.repairHistory.length + 1 ||
      !envelope.recoveredAt ||
      envelope.requestSha256 !== sha256(envelope.requestPayload) ||
      envelope.responseSha256 !== sha256(envelope.rawResponse) ||
      !sourceFormulaArtifactRecoveryFailedReviewMatches(envelope.failedReview, evidence, expectedInputs)
    ) return false;
    for (const repair of envelope.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") return false;
      try {
        sourceFormulaArtifactTopologyRecoveryResponse(repair.rawResponse, evidence, expectedInputs);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) return false;
      }
    }
    const expectedPayload = sourceFormulaArtifactTopologyRecoveryAttemptPayload(
      sourceFormulaArtifactTopologyRecoveryRequestPayload(evidence, model, failedReview, expectedInputs),
      envelope.repairHistory,
    );
    if (envelope.requestPayload !== expectedPayload) return false;
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaArtifactTopologyRecoveryEnvelopeIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactTopologyRecoveryResponse(
      envelope.rawResponse,
      evidence,
      expectedInputs,
    );
    return JSON.stringify(parsed.detections) === JSON.stringify(envelope.detections) &&
      JSON.stringify(parsed.activeFormulaSlots) === JSON.stringify(envelope.activeFormulaSlots) &&
      JSON.stringify(parsed.priorSlotResolutions) === JSON.stringify(envelope.priorSlotResolutions);
  } catch {
    return false;
  }
}

function sourceFormulaArtifactTopologyRecoveryEnvelopeStructurallyMatchesEvidence(
  envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  return sourceFormulaArtifactTopologyRecoveryEnvelopeMatches(
    envelope,
    evidence,
    envelope.model,
    envelope.failedReview,
    envelope.inputVisuals,
  );
}

function sourceFormulaArtifactTopologyReviewKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyReviewCandidate,
  model: string,
): Record<string, unknown> {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_PROMPT_VERSION,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SYSTEM_PROMPT),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    recoveryCacheKey: recovery.cacheKey,
    recoveryCacheIntegritySha256: recovery.integritySha256,
    inputVisuals: recovery.inputVisuals,
    activeFormulaSlots: recovery.activeFormulaSlots,
    priorSlotResolutions: recovery.priorSlotResolutions,
  };
}

function sourceFormulaArtifactTopologyReviewCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyReviewCandidate,
  model: string,
): string {
  return sha256(JSON.stringify(sourceFormulaArtifactTopologyReviewKeyMaterial(evidence, recovery, model)));
}

function sourceFormulaArtifactTopologyReviewRequestPayload(
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyReviewCandidate,
  model: string,
): string {
  const failedReview = (
    recovery as SourceFormulaArtifactTopologyReviewCandidate & {
      failedReview?: SourceFormulaArtifactRecoveryFailedReview;
    }
  ).failedReview;
  const failedReviewerResponseVerbatim = failedReview?.rawResponse;
  return JSON.stringify({
    task: "Independently confirm or reject this exact proposed old-slot to active-formula topology graph against the fresh high-resolution PDF page image. Do not repair the graph.",
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SYSTEM_PROMPT),
    ...sourceFormulaArtifactTopologyReviewKeyMaterial(evidence, recovery, model),
    canonicalPageText: evidence.canonicalPageText,
    ...(failedReviewerResponseVerbatim !== undefined ? { failedReviewerResponseVerbatim } : {}),
  });
}

function sourceFormulaArtifactTopologyReviewAttemptPayload(
  basePayload: string,
  repairHistory: readonly { rawResponse: string; diagnostic: string }[],
): string {
  if (repairHistory.length === 0) return basePayload;
  const prior = repairHistory[repairHistory.length - 1];
  return basePayload +
    "\n\nThe prior topology-review response was invalid. Inspect the whole page and return the exact required response. Here is the prior raw response and strict parse diagnostic:\n" +
    JSON.stringify(prior);
}

function sourceFormulaArtifactTopologyReviewResponse(
  raw: unknown,
  recovery: SourceFormulaArtifactTopologyReviewCandidate,
): {
  status: "confirmed" | "rejected";
  reason: string;
  priorSlotResolutions: SourceFormulaArtifactTopologyPriorResolution[];
} {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SourceFormulaReviewProtocolError("formula-artifact topology review response was empty or missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SourceFormulaReviewProtocolError(
      "formula-artifact topology review response was not valid JSON (" +
        (error instanceof Error ? error.message : String(error)) + ")",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SourceFormulaReviewProtocolError("formula-artifact topology review top level must be an object");
  }
  const top = parsed as Record<string, unknown>;
  const status = top.status;
  const reason = typeof top.reason === "string" ? top.reason.trim() : "";
  if ((status !== "confirmed" && status !== "rejected") || !reason || reason.length > SOURCE_FORMULA_REVIEW_MAX_REASON_CHARS) {
    throw new SourceFormulaReviewProtocolError("formula-artifact topology review requires a bounded confirmed/rejected status and reason");
  }
  if (status === "rejected") {
    if (JSON.stringify(Object.keys(top).sort()) !== JSON.stringify(["reason", "status"])) {
      throw new SourceFormulaReviewProtocolError("rejected formula-artifact topology review must contain only status and reason");
    }
    return { status, reason, priorSlotResolutions: [] };
  }
  if (
    JSON.stringify(Object.keys(top).sort()) !== JSON.stringify(["priorSlotResolutions", "reason", "status"]) ||
    !Array.isArray(top.priorSlotResolutions) ||
    top.priorSlotResolutions.length !== recovery.priorSlotResolutions.length
  ) {
    throw new SourceFormulaReviewProtocolError("confirmed formula-artifact topology review must contain the complete priorSlotResolutions graph");
  }
  const confirmed = top.priorSlotResolutions.map((value, index): SourceFormulaArtifactTopologyPriorResolution => {
    const expected = recovery.priorSlotResolutions[index];
    if (!value || typeof value !== "object" || Array.isArray(value) || !expected) {
      throw new SourceFormulaReviewProtocolError("formula-artifact topology review resolution is invalid");
    }
    const record = value as Record<string, unknown>;
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["activeSourceVisualIds", "disposition", "reason", "sourceVisualId"])) {
      throw new SourceFormulaReviewProtocolError("formula-artifact topology review resolution has unsupported keys");
    }
    const sourceVisualId = typeof record.sourceVisualId === "string" ? record.sourceVisualId.trim() : "";
    const disposition = record.disposition;
    const activeSourceVisualIds = Array.isArray(record.activeSourceVisualIds) &&
      record.activeSourceVisualIds.every((id) => typeof id === "string")
      ? record.activeSourceVisualIds.map((id) => (id as string).trim())
      : [];
    const itemReason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (
      sourceVisualId !== expected.sourceVisualId ||
      disposition !== expected.disposition ||
      JSON.stringify(activeSourceVisualIds) !== JSON.stringify(expected.activeSourceVisualIds) ||
      !itemReason || itemReason.length > SOURCE_FORMULA_REVIEW_MAX_REASON_CHARS
    ) {
      throw new SourceFormulaReviewProtocolError("formula-artifact topology review must confirm the exact proposed graph without repair");
    }
    return {
      sourceVisualId,
      disposition: disposition as SourceFormulaTopologyDisposition,
      activeSourceVisualIds,
      reason: itemReason,
    };
  });
  return { status, reason, priorSlotResolutions: confirmed };
}

function sourceFormulaArtifactTopologyReviewEnvelopeMatches(
  envelope: SourceFormulaArtifactTopologyReviewEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyReviewCandidate,
  model: string,
): boolean {
  try {
    const expectedKey = sourceFormulaArtifactTopologyReviewCacheKey(evidence, recovery, model);
    if (
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_PROMPT_VERSION ||
      envelope.cacheKey !== expectedKey ||
      envelope.model !== model ||
      envelope.sourceId !== evidence.sourceId ||
      envelope.pageNumber !== evidence.pageNumber ||
      envelope.pageImageSha256 !== evidence.pageImageSha256 ||
      envelope.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      envelope.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      envelope.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SYSTEM_PROMPT) ||
      envelope.recoveryCacheKey !== recovery.cacheKey ||
      envelope.recoveryCacheIntegritySha256 !== recovery.integritySha256 ||
      !Array.isArray(envelope.repairHistory) ||
      !Number.isSafeInteger(envelope.semanticAttempt) ||
      envelope.semanticAttempt < 1 ||
      envelope.semanticAttempt > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_MAX_SEMANTIC_ATTEMPTS ||
      envelope.semanticAttempt !== envelope.repairHistory.length + 1 ||
      !envelope.reviewedAt ||
      envelope.requestSha256 !== sha256(envelope.requestPayload) ||
      envelope.responseSha256 !== sha256(envelope.rawResponse)
    ) return false;
    for (const repair of envelope.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") return false;
      try {
        sourceFormulaArtifactTopologyReviewResponse(repair.rawResponse, recovery);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) return false;
      }
    }
    const expectedPayload = sourceFormulaArtifactTopologyReviewAttemptPayload(
      sourceFormulaArtifactTopologyReviewRequestPayload(evidence, recovery, model),
      envelope.repairHistory,
    );
    if (envelope.requestPayload !== expectedPayload) return false;
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaArtifactTopologyReviewEnvelopeIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactTopologyReviewResponse(envelope.rawResponse, recovery);
    return parsed.status === envelope.status &&
      parsed.reason === envelope.reason &&
      JSON.stringify(parsed.priorSlotResolutions) === JSON.stringify(envelope.priorSlotResolutions);
  } catch {
    return false;
  }
}

function sourceFormulaArtifactRecoveryEnvelopeIntegrity(
  unsigned: SourceFormulaArtifactRecoveryCacheEnvelopeUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

/**
 * A topology receipt records the exact rejected normal-review request that
 * authorized it. V1 and V2 use different signed payloads and parsers, so an
 * old receipt is valid only when it byte-for-byte replays one of those known
 * contracts. Unknown prompt fingerprints remain fail-closed.
 */
function sourceFormulaReviewProtocolForFailedReview(
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  evidence: SourceFormulaReviewPageEvidence,
  inputs: readonly SourceFormulaReviewInput[],
): SourceFormulaReviewProtocol | null {
  for (const protocol of ["v2", "v1"] as const) {
    if (
      failedReview.cacheKey !== pageReviewCacheKey(
        evidence,
        failedReview.model,
        inputs,
        protocol,
      )
    ) continue;
    const expectedPayload = sourceFormulaReviewAttemptPayload(
      pageReviewRequestPayload(evidence, failedReview.model, inputs, protocol),
      failedReview.repairHistory,
    );
    if (failedReview.requestPayload === expectedPayload) return protocol;
  }
  return null;
}

function sourceFormulaArtifactRecoveryFailedReviewMatches(
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  evidence: SourceFormulaReviewPageEvidence,
  recoveryInputs: readonly SourceFormulaArtifactRecoveryInput[],
): boolean {
  try {
    if (
      !failedReview.model.trim() ||
      failedReview.requestSha256 !== sha256(failedReview.requestPayload) ||
      failedReview.responseSha256 !== sha256(failedReview.rawResponse) ||
      !Number.isSafeInteger(failedReview.semanticAttempt) ||
      failedReview.semanticAttempt < 1 ||
      failedReview.semanticAttempt > SOURCE_FORMULA_REVIEW_MAX_SEMANTIC_ATTEMPTS ||
      !Array.isArray(failedReview.repairHistory) ||
      !Array.isArray(failedReview.inputVisuals)
    ) return false;
    const protocol = sourceFormulaReviewProtocolForFailedReview(
      failedReview,
      evidence,
      failedReview.inputVisuals,
    );
    if (!protocol) return false;
    for (const repair of failedReview.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") {
        return false;
      }
      try {
        parseSourceFormulaReviewResponse(
          repair.rawResponse,
          failedReview.inputVisuals,
          protocol,
        );
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) {
          return false;
        }
      }
    }
    if (failedReview.semanticAttempt !== failedReview.repairHistory.length + 1) return false;
    const decisions = parseSourceFormulaReviewResponse(
      failedReview.rawResponse,
      failedReview.inputVisuals,
      protocol,
    );
    const rejectedById = new Map(decisions
      .filter((decision) => decision.action === "reject")
      .map((decision) => [decision.sourceVisualId, decision]));
    if (
      rejectedById.size === 0 ||
      [...rejectedById.values()].some((decision) => decision.identityAssessment !== "identity_mismatch")
    ) return false;
    return recoveryInputs.every((input) => {
      const rejection = rejectedById.get(input.sourceVisualId);
      return rejection
        ? input.reviewerIdentityAssessment === "identity_mismatch" &&
          input.reviewerReason === rejection.reason
        : input.reviewerIdentityAssessment === null && input.reviewerReason === null;
    });
  } catch {
    return false;
  }
}

function sourceFormulaArtifactRecoveryEnvelopeMatches(
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  expectedInputs: readonly SourceFormulaArtifactRecoveryInput[],
): boolean {
  try {
    const expectedCacheKey = sourceFormulaArtifactRecoveryCacheKey(
      evidence,
      model,
      failedReview,
      expectedInputs,
    );
    if (
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_RECOVERY_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_RECOVERY_PROMPT_VERSION ||
      envelope.cacheKey !== expectedCacheKey ||
      envelope.model !== model ||
      envelope.sourceId !== evidence.sourceId ||
      envelope.pageNumber !== evidence.pageNumber ||
      envelope.pageImagePath !== evidence.pageImagePath ||
      envelope.pageImageSha256 !== evidence.pageImageSha256 ||
      envelope.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      envelope.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      envelope.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_RECOVERY_SYSTEM_PROMPT) ||
      JSON.stringify(envelope.failedReview) !== JSON.stringify(failedReview) ||
      JSON.stringify(envelope.inputVisuals) !== JSON.stringify(expectedInputs) ||
      !Array.isArray(envelope.repairHistory) ||
      !Number.isSafeInteger(envelope.semanticAttempt) ||
      envelope.semanticAttempt < 1 ||
      envelope.semanticAttempt > SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_SEMANTIC_ATTEMPTS ||
      envelope.semanticAttempt !== envelope.repairHistory.length + 1 ||
      !envelope.recoveredAt ||
      envelope.responseSha256 !== sha256(envelope.rawResponse)
    ) return false;
    for (const repair of envelope.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") {
        return false;
      }
      try {
        sourceFormulaArtifactRecoveryResponse(repair.rawResponse, evidence, expectedInputs);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) {
          return false;
        }
      }
    }
    const basePayload = sourceFormulaArtifactRecoveryRequestPayload(
      evidence,
      model,
      failedReview,
      expectedInputs,
    );
    const expectedRequestPayload = sourceFormulaArtifactRecoveryAttemptPayload(
      basePayload,
      envelope.repairHistory,
    );
    if (
      envelope.requestPayload !== expectedRequestPayload ||
      envelope.requestSha256 !== sha256(expectedRequestPayload) ||
      !sourceFormulaArtifactRecoveryFailedReviewMatches(
        envelope.failedReview,
        evidence,
        expectedInputs,
      )
    ) return false;
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaArtifactRecoveryEnvelopeIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactRecoveryResponse(
      envelope.rawResponse,
      evidence,
      expectedInputs,
    );
    return JSON.stringify(parsed.detections) === JSON.stringify(envelope.detections) &&
      JSON.stringify(parsed.replacements) === JSON.stringify(envelope.replacements);
  } catch {
    return false;
  }
}

function sourceFormulaArtifactRecoveryEnvelopeStructurallyMatchesEvidence(
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  return sourceFormulaArtifactRecoveryEnvelopeMatches(
    envelope,
    evidence,
    envelope.model,
    envelope.failedReview,
    envelope.inputVisuals,
  );
}

function sourceFormulaArtifactRecoveryCacheDir(cacheRoot: string, cacheKey: string): string {
  return path.join(sourceFormulaArtifactRecoveryCacheRoot(cacheRoot), cacheKey.slice(0, 2));
}

function loadSourceFormulaArtifactRecoveryCache(
  cacheRoot: string,
  evidence: SourceFormulaReviewPageEvidence,
  model: string,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: readonly SourceFormulaArtifactRecoveryInput[],
): SourceFormulaArtifactRecoveryCacheEnvelope | null {
  const cacheKey = sourceFormulaArtifactRecoveryCacheKey(evidence, model, failedReview, inputs);
  try {
    const parsed = JSON.parse(readFileSyncWithRetry(
      path.join(sourceFormulaArtifactRecoveryCacheDir(cacheRoot, cacheKey), cacheKey + ".json"),
      "utf-8",
    )) as SourceFormulaArtifactRecoveryCacheEnvelope;
    return sourceFormulaArtifactRecoveryEnvelopeMatches(
      parsed,
      evidence,
      model,
      failedReview,
      inputs,
    ) ? parsed : null;
  } catch {
    return null;
  }
}

function saveSourceFormulaArtifactRecoveryCache(
  cacheRoot: string,
  evidence: SourceFormulaReviewPageEvidence,
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope,
  writeState: SourceFormulaExternalCacheWriteState,
): void {
  if (writeState.artifactRecoveryDegraded) return;
  const directory = sourceFormulaArtifactRecoveryCacheDir(cacheRoot, envelope.cacheKey);
  const finalPath = path.join(directory, envelope.cacheKey + ".json");
  const serialized = JSON.stringify(envelope, null, 2) + "\n";
  // V4's external cache is likewise expendable; its authoritative scan-cache
  // receipt and projected garden provenance remain strict writes.
  const published = publishExternalCacheFileAtomically({
    finalPath,
    content: serialized,
    validateWinner(content) {
      let existing: SourceFormulaArtifactRecoveryCacheEnvelope;
      try {
        existing = JSON.parse(content.toString("utf-8")) as
          SourceFormulaArtifactRecoveryCacheEnvelope;
      } catch {
        return false;
      }
      return sourceFormulaArtifactRecoveryEnvelopeMatches(
        existing,
        evidence,
        envelope.model,
        envelope.failedReview,
        envelope.inputVisuals,
      );
    },
  });
  if (published.status === "degraded") writeState.artifactRecoveryDegraded = true;
}

async function requestSourceFormulaArtifactRecovery(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: SourceFormulaArtifactRecoveryInput[],
): Promise<SourceFormulaArtifactRecoveryCacheEnvelope> {
  const repairHistory: Array<{ rawResponse: string; diagnostic: string }> = [];
  const basePayload = sourceFormulaArtifactRecoveryRequestPayload(
    evidence,
    options.model,
    failedReview,
    inputs,
  );
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    options.checkCancelled?.();
    const requestPayload = sourceFormulaArtifactRecoveryAttemptPayload(basePayload, repairHistory);
    options.onProgress?.(
      "Re-detecting source artifacts on " + evidence.sourceId + " p." + evidence.pageNumber +
        " (" + semanticAttempt + "/" + SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_SEMANTIC_ATTEMPTS + ")...",
    );
    let rawResponse = "";
    {
      const response = await createSourceModelCompletionWithHttp502Retry({
        client: options.client,
        request: {
          model: options.model,
          messages: [
            { role: "system", content: SOURCE_FORMULA_ARTIFACT_RECOVERY_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: requestPayload },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64," + evidence.pageImage.toString("base64"),
                    detail: "high",
                  },
                },
              ] as never,
            },
          ],
        },
        timeoutMs: sourceFormulaReviewTimeoutMs(),
        checkpoint: options.checkCancelled,
        onProgress: options.onProgress,
        stageLabel: `formula artifact recovery on ${evidence.sourceId} p.${evidence.pageNumber}`,
      });
      rawResponse = response.choices[0]?.message?.content ?? "";
    }
    assertNonemptySourceFormulaModelResponse(rawResponse, "formula artifact recovery");
    let recovered: {
      detections: SourceVisualDetection[];
      replacements: SourceFormulaArtifactRecoveryReplacement[];
    };
    try {
      recovered = sourceFormulaArtifactRecoveryResponse(rawResponse, evidence, inputs);
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewProtocolError)) throw error;
      if (semanticAttempt >= SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_SEMANTIC_ATTEMPTS) throw error;
      repairHistory.push({ rawResponse, diagnostic: error.message });
      continue;
    }
    const cacheKey = sourceFormulaArtifactRecoveryCacheKey(
      evidence,
      options.model,
      failedReview,
      inputs,
    );
    const unsigned: SourceFormulaArtifactRecoveryCacheEnvelopeUnsigned = {
      schemaVersion: SOURCE_FORMULA_ARTIFACT_RECOVERY_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_ARTIFACT_RECOVERY_PROMPT_VERSION,
      cacheKey,
      model: options.model,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImagePath: evidence.pageImagePath,
      pageImageSha256: evidence.pageImageSha256,
      canonicalPageTextSha256: evidence.canonicalPageTextSha256,
      sourcePdfSha256: evidence.sourcePdfSha256,
      systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_RECOVERY_SYSTEM_PROMPT),
      failedReview,
      requestPayload,
      requestSha256: sha256(requestPayload),
      repairHistory,
      rawResponse,
      responseSha256: sha256(rawResponse),
      semanticAttempt,
      recoveredAt: options.now?.() ?? new Date().toISOString(),
      inputVisuals: inputs,
      detections: recovered.detections,
      replacements: recovered.replacements,
    };
    return {
      ...unsigned,
      integritySha256: sourceFormulaArtifactRecoveryEnvelopeIntegrity(unsigned),
    };
  }
  throw new SourceFormulaReviewProtocolError("bounded formula-artifact recovery attempts were exhausted");
}

async function requestSourceFormulaArtifactTopologyRecovery(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  failedReview: SourceFormulaArtifactRecoveryFailedReview,
  inputs: SourceFormulaArtifactRecoveryInput[],
): Promise<SourceFormulaArtifactTopologyRecoveryCacheEnvelope> {
  const repairHistory: Array<{ rawResponse: string; diagnostic: string }> = [];
  const basePayload = sourceFormulaArtifactTopologyRecoveryRequestPayload(
    evidence,
    options.model,
    failedReview,
    inputs,
  );
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    options.checkCancelled?.();
    const requestPayload = sourceFormulaArtifactTopologyRecoveryAttemptPayload(basePayload, repairHistory);
    options.onProgress?.(
      "Re-detecting formula topology on " + evidence.sourceId + " p." + evidence.pageNumber +
        " (" + semanticAttempt + "/" + SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_SEMANTIC_ATTEMPTS + ")...",
    );
    let rawResponse = "";
    {
      const response = await createSourceModelCompletionWithHttp502Retry({
        client: options.client,
        request: {
          model: options.model,
          messages: [
            { role: "system", content: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: requestPayload },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64," + evidence.pageImage.toString("base64"),
                    detail: "high",
                  },
                },
              ] as never,
            },
          ],
        },
        timeoutMs: sourceFormulaReviewTimeoutMs(),
        checkpoint: options.checkCancelled,
        onProgress: options.onProgress,
        stageLabel: `formula topology recovery on ${evidence.sourceId} p.${evidence.pageNumber}`,
      });
      rawResponse = response.choices[0]?.message?.content ?? "";
    }
    assertNonemptySourceFormulaModelResponse(rawResponse, "formula topology recovery");
    let recovered: ReturnType<typeof sourceFormulaArtifactTopologyRecoveryResponse>;
    try {
      recovered = sourceFormulaArtifactTopologyRecoveryResponse(rawResponse, evidence, inputs);
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewProtocolError)) throw error;
      if (semanticAttempt >= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_SEMANTIC_ATTEMPTS) throw error;
      repairHistory.push({ rawResponse, diagnostic: error.message });
      continue;
    }
    const cacheKey = sourceFormulaArtifactTopologyRecoveryCacheKey(
      evidence,
      options.model,
      failedReview,
      inputs,
    );
    const unsigned: SourceFormulaArtifactTopologyRecoveryCacheEnvelopeUnsigned = {
      schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_PROMPT_VERSION,
      cacheKey,
      model: options.model,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImagePath: evidence.pageImagePath,
      pageImageSha256: evidence.pageImageSha256,
      canonicalPageTextSha256: evidence.canonicalPageTextSha256,
      sourcePdfSha256: evidence.sourcePdfSha256,
      systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SYSTEM_PROMPT),
      failedReview,
      requestPayload,
      requestSha256: sha256(requestPayload),
      repairHistory,
      rawResponse,
      responseSha256: sha256(rawResponse),
      semanticAttempt,
      recoveredAt: options.now?.() ?? new Date().toISOString(),
      inputVisuals: inputs,
      detections: recovered.detections,
      activeFormulaSlots: recovered.activeFormulaSlots,
      priorSlotResolutions: recovered.priorSlotResolutions,
    };
    return {
      ...unsigned,
      integritySha256: sourceFormulaArtifactTopologyRecoveryEnvelopeIntegrity(unsigned),
    };
  }
  throw new SourceFormulaReviewProtocolError("bounded formula-artifact topology recovery attempts were exhausted");
}

type SourceFormulaArtifactTopologyRepairPriorCandidate =
  | SourceFormulaArtifactTopologyRecoveryCacheEnvelope
  | SourceFormulaArtifactTopologyCandidateRepairCandidate;

function sourceFormulaArtifactTopologyCandidateRepairCycleKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  model: string,
): Record<string, unknown> {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION,
    detectorVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION,
    maxCandidates: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImagePath: evidence.pageImagePath,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    initialRecoveryCacheKey: initialRecovery.cacheKey,
    initialRecoveryCacheIntegritySha256: initialRecovery.integritySha256,
    initialTopologyReviewCacheKey: initialTopologyReview.cacheKey,
    initialTopologyReviewCacheIntegritySha256: initialTopologyReview.integritySha256,
    initialInputVisuals: initialRecovery.inputVisuals,
  };
}

function sourceFormulaArtifactTopologyCandidateRepairCycleCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  model: string,
): string {
  return sha256(JSON.stringify(
    sourceFormulaArtifactTopologyCandidateRepairCycleKeyMaterial(
      evidence,
      initialRecovery,
      initialTopologyReview,
      model,
    ),
  ));
}

function sourceFormulaArtifactTopologyCandidateRepairCandidateKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  priorCandidate: SourceFormulaArtifactTopologyRepairPriorCandidate,
  priorTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  candidateOrdinal: number,
  model: string,
): Record<string, unknown> {
  return {
    ...sourceFormulaArtifactTopologyCandidateRepairCycleKeyMaterial(
      evidence,
      initialRecovery,
      initialTopologyReview,
      model,
    ),
    candidateOrdinal,
    priorCandidateCacheKey: priorCandidate.cacheKey,
    priorCandidateIntegritySha256: priorCandidate.integritySha256,
    priorCandidateResponseSha256: sha256(priorCandidate.rawResponse),
    priorTopologyReviewCacheKey: priorTopologyReview.cacheKey,
    priorTopologyReviewCacheIntegritySha256: priorTopologyReview.integritySha256,
    priorTopologyReviewResponseSha256: sha256(priorTopologyReview.rawResponse),
    priorTopologyReviewReason: priorTopologyReview.reason,
  };
}

function sourceFormulaArtifactTopologyCandidateRepairCandidateCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  priorCandidate: SourceFormulaArtifactTopologyRepairPriorCandidate,
  priorTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  candidateOrdinal: number,
  model: string,
): string {
  return sha256(JSON.stringify(
    sourceFormulaArtifactTopologyCandidateRepairCandidateKeyMaterial(
      evidence,
      initialRecovery,
      initialTopologyReview,
      priorCandidate,
      priorTopologyReview,
      candidateOrdinal,
      model,
    ),
  ));
}

function sourceFormulaArtifactTopologyCandidateRepairCandidateRequestPayload(
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  priorCandidate: SourceFormulaArtifactTopologyRepairPriorCandidate,
  priorTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  candidateOrdinal: number,
  model: string,
): string {
  return JSON.stringify({
    task: "Author a fresh complete whole-page visual inventory and old-slot to active-formula topology graph after an independent reviewer rejected the prior candidate. Return the exact JSON response shape from the system prompt.",
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT),
    ...sourceFormulaArtifactTopologyCandidateRepairCandidateKeyMaterial(
      evidence,
      initialRecovery,
      initialTopologyReview,
      priorCandidate,
      priorTopologyReview,
      candidateOrdinal,
      model,
    ),
    canonicalPageText: evidence.canonicalPageText,
    initialFormulaReviewerResponseVerbatim: initialRecovery.failedReview.rawResponse,
    priorCandidateResponseVerbatim: priorCandidate.rawResponse,
    priorIndependentTopologyReviewerResponseVerbatim: priorTopologyReview.rawResponse,
    priorIndependentTopologyReviewerReasonVerbatim: priorTopologyReview.reason,
  });
}

function sourceFormulaArtifactTopologyCandidateRepairCandidateAttemptPayload(
  basePayload: string,
  repairHistory: readonly { rawResponse: string; diagnostic: string }[],
): string {
  if (repairHistory.length === 0) return basePayload;
  const prior = repairHistory[repairHistory.length - 1];
  return basePayload +
    "\n\nThe prior successor-candidate response was invalid. Inspect the whole page and return the exact required response. Here is the prior raw response and strict parse diagnostic:\n" +
    JSON.stringify(prior);
}

function sourceFormulaArtifactTopologyCandidateRepairCandidateIntegrity(
  unsigned: SourceFormulaArtifactTopologyCandidateRepairCandidateUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

function sourceFormulaArtifactTopologyCandidateRepairEnvelopeIntegrity(
  unsigned: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelopeUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

async function requestSourceFormulaArtifactTopologyCandidateRepairCandidate(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  priorCandidate: SourceFormulaArtifactTopologyRepairPriorCandidate,
  priorTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  candidateOrdinal: number,
): Promise<SourceFormulaArtifactTopologyCandidateRepairCandidate> {
  const repairHistory: Array<{ rawResponse: string; diagnostic: string }> = [];
  const basePayload = sourceFormulaArtifactTopologyCandidateRepairCandidateRequestPayload(
    evidence,
    initialRecovery,
    initialTopologyReview,
    priorCandidate,
    priorTopologyReview,
    candidateOrdinal,
    options.model,
  );
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    options.checkCancelled?.();
    const requestPayload = sourceFormulaArtifactTopologyCandidateRepairCandidateAttemptPayload(
      basePayload,
      repairHistory,
    );
    options.onProgress?.(
      "Re-authoring formula topology candidate " + candidateOrdinal + "/" +
        SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES +
        " on " + evidence.sourceId + " p." + evidence.pageNumber +
        " (" + semanticAttempt + "/" +
        SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_SEMANTIC_ATTEMPTS + ")...",
    );
    let rawResponse = "";
    {
      const response = await createSourceModelCompletionWithHttp502Retry({
        client: options.client,
        request: {
          model: options.model,
          messages: [
            { role: "system", content: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: requestPayload },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64," + evidence.pageImage.toString("base64"),
                    detail: "high",
                  },
                },
              ] as never,
            },
          ],
        },
        timeoutMs: sourceFormulaReviewTimeoutMs(),
        checkpoint: options.checkCancelled,
        onProgress: options.onProgress,
        stageLabel: `formula topology candidate ${candidateOrdinal} on ${evidence.sourceId} p.${evidence.pageNumber}`,
      });
      rawResponse = response.choices[0]?.message?.content ?? "";
    }
    assertNonemptySourceFormulaModelResponse(rawResponse, "formula topology candidate repair");
    let recovered: ReturnType<typeof sourceFormulaArtifactTopologyRecoveryResponse>;
    try {
      recovered = sourceFormulaArtifactTopologyRecoveryResponse(
        rawResponse,
        evidence,
        initialRecovery.inputVisuals,
      );
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewProtocolError)) throw error;
      if (semanticAttempt >= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_SEMANTIC_ATTEMPTS) {
        throw error;
      }
      repairHistory.push({ rawResponse, diagnostic: error.message });
      continue;
    }
    const unsigned: SourceFormulaArtifactTopologyCandidateRepairCandidateUnsigned = {
      schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION,
      cacheKey: sourceFormulaArtifactTopologyCandidateRepairCandidateCacheKey(
        evidence,
        initialRecovery,
        initialTopologyReview,
        priorCandidate,
        priorTopologyReview,
        candidateOrdinal,
        options.model,
      ),
      model: options.model,
      candidateOrdinal,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImagePath: evidence.pageImagePath,
      pageImageSha256: evidence.pageImageSha256,
      canonicalPageTextSha256: evidence.canonicalPageTextSha256,
      sourcePdfSha256: evidence.sourcePdfSha256,
      systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT),
      initialRecoveryCacheKey: initialRecovery.cacheKey,
      initialRecoveryCacheIntegritySha256: initialRecovery.integritySha256,
      initialTopologyReviewCacheKey: initialTopologyReview.cacheKey,
      initialTopologyReviewCacheIntegritySha256: initialTopologyReview.integritySha256,
      priorCandidateCacheKey: priorCandidate.cacheKey,
      priorCandidateIntegritySha256: priorCandidate.integritySha256,
      priorCandidateRawResponse: priorCandidate.rawResponse,
      priorCandidateResponseSha256: sha256(priorCandidate.rawResponse),
      priorTopologyReviewCacheKey: priorTopologyReview.cacheKey,
      priorTopologyReviewCacheIntegritySha256: priorTopologyReview.integritySha256,
      priorTopologyReviewRawResponse: priorTopologyReview.rawResponse,
      priorTopologyReviewResponseSha256: sha256(priorTopologyReview.rawResponse),
      priorTopologyReviewReason: priorTopologyReview.reason,
      requestPayload,
      requestSha256: sha256(requestPayload),
      repairHistory,
      rawResponse,
      responseSha256: sha256(rawResponse),
      semanticAttempt,
      recoveredAt: options.now?.() ?? new Date().toISOString(),
      inputVisuals: initialRecovery.inputVisuals,
      detections: recovered.detections,
      activeFormulaSlots: recovered.activeFormulaSlots,
      priorSlotResolutions: recovered.priorSlotResolutions,
    };
    return {
      ...unsigned,
      integritySha256: sourceFormulaArtifactTopologyCandidateRepairCandidateIntegrity(unsigned),
    };
  }
  throw new SourceFormulaReviewProtocolError("bounded topology successor-candidate attempts were exhausted");
}

function sourceFormulaArtifactTopologyCandidateRepairEnvelope(
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  model: string,
  candidates: readonly SourceFormulaArtifactTopologyCandidateRepairHistoryEntry[],
  startedAt: string,
  updatedAt: string,
): SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope {
  const unsigned: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelopeUnsigned = {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION,
    detectorVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION,
    maxCandidates: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES,
    cacheKey: sourceFormulaArtifactTopologyCandidateRepairCycleCacheKey(
      evidence,
      initialRecovery,
      initialTopologyReview,
      model,
    ),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImagePath: evidence.pageImagePath,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT),
    initialRecovery,
    initialTopologyReview,
    candidates: candidates.map((entry) => ({
      candidate: entry.candidate,
      ...(entry.topologyReview ? { topologyReview: entry.topologyReview } : {}),
    })),
    startedAt,
    updatedAt,
  };
  return {
    ...unsigned,
    integritySha256: sourceFormulaArtifactTopologyCandidateRepairEnvelopeIntegrity(unsigned),
  };
}

async function requestSourceFormulaArtifactTopologyReview(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyReviewCandidate,
): Promise<SourceFormulaArtifactTopologyReviewEnvelope> {
  const repairHistory: Array<{ rawResponse: string; diagnostic: string }> = [];
  const basePayload = sourceFormulaArtifactTopologyReviewRequestPayload(evidence, recovery, options.model);
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    options.checkCancelled?.();
    const requestPayload = sourceFormulaArtifactTopologyReviewAttemptPayload(basePayload, repairHistory);
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: requestPayload },
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64," + evidence.pageImage.toString("base64"),
          detail: "high",
        },
      },
    ];
    for (const slot of recovery.activeFormulaSlots) {
      const crop = cropPng(evidence.pageImage, expandedCropBBox(slot.bbox, "equation"));
      if (!crop?.length || sha256(crop) !== slot.equationCropSha256) {
        throw new Error("Formula-artifact topology review could not bind active crop " + slot.sourceVisualId + ".");
      }
      content.push(
        {
          type: "text",
          text: "Proposed active crop for " + slot.sourceVisualId + "; bbox=" + JSON.stringify(slot.bbox),
        },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64," + crop.toString("base64"), detail: "high" },
        },
      );
    }
    options.onProgress?.(
      "Independently reviewing formula topology on " + evidence.sourceId + " p." + evidence.pageNumber +
        " (" + semanticAttempt + "/" + SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_MAX_SEMANTIC_ATTEMPTS + ")...",
    );
    let rawResponse = "";
    {
      const response = await createSourceModelCompletionWithHttp502Retry({
        client: options.client,
        request: {
          model: options.model,
          messages: [
            { role: "system", content: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SYSTEM_PROMPT },
            { role: "user", content: content as never },
          ],
        },
        timeoutMs: sourceFormulaReviewTimeoutMs(),
        checkpoint: options.checkCancelled,
        onProgress: options.onProgress,
        stageLabel: `formula topology review on ${evidence.sourceId} p.${evidence.pageNumber}`,
      });
      rawResponse = response.choices[0]?.message?.content ?? "";
    }
    assertNonemptySourceFormulaModelResponse(rawResponse, "formula topology review");
    let reviewed: ReturnType<typeof sourceFormulaArtifactTopologyReviewResponse>;
    try {
      reviewed = sourceFormulaArtifactTopologyReviewResponse(rawResponse, recovery);
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewProtocolError)) throw error;
      if (semanticAttempt >= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_MAX_SEMANTIC_ATTEMPTS) throw error;
      repairHistory.push({ rawResponse, diagnostic: error.message });
      continue;
    }
    const cacheKey = sourceFormulaArtifactTopologyReviewCacheKey(evidence, recovery, options.model);
    const unsigned: SourceFormulaArtifactTopologyReviewEnvelopeUnsigned = {
      schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_PROMPT_VERSION,
      cacheKey,
      model: options.model,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImageSha256: evidence.pageImageSha256,
      canonicalPageTextSha256: evidence.canonicalPageTextSha256,
      sourcePdfSha256: evidence.sourcePdfSha256,
      systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SYSTEM_PROMPT),
      recoveryCacheKey: recovery.cacheKey,
      recoveryCacheIntegritySha256: recovery.integritySha256,
      requestPayload,
      requestSha256: sha256(requestPayload),
      repairHistory,
      rawResponse,
      responseSha256: sha256(rawResponse),
      semanticAttempt,
      reviewedAt: options.now?.() ?? new Date().toISOString(),
      status: reviewed.status,
      reason: reviewed.reason,
      priorSlotResolutions: reviewed.priorSlotResolutions,
    };
    return {
      ...unsigned,
      integritySha256: sourceFormulaArtifactTopologyReviewEnvelopeIntegrity(unsigned),
    };
  }
  throw new SourceFormulaReviewProtocolError("bounded formula-artifact topology review attempts were exhausted");
}

/** Rebuild the original V5 old-slot evidence from a signed recovery receipt.
 * A V6 successor deliberately need not preserve those retired ids in the
 * current ledger, but its immutable C1/R1 base must still validate against
 * exactly the same source page evidence. */
function sourceFormulaArtifactTopologyCandidateRepairInitialEvidence(
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
): SourceFormulaReviewPageEvidence {
  return {
    ...evidence,
    inputs: initialRecovery.inputVisuals.map((input) => ({
      sourceVisualId: input.sourceVisualId,
      sourceId: input.sourceId,
      pageNumber: input.pageNumber,
      pageImagePath: evidence.pageImagePath,
      inputCaption: input.inputCaption,
      inputExactText: input.inputExactText,
      bbox: { ...input.inputBBox },
      equationCropSha256: input.inputEquationCropSha256,
    })),
    crops: new Map(),
  };
}

function sourceFormulaArtifactTopologyCandidateRepairCandidateMatches(
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate,
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  priorCandidate: SourceFormulaArtifactTopologyRepairPriorCandidate,
  priorTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  candidateOrdinal: number,
  model: string,
): boolean {
  try {
    if (
      candidate.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION ||
      candidate.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION ||
      candidate.cacheKey !== sourceFormulaArtifactTopologyCandidateRepairCandidateCacheKey(
        evidence,
        initialRecovery,
        initialTopologyReview,
        priorCandidate,
        priorTopologyReview,
        candidateOrdinal,
        model,
      ) ||
      candidate.model !== model ||
      candidate.candidateOrdinal !== candidateOrdinal ||
      candidate.sourceId !== evidence.sourceId ||
      candidate.pageNumber !== evidence.pageNumber ||
      candidate.pageImagePath !== evidence.pageImagePath ||
      candidate.pageImageSha256 !== evidence.pageImageSha256 ||
      candidate.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      candidate.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      candidate.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT) ||
      candidate.initialRecoveryCacheKey !== initialRecovery.cacheKey ||
      candidate.initialRecoveryCacheIntegritySha256 !== initialRecovery.integritySha256 ||
      candidate.initialTopologyReviewCacheKey !== initialTopologyReview.cacheKey ||
      candidate.initialTopologyReviewCacheIntegritySha256 !== initialTopologyReview.integritySha256 ||
      candidate.priorCandidateCacheKey !== priorCandidate.cacheKey ||
      candidate.priorCandidateIntegritySha256 !== priorCandidate.integritySha256 ||
      candidate.priorCandidateRawResponse !== priorCandidate.rawResponse ||
      candidate.priorCandidateResponseSha256 !== sha256(priorCandidate.rawResponse) ||
      candidate.priorTopologyReviewCacheKey !== priorTopologyReview.cacheKey ||
      candidate.priorTopologyReviewCacheIntegritySha256 !== priorTopologyReview.integritySha256 ||
      candidate.priorTopologyReviewRawResponse !== priorTopologyReview.rawResponse ||
      candidate.priorTopologyReviewResponseSha256 !== sha256(priorTopologyReview.rawResponse) ||
      candidate.priorTopologyReviewReason !== priorTopologyReview.reason ||
      !Array.isArray(candidate.repairHistory) ||
      !Number.isSafeInteger(candidate.semanticAttempt) ||
      candidate.semanticAttempt < 1 ||
      candidate.semanticAttempt > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_SEMANTIC_ATTEMPTS ||
      candidate.semanticAttempt !== candidate.repairHistory.length + 1 ||
      !candidate.recoveredAt ||
      candidate.requestSha256 !== sha256(candidate.requestPayload) ||
      candidate.responseSha256 !== sha256(candidate.rawResponse) ||
      JSON.stringify(candidate.inputVisuals) !== JSON.stringify(initialRecovery.inputVisuals)
    ) return false;
    for (const repair of candidate.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") return false;
      try {
        sourceFormulaArtifactTopologyRecoveryResponse(
          repair.rawResponse,
          evidence,
          initialRecovery.inputVisuals,
        );
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) return false;
      }
    }
    const expectedPayload = sourceFormulaArtifactTopologyCandidateRepairCandidateAttemptPayload(
      sourceFormulaArtifactTopologyCandidateRepairCandidateRequestPayload(
        evidence,
        initialRecovery,
        initialTopologyReview,
        priorCandidate,
        priorTopologyReview,
        candidateOrdinal,
        model,
      ),
      candidate.repairHistory,
    );
    if (candidate.requestPayload !== expectedPayload) return false;
    const { integritySha256, ...unsigned } = candidate;
    if (integritySha256 !== sourceFormulaArtifactTopologyCandidateRepairCandidateIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactTopologyRecoveryResponse(
      candidate.rawResponse,
      evidence,
      initialRecovery.inputVisuals,
    );
    return JSON.stringify(parsed.detections) === JSON.stringify(candidate.detections) &&
      JSON.stringify(parsed.activeFormulaSlots) === JSON.stringify(candidate.activeFormulaSlots) &&
      JSON.stringify(parsed.priorSlotResolutions) === JSON.stringify(candidate.priorSlotResolutions);
  } catch {
    return false;
  }
}

/** Strict transitive matcher for the durable V6 candidate/reviewer history. */
function sourceFormulaArtifactTopologyCandidateRepairEnvelopeMatches(
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  try {
    const initialEvidence = sourceFormulaArtifactTopologyCandidateRepairInitialEvidence(
      evidence,
      envelope.initialRecovery,
    );
    if (
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION ||
      envelope.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION ||
      envelope.maxCandidates !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES ||
      envelope.cacheKey !== sourceFormulaArtifactTopologyCandidateRepairCycleCacheKey(
        evidence,
        envelope.initialRecovery,
        envelope.initialTopologyReview,
        envelope.model,
      ) ||
      envelope.sourceId !== evidence.sourceId ||
      envelope.pageNumber !== evidence.pageNumber ||
      envelope.pageImagePath !== evidence.pageImagePath ||
      envelope.pageImageSha256 !== evidence.pageImageSha256 ||
      envelope.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      envelope.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      envelope.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SYSTEM_PROMPT) ||
      !envelope.startedAt ||
      !envelope.updatedAt ||
      !Array.isArray(envelope.candidates) ||
      envelope.candidates.length < 1 ||
      envelope.candidates.length > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES - 1 ||
      !sourceFormulaArtifactTopologyRecoveryEnvelopeStructurallyMatchesEvidence(
        envelope.initialRecovery,
        initialEvidence,
      ) ||
      !sourceFormulaArtifactTopologyReviewEnvelopeMatches(
        envelope.initialTopologyReview,
        initialEvidence,
        envelope.initialRecovery,
        envelope.initialTopologyReview.model,
      ) ||
      envelope.initialTopologyReview.status !== "rejected"
    ) return false;
    let priorCandidate: SourceFormulaArtifactTopologyRepairPriorCandidate = envelope.initialRecovery;
    let priorReview = envelope.initialTopologyReview;
    for (let index = 0; index < envelope.candidates.length; index += 1) {
      const entry = envelope.candidates[index];
      const candidateOrdinal = index + 2;
      if (!entry || !entry.candidate || !sourceFormulaArtifactTopologyCandidateRepairCandidateMatches(
        entry.candidate,
        evidence,
        envelope.initialRecovery,
        envelope.initialTopologyReview,
        priorCandidate,
        priorReview,
        candidateOrdinal,
        envelope.model,
      )) return false;
      if (entry.topologyReview) {
        if (!sourceFormulaArtifactTopologyReviewEnvelopeMatches(
          entry.topologyReview,
          evidence,
          entry.candidate,
          entry.topologyReview.model,
        )) return false;
      }
      // Every predecessor must be independently rejected before the next
      // author pass exists. The final entry may be pending, confirmed, or the
      // terminal rejection; a missing final review is retry-only state.
      if (index < envelope.candidates.length - 1) {
        if (!entry.topologyReview || entry.topologyReview.status !== "rejected") return false;
      }
      priorCandidate = entry.candidate;
      if (entry.topologyReview) priorReview = entry.topologyReview;
      else if (index < envelope.candidates.length - 1) return false;
    }
    const { integritySha256, ...unsigned } = envelope;
    return integritySha256 === sourceFormulaArtifactTopologyCandidateRepairEnvelopeIntegrity(unsigned);
  } catch {
    return false;
  }
}

function sourceFormulaArtifactTopologyCandidateRepairFinalEntry(
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope,
): SourceFormulaArtifactTopologyCandidateRepairHistoryEntry | null {
  return envelope.candidates[envelope.candidates.length - 1] ?? null;
}

/**
 * V7 is deliberately a new state machine rather than a relaxation of V6.
 * Its root is a topology candidate which an independent reviewer already
 * confirmed, followed by a *normal* formula-review disagreement.  The
 * disagreement is evidence for a fresh whole-page authoring pass, never an
 * instruction for code to split, merge, rename, or move a formula slot.
 */
type SourceFormulaArtifactTopologyConsensusPriorCandidate =
  | SourceFormulaArtifactTopologyRecoveryCacheEnvelope
  | SourceFormulaArtifactTopologyCandidateRepairCandidate
  | SourceFormulaArtifactTopologyConsensusRepairCandidate;

function sourceFormulaArtifactTopologyConsensusBaseCandidate(
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
): SourceFormulaArtifactTopologyRepairPriorCandidate {
  if (base.protocol === "v5") return base.recovery;
  const finalEntry = sourceFormulaArtifactTopologyCandidateRepairFinalEntry(base.candidateRepair);
  if (!finalEntry) {
    throw new Error("Formula-artifact topology consensus repair V6 base has no terminal candidate.");
  }
  return finalEntry.candidate;
}

function sourceFormulaArtifactTopologyConsensusBaseTopologyReview(
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
): SourceFormulaArtifactTopologyReviewEnvelope {
  if (base.protocol === "v5") return base.topologyReview;
  const finalEntry = sourceFormulaArtifactTopologyCandidateRepairFinalEntry(base.candidateRepair);
  if (!finalEntry?.topologyReview) {
    throw new Error("Formula-artifact topology consensus repair V6 base has no terminal topology review.");
  }
  return finalEntry.topologyReview;
}

/**
 * V7 asks the author to account for both the original V5 old slots and every
 * active slot of the already-confirmed candidate.  This is a model-authored
 * graph input, not a deterministic remap: the parser still requires a full
 * inverse resolution for every supplied id.
 */
function sourceFormulaArtifactTopologyConsensusBaseInputs(
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
): SourceFormulaArtifactRecoveryInput[] {
  const recovery = base.protocol === "v5"
    ? base.recovery
    : base.candidateRepair.initialRecovery;
  const candidate = sourceFormulaArtifactTopologyConsensusBaseCandidate(base);
  const inputs = new Map<string, SourceFormulaArtifactRecoveryInput>();
  for (const input of recovery.inputVisuals) {
    inputs.set(input.sourceVisualId, {
      sourceVisualId: input.sourceVisualId,
      sourceId: input.sourceId,
      pageNumber: input.pageNumber,
      inputCaption: input.inputCaption,
      inputExactText: input.inputExactText,
      inputBBox: { ...input.inputBBox },
      inputEquationCropSha256: input.inputEquationCropSha256,
      reviewerIdentityAssessment: input.reviewerIdentityAssessment,
      reviewerReason: input.reviewerReason,
    });
  }
  for (const slot of candidate.activeFormulaSlots) {
    // If an active id is also an original old id, the active candidate is the
    // latest model-authored representation which the next author must account
    // for. Its id remains unchanged and therefore cannot silently change its
    // referent through a local migration.
    inputs.set(slot.sourceVisualId, {
      sourceVisualId: slot.sourceVisualId,
      sourceId: candidate.inputVisuals[0]?.sourceId ?? recovery.sourceId,
      pageNumber: candidate.inputVisuals[0]?.pageNumber ?? recovery.pageNumber,
      inputCaption: slot.caption,
      inputExactText: slot.exactText,
      inputBBox: { ...slot.bbox },
      inputEquationCropSha256: slot.equationCropSha256,
      reviewerIdentityAssessment: null,
      reviewerReason: null,
    });
  }
  return [...inputs.values()].sort((left, right) =>
    sourceFormulaSlotOrder(left.sourceVisualId) - sourceFormulaSlotOrder(right.sourceVisualId) ||
    left.sourceVisualId.localeCompare(right.sourceVisualId)
  );
}

function sourceFormulaArtifactTopologyConsensusBaseCandidateOrdinal(
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
): number {
  return base.protocol === "v5"
    ? 1
    : (sourceFormulaArtifactTopologyConsensusBaseCandidate(base) as
      SourceFormulaArtifactTopologyCandidateRepairCandidate).candidateOrdinal;
}

function sourceFormulaArtifactTopologyConsensusBaseMatches(
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  try {
    if (base.protocol === "v5") {
      const initialEvidence = sourceFormulaArtifactTopologyCandidateRepairInitialEvidence(
        evidence,
        base.recovery,
      );
      return sourceFormulaArtifactTopologyRecoveryEnvelopeStructurallyMatchesEvidence(
        base.recovery,
        initialEvidence,
      ) &&
        sourceFormulaArtifactTopologyReviewEnvelopeMatches(
          base.topologyReview,
          initialEvidence,
          base.recovery,
          base.topologyReview.model,
        ) &&
        base.topologyReview.status === "confirmed";
    }
    const finalEntry = sourceFormulaArtifactTopologyCandidateRepairFinalEntry(base.candidateRepair);
    return Boolean(
      finalEntry &&
      finalEntry.topologyReview &&
      finalEntry.topologyReview.status === "confirmed" &&
      finalEntry.candidate.cacheKey === base.terminalCandidateCacheKey &&
      finalEntry.candidate.integritySha256 === base.terminalCandidateIntegritySha256 &&
      finalEntry.topologyReview.cacheKey === base.terminalTopologyReviewCacheKey &&
      finalEntry.topologyReview.integritySha256 === base.terminalTopologyReviewCacheIntegritySha256 &&
      sourceFormulaArtifactTopologyCandidateRepairEnvelopeMatches(base.candidateRepair, evidence)
    );
  } catch {
    return false;
  }
}

function sourceFormulaArtifactTopologyConsensusReviewInputs(
  evidence: SourceFormulaReviewPageEvidence,
  candidate: Pick<SourceFormulaArtifactTopologyReviewCandidate, "activeFormulaSlots">,
): SourceFormulaReviewInput[] {
  return candidate.activeFormulaSlots
    .slice()
    .sort((left, right) =>
      sourceFormulaSlotOrder(left.sourceVisualId) - sourceFormulaSlotOrder(right.sourceVisualId) ||
      left.sourceVisualId.localeCompare(right.sourceVisualId)
    )
    .map((slot) => ({
      sourceVisualId: slot.sourceVisualId,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImagePath: evidence.pageImagePath,
      inputCaption: slot.caption,
      inputExactText: slot.exactText,
      bbox: { ...slot.bbox },
      equationCropSha256: slot.equationCropSha256,
    }));
}

function sourceFormulaArtifactTopologyConsensusFormulaFeedbackMatches(
  feedback: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  evidence: SourceFormulaReviewPageEvidence,
  candidate: Pick<SourceFormulaArtifactTopologyReviewCandidate, "activeFormulaSlots">,
): boolean {
  try {
    const expectedInputs = sourceFormulaArtifactTopologyConsensusReviewInputs(evidence, candidate);
    const failedReview = feedback.failedReview;
    if (
      !Array.isArray(feedback.rejections) ||
      feedback.rejections.length === 0 ||
      JSON.stringify(failedReview.inputVisuals) !== JSON.stringify(expectedInputs) ||
      failedReview.requestSha256 !== sha256(failedReview.requestPayload) ||
      failedReview.responseSha256 !== sha256(failedReview.rawResponse) ||
      !Number.isSafeInteger(failedReview.semanticAttempt) ||
      failedReview.semanticAttempt < 1 ||
      failedReview.semanticAttempt > SOURCE_FORMULA_REVIEW_MAX_SEMANTIC_ATTEMPTS ||
      failedReview.semanticAttempt !== failedReview.repairHistory.length + 1 ||
      !Array.isArray(failedReview.repairHistory)
    ) return false;
    const protocol = sourceFormulaReviewProtocolForFailedReview(
      failedReview,
      evidence,
      expectedInputs,
    );
    if (!protocol) return false;
    for (const repair of failedReview.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") return false;
      try {
        parseSourceFormulaReviewResponse(repair.rawResponse, expectedInputs, protocol);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) return false;
      }
    }
    const parsed = parseSourceFormulaReviewResponse(
      failedReview.rawResponse,
      expectedInputs,
      protocol,
    )
      .filter((decision) => decision.action === "reject");
    if (
      parsed.length !== feedback.rejections.length ||
      parsed.some((decision) =>
        decision.identityAssessment !== "identity_mismatch" ||
        decision.topologyAssessment === undefined,
      ) ||
      !parsed.some((decision) => decision.topologyAssessment === "topology_change")
    ) return false;
    const captured = new Map(feedback.rejections.map((rejection) => [rejection.sourceVisualId, rejection]));
    if (captured.size !== feedback.rejections.length) return false;
    return parsed.every((decision) => {
      const capturedDecision = captured.get(decision.sourceVisualId);
      return Boolean(
        capturedDecision &&
        capturedDecision.identityAssessment === decision.identityAssessment &&
        capturedDecision.reason === decision.reason &&
        capturedDecision.topologyAssessment === decision.topologyAssessment,
      );
    });
  } catch {
    return false;
  }
}

/**
 * A zero-active candidate has no per-slot ordinary review. Its page-level
 * review remains an independent model judgement: it can explicitly reject an
 * empty inventory and authorize the next full-page V7 candidate.
 */
function sourceFormulaArtifactTopologyEmptyInventoryReviewKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
  model: string,
): Record<string, unknown> {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_PROMPT_VERSION,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SYSTEM_PROMPT),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImagePath: evidence.pageImagePath,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    consensusRepairCacheKey: candidate.consensusRepairCacheKey,
    candidateCacheKey: candidate.cacheKey,
    candidateCacheIntegritySha256: candidate.integritySha256,
    candidateResponseSha256: sha256(candidate.rawResponse),
    activeFormulaSlots: candidate.activeFormulaSlots,
  };
}

function sourceFormulaArtifactTopologyEmptyInventoryReviewCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
  model: string,
): string {
  return sha256(JSON.stringify(
    sourceFormulaArtifactTopologyEmptyInventoryReviewKeyMaterial(evidence, candidate, model),
  ));
}

function sourceFormulaArtifactTopologyEmptyInventoryReviewRequestPayload(
  evidence: SourceFormulaReviewPageEvidence,
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
  model: string,
): string {
  return JSON.stringify({
    task: "Independently decide whether this exact model-authored whole-page candidate has a genuinely empty active formula inventory. Do not repair the inventory; confirm it or reject it with image-based evidence.",
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SYSTEM_PROMPT),
    ...sourceFormulaArtifactTopologyEmptyInventoryReviewKeyMaterial(evidence, candidate, model),
    canonicalPageText: evidence.canonicalPageText,
    candidateResponseVerbatim: candidate.rawResponse,
  });
}

function sourceFormulaArtifactTopologyEmptyInventoryReviewAttemptPayload(
  basePayload: string,
  repairHistory: readonly { rawResponse: string; diagnostic: string }[],
): string {
  if (repairHistory.length === 0) return basePayload;
  const prior = repairHistory[repairHistory.length - 1];
  return basePayload +
    "\n\nThe prior empty-inventory review response was invalid. Reinspect the complete page and return the exact required confirmation/rejection object. Here is the exact prior raw response and strict parse diagnostic:\n" +
    JSON.stringify(prior);
}

function sourceFormulaArtifactTopologyEmptyInventoryReviewResponse(
  raw: unknown,
): { status: "confirmed" | "rejected"; reason: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SourceFormulaReviewProtocolError("empty-inventory formula review response was empty or missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SourceFormulaReviewProtocolError(
      "empty-inventory formula review response was not valid JSON (" +
        (error instanceof Error ? error.message : String(error)) + ")",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SourceFormulaReviewProtocolError("empty-inventory formula review top level must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["reason", "status"])) {
    throw new SourceFormulaReviewProtocolError("empty-inventory formula review must contain only status and reason");
  }
  const status = record.status;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (
    (status !== "confirmed" && status !== "rejected") ||
    !reason ||
    reason.length > SOURCE_FORMULA_REVIEW_MAX_REASON_CHARS
  ) {
    throw new SourceFormulaReviewProtocolError("empty-inventory formula review requires a bounded confirmed/rejected status and reason");
  }
  return { status, reason };
}

function sourceFormulaArtifactTopologyEmptyInventoryReviewIntegrity(
  unsigned: SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelopeUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

function sourceFormulaArtifactTopologyEmptyInventoryReviewEnvelopeMatches(
  review: SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
): boolean {
  try {
    if (candidate.activeFormulaSlots.length !== 0) return false;
    if (
      review.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SCHEMA_VERSION ||
      review.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_PROMPT_VERSION ||
      review.cacheKey !== sourceFormulaArtifactTopologyEmptyInventoryReviewCacheKey(
        evidence,
        candidate,
        review.model,
      ) ||
      !review.model.trim() ||
      review.sourceId !== evidence.sourceId ||
      review.pageNumber !== evidence.pageNumber ||
      review.pageImagePath !== evidence.pageImagePath ||
      review.pageImageSha256 !== evidence.pageImageSha256 ||
      review.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      review.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      review.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SYSTEM_PROMPT) ||
      review.consensusRepairCacheKey !== candidate.consensusRepairCacheKey ||
      review.candidateCacheKey !== candidate.cacheKey ||
      review.candidateCacheIntegritySha256 !== candidate.integritySha256 ||
      review.candidateRawResponse !== candidate.rawResponse ||
      review.candidateResponseSha256 !== sha256(candidate.rawResponse) ||
      !Array.isArray(review.repairHistory) ||
      !Number.isSafeInteger(review.semanticAttempt) ||
      review.semanticAttempt < 1 ||
      review.semanticAttempt > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_MAX_SEMANTIC_ATTEMPTS ||
      review.semanticAttempt !== review.repairHistory.length + 1 ||
      !review.reviewedAt ||
      review.requestSha256 !== sha256(review.requestPayload) ||
      review.responseSha256 !== sha256(review.rawResponse)
    ) return false;
    for (const repair of review.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") return false;
      try {
        sourceFormulaArtifactTopologyEmptyInventoryReviewResponse(repair.rawResponse);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) return false;
      }
    }
    const expectedPayload = sourceFormulaArtifactTopologyEmptyInventoryReviewAttemptPayload(
      sourceFormulaArtifactTopologyEmptyInventoryReviewRequestPayload(evidence, candidate, review.model),
      review.repairHistory,
    );
    if (review.requestPayload !== expectedPayload) return false;
    const { integritySha256, ...unsigned } = review;
    if (integritySha256 !== sourceFormulaArtifactTopologyEmptyInventoryReviewIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactTopologyEmptyInventoryReviewResponse(review.rawResponse);
    return parsed.status === review.status && parsed.reason === review.reason;
  } catch {
    return false;
  }
}

async function requestSourceFormulaArtifactTopologyEmptyInventoryReview(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
): Promise<SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelope> {
  if (candidate.activeFormulaSlots.length !== 0) {
    throw new Error("Empty-inventory formula review received a candidate with active formula slots.");
  }
  const repairHistory: Array<{ rawResponse: string; diagnostic: string }> = [];
  const basePayload = sourceFormulaArtifactTopologyEmptyInventoryReviewRequestPayload(
    evidence,
    candidate,
    options.model,
  );
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    options.checkCancelled?.();
    const requestPayload = sourceFormulaArtifactTopologyEmptyInventoryReviewAttemptPayload(
      basePayload,
      repairHistory,
    );
    options.onProgress?.(
      "Independently reviewing empty formula inventory on " + evidence.sourceId + " p." +
        evidence.pageNumber + " (" + semanticAttempt + "/" +
        SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_MAX_SEMANTIC_ATTEMPTS + ")...",
    );
    let rawResponse = "";
    {
      const response = await createSourceModelCompletionWithHttp502Retry({
        client: options.client,
        request: {
          model: options.model,
          messages: [
            { role: "system", content: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: requestPayload },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64," + evidence.pageImage.toString("base64"),
                    detail: "high",
                  },
                },
              ] as never,
            },
          ],
        },
        timeoutMs: sourceFormulaReviewTimeoutMs(),
        checkpoint: options.checkCancelled,
        onProgress: options.onProgress,
        stageLabel: `empty formula inventory review on ${evidence.sourceId} p.${evidence.pageNumber}`,
      });
      rawResponse = response.choices[0]?.message?.content ?? "";
    }
    assertNonemptySourceFormulaModelResponse(rawResponse, "empty formula inventory review");
    let parsed: { status: "confirmed" | "rejected"; reason: string };
    try {
      parsed = sourceFormulaArtifactTopologyEmptyInventoryReviewResponse(rawResponse);
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewProtocolError)) throw error;
      if (semanticAttempt >= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_MAX_SEMANTIC_ATTEMPTS) {
        throw error;
      }
      repairHistory.push({ rawResponse, diagnostic: error.message });
      continue;
    }
    const unsigned: SourceFormulaArtifactTopologyEmptyInventoryReviewEnvelopeUnsigned = {
      schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_PROMPT_VERSION,
      cacheKey: sourceFormulaArtifactTopologyEmptyInventoryReviewCacheKey(evidence, candidate, options.model),
      model: options.model,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImagePath: evidence.pageImagePath,
      pageImageSha256: evidence.pageImageSha256,
      canonicalPageTextSha256: evidence.canonicalPageTextSha256,
      sourcePdfSha256: evidence.sourcePdfSha256,
      systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_EMPTY_INVENTORY_REVIEW_SYSTEM_PROMPT),
      consensusRepairCacheKey: candidate.consensusRepairCacheKey,
      candidateCacheKey: candidate.cacheKey,
      candidateCacheIntegritySha256: candidate.integritySha256,
      candidateRawResponse: candidate.rawResponse,
      candidateResponseSha256: sha256(candidate.rawResponse),
      requestPayload,
      requestSha256: sha256(requestPayload),
      repairHistory,
      rawResponse,
      responseSha256: sha256(rawResponse),
      semanticAttempt,
      reviewedAt: options.now?.() ?? new Date().toISOString(),
      status: parsed.status,
      reason: parsed.reason,
    };
    return {
      ...unsigned,
      integritySha256: sourceFormulaArtifactTopologyEmptyInventoryReviewIntegrity(unsigned),
    };
  }
  throw new SourceFormulaReviewProtocolError("bounded empty-inventory formula review attempts were exhausted");
}

function sourceFormulaArtifactTopologyConsensusFormulaFeedbackFromRejectedPage(
  page: SourceFormulaReviewRejectedPage,
  candidate: Pick<SourceFormulaArtifactTopologyReviewCandidate, "activeFormulaSlots">,
): SourceFormulaArtifactTopologyConsensusFormulaFeedback {
  const feedback: SourceFormulaArtifactTopologyConsensusFormulaFeedback = {
    failedReview: page.failedReview,
    rejections: page.rejections.map((rejection) => ({
      sourceVisualId: rejection.sourceVisualId,
      identityAssessment: rejection.identityAssessment,
      reason: rejection.reason,
      ...(rejection.topologyAssessment ? { topologyAssessment: rejection.topologyAssessment } : {}),
    })),
  };
  if (!sourceFormulaArtifactTopologyConsensusFormulaFeedbackMatches(feedback, page.evidence, candidate)) {
    throw new SourceFormulaReviewRejectedError([page], 0);
  }
  return feedback;
}

function sourceFormulaArtifactTopologyConsensusRepairCycleKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  model: string,
): Record<string, unknown> {
  const baseCandidate = sourceFormulaArtifactTopologyConsensusBaseCandidate(base);
  const baseTopologyReview = sourceFormulaArtifactTopologyConsensusBaseTopologyReview(base);
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION,
    detectorVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION,
    maxCandidates: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImagePath: evidence.pageImagePath,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    baseProtocol: base.protocol,
    baseCandidateCacheKey: baseCandidate.cacheKey,
    baseCandidateIntegritySha256: baseCandidate.integritySha256,
    baseTopologyReviewCacheKey: baseTopologyReview.cacheKey,
    baseTopologyReviewCacheIntegritySha256: baseTopologyReview.integritySha256,
    base,
    triggerFormulaReview,
    inputVisuals: sourceFormulaArtifactTopologyConsensusBaseInputs(base),
  };
}

function sourceFormulaArtifactTopologyConsensusRepairCycleCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  model: string,
): string {
  return sha256(JSON.stringify(
    sourceFormulaArtifactTopologyConsensusRepairCycleKeyMaterial(
      evidence,
      base,
      triggerFormulaReview,
      model,
    ),
  ));
}

function sourceFormulaArtifactTopologyConsensusRepairCandidateKeyMaterial(
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  priorCandidate: SourceFormulaArtifactTopologyConsensusPriorCandidate,
  priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback,
  candidateOrdinal: number,
  model: string,
): Record<string, unknown> {
  return {
    ...sourceFormulaArtifactTopologyConsensusRepairCycleKeyMaterial(
      evidence,
      base,
      triggerFormulaReview,
      model,
    ),
    candidateOrdinal,
    priorCandidateCacheKey: priorCandidate.cacheKey,
    priorCandidateIntegritySha256: priorCandidate.integritySha256,
    priorCandidateResponseSha256: sha256(priorCandidate.rawResponse),
    priorFeedback,
  };
}

function sourceFormulaArtifactTopologyConsensusRepairCandidateCacheKey(
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  priorCandidate: SourceFormulaArtifactTopologyConsensusPriorCandidate,
  priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback,
  candidateOrdinal: number,
  model: string,
): string {
  return sha256(JSON.stringify(
    sourceFormulaArtifactTopologyConsensusRepairCandidateKeyMaterial(
      evidence,
      base,
      triggerFormulaReview,
      priorCandidate,
      priorFeedback,
      candidateOrdinal,
      model,
    ),
  ));
}

function sourceFormulaArtifactTopologyConsensusRepairCandidateRequestPayload(
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  priorCandidate: SourceFormulaArtifactTopologyConsensusPriorCandidate,
  priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback,
  candidateOrdinal: number,
  model: string,
): string {
  const baseCandidate = sourceFormulaArtifactTopologyConsensusBaseCandidate(base);
  const baseTopologyReview = sourceFormulaArtifactTopologyConsensusBaseTopologyReview(base);
  return JSON.stringify({
    task: "A confirmed formula-topology candidate disagreed with a later ordinary formula reviewer. Author a fresh complete whole-page visual inventory and complete old-slot plus prior-active-slot to active-formula topology graph. Do not patch a crop, equation, or graph locally; return the exact JSON response shape from the system prompt.",
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT),
    ...sourceFormulaArtifactTopologyConsensusRepairCandidateKeyMaterial(
      evidence,
      base,
      triggerFormulaReview,
      priorCandidate,
      priorFeedback,
      candidateOrdinal,
      model,
    ),
    canonicalPageText: evidence.canonicalPageText,
    baseTopologyCandidateResponseVerbatim: baseCandidate.rawResponse,
    baseIndependentTopologyReviewerResponseVerbatim: baseTopologyReview.rawResponse,
    triggerNormalFormulaReviewerResponseVerbatim: triggerFormulaReview.failedReview.rawResponse,
    priorCandidateResponseVerbatim: priorCandidate.rawResponse,
    priorFeedbackVerbatim: priorFeedback.kind === "topology_review"
      ? priorFeedback.topologyReview.rawResponse
      : priorFeedback.kind === "formula_review"
        ? priorFeedback.formulaReview.failedReview.rawResponse
        : priorFeedback.emptyInventoryReview.rawResponse,
  });
}

function sourceFormulaArtifactTopologyConsensusRepairCandidateAttemptPayload(
  basePayload: string,
  repairHistory: readonly { rawResponse: string; diagnostic: string }[],
): string {
  if (repairHistory.length === 0) return basePayload;
  const prior = repairHistory[repairHistory.length - 1];
  return basePayload +
    "\n\nThe prior consensus successor response was invalid. Re-detect the complete page and return the full inventory and graph. Here is the exact prior raw response and strict parse diagnostic:\n" +
    JSON.stringify(prior);
}

function sourceFormulaArtifactTopologyConsensusRepairCandidateIntegrity(
  unsigned: SourceFormulaArtifactTopologyConsensusRepairCandidateUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

function sourceFormulaArtifactTopologyConsensusRepairEnvelopeIntegrity(
  unsigned: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelopeUnsigned,
): string {
  return sha256(JSON.stringify(unsigned));
}

async function requestSourceFormulaArtifactTopologyConsensusRepairCandidate(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  priorCandidate: SourceFormulaArtifactTopologyConsensusPriorCandidate,
  priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback,
  candidateOrdinal: number,
): Promise<SourceFormulaArtifactTopologyConsensusRepairCandidate> {
  const repairHistory: Array<{ rawResponse: string; diagnostic: string }> = [];
  const inputVisuals = sourceFormulaArtifactTopologyConsensusBaseInputs(base);
  const basePayload = sourceFormulaArtifactTopologyConsensusRepairCandidateRequestPayload(
    evidence,
    base,
    triggerFormulaReview,
    priorCandidate,
    priorFeedback,
    candidateOrdinal,
    options.model,
  );
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    options.checkCancelled?.();
    const requestPayload = sourceFormulaArtifactTopologyConsensusRepairCandidateAttemptPayload(
      basePayload,
      repairHistory,
    );
    options.onProgress?.(
      "Re-authoring formula consensus candidate " + candidateOrdinal + "/" +
        SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES +
        " on " + evidence.sourceId + " p." + evidence.pageNumber +
        " (" + semanticAttempt + "/" +
        SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_SEMANTIC_ATTEMPTS + ")...",
    );
    let rawResponse = "";
    {
      const response = await createSourceModelCompletionWithHttp502Retry({
        client: options.client,
        request: {
          model: options.model,
          messages: [
            { role: "system", content: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: requestPayload },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64," + evidence.pageImage.toString("base64"),
                    detail: "high",
                  },
                },
              ] as never,
            },
          ],
        },
        timeoutMs: sourceFormulaReviewTimeoutMs(),
        checkpoint: options.checkCancelled,
        onProgress: options.onProgress,
        stageLabel: `formula consensus candidate ${candidateOrdinal} on ${evidence.sourceId} p.${evidence.pageNumber}`,
      });
      rawResponse = response.choices[0]?.message?.content ?? "";
    }
    assertNonemptySourceFormulaModelResponse(rawResponse, "formula topology consensus repair");
    let recovered: ReturnType<typeof sourceFormulaArtifactTopologyRecoveryResponse>;
    try {
      recovered = sourceFormulaArtifactTopologyRecoveryResponse(rawResponse, evidence, inputVisuals);
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewProtocolError)) throw error;
      if (semanticAttempt >= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_SEMANTIC_ATTEMPTS) {
        throw error;
      }
      repairHistory.push({ rawResponse, diagnostic: error.message });
      continue;
    }
    const cycleCacheKey = sourceFormulaArtifactTopologyConsensusRepairCycleCacheKey(
      evidence,
      base,
      triggerFormulaReview,
      options.model,
    );
    const unsigned: SourceFormulaArtifactTopologyConsensusRepairCandidateUnsigned = {
      schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION,
      promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION,
      cacheKey: sourceFormulaArtifactTopologyConsensusRepairCandidateCacheKey(
        evidence,
        base,
        triggerFormulaReview,
        priorCandidate,
        priorFeedback,
        candidateOrdinal,
        options.model,
      ),
      model: options.model,
      candidateOrdinal,
      sourceId: evidence.sourceId,
      pageNumber: evidence.pageNumber,
      pageImagePath: evidence.pageImagePath,
      pageImageSha256: evidence.pageImageSha256,
      canonicalPageTextSha256: evidence.canonicalPageTextSha256,
      sourcePdfSha256: evidence.sourcePdfSha256,
      systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT),
      consensusRepairCacheKey: cycleCacheKey,
      priorCandidateCacheKey: priorCandidate.cacheKey,
      priorCandidateIntegritySha256: priorCandidate.integritySha256,
      priorCandidateRawResponse: priorCandidate.rawResponse,
      priorCandidateResponseSha256: sha256(priorCandidate.rawResponse),
      priorFeedback,
      requestPayload,
      requestSha256: sha256(requestPayload),
      repairHistory,
      rawResponse,
      responseSha256: sha256(rawResponse),
      semanticAttempt,
      recoveredAt: options.now?.() ?? new Date().toISOString(),
      inputVisuals,
      detections: recovered.detections,
      activeFormulaSlots: recovered.activeFormulaSlots,
      priorSlotResolutions: recovered.priorSlotResolutions,
    };
    return {
      ...unsigned,
      integritySha256: sourceFormulaArtifactTopologyConsensusRepairCandidateIntegrity(unsigned),
    };
  }
  throw new SourceFormulaReviewProtocolError("bounded topology consensus successor attempts were exhausted");
}

function sourceFormulaArtifactTopologyConsensusRepairFeedbackMatches(
  feedback: SourceFormulaArtifactTopologyConsensusRepairFeedback,
  evidence: SourceFormulaReviewPageEvidence,
  priorCandidate: SourceFormulaArtifactTopologyReviewCandidate,
): boolean {
  if (feedback.kind === "formula_review") {
    return sourceFormulaArtifactTopologyConsensusFormulaFeedbackMatches(
      feedback.formulaReview,
      evidence,
      priorCandidate,
    );
  }
  if (feedback.kind === "empty_inventory_review") {
    return sourceFormulaArtifactTopologyEmptyInventoryReviewEnvelopeMatches(
      feedback.emptyInventoryReview,
      evidence,
      priorCandidate as SourceFormulaArtifactTopologyConsensusRepairCandidate,
    ) && feedback.emptyInventoryReview.status === "rejected";
  }
  return sourceFormulaArtifactTopologyReviewEnvelopeMatches(
    feedback.topologyReview,
    evidence,
    priorCandidate,
    feedback.topologyReview.model,
  ) && feedback.topologyReview.status === "rejected";
}

function sourceFormulaArtifactTopologyConsensusRepairCandidateMatches(
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  priorCandidate: SourceFormulaArtifactTopologyConsensusPriorCandidate,
  priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback,
  candidateOrdinal: number,
  model: string,
): boolean {
  try {
    const inputVisuals = sourceFormulaArtifactTopologyConsensusBaseInputs(base);
    if (
      candidate.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION ||
      candidate.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION ||
      candidate.cacheKey !== sourceFormulaArtifactTopologyConsensusRepairCandidateCacheKey(
        evidence,
        base,
        triggerFormulaReview,
        priorCandidate,
        priorFeedback,
        candidateOrdinal,
        model,
      ) ||
      candidate.model !== model ||
      candidate.candidateOrdinal !== candidateOrdinal ||
      candidate.sourceId !== evidence.sourceId ||
      candidate.pageNumber !== evidence.pageNumber ||
      candidate.pageImagePath !== evidence.pageImagePath ||
      candidate.pageImageSha256 !== evidence.pageImageSha256 ||
      candidate.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      candidate.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      candidate.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT) ||
      candidate.consensusRepairCacheKey !== sourceFormulaArtifactTopologyConsensusRepairCycleCacheKey(
        evidence,
        base,
        triggerFormulaReview,
        model,
      ) ||
      candidate.priorCandidateCacheKey !== priorCandidate.cacheKey ||
      candidate.priorCandidateIntegritySha256 !== priorCandidate.integritySha256 ||
      candidate.priorCandidateRawResponse !== priorCandidate.rawResponse ||
      candidate.priorCandidateResponseSha256 !== sha256(priorCandidate.rawResponse) ||
      JSON.stringify(candidate.priorFeedback) !== JSON.stringify(priorFeedback) ||
      !sourceFormulaArtifactTopologyConsensusRepairFeedbackMatches(
        candidate.priorFeedback,
        evidence,
        priorCandidate,
      ) ||
      !Array.isArray(candidate.repairHistory) ||
      !Number.isSafeInteger(candidate.semanticAttempt) ||
      candidate.semanticAttempt < 1 ||
      candidate.semanticAttempt > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_SEMANTIC_ATTEMPTS ||
      candidate.semanticAttempt !== candidate.repairHistory.length + 1 ||
      !candidate.recoveredAt ||
      candidate.requestSha256 !== sha256(candidate.requestPayload) ||
      candidate.responseSha256 !== sha256(candidate.rawResponse) ||
      JSON.stringify(candidate.inputVisuals) !== JSON.stringify(inputVisuals)
    ) return false;
    for (const repair of candidate.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") return false;
      try {
        sourceFormulaArtifactTopologyRecoveryResponse(repair.rawResponse, evidence, inputVisuals);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) return false;
      }
    }
    const expectedPayload = sourceFormulaArtifactTopologyConsensusRepairCandidateAttemptPayload(
      sourceFormulaArtifactTopologyConsensusRepairCandidateRequestPayload(
        evidence,
        base,
        triggerFormulaReview,
        priorCandidate,
        priorFeedback,
        candidateOrdinal,
        model,
      ),
      candidate.repairHistory,
    );
    if (candidate.requestPayload !== expectedPayload) return false;
    const { integritySha256, ...unsigned } = candidate;
    if (integritySha256 !== sourceFormulaArtifactTopologyConsensusRepairCandidateIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactTopologyRecoveryResponse(candidate.rawResponse, evidence, inputVisuals);
    return JSON.stringify(parsed.detections) === JSON.stringify(candidate.detections) &&
      JSON.stringify(parsed.activeFormulaSlots) === JSON.stringify(candidate.activeFormulaSlots) &&
      JSON.stringify(parsed.priorSlotResolutions) === JSON.stringify(candidate.priorSlotResolutions);
  } catch {
    return false;
  }
}

function sourceFormulaArtifactTopologyConsensusRepairEnvelope(
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  model: string,
  candidates: readonly SourceFormulaArtifactTopologyConsensusRepairHistoryEntry[],
  startedAt: string,
  updatedAt: string,
): SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope {
  const unsigned: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelopeUnsigned = {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION,
    detectorVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION,
    maxCandidates: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES,
    cacheKey: sourceFormulaArtifactTopologyConsensusRepairCycleCacheKey(
      evidence,
      base,
      triggerFormulaReview,
      model,
    ),
    model,
    sourceId: evidence.sourceId,
    pageNumber: evidence.pageNumber,
    pageImagePath: evidence.pageImagePath,
    pageImageSha256: evidence.pageImageSha256,
    canonicalPageTextSha256: evidence.canonicalPageTextSha256,
    sourcePdfSha256: evidence.sourcePdfSha256,
    systemPromptSha256: sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT),
    base,
    triggerFormulaReview,
    candidates: candidates.map((entry) => ({
      candidate: entry.candidate,
      ...(entry.topologyReview ? { topologyReview: entry.topologyReview } : {}),
      ...(entry.formulaReviewFeedback ? { formulaReviewFeedback: entry.formulaReviewFeedback } : {}),
      ...(entry.emptyInventoryFormulaReview ? {
        emptyInventoryFormulaReview: entry.emptyInventoryFormulaReview,
      } : {}),
    })),
    startedAt,
    updatedAt,
  };
  return {
    ...unsigned,
    integritySha256: sourceFormulaArtifactTopologyConsensusRepairEnvelopeIntegrity(unsigned),
  };
}

/** Strict transitive V7 verifier. It validates the immutable confirmed base,
 * exact raw normal-review feedback, every candidate/reviewer pair, and the
 * bounded state transitions. A raw cache payload is never projected solely
 * because its outer hash happens to look plausible. */
function sourceFormulaArtifactTopologyConsensusRepairEnvelopeMatches(
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  try {
    const baseOrdinal = sourceFormulaArtifactTopologyConsensusBaseCandidateOrdinal(envelope.base);
    const baseCandidate = sourceFormulaArtifactTopologyConsensusBaseCandidate(envelope.base);
    if (
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION ||
      envelope.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION ||
      envelope.maxCandidates !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES ||
      envelope.cacheKey !== sourceFormulaArtifactTopologyConsensusRepairCycleCacheKey(
        evidence,
        envelope.base,
        envelope.triggerFormulaReview,
        envelope.model,
      ) ||
      envelope.sourceId !== evidence.sourceId ||
      envelope.pageNumber !== evidence.pageNumber ||
      envelope.pageImagePath !== evidence.pageImagePath ||
      envelope.pageImageSha256 !== evidence.pageImageSha256 ||
      envelope.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 ||
      envelope.sourcePdfSha256 !== evidence.sourcePdfSha256 ||
      envelope.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SYSTEM_PROMPT) ||
      !envelope.startedAt ||
      !envelope.updatedAt ||
      !Array.isArray(envelope.candidates) ||
      envelope.candidates.length > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES - baseOrdinal ||
      !sourceFormulaArtifactTopologyConsensusBaseMatches(envelope.base, evidence) ||
      !sourceFormulaArtifactTopologyConsensusFormulaFeedbackMatches(
        envelope.triggerFormulaReview,
        evidence,
        baseCandidate,
      )
    ) return false;
    let priorCandidate: SourceFormulaArtifactTopologyConsensusPriorCandidate = baseCandidate;
    let priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback = {
      kind: "formula_review",
      formulaReview: envelope.triggerFormulaReview,
    };
    for (let index = 0; index < envelope.candidates.length; index += 1) {
      const entry = envelope.candidates[index];
      const candidateOrdinal = baseOrdinal + index + 1;
      if (
        !entry ||
        !entry.candidate ||
        !sourceFormulaArtifactTopologyConsensusRepairCandidateMatches(
          entry.candidate,
          evidence,
          envelope.base,
          envelope.triggerFormulaReview,
          priorCandidate,
          priorFeedback,
          candidateOrdinal,
          envelope.model,
        )
      ) return false;
      if (entry.topologyReview) {
        if (!sourceFormulaArtifactTopologyReviewEnvelopeMatches(
          entry.topologyReview,
          evidence,
          entry.candidate,
          entry.topologyReview.model,
        )) return false;
      }
      if (entry.formulaReviewFeedback) {
        if (
          !entry.topologyReview ||
          entry.topologyReview.status !== "confirmed" ||
          !sourceFormulaArtifactTopologyConsensusFormulaFeedbackMatches(
            entry.formulaReviewFeedback,
            evidence,
            entry.candidate,
          )
        ) return false;
      }
      if (entry.emptyInventoryFormulaReview) {
        if (
          !entry.topologyReview ||
          entry.topologyReview.status !== "confirmed" ||
          entry.formulaReviewFeedback ||
          !sourceFormulaArtifactTopologyEmptyInventoryReviewEnvelopeMatches(
            entry.emptyInventoryFormulaReview,
            evidence,
            entry.candidate,
          ) ||
          (
            entry.emptyInventoryFormulaReview.status === "confirmed" &&
            index !== envelope.candidates.length - 1
          )
        ) return false;
      }
      if (entry.formulaReviewFeedback && entry.emptyInventoryFormulaReview) return false;
      if (index < envelope.candidates.length - 1) {
        // A fresh successor is justified only by a signed reviewer rejection:
        // either independent topology R[n] or normal formula N[n].
        if (
          !entry.topologyReview ||
          (
            entry.topologyReview.status !== "rejected" &&
            !entry.formulaReviewFeedback &&
            entry.emptyInventoryFormulaReview?.status !== "rejected"
          )
        ) return false;
      }
      priorCandidate = entry.candidate;
      if (entry.topologyReview?.status === "rejected") {
        priorFeedback = { kind: "topology_review", topologyReview: entry.topologyReview };
      } else if (entry.formulaReviewFeedback) {
        priorFeedback = { kind: "formula_review", formulaReview: entry.formulaReviewFeedback };
      } else if (entry.emptyInventoryFormulaReview?.status === "rejected") {
        priorFeedback = {
          kind: "empty_inventory_review",
          emptyInventoryReview: entry.emptyInventoryFormulaReview,
        };
      } else if (index < envelope.candidates.length - 1) {
        return false;
      }
    }
    const { integritySha256, ...unsigned } = envelope;
    return integritySha256 === sourceFormulaArtifactTopologyConsensusRepairEnvelopeIntegrity(unsigned);
  } catch {
    return false;
  }
}

function sourceFormulaArtifactTopologyConsensusRepairFinalEntry(
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
): SourceFormulaArtifactTopologyConsensusRepairHistoryEntry | null {
  return envelope.candidates[envelope.candidates.length - 1] ?? null;
}

function sourceFormulaArtifactTopologyConsensusRepairIsProjectionConfirmed(
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
): boolean {
  const finalEntry = sourceFormulaArtifactTopologyConsensusRepairFinalEntry(envelope);
  return Boolean(
    finalEntry?.topologyReview &&
    finalEntry.topologyReview.status === "confirmed" &&
    !finalEntry.formulaReviewFeedback &&
    (
      finalEntry.candidate.activeFormulaSlots.length > 0 ||
      finalEntry.emptyInventoryFormulaReview?.status === "confirmed"
    ),
  );
}

/** Cheap V7 cache-container check for extraction. Full root/base/feedback and
 * history validation is always repeated before a rehydrate or finalizer
 * projection. Pending V7 cycles intentionally remain valid cache containers
 * so their durable cap cannot be replaced by generic V3 detection. */
function sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  fingerprint: string,
): boolean {
  try {
    const envelope = entry?.formulaArtifactTopologyConsensusRepair;
    const candidate = envelope
      ? sourceFormulaArtifactTopologyConsensusRepairFinalEntry(envelope)?.candidate ??
        sourceFormulaArtifactTopologyConsensusBaseCandidate(envelope.base)
      : null;
    if (
      entry?.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION ||
      entry.fingerprint !== fingerprint ||
      !envelope ||
      !candidate ||
      envelope.pageImagePath !== pageUrl ||
      envelope.pageImageSha256 !== fingerprint ||
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION ||
      envelope.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION ||
      envelope.maxCandidates !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES ||
      !Array.isArray(envelope.candidates) ||
      !Array.isArray(candidate.detections) ||
      JSON.stringify(entry.detections) !== JSON.stringify(candidate.detections)
    ) return false;
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaArtifactTopologyConsensusRepairEnvelopeIntegrity(unsigned)) return false;
    validateDetectionRecords(entry.detections);
    return true;
  } catch {
    return false;
  }
}

function sourceFormulaArtifactTopologyConsensusRepairHasCurrentEvidence(
  contentPath: string,
  gardenSlug: string,
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
  livePageImageSha256?: string,
): boolean {
  try {
    if (
      !envelope.sourceId.trim() ||
      !Number.isSafeInteger(envelope.pageNumber) ||
      envelope.pageNumber < 1 ||
      pageNumberFromAssetUrl(envelope.pageImagePath) !== envelope.pageNumber
    ) return false;
    const snapshotPath = assetDiskPath(contentPath, gardenSlug, envelope.pageImagePath);
    if (!snapshotPath || !fs.existsSync(snapshotPath)) return false;
    const pageImageSha256 = livePageImageSha256 ?? sha256(fs.readFileSync(snapshotPath));
    if (pageImageSha256 !== envelope.pageImageSha256) return false;
    const canonicalPageText = canonicalSourcePageMarkdown(
      contentPath,
      gardenSlug,
      envelope.sourceId,
      envelope.pageNumber,
    );
    if (!canonicalPageText || sha256(canonicalPageText) !== envelope.canonicalPageTextSha256) return false;
    return sourcePdfEvidence(contentPath, gardenSlug, envelope.sourceId).sourcePdfSha256 ===
      envelope.sourcePdfSha256;
  } catch {
    return false;
  }
}

function sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanEntryForPageEvidence(
  entry: SourceVisualScanEntry | undefined,
  snapshotFingerprint: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope | null {
  const envelope = entry?.formulaArtifactTopologyConsensusRepair;
  if (
    !envelope ||
    !sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(
      entry,
      evidence.pageImagePath,
      snapshotFingerprint,
    ) ||
    !sourceFormulaArtifactTopologyConsensusRepairEnvelopeMatches(envelope, evidence)
  ) return null;
  return envelope;
}

function sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanCacheForPageEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope | null {
  const entry = loadSourceVisualScanCache(contentPath, gardenSlug)
    .sources[evidence.sourceId]?.[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!entry || !snapshotPath || !fs.existsSync(snapshotPath)) return null;
  return sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanEntryForPageEvidence(
    entry,
    sha256(fs.readFileSync(snapshotPath)),
    evidence,
  );
}

function sourceFormulaArtifactRecoveryScanEntryMatches(
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  fingerprint: string,
): boolean {
  try {
    const envelope = entry?.formulaArtifactRecovery;
    if (
      entry?.detectorVersion !== SOURCE_FORMULA_ARTIFACT_RECOVERY_DETECTOR_VERSION ||
      entry.fingerprint !== fingerprint ||
      !envelope ||
      // A v4 receipt is reusable only when the normal page-snapshot path now
      // contains the exact fresh 1600px PDF render that the recovery model and
      // re-review consumed. Never crop a recovered bbox from an older 1200px
      // snapshot that merely happens to share the URL.
      envelope.pageImageSha256 !== fingerprint ||
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_RECOVERY_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_RECOVERY_PROMPT_VERSION ||
      envelope.pageImagePath !== pageUrl ||
      !Array.isArray(envelope.detections) ||
      JSON.stringify(entry.detections) !== JSON.stringify(envelope.detections)
    ) return false;
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaArtifactRecoveryEnvelopeIntegrity(unsigned)) return false;
    validateDetectionRecords(entry.detections);
    return true;
  } catch {
    return false;
  }
}

/**
 * A V5 receipt is intentionally a different detector version from V4.  It is
 * a complete model-authored page inventory whose equation ids come from the
 * topology graph, rather than from local counter allocation.  This cheap
 * check verifies the durable container; callers which have page evidence use
 * the stricter envelope matcher below before trusting its lineage.
 */
function sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  fingerprint: string,
): boolean {
  try {
    const envelope = entry?.formulaArtifactTopologyRecovery;
    if (
      entry?.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION ||
      entry.fingerprint !== fingerprint ||
      !envelope ||
      envelope.pageImageSha256 !== fingerprint ||
      envelope.pageImagePath !== pageUrl ||
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_PROMPT_VERSION ||
      !Array.isArray(envelope.detections) ||
      !Array.isArray(envelope.activeFormulaSlots) ||
      !Array.isArray(envelope.priorSlotResolutions) ||
      JSON.stringify(entry.detections) !== JSON.stringify(envelope.detections)
    ) return false;
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaArtifactTopologyRecoveryEnvelopeIntegrity(unsigned)) {
      return false;
    }
    validateDetectionRecords(entry.detections);
    return true;
  } catch {
    return false;
  }
}

/** Cheap V6 container check used by extraction before it has full review
 * evidence. Full recursive C1/R1/C2/R2/C3/R3 validation happens below and
 * again in finalization; this function never makes a projection by itself. */
function sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  fingerprint: string,
): boolean {
  try {
    const envelope = entry?.formulaArtifactTopologyCandidateRepair;
    const finalEntry = envelope ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(envelope) : null;
    if (
      entry?.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION ||
      entry.fingerprint !== fingerprint ||
      !envelope ||
      !finalEntry ||
      envelope.pageImagePath !== pageUrl ||
      envelope.pageImageSha256 !== fingerprint ||
      envelope.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION ||
      envelope.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION ||
      envelope.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION ||
      envelope.maxCandidates !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES ||
      !Array.isArray(envelope.candidates) ||
      envelope.candidates.length < 1 ||
      envelope.candidates.length > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES - 1 ||
      !Array.isArray(finalEntry.candidate.detections) ||
      JSON.stringify(entry.detections) !== JSON.stringify(finalEntry.candidate.detections)
    ) return false;
    const { integritySha256, ...unsigned } = envelope;
    if (integritySha256 !== sourceFormulaArtifactTopologyCandidateRepairEnvelopeIntegrity(unsigned)) return false;
    validateDetectionRecords(entry.detections);
    return true;
  } catch {
    return false;
  }
}

/** V6 inherits the exact live evidence contract from its immutable rejected
 * V5 C1/R1 base. A later author/reviewer model change must not reopen the cap
 * for the same PDF/render/text evidence. */
function sourceFormulaArtifactTopologyCandidateRepairHasCurrentEvidence(
  contentPath: string,
  gardenSlug: string,
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope,
  livePageImageSha256?: string,
): boolean {
  return Boolean(
    envelope.sourceId === envelope.initialRecovery.sourceId &&
    envelope.pageNumber === envelope.initialRecovery.pageNumber &&
    envelope.pageImagePath === envelope.initialRecovery.pageImagePath &&
    envelope.pageImageSha256 === envelope.initialRecovery.pageImageSha256 &&
    envelope.canonicalPageTextSha256 === envelope.initialRecovery.canonicalPageTextSha256 &&
    envelope.sourcePdfSha256 === envelope.initialRecovery.sourcePdfSha256 &&
    sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
      contentPath,
      gardenSlug,
      envelope.initialRecovery,
      livePageImageSha256,
    )
  );
}

function sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanEntryForPageEvidence(
  entry: SourceVisualScanEntry | undefined,
  snapshotFingerprint: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope | null {
  const envelope = entry?.formulaArtifactTopologyCandidateRepair;
  if (
    !envelope ||
    !sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(
      entry,
      evidence.pageImagePath,
      snapshotFingerprint,
    ) ||
    !sourceFormulaArtifactTopologyCandidateRepairEnvelopeMatches(envelope, evidence)
  ) return null;
  return envelope;
}

function sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanCacheForPageEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope | null {
  const entry = loadSourceVisualScanCache(contentPath, gardenSlug)
    .sources[evidence.sourceId]?.[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!entry || !snapshotPath || !fs.existsSync(snapshotPath)) return null;
  return sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanEntryForPageEvidence(
    entry,
    sha256(fs.readFileSync(snapshotPath)),
    evidence,
  );
}

function sourceFormulaArtifactTopologyCandidateRepairScanEntryIsConfirmed(
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  fingerprint: string,
): boolean {
  try {
    const envelope = entry?.formulaArtifactTopologyCandidateRepair;
    const finalEntry = envelope ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(envelope) : null;
    const review = finalEntry?.topologyReview;
    const candidate = finalEntry?.candidate;
    if (
      !envelope ||
      !finalEntry ||
      !candidate ||
      !review ||
      review.status !== "confirmed" ||
      !sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(entry, pageUrl, fingerprint) ||
      candidate.sourceId !== envelope.sourceId ||
      candidate.pageNumber !== envelope.pageNumber ||
      candidate.pageImagePath !== envelope.pageImagePath ||
      candidate.pageImageSha256 !== fingerprint ||
      candidate.canonicalPageTextSha256 !== envelope.canonicalPageTextSha256 ||
      candidate.sourcePdfSha256 !== envelope.sourcePdfSha256 ||
      review.recoveryCacheKey !== finalEntry.candidate.cacheKey ||
      review.recoveryCacheIntegritySha256 !== finalEntry.candidate.integritySha256 ||
      review.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SCHEMA_VERSION ||
      review.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_PROMPT_VERSION ||
      review.sourceId !== envelope.sourceId ||
      review.pageNumber !== envelope.pageNumber ||
      review.pageImageSha256 !== fingerprint ||
      review.canonicalPageTextSha256 !== envelope.canonicalPageTextSha256 ||
      review.sourcePdfSha256 !== envelope.sourcePdfSha256 ||
      review.systemPromptSha256 !== sha256(SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SYSTEM_PROMPT) ||
      review.requestSha256 !== sha256(review.requestPayload) ||
      review.responseSha256 !== sha256(review.rawResponse)
    ) return false;
    const { integritySha256: candidateIntegritySha256, ...candidateUnsigned } = candidate;
    if (
      candidateIntegritySha256 !==
        sourceFormulaArtifactTopologyCandidateRepairCandidateIntegrity(candidateUnsigned) ||
      review.cacheKey !== sourceFormulaArtifactTopologyReviewCacheKey(
        {
          sourceId: envelope.sourceId,
          pageNumber: envelope.pageNumber,
          pageImagePath: envelope.pageImagePath,
          pageImageSha256: fingerprint,
          canonicalPageText: "",
          canonicalPageTextSha256: envelope.canonicalPageTextSha256,
          sourcePdfPath: "",
          sourcePdfSha256: envelope.sourcePdfSha256,
          pageImage: Buffer.alloc(0),
          inputs: [],
          crops: new Map(),
        },
        candidate,
        review.model,
      )
    ) return false;
    if (
      !Array.isArray(review.repairHistory) ||
      !Number.isSafeInteger(review.semanticAttempt) ||
      review.semanticAttempt < 1 ||
      review.semanticAttempt > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_MAX_SEMANTIC_ATTEMPTS ||
      review.semanticAttempt !== review.repairHistory.length + 1
    ) return false;
    for (const repair of review.repairHistory) {
      if (!repair || typeof repair.rawResponse !== "string" || typeof repair.diagnostic !== "string") return false;
      try {
        sourceFormulaArtifactTopologyReviewResponse(repair.rawResponse, candidate);
        return false;
      } catch (error) {
        if (!(error instanceof SourceFormulaReviewProtocolError) || error.message !== repair.diagnostic) return false;
      }
    }
    const { integritySha256, ...unsigned } = review;
    if (integritySha256 !== sourceFormulaArtifactTopologyReviewEnvelopeIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactTopologyReviewResponse(review.rawResponse, candidate);
    return parsed.status === "confirmed" &&
      parsed.reason === review.reason &&
      JSON.stringify(parsed.priorSlotResolutions) === JSON.stringify(review.priorSlotResolutions);
  } catch {
    return false;
  }
}

/**
 * V5 receipts bind more than the rendered PNG.  A byte-identical snapshot is
 * not enough when its canonical Markdown context or preserved source PDF has
 * changed: retaining the old topology would make its signed graph describe
 * evidence it never reviewed.  Keep this check deliberately read-only so a
 * failed validation leaves the old receipt available for diagnostics while
 * extraction can replace it only through the normal bounded scan/review flow.
 *
 * Callers that already read the live page snapshot may supply its hash; other
 * callers must let this helper hash the current asset rather than trusting the
 * cache entry's self-reported fingerprint.
 */
function sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
  contentPath: string,
  gardenSlug: string,
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  livePageImageSha256?: string,
): boolean {
  try {
    if (
      !recovery.sourceId.trim() ||
      !Number.isSafeInteger(recovery.pageNumber) ||
      recovery.pageNumber < 1 ||
      pageNumberFromAssetUrl(recovery.pageImagePath) !== recovery.pageNumber
    ) return false;
    const snapshotPath = assetDiskPath(contentPath, gardenSlug, recovery.pageImagePath);
    if (!snapshotPath || !fs.existsSync(snapshotPath)) return false;
    const pageImageSha256 = livePageImageSha256 ?? sha256(fs.readFileSync(snapshotPath));
    if (pageImageSha256 !== recovery.pageImageSha256) return false;
    const canonicalPageText = canonicalSourcePageMarkdown(
      contentPath,
      gardenSlug,
      recovery.sourceId,
      recovery.pageNumber,
    );
    if (!canonicalPageText || sha256(canonicalPageText) !== recovery.canonicalPageTextSha256) {
      return false;
    }
    return sourcePdfEvidence(contentPath, gardenSlug, recovery.sourceId).sourcePdfSha256 ===
      recovery.sourcePdfSha256;
  } catch {
    return false;
  }
}

/**
 * Revalidate a V5 receipt against a live page even when the current ledger is
 * already projected to its active slots.  The signed recovery itself names
 * the pre-topology inputs, so use those exact historical inputs for envelope
 * verification rather than requiring a current ledger to retain stale ids.
 */
function sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanEntryForPageEvidence(
  entry: SourceVisualScanEntry | undefined,
  snapshotFingerprint: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyRecoveryCacheEnvelope | null {
  const envelope = entry?.formulaArtifactTopologyRecovery;
  if (!entry || !envelope) return null;
  const receiptEvidence: SourceFormulaReviewPageEvidence = {
    ...evidence,
    inputs: envelope.inputVisuals.map((input) => ({
      sourceVisualId: input.sourceVisualId,
      sourceId: input.sourceId,
      pageNumber: input.pageNumber,
      pageImagePath: evidence.pageImagePath,
      inputCaption: input.inputCaption,
      inputExactText: input.inputExactText,
      bbox: { ...input.inputBBox },
      equationCropSha256: input.inputEquationCropSha256,
    })),
    crops: new Map(),
  };
  if (
    !sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
      entry,
      evidence.pageImagePath,
      snapshotFingerprint,
    ) ||
    !sourceFormulaArtifactTopologyRecoveryEnvelopeStructurallyMatchesEvidence(envelope, receiptEvidence)
  ) return null;
  return envelope;
}

/** Strict old-slot form, used only before an actual V5 re-projection. */
function sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanEntryForEvidence(
  entry: SourceVisualScanEntry | undefined,
  snapshotFingerprint: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyRecoveryCacheEnvelope | null {
  const envelope = sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanEntryForPageEvidence(
    entry,
    snapshotFingerprint,
    evidence,
  );
  if (!envelope || evidence.inputs.length !== envelope.inputVisuals.length) return null;
  return evidence.inputs.every((input, index) => {
    const prior = envelope.inputVisuals[index];
    return Boolean(
      prior &&
      input.sourceVisualId === prior.sourceVisualId &&
      input.sourceId === prior.sourceId &&
      input.pageNumber === prior.pageNumber &&
      input.inputCaption === prior.inputCaption &&
      input.inputExactText === prior.inputExactText &&
      sameSourceVisualBBox(input.bbox, prior.inputBBox) &&
      input.equationCropSha256 === prior.inputEquationCropSha256,
    );
  }) ? envelope : null;
}

function sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanCacheForEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyRecoveryCacheEnvelope | null {
  const entry = loadSourceVisualScanCache(contentPath, gardenSlug)
    .sources[evidence.sourceId]?.[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!entry || !snapshotPath || !fs.existsSync(snapshotPath)) return null;
  return sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanEntryForEvidence(
    entry,
    sha256(fs.readFileSync(snapshotPath)),
    evidence,
  );
}

function sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanCacheForPageEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyRecoveryCacheEnvelope | null {
  const entry = loadSourceVisualScanCache(contentPath, gardenSlug)
    .sources[evidence.sourceId]?.[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!entry || !snapshotPath || !fs.existsSync(snapshotPath)) return null;
  return sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanEntryForPageEvidence(
    entry,
    sha256(fs.readFileSync(snapshotPath)),
    evidence,
  );
}

function sourceFormulaArtifactTopologyReviewFromScanEntryForEvidence(
  entry: SourceVisualScanEntry | undefined,
  snapshotFingerprint: string,
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
): SourceFormulaArtifactTopologyReviewEnvelope | null {
  const review = entry?.formulaArtifactTopologyReview;
  if (!review) return null;
  // The topology receipt remains valid when a later normal formula reviewer
  // changes model.  Its own signed model is part of the receipt key; current
  // model equality would incorrectly erase the recovery lineage after retry.
  return sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanEntryForPageEvidence(
    entry,
    snapshotFingerprint,
    evidence,
  )?.cacheKey === recovery.cacheKey &&
    sourceFormulaArtifactTopologyReviewEnvelopeMatches(review, evidence, recovery, review.model)
    ? review
    : null;
}

function sourceFormulaArtifactTopologyReviewFromScanCacheForEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
): SourceFormulaArtifactTopologyReviewEnvelope | null {
  const entry = loadSourceVisualScanCache(contentPath, gardenSlug)
    .sources[evidence.sourceId]?.[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!entry || !snapshotPath || !fs.existsSync(snapshotPath)) return null;
  return sourceFormulaArtifactTopologyReviewFromScanEntryForEvidence(
    entry,
    sha256(fs.readFileSync(snapshotPath)),
    evidence,
    recovery,
  );
}

/** Extraction has only the page PNG, so it checks this durable receipt shape
 * here and performs the full request/evidence revalidation in the formula
 * finalizer.  A confirmed-but-malformed receipt never becomes a projection. */
function sourceFormulaArtifactTopologyReviewScanEntryIsConfirmed(
  entry: SourceVisualScanEntry | undefined,
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  fingerprint: string,
): boolean {
  try {
    const review = entry?.formulaArtifactTopologyReview;
    if (
      !review ||
      review.status !== "confirmed" ||
      review.schemaVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_SCHEMA_VERSION ||
      review.promptVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_REVIEW_PROMPT_VERSION ||
      review.sourceId !== recovery.sourceId ||
      review.pageNumber !== recovery.pageNumber ||
      review.pageImageSha256 !== fingerprint ||
      review.canonicalPageTextSha256 !== recovery.canonicalPageTextSha256 ||
      review.sourcePdfSha256 !== recovery.sourcePdfSha256 ||
      review.recoveryCacheKey !== recovery.cacheKey ||
      review.recoveryCacheIntegritySha256 !== recovery.integritySha256 ||
      !Array.isArray(review.priorSlotResolutions) ||
      review.requestSha256 !== sha256(review.requestPayload) ||
      review.responseSha256 !== sha256(review.rawResponse)
    ) return false;
    const { integritySha256, ...unsigned } = review;
    if (integritySha256 !== sourceFormulaArtifactTopologyReviewEnvelopeIntegrity(unsigned)) return false;
    const parsed = sourceFormulaArtifactTopologyReviewResponse(review.rawResponse, recovery);
    return parsed.status === "confirmed" &&
      parsed.reason === review.reason &&
      JSON.stringify(parsed.priorSlotResolutions) === JSON.stringify(review.priorSlotResolutions);
  } catch {
    return false;
  }
}

/** Compact, stable page-level binding for V5 topology receipts. */
export function sourceFormulaTopologyReviewPageReceipts(
  contentPath: string,
  gardenSlug: string,
  selectedSourceIds: readonly string[] = [],
): SourceFormulaTopologyReviewPageReceipt[] {
  const selected = new Set(selectedSourceIds.map((sourceId) => sourceId.trim()).filter(Boolean));
  const summaries: SourceFormulaTopologyReviewPageReceipt[] = [];
  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  for (const [sourceId, sourcePages] of Object.entries(scanCache.sources)) {
    if (selected.size > 0 && !selected.has(sourceId)) continue;
    for (const entry of Object.values(sourcePages)) {
      const consensusRepair = entry?.formulaArtifactTopologyConsensusRepair;
      if (consensusRepair) {
        try {
          const snapshotPath = assetDiskPath(contentPath, gardenSlug, consensusRepair.pageImagePath);
          if (!snapshotPath || !fs.existsSync(snapshotPath)) continue;
          const pageImage = fs.readFileSync(snapshotPath);
          const pageImageSha256 = sha256(pageImage);
          const canonicalPageText = canonicalSourcePageMarkdown(
            contentPath,
            gardenSlug,
            consensusRepair.sourceId,
            consensusRepair.pageNumber,
          );
          if (!canonicalPageText) continue;
          const sourcePdf = sourcePdfEvidence(contentPath, gardenSlug, consensusRepair.sourceId);
          const evidence: SourceFormulaReviewPageEvidence = {
            sourceId: consensusRepair.sourceId,
            pageNumber: consensusRepair.pageNumber,
            pageImagePath: consensusRepair.pageImagePath,
            pageImage,
            pageImageSha256,
            canonicalPageText,
            canonicalPageTextSha256: sha256(canonicalPageText),
            sourcePdfPath: sourcePdf.sourcePdfPath,
            sourcePdfSha256: sourcePdf.sourcePdfSha256,
            inputs: [],
            crops: new Map(),
          };
          const strict = sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanEntryForPageEvidence(
            entry,
            pageImageSha256,
            evidence,
          );
          const finalEntry = strict ? sourceFormulaArtifactTopologyConsensusRepairFinalEntry(strict) : null;
          if (
            !strict ||
            !finalEntry ||
            !sourceFormulaArtifactTopologyConsensusRepairIsProjectionConfirmed(strict) ||
            !sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(
              entry,
              consensusRepair.pageImagePath,
              pageImageSha256,
            )
          ) continue;
          const activeFormulaIds = finalEntry.candidate.activeFormulaSlots
            .map((slot) => slot.sourceVisualId)
            .sort();
          if (new Set(activeFormulaIds).size !== activeFormulaIds.length) {
            throw new Error("Duplicate active formula id in V7 topology consensus receipt " + strict.sourceId + " p." + strict.pageNumber + ".");
          }
          summaries.push({
            recoveryProtocol: "v7",
            sourceId: strict.sourceId,
            pageNumber: strict.pageNumber,
            pageImagePath: strict.pageImagePath,
            recoveryCacheKey: strict.cacheKey,
            recoveryCacheIntegritySha256: strict.integritySha256,
            topologyReviewCacheKey: finalEntry.topologyReview!.cacheKey,
            topologyReviewCacheIntegritySha256: finalEntry.topologyReview!.integritySha256,
            activeFormulaIds,
          });
        } catch {
          // A malformed/stale V7 history is never silently represented as a
          // valid page receipt. The strict finalizer reports its absence.
        }
        continue;
      }
      const candidateRepair = entry?.formulaArtifactTopologyCandidateRepair;
      if (candidateRepair) {
        try {
          const snapshotPath = assetDiskPath(contentPath, gardenSlug, candidateRepair.pageImagePath);
          if (!snapshotPath || !fs.existsSync(snapshotPath)) continue;
          const pageImage = fs.readFileSync(snapshotPath);
          const pageImageSha256 = sha256(pageImage);
          const canonicalPageText = canonicalSourcePageMarkdown(
            contentPath,
            gardenSlug,
            candidateRepair.sourceId,
            candidateRepair.pageNumber,
          );
          if (!canonicalPageText) continue;
          const sourcePdf = sourcePdfEvidence(contentPath, gardenSlug, candidateRepair.sourceId);
          const evidence: SourceFormulaReviewPageEvidence = {
            sourceId: candidateRepair.sourceId,
            pageNumber: candidateRepair.pageNumber,
            pageImagePath: candidateRepair.pageImagePath,
            pageImage,
            pageImageSha256,
            canonicalPageText,
            canonicalPageTextSha256: sha256(canonicalPageText),
            sourcePdfPath: sourcePdf.sourcePdfPath,
            sourcePdfSha256: sourcePdf.sourcePdfSha256,
            inputs: [],
            crops: new Map(),
          };
          const strict = sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanEntryForPageEvidence(
            entry,
            pageImageSha256,
            evidence,
          );
          const finalEntry = strict ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(strict) : null;
          if (
            !strict ||
            !finalEntry ||
            !finalEntry.topologyReview ||
            finalEntry.topologyReview.status !== "confirmed" ||
            !sourceFormulaArtifactTopologyCandidateRepairScanEntryIsConfirmed(
              entry,
              candidateRepair.pageImagePath,
              pageImageSha256,
            )
          ) continue;
          const activeFormulaIds = finalEntry.candidate.activeFormulaSlots
            .map((slot) => slot.sourceVisualId)
            .sort();
          if (new Set(activeFormulaIds).size !== activeFormulaIds.length) {
            throw new Error("Duplicate active formula id in V6 topology review receipt " + strict.sourceId + " p." + strict.pageNumber + ".");
          }
          summaries.push({
            recoveryProtocol: "v6",
            sourceId: strict.sourceId,
            pageNumber: strict.pageNumber,
            pageImagePath: strict.pageImagePath,
            // The public page receipt binds the full durable C1/R1/C2/R2/C3/R3
            // container, not merely its terminal candidate.
            recoveryCacheKey: strict.cacheKey,
            recoveryCacheIntegritySha256: strict.integritySha256,
            topologyReviewCacheKey: finalEntry.topologyReview.cacheKey,
            topologyReviewCacheIntegritySha256: finalEntry.topologyReview.integritySha256,
            activeFormulaIds,
          });
        } catch {
          // A malformed/stale V6 entry is never silently represented as a
          // valid page receipt. Strict validation later reports its absence.
        }
        continue;
      }
      const recovery = entry?.formulaArtifactTopologyRecovery;
      if (
        !recovery ||
        entry.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION ||
        !sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
          contentPath,
          gardenSlug,
          recovery,
        ) ||
        !sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
          entry,
          recovery.pageImagePath,
          entry.fingerprint,
        ) ||
        !sourceFormulaArtifactTopologyReviewScanEntryIsConfirmed(entry, recovery, entry.fingerprint)
      ) continue;
      const review = entry.formulaArtifactTopologyReview!;
      const activeFormulaIds = recovery.activeFormulaSlots.map((slot) => slot.sourceVisualId).sort();
      if (new Set(activeFormulaIds).size !== activeFormulaIds.length) {
        throw new Error("Duplicate active formula id in V5 topology review receipt " + recovery.sourceId + " p." + recovery.pageNumber + ".");
      }
      summaries.push({
        recoveryProtocol: "v5",
        sourceId: recovery.sourceId,
        pageNumber: recovery.pageNumber,
        pageImagePath: recovery.pageImagePath,
        recoveryCacheKey: recovery.cacheKey,
        recoveryCacheIntegritySha256: recovery.integritySha256,
        topologyReviewCacheKey: review.cacheKey,
        topologyReviewCacheIntegritySha256: review.integritySha256,
        activeFormulaIds,
      });
    }
  }
  const sorted = summaries.sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) ||
    left.pageNumber - right.pageNumber ||
    left.pageImagePath.localeCompare(right.pageImagePath),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const prior = sorted[index - 1]!;
    const current = sorted[index]!;
    if (prior.sourceId === current.sourceId && prior.pageNumber === current.pageNumber) {
      throw new Error("Duplicate V5 topology review receipt page identity " + current.sourceId + " p." + current.pageNumber + ".");
    }
  }
  return sorted;
}

interface SourceFormulaArtifactRecoveryPreparedSnapshot {
  snapshotPath: string;
  evidence: SourceFormulaReviewPageEvidence;
  previous: Buffer | null;
  temporaryPath: string | null;
  committed: boolean;
}

function replaceSourceFormulaArtifactRecoveryFile(
  targetPath: string,
  temporaryPath: string,
): void {
  try {
    fs.renameSync(temporaryPath, targetPath);
  } catch {
    // Windows cannot always replace an existing path with rename. The temp
    // write still prevents a torn write; this fallback mirrors the other
    // durable writers in this module.
    fs.writeFileSync(targetPath, fs.readFileSync(temporaryPath));
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The target has committed; best-effort cleanup only.
    }
  }
}

function restoreSourceFormulaArtifactRecoverySnapshot(
  prepared: SourceFormulaArtifactRecoveryPreparedSnapshot,
): void {
  if (prepared.previous === null) {
    if (fs.existsSync(prepared.snapshotPath)) fs.unlinkSync(prepared.snapshotPath);
    return;
  }
  const rollbackPath = prepared.snapshotPath + "." + process.pid + "." + Date.now() + ".rollback.tmp";
  fs.writeFileSync(rollbackPath, prepared.previous);
  replaceSourceFormulaArtifactRecoveryFile(prepared.snapshotPath, rollbackPath);
  if (sha256(fs.readFileSync(prepared.snapshotPath)) !== sha256(prepared.previous)) {
    throw new Error("Formula-artifact recovery snapshot rollback did not restore the prior bytes.");
  }
}

function restoreSourceFormulaArtifactRecoveryCache(
  cachePath: string,
  previous: Buffer | null,
): void {
  if (previous === null) {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    return;
  }
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const rollbackPath = cachePath + "." + process.pid + "." + Date.now() + ".rollback.tmp";
  fs.writeFileSync(rollbackPath, previous);
  replaceSourceFormulaArtifactRecoveryFile(cachePath, rollbackPath);
  if (!fs.existsSync(cachePath) || !fs.readFileSync(cachePath).equals(previous)) {
    throw new Error("Formula-artifact recovery scan-cache rollback did not restore the prior bytes.");
  }
}

/**
 * Persist accepted high-detail recovery detections into the durable visual-scan
 * cache. That cache is deliberately retained across failed Learn workspace
 * rollback, so a fresh job rehydrates corrected page artifacts rather than
 * calling the low-detail detector over the same stale slots again.
 */
function persistSourceFormulaArtifactRecoveryScanCache(
  contentPath: string,
  gardenSlug: string,
  outcomes: readonly SourceFormulaArtifactRecoveryPageOutcome[],
): void {
  if (outcomes.length === 0) return;
  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  const preparedSnapshots: SourceFormulaArtifactRecoveryPreparedSnapshot[] = [];
  const seenSnapshotPaths = new Set<string>();
  try {
    // Stage every fresh 1600px render first. If any path cannot be prepared,
    // no canonical snapshot or v4 receipt has changed.
    for (const outcome of outcomes) {
      const snapshotPath = assetDiskPath(
        contentPath,
        gardenSlug,
        outcome.evidence.pageImagePath,
      );
      if (!snapshotPath || seenSnapshotPaths.has(snapshotPath)) {
        throw new Error("Formula-artifact recovery has an invalid or duplicate canonical page snapshot path.");
      }
      seenSnapshotPaths.add(snapshotPath);
      let previous: Buffer | null = null;
      if (fs.existsSync(snapshotPath)) previous = fs.readFileSync(snapshotPath);
      const alreadyFresh = previous !== null && sha256(previous) === outcome.evidence.pageImageSha256;
      let temporaryPath: string | null = null;
      if (!alreadyFresh) {
        fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
        temporaryPath = snapshotPath + "." + process.pid + "." + Date.now() + ".recovery.tmp";
        fs.writeFileSync(temporaryPath, outcome.evidence.pageImage);
      }
      preparedSnapshots.push({
        snapshotPath,
        evidence: outcome.evidence,
        previous,
        temporaryPath,
        committed: false,
      });
    }
  } catch (error) {
    for (const prepared of preparedSnapshots) {
      if (!prepared.temporaryPath) continue;
      try {
        fs.unlinkSync(prepared.temporaryPath);
      } catch {
        // Preserve the staging error; no target path was committed.
      }
    }
    throw error;
  }

  for (const outcome of outcomes) {
    const pageUrl = outcome.evidence.pageImagePath;
    const sourceCache = scanCache.sources[outcome.evidence.sourceId] ?? {};
    scanCache.sources[outcome.evidence.sourceId] = sourceCache;
    sourceCache[pageUrl] = {
      detectorVersion: SOURCE_FORMULA_ARTIFACT_RECOVERY_DETECTOR_VERSION,
      fingerprint: outcome.evidence.pageImageSha256,
      detections: outcome.envelope.detections,
      formulaArtifactRecovery: outcome.envelope,
    };
  }
  const cachePath = sourceVisualScanCachePath(contentPath, gardenSlug);
  const previousCache = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
  try {
    // Publish the exact page bytes first, then the receipt that names them.
    // If either phase fails, restore every earlier target byte-for-byte so an
    // incomplete recovery cannot leave a dangling cap or erase a prior receipt.
    for (const prepared of preparedSnapshots) {
      if (!prepared.temporaryPath) continue;
      replaceSourceFormulaArtifactRecoveryFile(prepared.snapshotPath, prepared.temporaryPath);
      prepared.temporaryPath = null;
      prepared.committed = true;
      if (sha256(fs.readFileSync(prepared.snapshotPath)) !== prepared.evidence.pageImageSha256) {
        throw new Error("Formula-artifact recovery snapshot replacement did not retain the fresh PDF render.");
      }
    }
    saveSourceVisualScanCache(contentPath, gardenSlug, scanCache);
  } catch (error) {
    const rollbackErrors: string[] = [];
    try {
      restoreSourceFormulaArtifactRecoveryCache(cachePath, previousCache);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    for (const prepared of [...preparedSnapshots].reverse()) {
      try {
        if (prepared.committed) restoreSourceFormulaArtifactRecoverySnapshot(prepared);
        if (prepared.temporaryPath) fs.unlinkSync(prepared.temporaryPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        "Formula-artifact recovery persistence failed and rollback was incomplete: " +
          rollbackErrors.join("; "),
      );
    }
    throw error;
  }
}

/** Publish V5 receipt(s) with the same all-snapshots-or-no-cache transaction as V4. */
function persistSourceFormulaArtifactTopologyRecoveryScanCache(
  contentPath: string,
  gardenSlug: string,
  outcomes: readonly SourceFormulaArtifactTopologyRecoveryPageOutcome[],
): void {
  if (outcomes.length === 0) return;
  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  const preparedSnapshots: SourceFormulaArtifactRecoveryPreparedSnapshot[] = [];
  const seenSnapshotPaths = new Set<string>();
  try {
    for (const outcome of outcomes) {
      const snapshotPath = assetDiskPath(contentPath, gardenSlug, outcome.evidence.pageImagePath);
      if (!snapshotPath || seenSnapshotPaths.has(snapshotPath)) {
        throw new Error("Formula-artifact topology recovery has an invalid or duplicate canonical page snapshot path.");
      }
      seenSnapshotPaths.add(snapshotPath);
      const previous = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath) : null;
      const alreadyFresh = previous !== null && sha256(previous) === outcome.evidence.pageImageSha256;
      let temporaryPath: string | null = null;
      if (!alreadyFresh) {
        fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
        temporaryPath = snapshotPath + "." + process.pid + "." + Date.now() + ".topology-recovery.tmp";
        fs.writeFileSync(temporaryPath, outcome.evidence.pageImage);
      }
      preparedSnapshots.push({ snapshotPath, evidence: outcome.evidence, previous, temporaryPath, committed: false });
    }
  } catch (error) {
    for (const prepared of preparedSnapshots) {
      if (!prepared.temporaryPath) continue;
      try { fs.unlinkSync(prepared.temporaryPath); } catch { /* preserve staging error */ }
    }
    throw error;
  }
  for (const outcome of outcomes) {
    const sourceCache = scanCache.sources[outcome.evidence.sourceId] ?? {};
    scanCache.sources[outcome.evidence.sourceId] = sourceCache;
    sourceCache[outcome.evidence.pageImagePath] = {
      detectorVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION,
      fingerprint: outcome.evidence.pageImageSha256,
      detections: outcome.envelope.detections,
      formulaArtifactTopologyRecovery: outcome.envelope,
    };
  }
  const cachePath = sourceVisualScanCachePath(contentPath, gardenSlug);
  const previousCache = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
  try {
    for (const prepared of preparedSnapshots) {
      if (!prepared.temporaryPath) continue;
      replaceSourceFormulaArtifactRecoveryFile(prepared.snapshotPath, prepared.temporaryPath);
      prepared.temporaryPath = null;
      prepared.committed = true;
      if (sha256(fs.readFileSync(prepared.snapshotPath)) !== prepared.evidence.pageImageSha256) {
        throw new Error("Formula-artifact topology recovery snapshot replacement did not retain the fresh PDF render.");
      }
    }
    saveSourceVisualScanCache(contentPath, gardenSlug, scanCache);
  } catch (error) {
    const rollbackErrors: string[] = [];
    try { restoreSourceFormulaArtifactRecoveryCache(cachePath, previousCache); } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    for (const prepared of [...preparedSnapshots].reverse()) {
      try {
        if (prepared.committed) restoreSourceFormulaArtifactRecoverySnapshot(prepared);
        if (prepared.temporaryPath) fs.unlinkSync(prepared.temporaryPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error("Formula-artifact topology recovery persistence failed and rollback was incomplete: " + rollbackErrors.join("; "));
    }
    throw error;
  }
}

function persistSourceFormulaArtifactTopologyReview(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  review: SourceFormulaArtifactTopologyReviewEnvelope,
): void {
  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  const sourceCache = scanCache.sources[evidence.sourceId] ?? {};
  const entry = sourceCache[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (
    !entry ||
    !snapshotPath ||
    !fs.existsSync(snapshotPath) ||
    sha256(fs.readFileSync(snapshotPath)) !== evidence.pageImageSha256 ||
    entry.formulaArtifactTopologyRecovery?.cacheKey !== recovery.cacheKey ||
    entry.formulaArtifactTopologyRecovery?.integritySha256 !== recovery.integritySha256
  ) {
    throw new Error("Formula-artifact topology review cannot bind a missing or changed V5 recovery receipt.");
  }
  sourceCache[evidence.pageImagePath] = { ...entry, formulaArtifactTopologyReview: review };
  scanCache.sources[evidence.sourceId] = sourceCache;
  saveSourceVisualScanCache(contentPath, gardenSlug, scanCache);
}

/**
 * Publish one complete V6 history state atomically with its exact high-detail
 * page render. The cache always points at the *latest* model-authored
 * candidate, while the signed container retains rejected predecessors. Thus a
 * rollback can rehydrate only a confirmed terminal candidate and cannot erase
 * the evidence-level cap with a generic V3 scan.
 */
function persistSourceFormulaArtifactTopologyCandidateRepair(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope,
): void {
  const finalEntry = sourceFormulaArtifactTopologyCandidateRepairFinalEntry(envelope);
  if (!finalEntry || !sourceFormulaArtifactTopologyCandidateRepairEnvelopeMatches(envelope, evidence)) {
    throw new Error("Formula-artifact topology candidate repair cannot persist an invalid history receipt.");
  }
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!snapshotPath) {
    throw new Error("Formula-artifact topology candidate repair has an invalid canonical page snapshot path.");
  }
  const previousSnapshot = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath) : null;
  const alreadyFresh = previousSnapshot !== null && sha256(previousSnapshot) === evidence.pageImageSha256;
  let temporaryPath: string | null = null;
  try {
    if (!alreadyFresh) {
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      temporaryPath = snapshotPath + "." + process.pid + "." + Date.now() + ".topology-candidate-repair.tmp";
      fs.writeFileSync(temporaryPath, evidence.pageImage);
    }
  } catch (error) {
    if (temporaryPath) {
      try { fs.unlinkSync(temporaryPath); } catch { /* preserve staging failure */ }
    }
    throw error;
  }
  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  const sourceCache = scanCache.sources[evidence.sourceId] ?? {};
  scanCache.sources[evidence.sourceId] = sourceCache;
  sourceCache[evidence.pageImagePath] = {
    detectorVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION,
    fingerprint: evidence.pageImageSha256,
    detections: finalEntry.candidate.detections,
    formulaArtifactTopologyCandidateRepair: envelope,
  };
  const cachePath = sourceVisualScanCachePath(contentPath, gardenSlug);
  const previousCache = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
  let committedSnapshot = false;
  try {
    if (temporaryPath) {
      replaceSourceFormulaArtifactRecoveryFile(snapshotPath, temporaryPath);
      temporaryPath = null;
      committedSnapshot = true;
      if (sha256(fs.readFileSync(snapshotPath)) !== evidence.pageImageSha256) {
        throw new Error("Formula-artifact topology candidate repair snapshot replacement did not retain the fresh PDF render.");
      }
    }
    saveSourceVisualScanCache(contentPath, gardenSlug, scanCache);
  } catch (error) {
    const rollbackErrors: string[] = [];
    try {
      restoreSourceFormulaArtifactRecoveryCache(cachePath, previousCache);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    try {
      if (committedSnapshot) {
        restoreSourceFormulaArtifactRecoverySnapshot({
          snapshotPath,
          evidence,
          previous: previousSnapshot,
          temporaryPath: null,
          committed: true,
        });
      }
      if (temporaryPath) fs.unlinkSync(temporaryPath);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        "Formula-artifact topology candidate repair persistence failed and rollback was incomplete: " +
          rollbackErrors.join("; "),
      );
    }
    throw error;
  }
}

/**
 * Persist every V7 state before the next remote operation.  A pending root
 * deliberately keeps its confirmed base inventory in the scan entry while
 * the signed V7 container prevents generic V3 redetection from erasing the
 * authorization/cap.  Only a terminal confirmed C[n]/R[n] is ever projected
 * into the ledger by callers.
 */
function persistSourceFormulaArtifactTopologyConsensusRepair(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
): void {
  if (!sourceFormulaArtifactTopologyConsensusRepairEnvelopeMatches(envelope, evidence)) {
    throw new Error("Formula-artifact topology consensus repair cannot persist an invalid history receipt.");
  }
  const finalEntry = sourceFormulaArtifactTopologyConsensusRepairFinalEntry(envelope);
  const candidate = finalEntry?.candidate ?? sourceFormulaArtifactTopologyConsensusBaseCandidate(envelope.base);
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!snapshotPath) {
    throw new Error("Formula-artifact topology consensus repair has an invalid canonical page snapshot path.");
  }
  const previousSnapshot = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath) : null;
  const alreadyFresh = previousSnapshot !== null && sha256(previousSnapshot) === evidence.pageImageSha256;
  let temporaryPath: string | null = null;
  try {
    if (!alreadyFresh) {
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      temporaryPath = snapshotPath + "." + process.pid + "." + Date.now() + ".topology-consensus-repair.tmp";
      fs.writeFileSync(temporaryPath, evidence.pageImage);
    }
  } catch (error) {
    if (temporaryPath) {
      try { fs.unlinkSync(temporaryPath); } catch { /* preserve staging failure */ }
    }
    throw error;
  }
  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  const sourceCache = scanCache.sources[evidence.sourceId] ?? {};
  scanCache.sources[evidence.sourceId] = sourceCache;
  sourceCache[evidence.pageImagePath] = {
    detectorVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION,
    fingerprint: evidence.pageImageSha256,
    detections: candidate.detections,
    formulaArtifactTopologyConsensusRepair: envelope,
  };
  const cachePath = sourceVisualScanCachePath(contentPath, gardenSlug);
  const previousCache = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
  let committedSnapshot = false;
  try {
    if (temporaryPath) {
      replaceSourceFormulaArtifactRecoveryFile(snapshotPath, temporaryPath);
      temporaryPath = null;
      committedSnapshot = true;
      if (sha256(fs.readFileSync(snapshotPath)) !== evidence.pageImageSha256) {
        throw new Error("Formula-artifact topology consensus repair snapshot replacement did not retain the fresh PDF render.");
      }
    }
    saveSourceVisualScanCache(contentPath, gardenSlug, scanCache);
  } catch (error) {
    const rollbackErrors: string[] = [];
    try {
      restoreSourceFormulaArtifactRecoveryCache(cachePath, previousCache);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    try {
      if (committedSnapshot) {
        restoreSourceFormulaArtifactRecoverySnapshot({
          snapshotPath,
          evidence,
          previous: previousSnapshot,
          temporaryPath: null,
          committed: true,
        });
      }
      if (temporaryPath) fs.unlinkSync(temporaryPath);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        "Formula-artifact topology consensus repair persistence failed and rollback was incomplete: " +
          rollbackErrors.join("; "),
      );
    }
    throw error;
  }
}

function sourceFormulaArtifactRecoveryWasAttempted(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  // The recovery cap is evidence-level, not model-level. Changing the
  // configured reviewer model after a rejected re-review must not create an
  // unbounded sequence of whole-page re-detections over the same PDF/render
  // evidence. Model equality remains mandatory when reusing a receipt as
  // accepted formula-review lineage below.
  return sourceFormulaArtifactRecoveryEnvelopeFromScanCacheForEvidence(
    contentPath,
    gardenSlug,
    evidence,
  ) !== null;
}

function sourceFormulaArtifactRecoveryEnvelopeFromScanEntryForEvidence(
  entry: SourceVisualScanEntry | undefined,
  snapshotFingerprint: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactRecoveryCacheEnvelope | null {
  const envelope = entry?.formulaArtifactRecovery;
  if (
    !entry ||
    !envelope ||
    !sourceFormulaArtifactRecoveryScanEntryMatches(
      entry,
      evidence.pageImagePath,
      snapshotFingerprint,
    ) ||
    !sourceFormulaArtifactRecoveryEnvelopeStructurallyMatchesEvidence(envelope, evidence)
  ) return null;
  return envelope;
}

/**
 * Validate a V4 recovery against fresh page/PDF/Markdown evidence without
 * requiring the current ledger transcription to still equal the pre-recovery
 * stale slots.  A later independent formula reviewer may legitimately replace
 * the visible text or caption; that accepted output is not authority to erase
 * the signed recovery candidate.  The receipt's own old inputs remain the
 * only inputs used to reconstruct and validate the recovery request.
 */
function sourceFormulaArtifactRecoveryEnvelopeFromScanEntryForPageEvidence(
  entry: SourceVisualScanEntry | undefined,
  snapshotFingerprint: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactRecoveryCacheEnvelope | null {
  const envelope = entry?.formulaArtifactRecovery;
  if (!entry || !envelope) return null;
  const receiptEvidence: SourceFormulaReviewPageEvidence = {
    ...evidence,
    inputs: envelope.inputVisuals.map((input) => ({
      sourceVisualId: input.sourceVisualId,
      sourceId: input.sourceId,
      pageNumber: input.pageNumber,
      pageImagePath: evidence.pageImagePath,
      inputCaption: input.inputCaption,
      inputExactText: input.inputExactText,
      bbox: { ...input.inputBBox },
      equationCropSha256: input.inputEquationCropSha256,
    })),
    crops: new Map(),
  };
  if (
    !sourceFormulaArtifactRecoveryScanEntryMatches(
      entry,
      evidence.pageImagePath,
      snapshotFingerprint,
    ) ||
    !sourceFormulaArtifactRecoveryEnvelopeStructurallyMatchesEvidence(
      envelope,
      receiptEvidence,
    )
  ) return null;
  return envelope;
}

function sourceFormulaArtifactRecoveryEnvelopeFromScanCacheForEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactRecoveryCacheEnvelope | null {
  const entry = loadSourceVisualScanCache(contentPath, gardenSlug)
    .sources[evidence.sourceId]?.[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!entry || !snapshotPath || !fs.existsSync(snapshotPath)) return null;
  return sourceFormulaArtifactRecoveryEnvelopeFromScanEntryForEvidence(
    entry,
    sha256(fs.readFileSync(snapshotPath)),
    evidence,
  );
}

function sourceFormulaArtifactRecoveryEnvelopeFromScanCacheForPageEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactRecoveryCacheEnvelope | null {
  const entry = loadSourceVisualScanCache(contentPath, gardenSlug)
    .sources[evidence.sourceId]?.[evidence.pageImagePath];
  const snapshotPath = assetDiskPath(contentPath, gardenSlug, evidence.pageImagePath);
  if (!entry || !snapshotPath || !fs.existsSync(snapshotPath)) return null;
  return sourceFormulaArtifactRecoveryEnvelopeFromScanEntryForPageEvidence(
    entry,
    sha256(fs.readFileSync(snapshotPath)),
    evidence,
  );
}

function sourceFormulaArtifactRecoveryLineageForEvidence(
  contentPath: string,
  gardenSlug: string,
  pages: readonly SourceFormulaReviewPageEvidence[],
): Map<string, {
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope;
  input: SourceFormulaArtifactRecoveryInput;
  replacement: SourceFormulaArtifactRecoveryReplacement;
}> {
  const lineage = new Map<string, {
    envelope: SourceFormulaArtifactRecoveryCacheEnvelope;
    input: SourceFormulaArtifactRecoveryInput;
    replacement: SourceFormulaArtifactRecoveryReplacement;
  }>();
  for (const evidence of pages) {
    // Recovery lineage binds the recovered page evidence itself, not the
    // currently configured formula reviewer. A later review can deliberately
    // use a different model while retaining the original recovery model in
    // its nested provenance.
    const envelope = sourceFormulaArtifactRecoveryEnvelopeFromScanCacheForEvidence(
      contentPath,
      gardenSlug,
      evidence,
    );
    if (!envelope) continue;
    for (let index = 0; index < envelope.replacements.length; index += 1) {
      const replacement = envelope.replacements[index];
      const recoveryInput = envelope.inputVisuals[index];
      const current = evidence.inputs[index];
      if (
        !replacement ||
        !recoveryInput ||
        !current ||
        replacement.sourceVisualId !== recoveryInput.sourceVisualId ||
        current.sourceVisualId !== replacement.sourceVisualId ||
        current.inputCaption !== replacement.caption ||
        current.inputExactText !== replacement.exactText ||
        !sameSourceVisualBBox(current.bbox, replacement.bbox) ||
        current.equationCropSha256 !== replacement.equationCropSha256
      ) {
        // The v4 receipt is valid but has not been faithfully projected into
        // this ledger. Do not attach stale lineage; any resulting reviewer
        // rejection is blocked from starting another recovery loop.
        continue;
      }
      lineage.set(replacement.sourceVisualId, {
        envelope,
        input: recoveryInput,
        replacement,
      });
    }
  }
  return lineage;
}

function sourceFormulaArtifactRecoveryExpectedPageSlots(
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope,
): Array<{
  sourceVisualId: string;
  detection: SourceVisualDetection;
  replacement?: SourceFormulaArtifactRecoveryReplacement;
}> {
  const sourceIndex = sourceIndexFromVisualId(envelope.inputVisuals[0]?.sourceVisualId ?? "");
  if (sourceIndex === null) return [];
  const counters = new Map<string, number>();
  let formulaIndex = 0;
  const slots: Array<{
    sourceVisualId: string;
    detection: SourceVisualDetection;
    replacement?: SourceFormulaArtifactRecoveryReplacement;
  }> = [];
  for (const detection of envelope.detections) {
    const letter = TYPE_LETTER[detection.type];
    const ordinal = (counters.get(letter) ?? 0) + 1;
    counters.set(letter, ordinal);
    let sourceVisualId = "S" + sourceIndex + ".P" + envelope.pageNumber + "." + letter + ordinal;
    let replacement: SourceFormulaArtifactRecoveryReplacement | undefined;
    if (detection.type === "equation") {
      replacement = envelope.replacements[formulaIndex];
      if (!replacement) return [];
      sourceVisualId = replacement.sourceVisualId;
      formulaIndex += 1;
    }
    slots.push({ sourceVisualId, detection, ...(replacement ? { replacement } : {}) });
  }
  return formulaIndex === envelope.replacements.length ? slots : [];
}

function sourceFormulaArtifactRecoveryPageIsFaithfullyProjected(
  contentPath: string,
  gardenSlug: string,
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  snapshotFingerprint: string,
  pageImage: Buffer,
  visuals: readonly SourceVisual[],
): boolean {
  const envelope = entry?.formulaArtifactRecovery;
  if (
    !entry ||
    !envelope ||
    !sourceFormulaArtifactRecoveryScanEntryMatches(entry, pageUrl, snapshotFingerprint)
  ) return false;
  const expected = sourceFormulaArtifactRecoveryExpectedPageSlots(envelope);
  if (expected.length === 0 || expected.length !== visuals.length) return false;
  const byId = new Map(visuals.map((visual) => [visual.sourceVisualId, visual]));
  if (byId.size !== visuals.length) return false;
  return expected.every((slot) => {
    const visual = byId.get(slot.sourceVisualId);
    if (
      !visual ||
      visual.type !== slot.detection.type ||
      visual.pageImagePath !== envelope.pageImagePath ||
      !visual.bbox ||
      !slot.detection.bbox ||
      !sameSourceVisualBBox(visual.bbox, slot.detection.bbox)
    ) return false;
    const cropPath = visual.croppedImagePath
      ? assetDiskPath(contentPath, gardenSlug, visual.croppedImagePath)
      : null;
    if (!cropPath || !fs.existsSync(cropPath)) return false;
    try {
      const expectedCrop = slot.detection.bbox
        ? cropPng(pageImage, expandedCropBBox(slot.detection.bbox, slot.detection.type))
        : null;
      if (!expectedCrop?.length || sha256(fs.readFileSync(cropPath)) !== sha256(expectedCrop)) return false;
    } catch {
      return false;
    }
    if (!slot.replacement) return visual.caption === slot.detection.caption;
    const recovery = visual.formulaReview?.artifactRecovery;
    return Boolean(
      recovery &&
      recovery.cacheKey === envelope.cacheKey &&
      recovery.cacheIntegritySha256 === envelope.integritySha256 &&
      visual.formulaReview?.inputExactText === slot.replacement.exactText &&
      visual.formulaReview?.inputCaption === slot.replacement.caption,
    );
  });
}

function rebindSourceFormulaPageEvidenceAfterArtifactRecovery(
  evidence: SourceFormulaReviewPageEvidence,
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope,
): SourceFormulaReviewPageEvidence {
  const replacementById = new Map(
    envelope.replacements.map((replacement) => [replacement.sourceVisualId, replacement]),
  );
  if (
    replacementById.size !== evidence.inputs.length ||
    envelope.inputVisuals.length !== evidence.inputs.length
  ) {
    throw new Error("Formula-artifact recovery page replacement cardinality is inconsistent.");
  }
  const crops = new Map<string, Buffer>();
  const inputs = evidence.inputs.map((prior) => {
    const replacement = replacementById.get(prior.sourceVisualId);
    if (!replacement) {
      throw new Error("Formula-artifact recovery is missing page slot " + prior.sourceVisualId + ".");
    }
    const crop = cropPng(evidence.pageImage, expandedCropBBox(replacement.bbox, "equation"));
    if (!crop?.length || sha256(crop) !== replacement.equationCropSha256) {
      throw new Error(
        "Formula-artifact recovery crop evidence is invalid for " + prior.sourceVisualId + ".",
      );
    }
    crops.set(prior.sourceVisualId, crop);
    return {
      ...prior,
      inputCaption: replacement.caption,
      inputExactText: replacement.exactText,
      bbox: { ...replacement.bbox },
      equationCropSha256: replacement.equationCropSha256,
    };
  });
  return { ...evidence, inputs, crops };
}

/**
 * A later ordinary review is allowed to replace the visible transcription of
 * a confirmed V4 recovery.  Before another ordinary review/cache lookup, bind
 * that page back to the immutable model-authored recovery candidate.  This is
 * evidence reconstruction only: the live PNG, Markdown, preserved PDF, exact
 * current formula-id inventory, and every regenerated crop must still match
 * the signed receipt.
 */
function rebindSourceFormulaPageEvidenceFromConfirmedArtifactRecovery(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaReviewPageEvidence | null {
  const envelope = sourceFormulaArtifactRecoveryEnvelopeFromScanCacheForPageEvidence(
    contentPath,
    gardenSlug,
    evidence,
  );
  if (!envelope) return null;
  const recoveryIds = envelope.replacements.map((replacement) => replacement.sourceVisualId).sort();
  const currentIds = evidence.inputs.map((input) => input.sourceVisualId).sort();
  if (
    new Set(recoveryIds).size !== recoveryIds.length ||
    JSON.stringify(recoveryIds) !== JSON.stringify(currentIds)
  ) return null;
  return rebindSourceFormulaPageEvidenceAfterArtifactRecovery(evidence, envelope);
}

function sourceFormulaArtifactTopologyActiveSlotsMatchEvidence(
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  if (recovery.activeFormulaSlots.length !== evidence.inputs.length) return false;
  const currentById = new Map(evidence.inputs.map((input) => [input.sourceVisualId, input]));
  if (currentById.size !== evidence.inputs.length) return false;
  return recovery.activeFormulaSlots.every((slot) => {
    const input = currentById.get(slot.sourceVisualId);
    return Boolean(
      input &&
      input.inputCaption === slot.caption &&
      input.inputExactText === slot.exactText &&
      sameSourceVisualBBox(input.bbox, slot.bbox) &&
      input.equationCropSha256 === slot.equationCropSha256,
    );
  });
}

function sourceFormulaArtifactTopologyRecoveryLineageForEvidence(
  contentPath: string,
  gardenSlug: string,
  pages: readonly SourceFormulaReviewPageEvidence[],
): Map<string, {
  envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
  slot: SourceFormulaArtifactTopologyActiveSlot;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
}> {
  const lineage = new Map<string, {
    envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>();
  for (const evidence of pages) {
    const recovery = sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanCacheForPageEvidence(
      contentPath,
      gardenSlug,
      evidence,
    );
    if (!recovery || !sourceFormulaArtifactTopologyActiveSlotsMatchEvidence(recovery, evidence)) continue;
    const review = sourceFormulaArtifactTopologyReviewFromScanCacheForEvidence(
      contentPath,
      gardenSlug,
      evidence,
      recovery,
    );
    if (!review || review.status !== "confirmed") continue;
    for (const slot of recovery.activeFormulaSlots) {
      if (lineage.has(slot.sourceVisualId)) {
        throw new Error("Formula-artifact topology recovery duplicated active source slot " + slot.sourceVisualId + ".");
      }
      lineage.set(slot.sourceVisualId, { envelope: recovery, slot, topologyReview: review });
    }
  }
  return lineage;
}

/**
 * Rebuild a normal formula-review page request from the exact high-detail
 * V5 receipt.  This is mechanical evidence binding only: formula semantics,
 * ids, boxes, and old-slot graph all came from the model-authored receipt.
 */
function rebindSourceFormulaPageEvidenceAfterArtifactTopologyRecovery(
  evidence: SourceFormulaReviewPageEvidence,
  envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
): SourceFormulaReviewPageEvidence {
  const crops = new Map<string, Buffer>();
  const inputs = envelope.activeFormulaSlots
    .slice()
    .sort((left, right) => sourceFormulaSlotOrder(left.sourceVisualId) - sourceFormulaSlotOrder(right.sourceVisualId) ||
      left.sourceVisualId.localeCompare(right.sourceVisualId))
    .map((slot): SourceFormulaReviewInput => {
      const crop = cropPng(evidence.pageImage, expandedCropBBox(slot.bbox, "equation"));
      if (!crop?.length || sha256(crop) !== slot.equationCropSha256) {
        throw new Error(
          "Formula-artifact topology recovery crop evidence is invalid for " + slot.sourceVisualId + ".",
        );
      }
      crops.set(slot.sourceVisualId, crop);
      return {
        sourceVisualId: slot.sourceVisualId,
        sourceId: evidence.sourceId,
        pageNumber: evidence.pageNumber,
        pageImagePath: evidence.pageImagePath,
        inputCaption: slot.caption,
        inputExactText: slot.exactText,
        bbox: { ...slot.bbox },
        equationCropSha256: slot.equationCropSha256,
      };
    });
  return { ...evidence, inputs, crops };
}

function sourceFormulaArtifactTopologyRecoveryExpectedPageSlots(
  envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
): Array<{
  sourceVisualId: string;
  detection: SourceVisualDetection;
  activeSlot?: SourceFormulaArtifactTopologyActiveSlot;
}> {
  const sourceIndex = sourceIndexFromVisualId(envelope.inputVisuals[0]?.sourceVisualId ?? "");
  if (sourceIndex === null) return [];
  const counters = new Map<string, number>();
  let formulaIndex = 0;
  const slots: Array<{
    sourceVisualId: string;
    detection: SourceVisualDetection;
    activeSlot?: SourceFormulaArtifactTopologyActiveSlot;
  }> = [];
  for (const detection of envelope.detections) {
    const letter = TYPE_LETTER[detection.type];
    const ordinal = (counters.get(letter) ?? 0) + 1;
    counters.set(letter, ordinal);
    let sourceVisualId = "S" + sourceIndex + ".P" + envelope.pageNumber + "." + letter + ordinal;
    let activeSlot: SourceFormulaArtifactTopologyActiveSlot | undefined;
    if (detection.type === "equation") {
      activeSlot = envelope.activeFormulaSlots[formulaIndex];
      if (!activeSlot) return [];
      sourceVisualId = activeSlot.sourceVisualId;
      formulaIndex += 1;
    }
    slots.push({ sourceVisualId, detection, ...(activeSlot ? { activeSlot } : {}) });
  }
  return formulaIndex === envelope.activeFormulaSlots.length ? slots : [];
}

function sourceFormulaArtifactTopologyRecoveryPageIsFaithfullyProjected(
  contentPath: string,
  gardenSlug: string,
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  snapshotFingerprint: string,
  pageImage: Buffer,
  visuals: readonly SourceVisual[],
): boolean {
  const recovery = entry?.formulaArtifactTopologyRecovery;
  if (
    !entry ||
    !recovery ||
    !sourceFormulaArtifactTopologyRecoveryScanEntryMatches(entry, pageUrl, snapshotFingerprint) ||
    !sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
      contentPath,
      gardenSlug,
      recovery,
      snapshotFingerprint,
    )
  ) return false;
  // Rehydrate only a topology that an independent reviewer actually
  // confirmed against the same live PNG, canonical Markdown, and source PDF.
  // The finalizer repeats the full request/evidence validation before trusting
  // the projected lineage.
  if (!sourceFormulaArtifactTopologyReviewScanEntryIsConfirmed(entry, recovery, snapshotFingerprint)) {
    return false;
  }
  const expected = sourceFormulaArtifactTopologyRecoveryExpectedPageSlots(recovery);
  if (expected.length !== visuals.length) return false;
  const byId = new Map(visuals.map((visual) => [visual.sourceVisualId, visual]));
  if (byId.size !== visuals.length) return false;
  return expected.every((slot) => {
    const visual = byId.get(slot.sourceVisualId);
    if (
      !visual ||
      visual.type !== slot.detection.type ||
      visual.pageImagePath !== recovery.pageImagePath ||
      !visual.bbox ||
      !slot.detection.bbox ||
      !sameSourceVisualBBox(visual.bbox, slot.detection.bbox)
    ) return false;
    const cropPath = visual.croppedImagePath
      ? assetDiskPath(contentPath, gardenSlug, visual.croppedImagePath)
      : null;
    if (!cropPath || !fs.existsSync(cropPath)) return false;
    const crop = cropPng(pageImage, expandedCropBBox(slot.detection.bbox, slot.detection.type));
    if (!crop?.length || sha256(fs.readFileSync(cropPath)) !== sha256(crop)) return false;
    if (!slot.activeSlot) return visual.caption === slot.detection.caption;
    const provenance = visual.formulaReview?.artifactTopologyRecovery;
    return Boolean(
      provenance &&
      provenance.cacheKey === recovery.cacheKey &&
      provenance.cacheIntegritySha256 === recovery.integritySha256 &&
      provenance.sourceVisualId === slot.sourceVisualId &&
      visual.formulaReview?.inputExactText === slot.activeSlot.exactText &&
      visual.formulaReview?.inputCaption === slot.activeSlot.caption,
    );
  });
}

/** Rebuild full current evidence and validate the complete V6 history. This
 * is deliberately separate from the cheap scan-cache shape check: extraction
 * may replay only the returned terminal candidate, never an unauthenticated
 * raw cache payload. */
function sourceFormulaArtifactTopologyCandidateRepairLiveEnvelope(
  contentPath: string,
  gardenSlug: string,
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  snapshotFingerprint: string,
  pageImage: Buffer,
): SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope | null {
  const envelope = entry?.formulaArtifactTopologyCandidateRepair;
  if (
    !entry ||
    !envelope ||
    !sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(entry, pageUrl, snapshotFingerprint) ||
    !sourceFormulaArtifactTopologyCandidateRepairHasCurrentEvidence(
      contentPath,
      gardenSlug,
      envelope,
      snapshotFingerprint,
    )
  ) return null;
  try {
    const canonicalPageText = canonicalSourcePageMarkdown(
      contentPath,
      gardenSlug,
      envelope.sourceId,
      envelope.pageNumber,
    );
    if (!canonicalPageText) return null;
    const sourcePdf = sourcePdfEvidence(contentPath, gardenSlug, envelope.sourceId);
    const evidence: SourceFormulaReviewPageEvidence = {
      sourceId: envelope.sourceId,
      pageNumber: envelope.pageNumber,
      pageImagePath: envelope.pageImagePath,
      pageImage,
      pageImageSha256: snapshotFingerprint,
      canonicalPageText,
      canonicalPageTextSha256: sha256(canonicalPageText),
      sourcePdfPath: sourcePdf.sourcePdfPath,
      sourcePdfSha256: sourcePdf.sourcePdfSha256,
      inputs: [],
      crops: new Map(),
    };
    return sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanEntryForPageEvidence(
      entry,
      snapshotFingerprint,
      evidence,
    );
  } catch {
    return null;
  }
}

/** Strict V6 rehydration guard. Unlike the cheap cache check, this rebuilds
 * live page/text/PDF evidence and validates the whole C1/R1/C2/R2/C3/R3
 * container before any persisted candidate can replace ledger rows. */
function sourceFormulaArtifactTopologyCandidateRepairPageIsFaithfullyProjected(
  contentPath: string,
  gardenSlug: string,
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  snapshotFingerprint: string,
  pageImage: Buffer,
  visuals: readonly SourceVisual[],
): boolean {
  const strict = sourceFormulaArtifactTopologyCandidateRepairLiveEnvelope(
    contentPath,
    gardenSlug,
    entry,
    pageUrl,
    snapshotFingerprint,
    pageImage,
  );
  try {
    const finalEntry = strict ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(strict) : null;
    if (
      !strict ||
      !finalEntry ||
      !finalEntry.topologyReview ||
      finalEntry.topologyReview.status !== "confirmed" ||
      !sourceFormulaArtifactTopologyCandidateRepairScanEntryIsConfirmed(
        entry,
        pageUrl,
        snapshotFingerprint,
      )
    ) return false;
    const expected = sourceFormulaArtifactTopologyCandidateRepairExpectedPageSlots(finalEntry.candidate);
    if (expected.length !== visuals.length) return false;
    const byId = new Map(visuals.map((visual) => [visual.sourceVisualId, visual]));
    if (byId.size !== visuals.length) return false;
    return expected.every((slot) => {
      const visual = byId.get(slot.sourceVisualId);
      if (
        !visual ||
        visual.type !== slot.detection.type ||
        visual.pageImagePath !== strict.pageImagePath ||
        !visual.bbox ||
        !slot.detection.bbox ||
        !sameSourceVisualBBox(visual.bbox, slot.detection.bbox)
      ) return false;
      const cropPath = visual.croppedImagePath
        ? assetDiskPath(contentPath, gardenSlug, visual.croppedImagePath)
        : null;
      const crop = cropPng(pageImage, expandedCropBBox(slot.detection.bbox, slot.detection.type));
      if (!cropPath || !fs.existsSync(cropPath) || !crop?.length || sha256(fs.readFileSync(cropPath)) !== sha256(crop)) {
        return false;
      }
      if (!slot.activeSlot) {
        return visual.caption === slot.detection.caption &&
          (visual.exactText?.trim() || undefined) === (slot.detection.exactText?.trim() || undefined);
      }
      const provenance = visual.formulaReview?.artifactTopologyCandidateRepair;
      return Boolean(
        provenance &&
        provenance.cycleCacheKey === strict.cacheKey &&
        provenance.cycleCacheIntegritySha256 === strict.integritySha256 &&
        provenance.candidateCacheKey === finalEntry.candidate.cacheKey &&
        provenance.candidateCacheIntegritySha256 === finalEntry.candidate.integritySha256 &&
        provenance.sourceVisualId === slot.sourceVisualId &&
        visual.formulaReview?.inputExactText === slot.activeSlot.exactText &&
        visual.formulaReview?.inputCaption === slot.activeSlot.caption,
      );
    });
  } catch {
    return false;
  }
}

/** Rebuild current page/PDF/Markdown evidence and validate the complete V7
 * master history. Extraction may replay only the terminal C[n]/R[n] pair and
 * never a pending/rejected/malformed consensus container. */
function sourceFormulaArtifactTopologyConsensusRepairLiveEnvelope(
  contentPath: string,
  gardenSlug: string,
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  snapshotFingerprint: string,
  pageImage: Buffer,
): SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope | null {
  const envelope = entry?.formulaArtifactTopologyConsensusRepair;
  if (
    !entry ||
    !envelope ||
    !sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(entry, pageUrl, snapshotFingerprint) ||
    !sourceFormulaArtifactTopologyConsensusRepairHasCurrentEvidence(
      contentPath,
      gardenSlug,
      envelope,
      snapshotFingerprint,
    )
  ) return null;
  try {
    const canonicalPageText = canonicalSourcePageMarkdown(
      contentPath,
      gardenSlug,
      envelope.sourceId,
      envelope.pageNumber,
    );
    if (!canonicalPageText) return null;
    const sourcePdf = sourcePdfEvidence(contentPath, gardenSlug, envelope.sourceId);
    const evidence: SourceFormulaReviewPageEvidence = {
      sourceId: envelope.sourceId,
      pageNumber: envelope.pageNumber,
      pageImagePath: envelope.pageImagePath,
      pageImage,
      pageImageSha256: snapshotFingerprint,
      canonicalPageText,
      canonicalPageTextSha256: sha256(canonicalPageText),
      sourcePdfPath: sourcePdf.sourcePdfPath,
      sourcePdfSha256: sourcePdf.sourcePdfSha256,
      inputs: [],
      crops: new Map(),
    };
    return sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanEntryForPageEvidence(
      entry,
      snapshotFingerprint,
      evidence,
    );
  } catch {
    return null;
  }
}

function sourceFormulaArtifactTopologyConsensusRepairPageIsFaithfullyProjected(
  contentPath: string,
  gardenSlug: string,
  entry: SourceVisualScanEntry | undefined,
  pageUrl: string,
  snapshotFingerprint: string,
  pageImage: Buffer,
  visuals: readonly SourceVisual[],
): boolean {
  const strict = sourceFormulaArtifactTopologyConsensusRepairLiveEnvelope(
    contentPath,
    gardenSlug,
    entry,
    pageUrl,
    snapshotFingerprint,
    pageImage,
  );
  try {
    const finalEntry = strict ? sourceFormulaArtifactTopologyConsensusRepairFinalEntry(strict) : null;
    if (
      !strict ||
      !finalEntry ||
      !sourceFormulaArtifactTopologyConsensusRepairIsProjectionConfirmed(strict)
    ) return false;
    const expected = sourceFormulaArtifactTopologyConsensusRepairExpectedPageSlots(finalEntry.candidate);
    if (expected.length !== visuals.length) return false;
    const byId = new Map(visuals.map((visual) => [visual.sourceVisualId, visual]));
    if (byId.size !== visuals.length) return false;
    return expected.every((slot) => {
      const visual = byId.get(slot.sourceVisualId);
      if (
        !visual ||
        visual.type !== slot.detection.type ||
        visual.pageImagePath !== strict.pageImagePath ||
        !visual.bbox ||
        !slot.detection.bbox ||
        !sameSourceVisualBBox(visual.bbox, slot.detection.bbox)
      ) return false;
      const cropPath = visual.croppedImagePath
        ? assetDiskPath(contentPath, gardenSlug, visual.croppedImagePath)
        : null;
      const crop = cropPng(pageImage, expandedCropBBox(slot.detection.bbox, slot.detection.type));
      if (!cropPath || !fs.existsSync(cropPath) || !crop?.length || sha256(fs.readFileSync(cropPath)) !== sha256(crop)) {
        return false;
      }
      if (!slot.activeSlot) {
        return visual.caption === slot.detection.caption &&
          (visual.exactText?.trim() || undefined) === (slot.detection.exactText?.trim() || undefined);
      }
      const provenance = visual.formulaReview?.artifactTopologyConsensusRepair;
      return Boolean(
        provenance &&
        provenance.cycleCacheKey === strict.cacheKey &&
        provenance.cycleCacheIntegritySha256 === strict.integritySha256 &&
        provenance.candidateCacheKey === finalEntry.candidate.cacheKey &&
        provenance.candidateCacheIntegritySha256 === finalEntry.candidate.integritySha256 &&
        provenance.sourceVisualId === slot.sourceVisualId &&
        visual.formulaReview?.inputExactText === slot.activeSlot.exactText &&
        visual.formulaReview?.inputCaption === slot.activeSlot.caption,
      );
    });
  } catch {
    return false;
  }
}

function sourceFormulaArtifactRecoveryProvenance(
  envelope: SourceFormulaArtifactRecoveryCacheEnvelope,
  input: SourceFormulaArtifactRecoveryInput,
  replacement: SourceFormulaArtifactRecoveryReplacement,
): SourceFormulaArtifactRecoveryProvenance {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_RECOVERY_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_RECOVERY_PROMPT_VERSION,
    model: envelope.model,
    recoveredAt: envelope.recoveredAt,
    sourceVisualId: input.sourceVisualId,
    reviewerIdentityAssessment: input.reviewerIdentityAssessment,
    reviewerReason: input.reviewerReason,
    inputExactText: input.inputExactText,
    inputCaption: input.inputCaption,
    inputBBox: { ...input.inputBBox },
    inputEquationCropSha256: input.inputEquationCropSha256,
    recoveredExactText: replacement.exactText,
    recoveredCaption: replacement.caption,
    recoveredBBox: { ...replacement.bbox },
    recoveredEquationCropSha256: replacement.equationCropSha256,
    pageImageSha256: envelope.pageImageSha256,
    canonicalPageTextSha256: envelope.canonicalPageTextSha256,
    sourcePdfSha256: envelope.sourcePdfSha256,
    failedReviewCacheKey: envelope.failedReview.cacheKey,
    failedReviewRequestSha256: envelope.failedReview.requestSha256,
    failedReviewResponseSha256: envelope.failedReview.responseSha256,
    requestSha256: envelope.requestSha256,
    responseSha256: envelope.responseSha256,
    cacheKey: envelope.cacheKey,
    cacheIntegritySha256: envelope.integritySha256,
    semanticAttempt: envelope.semanticAttempt,
  };
}

function applySourceFormulaArtifactRecoveryToLedger(
  ledger: readonly SourceVisual[],
  outcomes: readonly SourceFormulaArtifactRecoveryPageOutcome[],
  gardenSlug: string,
): {
  ledger: SourceVisual[];
  recoveryVisualCrops: Array<{
    sourceVisualId: string;
    crop: Buffer;
    croppedImagePath: string;
  }>;
  recoveryById: Map<string, {
    envelope: SourceFormulaArtifactRecoveryCacheEnvelope;
    input: SourceFormulaArtifactRecoveryInput;
    replacement: SourceFormulaArtifactRecoveryReplacement;
  }>;
} {
  const recoveryById = new Map<string, {
    envelope: SourceFormulaArtifactRecoveryCacheEnvelope;
    input: SourceFormulaArtifactRecoveryInput;
    replacement: SourceFormulaArtifactRecoveryReplacement;
  }>();
  const recoveryVisualCrops: Array<{
    sourceVisualId: string;
    crop: Buffer;
    croppedImagePath: string;
  }> = [];
  for (const outcome of outcomes) {
    for (let index = 0; index < outcome.envelope.inputVisuals.length; index += 1) {
      const input = outcome.envelope.inputVisuals[index];
      const replacement = outcome.envelope.replacements[index];
      if (!input || !replacement || input.sourceVisualId !== replacement.sourceVisualId) {
        throw new Error("Formula-artifact recovery slot projection is inconsistent.");
      }
      if (recoveryById.has(input.sourceVisualId)) {
        throw new Error("Formula-artifact recovery duplicated source slot " + input.sourceVisualId + ".");
      }
      recoveryById.set(input.sourceVisualId, {
        envelope: outcome.envelope,
        input,
        replacement,
      });
    }
  }
  for (const [sourceVisualId, recovery] of recoveryById) {
    const original = ledger.find((visual) => visual.sourceVisualId === sourceVisualId);
    if (
      !original ||
      original.type !== "equation" ||
      original.sourceId !== recovery.input.sourceId ||
      original.pageNumber !== recovery.input.pageNumber
    ) {
      throw new Error(
        "Formula-artifact recovery identity does not match ledger slot " + sourceVisualId + ".",
      );
    }
  }
  const recoveredPageKeys = new Set<string>();
  const recoveredPageVisuals: SourceVisual[] = [];
  for (const outcome of outcomes) {
    const pageKey = outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber;
    if (recoveredPageKeys.has(pageKey)) {
      throw new Error("Formula-artifact recovery duplicated page " + outcome.evidence.pageNumber + ".");
    }
    recoveredPageKeys.add(pageKey);
    const sourceIndex = sourceIndexFromVisualId(outcome.envelope.inputVisuals[0]?.sourceVisualId ?? "");
    if (sourceIndex === null) {
      throw new Error("Formula-artifact recovery cannot resolve its stable source slot.");
    }
    const counters = new Map<string, number>();
    let formulaIndex = 0;
    for (const detection of outcome.envelope.detections) {
      const letter = TYPE_LETTER[detection.type];
      const nextOrdinal = (counters.get(letter) ?? 0) + 1;
      counters.set(letter, nextOrdinal);
      let sourceVisualId = "S" + sourceIndex + ".P" + outcome.evidence.pageNumber +
        "." + letter + nextOrdinal;
      let exactText = detection.exactText;
      if (detection.type === "equation") {
        const replacement = outcome.envelope.replacements[formulaIndex];
        if (
          !replacement ||
          replacement.caption !== detection.caption ||
          replacement.exactText !== detection.exactText ||
          !detection.bbox ||
          !sameSourceVisualBBox(replacement.bbox, detection.bbox)
        ) {
          throw new Error("Formula-artifact recovery equation detection projection is inconsistent.");
        }
        sourceVisualId = replacement.sourceVisualId;
        exactText = replacement.exactText;
        formulaIndex += 1;
      }
      if (!detection.bbox) {
        throw new Error("Formula-artifact recovery visual detection has no bbox.");
      }
      const crop = cropPng(
        outcome.evidence.pageImage,
        expandedCropBBox(detection.bbox, detection.type),
      );
      if (!crop?.length) {
        throw new Error("Formula-artifact recovery visual crop could not be derived.");
      }
      const cropSha256 = sha256(crop);
      const croppedImagePath = detection.type === "equation"
        ? sourceFormulaReviewedCropUrl(gardenSlug, sourceVisualId, cropSha256)
        : sourceFormulaArtifactRecoveryVisualCropUrl(gardenSlug, sourceVisualId, cropSha256);
      if (detection.type === "equation") {
        const replacement = recoveryById.get(sourceVisualId)?.replacement;
        if (!replacement || replacement.equationCropSha256 !== cropSha256) {
          throw new Error("Formula-artifact recovery formula crop projection is inconsistent.");
        }
      } else {
        recoveryVisualCrops.push({ sourceVisualId, crop, croppedImagePath });
      }
      recoveredPageVisuals.push({
        sourceVisualId,
        sourceId: outcome.evidence.sourceId,
        pageNumber: outcome.evidence.pageNumber,
        type: detection.type,
        caption: detection.caption,
        ...(exactText ? { exactText } : {}),
        pageImagePath: outcome.evidence.pageImagePath,
        bbox: { ...detection.bbox },
        croppedImagePath,
        usageStatus: "unused",
      });
    }
    if (formulaIndex !== outcome.envelope.replacements.length) {
      throw new Error("Formula-artifact recovery did not project every formula page slot.");
    }
  }
  // Project the model-authored whole-page detection set, not merely the
  // rejected boxes. This makes the recovery cache and candidate ledger describe
  // exactly the same source-artifact page.
  const next = [
    ...ledger.filter((visual) =>
      !recoveredPageKeys.has(visual.sourceId + "\u0000" + visual.pageNumber),
    ),
    ...recoveredPageVisuals,
  ].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) ||
    left.pageNumber - right.pageNumber ||
    left.sourceVisualId.localeCompare(right.sourceVisualId),
  );
  if (recoveryById.size !== outcomes.reduce(
    (count, outcome) => count + outcome.envelope.replacements.length,
    0,
  )) {
    throw new Error("Formula-artifact recovery source slot projection is incomplete.");
  }
  return { ledger: next, recoveryVisualCrops, recoveryById };
}

function sourceFormulaArtifactTopologyRecoveryProvenance(
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  slot: SourceFormulaArtifactTopologyActiveSlot,
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
): SourceFormulaArtifactTopologyRecoveryProvenance {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_PROMPT_VERSION,
    model: recovery.model,
    recoveredAt: recovery.recoveredAt,
    sourceVisualId: slot.sourceVisualId,
    priorSourceVisualIds: [...slot.priorSourceVisualIds],
    recoveredExactText: slot.exactText,
    recoveredCaption: slot.caption,
    recoveredBBox: { ...slot.bbox },
    recoveredEquationCropSha256: slot.equationCropSha256,
    pageImageSha256: recovery.pageImageSha256,
    canonicalPageTextSha256: recovery.canonicalPageTextSha256,
    sourcePdfSha256: recovery.sourcePdfSha256,
    failedReviewCacheKey: recovery.failedReview.cacheKey,
    failedReviewRequestSha256: recovery.failedReview.requestSha256,
    failedReviewResponseSha256: recovery.failedReview.responseSha256,
    requestSha256: recovery.requestSha256,
    responseSha256: recovery.responseSha256,
    cacheKey: recovery.cacheKey,
    cacheIntegritySha256: recovery.integritySha256,
    semanticAttempt: recovery.semanticAttempt,
    topologyReviewCacheKey: topologyReview.cacheKey,
    topologyReviewCacheIntegritySha256: topologyReview.integritySha256,
    topologyReviewRequestSha256: topologyReview.requestSha256,
    topologyReviewResponseSha256: topologyReview.responseSha256,
    topologyReviewSemanticAttempt: topologyReview.semanticAttempt,
  };
}

function applySourceFormulaArtifactTopologyRecoveryToLedger(
  ledger: readonly SourceVisual[],
  outcomes: readonly SourceFormulaArtifactTopologyRecoveryPageOutcome[],
  gardenSlug: string,
): {
  ledger: SourceVisual[];
  recoveryVisualCrops: Array<{ sourceVisualId: string; crop: Buffer; croppedImagePath: string }>;
  topologyById: Map<string, {
    envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>;
} {
  const topologyById = new Map<string, {
    envelope: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>();
  const recoveryVisualCrops: Array<{ sourceVisualId: string; crop: Buffer; croppedImagePath: string }> = [];
  const recoveredPageKeys = new Set<string>();
  const recoveredPageVisuals: SourceVisual[] = [];
  for (const outcome of outcomes) {
    if (!outcome.topologyReview || outcome.topologyReview.status !== "confirmed") {
      throw new Error("Formula-artifact topology recovery cannot project an unconfirmed graph.");
    }
    const pageKey = outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber;
    if (recoveredPageKeys.has(pageKey)) {
      throw new Error("Formula-artifact topology recovery duplicated page " + outcome.evidence.pageNumber + ".");
    }
    recoveredPageKeys.add(pageKey);
    for (const input of outcome.envelope.inputVisuals) {
      const old = ledger.find((visual) => visual.sourceVisualId === input.sourceVisualId);
      if (!old || old.type !== "equation" || old.sourceId !== input.sourceId || old.pageNumber !== input.pageNumber) {
        throw new Error("Formula-artifact topology recovery old-slot identity does not match ledger " + input.sourceVisualId + ".");
      }
    }
    const sourceIndex = sourceIndexFromVisualId(outcome.envelope.inputVisuals[0]?.sourceVisualId ?? "");
    if (sourceIndex === null) throw new Error("Formula-artifact topology recovery cannot resolve stable source slot.");
    const counters = new Map<string, number>();
    let formulaIndex = 0;
    for (const detection of outcome.envelope.detections) {
      const letter = TYPE_LETTER[detection.type];
      const ordinal = (counters.get(letter) ?? 0) + 1;
      counters.set(letter, ordinal);
      let sourceVisualId = "S" + sourceIndex + ".P" + outcome.evidence.pageNumber + "." + letter + ordinal;
      let exactText = detection.exactText;
      let activeSlot: SourceFormulaArtifactTopologyActiveSlot | undefined;
      if (detection.type === "equation") {
        activeSlot = outcome.envelope.activeFormulaSlots[formulaIndex];
        if (
          !activeSlot ||
          activeSlot.caption !== detection.caption ||
          activeSlot.exactText !== detection.exactText ||
          !detection.bbox ||
          !sameSourceVisualBBox(activeSlot.bbox, detection.bbox) ||
          topologyById.has(activeSlot.sourceVisualId)
        ) {
          throw new Error("Formula-artifact topology recovery equation projection is inconsistent.");
        }
        sourceVisualId = activeSlot.sourceVisualId;
        exactText = activeSlot.exactText;
        formulaIndex += 1;
        topologyById.set(sourceVisualId, {
          envelope: outcome.envelope,
          slot: activeSlot,
          topologyReview: outcome.topologyReview,
        });
      }
      if (!detection.bbox) throw new Error("Formula-artifact topology recovery visual detection has no bbox.");
      const crop = cropPng(outcome.evidence.pageImage, expandedCropBBox(detection.bbox, detection.type));
      if (!crop?.length) throw new Error("Formula-artifact topology recovery visual crop could not be derived.");
      const cropSha256 = sha256(crop);
      const croppedImagePath = detection.type === "equation"
        ? sourceFormulaReviewedCropUrl(gardenSlug, sourceVisualId, cropSha256)
        : sourceFormulaArtifactRecoveryVisualCropUrl(gardenSlug, sourceVisualId, cropSha256);
      if (activeSlot) {
        if (activeSlot.equationCropSha256 !== cropSha256) {
          throw new Error("Formula-artifact topology recovery active formula crop projection is inconsistent.");
        }
      } else {
        recoveryVisualCrops.push({ sourceVisualId, crop, croppedImagePath });
      }
      recoveredPageVisuals.push({
        sourceVisualId,
        sourceId: outcome.evidence.sourceId,
        pageNumber: outcome.evidence.pageNumber,
        type: detection.type,
        caption: detection.caption,
        ...(exactText ? { exactText } : {}),
        pageImagePath: outcome.evidence.pageImagePath,
        bbox: { ...detection.bbox },
        croppedImagePath,
        usageStatus: "unused",
      });
    }
    if (formulaIndex !== outcome.envelope.activeFormulaSlots.length) {
      throw new Error("Formula-artifact topology recovery did not project every active formula slot.");
    }
  }
  const next = [
    ...ledger.filter((visual) => !recoveredPageKeys.has(visual.sourceId + "\u0000" + visual.pageNumber)),
    ...recoveredPageVisuals,
  ].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) ||
    left.pageNumber - right.pageNumber ||
    left.sourceVisualId.localeCompare(right.sourceVisualId),
  );
  return { ledger: next, recoveryVisualCrops, topologyById };
}

function sourceFormulaArtifactTopologyCandidateRepairExpectedPageSlots(
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate,
): Array<{
  sourceVisualId: string;
  detection: SourceVisualDetection;
  activeSlot?: SourceFormulaArtifactTopologyActiveSlot;
}> {
  const sourceIndex = sourceIndexFromVisualId(candidate.inputVisuals[0]?.sourceVisualId ?? "");
  if (sourceIndex === null) return [];
  const counters = new Map<string, number>();
  let formulaIndex = 0;
  const slots: Array<{
    sourceVisualId: string;
    detection: SourceVisualDetection;
    activeSlot?: SourceFormulaArtifactTopologyActiveSlot;
  }> = [];
  for (const detection of candidate.detections) {
    const letter = TYPE_LETTER[detection.type];
    const ordinal = (counters.get(letter) ?? 0) + 1;
    counters.set(letter, ordinal);
    let sourceVisualId = "S" + sourceIndex + ".P" + candidate.pageNumber + "." + letter + ordinal;
    let activeSlot: SourceFormulaArtifactTopologyActiveSlot | undefined;
    if (detection.type === "equation") {
      activeSlot = candidate.activeFormulaSlots[formulaIndex];
      if (!activeSlot) return [];
      sourceVisualId = activeSlot.sourceVisualId;
      formulaIndex += 1;
    }
    slots.push({ sourceVisualId, detection, ...(activeSlot ? { activeSlot } : {}) });
  }
  return formulaIndex === candidate.activeFormulaSlots.length ? slots : [];
}

function rebindSourceFormulaPageEvidenceAfterArtifactTopologyCandidateRepair(
  evidence: SourceFormulaReviewPageEvidence,
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate,
): SourceFormulaReviewPageEvidence {
  const crops = new Map<string, Buffer>();
  const inputs = candidate.activeFormulaSlots
    .slice()
    .sort((left, right) => sourceFormulaSlotOrder(left.sourceVisualId) - sourceFormulaSlotOrder(right.sourceVisualId) ||
      left.sourceVisualId.localeCompare(right.sourceVisualId))
    .map((slot): SourceFormulaReviewInput => {
      const crop = cropPng(evidence.pageImage, expandedCropBBox(slot.bbox, "equation"));
      if (!crop?.length || sha256(crop) !== slot.equationCropSha256) {
        throw new Error(
          "Formula-artifact topology candidate repair crop evidence is invalid for " + slot.sourceVisualId + ".",
        );
      }
      crops.set(slot.sourceVisualId, crop);
      return {
        sourceVisualId: slot.sourceVisualId,
        sourceId: evidence.sourceId,
        pageNumber: evidence.pageNumber,
        pageImagePath: evidence.pageImagePath,
        inputCaption: slot.caption,
        inputExactText: slot.exactText,
        bbox: { ...slot.bbox },
        equationCropSha256: slot.equationCropSha256,
      };
    });
  return { ...evidence, inputs, crops };
}

function sourceFormulaArtifactTopologyCandidateRepairProvenance(
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope,
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate,
  slot: SourceFormulaArtifactTopologyActiveSlot,
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
): SourceFormulaArtifactTopologyCandidateRepairProvenance {
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_PROMPT_VERSION,
    model: candidate.model,
    candidateOrdinal: candidate.candidateOrdinal,
    recoveredAt: candidate.recoveredAt,
    sourceVisualId: slot.sourceVisualId,
    priorSourceVisualIds: [...slot.priorSourceVisualIds],
    recoveredExactText: slot.exactText,
    recoveredCaption: slot.caption,
    recoveredBBox: { ...slot.bbox },
    recoveredEquationCropSha256: slot.equationCropSha256,
    pageImageSha256: candidate.pageImageSha256,
    canonicalPageTextSha256: candidate.canonicalPageTextSha256,
    sourcePdfSha256: candidate.sourcePdfSha256,
    cycleCacheKey: envelope.cacheKey,
    cycleCacheIntegritySha256: envelope.integritySha256,
    initialRecoveryCacheKey: envelope.initialRecovery.cacheKey,
    initialRecoveryCacheIntegritySha256: envelope.initialRecovery.integritySha256,
    initialTopologyReviewCacheKey: envelope.initialTopologyReview.cacheKey,
    initialTopologyReviewCacheIntegritySha256: envelope.initialTopologyReview.integritySha256,
    candidateCacheKey: candidate.cacheKey,
    candidateCacheIntegritySha256: candidate.integritySha256,
    candidateRequestSha256: candidate.requestSha256,
    candidateResponseSha256: candidate.responseSha256,
    candidateSemanticAttempt: candidate.semanticAttempt,
    topologyReviewCacheKey: topologyReview.cacheKey,
    topologyReviewCacheIntegritySha256: topologyReview.integritySha256,
    topologyReviewRequestSha256: topologyReview.requestSha256,
    topologyReviewResponseSha256: topologyReview.responseSha256,
    topologyReviewSemanticAttempt: topologyReview.semanticAttempt,
  };
}

function sourceFormulaArtifactTopologyCandidateRepairActiveSlotsMatchEvidence(
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  if (candidate.activeFormulaSlots.length !== evidence.inputs.length) return false;
  const currentById = new Map(evidence.inputs.map((input) => [input.sourceVisualId, input]));
  if (currentById.size !== evidence.inputs.length) return false;
  return candidate.activeFormulaSlots.every((slot) => {
    const input = currentById.get(slot.sourceVisualId);
    return Boolean(
      input &&
      input.inputCaption === slot.caption &&
      input.inputExactText === slot.exactText &&
      sameSourceVisualBBox(input.bbox, slot.bbox) &&
      input.equationCropSha256 === slot.equationCropSha256,
    );
  });
}

/** A normal reviewer may legitimately replace the candidate's visible text or
 * caption. On a later run, rebuild its input from the immutable terminal V6
 * candidate instead of treating that accepted output as new source evidence;
 * otherwise the lineage would disappear merely because the reviewer improved
 * transcription. */
function rebindSourceFormulaPageEvidenceFromConfirmedTopologyCandidateRepair(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaReviewPageEvidence | null {
  const envelope = sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanCacheForPageEvidence(
    contentPath,
    gardenSlug,
    evidence,
  );
  const finalEntry = envelope ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(envelope) : null;
  if (
    !envelope ||
    !finalEntry ||
    !finalEntry.topologyReview ||
    finalEntry.topologyReview.status !== "confirmed"
  ) return null;
  const activeIds = finalEntry.candidate.activeFormulaSlots
    .map((slot) => slot.sourceVisualId)
    .sort();
  const currentIds = evidence.inputs.map((input) => input.sourceVisualId).sort();
  if (JSON.stringify(activeIds) !== JSON.stringify(currentIds)) return null;
  return rebindSourceFormulaPageEvidenceAfterArtifactTopologyCandidateRepair(
    evidence,
    finalEntry.candidate,
  );
}

function sourceFormulaArtifactTopologyCandidateRepairLineageForEvidence(
  contentPath: string,
  gardenSlug: string,
  pages: readonly SourceFormulaReviewPageEvidence[],
): Map<string, {
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate;
  slot: SourceFormulaArtifactTopologyActiveSlot;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
}> {
  const lineage = new Map<string, {
    envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
    candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>();
  for (const evidence of pages) {
    const envelope = sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanCacheForPageEvidence(
      contentPath,
      gardenSlug,
      evidence,
    );
    const finalEntry = envelope ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(envelope) : null;
    const review = finalEntry?.topologyReview;
    if (
      !envelope ||
      !finalEntry ||
      !review ||
      review.status !== "confirmed" ||
      !sourceFormulaArtifactTopologyCandidateRepairActiveSlotsMatchEvidence(finalEntry.candidate, evidence)
    ) continue;
    for (const slot of finalEntry.candidate.activeFormulaSlots) {
      if (lineage.has(slot.sourceVisualId)) {
        throw new Error("Formula-artifact topology candidate repair duplicated active source slot " + slot.sourceVisualId + ".");
      }
      lineage.set(slot.sourceVisualId, {
        envelope,
        candidate: finalEntry.candidate,
        slot,
        topologyReview: review,
      });
    }
  }
  return lineage;
}

function applySourceFormulaArtifactTopologyCandidateRepairToLedger(
  ledger: readonly SourceVisual[],
  outcomes: readonly SourceFormulaArtifactTopologyCandidateRepairPageOutcome[],
  gardenSlug: string,
): {
  ledger: SourceVisual[];
  recoveryVisualCrops: Array<{ sourceVisualId: string; crop: Buffer; croppedImagePath: string }>;
  candidateRepairById: Map<string, {
    envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
    candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>;
} {
  const candidateRepairById = new Map<string, {
    envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
    candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>();
  const recoveryVisualCrops: Array<{ sourceVisualId: string; crop: Buffer; croppedImagePath: string }> = [];
  const recoveredPageKeys = new Set<string>();
  const recoveredPageVisuals: SourceVisual[] = [];
  for (const outcome of outcomes) {
    if (outcome.topologyReview.status !== "confirmed") {
      throw new Error("Formula-artifact topology candidate repair cannot project an unconfirmed graph.");
    }
    const finalEntry = sourceFormulaArtifactTopologyCandidateRepairFinalEntry(outcome.envelope);
    if (
      !finalEntry ||
      finalEntry.candidate.cacheKey !== outcome.candidate.cacheKey ||
      finalEntry.candidate.integritySha256 !== outcome.candidate.integritySha256 ||
      finalEntry.topologyReview?.cacheKey !== outcome.topologyReview.cacheKey ||
      finalEntry.topologyReview?.integritySha256 !== outcome.topologyReview.integritySha256
    ) {
      throw new Error("Formula-artifact topology candidate repair outcome is not its durable final history state.");
    }
    const pageKey = outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber;
    if (recoveredPageKeys.has(pageKey)) {
      throw new Error("Formula-artifact topology candidate repair duplicated page " + outcome.evidence.pageNumber + ".");
    }
    recoveredPageKeys.add(pageKey);
    for (const input of outcome.envelope.initialRecovery.inputVisuals) {
      const old = ledger.find((visual) => visual.sourceVisualId === input.sourceVisualId);
      if (!old || old.type !== "equation" || old.sourceId !== input.sourceId || old.pageNumber !== input.pageNumber) {
        throw new Error("Formula-artifact topology candidate repair old-slot identity does not match ledger " + input.sourceVisualId + ".");
      }
    }
    const slots = sourceFormulaArtifactTopologyCandidateRepairExpectedPageSlots(outcome.candidate);
    if (slots.length !== outcome.candidate.detections.length) {
      throw new Error("Formula-artifact topology candidate repair does not describe one complete page projection.");
    }
    for (const slot of slots) {
      if (!slot.detection.bbox) {
        throw new Error("Formula-artifact topology candidate repair visual detection has no bbox.");
      }
      const crop = cropPng(outcome.evidence.pageImage, expandedCropBBox(slot.detection.bbox, slot.detection.type));
      if (!crop?.length) {
        throw new Error("Formula-artifact topology candidate repair visual crop could not be derived.");
      }
      const cropSha256 = sha256(crop);
      const croppedImagePath = slot.detection.type === "equation"
        ? sourceFormulaReviewedCropUrl(gardenSlug, slot.sourceVisualId, cropSha256)
        : sourceFormulaArtifactRecoveryVisualCropUrl(gardenSlug, slot.sourceVisualId, cropSha256);
      if (slot.activeSlot) {
        if (
          slot.activeSlot.equationCropSha256 !== cropSha256 ||
          candidateRepairById.has(slot.sourceVisualId)
        ) {
          throw new Error("Formula-artifact topology candidate repair active formula crop projection is inconsistent.");
        }
        candidateRepairById.set(slot.sourceVisualId, {
          envelope: outcome.envelope,
          candidate: outcome.candidate,
          slot: slot.activeSlot,
          topologyReview: outcome.topologyReview,
        });
      } else {
        recoveryVisualCrops.push({ sourceVisualId: slot.sourceVisualId, crop, croppedImagePath });
      }
      recoveredPageVisuals.push({
        sourceVisualId: slot.sourceVisualId,
        sourceId: outcome.evidence.sourceId,
        pageNumber: outcome.evidence.pageNumber,
        type: slot.detection.type,
        caption: slot.activeSlot?.caption ?? slot.detection.caption,
        ...((slot.activeSlot?.exactText ?? slot.detection.exactText) ? {
          exactText: slot.activeSlot?.exactText ?? slot.detection.exactText,
        } : {}),
        pageImagePath: outcome.evidence.pageImagePath,
        bbox: { ...slot.detection.bbox },
        croppedImagePath,
        usageStatus: "unused",
      });
    }
  }
  const next = [
    ...ledger.filter((visual) => !recoveredPageKeys.has(visual.sourceId + "\u0000" + visual.pageNumber)),
    ...recoveredPageVisuals,
  ].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) ||
    left.pageNumber - right.pageNumber ||
    left.sourceVisualId.localeCompare(right.sourceVisualId),
  );
  return { ledger: next, recoveryVisualCrops, candidateRepairById };
}

function sourceFormulaArtifactTopologyConsensusRepairExpectedPageSlots(
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
): Array<{
  sourceVisualId: string;
  detection: SourceVisualDetection;
  activeSlot?: SourceFormulaArtifactTopologyActiveSlot;
}> {
  const sourceIndex = sourceIndexFromVisualId(candidate.inputVisuals[0]?.sourceVisualId ?? "");
  if (sourceIndex === null) return [];
  const counters = new Map<string, number>();
  let formulaIndex = 0;
  const slots: Array<{
    sourceVisualId: string;
    detection: SourceVisualDetection;
    activeSlot?: SourceFormulaArtifactTopologyActiveSlot;
  }> = [];
  for (const detection of candidate.detections) {
    const letter = TYPE_LETTER[detection.type];
    const ordinal = (counters.get(letter) ?? 0) + 1;
    counters.set(letter, ordinal);
    let sourceVisualId = "S" + sourceIndex + ".P" + candidate.pageNumber + "." + letter + ordinal;
    let activeSlot: SourceFormulaArtifactTopologyActiveSlot | undefined;
    if (detection.type === "equation") {
      activeSlot = candidate.activeFormulaSlots[formulaIndex];
      if (!activeSlot) return [];
      sourceVisualId = activeSlot.sourceVisualId;
      formulaIndex += 1;
    }
    slots.push({ sourceVisualId, detection, ...(activeSlot ? { activeSlot } : {}) });
  }
  return formulaIndex === candidate.activeFormulaSlots.length ? slots : [];
}

function rebindSourceFormulaPageEvidenceAfterArtifactTopologyConsensusRepair(
  evidence: SourceFormulaReviewPageEvidence,
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
): SourceFormulaReviewPageEvidence {
  const crops = new Map<string, Buffer>();
  const inputs = sourceFormulaArtifactTopologyConsensusReviewInputs(evidence, candidate).map((input) => {
    const crop = cropPng(evidence.pageImage, expandedCropBBox(input.bbox, "equation"));
    if (!crop?.length || sha256(crop) !== input.equationCropSha256) {
      throw new Error(
        "Formula-artifact topology consensus repair crop evidence is invalid for " + input.sourceVisualId + ".",
      );
    }
    crops.set(input.sourceVisualId, crop);
    return input;
  });
  return { ...evidence, inputs, crops };
}

/**
 * Rebind a current-evidence, independently confirmed V5 topology candidate
 * before any later ordinary formula review.  The ordinary reviewer may have
 * previously replaced accepted text/caption, but that cannot erase the signed
 * full-page candidate or make its provenance disappear on a later full-ledger
 * re-review.
 */
function rebindSourceFormulaPageEvidenceFromConfirmedTopologyRecovery(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaReviewPageEvidence | null {
  const recovery = sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanCacheForPageEvidence(
    contentPath,
    gardenSlug,
    evidence,
  );
  if (!recovery) return null;
  const topologyReview = sourceFormulaArtifactTopologyReviewFromScanCacheForEvidence(
    contentPath,
    gardenSlug,
    evidence,
    recovery,
  );
  if (!topologyReview || topologyReview.status !== "confirmed") return null;
  const activeIds = recovery.activeFormulaSlots.map((slot) => slot.sourceVisualId).sort();
  const currentIds = evidence.inputs.map((input) => input.sourceVisualId).sort();
  if (
    new Set(activeIds).size !== activeIds.length ||
    JSON.stringify(activeIds) !== JSON.stringify(currentIds)
  ) return null;
  return rebindSourceFormulaPageEvidenceAfterArtifactTopologyRecovery(evidence, recovery);
}

function sourceFormulaArtifactTopologyConsensusRepairProvenance(
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
  slot: SourceFormulaArtifactTopologyActiveSlot,
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
): SourceFormulaArtifactTopologyConsensusRepairProvenance {
  const baseCandidate = sourceFormulaArtifactTopologyConsensusBaseCandidate(envelope.base);
  const baseTopologyReview = sourceFormulaArtifactTopologyConsensusBaseTopologyReview(envelope.base);
  return {
    schemaVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_PROMPT_VERSION,
    model: candidate.model,
    candidateOrdinal: candidate.candidateOrdinal,
    recoveredAt: candidate.recoveredAt,
    sourceVisualId: slot.sourceVisualId,
    priorSourceVisualIds: [...slot.priorSourceVisualIds],
    recoveredExactText: slot.exactText,
    recoveredCaption: slot.caption,
    recoveredBBox: { ...slot.bbox },
    recoveredEquationCropSha256: slot.equationCropSha256,
    pageImageSha256: candidate.pageImageSha256,
    canonicalPageTextSha256: candidate.canonicalPageTextSha256,
    sourcePdfSha256: candidate.sourcePdfSha256,
    cycleCacheKey: envelope.cacheKey,
    cycleCacheIntegritySha256: envelope.integritySha256,
    baseProtocol: envelope.base.protocol,
    baseCandidateCacheKey: baseCandidate.cacheKey,
    baseCandidateIntegritySha256: baseCandidate.integritySha256,
    baseTopologyReviewCacheKey: baseTopologyReview.cacheKey,
    baseTopologyReviewCacheIntegritySha256: baseTopologyReview.integritySha256,
    triggerFormulaReviewCacheKey: envelope.triggerFormulaReview.failedReview.cacheKey,
    triggerFormulaReviewRequestSha256: envelope.triggerFormulaReview.failedReview.requestSha256,
    triggerFormulaReviewResponseSha256: envelope.triggerFormulaReview.failedReview.responseSha256,
    candidateCacheKey: candidate.cacheKey,
    candidateCacheIntegritySha256: candidate.integritySha256,
    candidateRequestSha256: candidate.requestSha256,
    candidateResponseSha256: candidate.responseSha256,
    candidateSemanticAttempt: candidate.semanticAttempt,
    topologyReviewCacheKey: topologyReview.cacheKey,
    topologyReviewCacheIntegritySha256: topologyReview.integritySha256,
    topologyReviewRequestSha256: topologyReview.requestSha256,
    topologyReviewResponseSha256: topologyReview.responseSha256,
    topologyReviewSemanticAttempt: topologyReview.semanticAttempt,
  };
}

function sourceFormulaArtifactTopologyConsensusRepairActiveSlotsMatchEvidence(
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate,
  evidence: SourceFormulaReviewPageEvidence,
): boolean {
  if (candidate.activeFormulaSlots.length !== evidence.inputs.length) return false;
  const currentById = new Map(evidence.inputs.map((input) => [input.sourceVisualId, input]));
  if (currentById.size !== evidence.inputs.length) return false;
  return candidate.activeFormulaSlots.every((slot) => {
    const input = currentById.get(slot.sourceVisualId);
    return Boolean(
      input &&
      input.inputCaption === slot.caption &&
      input.inputExactText === slot.exactText &&
      sameSourceVisualBBox(input.bbox, slot.bbox) &&
      input.equationCropSha256 === slot.equationCropSha256,
    );
  });
}

/** Rebind the final confirmed V7 candidate before a normal-review cache lookup
 * or a model change. The normal review may replace visible text/caption, but
 * that output must not erase the immutable C[n]/R[n] candidate lineage. */
function rebindSourceFormulaPageEvidenceFromConfirmedTopologyConsensusRepair(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaReviewPageEvidence | null {
  const envelope = sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanCacheForPageEvidence(
    contentPath,
    gardenSlug,
    evidence,
  );
  const finalEntry = envelope ? sourceFormulaArtifactTopologyConsensusRepairFinalEntry(envelope) : null;
  if (
    !envelope ||
    !finalEntry ||
    !finalEntry.topologyReview ||
    finalEntry.topologyReview.status !== "confirmed" ||
    finalEntry.formulaReviewFeedback
  ) return null;
  const activeIds = finalEntry.candidate.activeFormulaSlots.map((slot) => slot.sourceVisualId).sort();
  const currentIds = evidence.inputs.map((input) => input.sourceVisualId).sort();
  if (JSON.stringify(activeIds) !== JSON.stringify(currentIds)) return null;
  return rebindSourceFormulaPageEvidenceAfterArtifactTopologyConsensusRepair(
    evidence,
    finalEntry.candidate,
  );
}

function sourceFormulaArtifactTopologyConsensusRepairLineageForEvidence(
  contentPath: string,
  gardenSlug: string,
  pages: readonly SourceFormulaReviewPageEvidence[],
): Map<string, {
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope;
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate;
  slot: SourceFormulaArtifactTopologyActiveSlot;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
}> {
  const lineage = new Map<string, {
    envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope;
    candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>();
  for (const evidence of pages) {
    const envelope = sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanCacheForPageEvidence(
      contentPath,
      gardenSlug,
      evidence,
    );
    const finalEntry = envelope ? sourceFormulaArtifactTopologyConsensusRepairFinalEntry(envelope) : null;
    const review = finalEntry?.topologyReview;
    if (
      !envelope ||
      !finalEntry ||
      !review ||
      review.status !== "confirmed" ||
      finalEntry.formulaReviewFeedback ||
      !sourceFormulaArtifactTopologyConsensusRepairActiveSlotsMatchEvidence(finalEntry.candidate, evidence)
    ) continue;
    for (const slot of finalEntry.candidate.activeFormulaSlots) {
      if (lineage.has(slot.sourceVisualId)) {
        throw new Error("Formula-artifact topology consensus repair duplicated active source slot " + slot.sourceVisualId + ".");
      }
      lineage.set(slot.sourceVisualId, { envelope, candidate: finalEntry.candidate, slot, topologyReview: review });
    }
  }
  return lineage;
}

function applySourceFormulaArtifactTopologyConsensusRepairToLedger(
  ledger: readonly SourceVisual[],
  outcomes: readonly SourceFormulaArtifactTopologyConsensusRepairPageOutcome[],
  gardenSlug: string,
): {
  ledger: SourceVisual[];
  recoveryVisualCrops: Array<{ sourceVisualId: string; crop: Buffer; croppedImagePath: string }>;
  consensusRepairById: Map<string, {
    envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope;
    candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>;
} {
  const consensusRepairById = new Map<string, {
    envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope;
    candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate;
    slot: SourceFormulaArtifactTopologyActiveSlot;
    topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  }>();
  const recoveryVisualCrops: Array<{ sourceVisualId: string; crop: Buffer; croppedImagePath: string }> = [];
  const recoveredPageKeys = new Set<string>();
  const recoveredPageVisuals: SourceVisual[] = [];
  for (const outcome of outcomes) {
    const finalEntry = sourceFormulaArtifactTopologyConsensusRepairFinalEntry(outcome.envelope);
    if (
      !sourceFormulaArtifactTopologyConsensusRepairIsProjectionConfirmed(outcome.envelope) ||
      !finalEntry ||
      finalEntry.candidate.cacheKey !== outcome.candidate.cacheKey ||
      finalEntry.candidate.integritySha256 !== outcome.candidate.integritySha256 ||
      finalEntry.topologyReview?.cacheKey !== outcome.topologyReview.cacheKey ||
      finalEntry.topologyReview?.integritySha256 !== outcome.topologyReview.integritySha256
    ) {
      throw new Error("Formula-artifact topology consensus repair cannot project a non-terminal candidate.");
    }
    const pageKey = outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber;
    if (recoveredPageKeys.has(pageKey)) {
      throw new Error("Formula-artifact topology consensus repair duplicated page " + outcome.evidence.pageNumber + ".");
    }
    recoveredPageKeys.add(pageKey);
    const baseCandidate = sourceFormulaArtifactTopologyConsensusBaseCandidate(outcome.envelope.base);
    for (const priorSlot of baseCandidate.activeFormulaSlots) {
      const old = ledger.find((visual) => visual.sourceVisualId === priorSlot.sourceVisualId);
      if (!old || old.type !== "equation" || old.sourceId !== outcome.evidence.sourceId || old.pageNumber !== outcome.evidence.pageNumber) {
        throw new Error("Formula-artifact topology consensus repair prior active-slot identity does not match ledger " + priorSlot.sourceVisualId + ".");
      }
    }
    const slots = sourceFormulaArtifactTopologyConsensusRepairExpectedPageSlots(outcome.candidate);
    if (slots.length !== outcome.candidate.detections.length) {
      throw new Error("Formula-artifact topology consensus repair does not describe one complete page projection.");
    }
    for (const slot of slots) {
      if (!slot.detection.bbox) {
        throw new Error("Formula-artifact topology consensus repair visual detection has no bbox.");
      }
      const crop = cropPng(outcome.evidence.pageImage, expandedCropBBox(slot.detection.bbox, slot.detection.type));
      if (!crop?.length) {
        throw new Error("Formula-artifact topology consensus repair visual crop could not be derived.");
      }
      const cropSha256 = sha256(crop);
      const croppedImagePath = slot.detection.type === "equation"
        ? sourceFormulaReviewedCropUrl(gardenSlug, slot.sourceVisualId, cropSha256)
        : sourceFormulaArtifactRecoveryVisualCropUrl(gardenSlug, slot.sourceVisualId, cropSha256);
      if (slot.activeSlot) {
        if (slot.activeSlot.equationCropSha256 !== cropSha256 || consensusRepairById.has(slot.sourceVisualId)) {
          throw new Error("Formula-artifact topology consensus repair active formula crop projection is inconsistent.");
        }
        consensusRepairById.set(slot.sourceVisualId, {
          envelope: outcome.envelope,
          candidate: outcome.candidate,
          slot: slot.activeSlot,
          topologyReview: outcome.topologyReview,
        });
      } else {
        recoveryVisualCrops.push({ sourceVisualId: slot.sourceVisualId, crop, croppedImagePath });
      }
      recoveredPageVisuals.push({
        sourceVisualId: slot.sourceVisualId,
        sourceId: outcome.evidence.sourceId,
        pageNumber: outcome.evidence.pageNumber,
        type: slot.detection.type,
        caption: slot.activeSlot?.caption ?? slot.detection.caption,
        ...((slot.activeSlot?.exactText ?? slot.detection.exactText) ? {
          exactText: slot.activeSlot?.exactText ?? slot.detection.exactText,
        } : {}),
        pageImagePath: outcome.evidence.pageImagePath,
        bbox: { ...slot.detection.bbox },
        croppedImagePath,
        usageStatus: "unused",
      });
    }
  }
  const next = [
    ...ledger.filter((visual) => !recoveredPageKeys.has(visual.sourceId + "\u0000" + visual.pageNumber)),
    ...recoveredPageVisuals,
  ].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) ||
    left.pageNumber - right.pageNumber ||
    left.sourceVisualId.localeCompare(right.sourceVisualId),
  );
  return { ledger: next, recoveryVisualCrops, consensusRepairById };
}

function sourceFormulaArtifactTopologyConsensusRepairBaseFromScanCacheForEvidence(
  contentPath: string,
  gardenSlug: string,
  evidence: SourceFormulaReviewPageEvidence,
): SourceFormulaArtifactTopologyConsensusRepairBase | null {
  const candidateRepair = sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanCacheForPageEvidence(
    contentPath,
    gardenSlug,
    evidence,
  );
  const candidateFinal = candidateRepair
    ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(candidateRepair)
    : null;
  if (
    candidateRepair &&
    candidateFinal &&
    candidateFinal.topologyReview?.status === "confirmed"
  ) {
    return {
      protocol: "v6",
      candidateRepair,
      terminalCandidateCacheKey: candidateFinal.candidate.cacheKey,
      terminalCandidateIntegritySha256: candidateFinal.candidate.integritySha256,
      terminalTopologyReviewCacheKey: candidateFinal.topologyReview.cacheKey,
      terminalTopologyReviewCacheIntegritySha256: candidateFinal.topologyReview.integritySha256,
    };
  }
  const recovery = sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanCacheForPageEvidence(
    contentPath,
    gardenSlug,
    evidence,
  );
  if (!recovery) return null;
  const topologyReview = sourceFormulaArtifactTopologyReviewFromScanCacheForEvidence(
    contentPath,
    gardenSlug,
    evidence,
    recovery,
  );
  if (!topologyReview || topologyReview.status !== "confirmed") return null;
  return { protocol: "v5", recovery, topologyReview };
}

async function recoverRejectedSourceFormulaPages(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  cacheRoot: string,
  cacheWriteState: SourceFormulaExternalCacheWriteState,
  pages: readonly SourceFormulaReviewRejectedPage[],
): Promise<{ outcomes: SourceFormulaArtifactRecoveryPageOutcome[]; modelCalls: number }> {
  if (pages.length === 0 || pages.length > SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_PAGE_BATCHES) {
    throw new Error(
      "Formula-artifact recovery supports 1-" +
        SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_PAGE_BATCHES + " rejected page batches per review call.",
    );
  }
  const settled = await Promise.allSettled(pages.map(async (page) => {
    const inputs = sourceFormulaArtifactRecoveryInputs(page);
    const cached = loadSourceFormulaArtifactRecoveryCache(
      cacheRoot,
      page.evidence,
      options.model,
      page.failedReview,
      inputs,
    );
    if (cached) return { evidence: page.evidence, envelope: cached, cacheHit: true };
    const envelope = await requestSourceFormulaArtifactRecovery(
      options,
      page.evidence,
      page.failedReview,
      inputs,
    );
    return { evidence: page.evidence, envelope, cacheHit: false };
  }));
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected) throw rejected.reason;
  const outcomes = settled.map((result) =>
    (result as PromiseFulfilledResult<SourceFormulaArtifactRecoveryPageOutcome>).value,
  );
  for (const outcome of outcomes) {
    if (!outcome.cacheHit) {
      saveSourceFormulaArtifactRecoveryCache(
        cacheRoot,
        outcome.evidence,
        outcome.envelope,
        cacheWriteState,
      );
    }
  }
  // A single cache-file write occurs only after every page recovery is valid.
  // It intentionally survives a later review failure; the ledger does not.
  persistSourceFormulaArtifactRecoveryScanCache(
    options.contentPath,
    options.gardenSlug,
    outcomes,
  );
  return {
    outcomes,
    modelCalls: outcomes
      .filter((outcome) => !outcome.cacheHit)
      .reduce((count, outcome) => count + outcome.envelope.semanticAttempt, 0),
  };
}

/**
 * Advance (or resume) the V6 state machine rooted in one signed rejected V5
 * C1/R1 pair.  A signed semantic rejection is feedback for a fresh model
 * candidate, while only an unsigned transport/protocol failure leaves the
 * final candidate pending for a review-only retry.  Every state is persisted
 * before the next remote call, so rollback cannot lose the cap/history.
 */
async function advanceSourceFormulaArtifactTopologyCandidateRepair(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  initialRecovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  initialTopologyReview: SourceFormulaArtifactTopologyReviewEnvelope,
  existing?: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope,
): Promise<{
  outcome: SourceFormulaArtifactTopologyCandidateRepairPageOutcome;
  modelCalls: number;
}> {
  if (initialTopologyReview.status !== "rejected") {
    throw new Error("Formula-artifact topology candidate repair requires a signed rejected initial topology review.");
  }
  if (existing && !sourceFormulaArtifactTopologyCandidateRepairEnvelopeMatches(existing, evidence)) {
    throw new Error("Formula-artifact topology candidate repair cache history is invalid for the current source evidence.");
  }
  if (
    existing &&
    (
      existing.initialRecovery.cacheKey !== initialRecovery.cacheKey ||
      existing.initialRecovery.integritySha256 !== initialRecovery.integritySha256 ||
      existing.initialTopologyReview.cacheKey !== initialTopologyReview.cacheKey ||
      existing.initialTopologyReview.integritySha256 !== initialTopologyReview.integritySha256
    )
  ) {
    throw new Error("Formula-artifact topology candidate repair history is rooted in different V5 receipts.");
  }
  const authorModel = existing?.model ?? options.model;
  const authorOptions = authorModel === options.model ? options : { ...options, model: authorModel };
  const startedAt = existing?.startedAt ?? (options.now?.() ?? new Date().toISOString());
  let entries = existing
    ? existing.candidates.map((entry) => ({
      candidate: entry.candidate,
      ...(entry.topologyReview ? { topologyReview: entry.topologyReview } : {}),
    }))
    : [] as SourceFormulaArtifactTopologyCandidateRepairHistoryEntry[];
  let envelope = existing;
  let modelCalls = 0;
  let cacheHit = Boolean(existing);
  const persist = (): SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope => {
    const next = sourceFormulaArtifactTopologyCandidateRepairEnvelope(
      evidence,
      initialRecovery,
      initialTopologyReview,
      authorModel,
      entries,
      startedAt,
      options.now?.() ?? new Date().toISOString(),
    );
    persistSourceFormulaArtifactTopologyCandidateRepair(
      options.contentPath,
      options.gardenSlug,
      evidence,
      next,
    );
    envelope = next;
    return next;
  };
  while (true) {
    options.checkCancelled?.();
    const finalEntry = entries[entries.length - 1];
    if (finalEntry?.topologyReview?.status === "confirmed") {
      if (!envelope) envelope = persist();
      return {
        outcome: {
          evidence,
          envelope,
          candidate: finalEntry.candidate,
          topologyReview: finalEntry.topologyReview,
          cacheHit,
        },
        modelCalls,
      };
    }
    if (!finalEntry || finalEntry.topologyReview?.status === "rejected") {
      if (finalEntry && finalEntry.candidate.candidateOrdinal >= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES) {
        throw new Error(
          "Formula-artifact topology candidate repair exhausted " +
            SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_MAX_CANDIDATES +
            " total model-authored candidates for " + evidence.sourceId + " p." + evidence.pageNumber +
            "; final independent review rejected the last candidate and ledger projection was not attempted.",
        );
      }
      const priorCandidate: SourceFormulaArtifactTopologyRepairPriorCandidate = finalEntry
        ? finalEntry.candidate
        : initialRecovery;
      const priorTopologyReview = finalEntry?.topologyReview ?? initialTopologyReview;
      if (priorTopologyReview.status !== "rejected") {
        throw new Error("Formula-artifact topology candidate repair cannot author a successor without rejected feedback.");
      }
      const candidateOrdinal = finalEntry ? finalEntry.candidate.candidateOrdinal + 1 : 2;
      const candidate = await requestSourceFormulaArtifactTopologyCandidateRepairCandidate(
        authorOptions,
        evidence,
        initialRecovery,
        initialTopologyReview,
        priorCandidate,
        priorTopologyReview,
        candidateOrdinal,
      );
      modelCalls += candidate.semanticAttempt;
      entries = [...entries, { candidate }];
      cacheHit = false;
      persist();
      // A candidate is durable before its independent review. If the review
      // request fails, this exact candidate is re-used on the next call.
      continue;
    }
    if (!finalEntry.topologyReview) {
      const topologyReview = await requestSourceFormulaArtifactTopologyReview(
        options,
        evidence,
        finalEntry.candidate,
      );
      modelCalls += topologyReview.semanticAttempt;
      entries = [
        ...entries.slice(0, -1),
        { candidate: finalEntry.candidate, topologyReview },
      ];
      cacheHit = false;
      persist();
      continue;
    }
    throw new Error("Formula-artifact topology candidate repair entered an unsupported history state.");
  }
}

/**
 * Advance V7 from a confirmed V5/V6 base plus a signed normal-review
 * disagreement.  The terminal success condition here is only independent
 * topology confirmation; the caller must still run the ordinary reviewer on
 * the exact final candidate before it may publish a ledger projection.
 */
async function advanceSourceFormulaArtifactTopologyConsensusRepair(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  evidence: SourceFormulaReviewPageEvidence,
  base: SourceFormulaArtifactTopologyConsensusRepairBase,
  triggerFormulaReview: SourceFormulaArtifactTopologyConsensusFormulaFeedback,
  existing?: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
): Promise<{
  outcome: SourceFormulaArtifactTopologyConsensusRepairPageOutcome;
  modelCalls: number;
}> {
  if (!sourceFormulaArtifactTopologyConsensusBaseMatches(base, evidence)) {
    throw new Error("Formula-artifact topology consensus repair requires a signed current-evidence confirmed V5/V6 base.");
  }
  if (!sourceFormulaArtifactTopologyConsensusFormulaFeedbackMatches(
    triggerFormulaReview,
    evidence,
    sourceFormulaArtifactTopologyConsensusBaseCandidate(base),
  )) {
    throw new Error("Formula-artifact topology consensus repair requires a signed topology-change normal-review rejection over the confirmed candidate.");
  }
  if (existing && !sourceFormulaArtifactTopologyConsensusRepairEnvelopeMatches(existing, evidence)) {
    throw new Error("Formula-artifact topology consensus repair cache history is invalid for the current source evidence.");
  }
  if (
    existing &&
    (
      JSON.stringify(existing.base) !== JSON.stringify(base) ||
      JSON.stringify(existing.triggerFormulaReview) !== JSON.stringify(triggerFormulaReview)
    )
  ) {
    throw new Error("Formula-artifact topology consensus repair history is rooted in different confirmed/rejected receipts.");
  }
  const authorModel = existing?.model ?? options.model;
  const authorOptions = authorModel === options.model ? options : { ...options, model: authorModel };
  const startedAt = existing?.startedAt ?? (options.now?.() ?? new Date().toISOString());
  let entries = existing
    ? existing.candidates.map((entry) => ({
      candidate: entry.candidate,
      ...(entry.topologyReview ? { topologyReview: entry.topologyReview } : {}),
      ...(entry.formulaReviewFeedback ? { formulaReviewFeedback: entry.formulaReviewFeedback } : {}),
      ...(entry.emptyInventoryFormulaReview ? {
        emptyInventoryFormulaReview: entry.emptyInventoryFormulaReview,
      } : {}),
    }))
    : [] as SourceFormulaArtifactTopologyConsensusRepairHistoryEntry[];
  let envelope = existing;
  let modelCalls = 0;
  let cacheHit = Boolean(existing);
  const persist = (): SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope => {
    const next = sourceFormulaArtifactTopologyConsensusRepairEnvelope(
      evidence,
      base,
      triggerFormulaReview,
      authorModel,
      entries,
      startedAt,
      options.now?.() ?? new Date().toISOString(),
    );
    persistSourceFormulaArtifactTopologyConsensusRepair(
      options.contentPath,
      options.gardenSlug,
      evidence,
      next,
    );
    envelope = next;
    return next;
  };
  // Persist the authorization and cap before C2.  A transport/protocol error
  // can retry only the missing model operation; it cannot reopen V5/V6.
  if (!envelope) persist();
  while (true) {
    options.checkCancelled?.();
    const finalEntry = entries[entries.length - 1];
    const emptyInventoryReview = finalEntry?.emptyInventoryFormulaReview;
    if (
      finalEntry?.topologyReview?.status === "confirmed" &&
      !finalEntry.formulaReviewFeedback &&
      (
        finalEntry.candidate.activeFormulaSlots.length > 0 ||
        !emptyInventoryReview ||
        emptyInventoryReview.status === "confirmed"
      )
    ) {
      if (!envelope) envelope = persist();
      return {
        outcome: {
          evidence,
          envelope,
          candidate: finalEntry.candidate,
          topologyReview: finalEntry.topologyReview,
          cacheHit,
        },
        modelCalls,
      };
    }
    if (
      !finalEntry ||
      finalEntry.topologyReview?.status === "rejected" ||
      finalEntry.formulaReviewFeedback ||
      emptyInventoryReview?.status === "rejected"
    ) {
      const priorCandidate = finalEntry?.candidate ?? sourceFormulaArtifactTopologyConsensusBaseCandidate(base);
      const priorCandidateOrdinal = finalEntry?.candidate.candidateOrdinal ??
        sourceFormulaArtifactTopologyConsensusBaseCandidateOrdinal(base);
      const priorFeedback: SourceFormulaArtifactTopologyConsensusRepairFeedback = finalEntry?.topologyReview?.status === "rejected"
        ? { kind: "topology_review", topologyReview: finalEntry.topologyReview }
        : finalEntry?.formulaReviewFeedback
          ? { kind: "formula_review", formulaReview: finalEntry.formulaReviewFeedback }
          : emptyInventoryReview?.status === "rejected"
            ? { kind: "empty_inventory_review", emptyInventoryReview }
          : { kind: "formula_review", formulaReview: triggerFormulaReview };
      if (priorCandidateOrdinal >= SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES) {
        throw new Error(
          "Formula-artifact topology consensus repair exhausted " +
            SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_MAX_CANDIDATES +
            " total model-authored candidates for " + evidence.sourceId + " p." + evidence.pageNumber +
            "; final reviewer disagreement remains durable and ledger projection was not attempted.",
        );
      }
      const candidateOrdinal = priorCandidateOrdinal + 1;
      const candidate = await requestSourceFormulaArtifactTopologyConsensusRepairCandidate(
        authorOptions,
        evidence,
        base,
        triggerFormulaReview,
        priorCandidate,
        priorFeedback,
        candidateOrdinal,
      );
      modelCalls += candidate.semanticAttempt;
      entries = [...entries, { candidate }];
      cacheHit = false;
      persist();
      continue;
    }
    if (!finalEntry.topologyReview) {
      const topologyReview = await requestSourceFormulaArtifactTopologyReview(
        options,
        evidence,
        finalEntry.candidate,
      );
      modelCalls += topologyReview.semanticAttempt;
      entries = [
        ...entries.slice(0, -1),
        { candidate: finalEntry.candidate, topologyReview },
      ];
      cacheHit = false;
      persist();
      continue;
    }
    throw new Error("Formula-artifact topology consensus repair entered an unsupported history state.");
  }
}

/** Record a signed normal-review rejection after R[n] confirmed C[n], then
 * resume V7. The raw response is retained byte-for-byte and becomes the only
 * semantic feedback for the next author call. */
async function recordSourceFormulaArtifactTopologyConsensusRepairFormulaFeedback(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  page: SourceFormulaReviewRejectedPage,
  existing: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope,
): Promise<{
  outcome: SourceFormulaArtifactTopologyConsensusRepairPageOutcome;
  modelCalls: number;
}> {
  if (!sourceFormulaArtifactTopologyConsensusRepairEnvelopeMatches(existing, page.evidence)) {
    throw new Error("Formula-artifact topology consensus repair cannot append feedback to invalid current-evidence history.");
  }
  const finalEntry = sourceFormulaArtifactTopologyConsensusRepairFinalEntry(existing);
  if (
    !finalEntry ||
    !finalEntry.topologyReview ||
    finalEntry.topologyReview.status !== "confirmed" ||
    finalEntry.formulaReviewFeedback ||
    finalEntry.emptyInventoryFormulaReview
  ) {
    throw new Error("Formula-artifact topology consensus repair cannot append ordinary-review feedback to a non-confirmed candidate.");
  }
  const feedback = sourceFormulaArtifactTopologyConsensusFormulaFeedbackFromRejectedPage(
    page,
    finalEntry.candidate,
  );
  const entries = existing.candidates.map((entry, index) => index === existing.candidates.length - 1
    ? { candidate: entry.candidate, topologyReview: entry.topologyReview, formulaReviewFeedback: feedback }
    : entry,
  );
  const updated = sourceFormulaArtifactTopologyConsensusRepairEnvelope(
    page.evidence,
    existing.base,
    existing.triggerFormulaReview,
    existing.model,
    entries,
    existing.startedAt,
    options.now?.() ?? new Date().toISOString(),
  );
  persistSourceFormulaArtifactTopologyConsensusRepair(
    options.contentPath,
    options.gardenSlug,
    page.evidence,
    updated,
  );
  return advanceSourceFormulaArtifactTopologyConsensusRepair(
    options,
    page.evidence,
    updated.base,
    updated.triggerFormulaReview,
    updated,
  );
}

/**
 * Resolve the ordinary page-level review for a zero-active V7 candidate. Its
 * response is a signed model decision, not an implicit empty-array approval:
 * a rejection becomes the exact raw feedback for C[n+1], while confirmation
 * is required before the all-retired page can be projected.
 */
async function resolveSourceFormulaArtifactTopologyConsensusEmptyInventoryReview(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  outcome: SourceFormulaArtifactTopologyConsensusRepairPageOutcome,
): Promise<{
  outcome: SourceFormulaArtifactTopologyConsensusRepairPageOutcome;
  modelCalls: number;
}> {
  let current = outcome;
  let modelCalls = 0;
  while (true) {
    const finalEntry = sourceFormulaArtifactTopologyConsensusRepairFinalEntry(current.envelope);
    if (!finalEntry) {
      throw new Error("Formula-artifact topology consensus repair has no terminal candidate to review.");
    }
    if (finalEntry.candidate.activeFormulaSlots.length > 0) {
      return { outcome: current, modelCalls };
    }
    if (
      !finalEntry.topologyReview ||
      finalEntry.topologyReview.status !== "confirmed" ||
      finalEntry.formulaReviewFeedback
    ) {
      throw new Error("Formula-artifact topology consensus repair cannot request an empty-inventory ordinary review before topology confirmation.");
    }
    if (finalEntry.emptyInventoryFormulaReview?.status === "confirmed") {
      if (!sourceFormulaArtifactTopologyConsensusRepairIsProjectionConfirmed(current.envelope)) {
        throw new Error("Formula-artifact topology consensus repair has an invalid empty-inventory ordinary-review confirmation.");
      }
      return { outcome: current, modelCalls };
    }
    if (finalEntry.emptyInventoryFormulaReview?.status === "rejected") {
      const advanced = await advanceSourceFormulaArtifactTopologyConsensusRepair(
        options,
        current.evidence,
        current.envelope.base,
        current.envelope.triggerFormulaReview,
        current.envelope,
      );
      current = advanced.outcome;
      modelCalls += advanced.modelCalls;
      continue;
    }
    const review = await requestSourceFormulaArtifactTopologyEmptyInventoryReview(
      options,
      current.evidence,
      finalEntry.candidate,
    );
    modelCalls += review.semanticAttempt;
    const entries = current.envelope.candidates.map((entry, index) => index === current.envelope.candidates.length - 1
      ? {
        candidate: entry.candidate,
        topologyReview: entry.topologyReview,
        emptyInventoryFormulaReview: review,
      }
      : entry,
    );
    const updated = sourceFormulaArtifactTopologyConsensusRepairEnvelope(
      current.evidence,
      current.envelope.base,
      current.envelope.triggerFormulaReview,
      current.envelope.model,
      entries,
      current.envelope.startedAt,
      options.now?.() ?? new Date().toISOString(),
    );
    persistSourceFormulaArtifactTopologyConsensusRepair(
      options.contentPath,
      options.gardenSlug,
      current.evidence,
      updated,
    );
    current = { ...current, envelope: updated };
  }
}

/**
 * The V5 path is deliberately not an extension of V4: it accepts only pages
 * whose first reviewer explicitly identified a formula-topology change, asks
 * a second model pass to confirm the immutable graph, and persists no ledger
 * mutation until both model receipts are valid.  The durable scan-cache entry
 * is the evidence-level cap; an accepted entry may be reused after a staging
 * rollback without calling either recovery model again.
 */
async function recoverRejectedSourceFormulaTopologyPages(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  pages: readonly SourceFormulaReviewRejectedPage[],
): Promise<{
  outcomes: SourceFormulaArtifactTopologyRecoveryPageOutcome[];
  candidateRepairOutcomes: SourceFormulaArtifactTopologyCandidateRepairPageOutcome[];
  modelCalls: number;
}> {
  if (
    pages.length === 0 ||
    pages.length > SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_PAGE_BATCHES ||
    pages.some((page) =>
      page.rejections.length === 0 ||
      page.rejections.some((rejection) =>
        rejection.identityAssessment !== "identity_mismatch",
      ) ||
      !page.rejections.some((rejection) => rejection.topologyAssessment === "topology_change"),
    )
  ) {
    throw new Error("Formula-artifact topology recovery requires identity_mismatch rejections and at least one explicit topology_change per bounded page batch.");
  }

  const outcomes: SourceFormulaArtifactTopologyRecoveryPageOutcome[] = [];
  const candidateRepairOutcomes: SourceFormulaArtifactTopologyCandidateRepairPageOutcome[] = [];
  let modelCalls = 0;
  for (const page of pages) {
    options.checkCancelled?.();
    const rawEntry = loadSourceVisualScanCache(options.contentPath, options.gardenSlug)
      .sources[page.evidence.sourceId]?.[page.evidence.pageImagePath];
    const existingCandidateRepair = sourceFormulaArtifactTopologyCandidateRepairEnvelopeFromScanCacheForPageEvidence(
      options.contentPath,
      options.gardenSlug,
      page.evidence,
    );
    if (existingCandidateRepair) {
      const advanced = await advanceSourceFormulaArtifactTopologyCandidateRepair(
        options,
        page.evidence,
        existingCandidateRepair.initialRecovery,
        existingCandidateRepair.initialTopologyReview,
        existingCandidateRepair,
      );
      candidateRepairOutcomes.push(advanced.outcome);
      modelCalls += advanced.modelCalls;
      continue;
    }

    if (
      rawEntry?.formulaArtifactTopologyCandidateRepair &&
      sourceFormulaArtifactTopologyCandidateRepairHasCurrentEvidence(
        options.contentPath,
        options.gardenSlug,
        rawEntry.formulaArtifactTopologyCandidateRepair,
        page.evidence.pageImageSha256,
      )
    ) {
      throw new Error(
        "Formula-artifact topology candidate repair has malformed current-evidence history; refusing to overwrite its durable cap.",
      );
    }

    const relaxedRecovery = sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanCacheForPageEvidence(
      options.contentPath,
      options.gardenSlug,
      page.evidence,
    );
    let recovery = sourceFormulaArtifactTopologyRecoveryEnvelopeFromScanCacheForEvidence(
      options.contentPath,
      options.gardenSlug,
      page.evidence,
    );
    if (!recovery && relaxedRecovery) {
      // The current normal-review inputs may legitimately differ from the
      // original old slots after a failed staging rollback or a prior
      // topology projection. A signed V5 C1 must never be re-authored for
      // that same evidence, but its independently rejected R1 is exactly the
      // bounded V6 entry condition: C2 is a fresh whole-page model candidate
      // authored from immutable C1/R1 receipts. Confirmed, absent, or invalid
      // R1 remains a hard cap rather than silently reopening V5.
      const priorTopologyReview = sourceFormulaArtifactTopologyReviewFromScanCacheForEvidence(
        options.contentPath,
        options.gardenSlug,
        page.evidence,
        relaxedRecovery,
      );
      if (priorTopologyReview?.status === "rejected") {
        const advanced = await advanceSourceFormulaArtifactTopologyCandidateRepair(
          options,
          page.evidence,
          relaxedRecovery,
          priorTopologyReview,
        );
        candidateRepairOutcomes.push(advanced.outcome);
        modelCalls += advanced.modelCalls;
        continue;
      }
      throw new Error(
        "Formula-artifact topology recovery was already attempted for this unchanged PDF page evidence; refusing a second recovery cycle.",
      );
    }
    if (
      !recovery &&
      rawEntry?.formulaArtifactTopologyRecovery &&
      sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
        options.contentPath,
        options.gardenSlug,
        rawEntry.formulaArtifactTopologyRecovery,
        page.evidence.pageImageSha256,
      )
    ) {
      throw new Error(
        "Formula-artifact topology recovery has malformed current-evidence receipt; refusing to overwrite its durable cap.",
      );
    }
    let recoveryCacheHit = Boolean(recovery);
    if (!recovery) {
      const inputs = sourceFormulaArtifactRecoveryInputs(page);
      recovery = await requestSourceFormulaArtifactTopologyRecovery(
        options,
        page.evidence,
        page.failedReview,
        inputs,
      );
      modelCalls += recovery.semanticAttempt;
      // Persist C1 before R1. If R1 transport/protocol fails, retry only R1
      // on the same model-authored whole-page inventory.
      persistSourceFormulaArtifactTopologyRecoveryScanCache(
        options.contentPath,
        options.gardenSlug,
        [{ evidence: page.evidence, envelope: recovery, cacheHit: false }],
      );
      recoveryCacheHit = false;
    }
    let topologyReview = sourceFormulaArtifactTopologyReviewFromScanCacheForEvidence(
      options.contentPath,
      options.gardenSlug,
      page.evidence,
      recovery,
    );
    if (!topologyReview) {
      topologyReview = await requestSourceFormulaArtifactTopologyReview(
        options,
        page.evidence,
        recovery,
      );
      modelCalls += topologyReview.semanticAttempt;
      persistSourceFormulaArtifactTopologyReview(
        options.contentPath,
        options.gardenSlug,
        page.evidence,
        recovery,
        topologyReview,
      );
      recoveryCacheHit = false;
    }
    if (topologyReview.status === "confirmed") {
      outcomes.push({
        evidence: page.evidence,
        envelope: recovery,
        topologyReview,
        cacheHit: recoveryCacheHit,
      });
      continue;
    }
    // A valid V5 independent rejection is not a protocol failure and must
    // never be locally repaired. It becomes byte-for-byte feedback for V6 C2.
    const advanced = await advanceSourceFormulaArtifactTopologyCandidateRepair(
      options,
      page.evidence,
      recovery,
      topologyReview,
    );
    candidateRepairOutcomes.push(advanced.outcome);
    modelCalls += advanced.modelCalls;
  }
  return {
    outcomes: outcomes.sort((left, right) =>
      left.evidence.sourceId.localeCompare(right.evidence.sourceId) ||
      left.evidence.pageNumber - right.evidence.pageNumber,
    ),
    candidateRepairOutcomes: candidateRepairOutcomes.sort((left, right) =>
      left.evidence.sourceId.localeCompare(right.evidence.sourceId) ||
      left.evidence.pageNumber - right.evidence.pageNumber,
    ),
    modelCalls,
  };
}

async function requestSourceFormulaReviewPages(
  options: ReviewRequiredSourceFormulaExactTextOptions,
  pages: readonly SourceFormulaReviewPageEvidence[],
  cacheRoot: string,
  cacheWriteState: SourceFormulaExternalCacheWriteState,
  visualById: ReadonlyMap<string, SourceVisual>,
): Promise<{ outcomes: SourceFormulaReviewPageOutcome[]; modelCalls: number }> {
  const outcomes: SourceFormulaReviewPageOutcome[] = [];
  let modelCalls = 0;
  for (let offset = 0; offset < pages.length; offset += SOURCE_FORMULA_REVIEW_MAX_CONCURRENCY) {
    options.checkCancelled?.();
    const chunk = pages.slice(offset, offset + SOURCE_FORMULA_REVIEW_MAX_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map(async (evidence) => {
      const direct = loadSourceFormulaReviewCache(cacheRoot, evidence, options.model, evidence.inputs);
      const linked = direct ?? linkedSourceFormulaReviewEnvelope(
        options.contentPath,
        options.gardenSlug,
        cacheRoot,
        evidence,
        options.model,
        visualById,
      );
      if (linked) return { envelope: linked, evidence, cacheHit: true };
      const envelope = await requestSourceFormulaPageReview(options, evidence);
      return { envelope, evidence, cacheHit: false };
    }));
    for (const result of settled) {
      if (result.status === "fulfilled" && !result.value.cacheHit) {
        modelCalls += result.value.envelope.semanticAttempt;
        // Accepted external cache entries are inert. They deliberately survive
        // a rejected sibling page so Retry does not repeat proven review work.
        saveSourceFormulaReviewCache(
          cacheRoot,
          result.value.evidence,
          result.value.envelope,
          cacheWriteState,
        );
      } else if (result.status === "rejected" && result.reason instanceof SourceFormulaReviewRejectedError) {
        modelCalls += result.reason.modelCalls;
      }
    }
    const unexpected = settled.find((result): result is PromiseRejectedResult =>
      result.status === "rejected" && !(result.reason instanceof SourceFormulaReviewRejectedError),
    );
    if (unexpected) throw unexpected.reason;
    const pageRejections = settled
      .filter((result): result is PromiseRejectedResult =>
        result.status === "rejected" && result.reason instanceof SourceFormulaReviewRejectedError,
      )
      .flatMap((result) => sourceFormulaReviewRejectedPageDetails(result.reason));
    if (pageRejections.length > 0) {
      throw new SourceFormulaReviewRejectedError(pageRejections, modelCalls);
    }
    outcomes.push(...settled.map((result) =>
      (result as PromiseFulfilledResult<SourceFormulaReviewPageOutcome>).value,
    ));
  }
  return { outcomes, modelCalls };
}

function sourceFormulaReviewStableRecord(visual: SourceVisual): Record<string, unknown> {
  const review = visual.formulaReview;
  if (!review || visual.type !== "equation" || !visual.exactText?.trim()) {
    throw new Error(`Source formula ${visual.sourceVisualId} has no accepted review provenance.`);
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

function normalizedSourceFormulaTopologyReviewPageReceipts(
  value: unknown,
): SourceFormulaTopologyReviewPageReceipt[] {
  if (!Array.isArray(value)) {
    throw new Error("Source formula review topologyReviewPageReceipts must be an array.");
  }
  const hashPattern = /^[0-9a-f]{64}$/i;
  const seenPages = new Set<string>();
  const receipts = value.map((item, index): SourceFormulaTopologyReviewPageReceipt => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Source formula topology receipt ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([
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
      throw new Error(`Source formula topology receipt ${index + 1} has unsupported or missing fields.`);
    }
    const sourceId = typeof record.sourceId === "string" ? record.sourceId.trim() : "";
    const recoveryProtocol = record.recoveryProtocol;
    const pageNumber = record.pageNumber;
    const pageImagePath = typeof record.pageImagePath === "string" ? record.pageImagePath.trim() : "";
    const recoveryCacheKey = typeof record.recoveryCacheKey === "string"
      ? record.recoveryCacheKey.trim()
      : "";
    const recoveryCacheIntegritySha256 = typeof record.recoveryCacheIntegritySha256 === "string"
      ? record.recoveryCacheIntegritySha256.trim()
      : "";
    const topologyReviewCacheKey = typeof record.topologyReviewCacheKey === "string"
      ? record.topologyReviewCacheKey.trim()
      : "";
    const topologyReviewCacheIntegritySha256 =
      typeof record.topologyReviewCacheIntegritySha256 === "string"
        ? record.topologyReviewCacheIntegritySha256.trim()
        : "";
    if (
      !sourceId ||
      (recoveryProtocol !== "v5" && recoveryProtocol !== "v6" && recoveryProtocol !== "v7") ||
      !Number.isSafeInteger(pageNumber) ||
      (pageNumber as number) < 1 ||
      !pageImagePath ||
      !isFullPageSnapshotUrl(pageImagePath) ||
      pageNumberFromAssetUrl(pageImagePath) !== pageNumber ||
      !hashPattern.test(recoveryCacheKey) ||
      !hashPattern.test(recoveryCacheIntegritySha256) ||
      !hashPattern.test(topologyReviewCacheKey) ||
      !hashPattern.test(topologyReviewCacheIntegritySha256) ||
      !Array.isArray(record.activeFormulaIds) ||
      record.activeFormulaIds.some((formulaId) => typeof formulaId !== "string")
    ) {
      throw new Error(`Source formula topology receipt ${index + 1} is structurally invalid.`);
    }
    const activeFormulaIds = record.activeFormulaIds.map((formulaId) => (formulaId as string).trim());
    if (
      activeFormulaIds.some((formulaId) => {
        const match = /^S\d+\.P(\d+)\.E\d+$/.exec(formulaId);
        return !match || Number.parseInt(match[1]!, 10) !== pageNumber;
      }) ||
      JSON.stringify(activeFormulaIds) !== JSON.stringify([...new Set(activeFormulaIds)].sort())
    ) {
      throw new Error(
        `Source formula topology receipt ${sourceId} p.${pageNumber} activeFormulaIds are invalid.`,
      );
    }
    const pageKey = `${sourceId}\u0000${pageNumber}`;
    if (seenPages.has(pageKey)) {
      throw new Error(`Duplicate source formula topology receipt exists for ${sourceId} p.${pageNumber}.`);
    }
    seenPages.add(pageKey);
    return {
      recoveryProtocol,
      sourceId,
      pageNumber: pageNumber as number,
      pageImagePath,
      recoveryCacheKey,
      recoveryCacheIntegritySha256,
      topologyReviewCacheKey,
      topologyReviewCacheIntegritySha256,
      activeFormulaIds,
    };
  });
  return receipts.sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) ||
    left.pageNumber - right.pageNumber ||
    left.pageImagePath.localeCompare(right.pageImagePath),
  );
}

export function computeSourceFormulaReviewSetHash(
  visuals: readonly SourceVisual[],
  requiredFormulaIds: Iterable<string>,
  selectedSourceIds: readonly string[] = [],
  sourceIdentityMap: readonly SourceVisualSourceIdentity[] = selectedSourceIds.map(
    (sourceId, sourceIndex) => ({ sourceId, sourceIndex: sourceIndex + 1 }),
  ),
  topologyReviewPageReceipts: readonly SourceFormulaTopologyReviewPageReceipt[] = [],
): string {
  const formulaIds = [...new Set([...requiredFormulaIds].map((id) => id.trim()).filter(Boolean))].sort();
  const byId = new Map<string, SourceVisual>();
  const duplicateIds = new Set<string>();
  for (const visual of visuals) {
    if (byId.has(visual.sourceVisualId)) duplicateIds.add(visual.sourceVisualId);
    byId.set(visual.sourceVisualId, visual);
  }
  const relevantDuplicates = formulaIds.filter((formulaId) => duplicateIds.has(formulaId));
  if (relevantDuplicates.length > 0) {
    throw new Error(`Duplicate required source formula ids: ${relevantDuplicates.join(", ")}.`);
  }
  const records = formulaIds.map((formulaId) => {
    const visual = byId.get(formulaId);
    if (!visual) throw new Error(`Required source formula ${formulaId} is missing from the ledger.`);
    return sourceFormulaReviewStableRecord(visual);
  });
  const normalizedTopologyReceipts = normalizedSourceFormulaTopologyReviewPageReceipts(
    topologyReviewPageReceipts,
  );
  const selectedSourceIdSet = new Set(selectedSourceIds);
  const formulaIdSet = new Set(formulaIds);
  for (const receipt of normalizedTopologyReceipts) {
    if (selectedSourceIds.length > 0 && !selectedSourceIdSet.has(receipt.sourceId)) {
      throw new Error(
        `Source formula topology receipt ${receipt.sourceId} p.${receipt.pageNumber} belongs to an unselected source.`,
      );
    }
    const projectedActiveIds = visuals
      .filter((visual) =>
        visual.sourceId === receipt.sourceId &&
        visual.pageNumber === receipt.pageNumber &&
        visual.type === "equation")
      .map((visual) => visual.sourceVisualId)
      .sort();
    if (
      JSON.stringify(projectedActiveIds) !== JSON.stringify(receipt.activeFormulaIds) ||
      receipt.activeFormulaIds.some((formulaId) => !formulaIdSet.has(formulaId))
    ) {
      throw new Error(
        `Source formula topology receipt ${receipt.sourceId} p.${receipt.pageNumber} does not match the active formula inventory.`,
      );
    }
  }
  return sha256(JSON.stringify({
    schemaVersion: SOURCE_FORMULA_REVIEW_SCHEMA_VERSION,
    promptVersion: SOURCE_FORMULA_REVIEW_PROMPT_VERSION,
    topologyReceiptBindingVersion: 2,
    selectedSourceIds,
    sourceIdentityMapHash: sourceVisualSourceIdentityMapHash(sourceIdentityMap),
    formulaIds,
    records,
    topologyReviewPageReceipts: normalizedTopologyReceipts,
  }));
}

export function sourceSetHashWithReviewedFormulas(
  baseSourceSetHash: string,
  reviewSetHash: string,
): string {
  if (!baseSourceSetHash.trim() || !reviewSetHash.trim()) {
    throw new Error("Base source-set hash and reviewed-formula-set hash are both required.");
  }
  return sha256(JSON.stringify({
    schemaVersion: 1,
    baseSourceSetHash,
    sourceFormulaReviewSetHash: reviewSetHash,
  }));
}

export function sourceFormulaReviewSetManifestPath(
  contentPath: string,
  gardenSlug: string,
): string {
  return path.join(contentPath, gardenSlug, SOURCE_FORMULA_REVIEW_MANIFEST_RELATIVE_PATH);
}

export function loadSourceFormulaReviewSetManifest(
  contentPath: string,
  gardenSlug: string,
): SourceFormulaReviewSetManifest | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(sourceFormulaReviewSetManifestPath(contentPath, gardenSlug), "utf-8"),
    ) as SourceFormulaReviewSetManifest;
    const normalizedTopologyReceipts = normalizedSourceFormulaTopologyReviewPageReceipts(
      parsed?.topologyReviewPageReceipts,
    );
    if (
      parsed?.schemaVersion !== SOURCE_FORMULA_REVIEW_SCHEMA_VERSION ||
      parsed.promptVersion !== SOURCE_FORMULA_REVIEW_PROMPT_VERSION ||
      typeof parsed.model !== "string" ||
      !Array.isArray(parsed.sourceIds) ||
      !Array.isArray(parsed.sourceIdentityMap) ||
      typeof parsed.sourceIdentityMapHash !== "string" ||
      !Array.isArray(parsed.formulaIds) ||
      parsed.sourceIds.some((sourceId) => typeof sourceId !== "string" || !sourceId.trim()) ||
      new Set(parsed.sourceIds).size !== parsed.sourceIds.length ||
      sourceVisualSourceIdentityMapHash(parsed.sourceIdentityMap) !== parsed.sourceIdentityMapHash ||
      parsed.formulaIds.some((formulaId) => typeof formulaId !== "string" || !formulaId.trim()) ||
      JSON.stringify(parsed.formulaIds) !== JSON.stringify([...new Set(parsed.formulaIds)].sort()) ||
      JSON.stringify(parsed.topologyReviewPageReceipts) !== JSON.stringify(normalizedTopologyReceipts) ||
      typeof parsed.reviewSetHash !== "string" ||
      typeof parsed.baseSourceSetHash !== "string" ||
      typeof parsed.combinedSourceSetHash !== "string" ||
      parsed.combinedSourceSetHash !== sourceSetHashWithReviewedFormulas(
        parsed.baseSourceSetHash,
        parsed.reviewSetHash,
      )
    ) return null;
    return { ...parsed, topologyReviewPageReceipts: normalizedTopologyReceipts };
  } catch {
    return null;
  }
}

export function saveSourceFormulaReviewSetManifest(
  contentPath: string,
  gardenSlug: string,
  manifest: SourceFormulaReviewSetManifest,
): void {
  let normalizedTopologyReceipts: SourceFormulaTopologyReviewPageReceipt[];
  try {
    normalizedTopologyReceipts = normalizedSourceFormulaTopologyReviewPageReceipts(
      manifest.topologyReviewPageReceipts,
    );
  } catch {
    throw new Error("Refusing to persist an invalid source-formula review-set manifest.");
  }
  if (
    manifest.schemaVersion !== SOURCE_FORMULA_REVIEW_SCHEMA_VERSION ||
    manifest.promptVersion !== SOURCE_FORMULA_REVIEW_PROMPT_VERSION ||
    manifest.combinedSourceSetHash !== sourceSetHashWithReviewedFormulas(
      manifest.baseSourceSetHash,
      manifest.reviewSetHash,
    ) ||
    manifest.sourceIds.some((sourceId) => !sourceId.trim()) ||
    new Set(manifest.sourceIds).size !== manifest.sourceIds.length ||
    sourceVisualSourceIdentityMapHash(manifest.sourceIdentityMap) !== manifest.sourceIdentityMapHash ||
    JSON.stringify(manifest.formulaIds) !== JSON.stringify([...new Set(manifest.formulaIds)].sort()) ||
    JSON.stringify(manifest.topologyReviewPageReceipts) !== JSON.stringify(normalizedTopologyReceipts)
  ) {
    throw new Error("Refusing to persist an invalid source-formula review-set manifest.");
  }
  const manifestPath = sourceFormulaReviewSetManifestPath(contentPath, gardenSlug);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, "utf-8");
  try {
    fs.renameSync(temporaryPath, manifestPath);
  } catch {
    fs.writeFileSync(manifestPath, serialized, "utf-8");
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup after a Windows replacement.
    }
  }
}

export async function reviewRequiredSourceFormulaExactText(
  options: ReviewRequiredSourceFormulaExactTextOptions,
): Promise<SourceFormulaReviewResult> {
  options.checkCancelled?.();
  const selectedSourceIds = options.selectedSourceIds.map((sourceId) => sourceId.trim());
  if (
    selectedSourceIds.some((sourceId) => !sourceId) ||
    new Set(selectedSourceIds).size !== selectedSourceIds.length
  ) {
    throw new Error("Source formula review requires unique non-empty selected source ids.");
  }
  const selectedSourceIdSet = new Set(selectedSourceIds);
  let ledger = loadSourceVisuals(options.contentPath, options.gardenSlug);
  const sourceIdentityMap = mergeLedgerSourceIdentities(
    normalizedSourceVisualSourceIdentityMap(
      options.sourceIdentityMap ?? selectedSourceIds.map(
        (sourceId, sourceIndex) => ({ sourceId, sourceIndex: sourceIndex + 1 }),
      ),
    ),
    ledger,
  );
  const sourceIdByIndex = new Map(
    sourceIdentityMap.map((entry) => [entry.sourceIndex, entry.sourceId]),
  );
  const indexedSourceIds = new Set(sourceIdentityMap.map((entry) => entry.sourceId));
  const missingSelectedSourceIds = selectedSourceIds.filter(
    (sourceId) => !indexedSourceIds.has(sourceId),
  );
  if (missingSelectedSourceIds.length > 0) {
    throw new Error(
      `Source formula review stable identity map is missing selected source ids: ${missingSelectedSourceIds.join(", ")}.`,
    );
  }
  let formulaIds = [...new Set([...options.requiredFormulaIds].map((id) => id.trim()).filter(Boolean))]
    .sort();
  let visualById = new Map<string, SourceVisual>();
  const duplicateIds = new Set<string>();
  for (const visual of ledger) {
    if (visualById.has(visual.sourceVisualId)) duplicateIds.add(visual.sourceVisualId);
    visualById.set(visual.sourceVisualId, visual);
  }
  const originalVisualById = visualById;
  const relevantDuplicates = formulaIds.filter((formulaId) => duplicateIds.has(formulaId));
  if (relevantDuplicates.length > 0) {
    throw new Error(`Duplicate required source formula ids: ${relevantDuplicates.join(", ")}.`);
  }
  const selectFormulaVisuals = (
    ids: readonly string[],
    byId: ReadonlyMap<string, SourceVisual>,
  ): SourceVisual[] => ids.map((formulaId) => {
    const visual = byId.get(formulaId);
    if (!visual) throw new Error(`Required source formula ${formulaId} is missing from the ledger.`);
    if (visual.type !== "equation") {
      throw new Error(`Required source formula ${formulaId} is registered as ${visual.type}, not equation.`);
    }
    const identityPage = Number.parseInt(/^S\d+\.P(\d+)\.E\d+$/.exec(formulaId)?.[1] ?? "", 10);
    if (identityPage !== visual.pageNumber) {
      throw new Error(
        `Source formula identity ${formulaId} does not encode ledger page ${visual.pageNumber}.`,
      );
    }
    if (pageNumberFromAssetUrl(visual.pageImagePath ?? "") !== visual.pageNumber) {
      throw new Error(
        `Source formula identity ${formulaId} snapshot URL encodes a different page.`,
      );
    }
    const sourceIndex = Number.parseInt(/^S(\d+)\.P\d+\.E\d+$/.exec(formulaId)?.[1] ?? "", 10);
    const expectedSourceId = sourceIdByIndex.get(sourceIndex);
    if (!expectedSourceId || visual.sourceId !== expectedSourceId) {
      throw new Error(
        `Source formula identity ${formulaId} does not match stable source ${expectedSourceId ?? `(missing S${sourceIndex})`}.`,
      );
    }
    if (!selectedSourceIdSet.has(visual.sourceId)) {
      throw new Error(
        `Source formula identity ${formulaId} belongs to unselected source ${visual.sourceId}.`,
      );
    }
    return visual;
  });
  let selected = selectFormulaVisuals(formulaIds, visualById);
  let pages = await sourceFormulaPageEvidence(options, selected);
  pages = pages.map((evidence) =>
    rebindSourceFormulaPageEvidenceFromConfirmedTopologyConsensusRepair(
      options.contentPath,
      options.gardenSlug,
      evidence,
    ) ?? rebindSourceFormulaPageEvidenceFromConfirmedTopologyCandidateRepair(
      options.contentPath,
      options.gardenSlug,
      evidence,
    ) ?? rebindSourceFormulaPageEvidenceFromConfirmedTopologyRecovery(
      options.contentPath,
      options.gardenSlug,
      evidence,
    ) ?? rebindSourceFormulaPageEvidenceFromConfirmedArtifactRecovery(
      options.contentPath,
      options.gardenSlug,
      evidence,
    ) ?? evidence,
  );
  const cacheRoot = options.cacheRoot?.trim() || defaultSourceFormulaReviewCacheRoot();
  const cacheWriteState: SourceFormulaExternalCacheWriteState = {
    reviewDegraded: false,
    artifactRecoveryDegraded: false,
  };
  const outcomes: Array<{
    envelope: SourceFormulaReviewCacheEnvelope;
    evidence: SourceFormulaReviewPageEvidence;
    cacheHit: boolean;
  }> = [];
  let modelCalls = 0;
  let recoveryById = sourceFormulaArtifactRecoveryLineageForEvidence(
    options.contentPath,
    options.gardenSlug,
    pages,
  );
  let topologyRecoveryById = sourceFormulaArtifactTopologyRecoveryLineageForEvidence(
    options.contentPath,
    options.gardenSlug,
    pages,
  );
  let topologyCandidateRepairById = sourceFormulaArtifactTopologyCandidateRepairLineageForEvidence(
    options.contentPath,
    options.gardenSlug,
    pages,
  );
  let topologyConsensusRepairById = sourceFormulaArtifactTopologyConsensusRepairLineageForEvidence(
    options.contentPath,
    options.gardenSlug,
    pages,
  );
  let recoveryVisualCrops: Array<{
    sourceVisualId: string;
    crop: Buffer;
    croppedImagePath: string;
  }> = [];
  // A normal re-review can uncover another unrelated stale page after a
  // prior page has recovered.  Keep every non-equation crop from every
  // accepted in-memory recovery round until the final all-page review
  // succeeds; the final persistence step is intentionally delayed below.
  // A repeated source visual id must be byte-for-byte the same artifact,
  // otherwise two model-authored recovery rounds disagree and we fail closed.
  const recoveryVisualCropById = new Map<string, {
    crop: Buffer;
    croppedImagePath: string;
  }>();
  const accumulateRecoveryVisualCrops = (
    crops: readonly {
      sourceVisualId: string;
      crop: Buffer;
      croppedImagePath: string;
    }[],
  ): void => {
    for (const crop of crops) {
      const existing = recoveryVisualCropById.get(crop.sourceVisualId);
      if (
        existing &&
        (
          existing.croppedImagePath !== crop.croppedImagePath ||
          sha256(existing.crop) !== sha256(crop.crop)
        )
      ) {
        throw new Error(
          "Formula-artifact recovery rounds disagree about a recovered non-formula crop.",
        );
      }
      if (!existing) {
        recoveryVisualCropById.set(crop.sourceVisualId, {
          crop: crop.crop,
          croppedImagePath: crop.croppedImagePath,
        });
      }
    }
    recoveryVisualCrops = [...recoveryVisualCropById.entries()]
      .map(([sourceVisualId, crop]) => ({ sourceVisualId, ...crop }))
      .sort((left, right) => left.sourceVisualId.localeCompare(right.sourceVisualId));
  };
  const recoveryRoundsByEvidence = new Map<string, number>();
  let recoveryDispatchRounds = 0;
  const recoveryEvidenceKey = (evidence: SourceFormulaReviewPageEvidence): string => [
    evidence.sourceId,
    evidence.pageNumber,
    evidence.pageImagePath,
    evidence.pageImageSha256,
    evidence.canonicalPageTextSha256,
    evidence.sourcePdfSha256,
  ].join("\u0000");

  /**
   * Apply only model-authored recovery outcomes to the in-memory candidate
   * ledger, then rebuild the normal-review inputs from those exact model
   * outputs. Nothing here persists the ledger or manifest: a later rejected
   * re-review leaves the application projection unchanged while durable
   * scan-cache receipts remain available for bounded continuation.
   */
  const dispatchStructuredRecovery = async (
    rejectedPages: readonly SourceFormulaReviewRejectedPage[],
    rejectedError: SourceFormulaReviewRejectedError,
  ): Promise<void> => {
    const recoverable =
      rejectedPages.length > 0 &&
      rejectedPages.length <= Math.min(
        SOURCE_FORMULA_ARTIFACT_RECOVERY_MAX_PAGE_BATCHES,
        SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_MAX_PAGE_BATCHES,
      ) &&
      rejectedPages.every((page) =>
        page.rejections.length > 0 &&
        page.rejections.every((review) => review.identityAssessment === "identity_mismatch"),
      );
    if (!recoverable) throw rejectedError;
    const evidenceKeys = rejectedPages.map((page) => recoveryEvidenceKey(page.evidence));
    if (new Set(evidenceKeys).size !== evidenceKeys.length) {
      throw new Error("Source formula recovery/re-review received duplicate page evidence.");
    }
    for (const page of rejectedPages) {
      const rawEntry = loadSourceVisualScanCache(options.contentPath, options.gardenSlug)
        .sources[page.evidence.sourceId]?.[page.evidence.pageImagePath];
      const rawConsensus = rawEntry?.formulaArtifactTopologyConsensusRepair;
      if (
        rawConsensus &&
        sourceFormulaArtifactTopologyConsensusRepairHasCurrentEvidence(
          options.contentPath,
          options.gardenSlug,
          rawConsensus,
          page.evidence.pageImageSha256,
        ) &&
        !sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanCacheForPageEvidence(
          options.contentPath,
          options.gardenSlug,
          page.evidence,
        )
      ) {
        throw new Error(
          "Formula-artifact topology consensus repair has malformed current-evidence history; refusing to overwrite its durable cap.",
        );
      }
    }
    // V7 is a continuation of an already-confirmed page-local topology
    // session. It is not a new-page recovery dispatch and therefore remains
    // eligible when the bounded global budget was consumed by other pages.
    // It still has its own immutable max-three-candidate cap.
    const consensusPages = rejectedPages.filter((page) => {
      if (!page.rejections.some((review) => review.topologyAssessment === "topology_change")) {
        return false;
      }
      return Boolean(
        sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanCacheForPageEvidence(
          options.contentPath,
          options.gardenSlug,
          page.evidence,
        ) || sourceFormulaArtifactTopologyConsensusRepairBaseFromScanCacheForEvidence(
          options.contentPath,
          options.gardenSlug,
          page.evidence,
        ),
      );
    });
    const initialRecoveryPages = rejectedPages.filter((page) => !consensusPages.includes(page));
    if (
      initialRecoveryPages.length > 0 &&
      recoveryDispatchRounds >= SOURCE_FORMULA_REVIEW_MAX_RECOVERY_DISPATCH_ROUNDS
    ) {
      throw rejectedError;
    }
    const initialEvidenceKeys = initialRecoveryPages.map((page) => recoveryEvidenceKey(page.evidence));
    for (const evidenceKey of initialEvidenceKeys) {
      const priorRounds = recoveryRoundsByEvidence.get(evidenceKey) ?? 0;
      if (priorRounds >= SOURCE_FORMULA_REVIEW_MAX_RECOVERY_DISPATCHES_PER_EVIDENCE) {
        throw rejectedError;
      }
    }
    if (initialRecoveryPages.length > 0) recoveryDispatchRounds += 1;
    for (const evidenceKey of initialEvidenceKeys) {
      recoveryRoundsByEvidence.set(evidenceKey, (recoveryRoundsByEvidence.get(evidenceKey) ?? 0) + 1);
    }
    const topologyPages = initialRecoveryPages.filter((page) =>
      page.rejections.some((review) => review.topologyAssessment === "topology_change"),
    );
    const sameSlotPages = initialRecoveryPages.filter((page) =>
      !topologyPages.includes(page),
    );
    if (sameSlotPages.some((page) =>
      sourceFormulaArtifactRecoveryWasAttempted(
        options.contentPath,
        options.gardenSlug,
        page.evidence,
      ),
    )) {
      throw new Error(
        "Formula-artifact recovery was already attempted for this unchanged PDF page evidence; refusing a second recovery cycle.",
      );
    }
    const recovered = sameSlotPages.length > 0
      ? await recoverRejectedSourceFormulaPages(
        options,
        cacheRoot,
        cacheWriteState,
        sameSlotPages,
      )
      : { outcomes: [] as SourceFormulaArtifactRecoveryPageOutcome[], modelCalls: 0 };
    const topologyRecovered = topologyPages.length > 0
      ? await recoverRejectedSourceFormulaTopologyPages(options, topologyPages)
      : {
        outcomes: [] as SourceFormulaArtifactTopologyRecoveryPageOutcome[],
        candidateRepairOutcomes: [] as SourceFormulaArtifactTopologyCandidateRepairPageOutcome[],
        modelCalls: 0,
      };
    const consensusOutcomes: SourceFormulaArtifactTopologyConsensusRepairPageOutcome[] = [];
    let consensusModelCalls = 0;
    for (const page of consensusPages) {
      options.checkCancelled?.();
      const existing = sourceFormulaArtifactTopologyConsensusRepairEnvelopeFromScanCacheForPageEvidence(
        options.contentPath,
        options.gardenSlug,
        page.evidence,
      );
      const existingFinalEntry = existing
        ? sourceFormulaArtifactTopologyConsensusRepairFinalEntry(existing)
        : null;
      const advanced = existing
        ? (
          existingFinalEntry?.formulaReviewFeedback ||
          (
            existingFinalEntry?.topologyReview?.status === "confirmed" &&
            !existingFinalEntry.formulaReviewFeedback &&
            existingFinalEntry.candidate.activeFormulaSlots.length === 0
          )
        )
          // The final signed ordinary-review rejection is already durable.
          // Do not overwrite it with a new response. The same applies to a
          // zero-active C/R pair that survived a transport failure before its
          // required empty-batch normal confirmation: resume that exact
          // durable state rather than turning stale pre-projection rows into
          // a new semantic feedback edge.
          ? await advanceSourceFormulaArtifactTopologyConsensusRepair(
            options,
            page.evidence,
            existing.base,
            existing.triggerFormulaReview,
            existing,
          )
          : await recordSourceFormulaArtifactTopologyConsensusRepairFormulaFeedback(options, page, existing)
        : (() => {
          const base = sourceFormulaArtifactTopologyConsensusRepairBaseFromScanCacheForEvidence(
            options.contentPath,
            options.gardenSlug,
            page.evidence,
          );
          if (!base) throw rejectedError;
          const feedback = sourceFormulaArtifactTopologyConsensusFormulaFeedbackFromRejectedPage(
            page,
            sourceFormulaArtifactTopologyConsensusBaseCandidate(base),
          );
          return advanceSourceFormulaArtifactTopologyConsensusRepair(
            options,
            page.evidence,
            base,
            feedback,
          );
        })();
      const resolved = await advanced;
      // A zero-active V7 candidate has no formula row to carry a normal
      // review. Before applying even its non-formula inventory, obtain and
      // sign an explicit page-level ordinary confirmation/rejection. A
      // rejection becomes raw feedback for the next bounded candidate; this
      // path never infers that an empty inventory is acceptable.
      const terminal = await resolveSourceFormulaArtifactTopologyConsensusEmptyInventoryReview(
        options,
        resolved.outcome,
      );
      consensusOutcomes.push(terminal.outcome);
      consensusModelCalls += resolved.modelCalls + terminal.modelCalls;
    }
    modelCalls += recovered.modelCalls + topologyRecovered.modelCalls + consensusModelCalls;
    const preRecoveryVisualById = visualById;
    const v4Projected = applySourceFormulaArtifactRecoveryToLedger(
      ledger,
      recovered.outcomes,
      options.gardenSlug,
    );
    const v5Projected = applySourceFormulaArtifactTopologyRecoveryToLedger(
      v4Projected.ledger,
      topologyRecovered.outcomes,
      options.gardenSlug,
    );
    const v6Projected = applySourceFormulaArtifactTopologyCandidateRepairToLedger(
      v5Projected.ledger,
      topologyRecovered.candidateRepairOutcomes,
      options.gardenSlug,
    );
    const v7Projected = applySourceFormulaArtifactTopologyConsensusRepairToLedger(
      v6Projected.ledger,
      consensusOutcomes,
      options.gardenSlug,
    );
    ledger = v7Projected.ledger;
    accumulateRecoveryVisualCrops([
      ...v4Projected.recoveryVisualCrops,
      ...v5Projected.recoveryVisualCrops,
      ...v6Projected.recoveryVisualCrops,
      ...v7Projected.recoveryVisualCrops,
    ]);
    // V7 is a replacement page projection rooted in a previously confirmed
    // V5/V6 candidate. Its final row provenance is intentionally mutually
    // exclusive: discard prior page-local lineage maps before attaching the
    // new master, never leave a row claiming two recovery protocols.
    const v7RecoveredPageKeys = new Set(consensusOutcomes.map((outcome) =>
      outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber,
    ));
    const retainsNonV7Page = <T extends { envelope: { sourceId: string; pageNumber: number } }>(
      value: T,
    ): boolean => !v7RecoveredPageKeys.has(value.envelope.sourceId + "\u0000" + value.envelope.pageNumber);
    recoveryById = new Map([
      ...[...recoveryById].filter(([, value]) => retainsNonV7Page(value)),
      ...v4Projected.recoveryById,
    ]);
    topologyRecoveryById = new Map([
      ...[...topologyRecoveryById].filter(([, value]) => retainsNonV7Page(value)),
      ...v5Projected.topologyById,
    ]);
    topologyCandidateRepairById = new Map([
      ...[...topologyCandidateRepairById].filter(([, value]) => retainsNonV7Page(value)),
      ...v6Projected.candidateRepairById,
    ]);
    topologyConsensusRepairById = new Map([
      ...[...topologyConsensusRepairById].filter(([, value]) => retainsNonV7Page(value)),
      ...v7Projected.consensusRepairById,
    ]);
    visualById = new Map(ledger.map((visual) => [visual.sourceVisualId, visual]));
    const recoveryByPage = new Map(recovered.outcomes.map((outcome) => [
      outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber,
      outcome,
    ]));
    const topologyRecoveryByPage = new Map(topologyRecovered.outcomes.map((outcome) => [
      outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber,
      outcome,
    ]));
    const topologyCandidateRepairByPage = new Map(topologyRecovered.candidateRepairOutcomes.map((outcome) => [
      outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber,
      outcome,
    ]));
    const topologyConsensusRepairByPage = new Map(consensusOutcomes.map((outcome) => [
      outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber,
      outcome,
    ]));
    // The re-review consumes exactly the initial fresh PDF page buffers,
    // rebuilt only with model-authored slots/crops. V5 may add, retire, merge,
    // or split formula ids, so recompute active membership from its full-page
    // projection; no stale source id is migrated or silently retained.
    const recoveredPageKeys = new Set([
      ...recovered.outcomes,
      ...topologyRecovered.outcomes,
      ...topologyRecovered.candidateRepairOutcomes,
      ...consensusOutcomes,
    ].map((outcome) => outcome.evidence.sourceId + "\u0000" + outcome.evidence.pageNumber));
    formulaIds = [
      ...formulaIds.filter((formulaId) => {
        const prior = preRecoveryVisualById.get(formulaId) ?? originalVisualById.get(formulaId);
        return !prior || !recoveredPageKeys.has(prior.sourceId + "\u0000" + prior.pageNumber);
      }),
      ...ledger
        .filter((visual) =>
          visual.type === "equation" &&
          selectedSourceIdSet.has(visual.sourceId) &&
          recoveredPageKeys.has(visual.sourceId + "\u0000" + visual.pageNumber),
        )
        .map((visual) => visual.sourceVisualId),
    ].filter((value, index, all) => all.indexOf(value) === index).sort();
    selected = selectFormulaVisuals(formulaIds, visualById);
    const reboundPages = pages.flatMap((evidence) => {
      const recovery = recoveryByPage.get(evidence.sourceId + "\u0000" + evidence.pageNumber);
      if (recovery) return [rebindSourceFormulaPageEvidenceAfterArtifactRecovery(evidence, recovery.envelope)];
      const topologyRecovery = topologyRecoveryByPage.get(
        evidence.sourceId + "\u0000" + evidence.pageNumber,
      );
      const topologyCandidateRepair = topologyCandidateRepairByPage.get(
        evidence.sourceId + "\u0000" + evidence.pageNumber,
      );
      const topologyConsensusRepair = topologyConsensusRepairByPage.get(
        evidence.sourceId + "\u0000" + evidence.pageNumber,
      );
      if (topologyConsensusRepair) {
        const rebound = rebindSourceFormulaPageEvidenceAfterArtifactTopologyConsensusRepair(
          evidence,
          topologyConsensusRepair.candidate,
        );
        return rebound.inputs.length > 0 ? [rebound] : [];
      }
      if (topologyCandidateRepair) {
        const rebound = rebindSourceFormulaPageEvidenceAfterArtifactTopologyCandidateRepair(
          evidence,
          topologyCandidateRepair.candidate,
        );
        return rebound.inputs.length > 0 ? [rebound] : [];
      }
      if (!topologyRecovery) return [evidence];
      const rebound = rebindSourceFormulaPageEvidenceAfterArtifactTopologyRecovery(
        evidence,
        topologyRecovery.envelope,
      );
      return rebound.inputs.length > 0 ? [rebound] : [];
    });
    // Every V5 affected page originated in pages, so a non-empty rebind must
    // account for every newly active id.  This fails closed rather than
    // letting an invented id evade normal formula review.
    const reboundIds = reboundPages.flatMap((page) => page.inputs.map((input) => input.sourceVisualId)).sort();
    if (JSON.stringify(reboundIds) !== JSON.stringify(formulaIds)) {
      throw new Error("Formula-artifact topology recovery active formula ids do not match the re-review evidence.");
    }
    pages = reboundPages;
  };

  // A successful recovery deliberately returns to the ordinary independent
  // formula reviewer. If that reviewer discovers a different page's stale
  // crop, feed its *new raw rejection* through the same bounded dispatcher
  // rather than leaking it as an unhandled post-recovery failure.
  for (;;) {
    try {
      const reviewed = await requestSourceFormulaReviewPages(
        options,
        pages,
        cacheRoot,
        cacheWriteState,
        visualById,
      );
      outcomes.length = 0;
      outcomes.push(...reviewed.outcomes);
      modelCalls += reviewed.modelCalls;
      break;
    } catch (error) {
      if (!(error instanceof SourceFormulaReviewRejectedError)) throw error;
      modelCalls += error.modelCalls;
      const rejectedPages = sourceFormulaReviewRejectedPageDetails(error);
      await dispatchStructuredRecovery(rejectedPages, error);
    }
  }

  const envelopeById = new Map<string, {
    envelope: SourceFormulaReviewCacheEnvelope;
    evidence: SourceFormulaReviewPageEvidence;
    decision: SourceFormulaReviewModelDecision;
    input: SourceFormulaReviewInput;
    cacheHit: boolean;
  }>();
  for (const outcome of outcomes) {
    for (const decision of outcome.envelope.reviews) {
      const input = outcome.envelope.inputVisuals.find((candidate) =>
        candidate.sourceVisualId === decision.sourceVisualId,
      );
      if (!input || envelopeById.has(decision.sourceVisualId)) {
        throw new Error(`Formula-review batch projection is inconsistent for ${decision.sourceVisualId}.`);
      }
      envelopeById.set(decision.sourceVisualId, { ...outcome, decision, input });
    }
  }
  const now = options.now?.() ?? new Date().toISOString();
  const next = ledger.map((visual): SourceVisual => {
    const reviewed = envelopeById.get(visual.sourceVisualId);
    if (!reviewed) return visual;
    const { envelope, evidence, decision, input } = reviewed;
    const artifactRecovery = recoveryById.get(visual.sourceVisualId);
    const artifactTopologyRecovery = topologyRecoveryById.get(visual.sourceVisualId);
    const artifactTopologyCandidateRepair = topologyCandidateRepairById.get(visual.sourceVisualId);
    const artifactTopologyConsensusRepair = topologyConsensusRepairById.get(visual.sourceVisualId);
    if (
      Number(Boolean(artifactRecovery)) +
        Number(Boolean(artifactTopologyRecovery)) +
        Number(Boolean(artifactTopologyCandidateRepair)) +
        Number(Boolean(artifactTopologyConsensusRepair)) > 1
    ) {
      throw new Error("Formula review cannot attach multiple recovery lineages to " + visual.sourceVisualId + ".");
    }
    if (!decision.acceptedExactText || !decision.acceptedCaption) {
      throw new Error(`Accepted formula review for ${visual.sourceVisualId} is incomplete.`);
    }
    if (
      artifactRecovery &&
      (
        !sameSourceVisualBBox(
          visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 },
          artifactRecovery.replacement.bbox,
        ) ||
        input.inputExactText !== artifactRecovery.replacement.exactText ||
        input.inputCaption !== artifactRecovery.replacement.caption
      )
    ) {
      throw new Error(
        "Formula-artifact recovery was not consumed by the re-review for " +
          visual.sourceVisualId + ".",
      );
    }
    if (
      artifactTopologyRecovery &&
      (
        !sameSourceVisualBBox(
          visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 },
          artifactTopologyRecovery.slot.bbox,
        ) ||
        input.inputExactText !== artifactTopologyRecovery.slot.exactText ||
        input.inputCaption !== artifactTopologyRecovery.slot.caption ||
        input.equationCropSha256 !== artifactTopologyRecovery.slot.equationCropSha256 ||
        artifactTopologyRecovery.topologyReview.status !== "confirmed"
      )
    ) {
      throw new Error(
        "Formula-artifact topology recovery was not consumed by the re-review for " +
          visual.sourceVisualId + ".",
      );
    }
    if (
      artifactTopologyCandidateRepair &&
      (
        !sameSourceVisualBBox(
          visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 },
          artifactTopologyCandidateRepair.slot.bbox,
        ) ||
        input.inputExactText !== artifactTopologyCandidateRepair.slot.exactText ||
        input.inputCaption !== artifactTopologyCandidateRepair.slot.caption ||
        input.equationCropSha256 !== artifactTopologyCandidateRepair.slot.equationCropSha256 ||
        artifactTopologyCandidateRepair.topologyReview.status !== "confirmed"
      )
    ) {
      throw new Error(
        "Formula-artifact topology candidate repair was not consumed by the re-review for " +
          visual.sourceVisualId + ".",
      );
    }
    if (
      artifactTopologyConsensusRepair &&
      (
        !sameSourceVisualBBox(
          visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 },
          artifactTopologyConsensusRepair.slot.bbox,
        ) ||
        input.inputExactText !== artifactTopologyConsensusRepair.slot.exactText ||
        input.inputCaption !== artifactTopologyConsensusRepair.slot.caption ||
        input.equationCropSha256 !== artifactTopologyConsensusRepair.slot.equationCropSha256 ||
        artifactTopologyConsensusRepair.topologyReview.status !== "confirmed"
      )
    ) {
      throw new Error(
        "Formula-artifact topology consensus repair was not consumed by the re-review for " +
          visual.sourceVisualId + ".",
      );
    }
    const reviewRecordPath = sourceFormulaReviewRecordRelativePath(
      envelope.cacheKey,
      envelope.integritySha256,
    );
    return {
      ...visual,
      exactText: decision.acceptedExactText,
      caption: decision.acceptedCaption,
      croppedImagePath: sourceFormulaReviewedCropUrl(
        options.gardenSlug,
        visual.sourceVisualId,
        input.equationCropSha256,
      ),
      formulaReview: {
        schemaVersion: SOURCE_FORMULA_REVIEW_SCHEMA_VERSION,
        promptVersion: SOURCE_FORMULA_REVIEW_PROMPT_VERSION,
        model: envelope.model,
        reviewedAt: envelope.reviewedAt || now,
        decision: decision.action === "replace" ? "replaced" : "approved",
        identityAssessment: decision.identityAssessment,
        inputExactText: input.inputExactText,
        inputCaption: input.inputCaption,
        acceptedExactText: decision.acceptedExactText,
        acceptedCaption: decision.acceptedCaption,
        reason: decision.reason,
        pageImageSha256: envelope.pageImageSha256,
        equationCropSha256: input.equationCropSha256,
        canonicalPageTextSha256: envelope.canonicalPageTextSha256,
        sourcePdfSha256: envelope.sourcePdfSha256,
        reviewedPageImagePath: sourceFormulaReviewedPageRelativePath(evidence),
        reviewedEquationCropPath: sourceFormulaReviewedCropUrl(
          options.gardenSlug,
          visual.sourceVisualId,
          input.equationCropSha256,
        ),
        requestSha256: envelope.requestSha256,
        responseSha256: envelope.responseSha256,
        cacheKey: envelope.cacheKey,
        cacheIntegritySha256: envelope.integritySha256,
        reviewRecordPath,
        semanticAttempt: envelope.semanticAttempt,
        ...(artifactRecovery ? {
          artifactRecovery: sourceFormulaArtifactRecoveryProvenance(
            artifactRecovery.envelope,
            artifactRecovery.input,
            artifactRecovery.replacement,
          ),
        } : {}),
        ...(artifactTopologyRecovery ? {
          artifactTopologyRecovery: sourceFormulaArtifactTopologyRecoveryProvenance(
            artifactTopologyRecovery.envelope,
            artifactTopologyRecovery.slot,
            artifactTopologyRecovery.topologyReview,
          ),
        } : {}),
        ...(artifactTopologyCandidateRepair ? {
          artifactTopologyCandidateRepair: sourceFormulaArtifactTopologyCandidateRepairProvenance(
            artifactTopologyCandidateRepair.envelope,
            artifactTopologyCandidateRepair.candidate,
            artifactTopologyCandidateRepair.slot,
            artifactTopologyCandidateRepair.topologyReview,
          ),
        } : {}),
        ...(artifactTopologyConsensusRepair ? {
          artifactTopologyConsensusRepair: sourceFormulaArtifactTopologyConsensusRepairProvenance(
            artifactTopologyConsensusRepair.envelope,
            artifactTopologyConsensusRepair.candidate,
            artifactTopologyConsensusRepair.slot,
            artifactTopologyConsensusRepair.topologyReview,
          ),
        } : {}),
      },
    };
  });
  const topologyReviewPageReceipts = sourceFormulaTopologyReviewPageReceipts(
    options.contentPath,
    options.gardenSlug,
    selectedSourceIds,
  );
  const reviewedFormulaSetHash = computeSourceFormulaReviewSetHash(
    next,
    formulaIds,
    selectedSourceIds,
    sourceIdentityMap,
    topologyReviewPageReceipts,
  );
  // Projection is deliberately delayed until every page has a complete accepted
  // AI response. External cache entries above are inert and may survive a failed
  // run, but a rejected sibling page leaves the staging ledger byte-identical.
  for (const { envelope, evidence } of outcomes) {
    persistSourceFormulaReviewedPage(options.contentPath, options.gardenSlug, evidence);
    for (const input of evidence.inputs) {
      const crop = evidence.crops.get(input.sourceVisualId);
      if (!crop) throw new Error(`Missing accepted reviewed crop for ${input.sourceVisualId}.`);
      persistSourceFormulaReviewedCrop(
        options.contentPath,
        options.gardenSlug,
        input.sourceVisualId,
        crop,
      );
    }
    persistSourceFormulaReviewRecord(options.contentPath, options.gardenSlug, envelope);
  }
  for (const recoveryCrop of recoveryVisualCrops) {
    const persisted = persistSourceFormulaArtifactRecoveryVisualCrop(
      options.contentPath,
      options.gardenSlug,
      recoveryCrop.sourceVisualId,
      recoveryCrop.crop,
    );
    if (persisted !== recoveryCrop.croppedImagePath) {
      throw new Error("Recovered source visual crop projection did not preserve its expected URL.");
    }
  }
  saveSourceVisuals(options.contentPath, options.gardenSlug, next);

  const replacementFormulaIds = formulaIds.filter((formulaId) =>
    envelopeById.get(formulaId)?.decision.action === "replace",
  );
  const newlyReplacedFormulaIds = formulaIds.filter((formulaId) => {
    const visual = originalVisualById.get(formulaId);
    const decision = envelopeById.get(formulaId)?.decision;
    return Boolean(
      visual &&
      decision &&
      (decision.acceptedExactText !== visual.exactText?.trim() ||
        decision.acceptedCaption !== visual.caption.trim()),
    );
  });
  return {
    visuals: next,
    formulaIds,
    reviewedFormulaSetHash,
    approvedFormulaIds: formulaIds.filter((formulaId) =>
      envelopeById.get(formulaId)?.decision.action === "approve",
    ),
    replacementFormulaIds,
    newlyReplacedFormulaIds,
    cacheHitFormulaIds: formulaIds.filter((formulaId) => envelopeById.get(formulaId)?.cacheHit),
    modelCalls,
    topologyReviewPageReceipts,
  };
}

function validationGardenDir(options: SourceFormulaReviewValidationOptions): string {
  if (options.gardenDir?.trim()) return path.resolve(options.gardenDir);
  if (!options.contentPath?.trim()) {
    throw new Error("Formula-review validation requires gardenDir or contentPath.");
  }
  return path.resolve(options.contentPath, options.gardenSlug);
}

function loadSourceVisualScanCacheFromGardenDir(
  gardenDir: string,
): SourceVisualScanCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(
      path.join(gardenDir, SCAN_CACHE_RELATIVE_PATH),
      "utf-8",
    )) as Partial<SourceVisualScanCache>;
    return parsed.schemaVersion === 1 && parsed.sources && typeof parsed.sources === "object"
      ? parsed as SourceVisualScanCache
      : null;
  } catch {
    return null;
  }
}

function resolveAssetFromGardenDir(
  gardenDirInput: string,
  assetUrlGardenSlug: string,
  assetUrl: string,
): string | null {
  const normalized = assetUrl.trim().replace(/\\/g, "/");
  const prefix = `/${assetUrlGardenSlug}/`;
  if (!normalized.startsWith(prefix)) return null;
  const gardenDir = path.resolve(gardenDirInput);
  const candidate = path.resolve(gardenDir, ...normalized.slice(prefix.length).split("/"));
  const relative = path.relative(gardenDir, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !fs.existsSync(candidate)
  ) return null;
  const realGarden = fs.realpathSync(gardenDir);
  const realCandidate = fs.realpathSync(candidate);
  const realRelative = path.relative(realGarden, realCandidate);
  if (
    !realRelative ||
    realRelative === ".." ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) return null;
  return realCandidate;
}

function sourcePdfEvidenceFromGardenDir(
  gardenDir: string,
  assetUrlGardenSlug: string,
  sourceId: string,
): { sourcePdfPath: string; sourcePdfSha256: string; sourcePdf: Buffer } {
  const sourcePath = path.resolve(gardenDir, "sources", `${sourceId}.md`);
  const relative = path.relative(gardenDir, sourcePath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !fs.existsSync(sourcePath)
  ) throw new Error(`Canonical source note ${sourceId}.md is missing.`);
  const markdown = fs.readFileSync(sourcePath, "utf-8");
  const closing = markdown.startsWith("---") ? markdown.indexOf("\n---", 3) : -1;
  const frontmatter = closing >= 0 ? markdown.slice(3, closing) : "";
  const match = frontmatter.match(
    /^source_pdf\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\r\n#]+))\s*$/im,
  );
  const sourcePdfUrl = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  const sourcePdfPath = resolveAssetFromGardenDir(
    gardenDir,
    assetUrlGardenSlug,
    sourcePdfUrl,
  );
  if (!sourcePdfPath || path.extname(sourcePdfPath).toLowerCase() !== ".pdf") {
    throw new Error(`Preserved source PDF for ${sourceId} is missing or outside the garden.`);
  }
  const sourcePdf = fs.readFileSync(sourcePdfPath);
  if (!sourcePdf.length) throw new Error(`Preserved source PDF for ${sourceId} is empty.`);
  return { sourcePdfPath, sourcePdf, sourcePdfSha256: sha256(sourcePdf) };
}

function validationPageEvidence(
  gardenDir: string,
  assetUrlGardenSlug: string,
  visuals: readonly SourceVisual[],
  sourcePdfById: Map<string, ReturnType<typeof sourcePdfEvidenceFromGardenDir>>,
): SourceFormulaReviewPageEvidence {
  const first = visuals[0];
  if (!first?.formulaReview) throw new Error("Formula review page has no provenance.");
  if (pageNumberFromAssetUrl(first.pageImagePath ?? "") !== first.pageNumber) {
    throw new Error(
      `Source formula snapshot identity does not match ledger page ${first.pageNumber}.`,
    );
  }
  const reviewedPaths = new Set(visuals.map((visual) =>
    visual.formulaReview?.reviewedPageImagePath ?? "",
  ));
  if (reviewedPaths.size !== 1 || !first.formulaReview.reviewedPageImagePath) {
    throw new Error(
      `Reviewed formulas on ${first.sourceId} p.${first.pageNumber} do not share one PDF-render evidence image.`,
    );
  }
  const evidencePath = sourceFormulaReviewRecordDiskPathFromGardenDir(
    gardenDir,
    first.formulaReview.reviewedPageImagePath,
  );
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    throw new Error(
      `Reviewed PDF-page evidence is missing for ${first.sourceId} p.${first.pageNumber}.`,
    );
  }
  const pageImage = fs.readFileSync(evidencePath);
  const pageImageSha256 = sha256(pageImage);
  if (pageImageSha256 !== first.formulaReview.pageImageSha256) {
    throw new Error(
      `Reviewed PDF-page evidence hash changed for ${first.sourceId} p.${first.pageNumber}.`,
    );
  }
  const canonicalPageText = canonicalSourcePageMarkdownFromGardenDir(
    gardenDir,
    first.sourceId,
    first.pageNumber,
  );
  if (!canonicalPageText) {
    throw new Error(`Canonical page text is missing for ${first.sourceId} p.${first.pageNumber}.`);
  }
  const sourcePdf = sourcePdfById.get(first.sourceId) ?? sourcePdfEvidenceFromGardenDir(
    gardenDir,
    assetUrlGardenSlug,
    first.sourceId,
  );
  sourcePdfById.set(first.sourceId, sourcePdf);
  const crops = new Map<string, Buffer>();
  const inputs = visuals
    .slice()
    .sort(sourceFormulaInputOrder)
    .map((visual) => {
      const identityPage = Number.parseInt(
        /^S\d+\.P(\d+)\.E\d+$/.exec(visual.sourceVisualId)?.[1] ?? "",
        10,
      );
      if (identityPage !== visual.pageNumber) {
        throw new Error(
          `Source formula identity ${visual.sourceVisualId} does not match ledger page ${visual.pageNumber}.`,
        );
      }
      if (!visual.bbox || !visual.exactText?.trim() || !visual.caption.trim()) {
        throw new Error(`Reviewed source formula ${visual.sourceVisualId} is structurally incomplete.`);
      }
      const crop = cropPng(pageImage, expandedCropBBox(visual.bbox, "equation"));
      if (!crop?.length) throw new Error(`Reviewed source formula ${visual.sourceVisualId} cannot be cropped.`);
      const storedCropPath = resolveAssetFromGardenDir(
        gardenDir,
        assetUrlGardenSlug,
        visual.croppedImagePath ?? "",
      );
      if (
        !storedCropPath ||
        sha256(fs.readFileSync(storedCropPath)) !== sha256(crop) ||
        visual.formulaReview?.reviewedEquationCropPath !== visual.croppedImagePath
      ) {
        throw new Error(
          `Reviewed equation crop projection is missing or stale for ${visual.sourceVisualId}.`,
        );
      }
      crops.set(visual.sourceVisualId, crop);
      return normalizedReviewInput(visual, sha256(crop));
    });
  return {
    sourceId: first.sourceId,
    pageNumber: first.pageNumber,
    pageImagePath: first.pageImagePath ?? "",
    pageImage,
    pageImageSha256,
    canonicalPageText,
    canonicalPageTextSha256: sha256(canonicalPageText),
    sourcePdfPath: sourcePdf.sourcePdfPath,
    sourcePdfSha256: sourcePdf.sourcePdfSha256,
    inputs,
    crops,
  };
}

/**
 * V5 receipts are page-level evidence, including a legitimate zero-formula
 * result.  Unlike normal final review evidence, their input slots are the
 * pre-topology old slots, so reconstruct them from the signed receipt rather
 * than from whichever active formulas happen to remain in the ledger.
 */
function validationTopologyRecoveryEvidence(
  gardenDir: string,
  assetUrlGardenSlug: string,
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope,
  sourcePdfById: Map<string, ReturnType<typeof sourcePdfEvidenceFromGardenDir>>,
): SourceFormulaReviewPageEvidence {
  const pagePath = resolveAssetFromGardenDir(
    gardenDir,
    assetUrlGardenSlug,
    recovery.pageImagePath,
  );
  if (!pagePath) {
    throw new Error("Topology recovery page snapshot is missing for " + recovery.sourceId + " p." + recovery.pageNumber + ".");
  }
  const pageImage = fs.readFileSync(pagePath);
  const pageImageSha256 = sha256(pageImage);
  const canonicalPageText = canonicalSourcePageMarkdownFromGardenDir(
    gardenDir,
    recovery.sourceId,
    recovery.pageNumber,
  );
  if (!canonicalPageText) {
    throw new Error("Canonical page text is missing for topology recovery " + recovery.sourceId + " p." + recovery.pageNumber + ".");
  }
  const sourcePdf = sourcePdfById.get(recovery.sourceId) ?? sourcePdfEvidenceFromGardenDir(
    gardenDir,
    assetUrlGardenSlug,
    recovery.sourceId,
  );
  sourcePdfById.set(recovery.sourceId, sourcePdf);
  return {
    sourceId: recovery.sourceId,
    pageNumber: recovery.pageNumber,
    pageImagePath: recovery.pageImagePath,
    pageImage,
    pageImageSha256,
    canonicalPageText,
    canonicalPageTextSha256: sha256(canonicalPageText),
    sourcePdfPath: sourcePdf.sourcePdfPath,
    sourcePdfSha256: sourcePdf.sourcePdfSha256,
    inputs: recovery.inputVisuals.map((input) => ({
      sourceVisualId: input.sourceVisualId,
      sourceId: input.sourceId,
      pageNumber: input.pageNumber,
      pageImagePath: recovery.pageImagePath,
      inputCaption: input.inputCaption,
      inputExactText: input.inputExactText,
      bbox: { ...input.inputBBox },
      equationCropSha256: input.inputEquationCropSha256,
    })),
    crops: new Map(),
  };
}

interface ValidatedTopologyRecoveryPageReceipt {
  recovery: SourceFormulaArtifactTopologyRecoveryCacheEnvelope;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  evidence: SourceFormulaReviewPageEvidence;
}

interface ValidatedTopologyCandidateRepairPageReceipt {
  envelope: SourceFormulaArtifactTopologyCandidateRepairCacheEnvelope;
  candidate: SourceFormulaArtifactTopologyCandidateRepairCandidate;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  evidence: SourceFormulaReviewPageEvidence;
}

interface ValidatedTopologyConsensusRepairPageReceipt {
  envelope: SourceFormulaArtifactTopologyConsensusRepairCacheEnvelope;
  candidate: SourceFormulaArtifactTopologyConsensusRepairCandidate;
  topologyReview: SourceFormulaArtifactTopologyReviewEnvelope;
  evidence: SourceFormulaReviewPageEvidence;
}

export function validateSourceFormulaReviewSet(
  options: SourceFormulaReviewValidationOptions,
): SourceFormulaReviewValidationResult {
  const problems: string[] = [];
  const formulaIds = [...new Set([...options.requiredFormulaIds].map((id) => id.trim()).filter(Boolean))]
    .sort();
  let gardenDir = "";
  try {
    gardenDir = validationGardenDir(options);
  } catch (error) {
    return { formulaIds, reviewSetHash: "", problems: [error instanceof Error ? error.message : String(error)] };
  }
  const assetUrlGardenSlug = options.assetUrlGardenSlug?.trim() || options.gardenSlug;
  const recoveryScanCache = loadSourceVisualScanCacheFromGardenDir(gardenDir);
  let ledger: SourceVisual[] = [];
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(gardenDir, LEDGER_RELATIVE_PATH), "utf-8"),
    );
    if (!Array.isArray(parsed)) throw new Error("source-visuals ledger is not an array");
    ledger = parsed as SourceVisual[];
  } catch (error) {
    return {
      formulaIds,
      reviewSetHash: "",
      problems: [`Source formula review ledger is unavailable: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const byId = new Map<string, SourceVisual>();
  const duplicateIds = new Set<string>();
  for (const visual of ledger) {
    if (byId.has(visual.sourceVisualId)) duplicateIds.add(visual.sourceVisualId);
    byId.set(visual.sourceVisualId, visual);
  }
  const expectedSourceIds = options.expectedSourceIds?.map((sourceId) => sourceId.trim());
  if (
    expectedSourceIds &&
    (expectedSourceIds.some((sourceId) => !sourceId) ||
      new Set(expectedSourceIds).size !== expectedSourceIds.length)
  ) {
    problems.push("Expected source formula review source ids must be unique and non-empty.");
  }
  let sourceIdentityMap: SourceVisualSourceIdentity[] = [];
  const identityRegistryPath = path.join(gardenDir, SOURCE_IDENTITY_MAP_RELATIVE_PATH);
  try {
    const storedIdentityMap = fs.existsSync(identityRegistryPath)
      ? loadSourceVisualSourceIdentityMap(path.dirname(gardenDir), path.basename(gardenDir))
      : null;
    const suppliedIdentityMap = options.sourceIdentityMap
      ? normalizedSourceVisualSourceIdentityMap(options.sourceIdentityMap)
      : null;
    if (
      storedIdentityMap &&
      suppliedIdentityMap &&
      JSON.stringify(storedIdentityMap) !== JSON.stringify(suppliedIdentityMap)
    ) {
      problems.push("Supplied source identity map does not match the durable garden registry.");
    }
    const suppliedOrStored = suppliedIdentityMap ?? storedIdentityMap ??
      (expectedSourceIds ?? []).map(
        (sourceId, sourceIndex) => ({ sourceId, sourceIndex: sourceIndex + 1 }),
      );
    sourceIdentityMap = mergeLedgerSourceIdentities(suppliedOrStored, ledger);
    if (expectedSourceIds) {
      const indexedSourceIds = new Set(sourceIdentityMap.map((entry) => entry.sourceId));
      const missingSelected = expectedSourceIds.filter((sourceId) => !indexedSourceIds.has(sourceId));
      if (missingSelected.length > 0) {
        problems.push(
          `Stable source identity map is missing selected source ids: ${missingSelected.join(", ")}.`,
        );
      }
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const reviewManifestPath = path.join(gardenDir, SOURCE_FORMULA_REVIEW_MANIFEST_RELATIVE_PATH);
  let manifestTopologyReviewPageReceipts: SourceFormulaTopologyReviewPageReceipt[] | undefined;
  if (fs.existsSync(reviewManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(reviewManifestPath, "utf-8")) as Partial<SourceFormulaReviewSetManifest>;
      if (
        options.expectedReviewSetHash &&
        manifest.reviewSetHash === options.expectedReviewSetHash
      ) {
        manifestTopologyReviewPageReceipts = normalizedSourceFormulaTopologyReviewPageReceipts(
          manifest.topologyReviewPageReceipts,
        );
        if (
          JSON.stringify(manifest.topologyReviewPageReceipts) !==
            JSON.stringify(manifestTopologyReviewPageReceipts)
        ) {
          problems.push("Source-formula review manifest topology receipt binding is not canonical.");
        }
        const declaresIdentityBinding =
          Array.isArray(manifest.sourceIdentityMap) ||
          typeof manifest.sourceIdentityMapHash === "string";
        if (declaresIdentityBinding && !fs.existsSync(identityRegistryPath)) {
          problems.push("Durable source identity registry is missing for the source-formula review manifest.");
        } else if (
          fs.existsSync(identityRegistryPath) &&
          (!Array.isArray(manifest.sourceIdentityMap) || typeof manifest.sourceIdentityMapHash !== "string")
        ) {
          problems.push("Source-formula review manifest is missing its stable source identity binding.");
        } else if (declaresIdentityBinding && Array.isArray(manifest.sourceIdentityMap)) {
          const manifestIdentityMap = normalizedSourceVisualSourceIdentityMap(manifest.sourceIdentityMap);
          const manifestIdentityHash = sourceVisualSourceIdentityMapHash(manifestIdentityMap);
          if (
            manifestIdentityHash !== manifest.sourceIdentityMapHash ||
            JSON.stringify(manifestIdentityMap) !== JSON.stringify(sourceIdentityMap)
          ) {
            problems.push("Source-formula review manifest stable source identity binding does not match the garden registry.");
          }
        }
      }
    } catch (error) {
      problems.push(
        `Source-formula review manifest binding is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const sourceIdByIndex = new Map(
    sourceIdentityMap.map((entry) => [entry.sourceIndex, entry.sourceId]),
  );
  const selectedSourceIdSet = expectedSourceIds ? new Set(expectedSourceIds) : null;
  for (const formulaId of formulaIds) {
    if (duplicateIds.has(formulaId)) {
      problems.push(`Duplicate required source formula id ${formulaId} exists in the ledger.`);
    }
  }
  const selected: SourceVisual[] = [];
  for (const formulaId of formulaIds) {
    const visual = byId.get(formulaId);
    if (!visual) {
      problems.push(`Required reviewed source formula ${formulaId} is missing from the ledger.`);
      continue;
    }
    if (visual.type !== "equation") {
      problems.push(`Required reviewed source formula ${formulaId} has type ${visual.type}.`);
      continue;
    }
    const sourceIndex = Number.parseInt(/^S(\d+)\.P\d+\.E\d+$/.exec(formulaId)?.[1] ?? "", 10);
    const expectedSourceId = sourceIdByIndex.get(sourceIndex);
    if (!expectedSourceId || visual.sourceId !== expectedSourceId) {
      problems.push(
        `Reviewed formula identity ${formulaId} does not match stable source ${expectedSourceId ?? `(missing S${sourceIndex})`}.`,
      );
      continue;
    }
    if (selectedSourceIdSet && !selectedSourceIdSet.has(visual.sourceId)) {
      problems.push(
        `Reviewed formula identity ${formulaId} belongs to unselected source ${visual.sourceId}.`,
      );
      continue;
    }
    selected.push(visual);
  }
  const grouped = new Map<string, SourceVisual[]>();
  for (const visual of selected) {
    const key = `${visual.sourceId}\u0000${visual.pageNumber}`;
    const page = grouped.get(key) ?? [];
    page.push(visual);
    grouped.set(key, page);
  }
  const sourcePdfById = new Map<string, ReturnType<typeof sourcePdfEvidenceFromGardenDir>>();
  const topologyRecoveryByPage = new Map<string, ValidatedTopologyRecoveryPageReceipt>();
  const topologyCandidateRepairByPage = new Map<string, ValidatedTopologyCandidateRepairPageReceipt>();
  const topologyConsensusRepairByPage = new Map<string, ValidatedTopologyConsensusRepairPageReceipt>();
  if (recoveryScanCache) {
    for (const [cachedSourceId, pages] of Object.entries(recoveryScanCache.sources)) {
      if (selectedSourceIdSet && !selectedSourceIdSet.has(cachedSourceId)) continue;
      for (const [pageUrl, entry] of Object.entries(pages)) {
        const consensusRepair = entry?.formulaArtifactTopologyConsensusRepair;
        if (
          entry?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION ||
          consensusRepair
        ) {
          if (!consensusRepair) {
            problems.push(`Topology consensus-repair scan receipt is missing on ${cachedSourceId} ${pageUrl}.`);
            continue;
          }
          const baseRecovery = consensusRepair.base.protocol === "v5"
            ? consensusRepair.base.recovery
            : consensusRepair.base.candidateRepair.initialRecovery;
          let topologyEvidence: SourceFormulaReviewPageEvidence;
          try {
            topologyEvidence = validationTopologyRecoveryEvidence(
              gardenDir,
              assetUrlGardenSlug,
              baseRecovery,
              sourcePdfById,
            );
          } catch (error) {
            problems.push(error instanceof Error ? error.message : String(error));
            continue;
          }
          const finalEntry = sourceFormulaArtifactTopologyConsensusRepairFinalEntry(consensusRepair);
          const topologyReview = finalEntry?.topologyReview;
          if (
            consensusRepair.sourceId !== cachedSourceId ||
            consensusRepair.pageImagePath !== pageUrl ||
            !finalEntry ||
            !topologyReview ||
            !sourceFormulaArtifactTopologyConsensusRepairIsProjectionConfirmed(consensusRepair) ||
            !sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(
              entry,
              pageUrl,
              topologyEvidence.pageImageSha256,
            ) ||
            !sourceFormulaArtifactTopologyConsensusRepairEnvelopeMatches(
              consensusRepair,
              topologyEvidence,
            )
          ) {
            problems.push(`Topology consensus-repair scan/history integrity failed on ${cachedSourceId} p.${consensusRepair.pageNumber}.`);
            continue;
          }
          const pageKey = consensusRepair.sourceId + "\u0000" + consensusRepair.pageNumber;
          if (
            topologyRecoveryByPage.has(pageKey) ||
            topologyCandidateRepairByPage.has(pageKey) ||
            topologyConsensusRepairByPage.has(pageKey)
          ) {
            problems.push(`Duplicate topology recovery page receipt exists on ${cachedSourceId} p.${consensusRepair.pageNumber}.`);
            continue;
          }
          const expected = sourceFormulaArtifactTopologyConsensusRepairExpectedPageSlots(finalEntry.candidate);
          const ledgerPage = ledger.filter((visual) =>
            visual.sourceId === consensusRepair.sourceId && visual.pageNumber === consensusRepair.pageNumber,
          );
          const byExpectedId = new Map(ledgerPage.map((visual) => [visual.sourceVisualId, visual]));
          if (byExpectedId.size !== ledgerPage.length || expected.length !== ledgerPage.length) {
            problems.push(`Topology consensus-repair full-page projection is incomplete or contains stale ids on ${cachedSourceId} p.${consensusRepair.pageNumber}.`);
            continue;
          }
          let pageProjectionValid = true;
          for (const slot of expected) {
            const visual = byExpectedId.get(slot.sourceVisualId);
            if (
              !visual ||
              visual.type !== slot.detection.type ||
              visual.pageImagePath !== consensusRepair.pageImagePath ||
              !visual.bbox ||
              !slot.detection.bbox ||
              !sameSourceVisualBBox(visual.bbox, slot.detection.bbox) ||
              (!slot.activeSlot && (
                visual.caption !== slot.detection.caption ||
                (visual.exactText?.trim() || undefined) !== (slot.detection.exactText?.trim() || undefined)
              ))
            ) {
              pageProjectionValid = false;
              break;
            }
            const cropPath = resolveAssetFromGardenDir(
              gardenDir,
              assetUrlGardenSlug,
              visual.croppedImagePath ?? "",
            );
            const crop = cropPng(
              topologyEvidence.pageImage,
              expandedCropBBox(slot.detection.bbox, slot.detection.type),
            );
            if (!cropPath || !crop?.length || sha256(fs.readFileSync(cropPath)) !== sha256(crop)) {
              pageProjectionValid = false;
              break;
            }
            if (slot.activeSlot) {
              const provenance = visual.formulaReview?.artifactTopologyConsensusRepair;
              const expectedProvenance = sourceFormulaArtifactTopologyConsensusRepairProvenance(
                consensusRepair,
                finalEntry.candidate,
                slot.activeSlot,
                topologyReview,
              );
              if (
                !provenance ||
                Boolean(visual.formulaReview?.artifactTopologyRecovery) ||
                Boolean(visual.formulaReview?.artifactTopologyCandidateRepair) ||
                JSON.stringify(provenance) !== JSON.stringify(expectedProvenance) ||
                visual.formulaReview?.inputExactText !== slot.activeSlot.exactText ||
                visual.formulaReview?.inputCaption !== slot.activeSlot.caption ||
                visual.formulaReview?.equationCropSha256 !== slot.activeSlot.equationCropSha256
              ) {
                pageProjectionValid = false;
                break;
              }
            }
          }
          if (!pageProjectionValid) {
            problems.push(`Topology consensus-repair full-page projection/crop/provenance failed on ${cachedSourceId} p.${consensusRepair.pageNumber}.`);
            continue;
          }
          topologyConsensusRepairByPage.set(pageKey, {
            envelope: consensusRepair,
            candidate: finalEntry.candidate,
            topologyReview,
            evidence: topologyEvidence,
          });
          continue;
        }
        const candidateRepair = entry?.formulaArtifactTopologyCandidateRepair;
        if (
          entry?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION ||
          candidateRepair
        ) {
          if (!candidateRepair) {
            problems.push(`Topology candidate-repair scan receipt is missing on ${cachedSourceId} ${pageUrl}.`);
            continue;
          }
          let topologyEvidence: SourceFormulaReviewPageEvidence;
          try {
            topologyEvidence = validationTopologyRecoveryEvidence(
              gardenDir,
              assetUrlGardenSlug,
              candidateRepair.initialRecovery,
              sourcePdfById,
            );
          } catch (error) {
            problems.push(error instanceof Error ? error.message : String(error));
            continue;
          }
          const finalEntry = sourceFormulaArtifactTopologyCandidateRepairFinalEntry(candidateRepair);
          const topologyReview = finalEntry?.topologyReview;
          if (
            candidateRepair.sourceId !== cachedSourceId ||
            candidateRepair.pageImagePath !== pageUrl ||
            !finalEntry ||
            !topologyReview ||
            topologyReview.status !== "confirmed" ||
            !sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(
              entry,
              pageUrl,
              topologyEvidence.pageImageSha256,
            ) ||
            !sourceFormulaArtifactTopologyCandidateRepairEnvelopeMatches(
              candidateRepair,
              topologyEvidence,
            )
          ) {
            problems.push(`Topology candidate-repair scan/history integrity failed on ${cachedSourceId} p.${candidateRepair.pageNumber}.`);
            continue;
          }
          const pageKey = candidateRepair.sourceId + "\u0000" + candidateRepair.pageNumber;
          if (
            topologyRecoveryByPage.has(pageKey) ||
            topologyCandidateRepairByPage.has(pageKey) ||
            topologyConsensusRepairByPage.has(pageKey)
          ) {
            problems.push(`Duplicate topology recovery page receipt exists on ${cachedSourceId} p.${candidateRepair.pageNumber}.`);
            continue;
          }
          const expected = sourceFormulaArtifactTopologyCandidateRepairExpectedPageSlots(finalEntry.candidate);
          const ledgerPage = ledger.filter((visual) =>
            visual.sourceId === candidateRepair.sourceId && visual.pageNumber === candidateRepair.pageNumber,
          );
          const byExpectedId = new Map(ledgerPage.map((visual) => [visual.sourceVisualId, visual]));
          if (byExpectedId.size !== ledgerPage.length || expected.length !== ledgerPage.length) {
            problems.push(`Topology candidate-repair full-page projection is incomplete or contains stale ids on ${cachedSourceId} p.${candidateRepair.pageNumber}.`);
            continue;
          }
          let pageProjectionValid = true;
          for (const slot of expected) {
            const visual = byExpectedId.get(slot.sourceVisualId);
            if (
              !visual ||
              visual.type !== slot.detection.type ||
              visual.pageImagePath !== candidateRepair.pageImagePath ||
              !visual.bbox ||
              !slot.detection.bbox ||
              !sameSourceVisualBBox(visual.bbox, slot.detection.bbox) ||
              (!slot.activeSlot && (
                visual.caption !== slot.detection.caption ||
                (visual.exactText?.trim() || undefined) !== (slot.detection.exactText?.trim() || undefined)
              ))
            ) {
              pageProjectionValid = false;
              break;
            }
            const cropPath = resolveAssetFromGardenDir(
              gardenDir,
              assetUrlGardenSlug,
              visual.croppedImagePath ?? "",
            );
            const crop = cropPng(
              topologyEvidence.pageImage,
              expandedCropBBox(slot.detection.bbox, slot.detection.type),
            );
            if (!cropPath || !crop?.length || sha256(fs.readFileSync(cropPath)) !== sha256(crop)) {
              pageProjectionValid = false;
              break;
            }
            if (slot.activeSlot) {
              const provenance = visual.formulaReview?.artifactTopologyCandidateRepair;
              const expectedProvenance = sourceFormulaArtifactTopologyCandidateRepairProvenance(
                candidateRepair,
                finalEntry.candidate,
                slot.activeSlot,
                topologyReview,
              );
              if (
                !provenance ||
                Boolean(visual.formulaReview?.artifactTopologyRecovery) ||
                JSON.stringify(provenance) !== JSON.stringify(expectedProvenance) ||
                visual.formulaReview?.inputExactText !== slot.activeSlot.exactText ||
                visual.formulaReview?.inputCaption !== slot.activeSlot.caption ||
                visual.formulaReview?.equationCropSha256 !== slot.activeSlot.equationCropSha256
              ) {
                pageProjectionValid = false;
                break;
              }
            }
          }
          if (!pageProjectionValid) {
            problems.push(`Topology candidate-repair full-page projection/crop/provenance failed on ${cachedSourceId} p.${candidateRepair.pageNumber}.`);
            continue;
          }
          topologyCandidateRepairByPage.set(pageKey, {
            envelope: candidateRepair,
            candidate: finalEntry.candidate,
            topologyReview,
            evidence: topologyEvidence,
          });
          continue;
        }
        if (
          entry?.detectorVersion !== SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
          !entry?.formulaArtifactTopologyRecovery &&
          !entry?.formulaArtifactTopologyReview
        ) continue;
        const recovery = entry?.formulaArtifactTopologyRecovery;
        if (!recovery) {
          problems.push(`Topology recovery scan receipt is missing on ${cachedSourceId} ${pageUrl}.`);
          continue;
        }
        let topologyEvidence: SourceFormulaReviewPageEvidence;
        try {
          topologyEvidence = validationTopologyRecoveryEvidence(
            gardenDir,
            assetUrlGardenSlug,
            recovery,
            sourcePdfById,
          );
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
          continue;
        }
        if (
          recovery.sourceId !== cachedSourceId ||
          recovery.pageImagePath !== pageUrl ||
          !sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
            entry,
            pageUrl,
            topologyEvidence.pageImageSha256,
          ) ||
          !sourceFormulaArtifactTopologyRecoveryEnvelopeStructurallyMatchesEvidence(
            recovery,
            topologyEvidence,
          )
        ) {
          problems.push(`Topology recovery scan receipt integrity failed on ${cachedSourceId} p.${recovery.pageNumber}.`);
          continue;
        }
        const topologyReview = entry.formulaArtifactTopologyReview;
        if (
          !topologyReview ||
          !sourceFormulaArtifactTopologyReviewEnvelopeMatches(
            topologyReview,
            topologyEvidence,
            recovery,
            topologyReview.model,
          ) ||
          topologyReview.status !== "confirmed"
        ) {
          problems.push(`Topology recovery review receipt is missing, invalid, or not confirmed on ${cachedSourceId} p.${recovery.pageNumber}.`);
          continue;
        }
        const pageKey = recovery.sourceId + "\u0000" + recovery.pageNumber;
        if (
          topologyRecoveryByPage.has(pageKey) ||
          topologyCandidateRepairByPage.has(pageKey) ||
          topologyConsensusRepairByPage.has(pageKey)
        ) {
          problems.push(`Duplicate topology recovery page receipt exists on ${cachedSourceId} p.${recovery.pageNumber}.`);
          continue;
        }
        const expected = sourceFormulaArtifactTopologyRecoveryExpectedPageSlots(recovery);
        const ledgerPage = ledger.filter((visual) =>
          visual.sourceId === recovery.sourceId && visual.pageNumber === recovery.pageNumber,
        );
        const byExpectedId = new Map(ledgerPage.map((visual) => [visual.sourceVisualId, visual]));
        if (byExpectedId.size !== ledgerPage.length || expected.length !== ledgerPage.length) {
          problems.push(`Topology recovery full-page projection is incomplete or contains stale ids on ${cachedSourceId} p.${recovery.pageNumber}.`);
          continue;
        }
        let pageProjectionValid = true;
        for (const slot of expected) {
          const visual = byExpectedId.get(slot.sourceVisualId);
          if (
            !visual ||
            visual.type !== slot.detection.type ||
            visual.pageImagePath !== recovery.pageImagePath ||
            !visual.bbox ||
            !slot.detection.bbox ||
            !sameSourceVisualBBox(visual.bbox, slot.detection.bbox)
          ) {
            pageProjectionValid = false;
            break;
          }
          const cropPath = resolveAssetFromGardenDir(
            gardenDir,
            assetUrlGardenSlug,
            visual.croppedImagePath ?? "",
          );
          const crop = cropPng(
            topologyEvidence.pageImage,
            expandedCropBBox(slot.detection.bbox, slot.detection.type),
          );
          if (!cropPath || !crop?.length || sha256(fs.readFileSync(cropPath)) !== sha256(crop)) {
            pageProjectionValid = false;
            break;
          }
          if (slot.activeSlot) {
            const provenance = visual.formulaReview?.artifactTopologyRecovery;
            const expectedProvenance = sourceFormulaArtifactTopologyRecoveryProvenance(
              recovery,
              slot.activeSlot,
              topologyReview,
            );
            if (
              !provenance ||
              JSON.stringify(provenance) !== JSON.stringify(expectedProvenance) ||
              visual.formulaReview?.inputExactText !== slot.activeSlot.exactText ||
              visual.formulaReview?.inputCaption !== slot.activeSlot.caption ||
              visual.formulaReview?.equationCropSha256 !== slot.activeSlot.equationCropSha256
            ) {
              pageProjectionValid = false;
              break;
            }
          }
        }
        if (!pageProjectionValid) {
          problems.push(`Topology recovery full-page projection/crop/provenance failed on ${cachedSourceId} p.${recovery.pageNumber}.`);
          continue;
        }
        topologyRecoveryByPage.set(pageKey, { recovery, topologyReview, evidence: topologyEvidence });
      }
    }
  }
  let actualTopologyReviewPageReceipts: SourceFormulaTopologyReviewPageReceipt[] = [];
  try {
    actualTopologyReviewPageReceipts = normalizedSourceFormulaTopologyReviewPageReceipts(
      [
        ...[...topologyRecoveryByPage.values()].map(({ recovery, topologyReview }) => ({
          recoveryProtocol: "v5" as const,
          sourceId: recovery.sourceId,
          pageNumber: recovery.pageNumber,
          pageImagePath: recovery.pageImagePath,
          recoveryCacheKey: recovery.cacheKey,
          recoveryCacheIntegritySha256: recovery.integritySha256,
          topologyReviewCacheKey: topologyReview.cacheKey,
          topologyReviewCacheIntegritySha256: topologyReview.integritySha256,
          activeFormulaIds: recovery.activeFormulaSlots.map((slot) => slot.sourceVisualId).sort(),
        })),
        ...[...topologyCandidateRepairByPage.values()].map(({ envelope, candidate, topologyReview }) => ({
          recoveryProtocol: "v6" as const,
          sourceId: envelope.sourceId,
          pageNumber: envelope.pageNumber,
          pageImagePath: envelope.pageImagePath,
          recoveryCacheKey: envelope.cacheKey,
          recoveryCacheIntegritySha256: envelope.integritySha256,
          topologyReviewCacheKey: topologyReview.cacheKey,
          topologyReviewCacheIntegritySha256: topologyReview.integritySha256,
          activeFormulaIds: candidate.activeFormulaSlots.map((slot) => slot.sourceVisualId).sort(),
        })),
        ...[...topologyConsensusRepairByPage.values()].map(({ envelope, candidate, topologyReview }) => ({
          recoveryProtocol: "v7" as const,
          sourceId: envelope.sourceId,
          pageNumber: envelope.pageNumber,
          pageImagePath: envelope.pageImagePath,
          recoveryCacheKey: envelope.cacheKey,
          recoveryCacheIntegritySha256: envelope.integritySha256,
          topologyReviewCacheKey: topologyReview.cacheKey,
          topologyReviewCacheIntegritySha256: topologyReview.integritySha256,
          activeFormulaIds: candidate.activeFormulaSlots.map((slot) => slot.sourceVisualId).sort(),
        })),
      ],
    );
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const hasExpectedTopologyReceiptBinding =
    options.expectedTopologyReviewPageReceipts !== undefined ||
    manifestTopologyReviewPageReceipts !== undefined;
  let expectedTopologyReviewPageReceipts: SourceFormulaTopologyReviewPageReceipt[] = [];
  if (hasExpectedTopologyReceiptBinding) {
    try {
      expectedTopologyReviewPageReceipts = normalizedSourceFormulaTopologyReviewPageReceipts(
        options.expectedTopologyReviewPageReceipts ?? manifestTopologyReviewPageReceipts,
      );
      if (
        options.expectedTopologyReviewPageReceipts !== undefined &&
        manifestTopologyReviewPageReceipts !== undefined &&
        JSON.stringify(expectedTopologyReviewPageReceipts) !==
          JSON.stringify(manifestTopologyReviewPageReceipts)
      ) {
        problems.push(
          "Expected source-formula topology receipt binding does not match the review manifest.",
        );
      }
      if (
        JSON.stringify(actualTopologyReviewPageReceipts) !==
          JSON.stringify(expectedTopologyReviewPageReceipts)
      ) {
        problems.push(
          "Reviewed source-formula topology page receipts are missing, changed, or contain an unexpected page.",
        );
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const pageVisuals of grouped.values()) {
    let evidence: SourceFormulaReviewPageEvidence;
    try {
      evidence = validationPageEvidence(
        gardenDir,
        assetUrlGardenSlug,
        pageVisuals,
        sourcePdfById,
      );
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const provenances = pageVisuals.map((visual) => visual.formulaReview);
    const first = provenances[0];
    if (!first) {
      problems.push(`Formula review provenance is missing on ${evidence.sourceId} p.${evidence.pageNumber}.`);
      continue;
    }
    if (provenances.some((review) =>
      !review ||
      review.reviewRecordPath !== first.reviewRecordPath ||
      review.cacheKey !== first.cacheKey ||
      review.cacheIntegritySha256 !== first.cacheIntegritySha256)) {
      problems.push(
        `Formula reviews on ${evidence.sourceId} p.${evidence.pageNumber} do not share one complete page-batch record.`,
      );
      continue;
    }
    const recordPath = sourceFormulaReviewRecordDiskPathFromGardenDir(
      gardenDir,
      first.reviewRecordPath,
    );
    let envelope: SourceFormulaReviewCacheEnvelope;
    try {
      if (!recordPath) throw new Error("record path escapes the review directory");
      envelope = JSON.parse(fs.readFileSync(recordPath, "utf-8")) as SourceFormulaReviewCacheEnvelope;
    } catch (error) {
      problems.push(
        `Durable formula-review record is unavailable for ${evidence.sourceId} p.${evidence.pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    let currentById = new Map(evidence.inputs.map((input) => [input.sourceVisualId, input]));
    const originalInputs = envelope.inputVisuals;
    if (!Array.isArray(originalInputs)) {
      problems.push(`Formula-review record inputs are invalid on ${evidence.sourceId} p.${evidence.pageNumber}.`);
      continue;
    }
    if (options.expectedModel && envelope.model !== options.expectedModel) {
      problems.push(
        `Formula-review model mismatch on ${evidence.sourceId} p.${evidence.pageNumber}: expected ${options.expectedModel}, found ${envelope.model}.`,
      );
    }
    const recoveryScanEntry = recoveryScanCache?.sources[evidence.sourceId]?.[evidence.pageImagePath];
    const recoverySnapshotPath = resolveAssetFromGardenDir(
      gardenDir,
      assetUrlGardenSlug,
      evidence.pageImagePath,
    );
    const recoveryEnvelope = recoverySnapshotPath
      ? sourceFormulaArtifactRecoveryEnvelopeFromScanEntryForPageEvidence(
        recoveryScanEntry,
        sha256(fs.readFileSync(recoverySnapshotPath)),
        evidence,
      )
      : null;
    const topologyReceipt = topologyRecoveryByPage.get(
      evidence.sourceId + "\u0000" + evidence.pageNumber,
    );
    const topologyCandidateRepairReceipt = topologyCandidateRepairByPage.get(
      evidence.sourceId + "\u0000" + evidence.pageNumber,
    );
    const topologyConsensusRepairReceipt = topologyConsensusRepairByPage.get(
      evidence.sourceId + "\u0000" + evidence.pageNumber,
    );
    // The normal reviewer must be validated against the immutable final
    // topology candidate, not a later accepted replacement transcription in
    // the ledger. This mirrors live re-review rebinding and preserves V5/V6/
    // V7 lineage across reviewer model changes.
    try {
      if (topologyConsensusRepairReceipt) {
        evidence = rebindSourceFormulaPageEvidenceAfterArtifactTopologyConsensusRepair(
          evidence,
          topologyConsensusRepairReceipt.candidate,
        );
      } else if (topologyCandidateRepairReceipt) {
        evidence = rebindSourceFormulaPageEvidenceAfterArtifactTopologyCandidateRepair(
          evidence,
          topologyCandidateRepairReceipt.candidate,
        );
      } else if (topologyReceipt) {
        evidence = rebindSourceFormulaPageEvidenceAfterArtifactTopologyRecovery(
          evidence,
          topologyReceipt.recovery,
        );
      }
    } catch (error) {
      problems.push(`Formula-review topology rebind failed on ${evidence.sourceId} p.${evidence.pageNumber}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    currentById = new Map(evidence.inputs.map((input) => [input.sourceVisualId, input]));
    const expectedKey = pageReviewCacheKey(evidence, envelope.model, originalInputs);
    if (!cacheEnvelopeMatches(envelope, evidence, envelope.model, originalInputs, expectedKey)) {
      problems.push(`Formula-review record integrity failed on ${evidence.sourceId} p.${evidence.pageNumber}.`);
      continue;
    }
    for (const visual of pageVisuals) {
      const review = visual.formulaReview;
      const input = originalInputs.find((candidate) => candidate.sourceVisualId === visual.sourceVisualId);
      const decision = envelope.reviews.find((candidate) => candidate.sourceVisualId === visual.sourceVisualId);
      const current = currentById.get(visual.sourceVisualId);
      if (!review || !input || !decision || !current) {
        problems.push(`Formula-review projection is incomplete for ${visual.sourceVisualId}.`);
        continue;
      }
      const expectedDecision = decision.action === "replace" ? "replaced" : "approved";
      const expectedReviewRecordPath = sourceFormulaReviewRecordRelativePath(
        envelope.cacheKey,
        envelope.integritySha256,
      );
      const expectedReviewedPageImagePath = sourceFormulaReviewedPageRelativePath(evidence);
      const expectedReviewedCropPath = sourceFormulaReviewedCropUrl(
        assetUrlGardenSlug,
        visual.sourceVisualId,
        current.equationCropSha256,
      );
      const recoveredInput = recoveryEnvelope?.inputVisuals.find((candidate) =>
        candidate.sourceVisualId === visual.sourceVisualId,
      );
      const recoveredReplacement = recoveryEnvelope?.replacements.find((candidate) =>
        candidate.sourceVisualId === visual.sourceVisualId,
      );
      const artifactRecoveryMismatches: string[] = [];
      if (recoveredInput || recoveredReplacement) {
        if (!recoveredInput || !recoveredReplacement) {
          artifactRecoveryMismatches.push("incomplete recovery page slot");
        } else if (!review.artifactRecovery) {
          artifactRecoveryMismatches.push("missing artifactRecovery provenance");
        }
      }
      if (review.artifactRecovery) {
        if (!recoveryEnvelope || !recoveredInput || !recoveredReplacement) {
          artifactRecoveryMismatches.push("missing or invalid recovery scan receipt");
        } else {
          const expectedRecovery = sourceFormulaArtifactRecoveryProvenance(
            recoveryEnvelope,
            recoveredInput,
            recoveredReplacement,
          );
          if (JSON.stringify(review.artifactRecovery) !== JSON.stringify(expectedRecovery)) {
            artifactRecoveryMismatches.push("artifactRecovery provenance");
          }
          if (
            input.inputExactText !== recoveredReplacement.exactText ||
            input.inputCaption !== recoveredReplacement.caption ||
            !sameSourceVisualBBox(input.bbox, recoveredReplacement.bbox) ||
            input.equationCropSha256 !== recoveredReplacement.equationCropSha256 ||
            !sameSourceVisualBBox(current.bbox, recoveredReplacement.bbox) ||
            current.equationCropSha256 !== recoveredReplacement.equationCropSha256 ||
            !sameSourceVisualBBox(visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 }, recoveredReplacement.bbox)
          ) {
            artifactRecoveryMismatches.push("re-review did not consume recovered bbox/crop");
          }
        }
      }
      const topologySlot = topologyReceipt?.recovery.activeFormulaSlots.find((candidate) =>
        candidate.sourceVisualId === visual.sourceVisualId,
      );
      const artifactTopologyRecoveryMismatches: string[] = [];
      if (topologySlot && !review.artifactTopologyRecovery) {
        artifactTopologyRecoveryMismatches.push("missing artifactTopologyRecovery provenance");
      }
      if (review.artifactTopologyRecovery) {
        if (!topologyReceipt || !topologySlot) {
          artifactTopologyRecoveryMismatches.push("missing or invalid topology recovery scan receipt");
        } else {
          const expectedTopologyRecovery = sourceFormulaArtifactTopologyRecoveryProvenance(
            topologyReceipt.recovery,
            topologySlot,
            topologyReceipt.topologyReview,
          );
          if (
            Boolean(review.artifactTopologyCandidateRepair) ||
            Boolean(review.artifactTopologyConsensusRepair) ||
            JSON.stringify(review.artifactTopologyRecovery) !== JSON.stringify(expectedTopologyRecovery)
          ) {
            artifactTopologyRecoveryMismatches.push("artifactTopologyRecovery provenance");
          }
          if (
            input.inputExactText !== topologySlot.exactText ||
            input.inputCaption !== topologySlot.caption ||
            !sameSourceVisualBBox(input.bbox, topologySlot.bbox) ||
            input.equationCropSha256 !== topologySlot.equationCropSha256 ||
            !sameSourceVisualBBox(current.bbox, topologySlot.bbox) ||
            current.equationCropSha256 !== topologySlot.equationCropSha256 ||
            !sameSourceVisualBBox(visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 }, topologySlot.bbox)
          ) {
            artifactTopologyRecoveryMismatches.push("re-review did not consume topology-recovered bbox/crop");
          }
        }
      }
      const topologyCandidateSlot = topologyCandidateRepairReceipt?.candidate.activeFormulaSlots.find((candidate) =>
        candidate.sourceVisualId === visual.sourceVisualId,
      );
      const artifactTopologyCandidateRepairMismatches: string[] = [];
      if (topologyCandidateSlot && !review.artifactTopologyCandidateRepair) {
        artifactTopologyCandidateRepairMismatches.push("missing artifactTopologyCandidateRepair provenance");
      }
      if (review.artifactTopologyCandidateRepair) {
        if (!topologyCandidateRepairReceipt || !topologyCandidateSlot) {
          artifactTopologyCandidateRepairMismatches.push("missing or invalid topology candidate-repair scan receipt");
        } else {
          const expectedTopologyCandidateRepair = sourceFormulaArtifactTopologyCandidateRepairProvenance(
            topologyCandidateRepairReceipt.envelope,
            topologyCandidateRepairReceipt.candidate,
            topologyCandidateSlot,
            topologyCandidateRepairReceipt.topologyReview,
          );
          if (
            Boolean(review.artifactTopologyRecovery) ||
            Boolean(review.artifactTopologyConsensusRepair) ||
            JSON.stringify(review.artifactTopologyCandidateRepair) !==
              JSON.stringify(expectedTopologyCandidateRepair)
          ) {
            artifactTopologyCandidateRepairMismatches.push("artifactTopologyCandidateRepair provenance");
          }
          if (
            input.inputExactText !== topologyCandidateSlot.exactText ||
            input.inputCaption !== topologyCandidateSlot.caption ||
            !sameSourceVisualBBox(input.bbox, topologyCandidateSlot.bbox) ||
            input.equationCropSha256 !== topologyCandidateSlot.equationCropSha256 ||
            !sameSourceVisualBBox(current.bbox, topologyCandidateSlot.bbox) ||
            current.equationCropSha256 !== topologyCandidateSlot.equationCropSha256 ||
            !sameSourceVisualBBox(
              visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 },
              topologyCandidateSlot.bbox,
            )
          ) {
            artifactTopologyCandidateRepairMismatches.push("re-review did not consume topology candidate-recovered bbox/crop");
          }
        }
      }
      const topologyConsensusSlot = topologyConsensusRepairReceipt?.candidate.activeFormulaSlots.find((candidate) =>
        candidate.sourceVisualId === visual.sourceVisualId,
      );
      const artifactTopologyConsensusRepairMismatches: string[] = [];
      if (topologyConsensusSlot && !review.artifactTopologyConsensusRepair) {
        artifactTopologyConsensusRepairMismatches.push("missing artifactTopologyConsensusRepair provenance");
      }
      if (review.artifactTopologyConsensusRepair) {
        if (!topologyConsensusRepairReceipt || !topologyConsensusSlot) {
          artifactTopologyConsensusRepairMismatches.push("missing or invalid topology consensus-repair scan receipt");
        } else {
          const expectedTopologyConsensusRepair = sourceFormulaArtifactTopologyConsensusRepairProvenance(
            topologyConsensusRepairReceipt.envelope,
            topologyConsensusRepairReceipt.candidate,
            topologyConsensusSlot,
            topologyConsensusRepairReceipt.topologyReview,
          );
          if (
            Boolean(review.artifactTopologyRecovery) ||
            Boolean(review.artifactTopologyCandidateRepair) ||
            JSON.stringify(review.artifactTopologyConsensusRepair) !==
              JSON.stringify(expectedTopologyConsensusRepair)
          ) {
            artifactTopologyConsensusRepairMismatches.push("artifactTopologyConsensusRepair provenance");
          }
          if (
            input.inputExactText !== topologyConsensusSlot.exactText ||
            input.inputCaption !== topologyConsensusSlot.caption ||
            !sameSourceVisualBBox(input.bbox, topologyConsensusSlot.bbox) ||
            input.equationCropSha256 !== topologyConsensusSlot.equationCropSha256 ||
            !sameSourceVisualBBox(current.bbox, topologyConsensusSlot.bbox) ||
            current.equationCropSha256 !== topologyConsensusSlot.equationCropSha256 ||
            !sameSourceVisualBBox(
              visual.bbox ?? { x: -1, y: -1, width: -1, height: -1 },
              topologyConsensusSlot.bbox,
            )
          ) {
            artifactTopologyConsensusRepairMismatches.push("re-review did not consume topology consensus-recovered bbox/crop");
          }
        }
      }
      const mismatches = [
        review.schemaVersion !== envelope.schemaVersion && "schemaVersion",
        review.promptVersion !== envelope.promptVersion && "promptVersion",
        review.model !== envelope.model && "model",
        review.reviewedAt !== envelope.reviewedAt && "reviewedAt",
        review.decision !== expectedDecision && "decision",
        review.identityAssessment !== decision.identityAssessment && "identityAssessment",
        review.inputExactText !== input.inputExactText && "inputExactText",
        review.inputCaption !== input.inputCaption && "inputCaption",
        review.acceptedExactText !== decision.acceptedExactText && "acceptedExactText",
        review.acceptedCaption !== decision.acceptedCaption && "acceptedCaption",
        review.reason !== decision.reason && "reason",
        review.pageImageSha256 !== evidence.pageImageSha256 && "pageImageSha256",
        review.equationCropSha256 !== current.equationCropSha256 && "equationCropSha256",
        review.canonicalPageTextSha256 !== evidence.canonicalPageTextSha256 && "canonicalPageTextSha256",
        review.sourcePdfSha256 !== evidence.sourcePdfSha256 && "sourcePdfSha256",
        review.requestSha256 !== envelope.requestSha256 && "requestSha256",
        review.responseSha256 !== envelope.responseSha256 && "responseSha256",
        review.cacheKey !== envelope.cacheKey && "cacheKey",
        review.cacheIntegritySha256 !== envelope.integritySha256 && "cacheIntegritySha256",
        review.reviewRecordPath !== expectedReviewRecordPath && "reviewRecordPath",
        review.reviewedPageImagePath !== expectedReviewedPageImagePath && "reviewedPageImagePath",
        review.reviewedEquationCropPath !== expectedReviewedCropPath && "reviewedEquationCropPath",
        review.semanticAttempt !== envelope.semanticAttempt && "semanticAttempt",
        review.identityAssessment !== "preserved" && "preserved identity",
        Number(Boolean(review.artifactTopologyRecovery)) +
          Number(Boolean(review.artifactTopologyCandidateRepair)) +
          Number(Boolean(review.artifactTopologyConsensusRepair)) > 1 &&
          "multiple topology recovery provenance variants",
        visual.exactText?.trim() !== decision.acceptedExactText && "ledger exactText projection",
        visual.caption.trim() !== decision.acceptedCaption && "ledger caption projection",
        ...artifactRecoveryMismatches,
        ...artifactTopologyRecoveryMismatches,
        ...artifactTopologyCandidateRepairMismatches,
        ...artifactTopologyConsensusRepairMismatches,
      ].filter((value): value is string => Boolean(value));
      if (mismatches.length > 0) {
        problems.push(
          `Formula-review provenance mismatch for ${visual.sourceVisualId}: ${mismatches.join(", ")}.`,
        );
      }
    }
  }
  let reviewSetHash = "";
  if (problems.length === 0) {
    try {
      reviewSetHash = computeSourceFormulaReviewSetHash(
        ledger,
        formulaIds,
        expectedSourceIds ?? [],
        sourceIdentityMap,
        actualTopologyReviewPageReceipts,
      );
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (
    options.expectedReviewSetHash &&
    reviewSetHash &&
    reviewSetHash !== options.expectedReviewSetHash
  ) {
    problems.push(
      `Reviewed formula-set hash mismatch: expected ${options.expectedReviewSetHash}, found ${reviewSetHash}.`,
    );
  }
  return { formulaIds, reviewSetHash, problems };
}

export function sourceFormulaReviewProvenanceProblems(
  options: SourceFormulaReviewValidationOptions,
): string[] {
  return validateSourceFormulaReviewSet(options).problems;
}

export class SourceVisualDetectionProtocolError extends Error {
  constructor(message: string) {
    super(`Source visual detection protocol error: ${message}`);
    this.name = "SourceVisualDetectionProtocolError";
  }
}

function validateDetectionRecords(parsed: unknown): SourceVisualDetection[] {
  if (!Array.isArray(parsed)) {
    throw new SourceVisualDetectionProtocolError("top level must be a JSON array");
  }

  const valid = new Set(["figure", "graph", "table", "equation", "diagram"]);
  return parsed.map((item, index): SourceVisualDetection => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new SourceVisualDetectionProtocolError(`entry ${index} must be an object`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.type !== "string" || !valid.has(record.type)) {
      throw new SourceVisualDetectionProtocolError(`entry ${index} has an invalid type`);
    }
    const type = record.type as SourceVisualType;
    if (typeof record.caption !== "string" || !record.caption.trim()) {
      throw new SourceVisualDetectionProtocolError(`entry ${index} caption must be a non-empty string`);
    }
    const caption = record.caption.trim();

    let exactText: string | undefined;
    if (type === "equation") {
      if (typeof record.exactText !== "string" || !record.exactText.trim()) {
        throw new SourceVisualDetectionProtocolError(
          `entry ${index} equation exactText must be a non-empty string`,
        );
      }
      exactText = record.exactText.trim();
    } else if (record.exactText !== undefined) {
      throw new SourceVisualDetectionProtocolError(
        `entry ${index} exactText is only valid for equations`,
      );
    }

    const rawBox = record.bbox;
    if (!rawBox || typeof rawBox !== "object" || Array.isArray(rawBox)) {
      throw new SourceVisualDetectionProtocolError(`entry ${index} bbox must be an object`);
    }
    const box = rawBox as Record<string, unknown>;
    const coordinates = ["x", "y", "width", "height"] as const;
    for (const coordinate of coordinates) {
      if (typeof box[coordinate] !== "number" || !Number.isFinite(box[coordinate])) {
        throw new SourceVisualDetectionProtocolError(
          `entry ${index} bbox.${coordinate} must be a finite number`,
        );
      }
    }
    const bbox: SourceVisualBBox = {
      x: box.x as number,
      y: box.y as number,
      width: box.width as number,
      height: box.height as number,
    };
    if (
      bbox.x < 0 ||
      bbox.y < 0 ||
      bbox.width <= 0 ||
      bbox.height <= 0 ||
      bbox.x + bbox.width > 1 ||
      bbox.y + bbox.height > 1
    ) {
      throw new SourceVisualDetectionProtocolError(
        `entry ${index} bbox must be a positive rectangle fully inside the page`,
      );
    }
    if (bbox.width * bbox.height >= 0.9) {
      throw new SourceVisualDetectionProtocolError(
        `entry ${index} bbox covers the whole page instead of one visual`,
      );
    }

    return {
      type,
      caption,
      ...(exactText ? { exactText } : {}),
      bbox,
    };
  });
}

function parseDetections(raw: unknown): SourceVisualDetection[] {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SourceVisualDetectionProtocolError("response was empty or missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SourceVisualDetectionProtocolError(
      `response was not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return validateDetectionRecords(parsed);
}

const SOURCE_VISUAL_BBOX_FALLBACK_TOLERANCE = 0.05;

function parseDetectionsWithNarrowFallbacks(
  raw: unknown,
  pageNumber?: number,
): {
  detections: SourceVisualDetection[];
  repairedCaptionCount: number;
  repairedBBoxCount: number;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SourceVisualDetectionProtocolError("response was empty or missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SourceVisualDetectionProtocolError(
      `response was not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new SourceVisualDetectionProtocolError("top level must be a JSON array");
  }
  let repairedCaptionCount = 0;
  let repairedBBoxCount = 0;
  const repaired = parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    let nextRecord = record;
    if (!(typeof record.caption === "string" && record.caption.trim())) {
      repairedCaptionCount += 1;
      const type =
        typeof record.type === "string" && record.type.trim()
          ? record.type.trim()
          : "visual";
      const exactText =
        typeof record.exactText === "string" ? record.exactText.trim() : "";
      const pageLabel = pageNumber ? ` on source page ${pageNumber}` : "";
      nextRecord = {
        ...nextRecord,
        caption:
          type === "equation" && exactText
            ? `Displayed equation${pageLabel}: ${exactText.slice(0, 240)}`
            : `Detected ${type}${pageLabel}`,
      };
    }

    const rawBox = record.bbox;
    if (rawBox && typeof rawBox === "object" && !Array.isArray(rawBox)) {
      const box = rawBox as Record<string, unknown>;
      const x = box.x;
      const y = box.y;
      const width = box.width;
      const height = box.height;
      if (
        typeof x === "number" && Number.isFinite(x) &&
        typeof y === "number" && Number.isFinite(y) &&
        typeof width === "number" && Number.isFinite(width) && width > 0 &&
        typeof height === "number" && Number.isFinite(height) && height > 0
      ) {
        const right = x + width;
        const bottom = y + height;
        const outsidePage = x < 0 || y < 0 || right > 1 || bottom > 1;
        const marginalOvershoot =
          x >= -SOURCE_VISUAL_BBOX_FALLBACK_TOLERANCE &&
          y >= -SOURCE_VISUAL_BBOX_FALLBACK_TOLERANCE &&
          right <= 1 + SOURCE_VISUAL_BBOX_FALLBACK_TOLERANCE &&
          bottom <= 1 + SOURCE_VISUAL_BBOX_FALLBACK_TOLERANCE;
        if (outsidePage && marginalOvershoot) {
          const clampedX = Math.max(0, x);
          const clampedY = Math.max(0, y);
          const clampedRight = Math.min(1, right);
          const clampedBottom = Math.min(1, bottom);
          if (clampedRight > clampedX && clampedBottom > clampedY) {
            repairedBBoxCount += 1;
            nextRecord = {
              ...nextRecord,
              bbox: {
                x: clampedX,
                y: clampedY,
                width: clampedRight - clampedX,
                height: clampedBottom - clampedY,
              },
            };
          }
        }
      }
    }
    return nextRecord;
  });
  return {
    detections: validateDetectionRecords(repaired),
    repairedCaptionCount,
    repairedBBoxCount,
  };
}

async function detectVisualsOnPage(
  client: OpenAI,
  model: string,
  pngBuffer: Buffer,
  options: Pick<ExtractSourceVisualsOptions, "checkpoint" | "onProgress"> = {},
  pageNumber?: number,
): Promise<SourceVisualDetection[]> {
  const detectionBuffer =
    resizePngToMaxDimension(pngBuffer, DETECTION_IMAGE_MAX_DIMENSION) ?? pngBuffer;
  const dataUrl = `data:image/png;base64,${detectionBuffer.toString("base64")}`;
  let priorProtocolError = "";
  for (
    let semanticAttempt = 1;
    semanticAttempt <= SOURCE_VISUAL_DETECTION_MAX_SEMANTIC_ATTEMPTS;
    semanticAttempt += 1
  ) {
    const response = await createSourceModelCompletionWithHttp502Retry({
      client,
      request: {
        model,
        messages: [
          { role: "system", content: DETECTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
              {
                type: "text",
                text:
                  semanticAttempt === 1
                    ? "List the meaningful visuals on this page as the JSON array described. Return [] if there are none."
                    : "Re-evaluate this same page and return a fresh, complete JSON array. " +
                      `The prior response was rejected because ${priorProtocolError}. ` +
                      "Every entry must satisfy every required field; return [] if no entry can be described validly.",
              },
            ],
          },
        ],
      },
      timeoutMs: sourceVisualDetectionTimeoutMs(),
      checkpoint: options.checkpoint,
      onProgress: options.onProgress,
      stageLabel: `source visual scan${pageNumber ? ` for page ${pageNumber}` : ""}`,
      fallbackAfterFailures: SOURCE_VISUAL_DETECTION_MAX_TRANSIENT_FAILURES,
      fallbackContent: "[]",
    });
    try {
      return parseDetections(response.choices[0]?.message?.content);
    } catch (error) {
      if (!(error instanceof SourceVisualDetectionProtocolError)) {
        throw error;
      }
      if (semanticAttempt >= SOURCE_VISUAL_DETECTION_MAX_SEMANTIC_ATTEMPTS) {
        if (
          /caption must be a non-empty string/u.test(error.message) ||
          /bbox must be a positive rectangle fully inside the page/u.test(error.message)
        ) {
          const repaired = parseDetectionsWithNarrowFallbacks(
            response.choices[0]?.message?.content,
            pageNumber,
          );
          if (repaired.repairedCaptionCount > 0) {
            options.onProgress?.(
              `Source visual scan used ${repaired.repairedCaptionCount} bounded fallback caption${
                repaired.repairedCaptionCount === 1 ? "" : "s"
              }${pageNumber ? ` on page ${pageNumber}` : ""}.`,
            );
          }
          if (repaired.repairedBBoxCount > 0) {
            options.onProgress?.(
              `Source visual scan clamped ${repaired.repairedBBoxCount} marginal page-edge bbox${
                repaired.repairedBBoxCount === 1 ? "" : "es"
              }${pageNumber ? ` on page ${pageNumber}` : ""}.`,
            );
          }
          return repaired.detections;
        }
        throw error;
      }
      priorProtocolError = error.message;
      options.checkpoint?.();
      options.onProgress?.(
        `Invalid source visual scan response; automatically retrying${
          pageNumber ? ` page ${pageNumber}` : ""
        } (semantic retry ${semanticAttempt} of ${
          SOURCE_VISUAL_DETECTION_MAX_SEMANTIC_ATTEMPTS - 1
        })...`,
      );
    }
  }
  throw new SourceVisualDetectionProtocolError(
    "semantic retry loop exited without a result",
  );
}

export interface ExtractSourceVisualsOptions {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenSlug: string;
  /** Basename slug of the source note (e.g. "2510-27379v1"). */
  sourceId: string;
  /** 1-based index of the source within the garden, for S{n} ids. */
  sourceIndex: number;
  /** Garden-relative URLs of the page snapshot images, in page order. */
  pageImageUrls: string[];
  /** Re-run detection even when the ledger already covers this source. */
  force?: boolean;
  /** Called between page requests so cancellation preserves completed scans. */
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
  maxPages?: number;
  /** Test seam; production re-renders the preserved source PDF directly. */
  renderPdfPage?: (input: {
    sourceId: string;
    pageNumber: number;
    sourcePdfPath: string;
    sourcePdf: Buffer;
  }) => Promise<Buffer>;
}

/**
 * A stale V5 receipt may not be replaced by scanning whatever PNG happened to
 * be persisted at its old URL.  Before a replacement scan, materialize the
 * exact current canonical PDF page at the same high-detail width used by
 * formula review.  Source-PDF absence or rendering failure is intentionally a
 * hard error: otherwise an empty low-detail scan could erase an all-retired
 * topology tombstone.
 */
async function renderCurrentSourcePdfPageForTopologyInvalidation(
  options: ExtractSourceVisualsOptions,
  pageNumber: number,
): Promise<Buffer> {
  const sourcePdf = sourcePdfEvidence(
    options.contentPath,
    options.gardenSlug,
    options.sourceId,
  );
  options.checkpoint?.();
  let rendered: Buffer;
  if (options.renderPdfPage) {
    rendered = Buffer.from(await options.renderPdfPage({
      sourceId: options.sourceId,
      pageNumber,
      sourcePdfPath: sourcePdf.sourcePdfPath,
      sourcePdf: sourcePdf.sourcePdf,
    }));
  } else {
    const parser = new PDFParse({ data: sourcePdf.sourcePdf });
    try {
      const info = await parser.getInfo();
      if (pageNumber > info.total) {
        throw new Error(
          `Preserved source PDF ${options.sourceId} has ${info.total} page(s), not page ${pageNumber}.`,
        );
      }
      const screenshot = await parser.getScreenshot({
        partial: [pageNumber],
        desiredWidth: 1600,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const page = screenshot.pages.find((candidate) => candidate.pageNumber === pageNumber);
      if (!page?.data?.length) {
        throw new Error(`Preserved source PDF page ${options.sourceId} p.${pageNumber} could not be rendered.`);
      }
      rendered = Buffer.from(page.data);
    } finally {
      await parser.destroy();
    }
  }
  if (!rendered.length || rendered.length > SOURCE_FORMULA_REVIEW_MAX_PAGE_BYTES) {
    throw new Error(
      `Current preserved source PDF page ${options.sourceId} p.${pageNumber} rendered invalid page evidence.`,
    );
  }
  options.checkpoint?.();
  return rendered;
}

function persistCurrentSourcePdfPageSnapshot(
  snapshotPath: string,
  pageImage: Buffer,
): void {
  const temporaryPath = `${snapshotPath}.${process.pid}.${Date.now()}.canonical-pdf.tmp`;
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(temporaryPath, pageImage);
  replaceSourceFormulaArtifactRecoveryFile(snapshotPath, temporaryPath);
  if (!fs.existsSync(snapshotPath) || sha256(fs.readFileSync(snapshotPath)) !== sha256(pageImage)) {
    throw new Error("Current canonical source PDF page snapshot did not persist atomically.");
  }
}

/**
 * Detect + crop meaningful visuals on the supplied pages. Extraction is
 * incremental: prior pages remain in the ledger while newly supplied pages are
 * scanned (or restored from the per-page scan cache).
 */
export async function extractSourceVisuals(
  options: ExtractSourceVisualsOptions,
): Promise<SourceVisual[]> {
  const {
    client,
    model,
    contentPath,
    gardenSlug,
    sourceId,
    sourceIndex,
    pageImageUrls,
    force = false,
    checkpoint,
    onProgress,
    maxPages,
  } = options;

  const ledger = loadSourceVisuals(contentPath, gardenSlug);
  const existing = ledger.filter((visual) => visual.sourceId === sourceId);

  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  const sourceCache = scanCache.sources[sourceId] ?? {};
  scanCache.sources[sourceId] = sourceCache;
  const cropDir = path.join(contentPath, gardenSlug, CROPPED_ASSETS_FOLDER);
  const found: SourceVisual[] = [];
  const replacedPages = new Set<number>();
  const counters = new Map<string, number>();

  const nextId = (pageNumber: number, type: SourceVisualType): string => {
    const letter = TYPE_LETTER[type];
    const key = `${pageNumber}:${letter}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return `S${sourceIndex}.P${pageNumber}.${letter}${next}`;
  };

  const requestedPageUrls = Number.isFinite(maxPages) && (maxPages ?? 0) > 0
    ? pageImageUrls.slice(0, Math.floor(maxPages!))
    : pageImageUrls;
  for (const pageUrl of requestedPageUrls) {
    checkpoint?.();
    const pageNumber = pageNumberFromAssetUrl(pageUrl) ?? 0;
    if (pageNumber < 1) continue;
    // Read the live snapshot before deciding that an already-projected v4
    // page can be skipped. A changed PNG must invalidate its receipt and take
    // the normal re-detection path; comparing only the cache's own stored
    // fingerprint would silently trust stale crops.
    const diskPath = assetDiskPath(contentPath, gardenSlug, pageUrl);
    const cachedBeforePageRead = sourceCache[pageUrl];
    const v5Recovery = cachedBeforePageRead?.formulaArtifactTopologyRecovery;
    const v6CandidateRepair = cachedBeforePageRead?.formulaArtifactTopologyCandidateRepair;
    const v7ConsensusRepair = cachedBeforePageRead?.formulaArtifactTopologyConsensusRepair;
    if (!diskPath) continue;
    let pngBuffer: Buffer;
    let fingerprint = "";
    let renderedMissingTopologySnapshot = false;
    if (!fs.existsSync(diskPath)) {
      // A V5/V6/V7 entry can be the only durable topology tombstone for a page with
      // zero remaining formula rows.  Do not strand it merely because the
      // transient page asset disappeared: recover the asset only from the
      // current canonical PDF, never from an old cache payload.
      const canRecoverMissingTopologySnapshot = Boolean(
        (
          cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
          v5Recovery &&
          sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
            cachedBeforePageRead,
            pageUrl,
            cachedBeforePageRead.fingerprint,
          )
        ) ||
        (
          cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION &&
          v6CandidateRepair &&
          sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(
            cachedBeforePageRead,
            pageUrl,
            cachedBeforePageRead.fingerprint,
          )
        ) ||
        (
          cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION &&
          v7ConsensusRepair &&
          sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(
            cachedBeforePageRead,
            pageUrl,
            cachedBeforePageRead.fingerprint,
          )
        ),
      );
      if (!canRecoverMissingTopologySnapshot) continue;
      onProgress?.(`Restoring missing canonical PDF page ${pageNumber} for topology evidence...`);
      pngBuffer = await renderCurrentSourcePdfPageForTopologyInvalidation(options, pageNumber);
      persistCurrentSourcePdfPageSnapshot(diskPath, pngBuffer);
      fingerprint = sha256(pngBuffer);
      renderedMissingTopologySnapshot = true;
    } else {
      try {
        pngBuffer = fs.readFileSync(diskPath);
      } catch {
        continue;
      }
      fingerprint = crypto.createHash("sha256").update(pngBuffer).digest("hex");
    }
    // Never let a malformed *current-evidence* V5/V6 entry fall through to
    // the generic detector and overwrite the only durable cap/history. A
    // malformed receipt is still allowed to age out when its own signed
    // Markdown/PDF/render evidence no longer matches the live source: in
    // that case the canonical-refresh path below must start a genuinely new
    // evidence cycle rather than strand the page forever. This distinction
    // deliberately uses the raw receipt's historical source evidence before
    // deciding whether a corrupt container is terminal for this page.
    const rawTopologyRecoveryHasCurrentEvidence = Boolean(
      v5Recovery &&
      sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
        contentPath,
        gardenSlug,
        v5Recovery,
        fingerprint,
      ),
    );
    const rawTopologyCandidateRepairHasCurrentEvidence = Boolean(
      v6CandidateRepair &&
      sourceFormulaArtifactTopologyCandidateRepairHasCurrentEvidence(
        contentPath,
        gardenSlug,
        v6CandidateRepair,
        fingerprint,
      ),
    );
    const rawTopologyConsensusRepairHasCurrentEvidence = Boolean(
      v7ConsensusRepair &&
      sourceFormulaArtifactTopologyConsensusRepairHasCurrentEvidence(
        contentPath,
        gardenSlug,
        v7ConsensusRepair,
        fingerprint,
      ),
    );
    if (
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION &&
      cachedBeforePageRead.fingerprint === fingerprint &&
      rawTopologyCandidateRepairHasCurrentEvidence &&
      !sourceFormulaArtifactTopologyCandidateRepairScanEntryMatches(
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
      )
    ) {
      throw new Error("Formula-artifact topology candidate repair cache is malformed for current page evidence; refusing generic re-detection.");
    }
    if (
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
      cachedBeforePageRead.fingerprint === fingerprint &&
      rawTopologyRecoveryHasCurrentEvidence &&
      !sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
      )
    ) {
      throw new Error("Formula-artifact topology recovery cache is malformed for current page evidence; refusing generic re-detection.");
    }
    if (
      v7ConsensusRepair &&
      rawTopologyConsensusRepairHasCurrentEvidence &&
      !sourceFormulaArtifactTopologyConsensusRepairScanEntryMatches(
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
      )
    ) {
      throw new Error("Formula-artifact topology consensus repair cache is malformed for current page evidence; refusing generic re-detection.");
    }
    const existingOnPage = existing.filter((visual) => visual.pageNumber === pageNumber);
    // Legacy ledgers predate the scan cache. An existing page entry still
    // proves that page completed, and must not prevent later pages from being
    // scanned.
    const needsEquationTextUpgrade = existingOnPage.some(
      (visual) => visual.type === "equation" && !visual.exactText?.trim(),
    );
    const needsRecoveryRehydration =
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_RECOVERY_DETECTOR_VERSION &&
      !sourceFormulaArtifactRecoveryPageIsFaithfullyProjected(
        contentPath,
        gardenSlug,
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
        pngBuffer,
        existingOnPage,
    );
    // A V5/V6 receipt which does not match all of its current evidence cannot be
    // replaced by detecting the old persisted PNG.  First render the exact
    // current preserved-PDF page.  This both prevents stale-image laundering
    // and makes a missing/unrenderable PDF a hard, non-destructive failure.
    if (
      (
        (
          cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
          v5Recovery &&
          !sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
            contentPath,
            gardenSlug,
            v5Recovery,
            fingerprint,
          )
        ) ||
        (
          v6CandidateRepair &&
          !sourceFormulaArtifactTopologyCandidateRepairHasCurrentEvidence(
            contentPath,
            gardenSlug,
            v6CandidateRepair,
            fingerprint,
          )
        ) ||
        (
          v7ConsensusRepair &&
          !sourceFormulaArtifactTopologyConsensusRepairHasCurrentEvidence(
            contentPath,
            gardenSlug,
            v7ConsensusRepair,
            fingerprint,
          )
        )
      ) &&
      !renderedMissingTopologySnapshot
    ) {
      onProgress?.(`Refreshing canonical PDF page ${pageNumber} before invalidating topology evidence...`);
      pngBuffer = await renderCurrentSourcePdfPageForTopologyInvalidation(options, pageNumber);
      persistCurrentSourcePdfPageSnapshot(diskPath, pngBuffer);
      fingerprint = sha256(pngBuffer);
    }
    // A topology receipt may only rehydrate the ledger when every piece of
    // evidence it signed is still current.  The PNG hash alone is insufficient
    // because source Markdown/PDF changes can leave an old snapshot byte-wise
    // unchanged.  On a mismatch we deliberately fall through to the normal
    // detector/review path (or fail closed if that path cannot complete).
    const topologyRecoveryHasCurrentEvidence = Boolean(
      v5Recovery &&
      sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
        contentPath,
        gardenSlug,
        v5Recovery,
        fingerprint,
      ),
    );
    const topologyCandidateRepairHasCurrentEvidence = Boolean(
      v6CandidateRepair &&
      sourceFormulaArtifactTopologyCandidateRepairHasCurrentEvidence(
        contentPath,
        gardenSlug,
        v6CandidateRepair,
        fingerprint,
      ),
    );
    const topologyConsensusRepairHasCurrentEvidence = Boolean(
      v7ConsensusRepair &&
      sourceFormulaArtifactTopologyConsensusRepairHasCurrentEvidence(
        contentPath,
        gardenSlug,
        v7ConsensusRepair,
        fingerprint,
      ),
    );
    const strictTopologyCandidateRepair = topologyCandidateRepairHasCurrentEvidence
      ? sourceFormulaArtifactTopologyCandidateRepairLiveEnvelope(
        contentPath,
        gardenSlug,
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
        pngBuffer,
      )
      : null;
    const strictTopologyConsensusRepair = topologyConsensusRepairHasCurrentEvidence
      ? sourceFormulaArtifactTopologyConsensusRepairLiveEnvelope(
        contentPath,
        gardenSlug,
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
        pngBuffer,
      )
      : null;
    if (
      v6CandidateRepair &&
      topologyCandidateRepairHasCurrentEvidence &&
      !strictTopologyCandidateRepair
    ) {
      throw new Error(
        "Formula-artifact topology candidate repair history is malformed for current source evidence; refusing generic re-detection.",
      );
    }
    if (
      v7ConsensusRepair &&
      topologyConsensusRepairHasCurrentEvidence &&
      !strictTopologyConsensusRepair
    ) {
      throw new Error(
        "Formula-artifact topology consensus repair history is malformed for current source evidence; refusing generic re-detection.",
      );
    }
    const hasConfirmedTopologyRecovery = Boolean(
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
      v5Recovery &&
      topologyRecoveryHasCurrentEvidence &&
      sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
      ) &&
      sourceFormulaArtifactTopologyReviewScanEntryIsConfirmed(
        cachedBeforePageRead,
        v5Recovery,
        fingerprint,
      ),
    );
    const hasConfirmedTopologyCandidateRepair = Boolean(
      strictTopologyCandidateRepair &&
      sourceFormulaArtifactTopologyCandidateRepairFinalEntry(strictTopologyCandidateRepair)?.topologyReview?.status === "confirmed",
    );
    const hasConfirmedTopologyConsensusRepair = Boolean(
      strictTopologyConsensusRepair &&
      sourceFormulaArtifactTopologyConsensusRepairIsProjectionConfirmed(strictTopologyConsensusRepair),
    );
    const needsTopologyRecoveryRehydration = Boolean(
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
      v5Recovery &&
      (
        !hasConfirmedTopologyRecovery ||
        !sourceFormulaArtifactTopologyRecoveryPageIsFaithfullyProjected(
          contentPath,
          gardenSlug,
          cachedBeforePageRead,
          pageUrl,
          fingerprint,
          pngBuffer,
          existingOnPage,
        )
      ),
    );
    const needsTopologyCandidateRepairRehydration = Boolean(
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION &&
      v6CandidateRepair &&
      (
        !hasConfirmedTopologyCandidateRepair ||
        !sourceFormulaArtifactTopologyCandidateRepairPageIsFaithfullyProjected(
          contentPath,
          gardenSlug,
          cachedBeforePageRead,
          pageUrl,
          fingerprint,
          pngBuffer,
          existingOnPage,
        )
      ),
    );
    const needsTopologyConsensusRepairRehydration = Boolean(
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION &&
      v7ConsensusRepair &&
      (
        !hasConfirmedTopologyConsensusRepair ||
        !sourceFormulaArtifactTopologyConsensusRepairPageIsFaithfullyProjected(
          contentPath,
          gardenSlug,
          cachedBeforePageRead,
          pageUrl,
          fingerprint,
          pngBuffer,
          existingOnPage,
        )
      ),
    );
    // A valid V5 receipt whose topology review was rejected (or did not
    // complete) is a durable one-cycle cap, not an alternate detector input.
    // Preserve the existing ledger page so a fresh low-detail v3 scan cannot
    // erase the evidence or restart the topology loop.
    const topologyRecoveryBlocksRedetection = Boolean(
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_RECOVERY_DETECTOR_VERSION &&
      v5Recovery &&
      sourceFormulaArtifactTopologyRecoveryScanEntryMatches(
        cachedBeforePageRead,
        pageUrl,
        fingerprint,
      ) &&
      topologyRecoveryHasCurrentEvidence &&
      !hasConfirmedTopologyRecovery,
    );
    const topologyCandidateRepairBlocksRedetection = Boolean(
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CANDIDATE_REPAIR_DETECTOR_VERSION &&
      v6CandidateRepair &&
      Boolean(strictTopologyCandidateRepair) &&
      !hasConfirmedTopologyCandidateRepair,
    );
    const topologyConsensusRepairBlocksRedetection = Boolean(
      cachedBeforePageRead?.detectorVersion === SOURCE_FORMULA_ARTIFACT_TOPOLOGY_CONSENSUS_REPAIR_DETECTOR_VERSION &&
      v7ConsensusRepair &&
      Boolean(strictTopologyConsensusRepair) &&
      !hasConfirmedTopologyConsensusRepair,
    );
    if (
      !force &&
      Boolean(cachedBeforePageRead) &&
      cachedBeforePageRead?.fingerprint === fingerprint &&
      existingOnPage.length > 0 &&
      !needsEquationTextUpgrade &&
      !needsRecoveryRehydration &&
      !needsTopologyRecoveryRehydration &&
      !needsTopologyCandidateRepairRehydration &&
      !needsTopologyConsensusRepairRehydration
    ) continue;
    if (
      topologyRecoveryBlocksRedetection ||
      topologyCandidateRepairBlocksRedetection ||
      topologyConsensusRepairBlocksRedetection
    ) continue;
    const cached = sourceCache[pageUrl];
    let detections: SourceVisualDetection[] = [];
    let reusedCachedScan = false;
    const reusableRecoveryScan = sourceFormulaArtifactRecoveryScanEntryMatches(
      cached,
      pageUrl,
      fingerprint,
    );
    const reusableTopologyRecoveryScan = Boolean(
      cached &&
      sourceFormulaArtifactTopologyRecoveryScanEntryMatches(cached, pageUrl, fingerprint) &&
      cached.formulaArtifactTopologyRecovery &&
      sourceFormulaArtifactTopologyRecoveryHasCurrentEvidence(
        contentPath,
        gardenSlug,
        cached.formulaArtifactTopologyRecovery,
        fingerprint,
      ) &&
      sourceFormulaArtifactTopologyReviewScanEntryIsConfirmed(
        cached,
        cached.formulaArtifactTopologyRecovery,
        fingerprint,
      ),
    );
    const reusableTopologyCandidateRepairScan = Boolean(
      cached === cachedBeforePageRead && hasConfirmedTopologyCandidateRepair,
    );
    const reusableTopologyConsensusRepairScan = Boolean(
      cached === cachedBeforePageRead && hasConfirmedTopologyConsensusRepair,
    );
    if (
      reusableRecoveryScan ||
      reusableTopologyRecoveryScan ||
      reusableTopologyCandidateRepairScan ||
      reusableTopologyConsensusRepairScan ||
      (
        !force &&
        cached?.detectorVersion === DETECTOR_VERSION &&
        cached.fingerprint === fingerprint &&
        Array.isArray(cached.detections)
      )
    ) {
      try {
        detections = validateDetectionRecords(cached.detections);
        reusedCachedScan = true;
        onProgress?.(`Reusing saved visual scan for page ${pageNumber || "?"}...`);
      } catch {
        // A corrupt or legacy cache entry is never evidence of a completed scan.
        delete sourceCache[pageUrl];
      }
    }
    if (!reusedCachedScan) {
      try {
        onProgress?.(`Scanning page ${pageNumber || "?"} for figures...`);
        detections = await detectVisualsOnPage(
          client,
          model,
          pngBuffer,
          { checkpoint, onProgress },
          pageNumber,
        );
        sourceCache[pageUrl] = {
          detectorVersion: DETECTOR_VERSION,
          fingerprint,
          detections,
        };
        // Cache successful empty results too. This file is intentionally not a
        // rollback output, so Stop/Retry never pays for completed pages again.
        saveSourceVisualScanCache(contentPath, gardenSlug, scanCache);
        checkpoint?.();
      } catch (error) {
        // A provider throw is not a successful empty detector result. Preserve
        // its exact identity so the caller cannot mistake transport ambiguity
        // for semantic evidence or replay the same page request.
        throw error;
      }
    }

    replacedPages.add(pageNumber);
    if (detections.length === 0) continue;
    const recoverySlots = reusableRecoveryScan
      ? sourceFormulaArtifactRecoveryExpectedPageSlots(cached!.formulaArtifactRecovery!)
      : null;
    const topologyRecoverySlots = reusableTopologyRecoveryScan
      ? sourceFormulaArtifactTopologyRecoveryExpectedPageSlots(cached!.formulaArtifactTopologyRecovery!)
      : null;
    const topologyCandidateRepairEnvelope = reusableTopologyCandidateRepairScan
      ? strictTopologyCandidateRepair!
      : null;
    const topologyCandidateRepairFinalEntry = topologyCandidateRepairEnvelope
      ? sourceFormulaArtifactTopologyCandidateRepairFinalEntry(topologyCandidateRepairEnvelope)
      : null;
    const topologyCandidateRepairSlots = topologyCandidateRepairFinalEntry
      ? sourceFormulaArtifactTopologyCandidateRepairExpectedPageSlots(topologyCandidateRepairFinalEntry.candidate)
      : null;
    const topologyConsensusRepairEnvelope = reusableTopologyConsensusRepairScan
      ? strictTopologyConsensusRepair!
      : null;
    const topologyConsensusRepairFinalEntry = topologyConsensusRepairEnvelope
      ? sourceFormulaArtifactTopologyConsensusRepairFinalEntry(topologyConsensusRepairEnvelope)
      : null;
    const topologyConsensusRepairSlots = topologyConsensusRepairFinalEntry
      ? sourceFormulaArtifactTopologyConsensusRepairExpectedPageSlots(topologyConsensusRepairFinalEntry.candidate)
      : null;
    if (
      (recoverySlots && recoverySlots.length !== detections.length) ||
      (topologyRecoverySlots && topologyRecoverySlots.length !== detections.length) ||
      (topologyCandidateRepairSlots && topologyCandidateRepairSlots.length !== detections.length) ||
      (topologyConsensusRepairSlots && topologyConsensusRepairSlots.length !== detections.length)
    ) {
      // A signed V4/V5/V6 receipt must replay its complete model-authored page in
      // order. Never fall through to generic nextId allocation, which could
      // renumber a non-contiguous active V5 slot or silently cherry-pick it.
      throw new Error("Formula-artifact recovery scan receipt does not describe one complete page projection.");
    }
    const existingById = new Map(existingOnPage.map((visual) => [visual.sourceVisualId, visual]));

    for (let detectionIndex = 0; detectionIndex < detections.length; detectionIndex += 1) {
      const detection = detections[detectionIndex]!;
      const recoverySlot = recoverySlots?.[detectionIndex];
      const topologyRecoverySlot = topologyRecoverySlots?.[detectionIndex];
      const topologyCandidateRepairSlot = topologyCandidateRepairSlots?.[detectionIndex];
      const topologyConsensusRepairSlot = topologyConsensusRepairSlots?.[detectionIndex];
      if (
        Number(Boolean(recoverySlot)) +
          Number(Boolean(topologyRecoverySlot)) +
          Number(Boolean(topologyCandidateRepairSlot)) +
          Number(Boolean(topologyConsensusRepairSlot)) > 1
      ) {
        throw new Error("Formula-artifact recovery cannot replay multiple signed receipts for one page.");
      }
      const sourceVisualId = recoverySlot?.sourceVisualId ??
        topologyRecoverySlot?.sourceVisualId ??
        topologyCandidateRepairSlot?.sourceVisualId ??
        topologyConsensusRepairSlot?.sourceVisualId ??
        nextId(pageNumber, detection.type);
      const prior = existingById.get(sourceVisualId);
      const replacement = recoverySlot?.replacement;
      const activeTopologySlot = topologyRecoverySlot?.activeSlot;
      const activeTopologyCandidateRepairSlot = topologyCandidateRepairSlot?.activeSlot;
      const activeTopologyConsensusRepairSlot = topologyConsensusRepairSlot?.activeSlot;
      const priorRecovery = prior?.formulaReview?.artifactRecovery;
      const priorTopologyRecovery = prior?.formulaReview?.artifactTopologyRecovery;
      const priorTopologyCandidateRepair = prior?.formulaReview?.artifactTopologyCandidateRepair;
      const priorTopologyConsensusRepair = prior?.formulaReview?.artifactTopologyConsensusRepair;
      const preservesAcceptedRecoveryReview = Boolean(
        replacement &&
        prior?.type === "equation" &&
        prior.formulaReview &&
        priorRecovery &&
        priorRecovery.cacheKey === cached?.formulaArtifactRecovery?.cacheKey &&
        priorRecovery.cacheIntegritySha256 === cached?.formulaArtifactRecovery?.integritySha256 &&
        prior.formulaReview.inputExactText === replacement.exactText &&
        prior.formulaReview.inputCaption === replacement.caption &&
      prior.bbox &&
      sameSourceVisualBBox(prior.bbox, replacement.bbox),
      );
      const preservesAcceptedTopologyRecoveryReview = Boolean(
        activeTopologySlot &&
        prior?.type === "equation" &&
        prior.formulaReview &&
        priorTopologyRecovery &&
        priorTopologyRecovery.cacheKey === cached?.formulaArtifactTopologyRecovery?.cacheKey &&
        priorTopologyRecovery.cacheIntegritySha256 === cached?.formulaArtifactTopologyRecovery?.integritySha256 &&
        priorTopologyRecovery.sourceVisualId === activeTopologySlot.sourceVisualId &&
        prior.formulaReview.inputExactText === activeTopologySlot.exactText &&
        prior.formulaReview.inputCaption === activeTopologySlot.caption &&
        prior.bbox &&
        sameSourceVisualBBox(prior.bbox, activeTopologySlot.bbox),
      );
      const preservesAcceptedTopologyCandidateRepairReview = Boolean(
        activeTopologyCandidateRepairSlot &&
        prior?.type === "equation" &&
        prior.formulaReview &&
        priorTopologyCandidateRepair &&
        priorTopologyCandidateRepair.cycleCacheKey === topologyCandidateRepairEnvelope?.cacheKey &&
        priorTopologyCandidateRepair.cycleCacheIntegritySha256 === topologyCandidateRepairEnvelope?.integritySha256 &&
        priorTopologyCandidateRepair.candidateCacheKey === topologyCandidateRepairFinalEntry?.candidate.cacheKey &&
        priorTopologyCandidateRepair.candidateCacheIntegritySha256 === topologyCandidateRepairFinalEntry?.candidate.integritySha256 &&
        priorTopologyCandidateRepair.sourceVisualId === activeTopologyCandidateRepairSlot.sourceVisualId &&
        prior.formulaReview.inputExactText === activeTopologyCandidateRepairSlot.exactText &&
        prior.formulaReview.inputCaption === activeTopologyCandidateRepairSlot.caption &&
        prior.bbox &&
        sameSourceVisualBBox(prior.bbox, activeTopologyCandidateRepairSlot.bbox),
      );
      const preservesAcceptedTopologyConsensusRepairReview = Boolean(
        activeTopologyConsensusRepairSlot &&
        prior?.type === "equation" &&
        prior.formulaReview &&
        priorTopologyConsensusRepair &&
        priorTopologyConsensusRepair.cycleCacheKey === topologyConsensusRepairEnvelope?.cacheKey &&
        priorTopologyConsensusRepair.cycleCacheIntegritySha256 === topologyConsensusRepairEnvelope?.integritySha256 &&
        priorTopologyConsensusRepair.candidateCacheKey === topologyConsensusRepairFinalEntry?.candidate.cacheKey &&
        priorTopologyConsensusRepair.candidateCacheIntegritySha256 === topologyConsensusRepairFinalEntry?.candidate.integritySha256 &&
        priorTopologyConsensusRepair.sourceVisualId === activeTopologyConsensusRepairSlot.sourceVisualId &&
        prior.formulaReview.inputExactText === activeTopologyConsensusRepairSlot.exactText &&
        prior.formulaReview.inputCaption === activeTopologyConsensusRepairSlot.caption &&
        prior.bbox &&
        sameSourceVisualBBox(prior.bbox, activeTopologyConsensusRepairSlot.bbox),
      );
      const preservesAcceptedReview =
        preservesAcceptedRecoveryReview ||
        preservesAcceptedTopologyRecoveryReview ||
        preservesAcceptedTopologyCandidateRepairReview ||
        preservesAcceptedTopologyConsensusRepairReview;
      const preservesMatchingArtifactState = Boolean(
        prior &&
        prior.type === detection.type &&
        prior.caption === detection.caption &&
        prior.bbox &&
        detection.bbox &&
        sameSourceVisualBBox(prior.bbox, detection.bbox),
      );
      const visual: SourceVisual = {
        sourceVisualId,
        sourceId,
        pageNumber,
        type: detection.type,
        caption: preservesAcceptedReview ? prior!.caption : detection.caption,
        ...(
          preservesAcceptedReview
            ? (prior!.exactText ? { exactText: prior!.exactText } : {})
            : (detection.exactText ? { exactText: detection.exactText } : {})
        ),
        pageImagePath: pageUrl,
        bbox: detection.bbox,
        usageStatus: preservesMatchingArtifactState || preservesAcceptedReview
          ? prior!.usageStatus
          : "unused",
        ...((preservesMatchingArtifactState || preservesAcceptedReview) && prior?.conceptUsage
          ? { conceptUsage: prior.conceptUsage }
          : {}),
        ...((preservesMatchingArtifactState || preservesAcceptedReview) && prior?.cropStatus
          ? { cropStatus: prior.cropStatus }
          : {}),
        ...((preservesMatchingArtifactState || preservesAcceptedReview) && prior?.assignedPageId
          ? { assignedPageId: prior.assignedPageId }
          : {}),
        ...((preservesMatchingArtifactState || preservesAcceptedReview) && prior?.assignedSectionId
          ? { assignedSectionId: prior.assignedSectionId }
          : {}),
        ...((preservesMatchingArtifactState || preservesAcceptedReview) && prior?.skipReason
          ? { skipReason: prior.skipReason }
          : {}),
        ...(preservesAcceptedReview ? { formulaReview: prior!.formulaReview } : {}),
      };

      if (detection.bbox) {
        const cropped = cropPng(pngBuffer, expandedCropBBox(detection.bbox, detection.type));
        if (cropped) {
          if (recoverySlot || topologyRecoverySlot || topologyCandidateRepairSlot || topologyConsensusRepairSlot) {
            const cropSha256 = sha256(cropped);
            if (replacement && replacement.equationCropSha256 !== cropSha256) {
              throw new Error(
                "Formula-artifact recovery replay crop does not match its signed replacement for " +
                  sourceVisualId + ".",
              );
            }
            if (activeTopologySlot && activeTopologySlot.equationCropSha256 !== cropSha256) {
              throw new Error(
                "Formula-artifact topology recovery replay crop does not match its signed active slot for " +
                  sourceVisualId + ".",
              );
            }
            if (
              activeTopologyCandidateRepairSlot &&
              activeTopologyCandidateRepairSlot.equationCropSha256 !== cropSha256
            ) {
              throw new Error(
                "Formula-artifact topology candidate repair replay crop does not match its signed active slot for " +
                  sourceVisualId + ".",
              );
            }
            if (
              activeTopologyConsensusRepairSlot &&
              activeTopologyConsensusRepairSlot.equationCropSha256 !== cropSha256
            ) {
              throw new Error(
                "Formula-artifact topology consensus repair replay crop does not match its signed active slot for " +
                  sourceVisualId + ".",
              );
            }
            visual.croppedImagePath = replacement || activeTopologySlot || activeTopologyCandidateRepairSlot || activeTopologyConsensusRepairSlot
              ? persistSourceFormulaReviewedCrop(contentPath, gardenSlug, sourceVisualId, cropped)
              : persistSourceFormulaArtifactRecoveryVisualCrop(
                contentPath,
                gardenSlug,
                sourceVisualId,
                cropped,
              );
          } else {
            fs.mkdirSync(cropDir, { recursive: true });
            const fileName = `${slugify(
              `${sourceId}-page-${pageNumber}-${detection.type}-${sourceVisualId.split(".").pop()}-${detection.caption.slice(0, 48)}`,
            )}.png`;
            const cropPath = path.join(cropDir, fileName);
            try {
              fs.writeFileSync(cropPath, cropped);
              visual.croppedImagePath = `/${gardenSlug}/assets/source-visuals/${fileName}`;
            } catch {
              // Keep the visual with only the page-level fallback path.
            }
          }
        } else if (recoverySlot || topologyRecoverySlot || topologyCandidateRepairSlot || topologyConsensusRepairSlot) {
          throw new Error("Formula-artifact recovery replay visual cannot be cropped from its signed page image.");
        }
      }
      found.push(visual);
    }
  }

  // Pages where detection found nothing meaningful get no entry at all —
  // full-page screenshots are fallback assets, not extracted figures.
  const preservedSourceVisuals = existing.filter(
    (visual) => !replacedPages.has(visual.pageNumber),
  );
  const mergedSourceVisuals = [...preservedSourceVisuals, ...found].sort(
    (left, right) => left.pageNumber - right.pageNumber || left.sourceVisualId.localeCompare(right.sourceVisualId),
  );
  const merged = [...ledger.filter((visual) => visual.sourceId !== sourceId), ...mergedSourceVisuals];
  saveSourceVisuals(contentPath, gardenSlug, merged);
  return mergedSourceVisuals;
}

/** The image URL a page should embed for a visual: the crop when available,
 * otherwise the full page snapshot (an explicit full-page fallback). */
export function sourceVisualEmbedUrl(visual: SourceVisual): string | undefined {
  return visual.croppedImagePath ?? visual.pageImagePath;
}

/** Markdown image + compact provenance caption for embedding in a lesson body. */
export function sourceVisualMarkdown(visual: SourceVisual): string | null {
  const url = sourceVisualEmbedUrl(visual);
  if (!url) return null;
  const alt = visual.caption.replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
  const provenance = visual.pageNumber > 0 ? ` *(p. ${visual.pageNumber})*` : "";
  return `![${alt}](${url})\n\n*${alt}*${provenance}`;
}

/** Record final assignment decisions in the ledger: visuals embedded on pages
 * become "assigned"; everything else is intentionally skipped with a reason. */
export function recordSourceVisualAssignments(
  contentPath: string,
  gardenSlug: string,
  assignments: Map<string, { pageId: string; sectionId?: string }>,
  skipReasonForUnused: (visual: SourceVisual) => string,
  options: { conceptAnchorIds?: Iterable<string>; trackedArtifactIds?: Iterable<string> } = {},
): SourceVisual[] {
  const ledger = loadSourceVisuals(contentPath, gardenSlug);
  const conceptAnchorIds = new Set(options.conceptAnchorIds ?? []);
  const trackedArtifactIds = options.trackedArtifactIds
    ? new Set(options.trackedArtifactIds)
    : undefined;
  const next = ledger.map((visual): SourceVisual => {
    if (trackedArtifactIds && !trackedArtifactIds.has(visual.sourceVisualId)) return visual;
    const assignment = assignments.get(visual.sourceVisualId);
    if (assignment) {
      return {
        ...visual,
        usageStatus: "assigned",
        conceptUsage: "embedded_and_explained",
        cropStatus: visual.croppedImagePath ? "embedded" : "available_not_embedded",
        assignedPageId: assignment.pageId,
        assignedSectionId: assignment.sectionId,
        skipReason: undefined,
      };
    }
    const usedAsConceptAnchor = conceptAnchorIds.has(visual.sourceVisualId);
    const conceptUsage: SourceVisualConceptUsage =
      usedAsConceptAnchor && visual.type === "equation"
        ? "explained_as_text_formula"
        : usedAsConceptAnchor
          ? "used_as_interactive_grounding"
          : "intentionally_omitted";
    const cropStatus: SourceVisualCropStatus =
      conceptUsage === "explained_as_text_formula"
        ? "omitted_unreliable"
        : visual.croppedImagePath
          ? "available_not_embedded"
          : "missing";
    const authoredSkipReason = usedAsConceptAnchor
      ? undefined
      : skipReasonForUnused(visual).trim();
    if (!usedAsConceptAnchor && !authoredSkipReason) {
      throw new Error(
        `Source visual ${visual.sourceVisualId} has no model-authored assignment or omission reason.`,
      );
    }
    return {
      ...visual,
      usageStatus: usedAsConceptAnchor ? "assigned" : "intentionally_skipped",
      conceptUsage,
      cropStatus,
      assignedPageId: undefined,
      assignedSectionId: undefined,
      skipReason: authoredSkipReason,
    };
  });
  saveSourceVisuals(contentPath, gardenSlug, next);
  return next;
}
