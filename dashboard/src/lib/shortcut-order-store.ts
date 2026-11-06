import type Database from "better-sqlite3";
import { normalizeShortcutOrder, validShortcutOrder } from "./shortcut-order.ts";

const initialized = new WeakSet<Database.Database>();
function ensure(db: Database.Database) {
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS browser_shortcut_order (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    urls TEXT NOT NULL
  )`);
  initialized.add(db);
}
export function readShortcutOrder(db: Database.Database, userId: number): string[] {
  ensure(db);
  const row = db.prepare("SELECT urls FROM browser_shortcut_order WHERE user_id=?").get(userId) as {urls:string} | undefined;
  try { return normalizeShortcutOrder(JSON.parse(row?.urls ?? "[]")); } catch { return []; }
}
export function writeShortcutOrder(db: Database.Database, userId: number, value: unknown): string[] {
  if (!validShortcutOrder(value)) throw new Error("Invalid shortcut order.");
  ensure(db);
  const order = normalizeShortcutOrder(value);
  db.prepare("INSERT INTO browser_shortcut_order(user_id,urls) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET urls=excluded.urls").run(userId, JSON.stringify(order));
  return order;
}
