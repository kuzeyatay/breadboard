// Content versions of one assistant answer.
//
// Breadboard already had a branch model, but it branches at a *user* message:
// "ask this again and keep both answers". A humanized rewrite is a different
// thing — the same answer, said differently — and forcing it through the retry
// path would have meant inventing a user turn nobody typed.
//
// So an assistant row gains an ordered list of content versions in its
// metadata, with version 0 always the text the model actually produced. The
// row's `content` column mirrors whichever version is active, because every
// reader in the codebase — history, memory, export, the runtime's own context
// replay — reads that column and none of them should have to learn about this.
//
// Three rules the rest of the feature depends on:
//
//   * the original is never overwritten, only made inactive;
//   * applying a rewrite requires the caller to say what content it was
//     rewriting, and fails if the row has moved on since;
//   * a derived version does not inherit the original's verification evidence,
//     because that evidence was gathered about the original's wording.
//
// Server-only. Called from a route, never from a client component.

import type Database from "better-sqlite3";
import db from "../db.ts";
import type { HumanizerScoreSummary } from "../humanizer/review-types.ts";
import {
  ConversationStoreError,
  getConversationMessageById,
  type ConversationMessageRow,
} from "./store.ts";

export type MessageVersionOrigin = "original" | "humanizer";

export interface ConversationMessageVersion {
  content: string;
  origin: MessageVersionOrigin;
  createdAt: string;
  /** Index of the version this one was rewritten from. Absent on the original. */
  derivedFrom?: number;
  /** Deterministic Breadboard score for the input and this rewrite. */
  review?: HumanizerScoreSummary;
}

export interface MessageVersionState {
  versions: ConversationMessageVersion[];
  activeIndex: number;
  /** True when the active version is not the text the model produced. */
  derived: boolean;
}

/**
 * A ceiling, because this lives in a metadata column that is read on every
 * transcript load. Eight rewrites of one answer is already well past the point
 * where the person wants a different answer rather than different wording.
 */
export const MAX_CONTENT_VERSIONS = 8;

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseVersions(value: unknown): ConversationMessageVersion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ConversationMessageVersion[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.content !== "string") return [];
    const origin = record.origin === "humanizer" ? "humanizer" : "original";
    const rawReview = record.review;
    const review =
      rawReview && typeof rawReview === "object" && !Array.isArray(rawReview)
        ? (rawReview as Record<string, unknown>)
        : null;
    const parsedReview =
      review &&
      typeof review.original === "number" &&
      Number.isFinite(review.original) &&
      typeof review.rewrite === "number" &&
      Number.isFinite(review.rewrite) &&
      typeof review.delta === "number" &&
      Number.isFinite(review.delta) &&
      typeof review.tied === "boolean" &&
      typeof review.worsened === "boolean"
        ? {
            original: Number(review.original),
            rewrite: Number(review.rewrite),
            delta: Number(review.delta),
            tied: review.tied,
            worsened: review.worsened,
          }
        : undefined;
    return [
      {
        content: record.content,
        origin,
        createdAt:
          typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
        ...(Number.isInteger(record.derivedFrom)
          ? { derivedFrom: record.derivedFrom as number }
          : {}),
        ...(parsedReview ? { review: parsedReview } : {}),
      },
    ];
  });
}

/**
 * The version list for a row, synthesised when the row has never been
 * rewritten.
 *
 * Every assistant message therefore has at least one version, which keeps the
 * callers free of "has it been rewritten yet" branching.
 */
export function readMessageVersions(
  row: Pick<ConversationMessageRow, "content" | "metadata" | "created_at">,
): MessageVersionState {
  const metadata = parseMetadata(row.metadata);
  const stored = parseVersions(metadata.contentVersions);
  if (stored.length === 0) {
    return {
      versions: [{ content: row.content, origin: "original", createdAt: row.created_at }],
      activeIndex: 0,
      derived: false,
    };
  }
  const rawIndex = Number(metadata.activeContentVersion);
  const activeIndex =
    Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < stored.length ? rawIndex : 0;
  return {
    versions: stored,
    activeIndex,
    derived: stored[activeIndex].origin !== "original",
  };
}

function loadAssistantMessage(
  conversationId: number,
  messageId: number,
  database: Database.Database,
): ConversationMessageRow {
  const row = getConversationMessageById(messageId, database);
  if (!row || row.conversation_id !== conversationId) {
    throw new ConversationStoreError(404, "message_not_found", "That message no longer exists.");
  }
  if (row.role !== "assistant") {
    throw new ConversationStoreError(
      400,
      "message_not_assistant",
      "Only an assistant response can be rewritten.",
    );
  }
  if (row.status !== "complete") {
    throw new ConversationStoreError(
      409,
      "message_not_complete",
      "That response has not finished yet.",
    );
  }
  return row;
}

function write(
  row: ConversationMessageRow,
  state: MessageVersionState,
  database: Database.Database,
): MessageVersionState {
  const metadata = parseMetadata(row.metadata);
  metadata.contentVersions = state.versions;
  metadata.activeContentVersion = state.activeIndex;
  database
    .prepare(
      `UPDATE conversation_messages
       SET content = ?, metadata = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(state.versions[state.activeIndex].content, JSON.stringify(metadata), row.id);
  return state;
}

/**
 * Record a rewritten version of an assistant answer and make it active.
 *
 * `expectedContent` is optimistic concurrency, not decoration: the rewrite was
 * produced from a snapshot the browser took some seconds ago, and a turn that
 * was regenerated or steered in the meantime must not silently receive a
 * rewrite of text it no longer contains.
 */
export function addAssistantContentVersion(
  input: {
    conversationId: number;
    messageId: number;
    expectedContent: string;
    content: string;
    origin: Exclude<MessageVersionOrigin, "original">;
    review?: HumanizerScoreSummary;
  },
  database: Database.Database = db,
): MessageVersionState {
  const apply = database.transaction((): MessageVersionState => {
    const row = loadAssistantMessage(input.conversationId, input.messageId, database);
    if (row.content !== input.expectedContent) {
      throw new ConversationStoreError(
        409,
        "message_content_stale",
        "This response changed while it was being rewritten. Run the rewrite again.",
      );
    }
    const content = input.content.trim();
    if (!content) {
      throw new ConversationStoreError(400, "empty_rewrite", "A rewrite cannot be empty.");
    }

    const state = readMessageVersions(row);
    if (state.versions.length >= MAX_CONTENT_VERSIONS) {
      throw new ConversationStoreError(
        409,
        "too_many_versions",
        `A response can hold at most ${MAX_CONTENT_VERSIONS} versions.`,
      );
    }
    // Identical text is not a version. Offering the reader an arrow that
    // switches between two indistinguishable answers is worse than declining.
    if (state.versions.some((version) => version.content === content)) {
      throw new ConversationStoreError(
        409,
        "duplicate_version",
        "That rewrite is identical to a version this response already has.",
      );
    }

    const versions = [
      ...state.versions,
      {
        content,
        origin: input.origin,
        createdAt: new Date().toISOString(),
        derivedFrom: state.activeIndex,
        ...(input.review ? { review: input.review } : {}),
      },
    ];
    return write(
      row,
      { versions, activeIndex: versions.length - 1, derived: true },
      database,
    );
  });
  return apply.immediate();
}

/** Switch which stored version is on screen. The others stay where they are. */
export function selectAssistantContentVersion(
  input: { conversationId: number; messageId: number; index: number },
  database: Database.Database = db,
): MessageVersionState {
  const apply = database.transaction((): MessageVersionState => {
    const row = loadAssistantMessage(input.conversationId, input.messageId, database);
    const state = readMessageVersions(row);
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= state.versions.length) {
      throw new ConversationStoreError(
        404,
        "version_not_found",
        "That version of the response does not exist.",
      );
    }
    return write(
      row,
      {
        versions: state.versions,
        activeIndex: input.index,
        derived: state.versions[input.index].origin !== "original",
      },
      database,
    );
  });
  return apply.immediate();
}

/** What a transcript needs to draw the version arrows. No content duplicated. */
export function presentMessageVersions(state: MessageVersionState): {
  total: number;
  activeIndex: number;
  derived: boolean;
  origins: MessageVersionOrigin[];
  review?: HumanizerScoreSummary;
} {
  const activeReview = state.versions[state.activeIndex]?.review;
  return {
    total: state.versions.length,
    activeIndex: state.activeIndex,
    derived: state.derived,
    origins: state.versions.map((version) => version.origin),
    ...(activeReview ? { review: activeReview } : {}),
  };
}
