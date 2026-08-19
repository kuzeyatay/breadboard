// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/index.ts, adapted for Breadboard.
// Pruned: the samplePayload subblock injection (needs
// `@/lib/workflows/triggers/mock-payload`, editor-only) and subBlock
// namespacing (only matters when multiple triggers are merged onto one
// canvas block, which the ENGINE agent's webhook block does not do — each
// vendored trigger id maps to its own block) are dropped. `getTrigger`,
// `getAllTriggers`, and `isTriggerValid` keep the same signatures ENGINE's
// vendored blocks (generic_webhook.ts, loops.ts, block-outputs.ts) already
// call.

import { TRIGGER_REGISTRY } from './registry'
import type { TriggerConfig } from './types'

export { buildTriggerSubBlocks } from './subblocks'
export type { BuildTriggerSubBlocksOptions } from './subblocks'
export type { TriggerConfig, TriggerOutput, TriggerRegistry, TriggerSubBlock } from './types'

export function getTrigger(triggerId: string): TriggerConfig {
  const trigger = TRIGGER_REGISTRY[triggerId]
  if (!trigger) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }
  return trigger
}

export function getAllTriggers(): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY)
}

export function isTriggerValid(triggerId: string): boolean {
  return triggerId in TRIGGER_REGISTRY
}
