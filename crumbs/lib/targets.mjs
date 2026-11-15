// The same anchor contract as dashboard/src/lib/browser-annotations.ts.
// test/contract-parity.test.mjs keeps the two aligned.
import { createHash } from "node:crypto";

export function annotationPageUrl(value) {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const hash = url.hash.split(":~:text=")[0];
    url.hash = hash === "#" ? "" : hash;
    return url.href;
  } catch { return null; }
}

export function normalizeAnnotationTarget(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const url = annotationPageUrl(input.url);
  if (!url || !["page", "text", "image", "video"].includes(String(input.kind))) return null;
  const target = { kind: input.kind, url, title: typeof input.title === "string" ? input.title.trim().slice(0, 300) : new URL(url).hostname };
  if (target.kind === "text") {
    if (typeof input.quote !== "string" || !input.quote.trim() || input.quote.length > 4000) return null;
    target.quote = input.quote;
    target.prefix = typeof input.prefix === "string" ? input.prefix.slice(-160) : "";
    target.suffix = typeof input.suffix === "string" ? input.suffix.slice(0, 160) : "";
  }
  if (target.kind === "image" || target.kind === "video") {
    const mediaUrl = annotationPageUrl(input.mediaUrl);
    if (mediaUrl) target.mediaUrl = mediaUrl;
    if (typeof input.selector === "string" && input.selector.length <= 1000) target.selector = input.selector;
    if (!target.mediaUrl && !target.selector) return null;
    if (target.kind === "video" && input.time !== undefined) {
      if (typeof input.time !== "number" || !Number.isFinite(input.time) || input.time < 0 || input.time > 604800) return null;
      target.time = Math.round(input.time);
    }
  }
  return target;
}

export function annotationTargetKey(target) {
  return JSON.stringify([target.kind, target.quote ?? "", target.prefix ?? "", target.suffix ?? "",
    target.mediaUrl ?? target.selector ?? "", target.time ?? null]);
}

export const targetDigest = target => createHash("sha256").update(annotationTargetKey(target)).digest("hex");

export const COLLECTIONS = {
  highlight: "com.breadboard.highlight",
  report: "com.breadboard.report",
  follow: "com.breadboard.follow",
  handle: "com.breadboard.handle",
  key: "com.breadboard.key",
  note: "com.breadboard.note",
  rating: "com.breadboard.rating",
};

/** A `com.breadboard.highlight` record, or null when it is not one we show. */
export function parseHighlightRecord(record) {
  if (!record || typeof record !== "object") return null;
  const target = normalizeAnnotationTarget({ ...(record.target ?? {}), url: record.url, title: record.title });
  const comment = typeof record.comment === "string" ? record.comment.trim() : "";
  if (!target || !comment || comment.length > 4000) return null;
  const createdAt = typeof record.createdAt === "string" && !Number.isNaN(Date.parse(record.createdAt)) ? new Date(record.createdAt).toISOString() : null;
  if (!createdAt) return null;
  const source = record.source ? annotationPageUrl(record.source) : null;
  return { target, comment, source, createdAt };
}
