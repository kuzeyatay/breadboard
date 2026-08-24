import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";

import esbuild from "esbuild";

const STATE_KEY = "__breadboardLearnEndpointSecurityTestState";

async function loadRoute(relativePath) {
  const entryPoint = fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "learn-endpoint-security-stubs",
        setup(build) {
          build.onResolve({ filter: /^next\/server$/ }, () => ({
            path: "next/server",
            namespace: "learn-security-stub",
          }));
          build.onResolve({ filter: /^@\/lib\/server-auth$/ }, () => ({
            path: "server-auth",
            namespace: "learn-security-stub",
          }));
          build.onResolve({ filter: /^@\/lib\/learn$/ }, () => ({
            path: "learn",
            namespace: "learn-security-stub",
          }));
          build.onResolve(
            { filter: /^breadboard-learn-status-runtime$/ },
            () => ({
              path: "learn-status-runtime",
              namespace: "learn-security-stub",
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: "learn-security-stub" },
            (args) => {
              if (args.path === "next/server") {
                return {
                  loader: "js",
                  contents: `
                    export class NextResponse extends Response {
                      static json(value, init = {}) {
                        const headers = new Headers(init.headers);
                        if (!headers.has("content-type")) {
                          headers.set("content-type", "application/json");
                        }
                        return new NextResponse(JSON.stringify(value), { ...init, headers });
                      }
                    }
                  `,
                };
              }
              if (args.path === "server-auth") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(STATE_KEY)}];
                    export async function requireOwnedClusterFromSlug(slug) {
                      state().authCalls.push({ policy: "owned", slug });
                      if (state().denyOwner) {
                        throw Object.assign(new Error("Cluster not found"), { status: 404 });
                      }
                      return { userId: 7, cluster: { slug: state().canonicalSlug } };
                    }
                    export async function requireReadableClusterFromSlug(slug) {
                      state().authCalls.push({ policy: "readable", slug });
                      return { userId: 7, cluster: { slug: "public-garden" } };
                    }
                    export function routeErrorResponse(error) {
                      return Response.json(
                        { error: error instanceof Error ? error.message : "Internal server error" },
                        { status: Number(error?.status) || 500 },
                      );
                    }
                  `,
                };
              }
              if (args.path === "learn-status-runtime") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(STATE_KEY)}];
                    export async function getLearnStatusSnapshotForRoute(input) {
                      state().learnCalls.push({ operation: "status", input });
                      return { phase: "idle" };
                    }
                  `,
                };
              }
              return {
                loader: "js",
                contents: `
                  const state = () => globalThis[${JSON.stringify(STATE_KEY)}];
                  export function getLearnValidationReport(input) {
                    state().learnCalls.push({ operation: "report", input });
                    return state().report;
                  }
                `,
              };
            },
          );
        },
      },
    ],
  });

  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${encodeURIComponent(relativePath)}`);
}

const statusRoute = await loadRoute(
  "src/app/api/gardens/[gardenId]/learn/status/route.ts",
);
const reportRoute = await loadRoute(
  "src/app/api/gardens/[gardenId]/learn/validation-report/route.ts",
);

function freshState(overrides = {}) {
  const state = {
    authCalls: [],
    learnCalls: [],
    denyOwner: false,
    canonicalSlug: "canonical-owned-garden",
    report: { markdown: "# Private validation details" },
    ...overrides,
  };
  globalThis[STATE_KEY] = state;
  return state;
}

async function withContentPath(callback) {
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = "C:\\trusted\\quartz\\content";
  try {
    await callback();
  } finally {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
  }
}

test("Learn status rejects a non-owner before reading internal pipeline state", async () => {
  await withContentPath(async () => {
    const state = freshState({ denyOwner: true });
    const response = await statusRoute.GET(new Request("http://local/status"), {
      params: Promise.resolve({ gardenId: "public-garden" }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(state.authCalls, [
      { policy: "owned", slug: "public-garden" },
    ]);
    assert.deepEqual(state.learnCalls, []);
  });
});

test("Learn validation report rejects a non-owner before reading the report", async () => {
  await withContentPath(async () => {
    const state = freshState({ denyOwner: true });
    const response = await reportRoute.GET(new Request("http://local/report"), {
      params: Promise.resolve({ gardenId: "public-garden" }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(state.authCalls, [
      { policy: "owned", slug: "public-garden" },
    ]);
    assert.deepEqual(state.learnCalls, []);
  });
});

test("Learn status uses the authorized canonical garden slug", async () => {
  await withContentPath(async () => {
    const state = freshState();
    const response = await statusRoute.GET(new Request("http://local/status"), {
      params: Promise.resolve({ gardenId: "requested-slug" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, phase: "idle" });
    assert.deepEqual(state.learnCalls, [
      {
        operation: "status",
        input: {
          gardenId: "canonical-owned-garden",
          contentPath: "C:\\trusted\\quartz\\content",
        },
      },
    ]);
  });
});

test("Learn validation report remains a private no-store response", async () => {
  await withContentPath(async () => {
    const state = freshState();
    const response = await reportRoute.GET(new Request("http://local/report"), {
      params: Promise.resolve({ gardenId: "requested-slug" }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "# Private validation details");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/i);
    assert.equal(state.learnCalls[0].input.gardenId, "canonical-owned-garden");
    assert.equal(state.learnCalls[0].input.maxChars, Number.MAX_SAFE_INTEGER);
  });
});
