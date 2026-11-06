import type Database from "better-sqlite3";
import { parse } from "yaml";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { gardenDirectory } from "./garden-directory.ts";
import { INTERNAL_CONCEPT_FOLDER } from "./learning-garden.ts";

type Db = Database.Database;
const freshnessMs = 15_000;
const states = new WeakMap<Db, Map<string, { checked: number; pending?: Promise<void> }>>();

function ensureIndex(db: Db) {
  if (states.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS launcher_search_pages (
      id INTEGER PRIMARY KEY, root TEXT NOT NULL, garden TEXT NOT NULL,
      path TEXT NOT NULL, stamp TEXT NOT NULL, title TEXT NOT NULL,
      kind TEXT NOT NULL, UNIQUE(root, garden, path)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS launcher_search_fts USING fts5(
      title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
    );
  `);
  states.set(db, new Map());
}

/** An incremental local full-text index, independent of AI/embedding services. */
export async function refreshSearchGarden(db: Db, root: string, garden: string, now = Date.now(), identity = garden): Promise<void> {
  ensureIndex(db);
  const cache = states.get(db)!;
  // A deleted/recreated garden can reuse a slug. Its new owner must never
  // inherit a fresh cache entry from the previous garden at that path.
  const key = JSON.stringify([root, garden, identity]);
  const previous = cache.get(key);
  if (previous?.pending) return previous.pending;
  if (previous && now - previous.checked < freshnessMs) return;
  const state: { checked: number; pending?: Promise<void> } = { checked: 0 };
  const pending = syncGarden(db, root, garden);
  state.pending = pending;
  cache.set(key, state);
  try {
    await pending;
    state.checked = now;
    state.pending = undefined;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function syncGarden(db: Db, root: string, garden: string) {
  const directory = gardenDirectory(garden, root);
  // A garden root must be an actual child directory, not a symlink to another
  // user's tree. Descendant symlinks are ignored by the directory walker too.
  const rootReal = await fs.promises.realpath(root);
  let present = true;
  try {
    const stat = await fs.promises.lstat(directory);
    const directoryReal = await fs.promises.realpath(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || directoryReal === rootReal ||
      path.dirname(directoryReal) !== rootReal) throw new Error("Invalid garden directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    present = false;
  }
  const existing = new Map((db.prepare(
    "SELECT id, path, stamp FROM launcher_search_pages WHERE root = ? AND garden = ?",
  ).all(root, garden) as { id: number; path: string; stamp: string }[]).map(row => [row.path, row]));
  const seen = new Set<string>();
  const files: string[] = [];
  async function walk(dir: string, depth: number) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === "assets" || (depth === 0 && entry.name === INTERNAL_CONCEPT_FOLDER.split("/")[0])) continue;
        await walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && /\.md$/i.test(entry.name) && !/^_?index\.md$/i.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  }
  if (present) await walk(directory, 0);
  const upsert = db.prepare(`INSERT INTO launcher_search_pages (root, garden, path, stamp, title, kind)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(root, garden, path)
    DO UPDATE SET stamp = excluded.stamp, title = excluded.title, kind = excluded.kind RETURNING id`);
  const deleteFts = db.prepare("DELETE FROM launcher_search_fts WHERE rowid = ?");
  const insertFts = db.prepare("INSERT INTO launcher_search_fts(rowid, title, body) VALUES (?, ?, ?)");
  // Bound file handles and yield while reading. Only changed pages are read or
  // reindexed; simultaneous queries share this refresh.
  for (let offset = 0; offset < files.length; offset += 16) {
    const changes = await Promise.all(files.slice(offset, offset + 16).map(async file => {
      const relative = path.relative(directory, file).replace(/\\/g, "/");
      const stat = await fs.promises.stat(file);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      seen.add(relative);
      if (existing.get(relative)?.stamp === stamp) return null;
      const markdown = await fs.promises.readFile(file, "utf8");
      const front = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      let metadata: Record<string, unknown> = {};
      if (front) {
        try { const parsed = parse(front[1], { maxAliasCount: 20 }); if (parsed && typeof parsed === "object") metadata = parsed; }
        catch { /* A malformed header must not hide an otherwise readable note. */ }
      }
      const body = front ? markdown.slice(front[0].length) : markdown;
      const title = typeof metadata.title === "string" ? metadata.title :
        body.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(file, ".md").replace(/[-_]/g, " ");
      const kind = metadata.knowledge_type === "source-document" || relative.startsWith("sources/") ? "file" : "note";
      const tags = Array.isArray(metadata.tags) ? metadata.tags.filter(tag => typeof tag === "string").join(" ") : "";
      return { relative, stamp, title, kind, body: `${body}\n${tags}` };
    }));
    db.transaction(() => {
      for (const change of changes) {
        if (!change) continue;
        const row = upsert.get(root, garden, change.relative, change.stamp, change.title, change.kind) as { id: number };
        deleteFts.run(row.id);
        insertFts.run(row.id, change.title, change.body);
      }
    })();
  }
  const remove = db.prepare("DELETE FROM launcher_search_pages WHERE id = ?");
  db.transaction(() => {
    for (const [relative, row] of existing) {
      if (seen.has(relative)) continue;
      deleteFts.run(row.id);
      remove.run(row.id);
    }
  })();
}

export interface IndexedSearchPage { garden: string; path: string; title: string; kind: "note" | "file"; excerpt: string }

export function searchIndexedPages(db: Db, root: string, gardens: string[], terms: string[], kind: "note" | "file", limit: number): IndexedSearchPage[] {
  if (!gardens.length || !terms.length) return [];
  ensureIndex(db);
  // Terms are tokens, never user-authored FTS syntax; all scope values are bound.
  const query = terms.map(term => `"${term.replace(/"/g, '""')}"*`).join(" AND ");
  return db.prepare(`SELECT p.garden, p.path, p.title, p.kind,
    snippet(launcher_search_fts, 1, '', '', '…', 36) AS excerpt
    FROM launcher_search_fts JOIN launcher_search_pages p ON p.id = launcher_search_fts.rowid
    WHERE launcher_search_fts MATCH ? AND p.root = ? AND p.kind = ? AND p.garden IN (${gardens.map(() => "?").join(",")})
    ORDER BY bm25(launcher_search_fts, 8.0, 1.0), p.id LIMIT ?
  `).all(query, root, kind, ...gardens, limit) as IndexedSearchPage[];
}
