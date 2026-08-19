"use client";

// Debounced (1s) PUT of the workflow's serialized state, driven by the graph
// and subblock stores' revision counters. Both stores bump their own counter
// on every mutation so a keystroke in the config panel schedules a save the
// same as dragging a block.

import { useEffect, useRef, useState } from "react";
import { useSubBlockStore } from "../stores/subblock-store";
import { useWorkflowStore } from "../stores/workflow-store";

const SAVE_DEBOUNCE_MS = 1000;

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function useWorkflowPersistence(workflowId: string | null) {
  const hydrated = useWorkflowStore((state) => state.hydrated);
  const graphRevision = useWorkflowStore((state) => state.revision);
  const subRevision = useSubBlockStore((state) => state.revision);
  const name = useWorkflowStore((state) => state.name);
  const description = useWorkflowStore((state) => state.description);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<number | null>(null);
  const skipFirstRef = useRef(true);

  useEffect(() => {
    // A fresh hydrate (opening a workflow, or switching to another one) must
    // not immediately re-save the state it just loaded.
    skipFirstRef.current = true;
    setStatus("idle");
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId || !hydrated) return;
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    setStatus("pending");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      setStatus("saving");
      try {
        const state = useWorkflowStore.getState().serialize();
        const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, description, state }),
        });
        if (!response.ok) throw new Error(`Save failed (${response.status})`);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, hydrated, graphRevision, subRevision, name, description]);

  return status;
}
