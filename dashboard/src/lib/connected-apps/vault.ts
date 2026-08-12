import "server-only";

import crypto from "node:crypto";
import db from "../db.ts";
import { ApiError } from "../hermes/route-core.ts";

const VERSION = "v1";

export type ConnectedAppTokens = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: string | null;
  raw: Record<string, unknown>;
};

function vaultKey(): Buffer {
  const explicit = process.env.BREADBOARD_CONNECTION_VAULT_KEY?.trim();
  if (explicit) {
    const decoded = Buffer.from(explicit, "base64");
    if (decoded.length !== 32) {
      throw new ApiError(
        503,
        "invalid_connection_vault_key",
        "Connected apps are temporarily unavailable.",
      );
    }
    return decoded;
  }
  const applicationSecret = process.env.NEXTAUTH_SECRET?.trim();
  if (!applicationSecret || applicationSecret.length < 16) {
    throw new ApiError(
      503,
      "connection_vault_unavailable",
      "Connected apps are temporarily unavailable.",
    );
  }
  return crypto
    .createHash("sha256")
    .update("breadboard-connected-app-vault\0")
    .update(applicationSecret)
    .digest();
}

function aad(userId: number, slug: string): Buffer {
  return Buffer.from(`${VERSION}:${userId}:${slug}`, "utf8");
}

function seal(userId: number, slug: string, value: ConnectedAppTokens): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(aad(userId, slug));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function open(userId: number, slug: string, value: string): ConnectedAppTokens {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    !encryptedValue ||
    extra.length
  ) {
    throw new ApiError(503, "invalid_connected_app_vault", "The app connection must be reconnected.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      vaultKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(aad(userId, slug));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plain) as ConnectedAppTokens;
    if (!parsed.accessToken || typeof parsed.accessToken !== "string") {
      throw new Error("missing access token");
    }
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "invalid_connected_app_vault", "The app connection must be reconnected.");
  }
}

export function storeConnectedAppTokens(
  userId: number,
  slug: string,
  tokens: ConnectedAppTokens,
): void {
  db.prepare(
    `INSERT INTO connected_app_credentials
       (user_id, slug, encrypted_value, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, slug) DO UPDATE SET
       encrypted_value = excluded.encrypted_value,
       expires_at = excluded.expires_at,
       updated_at = datetime('now')`,
  ).run(userId, slug, seal(userId, slug, tokens), tokens.expiresAt);
}

export function readConnectedAppTokens(
  userId: number,
  slug: string,
): ConnectedAppTokens | null {
  const row = db
    .prepare(
      `SELECT encrypted_value
       FROM connected_app_credentials
       WHERE user_id = ? AND slug = ?`,
    )
    .get(userId, slug) as { encrypted_value: string } | undefined;
  return row ? open(userId, slug, row.encrypted_value) : null;
}

export function connectionVaultConfigured(): boolean {
  try {
    vaultKey();
    return true;
  } catch {
    return false;
  }
}
