import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import { matraixCatalog, reconcileDimensions, reconcileFilters } from "./catalog.ts";
import { designStudy, MatraixDesignError } from "./design.ts";
import {
  MATRAIX_MAX_RESPONDENTS,
  describeMatraixCohort,
  type MatraixRequest,
} from "./identity.ts";
import { MATRAIX_DEV_POOL, matraixAvailability, matraixEnv } from "./runtime.ts";
import type { StudyDraft } from "./schemas.ts";
import {
  createWorkspace,
  readStudyMarkdown,
  scanArtifacts,
  specPath,
  runDirectory,
  type MatraixArtifact,
} from "./workspace.ts";

export interface MatraixEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface MatraixTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  request: MatraixRequest;
  status: RunStatus;
  sequence: number;
  events: MatraixEvent[];
  child: ChildProcess | null;
  design: AbortController;
  stderr: string;
  startedAt: number;
  artifacts: MatraixArtifact[];
  summary: string;
  error: string;
  terminalResult?: MatraixTerminalResult;
  terminalHandler?: (result: MatraixTerminalResult) => void;
}

const stateGlobal = globalThis as typeof globalThis & {
  __breadboardMatraixRuns?: Map<string, RunState>;
};
const runs = stateGlobal.__breadboardMatraixRuns ?? new Map<string, RunState>();
stateGlobal.__breadboardMatraixRuns = runs;

/** Long enough to outlast a tab switch during a study that takes minutes. */
const RETENTION_MS = 6 * 60 * 60_000;
/** A whole study on 60 personas is many sequential model calls. */
const RUN_TIMEOUT_MS = 3 * 60 * 60_000;
const MAX_MESSAGE_CHARS = 16_000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.events.push({
    sequenceNumber: ++run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > 4_000) run.events.splice(0, run.events.length - 4_000);
}

function publish(run: RunState, result: MatraixTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // Transcript persistence stays retryable; the run itself is finished.
  }
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

/**
 * Whether the person has stopped this run.
 *
 * A free function rather than an inline comparison: the design step assigns
 * `status` before it awaits, so control-flow analysis inside that closure would
 * narrow the property to the value it was last given and call every later check
 * unreachable — while `abortRun`, which is what actually changes it, runs from
 * a different call entirely.
 */
function isAborted(run: RunState): boolean {
  return run.status === "aborted";
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function refreshArtifacts(run: RunState): void {
  const next = scanArtifacts(run.runId);
  const current = new Map(run.artifacts.map((item) => [item.id, item.modifiedAt]));
  if (
    next.length === run.artifacts.length &&
    next.every((item) => current.get(item.id) === item.modifiedAt)
  ) {
    return;
  }
  run.artifacts = next;
  emit(run, "artifacts.updated", { artifacts: next });
}

function fail(run: RunState, error: string): void {
  if (isAborted(run) || run.terminalResult) return;
  run.status = "failed";
  run.error = error;
  refreshArtifacts(run);
  emit(run, "run.failed", { error, artifacts: run.artifacts });
  publish(run, { outcome: "failed", content: error });
}

/**
 * Stratification asks for at least one respondent per combination of values, so
 * a request can be arithmetically impossible before it reaches the clone —
 * which raises rather than sampling fewer. The number of respondents is the
 * part of the request a person is least attached to, so it is raised to fit and
 * the change is reported; when even the ceiling is not enough, the stratifying
 * is dropped instead, and that is reported too.
 */
function reconcileStratification(
  study: { stratify: string[] },
  request: MatraixRequest,
  catalog: ReturnType<typeof matraixCatalog>,
): { respondents: number; stratify: string[]; notes: string[] } {
  const notes: string[] = [];
  if (!catalog || !study.stratify.length) {
    return { respondents: request.respondents, stratify: study.stratify, notes };
  }
  const byId = new Map(catalog.dimensions.map((dimension) => [dimension.id, dimension]));
  let cells = 1;
  for (const dimension of study.stratify) {
    const known = byId.get(dimension);
    if (!known) continue;
    const allowed = request.filters[dimension];
    cells *= allowed?.length || known.values.length;
  }
  if (cells <= request.respondents) {
    return { respondents: request.respondents, stratify: study.stratify, notes };
  }
  if (cells <= MATRAIX_MAX_RESPONDENTS) {
    notes.push(
      `Sampling evenly across ${study.stratify.join(" and ")} needs ${cells} respondents, `
        + `so the study runs ${cells} rather than ${request.respondents}.`,
    );
    return { respondents: cells, stratify: study.stratify, notes };
  }
  notes.push(
    `Sampling evenly across ${study.stratify.join(" and ")} would need ${cells} respondents, `
      + `past the ${MATRAIX_MAX_RESPONDENTS} ceiling, so the cohort is sampled at random instead.`,
  );
  return { respondents: request.respondents, stratify: [], notes };
}

function specFor(input: {
  runId: string;
  study: StudyDraft;
  request: MatraixRequest;
  pool: string;
  respondents: number;
  stratify: string[];
  filters: Record<string, string[]>;
  groupBy: string[];
  personaModel: string;
}): Record<string, unknown> {
  return {
    // Namespaced so it can never collide with a questionnaire id the clone
    // ships, which would make the prompt builder read that task's text instead.
    instrumentId: `bb_${input.runId.replace("mxrun_", "").slice(0, 24)}`,
    title: input.study.title,
    description: input.study.context,
    askRationale: input.study.askRationale,
    askConfidence: false,
    questions: input.study.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      construct: question.construct,
      required: question.required,
      options: question.options,
      ...(question.type === "likert"
        ? { minValue: question.minValue ?? 1, maxValue: question.maxValue ?? 5 }
        : {}),
    })),
    cohort: {
      pool: input.pool,
      sampleSize: input.respondents,
      seed: input.request.seed,
      sources: input.request.sources,
      filters: input.filters,
      stratify: input.stratify,
      allocation: input.request.allocation,
    },
    groupBy: input.groupBy,
    model: input.personaModel,
    maxCostUsd: null,
  };
}

function ingest(run: RunState, value: Record<string, unknown>): void {
  const event = typeof value.event === "string" ? value.event : "";
  if (!event) return;
  if (event === "run.started") {
    emit(run, "stage.changed", { stage: "sampling" });
    emit(run, "study.ready", {
      title: value.title,
      questions: value.questions,
      pool: value.pool,
      model: value.model,
    });
    return;
  }
  if (event === "cohort.sampled") {
    emit(run, "stage.changed", { stage: "answering" });
    emit(run, "cohort.sampled", {
      sampleSize: value.sampleSize,
      matchedCount: value.matchedCount,
      seed: value.seed,
      pool: value.pool,
      stratify: value.stratify,
      personas: value.personas,
    });
    return;
  }
  if (event === "trial.started" || event === "trial.completed" || event === "trial.failed") {
    emit(run, event, value);
    return;
  }
  if (event === "run.completed") {
    emit(run, "stage.changed", { stage: "reporting" });
    run.summary = typeof value.summary === "string" ? value.summary : "";
    emit(run, "study.summary", {
      completed: value.completed,
      failed: value.failed,
      headline: value.headline,
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      costUsd: value.costUsd,
      priced: value.priced,
    });
    return;
  }
  if (event === "run.failed") {
    run.error = typeof value.error === "string" ? value.error : "";
  }
}

function finish(run: RunState, code: number | null): void {
  if (isAborted(run) || run.terminalResult) return;
  refreshArtifacts(run);
  const elapsedSec = (Date.now() - run.startedAt) / 1_000;
  if (code === 0) {
    const report = readStudyMarkdown(run.runId);
    const content = report
      ? report.length > MAX_MESSAGE_CHARS
        ? `${report.slice(0, MAX_MESSAGE_CHARS)}\n\n_The full report is in study.md below._`
        : report
      : run.summary || "The study finished.";
    run.status = "completed";
    // The report travels on the event as well as in the terminal result, so a
    // card that watched the run live shows the same thing a reloaded one does.
    emit(run, "run.completed", {
      summary: run.summary,
      report: content,
      elapsedSec,
      artifacts: run.artifacts,
    });
    publish(run, { outcome: "completed", content });
    return;
  }
  fail(
    run,
    run.error ||
      run.stderr.trim().split(/\r?\n/).at(-1) ||
      `MatrAIx exited with ${code ?? "an unknown status"}.`,
  );
}

function spawnBridge(run: RunState, input: { baseUrl: string; apiKey: string }): void {
  const runtime = matraixAvailability();
  if (!runtime.available || !runtime.root || !runtime.python) {
    fail(run, runtime.reason ?? "MatrAIx is unavailable.");
    return;
  }
  const child = spawn(
    runtime.python,
    [
      runtime.bridge,
      "--root",
      runtime.root,
      "--run",
      "--workspace",
      runDirectory(run.runId),
      "--spec",
      specPath(run.runId),
    ],
    {
      cwd: runtime.root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: matraixEnv(input),
    },
  );
  run.child = child;

  const timer = setTimeout(() => {
    if (run.child) {
      run.error = "The study ran past its time limit and was stopped.";
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  let stdout = "";
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        ingest(run, JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Not protocol output; the bridge keeps diagnostics on stderr.
      }
    }
    refreshArtifacts(run);
  });
  child.stderr!.on("data", (chunk: string) => {
    run.stderr = `${run.stderr}${chunk}`.slice(-48_000);
    const line = chunk.trim().split(/\r?\n/).at(-1);
    if (line) emit(run, "log", { text: line.slice(0, 1_000) });
  });
  child.on("error", (error) => {
    clearTimeout(timer);
    run.child = null;
    fail(run, error.message);
  });
  child.on("exit", (code) => {
    clearTimeout(timer);
    run.child = null;
    finish(run, code);
  });
}

export function startRun(input: {
  userId: number;
  brief: string;
  request: MatraixRequest;
  /** The model the person has selected in chat: it designs the study and answers it. */
  model: string;
  reasoningEffort?: string;
  baseUrl: string;
  apiKey: string;
  conversationContext?: string;
}): { runId: string; status: RunStatus } {
  const runtime = matraixAvailability();
  if (!runtime.available || !runtime.root || !runtime.python) {
    throw new Error(runtime.reason ?? "MatrAIx is unavailable.");
  }
  if (!input.request.brief) throw new Error("empty_brief");

  const runId = `mxrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.brief,
    request: input.request,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    design: new AbortController(),
    stderr: "",
    startedAt: Date.now(),
    artifacts: [],
    summary: "",
    error: "",
  };
  runs.set(runId, run);
  createWorkspace({
    runId,
    userId: input.userId,
    brief: input.brief.slice(0, 20_000),
    createdAt: new Date().toISOString(),
  });

  run.status = "running";
  emit(run, "run.queued", { cohort: describeMatraixCohort(input.request) });
  emit(run, "stage.changed", { stage: "designing" });

  void (async () => {
    try {
      const pool = input.request.pool ?? MATRAIX_DEV_POOL;
      const catalog = matraixCatalog(pool);
      if (!catalog) {
        fail(run, "The persona pool could not be read, so no cohort could be chosen.");
        return;
      }
      emit(run, "pool.read", {
        pool: catalog.pool,
        personas: catalog.count,
        dimensions: catalog.dimensionCount,
      });

      const study = await designStudy({
        target: {
          baseUrl: input.baseUrl,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          signal: run.design.signal,
        },
        catalog,
        request: input.request,
        // The chat this was launched from, so "ask them about the pricing we
        // just discussed" resolves instead of arriving as a bare fragment.
        conversationContext: input.conversationContext,
      });
      if (isAborted(run)) return;

      // What the person typed outranks what the model proposed, then both are
      // reduced to what the pool can actually satisfy.
      const requestedFilters = Object.keys(input.request.filters).length
        ? input.request.filters
        : study.filters;
      const filters = reconcileFilters(catalog, requestedFilters);
      const stratifyRaw = input.request.stratify.length ? input.request.stratify : study.stratify;
      const stratify = reconcileDimensions(catalog, stratifyRaw);
      const groupBy = reconcileDimensions(
        catalog,
        input.request.groupBy.length ? input.request.groupBy : study.groupBy,
      );
      const adjusted = reconcileStratification(
        { stratify: stratify.dimensions },
        { ...input.request, filters: filters.filters },
        catalog,
      );
      const notes = [
        ...filters.dropped,
        ...stratify.dropped,
        ...groupBy.dropped,
        ...adjusted.notes,
      ];
      if (notes.length) emit(run, "cohort.adjusted", { notes });

      emit(run, "study.designed", {
        title: study.title,
        questions: study.questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          type: question.type,
          options: question.options.length,
        })),
        cohortRationale: study.cohortRationale,
        filters: filters.filters,
        stratify: adjusted.stratify,
        groupBy: groupBy.dimensions,
        respondents: adjusted.respondents,
      });

      fs.writeFileSync(
        specPath(runId),
        `${JSON.stringify(
          specFor({
            runId,
            study,
            request: input.request,
            pool: catalog.pool,
            respondents: adjusted.respondents,
            stratify: adjusted.stratify,
            filters: filters.filters,
            groupBy: groupBy.dimensions,
            // The clone's client reads an `openai/` prefix as "an
            // OpenAI-compatible endpoint from the environment", which is what
            // ChatMock is. Without it a bare id is treated as an Anthropic
            // model and the run asks api.anthropic.com for a key nobody set.
            personaModel: `openai/${input.model}`,
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );
      if (isAborted(run)) return;
      spawnBridge(run, { baseUrl: input.baseUrl, apiKey: input.apiKey });
    } catch (error) {
      if (isAborted(run)) return;
      fail(
        run,
        error instanceof MatraixDesignError
          ? error.message
          : error instanceof Error
            ? error.message
            : "The study could not be designed.",
      );
    }
  })();

  return { runId, status: run.status };
}

export function getEventsSince(userId: number, runId: string, since = 0): MatraixEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function liveArtifacts(userId: number, runId: string): MatraixArtifact[] | null {
  const run = runs.get(runId);
  return run?.userId === userId ? run.artifacts : null;
}

export function setRunTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: MatraixTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  run.design.abort();
  try {
    run.child?.kill();
  } catch {
    // Already exited.
  }
  run.child = null;
  refreshArtifacts(run);
  const summary = "The MatrAIx study was stopped.";
  emit(run, "run.aborted", { summary, artifacts: run.artifacts });
  publish(run, { outcome: "aborted", content: summary });
  return true;
}
