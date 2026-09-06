import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { WebContents } from "electron";
import type { TabManager } from "./tab-manager";
import { breadboardDomOperation } from "./breadboard-use-dom";
import { capturePagePreservingVisibility } from "./capture-page";
import type { ClickyLauncher } from "./clicky-launcher";

const ROUTES: Record<string, string> = {
  garden: "/garden", dashboard: "/dashboard", home: "/new-tab", settings: "/profile",
  calendar: "/calendar", plan: "/plan", workflows: "/workflows", processes: "/processes",
};
const KEYS = new Set(["Enter", "Escape", "Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Delete"]);
const ACTIONS = new Set(["state", "open", "navigate", "activate", "close", "snapshot", "screenshot", "click", "fill", "press", "scroll", "close_voice", "launch_clicky"]);

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

  constructor(private options: { tabs: TabManager; dataRoot: string; dashboardUrl: () => string | null; clicky?: () => ClickyLauncher }) {}

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
  }

  private get receiptPath() { return path.join(this.options.dataRoot, "breadboard-use.json"); }

  async close(): Promise<void> {
    this.snapshots.clear();
    const server = this.server;
    this.server = null;
    try {
      if (JSON.parse(fs.readFileSync(this.receiptPath, "utf8")).token === this.token) fs.unlinkSync(this.receiptPath);
    } catch { /* An absent receipt is already revoked. */ }
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }

  private targets() { return this.options.tabs.breadboardUseTargets(); }

  private state() {
    return { capturedAt: new Date().toISOString(), clicky: this.options.clicky?.().state() ?? null, targets: this.targets().map(({ contents, chrome, ...info }) => ({
      ...info, targetId: contents.id, url: contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(),
    })) };
  }

  private async dom(contents: WebContents, args: Record<string, unknown>) {
    const result = await bounded(contents.executeJavaScript(`(() => {
      try { return { ok: true, value: (${breadboardDomOperation.toString()})(${JSON.stringify(args)}) }; }
      catch (error) { return { ok: false, error: error.message || 'Page interaction failed.' }; }
    })()`, true));
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  async execute(args: BreadboardUseArgs, sessionId: string): Promise<Record<string, unknown>> {
    if (!ACTIONS.has(args.action)) throw new Error("Unsupported Breadboard action.");
    const targets = this.targets();
    const base = this.options.dashboardUrl();
    if (!base || !targets.length) throw new Error("Breadboard is still starting. Try again when the dashboard is ready.");
    if (args.action === "state") return this.state();
    if (args.action === "launch_clicky") {
      const launcher = this.options.clicky?.();
      if (!launcher) throw new Error("The Clicky launcher is unavailable. Restart Breadboard with the updated desktop shell.");
      const launch = await launcher.launch();
      return { performed: launch.ok, launch, ...this.state() };
    }
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
        ok = await command({ type: "browser", ...(url ? { url } : {}) });
      } else {
        const route = ROUTES[surface];
        if (!route) throw new Error(`Choose browser or ${Object.keys(ROUTES).join(", ")}.`);
        const url = new URL(route, base).href;
        const existing = targets.find(t => t.kind === "app" && t.contents.getURL() === url && t.windowId === target.windowId);
        ok = await command(existing ? { type: "activate", id: existing.tabId } : { type: "open", url });
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
        ok = await command({ type: "browser-navigate", input });
      } else ok = await command({ type: args.action, id: target.tabId });
      if (!ok) throw new Error("Breadboard could not perform that tab action.");
      this.snapshots.delete(contents.id);
      return { performed: true, ...this.state() };
    }
    const inspecting = args.action === "snapshot" || args.action === "screenshot";
    // A target chosen from state can belong to a background tab. Bring that
    // exact tab into view within the capture request, without requiring a
    // separate activation round trip before the agent can inspect its controls.
    if (inspecting && !target.active) {
      if (!await command({ type: "activate", id: target.tabId })) {
        throw new Error("Breadboard could not activate that tab. Read fresh state and choose a targetId.");
      }
    }
    if (!this.targets().some(t => t.contents.id === contents.id && t.active)) {
      throw new Error("Activate this target's tab before inspecting or interacting with it.");
    }
    if (contents.isLoadingMainFrame()) throw new Error("The page is loading. Read state again before interacting.");
    if (inspecting) {
      this.snapshots.delete(contents.id);
      const id = randomUUID();
      const url = contents.getURL();
      const page = await this.dom(contents, { action: "snapshot", snapshotId: id });
      let screenshot;
      if (args.action === "screenshot") {
        let capture = await bounded(capturePagePreservingVisibility(contents));
        if (capture.isEmpty()) throw new Error("No screenshot is available yet. Try again when the page is visible.");
        const size = capture.getSize();
        if (Math.max(size.width, size.height) > 1600) capture = capture.resize(size.width >= size.height ? { width: 1600 } : { height: 1600 });
        screenshot = { dataUrl: `data:image/jpeg;base64,${capture.toJPEG(80).toString("base64")}`, ...capture.getSize() };
      }
      if (contents.isDestroyed() || contents.getURL() !== url || contents.isLoadingMainFrame()) throw new Error("The page changed during capture. Take another snapshot.");
      if (!this.targets().some(t => t.contents.id === contents.id && t.active)) {
        throw new Error("The active tab changed during capture. Take another snapshot of the intended target.");
      }
      this.snapshots.set(contents.id, { id, url, expires: Date.now() + 120_000, sessionId });
      return { targetId: contents.id, url, title: contents.getTitle(), ...page, ...(screenshot ? { screenshot } : {}) };
    }
    const snapshot = this.snapshots.get(contents.id);
    if (!snapshot || snapshot.id !== args.snapshotId || snapshot.sessionId !== sessionId || snapshot.url !== contents.getURL() || snapshot.expires < Date.now()) {
      throw new Error("Snapshot expired. Take another snapshot before acting.");
    }
    if (["click", "fill"].includes(args.action) && typeof args.ref !== "string") throw new Error("Choose a ref from the snapshot.");
    if (args.action === "fill" && (typeof args.text !== "string" || args.text.length > 10000)) throw new Error("Provide text up to 10,000 characters.");
    if (args.action === "scroll" && !["up", "down", "top", "bottom"].includes(String(args.direction))) throw new Error("Choose up, down, top, or bottom.");
    if (args.action === "press") {
      if (!KEYS.has(String(args.key))) throw new Error("Unsupported key.");
      if (args.ref) await this.dom(contents, { ...args, action: "focus" });
      contents.sendInputEvent({ type: "keyDown", keyCode: args.key as string });
      contents.sendInputEvent({ type: "keyUp", keyCode: args.key as string });
    } else await this.dom(contents, args);
    this.snapshots.delete(contents.id);
    return { performed: true, targetId: contents.id, next: "Take a fresh snapshot to verify the result." };
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
    if (this.busy) { send(409, { error: "Another Breadboard action is running. Read fresh state and retry." }); return; }
    this.busy = true;
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
      const base = this.options.dashboardUrl();
      const appTarget = base && this.targets().find(target => target.kind !== "browser" &&
        new URL(target.contents.getURL()).origin === new URL(base).origin);
      if (!Number.isInteger(body.userId) || body.userId <= 0 || !appTarget) {
        send(403, { error: "Sign into the Breadboard desktop app first." }); return;
      }
      // Check the desktop cookie session, not a model-supplied account. This
      // prevents a web-only account from controlling another user's desktop.
      const signedInId = await bounded(appTarget.contents.executeJavaScript(
        "fetch('/api/auth/session', {cache:'no-store'}).then(r => r.ok ? r.json() : null).then(s => String(s?.user?.id || ''))",
      ));
      if (signedInId !== String(body.userId)) {
        send(403, { error: "The desktop app is signed into a different account." }); return;
      }
      send(200, await this.execute(body.args, body.sessionId));
    } catch (error) { send(400, { error: error instanceof Error ? error.message : "Breadboard action failed." }); }
    finally { this.busy = false; }
  }
}
