export const OPENCODE_COMMAND = "/agents:opencode";
export const OPENCODE_AGENT_ID = "opencode";
export const OPENCODE_AGENT_NAME = "OpenCode";

export function taskFromOpenCodeCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:opencode") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function openCodeUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${OPENCODE_COMMAND} ${trimmed}` : OPENCODE_COMMAND;
}
