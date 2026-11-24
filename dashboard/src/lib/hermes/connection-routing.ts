// Natural-language routing over the turn's connections, and what to do when one fails.
//
// Every connected MCP server and connected app is already on the table each
// turn, but as a flat list of "use connection=X with one of these tools" lines
// in registry order. Nothing said which of them this request is about, so the
// model picked by whichever line it read first, and when that call failed it
// reported the failure instead of trying the connection beside it.
//
// Two pure pieces fix that, on the same lexical ranker the skill shortlist uses
// (skill-relevance.ts), so a turn's routing stays a function of its text and
// its catalogue with no model call:
//
//   * `shortlistConnections` + `renderConnectionShortlistDirective`: the
//     connections whose names and tool names match the request, best first,
//     with the order to try them in.
//   * `mcpFailureGuidance`: appended to a failed mcp_call's error, so the model
//     reads its next move from the failure itself — retry a transient error
//     once, then the closest other connection, then a built-in tool — rather
//     than ending the turn on it.

import { rankSkillsForRequest, shortlistSkills } from "./skill-relevance.ts";

export interface ConnectionCandidate {
  slug: string;
  name: string;
  /** Exact tool or action names this connection offers this turn. */
  tools: readonly string[];
}

export interface ShortlistedConnection {
  slug: string;
  name: string;
  /** The tools whose names share a term with the request, at most a few. */
  matchingTools: string[];
}

const SHORTLIST_LIMIT = 3;
const TOOL_TERMS_PER_CONNECTION = 60;

function words(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.:/]+/g, " ").toLowerCase();
}

/** A connection reads like a skill to the ranker: tool names carry the signal. */
function asSkill(connection: ConnectionCandidate) {
  return {
    slug: connection.slug,
    name: `${words(connection.name)} ${connection.tools.slice(0, TOOL_TERMS_PER_CONNECTION).map(words).join(" ")}`,
    description: "",
    connection,
  };
}

function matchingTools(connection: ConnectionCandidate, terms: readonly string[]): string[] {
  return connection.tools
    .filter((tool) => terms.some((term) => words(tool).split(" ").includes(term)))
    .slice(0, 4);
}

/** The connections this request is about, closest first; empty when none clearly is. */
export function shortlistConnections(
  request: string,
  catalog: readonly ConnectionCandidate[],
  limit = SHORTLIST_LIMIT,
): ShortlistedConnection[] {
  return shortlistSkills(request, catalog.map(asSkill), { limit }).map((entry) => ({
    slug: entry.skill.connection.slug,
    name: entry.skill.connection.name,
    matchingTools: matchingTools(entry.skill.connection, entry.matched),
  }));
}

/** The system-prompt section naming those connections and the order to try them in. */
export function renderConnectionShortlistDirective(shortlist: readonly ShortlistedConnection[]): string {
  if (shortlist.length === 0) return "";
  return [
    "# relevant_connections",
    "These connections match this request, best first. Use the first one that offers a tool for the task through mcp_call. If its call fails or cannot do the job, move to the next one, then to a built-in Breadboard tool, before telling the user it could not be done. When none fits, ignore this section and do not mention it.",
    ...shortlist.map((connection, index) =>
      `${index + 1}. ${connection.slug} (${connection.name})${connection.matchingTools.length ? ` — e.g. ${connection.matchingTools.join(", ")}` : ""}`,
    ),
  ].join("\n");
}

/** Failures worth one retry: the connection itself was briefly unable, not wrong. */
const TRANSIENT = new Set([
  "mcp_tool_timeout",
  "mcp_runtime_unavailable",
  "BREADBOARD_RESOURCE_EXHAUSTED",
  "mcp_not_connected",
]);

/**
 * What the model should do after `failedSlug` failed on `tool`. Alternatives
 * are ranked by how well their tools match the failed call, so the closest
 * stand-in is named first.
 */
export function mcpFailureGuidance(input: {
  failedSlug: string;
  tool: string;
  code: string;
  args?: unknown;
  alternatives: readonly ConnectionCandidate[];
}): string {
  if (input.code === "mcp_tool_cancelled") return "";
  const others = input.alternatives.filter((candidate) => candidate.slug !== input.failedSlug);
  const argsText = input.args && typeof input.args === "object" ? Object.keys(input.args).join(" ") : "";
  // Matching connections first; with no match, any other enabled one may still
  // carry the job, so they are named rather than hidden.
  const ranked = rankSkillsForRequest(`${words(input.tool)} ${words(argsText)}`, others.map(asSkill))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => entry.skill.connection);
  const steps = [
    TRANSIENT.has(input.code) ? "Retry this call once." : "",
    ranked.length
      ? `${TRANSIENT.has(input.code) ? "Then try" : "Try"} another connection that can do the same job: ${ranked.map((candidate) => `${candidate.slug} (${candidate.name})`).join(", ")}.`
      : "",
    "If no connection can, use a built-in Breadboard tool (web, browser, files, terminal) or do the work directly, and only report failure once those are exhausted.",
  ].filter(Boolean);
  return `Fallback: ${steps.join(" ")}`;
}

/** Backoff before each retry, after Codex's streamable-HTTP MCP client (rmcp-client). */
export const TRANSIENT_RETRY_DELAYS_MS = [250, 1_000] as const;

/**
 * Run `call`, retrying only when `isTransient` says the failure never reached
 * the server and the call is `idempotent`. A write is never repeated: a retry
 * of a call that did land would perform it twice.
 */
export async function retryTransient<T>(
  call: () => Promise<T>,
  options: {
    idempotent: boolean;
    isTransient: (error: unknown) => boolean;
    signal?: AbortSignal;
    delaysMs?: readonly number[];
  },
): Promise<T> {
  const delays = options.idempotent ? options.delaysMs ?? TRANSIENT_RETRY_DELAYS_MS : [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= delays.length || options.signal?.aborted || !options.isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}
