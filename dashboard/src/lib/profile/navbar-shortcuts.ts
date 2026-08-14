// Which optional shortcuts the navbar carries.
//
// A navbar is chrome every page in its area shows, so a seat in it is
// expensive: each entry is a permanent cost paid by everyone. The Work timer
// earned its seat by default — it opens and closes in place rather than
// stealing the tab — while World monitor stays off until asked for. Plan keeps
// its existing default seat, but can be removed from the same profile control.
// Fast-read is the same bargain on the garden and PDF navbars: a reading mode
// most sessions never reach for, so it waits to be asked for.
//
// Nothing here touches a database: the storage lives in
// `navbar-shortcuts-store.ts` so the shape and the rules can be exercised
// against an in-memory copy.

import type Database from "better-sqlite3";

export interface NavbarShortcuts {
  workTimer: boolean;
  worldMonitor: boolean;
  plan: boolean;
  fastRead: boolean;
}

export interface NavbarShortcutDefinition {
  key: keyof NavbarShortcuts;
  label: string;
  /**
   * The page the shortcut opens. Absent for a seat that is a control rather
   * than a link — there is nothing to visit on its own.
   */
  href?: string;
  /** What the shortcut opens, for the toggle's own description. */
  description: string;
}

/**
 * The catalog the profile page renders and the navbars read.
 *
 * One list rather than two so a shortcut cannot be offered in settings without
 * a navbar honouring it, or the reverse.
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
    key: "fastRead",
    label: "Fast-read",
    description:
      "Speed-read the open note or PDF one word at a time. Adds a button to the garden and PDF navbars.",
  },
];

/**
 * Preserve the existing navbar: Work timer and Plan on, World monitor and
 * Fast-read opt-in.
 */
export const DEFAULT_NAVBAR_SHORTCUTS: NavbarShortcuts = {
  workTimer: true,
  worldMonitor: false,
  plan: true,
  fastRead: false,
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
      fast_read     INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = database
    .prepare("PRAGMA table_info(navbar_shortcut_settings)")
    .all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((column) => column.name === name);

  // A seat added after an account first saved its choices: the column arrives
  // with this shortcut's own default, so nobody's existing navbar moves.
  if (!has("plan")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN plan INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!has("fast_read")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN fast_read INTEGER NOT NULL DEFAULT 0",
    );
  }
  // A `map_page` column survives on databases written before the map shortcut
  // was withdrawn. It is left alone: it defaults to 0, so writes that no longer
  // name it still satisfy its NOT NULL.
}

export function readNavbarShortcuts(
  database: Database.Database,
  userId: number,
): NavbarShortcuts {
  const row = database
    .prepare(
      "SELECT work_timer, world_monitor, plan, fast_read FROM navbar_shortcut_settings WHERE user_id = ?",
    )
    .get(userId) as
    | { work_timer: number; world_monitor: number; plan: number; fast_read: number }
    | undefined;

  // No row means the account has never been asked, so the defaults apply.
  if (!row) return { ...DEFAULT_NAVBAR_SHORTCUTS };
  return {
    workTimer: row.work_timer === 1,
    worldMonitor: row.world_monitor === 1,
    plan: row.plan === 1,
    fastRead: row.fast_read === 1,
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
      `INSERT INTO navbar_shortcut_settings (user_id, work_timer, world_monitor, plan, fast_read, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         work_timer = excluded.work_timer,
         world_monitor = excluded.world_monitor,
         plan = excluded.plan,
         fast_read = excluded.fast_read,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      next.workTimer ? 1 : 0,
      next.worldMonitor ? 1 : 0,
      next.plan ? 1 : 0,
      next.fastRead ? 1 : 0,
    );
  return next;
}
