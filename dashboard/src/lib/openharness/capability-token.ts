// Short-lived, HMAC-signed capability tokens.
//
// Garden and Quartz custom tools run inside OpenHarness but must call back into
// Breadboard to retrieve real garden content. Rather than hand the model a
// user's credentials, the gateway mints a narrowly-scoped capability token when
// it creates a runtime session. The token is embedded in the server-controlled
// workspace context (never in model-visible prose) and presented by the tool
// adapter on each internal call. Breadboard verifies the signature, expiry, and
// scope before serving any data.
//
// The model cannot forge or widen a token: it is signed with a server secret
// and pins the garden id, surface, and allowed tools. Supplying a different
// garden id in a tool argument cannot escape the token's scope because the
// endpoint authorizes against the token, not the argument.

import crypto from "node:crypto";
import type { OpenHarnessSurface } from "./config.ts";

export interface CapabilityScope {
  userId: number;
  surface: OpenHarnessSurface;
  /** Breadboard chat-session id (numeric) as a string, if applicable. */
  breadboardSessionId?: string;
  openHarnessSessionId: string;
  gardenId?: string;
  pageSlug?: string;
  allowedTools: string[];
}

export interface CapabilityToken extends CapabilityScope {
  /** Issued-at, epoch ms. */
  iat: number;
  /** Expiry, epoch ms. */
  exp: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

function secret(): string {
  // Reuse the NextAuth secret so operators don't need another env var; fall back
  // to a fixed dev-only value so local development works without extra setup.
  return (
    process.env.OPENHARNESS_CAPABILITY_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "breadboard-openharness-dev-secret"
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueCapabilityToken(
  scope: CapabilityScope,
  options?: { ttlMs?: number; now?: number },
): string {
  const now = options?.now ?? Date.now();
  const token: CapabilityToken = {
    ...scope,
    allowedTools: [...scope.allowedTools],
    iat: now,
    exp: now + (options?.ttlMs ?? DEFAULT_TTL_MS),
  };
  const body = base64url(JSON.stringify(token));
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { ok: true; token: CapabilityToken }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyCapabilityToken(raw: unknown, now = Date.now()): VerifyResult {
  if (typeof raw !== "string" || !raw.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const separator = raw.lastIndexOf(".");
  const body = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!body || !signature) return { ok: false, reason: "malformed" };

  const expected = sign(body);
  // Constant-time comparison to avoid signature timing oracles.
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: CapabilityToken;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CapabilityToken;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed.exp !== "number" || parsed.exp < now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, token: parsed };
}

/** Whether a verified token authorizes a specific tool + garden combination. */
export function tokenAllows(
  token: CapabilityToken,
  input: { tool: string; gardenId?: string },
): boolean {
  if (!token.allowedTools.includes(input.tool)) return false;
  // A garden-scoped token may only act on its own garden. A tool argument that
  // names another garden is rejected here rather than trusted.
  if (input.gardenId !== undefined && token.gardenId !== undefined && input.gardenId !== token.gardenId) {
    return false;
  }
  return true;
}
