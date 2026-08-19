// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/dag/construction/parallels.ts; adapted for Breadboard.
import { BlockType, PARALLEL } from '@/lib/sim/executor/constants'
import type { DAG } from '@/lib/sim/executor/dag/builder'
import { createSubflowSentinelNode } from '@/lib/sim/executor/dag/construction/sentinels'
import {
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
} from '@/lib/sim/executor/utils/subflow-utils'

export class ParallelConstructor {
  execute(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      if (!reachableBlocks.has(parallelId)) {
        continue
      }

      const parallelNodes = parallelConfig.nodes
      const hasReachableChildren = parallelNodes.some((nodeId) => reachableBlocks.has(nodeId))

      if (!hasReachableChildren) {
        parallelConfig.nodes = []
      }

      this.createSentinelPair(dag, parallelId)
    }
  }

  private createSentinelPair(dag: DAG, parallelId: string): void {
    const startId = buildParallelSentinelStartId(parallelId)
    const endId = buildParallelSentinelEndId(parallelId)

    dag.nodes.set(
      startId,
      createSubflowSentinelNode({
        id: startId,
        subflowId: parallelId,
        subflowType: 'parallel',
        sentinelType: PARALLEL.SENTINEL.START_TYPE,
        blockType: BlockType.SENTINEL_START,
        name: `${PARALLEL.SENTINEL.START_NAME_PREFIX} (${parallelId})`,
      })
    )

    dag.nodes.set(
      endId,
      createSubflowSentinelNode({
        id: endId,
        subflowId: parallelId,
        subflowType: 'parallel',
        sentinelType: PARALLEL.SENTINEL.END_TYPE,
        blockType: BlockType.SENTINEL_END,
        name: `${PARALLEL.SENTINEL.END_NAME_PREFIX} (${parallelId})`,
      })
    )
  }
}
