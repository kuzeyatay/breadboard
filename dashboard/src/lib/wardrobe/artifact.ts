// Keeping what a Wardrobe run produced inside the chat that asked for it.
//
// The wardrobe itself lives in the clone's `data/` directory and is browsed in
// the gallery, so the artifacts here are not the database — they are the two
// pictures per garment a person will want to look at, forward, or drop into
// something else later: the transparent cutout and the modeled editorial photo.
//
// Artifacts are best-effort. A chat with no runtime session still imports every
// garment; it just does not get a picture in the panel. What is never acceptable
// is losing one silently, so a run that could not open a context says so in its
// own summary rather than finishing quietly.

import {
  importArtifactImage,
} from "../hermes/artifact-image-service.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import type { ArtifactRow } from "../hermes/artifact-store.ts";
import type { LibraryItem } from "./client.ts";

export const WARDROBE_IMPORT_TOOL = "artifact_image_generate";

export interface WardrobeArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** The chat turn the pictures hang under, so they sit with their own run. */
  assistantMessageId: number | null;
}

/**
 * Resolve everything the artifact store needs from the conversation the import
 * was launched in, and open a run for the pictures to belong to. Returns null
 * when the conversation has no runtime session — the caller then reports that
 * plainly instead of dropping the images.
 */
export function openWardrobeArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  /** The Wardrobe run id, which is how its chat turn is addressed. */
  agentRunId: string;
}): WardrobeArtifactContext | null {
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

export function closeWardrobeArtifactContext(
  context: WardrobeArtifactContext | null,
  status: "completed" | "failed",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(context.runId, status === "completed" ? "completed" : "error");
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "garment"
  );
}

/** What the artifact remembers about the piece it is a picture of. */
function itemMetadata(item: LibraryItem, kind: "cutout" | "modeled"): Record<string, unknown> {
  return {
    wardrobeItem: true,
    wardrobeItemId: item.id,
    wardrobeImageKind: kind,
    wardrobeName: item.name,
    wardrobePart: item.part,
    wardrobeColor: item.color,
    wardrobeSecondaryColor: item.secondaryColor,
    wardrobeTags: item.tags,
  };
}

/** Store one of a garment's pictures as a durable, verified image artifact. */
export async function saveGarmentArtifact(input: {
  context: WardrobeArtifactContext;
  item: LibraryItem;
  buffer: Buffer;
  kind: "cutout" | "modeled";
}): Promise<ArtifactRow> {
  return await importArtifactImage({
    context: {
      userId: input.context.userId,
      conversationPublicId: input.context.conversationPublicId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      surface: input.context.surface,
      runId: input.context.runId,
    },
    buffer: input.buffer,
    title:
      input.kind === "modeled"
        ? `${input.item.name} — modeled`.slice(0, 240)
        : input.item.name.slice(0, 240),
    filename: `${slug(input.item.name)}-${input.kind}.png`,
    assistantMessageId: input.context.assistantMessageId,
    metadata: itemMetadata(input.item, input.kind),
    sourceTool: WARDROBE_IMPORT_TOOL,
  });
}
