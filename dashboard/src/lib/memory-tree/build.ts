// Building the tree: flat memories in, scored hierarchy out.
//
// The clustering is deliberately deterministic and model-free. A tree the user
// is invited to read and correct has to be explainable — "these five facts are
// together because they share the words pump, rig and pressure" is a reason
// someone can agree or disagree with, where "a model grouped them" is not. It
// also means rebuilding is free, so the tree can be regenerated whenever
// memory changes rather than on a schedule nobody tuned.
//
// Three levels:
//
//   root   → one per user
//   scope  → everywhere / one project / one garden, mirroring how memories are
//            already scoped, so the first split is one the system already
//            believes in rather than one invented here
//   topic  → within a scope, memories that share salient vocabulary
//
// A memory can hang off more than one topic. Scores roll upward, so a branch
// full of confirmed, salient, recently-confirmed facts outranks a branch of
// stale candidates — the "scored" half of a scored markdown tree.

import type Database from "better-sqlite3";

import db from "../db.ts";
import type { DurableMemoryRow } from "../conversations/memory.ts";
import { recencyFactor } from "../conversations/memory.ts";

/** Words that group nothing, because they appear in everything. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this",
  "these", "those", "is", "are", "was", "were", "be", "been", "being", "to",
  "of", "in", "on", "at", "for", "with", "by", "from", "as", "it", "its",
  "he", "she", "they", "them", "his", "her", "their", "we", "us", "our",
  "you", "your", "i", "me", "my", "not", "no", "yes", "do", "does", "did",
  "have", "has", "had", "will", "would", "should", "could", "can", "may",
  "user", "prefers", "prefer", "wants", "want", "uses", "use", "using",
  "always", "never", "when", "what", "which", "who", "how", "why", "where",
  "about", "into", "over", "under", "after", "before", "more", "most", "some",
]);

/** A topic needs at least this many memories to be worth naming. */
const MIN_TOPIC_SIZE = 2;
/** Two memories join a topic when they share at least this much vocabulary. */
const TOPIC_SIMILARITY = 0.28;
/** How many terms name a topic. */
const TOPIC_TERMS = 3;

export interface BuildResult {
  nodes: number;
  memories: number;
  topics: number;
  /** Memories that matched no cluster and sit directly under their scope. */
  loose: number;
}

function salientTerms(content: string): string[] {
  return Array.from(
    new Set(
      content
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
    ),
  );
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  // Overlap against the smaller set, not the union: a two-word memory that is
  // wholly about pumps belongs with the pump cluster even when the other
  // member carries twelve other words.
  return shared / Math.min(left.size, right.size);
}

/**
 * How much a single memory counts, on the same terms retrieval already uses.
 *
 * Deliberately the same factors as `retrieveDurableMemories` minus the query —
 * confidence, salience, state and recency — so a branch that looks important
 * in the vault is the branch that will actually surface in a chat.
 */
export function memoryWeight(row: DurableMemoryRow, now: Date): number {
  const stateWeight = row.state === "confirmed" ? 1 : 0.62;
  const recency = recencyFactor(row.last_confirmed_at ?? row.created_at, now);
  return row.confidence * row.salience * stateWeight * recency;
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function scopeTitle(scope: string, scopeId: string | null): string {
  if (scope === "global") return "Everywhere";
  if (scope === "project") return scopeId ? `Project ${scopeId}` : "Projects";
  return scopeId ? `Garden ${scopeId}` : "Gardens";
}

interface Cluster {
  terms: Set<string>;
  memories: Array<{ row: DurableMemoryRow; terms: Set<string>; weight: number }>;
}

/**
 * Single-pass agglomerative clustering by shared vocabulary.
 *
 * Each memory joins the existing cluster it most resembles, or starts one.
 * Cheap, order-stable given a stable input order, and good enough for the tens
 * to low thousands of facts a personal memory holds — a proper hierarchical
 * clustering would cost more to explain than it would buy in quality.
 */
function clusterMemories(
  rows: DurableMemoryRow[],
  now: Date,
): { clusters: Cluster[]; loose: Cluster["memories"] } {
  const prepared = rows
    .map((row) => ({
      row,
      terms: new Set(salientTerms(row.content)),
      weight: memoryWeight(row, now),
    }))
    // Heaviest first, so the strongest memories seed the clusters and give
    // them their names, rather than an arbitrary early row doing it.
    .sort((left, right) => right.weight - left.weight || left.row.id - right.row.id);

  const clusters: Cluster[] = [];
  for (const item of prepared) {
    let best: Cluster | null = null;
    let bestScore = TOPIC_SIMILARITY;
    for (const cluster of clusters) {
      const score = similarity(item.terms, cluster.terms);
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best) {
      best.memories.push(item);
      for (const term of item.terms) best.terms.add(term);
    } else {
      clusters.push({ terms: new Set(item.terms), memories: [item] });
    }
  }

  const kept: Cluster[] = [];
  const loose: Cluster["memories"] = [];
  for (const cluster of clusters) {
    if (cluster.memories.length >= MIN_TOPIC_SIZE) kept.push(cluster);
    else loose.push(...cluster.memories);
  }
  return { clusters: kept, loose };
}

/** The terms shared by the most members — what the cluster is actually about. */
function nameCluster(cluster: Cluster): { title: string; terms: string[] } {
  const counts = new Map<string, number>();
  for (const item of cluster.memories) {
    for (const term of item.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  const ranked = Array.from(counts.entries())
    .filter(([, count]) => count > 1 || cluster.memories.length === 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term);

  const terms = ranked.slice(0, TOPIC_TERMS);
  if (terms.length === 0) {
    // No term is shared by two members — the cluster formed on a chain of
    // pairwise overlaps. Fall back to naming it after its strongest memory.
    const lead = cluster.memories[0]?.row.content ?? "Notes";
    return { title: lead.slice(0, 48), terms: [] };
  }
  const title = terms
    .map((term) => term.charAt(0).toUpperCase() + term.slice(1))
    .join(", ");
  return { title, terms: ranked.slice(0, 12) };
}

/**
 * Rebuild one user's tree from their durable memories.
 *
 * Runs in a single transaction: a half-built tree would be exported to the
 * vault as though it were the whole picture.
 */
export function buildMemoryTree(
  userId: number,
  database: Database.Database = db,
  now: Date = new Date(),
): BuildResult {
  const rows = database
    .prepare(
      `SELECT * FROM durable_memories
       WHERE user_id = ? AND state IN ('candidate','confirmed')
       ORDER BY id`,
    )
    .all(userId) as DurableMemoryRow[];

  const edited = new Map<string, { title: string; summary: string }>();
  for (const node of database
    .prepare(
      `SELECT slug, title, summary FROM memory_tree_nodes
       WHERE user_id = ? AND source = 'edited'`,
    )
    .all(userId) as Array<{ slug: string; title: string; summary: string }>) {
    edited.set(node.slug, { title: node.title, summary: node.summary });
  }

  const rebuild = database.transaction(() => {
    database.prepare(`DELETE FROM memory_tree_nodes WHERE user_id = ?`).run(userId);

    const insertNode = database.prepare(
      `INSERT INTO memory_tree_nodes
         (user_id, parent_id, slug, title, summary, kind, scope, scope_id,
          score, memory_count, terms, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    const insertLink = database.prepare(
      `INSERT OR REPLACE INTO memory_tree_links (node_id, memory_id, weight)
       VALUES (?, ?, ?)`,
    );

    const rootId = Number(
      insertNode.run(
        userId, null, "memory", "Memory", "", "root", null, null, 0, rows.length, "",
        "derived",
      ).lastInsertRowid,
    );

    const byScope = new Map<string, DurableMemoryRow[]>();
    for (const row of rows) {
      const key = `${row.scope} ${row.scope_id ?? ""}`;
      const bucket = byScope.get(key);
      if (bucket) bucket.push(row);
      else byScope.set(key, [row]);
    }

    let nodeCount = 1;
    let topicCount = 0;
    let looseCount = 0;
    let rootScore = 0;

    for (const [key, scopeRows] of Array.from(byScope.entries()).sort()) {
      const [scope, rawScopeId] = key.split(" ");
      const scopeId = rawScopeId || null;
      const scopeSlug = slugify(
        scopeId ? `${scope}-${scopeId}` : scope,
        `scope-${byScope.size}`,
      );
      const scopeEdit = edited.get(scopeSlug);

      const scopeNodeId = Number(
        insertNode.run(
          userId, rootId, scopeSlug,
          scopeEdit?.title ?? scopeTitle(scope, scopeId),
          scopeEdit?.summary ?? "",
          "scope", scope, scopeId, 0, scopeRows.length, "",
          scopeEdit ? "edited" : "derived",
        ).lastInsertRowid,
      );
      nodeCount += 1;

      const { clusters, loose } = clusterMemories(scopeRows, now);
      let scopeScore = 0;

      for (const cluster of clusters) {
        const { title, terms } = nameCluster(cluster);
        const slug = slugify(`${scopeSlug}-${title}`, `topic-${topicCount}`);
        const edit = edited.get(slug);
        const score = cluster.memories.reduce((sum, item) => sum + item.weight, 0);
        scopeScore += score;

        const topicId = Number(
          insertNode.run(
            userId, scopeNodeId, slug,
            edit?.title ?? title,
            edit?.summary ?? summarise(cluster),
            "topic", scope, scopeId,
            score, cluster.memories.length, terms.join(" "),
            edit ? "edited" : "derived",
          ).lastInsertRowid,
        );
        nodeCount += 1;
        topicCount += 1;
        for (const item of cluster.memories) {
          insertLink.run(topicId, item.row.id, item.weight);
        }
      }

      // Memories that clustered with nothing still have to be reachable, so
      // they link straight to their scope. A fact nobody can find is the same
      // as a fact nobody stored.
      for (const item of loose) {
        insertLink.run(scopeNodeId, item.row.id, item.weight);
        scopeScore += item.weight;
        looseCount += 1;
      }

      database
        .prepare(`UPDATE memory_tree_nodes SET score = ? WHERE id = ?`)
        .run(scopeScore, scopeNodeId);
      rootScore += scopeScore;
    }

    database
      .prepare(`UPDATE memory_tree_nodes SET score = ? WHERE id = ?`)
      .run(rootScore, rootId);

    database
      .prepare(
        `INSERT INTO memory_tree_state (user_id, built_at, memory_count, node_count)
         VALUES (?, datetime('now'), ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           built_at = datetime('now'),
           memory_count = excluded.memory_count,
           node_count = excluded.node_count,
           last_error = NULL`,
      )
      .run(userId, rows.length, nodeCount);

    return { nodes: nodeCount, memories: rows.length, topics: topicCount, loose: looseCount };
  });

  return rebuild();
}

/** A one-line description of what a cluster holds, drawn from its members. */
function summarise(cluster: Cluster): string {
  const lead = cluster.memories[0]?.row.content ?? "";
  const count = cluster.memories.length;
  const trimmed = lead.length > 90 ? `${lead.slice(0, 87)}…` : lead;
  return count === 1 ? trimmed : `${trimmed} (and ${count - 1} related)`;
}
