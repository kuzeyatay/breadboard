import path from "node:path";
import type { KnowledgeNode } from "./knowledge.ts";
import { videoAttachmentFormat } from "./video-attachments.ts";
import { audioAttachmentFormat } from "./audio-attachments.ts";

export type GardenMediaKind = "audio" | "video";

/**
 * The ingest pipeline records the original media kind in `source_type`, but
 * older gardens did not use one perfectly uniform spelling. Keep the fallback
 * on the retained filename so selecting an older recording behaves the same as
 * selecting one imported today.
 */
export function gardenMediaKind(
  source: Pick<KnowledgeNode, "sourceType" | "sourceFile" | "sourceMedia">,
): GardenMediaKind | null {
  const sourceType = source.sourceType.trim().toLowerCase();
  if (sourceType.includes("audio")) return "audio";
  if (sourceType === "youtube" || sourceType.includes("video")) return "video";
  if (audioAttachmentFormat(source.sourceFile)) return "audio";
  if (videoAttachmentFormat(source.sourceFile)) return "video";
  return null;
}

/** A safe display name for the selected transcript's verbatim Markdown. */
export function gardenTranscriptName(source: KnowledgeNode): string {
  return path.basename(source.relPath.replace(/\\/g, "/")) || `${source.slug}.md`;
}
