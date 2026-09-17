import { agentPreferenceTaskPresets } from "./task-presets.ts";

export interface AgentPreferenceTask {
  id: string;
  name: string;
  when: string;
  agents: string[];
}

export interface AgentPreferences {
  version: 1;
  enabled: boolean;
  fallback: "auto" | "ask";
  explainChoice: boolean;
  tasks: AgentPreferenceTask[];
  guidance: string;
}

export interface AgentPreferenceOption {
  command: string;
  name: string;
  description: string;
  group: string;
  manualOnly: boolean;
}

export const MAX_PREFERENCE_TASKS = 50;
export const MAX_PREFERENCE_AGENTS = 12;

export function defaultAgentPreferences(): AgentPreferences {
  return {
    version: 1,
    enabled: false,
    fallback: "auto",
    explainChoice: false,
    tasks: agentPreferenceTaskPresets(),
    guidance: "",
  };
}

export class AgentPreferencesError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentPreferencesError("Preferences must be an object.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) {
    throw new AgentPreferencesError(`${label} must be ${empty ? "at most" : "between 1 and"} ${max} characters.`);
  }
  return value.trim();
}

/** Reject invalid writes instead of silently losing part of the user's rules. */
export function validateAgentPreferences(value: unknown): AgentPreferences {
  const input = record(value);
  if (input.version !== 1 || typeof input.enabled !== "boolean" || typeof input.explainChoice !== "boolean") {
    throw new AgentPreferencesError("Invalid preference version or switch value.");
  }
  if (input.fallback !== "auto" && input.fallback !== "ask") {
    throw new AgentPreferencesError("Choose a valid fallback behavior.");
  }
  if (!Array.isArray(input.tasks) || input.tasks.length > MAX_PREFERENCE_TASKS) {
    throw new AgentPreferencesError(`Use at most ${MAX_PREFERENCE_TASKS} task rules.`);
  }
  const ids = new Set<string>();
  const tasks = input.tasks.map((raw): AgentPreferenceTask => {
    const task = record(raw);
    const id = text(task.id, "Task ID", 80);
    if (!/^[a-z0-9-]+$/i.test(id) || ids.has(id)) throw new AgentPreferencesError("Task IDs must be unique.");
    ids.add(id);
    if (!Array.isArray(task.agents) || task.agents.length > MAX_PREFERENCE_AGENTS) {
      throw new AgentPreferencesError(`Choose at most ${MAX_PREFERENCE_AGENTS} agents per task.`);
    }
    const agents = task.agents.map((agent) => text(agent, "Agent command", 180));
    if (agents.some((agent) => !/^\/agents?:[a-z0-9_.:-]+$/i.test(agent)) || new Set(agents).size !== agents.length) {
      throw new AgentPreferencesError("Choose unique agent commands from the catalog.");
    }
    return { id, name: text(task.name, "Task name", 100), when: text(task.when, "Task description", 800), agents };
  });
  return {
    version: 1, enabled: input.enabled, fallback: input.fallback,
    explainChoice: input.explainChoice, tasks,
    guidance: text(input.guidance, "Additional preferences", 6000, true),
  };
}

/** JSON is also valid YAML: the frontmatter holds the form; the body is editable Markdown. */
export function serializeAgentPreferences(settings: AgentPreferences): string {
  const { guidance, ...metadata } = validateAgentPreferences(settings);
  return `---\n${JSON.stringify(metadata, null, 2)}\n---\n${guidance}\n`;
}

export function parseAgentPreferences(markdown: string): AgentPreferences {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
  if (!match) throw new AgentPreferencesError("The preferences file has invalid frontmatter.");
  try {
    return validateAgentPreferences({ ...record(JSON.parse(match[1])), guidance: match[2].trim() });
  } catch (error) {
    if (error instanceof AgentPreferencesError) throw error;
    throw new AgentPreferencesError("The preferences file contains invalid settings.");
  }
}

/** A soft selection policy only; it never changes tool grants or dispatches agents. */
export function renderAgentPreferences(settings: AgentPreferences): string {
  if (!settings.enabled) return "";
  const rules = settings.tasks.filter((task) => task.agents.length);
  const neutralTasks = settings.tasks.filter((task) => !task.agents.length);
  if (!rules.length && !settings.guidance && !settings.explainChoice) return "";
  return [
    "## User's agent preferences",
    "These are the current saved agent preferences; replace any preferences from earlier turns. Apply them only when choosing an agent for the current task. Match the intent and required output, not keywords in quoted material. Explicit user choices and the current request take priority. A saved choice takes precedence over the catalog's default preference order when the agent fits. Preferences do not require delegation when Hermes can answer directly. Tasks not listed below have no saved bias: use ordinary selection for them.",
    "Only use agents available on this surface with suitable inputs and existing permissions. A listed command does not grant tools, authorize a launch, or activate a persona. If an agent requires a form or explicit selection, offer that selection instead of claiming to launch it. Do not apply unrelated task rules. When rules overlap, prefer the most specific matching rule.",
    neutralTasks.length
      ? `No preference for: ${neutralTasks.map((task) => task.name.replace(/[\r\n]+/g, " ")).join("; ")}. If the task most specifically matches one of these, use ordinary selection even if a broader preferred rule also loosely matches. Apply preferences separately for distinct deliverables.`
      : "",
    settings.fallback === "ask"
      ? "If no preferred agent fits or is available for a matching task, ask the user before substituting another agent."
      : "If no preferred agent fits or is available for a matching task, choose another suitable available agent and briefly mention the substitution.",
    settings.explainChoice ? "When selecting an agent, briefly name it and explain why it fits before starting the work." : "",
    ...rules.map((task) => [
      `### ${task.name.replace(/[\r\n]+/g, " ")}`,
      `For requests like: ${task.when}`,
      `Preferred agents, in order: ${task.agents.join(" → ")}. Check fit before falling back to the next choice.`,
    ].join("\n")),
    settings.guidance ? `### Additional selection preferences\n${settings.guidance}` : "",
  ].filter(Boolean).join("\n\n");
}
