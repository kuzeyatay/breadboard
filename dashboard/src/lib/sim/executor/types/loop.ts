// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/types/loop.ts; adapted for Breadboard.
import type { SerializedLoop } from '@/lib/sim/serializer/types'

export interface LoopConfigWithNodes extends SerializedLoop {
  nodes: string[]
}
