import "server-only";

import fs from "node:fs";
import { RouteError } from "@/lib/server-auth";

const PUBLIC_TEMPLATE_BASE = "https://api.n8n.io/api/";
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

type N8nCredentials = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

export type N8nSession = { cookie: string };

function loopbackBaseUrl(): string {
  const configured = process.env.N8N_BASE_URL?.trim() || "http://127.0.0.1:5678";
  const url = new URL(configured);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new RouteError(503, "The local workflow service is configured with an unsafe address.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function n8nBaseUrl(): string {
  return loopbackBaseUrl();
}

function credentials(): N8nCredentials {
  const file = process.env.N8N_CREDENTIALS_PATH?.trim();
  if (!file) throw new RouteError(503, "The local workflow service is still preparing.");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<N8nCredentials>;
    if (
      typeof parsed.email !== "string" ||
      typeof parsed.firstName !== "string" ||
      typeof parsed.lastName !== "string" ||
      typeof parsed.password !== "string"
    ) throw new Error("invalid credentials file");
    return {
      email: parsed.email,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      password: parsed.password,
    };
  } catch {
    throw new RouteError(503, "The local workflow service is still preparing its private account.");
  }
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

async function responseJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_JSON_BYTES) throw new RouteError(502, "The workflow response was too large.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    throw new RouteError(502, "The workflow response was too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RouteError(502, "The workflow service returned an invalid response.");
  }
}

function responseCookie(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw.split(";")[0]?.trim() ?? "";
}

export async function n8nIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`${loopbackBaseUrl()}/healthz/readiness`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureN8nSession(existingCookieValue?: string): Promise<N8nSession> {
  const account = credentials();
  const baseUrl = loopbackBaseUrl();
  // This cookie is handed to the embedded editor, whose browser-id is created
  // inside n8n. Do not bind the token to Breadboard's server-side requests or
  // n8n will reject the valid cookie when the iframe supplies its own ID.
  const headers = { "content-type": "application/json" };
  if (existingCookieValue) {
    const existing = { cookie: `n8n-auth=${existingCookieValue}` };
    try {
      const current = await fetch(`${baseUrl}/rest/login`, {
        headers: { ...headers, Cookie: existing.cookie },
        cache: "no-store",
        signal: timeoutSignal(),
      });
      if (current.ok) return existing;
    } catch {
      // Fall through to a fresh login, which returns a specific readiness error.
    }
  }
  let login: Response;
  try {
    login = await fetch(`${baseUrl}/rest/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ emailOrLdapLoginId: account.email, password: account.password }),
      cache: "no-store",
      signal: timeoutSignal(),
    });
  } catch {
    throw new RouteError(503, "The local workflow service is not ready yet.");
  }
  if (login.ok) {
    const cookie = responseCookie(login);
    if (cookie) return { cookie };
  }

  const setup = await fetch(`${baseUrl}/rest/owner/setup`, {
    method: "POST",
    headers,
    body: JSON.stringify(account),
    cache: "no-store",
    signal: timeoutSignal(),
  });
  if (setup.ok) {
    const cookie = responseCookie(setup);
    if (cookie) return { cookie };
  }
  throw new RouteError(
    503,
    "Breadboard could not open its local n8n account. If this n8n data folder was changed externally, restore it or clear only the Breadboard n8n runtime data.",
  );
}

export async function n8nJson(
  path: string,
  init: RequestInit & { session: N8nSession },
): Promise<unknown> {
  if (!path.startsWith("/rest/")) throw new RouteError(500, "Invalid local workflow route.");
  const response = await fetch(`${loopbackBaseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Cookie: init.session.cookie,
      ...init.headers,
    },
    cache: "no-store",
    signal: timeoutSignal(),
  });
  const payload = await responseJson(response);
  if (!response.ok) throw new RouteError(502, "The local workflow service rejected the request.");
  const envelope = typeof payload === "object" && payload !== null
    ? payload as Record<string, unknown>
    : null;
  return envelope && "data" in envelope ? envelope.data : payload;
}

export async function publicTemplateJson(
  path: string,
  query?: Record<string, string>,
): Promise<unknown> {
  if (!path.startsWith("templates/") && !path.startsWith("workflows/templates/")) {
    throw new RouteError(500, "Invalid public template route.");
  }
  const url = new URL(path, PUBLIC_TEMPLATE_BASE);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { "n8n-version": "2.33.0", accept: "application/json" },
    next: { revalidate: 300 },
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new RouteError(502, "n8n's public workflow library is unavailable.");
  return responseJson(response);
}

export function forwardN8nCookie(response: Response, session: N8nSession): void {
  response.headers.append("Set-Cookie", `${session.cookie}; Path=/; HttpOnly; SameSite=Lax`);
}
