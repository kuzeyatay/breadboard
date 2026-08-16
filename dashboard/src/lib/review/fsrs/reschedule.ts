// Vendored from ts-fsrs — DO NOT EDIT BY HAND.
// Upstream: https://github.com/open-spaced-repetition/ts-fsrs (MIT)
// Version:  5.4.1
// Commit:   cdec8d2f8340f8e62ced596c1da02e20e70073f0 (2026-06-25)
// Regenerate with: node dashboard/scripts/vendor-fsrs.mjs

import { TypeConvert } from './convert.ts'
import { createEmptyCard } from './default.ts'
import { FSRSValidationError } from './error.ts'
import type { FSRS } from './fsrs.ts'
import { date_diff } from './help.ts'
import {
  type Card,
  type CardInput,
  type DateInput,
  type FSRSHistory,
  type Grade,
  Rating,
  type RecordLogItem,
  type ReviewLog,
  State,
} from './models.ts'

/**
 * The `Reschedule` class provides methods to handle the rescheduling of cards based on their review history.
 * determine the next review dates and update the card's state accordingly.
 */
export class Reschedule {
  private fsrs: FSRS
  /**
   * Creates an instance of the `Reschedule` class.
   * @param fsrs - An instance of the FSRS class used for scheduling.
   */
  constructor(fsrs: FSRS) {
    this.fsrs = fsrs
  }

  /**
   * Replays a review for a card and determines the next review date based on the given rating.
   * @param card - The card being reviewed.
   * @param reviewed - The date the card was reviewed.
   * @param rating - The grade given to the card during the review.
   * @returns A `RecordLogItem` containing the updated card and review log.
   */
  replay(card: Card, reviewed: Date, rating: Grade): RecordLogItem {
    return this.fsrs.next(card, reviewed, rating)
  }

  /**
   * Processes a manual review for a card, allowing for custom state, stability, difficulty, and due date.
   * @param card - The card being reviewed.
   * @param state - The state of the card after the review.
   * @param reviewed - The date the card was reviewed.
   * @param elapsed_days - The number of days since the last review.
   * @param stability - (Optional) The stability of the card.
   * @param difficulty - (Optional) The difficulty of the card.
   * @param due - (Optional) The due date for the next review.
   * @returns A `RecordLogItem` containing the updated card and review log.
   * @throws Will throw an error if the state or due date is not provided when required.
   */
  handleManualRating(
    card: Card,
    state: State,
    reviewed: Date,
    elapsed_days: number,
    stability?: number,
    difficulty?: number,
    due?: Date
  ): RecordLogItem {
    if (typeof state === 'undefined') {
      throw new FSRSValidationError(
        'reschedule: state is required for manual rating'
      )
    }
    let log: ReviewLog
    let next_card: Card
    if (state as State === State.New) {
      log = {
        rating: Rating.Manual,
        state: state,
        due: due as Date ?? reviewed,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days: elapsed_days,
        last_elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        review: reviewed as Date,
      } satisfies ReviewLog
      next_card = createEmptyCard<Card>(reviewed)
      next_card.last_review = reviewed
    } else {
      if (typeof due === 'undefined') {
        throw new FSRSValidationError(
          'reschedule: due is required for manual rating'
        )
      }
      const scheduled_days = date_diff(due, reviewed, 'days')
      log = {
        rating: Rating.Manual,
        state: card.state as State,
        due: card.last_review || card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days: elapsed_days,
        last_elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        review: reviewed as Date,
      } satisfies ReviewLog
      next_card = {
        ...card,
        state: state as State,
        due: due as Date,
        last_review: reviewed as Date,
        stability: stability || card.stability,
        difficulty: difficulty || card.difficulty,
        elapsed_days: elapsed_days,
        scheduled_days: scheduled_days,
        reps: card.reps + 1,
      } satisfies Card
    }

    return { card: next_card, log }
  }

  /**
   * Reschedules a card based on its review history.
   *
   * @param current_card - The card to be rescheduled.
   * @param reviews - An array of review history objects.
   * @returns An array of record log items representing the rescheduling process.
   */
  reschedule(current_card: CardInput, reviews: FSRSHistory[]) {
    const collections: RecordLogItem[] = []
    let cur_card = createEmptyCard<Card>(current_card.due)
    for (const review of reviews) {
      let item: RecordLogItem
      review.review = TypeConvert.time(review.review)
      if (review.rating === Rating.Manual) {
        // ref: abstract_scheduler.ts#init
        let interval = 0
        if (cur_card.state !== State.New && cur_card.last_review) {
          interval = date_diff(review.review, cur_card.last_review, 'days')
        }
        item = this.handleManualRating(
          cur_card,
          review.state,
          review.review,
          interval,
          review.stability,
          review.difficulty,
          review.due ? TypeConvert.time(review.due) : undefined
        )
      } else {
        item = this.replay(cur_card, review.review, review.rating)
      }
      collections.push(item)
      cur_card = item.card
    }
    return collections
  }

  calculateManualRecord(
    current_card: CardInput,
    now: DateInput,
    record_log_item?: RecordLogItem,
    update_memory?: boolean
  ): RecordLogItem | null {
    if (!record_log_item) {
      return null
    }
    // if first_card === recordItem.card then return null
    const { card: reschedule_card, log } = record_log_item
    const cur_card = TypeConvert.card(current_card) as Card // copy card
    if (cur_card.due.getTime() === reschedule_card.due.getTime()) {
      return null
    }
    cur_card.scheduled_days = date_diff(
      reschedule_card.due,
      cur_card.due,
      'days'
    )
    return this.handleManualRating(
      cur_card,
      reschedule_card.state,
      TypeConvert.time(now),
      log.elapsed_days,
      update_memory ? reschedule_card.stability : undefined,
      update_memory ? reschedule_card.difficulty : undefined,
      reschedule_card.due
    )
  }
}
