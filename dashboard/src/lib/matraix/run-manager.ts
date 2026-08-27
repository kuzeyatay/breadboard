import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { matraixCatalog, reconcileDimensions, reconcileFilters } from "./catalog.ts";
import { designStudy, MatraixDesignError } from "./design.ts";
import {
  MATRAIX_MAX_RESPONDENTS,
  describeMatraixCohort,
  type MatraixRequest,
} from "./identity.ts";
import { MATRAIX_DEV_POOL, matraixAvailability } from "./runtime.ts";
import type { StudyDraft } from "./schemas.ts";
import {
  readStudyMarkdownFrom,
  scanMatraixArtifacts,
  type MatraixArtifact,
} from "./workspace.ts";

export interface MatraixEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  request: MatraixRequest;
  workspaceRoot: string;
  outputRoot: string;
  specFile: string;
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
}

const stateGlobal = globalThis as typeof globalThis & {
  __breadboardMatraixRuns?: Map<string, RunState>;
};
const runs = stateGlobal.__breadboardMatraixRuns ?? new Map<string, RunState>();
stateGlobal.__breadboardMatraixRuns = runs;

/** A whole study on 60 personas is many sequential model calls. */
const RUN_TIMEOUT_MS = 3 * 60 * 60_000;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_EVENTS = 5_000;
const MAX_STDOUT_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const RUNTIME_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const TERMINAL_STATUSES = new Set<RunStatus>(["completed", "failed", "aborted"]);

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function directWorkspace(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  try {
    const metadata = fs.lstatSync(resolved);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(resolved), resolved)
    ) return null;
    return resolved;
  } catch {
    return null;
  }
}

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.events.push({
    sequenceNumber: ++run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

/**
 * Whether the person has stopped this run.
 *
 * A free function rather than an inline comparison: the design step assigns
 * `status` before it awaits, so control-flow analysis inside that closure would
 * narrow the property to the value it was last given and call every later check
 * unreachable — while `abortRuntimeWorkerRun`, which is what actually changes it, runs from
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
  const next = scanMatraixArtifacts(run.outputRoot);
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
  if (TERMINAL_STATUSES.has(run.status)) return;
  run.status = "failed";
  run.error = error.slice(0, 8_000);
  refreshArtifacts(run);
  emit(run, "run.failed", { error: run.error, artifacts: run.artifacts });
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
  if (TERMINAL_STATUSES.has(run.status)) return;
  refreshArtifacts(run);
  const elapsedSec = (Date.now() - run.startedAt) / 1_000;
  if (code === 0) {
    const report = readStudyMarkdownFrom(run.outputRoot);
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
    return;
  }
  fail(
    run,
    run.error ||
      run.stderr.trim().split(/\r?\n/).at(-1) ||
      `MatrAIx exited with ${code ?? "an unknown status"}.`,
  );
}

const PASSTHROUGH_ENV = [
  "SystemRoot",
  "WINDIR",
  "SystemDrive",
  "PATH",
  "PATHEXT",
  "ComSpec",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "LANG",
  "LC_ALL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
] as const;

function boundedAppend(current: string, chunk: string, maximumBytes: number): string {
  const remaining = maximumBytes - Buffer.byteLength(current, "utf8");
  if (remaining <= 0) return current;
  return current + Buffer.from(chunk, "utf8")
    .subarray(0, remaining)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

function bridgeEnvironment(
  run: RunState,
  input: { baseUrl: string },
  root: string,
): NodeJS.ProcessEnv {
  const home = path.join(run.workspaceRoot, ".runtime-home");
  const temporary = path.join(run.workspaceRoot, ".runtime-temp");
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  for (const directory of [home, temporary, appData, localAppData]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    MATRAIX_ROOT: root,
    OPENAI_BASE_URL: input.baseUrl,
    OPENAI_API_BASE: input.baseUrl,
    OPENAI_API_KEY: process.env.CHATMOCK_API_KEY?.trim() || "local",
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    TEMP: temporary,
    TMP: temporary,
  };
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function spawnBridge(run: RunState, input: { baseUrl: string }): void {
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
      run.workspaceRoot,
      "--spec",
      run.specFile,
    ],
    {
      cwd: runtime.root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: bridgeEnvironment(run, input, runtime.root),
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
    if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(chunk, "utf8") > MAX_STDOUT_RECORD_BYTES) {
      stdout = "";
      fail(run, "MatrAIx emitted an oversized event.");
      try {
        child.kill();
      } catch {
        // Runtime remains the final process-tree authority.
      }
      return;
    }
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
    run.stderr = boundedAppend(run.stderr, chunk, MAX_STDERR_BYTES);
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

export function startRuntimeWorkerRun(input: {
  userId: number;
  runtimeJobId: string;
  runtimeWorkspacePath: string;
  request: MatraixRequest;
  /** The model the person has selected in chat: it designs the study and answers it. */
  model: string;
  reasoningEffort?: string;
  baseUrl: string;
  conversationContext?: string;
}): { runId: string; status: RunStatus } {
  const runtime = matraixAvailability();
  if (!runtime.available || !runtime.root || !runtime.python) {
    throw new Error(runtime.reason ?? "MatrAIx is unavailable.");
  }
  if (!input.request.brief) throw new Error("empty_brief");
  if (!RUNTIME_JOB_ID.test(input.runtimeJobId) || runs.has(input.runtimeJobId)) {
    throw new Error("MatrAIx Runtime identity is invalid.");
  }
  const workspaceRoot = directWorkspace(input.runtimeWorkspacePath);
  if (!workspaceRoot) throw new Error("MatrAIx Runtime workspace is invalid.");
  const outputRoot = path.join(workspaceRoot, "output");
  fs.mkdirSync(outputRoot, { recursive: false });
  const runId = input.runtimeJobId;
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    workspaceRoot,
    outputRoot,
    specFile: path.join(workspaceRoot, "spec.json"),
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
        run.specFile,
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
      spawnBridge(run, { baseUrl: input.baseUrl });
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

export function getRuntimeWorkerEventsSince(userId: number, runId: string, since = 0): MatraixEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return TERMINAL_STATUSES.has(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (TERMINAL_STATUSES.has(run.status)) return false;
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
  return true;
}
