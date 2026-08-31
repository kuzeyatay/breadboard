export const OPENEXECUTIVE_COMMAND = "/agents:openexecutive";
export const OPENEXECUTIVE_AGENT_ID = "openexecutive";
export const OPENEXECUTIVE_AGENT_NAME = "OpenExecutive";

export const DEFAULT_OPENEXECUTIVE_MAX_ITERATIONS = 15;
export const MIN_OPENEXECUTIVE_MAX_ITERATIONS = 1;
export const MAX_OPENEXECUTIVE_MAX_ITERATIONS = 30;

export interface OpenExecutiveRequest {
  task: string;
  maxIterations: number;
  committeeReview: boolean;
}

/** Extract the assignment while preserving capability tokens stacked before it. */
export function taskFromOpenExecutiveCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:openexecutive") selected = true;
    else precedingTokens.push(`/${match[1]}`);
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function openExecutiveUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${OPENEXECUTIVE_COMMAND} ${trimmed}` : OPENEXECUTIVE_COMMAND;
}

function clampIterations(value: number): number {
  return Math.min(
    MAX_OPENEXECUTIVE_MAX_ITERATIONS,
    Math.max(MIN_OPENEXECUTIVE_MAX_ITERATIONS, Math.round(value)),
  );
}

/** Stored defaults form the base; explicit message flags always win. */
export function parseOpenExecutiveRequest(
  value: string,
  defaults: Partial<Omit<OpenExecutiveRequest, "task">> = {},
): OpenExecutiveRequest {
  let maxIterations = clampIterations(
    defaults.maxIterations ?? DEFAULT_OPENEXECUTIVE_MAX_ITERATIONS,
  );
  let committeeReview = defaults.committeeReview ?? false;
  const task = value
    .replace(
      /(?:^|\s)(?:--iterations|--max-iterations)[= ](\d{1,2})\b/gi,
      (_match, raw: string) => {
        maxIterations = clampIterations(Number(raw));
        return " ";
      },
    )
    .replace(/(?:^|\s)--no-committee\b/gi, () => {
      committeeReview = false;
      return " ";
    })
    .replace(/(?:^|\s)--committee\b/gi, () => {
      committeeReview = true;
      return " ";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  return { task, maxIterations, committeeReview };
}
