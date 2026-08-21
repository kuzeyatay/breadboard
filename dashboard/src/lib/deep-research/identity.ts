// The Deep Research agent's chat identity: the slash command that activates it
// and the parsing of a prompt into a run request.
//
// Mirrors the Agent TARS / Agent Browser identity modules so every runtime agent
// is reached the same way — select it in the Agents tab, then prompt it in chat.

export const DEEP_RESEARCH_SLASH_COMMAND = "/agents:deep-research";

/**
 * The agent id every ledger keys this agent by: its memory scope, its launch
 * record, and the evidence entry the panel renders. One author, because the
 * three only line up if they agree on the spelling.
 */
export const DEEP_RESEARCH_AGENT_ID = "deep_research";

/** Match the upstream deep-research defaults. A report is expected to branch
 * once and then investigate the important gaps it discovers. */
export const DEFAULT_BREADTH = 4;
export const DEFAULT_DEPTH = 2;

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
  const source = value.trimStart();
  const command = source.match(/^\/agents:deep-research(?:\s+|$)/i);
  if (!command) return null;
  return source.slice(command[0].length).trim();
}

/**
 * Recognize a deliberate plain-language request without treating a mention of
 * the feature ("what is deep research?") as an invocation.
 *
 * This stays separate from the slash-command parser because the command is a
 * persistent composer selection, while natural language is a one-turn intent.
 */
export function taskFromDeepResearchIntent(value: string): string | null {
  const source = value.trim();
  // An explicit natural-language instruction is just as intentional as the
  // slash command in a normal agent turn. Keep mentions in ordinary chat by
  // requiring an action verb and accepting the directive only at either edge.
  const prefix = source.match(
    /^(?:please\s+)?(?:(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)|(?:i\s+(?:want|need|would\s+like)\s+you\s+to\s+))?(?:do|perform|conduct|run|use)\s+(?:a\s+)?deep(?:-|\s+)research\b(?:\s+(?:on|into|about|for|to))?\s*[:;,\u2014-]?\s*/i,
  );
  if (prefix) return source.slice(prefix[0].length).trim();

  const suffix = source.match(
    /(?:\s*[,;:\u2014-]\s*|\s+)(?:please\s+)?(?:do|perform|conduct|run|use)\s+(?:a\s+)?deep(?:-|\s+)research(?:\s+(?:on|into|about|for)\s+this)?\s*[.!?]*$/i,
  );
  if (!suffix) return null;
  return source
    .slice(0, suffix.index)
    .replace(/[\s,;:\u2014-]+$/u, "")
    .trim();
}

export interface DirectDeepResearchInvocation {
  task: string;
  /** Only a canonical slash command selects the persistent composer agent. */
  selectAgent: boolean;
}

/**
 * Decide whether the chat host should launch a visible Deep Research run.
 *
 * Super Agent owns natural-language requests itself so it can delegate the run
 * privately and synthesize the result. A canonical slash command remains an
 * explicit request for the visible, persistent runtime agent in either mode.
 */
export function directDeepResearchInvocation(
  value: string,
  superAgent: boolean,
): DirectDeepResearchInvocation | null {
  const commandTask = taskFromDeepResearchCommand(value);
  if (commandTask !== null) return { task: commandTask, selectAgent: true };
  if (superAgent) return null;
  const intentTask = taskFromDeepResearchIntent(value);
  return intentTask === null ? null : { task: intentTask, selectAgent: false };
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
  let output: ResearchRequest["output"] =
    defaults?.output === "answer" ? "answer" : "report";

  const query = task
    .replace(/(?:^|\s)--(answer|report)\b/gi, (_match, mode: string) => {
      output = mode.toLowerCase() === "answer" ? "answer" : "report";
      return " ";
    })
    .replace(
      /(?:^|\s)(?:--breadth|-b)[= ](\d{1,2})\b/gi,
      (_match, value: string) => {
        breadth = clamp(Number(value), 1, 10);
        return " ";
      },
    )
    .replace(
      /(?:^|\s)(?:--depth|-d)[= ](\d{1,2})\b/gi,
      (_match, value: string) => {
        depth = clamp(Number(value), 1, 5);
        return " ";
      },
    )
    .replace(/\s+/g, " ")
    .trim();

  return { query, breadth, depth, output };
}
