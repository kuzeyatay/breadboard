// mem0 fact extraction over a completed exchange.
//
// The regex extractor in conversations/memory.ts catches only stated
// intentions ("remember X", "we decided Y"). mem0's LLM pass reads the whole
// exchange and proposes atomic facts the user never phrased as instructions.
//
// What it proposes is deliberately weak: every extracted fact lands as a
// `candidate` at low confidence, exactly like the regex decision path, so it
// ranks below anything the user confirmed and stays reviewable in
// Settings → Memory. Extraction never produces a `confirmed` memory — only an
// explicit user instruction or an explicit save_memory tool call can do that.
//
// Off by default (BREADBOARD_MEM0_EXTRACTION=on): it costs one LLM call per
// completed turn.

import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  durableMemoryExclusionReason,
  normalizeDurableMemoryContent,
  saveDurableMemory,
  type DurableMemoryKind,
} from "../conversations/memory.ts";
import { recordAuditEvent } from "../hermes/runtime-store.ts";
import {
  withSemanticMemoryClient,
  type SemanticMemoryClient,
} from "./client.ts";
import { mem0Config } from "./config.ts";
import { mirrorContentHash, upsertMirror } from "./mirror.ts";

const MAX_FACTS_PER_TURN = 4;
const EXTRACTED_CONFIDENCE = 0.42;
const EXTRACTED_SALIENCE = 0.55;

export interface ExtractionOutcome {
  saved: number;
  skipped: number;
}

/**
 * Extract durable candidates from one exchange. Resolves to null when the
 * extraction layer is off or unavailable — never throws into a turn.
 */
export async function extractDurableCandidates(input: {
  userId: number;
  conversationId: number;
  runtimeSessionId?: number | null;
  activeGardenId?: number | null;
  userText: string;
  assistantText: string;
  database?: Database.Database;
  clientOverride?: SemanticMemoryClient | null;
}): Promise<ExtractionOutcome | null> {
  if (!input.userText.trim()) return null;
  // Do not even send an opted-out or temporary deliberation turn to the
  // extraction engine. This is a privacy boundary, not merely a write filter.
  if (durableMemoryExclusionReason(input.userText)) return null;
  const config = mem0Config();
  const database = input.database ?? db;
  const extract = async (
    client: SemanticMemoryClient,
  ): Promise<ExtractionOutcome> => {
    const facts = await client.extract(
      [
        { role: "user", content: input.userText },
        ...(input.assistantText.trim()
          ? [{ role: "assistant" as const, content: input.assistantText }]
          : []),
      ],
      { userId: input.userId },
    );

    let saved = 0;
    let skipped = 0;
    for (const fact of facts.slice(0, MAX_FACTS_PER_TURN)) {
      // The same secret filter and 1000-char cap every other write path uses.
      const content = normalizeDurableMemoryContent(fact.text);
      if (!content) {
        skipped += 1;
        // The fact is in mem0's index but must not be in Breadboard's memory.
        await client.remove(fact.mem0Id).catch(() => {});
        continue;
      }
      const row = saveDurableMemory({
        userId: input.userId,
        content,
        kind: inferExtractedKind(content),
        scope: input.activeGardenId ? "garden" : "project",
        scopeId: input.activeGardenId ? String(input.activeGardenId) : "breadboard",
        sourceConversationId: input.conversationId,
        state: "candidate",
        confidence: EXTRACTED_CONFIDENCE,
        salience: EXTRACTED_SALIENCE,
      }, database);
      if (!row) {
        skipped += 1;
        // saveDurableMemory may reject a rephrased temporary deliberation. The
        // extractor already indexed it, so remove that vector as well.
        await client.remove(fact.mem0Id).catch(() => {});
        continue;
      }
      // The fact is already embedded, so claim its vector rather than paying to
      // index the same text twice — but only when the vector really does hold
      // what the canonical row holds. Normalization can rewrite the text, and
      // saveDurableMemory returns a pre-existing row when the memory key
      // collides; in both cases the mem0 entry says something the row does not,
      // and a mirror claiming otherwise would make the reconciler treat a wrong
      // index as current forever. Leaving it unmirrored costs one embedding on
      // the next pass and keeps the index honest.
      if (row.content === content && content === fact.text) {
        upsertMirror(
          database,
          row.id,
          fact.mem0Id,
          mirrorContentHash(row.content),
          config.fingerprint,
        );
      } else {
        await client.remove(fact.mem0Id).catch(() => {});
      }
      saved += 1;
    }

    if (saved || skipped) {
      recordAuditEvent({
        eventType: "memory.mem0.extracted",
        runtimeSessionId: input.runtimeSessionId ?? null,
        userId: input.userId,
        payload: { conversationId: input.conversationId, saved, skipped },
      });
    }
    return { saved, skipped };
  };

  try {
    if (input.clientOverride !== undefined) {
      return input.clientOverride ? await extract(input.clientOverride) : null;
    }
    if (!config.extractionEnabled) return null;
    return await withSemanticMemoryClient("extraction", extract);
  } catch {
    return null;
  }
}

/** Same vocabulary as inferMemoryKind, over a fact rather than an instruction. */
function inferExtractedKind(value: string): DurableMemoryKind {
  if (/\b(?:prefer|prefers|preference|likes?|dislikes?|avoids?)\b/i.test(value)) return "preference";
  if (/\b(?:workflow|always|usually|habit|routine|process)\b/i.test(value)) return "working_pattern";
  if (/\b(?:decided|decision|chose|must use|architecture)\b/i.test(value)) return "decision";
  return "project_fact";
}
