// Storing a MoneyPrinter video as a Breadboard artifact.
//
// The clone leaves its finished cut inside its own `storage/tasks/<task>/`
// directory, which is a fine place for the project's WebUI and a poor place for
// a chat message: nothing there is scoped to a conversation, nothing is
// downloadable from the app, and a `Delete task` in the clone would take the
// video with it. So the file is imported — copied into the artifact store,
// bound to the conversation that asked for it, and rendered under that turn.
//
// The narration is not a separate artifact. It is a paragraph of text that the
// reply already carries in full, and a second card holding the same words would
// only make the transcript harder to read.

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

export const MONEY_PRINTER_TOOL = "money_printer_cut_video";

export interface MoneyPrinterArtifactContext {
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
  /**
   * The chat turn this run belongs to, so the video renders under that response.
   * Null only if the turn was never stored — the artifact still belongs to the
   * conversation, it just has no message to sit under.
   */
  assistantMessageId: number | null;
}

/**
 * The assistant turn this run belongs to, looked up again if it was not there
 * when the run started.
 *
 * It usually is not: the chat surface posts the run first and writes the turn
 * once it has a run id, so a context opened at dispatch sees no message yet.
 * Resolving only at open time would leave the video's card floating free of the
 * reply that produced it.
 */
function assistantMessageFor(context: MoneyPrinterArtifactContext): number | null {
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
 * Resolve everything the artifact store needs from the conversation this run was
 * dispatched in, and open a run for the videos to hang off. Returns null when
 * the conversation has no runtime session yet.
 */
export function openMoneyPrinterArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  subject: string;
  /** The MoneyPrinter run id, which is how its chat turn is addressed. */
  agentRunId: string;
}): MoneyPrinterArtifactContext | null {
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
      instruction: input.subject.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.subject.slice(0, 4_000),
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

export function closeMoneyPrinterArtifactContext(
  context: MoneyPrinterArtifactContext | null,
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

function safeFilename(subject: string): string {
  return (
    subject
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "money-printer-video"
  );
}

export interface PublishedVideo {
  artifactId: string;
  filename: string;
  title: string;
}

/**
 * Import one finished cut as a durable video artifact.
 *
 * `tasksRoot` is the authorization boundary the store checks the file against:
 * the clone writes only inside `storage/tasks`, so anything resolving outside it
 * is a path the run had no business producing and the import is refused rather
 * than followed.
 */
export function publishTaskVideo(input: {
  context: MoneyPrinterArtifactContext;
  tasksRoot: string;
  /** Absolute path to the cut, inside `tasksRoot`. */
  filePath: string;
  subject: string;
  /** Which of several cuts this is, when a run asked for more than one. */
  index: number;
  total: number;
  metadata: Record<string, unknown>;
}): { ok: true; video: PublishedVideo } | { ok: false; reason: string } {
  const title =
    input.total > 1
      ? `${input.subject} — cut ${input.index + 1}`.slice(0, 240)
      : input.subject.slice(0, 240) || "Short video";
  try {
    const artifact: ArtifactRow = createImportedArtifact({
      userId: input.context.userId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      runId: input.context.runId,
      assistantMessageId: assistantMessageFor(input.context),
      toolCallId: null,
      surface: input.context.surface,
      kind: "video",
      title,
      filename: `${safeFilename(input.subject)}${
        input.total > 1 ? `-${input.index + 1}` : ""
      }${path.extname(input.filePath) || ".mp4"}`,
      authorizedRoot: input.tasksRoot,
      filePath: input.filePath,
      parentArtifactId: null,
      metadata: input.metadata,
      sourceHermesTool: MONEY_PRINTER_TOOL,
    });
    return {
      ok: true,
      video: { artifactId: artifact.id, filename: artifact.filename, title: artifact.title },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The video could not be stored.",
    };
  }
}
