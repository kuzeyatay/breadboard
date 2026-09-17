import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import type { CommandLine, WebContents } from "electron";

const RUN_ID = /^job_[0-9a-f]{64}$/u;
const DEVTOOLS_ACTIVE_PORT = "DevToolsActivePort";
const RECEIPT_DIRECTORY = "browser-agent-sessions";
const TARGET_POLL_MS = 50;

export const BROWSER_AGENT_TARGET_TIMEOUT_MS = 10_000;

export interface BrowserAgentSessionReceipt {
  protocolVersion: 1;
  runId: string;
  cdpPort: number;
  targetUrl: string;
  createdAt: string;
}

export function isBrowserAgentRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}

/** A unique, inert document that lets the worker select only its own page. */
export function browserAgentBootstrapUrl(runId: string): string {
  if (!isBrowserAgentRunId(runId)) throw new TypeError("The browser-agent run id is invalid.");
  return `about:blank#breadboard-browser-agent=${runId}`;
}

export function isBrowserAgentBootstrapUrl(value: string, runId?: string): boolean {
  if (!value.startsWith("about:blank#breadboard-browser-agent=")) return false;
  const candidate = value.slice("about:blank#breadboard-browser-agent=".length);
  return isBrowserAgentRunId(candidate) && (runId === undefined || candidate === runId);
}

type PortRange = readonly [start: number, end: number];

/** The `start end` rows of `netsh interface ipv4 show excludedportrange`. */
export function parseExcludedPortRanges(output: string): PortRange[] {
  const ranges: PortRange[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*(\d{1,5})\s+(\d{1,5})(?:\s|$)/u.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start >= 1 && end <= 65_535 && start <= end) ranges.push([start, end]);
  }
  return ranges;
}

/**
 * Windows hands whole blocks of the dynamic port range to Hyper-V and WinNAT
 * (100 ports at a time, reshuffled at boot). Chromium cannot bind a port inside
 * one and says nothing: seen 2026-09-15, when 59618 fell in 59549-59648 and
 * every page that needs CDP (OpenAI (web), the browser agent) failed with
 * "connection refused" for the whole session.
 */
function windowsExcludedPortRanges(): PortRange[] {
  if (process.platform !== "win32") return [];
  try {
    return parseExcludedPortRanges(
      execFileSync("netsh", ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"], {
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true,
      }),
    );
  } catch {
    return [];
  }
}

/** A random unprivileged high port outside every reserved range. */
export function chooseBrowserAgentDebuggingPort(
  excluded: readonly PortRange[] = windowsExcludedPortRanges(),
  pick: () => number = () => randomInt(49_152, 65_536),
): number {
  const reserved = (port: number) => excluded.some(([start, end]) => port >= start && port <= end);
  for (let attempt = 0; attempt < 64; attempt++) {
    const port = pick();
    if (!reserved(port)) return port;
  }
  for (let port = 49_152; port <= 65_535; port++) if (!reserved(port)) return port;
  return pick();
}

/**
 * Electron must opt into CDP before Chromium starts. Electron does not publish
 * Chromium's DevToolsActivePort file for port zero, so choose an unprivileged
 * high port here and retain it only inside the main process and sealed worker
 * receipt. The loopback bind keeps the endpoint off the network.
 */
export function configureBrowserAgentDebugging(
  commandLine: Pick<CommandLine, "appendSwitch">,
  userDataDir: string,
  cdpPort = chooseBrowserAgentDebuggingPort(),
): number {
  if (!Number.isInteger(cdpPort) || cdpPort < 1_024 || cdpPort > 65_535) {
    throw new TypeError("The browser-agent debugging port is invalid.");
  }
  // A prior crash may leave a stale answer. Remove only Chromium's exact
  // single-file receipt after this process has won the single-instance lock.
  fs.rmSync(path.join(userDataDir, DEVTOOLS_ACTIVE_PORT), { force: true });
  commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  commandLine.appendSwitch("remote-debugging-port", String(cdpPort));
  return cdpPort;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isLoopbackPageWebSocket(value: unknown, port: number): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "ws:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      Number(url.port) === port &&
      /^\/devtools\/page\/[A-Za-z0-9_-]+$/u.test(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

async function targetExists(port: number, targetUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const targets = (await response.json()) as unknown;
    return (
      Array.isArray(targets) &&
      targets.some(
        (target) =>
          target !== null &&
          typeof target === "object" &&
          (target as Record<string, unknown>).type === "page" &&
          (target as Record<string, unknown>).url === targetUrl &&
          isLoopbackPageWebSocket(
            (target as Record<string, unknown>).webSocketDebuggerUrl,
            port,
          ),
      )
    );
  } catch {
    return false;
  }
}

export async function resolveBrowserAgentDebuggingPort(
  cdpPort: number,
  targetUrl: string,
  maximumWaitMs = BROWSER_AGENT_TARGET_TIMEOUT_MS,
): Promise<number | null> {
  if (!Number.isInteger(cdpPort) || cdpPort < 1_024 || cdpPort > 65_535) return null;
  const deadline = Date.now() + maximumWaitMs;
  do {
    if (await targetExists(cdpPort, targetUrl)) return cdpPort;
    await wait(TARGET_POLL_MS);
  } while (Date.now() < deadline);
  return null;
}

// ---- the ChatGPT tab lent to ChatMock's "OpenAI (web)" provider -------------
//
// Same device as the browser-agent bootstrap: an inert, unique document that
// lets the outside party pick this exact Chromium target out of `/json/list`.
// Here the outside party is ChatMock, which then navigates the tab to
// chatgpt.com itself and drives the site's composer over CDP.

const CHATGPT_WEB_BOOTSTRAP_PREFIX = "about:blank#breadboard-chatgpt-web=";
const CHATGPT_WEB_NONCE = /^[0-9a-f]{32}$/u;

export function chatgptWebBootstrapUrl(nonce: string): string {
  if (!CHATGPT_WEB_NONCE.test(nonce)) throw new TypeError("The ChatGPT tab nonce is invalid.");
  return `${CHATGPT_WEB_BOOTSTRAP_PREFIX}${nonce}`;
}

export function isChatgptWebBootstrapUrl(value: string): boolean {
  return (
    value.startsWith(CHATGPT_WEB_BOOTSTRAP_PREFIX) &&
    CHATGPT_WEB_NONCE.test(value.slice(CHATGPT_WEB_BOOTSTRAP_PREFIX.length))
  );
}

/**
 * A page's own DevTools target id, asked of Chromium rather than matched.
 *
 * `/json/list` can report a stale URL for a page whose document changed only
 * by fragment, or one created behind a window that was not on screen - and a
 * URL match then finds nothing even though the page is fine. The page itself
 * always knows its id: attach the in-process debugger for one command and ask.
 * Attaching is skipped when something is already attached, because Chromium
 * allows one such session per WebContents and an existing one is not ours to
 * take.
 */
export async function readDebuggingTargetId(contents: WebContents): Promise<string | null> {
  if (contents.isDestroyed()) return null;
  const inspector = contents.debugger;
  let attachedHere = false;
  try {
    if (!inspector.isAttached()) {
      inspector.attach("1.3");
      attachedHere = true;
    }
    const info = (await inspector.sendCommand("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: unknown; type?: unknown };
    };
    const id = info?.targetInfo?.targetId;
    return typeof id === "string" && /^[A-Za-z0-9_-]{4,128}$/u.test(id) ? id : null;
  } catch {
    return null;
  } finally {
    if (attachedHere && !contents.isDestroyed() && inspector.isAttached()) {
      try {
        inspector.detach();
      } catch {
        // Already gone with the page.
      }
    }
  }
}

/**
 * The DevTools target id of the page currently showing `targetUrl`, waiting
 * for Chromium to list it. Unlike the receipt path above, the id is what gets
 * handed on: it stays the same for the tab's whole life, so a later caller
 * can find the tab again after it has long since navigated to chatgpt.com.
 */
export async function resolveDebuggingTargetId(
  cdpPort: number,
  targetUrl: string,
  maximumWaitMs = BROWSER_AGENT_TARGET_TIMEOUT_MS,
): Promise<string | null> {
  if (!Number.isInteger(cdpPort) || cdpPort < 1_024 || cdpPort > 65_535) return null;
  const deadline = Date.now() + maximumWaitMs;
  do {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const targets = (await response.json()) as unknown;
        if (Array.isArray(targets)) {
          for (const target of targets) {
            if (target === null || typeof target !== "object") continue;
            const record = target as Record<string, unknown>;
            if (
              record.type === "page" &&
              record.url === targetUrl &&
              typeof record.id === "string" &&
              /^[A-Za-z0-9_-]{4,128}$/u.test(record.id) &&
              isLoopbackPageWebSocket(record.webSocketDebuggerUrl, cdpPort)
            ) {
              return record.id;
            }
          }
        }
      }
    } catch {
      // Not listed yet, or the endpoint is still coming up.
    }
    await wait(TARGET_POLL_MS);
  } while (Date.now() < deadline);
  return null;
}

export function browserAgentReceiptPath(dataRoot: string, runId: string): string {
  if (!isBrowserAgentRunId(runId)) throw new TypeError("The browser-agent run id is invalid.");
  return path.join(path.resolve(dataRoot), RECEIPT_DIRECTORY, `${runId}.json`);
}

export function writeBrowserAgentSessionReceipt(
  dataRoot: string,
  receipt: BrowserAgentSessionReceipt,
): void {
  if (
    receipt.protocolVersion !== 1 ||
    !isBrowserAgentRunId(receipt.runId) ||
    !Number.isInteger(receipt.cdpPort) ||
    receipt.cdpPort < 1_024 ||
    receipt.cdpPort > 65_535 ||
    !isBrowserAgentBootstrapUrl(receipt.targetUrl, receipt.runId) ||
    !Number.isFinite(Date.parse(receipt.createdAt))
  ) {
    throw new TypeError("The browser-agent session receipt is invalid.");
  }
  const filePath = browserAgentReceiptPath(dataRoot, receipt.runId);
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The browser-agent session directory is invalid.");
  }
  const temporary = `${filePath}.pending.${process.pid}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(receipt)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
