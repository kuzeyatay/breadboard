"use client";

// Per-keystroke field values, split from the graph store the way sim splits
// its subblock store from the workflow store: typing in the config panel
// updates only this map, so the canvas nodes that do not display the edited
// field never re-render.

import { create } from "zustand";

interface SubBlockStoreState {
  values: Record<string, Record<string, unknown>>;
  /** Bumps on every value edit; the debounced saver watches it. */
  revision: number;
  hydrate: (values: Record<string, Record<string, unknown>>) => void;
  hydrateBlock: (blockId: string, values: Record<string, unknown>) => void;
  setValue: (blockId: string, subBlockId: string, value: unknown) => void;
  removeBlock: (blockId: string) => void;
}

export const useSubBlockStore = create<SubBlockStoreState>()((set) => ({
  values: {},
  revision: 0,

  hydrate: (values) => set({ values, revision: 0 }),

  hydrateBlock: (blockId, values) =>
    set((state) => ({ values: { ...state.values, [blockId]: values } })),

  setValue: (blockId, subBlockId, value) =>
    set((state) => ({
      values: {
        ...state.values,
        [blockId]: { ...(state.values[blockId] ?? {}), [subBlockId]: value },
      },
      revision: state.revision + 1,
    })),

  removeBlock: (blockId) =>
    set((state) => {
      if (!(blockId in state.values)) return state;
      const values = { ...state.values };
      delete values[blockId];
      return { values, revision: state.revision + 1 };
    }),
}));
