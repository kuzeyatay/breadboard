// The Max Research run: five agents against one question, one answer out.
//
// Shaped like every other run manager here — an in-memory run, a sequenced
// event log, `startRun` / `getEventsSince` / `isTerminal` / `abortRun` — so the
// existing chat surfaces, run cards and persistence work on it without knowing
// what it is. What is different is what happens in between: it does not do the
// research, it commissions it, waits, and reconciles.
//
// Long by construction. A wave finishes when its slowest member does, and the
// whole point is breadth, so the run is measured in tens of minutes. Everything
// here therefore reports progress continuously: a run that says nothing for
// forty minutes is indistinguishable from one that has died.

import { randomUUID } from "node:crypto";

import { participantRuntime, type ParticipantResult } from "./participants.ts";
import {
  planMaxResearch,
  participantWaves,
  RETRIEVAL_PARTICIPANTS,
  type MaxResearchParticipant,
  type MaxResearchPlan,
} from "./plan.ts";
import { coverageSummary, maxResearchSynthesisPrompt } from "./synthesis.ts";
import {
  maxResearchReviewPrompt,
  reviewedAnswerIsUsable,
} from "./review.ts";

export type MaxResearchStatus =
  | "queued"
  | "planning"
  | "researching"
  | "synthesizing"
  | "completed"
  | "failed"
  | "aborted";

export interface MaxResearchEvent {
  sequenceNumber: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

interface RunState {
  runId: string;
  userId: number;
  question: string;
  plan: MaxResearchPlan | null;
  status: MaxResearchStatus;
  sequence: number;
  events: MaxResearchEvent[];
  results: ParticipantResult[];
  answer: string;
  controller: AbortController;
  createdAt: number;
  updatedAt: number;
}

const runs = new Map<string, RunState>();

/** Runs are held only while a surface might still ask about them. */
const RETENTION_MS = 6 * 60 * 60_000;
const MAX_RUNS = 40;

function evict(): void {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [runId, run] of runs) {
    if (run.updatedAt < cutoff) runs.delete(runId);
  }
  while (runs.size > MAX_RUNS) {
    const oldest = [...runs.entries()].sort(
      ([, left], [, right]) => left.updatedAt - right.updatedAt,
    )[0];
    if (!oldest) break;
    runs.delete(oldest[0]);
  }
}

function emit(
  run: RunState,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  run.sequence += 1;
  run.updatedAt = Date.now();
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    at: new Date().toISOString(),
    payload,
  });
}

export interface StartRunInput {
  userId: number;
  question: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationContext?: string;
  /** Injected by tests so the orchestration can be exercised without services. */
  runtimeFor?: typeof participantRuntime;
  /** Injected by tests. Writes the final answer from the synthesis prompt. */
  synthesize?: (prompt: string) => Promise<string>;
}

export function startRun(input: StartRunInput): {
  runId: string;
  status: MaxResearchStatus;
} {
  evict();
  const question = input.question.trim();
  if (!question) throw new Error("max_research_question_required");

  const runId = `mxrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    question,
    plan: null,
    status: "queued",
    sequence: 0,
    events: [],
    results: [],
    answer: "",
    controller: new AbortController(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  runs.set(runId, run);

  void drive(run, input).catch((error: unknown) => {
    if (run.status === "aborted") return;
    run.status = "failed";
    emit(run, "run.failed", {
      error:
        error instanceof Error ? error.message : "The research run failed.",
    });
  });

  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  const runtimeFor = input.runtimeFor ?? participantRuntime;
  emit(run, "run.started", { question: run.question, model: input.model });

  // --- planning ----------------------------------------------------------
  run.status = "planning";
  emit(run, "plan.started", {});

  // Availability is checked before the plan is fixed, so a participant whose
  // runtime is down is left out of the plan rather than reported as a failure
  // forty minutes later. This is the only place the plan touches the world.
  const candidates = planMaxResearch({ question: run.question });
  const unavailable: MaxResearchParticipant[] = [];
  for (const assignment of candidates.assignments) {
    const state = await runtimeFor(assignment.participant)
      .available()
      .catch(() => ({ available: false, reason: "The runtime is unreachable." }));
    if (!state.available) {
      unavailable.push(assignment.participant);
      emit(run, "participant.unavailable", {
        participant: assignment.participant,
        reason: state.reason ?? "unavailable",
      });
    }
  }

  const plan = planMaxResearch({ question: run.question, unavailable });
  run.plan = plan;
  emit(run, "plan.completed", {
    intent: plan.research.intent,
    participants: plan.assignments.map((assignment) => ({
      participant: assignment.participant,
      rationale: assignment.rationale,
      wave: assignment.wave,
    })),
  });

  if (
    !plan.assignments.some((assignment) =>
      RETRIEVAL_PARTICIPANTS.includes(assignment.participant),
    )
  ) {
    run.status = "failed";
    emit(run, "run.failed", {
      error:
        "No research runtime is available, so there is nothing to gather evidence with.",
    });
    return;
  }

  // --- research ----------------------------------------------------------
  run.status = "researching";
  const waves = participantWaves(plan);
  for (const [index, wave] of waves.entries()) {
    if (run.controller.signal.aborted) return abort(run);
    emit(run, "wave.started", {
      wave: index,
      participants: wave.map((assignment) => assignment.participant),
    });

    const settled = await Promise.all(
      wave.map(async (assignment) => {
        emit(run, "participant.started", {
          participant: assignment.participant,
          rationale: assignment.rationale,
        });
        const result = await runtimeFor(assignment.participant).run(
          {
            question: assignment.question,
            guidance: assignment.guidance,
            brief: assignment.brief,
          },
          {
            userId: run.userId,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            baseUrl: input.baseUrl,
            ...(input.conversationContext
              ? { conversationContext: input.conversationContext }
              : {}),
            signal: run.controller.signal,
          },
        );
        emit(run, "participant.settled", {
          participant: result.participant,
          status: result.status,
          ...(result.runId ? { runId: result.runId } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
          characters: result.output.length,
          ...(result.websites?.length ? { websites: result.websites } : {}),
          ...(result.artifacts?.length ? { artifacts: result.artifacts } : {}),
          ...(result.limitations?.length ? { limitations: result.limitations } : {}),
        });
        return { assignment, result };
      }),
    );

    run.results.push(...settled.map((entry) => entry.result));
    emit(run, "wave.completed", { wave: index });

  }

  if (run.controller.signal.aborted) return abort(run);

  // Nothing fetched anything. Reconciling zero findings would produce prose
  // with no evidence under it, which is worse than saying the run failed.
  if (
    !run.results.some(
      (result) =>
        result.status === "completed" &&
        RETRIEVAL_PARTICIPANTS.includes(result.participant) &&
        result.output.trim(),
    )
  ) {
    run.status = "failed";
    emit(run, "run.failed", {
      error:
        "Every research participant produced nothing, so there is no evidence to reconcile.",
      findings: run.results.map((result) => ({
        participant: result.participant,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      })),
    });
    return;
  }

  // --- synthesis ---------------------------------------------------------
  run.status = "synthesizing";
  const coverage = coverageSummary(run.results);
  emit(run, "synthesis.started", coverage as unknown as Record<string, unknown>);

  const prompt = maxResearchSynthesisPrompt({ plan, results: run.results });
  const synthesize = input.synthesize ?? defaultSynthesizer(input);
  let answer: string;
  try {
    answer = (await synthesize(prompt)).trim();
  } catch (error) {
    // The research all succeeded; only the last model call did not. Losing it
    // here would throw away every agent's work over one transient upstream
    // failure — which a live run did — so the findings stay on the run and
    // travel with the failure, and `resynthesizeRun` can finish the job without
    // commissioning anything again.
    run.status = "failed";
    emit(run, "run.failed", {
      error:
        error instanceof Error
          ? `The findings could not be reconciled: ${error.message}`
          : "The findings could not be reconciled.",
      findingsRetained: true,
      resynthesizable: true,
      findings: run.results.map((result) => ({
        participant: result.participant,
        status: result.status,
        characters: result.output.length,
      })),
    });
    return;
  }

  if (!answer) {
    run.status = "failed";
    emit(run, "run.failed", {
      error: "The reconciliation produced no answer.",
    });
    return;
  }

  // The audit. A separate call, because writing and checking are different
  // jobs and a model doing both at once does the second badly: a live run wrote
  // an excellent answer that never used its literature participant's best find
  // and left its most striking claim uncited. Best-effort — a failed or mangled
  // review leaves the draft standing, which was already written under the whole
  // contract.
  emit(run, "review.started", {});
  let finalAnswer = answer;
  try {
    const reviewed = (
      await synthesize(
        maxResearchReviewPrompt({ plan, results: run.results, draft: answer }),
      )
    ).trim();
    if (reviewedAnswerIsUsable(answer, reviewed)) {
      finalAnswer = reviewed;
      emit(run, "review.completed", {
        revised: reviewed !== answer,
        draftCharacters: answer.length,
        finalCharacters: reviewed.length,
      });
    } else {
      emit(run, "review.skipped", { reason: "The audit returned nothing usable." });
    }
  } catch (error) {
    emit(run, "review.skipped", {
      reason:
        error instanceof Error ? error.message : "The audit could not be run.",
    });
  }

  run.answer = finalAnswer;
  run.status = "completed";
  emit(run, "run.completed", {
    result: finalAnswer,
    ...(coverage as unknown as Record<string, unknown>),
    websites: run.results.flatMap((result) => result.websites ?? []),
    artifacts: run.results.flatMap((result) => result.artifacts ?? []),
    limitations: run.results.flatMap((result) => result.limitations ?? []),
  });
}

function abort(run: RunState): void {
  run.status = "aborted";
  emit(run, "run.aborted", {});
}

/**
 * The default writer.
 *
 * Imported at call time and kept behind a seam so the orchestration above can
 * be tested without a model: the interesting behaviour here is which agents run
 * and how their disagreements survive, none of which needs a completion.
 */
function defaultSynthesizer(
  input: StartRunInput,
): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    const { completeText } = await import("./completion.ts");
    return completeText({
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      prompt,
    });
  };
}

/* ------------------------------------------------------------------ */

function requireRun(userId: number, runId: string): RunState | null {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) return null;
  return run;
}

export function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): MaxResearchEvent[] {
  const run = requireRun(userId, runId);
  if (!run) return [];
  return run.events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (!run) return true;
  return (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "aborted"
  );
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (!run || isTerminal(userId, runId)) return false;
  run.controller.abort();
  abort(run);
  return true;
}

export interface MaxResearchRunSummary {
  runId: string;
  status: MaxResearchStatus;
  question: string;
  participants: MaxResearchParticipant[];
  results: Array<{
    participant: MaxResearchParticipant;
    status: string;
    reason?: string;
  }>;
  answer: string;
  lastSequence: number;
}

export function getRun(
  userId: number,
  runId: string,
): MaxResearchRunSummary | null {
  const run = requireRun(userId, runId);
  if (!run) return null;
  return {
    runId: run.runId,
    status: run.status,
    question: run.question,
    participants:
      run.plan?.assignments.map((assignment) => assignment.participant) ?? [],
    results: run.results.map((result) => ({
      participant: result.participant,
      status: result.status,
      ...(result.reason ? { reason: result.reason } : {}),
    })),
    answer: run.answer,
    lastSequence: run.sequence,
  };
}

/**
 * Reconcile a run's existing findings again, without re-running anything.
 *
 * The expensive half of a Max Research run is the five agents; the cheap half
 * is the single call that reconciles them. When only the cheap half fails there
 * is no reason to repeat the expensive one, and every reason not to.
 */
export async function resynthesizeRun(input: {
  userId: number;
  runId: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  synthesize?: (prompt: string) => Promise<string>;
}): Promise<{ status: MaxResearchStatus; answer: string }> {
  const run = requireRun(input.userId, input.runId);
  if (!run) throw new Error("run_not_found");
  if (!run.plan || !run.results.length) throw new Error("run_has_no_findings");

  run.status = "synthesizing";
  emit(run, "synthesis.started", {
    ...(coverageSummary(run.results) as unknown as Record<string, unknown>),
    retry: true,
  });

  const prompt = maxResearchSynthesisPrompt({
    plan: run.plan,
    results: run.results,
  });
  const synthesize =
    input.synthesize ??
    defaultSynthesizer({
      userId: input.userId,
      question: run.question,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
    });

  try {
    const answer = (await synthesize(prompt)).trim();
    if (!answer) throw new Error("The reconciliation produced no answer.");
    run.answer = answer;
    run.status = "completed";
    emit(run, "run.completed", {
      result: answer,
      ...(coverageSummary(run.results) as unknown as Record<string, unknown>),
    });
    return { status: run.status, answer };
  } catch (error) {
    run.status = "failed";
    emit(run, "run.failed", {
      error:
        error instanceof Error
          ? `The findings could not be reconciled: ${error.message}`
          : "The findings could not be reconciled.",
      findingsRetained: true,
      resynthesizable: true,
    });
    return { status: run.status, answer: "" };
  }
}

/** Test seam: forget every run so one case cannot leak into the next. */
export function resetMaxResearchRuns(): void {
  runs.clear();
}
