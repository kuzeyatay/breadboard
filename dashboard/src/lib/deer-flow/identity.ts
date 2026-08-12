// The DeerFlow agent's chat identity: the slash command that reaches it, and
// the parsing of a message into a task.
//
// Mirrors the Vibe Trading / Career Ops / Agent Reach identity modules so every
// runtime agent is reached the same way — pick it from the palette, prompt it in
// chat, and its own run card appears inline for that turn.
//
// DeerFlow is conversational end to end: the cloned harness owns a lead agent
// with a sandbox, subagent delegation, skills and memory, so a sentence is
// exactly the right input and is forwarded verbatim.

export const DEER_FLOW_COMMAND = "/agents:deer-flow";
export const DEER_FLOW_AGENT_ID = "deer-flow";
export const DEER_FLOW_AGENT_NAME = "DeerFlow";

/**
 * Extract the task, preserving any other slash tokens the user stacked in front
 * of the command so the capability resolver still sees them.
 *
 * Returns null when the command is not there at all. An empty string means the
 * command was typed on its own — the palette inserts the token first and the
 * person is still writing, so the caller waits instead of launching an empty
 * run.
 */
export function taskFromDeerFlowCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:deer-flow") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function deerFlowUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${DEER_FLOW_COMMAND} ${trimmed}` : DEER_FLOW_COMMAND;
}

/**
 * A short label for the run card and the conversation list. The prompt is the
 * user's own message directly above the card, so the label only has to be
 * recognisable at a glance.
 */
export function deerFlowRunLabel(task: string): string {
  const firstLine = task.trim().split(/\r?\n/).find((line) => line.trim()) ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine || "DeerFlow task";
}
