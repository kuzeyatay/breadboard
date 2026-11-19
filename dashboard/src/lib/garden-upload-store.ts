/**
 * Module-level engine for garden document uploads.
 *
 * Upload tasks must survive the workspace page: navigating away unmounts the
 * React tree, but the browser keeps the in-flight requests alive, so the
 * engine that drives them lives here instead of in component state. The
 * workspace subscribes with useSyncExternalStore while mounted, and registers
 * a sink so the engine can show toasts and refresh page data; while no sink is
 * registered, toasts queue and are delivered when the workspace returns.
 *
 * A task only stops when every file settles, or when the user cancels it.
 */

import {
  beginRuntimeIngestRecovery,
  bindRuntimeIngestResponse,
  cancelPendingRuntimeIngest,
  forgetRuntimeIngestRecovery,
  recoverRuntimeIngest,
  runtimeIngestRecoveryRecord,
} from "@/lib/runtime-v2/ingest-recovery-client";
import type { IngestTokenUsage } from "@/lib/ingest-token-usage";
import {
  MAX_RETRIES_PER_DOCUMENT,
  emptyIngestAutoRetryLedger,
  ingestAutoRetryDecision,
  ingestDocumentKey,
  withRecordedIngestRetry,
  type IngestAutoRetryDecision,
  type IngestAutoRetryLedger,
} from "@/lib/ingest-auto-retry";
import { VLM_PARSE_FILE_RE } from "@/app/components/vlm-parse-option";

const HANDWRITING_FILE_RE = /\.(pdf|jpg|jpeg|png|webp)$/i;

export type GardenUploadFileStatus = "pending" | "uploading" | "done" | "error";

export type GardenUploadTaskState = "uploading" | "done" | "canceled";

export interface GardenUploadTaskOptions {
  label: string;
  handwriting: boolean;
  parseWithVlm: boolean;
  generateMap: boolean;
}

export interface GardenUploadTask {
  id: string;
  clusterSlug: string;
  files: File[];
  statuses: Record<string, GardenUploadFileStatus>;
  errors: Record<string, string>;
  steps: Record<string, string>;
  tokenUsage: Record<string, IngestTokenUsage>;
  visionErrors: Record<string, string>;
  /**
   * Per file, the retained-upload record a failure left behind (the server
   * kept the bytes and request), so the failed row can offer Resume.
   */
  recoveryIds: Record<string, string>;
  /** Per file, the record this task is replaying instead of uploading bytes. */
  resumingRecoveryIds: Record<string, string>;
  options: GardenUploadTaskOptions;
  state: GardenUploadTaskState;
  startedAt: number;
  completedAt: number | null;
}

/** What the garden's recovery route lists for a failed upload. */
export interface GardenUploadRecovery {
  recoveryId: string;
  filename: string;
  sizeBytes: number;
  failedAt: number;
  failure: { message: string; kind: "provider-quota" | "runtime" };
  lastStep: string;
  request: {
    parseWithVlm: boolean;
    parseWithAnydoc: boolean;
    isHandwriting: boolean;
    generateMap: boolean;
    model: string | null;
  };
  resumedJobId: string | null;
  resumedState?: string | null;
}

export type GardenUploadToast = {
  message: string;
  type?: "success" | "error";
  title?: string;
};

/**
 * What a mounted workspace offers the engine. `refreshAfterFile` runs when a
 * single file lands (document list + graph); `refreshAfterTask` when a whole
 * task settles with successes (documents, learn status, expanded source list).
 */
export interface GardenUploadSink {
  addToast: (toast: GardenUploadToast) => void;
  refreshAfterFile: () => void;
  refreshAfterTask: () => void;
  /** A failure kept a recovery record, or a resume settled one. */
  refreshRecoveries?: () => void;
  isTaskStatusVisible: (taskId: string) => boolean;
}

const MAX_QUEUED_TOASTS = 20;

let tasks: readonly GardenUploadTask[] = [];
const listeners = new Set<() => void>();
const sinks = new Map<string, GardenUploadSink>();
const queuedToasts = new Map<string, GardenUploadToast[]>();

const abortControllers = new Map<string, AbortController>();
const canceledTaskIds = new Set<string>();
const runtimeJobIds = new Map<string, Set<string>>();
const recoveryRequestIds = new Map<string, Set<string>>();
/**
 * What each document has already spent of its auto-retry budget, by
 * `ingestDocumentKey`. It lives here rather than on the task because a retry
 * is a new task: counting per task would hand every attempt a fresh budget and
 * make the bound meaningless. It is per session on purpose — a reload is a
 * person arriving, and they get the failed row and its Resume button.
 */
const retryLedgers = new Map<string, IngestAutoRetryLedger>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/*
 * Queued files outlive the app. A File only exists in this page's memory, so
 * closing the app used to drop every file still waiting its turn, and the one
 * in flight lost its bytes if the Runtime had not received or finished it.
 * IndexedDB stores Blobs natively: each file is kept there until its upload
 * settles, and the next visit to the garden queues whatever is left. A
 * resubmitted document that did land is skipped by the server's duplicate
 * check, so replaying is safe.
 */
interface QueuedUploadRecord {
  id: string;
  clusterSlug: string;
  file: File;
  options: GardenUploadTaskOptions;
  requestId: string | null;
  attempts: number;
  createdAt: number;
}

const QUEUE_DB = "breadboard-garden-upload-queue";
const QUEUE_STORE = "files";
const MAX_QUEUED_REPLAYS = 3;
const fileQueueIds = new WeakMap<File, string>();
/**
 * Queue records this page has taken on, kept after they settle: a revisit or a
 * late follower must never replay a file this page already ran.
 */
const liveQueueIds = new Set<string>();
const liveQueueRecords = new Map<string, QueuedUploadRecord>();
/** Writes apply in call order, so a late put can never revive a deleted file. */
let queueChain: Promise<unknown> = Promise.resolve();

function openQueueDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(QUEUE_DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function queueStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const next = queueChain.then(() => runQueueStore(mode, run));
  queueChain = next.catch(() => undefined);
  return next;
}

async function runQueueStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openQueueDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = run(db.transaction(QUEUE_STORE, mode).objectStore(QUEUE_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

function persistQueuedUpload(record: QueuedUploadRecord): void {
  void queueStore("readwrite", (store) => store.put(record));
}

async function readQueuedUploads(): Promise<QueuedUploadRecord[]> {
  return ((await queueStore("readonly", (store) => store.getAll())) ?? []) as QueuedUploadRecord[];
}

function dropQueuedUpload(file: File): void {
  const id = fileQueueIds.get(file);
  if (!id) return;
  liveQueueRecords.delete(id);
  void queueStore("readwrite", (store) => store.delete(id));
}

function markQueuedUploadRequest(file: File, requestId: string): void {
  const id = fileQueueIds.get(file);
  const record = id ? liveQueueRecords.get(id) : undefined;
  if (!record) return;
  const next = { ...record, requestId };
  liveQueueRecords.set(record.id, next);
  persistQueuedUpload(next);
}

/** Start the files as one sequential task, keeping each in the durable queue. */
function startQueuedFiles(
  clusterSlug: string,
  records: Array<Pick<QueuedUploadRecord, "id" | "file" | "attempts" | "createdAt">>,
  options: GardenUploadTaskOptions,
): string {
  for (const record of records) {
    const queued = { ...record, clusterSlug, options, requestId: null };
    fileQueueIds.set(record.file, record.id);
    liveQueueIds.add(record.id);
    liveQueueRecords.set(record.id, queued);
    persistQueuedUpload(queued);
  }
  return startTask(clusterSlug, records.map((record) => record.file), options, {});
}

/**
 * Queue again whatever a closed app left behind for this garden: files that
 * never started, and files whose Runtime job no longer exists. A file whose
 * job is still known is left to the restored-upload follower, which hands it
 * back through `settleRestoredGardenUpload`.
 */
export async function resumeQueuedGardenUploads(clusterSlug: string): Promise<void> {
  const leftovers = (await readQueuedUploads())
    .filter((record) => record.clusterSlug === clusterSlug && !liveQueueIds.has(record.id))
    .filter((record) => !record.requestId || !runtimeIngestRecoveryRecord(record.requestId))
    .sort((a, b) => a.createdAt - b.createdAt);
  const groups = new Map<string, QueuedUploadRecord[]>();
  for (const record of leftovers) {
    if (liveQueueIds.has(record.id)) continue;
    if (record.attempts >= MAX_QUEUED_REPLAYS) {
      void queueStore("readwrite", (store) => store.delete(record.id));
      sinkToast(clusterSlug, {
        message: `${record.file.name} could not be uploaded after ${MAX_QUEUED_REPLAYS} tries. Add it again from Documents.`,
      });
      continue;
    }
    const key = JSON.stringify(record.options);
    groups.set(key, [...(groups.get(key) ?? []), { ...record, attempts: record.attempts + 1 }]);
  }
  for (const group of groups.values()) {
    startQueuedFiles(clusterSlug, group, group[0].options);
  }
}

/**
 * A restored upload's job ended. When the app closed under it (the job never
 * arrived, or the Runtime abandoned it on restart) and the file is still in
 * the queue, upload it again instead of showing a dead row. Returns whether
 * it was queued again; otherwise the queued copy is released.
 */
export async function settleRestoredGardenUpload(
  requestId: string,
  interrupted: boolean,
): Promise<boolean> {
  const record = (await readQueuedUploads()).find((item) => item.requestId === requestId);
  if (!record) return false;
  // The mount-time resume already queued it again; the row is in hand.
  if (liveQueueIds.has(record.id)) return true;
  if (!interrupted || record.attempts >= MAX_QUEUED_REPLAYS) {
    void queueStore("readwrite", (store) => store.delete(record.id));
    return false;
  }
  startQueuedFiles(record.clusterSlug, [{ ...record, attempts: record.attempts + 1 }], record.options);
  return true;
}

export function gardenUploadFileKey(f: File): string {
  return `${f.name}-${f.size}`;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeGardenUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function gardenUploadTasksSnapshot(): readonly GardenUploadTask[] {
  return tasks;
}

const EMPTY_TASKS: readonly GardenUploadTask[] = [];

export function gardenUploadTasksServerSnapshot(): readonly GardenUploadTask[] {
  return EMPTY_TASKS;
}

export function registerGardenUploadSink(
  clusterSlug: string,
  sink: GardenUploadSink,
): () => void {
  sinks.set(clusterSlug, sink);
  const queued = queuedToasts.get(clusterSlug);
  if (queued) {
    queuedToasts.delete(clusterSlug);
    for (const toast of queued) sink.addToast(toast);
  }
  return () => {
    if (sinks.get(clusterSlug) === sink) sinks.delete(clusterSlug);
  };
}

function sinkToast(clusterSlug: string, toast: GardenUploadToast): void {
  const sink = sinks.get(clusterSlug);
  if (sink) {
    sink.addToast(toast);
    return;
  }
  const queue = queuedToasts.get(clusterSlug) ?? [];
  queue.push(toast);
  queuedToasts.set(clusterSlug, queue.slice(-MAX_QUEUED_TOASTS));
}

function taskStatusVisible(clusterSlug: string, taskId: string): boolean {
  return sinks.get(clusterSlug)?.isTaskStatusVisible(taskId) ?? false;
}

function sinkRefreshRecoveries(clusterSlug: string): void {
  sinks.get(clusterSlug)?.refreshRecoveries?.();
}

function recoveryIdFromEvent(event: Record<string, unknown>): string | null {
  const recoveryId = event.recoveryId;
  return typeof recoveryId === "string" && /^rec_[0-9a-f]{32}$/u.test(recoveryId)
    ? recoveryId
    : null;
}

function updateTask(
  taskId: string,
  update: (task: GardenUploadTask) => GardenUploadTask,
): void {
  let changed = false;
  tasks = tasks.map((task) => {
    if (task.id !== taskId) return task;
    changed = true;
    return update(task);
  });
  if (changed) notify();
}

/**
 * True while an in-memory upload loop still owns this recovery record. The
 * workspace's mount-time recovery pass skips these so a page revisit does not
 * open a second event stream against a job this engine is already following.
 */
export function hasLiveGardenUploadRequest(requestId: string): boolean {
  for (const ids of recoveryRequestIds.values()) {
    if (ids.has(requestId)) return true;
  }
  return false;
}

export function removeGardenUploadTask(taskId: string): void {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.state === "uploading") return;
  tasks = tasks.filter((candidate) => candidate.id !== taskId);
  notify();
}

export function cancelGardenUploadTask(taskId: string): void {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (task?.state !== "uploading") return;
  const requestIds = [...(recoveryRequestIds.get(taskId) ?? [])];
  for (const requestId of requestIds) {
    void (async () => {
      try {
        await cancelPendingRuntimeIngest(requestId);
        const record = runtimeIngestRecoveryRecord(requestId);
        if (!record) return;
        if (!record.jobId) {
          return;
        }
        await recoverRuntimeIngest(record, () => undefined);
      } finally {
        recoveryRequestIds.get(taskId)?.delete(requestId);
      }
    })().catch(() => undefined);
  }
  runtimeJobIds.get(taskId)?.clear();
  for (const file of task.files) dropQueuedUpload(file);
  canceledTaskIds.add(taskId);
  abortControllers.get(taskId)?.abort();
}

export function startGardenUploadTask(input: {
  clusterSlug: string;
  files: File[];
  options: GardenUploadTaskOptions;
}): string {
  const now = Date.now();
  return startQueuedFiles(
    input.clusterSlug,
    input.files.map((file, index) => ({
      id: crypto.randomUUID(),
      file,
      attempts: 0,
      createdAt: now + index,
    })),
    input.options,
  );
}

/**
 * Replay a failed upload from the copy the server kept. No bytes leave the
 * browser: the task carries an empty placeholder File for the row, and the
 * resume route streams the retained document into a new Runtime job. The
 * request options are the record's; the model is the person's current pick.
 */
export function resumeGardenUploadRecovery(input: {
  clusterSlug: string;
  recovery: GardenUploadRecovery;
}): string {
  const { recovery } = input;
  // A person taking over resets the automatic budget: they have seen the
  // failure and decided it is worth another run.
  settleUploadRetries(
    ingestDocumentKey({ clusterSlug: input.clusterSlug, filename: recovery.filename }),
  );
  const placeholder = new File([], recovery.filename);
  return startTask(
    input.clusterSlug,
    [placeholder],
    {
      label: "",
      handwriting: recovery.request.isHandwriting,
      parseWithVlm: recovery.request.parseWithVlm,
      generateMap: recovery.request.generateMap,
    },
    { [gardenUploadFileKey(placeholder)]: recovery.recoveryId },
  );
}

/** Stop an auto-retry that a person or a later success has overtaken. */
function settleUploadRetries(documentKey: string): void {
  const timer = retryTimers.get(documentKey);
  if (timer !== undefined) {
    clearTimeout(timer);
    retryTimers.delete(documentKey);
  }
  retryLedgers.delete(documentKey);
}

/**
 * Re-run a failed upload from the copy the server kept, after a wait. The row
 * that failed says so and names the wait, so an upload that is quietly fixing
 * itself never looks like one that has hung.
 */
function scheduleUploadRetry(input: {
  taskId: string;
  clusterSlug: string;
  key: string;
  fileName: string;
  documentKey: string;
  recoveryId: string;
  options: GardenUploadTaskOptions;
  decision: IngestAutoRetryDecision;
}): void {
  const { decision, documentKey } = input;
  const ledger = withRecordedIngestRetry(
    retryLedgers.get(documentKey) ?? emptyIngestAutoRetryLedger(documentKey),
    decision.cause,
  );
  retryLedgers.set(documentKey, ledger);
  const seconds = Math.max(1, Math.round(decision.delayMs / 1000));
  updateTask(input.taskId, (task) => ({
    ...task,
    statuses: { ...task.statuses, [input.key]: "error" },
    errors: {
      ...task.errors,
      [input.key]:
        `${input.fileName} failed (${decision.cause}); retrying in ${seconds}s — ` +
        `attempt ${ledger.total} of ${MAX_RETRIES_PER_DOCUMENT}.`,
    },
    recoveryIds: { ...task.recoveryIds, [input.key]: input.recoveryId },
  }));
  const timer = setTimeout(() => {
    retryTimers.delete(documentKey);
    // The bytes are replayed from the retained copy, so the new task carries
    // an empty placeholder exactly as a manual resume does.
    const placeholder = new File([], input.fileName);
    startTask(input.clusterSlug, [placeholder], input.options, {
      [gardenUploadFileKey(placeholder)]: input.recoveryId,
    });
  }, decision.delayMs);
  retryTimers.set(documentKey, timer);
}

function startTask(
  clusterSlug: string,
  files: File[],
  options: GardenUploadTaskOptions,
  resumingRecoveryIds: Record<string, string>,
): string {
  const taskId = crypto.randomUUID();
  const statuses: Record<string, GardenUploadFileStatus> = {};
  for (const file of files) statuses[gardenUploadFileKey(file)] = "pending";
  tasks = [
    ...tasks,
    {
      id: taskId,
      clusterSlug,
      files,
      statuses,
      errors: {},
      steps: {},
      tokenUsage: {},
      visionErrors: {},
      recoveryIds: {},
      resumingRecoveryIds,
      options,
      state: "uploading",
      startedAt: Date.now(),
      completedAt: null,
    },
  ];
  notify();
  void runUploadTask(taskId, clusterSlug, files, options, resumingRecoveryIds);
  return taskId;
}

async function runUploadTask(
  taskId: string,
  clusterSlug: string,
  files: File[],
  options: GardenUploadTaskOptions,
  resumingRecoveryIds: Record<string, string> = {},
): Promise<void> {
  const abortController = new AbortController();
  abortControllers.set(taskId, abortController);
  canceledTaskIds.delete(taskId);
  runtimeJobIds.set(taskId, new Set());
  recoveryRequestIds.set(taskId, new Set());

  const setTaskStatuses = (
    update: (
      current: Record<string, GardenUploadFileStatus>,
    ) => Record<string, GardenUploadFileStatus>,
  ) => updateTask(taskId, (task) => ({ ...task, statuses: update(task.statuses) }));
  const setTaskErrors = (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => updateTask(taskId, (task) => ({ ...task, errors: update(task.errors) }));
  const setTaskSteps = (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => updateTask(taskId, (task) => ({ ...task, steps: update(task.steps) }));
  const setTaskTokenUsage = (
    update: (
      current: Record<string, IngestTokenUsage>,
    ) => Record<string, IngestTokenUsage>,
  ) =>
    updateTask(taskId, (task) => ({
      ...task,
      tokenUsage: update(task.tokenUsage),
    }));
  const setTaskVisionErrors = (
    update: (current: Record<string, string>) => Record<string, string>,
  ) =>
    updateTask(taskId, (task) => ({
      ...task,
      visionErrors: update(task.visionErrors),
    }));
  const setTaskRecoveryId = (key: string, recoveryId: string | null) =>
    updateTask(taskId, (task) => {
      const next = { ...task.recoveryIds };
      if (recoveryId) next[key] = recoveryId;
      else delete next[key];
      return { ...task, recoveryIds: next };
    });
  // A failure that kept a recovery record is worth naming in the toast: the
  // person can resume it from the garden instead of uploading again.
  const failFile = (
    key: string,
    fileName: string,
    message: string,
    recoveryId: string | null,
  ) => {
    setTaskStatuses((current) => ({ ...current, [key]: "error" }));
    setTaskErrors((current) => ({ ...current, [key]: message }));
    setTaskRecoveryId(key, recoveryId);
    if (recoveryId) sinkRefreshRecoveries(clusterSlug);
    if (!taskStatusVisible(clusterSlug, taskId)) {
      sinkToast(clusterSlug, {
        message: `${fileName}: ${message}${recoveryId ? " The upload was kept and can be resumed from Documents." : ""}`,
      });
    }
  };
  const deferredRecoveryIds = new Set<string>();
  let mainLoopFinished = false;
  const finishTaskWhenSettled = () => {
    if (!mainLoopFinished || deferredRecoveryIds.size > 0) return;
    const canceled =
      canceledTaskIds.has(taskId) || abortController.signal.aborted;
    updateTask(taskId, (task) => ({
      ...task,
      state: canceled ? "canceled" : "done",
      completedAt: Date.now(),
    }));
    abortControllers.delete(taskId);
    runtimeJobIds.delete(taskId);
    recoveryRequestIds.delete(taskId);
    canceledTaskIds.delete(taskId);
  };

  let successCount = 0;
  let duplicateCount = 0;
  let snapshotCount = 0;
  let figureCount = 0;
  let mapGeneratedCount = 0;
  const screenshotWarnings: string[] = [];
  const mapWarnings: string[] = [];
  const hiddenContentWarnings: string[] = [];

  for (const file of files) {
    if (canceledTaskIds.has(taskId) || abortController.signal.aborted) break;

    const key = gardenUploadFileKey(file);
    setTaskStatuses((current) => ({ ...current, [key]: "uploading" }));
    setTaskSteps((current) => ({ ...current, [key]: "Starting…" }));

    const usesVlm = options.parseWithVlm && VLM_PARSE_FILE_RE.test(file.name);
    // anydoc always runs server-side; model OCR overrides the text layer.
    const usesHandwriting =
      !usesVlm &&
      options.handwriting &&
      HANDWRITING_FILE_RE.test(file.name);
    const formData = new FormData();
    formData.append("clusterSlug", clusterSlug);
    formData.append("file", file);
    if (options.label) formData.append("sourceLabel", options.label);
    formData.append("isHandwriting", String(usesHandwriting));
    formData.append("parseWithVlm", String(usesVlm));
    formData.append(
      "generateMap",
      String(usesHandwriting || options.generateMap),
    );

    const requestId = crypto.randomUUID();
    beginRuntimeIngestRecovery({
      requestId,
      clusterSlug,
      filename: file.name,
      fileKey: key,
      startedAt: Date.now(),
    });
    recoveryRequestIds.get(taskId)?.add(requestId);
    markQueuedUploadRequest(file, requestId);
    let runtimeJobId: string | null = null;
    let terminalOutcome = false;
    const continueRuntimeRecovery = () => {
      const record = runtimeIngestRecoveryRecord(requestId);
      if (!record) {
        const message = "Upload status could not be recovered";
        setTaskStatuses((current) => ({ ...current, [key]: "error" }));
        setTaskErrors((current) => ({ ...current, [key]: message }));
        if (!taskStatusVisible(clusterSlug, taskId)) {
          sinkToast(clusterSlug, { message: `${file.name}: ${message}` });
        }
        return;
      }
      deferredRecoveryIds.add(requestId);
      void recoverRuntimeIngest(
        record,
        (event) => {
          if (event.type === "progress" && typeof event.step === "string") {
            setTaskSteps((current) => ({
              ...current,
              [key]: event.step as string,
            }));
          } else if (event.type === "result") {
            setTaskStatuses((current) => ({ ...current, [key]: "done" }));
            setTaskErrors((current) => {
              const next = { ...current };
              delete next[key];
              return next;
            });
          } else if (event.type === "error" && event.canceled !== true) {
            const message =
              typeof event.error === "string" ? event.error : "Upload failed";
            failFile(key, file.name, message, recoveryIdFromEvent(event));
          }
        },
        { signal: abortController.signal },
      )
        .then((outcome) => {
          if (!outcome?.terminalEvent) {
            const message = "Upload status could not be recovered";
            setTaskStatuses((current) => ({ ...current, [key]: "error" }));
            setTaskErrors((current) => ({ ...current, [key]: message }));
            if (!taskStatusVisible(clusterSlug, taskId)) {
              sinkToast(clusterSlug, { message: `${file.name}: ${message}` });
            }
            return;
          }
          recoveryRequestIds.get(taskId)?.delete(requestId);
          dropQueuedUpload(file);
          if (runtimeJobId) {
            runtimeJobIds.get(taskId)?.delete(runtimeJobId);
          }
          sinks.get(clusterSlug)?.refreshAfterFile();
        })
        .catch((error) => {
          if (abortController.signal.aborted) return;
          const message =
            error instanceof Error
              ? error.message
              : "Upload status could not be recovered";
          setTaskStatuses((current) => ({ ...current, [key]: "error" }));
          setTaskErrors((current) => ({ ...current, [key]: message }));
          if (!taskStatusVisible(clusterSlug, taskId)) {
            sinkToast(clusterSlug, { message: `${file.name}: ${message}` });
          }
        })
        .finally(() => {
          deferredRecoveryIds.delete(requestId);
          finishTaskWhenSettled();
        });
    };

    try {
      const resumingRecoveryId = resumingRecoveryIds[key];
      const res = resumingRecoveryId
        ? await fetch(
            `/api/gardens/${encodeURIComponent(clusterSlug)}/ingest-recovery/${encodeURIComponent(resumingRecoveryId)}/resume`,
            {
              method: "POST",
              headers: { "X-Breadboard-Ingest-Request-Id": requestId },
              signal: abortController.signal,
            },
          )
        : await fetch("/api/ingest", {
            method: "POST",
            headers: {
              "X-Breadboard-Ingest-Cluster-Slug": clusterSlug,
              "X-Breadboard-Ingest-File-Size": String(file.size),
              "X-Breadboard-Ingest-Request-Id": requestId,
            },
            body: formData,
            signal: abortController.signal,
          });
      const bound = bindRuntimeIngestResponse(requestId, res);
      runtimeJobId = bound?.jobId ?? null;
      if (runtimeJobId) {
        runtimeJobIds.get(taskId)?.add(runtimeJobId);
      }

      if (!res.ok || !res.body) {
        terminalOutcome = true;
        forgetRuntimeIngestRecovery(requestId);
        let message = "Upload failed";
        try {
          const data = await res.json();
          if (typeof data?.error === "string" && data.error.trim()) {
            message = data.error.trim();
          }
        } catch {
          // Fall back to the generic message.
        }
        setTaskStatuses((current) => ({ ...current, [key]: "error" }));
        setTaskErrors((current) => ({ ...current, [key]: message }));
        if (!taskStatusVisible(clusterSlug, taskId)) {
          sinkToast(clusterSlug, { message: `${file.name}: ${message}` });
        }
        continue;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: Record<string, unknown> | null = null;
      let streamError = "";
      let streamRecoveryId: string | null = null;
      let streamErrorCode: string | null = null;
      let streamRetryable: boolean | null = null;
      let canceledEvent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload) as {
              type: "progress" | "usage" | "result" | "error";
              step?: string;
              error?: string;
              canceled?: boolean;
              tokenUsage?: IngestTokenUsage;
              visionError?: string;
              recoveryId?: string;
              [key: string]: unknown;
            };
            if (event.tokenUsage) {
              setTaskTokenUsage((current) => ({
                ...current,
                [key]: event.tokenUsage!,
              }));
            }
            if (
              typeof event.visionError === "string" &&
              event.visionError.trim()
            ) {
              setTaskVisionErrors((current) => ({
                ...current,
                [key]: `${file.name}: ${event.visionError!.trim()}`,
              }));
            }
            if (event.type === "progress" && typeof event.step === "string") {
              setTaskSteps((current) => ({
                ...current,
                [key]: event.step as string,
              }));
            } else if (event.type === "result") {
              result = event;
            } else if (event.type === "error") {
              if (event.canceled) canceledEvent = true;
              streamError =
                typeof event.error === "string" ? event.error : "Upload failed";
              streamRecoveryId = recoveryIdFromEvent(event);
              // Carried so the auto-retry can take a producer that declared
              // itself unretryable at its word instead of reading its prose.
              streamErrorCode =
                typeof event.code === "string" ? event.code : null;
              streamRetryable =
                typeof event.retryable === "boolean" ? event.retryable : null;
            }
          } catch {
            // Ignore malformed stream events.
          }
        }
      }

      if (canceledEvent) {
        terminalOutcome = true;
        forgetRuntimeIngestRecovery(requestId);
        canceledTaskIds.add(taskId);
        settleUploadRetries(ingestDocumentKey({ clusterSlug, filename: file.name }));
        break;
      }

      if (result?.success) {
        terminalOutcome = true;
        // Whatever it cost to get here, the document is in. Its budget starts
        // over if it is ever uploaded again.
        settleUploadRetries(ingestDocumentKey({ clusterSlug, filename: file.name }));
        forgetRuntimeIngestRecovery(requestId);
        if (resumingRecoveryId) sinkRefreshRecoveries(clusterSlug);
        setTaskStatuses((current) => ({ ...current, [key]: "done" }));
        setTaskErrors((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        if (result.duplicate === true) {
          duplicateCount++;
          sinkToast(clusterSlug, {
            message: `${file.name} is already in Documents; duplicate upload skipped`,
          });
        } else {
          successCount++;
          snapshotCount +=
            typeof result.imageCount === "number" ? result.imageCount : 0;
          figureCount +=
            typeof result.figureCount === "number" ? result.figureCount : 0;
          if (result.mapGenerated === true) mapGeneratedCount++;
          if (typeof result.screenshotWarning === "string") {
            screenshotWarnings.push(`${file.name}: ${result.screenshotWarning}`);
          }
          if (typeof result.mapGenerationWarning === "string") {
            mapWarnings.push(`${file.name}: ${result.mapGenerationWarning}`);
          }
          if (typeof result.hiddenContentWarning === "string") {
            hiddenContentWarnings.push(result.hiddenContentWarning);
          }
        }
      } else if (streamError) {
        terminalOutcome = true;
        forgetRuntimeIngestRecovery(requestId);
        const documentKey = ingestDocumentKey({ clusterSlug, filename: file.name });
        const decision = ingestAutoRetryDecision({
          ledger: retryLedgers.get(documentKey) ?? emptyIngestAutoRetryLedger(documentKey),
          failureMessage: streamError,
          code: streamErrorCode,
          retryable: streamRetryable,
          recoveryRetained: Boolean(streamRecoveryId),
          canceled:
            canceledTaskIds.has(taskId) || abortController.signal.aborted,
        });
        if (decision.retry && streamRecoveryId) {
          scheduleUploadRetry({
            taskId,
            clusterSlug,
            key,
            fileName: file.name,
            documentKey,
            recoveryId: streamRecoveryId,
            options,
            decision,
          });
        } else {
          settleUploadRetries(documentKey);
          failFile(key, file.name, streamError, streamRecoveryId);
          if (resumingRecoveryId && !streamRecoveryId) {
            // The resume failed before a new record could replace the old one;
            // the list re-offers the original.
            sinkRefreshRecoveries(clusterSlug);
          }
        }
      } else {
        continueRuntimeRecovery();
      }
    } catch (error) {
      const aborted =
        abortController.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      if (aborted) break;
      continueRuntimeRecovery();
    } finally {
      if (runtimeJobId) {
        runtimeJobIds.get(taskId)?.delete(runtimeJobId);
      }
      if (terminalOutcome) {
        recoveryRequestIds.get(taskId)?.delete(requestId);
        dropQueuedUpload(file);
      }
    }
  }

  const canceled = canceledTaskIds.has(taskId) || abortController.signal.aborted;
  if (canceled) for (const file of files) dropQueuedUpload(file);
  if (!canceled && (successCount > 0 || duplicateCount > 0)) {
    const hasHandwritingFile = files.some((file) =>
      HANDWRITING_FILE_RE.test(file.name),
    );
    const readerLabel = options.parseWithVlm
      ? "VLM parsing"
      : options.handwriting && hasHandwritingFile
        ? "model OCR"
        : "";
    const generationLabel = !options.generateMap
      ? readerLabel || "no map generation"
      : mapWarnings.length > 0 && mapGeneratedCount === 0
        ? "source saving; map generation needs retry"
        : mapWarnings.length > 0
          ? "partial map generation"
          : readerLabel
            ? `${readerLabel} and map generation`
            : "map generation";
    if (successCount > 0) {
      sinkToast(clusterSlug, {
        message: `Added ${successCount} file${successCount > 1 ? "s" : ""} with ${generationLabel}${figureCount > 0 ? `, ${figureCount} figure${figureCount === 1 ? "" : "s"}` : ""}${snapshotCount > 0 ? ` and ${snapshotCount} source snapshot${snapshotCount === 1 ? "" : "s"}` : ""}`,
        type: "success",
        title: "Upload complete",
      });
      for (const warning of hiddenContentWarnings) {
        sinkToast(clusterSlug, {
          message: warning,
          type: "success",
          title: "Document content to review",
        });
      }
      for (const warning of screenshotWarnings) {
        sinkToast(clusterSlug, { message: warning });
      }
      for (const warning of mapWarnings) {
        sinkToast(clusterSlug, { message: warning });
      }
    }
    sinks.get(clusterSlug)?.refreshAfterTask();
  } else if (canceled) {
    if (successCount > 0) {
      sinks.get(clusterSlug)?.refreshAfterTask();
      sinkToast(clusterSlug, {
        message: `Upload canceled after ${successCount} file${successCount > 1 ? "s were" : " was"} added`,
      });
    } else {
      sinkToast(clusterSlug, { message: "Upload canceled" });
    }
  }

  mainLoopFinished = true;
  finishTaskWhenSettled();
}
