import { dialog, net, type BrowserWindow, type Rectangle, type WebContents } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { CodeDockAction, CodeDockState } from "../shared/code-dock";
import { findVSCode, findManagedVSCode, installVSCode, saveVSCodeSelection, type VSCodeInstallation, type VSCodeStorage } from "./vscode-installation";
import { prepareVSCodeProfile, synchronizeVSCodeTheme, type VSCodeProfile } from "./vscode-profile";
import { resolveCodeRepository } from "./code-repository";

export function nativeWindowId(window: BrowserWindow): string {
  const buffer = window.getNativeWindowHandle();
  return buffer.length === 8 ? buffer.readBigUInt64LE().toString() : buffer.readUInt32LE().toString();
}
export class CodeDockHelper {
  private readonly process: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private stopped = false;
  private closing = false;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(onEvent: (value: { type: string; error?: string }) => void) {
    const bundled = path.join(__dirname, "../native/vscode-dock.exe");
    const unpacked = bundled.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    const executable = fs.existsSync(unpacked) ? unpacked : bundled;
    if (!fs.existsSync(executable)) throw new Error("The Code docking helper is missing. Rebuild or update Breadboard.");
    this.process = spawn(executable, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    this.process.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-1000); });
    createInterface({ input: this.process.stdout }).on("line", line => {
      try {
        const message = JSON.parse(line.replace(/^\uFEFF/, ""));
        if (message.type) { onEvent(message); return; }
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id); clearTimeout(request.timer);
        if (message.ok) request.resolve(message.result);
        else request.reject(new Error(message.error || "VS Code docking failed."));
      } catch { /* An incomplete diagnostic is not a protocol response. */ }
    });
    const stop = (error: Error) => {
      if (this.stopped) return;
      this.stopped = true;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
      if (!this.closing) onEvent({ type: "stopped", error: error.message });
    };
    this.process.once("error", error => stop(error));
    this.process.once("exit", code => stop(new Error(stderr.trim() || `The Code docking helper stopped (${code ?? "signal"}).`)));
    this.process.stdin.on("error", error => stop(error));
  }
  request(op: string, value: Record<string, unknown> = {}, timeout = 5000): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error("The Code docking helper is no longer running."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`VS Code ${op} timed out.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ ...value, op, id }) + "\n");
    });
  }
  async close(closeEditor = false): Promise<void> {
    if (this.stopped) return;
    // Acknowledgement proves that SetParent/style restoration finished before
    // Electron is allowed to destroy the parent HWND. Never kill the editor.
    this.closing = true;
    try { await this.request("exit", { closeEditor }); } catch (error) { this.closing = false; throw error; }
    this.process.stdin.end();
  }
}

interface DockSession {
  contents: WebContents;
  window: BrowserWindow;
  state: CodeDockState;
  installation?: VSCodeInstallation;
  profile?: VSCodeProfile;
  helper?: CodeDockHelper;
  canceled: boolean;
  busy?: Promise<void>;
  releasing?: Promise<void>;
  layout?: { parent: string; x: number; y: number; width: number; height: number; visible: boolean; active: boolean; focus?: boolean };
  lastLayout?: string;
  contentTop?: number;
}
export class CodeDockManager {
  private sessions = new Map<number, DockSession>();
  private guardedWindows = new WeakSet<BrowserWindow>();
  private install?: Promise<VSCodeInstallation>;
  private downloadAbort = new AbortController();
  private theme: "light" | "dark" = "light";
  constructor(private readonly storage: VSCodeStorage, private readonly candidates?: string[]) {}
  has(id: number): boolean { return this.sessions.has(id); }
  contentTop(id: number): number { return this.sessions.get(id)?.contentTop ?? 0; }
  setTheme(theme: "light" | "dark"): void {
    if (this.theme === theme) return;
    this.theme = theme;
    const profiles = new Map([...this.sessions.values()].flatMap(session => session.profile ? [[session.profile.settings, session.profile] as const] : []));
    for (const profile of profiles.values()) {
      try { synchronizeVSCodeTheme(profile.settings, theme, profile.themes); }
      catch (error) { console.warn("[Code] Theme synchronization failed:", error instanceof Error ? error.message : String(error)); }
    }
  }
  private guard(window: BrowserWindow): void {
    if (this.guardedWindows.has(window)) return;
    this.guardedWindows.add(window);
    let closing = false;
    window.on("close", event => {
      if (![...this.sessions.values()].some(session => session.window === window)) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      void this.releaseWindow(window).then(() => { closing = false; if (!window.isDestroyed()) window.close(); }, error => {
        closing = false;
        dialog.showErrorBox("VS Code is still attached", `Breadboard kept this window open to protect your editor. ${String(error)}`);
      });
    });
  }
  request(contents: WebContents, window: BrowserWindow, action: CodeDockAction): CodeDockState {
    if (process.platform !== "win32") return { phase: "unsupported" };
    let session = this.sessions.get(contents.id);
    if (!session) {
      let installation: VSCodeInstallation | undefined, discoveryError: string | undefined;
      try { installation = findVSCode(this.storage, this.candidates) ?? undefined; }
      catch (error) { discoveryError = error instanceof Error ? error.message : String(error); }
      session = { contents, window, installation, state: { phase: installation ? "ready" : "missing",
        ...(installation ? { installation: installation.kind, executable: installation.executable } : {}),
        ...(discoveryError ? { phase: "error", error: discoveryError } as const : {}) }, canceled: false };
      this.sessions.set(contents.id, session);
      this.guard(window);
      contents.once("destroyed", () => { void this.release(contents.id).catch(() => undefined); });
      contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
        // Reload/navigation cannot leave a native editor over a different page.
        if (isMainFrame && !inPlace) void this.release(contents.id).catch(() => undefined);
      });
    }
    const current = session;
    current.window = window;
    if (typeof action === "object") { current.contentTop = action.top; return { ...current.state }; }
    if (action === "status" || current.busy || current.releasing) return { ...current.state };
    if (action === "detach") {
      this.run(current, async () => { await current.helper?.close(); current.helper = undefined; current.state = { ...current.state, phase: "detached" }; });
    } else if (action === "choose-installation") {
      this.run(current, async () => {
        const result = await dialog.showOpenDialog(window, { title: "Choose Visual Studio Code", properties: ["openFile"], filters: [{ name: "VS Code executable", extensions: ["exe"] }] });
        if (result.canceled || !result.filePaths[0] || current.canceled) return;
        saveVSCodeSelection(this.storage.stateRoot, result.filePaths[0]);
        current.installation = findVSCode(this.storage, this.candidates) ?? undefined;
        await this.open(current);
      });
    } else if (action === "download") {
      current.state = { phase: "downloading", progress: 0 };
      this.run(current, async () => {
        const existing = findManagedVSCode(this.storage);
        if (existing) { current.installation = existing; await this.open(current); return; }
        this.install ??= installVSCode(this.storage, (phase, progress) => {
          for (const pending of this.sessions.values()) if (["downloading", "extracting"].includes(pending.state.phase)) pending.state = { phase, progress };
        }, (input, init) => net.fetch(typeof input === "object" && "href" in input ? String(input) : input, init), this.downloadAbort.signal).finally(() => { this.install = undefined; });
        current.installation = await this.install;
        if (!current.canceled) await this.open(current);
      });
    } else if (action === "open" && current.state.phase !== "docked") {
      this.run(current, async () => {
        current.installation = findVSCode(this.storage, this.candidates) ?? undefined;
        if (!current.installation) current.state = { phase: "missing" };
        else await this.open(current);
      });
    }
    return { ...current.state };
  }
  private run(session: DockSession, operation: () => Promise<void>): void {
    session.busy = (async () => {
      let attempt = operation, usedFallback = false;
      for (;;) {
        try { await attempt(); return; }
        catch (error) {
          if (session.canceled) return;
          try { await session.helper?.close(); } catch (releaseError) {
            session.state = { ...session.state, phase: "error", error: `VS Code is still attached. ${String(releaseError)}` };
            return; // Keep the helper registered so parent close remains guarded.
          }
          session.helper = undefined;
          let failure = error, canDownloadFallback = false;
          if (!usedFallback && session.installation?.kind === "installed" && error instanceof Error && /VS Code is being updated/i.test(error.message)) {
            usedFallback = true;
            try {
              const managed = findManagedVSCode(this.storage);
              if (managed) { session.installation = managed; attempt = () => this.open(session); continue; }
              canDownloadFallback = true;
              failure = new Error("Your installed VS Code is updating. Download a local copy to continue.");
            } catch (storageError) { failure = storageError; }
          }
          session.state = { phase: "error", error: failure instanceof Error ? failure.message : String(failure),
            ...(canDownloadFallback ? { canDownloadFallback: true } : {}),
            ...(session.installation ? { executable: session.installation.executable, installation: session.installation.kind } : {}) };
          return;
        }
      }
    })().finally(() => { session.busy = undefined; });
  }
  private async open(session: DockSession): Promise<void> {
    const installation = session.installation;
    if (!installation || session.canceled || session.window.isDestroyed()) return;
    await session.helper?.close(); session.helper = undefined;
    if (session.canceled) return;
    session.state = { phase: "opening", executable: installation.executable, installation: installation.kind };
    const repository = await resolveCodeRepository(session.contents.getURL(), (url, options) => session.contents.session.fetch(String(url), options));
    if (session.canceled) return;
    const marker = `Breadboard Code ${randomUUID()}`;
    const directory = path.join(this.storage.stateRoot, "workspaces");
    await fs.promises.mkdir(directory, { recursive: true });
    if (session.canceled) return;
    const workspace = path.join(directory, marker + ".code-workspace");
    // A unique workspace identifies precisely the new window; existing VS Code
    // windows are never adopted. Theme settings live in our separate profile so
    // opening a different folder continues to follow Breadboard's appearance.
    await fs.promises.writeFile(workspace, JSON.stringify({ folders: repository ? [{ path: repository.path, name: repository.name }] : [] }));
    session.profile = prepareVSCodeProfile(this.storage, installation, this.theme);
    if (session.canceled) return;
    const helper = new CodeDockHelper(message => {
      if (session.canceled || session.helper !== helper) return;
      if (message.type === "closed") session.state = { ...session.state, phase: "ready" };
      if (message.type === "error" || message.type === "stopped") session.state = { ...session.state, phase: "error", error: message.error };
    });
    session.helper = helper;
    await helper.request("prepare", { ownerPid: process.pid, parent: nativeWindowId(session.window), executable: installation.executable, marker });
    if (session.canceled) { await helper.close(); return; }
    if (session.layout) await helper.request("layout", session.layout);
    // Electron's own environment must not make Code.exe behave like Node or
    // forward this window request through another editor's integrated terminal.
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(?:ELECTRON_|VSCODE_|NODE_OPTIONS$)/.test(key)) delete env[key];
    env.VSCODE_PORTABLE = session.profile.portable;
    const editor = spawn(installation.executable, ["--new-window", workspace, ...session.profile.args], {
      cwd: path.dirname(installation.executable), env, stdio: ["ignore", "ignore", "pipe"], windowsHide: false, detached: true,
    });
    let diagnostic = "";
    const readDiagnostic = (chunk: Buffer) => { diagnostic = (diagnostic + String(chunk)).slice(-4000); };
    editor.stderr?.on("data", readDiagnostic);
    let onExit: (code: number | null) => void = () => {};
    const failed = new Promise<never>((_resolve, reject) => {
      onExit = code => {
        // The CLI can exit successfully after handing off to an existing Code
        // instance. A nonzero exit must not leave the user waiting for an HWND.
        if (code === 0) return;
        reject(new Error(/currently being updated|vscode(?:-insiders)?-updating/i.test(diagnostic)
          ? "VS Code is being updated. Finish its update, then retry."
          : `VS Code could not start${code === null ? "" : ` (exit ${code})`}. Open VS Code on its own to check the installation, then retry.`));
      };
      editor.once("exit", onExit);
    });
    try {
      await Promise.race([new Promise<void>((resolve, reject) => { editor.once("spawn", resolve); editor.once("error", reject); }), failed]);
      editor.unref();
      await Promise.race([helper.request("attach", {}, 125_000), failed]);
    } finally {
      editor.removeListener("exit", onExit);
      editor.stderr?.removeListener("data", readDiagnostic);
      editor.stderr?.resume();
    }
    if (session.canceled) { await helper.close(); return; }
    session.state = { ...session.state, phase: "docked" };
    session.lastLayout = undefined;
    this.sendLayout(session, session.window.isFocused());
  }
  sync(id: number, window: BrowserWindow, bounds: Rectangle, visible: boolean, active = visible): void {
    const session = this.sessions.get(id);
    if (!session || session.canceled || window.isDestroyed()) return;
    this.guard(window); session.window = window;
    const focus = visible && active && (!session.layout?.visible || !session.layout.active) && window.isFocused();
    session.layout = { parent: nativeWindowId(window), ...bounds, visible, active };
    this.sendLayout(session, focus);
  }
  /** A docked editor owns focus after its backing tab has finished presenting. */
  focus(id: number): boolean {
    const session = this.sessions.get(id);
    if (!session?.helper || session.canceled || session.state.phase !== "docked" || !session.layout?.visible || !session.layout.active) return false;
    if (!session.window.isDestroyed() && session.window.isFocused()) this.sendLayout(session, true);
    return true;
  }
  private sendLayout(session: DockSession, focus = false): void {
    if (!session.helper || !session.layout || session.canceled) return;
    const signature = JSON.stringify(session.layout);
    if (signature === session.lastLayout && !focus) return;
    session.lastLayout = signature;
    void session.helper.request("layout", { ...session.layout, focus }).catch(error => {
      if (!session.canceled) session.state = { ...session.state, phase: "error", error: String(error) };
    });
  }
  /** `closeEditor` asks VS Code to close (it still prompts for unsaved work)
   * instead of leaving it behind as a standalone window. */
  async release(id: number, closeEditor = false): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.releasing) return session.releasing;
    session.canceled = true;
    session.releasing = (async () => {
      await session.helper?.close(closeEditor);
      session.helper = undefined;
      if (this.sessions.get(id) === session) this.sessions.delete(id);
    })().catch(error => { session.canceled = false; session.releasing = undefined; throw error; });
    return session.releasing;
  }
  private async releaseWindow(window: BrowserWindow): Promise<void> {
    await Promise.all([...this.sessions].filter(([, session]) => session.window === window).map(([id]) => this.release(id, true)));
  }
  async close(): Promise<void> {
    this.downloadAbort.abort();
    await Promise.all([...this.sessions.keys()].map(id => this.release(id)));
  }
}
