// The conditions a rated answer was produced under.
//
// This is the part that turns a thumb into evidence. A rating on its own says
// an answer was good or bad; it cannot say whether that was the model, the
// contracts that shipped, the surface, the length, or the shape of the
// question — and a feedback loop that cannot attribute is a loop that invents
// explanations. So every signal freezes a small, flat snapshot of what varied.
//
// Two rules govern what belongs here.
//
// Nothing is recorded that the message row already holds. The prompt, the
// answer text, the surface and the token usage are all reachable through
// `message_id`; copying them would double the storage and let the copy drift.
// What is recorded is what the row does *not* hold: the derived state of the
// per-turn contracts.
//
// The contract state is re-derived rather than remembered. `classifyMetaTask`
// and `classifyQuestionScope` are deterministic and domain-free by
// construction, so running them here over the stored user text reproduces what
// shipped on the turn — provided the env flags have not moved since. That
// proviso is the reason `contractFlags` is part of the snapshot: an analysis
// comparing turns has to be able to throw away rows whose gates were
// configured differently, and it can only do that if each row says.
//
// The alternative — threading a conditions object through every turn pipeline
// to the write — would touch garden chat, quartz, the direct path, the runtime
// event stream and every delivery adapter, and would still miss the turns that
// completed before the column existed. Re-derivation costs one classifier run
// at rating time and works on answers given months ago.

import type { ConversationMessageRow } from "../conversations/store.ts";
import {
  answerDepthEnabled,
  classifyQuestionScope,
  type QuestionScope,
} from "./answer-depth.ts";
import {
  classifyMetaTask,
  metaPromptingEnabled,
  type MetaTaskCategory,
} from "./meta-prompting.ts";
import type { HermesSurface } from "./config.ts";

/**
 * Bumped when the shape below changes in a way that makes old snapshots
 * incomparable. The analysis groups on these fields, so silently changing what
 * one means would mix two populations into one average.
 */
export const CONDITIONS_VERSION = 1;

export interface AnswerConditions {
  version: number;
  surface: HermesSurface;
  /** Which model actually answered, where the turn recorded it. */
  model: string | null;
  /** The provider-only path records this; the runtime path leaves it null. */
  backend: string | null;
  runtimeStatus: string | null;
  /** How the answer ended. A rating on a failed turn is about the failure. */
  status: ConversationMessageRow["status"];
  responseDurationMs: number | null;
  promptChars: number;
  answerChars: number;
  toolCallCount: number;
  sourceCount: number;
  totalTokens: number | null;
  verificationState: string | null;
  evidenceCount: number;
  unsupportedClaimCount: number;
  /** True when the answer came from a branch, an edit, or an internal delivery. */
  derived: boolean;
  contracts: {
    metaTask: MetaTaskCategory;
    questionScope: QuestionScope;
    /**
     * The capability decision is not persisted on the row, so the meta-task
     * category is re-derived without it. It matches the shipped category on
     * every turn where the decision did not break a tie — which is most of
     * them, and the flag says so rather than the analysis assuming it.
     */
    metaTaskApproximate: true;
  };
  contractFlags: {
    answerDepth: boolean;
    metaPrompting: boolean;
  };
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Count a column that holds a JSON array. Stored columns are written by several
 * paths across several years of this schema, so a malformed or absent one is a
 * normal input here: capturing conditions must never be the thing that fails a
 * rating the user just gave.
 */
function countJsonArrayColumn(raw: string | null): number {
  if (!raw) return 0;
  try {
    return countArray(JSON.parse(raw));
  } catch {
    return 0;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Total tokens, however the turn happened to record them.
 *
 * Usage shapes differ by provider and by path, and a missing total is normal
 * rather than exceptional — a failed turn, a cached turn and an external agent
 * delivery all leave it absent. Returning null is the honest answer; summing a
 * partial shape into a number would put a confident wrong figure in front of
 * the analysis.
 */
function totalTokensFrom(usage: Record<string, unknown>): number | null {
  const direct = readNumber(usage, "totalTokens") ?? readNumber(usage, "total_tokens");
  if (direct !== null) return direct;
  const input =
    readNumber(usage, "inputTokens") ?? readNumber(usage, "prompt_tokens");
  const output =
    readNumber(usage, "outputTokens") ?? readNumber(usage, "completion_tokens");
  if (input === null && output === null) return null;
  return (input ?? 0) + (output ?? 0);
}

/**
 * True when the text on the row is not what the model first wrote — a branch,
 * an adopted rewrite, an internal agent delivery. A rating on a derived answer
 * is a rating of the derivation, so the analysis has to be able to separate it
 * from a rating of a first-pass answer.
 */
function isDerived(metadata: Record<string, unknown>): boolean {
  return Boolean(
    metadata.internalAgentContinuation ||
      metadata.branchGroupId ||
      metadata.humanizerVersions ||
      metadata.contentVersions,
  );
}

export function captureAnswerConditions(input: {
  assistant: ConversationMessageRow;
  /** The user turn this answer replied to, when one precedes it. */
  prompt: ConversationMessageRow | null;
}): AnswerConditions {
  const metadata = parseJsonObject(input.assistant.metadata);
  const usage = parseJsonObject(input.assistant.token_usage);
  const verification = asObject(metadata.verification);
  const promptText = input.prompt?.content ?? "";
  const surface = input.assistant.surface;

  return {
    version: CONDITIONS_VERSION,
    surface,
    model: readString(metadata, "model"),
    backend: readString(metadata, "backend"),
    runtimeStatus: readString(metadata, "runtimeStatus"),
    status: input.assistant.status,
    responseDurationMs: readNumber(metadata, "responseDurationMs"),
    promptChars: promptText.length,
    answerChars: input.assistant.content.length,
    toolCallCount: countArray(metadata.toolCalls),
    sourceCount: countJsonArrayColumn(input.assistant.sources),
    totalTokens: totalTokensFrom(usage),
    verificationState: readString(verification, "state"),
    evidenceCount: countArray(verification.evidence),
    unsupportedClaimCount: countArray(verification.unsupportedClaims),
    derived: isDerived(metadata),
    contracts: {
      metaTask: classifyMetaTask({ userText: promptText, surface }).category,
      questionScope: classifyQuestionScope(promptText).scope,
      metaTaskApproximate: true,
    },
    contractFlags: {
      answerDepth: answerDepthEnabled(),
      metaPrompting: metaPromptingEnabled(),
    },
  };
}
