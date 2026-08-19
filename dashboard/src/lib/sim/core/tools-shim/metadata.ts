// Breadboard stand-in for sim's tools/metadata.ts (simstudioai/sim, Apache-2.0).
// Sim reads a generated 4MB JSON split off the tool registry so callers that
// only need a tool's param shape avoid pulling in ~4,700 tool modules and their
// request/response closures. Breadboard's registry (@/lib/sim/tools) is orders
// of magnitude smaller, so that split isn't worth the generated-file machinery
// — this reads straight off the live registry.

import { getTool } from '@/lib/sim/tools/utils'
import type { ToolConfig } from '@/lib/sim/tools/types'

export function getToolParams(toolId: string): ToolConfig['params'] | undefined {
  return getTool(toolId)?.params
}
