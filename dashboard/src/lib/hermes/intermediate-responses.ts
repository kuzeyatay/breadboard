import "server-only";

import type Database from "better-sqlite3";
import db from "../db.ts";
import { parseComposerSwitches } from "./composer-switches.ts";

/**
 * Whether chat replies stream as a live draft while Bread works (Codex-style
 * intermediate responses). On unless the user turned it off in Settings; off
 * restores the older behaviour of revealing the answer once, at the end.
 * Read once per turn, so a change applies from the next message.
 */
export function intermediateResponsesEnabled(
  userId: number,
  database: Database.Database = db,
): boolean {
  const row = database.prepare(
    "SELECT composer_switches FROM hermes_user_settings WHERE user_id = ?",
  ).get(userId) as { composer_switches: string | null } | undefined;
  return parseComposerSwitches(row?.composer_switches).intermediateResponses !== false;
}
