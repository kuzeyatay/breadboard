import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backgroundEntry = path.join(dashboardRoot, "src", "lib", "learn-background.ts");
const workspacePath = path.join(
  dashboardRoot,
  "src",
  "app",
  "gardens",
  "[clusterSlug]",
  "workspace-client.tsx",
);
const STATE_KEY = "__breadboardLearnBackgroundHandoffTestState";

async function loadBackgroundHelper() {
  const result = await esbuild.build({
    entryPoints: [backgroundEntry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "learn-background-test-stubs",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "learn-background-stub",
          }));
          build.onResolve({ filter: /^next\/server$/ }, () => ({
            path: "next/server",
            namespace: "learn-background-stub",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "learn-background-stub" },
            (args) => ({
              loader: "js",
              contents:
                args.path === "next/server"
                  ? `
                      export function after(callback) {
                        globalThis[${JSON.stringify(STATE_KEY)}].callbacks.push(callback);
                      }
                    `
                  : "export {};",
            }),
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#learn-background-handoff`);
}

globalThis[STATE_KEY] = { callbacks: [] };
const { handOffLearnTask } = await loadBackgroundHelper();

function resetAfterCallbacks() {
  globalThis[STATE_KEY].callbacks.length = 0;
}

describe("handOffLearnTask runtime behavior", () => {
  test("propagates a fast completion to the route", async () => {
    resetAfterCallbacks();
    const result = await handOffLearnTask(Promise.resolve({ jobId: "job-fast" }), "fast task");

    assert.deepEqual(result, {
      accepted: false,
      value: { jobId: "job-fast" },
    });
    assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
  });

  test("propagates a fast failure so normal route error handling still runs", async () => {
    resetAfterCallbacks();
    const failure = new Error("validation failed before handoff");

    await assert.rejects(
      handOffLearnTask(Promise.reject(failure), "fast failure"),
      (error) => error === failure,
    );
    assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
  });

  test("returns accepted for long work and gives its settlement to Next after", async () => {
    resetAfterCallbacks();
    let resolveTask;
    const task = new Promise((resolve) => {
      resolveTask = resolve;
    });

    const result = await handOffLearnTask(task, "long generation");
    assert.deepEqual(result, { accepted: true });
    assert.equal(globalThis[STATE_KEY].callbacks.length, 1);

    let continuationFinished = false;
    const continuation = globalThis[STATE_KEY].callbacks[0]().then(() => {
      continuationFinished = true;
    });
    await Promise.resolve();
    assert.equal(continuationFinished, false, "the after continuation must retain the pending task");

    resolveTask({ jobId: "job-late" });
    await continuation;
    assert.equal(continuationFinished, true);
  });
});

describe("long Learn route handoff contracts", () => {
  const routes = [
    ["plan", "runLearnPipeline"],
    ["generate", "runTextbookGeneration"],
    ["confirm", "runTextbookGeneration"],
    ["regenerate", "runLearnRepairOperation"],
    ["rebuild", "rebuildEntireGarden"],
  ];

  for (const [action, operation] of routes) {
    test(`${action} hands off ${operation} and returns an accepted 202`, () => {
      const routePath = path.join(
        dashboardRoot,
        "src",
        "app",
        "api",
        "gardens",
        "[gardenId]",
        "learn",
        action,
        "route.ts",
      );
      const source = fs.readFileSync(routePath, "utf8");

      assert.match(source, /import \{ handOffLearnTask \} from "@\/lib\/learn-background"/);
      assert.ok(
        source.indexOf(`handOffLearnTask(${operation}(`) >= 0,
        `${action} must pass the live ${operation} promise to the handoff`,
      );
      assert.match(
        source,
        /if \(execution\.accepted\) \{[\s\S]*?accepted: true,[\s\S]*?\{ status: 202 \}[\s\S]*?\}/,
      );
      assert.match(
        source,
        /if \(execution\.accepted\) \{[\s\S]*?getLearnStatusSnapshot\(/,
        `${action} must return the durable job visible to polling`,
      );
    });
  }
});

test("workspace treats accepted Learn work as started, never completed", () => {
  const source = fs.readFileSync(workspacePath, "utf8");
  const acceptedStart = source.indexOf("if (data.accepted === true) {");
  const completedBranchStart = source.indexOf('if (endpoint === "clear") {', acceptedStart);
  assert.ok(acceptedStart >= 0 && completedBranchStart > acceptedStart);
  const acceptedBranch = source.slice(acceptedStart, completedBranchStart);

  assert.match(acceptedBranch, /await fetchLearnStatus\(\)/);
  assert.match(acceptedBranch, /Learning map generation started/);
  assert.match(acceptedBranch, /Issue repair started/);
  assert.match(acceptedBranch, /Garden rebuild started/);
  assert.match(acceptedBranch, /Lesson generation started/);
  assert.match(acceptedBranch, /return true/);

  assert.doesNotMatch(acceptedBranch, /fetchDocuments|setGraphRefreshVersion/);
  assert.doesNotMatch(
    acceptedBranch,
    /Learning map ready to review|Issues repaired|Garden rebuilt|Lessons generated/,
  );
});
