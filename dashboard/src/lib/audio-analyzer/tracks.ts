// Which attached song a request is about, and where its bytes are.
//
// The model never names a path. It names a *track* — the filename it was shown
// — and the path is resolved here, from a message in the caller's own
// conversation, out of the store whose directory layout already proves whose
// the file is. That is the whole safety property: a tool that reads any path a
// model writes is a tool that reads the user's disk, and this one cannot.
//
// Reaching back through recent messages matters as much as reading this one. A
// second question ("what happens at 2:10?") arrives with no attachment at all,
// and without a lookback a song would be analyzable exactly once.

import { formatAudioSize, audioFormatLabel } from "../audio-attachments.ts";
import type { ChatAttachment, ChatMessageAttachment } from "../chat-attachments.ts";
import { findAudioBlob } from "../conversations/audio-blob-store.ts";
import { messageAttachments } from "../conversations/uploads.ts";

/** How far back a follow-up may reach for the track it is about. */
export const RECENT_MESSAGE_LOOKBACK = 12;

export type AudioAttachment = Extract<ChatMessageAttachment, { type: "audio" }>;

export interface ResolvedTrack {
  name: string;
  blobId: string;
  /** Absolute path to the stored file, or null when it is no longer there. */
  path: string | null;
  formatLabel: string;
  sizeBytes?: number;
  /** True when the track came from an earlier message rather than the newest one. */
  carriedForward: boolean;
}

interface MessageLike {
  role: string;
  metadata?: string | null;
}

/** Whether this turn's own attachments include a song, without touching disk. */
export function hasAnalyzableAttachment(
  attachments: readonly ChatAttachment[] | undefined,
): boolean {
  return (attachments ?? []).some((attachment) => attachment.type === "audio");
}

/** The same question asked of earlier messages. */
export function hasRecentAnalyzableAudio(messages: readonly MessageLike[]): boolean {
  return messages
    .slice(-RECENT_MESSAGE_LOOKBACK)
    .some(
      (message) =>
        message.role === "user" &&
        messageAttachments(message.metadata ?? null).some(
          (attachment) => attachment.type === "audio",
        ),
    );
}

function resolve(
  userId: number,
  attachment: AudioAttachment,
  carriedForward: boolean,
): ResolvedTrack {
  const blob = findAudioBlob({ userId, blobId: attachment.blobId });
  return {
    name: attachment.name,
    blobId: attachment.blobId,
    path: blob?.path ?? null,
    formatLabel: audioFormatLabel(attachment.format),
    ...(attachment.sizeBytes ?? blob?.byteSize
      ? { sizeBytes: attachment.sizeBytes ?? blob?.byteSize }
      : {}),
    carriedForward,
  };
}

/** This turn's own attachments, resolved. The composer sends these before any message exists. */
export function tracksFromAttachments(
  userId: number,
  attachments: readonly ChatAttachment[] | undefined,
): ResolvedTrack[] {
  return (attachments ?? []).flatMap((attachment) =>
    attachment.type === "audio"
      ? [
          resolve(
            userId,
            {
              type: "audio",
              name: attachment.name,
              blobId: attachment.blobId,
              format: attachment.format,
              ...(attachment.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
            },
            false,
          ),
        ]
      : [],
  );
}

/**
 * Every analyzable track in play, newest message first, deduplicated by name so
 * a song quoted forward through several turns is offered once.
 */
export function analyzableTracks(
  userId: number,
  messages: readonly MessageLike[],
): ResolvedTrack[] {
  const seen = new Set<string>();
  const found: ResolvedTrack[] = [];
  const recent = messages.slice(-RECENT_MESSAGE_LOOKBACK);
  const newestIndex = recent.length - 1;
  for (let index = newestIndex; index >= 0; index -= 1) {
    const message = recent[index]!;
    if (message.role !== "user") continue;
    for (const attachment of messageAttachments(message.metadata ?? null)) {
      if (attachment.type !== "audio" || seen.has(attachment.name)) continue;
      seen.add(attachment.name);
      found.push(resolve(userId, attachment, index !== newestIndex));
    }
  }
  return found;
}

/** Newest first, deduplicated by name — what the tool and the context block see. */
export function mergeTracks(
  ...groups: ReadonlyArray<readonly ResolvedTrack[]>
): ResolvedTrack[] {
  const seen = new Set<string>();
  return groups.flat().filter((track) => {
    if (seen.has(track.name)) return false;
    seen.add(track.name);
    return true;
  });
}

/**
 * The track a request names, or the most recent one when it names none.
 *
 * Forgiving about case and extension on purpose: the model is quoting a
 * filename back out of a context block, and a request that failed over a `.MP3`
 * would be indistinguishable from one that failed because there was no song.
 */
export function selectTrack(
  tracks: readonly ResolvedTrack[],
  reference: string | undefined,
): ResolvedTrack | null {
  if (tracks.length === 0) return null;
  const wanted = reference?.trim().toLowerCase();
  if (!wanted) return tracks[0]!;
  const withoutExtension = (name: string) => name.toLowerCase().replace(/\.[^.]+$/, "");
  return (
    tracks.find((track) => track.name.toLowerCase() === wanted) ??
    tracks.find((track) => withoutExtension(track.name) === withoutExtension(wanted)) ??
    tracks.find((track) => track.name.toLowerCase().includes(wanted)) ??
    null
  );
}

/**
 * What the turn tells the model about the songs it can actually listen to.
 *
 * Naming the exact `track` value is the point. Without it the model invents a
 * path from the filename, which fails in a way that reads like the file is
 * missing rather than like the argument was wrong.
 */
export function renderAudioAnalysisContext(tracks: readonly ResolvedTrack[]): string {
  if (tracks.length === 0) return "";
  const lines = tracks.map((track) => {
    const described = [track.formatLabel, formatAudioSize(track.sizeBytes)]
      .filter(Boolean)
      .join(", ");
    return track.path
      ? `- "${track.name}" (${described})${
          track.carriedForward ? ", attached earlier in this conversation" : ""
        }\n  audio_analyze track: ${track.name}`
      : `- "${track.name}" (${described}) — its stored file could not be opened, so say so rather than guessing at how it sounds.`;
  });
  return [
    "[Attached audio — real analysis available]",
    tracks.length === 1
      ? "One track in this conversation can be analysed from its waveform:"
      : `${tracks.length} tracks in this conversation can be analysed from their waveforms:`,
    ...lines,
    "When the person asks about a song — how it sounds, its key, its tempo, its mix, its structure, " +
      "how two versions differ — call `audio_analyze` with the exact `track` value above. Do not answer " +
      "from the filename, from what you know about the artist, or by saying you cannot hear audio: this " +
      "tool measures the actual waveform.",
    "Start with `analysis: \"full\"` and no resolution. That returns the summary plus the section " +
      "boundaries; then zoom into an interesting section with `startTime`/`endTime` and a higher " +
      "resolution rather than asking for high resolution over the whole track.",
    "Report the measurements as measurements, and say which are meaningful for this material — key and " +
      "tempo mean little for speech or a field recording, and saying so is more useful than quoting them.",
  ].join("\n");
}
