"use client";

import { useEffect, useRef, useState } from "react";
import { hasLiveGardenUploadRequest } from "@/lib/garden-upload-store";
import {
  cancelPendingRuntimeIngest,
  recoverRuntimeIngest,
  runtimeIngestRecoveries,
  runtimeIngestRecoveryRecord,
  type RuntimeIngestRecoveryRecord,
  type RuntimeIngestStreamEvent,
} from "@/lib/runtime-v2/ingest-recovery-client";

export interface RestoredGardenUpload {
  requestId: string;
  jobId: string | null;
  filename: string;
  step: string;
  error: string | null;
}

interface RecoveryCallbacks {
  onEvent: (record: RuntimeIngestRecoveryRecord, event: RuntimeIngestStreamEvent) => void;
  onRestored?: () => void;
  onSettled: () => void;
}

/** Reconnect to the existing job without submitting the document a second time. */
export function useGardenRestoredUploads(clusterSlug: string, callbacks: RecoveryCallbacks) {
  const callbacksRef = useRef(callbacks);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);
  const [snapshot, setSnapshot] = useState<{ garden: string; uploads: RestoredGardenUpload[] }>({
    garden: clusterSlug, uploads: [],
  });

  useEffect(() => {
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const update = (requestId: string, changes: Partial<RestoredGardenUpload> | null) => {
      if (controller.signal.aborted) return;
      setSnapshot(current => current.garden !== clusterSlug ? current : {
        ...current,
        uploads: changes === null
          ? current.uploads.filter(upload => upload.requestId !== requestId)
          : current.uploads.map(upload => upload.requestId === requestId ? { ...upload, ...changes } : upload),
      });
    };

    const follow = async (stored: RuntimeIngestRecoveryRecord) => {
      try {
        let record = runtimeIngestRecoveryRecord(stored.requestId) ?? stored;
        if (record.cancelRequested) {
          await cancelPendingRuntimeIngest(record.requestId, { signal: controller.signal });
          const current = runtimeIngestRecoveryRecord(record.requestId);
          if (!current) {
            update(record.requestId, null);
            if (!controller.signal.aborted) callbacksRef.current.onSettled();
            return;
          }
          record = current;
        }
        const outcome = await recoverRuntimeIngest(record, event => {
          if (controller.signal.aborted) return;
          update(record.requestId, {
            jobId: runtimeIngestRecoveryRecord(record.requestId)?.jobId ?? record.jobId,
            ...(event.type === "progress" && typeof event.step === "string" ? { step: event.step, error: null } : {}),
          });
          callbacksRef.current.onEvent(record, event);
        }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const terminal = outcome?.terminalEvent;
        if (!terminal) {
          update(record.requestId, { error: "Upload interrupted before it was received. Upload the file again." });
        } else if (terminal.type === "error" && terminal.canceled !== true && !terminal.recoveryId) {
          update(record.requestId, { error: typeof terminal.error === "string" ? terminal.error : "Upload failed" });
        } else {
          update(record.requestId, null);
        }
        callbacksRef.current.onSettled();
      } catch {
        if (controller.signal.aborted) return;
        // An unavailable status endpoint must not make a running file disappear.
        update(stored.requestId, { step: "Reconnecting to upload…" });
        const timer = setTimeout(() => {
          timers.delete(timer);
          void follow(stored);
        }, 3_000);
        timers.add(timer);
      }
    };
    // Browser-only metadata is restored after hydration. Fence the deferred
    // restore as well as stream callbacks when the garden changes or unmounts.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      const records = runtimeIngestRecoveries(clusterSlug).filter(stored =>
        !hasLiveGardenUploadRequest(stored.requestId));
      const uploads = records.filter(record => record.purpose === "documents")
        .map(record => ({ requestId: record.requestId, jobId: record.jobId,
          filename: record.filename, step: record.cancelRequested ? "Cancelling upload…" : "", error: null }));
      setSnapshot({ garden: clusterSlug, uploads });
      if (uploads.length > 0) callbacksRef.current.onRestored?.();
      for (const record of records) void follow(record);
    });
    return () => {
      controller.abort();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [clusterSlug]);

  return snapshot.garden === clusterSlug ? snapshot.uploads : [];
}
