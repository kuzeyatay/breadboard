// Conversation-scoped Goal lifecycle, following codex/codex-rs/ext/goal.
// Breadboard owns transport and storage; the Codex completion/continuation
// contract is bundled in goal-prompts.ts with task-neutral examples.
//
// A goal is started by the `goal` skill, not by a product switch: the model
// calls create_goal in the turn the skill is selected for, and every later turn
// in the same conversation reads the state back out of this module. The
// lifecycle after creation belongs to the person, through the goal card above
// the composer. The model may report completion or an audited blocker.

import crypto from "node:crypto";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { dashboardDataDir } from "./runtime-paths.ts";
import { GOAL_CONTINUATION_PROMPT, GOAL_BUDGET_PROMPT } from "./goal-prompts.ts";
import { normalizeChatTokenUsage } from "./chat-token-usage.ts";
import { taskFailureCanRecover, recoveryFingerprint } from "./hermes/task-recovery-policy.ts";

export const GOAL_MODE_CONNECTION = "goal";
/** The first-party skill directory name, which is also its slash command. */
export const GOAL_MODE_SKILL = "goal";
/** Codex counts uncached input plus output (reasoning is already in output). */
export function goalTokensForUsage(value: unknown): number | undefined {
  const usage = normalizeChatTokenUsage(value);
  return usage ? Math.max(0, usage.inputTokens - usage.cachedInputTokens) + usage.outputTokens : undefined;
}
const MAX_OBJECTIVE_CHARS = 4_000;
const VALID_STATUSES = new Set([
  "active",
  "paused",
  "budget_limited",
  "complete",
  "blocked",
  "usage_limited",
]);

export type GoalModeStatus = "active" | "paused" | "budget_limited" | "complete" | "blocked" | "usage_limited";

/** Legacy turn limits remain readable; new goals use Codex token budgets. */
export interface GoalModeState {
  goal_id: string;
  objective: string;
  status: GoalModeStatus;
  turn_budget: number | null;
  token_budget: number | null;
  continuation_deferred: boolean;
  runtime_failures?: number;
  runtime_failure_fingerprint?: string;
  /** Cumulative per-run receipts make streaming and final accounting idempotent. */
  accounting: Record<string, { tokens: number; seconds: number; ended: boolean }>;
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
    token_budget: asNonNegativeInteger(state.token_budget) ?? null,
    continuation_deferred: state.continuation_deferred === true,
    ...(typeof state.runtime_failures === "number"
      ? { runtime_failures: asNonNegativeInteger(state.runtime_failures) ?? 0 } : {}),
    ...(typeof state.runtime_failure_fingerprint === "string"
      ? { runtime_failure_fingerprint: state.runtime_failure_fingerprint } : {}),
    accounting: state.accounting && typeof state.accounting === "object"
      ? state.accounting as GoalModeState["accounting"] : {},
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
  tokensUsed = 0,
  tokenBudget: number | null = null,
): GoalModeStatus {
  return status === "active" && ((turnBudget !== null && turnsUsed >= turnBudget) ||
    (tokenBudget !== null && tokensUsed >= tokenBudget))
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

/** A person starting/resuming a turn clears Codex's no-tool continuation deferral. */
export function clearGoalContinuationDeferral(conversationPublicId: string, env = process.env): void {
  const paths = goalModePaths(conversationPublicId, env);
  const state = readRaw(paths);
  if (state?.continuation_deferred) writeRaw(paths, { ...state, continuation_deferred: false });
}

export function goalCanContinue(state: GoalModeState | null): boolean {
  return state?.status === "active" && !state.continuation_deferred &&
    (state.token_budget === null || state.tokens_used < state.token_budget) &&
    (state.turn_budget === null || state.turns_used < state.turn_budget);
}

/** Start a goal only when this conversation has no prior Goal state. */
export function activateGoalMode(input: {
  conversationPublicId: string;
  objective: string;
  turnBudget?: number | null;
  tokenBudget?: number | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeState {
  const paths = goalModePaths(input.conversationPublicId, input.env);
  const existing = readRaw(paths);
  if (existing && existing.status !== "complete") return existing;
  const turnBudget = input.turnBudget ?? null;
  const tokenBudget = input.tokenBudget ?? null;
  if (tokenBudget !== null && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) {
    throw new Error("Goal token budget must be a positive integer.");
  }
  if (turnBudget !== null && (!Number.isInteger(turnBudget) || turnBudget < 0)) {
    throw new Error("Goal Mode turn budget must be a non-negative integer.");
  }
  const now = nowIso(input.now);
  const state: GoalModeState = {
    goal_id: crypto.randomUUID(),
    objective: cleanObjective(input.objective),
    status: statusAfterBudgetLimit("active", 0, turnBudget),
    turn_budget: turnBudget,
    token_budget: tokenBudget,
    continuation_deferred: false,
    accounting: {},
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
  // completion audit already signed off on; starting again requires a new goal.
  if (state.status === "complete") return state;
  const next: GoalModeState = {
    ...state,
    status:
      input.status === "active"
        // Resuming a goal that ran out of budget without also lifting the
        // budget would put it straight back into budget_limited, so the
        // shared helper decides which of the two "running" states applies.
        ? statusAfterBudgetLimit("active", state.turns_used, state.turn_budget, state.tokens_used, state.token_budget)
        : "paused",
    continuation_deferred: false,
    runtime_failures: 0,
    runtime_failure_fingerprint: undefined,
    updated_at: nowIso(input.now),
  };
  delete next.runtime_failure_fingerprint;
  writeRaw(paths, next);
  return next;
}

/**
 * Raise (or lift) a goal's budget, so a person
 * who still wants the work done can say so without restating the objective.
 */
export function extendGoalModeBudget(input: {
  conversationPublicId: string;
  turnBudget?: number | null;
  tokenBudget?: number | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeState | null {
  const paths = goalModePaths(input.conversationPublicId, input.env);
  const state = readRaw(paths);
  if (!state || state.status === "complete") return state;
  const turnBudget = input.turnBudget === undefined ? state.turn_budget : input.turnBudget;
  const tokenBudget = input.tokenBudget === undefined ? state.token_budget : input.tokenBudget;
  if (tokenBudget !== null && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) {
    throw new Error("Goal token budget must be a positive integer or unlimited.");
  }
  if (turnBudget !== null && (!Number.isInteger(turnBudget) || turnBudget <= 0)) {
    throw new Error("Goal turn budget must be a positive integer or unlimited.");
  }
  const next: GoalModeState = {
    ...state,
    turn_budget: turnBudget,
    token_budget: tokenBudget,
    status:
      state.status === "active" || state.status === "budget_limited"
        ? statusAfterBudgetLimit("active", state.turns_used, turnBudget, state.tokens_used, tokenBudget)
        : state.status,
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
  runId?: string;
  tokensUsed?: number;
  finished?: boolean;
  automatic?: boolean;
  toolCalls?: number;
  outcome?: "completed" | "cancelled" | "error" | "usage_limited";
  failureCode?: string;
  failureMessage?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): GoalModeState | null {
  const paths = goalModePaths(input.conversationPublicId, input.env);
  const state = readRaw(paths);
  if (!state || state.goal_id !== input.goalId) return state;
  const started = Date.parse(input.startedAt);
  const finished = (input.now ?? new Date()).getTime();
  const elapsed = Number.isFinite(started)
    ? Math.max(0, Math.floor((finished - started) / 1_000))
    : 0;
  const receiptId = input.runId ?? input.startedAt;
  const previous = state.accounting[receiptId] ?? { tokens: 0, seconds: 0, ended: false };
  const tokens = Math.max(previous.tokens, asNonNegativeInteger(input.tokensUsed) ?? 0);
  const seconds = Math.max(previous.seconds, elapsed);
  const ended = input.finished !== false;
  if (previous.ended) return state;
  const turnsUsed = state.turns_used + (ended ? 1 : 0);
  const tokensUsed = state.tokens_used + tokens - previous.tokens;
  const recoverableFailure = input.outcome === "error" && taskFailureCanRecover({ code: input.failureCode, message: input.failureMessage });
  const fingerprint = recoverableFailure ? recoveryFingerprint([input.failureCode, input.failureMessage]) : undefined;
  const runtimeFailures = ended ? (recoverableFailure
    ? (state.runtime_failure_fingerprint === fingerprint ? (state.runtime_failures ?? 0) + 1 : 1)
    : 0) : (state.runtime_failures ?? 0);
  let status = statusAfterBudgetLimit(state.status, turnsUsed, state.turn_budget, tokensUsed, state.token_budget);
  if (status === "active" && ended) {
    if (input.outcome === "cancelled") status = "paused";
    if (input.outcome === "error" && (!recoverableFailure || runtimeFailures >= 3)) status = "blocked";
    if (input.outcome === "usage_limited") status = "usage_limited";
  }
  const next: GoalModeState = {
    ...state,
    turns_used: turnsUsed,
    tokens_used: tokensUsed,
    time_used_seconds: state.time_used_seconds + seconds - previous.seconds,
    accounting: { ...state.accounting, [receiptId]: { tokens, seconds, ended } },
    runtime_failures: runtimeFailures,
    runtime_failure_fingerprint: ended ? fingerprint : state.runtime_failure_fingerprint,
    continuation_deferred: ended && input.automatic === true && input.toolCalls === 0 && !recoverableFailure,
    status,
    updated_at: nowIso(input.now),
  };
  if (next.runtime_failure_fingerprint === undefined) delete next.runtime_failure_fingerprint;
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
      tokenBudget: state.token_budget,
      remainingTokens: state.token_budget === null ? null : Math.max(0, state.token_budget - state.tokens_used),
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
      state.token_budget === null ? "" : `tokens used: ${state.tokens_used} of ${state.token_budget}`,
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
    if (existing && existing.status !== "complete") {
      return {
        isError: true,
        text: "cannot create a new goal because this thread has an unfinished goal; use update_goal only for status",
      };
    }
    if (typeof input.args.objective !== "string") {
      return { isError: true, text: "objective is required and must be a non-empty string" };
    }
    const turnBudget = input.args.turn_budget;
    const tokenBudget = input.args.token_budget;
    if (tokenBudget !== undefined && (typeof tokenBudget !== "number" || !Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) {
      return { isError: true, text: "token_budget must be a positive integer when explicitly requested" };
    }
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
        tokenBudget: typeof tokenBudget === "number" ? tokenBudget : null,
        env,
        now: input.now,
      }));
    } catch (error) {
      return { isError: true, text: error instanceof Error ? error.message : "invalid goal" };
    }
  }
  if (input.tool === "update_goal") {
    if (input.args.status !== "complete" && input.args.status !== "blocked") {
      return {
        isError: true,
        text: "update_goal can only mark the existing goal complete or blocked; pause, resume, budget and usage limits are controlled by the user or system",
      };
    }
    if (!existing) return { isError: true, text: "cannot update goal: no goal exists" };
    const next: GoalModeState = {
      ...existing,
      status: input.args.status,
      updated_at: nowIso(input.now),
    };
    writeRaw(goalModePaths(input.conversationPublicId, env), next);
    return goalModeToolResponse(next, true);
  }
  return { isError: true, text: `Unknown goal tool: ${input.tool}` };
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
  tokenBudget: number | null;
  remainingTokens: number | null;
  continuationDeferred: boolean;
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
    tokenBudget: state.token_budget,
    remainingTokens: state.token_budget === null ? null : Math.max(0, state.token_budget - state.tokens_used),
    continuationDeferred: state.continuation_deferred,
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
      `Before working the request, call mcp_call with connection=${JSON.stringify(GOAL_MODE_CONNECTION)}, tool=create_goal and args={ objective: "<the finished state, in the user's terms>" }, adding token_budget only when the user explicitly requested a token budget.`,
      "The goal then governs every later turn of this conversation on its own; you do not re-select the skill.",
      "Goal grants no filesystem, network, or other capability; the normal capability decision remains authoritative.",
    ].join("\n");
  }
  const statusInstruction =
    state.status === "paused"
      ? "This goal is paused. Do not continue goal work until the user explicitly resumes it."
      : state.status === "complete"
        ? "This goal is complete. Only create a replacement when the user explicitly starts a new goal."
        : state.status === "blocked" || state.status === "usage_limited"
          ? "This goal is stopped. Wait for the user to resume it before continuing goal work."
        : "";
  const template = (statusInstruction
    ? ""
    : state.status === "budget_limited" ? GOAL_BUDGET_PROMPT : GOAL_CONTINUATION_PROMPT)
    .replaceAll("{{ objective }}", state.objective.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"))
    .replaceAll("{{ tokens_used }}", String(state.tokens_used))
    .replaceAll("{{ token_budget }}", state.token_budget === null ? "none" : String(state.token_budget))
    .replaceAll("{{ remaining_tokens }}", state.token_budget === null ? "unbounded" : String(Math.max(0, state.token_budget - state.tokens_used)))
    .replaceAll("{{ turns_used }}", String(state.turns_used))
    .replaceAll("{{ turn_budget }}", state.turn_budget === null ? "unlimited" : String(state.turn_budget))
    .replaceAll("{{ remaining_turns }}", remainingTurns(state) === null ? "unlimited" : String(remainingTurns(state)))
    .replaceAll("{{ time_used_seconds }}", String(state.time_used_seconds));
  return [
    "# goal_mode",
    "This Breadboard conversation has a persistent goal. Automatic continuation follows the Codex goal lifecycle; the objective can concern any task.",
    `Current status: ${state.status}.`,
    "For an unfinished goal, do not call create_goal. The person can pause, resume or abandon it from the goal card and controls its budget.",
    `Use mcp_call with connection="goal" and tool=get_goal to inspect it. Use tool=update_goal with status="complete" only after the completion audit, or status="blocked" only after the blocked audit below.`,
    "Goal Mode grants no filesystem, network, or other capability; the normal capability decision remains authoritative.",
    statusInstruction,
    state.status === "budget_limited" && state.token_budget === null && state.turn_budget !== null
      ? "This legacy goal has reached its turn budget. Do not start new substantive work." : "",
    "",
    template,
  ].join("\n");
}
