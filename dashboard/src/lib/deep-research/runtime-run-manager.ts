// Durable dashboard facade for Deep Research. Next validates and enriches the
// request, then retains only authenticated Runtime correlation. One fresh
// worker owns sidecar execution, event replay, cancellation, and terminal state.

import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import { composeAgentMemoryContext } from "../conversations/agent-memory-context.ts";
import {
  contextSection,
  conversationContextFromBody,
} from "../conversations/agent-context.ts";
import { DEEP_RESEARCH_AGENT_ID } from "./identity.ts";
import { validateRunRequest } from "./config.ts";
import { DeepResearchError } from "./service.ts";
import type { RunSummary } from "./client.ts";

export type DeepResearchEvent = OuterAgentEvent;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function conversationPublicIdFrom(body: Record<string, unknown>): string | null {
  const value = body.conversationPublicId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requestIdFrom(body: Record<string, unknown>): string | undefined {
  const value = typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) ? value : undefined;
}

export async function startRun(
  userId: number,
  body: Record<string, unknown>,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  const validated = validateRunRequest(body);
  if (!validated.ok) throw new DeepResearchError(400, validated.error);
  const conversationPublicId = conversationPublicIdFrom(body);
  const memory = await composeAgentMemoryContext({
    userId,
    agentId: DEEP_RESEARCH_AGENT_ID,
    query: validated.value.query,
    conversationPublicId,
  });
  return startOuterAgentRun({
    kind: "deep-research",
    userId,
    requestId: requestIdFrom(body),
    requestPayload: {
      ...validated.value,
      memoryContext: memory?.text ?? "",
      conversationContext: contextSection(conversationContextFromBody(userId, body)),
    },
  });
}

function integer(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function summaryFromView(
  runId: string,
  events: readonly OuterAgentEvent[],
  runtimeStatus: OuterAgentRunStatus | null,
): RunSummary {
  let query = "";
  let breadth = 1;
  let depth = 1;
  let output: "report" | "answer" = "report";
  let result: string | undefined;
  let failure: { code: string; message: string } | undefined;
  let learningCount = 0;
  let sourceCount = 0;
  let evidenceCount = 0;
  let warningCount = 0;
  let coverage: RunSummary["coverage"];
  let budget: RunSummary["budget"];
  let completedAt: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (const event of events) {
    const payload = record(event.payload);
    if (event.type === "run.started") {
      if (typeof payload.query === "string") query = payload.query;
      breadth = integer(payload.breadth) || breadth;
      depth = integer(payload.depth) || depth;
      if (payload.output === "answer") output = "answer";
    }
    if (event.type === "research.learnings" && Array.isArray(payload.learnings)) {
      learningCount = payload.learnings.length;
    }
    if (event.type === "research.evidence") {
      if (Array.isArray(payload.sources)) sourceCount = payload.sources.length;
      if (Array.isArray(payload.evidence)) evidenceCount = payload.evidence.length;
      if (Array.isArray(payload.warnings)) warningCount = payload.warnings.length;
      if (payload.coverage && typeof payload.coverage === "object") {
        coverage = payload.coverage as RunSummary["coverage"];
      }
      if (payload.budget && typeof payload.budget === "object") {
        budget = payload.budget as RunSummary["budget"];
      }
    }
    if (event.type === "run.usage") {
      inputTokens = integer(payload.inputTokens);
      outputTokens = integer(payload.outputTokens);
      totalTokens = integer(payload.totalTokens);
    }
    if (event.type === "run.result" && typeof payload.result === "string") {
      result = payload.result;
      if (payload.output === "answer") output = "answer";
    }
    if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) {
      completedAt = event.at;
      learningCount = integer(payload.learningCount) || learningCount;
      sourceCount = integer(payload.sourceCount) || sourceCount;
      evidenceCount = integer(payload.evidenceCount) || evidenceCount;
      warningCount = integer(payload.warningCount) || warningCount;
      if (payload.coverage && typeof payload.coverage === "object") {
        coverage = payload.coverage as RunSummary["coverage"];
      }
      if (payload.budget && typeof payload.budget === "object") {
        budget = payload.budget as RunSummary["budget"];
      }
      if (event.type === "run.failed") {
        failure = {
          code: typeof payload.error === "string" ? payload.error : "runtime_error",
          message: typeof payload.message === "string"
            ? payload.message
            : "The research run failed.",
        };
      }
    }
  }

  const terminal = events.findLast((event) =>
    ["run.completed", "run.failed", "run.aborted"].includes(event.type),
  );
  const status: RunSummary["status"] = terminal?.type === "run.completed"
    ? "completed"
    : terminal?.type === "run.failed" || runtimeStatus === "failed"
      ? "failed"
      : terminal?.type === "run.aborted" || runtimeStatus === "aborted"
        ? "aborted"
        : "running";
  const createdAt = events[0]?.at ?? new Date(0).toISOString();
  return {
    runId,
    ownerUserId: 0,
    status,
    query,
    breadth,
    depth,
    output,
    createdAt,
    ...(completedAt ? { completedAt } : {}),
    lastSequence: events.at(-1)?.sequenceNumber ?? 0,
    learningCount,
    sourceCount,
    evidenceCount,
    warningCount,
    ...(coverage ? { coverage } : {}),
    ...(budget ? { budget } : {}),
    ...(result !== undefined ? { result } : {}),
    ...(failure ? { failure } : {}),
    usage: { inputTokens, outputTokens, totalTokens },
  } as RunSummary;
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<DeepResearchEvent[]> {
  return [...(await readOuterAgentRunView("deep-research", userId, runId, since)).events];
}

export async function getRun(userId: number, runId: string): Promise<RunSummary> {
  try {
    const view = await readOuterAgentRunView("deep-research", userId, runId, 0);
    return { ...summaryFromView(runId, view.events, view.status), ownerUserId: userId };
  } catch (error) {
    if (error instanceof Error && error.message === "run_not_found") {
      throw new DeepResearchError(404, "run_not_found");
    }
    throw error;
  }
}

export async function abortRun(userId: number, runId: string): Promise<RunSummary> {
  try {
    await abortOuterAgentRun("deep-research", userId, runId);
    return await getRun(userId, runId);
  } catch (error) {
    if (error instanceof Error && error.message === "run_not_found") {
      throw new DeepResearchError(404, "run_not_found");
    }
    throw error;
  }
}
