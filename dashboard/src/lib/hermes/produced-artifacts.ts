// Every file a turn produces becomes an artifact card, whether or not the model
// remembered to publish it.
//
// The model is told to call artifact_import for what it makes, and mostly does
// for the formats the instructions name. What fell through was everything
// else: a folder of MATLAB scripts written to Downloads, a ZIP, a `.mlx`, a
// `.tex` — files that existed on disk with nothing in the chat to open them
// from. So when a turn ends, Breadboard looks at the folders that turn was
// authorized to write in and imports whatever appeared or changed while it
// ran. A directory the turn created is published as one folder artifact whose
// card opens the directory itself.
//
// This is a sweep, not an authority: it reads only the roots the capability
// decision already granted, it never leaves them, and it imports through the
// same store boundary the tool uses, so nothing here widens what a turn may
// touch.

import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  inferArtifactKindForFile,
  maxImportBytes,
} from "./artifact-import.ts";
import { IGNORED_FOLDER_ENTRIES } from "./artifact-folder.ts";
import {
  ArtifactStoreError,
  createImportedArtifact,
  type ArtifactRow,
} from "./artifact-store.ts";
import type { ArtifactKind } from "./artifact-types.ts";

export const PRODUCED_FILE_SCAN_TOOL = "produced_file_scan";

/** How many cards one turn may add on its own. Past this, it is a workspace. */
export const MAX_PRODUCED_ARTIFACTS_PER_RUN = 24;
/** Files inside a produced folder also get their own cards up to this count. */
export const MAX_FOLDER_FILE_CARDS = 8;
const MAX_SCAN_ENTRIES = 20_000;
const MAX_SCAN_DEPTH = 6;
/** Clock skew between the run's start and the filesystem's timestamps. */
const START_SKEW_MS = 2_000;
/** The turn is over; this must not hold the answer hostage. */
const DEFAULT_TIME_BUDGET_MS = 20_000;

const TEMPORARY_FILE_PATTERN =
  /(?:\.(?:tmp|temp|crdownload|part|partial|download|lock|swp|swo|bak)$|^~\$|^\.~lock\.|^Thumbs\.db$|^desktop\.ini$)/i;

export interface ProducedFilesScanInput {
  userId: number;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** ISO timestamp the run started; files older than this are not its work. */
  startedAt: string;
  assistantMessageId: number | null;
  /** The session workspace, always scanned. */
  workspaceRoot: string;
  /** Every root the turn's capability decision authorized (may repeat the workspace). */
  authorizedRoots: readonly string[];
  timeBudgetMs?: number;
  database?: Database.Database;
  storageRoot?: string;
  /** Test seam: what "now" is, for the time budget. */
  now?: () => number;
}

export interface ProducedFilesReport {
  imported: ArtifactRow[];
  skipped: Array<{ path: string; reason: string }>;
  scannedRoots: string[];
}

interface Candidate {
  root: string;
  absolutePath: string;
  kind: "file" | "folder";
}

function realPathOrNull(candidate: string): string | null {
  try {
    return fs.realpathSync(path.resolve(candidate));
  } catch {
    return null;
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizedProducedPathKey(value: string): string {
  return normalizedKey(value);
}

function normalizedKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isSkippedName(name: string): boolean {
  return (
    name.startsWith(".") ||
    IGNORED_FOLDER_ENTRIES.has(name) ||
    TEMPORARY_FILE_PATTERN.test(name)
  );
}

/** The paths, names and hashes this run already published, in any form. */
function alreadyPublished(
  database: Database.Database,
  runId: string,
): { paths: Set<string>; filenames: Set<string>; hashes: Set<string> } {
  const rows = database
    .prepare(
      `SELECT filename, content_hash, metadata_json FROM hermes_artifacts
       WHERE originating_run_id = ?`,
    )
    .all(runId) as Array<{
      filename: string;
      content_hash: string | null;
      metadata_json: string | null;
    }>;
  const paths = new Set<string>();
  const filenames = new Set<string>();
  const hashes = new Set<string>();
  for (const row of rows) {
    filenames.add(normalizedKey(row.filename));
    if (row.content_hash) hashes.add(row.content_hash);
    try {
      const metadata = JSON.parse(row.metadata_json ?? "{}") as Record<string, unknown>;
      for (const key of ["sourcePath", "folderPath"]) {
        const value = metadata[key];
        if (typeof value === "string" && value) {
          const real = realPathOrNull(value) ?? path.resolve(value);
          paths.add(normalizedKey(real));
        }
      }
    } catch {
      // Metadata that does not parse cannot name a path.
    }
  }
  return { paths, filenames, hashes };
}

/**
 * Which files and directories under the authorized roots changed since the
 * run began. Pure filesystem inspection: no imports happen here, and a root
 * that no longer exists is simply not scanned.
 */
export function findProducedEntries(input: {
  roots: readonly string[];
  since: number;
  excludeRoots?: readonly string[];
}): { files: Candidate[]; folders: Candidate[]; truncated: boolean } {
  const excluded = (input.excludeRoots ?? [])
    .map((root) => realPathOrNull(root))
    .filter((root): root is string => root !== null);
  const seen = new Set<string>();
  const files: Candidate[] = [];
  const folders: Candidate[] = [];
  let visited = 0;
  let truncated = false;

  const roots: string[] = [];
  for (const requested of input.roots) {
    const real = realPathOrNull(requested);
    if (!real) continue;
    if (roots.some((root) => normalizedKey(root) === normalizedKey(real))) continue;
    roots.push(real);
  }

  // Modification time alone misses a copy: Windows preserves the source's
  // mtime when a file is copied, so a turn that copies a PDF into Downloads
  // leaves a file that looks old. Birth time catches that; mtime catches an
  // edit in place. Change time is left out on purpose, since a rename or an
  // attribute change by the user during the turn is not production.
  const isModifiedSince = (stats: import("node:fs").Stats): boolean => {
    const changed = Math.max(stats.mtimeMs, stats.birthtimeMs || 0);
    return changed >= input.since;
  };
  const isCreatedSince = (stats: import("node:fs").Stats): boolean => {
    const born = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
    return born >= input.since;
  };

  const walk = (root: string, directory: string, depth: number, insideProducedFolder: boolean) => {
    if (truncated) return;
    let children: import("node:fs").Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (truncated) return;
      visited += 1;
      if (visited > MAX_SCAN_ENTRIES) {
        truncated = true;
        return;
      }
      if (isSkippedName(child.name)) continue;
      if (child.isSymbolicLink()) continue;
      const absolute = path.join(directory, child.name);
      if (excluded.some((exclude) => isInside(exclude, absolute))) continue;
      const key = normalizedKey(absolute);
      if (seen.has(key)) continue;
      if (child.isDirectory()) {
        if (depth >= MAX_SCAN_DEPTH) continue;
        let stats: import("node:fs").Stats;
        try {
          stats = fs.statSync(absolute);
        } catch {
          continue;
        }
        // A directory whose own timestamp moved is one the turn created or
        // populated. The outermost such directory is the folder the user
        // means; anything nested inside it is part of that folder.
        const produced = !insideProducedFolder && isCreatedSince(stats);
        if (produced) {
          seen.add(key);
          folders.push({ root, absolutePath: absolute, kind: "folder" });
        }
        walk(root, absolute, depth + 1, insideProducedFolder || produced);
        continue;
      }
      if (!child.isFile()) continue;
      let stats: import("node:fs").Stats;
      try {
        stats = fs.statSync(absolute);
      } catch {
        continue;
      }
      if (!isModifiedSince(stats) || stats.size <= 0) continue;
      seen.add(key);
      files.push({ root, absolutePath: absolute, kind: "file" });
    }
  };

  for (const root of roots) walk(root, root, 0, false);
  return { files, folders, truncated };
}

function hashFileOrNull(file: string): string | null {
  try {
    const hash = crypto.createHash("sha256");
    const descriptor = fs.openSync(file, "r");
    const buffer = Buffer.alloc(1024 * 1024);
    try {
      for (;;) {
        const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (read <= 0) break;
        hash.update(buffer.subarray(0, read));
      }
    } finally {
      fs.closeSync(descriptor);
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

function titleFor(candidate: Candidate): string {
  const base = path.basename(candidate.absolutePath);
  const title = candidate.kind === "folder" ? base : base.replace(/\.[^.]+$/, "");
  return (title.trim() || base).slice(0, 240);
}

function isSignatureRefusal(error: unknown): boolean {
  return (
    error instanceof ArtifactStoreError &&
    (error.code === "artifact_import_signature" ||
      error.code === "artifact_import_binary_text" ||
      error.code === "renderer_unavailable" ||
      error.code === "artifact_import_too_large")
  );
}

/**
 * Import what the run produced. Failures are per file: one unreadable file
 * costs its own card and nothing else, and the sweep as a whole never throws.
 */
export async function publishProducedFilesForRun(
  input: ProducedFilesScanInput,
): Promise<ProducedFilesReport> {
  const database = input.database ?? db;
  const now = input.now ?? Date.now;
  const deadline = now() + (input.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const since = Date.parse(input.startedAt) - START_SKEW_MS;
  const report: ProducedFilesReport = { imported: [], skipped: [], scannedRoots: [] };
  if (!Number.isFinite(since)) return report;

  const roots = [input.workspaceRoot, ...input.authorizedRoots];
  const found = findProducedEntries({
    roots,
    since,
    // The store's own files are never "produced": copying an artifact into
    // it would otherwise be discovered as a new file on the next sweep.
    excludeRoots: [dashboardDataDir(), ...(input.storageRoot ? [input.storageRoot] : [])],
  });
  report.scannedRoots = roots;
  const published = alreadyPublished(database, input.runId);

  const folderKeys = found.folders.map((folder) => normalizedKey(folder.absolutePath));
  const folderOf = (file: Candidate): string | null =>
    folderKeys.find((key) => isInside(key, normalizedKey(file.absolutePath))) ?? null;
  const filesPerFolder = new Map<string, number>();
  for (const file of found.files) {
    const owner = folderOf(file);
    if (owner) filesPerFolder.set(owner, (filesPerFolder.get(owner) ?? 0) + 1);
  }

  // Folders first: the package is the deliverable, its members are detail.
  const queue: Candidate[] = [
    ...found.folders.filter((folder) => (filesPerFolder.get(normalizedKey(folder.absolutePath)) ?? 0) > 0),
    ...found.files.filter((file) => {
      const owner = folderOf(file);
      return owner === null || (filesPerFolder.get(owner) ?? 0) <= MAX_FOLDER_FILE_CARDS;
    }),
  ];

  for (const candidate of queue) {
    if (report.imported.length >= MAX_PRODUCED_ARTIFACTS_PER_RUN) {
      report.skipped.push({ path: candidate.absolutePath, reason: "limit" });
      continue;
    }
    if (now() > deadline) {
      report.skipped.push({ path: candidate.absolutePath, reason: "time_budget" });
      continue;
    }
    const key = normalizedKey(candidate.absolutePath);
    if (published.paths.has(key)) {
      report.skipped.push({ path: candidate.absolutePath, reason: "already_published" });
      continue;
    }
    const basename = path.basename(candidate.absolutePath);
    if (candidate.kind === "file" && published.filenames.has(normalizedKey(basename))) {
      report.skipped.push({ path: candidate.absolutePath, reason: "already_published" });
      continue;
    }
    const inferred: ArtifactKind = candidate.kind === "folder"
      ? "folder"
      : inferArtifactKindForFile(basename);
    if (candidate.kind === "file") {
      let size = 0;
      try {
        size = fs.statSync(candidate.absolutePath).size;
      } catch {
        report.skipped.push({ path: candidate.absolutePath, reason: "unreadable" });
        continue;
      }
      if (size > maxImportBytes(inferred)) {
        report.skipped.push({ path: candidate.absolutePath, reason: "too_large" });
        continue;
      }
    }
    const shared = {
      userId: input.userId,
      runtimeSessionId: input.runtimeSessionId,
      hermesSessionId: input.hermesSessionId,
      conversationId: input.conversationId,
      clusterId: input.clusterId,
      runId: input.runId,
      assistantMessageId: input.assistantMessageId,
      surface: input.surface,
      title: titleFor(candidate),
      authorizedRoot: candidate.root,
      filePath: candidate.absolutePath,
      sourceHermesTool: PRODUCED_FILE_SCAN_TOOL,
      metadata: {
        producedFile: true,
        producedRoot: candidate.root,
      },
      database,
      ...(input.storageRoot ? { storageRoot: input.storageRoot } : {}),
    };
    if (candidate.kind === "file" && published.hashes.size > 0) {
      const hash = hashFileOrNull(candidate.absolutePath);
      if (hash && published.hashes.has(hash)) {
        // Same bytes the model already published under another name. Keep
        // the model's card, which carries the title it chose.
        report.skipped.push({ path: candidate.absolutePath, reason: "duplicate_content" });
        continue;
      }
    }
    try {
      let artifact: ArtifactRow;
      try {
        artifact = await createImportedArtifact({ ...shared, kind: inferred });
      } catch (error) {
        // The extension said one thing and the bytes another. The file is
        // still the user's; it just gets a plain download card.
        if (candidate.kind === "file" && inferred !== "unknown" && isSignatureRefusal(error)) {
          artifact = await createImportedArtifact({ ...shared, kind: "unknown" });
        } else {
          throw error;
        }
      }
      report.imported.push(artifact);
      published.paths.add(key);
      published.filenames.add(normalizedKey(artifact.filename));
      if (artifact.content_hash) published.hashes.add(artifact.content_hash);
    } catch (error) {
      report.skipped.push({
        path: candidate.absolutePath,
        reason: error instanceof ArtifactStoreError ? error.code : "import_failed",
      });
    }
  }
  return report;
}
