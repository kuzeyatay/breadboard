import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { recallDataDir, recallHome, stopRecallEngine } from "../src/main/recall";
import type { ResolvedPaths } from "../src/main/path-resolver";

function pathsFor(dataRoot: string): ResolvedPaths {
  // Only dataRoot is read by the Recall helpers; the rest of ResolvedPaths is
  // irrelevant here and is filled in loosely on purpose.
  return { dataRoot } as unknown as ResolvedPaths;
}

function writePidFile(dataRoot: string, pid: number): string {
  const home = recallHome(pathsFor(dataRoot));
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "engine.json");
  fs.writeFileSync(file, JSON.stringify({ pid, startedAt: new Date().toISOString(), args: [] }));
  return file;
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-recall-"));
}

test("Recall locations hang off the desktop data root", () => {
  const paths = pathsFor(path.join("C:", "data"));
  assert.equal(recallHome(paths), path.join("C:", "data", "recall"));
  assert.equal(recallDataDir(paths), path.join("C:", "data", "recall", "data"));
});

test("stopping is a no-op when Recall was never used", async () => {
  const root = tempRoot();
  assert.equal(await stopRecallEngine(pathsFor(root)), false);
});

test("a stale pid file does not report a phantom stop", async () => {
  const root = tempRoot();
  // A pid that has certainly exited: spawn something trivial and wait for it.
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  const pid = child.pid as number;
  await new Promise((resolve) => child.on("exit", resolve));
  writePidFile(root, pid);
  assert.equal(await stopRecallEngine(pathsFor(root)), false);
});

test("a live capture engine is terminated when Breadboard quits", async () => {
  const root = tempRoot();
  // Stand in for the recorder: a process that ignores nothing and simply runs.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const pid = child.pid as number;
  const pidFile = writePidFile(root, pid);
  const exited = new Promise((resolve) => child.on("exit", resolve));

  assert.equal(await stopRecallEngine(pathsFor(root), { graceMs: 5000 }), true);
  await exited;

  // The recorder is gone, and so is the claim that one is running.
  assert.equal(fs.existsSync(pidFile), false);
  assert.throws(() => process.kill(pid, 0));
});
