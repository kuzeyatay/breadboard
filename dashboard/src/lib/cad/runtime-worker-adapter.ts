// Parametric CAD's domain-specific disposable-worker adapter.
//
// Both finite operations live behind this one sealed Runtime profile: a model-
// driven design run and an artifact-panel parameter rebuild. Next.js never
// imports this module; the fixed worker wrapper is its only caller.

import { CadServiceError } from "./errors.ts";
import {
  abortRuntimeWorkerRun as abortDesignRun,
  getRuntimeWorkerEventsSince as getDesignEvents,
  isRuntimeWorkerTerminal as isDesignTerminal,
  startRuntimeWorkerRun as startDesignRun,
  type CadRunEvent,
  type StartCadRunInput,
} from "./run-manager.ts";
import {
  applyParameterUpdate,
  type ParameterUpdateResult,
} from "./parameter-action.ts";
import type { CadParameterValue } from "./project-store.ts";
import type { ParametricCadRequest } from "./identity.ts";

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface DesignWorkerRequest {
  operation: "run";
  conversationPublicId: string;
  clientMessageId: string;
  brief: string;
  parsed: ParametricCadRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
}

interface ParameterWorkerRequest {
  operation: "parameter-update";
  conversationPublicId: string;
  projectId: string;
  values: Record<string, CadParameterValue>;
}

export type ParametricCadWorkerRequest = DesignWorkerRequest | ParameterWorkerRequest;

interface ParameterRun {
  readonly runId: string;
  readonly userId: number;
  readonly controller: AbortController;
  readonly createdAt: number;
  status: RunStatus;
  sequence: number;
  events: CadRunEvent[];
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardParametricCadParameterWorkerRuns?: Map<string, ParameterRun>;
};
const parameterRuns =
  globalRuns.__breadboardParametricCadParameterWorkerRuns ?? new Map<string, ParameterRun>();
globalRuns.__breadboardParametricCadParameterWorkerRuns = parameterRuns;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 15 * 60 * 1_000;

function emit(run: ParameterRun, type: string, payload: Record<string, unknown> = {}): void {
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

function schedule(run: ParameterRun): void {
  setTimeout(() => parameterRuns.delete(run.runId), RETENTION_MS).unref?.();
}

function requireParameterRun(userId: number, runId: string): ParameterRun | null {
  const run = parameterRuns.get(runId);
  if (!run) return null;
  if (run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function parameterResultPayload(result: ParameterUpdateResult): Record<string, unknown> {
  return {
    summary: `Revision ${result.revision} was rebuilt and validated.`,
    revision: result.revision,
    artifactId: result.artifactId,
    artifactVersion: result.artifactVersion,
    changed: result.changed,
    status: result.manifest.status,
    validationPassed: result.manifest.validation.passed,
    measurements: result.manifest.measurements,
    issues: result.manifest.validation.issues.filter((issue) => issue.severity !== "info"),
  };
}

function failurePayload(error: unknown): Record<string, unknown> {
  return {
    error: error instanceof Error && error.message.trim()
      ? error.message
      : "The parameter change could not be built.",
    ...(error instanceof CadServiceError ? { code: error.code } : {}),
  };
}

async function driveParameterRun(
  run: ParameterRun,
  request: ParameterWorkerRequest,
): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    operation: request.operation,
    projectId: request.projectId,
  });
  emit(run, "cad.parameter_update.started", { projectId: request.projectId });
  try {
    const result = await applyParameterUpdate({
      userId: run.userId,
      projectId: request.projectId,
      conversationPublicId: request.conversationPublicId,
      values: request.values,
      signal: run.controller.signal,
    });
    if (run.controller.signal.aborted) return;
    run.status = "completed";
    emit(run, "cad.parameter_update.completed", {
      projectId: request.projectId,
      revision: result.revision,
      changed: result.changed,
    });
    emit(run, "run.completed", parameterResultPayload(result));
  } catch (error) {
    if (run.controller.signal.aborted) return;
    run.status = "failed";
    emit(run, "run.failed", failurePayload(error));
  } finally {
    schedule(run);
  }
}

export interface StartParametricCadRuntimeWorkerInput {
  userId: number;
  runtimeJobId: string;
  request: ParametricCadWorkerRequest;
}

export function startRuntimeWorkerRun(
  input: StartParametricCadRuntimeWorkerInput,
): { runId: string; status: RunStatus } {
  if (input.request.operation === "run") {
    const designInput: StartCadRunInput = {
      userId: input.userId,
      runtimeJobId: input.runtimeJobId,
      conversationPublicId: input.request.conversationPublicId,
      ...(input.request.clientMessageId
        ? { clientMessageId: input.request.clientMessageId }
        : {}),
      brief: input.request.brief,
      parsed: input.request.parsed,
      model: input.request.model,
      reasoningEffort: input.request.reasoningEffort,
      baseUrl: input.request.baseUrl,
    };
    return startDesignRun(designInput);
  }
  const existing = parameterRuns.get(input.runtimeJobId);
  if (existing) {
    if (existing.userId !== input.userId) throw new Error("run_not_found");
    return { runId: existing.runId, status: existing.status };
  }
  const run: ParameterRun = {
    runId: input.runtimeJobId,
    userId: input.userId,
    controller: new AbortController(),
    createdAt: Date.now(),
    status: "queued",
    sequence: 0,
    events: [],
  };
  parameterRuns.set(run.runId, run);
  void driveParameterRun(run, input.request);
  return { runId: run.runId, status: run.status };
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): CadRunEvent[] {
  const parameter = requireParameterRun(userId, runId);
  return parameter
    ? parameter.events.filter((event) => event.sequenceNumber > since)
    : getDesignEvents(userId, runId, since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  const parameter = requireParameterRun(userId, runId);
  return parameter
    ? ["completed", "failed", "aborted"].includes(parameter.status)
    : isDesignTerminal(userId, runId);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const parameter = requireParameterRun(userId, runId);
  if (!parameter) return abortDesignRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(parameter.status)) return false;
  parameter.status = "aborted";
  parameter.controller.abort();
  emit(parameter, "run.aborted", { summary: "The CAD parameter rebuild was stopped." });
  schedule(parameter);
  return true;
}
