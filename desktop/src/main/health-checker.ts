import * as http from "node:http";
import * as net from "node:net";

export type HealthCheckSpec =
  | {
      type: "http";
      /** Full URL, e.g. http://127.0.0.1:8765/health */
      url: string;
      /** Request method. Defaults to GET. */
      method?: "GET" | "POST";
      /** Request body, for POST probes. */
      body?: string;
      /** Extra request headers (e.g. Basic auth). */
      headers?: Record<string, string>;
      /** Response-body substring that must be present, if any. */
      expectBodyIncludes?: string;
      /**
       * Exact status codes that count as healthy, replacing the 2xx/3xx rule.
       *
       * Used by adoption probes, where the interesting answer is "the service
       * accepted our credentials" rather than "the request succeeded": a gated
       * endpoint answers 401 to a foreign caller and 400/404/405 to an
       * authenticated one, and only the second means the running instance is
       * ours.
       */
      acceptStatuses?: number[];
      /**
       * Treat any HTTP response as healthy, including 4xx. Used where the
       * service is ready as soon as it answers, but the specific URL may
       * legitimately 404 — e.g. Quartz serving a garden that has no pages yet
       * on a fresh install.
       */
      acceptAnyStatus?: boolean;
      timeoutMs: number;
    }
  | {
      type: "tcp";
      host: string;
      port: number;
      timeoutMs: number;
    }
  | {
      type: "process";
    };

/**
 * What a probe actually learned, for callers that need more than pass/fail.
 *
 * - `pass`        — healthy per the spec.
 * - `answered`    — the server replied, but not the way this spec expects.
 *                   A definitive "not this service": a wrong status, a wrong
 *                   body, a 401 from a gated route.
 * - `timeout`     — the request was accepted and never answered in time. The
 *                   signature of a server that is up but still warming: a cold
 *                   `next dev` holds the request while it compiles the route.
 * - `unreachable` — nothing to talk to: connection refused, reset, closed.
 */
export type HealthProbeResult = "pass" | "answered" | "timeout" | "unreachable";

export async function runHealthProbe(spec: HealthCheckSpec): Promise<HealthProbeResult> {
  switch (spec.type) {
    case "http":
      return httpProbe(spec);
    case "tcp":
      return (await tcpCheck(spec.host, spec.port, spec.timeoutMs)) ? "pass" : "unreachable";
    case "process":
      // Liveness of the child process is tracked by the supervisor itself.
      return "pass";
  }
}

export async function runHealthCheck(spec: HealthCheckSpec): Promise<boolean> {
  return (await runHealthProbe(spec)) === "pass";
}

function httpProbe(
  spec: Extract<HealthCheckSpec, { type: "http" }>,
): Promise<HealthProbeResult> {
  const { url, timeoutMs, expectBodyIncludes } = spec;
  const headers = { ...(spec.headers ?? {}) };
  const method = spec.method ?? "GET";
  const body = spec.body;
  if (body !== undefined && headers["Content-Length"] === undefined) {
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }
  return new Promise((resolve) => {
    const request = http.request(url, { method, headers, timeout: timeoutMs }, (response) => {
      const status = response.statusCode ?? 0;
      const statusOk = spec.acceptStatuses
        ? spec.acceptStatuses.includes(status)
        : spec.acceptAnyStatus === true
          ? status > 0
          : status >= 200 && status < 400;
      if (!statusOk) {
        response.resume();
        resolve("answered");
        return;
      }
      if (!expectBodyIncludes) {
        response.resume();
        resolve("pass");
        return;
      }
      let received = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        if (received.length < 512 * 1024) received += chunk;
      });
      response.on("end", () =>
        resolve(received.includes(expectBodyIncludes) ? "pass" : "answered"),
      );
      response.on("error", () => resolve("unreachable"));
    });
    request.on("timeout", () => {
      request.destroy();
      resolve("timeout");
    });
    request.on("error", () => resolve("unreachable"));
    request.end(body);
  });
}

function tcpCheck(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

/** Poll a health check until it passes or the deadline expires. */
export async function waitForHealthy(
  spec: HealthCheckSpec,
  options: {
    startupTimeoutMs: number;
    intervalMs: number;
    /** Abort early (e.g. the process died). Return a reason string to fail fast. */
    shouldAbort?: () => string | null;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + options.startupTimeoutMs;
  while (Date.now() < deadline) {
    const abortReason = options.shouldAbort?.() ?? null;
    if (abortReason !== null) return { ok: false, reason: abortReason };
    if (await runHealthCheck(spec)) return { ok: true };
    await delay(options.intervalMs);
  }
  return { ok: false, reason: `health check timed out after ${options.startupTimeoutMs}ms` };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
