// Loopback run service for the Deep Research agent.
//
// Breadboard's dashboard is the control plane: it authenticates the user, owns
// the run history it shows, and proxies to this service over loopback with a
// shared bearer secret. This process only runs research and reports progress.
//
// Run snapshots are kept locally so completed reports and their event streams
// survive a sidecar restart. No hosted database or additional credential is
// needed. In-flight work cannot be resumed safely; recovery marks it failed
// with an explicit service_restarted reason instead of pretending it completed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LanguageModelUsage } from 'ai';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';

import { getModelInfo } from './ai/providers';
import { searchBackend as activeSearchBackend } from './ai/search';
import {
  deepResearch,
  DefaultResearchBreadth,
  DefaultResearchDepth,
  writeFinalAnswer,
  writeFinalReport,
  type ResearchProgress,
} from './deep-research';
import type {
  ResearchBudgetUsage,
  ResearchCoverage,
  ResearchEvidence,
  ResearchSource,
  ResearchWarning,
} from './research-types';

const app = express();
const host = process.env.DEEP_RESEARCH_HOST || '127.0.0.1';
const port = Number(process.env.DEEP_RESEARCH_PORT || process.env.PORT) || 7722;
const secret = (process.env.DEEP_RESEARCH_SECRET || '').trim();
const maxConcurrentRuns =
  Number(process.env.DEEP_RESEARCH_MAX_CONCURRENT_RUNS) || 2;
const runRetentionMs =
  Number(process.env.DEEP_RESEARCH_RUN_RETENTION_MS) || 60 * 60 * 1000;
const maxEventsPerRun = Math.max(
  100,
  Math.min(
    10_000,
    Number(process.env.DEEP_RESEARCH_MAX_EVENTS_PER_RUN) || 2_000,
  ),
);
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const stateDirectory = path.resolve(
  process.env.DEEP_RESEARCH_STATE_DIR?.trim() ||
    path.join(repositoryRoot, '.runtime', 'deep-research'),
);

const MAX_QUERY_LENGTH = 4000;
const MAX_USER_CONTEXT_LENGTH = 2000;
const MAX_BREADTH = 10;
const MAX_DEPTH = 5;
const VERSION = '1.1.0';
const STATE_SCHEMA_VERSION = 1;

type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';
type Output = 'report' | 'answer';

export interface RunEvent {
  sequenceNumber: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface Run {
  runId: string;
  ownerUserId: number;
  query: string;
  /**
   * Background about the requester, supplied by Breadboard and carried into
   * every system prompt of the run. It is not part of the research question:
   * `summarize` never returns it, so it cannot reach the browser or a report.
   */
  userContext: string;
  breadth: number;
  depth: number;
  output: Output;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  events: RunEvent[];
  sequence: number;
  aborted: boolean;
  learnings: string[];
  visitedUrls: string[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  warnings: ResearchWarning[];
  coverage?: ResearchCoverage;
  budget?: ResearchBudgetUsage;
  result?: string;
  usage: LanguageModelUsage;
  failure?: { code: string; message: string };
}

const runs = new Map<string, Run>();
const controllers = new Map<string, AbortController>();

type PersistedRun = Omit<Run, 'userContext'> & {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
};

/**
 * Dependency-free, per-run snapshots. Each replacement is written beside the
 * destination and atomically renamed, so a crash leaves either the previous
 * complete snapshot or the next complete snapshot, never half a JSON file.
 */
export class DurableRunStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  private ensureDirectory(): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  private filename(runId: string): string {
    if (!/^[\w-]{1,64}$/.test(runId)) throw new Error('invalid_run_id');
    return path.join(this.directory, `${runId}.json`);
  }

  persist(run: Run): void {
    this.ensureDirectory();
    const destination = this.filename(run.runId);
    const temporary = path.join(
      this.directory,
      `.${run.runId}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    const { userContext: _privateContext, ...safeRun } = run;
    const snapshot: PersistedRun = {
      schemaVersion: STATE_SCHEMA_VERSION,
      ...safeRun,
    };
    try {
      fs.writeFileSync(temporary, JSON.stringify(snapshot), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(temporary, destination);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch (error: unknown) {
        if (!isMissingFileError(error)) throw error;
      }
    }
  }

  load(): unknown[] {
    this.ensureDirectory();
    const snapshots: unknown[] = [];
    for (const entry of fs.readdirSync(this.directory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/^[\w-]{1,64}\.json$/.test(entry.name)) continue;
      try {
        snapshots.push(
          JSON.parse(
            fs.readFileSync(path.join(this.directory, entry.name), 'utf8'),
          ),
        );
      } catch (error: unknown) {
        log(
          `[deep-research] ignoring unreadable run snapshot ${entry.name}`,
          error,
        );
      }
    }
    return snapshots;
  }

  remove(runId: string): void {
    try {
      fs.unlinkSync(this.filename(runId));
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
    }
  }
}

const runStore = new DurableRunStore(stateDirectory);
let stateInitialized = false;
let persistenceHealthy = true;

function log(...args: unknown[]) {
  console.log(...args);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function records<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : [];
}

function restoredUsage(value: unknown): LanguageModelUsage {
  const usage = isRecord(value) ? value : {};
  return {
    promptTokens: Number(usage.promptTokens) || 0,
    completionTokens: Number(usage.completionTokens) || 0,
    totalTokens: Number(usage.totalTokens) || 0,
  };
}

/** Strict enough to keep corrupt or hand-edited state from entering the API. */
export function restoreRunSnapshot(value: unknown): Run | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) return null;
  if (typeof value.runId !== 'string' || !/^[\w-]{1,64}$/.test(value.runId)) {
    return null;
  }
  const ownerUserId = Number(value.ownerUserId);
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) return null;
  if (typeof value.query !== 'string' || !value.query) return null;
  if (
    !['running', 'completed', 'failed', 'aborted'].includes(
      String(value.status),
    )
  ) {
    return null;
  }

  const rawEvents = Array.isArray(value.events) ? value.events : [];
  const events = rawEvents
    .filter(
      (event): event is Record<string, unknown> =>
        isRecord(event) &&
        Number.isInteger(Number(event.sequenceNumber)) &&
        Number(event.sequenceNumber) > 0 &&
        typeof event.type === 'string' &&
        typeof event.at === 'string' &&
        isRecord(event.payload),
    )
    .map(event => ({
      sequenceNumber: Number(event.sequenceNumber),
      type: String(event.type),
      at: String(event.at),
      payload: event.payload as Record<string, unknown>,
    }))
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .slice(-maxEventsPerRun);
  const lastEventSequence = events.at(-1)?.sequenceNumber ?? 0;
  const sequence = Math.max(lastEventSequence, Number(value.sequence) || 0);
  const failure = isRecord(value.failure)
    ? {
        code: String(value.failure.code || 'engine_error'),
        message: String(value.failure.message || 'Research failed.'),
      }
    : undefined;

  return {
    runId: value.runId,
    ownerUserId,
    query: value.query,
    // Requester context is deliberately never written to disk. Recovered work
    // is terminal, so it is neither needed nor silently replayed.
    userContext: '',
    breadth: Number(value.breadth) || 1,
    depth: Number(value.depth) || 1,
    output: value.output === 'answer' ? 'answer' : 'report',
    status: String(value.status) as RunStatus,
    createdAt:
      typeof value.createdAt === 'string'
        ? value.createdAt
        : new Date().toISOString(),
    ...(typeof value.completedAt === 'string'
      ? { completedAt: value.completedAt }
      : {}),
    events,
    sequence,
    aborted: value.aborted === true,
    learnings: strings(value.learnings),
    visitedUrls: strings(value.visitedUrls),
    sources: records<ResearchSource>(value.sources),
    evidence: records<ResearchEvidence>(value.evidence),
    warnings: records<ResearchWarning>(value.warnings),
    ...(isRecord(value.coverage)
      ? { coverage: value.coverage as ResearchCoverage }
      : {}),
    ...(isRecord(value.budget)
      ? { budget: value.budget as ResearchBudgetUsage }
      : {}),
    ...(typeof value.result === 'string' ? { result: value.result } : {}),
    usage: restoredUsage(value.usage),
    ...(failure ? { failure } : {}),
  };
}

function persistRun(run: Run): void {
  try {
    runStore.persist(run);
    persistenceHealthy = true;
  } catch (error: unknown) {
    persistenceHealthy = false;
    log(`[deep-research] could not persist run ${run.runId}`, error);
  }
}

function removePersistedRun(runId: string): void {
  try {
    runStore.remove(runId);
  } catch (error: unknown) {
    persistenceHealthy = false;
    log(`[deep-research] could not prune run ${runId}`, error);
  }
}

export function initializeRunState(): void {
  if (stateInitialized) return;
  stateInitialized = true;
  try {
    for (const snapshot of runStore.load()) {
      const run = restoreRunSnapshot(snapshot);
      if (!run) continue;
      if (run.status === 'running') {
        run.aborted = true;
        run.failure = {
          code: 'service_restarted',
          message:
            'The Deep Research service restarted before this run finished.',
        };
        run.status = 'failed';
        run.completedAt = new Date().toISOString();
        emit(run, 'run.failed', {
          error: run.failure.code,
          message: run.failure.message,
          learningCount: run.learnings.length,
          sourceCount: run.sources.length || run.visitedUrls.length,
          evidenceCount: run.evidence.length,
          warningCount: run.warnings.length,
          ...(run.coverage ? { coverage: run.coverage } : {}),
        });
      }
      runs.set(run.runId, run);
    }
    pruneRuns();
  } catch (error: unknown) {
    persistenceHealthy = false;
    log('[deep-research] could not restore durable run state', error);
  }
}

/** Without a search backend a run would be hollow, so runs are refused instead. */
function searchBackend(): { configured: boolean; backend: string | null } {
  const backend = activeSearchBackend();
  return { configured: backend !== null, backend };
}

export function appendRunEvent(
  run: Run,
  type: string,
  payload: Record<string, unknown> = {},
  at = new Date().toISOString(),
): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    at,
    payload,
  });
  if (run.events.length > maxEventsPerRun) {
    run.events.splice(0, run.events.length - maxEventsPerRun);
  }
}

function emit(run: Run, type: string, payload: Record<string, unknown> = {}) {
  appendRunEvent(run, type, payload);
  persistRun(run);
}

function summarize(run: Run) {
  return {
    runId: run.runId,
    ownerUserId: run.ownerUserId,
    status: run.status,
    query: run.query,
    breadth: run.breadth,
    depth: run.depth,
    output: run.output,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    lastSequence: run.sequence,
    learningCount: run.learnings.length,
    sourceCount: run.sources.length || run.visitedUrls.length,
    evidenceCount: run.evidence.length,
    warningCount: run.warnings.length,
    ...(run.coverage ? { coverage: run.coverage } : {}),
    ...(run.budget ? { budget: run.budget } : {}),
    usage: run.usage,
    ...(run.result !== undefined ? { result: run.result } : {}),
    ...(run.failure ? { failure: run.failure } : {}),
  };
}

function pruneRuns() {
  const cutoff = Date.now() - runRetentionMs;
  for (const [runId, run] of runs) {
    const finishedAt = run.completedAt ? Date.parse(run.completedAt) : NaN;
    if (
      run.status !== 'running' &&
      Number.isFinite(finishedAt) &&
      finishedAt < cutoff
    ) {
      runs.delete(runId);
      removePersistedRun(runId);
    }
  }
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ ok: false, error });
}

app.use(cors({ origin: false }));
app.use(express.json({ limit: '256kb' }));
app.use((_req: Request, _res: Response, next: NextFunction) => {
  initializeRunState();
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  const search = searchBackend();
  const model = getModelInfo();
  return res.json({
    status: 'ok',
    engine: 'open-deep-research',
    version: VERSION,
    model,
    search,
    // A configured model AND a search backend are both required for a real run.
    ready: model.provider !== 'none' && search.configured,
    activeRuns: [...runs.values()].filter(run => run.status === 'running')
      .length,
    persistence: {
      configured: true,
      healthy: persistenceHealthy,
    },
  });
});

// Every other endpoint is authenticated. The secret is shared with the
// dashboard server only; the browser never receives it.
app.use((req: Request, res: Response, next: NextFunction) => {
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = secret;
  if (!expected) return fail(res, 503, 'service_not_configured');
  const ok =
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return fail(res, 401, 'unauthorized');
  return next();
});

function requireOwnedRun(req: Request, res: Response): Run | null {
  const run = runs.get(String(req.params.runId));
  const userId = Number(req.query.userId ?? req.body?.userId);
  if (!run || !Number.isFinite(userId) || run.ownerUserId !== userId) {
    fail(res, 404, 'run_not_found');
    return null;
  }
  return run;
}

app.post('/runs', async (req: Request, res: Response) => {
  pruneRuns();

  const ownerUserId = Number(req.body?.ownerUserId);
  const query =
    typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  // Bounded separately from the question, and silently: an over-long context is
  // Breadboard's bug to fix, not a reason to refuse the user's research.
  const userContext =
    typeof req.body?.userContext === 'string'
      ? req.body.userContext.trim().slice(0, MAX_USER_CONTEXT_LENGTH)
      : '';
  const breadth = Number(req.body?.breadth ?? DefaultResearchBreadth);
  const depth = Number(req.body?.depth ?? DefaultResearchDepth);
  const output: Output = req.body?.output === 'answer' ? 'answer' : 'report';

  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    return fail(res, 400, 'invalid_owner');
  }
  if (!query || query.length > MAX_QUERY_LENGTH)
    return fail(res, 400, 'invalid_query');
  if (!Number.isInteger(breadth) || breadth < 1 || breadth > MAX_BREADTH) {
    return fail(res, 400, 'invalid_breadth');
  }
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    return fail(res, 400, 'invalid_depth');
  }
  if (getModelInfo().provider === 'none')
    return fail(res, 409, 'model_not_configured');
  if (!searchBackend().configured)
    return fail(res, 409, 'search_not_configured');
  if (
    [...runs.values()].filter(run => run.status === 'running').length >=
    maxConcurrentRuns
  ) {
    return fail(res, 429, 'too_many_runs');
  }

  const runId =
    typeof req.body?.runId === 'string' && /^[\w-]{1,64}$/.test(req.body.runId)
      ? req.body.runId
      : crypto.randomUUID();
  if (runs.has(runId)) return fail(res, 409, 'run_exists');

  const run: Run = {
    runId,
    ownerUserId,
    query,
    userContext,
    breadth,
    depth,
    output,
    status: 'running',
    createdAt: new Date().toISOString(),
    events: [],
    sequence: 0,
    aborted: false,
    learnings: [],
    visitedUrls: [],
    sources: [],
    evidence: [],
    warnings: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
  runs.set(runId, run);

  const model = getModelInfo();
  emit(run, 'run.started', {
    query,
    breadth,
    depth,
    output,
    provider: model.provider,
    model: model.model,
    searchBackend: searchBackend().backend,
  });

  void execute(run);
  return res.json({ ok: true, data: summarize(run) });
});

app.get('/runs/:runId', (req: Request, res: Response) => {
  const run = requireOwnedRun(req, res);
  if (!run) return undefined;
  return res.json({ ok: true, data: summarize(run) });
});

app.get('/runs/:runId/events', (req: Request, res: Response) => {
  const run = requireOwnedRun(req, res);
  if (!run) return undefined;
  const since = Number(req.query.since ?? 0) || 0;
  return res.json({
    ok: true,
    data: run.events.filter(event => event.sequenceNumber > since),
  });
});

app.post('/runs/:runId/abort', (req: Request, res: Response) => {
  const run = requireOwnedRun(req, res);
  if (!run) return undefined;
  if (run.status === 'running') {
    run.aborted = true;
    emit(run, 'run.status', { message: 'Stopping research…' });
    controllers
      .get(run.runId)
      ?.abort(new DOMException('Research run was stopped.', 'AbortError'));
    finish(run, 'aborted');
  }
  return res.json({ ok: true, data: summarize(run) });
});

async function execute(run: Run): Promise<void> {
  const controller = new AbortController();
  controllers.set(run.runId, controller);
  try {
    const recordUsage = (usage: LanguageModelUsage) => {
      if (run.status !== 'running' || controller.signal.aborted) return;
      run.usage.promptTokens += usage.promptTokens;
      run.usage.completionTokens += usage.completionTokens;
      run.usage.totalTokens += usage.totalTokens;
      emit(run, 'run.usage', {
        inputTokens: run.usage.promptTokens,
        outputTokens: run.usage.completionTokens,
        totalTokens: run.usage.totalTokens,
      });
    };
    const research = await deepResearch({
      query: run.query,
      userContext: run.userContext,
      breadth: run.breadth,
      depth: run.depth,
      onProgress: (progress: ResearchProgress) => {
        if (run.status !== 'running' || controller.signal.aborted) return;
        emit(run, 'research.progress', { ...progress });
      },
      onUsage: recordUsage,
      signal: controller.signal,
    });

    if (run.status !== 'running' || controller.signal.aborted) return;

    run.learnings = research.learnings;
    run.visitedUrls = research.visitedUrls;
    run.sources = research.sources ?? [];
    run.evidence = research.evidence ?? [];
    run.warnings = research.warnings ?? [];
    run.coverage = research.coverage;
    run.budget = research.budget;
    emit(run, 'research.learnings', {
      learnings: run.learnings,
      visitedUrls: run.visitedUrls,
    });
    emit(run, 'research.evidence', {
      sources: run.sources,
      evidence: run.evidence,
      warnings: run.warnings,
      ...(run.coverage ? { coverage: run.coverage } : {}),
      ...(run.budget ? { budget: run.budget } : {}),
    });

    if (run.learnings.length === 0) {
      // The engine swallows per-query search failures, so an empty result set is
      // reported as a failure instead of a confident report about nothing.
      run.failure = {
        code: 'no_search_results',
        message:
          'The search backend returned no usable results, so there is nothing to report on.',
      };
      finish(run, 'failed');
      return;
    }

    emit(run, 'run.status', {
      message:
        run.output === 'answer' ? 'Writing the answer…' : 'Writing the report…',
    });

    const result =
      run.output === 'answer'
        ? await writeFinalAnswer({
            prompt: run.query,
            userContext: run.userContext,
            learnings: run.learnings,
            sources: run.sources,
            evidence: run.evidence,
            onUsage: recordUsage,
            signal: controller.signal,
          })
        : await writeFinalReport({
            prompt: run.query,
            userContext: run.userContext,
            learnings: run.learnings,
            visitedUrls: run.visitedUrls,
            sources: run.sources,
            evidence: run.evidence,
            onUsage: recordUsage,
            signal: controller.signal,
          });

    if (run.status !== 'running' || controller.signal.aborted) return;

    run.result = result;
    emit(run, 'run.result', { output: run.output, result });
    finish(run, 'completed');
  } catch (error: unknown) {
    if (run.aborted || controller.signal.aborted || isAbortError(error)) {
      if (run.status === 'running') finish(run, 'aborted');
      return;
    }
    log('[deep-research] run failed', error);
    run.failure = {
      code: 'engine_error',
      message: error instanceof Error ? error.message : String(error),
    };
    finish(run, 'failed');
  } finally {
    controllers.delete(run.runId);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function finish(run: Run, status: Exclude<RunStatus, 'running'>): void {
  if (run.status !== 'running') return;
  run.status = status;
  run.completedAt = new Date().toISOString();
  emit(
    run,
    status === 'completed'
      ? 'run.completed'
      : status === 'aborted'
        ? 'run.aborted'
        : 'run.failed',
    {
      learningCount: run.learnings.length,
      sourceCount: run.sources.length || run.visitedUrls.length,
      evidenceCount: run.evidence.length,
      warningCount: run.warnings.length,
      ...(run.coverage ? { coverage: run.coverage } : {}),
      ...(run.budget ? { budget: run.budget } : {}),
      usage: {
        inputTokens: run.usage.promptTokens,
        outputTokens: run.usage.completionTokens,
        totalTokens: run.usage.totalTokens,
      },
      ...(run.failure
        ? { error: run.failure.code, message: run.failure.message }
        : {}),
    },
  );
}

export function startServer() {
  if (!secret) {
    throw new Error(
      'DEEP_RESEARCH_SECRET is required: start the service through scripts/start-deep-research.mjs.',
    );
  }
  initializeRunState();
  return app.listen(port, host, () => {
    const search = searchBackend();
    const model = getModelInfo();
    log(`[deep-research] listening on http://${host}:${port}`);
    log(`[deep-research] model: ${model.provider}/${model.model || 'unset'}`);
    log(
      search.configured
        ? `[deep-research] search backend: ${search.backend}`
        : '[deep-research] search backend NOT configured (set CHATMOCK_BASE_URL for ChatMock web search, or FIRECRAWL_KEY / FIRECRAWL_BASE_URL); runs are refused until it is.',
    );
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  try {
    startServer();
  } catch (error: unknown) {
    console.error(
      `[deep-research] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

export default app;
