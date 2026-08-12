// The Garden's knowledge base: when it exists, when it is stale, and how it
// gets rebuilt.
//
// A knowledge base is the difference between a tutor that greps your notes and
// one that retrieves from them. DeepTutor auto-mounts its `rag` tool the moment
// a turn names a KB, and retrieval runs over vectors, so a question that shares
// no words with a note can still find it. That is worth having, and it is worth
// never blocking a question on.
//
// So indexing is asynchronous and this module owns the honesty around it: a
// turn uses the index only if it is genuinely fresh, a stale index triggers a
// background rebuild, and until that finishes the tutor falls back to the file
// tools it has always had. Nothing here ever makes a turn wait.
//
// Freshness is a manifest comparison, not a timestamp: the set of files, each
// one's size and mtime, and the fingerprint of the embedding model the vectors
// were built in. Changing the embedding model invalidates every index, which is
// exactly what should happen — vectors from two models are not comparable.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { deepTutorHome, embeddingFingerprint } from "./home.ts";
import {
  bridgeScriptPath,
  deepTutorEnv,
  resolveDeepTutorRoot,
  venvPython,
} from "./runtime.ts";
import type { TutorScope } from "./materials.ts";

/** Files worth putting in a vector index. Mirrors what DeepTutor can parse. */
const INDEXABLE = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".csv",
]);

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "dist",
  "build",
  ".obsidian",
]);

/** Indexing a whole workspace would be an hour of CPU for a corpus of code. */
const MAX_INDEXED_FILES = 600;
const MAX_INDEXED_FILE_BYTES = 8 * 1024 * 1024;
const INDEX_TIMEOUT_MS = 45 * 60 * 1000;

export interface IndexedDocument {
  path: string;
  size: number;
  modified: number;
}

export interface IndexManifest {
  /** The DeepTutor knowledge-base name. */
  kb: string;
  /** Which vector space the index was built in. */
  fingerprint: string;
  builtAt: string;
  documents: IndexedDocument[];
  documentCount: number;
  chunkCount: number;
}

export type IndexPhase = "ready" | "stale" | "missing" | "building" | "unsupported" | "failed";

export interface IndexState {
  phase: IndexPhase;
  kb: string | null;
  documentCount: number;
  chunkCount: number;
  builtAt: string | null;
  /** How many files would go into a build started now. */
  candidateCount: number;
  /** Set when the last build failed; cleared by the next success. */
  error: string | null;
}

/**
 * The knowledge-base name for a scope.
 *
 * Only Gardens get one. The Terminal's scope is a whole workspace — mostly code
 * and mostly irrelevant to any one question — where indexing would cost a lot
 * and retrieval would mostly surface noise. There the file tools are not a
 * fallback, they are the right tool.
 */
export function knowledgeBaseName(scope: TutorScope): string | null {
  if (scope.kind !== "garden") return null;
  // The scope id is already filesystem-safe, and KB names reject path and URL
  // separators, so this is the whole sanitisation needed.
  return scope.id.replace(/[<>:"/\\|?*#%]/g, "-").slice(0, 100) || null;
}

function manifestPath(userId: number, scope: TutorScope): string {
  return path.join(deepTutorHome(userId, scope.id), "breadboard-index.json");
}

export function readManifest(userId: number, scope: TutorScope): IndexManifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(userId, scope), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.kb !== "string" || !Array.isArray(record.documents)) return null;
    return {
      kb: record.kb,
      fingerprint: typeof record.fingerprint === "string" ? record.fingerprint : "",
      builtAt: typeof record.builtAt === "string" ? record.builtAt : "",
      documents: record.documents.filter(
        (item): item is IndexedDocument =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as IndexedDocument).path === "string",
      ),
      documentCount: Number(record.documentCount) || 0,
      chunkCount: Number(record.chunkCount) || 0,
    };
  } catch {
    return null;
  }
}

function writeManifest(userId: number, scope: TutorScope, manifest: IndexManifest): void {
  const file = manifestPath(userId, scope);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } catch {
    // A lost manifest costs a rebuild, not correctness.
  }
}

export function clearManifest(userId: number, scope: TutorScope): void {
  try {
    fs.rmSync(manifestPath(userId, scope), { force: true });
  } catch {
    // Nothing to clear.
  }
}

/** Everything in scope that is worth indexing, in a stable order. */
export function indexableDocuments(scope: TutorScope): IndexedDocument[] {
  const found: IndexedDocument[] = [];
  for (const root of scope.roots) {
    walk(root, 0, (file, stats) => {
      if (found.length >= MAX_INDEXED_FILES) return;
      if (!INDEXABLE.has(path.extname(file).toLowerCase())) return;
      if (stats.size === 0 || stats.size > MAX_INDEXED_FILE_BYTES) return;
      found.push({ path: file, size: stats.size, modified: Math.trunc(stats.mtimeMs) });
    });
  }
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

function walk(
  directory: string,
  depth: number,
  visit: (file: string, stats: fs.Stats) => void,
): void {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, depth + 1, visit);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      visit(full, fs.statSync(full));
    } catch {
      // Vanished between readdir and stat.
    }
  }
}

function sameDocuments(left: IndexedDocument[], right: IndexedDocument[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.path !== b.path || a.size !== b.size || a.modified !== b.modified) return false;
  }
  return true;
}

// --- build state -----------------------------------------------------------

interface BuildState {
  child: ChildProcess | null;
  startedAt: number;
  stage: string;
  percent: number;
  error: string | null;
}

const globalBuilds = globalThis as typeof globalThis & {
  __breadboardDeepTutorIndexBuilds?: Map<string, BuildState>;
};
const builds =
  globalBuilds.__breadboardDeepTutorIndexBuilds ?? new Map<string, BuildState>();
globalBuilds.__breadboardDeepTutorIndexBuilds = builds;

function buildKey(userId: number, scope: TutorScope): string {
  return `${userId}:${scope.id}`;
}

export function buildInFlight(userId: number, scope: TutorScope): boolean {
  return Boolean(builds.get(buildKey(userId, scope))?.child);
}

/** What the composer, the card and the settings panel all read. */
export function indexState(userId: number, scope: TutorScope): IndexState {
  const kb = knowledgeBaseName(scope);
  if (!kb) {
    return {
      phase: "unsupported",
      kb: null,
      documentCount: 0,
      chunkCount: 0,
      builtAt: null,
      candidateCount: 0,
      error: null,
    };
  }
  const key = buildKey(userId, scope);
  const build = builds.get(key);
  const candidates = indexableDocuments(scope);
  const manifest = readManifest(userId, scope);
  const base = {
    kb,
    documentCount: manifest?.documentCount ?? 0,
    chunkCount: manifest?.chunkCount ?? 0,
    builtAt: manifest?.builtAt || null,
    candidateCount: candidates.length,
    error: build?.error ?? null,
  };
  if (build?.child) return { ...base, phase: "building" };
  if (!manifest) return { ...base, phase: build?.error ? "failed" : "missing" };
  if (manifest.fingerprint !== embeddingFingerprint()) return { ...base, phase: "stale" };
  if (!sameDocuments(manifest.documents, candidates)) return { ...base, phase: "stale" };
  return { ...base, phase: "ready" };
}

/**
 * The knowledge base a turn may name, or null.
 *
 * Deliberately strict: only a `ready` index is handed to a turn. Naming a
 * half-built or out-of-date KB would let the tutor retrieve confidently from
 * notes that no longer say what it thinks they say, which is worse than not
 * retrieving at all.
 */
export function knowledgeBaseForTurn(userId: number, scope: TutorScope): string | null {
  const state = indexState(userId, scope);
  return state.phase === "ready" ? state.kb : null;
}

export interface EnsureResult {
  state: IndexState;
  /** True when this call started a build. */
  started: boolean;
}

/**
 * Start a build if the index is missing or stale, and never wait for it.
 *
 * Called at the top of a tutoring turn: the turn goes ahead with the file tools
 * while this runs, and the *next* question gets retrieval. Called again while a
 * build is in flight, it does nothing.
 */
export function ensureIndex(userId: number, scope: TutorScope): EnsureResult {
  const state = indexState(userId, scope);
  if (state.phase !== "missing" && state.phase !== "stale" && state.phase !== "failed") {
    return { state, started: false };
  }
  if (!state.candidateCount) return { state, started: false };
  const started = startBuild(userId, scope);
  return { state: indexState(userId, scope), started };
}

/** Force a rebuild even when the manifest says the index is fresh. */
export function rebuildIndex(userId: number, scope: TutorScope): EnsureResult {
  if (buildInFlight(userId, scope)) return { state: indexState(userId, scope), started: false };
  clearManifest(userId, scope);
  const started = startBuild(userId, scope);
  return { state: indexState(userId, scope), started };
}

function indexScriptPath(): string | null {
  const bridge = bridgeScriptPath();
  if (!bridge) return null;
  const candidate = path.join(path.dirname(bridge), "deeptutor-index.py");
  return fs.existsSync(candidate) ? candidate : null;
}

function startBuild(userId: number, scope: TutorScope): boolean {
  const key = buildKey(userId, scope);
  if (builds.get(key)?.child) return false;
  const kb = knowledgeBaseName(scope);
  const runtime = resolveDeepTutorRoot();
  const script = indexScriptPath();
  const python = runtime ? venvPython(runtime.root) : null;
  if (!kb || !runtime || !python || !script) return false;

  const documents = indexableDocuments(scope);
  if (!documents.length) return false;

  const home = deepTutorHome(userId, scope.id);
  const state: BuildState = {
    child: null,
    startedAt: Date.now(),
    stage: "starting",
    percent: 0,
    error: null,
  };
  builds.set(key, state);

  let child: ChildProcess;
  try {
    child = spawn(python, [script], {
      cwd: runtime.root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: deepTutorEnv({ DEEPTUTOR_CLONE_ROOT: runtime.root, DEEPTUTOR_HOME: home }),
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The index could not start.";
    builds.set(key, { ...state, child: null });
    return false;
  }
  state.child = child;

  const timer = setTimeout(() => {
    state.error = "Indexing ran past its time limit and was stopped.";
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }, INDEX_TIMEOUT_MS);
  timer.unref?.();

  let buffer = "";
  let stderrTail = "";
  let completed: { documents: number; chunks: number } | null = null;
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const event = parseEvent(line);
        if (event?.type === "progress") {
          state.stage = String(event.stage ?? "");
          state.percent = Number(event.percent) || 0;
        }
        if (event?.type === "completed") {
          completed = {
            documents: Number(event.documents) || documents.length,
            chunks: Number(event.chunks) || 0,
          };
        }
        if (event?.type === "failed") {
          state.error = String(event.error ?? "Indexing failed.");
        }
      }
      newline = buffer.indexOf("\n");
    }
    if (buffer.length > 1_000_000) buffer = "";
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-4_000);
  });

  child.on("error", (error) => {
    clearTimeout(timer);
    state.child = null;
    state.error = error.message;
  });
  child.on("exit", (code) => {
    clearTimeout(timer);
    state.child = null;
    if (completed) {
      writeManifest(userId, scope, {
        kb,
        fingerprint: embeddingFingerprint(),
        builtAt: new Date().toISOString(),
        documents,
        documentCount: completed.documents,
        chunkCount: completed.chunks,
      });
      state.error = null;
      return;
    }
    if (!state.error) {
      const detail = stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? "";
      state.error = `Indexing stopped unexpectedly (exit ${code ?? "unknown"}). ${detail}`.trim();
    }
  });

  try {
    child.stdin?.write(`${JSON.stringify({ home, kb, documents: documents.map((d) => d.path) })}\n`);
    child.stdin?.end();
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The index request could not be sent.";
    return false;
  }
  return true;
}

function parseEvent(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Live progress for a build in flight, for the settings panel. */
export function buildProgress(
  userId: number,
  scope: TutorScope,
): { stage: string; percent: number; elapsedSec: number } | null {
  const build = builds.get(buildKey(userId, scope));
  if (!build?.child) return null;
  return {
    stage: build.stage,
    percent: build.percent,
    elapsedSec: Math.round((Date.now() - build.startedAt) / 1000),
  };
}
