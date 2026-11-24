// Standing "always allow" rules for terminal commands, per user. A rule is a
// command prefix (see terminal-command-prefix.ts) the user approved from a
// permission card; later commands with that prefix skip the card.

import type DatabaseType from "better-sqlite3";

import db from "../db.ts";
import { commandMatchesPrefix, commandRulePrefix } from "./terminal-command-prefix.ts";

type Db = DatabaseType.Database;

export interface TerminalCommandRule {
  id: number;
  prefix: string[];
  createdAt: string;
}

let schemaReady = false;

function handle(database?: Db): Db {
  const target = database ?? db;
  if (database || !schemaReady) {
    target.exec(`
      CREATE TABLE IF NOT EXISTS terminal_command_rules (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- JSON array of tokens, matched case-insensitively from the start.
        prefix     TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_command_rules_unique
        ON terminal_command_rules(user_id, prefix);
    `);
    if (!database) schemaReady = true;
  }
  return target;
}

export function listTerminalCommandRules(userId: number, database?: Db): TerminalCommandRule[] {
  const rows = handle(database)
    .prepare("SELECT id, prefix, created_at FROM terminal_command_rules WHERE user_id = ? ORDER BY id")
    .all(userId) as Array<{ id: number; prefix: string; created_at: string }>;
  return rows.flatMap((row) => {
    try {
      const prefix = JSON.parse(row.prefix);
      return Array.isArray(prefix) && prefix.every((token) => typeof token === "string")
        ? [{ id: row.id, prefix, createdAt: row.created_at }]
        : [];
    } catch {
      return [];
    }
  });
}

/** Store the rule for `command`; null when the command is not ruleable. */
export function addTerminalCommandRule(userId: number, command: string, database?: Db): string[] | null {
  const prefix = commandRulePrefix(command);
  if (!prefix) return null;
  handle(database)
    .prepare("INSERT OR IGNORE INTO terminal_command_rules (user_id, prefix) VALUES (?, ?)")
    .run(userId, JSON.stringify(prefix));
  return prefix;
}

export function removeTerminalCommandRule(userId: number, id: number, database?: Db): boolean {
  return handle(database)
    .prepare("DELETE FROM terminal_command_rules WHERE user_id = ? AND id = ?")
    .run(userId, id).changes > 0;
}

/** The stored rule that allows `command`, if any. */
export function matchingTerminalCommandRule(
  userId: number,
  command: string,
  database?: Db,
): TerminalCommandRule | null {
  return listTerminalCommandRules(userId, database)
    .find((rule) => commandMatchesPrefix(command, rule.prefix)) ?? null;
}

// The command waiting on a permission card, per runtime session. Kept on the
// server so "always" stores the command the server actually refused, never
// text the browser supplies. Hermes holds one approval per session at a time.
// globalThis: route bundles can load this module more than once per process.
const PENDING_TTL_MS = 15 * 60_000;
const pending: Map<number, { command: string; at: number }> =
  ((globalThis as Record<string, unknown>).__breadboardPendingTerminalCommands ??= new Map()) as Map<
    number,
    { command: string; at: number }
  >;

export function rememberPendingTerminalCommand(runtimeSessionId: number, command: string): void {
  pending.set(runtimeSessionId, { command, at: Date.now() });
}

export function takePendingTerminalCommand(runtimeSessionId: number): string | null {
  const entry = pending.get(runtimeSessionId);
  pending.delete(runtimeSessionId);
  return entry && Date.now() - entry.at < PENDING_TTL_MS ? entry.command : null;
}
