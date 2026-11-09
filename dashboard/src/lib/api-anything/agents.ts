import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot, dashboardDataDir } from "../runtime-paths.ts";
import { apiAnythingAvailable, callApiAnythingAgentTool } from "../../../scripts/api-anything-client.mjs";
import { API_ANYTHING_AGENT_TOOL, API_ANYTHING_POLICY } from "../../../scripts/api-anything-contract.mjs";

export { API_ANYTHING_AGENT_TOOL, API_ANYTHING_POLICY };

export function apiAnythingMcpServer(userId: number) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new TypeError("Website APIs require authenticated user scope.");
  const root = repositoryRoot();
  if (!apiAnythingAvailable({ repoRoot: root })) return null;
  return { command: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    args: [path.join(root, "dashboard", "scripts", "api-anything-mcp.mjs"), String(userId), root, dashboardDataDir()] };
}

/** Shared upstream services get public operations and an empty process-local jar. */
export function apiAnythingPublicMcpServer() {
  const root = repositoryRoot();
  if (!apiAnythingAvailable({ repoRoot: root })) return null;
  return { command: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    args: [path.join(root, "dashboard", "scripts", "api-anything-mcp.mjs"), "public", root, dashboardDataDir()] };
}

export function apiAnythingPublicMcpConfig() {
  const server = apiAnythingPublicMcpServer();
  return server ? { api_anything: { type: "local", command: [server.command, ...server.args], environment: server.env, enabled: true, timeout: 30_000 } } : {};
}

export function apiAnythingCodexConfig(userId: number): string[] {
  const server = apiAnythingMcpServer(userId);
  return server ? ["-c", `mcp_servers.api_anything.command=${JSON.stringify(server.command)}`,
    "-c", `mcp_servers.api_anything.args=${JSON.stringify(server.args)}`,
    "-c", 'mcp_servers.api_anything.env.ELECTRON_RUN_AS_NODE="1"',
    "-c", "mcp_servers.api_anything.startup_timeout_sec=15"] : [];
}

export function withApiAnythingMcp(config: Record<string, unknown>, userId: number): Record<string, unknown> {
  const server = apiAnythingMcpServer(userId);
  if (!server) return config;
  const mcp = config.mcp && typeof config.mcp === "object" ? config.mcp : {};
  return { ...config, mcp: { ...mcp, api_anything: { type: "local", command: [server.command, ...server.args], environment: server.env, enabled: true, timeout: 30_000 } } };
}

export function executeApiAnythingAgentTool(userId: number, input: Record<string, unknown>, signal: AbortSignal) {
  return callApiAnythingAgentTool({ userId, input, signal, repoRoot: repositoryRoot(), dataRoot: dashboardDataDir() });
}
