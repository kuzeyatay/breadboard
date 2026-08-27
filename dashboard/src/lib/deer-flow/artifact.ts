// Keeping the files a DeerFlow run produced as Breadboard artifacts.
//
// DeerFlow writes into its own per-thread outputs directory and "presents" what
// it wants the person to see. That directory belongs to a thread nobody will
// ever open again, so a presented file is only really delivered once it is an
// artifact of the chat that asked for it: it previews in the viewer, downloads
// from the panel, and can be deleted like anything else.
//
// The binding is to the conversation the run was launched from, captured at
// launch. Looking up "the current chat" when the run finishes would attach an
// hour-old report to whatever the person happens to be reading by then.

import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
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
import { dashboardDataDir } from "../runtime-paths.ts";

export const DEER_FLOW_PRESENT_TOOL = "deer_flow_present_files";

export interface DeerFlowArtifactContext {
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
function assistantMessageFor(context: DeerFlowArtifactContext): number | null {
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
 * dispatched in, and open a run for its files to hang off. Returns null when the
 * conversation has no runtime session — the caller then says so in the run's
 * output rather than silently dropping the files.
 */
export function openDeerFlowArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  task: string;
  agentRunId: string;
}): DeerFlowArtifactContext | null {
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

export function closeDeerFlowArtifactContext(
  context: DeerFlowArtifactContext | null,
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
 * How a produced file is stored.
 *
 * Text lands as content, which is what makes a report readable in the viewer
 * and editable afterwards. Binary has to go through the import path, which
 * verifies the file's actual signature against the kind rather than trusting
 * its extension.
 */
const TEXT_PROFILES: Record<string, { kind: ArtifactKind; renderer: ArtifactRendererId }> = {
  ".md": { kind: "markdown", renderer: "markdown" },
  ".markdown": { kind: "markdown", renderer: "markdown" },
  ".txt": { kind: "text", renderer: "text" },
  ".log": { kind: "text", renderer: "text" },
  ".html": { kind: "html", renderer: "html" },
  ".htm": { kind: "html", renderer: "html" },
  ".json": { kind: "data", renderer: "json" },
  ".csv": { kind: "spreadsheet", renderer: "csv" },
};

const CODE_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".bash", ".ps1",
  ".sql", ".yaml", ".yml", ".toml", ".ini", ".css", ".scss", ".java", ".go",
  ".rs", ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".kt",
  ".r", ".jl", ".lua", ".pl", ".xml", ".tex", ".dockerfile", ".env",
]);

const BINARY_KINDS: Record<string, ArtifactKind> = {
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".svg": "diagram",
  ".mp4": "video",
  ".webm": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".xlsx": "spreadsheet",
  ".pptx": "presentation",
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
      .slice(0, 120) || "output"
  );
}

/**
 * Store one file a run presented. Never throws: a file the store refuses is
 * reported to the run so it can say so, and must not cost the answer.
 */
export async function saveDeerFlowArtifact(input: {
  context: DeerFlowArtifactContext;
  /** The virtual path DeerFlow reported, kept as provenance. */
  path: string;
  bytes: Buffer;
}): Promise<{ ok: true; artifact: ArtifactRow } | { ok: false; reason: string }> {
  const filename = safeFilename(input.path.split("/").filter(Boolean).pop() ?? "output");
  const extension = path.extname(filename).toLowerCase();
  const title = filename.slice(0, 240);
  const assistantMessageId = assistantMessageFor(input.context);
  const metadata = {
    deerFlowOutput: true,
    deerFlowPath: input.path,
  };
  const shared = {
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId,
    surface: input.context.surface,
    metadata,
  };

  try {
    const textProfile =
      TEXT_PROFILES[extension] ??
      (CODE_EXTENSIONS.has(extension) ? { kind: "code" as const, renderer: "code" as const } : null);
    const binaryKind = BINARY_KINDS[extension];

    if (textProfile || (!binaryKind && looksTextual(input.bytes))) {
      const profile = textProfile ?? { kind: "text" as const, renderer: "text" as const };
      const artifact = createArtifact({
        ...shared,
        kind: profile.kind,
        rendererId: profile.renderer,
        title,
        filename,
        content: input.bytes.toString("utf8"),
        sourceHermesTool: DEER_FLOW_PRESENT_TOOL,
      });
      const rendered = await renderArtifact({
        artifact,
        runId: input.context.runId,
        assistantMessageId,
      });
      return { ok: true, artifact: rendered };
    }

    if (!binaryKind) {
      return { ok: false, reason: `${filename} is not a file type Breadboard can keep.` };
    }

    // The import path only reads from a root it can verify, so the bytes are
    // staged first and the same containment check runs over the copy.
    // The outer worker derives BREADBOARD_DATA_DIR from its sealed launch. Keep
    // staging there so the worker does not need inherited TEMP/TMP authority.
    const stagingParent = path.join(dashboardDataDir(), "runtime", "deer-flow", "artifact-stage");
    fs.mkdirSync(stagingParent, { recursive: true, mode: 0o700 });
    const stagingRoot = fs.mkdtempSync(path.join(stagingParent, "run-"));
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
        sourceHermesTool: DEER_FLOW_PRESENT_TOOL,
      });
      return { ok: true, artifact };
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `${filename}: ${error.message}` : `${filename} could not be stored.`,
    };
  }
}
