// Plan persistence: the Kaneo board model on Breadboard's own SQLite database.
//
// Additive and applied with CREATE TABLE IF NOT EXISTS, matching the repo's
// migration style, and taking an injected handle so the store can be unit
// tested against an in-memory SQLite database.
//
// Two deliberate departures from Kaneo's Postgres schema:
//
//   * No workspace table. Kaneo is multi-tenant, so every row hangs off a
//     workspace and a membership row decides who may see it. Breadboard already
//     scopes by `users`, so a project references `users(id)` directly and every
//     query in the store filters by user id a second time.
//
//   * Integer keys, not cuid text. The rest of this database uses AUTOINCREMENT
//     integers, and the board's identifiers are never exposed outside it. The
//     user-facing name of a card is still Kaneo's "SLUG-number" ref, which is
//     rebuilt from `plan_projects.slug` and `plan_tasks.number`.
//
// Dates are timezone-free wall-clock strings, the same convention the calendar
// uses (see ../calendar/wallclock.ts): due dates are "YYYY-MM-DD" so they sort
// as text and survive the machine changing timezone, and audit stamps are
// SQLite's own datetime('now').

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

interface ColumnPatch {
  table: string;
  column: string;
  /** Everything after the column name. Must default to NULL or carry a DEFAULT. */
  definition: string;
}

/**
 * Columns added after the first release. SQLite has no `ADD COLUMN IF NOT
 * EXISTS`, so each is probed with `PRAGMA table_info` first.
 */
const COLUMN_PATCHES: readonly ColumnPatch[] = [];

function addMissingColumns(db: Db): void {
  for (const patch of COLUMN_PATCHES) {
    const columns = db.prepare(`PRAGMA table_info(${patch.table})`).all() as {
      name: string;
    }[];
    if (columns.some((column) => column.name === patch.column)) continue;
    db.exec(
      `ALTER TABLE ${patch.table} ADD COLUMN ${patch.column} ${patch.definition}`,
    );
  }
}

export function ensurePlanSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_projects (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name             TEXT    NOT NULL,
      slug             TEXT    NOT NULL,
      description      TEXT,
      color            TEXT    NOT NULL DEFAULT '#4f6f68',
      archived         INTEGER NOT NULL DEFAULT 0,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      last_task_number INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_projects_user
      ON plan_projects(user_id, archived, sort_order, id);

    CREATE TABLE IF NOT EXISTS plan_columns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES plan_projects(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      slug       TEXT    NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      color      TEXT    NOT NULL DEFAULT '#7b97aa',
      is_final   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_columns_project
      ON plan_columns(project_id, position, id);

    CREATE TABLE IF NOT EXISTS plan_tasks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id   INTEGER NOT NULL REFERENCES plan_projects(id) ON DELETE CASCADE,
      column_id    INTEGER NOT NULL REFERENCES plan_columns(id) ON DELETE CASCADE,
      number       INTEGER NOT NULL,
      position     INTEGER NOT NULL DEFAULT 0,
      title        TEXT    NOT NULL,
      description  TEXT,
      priority     TEXT    NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('urgent','high','medium','low')),
      start_date   TEXT,
      due_date     TEXT,
      completed_at TEXT,
      source       TEXT    NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','agent_run','schedule','assistant')),
      source_ref   TEXT,
      source_url   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, number)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_tasks_board
      ON plan_tasks(project_id, column_id, position, id);

    CREATE INDEX IF NOT EXISTS idx_plan_tasks_user_due
      ON plan_tasks(user_id, due_date);

    -- Breadboard files a card for each agent run and scheduled chat. The origin
    -- is looked up on every write to decide update-vs-insert, so it is indexed.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_tasks_source
      ON plan_tasks(user_id, source, source_ref)
      WHERE source_ref IS NOT NULL;

    CREATE TABLE IF NOT EXISTS plan_labels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      color      TEXT    NOT NULL DEFAULT '#6e8f87',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS plan_task_labels (
      task_id  INTEGER NOT NULL REFERENCES plan_tasks(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES plan_labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_task_labels_label
      ON plan_task_labels(label_id);

    CREATE TABLE IF NOT EXISTS plan_task_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES plan_tasks(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author     TEXT    NOT NULL DEFAULT 'user'
                   CHECK (author IN ('user','assistant')),
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_plan_task_comments_task
      ON plan_task_comments(task_id, id);

    CREATE TABLE IF NOT EXISTS plan_task_relations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         INTEGER NOT NULL REFERENCES plan_tasks(id) ON DELETE CASCADE,
      related_task_id INTEGER NOT NULL REFERENCES plan_tasks(id) ON DELETE CASCADE,
      relation_type   TEXT    NOT NULL DEFAULT 'relates_to'
                        CHECK (relation_type IN ('blocks','blocked_by','relates_to','duplicates')),
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, related_task_id, relation_type)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_task_relations_task
      ON plan_task_relations(task_id);

    CREATE INDEX IF NOT EXISTS idx_plan_task_relations_related
      ON plan_task_relations(related_task_id);
  `);

  addMissingColumns(db);
}
