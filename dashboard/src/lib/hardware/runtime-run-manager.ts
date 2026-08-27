if (typeof window !== "undefined") {
  throw new Error("Hardware Blueprint Runtime control is server-only.");
}

// Durable dashboard facade for Hardware Blueprint. The model, component
// research, deterministic compiler, CAD hand-off, validation, firmware and
// artifact publication all live in the disposable Runtime worker. Importing
// this module must not pull that implementation graph into Next.js.

import { normalizeChatTokenUsage, type ChatTokenUsage } from "../chat-token-usage.ts";
import type { HardwarePreferences } from "../agent-settings/defaults.ts";
import type { HardwareBlueprintRequest } from "./identity.ts";

export type HardwareRunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface HardwareRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface HardwareTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
  state?: Record<string, unknown>;
}

export interface StartHardwareRunInput {
  userId: number;
  conversationPublicId: string;
  clientMessageId?: string;
  brief: string;
  parsed: HardwareBlueprintRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  preferences?: HardwarePreferences;
  conversationContext?: string;
}

interface DashboardLaunchState {
  readonly requestSignature: string;
  readonly promise: Promise<{ runId: string; status: HardwareRunStatus }>;
}

const RETENTION_MS = 15 * 60 * 1_000;
const globalLaunches = globalThis as typeof globalThis & {
  __breadboardHardwareBlueprintRuntimeLaunches?: Map<string, DashboardLaunchState>;
};
const launches =
  globalLaunches.__breadboardHardwareBlueprintRuntimeLaunches ??
  new Map<string, DashboardLaunchState>();
globalLaunches.__breadboardHardwareBlueprintRuntimeLaunches = launches;

/** Submit one authenticated, conversation-bound Runtime V2 job. */
export async function startRun(
  input: StartHardwareRunInput,
): Promise<{ runId: string; status: HardwareRunStatus }> {
  const preferences = input.preferences ?? {
    board: null,
    prototypeType: null,
    firmwarePlatform: null,
    enclosure: "auto" as const,
    cadBackend: "auto" as const,
  };
  const requestSignature = JSON.stringify({
    brief: input.brief,
    parsed: input.parsed,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    preferences,
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
    const status = (await readOuterAgentRunView(
      "hardware-blueprint",
      input.userId,
      run.runId,
      0,
    )).status;
    return {
      runId: run.runId,
      status: status === "planning" ? "running" : status ?? run.status,
    };
  }

  const submit = async (): Promise<{ runId: string; status: HardwareRunStatus }> => {
    const { startOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
    return startOuterAgentRun({
      kind: "hardware-blueprint",
      userId: input.userId,
      ...(clientMessageId ? { requestId: clientMessageId } : {}),
      requestPayload: {
        conversationPublicId: input.conversationPublicId,
        brief: input.brief,
        parsed: input.parsed,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        baseUrl: input.baseUrl,
        preferences,
        conversationContext: input.conversationContext ?? "",
      },
    }) as Promise<{ runId: string; status: HardwareRunStatus }>;
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
): Promise<HardwareRunEvent[]> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return [
    ...(await readOuterAgentRunView("hardware-blueprint", userId, runId, since)).events,
  ] as HardwareRunEvent[];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("hardware-blueprint", userId, runId, 0)).terminal;
}

function eventText(value: unknown, maximumLength = 100_000): string {
  return typeof value === "string" ? value.slice(0, maximumLength) : "";
}

function eventRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function terminalResultFromEvents(
  events: readonly HardwareRunEvent[],
): HardwareTerminalResult {
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
      content: eventText(terminal.payload.summary) || "The hardware blueprint is complete.",
      ...(usage ? { usage } : {}),
      ...(state?.kind === "hardware-blueprint" ? { state } : {}),
    };
  }
  if (terminal?.type === "run.aborted") {
    return {
      outcome: "aborted",
      content: eventText(terminal.payload.summary) || "The hardware blueprint run was stopped.",
      ...(usage ? { usage } : {}),
    };
  }
  return {
    outcome: "failed",
    content: eventText(terminal?.payload.error) || "The hardware blueprint run failed.",
    ...(usage ? { usage } : {}),
  };
}

export function setRunTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: HardwareTerminalResult) => void | Promise<void>,
): void {
  void import("../runtime-v2/outer-agent-run.ts").then(({ observeOuterAgentRun }) => {
    observeOuterAgentRun("hardware-blueprint", userId, runId, async (view) => {
      await handler(terminalResultFromEvents(view.events as HardwareRunEvent[]));
    });
  });
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const { abortOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return abortOuterAgentRun("hardware-blueprint", userId, runId);
}
