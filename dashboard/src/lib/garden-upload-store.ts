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
import { VLM_PARSE_FILE_RE } from "@/app/components/vlm-parse-option";
import { ANYDOC_PARSE_FILE_RE } from "@/lib/anydoc/formats";

const HANDWRITING_FILE_RE = /\.(pdf|jpg|jpeg|png|webp)$/i;

export type GardenUploadFileStatus = "pending" | "uploading" | "done" | "error";

export type GardenUploadTaskState = "uploading" | "done" | "canceled";

export interface GardenUploadTaskOptions {
  label: string;
  handwriting: boolean;
  parseWithVlm: boolean;
  parseWithAnydoc: boolean;
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
  options: GardenUploadTaskOptions;
  state: GardenUploadTaskState;
  startedAt: number;
  completedAt: number | null;
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
  canceledTaskIds.add(taskId);
  abortControllers.get(taskId)?.abort();
}

export function startGardenUploadTask(input: {
  clusterSlug: string;
  files: File[];
  options: GardenUploadTaskOptions;
}): string {
  const taskId = crypto.randomUUID();
  const files = [...input.files];
  const statuses: Record<string, GardenUploadFileStatus> = {};
  for (const file of files) statuses[gardenUploadFileKey(file)] = "pending";
  tasks = [
    ...tasks,
    {
      id: taskId,
      clusterSlug: input.clusterSlug,
      files,
      statuses,
      errors: {},
      steps: {},
      tokenUsage: {},
      visionErrors: {},
      options: input.options,
      state: "uploading",
      startedAt: Date.now(),
      completedAt: null,
    },
  ];
  notify();
  void runUploadTask(taskId, input.clusterSlug, files, input.options);
  return taskId;
}

async function runUploadTask(
  taskId: string,
  clusterSlug: string,
  files: File[],
  options: GardenUploadTaskOptions,
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
    const usesAnydoc =
      !usesVlm && options.parseWithAnydoc && ANYDOC_PARSE_FILE_RE.test(file.name);
    const usesHandwriting =
      !usesVlm &&
      !usesAnydoc &&
      options.handwriting &&
      HANDWRITING_FILE_RE.test(file.name);
    const formData = new FormData();
    formData.append("clusterSlug", clusterSlug);
    formData.append("file", file);
    if (options.label) formData.append("sourceLabel", options.label);
    formData.append("isHandwriting", String(usesHandwriting));
    formData.append("parseWithVlm", String(usesVlm));
    formData.append("parseWithAnydoc", String(usesAnydoc));
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
            setTaskStatuses((current) => ({ ...current, [key]: "error" }));
            setTaskErrors((current) => ({ ...current, [key]: message }));
            if (!taskStatusVisible(clusterSlug, taskId)) {
              sinkToast(clusterSlug, { message: `${file.name}: ${message}` });
            }
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
      const res = await fetch("/api/ingest", {
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
        break;
      }

      if (result?.success) {
        terminalOutcome = true;
        forgetRuntimeIngestRecovery(requestId);
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
        setTaskStatuses((current) => ({ ...current, [key]: "error" }));
        setTaskErrors((current) => ({ ...current, [key]: streamError }));
        if (!taskStatusVisible(clusterSlug, taskId)) {
          sinkToast(clusterSlug, { message: `${file.name}: ${streamError}` });
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
      }
    }
  }

  const canceled = canceledTaskIds.has(taskId) || abortController.signal.aborted;
  if (!canceled && (successCount > 0 || duplicateCount > 0)) {
    const hasHandwritingFile = files.some((file) =>
      HANDWRITING_FILE_RE.test(file.name),
    );
    const readerLabel = options.parseWithVlm
      ? "VLM parsing"
      : options.parseWithAnydoc
        ? "anydoc conversion"
        : options.handwriting && hasHandwritingFile
          ? "handwriting OCR"
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
          type: "error",
          title: "Hidden content detected",
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
