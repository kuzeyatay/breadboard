// The OpenWork agent's chat identity: the slash command that activates it and
// the parsing of a message into a task. Mirrors the other runtime agents so
// every one is reached the same way — pick it in the palette, then prompt it.

export const OPENWORK_COMMAND = "/agents:openwork";
export const OPENWORK_AGENT_ID = "openwork";
export const OPENWORK_AGENT_NAME = "OpenWork";

/**
 * The task carried by an `/agents:openwork …` message, or null when the message
 * is not addressed to this agent. An empty string means the command was typed
 * on its own — the palette inserts the token first and the person is still
 * writing, so the caller waits instead of launching an empty run.
 */
export function taskFromOpenworkCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:openwork(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function openworkUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${OPENWORK_COMMAND} ${trimmed}` : OPENWORK_COMMAND;
}
