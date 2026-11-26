export interface WebTextAnchor {
  id: string;
  start: number;
  end: number;
  quote: string;
  prefix?: string;
  suffix?: string;
}

export interface WebTextHighlight extends WebTextAnchor {
  color?: "blue" | "green" | "pink" | "purple";
  note?: string;
  mode?: "chat" | "inline";
  conversationId?: string;
}

export interface BrowserSelection {
  text: string;
  title: string;
  url: string;
  requestId?: string;
  reference?: WebTextAnchor & { mode: "chat" | "inline"; sourceMessageId: string; sourceUrl: string; sourceTitle: string };
  conversationId?: string;
}

/** Fragments identify SPA routes too; only a text-fragment scroll hint is removed. */
export function webHighlightUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = url.hash.split(":~:text=")[0]!;
    return url.href.length <= 1800 ? url.href : null;
  } catch { return null; }
}

export function normalizeWebTextHighlight(value: unknown): WebTextHighlight | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.id) ||
      typeof entry.quote !== "string" || !entry.quote.trim() || entry.quote.length > 4000 ||
      !Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.end) ||
      (entry.start as number) < 0 || (entry.end as number) > 1_000_000 ||
      (entry.end as number) - (entry.start as number) !== entry.quote.length) return null;
  return {
    id: entry.id, start: entry.start as number, end: entry.end as number, quote: entry.quote,
    ...(typeof entry.prefix === "string" ? { prefix: entry.prefix.slice(-160) } : {}),
    ...(typeof entry.suffix === "string" ? { suffix: entry.suffix.slice(0, 160) } : {}),
    ...(["blue", "green", "pink", "purple"].includes(entry.color as string) ? { color: entry.color as WebTextHighlight["color"] } : {}),
    ...(typeof entry.note === "string" && entry.note.trim() ? { note: entry.note.trim().slice(0, 4000) } : {}),
    ...(entry.mode === "chat" || entry.mode === "inline" ? { mode: entry.mode } : {}),
    ...(typeof entry.conversationId === "string" && /^conv_[A-Za-z0-9_-]{1,120}$/.test(entry.conversationId) ? { conversationId: entry.conversationId } : {}),
  };
}

export type WebSelectionAction = { action: "select" | "open" | "position" | "dismiss"; entry: WebTextHighlight; anchor: { x: number; y: number; height?: number }; visible?: boolean };

/** This transport carries annotation data only; the native owner supplies URL and storage key. */
export function parseWebSelectionAction(value: string): WebSelectionAction | null {
  if (value.length > 100_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "breadboard-selection:" || url.hostname !== "annotation") return null;
    const data = JSON.parse(url.searchParams.get("data") ?? "null");
    if (!["select", "open", "position", "dismiss"].includes(data?.action) || !data.anchor ||
        ![data.anchor.x, data.anchor.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20000)) return null;
    if (data.anchor.height !== undefined && (typeof data.anchor.height !== "number" || !Number.isFinite(data.anchor.height) || data.anchor.height < 0 || data.anchor.height > 20000)) return null;
    const entry = normalizeWebTextHighlight(data.entry);
    return entry ? { action: data.action, entry, anchor: { x: data.anchor.x, y: data.anchor.y,
      ...(data.anchor.height !== undefined ? { height: data.anchor.height } : {}) },
      ...(typeof data.visible === "boolean" ? { visible: data.visible } : {}) } : null;
  } catch { return null; }
}

/**
 * The page says which painted passage the pointer is over (or `id: null` when
 * it leaves one), or which followed crumb was clicked. Only an id and a
 * rectangle cross over; what is shown for it is looked up in the app.
 */
export type WebHighlightPointer =
  | { action: "hover"; id: string | null; kind: "note" | "follow" | "crumb"; rect: { x: number; y: number; width: number; height: number } }
  | { action: "follow-open"; id: string };

export function parseWebHighlightPointer(value: string): WebHighlightPointer | null {
  if (value.length > 4_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "breadboard-selection:" || (url.hostname !== "hover" && url.hostname !== "follow")) return null;
    const data = JSON.parse(url.searchParams.get("data") ?? "null");
    const id = typeof data?.id === "string" && /^[A-Za-z0-9:._~%/-]{1,512}$/.test(data.id) ? data.id as string : null;
    if (url.hostname === "follow") return id ? { action: "follow-open", id } : null;
    if (data?.id !== null && !id) return null;
    if (data.kind !== "note" && data.kind !== "follow" && data.kind !== "crumb") return null;
    const rect = data.rect ?? { x: 0, y: 0, width: 0, height: 0 };
    const numbers = [rect.x, rect.y, rect.width, rect.height];
    if (!numbers.every(item => typeof item === "number" && Number.isFinite(item) && item >= -20000 && item <= 20000)) return null;
    return { action: "hover", id, kind: data.kind, rect: { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) } };
  } catch { return null; }
}
