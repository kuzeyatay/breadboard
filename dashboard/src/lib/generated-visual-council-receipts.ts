import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

import {
  canonicalCouncilJsonV1,
  councilRequestHashV1,
  type CouncilRequestEnvelopeV1,
  withResolvedCouncilIdentityV1,
} from "./council-request-hash.ts";
import { strictChatMockInternalRecoveryUrl } from "./learn-planning-internal-url.ts";
import {
  expectedStrictLearnModelRoute,
  planningReceiptProvesOneExactModelCall,
} from "./learn-planning-route-proof.ts";
import { repositoryRoot } from "./runtime-paths.ts";

const RECEIPT_SCHEMA_VERSION = 1 as const;
const RECEIPT_DIRECTORY_NAME = "generated-visual-council-receipts";
const REQUEST_ID_RE = /^lrq_[A-Za-z0-9_-]{8,120}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BINDING_FILE_RE = /^([0-9a-f]{64})\.([0-9a-f]{64})\.binding\.json$/;
const MARKER_FILE_RE =
  /^([0-9a-f]{64})\.([0-9a-f]{64})\.(dispatch|redispatch|response|completed|failed)\.json$/;
const TEXT_CONTENT_PART_TYPES = new Set([
  "input_text",
  "output_text",
  "text",
  "summary_text",
]);
const IMAGE_DETAIL_VALUES = new Set(["auto", "low", "high", "original"]);

export const GENERATED_VISUAL_COUNCIL_REASONING = Object.freeze({
  effort: "max",
  summary: "detailed",
});

export type GeneratedVisualCouncilReceiptState =
  | "started"
  | "failed"
  | "not_found"
  | "conflict"
  | "corrupt";

export class GeneratedVisualCouncilReceiptError extends Error {
  readonly state: GeneratedVisualCouncilReceiptState;
  readonly requestId?: string;
  readonly requestHash?: string;

  constructor(
    state: GeneratedVisualCouncilReceiptState,
    message: string,
    binding?: { requestId?: string; requestHash?: string },
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GeneratedVisualCouncilReceiptError";
    this.state = state;
    this.requestId = binding?.requestId;
    this.requestHash = binding?.requestHash;
  }
}

export interface GeneratedVisualCouncilCompletionRequest
  extends Record<string, unknown> {
  model: string;
  messages: unknown[];
  max_completion_tokens: number;
  taskType?: string;
  gardenId?: string;
  pageId?: string;
  sourceContext?: unknown;
  councilModeOverride?: string;
  reasoning?: {
    effort?: unknown;
    summary?: unknown;
  };
}

export interface PreparedGeneratedVisualCouncilRequest {
  request: GeneratedVisualCouncilCompletionRequest & {
    reasoning: { effort: "max"; summary: "detailed" };
  };
  envelope: CouncilRequestEnvelopeV1;
  requestHash: string;
  route: {
    requestedModel: string;
    resolvedModel: string;
    provider: string;
    upstreamModel: string;
  };
}

export interface GeneratedVisualCouncilReceiptUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  callCount: 1;
  reportedCallCount: 1;
}

export interface GeneratedVisualCouncilReceiptResult {
  content: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
  usage: GeneratedVisualCouncilReceiptUsage;
  councilRunId: string;
  councilMode: "direct_council";
  requestedModel: string;
  resolvedModel: string;
  requestId: string;
  requestHash: string;
  recovered: boolean;
  /** True only when this helper invocation called chat.completions.create. */
  dispatched: boolean;
  /** Number of SDK create calls made by this helper invocation (0-2). */
  dispatchCount: 0 | 1 | 2;
  /** True only when a validated HTTP completion, rather than receipt-only
   * recovery, supplied this invocation's accepted result. */
  httpCompletionObserved: boolean;
}

type RecoveryMetadataValue = string | number | boolean | null;
export type GeneratedVisualCouncilRecoveryMetadata = Readonly<
  Record<string, RecoveryMetadataValue>
>;

interface GeneratedVisualCouncilClient {
  baseURL?: unknown;
  chat: {
    completions: {
      create: (
        request: Record<string, unknown>,
        options: { signal?: AbortSignal; maxRetries: 0 },
      ) => Promise<unknown>;
    };
  };
}

type RecoveryFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export interface RunGeneratedVisualCouncilRequestInput {
  client: GeneratedVisualCouncilClient;
  /** Stable per-garden runtime root. It must not be inside a swappable garden
   * or a disposable Learn staging tree. */
  durableRecoveryDir: string;
  /** Stable only for one logical author/critic invocation. A new deliberate
   * regeneration must use a new key. */
  invocationKey: string;
  recoveryMetadata?: GeneratedVisualCouncilRecoveryMetadata;
  request: GeneratedVisualCouncilCompletionRequest;
  /** Enable only with a ChatMock build whose strict direct_council path keeps
   * image_url parts on the exact provider request and redacts ledger copies. */
  allowImageUrlParts?: boolean;
  signal?: AbortSignal;
  fetchImpl?: RecoveryFetch;
  requestIdFactory?: () => string;
  now?: () => string;
}

export interface MergeGeneratedVisualCouncilReceiptsResult {
  copiedFiles: number;
  identicalFiles: number;
}

interface BindingRecordUnsigned {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  kind: "generated_visual_council_binding";
  invocationKey: string;
  invocationKeyHash: string;
  requestId: string;
  requestHash: string;
  requestedModel: string;
  resolvedModel: string;
  provider: string;
  upstreamModel: string;
  councilMode: "direct_council";
  taskType: string;
  gardenId: string | null;
  pageId: string | null;
  metadata: Record<string, RecoveryMetadataValue>;
  createdAt: string;
  adoptedFromInvocationKeyHash?: string;
}

interface BindingRecord extends BindingRecordUnsigned {
  integrityHash: string;
}

type MarkerKind =
  | "generated_visual_council_dispatch"
  | "generated_visual_council_redispatch"
  | "generated_visual_council_response"
  | "generated_visual_council_completion"
  | "generated_visual_council_failure";

interface MarkerRecordUnsigned {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  kind: MarkerKind;
  invocationKeyHash: string;
  requestId: string;
  requestHash: string;
  at: string;
  councilRunId?: string;
  responseHash?: string;
  usageHash?: string;
  httpProofState?: "valid" | "invalid";
  failureCode?: string;
  redispatchReason?: "receipt_not_found" | "request_failed";
  receiptDispatchGeneration?: 1;
  receiptDispatchCount?: 1;
  receiptRedispatchCount?: 0;
  receiptRedispatchAllowed?: true;
  receiptProofHash?: string;
}

interface MarkerRecord extends MarkerRecordUnsigned {
  integrityHash: string;
}

interface BindingEntry {
  basePath: string;
  binding: BindingRecord;
  dispatch: MarkerRecord | null;
  redispatch: MarkerRecord | null;
  response: MarkerRecord | null;
  completion: MarkerRecord | null;
  failure: MarkerRecord | null;
  state: "prepared" | "started" | "completed" | "failed";
}

interface ReceiptResult {
  councilRunId: string;
  councilMode: "direct_council";
  requestedModel: string;
  resolvedModel: string;
  finalAnswer: string;
  responseHash: string;
  usage: GeneratedVisualCouncilReceiptUsage;
  modelRouting: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
}

interface InvocationExecution {
  dispatchCount: 0 | 1 | 2;
}

interface FailedReceiptProof {
  dispatchGeneration: 1 | 2;
  dispatchCount: 1 | 2;
  redispatchCount: 0 | 1;
  redispatchAllowed: boolean;
  failureCode: "council_no_final_answer";
  attempts: Record<string, unknown>[];
}

type SameReceiptRedispatchReason = "receipt_not_found" | "request_failed";

function recordDispatch(execution: InvocationExecution): void {
  if (execution.dispatchCount === 2) {
    throw receiptError(
      "conflict",
      "Generated-visual receipt boundary refused a third SDK dispatch.",
    );
  }
  execution.dispatchCount = execution.dispatchCount === 0 ? 1 : 2;
}

function assertReceiptContinuationActive(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

type ReceiptLookup =
  | { state: "completed"; result: ReceiptResult }
  | {
      state: "failed";
      code: string;
      proof?: FailedReceiptProof;
      cause?: unknown;
    }
  | {
      state: Exclude<GeneratedVisualCouncilReceiptState, "failed">;
      code: string;
      cause?: unknown;
    };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalHash(value: unknown): string {
  return sha256(canonicalCouncilJsonV1(value));
}

function exactJson(value: unknown): string {
  return canonicalCouncilJsonV1(value);
}

function receiptError(
  state: GeneratedVisualCouncilReceiptState,
  message: string,
  binding?: { requestId?: string; requestHash?: string },
  cause?: unknown,
): GeneratedVisualCouncilReceiptError {
  return new GeneratedVisualCouncilReceiptError(state, message, binding, cause);
}

function jsonTransportClone(value: unknown): unknown {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw receiptError(
      "conflict",
      "Generated-visual Council request is not JSON transport-safe.",
      undefined,
      error,
    );
  }
  if (encoded === undefined) {
    throw receiptError(
      "conflict",
      "Generated-visual Council request has no JSON transport representation.",
    );
  }
  return JSON.parse(encoded) as unknown;
}

function requestContainsUnsupportedParts(
  messages: unknown[],
  allowImageUrlParts: boolean,
): boolean {
  for (const message of messages) {
    const record = recordValue(message);
    if (!record) return true;
    if (typeof record.content === "string") continue;
    if (!Array.isArray(record.content)) return true;
    for (const part of record.content) {
      const contentPart = recordValue(part);
      if (!contentPart) return true;
      const type = String(contentPart.type ?? "");
      if (
        TEXT_CONTENT_PART_TYPES.has(type) &&
        typeof contentPart.text === "string" &&
        Object.keys(contentPart).every((key) => key === "type" || key === "text")
      ) {
        continue;
      }
      const imageValue = contentPart.image_url;
      const image = recordValue(imageValue);
      const supportedImage =
        (typeof imageValue === "string" && Boolean(imageValue)) ||
        Boolean(
          image &&
          typeof image.url === "string" &&
          image.url &&
          Object.keys(image).every((key) => key === "url" || key === "detail") &&
          (image.detail === undefined ||
            (typeof image.detail === "string" && IMAGE_DETAIL_VALUES.has(image.detail))),
        );
      if (
        allowImageUrlParts &&
        type === "image_url" &&
        Object.keys(contentPart).every(
          (key) => key === "type" || key === "image_url",
        ) &&
        supportedImage
      ) continue;
      return true;
    }
  }
  return false;
}

function assertNoConflictingAliases(request: Record<string, unknown>): void {
  const forbidden = [
    "clientRequestId",
    "client_request_id",
    "clientRequestHash",
    "client_request_hash",
    "clientRequestRedispatch",
    "client_request_redispatch",
    "task_type",
    "garden_id",
    "page_id",
    "source_context",
    "council_mode_override",
    "max_tokens",
  ];
  const present = forbidden.filter((key) => Object.hasOwn(request, key));
  if (present.length > 0) {
    throw receiptError(
      "conflict",
      `Generated-visual Council request carries unsupported or conflicting fields: ${present.join(", ")}.`,
    );
  }
}

/** Normalize and hash exactly the text-only request ChatMock will receive.
 * The helper supplies the max/detailed policy itself so hashing and dispatch
 * cannot disagree about reasoning. */
export function prepareGeneratedVisualCouncilRequest(
  request: GeneratedVisualCouncilCompletionRequest,
  options?: { allowImageUrlParts?: boolean },
): PreparedGeneratedVisualCouncilRequest {
  const raw = recordValue(request);
  if (!raw) {
    throw receiptError("conflict", "Generated-visual Council request must be an object.");
  }
  assertNoConflictingAliases(raw);
  const existingReasoning = recordValue(raw.reasoning);
  if (
    existingReasoning &&
    (existingReasoning.effort !== GENERATED_VISUAL_COUNCIL_REASONING.effort ||
      existingReasoning.summary !== GENERATED_VISUAL_COUNCIL_REASONING.summary)
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual Council recovery requires max reasoning with a detailed summary.",
    );
  }
  const cloned = jsonTransportClone({
    ...raw,
    reasoning: GENERATED_VISUAL_COUNCIL_REASONING,
  });
  const normalized = recordValue(cloned) as GeneratedVisualCouncilCompletionRequest | null;
  if (!normalized) {
    throw receiptError("conflict", "Generated-visual Council request did not remain an object.");
  }
  const model = normalized.model;
  if (typeof model !== "string" || !model || model !== model.trim()) {
    throw receiptError(
      "conflict",
      "Generated-visual Council recovery requires one exact explicit model.",
    );
  }
  const route = expectedStrictLearnModelRoute(model);
  if (!route) {
    throw receiptError(
      "conflict",
      "Generated-visual Council recovery cannot prove the requested model route.",
    );
  }
  if (!Array.isArray(normalized.messages) || normalized.messages.length === 0) {
    throw receiptError("conflict", "Generated-visual Council request has no messages.");
  }
  if (requestContainsUnsupportedParts(
    normalized.messages,
    options?.allowImageUrlParts === true,
  )) {
    throw receiptError(
      "conflict",
      "This generated-visual receipt boundary does not permit one or more message parts. Preview evidence was not stripped and no request was issued.",
    );
  }
  if (
    normalized.councilModeOverride !== "direct_council" ||
    (normalized.taskType !== "visualization_generation" &&
      normalized.taskType !== "critique")
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual recovery requires an author or critic direct_council request.",
    );
  }
  if (
    typeof normalized.gardenId !== "string" ||
    !normalized.gardenId ||
    typeof normalized.pageId !== "string" ||
    !normalized.pageId
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual recovery requires exact nonempty gardenId and pageId routing fields.",
    );
  }
  if (
    !Number.isSafeInteger(normalized.max_completion_tokens) ||
    normalized.max_completion_tokens <= 0
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual recovery requires a positive safe max_completion_tokens value.",
    );
  }
  if (
    Object.hasOwn(normalized, "temperature") &&
    (typeof normalized.temperature !== "number" ||
      !Number.isFinite(normalized.temperature))
  ) {
    throw receiptError("conflict", "Generated-visual Council temperature is invalid.");
  }
  if (
    (Object.hasOwn(normalized, "stream") && normalized.stream !== false) ||
    normalized.council === false ||
    (Object.hasOwn(normalized, "tools") &&
      !(Array.isArray(normalized.tools) && normalized.tools.length === 0)) ||
    (Object.hasOwn(normalized, "responses_tools") &&
      !(Array.isArray(normalized.responses_tools) &&
        normalized.responses_tools.length === 0)) ||
    (Object.hasOwn(normalized, "tool_choice") && normalized.tool_choice != null)
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual recovery request would bypass the Council receipt boundary.",
    );
  }

  const envelope: CouncilRequestEnvelopeV1 = {
    schemaVersion: 1,
    messages: withResolvedCouncilIdentityV1(
      normalized.messages,
      route.resolvedModel,
      route.provider,
    ),
    taskType: normalized.taskType,
    gardenId: normalized.gardenId,
    pageId: normalized.pageId,
    sourceContext: normalized.sourceContext ?? null,
    councilMode: "direct_council",
    requestedModel: route.requestedModel,
    resolvedModel: route.resolvedModel,
    reasoning: GENERATED_VISUAL_COUNCIL_REASONING,
    temperature:
      typeof normalized.temperature === "number" ? normalized.temperature : null,
    maxTokens: normalized.max_completion_tokens,
  };
  let requestHash: string;
  try {
    requestHash = councilRequestHashV1(envelope);
  } catch (error) {
    throw receiptError(
      "conflict",
      "Generated-visual Council request cannot be canonically bound.",
      undefined,
      error,
    );
  }
  return {
    request: normalized as PreparedGeneratedVisualCouncilRequest["request"],
    envelope,
    requestHash,
    route,
  };
}

function normalizedMetadata(
  value: GeneratedVisualCouncilRecoveryMetadata | undefined,
): Record<string, RecoveryMetadataValue> {
  if (!value) return {};
  const entries = Object.entries(value);
  if (entries.length > 24) {
    throw receiptError("conflict", "Generated-visual recovery metadata is too large.");
  }
  const result: Record<string, RecoveryMetadataValue> = {};
  for (const [key, entry] of entries.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      throw receiptError("conflict", "Generated-visual recovery metadata has an invalid key.");
    }
    if (
      !(
        entry === null ||
        typeof entry === "boolean" ||
        (typeof entry === "string" && entry.length <= 500) ||
        (typeof entry === "number" && Number.isSafeInteger(entry))
      )
    ) {
      throw receiptError(
        "conflict",
        "Generated-visual recovery metadata has an invalid value.",
      );
    }
    result[key] = entry;
  }
  return result;
}

function isNormalizedMetadataRecord(
  value: Record<string, unknown>,
): value is Record<string, RecoveryMetadataValue> {
  try {
    return exactJson(
      normalizedMetadata(value as GeneratedVisualCouncilRecoveryMetadata),
    ) === exactJson(value);
  } catch {
    return false;
  }
}

function nowValue(now: (() => string) | undefined): string {
  const value = now ? now() : new Date().toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw receiptError("corrupt", "Generated-visual recovery clock is invalid.");
  }
  return value;
}

function fsyncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensureDirectoryDurable(directory: string): void {
  const missing: string[] = [];
  let cursor = directory;
  while (!fs.existsSync(cursor)) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  fs.mkdirSync(directory, { recursive: true });
  for (const created of missing.reverse()) fsyncDirectory(path.dirname(created));
}

export function generatedVisualCouncilReceiptDirectory(
  durableRecoveryDir: string,
): string {
  if (typeof durableRecoveryDir !== "string" || !durableRecoveryDir.trim()) {
    throw receiptError("conflict", "Durable generated-visual recovery root is unavailable.");
  }
  return path.join(
    path.resolve(durableRecoveryDir),
    ".breadboard",
    RECEIPT_DIRECTORY_NAME,
  );
}

/** A per-garden operational root that is never part of the atomically swapped
 * garden tree. Receipt continuations may settle after a caller's hard timeout;
 * keeping their immutable evidence here prevents a concurrent publication or
 * rollback from replacing the directory underneath that late settlement. */
export function stableGeneratedVisualCouncilRecoveryRoot(
  authoritativeGardenDir: string,
  runtimeRoot?: string,
): string {
  if (
    typeof authoritativeGardenDir !== "string" ||
    !authoritativeGardenDir.trim()
  ) {
    throw receiptError(
      "conflict",
      "Authoritative generated-visual garden root is unavailable.",
    );
  }
  const garden = path.resolve(authoritativeGardenDir);
  const canonicalGarden = process.platform === "win32"
    ? garden.toLocaleLowerCase("en-US")
    : garden;
  const configuredDataRoot = process.env.BREADBOARD_DATA_DIR?.trim();
  const base = runtimeRoot
    ? path.resolve(runtimeRoot)
    : configuredDataRoot
      ? path.join(path.resolve(configuredDataRoot), "runtime")
      : path.join(repositoryRoot(), ".runtime");
  const basename = path.basename(garden)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "garden";
  const recoveryRoot = path.join(
    base,
    "generated-visual-council",
    `${basename}-${sha256(canonicalGarden).slice(0, 20)}`,
  );
  const relativeToGarden = path.relative(garden, recoveryRoot);
  if (
    relativeToGarden === "" ||
    (!path.isAbsolute(relativeToGarden) &&
      relativeToGarden !== ".." &&
      !relativeToGarden.startsWith(`..${path.sep}`))
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual recovery root must remain outside the swappable garden tree.",
    );
  }
  return recoveryRoot;
}

function signedRecord<T extends object>(
  value: T,
): T & { integrityHash: string } {
  return { ...value, integrityHash: canonicalHash(value) };
}

function publishImmutableBytes(destination: string, bytes: Buffer): boolean {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.receipt-${process.pid}-${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  let published = false;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    try {
      fs.linkSync(temporary, destination);
      published = true;
      fsyncDirectory(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
      fsyncDirectory(directory);
    } catch {
      // A temp suffix cannot be read as a binding or state marker.
    }
  }
  return published;
}

function publishImmutableJson(destination: string, value: unknown): boolean {
  return publishImmutableBytes(
    destination,
    Buffer.from(`${JSON.stringify(value)}\n`, "utf8"),
  );
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 64_000) {
    throw receiptError("corrupt", "Generated-visual recovery record size is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw receiptError(
      "corrupt",
      "Generated-visual recovery record is not valid JSON.",
      undefined,
      error,
    );
  }
  const record = recordValue(parsed);
  if (!record) {
    throw receiptError("corrupt", "Generated-visual recovery record is not an object.");
  }
  return record;
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hasExactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function verifyIntegrity(record: Record<string, unknown>): boolean {
  const integrityHash = record.integrityHash;
  if (typeof integrityHash !== "string" || !SHA256_RE.test(integrityHash)) return false;
  const unsigned = { ...record };
  delete unsigned.integrityHash;
  try {
    return canonicalHash(unsigned) === integrityHash;
  } catch {
    return false;
  }
}

function readBinding(filePath: string): BindingRecord {
  const record = readJsonRecord(filePath);
  const adopted = Object.hasOwn(record, "adoptedFromInvocationKeyHash");
  const allowed = [
    "schemaVersion", "kind", "invocationKey", "invocationKeyHash", "requestId",
    "requestHash", "requestedModel", "resolvedModel", "provider", "upstreamModel",
    "councilMode", "taskType", "gardenId", "pageId", "metadata", "createdAt",
    ...(adopted ? ["adoptedFromInvocationKeyHash"] : []), "integrityHash",
  ];
  const metadata = recordValue(record.metadata);
  if (
    !hasExactKeys(record, allowed) ||
    !verifyIntegrity(record) ||
    record.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    record.kind !== "generated_visual_council_binding" ||
    typeof record.invocationKey !== "string" ||
    !record.invocationKey ||
    typeof record.invocationKeyHash !== "string" ||
    !SHA256_RE.test(record.invocationKeyHash) ||
    sha256(record.invocationKey) !== record.invocationKeyHash ||
    typeof record.requestId !== "string" ||
    !REQUEST_ID_RE.test(record.requestId) ||
    typeof record.requestHash !== "string" ||
    !SHA256_RE.test(record.requestHash) ||
    typeof record.requestedModel !== "string" ||
    typeof record.resolvedModel !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.upstreamModel !== "string" ||
    record.councilMode !== "direct_council" ||
    (record.taskType !== "visualization_generation" && record.taskType !== "critique") ||
    !(record.gardenId === null || typeof record.gardenId === "string") ||
    !(record.pageId === null || typeof record.pageId === "string") ||
    !metadata ||
    !isNormalizedMetadataRecord(metadata) ||
    !validIso(record.createdAt) ||
    (adopted &&
      (typeof record.adoptedFromInvocationKeyHash !== "string" ||
        !SHA256_RE.test(record.adoptedFromInvocationKeyHash)))
  ) {
    throw receiptError("corrupt", "Generated-visual recovery binding is invalid.");
  }
  const fileName = path.basename(filePath);
  const match = BINDING_FILE_RE.exec(fileName);
  if (
    !match ||
    match[1] !== record.requestHash ||
    match[2] !== record.invocationKeyHash
  ) {
    throw receiptError("corrupt", "Generated-visual recovery filename binding is invalid.");
  }
  return record as unknown as BindingRecord;
}

function markerSuffix(kind: MarkerKind): string {
  if (kind === "generated_visual_council_dispatch") return ".dispatch.json";
  if (kind === "generated_visual_council_redispatch") return ".redispatch.json";
  if (kind === "generated_visual_council_response") return ".response.json";
  if (kind === "generated_visual_council_completion") return ".completed.json";
  return ".failed.json";
}

function markerPath(basePath: string, kind: MarkerKind): string {
  return `${basePath}${markerSuffix(kind)}`;
}

function readMarker(basePath: string, kind: MarkerKind): MarkerRecord | null {
  const filePath = markerPath(basePath, kind);
  if (!fs.existsSync(filePath)) return null;
  const record = readJsonRecord(filePath);
  const completion = kind === "generated_visual_council_completion";
  const redispatch = kind === "generated_visual_council_redispatch";
  const response = kind === "generated_visual_council_response";
  const failure = kind === "generated_visual_council_failure";
  const validHttpProof = response && record.httpProofState === "valid";
  const hasRedispatchReason = redispatch && Object.hasOwn(record, "redispatchReason");
  const failedReceiptRedispatch =
    hasRedispatchReason && record.redispatchReason === "request_failed";
  const allowed = [
    "schemaVersion", "kind", "invocationKeyHash", "requestId", "requestHash", "at",
    ...(completion ? ["councilRunId", "responseHash"] : []),
    ...(hasRedispatchReason ? ["redispatchReason"] : []),
    ...(failedReceiptRedispatch
      ? [
          "failureCode",
          "receiptDispatchGeneration",
          "receiptDispatchCount",
          "receiptRedispatchCount",
          "receiptRedispatchAllowed",
          "receiptProofHash",
        ]
      : []),
    ...(response
      ? [
          "httpProofState",
          ...(validHttpProof ? ["councilRunId", "responseHash", "usageHash"] : []),
        ]
      : []),
    ...(failure ? ["failureCode"] : []),
    "integrityHash",
  ];
  if (
    !hasExactKeys(record, allowed) ||
    !verifyIntegrity(record) ||
    record.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    record.kind !== kind ||
    typeof record.invocationKeyHash !== "string" ||
    !SHA256_RE.test(record.invocationKeyHash) ||
    typeof record.requestId !== "string" ||
    !REQUEST_ID_RE.test(record.requestId) ||
    typeof record.requestHash !== "string" ||
    !SHA256_RE.test(record.requestHash) ||
    !validIso(record.at) ||
    (completion &&
      (typeof record.councilRunId !== "string" ||
        !record.councilRunId ||
        typeof record.responseHash !== "string" ||
        !SHA256_RE.test(record.responseHash))) ||
    (response &&
      !(
        record.httpProofState === "invalid" ||
        (record.httpProofState === "valid" &&
          typeof record.councilRunId === "string" &&
          Boolean(record.councilRunId) &&
          typeof record.responseHash === "string" &&
          SHA256_RE.test(record.responseHash) &&
          typeof record.usageHash === "string" &&
          SHA256_RE.test(record.usageHash))
      )) ||
    (redispatch &&
      !(
        !hasRedispatchReason ||
        record.redispatchReason === "receipt_not_found" ||
        (record.redispatchReason === "request_failed" &&
          record.failureCode === "council_no_final_answer" &&
          record.receiptDispatchGeneration === 1 &&
          record.receiptDispatchCount === 1 &&
          record.receiptRedispatchCount === 0 &&
          record.receiptRedispatchAllowed === true &&
          typeof record.receiptProofHash === "string" &&
          SHA256_RE.test(record.receiptProofHash))
      )) ||
    (failure &&
      (typeof record.failureCode !== "string" || !record.failureCode))
  ) {
    throw receiptError("corrupt", "Generated-visual recovery state marker is invalid.");
  }
  return record as unknown as MarkerRecord;
}

function loadBindingEntry(filePath: string): BindingEntry {
  const binding = readBinding(filePath);
  const basePath = filePath.slice(0, -".binding.json".length);
  const dispatch = readMarker(basePath, "generated_visual_council_dispatch");
  const redispatch = readMarker(basePath, "generated_visual_council_redispatch");
  const response = readMarker(basePath, "generated_visual_council_response");
  const completion = readMarker(basePath, "generated_visual_council_completion");
  const failure = readMarker(basePath, "generated_visual_council_failure");
  for (const marker of [dispatch, redispatch, response, completion, failure]) {
    if (
      marker &&
      (marker.invocationKeyHash !== binding.invocationKeyHash ||
        marker.requestId !== binding.requestId ||
        marker.requestHash !== binding.requestHash)
    ) {
      throw receiptError("corrupt", "Generated-visual recovery marker binding conflicts.");
    }
  }
  if (completion && failure) {
    throw receiptError("corrupt", "Generated-visual recovery has conflicting terminal markers.");
  }
  if (response && failure) {
    throw receiptError(
      "corrupt",
      "Generated-visual recovery has contradictory HTTP-response and failure markers.",
    );
  }
  if (failure && !dispatch) {
    throw receiptError("corrupt", "Generated-visual recovery failure has no dispatch marker.");
  }
  if (redispatch && !dispatch) {
    throw receiptError("corrupt", "Generated-visual redispatch has no first dispatch marker.");
  }
  if (response && !dispatch) {
    throw receiptError("corrupt", "Generated-visual HTTP response has no dispatch marker.");
  }
  const state = completion
    ? "completed"
    : failure
      ? "failed"
      : dispatch || binding.adoptedFromInvocationKeyHash
        ? "started"
        : "prepared";
  return {
    basePath,
    binding,
    dispatch,
    redispatch,
    response,
    completion,
    failure,
    state,
  };
}

function bindingPath(
  directory: string,
  requestHash: string,
  invocationKeyHash: string,
): string {
  return path.join(directory, `${requestHash}.${invocationKeyHash}.binding.json`);
}

function validatedLedger(directory: string): {
  entries: BindingEntry[];
  fileNames: string[];
} {
  const dirents = fs.readdirSync(directory, { withFileTypes: true });
  const recognized = dirents.filter(
    (entry) => BINDING_FILE_RE.test(entry.name) || MARKER_FILE_RE.test(entry.name),
  );
  if (recognized.some((entry) => !entry.isFile())) {
    throw receiptError(
      "corrupt",
      "Generated-visual recovery contains a non-file receipt record.",
    );
  }
  const fileNames = recognized.map((entry) => entry.name).sort();
  const nameSet = new Set(fileNames);
  for (const name of fileNames) {
    const marker = MARKER_FILE_RE.exec(name);
    if (marker && !nameSet.has(`${marker[1]}.${marker[2]}.binding.json`)) {
      throw receiptError(
        "corrupt",
        "Generated-visual recovery contains an orphaned state marker.",
      );
    }
  }
  const entries = fileNames
    .filter((name) => BINDING_FILE_RE.test(name))
    .map((name) => loadBindingEntry(path.join(directory, name)));
  const invocationHashes = entries.map((entry) => entry.binding.invocationKeyHash);
  if (new Set(invocationHashes).size !== invocationHashes.length) {
    throw receiptError(
      "conflict",
      "Generated-visual recovery contains multiple bindings for one invocation.",
    );
  }
  return { entries, fileNames };
}

function listBindings(directory: string): BindingEntry[] {
  return validatedLedger(directory).entries;
}

function readStableReceiptBytes(filePath: string): Buffer {
  const before = fs.statSync(filePath);
  if (!before.isFile() || before.size <= 0 || before.size > 64_000) {
    throw receiptError("corrupt", "Generated-visual recovery record size is invalid.");
  }
  const bytes = fs.readFileSync(filePath);
  const after = fs.statSync(filePath);
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    bytes.byteLength !== before.size
  ) {
    throw receiptError(
      "corrupt",
      "Generated-visual recovery record changed while it was read.",
    );
  }
  return bytes;
}

function receiptMergeOrder(name: string): number {
  if (name.endsWith(".binding.json")) return 0;
  if (name.endsWith(".dispatch.json")) return 1;
  if (name.endsWith(".redispatch.json")) return 2;
  if (name.endsWith(".response.json")) return 3;
  return 4;
}

/** Union immutable live-garden receipt evidence into an incoming garden before
 * atomic promotion. Only records that pass the same no-content binding/marker
 * validators used by runtime recovery are copied. */
export function mergeGeneratedVisualCouncilReceiptDirectory(input: {
  liveGardenDir: string;
  incomingGardenDir: string;
  /** Must prove the caller owns the exclusive garden mutation lease. That
   * lease must remain held until the incoming garden is atomically promoted. */
  sourceQuiescenceHeld: () => boolean;
}): MergeGeneratedVisualCouncilReceiptsResult {
  const source = generatedVisualCouncilReceiptDirectory(input.liveGardenDir);
  const destination = generatedVisualCouncilReceiptDirectory(input.incomingGardenDir);
  try {
    if (!input.sourceQuiescenceHeld()) {
      throw receiptError(
        "started",
        "Generated-visual receipt merge requires an exclusive live-garden mutation lease.",
      );
    }
    let sourceStat: Stats;
    try {
      sourceStat = fs.statSync(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { copiedFiles: 0, identicalFiles: 0 };
      }
      throw error;
    }
    if (!sourceStat.isDirectory()) {
      throw receiptError(
        "corrupt",
        "Live generated-visual receipt path is not a directory.",
      );
    }

    let copiedFiles = 0;
    let identicalFiles = 0;
    const accounted = new Set<string>();
    for (let pass = 0; pass < 8; pass += 1) {
      if (!input.sourceQuiescenceHeld()) {
        throw receiptError(
          "started",
          "Generated-visual receipt merge lost its live-garden mutation lease.",
        );
      }
      const snapshot = validatedLedger(source);
      if (snapshot.fileNames.length === 0) {
        return { copiedFiles, identicalFiles };
      }
      ensureDirectoryDurable(destination);
      validatedLedger(destination);
      const ordered = [...snapshot.fileNames].sort(
        (left, right) =>
          receiptMergeOrder(left) - receiptMergeOrder(right) ||
          (left < right ? -1 : left > right ? 1 : 0),
      );
      for (const name of ordered) {
        const sourceBytes = readStableReceiptBytes(path.join(source, name));
        const destinationPath = path.join(destination, name);
        let copied = false;
        if (!fs.existsSync(destinationPath)) {
          copied = publishImmutableBytes(destinationPath, sourceBytes);
        }
        if (!copied) {
          const destinationBytes = readStableReceiptBytes(destinationPath);
          if (!sourceBytes.equals(destinationBytes)) {
            throw receiptError(
              "conflict",
              `Incoming generated-visual receipt ${name} conflicts with the live immutable record.`,
            );
          }
        }
        if (!accounted.has(name)) {
          accounted.add(name);
          if (copied) copiedFiles += 1;
          else identicalFiles += 1;
        }
      }
      const after = validatedLedger(source);
      if (exactJson(after.fileNames) === exactJson(snapshot.fileNames)) {
        validatedLedger(destination);
        if (!input.sourceQuiescenceHeld()) {
          throw receiptError(
            "started",
            "Generated-visual receipt merge lost its mutation lease before commit.",
          );
        }
        return { copiedFiles, identicalFiles };
      }
    }
    throw receiptError(
      "started",
      "Live generated-visual receipt evidence kept changing during promotion merge.",
    );
  } catch (error) {
    if (error instanceof GeneratedVisualCouncilReceiptError) throw error;
    throw receiptError(
      "corrupt",
      "Generated-visual receipt directories could not be merged safely.",
      undefined,
      error,
    );
  }
}

function findInvocationBinding(
  directory: string,
  invocationKeyHash: string,
): BindingEntry | null {
  const matches = listBindings(directory).filter(
    (entry) => entry.binding.invocationKeyHash === invocationKeyHash,
  );
  if (matches.length > 1) {
    throw receiptError("conflict", "One generated-visual invocation has multiple bindings.");
  }
  return matches[0] ?? null;
}

function assertBindingMatches(
  entry: BindingEntry,
  input: {
    invocationKey: string;
    requestHash: string;
    prepared: PreparedGeneratedVisualCouncilRequest;
    metadata: Record<string, RecoveryMetadataValue>;
  },
): void {
  const { binding } = entry;
  const envelope = input.prepared.envelope;
  if (
    binding.invocationKey !== input.invocationKey ||
    binding.requestHash !== input.requestHash ||
    binding.requestedModel !== input.prepared.route.requestedModel ||
    binding.resolvedModel !== input.prepared.route.resolvedModel ||
    binding.provider !== input.prepared.route.provider ||
    binding.upstreamModel !== input.prepared.route.upstreamModel ||
    binding.councilMode !== envelope.councilMode ||
    binding.taskType !== envelope.taskType ||
    binding.gardenId !== envelope.gardenId ||
    binding.pageId !== envelope.pageId ||
    exactJson(binding.metadata) !== exactJson(input.metadata)
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual invocation is already bound to a different exact request.",
      binding,
    );
  }
}

function newRequestId(factory: (() => string) | undefined): string {
  const requestId = factory
    ? factory()
    : `lrq_gv_${randomUUID().replaceAll("-", "")}`;
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    throw receiptError("conflict", "Generated-visual recoverable request id is invalid.");
  }
  return requestId;
}

function publishBinding(
  directory: string,
  unsigned: BindingRecordUnsigned,
): BindingEntry {
  const destination = bindingPath(
    directory,
    unsigned.requestHash,
    unsigned.invocationKeyHash,
  );
  publishImmutableJson(destination, signedRecord(unsigned));
  return loadBindingEntry(destination);
}

function publishMarker(
  entry: BindingEntry,
  unsigned: MarkerRecordUnsigned,
): { published: boolean; entry: BindingEntry } {
  const destination = markerPath(entry.basePath, unsigned.kind);
  const published = publishImmutableJson(destination, signedRecord(unsigned));
  return {
    published,
    entry: loadBindingEntry(`${entry.basePath}.binding.json`),
  };
}

function markerBase(
  entry: BindingEntry,
  kind: MarkerKind,
  at: string,
): MarkerRecordUnsigned {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind,
    invocationKeyHash: entry.binding.invocationKeyHash,
    requestId: entry.binding.requestId,
    requestHash: entry.binding.requestHash,
    at,
  };
}

function parseUsage(value: unknown): GeneratedVisualCouncilReceiptUsage | null {
  const usage = recordValue(value);
  if (!usage) return null;
  const keys = [
    "inputTokens", "outputTokens", "totalTokens", "cachedInputTokens",
    "reasoningTokens", "callCount", "reportedCallCount",
  ] as const;
  if (!keys.every((key) => Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0)) {
    return null;
  }
  const parsed = Object.fromEntries(keys.map((key) => [key, Number(usage[key])])) as unknown as GeneratedVisualCouncilReceiptUsage;
  if (
    parsed.callCount !== 1 ||
    parsed.reportedCallCount !== 1 ||
    parsed.totalTokens < parsed.inputTokens + parsed.outputTokens ||
    parsed.cachedInputTokens > parsed.inputTokens ||
    parsed.reasoningTokens > parsed.outputTokens
  ) {
    return null;
  }
  return parsed;
}

function validateReceiptResult(
  value: unknown,
  prepared: PreparedGeneratedVisualCouncilRequest,
): ReceiptResult {
  const result = recordValue(value);
  const usage = parseUsage(result?.usage);
  const modelRouting = Array.isArray(result?.modelRouting)
    ? result.modelRouting
        .map(recordValue)
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const finalAnswer = result?.finalAnswer;
  const responseHash = result?.responseHash;
  const councilRunId = result?.councilRunId;
  if (
    !result ||
    typeof finalAnswer !== "string" ||
    !finalAnswer.trim() ||
    typeof responseHash !== "string" ||
    !SHA256_RE.test(responseHash) ||
    sha256(finalAnswer) !== responseHash ||
    typeof councilRunId !== "string" ||
    !councilRunId ||
    !usage ||
    result.usageEstimated !== false ||
    !validIso(result.createdAt) ||
    !validIso(result.updatedAt) ||
    Date.parse(result.createdAt) > Date.parse(result.updatedAt) ||
    !planningReceiptProvesOneExactModelCall(
      {
        councilRunId,
        councilMode:
          typeof result.councilMode === "string" ? result.councilMode : undefined,
        requestedModel:
          typeof result.requestedModel === "string" ? result.requestedModel : undefined,
        resolvedModel:
          typeof result.resolvedModel === "string" ? result.resolvedModel : undefined,
        modelRouting,
        usage,
      },
      prepared.route.requestedModel,
    )
  ) {
    throw receiptError(
      "corrupt",
      "Durable generated-visual Council result has an invalid content, model, routing, or usage proof.",
    );
  }
  const route = modelRouting[0];
  if (
    route.schemaVersion !== 1 ||
    !validIso(route.at) ||
    result.requestedModel !== prepared.route.requestedModel ||
    result.resolvedModel !== prepared.route.resolvedModel
  ) {
    throw receiptError(
      "corrupt",
      "Durable generated-visual Council result route metadata is invalid.",
    );
  }
  return {
    councilRunId,
    councilMode: "direct_council",
    requestedModel: prepared.route.requestedModel,
    resolvedModel: prepared.route.resolvedModel,
    finalAnswer,
    responseHash,
    usage,
    modelRouting,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

const SAFE_FAILED_ATTEMPT_KEYS = new Set([
  "dispatchGeneration",
  "outcome",
  "councilRunId",
  "finalAnswerPresent",
  "usage",
  "usageEstimated",
  "modelRouting",
  "requestedModel",
  "resolvedModel",
  "createdAt",
  "updatedAt",
  "failureCode",
]);

const SAFE_FAILED_ROUTING_KEYS = new Set([
  "schemaVersion",
  "at",
  "requestId",
  "endpoint",
  "requestedModel",
  "resolvedModel",
  "upstreamModel",
  "provider",
  "outcome",
  "fallback",
  "statusCode",
  "errorCode",
  "failurePhase",
  "partialOutput",
  "replaySafe",
]);

function validFailedAttemptUsage(value: unknown): boolean {
  const usage = recordValue(value);
  const keys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "reasoningTokens",
    "callCount",
    "reportedCallCount",
  ] as const;
  if (
    !usage ||
    !hasExactKeys(usage, keys) ||
    !keys.every((key) =>
      Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0)
  ) {
    return false;
  }
  return Number(usage.reportedCallCount) <= Number(usage.callCount);
}

function validFailedReceiptAttempt(
  value: unknown,
  expectedGeneration: number,
  prepared: PreparedGeneratedVisualCouncilRequest,
): value is Record<string, unknown> {
  const attempt = recordValue(value);
  if (
    !attempt ||
    Object.keys(attempt).some((key) => !SAFE_FAILED_ATTEMPT_KEYS.has(key)) ||
    attempt.dispatchGeneration !== expectedGeneration ||
    (attempt.outcome !== "failed_no_final_answer" &&
      attempt.outcome !== "failed_terminal") ||
    typeof attempt.councilRunId !== "string" ||
    !attempt.councilRunId ||
    attempt.finalAnswerPresent !== false ||
    attempt.failureCode !== "council_no_final_answer" ||
    typeof attempt.usageEstimated !== "boolean" ||
    !validFailedAttemptUsage(attempt.usage) ||
    !Array.isArray(attempt.modelRouting) ||
    attempt.modelRouting.some((route) => {
      const routing = recordValue(route);
      return (
        !routing ||
        Object.keys(routing).some((key) => !SAFE_FAILED_ROUTING_KEYS.has(key)) ||
        (Object.hasOwn(routing, "requestedModel") &&
          routing.requestedModel !== prepared.route.requestedModel) ||
        (Object.hasOwn(routing, "resolvedModel") &&
          routing.resolvedModel !== prepared.route.resolvedModel)
      );
    }) ||
    (Object.hasOwn(attempt, "requestedModel") &&
      attempt.requestedModel !== prepared.route.requestedModel) ||
    (Object.hasOwn(attempt, "resolvedModel") &&
      attempt.resolvedModel !== prepared.route.resolvedModel) ||
    (Object.hasOwn(attempt, "createdAt") &&
      typeof attempt.createdAt !== "string") ||
    (Object.hasOwn(attempt, "updatedAt") &&
      typeof attempt.updatedAt !== "string")
  ) {
    return false;
  }
  return true;
}

function parseFailedReceiptProof(
  value: unknown,
  prepared: PreparedGeneratedVisualCouncilRequest,
): FailedReceiptProof | null {
  const receipt = recordValue(value);
  if (
    !receipt ||
    !hasExactKeys(receipt, [
      "dispatchGeneration",
      "dispatchCount",
      "redispatchCount",
      "redispatchAllowed",
      "failureCode",
      "attempts",
    ]) ||
    (receipt.dispatchGeneration !== 1 && receipt.dispatchGeneration !== 2) ||
    (receipt.dispatchCount !== 1 && receipt.dispatchCount !== 2) ||
    receipt.dispatchCount !== receipt.dispatchGeneration ||
    receipt.redispatchCount !== receipt.dispatchCount - 1 ||
    typeof receipt.redispatchAllowed !== "boolean" ||
    (receipt.dispatchCount === 2 && receipt.redispatchAllowed !== false) ||
    receipt.failureCode !== "council_no_final_answer" ||
    !Array.isArray(receipt.attempts) ||
    receipt.attempts.length !== receipt.dispatchCount ||
    !receipt.attempts.every((attempt, index) =>
      validFailedReceiptAttempt(attempt, index + 1, prepared))
  ) {
    return null;
  }
  return receipt as unknown as FailedReceiptProof;
}

function failedReceiptAllowsRedispatch(
  lookup: ReceiptLookup,
): lookup is Extract<ReceiptLookup, { state: "failed" }> & {
  proof: FailedReceiptProof & {
    dispatchGeneration: 1;
    dispatchCount: 1;
    redispatchCount: 0;
    redispatchAllowed: true;
  };
} {
  return Boolean(
    lookup.state === "failed" &&
      lookup.proof?.dispatchGeneration === 1 &&
      lookup.proof.dispatchCount === 1 &&
      lookup.proof.redispatchCount === 0 &&
      lookup.proof.redispatchAllowed === true &&
      lookup.proof.failureCode === "council_no_final_answer" &&
      lookup.proof.attempts.length === 1 &&
      lookup.proof.attempts[0]?.outcome === "failed_no_final_answer" &&
      lookup.proof.attempts[0]?.finalAnswerPresent === false,
  );
}

function terminalFailureCode(
  lookup: Extract<ReceiptLookup, { state: "failed" }>,
): string {
  return lookup.proof?.failureCode ?? lookup.code;
}

function assertClaimedFailedReceiptProofMatches(
  entry: BindingEntry,
  proof: FailedReceiptProof,
): void {
  const marker = entry.redispatch;
  if (
    !marker ||
    marker.redispatchReason !== "request_failed" ||
    marker.receiptDispatchGeneration !== 1 ||
    marker.receiptDispatchCount !== 1 ||
    marker.receiptRedispatchCount !== 0 ||
    marker.receiptRedispatchAllowed !== true ||
    marker.failureCode !== proof.failureCode ||
    marker.receiptProofHash !== canonicalHash(proof)
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual failed-receipt recovery proof conflicts with its durable local claim.",
      entry.binding,
    );
  }
}

async function resolveReceipt(
  client: GeneratedVisualCouncilClient,
  binding: { requestId: string; requestHash: string },
  prepared: PreparedGeneratedVisualCouncilRequest,
  fetchImpl: RecoveryFetch,
): Promise<ReceiptLookup> {
  let url: URL;
  try {
    url = strictChatMockInternalRecoveryUrl(
      client.baseURL,
      "/internal/council-results/resolve",
    );
  } catch {
    return { state: "conflict", code: "unsafe_recovery_url" };
  }
  url.searchParams.set("requestId", binding.requestId);
  url.searchParams.set("requestHash", binding.requestHash);
  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return { state: "started", code: "receipt_unobservable", cause: error };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { state: "corrupt", code: "receipt_non_json", cause: error };
  }
  const record = recordValue(body);
  if (response.ok && response.status === 200 && record?.state === "completed") {
    try {
      return {
        state: "completed",
        result: validateReceiptResult(record.result, prepared),
      };
    } catch (error) {
      return { state: "corrupt", code: "receipt_result_invalid", cause: error };
    }
  }
  const error = recordValue(record?.error);
  const code = typeof error?.code === "string" ? error.code : "receipt_status_invalid";
  if (response.status === 409 && code === "request_started") {
    return { state: "started", code };
  }
  if (response.status === 409 && code === "request_failed") {
    const receipt = recordValue(record?.receipt);
    if (!receipt) {
      // Read compatibility for pre-redispatch ChatMock builds. An old failed
      // receipt remains terminal and never grants dispatch authority.
      return { state: "failed", code };
    }
    if (
      record?.state !== "failed" ||
      (hasExactKeys(receipt, ["redispatchAllowed"]) &&
        receipt.redispatchAllowed !== false)
    ) {
      return { state: "corrupt", code: "failed_receipt_metadata_invalid" };
    }
    if (
      hasExactKeys(receipt, ["redispatchAllowed"]) &&
      receipt.redispatchAllowed === false
    ) {
      return { state: "failed", code };
    }
    const proof = parseFailedReceiptProof(receipt, prepared);
    return proof
      ? { state: "failed", code, proof }
      : { state: "corrupt", code: "failed_receipt_metadata_invalid" };
  }
  if (response.status === 404 && code === "receipt_not_found") {
    return { state: "not_found", code };
  }
  if (
    (response.status === 409 && code === "binding_conflict") ||
    (response.status === 400 && code === "invalid_binding")
  ) {
    return { state: "conflict", code };
  }
  if (
    (response.status === 409 && code === "receipt_corrupt") ||
    (response.status === 500 && code === "receipt_read_failed")
  ) {
    return { state: "corrupt", code };
  }
  return { state: "corrupt", code };
}

function throwLookup(
  lookup: Exclude<ReceiptLookup, { state: "completed" }>,
  binding: { requestId: string; requestHash: string },
): never {
  throw receiptError(
    lookup.state,
    `Generated-visual Council receipt is ${lookup.state} (${lookup.code}); no model request was issued again.`,
    binding,
    lookup.state === "corrupt" ? lookup.cause : undefined,
  );
}

function completionResult(
  result: ReceiptResult,
  binding: BindingRecord,
  recovered: boolean,
  execution: InvocationExecution,
  httpCompletionObserved: boolean,
): GeneratedVisualCouncilReceiptResult {
  return {
    content: result.finalAnswer,
    tokenUsage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      totalTokens: result.usage.totalTokens,
    },
    usage: result.usage,
    councilRunId: result.councilRunId,
    councilMode: result.councilMode,
    requestedModel: result.requestedModel,
    resolvedModel: result.resolvedModel,
    requestId: binding.requestId,
    requestHash: binding.requestHash,
    recovered,
    dispatched: execution.dispatchCount > 0,
    dispatchCount: execution.dispatchCount,
    httpCompletionObserved,
  };
}

function persistCompletion(
  entry: BindingEntry,
  result: ReceiptResult,
  now: (() => string) | undefined,
): BindingEntry {
  const marker = {
    ...markerBase(entry, "generated_visual_council_completion", nowValue(now)),
    councilRunId: result.councilRunId,
    responseHash: result.responseHash,
  };
  const published = publishMarker(entry, marker).entry;
  if (
    published.completion?.councilRunId !== result.councilRunId ||
    published.completion.responseHash !== result.responseHash
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual completion conflicts with its local durable binding.",
      entry.binding,
    );
  }
  return published;
}

function persistFailure(
  entry: BindingEntry,
  code: string,
  now: (() => string) | undefined,
): BindingEntry {
  const marker = {
    ...markerBase(entry, "generated_visual_council_failure", nowValue(now)),
    failureCode: code,
  };
  const published = publishMarker(entry, marker).entry;
  if (published.failure?.failureCode !== code) {
    throw receiptError(
      "conflict",
      "Generated-visual failure conflicts with its local durable binding.",
      entry.binding,
    );
  }
  return published;
}

function httpCompletionProof(
  value: unknown,
  prepared: PreparedGeneratedVisualCouncilRequest,
): { councilRunId: string; responseHash: string; usage: GeneratedVisualCouncilReceiptUsage } {
  const response = recordValue(value);
  const choices = Array.isArray(response?.choices) ? response.choices : [];
  const firstChoice = recordValue(choices[0]);
  const message = recordValue(firstChoice?.message);
  const content = message?.content;
  const councilRunId = response?.councilRunId;
  const publicUsage = recordValue(response?.usage);
  const promptDetails = recordValue(publicUsage?.prompt_tokens_details);
  const completionDetails = recordValue(publicUsage?.completion_tokens_details);
  const routing = recordValue(response?.chatmockModelRouting);
  const usage: GeneratedVisualCouncilReceiptUsage | null = publicUsage &&
    [
      publicUsage.prompt_tokens,
      publicUsage.completion_tokens,
      publicUsage.total_tokens,
      promptDetails?.cached_tokens,
      completionDetails?.reasoning_tokens,
    ].every((entry) => Number.isSafeInteger(entry) && Number(entry) >= 0)
    ? {
        inputTokens: Number(publicUsage.prompt_tokens),
        outputTokens: Number(publicUsage.completion_tokens),
        totalTokens: Number(publicUsage.total_tokens),
        cachedInputTokens: Number(promptDetails?.cached_tokens),
        reasoningTokens: Number(completionDetails?.reasoning_tokens),
        callCount: 1,
        reportedCallCount: 1,
      }
    : null;
  if (
    !response ||
    typeof content !== "string" ||
    !content.trim() ||
    typeof councilRunId !== "string" ||
    !councilRunId ||
    response.id !== councilRunId ||
    response.councilMode !== "direct_council" ||
    response.usageEstimated !== false ||
    !usage ||
    usage.totalTokens < usage.inputTokens + usage.outputTokens ||
    usage.cachedInputTokens > usage.inputTokens ||
    usage.reasoningTokens > usage.outputTokens ||
    !routing ||
    routing.requestedModel !== prepared.route.requestedModel ||
    routing.resolvedModel !== prepared.route.resolvedModel ||
    routing.usedFallback !== false ||
    !Array.isArray(routing.servedModels) ||
    routing.servedModels.length !== 1 ||
    routing.servedModels[0] !== prepared.route.resolvedModel
  ) {
    throw receiptError(
      "corrupt",
      "Generated-visual Council HTTP response has an invalid content, model, routing, or usage proof.",
    );
  }
  return { councilRunId, responseHash: sha256(content), usage };
}

function persistHttpResponse(
  entry: BindingEntry,
  proof: ReturnType<typeof httpCompletionProof> | null,
  now: (() => string) | undefined,
): BindingEntry {
  const marker: MarkerRecordUnsigned = proof
    ? {
        ...markerBase(
          entry,
          "generated_visual_council_response",
          nowValue(now),
        ),
        httpProofState: "valid",
        councilRunId: proof.councilRunId,
        responseHash: proof.responseHash,
        usageHash: canonicalHash(proof.usage),
      }
    : {
        ...markerBase(
          entry,
          "generated_visual_council_response",
          nowValue(now),
        ),
        httpProofState: "invalid",
      };
  const published = publishMarker(entry, marker).entry;
  const observed = published.response;
  if (
    !observed ||
    observed.httpProofState !== marker.httpProofState ||
    (proof &&
      (observed.councilRunId !== proof.councilRunId ||
        observed.responseHash !== proof.responseHash ||
        observed.usageHash !== canonicalHash(proof.usage)))
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual HTTP response conflicts with its immutable local observation.",
      entry.binding,
    );
  }
  return published;
}

function assertResponseMarkerMatchesReceipt(
  marker: MarkerRecord,
  result: ReceiptResult,
  binding: BindingRecord,
): void {
  if (marker.httpProofState !== "valid") {
    // A malformed 2xx observation consumes all redispatch authority, but the
    // independently validated exact durable receipt remains authoritative.
    return;
  }
  if (
    marker.councilRunId !== result.councilRunId ||
    marker.responseHash !== result.responseHash ||
    marker.usageHash !== canonicalHash(result.usage)
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual HTTP response observation conflicts with its durable receipt.",
      binding,
    );
  }
}

function assertHttpMatchesReceipt(
  proof: ReturnType<typeof httpCompletionProof>,
  result: ReceiptResult,
  binding: BindingRecord,
): void {
  if (
    proof.councilRunId !== result.councilRunId ||
    proof.responseHash !== result.responseHash ||
    exactJson(proof.usage) !== exactJson(result.usage)
  ) {
    throw receiptError(
      "conflict",
      "Generated-visual Council HTTP response conflicts with its durable receipt.",
      binding,
    );
  }
}

async function resolveExisting(
  input: RunGeneratedVisualCouncilRequestInput,
  prepared: PreparedGeneratedVisualCouncilRequest,
  entry: BindingEntry,
  fetchImpl: RecoveryFetch,
  execution: InvocationExecution,
  options?: {
    httpProof?: ReturnType<typeof httpCompletionProof>;
    recovered?: boolean;
  },
): Promise<GeneratedVisualCouncilReceiptResult> {
  assertReceiptContinuationActive(input.signal);
  const lookup = await resolveReceipt(input.client, entry.binding, prepared, fetchImpl);
  assertReceiptContinuationActive(input.signal);
  if (lookup.state !== "completed") {
    if (entry.state === "completed") {
      throw receiptError(
        "corrupt",
        `A locally completed generated-visual receipt resolved as ${lookup.state}.`,
        entry.binding,
      );
    }
    if (
      entry.response &&
      (lookup.state === "not_found" || lookup.state === "failed")
    ) {
      throw receiptError(
        entry.response.httpProofState === "valid" ? "conflict" : "corrupt",
        `ChatMock reported ${lookup.state} after a generated-visual HTTP completion was already observed.`,
        entry.binding,
      );
    }
    const resumed = await resumeClaimedRedispatchIfServerAuthorityIsUnused(
      input,
      prepared,
      entry,
      fetchImpl,
      execution,
      lookup,
    );
    if (resumed) return resumed;
    if (
      failedReceiptAllowsRedispatch(lookup) &&
      entry.dispatch &&
      !entry.redispatch &&
      !entry.response
    ) {
      return redispatchStarted(
        input,
        prepared,
        entry,
        fetchImpl,
        execution,
        "request_failed",
        lookup.proof,
      );
    }
    if (lookup.state === "failed" && entry.dispatch) {
      persistFailure(entry, terminalFailureCode(lookup), input.now);
    }
    throwLookup(lookup, entry.binding);
  }
  if (entry.response) {
    assertResponseMarkerMatchesReceipt(entry.response, lookup.result, entry.binding);
  }
  if (options?.httpProof) {
    assertHttpMatchesReceipt(options.httpProof, lookup.result, entry.binding);
  }
  persistCompletion(entry, lookup.result, input.now);
  return completionResult(
    lookup.result,
    entry.binding,
    options?.recovered ?? true,
    execution,
    Boolean(options?.httpProof),
  );
}

async function postClaimedRequest(
  input: RunGeneratedVisualCouncilRequestInput,
  prepared: PreparedGeneratedVisualCouncilRequest,
  entry: BindingEntry,
  fetchImpl: RecoveryFetch,
  execution: InvocationExecution,
  redispatchReason: SameReceiptRedispatchReason | null,
): Promise<GeneratedVisualCouncilReceiptResult> {
  assertReceiptContinuationActive(input.signal);
  const dispatchedRequest = {
    ...prepared.request,
    clientRequestId: entry.binding.requestId,
    clientRequestHash: entry.binding.requestHash,
    ...(redispatchReason === "request_failed"
      ? { clientRequestRedispatch: true }
      : {}),
  };
  let response: unknown;
  try {
    recordDispatch(execution);
    response = await input.client.chat.completions.create(dispatchedRequest, {
      ...(input.signal ? { signal: input.signal } : {}),
      maxRetries: 0,
    });
  } catch (error) {
    assertReceiptContinuationActive(input.signal);
    const lookup = await resolveReceipt(input.client, entry.binding, prepared, fetchImpl);
    assertReceiptContinuationActive(input.signal);
    if (lookup.state === "completed") {
      persistCompletion(entry, lookup.result, input.now);
      return completionResult(lookup.result, entry.binding, true, execution, false);
    }
    if (
      failedReceiptAllowsRedispatch(lookup) &&
      redispatchReason === null &&
      entry.dispatch &&
      !entry.redispatch &&
      !entry.response
    ) {
      return redispatchStarted(
        input,
        prepared,
        entry,
        fetchImpl,
        execution,
        "request_failed",
        lookup.proof,
      );
    }
    if (
      failedReceiptAllowsRedispatch(lookup) &&
      redispatchReason === "request_failed"
    ) {
      assertClaimedFailedReceiptProofMatches(entry, lookup.proof);
      throw receiptError(
        "started",
        "Generated-visual failed-receipt recovery POST remains unobserved while the exact server authority is still unused; its durable local claim may resume on re-entry.",
        entry.binding,
        error,
      );
    }
    if (lookup.state === "failed") {
      persistFailure(entry, terminalFailureCode(lookup), input.now);
    }
    if (lookup.state === "not_found" && redispatchReason === null) {
      return redispatchStarted(
        input,
        prepared,
        entry,
        fetchImpl,
        execution,
        "receipt_not_found",
      );
    }
    throw receiptError(
      lookup.state,
      `Generated-visual Council dispatch outcome is ${lookup.state} (${lookup.code}); the stable request was not dispatched again.`,
      entry.binding,
      error,
    );
  }
  assertReceiptContinuationActive(input.signal);
  let proof: ReturnType<typeof httpCompletionProof>;
  try {
    proof = httpCompletionProof(response, prepared);
  } catch (error) {
    entry = persistHttpResponse(entry, null, input.now);
    const lookup = await resolveReceipt(input.client, entry.binding, prepared, fetchImpl);
    assertReceiptContinuationActive(input.signal);
    if (lookup.state === "completed") {
      persistCompletion(entry, lookup.result, input.now);
      return completionResult(lookup.result, entry.binding, true, execution, false);
    }
    throw error;
  }
  entry = persistHttpResponse(entry, proof, input.now);
  return resolveExisting(input, prepared, entry, fetchImpl, execution, {
    httpProof: proof,
    recovered: redispatchReason !== null,
  });
}

async function redispatchStarted(
  input: RunGeneratedVisualCouncilRequestInput,
  prepared: PreparedGeneratedVisualCouncilRequest,
  entry: BindingEntry,
  fetchImpl: RecoveryFetch,
  execution: InvocationExecution,
  reason: SameReceiptRedispatchReason,
  failedProof?: FailedReceiptProof,
): Promise<GeneratedVisualCouncilReceiptResult> {
  assertReceiptContinuationActive(input.signal);
  if (!entry.dispatch || entry.completion || entry.failure) {
    throw receiptError(
      "corrupt",
      "Generated-visual same-receipt redispatch lacks one exact ambiguous dispatch origin.",
      entry.binding,
    );
  }
  if (entry.response) {
    throw receiptError(
      entry.response.httpProofState === "valid" ? "conflict" : "corrupt",
      "A generated-visual HTTP completion was already observed; same-receipt redispatch is forbidden.",
      entry.binding,
    );
  }
  if (entry.redispatch) {
    throw receiptError(
      "not_found",
      "Generated-visual Council receipt is still absent after its one same-receipt redispatch authority was consumed.",
      entry.binding,
    );
  }
  if (
    (reason === "request_failed" &&
      !failedReceiptAllowsRedispatch({
        state: "failed",
        code: "request_failed",
        ...(failedProof ? { proof: failedProof } : {}),
      })) ||
    (reason === "receipt_not_found" && failedProof)
  ) {
    throw receiptError(
      "corrupt",
      "Generated-visual failed-receipt redispatch lacks one exact unused server proof.",
      entry.binding,
    );
  }
  const redispatchMarker: MarkerRecordUnsigned = {
    ...markerBase(
      entry,
      "generated_visual_council_redispatch",
      nowValue(input.now),
    ),
    redispatchReason: reason,
    ...(reason === "request_failed" && failedProof
      ? {
          failureCode: failedProof.failureCode,
          receiptDispatchGeneration: 1 as const,
          receiptDispatchCount: 1 as const,
          receiptRedispatchCount: 0 as const,
          receiptRedispatchAllowed: true as const,
          receiptProofHash: canonicalHash(failedProof),
        }
      : {}),
  };
  const claimed = publishMarker(entry, redispatchMarker);
  if (!claimed.published) {
    return resolveExisting(input, prepared, claimed.entry, fetchImpl, execution);
  }
  return postClaimedRequest(
    input,
    prepared,
    claimed.entry,
    fetchImpl,
    execution,
    reason,
  );
}

async function resumeClaimedRedispatchIfServerAuthorityIsUnused(
  input: RunGeneratedVisualCouncilRequestInput,
  prepared: PreparedGeneratedVisualCouncilRequest,
  entry: BindingEntry,
  fetchImpl: RecoveryFetch,
  execution: InvocationExecution,
  lookup: Exclude<ReceiptLookup, { state: "completed" }>,
): Promise<GeneratedVisualCouncilReceiptResult | null> {
  const marker = entry.redispatch;
  if (
    !entry.dispatch ||
    !marker ||
    entry.response ||
    entry.completion ||
    entry.failure
  ) {
    return null;
  }
  if (
    marker.redispatchReason === "receipt_not_found" &&
    lookup.state === "not_found"
  ) {
    assertReceiptContinuationActive(input.signal);
    return postClaimedRequest(
      input,
      prepared,
      entry,
      fetchImpl,
      execution,
      "receipt_not_found",
    );
  }
  if (
    marker.redispatchReason === "request_failed" &&
    failedReceiptAllowsRedispatch(lookup)
  ) {
    assertClaimedFailedReceiptProofMatches(entry, lookup.proof);
    assertReceiptContinuationActive(input.signal);
    return postClaimedRequest(
      input,
      prepared,
      entry,
      fetchImpl,
      execution,
      "request_failed",
    );
  }
  return null;
}

async function recoverStarted(
  input: RunGeneratedVisualCouncilRequestInput,
  prepared: PreparedGeneratedVisualCouncilRequest,
  entry: BindingEntry,
  fetchImpl: RecoveryFetch,
  execution: InvocationExecution,
): Promise<GeneratedVisualCouncilReceiptResult> {
  assertReceiptContinuationActive(input.signal);
  const lookup = await resolveReceipt(input.client, entry.binding, prepared, fetchImpl);
  assertReceiptContinuationActive(input.signal);
  if (lookup.state === "completed") {
    if (entry.response) {
      assertResponseMarkerMatchesReceipt(entry.response, lookup.result, entry.binding);
    }
    persistCompletion(entry, lookup.result, input.now);
    return completionResult(lookup.result, entry.binding, true, execution, false);
  }
  const resumed = await resumeClaimedRedispatchIfServerAuthorityIsUnused(
    input,
    prepared,
    entry,
    fetchImpl,
    execution,
    lookup,
  );
  if (resumed) return resumed;
  if (lookup.state === "not_found" && entry.dispatch) {
    if (entry.response) {
      throw receiptError(
        entry.response.httpProofState === "valid" ? "conflict" : "corrupt",
        "ChatMock lost a receipt after a generated-visual HTTP completion was observed; no redispatch was issued.",
        entry.binding,
      );
    }
    return redispatchStarted(
      input,
      prepared,
      entry,
      fetchImpl,
      execution,
      "receipt_not_found",
    );
  }
  if (lookup.state === "failed" && entry.dispatch) {
    if (entry.response) {
      throw receiptError(
        entry.response.httpProofState === "valid" ? "conflict" : "corrupt",
        "ChatMock reported failure after a generated-visual HTTP completion was observed.",
        entry.binding,
      );
    }
    if (failedReceiptAllowsRedispatch(lookup) && !entry.redispatch) {
      return redispatchStarted(
        input,
        prepared,
        entry,
        fetchImpl,
        execution,
        "request_failed",
        lookup.proof,
      );
    }
    persistFailure(entry, terminalFailureCode(lookup), input.now);
  }
  throwLookup(lookup, entry.binding);
}

async function dispatchPrepared(
  input: RunGeneratedVisualCouncilRequestInput,
  prepared: PreparedGeneratedVisualCouncilRequest,
  entry: BindingEntry,
  fetchImpl: RecoveryFetch,
  execution: InvocationExecution,
): Promise<GeneratedVisualCouncilReceiptResult> {
  assertReceiptContinuationActive(input.signal);
  const dispatchMarker = markerBase(
    entry,
    "generated_visual_council_dispatch",
    nowValue(input.now),
  );
  const claimed = publishMarker(entry, dispatchMarker);
  if (!claimed.published) {
    return recoverStarted(input, prepared, claimed.entry, fetchImpl, execution);
  }
  return postClaimedRequest(
    input,
    prepared,
    claimed.entry,
    fetchImpl,
    execution,
    null,
  );
}

/** Execute one generated-visual Council request behind a strict receipt.
 *
 * A binding is fsynced under durableRecoveryDir/.breadboard before an
 * exclusive dispatch marker can be published. An exact receipt_not_found, or
 * an exact generation-one failed/no-answer server proof, may publish one
 * additional same-id/hash redispatch marker. Failed-receipt recovery also
 * carries an explicit opt-in bit that ChatMock atomically consumes. No generic
 * transport status and no other receipt state authorizes a POST. If execution
 * dies after that immutable marker is written but before ChatMock observes the
 * POST, re-entry may resume the already-claimed POST only while the exact
 * server authority remains visibly unused; ChatMock's exclusive server claim
 * fences delayed contenders. Across invocation keys, only a still-ambiguous
 * exact request hash is recoverable; ordinary completed invocations are not
 * replayed into later deliberate regenerations.
 */
async function runGeneratedVisualCouncilRequestWithReceiptInternal(
  input: RunGeneratedVisualCouncilRequestInput,
): Promise<GeneratedVisualCouncilReceiptResult> {
  assertReceiptContinuationActive(input.signal);
  const execution: InvocationExecution = { dispatchCount: 0 };
  const prepared = prepareGeneratedVisualCouncilRequest(input.request, {
    allowImageUrlParts: input.allowImageUrlParts,
  });
  if (
    typeof input.invocationKey !== "string" ||
    !input.invocationKey ||
    input.invocationKey.length > 1_000
  ) {
    throw receiptError("conflict", "Generated-visual invocation key is invalid.");
  }
  const metadata = normalizedMetadata(input.recoveryMetadata);
  const invocationKeyHash = sha256(input.invocationKey);
  const directory = generatedVisualCouncilReceiptDirectory(input.durableRecoveryDir);
  try {
    ensureDirectoryDurable(directory);
  } catch (error) {
    throw receiptError(
      "corrupt",
      "Generated-visual durable recovery directory could not be prepared.",
      { requestHash: prepared.requestHash },
      error,
    );
  }
  const fetchImpl = input.fetchImpl ?? (fetch as RecoveryFetch);
  let current = findInvocationBinding(directory, invocationKeyHash);
  if (current) {
    assertBindingMatches(current, {
      invocationKey: input.invocationKey,
      requestHash: prepared.requestHash,
      prepared,
      metadata,
    });
    if (current.state === "failed") {
      throw receiptError(
        "failed",
        `Generated-visual Council request previously failed (${current.failure?.failureCode ?? "request_failed"}).`,
        current.binding,
      );
    }
    if (current.state === "started") {
      return recoverStarted(input, prepared, current, fetchImpl, execution);
    }
    if (current.state === "completed") {
      return resolveExisting(input, prepared, current, fetchImpl, execution);
    }
  } else {
    const ambiguous = listBindings(directory).filter(
      (entry) =>
        entry.binding.requestHash === prepared.requestHash &&
        entry.binding.invocationKeyHash !== invocationKeyHash &&
        entry.state === "started",
    );
    if (ambiguous.length > 1) {
      throw receiptError(
        "conflict",
        "Multiple ambiguous generated-visual requests match the exact request hash; no model request was issued.",
        { requestHash: prepared.requestHash },
      );
    }
    if (ambiguous.length === 1) {
      const origin = ambiguous[0];
      let lookup = await resolveReceipt(input.client, origin.binding, prepared, fetchImpl);
      assertReceiptContinuationActive(input.signal);
      let recoveredHttpCompletionObserved = false;
      if (lookup.state !== "completed") {
        const resumed = await resumeClaimedRedispatchIfServerAuthorityIsUnused(
          input,
          prepared,
          origin,
          fetchImpl,
          execution,
          lookup,
        );
        if (resumed) {
          recoveredHttpCompletionObserved = resumed.httpCompletionObserved;
          lookup = await resolveReceipt(
            input.client,
            origin.binding,
            prepared,
            fetchImpl,
          );
          assertReceiptContinuationActive(input.signal);
        }
      }
      if (
        lookup.state !== "completed" &&
        origin.dispatch &&
        (lookup.state === "not_found" ||
          (failedReceiptAllowsRedispatch(lookup) && !origin.redispatch))
      ) {
        const reason = lookup.state === "not_found"
          ? "receipt_not_found"
          : "request_failed";
        const redispatched = await redispatchStarted(
          input,
          prepared,
          origin,
          fetchImpl,
          execution,
          reason,
          lookup.state === "failed" ? lookup.proof : undefined,
        );
        recoveredHttpCompletionObserved = redispatched.httpCompletionObserved;
        lookup = await resolveReceipt(input.client, origin.binding, prepared, fetchImpl);
        assertReceiptContinuationActive(input.signal);
      }
      if (lookup.state !== "completed") {
        if (
          origin.response &&
          (lookup.state === "not_found" || lookup.state === "failed")
        ) {
          throw receiptError(
            origin.response.httpProofState === "valid" ? "conflict" : "corrupt",
            `ChatMock reported ${lookup.state} after an ambiguous generated-visual HTTP completion was observed.`,
            origin.binding,
          );
        }
        if (lookup.state === "failed" && origin.dispatch) {
          persistFailure(origin, terminalFailureCode(lookup), input.now);
        }
        throwLookup(lookup, origin.binding);
      }
      if (origin.response) {
        assertResponseMarkerMatchesReceipt(
          origin.response,
          lookup.result,
          origin.binding,
        );
      }
      persistCompletion(origin, lookup.result, input.now);
      current = publishBinding(directory, {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        kind: "generated_visual_council_binding",
        invocationKey: input.invocationKey,
        invocationKeyHash,
        requestId: origin.binding.requestId,
        requestHash: prepared.requestHash,
        requestedModel: prepared.route.requestedModel,
        resolvedModel: prepared.route.resolvedModel,
        provider: prepared.route.provider,
        upstreamModel: prepared.route.upstreamModel,
        councilMode: "direct_council",
        taskType: prepared.envelope.taskType!,
        gardenId: prepared.envelope.gardenId,
        pageId: prepared.envelope.pageId,
        metadata,
        createdAt: nowValue(input.now),
        adoptedFromInvocationKeyHash: origin.binding.invocationKeyHash,
      });
      if (current.binding.requestId !== origin.binding.requestId) {
        throw receiptError(
          "conflict",
          "Concurrent generated-visual invocation binding prevented exact receipt adoption.",
          current.binding,
        );
      }
      persistCompletion(current, lookup.result, input.now);
      return completionResult(
        lookup.result,
        current.binding,
        true,
        execution,
        recoveredHttpCompletionObserved,
      );
    }

    current = publishBinding(directory, {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      kind: "generated_visual_council_binding",
      invocationKey: input.invocationKey,
      invocationKeyHash,
      requestId: newRequestId(input.requestIdFactory),
      requestHash: prepared.requestHash,
      requestedModel: prepared.route.requestedModel,
      resolvedModel: prepared.route.resolvedModel,
      provider: prepared.route.provider,
      upstreamModel: prepared.route.upstreamModel,
      councilMode: "direct_council",
      taskType: prepared.envelope.taskType!,
      gardenId: prepared.envelope.gardenId,
      pageId: prepared.envelope.pageId,
      metadata,
      createdAt: nowValue(input.now),
    });
    assertBindingMatches(current, {
      invocationKey: input.invocationKey,
      requestHash: prepared.requestHash,
      prepared,
      metadata,
    });
    if (current.state !== "prepared") {
      return current.state === "started"
        ? recoverStarted(input, prepared, current, fetchImpl, execution)
        : resolveExisting(input, prepared, current, fetchImpl, execution);
    }
  }

  const preflight = await resolveReceipt(input.client, current.binding, prepared, fetchImpl);
  assertReceiptContinuationActive(input.signal);
  if (preflight.state === "completed") {
    persistCompletion(current, preflight.result, input.now);
    return completionResult(
      preflight.result,
      current.binding,
      true,
      execution,
      false,
    );
  }
  if (preflight.state !== "not_found") {
    if (preflight.state === "failed" && current.dispatch) {
      persistFailure(current, preflight.code, input.now);
    }
    throwLookup(preflight, current.binding);
  }
  return dispatchPrepared(input, prepared, current, fetchImpl, execution);
}

export async function runGeneratedVisualCouncilRequestWithReceipt(
  input: RunGeneratedVisualCouncilRequestInput,
): Promise<GeneratedVisualCouncilReceiptResult> {
  try {
    return await runGeneratedVisualCouncilRequestWithReceiptInternal(input);
  } catch (error) {
    if (error instanceof GeneratedVisualCouncilReceiptError) throw error;
    if (input.signal?.aborted && error === input.signal.reason) throw error;
    throw receiptError(
      "corrupt",
      "Generated-visual Council receipt boundary failed unexpectedly; no unbound retry is permitted.",
      undefined,
      error,
    );
  }
}
