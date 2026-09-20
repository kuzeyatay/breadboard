import type DatabaseType from "better-sqlite3";
import { understandingPageSlug, type PageUnderstanding } from "./page-understanding-types.ts";

/** Personal self-reports survive page publication and never impersonate FSRS grades. */
export class PageUnderstandingStore {
  private readonly db: DatabaseType.Database;

  constructor(db: DatabaseType.Database) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS page_understanding (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      garden_slug TEXT NOT NULL,
      page_slug TEXT NOT NULL,
      understood INTEGER NOT NULL CHECK (understood IN (0, 1)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, garden_slug, page_slug)
    )`);
  }

  list(userId: number, gardenSlug: string): PageUnderstanding[] {
    const rows = this.db.prepare(`SELECT page_slug, understood, updated_at FROM page_understanding
      WHERE user_id = ? AND garden_slug = ? ORDER BY page_slug`).all(userId, gardenSlug) as
      Array<{ page_slug: string; understood: number; updated_at: string }>;
    return rows.map(row => ({ pageSlug: row.page_slug, understood: row.understood === 1, updatedAt: row.updated_at }));
  }

  get(userId: number | null | undefined, gardenSlug: string, pageSlug: string): PageUnderstanding | null {
    if (!userId) return null;
    const key = understandingPageSlug(pageSlug);
    const row = this.db.prepare(`SELECT understood, updated_at FROM page_understanding
      WHERE user_id = ? AND garden_slug = ? AND page_slug = ?`).get(userId, gardenSlug, key) as
      { understood: number; updated_at: string } | undefined;
    return row ? { pageSlug: key, understood: row.understood === 1, updatedAt: row.updated_at } : null;
  }

  set(userId: number, gardenSlug: string, pageSlug: string, understood: boolean): PageUnderstanding {
    const key = understandingPageSlug(pageSlug);
    if (!key || key.length > 1000 || key.split("/").some(part => !part || part.startsWith(".") || part.includes(":"))) {
      throw new Error("Invalid page path.");
    }
    if (typeof understood !== "boolean") throw new Error("understood must be a boolean.");
    this.db.prepare(`INSERT INTO page_understanding (user_id, garden_slug, page_slug, understood, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, garden_slug, page_slug) DO UPDATE SET
        understood = excluded.understood, updated_at = excluded.updated_at
      WHERE page_understanding.understood != excluded.understood`)
      .run(userId, gardenSlug, key, understood ? 1 : 0, new Date().toISOString());
    return this.get(userId, gardenSlug, key)!;
  }
}
