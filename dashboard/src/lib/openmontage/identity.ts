export const OPENMONTAGE_COMMAND = "/agents:openmontage";
export const OPENMONTAGE_AGENT_ID = "openmontage";
export const OPENMONTAGE_AGENT_NAME = "OpenMontage";

/**
 * The brief carried by a `/agents:openmontage …` message, or null when the
 * message is not addressed to this agent. An empty string means the command was
 * typed on its own — the palette inserts the token first and the person is
 * still writing, so the caller waits instead of launching an empty production.
 */
export function briefFromOpenMontageCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:openmontage(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function openMontageUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${OPENMONTAGE_COMMAND} ${trimmed}` : OPENMONTAGE_COMMAND;
}
