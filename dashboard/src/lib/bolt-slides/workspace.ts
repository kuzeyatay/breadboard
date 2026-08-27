// One directory per deck, outside the clone.
//
// A workspace is a working copy of the authoring surface — `index.html`, the
// engine in `src/deck/`, the component library in `src/components/`, the
// styles — plus the three things a run actually writes: `src/App.tsx`, which is
// the deck; the `:root` block of `src/styles/tokens.css`, which is its theme;
// and the page title and favicon in `index.html`. `node_modules` is a directory
// junction back to the clone's, so a run borrows one install rather than
// repeating it, and the checkout is never written to.
//
// Vite's cache directory is named explicitly for that last reason. Its default
// is `node_modules/.vite`, which through the junction is a write straight into
// the clone; pointing it at the workspace keeps the rule true.
//
// `dist/` is what `vite build` leaves behind and what the deck route serves. It
// is addressed by relative path under that directory and nothing else, so a
// deck URL can never reach a file the build did not produce.

import type { Stats } from "node:fs";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import {
  externalRuntimeCopyFile,
  externalRuntimeFilesystem as fs,
  externalRuntimeLstat,
  externalRuntimePathExists,
  externalRuntimeReadDirectoryEntries,
  externalRuntimeReadUtf8,
  externalRuntimeRealpath,
} from "../external-runtime-filesystem.ts";
import { boltSlidesModules, boltSlidesWorkspaceRoot, resolveBoltSlidesRoot } from "./runtime.ts";

export interface BoltSlidesOwner {
  runId: string;
  userId: number;
  brief: string;
  createdAt: string;
}

export interface BoltSlidesArtifact {
  id: string;
  relativePath: string;
  name: string;
  kind: "deck" | "theme" | "component" | "page";
  contentType: string;
  size: number;
  modifiedAt: string;
}

const RUN_ID = /^bsrun_[0-9a-f]{32}$/;
const MAX_SOURCE_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_DECK_FILE_BYTES = 512 * 1024 * 1024;

/** Directories copied from the clone into every workspace, verbatim. */
const COPIED_DIRECTORIES = [
  path.join("src", "deck"),
  path.join("src", "components"),
  path.join("src", "styles"),
];

/** Single files copied from the clone, before the run overwrites what it owns. */
const COPIED_FILES = [
  "index.html",
  "tsconfig.json",
  "tsconfig.node.json",
  path.join("src", "main.tsx"),
];

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".tsx": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};

export class BoltSlidesWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function runDirectory(runId: string): string {
  if (!RUN_ID.test(runId)) {
    throw new BoltSlidesWorkspaceError("invalid_run_id", "That Bolt Slides run id is invalid.");
  }
  return path.join(boltSlidesWorkspaceRoot(), runId);
}

export function distDirectory(runId: string): string {
  return distDirectoryAt(runDirectory(runId));
}

export function appSourcePath(runId: string): string {
  return appSourcePathAt(runDirectory(runId));
}

export function tokensPath(runId: string): string {
  return tokensPathAt(runDirectory(runId));
}

export function baseStylesPath(runId: string): string {
  return baseStylesPathAt(runDirectory(runId));
}

export function indexHtmlPath(runId: string): string {
  return indexHtmlPathAt(runDirectory(runId));
}

/** Where a component the deck author had to invent is written. */
export function authoredDirectory(runId: string): string {
  return authoredDirectoryAt(runDirectory(runId));
}

export function distDirectoryAt(workspaceRoot: string): string {
  return path.join(workspaceRoot, "dist");
}

export function appSourcePathAt(workspaceRoot: string): string {
  return path.join(workspaceRoot, "src", "App.tsx");
}

export function tokensPathAt(workspaceRoot: string): string {
  return path.join(workspaceRoot, "src", "styles", "tokens.css");
}

export function baseStylesPathAt(workspaceRoot: string): string {
  return path.join(workspaceRoot, "src", "styles", "base.css");
}

export function indexHtmlPathAt(workspaceRoot: string): string {
  return path.join(workspaceRoot, "index.html");
}

export function authoredDirectoryAt(workspaceRoot: string): string {
  return path.join(workspaceRoot, "src", "authored");
}

/**
 * Link the clone's `node_modules` into the workspace.
 *
 * A junction rather than a copy: the install is large and a deck build reads
 * it, never writes it. Windows creates directory junctions without elevation,
 * which is why that type is named outright rather than left to the default.
 */
function linkModules(directory: string): void {
  const modules = boltSlidesModules();
  const link = path.join(directory, "node_modules");
  if (!modules || externalRuntimePathExists(link)) return;
  try {
    fs.symlinkSync(modules, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    // A filesystem that refuses links leaves the build to resolve packages the
    // ordinary way; `installedInWorkspace` is what reports whether it can.
  }
}

export function modulesLinked(runId: string): boolean {
  return modulesLinkedAt(runDirectory(runId));
}

export function modulesLinkedAt(workspaceRoot: string): boolean {
  return externalRuntimePathExists(path.join(workspaceRoot, "node_modules", "vite", "package.json"));
}

/**
 * The workspace's own Vite config.
 *
 * `base: "./"` makes every built asset URL relative, which is what lets one
 * `dist/` be served from a run-scoped path without being rebuilt for it.
 */
function viteConfig(): string {
  return [
    "import { defineConfig } from 'vite';",
    "import react from '@vitejs/plugin-react';",
    "",
    "// Written by Breadboard for one deck build. Assets are relative so the",
    "// finished deck can be served from any path, and the cache stays in this",
    "// workspace rather than in the linked clone.",
    "export default defineConfig({",
    "  base: './',",
    "  cacheDir: '.vite',",
    "  logLevel: 'warn',",
    "  plugins: [react()],",
    "  build: { outDir: 'dist', emptyOutDir: true },",
    "});",
    "",
  ].join("\n");
}

function copyDirectory(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of externalRuntimeReadDirectoryEntries(from)) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirectory(source, target);
    else if (entry.isFile()) externalRuntimeCopyFile(source, target);
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function contained(candidate: string, root: string): boolean {
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

/**
 * Prove that Runtime handed the worker one direct, non-linked attempt
 * workspace. The native start manifest already identity-binds this path; this
 * second check keeps the domain code from ever following an indirect root.
 */
export function requireDirectRuntimeWorkspace(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    const metadata = externalRuntimeLstat(resolved);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(externalRuntimeRealpath(resolved), resolved)
    ) {
      throw new Error("indirect workspace");
    }
    return resolved;
  } catch {
    throw new BoltSlidesWorkspaceError(
      "workspace_unavailable",
      "The Runtime-owned Bolt Slides workspace is unavailable.",
    );
  }
}

function populateWorkspace(directory: string): string {
  const root = resolveBoltSlidesRoot();
  if (!root) {
    throw new BoltSlidesWorkspaceError("not_cloned", "The bolt-slides clone was not found.");
  }
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  for (const relative of COPIED_DIRECTORIES) {
    copyDirectory(path.join(root, relative), path.join(directory, relative));
  }
  if (externalRuntimePathExists(path.join(root, "public"))) {
    copyDirectory(path.join(root, "public"), path.join(directory, "public"));
  }
  for (const relative of COPIED_FILES) {
    const source = path.join(root, relative);
    if (externalRuntimePathExists(source)) {
      externalRuntimeCopyFile(source, path.join(directory, relative));
    }
  }
  fs.writeFileSync(path.join(directory, "vite.config.ts"), viteConfig(), "utf8");
  fs.writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify(
      { name: "bolt-slides-deck", private: true, type: "module", version: "0.0.0" },
      null,
      2,
    )}\n`,
    "utf8",
  );
  linkModules(directory);
  return directory;
}

/** Populate the exact attempt workspace selected by the trusted Rust manifest. */
export function createRuntimeWorkspace(runtimeWorkspacePath: string): string {
  return populateWorkspace(requireDirectRuntimeWorkspace(runtimeWorkspacePath));
}

/**
 * Build a workspace from the clone and record who owns it.
 *
 * `public/` comes across when the clone has one: generated imagery for a deck
 * is written there, and a deck that lost its images between authoring and
 * building would render empty panels rather than fail loudly.
 */
export function createWorkspace(owner: BoltSlidesOwner): string {
  const directory = runDirectory(owner.runId);
  fs.mkdirSync(directory, { recursive: true });
  populateWorkspace(directory);
  fs.writeFileSync(
    path.join(directory, "owner.json"),
    `${JSON.stringify(owner, null, 2)}\n`,
    "utf8",
  );
  return directory;
}

export function requireWorkspaceOwner(userId: number, runId: string): BoltSlidesOwner {
  try {
    const parsed = JSON.parse(
      externalRuntimeReadUtf8(path.join(runDirectory(runId), "owner.json")),
    ) as BoltSlidesOwner;
    if (parsed.userId === userId) return parsed;
  } catch {
    // A missing workspace and somebody else's workspace answer the same way, so
    // a run id cannot be probed for existence.
  }
  throw new BoltSlidesWorkspaceError("run_not_found", "That Bolt Slides run was not found.");
}

export function boltSlidesArtifactId(relativePath: string): string {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

/**
 * The files a person would want out of a run: the deck, its theme, its page
 * shell, and any component the deck author had to invent. Everything else in
 * the workspace came from the clone and is already on their disk.
 */
export function scanArtifacts(runId: string): BoltSlidesArtifact[] {
  return scanArtifactsAt(runDirectory(runId));
}

export function scanArtifactsAt(workspaceRoot: string): BoltSlidesArtifact[] {
  const directory = requireDirectRuntimeWorkspace(workspaceRoot);
  const candidates: Array<{ relative: string; kind: BoltSlidesArtifact["kind"] }> = [
    { relative: "src/App.tsx", kind: "deck" },
    { relative: "src/styles/tokens.css", kind: "theme" },
    { relative: "index.html", kind: "page" },
  ];
  const authored = authoredDirectoryAt(directory);
  if (externalRuntimePathExists(authored)) {
    for (const entry of externalRuntimeReadDirectoryEntries(authored)) {
      if (entry.isFile()) {
        candidates.push({ relative: `src/authored/${entry.name}`, kind: "component" });
      }
    }
  }
  const artifacts: BoltSlidesArtifact[] = [];
  for (const candidate of candidates) {
    const absolute = path.join(directory, ...candidate.relative.split("/"));
    let stats: Stats;
    try {
      stats = externalRuntimeLstat(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_SOURCE_ARTIFACT_BYTES) continue;
    let canonical: string;
    try {
      canonical = externalRuntimeRealpath(absolute);
    } catch {
      continue;
    }
    if (!samePath(canonical, absolute) || !contained(canonical, directory)) continue;
    artifacts.push({
      id: boltSlidesArtifactId(candidate.relative),
      relativePath: candidate.relative,
      name: path.basename(candidate.relative),
      kind: candidate.kind,
      contentType:
        CONTENT_TYPES[path.extname(candidate.relative).toLowerCase()] ?? "text/plain; charset=utf-8",
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }
  return artifacts;
}

export function resolveArtifact(
  runId: string,
  id: string,
): { record: BoltSlidesArtifact; absolutePath: string } {
  const record = scanArtifacts(runId).find((artifact) => artifact.id === id);
  if (!record) {
    throw new BoltSlidesWorkspaceError("artifact_not_found", "That deck file was not found.");
  }
  return {
    record,
    absolutePath: path.join(runDirectory(runId), ...record.relativePath.split("/")),
  };
}

export function resolveArtifactAt(
  workspaceRoot: string,
  id: string,
): { record: BoltSlidesArtifact; absolutePath: string } {
  const root = requireDirectRuntimeWorkspace(workspaceRoot);
  const record = scanArtifactsAt(root).find((artifact) => artifact.id === id);
  if (!record) {
    throw new BoltSlidesWorkspaceError("artifact_not_found", "That deck file was not found.");
  }
  const absolutePath = path.resolve(root, ...record.relativePath.split("/"));
  if (!contained(absolutePath, root)) {
    throw new BoltSlidesWorkspaceError("artifact_not_found", "That deck file was not found.");
  }
  return { record, absolutePath };
}

export interface DeckFile {
  absolutePath: string;
  contentType: string;
  size: number;
}

/**
 * One file out of the built deck, addressed by its path inside `dist/`.
 *
 * An empty or directory-shaped path means the deck itself, which is
 * `index.html`. Everything resolves against `dist/` and is rejected unless it
 * stays inside it, so no request can walk out into the workspace.
 */
export function resolveDeckFile(runId: string, relative: string): DeckFile {
  return resolveDeckFileAt(runDirectory(runId), relative);
}

export function resolveDeckFileAt(workspaceRoot: string, relative: string): DeckFile {
  const workspace = requireDirectRuntimeWorkspace(workspaceRoot);
  const root = path.resolve(distDirectoryAt(workspace));
  const cleaned = relative.replace(/^\/+/, "");
  if (
    cleaned.length > 4_096 ||
    cleaned.includes("\0") ||
    path.win32.isAbsolute(cleaned) ||
    /[\\:\r\n]/u.test(cleaned) ||
    (cleaned && cleaned.split("/").some((segment) => !segment || segment === "." || segment === ".."))
  ) {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  let absolutePath = path.resolve(root, cleaned || "index.html");
  if (!contained(absolutePath, root)) {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  let stats: Stats;
  try {
    const rootMetadata = externalRuntimeLstat(root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("bad root");
    stats = externalRuntimeLstat(absolutePath);
  } catch {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  if (stats.isDirectory()) {
    absolutePath = path.join(absolutePath, "index.html");
    try {
      stats = externalRuntimeLstat(absolutePath);
    } catch {
      throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
    }
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_DECK_FILE_BYTES) {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  try {
    const canonicalRoot = externalRuntimeRealpath(root);
    const canonicalPath = externalRuntimeRealpath(absolutePath);
    if (
      !samePath(canonicalRoot, root) ||
      !samePath(canonicalPath, absolutePath) ||
      !contained(canonicalPath, canonicalRoot)
    ) throw new Error("indirect deck file");
  } catch {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  return {
    absolutePath,
    contentType:
      CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream",
    size: stats.size,
  };
}

export function deckIsBuilt(runId: string): boolean {
  return deckIsBuiltAt(runDirectory(runId));
}

export function deckIsBuiltAt(workspaceRoot: string): boolean {
  try {
    return resolveDeckFileAt(workspaceRoot, "index.html").size > 0;
  } catch {
    return false;
  }
}
