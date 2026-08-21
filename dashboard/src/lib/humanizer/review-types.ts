export interface HumanizerScoreSummary {
  original: number;
  rewrite: number;
  delta: number;
  tied: boolean;
  worsened: boolean;
}

export type HumanizerReviewDisposition =
  | "adopted"
  | "kept_tied"
  | "kept_worse"
  | "kept_integrity";

/** Compact result shown below an answer after standing humanization runs. */
export interface HumanizerReviewPresentation extends HumanizerScoreSummary {
  adopted: boolean;
  disposition: HumanizerReviewDisposition;
  integrityIssues?: string[];
}
