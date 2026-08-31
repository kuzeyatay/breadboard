// Server-owned workflow authoring for Hermes.
//
// The model describes a small graph in terms of registered block types and
// their named fields. It never writes the persisted editor state directly:
// this module resolves the live block registry, supplies its defaults, rejects
// unknown fields and cyclic edges, and emits the same state shape as the canvas.

import { randomUUID } from "node:crypto";

import { getAllBlocks, getBlock } from "../sim/blocks/registry.ts";
import type { BlockConfig, SubBlockConfig } from "../sim/blocks/types.ts";

const MAX_STEPS = 50;
const MAX_EDGES = 100;
const SAFE_KEY = /^[a-z][a-z0-9_-]{0,63}$/i;
const SAFE_HANDLE = /^[a-z0-9_-]{1,100}$/i;

export interface AuthoredWorkflowStep {
  key: string;
  type: string;
  name?: string;
  inputs?: Record<string, unknown>;
}

export interface AuthoredWorkflowEdge {
  from: string;
  to: string;
  sourceHandle?: string;
}

export interface AuthoredWorkflowDefinition {
  steps: AuthoredWorkflowStep[];
  edges?: AuthoredWorkflowEdge[];
}

export interface AuthoredWorkflowState {
  blocks: Record<string, {
    id: string;
    type: string;
    name: string;
    position: { x: number; y: number };
    subBlocks: Record<string, { id: string; type: string; value: unknown }>;
    outputs: Record<string, unknown>;
    enabled: true;
    horizontalHandles: true;
    triggerMode?: boolean;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: "target";
    type: "workflowEdge";
  }>;
  loops: Record<string, never>;
  parallels: Record<string, never>;
}

export class WorkflowAuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowAuthoringError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exposedSubBlocks(config: BlockConfig): SubBlockConfig[] {
  return config.subBlocks.filter(
    (subBlock) =>
      !subBlock.hidden &&
      !subBlock.hideFromCopilot &&
      subBlock.context !== "tool-input",
  );
}

function cloneJson(value: unknown, label: string): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not JSON");
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new WorkflowAuthoringError(`${label} must be a JSON value.`);
  }
}

function initialValue(subBlock: SubBlockConfig): unknown {
  if (subBlock.defaultValue !== undefined) {
    return cloneJson(subBlock.defaultValue, subBlock.id);
  }
  if (typeof subBlock.value === "function") {
    try {
      const value = subBlock.value({});
      if (value !== undefined) return cloneJson(value, subBlock.id);
    } catch {
      // A context-sensitive default is left for the canvas to fill in.
    }
  }
  return undefined;
}

function defaultName(config: BlockConfig, used: Set<string>): string {
  const base = config.canvasPresentation?.defaultTitle || config.name || config.type;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base} ${suffix++}`;
  return candidate;
}

function hasCycle(edges: Array<{ source: string; target: string }>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const next = adjacency.get(edge.source) ?? [];
    next.push(edge.target);
    adjacency.set(edge.source, next);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

function creatableConfig(type: string): BlockConfig | null {
  const config = getBlock(type);
  return config && !config.hideFromToolbar ? config : null;
}

/** Compact live catalogue the model reads before choosing block inputs. */
export function workflowAuthoringCatalog(): Array<Record<string, unknown>> {
  return getAllBlocks()
    .filter((config) => !config.hideFromToolbar)
    .map((config) => ({
      type: config.type,
      name: config.name,
      description: config.description,
      category: config.category,
      singleInstance: config.singleInstance === true,
      inputs: exposedSubBlocks(config).map((subBlock) => {
        let options: Array<{ id: string; label: string }> = [];
        try {
          const resolved =
            typeof subBlock.options === "function" ? subBlock.options() : subBlock.options;
          options = (resolved ?? [])
            .filter((option) => !option.hidden)
            .map((option) => ({ id: option.id, label: option.label }));
        } catch {
          options = [];
        }
        const fallback = initialValue(subBlock);
        return {
          id: subBlock.id,
          title: subBlock.title ?? subBlock.id,
          type: subBlock.type,
          required: subBlock.required === true,
          ...(fallback !== undefined ? { default: fallback } : {}),
          ...(options.length ? { options } : {}),
        };
      }),
    }));
}

/** Compile a bounded Hermes definition into the canvas's persisted graph. */
export function buildAuthoredWorkflowState(definition: AuthoredWorkflowDefinition): {
  state: AuthoredWorkflowState;
  warnings: string[];
} {
  if (!Array.isArray(definition.steps)) {
    throw new WorkflowAuthoringError("steps must be an array.");
  }
  if (definition.steps.length > MAX_STEPS) {
    throw new WorkflowAuthoringError(`A workflow may contain at most ${MAX_STEPS} steps.`);
  }

  const blocks: AuthoredWorkflowState["blocks"] = {};
  const ids = new Map<string, string>();
  const usedNames = new Set<string>();
  const typeCounts = new Map<string, number>();
  const warnings: string[] = [];

  definition.steps.forEach((step, index) => {
    if (!isRecord(step) || typeof step.key !== "string" || !SAFE_KEY.test(step.key)) {
      throw new WorkflowAuthoringError(`Step ${index + 1} needs a unique key using letters, numbers, _ or -.`);
    }
    if (ids.has(step.key)) throw new WorkflowAuthoringError(`Step key "${step.key}" is duplicated.`);
    if (typeof step.type !== "string") {
      throw new WorkflowAuthoringError(`Step "${step.key}" needs a block type.`);
    }
    const config = creatableConfig(step.type);
    if (!config) {
      throw new WorkflowAuthoringError(`Step "${step.key}" uses unavailable block type "${step.type}".`);
    }
    const typeCount = (typeCounts.get(config.type) ?? 0) + 1;
    if (config.singleInstance && typeCount > 1) {
      throw new WorkflowAuthoringError(`Block type "${config.type}" can appear only once.`);
    }
    typeCounts.set(config.type, typeCount);

    const requestedName = typeof step.name === "string" ? step.name.trim().slice(0, 120) : "";
    const name = requestedName || defaultName(config, usedNames);
    if (usedNames.has(name.toLowerCase())) {
      throw new WorkflowAuthoringError(`Block name "${name}" is duplicated.`);
    }
    usedNames.add(name.toLowerCase());

    const supplied = step.inputs === undefined ? {} : step.inputs;
    if (!isRecord(supplied)) {
      throw new WorkflowAuthoringError(`Inputs for step "${step.key}" must be an object.`);
    }
    const available = new Map(exposedSubBlocks(config).map((subBlock) => [subBlock.id, subBlock]));
    for (const field of Object.keys(supplied)) {
      if (!available.has(field)) {
        throw new WorkflowAuthoringError(
          `Step "${step.key}" has unknown input "${field}". Read the workflow_create catalog first.`,
        );
      }
    }

    const subBlocks: AuthoredWorkflowState["blocks"][string]["subBlocks"] = {};
    for (const subBlock of available.values()) {
      const value = Object.hasOwn(supplied, subBlock.id)
        ? cloneJson(supplied[subBlock.id], `${step.key}.${subBlock.id}`)
        : initialValue(subBlock);
      if (value !== undefined) {
        subBlocks[subBlock.id] = { id: subBlock.id, type: subBlock.type, value };
      } else if (subBlock.required === true) {
        warnings.push(`Step "${name}" still needs ${subBlock.title ?? subBlock.id}.`);
      }
    }

    const id = randomUUID();
    ids.set(step.key, id);
    blocks[id] = {
      id,
      type: config.type,
      name,
      position: { x: 80 + index * 330, y: 100 },
      subBlocks,
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      ...(config.category === "triggers" ? { triggerMode: true } : {}),
    };
  });

  const requestedEdges: AuthoredWorkflowEdge[] =
    definition.edges === undefined
      ? definition.steps.slice(0, -1).map((step, index) => ({
          from: step.key,
          to: definition.steps[index + 1]!.key,
        }))
      : definition.edges;
  if (!Array.isArray(requestedEdges)) throw new WorkflowAuthoringError("edges must be an array.");
  if (requestedEdges.length > MAX_EDGES) {
    throw new WorkflowAuthoringError(`A workflow may contain at most ${MAX_EDGES} edges.`);
  }

  const seenEdges = new Set<string>();
  const edges: AuthoredWorkflowState["edges"] = requestedEdges.map((edge, index) => {
    if (!isRecord(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") {
      throw new WorkflowAuthoringError(`Edge ${index + 1} needs from and to step keys.`);
    }
    const source = ids.get(edge.from);
    const target = ids.get(edge.to);
    if (!source || !target) {
      throw new WorkflowAuthoringError(`Edge ${index + 1} refers to a step that does not exist.`);
    }
    const sourceHandle =
      typeof edge.sourceHandle === "string" && SAFE_HANDLE.test(edge.sourceHandle)
        ? edge.sourceHandle
        : "source";
    const signature = `${source}\0${target}\0${sourceHandle}`;
    if (seenEdges.has(signature)) throw new WorkflowAuthoringError(`Edge ${index + 1} is duplicated.`);
    seenEdges.add(signature);
    return {
      id: randomUUID(),
      source,
      target,
      sourceHandle,
      targetHandle: "target",
      type: "workflowEdge",
    };
  });
  if (hasCycle(edges)) throw new WorkflowAuthoringError("Workflow edges must not contain a cycle.");

  return { state: { blocks, edges, loops: {}, parallels: {} }, warnings };
}

/** Durable creation is allowed only when this turn explicitly asks for it. */
export function explicitlyRequestsWorkflowCreation(instruction: string): boolean {
  const text = instruction.trim();
  if (!text || /\b(?:do not|don't|never|without)\b[^.\n]{0,80}\b(?:create|build|make|save|register|automate)\b/i.test(text)) {
    return false;
  }
  if (/\bhow\s+(?:do|can|should)\s+i\b[^?\n]{0,100}\b(?:workflow|automation)\b/i.test(text)) {
    return false;
  }
  if (/\bautomate\b/i.test(text)) return true;
  const action = /\b(?:add|build|create|design|draft|make|register|save|set\s*up)\b/i;
  const object = /\b(?:automation|workflow)\b/i;
  return action.test(text) && object.test(text);
}
