// Keeping what a legal run produced as Breadboard artifacts.
//
// The harness writes deliverables into a per-run output directory that nobody
// will ever open again, and this bridge deletes that directory when the run is
// cleaned up. A memo is only really delivered once it is an artifact of the
// chat that asked for it: it previews in the viewer, downloads from the panel,
// and can be deleted like anything else.
//
// The binding is to the conversation the run was launched from, captured at
// launch. Looking up "the current chat" when a long review finishes would
// attach an hour-old memo to whatever the person happens to be reading by then.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createArtifact,
  createImportedArtifact,
  renderArtifact,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import type { ArtifactKind, ArtifactRendererId } from "../hermes/artifact-types.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";

export const LEGAL_OUTPUT_TOOL = "legal_agent_output";

export interface LegalArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** This agent's run id, which is how its chat turn is addressed. */
  agentRunId: string;
  assistantMessageId: number | null;
}

/**
 * The assistant turn this run belongs to, looked up again if it was not there
 * when the run started — the chat surface posts the run first and writes the
 * turn once it has a run id, so a context opened at dispatch sees no message
 * yet.
 */
function assistantMessageFor(context: LegalArtifactContext): number | null {
  if (context.assistantMessageId !== null) return context.assistantMessageId;
  try {
    const found = findExternalAgentAssistantMessage({
      conversationId: context.conversationId,
      runId: context.agentRunId,
    });
    if (found) context.assistantMessageId = found.id;
    return context.assistantMessageId;
  } catch {
    return null;
  }
}

/**
 * Resolve everything the artifact store needs from the conversation this run
 * was dispatched in, and open a run for its deliverables to hang off. Returns
 * null when the conversation has no runtime session — the caller then says so
 * in the run's output rather than silently dropping the work.
 */
export function openLegalArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  task: string;
  agentRunId: string;
}): LegalArtifactContext | null {
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
      instruction: input.task.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.task.slice(0, 4_000),
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
      agentRunId: input.agentRunId,
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

export function closeLegalArtifactContext(
  context: LegalArtifactContext | null,
  status: "completed" | "failed" | "aborted",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(
      context.runId,
      status === "completed" ? "completed" : status === "aborted" ? "cancelled" : "error",
    );
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

/**
 * How a deliverable is stored.
 *
 * Text lands as content, which is what makes a memo readable in the viewer and
 * editable afterwards. Binary goes through the import path, which verifies the
 * file's actual signature against the kind rather than trusting its extension —
 * and .docx/.xlsx/.pptx are exactly the kinds a legal run produces.
 */
const TEXT_PROFILES: Record<string, { kind: ArtifactKind; renderer: ArtifactRendererId }> = {
  ".md": { kind: "markdown", renderer: "markdown" },
  ".markdown": { kind: "markdown", renderer: "markdown" },
  ".txt": { kind: "text", renderer: "text" },
  ".html": { kind: "html", renderer: "html" },
  ".htm": { kind: "html", renderer: "html" },
  ".json": { kind: "data", renderer: "json" },
  ".csv": { kind: "spreadsheet", renderer: "csv" },
};

const BINARY_KINDS: Record<string, ArtifactKind> = {
  ".docx": "document",
  ".pdf": "pdf",
  ".xlsx": "spreadsheet",
  ".pptx": "presentation",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".svg": "diagram",
};

/** True when the bytes are plausibly UTF-8 text rather than a binary blob. */
function looksTextual(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4_096);
  if (sample.includes(0)) return false;
  return !/�/.test(sample.toString("utf8"));
}

function safeFilename(name: string): string {
  return (
    name
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^[.-]+/, "")
      .slice(0, 120) || "deliverable"
  );
}

/**
 * Store one deliverable. Never throws: a file the store refuses is reported to
 * the run so it can say so, and must not cost the answer.
 */
export async function saveLegalArtifact(input: {
  context: LegalArtifactContext;
  /** The path relative to the run's output directory, kept as provenance. */
  path: string;
  bytes: Buffer;
}): Promise<{ ok: true; artifact: ArtifactRow } | { ok: false; reason: string }> {
  const filename = safeFilename(input.path.split("/").filter(Boolean).pop() ?? "deliverable");
  const extension = path.extname(filename).toLowerCase();
  const title = filename.slice(0, 240);
  const assistantMessageId = assistantMessageFor(input.context);
  const shared = {
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId,
    surface: input.context.surface,
    metadata: { legalAgentOutput: true, legalAgentPath: input.path },
  };

  try {
    const binaryKind = BINARY_KINDS[extension];
    const textProfile = TEXT_PROFILES[extension];

    if (textProfile || (!binaryKind && looksTextual(input.bytes))) {
      const profile = textProfile ?? { kind: "text" as const, renderer: "text" as const };
      const artifact = createArtifact({
        ...shared,
        kind: profile.kind,
        rendererId: profile.renderer,
        title,
        filename,
        content: input.bytes.toString("utf8"),
        sourceHermesTool: LEGAL_OUTPUT_TOOL,
      });
      void renderArtifact({ artifact, runId: input.context.runId, assistantMessageId });
      return { ok: true, artifact };
    }

    if (!binaryKind) {
      return { ok: false, reason: `${filename} is not a file type Breadboard can keep.` };
    }

    // The import path only reads from a root it can verify, so the bytes are
    // staged first and the same containment check runs over the copy.
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-legal-"));
    try {
      const staged = path.join(stagingRoot, filename);
      fs.writeFileSync(staged, input.bytes, { flag: "wx" });
      const artifact = await createImportedArtifact({
        ...shared,
        toolCallId: null,
        kind: binaryKind,
        title,
        filename,
        authorizedRoot: stagingRoot,
        filePath: staged,
        sourceHermesTool: LEGAL_OUTPUT_TOOL,
      });
      return { ok: true, artifact };
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `${filename}: ${error.message}`
          : `${filename} could not be stored.`,
    };
  }
}
