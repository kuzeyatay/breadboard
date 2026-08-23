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

import fs from "node:fs";
import path from "node:path";
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
  return path.join(runDirectory(runId), "dist");
}

export function appSourcePath(runId: string): string {
  return path.join(runDirectory(runId), "src", "App.tsx");
}

export function tokensPath(runId: string): string {
  return path.join(runDirectory(runId), "src", "styles", "tokens.css");
}

export function baseStylesPath(runId: string): string {
  return path.join(runDirectory(runId), "src", "styles", "base.css");
}

export function indexHtmlPath(runId: string): string {
  return path.join(runDirectory(runId), "index.html");
}

/** Where a component the deck author had to invent is written. */
export function authoredDirectory(runId: string): string {
  return path.join(runDirectory(runId), "src", "authored");
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
  if (!modules || fs.existsSync(link)) return;
  try {
    fs.symlinkSync(modules, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    // A filesystem that refuses links leaves the build to resolve packages the
    // ordinary way; `installedInWorkspace` is what reports whether it can.
  }
}

export function modulesLinked(runId: string): boolean {
  return fs.existsSync(path.join(runDirectory(runId), "node_modules", "vite", "package.json"));
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
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirectory(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

/**
 * Build a workspace from the clone and record who owns it.
 *
 * `public/` comes across when the clone has one: generated imagery for a deck
 * is written there, and a deck that lost its images between authoring and
 * building would render empty panels rather than fail loudly.
 */
export function createWorkspace(owner: BoltSlidesOwner): string {
  const root = resolveBoltSlidesRoot();
  if (!root) {
    throw new BoltSlidesWorkspaceError("not_cloned", "The bolt-slides clone was not found.");
  }
  const directory = runDirectory(owner.runId);
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  for (const relative of COPIED_DIRECTORIES) {
    copyDirectory(path.join(root, relative), path.join(directory, relative));
  }
  if (fs.existsSync(path.join(root, "public"))) {
    copyDirectory(path.join(root, "public"), path.join(directory, "public"));
  }
  for (const relative of COPIED_FILES) {
    const source = path.join(root, relative);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(directory, relative));
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
      fs.readFileSync(path.join(runDirectory(runId), "owner.json"), "utf8"),
    ) as BoltSlidesOwner;
    if (parsed.userId === userId) return parsed;
  } catch {
    // A missing workspace and somebody else's workspace answer the same way, so
    // a run id cannot be probed for existence.
  }
  throw new BoltSlidesWorkspaceError("run_not_found", "That Bolt Slides run was not found.");
}

function artifactId(relativePath: string): string {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

/**
 * The files a person would want out of a run: the deck, its theme, its page
 * shell, and any component the deck author had to invent. Everything else in
 * the workspace came from the clone and is already on their disk.
 */
export function scanArtifacts(runId: string): BoltSlidesArtifact[] {
  const directory = runDirectory(runId);
  const candidates: Array<{ relative: string; kind: BoltSlidesArtifact["kind"] }> = [
    { relative: "src/App.tsx", kind: "deck" },
    { relative: "src/styles/tokens.css", kind: "theme" },
    { relative: "index.html", kind: "page" },
  ];
  const authored = authoredDirectory(runId);
  if (fs.existsSync(authored)) {
    for (const entry of fs.readdirSync(authored, { withFileTypes: true })) {
      if (entry.isFile()) {
        candidates.push({ relative: `src/authored/${entry.name}`, kind: "component" });
      }
    }
  }
  const artifacts: BoltSlidesArtifact[] = [];
  for (const candidate of candidates) {
    const absolute = path.join(directory, ...candidate.relative.split("/"));
    let stats: fs.Stats;
    try {
      stats = fs.statSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    artifacts.push({
      id: artifactId(candidate.relative),
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
  const root = path.resolve(distDirectory(runId));
  const cleaned = relative.replace(/^\/+/, "");
  if (cleaned.includes("\0")) {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  let absolutePath = path.resolve(root, cleaned || "index.html");
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
  }
  if (stats.isDirectory()) {
    absolutePath = path.join(absolutePath, "index.html");
    try {
      stats = fs.statSync(absolutePath);
    } catch {
      throw new BoltSlidesWorkspaceError("deck_not_found", "That deck file was not found.");
    }
  }
  return {
    absolutePath,
    contentType:
      CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream",
    size: stats.size,
  };
}

export function deckIsBuilt(runId: string): boolean {
  try {
    return fs.statSync(path.join(distDirectory(runId), "index.html")).isFile();
  } catch {
    return false;
  }
}
