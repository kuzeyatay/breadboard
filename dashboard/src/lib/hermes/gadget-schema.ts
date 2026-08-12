import type Database from "better-sqlite3";

/**
 * Widen an existing CHECK(... IN (...)) constraint without moving any data.
 *
 * `ensureArtifactSchema` uses `CREATE TABLE IF NOT EXISTS`, so a database
 * created before `gadget` existed keeps the old constraint forever and every
 * gadget insert would fail. The alternative — the 12-step table rebuild — would
 * copy `hermes_artifacts` and drop the original while four other tables hold
 * `ON DELETE CASCADE` references into it. This rewrites one string in
 * `sqlite_master` instead: no rows are read or written, indexes and foreign keys
 * are untouched, and the constraint keeps rejecting everything it rejected
 * before. Verified against a copy of the shape this table actually has.
 *
 * Returns true when it changed something, so callers can log a real migration.
 */
export function widenCheckConstraint(
  database: Database.Database,
  input: { table: string; sentinel: string; from: string; to: string },
): boolean {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(input.table) as { sql: string } | undefined;
  // No table yet means CREATE TABLE is about to run with the current list.
  if (!row?.sql) return false;
  if (row.sql.includes(input.sentinel)) return false;
  const next = row.sql.replace(input.from, input.to);
  if (next === row.sql) {
    // The stored constraint is not the text this migration was written against.
    // Refusing is correct: a blind rewrite here could drop a constraint.
    throw new Error(
      `Cannot widen ${input.table}: its CHECK constraint does not match the expected text.`,
    );
  }
  const schemaVersion = database.pragma("schema_version", { simple: true }) as number;
  database.unsafeMode(true);
  try {
    database.pragma("writable_schema = ON");
    database
      .prepare("UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = ?")
      .run(next, input.table);
    // Other connections reload their cached schema only when this changes.
    database.pragma(`schema_version = ${schemaVersion + 1}`);
  } finally {
    database.pragma("writable_schema = RESET");
    database.unsafeMode(false);
  }
  return true;
}

/**
 * Bring an existing `hermes_artifacts` up to the current kind list.
 *
 * This runs from `ensureArtifactSchema`, which runs at module load in `db.ts`.
 * A throw here would therefore stop Breadboard from starting at all, so an
 * unrecognized constraint is reported and swallowed rather than raised: the
 * consequence of not migrating is that gadget artifacts fail to insert with a
 * clear SQLite error, which is a far better outcome than a dashboard that will
 * not boot. `widenCheckConstraint` itself stays strict for its own callers.
 */
export function migrateArtifactKindsForGadgets(database: Database.Database): boolean {
  try {
    const gadgetChanged = widenCheckConstraint(database, {
      table: "hermes_artifacts",
      sentinel: "'gadget'",
      from: "'data','unknown'))",
      to: "'data','unknown','gadget'))",
    });
    const modelChanged = widenCheckConstraint(database, {
      table: "hermes_artifacts",
      sentinel: "'model'",
      from: "'data','unknown','gadget'))",
      to: "'data','unknown','gadget','model'))",
    });
    return gadgetChanged || modelChanged;
  } catch (cause) {
    console.warn(
      "[breadboard] Could not widen hermes_artifacts.kind; newer artifact kinds will be rejected until this is resolved.",
      cause instanceof Error ? cause.message : cause,
    );
    return false;
  }
}

/**
 * Additive, idempotent schema for gadgets and their approval queue.
 *
 * The queue is a durable table rather than in-memory state because that is the
 * feature: an action submitted on Monday must still be approvable on Thursday,
 * across restarts, from a different chat than the one that created the gadget.
 */
export function ensureGadgetSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS hermes_gadgets (
      artifact_id             TEXT PRIMARY KEY REFERENCES hermes_artifacts(id) ON DELETE CASCADE,
      schema_version          INTEGER NOT NULL DEFAULT 1,
      lifecycle_status        TEXT NOT NULL CHECK (lifecycle_status IN (
        'generating','validating','ready','failed'
      )),
      manifest_json           TEXT NOT NULL,
      bindings_json           TEXT NOT NULL DEFAULT '[]',
      active_version          INTEGER NOT NULL DEFAULT 0,
      next_action_sequence    INTEGER NOT NULL DEFAULT 1,
      next_observation_sequence INTEGER NOT NULL DEFAULT 1,
      repair_attempt          INTEGER NOT NULL DEFAULT 0,
      last_error_json         TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hermes_gadget_actions (
      id                  TEXT PRIMARY KEY,
      gadget_artifact_id  TEXT NOT NULL REFERENCES hermes_gadgets(artifact_id) ON DELETE CASCADE,
      sequence            INTEGER NOT NULL,
      status              TEXT NOT NULL CHECK (status IN (
        'pending','approved','applied','rejected','failed','reverted'
      )),
      binding             TEXT NOT NULL,
      operation           TEXT NOT NULL,
      action_kind_tag     TEXT NOT NULL,
      action_kind_label   TEXT NOT NULL,
      description_json    TEXT NOT NULL,
      -- The verbatim arguments, replayed when the action is applied. Kept apart
      -- from the description so review text can never be mistaken for input.
      payload_json        TEXT NOT NULL,
      simulation_json     TEXT NOT NULL,
      applied_result_json TEXT,
      error_json          TEXT,
      auto_applied        INTEGER NOT NULL DEFAULT 0,
      submitted_at        TEXT NOT NULL,
      decided_at          TEXT,
      applied_at          TEXT,
      reverted_at         TEXT,
      UNIQUE(gadget_artifact_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_gadget_actions_pending
      ON hermes_gadget_actions(status, submitted_at);
    CREATE INDEX IF NOT EXISTS idx_gadget_actions_gadget
      ON hermes_gadget_actions(gadget_artifact_id, sequence DESC);

    -- Reads are recorded, not queued. This is the log that makes "what has this
    -- gadget looked at" answerable after the fact.
    CREATE TABLE IF NOT EXISTS hermes_gadget_observations (
      id                  TEXT PRIMARY KEY,
      gadget_artifact_id  TEXT NOT NULL REFERENCES hermes_gadgets(artifact_id) ON DELETE CASCADE,
      sequence            INTEGER NOT NULL,
      binding             TEXT NOT NULL,
      operation           TEXT NOT NULL,
      description_json    TEXT NOT NULL,
      observed_at         TEXT NOT NULL,
      UNIQUE(gadget_artifact_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_gadget_observations_gadget
      ON hermes_gadget_observations(gadget_artifact_id, sequence DESC);

    -- One row per (gadget, action kind) the user has chosen to stop being asked
    -- about. Scoped per gadget on purpose: trusting one gadget to send a message
    -- says nothing about the next one.
    CREATE TABLE IF NOT EXISTS hermes_gadget_auto_approvals (
      gadget_artifact_id  TEXT NOT NULL REFERENCES hermes_gadgets(artifact_id) ON DELETE CASCADE,
      action_kind_tag     TEXT NOT NULL,
      action_kind_label   TEXT NOT NULL,
      created_at          TEXT NOT NULL,
      PRIMARY KEY (gadget_artifact_id, action_kind_tag)
    );

    -- Private per-gadget key/value state, the one binding that is not shared
    -- with anything else in Breadboard.
    CREATE TABLE IF NOT EXISTS hermes_gadget_storage (
      gadget_artifact_id  TEXT NOT NULL REFERENCES hermes_gadgets(artifact_id) ON DELETE CASCADE,
      key                 TEXT NOT NULL,
      value_json          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      PRIMARY KEY (gadget_artifact_id, key)
    );
  `);
}
