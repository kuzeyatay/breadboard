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

import type { Dirent } from "node:fs";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import db from "./db.ts";
import {
  refreshClusterIndex,
  slugify,
  walkClusterMarkdown,
} from "./knowledge.ts";
import { dashboardDataDir } from "./runtime-paths.ts";
import { normalizeGardenFolder } from "./garden-documents.ts";
import { publishQuartzAfterMutation } from "./quartz-publish.ts";
import { acquireGardenMutationLeaseWithIngestionRecovery } from "./garden-mutation-recovery.ts";
import { assertGardenMutationWritePaths } from "./garden-mutation-lease-core.ts";
import { isGardenUserPath } from "./garden-user-content.ts";
import { gardenFiles } from "./garden-files/repository.ts";
import { libraryFolderScope, changeMixedFolder, preserveFolderForTrash } from "./garden-files/mixed-folders.ts";
import {
  copyGardenFolderContents,
  existingGardenFolder,
  isAutomaticGardenFolder,
  readGardenFolderTitle,
  rewriteRenamedFolderLinks,
  writeGardenFolderTitle,
} from "./garden-folder-copy.ts";
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

/** Imported folders can exist before the first Markdown note materializes them. */
function existingNotesOrFilesFolder(clusterDir: string, userId: number, clusterSlug: string, folder: string): string {
  try { return existingGardenFolder(clusterDir, folder); }
  catch (error) {
    if (!(error instanceof GardenFilesystemError) || error.status !== 404) throw error;
    const entry = gardenFiles().list(libraryFolderScope(userId, clusterSlug)).find(item => item.kind === "folder" && item.path.toLowerCase() === folder.normalize("NFC").toLowerCase());
    if (entry) return entry.path;
    throw error;
  }
}

function acquireStructureMutationLease(
  contentPath: string,
  clusterSlug: string,
  operation: string,
  paths?: readonly string[],
) {
  return acquireGardenMutationLeaseWithIngestionRecovery({
    contentPath,
    dataRoot: dashboardDataDir(),
    clusterSlug,
    operation,
    options: { paths },
  });
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
    let entries: Dirent[];
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

/** Read canonical folder paths without scanning or rebuilding note contents. */
export function listGardenFolders(clusterSlug: string): { folder: string; name: string }[] {
  const clusterDir = gardenDirectory(clusterSlug);
  return walkFolders(clusterDir).map((folder) => ({
    folder,
    name: isAutomaticGardenFolder(folder) ? gardenFolderTitle(folder)
      : readGardenFolderTitle(path.join(clusterDir, folder), gardenFolderTitle(folder)),
  }));
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

  const lease = acquireStructureMutationLease(
    contentPath,
    input.clusterSlug,
    "create-folder",
    [folder],
  );
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

    // Empty folders do not change the root's note index. Scanning every note
    // here made a tiny mkdir depend on the size of the entire Garden.
  } finally {
    lease.release();
  }
  // A saved folder is usable immediately. Publication is derived work and can
  // take minutes; the Explorer reads canonical folders while it catches up.
  void publishQuartzAfterMutation(
    `create folder ${input.clusterSlug}/${folder}`,
    {
      userId: input.userId,
      gardenSlug: input.clusterSlug,
    },
  ).catch((error) => console.error("[garden] Folder saved; publication failed:", error));
  return { folder };
}

/** Copy to an unused user-owned folder, leaving generated paths intact. */
export async function copyGardenFolder(input: {
  userId: number;
  clusterSlug: string;
  folder: unknown;
}): Promise<{ folder: string; newFolder: string; name: string }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);
  const sourceFolder = existingGardenFolder(clusterDir, input.folder);
  // A section copied inside Learning/ or Concepts/ would still belong to that
  // generated tree. Lift those copies to the user namespace; user folders keep
  // the normal sibling-copy behavior.
  const parent = isGardenUserPath(sourceFolder) ? sourceFolder.split("/").slice(0, -1).join("/") : "";
  const copyBase = [parent, `${sourceFolder.split("/").pop()}-copy`].filter(Boolean).join("/");
  const lease = acquireStructureMutationLease(contentPath, input.clusterSlug, "copy-folder", [copyBase]);
  let copied: { folder: string; newFolder: string; name: string };
  try {
    const folder = existingGardenFolder(clusterDir, input.folder);
    const basename = folder.split("/").pop()!;
    const title = isAutomaticGardenFolder(folder) ? gardenFolderTitle(folder)
      : readGardenFolderTitle(path.join(clusterDir, folder), gardenFolderTitle(folder));
    let number = 1;
    const sibling = (n: number) => [parent, `${basename}-copy${n === 1 ? "" : `-${n}`}`].filter(Boolean).join("/");
    let newFolder = sibling(number);
    const library = gardenFiles(), scope = libraryFolderScope(input.userId, input.clusterSlug);
    const libraryPaths = new Set(library.list(scope).map(entry => entry.path.toLowerCase()));
    while (fs.existsSync(resolveFolderDir(clusterDir, newFolder)) || libraryPaths.has(newFolder.toLowerCase())) newFolder = sibling(++number);
    const name = `${title} copy${number === 1 ? "" : ` ${number}`}`;
    assertGardenMutationWritePaths(lease, clusterDir, [newFolder]);
    changeMixedFolder(library, scope, "copy", folder, newFolder, () => copyGardenFolderContents(clusterDir, folder, newFolder, slugify));
    writeGardenFolderTitle(resolveFolderDir(clusterDir, newFolder), name);
    refreshClusterIndex(contentPath, input.clusterSlug, { migrateSources: false });
    copied = { folder, newFolder, name };
  } finally {
    lease.release();
  }
  void publishQuartzAfterMutation(`copy folder ${input.clusterSlug}/${copied.folder} -> ${copied.newFolder}`, {
    userId: input.userId, gardenSlug: input.clusterSlug,
  }).catch(error => console.error("[garden] Folder copied; publication failed:", error));
  return copied;
}

/**
 * Move one note (identified by its relative path or unique basename) into `toFolder`; an empty
 * destination means the Garden root. Notes keep their basename slug, so Quartz's
 * shortest-path link resolution keeps every existing `[[wikilink]]` working.
 */
export async function moveGardenDocument(input: {
  userId: number;
  clusterSlug: string;
  slug: unknown;
  toFolder: unknown;
}): Promise<{ slug: string; folder: string; relPath: string; previousRelPath: string }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);
  if (typeof input.slug !== "string" || !input.slug.trim()) {
    throw new GardenFilesystemError("slug is required", 400);
  }

  const requestedPath = input.slug.replace(/\\/g, "/").replace(/\.md$/i, "").trim();
  const requestedSlug = requestedPath.split("/").pop()!;
  const exactPath = requestedPath.includes("/") || /\.md$/i.test(input.slug);
  const findDocument = () => {
    const matches = walkClusterMarkdown(clusterDir).filter(item => exactPath
      ? item.relPath.replace(/\.md$/i, "") === requestedPath
      : item.entry.replace(/\.md$/i, "") === requestedSlug);
    if (matches.length > 1) throw new GardenFilesystemError("Use the document's full path to move it", 409);
    return matches[0];
  };
  // Existing folders retain their disk spelling (including EM1's numbered
  // sections). Normalize only new folder names, as creation does.
  let folder = normalizeGardenFolder(input.toFolder);
  if (typeof input.toFolder === "string" && input.toFolder) {
    try { folder = existingNotesOrFilesFolder(clusterDir, input.userId, input.clusterSlug, input.toFolder); }
    catch (error) { if (!(error instanceof GardenFilesystemError) || error.status !== 404) throw error; }
  }
  const beforeMove = findDocument();

  const lease = acquireStructureMutationLease(
    contentPath,
    input.clusterSlug,
    "move-document",
    [beforeMove?.relPath ?? "", folder],
  );
  let moved: { slug: string; folder: string; relPath: string; previousRelPath: string };
  try {
    const targetDir = resolveFolderDir(clusterDir, folder);
    const wantSlug = requestedSlug;
    const found = findDocument();
    if (!found) throw new GardenFilesystemError("Document not found", 404);

    const destPath = path.join(targetDir, found.entry);
    assertGardenMutationWritePaths(lease, clusterDir, [found.relPath, path.relative(clusterDir, destPath)]);
    if (path.resolve(destPath) === path.resolve(found.filePath)) {
      return { slug: wantSlug, folder, relPath: found.relPath, previousRelPath: found.relPath };
    }
    if (fs.existsSync(destPath)) {
      throw new GardenFilesystemError(
        "A note with that name already exists in the target folder",
        409,
      );
    }

    const library = gardenFiles(), scope = libraryFolderScope(input.userId, input.clusterSlug);
    library.database.transaction(() => {
      const destination = path.relative(clusterDir, destPath).replace(/\\/g, "/");
      if (library.list(scope).some(file => file.path.toLowerCase() === destination.toLowerCase())) throw new GardenFilesystemError("A file with that name already exists in the target folder", 409);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.renameSync(found.filePath, destPath);
    }).immediate();
    removePublicArtifacts(
      contentPath,
      input.clusterSlug,
      found.relPath.replace(/\.md$/i, ""),
    );

    const relPath = path.relative(clusterDir, destPath).replace(/\\/g, "/");
    refreshClusterIndex(contentPath, input.clusterSlug, { migrateSources: false });
    moved = { slug: wantSlug, folder, relPath, previousRelPath: found.relPath };
  } finally {
    lease.release();
  }
  void publishQuartzAfterMutation(
    `move document ${input.clusterSlug}/${moved.slug} -> ${moved.folder || "root"}`,
    { userId: input.userId, gardenSlug: input.clusterSlug },
  ).catch(error => console.error("[garden] Document moved; publication failed:", error));
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
  toFolder?: string;
}): Promise<{ folder: string; newFolder: string }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);

  const oldFolder = typeof input.folder === "string" ? input.folder.replace(/\\/g, "/") : "";
  const targetParent = input.toFolder === undefined ? oldFolder.split("/").slice(0, -1).join("/") : input.toFolder;
  const renamedFolder = [targetParent, normalizeGardenFolder(input.name)].filter(Boolean).join("/");

  const lease = acquireStructureMutationLease(
    contentPath,
    input.clusterSlug,
    "rename-folder",
    [oldFolder, renamedFolder],
  );
  let renamed: { folder: string; newFolder: string };
  try {
    const folder = existingGardenFolder(clusterDir, input.folder);
    if (isAutomaticGardenFolder(folder)) {
      throw new GardenFilesystemError("Automatically created folders cannot be renamed. You can copy this folder instead.", 400);
    }

    if (typeof input.name !== "string" || /[\\/]/.test(input.name)) {
      throw new GardenFilesystemError("Folder name cannot contain slashes", 400);
    }
    const newName = normalizeGardenFolder(input.name);
    if (!newName) throw new GardenFilesystemError("name is required", 400);
    if (newName.includes("/")) {
      throw new GardenFilesystemError(
        "Folder name cannot contain slashes",
        400,
      );
    }

    const parent = input.toFolder === undefined ? folder.split("/").slice(0, -1).join("/") : input.toFolder ? existingNotesOrFilesFolder(clusterDir, input.userId, input.clusterSlug, input.toFolder) : "";
    const newFolder = parent ? `${parent}/${newName}` : newName;
    if (newFolder.startsWith(`${folder}/`)) throw new GardenFilesystemError("A folder cannot be moved inside itself", 400);
    assertGardenMutationWritePaths(lease, clusterDir, [folder, newFolder]);
    if (isAutomaticGardenFolder(newFolder)) {
      throw new GardenFilesystemError("That name is reserved for an automatically created folder", 400);
    }

    const oldDir = resolveFolderDir(clusterDir, folder);
    const newDir = resolveFolderDir(clusterDir, newFolder);
    if (oldDir === clusterDir || newDir === clusterDir) {
      throw new GardenFilesystemError("Invalid folder path", 400);
    }
    if (!fs.existsSync(oldDir)) {
      throw new GardenFilesystemError("Folder not found", 404);
    }
    if (newFolder !== folder && fs.existsSync(newDir)) {
      throw new GardenFilesystemError(
        "A folder with that name already exists",
        409,
      );
    }

    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    if (newFolder !== folder) changeMixedFolder(gardenFiles(), libraryFolderScope(input.userId, input.clusterSlug), "move", folder, newFolder, () => fs.renameSync(oldDir, newDir));
    if (newFolder !== folder) rewriteRenamedFolderLinks(clusterDir, folder, newFolder);

    // Keep the Quartz folder title in sync with the new name.
    writeGardenFolderTitle(newDir, input.name.trim());

    // The old folder path (and every note inside it) has stale Quartz output.
    if (newFolder !== folder) removePublicArtifacts(contentPath, input.clusterSlug, folder);

    refreshClusterIndex(contentPath, input.clusterSlug, { migrateSources: false });
    renamed = { folder, newFolder };
  } finally {
    lease.release();
  }
  void publishQuartzAfterMutation(
    `rename folder ${input.clusterSlug}/${renamed.folder} -> ${renamed.newFolder}`,
    { userId: input.userId, gardenSlug: input.clusterSlug },
  ).catch(error => console.error("[garden] Folder renamed; publication failed:", error));
  return renamed;
}

/**
 * Delete a folder and every note inside it, along with their generated Quartz
 * output. Original notes and files are kept in the private file trash.
 */
export async function deleteGardenFolder(input: {
  userId: number;
  clusterSlug: string;
  clusterId: number;
  folder: unknown;
}): Promise<{ folder: string; deletedSlugs: string[] }> {
  const contentPath = contentRoot();
  const clusterDir = gardenDirectory(input.clusterSlug, contentPath);
  const folder = existingGardenFolder(clusterDir, input.folder);

  const lease = acquireStructureMutationLease(
    contentPath,
    input.clusterSlug,
    "delete-folder",
    [folder],
  );
  let deleted: { folder: string; deletedSlugs: string[] };
  try {
    const dir = resolveFolderDir(clusterDir, folder);
    if (dir === clusterDir) {
      throw new GardenFilesystemError("Invalid folder path", 400);
    }
    if (!fs.existsSync(dir)) return { folder, deletedSlugs: [] };

    const deletedSlugs = walkClusterMarkdown(dir).map((item) =>
      item.entry.replace(/\.md$/i, ""),
    );

    const library = gardenFiles(), scope = libraryFolderScope(input.userId, input.clusterSlug);
    preserveFolderForTrash(library, scope, folder);
    changeMixedFolder(library, scope, "trash", folder, "", () => fs.rmSync(dir, { recursive: true, force: true }));
    removePublicArtifacts(contentPath, input.clusterSlug, folder);

    if (deletedSlugs.length > 0) {
      const deleteSavedPdf = db.prepare(
        "DELETE FROM pdf_document_edits WHERE cluster_id = ? AND document_slug = ?",
      );
      for (const slug of deletedSlugs)
        deleteSavedPdf.run(input.clusterId, slug);
    }

    refreshClusterIndex(contentPath, input.clusterSlug, { migrateSources: false });
    deleted = { folder, deletedSlugs };
  } finally {
    lease.release();
  }
  void publishQuartzAfterMutation(
    `delete folder ${input.clusterSlug}/${deleted.folder}`,
    {
      userId: input.userId,
      gardenSlug: input.clusterSlug,
    },
  ).catch(error => console.error("[garden] Folder moved to trash; publication failed:", error));
  return deleted;
}

/** Exposed for callers that need the same normalization before validating. */
export { normalizeGardenFolder, slugify };
