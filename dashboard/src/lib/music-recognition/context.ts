import { isAudioBlobId } from "../audio-attachments.ts";
import { selectTrack, type ResolvedTrack } from "../audio-analyzer/tracks.ts";
import { MusicRecognitionError } from "./errors.ts";

export const MUSIC_RECOGNITION_SKILL = "recognize-music";

export type ResolvedRecognitionTrack = ResolvedTrack & { path: string };

export function resolveMusicRecognitionTrack(
  tracks: readonly ResolvedTrack[],
  args: Record<string, unknown>,
): ResolvedRecognitionTrack {
  const blobId = typeof args.blobId === "string" ? args.blobId.trim() : "";
  const attachmentId =
    typeof args.attachmentId === "string" ? args.attachmentId.trim() : "";
  if (Boolean(blobId) === Boolean(attachmentId)) {
    throw new MusicRecognitionError(
      "music_reference_required",
      "Pass exactly one of blobId or attachmentId from the attached-audio context.",
      400,
    );
  }

  const selected = blobId
    ? isAudioBlobId(blobId)
      ? tracks.find((track) => track.blobId === blobId)
      : undefined
    : selectTrack(tracks, attachmentId);
  if (!selected?.path) {
    throw new MusicRecognitionError(
      "music_attachment_not_found",
      "That audio attachment is not available in this conversation.",
      400,
    );
  }
  return selected as ResolvedRecognitionTrack;
}

export function renderMusicRecognitionContext(tracks: readonly ResolvedTrack[]): string {
  const available = tracks.filter((track) => track.path);
  if (available.length === 0) return "";
  return [
    "[Attached audio — song identification available]",
    "Use only the exact short reference below with music_recognize; never send raw audio or a path.",
    ...available.map(
      (track) =>
        `- ${track.name}${track.carriedForward ? " (from an earlier message)" : ""}\n` +
        `  music_recognize blobId: ${track.blobId}`,
    ),
  ].join("\n");
}
