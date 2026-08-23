import crypto from "node:crypto";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import db from "../db.ts";
import { ApiError } from "./route-core.ts";

const VERSION = "v1";
const STATE_TTL_MS = 10 * 60 * 1_000;
const MAX_ENVELOPE_BYTES = 256 * 1024;
const DEFAULT_MCP_OAUTH_CALLBACK =
  "http://127.0.0.1:3000/api/hermes/mcp/oauth/callback";

function mcpOAuthCallbackUrl(): string {
  const configured =
    process.env.BREADBOARD_MCP_OAUTH_CALLBACK_URL?.trim() ||
    DEFAULT_MCP_OAUTH_CALLBACK;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError(503, "invalid_mcp_oauth_callback", "MCP sign-in is unavailable.");
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "::1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.pathname !== "/api/hermes/mcp/oauth/callback"
  ) {
    throw new ApiError(503, "invalid_mcp_oauth_callback", "MCP sign-in is unavailable.");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

type McpOAuthConnection = {
  id: number;
  userId: number;
  slug: string;
  transport: "local" | "remote";
  config: unknown;
};

type RemoteConfig = {
  transport: "remote";
  url: string;
  oauth: boolean;
};

type OAuthEnvelope = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
};

type OAuthStateRow = {
  connection_id: number;
  user_id: number;
  redirect_uri: string;
  expires_at: string;
};

type ConnectionRow = {
  id: number;
  user_id: number;
  slug: string;
  display_name: string;
  transport: "local" | "remote";
  config_json: string;
};

function vaultKey(): Buffer {
  const explicit = process.env.BREADBOARD_CONNECTION_VAULT_KEY?.trim();
  if (explicit) {
    const decoded = Buffer.from(explicit, "base64");
    if (decoded.length !== 32) {
      throw new ApiError(
        503,
        "invalid_connection_vault_key",
        "MCP sign-in is temporarily unavailable.",
      );
    }
    return decoded;
  }
  const applicationSecret = process.env.NEXTAUTH_SECRET?.trim();
  if (!applicationSecret || applicationSecret.length < 16) {
    throw new ApiError(
      503,
      "connection_vault_unavailable",
      "MCP sign-in requires a stable NEXTAUTH_SECRET.",
    );
  }
  return crypto
    .createHash("sha256")
    .update("breadboard-mcp-oauth-vault\0")
    .update(applicationSecret)
    .digest();
}

function aad(userId: number, connectionId: number): Buffer {
  return Buffer.from(`${VERSION}:${userId}:${connectionId}`, "utf8");
}

function seal(
  userId: number,
  connectionId: number,
  envelope: OAuthEnvelope,
): string {
  const plaintext = JSON.stringify(envelope);
  if (Buffer.byteLength(plaintext, "utf8") > MAX_ENVELOPE_BYTES) {
    throw new ApiError(502, "mcp_oauth_payload_too_large", "The OAuth response was too large.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(aad(userId, connectionId));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function open(
  userId: number,
  connectionId: number,
  value: string,
): OAuthEnvelope {
  const [version, ivValue, tagValue, ciphertext, ...extra] = value.split(".");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertext ||
    extra.length
  ) {
    throw new ApiError(409, "invalid_mcp_oauth_vault", "This MCP server must be signed in again.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      vaultKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(aad(userId, connectionId));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid envelope");
    }
    return parsed as OAuthEnvelope;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, "invalid_mcp_oauth_vault", "This MCP server must be signed in again.");
  }
}

function readEnvelope(userId: number, connectionId: number): OAuthEnvelope {
  const row = db
    .prepare(
      `SELECT encrypted_value FROM hermes_mcp_oauth_credentials
       WHERE user_id = ? AND connection_id = ?`,
    )
    .get(userId, connectionId) as { encrypted_value: string } | undefined;
  return row ? open(userId, connectionId, row.encrypted_value) : {};
}

function writeEnvelope(
  userId: number,
  connectionId: number,
  envelope: OAuthEnvelope,
): void {
  db.prepare(
    `INSERT INTO hermes_mcp_oauth_credentials
       (connection_id, user_id, encrypted_value)
     VALUES (?, ?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET
       encrypted_value = excluded.encrypted_value,
       updated_at = datetime('now')`,
  ).run(connectionId, userId, seal(userId, connectionId, envelope));
}

function stateHash(state: string): string {
  return crypto.createHash("sha256").update(state).digest("hex");
}

function remoteConfig(connection: McpOAuthConnection): RemoteConfig {
  if (
    connection.transport !== "remote" ||
    !connection.config ||
    typeof connection.config !== "object" ||
    (connection.config as { transport?: unknown }).transport !== "remote"
  ) {
    throw new ApiError(400, "mcp_oauth_not_remote", "Only remote MCP servers can use OAuth.");
  }
  const config = connection.config as RemoteConfig;
  if (!config.oauth) {
    throw new ApiError(409, "mcp_oauth_disabled", "OAuth is disabled for this MCP server.");
  }
  return config;
}

function validateTokens(tokens: OAuthTokens): void {
  if (
    typeof tokens.access_token !== "string" ||
    tokens.access_token.length < 8 ||
    tokens.access_token.length > 64 * 1024
  ) {
    throw new ApiError(502, "invalid_mcp_oauth_response", "The OAuth server returned invalid credentials.");
  }
  if (
    tokens.refresh_token !== undefined &&
    (typeof tokens.refresh_token !== "string" || tokens.refresh_token.length > 64 * 1024)
  ) {
    throw new ApiError(502, "invalid_mcp_oauth_response", "The OAuth server returned invalid credentials.");
  }
}

export class BreadboardMcpOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;
  authorizationUrl: string | null = null;

  private readonly connection: McpOAuthConnection;
  private readonly interactive: boolean;

  constructor(
    connection: McpOAuthConnection,
    redirectUrl?: string,
    interactive = false,
  ) {
    this.connection = connection;
    this.redirectUrl = redirectUrl ?? mcpOAuthCallbackUrl();
    this.interactive = interactive;
    this.clientMetadata = {
      client_name: "Breadboard",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state(): Promise<string> {
    // Runtime discovery is intentionally passive. It may refresh saved tokens,
    // but it must never replace the one-time state/verifier belonging to a
    // browser window the user already opened from Settings.
    if (!this.interactive) {
      throw new UnauthorizedError("OAuth authentication required");
    }
    const state = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
    db.prepare("DELETE FROM hermes_mcp_oauth_states WHERE expires_at <= ?").run(
      new Date().toISOString(),
    );
    db.prepare(
      "DELETE FROM hermes_mcp_oauth_states WHERE user_id = ? AND connection_id = ?",
    ).run(this.connection.userId, this.connection.id);
    db.prepare(
      `INSERT INTO hermes_mcp_oauth_states
         (state_hash, connection_id, user_id, redirect_uri, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      stateHash(state),
      this.connection.id,
      this.connection.userId,
      this.redirectUrl,
      expiresAt,
    );
    return state;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readEnvelope(this.connection.userId, this.connection.id).clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    const envelope = readEnvelope(this.connection.userId, this.connection.id);
    writeEnvelope(this.connection.userId, this.connection.id, {
      ...envelope,
      clientInformation,
    });
  }

  tokens(): OAuthTokens | undefined {
    return readEnvelope(this.connection.userId, this.connection.id).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    validateTokens(tokens);
    const envelope = readEnvelope(this.connection.userId, this.connection.id);
    writeEnvelope(this.connection.userId, this.connection.id, {
      ...envelope,
      tokens,
      codeVerifier: undefined,
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (authorizationUrl.protocol !== "https:") {
      throw new ApiError(502, "insecure_mcp_authorization_url", "The MCP authorization URL was not secure.");
    }
    this.authorizationUrl = authorizationUrl.toString();
  }

  saveCodeVerifier(codeVerifier: string): void {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
      throw new ApiError(502, "invalid_pkce_verifier", "The OAuth server returned an invalid PKCE verifier.");
    }
    const envelope = readEnvelope(this.connection.userId, this.connection.id);
    writeEnvelope(this.connection.userId, this.connection.id, {
      ...envelope,
      codeVerifier,
    });
  }

  codeVerifier(): string {
    const verifier = readEnvelope(this.connection.userId, this.connection.id).codeVerifier;
    if (!verifier) {
      throw new ApiError(400, "missing_pkce_verifier", "This sign-in link has expired. Start again from Settings.");
    }
    return verifier;
  }

  saveDiscoveryState(discoveryState: OAuthDiscoveryState): void {
    const envelope = readEnvelope(this.connection.userId, this.connection.id);
    writeEnvelope(this.connection.userId, this.connection.id, {
      ...envelope,
      discoveryState,
    });
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return readEnvelope(this.connection.userId, this.connection.id).discoveryState;
  }

  async validateResourceURL(
    serverUrl: string | URL,
    resource?: string,
  ): Promise<URL | undefined> {
    if (!resource) return undefined;
    const expected = new URL(serverUrl);
    const candidate = new URL(resource);
    if (candidate.origin !== expected.origin) {
      throw new ApiError(502, "invalid_mcp_oauth_resource", "The OAuth resource did not match the MCP server.");
    }
    return candidate;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all") {
      db.prepare(
        "DELETE FROM hermes_mcp_oauth_credentials WHERE user_id = ? AND connection_id = ?",
      ).run(this.connection.userId, this.connection.id);
      return;
    }
    const envelope = readEnvelope(this.connection.userId, this.connection.id);
    if (scope === "client") envelope.clientInformation = undefined;
    if (scope === "tokens") envelope.tokens = undefined;
    if (scope === "verifier") envelope.codeVerifier = undefined;
    if (scope === "discovery") envelope.discoveryState = undefined;
    writeEnvelope(this.connection.userId, this.connection.id, envelope);
  }
}

export function createMcpOAuthProvider(
  connection: McpOAuthConnection,
): BreadboardMcpOAuthProvider {
  return new BreadboardMcpOAuthProvider(connection);
}

export function mcpOAuthRevision(userId: number, connectionId: number): string | undefined {
  const row = db
    .prepare(
      `SELECT encrypted_value FROM hermes_mcp_oauth_credentials
       WHERE user_id = ? AND connection_id = ?`,
    )
    .get(userId, connectionId) as { encrypted_value: string } | undefined;
  return row
    ? crypto.createHash("sha256").update(row.encrypted_value).digest("hex")
    : undefined;
}

/** Whether a completed OAuth exchange has stored reusable credentials. */
export function hasMcpOAuthTokens(userId: number, connectionId: number): boolean {
  return Boolean(readEnvelope(userId, connectionId).tokens?.access_token);
}

export async function beginMcpAuthentication(
  connection: McpOAuthConnection,
): Promise<{ authorizationUrl: string }> {
  const provider = new BreadboardMcpOAuthProvider(connection, undefined, true);
  provider.invalidateCredentials("tokens");
  const result = await auth(provider, { serverUrl: remoteConfig(connection).url });
  if (result !== "REDIRECT" || !provider.authorizationUrl) {
    throw new ApiError(409, "mcp_oauth_no_redirect", "The MCP server did not provide a sign-in page.");
  }
  return { authorizationUrl: provider.authorizationUrl };
}

export async function completeMcpAuthentication(input: {
  state: string;
  code: string;
}): Promise<{
  userId: number;
  connectionId: number;
  slug: string;
  displayName: string;
}> {
  if (!input.state || !input.code) {
    throw new ApiError(400, "invalid_mcp_oauth_callback", "The MCP sign-in response is incomplete.");
  }
  const consumeState = db.transaction(() => {
    const hash = stateHash(input.state);
    const row = db
      .prepare("SELECT * FROM hermes_mcp_oauth_states WHERE state_hash = ?")
      .get(hash) as OAuthStateRow | undefined;
    if (row) {
      db.prepare("DELETE FROM hermes_mcp_oauth_states WHERE state_hash = ?").run(hash);
    }
    return row;
  });
  const state = consumeState();
  if (!state || Date.parse(state.expires_at) <= Date.now()) {
    throw new ApiError(400, "expired_mcp_oauth_state", "This sign-in link has expired. Start again from Settings.");
  }
  const row = db
    .prepare(
      `SELECT id, user_id, slug, display_name, transport, config_json
       FROM hermes_mcp_connections WHERE id = ? AND user_id = ?`,
    )
    .get(state.connection_id, state.user_id) as ConnectionRow | undefined;
  if (!row) {
    throw new ApiError(404, "mcp_not_found", "The MCP connection no longer exists.");
  }
  const connection: McpOAuthConnection = {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    transport: row.transport,
    config: JSON.parse(row.config_json) as unknown,
  };
  const provider = new BreadboardMcpOAuthProvider(connection, state.redirect_uri);
  const result = await auth(provider, {
    serverUrl: remoteConfig(connection).url,
    authorizationCode: input.code,
  });
  if (result !== "AUTHORIZED") {
    throw new ApiError(400, "mcp_oauth_exchange_failed", "The MCP server did not complete sign-in.");
  }
  return {
    userId: row.user_id,
    connectionId: row.id,
    slug: row.slug,
    displayName: row.display_name,
  };
}
