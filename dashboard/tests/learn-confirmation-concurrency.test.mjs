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

const workspaceSource = fs.readFileSync(
  path.join(
    dashboardRoot,
    "src",
    "app",
    "gardens",
    "[clusterSlug]",
    "workspace-client.tsx",
  ),
  "utf8",
);
const confirmRouteSource = fs.readFileSync(
  path.join(
    dashboardRoot,
    "src",
    "app",
    "api",
    "gardens",
    "[gardenId]",
    "learn",
    "confirm",
    "route.ts",
  ),
  "utf8",
);
const learnSource = fs.readFileSync(
  path.join(dashboardRoot, "src", "lib", "learn.ts"),
  "utf8",
);
const operationExecutorSource = fs.readFileSync(
  path.join(dashboardRoot, "src", "lib", "learn-operation-executor.ts"),
  "utf8",
);
const learnBackgroundSource = fs.readFileSync(
  path.join(dashboardRoot, "src", "lib", "learn-background.ts"),
  "utf8",
);
const learnWorkerSource = fs.readFileSync(
  path.join(dashboardRoot, "scripts", "learn-worker.mjs"),
  "utf8",
);

const CONFIRM_ROUTE_STATE_KEY = "__breadboardLearnConfirmRouteTestState";

async function loadConfirmRoute() {
  const entryPoint = path.join(
    dashboardRoot,
    "src",
    "app",
    "api",
    "gardens",
    "[gardenId]",
    "learn",
    "confirm",
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
        name: "learn-confirm-route-stubs",
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
              namespace: "learn-confirm-route-stub",
            }));
          }
          build.onLoad(
            { filter: /.*/, namespace: "learn-confirm-route-stub" },
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
                  contents: `export function resolveChatmockBaseUrl() { return { baseURL: "http://chatmock.test/v1" }; }`,
                };
              }
              if (args.path === "learn-runtime") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(CONFIRM_ROUTE_STATE_KEY)}];
                    export async function executeLearnOperationForRoute(request, label) {
                      state().operationCalls.push({ request: structuredClone(request), label });
                      state().mutationReached = true;
                      return state().execution;
                    }
                  `,
                };
              }
              if (args.path === "server-auth") {
                return {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(CONFIRM_ROUTE_STATE_KEY)}];
                    export async function requireOwnedClusterFromSlug(slug) {
                      state().authCalls.push(slug);
                      return { userId: 7, cluster: { slug: "canonical-garden" } };
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
              return {
                loader: "js",
                contents: `
                  const state = () => globalThis[${JSON.stringify(CONFIRM_ROUTE_STATE_KEY)}];
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
  return import(`data:text/javascript;base64,${encoded}#learn-confirm-route`);
}

const confirmRoute = await loadConfirmRoute();

function freshConfirmRouteState(overrides = {}) {
  const state = {
    selectedModel: "gpt-reviewed",
    execution: { accepted: true, jobId: "generation-job" },
    authCalls: [],
    modelCalls: [],
    operationCalls: [],
    mutationReached: false,
    ...overrides,
  };
  globalThis[CONFIRM_ROUTE_STATE_KEY] = state;
  return state;
}

async function withLearnContentPath(callback) {
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = "C:\\trusted\\quartz\\content";
  try {
    await callback();
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

describe("Learn confirmation concurrency guard", () => {
  test("the reviewed proposal ID crosses the status DTO and UI request exactly", () => {
    const jobInfo = sourceBetween(
      workspaceSource,
      "interface LearnJobInfo",
      "interface LearnValidationReportInfo",
    );
    assert.match(jobInfo, /proposedLearningMapId\?: string/);

    const handler = sourceBetween(
      workspaceSource,
      "async function handleConfirmAndGenerate()",
      "async function handleRegenerateLearningMap()",
    );
    assert.match(
      handler,
      /learnState\?\.job\?\.proposedLearningMapId\?\.trim\(\)/,
    );
    assert.match(handler, /status !== "awaiting_confirmation"/);
    assert.match(handler, /expectedModel = learnState\?\.job\?\.model\?\.trim\(\)/);
    assert.match(
      handler,
      /postLearnAction\("confirm",\s*\{\s*learningMapId: proposedLearningMapId,\s*expectedModel,\s*generate: true,/s,
    );
    assert.doesNotMatch(
      handler,
      /postLearnAction\("confirm",\s*\{\s*generate: true\s*\}\)/s,
    );

    const autoConfirm = sourceBetween(
      workspaceSource,
      "const autoConfirmLearnJobId",
      "function handleRetryAssistant",
    );
    assert.match(
      autoConfirm,
      /learnState\?\.job\?\.proposedLearningMapId\?\.trim\(\)/,
    );
    assert.match(autoConfirm, /!autoConfirmLearningMapId/);
    assert.match(autoConfirm, /!autoConfirmLearnModel/);
    assert.match(
      autoConfirm,
      /postLearnAction\("confirm",\s*\{\s*learningMapId: autoConfirmLearningMapId,\s*expectedModel: autoConfirmLearnModel,\s*generate: true,/s,
    );

    const confirmationBodies = Array.from(
      workspaceSource.matchAll(
        /postLearnAction\("confirm",\s*\{([\s\S]*?)\}\);/g,
      ),
      (match) => match[1],
    );
    assert.ok(confirmationBodies.length > 0, "expected UI confirmation calls");
    for (const body of confirmationBodies) {
      assert.match(
        body,
        /learningMapId:/,
        "every UI confirmation path must send its exact proposed map ID",
      );
      assert.match(
        body,
        /\bexpectedModel(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*,/,
        "every UI confirmation path must send its reviewed planning model",
      );
    }
  });

  test("the route rejects a changed selected model before confirmation or spawn", () => {
    assert.match(
      confirmRouteSource,
      /const model = selectedModelForUser\(userId\);\s*const expectedModel = requireExpectedLearnModel\(body, model\)/,
    );
    const modelGuard = confirmRouteSource.indexOf(
      "const expectedModel = requireExpectedLearnModel(body, model)",
    );
    const operation = confirmRouteSource.indexOf(
      "executeLearnOperationForRoute",
      modelGuard,
    );
    assert.ok(modelGuard >= 0, "expected the selected-model concurrency guard");
    assert.ok(operation > modelGuard, "the model guard must run before any Learn operation");
    assert.match(
      confirmRouteSource,
      /isLearnRouteConflict\(error\)[\s\S]*?status: 409/,
    );
    assert.match(
      confirmRouteSource,
      /operation: "confirm_generate"[\s\S]*?expectedModel,[\s\S]*?proposedLearningMapId: learningMapId/,
    );
    assert.match(
      confirmRouteSource,
      /operation: "confirm"[\s\S]*?expectedModel,[\s\S]*?proposedLearningMapId: learningMapId/,
    );
    assert.match(
      operationExecutorSource,
      /status\.job\.model !== request\.expectedModel[\s\S]*?request\.model !== request\.expectedModel/,
    );
    assert.match(
      learnBackgroundSource,
      /operation: "confirm";\s*expectedModel: string;[\s\S]*?operation: "confirm_generate";\s*expectedModel: string;/,
    );
    assert.match(
      learnWorkerSource,
      /case "confirm":[\s\S]*?typeof value\.expectedModel !== "string"[\s\S]*?case "confirm_generate":[\s\S]*?value\.model !== value\.expectedModel\.trim\(\)/,
    );
  });

  test("the route dispatches an exact reviewed model token unchanged", async () => {
    await withLearnContentPath(async () => {
      const state = freshConfirmRouteState();
      const requestBody = {
        learningMapId: " map-reviewed ",
        expectedModel: "gpt-reviewed",
        generate: true,
        sourceOnly: true,
        includeSourceSnapshots: false,
      };
      const response = await confirmRoute.POST(
        new Request("http://local/learn/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        }),
        { params: Promise.resolve({ gardenId: "requested-garden" }) },
      );

      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), {
        success: true,
        accepted: true,
        jobId: "generation-job",
      });
      assert.deepEqual(state.authCalls, ["requested-garden"]);
      assert.deepEqual(state.modelCalls, [7]);
      assert.equal(state.operationCalls.length, 1);
      assert.deepEqual(state.operationCalls[0].request, {
        operation: "confirm_generate",
        gardenId: "canonical-garden",
        userId: 7,
        contentPath: "C:\\trusted\\quartz\\content",
        baseURL: "http://chatmock.test/v1",
        model: "gpt-reviewed",
        expectedModel: "gpt-reviewed",
        proposedLearningMapId: "map-reviewed",
        sourceOnly: true,
        includeSourceSnapshots: false,
      });
      assert.deepEqual(requestBody, {
        learningMapId: " map-reviewed ",
        expectedModel: "gpt-reviewed",
        generate: true,
        sourceOnly: true,
        includeSourceSnapshots: false,
      });
    });
  });

  test("a route model mismatch returns 409 before any mutation boundary", async () => {
    await withLearnContentPath(async () => {
      const state = freshConfirmRouteState({ selectedModel: "gpt-current" });
      const response = await confirmRoute.POST(
        new Request("http://local/learn/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            learningMapId: "map-reviewed",
            expectedModel: "gpt-reviewed",
            generate: true,
          }),
        }),
        { params: Promise.resolve({ gardenId: "requested-garden" }) },
      );

      assert.equal(response.status, 409);
      assert.match(
        (await response.json()).error,
        /selected Learn model changed/,
      );
      assert.deepEqual(state.modelCalls, [7]);
      assert.deepEqual(state.operationCalls, []);
      assert.equal(state.mutationReached, false);
    });
  });

  test("an omitted route model token fails closed before any mutation boundary", async () => {
    await withLearnContentPath(async () => {
      const state = freshConfirmRouteState();
      const response = await confirmRoute.POST(
        new Request("http://local/learn/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ learningMapId: "map-reviewed", generate: true }),
        }),
        { params: Promise.resolve({ gardenId: "requested-garden" }) },
      );

      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /requires expectedModel/);
      assert.deepEqual(state.operationCalls, []);
      assert.equal(state.mutationReached, false);
    });
  });

  test("the light HTTP boundary and heavy executor reject invalid proposal IDs", () => {
    assert.match(
      confirmRouteSource,
      /typeof body\.learningMapId === "string" \? body\.learningMapId\.trim\(\) : ""/,
    );
    assert.match(
      confirmRouteSource,
      /if \(!learningMapId\)[\s\S]*?status: 400/,
    );
    assert.match(
      operationExecutorSource,
      /status\.job\?\.status !== "awaiting_confirmation"[\s\S]*?status\.job\.proposedLearningMapId !== request\.proposedLearningMapId[\s\S]*?!status\.proposedLearningMap/,
    );
    assert.match(
      operationExecutorSource,
      /case "confirm"[\s\S]*?confirmLearningMap\(\{[\s\S]*?learningMapId: request\.proposedLearningMapId,[\s\S]*?requireProposed: true/,
    );
    assert.match(
      operationExecutorSource,
      /case "confirm"[\s\S]*?confirmLearningMap\(\{[\s\S]*?expectedModel: request\.expectedModel/,
    );
  });

  test("Confirm-and-Generate delegates the exact proposal without confirming in Next", () => {
    const generateBranch = sourceBetween(
      confirmRouteSource,
      "if (body.generate === true)",
      'operation: "confirm"',
    );

    assert.match(generateBranch, /operation:\s*"confirm_generate"/);
    assert.match(
      generateBranch,
      /proposedLearningMapId:\s*learningMapId/,
      "the detached worker must receive the exact ID accepted by the route guard",
    );
    assert.match(
      generateBranch,
      /jobId: execution\.jobId \?\? null/,
      "the route must return the exact durable worker checkpoint",
    );
    assert.doesNotMatch(
      generateBranch,
      /confirmLearningMap\s*\(/,
      "generate=true must leave irreversible confirmation to the worker",
    );
    const executorBranch = sourceBetween(
      operationExecutorSource,
      'case "confirm_generate"',
      'case "repair"',
    );
    assert.match(executorBranch, /requireCurrentProposal\(request\)/);
    assert.match(
      executorBranch,
      /confirmedLearningMapId:\s*request\.proposedLearningMapId[\s\S]*?confirmProposedLearningMap:\s*true/,
    );
  });

  test("confirm-only delegates to the exact synchronous confirmation transaction", () => {
    const confirmOnlyBranch = sourceBetween(
      confirmRouteSource,
      'operation: "confirm"',
      "} catch (error) {",
    );

    assert.doesNotMatch(confirmRouteSource, /from "@\/lib\/learn"/);
    assert.match(
      confirmOnlyBranch,
      /proposedLearningMapId:\s*learningMapId/,
    );
    const executorBranch = sourceBetween(
      operationExecutorSource,
      'case "confirm"',
      'case "confirm_generate"',
    );
    assert.match(
      executorBranch,
      /return confirmLearningMap\(\{[\s\S]*?learningMapId:\s*request\.proposedLearningMapId[\s\S]*?expectedModel:\s*request\.expectedModel[\s\S]*?requireProposed:\s*true/,
    );
    assert.doesNotMatch(executorBranch, /await\s+confirmLearningMap/);
  });

  test("the transaction binds confirmation to the requested map and its owning job", () => {
    const confirmation = sourceBetween(
      learnSource,
      "export function confirmLearningMap",
      "function renderObjectMarkdown",
    );
    assert.match(confirmation, /learningMapId: string/);
    assert.match(confirmation, /expectedModel: string/);
    assert.match(
      confirmation,
      /getLearnMapById\(requestedLearningMapId, gardenId\)/,
    );
    assert.doesNotMatch(confirmation, /getLatestProposedLearnMap\(/);
    assert.match(
      confirmation,
      /alreadyConfirmed && requireProposed[\s\S]*?LearnPipelineConflictError/,
    );
    assert.match(
      confirmation,
      /planningJob\.proposedLearningMapId !== map\.id/,
    );
    const modelGuard = confirmation.indexOf(
      "planningJob.model !== requestedExpectedModel",
    );
    const mapMutation = confirmation.indexOf("UPDATE learn_maps");
    assert.ok(modelGuard >= 0, "expected the planning-model transaction guard");
    assert.ok(
      mapMutation > modelGuard,
      "the planning-model guard must run before the map can be confirmed",
    );
    assert.match(
      confirmation,
      /WHERE id = \? AND garden_id = \? AND status = 'proposed'/,
    );
  });

  test("interactive generation becomes recoverable before irreversible confirmation", () => {
    const generation = sourceBetween(
      learnSource,
      "export async function runTextbookGeneration",
      "export interface FullRebuildOptions",
    );
    const interactiveStart = generation.indexOf(
      "if (confirmProposedLearningMap) {",
    );
    const activeMarker = generation.indexOf(
      "updateLearnJobExpectStatus(handoffJobId, {",
      interactiveStart,
    );
    const confirmation = generation.indexOf(
      "map = confirmLearningMap({",
      activeMarker,
    );
    const generationJob = generation.indexOf("createLearnJob({", confirmation);

    assert.ok(interactiveStart >= 0, "expected the interactive handoff branch");
    assert.ok(
      activeMarker > interactiveStart,
      "the planning job must become an active recovery marker",
    );
    assert.ok(
      confirmation > activeMarker,
      "the recovery marker must commit before map confirmation",
    );
    assert.ok(
      generationJob > confirmation,
      "map confirmation must precede generation-job creation",
    );

    const handoff = generation.slice(interactiveStart, generationJob);
    assert.match(
      handoff,
      /updateLearnJobExpectStatus\(handoffJobId,\s*\{[\s\S]*?status:\s*"building_navigation"/,
    );
    assert.match(
      handoff,
      /map = confirmLearningMap\(\{[\s\S]*?learningMapId:\s*confirmedLearningMapId[\s\S]*?gardenLease:\s*lease[\s\S]*?requireProposed:\s*true/,
    );
  });

  test("a failed confirmation reopens review only while the map remains proposed", () => {
    const generation = sourceBetween(
      learnSource,
      "export async function runTextbookGeneration",
      "export interface FullRebuildOptions",
    );
    const interactiveStart = generation.indexOf(
      "if (confirmProposedLearningMap) {",
    );
    const catchStart = generation.indexOf("} catch (error) {", interactiveStart);
    const catchEnd = generation.indexOf("throw error;", catchStart);

    assert.ok(catchStart > interactiveStart, "expected confirmation failure handling");
    assert.ok(catchEnd > catchStart, "confirmation failures must propagate");

    const confirmationFailure = generation.slice(catchStart, catchEnd);
    assert.match(
      confirmationFailure,
      /if \(getLearnMapById\(confirmedLearningMapId, gardenId\)\?\.status !== "confirmed"\) \{[\s\S]*?updateLearnJobExpectStatus\(handoffJobId,\s*\{[\s\S]*?status:\s*"awaiting_confirmation"/,
      "only an uncommitted proposal may return to review",
    );
    assert.equal(
      (confirmationFailure.match(/status:\s*"awaiting_confirmation"/g) ?? []).length,
      1,
      "the catch path must not contain an unconditional second status rewrite",
    );
  });
});
