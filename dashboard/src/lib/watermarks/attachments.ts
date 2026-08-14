import fs from "node:fs";
import path from "node:path";
import { messageAttachments } from "../conversations/uploads.ts";
import { findDocumentBlob } from "../conversations/document-blob-store.ts";
import { WatermarkError } from "./scripts.ts";

// Which attached file a cleaning request is about, and where its bytes are.
//
// The model never names a path for an attachment. It names the *file* it was
// shown, and the bytes are found here, in the caller's own conversation, out of
// the stores whose directory layout already proves whose the file is. Same
// property the audio tools rely on: a tool that opens any path a model writes
// is a tool that reads the user's disk.
//
// Only two attachment kinds carry recoverable original bytes, and they happen
// to be exactly the ones that carry provenance marks: images keep a data URL in
// the message, and documents keep the uploaded file in the document blob store.

/** How far back a follow-up may reach for the file it is about. */
export const RECENT_MESSAGE_LOOKBACK = 12;

const IMAGE_DATA_URL = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i;

/** Extension for an image data URL's declared subtype. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  png: ".png",
  jpeg: ".jpg",
  jpg: ".jpg",
  webp: ".webp",
  gif: ".gif",
};

export interface CleanableAttachment {
  name: string;
  kind: "image" | "document";
  /** What the bytes should be called once staged, extension included. */
  filename: string;
  /** Materialize the original bytes at `target`. */
  stage: (target: string) => void;
  /** True when it came from an earlier message rather than the newest one. */
  carriedForward: boolean;
}

interface MessageLike {
  role: string;
  metadata?: string | null;
}

function safeFilename(name: string, fallbackExtension: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  const named = base || `attachment${fallbackExtension}`;
  return path.extname(named) ? named : `${named}${fallbackExtension}`;
}

/**
 * Every attached file in play that has recoverable bytes, newest message first,
 * deduplicated by name. A file quoted forward through several turns is offered
 * once, and one whose bytes are gone is not offered at all — the tool would
 * only fail on it in a way that reads like the file never existed.
 */
export function cleanableAttachments(
  userId: number,
  messages: readonly MessageLike[],
): CleanableAttachment[] {
  const seen = new Set<string>();
  const found: CleanableAttachment[] = [];
  const recent = messages.slice(-RECENT_MESSAGE_LOOKBACK);
  const newestIndex = recent.length - 1;
  for (let index = newestIndex; index >= 0; index -= 1) {
    const message = recent[index]!;
    if (message.role !== "user") continue;
    for (const attachment of messageAttachments(message.metadata ?? null)) {
      if (seen.has(attachment.name)) continue;
      const carriedForward = index !== newestIndex;
      if (attachment.type === "image") {
        const match = IMAGE_DATA_URL.exec(attachment.dataUrl);
        if (!match) continue;
        const payload = match[2]!;
        const extension = IMAGE_EXTENSIONS[match[1]!.toLowerCase()] ?? ".png";
        seen.add(attachment.name);
        found.push({
          name: attachment.name,
          kind: "image",
          filename: safeFilename(attachment.name, extension),
          carriedForward,
          stage: (target) => fs.writeFileSync(target, Buffer.from(payload, "base64")),
        });
      } else if (attachment.type === "document") {
        const blob = findDocumentBlob({ userId, blobId: attachment.blobId });
        if (!blob) continue;
        seen.add(attachment.name);
        found.push({
          name: attachment.name,
          kind: "document",
          filename: safeFilename(attachment.name, `.${blob.format}`),
          carriedForward,
          stage: (target) => fs.copyFileSync(blob.path, target),
        });
      }
    }
  }
  return found;
}

/**
 * The attachment a request names. Forgiving about case and extension for the
 * same reason the audio tools are: the model is quoting a filename back out of
 * a context block, and a request that failed over `.PNG` would be
 * indistinguishable from one that failed because nothing was attached.
 */
export function selectAttachment(
  attachments: readonly CleanableAttachment[],
  reference: string,
): CleanableAttachment {
  const wanted = reference.trim().toLowerCase();
  if (attachments.length === 0) {
    throw new WatermarkError(
      404,
      "watermarks_no_attachment",
      "No attached image or document with recoverable bytes was found in this conversation. " +
        "Ask the user to attach the file, or pass a workspace-relative `file` instead.",
    );
  }
  const withoutExtension = (name: string) => name.toLowerCase().replace(/\.[^.]+$/, "");
  const found =
    attachments.find((item) => item.name.toLowerCase() === wanted) ??
    attachments.find((item) => withoutExtension(item.name) === withoutExtension(wanted)) ??
    attachments.find((item) => item.name.toLowerCase().includes(wanted));
  if (!found) {
    throw new WatermarkError(
      404,
      "watermarks_attachment_not_found",
      `No attached file matches ${JSON.stringify(reference)}. Attached: ${attachments
        .map((item) => item.name)
        .join(", ")}.`,
    );
  }
  return found;
}

// There is deliberately no per-turn context block here, unlike the audio
// tools'. That block exists because a song is unreadable to the model — without
// it the model answers about the music from memory, which sounds right and is
// wrong. Nothing like that can happen here: "strip the metadata from this
// photo" is an explicit request, the tool schema already says `attachment`
// takes the name the file was attached under, and these tools are offered on
// every authenticated turn rather than gated behind a selected skill. A block
// on every turn carrying an attachment would be prompt weight buying nothing.
