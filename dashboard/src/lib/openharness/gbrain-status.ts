import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenHarnessMcpStatus } from "./client.ts";

export interface GBrainCapabilityState {
  provider: "gbrain";
  checkoutPath: string | null;
  checkoutFound: boolean;
  separateCheckout: boolean;
  version: string | null;
  revision: string | null;
  installed: boolean;
  initialized: boolean;
  processRunning: boolean;
  connected: boolean;
  toolCount: number;
  healthy: boolean;
  storagePath: string | null;
  reason?: string;
}

function repositoryRoot(): string {
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}

function configuredCheckout(): string {
  return process.env.GBRAIN_PATH?.trim() || path.join(repositoryRoot(), "gbrain");
}

function gbrainConfigPath(): string {
  const configuredHome = process.env.GBRAIN_HOME?.trim();
  const parent = configuredHome ? path.resolve(configuredHome) : os.homedir();
  return path.join(parent, ".gbrain", "config.json");
}

function commandInstalled(): boolean {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter);
  const names = process.platform === "win32" ? ["gbrain.exe", "gbrain.cmd", "gbrain.bat"] : ["gbrain"];
  return pathEntries.some((entry) => names.some((name) => fs.existsSync(path.join(entry, name))));
}

export function inspectGBrainState(
  mcp: Record<string, OpenHarnessMcpStatus> = {},
  toolIds: string[] = [],
): GBrainCapabilityState {
  const checkoutPath = configuredCheckout();
  const manifestPath = path.join(checkoutPath, "package.json");
  const checkoutFound = fs.existsSync(manifestPath);
  let expectedPackage = false;
  let version: string | null = null;
  if (checkoutFound) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string; version?: string };
      expectedPackage = manifest.name === "gbrain";
      version = typeof manifest.version === "string" ? manifest.version : null;
    } catch {
      expectedPackage = false;
    }
  }
  const separateCheckout = fs.existsSync(path.join(checkoutPath, ".git"));
  const configPath = gbrainConfigPath();
  let storagePath: string | null = null;
  let initialized = false;
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        database_path?: unknown;
        database_url?: unknown;
        remote_mcp?: unknown;
      };
      initialized = Boolean(config.database_path || config.database_url || config.remote_mcp);
      storagePath = typeof config.database_path === "string" ? config.database_path : configPath;
    } catch {
      initialized = false;
    }
  }
  const status = mcp.gbrain;
  const connected = status?.status === "connected";
  const gbrainTools = toolIds.filter((id) => id.startsWith("gbrain_") || id.includes("gbrain"));
  const healthy = connected && gbrainTools.length > 0;
  const reasons = [
    !checkoutFound ? "GBrain checkout was not found." : null,
    checkoutFound && !expectedPackage ? "The configured checkout is not the expected gbrain package." : null,
    checkoutFound && !separateCheckout
      ? "The available GBrain source is committed inside Breadboard, not a separate Git checkout; an upstream revision cannot be proven."
      : null,
    !commandInstalled() ? "The gbrain executable is not installed on PATH." : null,
    !initialized ? "GBrain storage is not initialized." : null,
    initialized && !connected ? `GBrain MCP is ${status?.status ?? "not configured"}.` : null,
    connected && gbrainTools.length === 0 ? "The MCP transport connected but no GBrain tools were discovered." : null,
  ].filter((value): value is string => Boolean(value));
  return {
    provider: "gbrain",
    checkoutPath: checkoutFound ? checkoutPath : null,
    checkoutFound,
    separateCheckout,
    version,
    revision: null,
    installed: commandInstalled(),
    initialized,
    processRunning: connected,
    connected,
    toolCount: gbrainTools.length,
    healthy,
    storagePath,
    ...(reasons.length ? { reason: reasons.join(" ") } : {}),
  };
}
