import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveHotRuntimeClosure,
  prepareHotDevRuntimes,
} from "../scripts/prepare-hot-dev-runtimes.mjs";
import { CHATMOCK_SOURCE_HOOK } from "../scripts/chatmock-python-source-hook.mjs";
import { HERMES_SOURCE_HOOK } from "../scripts/hermes-python-source-hook.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredByTarget = Object.freeze({
  node: Object.freeze(["runtimes/node/node.exe"]),
  python: Object.freeze([
    "runtimes/python/Lib/site-packages/breadboard-chatmock.pth",
    "runtimes/python/Lib/site-packages/breadboard-hermes.pth",
    "runtimes/python/python.exe",
  ]),
  cad: Object.freeze([
    "runtimes/cad-python/python.exe",
    "runtimes/cad-python/runtime-artifact.json",
  ]),
  colpali: Object.freeze([
    "runtimes/colpali-python/python.exe",
    "runtimes/colpali-python/runtime-artifact.json",
  ]),
  humanizer: Object.freeze([
    "runtimes/humanizer-python/python.exe",
    "runtimes/humanizer-python/runtime-artifact.json",
  ]),
});
const allRequiredPaths = Object.freeze(Object.values(requiredByTarget).flat().sort());

function servicesManifest() {
  return {
    version: 1,
    services: [
      {
        id: "all-hot-runtimes",
        launchProfiles: [
          {
            modes: ["hot"],
            executableAuthority: "runtime-root",
            allowedExecutable: "runtimes/node/node.exe",
            installProbe: {
              kind: "files-present",
              files: [
                ...allRequiredPaths.map((relativePath) => ({
                  authority: "runtime-root",
                  path: relativePath,
                })),
                { authority: "runtime-root", path: "bin/ffmpeg.exe" },
                { authority: "app-root", path: "dashboard/package.json" },
              ],
            },
          },
          {
            modes: ["packaged"],
            executableAuthority: "runtime-root",
            allowedExecutable: "runtimes/unreviewed-packaged/tool.exe",
            installProbe: {
              kind: "files-present",
              files: [
                { authority: "runtime-root", path: "runtimes/unreviewed-packaged/tool.exe" },
              ],
            },
          },
        ],
      },
    ],
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeRuntimeFile(runtimeRoot, relativePath) {
  const candidate = path.join(runtimeRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.writeFileSync(candidate, `fixture ${relativePath}\n`);
}

function fixture({ complete = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hot-runtimes-"));
  const manifestPath = path.join(root, "manifests", "services.json");
  const runtimeRoot = path.join(root, "runtime-root");
  const prepareScript = path.join(root, "scripts", "prepare-runtimes.mjs");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  writeJson(manifestPath, servicesManifest());
  fs.mkdirSync(path.dirname(prepareScript), { recursive: true });
  fs.writeFileSync(prepareScript, "// fixture only\n");
  if (complete) {
    for (const relativePath of allRequiredPaths) writeRuntimeFile(runtimeRoot, relativePath);
  }
  return { root, manifestPath, runtimeRoot, prepareScript };
}

function options(current, runPrepare) {
  return {
    manifestPath: current.manifestPath,
    runtimeRoot: current.runtimeRoot,
    prepareScript: current.prepareScript,
    runPrepare,
  };
}

test("the authoritative manifest maps to the five reviewed hot runtime targets", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(desktopRoot, "runtime-v2", "manifests", "services.json"),
      "utf8",
    ),
  );
  const closure = deriveHotRuntimeClosure(manifest);

  assert.deepEqual(
    closure.map(({ relativePath }) => relativePath),
    allRequiredPaths,
  );
  assert.deepEqual(
    [...new Set(closure.map(({ target }) => target))].sort(),
    ["cad", "colpali", "humanizer", "node", "python"],
  );
});

test("cached Python repairs its source hooks without rebuilding dependencies", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  let calls = 0;

  const result = prepareHotDevRuntimes(options(current, () => {
    calls += 1;
    return 0;
  }));

  assert.equal(calls, 0);
  assert.deepEqual(result.requiredPaths, allRequiredPaths);
  assert.deepEqual(result.requiredTargets, ["node", "python", "cad", "colpali", "humanizer"]);
  assert.deepEqual(result.preparedTargets, []);
  assert.equal(fs.readFileSync(path.join(current.runtimeRoot,
    "runtimes/python/Lib/site-packages/breadboard-chatmock.pth"), "utf8"), CHATMOCK_SOURCE_HOOK);
  assert.equal(fs.readFileSync(path.join(current.runtimeRoot,
    "runtimes/python/Lib/site-packages/breadboard-hermes.pth"), "utf8"), HERMES_SOURCE_HOOK);
});

test("only missing reviewed runtime groups invoke their exact preparer targets", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  fs.rmSync(path.join(current.runtimeRoot, "runtimes", "python"), { recursive: true });
  fs.rmSync(path.join(current.runtimeRoot, "runtimes", "colpali-python"), { recursive: true });
  const calls = [];

  const result = prepareHotDevRuntimes(options(current, (target, context) => {
    calls.push({ target, requiredPaths: [...context.requiredPaths] });
    for (const relativePath of context.requiredPaths) {
      writeRuntimeFile(context.runtimeRoot, relativePath);
    }
    return { status: 0 };
  }));

  assert.deepEqual(calls, [
    { target: "python", requiredPaths: [...requiredByTarget.python] },
    { target: "colpali", requiredPaths: [...requiredByTarget.colpali] },
  ]);
  assert.deepEqual(result.preparedTargets, ["python", "colpali"]);
});

test("unknown hot runtime mappings fail before any preparer runs", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const manifest = servicesManifest();
  manifest.services[0].launchProfiles[0].installProbe.files.push({
    authority: "runtime-root",
    path: "runtimes/unreviewed/tool.exe",
  });
  writeJson(current.manifestPath, manifest);
  let calls = 0;

  assert.throws(
    () => prepareHotDevRuntimes(options(current, () => {
      calls += 1;
      return 0;
    })),
    /no unique reviewed hot-runtime preparation target/u,
  );
  assert.equal(calls, 0);
});

test("unsafe hot runtime paths fail before any preparer runs", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const manifest = servicesManifest();
  manifest.services[0].launchProfiles[0].installProbe.files.push({
    authority: "runtime-root",
    path: "runtimes/node/../escape.exe",
  });
  writeJson(current.manifestPath, manifest);

  assert.throws(
    () => prepareHotDevRuntimes(options(current, () => 0)),
    /safe runtime-root relative path/u,
  );
});

test("linked runtime directories fail closed instead of invoking preparation", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const nodeDirectory = path.join(current.runtimeRoot, "runtimes", "node");
  const outside = path.join(current.root, "outside-node");
  fs.renameSync(nodeDirectory, outside);
  fs.symlinkSync(outside, nodeDirectory, process.platform === "win32" ? "junction" : "dir");
  let calls = 0;

  assert.throws(
    () => prepareHotDevRuntimes(options(current, () => {
      calls += 1;
      return 0;
    })),
    /symbolic link or junction/u,
  );
  assert.equal(calls, 0);
});

test("hard-linked runtime files fail closed instead of invoking preparation", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const candidate = path.join(current.runtimeRoot, "runtimes", "node", "node.exe");
  const original = path.join(current.root, "hard-link-origin.exe");
  fs.renameSync(candidate, original);
  try {
    fs.linkSync(original, candidate);
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "ENOTSUP") {
      t.skip(`hard links are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let calls = 0;

  assert.throws(
    () => prepareHotDevRuntimes(options(current, () => {
      calls += 1;
      return 0;
    })),
    /exactly one hard link/u,
  );
  assert.equal(calls, 0);
});

test("non-regular runtime paths fail closed instead of invoking preparation", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const candidate = path.join(current.runtimeRoot, "runtimes", "node", "node.exe");
  fs.rmSync(candidate);
  fs.mkdirSync(candidate);

  assert.throws(
    () => prepareHotDevRuntimes(options(current, () => 0)),
    /direct regular file/u,
  );
});

test("a failed preparer status stops the chain", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  fs.rmSync(path.join(current.runtimeRoot, "runtimes", "node"), { recursive: true });

  assert.throws(
    () => prepareHotDevRuntimes(options(current, () => ({ status: 7 }))),
    /node exited with 7/u,
  );
});

test("a successful runner must actually restore its complete group", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  fs.rmSync(path.join(current.runtimeRoot, "runtimes", "humanizer-python"), {
    recursive: true,
  });

  assert.throws(
    () => prepareHotDevRuntimes(options(current, () => 0)),
    /humanizer did not produce its complete reviewed closure/u,
  );
});
