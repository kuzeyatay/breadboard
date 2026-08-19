// Guardrail settings: whether outbound messages (WhatsApp, Telegram) get PII
// masked before they leave Breadboard, plus any custom regex patterns to mask
// alongside the built-in detectors in src/lib/sim/guardrails/local-pii.ts.
//
// Singleton row, additive `CREATE TABLE IF NOT EXISTS`, over an injected handle
// so it can be unit-tested against an in-memory database — copies the
// whatsapp_settings pattern (see src/lib/whatsapp/schema.ts) exactly.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureGuardrailSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guardrail_settings (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      scrub_outbound  INTEGER NOT NULL DEFAULT 0,
      custom_patterns TEXT    NOT NULL DEFAULT '[]',
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO guardrail_settings (id) VALUES (1);
  `);
}
