// Breadboard stand-in for sim's tools/metadata-outputs.ts (simstudioai/sim, Apache-2.0).
// See metadata.ts sibling for why this reads the live registry instead of a
// generated split file.

import { getTool } from '@/lib/sim/tools/utils'
import type { ToolConfig } from '@/lib/sim/tools/types'

type ToolOutputs = NonNullable<ToolConfig['outputs']>

export function getToolOutputsMetadata(toolId: string): ToolOutputs | undefined {
  return getTool(toolId)?.outputs
}
