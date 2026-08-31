// Where a demonstration's bytes live, and for how long.
//
// Two directories with two different lifetimes, and the split is the point. A
// teaching *session* holds the raw recording -- audio, keyframes, the event log.
// A saved *workflow* holds the procedure and its compiled form. Once a workflow
// has been compiled it runs from the second directory alone, so the first can be
// deleted whenever the user or the retention policy says so and the workflow
// keeps working.
//
// Both sit under the dashboard's existing data root rather than a new store.

import fs from "node:fs";
import path from "node:path";

import { dashboardDataDir } from "../runtime-paths.ts";

/** Identifiers reach here from routes; anything but this shape is a bug or an attack. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function assertSafeId(id: string, what: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid ${what}.`);
  return id;
}

export function teachRoot(): string {
  return path.join(dashboardDataDir(), "runtime", "teach");
}

/** Raw demonstration capture for one teaching session. Deletable after compilation. */
export function sessionDirectory(sessionId: string): string {
  return path.join(teachRoot(), "sessions", assertSafeId(sessionId, "session id"));
}

export function sessionRecordingDirectory(sessionId: string): string {
  return path.join(sessionDirectory(sessionId), "recording");
}

export function sessionFramesDirectory(sessionId: string): string {
  return path.join(sessionRecordingDirectory(sessionId), "frames");
}

/** The durable half: procedure, compiled representation, run scratch. */
export function workflowDirectory(workflowId: string): string {
  return path.join(teachRoot(), "workflows", assertSafeId(workflowId, "workflow id"));
}

export function workflowCompiledDirectory(workflowId: string): string {
  return path.join(workflowDirectory(workflowId), "compiled");
}

export function workflowRunDirectory(workflowId: string, runId: string): string {
  return path.join(workflowDirectory(workflowId), "runs", assertSafeId(runId, "run id"));
}

export function helperCacheDirectory(): string {
  return path.join(teachRoot(), "helper");
}

export function ensureDirectory(directory: string): string {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * Resolve a path the model or a stored record named, and refuse anything that
 * climbs out of the directory it was supposed to be inside.
 */
export function resolveWithin(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relative);
  const inside = path.relative(resolvedRoot, candidate);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error("That path is outside the directory it belongs to.");
  }
  return candidate;
}

export function removeDirectory(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
}

export function directorySizeBytes(directory: string): number {
  let total = 0;
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += fs.statSync(full).size;
      } catch {
        // A file removed between listing and stat is one the size no longer counts.
      }
    }
  };
  walk(directory);
  return total;
}

/**
 * Drop the raw recording, keeping the workflow that was learned from it.
 *
 * Called when a session is cancelled, when the user asks, and by the retention
 * sweep. Returns how much was reclaimed so the caller can say so.
 */
export function discardSessionRecording(sessionId: string): { removed: boolean; bytes: number } {
  const directory = sessionRecordingDirectory(sessionId);
  if (!fs.existsSync(directory)) return { removed: false, bytes: 0 };
  const bytes = directorySizeBytes(directory);
  removeDirectory(directory);
  return { removed: true, bytes };
}
