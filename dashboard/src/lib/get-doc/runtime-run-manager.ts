import "server-only";

// Durable dashboard facade for Get Doc. Search/model/network work is owned by
// one disposable Runtime V2 worker. This module keeps only the authenticated
// correlation and the tiny saved-document receipt needed after a dashboard
// restart.

import db from "../db.ts";
import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import type { DocumentSearchRequest, DocumentSourceId } from "./identity.ts";
import { availableSources, contactEmail } from "./sources.ts";
import type { DocumentHit } from "./types.ts";

export type GetDocEvent = OuterAgentEvent;

export interface SavedDocument {
  artifactId: string;
  filename: string;
  byteSize: number;
  savedAt: string;
}

export interface StartRunInput {
  userId: number;
  requestId?: string;
  request: DocumentSearchRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationContext?: string;
}

interface SavedRow {
  owner_user_id: number;
  runtime_job_id: string;
  document_id: string;
  artifact_id: string;
  filename: string;
  byte_size: number;
  saved_at: string;
}

let schemaReady = false;

function ensureSchema(): void {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_v2_get_doc_saved_documents (
      owner_user_id INTEGER NOT NULL,
      runtime_job_id TEXT NOT NULL,
      document_id   TEXT NOT NULL,
      artifact_id   TEXT NOT NULL,
      filename      TEXT NOT NULL,
      byte_size     INTEGER NOT NULL,
      saved_at      TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, runtime_job_id, document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_v2_get_doc_saved_artifact
      ON runtime_v2_get_doc_saved_documents(artifact_id);
  `);
  schemaReady = true;
}

function savedRows(userId: number, runId: string): SavedRow[] {
  ensureSchema();
  return db.prepare(
    `SELECT * FROM runtime_v2_get_doc_saved_documents
     WHERE owner_user_id = ? AND runtime_job_id = ?
     ORDER BY saved_at, document_id`,
  ).all(userId, runId) as SavedRow[];
}

function savedValue(row: SavedRow): SavedDocument {
  return {
    artifactId: row.artifact_id,
    filename: row.filename,
    byteSize: row.byte_size,
    savedAt: row.saved_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function documentHit(value: unknown): value is DocumentHit {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && /^doc_[1-9][0-9]{0,2}$/u.test(value.id) &&
    typeof value.title === "string" && value.title.length <= 500 &&
    Array.isArray(value.authors) && value.authors.length <= 25 &&
    value.authors.every((entry) => typeof entry === "string" && entry.length <= 200) &&
    (value.year === null || (Number.isInteger(value.year) && Number(value.year) >= 1400 && Number(value.year) < 2200)) &&
    (value.venue === null || typeof value.venue === "string") &&
    (value.doi === null || typeof value.doi === "string") &&
    (value.abstract === null || typeof value.abstract === "string") &&
    typeof value.description === "string" &&
    typeof value.openAccess === "boolean" &&
    (value.citationCount === null || (Number.isSafeInteger(value.citationCount) && Number(value.citationCount) >= 0)) &&
    (value.landingPage === null || typeof value.landingPage === "string") &&
    (value.pdfUrl === null || (typeof value.pdfUrl === "string" && value.pdfUrl.startsWith("https://"))) &&
    (value.pdfSource === null || typeof value.pdfSource === "string") &&
    Array.isArray(value.sources) && value.sources.length <= 7 &&
    value.sources.every((entry) => typeof entry === "string");
}

function requestFromEvents(events: readonly OuterAgentEvent[]): DocumentSearchRequest | null {
  const value = events.find((event) => event.type === "run.started")?.payload.request;
  if (!isRecord(value) || typeof value.query !== "string" || !Number.isSafeInteger(value.limit)) {
    return null;
  }
  return value as unknown as DocumentSearchRequest;
}

function documentsFromEvents(events: readonly OuterAgentEvent[]): DocumentHit[] {
  const value = events.findLast((event) => event.type === "documents.ready")?.payload.documents;
  if (!Array.isArray(value) || value.length > 50 || !value.every(documentHit)) {
    return [];
  }
  return value;
}

export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  return startOuterAgentRun({
    kind: "get-doc",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      request: input.request,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<GetDocEvent[]> {
  const view = await readOuterAgentRunView("get-doc", userId, runId, 0);
  const events = [...view.events];
  const base = events.at(-1)?.sequenceNumber ?? 0;
  for (const [index, row] of savedRows(userId, runId).entries()) {
    events.push({
      sequenceNumber: base + index + 1,
      type: "document.saved",
      payload: { documentId: row.document_id, ...savedValue(row) },
      at: row.saved_at,
    });
  }
  return events.filter((event) => event.sequenceNumber > since);
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("get-doc", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("get-doc", userId, runId);
}

export async function findDocument(
  userId: number,
  runId: string,
  documentId: string,
): Promise<{ document: DocumentHit; request: DocumentSearchRequest; saved: SavedDocument | null } | null> {
  const view = await readOuterAgentRunView("get-doc", userId, runId, 0);
  const request = requestFromEvents(view.events);
  if (!request) return null;
  const document = documentsFromEvents(view.events).find((entry) => entry.id === documentId);
  if (!document) return null;
  const row = savedRows(userId, runId).find((entry) => entry.document_id === documentId);
  return { document, request, saved: row ? savedValue(row) : null };
}

export function recordDownload(input: {
  userId: number;
  runId: string;
  documentId: string;
  artifactId: string;
  filename: string;
  byteSize: number;
}): SavedDocument {
  ensureSchema();
  const savedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO runtime_v2_get_doc_saved_documents
       (owner_user_id, runtime_job_id, document_id, artifact_id, filename, byte_size, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_user_id, runtime_job_id, document_id) DO NOTHING`,
  ).run(
    input.userId,
    input.runId,
    input.documentId,
    input.artifactId,
    input.filename,
    input.byteSize,
    savedAt,
  );
  const row = savedRows(input.userId, input.runId)
    .find((entry) => entry.document_id === input.documentId);
  if (!row) throw new Error("run_not_found");
  return savedValue(row);
}

/** Passive configuration projection; it starts no process or service. */
export function sourceAvailability(): {
  ready: DocumentSourceId[];
  unavailable: Array<{ source: DocumentSourceId; reason: string }>;
  contactConfigured: boolean;
} {
  const { ready, unavailable } = availableSources();
  return { ready, unavailable, contactConfigured: Boolean(contactEmail()) };
}
