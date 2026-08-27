import "server-only";

import path from "node:path";
import {
  getArtifactForUser,
  listArtifactsForUser,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import {
  closeGetDocArtifactContext,
  openGetDocArtifactContext,
  saveDocumentArtifact,
} from "./artifact.ts";
import {
  DocumentDownloadError,
  downloadPdfToFile,
  pdfFilename,
} from "./download.ts";
import type { DocumentHit } from "./types.ts";

export interface GetDocDownloadEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  status: RunStatus;
  sequence: number;
  events: GetDocDownloadEvent[];
  controller: AbortController;
  createdAt: number;
}

interface StartInput {
  userId: number;
  runtimeJobId: string;
  runtimeWorkspacePath: string;
  sourceRunId: string;
  documentId: string;
  conversationPublicId: string;
  document: DocumentHit;
}

const runs = new Map<string, RunState>();

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({ sequenceNumber: run.sequence, type, payload, at: new Date().toISOString() });
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function metadata(row: ArtifactRow): Record<string, unknown> {
  try {
    const value = JSON.parse(row.metadata_json) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function existingArtifact(input: StartInput): ArtifactRow | null {
  return listArtifactsForUser({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
  }).find((artifact) => {
    const value = metadata(artifact);
    return artifact.status === "ready" &&
      value.getDocRuntimeJobId === input.sourceRunId &&
      value.getDocDocumentId === input.documentId;
  }) ?? null;
}

function savedPayload(artifact: ArtifactRow, documentId: string): Record<string, unknown> {
  return {
    documentId,
    artifactId: artifact.id,
    filename: artifact.filename,
    byteSize: artifact.byte_size ?? 0,
    savedAt: artifact.updated_at,
  };
}

async function drive(run: RunState, input: StartInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", { documentId: input.documentId, title: input.document.title });
  let artifact = existingArtifact(input);
  if (!artifact) {
    if (!input.document.pdfUrl) {
      throw new DocumentDownloadError("no_free_full_text", "No free full text was found for this paper.");
    }
    const context = openGetDocArtifactContext({
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      label: `Download: ${input.document.title}`,
      agentRunId: input.sourceRunId,
    });
    if (!context) {
      throw new DocumentDownloadError(
        "artifact_session_unavailable",
        "The artifact workspace is not ready. Reopen the chat and try again.",
      );
    }
    try {
      emit(run, "download.started", { documentId: input.documentId });
      const outputPath = path.join(input.runtimeWorkspacePath, "document.pdf");
      const downloaded = await downloadPdfToFile(
        input.document.pdfUrl,
        outputPath,
        run.controller.signal,
      );
      artifact = await saveDocumentArtifact({
        context,
        document: input.document,
        sourceFile: downloaded.filePath,
        authorizedRoot: input.runtimeWorkspacePath,
        filename: pdfFilename({
          title: input.document.title,
          year: input.document.year,
          firstAuthor: input.document.authors[0] ?? null,
        }),
        finalUrl: downloaded.finalUrl,
        runtimeIdentity: { runId: input.sourceRunId, documentId: input.documentId },
      });
      closeGetDocArtifactContext(context, "completed");
    } catch (error) {
      closeGetDocArtifactContext(context, "failed");
      throw error;
    }
  } else {
    // Re-assert authenticated ownership before projecting an idempotent retry.
    artifact = getArtifactForUser({
      artifactId: artifact.id,
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
    });
  }
  const saved = savedPayload(artifact, input.documentId);
  emit(run, "document.saved", saved);
  run.status = "completed";
  emit(run, "run.completed", {
    summary: `Saved “${input.document.title}” to artifacts.`,
    saved,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
}

export function startRuntimeWorkerRun(input: StartInput): { runId: string; status: RunStatus } {
  const run: RunState = {
    runId: input.runtimeJobId,
    userId: input.userId,
    status: "queued",
    sequence: 0,
    events: [],
    controller: new AbortController(),
    createdAt: Date.now(),
  };
  runs.set(run.runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.status === "aborted") return;
    run.status = "failed";
    emit(run, "run.failed", {
      code: error instanceof DocumentDownloadError ? error.code : "internal_error",
      error: error instanceof Error ? error.message : "The download could not be completed.",
    });
  });
  return { runId: run.runId, status: run.status };
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): GetDocDownloadEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.controller.abort();
  run.status = "aborted";
  emit(run, "run.aborted", { summary: "The document download was stopped." });
  return true;
}
