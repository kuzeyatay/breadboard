// The Deep Research agent's chat identity: the slash command that activates it
// and the parsing of a prompt into a run request.
//
// Mirrors the Agent TARS / Agent Browser identity modules so every runtime agent
// is reached the same way — select it in the Agents tab, then prompt it in chat.

export const DEEP_RESEARCH_SLASH_COMMAND = "/agents:deep-research";

/** Chat defaults. Deliberately smaller than the engine's own: every search is a
 * full model call with web search, so breadth × depth is minutes of waiting. */
export const DEFAULT_BREADTH = 3;
export const DEFAULT_DEPTH = 1;

export interface ResearchRequest {
  query: string;
  breadth: number;
  depth: number;
  output: "report" | "answer";
}

export function deepResearchUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed
    ? `${DEEP_RESEARCH_SLASH_COMMAND} ${trimmed}`
    : DEEP_RESEARCH_SLASH_COMMAND;
}

export function taskFromDeepResearchCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:deep-research(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Split a prompt into the research question and its run shape. Options the
 * removed dialog used to offer are inline flags, so the chat stays the only
 * surface: `--breadth 4` / `-b 4`, `--depth 2` / `-d 2`, `--answer`, `--report`.
 * Anything unrecognized stays part of the question.
 *
 * `defaults` is where the run starts before any flag is read — the user's saved
 * settings, when the caller has them. A flag in the message still overwrites it,
 * which is the whole precedence rule: the message beats the preference.
 */
export function parseResearchRequest(
  task: string,
  defaults?: Partial<Omit<ResearchRequest, "query">>,
): ResearchRequest {
  let breadth = clamp(defaults?.breadth ?? DEFAULT_BREADTH, 1, 10);
  let depth = clamp(defaults?.depth ?? DEFAULT_DEPTH, 1, 5);
  let output: ResearchRequest["output"] = defaults?.output === "answer" ? "answer" : "report";

  const query = task
    .replace(/(?:^|\s)--(answer|report)\b/gi, (_match, mode: string) => {
      output = mode.toLowerCase() === "answer" ? "answer" : "report";
      return " ";
    })
    .replace(/(?:^|\s)(?:--breadth|-b)[= ](\d{1,2})\b/gi, (_match, value: string) => {
      breadth = clamp(Number(value), 1, 10);
      return " ";
    })
    .replace(/(?:^|\s)(?:--depth|-d)[= ](\d{1,2})\b/gi, (_match, value: string) => {
      depth = clamp(Number(value), 1, 5);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  return { query, breadth, depth, output };
}
