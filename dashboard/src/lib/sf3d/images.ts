// Which attached picture a "turn this into 3D" request is about.
//
// An image attachment is not a file on disk anywhere: it travels as a data URL
// inside the message's own metadata, which is what makes a pasted screenshot
// still viewable after a reload. So there is no path to hand a tool, and the
// tool is given a *reference* instead — the attachment's name, resolved back to
// bytes here, from a message the caller already owns.
//
// Reaching back through recent messages matters as much as reading this one. A
// second request ("try that again with a quad mesh") arrives with no attachment
// at all, and without a lookback the picture would be reconstructable exactly
// once.

import { messageAttachments } from "../conversations/uploads.ts";
import type { ChatAttachment, ChatMessageAttachment } from "../chat-attachments.ts";

/** How far back a follow-up may reach for the picture it is about. */
export const RECENT_MESSAGE_LOOKBACK = 12;

export type ImageAttachment = Extract<ChatMessageAttachment, { type: "image" }>;

export interface ResolvedImage {
  name: string;
  bytes: Buffer;
  mimeType: string;
  /** True when the picture came from an earlier message rather than the newest one. */
  carriedForward: boolean;
}

const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=\s]+)$/i;

/** SF3D reads a still. An animated GIF has no single frame to reconstruct from. */
const RECONSTRUCTABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Whether an attachment *could* be reconstructed, without decoding it.
 *
 * The distinction from `decodeImageAttachment` is not pedantry: the intent
 * chain asks this question on every single turn, and a conversation carrying a
 * few screenshots would otherwise base64-decode several megabytes per message
 * only to compare a count against zero. Matching the data URL's header is
 * enough to answer it.
 */
export function isReconstructableAttachment(dataUrl: string): boolean {
  const header = /^data:(image\/[a-z+.-]+);base64,/i.exec(dataUrl.trimStart());
  return header !== null && RECONSTRUCTABLE.has(header[1]!.toLowerCase());
}

export function decodeImageAttachment(attachment: ImageAttachment): ResolvedImage | null {
  const match = IMAGE_DATA_URL.exec(attachment.dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1]!.toLowerCase();
  if (!RECONSTRUCTABLE.has(mimeType)) return null;
  const bytes = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  if (bytes.byteLength === 0) return null;
  return { name: attachment.name, bytes, mimeType, carriedForward: false };
}

/**
 * The reconstructable pictures among this turn's own attachments.
 *
 * The composer's attachments are not the transcript's: they arrive as
 * `ChatAttachment`, before the message they will be recorded on exists. Both
 * the intent chain and the context block run at exactly that moment, so they
 * need this rather than a transcript read.
 */
export function reconstructableFromAttachments(
  attachments: readonly ChatAttachment[] | undefined,
): ResolvedImage[] {
  return (attachments ?? []).flatMap((attachment) => {
    if (attachment.type !== "image") return [];
    const decoded = decodeImageAttachment({
      type: "image",
      name: attachment.name,
      dataUrl: attachment.dataUrl,
    });
    return decoded ? [decoded] : [];
  });
}

/** The same question as above, asked without decoding anything. */
export function hasReconstructableAttachment(
  attachments: readonly ChatAttachment[] | undefined,
): boolean {
  return (attachments ?? []).some(
    (attachment) =>
      attachment.type === "image" && isReconstructableAttachment(attachment.dataUrl),
  );
}

/** Newest first, deduplicated by name — what the tool and the context block see. */
export function mergeImages(
  ...groups: ReadonlyArray<readonly ResolvedImage[]>
): ResolvedImage[] {
  const seen = new Set<string>();
  return groups.flat().filter((image) => {
    if (seen.has(image.name)) return false;
    seen.add(image.name);
    return true;
  });
}

interface MessageLike {
  role: string;
  metadata?: string | null;
}

/** Whether an earlier message carries a picture, without decoding one. */
export function hasReconstructableImages(
  messages: readonly MessageLike[],
): boolean {
  return messages
    .slice(-RECENT_MESSAGE_LOOKBACK)
    .some(
      (message) =>
        message.role === "user" &&
        messageAttachments(message.metadata ?? null).some(
          (attachment) =>
            attachment.type === "image" && isReconstructableAttachment(attachment.dataUrl),
        ),
    );
}

/**
 * Every reconstructable picture in play, newest message first, deduplicated by
 * name so a picture quoted forward through several turns is offered once.
 *
 * This is the expensive one — it decodes — so it is called only once the skill
 * is actually selected for the turn.
 */
export function reconstructableImages(
  messages: readonly MessageLike[],
): ResolvedImage[] {
  const seen = new Set<string>();
  const found: ResolvedImage[] = [];
  const recent = messages.slice(-RECENT_MESSAGE_LOOKBACK);
  const newestIndex = recent.length - 1;
  for (let index = newestIndex; index >= 0; index -= 1) {
    const message = recent[index]!;
    if (message.role !== "user") continue;
    for (const attachment of messageAttachments(message.metadata ?? null)) {
      if (attachment.type !== "image") continue;
      const decoded = decodeImageAttachment(attachment);
      if (!decoded || seen.has(decoded.name)) continue;
      seen.add(decoded.name);
      found.push({ ...decoded, carriedForward: index !== newestIndex });
    }
  }
  return found;
}

/**
 * The picture a request names, or the most recent one when it names none.
 *
 * Matching is by name and is deliberately forgiving about case and extension:
 * the model is quoting a filename back out of a context block, and a request
 * that fails because of a `.PNG` would be indistinguishable from one that
 * failed because there was no picture.
 */
export function selectImage(
  images: readonly ResolvedImage[],
  reference: string | undefined,
): ResolvedImage | null {
  if (images.length === 0) return null;
  const wanted = reference?.trim().toLowerCase();
  if (!wanted) return images[0]!;
  const withoutExtension = (name: string) => name.toLowerCase().replace(/\.[^.]+$/, "");
  return (
    images.find((image) => image.name.toLowerCase() === wanted) ??
    images.find((image) => withoutExtension(image.name) === withoutExtension(wanted)) ??
    images.find((image) => image.name.toLowerCase().includes(wanted)) ??
    null
  );
}

/**
 * What the turn tells the model about the pictures it could reconstruct.
 *
 * Naming the exact `image` value is the point. Without it the model invents a
 * path from the filename, which fails in a way that reads like the picture is
 * missing rather than like the argument was wrong — the same trap the video
 * context block exists to avoid.
 */
export function renderImageTo3dContext(images: readonly ResolvedImage[]): string {
  if (images.length === 0) return "";
  const lines = images.map((image) => {
    const size = `${Math.max(1, Math.round(image.bytes.byteLength / 1024))} KB`;
    return `- "${image.name}" (${image.mimeType}, ${size})${
      image.carriedForward ? ", attached earlier in this conversation" : ""
    }\n  image_to_3d image: ${image.name}`;
  });
  return [
    "[Attached picture — 3D reconstruction available]",
    images.length === 1
      ? "One picture in this conversation can be turned into a 3D model:"
      : `${images.length} pictures in this conversation can be turned into 3D models:`,
    ...lines,
    "When the person asks for a 3D model, a mesh, a printable object, or a game asset from a " +
      "picture, call image_to_3d with the exact `image` value above. Do not describe how they could " +
      "make one themselves, and do not say you cannot produce 3D files — this tool reconstructs one.",
    "The tool returns a durable GLB artifact that opens in the 3D viewer in this chat. Report what " +
      "it produced — the artifact title, the triangle count, how long it took — and say plainly that " +
      "the geometry is inferred from a single view, so unseen sides are the model's best guess.",
  ].join("\n");
}
