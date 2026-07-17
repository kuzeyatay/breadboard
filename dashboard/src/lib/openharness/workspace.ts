// Server-controlled workspace isolation.
//
// Every OpenHarness runtime session runs inside a distinct, server-computed
// workspace directory under the configured runtime root. The browser never
// supplies a path: it supplies a surface plus (for garden/quartz) ids, and the
// server derives a canonical, sanitized directory. This prevents a client from
// pointing a session at the Breadboard repo root, another user's garden, or an
// arbitrary filesystem location via traversal or symlink tricks.

import fs from "node:fs";
import path from "node:path";
import type { OpenHarnessConfig, OpenHarnessSurface } from "./config.ts";

export interface WorkspaceRequest {
  surface: OpenHarnessSurface;
  sessionKey: string;
  gardenKey?: string;
  pageKey?: string;
}

export interface ResolvedWorkspace {
  /** Absolute, canonical directory OpenHarness should use (`?directory=`). */
  directory: string;
  /** Stable key persisted with the runtime session for reuse on resume. */
  workspaceKey: string;
}

/**
 * Reduce an arbitrary id to a filesystem-safe segment. Anything outside
 * `[a-z0-9_-]` becomes `-`, which neutralizes `..`, path separators, NUL bytes,
 * drive letters, and unicode tricks before they ever reach the filesystem.
 */
export function sanitizeSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "default";
}

/** Compute the workspace key (relative path fragments) for a request. */
export function workspaceKeyFor(request: WorkspaceRequest): string {
  const session = sanitizeSegment(request.sessionKey);
  if (request.surface === "garden_chat") {
    return path.posix.join("gardens", sanitizeSegment(request.gardenKey ?? "unknown"), session);
  }
  if (request.surface === "quartz_ai") {
    return path.posix.join(
      "quartz",
      sanitizeSegment(request.gardenKey ?? "unknown"),
      sanitizeSegment(request.pageKey ?? "index"),
      session,
    );
  }
  return path.posix.join("terminal", session);
}

/**
 * Resolve and (optionally) create the canonical workspace directory. Throws if
 * the resolved path would escape the configured root — a defense-in-depth check
 * on top of segment sanitization.
 */
export function resolveWorkspace(
  config: OpenHarnessConfig,
  request: WorkspaceRequest,
  options?: { create?: boolean },
): ResolvedWorkspace {
  const root = path.resolve(config.root);
  const workspaceKey = workspaceKeyFor(request);
  const directory = path.resolve(root, workspaceKey);

  const relative = path.relative(root, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing workspace outside the configured OpenHarness root");
  }

  if (options?.create) {
    fs.mkdirSync(directory, { recursive: true });
    // Reject symlink escapes: after creation, the real path must still be inside
    // the real root. This catches a pre-existing symlink planted at any segment.
    const realRoot = fs.realpathSync(root);
    const realDir = fs.realpathSync(directory);
    const realRelative = path.relative(realRoot, realDir);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Resolved workspace escapes root via symlink");
    }
  }

  return { directory, workspaceKey };
}

/**
 * Validate that a persisted workspace key (loaded from the DB on resume) is
 * still safe to use with the current root. Returns the absolute directory or
 * throws.
 */
export function directoryForWorkspaceKey(config: OpenHarnessConfig, workspaceKey: string): string {
  const root = path.resolve(config.root);
  const directory = path.resolve(root, workspaceKey);
  const relative = path.relative(root, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Persisted workspace key resolves outside root");
  }
  return directory;
}

/**
 * Write the short-lived capability descriptor into a session's workspace so the
 * OpenHarness garden/quartz tool adapter can read it and call back into
 * Breadboard. This lives in a dot-dir the tool reads directly; it is never in
 * model-visible prompt context. Written with restrictive intent (own dir).
 */
export function writeWorkspaceCapability(
  directory: string,
  descriptor: {
    token: string;
    dashboardUrl: string;
    surface: string;
    gardenId?: string;
    pageSlug?: string;
  },
): void {
  const dir = path.join(directory, ".breadboard");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "capability.json"), JSON.stringify(descriptor, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}
