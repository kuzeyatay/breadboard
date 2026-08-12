export const AGENT_BROWSER_SLASH_COMMAND = "/agents:agent-browser";

export function agentBrowserUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed
    ? `${AGENT_BROWSER_SLASH_COMMAND} ${trimmed}`
    : AGENT_BROWSER_SLASH_COMMAND;
}

export function taskFromAgentBrowserCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:agent-browser(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}
