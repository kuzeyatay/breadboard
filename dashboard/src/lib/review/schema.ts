// Spaced-repetition state: which gardens participate, one FSRS card per learning
// page, the review history FSRS needs to reschedule, and the questions currently
// sitting unanswered in a WhatsApp or Telegram thread.
//
// Additive `CREATE TABLE IF NOT EXISTS` migrations over an injected handle,
// matching the repo style, so the store can be unit-tested on an in-memory
// database.
//
// Scheduling state deliberately lives here and not in the notes' frontmatter.
// The obvious alternative — the Obsidian spaced-repetition convention of writing
// `sr-due` into each note — cannot work in Breadboard, because a garden's
// markdown is a *build output*: the Learn pipeline rewrites those files on every
// rebuild, anchor heal, and finalize pass, so review history stored there would
// be silently destroyed by the next build. Cards are therefore keyed by
// (garden, page slug) and survive any number of rebuilds.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureReviewSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_user_settings (
      user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      -- 'off' | 'whatsapp' | 'telegram'; chosen on the profile page.
      channel           TEXT    NOT NULL DEFAULT 'off',
      daily_limit       INTEGER NOT NULL DEFAULT 5,
      send_hour         INTEGER NOT NULL DEFAULT 8,
      desired_retention REAL    NOT NULL DEFAULT 0.9,
      -- The date (YYYY-MM-DD, local) the last batch went out, and how many were
      -- sent that day. Together these cap the day without a separate counter
      -- table and without re-counting deliveries on every tick.
      last_batch_date   TEXT    NOT NULL DEFAULT '',
      last_batch_count  INTEGER NOT NULL DEFAULT 0,
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_gardens (
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      garden_slug    TEXT    NOT NULL,
      enabled        INTEGER NOT NULL DEFAULT 0,
      daily_limit    INTEGER NOT NULL DEFAULT 3,
      last_seeded_at TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, garden_slug)
    );

    -- One card per learning page. Columns after 'answer' are exactly the FSRS
    -- Card shape (see ./fsrs/models.ts); they are stored as loose columns rather
    -- than a JSON blob so 'due' can be indexed and the daily query stays a plain
    -- indexed range scan.
    CREATE TABLE IF NOT EXISTS review_cards (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      garden_slug     TEXT    NOT NULL,
      page_slug       TEXT    NOT NULL,
      page_title      TEXT    NOT NULL DEFAULT '',
      question        TEXT    NOT NULL,
      answer          TEXT    NOT NULL,
      -- Set when the note's text changes, so a stale question can be regenerated
      -- without losing the card's scheduling history.
      source_hash     TEXT    NOT NULL DEFAULT '',
      due             TEXT    NOT NULL,
      stability       REAL    NOT NULL DEFAULT 0,
      difficulty      REAL    NOT NULL DEFAULT 0,
      elapsed_days    REAL    NOT NULL DEFAULT 0,
      scheduled_days  REAL    NOT NULL DEFAULT 0,
      learning_steps  INTEGER NOT NULL DEFAULT 0,
      reps            INTEGER NOT NULL DEFAULT 0,
      lapses          INTEGER NOT NULL DEFAULT 0,
      state           INTEGER NOT NULL DEFAULT 0,
      last_review     TEXT,
      suspended       INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, garden_slug, page_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_review_cards_due
      ON review_cards(user_id, suspended, due);

    CREATE INDEX IF NOT EXISTS idx_review_cards_garden
      ON review_cards(user_id, garden_slug);

    -- The FSRS review log. Not merely an audit trail: it is the training input
    -- for the upstream optimizer, which cannot personalise parameters without a
    -- few hundred real reviews, so it has to be accumulating from day one.
    CREATE TABLE IF NOT EXISTS review_logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id           INTEGER NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE,
      rating            INTEGER NOT NULL,
      state             INTEGER NOT NULL,
      due               TEXT    NOT NULL,
      stability         REAL    NOT NULL,
      difficulty        REAL    NOT NULL,
      elapsed_days      REAL    NOT NULL,
      last_elapsed_days REAL    NOT NULL,
      scheduled_days    REAL    NOT NULL,
      learning_steps    INTEGER NOT NULL DEFAULT 0,
      review            TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_review_logs_card
      ON review_logs(card_id, review DESC);

    -- A question that has been sent and is waiting for a reply. The inbound
    -- handler matches an incoming message to the open delivery for that chat,
    -- which is why status+chat is the index and why only one delivery per chat
    -- may be open at a time.
    CREATE TABLE IF NOT EXISTS review_deliveries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id     INTEGER NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel     TEXT    NOT NULL,
      chat_id     TEXT    NOT NULL,
      question    TEXT    NOT NULL,
      -- 'open' | 'graded' | 'expired'
      status      TEXT    NOT NULL DEFAULT 'open',
      sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      answered_at TEXT,
      answer_text TEXT,
      rating      INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_review_deliveries_open
      ON review_deliveries(chat_id, status, sent_at DESC);

    CREATE INDEX IF NOT EXISTS idx_review_deliveries_user
      ON review_deliveries(user_id, sent_at DESC);
  `);
}
