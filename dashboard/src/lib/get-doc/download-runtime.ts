import "server-only";

import { createHash } from "node:crypto";
import {
  getArtifactForUser,
  presentArtifact,
} from "../hermes/artifact-store.ts";
import type { PresentedArtifact } from "../hermes/artifact-types.ts";
import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
} from "../runtime-v2/outer-agent-run.ts";
import type { DocumentHit } from "./types.ts";

export class RuntimeDocumentDownloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface RuntimeDocumentDownload {
  artifact: PresentedArtifact;
  artifactId: string;
  filename: string;
  byteSize: number;
  savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestId(input: {
  runId: string;
  documentId: string;
  conversationPublicId: string;
}): string {
  return `gddl_${createHash("sha256")
    .update(`${input.runId}\0${input.documentId}\0${input.conversationPublicId}`)
    .digest("hex")}`;
}

export async function downloadDocumentViaRuntime(input: {
  userId: number;
  sourceRunId: string;
  documentId: string;
  conversationPublicId: string;
  document: DocumentHit;
}): Promise<RuntimeDocumentDownload> {
  const launched = await startOuterAgentRun({
    kind: "get-doc-download",
    userId: input.userId,
    requestId: requestId({
      runId: input.sourceRunId,
      documentId: input.documentId,
      conversationPublicId: input.conversationPublicId,
    }),
    requestPayload: {
      sourceRunId: input.sourceRunId,
      documentId: input.documentId,
      conversationPublicId: input.conversationPublicId,
      document: input.document,
    },
  });

  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    const view = await readOuterAgentRunView(
      "get-doc-download",
      input.userId,
      launched.runId,
      0,
    );
    if (view.terminal) {
      const completed = view.events.findLast((event) => event.type === "run.completed");
      const saved = completed?.payload.saved;
      if (isRecord(saved) &&
        typeof saved.artifactId === "string" &&
        typeof saved.filename === "string" &&
        Number.isSafeInteger(saved.byteSize) &&
        typeof saved.savedAt === "string") {
        const artifact = getArtifactForUser({
          artifactId: saved.artifactId,
          userId: input.userId,
          conversationPublicId: input.conversationPublicId,
        });
        return {
          artifact: presentArtifact(artifact),
          artifactId: saved.artifactId,
          filename: saved.filename,
          byteSize: Number(saved.byteSize),
          savedAt: saved.savedAt,
        };
      }
      const failed = view.events.findLast((event) => event.type === "run.failed");
      throw new RuntimeDocumentDownloadError(
        typeof failed?.payload.code === "string" ? failed.payload.code : "download_failed",
        typeof failed?.payload.error === "string"
          ? failed.payload.error
          : "The download could not be completed.",
      );
    }
    if (Date.now() >= deadline) {
      await abortOuterAgentRun("get-doc-download", input.userId, launched.runId)
        .catch(() => false);
      throw new RuntimeDocumentDownloadError("timeout", "The download timed out.");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
