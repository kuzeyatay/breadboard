"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { GardenUploadRecovery } from "@/lib/garden-upload-store";

const POLL_MS = 3_000;

/** Retained jobs outlive the tab and its in-memory upload engine. */
export function useGardenUploadRecoveries(clusterSlug: string, onSettled: () => void) {
  const [snapshot, setSnapshot] = useState<{ garden: string; records: GardenUploadRecovery[] }>({
    garden: clusterSlug, records: [],
  });
  const settledRef = useRef(onSettled);
  useEffect(() => { settledRef.current = onSettled; }, [onSettled]);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const setRecoveries = useCallback((update: SetStateAction<GardenUploadRecovery[]>) => {
    setSnapshot(current => {
      const records = current.garden === clusterSlug ? current.records : [];
      return { garden: clusterSlug, records: typeof update === "function" ? update(records) : update };
    });
  }, [clusterSlug]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> | null = null;
    let previous: GardenUploadRecovery[] = [];
    let pollAgain = true;

    const refreshRecords = (): Promise<void> => {
      if (pending) return pending;
      clearTimeout(timer);
      pending = (async () => {
        try {
          const response = await fetch(`/api/gardens/${encodeURIComponent(clusterSlug)}/ingest-recovery`, {
            cache: "no-store", signal: controller.signal,
          });
          if (!response.ok) return;
          const data = await response.json() as { recoveries?: GardenUploadRecovery[] };
          if (controller.signal.aborted || !Array.isArray(data.recoveries)) return;
          const records = data.recoveries;
          const settled = previous.some(record => record.resumedJobId !== null &&
            !records.some(next => next.recoveryId === record.recoveryId && next.resumedJobId !== null));
          previous = records;
          pollAgain = records.some(record => record.resumedJobId !== null);
          setSnapshot({ garden: clusterSlug, records });
          if (settled) settledRef.current();
        } catch {
          // Preserve the last status through a transient outage and retry.
        } finally {
          pending = null;
          if (!controller.signal.aborted && pollAgain) timer = setTimeout(() => void refreshRecords(), POLL_MS);
        }
      })();
      return pending;
    };
    refreshRef.current = refreshRecords;
    const onFocus = () => { void refreshRecords(); };
    window.addEventListener("focus", onFocus);
    void refreshRecords();
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [clusterSlug]);

  return {
    recoveries: snapshot.garden === clusterSlug ? snapshot.records : [],
    setRecoveries,
    refresh,
  };
}
