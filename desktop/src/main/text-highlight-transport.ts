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
