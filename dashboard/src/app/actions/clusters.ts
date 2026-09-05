"use server";

import db from "@/lib/db";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { countClusterMarkdown, refreshClusterIndex } from "@/lib/knowledge";
import {
  refreshOrganizationQuartzIndex,
  refreshPrivateQuartzIndex,
  refreshPublicQuartzIndex,
} from "@/lib/quartz-garden-index";
import {
  memberRole,
  organizationClusterClause,
} from "@/lib/organizations/store";
import { prepareGraftIndex } from "@/lib/code-index/garden";
import type { GraftIndexState } from "@/lib/code-index/index-service";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { requireUserId } from "@/lib/server-auth";
import { uniqueGardenSlug } from "@/lib/garden-slug";
import { acquireGardenMutationLease } from "@/lib/garden-mutation-lease";
import {
  deleteOwnedGarden,
  finalizeGardenDeletion,
} from "@/lib/garden-deletion";
import {
  createFolder,
  deleteFolder,
  ensureFolderPath,
  listFolders,
  moveFolder,
  normalizeFolderPath,
  renameFolder,
  reorderFolder,
} from "@/lib/cluster-folders";
import {
  isGardenMemoryScope,
  MAX_GARDEN_INSTRUCTIONS,
  type GardenMemoryScope,
} from "@/lib/garden-settings";

export interface Cluster {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: ClusterVisibility;
  organization_id: number | null;
  organizationName?: string | null;
  border_color: string;
  card_width: number;
  card_height: number;
  chat_accessible: boolean;
  fork_allowed: boolean;
  view_count: number;
  last_viewed_at: string | null;
  folder: string | null;
  created_at: string;
  noteCount: number;
  ownerEmail?: string;
  ownerUsername?: string;
  isOwner?: boolean;
  repo_connected: boolean;
  repo_name: string | null;
  /** Coding agents in this garden query the graft index of that repository. */
  graft_enabled: boolean;
  thought_topology_enabled: boolean;
}

export type ClusterVisibility = "private" | "organization" | "public";

const DEFAULT_BORDER_COLOR = "#a9c1b1";
const DEFAULT_CARD_WIDTH = 392;
const DEFAULT_CARD_HEIGHT = 244;
const MIN_CARD_WIDTH = 280;
const MAX_CARD_WIDTH = 640;
const MIN_CARD_HEIGHT = 190;
const MAX_CARD_HEIGHT = 440;

type ClusterRow = Omit<
  Cluster,
  | "noteCount"
  | "visibility"
  | "organization_id"
  | "border_color"
  | "card_width"
  | "card_height"
  | "chat_accessible"
  | "fork_allowed"
  | "view_count"
  | "last_viewed_at"
  | "repo_connected"
  | "repo_name"
  | "graft_enabled"
  | "thought_topology_enabled"
> & {
  visibility?: string | null;
  organization_id?: number | null;
  border_color?: string | null;
  card_width?: number | null;
  card_height?: number | null;
  chat_accessible?: number | null;
  fork_allowed?: number | null;
  view_count?: number | null;
  last_viewed_at?: string | null;
  repo_path?: string | null;
  graft_enabled?: number | null;
  thought_topology_enabled?: number | null;
};

function normalizeVisibility(
  value: string | null | undefined,
): ClusterVisibility {
  if (value === "public") return "public";
  if (value === "organization") return "organization";
  return "private";
}

function normalizeBorderColor(value: string | null | undefined): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : DEFAULT_BORDER_COLOR;
}

function clampDimension(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeCardWidth(value: number | null | undefined): number {
  return clampDimension(
    Number(value),
    MIN_CARD_WIDTH,
    MAX_CARD_WIDTH,
    DEFAULT_CARD_WIDTH,
  );
}

function normalizeCardHeight(value: number | null | undefined): number {
  return clampDimension(
    Number(value),
    MIN_CARD_HEIGHT,
    MAX_CARD_HEIGHT,
    DEFAULT_CARD_HEIGHT,
  );
}

// Notes live in sub-folders: an uploaded document lands in `sources/`, study
// pages under `learning/`. A flat read of the Garden root therefore reports 0
// for a Garden that is full, which is why this walks the tree.
function countNotes(contentPath: string, slug: string): number {
  try {
    return countClusterMarkdown(path.join(contentPath, slug));
  } catch {
    return 0;
  }
}

function toCluster(
  row: ClusterRow,
  noteCount: number,
  userId?: number,
): Cluster {
  const {
    repo_path: repoPath,
    graft_enabled: graftEnabled,
    thought_topology_enabled: topologyEnabled,
    ...safeRow
  } = row;
  const isOwner =
    typeof userId === "number" ? row.user_id === userId : Boolean(row.isOwner);
  const visibility = normalizeVisibility(row.visibility);
  return {
    ...safeRow,
    visibility,
    organization_id:
      visibility === "organization" && typeof row.organization_id === "number"
        ? row.organization_id
        : null,
    border_color: normalizeBorderColor(row.border_color),
    card_width: normalizeCardWidth(row.card_width),
    card_height: normalizeCardHeight(row.card_height),
    chat_accessible: Boolean(row.chat_accessible),
    fork_allowed: Boolean(row.fork_allowed),
    view_count: Number(row.view_count) || 0,
    last_viewed_at: row.last_viewed_at ?? null,
    folder:
      typeof row.folder === "string" && row.folder.trim()
        ? row.folder.trim()
        : null,
    noteCount,
    isOwner,
    repo_connected: isOwner && Boolean(repoPath),
    repo_name: isOwner && repoPath ? path.basename(repoPath) : null,
    // Gardens created before the column read as on, which is the default.
    graft_enabled: graftEnabled !== 0,
    thought_topology_enabled: topologyEnabled === 1,
  };
}

function uniqueClusterSlug(name: string): string {
  return uniqueGardenSlug(db, name);
}

function resolveChildPath(
  parentPath: string,
  childName: string,
): string | null {
  const parent = path.resolve(parentPath);
  const child = path.resolve(parent, childName);
  return child.startsWith(`${parent}${path.sep}`) ? child : null;
}

export async function getClusters(userId: number): Promise<Cluster[]> {
  try {
    const rows = db
      .prepare(
        "SELECT * FROM clusters WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(userId) as ClusterRow[];

    const contentPath = process.env.QUARTZ_CONTENT_PATH ?? "";
    return rows.map((c) =>
      toCluster(c, countNotes(contentPath, c.slug), userId),
    );
  } catch {
    throw new Error("Failed to load gardens");
  }
}

export async function getPublicClusters(userId: number): Promise<Cluster[]> {
  try {
    const rows = db
      .prepare(
        `SELECT c.*, u.email AS ownerEmail, u.username AS ownerUsername
         FROM clusters c
         JOIN users u ON u.id = c.user_id
         WHERE c.visibility = 'public'
         ORDER BY COALESCE(c.view_count, 0) DESC, c.created_at DESC`,
      )
      .all() as ClusterRow[];

    const contentPath = process.env.QUARTZ_CONTENT_PATH ?? "";
    return rows.map((c) =>
      toCluster(c, countNotes(contentPath, c.slug), userId),
    );
  } catch {
    throw new Error("Failed to load public gardens");
  }
}

/**
 * Every garden shared with an organization the account belongs to, including
 * its own, so the owner can see what it has put in front of the group.
 */
export async function getOrganizationClusters(
  userId: number,
): Promise<Cluster[]> {
  try {
    const shared = organizationClusterClause(userId, "c");
    if (shared === "0") return [];

    const rows = db
      .prepare(
        `SELECT c.*, u.email AS ownerEmail, u.username AS ownerUsername,
                o.name AS organizationName
         FROM clusters c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN organizations o ON o.id = c.organization_id
         WHERE ${shared}
         ORDER BY c.created_at DESC`,
      )
      .all() as ClusterRow[];

    const contentPath = process.env.QUARTZ_CONTENT_PATH ?? "";
    return rows.map((c) =>
      toCluster(c, countNotes(contentPath, c.slug), userId),
    );
  } catch {
    throw new Error("Failed to load organization gardens");
  }
}

export async function recordClusterView(
  userId: number,
  slug: string,
): Promise<void> {
  try {
    const cleanSlug = slug.trim();
    if (!cleanSlug) return;

    db.prepare(
      `UPDATE clusters
       SET view_count = COALESCE(view_count, 0) + 1,
           last_viewed_at = datetime('now')
       WHERE slug = ?
         AND visibility = 'public'
         AND user_id <> ?`,
    ).run(cleanSlug, userId);
    refreshPublicQuartzIndex();
  } catch {
    // Popularity should never block opening a readable garden.
  }
}

export async function createCluster(
  name: string,
  description: string,
  /** Drop the new garden straight into this cluster instead of the top level. */
  folder?: string | null,
): Promise<string> {
  try {
    const userId = await requireUserId();
    const slug = uniqueClusterSlug(name);
    const cleanFolder = normalizeFolderPath(folder);
    if (cleanFolder) ensureFolderPath(db, userId, cleanFolder);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    const clusterDir = contentPath ? path.join(contentPath, slug) : null;
    const lease = clusterDir
      ? acquireGardenMutationLease(clusterDir, "create-garden")
      : null;

    try {
      db.prepare(
        `INSERT INTO clusters (
          user_id, name, slug, description, visibility, border_color, folder,
          thought_topology_enabled, thought_topology_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      ).run(
        userId,
        name,
        slug,
        description,
        "private",
        DEFAULT_BORDER_COLOR,
        cleanFolder || null,
      );

      if (contentPath && clusterDir) {
        fs.mkdirSync(clusterDir, { recursive: true });
        const date = new Date().toISOString().split("T")[0];
        const indexContent = `---\ntitle: ${name}\ndate: ${date}\ndescription: ${description || ""}\nknowledge_type: "cluster-index"\n---\n`;
        fs.writeFileSync(path.join(clusterDir, "_index.md"), indexContent);
        refreshClusterIndex(contentPath, slug);
      }
    } finally {
      lease?.release();
    }

    refreshPrivateQuartzIndex(userId);
    // The garden is usable as soon as its database row and source index exist.
    // A full Quartz publication can take minutes, so keep it in the request's
    // post-response lifetime instead of holding the create dialog open.
    after(async () => {
      try {
        await publishQuartzAfterMutation(`create cluster ${slug}`, {
          userId,
          gardenSlug: slug,
        });
      } catch (error) {
        console.error(
          `[quartz] Failed to publish newly created garden ${slug}:`,
          error,
        );
      }
    });
    revalidatePath("/dashboard");
    revalidatePath("/garden");
    return slug;
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to create garden",
    );
  }
}

export async function updateClusterDetails(
  clusterId: number,
  name: string,
  description: string,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    if (!cleanName) throw new Error("Garden name is required");

    const cluster = db
      .prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?")
      .get(clusterId, userId) as { slug: string } | undefined;
    if (!cluster) throw new Error("Garden not found");
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    const clusterDir = contentPath
      ? path.join(contentPath, cluster.slug)
      : null;
    const lease = clusterDir
      ? acquireGardenMutationLease(clusterDir, "update-garden-details")
      : null;

    try {
      db.prepare(
        "UPDATE clusters SET name = ?, description = ? WHERE id = ? AND user_id = ?",
      ).run(cleanName, cleanDescription, clusterId, userId);

      if (contentPath && clusterDir) {
        fs.mkdirSync(clusterDir, { recursive: true });
        const date = new Date().toISOString().split("T")[0];
        const indexContent = `---\ntitle: ${JSON.stringify(cleanName)}\ndate: ${date}\ndescription: ${JSON.stringify(cleanDescription)}\nknowledge_type: "cluster-index"\n---\n`;
        fs.writeFileSync(path.join(clusterDir, "_index.md"), indexContent);
        refreshClusterIndex(contentPath, cluster.slug);
      }
    } finally {
      lease?.release();
    }

    refreshPrivateQuartzIndex(userId);
    refreshPublicQuartzIndex();
    await publishQuartzAfterMutation(`update cluster ${cluster.slug}`, {
      userId,
      gardenSlug: cluster.slug,
    });
    revalidatePath("/dashboard");
    revalidatePath("/garden");
    revalidatePath(`/gardens/${cluster.slug}`);
    revalidatePath(`/garden/${cluster.slug}`);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to update garden",
    );
  }
}

export async function setClusterVisibility(
  clusterId: number,
  visibility: ClusterVisibility,
  organizationId?: number | null,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const nextVisibility = normalizeVisibility(visibility);
    const cluster = db
      .prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?")
      .get(clusterId, userId) as { slug: string } | undefined;
    if (!cluster) throw new Error("Garden not found");

    let nextOrganizationId: number | null = null;
    if (nextVisibility === "organization") {
      nextOrganizationId = Number(organizationId);
      if (!memberRole(nextOrganizationId, userId)) {
        throw new Error("You are not in that organization");
      }
    }

    const result = db
      .prepare(
        "UPDATE clusters SET visibility = ?, organization_id = ? WHERE id = ? AND user_id = ?",
      )
      .run(nextVisibility, nextOrganizationId, clusterId, userId);

    if (result.changes !== 1) throw new Error("Garden not found");

    refreshPrivateQuartzIndex(userId);
    refreshPublicQuartzIndex();
    refreshOrganizationQuartzIndex(userId);
    const scope = nextVisibility === "public" ? "publish" : "unpublish";
    await publishQuartzAfterMutation(`${scope} cluster ${cluster.slug}`, {
      userId,
      topologyImpact: "none",
    });
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to update garden visibility",
    );
  }
}

export async function getClusterFolders(userId: number): Promise<string[]> {
  try {
    return listFolders(db, userId);
  } catch {
    return [];
  }
}

export async function createClusterFolder(
  name: string,
  parent?: string | null,
): Promise<void> {
  try {
    const userId = await requireUserId();
    createFolder(db, userId, name, parent ?? null);

    refreshPrivateQuartzIndex(userId);
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to create cluster",
    );
  }
}

export async function setClusterFolder(
  clusterId: number,
  folder: string | null,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const cluster = db
      .prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?")
      .get(clusterId, userId) as { slug: string } | undefined;
    if (!cluster) throw new Error("Garden not found");

    const cleanFolder = normalizeFolderPath(folder);
    if (cleanFolder) ensureFolderPath(db, userId, cleanFolder);

    db.prepare(
      "UPDATE clusters SET folder = ? WHERE id = ? AND user_id = ?",
    ).run(cleanFolder || null, clusterId, userId);

    refreshPrivateQuartzIndex(userId);
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to move garden",
    );
  }
}

/** Rename a cluster in place, carrying its nested clusters and gardens along. */
export async function renameClusterFolder(
  oldPath: string,
  newName: string,
): Promise<void> {
  try {
    const userId = await requireUserId();
    renameFolder(db, userId, oldPath, newName);

    refreshPrivateQuartzIndex(userId);
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to rename cluster",
    );
  }
}

/** Re-parent a cluster. `targetParent` of null moves it back to the top level. */
export async function moveClusterFolder(
  sourcePath: string,
  targetParent: string | null,
): Promise<void> {
  try {
    const userId = await requireUserId();
    moveFolder(db, userId, sourcePath, targetParent);

    refreshPrivateQuartzIndex(userId);
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to move cluster",
    );
  }
}

/**
 * Place a cluster immediately before or after `targetPath`, re-parenting it to
 * that sibling's parent when needed. Dropping on a cluster's top or bottom edge
 * reorders; dropping in its middle still nests.
 */
export async function reorderClusterFolder(
  sourcePath: string,
  targetPath: string,
  place: "before" | "after",
): Promise<void> {
  try {
    const userId = await requireUserId();
    reorderFolder(db, userId, sourcePath, targetPath, place);

    refreshPrivateQuartzIndex(userId);
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to reorder cluster",
    );
  }
}

/** Delete a cluster and every cluster nested in it. Gardens survive, unfiled. */
export async function deleteClusterFolder(name: string): Promise<void> {
  try {
    const userId = await requireUserId();
    deleteFolder(db, userId, name);

    refreshPrivateQuartzIndex(userId);
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to delete cluster",
    );
  }
}

export async function setClusterChatAccessible(
  clusterId: number,
  accessible: boolean,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const result = db
      .prepare(
        "UPDATE clusters SET chat_accessible = ? WHERE id = ? AND user_id = ?",
      )
      .run(accessible ? 1 : 0, clusterId, userId);

    if (result.changes !== 1) throw new Error("Garden not found");

    revalidatePath("/dashboard");
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Failed to update garden accessibility",
    );
  }
}

/**
 * Standing instructions for a garden, appended to the system prompt of every
 * turn that happens in it. Empty clears them.
 */
export async function setClusterInstructions(
  clusterId: number,
  instructions: string,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const cleaned = instructions.trim().slice(0, MAX_GARDEN_INSTRUCTIONS);
    const result = db
      .prepare(
        "UPDATE clusters SET instructions = ? WHERE id = ? AND user_id = ?",
      )
      .run(cleaned, clusterId, userId);
    if (result.changes !== 1) throw new Error("Garden not found");
    revalidatePath("/dashboard");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to save garden instructions",
    );
  }
}

/**
 * Whether this garden's durable memories are sealed inside it.
 *
 * The enforcement is a hard filter in retrieveDurableMemories, not a ranking
 * nudge — see src/lib/conversations/memory-isolation.ts.
 */
export async function setClusterMemoryScope(
  clusterId: number,
  scope: GardenMemoryScope,
): Promise<void> {
  try {
    const userId = await requireUserId();
    if (!isGardenMemoryScope(scope)) throw new Error("Unknown memory setting");
    const result = db
      .prepare(
        "UPDATE clusters SET memory_scope = ? WHERE id = ? AND user_id = ?",
      )
      .run(scope, clusterId, userId);
    if (result.changes !== 1) throw new Error("Garden not found");
    revalidatePath("/dashboard");
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Failed to update garden memory setting",
    );
  }
}

export async function setClusterForkAllowed(
  clusterId: number,
  allowed: boolean,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const result = db
      .prepare(
        "UPDATE clusters SET fork_allowed = ? WHERE id = ? AND user_id = ?",
      )
      .run(allowed ? 1 : 0, clusterId, userId);

    if (result.changes !== 1) throw new Error("Garden not found");

    revalidatePath("/dashboard");
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Failed to update garden fork setting",
    );
  }
}

export async function setClusterRepository(
  clusterId: number,
  repositoryPath: string,
): Promise<{ connected: true; repoName: string; codeIndex: GraftIndexState }> {
  try {
    const userId = await requireUserId();
    const requestedPath = repositoryPath.trim();
    if (!requestedPath || !path.isAbsolute(requestedPath)) {
      throw new Error("Choose a local repository folder");
    }

    const resolvedPath = fs.realpathSync(path.resolve(requestedPath));
    if (!fs.statSync(resolvedPath).isDirectory()) {
      throw new Error("The selected path is not a folder");
    }
    if (!fs.existsSync(path.join(resolvedPath, ".git"))) {
      throw new Error("Choose a Git repository (the folder must contain .git)");
    }

    const result = db
      .prepare("UPDATE clusters SET repo_path = ? WHERE id = ? AND user_id = ?")
      .run(resolvedPath, clusterId, userId);
    if (result.changes !== 1) throw new Error("Garden not found");

    // Start the code index now rather than on the first coding agent run, so
    // the graph is usually ready by the time somebody asks for a change.
    const codeIndex = await prepareGraftIndex(userId, resolvedPath);

    revalidatePath("/dashboard");
    return {
      connected: true,
      repoName: path.basename(resolvedPath),
      codeIndex,
    };
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to connect repository",
    );
  }
}

export async function setClusterGraftEnabled(
  clusterId: number,
  enabled: boolean,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const row = db
      .prepare("SELECT repo_path FROM clusters WHERE id = ? AND user_id = ?")
      .get(clusterId, userId) as { repo_path?: string | null } | undefined;
    if (!row) throw new Error("Garden not found");
    db.prepare(
      "UPDATE clusters SET graft_enabled = ? WHERE id = ? AND user_id = ?",
    ).run(enabled ? 1 : 0, clusterId, userId);

    // Turning it back on for a repository connected while it was off still
    // needs a graph before the next run can use one.
    if (enabled && row.repo_path) {
      await prepareGraftIndex(userId, row.repo_path);
    }

    revalidatePath("/dashboard");
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Failed to update the code index setting",
    );
  }
}

export async function setClusterBorderColor(
  clusterId: number,
  borderColor: string,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const color = normalizeBorderColor(borderColor);
    const result = db
      .prepare(
        "UPDATE clusters SET border_color = ? WHERE id = ? AND user_id = ?",
      )
      .run(color, clusterId, userId);

    if (result.changes !== 1) throw new Error("Garden not found");

    revalidatePath("/dashboard");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to update border color",
    );
  }
}

export async function setClusterCardSize(
  clusterId: number,
  width: number,
  height: number,
): Promise<void> {
  try {
    const userId = await requireUserId();
    const cardWidth = normalizeCardWidth(width);
    const cardHeight = normalizeCardHeight(height);
    const result = db
      .prepare(
        "UPDATE clusters SET card_width = ?, card_height = ? WHERE id = ? AND user_id = ?",
      )
      .run(cardWidth, cardHeight, clusterId, userId);

    if (result.changes !== 1) throw new Error("Garden not found");

    revalidatePath("/dashboard");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to update garden size",
    );
  }
}

export async function forkCluster(
  sourceSlug: string,
): Promise<{ slug: string }> {
  try {
    const userId = await requireUserId();
    const cleanSourceSlug = sourceSlug.trim();
    if (!cleanSourceSlug) throw new Error("Garden slug is required");

    const source = db
      .prepare(
        `SELECT *
         FROM clusters
         WHERE slug = ?
           AND visibility = 'public'
           AND chat_accessible = 1
           AND fork_allowed = 1`,
      )
      .get(cleanSourceSlug) as ClusterRow | undefined;

    if (!source) throw new Error("This garden cannot be forked");
    if (source.user_id === userId) {
      throw new Error("You already own this garden");
    }

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) throw new Error("QUARTZ_CONTENT_PATH not configured");

    const targetSlug = uniqueClusterSlug(source.name);
    const sourceDir = resolveChildPath(contentPath, source.slug);
    const targetDir = resolveChildPath(contentPath, targetSlug);
    if (!sourceDir || !targetDir) throw new Error("Invalid garden path");
    if (fs.existsSync(targetDir)) throw new Error("Fork target already exists");
    const forkLeases: ReturnType<typeof acquireGardenMutationLease>[] = [];
    try {
      for (const gardenDir of [sourceDir, targetDir].sort((left, right) =>
        left.localeCompare(right),
      )) {
        forkLeases.push(acquireGardenMutationLease(gardenDir, "fork-garden"));
      }
    } catch (error) {
      for (const lease of forkLeases.reverse()) lease.release();
      throw error;
    }

    try {
      if (fs.existsSync(sourceDir)) {
        fs.cpSync(sourceDir, targetDir, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      } else {
        fs.mkdirSync(targetDir, { recursive: true });
        const date = new Date().toISOString().split("T")[0];
        const indexContent = `---\ntitle: ${source.name}\ndate: ${date}\ndescription: ${source.description || ""}\nknowledge_type: "cluster-index"\n---\n`;
        fs.writeFileSync(path.join(targetDir, "_index.md"), indexContent);
      }

      try {
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
             thought_topology_enabled,
             thought_topology_revision
           )
           VALUES (?, ?, ?, ?, 'private', ?, ?, ?, 0, 0, 1, 0)`,
        ).run(
          userId,
          source.name,
          targetSlug,
          source.description,
          normalizeBorderColor(source.border_color),
          normalizeCardWidth(source.card_width),
          normalizeCardHeight(source.card_height),
        );
      } catch (err) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        throw err;
      }

      refreshClusterIndex(contentPath, targetSlug);
    } finally {
      for (const lease of forkLeases.reverse()) lease.release();
    }

    refreshPrivateQuartzIndex(userId);
    await publishQuartzAfterMutation(`fork cluster ${targetSlug}`, {
      userId,
      gardenSlug: targetSlug,
    });
    revalidatePath("/dashboard");
    revalidatePath("/garden");
    revalidatePath(`/gardens/${targetSlug}`);
    revalidatePath(`/garden/${targetSlug}`);

    return { slug: targetSlug };
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to fork garden",
    );
  }
}

export async function deleteCluster(clusterId: number): Promise<void> {
  try {
    const userId = await requireUserId();
    const cluster = db
      .prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?")
      .get(clusterId, userId) as { slug: string } | undefined;

    if (!cluster) return;
    const result = await deleteOwnedGarden({
      clusterId,
      userId,
      gardenSlug: cluster.slug,
    });

    revalidatePath("/dashboard");
    revalidatePath(`/gardens/${cluster.slug}`);
    revalidatePath(`/garden/${cluster.slug}`);
    revalidatePath("/garden");
    after(async () => {
      try {
        await finalizeGardenDeletion(result);
      } catch (error) {
        console.error(
          `[garden-delete] Background publication failed for ${cluster.slug}:`,
          error,
        );
      }
    });
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to delete garden",
    );
  }
}

export async function getCluster(
  userId: number,
  slug: string,
): Promise<Cluster | undefined> {
  try {
    const row = db
      .prepare("SELECT * FROM clusters WHERE user_id = ? AND slug = ?")
      .get(userId, slug) as ClusterRow | undefined;

    if (!row) return undefined;
    const contentPath = process.env.QUARTZ_CONTENT_PATH ?? "";
    return toCluster(row, countNotes(contentPath, row.slug), userId);
  } catch {
    return undefined;
  }
}

export async function getReadableCluster(
  userId: number,
  slug: string,
): Promise<Cluster | undefined> {
  try {
    const row = db
      .prepare(
        `SELECT c.*, u.email AS ownerEmail, u.username AS ownerUsername,
                o.name AS organizationName
         FROM clusters c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN organizations o ON o.id = c.organization_id
         WHERE c.slug = ?
           AND (c.user_id = ? OR c.visibility = 'public'
                OR ${organizationClusterClause(userId, "c")})`,
      )
      .get(slug, userId) as ClusterRow | undefined;

    if (!row) return undefined;
    const contentPath = process.env.QUARTZ_CONTENT_PATH ?? "";
    return toCluster(row, countNotes(contentPath, row.slug), userId);
  } catch {
    return undefined;
  }
}
