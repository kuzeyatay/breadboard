// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/blocks/registry-maps.ts (trimmed to Breadboard's block set); adapted for Breadboard.
//
// The `loops` and `parallel_ai` entries an earlier vendoring pass added were sim's
// Loops.so and Parallel AI *integration* blocks, not the control-flow loop/parallel
// containers they were mistaken for — those are not BlockConfigs in sim either: the DAG
// builder compiles them from `SerializedWorkflow.loops` / `.parallels` into sentinel nodes.
// Both were removed: neither integration's tools were vendored, and the Loops.so block
// threw at import time reaching for eight trigger definitions the trigger registry does
// not carry, which made the whole engine unloadable.
import { AgentBlock } from '@/lib/sim/blocks/blocks/agent'
import { ApiBlock } from '@/lib/sim/blocks/blocks/api'
import { ApiTriggerBlock } from '@/lib/sim/blocks/blocks/api_trigger'
import { ConditionBlock } from '@/lib/sim/blocks/blocks/condition'
import { EvaluatorBlock } from '@/lib/sim/blocks/blocks/evaluator'
import { FunctionBlock } from '@/lib/sim/blocks/blocks/function'
import { GenericWebhookBlock } from '@/lib/sim/blocks/blocks/generic_webhook'
import { InputTriggerBlock } from '@/lib/sim/blocks/blocks/input_trigger'
import { ResponseBlock } from '@/lib/sim/blocks/blocks/response'
import { RouterBlock } from '@/lib/sim/blocks/blocks/router'
import { ScheduleBlock } from '@/lib/sim/blocks/blocks/schedule'
import { StarterBlock } from '@/lib/sim/blocks/blocks/starter'
import type { BlockConfig, BlockMeta } from '@/lib/sim/blocks/types'

/** Every block type Breadboard vendors, keyed by its registry type string. */
export const BLOCK_REGISTRY: Record<string, BlockConfig> = {
  starter: StarterBlock,
  api_trigger: ApiTriggerBlock,
  input_trigger: InputTriggerBlock,
  generic_webhook: GenericWebhookBlock,
  schedule: ScheduleBlock,
  agent: AgentBlock,
  api: ApiBlock,
  function: FunctionBlock,
  condition: ConditionBlock,
  router: RouterBlock,
  evaluator: EvaluatorBlock,
  response: ResponseBlock,
}

/** Catalog/presentation metadata, keyed the same way as BLOCK_REGISTRY. */
export const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {}
