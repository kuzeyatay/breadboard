// What a DeerFlow run uses for everything the prompt does not say.
//
// The values themselves live where every other agent's defaults live — the
// per-user agent-settings catalog and store. This module is only the vocabulary
// in between: the translation from stored values into the two places DeerFlow
// reads them from.
//
// There are exactly two such places, and the difference matters:
//
//   * the run's `context`, read fresh on every request (subagents, plan mode,
//     thinking), and
//   * `config.yaml`, which Breadboard rewrites before each run. Most of that
//     file is re-read per request too, but `sandbox` is on DeerFlow's
//     startup-only list, so changing "run commands" restarts the Gateway
//     instead of being quietly ignored.
//
// Nothing here is invented: every field maps onto a real DeerFlow setting. A
// setting the harness cannot honour would be a lie told in a settings dialog.

import type { AgentSettingValues } from "../agent-settings/catalog.ts";

export interface DeerFlowSettings {
  /** Delegate work to subagents (`subagents.enabled` + the `task` tool). */
  subagents: boolean;
  /** The ceiling on delegations in one run (`subagents.max_total_per_run`). */
  maxSubagents: number;
  /** Plan the work as a todo list first (`is_plan_mode`, the `write_todos` tool). */
  planMode: boolean;
  /** Offer the web tool group: search, fetch and image search. */
  web: boolean;
  /** Remember facts across runs (`memory.enabled`). */
  memory: boolean;
  /**
   * Let the agent run shell commands on this machine (`sandbox.allow_host_bash`).
   * Off by default and deliberately: DeerFlow's local sandbox provider is a path
   * mapping, not an isolation boundary, so this is real access to the machine.
   */
  shell: boolean;
}

export const DEFAULT_DEER_FLOW_SETTINGS: DeerFlowSettings = {
  subagents: true,
  maxSubagents: 6,
  planMode: false,
  web: true,
  memory: true,
  shell: false,
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function toggle(value: unknown, fallback: boolean): boolean {
  // An unset boolean has to read as the default rather than as false, or every
  // stored row written before a field existed would silently disable it.
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Read the catalog's stored values as run settings. The catalog already
 * normalised them, so this only maps names and applies the defaults for
 * anything an older stored row is missing.
 */
export function deerFlowSettingsFrom(values: AgentSettingValues): DeerFlowSettings {
  return {
    subagents: toggle(values.subagents, DEFAULT_DEER_FLOW_SETTINGS.subagents),
    maxSubagents: boundedNumber(values.maxSubagents, DEFAULT_DEER_FLOW_SETTINGS.maxSubagents, 1, 12),
    planMode: toggle(values.planMode, DEFAULT_DEER_FLOW_SETTINGS.planMode),
    web: toggle(values.web, DEFAULT_DEER_FLOW_SETTINGS.web),
    memory: toggle(values.memory, DEFAULT_DEER_FLOW_SETTINGS.memory),
    shell: toggle(values.shell, DEFAULT_DEER_FLOW_SETTINGS.shell),
  };
}

/**
 * The per-run context DeerFlow reads out of the request body. Everything here
 * is on the Gateway's own forwarding allowlist (`_CONTEXT_CONFIGURABLE_KEYS`);
 * anything else would be dropped before it reached the agent.
 */
export function runContext(
  settings: DeerFlowSettings,
  options: { model: string; reasoningEffort: string },
): Record<string, unknown> {
  return {
    model_name: options.model,
    reasoning_effort: options.reasoningEffort,
    // Thinking is a per-model capability DeerFlow validates against the model
    // config, and the ChatMock profiles Breadboard writes do not declare it —
    // reasoning effort is how the depth is chosen instead.
    thinking_enabled: false,
    is_plan_mode: settings.planMode,
    subagent_enabled: settings.subagents,
    max_total_subagents: settings.maxSubagents,
  };
}
