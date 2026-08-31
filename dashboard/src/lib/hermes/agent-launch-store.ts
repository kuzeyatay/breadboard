// Runtime-agent launches a super-agent turn asked for, waiting for the surface
// that can actually perform them.
//
// A runtime agent is started entirely by the chat client: it matches the
// selected launcher POSTs that agent's own run route and renders the streaming
// card. Nothing on the server can do that — which is why a super-agent request
// is streamed to the owning surface as structured delegation metadata.
//
// `agent_launch` closes that gap without moving the launch: the tool route
// records the request here, the turn's event stream carries it to the client the
// way artifact events are already carried, and the surface invokes the matching
// launcher directly. No synthetic user message is created. Action-capable
// agents retain confirmation; read-only delegations can start immediately.
//
// Deliberately in memory rather than in SQLite. A launch is only meaningful to
// the client that is watching this turn: if the tab is gone when the request is
// made, the run must not start ten minutes later when something reconnects.
// Losing these on a restart is the correct behavior, not a limitation.

import { randomUUID } from "node:crypto";

import type { ExternalAgentRun } from "../conversations/external-agent-runs.ts";
import type { ExternalAgentCall } from "./evidence.ts";
import { MAX_PARALLEL_AGENT_LAUNCHES } from "./agent-launch.ts";

type ServerStartedAgentRun = Extract<
  ExternalAgentRun,
  { kind: "max_research" }
>;

/** Requests kept per run. A turn that asks for more than this is looping. */
const MAX_REQUESTS_PER_RUN = MAX_PARALLEL_AGENT_LAUNCHES;
/** Runs kept in memory at once, oldest evicted first. */
const MAX_TRACKED_RUNS = 64;

export interface AgentLaunchRequest {
  /** Monotonic within the process, so a stream can resume from an offset. */
  id: number;
  /** Stable id the client echoes back when it confirms or refuses. */
  requestId: string;
  /** Distinct hidden transcript turn that owns this worker and its result. */
  workerClientMessageId: string;
  runId: string;
  agentId: string;
  agentName: string;
  /** The slash command, e.g. `/agents:money-printer`. */
  command: string;
  /** The brief the agent will receive, already trimmed and bounded. */
  brief: string;
  /** The model's one-line reason, shown on the confirmation chip. */
  reason: string;
  /**
   * True when the chat should send the run's result back as a follow-up turn so
   * the super agent can react to it — the difference between handing off and
   * orchestrating.
   */
  awaitResult: boolean;
  /** Whether the surface must show an explicit start confirmation. */
  requiresApproval: boolean;
  /** Assistant turn that owns this delegated run card. */
  originClientMessageId?: string;
  /**
   * A read-only worker the tool route already started and attached durably.
   * The surface adopts this descriptor for observation; it must not start a
   * second run.
   */
  startedRun?: ServerStartedAgentRun;
  createdAt: string;
}

interface AgentLaunchStoreState {
  nextId: number;
  byRun: Map<string, AgentLaunchRequest[]>;
  reservationsByRun: Map<string, number>;
}

// The tool endpoint that records a launch and the SSE endpoint that drains it
// are separate Next.js route bundles. Module-local state gives each bundle its
// own Map, so the tool can succeed while the browser never receives the launch
// event (and therefore never renders the approval card). Keep the deliberately
// ephemeral store process-global: it still disappears on restart, while every
// route bundle in this server observes the same requests.
const storeGlobal = globalThis as typeof globalThis & {
  __breadboardAgentLaunchStore?: AgentLaunchStoreState;
};
const store =
  storeGlobal.__breadboardAgentLaunchStore ??
  {
    nextId: 1,
    byRun: new Map<string, AgentLaunchRequest[]>(),
    reservationsByRun: new Map<string, number>(),
  };
store.reservationsByRun ??= new Map<string, number>();
storeGlobal.__breadboardAgentLaunchStore = store;

function evictOldestRun(): void {
  const oldest = store.byRun.keys().next();
  if (!oldest.done) store.byRun.delete(oldest.value);
}

export interface RecordAgentLaunchInput {
  runId: string;
  workerClientMessageId?: string;
  agentId: string;
  agentName: string;
  command: string;
  brief: string;
  reason: string;
  awaitResult: boolean;
  requiresApproval?: boolean;
  originClientMessageId?: string;
  startedRun?: ServerStartedAgentRun;
}

/**
 * Queue a launch for the client watching `runId`.
 *
 * Returns null when this run has already asked for its limit — the caller
 * reports that to the model rather than silently dropping the request, so a turn
 * that has started looping is told to stop instead of appearing to succeed.
 */
export function recordAgentLaunchRequest(
  input: RecordAgentLaunchInput,
): AgentLaunchRequest | null {
  const existing = store.byRun.get(input.runId) ?? [];
  if (existing.length >= MAX_REQUESTS_PER_RUN) return null;
  if (!store.byRun.has(input.runId) && store.byRun.size >= MAX_TRACKED_RUNS) {
    evictOldestRun();
  }
  const requestId = randomUUID();
  const request: AgentLaunchRequest = {
    id: store.nextId++,
    requestId,
    workerClientMessageId:
      input.workerClientMessageId?.trim().slice(0, 128) ||
      `agent-launch-${requestId}`,
    runId: input.runId,
    agentId: input.agentId,
    agentName: input.agentName,
    command: input.command,
    brief: input.brief,
    reason: input.reason,
    awaitResult: input.awaitResult,
    requiresApproval: input.requiresApproval !== false,
    ...(input.originClientMessageId
      ? { originClientMessageId: input.originClientMessageId }
      : {}),
    ...(input.startedRun ? { startedRun: input.startedRun } : {}),
    createdAt: new Date().toISOString(),
  };
  store.byRun.set(input.runId, [...existing, request]);
  return request;
}

/** Requests for this run newer than `afterId`, oldest first. */
export function listAgentLaunchRequestsAfter(input: {
  runId: string;
  afterId: number;
}): AgentLaunchRequest[] {
  return (store.byRun.get(input.runId) ?? []).filter(
    (request) => request.id > input.afterId,
  );
}

/**
 * Every launch this run asked for, shaped for the answer's evidence ledger.
 *
 * Read from the store rather than from what a stream managed to emit, so a
 * delegation still appears in the ledger when the browser was gone by the time
 * the event would have been delivered.
 */
export function externalAgentCallsForRun(
  runId: string | undefined,
): ExternalAgentCall[] {
  if (!runId) return [];
  return listAgentLaunchRequestsAfter({ runId, afterId: 0 }).map((request) => ({
    agentId: request.agentId,
    agentName: request.agentName,
    command: request.command,
    reason: request.reason,
    requiresApproval: request.requiresApproval,
    requestedAt: request.createdAt,
  }));
}

/** How many launches this run has already asked for. */
export function countAgentLaunchRequests(runId: string): number {
  return (store.byRun.get(runId) ?? []).length;
}

/** Atomically reserve capacity while a server-started worker is being created. */
export function reserveAgentLaunchRequestSlot(runId: string): boolean {
  const used = countAgentLaunchRequests(runId);
  const reserved = store.reservationsByRun.get(runId) ?? 0;
  if (used + reserved >= MAX_REQUESTS_PER_RUN) return false;
  store.reservationsByRun.set(runId, reserved + 1);
  return true;
}

export function releaseAgentLaunchRequestSlot(runId: string): void {
  const reserved = store.reservationsByRun.get(runId) ?? 0;
  if (reserved <= 1) store.reservationsByRun.delete(runId);
  else store.reservationsByRun.set(runId, reserved - 1);
}

/** Drop a finished run's requests once its stream has ended. */
export function clearAgentLaunchRequests(runId: string): void {
  store.byRun.delete(runId);
  store.reservationsByRun.delete(runId);
}

/** Test seam: forget everything, so one case cannot leak into the next. */
export function resetAgentLaunchRequests(): void {
  store.byRun.clear();
  store.reservationsByRun.clear();
  store.nextId = 1;
}
