// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/mcp/types.ts (the tool
// schema shapes only); adapted for Breadboard. Sim's MCP client/registry (servers,
// transports, Postgres-backed server rows) was not vendored: the agent handler only
// needs these types to describe schemas that reach it through block inputs.

export interface McpToolSchemaProperty {
  type?: string | string[];
  description?: string;
  items?: McpToolSchemaProperty | McpToolSchemaProperty[];
  properties?: Record<string, McpToolSchemaProperty>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

export interface McpToolSchema {
  type: "object";
  properties?: Record<string, McpToolSchemaProperty>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}
