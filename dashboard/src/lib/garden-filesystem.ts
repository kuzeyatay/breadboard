// Canonical Garden structure operations: inspecting the folder tree, creating
// folders, moving a note between them, and renaming or deleting a folder.
//
// This is the single implementation shared by the authoring UI (`/api/folders`)
// and the agent's `garden_*` structure tools, exactly as `garden-documents.ts`
// is the single note writer. Authorization happens before these helpers are
// called — every one of them assumes the caller already proved ownership of the
// Garden. What they do own is containment: no operation can escape the Garden
// directory, and every mutation refreshes the cluster index and republishes
// Quartz so the site never serves a page at a path that moved.

import fs from "node:fs";
import path from "node:path";
import db from "./db.ts";
import {
  refreshClusterIndex,
  slugify,
  walkClusterMarkdown,
} from "./knowledge.ts";
import { normalizeGardenFolder } from "./garden-documents.ts";
import { publishQuartzAfterMutation } from "./quartz-publish.ts";
import { acquireGardenMutationLease } from "./garden-mutation-lease.ts";
import {
  GardenFilesystemError,
  gardenContentRoot as contentRoot,
  gardenDirectory,
} from "./garden-directory.ts";

export { GardenFilesystemError, gardenDirectory };

export interface GardenFolderSummary {
  folder: string;
  name: string;
  noteCount: number;
}

export interface GardenPageSummary {
  slug: string;
  folder: string;
  relPath: string;
}

export interface GardenTree {
  gardenId: string;
  folders: GardenFolderSummary[];
  pages: GardenPageSummary[];
}

function resolveFolderDir(clusterDir: string, folder: string): string {
  const target = path.resolve(clusterDir, folder);
  if (target !== clusterDir && !target.startsWith(clusterDir + path.sep)) {
    throw new GardenFilesystemError("Invalid folder path", 400);
  }
  return target;
}

/** Title Quartz shows for a folder, derived from its last path segment. */
export function gardenFolderTitle(folder: string): string {
  const last = folder.split("/").pop() ?? folder;
  return last
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Remove stale generated Quartz output for a relative path (note or folder).
 * A moved or renamed path would otherwise keep serving its old URL.
 */
function removePublicArtifacts(
  contentPath: string,
  clusterSlug: string,
  relPath: string,
): void {
  const publicRoot = path.resolve(contentPath, "..", "public");
  const clusterPublicDir = path.resolve(publicRoot, clusterSlug.trim());
  if (!clusterPublicDir.startsWith(publicRoot + path.sep)) return;

  for (const target of [
    path.join(clusterPublicDir, `${relPath}.html`),
    path.join(clusterPublicDir, `${relPath}-og-image.webp`),
    path.join(clusterPublicDir, relPath),
  ]) {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(clusterPublicDir + path.sep)) continue;
    if (fs.existsSync(resolved))
      fs.rmSync(resolved, { recursive: true, force: true });
  }
}

/** Every folder under the Garden, skipping asset and hidden directories. */
function walkFolders(clusterDir: string): string[] {
  const folders: string[] = [];
  const walk = (dir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "assets" || entry.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      folders.push(rel);
      walk(path.join(dir, entry.name), rel);
    }
  };
  walk(clusterDir, "");
  return folders.sort((left, right) => left.localeCompare(right));
}

/**
 * The Garden's structure: its folders and which folder each note lives in.
 * Read-only, and the thing to call before proposing a move so a slug and a
 * destination are both known to exist.
 */
export function listGardenTree(input: { clusterSlug: string }): GardenTree {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);
  const notes = walkClusterMarkdown(clusterDir);
  const countsByFolder = new Map<string, number>();
  for (const note of notes) {
    countsByFolder.set(note.folder, (countsByFolder.get(note.folder) ?? 0) + 1);
  }
  return {
    gardenId: input.clusterSlug,
    folders: walkFolders(clusterDir).map((folder) => ({
      folder,
      name: gardenFolderTitle(folder),
      noteCount: countsByFolder.get(folder) ?? 0,
    })),
    pages: notes.map((note) => ({
      slug: note.entry.replace(/\.md$/i, ""),
      folder: note.folder,
      relPath: note.relPath,
    })),
  };
}

/** Create a folder. Its `_index.md` placeholder keeps it visible in Quartz. */
export async function createGardenFolder(input: {
  userId: number;
  clusterSlug: string;
  folder: unknown;
}): Promise<{ folder: string }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);
  const folder = normalizeGardenFolder(input.folder);
  if (!folder) throw new GardenFilesystemError("folder is required", 400);

  const lease = acquireGardenMutationLease(clusterDir, "create-folder");
  try {
    const dir = resolveFolderDir(clusterDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const indexPath = path.join(dir, "_index.md");
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        `---\ntitle: ${JSON.stringify(gardenFolderTitle(folder))}\n---\n\n`,
        "utf-8",
      );
    }

    refreshClusterIndex(contentPath, input.clusterSlug);
  } finally {
    lease.release();
  }
  await publishQuartzAfterMutation(
    `create folder ${input.clusterSlug}/${folder}`,
    {
      userId: input.userId,
    },
  );
  return { folder };
}

/**
 * Move one note (identified by its basename slug) into `toFolder`; an empty
 * destination means the Garden root. Notes keep their basename slug, so Quartz's
 * shortest-path link resolution keeps every existing `[[wikilink]]` working.
 */
export async function moveGardenDocument(input: {
  userId: number;
  clusterSlug: string;
  slug: unknown;
  toFolder: unknown;
}): Promise<{ slug: string; folder: string; relPath: string }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);
  if (typeof input.slug !== "string" || !input.slug.trim()) {
    throw new GardenFilesystemError("slug is required", 400);
  }

  const lease = acquireGardenMutationLease(clusterDir, "move-document");
  let moved: { slug: string; folder: string; relPath: string };
  try {
    const folder = normalizeGardenFolder(input.toFolder);
    const targetDir = resolveFolderDir(clusterDir, folder);

    const wantSlug = input.slug
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.md$/i, "")
      .trim();

    const found = walkClusterMarkdown(clusterDir).find(
      (item) => item.entry.replace(/\.md$/i, "") === wantSlug,
    );
    if (!found) throw new GardenFilesystemError("Document not found", 404);

    const destPath = path.join(targetDir, found.entry);
    if (path.resolve(destPath) === path.resolve(found.filePath)) {
      return { slug: wantSlug, folder, relPath: found.relPath };
    }
    if (fs.existsSync(destPath)) {
      throw new GardenFilesystemError(
        "A note with that name already exists in the target folder",
        409,
      );
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.renameSync(found.filePath, destPath);
    removePublicArtifacts(
      contentPath,
      input.clusterSlug,
      found.relPath.replace(/\.md$/i, ""),
    );

    const relPath = path.relative(clusterDir, destPath).replace(/\\/g, "/");
    refreshClusterIndex(contentPath, input.clusterSlug);
    moved = { slug: wantSlug, folder, relPath };
  } finally {
    lease.release();
  }
  await publishQuartzAfterMutation(
    `move document ${input.clusterSlug}/${moved.slug} -> ${moved.folder || "root"}`,
    { userId: input.userId },
  );
  return moved;
}

/**
 * Rename a folder in place, keeping its parent. The notes inside keep their
 * basename slugs; only the folder segment on disk and its `_index.md` title
 * change, so links still resolve.
 */
export async function renameGardenFolder(input: {
  userId: number;
  clusterSlug: string;
  folder: unknown;
  name: unknown;
}): Promise<{ folder: string; newFolder: string }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);

  const lease = acquireGardenMutationLease(clusterDir, "rename-folder");
  let renamed: { folder: string; newFolder: string };
  try {
    const folder = normalizeGardenFolder(input.folder);
    if (!folder) throw new GardenFilesystemError("folder is required", 400);

    const newName = normalizeGardenFolder(input.name);
    if (!newName) throw new GardenFilesystemError("name is required", 400);
    if (newName.includes("/")) {
      throw new GardenFilesystemError(
        "Folder name cannot contain slashes",
        400,
      );
    }

    const parent = folder.split("/").slice(0, -1).join("/");
    const newFolder = parent ? `${parent}/${newName}` : newName;
    if (newFolder === folder) return { folder, newFolder };

    const oldDir = resolveFolderDir(clusterDir, folder);
    const newDir = resolveFolderDir(clusterDir, newFolder);
    if (oldDir === clusterDir || newDir === clusterDir) {
      throw new GardenFilesystemError("Invalid folder path", 400);
    }
    if (!fs.existsSync(oldDir)) {
      throw new GardenFilesystemError("Folder not found", 404);
    }
    if (fs.existsSync(newDir)) {
      throw new GardenFilesystemError(
        "A folder with that name already exists",
        409,
      );
    }

    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    fs.renameSync(oldDir, newDir);

    // Keep the Quartz folder title in sync with the new name.
    const indexPath = path.join(newDir, "_index.md");
    const newTitle = JSON.stringify(gardenFolderTitle(newFolder));
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, "utf-8");
      const updated = /^title:.*$/m.test(raw)
        ? raw.replace(/^title:.*$/m, `title: ${newTitle}`)
        : raw.replace(/^---\r?\n/, (match) => `${match}title: ${newTitle}\n`);
      fs.writeFileSync(indexPath, updated, "utf-8");
    } else {
      fs.writeFileSync(indexPath, `---\ntitle: ${newTitle}\n---\n\n`, "utf-8");
    }

    // The old folder path (and every note inside it) has stale Quartz output.
    removePublicArtifacts(contentPath, input.clusterSlug, folder);

    refreshClusterIndex(contentPath, input.clusterSlug);
    renamed = { folder, newFolder };
  } finally {
    lease.release();
  }
  await publishQuartzAfterMutation(
    `rename folder ${input.clusterSlug}/${renamed.folder} -> ${renamed.newFolder}`,
    { userId: input.userId },
  );
  return renamed;
}

/**
 * Delete a folder and every note inside it, along with their generated Quartz
 * output and saved PDF edits. There is no trash: callers must have the user's
 * explicit instruction for this exact folder before calling.
 */
export async function deleteGardenFolder(input: {
  userId: number;
  clusterSlug: string;
  clusterId: number;
  folder: unknown;
}): Promise<{ folder: string; deletedSlugs: string[] }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);

  const lease = acquireGardenMutationLease(clusterDir, "delete-folder");
  let deleted: { folder: string; deletedSlugs: string[] };
  try {
    const folder = normalizeGardenFolder(input.folder);
    if (!folder) throw new GardenFilesystemError("folder is required", 400);

    const dir = resolveFolderDir(clusterDir, folder);
    if (dir === clusterDir) {
      throw new GardenFilesystemError("Invalid folder path", 400);
    }
    if (!fs.existsSync(dir)) return { folder, deletedSlugs: [] };

    const deletedSlugs = walkClusterMarkdown(dir).map((item) =>
      item.entry.replace(/\.md$/i, ""),
    );

    fs.rmSync(dir, { recursive: true, force: true });
    removePublicArtifacts(contentPath, input.clusterSlug, folder);

    if (deletedSlugs.length > 0) {
      const deleteSavedPdf = db.prepare(
        "DELETE FROM pdf_document_edits WHERE cluster_id = ? AND document_slug = ?",
      );
      for (const slug of deletedSlugs)
        deleteSavedPdf.run(input.clusterId, slug);
    }

    refreshClusterIndex(contentPath, input.clusterSlug);
    deleted = { folder, deletedSlugs };
  } finally {
    lease.release();
  }
  await publishQuartzAfterMutation(
    `delete folder ${input.clusterSlug}/${deleted.folder}`,
    {
      userId: input.userId,
    },
  );
  return deleted;
}

/** Exposed for callers that need the same normalization before validating. */
export { normalizeGardenFolder, slugify };
