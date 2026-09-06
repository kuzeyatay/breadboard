import * as http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { WebContents } from "electron";
import { capturePagePreservingVisibility } from "./capture-page";

export interface BrowserTerminalAccess { port: number; token: string }
type Target = () => WebContents | null;
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
  private grants = new Map<string, { target: Target; expires: number }>();

  async grant(target: Target): Promise<BrowserTerminalAccess> {
    for (const [key, grant] of this.grants) {
      if (grant.expires < Date.now() || !grant.target()) this.grants.delete(key);
    }
    if (this.grants.size >= 128) throw new Error("Too many browser sessions. Try again shortly.");
    const port = await this.start();
    const token = randomBytes(32).toString("hex");
    this.grants.set(token, { target, expires: Date.now() + TTL });
    return { port, token };
  }

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
      const target = grant.target();
      if (!target || target.isDestroyed()) { send(409, { error: "The linked browser page is no longer open." }); return; }
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
      const page = await bounded(target.executeJavaScript(`(() => ({
        text: (document.body?.innerText || '').slice(0, 24000),
        selection: (window.getSelection()?.toString() || '').slice(0, 8000),
        scrollY: window.scrollY, viewportHeight: innerHeight,
        pageHeight: document.documentElement.scrollHeight
      }))()`));
      let screenshot: { dataUrl: string; width: number; height: number } | undefined;
      if (body.action === "screenshot") {
        // A newly attached view may not have a compositor surface yet.
        const captureDeadline = Date.now() + 1_000;
        let capture = await bounded(capturePagePreservingVisibility(target));
        while (capture.isEmpty() && Date.now() < captureDeadline && !navigated && grant.target() === target) {
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
      if (navigated || grant.target() !== target || target.isDestroyed() || target.getURL() !== url) {
        send(409, { error: "The browser navigated during capture. Read it again." }); return;
      }
      send(200, { url, title: target.getTitle(), capturedAt: new Date().toISOString(), ...page, ...(screenshot ? { screenshot } : {}) });
    } catch (error) {
      send(400, { error: error instanceof Error ? error.message : "Browser capture failed." });
    } finally {
      cleanup?.();
    }
  }
}
