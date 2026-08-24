import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const statusRouteSource = fs.readFileSync(
  path.join(
    dashboardRoot,
    "src/app/api/gardens/[gardenId]/learn/status/route.ts",
  ),
  "utf8",
);
const statusClientSource = fs.readFileSync(
  path.join(dashboardRoot, "src/lib/learn-status-client.ts"),
  "utf8",
);
const developmentRuntimeSource = fs.readFileSync(
  path.join(dashboardRoot, "src/lib/learn-status-runtime.dev.ts"),
  "utf8",
);
const productionRuntimeSource = fs.readFileSync(
  path.join(dashboardRoot, "src/lib/learn-status-runtime.production.ts"),
  "utf8",
);
const nextConfigSource = fs.readFileSync(
  path.join(dashboardRoot, "next.config.ts"),
  "utf8",
);
const tsconfig = JSON.parse(
  fs.readFileSync(path.join(dashboardRoot, "tsconfig.json"), "utf8"),
);

test("next dev status polling cannot bundle the Learn monolith", () => {
  assert.match(statusRouteSource, /from "breadboard-learn-status-runtime"/);
  assert.doesNotMatch(statusRouteSource, /from "@\/lib\/learn"|import\("@\/lib\/learn"\)/);
  assert.match(developmentRuntimeSource, /getIsolatedLearnStatusSnapshot/);
  assert.doesNotMatch(developmentRuntimeSource, /from "@\/lib\/learn"/);
  assert.match(productionRuntimeSource, /from "@\/lib\/learn"/);
  assert.match(nextConfigSource, /learn-status-runtime\.dev\.ts/);
  assert.match(nextConfigSource, /learn-status-runtime\.production\.ts/);
  assert.match(nextConfigSource, /buildDependencies/);
  assert.match(nextConfigSource, /path\.resolve\(process\.cwd\(\), 'tsconfig\.json'\)/);
  assert.equal(
    tsconfig.compilerOptions.paths["breadboard-learn-status-runtime"],
    undefined,
  );
  assert.equal(
    tsconfig.compilerOptions.paths["breadboard-learn-operation-runtime"],
    undefined,
  );
  assert.match(statusClientSource, /learn-status-worker\.mjs/);
  assert.match(statusClientSource, /--max-old-space-size=2048/);
  assert.match(statusClientSource, /__breadboardLearnStatusWorker/);
});

test("the isolated status child imports the real read path and answers repeatedly", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "learn-status-worker-"),
  );
  const contentPath = path.join(temporaryRoot, "content");
  const dataPath = path.join(temporaryRoot, "data");
  fs.mkdirSync(contentPath, { recursive: true });
  fs.mkdirSync(dataPath, { recursive: true });

  const child = fork(
    path.join(dashboardRoot, "scripts", "learn-status-worker.mjs"),
    [],
    {
      cwd: dashboardRoot,
      windowsHide: true,
      execArgv: [
        "--max-old-space-size=2048",
        "--experimental-strip-types",
        "--import",
        pathToFileURL(
          path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
        ).href,
      ],
      env: {
        ...process.env,
        BREADBOARD_DATA_DIR: dataPath,
        QUARTZ_CONTENT_PATH: contentPath,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("The real Learn status worker did not become ready.")),
        60_000,
      );
      const onMessage = (message) => {
        if (message?.protocolVersion === 1 && message.type === "ready") {
          clearTimeout(timeout);
          child.off("message", onMessage);
          resolve();
        }
      };
      child.on("message", onMessage);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `The status worker exited before ready (code ${code}, signal ${signal}). ${stderr}`,
          ),
        );
      });
    });

    for (const requestId of ["generic-status-1", "generic-status-2"]) {
      const snapshot = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Status query ${requestId} did not settle.`)),
          60_000,
        );
        const onMessage = (message) => {
          if (message?.requestId !== requestId) return;
          clearTimeout(timeout);
          child.off("message", onMessage);
          if (message.type === "result") resolve(message.snapshot);
          else reject(new Error(message.error?.message ?? "Status query failed."));
        };
        child.on("message", onMessage);
        child.send({
          protocolVersion: 1,
          type: "status",
          requestId,
          gardenId: "generic-status-worker-garden",
          contentPath,
        });
      });
      assert.equal(snapshot.job, null);
      assert.equal(snapshot.hasSources, false);
      assert.equal(snapshot.syllabusSourceId, null);
    }
  } finally {
    if (child.connected) child.disconnect();
    await new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 10_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
