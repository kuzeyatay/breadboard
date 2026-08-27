const STORAGE_KEY = "breadboard:runtime-v2:ingest-recovery:v1";
const MAX_RECORDS = 64;
const DEFAULT_RECOVERY_WAIT_MS = 30_000;
const DEFAULT_RETRY_INTERVAL_MS = 250;
const MAX_STORAGE_BYTES = 64 * 1024;
const MAX_SSE_BUFFER_BYTES = 64 * 1024;
const TERMINAL_STATES = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const RUNTIME_STATES = new Set([
  "queued",
  "admitted",
  "starting",
  "running",
  "checkpointing",
  "cancelling",
  ...TERMINAL_STATES,
]);
const IDEMPOTENCY_CANCELLATION_STATES = new Set([
  "pending",
  "cancelling",
  "cancelled",
  ...TERMINAL_STATES,
]);

export interface RuntimeIngestRecoveryRecord {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly jobId: string | null;
  readonly clusterSlug: string;
  readonly filename: string;
  readonly fileKey: string;
  readonly purpose: "documents" | "syllabus";
  readonly startedAt: number;
  readonly model: string | null;
  readonly cancelRequested: boolean;
}

export type RuntimeIngestStreamEvent = {
  readonly type?: string;
  readonly [key: string]: unknown;
};

export interface RuntimeIngestStreamOutcome {
  readonly terminalEvent: RuntimeIngestStreamEvent | null;
  readonly initialState: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function bounded(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximumBytes
  );
}

function validRecord(value: unknown): value is RuntimeIngestRecoveryRecord {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "protocolVersion",
      "requestId",
      "jobId",
      "clusterSlug",
      "filename",
      "fileKey",
      "purpose",
      "startedAt",
      "model",
      "cancelRequested",
    ]) &&
    value.protocolVersion === 1 &&
    bounded(value.requestId, 128) &&
    /^[A-Za-z0-9_-]+$/u.test(value.requestId) &&
    (value.jobId === null ||
      (bounded(value.jobId, 128) && /^[A-Za-z0-9_-]+$/u.test(value.jobId))) &&
    bounded(value.clusterSlug, 256) &&
    /^[\x21-\x7e]+$/u.test(value.clusterSlug) &&
    bounded(value.filename, 512) &&
    bounded(value.fileKey, 1024) &&
    (value.purpose === "documents" || value.purpose === "syllabus") &&
    Number.isSafeInteger(value.startedAt) &&
    (value.startedAt as number) > 0 &&
    (value.model === null || bounded(value.model, 256)) &&
    typeof value.cancelRequested === "boolean"
  );
}

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readRecords(): RuntimeIngestRecoveryRecord[] {
  const target = session();
  if (!target) return [];
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (raw === null) return [];
    if (new TextEncoder().encode(raw).byteLength > MAX_STORAGE_BYTES) {
      target.removeItem(STORAGE_KEY);
      return [];
    }
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > MAX_RECORDS || !value.every(validRecord)) {
      target.removeItem(STORAGE_KEY);
      return [];
    }
    return value;
  } catch {
    return [];
  }
}

function writeRecords(records: readonly RuntimeIngestRecoveryRecord[]): void {
  const target = session();
  if (!target) return;
  try {
    const boundedRecords = records.slice(-MAX_RECORDS);
    let serialized = JSON.stringify(boundedRecords);
    while (
      boundedRecords.length > 0 &&
      new TextEncoder().encode(serialized).byteLength > MAX_STORAGE_BYTES
    ) {
      boundedRecords.shift();
      serialized = JSON.stringify(boundedRecords);
    }
    if (boundedRecords.length === 0) target.removeItem(STORAGE_KEY);
    else target.setItem(STORAGE_KEY, serialized);
  } catch {
    // Recovery metadata is best effort when session storage is unavailable.
  }
}

function replaceRecord(
  requestId: string,
  update: (record: RuntimeIngestRecoveryRecord) => RuntimeIngestRecoveryRecord,
): RuntimeIngestRecoveryRecord | null {
  const records = readRecords();
  const index = records.findIndex((record) => record.requestId === requestId);
  if (index < 0) return null;
  const next = update(records[index]);
  if (!validRecord(next)) {
    throw new TypeError("Invalid ingestion recovery metadata.");
  }
  records[index] = next;
  writeRecords(records);
  return next;
}

export function beginRuntimeIngestRecovery(input: {
  readonly requestId: string;
  readonly clusterSlug: string;
  readonly filename: string;
  readonly fileKey: string;
  readonly startedAt: number;
  readonly purpose?: "documents" | "syllabus";
}): RuntimeIngestRecoveryRecord {
  const record: RuntimeIngestRecoveryRecord = {
    protocolVersion: 1,
    requestId: input.requestId,
    jobId: null,
    clusterSlug: input.clusterSlug,
    filename: input.filename,
    fileKey: input.fileKey,
    purpose: input.purpose ?? "documents",
    startedAt: input.startedAt,
    model: null,
    cancelRequested: false,
  };
  if (!validRecord(record)) throw new TypeError("Invalid ingestion recovery metadata.");
  const records = readRecords().filter((item) => item.requestId !== record.requestId);
  records.push(record);
  writeRecords(records);
  return record;
}

export function bindRuntimeIngestRecovery(
  requestId: string,
  input: {
    readonly jobId: string;
    readonly model?: string | null;
    readonly startedAt?: number;
  },
): RuntimeIngestRecoveryRecord | null {
  return replaceRecord(requestId, (record) => ({
    ...record,
    jobId: input.jobId,
    model: input.model === undefined ? record.model : input.model,
    startedAt: input.startedAt ?? record.startedAt,
  }));
}

export function bindRuntimeIngestResponse(
  requestId: string,
  response: Response,
): RuntimeIngestRecoveryRecord | null {
  const jobId = response.headers.get("x-breadboard-runtime-job-id");
  if (!jobId) return runtimeIngestRecoveryRecord(requestId);
  const encodedModel = response.headers.get("x-breadboard-ingest-model");
  let model: string | null | undefined;
  if (encodedModel !== null) {
    try {
      model = decodeURIComponent(encodedModel);
    } catch {
      model = undefined;
    }
  }
  const rawStartedAt = response.headers.get("x-breadboard-ingest-started-at");
  const parsedStartedAt = rawStartedAt !== null ? Number(rawStartedAt) : NaN;
  return bindRuntimeIngestRecovery(requestId, {
    jobId,
    ...(model === undefined ? {} : { model }),
    ...(Number.isSafeInteger(parsedStartedAt) && parsedStartedAt > 0
      ? { startedAt: parsedStartedAt }
      : {}),
  });
}

export function markRuntimeIngestCancellation(
  requestId: string,
): RuntimeIngestRecoveryRecord | null {
  return replaceRecord(requestId, (record) => ({ ...record, cancelRequested: true }));
}

export function forgetRuntimeIngestRecovery(requestId: string): void {
  writeRecords(readRecords().filter((record) => record.requestId !== requestId));
}

export function runtimeIngestRecoveryRecord(
  requestId: string,
): RuntimeIngestRecoveryRecord | null {
  return readRecords().find((record) => record.requestId === requestId) ?? null;
}

export function runtimeIngestRecoveries(
  clusterSlug?: string,
): RuntimeIngestRecoveryRecord[] {
  const records = readRecords();
  return clusterSlug === undefined
    ? records
    : records.filter((record) => record.clusterSlug === clusterSlug);
}

export function isTerminalRuntimeIngestState(state: string | null): boolean {
  return state !== null && TERMINAL_STATES.has(state);
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function lookupRuntimeIngestRecovery(
  record: RuntimeIngestRecoveryRecord,
  signal?: AbortSignal,
): Promise<RuntimeIngestRecoveryRecord | null> {
  const response = await fetch("/api/ingest/jobs/lookup", {
    method: "POST",
    headers: {
      "X-Breadboard-Ingest-Cluster-Slug": record.clusterSlug,
      "X-Breadboard-Ingest-Request-Id": record.requestId,
    },
    cache: "no-store",
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Runtime ingestion recovery is unavailable.");
  const value: unknown = await response.json().catch(() => null);
  if (
    !isRecord(value) ||
    !exactKeys(value, ["jobId", "state"]) ||
    !bounded(value.jobId, 128) ||
    !/^[A-Za-z0-9_-]+$/u.test(value.jobId) ||
    typeof value.state !== "string" ||
    !RUNTIME_STATES.has(value.state)
  ) {
    throw new Error("Runtime ingestion recovery returned invalid metadata.");
  }
  return bindRuntimeIngestRecovery(record.requestId, { jobId: value.jobId });
}

export async function readRuntimeIngestEventStream(
  response: Response,
  onEvent: (event: RuntimeIngestStreamEvent) => void,
): Promise<RuntimeIngestStreamOutcome> {
  if (!response.ok || !response.body) {
    throw new Error("Runtime ingestion stream is unavailable.");
  }
  const initialState = response.headers.get("x-breadboard-runtime-job-state");
  if (initialState !== null && !RUNTIME_STATES.has(initialState)) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("Runtime ingestion stream returned invalid metadata.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalEvent: RuntimeIngestStreamEvent | null = null;
  const handleBlock = (block: string) => {
    const payload = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/u, ""))
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const event: unknown = JSON.parse(payload);
      if (!isRecord(event)) return;
      onEvent(event);
      if (event.type === "result" || event.type === "error") terminalEvent = event;
    } catch {
      // Ignore malformed SSE blocks; the durable recovery record remains.
    }
  };
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > MAX_SSE_BUFFER_BYTES) {
        throw new Error("Runtime ingestion stream exceeded its bounded buffer.");
      }
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) handleBlock(block);
    }
    if (buffer.trim()) handleBlock(buffer);
    return { terminalEvent, initialState };
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function reattachRuntimeIngest(
  record: RuntimeIngestRecoveryRecord,
  onEvent: (event: RuntimeIngestStreamEvent) => void,
  signal?: AbortSignal,
): Promise<RuntimeIngestStreamOutcome> {
  if (!record.jobId) throw new Error("Runtime ingestion job is not identified.");
  const response = await fetch(
    `/api/ingest/jobs/${encodeURIComponent(record.jobId)}/events`,
    {
      method: "GET",
      headers: {
        "X-Breadboard-Ingest-Cluster-Slug": record.clusterSlug,
        "X-Breadboard-Ingest-Started-At": String(record.startedAt),
        ...(record.model === null
          ? {}
          : { "X-Breadboard-Ingest-Model": encodeURIComponent(record.model) }),
      },
      cache: "no-store",
      signal,
    },
  );
  bindRuntimeIngestResponse(record.requestId, response);
  return readRuntimeIngestEventStream(response, onEvent);
}

export async function recoverRuntimeIngest(
  record: RuntimeIngestRecoveryRecord,
  onEvent: (event: RuntimeIngestStreamEvent) => void,
  options: {
    readonly signal?: AbortSignal;
    readonly lookupWaitMs?: number;
    readonly retryIntervalMs?: number;
  } = {},
): Promise<RuntimeIngestStreamOutcome | null> {
  const lookupWaitMs = options.lookupWaitMs ?? DEFAULT_RECOVERY_WAIT_MS;
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  let current = runtimeIngestRecoveryRecord(record.requestId) ?? record;
  let retryDeadline: number | null = current.jobId
    ? null
    : Date.now() + lookupWaitMs;
  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (!current.jobId) {
      const found = await lookupRuntimeIngestRecovery(current, options.signal);
      if (found) {
        current = found;
        retryDeadline = null;
      }
      else {
        if (retryDeadline !== null && Date.now() >= retryDeadline) return null;
        await wait(retryIntervalMs, options.signal);
        current = runtimeIngestRecoveryRecord(record.requestId) ?? current;
        if (current.jobId) retryDeadline = null;
        continue;
      }
    }
    try {
      const outcome = await reattachRuntimeIngest(
        current,
        onEvent,
        options.signal,
      );
      if (outcome.terminalEvent !== null) {
        forgetRuntimeIngestRecovery(current.requestId);
        return outcome;
      }
      retryDeadline = Date.now() + lookupWaitMs;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      retryDeadline ??= Date.now() + lookupWaitMs;
      if (Date.now() >= retryDeadline) throw error;
    }
    await wait(retryIntervalMs, options.signal);
    current = runtimeIngestRecoveryRecord(record.requestId) ?? current;
  }
}

export async function cancelRuntimeIngestRecovery(
  record: RuntimeIngestRecoveryRecord,
): Promise<boolean> {
  if (!record.jobId) return false;
  const response = await fetch(
    `/api/ingest/jobs/${encodeURIComponent(record.jobId)}/cancel`,
    {
      method: "POST",
      headers: {
        "X-Breadboard-Ingest-Cluster-Slug": record.clusterSlug,
      },
    },
  );
  if (!response.ok) return false;
  const disposition: unknown = await response.json().catch(() => null);
  if (
    !isRecord(disposition) ||
    !exactKeys(disposition, ["jobId", "state", "accepted"]) ||
    disposition.jobId !== record.jobId ||
    typeof disposition.state !== "string" ||
    !RUNTIME_STATES.has(disposition.state) ||
    typeof disposition.accepted !== "boolean"
  ) {
    return false;
  }
  if (!disposition.accepted && isTerminalRuntimeIngestState(disposition.state)) {
    forgetRuntimeIngestRecovery(record.requestId);
    return true;
  }
  return disposition.accepted;
}

async function cancelRuntimeIngestByIdempotency(
  record: RuntimeIngestRecoveryRecord,
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await fetch("/api/ingest/jobs/cancel-pending", {
    method: "POST",
    headers: {
      "X-Breadboard-Ingest-Cluster-Slug": record.clusterSlug,
      "X-Breadboard-Ingest-Request-Id": record.requestId,
    },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    // In particular, a closed cancellation-tombstone quota must retain the
    // browser recovery record so a later explicit retry can resolve it.
    throw new Error("Runtime ingestion cancellation is unavailable.");
  }
  const disposition: unknown = await response.json().catch(() => null);
  if (
    !isRecord(disposition) ||
    !exactKeys(disposition, ["jobId", "state", "accepted"]) ||
    (disposition.jobId !== null &&
      (!bounded(disposition.jobId, 128) ||
        !/^[A-Za-z0-9_-]+$/u.test(disposition.jobId))) ||
    typeof disposition.state !== "string" ||
    !IDEMPOTENCY_CANCELLATION_STATES.has(disposition.state) ||
    typeof disposition.accepted !== "boolean" ||
    (disposition.state === "pending" &&
      (disposition.jobId !== null || disposition.accepted !== true)) ||
    (disposition.state !== "pending" && disposition.jobId === null) ||
    ((disposition.state === "cancelling" || disposition.state === "cancelled") &&
      disposition.accepted !== true) ||
    (TERMINAL_STATES.has(disposition.state) &&
      disposition.state !== "cancelled" &&
      disposition.accepted !== false)
  ) {
    throw new Error("Runtime ingestion cancellation returned invalid metadata.");
  }
  if (typeof disposition.jobId === "string") {
    bindRuntimeIngestRecovery(record.requestId, {
      jobId: disposition.jobId,
    });
  }
  if (
    disposition.state === "pending" ||
    disposition.state === "cancelled" ||
    (!disposition.accepted && TERMINAL_STATES.has(disposition.state))
  ) {
    forgetRuntimeIngestRecovery(record.requestId);
    return true;
  }
  return disposition.accepted;
}

export async function cancelPendingRuntimeIngest(
  requestId: string,
  options: {
    readonly signal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const record = markRuntimeIngestCancellation(requestId);
  if (!record) return true;
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return record.jobId
    ? cancelRuntimeIngestRecovery(record)
    : cancelRuntimeIngestByIdempotency(record, options.signal);
}

export const runtimeIngestRecoveryStorageKeyForTests = STORAGE_KEY;
