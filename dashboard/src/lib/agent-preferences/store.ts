import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  defaultAgentPreferences, parseAgentPreferences, renderAgentPreferences,
  serializeAgentPreferences, validateAgentPreferences,
} from "./preferences.ts";

export function agentPreferencesPath(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid preferences owner.");
  return path.join(dashboardDataDir(), "agent-preferences", String(userId), "AGENT_PREFERENCES.md");
}

export function readAgentPreferences(userId: number) {
  try {
    return parseAgentPreferences(fs.readFileSync(agentPreferencesPath(userId), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultAgentPreferences();
    throw error;
  }
}

export function writeAgentPreferences(userId: number, raw: unknown) {
  const settings = validateAgentPreferences(raw);
  const file = agentPreferencesPath(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, serializeAgentPreferences(settings), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return settings;
}

/** Re-read for each new turn so switching off also applies to existing chats. */
export function agentPreferencesContext(userId: number | null): string {
  if (userId === null) return "";
  try {
    const settings = readAgentPreferences(userId);
    const context = renderAgentPreferences(settings);
    if (context) return context;
    return fs.existsSync(agentPreferencesPath(userId))
      ? "There are no active saved agent selection preferences for this turn. Use ordinary selection and ignore saved agent preferences from earlier turns."
      : "";
  } catch {
    // A broken optional settings file must not prevent a conversation.
    return "Agent preferences could not be read for this turn. Use ordinary agent selection; do not reuse saved preferences from earlier turns.";
  }
}
