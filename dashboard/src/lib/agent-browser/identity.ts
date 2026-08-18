export const AGENT_BROWSER_SLASH_COMMAND = "/agents:agent-browser";

export function agentBrowserUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed
    ? `${AGENT_BROWSER_SLASH_COMMAND} ${trimmed}`
    : AGENT_BROWSER_SLASH_COMMAND;
}

/**
 * A sentence for the codes `POST /runs` refuses with. The codes are the API's,
 * not a person's, and one of them — the sign-in window holding the browser
 * profile — has a fix the reader can actually act on.
 */
export function agentBrowserStartFailure(code: unknown): string {
  switch (code) {
    case "sign_in_window_open":
      return "Close the browser sign-in window on your profile page first — a run needs that browser to itself.";
    case "runtime_unavailable":
      return "Agent Browser is not installed on this computer.";
    case "agent_disabled":
      return "This Agent Browser agent is switched off.";
    case "model_not_configured":
      return "This Agent Browser agent has no model configured.";
    case "rate_limited":
      return "Too many Agent Browser runs just started. Give it a minute.";
    default:
      return typeof code === "string" && code
        ? code
        : "The Agent Browser run could not start.";
  }
}

export function taskFromAgentBrowserCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:agent-browser(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}
