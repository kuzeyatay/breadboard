import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  beginDashboardBuild,
  listDashboardBuildConsumers,
  renameDashboardBuildOutput,
} from "../scripts/dashboard-build-cache.mjs";

test("output rotation retries transient Windows handles and keeps the completed artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-output-lock-"));
  const source = path.join(root, ".next-desktop");
  const destination = path.join(root, ".next-desktop-last-good");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "server.js"), "last complete build");
  let attempts = 0;
  const waits = [];
  try {
    renameDashboardBuildOutput(source, destination, {
      platform: "win32",
      rename: (from, to) => {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error("busy"), { code: "EPERM" });
        fs.renameSync(from, to);
      },
      wait: (milliseconds) => waits.push(milliseconds),
    });
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [250, 250]);
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(path.join(destination, "server.js"), "utf8"), "last complete build");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a persistent lock fails within the retry bound without removing the last build", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-output-busy-"));
  const source = path.join(root, ".next-desktop");
  const destination = path.join(root, ".next-desktop-last-good");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "server.js"), "last complete build");
  const cause = Object.assign(new Error("still locked"), { code: "EBUSY" });
  let attempts = 0;
  const waits = [];
  try {
    assert.throws(() => renameDashboardBuildOutput(source, destination, {
      platform: "win32",
      rename: () => { attempts += 1; throw cause; },
      wait: (milliseconds) => waits.push(milliseconds),
    }), (error) => {
      assert.equal(error.code, "BREADBOARD_DASHBOARD_OUTPUT_LOCKED");
      assert.equal(error.cause, cause);
      assert.match(error.message, /background\/headless Breadboard runtime/);
      return true;
    });
    assert.equal(attempts, 13);
    assert.equal(waits.length, 12);
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(path.join(source, "server.js"), "utf8"), "last complete build");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing paths, full disks, and non-Windows failures are not retried", () => {
  for (const [platform, code] of [["win32", "ENOENT"], ["win32", "ENOSPC"], ["linux", "EPERM"]]) {
    const cause = Object.assign(new Error(code), { code });
    let attempts = 0;
    assert.throws(() => renameDashboardBuildOutput("source", "destination", {
      platform,
      rename: () => { attempts += 1; throw cause; },
      wait: () => assert.fail("must not retry this failure"),
    }), (error) => error === cause);
    assert.equal(attempts, 1);
  }
});

test("a running dashboard served from the output refuses the rotation before touching it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-output-in-use-"));
  const output = path.join(root, "dashboard", ".next-desktop");
  const server = path.join(output, "standalone", "server.js");
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, "// served by the open app\n");
  const processes = () => [
    { pid: 4242, name: "node.exe", commandLine: `"C:\\nodejs\\node.exe" ${server.replaceAll("/", "\\")}` },
    { pid: 7, name: "electron.exe", commandLine: "electron.exe C:\\somewhere\\else" },
    { pid: process.pid, name: "node.exe", commandLine: `node build ${output}` },
  ];
  try {
    const consumers = listDashboardBuildConsumers(root, { platform: "win32", processes });
    assert.deepEqual(consumers.map((entry) => entry.pid), [4242]);
    assert.throws(() => beginDashboardBuild(root, { platform: "win32", processes }), (error) => {
      assert.equal(error.code, "BREADBOARD_DASHBOARD_OUTPUT_IN_USE");
      assert.match(error.message, /node\.exe \(pid 4242\)/);
      assert.match(error.message, /Close the Breadboard app/);
      return true;
    });
    assert.equal(fs.readFileSync(server, "utf8"), "// served by the open app\n");
    assert.equal(fs.existsSync(path.join(root, "dashboard", ".next-desktop-last-good")), false);

    // Case and separator differences on Windows must not hide the server.
    const shouted = () => [{ pid: 9, name: "node.exe", commandLine: server.toUpperCase().replaceAll("\\", "/") }];
    assert.equal(listDashboardBuildConsumers(root, { platform: "win32", processes: shouted }).length, 1);
    assert.equal(listDashboardBuildConsumers(root, { platform: "linux", processes: shouted }).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("without a consumer the rotation proceeds as before", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-output-free-"));
  const server = path.join(root, "dashboard", ".next-desktop", "standalone", "server.js");
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, "// idle build\n");
  try {
    assert.equal(beginDashboardBuild(root, { processes: () => [] }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
