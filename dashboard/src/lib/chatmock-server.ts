import {
  CHATMOCK_TARGET_COOKIE,
  DEFAULT_CHATMOCK_TARGET,
  normalizeChatmockTarget,
  type ChatmockTarget,
  // Relative so subsystems that run outside the Next bundler (the UI-TARS
  // library, exercised by node --test) can import this module.
} from "./chatmock-target.ts";

const DEFAULT_LOCAL_CHATMOCK_BASE_URL = "http://127.0.0.1:8765/v1";

/**
 * Normalize a ChatMock base URL: add the protocol when omitted, drop query and
 * fragment, and guarantee the OpenAI-compatible `/v1` suffix. Exported so other
 * subsystems (UI-TARS) resolve the same endpoint the chat surfaces use.
 */
export function normalizeChatmockBaseUrl(value?: string | null): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    const url = new URL(withProtocol);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = pathname.endsWith("/v1")
      ? pathname
      : `${pathname || ""}/v1`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        const key = part.slice(0, separator).trim();
        const rawValue = part.slice(separator + 1).trim();
        try {
          return [key, decodeURIComponent(rawValue)];
        } catch {
          return [key, rawValue];
        }
      }),
  );
}

/**
 * ChatMock as reached from the server with no request in hand — a background
 * index, a scheduled job, a sidecar's default. Exported because subsystems that
 * embed have no Request to resolve a per-user target from, and hard-coding the
 * port in each of them is how they drift apart.
 */
export function localChatmockBaseUrl(): string {
  return (
    normalizeChatmockBaseUrl(process.env.OPENAI_LOCAL_BASE_URL) ??
    normalizeChatmockBaseUrl(process.env.OPENAI_BASE_URL) ??
    DEFAULT_LOCAL_CHATMOCK_BASE_URL
  );
}

function hostChatmockBaseUrl(): string {
  // Request host headers are attacker-controlled in many deployments. Never
  // turn them into an authenticated model destination. Desktop launchers put
  // their dynamically allocated ChatMock URL in OPENAI_BASE_URL, while a
  // container/remote-host setup can opt in explicitly with this host override.
  return (
    normalizeChatmockBaseUrl(process.env.OPENAI_HOST_BASE_URL) ??
    localChatmockBaseUrl()
  );
}

export function getChatmockTargetFromRequest(request: Request): ChatmockTarget {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return normalizeChatmockTarget(
    cookies[CHATMOCK_TARGET_COOKIE] ?? DEFAULT_CHATMOCK_TARGET,
  );
}

export function resolveChatmockBaseUrl(request: Request): {
  target: ChatmockTarget;
  baseURL: string;
} {
  const target = getChatmockTargetFromRequest(request);

  return {
    target,
    baseURL:
      target === "host"
        ? hostChatmockBaseUrl()
        : localChatmockBaseUrl(),
  };
}
