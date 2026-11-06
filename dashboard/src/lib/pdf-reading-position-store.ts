import type Database from "better-sqlite3";
import { pdfReadingPositionKey, validPdfPage } from "./pdf-reading-position.ts";

export function ensurePdfReadingPositionSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS pdf_reading_positions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    page INTEGER NOT NULL CHECK(page >= 1),
    observed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, source)
  )`);
}

export function readPdfReadingPosition(db: Database.Database, userId: number, source: string): number | null {
  const key = pdfReadingPositionKey(source);
  if (!key) throw new Error("Invalid PDF source");
  const row = db.prepare("SELECT page FROM pdf_reading_positions WHERE user_id = ? AND source = ?")
    .get(userId, key) as { page: number } | undefined;
  return row?.page ?? null;
}

export function writePdfReadingPosition(
  db: Database.Database, userId: number, source: string, page: number, observedAt: number,
): void {
  const key = pdfReadingPositionKey(source);
  if (!key || !validPdfPage(page) || !Number.isSafeInteger(observedAt) || observedAt < 1) {
    throw new Error("Invalid PDF reading position");
  }
  // Requests can finish out of order when scrolling quickly or closing a tab.
  db.prepare(`INSERT INTO pdf_reading_positions (user_id, source, page, observed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, source) DO UPDATE SET page = excluded.page, observed_at = excluded.observed_at
    WHERE excluded.observed_at >= pdf_reading_positions.observed_at`).run(userId, key, page, observedAt);
}
