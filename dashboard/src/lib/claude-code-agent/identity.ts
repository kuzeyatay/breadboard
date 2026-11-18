export const CLAUDE_CODE_COMMAND = "/agents:claude-code";
export const CLAUDE_CODE_AGENT_ID = "claude-code";
export const CLAUDE_CODE_AGENT_NAME = "Claude Code";

/** The task with the command token removed; other stacked tokens stay in front. */
export function taskFromClaudeCodeCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:claude-code") selected = true;
    else precedingTokens.push(`/${match[1]}`);
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function claudeCodeUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${CLAUDE_CODE_COMMAND} ${trimmed}` : CLAUDE_CODE_COMMAND;
}
