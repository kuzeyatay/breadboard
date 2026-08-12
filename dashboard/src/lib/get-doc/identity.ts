// The Get Doc agent's chat identity: the slash command that activates it, and
// the parsing of a prompt into a search request.
//
// Mirrors the other runtime agents so every one is reached the same way —
// select it in the Agents palette, then describe the paper you are after.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const GET_DOC_COMMAND = "/agents:get-doc";
export const GET_DOC_AGENT_ID = "get-doc";
export const GET_DOC_AGENT_NAME = "Get Doc";

/** The catalogs a search can draw on. `core` only participates with a key. */
export const DOCUMENT_SOURCE_IDS = [
  "openalex",
  "arxiv",
  "europepmc",
  "semanticscholar",
  "crossref",
  "core",
] as const;

export type DocumentSourceId = (typeof DOCUMENT_SOURCE_IDS)[number];

export const DEFAULT_RESULT_LIMIT = 10;
export const MAX_RESULT_LIMIT = 40;

export interface DocumentSearchRequest {
  /** What to search for, in the user's own words. */
  query: string;
  /** How many documents to list. */
  limit: number;
  /** Keep only results with a legally downloadable full text. */
  openAccessOnly: boolean;
  /** Publication year bounds, or null for "any". */
  yearFrom: number | null;
  yearTo: number | null;
  /** Which catalogs to query. Null means "every one that is available". */
  sources: DocumentSourceId[] | null;
}

export function getDocUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${GET_DOC_COMMAND} ${trimmed}` : GET_DOC_COMMAND;
}

export function taskFromGetDocCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:get-doc(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function parseSourceList(value: string): DocumentSourceId[] | null {
  const requested = value
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter((entry): entry is DocumentSourceId =>
      (DOCUMENT_SOURCE_IDS as readonly string[]).includes(entry),
    );
  return requested.length ? [...new Set(requested)] : null;
}

/**
 * Split a prompt into the search itself and the shape of the run. Every option
 * is an inline flag so chat stays the only surface: `--limit 20` / `-n 20`,
 * `--since 2020`, `--until 2024`, `--all` (include results with no free full
 * text), `--oa` (the default: downloadable only), `--source openalex,arxiv`.
 * Anything unrecognized stays part of the query.
 *
 * `defaults` is where the request starts before any flag is read — the user's
 * saved settings, when the caller has them. A flag in the message still wins,
 * which is the whole precedence rule.
 */
export function parseDocumentSearchRequest(
  task: string,
  defaults?: Partial<Omit<DocumentSearchRequest, "query">>,
): DocumentSearchRequest {
  let limit = clamp(defaults?.limit ?? DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT);
  let openAccessOnly = defaults?.openAccessOnly ?? true;
  let yearFrom = defaults?.yearFrom ?? null;
  let yearTo = defaults?.yearTo ?? null;
  let sources = defaults?.sources ?? null;

  const query = task
    .replace(/(?:^|\s)--all\b/gi, () => {
      openAccessOnly = false;
      return " ";
    })
    .replace(/(?:^|\s)--(?:oa|open-access)\b/gi, () => {
      openAccessOnly = true;
      return " ";
    })
    .replace(/(?:^|\s)(?:--limit|-n)[= ](\d{1,3})\b/gi, (_match, value: string) => {
      limit = clamp(Number(value), 1, MAX_RESULT_LIMIT);
      return " ";
    })
    .replace(/(?:^|\s)--since[= ](\d{4})\b/gi, (_match, value: string) => {
      yearFrom = clamp(Number(value), 1500, 2200);
      return " ";
    })
    .replace(/(?:^|\s)--until[= ](\d{4})\b/gi, (_match, value: string) => {
      yearTo = clamp(Number(value), 1500, 2200);
      return " ";
    })
    .replace(/(?:^|\s)--source[= ]([a-z0-9,\s]+?)(?=\s--|\s*$)/gi, (_match, value: string) => {
      sources = parseSourceList(value) ?? sources;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  // A range typed backwards is a slip, not a request for no results.
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    [yearFrom, yearTo] = [yearTo, yearFrom];
  }

  return { query, limit, openAccessOnly, yearFrom, yearTo, sources };
}
