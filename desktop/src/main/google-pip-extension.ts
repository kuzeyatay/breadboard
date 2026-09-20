import { WebContentsView, type Extension, type Session, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { chromeExtensionIdFromPublicKey, GOOGLE_PIP_EXTENSION_ID } from "./browser-extensions";
import { googlePipExtensionApi } from "./google-pip-extension-api";
import type { BrowserExtensionView } from "../shared/ipc-contract";

export { GOOGLE_PIP_EXTENSION_ID } from "./browser-extensions";
const BRIDGE_PAGE = "breadboard-extension-host.html";
const WORKER = "breadboard-extension-worker.js";
type Action = NonNullable<BrowserExtensionView["action"]>;

/** Browser UI integration for Google's actual PiP package. A managed copy adds
 * missing host APIs without changing the downloaded files, identity or permissions.
 * The host itself has no preload, Node access, or product IPC bridge. */
export class GooglePipExtension {
  private readonly sources = new Map<string, string>();
  private host: WebContentsView | undefined;
  private action: Action | undefined;
  private loading: Promise<void> | undefined;

  constructor(private readonly session: Session, private readonly directory: string, private readonly changed: () => void) {
    session.on("extension-unloaded", (_event, extension) => {
      if (extension.id === GOOGLE_PIP_EXTENSION_ID) this.close();
    });
  }

  sourcePath(extensionPath: string): string { return this.sources.get(path.resolve(extensionPath)) ?? extensionPath; }
  state(id: string): Action | undefined { return id === GOOGLE_PIP_EXTENSION_ID ? this.action : undefined; }

  private prepare(source: string): string {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
    if (typeof manifest.key !== "string" || chromeExtensionIdFromPublicKey(Buffer.from(manifest.key, "base64")) !== GOOGLE_PIP_EXTENSION_ID) return source;
    const worker = manifest.background?.service_worker;
    if (typeof worker !== "string" || manifest.background.type === "module" || !manifest.action) throw new Error("This version of Google's Picture-in-Picture extension uses an unsupported background format.");
    const workerPath = path.resolve(source, worker);
    if (!workerPath.startsWith(path.resolve(source) + path.sep)) throw new Error("Invalid extension worker path.");
    const api = googlePipExtensionApi(BRIDGE_PAGE);
    const fingerprint = createHash("sha256").update(source).update(JSON.stringify(manifest)).update(fs.readFileSync(workerPath)).update(api);
    // Reload must also pick up edits to the scripts launched by the worker.
    for (const script of ["script.js", "autoPip.js"]) {
      const file = path.join(source, script);
      if (fs.existsSync(file)) fingerprint.update(script).update(fs.readFileSync(file));
    }
    const key = fingerprint.digest("hex").slice(0, 24);
    const prepared = path.join(this.directory, key);
    if (!fs.existsSync(path.join(prepared, ".breadboard-ready"))) {
      fs.mkdirSync(prepared, { recursive: true });
      fs.cpSync(source, prepared, { recursive: true });
      for (const name of [BRIDGE_PAGE, WORKER]) {
        if (fs.existsSync(path.join(source, name))) throw new Error("Extension contains a reserved Breadboard host file.");
      }
      fs.writeFileSync(path.join(prepared, BRIDGE_PAGE), '<!doctype html><meta charset="utf-8"><title>Picture-in-Picture extension host</title>');
      fs.writeFileSync(path.join(prepared, WORKER), `${api}\nimportScripts(${JSON.stringify(worker.replace(/\\/g, "/"))});\n`);
      fs.writeFileSync(path.join(prepared, "manifest.json"), JSON.stringify({...manifest, background: {...manifest.background, service_worker: WORKER}}, null, 2));
      fs.writeFileSync(path.join(prepared, ".breadboard-ready"), key);
    }
    this.sources.set(path.resolve(prepared), source);
    return prepared;
  }

  async load(extensionPath: string): Promise<Extension> {
    const source = this.sourcePath(extensionPath);
    const prepared = this.prepare(source);
    const extension = await this.session.loadExtension(prepared);
    if (extension.id !== GOOGLE_PIP_EXTENSION_ID) return extension;
    try {
      await this.start();
      return extension;
    } catch (error) {
      this.session.removeExtension(extension.id);
      throw error;
    }
  }

  private start(): Promise<void> {
    if (this.loading) return this.loading;
    const view = new WebContentsView({ webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.host = view;
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", event => event.preventDefault());
    this.loading = view.webContents.loadURL(`chrome-extension://${GOOGLE_PIP_EXTENSION_ID}/${BRIDGE_PAGE}`).then(async () => {
      await this.request({type:"state"});
    });
    return this.loading;
  }

  private async request(message: Record<string, unknown>): Promise<void> {
    const contents = this.host?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("The extension host is unavailable. Reload the extension and try again.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        contents.executeJavaScript(`chrome.runtime.sendMessage(${JSON.stringify({breadboardPipHost:1, ...message})})`, true),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Google's Picture-in-Picture extension did not respond. Reload it and try again.")), 10_000); }),
      ]);
      if (!response?.ok) throw new Error(response?.error || "Google's Picture-in-Picture extension did not initialize.");
      const state = response.state;
      if (!state?.ready || typeof state.title !== "string" || !Array.isArray(state.menus)) throw new Error("The extension has no registered action.");
      this.action = { title: state.title.slice(0, 500), badge: String(state.badge || "").slice(0, 8), menus: state.menus
        .filter((item: {id?: unknown; title?: unknown}) => typeof item.id === "string" && typeof item.title === "string")
        .slice(0, 16).map((item: {id: string; title: string; checked?: boolean; type?: string}) => ({ id: item.id, title: item.title, ...(item.type === "checkbox" ? {checked: Boolean(item.checked)} : {}) })) };
      this.changed();
    } finally { if (timer) clearTimeout(timer); }
  }

  async activate(page: WebContents | null, menuId?: string): Promise<void> {
    if ((page && (page.isDestroyed() || page.session !== this.session)) || (menuId === undefined && (!page || !/^https?:\/\//i.test(page.getURL())))) throw new Error("Open a video in a regular browser tab first.");
    await this.start();
    // Chromium can suspend a worker between clicks. Wake and initialize it
    // before sending the gesture-bearing action, so startup awaits cannot consume it.
    await this.request({type:"state"});
    await this.request({ type: menuId === undefined ? "action" : "menu", ...(menuId === undefined ? {} : {id:menuId}),
      ...(page ? {tab: {id:page.id, url:page.getURL(), title:page.getTitle(), active:true}} : {}) });
  }

  close(): void {
    const view = this.host;
    this.host = undefined; this.loading = undefined; this.action = undefined;
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    this.changed();
  }
}
