import "server-only";

import type { ConnectedAccountListResponseItem } from "@composio/core";
import { ApiError } from "../hermes/route-core.ts";
import {
  breadboardSlugsForComposioToolkit,
  composioIntegrationCatalog,
  composioToolkitForBreadboardSlug,
  findComposioIntegration,
} from "./catalog.ts";
import { composioClient, composioConfigured, composioUserId } from "./client.ts";

export const COMPOSIO_RUNTIME_NAME = "connected-apps";

export interface ComposioConnectionRecord {
  userId: number;
  slug: string;
  provider: string;
  integrationId: string;
  connectionId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComposioConnectionSummary {
  slug: string;
  provider: string;
  integrationId: string;
  name: string;
}

export interface ComposioConnectionStatus {
  configured: boolean;
  provider: "Composio";
  instanceUrl: string | null;
  projectId: null;
  mcpUrl: null;
  manageUrl: string | null;
  connected: boolean;
  enabled: boolean;
  tokenConfigured: boolean;
  toolCount: number;
  connectionCount: number;
  connectedIntegrations: ComposioConnectionSummary[];
  message: string | null;
}

export interface ComposioProviderConnectResult {
  authorizationUrl: string;
  expiresAt: string;
}

function callbackUrl(requestOrigin: string): string {
  const origin = new URL(requestOrigin);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") {
    throw new ApiError(400, "invalid_callback_origin", "The connection callback origin is invalid.");
  }
  return new URL("/api/hermes/composio/callback", origin).toString();
}

function configuredAuthConfig(toolkitSlug: string): string | null {
  const raw = process.env.COMPOSIO_AUTH_CONFIGS_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>)[toolkitSlug];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    throw new ApiError(
      503,
      "invalid_composio_auth_configs",
      "COMPOSIO_AUTH_CONFIGS_JSON is not valid JSON.",
    );
  }
}

async function activeAccounts(userId: number): Promise<ConnectedAccountListResponseItem[]> {
  if (!composioConfigured()) return [];
  const response = await composioClient().connectedAccounts.list({
    userIds: [composioUserId(userId)],
    statuses: ["ACTIVE"],
    limit: 100,
  });
  return response.items.filter((account) => !account.isDisabled && account.status === "ACTIVE");
}

function accountRecords(
  userId: number,
  account: ConnectedAccountListResponseItem,
): ComposioConnectionRecord[] {
  return breadboardSlugsForComposioToolkit(account.toolkit.slug).map((slug) => ({
    userId,
    slug,
    provider: account.toolkit.slug,
    integrationId: `composio:${slug}`,
    connectionId: account.id,
    enabled: !account.isDisabled && account.status === "ACTIVE",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }));
}

export async function listComposioConnections(
  userId: number,
): Promise<ComposioConnectionRecord[]> {
  return (await activeAccounts(userId)).flatMap((account) =>
    accountRecords(userId, account),
  );
}

export async function resolveComposioConnection(
  userId: number,
  slugValue: string,
): Promise<ComposioConnectionRecord> {
  const slug = slugValue.trim().toLowerCase();
  const record = (await listComposioConnections(userId)).find(
    (candidate) => candidate.slug === slug,
  );
  if (!record) {
    throw new ApiError(
      409,
      "app_connection_required",
      "That app is not connected through Composio. Connect it from Connections first.",
    );
  }
  return record;
}

export async function beginComposioProviderConnection(
  userId: number,
  integrationValue: string,
  requestOrigin: string,
): Promise<ComposioProviderConnectResult> {
  const client = composioClient();
  const catalog = await composioIntegrationCatalog();
  const integration = findComposioIntegration(integrationValue, catalog);
  const toolkitSlug =
    integration?.toolkitSlug ?? composioToolkitForBreadboardSlug(integrationValue);
  if (!toolkitSlug) {
    throw new ApiError(400, "invalid_app_integration", "The requested app connection is invalid.");
  }

  let authConfigId = configuredAuthConfig(toolkitSlug);
  if (!authConfigId) {
    const configs = await client.authConfigs.list({
      toolkit: toolkitSlug,
      showDisabled: false,
      limit: 20,
    });
    authConfigId = configs.items.find((item) => item.status === "ENABLED")?.id ?? null;
  }
  if (!authConfigId) {
    try {
      const created = await client.authConfigs.create(toolkitSlug, {
        type: "use_composio_managed_auth",
        name: `Breadboard ${integration?.name ?? toolkitSlug}`,
        isEnabledForToolRouter: true,
      });
      authConfigId = created.id;
    } catch {
      throw new ApiError(
        409,
        "composio_auth_config_required",
        `${integration?.name ?? toolkitSlug} needs an enabled Composio auth configuration. Create it in the Composio project, then try Connect again.`,
      );
    }
  }

  const request = await client.connectedAccounts.link(
    composioUserId(userId),
    authConfigId,
    { callbackUrl: callbackUrl(requestOrigin) },
  );
  if (!request.redirectUrl) {
    throw new ApiError(502, "composio_link_missing", "Composio did not return a sign-in link.");
  }
  return {
    authorizationUrl: request.redirectUrl,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

export async function composioConnectionStatus(
  userId: number,
  _probe = true,
): Promise<ComposioConnectionStatus> {
  void _probe;
  const configured = composioConfigured();
  const connections = configured ? await listComposioConnections(userId) : [];
  const uniqueConnectionIds = new Set(connections.map((item) => item.connectionId));
  const catalog = await composioIntegrationCatalog();
  const connectedIntegrations = connections.map((record) => ({
    slug: record.slug,
    provider: record.provider,
    integrationId: record.integrationId,
    name:
      findComposioIntegration(record.slug, catalog)?.name ??
      record.slug.replace(/-/g, " "),
  }));
  return {
    configured,
    provider: "Composio",
    instanceUrl: configured ? "https://platform.composio.dev" : null,
    projectId: null,
    mcpUrl: null,
    manageUrl: configured ? "https://platform.composio.dev" : null,
    connected: uniqueConnectionIds.size > 0,
    enabled: true,
    tokenConfigured: configured,
    toolCount: connections.length,
    connectionCount: uniqueConnectionIds.size,
    connectedIntegrations,
    message: !configured
      ? "Connections need COMPOSIO_API_KEY in dashboard/.env.local."
      : uniqueConnectionIds.size
        ? `${uniqueConnectionIds.size} connected app${uniqueConnectionIds.size === 1 ? "" : "s"} available to agents through Composio.`
        : null,
  };
}

export async function removeComposioConnection(
  userId: number,
  slugValue?: string,
): Promise<number> {
  const records = await listComposioConnections(userId);
  const matching = slugValue
    ? records.filter((record) => record.slug === slugValue.trim().toLowerCase())
    : records;
  const ids = [...new Set(matching.map((record) => record.connectionId))];
  for (const id of ids) await composioClient().connectedAccounts.delete(id);
  return ids.length;
}

export async function composioConnectedIntegrationSlugs(
  userId: number,
  _refresh = false,
): Promise<string[]> {
  void _refresh;
  return (await listComposioConnections(userId)).map((connection) => connection.slug);
}
