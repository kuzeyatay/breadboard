// Reading and writing per-user agent settings. Server-only: it touches the
// database. The values it returns are always complete and always valid — a row
// that predates a new option, or one hand-edited into nonsense, is repaired by
// `normalizeAgentSettings` on the way out, so callers never defend against it.

import db from "../db.ts";
import {
  agentSettingDefaults,
  findConfigurableAgent,
  normalizeAgentSettings,
  type AgentSettingValues,
  type ConfigurableAgent,
} from "./catalog.ts";

interface SettingsRow {
  values_json: string;
  updated_at: string;
}

export interface StoredAgentSettings {
  agentId: string;
  values: AgentSettingValues;
  /** False when the user has never saved anything for this agent. */
  configured: boolean;
  updatedAt: string | null;
}

function readRow(userId: number, agentId: string): SettingsRow | undefined {
  return db
    .prepare("SELECT values_json, updated_at FROM agent_settings WHERE user_id = ? AND agent_id = ?")
    .get(userId, agentId) as SettingsRow | undefined;
}

/** The settings for one agent, falling back to the shipped defaults. */
export function readAgentSettings(userId: number, agent: ConfigurableAgent): StoredAgentSettings {
  const row = readRow(userId, agent.id);
  if (!row) {
    return {
      agentId: agent.id,
      values: agentSettingDefaults(agent),
      configured: false,
      updatedAt: null,
    };
  }

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.values_json);
  } catch {
    parsed = {};
  }
  return {
    agentId: agent.id,
    values: normalizeAgentSettings(agent, parsed),
    configured: true,
    updatedAt: row.updated_at,
  };
}

/**
 * The values a run should start from, by agent id. This is the entry point the
 * run routes use, so it accepts an unknown id and answers with the defaults
 * rather than throwing — a run must never fail because of a settings lookup.
 */
export function agentSettingsFor(userId: number, agentId: string): AgentSettingValues {
  const agent = findConfigurableAgent(agentId);
  if (!agent) return {};
  try {
    return readAgentSettings(userId, agent).values;
  } catch {
    return agentSettingDefaults(agent);
  }
}

export function writeAgentSettings(
  userId: number,
  agent: ConfigurableAgent,
  raw: unknown,
): StoredAgentSettings {
  const values = normalizeAgentSettings(agent, raw);
  db.prepare(
    `INSERT INTO agent_settings (user_id, agent_id, values_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, agent_id) DO UPDATE SET
       values_json = excluded.values_json,
       updated_at  = excluded.updated_at`,
  ).run(userId, agent.id, JSON.stringify(values));
  return readAgentSettings(userId, agent);
}

/** Back to the shipped defaults. The row is removed rather than overwritten. */
export function resetAgentSettings(userId: number, agent: ConfigurableAgent): StoredAgentSettings {
  db.prepare("DELETE FROM agent_settings WHERE user_id = ? AND agent_id = ?").run(userId, agent.id);
  return readAgentSettings(userId, agent);
}
