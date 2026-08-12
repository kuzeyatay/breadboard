const SKILLS_UPSTREAM_ORIGIN = "https://skills.sh";
const SKILLS_UPSTREAM_PREFIX = "/api/v1";
const MAX_PROXY_PATH_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 100;
const MAX_JSON_RESPONSE_BYTES = 25_000_000;
const SAFE_RESPONSE_HEADERS = [
  "etag",
  "last-modified",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;

type EndpointKind = "list" | "search" | "curated" | "detail" | "audit";

export interface CatalogProxyDependencies {
  getOidcToken(): Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

class RequestValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function proxyCatalogRequest(
  request: Request,
  pathSegments: string[],
  dependencies: CatalogProxyDependencies,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method_not_allowed", "Only GET and HEAD are supported.", { Allow: "GET, HEAD" });
  }
  let target: { url: URL; kind: EndpointKind };
  try {
    target = validateTarget(request, pathSegments);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(400, "invalid_request", "The catalog request is invalid.");
  }

  const timeoutMs = Math.min(25_000, Math.max(1_000, dependencies.timeoutMs ?? 15_000));
  let token: string;
  try {
    token = await boundedToken(dependencies.getOidcToken(), timeoutMs);
    if (!token?.trim()) throw new Error("empty token");
    token = token.trim();
  } catch {
    return jsonError(503, "proxy_identity_unavailable", "The catalog proxy cannot authenticate to its upstream provider.");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(target.url, {
      method: request.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const headers = safeResponseHeaders(response.headers, response.ok ? target.kind : null, token);
    if (request.method === "HEAD") return new Response(null, { status: response.status, headers });
    if (!response.ok) {
      return jsonError(
        response.status,
        "upstream_error",
        `Catalog upstream returned HTTP ${response.status}.`,
        headers,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_RESPONSE_BYTES) {
      return jsonError(502, "upstream_response_too_large", "The catalog upstream response exceeded the proxy limit.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_JSON_RESPONSE_BYTES) {
      return jsonError(502, "upstream_response_too_large", "The catalog upstream response exceeded the proxy limit.");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonError(502, "invalid_upstream_response", "The catalog upstream returned a non-JSON response.");
    }
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(redactSecret(body, token)), {
      status: response.status,
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return jsonError(504, "upstream_timeout", "The catalog upstream request timed out.");
    }
    return jsonError(503, "upstream_unavailable", "The catalog upstream is unavailable.");
  }
}

function validateTarget(request: Request, pathSegments: string[]): { url: URL; kind: EndpointKind } {
  const incoming = new URL(request.url);
  const rawPath = incoming.pathname;
  if (
    rawPath.length > MAX_PROXY_PATH_LENGTH ||
    incoming.hash ||
    rawPath.includes("\\") ||
    /%(?:00|2e|2f|5c|23|3f|25)/i.test(rawPath)
  ) {
    throw new RequestValidationError(400, "invalid_path", "The catalog path is invalid.");
  }
  if (!Array.isArray(pathSegments) || pathSegments.length === 0 || pathSegments.length > 10) {
    throw new RequestValidationError(404, "unsupported_route", "That catalog route is not supported.");
  }
  for (const segment of pathSegments) validateSegment(segment);
  if (pathSegments[0] !== "skills") {
    throw new RequestValidationError(404, "unsupported_route", "That catalog route is not supported.");
  }

  let kind: EndpointKind;
  if (pathSegments.length === 1) kind = "list";
  else if (pathSegments.length === 2 && pathSegments[1] === "search") kind = "search";
  else if (pathSegments.length === 2 && pathSegments[1] === "curated") kind = "curated";
  else if (pathSegments[1] === "audit" && pathSegments.length === 5) kind = "audit";
  else if (!["search", "curated", "audit"].includes(pathSegments[1]) && pathSegments.length === 4) kind = "detail";
  else throw new RequestValidationError(404, "unsupported_route", "That catalog route is not supported.");

  const validatedQuery = validateQuery(incoming.searchParams, kind);
  const target = new URL(`${SKILLS_UPSTREAM_PREFIX}/${pathSegments.map(encodeURIComponent).join("/")}`, SKILLS_UPSTREAM_ORIGIN);
  for (const [key, value] of validatedQuery) target.searchParams.set(key, value);
  return { url: target, kind };
}

function validateSegment(segment: string): void {
  if (
    typeof segment !== "string" ||
    segment.length === 0 ||
    segment.length > MAX_SEGMENT_LENGTH ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\\") ||
    segment.includes("/") ||
    segment.includes("\0") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
  ) {
    throw new RequestValidationError(400, "invalid_path", "The catalog path contains an invalid segment.");
  }
}

function validateQuery(search: URLSearchParams, kind: EndpointKind): Array<[string, string]> {
  const allowed = kind === "list"
    ? new Set(["view", "page", "per_page"])
    : kind === "search"
      ? new Set(["q", "limit", "owner"])
      : new Set<string>();
  for (const key of search.keys()) {
    if (!allowed.has(key)) throw new RequestValidationError(400, "invalid_query", `Unsupported query parameter: ${key}.`);
    if (search.getAll(key).length !== 1) throw new RequestValidationError(400, "invalid_query", `Duplicate query parameter: ${key}.`);
  }
  if (kind === "list") {
    const view = search.get("view");
    if (view !== null && !["all-time", "trending", "hot"].includes(view)) {
      throw new RequestValidationError(400, "invalid_query", "view must be all-time, trending, or hot.");
    }
    validateInteger(search.get("page"), "page", 0, Number.MAX_SAFE_INTEGER);
    validateInteger(search.get("per_page"), "per_page", 1, 500);
  }
  if (kind === "search") {
    const query = search.get("q");
    if (!query || query.trim().length < 2 || query.trim().length > 200 || /[\0\r\n]/.test(query)) {
      throw new RequestValidationError(400, "invalid_query", "q must contain 2 to 200 characters.");
    }
    validateInteger(search.get("limit"), "limit", 1, 200);
    const owner = search.get("owner");
    if (owner !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(owner)) {
      throw new RequestValidationError(400, "invalid_query", "owner is invalid.");
    }
  }
  return [...search.entries()];
}

function validateInteger(value: string | null, name: string, minimum: number, maximum: number): void {
  if (value === null) return;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new RequestValidationError(400, "invalid_query", `${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RequestValidationError(400, "invalid_query", `${name} is outside its allowed range.`);
  }
}

function safeResponseHeaders(upstream: Headers, kind: EndpointKind | null, secret: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", kind ? cachePolicy(upstream.get("cache-control"), kind) : "no-store");
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = upstream.get(name);
    if (value && !/[\r\n]/.test(value)) headers.set(name, redactText(value.slice(0, 500), secret));
  }
  return headers;
}

function cachePolicy(value: string | null, kind: EndpointKind): string {
  if (value && /(?:^|,)\s*(?:no-store|private)\b/i.test(value)) return "no-store";
  const defaults: Record<EndpointKind, number> = {
    list: 300,
    search: 60,
    curated: 600,
    detail: 3_600,
    audit: 300,
  };
  const upstreamMaxAge = value?.match(/(?:s-maxage|max-age)=(\d+)/i)?.[1];
  const upstreamStale = value?.match(/stale-while-revalidate=(\d+)/i)?.[1];
  const maxAge = clamp(Number(upstreamMaxAge ?? defaults[kind]), 30, 3_600);
  const stale = clamp(Number(upstreamStale ?? maxAge * 4), 60, 86_400);
  return `public, s-maxage=${maxAge}, stale-while-revalidate=${stale}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.trunc(value) : minimum));
}

function redactSecret(value: unknown, secret: string): unknown {
  if (typeof value === "string") return redactText(value, secret);
  if (Array.isArray(value)) return value.map((entry) => redactSecret(entry, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [redactText(key, secret), redactSecret(entry, secret)]));
  }
  return value;
}

function redactText(value: string, secret: string): string {
  return value.includes(secret) ? value.split(secret).join("[redacted]") : value;
}

async function boundedToken(promise: Promise<string>, timeoutMs: number): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<string>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("identity timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function jsonError(
  status: number,
  error: string,
  message: string,
  additionalHeaders?: HeadersInit,
): Response {
  const headers = new Headers(additionalHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify({ error, message }), { status, headers });
}
