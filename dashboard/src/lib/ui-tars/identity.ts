export const AGENT_TARS_SLASH_COMMAND = "/agents:agent-tars";
export const AGENT_TARS_LOGO_PATH = "/agents/agent-tars.png";

const UPSTREAM_RUN_ERROR = /^Sorry, an error occurred while processing your request:/i;

/** Compatibility for runs produced before the adapter classified SDK errors. */
export function agentTarsFailureMessage(value: unknown): string | null {
  if (typeof value !== "string" || !UPSTREAM_RUN_ERROR.test(value.trim())) return null;
  return /\bconnection error\b/i.test(value)
    ? "Agent TARS could not connect to the configured model endpoint"
    : "Agent TARS could not complete the model request";
}

export function agentTarsUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${AGENT_TARS_SLASH_COMMAND} ${trimmed}` : AGENT_TARS_SLASH_COMMAND;
}

export function taskFromAgentTarsCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:agent-tars(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}
