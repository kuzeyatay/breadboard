import * as http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { WebContents } from "electron";
import { capturePagePreservingVisibility } from "./capture-page";

export interface BrowserTerminalAccess { port: number; token: string }
type Target = () => WebContents | null;
type ContextOptions = { source?: "voice"; appTarget?: Target };
const TTL = 30 * 60_000;

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The browser did not respond. Try again after the page finishes loading.")), 8_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** A private, tab-scoped bridge. Web pages never receive its credentials. */
export class BrowserTerminalBridge {
  private server: http.Server | null = null;
  private starting: Promise<number> | null = null;
  private grants = new Map<string, { target: Target; expires: number; options: ContextOptions }>();

  async grant(target: Target, options: ContextOptions = {}): Promise<BrowserTerminalAccess> {
    for (const [key, grant] of this.grants) {
      if (grant.expires < Date.now() || !grant.target()) this.grants.delete(key);
    }
    if (this.grants.size >= 128) throw new Error("Too many browser sessions. Try again shortly.");
    const port = await this.start();
    const token = randomBytes(32).toString("hex");
    this.grants.set(token, { target, expires: Date.now() + TTL, options });
    return { port, token };
  }

  revoke(access: BrowserTerminalAccess): void { this.grants.delete(access.token); }

  private start(): Promise<number> {
    if (this.starting) return this.starting;
    this.starting = new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => void this.handle(req, res));
      this.server = server;
      server.requestTimeout = 10_000;
      server.headersTimeout = 10_000;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        resolve((server.address() as AddressInfo).port);
      });
    }).catch(error => { this.starting = null; throw error; });
    return this.starting;
  }

  async close(): Promise<void> {
    this.grants.clear();
    const server = this.server;
    this.server = null;
    this.starting = null;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let cleanup: (() => void) | undefined;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
      res.end(JSON.stringify(body));
    };
    try {
      // CORS is intentionally absent; even a local webpage cannot use this API.
      if (req.method !== "POST" || req.url !== "/browser-terminal" || req.headers.origin) {
        send(403, { error: "Browser access denied." }); return;
      }
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? "")?.[1];
      const grant = token ? this.grants.get(token) : undefined;
      if (!grant || grant.expires < Date.now()) { send(403, { error: "Browser access expired. Send a new message from the browser Terminal." }); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) { send(413, { error: "Browser request is too large." }); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || !["read", "screenshot", "scroll"].includes(body.action)) {
        send(400, { error: "Use read, screenshot, or scroll." }); return;
      }
      if (body.surface !== undefined && !["page", "app"].includes(body.surface)) {
        send(400, { error: "Choose page or app." }); return;
      }
      if (body.surface === "app" && grant.options.source !== "voice") {
        send(403, { error: "This conversation can only access its linked browser page." }); return;
      }
      const resolveTarget = body.surface === "app" ? grant.options.appTarget ?? grant.target : grant.target;
      const target = resolveTarget();
      if (!target || target.isDestroyed()) { send(409, { error: "The linked browser page is no longer open." }); return; }
      const url = target.getURL();
      if (!/^https?:\/\//i.test(url)) { send(409, { error: "Open a web page in this browser tab first." }); return; }
      let navigated = false;
      const onNavigation = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => { if (isMainFrame) navigated = true; };
      target.on("did-start-navigation", onNavigation);
      cleanup = () => target.removeListener("did-start-navigation", onNavigation);
      if (body.action === "scroll") {
        if (!["up", "down", "top", "bottom"].includes(body.direction)) {
          send(400, { error: "Choose up, down, top, or bottom." }); return;
        }
        await bounded(target.executeJavaScript(`(() => {
          const direction = ${JSON.stringify(body.direction)};
          const y = direction === 'top' ? 0 : direction === 'bottom' ? document.documentElement.scrollHeight : window.scrollY + (direction === 'up' ? -1 : 1) * innerHeight * 0.8;
          window.scrollTo({top: y, behavior: 'instant'});
        })()`));
      }
      const readPage = (contents: WebContents) => bounded(contents.executeJavaScript(`(() => {
        let text = document.body?.innerText || '';
        if (${grant.options.source === "voice"}) {
          // Voice describes the viewport, including the current end of a long
          // Terminal conversation. Off-screen history must not consume its budget.
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const visible = []; let node, visited = 0, length = 0;
          while ((node = walker.nextNode()) && visited++ < 20000 && length < 24000) {
            const parent = node.parentElement;
            if (!node.textContent.trim() || !parent || parent.closest('script,style,noscript,[hidden],[aria-hidden="true"]') || !parent.checkVisibility()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
            visible.push(node.textContent.trim()); length += node.textContent.length;
          }
          text = visible.join('\\n');
        }
        return {
        text: text.slice(0, 24000),
        selection: (window.getSelection()?.toString() || '').slice(0, 8000),
        scrollY: window.scrollY, viewportHeight: innerHeight,
        pageHeight: document.documentElement.scrollHeight
      }; })()`));
      const page = await readPage(target);
      // Voice sees the page and the trusted app/Terminal beside it. Only the
      // requested surface produces image bytes, using the existing vision path.
      const appTarget = grant.options.source === "voice" ? grant.options.appTarget?.() : null;
      const appUrl = appTarget?.getURL();
      const appPage = appTarget && appTarget !== target ? {
        ...await readPage(appTarget), url: appUrl, title: appTarget.getTitle(),
      } : undefined;
      let screenshot: { dataUrl: string; width: number; height: number } | undefined;
      if (body.action === "screenshot") {
        // A newly attached view may not have a compositor surface yet.
        const captureDeadline = Date.now() + 1_000;
        let capture = await bounded(capturePagePreservingVisibility(target));
        while (capture.isEmpty() && Date.now() < captureDeadline && !navigated && resolveTarget() === target) {
          await new Promise(resolve => setTimeout(resolve, 50));
          capture = await bounded(capturePagePreservingVisibility(target));
        }
        if (capture.isEmpty()) throw new Error("The browser screenshot is empty. Bring this tab into view and try again.");
        const size = capture.getSize();
        if (Math.max(size.width, size.height) > 1600) {
          capture = capture.resize(size.width >= size.height ? { width: 1600 } : { height: 1600 });
        }
        screenshot = { dataUrl: `data:image/jpeg;base64,${capture.toJPEG(80).toString("base64")}`, ...capture.getSize() };
      }
      // Never label a capture with a URL from a document it has already left.
      if (this.grants.get(token!) !== grant || navigated || resolveTarget() !== target || target.isDestroyed() || target.getURL() !== url
        || (appTarget && (grant.options.appTarget?.() !== appTarget || appTarget.isDestroyed() || appTarget.getURL() !== appUrl))) {
        send(409, { error: "The browser navigated during capture. Read it again." }); return;
      }
      send(200, { url, title: target.getTitle(), capturedAt: new Date().toISOString(), ...page,
        ...(grant.options.source ? { source: grant.options.source, surface: body.surface ?? "page", app: appPage } : {}),
        ...(screenshot ? { screenshot } : {}) });
    } catch (error) {
      send(400, { error: error instanceof Error ? error.message : "Browser capture failed." });
    } finally {
      cleanup?.();
    }
  }
}
