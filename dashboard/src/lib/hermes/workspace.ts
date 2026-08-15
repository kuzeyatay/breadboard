// Server-controlled workspace isolation.
//
// Every Hermes runtime session runs inside a distinct, server-computed
// workspace directory under the configured runtime root. The browser never
// supplies a path: it supplies a surface plus (for garden/quartz) ids, and the
// server derives a canonical, sanitized directory. This prevents a client from
// pointing a session at the Breadboard repo root, another user's garden, or an
// arbitrary filesystem location via traversal or symlink tricks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HermesConfig, HermesSurface } from "./config.ts";
import type { FilesystemAccessMode } from "./runtime-store.ts";
import { repositoryRoot } from "../runtime-paths.ts";

export interface WorkspaceRequest {
  surface: HermesSurface;
  sessionKey: string;
  /** Canonical authenticated conversations are surface-independent. */
  conversationKey?: string;
  gardenKey?: string;
  pageKey?: string;
  filesystemMode?: FilesystemAccessMode;
  previousDirectory?: string | null;
}

export interface ResolvedWorkspace {
  /** Absolute, canonical directory Hermes should use (`?directory=`). */
  directory: string;
  /** Isolated Breadboard-owned directory for logs and capability metadata. */
  runtimeDirectory: string;
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
  if (request.conversationKey) {
    return path.posix.join("conversations", sanitizeSegment(request.conversationKey), session);
  }
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
  config: HermesConfig,
  request: WorkspaceRequest,
  options?: { create?: boolean },
): ResolvedWorkspace {
  const root = path.resolve(config.root);
  const workspaceKey = workspaceKeyFor(request);
  const runtimeDirectory = path.resolve(root, workspaceKey);

  const relative = path.relative(root, runtimeDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing workspace outside the configured Hermes root");
  }

  if (options?.create) {
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    // Reject symlink escapes: after creation, the real path must still be inside
    // the real root. This catches a pre-existing symlink planted at any segment.
    const realRoot = fs.realpathSync(root);
    const realDir = fs.realpathSync(runtimeDirectory);
    const realRelative = path.relative(realRoot, realDir);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Resolved workspace escapes root via symlink");
    }
  }

  // Actual-Electron QA runs shared development code but never authorizes that
  // checkout as a terminal working directory. Even a surface-only probe stays
  // physically inside the disposable Hermes workspace.
  const directory = process.env.BREADBOARD_QA_MODE === "1"
    ? runtimeDirectory
    : request.filesystemMode === "full"
    ? resolveInitialDirectory(request.previousDirectory, runtimeDirectory)
    : runtimeDirectory;
  return { directory, runtimeDirectory, workspaceKey };
}

function breadboardRepoRoot(): string | null {
  const cwd = path.resolve(process.cwd());
  const candidates = [repositoryRoot(), ...(path.basename(cwd).toLowerCase() === "dashboard"
    ? [path.dirname(cwd), cwd]
    : [cwd, path.dirname(cwd)])];
  return candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "hermes-config")) &&
    fs.existsSync(path.join(candidate, "dashboard")),
  ) ?? null;
}

/** Canonicalize an existing readable directory or return null. */
export function canonicalAccessibleDirectory(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(value.trim()));
    if (!fs.statSync(resolved).isDirectory()) return null;
    fs.accessSync(resolved, fs.constants.R_OK);
    return resolved;
  } catch {
    return null;
  }
}

/** previous selection -> Breadboard repository -> home -> isolated runtime. */
export function resolveInitialDirectory(
  previousDirectory: string | null | undefined,
  runtimeDirectory: string,
): string {
  const candidates = [previousDirectory, breadboardRepoRoot(), os.homedir(), runtimeDirectory];
  for (const candidate of candidates) {
    const resolved = canonicalAccessibleDirectory(candidate);
    if (resolved) return resolved;
  }
  throw new Error("No accessible initial directory is available");
}

/** Discover operating-system roots without probing or enumerating their contents. */
export function discoverFilesystemRoots(): string[] {
  const candidates = process.platform === "win32"
    ? Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
    : [path.parse(os.homedir()).root || "/"];
  return candidates.filter((candidate) => canonicalAccessibleDirectory(candidate) !== null);
}

/**
 * Validate that a persisted workspace key (loaded from the DB on resume) is
 * still safe to use with the current root. Returns the absolute directory or
 * throws.
 */
export function directoryForWorkspaceKey(config: HermesConfig, workspaceKey: string): string {
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
 * Hermes garden/quartz tool adapter can read it and call back into
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
