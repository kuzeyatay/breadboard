import * as http from "node:http";
import * as net from "node:net";

export type HealthCheckSpec =
  | {
      type: "http";
      /** Full URL, e.g. http://127.0.0.1:8765/health */
      url: string;
      /** Extra request headers (e.g. Basic auth). */
      headers?: Record<string, string>;
      /** Response-body substring that must be present, if any. */
      expectBodyIncludes?: string;
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

export async function runHealthCheck(spec: HealthCheckSpec): Promise<boolean> {
  switch (spec.type) {
    case "http":
      return httpCheck(
        spec.url,
        spec.headers ?? {},
        spec.expectBodyIncludes,
        spec.timeoutMs,
        spec.acceptAnyStatus === true,
      );
    case "tcp":
      return tcpCheck(spec.host, spec.port, spec.timeoutMs);
    case "process":
      // Liveness of the child process is tracked by the supervisor itself.
      return true;
  }
}

function httpCheck(
  url: string,
  headers: Record<string, string>,
  expectBodyIncludes: string | undefined,
  timeoutMs: number,
  acceptAnyStatus = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, { headers, timeout: timeoutMs }, (response) => {
      const status = response.statusCode ?? 0;
      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status < 400;
      if (!statusOk) {
        response.resume();
        resolve(false);
        return;
      }
      if (!expectBodyIncludes) {
        response.resume();
        resolve(true);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        if (body.length < 512 * 1024) body += chunk;
      });
      response.on("end", () => resolve(body.includes(expectBodyIncludes)));
      response.on("error", () => resolve(false));
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
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
