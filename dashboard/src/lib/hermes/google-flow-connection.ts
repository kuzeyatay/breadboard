import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { pathToFileURL } from "node:url";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  addProxyMcpConnection,
  callProxyMcpTool,
  proxyMcpTools,
  setProxyMcpConnectionConnected,
} from "../agent-runtime/mcp-proxy.ts";
import {
  getMcpConnectionBySlug,
  parseMcpConfig,
  runtimeMcpConfig,
  saveMcpConnection,
  setMcpConnectionEnabled,
} from "./mcp-connections.ts";
import { ApiError } from "./route-core.ts";

export const GOOGLE_FLOW_CONNECTION = "google-flow";

const runFile = promisify(execFile);

export function googleFlowPaths(userId: number) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("Invalid Flow user.");
  const root = path.join(repositoryRoot(), "google-flow-mcp");
  const data = path.join(dashboardDataDir(), "runtime-v2", "services", "google-flow", "users", String(userId));
  return {
    root,
    entry: path.join(root, "dist", "index.js"),
    launcher: path.join(repositoryRoot(), "scripts", "launch-google-flow.mjs"),
    connector: path.join(repositoryRoot(), "scripts", "connect-google-flow.mjs"),
    browserAdapter: path.join(repositoryRoot(), "scripts", "google-flow-browser.mjs"),
    data,
    accounts: path.join(data, "accounts.json"),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

// Return only connection status, never browser profiles, cookies, or CDP URLs.
export function googleFlowAccountStatus(value: unknown) {
  const document = object(value);
  const accounts = Array.isArray(document.accounts) ? document.accounts.map(object) : [];
  const connected = accounts.filter(account => account.connectionStatus === "connected");
  const account = connected.find(account => account.id === document.defaultAccountId) ?? connected[0];
  return {
    connected: Boolean(account),
    accountLabel: typeof account?.label === "string" ? account.label.slice(0, 100) : null,
    lastValidatedAt: typeof account?.lastValidatedAt === "string" ? account.lastValidatedAt : null,
  };
}

export function googleFlowConnectionStatus(userId: number) {
  const paths = googleFlowPaths(userId);
  const installed = [paths.entry, paths.launcher, paths.connector, paths.browserAdapter]
    .every(file => fs.existsSync(file));
  const connection = getMcpConnectionBySlug(userId, GOOGLE_FLOW_CONNECTION);
  let accounts: unknown = {};
  try {
    accounts = JSON.parse(fs.readFileSync(paths.accounts, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ApiError(503, "flow_account_store_unavailable", "Google Flow's saved connection could not be read.");
    }
  }
  const account = googleFlowAccountStatus(accounts);
  return {
    installed,
    configured: Boolean(connection),
    enabled: connection?.enabled ?? false,
    ...account,
    connected: installed && Boolean(connection?.enabled) && account.connected,
    browser: "breadboard",
    background: true,
  };
}

export function parseGoogleFlowResult(result: unknown): Record<string, unknown> {
  const response = object(result);
  const content = Array.isArray(response.content) ? response.content.map(object) : [];
  const text = content.filter(item => item.type === "text" && typeof item.text === "string")
    .map(item => item.text).join("\n");
  if (response.isError) {
    throw new ApiError(502, "flow_connection_failed", text.slice(0, 1500) || "Google Flow could not complete this step.");
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(502, "flow_invalid_response", "Google Flow returned an invalid connection response.");
  }
}

async function connectRuntime(userId: number) {
  const paths = googleFlowPaths(userId);
  if (!googleFlowConnectionStatus(userId).installed) {
    throw new ApiError(503, "flow_not_installed", "The Google Flow runtime is missing. Run node scripts/setup-veo.mjs in the Breadboard checkout, or reinstall the desktop app.");
  }
  // A Settings action authorizes this fixed, reviewed command. The request can
  // supply neither an executable nor arguments. Re-seal after app upgrades.
  const connection = saveMcpConnection(userId, parseMcpConfig({
    displayName: "Google Flow · Veo",
    slug: GOOGLE_FLOW_CONNECTION,
    transport: "local",
    approved: true,
    executable: process.execPath,
    args: ["--import", pathToFileURL(paths.launcher).href, paths.entry, paths.data],
    cwd: paths.root,
    environmentNames: [],
    timeout: 120_000,
  }));
  const status = await addProxyMcpConnection(userId, GOOGLE_FLOW_CONNECTION, runtimeMcpConfig(connection));
  if (status[GOOGLE_FLOW_CONNECTION]?.status !== "connected") {
    throw new ApiError(503, "flow_runtime_unavailable", "Google Flow could not start. Check that the Breadboard local MCP runtime is running, then retry.");
  }
  const names = new Set(proxyMcpTools(userId, GOOGLE_FLOW_CONNECTION).map(tool => tool.name));
  if (!["flow_help", "flow_list_accounts", "flow_inspect_account", "flow_generate_video", "flow_job_status", "flow_download_job"].every(name => names.has(name))) {
    throw new ApiError(503, "flow_tools_missing", "Google Flow's required tools were not discovered. Repair the Flow runtime before connecting.");
  }
}

async function call(userId: number, tool: string, args: Record<string, unknown> = {}) {
  return parseGoogleFlowResult(await callProxyMcpTool({ userId, slug: GOOGLE_FLOW_CONNECTION, tool, args }));
}

export async function updateGoogleFlowConnection(userId: number, body: Record<string, unknown>) {
  const action = body.action;
  if (!["connect", "refresh", "disable"].includes(String(action))) {
    throw new ApiError(400, "flow_invalid_action", "Choose a valid Google Flow connection action.");
  }
  const existing = getMcpConnectionBySlug(userId, GOOGLE_FLOW_CONNECTION);
  if (action === "disable") {
    if (existing) setMcpConnectionEnabled(userId, existing.id, false);
    await setProxyMcpConnectionConnected(userId, GOOGLE_FLOW_CONNECTION, false);
    return googleFlowConnectionStatus(userId);
  }
  if (action === "refresh" && !existing?.enabled) return googleFlowConnectionStatus(userId);
  await connectRuntime(userId);
  if (action === "connect") {
    const paths = googleFlowPaths(userId);
    let output: string;
    try {
      ({ stdout: output } = await runFile(process.execPath, [paths.connector, paths.data], {
        cwd: paths.root, windowsHide: true, timeout: 110_000, maxBuffer: 64 * 1024,
      }));
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout;
      let failure: Record<string, unknown> = {};
      try { failure = object(JSON.parse(stdout ?? "{}")); } catch { /* Never reflect process output. */ }
      throw new ApiError(502, "flow_connection_failed", typeof failure.error === "string"
        ? failure.error.slice(0, 500) : "Flow could not connect. Restart Breadboard with the updated build and retry.");
    }
    if (object(JSON.parse(output)).connected !== true) throw new ApiError(502, "flow_connection_failed", "Flow did not verify a connected workspace.");
  } else if (googleFlowConnectionStatus(userId).connected) {
    await call(userId, "flow_inspect_account");
  }
  const accounts = await call(userId, "flow_list_accounts");
  return { ...googleFlowConnectionStatus(userId), ...googleFlowAccountStatus(accounts), connected: accounts.readyForGeneration === true };
}
