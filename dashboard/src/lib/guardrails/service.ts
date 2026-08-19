// Guardrails service: the guardrail_settings singleton plus the one function
// outbound-message call sites need — applyOutboundGuardrails. A plain class
// over an injected database handle (matching src/lib/whatsapp/store.ts) so it
// is unit-testable against an in-memory database; getGuardrailService() wraps
// it around the real app db as a globalThis singleton the way
// src/lib/whatsapp/instance.ts does.

import type DatabaseType from "better-sqlite3";

import appDb from "../db.ts";
import { ensureGuardrailSchema } from "./schema.ts";
import { maskPii } from "../sim/guardrails/local-pii.ts";
import { sanitizeCustomPatterns, type CustomPiiPattern } from "../sim/guardrails/pii-entities.ts";
import { validateRegexPattern } from "../sim/guardrails/validate_regex.ts";

type Db = DatabaseType.Database;

export interface GuardrailSettings {
  scrubOutbound: boolean;
  customPatterns: CustomPiiPattern[];
}

interface GuardrailRow {
  scrub_outbound: number;
  custom_patterns: string;
}

/** Drop any pattern whose regex fails to compile, so a bad row never reaches the matcher. */
function sanitizeAndValidate(value: unknown): CustomPiiPattern[] {
  return sanitizeCustomPatterns(value).filter((pattern) => validateRegexPattern(pattern.regex).valid);
}

export class GuardrailStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureGuardrailSchema(db);
  }

  settings(): GuardrailSettings {
    const row = this.db
      .prepare("SELECT scrub_outbound, custom_patterns FROM guardrail_settings WHERE id = 1")
      .get() as GuardrailRow | undefined;
    if (!row) {
      this.db.prepare("INSERT OR IGNORE INTO guardrail_settings (id) VALUES (1)").run();
      return { scrubOutbound: false, customPatterns: [] };
    }
    let customPatterns: CustomPiiPattern[] = [];
    try {
      customPatterns = sanitizeAndValidate(JSON.parse(row.custom_patterns || "[]"));
    } catch {
      customPatterns = [];
    }
    return { scrubOutbound: row.scrub_outbound === 1, customPatterns };
  }

  update(patch: { scrubOutbound?: boolean; customPatterns?: CustomPiiPattern[] }): GuardrailSettings {
    const current = this.settings();
    const next: GuardrailSettings = {
      scrubOutbound: patch.scrubOutbound ?? current.scrubOutbound,
      customPatterns:
        patch.customPatterns !== undefined ? sanitizeAndValidate(patch.customPatterns) : current.customPatterns,
    };
    this.db
      .prepare(
        "UPDATE guardrail_settings SET scrub_outbound = ?, custom_patterns = ?, updated_at = datetime('now') WHERE id = 1",
      )
      .run(next.scrubOutbound ? 1 : 0, JSON.stringify(next.customPatterns));
    return next;
  }

  /** Cheap when scrubbing is off: one prepared-statement read, no regex work at all. */
  applyOutbound(text: string): string {
    const settings = this.settings();
    if (!settings.scrubOutbound) return text;
    return maskPii(text, { customPatterns: settings.customPatterns }).masked;
  }
}

const globals = globalThis as typeof globalThis & {
  breadboardGuardrailStore?: GuardrailStore;
};

function getStore(): GuardrailStore {
  if (!globals.breadboardGuardrailStore) {
    globals.breadboardGuardrailStore = new GuardrailStore(appDb);
  }
  return globals.breadboardGuardrailStore;
}

export function getGuardrailSettings(): GuardrailSettings {
  return getStore().settings();
}

export function updateGuardrailSettings(patch: {
  scrubOutbound?: boolean;
  customPatterns?: CustomPiiPattern[];
}): GuardrailSettings {
  return getStore().update(patch);
}

/**
 * The one call outbound-message primitives make. Verbatim when scrubbing is
 * off (the default); masked through {@link maskPii} otherwise.
 */
export function applyOutboundGuardrails(text: string): string {
  return getStore().applyOutbound(text);
}
