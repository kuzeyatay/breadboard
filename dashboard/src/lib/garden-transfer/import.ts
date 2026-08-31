/**
 * Reading a `.garden` or a `.cluster` back into this install.
 *
 * An import never adopts the source's identity. The slug is reallocated (it is
 * a globally unique column and a directory name), and visibility, chat access
 * and fork permission all reset the way `forkCluster` resets them — publishing
 * a garden onto your own site should be a deliberate act, not a side effect of
 * opening a file someone sent you.
 *
 * Failure is all-or-nothing: every directory is extracted first, then all the
 * database writes run in one transaction, and if that transaction throws the
 * extracted directories are removed again. A half-imported cluster would leave
 * orphan directories that no row points at.
 */

import db from "../db.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { gardenDirectory } from "../garden-directory.ts";
import { uniqueGardenSlug } from "../garden-slug.ts";
import {
  MAX_FOLDER_DEPTH,
  ensureFolderPath,
  folderPathChain,
  folderPathExists,
  joinFolderPath,
  normalizeFolderName,
  normalizeFolderPath,
} from "../cluster-folders.ts";
import {
  CLUSTER_GARDENS_PREFIX,
  CLUSTER_MANIFEST_ENTRY,
  ENVELOPE_ENTRY,
  GARDEN_CONTENT_PREFIX,
  GARDEN_MANIFEST_ENTRY,
  TransferError,
  parseClusterManifest,
  parseEnvelope,
  parseGardenManifest,
} from "./format.ts";
import type { GardenManifest, TransferImportResult } from "./format.ts";
import { openArchive, readJsonEntry, unpackPrefix } from "./archive.ts";
import { acquireGardenMutationLease } from "../garden-mutation-lease.ts";

interface PendingGarden {
  manifest: GardenManifest;
  slug: string;
  directory: string;
  folder: string;
  /** Archive prefix this garden's content sits under. */
  prefix: string;
  files: number;
  bytes: number;
}

/**
 * `uniqueGardenSlug` asks the database whether a slug is taken. Within a single
 * import several gardens are allocated before any row is written, so this shim
 * answers for the ones already claimed in this run too.
 */
function slugSource(reserved: Set<string>) {
  return {
    prepare(sql: string) {
      return {
        get(...params: unknown[]) {
          const slug = String(params[0]);
          if (reserved.has(slug)) return 1;
          return db.prepare(sql).get(...params);
        },
      };
    },
  };
}

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

/** A free slug whose directory does not already exist on disk. */
function allocateGarden(
  name: string,
  reserved: Set<string>,
): { slug: string; directory: string } {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const slug = uniqueGardenSlug(slugSource(reserved), name);
    reserved.add(slug);
    const directory = gardenDirectoryFor(slug);
    if (!fs.existsSync(directory)) return { slug, directory };
  }
  throw new TransferError(
    `Could not find a free name for the garden "${name}".`,
    409,
  );
}

/** `label` under `parent`, suffixed until nothing is filed there already. */
function allocateClusterPath(
  userId: number,
  parent: string,
  label: string,
): string {
  const cleanLabel = normalizeFolderName(label) || "Cluster";
  for (let counter = 1; counter < 100; counter += 1) {
    const candidate = joinFolderPath(
      parent,
      counter === 1 ? cleanLabel : `${cleanLabel} ${counter}`,
    );
    if (!candidate) break;
    if (!folderPathExists(db, userId, candidate)) return candidate;
  }
  throw new TransferError(
    `Could not find a free name for the cluster "${label}".`,
    409,
  );
}

function assertFolderDepth(root: string, relativeFolders: string[]): void {
  const rootDepth = folderPathChain(root).length;
  const deepest = relativeFolders.reduce(
    (max, folder) => Math.max(max, folderPathChain(folder).length),
    0,
  );
  if (rootDepth + deepest > MAX_FOLDER_DEPTH) {
    throw new TransferError(
      `Importing here would nest clusters more than ${MAX_FOLDER_DEPTH} levels deep. Import it somewhere shallower.`,
    );
  }
}

function insertGarden(userId: number, pending: PendingGarden): void {
  const { manifest } = pending;
  if (pending.folder) ensureFolderPath(db, userId, pending.folder);
  db.prepare(
    `INSERT INTO clusters (
       user_id,
       name,
       slug,
       description,
       visibility,
       border_color,
       card_width,
       card_height,
       chat_accessible,
       fork_allowed,
       folder,
       thought_topology_enabled,
       thought_topology_revision
     )
     VALUES (?, ?, ?, ?, 'private', ?, ?, ?, 0, 0, ?, 1, 0)`,
  ).run(
    userId,
    manifest.name,
    pending.slug,
    manifest.description,
    manifest.borderColor,
    manifest.cardWidth,
    manifest.cardHeight,
    pending.folder || null,
  );
}

/**
 * The tail every mutation in this codebase runs: rebuild each garden's cluster
 * index, rebuild the private Quartz index, republish.
 *
 * It runs after the transaction has committed, so a failure here means the
 * import succeeded and the published site is stale — reported, never thrown,
 * because raising it would tell the caller nothing was imported when something
 * was. The modules are pulled in dynamically: they reach the webpack-only `@/`
 * alias, so a static import would make this file unloadable anywhere else.
 */
async function republish(
  userId: number,
  slugs: string[],
  reason: string,
): Promise<void> {
  try {
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (contentPath) {
      const { refreshClusterIndex } = await import("../knowledge.ts");
      for (const slug of slugs) {
        const gardenDir = gardenDirectoryFor(slug);
        const lease = acquireGardenMutationLease(
          gardenDir,
          "refresh-imported-garden",
        );
        try {
          refreshClusterIndex(contentPath, slug);
        } finally {
          lease.release();
        }
      }
    }
    const { refreshPrivateQuartzIndex } = await import(
      "../quartz-garden-index.ts"
    );
    refreshPrivateQuartzIndex(userId);
    const { publishQuartzAfterMutation } = await import("../quartz-publish.ts");
    await publishQuartzAfterMutation(reason, { userId });
    const { invalidateThoughtTopologyAfterMutation } = await import(
      "../thought-topology/state.ts"
    );
    for (const slug of slugs) {
      await invalidateThoughtTopologyAfterMutation(slug, reason);
    }
  } catch (error) {
    console.error("[transfer] import succeeded but republishing failed", error);
  }
}

/**
 * Import either file type. `targetFolder` is the cluster to import into: for a
 * `.cluster` it is the parent the imported cluster is filed under, and for a
 * `.garden` it is where the garden lands. Passing nothing puts a garden back in
 * the cluster path it was exported from, and a cluster at the top level.
 */
export async function importTransferArchive(
  userId: number,
  buffer: Buffer,
  options: { targetFolder?: string | null } = {},
): Promise<TransferImportResult> {
  const zip = openArchive(buffer);
  const { kind, envelope } = parseEnvelope(readJsonEntry(zip, ENVELOPE_ENTRY));
  const targetFolder = normalizeFolderPath(options.targetFolder);

  const reserved = new Set<string>();
  const pending: PendingGarden[] = [];
  const emptyFolders: string[] = [];
  let clusterPath: string | null = null;

  if (kind === "garden") {
    const manifest = parseGardenManifest(
      readJsonEntry(zip, GARDEN_MANIFEST_ENTRY),
    );
    // With no target, a garden returns to the cluster path it came from.
    const folder = targetFolder || normalizeFolderPath(manifest.folder);
    const { slug, directory } = allocateGarden(manifest.name, reserved);
    pending.push({
      manifest,
      slug,
      directory,
      folder,
      prefix: GARDEN_CONTENT_PREFIX,
      files: 0,
      bytes: 0,
    });
  } else {
    const manifest = parseClusterManifest(
      readJsonEntry(zip, CLUSTER_MANIFEST_ENTRY),
    );
    const relativeFolders = manifest.folders
      .concat(manifest.gardens.map((entry) => entry.folder))
      .map((folder) => normalizeFolderPath(folder));
    clusterPath = allocateClusterPath(userId, targetFolder, manifest.label);
    assertFolderDepth(clusterPath, relativeFolders);

    for (const entry of manifest.gardens) {
      const entryPrefix = `${CLUSTER_GARDENS_PREFIX}${entry.directory}/`;
      const gardenManifest = parseGardenManifest(
        readJsonEntry(zip, `${entryPrefix}${GARDEN_MANIFEST_ENTRY}`),
      );
      const relative = normalizeFolderPath(entry.folder);
      const folder = relative ? `${clusterPath}/${relative}` : clusterPath;
      const { slug, directory } = allocateGarden(gardenManifest.name, reserved);
      pending.push({
        manifest: gardenManifest,
        slug,
        directory,
        folder,
        prefix: `${entryPrefix}${GARDEN_CONTENT_PREFIX}`,
        files: 0,
        bytes: 0,
      });
    }

    // Every cluster the export recorded, even an empty one, so the tree comes
    // back the shape it left.
    for (const folder of manifest.folders) {
      const relative = normalizeFolderPath(folder);
      if (relative) emptyFolders.push(`${clusterPath}/${relative}`);
    }
  }

  const created: string[] = [];
  const mutationLeases: ReturnType<typeof acquireGardenMutationLease>[] = [];
  const removeCreated = () => {
    for (const directory of created) {
      try {
        fs.rmSync(directory, { recursive: true, force: true });
      } catch {
        // Best effort: the database rolled back, so nothing points here.
      }
    }
  };

  try {
    for (const garden of [...pending].sort((left, right) =>
      left.directory.localeCompare(right.directory),
    )) {
      mutationLeases.push(
        acquireGardenMutationLease(garden.directory, "import-garden"),
      );
    }
  } catch (error) {
    for (const lease of mutationLeases.reverse()) lease.release();
    throw error;
  }

  try {
    for (const garden of pending) {
      fs.mkdirSync(garden.directory, { recursive: true });
      created.push(garden.directory);
      const written = unpackPrefix(zip, garden.prefix, garden.directory);
      garden.files = written.files;
      garden.bytes = written.bytes;
    }

    db.transaction(() => {
      if (clusterPath) ensureFolderPath(db, userId, clusterPath);
      for (const folder of emptyFolders) ensureFolderPath(db, userId, folder);
      for (const garden of pending) insertGarden(userId, garden);
    })();
  } catch (error) {
    removeCreated();
    throw error;
  } finally {
    for (const lease of mutationLeases.reverse()) lease.release();
  }

  await republish(
    userId,
    pending.map((garden) => garden.slug),
    kind === "garden"
      ? `import garden ${pending[0]?.slug ?? ""}`
      : `import cluster ${clusterPath ?? ""}`,
  );

  return {
    kind,
    clusterPath,
    gardens: pending.map((garden) => ({
      slug: garden.slug,
      name: garden.manifest.name,
      folder: garden.folder || null,
      files: garden.files,
      bytes: garden.bytes,
    })),
    exportedAt: envelope.exportedAt,
    omitted: envelope.omitted,
  };
}
