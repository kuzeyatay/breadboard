// Vendored from simstudioai/sim (Apache-2.0), apps/sim/tools/request-transport.ts
// — TRIMMED for Breadboard: only `formatToolRequest`, the pure request-shape
// builder. The original file's other half (`prepareToolRequest` and
// `projectToolModelInputParams`) implements sim's model-input-provenance and
// private-secret-provenance systems, which exist to authenticate first-party
// internal `/api/` routes Breadboard does not vendor — dropped per the tools
// recon's "minimal viable closure".

import { getMaxExecutionTimeout } from "./support/execution-limits";
import type { ToolConfig } from "./types";

export interface PreparedToolRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
  timeout?: number;
  proxyUrl?: string;
  stripAuthOnRedirect?: boolean;
  isInternalRoute: boolean;
}

export function formatToolRequest(
  tool: ToolConfig,
  params: Record<string, any>,
): PreparedToolRequest {
  const url = typeof tool.request.url === "function" ? tool.request.url(params) : tool.request.url;
  const method =
    typeof tool.request.method === "function"
      ? tool.request.method(params)
      : params.method || tool.request.method || "GET";
  const headers = new Headers(tool.request.headers ? tool.request.headers(params) : {});
  const hasBody = method !== "GET" && method !== "HEAD" && Boolean(tool.request.body);
  const bodyResult = tool.request.body ? tool.request.body(params) : undefined;
  const contentType = headers.get("content-type");
  const isPreformattedContent =
    contentType === "application/x-ndjson" || contentType === "application/x-www-form-urlencoded";

  let body: string | undefined;
  if (hasBody) {
    if (isPreformattedContent && typeof bodyResult === "string") {
      body = bodyResult;
    } else if (
      isPreformattedContent &&
      bodyResult &&
      typeof bodyResult === "object" &&
      "body" in bodyResult
    ) {
      body = (bodyResult as { body: string }).body;
    } else {
      body = typeof bodyResult === "string" ? bodyResult : JSON.stringify(bodyResult);
    }
  }

  const rawTimeout = params.timeout;
  const timeout = rawTimeout != null ? Number(rawTimeout) : undefined;
  const validTimeout =
    timeout != null && Number.isFinite(timeout) && timeout > 0
      ? Math.min(timeout, getMaxExecutionTimeout())
      : undefined;
  const proxyUrl =
    typeof params.proxyUrl === "string" && params.proxyUrl.trim()
      ? params.proxyUrl.trim()
      : undefined;

  if (!headers.has("User-Agent")) headers.set("User-Agent", "Breadboard");

  return {
    url,
    method,
    headers,
    body,
    timeout: validTimeout,
    proxyUrl,
    stripAuthOnRedirect: tool.request.stripAuthOnRedirect,
    isInternalRoute: url.startsWith("/api/"),
  };
}
