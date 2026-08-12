export const HYPERFRAMES_COMMAND = "/agents:hyperframes";
export const HYPERFRAMES_AGENT_ID = "hyperframes";
export const HYPERFRAMES_AGENT_NAME = "HyperFrames";

/**
 * The brief carried by a `/agents:hyperframes …` message, or null when the
 * message is not addressed to this agent. An empty string means the command was
 * typed on its own — the palette inserts the token first and the person is still
 * writing, so the caller waits instead of launching an empty run.
 */
export function briefFromHyperframesCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:hyperframes(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function hyperframesUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${HYPERFRAMES_COMMAND} ${trimmed}` : HYPERFRAMES_COMMAND;
}
