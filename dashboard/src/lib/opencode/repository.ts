import db from "@/lib/db.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";

export interface ConnectedRepository {
  gardenSlug: string;
  gardenName: string;
  path: string;
  name: string;
}

interface RepositoryRow {
  slug: string;
  name: string;
  repo_path: string | null;
}

export function resolveConnectedRepository(
  userId: number,
  gardenSlug?: string | null,
): ConnectedRepository {
  const requestedSlug = gardenSlug?.trim();
  const rows = requestedSlug
    ? (db
        .prepare(
          `SELECT slug, name, repo_path
           FROM clusters
           WHERE user_id = ? AND slug = ?`,
        )
        .all(userId, requestedSlug) as RepositoryRow[])
    : (db
        .prepare(
          `SELECT slug, name, repo_path
           FROM clusters
           WHERE user_id = ? AND repo_path IS NOT NULL AND repo_path <> ''
           ORDER BY created_at DESC`,
        )
        .all(userId) as RepositoryRow[]);

  if (requestedSlug && rows.length === 0) throw new Error("garden_not_found");
  const connected = rows.filter((row) => Boolean(row.repo_path));
  if (connected.length === 0) throw new Error("repository_not_connected");
  if (!requestedSlug && connected.length > 1) throw new Error("garden_required");

  const row = connected[0];
  const repositoryPath = fs.realpathSync(path.resolve(row.repo_path!));
  if (
    !fs.statSync(repositoryPath).isDirectory() ||
    !fs.existsSync(path.join(repositoryPath, ".git"))
  ) {
    throw new Error("repository_unavailable");
  }
  return {
    gardenSlug: row.slug,
    gardenName: row.name,
    path: repositoryPath,
    name: path.basename(repositoryPath),
  };
}
