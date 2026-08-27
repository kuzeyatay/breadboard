/**
 * Writing a `.garden` or a `.cluster`.
 *
 * Export is owner-only. A public garden is readable by anyone, but whether it
 * may be copied is the owner's call and is already expressed by `fork_allowed`;
 * an export route that honoured "readable" would quietly route around it.
 */

import AdmZip from "adm-zip";

import db from "../db.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { gardenDirectory } from "../garden-directory.ts";
import {
  folderLabel,
  isInSubtree,
  listFolders,
  normalizeFolderPath,
} from "../cluster-folders.ts";
import {
  CLUSTER_GARDENS_PREFIX,
  CLUSTER_MANIFEST_ENTRY,
  ENVELOPE_ENTRY,
  GARDEN_CONTENT_PREFIX,
  GARDEN_MANIFEST_ENTRY,
  OMITTED_STATE,
  TRANSFER_FILE_FORMATS,
  TRANSFER_FORMAT_VERSION,
  TransferError,
  gardenExportSkipReason,
  transferFileName,
} from "./format.ts";
import type {
  ClusterGardenEntry,
  ClusterManifest,
  GardenContentSummary,
  GardenManifest,
  TransferEnvelope,
  TransferKind,
} from "./format.ts";
import { addJsonEntry, createBudget, packDirectory } from "./archive.ts";
import type { PackBudget } from "./archive.ts";

interface ClusterRow {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: string | null;
  border_color: string | null;
  card_width: number | null;
  card_height: number | null;
  chat_accessible: number | null;
  fork_allowed: number | null;
  folder: string | null;
  created_at: string;
}

export interface TransferDownload {
  kind: TransferKind;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  /** What went in, so a caller can tell the user rather than guess. */
  summary: {
    gardens: number;
    files: number;
    bytes: number;
    skipped: number;
  };
}

function envelope(kind: TransferKind): TransferEnvelope {
  return {
    format: TRANSFER_FILE_FORMATS[kind].envelope,
    version: TRANSFER_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    generator: "Breadboard",
    omitted: OMITTED_STATE,
  };
}

function ownedGarden(userId: number, slug: string): ClusterRow {
  const cleanSlug = (slug ?? "").trim();
  if (!cleanSlug) throw new TransferError("A garden is required.");
  const row = db
    .prepare("SELECT * FROM clusters WHERE user_id = ? AND slug = ?")
    .get(userId, cleanSlug) as ClusterRow | undefined;
  if (!row) throw new TransferError("Garden not found.", 404);
  return row;
}

/** Resolve the garden's directory, restating a path failure as a transfer one. */
function gardenDirectoryFor(slug: string): string {
  try {
    return gardenDirectory(slug);
  } catch (error) {
    throw new TransferError(
      error instanceof Error ? error.message : "Invalid garden path.",
      500,
    );
  }
}

function gardenManifest(
  row: ClusterRow,
  folder: string,
  content: GardenContentSummary,
): GardenManifest {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description ?? "",
    visibility: row.visibility === "public" ? "public" : "private",
    borderColor: row.border_color ?? "#a9c1b1",
    cardWidth: Number(row.card_width) || 392,
    cardHeight: Number(row.card_height) || 244,
    chatAccessible: Boolean(row.chat_accessible),
    forkAllowed: Boolean(row.fork_allowed),
    folder,
    createdAt: row.created_at,
    content,
  };
}

/**
 * Pack one garden's directory under `prefix` and return its manifest. An
 * absent directory is not an error — a garden whose row exists but whose
 * content was never written still exports, as an empty one.
 */
function packGarden(
  zip: AdmZip,
  row: ClusterRow,
  folder: string,
  prefix: string,
  budget: PackBudget,
): GardenManifest {
  const directory = gardenDirectoryFor(row.slug);
  const content = fs.existsSync(directory)
    ? packDirectory(zip, directory, prefix, budget, gardenExportSkipReason)
    : { files: 0, bytes: 0, skipped: [] };
  return gardenManifest(row, folder, content);
}

export function exportGardenArchive(
  userId: number,
  slug: string,
): TransferDownload {
  const row = ownedGarden(userId, slug);
  const zip = new AdmZip();
  const budget = createBudget();

  const manifest = packGarden(
    zip,
    row,
    normalizeFolderPath(row.folder),
    GARDEN_CONTENT_PREFIX,
    budget,
  );
  addJsonEntry(zip, GARDEN_MANIFEST_ENTRY, manifest);
  addJsonEntry(zip, ENVELOPE_ENTRY, envelope("garden"));

  return {
    kind: "garden",
    filename: transferFileName("garden", row.name),
    mimeType: TRANSFER_FILE_FORMATS.garden.mimeType,
    buffer: zip.toBuffer(),
    summary: {
      gardens: 1,
      files: manifest.content.files,
      bytes: manifest.content.bytes,
      skipped: manifest.content.skipped.length,
    },
  };
}

export function exportClusterArchive(
  userId: number,
  clusterPath: string,
): TransferDownload {
  const root = normalizeFolderPath(clusterPath);
  if (!root) throw new TransferError("A cluster is required.");

  const folders = listFolders(db, userId).filter((folder) =>
    isInSubtree(folder, root),
  );
  const gardens = (
    db
      .prepare(
        "SELECT * FROM clusters WHERE user_id = ? ORDER BY created_at ASC",
      )
      .all(userId) as ClusterRow[]
  ).filter((row) => isInSubtree(normalizeFolderPath(row.folder), root));

  if (!folders.length && !gardens.length) {
    throw new TransferError("Cluster not found.", 404);
  }

  const zip = new AdmZip();
  const budget = createBudget();
  const entries: ClusterGardenEntry[] = [];
  const directories = new Set<string>();
  let files = 0;
  let bytes = 0;
  let skipped = 0;

  for (const row of gardens) {
    // Slugs are unique per install, so this collides only against itself; the
    // counter is there so a hand-edited archive can never overwrite a sibling.
    let directory = row.slug;
    let counter = 2;
    while (directories.has(directory)) {
      directory = `${row.slug}-${counter}`;
      counter += 1;
    }
    directories.add(directory);

    const folder = normalizeFolderPath(row.folder);
    const relativeFolder =
      folder === root ? "" : folder.slice(root.length + 1);
    const prefix = `${CLUSTER_GARDENS_PREFIX}${directory}/`;
    const manifest = packGarden(
      zip,
      row,
      relativeFolder,
      `${prefix}${GARDEN_CONTENT_PREFIX}`,
      budget,
    );
    addJsonEntry(zip, `${prefix}${GARDEN_MANIFEST_ENTRY}`, manifest);

    entries.push({ directory, folder: relativeFolder });
    files += manifest.content.files;
    bytes += manifest.content.bytes;
    skipped += manifest.content.skipped.length;
  }

  const manifest: ClusterManifest = {
    path: root,
    label: folderLabel(root),
    folders: folders.map((folder) =>
      folder === root ? "" : folder.slice(root.length + 1),
    ),
    gardens: entries,
  };
  addJsonEntry(zip, CLUSTER_MANIFEST_ENTRY, manifest);
  addJsonEntry(zip, ENVELOPE_ENTRY, envelope("cluster"));

  return {
    kind: "cluster",
    filename: transferFileName("cluster", manifest.label),
    mimeType: TRANSFER_FILE_FORMATS.cluster.mimeType,
    buffer: zip.toBuffer(),
    summary: { gardens: entries.length, files, bytes, skipped },
  };
}
