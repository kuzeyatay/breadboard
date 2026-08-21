// The MatrAIx agent's chat identity: the command that reaches it, and the
// parsing of a message into a study request.
//
// A MatrAIx run is a simulated population study. The message says what the
// person wants to learn and who they want asked; the flags below are the parts
// of that a person may want to state exactly rather than leave to the model —
// how many respondents, which slice of the population, what to cut the results
// by, and which seed, because a seed is what makes a study repeatable.

export const MATRAIX_COMMAND = "/agents:matraix";
export const MATRAIX_AGENT_ID = "matraix";
export const MATRAIX_AGENT_NAME = "MatrAIx";

/** Below the 100 the clone materialises a cohort directory at, and above noise. */
export const MATRAIX_MAX_RESPONDENTS = 60;
export const MATRAIX_DEFAULT_RESPONDENTS = 12;
export const MATRAIX_DEFAULT_SEED = 42;

export type MatraixAllocation = "equalTotal" | "perCell" | "proportional";

export interface MatraixRequest {
  /** What the study is about, with every flag removed. */
  brief: string;
  respondents: number;
  seed: number;
  /** Persona dimension filters, `dimension -> accepted values`. */
  filters: Record<string, string[]>;
  /** Dimensions to sample evenly across. */
  stratify: string[];
  /** Dimensions to break the results down by in the report. */
  groupBy: string[];
  /** Persona sources (`wiki`, `gss`, `amazon`, …); empty means all of them. */
  sources: string[];
  allocation: MatraixAllocation;
  /** A pool path, for someone who has imported Persona 1M. */
  pool: string | null;
}

export type MatraixDefaults = Partial<
  Pick<MatraixRequest, "respondents" | "seed" | "allocation" | "sources" | "pool">
>;

/**
 * Extract the brief, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them.
 */
export function taskFromMatraixCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:matraix") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function matraixUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${MATRAIX_COMMAND} ${trimmed}` : MATRAIX_COMMAND;
}

const ALLOCATIONS = new Set<MatraixAllocation>(["equalTotal", "perCell", "proportional"]);

function clampRespondents(value: number): number {
  if (!Number.isFinite(value)) return MATRAIX_DEFAULT_RESPONDENTS;
  return Math.max(1, Math.min(Math.round(value), MATRAIX_MAX_RESPONDENTS));
}

/**
 * Split on whitespace, but keep quoted runs together.
 *
 * Persona dimension values are frequently several words — "North America",
 * "Parent of young kids", "Vocational / cert" — so a filter that could not
 * carry a space would be unable to name most of the population. Quotes work
 * around either half: `--filter "life_stage=Early career"` and
 * `--filter life_stage="Early career"` both parse.
 */
function tokenize(message: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const character of message.trim()) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** `age_bracket=25-34,35-44` → `["age_bracket", ["25-34", "35-44"]]`. */
function parseFilter(raw: string): [string, string[]] | null {
  const separator = raw.indexOf("=");
  if (separator <= 0) return null;
  const dimension = raw.slice(0, separator).trim();
  const values = raw
    .slice(separator + 1)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!dimension || !values.length) return null;
  return [dimension, values];
}

/**
 * Split a message into the study brief and the parts of the request the person
 * stated outright.
 *
 * `defaults` is the user's saved settings, which fill only what the message
 * left unsaid — a flag typed here always wins, because a preference you cannot
 * override in one message is a trap.
 */
export function parseMatraixRequest(
  message: string,
  defaults: MatraixDefaults = {},
): MatraixRequest {
  let respondents = clampRespondents(defaults.respondents ?? MATRAIX_DEFAULT_RESPONDENTS);
  let seed = defaults.seed ?? MATRAIX_DEFAULT_SEED;
  let allocation: MatraixAllocation = defaults.allocation ?? "equalTotal";
  let pool = defaults.pool ?? null;
  const sources = new Set<string>(defaults.sources ?? []);
  const filters: Record<string, string[]> = {};
  const stratify: string[] = [];
  const groupBy: string[] = [];

  // Flags are recognised anywhere in the message: people write the subject
  // first and the sample size as an afterthought at least as often as not.
  const words: string[] = [];
  const tokens = tokenize(message);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const inline = /^(--[a-z-]+)=([\s\S]+)$/.exec(token);
    const flag = inline ? inline[1] : token;
    const next = () => {
      if (inline) return inline[2];
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith("--")) return "";
      index += 1;
      return value;
    };
    switch (flag) {
      case "--personas":
      case "--respondents":
      case "-n": {
        const value = Number(next());
        if (Number.isFinite(value)) respondents = clampRespondents(value);
        continue;
      }
      case "--seed": {
        const value = Number(next());
        if (Number.isFinite(value)) seed = Math.trunc(value);
        continue;
      }
      case "--filter": {
        const parsed = parseFilter(next());
        if (parsed) filters[parsed[0]] = parsed[1];
        continue;
      }
      case "--stratify": {
        const value = next().trim();
        if (value && !stratify.includes(value)) stratify.push(value);
        continue;
      }
      case "--by":
      case "--group-by": {
        const value = next().trim();
        if (value && !groupBy.includes(value)) groupBy.push(value);
        continue;
      }
      case "--source": {
        const value = next().trim();
        if (value) sources.add(value);
        continue;
      }
      case "--allocation": {
        const value = next().trim() as MatraixAllocation;
        if (ALLOCATIONS.has(value)) allocation = value;
        continue;
      }
      case "--pool": {
        const value = next().trim();
        if (value) pool = value;
        continue;
      }
      default:
        words.push(token);
    }
  }

  return {
    brief: words.join(" ").trim(),
    respondents,
    seed,
    filters,
    stratify,
    groupBy,
    sources: [...sources],
    allocation,
    pool,
  };
}

/**
 * A one-line description of the cohort, for the run card's header. Written from
 * the request rather than the result, so it is there before sampling finishes.
 */
export function describeMatraixCohort(request: MatraixRequest): string {
  const parts = [`${request.respondents} respondent${request.respondents === 1 ? "" : "s"}`];
  const filters = Object.entries(request.filters);
  if (filters.length) {
    parts.push(filters.map(([key, values]) => `${key}: ${values.join(", ")}`).join("; "));
  }
  if (request.stratify.length) parts.push(`even across ${request.stratify.join(", ")}`);
  return parts.join(" · ");
}
