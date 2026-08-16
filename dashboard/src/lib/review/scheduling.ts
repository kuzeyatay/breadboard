// The seam between Breadboard's stored rows and the vendored FSRS scheduler.
//
// Everything that knows FSRS exists lives here. The store persists loose columns,
// the delivery path speaks in grades, and neither imports ./fsrs directly — so
// pulling a newer upstream only ever has to satisfy this file.
//
// Why FSRS rather than a hand-rolled SM-2: scheduling is the one genuinely hard
// part of spaced repetition, and it has been solved empirically. FSRS models
// memory as difficulty/stability/retrievability fitted against hundreds of
// millions of real reviews, and needs roughly 20-30% fewer reviews than SM-2 for
// the same retention target. It is Anki's default scheduler.

import { createEmptyCard } from "./fsrs/default.ts";
import { fsrs } from "./fsrs/fsrs.ts";
import { Rating, State, type Card, type Grade, type ReviewLog } from "./fsrs/models.ts";
import { REVIEW_GRADES, type ReviewGradeName, type ReviewGradeValue } from "./types.ts";

// The grade numbers in ./types.ts are mirrored so client components can import
// them without pulling the scheduler into the browser bundle. A mirror that
// drifts would silently reschedule against the wrong rating, so it is asserted
// here — at the one place that imports both — rather than trusted.
{
  const mismatch =
    REVIEW_GRADES.again !== Rating.Again ||
    REVIEW_GRADES.hard !== Rating.Hard ||
    REVIEW_GRADES.good !== Rating.Good ||
    REVIEW_GRADES.easy !== Rating.Easy;
  if (mismatch) {
    throw new Error(
      "REVIEW_GRADES no longer matches the vendored FSRS Rating enum. " +
        "Re-check src/lib/review/types.ts against src/lib/review/fsrs/models.ts.",
    );
  }
}

/** The scheduler-facing half of a stored card row. */
export interface StoredCardState {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export interface StoredReviewLog {
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  review: string;
}

function iso(date: Date): string {
  return date.toISOString();
}

/** A fresh, never-reviewed card, due immediately. */
export function newCardState(now: Date = new Date()): StoredCardState {
  return toStored(createEmptyCard(now));
}

export function toStored(card: Card): StoredCardState {
  return {
    due: iso(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? iso(card.last_review) : null,
  };
}

export function fromStored(row: StoredCardState): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function gradeValue(name: ReviewGradeName): ReviewGradeValue {
  return REVIEW_GRADES[name];
}

/**
 * Apply a grade and return the rescheduled card plus the log entry to persist.
 *
 * `desiredRetention` is the user's target recall probability; a higher value
 * produces shorter intervals. Everything else stays on upstream defaults —
 * personalised parameters require training on a few hundred reviews, which is
 * what ./schema.ts's review_logs table is accumulating toward.
 */
export function applyGrade(
  stored: StoredCardState,
  rating: ReviewGradeValue,
  options: { desiredRetention: number; now?: Date },
): { card: StoredCardState; log: StoredReviewLog } {
  const scheduler = fsrs({ request_retention: options.desiredRetention });
  const now = options.now ?? new Date();
  const { card, log } = scheduler.next(fromStored(stored), now, rating as Grade);
  return { card: toStored(card), log: toStoredLog(log) };
}

function toStoredLog(log: ReviewLog): StoredReviewLog {
  return {
    rating: log.rating,
    state: log.state,
    due: iso(log.due),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    learning_steps: log.learning_steps,
    review: iso(log.review),
  };
}

/**
 * The interval each grade would produce, for showing "Again 1m / Good 4d" style
 * hints in the panel without committing to a grade.
 */
export function previewIntervals(
  stored: StoredCardState,
  options: { desiredRetention: number; now?: Date },
): Record<ReviewGradeName, string> {
  const scheduler = fsrs({ request_retention: options.desiredRetention });
  const now = options.now ?? new Date();
  const card = fromStored(stored);
  const out = {} as Record<ReviewGradeName, string>;
  for (const name of Object.keys(REVIEW_GRADES) as ReviewGradeName[]) {
    const { card: next } = scheduler.next(card, now, REVIEW_GRADES[name] as Grade);
    out[name] = humanizeInterval(next.due.getTime() - now.getTime());
  }
  return out;
}

export function humanizeInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export { State as ReviewCardState };
