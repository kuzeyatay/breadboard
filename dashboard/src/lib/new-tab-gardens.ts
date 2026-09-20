import type Database from "better-sqlite3";
import { countClusterMarkdownAsync, gardenDirectory } from "./garden-directory.ts";
import { cachedGardenNoteCountAsync, readCachedGardenNoteCount } from "./garden-note-count-cache.ts";

export interface NewTabGarden {
  slug: string;
  name: string;
  noteCount: number | null;
  lastViewedAt: string | null;
  borderColor: string;
}

/** The launcher needs names and links, not the Garden mutation/ingestion graph. */
export function readNewTabGardens(
  db: Pick<Database.Database, "prepare">,
  userId: number,
  contentPath = process.env.QUARTZ_CONTENT_PATH ?? "",
): NewTabGarden[] {
  const rows = db.prepare(`
    SELECT slug, name, last_viewed_at AS lastViewedAt, border_color AS borderColor
    FROM clusters WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId) as Omit<NewTabGarden, "noteCount">[];
  return rows.map(row => ({
    ...row,
    borderColor: /^#[0-9a-fA-F]{6}$/.test(row.borderColor ?? "") ? row.borderColor : "#a9c1b1",
    noteCount: readCachedGardenNoteCount(contentPath, row.slug),
  }));
}

/** Called after the launcher is usable. Directory IO yields between reads. */
export async function refreshNewTabGardenCounts(
  gardens: NewTabGarden[],
  contentPath = process.env.QUARTZ_CONTENT_PATH ?? "",
): Promise<NewTabGarden[]> {
  if (!contentPath) return gardens;
  const refreshed: NewTabGarden[] = [];
  for (const garden of gardens) {
    let noteCount = garden.noteCount;
    try {
      noteCount = await cachedGardenNoteCountAsync(contentPath, garden.slug,
        () => countClusterMarkdownAsync(gardenDirectory(garden.slug, contentPath)));
    } catch {
      // Keep the last known count when a Garden is temporarily unavailable.
    }
    refreshed.push({ ...garden, noteCount });
  }
  return refreshed;
}
