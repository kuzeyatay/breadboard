// Long-running work filing itself onto the board.
//
// An `/agents:*` run or a scheduled chat produces artifacts and a transcript,
// but until now it left no durable record of *state*: nothing said "this is in
// flight" or "this finished on Tuesday" once the conversation scrolled away.
// A card does, and it survives the chat it came from.
//
// Three rules this module holds to:
//
//   * It never throws into its caller. A board that cannot be written must not
//     take a run down with it, so every entry point swallows its own errors
//     after logging them. Tracking is bookkeeping, not the work.
//   * Cards are keyed by the run's own id, so a run that reports twice updates
//     one card instead of stacking duplicates.
//   * The cards go in their own project, created on first use. Mixing machine
//     work into the user's own project would make their board unreadable, and a
//     project they never asked for should not exist until something fills it.

import { getPlanStore } from "./instance.ts";
import type { PlanStore } from "./store.ts";
import type { TaskSource } from "./types.ts";
import {
  beginLiveBreadboardProcess,
  finishLiveBreadboardProcess,
} from "../processes/live-processes.ts";

/** Where filed work lands. Created lazily, on the first run that is tracked. */
export const AGENT_PROJECT_NAME = "Agent runs";

const MAX_LABEL_CHARS = 120;

/**
 * Feature switch, read from the environment like the Recall one so this module
 * stays free of a config import. Default on: the user asked for runs to be
 * tracked, and a board with nothing on it is the same as no board at all.
 */
export function isAgentTrackingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.PLAN_TRACK_AGENT_RUNS ?? "").trim();
  if (!raw) return true;
  return /^(1|true|yes|on)$/i.test(raw);
}

/** Human names for the run kinds, so a card does not read like a database row. */
const KIND_LABELS: Record<string, string> = {
  agent_tars: "Browser operator",
  agent_browser: "Agent browser",
  agent_reach: "Agent reach",
  career_ops: "Career ops",
  trading_agents: "Trading agents",
  vibe_trading: "Vibe trading",
  stock_analyst: "Stock analyst",
  deer_flow: "DeerFlow",
  deep_research: "Deep research",
  get_doc: "Get doc",
  deep_tutor: "Deep tutor",
  openplanter: "OpenPlanter",
  openwork: "OpenWork",
  codex: "Codex",
  opencode: "OpenCode",
  ruflo: "Ruflo",
  socials_manager: "Socials manager",
  hardware_blueprint: "Hardware blueprint",
  parametric_cad: "Parametric CAD",
  hyperframes: "Hyperframes",
  openmontage: "OpenMontage",
  vimax: "ViMax",
  shorts: "Shorts",
  formsmith: "Formsmith",
  money_printer: "Money printer",
};

export function agentKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function condense(value: string, max = MAX_LABEL_CHARS): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The "Agent runs" project, made on first use. */
function trackingProject(store: PlanStore, userId: number): number {
  const existing = store
    .listProjects(userId, { includeArchived: true })
    .find((project) => project.name === AGENT_PROJECT_NAME);
  if (existing) return existing.id;
  return store.createProject(userId, {
    name: AGENT_PROJECT_NAME,
    description:
      "Work breadboard started for you: agent runs and scheduled chats. Cards here are filed automatically.",
    color: "#7b97aa",
  }).id;
}

function columnId(store: PlanStore, userId: number, projectId: number, slug: string): number | null {
  return store.findColumnBySlug(userId, projectId, slug)?.id ?? null;
}

interface StartInput {
  userId: number;
  /** The run's own id — the de-duplication key. */
  runId: string;
  source: TaskSource;
  title: string;
  notes?: string | null;
}

function fileStart(store: PlanStore, input: StartInput): void {
  const projectId = trackingProject(store, input.userId);
  store.upsertSourceTask(input.userId, {
    projectId,
    columnId: columnId(store, input.userId, projectId, "in-progress"),
    title: input.title,
    description: input.notes ?? null,
    source: input.source,
    sourceRef: input.runId,
    // Newest work at the top: a tracking column is read from the top down.
    prepend: true,
  });
}

interface FinishInput {
  userId: number;
  runId: string;
  source: TaskSource;
  outcome: "completed" | "failed" | "aborted";
  /** A line about how it went, kept as the card's own note. */
  summary?: string | null;
}

function fileFinish(store: PlanStore, input: FinishInput): void {
  const projectId = trackingProject(store, input.userId);
  const existing = store
    .queryTasks(
      input.userId,
      { projectId, includeDone: true, limit: 5_000 },
      { cap: 20_000 },
    )
    .find((task) => task.source === input.source && task.sourceRef === input.runId);
  // Nothing to finish: the start was never filed (tracking switched on
  // mid-flight, say), and inventing a completed card for work nobody watched
  // start would be worse than staying quiet.
  if (!existing) return;

  // A finished run is done. A failed or aborted one is not — it goes where work
  // that needs a person goes, so the board never claims something worked.
  const targetSlug = input.outcome === "completed" ? "done" : "in-review";
  const target =
    columnId(store, input.userId, projectId, targetSlug) ??
    columnId(store, input.userId, projectId, "done");
  if (target && target !== existing.columnId) {
    store.moveTask(input.userId, existing.id, { columnId: target });
  }
  if (input.summary) {
    store.addComment(input.userId, existing.id, condense(input.summary, 2_000), "assistant");
  } else if (input.outcome !== "completed") {
    store.addComment(input.userId, existing.id, `The run ${input.outcome}.`, "assistant");
  }
}

// --- entry points ----------------------------------------------------------
//
// Each takes an optional store so the behaviour can be exercised against an
// in-memory database. Production callers pass nothing and get the singleton;
// the default is evaluated per call, so importing this module opens nothing.

/** An `/agents:*` run has been launched. */
export function trackAgentRunStarted(
  input: {
    userId: number;
    kind: string;
    runId: string;
    /** The task, prompt or label the run was given. */
    task?: string | null;
    conversationTitle?: string | null;
  },
  store?: PlanStore,
): void {
  const label = agentKindLabel(input.kind);
  const task = condense(input.task ?? "");
  const title = task ? `${label}: ${task}` : label;
  const description = input.conversationTitle
    ? `Started from the chat "${condense(input.conversationTitle)}".`
    : null;
  // An injected store is a test/alternate ledger. Only the application call
  // site (which omits it) is evidence that a real process started here.
  if (!store) {
    beginLiveBreadboardProcess({
      userId: input.userId,
      runId: input.runId,
      title,
      description,
      kind: "agent",
    });
  }
  if (!isAgentTrackingEnabled()) return;
  try {
    fileStart(store ?? getPlanStore(), {
      userId: input.userId,
      runId: input.runId,
      source: "agent_run",
      title,
      notes: description,
    });
  } catch (error) {
    console.error("[plan] could not file an agent run", error);
  }
}

/** An `/agents:*` run has reached a terminal outcome. */
export function trackAgentRunFinished(
  input: {
    userId: number;
    runId: string;
    outcome: "completed" | "failed" | "aborted";
    summary?: string | null;
  },
  store?: PlanStore,
): void {
  if (!store) {
    finishLiveBreadboardProcess({
      userId: input.userId,
      runId: input.runId,
      kind: "agent",
    });
  }
  if (!isAgentTrackingEnabled()) return;
  try {
    fileFinish(store ?? getPlanStore(), { ...input, source: "agent_run" });
  } catch (error) {
    console.error("[plan] could not close an agent run card", error);
  }
}

/** A cron-scheduled chat has fired. */
export function trackScheduledChatStarted(
  input: { userId: number; jobId: number; runId: string; title: string },
  store?: PlanStore,
): void {
  const title = `Scheduled: ${condense(input.title)}`;
  const description = `Fired by schedule #${input.jobId}.`;
  if (!store) {
    beginLiveBreadboardProcess({
      userId: input.userId,
      runId: input.runId,
      title,
      description,
      kind: "scheduled_run",
    });
  }
  if (!isAgentTrackingEnabled()) return;
  try {
    fileStart(store ?? getPlanStore(), {
      userId: input.userId,
      runId: input.runId,
      source: "schedule",
      title,
      notes: description,
    });
  } catch (error) {
    console.error("[plan] could not file a scheduled chat", error);
  }
}

/** A scheduled chat has been dispatched, or failed to start. */
export function trackScheduledChatFinished(
  input: {
    userId: number;
    runId: string;
    outcome: "completed" | "failed";
    summary?: string | null;
  },
  store?: PlanStore,
): void {
  if (!store) {
    finishLiveBreadboardProcess({
      userId: input.userId,
      runId: input.runId,
      kind: "scheduled_run",
    });
  }
  if (!isAgentTrackingEnabled()) return;
  try {
    fileFinish(store ?? getPlanStore(), { ...input, source: "schedule" });
  } catch (error) {
    console.error("[plan] could not close a scheduled chat card", error);
  }
}
