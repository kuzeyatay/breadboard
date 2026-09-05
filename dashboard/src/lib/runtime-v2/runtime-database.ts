if (typeof window !== "undefined") {
  throw new Error("Runtime V2 database access is server-only.");
}

import fs from "node:fs";
import Database from "better-sqlite3";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

/**
 * Read-only access to the Rust runtime's own SQLite store.
 *
 * The runtime exposes jobs one at a time through its control API (inspect by
 * id, lookup by idempotency key) but never lists them, because nothing in the
 * product needed a listing until "how is the upload going?" became a
 * question the assistant has to answer. Opening the store read-only answers
 * it without teaching the runtime a new endpoint: `runtime_jobs` already
 * carries the owning user, the Garden, the state, the stage, and the
 * progress counters. The runtime keeps the file in WAL mode, so a reader
 * never blocks a writer.
 */

export const RUNTIME_V2_DATABASE_FILE = "runtime-v2.sqlite3";

export function runtimeV2DatabaseCandidates(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env.BREADBOARD_RUNTIME_V2_DATABASE?.trim();
  const candidates = configured ? [path.resolve(configured)] : [];
  candidates.push(path.join(dashboardDataDir(), "runtime-v2", RUNTIME_V2_DATABASE_FILE));
  candidates.push(path.join(repositoryRoot(), "runtime-v2", RUNTIME_V2_DATABASE_FILE));
  return [...new Set(candidates)];
}

export function runtimeV2DatabasePath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const candidate of runtimeV2DatabaseCandidates(env)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not here; try the next layout.
    }
  }
  return null;
}

/**
 * Run one read against the runtime store and close it again. A missing or
 * unreadable store yields `null` rather than throwing: the runtime may simply
 * not be running, and the caller's answer must not depend on it.
 */
export function withRuntimeV2Database<T>(
  read: (database: Database.Database) => T,
  options: { readonly path?: string | null; readonly env?: NodeJS.ProcessEnv } = {},
): T | null {
  const file = options.path ?? runtimeV2DatabasePath(options.env);
  if (!file) return null;
  let database: Database.Database | null = null;
  try {
    database = new Database(file, { readonly: true, fileMustExist: true });
    database.pragma("busy_timeout = 250");
    return read(database);
  } catch {
    return null;
  } finally {
    database?.close();
  }
}
