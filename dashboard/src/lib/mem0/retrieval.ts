// Hybrid durable-memory retrieval: the deterministic lexical ranker fused
// with mem0 semantic recall.
//
// conversations/memory.ts stays the authority on policy — scope weights,
// state weights, confidence, salience, recency, the score cutoff, and the
// six-item turn budget are all reused unchanged. mem0 contributes a second
// relevance channel, so a memory phrased nothing like the question ("prefers
// tabs" vs "how should I indent?") can still surface. The channels are fused
// by reciprocal rank; a memory found by both ranks above one found by either
// alone.
//
// Failure posture: any absence or error in the semantic layer resolves to
// null and callers keep the lexical result. The layer can add recall; it can
// never block or slow-fail a turn past its deadline, and it can never
// resurface a superseded row because hits are re-checked against canonical
// row state before scoring.

import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  DURABLE_CANDIDATE_STATE_WEIGHT,
  DURABLE_SCORE_CUTOFF,
  loadConversationMemoryBundle,
  memoryScopeWeight,
  recencyFactor,
  retrieveDurableMemories,
  type ConversationMemoryBundle,
  type DurableMemoryRow,
  type RankedDurableMemory,
} from "../conversations/memory.ts";
import {
  conversationIsTemporary,
  type ConversationRow,
} from "../conversations/store.ts";
import { reciprocalRankFusion } from "../semantic-retrieval.ts";
import {
  withSemanticMemoryClient,
  type SemanticMemoryClient,
  type SemanticMemoryHit,
} from "./client.ts";
import { mem0Config } from "./config.ts";
import { reconcileSemanticMirrors } from "./mirror.ts";

const SEARCH_TIMEOUT_MS = 5_000;
const SEMANTIC_TOP_K = 24;

export interface HybridRetrievalInput {
  userId: number;
  currentConversationId: number;
  query: string;
  gardenScopeId?: string | null;
  projectScopeId?: string | null;
  limit?: number;
  now?: Date;
}

/**
 * The fused ranking, or null whenever lexical-only is the honest answer
 * (layer off, vendor package absent, embedding backend unreachable, or no
 * semantic hits).
 */
export async function hybridDurableMemories(
  input: HybridRetrievalInput,
  database: Database.Database = db,
  clientOverride?: import("./client.ts").SemanticMemoryClient | null,
): Promise<RankedDurableMemory[] | null> {
  const config = mem0Config();
  const retrieve = async (
    client: SemanticMemoryClient,
  ): Promise<RankedDurableMemory[] | null> => {
    // Warm the index before searching it: budgeted, so a large backlog
    // spreads across turns instead of stalling this one.
    await reconcileSemanticMirrors({
      userId: input.userId,
      client,
      fingerprint: config.fingerprint,
      database,
    });

    const hits = await withDeadline(
      client.search(input.query, { userId: input.userId, topK: SEMANTIC_TOP_K }),
      SEARCH_TIMEOUT_MS,
    );
    const semantic = scoreSemanticHits(hits, input, database);
    if (!semantic.length) return null;

    const lexical = retrieveDurableMemories({ ...input, limit: 8 }, database);
    const fused = reciprocalRankFusion([
      lexical.map((memory) => ({ id: String(memory.id), memory })),
      semantic.map((memory) => ({ id: String(memory.id), memory })),
    ]);

    const byId = new Map<number, RankedDurableMemory>();
    for (const list of [lexical, semantic]) {
      for (const memory of list) {
        const existing = byId.get(memory.id);
        if (!existing || memory.score > existing.score) byId.set(memory.id, memory);
      }
    }
    const limit = Math.max(1, Math.min(8, input.limit ?? 6));
    return fused
      .flatMap(({ item }) => {
        const memory = byId.get(item.memory.id);
        return memory ? [memory] : [];
      })
      .slice(0, limit);
  };

  try {
    if (clientOverride !== undefined) {
      return clientOverride ? await retrieve(clientOverride) : null;
    }
    if (!config.enabled) return null;
    return await withSemanticMemoryClient("retrieval", retrieve);
  } catch {
    return null;
  }
}

/**
 * Map mem0 hits back onto canonical rows and score them with the same
 * deterministic policy factors as the lexical ranker, with mem0 similarity
 * standing in for lexical relevance. The state re-check in SQL is the safety
 * property: a stale index entry maps to nothing.
 */
function scoreSemanticHits(
  hits: SemanticMemoryHit[],
  input: HybridRetrievalInput,
  database: Database.Database,
): RankedDurableMemory[] {
  const ids = [...new Set(hits.map((hit) => hit.mem0Id).filter(Boolean))];
  if (!ids.length) return [];
  const rows = database.prepare(`
    SELECT dm.*, mm.mem0_id AS mirror_mem0_id
    FROM mem0_mirrors mm
    JOIN durable_memories dm ON dm.id = mm.durable_id
    WHERE mm.mem0_id IN (${ids.map(() => "?").join(",")})
      AND dm.user_id = ? AND dm.state IN ('candidate','confirmed')
  `).all(...ids, input.userId) as Array<DurableMemoryRow & { mirror_mem0_id: string }>;
  const similarityByMem0Id = new Map(hits.map((hit) => [hit.mem0Id, hit.similarity]));
  const now = input.now ?? new Date();

  return rows.flatMap((row): RankedDurableMemory[] => {
    const similarity = similarityByMem0Id.get(row.mirror_mem0_id) ?? 0;
    const stateWeight = row.state === "confirmed" ? 1 : DURABLE_CANDIDATE_STATE_WEIGHT;
    const score = similarity * memoryScopeWeight(row, input) * row.confidence *
      row.salience * stateWeight * recencyFactor(row.last_confirmed_at ?? row.created_at, now);
    if (score < DURABLE_SCORE_CUTOFF) return [];
    return [{
      id: row.id,
      content: row.content,
      kind: row.kind,
      scope: row.scope,
      state: row.state === "confirmed" ? "confirmed" : "candidate",
      score,
      sourceConversationId: row.source_conversation_id,
    }];
  }).sort((left, right) => right.score - left.score || left.id - right.id);
}

/**
 * The async, hybrid variant of loadConversationMemoryBundle. Identical bundle
 * shape; only durableMemories is upgraded, and only when the semantic layer
 * had something to add.
 */
export async function loadConversationMemoryBundleHybrid(input: {
  conversation: ConversationRow;
  query: string;
  activeGardenId?: number | null;
  projectScopeId?: string | null;
  /** Personalize, as it stood when the message was sent. Absent means on. */
  personalize?: boolean;
}, database: Database.Database = db): Promise<ConversationMemoryBundle> {
  const bundle = loadConversationMemoryBundle(input, database);
  // A temporary chat gets no cross-chat memory through either channel. The
  // lexical half already returned nothing; the semantic half is not asked.
  if (conversationIsTemporary(input.conversation)) return bundle;
  // Same rule for a depersonalized turn, and for the same reason: withholding
  // the lexical half while the semantic half still reached for the user's
  // memories would make the switch a suggestion rather than a gate.
  if (bundle.depersonalized) return bundle;
  const hybrid = await hybridDurableMemories({
    userId: input.conversation.user_id,
    currentConversationId: input.conversation.id,
    query: input.query,
    gardenScopeId: input.activeGardenId === null || input.activeGardenId === undefined
      ? null
      : String(input.activeGardenId),
    projectScopeId: input.projectScopeId ?? null,
    limit: 6,
  }, database).catch(() => null);
  if (hybrid?.length) bundle.durableMemories = hybrid;
  return bundle;
}

async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The semantic memory search timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
