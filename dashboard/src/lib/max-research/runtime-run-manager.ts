// Durable dashboard facade for Max Research.
//
// The coordinator's maps, participant outputs, model calls and cancellation
// controllers live only inside one fresh Runtime V2 worker. Next retains only
// authenticated Runtime correlation and reconstructs the legacy public view
// from the worker's bounded durable event projection.

import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import type {
  MaxResearchRunSummary,
  MaxResearchStatus,
  StartRunInput,
} from "./run-manager.ts";
import type { MaxResearchParticipant } from "./plan.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { ASSISTANT_REASONING_EFFORTS } from "../assistant-reasoning.ts";
import { runtimeAvailability as openscienceRuntimeAvailability } from "../openscience/runtime.ts";
import { prepareService as prepareOpenscienceService } from "../openscience/service-profile.ts";

export type MaxResearchEvent = OuterAgentEvent;

const PARTICIPANTS = new Set<MaxResearchParticipant>([
  "deep_research",
  "agent_reach",
  "get_doc",
  "openscience",
  "aris",
]);

function participant(value: unknown): MaxResearchParticipant | null {
  return typeof value === "string" && PARTICIPANTS.has(value as MaxResearchParticipant)
    ? (value as MaxResearchParticipant)
    : null;
}

function detailedStatus(
  events: readonly OuterAgentEvent[],
  fallback: OuterAgentRunStatus | null,
): MaxResearchStatus {
  let status: MaxResearchStatus = fallback === "failed" || fallback === "aborted" ||
      fallback === "completed"
    ? fallback
    : "queued";
  for (const event of events) {
    if (event.type === "run.completed") status = "completed";
    else if (event.type === "run.failed") status = "failed";
    else if (event.type === "run.aborted") status = "aborted";
    else if (event.type.startsWith("synthesis.") || event.type.startsWith("review.")) {
      status = "synthesizing";
    } else if (
      event.type.startsWith("wave.") ||
      event.type.startsWith("participant.")
    ) {
      status = "researching";
    } else if (event.type === "run.started" || event.type.startsWith("plan.")) {
      status = "planning";
    }
  }
  return status;
}

function summaryFromEvents(
  runId: string,
  events: readonly OuterAgentEvent[],
  runtimeStatus: OuterAgentRunStatus | null,
): MaxResearchRunSummary {
  let question = "";
  let answer = "";
  let participants: MaxResearchParticipant[] = [];
  const results: MaxResearchRunSummary["results"] = [];
  let pendingWave: MaxResearchRunSummary["results"] = [];

  for (const event of events) {
    if (event.type === "run.started" && typeof event.payload.question === "string") {
      question = event.payload.question;
    }
    if (event.type === "plan.completed" && Array.isArray(event.payload.participants)) {
      participants = event.payload.participants
        .map((entry) =>
          entry && typeof entry === "object"
            ? participant((entry as Record<string, unknown>).participant)
            : null,
        )
        .filter((value): value is MaxResearchParticipant => value !== null);
    }
    if (event.type === "wave.started") pendingWave = [];
    if (event.type === "participant.settled") {
      const id = participant(event.payload.participant);
      if (id && typeof event.payload.status === "string") {
        pendingWave.push({
          participant: id,
          status: event.payload.status,
          ...(typeof event.payload.reason === "string"
            ? { reason: event.payload.reason }
            : {}),
        });
      }
    }
    // The worker manager publishes a wave into its public result collection
    // only after every participant in that wave has settled. Preserve that
    // visibility barrier instead of exposing partial wave state from events.
    if (event.type === "wave.completed") {
      results.push(...pendingWave);
      pendingWave = [];
    }
    if (event.type === "run.completed" && typeof event.payload.result === "string") {
      answer = event.payload.result;
    }
  }

  return {
    runId,
    status: detailedStatus(events, runtimeStatus),
    question,
    participants,
    results,
    answer,
    lastSequence: events.at(-1)?.sequenceNumber ?? 0,
  };
}

/**
 * The worker's canonical request allows this many characters of question;
 * the route truncates to it and the worker refuses anything longer. An
 * `agent_launch` brief runs to ~3.5k characters, so the old 4k ceiling was
 * one paragraph away from a crashed worker.
 */
export const MAX_RESEARCH_QUESTION_MAX_CHARS = 8_000;

/** Submit one sealed coordinator job; there is deliberately no local fallback. */
export async function startRun(
  input: Omit<StartRunInput, "runtimeFor" | "synthesize"> & { requestId?: string },
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  // The worker validates the sealed request at startup and aborts on the first
  // mismatch, which Runtime reports only as a worker that exited. Refuse here,
  // with a reason, anything the worker would refuse.
  if (!(ASSISTANT_REASONING_EFFORTS as readonly string[]).includes(input.reasoningEffort)) {
    throw new Error(
      `Max Research cannot run at reasoning effort "${input.reasoningEffort}".`,
    );
  }
  if (input.question.trim().length > MAX_RESEARCH_QUESTION_MAX_CHARS) {
    throw new Error(
      `The Max Research question is longer than ${MAX_RESEARCH_QUESTION_MAX_CHARS} characters.`,
    );
  }
  // OpenScience is an optional participant. Seal its locally observed
  // availability into the request so Registry can decide whether this job
  // needs the service before admitting the worker. Requiring the service
  // unconditionally made Max Research fail before Get Doc or ARIS could run on
  // machines where OpenScience had never been installed.
  const openscienceEnabled = openscienceRuntimeAvailability().available;
  if (openscienceEnabled) {
    // Prepare its private provider profile while the authenticated facade
    // still owns the ChatMock capability; the worker receives only the
    // Runtime-injected OpenScience loopback endpoint and token.
    await prepareOpenscienceService({
      baseUrl: input.baseUrl,
      apiKey: chatmockApiKeyValue(),
      model: input.model,
    });
  }
  return startOuterAgentRun({
    kind: "max-research",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      question: input.question,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
      openscienceEnabled,
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<MaxResearchEvent[]> {
  try {
    return [...(await readOuterAgentRunView("max-research", userId, runId, since)).events];
  } catch (error) {
    if (error instanceof Error && error.message === "run_not_found") return [];
    throw error;
  }
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  try {
    return (await readOuterAgentRunView("max-research", userId, runId, 0)).terminal;
  } catch (error) {
    if (error instanceof Error && error.message === "run_not_found") return true;
    throw error;
  }
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  try {
    return await abortOuterAgentRun("max-research", userId, runId);
  } catch (error) {
    if (error instanceof Error && error.message === "run_not_found") return false;
    throw error;
  }
}

export async function getRun(
  userId: number,
  runId: string,
): Promise<MaxResearchRunSummary | null> {
  try {
    const view = await readOuterAgentRunView("max-research", userId, runId, 0);
    return summaryFromEvents(runId, view.events, view.status);
  } catch (error) {
    if (error instanceof Error && error.message === "run_not_found") return null;
    throw error;
  }
}
