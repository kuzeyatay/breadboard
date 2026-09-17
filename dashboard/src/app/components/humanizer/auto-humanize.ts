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
// Failures leave the answer alone and report their outcome beside the answer's
// actions. Rewriting is separate from generating the original response.

export interface AutoHumanizeProgress {
  state: "running" | "complete" | "failed";
  message: string;
}

async function rewriteFailure(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
  const reason = body.code ?? body.error;
  const reasons: Record<string, string> = {
    disabled: "Local rewriting is disabled",
    unavailable: "The local rewriter is unavailable",
    not_installed: "The local rewriting model is not installed",
    busy: "The local rewriter is busy",
    timeout: "The natural rewrite timed out",
    cancelled: "Natural rewrite cancelled",
    preservation_failed: "The natural rewrite did not preserve the answer",
    runtime_resource_exhausted: "There is not enough available memory to start the local rewriter",
  };
  return `${reasons[reason ?? ""] ?? "The natural rewrite could not finish"}. Original answer kept.`;
}

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
 * Returns a review for accepted and declined candidates, or null when no
 * candidate is available. Progress always explains why the original was kept.
 */
export async function autoHumanizeMessage(input: {
  conversationId: string;
  messageId: string;
  content: string;
  signal?: AbortSignal;
  onProgress?: (progress: AutoHumanizeProgress) => void;
}): Promise<AutoHumanizeOutcome | null> {
  const report = (state: AutoHumanizeProgress["state"], message: string) =>
    input.onProgress?.({ state, message });
  try {
    report("running", "Writing naturally…");
    const rewrite = await fetch("/api/humanizer/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.content, requestId: newRequestId() }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!rewrite.ok) {
      report("failed", await rewriteFailure(rewrite));
      return null;
    }
    const review = (await rewrite.json()) as {
      rewrittenText?: string;
      unchanged?: boolean;
      scores?: unknown;
      integrity?: { passed?: boolean; issues?: unknown };
    };
    const scores = scoreSummary(review.scores);
    if (!scores) throw new Error("Missing rewrite review");
    // The gates reverted everything, or the model had nothing to add. Adopting
    // an identical version would give the reader arrows that switch between two
    // indistinguishable answers.
    if (review.unchanged) {
      report("complete", "Natural rewrite checked. The rewriter returned the same wording; original answer kept.");
      return declinedOutcome(input.content, scores, "kept_tied");
    }
    if (!review.rewrittenText) throw new Error("Missing rewrite candidate");
    const integrityIssues = Array.isArray(review.integrity?.issues)
      ? review.integrity.issues.filter(
          (issue): issue is string => typeof issue === "string" && Boolean(issue.trim()),
        )
      : [];
    if (review.integrity?.passed === false) {
      report("complete", "Natural rewrite checked. Original answer kept to preserve its content and structure.");
      return declinedOutcome(input.content, scores, "kept_integrity", integrityIssues);
    }
    // A standing preference must be conservative. `/humanize` can show a tied
    // or worse candidate for a person to judge; automatic adoption cannot.
    if (scores.worsened || scores.tied) {
      report("complete", "Natural rewrite checked. Original answer kept because the rewrite did not improve it.");
      return declinedOutcome(input.content, scores, scores.worsened ? "kept_worse" : "kept_tied");
    }

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
    if (!applied.ok) {
      report("failed", "The natural rewrite could not be saved. Original answer kept.");
      return null;
    }
    const body = (await applied.json()) as {
      content?: string;
      versions?: AutoHumanizeOutcome["versions"];
    };
    if (typeof body.content !== "string" || !body.versions) throw new Error("Missing saved rewrite");
    report("complete", "Rewritten naturally. Original answer saved as a previous version.");
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
    report("failed", input.signal?.aborted
      ? "Natural rewrite cancelled. Original answer kept."
      : "The natural rewrite could not finish. Original answer kept.");
    return null;
  }
}
