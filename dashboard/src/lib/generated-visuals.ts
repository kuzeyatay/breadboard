import crypto from "crypto";
import os from "os";
import { pathToFileURL } from "url";
import type OpenAI from "openai";
import { withCouncil } from "./council.ts";
import {
  externalRuntimeCopyFile,
  externalRuntimeFilesystem as fs,
  externalRuntimeLstat,
  externalRuntimePathExists,
  externalRuntimeReadFile,
  externalRuntimeReadUtf8,
  externalRuntimeRealpath,
  externalRuntimeStat,
} from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  GENERATED_VISUAL_COUNCIL_REASONING,
  GeneratedVisualCouncilReceiptError,
  runGeneratedVisualCouncilRequestWithReceipt,
  type GeneratedVisualCouncilReceiptResult,
  type GeneratedVisualCouncilRecoveryMetadata,
  type RunGeneratedVisualCouncilRequestInput,
} from "./generated-visual-council-receipts.ts";
import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
  GENERATED_VISUAL_CONTROL_ID_PATTERN,
  GENERATED_VISUAL_RESERVED_CONTROL_IDS,
} from "./generated-visual-capabilities.ts";
import {
  VISUAL_SDK_VERSION,
  type GeneratedVisualizationDefinition,
  type GeneratedVisualControl,
  type SpatialPrimitive,
  type SpatialScalar,
  type SpatialScene,
  type SpatialVector3,
  type VisualExpression,
} from "./visual-sdk.ts";
import type {
  SourceVisualRelationship,
  VisualizationOpportunity,
} from "./visualization-opportunities.ts";

export type GeneratedVisualBrowserCompletion =
  | "process_exit"
  | "observed_dom"
  | "observed_capture"
  | "spawn_error"
  | "deadline"
  | "cancelled"
  | "output_overflow";

export type GeneratedVisualBrowserCleanupMethod =
  | "none"
  | "natural-exit"
  | "natural-exit-lineage"
  | "natural-exit-unconfirmed"
  | "taskkill-tree"
  | "lineage-quiescence"
  | "natural-exit-race"
  | "process-group"
  | "process-group-sigkill"
  | "process-kill";

export const GENERATED_VISUAL_BLOCK_LANG = "breadboard-generated-visual";
export const GENERATED_VISUAL_SCHEMA_VERSION =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion;
export const GENERATED_VISUAL_MAX_SOURCE_CHARS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.sourceCharacters;
/** Provider dispatch is single-shot at this semantic boundary. The built-in
 * author/critic path adds a durable request receipt beneath it; custom provider
 * seams still may not replay an ambiguous call. */
export const GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS = 1;
/** A terminal durable receipt proves that one accepted Council request (and its
 * one receipt-authorized redispatch) produced no final answer. A fresh request
 * may then recover the same semantic operation without spending an author or
 * critic repair attempt. Keep this outage-recovery budget finite and separate
 * from the semantic budget. */
export const GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_MAX_ATTEMPTS = 8;
const GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_BASE_DELAY_MS = 2_000;
const GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_MAX_DELAY_MS = 30_000;
/** Spatial visuals can require several critic-guided, model-authored revisions
 * across independent geometry, runtime, and accessibility gates. A critic can
 * discover a late topology/domain mismatch only after compilation, browser
 * capture, and review, so retain a small bounded tail for applying that exact
 * evidence. Keep this semantic loop finite and distinct from identical-request
 * transport replay. */
export const GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS = 12;
/** Every semantic candidate can contribute one exact repair record. The history
 * therefore remains bounded without dropping an earlier gate or critic reason. */
export const GENERATED_VISUAL_REPAIR_HISTORY_MAX_ENTRIES =
  GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS;
/** Preview every reachable select state only while the matrix remains small
 * enough to be useful as model evidence rather than an unbounded image burst. */
export const GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES = 4;
/** A screenshot is transport evidence, not a new semantic attempt. Edge can
 * intermittently finish a headless capture without producing its target file,
 * so retry the exact same labelled cell a small, fixed number of times. */
export const GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS = 3;
const GENERATED_VISUAL_PREVIEW_CAPTURE_RETRY_BASE_DELAY_MS = 125;
const GENERATED_VISUAL_PREVIEW_CAPTURE_DIAGNOSTIC_MAX_LENGTH = 512;
/** A browser mount is infrastructure evidence, never a semantic candidate
 * revision. Retry one fresh-profile process only when its failure has an
 * explicit transient launch/mount error code. */
export const GENERATED_VISUAL_BROWSER_MOUNT_MAX_ATTEMPTS = 2;
const GENERATED_VISUAL_BROWSER_MOUNT_RETRY_BASE_DELAY_MS = 125;
const GENERATED_VISUAL_TRANSIENT_BROWSER_MOUNT_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "EAGAIN",
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "ERROR_SHARING_VIOLATION",
]);
/** Complex declarative visual generation can legitimately occupy ChatMock's
 * full 30-minute provider window. This is a soft observability threshold:
 * crossing it must not abort a council run that ChatMock will continue
 * server-side. */
export const GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS = 20 * 60_000;
/** Keep listening to the original request after the soft threshold so a late
 * council result can be adopted without issuing a second model-authored call.
 * The hard boundary remains finite; exhaustion fails closed and a later
 * process may only adopt the exact durable Council receipt. */
export const GENERATED_VISUAL_PROVIDER_LATE_RESULT_GRACE_MS = 11 * 60_000;
/** One minute beyond ChatMock's 30-minute total provider deadline. Clamp the
 * combined soft threshold and grace, rather than either component in
 * isolation, so configuration cannot accidentally create an unbounded wait. */
export const GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS = 31 * 60_000;

const SDK_IMPORT = GENERATED_VISUAL_CAPABILITY_MANIFEST.sourceForm.importModule;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;
const CONTROL_ID_PATTERN = GENERATED_VISUAL_CONTROL_ID_PATTERN;
const RESERVED_CONTROL_IDS = new Set<string>(
  GENERATED_VISUAL_RESERVED_CONTROL_IDS,
);
const EXTERNAL_URL_RE = /(?:https?:|wss?:|file:|javascript:|data:text\/html)/i;
const MAX_AST_NODES = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.astNodes;
const MAX_EXPRESSION_NODES =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.expressionNodes;
const MAX_EXPRESSION_DEPTH = 16;
const MAX_SCENES = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.scenes;
const MAX_CONTROLS = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.controls;
const MAX_OUTPUTS = GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.outputs;
const MAX_SELECT_OPTIONS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.selectOptions;
const MAX_SPATIAL_GROUPS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialGroups;
const MAX_SPATIAL_PRIMITIVES_PER_GROUP =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPrimitivesPerGroup;
const MAX_SPATIAL_PRIMITIVES =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPrimitives;
const MAX_SPATIAL_POLYGON_POINTS =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPolygonPoints;
const MAX_SPATIAL_MAGNITUDE =
  GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialMagnitude;
const SPATIAL_PRIMITIVE_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.primitiveKinds,
);
const SPATIAL_PALETTE = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.palette,
);
const SPATIAL_PATTERNS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.patterns,
);
const SPATIAL_LABEL_MODES = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.labelModes,
);
const SPATIAL_PROJECTIONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.projections,
);
const SPATIAL_INTERACTIONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.interactions,
);
const GENERATED_CONTROL_TYPES = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.types,
);
const GENERATED_CONTROL_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds,
);
const GENERATED_CONTROL_PROTOCOL_ROLES = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.protocolRoles,
);
const GENERATED_OUTPUT_REPRESENTATIONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations,
);
const GENERATED_EXPRESSION_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.kinds,
);
const GENERATED_BINARY_OPERATORS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.binaryOperators,
);
const GENERATED_UNARY_OPERATORS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.unaryOperators,
);
const GENERATED_COMPARISONS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.comparisons,
);
const GENERATED_SCENE_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds,
);
export interface GeneratedVisualizationTestCase {
  name: string;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
  tolerance?: number;
}

export interface GeneratedVisualTokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface GeneratedVisualizationCandidate {
  title: string;
  explanation: string;
  sourceCode: string;
  testCases: GeneratedVisualizationTestCase[];
  accessibilityDescription: string;
  pedagogicalClaims: string[];
  tokenUsage?: GeneratedVisualTokenUsage;
}

/** The six model-authored candidate fields, carried verbatim into a repair. */
export interface GeneratedVisualizationCandidateRepairSnapshot {
  title: string;
  explanation: string;
  sourceCode: string;
  testCases: GeneratedVisualizationTestCase[];
  accessibilityDescription: string;
  pedagogicalClaims: string[];
  sourceHash: string;
}

export interface GeneratedVisualRepairHistoryEntry {
  attempt: number;
  failureCategory: "validation" | "runtime" | "critic" | "generation";
  /** Exact gate messages in the order returned by the failing boundary. */
  errors: string[];
  /** Present for critic feedback so its reason and requested changes stay
   * distinguishable rather than becoming an opaque concatenated string. */
  critic?: {
    reason: string;
    requestedChanges: string[];
  };
  /** Binds the rejection to the full six-field candidate supplied to the next
   * model, rather than to sourceCode alone. */
  candidateSnapshotHash?: string;
}

export interface GeneratedVisualPreviewIdentity {
  id: string;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
  /** Every authored select value represented by this preview. */
  selectState: Array<{
    controlId: string;
    optionIndex: number;
    optionLabel: string;
  }>;
  defaultState: boolean;
  /** True only when more reachable select combinations existed than the fixed
   * evidence cap allowed us to render. */
  selectStateCoverageTruncated: boolean;
}

export interface GeneratedVisualPreviewArtifact
  extends GeneratedVisualPreviewIdentity {
  path: string;
}

/** One isolated browser attempt for a labelled preview cell. This stays
 * deliberately infrastructure-only: no model-authored candidate data is
 * synthesized or changed while retrying a capture. */
export interface GeneratedVisualBrowserAttemptDiagnostics {
  /** Measured wall-clock duration of the browser invocation. */
  durationMs?: number;
  /** Explicit deadline result; do not infer this from a null exit status. */
  timedOut?: boolean;
  /** Process/supervisor error code, kept separate from stream output. */
  errorCode?: string;
  /** Bounded stderr diagnostic, retained separately from rendered DOM. */
  stderr?: string;
  /** Bounded stdout tail, useful for proving whether DOM serialization ended. */
  stdoutTail?: string;
  /** Whether completion came from process exit or observable artifacts. */
  completion?: GeneratedVisualBrowserCompletion;
  /** False when completed artifacts were followed by explicit tree cleanup. */
  browserExitedNaturally?: boolean;
  cleanupMethod?: GeneratedVisualBrowserCleanupMethod;
  cleanupConfirmed?: boolean;
}

export interface GeneratedVisualCouncilReceiptObservation {
  phase: "author" | "critic";
  semanticAttempt: number;
  criticAttempt?: number;
  transportRecoveryAttempt?: number;
  requestedModel: string;
  resolvedModel: string;
  requestId: string;
  requestHash: string;
  councilRunId: string;
  recovered: boolean;
  /** Whether this process invoked chat.completions.create for the result. */
  dispatched: boolean;
  dispatchCount: number;
  /** True when this process received and validated the HTTP completion body,
   * so the attached Learn tracker already recorded its usage. */
  httpCompletionObserved: boolean;
  usage: GeneratedVisualCouncilReceiptResult["usage"];
}

interface GeneratedVisualCouncilRecoveryBoundary {
  durableRecoveryDir: string;
  invocationKey: string;
  metadata: GeneratedVisualCouncilRecoveryMetadata;
  onReceipt?: (receipt: GeneratedVisualCouncilReceiptResult) => void;
}

export interface GeneratedVisualPreviewCaptureAttempt
  extends GeneratedVisualBrowserAttemptDiagnostics {
  attempt: number;
  status: number | null;
  signal: string | null;
  screenshotCreated: boolean;
  screenshotBytes?: number;
  /** Mobile spatial previews must prove that their first spatial SVG fits the
   * initial document viewport, not merely that a PNG file was emitted. */
  previewPrimarySpatialFrameValidated?: boolean;
  /** Bounded process diagnostic, retained only when the capture failed. */
  detail?: string;
  /** Present only for an explicitly classified transient process failure. */
  transientFailureCode?: string;
  /** The bounded delay inserted before the next fresh-profile attempt. */
  retryDelayMs?: number;
}

/** Durable receipt for one labelled viewport/select-state preview cell. */
export interface GeneratedVisualPreviewCaptureReceipt
  extends GeneratedVisualPreviewIdentity {
  captured: boolean;
  attempts: GeneratedVisualPreviewCaptureAttempt[];
}

/** Complete-or-fail preview evidence ledger. A partial receipt is diagnostic
 * evidence only and can never be treated as critic input or publication proof. */
export interface GeneratedVisualPreviewMatrixReceipt {
  expectedCount: number;
  capturedCount: number;
  cells: GeneratedVisualPreviewCaptureReceipt[];
}

/** One isolated browser mount attempt for a runtime viewport scenario. The
 * receipt deliberately excludes machine-local profile paths. */
export interface GeneratedVisualBrowserMountAttempt
  extends GeneratedVisualBrowserAttemptDiagnostics {
  attempt: number;
  status: number | null;
  signal: string | null;
  mounted: boolean;
  /** Present only for an explicitly classified transient process failure. */
  transientFailureCode?: string;
  /** Bounded, path-sanitized process or runtime diagnostic on failure. */
  detail?: string;
  /** The bounded delay inserted before the next fresh-profile attempt. */
  retryDelayMs?: number;
}

/** Durable diagnostic receipt for one labelled browser runtime scenario. */
export interface GeneratedVisualBrowserMountReceipt {
  scenario: string;
  viewport: string;
  theme: "light" | "dark";
  mounted: boolean;
  attempts: GeneratedVisualBrowserMountAttempt[];
}

export interface GeneratedVisualBrowserProfileCleanupReceipt {
  attempted: number;
  removed: number;
  retries: number;
  rootRemoved: boolean;
  confirmed: boolean;
  failureCode?: string;
}

function canonicalGeneratedVisualBrowserProfileCleanupReceipt(
  value: unknown,
): GeneratedVisualBrowserProfileCleanupReceipt | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const receipt = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "attempted",
    "removed",
    "retries",
    "rootRemoved",
    "confirmed",
    "failureCode",
  ]);
  if (Object.keys(receipt).some((key) => !allowedKeys.has(key))) return undefined;
  if (
    !Number.isSafeInteger(receipt.attempted) || Number(receipt.attempted) < 0 ||
    Number(receipt.attempted) > 256 ||
    !Number.isSafeInteger(receipt.removed) || Number(receipt.removed) < 0 ||
    Number(receipt.removed) > Number(receipt.attempted) ||
    !Number.isSafeInteger(receipt.retries) || Number(receipt.retries) < 0 ||
    Number(receipt.retries) > 10_000 ||
    typeof receipt.rootRemoved !== "boolean" ||
    typeof receipt.confirmed !== "boolean" ||
    (receipt.confirmed === true && (
      receipt.rootRemoved !== true || receipt.removed !== receipt.attempted
    )) ||
    !(receipt.failureCode === undefined || (
      typeof receipt.failureCode === "string" &&
      /^[A-Z][A-Z0-9_]{0,95}$/u.test(receipt.failureCode)
    ))
  ) return undefined;
  return {
    attempted: Number(receipt.attempted),
    removed: Number(receipt.removed),
    retries: Number(receipt.retries),
    rootRemoved: receipt.rootRemoved,
    confirmed: receipt.confirmed,
    ...(typeof receipt.failureCode === "string"
      ? { failureCode: receipt.failureCode }
      : {}),
  };
}

export type GeneratedVisualizationStatus =
  | "draft"
  | "validated"
  | "compiled"
  | "tested"
  | "critic_approved"
  | "published"
  | "rejected";

export interface GeneratedVisualizationManifest {
  schemaVersion: number;
  sdkVersion: string;
  id: string;
  gardenId: string;
  learningUnitId: string;
  title: string;
  description: string;
  learningObjective: string;
  sourceAnchorIds: string[];
  sourceVisualIds: string[];
  sourceVisualRelationships: SourceVisualRelationship[];
  conceptIds: string[];
  insertionAnchor: string;
  targetPage: string;
  targetHeading: string;
  sourceHash: string;
  compiledHash: string;
  status: GeneratedVisualizationStatus;
  generatedAt: string;
  generatorModel: string;
  generationAttempt: number;
  version: number;
  previousVersion?: number;
  artifactPath: string;
  similarityFingerprint: string;
}

export interface GeneratedVisualValidationRecord {
  valid: boolean;
  checkedAt: string;
  astNodeCount: number;
  sourceBytes: number;
  imports: string[];
  errors: string[];
  warnings: string[];
}

export interface GeneratedVisualTestsRecord {
  passed: boolean;
  checkedAt: string;
  staticTests: Array<{ name: string; passed: boolean; detail?: string }>;
  semanticTests: Array<{ name: string; passed: boolean; detail?: string }>;
  runtimeTests: Array<{ name: string; passed: boolean; detail?: string }>;
  browser?: {
    executable?: string;
    viewports: string[];
    screenshotCreated: boolean;
    previewCount?: number;
    selectStateCount?: number;
    selectStateCoverageTruncated?: boolean;
    previewMatrixComplete?: boolean;
    previewMatrixReceipt?: GeneratedVisualPreviewMatrixReceipt;
    mountReceipts?: GeneratedVisualBrowserMountReceipt[];
    profileCleanup?: GeneratedVisualBrowserProfileCleanupReceipt;
  };
}

export interface GeneratedVisualCriticRecord {
  approved: boolean;
  checkedAt: string;
  reason: string;
  requestedChanges: string[];
  scores: {
    pedagogicalValue: number;
    sourceFidelity: number;
    usability: number;
    accessibility: number;
  };
  providerApproved?: boolean;
  providerScores?: Record<string, number>;
  tokenUsage?: GeneratedVisualTokenUsage;
}

export interface GeneratedVisualLifecycleRecord {
  status: GeneratedVisualizationStatus;
  at: string;
  attempt: number;
  detail?: string;
}

export type GeneratedVisualRejectedAttemptCategory =
  | "generation_transport"
  | "generation"
  | "validation"
  | "runtime"
  | "critic_transport"
  | "critic";

/** Exact in-process evidence for one rejected semantic attempt. Durable sinks
 * must project this through their own explicit allowlist: browser records can
 * contain machine-local diagnostics that must never be copied wholesale. */
export interface GeneratedVisualRejectedAttempt {
  schemaVersion: 1;
  visualizationId: string;
  runId: string;
  attempt: number;
  category: GeneratedVisualRejectedAttemptCategory;
  rejectedAt: string;
  errors: string[];
  candidate: GeneratedVisualizationCandidate | null;
  lifecycle: GeneratedVisualLifecycleRecord[];
  evidence?: {
    validation?: GeneratedVisualValidationRecord;
    tests?: GeneratedVisualTestsRecord;
    critic?: GeneratedVisualCriticRecord;
  };
}

export type GeneratedVisualRejectedAttemptSink = (
  rejectedAttempt: GeneratedVisualRejectedAttempt,
) => void;

export interface GeneratedVisualCompilation {
  definition: GeneratedVisualizationDefinition | null;
  validation: GeneratedVisualValidationRecord;
  sourceHash: string;
  compiledHash: string;
  compiledJavaScript: string;
  cacheHit: boolean;
}

export interface GeneratedVisualResult {
  manifest: GeneratedVisualizationManifest | null;
  definition: GeneratedVisualizationDefinition | null;
  errors: string[];
  failureCategory?:
    | "validation"
    | "compilation"
    | "runtime"
    | "critic"
    | "generation";
}

export interface GeneratedVisualEvent {
  type: string;
  data: Record<string, unknown>;
}

type EventSink = (event: GeneratedVisualEvent) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generatedVisualizationCandidateRepairSnapshot(
  candidate: GeneratedVisualizationCandidate,
): GeneratedVisualizationCandidateRepairSnapshot {
  return {
    title: candidate.title,
    explanation: candidate.explanation,
    sourceCode: candidate.sourceCode,
    testCases: candidate.testCases.map((testCase) => ({
      name: testCase.name,
      inputs: { ...testCase.inputs },
      expected: { ...testCase.expected },
      ...(testCase.tolerance === undefined ? {} : { tolerance: testCase.tolerance }),
    })),
    accessibilityDescription: candidate.accessibilityDescription,
    pedagogicalClaims: [...candidate.pedagogicalClaims],
    sourceHash: sha256(candidate.sourceCode),
  };
}

/** A canonical fingerprint prevents history from ambiguously linking a gate
 * failure to another candidate with identical source but changed explanation,
 * tests, accessibility text, title, or claims. */
function canonicalGeneratedVisualJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalGeneratedVisualJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalGeneratedVisualJson(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function generatedVisualizationCandidateSnapshotHash(
  candidate: GeneratedVisualizationCandidate,
): string {
  return sha256(
    canonicalGeneratedVisualJson(
      generatedVisualizationCandidateRepairSnapshot(candidate),
    ),
  );
}

function appendGeneratedVisualRepairHistory(
  history: GeneratedVisualRepairHistoryEntry[],
  entry: GeneratedVisualRepairHistoryEntry,
): void {
  if (history.length >= GENERATED_VISUAL_REPAIR_HISTORY_MAX_ENTRIES) {
    throw new Error(
      "Generated visual repair history exceeded its semantic attempt ceiling",
    );
  }
  history.push({
    attempt: entry.attempt,
    failureCategory: entry.failureCategory,
    errors: [...entry.errors],
    ...(entry.critic
      ? {
          critic: {
            reason: entry.critic.reason,
            requestedChanges: [...entry.critic.requestedChanges],
          },
        }
      : {}),
    ...(entry.candidateSnapshotHash
      ? { candidateSnapshotHash: entry.candidateSnapshotHash }
      : {}),
  });
}

function generatedVisualRepairHistorySnapshot(
  history: readonly GeneratedVisualRepairHistoryEntry[],
): GeneratedVisualRepairHistoryEntry[] {
  return history.map((entry) => ({
    attempt: entry.attempt,
    failureCategory: entry.failureCategory,
    errors: [...entry.errors],
    ...(entry.critic
      ? {
          critic: {
            reason: entry.critic.reason,
            requestedChanges: [...entry.critic.requestedChanges],
          },
        }
      : {}),
    ...(entry.candidateSnapshotHash
      ? { candidateSnapshotHash: entry.candidateSnapshotHash }
      : {}),
  }));
}

/**
 * Turns a structural compiler rejection into a short, front-loaded authoring
 * instruction. The complete prior model candidate and exact gate history stay
 * in repairContext below; this does not patch, summarize, or otherwise alter
 * the model-authored visual. It only makes a known class of structural repair
 * hard to overlook when a full candidate snapshot is necessarily large.
 */
function generatedVisualHighPriorityRepairInstructions(
  errors: readonly string[] | undefined,
): string[] | undefined {
  const feedback = (errors ?? []).join("\n");
  const instructions: string[] = [];
  const astTarget = Math.floor(MAX_AST_NODES * 0.64);
  if (
    /\breviewed_spatial_representation\.(?:missing_spatial_scene|missing_surface_primitive|missing_vector_primitive)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The reviewed route explicitly requires source-grounded spatial topology. Replace any diagram node-link graph, flowchart, state-transition graph, or plot substitute with a spatial scene containing the actual physical primitives. When the reviewed route names a boundary, interface, pillbox, or surface, include an honest spatial surface primitive; when it names a field, flux, normal, tangential direction, or vector, include an actual spatial vector. Preserve the model-authored contract and source relationship, but do not solve this by relabelling a 2D graph or by changing only explanation text.",
    );
  }
  if (
    /\bplot\.(?:default|after_control_change|after_reset)\.scene\[\d+\]\.axis_label_(?:out_of_frame|box)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The browser found a plot-axis label outside its SVG frame. Replace the affected source-authored xLabel or yLabel with a concise, source-grounded label that remains fully legible in the exact mobile and desktop previews. Do not solve this with CSS, clipping, truncation, or an unexplained abbreviation; move supplementary formula detail to an annotation or formula scene when necessary.",
    );
  }
  if (/\bAST exceeds\b/i.test(feedback)) {
    instructions.push(
      `The previous module exceeded the ${MAX_AST_NODES}-node AST hard cap. Return a compact complete replacement targeted below ${astTarget} AST nodes; do not retain repeated expression-heavy geometry from the rejected module.`,
    );
    instructions.push(
      "For a changing axis-aligned rectangular volume, use compact plane faces with literal normals, one dynamic center component, and a dynamic scalar size instead of repeating four expression-backed polygon vertices for every face. Do not claim a full closed boundary unless the replacement actually renders it.",
    );
  }
  if (/must contain exactly three spatial scalars/i.test(feedback)) {
    instructions.push(
      "Audit every spatial coordinate before returning: each point position, plane center/normal, vector from, and vector to must be an exactly three-item [x, y, z] array, including literal zero components.",
    );
  }
  if (
    /',' expected\.|Argument expression expected\.|Expression expected\.|default export must be defineVisualization\(|definition must be an object|executable syntax is not allowed|unterminated|unexpected token/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The previous sourceCode did not parse as a complete visualization module or used executable syntax. Replace sourceCode with one fresh, compact, standalone module instead of editing a fragment or reusing an unbalanced expression. It must have exactly two top-level statements: the required import and export default defineVisualization({ ...literal definition... }). Do not declare const/let/var, helpers, aliases, template interpolation, property shorthand, spread, callbacks, or any bare identifier as a value. Every label, id, title, string, and operator must be quoted; every computed quantity must be a nested SDK expression object such as {kind:\"input\",id:\"gain\"}, never JavaScript like gain, x, t, result, config, or definition. Before returning it, audit every object/array delimiter and comma.",
    );
    instructions.push(
      `For spatial coordinate entries, use a literal, an input, or at most a one-operation expression; never paste a long derived calculation into one coordinate. Use only supported binary operators (${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.binaryOperators.join("/")}), never min or max, and put longer calculations in an output, plot, status, or formula scene.`,
    );
  }
  if (/expression is invalid or too deeply nested|expression exceeds \d+ nodes/i.test(feedback)) {
    instructions.push(
      `The previous module used an invalid expression. Replace the affected value with a shallow expression targeted to at most 6 nested levels and 40 nodes (the hard limits are ${MAX_EXPRESSION_DEPTH} levels and ${MAX_EXPRESSION_NODES} nodes). When the failed path is a diagram node value, omit that value unless a literal {kind:"constant",value:<finite>}, {kind:"input",id:<known control>}, or one-operation numeric expression is genuinely needed; never write a bare numeric value such as value: 1. Put longer derivations in an output, plot, status, or formula scene instead.`,
    );
  }
  if (
    /\b(?:overlap(?:ping)?|collid(?:e|es|ed|ing)|clip(?:s|ped|ping)|container edge|spatial frame)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The prior rendered layout is not legible. Replace the affected diagram, status, or spatial scene structure rather than merely renaming labels. For a diagram, give node footprints generous separation, keep every edge-label midpoint clear of every node footprint and other label, and never author parallel or reverse labelled edges that share an endpoint pair because their labels render at that exact same midpoint. Use at most one short conceptual relationship label per endpoint pair; put equations, ratios, and other wide formula text in an annotation or formula scene. For a status scene, use a short natural-language title and state label with ordinary word-break opportunities that fit a 375px panel; move formulas and long technical tokens into its description or a formula scene. For a spatial scene, use concise labels and set labelMode:\"legend_only\" on dense supporting primitives when their required legend and ARIA label communicate more clearly; then choose a conservative authored view and geometry envelope so every remaining inline label stays fully inside both desktop and narrow mobile preview frames.",
    );
  }
  if (
    /\bdiagram\.(?:after_control_change|after_reset|default)[\s\S]{0,260}\bnode_label_(?:footprint|line_overlap|line_overflow)\b|\bnode_label_(?:footprint|line_overlap|line_overflow)\b[\s\S]{0,260}\b(?:after_control_change|after_reset)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The browser found a diagram node label overflowing its measured SVG footprint after a state transition or Reset. Replace the literal scene.nodes entry identified by node= in the exact feedback, not merely prose: use one compact 1-6-character identifier, omit node.value unless it is indispensable to a reviewed output, and move full phrases, equations, step descriptions, and dynamic numbers into an annotation, formula, status, value, or plot scene. Rebuild any affected edge layout around that shorter node. Verify the rendered label and every tspan fit inside the actual node footprint in the default, changed-control, and reset states on all supplied desktop and mobile previews. Do not change CSS, rely on renderer expansion or capping, or leave the long text on a different line.",
    );
  }
  if (
    /\bdiagram\b[\s\S]{0,220}\b(?:overflow|cropp(?:ed|ing)?|clip(?:s|ped|ping)|cut[ -]?off|right[ -]?edge|mobile|out[_ -]?of[_ -]?bounds|footprint|label[_ -]?overlap)\b|\bnode(?:s| labels?| values?)?\b[\s\S]{0,180}\b(?:overlap(?:ping)?|collid(?:e|es|ed|ing)|cropp(?:ed|ing)?|clip(?:s|ped|ping)|out[_ -]?of[_ -]?bounds|footprint)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The previous diagram does not fit its labelled narrow-mobile preview. Replace it with a compact representative graph, not a dense physical grid: use at most three text-bearing nodes in one horizontal or vertical band, keep every text-bearing node center at least 80 SVG units from the frame edge (normally x=112-528 and y=72-288), and leave clear space around every circle or rectangle for its full label footprint. Do not put an edge label in the same lane as node values. A node that has both a symbol and a changing numeric value needs a short identifier and one concise value readout; if both cannot fit distinctly, omit node.value and show the changing quantity in a value, status, plot, formula, or annotation scene. Move repeated step labels, ratios, and equations out of diagram nodes and edges. Recheck the exact 375px default and alternate previews after replacing the layout, not merely the source coordinate bounds.",
    );
  }
  if (
    /\b(?:diagram|node)\b[\s\S]{0,280}\b(?:cropp(?:ed|ing)?|cut[ -]?off|right[ -]?edge|viewport|coordinate)\b|\b(?:coordinate|viewport|right[ -]?edge)\b[\s\S]{0,280}\b(?:diagram|node)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The critic found a source-authored diagram coordinate outside its readable mobile layout. Rebuild the affected scene.nodes literal x/y values and their edge layout; do not leave an old coordinate for runtime clamping, change only labels, or rely on CSS. The non-clamped source range is x=72-568 and y=48-312, while every text-bearing narrow-mobile node should sit inside x=112-528 and y=72-288 with a short label and clearance for its measured footprint. For a compact three-node row, use materially interior positions such as x=140,320,500 rather than placing the final node near the right edge, then recheck all exact supplied previews.",
    );
  }
  if (
    /\b(?:spatial\s+camera|camera|azimuth|elevation|projection|foreshorten(?:s|ed|ing)?)\b[\s\S]{0,320}\b(?:overlap(?:ping)?|cluster(?:ed|ing)?|collapse(?:d|s|ing)?|superimpos(?:e|ed|ing)|adjacent)\b|\b(?:overlap(?:ping)?|cluster(?:ed|ing)?|collapse(?:d|s|ing)?|superimpos(?:e|ed|ing)|adjacent)\b[\s\S]{0,320}\b(?:spatial\s+camera|camera|azimuth|elevation|projection|foreshorten(?:s|ed|ing)?)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The critic found a spatial-camera projection collision: distinct source-essential primitives collapse or crowd in the rendered 2D view. Preserve their literal physical coordinates, endpoints, topology, and source relationship; replace the affected literal scene.view azimuthDegrees, elevationDegrees, scale, and projection when useful so named points, vector arrowheads, and endpoints are visibly separated and centered in every exact desktop and narrow-mobile state. For a supporting vector whose inline label still crowds, use literal labelMode:\"legend_only\" so its required legend and ARIA name remain available; only change a vector display envelope when the source explicitly supports an illustrative or normalized representation. Do not hide the collision with CSS, runtime auto-fit, prose, or relabelling, and recheck default, changed-control, and Reset states.",
    );
  }
  if (
    /\b(?:mobile|narrow|375\s*(?:x|by)\s*667|viewport|initial\s+(?:preview|frame))\b[\s\S]{0,360}\b(?:spatial|scene|primitive|projection|vector|plane|point)\b[\s\S]{0,360}\b(?:bottom|below|cropp(?:ed|ing)?|clip(?:s|ped|ping)|cut[ -]?off|out[_ -]?of[_ -]?frame|push(?:ed|ing)?)\b|\b(?:spatial|scene|primitive|projection|vector|plane|point)\b[\s\S]{0,360}\b(?:bottom|below|cropp(?:ed|ing)?|clip(?:s|ped|ping)|cut[ -]?off|out[_ -]?of[_ -]?frame|push(?:ed|ing)?)\b[\s\S]{0,360}\b(?:mobile|narrow|375\s*(?:x|by)\s*667|viewport|initial\s+(?:preview|frame))\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The critic found that the spatial scene missed the initial narrow-mobile preview viewport, even if individual SVG coordinates fit their local frame. Rebuild the scene ordering and compact vertical footprint before changing only labels: put the first source-essential spatial scene ahead of supporting plot, formula, annotation, status, or secondary-scene content that pushes it below the 375x667 initial viewport, keep its title and surrounding preamble concise, and then set literal scene.view azimuthDegrees, elevationDegrees, scale, and projection plus the geometry envelope so the full projection and every source-essential primitive are centered with clearance. Preserve the literal physical relationship and topology; do not hide it with CSS, scrolling instructions, runtime auto-fit, or a local SVG-only frame claim. Recheck every exact desktop, mobile, changed-control, and Reset preview.",
    );
  }
  if (
    /\b(?:camera|view|azimuth|elevation|scale|projection)\b[\s\S]{0,160}\b(?:off[ -]?center|clip(?:s|ped|ping)|cropp(?:ed|ing)|cut[ -]?off|out[_ -]?of[_ -]?frame)\b|\b(?:off[ -]?center|clip(?:s|ped|ping)|cropp(?:ed|ing)|cut[ -]?off|out[_ -]?of[_ -]?frame)\b[\s\S]{0,160}\b(?:camera|view|azimuth|elevation|scale|projection)\b|\b(?:geometry|label)_out_of_frame\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The prior spatial camera framing is not usable in the labelled previews. Replace the affected spatial scene's authored view (azimuthDegrees, elevationDegrees, scale, and projection when applicable) and/or geometry envelope so every source-essential plane, vector, endpoint, and inline label is centered with clearance in every exact supplied desktop and narrow-mobile state. Treat the mobile preview as a hard constraint; do not solve camera clipping by relabelling, relying on CSS or runtime auto-fit, or moving only the label. Preserve the literal primitive topology and domain while reframing it.",
    );
    if (/\b(?:geometry|label)_out_of_frame\b/i.test(feedback)) {
      instructions.push(
        "The browser self-test reported a spatial geometry_out_of_frame or label_out_of_frame diagnostic. Preserve the primitive coordinates, topology, and labels; first lower the literal affected scene.view.scale to the reported scaleAtMost or lower (and revise azimuth/elevation only when separately necessary) until every vector endpoint, arrowhead, primitive envelope, and inline-label box fits the safe frame in every supplied state. If scaleAtMost is below the schema minimum, reduce the literal geometry envelope instead. Do not hide or relabel the failure, change CSS, or rely on runtime auto-fit.",
      );
    }
  }
  if (
    /\b(?:named|intersection)?\s*point\b[\s\S]{0,260}\b(?:edge|vertex|seam|cap|relative interior|facet)\b[\s\S]{0,260}\b(?:normal|tangent|basis)\b|\b(?:face|facet)\b[\s\S]{0,260}\b(?:normal|tangent|basis)\b[\s\S]{0,260}\b(?:edge|vertex|seam|cap|relative interior|point)\b|\b(?:normal|tangent|basis|radial)\b[\s\S]{0,320}\b(?:edge|vertex|seam|cap|relative interior|facet)\b|\b(?:edge|vertex|seam|cap|relative interior|facet)\b[\s\S]{0,320}\b(?:normal|tangent|basis|radial)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The prior spatial named-point normal claim is geometrically invalid. Rebuild the owning literal plane or polygon geometry before changing prose: in every relevant control state, the critic-named point must be strictly in the relative interior of one face, with positive separation from every vertex, edge, seam, and cap. For a polygon, calculate the cross product (p1-p0) x (p2-p0) from its ordered literal vertices and make that face normal parallel or antiparallel to the displayed normal/tangent/basis vector. For a curved cylindrical or spherical concept at such a point, use a literal tangent plane or bounded tangent polygon that contains the point in its interior and call it a local/tangent approximation when needed; do not claim a curved normal from an off-point chord facet or let a shared facet boundary pass through the point. Preserve the source-grounded relationship, but do not solve this by relabelling a mismatched primitive.",
    );
  }
  if (
    /\b(?:output|plot|marker|status|formula)\b[\s\S]{0,360}\b(?:mathematically inconsistent|inconsistent|mismatch|does not match|incorrect)\b[\s\S]{0,360}\b(?:vector|component|resultant|magnitude|aggregate)\b|\b(?:vector|component|resultant|magnitude|aggregate)\b[\s\S]{0,360}\b(?:mathematically inconsistent|inconsistent|mismatch|does not match|incorrect)\b[\s\S]{0,360}\b(?:output|plot|marker|status|formula)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The critic found a literal mathematical mismatch between a rendered vector/resultant and a scalar representation. Recompute the actual to-from endpoint deltas, components, sum, and magnitude in every relevant state, then make one coupled sourceCode correction: replace the affected required output.expression, every matching plot series expression and plot marker coordinate, and any formula/status/annotation using that result so they all use the recomputed relationship. When exact feedback supplies a corrected expression, use it in every cited field rather than leaving an old scaled, rounded, or half-magnitude expression. Do not change only prose or labels, or alter vector geometry merely to hide the mismatch; preserve the reviewed contract and source-grounded relationship.",
    );
  }
  if (
    /\b(?:spatial|field|vector|arrow)\b[\s\S]{0,320}\b(?:scale\s*factor|display\s*scale|arbitrary|unmentioned|numerical\s+mismatch|does\s+not\s+match|magnitude)\b|\b(?:scale\s*factor|display\s*scale|arbitrary|unmentioned|numerical\s+mismatch|does\s+not\s+match|magnitude)\b[\s\S]{0,320}\b(?:spatial|field|vector|arrow)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The critic found an ungrounded spatial-vector display scale. Treat each literal vector to-from delta as a quantitative representation: either derive it from the same source-grounded relationship used by the required output, plot series, markers, formula, and status, or explicitly label a unitless display-scale factor with its value and role in a formula or annotation and state that the vector is illustrative/normalized. Do not silently multiply a field vector by an arbitrary fit factor, leave a plotted physical magnitude unmatched, or change only prose. Recompute all affected states and keep the source-supported direction, sign, units, and topology intact.",
    );
  }
  if (
    /\b(?:hard[ -]?coded|unexplained|undefined|unintroduced)\b[\s\S]{0,160}\b(?:constant|literal|number|value|interval|variable|symbol)\b|\b(?:define|label|introduce|explain)\b[\s\S]{0,160}\b(?:variable|constant|symbol|unit|interval)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The prior candidate used an unexplained learner-facing constant or symbol. Treat every non-structural numeric literal or symbol that represents a physical or conceptual quantity as source-grounded: visibly define its symbol, value, unit when applicable, and role in a formula/annotation, diagram, plot, or status scene, and name that relationship in the accessibility description. If the evidence cannot define it, remove it or use an explicitly qualitative or normalized representation. Do not add planner-owned controls or outputs merely to name a quantity; pure rendering coordinates may remain unlabelled only when they carry no physical or conceptual claim. Keep the primitive topology and domain faithful while making the corresponding interval or scale visible to the learner.",
    );
  }
  if (
    /\bdiagram\b[\s\S]{0,520}\b(?:highlight(?:ed|ing|s)?|selected[ -]?branch|distinguish(?:ed|es|ing)?)\b|\b(?:highlight(?:ed|ing|s)?|selected[ -]?branch|distinguish(?:ed|es|ing)?)\b[\s\S]{0,520}\bdiagram\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The reviewed action promises state-dependent branch highlighting in a persistent diagram. Keep every node and edge present in one diagram scene, and implement the selection through each branch edge's authored strength expression. Use conditional edge.strength expressions keyed to the exact zero-based select option index so every single option has an exclusive emphasized branch and every combined/both/all/sum/total/+ option emphasizes their union, while all options produce pairwise-distinct rendered edge-width signatures after the runtime's absolute-value clamp to 0.5-6. Do not use node.value as selection styling, replace the diagram with changing spatial content, duplicate the immutable selector, or request CSS/runtime changes.",
    );
  }
  if (
    /\bnode[ -]?link (?:concept map|graph)\b[\s\S]{0,420}\b(?:closed|bounded|surface|cross[ -]?section|enclos(?:e|ed|ing)|physical)\b|\b(?:closed|bounded|surface|cross[ -]?section|enclos(?:e|ed|ing)|physical)\b[\s\S]{0,420}\bnode[ -]?link (?:concept map|graph)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The reviewed selection concerns physical geometry, not a graph branch. Replace the node-link concept map with source-grounded geometry that visibly renders the selected closed path, bounded region or surface, and the physical object it encloses. Use spatial groups/primitives and conditional visibleWhen expressions when appropriate, preserve all reviewed selector options and outputs, and keep any supporting diagram subordinate; circles used as diagram nodes do not count as closed physical paths or surfaces.",
    );
  }
  if (
    /\b(?:selector|select control|control)\b[\s\S]{0,260}\b(?:missing|absent|not (?:shown|visible)|visibly available|before (?:the )?(?:observable|scene))\b|\b(?:missing|absent|not (?:shown|visible)|visibly available)\b[\s\S]{0,260}\b(?:selector|select control|control)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "Preserve the immutable control exactly once in definition.controls. The trusted SDK runtime, not candidate sourceCode, places the primary visual first, followed by any compact result and then those controls, and verifies their rendered visibility; candidate fields cannot author DOM order. Do not duplicate a selector in a scene, invent a replacement control, hide it in prose, or request a CSS/runtime change. Repair the control's promised observable effect in the authored scene expressions and keep the primary scene concise.",
    );
  }
  if (
    /\breset restores a changed visual to defaults through the trusted runtime\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "Reset is a trusted-runtime action, not an authored numeric state. Remove every sourceCode expression reference to the reviewed reset control id. Keep the exact reset control in definition.controls, and make at least one other reviewed non-reset control visibly change a numeric output or scene expression so the runtime has meaningful state to restore.",
    );
  }
  if (
    /\b(?:positive|negative|sign|signed|polarity|revers(?:e|es|ed|ing))\b[\s\S]{0,360}\b(?:direction|vector|contribution|force|field)\b|\b(?:direction|vector|contribution|force|field)\b[\s\S]{0,360}\b(?:positive|negative|sign|signed|polarity|revers(?:e|es|ed|ing))\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The prior directional claim omitted the sign of a multiplying scalar. If source evidence supports a normalized example under a fixed sign, state that sign assumption visibly in a formula or annotation and in both non-visual descriptions, and state what reverses under the opposite sign. Otherwise label the arrows only as the underlying terms inside the signed expression, not as directions of the signed result or its contributions. Apply the same qualification consistently to labels, explanation, pedagogicalClaims, and accessibility descriptions; do not invent a sign or add a planner-owned control.",
    );
  }
  if (
    /\b(?:static|closed[ -]?form|direct)\b[\s\S]{0,200}\b(?:iterat(?:e|es|ed|ing|ion|ive)|relax(?:ation|ing)?|converg(?:e|es|ed|ing|ence)|simulation)\b|\b(?:iterat(?:e|es|ed|ing|ion|ive)|relax(?:ation|ing)?|converg(?:e|es|ed|ing|ence)|simulation)\b[\s\S]{0,200}\b(?:static|closed[ -]?form|direct)\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "The prior artifact showed a static closed-form result where the reviewed learner action requires an iterative or converging process. Replace the static ratio-only structure with a bounded source-grounded intermediate-to-settled state: use definition.animation {durationMs, loop, autoplay} and the reserved runtime expression {kind:\"input\",id:\"t\"} in an actual numeric output or scene expression, or use an already-declared reviewed process-position control when it genuinely represents the process. The default, a Step state, and the settled state must visibly differ and teach the stated update or residual relationship. Preserve the reviewed controls and outputs exactly, do not invent a solver or hidden state, and call stages illustrative or normalized when the evidence does not support a literal numerical iteration.",
    );
  }
  if (
    /\b(?:non-visual explanation|keyboard-readable|explicitly labelled|accessib(?:ility|le))\b/i.test(
      feedback,
    )
  ) {
    instructions.push(
      "Make both the candidate accessibilityDescription and definition.accessibilityDescription a standalone, specific non-visual walkthrough: name the labelled learner controls and action, the observable output or state change, each diagram or spatial object's legend/ARIA representation, the default and alternate states, and keyboard navigation plus Reset behavior. Do not merely assert that the visual is accessible.",
    );
  }
  if (/candidate is not valid JSON|candidate envelope is invalid/i.test(feedback)) {
    instructions.push(
      "Return one raw JSON envelope with the required six fields and no Markdown fence or prose outside that object.",
    );
  }
  return instructions.length > 0 ? instructions : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function generatedVisualTokenUsage(
  value: unknown,
): GeneratedVisualTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens =
    asFiniteNumber(value.prompt_tokens ?? value.input_tokens) ?? 0;
  const outputTokens =
    asFiniteNumber(value.completion_tokens ?? value.output_tokens) ?? 0;
  const details = isRecord(value.completion_tokens_details)
    ? value.completion_tokens_details
    : {};
  const reasoningTokens = asFiniteNumber(details.reasoning_tokens) ?? 0;
  const totalTokens =
    asFiniteNumber(value.total_tokens) ?? inputTokens + outputTokens;
  if (inputTokens + outputTokens + totalTokens === 0) return undefined;
  return { inputTokens, outputTokens, reasoningTokens, totalTokens };
}

/**
 * A few OpenAI-compatible gateways ignore response_format and wrap an otherwise
 * complete JSON reply in one Markdown fence. Accept only that exact, bounded
 * transport artifact: prose before or after the fence still fails closed.
 */
function unwrapGeneratedVisualJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n?```[ \t]*$/i.exec(
    trimmed,
  );
  return fenced ? fenced[1].trim() : content;
}

function generatedVisualMissingCandidateProblem(
  content: string,
  label: "generated visualization candidate" | "critic",
): string | undefined {
  const normalized = unwrapGeneratedVisualJsonFence(content).trim();
  if (!normalized) return `${label} returned no nonempty content`;
  if (normalized === "null") return `${label} returned literal JSON null`;
  return undefined;
}

function boundedGeneratedVisualEvidence(
  value: unknown,
  maxChars: number,
): unknown {
  if (value === undefined) return undefined;
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { truncated: true, text: String(value).slice(0, maxChars) };
  }
  if (serialized.length <= maxChars) return value;
  return { truncated: true, jsonExcerpt: serialized.slice(0, maxChars) };
}

function validateExpression(
  expression: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
  depth = 0,
  counter = { value: 0 },
): expression is VisualExpression {
  counter.value += 1;
  if (counter.value > MAX_EXPRESSION_NODES) {
    errors.push(
      `${pathLabel}: expression exceeds ${MAX_EXPRESSION_NODES} nodes`,
    );
    return false;
  }
  if (depth > MAX_EXPRESSION_DEPTH || !isRecord(expression)) {
    errors.push(`${pathLabel}: expression is invalid or too deeply nested`);
    return false;
  }
  const kind = expression.kind;
  if (!GENERATED_EXPRESSION_KINDS.has(String(kind))) {
    errors.push(
      `${pathLabel}: unsupported expression kind ${String(kind ?? "(missing)")}`,
    );
    return false;
  }
  if (kind === "constant") {
    if (asFiniteNumber(expression.value) === undefined)
      errors.push(`${pathLabel}: constant must be finite`);
    return asFiniteNumber(expression.value) !== undefined;
  }
  if (kind === "input") {
    const id = typeof expression.id === "string" ? expression.id : "";
    if (!knownInputs.has(id))
      errors.push(`${pathLabel}: unknown input ${id || "(missing)"}`);
    return knownInputs.has(id);
  }
  if (kind === "binary") {
    if (!GENERATED_BINARY_OPERATORS.has(String(expression.op))) {
      errors.push(`${pathLabel}: unsupported binary operator`);
    }
    const left = validateExpression(
      expression.left,
      knownInputs,
      errors,
      `${pathLabel}.left`,
      depth + 1,
      counter,
    );
    const right = validateExpression(
      expression.right,
      knownInputs,
      errors,
      `${pathLabel}.right`,
      depth + 1,
      counter,
    );
    return left && right;
  }
  if (kind === "unary") {
    if (!GENERATED_UNARY_OPERATORS.has(String(expression.op))) {
      errors.push(`${pathLabel}: unsupported unary operator`);
    }
    return validateExpression(
      expression.argument,
      knownInputs,
      errors,
      `${pathLabel}.argument`,
      depth + 1,
      counter,
    );
  }
  if (kind === "clamp") {
    return ["value", "min", "max"].every((field) =>
      validateExpression(
        expression[field],
        knownInputs,
        errors,
        `${pathLabel}.${field}`,
        depth + 1,
        counter,
      ),
    );
  }
  if (kind === "conditional") {
    if (!GENERATED_COMPARISONS.has(String(expression.comparison))) {
      errors.push(`${pathLabel}: unsupported comparison`);
    }
    return ["left", "right", "whenTrue", "whenFalse"].every((field) =>
      validateExpression(
        expression[field],
        knownInputs,
        errors,
        `${pathLabel}.${field}`,
        depth + 1,
        counter,
      ),
    );
  }
  errors.push(
    `${pathLabel}: unsupported expression kind ${String(kind ?? "(missing)")}`,
  );
  return false;
}

function validateControl(
  value: unknown,
  errors: string[],
  index: number,
): value is GeneratedVisualControl {
  if (!isRecord(value)) {
    errors.push(`controls[${index}] must be an object`);
    return false;
  }
  const id = typeof value.id === "string" ? value.id : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const type = typeof value.type === "string" ? value.type : "";
  if (!CONTROL_ID_PATTERN.test(id)) {
    errors.push(`controls[${index}].id is invalid`);
  } else if (RESERVED_CONTROL_IDS.has(id)) {
    errors.push(
      `controls[${index}].id is reserved by the generated visual runtime: ${id}`,
    );
  }
  if (!label) errors.push(`controls[${index}] needs an accessible label`);
  if (!GENERATED_CONTROL_TYPES.has(type)) {
    errors.push(`controls[${index}].type is invalid`);
  }
  if (
    value.kind !== undefined &&
    (typeof value.kind !== "string" || !GENERATED_CONTROL_KINDS.has(value.kind))
  ) {
    errors.push(`controls[${index}].kind is invalid`);
  }
  if (
    value.protocolRole !== undefined &&
    (typeof value.protocolRole !== "string" ||
      !GENERATED_CONTROL_PROTOCOL_ROLES.has(value.protocolRole))
  ) {
    errors.push(`controls[${index}].protocolRole is invalid`);
  }
  if (
    (type === "slider" || type === "number") &&
    asFiniteNumber(value.defaultValue) === undefined
  ) {
    errors.push(`controls[${index}] needs a finite numeric default`);
  }
  if (type === "slider" || type === "number") {
    const min = asFiniteNumber(value.min);
    const max = asFiniteNumber(value.max);
    const step = asFiniteNumber(value.step);
    if (min === undefined || max === undefined || min >= max)
      errors.push(`controls[${index}] needs min < max`);
    if (step === undefined || step <= 0)
      errors.push(`controls[${index}] needs a positive step`);
  }
  if (type === "select") {
    const options = Array.isArray(value.options)
      ? value.options.filter(
          (option): option is string =>
            typeof option === "string" && option.trim().length > 0,
        )
      : [];
    if (options.length < 2 || options.length > MAX_SELECT_OPTIONS) {
      errors.push(
        `controls[${index}] select needs 2-${MAX_SELECT_OPTIONS} options`,
      );
    }
    if (new Set(options).size !== options.length)
      errors.push(`controls[${index}] select options must be unique`);
    if (
      typeof value.defaultValue !== "string" ||
      !options.includes(value.defaultValue)
    ) {
      errors.push(
        `controls[${index}] select defaultValue must match one declared option`,
      );
    }
  }
  if (type === "toggle" && typeof value.defaultValue !== "boolean") {
    errors.push(`controls[${index}] toggle defaultValue must be boolean`);
  }
  if (type === "button" && value.defaultValue !== 0) {
    errors.push(`controls[${index}] button defaultValue must be 0`);
  }
  if (
    value.protocolRole === "prediction_input" &&
    type !== "slider" &&
    type !== "number" &&
    type !== "select"
  ) {
    errors.push(
      `controls[${index}] prediction_input must use slider, number, or select`,
    );
  }
  if (
    typeof value.protocolRole === "string" &&
    value.protocolRole !== "prediction_input" &&
    type !== "button" &&
    type !== "toggle"
  ) {
    errors.push(
      `controls[${index}] ${value.protocolRole} must use button or toggle`,
    );
  }
  if (
    value.kind === "protocol_action" &&
    type !== "button" &&
    type !== "toggle"
  ) {
    errors.push(`controls[${index}] protocol_action must use button or toggle`);
  }
  if (
    typeof value.kind === "string" &&
    value.kind !== "protocol_action" &&
    (type === "button" || type === "toggle")
  ) {
    errors.push(`controls[${index}] ${type} must use kind protocol_action`);
  }
  if (
    value.protocolRole === "prediction_input" &&
    value.kind === "protocol_action"
  ) {
    errors.push(
      `controls[${index}] prediction_input must not use kind protocol_action`,
    );
  }
  if (
    typeof value.protocolRole === "string" &&
    value.protocolRole !== "prediction_input" &&
    value.kind !== undefined &&
    value.kind !== "protocol_action"
  ) {
    errors.push(
      `controls[${index}] ${value.protocolRole} must use kind protocol_action`,
    );
  }
  return true;
}

function validateSpatialScalar(
  value: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
  options: { positive?: boolean; max?: number } = {},
): boolean {
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined) {
    const max = options.max ?? MAX_SPATIAL_MAGNITUDE;
    let valid = true;
    if (Math.abs(numeric) > max) {
      errors.push(`${pathLabel} must stay within +/-${max}`);
      valid = false;
    }
    if (options.positive && numeric <= 0) {
      errors.push(`${pathLabel} must be positive`);
      valid = false;
    }
    return valid;
  }
  if (!isRecord(value)) {
    errors.push(`${pathLabel} must be a finite number or expression`);
    return false;
  }
  return validateExpression(value, knownInputs, errors, pathLabel);
}

function validateSpatialVector3(
  value: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
): boolean {
  if (!Array.isArray(value) || value.length !== 3) {
    errors.push(`${pathLabel} must contain exactly three spatial scalars`);
    return false;
  }
  return value.every((component, index) =>
    validateSpatialScalar(
      component,
      knownInputs,
      errors,
      `${pathLabel}[${index}]`,
    ),
  );
}

function literalSpatialVectorLength(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const components = value.map(asFiniteNumber);
  if (components.some((component) => component === undefined)) return undefined;
  return Math.hypot(...(components as number[]));
}

function spatialPolygonShapeDiagnostics(
  points: Array<[number, number, number]>,
  pathLabel: string,
): string[] {
  if (points.length < 3)
    return [`${pathLabel}.points needs at least three points`];
  const scale = Math.max(1, ...points.flatMap((point) => point.map(Math.abs)));
  const tolerance = Math.max(1e-7, scale * 1e-9);
  const subtract = (
    left: [number, number, number],
    right: [number, number, number],
  ): [number, number, number] =>
    left.map((value, index) => value - right[index]) as [
      number,
      number,
      number,
    ];
  const cross = (
    left: [number, number, number],
    right: [number, number, number],
  ): [number, number, number] => [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const errors: string[] = [];
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < points.length;
      rightIndex += 1
    ) {
      if (
        Math.hypot(...subtract(points[leftIndex], points[rightIndex])) <=
        tolerance
      ) {
        errors.push(`${pathLabel}.points must be distinct`);
        leftIndex = points.length;
        break;
      }
    }
  }
  const origin = points[0];
  const firstEdge = points
    .slice(1)
    .map((point) => subtract(point, origin))
    .find((edge) => Math.hypot(...edge) > tolerance);
  if (!firstEdge)
    return [
      ...errors,
      `${pathLabel}.points must contain at least three non-collinear points`,
    ];
  const firstLength = Math.hypot(...firstEdge);
  const normal = points
    .slice(1)
    .map((point) => cross(firstEdge, subtract(point, origin)))
    .find((candidate) => Math.hypot(...candidate) / firstLength > tolerance);
  if (!normal)
    return [
      ...errors,
      `${pathLabel}.points must contain at least three non-collinear points`,
    ];
  const normalLength = Math.hypot(...normal);
  const unitNormal = normal.map((component) => component / normalLength);
  const nonCoplanar = points.some((point) => {
    const delta = subtract(point, origin);
    return (
      Math.abs(
        delta.reduce(
          (sum, component, index) => sum + component * unitNormal[index],
          0,
        ),
      ) > tolerance
    );
  });
  if (nonCoplanar) return [...errors, `${pathLabel}.points must be coplanar`];

  const dominantAxis = unitNormal
    .map((component, index) => ({ index, magnitude: Math.abs(component) }))
    .sort((left, right) => right.magnitude - left.magnitude)[0].index;
  const projected = points.map(
    (point) =>
      point.filter((_, index) => index !== dominantAxis) as [number, number],
  );
  const projectedScale = Math.max(
    1,
    ...projected.flatMap((point) => point.map(Math.abs)),
  );
  const areaTolerance = tolerance * projectedScale;
  const orientation = (
    first: [number, number],
    second: [number, number],
    third: [number, number],
  ) =>
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
  const onSegment = (
    first: [number, number],
    second: [number, number],
    point: [number, number],
  ) =>
    point[0] >= Math.min(first[0], second[0]) - tolerance &&
    point[0] <= Math.max(first[0], second[0]) + tolerance &&
    point[1] >= Math.min(first[1], second[1]) - tolerance &&
    point[1] <= Math.max(first[1], second[1]) + tolerance;
  const segmentsIntersect = (
    firstStart: [number, number],
    firstEnd: [number, number],
    secondStart: [number, number],
    secondEnd: [number, number],
  ) => {
    const firstSideStart = orientation(firstStart, firstEnd, secondStart);
    const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
    const secondSideStart = orientation(secondStart, secondEnd, firstStart);
    const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);
    if (
      (Math.abs(firstSideStart) <= areaTolerance &&
        onSegment(firstStart, firstEnd, secondStart)) ||
      (Math.abs(firstSideEnd) <= areaTolerance &&
        onSegment(firstStart, firstEnd, secondEnd)) ||
      (Math.abs(secondSideStart) <= areaTolerance &&
        onSegment(secondStart, secondEnd, firstStart)) ||
      (Math.abs(secondSideEnd) <= areaTolerance &&
        onSegment(secondStart, secondEnd, firstEnd))
    )
      return true;
    return (
      firstSideStart > areaTolerance !== firstSideEnd > areaTolerance &&
      secondSideStart > areaTolerance !== secondSideEnd > areaTolerance
    );
  };
  const edgeCount = projected.length;
  for (let firstIndex = 0; firstIndex < edgeCount; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % edgeCount;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < edgeCount;
      secondIndex += 1
    ) {
      const secondNext = (secondIndex + 1) % edgeCount;
      if (
        firstIndex === secondIndex ||
        firstIndex === secondNext ||
        firstNext === secondIndex ||
        firstNext === secondNext
      )
        continue;
      if (
        segmentsIntersect(
          projected[firstIndex],
          projected[firstNext],
          projected[secondIndex],
          projected[secondNext],
        )
      ) {
        errors.push(
          `${pathLabel}.points must form a non-self-intersecting boundary`,
        );
        return errors;
      }
    }
  }
  return errors;
}

function validateSpatialPrimitive(
  value: unknown,
  knownInputs: Set<string>,
  errors: string[],
  pathLabel: string,
  primitiveIds: Set<string>,
): value is SpatialPrimitive {
  if (!isRecord(value)) {
    errors.push(`${pathLabel} must be an object`);
    return false;
  }
  const kind = typeof value.kind === "string" ? value.kind : "";
  if (!SPATIAL_PRIMITIVE_KINDS.has(kind)) {
    errors.push(
      `${pathLabel}.kind must be plane, polygon, sphere, cylinder, cone, point, or vector`,
    );
    return false;
  }
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID_PATTERN.test(id) || primitiveIds.has(id)) {
    errors.push(
      `${pathLabel}.id is invalid or duplicate within the spatial scene`,
    );
  } else {
    primitiveIds.add(id);
  }
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!label || label.length > 72)
    errors.push(`${pathLabel}.label must contain 1-72 characters`);
  if (value.color !== undefined && !SPATIAL_PALETTE.has(String(value.color))) {
    errors.push(`${pathLabel}.color must use a safe spatial palette token`);
  }
  if (
    value.pattern !== undefined &&
    !SPATIAL_PATTERNS.has(String(value.pattern))
  ) {
    errors.push(
      `${pathLabel}.pattern must be solid, striped, dotted, or crosshatch`,
    );
  }
  if (
    value.labelMode !== undefined &&
    !SPATIAL_LABEL_MODES.has(String(value.labelMode))
  ) {
    errors.push(`${pathLabel}.labelMode must be inline or legend_only`);
  }
  if (value.opacity !== undefined) {
    const opacity = asFiniteNumber(value.opacity);
    if (opacity === undefined || opacity < 0.1 || opacity > 1) {
      errors.push(`${pathLabel}.opacity must be between 0.1 and 1`);
    }
  }
  if (value.visibleWhen !== undefined) {
    validateExpression(
      value.visibleWhen,
      knownInputs,
      errors,
      `${pathLabel}.visibleWhen`,
    );
  }

  const commonFields = [
    "kind",
    "id",
    "label",
    "color",
    "pattern",
    "labelMode",
    "opacity",
    "visibleWhen",
  ];
  const fieldsByKind: Record<string, string[]> = {
    plane: ["center", "normal", "size"],
    polygon: ["points"],
    sphere: ["center", "radius"],
    cylinder: ["center", "axis", "radius", "height"],
    cone: ["apex", "axis", "radius", "height"],
    point: ["position", "size"],
    vector: ["from", "to", "headSize"],
  };
  const allowedFields = new Set([...commonFields, ...fieldsByKind[kind]]);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field))
      errors.push(`${pathLabel}.${field} is not supported for a ${kind}`);
  }

  if (kind === "plane") {
    validateSpatialVector3(
      value.center,
      knownInputs,
      errors,
      `${pathLabel}.center`,
    );
    validateSpatialVector3(
      value.normal,
      knownInputs,
      errors,
      `${pathLabel}.normal`,
    );
    validateSpatialScalar(
      value.size,
      knownInputs,
      errors,
      `${pathLabel}.size`,
      { positive: true },
    );
    if (literalSpatialVectorLength(value.normal) === 0)
      errors.push(`${pathLabel}.normal must be non-zero`);
  } else if (kind === "polygon") {
    if (
      !Array.isArray(value.points) ||
      value.points.length < 3 ||
      value.points.length > MAX_SPATIAL_POLYGON_POINTS
    ) {
      errors.push(
        `${pathLabel}.points must contain 3-${MAX_SPATIAL_POLYGON_POINTS} spatial vectors`,
      );
    } else {
      value.points.forEach((point, pointIndex) => {
        validateSpatialVector3(
          point,
          knownInputs,
          errors,
          `${pathLabel}.points[${pointIndex}]`,
        );
      });
      const literalPoints = value.points.map((point) =>
        Array.isArray(point) ? point.map(asFiniteNumber) : [],
      );
      if (
        literalPoints.every(
          (point) =>
            point.length === 3 &&
            point.every((component) => component !== undefined),
        )
      ) {
        errors.push(
          ...spatialPolygonShapeDiagnostics(
            literalPoints.map(
              (point) => point.map(Number) as [number, number, number],
            ),
            pathLabel,
          ),
        );
      }
    }
  } else if (kind === "sphere") {
    validateSpatialVector3(
      value.center,
      knownInputs,
      errors,
      `${pathLabel}.center`,
    );
    validateSpatialScalar(
      value.radius,
      knownInputs,
      errors,
      `${pathLabel}.radius`,
      { positive: true },
    );
  } else if (kind === "cylinder") {
    validateSpatialVector3(
      value.center,
      knownInputs,
      errors,
      `${pathLabel}.center`,
    );
    validateSpatialVector3(
      value.axis,
      knownInputs,
      errors,
      `${pathLabel}.axis`,
    );
    validateSpatialScalar(
      value.radius,
      knownInputs,
      errors,
      `${pathLabel}.radius`,
      { positive: true },
    );
    validateSpatialScalar(
      value.height,
      knownInputs,
      errors,
      `${pathLabel}.height`,
      { positive: true },
    );
    if (literalSpatialVectorLength(value.axis) === 0)
      errors.push(`${pathLabel}.axis must be non-zero`);
  } else if (kind === "cone") {
    validateSpatialVector3(
      value.apex,
      knownInputs,
      errors,
      `${pathLabel}.apex`,
    );
    validateSpatialVector3(
      value.axis,
      knownInputs,
      errors,
      `${pathLabel}.axis`,
    );
    validateSpatialScalar(
      value.radius,
      knownInputs,
      errors,
      `${pathLabel}.radius`,
      { positive: true },
    );
    validateSpatialScalar(
      value.height,
      knownInputs,
      errors,
      `${pathLabel}.height`,
      { positive: true },
    );
    if (literalSpatialVectorLength(value.axis) === 0)
      errors.push(`${pathLabel}.axis must be non-zero`);
  } else if (kind === "point") {
    validateSpatialVector3(
      value.position,
      knownInputs,
      errors,
      `${pathLabel}.position`,
    );
    if (value.size !== undefined) {
      validateSpatialScalar(
        value.size,
        knownInputs,
        errors,
        `${pathLabel}.size`,
        { positive: true, max: 40 },
      );
    }
  } else if (kind === "vector") {
    validateSpatialVector3(
      value.from,
      knownInputs,
      errors,
      `${pathLabel}.from`,
    );
    validateSpatialVector3(value.to, knownInputs, errors, `${pathLabel}.to`);
    if (value.headSize !== undefined) {
      validateSpatialScalar(
        value.headSize,
        knownInputs,
        errors,
        `${pathLabel}.headSize`,
        { positive: true, max: 40 },
      );
    }
    const from = Array.isArray(value.from)
      ? value.from.map(asFiniteNumber)
      : [];
    const to = Array.isArray(value.to) ? value.to.map(asFiniteNumber) : [];
    if (
      from.length === 3 &&
      to.length === 3 &&
      [...from, ...to].every((component) => component !== undefined)
    ) {
      const distance = Math.hypot(
        ...from.map(
          (component, index) => Number(to[index]) - Number(component),
        ),
      );
      if (distance === 0)
        errors.push(`${pathLabel} must have distinct from and to points`);
    }
  }
  return true;
}

function validateSpatialScene(
  scene: Record<string, unknown>,
  knownInputs: Set<string>,
  errors: string[],
  sceneIndex: number,
): void {
  const pathLabel = `scenes[${sceneIndex}]`;
  if (typeof scene.title !== "string" || !scene.title.trim())
    errors.push(`${pathLabel} spatial scene needs a title`);
  if (scene.view !== undefined) {
    if (!isRecord(scene.view)) {
      errors.push(`${pathLabel}.view must be an object`);
    } else {
      for (const field of Object.keys(scene.view)) {
        if (
          !new Set([
            "azimuthDegrees",
            "elevationDegrees",
            "scale",
            "projection",
            "interaction",
          ]).has(field)
        ) {
          errors.push(`${pathLabel}.view.${field} is not supported`);
        }
      }
      if (scene.view.azimuthDegrees !== undefined) {
        const value = asFiniteNumber(scene.view.azimuthDegrees);
        if (value === undefined || value < -180 || value > 180) {
          errors.push(
            `${pathLabel}.view.azimuthDegrees must be between -180 and 180`,
          );
        }
      }
      if (scene.view.elevationDegrees !== undefined) {
        const value = asFiniteNumber(scene.view.elevationDegrees);
        if (value === undefined || value < -85 || value > 85) {
          errors.push(
            `${pathLabel}.view.elevationDegrees must be between -85 and 85`,
          );
        }
      }
      if (scene.view.scale !== undefined) {
        const value = asFiniteNumber(scene.view.scale);
        if (value === undefined || value < 0.25 || value > 2) {
          errors.push(`${pathLabel}.view.scale must be between 0.25 and 2`);
        }
      }
      if (
        scene.view.projection !== undefined &&
        !SPATIAL_PROJECTIONS.has(String(scene.view.projection))
      ) {
        errors.push(
          `${pathLabel}.view.projection must be ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.projections.join(" or ")}`,
        );
      }
      if (
        scene.view.interaction !== undefined &&
        !SPATIAL_INTERACTIONS.has(String(scene.view.interaction))
      ) {
        errors.push(
          `${pathLabel}.view.interaction must be ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.interactions.join(" or ")}`,
        );
      }
    }
  }
  if (
    !Array.isArray(scene.groups) ||
    scene.groups.length === 0 ||
    scene.groups.length > MAX_SPATIAL_GROUPS
  ) {
    errors.push(
      `${pathLabel} spatial scene needs 1-${MAX_SPATIAL_GROUPS} groups`,
    );
    return;
  }
  const groupIds = new Set<string>();
  const primitiveIds = new Set<string>();
  let primitiveCount = 0;
  scene.groups.forEach((group, groupIndex) => {
    const groupPath = `${pathLabel}.groups[${groupIndex}]`;
    if (!isRecord(group)) {
      errors.push(`${groupPath} must be an object`);
      return;
    }
    for (const field of Object.keys(group)) {
      if (!new Set(["id", "label", "visibleWhen", "primitives"]).has(field)) {
        errors.push(`${groupPath}.${field} is not supported`);
      }
    }
    const id = typeof group.id === "string" ? group.id : "";
    if (!ID_PATTERN.test(id) || groupIds.has(id))
      errors.push(`${groupPath}.id is invalid or duplicate`);
    else groupIds.add(id);
    const label = typeof group.label === "string" ? group.label.trim() : "";
    if (!label || label.length > 72)
      errors.push(`${groupPath}.label must contain 1-72 characters`);
    if (group.visibleWhen !== undefined) {
      validateExpression(
        group.visibleWhen,
        knownInputs,
        errors,
        `${groupPath}.visibleWhen`,
      );
    }
    if (
      !Array.isArray(group.primitives) ||
      group.primitives.length === 0 ||
      group.primitives.length > MAX_SPATIAL_PRIMITIVES_PER_GROUP
    ) {
      errors.push(
        `${groupPath} needs 1-${MAX_SPATIAL_PRIMITIVES_PER_GROUP} primitives`,
      );
      return;
    }
    primitiveCount += group.primitives.length;
    group.primitives.forEach((primitive, primitiveIndex) => {
      validateSpatialPrimitive(
        primitive,
        knownInputs,
        errors,
        `${groupPath}.primitives[${primitiveIndex}]`,
        primitiveIds,
      );
    });
  });
  if (primitiveCount > MAX_SPATIAL_PRIMITIVES) {
    errors.push(
      `${pathLabel} spatial scene has more than ${MAX_SPATIAL_PRIMITIVES} primitives`,
    );
  }
}

function expressionFieldsFromScene(
  scene: Record<string, unknown>,
): Array<[string, unknown]> {
  const fields: Array<[string, unknown]> = [];
  const addSpatialScalar = (pathLabel: string, value: unknown) => {
    if (isRecord(value)) fields.push([pathLabel, value]);
  };
  const addSpatialVector = (pathLabel: string, value: unknown) => {
    if (!Array.isArray(value)) return;
    value.forEach((component, index) =>
      addSpatialScalar(`${pathLabel}[${index}]`, component),
    );
  };
  if (scene.kind === "plot" && Array.isArray(scene.series)) {
    scene.series.forEach((series, index) => {
      if (isRecord(series))
        fields.push([`series[${index}].expression`, series.expression]);
    });
    if (Array.isArray(scene.markers)) {
      scene.markers.forEach((marker, index) => {
        if (isRecord(marker))
          fields.push(
            [`markers[${index}].x`, marker.x],
            [`markers[${index}].y`, marker.y],
          );
      });
    }
  }
  if (scene.kind === "diagram") {
    if (Array.isArray(scene.nodes)) {
      scene.nodes.forEach((node, index) => {
        if (isRecord(node) && node.value)
          fields.push([`nodes[${index}].value`, node.value]);
      });
    }
    if (Array.isArray(scene.edges)) {
      scene.edges.forEach((edge, index) => {
        if (isRecord(edge) && edge.strength)
          fields.push([`edges[${index}].strength`, edge.strength]);
      });
    }
  }
  if (scene.kind === "table" && Array.isArray(scene.rows)) {
    scene.rows.forEach((row, rowIndex) => {
      if (!isRecord(row) || !Array.isArray(row.values)) return;
      row.values.forEach((cell, cellIndex) => {
        if (isRecord(cell))
          fields.push([`rows[${rowIndex}].values[${cellIndex}]`, cell]);
      });
    });
  }
  if (scene.kind === "annotation" || scene.kind === "formula") {
    if (scene.visibleWhen) fields.push(["visibleWhen", scene.visibleWhen]);
  }
  if (scene.kind === "animated_marker") {
    fields.push(["x", scene.x], ["y", scene.y]);
  }
  if (scene.kind === "status") fields.push(["value", scene.value]);
  if (scene.kind === "spatial" && Array.isArray(scene.groups)) {
    scene.groups.forEach((group, groupIndex) => {
      if (!isRecord(group)) return;
      if (group.visibleWhen !== undefined) {
        addSpatialScalar(
          `groups[${groupIndex}].visibleWhen`,
          group.visibleWhen,
        );
      }
      if (!Array.isArray(group.primitives)) return;
      group.primitives.forEach((primitive, primitiveIndex) => {
        if (!isRecord(primitive)) return;
        const base = `groups[${groupIndex}].primitives[${primitiveIndex}]`;
        if (primitive.visibleWhen !== undefined)
          addSpatialScalar(`${base}.visibleWhen`, primitive.visibleWhen);
        if (primitive.kind === "plane") {
          addSpatialVector(`${base}.center`, primitive.center);
          addSpatialVector(`${base}.normal`, primitive.normal);
          addSpatialScalar(`${base}.size`, primitive.size);
        } else if (
          primitive.kind === "polygon" &&
          Array.isArray(primitive.points)
        ) {
          primitive.points.forEach((point, pointIndex) => {
            addSpatialVector(`${base}.points[${pointIndex}]`, point);
          });
        } else if (primitive.kind === "sphere") {
          addSpatialVector(`${base}.center`, primitive.center);
          addSpatialScalar(`${base}.radius`, primitive.radius);
        } else if (primitive.kind === "cylinder") {
          addSpatialVector(`${base}.center`, primitive.center);
          addSpatialVector(`${base}.axis`, primitive.axis);
          addSpatialScalar(`${base}.radius`, primitive.radius);
          addSpatialScalar(`${base}.height`, primitive.height);
        } else if (primitive.kind === "cone") {
          addSpatialVector(`${base}.apex`, primitive.apex);
          addSpatialVector(`${base}.axis`, primitive.axis);
          addSpatialScalar(`${base}.radius`, primitive.radius);
          addSpatialScalar(`${base}.height`, primitive.height);
        } else if (primitive.kind === "point") {
          addSpatialVector(`${base}.position`, primitive.position);
          if (primitive.size !== undefined)
            addSpatialScalar(`${base}.size`, primitive.size);
        } else if (primitive.kind === "vector") {
          addSpatialVector(`${base}.from`, primitive.from);
          addSpatialVector(`${base}.to`, primitive.to);
          if (primitive.headSize !== undefined)
            addSpatialScalar(`${base}.headSize`, primitive.headSize);
        }
      });
    });
  }
  return fields;
}

type GeneratedVisualSpatialRepresentationRequirement = {
  required: boolean;
  requiresSurfacePrimitive: boolean;
  requiresVectorPrimitive: boolean;
};

/**
 * A necessity score says how useful spatial reasoning looked before contract
 * review; it is not authority to resurrect geometry that the reviewed learner
 * action replaced.  Require the final, planner-projected action to ask the
 * learner to work with physical geometry as well.  In particular, words such
 * as "path" or "branch" in a node-link dependency diagram are not spatial
 * merely because an earlier necessity rationale discussed vectors.
 */
const EXPLICIT_SPATIAL_ACTION_RE =
  /\b(?:spatial|three[ -]?dimensional|3[ -]?d|orbit|rotat(?:e|ing|ion)|orient(?:ation|ing)?)\b/i;
const PHYSICAL_GEOMETRY_MANIPULATION_RE =
  /\b(?:apply|construct|drag|move|place|position|trace|vary|adjust|follow|sweep)\b[\s\S]{0,180}\b(?:surface|boundary|interface|pillbox|plane|solid|volume|field|flux|normal|tangential|direction|vector|physical path|integration path|contour|trajectory)\b/i;
const PHYSICAL_GEOMETRY_OBSERVATION_RE =
  /\b(?:compare|examine|inspect|observe)\b/i;
const PHYSICAL_GEOMETRY_TERM_RE =
  /\b(?:surface|boundary|interface|pillbox|plane|solid|volume|field|flux|normal|tangential|direction|vector|physical path|integration path|contour|trajectory)\b/gi;
const UI_FIELD_RE =
  /\b(?:data|form|input|number|numeric|search|text)\s+field\b/gi;
const DIAGRAM_GRAPH_ORIENTATION_OBJECT_RE =
  /\b(?:rotat(?:e|ing)|orient(?:ed|ing)?)\b\s+(?:(?:a|an|the)\s+)?(?:orientation|rotation)\s+of\s+(?:(?:a|an|the)\s+)?(?:[\p{L}\p{N}_-]+\s+){0,3}(?:diagram|graph)\b|\b(?:rotat(?:e|ing)|orient(?:ed|ing)?)\b\s+(?:(?:a|an|the)\s+)?(?:[\p{L}\p{N}_-]+\s+){0,3}(?:diagram|graph)\b|\b(?:orientation|rotation)\b\s+of\s+(?:(?:a|an|the)\s+)?(?:[\p{L}\p{N}_-]+\s+){0,3}(?:diagram|graph)\b|\b(?:diagram|graph)\b(?:'s)?\s+(?:orientation|rotation)\b/giu;

function finalLearnerActionRequiresPhysicalGeometry(
  opportunity?: VisualizationOpportunity,
): boolean {
  const learnerAction = opportunity?.learnerAction?.trim() ?? "";
  const actionWithoutNonPhysicalObjects = learnerAction
    .replace(UI_FIELD_RE, "")
    .replace(DIAGRAM_GRAPH_ORIENTATION_OBJECT_RE, "");
  if (EXPLICIT_SPATIAL_ACTION_RE.test(actionWithoutNonPhysicalObjects))
    return true;
  if (PHYSICAL_GEOMETRY_MANIPULATION_RE.test(actionWithoutNonPhysicalObjects))
    return true;
  if (!PHYSICAL_GEOMETRY_OBSERVATION_RE.test(actionWithoutNonPhysicalObjects))
    return false;
  return (
    new Set(
      [
        ...actionWithoutNonPhysicalObjects.matchAll(
          PHYSICAL_GEOMETRY_TERM_RE,
        ),
      ].map(([term]) => term.toLowerCase()),
    ).size >= 2
  );
}

/**
 * The reviewed visual-necessity route can explicitly establish that an
 * interaction must teach through physical geometry. Preserve that
 * model-authored constraint at compilation time so a node-link flowchart
 * cannot silently replace a required spatial construction.
 */
function reviewedSpatialRepresentationRequirement(
  opportunity?: VisualizationOpportunity,
): GeneratedVisualSpatialRepresentationRequirement {
  const spatialValue = opportunity?.necessityDecision?.spatialValue;
  const required =
    typeof spatialValue === "number" &&
    Number.isFinite(spatialValue) &&
    spatialValue >= 0.85 &&
    finalLearnerActionRequiresPhysicalGeometry(opportunity);
  if (!required) {
    return {
      required: false,
      requiresSurfacePrimitive: false,
      requiresVectorPrimitive: false,
    };
  }
  // Primitive requirements must come from the same final action that made the
  // route spatial.  Earlier necessity prose is deliberately excluded because
  // contract review may have replaced an unsupported orientation or surface
  // task with a diagram, table, or other bounded representation.
  const reviewText = opportunity?.learnerAction ?? "";
  return {
    required: true,
    requiresSurfacePrimitive:
      /\b(?:boundary|interface|pillbox|surface|conductor|dielectric)\b/i.test(
        reviewText,
      ),
    requiresVectorPrimitive:
      /\b(?:field|flux|normal|tangential|direction|vector)\b/i.test(reviewText),
  };
}

/**
 * Process-free cache identity used by the disposable compiler. Keeping this
 * semantic contract here lets the worker preserve the existing cache behavior
 * without making the Next-facing orchestration module import TypeScript.
 */
export function generatedVisualCompilerOpportunityCacheContract(
  opportunity: VisualizationOpportunity,
): {
  requiredInputs: VisualizationOpportunity["requiredInputs"];
  requiredOutputs: VisualizationOpportunity["requiredOutputs"];
  spatialRepresentationRequirement: GeneratedVisualSpatialRepresentationRequirement;
} {
  return {
    requiredInputs: opportunity.requiredInputs,
    requiredOutputs: opportunity.requiredOutputs,
    spatialRepresentationRequirement:
      reviewedSpatialRepresentationRequirement(opportunity),
  };
}

export function validateGeneratedVisualizationDefinition(
  value: unknown,
  opportunity?: VisualizationOpportunity,
): {
  definition: GeneratedVisualizationDefinition | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value))
    return {
      definition: null,
      errors: ["definition must be an object"],
      warnings,
    };
  if (value.schemaVersion !== 1)
    errors.push("definition.schemaVersion must be 1");
  if (value.sdkVersion !== VISUAL_SDK_VERSION) {
    errors.push(`definition.sdkVersion must be ${VISUAL_SDK_VERSION}`);
  }
  for (const field of [
    "title",
    "description",
    "accessibilityDescription",
  ] as const) {
    if (typeof value[field] !== "string" || !value[field].trim())
      errors.push(`${field} is required`);
  }
  if (
    typeof value.accessibilityDescription === "string" &&
    value.accessibilityDescription.length < 30
  ) {
    errors.push(
      "accessibilityDescription must explain the interaction and output",
    );
  }
  if (EXTERNAL_URL_RE.test(JSON.stringify(value)))
    errors.push("definition contains an external URL");

  const controls = Array.isArray(value.controls) ? value.controls : [];
  if (controls.length > MAX_CONTROLS)
    errors.push(`definition has more than ${MAX_CONTROLS} controls`);
  const controlIds = new Set<string>();
  controls.forEach((control, index) => {
    if (validateControl(control, errors, index) && isRecord(control)) {
      const id = String(control.id);
      if (controlIds.has(id)) errors.push(`duplicate control id ${id}`);
      controlIds.add(id);
    }
  });
  const declaredControlIds = new Set(controlIds);
  controlIds.add("x");
  controlIds.add("t");

  const outputs = Array.isArray(value.outputs) ? value.outputs : [];
  if (outputs.length === 0 || outputs.length > MAX_OUTPUTS) {
    errors.push(`definition needs 1-${MAX_OUTPUTS} outputs`);
  }
  const outputIds = new Set<string>();
  outputs.forEach((output, index) => {
    if (!isRecord(output)) {
      errors.push(`outputs[${index}] must be an object`);
      return;
    }
    const id = typeof output.id === "string" ? output.id : "";
    if (!ID_PATTERN.test(id) || outputIds.has(id))
      errors.push(`outputs[${index}].id is invalid or duplicate`);
    outputIds.add(id);
    if (typeof output.label !== "string" || !output.label.trim())
      errors.push(`outputs[${index}] needs a label`);
    if (!GENERATED_OUTPUT_REPRESENTATIONS.has(String(output.representation))) {
      errors.push(`outputs[${index}].representation is invalid`);
    }
    if (output.expression) {
      validateExpression(
        output.expression,
        controlIds,
        errors,
        `outputs[${index}].expression`,
      );
    }
  });

  const scenes = Array.isArray(value.scenes) ? value.scenes : [];
  if (scenes.length === 0 || scenes.length > MAX_SCENES) {
    errors.push(`definition needs 1-${MAX_SCENES} scene nodes`);
  }
  scenes.forEach((scene, index) => {
    if (!isRecord(scene) || !GENERATED_SCENE_KINDS.has(String(scene.kind))) {
      errors.push(`scenes[${index}] has an unsupported kind`);
      return;
    }
    if (scene.kind === "plot") {
      const min = asFiniteNumber(scene.xMin);
      const max = asFiniteNumber(scene.xMax);
      const samples = asFiniteNumber(scene.samples);
      if (min === undefined || max === undefined || min >= max)
        errors.push(`scenes[${index}] plot needs xMin < xMax`);
      if (samples === undefined || samples < 8 || samples > 240)
        errors.push(`scenes[${index}] plot samples must be 8-240`);
      if (
        !Array.isArray(scene.series) ||
        scene.series.length === 0 ||
        scene.series.length > 8
      ) {
        errors.push(`scenes[${index}] plot needs 1-8 series`);
      }
      if (
        scene.markers !== undefined &&
        (!Array.isArray(scene.markers) || scene.markers.length > 8)
      ) {
        errors.push(`scenes[${index}] plot supports at most 8 markers`);
      }
    }
    if (scene.kind === "diagram") {
      const diagramNodeIds = new Set<string>();
      if (
        !Array.isArray(scene.nodes) ||
        scene.nodes.length === 0 ||
        scene.nodes.length > 40
      ) {
        errors.push(`scenes[${index}] diagram needs 1-40 nodes`);
      }
      if (!Array.isArray(scene.edges) || scene.edges.length > 80) {
        errors.push(`scenes[${index}] diagram has too many edges`);
      }
      if (Array.isArray(scene.nodes)) {
        scene.nodes.forEach((node, nodeIndex) => {
          if (!isRecord(node)) {
            errors.push(
              `scenes[${index}].nodes[${nodeIndex}] must be an object`,
            );
            return;
          }
          const nodeId = typeof node.id === "string" ? node.id : "";
          if (!ID_PATTERN.test(nodeId) || diagramNodeIds.has(nodeId)) {
            errors.push(
              `scenes[${index}].nodes[${nodeIndex}].id is invalid or duplicate`,
            );
          } else {
            diagramNodeIds.add(nodeId);
          }
          const x = asFiniteNumber(node.x);
          const y = asFiniteNumber(node.y);
          if (
            x === undefined ||
            x < 72 ||
            x > 568 ||
            y === undefined ||
            y < 48 ||
            y > 312
          ) {
            errors.push(
              `scenes[${index}].nodes[${nodeIndex}] must use runtime-safe source coordinates inside x=72-568 and y=48-312`,
            );
          }
          if (
            typeof node.label !== "string" ||
            !node.label.trim() ||
            node.label.length > 48
          ) {
            errors.push(
              `scenes[${index}].nodes[${nodeIndex}] needs a concise label of at most 48 characters`,
            );
          }
        });
      }
      if (Array.isArray(scene.edges)) {
        scene.edges.forEach((edge, edgeIndex) => {
          const edgePath = `scenes[${index}].edges[${edgeIndex}]`;
          if (!isRecord(edge)) {
            errors.push(`${edgePath} must be an object`);
            return;
          }
          const from = typeof edge.from === "string" ? edge.from : "";
          const to = typeof edge.to === "string" ? edge.to : "";
          if (!diagramNodeIds.has(from)) {
            errors.push(`${edgePath}.from must name a diagram node`);
          }
          if (!diagramNodeIds.has(to)) {
            errors.push(`${edgePath}.to must name a diagram node`);
          }
          if (from && from === to) {
            errors.push(`${edgePath} must connect two different diagram nodes`);
          }
        });
      }
    }
    if (scene.kind === "timeline") {
      if (
        !Array.isArray(scene.steps) ||
        scene.steps.length < 2 ||
        scene.steps.length > 30
      ) {
        errors.push(`scenes[${index}] timeline needs 2-30 steps`);
      }
      if (!declaredControlIds.has(String(scene.progressInput))) {
        errors.push(
          `scenes[${index}] timeline progressInput ${JSON.stringify(String(scene.progressInput))} must name one declared control id (${[...declaredControlIds].join(", ") || "none declared"})`,
        );
      }
    }
    if (scene.kind === "value" && !outputIds.has(String(scene.outputId))) {
      errors.push(`scenes[${index}] references an unknown output`);
    }
    if (scene.kind === "status") {
      if (asFiniteNumber(scene.threshold) === undefined)
        errors.push(`scenes[${index}] status needs a finite threshold`);
      for (const field of ["title", "belowLabel", "equalLabel", "aboveLabel"]) {
        if (typeof scene[field] !== "string" || !String(scene[field]).trim()) {
          errors.push(`scenes[${index}] status needs ${field}`);
        }
      }
    }
    if (scene.kind === "spatial")
      validateSpatialScene(scene, controlIds, errors, index);
    for (const [field, expression] of expressionFieldsFromScene(scene)) {
      validateExpression(
        expression,
        controlIds,
        errors,
        `scenes[${index}].${field}`,
      );
    }
  });

  if (opportunity) {
    const spatialRequirement =
      reviewedSpatialRepresentationRequirement(opportunity);
    if (spatialRequirement.required) {
      let spatialSceneCount = 0;
      const primitiveKinds = new Set<string>();
      for (const scene of scenes) {
        if (
          !isRecord(scene) ||
          scene.kind !== "spatial" ||
          !Array.isArray(scene.groups)
        ) {
          continue;
        }
        spatialSceneCount += 1;
        for (const group of scene.groups) {
          if (!isRecord(group) || !Array.isArray(group.primitives)) continue;
          for (const primitive of group.primitives) {
            if (isRecord(primitive) && typeof primitive.kind === "string") {
              primitiveKinds.add(primitive.kind);
            }
          }
        }
      }
      if (spatialSceneCount === 0) {
        errors.push(
          "reviewed_spatial_representation.missing_spatial_scene: the reviewed route requires a source-grounded spatial scene; a diagram node-link graph, flowchart, or plot cannot substitute for physical geometry",
        );
      } else {
        const surfaceKinds = new Set([
          "plane",
          "polygon",
          "sphere",
          "cylinder",
          "cone",
        ]);
        if (
          spatialRequirement.requiresSurfacePrimitive &&
          ![...primitiveKinds].some((kind) => surfaceKinds.has(kind))
        ) {
          errors.push(
            "reviewed_spatial_representation.missing_surface_primitive: the reviewed boundary or surface route requires a spatial surface primitive, not only points or vectors",
          );
        }
        if (
          spatialRequirement.requiresVectorPrimitive &&
          !primitiveKinds.has("vector")
        ) {
          errors.push(
            "reviewed_spatial_representation.missing_vector_primitive: the reviewed field or directional route requires a spatial vector primitive",
          );
        }
      }
    }
  }

  if (isRecord(value.animation)) {
    const duration = asFiniteNumber(value.animation.durationMs);
    if (duration === undefined || duration < 250 || duration > 120_000) {
      errors.push("animation.durationMs must be 250-120000");
    }
  }

  if (opportunity) {
    if (outputs.length !== opportunity.requiredOutputs.length) {
      errors.push(
        `opportunity requires exactly ${opportunity.requiredOutputs.length} output(s) in reviewed order, but the module declares ${outputs.length}`,
      );
    }
    opportunity.requiredOutputs.forEach((requiredOutput, index) => {
      const output = outputs[index];
      if (!isRecord(output)) {
        errors.push(
          `opportunity requires output ${requiredOutput.id} at outputs[${index}], but the module does not declare it there`,
        );
        return;
      }
      for (const field of ["id", "label", "representation"] as const) {
        if (output[field] !== requiredOutput[field]) {
          errors.push(
            field === "id"
              ? `opportunity requires output ${requiredOutput.id} at outputs[${index}] in reviewed order, but the module declares id ${JSON.stringify(output.id)}`
              : `opportunity output ${requiredOutput.id} must preserve ${field} ${JSON.stringify(requiredOutput[field])}, not ${JSON.stringify(output[field])}`,
          );
        }
      }
    });
    if (controls.length !== opportunity.requiredInputs.length) {
      errors.push(
        `opportunity requires exactly ${opportunity.requiredInputs.length} control(s) in reviewed order, but the module declares ${controls.length}`,
      );
    }
    opportunity.requiredInputs.forEach((requiredInput, index) => {
      const control = controls[index];
      if (!isRecord(control)) {
        errors.push(
          `opportunity requires control ${requiredInput.id} at controls[${index}], but the module does not declare it there`,
        );
        return;
      }
      if (control.id !== requiredInput.id) {
        errors.push(
          `opportunity requires control ${requiredInput.id} (id) at controls[${index}] in reviewed order, but the module declares id ${JSON.stringify(control.id)}`,
        );
      }
      if (control.type !== requiredInput.type) {
        errors.push(
          `opportunity control ${requiredInput.id} must use type ${requiredInput.type}, not ${String(control.type ?? "(missing)")}`,
        );
      }
      const requiredInputRecord = requiredInput as unknown as Record<
        string,
        unknown
      >;
      for (const field of [
        "kind",
        "label",
        "protocolRole",
        "unit",
        "min",
        "max",
        "step",
        "defaultValue",
      ] as const) {
        if (control[field] !== requiredInputRecord[field]) {
          errors.push(
            `opportunity control ${requiredInput.id} must preserve ${field} ${JSON.stringify(requiredInputRecord[field])}, not ${JSON.stringify(control[field])}`,
          );
        }
      }
      const requiredOptions = requiredInput.options;
      const actualOptions = control.options;
      const optionsMatch =
        (requiredOptions === undefined && actualOptions === undefined) ||
        (Array.isArray(requiredOptions) &&
          Array.isArray(actualOptions) &&
          actualOptions.length === requiredOptions.length &&
          actualOptions.every(
            (option, optionIndex) => option === requiredOptions[optionIndex],
          ));
      if (!optionsMatch) {
        errors.push(
          `opportunity control ${requiredInput.id} must preserve options ${JSON.stringify(requiredOptions)}, not ${JSON.stringify(actualOptions)}`,
        );
      }
      const expectedFields = new Set(
        [
          "id",
          "kind",
          "label",
          "type",
          "protocolRole",
          "unit",
          "min",
          "max",
          "step",
          "options",
          "defaultValue",
        ].filter((field) => requiredInputRecord[field] !== undefined),
      );
      const extraFields = Object.keys(control).filter(
        (field) => !expectedFields.has(field),
      );
      if (extraFields.length > 0) {
        errors.push(
          `opportunity control ${requiredInput.id} declares unreviewed field(s): ${extraFields.join(", ")}`,
        );
      }
    });
  }
  if (
    opportunity?.interactionGoal === "test_prediction" &&
    errors.length === 0
  ) {
    const candidate = value as unknown as GeneratedVisualizationDefinition;
    const protocol = predictionProtocolDiagnostics(
      candidate,
      opportunity,
      numericDefaults(candidate),
    );
    if (protocol && !protocol.passed) {
      errors.push(
        `test_prediction protocol is not executable: ${protocol.detail}`,
      );
    }
  }
  if (opportunity && errors.length === 0) {
    const process = timeDrivenProcessDiagnostics(
      value as unknown as GeneratedVisualizationDefinition,
      opportunity,
    );
    if (process && !process.passed) {
      errors.push(`simulate_system process is not executable: ${process.detail}`);
    }
  }
  return {
    definition:
      errors.length === 0
        ? (value as unknown as GeneratedVisualizationDefinition)
        : null,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

export function evaluateVisualExpression(
  expression: VisualExpression,
  state: Record<string, number>,
): number {
  switch (expression.kind) {
    case "constant":
      return expression.value;
    case "input":
      return Number(state[expression.id] ?? 0);
    case "binary": {
      const left = evaluateVisualExpression(expression.left, state);
      const right = evaluateVisualExpression(expression.right, state);
      if (expression.op === "add") return left + right;
      if (expression.op === "subtract") return left - right;
      if (expression.op === "multiply") return left * right;
      if (expression.op === "divide")
        return right === 0 ? Number.NaN : left / right;
      if (expression.op === "power") return Math.pow(left, right);
      if (expression.op === "min") return Math.min(left, right);
      return Math.max(left, right);
    }
    case "unary": {
      const value = evaluateVisualExpression(expression.argument, state);
      if (expression.op === "negate") return -value;
      if (expression.op === "abs") return Math.abs(value);
      if (expression.op === "sqrt") return Math.sqrt(value);
      if (expression.op === "sin") return Math.sin(value);
      if (expression.op === "cos") return Math.cos(value);
      if (expression.op === "tan") return Math.tan(value);
      if (expression.op === "exp") return Math.exp(value);
      return Math.log(value);
    }
    case "clamp":
      return Math.max(
        evaluateVisualExpression(expression.min, state),
        Math.min(
          evaluateVisualExpression(expression.max, state),
          evaluateVisualExpression(expression.value, state),
        ),
      );
    case "conditional": {
      const left = evaluateVisualExpression(expression.left, state);
      const right = evaluateVisualExpression(expression.right, state);
      const matches =
        expression.comparison === "lt"
          ? left < right
          : expression.comparison === "lte"
            ? left <= right
            : expression.comparison === "gt"
              ? left > right
              : expression.comparison === "gte"
                ? left >= right
                : left === right;
      return evaluateVisualExpression(
        matches ? expression.whenTrue : expression.whenFalse,
        state,
      );
    }
  }
}

function selectOptionIndex(control: GeneratedVisualControl): number {
  if (control.type !== "select" || !Array.isArray(control.options)) return 0;
  const index = control.options.indexOf(String(control.defaultValue));
  return index >= 0 ? index : 0;
}

function numericDefaults(
  definition: GeneratedVisualizationDefinition,
): Record<string, number> {
  const state: Record<string, number> = {};
  for (const control of definition.controls) {
    if (typeof control.defaultValue === "number")
      state[control.id] = control.defaultValue;
    else if (typeof control.defaultValue === "boolean")
      state[control.id] = control.defaultValue ? 1 : 0;
    else if (control.type === "select")
      state[control.id] = selectOptionIndex(control);
    else if (control.type === "button") state[control.id] = 0;
  }
  state.x = 0;
  state.t = 0;
  return state;
}

function numericCandidateTestInputValue(
  control: GeneratedVisualControl | undefined,
  value: unknown,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && control?.type === "select") {
    const optionIndex = control.options?.indexOf(value) ?? -1;
    return optionIndex >= 0 ? optionIndex : null;
  }
  return null;
}

function alternateControlStates(
  control: GeneratedVisualControl,
  current: number,
): number[] {
  if (control.type === "select") {
    const optionCount = control.options?.length ?? 0;
    return Array.from({ length: optionCount }, (_, index) => index).filter(
      (index) => index !== current,
    );
  }
  if (control.type === "toggle") return [current === 0 ? 1 : 0];
  if (control.type === "button") return [current + 1];
  if (control.type === "slider" || control.type === "number") {
    const candidates = [
      control.min,
      control.max,
      current - (control.step ?? 1),
      current + (control.step ?? 1),
    ];
    return [
      ...new Set(
        candidates.filter(
          (candidate): candidate is number =>
            typeof candidate === "number" &&
            Number.isFinite(candidate) &&
            Math.abs(candidate - current) > 1e-12 &&
            (control.min === undefined || candidate >= control.min) &&
            (control.max === undefined || candidate <= control.max),
        ),
      ),
    ];
  }
  return [];
}

function evaluateSpatialScalar(
  value: SpatialScalar | undefined,
  state: Record<string, number>,
): number {
  if (typeof value === "number") return value;
  return value ? evaluateVisualExpression(value, state) : Number.NaN;
}

function evaluateSpatialVector(
  value: SpatialVector3,
  state: Record<string, number>,
): [number, number, number] {
  return value.map((component) => evaluateSpatialScalar(component, state)) as [
    number,
    number,
    number,
  ];
}

function spatialVectorDiagnostics(
  value: SpatialVector3,
  state: Record<string, number>,
  pathLabel: string,
): { value: [number, number, number]; errors: string[] } {
  const evaluated = evaluateSpatialVector(value, state);
  const errors = evaluated.every(
    (component) =>
      Number.isFinite(component) &&
      Math.abs(component) <= MAX_SPATIAL_MAGNITUDE,
  )
    ? []
    : [`${pathLabel} is non-finite or outside +/-${MAX_SPATIAL_MAGNITUDE}`];
  return { value: evaluated, errors };
}

function spatialPositiveScalarDiagnostics(
  value: SpatialScalar | undefined,
  state: Record<string, number>,
  pathLabel: string,
  max: number = MAX_SPATIAL_MAGNITUDE,
): { value: number; errors: string[] } {
  const evaluated = evaluateSpatialScalar(value, state);
  return {
    value: evaluated,
    errors:
      Number.isFinite(evaluated) && evaluated > 0 && evaluated <= max
        ? []
        : [
            `${pathLabel} must evaluate to a finite positive value no greater than ${max}`,
          ],
  };
}

function spatialPrimitiveGeometryDiagnostics(
  primitive: SpatialPrimitive,
  state: Record<string, number>,
  pathLabel: string,
): string[] {
  const errors: string[] = [];
  if (primitive.kind === "plane") {
    const center = spatialVectorDiagnostics(
      primitive.center,
      state,
      `${pathLabel}.center`,
    );
    const normal = spatialVectorDiagnostics(
      primitive.normal,
      state,
      `${pathLabel}.normal`,
    );
    const size = spatialPositiveScalarDiagnostics(
      primitive.size,
      state,
      `${pathLabel}.size`,
    );
    errors.push(...center.errors, ...normal.errors, ...size.errors);
    if (normal.errors.length === 0 && Math.hypot(...normal.value) <= 1e-9) {
      errors.push(`${pathLabel}.normal evaluates to a zero-length vector`);
    }
  } else if (primitive.kind === "polygon") {
    const points = primitive.points.map((point, pointIndex) =>
      spatialVectorDiagnostics(
        point,
        state,
        `${pathLabel}.points[${pointIndex}]`,
      ),
    );
    errors.push(...points.flatMap((point) => point.errors));
    if (points.every((point) => point.errors.length === 0)) {
      errors.push(
        ...spatialPolygonShapeDiagnostics(
          points.map((point) => point.value),
          pathLabel,
        ),
      );
    }
  } else if (primitive.kind === "sphere") {
    const center = spatialVectorDiagnostics(
      primitive.center,
      state,
      `${pathLabel}.center`,
    );
    const radius = spatialPositiveScalarDiagnostics(
      primitive.radius,
      state,
      `${pathLabel}.radius`,
    );
    errors.push(...center.errors, ...radius.errors);
  } else if (primitive.kind === "cylinder") {
    const center = spatialVectorDiagnostics(
      primitive.center,
      state,
      `${pathLabel}.center`,
    );
    const axis = spatialVectorDiagnostics(
      primitive.axis,
      state,
      `${pathLabel}.axis`,
    );
    const radius = spatialPositiveScalarDiagnostics(
      primitive.radius,
      state,
      `${pathLabel}.radius`,
    );
    const height = spatialPositiveScalarDiagnostics(
      primitive.height,
      state,
      `${pathLabel}.height`,
    );
    errors.push(
      ...center.errors,
      ...axis.errors,
      ...radius.errors,
      ...height.errors,
    );
    if (axis.errors.length === 0 && Math.hypot(...axis.value) <= 1e-9) {
      errors.push(`${pathLabel}.axis evaluates to a zero-length vector`);
    }
  } else if (primitive.kind === "cone") {
    const apex = spatialVectorDiagnostics(
      primitive.apex,
      state,
      `${pathLabel}.apex`,
    );
    const axis = spatialVectorDiagnostics(
      primitive.axis,
      state,
      `${pathLabel}.axis`,
    );
    const radius = spatialPositiveScalarDiagnostics(
      primitive.radius,
      state,
      `${pathLabel}.radius`,
    );
    const height = spatialPositiveScalarDiagnostics(
      primitive.height,
      state,
      `${pathLabel}.height`,
    );
    errors.push(
      ...apex.errors,
      ...axis.errors,
      ...radius.errors,
      ...height.errors,
    );
    if (axis.errors.length === 0 && Math.hypot(...axis.value) <= 1e-9) {
      errors.push(`${pathLabel}.axis evaluates to a zero-length vector`);
    }
  } else if (primitive.kind === "point") {
    const position = spatialVectorDiagnostics(
      primitive.position,
      state,
      `${pathLabel}.position`,
    );
    errors.push(...position.errors);
    if (primitive.size !== undefined) {
      errors.push(
        ...spatialPositiveScalarDiagnostics(
          primitive.size,
          state,
          `${pathLabel}.size`,
          40,
        ).errors,
      );
    }
  } else {
    const from = spatialVectorDiagnostics(
      primitive.from,
      state,
      `${pathLabel}.from`,
    );
    const to = spatialVectorDiagnostics(primitive.to, state, `${pathLabel}.to`);
    errors.push(...from.errors, ...to.errors);
    if (primitive.headSize !== undefined) {
      errors.push(
        ...spatialPositiveScalarDiagnostics(
          primitive.headSize,
          state,
          `${pathLabel}.headSize`,
          40,
        ).errors,
      );
    }
    if (
      from.errors.length === 0 &&
      to.errors.length === 0 &&
      Math.hypot(
        ...from.value.map((component, index) => to.value[index] - component),
      ) <= 1e-9
    ) {
      errors.push(`${pathLabel} evaluates to a zero-length vector`);
    }
  }
  return errors;
}

function spatialSceneGeometryDiagnostics(
  scene: SpatialScene,
  definition: GeneratedVisualizationDefinition,
  defaults: Record<string, number>,
): string[] {
  const states: Array<Record<string, number>> = [
    { ...defaults, t: 0 },
    { ...defaults, t: 0.371 },
    { ...defaults, t: 1 },
  ];
  for (const control of definition.controls) {
    for (const alternate of alternateControlStates(
      control,
      defaults[control.id] ?? 0,
    )) {
      states.push({ ...defaults, [control.id]: alternate });
      if (states.length >= 48) break;
    }
    if (states.length >= 48) break;
  }
  const errors: string[] = [];
  states.forEach((state, stateIndex) => {
    let visiblePrimitiveCount = 0;
    scene.groups.forEach((group, groupIndex) => {
      const groupVisibility =
        group.visibleWhen === undefined
          ? 1
          : evaluateVisualExpression(group.visibleWhen, state);
      if (!Number.isFinite(groupVisibility)) {
        errors.push(
          `state ${stateIndex} groups[${groupIndex}].visibleWhen is non-finite`,
        );
        return;
      }
      if (groupVisibility <= 0) return;
      group.primitives.forEach((primitive, primitiveIndex) => {
        const primitiveVisibility =
          primitive.visibleWhen === undefined
            ? 1
            : evaluateVisualExpression(primitive.visibleWhen, state);
        if (!Number.isFinite(primitiveVisibility)) {
          errors.push(
            `state ${stateIndex} groups[${groupIndex}].primitives[${primitiveIndex}].visibleWhen is non-finite`,
          );
          return;
        }
        if (primitiveVisibility <= 0) return;
        visiblePrimitiveCount += 1;
        errors.push(
          ...spatialPrimitiveGeometryDiagnostics(
            primitive,
            state,
            `state ${stateIndex} groups[${groupIndex}].primitives[${primitiveIndex}]`,
          ),
        );
      });
    });
    if (visiblePrimitiveCount === 0)
      errors.push(`state ${stateIndex} has no visible spatial primitives`);
  });
  return [...new Set(errors)];
}

function numericExpressionSamples(
  definition: GeneratedVisualizationDefinition,
  state: Record<string, number>,
): number[] {
  const values: number[] = [];
  const commonStates = [
    { ...state, x: 0, t: 0 },
    { ...state, x: 0.371, t: 0.371 },
    { ...state, x: 1, t: 1 },
  ];
  for (const output of definition.outputs) {
    if (!output.expression) continue;
    for (const sampleState of commonStates) {
      values.push(evaluateVisualExpression(output.expression, sampleState));
    }
  }
  for (const scene of definition.scenes) {
    const record = scene as unknown as Record<string, unknown>;
    const expressions = expressionFieldsFromScene(record).map(
      ([, expression]) => expression as VisualExpression,
    );
    if (scene.kind === "timeline") {
      expressions.push({ kind: "input", id: scene.progressInput });
    }
    const sceneStates =
      scene.kind === "plot"
        ? [
            { ...state, x: scene.xMin, t: 0 },
            { ...state, x: (scene.xMin + scene.xMax) / 2, t: 0.5 },
            { ...state, x: scene.xMax, t: 1 },
          ]
        : commonStates;
    for (const expression of expressions) {
      for (const sampleState of sceneStates) {
        values.push(evaluateVisualExpression(expression, sampleState));
      }
    }
  }
  return values;
}

function outputValues(
  definition: GeneratedVisualizationDefinition,
  state: Record<string, number>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const output of definition.outputs) {
    if (output.expression)
      values[output.id] = evaluateVisualExpression(output.expression, state);
  }
  return values;
}

type ProtocolOutcomeExpression = {
  path: string;
  expression: VisualExpression;
};

function visualExpressionReferencesInput(
  expression: VisualExpression,
  inputId: string,
): boolean {
  if (expression.kind === "input") return expression.id === inputId;
  if (expression.kind === "constant") return false;
  if (expression.kind === "binary") {
    return (
      visualExpressionReferencesInput(expression.left, inputId) ||
      visualExpressionReferencesInput(expression.right, inputId)
    );
  }
  if (expression.kind === "unary") {
    return visualExpressionReferencesInput(expression.argument, inputId);
  }
  if (expression.kind === "clamp") {
    return (
      visualExpressionReferencesInput(expression.value, inputId) ||
      visualExpressionReferencesInput(expression.min, inputId) ||
      visualExpressionReferencesInput(expression.max, inputId)
    );
  }
  return (
    visualExpressionReferencesInput(expression.left, inputId) ||
    visualExpressionReferencesInput(expression.right, inputId) ||
    visualExpressionReferencesInput(expression.whenTrue, inputId) ||
    visualExpressionReferencesInput(expression.whenFalse, inputId)
  );
}

function generatedVisualDefinitionReferencesInput(
  definition: GeneratedVisualizationDefinition,
  inputId: string,
): boolean {
  if (
    definition.outputs.some(
      (output) =>
        output.expression &&
        visualExpressionReferencesInput(output.expression, inputId),
    )
  ) {
    return true;
  }
  return definition.scenes.some((scene) => {
    if (scene.kind === "timeline" && scene.progressInput === inputId) {
      return true;
    }
    return expressionFieldsFromScene(
      scene as unknown as Record<string, unknown>,
    ).some(
      ([, expression]) =>
        isRecord(expression) &&
        visualExpressionReferencesInput(
          expression as unknown as VisualExpression,
          inputId,
        ),
    );
  });
}

function numericSamplesDiffer(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.some(
    (value, index) =>
      Number.isFinite(value) &&
      Number.isFinite(right[index]) &&
      Math.abs(right[index] - value) > 1e-9,
  );
}

const TIME_DRIVEN_PROCESS_ACTION_RE =
  /\b(?:iterat(?:e|es|ed|ing|ion|ive)|relax(?:ation|ing)?|converg(?:e|es|ed|ing|ence)|settle(?:s|d|ment)?|time[ -]?step(?:s)?|successive(?:ly)?|evolv(?:e|es|ed|ing))\b/i;

function requiresTimeDrivenProcess(
  opportunity: Pick<VisualizationOpportunity, "interactionGoal" | "learnerAction">,
): boolean {
  return (
    opportunity.interactionGoal === "simulate_system" &&
    TIME_DRIVEN_PROCESS_ACTION_RE.test(opportunity.learnerAction ?? "")
  );
}

function timeDrivenProcessDiagnostics(
  definition: GeneratedVisualizationDefinition,
  opportunity: Pick<VisualizationOpportunity, "interactionGoal" | "learnerAction">,
): { passed: boolean; detail: string } | undefined {
  if (!requiresTimeDrivenProcess(opportunity)) return undefined;
  if (!definition.animation) {
    return {
      passed: false,
      detail:
        "the reviewed iterative/converging simulate_system action cannot be a static definition: add animation and a t-dependent numeric output or scene expression",
    };
  }
  const expressions = [
    ...definition.outputs.flatMap((output) =>
      output.expression ? [output.expression] : [],
    ),
    ...definition.scenes.flatMap((scene) =>
      expressionFieldsFromScene(scene as unknown as Record<string, unknown>).map(
        ([, expression]) => expression as VisualExpression,
      ),
    ),
  ];
  const timeExpressions = expressions.filter((expression) =>
    visualExpressionReferencesInput(expression, "t"),
  );
  if (timeExpressions.length === 0) {
    return {
      passed: false,
      detail:
        "the reviewed iterative/converging simulate_system action cannot be a static definition: no numeric output or scene expression references the reserved runtime t clock",
    };
  }
  const defaults = numericDefaults(definition);
  const initial = { ...defaults, x: 0, t: 0 };
  const settled = { ...defaults, x: 0, t: 1 };
  const changesAcrossClock = timeExpressions.some((expression) => {
    const initialValue = evaluateVisualExpression(expression, initial);
    const settledValue = evaluateVisualExpression(expression, settled);
    return (
      Number.isFinite(initialValue) &&
      Number.isFinite(settledValue) &&
      Math.abs(initialValue - settledValue) > 1e-9
    );
  });
  return changesAcrossClock
    ? { passed: true, detail: "" }
    : {
        passed: false,
        detail:
          "the reviewed iterative/converging simulate_system action cannot be a static definition: t-dependent expressions do not change from the initial to settled clock state",
      };
}

const STATE_DEPENDENT_DIAGRAM_BRANCH_ACTION_RE =
  /\b(?:highlight(?:ed|ing|s)?|emphasi[sz](?:e|ed|es|ing)?|distinguish(?:ed|es|ing)?|selected|active)\b/i;
const DIAGRAM_BRANCH_RE = /\b(?:diagram|node[ -]?link graph)\b/i;
const GRAPH_STRUCTURE_RE =
  /\b(?:branch|node[ -]?link|dependency|causal|flow)\b/i;

function requiresStateDependentDiagramBranch(
  opportunity: Pick<VisualizationOpportunity, "learnerAction">,
): boolean {
  const action = opportunity.learnerAction ?? "";
  return (
    STATE_DEPENDENT_DIAGRAM_BRANCH_ACTION_RE.test(action) &&
    DIAGRAM_BRANCH_RE.test(action) &&
    GRAPH_STRUCTURE_RE.test(action)
  );
}

function renderedDiagramEdgeStrength(
  expression: VisualExpression | undefined,
  state: Record<string, number>,
): number {
  const raw = expression ? evaluateVisualExpression(expression, state) : 1.5;
  return Number.isFinite(raw)
    ? Math.max(0.5, Math.min(6, Math.abs(raw)))
    : Number.NaN;
}

const EXPLICIT_COMBINED_BRANCH_OPTION_RE =
  /\b(?:combined|both|all|sum|total|together|net)\b|\+/i;
const CONJOINED_BRANCH_OPTION_RE = /\b(?:and|plus)\b|&/i;
const MIN_RENDERED_DIAGRAM_EDGE_HIGHLIGHT_CONTRAST = 1;

function normalizedBranchOptionTokens(label: string): Set<string> {
  return new Set(
    label
      .normalize("NFKD")
      .toLocaleLowerCase("en")
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
}

function isCombinedBranchOption(
  label: string,
  optionIndex: number,
  optionLabels: readonly string[],
): boolean {
  if (EXPLICIT_COMBINED_BRANCH_OPTION_RE.test(label)) return true;
  if (!CONJOINED_BRANCH_OPTION_RE.test(label)) return false;
  const combinedTokens = normalizedBranchOptionTokens(label);
  const peerTokens = optionLabels.flatMap((peerLabel, peerIndex) =>
    peerIndex === optionIndex
      ? []
      : [{ peerIndex, tokens: normalizedBranchOptionTokens(peerLabel) }],
  );
  const matchedPeerCount = peerTokens.filter(({ peerIndex, tokens }) =>
    [...tokens].some(
      (token) =>
        combinedTokens.has(token) &&
        !peerTokens.some(
          (other) =>
            other.peerIndex !== peerIndex && other.tokens.has(token),
        ),
    ),
  ).length;
  return matchedPeerCount >= 2;
}

function renderedDiagramStrengthsDiffer(left: number, right: number): boolean {
  return (
    Math.abs(left - right) + 1e-9 >=
    MIN_RENDERED_DIAGRAM_EDGE_HIGHLIGHT_CONTRAST
  );
}

function varyingDiagramBranchEdgeIndices(signatures: number[][]): number[] {
  const edgeCount = signatures[0]?.length ?? 0;
  return Array.from({ length: edgeCount }, (_, edgeIndex) => edgeIndex).filter(
    (edgeIndex) => {
      const values = signatures.map((signature) => signature[edgeIndex]);
      return renderedDiagramStrengthsDiffer(
        Math.max(...values),
        Math.min(...values),
      );
    },
  );
}

function diagramBranchEdgesShareConnectedComponent(
  edges: unknown[],
  relevantEdgeIndices: readonly number[],
): boolean {
  if (relevantEdgeIndices.length < 2) return false;
  const adjacency = new Map<string, Set<string>>();
  const connect = (from: string, to: string) => {
    const neighbors = adjacency.get(from) ?? new Set<string>();
    neighbors.add(to);
    adjacency.set(from, neighbors);
  };
  for (const edge of edges) {
    if (
      !isRecord(edge) ||
      typeof edge.from !== "string" ||
      typeof edge.to !== "string"
    ) {
      return false;
    }
    connect(edge.from, edge.to);
    connect(edge.to, edge.from);
  }
  const relevantNodes = new Set<string>();
  for (const edgeIndex of relevantEdgeIndices) {
    const edge = edges[edgeIndex];
    if (
      !isRecord(edge) ||
      typeof edge.from !== "string" ||
      typeof edge.to !== "string"
    ) {
      return false;
    }
    relevantNodes.add(edge.from);
    relevantNodes.add(edge.to);
  }
  const firstNode = relevantNodes.values().next().value;
  if (typeof firstNode !== "string") return false;
  const visited = new Set([firstNode]);
  const pending = [firstNode];
  while (pending.length > 0) {
    const node = pending.shift()!;
    for (const neighbor of adjacency.get(node) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }
  return [...relevantNodes].every((node) => visited.has(node));
}

function diagramStrengthProfilesTeachSelectedBranches(input: {
  signatures: number[][];
  optionLabels: readonly string[];
}): boolean {
  const { signatures, optionLabels } = input;
  if (signatures.length < 2 || signatures.length !== optionLabels.length)
    return false;
  if (
    signatures.some((signature) =>
      signature.some((value) => !Number.isFinite(value)),
    )
  ) {
    return false;
  }
  for (let left = 0; left < signatures.length; left += 1) {
    for (let right = left + 1; right < signatures.length; right += 1) {
      if (
        !signatures[left].some(
          (value, edgeIndex) =>
            renderedDiagramStrengthsDiffer(
              value,
              signatures[right][edgeIndex],
            ),
        )
      ) {
        return false;
      }
    }
  }
  const edgeCount = signatures[0]?.length ?? 0;
  const edgeMinimums = Array.from({ length: edgeCount }, (_, edgeIndex) =>
    Math.min(...signatures.map((signature) => signature[edgeIndex])),
  );
  const varyingEdges = varyingDiagramBranchEdgeIndices(signatures);
  if (varyingEdges.length < 2) return false;
  const emphasizedByOption = signatures.map(
    (signature) =>
      new Set(
        varyingEdges.filter(
          (edgeIndex) =>
            renderedDiagramStrengthsDiffer(
              signature[edgeIndex],
              edgeMinimums[edgeIndex],
            ),
        ),
      ),
  );
  const combinedOptionIndices = optionLabels.flatMap((label, optionIndex) =>
    isCombinedBranchOption(label, optionIndex, optionLabels)
      ? [optionIndex]
      : [],
  );
  const combinedOptionSet = new Set(combinedOptionIndices);
  const singleOptionIndices = optionLabels.flatMap((_, optionIndex) =>
    combinedOptionSet.has(optionIndex) ? [] : [optionIndex],
  );
  if (singleOptionIndices.length < 2) return false;
  for (const optionIndex of singleOptionIndices) {
    const selected = emphasizedByOption[optionIndex];
    if (selected.size === 0) return false;
    const otherSingleEdges = new Set(
      singleOptionIndices
        .filter((candidate) => candidate !== optionIndex)
        .flatMap((candidate) => [...emphasizedByOption[candidate]]),
    );
    if (![...selected].some((edgeIndex) => !otherSingleEdges.has(edgeIndex)))
      return false;
  }
  if (combinedOptionIndices.length === 0) return true;
  const singleBranchUnion = new Set(
    singleOptionIndices.flatMap((optionIndex) => [
      ...emphasizedByOption[optionIndex],
    ]),
  );
  if (singleBranchUnion.size < 2) return false;
  return combinedOptionIndices.every((optionIndex) => {
    const selected = emphasizedByOption[optionIndex];
    return (
      selected.size === singleBranchUnion.size &&
      selected.size >= 2 &&
      [...singleBranchUnion].every((edgeIndex) => selected.has(edgeIndex))
    );
  });
}

const MAX_DIAGRAM_BRANCH_CONTROL_CONTEXTS = 16;

function diagramBranchContextStates(
  definition: GeneratedVisualizationDefinition,
  defaults: Record<string, number>,
  branchControlId: string,
): Array<Record<string, number>> {
  const otherControls = definition.controls.flatMap((control) => {
    if (control.id === branchControlId) return [];
    const defaultValue = defaults[control.id] ?? 0;
    const availableAlternates = alternateControlStates(control, defaultValue);
    const alternates =
      availableAlternates.length <= 3
        ? availableAlternates
        : [
            availableAlternates[0],
            availableAlternates[Math.floor(availableAlternates.length / 2)],
            availableAlternates[availableAlternates.length - 1],
          ];
    return alternates.length > 0
      ? [{ controlId: control.id, defaultValue, alternates }]
      : [];
  });
  const controlStates: Array<Record<string, number>> = [];
  const seen = new Set<string>();
  const addControlState = (updates: Record<string, number>) => {
    if (controlStates.length >= MAX_DIAGRAM_BRANCH_CONTROL_CONTEXTS) return;
    const state = { ...defaults, ...updates };
    const key = JSON.stringify(
      otherControls.map(({ controlId }) => state[controlId]),
    );
    if (seen.has(key)) return;
    seen.add(key);
    controlStates.push(state);
  };
  addControlState({});
  addControlState(
    Object.fromEntries(
      otherControls.map(({ controlId, alternates }) => [
        controlId,
        alternates[0],
      ]),
    ),
  );
  for (let left = 0; left < otherControls.length; left += 1) {
    for (let right = left + 1; right < otherControls.length; right += 1) {
      addControlState({
        [otherControls[left].controlId]: otherControls[left].alternates[0],
        [otherControls[right].controlId]: otherControls[right].alternates[0],
      });
    }
  }
  for (const { controlId, alternates } of otherControls) {
    for (const alternate of alternates) {
      addControlState({ [controlId]: alternate });
    }
  }
  const visitCrossProduct = (
    controlIndex: number,
    updates: Record<string, number>,
  ) => {
    if (controlStates.length >= MAX_DIAGRAM_BRANCH_CONTROL_CONTEXTS) return;
    if (controlIndex >= otherControls.length) {
      addControlState(updates);
      return;
    }
    const { controlId, defaultValue, alternates } =
      otherControls[controlIndex];
    for (const value of [defaultValue, ...alternates]) {
      visitCrossProduct(controlIndex + 1, {
        ...updates,
        [controlId]: value,
      });
      if (controlStates.length >= MAX_DIAGRAM_BRANCH_CONTROL_CONTEXTS) return;
    }
  };
  visitCrossProduct(0, {});
  return controlStates.flatMap((state) =>
    [0, 0.371, 1].map((progress) => ({
      ...state,
      x: progress,
      t: progress,
    })),
  );
}

function diagramBranchSelectionDiagnostics(
  definition: GeneratedVisualizationDefinition,
  opportunity: VisualizationOpportunity,
  defaults: Record<string, number>,
): Array<{ name: string; passed: boolean; detail: string }> {
  if (!requiresStateDependentDiagramBranch(opportunity)) return [];
  const reviewedSelects = opportunity.requiredInputs.filter(
    (control) => control.type === "select" && control.kind === "select_case",
  );
  return reviewedSelects.map((requiredControl) => {
    const control = definition.controls.find(
      (candidate) => candidate.id === requiredControl.id,
    );
    const optionCount = control?.options?.length ?? 0;
    const optionLabels = control?.options ?? [];
    const diagramScenes = definition.scenes.flatMap((scene, sceneIndex) =>
      isRecord(scene) && scene.kind === "diagram"
        ? [{ scene, sceneIndex }]
        : [],
    );
    const contexts = diagramBranchContextStates(
      definition,
      defaults,
      requiredControl.id,
    );
    const qualifyingDiagram = diagramScenes.findIndex(({ scene }) => {
      if (
        diagramScenes.length !== 1 ||
        !Array.isArray(scene.nodes) ||
        !Array.isArray(scene.edges) ||
        scene.edges.length < 2
      ) {
        return false;
      }
      const nodeIds = new Set(
        scene.nodes.flatMap((node) =>
          isRecord(node) && typeof node.id === "string" ? [node.id] : [],
        ),
      );
      const endpointPairs = new Set<string>();
      if (
        !scene.edges.every((edge) => {
          if (
            !isRecord(edge) ||
            typeof edge.from !== "string" ||
            typeof edge.to !== "string" ||
            edge.from === edge.to ||
            !nodeIds.has(edge.from) ||
            !nodeIds.has(edge.to)
          ) {
            return false;
          }
          const endpointPair = [edge.from, edge.to].sort().join("\u0000");
          if (endpointPairs.has(endpointPair)) return false;
          endpointPairs.add(endpointPair);
          return true;
        })
      ) {
        return false;
      }
      return contexts.every((context) => {
        const signatures = Array.from(
          { length: optionCount },
          (_, optionIndex) =>
            scene.edges.map((edge) =>
              renderedDiagramEdgeStrength(
                isRecord(edge)
                  ? (edge.strength as VisualExpression | undefined)
                  : undefined,
                {
                  ...context,
                  [requiredControl.id]: optionIndex,
                },
              ),
            ),
        );
        return (
          diagramStrengthProfilesTeachSelectedBranches({
            signatures,
            optionLabels,
          }) &&
          diagramBranchEdgesShareConnectedComponent(
            scene.edges,
            varyingDiagramBranchEdgeIndices(signatures),
          )
        );
      });
    });
    const passed = Boolean(control) && optionCount >= 2 && qualifyingDiagram >= 0;
    return {
      name: `${requiredControl.id} gives every selected diagram branch a distinct edge.strength signature`,
      passed,
      detail: passed
        ? JSON.stringify({
            controlId: requiredControl.id,
            optionCount,
            diagramSceneIndex: diagramScenes[qualifyingDiagram]?.sceneIndex,
            contextCount: contexts.length,
            topology: "persistent",
          })
        : `reviewed learnerAction requires persistent selected-branch highlighting for exact control ${requiredControl.id}: author exactly one persistent diagram, keep every relevant selectable edge in one connected dependency graph, retain every uniquely connected node and edge with no self-loop or duplicate/reverse endpoint pair, include at least two varying branch edges, and author conditional diagram edge.strength expressions so every single option has an exclusive emphasized branch, every combined/both/all/sum/total/and/&/+ option emphasizes exactly their union, and all ${optionCount || requiredControl.options?.length || 0} option indices produce pairwise-distinct rendered 0.5-6 edge-width signatures with at least ${MIN_RENDERED_DIAGRAM_EDGE_HIGHLIGHT_CONTRAST} unit contrast across animation and the bounded cross-product of other-control states`,
    };
  });
}

function protocolOutcomeExpressions(
  definition: GeneratedVisualizationDefinition,
  opportunity: VisualizationOpportunity,
  commitId: string,
  revealId: string,
): ProtocolOutcomeExpression[] {
  const requiredOutputIds = new Set(
    opportunity.requiredOutputs.map((output) => output.id),
  );
  const requiredOutputs = definition.outputs.flatMap((output, outputIndex) =>
    requiredOutputIds.has(output.id) && output.expression
      ? [
          {
            path: `outputs[${outputIndex}].expression`,
            expression: output.expression,
          },
        ]
      : [],
  );
  if (requiredOutputs.length > 0) return requiredOutputs;

  const sceneExpressions = definition.scenes.flatMap((scene, sceneIndex) => {
    const expressions = expressionFieldsFromScene(
      scene as unknown as Record<string, unknown>,
    ).map(([path, expression]) => ({
      path: `scenes[${sceneIndex}].${path}`,
      expression: expression as VisualExpression,
    }));
    if (scene.kind === "timeline") {
      expressions.push({
        path: `scenes[${sceneIndex}].progressInput`,
        expression: { kind: "input", id: scene.progressInput },
      });
    }
    return expressions;
  });
  const referencesProtocol = ({ expression }: ProtocolOutcomeExpression) =>
    visualExpressionReferencesInput(expression, commitId) ||
    visualExpressionReferencesInput(expression, revealId);
  const visibilityExpressions = sceneExpressions.filter(
    (candidate) =>
      candidate.path.endsWith("visibleWhen") && referencesProtocol(candidate),
  );
  return visibilityExpressions.length > 0
    ? visibilityExpressions
    : sceneExpressions.filter(referencesProtocol);
}

function protocolExpressionValues(
  expressions: ProtocolOutcomeExpression[],
  state: Record<string, number>,
): number[] {
  return expressions.map(({ expression }) =>
    evaluateVisualExpression(expression, state),
  );
}

function protocolValuesDiffer(left: number[], right: number[]): boolean {
  return left.some(
    (value, index) =>
      Number.isFinite(value) &&
      Number.isFinite(right[index]) &&
      Math.abs(value - right[index]) > 1e-9,
  );
}

function predictionProtocolDiagnostics(
  definition: GeneratedVisualizationDefinition,
  opportunity: VisualizationOpportunity,
  defaults: Record<string, number>,
): { passed: boolean; detail: string } | undefined {
  if (opportunity.interactionGoal !== "test_prediction") return undefined;
  const prediction = definition.controls.find(
    (control) => control.protocolRole === "prediction_input",
  );
  const commit = definition.controls.find(
    (control) => control.protocolRole === "commit_prediction",
  );
  const reveal = definition.controls.find(
    (control) =>
      control.protocolRole === "reveal_outcome" ||
      control.protocolRole === "evaluate_prediction",
  );
  if (!prediction || !commit || !reveal) {
    return {
      passed: false,
      detail:
        "the exact generated definition is missing prediction_input, commit_prediction, or reveal/evaluate protocol roles",
    };
  }
  const outcomeExpressions = protocolOutcomeExpressions(
    definition,
    opportunity,
    commit.id,
    reveal.id,
  );
  if (outcomeExpressions.length === 0) {
    return {
      passed: false,
      detail:
        "no required outcome expression or observable scene/visibility expression depends on the authored commit and reveal/evaluate controls",
    };
  }
  const predictionValues = [
    ...alternateControlStates(prediction, defaults[prediction.id] ?? 0),
  ];
  let outcomeChangedAfterValidReveal = false;
  let changedDuringPrediction = false;
  let changedAtCommitOnly = false;
  let revealedBeforeCommit = false;
  let nonFiniteState = false;
  for (const predictionValue of predictionValues) {
    const baselineState = {
      ...defaults,
      [commit.id]: 0,
      [reveal.id]: 0,
    };
    const predictionState = {
      ...baselineState,
      [prediction.id]: predictionValue,
    };
    const unauthorizedRevealState = { ...predictionState, [reveal.id]: 1 };
    const commitOnlyState = { ...predictionState, [commit.id]: 1 };
    const validRevealState = { ...commitOnlyState, [reveal.id]: 1 };
    const baselineValues = protocolExpressionValues(
      outcomeExpressions,
      baselineState,
    );
    const predictionOnlyValues = protocolExpressionValues(
      outcomeExpressions,
      predictionState,
    );
    const unauthorizedValues = protocolExpressionValues(
      outcomeExpressions,
      unauthorizedRevealState,
    );
    const commitOnlyValues = protocolExpressionValues(
      outcomeExpressions,
      commitOnlyState,
    );
    const validRevealValues = protocolExpressionValues(
      outcomeExpressions,
      validRevealState,
    );
    nonFiniteState ||= [
      ...baselineValues,
      ...predictionOnlyValues,
      ...unauthorizedValues,
      ...commitOnlyValues,
      ...validRevealValues,
    ].some((value) => !Number.isFinite(value));
    changedDuringPrediction ||= protocolValuesDiffer(
      baselineValues,
      predictionOnlyValues,
    );
    revealedBeforeCommit ||= protocolValuesDiffer(
      predictionOnlyValues,
      unauthorizedValues,
    );
    changedAtCommitOnly ||= protocolValuesDiffer(
      predictionOnlyValues,
      commitOnlyValues,
    );
    outcomeChangedAfterValidReveal ||= protocolValuesDiffer(
      commitOnlyValues,
      validRevealValues,
    );
  }
  return {
    passed:
      !nonFiniteState &&
      !changedDuringPrediction &&
      !revealedBeforeCommit &&
      !changedAtCommitOnly &&
      outcomeChangedAfterValidReveal,
    detail: JSON.stringify({
      outcomeExpressionPaths: outcomeExpressions.map(({ path }) => path),
      changedDuringPrediction,
      revealedBeforeCommit,
      changedAtCommitOnly,
      outcomeChangedAfterValidReveal,
      nonFiniteState,
    }),
  };
}

function protocolAwareInfluenceState(
  definition: GeneratedVisualizationDefinition,
  control: GeneratedVisualControl,
  defaults: Record<string, number>,
): Record<string, number> {
  const state = { ...defaults };
  const activate = (role: GeneratedVisualControl["protocolRole"]) => {
    for (const candidate of definition.controls) {
      if (candidate.protocolRole === role) state[candidate.id] = 1;
    }
  };
  if (control.protocolRole === "prediction_input") {
    activate("commit_prediction");
    activate("reveal_outcome");
    activate("evaluate_prediction");
  } else if (control.protocolRole === "commit_prediction") {
    activate("reveal_outcome");
    activate("evaluate_prediction");
  } else if (
    control.protocolRole === "reveal_outcome" ||
    control.protocolRole === "evaluate_prediction"
  ) {
    activate("commit_prediction");
  }
  return state;
}

export function runGeneratedVisualDeterministicTests(input: {
  definition: GeneratedVisualizationDefinition;
  testCases: GeneratedVisualizationTestCase[];
  opportunity: VisualizationOpportunity;
  availableSourceAnchorIds?: Set<string>;
}): GeneratedVisualTestsRecord {
  const staticTests: GeneratedVisualTestsRecord["staticTests"] = [];
  const semanticTests: GeneratedVisualTestsRecord["semanticTests"] = [];
  const runtimeTests: GeneratedVisualTestsRecord["runtimeTests"] = [];
  const defaults = numericDefaults(input.definition);
  const values = outputValues(input.definition, defaults);
  staticTests.push({
    name: "all controls have accessible labels",
    passed: input.definition.controls.every(
      (control) => control.label.trim().length > 0,
    ),
  });
  staticTests.push({
    name: "required source anchors exist",
    passed:
      !input.availableSourceAnchorIds ||
      input.opportunity.sourceAnchorIds.every((id) =>
        input.availableSourceAnchorIds!.has(id),
      ),
  });
  runtimeTests.push({
    name: "default outputs are finite",
    passed: Object.values(values).every(Number.isFinite),
    detail: JSON.stringify(values),
  });

  const controlsById = new Map(
    input.definition.controls.map((control) => [control.id, control]),
  );
  for (const requiredInput of input.opportunity.requiredInputs) {
    const control = controlsById.get(requiredInput.id);
    if (!control) {
      semanticTests.push({
        name: `${requiredInput.label} is implemented by the generated module`,
        passed: false,
        detail: `missing required control ${requiredInput.id}`,
      });
      continue;
    }
    if (control.protocolRole === "reset") {
      const defaultSamples = numericExpressionSamples(
        input.definition,
        defaults,
      );
      let restorationWitness:
        | {
            changedControlId: string;
            alternateState: number;
            changedExpressionCount: number;
          }
        | undefined;
      for (const candidateInput of input.opportunity.requiredInputs) {
        if (candidateInput.id === control.id) continue;
        const candidateControl = controlsById.get(candidateInput.id);
        if (!candidateControl || candidateControl.protocolRole === "reset") {
          continue;
        }
        const candidateState = protocolAwareInfluenceState(
          input.definition,
          candidateControl,
          defaults,
        );
        for (const alternateState of alternateControlStates(
          candidateControl,
          candidateState[candidateControl.id] ?? 0,
        )) {
          const changedSamples = numericExpressionSamples(input.definition, {
            ...candidateState,
            [candidateControl.id]: alternateState,
          });
          if (!numericSamplesDiffer(defaultSamples, changedSamples)) continue;
          restorationWitness = {
            changedControlId: candidateControl.id,
            alternateState,
            changedExpressionCount: defaultSamples.filter(
              (value, index) =>
                Number.isFinite(value) &&
                Number.isFinite(changedSamples[index]) &&
                Math.abs(changedSamples[index] - value) > 1e-9,
            ).length,
          };
          break;
        }
        if (restorationWitness) break;
      }
      const authoredResetReference = generatedVisualDefinitionReferencesInput(
        input.definition,
        control.id,
      );
      semanticTests.push({
        name: `${control.label} restores a changed visual to defaults through the trusted runtime`,
        passed: Boolean(restorationWitness) && !authoredResetReference,
        detail: JSON.stringify({
          runtimeOwned: true,
          authoredResetReference,
          ...(restorationWitness ?? {
            reason:
              "no non-reset required control produces a visible numeric state for Reset to restore",
          }),
        }),
      });
      continue;
    }
    const influenceState = protocolAwareInfluenceState(
      input.definition,
      control,
      defaults,
    );
    const alternates = alternateControlStates(
      control,
      influenceState[control.id] ?? 0,
    );
    const baselineSamples = numericExpressionSamples(
      input.definition,
      influenceState,
    );
    const effectiveAlternate = alternates.find((alternate) => {
      const changedSamples = numericExpressionSamples(input.definition, {
        ...influenceState,
        [control.id]: alternate,
      });
      return numericSamplesDiffer(baselineSamples, changedSamples);
    });
    const differs = effectiveAlternate !== undefined;
    semanticTests.push({
      name: `${control.label} changes a numeric output or scene expression`,
      passed: differs,
      detail: JSON.stringify({
        defaultState: influenceState[control.id],
        alternateState: effectiveAlternate ?? alternates[0],
        testedAlternateStates: alternates,
        numericExpressionCount: baselineSamples.length,
      }),
    });
  }

  semanticTests.push(
    ...diagramBranchSelectionDiagnostics(
      input.definition,
      input.opportunity,
      defaults,
    ),
  );

  const predictionProtocol = predictionProtocolDiagnostics(
    input.definition,
    input.opportunity,
    defaults,
  );
  if (predictionProtocol) {
    semanticTests.push({
      name: "test_prediction keeps the reviewed outcome gated until valid commit then reveal/evaluate",
      ...predictionProtocol,
    });
  }

  const timeDrivenProcess = timeDrivenProcessDiagnostics(
    input.definition,
    input.opportunity,
  );
  if (timeDrivenProcess) {
    semanticTests.push({
      name: "simulate_system iterative/converging action changes across the runtime clock",
      ...timeDrivenProcess,
    });
  }

  for (const testCase of input.testCases.slice(0, 20)) {
    const state = { ...defaults };
    for (const [id, value] of Object.entries(testCase.inputs)) {
      const numericValue = numericCandidateTestInputValue(
        controlsById.get(id),
        value,
      );
      if (numericValue !== null) state[id] = numericValue;
    }
    const actual = outputValues(input.definition, state);
    const tolerance = Number.isFinite(testCase.tolerance)
      ? Math.max(0, testCase.tolerance!)
      : 1e-6;
    const mismatches: string[] = [];
    for (const [id, expected] of Object.entries(testCase.expected)) {
      if (typeof expected !== "number" || !Number.isFinite(expected)) continue;
      if (
        !Number.isFinite(actual[id]) ||
        Math.abs(actual[id] - expected) > tolerance
      ) {
        mismatches.push(
          `${id}: expected ${expected}, got ${String(actual[id])}`,
        );
      }
    }
    semanticTests.push({
      name: `candidate test: ${testCase.name}`,
      passed: mismatches.length === 0,
      detail: mismatches.join("; ") || JSON.stringify(actual),
    });
  }

  for (const scene of input.definition.scenes) {
    if (scene.kind === "plot") {
      let finite = true;
      for (let index = 0; index < scene.samples; index += 1) {
        const x =
          scene.xMin +
          ((scene.xMax - scene.xMin) * index) / Math.max(1, scene.samples - 1);
        for (const series of scene.series) {
          const value = evaluateVisualExpression(series.expression, {
            ...defaults,
            x,
          });
          if (!Number.isFinite(value)) finite = false;
        }
      }
      runtimeTests.push({
        name: `${scene.title} plot remains finite`,
        passed: finite,
      });
    } else if (scene.kind === "spatial") {
      const diagnostics = spatialSceneGeometryDiagnostics(
        scene,
        input.definition,
        defaults,
      );
      runtimeTests.push({
        name: `${scene.title} spatial geometry remains finite, visible, and non-degenerate`,
        passed: diagnostics.length === 0,
        detail: diagnostics.slice(0, 20).join("; "),
      });
    }
  }
  if (input.definition.animation) {
    runtimeTests.push({
      name: "animation clock is bounded",
      passed:
        input.definition.animation.durationMs >= 250 &&
        input.definition.animation.durationMs <= 120_000,
    });
  }
  const all = [...staticTests, ...semanticTests, ...runtimeTests];
  return {
    passed: all.every((test) => test.passed),
    checkedAt: nowIso(),
    staticTests,
    semanticTests,
    runtimeTests,
  };
}

export function resolveGeneratedVisualSandboxRuntimePath(): string {
  const cwd = process.cwd();
  const candidates: string[] = [];
  // Runtime V2 Learn jobs execute from a private attempt directory, so cwd is
  // not a reliable pointer to the development checkout. The sealed worker
  // publishes the authoritative repository root explicitly. Prefer that
  // current source runtime when present; the per-install Quartz copy can lag a
  // development rebuild and must remain a packaged-install fallback.
  const repositoryRoot = process.env.BREADBOARD_REPO_ROOT?.trim();
  if (repositoryRoot) {
    candidates.push(
      path.resolve(
        repositoryRoot,
        "quartz/quartz/components/scripts/generatedVisualSandbox.inline.js",
      ),
      path.resolve(
        repositoryRoot,
        "quartz-template/quartz/components/scripts/generatedVisualSandbox.inline.js",
      ),
    );
  }
  candidates.push(
    path.resolve(
      cwd,
      "../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js",
    ),
    path.resolve(
      cwd,
      "quartz/quartz/components/scripts/generatedVisualSandbox.inline.js",
    ),
  );
  // Desktop/packaged installs: the Quartz workspace is wherever
  // QUARTZ_CONTENT_PATH points (content lives inside the workspace).
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (contentPath) {
    candidates.push(
      path.resolve(
        path.dirname(path.resolve(contentPath)),
        "quartz/components/scripts/generatedVisualSandbox.inline.js",
      ),
    );
  }
  return (
    candidates.find((candidate) =>
      fs.existsSync(/* turbopackIgnore: true */ candidate),
    ) ?? candidates[0]
  );
}

export interface GeneratedVisualSelectPreviewState {
  id: string;
  selectState: GeneratedVisualPreviewIdentity["selectState"];
  defaultState: boolean;
  selectStateCoverageTruncated: boolean;
}

export function planGeneratedVisualSelectPreviewStates(
  definition: GeneratedVisualizationDefinition,
): GeneratedVisualSelectPreviewState[] {
  const authoredSelectControls = definition.controls.filter(
    (control) => control.type === "select" && (control.options?.length ?? 0) > 0,
  );
  // `select_case` is the primary repair target, but other reviewed control
  // kinds (for example process_position) may also be selects. Every authored
  // select must appear in an identity so a critic never mistakes a partial
  // state vector for full-state evidence.
  const controls = authoredSelectControls.map((control) => ({
    controlId: control.id,
    options: [...(control.options ?? [])],
    defaultIndex: Math.max(
      0,
      (control.options ?? []).indexOf(String(control.defaultValue)),
    ),
  }));
  const defaultState = controls.map((control) => ({
    controlId: control.controlId,
    optionIndex: Math.min(control.defaultIndex, control.options.length - 1),
    optionLabel:
      control.options[Math.min(control.defaultIndex, control.options.length - 1)],
  }));
  let reachableStateCount = 1;
  for (const control of controls) {
    reachableStateCount = Math.min(
      GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES + 1,
      reachableStateCount * control.options.length,
    );
  }
  const states: GeneratedVisualPreviewIdentity["selectState"][] = [defaultState];
  const defaultKey = JSON.stringify(
    defaultState.map(({ optionIndex }) => optionIndex),
  );
  const visit = (
    index: number,
    selected: GeneratedVisualPreviewIdentity["selectState"],
  ): void => {
    if (states.length >= GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES) return;
    if (index >= controls.length) {
      if (
        JSON.stringify(selected.map(({ optionIndex }) => optionIndex)) !==
        defaultKey
      ) {
        states.push(selected);
      }
      return;
    }
    const control = controls[index];
    control.options.forEach((optionLabel, optionIndex) => {
      if (states.length >= GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES) return;
      visit(index + 1, [
        ...selected,
        { controlId: control.controlId, optionIndex, optionLabel },
      ]);
    });
  };
  visit(0, []);
  const selectStateCoverageTruncated = reachableStateCount > states.length;
  return states.map((selectState, index) => ({
    id:
      index === 0
        ? "default"
        : selectState
            .map((entry) => `${entry.controlId}-${entry.optionIndex}`)
            .join("__"),
    selectState,
    defaultState:
      JSON.stringify(selectState.map(({ optionIndex }) => optionIndex)) ===
      defaultKey,
    selectStateCoverageTruncated,
  }));
}

function previewHtml(
  definition: GeneratedVisualizationDefinition,
  runtime: string,
  theme: "light" | "dark" = "light",
  previewState?: Pick<GeneratedVisualSelectPreviewState, "id" | "selectState">,
): string {
  const serialized = JSON.stringify(definition).replace(/</g, "\\u003c");
  const serializedPreviewState = JSON.stringify(previewState ?? {
    id: "default",
    selectState: [],
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>html,body{margin:0;padding:0;background:#f8f6ef;color:#10251c;font-family:system-ui,sans-serif}</style></head><body><div id="breadboard-generated-visual-root"></div><script>window.__BREADBOARD_VISUAL_TEST_MODE__=true;</script><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:${JSON.stringify(theme)}},"*");const previewState=${serializedPreviewState};let previewStateRetries=0;const applyPreviewState=()=>{const selects=Array.from(document.querySelectorAll("select[data-control-id]"));const missing=(previewState.selectState||[]).some((entry)=>!selects.some((node)=>node.dataset.controlId===entry.controlId));if(missing&&previewStateRetries<12){previewStateRetries+=1;window.setTimeout(applyPreviewState,25);return;}(previewState.selectState||[]).forEach((entry)=>{const input=selects.find((node)=>node.dataset.controlId===entry.controlId);if(!input||input.value===entry.optionLabel)return;input.value=entry.optionLabel;input.dispatchEvent(new Event("change",{bubbles:true}));});document.body.dataset.breadboardPreviewState=previewState.id;window.scrollTo(0,0);window.setTimeout(()=>{window.scrollTo(0,0);window.postMessage({type:"breadboard-generated-visual:preview-primary-spatial-frame"},"*")},0);};window.setTimeout(applyPreviewState,25);</script></body></html>`;
}

const GENERATED_VISUAL_BROWSER_DIAGNOSTIC_MAX_ENTRIES = 12;
const GENERATED_VISUAL_BROWSER_DIAGNOSTIC_MAX_LENGTH = 512;

function browserRuntimeDiagnostics(output: string): string[] {
  const body = output.match(/<body\b[^>]*>/i)?.[0];
  const encoded = body?.match(
    /\bdata-breadboard-runtime-diagnostics="([^"]*)"/i,
  )?.[1];
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, GENERATED_VISUAL_BROWSER_DIAGNOSTIC_MAX_ENTRIES)
      .map((entry) =>
        entry.length <= GENERATED_VISUAL_BROWSER_DIAGNOSTIC_MAX_LENGTH
          ? entry
          : `${entry.slice(0, GENERATED_VISUAL_BROWSER_DIAGNOSTIC_MAX_LENGTH - 18)}...[truncated]`,
      );
  } catch {
    return [];
  }
}

function browserRuntimeFailureDetail(output: string): string {
  const diagnostics = browserRuntimeDiagnostics(output);
  if (diagnostics.length > 0)
    return `runtime self-check failures: ${diagnostics.join("; ")}`;
  return output.match(/<body[^>]*>/i)?.[0] ?? output.slice(-500);
}

function previewPrimarySpatialFrameRequired(
  definition: GeneratedVisualizationDefinition,
  viewport: { width: number; height: number },
): boolean {
  return viewport.width <= 640 &&
    definition.scenes.some((scene) => scene.kind === "spatial");
}

function browserPreviewPrimarySpatialFramePassed(output: string): boolean {
  return /\bdata-breadboard-preview-primary-spatial-frame="passed"/i.test(
    output,
  );
}

function browserPreviewPrimarySpatialFrameFailureDetail(output: string): string {
  const diagnostics = browserRuntimeDiagnostics(output).filter((entry) =>
    /\bspatial\.preview_primary_viewport_out_of_frame\b/i.test(entry),
  );
  if (diagnostics.length > 0)
    return `runtime preview-frame failures: ${diagnostics.join("; ")}`;
  return "mobile spatial preview-frame validation did not complete";
}

/** Narrow test seam for the otherwise isolated browser process. Production
 * callers leave this unset and always use the configured Chromium/Edge binary. */
export interface GeneratedVisualBrowserInvocation {
  executable: string;
  args: string[];
  slug: string;
  profilePath: string;
  timeoutMs: number;
}

export interface GeneratedVisualBrowserRunResult {
  status?: number | null;
  signal?: string | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: { message?: string; code?: string | number } | null;
  durationMs?: number;
  timedOut?: boolean;
  completion?: GeneratedVisualBrowserCompletion;
  browserExitedNaturally?: boolean;
  cleanupMethod?: GeneratedVisualBrowserCleanupMethod;
  cleanupConfirmed?: boolean;
}

export type GeneratedVisualBrowserRunner = (
  invocation: GeneratedVisualBrowserInvocation,
) => GeneratedVisualBrowserRunResult | Promise<GeneratedVisualBrowserRunResult>;

/**
 * Chromium extends its user-data directory with several nested cache paths.
 * A generated visual's staging directory can itself be deeply nested under a
 * garden build workspace, which can exceed Windows' legacy path limit before
 * the browser reaches its first page. Keep the disposable browser state in a
 * short, separately-created OS-temp root. Each invocation still receives its
 * own child directory and the whole root is removed after this test run.
 */
interface GeneratedVisualBrowserProfileRootDependencies {
  tempRoot?: string;
  mkdtemp?: typeof fs.mkdtempSync;
}

export function createGeneratedVisualBrowserProfileRoot(
  dependencies: GeneratedVisualBrowserProfileRootDependencies = {},
): string {
  const tempRoot = path.resolve(dependencies.tempRoot ?? os.tmpdir());
  const prefix = path.join(tempRoot, "bb-vp-");
  const profileRoot = path.resolve(
    (dependencies.mkdtemp ?? fs.mkdtempSync)(prefix),
  );
  if (
    !sameGeneratedVisualBrowserPath(path.dirname(profileRoot), tempRoot) ||
    !profileRoot.startsWith(prefix)
  ) {
    // The returned path has not been authenticated. Never recursively remove
    // it: an injected/broken mkdtemp boundary could point at unrelated data.
    throw new Error("Generated visual browser profile escaped the OS temporary directory");
  }
  return profileRoot;
}

const GENERATED_VISUAL_BROWSER_PROFILE_REMOVE_TIMEOUT_MS = 3_000;
const GENERATED_VISUAL_BROWSER_PROFILE_REMOVE_RETRY_MS = 50;
const GENERATED_VISUAL_BROWSER_TRANSIENT_REMOVE_CODES = new Set([
  "EACCES",
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
]);

export interface GeneratedVisualBrowserProfileRemoveReceipt {
  confirmed: boolean;
  retries: number;
  failureCode?: string;
}

interface GeneratedVisualBrowserProfileRemoveDependencies {
  platform?: NodeJS.Platform;
  lstat?: typeof externalRuntimeLstat;
  realpath?: typeof externalRuntimeRealpath;
  remove?: typeof fs.rmSync;
  unlink?: typeof fs.unlinkSync;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

function sameGeneratedVisualBrowserPath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function generatedVisualBrowserCleanupErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code.slice(0, 96);
  }
  return "EPROFILECLEANUP";
}

/** Remove one exact disposable profile or its exact root. The target must be
 * either the root itself or one direct child; reparse points are unlinked and
 * never recursively traversed. Windows sharing violations receive one bounded
 * retry window, and absence is verified before cleanup is receipted. */
export async function removeGeneratedVisualBrowserProfile(
  profileRoot: string,
  profilePath: string,
  dependencies: GeneratedVisualBrowserProfileRemoveDependencies = {},
): Promise<GeneratedVisualBrowserProfileRemoveReceipt> {
  const resolvedRoot = path.resolve(profileRoot);
  const resolvedProfile = path.resolve(profilePath);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  const removingRoot = sameGeneratedVisualBrowserPath(resolvedRoot, resolvedProfile);
  if (
    !sameGeneratedVisualBrowserPath(path.dirname(resolvedRoot), resolvedTempRoot) ||
    !removingRoot &&
    !sameGeneratedVisualBrowserPath(path.dirname(resolvedProfile), resolvedRoot)
  ) {
    return { confirmed: false, retries: 0, failureCode: "EPROFILEAUTH" };
  }
  const readMetadata = dependencies.lstat ?? externalRuntimeLstat;
  const canonicalize = dependencies.realpath ?? externalRuntimeRealpath;
  const remove = dependencies.remove ?? fs.rmSync;
  const unlink = dependencies.unlink ?? fs.unlinkSync;
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const platform = dependencies.platform ?? process.platform;
  const deadline = now() + GENERATED_VISUAL_BROWSER_PROFILE_REMOVE_TIMEOUT_MS;
  let retries = 0;
  for (;;) {
    try {
      let metadata: ReturnType<typeof externalRuntimeLstat>;
      try {
        metadata = readMetadata(resolvedProfile);
      } catch (error) {
        if (generatedVisualBrowserCleanupErrorCode(error) === "ENOENT") {
          return { confirmed: true, retries };
        }
        throw error;
      }
      let canonicalRoot: string | undefined;
      if (!removingRoot) {
        let rootMetadata: ReturnType<typeof externalRuntimeLstat>;
        try {
          rootMetadata = readMetadata(resolvedRoot);
        } catch (error) {
          if (generatedVisualBrowserCleanupErrorCode(error) === "ENOENT") {
            return { confirmed: false, retries, failureCode: "EPROFILEAUTH" };
          }
          throw error;
        }
        if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
          return { confirmed: false, retries, failureCode: "EPROFILEREPARSE" };
        }
        canonicalRoot = canonicalize(resolvedRoot);
        const canonicalTempRoot = canonicalize(resolvedTempRoot);
        if (
          !sameGeneratedVisualBrowserPath(canonicalRoot, resolvedRoot) ||
          !sameGeneratedVisualBrowserPath(path.dirname(canonicalRoot), canonicalTempRoot)
        ) {
          return { confirmed: false, retries, failureCode: "EPROFILEREPARSE" };
        }
      }
      if (metadata.isSymbolicLink()) {
        unlink(resolvedProfile);
      } else {
        if (!metadata.isDirectory()) {
          return { confirmed: false, retries, failureCode: "EPROFILETYPE" };
        }
        const canonicalRootParent = canonicalize(path.dirname(resolvedRoot));
        const canonicalTempRoot = canonicalize(resolvedTempRoot);
        if (!sameGeneratedVisualBrowserPath(canonicalRootParent, canonicalTempRoot)) {
          return { confirmed: false, retries, failureCode: "EPROFILEAUTH" };
        }
        const canonicalProfile = canonicalize(resolvedProfile);
        const canonicalExpectedParent = removingRoot
          ? canonicalRootParent
          : canonicalRoot as string;
        if (!sameGeneratedVisualBrowserPath(
          path.dirname(canonicalProfile),
          canonicalExpectedParent,
        )) {
          return { confirmed: false, retries, failureCode: "EPROFILEREPARSE" };
        }
        remove(resolvedProfile, { recursive: true, force: true, maxRetries: 0 });
      }
      try {
        readMetadata(resolvedProfile);
        return { confirmed: false, retries, failureCode: "EPROFILEEXISTS" };
      } catch (error) {
        if (generatedVisualBrowserCleanupErrorCode(error) === "ENOENT") {
          return { confirmed: true, retries };
        }
        throw error;
      }
    } catch (error) {
      const failureCode = generatedVisualBrowserCleanupErrorCode(error);
      const retryable = platform === "win32" &&
        GENERATED_VISUAL_BROWSER_TRANSIENT_REMOVE_CODES.has(failureCode) &&
        now() < deadline;
      if (!retryable) return { confirmed: false, retries, failureCode };
      retries += 1;
      await wait(Math.min(
        GENERATED_VISUAL_BROWSER_PROFILE_REMOVE_RETRY_MS,
        Math.max(1, deadline - now()),
      ));
    }
  }
}

function generatedVisualPreviewCaptureRetryDelay(attempt: number): number {
  return GENERATED_VISUAL_PREVIEW_CAPTURE_RETRY_BASE_DELAY_MS *
    2 ** Math.max(0, attempt - 1);
}

function generatedVisualBrowserMountRetryDelay(attempt: number): number {
  return GENERATED_VISUAL_BROWSER_MOUNT_RETRY_BASE_DELAY_MS *
    2 ** Math.max(0, attempt - 1);
}

/** Browser work is synchronous. A very small bounded pause gives a transient
 * Edge teardown/write race time to settle before using a brand-new disposable
 * profile, without turning the retry into a semantic model action. */
function waitForGeneratedVisualBrowserRetry(delayMs: number): void {
  if (delayMs <= 0) return;
  const sleeper = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );
  Atomics.wait(sleeper, 0, 0, delayMs);
}

function boundedGeneratedVisualBrowserCaptureText(value: unknown): string {
  const raw = Buffer.isBuffer(value)
    ? value.toString("utf-8")
    : typeof value === "string"
      ? value
      : "";
  // Browser failures frequently include an ephemeral user-data profile or a
  // file:// preview URL. Capture diagnostics must survive into the durable
  // event ledger, but those machine-local paths are neither useful model
  // feedback nor safe run evidence. Keep the failure class/message while
  // replacing path-shaped tokens generically.
  const redacted = raw
    .replace(/file:\/\/\/[^\s"'<>]+/gi, "<file-path>")
    // Error messages such as `spawnSync C:\\Program Files\\...\\msedge.exe
    // ETIMEDOUT` have a space inside the Windows path, so redact that full
    // executable token before the generic no-whitespace path rule below.
    .replace(
      /[A-Za-z]:[\\/][^<>:"'|?*\r\n]*?(?=\s+(?:ETIMEDOUT|EAGAIN|EBUSY|EMFILE|ENFILE|ERROR_SHARING_VIOLATION)\b|$)/gi,
      "<path>",
    )
    .replace(
      /(^|[\s("'=])(?:[A-Za-z]:[\\/]|\/)[^\s"'<>]*/g,
      (_match, prefix: string) => `${prefix}<path>`,
    );
  const normalized = redacted
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= GENERATED_VISUAL_PREVIEW_CAPTURE_DIAGNOSTIC_MAX_LENGTH) {
    return normalized;
  }
  return `...[truncated] ${normalized.slice(
    -(GENERATED_VISUAL_PREVIEW_CAPTURE_DIAGNOSTIC_MAX_LENGTH - 15),
  )}`;
}

function generatedVisualBrowserProcessFailureDetail(
  result: GeneratedVisualBrowserRunResult,
): string | undefined {
  const parts = [
    result.error?.code ? `code: ${result.error.code}` : "",
    result.error?.message
      ? `error: ${boundedGeneratedVisualBrowserCaptureText(result.error.message)}`
      : "",
    result.stderr
      ? `stderr: ${boundedGeneratedVisualBrowserCaptureText(result.stderr)}`
      : "",
    result.stdout
      ? `stdout: ${boundedGeneratedVisualBrowserCaptureText(result.stdout)}`
      : "",
  ].filter(Boolean);
  const detail = parts.join("; ");
  if (!detail) return undefined;
  if (detail.length <= GENERATED_VISUAL_PREVIEW_CAPTURE_DIAGNOSTIC_MAX_LENGTH) {
    return detail;
  }
  // Preserve the primary error code/message at the front. The prior generic
  // tail truncation allowed a complete dumped DOM to erase ETIMEDOUT and Edge's
  // screenshot byte receipt from the durable failure record.
  return `${detail.slice(
    0,
    GENERATED_VISUAL_PREVIEW_CAPTURE_DIAGNOSTIC_MAX_LENGTH - 15,
  )} [truncated]...`;
}

const GENERATED_VISUAL_CONFIRMED_BROWSER_CLEANUP_METHODS = new Set<
  GeneratedVisualBrowserCleanupMethod
>([
  "natural-exit",
  "natural-exit-lineage",
  "taskkill-tree",
  "lineage-quiescence",
  "process-group",
  "process-group-sigkill",
]);
const GENERATED_VISUAL_PROACTIVE_BROWSER_CLEANUP_METHODS = new Set<
  GeneratedVisualBrowserCleanupMethod
>([
  "taskkill-tree",
  "lineage-quiescence",
  "process-group",
  "process-group-sigkill",
]);

function generatedVisualBrowserProcessSucceeded(
  result: GeneratedVisualBrowserRunResult,
  allowedCompletions: ReadonlySet<GeneratedVisualBrowserCompletion>,
): boolean {
  if (
    result.status !== 0 || result.signal !== null || result.error != null ||
    result.timedOut !== false || result.cleanupConfirmed !== true ||
    !result.cleanupMethod ||
    !GENERATED_VISUAL_CONFIRMED_BROWSER_CLEANUP_METHODS.has(result.cleanupMethod) ||
    !result.completion || !allowedCompletions.has(result.completion)
  ) return false;
  if (result.completion === "process_exit") {
    return result.browserExitedNaturally === true && [
      "natural-exit",
      "natural-exit-lineage",
      "process-group",
    ].includes(result.cleanupMethod);
  }
  return result.browserExitedNaturally === false && [
    "taskkill-tree",
    "lineage-quiescence",
    "process-group",
    "process-group-sigkill",
  ].includes(result.cleanupMethod);
}

const GENERATED_VISUAL_BROWSER_MOUNT_SUCCESS_COMPLETIONS = new Set<
  GeneratedVisualBrowserCompletion
>(["observed_dom", "process_exit"]);
const GENERATED_VISUAL_BROWSER_CAPTURE_SUCCESS_COMPLETIONS = new Set<
  GeneratedVisualBrowserCompletion
>(["observed_capture", "process_exit"]);

function generatedVisualBrowserAttemptDiagnostics(
  result: GeneratedVisualBrowserRunResult,
): GeneratedVisualBrowserAttemptDiagnostics {
  const errorCode = result.error?.code === undefined || result.error?.code === null
    ? undefined
    : String(result.error.code);
  const failed = result.status !== 0 || Boolean(result.signal) ||
    Boolean(result.error) || result.timedOut === true ||
    result.cleanupConfirmed !== true;
  const stderr = failed && result.stderr
    ? boundedGeneratedVisualBrowserCaptureText(result.stderr)
    : undefined;
  const stdoutTail = failed && result.stdout
    ? boundedGeneratedVisualBrowserCaptureText(result.stdout)
    : undefined;
  return {
    ...(Number.isFinite(result.durationMs)
      ? { durationMs: Math.max(0, Math.round(result.durationMs as number)) }
      : {}),
    ...(typeof result.timedOut === "boolean" ? { timedOut: result.timedOut } : {}),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(stderr === undefined ? {} : { stderr }),
    ...(stdoutTail === undefined ? {} : { stdoutTail }),
    ...(result.completion === undefined ? {} : { completion: result.completion }),
    ...(typeof result.browserExitedNaturally === "boolean"
      ? { browserExitedNaturally: result.browserExitedNaturally }
      : {}),
    ...(result.cleanupMethod === undefined
      ? {}
      : { cleanupMethod: result.cleanupMethod }),
    ...(typeof result.cleanupConfirmed === "boolean"
      ? { cleanupConfirmed: result.cleanupConfirmed }
      : {}),
  };
}

/** Restrict retries to process-level, explicitly transient failures. A browser
 * that reached a failed sandbox result is semantic evidence and must remain a
 * single gate result. A passed DOM that arrived only after the process deadline
 * is different: retain that deadline attempt truthfully, then permit the one
 * existing fresh-profile retry because no candidate semantics failed. */
function generatedVisualTransientBrowserMountFailureCode(
  result: GeneratedVisualBrowserRunResult,
  output: string,
): string | undefined {
  const runtimePassed =
    /\bdata-breadboard-runtime-tests=["']passed["']/i.test(output) &&
    !/\bdata-breadboard-overflow=["']true["']/i.test(output);
  const runtimeEvidencePresent =
    /\bdata-breadboard-runtime-(?:tests|diagnostics)\b/i.test(output);
  if (
    (!runtimeEvidencePresent || runtimePassed) &&
    result.status === null &&
    result.timedOut === true &&
    result.completion === "deadline" &&
    result.cleanupConfirmed === true &&
    result.browserExitedNaturally === false &&
    result.cleanupMethod !== undefined &&
    GENERATED_VISUAL_PROACTIVE_BROWSER_CLEANUP_METHODS.has(result.cleanupMethod) &&
    String(result.error?.code ?? "").toUpperCase() === "ETIMEDOUT"
  ) {
    return "ETIMEDOUT";
  }
  if (
    /\bdata-breadboard-runtime-(?:tests|diagnostics)\b/i.test(output) ||
    (result.status === 0 && !result.signal && !result.error)
  ) {
    return undefined;
  }
  const failureText = [
    result.error?.code,
    result.error?.message,
    result.stderr,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => Buffer.isBuffer(value) ? value.toString("utf-8") : String(value))
    .join("\n");
  const code = failureText.match(
    /\b(?:ETIMEDOUT|EAGAIN|EBUSY|EMFILE|ENFILE|ERROR_SHARING_VIOLATION)\b/i,
  )?.[0]?.toUpperCase();
  const exactTransientSpawn = result.status === null && result.signal === null &&
    result.timedOut === false && result.completion === "spawn_error" &&
    result.browserExitedNaturally === false && result.error != null &&
    result.cleanupConfirmed === true && (
      result.cleanupMethod === "none" ||
      result.cleanupMethod !== undefined &&
        GENERATED_VISUAL_PROACTIVE_BROWSER_CLEANUP_METHODS.has(result.cleanupMethod)
    );
  return exactTransientSpawn && code &&
      GENERATED_VISUAL_TRANSIENT_BROWSER_MOUNT_ERROR_CODES.has(code)
    ? code
    : undefined;
}

function generatedVisualTransientBrowserCaptureFailureCode(
  result: GeneratedVisualBrowserRunResult,
  output: string,
  requiresPreviewPrimarySpatialFrame: boolean,
): string | undefined {
  const runtimeEvidencePresent =
    /\bdata-breadboard-runtime-(?:tests|diagnostics)\b/i.test(output);
  const runtimePassed =
    /\bdata-breadboard-runtime-tests=["']passed["']/i.test(output) &&
    !/\bdata-breadboard-runtime-diagnostics\b/i.test(output) &&
    !/\bdata-breadboard-overflow=["']true["']/i.test(output);
  const semanticFailure = runtimeEvidencePresent && !runtimePassed ||
    requiresPreviewPrimarySpatialFrame &&
      !/\bdata-breadboard-preview-primary-spatial-frame=["']passed["']/i.test(output);
  const proactiveCleanupConfirmed = result.cleanupConfirmed === true &&
    result.cleanupMethod !== undefined &&
    GENERATED_VISUAL_PROACTIVE_BROWSER_CLEANUP_METHODS.has(result.cleanupMethod);
  if (
    !semanticFailure && proactiveCleanupConfirmed && result.status === null &&
    result.timedOut === true && result.completion === "deadline" &&
    result.browserExitedNaturally === false &&
    String(result.error?.code ?? "").toUpperCase() === "ETIMEDOUT"
  ) return "ETIMEDOUT";
  if (result.status === 0) {
    return !semanticFailure && generatedVisualBrowserProcessSucceeded(
      result,
      GENERATED_VISUAL_BROWSER_CAPTURE_SUCCESS_COMPLETIONS,
    )
      ? "ENOENT"
      : undefined;
  }
  const exactTransientSpawn = result.status === null && result.signal === null &&
    result.timedOut === false && result.completion === "spawn_error" &&
    result.browserExitedNaturally === false && result.error != null &&
    result.cleanupConfirmed === true && (
      result.cleanupMethod === "none" || proactiveCleanupConfirmed
    );
  if (!exactTransientSpawn) return undefined;
  const failureText = [result.error?.code, result.error?.message, result.stderr]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => Buffer.isBuffer(value) ? value.toString("utf-8") : String(value))
    .join("\n");
  const code = failureText.match(
    /\b(?:EAGAIN|EBUSY|EMFILE|ENFILE|ERROR_SHARING_VIOLATION)\b/i,
  )?.[0]?.toUpperCase();
  return code && GENERATED_VISUAL_TRANSIENT_BROWSER_MOUNT_ERROR_CODES.has(code)
    ? code
    : undefined;
}

function generatedVisualBrowserMountFailureDetail(
  result: GeneratedVisualBrowserRunResult,
  output: string,
): string {
  if (/\bdata-breadboard-runtime-(?:tests|diagnostics)\b/i.test(output)) {
    const runtimePassed =
      /\bdata-breadboard-runtime-tests=["']passed["']/i.test(output) &&
      !/\bdata-breadboard-overflow=["']true["']/i.test(output);
    const processDetail = generatedVisualBrowserProcessFailureDetail(result);
    if (runtimePassed && processDetail) {
      const prefix = "runtime self-check passed but the browser process failed: ";
      return `${prefix}${processDetail.slice(
        0,
        GENERATED_VISUAL_PREVIEW_CAPTURE_DIAGNOSTIC_MAX_LENGTH - prefix.length,
      )}`;
    }
    // Keep the runtime's own bounded, primary-cause-first diagnostic intact.
    // It is model-facing semantic evidence, unlike an OS process error.
    return browserRuntimeFailureDetail(output);
  }
  return generatedVisualBrowserProcessFailureDetail(result) ??
    boundedGeneratedVisualBrowserCaptureText(browserRuntimeFailureDetail(output));
}

function generatedVisualPreviewScreenshotBytes(filePath: string): number | undefined {
  try {
    const stats = externalRuntimeStat(filePath);
    return stats.isFile() && stats.size > 0 ? stats.size : undefined;
  } catch {
    return undefined;
  }
}

export interface GeneratedVisualBrowserTestRunnerInput {
  definition: GeneratedVisualizationDefinition;
  outputDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Keep narrow-mobile compatibility in the validation contract. Defaults to
   * true so existing callers remain strict; desktop-only Learn runs opt out
   * explicitly without disabling browser validation altogether. */
  requireMobileValidation?: boolean;
}

export interface GeneratedVisualBrowserTestsInput
  extends GeneratedVisualBrowserTestRunnerInput {
  /** The caller owns browser discovery; orchestration may never discover or
   * spawn a local process implicitly. */
  browserExecutable: string;
  /** The caller owns the isolated execution boundary. Next injects Runtime V2;
   * disposable workers may inject the local observed-process adapter. */
  browserRunner: GeneratedVisualBrowserRunner;
  /** Test-only override for bounded transient browser-mount retry sleeps. */
  browserMountRetryBackoff?: (delayMs: number) => void;
  /** Test-only override for bounded retry sleeps. */
  previewCaptureRetryBackoff?: (delayMs: number) => void;
  /** Test-only override for fail-closed disposable-profile cleanup. */
  browserProfileRemover?: typeof removeGeneratedVisualBrowserProfile;
}

export type GeneratedVisualBrowserTestResult = Promise<{
  tests: GeneratedVisualTestsRecord["runtimeTests"];
  browser?: GeneratedVisualTestsRecord["browser"];
  previews?: GeneratedVisualPreviewArtifact[];
}>;

export type GeneratedVisualBrowserTestRunner = (
  input: GeneratedVisualBrowserTestRunnerInput,
) => GeneratedVisualBrowserTestResult;

export async function runGeneratedVisualBrowserTests(
  input: GeneratedVisualBrowserTestsInput,
): GeneratedVisualBrowserTestResult {
  const executable = input.browserExecutable.trim();
  if (!executable) {
    return {
      tests: [
        {
          name: "browser mount",
          passed: false,
          detail: "No Chromium/Edge executable configured",
        },
      ],
    };
  }
  let runtime = "";
  try {
    runtime = fs.readFileSync(
      /* turbopackIgnore: true */ resolveGeneratedVisualSandboxRuntimePath(),
      "utf-8",
    );
  } catch {
    return {
      tests: [
        {
          name: "browser mount",
          passed: false,
          detail: "Generated visual sandbox runtime is missing",
        },
      ],
      browser: { executable, viewports: [], screenshotCreated: false },
    };
  }
  fs.mkdirSync(input.outputDir, { recursive: true });
  const timeout = input.timeoutMs ?? 20_000;
  const requireMobileValidation = input.requireMobileValidation ?? true;
  const scenarios = [
    ...(requireMobileValidation
      ? [{
          name: "375x667 light",
          viewport: "375x667",
          theme: "light" as const,
          flags: [],
        }]
      : []),
    {
      name: "1280x800 dark",
      viewport: "1280x800",
      theme: "dark" as const,
      flags: [],
    },
    {
      name: "1280x800 reduced-motion",
      viewport: "1280x800",
      theme: "light" as const,
      flags: ["--force-prefers-reduced-motion"],
    },
  ];
  const viewports = scenarios.map((scenario) => scenario.name);
  const tests: GeneratedVisualTestsRecord["runtimeTests"] = [];
  const htmlPaths: string[] = [];
  let browserProfileRoot: string;
  try {
    browserProfileRoot = createGeneratedVisualBrowserProfileRoot();
  } catch (error) {
    return {
      tests: [
        {
          name: "browser mount",
          passed: false,
          detail: error instanceof Error
            ? `Could not create a disposable browser profile: ${error.message}`
            : "Could not create a disposable browser profile",
        },
      ],
      browser: { executable, viewports: [], screenshotCreated: false },
    };
  }
  const profileCleanup: GeneratedVisualBrowserProfileCleanupReceipt = {
    attempted: 0,
    removed: 0,
    retries: 0,
    rootRemoved: false,
    confirmed: true,
  };
  const browserProfileRemover = input.browserProfileRemover ??
    removeGeneratedVisualBrowserProfile;
  const recordProfileCleanup = (
    receipt: GeneratedVisualBrowserProfileRemoveReceipt,
    root: boolean,
  ) => {
    profileCleanup.attempted += 1;
    profileCleanup.retries += receipt.retries;
    if (receipt.confirmed) profileCleanup.removed += 1;
    else {
      profileCleanup.confirmed = false;
      profileCleanup.failureCode ??= receipt.failureCode ?? "EPROFILECLEANUP";
    }
    if (root) profileCleanup.rootRemoved = receipt.confirmed;
  };
  let primaryError: unknown;
  let completedResult: Awaited<GeneratedVisualBrowserTestResult> | undefined;
  try {
    const browserRunner = input.browserRunner;
    const retryBrowserMount =
      input.browserMountRetryBackoff ??
      waitForGeneratedVisualBrowserRetry;
    let browserProfileCounter = 0;
    const spawnIsolatedBrowser = async (slug: string, args: string[]) => {
      browserProfileCounter += 1;
      const profilePath = path.resolve(
        browserProfileRoot,
        `p-${browserProfileCounter}`,
      );
      if (!sameGeneratedVisualBrowserPath(path.dirname(profilePath), browserProfileRoot)) {
        throw new Error(
          "Generated visual browser profile escaped its disposable output directory",
        );
      }
      fs.mkdirSync(profilePath, { recursive: false });
      let runnerResult: GeneratedVisualBrowserRunResult | undefined;
      let runnerError: unknown;
      try {
        if (input.signal?.aborted) {
          throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
        }
        runnerResult = await browserRunner({
          executable,
          args: [`--user-data-dir=${profilePath}`, ...args],
          slug,
          profilePath,
          timeoutMs: timeout,
        });
      } catch (error) {
        if (input.signal?.aborted) {
          runnerError = input.signal.reason ?? new DOMException("Aborted", "AbortError");
        } else {
          runnerResult = {
            status: null,
            signal: null,
            error: {
              message: error instanceof Error
                ? error.message
                : "Generated visual browser runner threw an unknown error",
            },
          };
        }
      }
      let cleanup: GeneratedVisualBrowserProfileRemoveReceipt;
      try {
        cleanup = await browserProfileRemover(browserProfileRoot, profilePath);
      } catch (error) {
        cleanup = {
          confirmed: false,
          retries: 0,
          failureCode: generatedVisualBrowserCleanupErrorCode(error),
        };
      }
      recordProfileCleanup(cleanup, false);
      if (runnerError !== undefined) {
        if (!cleanup.confirmed) {
          throw new AggregateError(
            [
              runnerError,
              new Error(
                `Disposable browser profile cleanup was not confirmed (${cleanup.failureCode ?? "EPROFILECLEANUP"}).`,
              ),
            ],
            "Browser cancellation and profile cleanup both failed.",
          );
        }
        throw runnerError;
      }
      if (!cleanup.confirmed) {
        const runnerFailure = runnerResult?.error?.message
          ? ` Runner failure: ${boundedGeneratedVisualBrowserCaptureText(
              runnerResult.error.message,
            )}`
          : "";
        return {
          ...runnerResult,
          status: null,
          error: {
            code: cleanup.failureCode ?? "EPROFILECLEANUP",
            message: `Disposable browser profile cleanup was not confirmed.${runnerFailure}`,
          },
          cleanupConfirmed: false,
        };
      }
      return runnerResult ?? {
        status: null,
        error: {
          code: "EBROWSERRESULT",
          message: "Generated visual browser runner returned no result.",
        },
        cleanupConfirmed: false,
      };
    };
  const browserMountReceipts: GeneratedVisualBrowserMountReceipt[] = [];
  for (const scenario of scenarios) {
    const [width, height] = scenario.viewport.split("x");
    const scenarioSlug = scenario.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const htmlPath = path.join(input.outputDir, `preview-${scenarioSlug}.html`);
    htmlPaths.push(htmlPath);
    fs.writeFileSync(
      htmlPath,
      previewHtml(input.definition, runtime, scenario.theme),
      "utf-8",
    );
    const url = pathToFileURL(htmlPath).href;
    const receipt: GeneratedVisualBrowserMountReceipt = {
      scenario: scenario.name,
      viewport: scenario.viewport,
      theme: scenario.theme,
      mounted: false,
      attempts: [],
    };
    for (
      let mountAttempt = 1;
      mountAttempt <= GENERATED_VISUAL_BROWSER_MOUNT_MAX_ATTEMPTS;
      mountAttempt += 1
    ) {
      // This creates a new profile path for every retry. Do not reuse the
      // profile from an interrupted Edge process, even when its cleanup was
      // delayed by the OS.
      const result = await spawnIsolatedBrowser(scenarioSlug, [
        "--headless=new",
        "--disable-gpu",
        "--disable-gpu-shader-disk-cache",
        "--disable-skia-graphite",
        "--disable-features=SkiaGraphiteUsePersistentCache",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-first-run",
        ...scenario.flags,
        `--window-size=${width},${height}`,
        "--virtual-time-budget=2500",
        "--dump-dom",
        url,
      ]);
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      const mounted =
        generatedVisualBrowserProcessSucceeded(
          result,
          GENERATED_VISUAL_BROWSER_MOUNT_SUCCESS_COMPLETIONS,
        ) &&
        output.includes('data-breadboard-runtime-tests="passed"') &&
        !output.includes('data-breadboard-overflow="true"');
      const transientFailureCode = mounted
        ? undefined
        : generatedVisualTransientBrowserMountFailureCode(result, output);
      const retryDelayMs =
        transientFailureCode &&
        mountAttempt < GENERATED_VISUAL_BROWSER_MOUNT_MAX_ATTEMPTS
          ? generatedVisualBrowserMountRetryDelay(mountAttempt)
          : undefined;
      receipt.attempts.push({
        attempt: mountAttempt,
        status: result.status ?? null,
        signal: result.signal ?? null,
        mounted,
        ...generatedVisualBrowserAttemptDiagnostics(result),
        ...(transientFailureCode === undefined
          ? {}
          : { transientFailureCode }),
        ...(!mounted
          ? { detail: generatedVisualBrowserMountFailureDetail(result, output) }
          : {}),
        ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
      });
      if (mounted) {
        receipt.mounted = true;
        break;
      }
      if (retryDelayMs === undefined) break;
      retryBrowserMount(retryDelayMs);
    }
    browserMountReceipts.push(receipt);
    const lastMountAttempt = receipt.attempts.at(-1);
    const retryCodes = receipt.attempts
      .map((attempt) => attempt.transientFailureCode)
      .filter((code): code is string => Boolean(code));
    tests.push({
      name: `browser mount ${scenario.name}`,
      passed: receipt.mounted,
      detail: receipt.mounted
        ? receipt.attempts.length === 1
          ? "mounted and self-tested"
          : `mounted and self-tested after transient browser retry ${receipt.attempts.length}/${GENERATED_VISUAL_BROWSER_MOUNT_MAX_ATTEMPTS} (${retryCodes.join(", ") || "unknown"})`
        : lastMountAttempt?.detail ?? "browser mount did not complete",
    });
  }
  const previewViewports = [
    ...(requireMobileValidation
      ? [{
          id: "mobile-375x667-light",
          width: 375,
          height: 667,
          theme: "light" as const,
        }]
      : []),
    {
      id: "desktop-1000x720-light",
      width: 1000,
      height: 720,
      theme: "light" as const,
    },
  ];
  const previewStates = planGeneratedVisualSelectPreviewStates(input.definition);
  const previews: GeneratedVisualPreviewArtifact[] = [];
  const previewCaptureReceipts: GeneratedVisualPreviewCaptureReceipt[] = [];
  const retryPreviewCapture =
    input.previewCaptureRetryBackoff ??
    waitForGeneratedVisualBrowserRetry;
  let screenshotCreated = false;
  let screenshotFailureDetail = "Screenshot was not created";
  const previewPrimarySpatialFrameFailures: string[] = [];
  for (const [previewStateIndex, previewState] of previewStates.entries()) {
    for (const [previewViewportIndex, previewViewport] of previewViewports.entries()) {
      const isDefaultDesktop =
        previewState.defaultState &&
        previewViewport.id === "desktop-1000x720-light";
      // Keep Chromium's temporary input/output names short: the visual staging
      // directory can already be close to Windows MAX_PATH. The receipt below
      // retains the labelled viewport/state identity used for diagnostics.
      const previewArtifactSuffix = `${previewViewportIndex}-${previewStateIndex}`;
      const screenshotPath = isDefaultDesktop
        ? path.join(input.outputDir, "preview.png")
        : path.join(
            input.outputDir,
            `preview-${previewArtifactSuffix}.png`,
          );
      const screenshotHtmlPath = path.join(
        input.outputDir,
        `preview-${previewArtifactSuffix}.html`,
      );
      htmlPaths.push(screenshotHtmlPath);
      fs.writeFileSync(
        screenshotHtmlPath,
        previewHtml(input.definition, runtime, previewViewport.theme, previewState),
        "utf-8",
      );
      const screenshotUrl = pathToFileURL(screenshotHtmlPath).href;
      const captureScreenshot = () =>
        spawnIsolatedBrowser(`screenshot-${previewViewport.id}-${previewState.id}`, [
          "--headless=new",
          "--disable-gpu",
          "--disable-gpu-shader-disk-cache",
          "--disable-skia-graphite",
          "--disable-features=SkiaGraphiteUsePersistentCache",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-dev-shm-usage",
          "--no-first-run",
          `--window-size=${previewViewport.width},${previewViewport.height}`,
          "--virtual-time-budget=2500",
          "--dump-dom",
          `--screenshot=${screenshotPath}`,
          screenshotUrl,
        ]);
      const receipt: GeneratedVisualPreviewCaptureReceipt = {
        id: `${previewViewport.id}--${previewState.id}`,
        viewport: {
          width: previewViewport.width,
          height: previewViewport.height,
        },
        theme: previewViewport.theme,
        selectState: previewState.selectState.map((entry) => ({ ...entry })),
        defaultState: previewState.defaultState,
        selectStateCoverageTruncated:
          previewState.selectStateCoverageTruncated,
        captured: false,
        attempts: [],
      };
      for (
        let captureAttempt = 1;
        captureAttempt <= GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS;
        captureAttempt += 1
      ) {
        // Never let a prior partial/stale file turn a fresh capture into a
        // false pass. A fresh isolated profile is created for every invocation
        // below, including each retry.
        try {
          fs.rmSync(screenshotPath, { force: true });
        } catch (error) {
          const failureCode = generatedVisualBrowserCleanupErrorCode(error);
          const transientFailureCode =
            GENERATED_VISUAL_TRANSIENT_BROWSER_MOUNT_ERROR_CODES.has(failureCode)
              ? failureCode
              : undefined;
          const retryDelayMs =
            transientFailureCode &&
            captureAttempt < GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS
              ? generatedVisualPreviewCaptureRetryDelay(captureAttempt)
              : undefined;
          receipt.attempts.push({
            attempt: captureAttempt,
            status: null,
            signal: null,
            screenshotCreated: false,
            detail: boundedGeneratedVisualBrowserCaptureText(
              `error: could not clear prior screenshot: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            ),
            ...(transientFailureCode === undefined
              ? {}
              : { transientFailureCode }),
            ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
          });
          if (retryDelayMs === undefined) break;
          retryPreviewCapture(retryDelayMs);
          continue;
        }
        let screenshot: GeneratedVisualBrowserRunResult;
        try {
          screenshot = await captureScreenshot();
        } catch (error) {
          screenshot = {
            status: null,
            signal: null,
            error: {
              message: error instanceof Error
                ? error.message
                : "Generated visual screenshot capture threw an unknown error",
            },
          };
        }
        const created =
          generatedVisualBrowserProcessSucceeded(
            screenshot,
            GENERATED_VISUAL_BROWSER_CAPTURE_SUCCESS_COMPLETIONS,
          ) &&
          isReadableGeneratedVisualPreviewFile(screenshotPath);
        const output = `${screenshot.stdout ?? ""}\n${screenshot.stderr ?? ""}`;
        const requiresPreviewPrimarySpatialFrame =
          previewPrimarySpatialFrameRequired(input.definition, previewViewport);
        const previewPrimarySpatialFrameValidated =
          !requiresPreviewPrimarySpatialFrame ||
          browserPreviewPrimarySpatialFramePassed(output);
        const captured = created && previewPrimarySpatialFrameValidated;
        const transientFailureCode = created
          ? undefined
          : generatedVisualTransientBrowserCaptureFailureCode(
              screenshot,
              output,
              requiresPreviewPrimarySpatialFrame,
            );
        const retryDelayMs =
          transientFailureCode &&
          captureAttempt < GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS
            ? generatedVisualPreviewCaptureRetryDelay(captureAttempt)
            : undefined;
        const screenshotBytes = created
          ? generatedVisualPreviewScreenshotBytes(screenshotPath)
          : undefined;
        receipt.attempts.push({
          attempt: captureAttempt,
          status: screenshot.status ?? null,
          signal: screenshot.signal ?? null,
          screenshotCreated: created,
          ...generatedVisualBrowserAttemptDiagnostics(screenshot),
          ...(requiresPreviewPrimarySpatialFrame
            ? { previewPrimarySpatialFrameValidated }
            : {}),
          ...(screenshotBytes === undefined ? {} : { screenshotBytes }),
          ...(transientFailureCode === undefined
            ? {}
            : { transientFailureCode }),
          ...(!captured
            ? {
                detail: created
                  ? browserPreviewPrimarySpatialFrameFailureDetail(output)
                  : generatedVisualBrowserProcessFailureDetail(screenshot) ??
                    "screenshot file was not created",
              }
            : {}),
          ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
        });
        if (captured) {
          receipt.captured = true;
          break;
        }
        if (created && !previewPrimarySpatialFrameValidated) {
          previewPrimarySpatialFrameFailures.push(
            `${receipt.id}: ${browserPreviewPrimarySpatialFrameFailureDetail(output)}`,
          );
          break;
        }
        if (retryDelayMs === undefined) break;
        retryPreviewCapture(retryDelayMs);
      }
      previewCaptureReceipts.push(receipt);
      if (receipt.captured) {
        previews.push({
          id: receipt.id,
          viewport: { ...receipt.viewport },
          theme: receipt.theme,
          selectState: receipt.selectState.map((entry) => ({ ...entry })),
          defaultState: receipt.defaultState,
          selectStateCoverageTruncated: receipt.selectStateCoverageTruncated,
          path: screenshotPath,
        });
      }
      if (isDefaultDesktop) {
        screenshotCreated = receipt.captured;
        screenshotFailureDetail =
          receipt.attempts.at(-1)?.detail ?? "Screenshot was not created";
      }
    }
  }
  tests.push({
    name: "preview screenshot",
    passed: screenshotCreated,
    detail: screenshotCreated
      ? "created"
      : screenshotFailureDetail,
  });
  if (requireMobileValidation) {
    tests.push({
      name: "mobile primary spatial preview frame",
      passed: previewPrimarySpatialFrameFailures.length === 0,
      detail: previewPrimarySpatialFrameFailures.length === 0
        ? "validated where required"
        : previewPrimarySpatialFrameFailures.join("; "),
    });
  }
  const expectedPreviewCount = previewStates.length * previewViewports.length;
  const previewMatrixComplete = previews.length === expectedPreviewCount;
  const previewMatrixReceipt: GeneratedVisualPreviewMatrixReceipt = {
    expectedCount: expectedPreviewCount,
    capturedCount: previews.length,
    cells: previewCaptureReceipts,
  };
  tests.push({
    name: "repair preview matrix",
    passed: previewMatrixComplete,
    detail: previewMatrixComplete
      ? `${previews.length} labelled captures for ${previewStates.length} bounded select state${previewStates.length === 1 ? "" : "s"}`
      : `captured ${previews.length}/${expectedPreviewCount} required labelled previews`,
  });
  try {
    for (const htmlPath of htmlPaths) fs.rmSync(htmlPath, { force: true });
  } catch {
    // A debug preview HTML is harmless if the browser still has the file open.
  }
  completedResult = {
    tests,
    browser: {
      executable,
      viewports,
      screenshotCreated,
      previewCount: previews.length,
      selectStateCount: previewStates.length,
      selectStateCoverageTruncated: previewStates.some(
        (preview) => preview.selectStateCoverageTruncated,
      ),
      previewMatrixComplete,
      previewMatrixReceipt,
      mountReceipts: browserMountReceipts,
      profileCleanup,
    },
    previews,
  };
  return completedResult;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let rootCleanup: GeneratedVisualBrowserProfileRemoveReceipt;
    try {
      rootCleanup = await browserProfileRemover(
        browserProfileRoot,
        browserProfileRoot,
      );
    } catch (error) {
      rootCleanup = {
        confirmed: false,
        retries: 0,
        failureCode: generatedVisualBrowserCleanupErrorCode(error),
      };
    }
    recordProfileCleanup(rootCleanup, true);
    if (completedResult) {
      completedResult.tests.push({
        name: "browser profile cleanup",
        passed: profileCleanup.confirmed && profileCleanup.rootRemoved,
        detail: profileCleanup.confirmed && profileCleanup.rootRemoved
          ? `${profileCleanup.removed}/${profileCleanup.attempted} disposable paths removed with ${profileCleanup.retries} bounded retries`
          : `cleanup unconfirmed (${profileCleanup.failureCode ?? "EPROFILECLEANUP"})`,
      });
    } else if (!rootCleanup.confirmed) {
      const cleanupError = new Error(
        `Generated visual browser profile-root cleanup was not confirmed (${rootCleanup.failureCode ?? "EPROFILECLEANUP"}).`,
      );
      if (primaryError !== undefined) {
        throw new AggregateError(
          [primaryError, cleanupError],
          "Browser execution and profile-root cleanup both failed.",
        );
      }
      throw cleanupError;
    }
  }
}

function isReadableGeneratedVisualPreviewFile(filePath: string): boolean {
  try {
    const stats = externalRuntimeStat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function availableGeneratedVisualPreviews(
  previews: readonly GeneratedVisualPreviewArtifact[] | undefined,
): GeneratedVisualPreviewArtifact[] {
  return (previews ?? []).filter((preview) =>
    isReadableGeneratedVisualPreviewFile(preview.path),
  );
}

function generatedVisualPreviewIdentities(
  previews: readonly GeneratedVisualPreviewArtifact[],
): GeneratedVisualPreviewIdentity[] {
  return previews.map((preview) => ({
    id: preview.id,
    viewport: { ...preview.viewport },
    theme: preview.theme,
    selectState: preview.selectState.map((entry) => ({ ...entry })),
    defaultState: preview.defaultState,
    selectStateCoverageTruncated: preview.selectStateCoverageTruncated,
  }));
}

function generatedVisualPreviewImageParts(
  previews: readonly GeneratedVisualPreviewArtifact[],
) {
  return previews.map((preview) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/png;base64,${externalRuntimeReadFile(preview.path).toString("base64")}`,
      detail: "low" as const,
    },
  }));
}

export function buildGeneratedVisualBlock(id: string, version: number): string {
  if (!ID_PATTERN.test(id) || !Number.isInteger(version) || version < 1) {
    throw new Error("Invalid generated visualization block identity");
  }
  return `\`\`\`${GENERATED_VISUAL_BLOCK_LANG}\nid: ${id}\nversion: ${version}\n\`\`\``;
}

const GENERATED_BLOCK_RE =
  /```breadboard-generated-visual\r?\n([\s\S]*?)\r?\n```/g;

export function parseGeneratedVisualBlock(
  value: string,
): { id: string; version: number } | null {
  const id =
    value.match(/^id:\s*([A-Za-z][A-Za-z0-9_-]{1,79})\s*$/m)?.[1] ?? "";
  const version = Number(value.match(/^version:\s*(\d+)\s*$/m)?.[1] ?? 0);
  return ID_PATTERN.test(id) && Number.isInteger(version) && version > 0
    ? { id, version }
    : null;
}

export function findGeneratedVisualBlockById(
  markdown: string,
  visualId: string,
): { fullMatch: string; value: string; index: number; version: number } | null {
  const pattern = new RegExp(
    GENERATED_BLOCK_RE.source,
    GENERATED_BLOCK_RE.flags,
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const parsed = parseGeneratedVisualBlock(match[1]);
    if (parsed?.id === visualId) {
      return {
        fullMatch: match[0],
        value: match[1],
        index: match.index,
        version: parsed.version,
      };
    }
  }
  return null;
}

export function replaceGeneratedVisualBlock(
  markdown: string,
  block: { fullMatch: string; index: number },
  id: string,
  version: number,
): string {
  return `${markdown.slice(0, block.index)}${buildGeneratedVisualBlock(id, version)}${markdown.slice(
    block.index + block.fullMatch.length,
  )}`;
}

function artifactRelativePath(id: string): string {
  return `.breadboard/visuals/${id}`;
}

export function generatedVisualArtifactDir(
  gardenDir: string,
  id: string,
): string {
  if (!ID_PATTERN.test(id))
    throw new Error("Invalid generated visualization ID");
  return path.join(gardenDir, ".breadboard", "visuals", id);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function copyArtifactFiles(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of [
    "manifest.json",
    "source.tsx",
    "compiled.js",
    "validation.json",
    "critic.json",
    "preview.png",
    "preview-matrix.json",
    "tests.json",
    "lifecycle.json",
  ]) {
    const source = path.join(sourceDir, file);
    if (externalRuntimePathExists(source))
      externalRuntimeCopyFile(source, path.join(targetDir, file));
  }
}

export function validateGeneratedVisualizationManifest(
  value: unknown,
  expectedId?: string,
): { manifest: GeneratedVisualizationManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value))
    return { manifest: null, errors: ["manifest must be an object"] };
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID_PATTERN.test(id)) errors.push("manifest id is invalid");
  if (expectedId && id !== expectedId)
    errors.push(
      `manifest id ${id || "(missing)"} does not match ${expectedId}`,
    );
  if (value.schemaVersion !== GENERATED_VISUAL_SCHEMA_VERSION)
    errors.push("unsupported manifest schemaVersion");
  if (value.sdkVersion !== VISUAL_SDK_VERSION)
    errors.push("unsupported manifest sdkVersion");
  for (const field of [
    "gardenId",
    "learningUnitId",
    "title",
    "description",
    "learningObjective",
    "insertionAnchor",
    "targetPage",
    "targetHeading",
    "generatorModel",
    "artifactPath",
    "similarityFingerprint",
  ]) {
    if (typeof value[field] !== "string" || !String(value[field]).trim())
      errors.push(`manifest ${field} is required`);
  }
  if (
    typeof value.targetPage === "string" &&
    (!value.targetPage.startsWith("learning/") ||
      !value.targetPage.endsWith(".md"))
  ) {
    errors.push("manifest targetPage must be a learning Markdown page");
  }
  if (id && value.artifactPath !== artifactRelativePath(id))
    errors.push("manifest artifactPath does not match id");
  for (const field of ["sourceAnchorIds", "sourceVisualIds", "conceptIds"]) {
    if (
      !Array.isArray(value[field]) ||
      value[field].some((item) => typeof item !== "string")
    ) {
      errors.push(`manifest ${field} must be a string array`);
    }
  }
  const relationships = value.sourceVisualRelationships ?? [];
  if (
    !Array.isArray(relationships) ||
    relationships.some((relationship) => !isRecord(relationship))
  ) {
    errors.push("manifest sourceVisualRelationships must be an array");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(value.sourceHash ?? "")))
    errors.push("manifest sourceHash is invalid");
  if (!/^[a-f0-9]{64}$/i.test(String(value.compiledHash ?? "")))
    errors.push("manifest compiledHash is invalid");
  if (!Number.isInteger(value.version) || Number(value.version) < 1)
    errors.push("manifest version is invalid");
  if (
    !Number.isInteger(value.generationAttempt) ||
    Number(value.generationAttempt) < 1
  )
    errors.push("manifest generationAttempt is invalid");
  if (
    value.previousVersion !== undefined &&
    (!Number.isInteger(value.previousVersion) ||
      Number(value.previousVersion) < 1)
  ) {
    errors.push("manifest previousVersion is invalid");
  }
  if (!Number.isFinite(Date.parse(String(value.generatedAt ?? ""))))
    errors.push("manifest generatedAt is invalid");
  if (
    ![
      "draft",
      "validated",
      "compiled",
      "tested",
      "critic_approved",
      "published",
      "rejected",
    ].includes(String(value.status))
  ) {
    errors.push("manifest status is invalid");
  }
  if (errors.length > 0) return { manifest: null, errors };
  return {
    manifest: {
      ...(value as unknown as GeneratedVisualizationManifest),
      sourceVisualRelationships: relationships as SourceVisualRelationship[],
    },
    errors: [],
  };
}

export function saveGeneratedVisualArtifact(input: {
  gardenDir: string;
  manifest: GeneratedVisualizationManifest;
  sourceCode: string;
  compiledJavaScript: string;
  validation: GeneratedVisualValidationRecord;
  critic: GeneratedVisualCriticRecord;
  tests: GeneratedVisualTestsRecord;
  lifecycle: GeneratedVisualLifecycleRecord[];
  previewPath?: string;
}): void {
  const checkedManifest = validateGeneratedVisualizationManifest(
    input.manifest,
    input.manifest.id,
  );
  if (!checkedManifest.manifest) {
    throw new Error(
      `Invalid generated visualization manifest: ${checkedManifest.errors.join("; ")}`,
    );
  }
  const dir = generatedVisualArtifactDir(input.gardenDir, input.manifest.id);
  const versionDir = path.join(dir, "versions", String(input.manifest.version));
  fs.mkdirSync(versionDir, { recursive: true });
  writeJson(path.join(versionDir, "manifest.json"), input.manifest);
  fs.writeFileSync(
    path.join(versionDir, "source.tsx"),
    input.sourceCode,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(versionDir, "compiled.js"),
    input.compiledJavaScript,
    "utf-8",
  );
  writeJson(path.join(versionDir, "validation.json"), input.validation);
  writeJson(path.join(versionDir, "critic.json"), input.critic);
  writeJson(path.join(versionDir, "tests.json"), input.tests);
  if (input.tests.browser?.previewMatrixReceipt) {
    writeJson(
      path.join(versionDir, "preview-matrix.json"),
      input.tests.browser.previewMatrixReceipt,
    );
  }
  writeJson(path.join(versionDir, "lifecycle.json"), input.lifecycle);
  if (input.previewPath && externalRuntimePathExists(input.previewPath)) {
    externalRuntimeCopyFile(input.previewPath, path.join(versionDir, "preview.png"));
  }
  copyArtifactFiles(versionDir, dir);
  writeJson(path.join(dir, "current.json"), {
    id: input.manifest.id,
    version: input.manifest.version,
    manifest: `versions/${input.manifest.version}/manifest.json`,
  });
  updateGeneratedVisualIndex(input.gardenDir, input.manifest);
}

function updateGeneratedVisualIndex(
  gardenDir: string,
  manifest: GeneratedVisualizationManifest,
): void {
  const indexPath = path.join(gardenDir, ".breadboard", "visual-index.json");
  let index: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(externalRuntimeReadUtf8(indexPath));
    if (isRecord(parsed)) index = parsed;
  } catch {
    index = {};
  }
  index[manifest.id] = {
    id: manifest.id,
    kind: "generated_module",
    pageSlug: manifest.targetPage.replace(/\.md$/i, ""),
    type: "generated_module",
    title: manifest.title,
    version: manifest.version,
    updatedAt: manifest.generatedAt,
    artifactPath: manifest.artifactPath,
    sourceHash: manifest.sourceHash,
    compiledHash: manifest.compiledHash,
    learningUnitId: manifest.learningUnitId,
    opportunityId: manifest.id,
  };
  writeJson(indexPath, index);
}

export function loadGeneratedVisualManifest(
  gardenDir: string,
  id: string,
  version?: number,
): GeneratedVisualizationManifest | null {
  try {
    const dir = generatedVisualArtifactDir(gardenDir, id);
    const filePath = version
      ? path.join(dir, "versions", String(version), "manifest.json")
      : path.join(dir, "manifest.json");
    const parsed = JSON.parse(externalRuntimeReadUtf8(filePath));
    return validateGeneratedVisualizationManifest(parsed, id).manifest;
  } catch {
    return null;
  }
}

export function loadGeneratedVisualDefinition(
  gardenDir: string,
  id: string,
  version?: number,
): GeneratedVisualizationDefinition | null {
  try {
    const dir = generatedVisualArtifactDir(gardenDir, id);
    const compiledPath = version
      ? path.join(dir, "versions", String(version), "compiled.js")
      : path.join(dir, "compiled.js");
    const sourcePath = version
      ? path.join(dir, "versions", String(version), "source.tsx")
      : path.join(dir, "source.tsx");
    const manifest = loadGeneratedVisualManifest(gardenDir, id, version);
    if (!manifest) return null;
    const source = externalRuntimeReadUtf8(sourcePath);
    if (sha256(source) !== manifest.sourceHash) return null;
    const compiled = externalRuntimeReadUtf8(compiledPath);
    if (sha256(compiled) !== manifest.compiledHash) return null;
    const prefix =
      "globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(";
    const suffix = ");\n";
    if (!compiled.startsWith(prefix) || !compiled.endsWith(suffix)) return null;
    const parsed = JSON.parse(compiled.slice(prefix.length, -suffix.length));
    return validateGeneratedVisualizationDefinition(parsed).definition;
  } catch {
    return null;
  }
}

function readGeneratedVisualArtifactJson(
  filePath: string,
): unknown | null {
  try {
    return JSON.parse(externalRuntimeReadUtf8(filePath));
  } catch {
    return null;
  }
}

function generatedVisualManifestMatchesOpportunity(
  manifest: GeneratedVisualizationManifest,
  opportunity: VisualizationOpportunity,
  model: string,
): boolean {
  const same = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);
  return (
    manifest.status === "published" &&
    manifest.generatorModel === model &&
    manifest.id === opportunity.id &&
    manifest.gardenId === opportunity.gardenId &&
    manifest.learningUnitId === opportunity.learningUnitId &&
    manifest.learningObjective === opportunity.learningObjective &&
    manifest.insertionAnchor === opportunity.insertionAnchor &&
    manifest.targetPage === opportunity.targetPage &&
    manifest.targetHeading === opportunity.targetHeading &&
    manifest.similarityFingerprint === opportunity.similarityFingerprint &&
    same(manifest.conceptIds, opportunity.conceptIds) &&
    same(manifest.sourceAnchorIds, opportunity.sourceAnchorIds) &&
    same(manifest.sourceVisualIds, opportunity.sourceVisualIds) &&
    same(
      manifest.sourceVisualRelationships,
      opportunity.sourceVisualRelationships,
    )
  );
}

function generatedVisualPublicationEvidenceIsReusable(input: {
  artifactDir: string;
  requireBrowserEvidence: boolean;
}): boolean {
  const validation = readGeneratedVisualArtifactJson(
    path.join(input.artifactDir, "validation.json"),
  );
  const tests = readGeneratedVisualArtifactJson(
    path.join(input.artifactDir, "tests.json"),
  );
  const critic = readGeneratedVisualArtifactJson(
    path.join(input.artifactDir, "critic.json"),
  );
  const lifecycle = readGeneratedVisualArtifactJson(
    path.join(input.artifactDir, "lifecycle.json"),
  );
  if (
    !isRecord(validation) ||
    validation.valid !== true ||
    !Array.isArray(validation.errors) ||
    validation.errors.length !== 0 ||
    !isRecord(tests) ||
    tests.passed !== true ||
    !isRecord(critic) ||
    critic.approved !== true ||
    !Array.isArray(lifecycle)
  ) {
    return false;
  }
  const testGroups = [tests.staticTests, tests.semanticTests, tests.runtimeTests];
  if (
    testGroups.some(
      (group) =>
        !Array.isArray(group) ||
        group.some((entry) => !isRecord(entry) || entry.passed !== true),
    )
  ) {
    return false;
  }
  const lifecycleStatuses = lifecycle.flatMap((entry) =>
    isRecord(entry) && typeof entry.status === "string" ? [entry.status] : [],
  );
  if (
    !lifecycleStatuses.includes("critic_approved") ||
    !lifecycleStatuses.includes("published")
  ) {
    return false;
  }
  if (!input.requireBrowserEvidence) return true;
  const browser = tests.browser;
  return (
    isRecord(browser) &&
    browser.screenshotCreated === true &&
    browser.previewMatrixComplete === true &&
    Array.isArray(browser.mountReceipts) &&
    browser.mountReceipts.length > 0 &&
    browser.mountReceipts.every(
      (receipt) => isRecord(receipt) && receipt.mounted === true,
    ) &&
    isRecord(browser.profileCleanup) &&
    browser.profileCleanup.confirmed === true
  );
}

function loadReusablePublishedGeneratedVisual(input: {
  gardenDir: string;
  opportunity: VisualizationOpportunity;
  model: string;
  availableSourceAnchorIds?: Set<string>;
  requireBrowserEvidence: boolean;
}): GeneratedVisualResult | null {
  const { gardenDir, opportunity } = input;
  const manifest = loadGeneratedVisualManifest(gardenDir, opportunity.id);
  if (
    !manifest ||
    !generatedVisualManifestMatchesOpportunity(
      manifest,
      opportunity,
      input.model,
    ) ||
    (input.availableSourceAnchorIds &&
      manifest.sourceAnchorIds.some(
        (sourceAnchorId) =>
          !input.availableSourceAnchorIds?.has(sourceAnchorId),
      ))
  ) {
    return null;
  }
  const artifactDir = generatedVisualArtifactDir(gardenDir, opportunity.id);
  const versionDir = path.join(
    artifactDir,
    "versions",
    String(manifest.version),
  );
  const current = readGeneratedVisualArtifactJson(
    path.join(artifactDir, "current.json"),
  );
  const versionManifest = loadGeneratedVisualManifest(
    gardenDir,
    opportunity.id,
    manifest.version,
  );
  if (
    !isRecord(current) ||
    current.id !== opportunity.id ||
    current.version !== manifest.version ||
    current.manifest !== `versions/${manifest.version}/manifest.json` ||
    !versionManifest ||
    JSON.stringify(versionManifest) !== JSON.stringify(manifest) ||
    !generatedVisualPublicationEvidenceIsReusable({
      artifactDir,
      requireBrowserEvidence: input.requireBrowserEvidence,
    }) ||
    !generatedVisualPublicationEvidenceIsReusable({
      artifactDir: versionDir,
      requireBrowserEvidence: input.requireBrowserEvidence,
    })
  ) {
    return null;
  }
  const definition = loadGeneratedVisualDefinition(
    gardenDir,
    opportunity.id,
  );
  const versionDefinition = loadGeneratedVisualDefinition(
    gardenDir,
    opportunity.id,
    manifest.version,
  );
  if (
    !definition ||
    !versionDefinition ||
    JSON.stringify(versionDefinition) !== JSON.stringify(definition)
  ) {
    return null;
  }
  return { manifest, definition, errors: [] };
}

function generatedCandidateSchema() {
  return {
    name: "breadboard_generated_visual_candidate",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "explanation",
        "sourceCode",
        "testCases",
        "accessibilityDescription",
        "pedagogicalClaims",
      ],
      properties: {
        title: { type: "string" },
        explanation: { type: "string" },
        sourceCode: { type: "string" },
        accessibilityDescription: { type: "string" },
        pedagogicalClaims: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
        },
        testCases: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "inputs", "expected", "tolerance"],
            properties: {
              name: { type: "string" },
              inputs: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "value"],
                  properties: {
                    id: { type: "string" },
                    value: {
                      anyOf: [
                        { type: "number" },
                        { type: "string" },
                        { type: "boolean" },
                      ],
                    },
                  },
                },
              },
              expected: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "value"],
                  properties: {
                    id: { type: "string" },
                    value: {
                      anyOf: [
                        { type: "number" },
                        { type: "string" },
                        { type: "boolean" },
                      ],
                    },
                  },
                },
              },
              tolerance: { type: ["number", "null"] },
            },
          },
        },
      },
    },
  };
}

export function validateGeneratedVisualizationCandidateEnvelope(
  value: unknown,
  tokenUsage?: GeneratedVisualTokenUsage,
): { candidate: GeneratedVisualizationCandidate | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value))
    return { candidate: null, errors: ["candidate must be one JSON object"] };
  const requiredFields = [
    "title",
    "explanation",
    "sourceCode",
    "testCases",
    "accessibilityDescription",
    "pedagogicalClaims",
  ];
  for (const field of Object.keys(value)) {
    if (!requiredFields.includes(field))
      errors.push(`candidate.${field} is not supported`);
  }
  for (const field of [
    "title",
    "explanation",
    "sourceCode",
    "accessibilityDescription",
  ] as const) {
    if (typeof value[field] !== "string" || !value[field].trim())
      errors.push(`candidate.${field} is required`);
  }
  const pedagogicalClaims = Array.isArray(value.pedagogicalClaims)
    ? value.pedagogicalClaims
    : [];
  if (!Array.isArray(value.pedagogicalClaims))
    errors.push("candidate.pedagogicalClaims must be an array");
  else {
    if (pedagogicalClaims.length > 20)
      errors.push("candidate.pedagogicalClaims supports at most 20 items");
    pedagogicalClaims.forEach((claim, index) => {
      if (typeof claim !== "string" || !claim.trim()) {
        errors.push(
          `candidate.pedagogicalClaims[${index}] must be a non-empty string`,
        );
      }
    });
  }

  const rawTestCases = Array.isArray(value.testCases) ? value.testCases : [];
  if (!Array.isArray(value.testCases))
    errors.push("candidate.testCases must be an array");
  else if (rawTestCases.length > 20)
    errors.push("candidate.testCases supports at most 20 items");
  const testCases: GeneratedVisualizationTestCase[] = [];
  rawTestCases.slice(0, 20).forEach((item, testIndex) => {
    const pathLabel = `candidate.testCases[${testIndex}]`;
    if (!isRecord(item)) {
      errors.push(`${pathLabel} must be an object`);
      return;
    }
    for (const field of Object.keys(item)) {
      if (!["name", "inputs", "expected", "tolerance"].includes(field)) {
        errors.push(`${pathLabel}.${field} is not supported`);
      }
    }
    if (typeof item.name !== "string" || !item.name.trim())
      errors.push(`${pathLabel}.name is required`);
    if (
      !(item.tolerance === null || asFiniteNumber(item.tolerance) !== undefined)
    ) {
      errors.push(`${pathLabel}.tolerance must be a finite number or null`);
    }
    const parseEntries = (
      field: "inputs" | "expected",
    ): Record<string, unknown> => {
      const entries = item[field];
      if (!Array.isArray(entries)) {
        errors.push(`${pathLabel}.${field} must be an array`);
        return {};
      }
      if (entries.length > 20)
        errors.push(`${pathLabel}.${field} supports at most 20 items`);
      const ids = new Set<string>();
      const pairs: Array<[string, unknown]> = [];
      entries.slice(0, 20).forEach((entry, entryIndex) => {
        const entryPath = `${pathLabel}.${field}[${entryIndex}]`;
        if (!isRecord(entry)) {
          errors.push(`${entryPath} must be an object`);
          return;
        }
        for (const key of Object.keys(entry)) {
          if (!["id", "value"].includes(key))
            errors.push(`${entryPath}.${key} is not supported`);
        }
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!id || ids.has(id))
          errors.push(`${entryPath}.id is missing or duplicate`);
        else ids.add(id);
        if (
          typeof entry.value !== "number" &&
          typeof entry.value !== "string" &&
          typeof entry.value !== "boolean"
        ) {
          errors.push(
            `${entryPath}.value must be a number, string, or boolean`,
          );
        } else if (
          typeof entry.value === "number" &&
          !Number.isFinite(entry.value)
        ) {
          errors.push(`${entryPath}.value must be finite`);
        }
        if (id) pairs.push([id, entry.value]);
      });
      return Object.fromEntries(pairs);
    };
    const inputs = parseEntries("inputs");
    const expected = parseEntries("expected");
    testCases.push({
      name: typeof item.name === "string" ? item.name : "",
      inputs,
      expected,
      ...(typeof item.tolerance === "number"
        ? { tolerance: item.tolerance }
        : {}),
    });
  });
  if (errors.length > 0)
    return { candidate: null, errors: [...new Set(errors)] };
  return {
    candidate: {
      title: String(value.title),
      explanation: String(value.explanation),
      sourceCode: String(value.sourceCode),
      testCases,
      accessibilityDescription: String(value.accessibilityDescription),
      pedagogicalClaims: pedagogicalClaims as string[],
      ...(tokenUsage ? { tokenUsage } : {}),
    },
    errors: [],
  };
}

async function requestGeneratedVisualizationCandidateRaw(input: {
  client: OpenAI;
  model: string;
  opportunity: VisualizationOpportunity;
  pageMarkdown: string;
  sourceContext?: unknown;
  sourceFigureSummaries?: unknown[];
  formulaDefinitions?: unknown[];
  previousSourceCode?: string;
  previousCandidate?: GeneratedVisualizationCandidate;
  repairHistory?: GeneratedVisualRepairHistoryEntry[];
  previews?: GeneratedVisualPreviewArtifact[];
  errors?: string[];
  councilRecovery?: GeneratedVisualCouncilRecoveryBoundary;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  tokenUsage?: GeneratedVisualTokenUsage;
}> {
  const validModuleTemplate = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: ${GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion},
  sdkVersion: "${GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion}",
  title: "Parameter relationship",
  description: "Move the parameter to inspect the source-backed relationship.",
  accessibilityDescription: "A labelled slider changes a finite value and a plotted curve. Reset restores the documented default.",
  controls: [{ id: "gain", kind: "variable", label: "Gain", type: "slider", min: 0, max: 2, step: 0.1, defaultValue: 1 }],
  outputs: [{ id: "result", label: "Result", representation: "value", expression: { kind: "binary", op: "multiply", left: { kind: "input", id: "gain" }, right: { kind: "constant", value: 2 } } }],
  scenes: [
    { kind: "plot", title: "Response", xLabel: "Input", yLabel: "Output", xMin: 0, xMax: 10, samples: 80, series: [{ id: "response", label: "Response", expression: { kind: "binary", op: "multiply", left: { kind: "input", id: "gain" }, right: { kind: "input", id: "x" } } }] }
  ]
});`;
  const spatialModuleTemplate = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: ${GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion},
  sdkVersion: "${GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion}",
  title: "Spatial case comparison",
  description: "Choose a case to inspect model-authored geometry in one stable spatial frame.",
  accessibilityDescription: "A labelled selector changes which spatial construction is visible. Drag or use the arrow keys to orbit the perspective view, use wheel or plus and minus to zoom, and use Home or Reset to restore it. Every object also appears in a text legend with its geometric type and pattern.",
  controls: [{ id: "case_mode", kind: "select_case", label: "Case", type: "select", options: ["Case A", "Case B"], defaultValue: "Case A" }],
  outputs: [{ id: "case_view", label: "Selected construction", representation: "diagram" }],
  scenes: [{
    kind: "spatial",
    title: "Construction",
    view: { azimuthDegrees: 35, elevationDegrees: 24, scale: 1, projection: "perspective", interaction: "orbit" },
    groups: [
      { id: "fixed-items", label: "Common", primitives: [
        { kind: "point", id: "fixed-point", label: "Fixed point", position: [1, 1, 1], color: "red" },
        { kind: "vector", id: "unit-x-direction", label: "Unit x direction", from: [0, 0, 0], to: [1, 0, 0], color: "gray" }
      ] },
      { id: "case-a", label: "Case A", visibleWhen: { kind: "conditional", comparison: "eq", left: { kind: "input", id: "case_mode" }, right: { kind: "constant", value: 0 }, whenTrue: { kind: "constant", value: 1 }, whenFalse: { kind: "constant", value: 0 } }, primitives: [
        { kind: "plane", id: "sample-plane", label: "Plane", center: [0, 0, 0], normal: [0, 0, 1], size: 4, color: "blue", pattern: "striped" },
        { kind: "polygon", id: "sample-patch", label: "Clipped surface patch", points: [[0, 0, -1], [3, 0, -1], [3, 0, 1], [0, 0, 1]], color: "cyan", pattern: "dotted" }
      ] },
      { id: "case-b", label: "Case B", visibleWhen: { kind: "conditional", comparison: "eq", left: { kind: "input", id: "case_mode" }, right: { kind: "constant", value: 1 }, whenTrue: { kind: "constant", value: 1 }, whenFalse: { kind: "constant", value: 0 } }, primitives: [
        { kind: "sphere", id: "sample-sphere", label: "Sphere", center: [0, 0, 0], radius: 2, color: "green", pattern: "dotted" },
        { kind: "cylinder", id: "sample-cylinder", label: "Cylinder", center: [0, 0, 0], axis: [0, 0, 1], radius: 1, height: 4, color: "amber", pattern: "crosshatch" },
        { kind: "cone", id: "sample-cone", label: "Cone", apex: [0, 0, -2], axis: [0, 0, 1], radius: 1.5, height: 4, color: "violet", pattern: "solid" }
      ] }
    ]
  }]
});`;
  const system =
    `Create one declarative Breadboard generated visualization using SDK ${VISUAL_SDK_VERSION}. ` +
    "Reply with one JSON object and nothing else. It must have exactly these six fields: " +
    '{"title":<non-empty string>,"explanation":<non-empty string>,"sourceCode":<complete module string>,"testCases":[{"name":<non-empty string>,"inputs":[{"id":<string>,"value":<number|string|boolean>}],"expected":[{"id":<string>,"value":<number|string|boolean>}],"tolerance":<finite number|null>}],"accessibilityDescription":<non-empty string>,"pedagogicalClaims":[<non-empty string>,...]}. ' +
    "Do not omit title, explanation, accessibilityDescription, or pedagogicalClaims even when a Council wrapper does not enforce response_format. The top-level accessibilityDescription and definition.accessibilityDescription must agree on a concrete non-visual walkthrough rather than merely asserting accessibility. " +
    "Match the in-chat interactive visualizer presentation: one concise title, then one dominant plot, diagram, spatial model, animation, timeline, or table, then at most one compact result strip, then only the reviewed controls. The visible interface must fit the concept instead of looking like a lesson, report, or dashboard. Keep definition.description to one short sentence for screen readers; the runtime does not show it. The surrounding Learn page owns the explanation, so do not add annotation or formula scenes, prose panels, help copy, repeated definitions, implementation commentary, a reset-status scene, or secondary scenes that merely restate the same relationship. Prefer exactly one scene. A second scene is allowed only when it is the single compact dynamic status needed to understand the interaction. This visual-first minimal-text contract takes precedence over later examples of supplementary formula, annotation, table, or status scenes. " +
    `sourceCode must contain exactly ` +
    `import { defineVisualization } from "${SDK_IMPORT}"; followed by export default defineVisualization({...}). ` +
    "The argument must be one JSON-compatible object literal: no functions, variables, JSX, spreads, computed properties, callbacks, loops, classes, timers, browser globals, HTML, URLs, or package imports. " +
    `Use schemaVersion ${GENERATED_VISUAL_CAPABILITY_MANIFEST.definitionSchemaVersion} and sdkVersion ${GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion}. The definition needs title, description, accessibilityDescription, controls, outputs, and scenes. Its accessibilityDescription must be a standalone non-visual walkthrough that names the labelled learner action, observable result, default and alternate states, and each scene's legend or ARIA representation; when spatial orbit is authored, include its keyboard navigation and Reset behavior. ` +
    "Every expression uses the field kind (never type); binary and unary expressions use op (never operator), and a unary expression stores its child in argument (never value). " +
    `Every output uses representation (never type or value). Its optional expression is the derived value. output.representation is metadata and does not force scene.kind: a spatial scene may satisfy a diagram or animation output. ${GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.numericExpressionOptionalFor.join(", ")} outputs may omit output.expression when their observable is nonnumeric; never expose a select option index as an output merely to satisfy influence. ` +
    "A plot uses xMin, xMax, samples, xLabel, yLabel and series[].expression; it never uses axes or explicit point arrays. Its source-authored xLabel and yLabel are visible SVG text, so each must be concise, source-grounded, and fully legible inside every supplied mobile and desktop plot frame; put supplementary equation detail in an annotation or formula scene instead of clipping or truncating an axis label. " +
    "A diagram is only a 2D node-link graph. A diagram node requires id, label, x, and y; node.value is omitted unless it represents a genuinely meaningful numeric quantity. Never use node.value for selection styling or visibility, and never use diagram nodes as substitutes for physical surfaces or solids. A diagram edge may use strength as an authored numeric expression; the runtime renders abs(strength) clamped to 0.5-6 as stroke width. When opportunity.learnerAction promises a selected, highlighted, emphasized, or distinguished branch in a persistent diagram, retain every node and edge in one diagram scene and use conditional edge.strength expressions keyed to the exact select index. Every single option must have an exclusive emphasized branch, every combined/both/all/sum/total/+ option must emphasize the union of those branches, and all options must produce pairwise-distinct rendered edge-width signatures. A diagram renders in a 640 by 360 frame: keep a sparse, generously separated layout, use short edge labels, and remember that each edge label appears at its edge midpoint. Do not place another node or label near that midpoint, and never author parallel or reverse labelled edges that share an endpoint pair because their labels stack at the same midpoint. Use at most one short conceptual relationship label per endpoint pair; put equations, ratios, equality signs, and other wide formula text in an annotation or formula scene so every node and edge label remains legible on desktop and narrow mobile previews. For a text-bearing mobile diagram, design inside the conservative interior x=112-528 and y=72-288 rather than merely satisfying the wider schema bounds, keep at most three text-bearing nodes in a shared horizontal or vertical band, and reserve at least 80 SVG units from every text-bearing node center to a frame edge. Do not pack a long symbolic label, a numeric value, and edge prose into one small node: use one short identifier plus at most one concise numeric readout, or move the number to a value, status, plot, formula, or annotation scene. At every default, changed-control, and Reset state, each rendered node label and tspan must fit inside its actual SVG node footprint; prefer a 1-6-character identifier in a node and move full phrases, equations, step descriptions, and live values outside the graph when they cannot fit. Do not encode a dense physical grid as a diagram; show a compact representative stencil and explain repeated steps or ratios outside the graph. " +
    "Diagram source coordinates are strictly validated at x=72-568 and y=48-312 because those are the renderer's non-clamped limits. The renderer will not repair an out-of-range authored coordinate for publication; for text-bearing mobile diagrams, use the conservative x=112-528 and y=72-288 interior already specified above. " +
    "A value scene contains kind and outputId. A formula/annotation scene contains kind, title, and text. A timeline scene is exactly {kind:\"timeline\",title,progressInput,steps:[{id,label,description,at},...]}; it needs 2-30 ordered steps, and progressInput must exactly equal one of the declared reviewed control ids. There is no implicit progress, time, step, or output input: when the reviewed controls do not provide an appropriate progress control, use another supported scene instead of inventing one. " +
    `Expression kinds are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.kinds.join(", ")}. Binary operators are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.binaryOperators.join("/")}; unary operators are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.unaryOperators.join("/")}. A conditional is exactly {kind, comparison, left, right, whenTrue, whenFalse}; comparison is one of ${GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.comparisons.join("/")}. Never use condition/then/else or min/max as a binary op. Every expression has hard limits of ${MAX_EXPRESSION_DEPTH} nested levels and ${MAX_EXPRESSION_NODES} nodes; target at most 6 nested levels and 40 nodes. In a spatial coordinate, use a literal, an input, or a one-operation expression only; never paste a full derived calculation into from, to, position, center, normal, axis, or polygon points. Put longer calculations in an output, plot, status, or formula scene and use simple geometry to illustrate their result. Before returning sourceCode, check it as one complete module: every object/array delimiter is balanced, every property and array item has its comma, and the default export is exactly defineVisualization({ ...literal definition... }). Diagram node.value is normally omitted; when it represents a genuinely meaningful numeric quantity, use only {kind:"constant",value:<finite>}, {kind:"input",id:<known control>}, or a one-operation expression, never a bare numeric value such as value: 1. Put longer derivations in an output, plot, status, or formula scene, never in a diagram node value. ` +
    `Scene kinds are ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds.join(", ")}. Use only these exact field names. ` +
    `Use spatial for physical geometry. A spatial scene is exactly {kind:"spatial",title,view?:{azimuthDegrees?,elevationDegrees?,scale?,projection?:"orthographic"|"perspective",interaction?:"fixed"|"orbit"},groups:[{id,label,visibleWhen?,primitives:[...]}]}; authored view values must be literal finite numbers within azimuthDegrees -180..180, elevationDegrees -85..85, and scale 0.25..2. Every spatial group and primitive label must be a concise nonempty 1-72-character string. It supports 1-${MAX_SPATIAL_GROUPS} groups, 1-${MAX_SPATIAL_PRIMITIVES_PER_GROUP} primitives per group, and ${MAX_SPATIAL_PRIMITIVES} total. ` +
    `A spatial primitive has kind,id,label,color?,pattern?,labelMode?,opacity?,visibleWhen? plus kind fields: plane(center,normal,size), polygon(points with 3-${MAX_SPATIAL_POLYGON_POINTS} coplanar non-collinear SpatialVectors in boundary order), sphere(center,radius), cylinder(center,axis,radius,height), cone(apex,axis,radius,height), point(position,size?), or vector(from,to,headSize?). labelMode defaults to "inline"; use "legend_only" for dense supporting primitives when the required visible legend and accessible object description are clearer than an on-canvas label. The label remains required and is still rendered in the legend and ARIA. Authored opacity, when present, must be a literal finite number between 0.1 and 1. A vector primitive is a finite directed segment from from to to; its label, explanation, and accessibility description must not call it an unbounded line, ray, or axis. ` +
    "authorEvidence.spatialRepresentationRequirement is the reviewed route constraint after final learner-action precedence. Its required field, not a stale necessity score or earlier rationale, is authority. When required is true, include an actual spatial scene with source-grounded physical primitives; do not replace that geometry with a diagram node-link graph, flowchart, state-transition graph, or plot. When requiresSurfacePrimitive is true, include a spatial surface primitive; when requiresVectorPrimitive is true, include a spatial vector primitive. Those primitives must teach the reviewed relationship itself, not serve as decorative additions. When required is false and the final action explicitly asks for a node-link dependency diagram, do not resurrect superseded physical orientation geometry. " +
    "A plane is a centered full rectangular patch extending to both sides of its center. A polygon is a bounded filled surface patch whose points trace one non-self-intersecting boundary. Use ordered polygon vertices, not plane, whenever the visible surface must be clipped, sector-shaped, one-sided, triangular, or a half-plane patch; never describe a plane primitive as a half-plane or clipped patch. Cylinder and cone primitives are bounded capped closed solids; never use either when the claim requires an open, uncapped, clipped, one-sided, or sector surface. For those claims, use one or more ordered polygon facets and describe the result honestly as a bounded faceted, local, or tangent approximation when appropriate. Whenever a named-point normal, tangent, or basis-direction claim refers to a displayed planar, faceted, or local surface patch, audit the literal plane or polygon geometry: the named point must be in the relative interior of its face, never on an edge, vertex, seam, or cap, and its actual face normal must be parallel or antiparallel to the claimed vector. A label never corrects a geometric mismatch. " +
    "For any named-point normal/tangent/basis claim, do the literal geometry calculation before authoring prose: a point must be strictly inside one displayed face, and for a polygon its ordered-vertex cross product (p1-p0) x (p2-p0) must be parallel or antiparallel to the claimed vector. A shared facet edge, seam, vertex, cap, or an off-point chord is never evidence for a local curved-surface normal. When the source calls for a local curved normal, render a tangent plane or bounded tangent polygon containing the named point in its interior and describe it honestly as a local/tangent approximation. " +
    "Every spatial vector is exactly three SpatialScalars. A SpatialScalar is a finite number or any valid expression, including input or t for dynamic geometry. visibleWhen is an expression; the group or primitive is visible only when it evaluates above zero. Normals, axes, and vectors must be non-zero; sizes, radii, heights, point sizes, and head sizes must stay positive. Do not call a direction vector unit or normalized by implication: from:[0,0,0] to:[1,0,0] has magnitude 1, while to:[1,1,1] has magnitude sqrt(3); evaluate the actual endpoint delta in every rendered state. " +
    `Hard compilation budget: AST node count must not exceed ${MAX_AST_NODES}; target at most ${Math.floor(MAX_AST_NODES * 0.64)} nodes and roughly 10,000 sourceCode bytes so later edits retain margin. Repeated expression-backed polygon vertices and vectors consume this budget quickly. For a changing axis-aligned rectangular volume, six plane faces (literal normal, one dynamic center component, dynamic scalar size) are the compact faithful representation; do not build the same box from six four-vertex expression-heavy polygons unless you have verified the literal source stays within the AST target. Every vector from and to must be written as exactly three [x, y, z] entries, including zero components. ` +
    `Spatial colors are only ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.palette.join(", ")}. Patterns are only ${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.patterns.join(", ")}. projection and interaction are model-authored presentation fields, never inferred semantics or additional learner controls. If either is omitted, the legacy default is projection:"${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.defaults.projection}" and interaction:"${GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.defaults.interaction}". Author perspective when depth foreshortening materially clarifies the source-grounded geometry; author orbit only when changing viewpoint improves the stated learning action, and describe its drag, wheel, keyboard, Home, and Reset operation in accessibilityDescription. The runtime supplies stable full-domain world framing, deterministic depth ordering, safe patterns, object labels, and an accessible text legend; author the actual geometry, camera mode, and relationships in the module. A spatial primitive label must name that rendered primitive itself: distinguish scalar values, basis/reference vectors, and component-displacement vectors in labels, legend, explanation, and accessibility description. Every non-structural scalar or symbol that represents a physical or conceptual quantity in a scene, output, formula, label, or explanation must be source-grounded and visibly introduced with its symbol, value, unit when applicable, and role; only pure rendering coordinates with no physical or conceptual claim may remain unlabelled. Do not hide a learner-relevant interval or scale as a bare coordinate or expression literal: give it a named display in a formula/annotation, diagram, plot, or status scene without adding planner-owned controls or outputs. Screen-left/right/top/bottom are presentation-dependent, not world geometry: do not make a screen-relative placement claim in a label, explanation, accessibility description, or pedagogical claim unless every relevant labelled preview for its exact viewport and select state proves it. When placement is not source-essential, name the geometry, selector case, or world-coordinate relationship instead. Choose geometry, view, and concise labels so every required object, endpoint, and label remains fully visible and non-overlapping in ordinary desktop and narrow mobile previews; use only sourceCode-controlled fields to achieve that fit. Use group visibleWhen for selector cases so all cases share one stable authored-world frame. ` +
    "Projection overlap is a hard failure even when world coordinates differ: choose the authored camera so named source-essential points, vector arrowheads, endpoints, and inline labels remain visibly separated in every exact desktop and narrow-mobile state. Adjust camera before physical geometry; for a crowded supporting primitive use labelMode:\"legend_only\" rather than CSS, and only alter an illustrative/normalized display envelope when the source supports it. " +
    "For a spatial visual, its first rendered spatial scene with primitives is the primary narrow-mobile preview scene: place it ahead of supporting plot, formula, annotation, status, or secondary-scene content and keep its full projection SVG in the initial 375x667 document viewport. An SVG-local safe frame is not sufficient when document ordering or vertical footprint pushes the scene below the preview; correct scene order, preamble, camera, or geometry in sourceCode rather than CSS, scrolling instructions, or runtime auto-fit. A spatial vector endpoint delta is quantitative, not a silent fit transform: either derive it from the same source-grounded relationship represented by required outputs, plots, markers, formulas, and statuses, or visibly define a unitless display-scale factor and state that the vector is illustrative/normalized. Never leave an arbitrary unmentioned multiplier to make an on-canvas field length look like a plotted physical magnitude. " +
    "The sandbox rejects a spatial primitive or inline label whose actual projected box leaves the safe SVG frame, including vector arrowheads and label strokes. Fit this by choosing a conservative literal scene.view.scale (and, only when needed, azimuth/elevation or literal geometry); do not expect runtime auto-fit, CSS, or a label rename to repair a camera-frame failure. " +
    'A status scene is exactly {kind:"status",title,value,threshold,belowLabel,equalLabel,aboveLabel,description?}; threshold is required and must be a literal finite number in sourceCode (for example threshold: 0), never an expression, string, null, NaN, or Infinity; value may be an expression. Use it for a current textual state instead of numeric status codes. Its title and state labels render in a narrow text panel: keep them short natural-language strings with ordinary word-break opportunities that fit at 375px, and put equations, ratios, or long technical tokens in description or a formula scene. ' +
    "A plot may include markers:[{id,label,x,y,color?}] with expression-valued x/y; use a marker for the selected point and never fake a point as a sparse line series. " +
    "Diagram node coordinates must remain within x=72-568 and y=48-312 and labels must be concise; the narrower mobile-safe authoring envelope above is the expected layout target for text-bearing nodes. " +
    "Each testCases item represents inputs and expected as arrays of {id,value} pairs and includes tolerance (number or null). " +
    `Every control id must match ${CONTROL_ID_PATTERN.source}; ${[...RESERVED_CONTROL_IDS].join(", ")} are reserved runtime expression variables and cannot be learner controls. ` +
    "Implement opportunity.interactionGoal and opportunity.learnerAction as the artifact's actual interaction sequence, not merely as labels or explanatory prose. When the reviewed action asks to simulate, iterate, relax, converge, evolve, or step through a process, a static closed-form ratio is not the interaction: author definition.animation:{durationMs,loop,autoplay} and use the reserved runtime expression {kind:\"input\",id:\"t\"} in at least one actual numeric output or scene expression so Play and Step reveal distinct source-grounded initial, intermediate, and settled stages. Do not add t as a learner control, invent a solver or hidden history, or claim literal numerical iteration when only illustrative or normalized stages are evidence-supported. For test_prediction, require the learner to commit a prediction before the artifact reveals or evaluates the outcome; use the exact protocolRole fields from the reviewed controls and author the required outcome expression or scene visibleWhen so it is unchanged initially, after prediction input, after unauthorized reveal/evaluate without commitment, and after commit alone; it must change only after valid commit_prediction then reveal_outcome/evaluate_prediction. Gate that observable with both authored action controls, not commit alone or reveal alone. The trusted runtime derives sequencing only from protocolRole: prediction_input stays editable until commit, commitment locks it, reveal/evaluate stays disabled and mutation-guarded until commit, and Reset clears and unlocks the sequence. Every decisive condition named by the reviewed interaction contract must be directly manipulable or evaluated by the artifact. " +
    "Copy the opportunity.requiredInputs array exactly and in order: same control count, id, kind, label, type, protocolRole, unit, min, max, step, options, and defaultValue. Do not add a control or a field the reviewed contract omits. The trusted runtime renders the dominant visual first, then compact numeric or status results, then every exact immutable control in reviewed order; sourceCode cannot and must not duplicate, reposition, or replace those controls. Copy opportunity.requiredOutputs exactly and in order: same output count, id, label, and representation; never add or reorder learner-visible outputs. Keep any runtime-internal derived values inside scene or output expressions rather than declaring extra outputs. Use only source-backed relationships. Label illustrative or normalized values clearly. Every required non-reset control must materially change a numeric output or scene expression. Before returning, verify this executable condition for each reviewed required non-reset control: from its default protocol-aware state, at least one allowed alternate control state must change by more than 1e-9 the evaluated value of an output.expression or numeric scene expression in sourceCode. A non-reset control that only changes labels, static diagram metadata, output representation, prose, accessibility text, or an otherwise constant expression fails; for select controls, use the declared zero-based option index in a numeric scene/output expression, including diagram edge.strength or spatial group or primitive visibleWhen. A control with protocolRole:\"reset\" is owned by the trusted runtime: preserve it exactly, never reference its id in an authored output or scene expression, and ensure at least one other reviewed control changes the visual so Reset has meaningful state to restore. " +
    "Before returning, perform a complete model-authored consistency check against the supplied evidence and the literal definition. Independently recompute every evaluable numeric or geometric relationship you authored: scalar values, signed directions, units and conversions, vector endpoint deltas and magnitudes, component-wise sums, resultants, and other aggregates. Make every coordinate, label, annotation, explanation, and accessibility statement agree at the authored precision. When a displayed direction is multiplied by an uncontrolled signed scalar, never call the underlying term direction the signed result or contribution direction without source-supported sign authority: either state a fixed-sign assumption visibly and non-visually plus what reverses for the opposite sign, or label only the unsigned/field term and explain the sign-dependent reversal. When a required output, plot series, plot marker, status, formula, or annotation displays a component, resultant, or magnitude of rendered vector contributions, derive it from those same literal endpoint deltas and carry the identical relationship through every representation; never leave a stale scaled or half-magnitude expression in one view. Perform a claim-to-primitive audit: whenever a label, explanation, or accessibility text calls a vector unit or normalized, its evaluated to-from Euclidean norm must be exactly 1 in every rendered state; whenever text identifies a primitive as a named point with coordinates, that primitive's evaluated position and any vector origin explicitly claimed at that point must equal those coordinates in every rendered state. For every named-point normal, tangent, or basis-direction claim about a displayed planar, faceted, or local surface patch, inspect the literal plane or polygon face rather than prose: the point must be in its relative interior, not an edge, vertex, seam, or cap, and the face normal must be parallel or antiparallel to the claimed vector. For every screen-relative left/right/top/bottom claim, perform a projection audit against the exact authored camera and each relevant labelled preview; if it is not proven in every claimed state and viewport, remove it or state a world-coordinate relationship instead. Do not solve a topology, geometry, or projection defect only by relabeling it. If a display vector or anchor is qualitative, do not call it unit/normalized or present it as a named source coordinate. If a total is claimed to be the sum of displayed contributions, its components must equal that displayed sum; do not hide a discrepancy behind rounding or prose. If displayed elements are representative samples of a larger or continuous domain, do not construct or imply the whole-domain aggregate as their exact finite subtotal unless the supplied evidence explicitly establishes that equality; distinguish the sample contribution and whole-domain result in the geometry as well as the labels and non-visual explanation. When the evidence does not supply enough information to evaluate a sign, magnitude, scale, or aggregate, use explicitly qualitative or normalized encoding and do not invent or claim an evaluated value. The compiler and renderer will not infer or repair any of these relationships for you. " +
    "A select control is exposed to expressions as the stable zero-based index of its option in the declared options array (0 for the first option, 1 for the second, and so on), while the interface displays the option label; use conditional expressions against those numeric indices. Group or primitive visibleWhen counts as scene influence, so do not add a meaningless numeric output for the select. " +
    "When repairContext is supplied, return a complete replacement candidate that addresses every exact history entry using only this candidate's six authored fields and the declared SDK. When authorEvidence.highPriorityRepairInstructions is present, follow every instruction by replacing the affected sourceCode structure, not by merely relabelling, describing, or partially editing the rejected module. Before returning, make an internal checklist from every exactErrors and exactHistory entry: revise the actual sourceCode fields implicated by all entries, not merely their labels, explanation, or the newest entry, and re-run the claim-to-primitive audit after those revisions. Its immutableContract controls and outputs are fixed by the reviewed planner: do not add, remove, rename, reorder, or request mutation of them, and do not rely on renderer, runtime, CSS, route, lesson, or planner changes. Use the labelled rendered previews only for the viewport and select state they identify; do not infer an unshown state or viewport. A preview that contradicts a screen-relative placement claim requires an authored geometry or claim correction, never a camera assumption. If previewCoverage.selectStateCoverageTruncated is true, the bounded matrix is not proof of complete or unshown select-state coverage. " +
    "Keep sourceCode below 16,000 bytes and prefer exactly one dominant scene; permit only one additional compact dynamic status scene when the interaction would otherwise be ambiguous. Prefer the smallest expression tree that teaches the objective. testCases should cover only simple derived outputs with numeric expectations you can compute exactly (an empty testCases array is allowed because Breadboard adds deterministic tests). " +
    "sourceCode must end immediately after the final ASCII semicolon; do not append Markdown fences, commentary, or non-ASCII punctuation. " +
    "FINAL NON-NEGOTIABLE SELF-CHECK BEFORE THE JSON RESPONSE: verify the literal sourceCode, not just its prose. sourceCode has exactly two top-level statements—the required import and export default defineVisualization({ ...literal definition... })—with no const/let/var/helper/config aliases, property shorthand, or bare JavaScript identifiers as values. Quote every string; represent a variable only through a literal SDK expression object such as {kind:\"input\",id:\"gain\"}. Recheck every authored numeric schema bound, every required non-reset control's alternate-state numeric influence, verify that a runtime-owned reset control is not referenced by any authored expression, and check every textual spatial claim against its evaluated primitive. When repairContext exists, close every exactErrors and exactHistory item by editing the actual sourceCode fields, then repeat this check. " +
    `This is a complete syntactically valid scalar/plot module template; follow its schema exactly:\n${validModuleTemplate}\n` +
    `This is a complete syntactically valid spatial module template; replace its generic labels and geometry with source-grounded content:\n${spatialModuleTemplate}`;
  if (
    (input.repairHistory?.length ?? 0) >
    GENERATED_VISUAL_REPAIR_HISTORY_MAX_ENTRIES
  ) {
    throw new Error("Generated visual repair history exceeded its semantic attempt ceiling");
  }
  const availablePreviews = availableGeneratedVisualPreviews(input.previews);
  const previewCoverage = {
    renderedPreviewCount: availablePreviews.length,
    selectStateCap: GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES,
    selectStateCoverageTruncated: availablePreviews.some(
      (preview) => preview.selectStateCoverageTruncated,
    ),
    policy:
      "Labelled previews are evidence only for their stated viewport and select state. A truncated select-state matrix is a deliberate bounded subset, never proof of an unrendered state or full state coverage.",
  };
  const repairContext =
    input.repairHistory?.length || input.errors?.length
      ? {
          // A repair is another model-authored revision. Preserve the complete
          // prior six-field candidate, every exact gate/critic entry, and the
          // identities of the rendered evidence; code never edits or
          // summarizes their semantic content.
          previousCandidate: input.previousCandidate
            ? generatedVisualizationCandidateRepairSnapshot(input.previousCandidate)
            : undefined,
          // Preserve this legacy packet shape for direct callers that only have
          // source text. Production retries use previousCandidate above.
          previousSourceCode: input.previousCandidate
            ? undefined
            : input.previousSourceCode,
          exactErrors: input.errors ? [...input.errors] : [],
          exactHistory: input.repairHistory
            ? generatedVisualRepairHistorySnapshot(input.repairHistory)
            : undefined,
          renderedPreviews: generatedVisualPreviewIdentities(availablePreviews),
          previewCoverage,
        }
      : undefined;
  const authorEvidence = {
    highPriorityRepairInstructions:
      generatedVisualHighPriorityRepairInstructions(input.errors),
    opportunity: input.opportunity,
    immutableContract: {
      requiredInputs: input.opportunity.requiredInputs,
      requiredOutputs: input.opportunity.requiredOutputs,
    },
    localTeachingText: input.pageMarkdown.slice(0, 14_000),
    sourceContext: boundedGeneratedVisualEvidence(input.sourceContext, 10_000),
    sourceFigureSummaries: boundedGeneratedVisualEvidence(
      input.sourceFigureSummaries?.slice(0, 10),
      8_000,
    ),
    formulaDefinitions: boundedGeneratedVisualEvidence(
      input.formulaDefinitions?.slice(0, 12),
      6_000,
    ),
    spatialRepresentationRequirement:
      reviewedSpatialRepresentationRequirement(input.opportunity),
    sdkDocumentation: {
      version: GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion,
      controlTypes: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.types,
      ],
      controlIdGrammar:
        GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.controlIds.grammar,
      reservedControlIds: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.controlIds.reserved,
      ],
      controlKinds: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds,
      ],
      controlProtocolRoles: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST
          .requiredContractControls.protocolRoles,
      ],
      outputTypes: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations,
      ],
      sceneTypes: [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds],
      spatialPrimitiveTypes: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.primitiveKinds,
      ],
      spatialLabelModes: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.labelModes,
      ],
      spatialProjectionTypes: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.projections,
      ],
      spatialInteractionTypes: [
        ...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.interactions,
      ],
      spatialViewDefaults:
        GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.defaults,
      maxControls: MAX_CONTROLS,
      maxSelectOptions: MAX_SELECT_OPTIONS,
      maxScenes: MAX_SCENES,
      maxSpatialGroups: MAX_SPATIAL_GROUPS,
      maxSpatialPrimitives: MAX_SPATIAL_PRIMITIVES,
      maxSpatialPolygonPoints: MAX_SPATIAL_POLYGON_POINTS,
    },
    repairContext,
  };
  const request = withCouncil(
    {
      model: input.model,
      messages: [
        { role: "system" as const, content: system },
        {
          role: "user" as const,
          content: availablePreviews.length
            ? [
                { type: "text" as const, text: JSON.stringify(authorEvidence) },
                ...generatedVisualPreviewImageParts(availablePreviews),
              ]
            : JSON.stringify(authorEvidence),
        },
      ],
      reasoning: GENERATED_VISUAL_COUNCIL_REASONING,
      max_completion_tokens: Math.max(
        1_000,
        Math.min(
          12_000,
          Number(
            process.env.LEARN_GENERATED_VISUAL_MAX_OUTPUT_TOKENS ?? 6_000,
          ) || 6_000,
        ),
      ),
      response_format: {
        type: "json_schema" as const,
        json_schema: generatedCandidateSchema(),
      },
    },
    {
      taskType: "visualization_generation",
      gardenId: input.opportunity.gardenId,
      pageId: input.opportunity.targetPage,
      sourceContext: input.sourceContext,
      councilModeOverride: "direct_council",
    },
  );
  if (input.councilRecovery) {
    const recovered = await runGeneratedVisualCouncilRequestWithReceipt({
      client: input.client as unknown as RunGeneratedVisualCouncilRequestInput["client"],
      durableRecoveryDir: input.councilRecovery.durableRecoveryDir,
      invocationKey: input.councilRecovery.invocationKey,
      recoveryMetadata: input.councilRecovery.metadata,
      request,
      allowImageUrlParts: availablePreviews.length > 0,
      startedReceiptObservationTimeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    input.councilRecovery.onReceipt?.(recovered);
    return { content: recovered.content, tokenUsage: recovered.tokenUsage };
  }
  const response = await input.client.chat.completions.create(request, {
    signal: input.signal,
    // Override the SDK's shorter default timeout with the same configured soft
    // deadline owned by the receipt-aware outer boundary. The outer signal
    // still owns the bounded late-result grace and terminal cancellation.
    timeout: input.timeoutMs,
    maxRetries: 0,
  });
  const content = response.choices[0]?.message?.content ?? "";
  const tokenUsage = generatedVisualTokenUsage(response.usage);
  return {
    content,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function parseGeneratedVisualizationCandidateRaw(input: {
  content: string;
  tokenUsage?: GeneratedVisualTokenUsage;
}): { candidate: GeneratedVisualizationCandidate | null; errors: string[] } {
  const missingCandidateProblem = generatedVisualMissingCandidateProblem(
    input.content,
    "generated visualization candidate",
  );
  if (missingCandidateProblem) {
    return {
      candidate: null,
      errors: [missingCandidateProblem],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapGeneratedVisualJsonFence(input.content));
  } catch (error) {
    return {
      candidate: null,
      errors: [
        `generated visualization candidate is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
      ],
    };
  }
  return validateGeneratedVisualizationCandidateEnvelope(
    parsed,
    input.tokenUsage,
  );
}

export async function generateVisualizationCandidate(input: {
  client: OpenAI;
  model: string;
  opportunity: VisualizationOpportunity;
  pageMarkdown: string;
  sourceContext?: unknown;
  sourceFigureSummaries?: unknown[];
  formulaDefinitions?: unknown[];
  previousSourceCode?: string;
  previousCandidate?: GeneratedVisualizationCandidate;
  repairHistory?: GeneratedVisualRepairHistoryEntry[];
  previews?: GeneratedVisualPreviewArtifact[];
  errors?: string[];
  councilRecovery?: GeneratedVisualCouncilRecoveryBoundary;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GeneratedVisualizationCandidate> {
  const raw = await requestGeneratedVisualizationCandidateRaw(input);
  const envelope = parseGeneratedVisualizationCandidateRaw(raw);
  if (!envelope.candidate) {
    throw new Error(
      `generated visualization candidate envelope is invalid: ${envelope.errors.join("; ")}`,
    );
  }
  return envelope.candidate;
}

/** Score groups a rubric-shaped approval must fill in. Each group is one
 * dimension, listed with every spelling the critic is known to use. */
const DETAILED_CRITIC_SCORE_GROUPS: readonly (readonly string[])[] = [
  ["interactionImprovesUnderstanding"],
  ["subsectionFit"],
  ["controlMeaningfulness", "meaningfulControls"],
  ["defaultStateUsefulness", "usefulDefaultState"],
  ["variableIntroduction"],
  [
    "sourceClaimsAndUnits",
    "sourceClaimsAndUnitsPreserved",
    "sourceClaimAndUnitPreservation",
    "sourceClaimPreservation",
  ],
  ["primitiveTopologyAndDomain"],
  ["avoidsDuplication"],
  [
    "complexityDiscipline",
    "avoidsUnnecessaryComplexity",
    "complexityRestraint",
  ],
  ["accessibility"],
];

/** The spelling of each dimension the critic is asked for, so the prompt, the
 * response schema, and the normalizer cannot drift apart. */
const CRITIC_RUBRIC_KEYS: readonly string[] = DETAILED_CRITIC_SCORE_GROUPS.map(
  (keys) => keys[0],
);

/** Names every rubric dimension the critic left unscored. */
function unscoredDetailedCriticDimensions(
  scores: Record<string, unknown>,
): string[] {
  return DETAILED_CRITIC_SCORE_GROUPS.filter(
    (keys) => !keys.some((key) => asFiniteNumber(scores[key]) !== undefined),
  ).map((keys) => keys[0]);
}

/** Why a rubric-shaped critic reply could not be normalized, so the caller can
 * tell the critic what to fix instead of retrying the identical prompt. */
export interface DetailedGeneratedVisualCriticDiagnostics {
  /** The reply carries rubric scores, so the detailed path owns the failure. */
  detailed?: boolean;
  reason?: string;
}

export function normalizeDetailedGeneratedVisualCriticRecord(
  parsed: unknown,
  tokenUsage?: GeneratedVisualTokenUsage,
  expectedOpportunityId?: string,
  diagnostics?: DetailedGeneratedVisualCriticDiagnostics,
): GeneratedVisualCriticRecord | null {
  const reject = (reason: string): null => {
    if (diagnostics) diagnostics.reason = reason;
    return null;
  };
  if (!isRecord(parsed) || !isRecord(parsed.scores))
    return reject("the reply carries no scores object");

  const visualScores = parsed.scores;
  // `accessibility` is scored by the legacy rubric too, so it cannot identify the shape.
  const detailedScoreKeys = DETAILED_CRITIC_SCORE_GROUPS.flat().filter(
    (key) => key !== "accessibility",
  );
  if (
    !detailedScoreKeys.some(
      (key) => asFiniteNumber(visualScores[key]) !== undefined,
    )
  ) {
    return reject("the reply carries no recognized rubric scores");
  }
  if (diagnostics) diagnostics.detailed = true;
  if (
    expectedOpportunityId &&
    typeof parsed.opportunityId === "string" &&
    parsed.opportunityId !== expectedOpportunityId
  ) {
    return reject(
      `the reply scored a different opportunity (${parsed.opportunityId})`,
    );
  }

  const normalizedDecision =
    typeof parsed.decision === "string"
      ? parsed.decision
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, "")
      : "";
  const decisionApproved = [
    "approve",
    "approved",
    "accept",
    "accepted",
    "pass",
    "passed",
  ].includes(normalizedDecision)
    ? true
    : [
          "reject",
          "rejected",
          "revise",
          "revision",
          "needsrevision",
          "needschanges",
          "changesrequested",
          "fail",
          "failed",
        ].includes(normalizedDecision)
      ? false
      : undefined;
  if (
    typeof parsed.approved === "boolean" &&
    decisionApproved !== undefined &&
    parsed.approved !== decisionApproved
  ) {
    return reject(
      `"approved" (${parsed.approved}) contradicts "decision" (${parsed.decision})`,
    );
  }
  const providerApproved =
    typeof parsed.approved === "boolean" ? parsed.approved : decisionApproved;
  if (providerApproved === undefined) {
    return reject(
      'the reply carries no boolean "approved" and no recognized "decision"',
    );
  }

  for (const key of [
    ...new Set(DETAILED_CRITIC_SCORE_GROUPS.flat()),
    "overall",
  ] as const) {
    const value = asFiniteNumber(visualScores[key]);
    if (value !== undefined && (value < 0 || value > 1)) {
      return reject(`score "${key}" must be between 0 and 1`);
    }
  }
  for (const key of ["overallScore", "overall"] as const) {
    const value = asFiniteNumber(parsed[key]);
    if (value !== undefined && (value < 0 || value > 1)) {
      return reject(`score "${key}" must be between 0 and 1`);
    }
  }

  const optionalScore = (key: string): number | undefined =>
    asFiniteNumber(visualScores[key]);
  const topLevelOverall = asFiniteNumber(parsed.overallScore ?? parsed.overall);
  const overall = optionalScore("overall") ?? topLevelOverall ?? 0;
  const firstReported = (keys: string[], fallback = overall) => {
    for (const key of keys) {
      const value = optionalScore(key);
      if (value !== undefined) return value;
    }
    return fallback;
  };
  const minimumReported = (keys: string[], fallback = overall) => {
    const values = keys
      .map(optionalScore)
      .filter((value): value is number => value !== undefined);
    return values.length ? Math.min(...values) : fallback;
  };
  const controlMeaningfulness = firstReported([
    "controlMeaningfulness",
    "meaningfulControls",
  ]);
  const defaultStateUsefulness = firstReported([
    "defaultStateUsefulness",
    "usefulDefaultState",
  ]);
  const variableIntroduction = optionalScore("variableIntroduction");
  const sourceClaimsAndUnits = firstReported([
    "sourceClaimsAndUnits",
    "sourceClaimsAndUnitsPreserved",
    "sourceClaimAndUnitPreservation",
    "sourceClaimPreservation",
  ]);
  const primitiveTopologyAndDomain =
    optionalScore("primitiveTopologyAndDomain") ?? overall;
  const sourceFidelity = Math.min(
    sourceClaimsAndUnits,
    primitiveTopologyAndDomain,
  );
  // Every verdict must use the same complete protocol. Otherwise an old score
  // shape could bypass a required publication dimension simply by approving.
  const unscored = unscoredDetailedCriticDimensions(visualScores);
  if (unscored.length) {
    return reject(
      `the reply gave a verdict without scoring ${unscored.join(", ")}`,
    );
  }
  const scores = {
    pedagogicalValue: minimumReported([
      "interactionImprovesUnderstanding",
      "subsectionFit",
      "controlMeaningfulness",
      "meaningfulControls",
      "defaultStateUsefulness",
      "usefulDefaultState",
    ]),
    sourceFidelity,
    usability: minimumReported([
      "controlMeaningfulness",
      "meaningfulControls",
      "defaultStateUsefulness",
      "usefulDefaultState",
      "variableIntroduction",
      "complexityDiscipline",
      "avoidsUnnecessaryComplexity",
      "complexityRestraint",
      "avoidsDuplication",
    ]),
    accessibility: optionalScore("accessibility") ?? overall,
  };

  const requestedChanges: string[] = [];
  const addChange = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (
      normalized &&
      !requestedChanges.includes(normalized) &&
      requestedChanges.length < 12
    ) {
      requestedChanges.push(normalized);
    }
  };
  for (const key of [
    "requestedChanges",
    "requiredChanges",
    "recommendations",
    "issues",
  ] as const) {
    if (Array.isArray(parsed[key])) parsed[key].forEach(addChange);
  }
  if (providerApproved && requestedChanges.length > 0) {
    return reject("the reply approved the visual while requesting changes");
  }
  if ((optionalScore("interactionImprovesUnderstanding") ?? overall) < 0.75) {
    addChange(
      "Make the interaction teach the stated learning objective more directly.",
    );
  }
  if ((optionalScore("subsectionFit") ?? overall) < 0.75) {
    addChange(
      "Align the visual and its controls with this subsection instead of adjacent material.",
    );
  }
  if (controlMeaningfulness < 0.65) {
    addChange(
      "Replace generic controls with variables that directly change the taught relationship, and explain each control's effect.",
    );
  }
  if (defaultStateUsefulness < 0.65) {
    addChange(
      "Choose a default state that immediately demonstrates the intended relationship.",
    );
  }
  if (variableIntroduction !== undefined && variableIntroduction < 0.65) {
    addChange(
      "Introduce and label every variable and unit before the learner manipulates it.",
    );
  }
  if (sourceClaimsAndUnits < 0.75) {
    addChange(
      "Ground every relationship, claim, and unit in the supplied source evidence, and recompute every authored numeric, signed, directional, unit, and aggregate relationship for internal consistency.",
    );
  }
  if (primitiveTopologyAndDomain < 0.75) {
    addChange(
      "Make each rendered primitive's actual topology and domain match its labels, explanation, interaction contract, and source evidence; relabeling a mismatched shape is not a correction.",
    );
  }
  if ((optionalScore("avoidsDuplication") ?? 1) < 0.75) {
    addChange(
      "Remove duplicated explanation or interaction and keep only the distinct learning contribution.",
    );
  }
  if (
    firstReported(
      [
        "complexityDiscipline",
        "avoidsUnnecessaryComplexity",
        "complexityRestraint",
      ],
      1,
    ) < 0.65
  ) {
    addChange(
      "Reduce unnecessary complexity while preserving the interaction required by the learning objective.",
    );
  }
  if (scores.accessibility < 0.65) {
    addChange(
      "Add a complete non-visual explanation and ensure every control, output, diagram, and state is keyboard-readable and explicitly labelled.",
    );
  }

  const reason =
    [parsed.reason, parsed.rationale, parsed.summary]
      .find(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      ?.trim() ?? `Visualization critic overall score ${overall.toFixed(2)}.`;
  if (!providerApproved && requestedChanges.length === 0) {
    addChange(
      "Revise the visual to address the critic's rationale before requesting another review.",
    );
  }
  const providerScores = Object.fromEntries(
    [
      ...Object.entries(visualScores),
      ["overallScore", parsed.overallScore],
    ].flatMap(([key, value]) => {
      const numeric = asFiniteNumber(value);
      return numeric === undefined ? [] : [[key, numeric]];
    }),
  );
  return {
    approved:
      providerApproved &&
      scores.pedagogicalValue >= 0.75 &&
      scores.sourceFidelity >= 0.75 &&
      scores.usability >= 0.65 &&
      scores.accessibility >= 0.65,
    checkedAt: nowIso(),
    reason,
    requestedChanges,
    scores,
    providerApproved,
    providerScores,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

async function requestGeneratedVisualizationCriticRaw(input: {
  client: OpenAI;
  model: string;
  opportunity: VisualizationOpportunity;
  candidate: GeneratedVisualizationCandidate;
  definition: GeneratedVisualizationDefinition;
  sourceContext?: unknown;
  sourceFigureSummaries?: unknown[];
  formulaDefinitions?: unknown[];
  previewPath?: string;
  previews?: GeneratedVisualPreviewArtifact[];
  tests?: GeneratedVisualTestsRecord;
  /** Why the previous critic reply was unusable, quoted back so a retry
   * corrects the shape instead of repeating the identical prompt. */
  priorCriticFailure?: string;
  councilRecovery?: GeneratedVisualCouncilRecoveryBoundary;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  tokenUsage?: GeneratedVisualTokenUsage;
}> {
  const legacyPreview: GeneratedVisualPreviewArtifact[] =
    input.previewPath && externalRuntimePathExists(input.previewPath)
      ? [
          {
            id: "legacy-desktop-default",
            viewport: { width: 1000, height: 720 },
            theme: "light",
            selectState: [],
            defaultState: true,
            selectStateCoverageTruncated: false,
            path: input.previewPath,
          },
        ]
      : [];
  const availablePreviews = availableGeneratedVisualPreviews(
    input.previews?.length ? input.previews : legacyPreview,
  );
  const previewCoverage = {
    renderedPreviewCount: availablePreviews.length,
    selectStateCap: GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES,
    selectStateCoverageTruncated: availablePreviews.some(
      (preview) => preview.selectStateCoverageTruncated,
    ),
    policy:
      "Labelled previews are evidence only for their stated viewport and select state. A truncated select-state matrix is a deliberate bounded subset, never proof of an unrendered state or full state coverage.",
  };
  const evidence = {
    opportunity: input.opportunity,
    immutableContract: {
      requiredInputs: input.opportunity.requiredInputs,
      requiredOutputs: input.opportunity.requiredOutputs,
    },
    capabilityManifest: GENERATED_VISUAL_CAPABILITY_MANIFEST,
    capabilityManifestHash: GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
    explanation: input.candidate.explanation,
    pedagogicalClaims: input.candidate.pedagogicalClaims,
    accessibilityDescription: input.candidate.accessibilityDescription,
    definition: input.definition,
    sourceContext: JSON.stringify(input.sourceContext ?? {}).slice(0, 8_000),
    sourceFigureSummaries: boundedGeneratedVisualEvidence(
      input.sourceFigureSummaries?.slice(0, 6),
      6_000,
    ),
    formulaDefinitions: boundedGeneratedVisualEvidence(
      input.formulaDefinitions?.slice(0, 8),
      5_000,
    ),
    previewGenerated: availablePreviews.length > 0,
    renderedPreviews: generatedVisualPreviewIdentities(availablePreviews),
    previewCoverage,
    runtimeEvidence: input.tests
      ? {
          passed: input.tests.passed,
          staticTests: input.tests.staticTests,
          semanticTests: input.tests.semanticTests,
          runtimeTests: input.tests.runtimeTests,
          browser: input.tests.browser,
          sandboxCapabilities: [
            "native labelled controls with keyboard focus",
            "one dominant visual renders before compact results and exact immutable controls, with runtime checks for visual-first DOM order and rendered controls",
            "reset synchronizes state, controls, and readouts",
            "exact protocolRole values enforce prediction then commit then reveal/evaluate, lock committed prediction inputs, guard premature activation, and let the trusted runtime Reset the sequence without authored reset-expression state",
            "derived values and textual status use aria-live",
            "light/dark and reduced-motion CSS",
            "mobile and desktop overflow checks",
            "spatial projection and navigation occur only when explicitly authored as orthographic/perspective and fixed/orbit",
            "orbit views support pointer, touch, wheel, keyboard, Home, and global Reset over stable authored-world bounds",
          ],
        }
      : undefined,
  };
  const request = withCouncil(
      {
        model: input.model,
        messages: [
          {
            role: "system" as const,
            // Council-routed requests drop `response_format`, so the required
            // shape is spelled out here as well as in the schema below.
            content:
              "Review one already validated Breadboard interactive visualization. Do not mutate the artifact.\n" +
              "Reply with one JSON object and nothing else:\n" +
              `{"approved": <boolean>, "reason": <string>, "requestedChanges": [<string>, ...], "scores": {${CRITIC_RUBRIC_KEYS.map((key) => `"${key}": <0-1 number>`).join(", ")}}}\n` +
              "Score every one of those dimensions as a number from 0 to 1 — an approval that leaves any dimension unscored is discarded. " +
              "Leave requestedChanges empty when you approve; otherwise list the complete bounded inventory of every blocking revision visible in the supplied evidence, not only the first issue discovered. " +
              "Compare every rendered primitive's actual topology and domain against its labels, explanation, interaction contract, and source evidence. Explicitly distinguish centered/full from bounded/clipped/one-sided/sector geometry and open from closed geometry. plane(center,normal,size) is a finite centered full rectangular patch and is valid for a full rectangular box face; do not require a polygon merely because that face is finite. Require a polygon only for clipped, one-sided, sector, or non-rectangular boundaries. Cylinder and cone primitives are bounded capped closed solids, so require ordered polygon facets for a claimed open, uncapped, clipped, one-sided, or sector surface. Diagram node.value is optional and must remain an expression object (a constant, input, or shallow one-operation expression), never a bare numeric value; do not request a derived formula or deep expression tree inside a diagram node value. Do not request a long derived formula inside any spatial coordinate either: request simple literal/input/one-operation geometry and put the calculation in an output, plot, status, or formula scene. Never request min or max as a binary expression operator. If the visual needs a longer derivation, request an output, plot, status, or formula scene instead. For every named-point normal, tangent, or basis-direction claim about a displayed planar, faceted, or local surface patch, inspect the literal face: reject a point on an edge, vertex, seam, or cap, and reject a face normal that is not parallel or antiparallel to the claimed vector. A faceted or local tangent approximation is acceptable only when the artifact says so. Reject any mismatch even when a label or prose renames the rendered shape; relabeling does not change topology or domain. When the final learnerAction promises a selected, highlighted, emphasized, or distinguished branch in a persistent diagram, inspect the literal diagram edge.strength expressions for every exact select option. Require every node and edge to remain present, every single option to have an exclusive emphasized branch, every combined/both/all/sum/total/+ option to emphasize their union, and all options to produce pairwise-distinct rendered signatures after abs(strength) is clamped to 0.5-6; node.value, prose, or an unrelated spatial change is not branch highlighting. edge.strength is the supported authored mechanism, so request that candidate repair rather than CSS, runtime, or control-contract changes. " +
              "Independently recompute every evaluable relationship from the literal definition rather than trusting its labels, explanation, pedagogical claims, or screenshot. Check scalar values, signs, directions, units and conversions, every vector's endpoint delta and magnitude, component-wise sums, resultants, rounding, and other aggregates. When a displayed direction is multiplied by an uncontrolled signed scalar, reject a claim that the underlying term direction is the signed result or contribution direction unless source evidence fixes the sign. Accept either a visible and non-visual fixed-sign assumption plus an explicit opposite-sign reversal, or neutral labels for the underlying terms plus the sign-dependent reversal; do not require an invented sign or planner-owned control. A claimed sum must equal the displayed contributions at the authored precision. If displayed elements are representative samples of a larger or continuous domain, reject a whole-domain aggregate that is constructed or implied as their exact finite subtotal unless the source evidence explicitly establishes that equality; require the distinction in geometry, labels, and the non-visual explanation. If source evidence does not establish a sign, magnitude, scale, or aggregate, require explicitly qualitative or normalized encoding and reject unsupported evaluated claims. Treat every such check as part of both sourceClaimsAndUnits and primitiveTopologyAndDomain, and score either below its publication threshold when any check fails. " +
              "For a spatial scene, verify that its explicitly authored orthographic/perspective and fixed/orbit view is pedagogically useful rather than decorative, preserves legibility and truthful geometry, and is explained accessibly when orbit navigation is enabled. Omitted camera fields are the fixed orthographic legacy default; never infer a different mode from the screenshot or subject matter. Treat the supplied narrow mobile preview as a hard camera-framing check: reject a source-essential plane, vector, endpoint, or inline label that is off-center, cropped, or too close to a frame edge because its azimuth, elevation, scale, projection, or geometry envelope is unsuitable, and request an authored view/geometry correction rather than CSS or runtime auto-fit. Trace every learner-facing non-structural numeric literal or symbol in spatial coordinates and formula/output expressions: reject an unexplained physical interval, scale, or constant unless its symbol, value, unit when applicable, and role are visibly defined in a formula/annotation, diagram, plot, or status scene and described non-visually; do not demand labels for pure rendering-only coordinates. Treat every screen-relative left/right/top/bottom statement as a literal rendered claim: reject it when the exact supplied preview for that state and viewport contradicts it, and when such placement is not source-grounded request removal or a world-coordinate relationship rather than a camera assumption. " +
              "For test_prediction, verify the actual control and output behavior follows the reviewed input, then commit, then reveal/evaluate order; reject an artifact that reveals or evaluates the outcome before commitment, whose outcome changes initially, during prediction, or at commit alone, ignores any protocol stage, or merely describes the sequence in prose. The trusted runtime uses exact protocolRole values (never labels or subject inference) to keep prediction inputs editable until commit, lock them after commit, mutation-guard reveal/evaluate until commitment, and clear/unlock on Reset. A reviewed protocolRole:\"reset\" control is runtime-owned and must not appear as an input in authored output or scene expressions; judge it by whether another reviewed control creates meaningful changed state that the runtime can restore. There is no retained hidden-state snapshot; the mechanism is a UI/state lock and guard, not a semantic prediction snapshot invented by the runtime. Require the authored outcome expression or visibility to be gated by both commit and reveal/evaluate. " +
              "The immutableContract controls and outputs are planner-owned and cannot be changed in this candidate loop. The trusted runtime renders one dominant visual before compact results and every exact immutable control, and passed runtimeEvidence verifies that visual-first order; a candidate cannot author control placement. Do not request a duplicate selector, scene-embedded control, CSS, or runtime ordering change. Apply the same minimal presentation contract as the in-chat visualizer: reject redundant annotation or formula scenes, prose or help panels, reset-status scenes, repeated definitions, and secondary scenes that merely explain the primary visual. Prefer exactly one scene and allow a second only for one compact dynamic status that is essential to the interaction. Keep full non-visual detail in accessibilityDescription, not visible explanatory copy. Reject only with requestedChanges that a complete replacement candidate can make through its six authored fields and sourceCode using the supplied capabilityManifest. Requested changes must be sourceCode/SDK-feasible: never request a contract, planner, lesson, route, renderer, runtime, CSS, or unavailable SDK mutation. Use each labelled rendered preview only as evidence for its stated viewport and select state; do not claim a mobile or alternate-state defect from a different or unshown preview. When previewCoverage.selectStateCoverageTruncated is true, it is bounded representative evidence rather than proof of complete or unshown select-state coverage. Approve only if interaction improves understanding, belongs in this subsection, uses meaningful controls, has a useful default state, preserves source claims and units, matches primitive topology and domain, avoids duplication and unnecessary complexity, and is accessible.",
          },
          {
            role: "user" as const,
            content: availablePreviews.length
              ? [
                  { type: "text" as const, text: JSON.stringify(evidence) },
                  ...generatedVisualPreviewImageParts(availablePreviews),
                ]
              : JSON.stringify(evidence),
          },
          ...(input.priorCriticFailure
            ? [
                {
                  role: "user" as const,
                  content:
                    `Your previous review was discarded because ${input.priorCriticFailure}. ` +
                    "Review the same artifact again and reply with the exact JSON object described above, " +
                    `including a 0-1 number for every one of: ${CRITIC_RUBRIC_KEYS.join(", ")}.`,
                },
              ]
            : []),
        ],
        reasoning: GENERATED_VISUAL_COUNCIL_REASONING,
        response_format: {
          type: "json_schema" as const,
          json_schema: {
            name: "breadboard_generated_visual_critic",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["approved", "reason", "requestedChanges", "scores"],
              properties: {
                approved: { type: "boolean" },
                reason: { type: "string" },
                requestedChanges: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 12,
                },
                scores: {
                  type: "object",
                  additionalProperties: false,
                  required: [...CRITIC_RUBRIC_KEYS],
                  properties: Object.fromEntries(
                    CRITIC_RUBRIC_KEYS.map((key) => [
                      key,
                      {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                      },
                    ]),
                  ),
                },
              },
            },
          },
        },
        max_completion_tokens: Math.max(
          500,
          Math.min(
            4_000,
            Number(
              process.env.LEARN_GENERATED_VISUAL_CRITIC_MAX_OUTPUT_TOKENS ??
                1_500,
            ) || 1_500,
          ),
        ),
      },
      {
        taskType: "critique",
        gardenId: input.opportunity.gardenId,
        pageId: input.opportunity.targetPage,
        sourceContext: input.opportunity,
        councilModeOverride: "direct_council",
      },
  );
  if (input.councilRecovery) {
    const recovered = await runGeneratedVisualCouncilRequestWithReceipt({
      client: input.client as unknown as RunGeneratedVisualCouncilRequestInput["client"],
      durableRecoveryDir: input.councilRecovery.durableRecoveryDir,
      invocationKey: input.councilRecovery.invocationKey,
      recoveryMetadata: input.councilRecovery.metadata,
      request,
      allowImageUrlParts: availablePreviews.length > 0,
      startedReceiptObservationTimeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    input.councilRecovery.onReceipt?.(recovered);
    return { content: recovered.content, tokenUsage: recovered.tokenUsage };
  }
  const response = await input.client.chat.completions.create(request, {
    signal: input.signal,
    // Avoid the SDK's implicit 10-minute cutoff. The outer receipt-aware
    // boundary owns the later finite grace period and cancellation signal.
    timeout: input.timeoutMs,
    maxRetries: 0,
  });
  const content = response.choices[0]?.message?.content ?? "";
  const tokenUsage = generatedVisualTokenUsage(response.usage);
  return {
    content,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function parseGeneratedVisualizationCriticRaw(input: {
  content: string;
  tokenUsage?: GeneratedVisualTokenUsage;
  opportunityId: string;
}): { critic: GeneratedVisualCriticRecord | null; problem?: string } {
  const missingCandidateProblem = generatedVisualMissingCandidateProblem(
    input.content,
    "critic",
  );
  if (missingCandidateProblem) {
    return {
      critic: null,
      problem: missingCandidateProblem,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapGeneratedVisualJsonFence(input.content));
  } catch {
    return {
      critic: null,
      problem: `critic returned invalid JSON: ${input.content.slice(0, 500)}`,
    };
  }
  const criticDiagnostics: DetailedGeneratedVisualCriticDiagnostics = {};
  const detailedCritic = normalizeDetailedGeneratedVisualCriticRecord(
    parsed,
    input.tokenUsage,
    input.opportunityId,
    criticDiagnostics,
  );
  if (detailedCritic) return { critic: detailedCritic };
  // Active publication has one critic protocol. Legacy/compact score records
  // cannot approve by bypassing a required topology/domain comparison.
  return {
    critic: null,
    problem: `critic returned an unusable rubric verdict: ${criticDiagnostics.reason ?? "the reply did not score every required critic dimension, including primitiveTopologyAndDomain"}`,
  };
}

type GeneratedVisualCriticProvider = (
  input: Parameters<typeof requestGeneratedVisualizationCriticRaw>[0],
) => Promise<GeneratedVisualCriticRecord>;

function nextGeneratedVisualVersion(gardenDir: string, id: string): number {
  return (loadGeneratedVisualManifest(gardenDir, id)?.version ?? 0) + 1;
}

function emit(
  sink: EventSink | undefined,
  type: string,
  data: Record<string, unknown>,
): void {
  try {
    sink?.({ type, data });
  } catch {
    // Lifecycle telemetry is observational. It must never replace a provider
    // result, cancellation, validation failure, or the exact provider error.
  }
}

const GENERATED_VISUAL_REQUEST_TIMEOUT_CODE =
  "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT";

class GeneratedVisualRequestTimeoutError extends Error {
  readonly code = GENERATED_VISUAL_REQUEST_TIMEOUT_CODE;
  readonly timeoutMs: number;
  readonly lateResultGraceMs: number;

  constructor(
    timeoutMs: number,
    lateResultGraceMs = 0,
    cause?: unknown,
  ) {
    super(
      lateResultGraceMs > 0
        ? `generated visualization provider request did not settle within the ${timeoutMs}ms soft deadline plus ${lateResultGraceMs}ms late-result grace; the ambiguous duplicate request was suppressed`
        : `generated visualization provider request timed out after ${timeoutMs}ms`,
    );
    this.name = "GeneratedVisualRequestTimeoutError";
    this.timeoutMs = timeoutMs;
    this.lateResultGraceMs = lateResultGraceMs;
    if (cause !== undefined)
      (this as Error & { cause?: unknown }).cause = cause;
  }
}

interface GeneratedVisualProviderErrorDetail {
  code: string;
  name: string;
  message: string;
  status?: number;
}

function generatedVisualProviderErrorDetails(
  error: unknown,
): GeneratedVisualProviderErrorDetail[] {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const details: GeneratedVisualProviderErrorDetail[] = [];
  while (pending.length > 0 && details.length < 24) {
    const current = pending.shift();
    if (typeof current === "string") {
      details.push({ code: "", name: "", message: current });
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as {
      cause?: unknown;
      code?: unknown;
      errors?: unknown;
      message?: unknown;
      name?: unknown;
      response?: unknown;
      status?: unknown;
    };
    const responseStatus = isRecord(record.response)
      ? asFiniteNumber(record.response.status)
      : undefined;
    details.push({
      code: typeof record.code === "string" ? record.code : "",
      name: typeof record.name === "string" ? record.name : "",
      message: typeof record.message === "string" ? record.message : "",
      status: asFiniteNumber(record.status) ?? responseStatus,
    });
    if (record.cause !== undefined) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors);
  }
  return details;
}

function isGeneratedVisualProviderCancellation(error: unknown): boolean {
  return generatedVisualProviderErrorDetails(error).some(
    ({ code, name, message }) => {
      const normalizedCode = code.toUpperCase();
      const normalizedName = name.toLowerCase();
      return (
        normalizedCode === "ABORT_ERR" ||
        normalizedCode === "ERR_CANCELED" ||
        normalizedCode === "ERR_CANCELLED" ||
        normalizedName.includes("abort") ||
        normalizedName.includes("cancel") ||
        /\b(?:request|operation|job|generated visualization) (?:was )?(?:cancelled|canceled|aborted)\b/i.test(
          message,
        )
      );
    },
  );
}

/** Generated-visual requests own only their deadline. Learn's tracked client
 * separately owns 502/restart/connection retries, preventing multiplicative
 * retry schedules while caller-owned aborts remain terminal. */
export function isGeneratedVisualProviderTransportError(
  error: unknown,
): boolean {
  if (error instanceof GeneratedVisualRequestTimeoutError) return true;
  const details = generatedVisualProviderErrorDetails(error);
  if (details.length === 0) return false;
  // Do not reinterpret an ordinary HTTP/model response as a transport timeout.
  if (details.some(({ status }) => status !== undefined)) return false;
  const isExplicitTimeout = ({
    code,
    name,
    message,
  }: GeneratedVisualProviderErrorDetail) => {
    const normalizedCode = code.toUpperCase();
    return (
      [
        "ETIMEDOUT",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
      ].includes(normalizedCode) ||
      /(?:api|connection|request|provider).*timeout/i.test(name) ||
      /\b(?:request|connection|response|provider) (?:timed out|timeout)\b/i.test(
        message,
      )
    );
  };
  // Provider timeout wrappers sometimes retain a nested AbortError produced by
  // their own deadline. The outer timeout identity wins; a naked/root abort is
  // still caller cancellation, and call sites check externalSignal first.
  if (isExplicitTimeout(details[0])) return true;
  if (isGeneratedVisualProviderCancellation(error)) return false;
  return details.some(isExplicitTimeout);
}

function generatedVisualAbortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  );
}

function isTerminalGeneratedVisualCouncilNoAnswer(
  error: unknown,
): error is GeneratedVisualCouncilReceiptError {
  return (
    error instanceof GeneratedVisualCouncilReceiptError &&
    error.state === "failed"
  );
}

function generatedVisualCouncilTransportRecoveryMaxAttempts(): number {
  const configured = Number(
    process.env.LEARN_GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_MAX_ATTEMPTS,
  );
  return Math.max(
    1,
    Math.min(
      GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_MAX_ATTEMPTS,
      Number.isFinite(configured)
        ? Math.floor(configured)
        : GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_MAX_ATTEMPTS,
    ),
  );
}

function generatedVisualCouncilTransportRecoveryDelayMs(
  completedRecoveryAttempt: number,
): number {
  const configured = Number(
    process.env.LEARN_GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_BASE_DELAY_MS,
  );
  const baseDelayMs = Math.max(
    0,
    Number.isFinite(configured)
      ? Math.floor(configured)
      : GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_BASE_DELAY_MS,
  );
  return Math.min(
    GENERATED_VISUAL_COUNCIL_TRANSPORT_RECOVERY_MAX_DELAY_MS,
    baseDelayMs * 2 ** Math.max(0, completedRecoveryAttempt - 1),
  );
}

async function waitForGeneratedVisualCouncilTransportRecovery(input: {
  delayMs: number;
  externalSignal?: AbortSignal;
  checkCancelled?: () => void;
}): Promise<void> {
  input.checkCancelled?.();
  if (input.externalSignal?.aborted) {
    throw generatedVisualAbortReason(input.externalSignal);
  }
  if (input.delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      input.externalSignal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, input.delayMs);
    const abort = () => {
      clearTimeout(timer);
      input.externalSignal?.removeEventListener("abort", abort);
      reject(generatedVisualAbortReason(input.externalSignal!));
    };
    input.externalSignal?.addEventListener("abort", abort, { once: true });
  });
  input.checkCancelled?.();
}

function notifyGeneratedVisualTimeoutObserver<T>(
  observer: ((event: T) => void) | undefined,
  event: T,
): void {
  try {
    observer?.(event);
  } catch {
    // Deadline telemetry is subordinate to the provider result. In particular,
    // a broken Learn event sink must not abandon an accepted request or turn a
    // recovered response into a semantic generation/critic failure.
  }
}

function boundedGeneratedVisualProviderWait(input: {
  timeoutMs: number;
  lateResultGraceMs: number;
}): { timeoutMs: number; lateResultGraceMs: number } {
  const requestedTimeoutMs = Number.isFinite(input.timeoutMs)
    ? Math.max(1, Math.floor(input.timeoutMs))
    : GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS;
  const requestedLateResultGraceMs = Number.isFinite(input.lateResultGraceMs)
    ? Math.max(0, Math.floor(input.lateResultGraceMs))
    : GENERATED_VISUAL_PROVIDER_LATE_RESULT_GRACE_MS;
  const timeoutMs = Math.min(
    requestedTimeoutMs,
    GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS,
  );
  return {
    timeoutMs,
    lateResultGraceMs: Math.min(
      requestedLateResultGraceMs,
      GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS - timeoutMs,
    ),
  };
}

async function withGeneratedVisualTimeout<T>(input: {
  timeoutMs: number;
  lateResultGraceMs: number;
  externalSignal?: AbortSignal;
  work: (signal: AbortSignal) => Promise<T>;
  onLateResultWait?: (event: {
    timeoutMs: number;
    lateResultGraceMs: number;
    hardTimeoutMs: number;
  }) => void;
  onLateResultRecovered?: (event: {
    timeoutMs: number;
    lateResultGraceMs: number;
    waitedMs: number;
  }) => void;
}): Promise<T> {
  if (input.externalSignal?.aborted)
    throw generatedVisualAbortReason(input.externalSignal);
  const controller = new AbortController();
  const lateResultGraceMs = Math.max(0, input.lateResultGraceMs);
  const hardDeadlineAt =
    performance.now() + input.timeoutMs + lateResultGraceMs;
  let terminalSettled = false;
  let resolveTerminal: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectTerminal: (reason?: unknown) => void = () => undefined;
  const terminal = new Promise<T>((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  const resolveTerminalOnce = (value: T): boolean => {
    if (terminalSettled) return false;
    terminalSettled = true;
    resolveTerminal(value);
    return true;
  };
  const rejectTerminalOnce = (failure: unknown): boolean => {
    if (terminalSettled) return false;
    terminalSettled = true;
    rejectTerminal(failure);
    return true;
  };
  const hardDeadlineElapsed = (): boolean =>
    performance.now() >= hardDeadlineAt;
  const settleHardTimeout = (): boolean => {
    if (terminalSettled) return false;
    const timeoutFailure = new GeneratedVisualRequestTimeoutError(
      input.timeoutMs,
      lateResultGraceMs,
    );
    if (!rejectTerminalOnce(timeoutFailure)) return false;
    controller.abort(timeoutFailure);
    return true;
  };
  const abortFromExternal = () => {
    if (hardDeadlineElapsed()) {
      settleHardTimeout();
      return;
    }
    const externalFailure = generatedVisualAbortReason(input.externalSignal!);
    if (rejectTerminalOnce(externalFailure)) {
      controller.abort(externalFailure);
    }
  };
  input.externalSignal?.addEventListener("abort", abortFromExternal, {
    once: true,
  });
  const softDeadline = Symbol("generated-visual-soft-deadline");
  let softTimer: ReturnType<typeof setTimeout> | undefined;
  const softBoundary = new Promise<typeof softDeadline>((resolve) => {
    softTimer = setTimeout(() => resolve(softDeadline), input.timeoutMs);
  });
  // Both deadlines are anchored at request start. Creating a new grace timer
  // only after the soft continuation runs lets event-loop contention extend the
  // advertised hard deadline and allows an already-due provider rejection to
  // steal authority. The one terminal latch records whichever provider,
  // cancellation, or absolute hard-deadline callback actually settles first.
  const hardTimer = setTimeout(
    settleHardTimeout,
    input.timeoutMs + lateResultGraceMs,
  );
  // Observe the original promise through both deadlines. A late settlement
  // remains handled after a hard timeout, and no duplicate request is launched.
  const work = Promise.resolve().then(() => input.work(controller.signal));
  void work.then(
    (value) => {
      if (hardDeadlineElapsed()) {
        settleHardTimeout();
        return;
      }
      resolveTerminalOnce(value);
    },
    (failure) => {
      if (hardDeadlineElapsed()) {
        settleHardTimeout();
        return;
      }
      rejectTerminalOnce(failure);
    },
  );
  try {
    const initial = await Promise.race([terminal, softBoundary]);
    if (initial !== softDeadline) return initial as T;

    const lateResultWaitStartedAt = Date.now();
    notifyGeneratedVisualTimeoutObserver(input.onLateResultWait, {
      timeoutMs: input.timeoutMs,
      lateResultGraceMs,
      hardTimeoutMs: input.timeoutMs + lateResultGraceMs,
    });
    const recovered = await terminal;
    notifyGeneratedVisualTimeoutObserver(input.onLateResultRecovered, {
      timeoutMs: input.timeoutMs,
      lateResultGraceMs,
      waitedMs: Date.now() - lateResultWaitStartedAt,
    });
    return recovered;
  } finally {
    if (softTimer) clearTimeout(softTimer);
    if (hardTimer) clearTimeout(hardTimer);
    input.externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export async function retryGeneratedVisualProviderRequest<T>(input: {
  timeoutMs: number;
  lateResultGraceMs?: number;
  externalSignal?: AbortSignal;
  checkCancelled?: () => void;
  work: (signal: AbortSignal, transportAttempt: number) => Promise<T>;
  onLateResultWait?: (event: {
    timeoutMs: number;
    lateResultGraceMs: number;
    hardTimeoutMs: number;
  }) => void;
  onLateResultRecovered?: (event: {
    timeoutMs: number;
    lateResultGraceMs: number;
    waitedMs: number;
  }) => void;
}): Promise<T> {
  const transportAttempt = 1;
  input.checkCancelled?.();
  if (input.externalSignal?.aborted)
    throw generatedVisualAbortReason(input.externalSignal);
  const wait = boundedGeneratedVisualProviderWait({
    timeoutMs: input.timeoutMs,
    lateResultGraceMs: input.lateResultGraceMs ?? input.timeoutMs,
  });
  // The timeout boundary adopts the original late result when possible and
  // otherwise throws its exact terminal object. Never wrap a provider throw:
  // callers need object identity for durable ambiguity and cancellation audit.
  return withGeneratedVisualTimeout({
    timeoutMs: wait.timeoutMs,
    lateResultGraceMs: wait.lateResultGraceMs,
    externalSignal: input.externalSignal,
    work: (signal) => input.work(signal, transportAttempt),
    onLateResultWait: input.onLateResultWait,
    onLateResultRecovered: input.onLateResultRecovered,
  });
}

function writeRejectedAttempt(input: {
  gardenDir: string;
  id: string;
  runId: string;
  attempt: number;
  candidate: GeneratedVisualizationCandidate | null;
  category: GeneratedVisualRejectedAttemptCategory;
  errors: string[];
  lifecycle?: GeneratedVisualLifecycleRecord[];
  evidence?: {
    validation?: GeneratedVisualValidationRecord;
    tests?: GeneratedVisualTestsRecord;
    critic?: GeneratedVisualCriticRecord;
  };
  onRejectedAttempt?: GeneratedVisualRejectedAttemptSink;
  onEvent?: EventSink;
}): void {
  const lifecycle = input.lifecycle ?? [];
  const rejectedAt = nowIso();
  const rejectedLifecycle: GeneratedVisualLifecycleRecord[] = [
    ...lifecycle,
    {
      status: "rejected",
      at: rejectedAt,
      attempt: input.attempt,
      detail: input.errors.join("; "),
    },
  ];
  const dir = path.join(
    generatedVisualArtifactDir(input.gardenDir, input.id),
    "attempts",
    input.runId,
    `attempt-${input.attempt}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  if (input.candidate) {
    fs.writeFileSync(
      path.join(dir, "source.tsx"),
      input.candidate.sourceCode,
      "utf-8",
    );
    writeJson(path.join(dir, "candidate.json"), input.candidate);
  }
  if (input.evidence?.validation)
    writeJson(path.join(dir, "validation.json"), input.evidence.validation);
  if (input.evidence?.tests) {
    writeJson(path.join(dir, "tests.json"), input.evidence.tests);
    if (input.evidence.tests.browser?.previewMatrixReceipt) {
      writeJson(
        path.join(dir, "preview-matrix.json"),
        input.evidence.tests.browser.previewMatrixReceipt,
      );
    }
  }
  if (input.evidence?.critic)
    writeJson(path.join(dir, "critic.json"), input.evidence.critic);
  writeJson(path.join(dir, "rejection.json"), {
    status: "rejected",
    category: input.category,
    errors: input.errors,
    at: rejectedAt,
  });
  writeJson(path.join(dir, "lifecycle.json"), rejectedLifecycle);
  try {
    input.onRejectedAttempt?.({
      schemaVersion: 1,
      visualizationId: input.id,
      runId: input.runId,
      attempt: input.attempt,
      category: input.category,
      rejectedAt,
      errors: [...input.errors],
      candidate: input.candidate,
      lifecycle: rejectedLifecycle.map((entry) => ({ ...entry })),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    });
  } catch {
    // Durable diagnostics are subordinate to the semantic result. A broken
    // audit sink must never convert the original rejection into a new failure.
    try {
      emit(input.onEvent, "learn_visual_rejected_attempt_audit_failed", {
        visualizationId: input.id,
        runId: input.runId,
        attempt: input.attempt,
        category: input.category,
        reason: "rejected attempt audit could not be persisted",
      });
    } catch {
      // The event ledger is best-effort when the audit destination itself is
      // unavailable; retain the original visual failure either way.
    }
  }
}

export type CreateGeneratedVisualizationInput = {
  client: OpenAI;
  model: string;
  gardenDir: string;
  /** Stable per-garden runtime root used only for strict Council request
   * bindings. It must live outside published and staging garden trees. */
  durableRecoveryDir?: string;
  /** Stable owner for a resumable generation job. Deliberate new jobs use a
   * new owner, while an exact still-ambiguous request can be adopted by hash. */
  recoveryOwnerId?: string;
  /** Recovery-only fast path. A failed Learn workspace may reuse its own
   * already-published artifact when the current model and complete visual
   * contract still match and every persisted publication gate revalidates.
   * Deliberate generation/regeneration leaves this false. */
  reusePublishedArtifactOnRecovery?: boolean;
  opportunity: VisualizationOpportunity;
  pageMarkdown: string;
  sourceContext?: unknown;
  sourceFigureSummaries?: unknown[];
  formulaDefinitions?: unknown[];
  availableSourceAnchorIds?: Set<string>;
  onEvent?: EventSink;
  candidateProvider?: typeof generateVisualizationCandidate;
  /** Mandatory compiler boundary. Compatibility routes submit one fresh
   * Runtime V2 compiler worker; Learn injects the compiler owned by its own
   * already-disposable worker. There is deliberately no in-process fallback. */
  compilerRunner: (
    sourceCode: string,
    opportunity: VisualizationOpportunity,
    signal?: AbortSignal,
  ) => Promise<GeneratedVisualCompilation>;
  criticProvider?: GeneratedVisualCriticProvider;
  maxAttempts?: number;
  criticMaxAttempts?: number;
  runBrowserTests?: boolean;
  /** Mandatory browser boundary. Compatibility routes inject Runtime V2;
   * Learn injects its disposable worker's local adapter. There is deliberately
   * no process-owned fallback in this orchestration module. */
  browserTestRunner: GeneratedVisualBrowserTestRunner;
  timeoutMs?: number;
  /** How long to keep awaiting one already-started provider request after its
   * soft observability threshold, before failing closed without a replay. */
  lateResultGraceMs?: number;
  /** Called synchronously at the rejection boundary for every semantic
   * attempt, including provider failures that produced no candidate. */
  onRejectedAttempt?: GeneratedVisualRejectedAttemptSink;
  /** Receives bounded receipt/model/usage proof without prompts or images. */
  onCouncilReceipt?: (
    observation: GeneratedVisualCouncilReceiptObservation,
  ) => void;
  abortSignal?: AbortSignal;
  checkCancelled?: () => void;
};

let activeGeneratedVisualizations = 0;
const generatedVisualWaiters: Array<{
  grant: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
}> = [];

function generatedVisualConcurrencyLimit(): number {
  return Math.max(
    1,
    Math.min(
      8,
      Number(process.env.LEARN_GENERATED_VISUAL_CONCURRENCY ?? 2) || 2,
    ),
  );
}

async function acquireGeneratedVisualSlot(
  signal?: AbortSignal,
): Promise<() => void> {
  if (signal?.aborted) throw new Error("generated visualization was cancelled");
  if (activeGeneratedVisualizations < generatedVisualConcurrencyLimit()) {
    activeGeneratedVisualizations += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const waiter: (typeof generatedVisualWaiters)[number] = {
        grant: resolve,
        reject,
        signal,
      };
      waiter.abort = () => {
        const index = generatedVisualWaiters.indexOf(waiter);
        if (index >= 0) generatedVisualWaiters.splice(index, 1);
        reject(new Error("generated visualization was cancelled"));
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      generatedVisualWaiters.push(waiter);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    while (generatedVisualWaiters.length > 0) {
      const waiter = generatedVisualWaiters.shift();
      if (!waiter) break;
      waiter.signal?.removeEventListener("abort", waiter.abort!);
      if (waiter.signal?.aborted) {
        waiter.reject(new Error("generated visualization was cancelled"));
        continue;
      }
      waiter.grant();
      return;
    }
    activeGeneratedVisualizations = Math.max(
      0,
      activeGeneratedVisualizations - 1,
    );
  };
}

async function createGeneratedVisualizationWithSlot(
  input: CreateGeneratedVisualizationInput,
): Promise<GeneratedVisualResult> {
  const enabled =
    String(process.env.LEARN_GENERATED_VISUALS_ENABLED ?? "true").trim() !==
    "false";
  if (!enabled)
    return {
      manifest: null,
      definition: null,
      errors: ["generated visuals are disabled"],
    };
  input.checkCancelled?.();
  if (input.abortSignal?.aborted)
    throw new Error("generated visualization was cancelled");
  if (input.reusePublishedArtifactOnRecovery) {
    const reusable = loadReusablePublishedGeneratedVisual({
      gardenDir: input.gardenDir,
      opportunity: input.opportunity,
      model: input.model,
      availableSourceAnchorIds: input.availableSourceAnchorIds,
      requireBrowserEvidence:
        input.runBrowserTests ??
        String(process.env.LEARN_GENERATED_VISUAL_BROWSER_TESTS ?? "true") !==
          "false",
    });
    if (reusable) {
      emit(input.onEvent, "visual_resume_artifact_reused", {
        gardenId: reusable.manifest!.gardenId,
        learningUnitId: reusable.manifest!.learningUnitId,
        visualizationId: reusable.manifest!.id,
        version: reusable.manifest!.version,
        sourceHash: reusable.manifest!.sourceHash,
        compiledHash: reusable.manifest!.compiledHash,
        generatorModel: reusable.manifest!.generatorModel,
        contractFingerprint: reusable.manifest!.similarityFingerprint,
        publicationGatesRevalidated: true,
        providerInvocations: 0,
      });
      return reusable;
    }
  }
  const id = input.opportunity.id;
  const version = nextGeneratedVisualVersion(input.gardenDir, id);
  const runId = `${nowIso()
    .replace(/[^0-9]/g, "")
    .slice(0, 17)}-${process.pid}`;
  const recoveryOwnerId = (input.recoveryOwnerId ?? runId).trim();
  if (
    input.durableRecoveryDir &&
    (!recoveryOwnerId || recoveryOwnerId.length > 200)
  ) {
    throw new Error("Generated-visual durable recovery owner is invalid.");
  }
  const recoveryOwnerHash = crypto
    .createHash("sha256")
    .update(
      `${input.opportunity.gardenId}\0${recoveryOwnerId}`,
      "utf8",
    )
    .digest("hex");
  const councilRecoveryFor = (
    phase: "author" | "critic",
    semanticAttempt: number,
    criticAttempt?: number,
    transportRecoveryAttempt = 1,
  ): GeneratedVisualCouncilRecoveryBoundary | undefined => {
    if (!input.durableRecoveryDir) return undefined;
    const invocationKey = [
      "generated-visual-v1",
      recoveryOwnerHash,
      id,
      `version-${version}`,
      phase,
      `semantic-${semanticAttempt}`,
      ...(criticAttempt === undefined ? [] : [`critic-${criticAttempt}`]),
      ...(transportRecoveryAttempt > 1
        ? [`transport-${transportRecoveryAttempt}`]
        : []),
    ].join("/");
    return {
      durableRecoveryDir: input.durableRecoveryDir,
      invocationKey,
      metadata: {
        gardenId: input.opportunity.gardenId,
        visualizationId: id,
        recoveryOwnerId,
        phase,
        semanticAttempt,
        ...(criticAttempt === undefined ? {} : { criticAttempt }),
        transportRecoveryAttempt,
        version,
      },
      onReceipt: (receipt) =>
        input.onCouncilReceipt?.({
          phase,
          semanticAttempt,
          ...(criticAttempt === undefined ? {} : { criticAttempt }),
          transportRecoveryAttempt,
          requestedModel: receipt.requestedModel,
          resolvedModel: receipt.resolvedModel,
          requestId: receipt.requestId,
          requestHash: receipt.requestHash,
          councilRunId: receipt.councilRunId,
          recovered: receipt.recovered,
          dispatched: receipt.dispatched,
          dispatchCount: receipt.dispatchCount,
          httpCompletionObserved: receipt.httpCompletionObserved,
          usage: receipt.usage,
        }),
    };
  };
  const maxAttempts = Math.max(
    1,
    Math.min(
      GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
      input.maxAttempts ??
        (Number(process.env.LEARN_GENERATED_VISUAL_MAX_ATTEMPTS ?? 3) || 3),
    ),
  );
  const candidateProvider = input.candidateProvider;
  const criticProvider = input.criticProvider;
  let previousSourceCode = "";
  let previousCandidate: GeneratedVisualizationCandidate | undefined;
  let previousPreviews: GeneratedVisualPreviewArtifact[] = [];
  let repairErrors: string[] = [];
  const repairHistory: GeneratedVisualRepairHistoryEntry[] = [];
  let lastFailure: GeneratedVisualResult["failureCategory"] = "generation";
  const configuredRequestTimeoutMs =
    input.timeoutMs ??
    (Number(
      process.env.LEARN_GENERATED_VISUAL_TIMEOUT_MS ??
        GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS,
    ) || GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS);
  const requestedTimeoutMs = Math.max(
    // Explicit values are a deterministic test/integration seam. Environment
    // configuration retains the production floor that prevents accidental
    // sub-five-second model deadlines.
    input.timeoutMs === undefined ? 5_000 : 1,
    Math.floor(configuredRequestTimeoutMs),
  );
  const configuredLateResultGraceMs =
    input.lateResultGraceMs ??
    Number(process.env.LEARN_GENERATED_VISUAL_LATE_RESULT_GRACE_MS);
  const requestedLateResultGraceMs = Math.max(
    1,
    Number.isFinite(configuredLateResultGraceMs)
      ? Math.floor(configuredLateResultGraceMs)
      : GENERATED_VISUAL_PROVIDER_LATE_RESULT_GRACE_MS,
  );
  const {
    timeoutMs: requestTimeoutMs,
    lateResultGraceMs,
  } = boundedGeneratedVisualProviderWait({
    timeoutMs: requestedTimeoutMs,
    lateResultGraceMs: requestedLateResultGraceMs,
  });
  const councilTransportRecoveryMaxAttempts =
    generatedVisualCouncilTransportRecoveryMaxAttempts();
  let authorTransportSemanticAttempt = 0;
  let authorTransportRecoveryAttempt = 1;
  let currentRepairAttempt = 0;
  const recordRepairFailure = (entry: Omit<
    GeneratedVisualRepairHistoryEntry,
    "attempt" | "candidateSnapshotHash"
  > & {
    candidate?: GeneratedVisualizationCandidate | null;
  }) => {
    // A provider/generation failure has no newly returned candidate. Do not
    // misattribute it to the prior repair candidate; that candidate remains
    // separately available to the next author request.
    const linkedCandidate = entry.candidate ?? undefined;
    appendGeneratedVisualRepairHistory(repairHistory, {
      attempt: currentRepairAttempt,
      failureCategory: entry.failureCategory,
      errors: entry.errors,
      ...(entry.critic ? { critic: entry.critic } : {}),
      ...(linkedCandidate
        ? {
            candidateSnapshotHash:
              generatedVisualizationCandidateSnapshotHash(linkedCandidate),
          }
        : {}),
    });
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (authorTransportSemanticAttempt !== attempt) {
      authorTransportSemanticAttempt = attempt;
      authorTransportRecoveryAttempt = 1;
    }
    currentRepairAttempt = attempt;
    input.checkCancelled?.();
    if (input.abortSignal?.aborted)
      throw new Error("generated visualization was cancelled");
    const startedAt = Date.now();
    const lifecycle: GeneratedVisualLifecycleRecord[] = [
      { status: "draft", at: nowIso(), attempt },
    ];
    emit(
      input.onEvent,
      attempt === 1 ? "visual_generation_started" : "visual_repair_started",
      {
        gardenId: input.opportunity.gardenId,
        learningUnitId: input.opportunity.learningUnitId,
        visualizationId: id,
        attempt,
        route: "generated_module",
        sourceAnchors: input.opportunity.sourceAnchorIds,
      },
    );
    let candidate: GeneratedVisualizationCandidate;
    const generationStartedAt = Date.now();
    const candidateRequest = {
      client: input.client,
      model: input.model,
      opportunity: input.opportunity,
      pageMarkdown: input.pageMarkdown,
      sourceContext: input.sourceContext,
      sourceFigureSummaries: input.sourceFigureSummaries,
      formulaDefinitions: input.formulaDefinitions,
      previousSourceCode: previousSourceCode || undefined,
      previousCandidate,
      // Each provider request receives an immutable time-of-request snapshot;
      // later semantic failures must not mutate evidence already supplied to a
      // model or a custom candidate boundary.
      repairHistory: repairHistory.length
        ? generatedVisualRepairHistorySnapshot(repairHistory)
        : undefined,
      previews: previousPreviews.length ? previousPreviews : undefined,
      errors: repairErrors.length ? repairErrors : undefined,
      timeoutMs: requestTimeoutMs,
    };
    let candidateBoundaryResult:
      | { kind: "candidate"; candidate: GeneratedVisualizationCandidate }
      | {
          kind: "raw";
          raw: { content: string; tokenUsage?: GeneratedVisualTokenUsage };
        };
    try {
      candidateBoundaryResult = await retryGeneratedVisualProviderRequest({
        timeoutMs: requestTimeoutMs,
        lateResultGraceMs,
        externalSignal: input.abortSignal,
        checkCancelled: input.checkCancelled,
        work: async (signal) => candidateProvider
          ? {
              kind: "candidate" as const,
              candidate: await candidateProvider({ ...candidateRequest, signal }),
            }
          : {
              kind: "raw" as const,
              raw: await requestGeneratedVisualizationCandidateRaw({
                ...candidateRequest,
                councilRecovery: councilRecoveryFor(
                  "author",
                  attempt,
                  undefined,
                  authorTransportRecoveryAttempt,
                ),
                signal,
              }),
            },
        onLateResultWait: ({ timeoutMs, lateResultGraceMs, hardTimeoutMs }) => {
          emit(input.onEvent, "visual_generation_late_result_wait_started", {
            visualizationId: id,
            attempt,
            timeoutMs,
            lateResultGraceMs,
            hardTimeoutMs,
            duplicateRequestSuppressed: true,
          });
        },
        onLateResultRecovered: ({ waitedMs }) => {
          emit(input.onEvent, "visual_generation_late_result_adopted", {
            visualizationId: id,
            attempt,
            waitedMs,
            duplicateRequestSuppressed: true,
          });
        },
      });
    } catch (error) {
      // A thrown provider call has no returned semantic candidate. Ambiguous
      // and arbitrary provider failures remain terminal. An exact durable
      // Council `failed` receipt proves that all dispatch generations ended
      // without a final answer, so a fresh invocation key may recover the same
      // semantic attempt without consuming its repair budget.
      const canStartTransportRecoveryAttempt =
        !candidateProvider &&
        !input.abortSignal?.aborted &&
        isTerminalGeneratedVisualCouncilNoAnswer(error) &&
        authorTransportRecoveryAttempt < councilTransportRecoveryMaxAttempts;
      const providerFailure =
        error instanceof Error ? error.message : "candidate generation failed";
      try {
        emit(input.onEvent, "visual_generation_provider_failed", {
          visualizationId: id,
          attempt,
          transportRecoveryAttempt: authorTransportRecoveryAttempt,
          providerInvocations: 1,
          duplicateRequestSuppressed: true,
          failureCategory: "generation",
          reason: providerFailure,
          durationMs: Date.now() - startedAt,
        });
        if (canStartTransportRecoveryAttempt) {
          emit(input.onEvent, "visual_generation_terminal_receipt_retry", {
            visualizationId: id,
            attempt,
            semanticAttempt: attempt,
            transportRecoveryAttempt: authorTransportRecoveryAttempt,
            nextTransportRecoveryAttempt: authorTransportRecoveryAttempt + 1,
            requestId: error.requestId,
            requestHash: error.requestHash,
            terminalReceiptState: error.state,
            duplicateRequestSuppressed: true,
          });
        } else {
          lastFailure = "generation";
          repairErrors = [providerFailure];
          recordRepairFailure({
            failureCategory: "generation",
            errors: repairErrors,
          });
          writeRejectedAttempt({
            gardenDir: input.gardenDir,
            id,
            runId,
            attempt,
            candidate: null,
            category: "generation",
            errors: repairErrors,
            lifecycle,
            onRejectedAttempt: input.onRejectedAttempt,
            onEvent: input.onEvent,
          });
        }
      } catch {
        // Diagnostic persistence is subordinate to the provider error.
      }
      if (canStartTransportRecoveryAttempt) {
        const delayMs = generatedVisualCouncilTransportRecoveryDelayMs(
          authorTransportRecoveryAttempt,
        );
        authorTransportRecoveryAttempt += 1;
        await waitForGeneratedVisualCouncilTransportRecovery({
          delayMs,
          externalSignal: input.abortSignal,
          checkCancelled: input.checkCancelled,
        });
        // The for-loop update restores this same semantic attempt. Only a
        // returned and rejected candidate is allowed to advance it.
        attempt -= 1;
        continue;
      }
      throw error;
    }
    if (candidateBoundaryResult.kind === "candidate") {
      if (!candidateBoundaryResult.candidate) {
        throw new Error(
          "generated visualization candidate provider returned no candidate; no semantic repair request was issued",
        );
      }
      candidate = candidateBoundaryResult.candidate;
    } else {
      const envelope = parseGeneratedVisualizationCandidateRaw(
        candidateBoundaryResult.raw,
      );
      const missingCandidateProblem = generatedVisualMissingCandidateProblem(
        candidateBoundaryResult.raw.content,
        "generated visualization candidate",
      );
      if (missingCandidateProblem) {
        throw new Error(
          envelope.errors[0] ??
            missingCandidateProblem,
        );
      }
      if (!envelope.candidate) {
        // Nonempty returned model text plus exact local parser/schema problems
        // is concrete semantic evidence for one bounded corrected request.
        lastFailure = "generation";
        repairErrors = envelope.errors;
        recordRepairFailure({
          failureCategory: "generation",
          errors: repairErrors,
        });
        writeRejectedAttempt({
          gardenDir: input.gardenDir,
          id,
          runId,
          attempt,
          candidate: null,
          category: "generation",
          errors: repairErrors,
          lifecycle,
          onRejectedAttempt: input.onRejectedAttempt,
          onEvent: input.onEvent,
        });
        emit(input.onEvent, "visual_generation_failed", {
          visualizationId: id,
          attempt,
          failureCategory: "generation",
          reason: repairErrors.join("; "),
          returnedCandidateValidated: true,
          durationMs: Date.now() - startedAt,
        });
        continue;
      }
      candidate = envelope.candidate;
    }
    previousSourceCode = candidate.sourceCode;
    previousCandidate = candidate;
    previousPreviews = [];
    emit(input.onEvent, "visual_model_generation_completed", {
      visualizationId: id,
      attempt,
      durationMs: Date.now() - generationStartedAt,
      ...(candidate.tokenUsage ? { tokenUsage: candidate.tokenUsage } : {}),
    });
    const compilationStartedAt = Date.now();
    const compilation = await input.compilerRunner(
      candidate.sourceCode,
      input.opportunity,
      input.abortSignal,
    );
    if (!compilation.definition) {
      lastFailure = "validation";
      repairErrors = compilation.validation.errors;
      recordRepairFailure({
        failureCategory: "validation",
        errors: repairErrors,
        candidate,
      });
      writeRejectedAttempt({
        gardenDir: input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        category: "validation",
        errors: repairErrors,
        lifecycle,
        evidence: {
          validation: compilation.validation,
        },
        onRejectedAttempt: input.onRejectedAttempt,
        onEvent: input.onEvent,
      });
      emit(input.onEvent, "visual_static_validation_failed", {
        visualizationId: id,
        attempt,
        failureCategory: "validation",
        reason: repairErrors.join("; "),
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
    emit(input.onEvent, "visual_compilation_completed", {
      visualizationId: id,
      attempt,
      sourceHash: compilation.sourceHash,
      cacheHit: compilation.cacheHit,
      durationMs: Date.now() - compilationStartedAt,
    });
    const definition = compilation.definition;
    lifecycle.push(
      { status: "validated", at: nowIso(), attempt },
      { status: "compiled", at: nowIso(), attempt },
    );
    emit(input.onEvent, "visual_generation_completed", {
      visualizationId: id,
      attempt,
      sourceHash: compilation.sourceHash,
      durationMs: Date.now() - startedAt,
    });

    const deterministicStartedAt = Date.now();
    const deterministicTests = runGeneratedVisualDeterministicTests({
      definition,
      testCases: candidate.testCases,
      opportunity: input.opportunity,
      availableSourceAnchorIds: input.availableSourceAnchorIds,
    });
    emit(input.onEvent, "visual_semantic_tests_completed", {
      visualizationId: id,
      attempt,
      passed: deterministicTests.passed,
      durationMs: Date.now() - deterministicStartedAt,
    });
    const stagingDir = path.join(
      generatedVisualArtifactDir(input.gardenDir, id),
      ".staging",
      `${version}-${attempt}`,
    );
    const shouldRunBrowser =
      input.runBrowserTests ??
      String(process.env.LEARN_GENERATED_VISUAL_BROWSER_TESTS ?? "true") !==
        "false";
    const browserStartedAt = Date.now();
    const browser = shouldRunBrowser
      ? await input.browserTestRunner({
          definition,
          outputDir: stagingDir,
          signal: input.abortSignal,
        })
      : {
          tests: [
            {
              name: "browser tests explicitly disabled",
              passed: true,
              detail: "development override",
            },
          ],
          browser: undefined,
          previews: undefined,
        };
    // Never teach a repair model from a partial matrix. The runtime gate below
    // rejects an incomplete capture, and only a complete labelled matrix can
    // become evidence for a later model-authored revision.
    previousPreviews = browser.browser?.previewMatrixComplete
      ? [...(browser.previews ?? [])]
      : [];
    const eventProfileCleanup =
      canonicalGeneratedVisualBrowserProfileCleanupReceipt(
        browser.browser?.profileCleanup,
      );
    emit(input.onEvent, "visual_browser_tests_completed", {
      visualizationId: id,
      attempt,
      enabled: shouldRunBrowser,
      passed: browser.tests.every((test) => test.passed),
      ...(browser.browser?.previewMatrixReceipt
        ? { previewMatrixReceipt: browser.browser.previewMatrixReceipt }
        : {}),
      ...(eventProfileCleanup
        ? { profileCleanup: eventProfileCleanup }
        : {}),
      durationMs: Date.now() - browserStartedAt,
    });
    input.checkCancelled?.();
    if (input.abortSignal?.aborted)
      throw new Error("generated visualization was cancelled");
    deterministicTests.runtimeTests.push(...browser.tests);
    deterministicTests.browser = browser.browser;
    deterministicTests.passed = [
      ...deterministicTests.staticTests,
      ...deterministicTests.semanticTests,
      ...deterministicTests.runtimeTests,
    ].every((test) => test.passed);
    if (!deterministicTests.passed) {
      lastFailure = "runtime";
      repairErrors = [
        ...deterministicTests.staticTests,
        ...deterministicTests.semanticTests,
        ...deterministicTests.runtimeTests,
      ]
        .filter((test) => !test.passed)
        .map((test) => `${test.name}: ${test.detail ?? "failed"}`);
      recordRepairFailure({
        failureCategory: "runtime",
        errors: repairErrors,
        candidate,
      });
      writeRejectedAttempt({
        gardenDir: input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        category: "runtime",
        errors: repairErrors,
        lifecycle,
        evidence: {
          validation: compilation.validation,
          tests: deterministicTests,
        },
        onRejectedAttempt: input.onRejectedAttempt,
        onEvent: input.onEvent,
      });
      emit(input.onEvent, "visual_runtime_test_failed", {
        visualizationId: id,
        attempt,
        failureCategory: "runtime",
        reason: repairErrors.join("; "),
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
    lifecycle.push({ status: "tested", at: nowIso(), attempt });

    let critic: GeneratedVisualCriticRecord | null = null;
    let criticFailure = "critic failed";
    const criticAttempts = Math.max(
      1,
      Math.min(
        3,
        input.criticMaxAttempts ??
          (Number(process.env.LEARN_GENERATED_VISUAL_CRITIC_ATTEMPTS ?? 2) || 2),
      ),
    );
    const criticStartedAt = Date.now();
    // Author and critic belong to one generated-visual operation and one
    // immutable Learn model policy. A hidden process-wide critic override can
    // otherwise violate the selected model after the author request has
    // already been issued and make exact receipt accounting irreconcilable.
    const criticModel = input.model;
    let priorCriticFailure: string | undefined;
    let criticTransportProtocolAttempt = 0;
    let criticTransportRecoveryAttempt = 1;
    for (
      let criticAttempt = 1;
      criticAttempt <= criticAttempts;
      criticAttempt += 1
    ) {
      if (criticTransportProtocolAttempt !== criticAttempt) {
        criticTransportProtocolAttempt = criticAttempt;
        criticTransportRecoveryAttempt = 1;
      }
      const criticRequest = {
        client: input.client,
        model: criticModel,
        opportunity: input.opportunity,
        candidate,
        definition,
        sourceContext: input.sourceContext,
        sourceFigureSummaries: input.sourceFigureSummaries,
        formulaDefinitions: input.formulaDefinitions,
        previewPath: browser.browser?.screenshotCreated
          ? path.join(stagingDir, "preview.png")
          : undefined,
        previews: browser.previews,
        tests: deterministicTests,
        priorCriticFailure,
        timeoutMs: requestTimeoutMs,
      };
      let criticBoundaryResult:
        | { kind: "critic"; critic: GeneratedVisualCriticRecord }
        | {
            kind: "raw";
            raw: { content: string; tokenUsage?: GeneratedVisualTokenUsage };
          };
      try {
        criticBoundaryResult = await retryGeneratedVisualProviderRequest({
          timeoutMs: requestTimeoutMs,
          lateResultGraceMs,
          externalSignal: input.abortSignal,
          checkCancelled: input.checkCancelled,
          work: async (signal) => criticProvider
            ? {
                kind: "critic" as const,
                critic: await criticProvider({ ...criticRequest, signal }),
              }
            : {
                kind: "raw" as const,
                raw: await requestGeneratedVisualizationCriticRaw({
                  ...criticRequest,
                  councilRecovery: councilRecoveryFor(
                    "critic",
                    attempt,
                    criticAttempt,
                    criticTransportRecoveryAttempt,
                  ),
                  signal,
                }),
              },
          onLateResultWait: ({ timeoutMs, lateResultGraceMs, hardTimeoutMs }) => {
            emit(input.onEvent, "visual_critic_late_result_wait_started", {
              visualizationId: id,
              attempt,
              criticAttempt,
              timeoutMs,
              lateResultGraceMs,
              hardTimeoutMs,
              duplicateRequestSuppressed: true,
            });
          },
          onLateResultRecovered: ({ waitedMs }) => {
            emit(input.onEvent, "visual_critic_late_result_adopted", {
              visualizationId: id,
              attempt,
              criticAttempt,
              waitedMs,
              duplicateRequestSuppressed: true,
            });
          },
        });
      } catch (error) {
        const criticProtocolFailure = error instanceof Error &&
          /critic returned (?:an )?invalid (?:json|record|verdict)/iu.test(error.message);
        if (criticProtocolFailure && !input.abortSignal?.aborted) {
          criticFailure = error.message;
          priorCriticFailure = criticFailure;
          if (criticAttempt < criticAttempts) {
            emit(input.onEvent, "visual_critic_retry", {
              visualizationId: id,
              attempt,
              criticAttempt,
              reason: criticFailure,
              returnedCandidateValidated: true,
            });
          }
          continue;
        }
        const canStartTransportRecoveryAttempt =
          !criticProvider &&
          !input.abortSignal?.aborted &&
          isTerminalGeneratedVisualCouncilNoAnswer(error) &&
          criticTransportRecoveryAttempt < councilTransportRecoveryMaxAttempts;
        // A thrown critic request is not a rejected critic candidate. Keep
        // diagnostics best-effort. Only an exact terminal no-answer Council
        // receipt can start a fresh transport recovery for this same critic
        // attempt; it must not consume critic or semantic repair capacity.
        try {
          criticFailure = error instanceof Error ? error.message : "critic failed";
          emit(input.onEvent, "visual_critic_provider_failed", {
            visualizationId: id,
            attempt,
            criticAttempt,
            transportRecoveryAttempt: criticTransportRecoveryAttempt,
            providerInvocations: 1,
            duplicateRequestSuppressed: true,
            failureCategory: "critic",
            reason: criticFailure,
            durationMs: Date.now() - criticStartedAt,
          });
          if (canStartTransportRecoveryAttempt) {
            emit(input.onEvent, "visual_critic_terminal_receipt_retry", {
              visualizationId: id,
              attempt,
              criticAttempt,
              semanticAttempt: attempt,
              transportRecoveryAttempt: criticTransportRecoveryAttempt,
              nextTransportRecoveryAttempt: criticTransportRecoveryAttempt + 1,
              requestId: error.requestId,
              requestHash: error.requestHash,
              terminalReceiptState: error.state,
              duplicateRequestSuppressed: true,
            });
          }
        } catch {
          // Diagnostic telemetry is subordinate to the provider error.
        }
        if (canStartTransportRecoveryAttempt) {
          const delayMs = generatedVisualCouncilTransportRecoveryDelayMs(
            criticTransportRecoveryAttempt,
          );
          criticTransportRecoveryAttempt += 1;
          await waitForGeneratedVisualCouncilTransportRecovery({
            delayMs,
            externalSignal: input.abortSignal,
            checkCancelled: input.checkCancelled,
          });
          // The for-loop update restores this same critic attempt.
          criticAttempt -= 1;
          continue;
        }
        throw error;
      }
      if (criticBoundaryResult.kind === "critic") {
        if (!criticBoundaryResult.critic) {
          throw new Error(
            "generated visualization critic provider returned no verdict; no semantic retry was issued",
          );
        }
        critic = criticBoundaryResult.critic;
        break;
      }
      const parsedCritic = parseGeneratedVisualizationCriticRaw({
        ...criticBoundaryResult.raw,
        opportunityId: input.opportunity.id,
      });
      const missingCandidateProblem = generatedVisualMissingCandidateProblem(
        criticBoundaryResult.raw.content,
        "critic",
      );
      if (missingCandidateProblem) {
        throw new Error(
          parsedCritic.problem ?? missingCandidateProblem,
        );
      }
      if (parsedCritic.critic) {
        critic = parsedCritic.critic;
        break;
      }
      criticFailure = parsedCritic.problem ?? "critic returned an invalid verdict";
      priorCriticFailure = criticFailure;
      if (criticAttempt < criticAttempts) {
        emit(input.onEvent, "visual_critic_retry", {
          visualizationId: id,
          attempt,
          criticAttempt,
          reason: criticFailure,
          returnedCandidateValidated: true,
        });
      }
    }
    if (!critic) {
      lastFailure = "critic";
      repairErrors = [
        `Critic review could not complete after ${criticAttempts} attempt${criticAttempts === 1 ? "" : "s"}: ${criticFailure}`,
      ];
      recordRepairFailure({
        failureCategory: "critic",
        errors: repairErrors,
        candidate,
      });
      writeRejectedAttempt({
        gardenDir: input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        category: "critic",
        errors: repairErrors,
        lifecycle,
        evidence: {
          validation: compilation.validation,
          tests: deterministicTests,
        },
        onRejectedAttempt: input.onRejectedAttempt,
        onEvent: input.onEvent,
      });
      emit(input.onEvent, "visual_critic_failed", {
        visualizationId: id,
        attempt,
        criticAttempts,
        failureCategory: "critic",
        reason: criticFailure,
        durationMs: Date.now() - criticStartedAt,
      });
      break;
    }
    emit(input.onEvent, "visual_critic_completed", {
      visualizationId: id,
      attempt,
      approved: critic.approved,
      durationMs: Date.now() - criticStartedAt,
      ...(critic.tokenUsage ? { tokenUsage: critic.tokenUsage } : {}),
    });
    if (!critic.approved) {
      lastFailure = "critic";
      repairErrors = [critic.reason, ...critic.requestedChanges].filter(
        Boolean,
      );
      recordRepairFailure({
        failureCategory: "critic",
        errors: repairErrors,
        critic: {
          reason: critic.reason,
          requestedChanges: critic.requestedChanges,
        },
        candidate,
      });
      writeRejectedAttempt({
        gardenDir: input.gardenDir,
        id,
        runId,
        attempt,
        candidate,
        category: "critic",
        errors: repairErrors,
        lifecycle,
        evidence: {
          validation: compilation.validation,
          tests: deterministicTests,
          critic,
        },
        onRejectedAttempt: input.onRejectedAttempt,
        onEvent: input.onEvent,
      });
      emit(input.onEvent, "visual_critic_rejected", {
        visualizationId: id,
        attempt,
        failureCategory: "critic",
        reason: critic.reason,
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
    lifecycle.push({ status: "critic_approved", at: nowIso(), attempt });

    const previous = loadGeneratedVisualManifest(input.gardenDir, id);
    const manifest: GeneratedVisualizationManifest = {
      schemaVersion: GENERATED_VISUAL_SCHEMA_VERSION,
      sdkVersion: VISUAL_SDK_VERSION,
      id,
      gardenId: input.opportunity.gardenId,
      learningUnitId: input.opportunity.learningUnitId,
      title: candidate.title || definition.title,
      description: candidate.explanation || definition.description,
      learningObjective: input.opportunity.learningObjective,
      sourceAnchorIds: input.opportunity.sourceAnchorIds,
      sourceVisualIds: input.opportunity.sourceVisualIds,
      sourceVisualRelationships: input.opportunity.sourceVisualRelationships,
      conceptIds: input.opportunity.conceptIds,
      insertionAnchor: input.opportunity.insertionAnchor,
      targetPage: input.opportunity.targetPage,
      targetHeading: input.opportunity.targetHeading,
      sourceHash: compilation.sourceHash,
      compiledHash: compilation.compiledHash,
      status: "published",
      generatedAt: nowIso(),
      generatorModel: input.model,
      generationAttempt: attempt,
      version,
      ...(previous ? { previousVersion: previous.version } : {}),
      artifactPath: artifactRelativePath(id),
      similarityFingerprint: input.opportunity.similarityFingerprint,
    };
    saveGeneratedVisualArtifact({
      gardenDir: input.gardenDir,
      manifest,
      sourceCode: candidate.sourceCode,
      compiledJavaScript: compilation.compiledJavaScript,
      validation: compilation.validation,
      critic,
      tests: deterministicTests,
      lifecycle: [...lifecycle, { status: "published", at: nowIso(), attempt }],
      previewPath: path.join(stagingDir, "preview.png"),
    });
    try {
      fs.rmSync(
        path.join(generatedVisualArtifactDir(input.gardenDir, id), ".staging"),
        {
          recursive: true,
          force: true,
        },
      );
    } catch {
      // Staging cleanup is best-effort; it is never indexed or published.
    }
    emit(input.onEvent, "visual_published", {
      gardenId: manifest.gardenId,
      learningUnitId: manifest.learningUnitId,
      visualizationId: id,
      attempt,
      version,
      route: "generated_module",
      sourceAnchors: manifest.sourceAnchorIds,
      artifactPaths: [manifest.artifactPath],
      previousStatus: previous?.status ?? "none",
      resultingStatus: manifest.status,
      durationMs: Date.now() - startedAt,
    });
    return { manifest, definition, errors: [] };
  }

  emit(input.onEvent, "visual_fallback_used", {
    gardenId: input.opportunity.gardenId,
    learningUnitId: input.opportunity.learningUnitId,
    visualizationId: id,
    failureCategory: lastFailure,
    reason:
      repairErrors.join("; ") || "generated visualization attempts exhausted",
    resultingStatus: "rejected",
  });
  return {
    manifest: null,
    definition: null,
    errors: repairErrors.length
      ? repairErrors
      : ["generated visualization attempts exhausted"],
    failureCategory: lastFailure,
  };
}

export async function createGeneratedVisualization(
  input: CreateGeneratedVisualizationInput,
): Promise<GeneratedVisualResult> {
  const release = await acquireGeneratedVisualSlot(input.abortSignal);
  try {
    return await createGeneratedVisualizationWithSlot(input);
  } finally {
    release();
  }
}

export function rollbackGeneratedVisualization(input: {
  gardenDir: string;
  id: string;
  version: number;
}): GeneratedVisualizationManifest {
  const targetDir = path.join(
    generatedVisualArtifactDir(input.gardenDir, input.id),
    "versions",
    String(input.version),
  );
  const manifestPath = path.join(targetDir, "manifest.json");
  if (!externalRuntimePathExists(manifestPath))
    throw new Error(`Version ${input.version} does not exist`);
  const manifest = JSON.parse(
    externalRuntimeReadUtf8(manifestPath),
  ) as GeneratedVisualizationManifest;
  if (manifest.id !== input.id || manifest.version !== input.version) {
    throw new Error("Generated visualization version manifest is inconsistent");
  }
  const validation = JSON.parse(
    externalRuntimeReadUtf8(path.join(targetDir, "validation.json")),
  ) as GeneratedVisualValidationRecord;
  const tests = JSON.parse(
    externalRuntimeReadUtf8(path.join(targetDir, "tests.json")),
  ) as GeneratedVisualTestsRecord;
  const critic = JSON.parse(
    externalRuntimeReadUtf8(path.join(targetDir, "critic.json")),
  ) as GeneratedVisualCriticRecord;
  const source = externalRuntimeReadUtf8(path.join(targetDir, "source.tsx"));
  if (
    manifest.status !== "published" ||
    sha256(source) !== manifest.sourceHash ||
    validation.valid !== true ||
    tests.passed !== true ||
    critic.approved !== true ||
    !loadGeneratedVisualDefinition(input.gardenDir, input.id, input.version)
  ) {
    throw new Error(
      `Version ${input.version} no longer passes generated visualization publication gates`,
    );
  }
  copyArtifactFiles(
    targetDir,
    generatedVisualArtifactDir(input.gardenDir, input.id),
  );
  writeJson(
    path.join(
      generatedVisualArtifactDir(input.gardenDir, input.id),
      "current.json",
    ),
    {
      id: input.id,
      version: input.version,
      manifest: `versions/${input.version}/manifest.json`,
    },
  );
  updateGeneratedVisualIndex(input.gardenDir, manifest);
  return manifest;
}
