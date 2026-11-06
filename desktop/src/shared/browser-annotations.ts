/** Content references shared by trusted browser chrome and the annotation API. */
export interface BrowserAnnotationTarget {
  kind: "page" | "text" | "image" | "video";
  url: string;
  title: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  mediaUrl?: string;
  selector?: string;
  time?: number;
}

export function annotationPageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = url.hash.split(":~:text=")[0]!;
    return url.href;
  } catch { return null; }
}

export function normalizeAnnotationTarget(input: unknown): BrowserAnnotationTarget | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const url = annotationPageUrl(raw.url);
  if (!url || !["page", "text", "image", "video"].includes(String(raw.kind))) return null;
  const target: BrowserAnnotationTarget = { kind: raw.kind as BrowserAnnotationTarget["kind"], url,
    title: typeof raw.title === "string" ? raw.title.trim().slice(0, 300) : new URL(url).hostname };
  if (target.kind === "text") {
    if (typeof raw.quote !== "string" || !raw.quote.trim() || raw.quote.length > 4000) return null;
    target.quote = raw.quote;
    target.prefix = typeof raw.prefix === "string" ? raw.prefix.slice(-160) : "";
    target.suffix = typeof raw.suffix === "string" ? raw.suffix.slice(0, 160) : "";
  }
  if (target.kind === "image" || target.kind === "video") {
    const mediaUrl = annotationPageUrl(raw.mediaUrl);
    if (mediaUrl) target.mediaUrl = mediaUrl;
    if (typeof raw.selector === "string" && raw.selector.length <= 1000) target.selector = raw.selector;
    if (!target.mediaUrl && !target.selector) return null;
    if (target.kind === "video" && raw.time !== undefined) {
      if (typeof raw.time !== "number" || !Number.isFinite(raw.time) || raw.time < 0 || raw.time > 604800) return null;
      target.time = Math.round(raw.time);
    }
  }
  return target;
}

/** Excludes display titles and text offsets so page edits do not split a thread. */
export function annotationTargetKey(target: BrowserAnnotationTarget): string {
  return JSON.stringify([target.kind, target.quote ?? "", target.prefix ?? "", target.suffix ?? "",
    target.mediaUrl ?? target.selector ?? "", target.time ?? null]);
}

export function browserOrganizationWidth(viewportWidth: number): number {
  return Math.max(0, Math.min(360, viewportWidth - 49));
}
