"use client";

// Local graph store for the native workflow canvas, modeled on sim's workflow
// store (graph structure only — per-keystroke field values live in the
// subblock store so typing never re-renders the canvas).

import { create } from "zustand";
import { resolveBlockConfig } from "../lib/registry";
import {
  emptyWorkflowState,
  type BlockState,
  type WorkflowEdge,
  type WorkflowStateJson,
} from "../lib/types";
import { useSubBlockStore } from "./subblock-store";

const SOURCE_HANDLE_ID = "source";
const TARGET_HANDLE_ID = "target";

export function wouldCreateCycle(
  edges: Array<{ source: string; target: string }>,
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  // Would target reach source?
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `wf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultBlockName(type: string, blocks: Record<string, BlockState>): string {
  const config = resolveBlockConfig(type);
  const base = config?.canvasPresentation?.defaultTitle || config?.name || type;
  const existing = new Set(Object.values(blocks).map((block) => block.name));
  if (!existing.has(base)) return base;
  let counter = 2;
  while (existing.has(`${base} ${counter}`)) counter += 1;
  return `${base} ${counter}`;
}

interface WorkflowStoreState {
  workflowId: string | null;
  name: string;
  description: string;
  blocks: Record<string, BlockState>;
  edges: WorkflowEdge[];
  /** loops/parallels are preserved verbatim so saving never drops them. */
  loops: Record<string, unknown>;
  parallels: Record<string, unknown>;
  selectedBlockId: string | null;
  selectedEdgeId: string | null;
  hydrated: boolean;
  /** Bumps on every persistable mutation; the debounced saver watches it. */
  revision: number;

  hydrate: (input: { id: string; name: string; description: string; state: WorkflowStateJson | null }) => void;
  reset: () => void;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  addBlock: (type: string, position: { x: number; y: number }) => string | null;
  moveBlock: (id: string, position: { x: number; y: number }) => void;
  removeBlock: (id: string) => void;
  duplicateBlock: (id: string) => string | null;
  renameBlock: (id: string, name: string) => void;
  setBlockEnabled: (id: string, enabled: boolean) => void;
  setErrorEnabled: (id: string, enabled: boolean) => void;
  addEdge: (edge: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => void;
  removeEdge: (id: string) => void;
  setSelectedBlock: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  serialize: () => WorkflowStateJson;
}

export const useWorkflowStore = create<WorkflowStoreState>()((set, get) => ({
  workflowId: null,
  name: "",
  description: "",
  blocks: {},
  edges: [],
  loops: {},
  parallels: {},
  selectedBlockId: null,
  selectedEdgeId: null,
  hydrated: false,
  revision: 0,

  hydrate: ({ id, name, description, state }) => {
    const resolved = state ?? emptyWorkflowState();
    const blocks: Record<string, BlockState> = {};
    const values: Record<string, Record<string, unknown>> = {};
    for (const [blockId, block] of Object.entries(resolved.blocks ?? {})) {
      if (!block || typeof block !== "object") continue;
      blocks[blockId] = {
        ...block,
        id: blockId,
        subBlocks: block.subBlocks ?? {},
        outputs: block.outputs ?? {},
        enabled: block.enabled !== false,
      };
      const blockValues: Record<string, unknown> = {};
      for (const [subId, sub] of Object.entries(block.subBlocks ?? {})) {
        blockValues[subId] = sub?.value ?? null;
      }
      values[blockId] = blockValues;
    }
    useSubBlockStore.getState().hydrate(values);
    set({
      workflowId: id,
      name,
      description,
      blocks,
      edges: Array.isArray(resolved.edges) ? resolved.edges.filter((edge) => edge && edge.source && edge.target) : [],
      loops: resolved.loops ?? {},
      parallels: resolved.parallels ?? {},
      selectedBlockId: null,
      selectedEdgeId: null,
      hydrated: true,
      revision: 0,
    });
  },

  reset: () => {
    useSubBlockStore.getState().hydrate({});
    set({
      workflowId: null,
      name: "",
      description: "",
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      selectedBlockId: null,
      selectedEdgeId: null,
      hydrated: false,
      revision: 0,
    });
  },

  setName: (name) => set((state) => ({ name, revision: state.revision + 1 })),
  setDescription: (description) => set((state) => ({ description, revision: state.revision + 1 })),

  addBlock: (type, position) => {
    const config = resolveBlockConfig(type);
    const state = get();
    if (config?.singleInstance || type === "starter") {
      const exists = Object.values(state.blocks).some((block) => block.type === type);
      if (exists) return null;
    }
    const id = makeId();
    const block: BlockState = {
      id,
      type,
      name: defaultBlockName(type, state.blocks),
      position,
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
    };
    const defaults: Record<string, unknown> = {};
    for (const sub of config?.subBlocks ?? []) {
      if (sub.defaultValue !== undefined) defaults[sub.id] = sub.defaultValue;
    }
    useSubBlockStore.getState().hydrateBlock(id, defaults);
    set((current) => ({
      blocks: { ...current.blocks, [id]: block },
      selectedBlockId: id,
      revision: current.revision + 1,
    }));
    return id;
  },

  moveBlock: (id, position) =>
    set((state) => {
      const block = state.blocks[id];
      if (!block) return state;
      return {
        blocks: { ...state.blocks, [id]: { ...block, position } },
        revision: state.revision + 1,
      };
    }),

  removeBlock: (id) =>
    set((state) => {
      if (!state.blocks[id]) return state;
      const blocks = { ...state.blocks };
      delete blocks[id];
      useSubBlockStore.getState().removeBlock(id);
      return {
        blocks,
        edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
        selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
        revision: state.revision + 1,
      };
    }),

  duplicateBlock: (id) => {
    const state = get();
    const source = state.blocks[id];
    if (!source) return null;
    if (source.type === "starter") return null;
    const config = resolveBlockConfig(source.type);
    if (config?.singleInstance) return null;
    const newId = makeId();
    const copy: BlockState = {
      ...source,
      id: newId,
      name: defaultBlockName(source.type, state.blocks),
      position: { x: source.position.x + 40, y: source.position.y + 40 },
    };
    const values = useSubBlockStore.getState().values[id] ?? {};
    useSubBlockStore.getState().hydrateBlock(newId, { ...values });
    set((current) => ({
      blocks: { ...current.blocks, [newId]: copy },
      selectedBlockId: newId,
      revision: current.revision + 1,
    }));
    return newId;
  },

  renameBlock: (id, name) =>
    set((state) => {
      const block = state.blocks[id];
      if (!block || !name.trim()) return state;
      return {
        blocks: { ...state.blocks, [id]: { ...block, name: name.trim() } },
        revision: state.revision + 1,
      };
    }),

  setBlockEnabled: (id, enabled) =>
    set((state) => {
      const block = state.blocks[id];
      if (!block) return state;
      return {
        blocks: { ...state.blocks, [id]: { ...block, enabled } },
        revision: state.revision + 1,
      };
    }),

  setErrorEnabled: (id, enabled) =>
    set((state) => {
      const block = state.blocks[id];
      if (!block) return state;
      const edges = enabled
        ? state.edges
        : state.edges.filter((edge) => !(edge.source === id && edge.sourceHandle === "error"));
      return {
        blocks: { ...state.blocks, [id]: { ...block, errorEnabled: enabled } },
        edges,
        revision: state.revision + 1,
      };
    }),

  addEdge: ({ source, target, sourceHandle, targetHandle }) =>
    set((state) => {
      if (!state.blocks[source] || !state.blocks[target]) return state;
      if (wouldCreateCycle(state.edges, source, target)) return state;
      const resolvedSource = sourceHandle ?? SOURCE_HANDLE_ID;
      const resolvedTarget = targetHandle ?? TARGET_HANDLE_ID;
      const duplicate = state.edges.some(
        (edge) =>
          edge.source === source &&
          edge.target === target &&
          (edge.sourceHandle ?? SOURCE_HANDLE_ID) === resolvedSource &&
          (edge.targetHandle ?? TARGET_HANDLE_ID) === resolvedTarget,
      );
      if (duplicate) return state;
      const blocks =
        resolvedSource === "error" && !state.blocks[source].errorEnabled
          ? { ...state.blocks, [source]: { ...state.blocks[source], errorEnabled: true } }
          : state.blocks;
      return {
        blocks,
        edges: [
          ...state.edges,
          {
            id: makeId(),
            source,
            target,
            sourceHandle: resolvedSource,
            targetHandle: resolvedTarget,
            type: "workflowEdge",
          },
        ],
        revision: state.revision + 1,
      };
    }),

  removeEdge: (id) =>
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== id),
      selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
      revision: state.revision + 1,
    })),

  setSelectedBlock: (id) => set({ selectedBlockId: id, selectedEdgeId: null }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedBlockId: id === null ? get().selectedBlockId : null }),

  serialize: () => {
    const state = get();
    const values = useSubBlockStore.getState().values;
    const blocks: Record<string, BlockState> = {};
    for (const [blockId, block] of Object.entries(state.blocks)) {
      const config = resolveBlockConfig(block.type);
      const blockValues = values[blockId] ?? {};
      const subBlocks: BlockState["subBlocks"] = {};
      const subTypeById = new Map((config?.subBlocks ?? []).map((sub) => [sub.id, sub.type]));
      for (const [subId, value] of Object.entries(blockValues)) {
        if (value === undefined) continue;
        subBlocks[subId] = {
          id: subId,
          type: subTypeById.get(subId) ?? "short-input",
          value: value as BlockState["subBlocks"][string]["value"],
        };
      }
      blocks[blockId] = { ...block, subBlocks };
    }
    return {
      blocks,
      edges: state.edges,
      loops: state.loops,
      parallels: state.parallels,
    };
  },
}));
