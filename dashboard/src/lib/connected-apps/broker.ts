import "server-only";

import crypto from "node:crypto";
import db from "../db.ts";
import { ApiError } from "../hermes/route-core.ts";
import {
  connectedAppOAuthMetadata,
  findNangoIntegration,
  type NangoIntegration,
} from "../nango/catalog.ts";
import {
  readConnectedAppTokens,
  storeConnectedAppTokens,
  type ConnectedAppTokens,
} from "./vault.ts";
import type { ConnectedAppProxyRequest } from "./types.ts";
import { spotifyClientId } from "../spotify/config.ts";

const STATE_TTL_MS = 10 * 60 * 1_000;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

type OAuthStateRow = {
  user_id: number;
  slug: string;
  redirect_uri: string;
  code_verifier: string | null;
  expires_at: string;
};

type OAuthClient = { clientId: string; clientSecret: string | null };

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function credentialsMap(): Record<string, unknown> {
  const raw = process.env.BREADBOARD_OAUTH_CREDENTIALS_JSON?.trim();
  if (!raw) return {};
  try {
    return objectRecord(JSON.parse(raw)) ?? {};
  } catch {
    throw new ApiError(503, "invalid_oauth_configuration", "Connected apps are temporarily unavailable.");
  }
}

function envName(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function credentialCandidates(integration: NangoIntegration): string[] {
  return Array.from(
    new Set(
      [integration.slug, integration.provider, integration.oauthFamily].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

function oauthClient(integration: NangoIntegration): OAuthClient {
  // Spotify's browser player uses Authorization Code with PKCE. Its public
  // client id is safe to ship; a client secret must never be present in a
  // desktop/browser application.
  if (integration.slug === "spotify") {
    return { clientId: spotifyClientId(), clientSecret: null };
  }
  const mapped = credentialsMap();
  for (const candidate of credentialCandidates(integration)) {
    const record = objectRecord(mapped[candidate] ?? mapped[envName(candidate)]);
    const clientId = typeof record?.client_id === "string" ? record.client_id.trim() : "";
    const clientSecret =
      typeof record?.client_secret === "string" ? record.client_secret.trim() : "";
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  for (const candidate of credentialCandidates(integration)) {
    const prefix = `BREADBOARD_${envName(candidate)}`;
    const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim() ?? "";
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim() ?? "";
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  throw new ApiError(
    503,
    "oauth_app_not_enabled",
    `${integration.name} is not enabled for connections yet.`,
  );
}

function safeServiceOrigin(requestOrigin: string): string {
  const raw =
    process.env.BREADBOARD_PUBLIC_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    requestOrigin;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(503, "invalid_public_url", "Connected apps are temporarily unavailable.");
  }
  const loopback =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new ApiError(503, "invalid_public_url", "Connected apps are temporarily unavailable.");
  }
  return url.origin;
}

function safeExplicitOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(503, "invalid_public_url", "Connected apps are temporarily unavailable.");
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password) {
    throw new ApiError(503, "invalid_public_url", "Connected apps are temporarily unavailable.");
  }
  return url.origin;
}

function stateHash(state: string): string {
  return crypto.createHash("sha256").update(state).digest("hex");
}

function codeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function secureProviderUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(500, "invalid_provider_url", "The provider configuration is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new ApiError(500, "insecure_provider_url", "The provider configuration is invalid.");
  }
  return url;
}

function expandParams(
  input: Record<string, string>,
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
        const normalized = name.replace(/^credentials\./, "");
        return values[normalized] ?? values[name] ?? "";
      }),
    ]),
  );
}

export function beginEmbeddedOAuth(input: {
  userId: number;
  integrationValue: string;
  requestOrigin: string;
  callbackPath?:
    | "/api/hermes/connections/oauth/callback"
    | "/api/hermes/mcp/oauth/callback";
  callbackOrigin?: string;
}): { authorizationUrl: string; expiresAt: string } {
  const integration = findNangoIntegration(input.integrationValue);
  if (!integration) {
    throw new ApiError(400, "invalid_app_integration", "The requested app connection is invalid.");
  }
  const metadata = connectedAppOAuthMetadata(integration);
  if (!metadata) {
    throw new ApiError(400, "unsupported_app_auth", `${integration.name} does not support embedded OAuth sign-in yet.`);
  }
  const client = oauthClient(integration);
  const redirectUri = `${
    input.callbackOrigin
      ? safeExplicitOrigin(input.callbackOrigin)
      : safeServiceOrigin(input.requestOrigin)
  }${
    input.callbackPath ?? "/api/hermes/connections/oauth/callback"
  }`;
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = metadata.disablePkce
    ? null
    : crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  db.prepare("DELETE FROM connected_app_oauth_states WHERE expires_at <= ?").run(
    new Date().toISOString(),
  );
  db.prepare(
    "DELETE FROM connected_app_oauth_states WHERE user_id = ? AND slug = ?",
  ).run(input.userId, integration.slug);
  db.prepare(
    `INSERT INTO connected_app_oauth_states
       (state_hash, user_id, slug, redirect_uri, code_verifier, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    stateHash(state),
    input.userId,
    integration.slug,
    redirectUri,
    verifier,
    expiresAt,
  );

  const authorizationUrl = secureProviderUrl(metadata.authorizationUrl);
  const params = {
    response_type: "code",
    ...metadata.authorizationParams,
    client_id: client.clientId,
    redirect_uri: redirectUri,
    state,
    ...(integration.scopes.length
      ? { scope: integration.scopes.join(metadata.scopeSeparator) }
      : {}),
    ...(integration.slug === "slack" ? { user_scope: "search:read" } : {}),
    ...(verifier
      ? { code_challenge: codeChallenge(verifier), code_challenge_method: "S256" }
      : {}),
  };
  for (const [key, value] of Object.entries(params)) {
    authorizationUrl.searchParams.set(key, value);
  }
  return { authorizationUrl: authorizationUrl.toString(), expiresAt };
}

async function readProviderPayload(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ApiError(502, "provider_response_too_large", "The connected app returned too much data.");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        if (size > MAX_PROVIDER_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new ApiError(502, "provider_response_too_large", "The connected app returned too much data.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
}

async function requestTokens(input: {
  integration: NangoIntegration;
  code?: string;
  redirectUri?: string;
  verifier?: string | null;
  refreshToken?: string;
}): Promise<ConnectedAppTokens> {
  const metadata = connectedAppOAuthMetadata(input.integration);
  if (!metadata) throw new ApiError(400, "unsupported_app_auth", "This app cannot be authorized.");
  const client = oauthClient(input.integration);
  const templateValues = {
    client_id: client.clientId,
    client_secret: client.clientSecret ?? "",
    code: input.code ?? "",
    redirect_uri: input.redirectUri ?? "",
    refresh_token: input.refreshToken ?? "",
  };
  const refresh = Boolean(input.refreshToken);
  const params: Record<string, string> = {
    ...(refresh
      ? { grant_type: "refresh_token", refresh_token: input.refreshToken ?? "" }
      : {
          grant_type: "authorization_code",
          code: input.code ?? "",
          redirect_uri: input.redirectUri ?? "",
        }),
    ...expandParams(refresh ? metadata.refreshParams : metadata.tokenParams, templateValues),
    ...(input.verifier ? { code_verifier: input.verifier } : {}),
  };
  const headers: Record<string, string> = { Accept: "application/json" };
  if (metadata.authorizationMethod === "header" && client.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
  } else {
    params.client_id = client.clientId;
    if (client.clientSecret) params.client_secret = client.clientSecret;
  }
  const body =
    metadata.bodyFormat === "json"
      ? JSON.stringify(params)
      : new URLSearchParams(params).toString();
  headers["Content-Type"] =
    metadata.bodyFormat === "json"
      ? "application/json"
      : "application/x-www-form-urlencoded";

  let response: Response;
  try {
    response = await fetch(secureProviderUrl(metadata.tokenUrl), {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(503, "oauth_provider_unavailable", "The app sign-in service could not be reached.");
  }
  const payload = objectRecord(await readProviderPayload(response)) ?? {};
  if (!response.ok || payload.error) {
    throw new ApiError(400, "oauth_exchange_failed", "The app rejected the sign-in request.");
  }
  const nestedUser = objectRecord(payload.authed_user);
  const accessToken =
    typeof payload.access_token === "string"
      ? payload.access_token
      : typeof nestedUser?.access_token === "string"
        ? nestedUser.access_token
        : "";
  if (!accessToken) {
    throw new ApiError(502, "invalid_oauth_response", "The app returned an invalid sign-in response.");
  }
  const expiresIn = Number(payload.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1_000).toISOString()
      : null;
  return {
    accessToken,
    refreshToken:
      typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : input.refreshToken ?? null,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    scope: typeof payload.scope === "string" ? payload.scope : null,
    expiresAt,
    raw: payload,
  };
}

export async function completeEmbeddedOAuth(input: {
  state: string;
  code: string;
}): Promise<{ integrationName: string; userId: number; slug: string }> {
  if (!input.state || !input.code) {
    throw new ApiError(400, "invalid_oauth_callback", "The app sign-in response is incomplete.");
  }
  const consume = db.transaction(() => {
    const hash = stateHash(input.state);
    const row = db
      .prepare("SELECT * FROM connected_app_oauth_states WHERE state_hash = ?")
      .get(hash) as OAuthStateRow | undefined;
    if (row) db.prepare("DELETE FROM connected_app_oauth_states WHERE state_hash = ?").run(hash);
    return row;
  });
  const state = consume();
  if (!state || Date.parse(state.expires_at) <= Date.now()) {
    throw new ApiError(400, "expired_oauth_state", "This sign-in link has expired. Start again from Connections.");
  }
  const integration = findNangoIntegration(state.slug);
  if (!integration) throw new ApiError(400, "invalid_app_integration", "The app connection is invalid.");
  const tokens = await requestTokens({
    integration,
    code: input.code,
    redirectUri: state.redirect_uri,
    verifier: state.code_verifier,
  });
  const connectionId = crypto.randomUUID();
  const persist = db.transaction(() => {
    db.prepare(
      `INSERT INTO nango_connections
         (user_id, slug, provider, integration_id, connection_id, enabled)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(user_id, slug) DO UPDATE SET
         provider = excluded.provider,
         integration_id = excluded.integration_id,
         connection_id = excluded.connection_id,
         enabled = 1,
         updated_at = datetime('now')`,
    ).run(
      state.user_id,
      integration.slug,
      integration.provider,
      integration.integrationId,
      connectionId,
    );
    storeConnectedAppTokens(state.user_id, integration.slug, tokens);
  });
  persist();
  return {
    integrationName: integration.name,
    userId: state.user_id,
    slug: integration.slug,
  };
}

/** Identify which embedded provider owns an OAuth state without consuming it. */
export function embeddedOAuthStateSlug(state: string): string | null {
  if (!state || state.length > 512) return null;
  const row = db
    .prepare(
      "SELECT slug FROM connected_app_oauth_states WHERE state_hash = ? AND expires_at > ?",
    )
    .get(stateHash(state), new Date().toISOString()) as
      | { slug: string }
      | undefined;
  return row?.slug ?? null;
}

async function activeTokens(userId: number, integration: NangoIntegration): Promise<ConnectedAppTokens> {
  const stored = readConnectedAppTokens(userId, integration.slug);
  if (!stored) throw new ApiError(409, "app_connection_required", `${integration.name} must be reconnected.`);
  const expiry = stored.expiresAt ? Date.parse(stored.expiresAt) : Number.POSITIVE_INFINITY;
  if (expiry > Date.now() + 60_000) return stored;
  if (!stored.refreshToken) {
    throw new ApiError(409, "app_connection_expired", `${integration.name} must be reconnected.`);
  }
  const refreshed = await requestTokens({
    integration,
    refreshToken: stored.refreshToken,
  });
  // OAuth providers commonly omit unchanged scopes from refresh responses.
  // Preserve the original grant so capability checks do not incorrectly turn
  // a healthy connection into "reconnect required" after the first hour.
  if (!refreshed.scope) refreshed.scope = stored.scope;
  storeConnectedAppTokens(userId, integration.slug, refreshed);
  return refreshed;
}

export async function connectedAppTokensFor(
  userId: number,
  integrationValue: string,
): Promise<ConnectedAppTokens> {
  const integration = findNangoIntegration(integrationValue);
  if (!integration) {
    throw new ApiError(400, "invalid_app_integration", "The app connection is invalid.");
  }
  return activeTokens(userId, integration);
}

export async function embeddedProviderRequest(input: {
  userId: number;
  integration: NangoIntegration;
  request: ConnectedAppProxyRequest;
}): Promise<unknown> {
  const metadata = connectedAppOAuthMetadata(input.integration);
  if (!metadata) throw new ApiError(400, "unsupported_app_auth", "This app connection is unsupported.");
  const tokens = await activeTokens(input.userId, input.integration);
  const endpoint = input.request.endpoint.trim();
  if (!endpoint.startsWith("/") || endpoint.startsWith("//") || endpoint.includes("\\") || /(?:^|\/)\.\.(?:\/|$)/.test(endpoint)) {
    throw new ApiError(400, "invalid_provider_endpoint", "The provider API endpoint is invalid.");
  }
  const base = secureProviderUrl(metadata.baseUrl);
  const url = new URL(endpoint.replace(/^\/+/, ""), `${base.toString().replace(/\/+$/, "")}/`);
  if (url.origin !== base.origin) throw new ApiError(400, "invalid_provider_endpoint", "The provider API endpoint is invalid.");
  for (const [key, value] of Object.entries(input.request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `${tokens.tokenType || "Bearer"} ${
      input.integration.slug === "slack" && endpoint.startsWith("/search.")
        ? (objectRecord(tokens.raw.authed_user)?.access_token as string | undefined) ||
          tokens.accessToken
        : tokens.accessToken
    }`,
    ...metadata.proxyHeaders,
  };
  if (input.integration.slug === "github") {
    headers["User-Agent"] = "Breadboard";
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  if (input.request.body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(url, {
      method: input.request.method,
      headers,
      ...(input.request.body === undefined ? {} : { body: JSON.stringify(input.request.body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(503, "provider_unavailable", "The connected app could not be reached.");
  }
  const payload = await readProviderPayload(response);
  if (!response.ok) {
    const authenticationFailed = response.status === 401;
    const forbidden = response.status === 403;
    throw new ApiError(
      authenticationFailed ? 409 : forbidden ? 403 : 502,
      authenticationFailed
        ? "provider_authentication_failed"
        : forbidden
          ? "provider_request_forbidden"
          : "provider_request_failed",
      authenticationFailed
        ? `${input.integration.name} must be reconnected.`
        : forbidden
          ? `${input.integration.name} does not allow this action for the connected account.`
          : "The connected app rejected the request.",
    );
  }
  return payload;
}
