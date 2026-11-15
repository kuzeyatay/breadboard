// Keep the dashboard contract inside its Turbopack project boundary. The
// desktop has the same contract; browser-annotation-contract-parity.test.mjs
// verifies that normalization and identity stay aligned across both builds.
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
    // A link to a passage (#:~:text=...) is the same page as the bare address.
    const hash = url.hash.split(":~:text=")[0]!;
    url.hash = hash === "#" ? "" : hash;
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

export function annotationTargetKey(target: BrowserAnnotationTarget): string {
  return JSON.stringify([target.kind, target.quote ?? "", target.prefix ?? "", target.suffix ?? "",
    target.mediaUrl ?? target.selector ?? "", target.time ?? null]);
}

export interface AnnotationMessage {
  id: string;
  author: string;
  body: string;
  source: string | null;
  createdAt: string;
  own: boolean;
  /** Crumbs: the author's AT Protocol identity, when the message came from the network. */
  handle?: string | null;
  avatar?: string | null;
  did?: string;
  /** An organization message whose sender signature did not verify. */
  unverified?: boolean;
  /** An organization admin may delete other members' messages. */
  canDelete?: boolean;
  /** Crumbs: the community note readers found helpful, and how many notes exist. */
  note?: { uri: string; body: string; source: string | null };
  noteCount?: number;
}
export interface AnnotationThread {
  id: string;
  target: BrowserAnnotationTarget;
  roomPublicId: string | null;
  rootMessageId: number | null;
  count: number;
  organizationHref?: string;
  /** The first comment, shown when hovering the marker in the page. */
  preview?: string;
}
export interface AnnotationFlag { id: number; author: string; reason: string; own: boolean; }
export interface AnnotationResponse {
  threads: AnnotationThread[];
  thread: AnnotationThread | null;
  messages: AnnotationMessage[];
  flags: AnnotationFlag[];
  /** Something the reader should know about the last action, such as a crumb waiting for review. */
  notice?: string;
}
