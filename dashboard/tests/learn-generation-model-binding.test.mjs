import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (...parts) =>
  fs.readFileSync(path.join(dashboardRoot, ...parts), "utf8");
const routeSource = read(
  "src",
  "app",
  "api",
  "gardens",
  "[gardenId]",
  "learn",
  "generate",
  "route.ts",
);
const learnSource = read("src", "lib", "learn.ts");
const learnStatusProjectionSource = read(
  "src",
  "lib",
  "learn-status-projection.ts",
);
const executorSource = read("src", "lib", "learn-operation-executor.ts");
const backgroundSource = read("src", "lib", "learn-background.ts");
const workerSource = read("scripts", "runtime-v2-learn-worker.mjs");
const workspaceSource = read(
  "src",
  "app",
  "gardens",
  "[clusterSlug]",
  "workspace-client.tsx",
);
const assistantSource = read("src", "app", "garden", "garden-assistant.tsx");

const ROUTE_STATE_KEY = "__breadboardLearnGenerateModelRouteTestState";

async function loadGenerateRoute() {
  const entryPoint = path.join(
    dashboardRoot,
    "src",
    "app",
    "api",
    "gardens",
    "[gardenId]",
    "learn",
    "generate",
    "route.ts",
  );
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "learn-generate-model-route-stubs",
        setup(build) {
          build.onResolve({ filter: /^@\/lib\/learn-route-errors$/ }, () => ({
            path: path.join(dashboardRoot, "src", "lib", "learn-route-errors.ts"),
          }));
          for (const [filter, stubPath] of [
            [/^next\/server$/, "next-server"],
            [/^@\/lib\/chatmock-server$/, "chatmock-server"],
            [/^breadboard-learn-operation-runtime$/, "learn-runtime"],
            [/^@\/lib\/server-auth$/, "server-auth"],
            [/^@\/lib\/selected-model$/, "selected-model"],
          ]) {
            build.onResolve({ filter }, () => ({
              path: stubPath,
              namespace: "learn-generate-model-route-stub",
            }));
          }
          build.onLoad(
            { filter: /.*/, namespace: "learn-generate-model-route-stub" },
            (args) => {
              if (args.path === "next-server") {
                return {
                  loader: "js",
                  contents: `
                    export class NextResponse extends Response {
                      static json(value, init = {}) {
                        const headers = new Headers(init.headers);
                        if (!headers.has("content-type")) headers.set("content-type", "application/json");
                        return new NextResponse(JSON.stringify(value), { ...init, headers });
                      }
                    }
                  `,
                };
              }
              if (args.path === "chatmock-server") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(ROUTE_STATE_KEY)}];
                    export function resolveChatmockBaseUrl() {
                      state().baseUrlCalls += 1;
                      return { baseURL: "http://chatmock.test/v1" };
                    }
                  `,
                };
              }
              if (args.path === "learn-runtime") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(ROUTE_STATE_KEY)}];
                    export async function executeLearnOperationForRoute(request, label) {
                      state().operationCalls.push({ request: structuredClone(request), label });
                      return { accepted: true, jobId: "generation-job" };
                    }
                  `,
                };
              }
              if (args.path === "server-auth") {
                return {
                  loader: "js",
                  contents: `
                    export async function requireOwnedClusterFromSlug() {
                      return { userId: 17, cluster: { slug: "canonical-garden" } };
                    }
                    export function routeErrorResponse(error) {
                      return Response.json({ error: error?.message ?? "Internal error" }, { status: 500 });
                    }
                  `,
                };
              }
              return {
                loader: "js",
                contents: `
                  const state = () => globalThis[${JSON.stringify(ROUTE_STATE_KEY)}];
                  export function selectedModelForUser(userId) {
                    state().modelCalls.push(userId);
                    return state().selectedModel;
                  }
                `,
              };
            },
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#learn-generate-model-route`);
}

const generateRoute = await loadGenerateRoute();

function freshState(selectedModel = "model-planned") {
  const state = {
    selectedModel,
    modelCalls: [],
    baseUrlCalls: 0,
    operationCalls: [],
  };
  globalThis[ROUTE_STATE_KEY] = state;
  return state;
}

async function post(body) {
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = "C:\\trusted\\quartz\\content";
  try {
    return await generateRoute.POST(
      new Request("http://local/learn/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ gardenId: "requested-garden" }) },
    );
  } finally {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
  }
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `expected ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `expected ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

describe("confirmed Learning Map model binding", () => {
  test("the exact map and planning-model token cross the generation route", async () => {
    const state = freshState();
    const response = await post({
      confirmedLearningMapId: " map-confirmed ",
      expectedModel: "model-planned",
      includedSourceIds: ["source-a"],
      sourceOnly: true,
      includeSourceSnapshots: false,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      success: true,
      accepted: true,
      jobId: "generation-job",
    });
    assert.deepEqual(state.modelCalls, [17]);
    assert.equal(state.baseUrlCalls, 1);
    assert.deepEqual(state.operationCalls, [
      {
        label: "generation for canonical-garden",
        request: {
          operation: "generate",
          gardenId: "canonical-garden",
          userId: 17,
          contentPath: "C:\\trusted\\quartz\\content",
          baseURL: "http://chatmock.test/v1",
          model: "model-planned",
          expectedModel: "model-planned",
          requestedConfirmedLearningMapId: "map-confirmed",
          includedSourceIds: ["source-a"],
          sourceOnly: true,
          includeSourceSnapshots: false,
        },
      },
    ]);
  });

  test("selected-model drift requests replanning before dispatch or base-URL work", async () => {
    const state = freshState("model-current");
    const response = await post({
      confirmedLearningMapId: "map-confirmed",
      expectedModel: "model-planned",
    });

    assert.equal(response.status, 409);
    const data = await response.json();
    assert.match(data.error, /selected Learn model changed/);
    assert.equal(data.requiresReplan, true);
    assert.deepEqual(state.operationCalls, []);
    assert.equal(state.baseUrlCalls, 0);
  });

  test("missing map or model tokens fail closed with 400 before dispatch", async () => {
    for (const body of [
      { expectedModel: "model-planned" },
      { confirmedLearningMapId: "map-confirmed" },
    ]) {
      const state = freshState();
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.deepEqual(state.operationCalls, []);
      assert.equal(state.baseUrlCalls, 0);
    }
  });

  test("status and both UI callers use the confirmed map owner's model", () => {
    assert.match(learnSource, /confirmedLearningMapModel\?: string/);
    assert.match(
      learnStatusProjectionSource,
      /const confirmedMapPlanningJob = confirmedMap[\s\S]*?learnMapPlanningJob\(confirmedMap, gardenId\)[\s\S]*?confirmedLearningMapModel: confirmedMapPlanningJob\?\.model/,
    );
    assert.match(
      learnSource,
      /planningJob\?\.gardenId === gardenId &&[\s\S]*?planningJob\.proposedLearningMapId === map\.id/,
    );

    const workspaceHandler = sourceBetween(
      workspaceSource,
      "async function handleLearnPrimary()",
      "async function handleConfirmAndGenerate()",
    );
    assert.match(
      workspaceHandler,
      /expectedModel = learnState\.confirmedLearningMapModel\?\.trim\(\)/,
    );
    assert.match(
      workspaceHandler,
      /postLearnAction\("generate",\s*\{\s*confirmedLearningMapId: learnState\.confirmedLearningMapId,\s*expectedModel,/s,
    );
    assert.match(assistantSource, /confirmedLearningMapModel\?: string/);
    assert.match(
      assistantSource,
      /endpoint === 'generate'[\s\S]*?confirmedLearningMapId: learnState\.confirmedLearningMapId,[\s\S]*?expectedModel: confirmedLearningMapModel/,
    );
  });

  test("worker, executor, and core generation all reject model drift before job creation", () => {
    assert.match(
      backgroundSource,
      /operation: "generate";\s*expectedModel: string;\s*requestedConfirmedLearningMapId: string;/,
    );
    assert.match(
      workerSource,
      /case "generate":[\s\S]*?value\.model !== value\.expectedModel\.trim\(\)[\s\S]*?typeof value\.requestedConfirmedLearningMapId !== "string"/,
    );
    const executor = sourceBetween(
      executorSource,
      'case "generate"',
      'case "confirm"',
    );
    assert.match(
      executor,
      /request\.requestedConfirmedLearningMapId !==[\s\S]*?status\.confirmedLearningMapId/,
    );
    assert.match(
      executor,
      /request\.expectedModel !== status\.confirmedLearningMapModel[\s\S]*?request\.model !== request\.expectedModel/,
    );
    assert.ok(
      executor.indexOf("request.expectedModel !== status.confirmedLearningMapModel") <
        executor.indexOf("return runTextbookGeneration"),
      "the durable model binding must be checked before generation begins",
    );

    const generation = sourceBetween(
      learnSource,
      "export async function runTextbookGeneration",
      "function mergeLearnEventLedgers",
    );
    const ownerGuard = generation.indexOf(
      "requireLearnMapPlanningModel(requestedMap, gardenId, model)",
    );
    const leaseAcquisition = generation.indexOf("acquireGardenLearnLease");
    const reconciliation = generation.indexOf(
      "reconcileSupersededAwaitingLearnJobs(gardenId)",
    );
    const jobCreation = generation.indexOf("createLearnJob({");
    assert.ok(ownerGuard >= 0, "expected an exact-map owner-model guard");
    assert.ok(
      leaseAcquisition > ownerGuard,
      "model drift must be rejected before generation state is acquired",
    );
    assert.ok(
      reconciliation > ownerGuard,
      "model drift must be rejected before old workflow rows are reconciled",
    );
    assert.ok(
      jobCreation > ownerGuard,
      "the owner-model guard must run before a generation job is created",
    );
    assert.match(
      generation,
      /const workflowJob = workflowMap[\s\S]*?requireLearnMapPlanningModel\(workflowMap, gardenId, model\)/,
      "the binding must be rechecked after lease acquisition",
    );
    const routeModelGuard = routeSource.indexOf(
      "const expectedModel = requireExpectedLearnModel(body, model, {",
    );
    const routeClientResolution = routeSource.indexOf(
      "resolveChatmockBaseUrl(request)",
      routeModelGuard,
    );
    assert.ok(
      routeModelGuard >= 0 && routeClientResolution > routeModelGuard,
      "the admitted generation path must reject model drift before constructing its model client",
    );
  });

  test("the route keeps malformed-token 400 and drift 409 handling explicit", () => {
    const selectedModelGuard = routeSource.indexOf(
      "const expectedModel = requireExpectedLearnModel(body, model, {",
    );
    const dispatch = routeSource.indexOf("executeLearnOperationForRoute", selectedModelGuard);
    assert.ok(selectedModelGuard >= 0);
    assert.ok(dispatch > selectedModelGuard);
    assert.match(
      routeSource,
      /requireExpectedLearnModel\(body, model, \{\s*requiresReplanOnConflict: true,\s*\}\)/,
    );
    assert.match(
      routeSource,
      /error instanceof InvalidLearnRouteBodyError[\s\S]*?status: 400/,
    );
    assert.match(routeSource, /isLearnRouteConflict\(error\)[\s\S]*?status: 409/);
  });
});
