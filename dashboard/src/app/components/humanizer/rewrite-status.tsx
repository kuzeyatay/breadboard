import type { HumanizerReviewPresentation, HumanizerScoreSummary } from "@/lib/humanizer/review-types";
import type { AutoHumanizeProgress } from "./auto-humanize";

export interface NaturalRewriteResult {
  humanizerReview?: HumanizerReviewPresentation;
  contentVersions?: { review?: HumanizerScoreSummary };
}

/** Use the persisted version score after a transcript reload, too. */
export function messageRewriteReview(message: NaturalRewriteResult): HumanizerReviewPresentation | undefined {
  const score = message.contentVersions?.review;
  return message.humanizerReview ?? (score ? { ...score, adopted: true, disposition: "adopted" } : undefined);
}

export default function RewriteStatus({ review, progress }: {
  review?: HumanizerReviewPresentation;
  progress?: AutoHumanizeProgress;
}) {
  if (!review || (progress && progress.state !== "complete")) {
    return progress ? <span role="status" className="ml-2 text-xs text-[var(--ink-muted)]">{progress.message}</span> : null;
  }
  const kept = !review.adopted;
  const reason = review.disposition === "kept_integrity"
    ? "The rewrite did not preserve the answer."
    : review.disposition === "kept_worse"
      ? "The rewrite scored worse."
      : kept ? "The rewrite did not improve the score." : "Rewritten naturally.";
  return (
    <span role="status" className="ml-2 text-xs tabular-nums text-[var(--ink-muted)]"
      title={`${reason} Lower is better. This measures writing patterns, not the probability that text is AI-written.`}>
      Style score {review.original} → {review.rewrite}{kept ? " · original kept" : ""}
    </span>
  );
}
