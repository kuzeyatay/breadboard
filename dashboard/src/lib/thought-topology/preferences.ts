import "server-only";

import type Database from "better-sqlite3";
import db from "../db.ts";
import { parseComposerSwitches } from "../hermes/composer-switches.ts";

/** The Garden owner's account preference also applies to background mutations. */
export function thoughtTopologyAutoUpdateEnabled(
  userId: number,
  database: Database.Database = db,
): boolean {
  const row = database.prepare(
    "SELECT composer_switches FROM hermes_user_settings WHERE user_id = ?",
  ).get(userId) as { composer_switches: string | null } | undefined;
  return parseComposerSwitches(row?.composer_switches).thoughtTopologyAutoUpdate !== false;
}

/** Website PDFs unopened for 30 days are swept unless the user turned it off. */
export function webPdfCleanupEnabled(userId: number, database: Database.Database = db): boolean {
  const row = database.prepare(
    "SELECT composer_switches FROM hermes_user_settings WHERE user_id = ?",
  ).get(userId) as { composer_switches: string | null } | undefined;
  return parseComposerSwitches(row?.composer_switches).webPdfCleanup !== false;
}
