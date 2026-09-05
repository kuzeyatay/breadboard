// Read/curate side of the agent's memory, for the Settings → Memory panel.
//
// `memory.ts` owns how memory is written and retrieved during a run; this module
// only inspects it and lets the user retire entries. Every query is scoped by
// user_id so one account can never read or edit another's memory.

import type Database from "better-sqlite3";
import db from "../db.ts";
import type {
  ConversationWorkingState,
  DurableMemoryKind,
  DurableMemoryRow,
  DurableMemoryScope,
  DurableMemoryState,
} from "./memory.ts";
import {
  normalizeDurableMemoryContent,
  stableMemoryKey,
} from "./memory.ts";
import { semanticMemoryStatus, type SemanticMemoryStatus } from "../mem0/status.ts";
import {
  getMemoryProfile,
  invalidateMemoryProfile,
  type MemoryProfileView,
} from "./memory-profile.ts";

export interface DurableMemoryView {
  id: number;
  content: string;
  kind: DurableMemoryKind;
  scope: DurableMemoryScope;
  scopeId: string | null;
  state: DurableMemoryState;
  confidence: number;
  salience: number;
  createdAt: string;
  lastConfirmedAt: string | null;
  supersededAt: string | null;
  sourceConversationId: number | null;
  sourceConversationTitle: string | null;
  /** Garden name when the memory is garden-scoped and the garden still exists. */
  scopeLabel: string | null;
}

export interface ConversationMemoryStateView {
  conversationId: number;
  publicId: string;
  title: string;
  surface: string;
  summary: string;
  workingState: ConversationWorkingState;
  messageCount: number;
  updatedAt: string;
  hasSavedMemory: boolean;
  memoryUpdatedAt: string | null;
}

export interface AgentMemoryOverview {
  profile: MemoryProfileView;
  durable: DurableMemoryView[];
  conversations: ConversationMemoryStateView[];
  counts: {
    confirmed: number;
    candidate: number;
    superseded: number;
  };
  /** Whether recall-by-meaning is actually working. See lib/mem0/status.ts. */
  semantic: SemanticMemoryStatus;
}

const MAX_DURABLE_ROWS = 500;

interface DurableJoinRow extends DurableMemoryRow {
  source_conversation_title: string | null;
  garden_name: string | null;
}

export function listDurableMemories(
  userId: number,
  options: { includeSuperseded?: boolean; limit?: number } = {},
  database: Database.Database = db,
): DurableMemoryView[] {
  const limit = Math.max(1, Math.min(MAX_DURABLE_ROWS, options.limit ?? MAX_DURABLE_ROWS));
  const rows = database
    .prepare(
      `SELECT m.*,
              c.title AS source_conversation_title,
              g.name  AS garden_name
       FROM durable_memories m
       LEFT JOIN conversations c ON c.id = m.source_conversation_id AND c.user_id = m.user_id
       LEFT JOIN clusters g
              ON m.scope = 'garden'
             AND g.user_id = m.user_id
             AND CAST(g.id AS TEXT) = m.scope_id
       WHERE m.user_id = ?
         AND (? = 1 OR m.state <> 'superseded')
       ORDER BY CASE m.state WHEN 'confirmed' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,
                COALESCE(m.last_confirmed_at, m.created_at) DESC,
                m.id DESC
       LIMIT ?`,
    )
    .all(userId, options.includeSuperseded ? 1 : 0, limit) as DurableJoinRow[];

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    kind: row.kind,
    scope: row.scope,
    scopeId: row.scope_id,
    state: row.state,
    confidence: row.confidence,
    salience: row.salience,
    createdAt: row.created_at,
    lastConfirmedAt: row.last_confirmed_at,
    supersededAt: row.superseded_at,
    sourceConversationId: row.source_conversation_id,
    sourceConversationTitle: row.source_conversation_title,
    scopeLabel: row.garden_name,
  }));
}

export function countDurableMemories(
  userId: number,
  database: Database.Database = db,
): AgentMemoryOverview["counts"] {
  const rows = database
    .prepare(
      `SELECT state, COUNT(*) AS total
       FROM durable_memories WHERE user_id = ? GROUP BY state`,
    )
    .all(userId) as Array<{ state: DurableMemoryState; total: number }>;
  const counts = { confirmed: 0, candidate: 0, superseded: 0 };
  for (const row of rows) {
    if (row.state in counts) counts[row.state] = row.total;
  }
  return counts;
}

export function listConversationMemoryStates(
  userId: number,
  limit?: number,
  database: Database.Database = db,
): ConversationMemoryStateView[] {
  const rows = database
    .prepare(
      `SELECT c.id, c.public_id, c.title, c.surface,
              COALESCE(s.rolling_summary, '') AS rolling_summary,
              COALESCE(s.working_state, '{}') AS working_state,
              c.updated_at, s.updated_at AS memory_updated_at,
              (SELECT COUNT(*) FROM conversation_messages m
                WHERE m.conversation_id = c.id AND m.status <> 'pending') AS message_count
       FROM conversations c
       LEFT JOIN conversation_memory_state s ON s.conversation_id = c.id
       WHERE c.user_id = ? AND c.temporary = 0
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT ?`,
    )
    .all(userId, limit === undefined ? -1 : Math.max(1, Math.trunc(limit))) as Array<{
      id: number;
      public_id: string;
      title: string;
      surface: string;
      rolling_summary: string;
      working_state: string;
      updated_at: string;
      memory_updated_at: string | null;
      message_count: number;
    }>;

  return rows.map((row) => {
    const workingState = safeWorkingState(row.working_state);
    const hasSavedMemory = Boolean(
      row.rolling_summary.trim() || workingState.currentGoal ||
      Object.values(workingState).some((value) => Array.isArray(value) && value.length > 0),
    );
    return {
      conversationId: row.id,
      publicId: row.public_id,
      title: row.title,
      surface: row.surface,
      summary: row.rolling_summary,
      workingState,
      messageCount: row.message_count,
      updatedAt: row.updated_at,
      hasSavedMemory,
      memoryUpdatedAt: hasSavedMemory ? row.memory_updated_at : null,
    };
  });
}

export async function loadAgentMemoryOverview(
  userId: number,
  options: { includeSuperseded?: boolean } = {},
  database: Database.Database = db,
): Promise<AgentMemoryOverview> {
  return {
    profile: getMemoryProfile(userId, database),
    durable: listDurableMemories(userId, options, database),
    conversations: listConversationMemoryStates(userId, undefined, database),
    counts: countDurableMemories(userId, database),
    // Async because reporting the semantic layer honestly means loading the
    // engine rather than guessing at its files.
    semantic: await semanticMemoryStatus(userId, database),
  };
}

/**
 * Retire a memory from every future retrieval without destroying it.
 * `retrieveDurableMemories` only reads candidate/confirmed rows, so superseding
 * is the operation that actually makes the agent forget.
 */
export function forgetDurableMemory(
  userId: number,
  memoryId: number,
  database: Database.Database = db,
): boolean {
  const result = database
    .prepare(
      `UPDATE durable_memories
       SET state = 'superseded', superseded_at = datetime('now')
       WHERE id = ? AND user_id = ? AND state <> 'superseded'`,
    )
    .run(memoryId, userId);
  if (result.changes === 1) invalidateMemoryProfile(userId, database);
  return result.changes === 1;
}

/** Promote a candidate the user recognizes as correct to full retrieval weight. */
export function confirmDurableMemory(
  userId: number,
  memoryId: number,
  database: Database.Database = db,
): boolean {
  const result = database
    .prepare(
      `UPDATE durable_memories
       SET state = 'confirmed', superseded_at = NULL,
           last_confirmed_at = datetime('now'),
           confidence = MAX(confidence, 0.9)
       WHERE id = ? AND user_id = ? AND state <> 'confirmed'`,
    )
    .run(memoryId, userId);
  return result.changes === 1;
}

export type DurableMemoryContentUpdate =
  | { status: "updated"; content: string }
  | { status: "not_found" }
  | { status: "rejected" }
  | { status: "conflict" };

/** Edit an active memory without allowing ownership, scope, or state changes. */
export function updateDurableMemoryContent(
  userId: number,
  memoryId: number,
  value: string,
  database: Database.Database = db,
): DurableMemoryContentUpdate {
  const content = normalizeDurableMemoryContent(value);
  if (!content) return { status: "rejected" };
  const update = database.transaction((): DurableMemoryContentUpdate => {
    const memory = database
      .prepare(
        `SELECT * FROM durable_memories
         WHERE id = ? AND user_id = ? AND state <> 'superseded'`,
      )
      .get(memoryId, userId) as DurableMemoryRow | undefined;
    if (!memory) return { status: "not_found" };

    const memoryKey = stableMemoryKey(memory.kind, content);
    const conflict = database
      .prepare(
        `SELECT id FROM durable_memories
         WHERE user_id = ?
           AND scope = ?
           AND COALESCE(scope_id, '') = COALESCE(?, '')
           AND memory_key = ?
           AND state <> 'superseded'
           AND id <> ?
         LIMIT 1`,
      )
      .get(
        userId,
        memory.scope,
        memory.scope_id,
        memoryKey,
        memoryId,
      ) as { id: number } | undefined;
    if (conflict) return { status: "conflict" };

    database
      .prepare(
        `UPDATE durable_memories
         SET content = ?, memory_key = ?,
             last_confirmed_at = CASE
               WHEN state = 'confirmed' THEN datetime('now')
               ELSE last_confirmed_at
             END
         WHERE id = ?`,
      )
      .run(content, memoryKey, memoryId);
    invalidateMemoryProfile(userId, database);
    return { status: "updated", content };
  });
  return update.immediate();
}

/**
 * Hard delete, offered only for already-retired rows. The unique active-key
 * index means a delete can never resurrect a conflicting memory.
 */
export function deleteDurableMemory(
  userId: number,
  memoryId: number,
  database: Database.Database = db,
): boolean {
  const result = database
    .prepare(
      `DELETE FROM durable_memories
       WHERE id = ? AND user_id = ? AND state = 'superseded'`,
    )
    .run(memoryId, userId);
  if (result.changes === 1) invalidateMemoryProfile(userId, database);
  return result.changes === 1;
}

/** Clear one conversation's rolling summary and working state. */
export function clearConversationMemoryState(
  userId: number,
  conversationId: number,
  database: Database.Database = db,
): boolean {
  const result = database
    .prepare(
      `UPDATE conversation_memory_state
       SET rolling_summary = '', working_state = '{}',
           summarized_through_order = -1, version = version + 1,
           updated_at = datetime('now')
       WHERE conversation_id = (
         SELECT id FROM conversations WHERE id = ? AND user_id = ?
       )`,
    )
    .run(conversationId, userId);
  return result.changes === 1;
}

function safeWorkingState(value: string): ConversationWorkingState {
  const empty: ConversationWorkingState = {
    knownFacts: [],
    decisions: [],
    completedActions: [],
    openQuestions: [],
    referencedGardenIds: [],
    referencedPages: [],
    referencedFiles: [],
    temporaryPreferences: [],
  };
  try {
    const parsed = JSON.parse(value) as Partial<ConversationWorkingState>;
    return {
      ...empty,
      ...parsed,
      knownFacts: strings(parsed.knownFacts),
      decisions: strings(parsed.decisions),
      completedActions: strings(parsed.completedActions),
      openQuestions: strings(parsed.openQuestions),
      referencedFiles: strings(parsed.referencedFiles),
      temporaryPreferences: strings(parsed.temporaryPreferences),
      referencedGardenIds: Array.isArray(parsed.referencedGardenIds)
        ? parsed.referencedGardenIds.filter((item): item is number => Number.isInteger(item))
        : [],
      referencedPages: Array.isArray(parsed.referencedPages)
        ? parsed.referencedPages.filter(
            (item): item is { gardenId: number; pageSlug: string } =>
              Boolean(item) && Number.isInteger(item?.gardenId) && typeof item?.pageSlug === "string",
          )
        : [],
    };
  } catch {
    return empty;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
