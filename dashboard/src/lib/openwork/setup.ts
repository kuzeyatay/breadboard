// Read-only OpenWork setup status. Copying source and installing dependencies
// are owned by the authenticated Runtime V2 managed-setup worker, never by a
// dashboard or persistent service process.

import type { Dirent } from "node:fs";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import {
  runtimeAvailability,
  serverRuntimeRoot,
  workspaceRoot,
} from "./runtime.ts";

const FINGERPRINT_FILE = "breadboard-source.json";

export interface SetupStatus {
  /** Everything a run needs is in place. */
  ready: boolean;
  /** Why not, when it is not. */
  reason: string;
  cloned: boolean;
  clonePath: string;
  prepared: boolean;
  /** True when the clone has moved on since the server was prepared. */
  stale: boolean;
  version: string;
  bun: { found: boolean; source: string };
  engine: { found: boolean; version: string; source: string };
  /** The durable workspace the agent works inside. */
  workspacePath: string;
}

/**
 * A cheap, stable signature of the staged source closure: every source file's
 * path and size, plus the server manifest and constants file.
 */
function sourceFingerprint(root: string): string {
  const parts: string[] = [];
  const walk = (directory: string, prefix: string) => {
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        parts.push(`${relative}:${fs.statSync(absolute).size}`);
      } catch {
        // A source file that vanished mid-read simply makes the generation stale.
      }
    }
  };
  walk(path.join(root, "apps", "server", "src"), "src");
  for (const file of ["apps/server/package.json", "constants.json"]) {
    try {
      parts.push(`${file}:${fs.statSync(path.join(root, ...file.split("/"))).size}`);
    } catch {
      // Missing required files are reported by runtime availability.
    }
  }
  return parts.join("|");
}

function readPreparedFingerprint(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(serverRuntimeRoot(env), FINGERPRINT_FILE), "utf8"),
    ) as { fingerprint?: unknown };
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): SetupStatus {
  const availability = runtimeAvailability(env);
  const root = availability.root;
  const server = availability.toolchain.server;
  const bun = availability.toolchain.bun;
  const engine = availability.toolchain.engine;
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    cloned: availability.cloned,
    clonePath: root ?? "",
    prepared: server.found,
    stale:
      Boolean(root) &&
      server.found &&
      readPreparedFingerprint(env) !== sourceFingerprint(root as string),
    version: server.version,
    bun: { found: bun.found, source: bun.source },
    engine: engine.found
      ? { found: true, version: engine.version, source: engine.source }
      : { found: false, version: "", source: "" },
    workspacePath: workspaceRoot(env),
  };
}
