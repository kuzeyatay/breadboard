// Which optional shortcuts the navbar carries.
//
// A navbar is chrome every page in its area shows, so a seat in it is
// expensive: each entry is a permanent cost paid by everyone. The Work timer
// earned its seat by default — it opens and closes in place rather than
// stealing the tab. Clicky and Plan keep default seats, but can be removed from
// the same profile control. Fast-read is the same bargain on the garden
// and PDF navbars: a reading mode most sessions never reach for, so it waits to
// be asked for.
//
// Nothing here touches a database: the storage lives in
// `navbar-shortcuts-store.ts` so the shape and the rules can be exercised
// against an in-memory copy.

import type Database from "better-sqlite3";

export interface NavbarShortcuts {
  workTimer: boolean;
  browser: boolean;
  clicky: boolean;
  plan: boolean;
  fastRead: boolean;
  buzz: boolean;
}

export const DEFAULT_NAVBAR_FLOWERS = true;

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
    key: "browser",
    label: "Browser",
    description:
      "A sandboxed Chromium browser held beneath Breadboard's own tabs and address toolbar. Only the desktop app shows it.",
  },
  {
    key: "clicky",
    label: "Clicky",
    description:
      "A screen-aware voice companion for the Windows and macOS desktop apps.",
  },
  {
    key: "plan",
    label: "Plan",
    href: "/plan",
    description: "Your project board and calendar, opened together in one workspace.",
  },
  {
    key: "buzz",
    label: "Organization",
    href: "/buzz",
    description:
      "Rooms where your team and their agents talk in one shared transcript, with threads.",
  },
  {
    key: "fastRead",
    label: "Fast-read",
    description:
      "Speed-read the open note or PDF one word at a time. Adds a button to the garden and PDF navbars.",
  },
];

/**
 * Preserve the existing navbar and add Clicky alongside Plan. Desktop-only
 * seats cost nothing in unsupported sessions, where they draw nothing at all.
 */
export const DEFAULT_NAVBAR_SHORTCUTS: NavbarShortcuts = {
  workTimer: true,
  browser: true,
  clicky: true,
  plan: true,
  fastRead: false,
  buzz: false,
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
      plan           INTEGER NOT NULL DEFAULT 1,
      fast_read     INTEGER NOT NULL DEFAULT 0,
      buzz          INTEGER NOT NULL DEFAULT 0,
      browser       INTEGER NOT NULL DEFAULT 1,
      clicky        INTEGER NOT NULL DEFAULT 1,
      show_flowers  INTEGER NOT NULL DEFAULT 1,
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = database
    .prepare("PRAGMA table_info(navbar_shortcut_settings)")
    .all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((column) => column.name === name);

  // A preference added after an account first saved its choices arrives with
  // its own default, so nobody's existing navbar moves unexpectedly.
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
  if (!has("buzz")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN buzz INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!has("browser")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN browser INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!has("clicky")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN clicky INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!has("show_flowers")) {
    database.exec(
      "ALTER TABLE navbar_shortcut_settings ADD COLUMN show_flowers INTEGER NOT NULL DEFAULT 1",
    );
  }
  // `map_page` and `world_monitor` columns survive on databases written before
  // those shortcuts were withdrawn. They are left alone: both default to 0, so
  // writes that no longer name them still satisfy their NOT NULL.
}

export function readNavbarShortcuts(
  database: Database.Database,
  userId: number,
): NavbarShortcuts {
  const row = database
    .prepare(
      "SELECT work_timer, plan, fast_read, buzz, browser, clicky FROM navbar_shortcut_settings WHERE user_id = ?",
    )
    .get(userId) as
    | {
        work_timer: number;
        plan: number;
        fast_read: number;
        buzz: number;
        browser: number;
        clicky: number;
      }
    | undefined;

  // No row means the account has never been asked, so the defaults apply.
  if (!row) return { ...DEFAULT_NAVBAR_SHORTCUTS };
  return {
    workTimer: row.work_timer === 1,
    browser: row.browser === 1,
    clicky: row.clicky === 1,
    plan: row.plan === 1,
    fastRead: row.fast_read === 1,
    buzz: row.buzz === 1,
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
      `INSERT INTO navbar_shortcut_settings (user_id, work_timer, plan, fast_read, buzz, browser, clicky, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         work_timer = excluded.work_timer,
         plan = excluded.plan,
         fast_read = excluded.fast_read,
         buzz = excluded.buzz,
         browser = excluded.browser,
         clicky = excluded.clicky,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      next.workTimer ? 1 : 0,
      next.plan ? 1 : 0,
      next.fastRead ? 1 : 0,
      next.buzz ? 1 : 0,
      next.browser ? 1 : 0,
      next.clicky ? 1 : 0,
    );
  return next;
}

export function readNavbarFlowers(
  database: Database.Database,
  userId: number,
): boolean {
  const row = database
    .prepare(
      "SELECT show_flowers FROM navbar_shortcut_settings WHERE user_id = ?",
    )
    .get(userId) as { show_flowers: number } | undefined;

  return row ? row.show_flowers === 1 : DEFAULT_NAVBAR_FLOWERS;
}

export function writeNavbarFlowers(
  database: Database.Database,
  userId: number,
  showFlowers: boolean,
): boolean {
  database
    .prepare(
      `INSERT INTO navbar_shortcut_settings
         (user_id, work_timer, plan, fast_read, buzz, browser, clicky, show_flowers, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         show_flowers = excluded.show_flowers,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      DEFAULT_NAVBAR_SHORTCUTS.workTimer ? 1 : 0,
      DEFAULT_NAVBAR_SHORTCUTS.plan ? 1 : 0,
      DEFAULT_NAVBAR_SHORTCUTS.fastRead ? 1 : 0,
      DEFAULT_NAVBAR_SHORTCUTS.buzz ? 1 : 0,
      DEFAULT_NAVBAR_SHORTCUTS.browser ? 1 : 0,
      DEFAULT_NAVBAR_SHORTCUTS.clicky ? 1 : 0,
      showFlowers ? 1 : 0,
    );
  return showFlowers;
}
