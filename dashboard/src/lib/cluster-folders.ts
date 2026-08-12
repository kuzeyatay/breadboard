/**
 * Clusters nest like folders.
 *
 * Rather than a self-referential table, a cluster is identified by its
 * materialized path — "EE Year 1/Semester 2/Circuits" — stored in the two
 * columns that already existed: `cluster_folders.name` (the registry of
 * clusters, so an empty one survives a reload) and `clusters.folder` (which
 * cluster a garden sits in). Every reader that treats those values as an opaque
 * label keeps working; only the code that wants the tree splits on the
 * separator.
 *
 * Moves, renames and deletes are therefore prefix rewrites over a subtree,
 * which is what the SQL below does. This module deliberately imports nothing
 * from Next.js or `@/lib/db` so it stays directly testable.
 */

export const FOLDER_SEPARATOR = "/";
export const MAX_FOLDER_DEPTH = 8;

interface FolderStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface FolderDatabase {
  prepare(sql: string): FolderStatement;
  transaction(fn: () => void): () => void;
}

/** One path segment: no separators, collapsed whitespace, bounded length. */
export function normalizeFolderName(value: string | null | undefined): string {
  return (value ?? "")
    .split(FOLDER_SEPARATOR)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** A full path, normalized segment by segment, with empties and excess depth dropped. */
export function normalizeFolderPath(value: string | null | undefined): string {
  return (value ?? "")
    .split(FOLDER_SEPARATOR)
    .map((segment) => normalizeFolderName(segment))
    .filter(Boolean)
    .slice(0, MAX_FOLDER_DEPTH)
    .join(FOLDER_SEPARATOR);
}

export function joinFolderPath(
  parent: string | null | undefined,
  name: string | null | undefined,
): string {
  const cleanParent = normalizeFolderPath(parent);
  const cleanName = normalizeFolderName(name);
  if (!cleanName) return "";
  return normalizeFolderPath(
    cleanParent ? `${cleanParent}${FOLDER_SEPARATOR}${cleanName}` : cleanName,
  );
}

/** "A/B/C" -> ["A", "A/B", "A/B/C"], so a deep path always registers its ancestors. */
export function folderPathChain(value: string | null | undefined): string[] {
  const segments = (value ?? "").split(FOLDER_SEPARATOR).filter(Boolean);
  return segments.map((_, index) =>
    segments.slice(0, index + 1).join(FOLDER_SEPARATOR),
  );
}

export function folderLabel(value: string): string {
  return value.split(FOLDER_SEPARATOR).filter(Boolean).pop() ?? value;
}

export function folderParent(value: string): string {
  const segments = value.split(FOLDER_SEPARATOR).filter(Boolean);
  return segments.slice(0, -1).join(FOLDER_SEPARATOR);
}

/** True when `folder` is `root` itself or sits anywhere beneath it. */
export function isInSubtree(
  folder: string | null | undefined,
  root: string,
): boolean {
  if (!root) return false;
  const value = folder ?? "";
  return value === root || value.startsWith(`${root}${FOLDER_SEPARATOR}`);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Bind values for `col = ? OR col LIKE ? ESCAPE '\'` — a path and its descendants. */
function subtreeParams(folder: string): [string, string] {
  return [folder, `${escapeLike(folder)}${FOLDER_SEPARATOR}%`];
}

export function ensureFolderPath(
  db: FolderDatabase,
  userId: number,
  folder: string,
): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO cluster_folders (user_id, name) VALUES (?, ?)",
  );
  for (const ancestor of folderPathChain(folder)) insert.run(userId, ancestor);
}

/** A path is taken if a cluster is registered at it, or a garden already sits under it. */
export function folderPathExists(
  db: FolderDatabase,
  userId: number,
  folder: string,
): boolean {
  if (!folder) return false;
  const registered = db
    .prepare("SELECT 1 FROM cluster_folders WHERE user_id = ? AND name = ?")
    .get(userId, folder);
  if (registered) return true;
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM clusters WHERE user_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')",
      )
      .get(userId, ...subtreeParams(folder)),
  );
}

/** Depth in segments of the deepest path at or under `folder` (0 when nothing is there). */
export function subtreeDepth(
  db: FolderDatabase,
  userId: number,
  folder: string,
): number {
  const separators = (column: string) =>
    `LENGTH(${column}) - LENGTH(REPLACE(${column}, '${FOLDER_SEPARATOR}', ''))`;
  const row = db
    .prepare(
      `SELECT MAX(depth) AS depth FROM (
         SELECT ${separators("name")} AS depth
           FROM cluster_folders
          WHERE user_id = ? AND (name = ? OR name LIKE ? ESCAPE '\\')
         UNION ALL
         SELECT ${separators("folder")} AS depth
           FROM clusters
          WHERE user_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')
       )`,
    )
    .get(
      userId,
      ...subtreeParams(folder),
      userId,
      ...subtreeParams(folder),
    ) as { depth: number | null } | undefined;
  const separatorCount = row?.depth;
  return separatorCount == null ? 0 : Number(separatorCount) + 1;
}

/**
 * Rewrite a subtree's prefix in both tables. `substr` is 1-indexed, so
 * `from.length + 1` lands on the separator that follows the moved prefix.
 */
function moveFolderSubtree(
  db: FolderDatabase,
  userId: number,
  from: string,
  to: string,
): void {
  const [exact, descendants] = subtreeParams(from);
  const suffixStart = from.length + 1;

  db.prepare(
    `UPDATE cluster_folders
        SET name = ? || substr(name, ?)
      WHERE user_id = ? AND name LIKE ? ESCAPE '\\'`,
  ).run(to, suffixStart, userId, descendants);
  db.prepare(
    "UPDATE cluster_folders SET name = ? WHERE user_id = ? AND name = ?",
  ).run(to, userId, exact);

  db.prepare(
    `UPDATE clusters
        SET folder = ? || substr(folder, ?)
      WHERE user_id = ? AND folder LIKE ? ESCAPE '\\'`,
  ).run(to, suffixStart, userId, descendants);
  db.prepare(
    "UPDATE clusters SET folder = ? WHERE user_id = ? AND folder = ?",
  ).run(to, userId, exact);
}

/** Every cluster path the user has, each expanded into its ancestor chain. */
export function listFolders(db: FolderDatabase, userId: number): string[] {
  const registered = db
    .prepare("SELECT name FROM cluster_folders WHERE user_id = ?")
    .all(userId) as { name: string }[];
  const assigned = db
    .prepare(
      "SELECT DISTINCT folder AS name FROM clusters WHERE user_id = ? AND folder IS NOT NULL AND folder <> ''",
    )
    .all(userId) as { name: string }[];

  const names = new Set<string>();
  for (const row of [...registered, ...assigned]) {
    for (const ancestor of folderPathChain(normalizeFolderPath(row.name))) {
      names.add(ancestor);
    }
  }
  return [...names].sort(compareFolderPaths);
}

/**
 * Every distinct path in `values`, expanded into ancestor chains and ordered
 * depth-first. An intermediate cluster therefore always appears, even when only
 * its deepest descendant was ever stored.
 */
export function expandFolderPaths(
  values: Iterable<string | null | undefined>,
): string[] {
  const names = new Set<string>();
  for (const value of values) {
    for (const ancestor of folderPathChain(value)) names.add(ancestor);
  }
  return [...names].sort(compareFolderPaths);
}

/**
 * The rows a tree view should draw: depth-first, with anything under a collapsed
 * ancestor omitted. `folders` is expected to already include ancestor chains.
 */
export function visibleFolderRows(
  folders: string[],
  isExpanded: (folder: string) => boolean,
): { folder: string; depth: number }[] {
  return [...folders]
    .sort(compareFolderPaths)
    .map((folder) => ({ folder, chain: folderPathChain(folder) }))
    .filter(({ chain }) => chain.slice(0, -1).every(isExpanded))
    .map(({ folder, chain }) => ({ folder, depth: chain.length - 1 }));
}

/** Depth-first order. A plain string sort would put "A B" between "A" and "A/B". */
export function compareFolderPaths(a: string, b: string): number {
  const left = a.split(FOLDER_SEPARATOR);
  const right = b.split(FOLDER_SEPARATOR);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const cmp = left[i].localeCompare(right[i]);
    if (cmp !== 0) return cmp;
  }
  return left.length - right.length;
}

/**
 * `normalizeFolderPath` truncates at the cap, which would silently drop the new
 * leaf and resolve to its parent. Reject before joining so nesting too deep is
 * an error the user sees rather than a no-op.
 */
function assertFitsUnder(parent: string, added: number): void {
  if (folderPathChain(parent).length + added > MAX_FOLDER_DEPTH) {
    throw new Error(`Clusters can only nest ${MAX_FOLDER_DEPTH} levels deep`);
  }
}

export function createFolder(
  db: FolderDatabase,
  userId: number,
  name: string,
  parent: string | null | undefined,
): void {
  const cleanParent = normalizeFolderPath(parent);
  if (!normalizeFolderName(name)) throw new Error("Cluster name is required");
  assertFitsUnder(cleanParent, 1);

  const folder = joinFolderPath(cleanParent, name);
  if (!folder) throw new Error("Cluster name is required");
  if (folderPathExists(db, userId, folder)) {
    throw new Error("A cluster with this name already exists here");
  }
  ensureFolderPath(db, userId, folder);
}

function relocate(
  db: FolderDatabase,
  userId: number,
  from: string,
  to: string,
): void {
  if (folderPathExists(db, userId, to)) {
    throw new Error("A cluster with this name already exists here");
  }
  // The deepest descendant has to fit under the new parent too, not just the
  // cluster being dragged.
  const fromDepth = folderPathChain(from).length;
  const deepest = Math.max(subtreeDepth(db, userId, from), fromDepth);
  assertFitsUnder(folderParent(to), deepest - fromDepth + 1);

  db.transaction(() => {
    ensureFolderPath(db, userId, from);
    moveFolderSubtree(db, userId, from, to);
    ensureFolderPath(db, userId, to);
  })();
}

/** Rename a cluster in place; its nested clusters and gardens come along. */
export function renameFolder(
  db: FolderDatabase,
  userId: number,
  oldPath: string,
  newName: string,
): void {
  const from = normalizeFolderPath(oldPath);
  const to = joinFolderPath(folderParent(from), newName);
  if (!from || !to) throw new Error("Cluster name is required");
  if (from === to) return;
  relocate(db, userId, from, to);
}

/** Re-parent a cluster. A null/empty target moves it back to the top level. */
export function moveFolder(
  db: FolderDatabase,
  userId: number,
  sourcePath: string,
  targetParent: string | null | undefined,
): void {
  const from = normalizeFolderPath(sourcePath);
  if (!from) throw new Error("Cluster is required");
  const parent = normalizeFolderPath(targetParent);
  if (parent === from || isInSubtree(parent, from)) {
    throw new Error("A cluster cannot be moved inside itself");
  }
  assertFitsUnder(parent, 1);

  const to = joinFolderPath(parent, folderLabel(from));
  if (!to) throw new Error("Cluster is required");
  if (from === to) return;
  relocate(db, userId, from, to);
}

/** Delete a cluster and every cluster nested in it. Gardens survive, unfiled. */
export function deleteFolder(
  db: FolderDatabase,
  userId: number,
  name: string,
): void {
  const folder = normalizeFolderPath(name);
  if (!folder) throw new Error("Cluster name is required");
  const params = subtreeParams(folder);

  db.transaction(() => {
    db.prepare(
      "UPDATE clusters SET folder = NULL WHERE user_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')",
    ).run(userId, ...params);
    db.prepare(
      "DELETE FROM cluster_folders WHERE user_id = ? AND (name = ? OR name LIKE ? ESCAPE '\\')",
    ).run(userId, ...params);
  })();
}
