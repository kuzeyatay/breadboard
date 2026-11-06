import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { WebContents } from "electron";
import { desktopSessionAccountId, finishedAutomationTabOwners } from "./desktop-session-auth";
import { AutomationTabCleanup } from "./automation-tab-cleanup";
import type { TabManager } from "./tab-manager";
import { breadboardDomOperation } from "./breadboard-use-dom";
import { capturePageWithFreshFrame } from "./capture-page";
import { waitForRevealFrame } from "./first-paint";
import { ScreenRecordingManager } from "./screen-recording";

const ROUTES: Record<string, string> = {
  garden: "/garden", dashboard: "/dashboard", home: "/new-tab", settings: "/settings", profile: "/settings",
  calendar: "/calendar", plan: "/plan", workflows: "/workflows", processes: "/processes",
};
const KEYS = new Set(["Enter", "Escape", "Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Delete"]);
const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9, Space: 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Delete: 46 };
const ACTIONS = new Set(["state", "open", "navigate", "activate", "close", "snapshot", "screenshot", "click", "set_checked", "fill", "press", "scroll", "close_voice"]);

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The page did not respond. Inspect fresh state before retrying.")), 8_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export type BreadboardUseArgs = Record<string, unknown> & { action: string };

/** Local control of the same Electron views used by QA, without exposing CDP
 * or executable scripts to the model. The receipt is private service state. */
export class BreadboardUseBridge {
  private server: http.Server | null = null;
  private token = randomBytes(32).toString("hex");
  private snapshots = new Map<number, { id: string; url: string; expires: number; sessionId: string }>();
  private busy = false;
  private releasedRuns = new Set<string>();
  private recordings: ScreenRecordingManager;
  private cleanup = new AutomationTabCleanup({
    owners: () => [...this.options.tabs.automationTabOwners(), ...this.recordings.owners()],
    finished: async (owners, signal) => {
      const base = this.options.dashboardUrl();
      const target = base && this.targets().find(target => target.kind !== "browser" &&
        new URL(target.contents.getURL()).origin === new URL(base).origin);
      if (!base || !target) return [];
      return finishedAutomationTabOwners(base, target.contents.session, owners, signal);
    },
    release: owner => this.releaseOwner(owner),
  });

  constructor(private options: { tabs: TabManager; dataRoot: string; dashboardUrl: () => string | null; cdpPort?: () => number | null }) {
    this.recordings = new ScreenRecordingManager(options.dataRoot, () => this.targets().map(target => ({
      contents: target.contents, prepare: () => this.options.tabs.prepareBreadboardUseInput(target.contents),
    })));
  }

  async start(): Promise<void> {
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.requestTimeout = 15_000;
    server.headersTimeout = 15_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    this.server = server;
    server.unref();
    fs.mkdirSync(this.options.dataRoot, { recursive: true });
    fs.writeFileSync(this.receiptPath, JSON.stringify({
      protocolVersion: 1, port: (server.address() as AddressInfo).port, token: this.token,
    }), { mode: 0o600 });
    this.cleanup.start();
  }

  private get receiptPath() { return path.join(this.options.dataRoot, "breadboard-use.json"); }

  async close(): Promise<void> {
    this.cleanup.stop();
    const recordingsStopped = this.recordings.close();
    this.snapshots.clear();
    const server = this.server;
    this.server = null;
    try {
      if (JSON.parse(fs.readFileSync(this.receiptPath, "utf8")).token === this.token) fs.unlinkSync(this.receiptPath);
    } catch { /* An absent receipt is already revoked. */ }
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    await recordingsStopped;
  }

  private targets() { return this.options.tabs.breadboardUseTargets(); }

  private releaseOwner(owner: string): void {
    this.releasedRuns.add(owner);
    void this.recordings.release(owner);
    if (this.releasedRuns.size > 1_000) this.releasedRuns.delete(this.releasedRuns.values().next().value!);
    this.options.tabs.closeAutomationTabs(owner);
    const liveIds = new Set(this.targets().map(target => target.contents.id));
    for (const id of this.snapshots.keys()) if (!liveIds.has(id)) this.snapshots.delete(id);
  }

  private state() {
    return { capturedAt: new Date().toISOString(), targets: this.targets().map(({ contents, chrome, ...info }) => ({
      ...info, targetId: contents.id, url: contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(),
    })) };
  }

  private async dom(contents: WebContents, args: Record<string, unknown>) {
    const result = await bounded(contents.executeJavaScript(`(() => {
      try { return { ok: true, value: (${breadboardDomOperation.toString()})(${JSON.stringify(args)}) }; }
      catch (error) { return { ok: false, error: error.message || 'Page interaction failed.' }; }
    })()`, args.action !== "snapshot" && !String(args.action).startsWith("cursor_")));
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  /** Chromium input addressed to one page, without focusing its native window. */
  private async browserInput(contents: WebContents, commands: Array<[string, Record<string, unknown>]>, prepare?: () => Promise<unknown>) {
    const release = await this.options.tabs.prepareBreadboardUseInput(contents);
    const inspector = contents.debugger;
    const attachedHere = !inspector.isAttached();
    try {
      if (attachedHere) inspector.attach("1.3");
      await bounded(inspector.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }));
      if (prepare) await prepare();
      for (const [method, params] of commands) await bounded(inspector.sendCommand(method, params));
      await waitForRevealFrame(contents, 1500);
    } finally {
      if (!contents.isDestroyed() && inspector.isAttached()) {
        await bounded(inspector.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false })).catch(() => undefined);
        if (attachedHere && inspector.isAttached()) inspector.detach();
      }
      release();
    }
  }

  async execute(args: BreadboardUseArgs, sessionId: string, runId = sessionId): Promise<Record<string, unknown>> {
    const owner = JSON.stringify([sessionId, runId]);
    if (args.action === "flow_tab") {
      // The authenticated bridge lends only this dedicated hidden page. Never
      // activate a normal browser tab or honor a caller's foreground/lane input.
      const result = await this.options.tabs.openChatgptWebTab({
        foreground: false, lane: "google-flow", cdpPort: this.options.cdpPort?.() ?? null,
      });
      if (!result.ok) throw new Error(result.error);
      return { cdpPort: result.cdpPort, targetId: result.targetId, hidden: true };
    }
    if (args.action === "release_run") {
      this.releaseOwner(owner);
      return { released: true };
    }
    if (this.releasedRuns.has(owner)) throw new Error("This task has finished. Start a new task to operate the browser.");
    if (args.action === "recording_sources") return { sources: await this.recordings.sources() };
    if (args.action === "recording_start") {
      const recording = await this.recordings.start(owner, args);
      if (this.releasedRuns.has(owner)) { await this.recordings.release(owner); throw new Error("This task ended during recording startup."); }
      return { recording };
    }
    if (args.action === "recording_status") return { recording: this.recordings.status(owner, args.recordingId) };
    if (args.action === "recording_stop") return { recording: await this.recordings.stop(owner, args.recordingId) };
    if (!ACTIONS.has(args.action)) throw new Error("Unsupported Breadboard action.");
    const targets = this.targets();
    const base = this.options.dashboardUrl();
    if (!base || !targets.length) throw new Error("Breadboard is still starting. Try again when the dashboard is ready.");
    if (args.action === "state") return this.state();
    if (!["open", "close_voice"].includes(args.action) && !Number.isInteger(args.targetId)) {
      throw new Error("Choose a targetId from state.");
    }
    if (args.action === "close_voice") {
      let closed = false;
      for (const target of targets.filter(t => t.kind !== "browser" && t.active &&
        (args.targetId === undefined || args.targetId === t.contents.id)).sort((a, b) => Number(b.focusedWindow) - Number(a.focusedWindow))) {
        if (new URL(target.contents.getURL()).origin !== new URL(base).origin) continue;
        closed = (await this.dom(target.contents, { action: "close_voice" })).closed || closed;
        if (closed) break;
      }
      return { closed, ...this.state() };
    }
    const target = args.targetId === undefined
      ? targets.find(t => t.active && t.focusedWindow && t.kind !== "browser") ?? targets.find(t => t.active && t.kind !== "browser")
      : targets.find(t => t.contents.id === args.targetId);
    if (!target) throw new Error("Target is no longer open. Read state and choose a targetId.");
    const contents = target.contents;
    const command = (value: Parameters<TabManager["handleCommand"]>[1]) => this.options.tabs.handleCommand(target.chrome, value);
    if (args.action === "open") {
      const surface = String(args.surface ?? "browser");
      let ok: boolean;
      if (surface === "browser") {
        let url: string | undefined;
        if (typeof args.query === "string" && args.query.trim()) url = `https://www.google.com/search?q=${encodeURIComponent(args.query.trim())}`;
        else if (args.url !== undefined) url = this.webUrl(args.url);
        // App surfaces and artifact viewers need the authenticated app session.
        // API endpoints and untrusted HTML previews stay in the web sandbox.
        const appPage = url && new URL(url).origin === new URL(base).origin && (
          [...Object.values(ROUTES), "/profile"].includes(new URL(url).pathname.replace(/\/$/, "")) ||
          /^\/gardens?\//.test(new URL(url).pathname) ||
          /^\/artifacts\/art_[A-Za-z0-9-]+\/(pdf|markdown|video)$/.test(new URL(url).pathname));
        ok = appPage && url
          ? this.options.tabs.openBreadboardUseApp(target.chrome, url, owner)
          : this.options.tabs.openBreadboardUseBrowser(target.chrome, url, owner);
      } else {
        const route = ROUTES[surface];
        if (!route) throw new Error(`Choose browser or ${Object.keys(ROUTES).join(", ")}.`);
        const url = new URL(route, base).href;
        ok = this.options.tabs.openBreadboardUseApp(target.chrome, url, owner);
      }
      if (!ok) throw new Error("Breadboard could not open that page. Check whether tab navigation is enabled.");
      return { performed: true, ...this.state() };
    }
    if (args.action === "activate" || args.action === "close" || args.action === "navigate") {
      let ok: boolean;
      if (args.action === "navigate") {
        if (target.kind !== "browser" && target.kind !== "chrome") throw new Error("Choose a browser target to navigate.");
        const input = typeof args.query === "string" && args.query.trim()
          ? `https://www.google.com/search?q=${encodeURIComponent(args.query.trim())}` : this.webUrl(args.url);
        ok = this.options.tabs.navigateBreadboardUseBrowser(target.windowId, target.tabId, input);
      } else ok = await command({ type: args.action, id: target.tabId });
      if (!ok) throw new Error("Breadboard could not perform that tab action.");
      this.snapshots.delete(contents.id);
      return { performed: true, ...this.state() };
    }
    const inspecting = args.action === "snapshot" || args.action === "screenshot";
    const backgroundInput = target.kind === "browser" || (target.kind === "app" && target.aiOpened);
    // Inspections often arrive after the user has switched tabs. Read the
    // requested page in place; only an explicit activation may bring it back.
    if (!inspecting && !backgroundInput && !this.targets().some(t => t.contents.id === contents.id && t.active)) {
      throw new Error("Activate this target's tab before interacting with it.");
    }
    if (contents.isLoadingMainFrame()) throw new Error("The page is loading. Read state again before interacting.");
    if (inspecting) {
      this.snapshots.delete(contents.id);
      const id = randomUUID();
      const url = contents.getURL();
      let navigated = false;
      const onNavigation = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) navigated = true; };
      contents.on("did-start-navigation", onNavigation);
      // Keep a compositor available until the pixels are copied, even when the
      // requested page is detached. This never selects or focuses its tab.
      let release = () => {};
      let page;
      let screenshot;
      try {
        if (args.action === "screenshot" || (target.kind === "app" && target.aiOpened)) {
          release = await this.options.tabs.prepareBreadboardUseInput(contents);
        }
        page = await this.dom(contents, { action: "snapshot", snapshotId: id, offset: args.offset });
        if (args.action === "screenshot") {
          // The user may have switched tabs while the DOM snapshot was in
          // flight. Recheck placement immediately before requesting pixels.
          const releaseCapture = await this.options.tabs.prepareBreadboardUseInput(contents);
          let capture;
          try {
            await this.dom(contents, { action: "cursor_hide" });
            capture = await capturePageWithFreshFrame(contents);
          }
          finally {
            if (!contents.isDestroyed()) await this.dom(contents, { action: "cursor_show" }).catch(() => undefined);
            releaseCapture();
          }
          if (capture.isEmpty()) throw new Error("No screenshot is available yet. Wait for the page to finish rendering and retry.");
          const size = capture.getSize();
          if (Math.max(size.width, size.height) > 1600) capture = capture.resize(size.width >= size.height ? { width: 1600 } : { height: 1600 });
          screenshot = { dataUrl: `data:image/jpeg;base64,${capture.toJPEG(80).toString("base64")}`, ...capture.getSize() };
        }
      } finally {
        release();
        contents.removeListener("did-start-navigation", onNavigation);
      }
      if (navigated || contents.isDestroyed() || contents.getURL() !== url || contents.isLoadingMainFrame()) throw new Error("The page changed during capture. Take another snapshot.");
      const current = this.targets().find(t => t.contents.id === contents.id);
      if (!current) throw new Error("The target tab closed during capture. Read fresh state and choose a targetId.");
      this.snapshots.set(contents.id, { id, url, expires: Date.now() + 120_000, sessionId });
      return { targetId: contents.id, url, title: contents.getTitle(), active: current.active, ...page, ...(screenshot ? { screenshot } : {}) };
    }
    const snapshot = this.snapshots.get(contents.id);
    if (!snapshot || snapshot.id !== args.snapshotId || snapshot.sessionId !== sessionId || snapshot.url !== contents.getURL() || snapshot.expires < Date.now()) {
      throw new Error("Snapshot expired. Take another snapshot before acting.");
    }
    if (["click", "fill", "set_checked"].includes(args.action) && typeof args.ref !== "string") throw new Error("Choose a ref from the snapshot.");
    if (args.action === "set_checked" && typeof args.checked !== "boolean") throw new Error("Provide checked as true or false.");
    if (args.action === "fill" && (typeof args.text !== "string" || args.text.length > 10000)) throw new Error("Provide text up to 10,000 characters.");
    if (args.action === "scroll" && !["up", "down", "top", "bottom"].includes(String(args.direction))) throw new Error("Choose up, down, top, or bottom.");
    let outcome: Record<string, unknown> = {};
    if (args.action === "press") {
      if (!KEYS.has(String(args.key))) throw new Error("Unsupported key.");
      if (backgroundInput) {
        const code = String(args.key);
        const key = code === "Space" ? " " : code;
        const params = { key, code, windowsVirtualKeyCode: KEY_CODES[code] };
        this.snapshots.delete(contents.id);
        await this.browserInput(contents, [
          ["Input.dispatchKeyEvent", { ...params, type: "keyDown", ...(code === "Enter" ? { text: "\r" } : code === "Space" ? { text: " " } : {}) }],
          ["Input.dispatchKeyEvent", { ...params, type: "keyUp" }],
        ], args.ref ? () => this.dom(contents, { ...args, action: "focus" }) : undefined);
      } else {
        if (args.ref) await this.dom(contents, { ...args, action: "focus" });
        contents.sendInputEvent({ type: "keyDown", keyCode: args.key as string });
        contents.sendInputEvent({ type: "keyUp", keyCode: args.key as string });
      }
    } else {
      if (backgroundInput && args.action === "scroll") {
        const release = await this.options.tabs.prepareBreadboardUseInput(contents);
        try {
          outcome = await this.dom(contents, args);
          // Feeds load their next posts from the scroll event on a render frame.
          await waitForRevealFrame(contents, 1500);
        } finally { release(); }
      } else outcome = await this.dom(contents, args);
      if (args.action === "click" && outcome.mouseTarget) {
        this.snapshots.delete(contents.id);
        const { x, y } = outcome.mouseTarget as { x: number; y: number };
        if (backgroundInput) {
          await this.browserInput(contents, [
            ["Input.dispatchMouseEvent", { type: "mouseMoved", x, y }],
            ["Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }],
            ["Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }],
          ]);
        } else {
          contents.sendInputEvent({ type: "mouseMove", x, y });
          contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
          contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
        }
        outcome = {};
      } else if (args.action === "fill" && outcome.requiresTextInsertion === true) {
        // Consume before dispatch so an uncertain edit cannot reuse its refs.
        this.snapshots.delete(contents.id);
        if (backgroundInput) await this.browserInput(contents, [["Input.insertText", { text: args.text }]]);
        else await bounded(contents.insertText(args.text as string));
        outcome = {};
      }
    }
    this.snapshots.delete(contents.id);
    return { ...outcome, performed: true, targetId: contents.id, next: "Take a fresh snapshot to verify the result and any save error before reporting success." };
  }

  private webUrl(value: unknown): string {
    if (typeof value !== "string" || value.length > 4096) throw new Error("Provide an http or https URL, or a search query.");
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only http and https URLs without embedded credentials are supported.");
    return url.href;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
      res.end(JSON.stringify(data));
    };
    const token = Buffer.from(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
    const secret = Buffer.from(this.token);
    if (req.method !== "POST" || req.url !== "/breadboard-use" || req.headers.origin ||
      token.length !== secret.length || !timingSafeEqual(token, secret)) {
      send(403, { error: "Breadboard access denied." }); return;
    }
    let acquired = false;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) { send(413, { error: "Request too large." }); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body.sessionId !== "string" || !body.sessionId || typeof body.args?.action !== "string") throw new Error("A session and action are required.");
      if (typeof body.runId !== "string" || !body.runId || body.runId.length > 256) throw new Error("A current run is required.");
      // Finalization can arrive while a page operation is awaiting Chromium.
      // It must revoke that run even then, without releasing another call's lock.
      if (body.args.action !== "release_run") {
        if (this.busy) { send(409, { error: "Another Breadboard action is running. Read fresh state and retry." }); return; }
        this.busy = true;
        acquired = true;
      }
      const base = this.options.dashboardUrl();
      const appTarget = base && this.targets().find(target => target.kind !== "browser" &&
        new URL(target.contents.getURL()).origin === new URL(base).origin);
      if (!Number.isInteger(body.userId) || body.userId <= 0 || !appTarget) {
        send(403, { error: "Sign into the Breadboard desktop app first." }); return;
      }
      // Check the desktop cookie session, not a model-supplied account. This
      // prevents a web-only account from controlling another user's desktop.
      const signedInId = await desktopSessionAccountId(base!, appTarget.contents.session);
      if (signedInId !== String(body.userId)) {
        send(403, { error: "The desktop app is signed into a different account." }); return;
      }
      send(200, await this.execute(body.args, body.sessionId, body.runId));
    } catch (error) { send(400, { error: error instanceof Error ? error.message : "Breadboard action failed." }); }
    finally { if (acquired) this.busy = false; }
  }
}
