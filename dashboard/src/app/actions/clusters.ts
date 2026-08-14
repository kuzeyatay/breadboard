"use server";

import db from "@/lib/db";
import fs from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { refreshClusterIndex } from "@/lib/knowledge";
import {
  refreshPrivateQuartzIndex,
  refreshPublicQuartzIndex,
} from "@/lib/quartz-garden-index";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import { requireUserId } from "@/lib/server-auth";
import { uniqueGardenSlug } from "@/lib/garden-slug";
import {
  createFolder,
  deleteFolder,
  ensureFolderPath,
  listFolders,
  moveFolder,
  normalizeFolderPath,
  renameFolder,
} from "@/lib/cluster-folders";

export interface Cluster {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: ClusterVisibility;
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
}

export type ClusterVisibility = "private" | "public";

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
  | "border_color"
  | "card_width"
  | "card_height"
  | "chat_accessible"
  | "fork_allowed"
  | "view_count"
  | "last_viewed_at"
  | "repo_connected"
  | "repo_name"
> & {
  visibility?: string | null;
  border_color?: string | null;
  card_width?: number | null;
  card_height?: number | null;
  chat_accessible?: number | null;
  fork_allowed?: number | null;
  view_count?: number | null;
  last_viewed_at?: string | null;
  repo_path?: string | null;
};

function normalizeVisibility(
  value: string | null | undefined,
): ClusterVisibility {
  return value === "public" ? "public" : "private";
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

function countNotes(contentPath: string, slug: string): number {
  try {
    const dir = path.join(contentPath, slug);
    if (!fs.existsSync(dir)) return 0;
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && f !== "_index.md").length;
  } catch {
    return 0;
  }
}

function toCluster(
  row: ClusterRow,
  noteCount: number,
  userId?: number,
): Cluster {
  const { repo_path: repoPath, ...safeRow } = row;
  const isOwner =
    typeof userId === "number" ? row.user_id === userId : Boolean(row.isOwner);
  return {
    ...safeRow,
    visibility: normalizeVisibility(row.visibility),
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

function removeChildPath(parentPath: string, childName: string): void {
  const child = resolveChildPath(parentPath, childName);
  if (child && fs.existsSync(child)) {
    fs.rmSync(child, { recursive: true, force: true });
  }
}

function quartzPublicPathFor(contentPath: string): string {
  return path.join(path.dirname(path.resolve(contentPath)), "public");
}

function deletedClusterRedirectHtml(): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=/">
<title>Garden deleted</title>
<script>window.location.replace('/');</script>
<body style="margin:0;background:#161618;color:#ebebec;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center">
  <main style="max-width:32rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.5rem;margin:0 0 .75rem">This garden was deleted.</h1>
    <p style="color:#646464;margin:0 0 1.25rem">Taking you back to the garden home.</p>
    <a href="/" style="color:#7b97aa">Open garden home</a>
  </main>
</body>
`;
}

function writeDeletedClusterRedirect(
  contentPath: string,
  clusterSlug: string,
): void {
  const publicPath = quartzPublicPathFor(contentPath);
  const clusterDir = resolveChildPath(publicPath, clusterSlug);
  const clusterHtml = resolveChildPath(publicPath, `${clusterSlug}.html`);
  if (!clusterDir || !clusterHtml) return;

  fs.mkdirSync(publicPath, { recursive: true });
  fs.rmSync(clusterDir, { recursive: true, force: true });
  fs.mkdirSync(clusterDir, { recursive: true });

  const html = deletedClusterRedirectHtml();
  fs.writeFileSync(path.join(clusterDir, "index.html"), html, "utf-8");
  fs.writeFileSync(clusterHtml, html, "utf-8");
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
): Promise<string> {
  try {
    const userId = await requireUserId();
    const slug = uniqueClusterSlug(name);

    db.prepare(
      "INSERT INTO clusters (user_id, name, slug, description, visibility, border_color) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, name, slug, description, "private", DEFAULT_BORDER_COLOR);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (contentPath) {
      const clusterDir = path.join(contentPath, slug);
      fs.mkdirSync(clusterDir, { recursive: true });
      const date = new Date().toISOString().split("T")[0];
      const indexContent = `---\ntitle: ${name}\ndate: ${date}\ndescription: ${description || ""}\nknowledge_type: "cluster-index"\n---\n`;
      fs.writeFileSync(path.join(clusterDir, "_index.md"), indexContent);
      refreshClusterIndex(contentPath, slug);
    }

    refreshPrivateQuartzIndex(userId);
    await publishQuartzAfterMutation(`create cluster ${slug}`);
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

    db.prepare(
      "UPDATE clusters SET name = ?, description = ? WHERE id = ? AND user_id = ?",
    ).run(cleanName, cleanDescription, clusterId, userId);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (contentPath) {
      const clusterDir = path.join(contentPath, cluster.slug);
      fs.mkdirSync(clusterDir, { recursive: true });
      const date = new Date().toISOString().split("T")[0];
      const indexContent = `---\ntitle: ${JSON.stringify(cleanName)}\ndate: ${date}\ndescription: ${JSON.stringify(cleanDescription)}\nknowledge_type: "cluster-index"\n---\n`;
      fs.writeFileSync(path.join(clusterDir, "_index.md"), indexContent);
      refreshClusterIndex(contentPath, cluster.slug);
    }

    refreshPrivateQuartzIndex(userId);
    refreshPublicQuartzIndex();
    await publishQuartzAfterMutation(`update cluster ${cluster.slug}`);
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
): Promise<void> {
  try {
    const userId = await requireUserId();
    const nextVisibility = normalizeVisibility(visibility);
    const cluster = db
      .prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?")
      .get(clusterId, userId) as { slug: string } | undefined;
    if (!cluster) throw new Error("Garden not found");

    const result = db
      .prepare(
        "UPDATE clusters SET visibility = ? WHERE id = ? AND user_id = ?",
      )
      .run(nextVisibility, clusterId, userId);

    if (result.changes !== 1) throw new Error("Garden not found");

    refreshPrivateQuartzIndex(userId);
    refreshPublicQuartzIndex();
    const scope = nextVisibility === "public" ? "publish" : "unpublish";
    await publishQuartzAfterMutation(`${scope} cluster ${cluster.slug}`);
    revalidatePath("/dashboard");
    revalidatePath("/garden");
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Failed to update garden visibility",
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
): Promise<{ connected: true; repoName: string }> {
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
      .prepare(
        "UPDATE clusters SET repo_path = ? WHERE id = ? AND user_id = ?",
      )
      .run(resolvedPath, clusterId, userId);
    if (result.changes !== 1) throw new Error("Garden not found");

    revalidatePath("/dashboard");
    return { connected: true, repoName: path.basename(resolvedPath) };
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Failed to connect repository",
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
           fork_allowed
         )
         VALUES (?, ?, ?, ?, 'private', ?, ?, ?, 0, 0)`,
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
    refreshPrivateQuartzIndex(userId);
    await publishQuartzAfterMutation(`fork cluster ${targetSlug}`);
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

    db.prepare("DELETE FROM clusters WHERE id = ? AND user_id = ?").run(
      clusterId,
      userId,
    );

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (contentPath) {
      removeChildPath(contentPath, cluster.slug);
      writeDeletedClusterRedirect(contentPath, cluster.slug);

      const remaining = db
        .prepare("SELECT slug FROM clusters WHERE user_id = ?")
        .all(userId) as { slug: string }[];
      for (const { slug } of remaining) {
        try {
          refreshClusterIndex(contentPath, slug);
        } catch {
          /* skip */
        }
      }
    }

    revalidatePath("/dashboard");
    revalidatePath(`/gardens/${cluster.slug}`);
    revalidatePath(`/garden/${cluster.slug}`);
    revalidatePath("/garden");
    refreshPrivateQuartzIndex(userId);
    refreshPublicQuartzIndex();
    await publishQuartzAfterMutation(`delete cluster ${cluster.slug}`);
    if (contentPath) {
      writeDeletedClusterRedirect(contentPath, cluster.slug);
    }
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
        `SELECT c.*, u.email AS ownerEmail, u.username AS ownerUsername
         FROM clusters c
         JOIN users u ON u.id = c.user_id
         WHERE c.slug = ? AND (c.user_id = ? OR c.visibility = 'public')`,
      )
      .get(slug, userId) as ClusterRow | undefined;

    if (!row) return undefined;
    const contentPath = process.env.QUARTZ_CONTENT_PATH ?? "";
    return toCluster(row, countNotes(contentPath, row.slug), userId);
  } catch {
    return undefined;
  }
}
