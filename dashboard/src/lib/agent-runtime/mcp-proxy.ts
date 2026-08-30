import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  getMcpConnectionBySlug,
  runtimeMcpConfig,
  type RuntimeMcpConfig,
} from "../hermes/mcp-connections.ts";
import type {
  RuntimeCapabilities,
  RuntimeMcpStatus,
} from "./contracts.ts";
import {
  addLocalMcpBrokerConnection,
  callLocalMcpBrokerTool,
  disconnectLocalMcpBrokerConnection,
  LocalMcpBrokerError,
  type LocalMcpBrokerTool,
} from "./local-mcp-broker.ts";

interface ProxyTool extends LocalMcpBrokerTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

interface LocalProxyConnection {
  userId: number;
  slug: string;
  tools: ProxyTool[];
}

interface ProxyConnection {
  userId: number;
  slug: string;
  signature: string;
  client: Client;
  transport: Transport;
  tools: ProxyTool[];
  timeoutMs: number;
}

const connections = new Map<string, ProxyConnection>();
const localConnections = new Map<string, LocalProxyConnection>();
const statuses = new Map<string, RuntimeMcpStatus>();
const MAX_SAFE_RESULT_BYTES = 1024 * 1024;

function key(userId: number, slug: string): string {
  return `${userId}:${slug}`;
}

function safeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,48}$/.test(slug)) {
    throw new Error("The MCP connection name is invalid.");
  }
  return slug;
}

function configSignature(config: RuntimeMcpConfig): string {
  const signable =
    config.type === "remote"
      ? {
          type: config.type,
          url: config.url,
          headers: config.headers,
          oauth: config.oauth !== false,
          oauthRevision: config.oauthRevision,
          enabled: config.enabled,
          timeout: config.timeout,
        }
      : config;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(signable))
    .digest("hex");
}

function safeErrorStatus(error: unknown): RuntimeMcpStatus {
  if (error instanceof LocalMcpBrokerError && error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
    return { status: "failed", error: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (/unauthori[sz]ed|oauth|authentication|required.*auth/i.test(message)) {
    return { status: "needs_auth" };
  }
  return {
    status: "failed",
    error: "The MCP connection could not be started.",
  };
}

function remoteHeaders(config: Extract<RuntimeMcpConfig, { type: "remote" }>) {
  return config.headers && Object.keys(config.headers).length > 0
    ? { headers: config.headers }
    : undefined;
}

function createTransport(
  config: Extract<RuntimeMcpConfig, { type: "remote" }>,
): Transport {
  const url = new URL(config.url);
  return new StreamableHTTPClientTransport(url, {
    requestInit: remoteHeaders(config),
    authProvider: config.authProvider,
    reconnectionOptions: {
      initialReconnectionDelay: 500,
      maxReconnectionDelay: 3_000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 2,
    },
  });
}

async function closeConnection(connection: ProxyConnection | undefined) {
  if (!connection) return;
  connections.delete(key(connection.userId, connection.slug));
  await connection.client.close().catch(() => undefined);
}

async function connect(
  userId: number,
  slug: string,
  config: Extract<RuntimeMcpConfig, { type: "remote" }>,
): Promise<ProxyConnection> {
  const connectionKey = key(userId, slug);
  const signature = configSignature(config);
  const existing = connections.get(connectionKey);
  if (existing?.signature === signature) return existing;
  await closeConnection(existing);

  const client = new Client(
    { name: "breadboard-mcp-proxy", version: "1.0.0" },
    { capabilities: {} },
  );
  const primary = createTransport(config);
  try {
    await client.connect(primary, { timeout: config.timeout });
  } catch {
    await client.close().catch(() => undefined);
    // Some existing remote connections still expose the legacy SSE transport.
    // Retry it only after Streamable HTTP fails.
    const legacyClient = new Client(
      { name: "breadboard-mcp-proxy", version: "1.0.0" },
      { capabilities: {} },
    );
    const legacy = new SSEClientTransport(new URL(config.url), {
      requestInit: remoteHeaders(config),
      authProvider: config.authProvider,
    });
    await legacyClient.connect(legacy, { timeout: config.timeout });
    const listed = await legacyClient.listTools(
      {},
      { timeout: config.timeout },
    );
    const connection: ProxyConnection = {
      userId,
      slug,
      signature,
      client: legacyClient,
      transport: legacy,
      tools: listed.tools as ProxyTool[],
      timeoutMs: config.timeout,
    };
    connections.set(connectionKey, connection);
    statuses.set(connectionKey, { status: "connected" });
    return connection;
  }

  const listed = await client.listTools({}, { timeout: config.timeout });
  const connection: ProxyConnection = {
    userId,
    slug,
    signature,
    client,
    transport: primary,
    tools: listed.tools as ProxyTool[],
    timeoutMs: config.timeout,
  };
  connections.set(connectionKey, connection);
  statuses.set(connectionKey, { status: "connected" });
  return connection;
}

export interface StdioProxyServer {
  command: string;
  args: string[];
  cwd?: string;
  /** Added on top of the SDK's default environment, never replacing it. */
  env?: Record<string, string>;
}

/**
 * A Breadboard-owned MCP server spoken to over stdio — today the graft code
 * index of a Garden's connected repository. It is deliberately not a saved MCP
 * connection: the command is chosen by Breadboard from the repository the user
 * connected, never typed by anyone, so it needs no renderer approval, and the
 * mcp route admits it by its own rule rather than by a stored row.
 *
 * Keyed like every other proxy connection, so discovery lists its tools and
 * `callProxyMcpTool` reaches it unchanged. Reconnects only when the command
 * changes; a repeat call for the same server is a lookup.
 */
export async function addStdioProxyConnection(
  userId: number,
  name: string,
  server: StdioProxyServer,
  timeoutMs = 60_000,
): Promise<{ status: RuntimeMcpStatus; tools: Array<{ name: string; description?: string }> }> {
  const slug = safeSlug(name);
  const connectionKey = key(userId, slug);
  const signature = crypto
    .createHash("sha256")
    .update(JSON.stringify({ type: "stdio", ...server, timeoutMs }))
    .digest("hex");
  const existing = connections.get(connectionKey);
  if (existing?.signature === signature) {
    return {
      status: statuses.get(connectionKey) ?? { status: "connected" },
      tools: existing.tools.map((tool) => ({ name: tool.name, description: tool.description })),
    };
  }
  await closeConnection(existing);
  const client = new Client(
    { name: "breadboard-mcp-proxy", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
      stderr: "ignore",
    });
    await client.connect(transport, { timeout: timeoutMs });
    const listed = await client.listTools({}, { timeout: timeoutMs });
    const connection: ProxyConnection = {
      userId,
      slug,
      signature,
      client,
      transport,
      tools: listed.tools as ProxyTool[],
      timeoutMs,
    };
    connections.set(connectionKey, connection);
    statuses.set(connectionKey, { status: "connected" });
    return {
      status: { status: "connected" },
      tools: connection.tools.map((tool) => ({ name: tool.name, description: tool.description })),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    const status = safeErrorStatus(error);
    statuses.set(connectionKey, status);
    return { status, tools: [] };
  }
}

export async function addProxyMcpConnection(
  userId: number,
  name: string,
  rawConfig: unknown,
): Promise<Record<string, RuntimeMcpStatus>> {
  const slug = safeSlug(name);
  const config = rawConfig as RuntimeMcpConfig;
  const connectionKey = key(userId, slug);
  if (!config?.enabled) {
    await closeConnection(connections.get(connectionKey));
    localConnections.delete(connectionKey);
    await disconnectLocalMcpBrokerConnection({ userId, slug });
    statuses.set(connectionKey, { status: "disabled" });
    return { [slug]: { status: "disabled" } };
  }
  try {
    if (config.type === "local") {
      await closeConnection(connections.get(connectionKey));
      const loaded = await addLocalMcpBrokerConnection({
        userId,
        slug,
        config,
      });
      statuses.set(connectionKey, loaded.status);
      if (loaded.status.status === "connected") {
        localConnections.set(connectionKey, {
          userId,
          slug,
          tools: loaded.tools as ProxyTool[],
        });
      } else {
        localConnections.delete(connectionKey);
      }
      return { [slug]: loaded.status };
    }
    localConnections.delete(connectionKey);
    await connect(userId, slug, config);
  } catch (error) {
    const status = safeErrorStatus(error);
    statuses.set(connectionKey, status);
    return { [slug]: status };
  }
  return { [slug]: { status: "connected" } };
}

export async function setProxyMcpConnectionConnected(
  userId: number,
  name: string,
  connected: boolean,
): Promise<boolean> {
  const slug = safeSlug(name);
  const connectionKey = key(userId, slug);
  if (!connected) {
    await closeConnection(connections.get(connectionKey));
    localConnections.delete(connectionKey);
    await disconnectLocalMcpBrokerConnection({ userId, slug });
    statuses.set(connectionKey, { status: "disabled" });
    return true;
  }
  // Reconnection requires the server-owned stored configuration. Callers sync
  // it through addProxyMcpConnection immediately after toggling.
  return connections.has(connectionKey) || localConnections.has(connectionKey);
}

export function proxyMcpDiscovery(userId: number): RuntimeCapabilities {
  const mcp: Record<string, RuntimeMcpStatus> = {};
  const tools: string[] = [];
  for (const [connectionKey, status] of statuses) {
    if (!connectionKey.startsWith(`${userId}:`)) continue;
    const slug = connectionKey.slice(connectionKey.indexOf(":") + 1);
    mcp[slug] = status;
    const connection = connections.get(connectionKey) ?? localConnections.get(connectionKey);
    if (connection && status.status === "connected") {
      tools.push(
        ...connection.tools.map((tool) => `${slug}_${tool.name}`),
      );
    }
  }
  return { tools, mcp };
}

export function proxyMcpTools(userId: number, slug: string): ProxyTool[] {
  const connectionKey = key(userId, safeSlug(slug));
  return [...(
    connections.get(connectionKey)?.tools ??
    localConnections.get(connectionKey)?.tools ??
    []
  )];
}

export { LocalMcpBrokerError } from "./local-mcp-broker.ts";

export async function callProxyMcpTool(input: {
  userId: number;
  slug: string;
  tool: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<unknown> {
  const slug = safeSlug(input.slug);
  if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(input.tool)) {
    throw new Error("The MCP tool name is invalid.");
  }
  const connectionKey = key(input.userId, slug);
  const local = localConnections.get(connectionKey);
  if (local) {
    const declared = local.tools.find((tool) => tool.name === input.tool);
    if (!declared) throw new Error("The MCP tool is not available.");
    const stored = getMcpConnectionBySlug(input.userId, slug);
    const config = stored ? runtimeMcpConfig(stored) : null;
    if (!config || config.type !== "local" || !config.enabled) {
      throw new Error("The MCP connection is not connected.");
    }
    return callLocalMcpBrokerTool({
      userId: input.userId,
      slug,
      config,
      tool: declared.name,
      args: input.args,
      signal: input.signal,
    });
  }
  const connection = connections.get(connectionKey);
  if (!connection) throw new Error("The MCP connection is not connected.");
  const declared = connection.tools.find((tool) => tool.name === input.tool);
  if (!declared) throw new Error("The MCP tool is not available.");
  const result = await connection.client.callTool(
    { name: declared.name, arguments: input.args },
    undefined,
    { timeout: connection.timeoutMs, signal: input.signal },
  );
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SAFE_RESULT_BYTES) {
    throw new Error("The MCP tool response exceeded Breadboard's safe output limit.");
  }
  return result;
}

export async function disposeProxyMcpConnections(userId?: number) {
  const selected = [...connections.values()].filter(
    (connection) => userId === undefined || connection.userId === userId,
  );
  await Promise.all(selected.map(closeConnection));
  const selectedLocal = [...localConnections.values()].filter(
    (connection) => userId === undefined || connection.userId === userId,
  );
  for (const connection of selectedLocal) {
    localConnections.delete(key(connection.userId, connection.slug));
  }
  await Promise.all(selectedLocal.map((connection) =>
    disconnectLocalMcpBrokerConnection({
      userId: connection.userId,
      slug: connection.slug,
    })));
}
