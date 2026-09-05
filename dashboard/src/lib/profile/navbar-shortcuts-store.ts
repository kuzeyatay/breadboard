// The navbar-shortcut settings bound to the application database. The rules and
// the schema live in `navbar-shortcuts.ts`, which stays free of the database so
// they can be tested directly; this file is only the binding.

import db from "@/lib/db";

import {
  ensureNavbarShortcutSchema,
  readNavbarFlowers,
  readNavbarShortcuts,
  writeNavbarFlowers,
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

export function getNavbarFlowers(userId: number): boolean {
  return readNavbarFlowers(db, userId);
}

export function updateNavbarFlowers(userId: number, showFlowers: boolean): boolean {
  return writeNavbarFlowers(db, userId, showFlowers);
}
