// Persistence for the per-user Recall settings. The rules themselves live in
// policy.ts, which stays free of the database so they can be tested directly;
// this file is only the storage around them.

import db from "@/lib/db";

import {
  applyRecallSettingsPatch,
  boundedInt,
  DEFAULT_RECALL_SETTINGS,
  MAX_LOOKBACK_HOURS,
  MAX_RESULTS_CEILING,
  normalizeExcludedWindows,
  RECALL_CONTROL_MODES,
  type RecallControlMode,
  type RecallSettings,
} from "./policy.ts";

export {
  DEFAULT_RECALL_SETTINGS,
  RECALL_CONTROL_MODES,
  applyRecallSettingsPatch,
  normalizeExcludedWindows,
};
export type { RecallControlMode, RecallSettings };

db.exec(`
  CREATE TABLE IF NOT EXISTS recall_user_settings (
    user_id                INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    capture_enabled        INTEGER NOT NULL DEFAULT 0,
    auto_start_capture     INTEGER NOT NULL DEFAULT 0,
    capture_audio          INTEGER NOT NULL DEFAULT 1,
    agent_access           INTEGER NOT NULL DEFAULT 1,
    agent_control          TEXT    NOT NULL DEFAULT 'ask',
    excluded_windows       TEXT    NOT NULL DEFAULT '[]',
    default_lookback_hours INTEGER NOT NULL DEFAULT 24,
    max_results            INTEGER NOT NULL DEFAULT 10,
    updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Added after the table shipped. The default matches the one in the CREATE
// above, so a user who already opted into capture does not silently acquire an
// unattended recorder along with the upgrade.
{
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(recall_user_settings)`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("auto_start_capture")) {
    db.exec(
      `ALTER TABLE recall_user_settings ADD COLUMN auto_start_capture INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

type RecallSettingsRow = {
  capture_enabled: number;
  auto_start_capture: number;
  capture_audio: number;
  agent_access: number;
  agent_control: string;
  excluded_windows: string;
  default_lookback_hours: number;
  max_results: number;
};

function parseExcludedWindows(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    return normalizeExcludedWindows(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function rowToSettings(row: RecallSettingsRow | undefined): RecallSettings {
  if (!row) return { ...DEFAULT_RECALL_SETTINGS };
  return {
    captureEnabled: row.capture_enabled === 1,
    autoStartCapture: row.auto_start_capture === 1,
    captureAudio: row.capture_audio === 1,
    agentAccess: row.agent_access === 1,
    agentControl: RECALL_CONTROL_MODES.includes(row.agent_control as RecallControlMode)
      ? (row.agent_control as RecallControlMode)
      : DEFAULT_RECALL_SETTINGS.agentControl,
    excludedWindows: parseExcludedWindows(row.excluded_windows),
    defaultLookbackHours: boundedInt(
      row.default_lookback_hours,
      DEFAULT_RECALL_SETTINGS.defaultLookbackHours,
      1,
      MAX_LOOKBACK_HOURS,
    ),
    maxResults: boundedInt(
      row.max_results,
      DEFAULT_RECALL_SETTINGS.maxResults,
      1,
      MAX_RESULTS_CEILING,
    ),
  };
}

export function getRecallSettings(userId: number): RecallSettings {
  const row = db
    .prepare(
      `SELECT capture_enabled, auto_start_capture, capture_audio, agent_access,
              agent_control, excluded_windows, default_lookback_hours, max_results
         FROM recall_user_settings WHERE user_id = ?`,
    )
    .get(userId) as RecallSettingsRow | undefined;
  return rowToSettings(row);
}

export function updateRecallSettings(
  userId: number,
  patch: Record<string, unknown>,
): RecallSettings {
  const next = applyRecallSettingsPatch(getRecallSettings(userId), patch);
  db.prepare(
    `INSERT INTO recall_user_settings (
       user_id, capture_enabled, auto_start_capture, capture_audio, agent_access,
       agent_control, excluded_windows, default_lookback_hours, max_results, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       capture_enabled = excluded.capture_enabled,
       auto_start_capture = excluded.auto_start_capture,
       capture_audio = excluded.capture_audio,
       agent_access = excluded.agent_access,
       agent_control = excluded.agent_control,
       excluded_windows = excluded.excluded_windows,
       default_lookback_hours = excluded.default_lookback_hours,
       max_results = excluded.max_results,
       updated_at = datetime('now')`,
  ).run(
    userId,
    next.captureEnabled ? 1 : 0,
    next.autoStartCapture ? 1 : 0,
    next.captureAudio ? 1 : 0,
    next.agentAccess ? 1 : 0,
    next.agentControl,
    JSON.stringify(next.excludedWindows),
    next.defaultLookbackHours,
    next.maxResults,
  );
  return next;
}
