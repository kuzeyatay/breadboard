// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/mcp/utils.ts (createMcpToolId
// only); adapted for Breadboard. The rest of sim's MCP utils talk to its server registry,
// which was not vendored.

import { MCP, isMcpTool } from "@/lib/sim/executor/constants";

export function createMcpToolId(serverId: string, toolName: string): string {
  const normalizedServerId = isMcpTool(serverId) ? serverId : `${MCP.TOOL_PREFIX}${serverId}`;
  return `${normalizedServerId}-${toolName}`;
}
