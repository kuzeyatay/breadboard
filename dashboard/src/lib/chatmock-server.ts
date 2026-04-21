import {
  CHATMOCK_TARGET_COOKIE,
  DEFAULT_CHATMOCK_TARGET,
  normalizeChatmockTarget,
  type ChatmockTarget,
} from "@/lib/chatmock-target";

const DEFAULT_LOCAL_CHATMOCK_BASE_URL = "http://127.0.0.1:8765/v1";

function normalizeBaseUrl(value?: string | null): string | null {
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

function requestHostname(request: Request): string | null {
  const candidates = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const first = candidate.split(",")[0]?.trim();
    if (!first) continue;

    try {
      return new URL(`http://${first}`).hostname;
    } catch {
      // Try the next candidate.
    }
  }

  try {
    return new URL(request.url).hostname;
  } catch {
    return null;
  }
}

function localChatmockBaseUrl(): string {
  return (
    normalizeBaseUrl(
      process.env.OPENAI_LOCAL_BASE_URL ?? process.env.OPENAI_BASE_URL,
    ) ?? DEFAULT_LOCAL_CHATMOCK_BASE_URL
  );
}

function hostChatmockBaseUrl(request: Request): string {
  const configured = normalizeBaseUrl(process.env.OPENAI_HOST_BASE_URL);
  if (configured) return configured;

  const hostname = requestHostname(request);
  if (!hostname) return localChatmockBaseUrl();

  const protocol = (process.env.CHATMOCK_HOST_PROTOCOL ?? "http").trim() || "http";
  const port = (process.env.CHATMOCK_HOST_PORT ?? "8765").trim() || "8765";

  return (
    normalizeBaseUrl(`${protocol}://${hostname}:${port}`) ??
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
        ? hostChatmockBaseUrl(request)
        : localChatmockBaseUrl(),
  };
}
