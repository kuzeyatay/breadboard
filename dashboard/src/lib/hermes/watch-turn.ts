// Making an attached video reachable by the Watch skill.
//
// Watch will only open a local file that lives inside the session's authorized
// workspace — that containment is the whole reason the tool can be handed a
// path at all. An attachment lives in the chat-video store instead, which is
// deliberately somewhere else: it belongs to the user, not to whichever folder
// the Terminal happens to be pointed at.
//
// So the turn bridges the two. The stored file is linked into the workspace
// under `.breadboard/uploads/` (a hard link where the filesystem allows one, a
// copy where it does not), and the model is told the resulting path in the same
// breath as the filename the user knows it by. Nothing here widens what Watch
// may open: the path handed over is inside the root Watch already enforces.

import fs from "node:fs";
import path from "node:path";
import type { ChatAttachment } from "../chat-attachments.ts";
import { messageAttachments } from "../conversations/uploads.ts";
import { findVideoBlob } from "../conversations/video-blob-store.ts";
import { formatVideoSize, videoFormatLabel } from "../video-attachments.ts";

/** How far back a follow-up question may reach for the video it is about. */
const RECENT_MESSAGE_LOOKBACK = 12;

export type VideoAttachment = Extract<ChatAttachment, { type: "video" }>;

export interface PreparedVideo {
  name: string;
  blobId: string;
  /** Absolute path inside the session workspace, or null when linking failed. */
  workspacePath: string | null;
  sizeBytes?: number;
  formatLabel: string;
  /** True when the video came from an earlier message rather than this one. */
  carriedForward: boolean;
}

export function videoAttachments(
  attachments: readonly ChatAttachment[] | undefined,
): VideoAttachment[] {
  return (attachments ?? []).filter(
    (attachment): attachment is VideoAttachment => attachment.type === "video",
  );
}

/**
 * The video a follow-up question is most likely about: the newest one attached
 * to a recent message in this conversation.
 *
 * A second turn does not re-send the file — "what happens at 2:10?" arrives with
 * no attachment at all — so without this the video would be visible for exactly
 * one question.
 */
export function recentVideoAttachment(
  messages: ReadonlyArray<{ role: string; metadata?: string | null }>,
): VideoAttachment | null {
  for (const message of messages.slice(-RECENT_MESSAGE_LOOKBACK).reverse()) {
    if (message.role !== "user") continue;
    for (const attachment of messageAttachments(message.metadata ?? null)) {
      if (attachment.type === "video") {
        return {
          type: "video",
          name: attachment.name,
          blobId: attachment.blobId,
          format: attachment.format,
          ...(attachment.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
        };
      }
    }
  }
  return null;
}

/**
 * Put the stored bytes where Watch is allowed to read them.
 *
 * A hard link costs nothing and keeps one copy of a file that may be gigabytes;
 * across volumes there is no link to make, so the bytes are copied once and
 * reused on later turns by name.
 */
function linkIntoWorkspace(input: {
  sourcePath: string;
  workspaceRoot: string;
  fileName: string;
  byteSize: number;
}): string | null {
  const directory = path.join(input.workspaceRoot, ".breadboard", "uploads");
  const destination = path.join(directory, input.fileName);
  try {
    const existing = fs.statSync(destination, { throwIfNoEntry: false });
    if (existing?.isFile() && existing.size === input.byteSize) return destination;
    fs.mkdirSync(directory, { recursive: true });
    if (existing) fs.rmSync(destination, { force: true });
    try {
      fs.linkSync(input.sourcePath, destination);
    } catch {
      fs.copyFileSync(input.sourcePath, destination);
    }
    return destination;
  } catch {
    // The workspace may be read-only or gone. The turn still runs; the model is
    // told the video could not be opened rather than being handed a bad path.
    return null;
  }
}

export function prepareVideosForWatch(input: {
  userId: number;
  workspaceRoot: string;
  attachments: readonly VideoAttachment[];
  carriedForward?: boolean;
}): PreparedVideo[] {
  return input.attachments.map((attachment) => {
    const blob = findVideoBlob({ userId: input.userId, blobId: attachment.blobId });
    return {
      name: attachment.name,
      blobId: attachment.blobId,
      sizeBytes: attachment.sizeBytes ?? blob?.byteSize,
      formatLabel: videoFormatLabel(attachment.format),
      carriedForward: input.carriedForward === true,
      workspacePath: blob
        ? linkIntoWorkspace({
            sourcePath: blob.path,
            workspaceRoot: input.workspaceRoot,
            fileName: `${blob.blobId}.${blob.format}`,
            byteSize: blob.byteSize,
          })
        : null,
    };
  });
}

/**
 * What the model is told about the videos in play. Naming the exact `source`
 * value matters: the alternative is the model inventing a path from the
 * filename, which then fails Watch's containment check for reasons that read
 * like the video is missing.
 */
export function renderWatchVideoContext(videos: readonly PreparedVideo[]): string {
  if (videos.length === 0) return "";
  const lines = videos.map((video) => {
    const size = formatVideoSize(video.sizeBytes);
    const described = [video.formatLabel, size].filter(Boolean).join(", ");
    return video.workspacePath
      ? `- "${video.name}" (${described})${
          video.carriedForward ? ", attached earlier in this conversation" : ""
        }\n  watch_run source: ${video.workspacePath}`
      : `- "${video.name}" (${described}) — its stored file could not be opened, so say so rather than guessing at its contents.`;
  });
  return [
    "[Attached video]",
    videos.length === 1
      ? "One video is attached to this conversation:"
      : `${videos.length} videos are attached to this conversation:`,
    ...lines,
    "Answer questions about what a video contains by calling watch_run with the exact source path above — " +
      "never from its filename, and never by claiming you cannot see videos. " +
      "The report and the frame analysis it returns are the evidence; distinguish what was said from what was shown, and cite timestamps.",
    // Reading a video is this skill's job; producing a changed one is not, and
    // the Video Use editor normally takes that turn before it ever reaches a
    // model. When it does reach one anyway — an instruction phrased in a way
    // the editor's gate did not recognise — the output still has to be a
    // durable artifact of this chat. A re-encode dropped in the user's Downloads
    // folder is not a result they can reopen, revise, or find again.
    "[Server-enforced output contract] If you produce a changed version of a video — a different aspect ratio, " +
      "a trim, burnt-in captions, anything — write it inside the current authorized workspace and attach it by " +
      "calling artifact_import yourself with kind=\"video\". Do not hand the finished file to another agent to " +
      "attach: OpenMontage, ViMax, MoneyPrinter and HyperFrames all *make* videos from a brief and none of them " +
      "attaches one you already have. Never write a produced video to a user folder such as Downloads or Desktop, " +
      "and do not report it as done until Breadboard returns a ready artifact. " +
      "The artifact opens in the video studio, where the person can keep refining it by prompt.",
  ].join("\n");
}
