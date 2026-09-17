import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { messageAttachments, uploadId } from "../conversations/uploads.ts";
import type { ImageMessage } from "./attachment-image.ts";

/** Compatibility for old Hermes image URLs. Never serve an arbitrary path. */
export async function legacyImageBytes(candidate: string, imageRoot: string): Promise<Buffer | null> {
  try {
    const [root, file] = await Promise.all([realpath(imageRoot), realpath(candidate)]);
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) ||
        !/\.(jpg|jpeg|png|webp|gif)$/i.test(file)) return null;
    const info = await stat(file);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) return null;
    return await readFile(file);
  } catch { return null; }
}

export function ownedImageUpload(bytes: Buffer, messages: readonly ImageMessage[]): string | null {
  for (const message of messages) {
    const attachments = messageAttachments(message.metadata);
    for (let index = 0; index < attachments.length; index++) {
      const attachment = attachments[index];
      if (attachment.type !== "image") continue;
      const match = /^data:image\/[a-z+.-]+;base64,([a-z0-9+/=\s]+)$/i.exec(attachment.dataUrl);
      if (match && Buffer.from(match[1], "base64").equals(bytes)) return uploadId(message.id, index);
    }
  }
  return null;
}
