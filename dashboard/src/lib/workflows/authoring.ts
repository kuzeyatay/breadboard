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

export function exposedSubBlocks(config: BlockConfig): SubBlockConfig[] {
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

/**
 * Blocks the palette hides but a described workflow may still use. The Router
 * is hidden as "legacy" upstream, yet it is the only block that lets a model
 * choose between paths, and it runs on Breadboard's engine as it is.
 */
const AUTHORABLE_HIDDEN_TYPES = new Set(["router"]);

const isAuthorable = (config: BlockConfig) => !config.hideFromToolbar || AUTHORABLE_HIDDEN_TYPES.has(config.type);

export function creatableConfig(type: string): BlockConfig | null {
  const config = getBlock(type);
  return config && isAuthorable(config) ? config : null;
}

/** Compact live catalogue the model reads before choosing block inputs. */
export function workflowAuthoringCatalog(): Array<Record<string, unknown>> {
  return getAllBlocks()
    .filter(isAuthorable)
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

/**
 * How the model should write step inputs. Returned with the catalog so the
 * model reads it right before it authors anything.
 */
export const WORKFLOW_AUTHORING_GUIDE = [
  "A Start block is added automatically unless a step is a trigger (generic_webhook, schedule). It is named \"Start\" and receives the text the user types when they run the workflow: reference it as <start.input>.",
  "Reference an earlier block's output as <blockname.field>, where blockname is the block's name lowercased with spaces removed (a block named \"Study guide\" is <studyguide.content>). Agent blocks output content; Function blocks output result; API blocks output data, status and headers; Router and Condition pass their input through.",
  "Agent inputs: messages is an array of {role: \"system\"|\"user\", content} — put the instructions in the system message and the data (e.g. <start.input>) in the user message. Leave model unset to use the default model.",
  "Condition inputs: conditions is an array of JavaScript expressions evaluated in order, e.g. [\"<classify.content>.includes('urgent')\"]; an else branch is added automatically. Connect its branches with edges whose sourceHandle is \"if\", \"else if 1\", \"else if 2\"… or \"else\".",
  "Router inputs: prompt says what to decide, e.g. \"Which team should handle this request? <start.input>\". Connect the Router to every block it may choose; a model reads those blocks' names and instructions and continues down exactly one, so give each target a descriptive name.",
  "Every reference must name a block in this workflow, or the workflow is rejected. Do not name a step Start.",
].join("\n");

const START_NAME = "Start";
const COLUMN_WIDTH = 330;
const ROW_HEIGHT = 190;
/** Reference roots that are not block names. */
const SPECIAL_REFERENCE_ROOTS = new Set(["variable", "loop", "parallel"]);
const REFERENCE = /<([A-Za-z0-9_][A-Za-z0-9_ ]*)\.([A-Za-z0-9_.[\]]+)>/g;

const normalizeBlockName = (name: string) => name.toLowerCase().replace(/\s+/g, "").replace(/\./g, "");

type ConditionRow = { id: string; title: string; value: string };

/**
 * A Condition's branches, in the shape the canvas and the executor read: an
 * `if`, any `else if`s, and always a final `else`. The model may send bare
 * expressions or {value}/{condition} objects, as an array or as JSON text.
 */
function conditionRows(blockId: string, value: unknown): ConditionRow[] {
  let items: unknown = value;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [items];
    }
  }
  const expressions = (Array.isArray(items) ? items : [])
    .map((item) => {
      if (isRecord(item) && String(item.title ?? "").trim().toLowerCase() === "else") return "";
      const expression = isRecord(item) ? item.value ?? item.condition ?? item.expression : item;
      const text = typeof expression === "string" ? expression.trim() : "";
      return text.toLowerCase() === "else" ? "" : text;
    });
  // A trailing empty row, or one titled else, is the else branch added below.
  while (expressions.length && !expressions[expressions.length - 1]) expressions.pop();
  if (!expressions.length) {
    throw new WorkflowAuthoringError("A Condition step needs at least one expression in conditions.");
  }
  return [
    ...expressions.map((expression, index) => ({
      id: index === 0 ? `${blockId}-if` : `${blockId}-else-if-${index}`,
      title: index === 0 ? "if" : "else if",
      value: expression,
    })),
    { id: `${blockId}-else`, title: "else", value: "" },
  ];
}

/** The branch an edge leaving a Condition takes: by name ("if", "else if 2", "else"), by index, or in edge order. */
function conditionHandle(rows: ConditionRow[], requested: string | undefined, order: number, stepKey: string): string {
  const wanted = (requested ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  let row: ConditionRow | undefined;
  if (!wanted || wanted === "source") row = rows[order];
  else if (wanted === "if") row = rows[0];
  else if (wanted === "else") row = rows[rows.length - 1];
  else if (/^\d+$/.test(wanted)) row = rows[Number(wanted)];
  else {
    const elseIf = /^else if ?(\d+)?$/.exec(wanted);
    if (elseIf) row = rows[Number(elseIf[1] ?? 1)]?.title === "else if" ? rows[Number(elseIf[1] ?? 1)] : undefined;
    else row = rows.find((item) => item.id.toLowerCase() === wanted || `condition ${item.id}`.toLowerCase() === wanted);
  }
  if (!row) {
    throw new WorkflowAuthoringError(
      `An edge from Condition "${stepKey}" uses branch "${requested ?? ""}", which it does not have. Its branches are: ${rows
        .map((item, index) => (item.title === "else if" ? `else if ${index}` : item.title))
        .join(", ")}.`,
    );
  }
  return `condition-${row.id}`;
}

function collectReferences(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(REFERENCE)) into.push(match[1]!);
  } else if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, into);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectReferences(item, into);
  }
}

/** Columns by longest path from a root, rows by order within a column, so branches do not stack on one line. */
function layeredPositions(
  ids: string[],
  edges: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
  const depth = new Map(ids.map((id) => [id, 0]));
  // The graph is acyclic (checked before layout), so |ids| relaxation passes settle every depth.
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      const next = (depth.get(edge.source) ?? 0) + 1;
      if (next > (depth.get(edge.target) ?? 0)) {
        depth.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const column = depth.get(id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(id, { x: 80 + column * COLUMN_WIDTH, y: 100 + row * ROW_HEIGHT });
  }
  return positions;
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
  const conditions = new Map<string, ConditionRow[]>();
  const references: Array<{ step: string; roots: string[] }> = [];
  const warnings: string[] = [];
  let hasTrigger = false;

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
    if (config.category === "triggers") hasTrigger = true;

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

    const id = randomUUID();
    const subBlocks: AuthoredWorkflowState["blocks"][string]["subBlocks"] = {};
    for (const subBlock of available.values()) {
      let value = Object.hasOwn(supplied, subBlock.id)
        ? cloneJson(supplied[subBlock.id], `${step.key}.${subBlock.id}`)
        : initialValue(subBlock);
      if (config.type === "condition" && subBlock.id === "conditions") {
        const rows = conditionRows(id, value);
        conditions.set(id, rows);
        value = JSON.stringify(rows);
      }
      if (value !== undefined) {
        subBlocks[subBlock.id] = { id: subBlock.id, type: subBlock.type, value };
      } else if (subBlock.required === true) {
        warnings.push(`Step "${name}" still needs ${subBlock.title ?? subBlock.id}.`);
      }
    }
    if (config.type === "condition" && !conditions.has(id)) {
      throw new WorkflowAuthoringError(`Condition step "${step.key}" needs conditions.`);
    }
    const roots: string[] = [];
    collectReferences(supplied, roots);
    references.push({ step: step.key, roots });

    ids.set(step.key, id);
    blocks[id] = {
      id,
      type: config.type,
      name,
      position: { x: 0, y: 0 },
      subBlocks,
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      ...(config.category === "triggers" ? { triggerMode: true } : {}),
    };
  });

  // Without a trigger, nothing would carry the user's run input into the graph.
  const startId = hasTrigger || definition.steps.length === 0 ? null : randomUUID();
  if (startId && usedNames.has(START_NAME.toLowerCase())) {
    throw new WorkflowAuthoringError(`"${START_NAME}" is the name of the automatic Start block; name the step something else.`);
  }

  const knownRoots = new Set([...usedNames].map(normalizeBlockName));
  if (startId) knownRoots.add(normalizeBlockName(START_NAME));
  for (const { step, roots } of references) {
    for (const root of roots) {
      const normalized = normalizeBlockName(root);
      if (knownRoots.has(normalized) || SPECIAL_REFERENCE_ROOTS.has(normalized)) continue;
      throw new WorkflowAuthoringError(
        `Step "${step}" refers to <${root}.…>, but no block is named that. Available references start with: ${[...knownRoots]
          .map((item) => `<${item}.`)
          .join(", ")}.`,
      );
    }
  }

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
  const conditionEdgeCount = new Map<string, number>();
  const edges: AuthoredWorkflowState["edges"] = requestedEdges.map((edge, index) => {
    if (!isRecord(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") {
      throw new WorkflowAuthoringError(`Edge ${index + 1} needs from and to step keys.`);
    }
    const source = ids.get(edge.from);
    const target = ids.get(edge.to);
    if (!source || !target) {
      throw new WorkflowAuthoringError(`Edge ${index + 1} refers to a step that does not exist.`);
    }
    const requestedHandle = typeof edge.sourceHandle === "string" ? edge.sourceHandle : undefined;
    let sourceHandle: string;
    const rows = conditions.get(source);
    if (rows) {
      // The executor routes a Condition only through condition-<row id> handles.
      const order = conditionEdgeCount.get(source) ?? 0;
      conditionEdgeCount.set(source, order + 1);
      sourceHandle = conditionHandle(rows, requestedHandle, order, edge.from);
    } else {
      sourceHandle = requestedHandle && SAFE_HANDLE.test(requestedHandle) ? requestedHandle : "source";
    }
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

  if (startId) {
    blocks[startId] = {
      id: startId,
      type: "starter",
      name: START_NAME,
      position: { x: 0, y: 0 },
      subBlocks: {
        startWorkflow: { id: "startWorkflow", type: "dropdown", value: "manual" },
        inputFormat: { id: "inputFormat", type: "input-format", value: [] },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: true,
    };
    const targets = new Set(edges.map((edge) => edge.target));
    for (const id of ids.values()) {
      if (targets.has(id)) continue;
      edges.unshift({
        id: randomUUID(),
        source: startId,
        target: id,
        sourceHandle: "source",
        targetHandle: "target",
        type: "workflowEdge",
      });
    }
  }

  const order = [...(startId ? [startId] : []), ...ids.values()];
  const positions = layeredPositions(order, edges);
  for (const id of order) blocks[id]!.position = positions.get(id)!;

  return { state: { blocks, edges, loops: {}, parallels: {} }, warnings };
}

type StoredBlock = { id?: unknown; type?: unknown; name?: unknown; subBlocks?: Record<string, { value?: unknown }> };
type StoredEdge = { source?: unknown; target?: unknown; sourceHandle?: unknown };

/**
 * A saved workflow, read back as the definition the model writes: the same
 * steps, inputs and edges buildAuthoredWorkflowState takes. Editing is "read
 * this, change it, send it back", so an untouched step survives the round trip.
 * The Start block is left out because compiling adds it again.
 */
export function workflowStateToDefinition(state: unknown): AuthoredWorkflowDefinition & { unsupported: string[] } {
  const record = isRecord(state) ? state : {};
  const blocks = (isRecord(record.blocks) ? Object.values(record.blocks) : []) as StoredBlock[];
  const storedEdges = (Array.isArray(record.edges) ? record.edges : []) as StoredEdge[];
  const keys = new Map<string, string>();
  const usedKeys = new Set<string>();
  const conditionTitles = new Map<string, Map<string, string>>();
  const steps: AuthoredWorkflowStep[] = [];
  const unsupported: string[] = [];

  for (const block of blocks) {
    if (typeof block.id !== "string" || typeof block.type !== "string") continue;
    if (block.type === "starter") continue;
    const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : block.type;
    const config = creatableConfig(block.type);
    if (!config) {
      unsupported.push(`${name} (${block.type})`);
      continue;
    }
    let key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || config.type;
    if (!/^[a-z]/.test(key)) key = `step_${key}`;
    for (let suffix = 2; usedKeys.has(key); suffix++) key = `${key.replace(/_\d+$/, "")}_${suffix}`;
    usedKeys.add(key);
    keys.set(block.id, key);

    const inputs: Record<string, unknown> = {};
    for (const subBlock of exposedSubBlocks(config)) {
      const value = block.subBlocks?.[subBlock.id]?.value;
      if (value === undefined || value === null || value === "") continue;
      if (config.type === "condition" && subBlock.id === "conditions") {
        let rows: unknown = value;
        if (typeof rows === "string") {
          try {
            rows = JSON.parse(rows);
          } catch {
            rows = [];
          }
        }
        const list = (Array.isArray(rows) ? rows : []).filter(isRecord);
        const titles = new Map<string, string>();
        list.forEach((row, index) => {
          if (typeof row.id === "string") {
            titles.set(row.id, index === 0 ? "if" : index === list.length - 1 ? "else" : `else if ${index}`);
          }
        });
        conditionTitles.set(block.id, titles);
        inputs.conditions = list.slice(0, -1).map((row) => (typeof row.value === "string" ? row.value : ""));
        continue;
      }
      inputs[subBlock.id] = value;
    }
    steps.push({ key, type: config.type, name, inputs });
  }

  const edges: AuthoredWorkflowEdge[] = [];
  for (const edge of storedEdges) {
    if (typeof edge.source !== "string" || typeof edge.target !== "string") continue;
    const from = keys.get(edge.source);
    const to = keys.get(edge.target);
    if (!from || !to) continue;
    const handle = typeof edge.sourceHandle === "string" ? edge.sourceHandle : "source";
    const titles = conditionTitles.get(edge.source);
    if (titles && handle.startsWith("condition-")) {
      edges.push({ from, to, sourceHandle: titles.get(handle.slice("condition-".length)) ?? "if" });
    } else {
      edges.push(handle === "source" || handle.startsWith("router-") ? { from, to } : { from, to, sourceHandle: handle });
    }
  }
  return { steps, edges, unsupported };
}

/**
 * Changing one of the user's saved workflows is allowed when the turn asks for
 * a change. The open-workflow context says which workflow; this only checks
 * that the user asked to change something rather than asking about it.
 */
export function explicitlyRequestsWorkflowEdit(instruction: string, previousAssistantMessage = ""): boolean {
  const text = instruction.trim();
  if (!text) return false;
  if (/\b(?:do not|don't|never|without)\b[^.\n]{0,60}\b(?:change|edit|modify|update|touch)\b/i.test(text)) return false;
  if (/^\s*(?:how|what|why|which|where|when|can you explain|explain)\b[^.!\n]*\?\s*$/i.test(text)) return false;
  const action =
    /\b(?:add|append|insert|remove|delete|drop|change|edit|modify|update|replace|rename|rewrite|fix|improve|make|set|connect|disconnect|wire|move|swap|split|merge|use|switch|turn|put|include|branch|route)\b/i;
  if (action.test(text)) return true;
  return explicitlyRequestsWorkflowCreation(text, previousAssistantMessage) && AFFIRMATIVE.test(text);
}

const AFFIRMATIVE =
  /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|please|go ahead|do it|do that|build it|create it|make it|save it|set it up|sounds good|let'?s do it|perfect)\b/i;

/**
 * Durable creation is allowed only when this turn explicitly asks for it. A
 * short yes counts when it answers the assistant's own offer of a workflow
 * ("Want me to build that as a workflow?" → "yes please").
 */
export function explicitlyRequestsWorkflowCreation(instruction: string, previousAssistantMessage = ""): boolean {
  if (requestsWorkflowCreation(instruction)) return true;
  const text = instruction.trim();
  return (
    text.length <= 80 &&
    AFFIRMATIVE.test(text) &&
    !/\b(?:no|not|don'?t|never|later|wait)\b/i.test(text) &&
    /\b(?:workflow|automation|automate)\b/i.test(previousAssistantMessage.slice(-1_500))
  );
}

function requestsWorkflowCreation(instruction: string): boolean {
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
