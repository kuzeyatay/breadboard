// Vendored from ts-fsrs — DO NOT EDIT BY HAND.
// Upstream: https://github.com/open-spaced-repetition/ts-fsrs (MIT)
// Version:  5.4.1
// Commit:   cdec8d2f8340f8e62ced596c1da02e20e70073f0 (2026-06-25)
// Regenerate with: node dashboard/scripts/vendor-fsrs.mjs

import type { AbstractScheduler } from '../abstract_scheduler.ts'
import type { FSRSAlgorithm } from '../algorithm.ts'
import type {
  Card,
  CardInput,
  DateInput,
  FSRSParameters,
  Grade,
  State,
} from '../models.ts'
import type { IScheduler } from '../types.ts'

export const StrategyMode = {
  SCHEDULER: 'Scheduler',
  LEARNING_STEPS: 'LearningSteps',
  SEED: 'Seed',
} as const
export type StrategyMode = (typeof StrategyMode)[keyof typeof StrategyMode]

export type TSeedStrategy = (this: AbstractScheduler) => string
export type TSchedulerStrategy<T extends CardInput | Card = CardInput | Card> =
  new (
    card: T,
    now: DateInput,
    algorithm: FSRSAlgorithm,
    strategies: Map<StrategyMode, TStrategyHandler>
  ) => IScheduler

/**
 * When enable_short_term = false, the learning steps strategy will not take effect.
 */
export type TLearningStepsStrategy = (
  params: FSRSParameters,
  state: State,
  cur_step: number
) => {
  [K in Grade]?: { scheduled_minutes: number; next_step: number }
}

type StrategyMap = {
  [StrategyMode.SCHEDULER]: TSchedulerStrategy
  [StrategyMode.SEED]: TSeedStrategy
  [StrategyMode.LEARNING_STEPS]: TLearningStepsStrategy
}

export type TStrategyHandler<E = StrategyMode> = E extends StrategyMode
  ? StrategyMap[E]
  : never
