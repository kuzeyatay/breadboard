import type { IpcMain, WebContents } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-contract";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Only the authenticated app main frame may use the fixed annotation route. */
export function registerTextHighlightHandler(ipc: Pick<IpcMain, "handle">, options: {
  ownsSender: (sender: WebContents) => boolean;
  dashboardUrl: () => string | null;
}): void {
  ipc.handle(IPC_CHANNELS.textHighlightRequest, async (event, body: unknown) => {
    const dashboardUrl = options.dashboardUrl();
    let trusted = false;
    try {
      trusted = Boolean(dashboardUrl && options.ownsSender(event.sender) &&
        event.senderFrame === event.sender.mainFrame &&
        new URL(event.senderFrame.url).origin === new URL(dashboardUrl).origin);
    } catch { /* A detached frame has no save authority. */ }
    if (!trusted) throw new Error("Highlights can only be saved from Breadboard.");
    return sendTextHighlightRequest({ dashboardUrl: dashboardUrl!, body,
      readCookies: url => event.sender.session.cookies.get({ url }) });
  });
}

/** Node's transport remains available when Chromium's HTTP/1 slots are all
 * occupied by streams. The API still authenticates and commits every operation. */
export async function sendTextHighlightRequest(input: {
  dashboardUrl: string;
  body: unknown;
  readCookies: (url: string) => Promise<Array<{ name: string; value: string }>>;
  fetch?: typeof fetch;
}): Promise<{ status: number; body: string }> {
  if (typeof input.body !== "string" || Buffer.byteLength(input.body) > MAX_BODY_BYTES) {
    throw new Error("Invalid highlight request.");
  }
  const parsed = JSON.parse(input.body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).some(key => !["key", "entries", "mutations"].includes(key))) {
    throw new Error("Invalid highlight request.");
  }
  const target = new URL("/api/text-highlights", input.dashboardUrl);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
      target.username || target.password) throw new Error("Invalid highlight origin.");
  const cookies = await input.readCookies(target.href);
  const response = await (input.fetch ?? fetch)(target, {
    method: "POST", body: input.body,
    headers: { "Content-Type": "application/json", Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  // Bound IPC responses without truncating a successfully saved document.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64 * 1024 * 1024) { await reader.cancel(); throw new Error("Highlight response is too large."); }
      chunks.push(chunk.value);
    }
  } finally { reader?.releaseLock(); }
  return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
}

/** A passage that people you follow left crumbs on, as the dashboard reports it for one page. */
export interface FollowedHighlight {
  id: string;
  target: { kind: string; url: string; quote?: string; prefix?: string; suffix?: string; title?: string };
  people: Array<{ did: string; handle: string | null; name: string; comment: string }>;
}

/** Reads, from this machine's own dashboard, what people you follow highlighted on `pageUrl`. */
export async function fetchFollowedHighlights(input: {
  dashboardUrl: string;
  pageUrl: string;
  readCookies: (url: string) => Promise<Array<{ name: string; value: string }>>;
  fetch?: typeof fetch;
}): Promise<FollowedHighlight[]> {
  const target = new URL("/api/crumbs", input.dashboardUrl);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
      target.username || target.password) return [];
  target.searchParams.set("view", "page-follows");
  target.searchParams.set("url", input.pageUrl);
  const cookies = await input.readCookies(target.href);
  const response = await (input.fetch ?? fetch)(target, {
    headers: { Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null) as { highlights?: unknown } | null;
  if (!Array.isArray(data?.highlights)) return [];
  return data.highlights.flatMap((item: unknown): FollowedHighlight[] => {
    const value = item as FollowedHighlight;
    if (!value || typeof value.id !== "string" || !value.target || value.target.kind !== "text" || typeof value.target.quote !== "string" || !value.target.quote ||
        !Array.isArray(value.people) || !value.people.length) return [];
    const people = value.people.filter(person => person && typeof person.did === "string" && typeof person.name === "string")
      .map(person => ({ did: person.did, handle: typeof person.handle === "string" ? person.handle : null, name: person.name.slice(0, 80), comment: String(person.comment ?? "").slice(0, 280) }));
    return people.length ? [{ id: value.id, target: { kind: "text", url: String(value.target.url), quote: value.target.quote.slice(0, 4000),
      prefix: typeof value.target.prefix === "string" ? value.target.prefix.slice(-160) : "", suffix: typeof value.target.suffix === "string" ? value.target.suffix.slice(0, 160) : "",
      ...(typeof value.target.title === "string" ? { title: value.target.title } : {}) }, people }] : [];
  }).slice(0, 100);
}
