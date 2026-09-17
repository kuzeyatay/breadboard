"use client";

import { useEffect, useState } from "react";
import {
  advanceMaxResearchProgress, INITIAL_MAX_RESEARCH_PROGRESS,
  MAX_RESEARCH_PROGRESS_EVENTS, type MaxResearchProgress,
} from "@/lib/max-research/progress";

/** Observe outside the virtualized transcript: a hidden card may be unmounted
 * while its launching row or final continuation still needs its milestones. */
export function useMaxResearchProgress(messages: readonly {
  delegatedAgentRun?: boolean;
  maxResearchRun?: { runId: string };
  externalAgentOutcome?: string;
}[]) {
  const [progress, setProgress] = useState<Record<string, MaxResearchProgress>>({});
  const runsKey = JSON.stringify(messages.flatMap((message) =>
    message.delegatedAgentRun && message.maxResearchRun
      ? [[message.maxResearchRun.runId, message.externalAgentOutcome ?? "running"]] : [],
  ));
  useEffect(() => {
    const controller = new AbortController();
    const cleanups: Array<() => void> = [];
    for (const [runId, outcome] of JSON.parse(runsKey) as Array<[string, string]>) {
      let snapshot = INITIAL_MAX_RESEARCH_PROGRESS;
      let sequence = 0;
      let terminal = false;
      let source: EventSource | undefined;
      let reconnect: ReturnType<typeof setTimeout> | undefined;
      const apply = (event: { type?: string; sequenceNumber?: number; payload?: Record<string, unknown> }) => {
        if (controller.signal.aborted || terminal || !event || typeof event.type !== "string") return;
        if (typeof event.sequenceNumber === "number") {
          if (event.sequenceNumber <= sequence) return;
          sequence = event.sequenceNumber;
        }
        const next = advanceMaxResearchProgress(snapshot, event.type, event.payload ?? {});
        if (next !== snapshot) {
          snapshot = next;
          setProgress((current) => ({ ...current, [runId]: next }));
        }
        if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) {
          terminal = true;
          source?.close();
        }
      };
      const url = `/api/max-research/runs/${encodeURIComponent(runId)}/events`;
      if (outcome !== "running") {
        // Finished workers no longer have a card after the hand-back. Recover
        // their timeline once, without reopening streams or settling them again.
        void fetch(`${url}?since=0`, { headers: { accept: "application/json" }, signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) return;
            const data = await response.json();
            if (Array.isArray(data.events)) data.events.forEach(apply);
          }).catch(() => { /* Saved answers remain usable without event history. */ });
      } else {
        const connect = () => {
          if (controller.signal.aborted || terminal) return;
          source = new EventSource(`${url}?since=${sequence}`);
          for (const type of MAX_RESEARCH_PROGRESS_EVENTS) {
            source.addEventListener(type, (event) => {
              try { apply(JSON.parse((event as MessageEvent<string>).data)); }
              catch { /* Ignore malformed frames and wait for the next milestone. */ }
            });
          }
          source.onerror = () => {
            source?.close();
            if (!controller.signal.aborted && !terminal) reconnect = setTimeout(connect, 3_000);
          };
        };
        connect();
      }
      cleanups.push(() => { source?.close(); if (reconnect) clearTimeout(reconnect); });
    }
    return () => { controller.abort(); cleanups.forEach((cleanup) => cleanup()); };
  }, [runsKey]);
  return progress;
}
