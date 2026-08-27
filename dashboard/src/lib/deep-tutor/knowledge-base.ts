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

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deepTutorHome, deepTutorHomeRoot, embeddingFingerprint } from "./home.ts";
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
const INDEX_JOB_STALE_MS = 50 * 60 * 1000;
const MAX_RECEIPT_BYTES = 32 * 1024;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

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

// --- durable Runtime job state --------------------------------------------

export interface IndexJobReceipt {
  protocolVersion: 1;
  jobId: string;
  startedAt: number;
  updatedAt: number;
  candidateCount: number;
  phase: "building" | "failed";
  stage: string;
  percent: number;
  error: string | null;
}

function receiptPath(userId: number, scope: TutorScope): string {
  return path.join(deepTutorHome(userId, scope.id), "breadboard-index-job.json");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function ensureReceiptDirectory(userId: number, scope: TutorScope): string {
  const root = path.resolve(deepTutorHomeRoot());
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootMetadata = fs.lstatSync(root);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(root), root)
  ) throw new Error("The Deep Tutor Runtime state root is unavailable or indirect.");
  const target = path.dirname(receiptPath(userId, scope));
  if (!pathWithin(root, target)) {
    throw new Error("The Deep Tutor Runtime state escaped its configured root.");
  }
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    if (segment === "." || segment === ".." || /[\\/\u0000]/u.test(segment)) {
      throw new Error("The Deep Tutor Runtime state path is invalid.");
    }
    current = path.join(current, segment);
    const existing = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!existing) fs.mkdirSync(current, { recursive: false, mode: 0o700 });
    const metadata = fs.lstatSync(current);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(current), current)
    ) throw new Error("The Deep Tutor Runtime state path is unavailable or indirect.");
  }
  return target;
}

function validReceipt(value: unknown): value is IndexJobReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "candidateCount,error,jobId,percent,phase,protocolVersion,stage,startedAt,updatedAt" ||
    record.protocolVersion !== 1 ||
    typeof record.jobId !== "string" ||
    !IDENTIFIER.test(record.jobId) ||
    !Number.isSafeInteger(record.startedAt) ||
    (record.startedAt as number) < 1 ||
    !Number.isSafeInteger(record.updatedAt) ||
    (record.updatedAt as number) < (record.startedAt as number) ||
    !Number.isSafeInteger(record.candidateCount) ||
    (record.candidateCount as number) < 0 ||
    (record.candidateCount as number) > MAX_INDEXED_FILES ||
    (record.phase !== "building" && record.phase !== "failed") ||
    typeof record.stage !== "string" ||
    Buffer.byteLength(record.stage, "utf8") > 128 ||
    /\p{Cc}/u.test(record.stage) ||
    !Number.isSafeInteger(record.percent) ||
    (record.percent as number) < 0 ||
    (record.percent as number) > 100 ||
    (record.error !== null &&
      (typeof record.error !== "string" ||
        !record.error.trim() ||
        Buffer.byteLength(record.error, "utf8") > 8 * 1024)) ||
    (record.phase === "building" && record.error !== null) ||
    (record.phase === "failed" && record.error === null)
  ) return false;
  return true;
}

export function readIndexJobReceipt(
  userId: number,
  scope: TutorScope,
): IndexJobReceipt | null {
  const file = receiptPath(userId, scope);
  try {
    const metadata = fs.lstatSync(file);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > MAX_RECEIPT_BYTES ||
      !samePath(fs.realpathSync.native(file), file)
    ) return null;
    const bytes = fs.readFileSync(file);
    if (bytes.byteLength !== metadata.size || bytes.byteLength > MAX_RECEIPT_BYTES) return null;
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    return validReceipt(value) ? { ...value } : null;
  } catch {
    return null;
  }
}

export function writeIndexJobReceipt(
  userId: number,
  scope: TutorScope,
  receipt: IndexJobReceipt,
): void {
  if (!validReceipt(receipt)) throw new TypeError("The Deep Tutor Runtime receipt is invalid.");
  ensureReceiptDirectory(userId, scope);
  const target = receiptPath(userId, scope);
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error("The Deep Tutor Runtime receipt is indirect.");
  }
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RECEIPT_BYTES) {
    throw new Error("The Deep Tutor Runtime receipt exceeded its bound.");
  }
  const pending = `${target}.pending-${process.pid}-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(pending, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(pending, target);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(pending, { force: true });
    throw error;
  }
}

export function clearIndexJobReceipt(userId: number, scope: TutorScope): void {
  try {
    const target = receiptPath(userId, scope);
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!existing) return;
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error("The Deep Tutor Runtime receipt is indirect.");
    }
    fs.rmSync(target, { force: false });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : null;
    if (code !== "ENOENT") throw error;
  }
}

function activeReceipt(receipt: IndexJobReceipt | null, now = Date.now()): boolean {
  return Boolean(
    receipt?.phase === "building" && now - receipt.updatedAt <= INDEX_JOB_STALE_MS,
  );
}

export function buildInFlight(userId: number, scope: TutorScope): boolean {
  return activeReceipt(readIndexJobReceipt(userId, scope));
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
  const receipt = readIndexJobReceipt(userId, scope);
  const candidates = indexableDocuments(scope);
  const manifest = readManifest(userId, scope);
  const manifestReady = Boolean(
    manifest &&
    manifest.fingerprint === embeddingFingerprint() &&
    sameDocuments(manifest.documents, candidates),
  );
  const base = {
    kb,
    documentCount: manifest?.documentCount ?? 0,
    chunkCount: manifest?.chunkCount ?? 0,
    builtAt: manifest?.builtAt || null,
    candidateCount: candidates.length,
    error: receipt?.phase === "failed" ? receipt.error : null,
  };
  // A completed worker publishes the manifest before its Runtime result. That
  // fresh manifest wins over a not-yet-reconciled `building` receipt, so a
  // dashboard restart never strands a usable index behind stale process state.
  if (manifestReady) return { ...base, error: null, phase: "ready" };
  if (activeReceipt(receipt)) {
    return { ...base, candidateCount: receipt?.candidateCount ?? candidates.length, phase: "building" };
  }
  if (receipt?.phase === "building") {
    return {
      ...base,
      error: "Indexing ran past its time limit and was stopped.",
      phase: "failed",
    };
  }
  if (!manifest) return { ...base, phase: receipt?.phase === "failed" ? "failed" : "missing" };
  if (manifest.fingerprint !== embeddingFingerprint()) return { ...base, phase: "stale" };
  if (!sameDocuments(manifest.documents, candidates)) return { ...base, phase: "stale" };
  return { ...base, error: null, phase: "ready" };
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

/** Live progress for a build in flight, for the settings panel. */
export function buildProgress(
  userId: number,
  scope: TutorScope,
): { stage: string; percent: number; elapsedSec: number } | null {
  const build = readIndexJobReceipt(userId, scope);
  if (!build || !activeReceipt(build)) return null;
  return {
    stage: build.stage,
    percent: build.percent,
    elapsedSec: Math.round((Date.now() - build.startedAt) / 1000),
  };
}
