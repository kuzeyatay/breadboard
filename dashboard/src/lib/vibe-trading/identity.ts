// The Vibe Trading agent's chat identity: the slash command that reaches it,
// and the parsing of a prompt into a run request.
//
// Mirrors the Career Ops / Agent Reach / Deep Research identity modules so every
// runtime agent is reached the same way — pick it from the Agents tab or the
// slash menu, prompt it in chat, and its own surface appears inline for that
// turn.
//
// Unlike [[trading-agent]], which analyses one instrument on one date and
// therefore takes a typed form rather than a sentence, this agent is
// conversational end to end: the cloned runtime owns a general finance-research
// loop (market data, factors, backtests, hypotheses, shadow accounts), so a
// prompt is exactly the right input and is forwarded verbatim.

export const VIBE_TRADING_COMMAND = "/agents:vibe-trading";
export const VIBE_TRADING_AGENT_ID = "vibe-trading";
export const VIBE_TRADING_AGENT_NAME = "Vibe Trading";

/**
 * Extract the task, preserving any other slash tokens the user stacked in front
 * of the command so the capability resolver still sees them.
 *
 * Returns null when the command is not there at all.
 */
export function taskFromVibeTradingCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:vibe-trading") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function vibeTradingUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${VIBE_TRADING_COMMAND} ${trimmed}` : VIBE_TRADING_COMMAND;
}

/**
 * A short label for the run card and the conversation list. The prompt is the
 * user's own message directly above the card, so the label only has to be
 * recognisable at a glance.
 */
export function vibeTradingRunLabel(task: string): string {
  const firstLine = task.trim().split(/\r?\n/).find((line) => line.trim()) ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine || "Finance research";
}
