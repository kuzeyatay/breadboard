export interface ConnectedAppProxyRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}
