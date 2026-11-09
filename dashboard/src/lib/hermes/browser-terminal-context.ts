import { systemPromptText } from "../system-prompts/service.ts";
import { type BrowserTerminalAccess, parseBrowserTerminalAccess } from "../browser-terminal.ts";

export interface BrowserTerminalPage {
  source?: "voice";
  surface?: "page" | "app";
  app?: Pick<BrowserTerminalPage, "url" | "title" | "text" | "selection" | "scrollY" | "viewportHeight" | "pageHeight">;
  url: string;
  title: string;
  capturedAt: string;
  text: string;
  links?: Array<{ text: string; url: string; downloadUrl?: string }>;
  selection: string;
  scrollY: number;
  viewportHeight: number;
  pageHeight: number;
  screenshot?: { dataUrl: string; width: number; height: number };
}

type Binding = { access: BrowserTerminalAccess; expires: number };
const shared = globalThis as typeof globalThis & { __browserTerminalBindings?: Map<number, Binding> };
const bindings = shared.__browserTerminalBindings ??= new Map<number, Binding>();

export function setBrowserTerminalContext(sessionId: number, access?: BrowserTerminalAccess): void {
  for (const [id, value] of bindings) if (value.expires < Date.now()) bindings.delete(id);
  if (!access) bindings.delete(sessionId);
  else bindings.set(sessionId, { access, expires: Date.now() + 30 * 60_000 });
}

export function getBrowserTerminalContext(sessionId: number): BrowserTerminalAccess | undefined {
  const binding = bindings.get(sessionId);
  if (!binding || binding.expires < Date.now()) { bindings.delete(sessionId); return undefined; }
  return binding.access;
}

export async function readBrowserTerminal(
  access: BrowserTerminalAccess,
  action: "read" | "screenshot" | "scroll" = "read",
  direction?: "up" | "down" | "top" | "bottom",
  surface?: "page" | "app",
): Promise<BrowserTerminalPage> {
  if (!parseBrowserTerminalAccess(access)) throw new Error("Invalid browser connection.");
  const response = await fetch(`http://127.0.0.1:${access.port}/browser-terminal`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access.token}` },
    body: JSON.stringify({ action, direction, surface }), redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The browser is unavailable.");
  return result as BrowserTerminalPage;
}

/** Binary transport for Garden imports; never returns file bytes to the model. */
export async function downloadBrowserTerminalSource(access: BrowserTerminalAccess, url: string): Promise<File> {
  if (!parseBrowserTerminalAccess(access)) throw new Error("Invalid browser connection.");
  const response = await fetch(`http://127.0.0.1:${access.port}/browser-terminal`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access.token}` },
    body: JSON.stringify({ action: "download", url }), redirect: "error", signal: AbortSignal.timeout(95_000),
  }).catch(() => {
    throw new Error("The browser download was interrupted or the linked tab is unavailable. Check the source tab before retrying.");
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "The browser file could not be downloaded.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The browser returned no file.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024 * 1024 + 40) throw new Error("The browser file exceeds the 64 MiB download limit.");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("limit")) throw error;
    throw new Error("The browser download was interrupted or exceeded its limit. Check the linked page before retrying.");
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error("The browser returned an empty file.");
  const received = Buffer.concat(chunks);
  const transferId = response.headers.get("x-breadboard-transfer-id") ?? "";
  if (!/^[a-f0-9]{32}$/.test(transferId) || received.length <= 40 ||
      received.subarray(-40, -8).toString("ascii") !== transferId ||
      received.readBigUInt64BE(received.length - 8) !== BigInt(received.length - 40)) {
    throw new Error("The browser download was interrupted before completion. No file was imported; retry from the source tab.");
  }
  const bytes = received.subarray(0, -40);
  if (/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(bytes.subarray(0, 1024).toString())) {
    throw new Error("The link returned a login or preview page instead of a file. Use its download link.");
  }
  let name: string;
  try { name = decodeURIComponent(response.headers.get("x-breadboard-filename") ?? "source"); }
  catch { throw new Error("The browser returned an invalid filename."); }
  name = name.replaceAll("\\", "/").split("/").pop()!.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 180) || "source";
  const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
  if (/\.pdf$/i.test(name) && !pdf) throw new Error("The downloaded file is not a PDF. Check the download link and your sign-in.");
  if (pdf && !/\.pdf$/i.test(name)) name += ".pdf";
  return new File([bytes], name, { type: pdf ? "application/pdf" : "application/octet-stream" });
}

export async function browserTerminalPrompt(
  access?: BrowserTerminalAccess,
  toolsAvailable = true,
  options: { onDemand?: boolean; userId?: number | null } = {},
): Promise<string> {
  if (!access) return "";
  if (options.onDemand && toolsAvailable) {
    // A linked view is a capability, not the topic of every spoken turn.
    // Avoid both the bridge round trip and unsolicited screen descriptions.
    return [
      systemPromptText("browser-context-1", options.userId),
      systemPromptText("browser-context-2", options.userId),
      systemPromptText("browser-context-3", options.userId),
      systemPromptText("browser-context-4", options.userId),
    ].join("\n\n");
  }
  try {
    const page = await readBrowserTerminal(access);
    return [
      page.source === "voice"
        ? systemPromptText("browser-context-5", options.userId)
        : systemPromptText("browser-context-6", options.userId),
      toolsAvailable
        ? page.source === "voice"
          ? systemPromptText("browser-context-7", options.userId)
          : systemPromptText("browser-context-8", options.userId)
        : systemPromptText("browser-context-9", options.userId),
      ...(toolsAvailable ? [systemPromptText("browser-context-10", options.userId)] : []),
      ...(toolsAvailable ? [systemPromptText("browser-context-11", options.userId)] : []),
      systemPromptText("browser-context-12", options.userId),
      JSON.stringify({ url: page.url, title: page.title, capturedAt: page.capturedAt, text: page.text, links: page.links, selection: page.selection,
        ...(page.source === "voice" ? { surface: page.surface, app: page.app } : {}) }),
    ].join("\n\n");
  } catch {
    return systemPromptText("browser-context-13", options.userId);
  }
}
