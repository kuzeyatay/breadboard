// Single seam between the canvas editor and the engine's vendored sim block
// registry. If the registry's export surface shifts, only this file changes.

import type { ComponentType } from "react";
import { getAllBlocks, getBlock } from "@/lib/sim/blocks/registry";

/** The simple (object) form of sim's SubBlockConfig.condition. */
export type SubBlockConditionClause = {
  field: string;
  value: string | number | boolean | Array<string | number | boolean>;
  not?: boolean;
  and?: {
    field: string;
    value: string | number | boolean | Array<string | number | boolean> | undefined;
    not?: boolean;
  };
};

export type SubBlockCondition =
  | SubBlockConditionClause
  | ((values?: Record<string, unknown>) => SubBlockConditionClause);

export type SubBlockOption = {
  label: string;
  id: string;
  icon?: ComponentType<{ className?: string }>;
  hidden?: boolean;
  description?: string;
};

/** Structural view of sim's SubBlockConfig — only what the editor consumes. */
export type CanvasSubBlockConfig = {
  id: string;
  title?: string;
  type: string;
  mode?: "basic" | "advanced" | "both" | "trigger" | "trigger-advanced";
  context?: string;
  hidden?: boolean;
  required?: unknown;
  defaultValue?: unknown;
  options?: SubBlockOption[] | (() => SubBlockOption[]);
  min?: number;
  max?: number;
  placeholder?: string;
  password?: boolean;
  readOnly?: boolean;
  description?: string;
  tooltip?: string;
  language?: string;
  condition?: SubBlockCondition;
  rows?: number;
};

/** Structural view of sim's BlockConfig — only what the editor consumes. */
export type CanvasBlockConfig = {
  type: string;
  name: string;
  description: string;
  category: "blocks" | "tools" | "triggers";
  bgColor: string;
  icon: ComponentType<{ className?: string }>;
  subBlocks: CanvasSubBlockConfig[];
  hideFromToolbar?: boolean;
  singleInstance?: boolean;
  triggerAllowed?: boolean;
  canvasPresentation?: {
    typeLabel?: string;
    defaultTitle?: string;
  };
};

/** Container blocks are out of the v1 canvas, so they never reach the palette. */
const HIDDEN_PALETTE_TYPES = new Set(["loop", "parallel"]);

export function listPaletteBlocks(): CanvasBlockConfig[] {
  const blocks = getAllBlocks() as unknown as CanvasBlockConfig[];
  return blocks.filter(
    (block) =>
      Boolean(block?.type) &&
      !block.hideFromToolbar &&
      !HIDDEN_PALETTE_TYPES.has(block.type),
  );
}

export function resolveBlockConfig(type: string): CanvasBlockConfig | null {
  const block = getBlock(type) as unknown as CanvasBlockConfig | undefined;
  return block ?? null;
}

/** Whether the block exposes the standard input port (sim's canvas-rows rule). */
export function showsDefaultHandles(config: CanvasBlockConfig | null, type: string): boolean {
  if (!config) return type !== "starter";
  return config.category !== "triggers" && type !== "starter";
}

/** Whether the card carries the on-error row (sim's canvas-rows rule). */
export function showsErrorRow(config: CanvasBlockConfig | null, type: string): boolean {
  return showsDefaultHandles(config, type) && type !== "response";
}

/** Resolves a subblock's option list, tolerating the function form. */
export function resolveOptions(subBlock: CanvasSubBlockConfig): SubBlockOption[] {
  try {
    const options = typeof subBlock.options === "function" ? subBlock.options() : subBlock.options;
    return Array.isArray(options) ? options.filter((option) => !option.hidden) : [];
  } catch {
    return [];
  }
}

/**
 * Evaluates a subblock's visibility condition against the block's current
 * values. Both the object and the function form are supported; anything that
 * throws falls open (the field stays visible) so a config quirk never hides
 * data the user typed.
 */
export function isConditionMet(
  condition: SubBlockCondition | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  try {
    const clause = typeof condition === "function" ? condition(values) : condition;
    if (!clause || typeof clause !== "object") return true;
    if (!matchClause(clause.field, clause.value, clause.not, values)) return false;
    if (clause.and) {
      return matchClause(clause.and.field, clause.and.value, clause.and.not, values);
    }
    return true;
  } catch {
    return true;
  }
}

function matchClause(
  field: string,
  expected: unknown,
  not: boolean | undefined,
  values: Record<string, unknown>,
): boolean {
  const actual = values[field];
  const matches = Array.isArray(expected)
    ? expected.some((candidate) => looselyEquals(actual, candidate))
    : looselyEquals(actual, expected);
  return not ? !matches : matches;
}

function looselyEquals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  // Persisted values are often strings while conditions compare booleans/numbers.
  if (typeof expected === "boolean") return actual === String(expected) || (expected === false && (actual === undefined || actual === null || actual === ""));
  if (typeof expected === "number") return actual === String(expected);
  return false;
}
