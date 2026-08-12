export const RUFLO_COMMAND = "/agents:ruflo";
export const RUFLO_AGENT_ID = "ruflo";
export const RUFLO_AGENT_NAME = "Ruflo";

/**
 * Extract the objective from a Ruflo invocation, preserving any other slash
 * tokens (skills, prompts) the user stacked in front of it so the command
 * resolver still sees them. Mirrors the OpenCode parser.
 */
export function taskFromRufloCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:ruflo") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function rufloUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${RUFLO_COMMAND} ${trimmed}` : RUFLO_COMMAND;
}
