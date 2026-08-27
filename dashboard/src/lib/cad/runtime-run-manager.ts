if (typeof window !== "undefined") {
  throw new Error("Parametric CAD Runtime control is server-only.");
}

// Durable Next.js facade for Parametric CAD. The model loop, CAD tools,
// geometry execution, validation, project writes and artifact publication are
// imported only by the disposable Runtime worker.

import { normalizeChatTokenUsage, type ChatTokenUsage } from "../chat-token-usage.ts";
import type { ParametricCadRequest } from "./identity.ts";

export type CadRunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface CadRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface CadTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
  state?: Record<string, unknown>;
}

export interface StartCadRunInput {
  userId: number;
  conversationPublicId: string;
  clientMessageId?: string;
  brief: string;
  parsed: ParametricCadRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
}

interface LaunchState {
  readonly requestSignature: string;
  readonly promise: Promise<{ runId: string; status: CadRunStatus }>;
}

const RETENTION_MS = 15 * 60 * 1_000;
const globalLaunches = globalThis as typeof globalThis & {
  __breadboardParametricCadRuntimeLaunches?: Map<string, LaunchState>;
};
const launches =
  globalLaunches.__breadboardParametricCadRuntimeLaunches ?? new Map<string, LaunchState>();
globalLaunches.__breadboardParametricCadRuntimeLaunches = launches;

/** Submit one authenticated, conversation-bound Runtime V2 job. */
export async function startRun(
  input: StartCadRunInput,
): Promise<{ runId: string; status: CadRunStatus }> {
  if (!input.parsed.brief.trim()) throw new Error("empty_brief");
  const requestSignature = JSON.stringify({
    brief: input.brief,
    parsed: input.parsed,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  });
  const clientMessageId = input.clientMessageId?.trim() ?? "";
  const launchKey = clientMessageId
    ? `${input.userId}\u0000${input.conversationPublicId}\u0000${clientMessageId}`
    : null;
  const prior = launchKey ? launches.get(launchKey) : undefined;
  if (prior) {
    if (prior.requestSignature !== requestSignature) {
      throw new Error("client_message_id_conflict");
    }
    const run = await prior.promise;
    const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
    const status = (await readOuterAgentRunView("parametric-cad", input.userId, run.runId, 0))
      .status;
    return {
      runId: run.runId,
      status: status === "planning" ? "running" : status ?? run.status,
    };
  }

  const submit = async (): Promise<{ runId: string; status: CadRunStatus }> => {
    const { startOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
    const run = await startOuterAgentRun({
      kind: "parametric-cad",
      userId: input.userId,
      ...(clientMessageId ? { requestId: clientMessageId } : {}),
      requestPayload: {
        operation: "run",
        conversationPublicId: input.conversationPublicId,
        clientMessageId,
        brief: input.brief,
        parsed: input.parsed,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        baseUrl: input.baseUrl,
      },
    });
    return {
      runId: run.runId,
      status: run.status === "planning" ? "running" : run.status,
    };
  };
  const promise = submit();
  if (launchKey) launches.set(launchKey, { requestSignature, promise });
  try {
    const run = await promise;
    if (launchKey) {
      setTimeout(() => {
        if (launches.get(launchKey)?.promise === promise) launches.delete(launchKey);
      }, RETENTION_MS).unref?.();
    }
    return run;
  } catch (error) {
    if (launchKey && launches.get(launchKey)?.promise === promise) launches.delete(launchKey);
    throw error;
  }
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<CadRunEvent[]> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return [
    ...(await readOuterAgentRunView("parametric-cad", userId, runId, since)).events,
  ] as CadRunEvent[];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("parametric-cad", userId, runId, 0)).terminal;
}

function eventText(value: unknown, maximumLength = 100_000): string {
  return typeof value === "string" ? value.slice(0, maximumLength) : "";
}

function eventRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function terminalResultFromEvents(events: readonly CadRunEvent[]): CadTerminalResult {
  const terminal = events.findLast((event) =>
    ["run.completed", "run.failed", "run.aborted"].includes(event.type),
  );
  const usage = normalizeChatTokenUsage(
    terminal?.payload.usage ??
      events.findLast((event) => event.type === "run.usage")?.payload,
  );
  if (terminal?.type === "run.completed") {
    const state = eventRecord(terminal.payload.state);
    return {
      outcome: "completed",
      content: eventText(terminal.payload.summary) || "The parametric CAD design is complete.",
      ...(usage ? { usage } : {}),
      ...(state?.kind === "parametric-cad" ? { state } : {}),
    };
  }
  if (terminal?.type === "run.aborted") {
    return {
      outcome: "aborted",
      content: eventText(terminal.payload.summary) || "The parametric CAD run was stopped.",
      ...(usage ? { usage } : {}),
    };
  }
  return {
    outcome: "failed",
    content: eventText(terminal?.payload.error) || "The parametric CAD run failed.",
    ...(usage ? { usage } : {}),
  };
}

export function setRunTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: CadTerminalResult) => void | Promise<void>,
): void {
  void import("../runtime-v2/outer-agent-run.ts").then(({ observeOuterAgentRun }) => {
    observeOuterAgentRun("parametric-cad", userId, runId, async (view) => {
      await handler(terminalResultFromEvents(view.events as CadRunEvent[]));
    });
  });
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const { abortOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return abortOuterAgentRun("parametric-cad", userId, runId);
}
