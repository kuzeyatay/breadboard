// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/handlers/registry.ts; adapted for Breadboard.
/**
 * Handler Registry
 *
 * Central registry for all block handlers. Breadboard drops sim's pi,
 * mothership, credential and credential-group handlers — those block types are
 * not vendored. Also dropped: workflow (sub-workflow calls), variables, and
 * wait handlers — their block defs (workflow, workflow_input, variables) are
 * out of Breadboard's vendored block set, so those types never appear in a
 * SerializedWorkflow and the handlers would be dead code.
 *
 * Note: Sentinels are NOT included here - they're infrastructure handled
 * by NodeExecutionOrchestrator, not user blocks.
 */

import { AgentBlockHandler } from '@/lib/sim/executor/handlers/agent/agent-handler'
import { ApiBlockHandler } from '@/lib/sim/executor/handlers/api/api-handler'
import { ConditionBlockHandler } from '@/lib/sim/executor/handlers/condition/condition-handler'
import { EvaluatorBlockHandler } from '@/lib/sim/executor/handlers/evaluator/evaluator-handler'
import { FunctionBlockHandler } from '@/lib/sim/executor/handlers/function/function-handler'
import { GenericBlockHandler } from '@/lib/sim/executor/handlers/generic/generic-handler'
import { HumanInTheLoopBlockHandler } from '@/lib/sim/executor/handlers/human-in-the-loop/human-in-the-loop-handler'
import { ResponseBlockHandler } from '@/lib/sim/executor/handlers/response/response-handler'
import { RouterBlockHandler } from '@/lib/sim/executor/handlers/router/router-handler'
import { TriggerBlockHandler } from '@/lib/sim/executor/handlers/trigger/trigger-handler'
import type { BlockHandler } from '@/lib/sim/executor/types'

export function createBlockHandlers(): BlockHandler[] {
  return [
    new TriggerBlockHandler(),
    new FunctionBlockHandler(),
    new ApiBlockHandler(),
    new ConditionBlockHandler(),
    new RouterBlockHandler(),
    new ResponseBlockHandler(),
    new HumanInTheLoopBlockHandler(),
    new AgentBlockHandler(),
    new EvaluatorBlockHandler(),
    new GenericBlockHandler(),
  ]
}
