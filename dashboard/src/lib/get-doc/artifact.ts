// Keeping a downloaded paper as a Breadboard artifact.
//
// A download is only finished when the file is somewhere durable, so this is
// the other half of the Download button: the bytes land in the artifact store,
// under the chat turn that found them, and the PDF then behaves like every other
// artifact — it previews in the viewer, downloads again from the panel, and can
// be deleted.
//
// The staging directory exists because the artifact store only imports files it
// can verify from an authorized root; writing the download there first is what
// lets the same signature check run over the copy that is actually stored.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createImportedArtifact,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import type { DocumentHit } from "./types.ts";

export const GET_DOC_DOWNLOAD_TOOL = "get_doc_download";

export interface GetDocArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** The chat turn this download belongs to, so the card sits under it. */
  assistantMessageId: number | null;
}

/**
 * Resolve everything the artifact store needs from the conversation the search
 * ran in, and open a run for the download to hang off. Returns null when the
 * conversation has no runtime session — the caller then reports that plainly
 * instead of silently dropping the file.
 */
export function openGetDocArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  /** The Get Doc run id, which is how its chat turn is addressed. */
  agentRunId: string;
}): GetDocArtifactContext | null {
  try {
    const conversation = getConversationForUser(input.conversationPublicId, input.userId);
    if (
      conversation.surface !== "dashboard_terminal" &&
      conversation.surface !== "garden_chat"
    ) {
      return null;
    }
    const session = getRuntimeSessionByConversation(conversation.id);
    if (!session) return null;
    const hermesSessionId = runtimeExternalSessionId(session);
    if (!hermesSessionId) return null;

    const run = beginRuntimeRun({
      runtimeSessionId: session.id,
      instruction: input.label.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.label.slice(0, 4_000),
      },
    });

    return {
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      runtimeSessionId: session.id,
      hermesSessionId,
      conversationId: conversation.id,
      clusterId:
        conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
      surface: conversation.surface,
      runId: run.id,
      assistantMessageId:
        findExternalAgentAssistantMessage({
          conversationId: conversation.id,
          runId: input.agentRunId,
        })?.id ?? null,
    };
  } catch {
    return null;
  }
}

export function closeGetDocArtifactContext(
  context: GetDocArtifactContext | null,
  status: "completed" | "failed",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(context.runId, status === "completed" ? "completed" : "error");
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

/** What the artifact remembers about where a paper came from. */
export function documentMetadata(document: DocumentHit, finalUrl: string): Record<string, unknown> {
  return {
    getDocDocument: true,
    documentTitle: document.title,
    documentAuthors: document.authors.slice(0, 25),
    documentYear: document.year,
    documentVenue: document.venue,
    documentDoi: document.doi,
    documentLandingPage: document.landingPage,
    documentPdfUrl: finalUrl,
    documentPdfSource: document.pdfSource,
    documentCatalogs: document.sources,
    documentOpenAccess: document.openAccess,
  };
}

/** Store one downloaded PDF as a durable, verified artifact. */
export function saveDocumentArtifact(input: {
  context: GetDocArtifactContext;
  document: DocumentHit;
  buffer: Buffer;
  filename: string;
  finalUrl: string;
}): ArtifactRow {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-get-doc-"));
  const stagedName =
    input.filename.replace(/[^a-z0-9._-]+/gi, "-").replace(/^\.+/, "").slice(0, 120) ||
    "document.pdf";
  const stagedFile = path.join(stagingRoot, stagedName);
  try {
    fs.writeFileSync(stagedFile, input.buffer, { flag: "wx" });
    return createImportedArtifact({
      userId: input.context.userId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      runId: input.context.runId,
      assistantMessageId: input.context.assistantMessageId,
      surface: input.context.surface,
      kind: "pdf",
      title: input.document.title.slice(0, 240),
      filename: stagedName,
      authorizedRoot: stagingRoot,
      filePath: stagedFile,
      metadata: documentMetadata(input.document, input.finalUrl),
      sourceHermesTool: GET_DOC_DOWNLOAD_TOOL,
      // Breadboard fetched this paper, it did not write it. Its XMP carries the
      // authors, the DOI and the license, and stripping that would destroy
      // somebody else's bibliographic record rather than clean up our own.
      scrubProvenance: false,
    });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}
