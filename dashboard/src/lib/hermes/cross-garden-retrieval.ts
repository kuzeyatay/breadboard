import db from "../db.ts";
import {
  formatRetrievedEvidence,
  indexedFingerprint,
  indexedPageChunks,
  indexRetrievalGarden,
  queryTermWeights,
  queryTokens,
  retrieveGraphRag,
  tokenOverlap,
  type RankedRetrievalChunk,
  type RetrievalGarden,
} from "../semantic-retrieval.ts";
import type { ThoughtTopology } from "../thought-topology/types.ts";

type Database = NonNullable<Parameters<typeof retrieveGraphRag>[0]["database"]>;

/** Passages another Garden may add beside the active one's. */
const OTHER_GARDEN_CHUNKS = 3;

/**
 * A passage is about the question when it holds at least half its weighted
 * words. "1.57 Hyperplanes" holds 0.59 of "definition of a hyperplane" (the
 * rare word); "1.48 Definition and Axioms of Fields" holds 0.41 (the common one).
 */
const FOCUSED_MIN_COVERAGE = 0.5;
// The active Garden is relevant by being open; another Garden earns a place
// only by naming what was asked: the question's rarest word and half its
// weight. Measured on 24 questions over 8 Gardens (2026-11-17): searching every
// Garden as one pool let Telecom's "Work" and "Internet Architecture" pages
// push the right in-Garden answers out.

let refreshQueue: Promise<unknown> = Promise.resolve();
const lastChecked = new Map<string, number>();
const RECHECK_MS = 60_000;

/** A Garden the reader is not in: searched as last indexed, checked off the turn. */
export interface OtherGarden {
  slug: string;
  name: string;
  rootPath: string;
  /** Its current fingerprint and page loader. Stats every page (~0.3 s for 24 Gardens), so never awaited on a turn. */
  resolve: () => Promise<RetrievalGarden>;
}

/**
 * Re-index a Garden off the turn if it changed. One at a time (a cold Garden
 * can take tens of seconds) and at most once a minute per Garden, so a busy
 * chat does not stat every page of every Garden on each message.
 */
function refreshLater(garden: OtherGarden, database: Database) {
  if (Date.now() - (lastChecked.get(garden.slug) ?? 0) < RECHECK_MS) return;
  lastChecked.set(garden.slug, Date.now());
  refreshQueue = refreshQueue
    .then(async () => {
      const fresh = await garden.resolve();
      if (indexedFingerprint(database, garden.slug) !== fresh.fingerprint) {
        await indexRetrievalGarden({ garden: fresh, database, embeddingProvider: null });
      }
    })
    .catch(() => undefined);
}

/** One Thought Topology edge leaving a page the search found. */
export interface GraphLink {
  gardenSlug: string;
  relPath: string;
  weight: number;
  /** The edge as a sentence, e.g. "Hyperplanes depends on Normal Vectors". */
  reads: string;
  /** A typed relation (depends on, extends, ...) rather than plain "related". */
  typed: boolean;
}

/** Passages the map links to the found pages, beyond what the search returned. */
const GRAPH_CHUNKS = 2;

/**
 * Follow the knowledge graph one step from the pages the search found. Word
 * matching cannot reach a prerequisite that never names the question's words;
 * the map's scored and typed links (and the user's own chat co-citations) can.
 * Each linked page contributes its passage closest to the question, labelled
 * with the edge that brought it in, strongest edges first.
 */
export function graphEvidence(input: {
  query: string;
  links: readonly GraphLink[];
  exclude: ReadonlySet<string>;
  database?: Database;
  limit?: number;
}): RankedRetrievalChunk[] {
  const database = input.database ?? db;
  const seen = new Set(input.exclude);
  const weights = queryTermWeights(input.query, [...new Set(input.links.map((link) => link.gardenSlug))], database);
  const out: RankedRetrievalChunk[] = [];
  // A prerequisite or an extension says why the page matters; "related" only that it is near.
  const order = (link: GraphLink) => link.weight + (link.typed ? 1 : 0);
  for (const link of [...input.links].sort((left, right) => order(right) - order(left))) {
    const key = `${link.gardenSlug}\0${link.relPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunks = indexedPageChunks(link.gardenSlug, link.relPath, database);
    if (!chunks.length) continue;
    const best = chunks.reduce((winner, chunk) =>
      tokenOverlap(weights, `${chunk.heading} ${chunk.content}`) > tokenOverlap(weights, `${winner.heading} ${winner.content}`) ? chunk : winner);
    out.push({ ...best, score: link.weight, relationshipPaths: [link.reads] });
    if (out.length >= (input.limit ?? GRAPH_CHUNKS)) break;
  }
  return out;
}

/**
 * Pages the user's earlier questions in this Garden led to, when an earlier
 * question is about this one. Reads the chat links of a topology passed through
 * withViewerChats (thought-topology/chat-nodes.ts): each says "You asked ...
 * and the answer cited P" (or "P is the closest page"). An earlier question
 * counts when it names the question's rarest word and half its weight, the
 * same bar as a passage from another Garden.
 */
export function pastQuestionLinks(input: {
  query: string;
  gardenSlug: string;
  topology: Pick<ThoughtTopology, "nodes" | "edges">;
  database?: Database;
}): GraphLink[] {
  const weights = queryTermWeights(input.query, [input.gardenSlug], input.database ?? db);
  const [rarest] = weights.keys();
  if (!rarest) return [];
  const pages = new Map(input.topology.nodes.filter((node) => node.kind !== "chat").map((node) => [node.id, node]));
  const best = new Map<string, GraphLink>();
  for (const edge of input.topology.edges) {
    const page = pages.get(edge.target);
    const reads = edge.explanation?.text ?? "";
    if (!edge.source.startsWith("chat:") || !page) continue;
    // Match the earlier question only: the sentence also names the cited page,
    // whose title would let "is it a vector field?" match "Vector Fields".
    const asked = /^You asked "(.*)"(?: and the answer cited |; )/.exec(reads)?.[1] ?? reads;
    const coverage = tokenOverlap(weights, asked);
    if (coverage < FOCUSED_MIN_COVERAGE || tokenOverlap(new Map([[rarest, 1]]), asked) === 0) continue;
    if (coverage > (best.get(page.relPath)?.weight ?? 0)) {
      best.set(page.relPath, { gardenSlug: input.gardenSlug, relPath: page.relPath, weight: coverage, reads, typed: true });
    }
  }
  return [...best.values()];
}

export interface CrossGardenRetrieval {
  chunks: RankedRetrievalChunk[];
  /** How many of `chunks`, from the start, come from the primary Gardens. */
  primaryCount: number;
  /**
   * The returned passages that are about the question, not just sharing a
   * word with it. Graph links are followed only from these: expanding from
   * "Definition and Axioms of Fields" for "definition of a hyperplane" pulled
   * in two vector-space pages (2026-11-17).
   */
  focused: RankedRetrievalChunk[];
  context: string;
  /** The question's rarest word, when no returned passage contains it: exact search may still find it. */
  notRetrieved: string[];
  /** Words of the question no searched Garden contains at all. */
  notInGardens: string[];
  lexicalUsed: boolean;
}

/**
 * Evidence for one question from the Gardens in view and from every other
 * Garden the reader may open. The primary Gardens are indexed now, as before;
 * the others are searched as they were last indexed and refreshed afterwards,
 * so a turn never waits on a Garden the reader is not in.
 */
export async function retrieveAcrossGardens(input: {
  query: string;
  primary: RetrievalGarden[];
  others: OtherGarden[];
  database?: Database;
  maxChunks?: number;
  contextBudget?: number;
}): Promise<CrossGardenRetrieval> {
  const database = input.database ?? db;
  const ready: RetrievalGarden[] = input.others.flatMap((garden) => {
    refreshLater(garden, database);
    const stored = indexedFingerprint(database, garden.slug);
    // Searching with the stored fingerprint is what keeps indexing off this turn.
    return stored === undefined ? [] : [{ slug: garden.slug, name: garden.name, rootPath: garden.rootPath, fingerprint: stored }];
  });
  const search = (gardens: RetrievalGarden[], maxChunks: number, contextBudget: number) => gardens.length
    ? retrieveGraphRag({ query: input.query, gardens, database, embeddingProvider: null, indexEmbeddings: false, maxChunks, contextBudget })
    : Promise.resolve(null);
  const primary = await search(input.primary, input.maxChunks ?? 8, input.contextBudget ?? 14_000);
  const other = await search(ready, 6, 8_000);

  const weights = queryTermWeights(input.query, [...input.primary, ...ready].map((garden) => garden.slug), database);
  const text = (chunk: RankedRetrievalChunk) => `${chunk.pageTitle} ${chunk.heading} ${chunk.content}`;
  const [rarest] = weights.keys();
  const mentions = (chunk: RankedRetrievalChunk, term: string | undefined) =>
    term !== undefined && tokenOverlap(new Map([[term, 1]]), text(chunk)) > 0;
  const primaryChunks = (primary?.chunks ?? []) as RankedRetrievalChunk[];
  const otherChunks = ((other?.chunks ?? []) as RankedRetrievalChunk[])
    .filter((chunk) => mentions(chunk, rarest) && tokenOverlap(weights, text(chunk)) >= FOCUSED_MIN_COVERAGE)
    .slice(0, OTHER_GARDEN_CHUNKS);
  const chunks = [...primaryChunks, ...otherChunks];
  return {
    chunks,
    primaryCount: primaryChunks.length,
    focused: chunks.filter((chunk) => tokenOverlap(weights, text(chunk)) >= FOCUSED_MIN_COVERAGE),
    notRetrieved: rarest && !chunks.some((chunk) => mentions(chunk, rarest)) ? [rarest] : [],
    notInGardens: queryTokens(input.query).filter((term) => term.length > 3 && !weights.has(term)),
    context: [
      formatRetrievedEvidence(primaryChunks),
      otherChunks.length
        ? `# From the user's ${primaryChunks.length || input.primary.length ? "other " : ""}Gardens\n\n${formatRetrievedEvidence(otherChunks, primaryChunks.length + 1)}`
        : "",
    ].filter(Boolean).join("\n\n---\n\n"),
    lexicalUsed: Boolean(primary?.lexicalUsed || other?.lexicalUsed),
  };
}
