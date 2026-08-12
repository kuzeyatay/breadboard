export const CODEX_COMMAND = "/agents:codex";
export const CODEX_AGENT_ID = "codex";
export const CODEX_AGENT_NAME = "Codex";

export function taskFromCodexCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:codex") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function codexUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${CODEX_COMMAND} ${trimmed}` : CODEX_COMMAND;
}
