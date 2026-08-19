// Breadboard stand-in for sim's tools/utils.server.ts (simstudioai/sim, Apache-2.0).
// Sim's version does an async DB lookup (custom tools, MCP-backed tools) before
// falling back to the static registry. Breadboard's tool registry (@/lib/sim/tools)
// is synchronous, so this just awaits it.

import { getTool } from '@/lib/sim/tools/utils'
import type { ToolConfig } from '@/lib/sim/tools/types'

export async function getToolAsync(
  toolId: string,
  _context?: { workflowId?: string; userId?: string; workspaceId?: string }
): Promise<ToolConfig | undefined> {
  return getTool(toolId)
}
