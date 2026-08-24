import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const STATE_KEY = "__breadboardLearnExecutorReplanConflictTestState";

async function loadExecutor() {
  const result = await esbuild.build({
    entryPoints: [
      path.join(dashboardRoot, "src", "lib", "learn-operation-executor.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "learn-executor-replan-conflict-stubs",
        setup(build) {
          for (const [filter, stubPath] of [
            [/^server-only$/, "server-only"],
            [/^@\/lib\/db$/, "db"],
            [/^@\/lib\/knowledge$/, "knowledge"],
            [/^@\/lib\/learn$/, "learn"],
          ]) {
            build.onResolve({ filter }, () => ({
              path: stubPath,
              namespace: "learn-executor-replan-conflict-stub",
            }));
          }
          build.onLoad(
            {
              filter: /.*/,
              namespace: "learn-executor-replan-conflict-stub",
            },
            (args) => {
              if (args.path === "server-only") return { contents: "export {};" };
              if (args.path === "db") {
                return {
                  contents: `
                    export default {
                      prepare() {
                        return { get() { return { owned: 1 }; } };
                      },
                    };
                  `,
                };
              }
              if (args.path === "knowledge") {
                return {
                  contents: `
                    const state = () => globalThis[${JSON.stringify(STATE_KEY)}];
                    export function createChatmockClient() {
                      state().clientCalls += 1;
                      return {};
                    }
                  `,
                };
              }
              return {
                contents: `
                  const state = () => globalThis[${JSON.stringify(STATE_KEY)}];
                  export class LearnPipelineConflictError extends Error {
                    constructor(message, options = {}) {
                      super(message);
                      this.name = "LearnPipelineConflictError";
                      this.requiresReplan = options.requiresReplan === true;
                    }
                  }
                  export function getLearnStatusSnapshot() {
                    state().statusCalls += 1;
                    return structuredClone(state().status);
                  }
                  const unexpected = (name) => {
                    state().operationCalls.push(name);
                    return { name };
                  };
                  export const confirmLearningMap = () => unexpected("confirm");
                  export const rebuildEntireGarden = () => unexpected("rebuild");
                  export const runLearnPipeline = () => unexpected("plan");
                  export const runLearnRepairOperation = () => unexpected("repair");
                  export const runTextbookGeneration = () => unexpected("generate");
                  export const switchFinishedLearnHumanizer = () => unexpected("humanizer");
                `,
              };
            },
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#learn-executor-replan-conflict`);
}

const { executeLearnOperation } = await loadExecutor();

function request() {
  return {
    operation: "generate",
    gardenId: "garden-a",
    userId: 17,
    contentPath: "C:\\trusted\\quartz\\content",
    baseURL: "http://chatmock.test/v1",
    model: "model-planned",
    expectedModel: "model-planned",
    requestedConfirmedLearningMapId: "map-confirmed",
    includedSourceIds: ["source-a"],
    sourceOnly: true,
    includeSourceSnapshots: false,
  };
}

function state(confirmedLearningMapModel) {
  return {
    status: {
      job: null,
      latestTextbookVersionId: undefined,
      hasTextbook: false,
      confirmedLearningMapId: "map-confirmed",
      confirmedLearningMapModel,
      selectedSourceIds: ["source-a"],
    },
    statusCalls: 0,
    clientCalls: 0,
    operationCalls: [],
  };
}

test("worker preflight preserves replacement-planning intent for missing or changed map-model ownership", async () => {
  for (const confirmedLearningMapModel of [undefined, "model-new-owner"]) {
    const current = state(confirmedLearningMapModel);
    globalThis[STATE_KEY] = current;

    await assert.rejects(
      () => executeLearnOperation(request()),
      (error) =>
        error?.name === "LearnPipelineConflictError" &&
        error.requiresReplan === true,
      String(confirmedLearningMapModel),
    );
    assert.equal(current.statusCalls, 1);
    assert.equal(current.clientCalls, 0);
    assert.deepEqual(current.operationCalls, []);
  }
});
