import type { IpcMain, WebContents } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-contract";

const ROUTES = new Set([
  "/api/models", "/api/cliproxy/status", "/api/usage-limits",
  "/api/browser/weather", "/api/calendar/calendars", "/api/calendar/events",
  "/api/assistant-preferences", "/api/profile/page-appearance",
]);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export type TerminalDataResponse = { status: number; body: string };

/** This is a read-only route allowlist, never an arbitrary authenticated proxy. */
export function terminalDataUrl(path: unknown, dashboardUrl: string): URL {
  const base = new URL(dashboardUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password ||
      typeof path !== "string" || path.length > 8192 || !path.startsWith("/api/") || /[\\#]/.test(path)) throw new Error("Invalid Terminal data route.");
  const target = new URL(path, base);
  if (target.origin !== base.origin || !ROUTES.has(target.pathname) || path.split("?")[0] !== target.pathname) throw new Error("Invalid Terminal data route.");
  return target;
}

/** Bypass occupied Chromium HTTP/1 slots; the same API still authenticates each
 * read using the sending app session. No account data is cached here. */
export async function readTerminalData(input: {
  dashboardUrl: string; path: unknown; signal: AbortSignal;
  readCookies: (url: string) => Promise<Array<{ name: string; value: string }>>;
  fetch?: typeof fetch;
}): Promise<TerminalDataResponse> {
  const target = terminalDataUrl(input.path, input.dashboardUrl);
  const cookies = await input.readCookies(target.href);
  const response = await (input.fetch ?? fetch)(target, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { Accept: "application/json", Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Terminal data response is too large."); }
      chunks.push(chunk.value);
    }
  } finally { reader?.releaseLock(); }
  return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
}

export function registerTerminalDataHandlers(ipc: Pick<IpcMain, "handle" | "on">, options: {
  ownsSender: (sender: WebContents) => boolean;
  dashboardUrl: () => string | null;
}): void {
  const pending = new Map<WebContents, Map<string, AbortController>>();
  ipc.handle(IPC_CHANNELS.cancelTerminalData, (event, id: unknown) => {
    if (event.senderFrame === event.sender.mainFrame && typeof id === "string") pending.get(event.sender)?.get(id)?.abort();
  });
  ipc.handle(IPC_CHANNELS.readTerminalData, async (event, request: unknown): Promise<TerminalDataResponse> => {
    const dashboardUrl = options.dashboardUrl();
    let trusted = false;
    try {
      trusted = Boolean(dashboardUrl && options.ownsSender(event.sender) && event.senderFrame === event.sender.mainFrame &&
        new URL(event.senderFrame.url).origin === new URL(dashboardUrl).origin);
    } catch { /* A detached frame has no read authority. */ }
    if (!trusted) throw new Error("Terminal data is only available in Breadboard.");
    const value = request as { id?: unknown; path?: unknown } | null;
    if (!value || typeof value.id !== "string" || !/^[\w-]{1,80}$/.test(value.id) ||
        Object.keys(value).some(key => key !== "id" && key !== "path")) throw new Error("Invalid Terminal data request.");
    terminalDataUrl(value.path, dashboardUrl!);
    const sender = event.sender;
    let requests = pending.get(sender);
    if (!requests) {
      requests = new Map(); pending.set(sender, requests);
      const ownRequests = requests;
      const cancel = () => { for (const controller of ownRequests.values()) controller.abort(); };
      const navigated = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) cancel(); };
      sender.on("did-start-navigation", navigated);
      sender.once("destroyed", () => { cancel(); pending.delete(sender); sender.removeListener("did-start-navigation", navigated); });
    }
    if (requests.has(value.id) || requests.size >= 12) throw new Error("Too many Terminal data reads.");
    const controller = new AbortController(); requests.set(value.id, controller);
    try {
      return await readTerminalData({ dashboardUrl: dashboardUrl!, path: value.path, signal: controller.signal,
        readCookies: url => sender.session.cookies.get({ url }) });
    } catch {
      return { status: 503, body: JSON.stringify({ error: "Couldn’t read Terminal data. Try again." }) };
    } finally { requests.delete(value.id); }
  });
}
