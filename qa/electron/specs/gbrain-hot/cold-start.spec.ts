import { expect, test, type Page } from "@playwright/test";

import { createQaEnvironment } from "../../environment";
import { ElectronQaHarness } from "../../fixtures";
import { waitForPortsReleased } from "../../process-ports";
import { createGarden, registerAndSignIn } from "../../user-journeys";

const TEST_TIMEOUT_MS = 15 * 60_000;
const UI_TIMEOUT_MS = 3 * 60_000;
const GBRAIN_REQUEST_TIMEOUT_MS = 3 * 60_000;
const PORT_RELEASE_TIMEOUT_MS = 30_000;

interface SameOriginJsonRequest {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
}

interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

test("isolated hot Electron cold-starts the real required GBrain backend", async ({}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  expect(process.env["BREADBOARD_QA_DASHBOARD_MODE"]).toBe("hot");
  expect(process.env["BREADBOARD_RUNTIME_V2_BURN_IN"]).not.toBe("1");

  const run = createQaEnvironment({
    preserve: "on-failure",
    desktopConfigProfile: "isolated-disabled",
    gbrainMode: "required",
    env: { BREADBOARD_DESKTOP_DASHBOARD_MODE: "hot" },
  });
  expect(run.env["BREADBOARD_DESKTOP_DASHBOARD_MODE"]).toBe("hot");
  expect(run.env["BREADBOARD_RUNTIME_V2_BURN_IN"]).not.toBe("1");
  expect({
    gbrain: run.env["GBRAIN_MODE"],
    uiTars: run.env["UI_TARS_MODE"],
    cad: run.env["CAD_MODE"],
    colpali: run.env["COLPALI_MODE"],
    humanizer: run.env["HUMANIZER_MODE"],
    cliproxy: run.env["CLIPROXY_MODE"],
    scriberr: run.env["VIDEO_TRANSCRIPTION_ENABLED"],
  }).toEqual({
    gbrain: "required",
    uiTars: "disabled",
    cad: "disabled",
    colpali: "disabled",
    humanizer: "disabled",
    cliproxy: "disabled",
    scriberr: "false",
  });

  const qa = new ElectronQaHarness(run);
  let completed = false;
  let gbrainPort: number | null = null;
  try {
    await qa.start();
    const page = await qa.dismissWelcome();
    await registerAndSignIn(page, qa.run.bootstrap.auth, UI_TIMEOUT_MS);

    const endpoints = qa.readEndpoints();
    expect(endpoints.pid).toBeGreaterThan(0);
    expect(endpoints.pid).not.toBe(await qa.mainProcessPid());
    const gbrainEndpoint = requiredLoopbackEndpoint(endpoints.urls["gbrain"], "GBrain");
    gbrainPort = Number(gbrainEndpoint.port);

    // This route intentionally observes Runtime state without taking a lease.
    // It proves the next authenticated sync is a genuine cold start.
    const before = await sameOriginJson(page, {
      path: "/api/gbrain/status",
      method: "GET",
      timeoutMs: 30_000,
    });
    expect(before.status).toBe(200);
    const beforeBody = jsonRecord(before.body, "GBrain pre-sync status");
    expect(beforeBody["state"]).toBe("available-but-stopped");
    expect(beforeBody["backend"]).toBeNull();

    const garden = await createGarden(page, {
      name: `Hot GBrain Smoke ${qa.run.runId.slice(-8)}`,
      description: "Disposable isolated source for the real hot GBrain cold-start smoke",
    }, UI_TIMEOUT_MS);
    const sync = await sameOriginJson(page, {
      path: "/api/gbrain/sync",
      method: "POST",
      body: { gardenId: garden.slug },
      timeoutMs: GBRAIN_REQUEST_TIMEOUT_MS,
    });
    expect(sync.status).toBe(200);
    const syncBody = jsonRecord(sync.body, "GBrain sync response");
    expect(syncBody["ok"]).toBe(true);
    const syncResult = jsonRecord(syncBody["result"], "GBrain sync result");
    expect(syncResult["status"]).toBe("synced");

    const after = await sameOriginJson(page, {
      path: `/api/gbrain/status?gardenId=${encodeURIComponent(garden.slug)}`,
      method: "GET",
      timeoutMs: 30_000,
    });
    expect(after.status).toBe(200);
    const afterBody = jsonRecord(after.body, "GBrain post-sync status");
    expect(["healthy", "degraded"]).toContain(afterBody["state"]);
    expect(afterBody["backend"]).toBe("gbrain");
    const indexed = jsonRecord(afterBody["indexed"], "GBrain indexed counts");
    expect(indexed["sources"]).toEqual(expect.any(Number));
    expect(indexed["sources"] as number).toBeGreaterThanOrEqual(1);
    const syncStatus = jsonRecord(afterBody["sync"], "GBrain durable sync status");
    expect(syncStatus["status"]).toBe("synced");

    const healthResponse = await fetch(new URL("/health", gbrainEndpoint), {
      signal: AbortSignal.timeout(10_000),
    });
    expect(healthResponse.status).toBe(200);
    const health = jsonRecord(await healthResponse.json(), "GBrain direct health");
    expect(health["ready"]).toBe(true);
    expect(health["backend"]).toBe("gbrain");
    qa.diagnostics.assertNoFatal("real hot GBrain cold start");

    const shutdown = await qa.shutdown({ assertPortsReleased: true, timeoutMs: UI_TIMEOUT_MS });
    expect(shutdown.exitCode).toBe(0);
    expect(shutdown.signalCode).toBeNull();
    await waitForPortsReleased([gbrainPort], PORT_RELEASE_TIMEOUT_MS);
    await testInfo.attach("gbrain-hot-diagnostics", {
      path: qa.diagnostics.eventLogPath,
      contentType: "application/x-ndjson",
    });
    completed = true;
  } catch (error) {
    qa.markFailed();
    throw error;
  } finally {
    if (!completed) qa.markFailed();
    try {
      await qa.teardown();
    } finally {
      if (gbrainPort !== null) {
        await waitForPortsReleased([gbrainPort], PORT_RELEASE_TIMEOUT_MS);
      }
    }
  }
});

async function sameOriginJson(
  page: Page,
  request: SameOriginJsonRequest,
): Promise<JsonResponse> {
  return page.evaluate(async ({ path, method, body, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("Bounded GBrain smoke request timed out", "TimeoutError")),
      timeoutMs,
    );
    try {
      const response = await fetch(path, {
        method,
        cache: "no-store",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return { status: response.status, body: await response.json() as unknown };
    } finally {
      clearTimeout(timer);
    }
  }, request);
}

function requiredLoopbackEndpoint(value: string | undefined, label: string): URL {
  if (!value) throw new Error(`${label} endpoint was not published`);
  const endpoint = new URL(value);
  const port = Number(endpoint.port);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(`${label} endpoint is not bounded loopback HTTP`);
  }
  return endpoint;
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not a JSON object`);
  }
  return value as Record<string, unknown>;
}
