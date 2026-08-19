// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/human-in-the-loop/utils.ts; adapted for Breadboard.
import { PARALLEL } from '@/lib/sim/executor/constants'
import type { ExecutionContext, LoopPauseScope, ParallelPauseScope } from '@/lib/sim/executor/types'

interface NodeMetadataLike {
  nodeId: string
  loopId?: string
  parallelId?: string
  branchIndex?: number
  branchTotal?: number
}

export function generatePauseContextId(
  baseBlockId: string,
  nodeMetadata: NodeMetadataLike,
  loopScope?: LoopPauseScope
): string {
  let contextId = baseBlockId

  if (typeof nodeMetadata.branchIndex === 'number') {
    contextId = `${contextId}${PARALLEL.BRANCH.PREFIX}${nodeMetadata.branchIndex}${PARALLEL.BRANCH.SUFFIX}`
  }

  if (loopScope) {
    contextId = `${contextId}_loop${loopScope.iteration}`
  }

  return contextId
}

export function mapNodeMetadataToPauseScopes(
  ctx: ExecutionContext,
  nodeMetadata: NodeMetadataLike
): {
  parallelScope?: ParallelPauseScope
  loopScope?: LoopPauseScope
} {
  let parallelScope: ParallelPauseScope | undefined
  let loopScope: LoopPauseScope | undefined

  if (nodeMetadata.parallelId && typeof nodeMetadata.branchIndex === 'number') {
    parallelScope = {
      parallelId: nodeMetadata.parallelId,
      branchIndex: nodeMetadata.branchIndex,
      branchTotal: nodeMetadata.branchTotal,
    }
  }

  if (nodeMetadata.loopId) {
    const loopExecution = ctx.loopExecutions?.get(nodeMetadata.loopId)
    const iteration = loopExecution?.iteration ?? 0
    loopScope = {
      loopId: nodeMetadata.loopId,
      iteration,
    }
  }

  return {
    parallelScope,
    loopScope,
  }
}
