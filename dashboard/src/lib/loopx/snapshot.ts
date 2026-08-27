// The read path: a small, stable projection of LoopX state that Hermes can read
// synchronously while composing a system prompt.
//
// A LoopX command takes seconds, so the control plane is never consulted while a
// turn is being built. The tick (see tick.ts) runs the CLI after a turn finishes
// and writes this snapshot; the next turn reads it in about a millisecond. The
// snapshot therefore describes the loop as of the end of the previous turn,
// which is exactly the state that turn is supposed to act on. The rendered
// section says so, so the model never treats it as live.

import fs from "node:fs";
import path from "node:path";
import { loopxPaths } from "./state.ts";

export const LOOPX_SNAPSHOT_SCHEMA = 1;

export interface LoopxSnapshot {
  schema: number;
  goalId: string;
  capturedAt: string;
  objective: string;
  /** LoopX's typed decision for the next turn, e.g. `run`, `wait`. */
  decision: string;
  shouldRun: boolean;
  reason: string;
  requiresUserAction: boolean;
  /** What the work-lane contract obliges a delivering turn to do. */
  obligation: string | null;
  laneAction: string | null;
  nextAction: string | null;
  stopCondition: string | null;
  mustInclude: string[];
  userGates: string[];
  agentTodos: string[];
}

/**
 * LoopX plans its own housekeeping as agent todos ("Run `loopx check` against
 * the project registry ..."). Breadboard drives the control plane itself and
 * forbids the assistant from running `loopx`, so surfacing those would hand it a
 * contradiction. They are dropped from the projection rather than the state:
 * LoopX still tracks them, Hermes just is not asked to do them.
 */
function isControlPlaneChore(text: string): boolean {
  return /\bloopx\b/i.test(text);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function todoTexts(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const texts: string[] = [];
  for (const item of value) {
    const text = asString(asRecord(item).text);
    if (text && !isControlPlaneChore(text)) texts.push(text);
    if (texts.length >= limit) break;
  }
  return texts;
}

/** The objective LoopX is holding, read from its own durable goal document. */
export function readObjective(stateFile: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(stateFile, "utf8");
  } catch {
    return "";
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  const line = frontmatter
    ? /^objective:\s*(.*)$/m.exec(frontmatter[1])
    : null;
  const value = line?.[1]?.trim() ?? "";
  return value.replace(/^"(.*)"$/, "$1").trim();
}

/**
 * Builds the snapshot from a `quota should-run` payload. Everything read here
 * is a documented top-level field of that payload, so an upstream addition
 * cannot silently change what Hermes is told.
 */
export function buildSnapshot(input: {
  goalId: string;
  objective: string;
  quota: Record<string, unknown>;
  capturedAt: string;
}): LoopxSnapshot {
  const quota = input.quota;
  const lane = asRecord(quota.work_lane_contract);
  const boundary = asRecord(quota.goal_boundary);
  const profile = asRecord(quota.execution_profile);
  const userTodos = asRecord(quota.user_todo_summary);
  const agentTodos = asRecord(quota.agent_todo_summary);
  return {
    schema: LOOPX_SNAPSHOT_SCHEMA,
    goalId: input.goalId,
    capturedAt: input.capturedAt,
    objective: input.objective,
    decision: asString(quota.decision) ?? "unknown",
    shouldRun: quota.should_run === true,
    reason: asString(quota.reason) ?? "",
    requiresUserAction: quota.requires_user_action === true,
    obligation: asString(lane.obligation),
    laneAction: asString(lane.action),
    nextAction: (() => {
      const recommended = asString(quota.recommended_action);
      return recommended && !isControlPlaneChore(recommended)
        ? recommended
        : null;
    })(),
    stopCondition: asString(boundary.stop_condition),
    mustInclude: Array.isArray(profile.must_include)
      ? profile.must_include.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    userGates: todoTexts(userTodos.gate_open_items, 5),
    agentTodos: todoTexts(agentTodos.first_executable_items, 5),
  };
}

export function writeSnapshot(
  conversationPublicId: string,
  snapshot: LoopxSnapshot,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = loopxPaths(conversationPublicId, env).snapshot;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Reads the cached projection. Never throws: a missing, unreadable, corrupt, or
 * future-schema snapshot simply means this turn gets no loop context, which is
 * the same behavior as a conversation that has no goal.
 */
export function readSnapshot(
  conversationPublicId: string,
  env: NodeJS.ProcessEnv = process.env,
): LoopxSnapshot | null {
  let raw: string;
  try {
    raw = fs.readFileSync(loopxPaths(conversationPublicId, env).snapshot, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = asRecord(parsed);
    if (record.schema !== LOOPX_SNAPSHOT_SCHEMA) return null;
    if (typeof record.goalId !== "string") return null;
    return record as unknown as LoopxSnapshot;
  } catch {
    return null;
  }
}

export function clearSnapshot(
  conversationPublicId: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    fs.rmSync(loopxPaths(conversationPublicId, env).snapshot, { force: true });
  } catch {
    // A snapshot that cannot be removed is stale, not dangerous; the next tick
    // overwrites it.
  }
}
