// Breadboard stand-in for sim's lib/auth/internal.ts (simstudioai/sim, Apache-2.0).
// Sim mints short-lived HS256 JWTs so the Trigger.dev worker can call the app's own
// protected routes. Breadboard runs the executor in-process against its own services,
// so nothing verifies these — but the shape is preserved (a real signed token over a
// per-process secret) rather than faked, so any future internal route can verify it
// without changing call sites. `jose` is not a Breadboard dependency; node:crypto's
// HMAC is all HS256 needs.

import { createHmac, randomBytes, randomUUID } from "node:crypto";

export interface InternalSandboxProfile {
  [key: string]: unknown;
}

export interface InternalTokenClaims {
  sandboxProfile?: InternalSandboxProfile;
}

export interface GenerateInternalDelegationTokenInput {
  subjectUserId: string;
  workflowId: string;
  executionId?: string;
}

let processSecret: string | undefined;

function getJwtSecret(): string {
  const configured = process.env.INTERNAL_API_SECRET || process.env.BETTER_AUTH_SECRET;
  if (configured) return configured;
  if (!processSecret) processSecret = randomBytes(32).toString("hex");
  return processSecret;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(payload: Record<string, unknown>, ttlSeconds: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({ ...payload, iat: issuedAt, exp: issuedAt + ttlSeconds, iss: "sim-internal" }),
  );
  const signature = createHmac("sha256", getJwtSecret()).update(`${header}.${body}`).digest();
  return `${header}.${body}.${base64url(signature)}`;
}

export async function generateInternalToken(
  userId?: string,
  claims: InternalTokenClaims = {},
): Promise<string> {
  return sign(
    {
      type: "internal",
      ...(userId ? { userId } : {}),
      ...(claims.sandboxProfile ? { sandboxProfile: claims.sandboxProfile } : {}),
    },
    300,
  );
}

export async function generateInternalDelegationToken(
  input: GenerateInternalDelegationTokenInput,
): Promise<string> {
  if (!input.subjectUserId) throw new Error("subjectUserId is required");
  if (!input.workflowId) throw new Error("workflowId is required");
  return sign(
    {
      type: "internal_delegation",
      serviceId: "executor",
      sub: input.subjectUserId,
      workflowId: input.workflowId,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      jti: randomUUID(),
    },
    300,
  );
}
