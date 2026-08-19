"use client";

// Execution state, split out from the graph store the way sim keeps its
// execution store separate: run status changes on every block visited during
// a run and must never be part of the persisted/undo-able graph state.

import { create } from "zustand";
import type { WorkflowRunLog } from "../lib/types";

export type BlockRunStatus = "running" | "success" | "error";

interface RunStoreState {
  status: "idle" | "running" | "success" | "error";
  runId: string | null;
  blockStatus: Record<string, BlockRunStatus>;
  logs: WorkflowRunLog[];
  output: unknown;
  error: string | null;
  drawerOpen: boolean;

  start: () => void;
  finish: (result: { status: "success" | "error"; output?: unknown; error?: string; logs?: WorkflowRunLog[]; runId?: string | null }) => void;
  setDrawerOpen: (open: boolean) => void;
  reset: () => void;
}

export const useRunStore = create<RunStoreState>()((set) => ({
  status: "idle",
  runId: null,
  blockStatus: {},
  logs: [],
  output: null,
  error: null,
  drawerOpen: false,

  start: () =>
    set({
      status: "running",
      blockStatus: {},
      logs: [],
      output: null,
      error: null,
      drawerOpen: true,
    }),

  finish: ({ status, output, error, logs, runId }) => {
    const nextBlockStatus: Record<string, BlockRunStatus> = {};
    for (const log of logs ?? []) {
      if (!log.blockId) continue;
      nextBlockStatus[log.blockId] = log.success === false || log.status === "error" ? "error" : "success";
    }
    set({
      status,
      runId: runId ?? null,
      blockStatus: nextBlockStatus,
      logs: logs ?? [],
      output: output ?? null,
      error: error ?? null,
    });
  },

  setDrawerOpen: (open) => set({ drawerOpen: open }),

  reset: () => set({ status: "idle", runId: null, blockStatus: {}, logs: [], output: null, error: null, drawerOpen: false }),
}));
