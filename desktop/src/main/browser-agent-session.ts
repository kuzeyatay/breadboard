import * as fs from "node:fs";
import * as path from "node:path";
import { randomInt } from "node:crypto";
import type { CommandLine } from "electron";

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

/**
 * Electron must opt into CDP before Chromium starts. Electron does not publish
 * Chromium's DevToolsActivePort file for port zero, so choose an unprivileged
 * high port here and retain it only inside the main process and sealed worker
 * receipt. The loopback bind keeps the endpoint off the network.
 */
export function configureBrowserAgentDebugging(
  commandLine: Pick<CommandLine, "appendSwitch">,
  userDataDir: string,
  cdpPort = randomInt(49_152, 65_536),
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
