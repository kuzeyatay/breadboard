// Breadboard-owned adapter for the pinned, unmodified Flow runtime. Only the
// authenticated desktop bridge chooses a target; callers cannot supply CDP URLs.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFlow = createRequire(path.join(root, "google-flow-mcp", "package.json"));
const { chromium } = requireFlow("playwright");
const upstream = name => import(pathToFileURL(path.join(root, "google-flow-mcp", "dist", name)).href);
export const { BrowserManager } = await upstream("browser-manager.js");
export const { FlowAdapter } = await upstream("flow-adapter.js");
export const { FlowStore } = await upstream("store.js");
const { FlowError } = await upstream("errors.js");
export const FLOW_URL = "https://flow.google.com/";

export function isFlowUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "flow.google.com" ||
      (url.hostname === "labs.google" && url.pathname.startsWith("/fx/tools/flow")));
  } catch { return false; }
}

export async function requestBreadboardFlowTab(directory) {
  const userId = Number(path.basename(directory));
  const dataRoot = path.resolve(directory, "../../../../..");
  const expected = path.join(dataRoot, "runtime-v2", "services", "google-flow", "users", String(userId));
  if (!Number.isSafeInteger(userId) || userId < 1 || path.resolve(directory) !== expected) throw new Error("Flow requires a Breadboard user account directory.");
  let access;
  try { access = JSON.parse(await fs.readFile(path.join(dataRoot, "breadboard-use.json"), "utf8")); }
  catch { throw new Error("Open Breadboard to connect its background Flow tab."); }
  if (access.protocolVersion !== 1 || !Number.isInteger(access.port) || access.port < 1024 || access.port > 65535 ||
      typeof access.token !== "string" || !/^[a-f0-9]{64}$/.test(access.token)) throw new Error("Restart Breadboard to restore its browser connection.");
  const response = await fetch(`http://127.0.0.1:${access.port}/breadboard-use`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access.token}` },
    body: JSON.stringify({ args: { action: "flow_tab" }, userId, sessionId: "google-flow", runId: "google-flow" }),
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error === "Unsupported Breadboard action."
    ? "Restart Breadboard with the updated desktop build to enable its hidden Flow tab."
    : "Breadboard could not lend its hidden Flow tab. Check that you are signed into the desktop app.");
  if (result.hidden !== true || !Number.isInteger(result.cdpPort) || result.cdpPort < 1024 || result.cdpPort > 65535 ||
      typeof result.targetId !== "string" || !/^[a-f0-9]{32}$/i.test(result.targetId)) throw new Error("Breadboard returned an invalid hidden Flow tab.");
  return result;
}

export async function hiddenTargetTransport(target) {
  const response = await fetch(`http://127.0.0.1:${target.cdpPort}/json/version`, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  const version = await response.json();
  const endpoint = new URL(version.webSocketDebuggerUrl);
  if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1" || Number(endpoint.port) !== target.cdpPort) throw new Error("Invalid Breadboard browser endpoint.");
  let socket;
  const queue = [];
  const transport = {
    open() {
      socket = new WebSocket(endpoint);
      socket.addEventListener("open", () => { for (const message of queue.splice(0)) socket.send(message); });
      socket.addEventListener("message", event => this.onmessage?.(JSON.parse(String(event.data))));
      socket.addEventListener("close", () => this.onclose?.());
      socket.addEventListener("error", () => { socket.close(); this.onclose?.("Breadboard browser connection failed."); });
    },
    send(message) {
      // Playwright normally auto-attaches every page, which can pause unrelated
      // renderers or hang on a dormant Electron window. Attach only the target
      // supplied by the authenticated shell; child-frame attachment still works.
      if (!message.sessionId && message.method === "Target.setAutoAttach") {
        message = { id: message.id, method: "Target.attachToTarget", params: { targetId: target.targetId, flatten: true } };
      }
      const serialized = JSON.stringify(message);
      if (socket?.readyState === WebSocket.OPEN) socket.send(serialized);
      else queue.push(serialized);
    },
    close() { socket?.close(); },
  };
  transport.open();
  return transport;
}

export function installBreadboardFlowBrowser(directory, requestTab = requestBreadboardFlowTab) {
  BrowserManager.prototype.pageFor = async function (accountId) {
    // Revalidate with the signed-in desktop owner on every operation, including
    // after restarts. Never select a user's visible tab by URL.
    const target = await requestTab(directory);
    const existing = this.browsers.get(accountId);
    if (existing?.targetId === target.targetId && existing.cdpPort === target.cdpPort && !existing.page.isClosed()) return existing.page;
    await existing?.close();
    const browser = await chromium.connectOverCDP(await hiddenTargetTransport(target), { noDefaults: true, timeout: 10_000 });
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const session = await context.newCDPSession(page);
        let info;
        try { info = await session.send("Target.getTargetInfo"); }
        finally { await session.detach(); }
        if (info.targetInfo.targetId !== target.targetId) continue;
        page.setDefaultTimeout(10_000);
        page.setDefaultNavigationTimeout(45_000);
        // Playwright's connectOverCDP close disconnects this client transport;
        // it does not send Browser.close to the Electron owner.
        this.browsers.set(accountId, { context, page, targetId: target.targetId, cdpPort: target.cdpPort, close: () => browser.close() });
        return page;
      }
    }
    await browser.close();
    throw new Error("Breadboard's hidden Flow tab was closed. Retry the connection.");
  };
  // Keep upstream workspace/login checks, but accept Google's new Flow domain
  // without navigating away from the current project on every poll.
  FlowAdapter.prototype.readyPage = async function (accountId, requireLogin, url) {
    const page = await this.browsers.pageFor(accountId);
    if (url && !isFlowUrl(url)) throw new Error("The saved job has an invalid Flow project URL.");
    if (!isFlowUrl(page.url()) || (url && page.url() !== url)) await page.goto(url || FLOW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);
    if (requireLogin) {
      const access = await this.waitForAccessState(page, 8_000);
      if (!access.signedIn) {
        await this.store.markAccountNeedsReconnect(accountId, "Sign in to Google in Breadboard's browser, then reconnect Flow in Settings.");
        throw new FlowError("login_required", "Sign in to Google in Breadboard's browser, then reconnect Flow in Settings. Generation stays in a hidden tab.");
      }
      if (!access.workspaceAvailable) {
        await this.store.markAccountAccessUnavailable(accountId, "The Google account does not expose the Flow workspace.");
        throw new FlowError("flow_access_unavailable", "This Google account does not expose the Flow generation workspace.");
      }
      await this.store.markAccountConnected(accountId, false);
    }
    return page;
  };
}
