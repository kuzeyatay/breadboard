import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import { BLENDER_MCP_VERSION, blenderRuntimePaths } from "../../../scripts/blender-runtime.mjs";
import {
  addProxyMcpConnection, callProxyMcpTool, proxyMcpTools, setProxyMcpConnectionConnected,
} from "../agent-runtime/mcp-proxy.ts";
import {
  getMcpConnectionBySlug, parseMcpConfig, runtimeMcpConfig, saveMcpConnection, setMcpConnectionEnabled,
} from "./mcp-connections.ts";
import { ApiError } from "./route-core.ts";

export const BLENDER_CONNECTION = "blender";
export const BLENDER_REQUIRED_TOOLS = ["get_addon_status", "get_scene_info", "execute_blender_code", "look"];

export function blenderPaths() {
  return blenderRuntimePaths(repositoryRoot(), dashboardDataDir());
}

export function blenderConnectionStatus(userId: number) {
  const paths = blenderPaths();
  const connection = getMcpConnectionBySlug(userId, BLENDER_CONNECTION);
  let version: string | null = null;
  try {
    const receipt = JSON.parse(fs.readFileSync(paths.receipt, "utf8"));
    if (receipt.package === "mcp-for-blender" && typeof receipt.version === "string") version = receipt.version;
  } catch { /* Missing or incomplete installations remain unavailable. */ }
  const installed = version === BLENDER_MCP_VERSION && [paths.python, paths.launcher, paths.addon].every(file => fs.existsSync(file));
  // This is configuration status, not a claim that the user's Blender is open.
  // Only a successful read through the MCP can establish that.
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return {
    installed,
    configured: Boolean(connection),
    enabled: connection?.enabled ?? false,
    version: BLENDER_MCP_VERSION,
    addonPath: paths.addon,
    setupCommand: `node ${quote(path.join(repositoryRoot(), "scripts", "setup-blender.mjs"))} --data-dir ${quote(dashboardDataDir())}`,
  };
}

/** Upstream reports some socket/Python failures as successful MCP text blocks. */
export function verifyBlenderSceneResult(result: unknown): void {
  const response = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const content = Array.isArray(response.content) ? response.content : [];
  const texts = content.flatMap(item => item && item.type === "text" && typeof item.text === "string" ? [item.text.trim()] : []).filter(Boolean);
  if (response.isError || !texts.length || texts.some(text => /^(?:error\b|could not\b|failed\b)/i.test(text))) {
    throw new ApiError(503, "blender_unavailable", "Blender did not respond. Open Blender, enable MCP for Blender, and start its server in the viewport sidebar on port 9876, then check again.");
  }
}

export async function updateBlenderConnection(userId: number, body: Record<string, unknown>) {
  const action = body.action;
  if (!["connect", "refresh", "disable"].includes(String(action)) || Object.keys(body).some(key => key !== "action")) {
    throw new ApiError(400, "blender_invalid_action", "Choose a valid Blender connection action.");
  }
  const existing = getMcpConnectionBySlug(userId, BLENDER_CONNECTION);
  if (action === "disable") {
    if (existing) setMcpConnectionEnabled(userId, existing.id, false);
    await setProxyMcpConnectionConnected(userId, BLENDER_CONNECTION, false);
    return { ...blenderConnectionStatus(userId), connected: false };
  }
  if (action === "refresh" && !existing?.enabled) {
    return { ...blenderConnectionStatus(userId), connected: false };
  }
  if (!blenderConnectionStatus(userId).installed) {
    throw new ApiError(503, "blender_not_installed", "Install the Blender tools using the setup command shown here, then connect again.");
  }
  const paths = blenderPaths();
  // Connect authorizes this fixed command. Refresh reuses the approved profile;
  // neither action accepts executables, scripts, host overrides, or environment.
  const connection = action === "connect" ? saveMcpConnection(userId, parseMcpConfig({
    displayName: "Blender",
    slug: BLENDER_CONNECTION,
    transport: "local",
    approved: true,
    executable: paths.python,
    args: ["-X", "utf8", paths.launcher],
    cwd: paths.directory,
    environmentNames: [],
    timeout: 120_000,
  })) : existing!;
  try {
    const status = await addProxyMcpConnection(userId, BLENDER_CONNECTION, runtimeMcpConfig(connection));
    if (status[BLENDER_CONNECTION]?.status !== "connected") {
      throw new ApiError(503, "blender_mcp_unavailable", "Blender's MCP server could not start. Check that Breadboard's local MCP runtime is running, then reconnect.");
    }
    const names = new Set(proxyMcpTools(userId, BLENDER_CONNECTION).map(tool => tool.name));
    if (!BLENDER_REQUIRED_TOOLS.every(name => names.has(name))) {
      throw new ApiError(503, "blender_tools_missing", "The Blender tools do not match this build. Run the setup command again, then reconnect.");
    }
    verifyBlenderSceneResult(await callProxyMcpTool({
      userId, slug: BLENDER_CONNECTION, tool: "get_scene_info", args: { fields: ["settings"], limit: 1 },
    }));
    return { ...blenderConnectionStatus(userId), connected: true };
  } catch (error) {
    // A failed first connection must not advertise an available skill.
    if (!existing?.enabled) {
      setMcpConnectionEnabled(userId, connection.id, false);
      await setProxyMcpConnectionConnected(userId, BLENDER_CONNECTION, false).catch(() => {});
    }
    throw error;
  }
}
