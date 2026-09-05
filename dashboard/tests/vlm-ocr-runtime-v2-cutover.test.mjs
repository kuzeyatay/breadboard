import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import { loadVlmOcrConfig } from "../src/lib/vlm-ocr/config.ts";
import {
  ensureVlmOcrServer,
  vlmOcrRuntimeManaged,
  vlmOcrStatus,
} from "../src/lib/vlm-ocr/server.ts";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(dashboardRoot, "..");
const routeStateKey = "__breadboardVlmRouteCutoverTest";

function source(...segments) {
  return fs.readFileSync(path.join(repositoryRoot, ...segments), "utf8");
}

async function loadRouteModule() {
  const result = await esbuild.build({
    bundle: true,
    entryPoints: [
      path.join(
        dashboardRoot,
        "src",
        "app",
        "api",
        "vlm-ocr",
        "status",
        "route.ts",
      ),
    ],
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "vlm-ocr-route-stubs",
        setup(build) {
          const stubs = new Map([
            ["next/server", "next-server"],
            ["@/lib/vlm-ocr/config", "config"],
            ["@/lib/vlm-ocr/server", "server"],
            ["@/lib/server-auth", "auth"],
            ["@/lib/supervisor-control", "supervisor"],
          ]);
          build.onResolve({ filter: /.*/ }, (args) => {
            const stub = stubs.get(args.path);
            return stub
              ? { path: stub, namespace: "vlm-ocr-route-stub" }
              : undefined;
          });
          build.onLoad(
            { filter: /.*/, namespace: "vlm-ocr-route-stub" },
            (args) => {
              if (args.path === "next-server") {
                return {
                  loader: "js",
                  contents: `
                    export const NextResponse = {
                      json(value, init = {}) {
                        const headers = new Headers(init.headers);
                        headers.set("Content-Type", "application/json");
                        return new Response(JSON.stringify(value), { ...init, headers });
                      }
                    };
                  `,
                };
              }
              if (args.path === "config") {
                return {
                  loader: "js",
                  contents:
                    "export function getVlmOcrConfig() { return { enabled: true }; }",
                };
              }
              if (args.path === "server") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis.__breadboardVlmRouteCutoverTest;
                    export async function vlmOcrStatus() {
                      state().events.push({ type: "probe" });
                      return state().status;
                    }
                  `,
                };
              }
              if (args.path === "auth") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis.__breadboardVlmRouteCutoverTest;
                    export async function requireUserId() {
                      state().events.push({ type: "auth" });
                      return "user-test";
                    }
                    export function routeErrorResponse(error) {
                      return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers: { "Content-Type": "application/json" }
                      });
                    }
                  `,
                };
              }
              return {
                loader: "js",
                contents: `
                  const state = () => globalThis.__breadboardVlmRouteCutoverTest;
                  export async function readSupervisedServiceSnapshot(serviceId) {
                    state().events.push({ type: "snapshot", serviceId });
                    return state().service;
                  }
                `,
              };
            },
          );
        },
      },
    ],
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64") +
      "#vlm-ocr-route"
  );
}

const route = await loadRouteModule();

function freshRouteState({ managed, ok, service = null }) {
  const state = {
    events: [],
    service,
    status: {
      enabled: true,
      ok,
      models: ok ? ["hunyuan-ocr"] : [],
      detail: ok ? undefined : "not reachable",
      baseUrl: "http://127.0.0.1:8077/v1",
      source: "ggml-org/HunyuanOCR-GGUF:Q8_0",
      managed,
      autoStart: managed,
    },
  };
  globalThis[routeStateKey] = state;
  return state;
}

function unavailableFetch() {
  return Promise.reject(new Error("not reachable"));
}

test("the VLM ownership marker is closed and status never invents dashboard ownership", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  globalThis.fetch = unavailableFetch;

  assert.equal(vlmOcrRuntimeManaged({ VLM_OCR_RUNTIME_MANAGED: "1" }), true);
  assert.equal(
    vlmOcrRuntimeManaged({ VLM_OCR_RUNTIME_MANAGED: "true" }),
    false,
  );
  assert.equal(vlmOcrRuntimeManaged({}), false);

  const managed = await vlmOcrStatus(loadVlmOcrConfig({}), {
    VLM_OCR_RUNTIME_MANAGED: "1",
  });
  assert.equal(managed.managed, true);
  assert.equal(managed.autoStart, true);

  const external = await vlmOcrStatus(loadVlmOcrConfig({}), {});
  assert.equal(external.managed, false);
  assert.equal(external.autoStart, false);
});

test("a managed worker only waits for its pre-acquired Runtime endpoint", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  let probes = 0;
  globalThis.fetch = async () => {
    probes += 1;
    if (probes === 1) throw new Error("readiness race");
    return new Response(JSON.stringify({ data: [{ id: "hunyuan-ocr" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const progress = [];
  const config = {
    ...loadVlmOcrConfig({}),
    startupTimeoutMs: 10,
  };

  await ensureVlmOcrServer(config, (step) => progress.push(step), {
    VLM_OCR_RUNTIME_MANAGED: "1",
  });

  assert.equal(probes, 2);
  assert.deepEqual(progress, [
    "Waiting for the local OCR model server…",
    "Local OCR model server is ready.",
  ]);
});

test("a managed worker honors the configured timeout during a slow supervised restart", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousSetTimeout = globalThis.setTimeout;
  const previousNow = Date.now;
  t.after(() => {
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
    Date.now = previousNow;
  });

  let now = 1_000_000;
  let probes = 0;
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    // Readiness polling waits for at most 500 ms. Fetch's independent 2.5 s
    // safety timer must remain pending because the fake fetch settles itself.
    if (milliseconds <= 500) {
      now += milliseconds;
      queueMicrotask(() => callback(...args));
    }
    return 0;
  };
  Date.now = () => now;
  globalThis.fetch = async () => {
    probes += 1;
    if (probes <= 65) throw new Error("replacement still loading");
    return new Response(JSON.stringify({ data: [{ id: "hunyuan-ocr" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await ensureVlmOcrServer(
    { ...loadVlmOcrConfig({}), startupTimeoutMs: 40_000 },
    undefined,
    { VLM_OCR_RUNTIME_MANAGED: "1" },
  );

  assert.equal(probes, 66);
  assert.ok(now - 1_000_000 > 30_000, "recovery continued beyond the old 30 s cap");
});

test("an unavailable external or manual endpoint fails without local fallback", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  globalThis.fetch = unavailableFetch;
  const config = loadVlmOcrConfig({
    VLM_OCR_BASE_URL: "http://gpu-box.lan:8077/v1",
  });

  await assert.rejects(ensureVlmOcrServer(config, undefined, {}), (error) => {
    assert.equal(error?.name, "VlmOcrUnavailableError");
    assert.match(error.message, /configured external OCR endpoint/u);
    return true;
  });
});

test("status polling keeps a stopped managed service selectable without starting it", async () => {
  const state = freshRouteState({
    managed: true,
    ok: false,
    service: { id: "vlm-ocr", state: "available-but-stopped" },
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.available, true);
  assert.equal(body.running, false);
  assert.equal(body.managed, true);
  assert.equal(body.autoStart, true);
  assert.equal(body.serviceState, "available-but-stopped");
  assert.deepEqual(state.events, [
    { type: "auth" },
    { type: "probe" },
    { type: "snapshot", serviceId: "vlm-ocr" },
  ]);
});

test("installation-unavailable and external status remain truthful", async () => {
  freshRouteState({
    managed: true,
    ok: false,
    service: { id: "vlm-ocr", state: "installation-unavailable" },
  });
  const unavailable = await (await route.GET()).json();
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.autoStart, false);

  const externalState = freshRouteState({ managed: false, ok: false });
  const external = await (await route.GET()).json();
  assert.equal(external.available, false);
  assert.equal(external.autoStart, false);
  assert.equal(
    externalState.events.some((event) => event.type === "snapshot"),
    false,
  );
});

test("the dashboard and disposable worker contain no VLM process-owner fallback", () => {
  const server = source("dashboard", "src", "lib", "vlm-ocr", "server.ts");
  const routeSource = source(
    "dashboard",
    "src",
    "app",
    "api",
    "vlm-ocr",
    "status",
    "route.ts",
  );
  const worker = source(
    "dashboard",
    "scripts",
    "runtime-v2-document-ingestion-worker.mjs",
  );

  assert.doesNotMatch(
    server,
    /(?:node:)?child_process|\bspawn(?:Sync)?\s*\(|\bexec(?:File)?\s*\(|\.kill\s*\(/u,
  );
  assert.doesNotMatch(
    server,
    /acquireServiceLease|releaseSupervisorLease|BREADBOARD_RUNTIME_CONTROL_TOKEN/u,
  );
  assert.match(routeSource, /readSupervisedServiceSnapshot\("vlm-ocr"\)/u);
  assert.doesNotMatch(
    routeSource,
    /acquireServiceLease|withServiceLease|ensureVlmOcrServer/u,
  );
  assert.match(worker, /VLM_OCR_AUTO_START = "0"/u);
  assert.match(server, /VLM_OCR_RUNTIME_MANAGED/u);
});
