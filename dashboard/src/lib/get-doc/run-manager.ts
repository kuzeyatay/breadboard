// In-memory run manager for the Get Doc agent.
//
// A run is short: read the request, ask every catalog, merge, describe, done.
// What makes it worth holding onto afterwards is the result list. The Download
// button never sends an address — it names `doc_3` in a run — so this map is
// what authorizes a download and what a reopened transcript replays to get its
// buttons back. Runs are therefore kept for a day rather than the ten minutes
// the other agents use, and a run remembers what has already been saved so the
// same paper is not fetched twice.
//
// Events live here and the SSE route replays them; nothing about a run is
// durable, which is why the finished turn also carries a written list.

import { randomUUID } from "node:crypto";
import { availableSources, contactEmail } from "./sources.ts";
import { describeDocuments, planSearch } from "./query-plan.ts";
import { searchDocuments } from "./search.ts";
import type { DocumentSearchRequest, DocumentSourceId } from "./identity.ts";
import type { DocumentHit, SourceReport } from "./types.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface GetDocEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface SavedDocument {
  artifactId: string;
  filename: string;
  byteSize: number;
  savedAt: string;
}

interface RunState {
  runId: string;
  userId: number;
  request: DocumentSearchRequest;
  status: RunStatus;
  sequence: number;
  events: GetDocEvent[];
  documents: DocumentHit[];
  saved: Map<string, SavedDocument>;
  aborted: boolean;
  summary: string;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardGetDocRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardGetDocRuns ?? new Map<string, RunState>();
globalRuns.__breadboardGetDocRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RUNS = 40;

// ---- event plumbing ---------------------------------------------------------

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
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

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

/** Drop expired runs, then the oldest ones if there are still too many. */
function evict(): void {
  const now = Date.now();
  for (const [runId, run] of runs) {
    if (now - run.createdAt > RETENTION_MS) runs.delete(runId);
  }
  if (runs.size <= MAX_RUNS) return;
  const ordered = [...runs.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt);
  for (const [runId] of ordered.slice(0, runs.size - MAX_RUNS)) runs.delete(runId);
}

// ---- the written answer -----------------------------------------------------

function authorLine(document: DocumentHit): string {
  const authors =
    document.authors.length > 3
      ? `${document.authors.slice(0, 3).join(", ")} et al.`
      : document.authors.join(", ");
  return [authors, document.year ? String(document.year) : "", document.venue ?? ""]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The list as prose, kept with the finished turn. The card renders live rows
 * with buttons; this is what remains readable a week later, when the run itself
 * is long gone — so every link it can still be opened by is written out.
 */
export function summarizeDocuments(input: {
  request: DocumentSearchRequest;
  documents: DocumentHit[];
  reports: SourceReport[];
  saved: Map<string, SavedDocument>;
}): string {
  if (!input.documents.length) {
    const failures = input.reports.filter((report) => report.status === "error");
    return [
      `No documents matched “${input.request.query}”.`,
      failures.length
        ? `These catalogs did not answer: ${failures
            .map((report) => `${report.source} (${report.note ?? "error"})`)
            .join(", ")}.`
        : input.request.openAccessOnly
          ? "Try again with `--all` to include papers whose full text is not free."
          : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const lines = input.documents.map((document, index) => {
    const links = [
      document.pdfUrl ? `[PDF](${document.pdfUrl})` : null,
      document.landingPage ? `[page](${document.landingPage})` : null,
      document.doi ? `[doi](https://doi.org/${document.doi})` : null,
    ].filter(Boolean);
    const saved = input.saved.get(document.id);
    return [
      `${index + 1}. **${document.title}**`,
      `   ${authorLine(document)}`,
      document.description ? `   ${document.description}` : "",
      links.length ? `   ${links.join(" · ")}${saved ? " · saved to artifacts" : ""}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const downloadable = input.documents.filter((document) => document.pdfUrl).length;
  return [
    `${input.documents.length} document${input.documents.length === 1 ? "" : "s"} for “${input.request.query}” — ${downloadable} with a free PDF.`,
    "",
    ...lines,
  ].join("\n");
}

// ---- lifecycle --------------------------------------------------------------


export interface StartRunInput {
  userId: number;
  request: DocumentSearchRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  /** The chat this was launched from, so a search can refer back to it. */
  conversationContext?: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  evict();
  const runId = `gdrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    status: "queued",
    sequence: 0,
    events: [],
    documents: [],
    saved: new Map(),
    aborted: false,
    summary: "",
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "The document search failed.",
    });
  });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  const request = run.request;
  emit(run, "run.started", { query: request.query, model: input.model });
  run.status = "running";

  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const { ready } = availableSources();
  const selected = (request.sources ?? ready).filter((source) => ready.includes(source));

  emit(run, "plan.started", {});
  const planned = await planSearch({
    baseUrl: input.baseUrl,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    // The planner turns this into catalog queries, so a request like "the
    // paper he mentioned" only resolves if the chat comes with it.
    task: promptWithContext(request.query, input.conversationContext),
  });
  if (run.aborted) return;
  usage.inputTokens += planned.usage.inputTokens;
  usage.outputTokens += planned.usage.outputTokens;
  if (planned.usage.inputTokens || planned.usage.outputTokens) usage.calls += 1;
  emit(run, "plan.completed", {
    queries: planned.plan.queries,
    intent: planned.plan.intent,
    interpreted: planned.modelUsed,
    yearFrom: planned.plan.yearFrom,
    yearTo: planned.plan.yearTo,
  });
  emit(run, "run.usage", { ...usage });

  // A flag typed in the message beats what the model read out of the prose,
  // the same rule the settings follow.
  const yearFrom = request.yearFrom ?? planned.plan.yearFrom;
  const yearTo = request.yearTo ?? planned.plan.yearTo;

  const collected: DocumentHit[] = [];
  const reports: SourceReport[] = [];
  const seen = new Set<string>();
  let unpaywallSkipped = false;

  // Each planned query is a separate pass over every catalog. The first is
  // usually enough; the rest exist for the request that needs rephrasing to
  // find anything at all, so they stop as soon as the list is full.
  for (const [index, query] of planned.plan.queries.entries()) {
    if (run.aborted) return;
    if (collected.length >= request.limit) break;
    emit(run, "search.started", { query, attempt: index + 1, sources: selected });
    const outcome = await searchDocuments({
      query: {
        query,
        limit: request.limit,
        openAccessOnly: request.openAccessOnly,
        yearFrom,
        yearTo,
      },
      sources: request.sources,
      progress: {
        onSourceDone: (report) => emit(run, "source.completed", { ...report }),
        onStage: (stage, detail) => emit(run, "search.progress", { stage, detail }),
      },
    });
    if (run.aborted) return;
    unpaywallSkipped ||= outcome.unpaywallSkipped;
    for (const report of outcome.reports) {
      if (!reports.some((existing) => existing.source === report.source)) reports.push(report);
    }
    for (const document of outcome.documents) {
      const key = document.doi ?? document.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(document);
      if (collected.length >= request.limit) break;
    }
    emit(run, "search.completed", { query, found: collected.length });
  }

  // Ids are handed out here, after merging across queries, so `doc_3` means the
  // same paper for the whole life of the run — including its download.
  const documents = collected.slice(0, request.limit).map((document, index) => ({
    ...document,
    id: `doc_${index + 1}`,
  }));

  if (documents.length) {
    emit(run, "describe.started", { count: documents.length });
    const described = await describeDocuments({
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      intent: planned.plan.intent,
      documents,
    });
    if (run.aborted) return;
    usage.inputTokens += described.usage.inputTokens;
    usage.outputTokens += described.usage.outputTokens;
    if (described.usage.inputTokens || described.usage.outputTokens) usage.calls += 1;
    run.documents = described.documents;
  } else {
    run.documents = documents;
  }

  emit(run, "documents.ready", {
    documents: run.documents,
    reports,
    unpaywallSkipped,
    contactConfigured: Boolean(contactEmail()),
  });
  emit(run, "run.usage", { ...usage });

  run.summary = summarizeDocuments({
    request,
    documents: run.documents,
    reports,
    saved: run.saved,
  });
  run.status = "completed";
  emit(run, "run.completed", {
    summary: run.summary,
    found: run.documents.length,
    downloadable: run.documents.filter((document) => document.pdfUrl).length,
    ...usage,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): GetDocEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  emit(run, "run.aborted", { summary: "The document search was stopped." });
  return true;
}

/** The document a download request names, or null when the run cannot serve it. */
export function findDocument(
  userId: number,
  runId: string,
  documentId: string,
): { document: DocumentHit; request: DocumentSearchRequest; saved: SavedDocument | null } | null {
  const run = requireRun(userId, runId);
  const document = run.documents.find((entry) => entry.id === documentId);
  if (!document) return null;
  return { document, request: run.request, saved: run.saved.get(documentId) ?? null };
}

/** Remember a saved download so the card survives a reload knowing about it. */
export function recordDownload(input: {
  userId: number;
  runId: string;
  documentId: string;
  artifactId: string;
  filename: string;
  byteSize: number;
}): SavedDocument {
  const run = requireRun(input.userId, input.runId);
  const saved: SavedDocument = {
    artifactId: input.artifactId,
    filename: input.filename,
    byteSize: input.byteSize,
    savedAt: new Date().toISOString(),
  };
  run.saved.set(input.documentId, saved);
  emit(run, "document.saved", { documentId: input.documentId, ...saved });
  // The written list carries "saved to artifacts", so it is rebuilt each time.
  run.summary = summarizeDocuments({
    request: run.request,
    documents: run.documents,
    reports: [],
    saved: run.saved,
  });
  return saved;
}

/** Which catalogs this server can actually reach, for the health check. */
export function sourceAvailability(): {
  ready: DocumentSourceId[];
  unavailable: Array<{ source: DocumentSourceId; reason: string }>;
  contactConfigured: boolean;
} {
  const { ready, unavailable } = availableSources();
  return { ready, unavailable, contactConfigured: Boolean(contactEmail()) };
}
