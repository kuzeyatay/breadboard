import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRepositoryPath,
  processBoundaryKinds,
  validateProcessSources,
} from "./process-source-validation.mjs";

test("normalizes repository paths without accepting non-strings", () => {
  assert.equal(normalizeRepositoryPath(".\\dashboard\\src\\worker.ts"), "dashboard/src/worker.ts");
  assert.equal(normalizeRepositoryPath(null), "");
});

test("detects each supported production process boundary", () => {
  assert.deepEqual(processBoundaryKinds('import { spawn } from "node:child_process";'), [
    "node-child-process",
  ]);
  assert.deepEqual(processBoundaryKinds("const child = Bun.spawn(['tool']);"), ["bun-spawn"]);
  assert.deepEqual(processBoundaryKinds("const child = new Deno.Command('tool');"), [
    "deno-command",
  ]);
  assert.deepEqual(processBoundaryKinds('const { Worker } = require("node:worker_threads");'), [
    "node-worker-thread",
  ]);
  assert.deepEqual(processBoundaryKinds("import subprocess\nsubprocess.run(['tool'])"), [
    "python-subprocess",
  ]);
  assert.deepEqual(processBoundaryKinds("from concurrent.futures import ProcessPoolExecutor"), [
    "python-process",
  ]);
  assert.deepEqual(processBoundaryKinds("use std::process::Command;"), [
    "rust-process-command",
  ]);
  assert.deepEqual(processBoundaryKinds('import "os/exec"\nexec.Command("tool")'), [
    "go-process-command",
  ]);
  assert.deepEqual(processBoundaryKinds("const spawn = false;"), []);
});

test("requires every discovered process source to appear in execution inventory", () => {
  const result = validateProcessSources({
    files: [
      {
        path: "dashboard\\src\\mapped.ts",
        source: 'import { spawn } from "node:child_process";',
      },
      {
        path: "dashboard/src/unmapped.ts",
        source: "await Bun.spawn(['tool']).exited;",
      },
      { path: "dashboard/src/plain.ts", source: "export const value = 1;" },
    ],
    inventory: {
      entries: [
        {
          runtime_id: "job:mapped",
          sources: ["dashboard/src/mapped.ts:10-20"],
          flags: { spawns_descendants: true },
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.counts, {
    discoveredFiles: 3,
    processBoundaryFiles: 2,
    mappedFiles: 1,
    unmappedFiles: 1,
  });
  assert.match(result.errors[0], /dashboard\/src\/unmapped\.ts/u);
  assert.deepEqual(result.rows.find((row) => row.mapped)?.runtimeIds, ["job:mapped"]);
});

test("rejects duplicate discovery rows instead of inflating mapped counts", () => {
  const result = validateProcessSources({
    files: [
      { path: "desktop/src/main.ts", source: 'import("node:child_process");' },
      { path: "desktop\\src\\main.ts", source: 'import("node:child_process");' },
    ],
    inventory: { entries: [] },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /duplicated desktop\/src\/main\.ts/u);
  assert.equal(result.counts.discoveredFiles, 1);
});

test("maps audited service source directories and requires descendant truth", () => {
  const accepted = validateProcessSources({
    files: [
      {
        path: "gbrain/src/core/minions/spawn-helpers.ts",
        source: 'import { spawn } from "node:child_process";',
      },
    ],
    inventory: {
      entries: [
        {
          runtime_id: "service:gbrain",
          sources: ["gbrain/src/**"],
          flags: { spawns_descendants: true },
        },
      ],
    },
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.rows[0]?.runtimeIds, ["service:gbrain"]);

  const rejected = validateProcessSources({
    files: [
      {
        path: "chatmock/chatmock/providers/claude_code.py",
        source: "import subprocess\nsubprocess.Popen(['claude'])",
      },
    ],
    inventory: {
      entries: [
        {
          runtime_id: "service:chatmock",
          sources: ["chatmock/chatmock/**"],
          flags: { spawns_descendants: false },
        },
      ],
    },
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join("\n"), /flags\.spawns_descendants is not true/u);
});
