import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

test("document editor integration suite", async () => {
  const outputFile = path.join(
    process.cwd(),
    "tests",
    `artifact-document-editor-${process.pid}-${Date.now()}.test.mjs`,
  );

  try {
    await build({
      entryPoints: [
        path.join(
          process.cwd(),
          "tests",
          "fixtures",
          "artifact-document-editor.integration.mjs",
        ),
      ],
      outfile: outputFile,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      logLevel: "silent",
      plugins: [
        {
          name: "server-only-test-boundary",
          setup(buildContext) {
            buildContext.onResolve({ filter: /^server-only$/ }, () => ({
              path: "server-only",
              namespace: "breadboard-test",
            }));
            buildContext.onLoad(
              { filter: /^server-only$/, namespace: "breadboard-test" },
              () => ({ contents: "export {};", loader: "js" }),
            );
          },
        },
      ],
    });

    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;

    const result = spawnSync(process.execPath, ["--test", outputFile], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: childEnv,
      timeout: 120_000,
    });

    assert.equal(
      result.status,
      0,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  } finally {
    fs.rmSync(outputFile, { force: true });
  }
});
