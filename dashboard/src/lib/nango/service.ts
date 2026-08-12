import "server-only";

import db from "../db.ts";
import { beginEmbeddedOAuth } from "../connected-apps/broker.ts";
import { connectionVaultConfigured } from "../connected-apps/vault.ts";
import { ApiError } from "../hermes/route-core.ts";
import { findNangoIntegration } from "./catalog.ts";
import { ensureNangoSchema } from "./schema.ts";

// The exported identifier is retained for source compatibility.
export const NANGO_RUNTIME_NAME = "connected-apps";

type NangoConnectionRow = {
  user_id: number;
  slug: string;
  provider: string;
  integration_id: string;
  connection_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export interface NangoConnectionRecord {
  userId: number;
  slug: string;
  provider: string;
  integrationId: string;
  connectionId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NangoConnectionSummary {
  slug: string;
  provider: string;
  integrationId: string;
  name: string;
}

export interface NangoConnectionStatus {
  configured: boolean;
  provider: "Breadboard";
  instanceUrl: null;
  projectId: null;
  mcpUrl: null;
  manageUrl: null;
  connected: boolean;
  enabled: boolean;
  tokenConfigured: boolean;
  toolCount: number;
  connectionCount: number;
  connectedIntegrations: NangoConnectionSummary[];
  message: string | null;
}

export interface NangoProviderConnectResult {
  authorizationUrl: string;
  expiresAt: string;
}

ensureNangoSchema(db);

function assertUser(userId: number): void {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ApiError(401, "invalid_user", "Unauthorized");
  }
}

function rowToRecord(row: NangoConnectionRow): NangoConnectionRecord {
  return {
    userId: row.user_id,
    slug: row.slug,
    provider: row.provider,
    integrationId: row.integration_id,
    connectionId: row.connection_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicSummary(record: NangoConnectionRecord): NangoConnectionSummary {
  const integration = findNangoIntegration(record.integrationId);
  return {
    slug: record.slug,
    provider: record.provider,
    integrationId: record.integrationId,
    name: integration?.name ?? record.slug,
  };
}

export function listStoredNangoConnections(userId: number): NangoConnectionRecord[] {
  assertUser(userId);
  return (
    db
      .prepare(
        `SELECT c.*
         FROM nango_connections c
         INNER JOIN connected_app_credentials v
           ON v.user_id = c.user_id AND v.slug = c.slug
         WHERE c.user_id = ? AND c.enabled = 1
         ORDER BY c.slug ASC`,
      )
      .all(userId) as NangoConnectionRow[]
  ).map(rowToRecord);
}

export async function syncNangoConnections(userId: number): Promise<NangoConnectionRecord[]> {
  return listStoredNangoConnections(userId);
}

export async function resolveNangoConnection(
  userId: number,
  slugValue: string,
): Promise<NangoConnectionRecord> {
  const integration = findNangoIntegration(slugValue);
  if (!integration) {
    throw new ApiError(400, "invalid_app_integration", "The requested app connection is invalid.");
  }
  const record = listStoredNangoConnections(userId).find(
    (candidate) => candidate.slug === integration.slug,
  );
  if (!record) {
    throw new ApiError(
      409,
      "app_connection_required",
      `${integration.name} is not connected. Connect it from Connections first.`,
    );
  }
  return record;
}

export async function beginNangoProviderConnection(
  userId: number,
  integrationValue: string,
  requestOrigin: string,
): Promise<NangoProviderConnectResult> {
  assertUser(userId);
  return beginEmbeddedOAuth({ userId, integrationValue, requestOrigin });
}

export async function nangoConnectionStatus(
  userId: number,
  _probe = true,
): Promise<NangoConnectionStatus> {
  assertUser(userId);
  const configured = connectionVaultConfigured();
  const connections = configured ? listStoredNangoConnections(userId) : [];
  const connected = configured && connections.length > 0;
  return {
    configured,
    provider: "Breadboard",
    instanceUrl: null,
    projectId: null,
    mcpUrl: null,
    manageUrl: null,
    connected,
    enabled: true,
    tokenConfigured: configured,
    toolCount: connected ? connections.length : 0,
    connectionCount: connections.length,
    connectedIntegrations: connections.map(publicSummary),
    message: connected
      ? `${connections.length} connected app${connections.length === 1 ? "" : "s"} available to agents.`
      : configured
        ? null
        : "Connected apps are temporarily unavailable.",
  };
}

export async function removeNangoConnection(
  userId: number,
  slugValue?: string,
): Promise<number> {
  assertUser(userId);
  let records = listStoredNangoConnections(userId);
  if (slugValue) {
    const integration = findNangoIntegration(slugValue);
    if (!integration) {
      throw new ApiError(400, "invalid_app_integration", "The requested app connection is invalid.");
    }
    records = records.filter((record) => record.slug === integration.slug);
  }
  const remove = db.transaction(() => {
    for (const record of records) {
      db.prepare("DELETE FROM nango_connections WHERE user_id = ? AND slug = ?").run(
        userId,
        record.slug,
      );
    }
  });
  remove();
  return records.length;
}

export async function nangoConnectedIntegrationSlugs(
  userId: number,
  _refresh = false,
): Promise<string[]> {
  return listStoredNangoConnections(userId).map((connection) => connection.slug);
}
