import type Database from "better-sqlite3";

/**
 * Organizations: a named group of accounts that can see each other's shared
 * gardens.
 *
 * Membership is the only state that matters, so it lives in one row per person
 * per organization. An invite is kept as its own row rather than as a pending
 * membership, because a declined invite has to stay declined without ever
 * having granted access.
 */
export function ensureOrganizationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT    NOT NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role            TEXT    NOT NULL DEFAULT 'member',
      joined_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS organization_invites (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      invited_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      role               TEXT    NOT NULL DEFAULT 'member',
      status             TEXT    NOT NULL DEFAULT 'pending',
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      responded_at       TEXT,
      UNIQUE(organization_id, invited_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_organization_members_user
      ON organization_members(user_id);

    CREATE INDEX IF NOT EXISTS idx_organization_invites_user
      ON organization_invites(invited_user_id, status);
  `);
}
