import type Database from "better-sqlite3";
import { artifactEditorMode } from "./artifact-editor-types.ts";
import { loadArtifactEditor } from "./artifact-document-editor.ts";
import { artifactMatchesSearch } from "./artifact-search.ts";
import {
  presentArtifact,
  readArtifactSource,
  type ArtifactRow,
} from "./artifact-store.ts";
import type { PresentedArtifact } from "./artifact-types.ts";

const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 50;
const DEFAULT_CONTENT_SCAN_LIMIT = 25;
const MAX_QUERY_LENGTH = 500;
const MAX_QUERY_TERMS = 16;
const MAX_SNIPPET_LENGTH = 360;

export interface AgentArtifactSearchMatch {
  artifact: PresentedArtifact;
  matchedIn: "catalog" | "content";
  snippet?: string;
}

export interface AgentArtifactSearchResult {
  query: string;
  matches: AgentArtifactSearchMatch[];
  scopeArtifactCount: number;
  catalogMatchCount: number;
  contentArtifactsInspected: number;
  contentInspectionFailures: number;
  contentSearchTruncated: boolean;
  nextContentOffset: number | null;
}

interface AgentArtifactSearchOptions {
  artifacts: ArtifactRow[];
  query: string;
  limit?: number;
  includeContent?: boolean;
  contentOffset?: number;
  maxContentArtifacts?: number;
  database?: Database.Database;
  storageRoot?: string;
  signal?: AbortSignal;
}

function normalizedQuery(value: string): { query: string; terms: string[] } {
  const query = value.trim().slice(0, MAX_QUERY_LENGTH);
  const terms = query
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, MAX_QUERY_TERMS);
  return { query, terms };
}

function contentMatch(text: string, terms: string[]): boolean {
  const normalized = text.toLocaleLowerCase();
  return terms.every((term) => normalized.includes(term));
}

function contentSnippet(text: string, terms: string[]): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  const lower = compact.toLocaleLowerCase();
  const positions = terms
    .map((term) => lower.indexOf(term))
    .filter((position) => position >= 0);
  const first = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, first - Math.floor(MAX_SNIPPET_LENGTH / 3));
  const end = Math.min(compact.length, start + MAX_SNIPPET_LENGTH);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${
    end < compact.length ? "..." : ""
  }`;
}

async function searchableArtifactContent(
  artifact: ArtifactRow,
  options: Pick<
    AgentArtifactSearchOptions,
    "database" | "storageRoot" | "signal"
  >,
): Promise<string> {
  // Every artifact has a bounded source file. For imported native files this
  // is only a manifest, so fall through to the safe document inspector when
  // the manifest itself does not satisfy the query.
  return readArtifactSource(
    artifact,
    artifact.current_version,
    options.storageRoot,
    options.database,
  );
}

async function searchableImportedContent(
  artifact: ArtifactRow,
  options: Pick<
    AgentArtifactSearchOptions,
    "database" | "storageRoot" | "signal"
  >,
): Promise<string | null> {
  const mode = artifactEditorMode(presentArtifact(artifact));
  if (!mode || mode === "source") return null;
  const payload = await loadArtifactEditor(artifact, options);
  if (typeof payload.content === "string") return payload.content;
  if (payload.blocks) {
    return payload.blocks
      .map((block) => `${block.anchor}\n${block.text}`)
      .join("\n\n");
  }
  return null;
}

/**
 * Search a pre-authorized artifact archive. Catalog matching is complete;
 * content inspection is deliberately bounded because native Office/PDF
 * extraction can require a worker. The receipt says when that deeper scan was
 * truncated instead of pretending a partial search was exhaustive.
 */
export async function searchArtifactsForAgent(
  options: AgentArtifactSearchOptions,
): Promise<AgentArtifactSearchResult> {
  const { query, terms } = normalizedQuery(options.query);
  if (!terms.length) {
    return {
      query,
      matches: [],
      scopeArtifactCount: options.artifacts.length,
      catalogMatchCount: 0,
      contentArtifactsInspected: 0,
      contentInspectionFailures: 0,
      contentSearchTruncated: false,
      nextContentOffset: null,
    };
  }
  const limit = Math.max(
    1,
    Math.min(MAX_RESULT_LIMIT, Math.floor(options.limit ?? DEFAULT_RESULT_LIMIT)),
  );
  const catalogMatches: AgentArtifactSearchMatch[] = [];
  const contentCandidates: ArtifactRow[] = [];
  for (const artifact of options.artifacts) {
    const presented = presentArtifact(artifact);
    if (artifactMatchesSearch(presented, query)) {
      catalogMatches.push({ artifact: presented, matchedIn: "catalog" });
    } else {
      contentCandidates.push(artifact);
    }
  }

  const matches = catalogMatches.slice(0, limit);
  const includeContent = options.includeContent !== false;
  const contentLimit = Math.max(
    1,
    Math.floor(options.maxContentArtifacts ?? DEFAULT_CONTENT_SCAN_LIMIT),
  );
  const contentOffset = Math.max(0, Math.floor(options.contentOffset ?? 0));
  const contentSearchStarted = includeContent && matches.length < limit;
  const candidates = contentSearchStarted
    ? contentCandidates.slice(contentOffset, contentOffset + contentLimit)
    : [];
  let inspected = 0;
  let failures = 0;
  for (const artifact of candidates) {
    if (options.signal?.aborted) break;
    inspected += 1;
    try {
      let content = await searchableArtifactContent(artifact, options);
      if (!contentMatch(content, terms)) {
        content = (await searchableImportedContent(artifact, options)) ?? "";
      }
      if (!contentMatch(content, terms)) continue;
      matches.push({
        artifact: presentArtifact(artifact),
        matchedIn: "content",
        snippet: contentSnippet(content, terms),
      });
      if (matches.length >= limit) break;
    } catch {
      // One corrupt or temporarily unavailable native document must not make
      // the rest of the scoped archive unsearchable.
      failures += 1;
    }
  }

  const nextContentOffset = contentSearchStarted && contentCandidates.length > contentOffset + inspected
    ? contentOffset + inspected
    : null;
  return {
    query,
    matches,
    scopeArtifactCount: options.artifacts.length,
    catalogMatchCount: catalogMatches.length,
    contentArtifactsInspected: inspected,
    contentInspectionFailures: failures,
    contentSearchTruncated: nextContentOffset !== null,
    nextContentOffset,
  };
}
