// One question to ask of memory, whatever kind of question it is.
//
// Memory is spread across four things that all answer different halves of
// "what do you know about X": the durable rows, the semantic index over them,
// the tree that groups them, and the profile portrait. Asking each separately
// means the caller has to know which one to ask — and the caller is usually a
// model, which will pick wrong.
//
// So there is one entry point with a mode. `search` is the default and fuses
// lexical with semantic where the semantic layer is on. `browse` walks the
// tree. `topic` opens one branch. `stats` says what is there at all. Each
// answers in the same shape, so the reader does not have to switch.

import type Database from "better-sqlite3";

import db from "../db.ts";
import type {
  DurableMemoryRow,
  RankedDurableMemory,
} from "../conversations/memory.ts";
import {
  retrieveDurableMemories,
  touchDurableMemories,
} from "../conversations/memory.ts";
import { hybridDurableMemories } from "../mem0/retrieval.ts";
import { ensureFreshTree } from "./maintain.ts";
import type { VaultNode } from "./vault.ts";

export type MemoryQueryMode = "search" | "browse" | "topic" | "stats";

export interface MemoryQueryInput {
  userId: number;
  mode?: MemoryQueryMode;
  query?: string;
  /** Slug or title of the branch to open, for `topic`. */
  topic?: string;
  gardenScopeId?: string | null;
  projectScopeId?: string | null;
  limit?: number;
  /** Passed through to lexical retrieval, which excludes the current chat. */
  currentConversationId?: number;
}

export interface MemoryHit {
  id: number;
  content: string;
  kind: string;
  scope: string;
  state: string;
  score: number;
  /** Which branches this fact sits under — the context a flat row lacks. */
  topics: string[];
}

export interface MemoryBranch {
  slug: string;
  title: string;
  summary: string;
  kind: "root" | "scope" | "topic";
  score: number;
  memoryCount: number;
  children: MemoryBranch[];
}

export interface MemoryQueryResult {
  mode: MemoryQueryMode;
  /** How the ranking was produced, so the caller knows what it is reading. */
  ranking: "lexical" | "hybrid" | "tree" | "none";
  hits: MemoryHit[];
  branches: MemoryBranch[];
  stats: {
    remembered: number;
    confirmed: number;
    candidates: number;
    topics: number;
    builtAt: string | null;
    vaultPath: string | null;
  } | null;
  note: string;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 40;

function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(limit));
}

/** Which branches each of these memories belongs to. */
function topicsFor(
  memoryIds: number[],
  userId: number,
  database: Database.Database,
): Map<number, string[]> {
  const found = new Map<number, string[]>();
  if (memoryIds.length === 0) return found;
  const placeholders = memoryIds.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT l.memory_id AS memory_id, n.title AS title
       FROM memory_tree_links l
       JOIN memory_tree_nodes n ON n.id = l.node_id
       WHERE n.user_id = ? AND n.kind = 'topic' AND l.memory_id IN (${placeholders})`,
    )
    .all(userId, ...memoryIds) as Array<{ memory_id: number; title: string }>;
  for (const row of rows) {
    const bucket = found.get(row.memory_id);
    if (bucket) bucket.push(row.title);
    else found.set(row.memory_id, [row.title]);
  }
  return found;
}

function decorate(
  ranked: RankedDurableMemory[],
  userId: number,
  database: Database.Database,
): MemoryHit[] {
  const topics = topicsFor(ranked.map((hit) => hit.id), userId, database);
  return ranked.map((hit) => ({
    id: hit.id,
    content: hit.content,
    kind: hit.kind,
    scope: hit.scope,
    state: hit.state,
    score: hit.score,
    topics: topics.get(hit.id) ?? [],
  }));
}

function branchesUnder(
  parentId: number | null,
  userId: number,
  database: Database.Database,
  depth: number,
): MemoryBranch[] {
  const rows = database
    .prepare(
      `SELECT slug, title, summary, kind, score, memory_count, id
       FROM memory_tree_nodes
       WHERE user_id = ? AND parent_id IS ?
       ORDER BY score DESC, title`,
    )
    .all(userId, parentId) as Array<VaultNode & { id: number }>;

  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    kind: row.kind,
    score: row.score,
    memoryCount: row.memory_count,
    children: depth > 0 ? branchesUnder(row.id, userId, database, depth - 1) : [],
  }));
}

type MemoryStats = NonNullable<MemoryQueryResult["stats"]>;

function readStats(userId: number, database: Database.Database): MemoryStats {
  const counts = database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN state IN ('candidate','confirmed') THEN 1 ELSE 0 END), 0) AS remembered,
         COALESCE(SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
         COALESCE(SUM(CASE WHEN state = 'candidate' THEN 1 ELSE 0 END), 0) AS candidates
       FROM durable_memories WHERE user_id = ?`,
    )
    .get(userId) as { remembered: number; confirmed: number; candidates: number };

  const topics = database
    .prepare(
      `SELECT COUNT(*) AS n FROM memory_tree_nodes WHERE user_id = ? AND kind = 'topic'`,
    )
    .get(userId) as { n: number };

  const state = database
    .prepare(`SELECT built_at, vault_path FROM memory_tree_state WHERE user_id = ?`)
    .get(userId) as { built_at: string | null; vault_path: string } | undefined;

  return {
    remembered: Number(counts.remembered),
    confirmed: Number(counts.confirmed),
    candidates: Number(counts.candidates),
    topics: Number(topics.n),
    builtAt: state?.built_at ?? null,
    vaultPath: state?.vault_path || null,
  };
}

function empty(mode: MemoryQueryMode, note: string): MemoryQueryResult {
  return { mode, ranking: "none", hits: [], branches: [], stats: null, note };
}

/**
 * Ask memory a question.
 *
 * Never throws: a caller that is mid-turn should get "nothing found, here is
 * why" rather than an exception it has to interpret.
 */
export async function memoryQuery(
  input: MemoryQueryInput,
  database: Database.Database = db,
): Promise<MemoryQueryResult> {
  const mode = input.mode ?? "search";
  const limit = clampLimit(input.limit);

  try {
    // Every mode but plain search reads the tree, so make sure it reflects the
    // facts as they are now. A no-op unless a memory has been saved or retired
    // since the last build.
    if (mode !== "search") ensureFreshTree(input.userId, database);

    if (mode === "stats") {
      const stats = readStats(input.userId, database);
      return {
        mode,
        ranking: "none",
        hits: [],
        branches: [],
        stats,
        note:
          stats.remembered === 0
            ? "Nothing is remembered yet."
            : `${stats.remembered} facts in ${stats.topics} topics.`,
      };
    }

    if (mode === "browse") {
      const branches = branchesUnder(null, input.userId, database, 2);
      return {
        mode,
        ranking: "tree",
        hits: [],
        branches,
        stats: readStats(input.userId, database),
        note:
          branches.length === 0
            ? "The memory tree has not been built yet."
            : "Branches are ordered by how much weight the facts under them carry.",
      };
    }

    if (mode === "topic") {
      const wanted = (input.topic ?? "").trim();
      if (!wanted) return empty(mode, "Name a topic, by title or slug.");

      const node = database
        .prepare(
          `SELECT id, slug, title, summary, kind, score, memory_count
           FROM memory_tree_nodes
           WHERE user_id = ? AND (slug = ? OR lower(title) = lower(?))
           ORDER BY score DESC LIMIT 1`,
        )
        .get(input.userId, wanted, wanted) as
        | (VaultNode & { id: number })
        | undefined;

      if (!node) return empty(mode, `No branch called "${wanted}". Try mode "browse".`);

      const rows = database
        .prepare(
          `SELECT m.*, l.weight AS weight
           FROM memory_tree_links l
           JOIN durable_memories m ON m.id = l.memory_id
           WHERE l.node_id = ? AND m.user_id = ? AND m.state IN ('candidate','confirmed')
           ORDER BY l.weight DESC, m.id
           LIMIT ?`,
        )
        .all(node.id, input.userId, limit) as Array<DurableMemoryRow & { weight: number }>;

      return {
        mode,
        ranking: "tree",
        hits: rows.map((row) => ({
          id: row.id,
          content: row.content,
          kind: row.kind,
          scope: row.scope,
          state: row.state,
          score: row.weight,
          topics: [node.title],
        })),
        branches: [
          {
            slug: node.slug,
            title: node.title,
            summary: node.summary,
            kind: node.kind,
            score: node.score,
            memoryCount: node.memory_count,
            children: branchesUnder(node.id, input.userId, database, 1),
          },
        ],
        stats: null,
        note: `${rows.length} of ${node.memory_count} facts under "${node.title}".`,
      };
    }

    const query = (input.query ?? "").trim();
    if (!query) return empty(mode, "Give a query, or use mode \"browse\" to look around.");

    const retrievalInput = {
      userId: input.userId,
      currentConversationId: input.currentConversationId ?? 0,
      query,
      gardenScopeId: input.gardenScopeId ?? null,
      projectScopeId: input.projectScopeId ?? null,
      limit,
    };

    // Semantic first where it is available, lexical always as the floor. The
    // hybrid path returns null rather than throwing whenever it cannot be the
    // honest answer, which is what makes this a plain fallback.
    let ranked: RankedDurableMemory[] | null = null;
    let ranking: MemoryQueryResult["ranking"] = "lexical";
    try {
      ranked = await hybridDurableMemories(retrievalInput, database);
      if (ranked) ranking = "hybrid";
    } catch {
      ranked = null;
    }
    if (!ranked) ranked = retrieveDurableMemories(retrievalInput, database);
    // A tool read is a use: the model asked memory a question and these are
    // the rows that answered it.
    touchDurableMemories(ranked.map((hit) => hit.id), database);

    return {
      mode: "search",
      ranking: ranked.length === 0 ? "none" : ranking,
      hits: decorate(ranked, input.userId, database),
      branches: [],
      stats: null,
      note:
        ranked.length === 0
          ? "Nothing remembered matches that."
          : `${ranked.length} matches, ${ranking === "hybrid" ? "semantic and lexical" : "lexical"} ranking.`,
    };
  } catch (error) {
    return empty(
      mode,
      `Memory could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
