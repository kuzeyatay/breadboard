// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/dag/construction/loops.ts; adapted for Breadboard.
import { BlockType, LOOP } from '@/lib/sim/executor/constants'
import type { DAG } from '@/lib/sim/executor/dag/builder'
import { createSubflowSentinelNode } from '@/lib/sim/executor/dag/construction/sentinels'
import { buildSentinelEndId, buildSentinelStartId } from '@/lib/sim/executor/utils/subflow-utils'

export class LoopConstructor {
  execute(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      if (!reachableBlocks.has(loopId)) {
        continue
      }

      const loopNodes = loopConfig.nodes
      const hasReachableChildren = loopNodes.some((nodeId) => reachableBlocks.has(nodeId))

      if (!hasReachableChildren) {
        loopConfig.nodes = []
      }

      this.createSentinelPair(dag, loopId)
    }
  }

  private createSentinelPair(dag: DAG, loopId: string): void {
    const startId = buildSentinelStartId(loopId)
    const endId = buildSentinelEndId(loopId)

    dag.nodes.set(
      startId,
      createSubflowSentinelNode({
        id: startId,
        subflowId: loopId,
        subflowType: 'loop',
        sentinelType: LOOP.SENTINEL.START_TYPE,
        blockType: BlockType.SENTINEL_START,
        name: `${LOOP.SENTINEL.START_NAME_PREFIX} (${loopId})`,
      })
    )

    dag.nodes.set(
      endId,
      createSubflowSentinelNode({
        id: endId,
        subflowId: loopId,
        subflowType: 'loop',
        sentinelType: LOOP.SENTINEL.END_TYPE,
        blockType: BlockType.SENTINEL_END,
        name: `${LOOP.SENTINEL.END_NAME_PREFIX} (${loopId})`,
      })
    )
  }
}
