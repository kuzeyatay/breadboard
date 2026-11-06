import type Database from "better-sqlite3";
import { validBrowserQuoteChoice } from "../app/browser/browser-daily-quotes.ts";

const initialized = new WeakSet<Database.Database>();
function ensure(db: Database.Database) {
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS browser_quote_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    quote_id TEXT NOT NULL
  )`);
  initialized.add(db);
}
export function readBrowserQuoteChoice(db: Database.Database, userId: number): string {
  ensure(db);
  const row = db.prepare("SELECT quote_id FROM browser_quote_preferences WHERE user_id=?").get(userId) as {quote_id: string} | undefined;
  return validBrowserQuoteChoice(row?.quote_id) ? row.quote_id : "daily";
}
export function writeBrowserQuoteChoice(db: Database.Database, userId: number, choice: string): string {
  if (!validBrowserQuoteChoice(choice)) throw new Error("Choose a valid quote.");
  ensure(db);
  db.prepare("INSERT INTO browser_quote_preferences(user_id,quote_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET quote_id=excluded.quote_id").run(userId,choice);
  return choice;
}
