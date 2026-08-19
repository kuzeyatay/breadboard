// Vendored from simstudioai/sim (Apache-2.0), apps/sim/tools/utils.ts —
// TRIMMED for Breadboard: only the server-side lookup/validation helpers the
// executor needs (`getTool`, `resolveToolId`, `getLatestVersionTools`,
// `validateRequiredParametersAfterMerge`). Dropped: the client-side custom-tool
// helpers (`createCustomToolRequestBody`, `createToolConfig`,
// `getClientEnvVars`) — Breadboard has no user-authored custom-tool feature —
// and the React-Query-backed env var reader, which is client-only.

import { stripVersionSuffix } from "../core/utils/string";
import { tools } from "./registry";
import type { ToolConfig } from "./types";

export { stripVersionSuffix } from "../core/utils/string";

/**
 * Filters a tools map to return only the latest version of each tool.
 * If both `notion_search` and `notion_search_v2` exist, only `notion_search_v2` is returned.
 */
export function getLatestVersionTools(
  toolsMap: Record<string, ToolConfig>,
): Record<string, ToolConfig> {
  const latestTools: Record<string, ToolConfig> = {};
  const baseNameToVersions: Record<string, { toolId: string; version: number }[]> = {};

  for (const toolId of Object.keys(toolsMap)) {
    const baseName = stripVersionSuffix(toolId);
    const versionMatch = toolId.match(/_v(\d+)$/);
    const version = versionMatch ? Number.parseInt(versionMatch[1], 10) : 1;

    if (!baseNameToVersions[baseName]) {
      baseNameToVersions[baseName] = [];
    }
    baseNameToVersions[baseName].push({ toolId, version });
  }

  for (const versions of Object.values(baseNameToVersions)) {
    const latest = versions.reduce((prev, curr) => (curr.version > prev.version ? curr : prev));
    latestTools[latest.toolId] = toolsMap[latest.toolId];
  }

  return latestTools;
}

/**
 * Resolves a tool name to its actual tool ID in the registry. Handles both
 * stripped names (e.g., 'notion_search') and versioned names (e.g.,
 * 'notion_search_v2').
 */
export function resolveToolId(toolName: string): string {
  if (tools[toolName]) {
    return toolName;
  }

  const latestTools = getLatestVersionTools(tools);
  for (const toolId of Object.keys(latestTools)) {
    if (stripVersionSuffix(toolId) === toolName) {
      return toolId;
    }
  }

  return toolName;
}

/** Get a tool by its ID, resolving version suffixes. */
export function getTool(toolId: string): ToolConfig | undefined {
  return tools[resolveToolId(toolId)];
}

function formatParameterNameForError(paramName: string): string {
  return paramName
    .split(/(?=[A-Z])|[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Validates required parameters after LLM and user params have been merged.
 * This is the final validation before tool execution — ensures all required
 * user-or-llm parameters are present after the merge process.
 */
export function validateRequiredParametersAfterMerge(
  toolId: string,
  tool: ToolConfig | undefined,
  params: Record<string, any>,
  parameterNameMap?: Record<string, string>,
): void {
  if (!tool) {
    throw new Error(`Tool not found: ${toolId}`);
  }

  for (const [paramName, paramConfig] of Object.entries(tool.params)) {
    if (
      (paramConfig as any).visibility === "user-or-llm" &&
      paramConfig.required &&
      (!(paramName in params) ||
        params[paramName] === null ||
        params[paramName] === undefined ||
        params[paramName] === "")
    ) {
      const toolName = tool.name || toolId;
      const friendlyParamName =
        parameterNameMap?.[paramName] || formatParameterNameForError(paramName);
      throw new Error(`${friendlyParamName} is required for ${toolName}`);
    }
  }
}
