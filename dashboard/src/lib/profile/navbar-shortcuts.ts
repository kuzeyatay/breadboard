// Which optional shortcuts the navbar carries.
//
// The navbar is the one piece of chrome every page shows, so a seat in it is
// expensive: each entry is a permanent cost paid by everyone. The Work timer
// earned its seat by default — it opens and closes in place rather than
// stealing the tab — while World monitor stays off until asked for. Plan keeps
// its existing default seat, but can be removed from the same profile control.
//
// Nothing here touches a database: the storage lives in
// `navbar-shortcuts-store.ts` so the shape and the rules can be exercised
// against an in-memory copy.

import type Database from "better-sqlite3";

export interface NavbarShortcuts {
  workTimer: boolean;
  worldMonitor: boolean;
  plan: boolean;
  map: boolean;
}

export interface NavbarShortcutDefinition {
  key: keyof NavbarShortcuts;
  label: string;
  href: string;
  /** What the shortcut opens, for the toggle's own description. */
  description: string;
}

/**
 * The catalog the profile page renders and the navbar reads.
 *
 * One list rather than two so a shortcut cannot be offered in settings without
 * appearing in the navbar, or the reverse.
 */
export const NAVBAR_SHORTCUTS: readonly NavbarShortcutDefinition[] = [
  {
    key: "workTimer",
    label: "Work timer",
    href: "/pomodoro",
    description:
      "A pomodoro timer that opens and closes in place; the full Paint Pomodoro page is one click further.",
  },
  {
    key: "worldMonitor",
    label: "World monitor",
    href: "/worldmonitor",
    description: "The world console — reported events beside measured climate and hazard data.",
  },
  {
    key: "plan",
    label: "Plan",
    href: "/plan",
    description: "Your project board and calendar, opened together in one workspace.",
  },
  {
    key: "map",
    label: "Map",
    href: "/map",
    description:
      "The map the assistant works on: searched places, nearby results and routes, drawn from the same map data it answers from.",
  },
];

/** Preserve the existing navbar: Work timer and Plan on, World monitor opt-in. */
export const DEFAULT_NAVBAR_SHORTCUTS: NavbarShortcuts = {
  workTimer: true,
  worldMonitor: false,
  plan: true,
  map: false,
};

export function isNavbarShortcutKey(value: unknown): value is keyof NavbarShortcuts {
  return NAVBAR_SHORTCUTS.some((shortcut) => shortcut.key === value);
}

/**
 * Apply a partial update, ignoring keys that are not shortcuts and values that
 * are not booleans. A patch that says nothing valid leaves the settings alone
 * rather than resetting them.
 */
export function applyNavbarShortcutPatch(
  current: NavbarShortcuts,
  patch: unknown,
): NavbarShortcuts {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ...current };

  const next = { ...current };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!isNavbarShortcutKey(key)) continue;
    if (typeof value !== "boolean") continue;
    next[key] = value;
  }
  return next;
}

export function ensureNavbarShortcutSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS navbar_shortcut_settings (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      work_timer    INTEGER NOT NULL DEFAULT 0,
      world_monitor INTEGER NOT NULL DEFAULT 0,
      plan           INTEGER NOT NULL DEFAULT 1,
      map_page      INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = database
    .prepare("PRAGMA table_info(navbar_shortcut_settings)")
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "plan")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN plan INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!columns.some((column) => column.name === "map_page")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN map_page INTEGER NOT NULL DEFAULT 0",
    );
  }
}

export function readNavbarShortcuts(
  database: Database.Database,
  userId: number,
): NavbarShortcuts {
  const row = database
    .prepare(
      "SELECT work_timer, world_monitor, plan, map_page FROM navbar_shortcut_settings WHERE user_id = ?",
    )
    .get(userId) as
    | { work_timer: number; world_monitor: number; plan: number; map_page: number }
    | undefined;

  // No row means the account has never been asked, so the defaults apply.
  if (!row) return { ...DEFAULT_NAVBAR_SHORTCUTS };
  return {
    workTimer: row.work_timer === 1,
    worldMonitor: row.world_monitor === 1,
    plan: row.plan === 1,
    map: row.map_page === 1,
  };
}

export function writeNavbarShortcuts(
  database: Database.Database,
  userId: number,
  patch: unknown,
): NavbarShortcuts {
  const next = applyNavbarShortcutPatch(readNavbarShortcuts(database, userId), patch);
  database
    .prepare(
      `INSERT INTO navbar_shortcut_settings (user_id, work_timer, world_monitor, plan, map_page, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         work_timer = excluded.work_timer,
         world_monitor = excluded.world_monitor,
         plan = excluded.plan,
         map_page = excluded.map_page,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      next.workTimer ? 1 : 0,
      next.worldMonitor ? 1 : 0,
      next.plan ? 1 : 0,
      next.map ? 1 : 0,
    );
  return next;
}
