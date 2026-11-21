/**
 * The `electron` module as GenOffice's main-process code sees it inside the
 * Breadboard host: a plain Node process that runs one editor session. Every
 * window is the single browser iframe on the other end of the parent process;
 * webContents.send becomes an event the iframe receives, dialogs become
 * requests the iframe answers, and paths live in the session directory.
 */
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

type Message = Record<string, unknown>;
const post = (message: Message) => process.send?.(message);

const sessionDir = process.env.GENOFFICE_SESSION_DIR || process.cwd();
const dir = (name: string) => { const value = join(sessionDir, name); mkdirSync(value, { recursive: true }); return value; };

let requestSeq = 0;
const pendingRequests = new Map<number, (value: unknown) => void>();
/** Ask the iframe something (a dialog answer, a script result); the parent routes the reply back. */
export function requestRenderer(kind: string, payload: unknown): Promise<unknown> {
  const id = ++requestSeq;
  return new Promise(resolve => { pendingRequests.set(id, resolve); post({ type: "request", id, kind, payload }); });
}
/** Ask the dashboard itself (work the host cannot do alone, such as rendering a PDF). */
export function requestDashboard(kind: string, payload: unknown): Promise<unknown> {
  const id = ++requestSeq;
  return new Promise(resolve => { pendingRequests.set(id, resolve); post({ type: "host-request", id, kind, payload }); });
}
export function resolveRendererRequest(id: number, value: unknown): void {
  pendingRequests.get(id)?.(value);
  pendingRequests.delete(id);
}

// ---- webContents / windows ----

let nextId = 1;
const allContents = new Map<number, FakeWebContents>();

class FakeWebContents extends EventEmitter {
  readonly id = nextId++;
  private destroyed = false;
  private url = "";
  readonly session = defaultSession;
  readonly ipc = new EventEmitter();
  readonly mainFrame = { url: "", routingId: 1, processId: 1 };
  /** A hidden window the app made for its own work (print layouts); it has no page in the browser. */
  offscreen = false;
  /** A second editor page (the Slides audience window): a browser popup the main page opens. */
  popup = false;
  constructor() { super(); this.setMaxListeners(0); allContents.set(this.id, this); }
  send(channel: string, ...args: unknown[]) { if (!this.destroyed && !this.offscreen) post({ type: "event", channel, args, ...(this.popup ? { wc: this.id } : {}) }); }
  postMessage(channel: string, message: unknown) { this.send(channel, message); }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    allContents.delete(this.id);
    if (this.popup) post({ type: "window-close", wc: this.id });
    this.emit("destroyed");
  }
  close() { this.destroy(); }
  isCrashed() { return false; }
  isLoading() { return false; }
  isLoadingMainFrame() { return false; }
  getURL() { return this.url; }
  getTitle() { return ""; }
  async loadURL(url: string) {
    this.url = url;
    if (this.popup) post({ type: "window", wc: this.id, query: url.includes("?") ? url.slice(url.indexOf("?") + 1) : "" });
    setImmediate(() => { this.emit("dom-ready"); this.emit("did-finish-load"); });
  }
  async loadFile(file: string) { return this.loadURL(`file://${file}`); }
  reload() {}
  focus() {}
  isFocused() { return true; }
  setWindowOpenHandler() {}
  setBackgroundThrottling() {}
  setZoomFactor() {}
  getZoomFactor() { return 1; }
  setZoomLevel() {}
  getZoomLevel() { return 0; }
  setVisualZoomLevelLimits() { return Promise.resolve(); }
  openDevTools() {}
  closeDevTools() {}
  isDevToolsOpened() { return false; }
  invalidate() {}
  getOSProcessId() { return process.pid; }
  getProcessId() { return process.pid; }
  setAudioMuted() {}
  setIgnoreMenuShortcuts() {}
  // Edit commands come from the page itself in a browser; the host has nothing to drive.
  undo() {} redo() {} cut() {} copy() {} paste() {} pasteAndMatchStyle() {} selectAll() {} delete() {} replaceMisspelling() {}
  insertCSS() { return Promise.resolve(""); }
  async executeJavaScript(code: string) {
    // Print layouts wait for fonts and images here; the PDF renderer waits for load itself.
    if (this.offscreen) return undefined;
    const answer = await requestRenderer("execute-js", { code }) as { ok?: boolean; value?: unknown; error?: string } | null;
    if (!answer?.ok) throw new Error(answer?.error || "The editor page did not answer.");
    return answer.value;
  }
  /** The page this window loaded (self-contained print HTML), rendered by the dashboard's headless browser. */
  async printToPDF(options: unknown = {}): Promise<Buffer> {
    const answer = await requestDashboard("print-to-pdf", { url: this.url, options }) as { ok?: boolean; data?: Uint8Array; error?: string } | null;
    if (!answer?.ok || !answer.data) throw new Error(answer?.error || "The PDF could not be rendered.");
    return Buffer.from(answer.data);
  }
  print(_options?: unknown, callback?: (ok: boolean, reason: string) => void) { post({ type: "print" }); callback?.(true, ""); }
  async capturePage() { return nativeImage.createEmpty(); }
}

class FakeBrowserWindow extends EventEmitter {
  readonly id: number;
  readonly webContents: FakeWebContents;
  readonly contentView = { addChildView() {}, removeChildView() {}, children: [] as unknown[] };
  private destroyed = false;
  private title = "";
  constructor(options?: { show?: boolean; webPreferences?: { preload?: string } }, contents?: FakeWebContents) {
    super();
    this.webContents = contents ?? new FakeWebContents();
    // A window with the app's preload is another editor page; a hidden one without it is a print layout.
    if (options?.webPreferences?.preload) this.webContents.popup = true;
    else if (options?.show === false) this.webContents.offscreen = true;
    this.id = this.webContents.id;
    windows.set(this.webContents.id, this);
    this.webContents.once("destroyed", () => { this.destroyed = true; windows.delete(this.id); this.emit("closed"); });
  }
  static fromWebContents(contents: FakeWebContents) { return windows.get(contents?.id) ?? (contents && allContents.has(contents.id) ? new FakeBrowserWindow(undefined, contents) : null); }
  static fromId(id: number) { return windows.get(id) ?? null; }
  static getFocusedWindow() { return [...windows.values()][0] ?? null; }
  static getAllWindows() { return [...windows.values()]; }
  loadURL(url: string) {
    // Slides shows its audience window on ready-to-show.
    if (this.webContents.popup) setImmediate(() => this.emit("ready-to-show"));
    return this.webContents.loadURL(url);
  }
  loadFile(file: string, options?: { query?: Record<string, string> }) {
    const query = options?.query ? `?${new URLSearchParams(options.query)}` : "";
    return this.loadURL(`file://${file}${query}`);
  }
  isDestroyed() { return this.destroyed; }
  destroy() { this.webContents.destroy(); }
  close() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.emit("close", event);
    if (!event.defaultPrevented) this.destroy();
  }
  setTitle(title: string) { this.title = title; post({ type: "title", title }); }
  getTitle() { return this.title; }
  show() {} hide() {} focus() {} blur() {} showInactive() {} restore() {} minimize() {} maximize() {} unmaximize() {} center() {} moveTop() {} flashFrame() {}
  isVisible() { return true; }
  isFocused() { return true; }
  isMinimized() { return false; }
  isMaximized() { return false; }
  isFullScreen() { return false; }
  setFullScreen() {}
  isSimpleFullScreen() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1440, height: 900 }; }
  getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1440, 900]; }
  getSize() { return [1440, 900]; }
  setBounds() {} setSize() {} setContentSize() {} setPosition() {} setMinimumSize() {}
  getPosition() { return [0, 0]; }
  setMenu() {} removeMenu() {} setMenuBarVisibility() {} setAutoHideMenuBar() {}
  setDocumentEdited(edited: boolean) { post({ type: "dirty", dirty: edited }); }
  isDocumentEdited() { return false; }
  setRepresentedFilename() {} setProgressBar() {} setOverlayIcon() {} setIcon() {} setBackgroundColor() {} setVibrancy() {} setWindowButtonVisibility() {} setTitleBarOverlay() {}
  setAlwaysOnTop() {} setResizable() {} setMovable() {} setClosable() {} setSkipTaskbar() {} setHasShadow() {} setOpacity() {}
  getParentWindow() { return null; }
  getChildWindows() { return []; }
  getNativeWindowHandle() { return Buffer.alloc(8); }
}
const windows = new Map<number, FakeBrowserWindow>();

class FakeWebContentsView extends EventEmitter {
  readonly webContents = new FakeWebContents();
  setBounds() {} setVisible() {} setBackgroundColor() {} setBorderRadius() {}
  getBounds() { return { x: 0, y: 0, width: 1440, height: 900 }; }
  getVisible() { return true; }
}

export const webContents = {
  fromId: (id: number) => allContents.get(id),
  getAllWebContents: () => [...allContents.values()],
  getFocusedWebContents: () => [...allContents.values()][0] ?? null,
};

// ---- ipcMain ----

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
class IpcMain extends EventEmitter {
  handle(channel: string, handler: Handler) {
    if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    handlers.set(channel, handler);
  }
  handleOnce(channel: string, handler: Handler) {
    this.handle(channel, (...args) => { handlers.delete(channel); return handler(...args); });
  }
  removeHandler(channel: string) { handlers.delete(channel); }
}
export const ipcMain = new IpcMain();
ipcMain.setMaxListeners(0);

function ipcEvent(contents: FakeWebContents) {
  return { sender: contents, senderFrame: contents.mainFrame, frameId: 1, processId: process.pid, returnValue: undefined, ports: [],
    reply: (channel: string, ...args: unknown[]) => contents.send(channel, ...args) };
}
/** One renderer `invoke`; a missing handler fails the way Electron does. */
export async function invokeMain(contents: FakeWebContents, channel: string, args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for '${channel}'`);
  return handler(ipcEvent(contents), ...args);
}
export function sendMain(contents: FakeWebContents, channel: string, args: unknown[]): void {
  ipcMain.emit(channel, ipcEvent(contents), ...args);
}
export const registeredChannel = (channel: string) => handlers.has(channel);

// ---- app ----

class App extends EventEmitter {
  readonly isPackaged = true;
  readonly commandLine = { appendSwitch() {}, hasSwitch: () => false, getSwitchValue: () => "", appendArgument() {} };
  readonly dock = undefined;
  name = "Breadboard Office";
  getPath(name: string): string {
    switch (name) {
      case "userData": case "appData": case "sessionData": return dir("userData");
      case "temp": return dir("tmp");
      case "logs": case "crashDumps": return dir("logs");
      case "home": return sessionDir;
      case "exe": case "module": return process.execPath;
      // Everything a user would pick a folder for lands in exports/, which Breadboard files into the Garden.
      default: return dir("exports");
    }
  }
  setPath() {}
  getAppPath() { return sessionDir; }
  getVersion() { return "1.0.0"; }
  getName() { return this.name; }
  setName(value: string) { this.name = value; }
  getLocale() { return "en-US"; }
  getSystemLocale() { return "en-US"; }
  getPreferredSystemLanguages() { return ["en-US"]; }
  isReady() { return true; }
  whenReady() { return Promise.resolve(); }
  quit() { post({ type: "quit" }); }
  exit() { post({ type: "quit" }); }
  relaunch() {}
  focus() {}
  hide() {}
  show() {}
  requestSingleInstanceLock() { return true; }
  releaseSingleInstanceLock() {}
  hasSingleInstanceLock() { return true; }
  setAppUserModelId() {}
  setAsDefaultProtocolClient() { return false; }
  isDefaultProtocolClient() { return false; }
  addRecentDocument() {}
  clearRecentDocuments() {}
  setAboutPanelOptions() {}
  getGPUFeatureStatus() { return {}; }
  disableHardwareAcceleration() {}
  setLoginItemSettings() {}
  getLoginItemSettings() { return { openAtLogin: false }; }
  setBadgeCount() { return true; }
  async getFileIcon() { return nativeImage.createEmpty(); }
  isInApplicationsFolder() { return true; }
}
export const app = new App();
app.setMaxListeners(0);

// ---- dialogs ----

type DialogWindow = FakeBrowserWindow | undefined;
const options = <T>(windowOrOptions: unknown, maybe?: T): T => (maybe ?? windowOrOptions) as T;

export const dialog = {
  async showMessageBox(windowOrOptions: DialogWindow | object, maybe?: object) {
    const opts = options<{ buttons?: string[]; defaultId?: number; cancelId?: number; checkboxLabel?: string }>(windowOrOptions, maybe);
    const answer = await requestRenderer("message-box", opts) as { response?: number; checkboxChecked?: boolean } | null;
    return { response: typeof answer?.response === "number" ? answer.response : (opts.cancelId ?? opts.defaultId ?? 0), checkboxChecked: Boolean(answer?.checkboxChecked) };
  },
  showMessageBoxSync(windowOrOptions: DialogWindow | object, maybe?: object) {
    // Synchronous boxes cannot wait for the browser: take the default, and show the text.
    const opts = options<{ defaultId?: number; message?: string; detail?: string }>(windowOrOptions, maybe);
    post({ type: "notice", message: opts.message ?? "", detail: opts.detail ?? "" });
    return opts.defaultId ?? 0;
  },
  showErrorBox(title: string, content: string) { post({ type: "notice", message: title, detail: content, error: true }); },
  async showOpenDialog(windowOrOptions: DialogWindow | object, maybe?: object) {
    const opts = options<object>(windowOrOptions, maybe);
    const answer = await requestRenderer("open-dialog", opts) as { filePaths?: string[] } | null;
    const filePaths = Array.isArray(answer?.filePaths) ? answer!.filePaths : [];
    return { canceled: filePaths.length === 0, filePaths };
  },
  showOpenDialogSync() { return undefined; },
  async showSaveDialog(windowOrOptions: DialogWindow | object, maybe?: object) {
    // Saves and exports go to exports/, which the parent files into the Garden beside the document.
    const opts = options<{ defaultPath?: string; filters?: { extensions?: string[] }[] }>(windowOrOptions, maybe);
    let name = basename(opts.defaultPath || "") || "Untitled";
    const ext = opts.filters?.[0]?.extensions?.find(value => value !== "*");
    if (ext && !/\.[^.]+$/.test(name)) name += `.${ext}`;
    return { canceled: false, filePath: join(dir("exports"), name) };
  },
  showSaveDialogSync(windowOrOptions: DialogWindow | object, maybe?: object) {
    const opts = options<{ defaultPath?: string }>(windowOrOptions, maybe);
    return join(dir("exports"), basename(opts.defaultPath || "") || "Untitled");
  },
  showCertificateTrustDialog: async () => {},
};

// ---- shell, clipboard, images ----

export const shell = {
  async openExternal(url: string) { post({ type: "open-external", url }); },
  async openPath() { return ""; },
  showItemInFolder() {},
  async trashItem(path: string) { rmSync(path, { recursive: true, force: true }); },
  beep() {},
  readShortcutLink() { return {}; },
};

interface FakeImage {
  isEmpty(): boolean; getSize(): { width: number; height: number }; toPNG(): Buffer; toJPEG(): Buffer; toBitmap(): Buffer; getBitmap(): Buffer;
  toDataURL(): string; resize(options?: unknown): FakeImage; crop(rect?: unknown): FakeImage; getAspectRatio(): number; setTemplateImage(): void; isTemplateImage(): boolean;
  addRepresentation(): void; getScaleFactors(): number[];
}
function imageFrom(png: Buffer | null, mime = "image/png"): FakeImage {
  let size = { width: 0, height: 0 };
  if (png && png.length > 24 && png.readUInt32BE(0) === 0x89504e47) size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const bytes = png ?? Buffer.alloc(0);
  const decode = () => { try { return PNG.sync.read(bytes).data; } catch { return Buffer.alloc(0); } };
  const image: FakeImage = {
    isEmpty: () => bytes.length === 0,
    getSize: () => size,
    toPNG: () => bytes,
    toJPEG: () => bytes,
    toBitmap: decode,
    getBitmap: decode,
    toDataURL: () => `data:${mime};base64,${bytes.toString("base64")}`,
    resize: () => image,
    crop: () => image,
    getAspectRatio: () => size.height ? size.width / size.height : 1,
    setTemplateImage() {},
    isTemplateImage: () => false,
    addRepresentation() {},
    getScaleFactors: () => [1],
  };
  return image;
}
export const nativeImage = {
  createEmpty: () => imageFrom(null),
  createFromBuffer: (buffer: Buffer) => imageFrom(Buffer.from(buffer)),
  createFromDataURL: (url: string) => imageFrom(Buffer.from(url.slice(url.indexOf(",") + 1), "base64")),
  createFromPath: (path: string) => { try { return imageFrom(readFileSync(path)); } catch { return imageFrom(null); } },
  createFromBitmap: (bitmap: Buffer, { width, height }: { width: number; height: number }) => {
    // Electron bitmaps are BGRA; PNG wants RGBA.
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height * 4; i += 4) { png.data[i] = bitmap[i + 2]; png.data[i + 1] = bitmap[i + 1]; png.data[i + 2] = bitmap[i]; png.data[i + 3] = bitmap[i + 3]; }
    return imageFrom(PNG.sync.write(png));
  },
  createFromNamedImage: () => imageFrom(null),
};

// ponytail: in-process clipboard, so copy/paste works inside one editor; the system clipboard is the page's.
const clip = { text: "", html: "", image: null as FakeImage | null, buffers: new Map<string, Buffer>() };
export const clipboard = {
  readText: () => clip.text, writeText: (text: string) => { clip.text = text; },
  readHTML: () => clip.html, writeHTML: (html: string) => { clip.html = html; },
  readRTF: () => "", writeRTF() {},
  readImage: () => clip.image ?? nativeImage.createEmpty(), writeImage: (image: FakeImage) => { clip.image = image; },
  readBuffer: (format: string) => clip.buffers.get(format) ?? Buffer.alloc(0), writeBuffer: (format: string, buffer: Buffer) => { clip.buffers.set(format, buffer); },
  readBookmark: () => ({ title: "", url: "" }),
  availableFormats: () => [...(clip.text ? ["text/plain"] : []), ...(clip.html ? ["text/html"] : []), ...(clip.image ? ["image/png"] : []), ...clip.buffers.keys()],
  has: (format: string) => clip.buffers.has(format),
  read: (format: string) => clip.buffers.get(format)?.toString() ?? "",
  write: (data: { text?: string; html?: string; image?: FakeImage }) => { if (data.text !== undefined) clip.text = data.text; if (data.html !== undefined) clip.html = data.html; if (data.image) clip.image = data.image; },
  clear: () => { clip.text = ""; clip.html = ""; clip.image = null; clip.buffers.clear(); },
};

// ---- the rest of the surface: harmless stand-ins ----

const protocolHandlers = new Map<string, (request: Request) => Response | Promise<Response>>();
export const protocol = {
  handle: (scheme: string, handler: (request: Request) => Response | Promise<Response>) => { protocolHandlers.set(scheme, handler); },
  unhandle: (scheme: string) => { protocolHandlers.delete(scheme); },
  isProtocolHandled: (scheme: string) => protocolHandlers.has(scheme),
  registerSchemesAsPrivileged() {},
  registerFileProtocol() { return true; },
  registerBufferProtocol() { return true; },
  interceptFileProtocol() { return true; },
};
export async function protocolRequest(url: string): Promise<{ status: number; type: string; body: Uint8Array }> {
  const handler = protocolHandlers.get(new URL(url).protocol.replace(/:$/, ""));
  if (!handler) return { status: 404, type: "text/plain", body: new Uint8Array() };
  const response = await handler(new Request(url));
  return { status: response.status, type: response.headers.get("content-type") ?? "application/octet-stream", body: new Uint8Array(await response.arrayBuffer()) };
}

export const net = {
  async fetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Chromium's net stack reads file: URLs; Node's fetch does not.
    if (url.startsWith("file:")) {
      try { return new Response(new Uint8Array(readFileSync(fileURLToPath(url)))); } catch { return new Response(null, { status: 404 }); }
    }
    return fetch(input, init);
  },
  isOnline: () => true,
  online: true,
};

const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, workAreaSize: { width: 1920, height: 1040 }, scaleFactor: 1, rotation: 0, internal: true, touchSupport: "unknown" };
// The page reports window.screen.isExtended: with a second monitor, Slides opens its audience window (a popup the user drags there).
const externalDisplay = { ...display, id: 2, bounds: { ...display.bounds, x: 1920 }, workArea: { ...display.workArea, x: 1920 }, internal: false };
let extendedDesktop = false;
ipcMain.on("breadboard:screens", (_event: unknown, extended: unknown) => { extendedDesktop = extended === true; });
export const screen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => display, getAllDisplays: () => (extendedDesktop ? [display, externalDisplay] : [display]), getDisplayMatching: () => display, getDisplayNearestPoint: () => display,
  getCursorScreenPoint: () => ({ x: 0, y: 0 }), dipToScreenPoint: (point: unknown) => point, screenToDipPoint: (point: unknown) => point,
});

const defaultSession = {
  setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, setDisplayMediaRequestHandler() {},
  setSpellCheckerLanguages() {}, setSpellCheckerEnabled() {}, setUserAgent() {}, getUserAgent: () => "Breadboard",
  clearCache: async () => {}, clearStorageData: async () => {}, flushStorageData() {}, on() {}, once() {}, off() {},
  webRequest: { onBeforeRequest() {}, onBeforeSendHeaders() {}, onHeadersReceived() {}, onCompleted() {} },
  protocol, fetch: net.fetch, setProxy: async () => {}, resolveProxy: async () => "DIRECT",
};
export const session = { defaultSession, fromPartition: () => defaultSession };

class FakeMenu { items: unknown[] = []; append(item: unknown) { this.items.push(item); } insert(_pos: number, item: unknown) { this.items.push(item); } popup() {} closePopup() {} getMenuItemById() { return null; } on() {} }
type MenuEntry = { accelerator?: string; click?: (item: unknown, window: unknown, event: unknown) => void; submenu?: MenuEntry[] | FakeMenu; enabled?: boolean; visible?: boolean };
let applicationMenu: FakeMenu | null = null;
/** "Shift+CmdOrCtrl+Z" and a browser keydown both reduce to "Ctrl+Shift+Z". */
export function normalizeAccelerator(value: string): string {
  const parts = value.split("+").filter(Boolean), mods = new Set<string>();
  let key = parts.pop() ?? "";
  if (value.endsWith("++")) key = "+";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (["cmdorctrl", "commandorcontrol", "ctrl", "control", "cmd", "command", "meta", "super"].includes(lower)) mods.add("Ctrl");
    else if (["alt", "option", "altgr"].includes(lower)) mods.add("Alt");
    else if (lower === "shift") mods.add("Shift");
  }
  if (key.toLowerCase() === "plus") key = "+";
  return [...["Ctrl", "Alt", "Shift"].filter(mod => mods.has(mod)), key.length === 1 ? key.toUpperCase() : key].join("+");
}
function menuEntries(menu: FakeMenu | MenuEntry[] | undefined): MenuEntry[] {
  const items = (Array.isArray(menu) ? menu : menu?.items ?? []) as MenuEntry[];
  return items.flatMap(item => [item, ...menuEntries(item.submenu)]);
}
/** Run the application-menu item bound to a key the page forwarded. */
export function runAccelerator(accelerator: string): boolean {
  const item = menuEntries(applicationMenu ?? undefined).find(entry => entry.accelerator && entry.click && entry.enabled !== false && normalizeAccelerator(entry.accelerator) === accelerator);
  if (!item) return false;
  item.click!(item, FakeBrowserWindow.getFocusedWindow(), { triggeredByAccelerator: true });
  return true;
}
export const Menu = Object.assign(FakeMenu, {
  buildFromTemplate: (template: unknown[]) => Object.assign(new FakeMenu(), { items: template }),
  setApplicationMenu(menu: FakeMenu | null) {
    applicationMenu = menu;
    const accelerators = menuEntries(menu ?? undefined).filter(entry => entry.accelerator && entry.click).map(entry => normalizeAccelerator(entry.accelerator!));
    post({ type: "menu", accelerators: [...new Set(accelerators)] });
  },
  getApplicationMenu: () => applicationMenu, sendActionToFirstResponder() {},
});
export class MenuItem { constructor(readonly options: unknown) {} }

export const systemPreferences = Object.assign(new EventEmitter(), {
  getMediaAccessStatus: () => "denied", askForMediaAccess: async () => false, isTrustedAccessibilityClient: () => false,
  getUserDefault: () => undefined, getAccentColor: () => "2b6fd6ff", getColor: () => "#000000", getAnimationSettings: () => ({ shouldRenderRichAnimation: true, scrollAnimationsEnabledBySystem: true, prefersReducedMotion: false }),
});
export const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false, themeSource: "system", shouldUseHighContrastColors: false, shouldUseInvertedColorScheme: false });
export const desktopCapturer = { getSources: async () => [] };
export const powerMonitor = Object.assign(new EventEmitter(), { getSystemIdleTime: () => 0, isOnBatteryPower: () => false });
export const powerSaveBlocker = { start: () => 0, stop() {}, isStarted: () => false };
export const globalShortcut = { register: () => false, unregister() {}, unregisterAll() {}, isRegistered: () => false };
export const crashReporter = { start() {}, addExtraParameter() {} };
export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (text: string) => Buffer.from(text), decryptString: (buffer: Buffer) => buffer.toString() };
export class Notification extends EventEmitter { static isSupported() { return false; } show() {} close() {} }
export class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
export const autoUpdater = Object.assign(new EventEmitter(), { setFeedURL() {}, checkForUpdates() {}, quitAndInstall() {} });
export const contentTracing = { startRecording: async () => {}, stopRecording: async () => "" };
export class MessageChannelMain { port1 = new EventEmitter(); port2 = new EventEmitter(); }
export const webFrameMain = { fromId: () => null };
export const utilityProcess = { fork() { throw new Error("utilityProcess is not available in the Breadboard host."); } };

export { FakeBrowserWindow as BrowserWindow, FakeWebContentsView as WebContentsView, FakeWebContents as WebContents };
export const BaseWindow = FakeBrowserWindow;
export const BrowserView = FakeWebContentsView;

export default {
  app, ipcMain, dialog, shell, clipboard, nativeImage, protocol, net, screen, session, Menu, MenuItem, systemPreferences, nativeTheme,
  desktopCapturer, powerMonitor, powerSaveBlocker, globalShortcut, crashReporter, safeStorage, Notification, Tray, autoUpdater,
  contentTracing, MessageChannelMain, webFrameMain, utilityProcess, webContents,
  BrowserWindow: FakeBrowserWindow, WebContentsView: FakeWebContentsView, BaseWindow: FakeBrowserWindow, BrowserView: FakeWebContentsView,
};
