import { createHash } from "node:crypto";

/** One durable facade identity per owned chat request. */
export function musicLaunchIdentity(userId: number, conversationPublicId: string, clientMessageId: string): string {
  return `music_${createHash("sha256").update(`${userId}:${conversationPublicId}:${clientMessageId}`).digest("hex").slice(0, 32)}`;
}
