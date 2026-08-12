import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RuntimeMcpConfig } from "../hermes/mcp-connections.ts";
import type {
  RuntimeCapabilities,
  RuntimeMcpStatus,
} from "./contracts.ts";

interface ProxyTool {
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

function createTransport(config: RuntimeMcpConfig): Transport {
  if (config.type === "local") {
    const [command, ...args] = config.command;
    if (!command) throw new Error("The MCP executable is missing.");
    return new StdioClientTransport({
      command,
      args,
      cwd: config.cwd,
      env: {
        ...getDefaultEnvironment(),
        ...(config.environment ?? {}),
      },
      // Never inherit an MCP server's stderr into Breadboard logs, where it
      // could print credentials or provider configuration.
      stderr: "ignore",
    });
  }
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
  config: RuntimeMcpConfig,
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
  } catch (primaryError) {
    await client.close().catch(() => undefined);
    // Some existing remote connections still expose the legacy SSE transport.
    // Retry it only after Streamable HTTP fails; local transports never retry.
    if (config.type !== "remote") throw primaryError;
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
    statuses.set(connectionKey, { status: "disabled" });
    return { [slug]: { status: "disabled" } };
  }
  try {
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
    statuses.set(connectionKey, { status: "disabled" });
    return true;
  }
  // Reconnection requires the server-owned stored configuration. Callers sync
  // it through addProxyMcpConnection immediately after toggling.
  return connections.has(connectionKey);
}

export function proxyMcpDiscovery(userId: number): RuntimeCapabilities {
  const mcp: Record<string, RuntimeMcpStatus> = {};
  const tools: string[] = [];
  for (const [connectionKey, status] of statuses) {
    if (!connectionKey.startsWith(`${userId}:`)) continue;
    const slug = connectionKey.slice(connectionKey.indexOf(":") + 1);
    mcp[slug] = status;
    const connection = connections.get(connectionKey);
    if (connection && status.status === "connected") {
      tools.push(
        ...connection.tools.map((tool) => `${slug}_${tool.name}`),
      );
    }
  }
  return { tools, mcp };
}

export function proxyMcpTools(userId: number, slug: string): ProxyTool[] {
  return [...(connections.get(key(userId, safeSlug(slug)))?.tools ?? [])];
}

export async function callProxyMcpTool(input: {
  userId: number;
  slug: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const slug = safeSlug(input.slug);
  if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(input.tool)) {
    throw new Error("The MCP tool name is invalid.");
  }
  const connection = connections.get(key(input.userId, slug));
  if (!connection) throw new Error("The MCP connection is not connected.");
  const declared = connection.tools.find((tool) => tool.name === input.tool);
  if (!declared) throw new Error("The MCP tool is not available.");
  const result = await connection.client.callTool(
    { name: declared.name, arguments: input.args },
    undefined,
    { timeout: connection.timeoutMs },
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
}
