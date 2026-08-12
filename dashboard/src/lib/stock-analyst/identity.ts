// The Stock Analyst agent's chat identity: the slash command that reaches it,
// and the parsing of a prompt into a run request.
//
// Mirrors the Vibe Trading / Career Ops / Agent Reach identity modules so every
// runtime agent is reached the same way — pick it from the Agents tab or the
// slash menu, prompt it in chat, and its own surface appears inline for that
// turn.
//
// This is the third agent in the finance domain and the three do not overlap.
// [[trading-agent]] analyses one instrument on one date through a debate, and
// therefore takes a typed form. [[vibe-trading]] is a quant research loop —
// factors, backtests, hypotheses. This one is the daily watchlist analyst: it
// answers questions about named stocks across the A-share, Hong Kong, US,
// Japanese, Korean and Taiwanese markets using live quotes, K-lines, chip
// distribution, sector rankings, news and its own backtested strategy skills.
// A question is exactly the right input, so the prompt is forwarded verbatim.

export const STOCK_ANALYST_COMMAND = "/agents:stock-analyst";
export const STOCK_ANALYST_AGENT_ID = "stock-analyst";
export const STOCK_ANALYST_AGENT_NAME = "Stock Analyst";

/**
 * Extract the question, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them.
 *
 * Returns null when the command is not there at all.
 */
export function taskFromStockAnalystCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:stock-analyst") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function stockAnalystUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${STOCK_ANALYST_COMMAND} ${trimmed}` : STOCK_ANALYST_COMMAND;
}

/**
 * A short label for the run card and the conversation list. The question is the
 * user's own message directly above the card, so the label only has to be
 * recognisable at a glance.
 */
export function stockAnalystRunLabel(task: string): string {
  const firstLine = task.trim().split(/\r?\n/).find((line) => line.trim()) ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine || "Stock question";
}
