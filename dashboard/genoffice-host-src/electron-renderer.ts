/**
 * The `electron` module as a GenOffice preload sees it inside a Breadboard
 * iframe: ipcRenderer over the session's HTTP endpoint and event stream, and
 * contextBridge as plain window properties. The host's dialogs and script
 * requests are answered here, in the page.
 */
import { decodeWire, encodeWire } from "../src/lib/office/wire";

const params = new URLSearchParams(location.search);
const session = params.get("session") ?? "";
/** 0 is the main editor; a second window (the Slides audience popup) carries its webContents id. */
const wc = Number(params.get("wc")) || 0;
const popups = new Map<number, Window>();
const endpoint = `/api/office/sessions/${encodeURIComponent(session)}`;
(globalThis as Record<string, unknown>).__genofficeAssetPrefix = `${endpoint}/asset?url=md-asset://`;

type Listener = (event: unknown, ...args: unknown[]) => void;
const listeners = new Map<string, Set<Listener>>();
const toParent = (message: Record<string, unknown>) => window.parent.postMessage({ ...message, session }, location.origin);

async function call(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(encodeWire(wc ? { ...body, wc } : body)) });
  const payload = await response.json().catch(() => null) as { ok?: boolean; value?: unknown; error?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `The editor session stopped responding (${response.status}).`);
  return decodeWire(payload.value);
}

let sendQueue: Promise<unknown> = Promise.resolve();
export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => call({ action: "invoke", channel, args }),
  send(channel: string, ...args: unknown[]) {
    // Fire-and-forget messages keep their order, as they do on Electron's pipe.
    sendQueue = sendQueue.then(() => call({ action: "send", channel, args })).catch(error => console.warn(`[office] ${channel}:`, error));
  },
  sendSync() { throw new Error("Synchronous IPC is not available in Breadboard's Office editors."); },
  postMessage(channel: string, message: unknown) { this.send(channel, message); },
  on(channel: string, listener: Listener) {
    (listeners.get(channel) ?? listeners.set(channel, new Set()).get(channel)!).add(listener);
    return ipcRenderer;
  },
  once(channel: string, listener: Listener) {
    const wrapped: Listener = (event, ...args) => { ipcRenderer.removeListener(channel, wrapped); listener(event, ...args); };
    return ipcRenderer.on(channel, wrapped);
  },
  removeListener(channel: string, listener: Listener) { listeners.get(channel)?.delete(listener); return ipcRenderer; },
  off(channel: string, listener: Listener) { return ipcRenderer.removeListener(channel, listener); },
  removeAllListeners(channel?: string) { if (channel) listeners.delete(channel); else listeners.clear(); return ipcRenderer; },
  listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0,
};

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown) { (window as unknown as Record<string, unknown>)[key] = api; },
  exposeInIsolatedWorld(_world: number, key: string, api: unknown) { this.exposeInMainWorld(key, api); },
};
// Dropped files have no disk path in a browser; Electron answers "" for those too.
export const webUtils = { getPathForFile: () => "" };
export const webFrame = { setZoomFactor() {}, getZoomFactor: () => 1, setVisualZoomLevelLimits() {}, insertCSS: () => "" };
export default { ipcRenderer, contextBridge, webUtils, webFrame };

// ---- requests from the host ----

function messageBox(options: { message?: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number; checkboxLabel?: string; type?: string }): Promise<{ response: number; checkboxChecked: boolean }> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "breadboard-office-dialog";
    const title = document.createElement("p");
    title.className = "breadboard-office-dialog-title";
    title.textContent = options.message ?? "";
    dialog.append(title);
    if (options.detail) { const detail = document.createElement("p"); detail.textContent = options.detail; dialog.append(detail); }
    let checkbox: HTMLInputElement | null = null;
    if (options.checkboxLabel) {
      const label = document.createElement("label");
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      label.append(checkbox, ` ${options.checkboxLabel}`);
      dialog.append(label);
    }
    const row = document.createElement("div");
    row.className = "breadboard-office-dialog-buttons";
    const buttons = options.buttons?.length ? options.buttons : ["OK"];
    const finish = (response: number) => { dialog.close(); dialog.remove(); resolve({ response, checkboxChecked: Boolean(checkbox?.checked) }); };
    buttons.forEach((text, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text.replace(/&/g, "");
      if (index === (options.defaultId ?? 0)) button.dataset.default = "true";
      button.onclick = () => finish(index);
      row.append(button);
    });
    dialog.append(row);
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(options.cancelId ?? buttons.length - 1); });
    document.body.append(dialog);
    dialog.showModal();
    (row.querySelector("[data-default]") as HTMLButtonElement | null)?.focus();
  });
}

function openDialog(options: { properties?: string[]; filters?: { extensions?: string[] }[] }): Promise<{ filePaths: string[] }> {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = Boolean(options.properties?.includes("multiSelections"));
    const extensions = (options.filters ?? []).flatMap(filter => filter.extensions ?? []).filter(ext => ext !== "*");
    if (extensions.length) input.accept = extensions.map(ext => `.${ext}`).join(",");
    input.addEventListener("cancel", () => resolve({ filePaths: [] }));
    input.onchange = async () => {
      const filePaths: string[] = [];
      for (const file of Array.from(input.files ?? [])) {
        filePaths.push(await call({ action: "upload", name: file.name, data: new Uint8Array(await file.arrayBuffer()) }) as string);
      }
      resolve({ filePaths });
    };
    input.click();
  });
}

async function answerRequest(id: number, kind: string, payload: Record<string, unknown>): Promise<void> {
  let value: unknown = null;
  if (kind === "message-box") value = await messageBox(payload);
  else if (kind === "open-dialog") value = await openDialog(payload);
  else if (kind === "execute-js") {
    try { value = { ok: true, value: await (0, eval)(String(payload.code)) }; }
    catch (error) { value = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  await call({ action: "answer", id, value });
}

function dispatch(message: { type: string; [key: string]: unknown }): void {
  const target = Number(message.wc) || 0;
  if (wc) {
    // A popup listens only to its own window's events; the main page answers everything else.
    if (target !== wc) return;
    if (message.type === "window-close") {
      window.close();
      // A window the page did not open itself may refuse to close.
      document.body.replaceChildren(Object.assign(document.createElement("p"), { className: "breadboard-office-ended", textContent: "The presentation has ended. You can close this window." }));
      return;
    }
    if (message.type !== "event") return;
  } else if (message.type === "event" && target) return;
  switch (message.type) {
    case "window": {
      const url = `${location.pathname}?session=${encodeURIComponent(session)}&wc=${target}${message.query ? `&${message.query}` : ""}`;
      // Breadboard's desktop app opens this in its own window and returns null; the page still connects.
      const popup = window.open(url, `breadboard-office-${session}-${target}`, "popup,width=1280,height=720");
      if (popup) popups.set(target, popup);
      return;
    }
    case "window-close": popups.get(target)?.close(); popups.delete(target); return;
    case "event": {
      const event = { sender: ipcRenderer, senderId: 0, ports: [] };
      for (const listener of [...(listeners.get(message.channel as string) ?? [])]) {
        try { listener(event, ...(message.args as unknown[])); } catch (error) { console.error(error); }
      }
      return;
    }
    case "request": void answerRequest(message.id as number, message.kind as string, message.payload as Record<string, unknown>); return;
    case "menu": accelerators = new Set(message.accelerators as string[]); return;
    case "open-external": window.open(String(message.url), "_blank", "noopener"); return;
    case "print": window.print(); return;
    // Garden versions, exports, errors and titles belong to the Breadboard frame around the editor.
    default: toParent({ ...message, type: `breadboard:office-${message.type}` });
  }
}

// ---- the application menu's shortcuts ----
// Electron hands accelerator keys to the menu before the page sees them; the
// apps rely on that (Slides keeps undo in its main process). Clipboard keys
// stay native so the page keeps the system clipboard.
let accelerators = new Set<string>();
const NATIVE_KEYS = new Set(["Ctrl+C", "Ctrl+X", "Ctrl+V", "Ctrl+A", "Ctrl+Shift+V"]);
window.addEventListener("keydown", event => {
  if (!(event.ctrlKey || event.metaKey) || ["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const accelerator = ["Ctrl", ...(event.altKey ? ["Alt"] : []), ...(event.shiftKey ? ["Shift"] : []), key].join("+");
  if (!accelerators.has(accelerator) || NATIVE_KEYS.has(accelerator)) return;
  event.preventDefault();
  event.stopPropagation();
  void call({ action: "menu", accelerator }).catch(error => console.warn("[office] shortcut:", error));
}, true);

// Breadboard's theme switch reaches the editor as the shell's theme event.
window.addEventListener("message", event => {
  if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== "breadboard:theme") return;
  dispatch({ type: "event", channel: "app:theme-changed", args: [event.data.theme === "dark" ? "dark" : "light"] });
});

if (session) {
  const events = new EventSource(`${endpoint}/events`);
  events.onmessage = event => { try { dispatch(decodeWire(JSON.parse(event.data)) as { type: string }); } catch (error) { console.error(error); } };
  events.onerror = () => { if (events.readyState === EventSource.CLOSED) toParent({ type: "breadboard:office-ended" }); };
  window.addEventListener("pagehide", () => {
    events.close();
    for (const popup of popups.values()) popup.close();
    // A popup closed by the user ends that window in the host, as closing an Electron window does.
    if (wc) void fetch(endpoint, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "window-closed", wc }) });
  });
  if (!wc) ipcRenderer.send("breadboard:screens", (window.screen as Screen & { isExtended?: boolean }).isExtended === true);
}
