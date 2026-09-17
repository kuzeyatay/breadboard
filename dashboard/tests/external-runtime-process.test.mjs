import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  externalRuntimeSpawn,
  externalRuntimeSpawnSync,
} from "../src/lib/external-runtime-process.ts";

test("runtime process probes preserve cwd, environment, arguments and exit status", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bb runtime process "));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const result = externalRuntimeSpawnSync(process.execPath, ["-e", `
    process.stdout.write(JSON.stringify({ cwd: process.cwd(), flag: process.env.BB_PROCESS_TEST, arg: process.argv[1] }));
    process.stderr.write("probe detail");
    process.exitCode = 7;
  `, "argument with spaces"], {
    cwd, env: { ...process.env, BB_PROCESS_TEST: "present" },
    windowsHide: true, encoding: "utf8", timeout: 5_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 7);
  assert.equal(result.stderr, "probe detail");
  assert.deepEqual(JSON.parse(result.stdout), { cwd, flag: "present", arg: "argument with spaces" });

  const missing = externalRuntimeSpawnSync(path.join(cwd, "missing-executable"), [], {
    windowsHide: true, timeout: 5_000,
  });
  assert.equal(missing.error?.code, "ENOENT");
  assert.equal(missing.status, null);
});

test("runtime workers retain piped input/output and process completion events", async () => {
  const child = externalRuntimeSpawn(process.execPath, ["-e", `
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data) => process.stdout.write(data.toUpperCase()));
  `], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, timeout: 5_000 });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  child.stdin.end("worker ready\n");
  assert.equal(await completion, 0);
  assert.equal(output, "WORKER READY\n");
});
