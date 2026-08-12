// Paper Trader desk state: whether the desk is meant to be running, which arena
// account it owns, and the decision TradingAgents has prepared for the next
// trading cycle.
//
// "Meant to be running" is the whole reason this table exists. The desk outlives
// the turn that started it and the process that hosts it: closing Breadboard and
// opening it again has to bring the same desk back, and only a durable flag can
// say that. Everything else in here is either what a restart needs to find the
// same portfolio again (the account id, the capital it was opened with) or what
// makes the asynchronous decision loop survive one (see ./decisions.ts).
//
// Additive `CREATE TABLE IF NOT EXISTS` migrations matching the repo style, over
// an injected handle so the store can be unit-tested on an in-memory database.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensurePaperTraderSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_trader_settings (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      -- The durable intent. 1 means "bring this back on the next boot".
      enabled           INTEGER NOT NULL DEFAULT 0,
      owner_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      -- The arena account the desk trades through, once it has one.
      account_id        INTEGER,
      -- The capital that account was actually opened with, which is not always
      -- the capital currently configured: changing it only takes effect on the
      -- next start, and this is how that difference is noticed.
      account_capital   REAL,
      -- Where the arena reaches back into Breadboard for a decision. Captured
      -- from the request that started the desk, because a background restart at
      -- boot has no request to read an origin from.
      callback_origin   TEXT NOT NULL DEFAULT '',
      -- The normalized settings this running desk actually started with. The
      -- settings page promises edits apply on the next start; reading the live
      -- catalog on every cycle would break that promise and could disagree
      -- with the arena's boot-time symbol/schedule configuration.
      run_settings_json TEXT NOT NULL DEFAULT '',
      started_at        TEXT,
      -- When the arena last asked for a decision. Its trading loop is the only
      -- thing that moves this, so a stale value is the one reliable sign that
      -- the loop has stopped even though the process is still up and answering
      -- its health endpoint. See cycleOverdue in ./supervisor.ts.
      last_cycle_at     TEXT,
      last_error        TEXT NOT NULL DEFAULT '',
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO paper_trader_settings (id) VALUES (1);

    -- One row per analysis TradingAgents has run for the desk. The arena asks
    -- for a decision on a 30-second budget and an analysis takes minutes, so a
    -- cycle answers with the previous cycle's verdict and starts the next one.
    -- A verdict is handed out once: 'ready' becomes 'used' when it is served.
    CREATE TABLE IF NOT EXISTS paper_trader_decisions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol       TEXT    NOT NULL,
      -- pending | ready | used | failed
      state        TEXT    NOT NULL DEFAULT 'pending',
      -- BUY | SELL | HOLD, as TradingAgents' own signal processor returns it.
      rating       TEXT    NOT NULL DEFAULT '',
      -- The decision object handed to the arena, as JSON, once there is one.
      decision     TEXT    NOT NULL DEFAULT '',
      reasoning    TEXT    NOT NULL DEFAULT '',
      error        TEXT    NOT NULL DEFAULT '',
      requested_at TEXT    NOT NULL DEFAULT (datetime('now')),
      settled_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_paper_trader_decisions_state
      ON paper_trader_decisions (state, id);

    -- What the desk's other advisers have said most recently.
    --
    -- The advisers are Breadboard's own trading agents — Vibe Trading's quant
    -- research loop, the Stock Analyst's market-regime read — and each of them
    -- is a whole cloned runtime with its own service behind it. Asking one on
    -- every cycle would cost more than the trading does, and neither answers a
    -- question that changes minute to minute, so each seat's note is kept here
    -- and refreshed on its own slow schedule. One row per seat, replaced in
    -- place: this is a noticeboard, not a log.
    CREATE TABLE IF NOT EXISTS paper_trader_advice (
      seat       TEXT PRIMARY KEY,
      -- buy | sell | hold | note | abstain
      stance     TEXT NOT NULL DEFAULT 'note',
      note       TEXT NOT NULL DEFAULT '',
      error      TEXT NOT NULL DEFAULT '',
      -- Set while a seat is being consulted, so two cycles cannot consult it at
      -- once — the same reason the analysis table has a pending state.
      pending    INTEGER NOT NULL DEFAULT 0,
      asked_at   TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Additive migration for databases created before run settings were pinned.
  const settingsColumns = db
    .prepare("PRAGMA table_info(paper_trader_settings)")
    .all() as { name: string }[];
  if (!settingsColumns.some((column) => column.name === "run_settings_json")) {
    db.exec("ALTER TABLE paper_trader_settings ADD COLUMN run_settings_json TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColumns.some((column) => column.name === "last_cycle_at")) {
    db.exec("ALTER TABLE paper_trader_settings ADD COLUMN last_cycle_at TEXT");
  }
}
