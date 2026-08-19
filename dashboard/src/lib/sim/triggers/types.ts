// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/types.ts, adapted for Breadboard.
// Adaptation: SubBlockConfig/OutputCondition come from the already-vendored
// blocks/types (ENGINE agent's copy) instead of sim's `@/blocks/types` alias,
// and are re-exported so trigger definition files can import everything from
// this one module.

import type { OutputCondition, SubBlockConfig } from '../blocks/types'

export type { OutputCondition, SubBlockConfig }

/** A trigger sub-block: the narrow slice of sim's SubBlockConfig triggers use. */
export type TriggerSubBlock = SubBlockConfig

export interface TriggerOutput {
  type?: string
  description?: string | TriggerOutput
  condition?: OutputCondition
  [key: string]: TriggerOutput | OutputCondition | string | undefined
}

export interface TriggerConfig {
  id: string
  name: string
  provider: string
  description: string
  version: string
  icon?: React.ComponentType<{ className?: string }>
  subBlocks: SubBlockConfig[]
  outputs: Record<string, TriggerOutput>
  webhook?: {
    method?: 'POST' | 'GET' | 'PUT' | 'DELETE'
    headers?: Record<string, string>
  }
  /** When true, poll-based (cron-driven) rather than push-based. */
  polling?: boolean
  deprecated?: boolean
}

export interface TriggerRegistry {
  [triggerId: string]: TriggerConfig
}
