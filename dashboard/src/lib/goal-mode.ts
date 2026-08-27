// Goal is Breadboard's conversation-scoped integration of the cloned
// secemp9/goal project. The upstream project owns the state shape and the
// continuation contract; Breadboard owns where that state lives so separate
// conversations (and users) can never overwrite one another.
//
// A goal is started by the `goal` skill, not by a product switch: the model
// calls create_goal in the turn the skill is selected for, and every later turn
// in the same conversation reads the state back out of this module. The
// lifecycle after creation belongs to the person, through the goal card above
// the composer — pause, resume and abandon are theirs, and completion is the
// one transition the model may make, and only against evidence.

import crypto from "node:crypto";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { dashboardDataDir, repositoryRoot } from "./runtime-paths.ts";

export const GOAL_MODE_CONNECTION = "goal";
/** The first-party skill directory name, which is also its slash command. */
export const GOAL_MODE_SKILL = "goal";
const MAX_OBJECTIVE_CHARS = 4_000;
const VALID_STATUSES = new Set([
  "active",
  "paused",
  "budget_limited",
  "complete",
]);

export type GoalModeStatus = "active" | "paused" | "budget_limited" | "complete";

/** The upstream `goal_state.json` schema, kept byte-for-byte compatible. */
export interface GoalModeState {
  goal_id: string;
  objective: string;
  status: GoalModeStatus;
  turn_budget: number | null;
  turns_used: number;
  tokens_used: number;
  time_used_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface GoalModePaths {
  home: string;
  directory: string;
  stateFile: string;
}

export interface GoalModeToolResult {
  text: string;
  isError?: boolean;
}

function goalModeHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_GOAL_HOME?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(dashboardDataDir(), "goal-mode");
}

/**
 * The raw conversation id never becomes a path segment. Besides preventing
 * traversal, hashing avoids exposing a conversation identifier in a data-dir
 * listing or a desktop backup.
 */
function conversationKey(conversationPublicId: string): string {
  return crypto.createHash("sha256").update(conversationPublicId).digest("hex");
}

export function goalModePaths(
  conversationPublicId: string,
  env: NodeJS.ProcessEnv = process.env,
): GoalModePaths {
  if (!conversationPublicId.trim()) {
    throw new Error("Goal Mode needs a conversation identifier.");
  }
  const home = goalModeHome(env);
  const directory = path.join(home, "conversations", conversationKey(conversationPublicId));
  return { home, directory, stateFile: path.join(directory, "goal_state.json") };
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function parseState(value: unknown): GoalModeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  const turnBudget = state.turn_budget;
  const turnsUsed = asNonNegativeInteger(state.turns_used);
  const tokensUsed = asNonNegativeInteger(state.tokens_used);
  const timeUsed = asNonNegativeInteger(state.time_used_seconds);
  if (
    typeof state.goal_id !== "string" ||
    !state.goal_id ||
    typeof state.objective !== "string" ||
    !state.objective ||
    state.objective.length > MAX_OBJECTIVE_CHARS ||
    typeof state.status !== "string" ||
    !VALID_STATUSES.has(state.status) ||
    (turnBudget !== null &&
      (typeof turnBudget !== "number" || !Number.isInteger(turnBudget) || turnBudget < 0)) ||
    turnsUsed === null ||
    tokensUsed === null ||
    timeUsed === null ||
    typeof state.created_at !== "string" ||
    typeof state.updated_at !== "string"
  ) {
    return null;
  }
  return {
    goal_id: state.goal_id,
    objective: state.objective,
    status: state.status as GoalModeStatus,
    turn_budget: turnBudget as number | null,
    turns_used: turnsUsed,
    tokens_used: tokensUsed,
    time_used_seconds: timeUsed,
    created_at: state.created_at,
    updated_at: state.updated_at,
  };
}

function readRaw(paths: GoalModePaths): GoalModeState | null {
  try {
    return parseState(JSON.parse(fs.readFileSync(paths.stateFile, "utf8")));
  } catch {
    return null;
  }
}

function writeRaw(paths: GoalModePaths, state: GoalModeState): void {
  fs.mkdirSync(paths.directory, { recursive: true });
  const temporary = `${paths.stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, paths.stateFile);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function nowIso(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function statusAfterBudgetLimit(
  status: GoalModeStatus,
  turnsUsed: number,
  turnBudget: number | null,
): GoalModeStatus {
  return status === "active" && turnBudget !== null && turnsUsed >= turnBudget
    ? "budget_limited"
    : status;
}

function cleanObjective(value: string): string {
  const objective = value.trim();
  if (!objective) throw new Error("A Goal Mode objective must not be empty.");
  if (objective.length > MAX_OBJECTIVE_CHARS) {
    throw new Error(`A Goal Mode objective must be at most ${MAX_OBJECTIVE_CHARS} characters.`);
  }
  return objective;
}

export function readGoalModeState(
  conversationPublicId: string,
  env: NodeJS.ProcessEnv = process.env,
): GoalModeState | null {
  return readRaw(goalModePaths(conversationPublicId, env));
}

/** Start a goal only when this conversation has no prior Goal state. */
export function activateGoalMode(input: {
  conversationPublicId: string;
  objective: string;
  turnBudget?: number | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeState {
  const paths = goalModePaths(input.conversationPublicId, input.env);
  const existing = readRaw(paths);
  if (existing) return existing;
  const turnBudget = input.turnBudget ?? null;
  if (turnBudget !== null && (!Number.isInteger(turnBudget) || turnBudget < 0)) {
    throw new Error("Goal Mode turn budget must be a non-negative integer.");
  }
  const now = nowIso(input.now);
  const state: GoalModeState = {
    goal_id: crypto.randomUUID(),
    objective: cleanObjective(input.objective),
    status: statusAfterBudgetLimit("active", 0, turnBudget),
    turn_budget: turnBudget,
    turns_used: 0,
    tokens_used: 0,
    time_used_seconds: 0,
    created_at: now,
    updated_at: now,
  };
  writeRaw(paths, state);
  return state;
}

/**
 * Move a goal between the two states the person controls. The model cannot
 * reach this: pausing and resuming are decisions about whether work should
 * continue at all, which is exactly the decision a goal is designed to stop the
 * model from making for itself.
 */
export function setGoalModeStatus(input: {
  conversationPublicId: string;
  status: Extract<GoalModeStatus, "active" | "paused">;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeState | null {
  const paths = goalModePaths(input.conversationPublicId, input.env);
  const state = readRaw(paths);
  if (!state) return null;
  // A finished goal is history. Resuming one would silently reopen work the
  // completion audit already signed off on; starting again is a new goal in a
  // new conversation, which is what the contract already says.
  if (state.status === "complete") return state;
  const next: GoalModeState = {
    ...state,
    status:
      input.status === "active"
        // Resuming a goal that ran out of budget without also lifting the
        // budget would put it straight back into budget_limited, so the
        // shared helper decides which of the two "running" states applies.
        ? statusAfterBudgetLimit("active", state.turns_used, state.turn_budget)
        : "paused",
    updated_at: nowIso(input.now),
  };
  writeRaw(paths, next);
  return next;
}

/**
 * Raise (or lift) the turn budget of a goal that has run into it, so a person
 * who still wants the work done can say so without restating the objective.
 */
export function extendGoalModeBudget(input: {
  conversationPublicId: string;
  turnBudget: number | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeState | null {
  const paths = goalModePaths(input.conversationPublicId, input.env);
  const state = readRaw(paths);
  if (!state || state.status === "complete") return state;
  const turnBudget = input.turnBudget;
  if (turnBudget !== null && (!Number.isInteger(turnBudget) || turnBudget <= 0)) {
    throw new Error("Goal turn budget must be a positive integer or unlimited.");
  }
  const next: GoalModeState = {
    ...state,
    turn_budget: turnBudget,
    status:
      state.status === "paused"
        ? "paused"
        : statusAfterBudgetLimit("active", state.turns_used, turnBudget),
    updated_at: nowIso(input.now),
  };
  writeRaw(paths, next);
  return next;
}

/**
 * Abandon the goal. The state file is removed rather than marked, because a
 * conversation with no goal and a conversation whose goal was dropped behave
 * identically from here on — and leaving a tombstone behind would keep
 * injecting an objective the person just said they were done with.
 */
export function clearGoalModeState(
  conversationPublicId: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const paths = goalModePaths(conversationPublicId, env);
  fs.rmSync(paths.directory, { recursive: true, force: true });
}

/** Account only the goal that was active when this specific runtime run began. */
export function accountGoalModeTurn(input: {
  conversationPublicId: string;
  goalId: string;
  startedAt: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeState | null {
  const paths = goalModePaths(input.conversationPublicId, input.env);
  const state = readRaw(paths);
  if (!state || state.goal_id !== input.goalId || state.status !== "active") return state;
  const started = Date.parse(input.startedAt);
  const finished = (input.now ?? new Date()).getTime();
  const elapsed = Number.isFinite(started)
    ? Math.max(0, Math.floor((finished - started) / 1_000))
    : 0;
  const next: GoalModeState = {
    ...state,
    turns_used: state.turns_used + 1,
    time_used_seconds: state.time_used_seconds + elapsed,
    status: statusAfterBudgetLimit(
      "active",
      state.turns_used + 1,
      state.turn_budget,
    ),
    updated_at: nowIso(input.now),
  };
  writeRaw(paths, next);
  return next;
}

function remainingTurns(state: GoalModeState): number | null {
  return state.turn_budget === null
    ? null
    : Math.max(0, state.turn_budget - state.turns_used);
}

export function goalModeToolResponse(
  state: GoalModeState | null,
  includeCompletionReport = false,
): GoalModeToolResult {
  if (!state) {
    return { text: JSON.stringify({ goal: null, remainingTurns: null }, null, 2) };
  }
  const response: Record<string, unknown> = {
    goal: {
      objective: state.objective,
      status: state.status,
      turnBudget: state.turn_budget,
      turnsUsed: state.turns_used,
      tokensUsed: state.tokens_used,
      timeUsedSeconds: state.time_used_seconds,
      createdAt: state.created_at,
      updatedAt: state.updated_at,
    },
    remainingTurns: remainingTurns(state),
  };
  if (includeCompletionReport && state.status === "complete") {
    const report = [
      state.turn_budget === null ? "" : `turns used: ${state.turns_used} of ${state.turn_budget}`,
      state.time_used_seconds > 0 ? `time used: ${state.time_used_seconds} seconds` : "",
    ].filter(Boolean).join("; ");
    if (report) {
      response.completionBudgetReport = `Goal achieved. Report final budget usage to the user: ${report}.`;
    }
  }
  return { text: JSON.stringify(response, null, 2) };
}

/** The three upstream MCP tools, exposed through Breadboard's native mcp_call. */
export function callGoalModeTool(input: {
  conversationPublicId: string;
  tool: string;
  args: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeToolResult {
  const env = input.env;
  const existing = readGoalModeState(input.conversationPublicId, env);
  if (input.tool === "get_goal") return goalModeToolResponse(existing);
  if (input.tool === "create_goal") {
    if (existing) {
      return {
        isError: true,
        text: "cannot create a new goal because this thread already has a goal; use update_goal only when the existing goal is complete",
      };
    }
    if (typeof input.args.objective !== "string") {
      return { isError: true, text: "objective is required and must be a non-empty string" };
    }
    const turnBudget = input.args.turn_budget;
    if (
      turnBudget !== undefined &&
      (!Number.isInteger(turnBudget) || typeof turnBudget !== "number" || turnBudget <= 0)
    ) {
      return { isError: true, text: "turn_budget must be a positive integer when provided" };
    }
    try {
      return goalModeToolResponse(activateGoalMode({
        conversationPublicId: input.conversationPublicId,
        objective: input.args.objective,
        turnBudget: typeof turnBudget === "number" ? turnBudget : null,
        env,
        now: input.now,
      }));
    } catch (error) {
      return { isError: true, text: error instanceof Error ? error.message : "invalid goal" };
    }
  }
  if (input.tool === "update_goal") {
    if (input.args.status !== "complete") {
      return {
        isError: true,
        text: "update_goal can only mark the existing goal complete; pause, resume, and budget-limited status changes are controlled by the user or system",
      };
    }
    if (!existing) return { isError: true, text: "cannot update goal: no goal exists" };
    const next: GoalModeState = {
      ...existing,
      status: "complete",
      updated_at: nowIso(input.now),
    };
    writeRaw(goalModePaths(input.conversationPublicId, env), next);
    return goalModeToolResponse(next, true);
  }
  return { isError: true, text: `Unknown goal tool: ${input.tool}` };
}

function upstreamGoalRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.BREADBOARD_GOAL_ROOT?.trim()
    ? path.resolve(env.BREADBOARD_GOAL_ROOT)
    : path.join(repositoryRoot(), "goal");
}

function upstreamTemplate(
  name: "continuation.md" | "budget_limit.md",
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = upstreamGoalRoot(env);
  const candidates = [
    path.join(root, "src", "templates", name),
    path.join(root, "templates", name),
  ];
  for (const file of candidates) {
    try {
      const template = fs.readFileSync(file, "utf8").trim();
      if (template) return template;
    } catch {
      // A source checkout and packaged build deliberately use different layouts.
    }
  }
  return name === "budget_limit.md"
    ? "The active thread goal has reached its turn budget. Do not start new substantive work; summarize progress, remaining work, and the next step."
    : "Continue working toward the active thread goal. Keep the original objective intact, verify completion against current evidence, and do not claim completion without proof.";
}

/**
 * What the goal card above the composer reads. It is the durable state minus
 * nothing — the card shows the objective, the counters and the elapsed clock —
 * with the one derived field the client should not compute for itself.
 */
export function presentGoalModeState(state: GoalModeState): {
  goalId: string;
  objective: string;
  status: GoalModeStatus;
  turnBudget: number | null;
  turnsUsed: number;
  remainingTurns: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
} {
  return {
    goalId: state.goal_id,
    objective: state.objective,
    status: state.status,
    turnBudget: state.turn_budget,
    turnsUsed: state.turns_used,
    remainingTurns: remainingTurns(state),
    tokensUsed: state.tokens_used,
    timeUsedSeconds: state.time_used_seconds,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
  };
}

/**
 * Render the upstream Goal continuation contract with this conversation's
 * state.
 *
 * Two shapes, because a goal has two moments. On the turn the `goal` skill is
 * selected there is no state yet — the model is told to create one, and the
 * skill's own guidance (injected alongside this) says how. On every later turn
 * the state exists, the skill is long gone from the turn, and this section is
 * the only thing carrying the objective forward.
 */
export function goalModeSection(
  state: GoalModeState | null,
  env: NodeJS.ProcessEnv = process.env,
  options: { skillSelected?: boolean } = {},
): string {
  if (!state) {
    if (!options.skillSelected) return "";
    return [
      "# goal_mode",
      "The Goal skill is selected for this turn and this conversation has no goal yet.",
      `Before working the request, call mcp_call with connection=${JSON.stringify(GOAL_MODE_CONNECTION)}, tool=create_goal and args={ objective: "<the finished state, in the user's terms>" }, adding turn_budget only when the user named a bound.`,
      "The goal then governs every later turn of this conversation on its own; you do not re-select the skill.",
      "Goal grants no filesystem, network, or other capability; the normal capability decision remains authoritative.",
    ].join("\n");
  }
  const statusInstruction =
    state.status === "paused"
      ? "This goal is paused. Do not continue goal work until the user explicitly resumes it."
      : state.status === "complete"
        ? "This goal is complete. Do not reopen or replace it unless the user explicitly starts a new goal in a new conversation."
        : "";
  const template = (state.status === "paused" || state.status === "complete"
    ? ""
    : upstreamTemplate(
        state.status === "budget_limited" ? "budget_limit.md" : "continuation.md",
        env,
      ))
    .replaceAll("{{ objective }}", state.objective)
    .replaceAll("{{ turns_used }}", String(state.turns_used))
    .replaceAll("{{ turn_budget }}", state.turn_budget === null ? "unlimited" : String(state.turn_budget))
    .replaceAll("{{ remaining_turns }}", remainingTurns(state) === null ? "unlimited" : String(remainingTurns(state)))
    .replaceAll("{{ time_used_seconds }}", String(state.time_used_seconds));
  return [
    "# goal_mode",
    "This Breadboard conversation is governed by a goal. Its state is per-conversation and uses the cloned goal project's goal_state.json contract.",
    `Current status: ${state.status}.`,
    "The goal already exists, so do not call create_goal. The person can pause, resume or abandon it from the goal card above the composer; you cannot.",
    `Use Breadboard's mcp_call tool with connection=${JSON.stringify(GOAL_MODE_CONNECTION)} and tool=get_goal to inspect it. Only after the completion audit in the contract below proves every requirement may you call connection=${JSON.stringify(GOAL_MODE_CONNECTION)}, tool=update_goal, args={ status: \"complete\" }.`,
    "Goal Mode grants no filesystem, network, or other capability; the normal capability decision remains authoritative.",
    statusInstruction,
    "",
    template,
  ].join("\n");
}
