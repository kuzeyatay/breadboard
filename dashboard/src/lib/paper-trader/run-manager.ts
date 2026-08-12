// In-memory run manager for the Paper Trader agent.
//
// This one is shaped differently from every other agent's, and the difference is
// the point. Elsewhere the run *is* the work: it starts, it streams, it produces
// an answer, it ends. Here the work outlives the run — the desk keeps trading
// after the turn is over and after the conversation is closed. Closing the app
// closes the process; reopening resumes an enabled desk. So the run covers only the instruction: bring the desk
// up, take it down, or report on it. It reaches a terminal state in seconds.
//
// What stays live is the card, which reads the desk itself from
// `/api/paper-trader/snapshot` for as long as it is on screen. That is also why
// the card survives a reload with no replay to do: the desk's state was never in
// the event stream.

import { randomUUID } from "node:crypto";
import { paperTraderIntent, paperTraderRunLabel, type PaperTraderIntent } from "./identity.ts";
import { getPaperTraderStore } from "./instance.ts";
import type { PaperTraderSettings } from "./settings.ts";
import { deskStatus, startDesk, stopDesk } from "./supervisor.ts";
import { symbolLabel } from "./identity.ts";

export interface PaperTraderEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  task: string;
  intent: PaperTraderIntent;
  status: RunStatus;
  sequence: number;
  events: PaperTraderEvent[];
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardPaperTraderRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardPaperTraderRuns ?? new Map<string, RunState>();
globalRuns.__breadboardPaperTraderRuns = runs;

const MAX_EVENTS = 500;
const RETENTION_MS = 30 * 60 * 1000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
  }
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * The markdown that becomes the assistant's message. The card above it shows the
 * portfolio live; this is what the conversation still reads as, months later,
 * with the desk long since stopped.
 */
function summarise(
  intent: PaperTraderIntent,
  settings: PaperTraderSettings,
  detail: { capital: number | null; running: boolean; reset: boolean },
): string {
  if (intent === "stop") {
    return "The trading desk is stopped. Its positions and history are kept — starting it again resumes the same portfolio.";
  }
  if (intent === "status" && !detail.running) {
    return "The trading desk is not running. Start it and TradingAgents begins analysing the market on its own schedule.";
  }
  const coins = settings.symbols.map(symbolLabel).join(", ");
  const advisers = [
    settings.consultVibeTrading ? "Vibe Trading on the market regime" : "",
    settings.consultStockAnalyst ? "the Stock Analyst on risk appetite" : "",
  ].filter(Boolean);
  const lines = [
    intent === "status"
      ? "The trading desk is running."
      : "The trading desk is running while Breadboard is open. It keeps trading after this conversation is closed and resumes when Breadboard is reopened — until you stop it.",
    "",
    `- **Decisions** come from the Trading Agent team: ${settings.analysts.length} analyst${settings.analysts.length === 1 ? "" : "s"}, ${settings.researchDepth} research round${settings.researchDepth === 1 ? "" : "s"}, ${settings.riskRounds} risk round${settings.riskRounds === 1 ? "" : "s"}, one asset per cycle.`,
    advisers.length && settings.harmonise
      ? `- **Advised by** ${advisers.join(" and ")}, refreshed every ${settings.adviceEveryCycles} cycles. The desk acts only when the committee is at least ${Math.round(settings.minConfidence * 100)}% confident.`
      : "",
    `- **Risk officer** holds the desk to ${settings.maxOpenPositions} position${settings.maxOpenPositions === 1 ? "" : "s"} at once, stops opening below ${Math.round((1 - settings.maxDrawdown) * 100)}% of starting capital, and leaves a coin alone after ${settings.losingStreakLimit} losing exits in a row.`,
    `- **Cycle** every ${settings.cycleMinutes} minutes, across ${coins} and automatically discovered U.S. company shares during regular market hours.`,
    `- **Dynamic exposure** up to ${Math.round(settings.positionSize * 100)}% of available cash, chosen from the rating and chair confidence; coins use up to ${settings.leverage}× leverage (so reserved margin is lower) and shares use 1×${settings.allowShorts ? ", long or short" : ", long only"}.`,
    detail.capital !== null ? `- **Starting capital** ${money(detail.capital)}.` : "",
    detail.reset
      ? "- The starting capital changed, so a fresh portfolio was opened on the new amount and the previous one was retired."
      : "",
    "",
    "_Paper trading against live prices. No real money moves, and none of this is financial advice._",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export interface StartRunInput {
  userId: number;
  task: string;
  settings: PaperTraderSettings;
  /** The dashboard's own origin, as the arena will have to reach it. */
  callbackOrigin: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const runId = `ptrun_${randomUUID().replaceAll("-", "")}`;
  const intent = paperTraderIntent(input.task);
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    intent,
    status: "queued",
    sequence: 0,
    events: [],
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input);
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    label: paperTraderRunLabel(run.task),
    intent: run.intent,
    cycleMinutes: input.settings.cycleMinutes,
    symbols: input.settings.symbols,
  });

  try {
    if (run.intent === "stop") {
      const status = await stopDesk();
      finish(run, "completed", {
        summary: summarise(run.intent, input.settings, {
          capital: status.accountCapital,
          running: false,
          reset: false,
        }),
        status,
      });
      return;
    }

    const before = getPaperTraderStore().state();
    if (run.intent === "status" && !before.enabled) {
      finish(run, "completed", {
        summary: summarise(run.intent, input.settings, {
          capital: before.accountCapital,
          running: false,
          reset: false,
        }),
        status: deskStatus(input.settings),
      });
      return;
    }

    emit(run, "desk.starting", {});
    const started = await startDesk({
      userId: input.userId,
      settings: input.settings,
      callbackOrigin: input.callbackOrigin,
    });
    emit(run, "desk.ready", {
      accountId: started.account.id,
      startingCapital: started.account.initialCapital,
    });

    finish(run, "completed", {
      summary: summarise(run.intent, input.settings, {
        capital: started.account.initialCapital,
        running: true,
        // A retired account leaves the new one at exactly the configured
        // capital with nothing spent, which is what the reset reads as.
        reset:
          before.accountId !== null &&
          before.accountId !== started.account.id &&
          before.accountCapital !== started.account.initialCapital,
      }),
      status: started.status,
      accountId: started.account.id,
    });
  } catch (error) {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The trading desk could not start.",
    });
  }
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function getEventsSince(userId: number, runId: string, since = 0): PaperTraderEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

/**
 * Stopping the *run* is not stopping the desk: the run is only the instruction
 * that started it, and abandoning an instruction that has already been carried
 * out should not close a portfolio. Stopping the desk is its own instruction,
 * and the card has a button for it.
 */
export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  emit(run, "run.aborted", {
    summary: "The desk was left as it was.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
  return true;
}
