/**
 * A garden's slug is simultaneously its URL, its directory name under
 * QUARTZ_CONTENT_PATH, and a globally UNIQUE column — so every path that
 * creates a garden (new, fork, import) has to derive it the same way. This is
 * that one derivation.
 *
 * It takes the database as a parameter rather than importing it so it stays
 * usable from a `"use server"` module, which may only export async functions.
 */

interface SlugStatement {
  get(...params: unknown[]): unknown;
}

export interface SlugDatabase {
  prepare(sql: string): SlugStatement;
}

export function slugifyGardenName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "garden";
}

/** The slugified name, suffixed until no `clusters` row holds it. */
export function uniqueGardenSlug(db: SlugDatabase, name: string): string {
  const base = slugifyGardenName(name);
  let slug = base;
  let counter = 2;

  while (db.prepare("SELECT 1 FROM clusters WHERE slug = ?").get(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }

  return slug;
}
