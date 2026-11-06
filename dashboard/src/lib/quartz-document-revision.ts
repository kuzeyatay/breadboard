import { createHash } from "node:crypto";

export function quartzDocumentRevision(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Include the original separator in the prefix. Never trim authored body text. */
export function quartzDocumentParts(content: string) {
  const prefix = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n){0,2}/)?.[0] ?? "";
  return { prefix, body: content.slice(prefix.length) };
}
