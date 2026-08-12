// The OpenScience agent's chat identity: the slash command that activates it
// and the parsing of a message into a research goal. Mirrors the other runtime
// agents so every one is reached the same way — pick it in the palette, then
// describe what you want investigated.

export const OPENSCIENCE_COMMAND = "/agents:openscience";
export const OPENSCIENCE_AGENT_ID = "openscience";
export const OPENSCIENCE_AGENT_NAME = "OpenScience";

/**
 * The goal carried by an `/agents:openscience …` message, or null when the
 * message is not addressed to this agent. An empty string means the command was
 * typed on its own — the palette inserts the token first and the person is
 * still writing, so the caller waits instead of launching an empty run.
 *
 * Other slash tokens stacked in front are preserved in the returned goal so the
 * capability resolver still sees them and can refuse the combination in the
 * words every surface uses.
 */
export function taskFromOpenscienceCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:openscience(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function openscienceUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${OPENSCIENCE_COMMAND} ${trimmed}` : OPENSCIENCE_COMMAND;
}
