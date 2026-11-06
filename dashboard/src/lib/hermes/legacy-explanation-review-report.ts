/** Read-only shape of review receipts stored before the teaching framework was removed. */
export interface ExplanationReviewReport {
  status: 'not_applicable' | 'reviewed' | 'repaired' | 'needs_evidence' | 'unavailable';
  reason: string;
  model: string;
  method?: 'single-editor' | 'reader-editor';
  calls: number;
  durationMs: number;
  edits?: number;
  blocks?: number;
  artifacts?: Array<{ target: string; status: ExplanationReviewReport['status']; calls: number; edits?: number }>;
  /** Older saved receipts remain readable; the single editor does not emit grades. */
  repairConcerns?: { reason: string }[];
  coverage?: { id: string; status: string; reason: string; consequence: string }[];
}

