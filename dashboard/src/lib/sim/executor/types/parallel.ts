// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/types/parallel.ts; adapted for Breadboard.
import type { SerializedParallel } from '@/lib/sim/serializer/types'

export interface ParallelConfigWithNodes extends SerializedParallel {
  nodes: string[]
}
