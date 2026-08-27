import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncDevRuntimeManifests } from "../scripts/sync-dev-runtime-manifests.mjs";

const hotBinContents = Object.freeze({
  "runtime-supervisor.exe": "runtime supervisor\n",
  "scriberr.exe": "scriberr\n",
  "ffmpeg.exe": "ffmpeg\n",
  "ffprobe.exe": "ffprobe\n",
  "yt-dlp.exe": "yt-dlp\n",
  "uv.exe": "uv\n",
});

function filesPresent(files) {
  return {
    kind: "files-present",
    files: files.map(([authority, filePath]) => ({ authority, path: filePath })),
  };
}

function serviceManifest() {
  return {
    version: 1,
    services: [
      {
        id: "dashboard",
        launchProfiles: [
          {
            modes: ["hot"],
            executableAuthority: "runtime-root",
            allowedExecutable: "runtimes/node/node.exe",
            installProbe: filesPresent([
              ["runtime-root", "runtimes/node/node.exe"],
              ["app-root", "dashboard/node_modules/next/dist/bin/next"],
            ]),
          },
        ],
      },
      {
        id: "gbrain",
        launchProfiles: [
          {
            modes: ["lean", "hot"],
            executableAuthority: "runtime-root",
            allowedExecutable: "runtimes/node/node.exe",
            arguments: [
              { kind: "literal", value: "--no-warnings" },
              { kind: "literal", value: "--experimental-transform-types" },
              { kind: "app-path", path: "gbrain-adapter/src/node-entrypoint.mjs" },
            ],
            installProbe: filesPresent([
              ["runtime-root", "runtimes/node/node.exe"],
              ["app-root", "gbrain-adapter/src/node-entrypoint.mjs"],
              ["app-root", "gbrain-adapter/src/node-loader.mjs"],
            ]),
          },
        ],
      },
      {
        id: "scriberr",
        launchProfiles: [
          {
            modes: ["lean", "hot", "packaged"],
            executableAuthority: "runtime-root",
            allowedExecutable: "bin/scriberr.exe",
            installProbe: filesPresent([
              ["runtime-root", "bin/ffmpeg.exe"],
              ["runtime-root", "bin/ffprobe.exe"],
              ["runtime-root", "bin/yt-dlp.exe"],
            ]),
          },
        ],
      },
      {
        id: "solidworks-mcp",
        launchProfiles: [
          {
            modes: ["lean", "hot", "packaged"],
            executableAuthority: "runtime-root",
            allowedExecutable: "runtimes/node/node.exe",
            installProbe: filesPresent([
              ["runtime-root", "runtimes/node/node.exe"],
              ["runtime-root", "bin/uv.exe"],
            ]),
          },
        ],
      },
      {
        id: "packaged-only-bin",
        launchProfiles: [
          {
            modes: ["packaged"],
            executableAuthority: "runtime-root",
            allowedExecutable: "bin/not-hot.exe",
            installProbe: filesPresent([["runtime-root", "bin/not-hot.exe"]]),
          },
        ],
      },
    ],
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-dev-manifests-"));
  const sourceDir = path.join(root, "source-manifests");
  const sourceRuntimeRoot = path.join(root, "source-runtime");
  const targetRuntimeRoot = path.join(root, "target-runtime");
  const targetDir = path.join(targetRuntimeRoot, "runtime-v2", "manifests");
  const sourceBin = path.join(sourceRuntimeRoot, "bin");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(sourceBin, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  writeJson(path.join(sourceDir, "services.json"), serviceManifest());
  writeJson(path.join(sourceDir, "workers.json"), {
    version: 1,
    workers: [{ kind: "learn-node" }],
  });
  for (const [name, content] of Object.entries(hotBinContents)) {
    fs.writeFileSync(path.join(sourceBin, name), content);
  }
  fs.writeFileSync(path.join(sourceBin, "not-hot.exe"), "packaged only\n");
  fs.writeFileSync(path.join(sourceBin, "breadboard-runtime.exe"), "electron-owned\n");
  return {
    root,
    sourceDir,
    targetDir,
    sourceRuntimeRoot,
    targetRuntimeRoot,
  };
}

function updateServices(current, update) {
  const filePath = path.join(current.sourceDir, "services.json");
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  update(manifest.services);
  writeJson(filePath, manifest);
}

test("predev replaces stale manifests without requiring not-yet-prepared bins", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  fs.rmSync(current.sourceRuntimeRoot, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(current.targetDir, "services.json"),
    JSON.stringify({ version: 1, services: [{ id: "dashboard" }] }),
  );
  fs.writeFileSync(
    path.join(current.targetDir, "workers.json"),
    JSON.stringify({ version: 1, workers: [] }),
  );

  assert.deepEqual(syncDevRuntimeManifests(current), {
    "services.json": 5,
    "workers.json": 1,
  });
  for (const name of ["services.json", "workers.json"]) {
    assert.deepEqual(
      fs.readFileSync(path.join(current.targetDir, name)),
      fs.readFileSync(path.join(current.sourceDir, name)),
    );
  }
  assert.equal(fs.existsSync(path.join(current.targetRuntimeRoot, "bin")), false);
});

test("post-preparation staging copies exactly the hot runtime bin closure", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));

  assert.deepEqual(
    syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
    { "services.json": 5, "workers.json": 1 },
  );

  const targetBin = path.join(current.targetRuntimeRoot, "bin");
  assert.deepEqual(
    fs.readdirSync(targetBin).sort(),
    Object.keys(hotBinContents).sort(),
  );
  for (const [name, content] of Object.entries(hotBinContents)) {
    assert.equal(fs.readFileSync(path.join(targetBin, name), "utf8"), content);
  }
  assert.equal(fs.existsSync(path.join(targetBin, "not-hot.exe")), false);
  assert.equal(fs.existsSync(path.join(targetBin, "breadboard-runtime.exe")), false);
});

test("post-preparation staging leaves byte-identical bin files untouched", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const options = { ...current, stageRuntimeBins: true };
  syncDevRuntimeManifests(options);

  const unchanged = path.join(current.targetRuntimeRoot, "bin", "ffmpeg.exe");
  const fixedTime = new Date("2000-01-01T00:00:00.000Z");
  fs.utimesSync(unchanged, fixedTime, fixedTime);
  const before = fs.statSync(unchanged).mtimeMs;
  syncDevRuntimeManifests(options);

  assert.equal(fs.statSync(unchanged).mtimeMs, before);
  assert.equal(fs.readFileSync(unchanged, "utf8"), hotBinContents["ffmpeg.exe"]);
});

test("dev startup fails closed before overwriting when GBrain authority is absent", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  updateServices(current, (services) => {
    services.splice(
      services.findIndex(({ id }) => id === "gbrain"),
      1,
    );
  });
  const sentinel = Buffer.from("staged sentinel");
  fs.writeFileSync(path.join(current.targetDir, "services.json"), sentinel);

  assert.throws(
    () => syncDevRuntimeManifests(current),
    /missing mandatory GBrain authority/u,
  );
  assert.deepEqual(fs.readFileSync(path.join(current.targetDir, "services.json")), sentinel);
});

test("strict staging rejects a missing required bin before changing manifests", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  fs.rmSync(path.join(current.sourceRuntimeRoot, "bin", "ffprobe.exe"));
  const sentinel = Buffer.from("old manifest");
  fs.writeFileSync(path.join(current.targetDir, "services.json"), sentinel);

  assert.throws(
    () => syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
    /ffprobe\.exe.*missing/u,
  );
  assert.deepEqual(fs.readFileSync(path.join(current.targetDir, "services.json")), sentinel);
  assert.equal(fs.existsSync(path.join(current.targetRuntimeRoot, "bin")), false);
});

test("strict staging rejects a non-regular required bin", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const candidate = path.join(current.sourceRuntimeRoot, "bin", "ffmpeg.exe");
  fs.rmSync(candidate);
  fs.mkdirSync(candidate);

  assert.throws(
    () => syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
    /ffmpeg\.exe.*direct regular file/u,
  );
});

test("strict staging rejects a runtime-root bin traversal before changing manifests", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  updateServices(current, (services) => {
    const scriberr = services.find(({ id }) => id === "scriberr");
    scriberr.launchProfiles[0].installProbe.files.push({
      authority: "runtime-root",
      path: "bin/../outside.exe",
    });
  });
  const sentinel = Buffer.from("old manifest");
  fs.writeFileSync(path.join(current.targetDir, "services.json"), sentinel);

  assert.throws(
    () => syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
    /safe runtime-root relative path/u,
  );
  assert.deepEqual(fs.readFileSync(path.join(current.targetDir, "services.json")), sentinel);
});

test("strict staging rejects a linked source bin directory", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const sourceBin = path.join(current.sourceRuntimeRoot, "bin");
  const realBin = path.join(current.root, "real-source-bin");
  fs.renameSync(sourceBin, realBin);
  fs.symlinkSync(realBin, sourceBin, process.platform === "win32" ? "junction" : "dir");

  assert.throws(
    () => syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
    /symbolic link or junction/u,
  );
});

test("strict staging rejects a linked target bin before changing manifests", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const outsideBin = path.join(current.root, "outside-target-bin");
  const targetBin = path.join(current.targetRuntimeRoot, "bin");
  fs.mkdirSync(outsideBin);
  fs.symlinkSync(outsideBin, targetBin, process.platform === "win32" ? "junction" : "dir");
  const sentinel = Buffer.from("old manifest");
  fs.writeFileSync(path.join(current.targetDir, "services.json"), sentinel);

  assert.throws(
    () => syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
    /symbolic link or junction/u,
  );
  assert.deepEqual(fs.readFileSync(path.join(current.targetDir, "services.json")), sentinel);
});

test("strict staging rejects hard-linked source and target bins where supported", async (t) => {
  await t.test("source", (sourceTest) => {
    const current = fixture();
    sourceTest.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
    const candidate = path.join(current.sourceRuntimeRoot, "bin", "ffmpeg.exe");
    const origin = path.join(current.root, "source-hard-link-origin.exe");
    fs.renameSync(candidate, origin);
    try {
      fs.linkSync(origin, candidate);
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "ENOTSUP") {
        sourceTest.skip(`hard links are unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    assert.throws(
      () => syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
      /ffmpeg\.exe.*exactly one hard link/u,
    );
  });

  await t.test("target", (targetTest) => {
    const current = fixture();
    targetTest.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
    syncDevRuntimeManifests({ ...current, stageRuntimeBins: true });
    const candidate = path.join(current.targetRuntimeRoot, "bin", "ffmpeg.exe");
    const alias = path.join(current.root, "target-hard-link-alias.exe");
    try {
      fs.linkSync(candidate, alias);
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "ENOTSUP") {
        targetTest.skip(`hard links are unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    assert.throws(
      () => syncDevRuntimeManifests({ ...current, stageRuntimeBins: true }),
      /ffmpeg\.exe.*exactly one hard link/u,
    );
  });
});
