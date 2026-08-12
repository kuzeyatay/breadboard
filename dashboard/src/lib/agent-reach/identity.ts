// The Agent Reach agent's chat identity: the slash command that activates it
// and the parsing of a prompt into a task. Mirrors the other runtime agents so
// every one is reached the same way — select it in the Agents tab, then prompt
// it in chat.

export const AGENT_REACH_COMMAND = "/agents:agent-reach";
export const AGENT_REACH_AGENT_ID = "agent-reach";
export const AGENT_REACH_AGENT_NAME = "Agent Reach";

export function taskFromAgentReachCommand(value: string): string | null {
  const trimmed = value.trim();
  const match = /^\/agents:agent-reach(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function agentReachUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${AGENT_REACH_COMMAND} ${trimmed}` : AGENT_REACH_COMMAND;
}
