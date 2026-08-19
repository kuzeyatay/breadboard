// Breadboard replacement for simstudioai/sim's `http_request` tool (Apache-2.0 —
// apps/sim/tools/http/request.ts). Sim routes it through an SSRF-pinned transport with a
// per-request proxy agent and a retry policy driven by its execution limits. Breadboard's
// API block calls operator-configured endpoints, often on loopback (see
// core/security/input-validation.server for why pinning is dropped), so this is a plain
// fetch — with sim's table-row header/param shape and its response envelope preserved.

import type { RequestParams, RequestResponse } from "@/lib/sim/core/tools-shim/http/types";
import type { TableRow, ToolConfig, ToolResponse } from "@/lib/sim/tools/types";

function tableRowsToRecord(value: TableRow[] | string | undefined): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  const record: Record<string, string> = {};
  for (const row of value) {
    const key = row?.cells?.Key;
    if (typeof key === "string" && key.trim()) record[key.trim()] = String(row.cells.Value ?? "");
  }
  return record;
}

export const httpRequestTool: ToolConfig<RequestParams, RequestResponse> = {
  id: "http_request",
  name: "HTTP Request",
  description: "Sends an HTTP request and returns its status, headers and parsed body.",
  version: "1.0.0",
  params: {
    url: { type: "string", required: true, visibility: "user-or-llm", description: "Request URL" },
    method: { type: "string", required: false, visibility: "user-or-llm" },
    headers: { type: "json", required: false, visibility: "user-or-llm" },
    body: { type: "json", required: false, visibility: "user-or-llm" },
    params: { type: "json", required: false, visibility: "user-or-llm" },
  },
  outputs: {
    data: { type: "json", description: "Response body" },
    status: { type: "number", description: "HTTP status code" },
    headers: { type: "json", description: "Response headers" },
  },
  request: {
    url: (params) => params.url,
    method: "GET",
    headers: (params) => tableRowsToRecord(params.headers),
  },
  directExecution: async (params, signal): Promise<ToolResponse> => {
    const method = (params.method || "GET").toUpperCase();
    let url: URL;
    try {
      url = new URL(params.url);
    } catch {
      return { success: false, output: {}, error: `Invalid URL: ${params.url}` };
    }
    for (const [key, value] of Object.entries(tableRowsToRecord(params.params))) {
      url.searchParams.set(key, value);
    }

    const headers = tableRowsToRecord(params.headers);
    const hasBody = method !== "GET" && method !== "HEAD" && params.body !== undefined;
    if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeout =
      params.timeout && params.timeout > 0
        ? setTimeout(() => controller.abort(), params.timeout)
        : undefined;
    const requestSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        ...(hasBody
          ? {
              body:
                typeof params.body === "string" ? params.body : JSON.stringify(params.body),
            }
          : {}),
        signal: requestSignal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const text = await response.text();
      let data: unknown = text;
      if (response.headers.get("content-type")?.includes("application/json")) {
        try {
          data = JSON.parse(text);
        } catch {
          // Server lied about the content type; the raw text is the honest answer.
        }
      }

      const output = { data, status: response.status, headers: responseHeaders };
      return response.ok
        ? { success: true, output, statusCode: response.status }
        : {
            success: false,
            output,
            statusCode: response.status,
            error: `${response.status} ${response.statusText}`,
          };
    } catch (error) {
      return {
        success: false,
        output: {},
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  },
};
