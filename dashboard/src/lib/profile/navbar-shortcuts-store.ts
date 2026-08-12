// The navbar-shortcut settings bound to the application database. The rules and
// the schema live in `navbar-shortcuts.ts`, which stays free of the database so
// they can be tested directly; this file is only the binding.

import db from "@/lib/db";

import {
  ensureNavbarShortcutSchema,
  readNavbarShortcuts,
  writeNavbarShortcuts,
  type NavbarShortcuts,
} from "./navbar-shortcuts.ts";

ensureNavbarShortcutSchema(db);

export function getNavbarShortcuts(userId: number): NavbarShortcuts {
  return readNavbarShortcuts(db, userId);
}

export function updateNavbarShortcuts(userId: number, patch: unknown): NavbarShortcuts {
  return writeNavbarShortcuts(db, userId, patch);
}
