import fs from "node:fs";
import path from "node:path";
import db from "../db.ts";
import { ApiError } from "./route-core.ts";

export type StoredMcpConfig =
  | {
      transport: "local";
      executable: string;
      args: string[];
      cwd?: string;
      environmentNames: string[];
      timeout: number;
    }
  | {
      transport: "remote";
      url: string;
      oauth: boolean;
      headerEnvironment: Array<{ header: string; environmentName: string }>;
      timeout: number;
    };

export type RuntimeMcpConfig =
  | {
      type: "local";
      command: string[];
      cwd?: string;
      environment?: Record<string, string>;
      enabled: boolean;
      timeout: number;
    }
  | {
      type: "remote";
      url: string;
      headers?: Record<string, string>;
      oauth: false | Record<string, never>;
      enabled: boolean;
      timeout: number;
    };

type McpRow = {
  id: number;
  user_id: number;
  slug: string;
  display_name: string;
  transport: "local" | "remote";
  config_json: string;
  enabled: number;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export interface McpConnectionRecord {
  id: number;
  slug: string;
  displayName: string;
  transport: "local" | "remote";
  config: StoredMcpConfig;
  enabled: boolean;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const RESERVED_MCP_SLUGS = new Set([
  "apply",
  "capability",
  "external",
  "garden",
  "list",
  "read",
]);

export function mcpSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (!slug)
    throw new ApiError(
      400,
      "invalid_mcp_name",
      "The MCP connection needs a valid name.",
    );
  if (RESERVED_MCP_SLUGS.has(slug)) {
    throw new ApiError(
      400,
      "reserved_mcp_name",
      "That MCP name is reserved by a built-in tool namespace.",
    );
  }
  return slug;
}

function fromRow(row: McpRow): McpConnectionRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    transport: row.transport,
    config: JSON.parse(row.config_json) as StoredMcpConfig,
    enabled: row.enabled === 1,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listMcpConnections(
  userId: number,
  enabledOnly = false,
): McpConnectionRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM openharness_mcp_connections WHERE user_id = ? ${enabledOnly ? "AND enabled = 1" : ""} ORDER BY display_name`,
    )
    .all(userId) as McpRow[];
  return rows.map(fromRow);
}

export function getMcpConnection(
  userId: number,
  id: number,
): McpConnectionRecord | null {
  const row = db
    .prepare(
      "SELECT * FROM openharness_mcp_connections WHERE user_id = ? AND id = ?",
    )
    .get(userId, id) as McpRow | undefined;
  return row ? fromRow(row) : null;
}

function safeTimeout(value: unknown): number {
  const timeout = Number(value);
  return Number.isInteger(timeout) && timeout >= 1_000 && timeout <= 120_000
    ? timeout
    : 10_000;
}

function environmentName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) ? name : null;
}

export function parseMcpConfig(body: Record<string, unknown>): {
  displayName: string;
  slug: string;
  config: StoredMcpConfig;
  approved: boolean;
} {
  const displayName =
    typeof body.displayName === "string"
      ? body.displayName.trim().slice(0, 100)
      : "";
  if (!displayName)
    throw new ApiError(400, "invalid_mcp_name", "displayName is required.");
  const slug = mcpSlug(typeof body.slug === "string" ? body.slug : displayName);
  const transport = body.transport;
  if (transport === "local") {
    if (body.approved !== true)
      throw new ApiError(
        409,
        "local_mcp_approval_required",
        "Explicit approval is required before saving or starting a local MCP command.",
      );
    const executable =
      typeof body.executable === "string"
        ? body.executable.trim().slice(0, 1_000)
        : "";
    if (!executable || /[\r\n]/.test(executable))
      throw new ApiError(
        400,
        "invalid_mcp_executable",
        "A valid executable is required.",
      );
    const args = Array.isArray(body.args)
      ? body.args
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.slice(0, 2_000))
          .slice(0, 100)
      : [];
    if (
      args.some((value) =>
        /(?:bearer\s+|--?(?:api[-_]?key|token|secret|password)(?:=|$))/i.test(
          value,
        ),
      )
    ) {
      throw new ApiError(
        400,
        "mcp_secret_in_arguments",
        "Do not place credentials in arguments. Reference environment-variable names instead.",
      );
    }
    const requestedCwd =
      typeof body.cwd === "string" && body.cwd.trim()
        ? path.resolve(body.cwd.trim())
        : undefined;
    if (
      requestedCwd &&
      (!fs.existsSync(requestedCwd) || !fs.statSync(requestedCwd).isDirectory())
    ) {
      throw new ApiError(
        400,
        "invalid_mcp_cwd",
        "The MCP working directory does not exist.",
      );
    }
    const environmentNames = Array.isArray(body.environmentNames)
      ? [
          ...new Set(
            body.environmentNames
              .map(environmentName)
              .filter((value): value is string => Boolean(value)),
          ),
        ].slice(0, 50)
      : [];
    return {
      displayName,
      slug,
      approved: true,
      config: {
        transport,
        executable,
        args,
        cwd: requestedCwd,
        environmentNames,
        timeout: safeTimeout(body.timeout),
      },
    };
  }
  if (transport === "remote") {
    let url: URL;
    try {
      url = new URL(typeof body.url === "string" ? body.url : "");
    } catch {
      throw new ApiError(
        400,
        "invalid_mcp_url",
        "A valid MCP URL is required.",
      );
    }
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      )
    ) {
      throw new ApiError(
        400,
        "insecure_mcp_url",
        "Remote MCP URLs must use HTTPS; loopback HTTP is allowed for local services.",
      );
    }
    const headerEnvironment = Array.isArray(body.headerEnvironment)
      ? body.headerEnvironment
          .flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const header =
              typeof (entry as { header?: unknown }).header === "string"
                ? (entry as { header: string }).header.trim()
                : "";
            const environmentName = environmentNameValue(
              (entry as { environmentName?: unknown }).environmentName,
            );
            return /^[A-Za-z0-9-]{1,100}$/.test(header) && environmentName
              ? [{ header, environmentName }]
              : [];
          })
          .slice(0, 30)
      : [];
    return {
      displayName,
      slug,
      approved: true,
      config: {
        transport,
        url: url.toString(),
        oauth: body.oauth !== false,
        headerEnvironment,
        timeout: safeTimeout(body.timeout),
      },
    };
  }
  throw new ApiError(
    400,
    "invalid_mcp_transport",
    "transport must be local or remote.",
  );
}

function environmentNameValue(value: unknown): string | null {
  return environmentName(value);
}

export function saveMcpConnection(
  userId: number,
  parsed: ReturnType<typeof parseMcpConfig>,
): McpConnectionRecord {
  const existing = db
    .prepare(
      "SELECT id FROM openharness_mcp_connections WHERE user_id = ? AND slug = ?",
    )
    .get(userId, parsed.slug) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE openharness_mcp_connections SET display_name = ?, transport = ?, config_json = ?, enabled = 1, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).run(
      parsed.displayName,
      parsed.config.transport,
      JSON.stringify(parsed.config),
      existing.id,
      userId,
    );
    return getMcpConnection(userId, existing.id)!;
  }
  const result = db
    .prepare(
      `INSERT INTO openharness_mcp_connections (user_id, slug, display_name, transport, config_json, enabled, approved_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
    )
    .run(
      userId,
      parsed.slug,
      parsed.displayName,
      parsed.config.transport,
      JSON.stringify(parsed.config),
    );
  return getMcpConnection(userId, Number(result.lastInsertRowid))!;
}

export function setMcpConnectionEnabled(
  userId: number,
  id: number,
  enabled: boolean,
): boolean {
  return (
    db
      .prepare(
        "UPDATE openharness_mcp_connections SET enabled = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      )
      .run(enabled ? 1 : 0, id, userId).changes > 0
  );
}

export function deleteMcpConnection(
  userId: number,
  id: number,
): McpConnectionRecord | null {
  const connection = getMcpConnection(userId, id);
  if (!connection) return null;
  db.prepare(
    "DELETE FROM openharness_mcp_connections WHERE id = ? AND user_id = ?",
  ).run(id, userId);
  return connection;
}

export function runtimeMcpConfig(
  connection: McpConnectionRecord,
): RuntimeMcpConfig {
  if (connection.config.transport === "local") {
    const environment = Object.fromEntries(
      connection.config.environmentNames.flatMap((name) => {
        const value = process.env[name];
        return value === undefined ? [] : [[name, value]];
      }),
    );
    return {
      type: "local",
      command: [connection.config.executable, ...connection.config.args],
      ...(connection.config.cwd ? { cwd: connection.config.cwd } : {}),
      ...(Object.keys(environment).length ? { environment } : {}),
      enabled: connection.enabled,
      timeout: connection.config.timeout,
    };
  }
  const headers = Object.fromEntries(
    connection.config.headerEnvironment.flatMap(
      ({ header, environmentName }) => {
        const value = process.env[environmentName];
        return value === undefined ? [] : [[header, value]];
      },
    ),
  );
  return {
    type: "remote",
    url: connection.config.url,
    ...(Object.keys(headers).length ? { headers } : {}),
    oauth: connection.config.oauth ? {} : false,
    enabled: connection.enabled,
    timeout: connection.config.timeout,
  };
}

export function publicMcpConnection(connection: McpConnectionRecord) {
  const config =
    connection.config.transport === "local"
      ? {
          executable: connection.config.executable,
          args: connection.config.args,
          cwd: connection.config.cwd,
          environmentNames: connection.config.environmentNames,
          timeout: connection.config.timeout,
        }
      : {
          url: connection.config.url,
          oauth: connection.config.oauth,
          headerEnvironment: connection.config.headerEnvironment,
          timeout: connection.config.timeout,
        };
  return {
    id: connection.id,
    slug: connection.slug,
    displayName: connection.displayName,
    transport: connection.transport,
    config,
    enabled: connection.enabled,
    approvedAt: connection.approvedAt,
    updatedAt: connection.updatedAt,
  };
}
