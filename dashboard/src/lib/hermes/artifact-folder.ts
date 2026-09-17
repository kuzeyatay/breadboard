// A produced folder becomes one artifact: a ZIP of its contents in the store,
// plus the original path so the card can open the directory itself.
//
// The ZIP is what makes the artifact durable — the folder in Downloads can be
// moved or deleted later and the chat still has what the turn made — and the
// path is what makes the card useful right now: on the desktop it opens the
// folder in the system file explorer.

import AdmZip from "adm-zip";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";

/** A folder larger than this is not a deliverable; it is a workspace. */
export const MAX_FOLDER_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_FOLDER_ARCHIVE_FILES = 5_000;
const MAX_FOLDER_DEPTH = 24;

/**
 * Directory names that are never part of what a turn produced for the user,
 * whatever else sits beside them. Hidden directories are skipped as a class.
 */
export const IGNORED_FOLDER_ENTRIES = new Set([
  "node_modules",
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  ".runtime",
  ".breadboard",
  ".next",
  "dist",
  "build",
  "target",
  ".cache",
  ".pytest_cache",
  ".mypy_cache",
  "$RECYCLE.BIN",
  "System Volume Information",
]);

export class FolderArchiveError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FolderArchiveError";
    this.code = code;
  }
}

export interface FolderEntry {
  /** Forward-slash path relative to the folder root. */
  path: string;
  byteSize: number;
}

export interface FolderInventory {
  entries: FolderEntry[];
  totalFiles: number;
  totalBytes: number;
}

function isSkippedName(name: string): boolean {
  return name.startsWith(".") || IGNORED_FOLDER_ENTRIES.has(name);
}

/**
 * Every regular file under a folder, ignoring what no user means by "the
 * folder" (dependencies, caches, hidden state). Symbolic links are not
 * followed: a link out of the folder would make the archive contain something
 * the folder does not.
 */
export function inventoryFolder(
  folderPath: string,
  limits: { maxFiles?: number; maxBytes?: number } = {},
): FolderInventory {
  const maxFiles = limits.maxFiles ?? MAX_FOLDER_ARCHIVE_FILES;
  const maxBytes = limits.maxBytes ?? MAX_FOLDER_ARCHIVE_BYTES;
  const entries: FolderEntry[] = [];
  let totalBytes = 0;
  const walk = (directory: string, relative: string, depth: number) => {
    if (depth > MAX_FOLDER_DEPTH) return;
    let children: import("node:fs").Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (isSkippedName(child.name)) continue;
      const absolute = path.join(directory, child.name);
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        walk(absolute, childRelative, depth + 1);
        continue;
      }
      if (!child.isFile()) continue;
      let size: number;
      try {
        size = fs.statSync(absolute).size;
      } catch {
        continue;
      }
      entries.push({ path: childRelative, byteSize: size });
      totalBytes += size;
      if (entries.length > maxFiles) {
        throw new FolderArchiveError(
          "artifact_folder_too_many_files",
          `A folder artifact cannot contain more than ${maxFiles} files.`,
        );
      }
      if (totalBytes > maxBytes) {
        throw new FolderArchiveError(
          "artifact_folder_too_large",
          `A folder artifact cannot exceed ${maxBytes} bytes.`,
        );
      }
    }
  };
  walk(folderPath, "", 0);
  return { entries, totalFiles: entries.length, totalBytes };
}

/**
 * Write a ZIP of the folder to `targetPath`, returning what went into it.
 * Entries are added one by one from the inventory so the archive contains
 * exactly the files the inventory reported and nothing the walk skipped.
 */
export function stageFolderArchive(
  folderPath: string,
  targetPath: string,
): FolderInventory {
  const inventory = inventoryFolder(folderPath);
  if (inventory.totalFiles === 0) {
    throw new FolderArchiveError(
      "artifact_folder_empty",
      "The folder contains no files to publish.",
    );
  }
  const archive = new AdmZip();
  for (const entry of inventory.entries) {
    const absolute = path.join(folderPath, ...entry.path.split("/"));
    const zipDirectory = path.posix.dirname(entry.path);
    archive.addLocalFile(absolute, zipDirectory === "." ? "" : zipDirectory);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  archive.writeZip(targetPath);
  return inventory;
}
