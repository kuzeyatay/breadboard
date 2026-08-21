"use client";

import type {
  HumanizerReviewDisposition,
  HumanizerReviewPresentation,
  HumanizerScoreSummary,
} from "@/lib/humanizer/review-types.ts";

// Automatic rewriting, for when the switch is on.
//
// Standing rewrites go through the same authenticated routes and preservation
// gates as an explicit rewrite request. Skipping those gates here would let
// unchecked model output reach every reader who enabled the preference.
//
// The original is never lost. Applying stores the rewrite as a new content
// version with the model's own words as version 1, so the arrows under the
// answer switch back to it and a reload still finds it.
//
// Service failure is silence: unavailable, busy, or cancelled work leaves the
// answer alone. A completed candidate is different. Its score is shown, and a
// tied, worse, or structurally damaged candidate explicitly reports that the
// original was kept.

export interface AutoHumanizeOutcome {
  /** The stored content, which stays original when the candidate was declined. */
  content: string;
  adopted: boolean;
  review: HumanizerReviewPresentation;
  versions?: {
    total: number;
    activeIndex: number;
    derived: boolean;
    origins: Array<"original" | "humanizer">;
    review?: HumanizerScoreSummary;
  };
}

function scoreSummary(value: unknown): HumanizerScoreSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scores = value as Record<string, unknown>;
  const original = scores.original;
  const rewrite = scores.rewrite;
  if (
    !original ||
    typeof original !== "object" ||
    Array.isArray(original) ||
    !rewrite ||
    typeof rewrite !== "object" ||
    Array.isArray(rewrite)
  ) {
    return null;
  }
  const originalScore = (original as Record<string, unknown>).score;
  const rewriteScore = (rewrite as Record<string, unknown>).score;
  if (
    typeof originalScore !== "number" ||
    !Number.isFinite(originalScore) ||
    typeof rewriteScore !== "number" ||
    !Number.isFinite(rewriteScore) ||
    typeof scores.delta !== "number" ||
    !Number.isFinite(scores.delta) ||
    typeof scores.tied !== "boolean" ||
    typeof scores.worsened !== "boolean"
  ) {
    return null;
  }
  return {
    original: originalScore,
    rewrite: rewriteScore,
    delta: scores.delta,
    tied: scores.tied,
    worsened: scores.worsened,
  };
}

function declinedOutcome(
  content: string,
  scores: HumanizerScoreSummary,
  disposition: Exclude<HumanizerReviewDisposition, "adopted">,
  integrityIssues?: string[],
): AutoHumanizeOutcome {
  return {
    content,
    adopted: false,
    review: {
      ...scores,
      adopted: false,
      disposition,
      ...(integrityIssues?.length ? { integrityIssues } : {}),
    },
  };
}

function newRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Rewrite one finished answer and adopt the result.
 *
 * Returns null whenever nothing was adopted, for any reason at all. The caller
 * leaves the answer alone in that case.
 */
export async function autoHumanizeMessage(input: {
  conversationId: string;
  messageId: string;
  content: string;
  signal?: AbortSignal;
}): Promise<AutoHumanizeOutcome | null> {
  try {
    const rewrite = await fetch("/api/humanizer/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.content, requestId: newRequestId() }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!rewrite.ok) return null;
    const review = (await rewrite.json()) as {
      rewrittenText?: string;
      unchanged?: boolean;
      scores?: unknown;
      integrity?: { passed?: boolean; issues?: unknown };
    };
    // The gates reverted everything, or the model had nothing to add. Adopting
    // an identical version would give the reader arrows that switch between two
    // indistinguishable answers.
    if (!review.rewrittenText || review.unchanged) return null;
    const scores = scoreSummary(review.scores);
    if (!scores) return null;
    const integrityIssues = Array.isArray(review.integrity?.issues)
      ? review.integrity.issues.filter(
          (issue): issue is string => typeof issue === "string" && Boolean(issue.trim()),
        )
      : [];
    if (review.integrity?.passed === false) {
      return declinedOutcome(input.content, scores, "kept_integrity", integrityIssues);
    }
    // A standing preference must be conservative. `/humanize` can show a tied
    // or worse candidate for a person to judge; automatic adoption cannot.
    if (scores.worsened) return declinedOutcome(input.content, scores, "kept_worse");
    if (scores.tied) return declinedOutcome(input.content, scores, "kept_tied");

    const applied = await fetch("/api/humanizer/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: input.conversationId,
        messageId: input.messageId,
        // The server refuses if the answer moved on since the rewrite began.
        expectedContent: input.content,
        rewrittenText: review.rewrittenText,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!applied.ok) return null;
    const body = (await applied.json()) as {
      content?: string;
      versions?: AutoHumanizeOutcome["versions"];
    };
    if (typeof body.content !== "string" || !body.versions) return null;
    return {
      content: body.content,
      adopted: true,
      versions: body.versions,
      review: {
        ...scores,
        adopted: true,
        disposition: "adopted",
      },
    };
  } catch {
    return null;
  }
}
