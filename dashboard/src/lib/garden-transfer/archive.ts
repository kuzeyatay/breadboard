/**
 * The ZIP layer under both file types: walking a garden directory into an
 * archive, and writing an archive's entries back out.
 *
 * Two things this module owns, because getting either wrong is a real hole.
 * Reading, it refuses to follow symlinks — a link pointing at `C:\Users` would
 * otherwise pack the machine into the file. Writing, every entry is re-resolved
 * against the target directory and rejected if it lands outside, so a crafted
 * archive cannot write through `..` or an absolute path.
 *
 * It knows nothing about gardens, clusters or the database; it takes a source
 * directory and a prefix. That keeps the round trip testable against a temp
 * directory with no Next.js or SQLite in the way.
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

import {
  TransferError,
  isSafeArchivePath,
  normalizeArchivePath,
} from "./format.ts";
import type {
  GardenContentSummary,
  TransferSkip,
  TransferSkipReason,
} from "./format.ts";

/**
 * adm-zip builds the archive in memory, so this ceiling is about what the
 * process can hold, not about what a garden is allowed to be. A garden over it
 * is almost always carrying rebuild scratch that `gardenExportSkipReason`
 * already drops.
 */
export const MAX_TRANSFER_BYTES = 512 * 1024 * 1024;

export interface PackBudget {
  bytes: number;
}

export function createBudget(): PackBudget {
  return { bytes: 0 };
}

function spend(budget: PackBudget, bytes: number, what: string): void {
  budget.bytes += bytes;
  if (budget.bytes > MAX_TRANSFER_BYTES) {
    throw new TransferError(
      `${what} is larger than the ${Math.round(MAX_TRANSFER_BYTES / (1024 * 1024))} MB export limit.`,
      413,
    );
  }
}

export function addJsonEntry(
  zip: AdmZip,
  entryName: string,
  value: unknown,
): void {
  zip.addFile(entryName, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf-8"));
}

export function readJsonEntry(zip: AdmZip, entryName: string): unknown {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    throw new TransferError(`This file is missing its ${entryName}.`);
  }
  try {
    return JSON.parse(entry.getData().toString("utf-8"));
  } catch {
    throw new TransferError(`This file's ${entryName} is not valid JSON.`);
  }
}

export function openArchive(buffer: Buffer): AdmZip {
  try {
    return new AdmZip(buffer);
  } catch {
    throw new TransferError(
      "This file could not be opened. It may be truncated or not a Breadboard file.",
      415,
    );
  }
}

/**
 * Copy `sourceDir` into the archive under `prefix`, asking `skipReason` about
 * every path first. Directories are pruned whole, so a skipped `.breadboard/
 * backups` is never walked.
 */
export function packDirectory(
  zip: AdmZip,
  sourceDir: string,
  prefix: string,
  budget: PackBudget,
  skipReason: (relPath: string) => TransferSkipReason | null,
): GardenContentSummary {
  const skipped: TransferSkip[] = [];
  let files = 0;
  let bytes = 0;

  const walk = (dir: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      skipped.push({ path: relDir || ".", reason: "unreadable" });
      return;
    }

    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const reason = skipReason(relPath);
      if (reason) {
        skipped.push({ path: relPath, reason });
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped.push({ path: relPath, reason: "symlink" });
        continue;
      }

      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relPath);
        continue;
      }
      if (!entry.isFile()) {
        skipped.push({ path: relPath, reason: "unreadable" });
        continue;
      }

      let data: Buffer;
      try {
        data = fs.readFileSync(absolute);
      } catch {
        skipped.push({ path: relPath, reason: "unreadable" });
        continue;
      }
      spend(budget, data.byteLength, "This export");
      zip.addFile(`${prefix}${relPath}`, data);
      files += 1;
      bytes += data.byteLength;
    }
  };

  // An empty garden still has to produce a valid archive, so the prefix is
  // registered as a directory entry before anything is walked.
  zip.addFile(prefix, Buffer.alloc(0));
  walk(sourceDir, "");

  return { files, bytes, skipped };
}

/**
 * Write every entry under `prefix` into `targetDir`. Returns what landed; a
 * path that would escape the target aborts the whole extraction rather than
 * being quietly skipped, because a crafted archive is not a partial-success
 * situation.
 */
export function unpackPrefix(
  zip: AdmZip,
  prefix: string,
  targetDir: string,
): { files: number; bytes: number } {
  const root = path.resolve(targetDir);
  let files = 0;
  let bytes = 0;

  for (const entry of zip.getEntries()) {
    const name = normalizeArchivePath(entry.entryName);
    if (!name.startsWith(prefix)) continue;
    const relPath = name.slice(prefix.length);
    if (!relPath) continue;

    const isDirectory = entry.isDirectory || relPath.endsWith("/");
    const cleanRel = isDirectory ? relPath.replace(/\/+$/, "") : relPath;
    if (!cleanRel) continue;
    if (!isSafeArchivePath(cleanRel)) {
      throw new TransferError(
        `This file contains an unsafe path (${entry.entryName}) and was not imported.`,
      );
    }

    const destination = path.resolve(root, cleanRel);
    if (destination !== root && !destination.startsWith(root + path.sep)) {
      throw new TransferError(
        `This file contains an unsafe path (${entry.entryName}) and was not imported.`,
      );
    }

    if (isDirectory) {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }

    const data = entry.getData();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
    files += 1;
    bytes += data.byteLength;
  }

  return { files, bytes };
}

/** True when the archive holds at least one entry under `prefix`. */
export function hasPrefix(zip: AdmZip, prefix: string): boolean {
  return zip
    .getEntries()
    .some((entry) => normalizeArchivePath(entry.entryName).startsWith(prefix));
}
