// Server-controlled workspace isolation.
//
// Every Hermes runtime session runs inside a distinct, server-computed
// workspace directory under the configured runtime root. The browser never
// supplies a path: it supplies a surface plus (for garden/quartz) ids, and the
// server derives a canonical, sanitized directory. This prevents a client from
// pointing a session at the Breadboard repo root, another user's garden, or an
// arbitrary filesystem location via traversal or symlink tricks.

import os from "node:os";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import {
  externalRuntimeFilesystem as fs,
  externalRuntimePortableRealpath,
} from "../external-runtime-filesystem.ts";
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

function pathEscapesAuthority(relative: string): boolean {
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function assertCanonicalContainment(
  canonicalRoot: string,
  canonicalCandidate: string,
  message: string,
): void {
  if (pathEscapesAuthority(path.relative(canonicalRoot, canonicalCandidate))) {
    throw new Error(message);
  }
}

function isFilesystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function assertOrdinaryDirectory(
  candidate: string,
  options: { create: boolean; label: string },
): void {
  let stats: ReturnType<typeof fs.lstatSync>;
  try {
    stats = fs.lstatSync(candidate);
  } catch (error) {
    if (!options.create || !isFilesystemError(error, "ENOENT")) throw error;
    try {
      fs.mkdirSync(candidate);
    } catch (mkdirError) {
      // A concurrent creator is acceptable only if the resulting entry passes
      // the same no-link authority check below.
      if (!isFilesystemError(mkdirError, "EEXIST")) throw mkdirError;
    }
    stats = fs.lstatSync(candidate);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing ${options.label} through a symbolic link or junction`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing ${options.label} through a non-directory path`);
  }
}

function workspaceRelativePath(root: string, directory: string, message: string): string {
  const relative = path.relative(root, directory);
  if (pathEscapesAuthority(relative)) throw new Error(message);
  return relative;
}

/**
 * Validate every existing entry below the configured root before descending
 * into it. When creating a workspace, this prevents a planted link from
 * receiving a child directory before the canonical containment check runs.
 */
function canonicalWorkspaceAuthority(
  root: string,
  directory: string,
  options: { create: boolean },
): void {
  const relative = workspaceRelativePath(
    root,
    directory,
    "Refusing workspace outside the configured Hermes root",
  );
  if (options.create) fs.mkdirSync(root, { recursive: true });
  const canonicalRoot = externalRuntimePortableRealpath(root);
  let current = root;
  let canonicalDirectory = canonicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    assertOrdinaryDirectory(current, {
      create: options.create,
      label: "Hermes workspace",
    });
    canonicalDirectory = externalRuntimePortableRealpath(current);
    assertCanonicalContainment(
      canonicalRoot,
      canonicalDirectory,
      "Resolved workspace escapes root via symlink",
    );
  }
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

  workspaceRelativePath(
    root,
    runtimeDirectory,
    "Refusing workspace outside the configured Hermes root",
  );

  if (options?.create) {
    canonicalWorkspaceAuthority(root, runtimeDirectory, { create: true });
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
    const resolved = externalRuntimePortableRealpath(path.resolve(value.trim()));
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
  workspaceRelativePath(root, directory, "Persisted workspace key resolves outside root");
  return directory;
}
