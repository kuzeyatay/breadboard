// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/dag/construction/sentinels.ts; adapted for Breadboard.
import type { BlockType, SentinelType } from '@/lib/sim/executor/constants'
import type { DAGNode } from '@/lib/sim/executor/dag/builder'
import type { SentinelSubflowType } from '@/lib/sim/executor/dag/types'

interface SubflowSentinelNodeConfig {
  id: string
  subflowId: string
  subflowType: SentinelSubflowType
  sentinelType: SentinelType
  blockType: BlockType
  name: string
}

export function createSubflowSentinelNode(config: SubflowSentinelNodeConfig): DAGNode {
  return {
    id: config.id,
    block: {
      id: config.id,
      enabled: true,
      position: { x: 0, y: 0 },
      metadata: {
        id: config.blockType,
        name: config.name,
      },
      config: { tool: config.blockType, params: {} },
      inputs: {},
      outputs: {},
    },
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata: {
      isSentinel: true,
      sentinelType: config.sentinelType,
      subflowId: config.subflowId,
      subflowType: config.subflowType,
    },
  }
}
