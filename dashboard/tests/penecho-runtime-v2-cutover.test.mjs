import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(dashboardRoot, "..");
const leaseStateKey = "__breadboardPenechoCutoverTest";
const routeStateKey = "__breadboardPenechoRouteCutoverTest";

function source(...segments) {
  return fs.readFileSync(path.join(repositoryRoot, ...segments), "utf8");
}

async function importBundle(build, suffix) {
  const result = await esbuild.build({
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    ...build,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${suffix}`
  );
}

async function loadViewLeaseModule() {
  return importBundle(
    {
      entryPoints: [
        path.join(dashboardRoot, "src", "lib", "penecho", "view-lease.ts"),
      ],
      plugins: [
        {
          name: "penecho-view-lease-stubs",
          setup(build) {
            build.onResolve({ filter: /^server-only$/ }, () => ({
              path: "server-only",
              namespace: "penecho-view-stub",
            }));
            build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
              path: "supervisor-control",
              namespace: "penecho-view-stub",
            }));
            build.onResolve({ filter: /^\.\/service\.ts$/ }, () => ({
              path: "penecho-service",
              namespace: "penecho-view-stub",
            }));
            build.onLoad(
              { filter: /.*/, namespace: "penecho-view-stub" },
              (args) => {
                if (args.path === "server-only")
                  return { loader: "js", contents: "" };
                if (args.path === "penecho-service") {
                  return {
                    loader: "js",
                    contents: `
                    const state = () => globalThis[${JSON.stringify(leaseStateKey)}];
                    export function penechoRuntimeManaged() { return state().managed; }
                    export async function ensurePenechoService() {
                      state().events.push({ type: "ensure" });
                      if (state().serviceError) throw state().serviceError;
                      return { baseUrl: "http://127.0.0.1:8092", managed: state().managed, startedAt: 1 };
                    }
                  `,
                  };
                }
                return {
                  loader: "js",
                  contents: `
                  const state = () => globalThis[${JSON.stringify(leaseStateKey)}];
                  export async function acquireServiceLease(serviceId, reason) {
                    state().events.push({ type: "acquire", serviceId, reason });
                    const id = "lease-" + (++state().nextLease);
                    return { id, targetId: serviceId };
                  }
                  export async function releaseSupervisorLease(lease) {
                    if (lease) state().events.push({ type: "release", id: lease.id });
                  }
                `,
                };
              },
            );
          },
        },
      ],
    },
    "penecho-view-lease",
  );
}

async function loadRouteModule() {
  return importBundle(
    {
      entryPoints: [
        path.join(
          dashboardRoot,
          "src",
          "app",
          "api",
          "penecho",
          "status",
          "route.ts",
        ),
      ],
      plugins: [
        {
          name: "penecho-route-stubs",
          setup(build) {
            build.onResolve({ filter: /^next\/server$/ }, () => ({
              path: "next-server",
              namespace: "penecho-route-stub",
            }));
            build.onResolve({ filter: /^@\/lib\/penecho\/service$/ }, () => ({
              path: "penecho-service",
              namespace: "penecho-route-stub",
            }));
            build.onResolve(
              { filter: /^@\/lib\/penecho\/view-lease$/ },
              () => ({
                path: "penecho-view-lease",
                namespace: "penecho-route-stub",
              }),
            );
            build.onLoad(
              { filter: /.*/, namespace: "penecho-route-stub" },
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
                if (args.path === "penecho-service") {
                  return {
                    loader: "js",
                    contents: `
                    const state = () => globalThis[${JSON.stringify(routeStateKey)}];
                    export function embedOrigins() { return state().origins; }
                    export function penechoCorsHeaders(origin) {
                      return {
                        "Access-Control-Allow-Origin": state().origins.includes(origin) ? origin : state().origins[0],
                        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type",
                        "Vary": "Origin"
                      };
                    }
                    export async function penechoServiceStatus() {
                      return { running: false, baseUrl: "http://127.0.0.1:8092", available: true };
                    }
                  `,
                  };
                }
                return {
                  loader: "js",
                  contents: `
                  const state = () => globalThis[${JSON.stringify(routeStateKey)}];
                  export async function renewPenechoViewLease(origin, viewId) {
                    state().events.push({ type: "renew", origin, viewId });
                    return {
                      expiresInMs: 70000,
                      service: { baseUrl: "http://127.0.0.1:8092", managed: true, startedAt: 1 }
                    };
                  }
                  export async function releasePenechoViewLease(origin, viewId) {
                    state().events.push({ type: "release", origin, viewId });
                  }
                `,
                };
              },
            );
          },
        },
      ],
    },
    "penecho-route",
  );
}

const viewLease = await loadViewLeaseModule();
const route = await loadRouteModule();

function freshLeaseState({ managed = true } = {}) {
  delete globalThis.__breadboardPenechoViewLeaseState;
  const value = { events: [], managed, nextLease: 0, serviceError: null };
  globalThis[leaseStateKey] = value;
  return value;
}

function freshRouteState() {
  const value = { events: [], origins: ["http://127.0.0.1:8081"] };
  globalThis[routeStateKey] = value;
  return value;
}

function request(method, body, origin = "http://127.0.0.1:8081") {
  return new Request("http://127.0.0.1:3000/api/penecho/status", {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    ...(body === undefined ? {} : { body }),
  });
}

test("PenEcho view holds single-flight startup and keep native lease IDs server-side", async () => {
  const state = freshLeaseState();
  const viewId = "123e4567-e89b-42d3-a456-426614174000";
  const [first, second] = await Promise.all([
    viewLease.renewPenechoViewLease("http://127.0.0.1:8081", viewId),
    viewLease.renewPenechoViewLease("http://127.0.0.1:8081", viewId),
  ]);

  assert.equal(first.expiresInMs, viewLease.PENECHO_VIEW_HOLD_TTL_MS);
  assert.deepEqual(second, first);
  assert.equal(Object.hasOwn(first, "leaseId"), false);
  assert.equal(
    state.events.filter((event) => event.type === "acquire").length,
    1,
  );
  assert.equal(
    state.events.filter((event) => event.type === "ensure").length,
    1,
  );

  await viewLease.releasePenechoViewLease("http://127.0.0.1:8081", viewId);
  assert.deepEqual(state.events.at(-1), { type: "release", id: "lease-1" });
});

test("PenEcho lease rotation acquires replacement authority before releasing the old hold", async () => {
  const state = freshLeaseState();
  const viewId = "223e4567-e89b-42d3-a456-426614174000";
  const startedAt = Date.now();
  await viewLease.renewPenechoViewLease("local", viewId, startedAt);
  for (const elapsed of [60_000, 120_000, 180_000, 240_000]) {
    await viewLease.renewPenechoViewLease("local", viewId, startedAt + elapsed);
  }
  await viewLease.renewPenechoViewLease(
    "local",
    viewId,
    startedAt + viewLease.PENECHO_VIEW_LEASE_ROTATION_MS + 1,
  );

  assert.deepEqual(
    state.events.filter((event) => event.type !== "ensure").slice(0, 3),
    [
      {
        type: "acquire",
        serviceId: "penecho",
        reason: "active-whiteboard-view",
      },
      {
        type: "acquire",
        serviceId: "penecho",
        reason: "active-whiteboard-view",
      },
      { type: "release", id: "lease-1" },
    ],
  );
  await viewLease.releasePenechoViewLease("local", viewId);
  assert.deepEqual(state.events.at(-1), { type: "release", id: "lease-2" });
});

test("an explicitly external PenEcho endpoint never acquires native process authority", async () => {
  const state = freshLeaseState({ managed: false });
  const viewId = "323e4567-e89b-42d3-a456-426614174000";
  const hold = await viewLease.renewPenechoViewLease("local", viewId);
  assert.equal(hold.service.managed, false);
  assert.equal(
    state.events.some((event) => event.type === "acquire"),
    false,
  );
  await viewLease.releasePenechoViewLease("local", viewId);
  assert.equal(
    state.events.some((event) => event.type === "release"),
    false,
  );
});

test("PenEcho route validates origin, UUID and body bounds without exposing control authority", async () => {
  const state = freshRouteState();
  const viewId = "423e4567-e89b-42d3-a456-426614174000";

  const forbidden = await route.POST(
    request("POST", JSON.stringify({ viewId }), "https://attacker.invalid"),
  );
  assert.equal(forbidden.status, 403);
  assert.equal(state.events.length, 0);

  const malformed = await route.POST(
    request("POST", JSON.stringify({ viewId: "bad" })),
  );
  assert.equal(malformed.status, 400);
  assert.equal(state.events.length, 0);

  const oversized = await route.POST(
    request("POST", JSON.stringify({ padding: "x".repeat(300) })),
  );
  assert.equal(oversized.status, 413);
  assert.equal(state.events.length, 0);

  const acquired = await route.POST(
    request("POST", JSON.stringify({ viewId })),
  );
  assert.equal(acquired.status, 200);
  const acquiredBody = await acquired.json();
  assert.equal(acquiredBody.viewId, viewId);
  assert.equal(acquiredBody.expiresInMs, 70_000);
  assert.equal(Object.hasOwn(acquiredBody, "leaseId"), false);
  assert.deepEqual(state.events.at(-1), {
    type: "renew",
    origin: "http://127.0.0.1:8081",
    viewId,
  });

  const released = await route.DELETE(
    request("DELETE", JSON.stringify({ viewId })),
  );
  assert.equal(released.status, 200);
  assert.deepEqual(state.events.at(-1), {
    type: "release",
    origin: "http://127.0.0.1:8081",
    viewId,
  });
});

test("legacy Quartz pages receive only one bounded generated hold", async () => {
  const state = freshRouteState();
  const response = await route.POST(request("POST", "{}"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(
    body.viewId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(state.events.length, 1);
});

test("PenEcho status is observational and Quartz cards heartbeat then release on teardown", async () => {
  const state = freshRouteState();
  const status = await route.GET(request("GET"));
  assert.equal(status.status, 200);
  assert.equal(state.events.length, 0);

  const service = source("dashboard", "src", "lib", "penecho", "service.ts");
  const viewManager = source(
    "dashboard",
    "src",
    "lib",
    "penecho",
    "view-lease.ts",
  );
  const routeSource = source(
    "dashboard",
    "src",
    "app",
    "api",
    "penecho",
    "status",
    "route.ts",
  );
  const card = source(
    "quartz",
    "quartz",
    "components",
    "scripts",
    "penechoBoard.inline.ts",
  );

  assert.doesNotMatch(service, /node:child_process|\bspawn\s*\(|\.kill\s*\(/);
  assert.match(service, /readSupervisedServiceSnapshot\("penecho"\)/);
  assert.match(
    viewManager,
    /acquireServiceLease\("penecho", "active-whiteboard-view"\)/,
  );
  assert.doesNotMatch(routeSource, /leaseId|CONTROL_TOKEN|CONTROL_URL/);
  assert.match(card, /crypto\.randomUUID\(\)/);
  assert.match(card, /window\.setInterval[\s\S]*VIEW_HEARTBEAT_MS/);
  assert.match(card, /method: "DELETE"[\s\S]*keepalive: true/);
  assert.match(card, /disposeActiveBoards\(\)[\s\S]*querySelectorAll/);
  assert.match(card, /document\.removeEventListener\("keydown", onKeyDown\)/);
});
