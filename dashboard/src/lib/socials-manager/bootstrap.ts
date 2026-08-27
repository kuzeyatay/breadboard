// First-run bootstrap for the real Postiz stack.
//
// Postiz's public API authenticates with an organization API key, which normally
// means a human signing up in its web UI and copying the key out of settings.
// That is exactly the manual step this integration exists to avoid, so Breadboard
// registers its own local account over the app API and reads the key back from
// `GET /user/self`.
//
// This works because the generated compose override sets NOT_SECURED, which makes
// Postiz return the auth JWT in an `auth` response header rather than only in a
// Secure cookie that a server-side fetch on plain http would drop.

import type { SocialsManagerConfig, PostizCredentials } from "./config.ts";
import { readCredentials, writeCredentials, ensureCredentials } from "./local-state.ts";

const TIMEOUT_MS = 30_000;

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; headers: Headers; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    return { status: response.status, headers: response.headers, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Postiz hands the JWT back in the `auth` header when NOT_SECURED is set. */
function authToken(headers: Headers, json: Record<string, unknown>): string | null {
  const header = headers.get("auth");
  if (header?.trim()) return header.trim();
  const token = json.token ?? json.jwt ?? json.auth;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

async function register(
  config: SocialsManagerConfig,
  credentials: PostizCredentials,
): Promise<string | null> {
  const result = await postJson(`${config.appApiUrl}/auth/register`, {
    email: credentials.email,
    password: credentials.password,
    company: "Breadboard",
    provider: "LOCAL",
  });
  // 400 here is the normal "already registered" path on a second run.
  if (result.status >= 400) return null;
  return authToken(result.headers, result.json);
}

async function login(
  config: SocialsManagerConfig,
  credentials: PostizCredentials,
): Promise<string | null> {
  const result = await postJson(`${config.appApiUrl}/auth/login`, {
    email: credentials.email,
    password: credentials.password,
    provider: "LOCAL",
  });
  if (result.status >= 400) return null;
  return authToken(result.headers, result.json);
}

/** Read the organization's API key from the authenticated self endpoint. */
async function readApiKey(
  config: SocialsManagerConfig,
  token: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.appApiUrl}/user/self`, {
      headers: { auth: token, cookie: `auth=${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    // Current Postiz exposes the organization key as `publicApi`; retain the
    // older `apiKey` spelling for compatibility with earlier images.
    const key = body.publicApi ?? body.apiKey;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make sure Breadboard holds a usable Postiz API key, registering the local
 * account the first time. Returns null when Postiz is up but refused to
 * bootstrap — the caller then falls back to local drafting rather than failing
 * the user's turn.
 */
export async function ensureApiKey(
  config: SocialsManagerConfig,
): Promise<string | null> {
  const stored = readCredentials(config);
  if (stored?.apiKey) return stored.apiKey;

  const credentials = stored ?? ensureCredentials(config);
  // Register first; on a re-run the account already exists and login answers.
  const token = (await register(config, credentials)) ?? (await login(config, credentials));
  if (!token) return null;

  const apiKey = await readApiKey(config, token);
  if (!apiKey) return null;

  writeCredentials(config, { ...credentials, apiKey });
  return apiKey;
}
