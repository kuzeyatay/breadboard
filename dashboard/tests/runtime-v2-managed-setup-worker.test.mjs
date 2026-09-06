import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  MANAGED_SETUP_OPERATIONS,
  executeManagedSetup,
  runManagedSetupCommand,
  validateManagedSetupRequest,
} from "../scripts/runtime-v2-managed-setup-executor.mjs";
import {
  loadRuntimeV2ManagedSetupLaunch,
  parseRuntimeV2ManagedSetupStopRecord,
} from "../scripts/runtime-v2-managed-setup-worker.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.dirname(dashboardRoot);
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-managed-setup-worker.mjs",
);

function jobFixture(request = {
  protocolVersion: 1,
  operation: "audio-analyzer",
  action: "check",
}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-managed-setup-job-"));
  const identity = {
    jobId: "job_managed_setup",
    attempt: 1,
    workerInstanceId: "worker_managed_setup",
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", identity.workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: { userId: 29, gardenId: null, conversationId: null },
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, identity, jobRoot, attemptRoot };
}

function fakeChild(output, after) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  setImmediate(() => {
    after?.();
    if (output) child.stdout.write(output);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });
  return child;
}

test("the operation registry is closed and rejects extra request fields", () => {
    assert.deepEqual(Object.keys(MANAGED_SETUP_OPERATIONS).sort(), [
      "acestep",
    "audio-analyzer",
    "bolt-slides",
    "career-ops",
    "claude-code",
    "comfyui",
    "deep-tutor",
    "deer-flow",
    "google-images",
    "hyperframes",
    "legal",
    "matraix",
    "money-printer",
    "openexecutive",
    "openmontage",
    "openscience",
    "openwork",
    "resource2skill",
    "shorts",
    "stock-analyst",
    "subsai",
    "tradingagents",
    "vibe-trading",
    "wardrobe",
  ]);
  assert.deepEqual(
    validateManagedSetupRequest({
      protocolVersion: 1,
      operation: "legal",
      action: "install",
    }),
    { protocolVersion: 1, operation: "legal", action: "install" },
  );
  assert.throws(
    () => validateManagedSetupRequest({
      protocolVersion: 1,
      operation: "legal",
      action: "install",
      command: "anything",
    }),
    /request is invalid/u,
  );
  assert.throws(
    () => validateManagedSetupRequest({
      protocolVersion: 1,
      operation: "arbitrary-shell",
      action: "install",
    }),
    /request is invalid/u,
  );
});

test("launch identity, user scope, identity-bound paths, and zero blobs are exact", (t) => {
  const current = jobFixture();
  t.after(() => fs.rmSync(current.dataRoot, { recursive: true, force: true }));
  const launch = loadRuntimeV2ManagedSetupLaunch(["start.json"], current.attemptRoot);
  assert.deepEqual(launch.identity, current.identity);
  assert.deepEqual(launch.executionScope, {
    userId: 29,
    gardenId: null,
    conversationId: null,
  });
  assert.deepEqual(launch.request, {
    protocolVersion: 1,
    operation: "audio-analyzer",
    action: "check",
  });

  const manifestPath = path.join(current.attemptRoot, "start.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.inputBlobs = [{ blobId: "forged" }];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => loadRuntimeV2ManagedSetupLaunch(["start.json"], current.attemptRoot),
    /unsupported shape/u,
  );
});

test("the cancellation record is exact, single-line, and bounded", () => {
  assert.deepEqual(
    parseRuntimeV2ManagedSetupStopRecord('{"type":"stop","force":false}\n'),
    { type: "stop", force: false },
  );
  assert.throws(
    () => parseRuntimeV2ManagedSetupStopRecord('{"type":"stop","force":true}\n'),
    /invalid/u,
  );
  assert.throws(
    () => parseRuntimeV2ManagedSetupStopRecord('{"type":"stop","force":false}\n{}\n'),
    /invalid/u,
  );
});

test("a managed Python install uses only an attached child and a data-root venv", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-managed-python-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-managed-python-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));

  const sourceRoot = path.join(appRoot, "harvey-labs");
  for (const relative of [
    ["harness", "agent_loop.py"],
    ["harness", "tools.py"],
    ["harness", "system_prompt.md"],
    ["sandbox", "sandbox.py"],
  ]) {
    const target = path.join(sourceRoot, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# fixture\n");
  }
  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const uv = path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv");
  fs.writeFileSync(uv, "fixture");
  const launches = [];
  const expectedVenv = path.join(dataRoot, "runtime-v2", "services", "legal", ".venv");
  const expectedPython = process.platform === "win32"
    ? path.join(expectedVenv, "Scripts", "python.exe")
    : path.join(expectedVenv, "bin", "python");
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const creating = args[0] === "venv";
    const verifying = command === expectedPython;
    return fakeChild(verifying ? "ok\n" : "", creating
      ? () => {
          fs.mkdirSync(path.dirname(expectedPython), { recursive: true });
          fs.writeFileSync(expectedPython, "fixture python");
        }
      : undefined);
  };

  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "legal", action: "install" },
    {
      dataRoot,
      appRoot,
      env: {
        PATH: tools,
        PATHEXT: ".EXE",
        OPENAI_API_KEY: "provider-secret",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
      },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(expectedPython), true);
  assert.equal(fs.existsSync(path.join(sourceRoot, ".venv")), false);
  assert.equal(launches.length, 3);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    assert.equal(launch.options.env.PYTHONDONTWRITEBYTECODE, "1");
  }
  assert.deepEqual(launches[0].args.slice(0, 3), ["venv", "--python", "3.13"]);
  assert.equal(launches[0].args[3], expectedVenv);
});

test("Google image search builds a copied source closure under Runtime data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-google-setup-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-google-setup-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "mcp-google-images-search");
  fs.mkdirSync(path.join(source, "src"), { recursive: true });
  fs.writeFileSync(path.join(source, "package.json"), '{"scripts":{"build:tsc":"tsc"}}\n');
  fs.writeFileSync(path.join(source, "package-lock.json"), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(source, "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(source, "src", "index.ts"), "export {};\n");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    return fakeChild("", args[0] === "run"
      ? () => fs.writeFileSync(path.join(options.cwd, "src", "index.js"), "export {};\n")
      : undefined);
  };
  const request = { protocolVersion: 1, operation: "google-images", action: "install" };
  const result = await executeManagedSetup(request, {
    dataRoot,
    appRoot,
    env: {
      PATH: process.env.PATH,
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
      GOOGLE_API_KEY: "provider-secret",
    },
    signal: new AbortController().signal,
    spawnImpl,
  });
  assert.equal(result.ok, true);
  const runtimeRoot = path.join(dataRoot, "runtime-v2", "toolchains", "google-images");
  assert.equal(fs.existsSync(path.join(runtimeRoot, "src", "index.js")), true);
  assert.equal(fs.existsSync(path.join(runtimeRoot, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(source, "src", "index.js")), false);
  assert.equal(launches.length, 2);
  assert.deepEqual(launches[0].args, [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.ok(launch.options.cwd.startsWith(path.join(dataRoot, "runtime-v2", "toolchains")));
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    assert.equal(launch.options.env.GOOGLE_API_KEY, undefined);
  }
  const check = await executeManagedSetup(
    { ...request, action: "check" },
    {
      dataRoot,
      appRoot,
      signal: new AbortController().signal,
      spawnImpl: () => { throw new Error("check must not spawn"); },
    },
  );
  assert.equal(check.ok, true);
});

test("Bolt Slides installs locked dependencies into a Runtime toolchain", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bolt-slides-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bolt-slides-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "bolt-slides");
  for (const relative of [
    ["index.html"],
    ["src", "deck", "Deck.tsx"],
    ["src", "styles", "tokens.css"],
  ]) {
    const target = path.join(source, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "fixture\n");
  }
  fs.writeFileSync(path.join(source, "package.json"), '{"name":"bolt-slides"}\n');
  fs.writeFileSync(path.join(source, "package-lock.json"), '{"lockfileVersion":3}\n');
  const packages = ["vite", "react", "react-dom", "framer-motion", "@vitejs/plugin-react"];
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const installing = args[0] === "ci";
    return fakeChild(installing ? "" : "6.0.0\n", installing
      ? () => {
          for (const name of packages) {
            const manifest = path.join(options.cwd, "node_modules", ...name.split("/"), "package.json");
            fs.mkdirSync(path.dirname(manifest), { recursive: true });
            fs.writeFileSync(manifest, "{}\n");
          }
          const vite = path.join(options.cwd, "node_modules", "vite", "bin", "vite.js");
          fs.mkdirSync(path.dirname(vite), { recursive: true });
          fs.writeFileSync(vite, "export {};\n");
        }
      : undefined);
  };
  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "bolt-slides", action: "install-dependencies" },
    {
      dataRoot,
      appRoot,
      env: { PATH: process.env.PATH, OPENAI_API_KEY: "provider-secret" },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  const toolchain = path.join(dataRoot, "runtime-v2", "toolchains", "bolt-slides");
  assert.equal(fs.existsSync(path.join(toolchain, "node_modules", "vite", "bin", "vite.js")), true);
  assert.equal(fs.existsSync(path.join(source, "node_modules")), false);
  assert.deepEqual(launches[0].args.slice(0, 3), ["ci", "--no-audit", "--no-fund"]);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
    assert.ok(launch.options.cwd.startsWith(dataRoot));
  }
});

test("Wardrobe stages its source and dependencies without mutating the clone", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-wardrobe-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-wardrobe-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "wardrobe");
  for (const relative of [
    ["index.html"],
    ["vite.config.mjs"],
    ["scripts", "import-job-api.mjs"],
    ["src", "main.jsx"],
    ["public", "fixture.txt"],
  ]) {
    const target = path.join(source, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "fixture\n");
  }
  fs.writeFileSync(path.join(source, "package.json"), '{"name":"wardrobe"}\n');
  fs.writeFileSync(path.join(source, "package-lock.json"), '{"lockfileVersion":3}\n');
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const installing = args[0] === "ci";
    return fakeChild(installing ? "" : "6.4.3\n", installing
      ? () => {
          const vite = path.join(options.cwd, "node_modules", "vite", "bin", "vite.js");
          const sharp = path.join(options.cwd, "node_modules", "sharp", "package.json");
          fs.mkdirSync(path.dirname(vite), { recursive: true });
          fs.mkdirSync(path.dirname(sharp), { recursive: true });
          fs.writeFileSync(vite, "export {};\n");
          fs.writeFileSync(sharp, "{}\n");
        }
      : undefined);
  };
  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "wardrobe", action: "install" },
    {
      dataRoot,
      appRoot,
      env: {
        PATH: process.env.PATH,
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
      },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  const runtime = path.join(dataRoot, "runtime-v2", "toolchains", "wardrobe");
  assert.equal(fs.existsSync(path.join(runtime, "scripts", "import-job-api.mjs")), true);
  assert.equal(fs.existsSync(path.join(runtime, "node_modules", "sharp", "package.json")), true);
  assert.equal(fs.existsSync(path.join(source, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(source, "data")), false);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    assert.ok(launch.options.cwd.startsWith(dataRoot));
  }
});

test("Career Ops keeps dependencies, browser files, and candidate state in Runtime data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-career-ops-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-career-ops-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "career-ops");
  const fixtures = new Map([
    ["doctor.mjs", "export {};\n"],
    ["package.json", '{"name":"career-ops"}\n'],
    ["package-lock.json", '{"lockfileVersion":3}\n'],
    [".agents/skills/career-ops/SKILL.md", "# fixture\n"],
    ["config/profile.example.yml", "name: example\n"],
    ["modes/_profile.template.md", "profile template\n"],
    ["modes/_custom.template.md", "custom template\n"],
    ["modes/_brief.template.md", "brief template\n"],
    ["examples/cv-example.md", "example cv\n"],
    ["templates/portals.example.yml", "portals: []\n"],
  ]);
  for (const [relative, content] of fixtures) {
    const target = path.join(source, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const installing = args[0] === "ci";
    const browserInstall = args.at(-2) === "install" && args.at(-1) === "chromium";
    return fakeChild("", () => {
      if (installing) {
        const yaml = path.join(options.cwd, "node_modules", "js-yaml", "package.json");
        const playwright = path.join(options.cwd, "node_modules", "playwright", "cli.js");
        fs.mkdirSync(path.dirname(yaml), { recursive: true });
        fs.mkdirSync(path.dirname(playwright), { recursive: true });
        fs.writeFileSync(yaml, "{}\n");
        fs.writeFileSync(playwright, "export {};\n");
      }
      if (browserInstall) {
        fs.mkdirSync(
          path.join(options.env.PLAYWRIGHT_BROWSERS_PATH, "chromium-fixture"),
          { recursive: true },
        );
      }
    });
  };
  const context = {
    dataRoot,
    appRoot,
    env: { PATH: process.env.PATH, OPENAI_API_KEY: "provider-secret" },
    signal: new AbortController().signal,
    spawnImpl,
  };
  const installed = await executeManagedSetup(
    { protocolVersion: 1, operation: "career-ops", action: "install" },
    context,
  );
  assert.equal(installed.ok, true);
  const runtime = path.join(dataRoot, "runtime-v2", "toolchains", "career-ops");
  assert.equal(fs.existsSync(path.join(runtime, "node_modules", "js-yaml", "package.json")), true);
  assert.equal(fs.existsSync(path.join(source, "node_modules")), false);
  const scaffolded = await executeManagedSetup(
    { protocolVersion: 1, operation: "career-ops", action: "scaffold" },
    { ...context, spawnImpl: () => { throw new Error("scaffold must not spawn"); } },
  );
  assert.equal(scaffolded.ok, true);
  const cv = path.join(runtime, "cv.md");
  assert.equal(fs.readFileSync(cv, "utf8"), "example cv\n");
  fs.writeFileSync(cv, "my durable cv\n");
  const reinstalled = await executeManagedSetup(
    { protocolVersion: 1, operation: "career-ops", action: "install" },
    context,
  );
  assert.equal(reinstalled.ok, true);
  assert.equal(fs.readFileSync(cv, "utf8"), "my durable cv\n");
  const browsers = await executeManagedSetup(
    { protocolVersion: 1, operation: "career-ops", action: "browsers" },
    context,
  );
  assert.equal(browsers.ok, true);
  assert.equal(
    fs.existsSync(path.join(dataRoot, "runtime-v2", "toolchains", "career-ops-browsers", "chromium-fixture")),
    true,
  );
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
  }
});

test("ComfyUI stages source, Python, status, and mutable roots only under Runtime data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-comfyui-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-comfyui-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));

  const source = path.join(appRoot, "comfyui");
  const fixtures = new Map([
    ["main.py", "# fixed staged entry\n"],
    ["requirements.txt", "aiohttp==3.12.0\n"],
    ["folder_paths.py", "# fixed folder paths\n"],
    ["server.py", "# fixed server\n"],
    ["comfy/__init__.py", "# fixed package\n"],
    ["models/checkpoints/source-only.safetensors", "must not be staged\n"],
    ["output/source-only.png", "must not be staged\n"],
    ["tests/test_source.py", "must not be staged\n"],
  ]);
  for (const [relative, content] of fixtures) {
    const target = path.join(source, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const untrusted = path.join(appRoot, "untrusted-comfyui");
  fs.mkdirSync(untrusted);
  fs.writeFileSync(path.join(untrusted, "main.py"), "# untrusted\n");

  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const uv = path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv");
  fs.writeFileSync(uv, "fixture");
  const runtime = path.join(dataRoot, "runtime-v2", "toolchains", "comfyui");
  const venv = path.join(dataRoot, "runtime-v2", "services", "comfyui", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const creating = command === uv && args[0] === "venv";
    const verifying = command === python && args.includes("import torch; import server; print('ok')");
    const torch = command === python && args.includes("torch");
    return fakeChild(
      verifying
        ? "ok\n"
        : torch
          ? "Downloading torch-2.6.0%2Bcpu-cp312.whl\nProgress 10 of 20\n"
          : "",
      creating
        ? () => {
            fs.mkdirSync(path.dirname(python), { recursive: true });
            fs.writeFileSync(python, "fixture python");
          }
        : undefined,
    );
  };

  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "comfyui", action: "install" },
    {
      dataRoot,
      appRoot,
      env: {
        PATH: tools,
        PATHEXT: ".EXE",
        COMFYUI_ROOT: untrusted,
        OPENAI_API_KEY: "provider-secret",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
      },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(runtime, "main.py"), "utf8"), "# fixed staged entry\n");
  assert.equal(fs.existsSync(path.join(runtime, "models")), false);
  assert.equal(fs.existsSync(path.join(runtime, "output")), false);
  assert.equal(fs.existsSync(path.join(runtime, "tests")), false);
  assert.equal(fs.existsSync(path.join(source, ".venv")), false);
  assert.equal(fs.existsSync(path.join(source, ".breadboard-comfyui-ready")), false);
  assert.equal(fs.existsSync(path.join(venv, ".breadboard-comfyui-ready")), true);
  for (const name of ["custom_nodes", "input", "models", "output", "temp", "user"]) {
    assert.equal(fs.existsSync(path.join(dataRoot, "comfyui", name)), true, name);
  }
  const status = JSON.parse(fs.readFileSync(
    path.join(dataRoot, "runtime-v2", "services", "comfyui", "startup-status.json"),
    "utf8",
  ));
  assert.equal(status.phase, "installed");
  assert.equal(status.pid, process.pid);
  assert.equal(launches.length, 5);
  assert.deepEqual(launches[0].args, ["venv", "--seed", "--python", "3.12", venv]);
  const torchInstall = launches.find((launch) => launch.args.includes("torch"));
  const dependencyInstall = launches.find((launch) => launch.args.includes("-r"));
  assert.ok(torchInstall);
  assert.ok(dependencyInstall);
  assert.equal(dependencyInstall.args.at(-1), path.join(runtime, "requirements.txt"));
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.cwd, runtime);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
  }
});

test("Claude account status and logout use only the fixed CLI with its credential-owning home", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-claude-account-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-claude-account-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const appData = path.join(dataRoot, "fixture-appdata");
  const command = path.join(
    appData,
    "SPB_Data",
    ".local",
    "bin",
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.writeFileSync(command, "fixture executable");
  const launches = [];
  const spawnImpl = (executable, args, options) => {
    launches.push({ executable, args, options });
    return fakeChild(
      args.includes("status")
        ? '{"loggedIn":true,"authMethod":"oauth","email":"person@example.com","subscriptionType":"max"}\n'
        : "Signed out\n",
    );
  };
  const context = {
    dataRoot,
    appRoot,
    env: {
      APPDATA: appData,
      USERPROFILE: dataRoot,
      PATH: "",
      OPENAI_API_KEY: "provider-secret",
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
    },
    signal: new AbortController().signal,
    spawnImpl,
  };
  const status = await executeManagedSetup(
    { protocolVersion: 1, operation: "claude-code", action: "status" },
    context,
  );
  assert.equal(status.ok, true);
  assert.deepEqual(JSON.parse(status.detail), {
    installed: true,
    loggedIn: true,
    authMethod: "oauth",
    email: "person@example.com",
    subscriptionType: "max",
    error: null,
  });
  const logout = await executeManagedSetup(
    { protocolVersion: 1, operation: "claude-code", action: "logout" },
    context,
  );
  assert.equal(logout.ok, true);
  assert.equal(launches.length, 2);
  assert.deepEqual(launches[0].args, ["auth", "status", "--json"]);
  assert.deepEqual(launches[1].args, ["auth", "logout"]);
  for (const launch of launches) {
    assert.equal(launch.executable, fs.realpathSync.native(command));
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.cwd, dataRoot);
    assert.equal(launch.options.env.APPDATA, appData);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
  }
});

test("Resource2Skill installs Python and Chromium only under Runtime service data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-resource2skill-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-resource2skill-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "Resource2Skill");
  fs.mkdirSync(path.join(source, "core"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(source, "cli.py"), "# fixture\n");
  fs.writeFileSync(path.join(source, "core", "agent_executor.py"), "# fixture\n");
  fs.writeFileSync(path.join(source, "requirements.txt"), "mcp==1.0.0\n");
  fs.writeFileSync(path.join(appRoot, "scripts", "resource2skill-bridge.py"), "# fixture\n");
  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const uv = path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv");
  fs.writeFileSync(uv, "fixture");
  const venv = path.join(dataRoot, "runtime-v2", "services", "resource2skill", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const browserRoot = path.join(
    dataRoot,
    "runtime-v2",
    "services",
    "resource2skill",
    "browsers",
  );
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const creating = args[0] === "venv";
    const browserInstall = args.at(-2) === "install" && args.at(-1) === "chromium";
    const checking = command === python && args.includes("--check");
    return fakeChild(
      checking ? '{"event":"check.completed","python":"3.11.9"}\n' : "",
      () => {
        if (creating) {
          fs.mkdirSync(path.dirname(python), { recursive: true });
          fs.writeFileSync(python, "fixture python");
        }
        if (browserInstall) {
          fs.mkdirSync(path.join(options.env.PLAYWRIGHT_BROWSERS_PATH, "chromium-fixture"), {
            recursive: true,
          });
        }
      },
    );
  };
  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "resource2skill", action: "install-web" },
    {
      dataRoot,
      appRoot,
      env: {
        PATH: tools,
        PATHEXT: ".EXE",
        OPENAI_API_KEY: "provider-secret",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
      },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(python), true);
  assert.equal(fs.existsSync(path.join(venv, "breadboard-runtime.json")), true);
  assert.equal(fs.existsSync(path.join(browserRoot, "chromium-fixture")), true);
  assert.equal(fs.existsSync(path.join(source, ".venv")), false);
  assert.equal(fs.existsSync(path.join(source, "browsers")), false);
  assert.equal(launches.length, 4);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
  }
  const checkLaunch = launches.at(-1);
  assert.equal(checkLaunch.options.env.PLAYWRIGHT_BROWSERS_PATH, browserRoot);
  assert.equal(checkLaunch.options.cwd, source);
});

test("OpenMontage stages its runtime, Python, and Remotion under Runtime data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openmontage-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openmontage-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "OpenMontage");
  const fixtures = new Map([
    ["AGENT_GUIDE.md", "# fixture\n"],
    ["requirements.txt", "pyyaml>=6\n"],
    ["tools/tool_registry.py", "# fixture\n"],
    ["remotion-composer/package.json", '{"name":"openmontage-remotion"}\n'],
    ["remotion-composer/package-lock.json", '{"lockfileVersion":3}\n'],
    ["remotion-composer/src/index.tsx", "export {};\n"],
    [".env", "OPENAI_API_KEY=fixture\n"],
    ["node_modules/legacy/package.json", "{}\n"],
  ]);
  for (const [relative, content] of fixtures) {
    const target = path.join(source, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const uv = path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv");
  fs.writeFileSync(uv, "fixture");
  const runtime = path.join(dataRoot, "runtime-v2", "toolchains", "openmontage");
  const venv = path.join(dataRoot, "runtime-v2", "services", "openmontage", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const creating = args[0] === "venv";
    const verifying = command === python;
    const npmInstall = args[0] === "ci";
    return fakeChild(verifying ? "ok\n" : "", () => {
      if (creating) {
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, "fixture python");
      }
      if (npmInstall) {
        const manifest = path.join(options.cwd, "node_modules", "remotion", "package.json");
        fs.mkdirSync(path.dirname(manifest), { recursive: true });
        fs.writeFileSync(manifest, "{}\n");
      }
    });
  };
  const context = {
    dataRoot,
    appRoot,
    env: {
      PATH: tools,
      PATHEXT: ".EXE",
      OPENMONTAGE_ROOT: runtime,
      OPENAI_API_KEY: "provider-secret",
    },
    signal: new AbortController().signal,
    spawnImpl,
  };
  const dependencies = await executeManagedSetup(
    { protocolVersion: 1, operation: "openmontage", action: "install-dependencies" },
    context,
  );
  assert.equal(dependencies.ok, true);
  assert.equal(fs.existsSync(path.join(runtime, "tools", "tool_registry.py")), true);
  assert.equal(fs.existsSync(path.join(runtime, "node_modules")), false);
  assert.equal(fs.existsSync(python), true);
  assert.equal(fs.existsSync(path.join(source, ".venv")), false);
  const remotion = await executeManagedSetup(
    { protocolVersion: 1, operation: "openmontage", action: "install-remotion" },
    context,
  );
  assert.equal(remotion.ok, true);
  assert.equal(
    fs.existsSync(path.join(runtime, "remotion-composer", "node_modules", "remotion", "package.json")),
    true,
  );
  assert.equal(fs.existsSync(path.join(source, "remotion-composer", "node_modules")), false);
  const npmLaunch = launches.at(-1);
  assert.deepEqual(npmLaunch.args.slice(0, 3), ["ci", "--no-audit", "--no-fund"]);
  assert.equal(npmLaunch.options.cwd, path.join(runtime, "remotion-composer"));
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
  }
});

test("MoneyPrinter stages writable config and storage under Runtime data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-money-printer-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-money-printer-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "MoneyPrinterTurbo");
  const fixtures = new Map([
    ["app/asgi.py", "# fixture\n"],
    ["app/services/task.py", "# fixture\n"],
    ["config.example.toml", "[app]\n"],
    ["config.toml", "[app]\noneapi_api_key = \"user-value\"\n"],
    ["requirements.txt", "uvicorn>=0.32\n"],
    ["pyproject.toml", '[project]\nname = "moneyprinterturbo"\n'],
    ["uv.lock", "version = 1\n"],
    ["storage/local_videos/fixture.mp4", "fixture video\n"],
    [".venv/legacy.txt", "legacy\n"],
  ]);
  for (const [relative, content] of fixtures) {
    const target = path.join(source, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const uv = path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv");
  fs.writeFileSync(uv, "fixture");
  const runtime = path.join(dataRoot, "runtime-v2", "toolchains", "money-printer");
  const venv = path.join(dataRoot, "runtime-v2", "services", "money-printer", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const syncing = args[0] === "sync";
    const verifying = command === python;
    return fakeChild(verifying ? "ok\n" : "", syncing
      ? () => {
          fs.mkdirSync(path.dirname(python), { recursive: true });
          fs.writeFileSync(python, "fixture python");
        }
      : undefined);
  };
  const context = {
    dataRoot,
    appRoot,
    env: {
      PATH: tools,
      PATHEXT: ".EXE",
      MONEY_PRINTER_ROOT: runtime,
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
    },
    signal: new AbortController().signal,
    spawnImpl,
  };
  const installed = await executeManagedSetup(
    { protocolVersion: 1, operation: "money-printer", action: "install" },
    context,
  );
  assert.equal(installed.ok, true);
  assert.equal(fs.existsSync(path.join(runtime, "app", "asgi.py")), true);
  assert.match(fs.readFileSync(path.join(runtime, "config.toml"), "utf8"), /user-value/u);
  assert.equal(fs.existsSync(path.join(runtime, "storage", "local_videos", "fixture.mp4")), true);
  assert.equal(fs.existsSync(path.join(runtime, ".venv")), false);
  assert.equal(fs.existsSync(python), true);
  assert.equal(launches[0].options.cwd, runtime);
  assert.equal(launches[0].options.env.UV_PROJECT_ENVIRONMENT, venv);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
  }
  const removed = await executeManagedSetup(
    { protocolVersion: 1, operation: "money-printer", action: "remove" },
    { ...context, spawnImpl: () => { throw new Error("remove must not spawn"); } },
  );
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(venv), false);
  assert.equal(fs.existsSync(path.join(runtime, "storage", "local_videos", "fixture.mp4")), true);
});

test("HyperFrames installs the clone-pinned CLI only under Runtime data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hyperframes-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hyperframes-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "hyperframes");
  fs.mkdirSync(path.join(source, "skills", "hyperframes"), { recursive: true });
  fs.mkdirSync(path.join(source, "packages", "cli"), { recursive: true });
  fs.writeFileSync(path.join(source, "skills", "hyperframes", "SKILL.md"), "# fixture\n");
  fs.writeFileSync(path.join(source, "packages", "cli", "package.json"), '{"version":"1.2.3"}\n');
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const installing = args[0] === "install";
    return fakeChild(installing ? "" : "1.2.3\n", installing
      ? () => {
          const entry = path.join(
            options.cwd,
            "node_modules",
            "hyperframes",
            "bin",
            "hyperframes.mjs",
          );
          fs.mkdirSync(path.dirname(entry), { recursive: true });
          fs.writeFileSync(entry, "export {};\n");
        }
      : undefined);
  };
  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "hyperframes", action: "install-cli" },
    {
      dataRoot,
      appRoot,
      env: { PATH: process.env.PATH, OPENAI_API_KEY: "provider-secret" },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(
    fs.existsSync(path.join(dataRoot, "hyperframes-cli", "node_modules", "hyperframes", "bin", "hyperframes.mjs")),
    true,
  );
  assert.equal(fs.existsSync(path.join(source, "node_modules")), false);
  assert.match(launches[0].args[1], /^hyperframes@1\.2\.3$/u);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
    assert.ok(launch.options.cwd.startsWith(dataRoot));
  }
});

test("OpenScience installs its pinned CLI and creates an isolated data workspace", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openscience-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openscience-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "openscience", "backend", "cli");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "package.json"), '{"version":"2.3.4"}\n');
  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const git = path.join(tools, process.platform === "win32" ? "git.EXE" : "git");
  fs.writeFileSync(git, "fixture");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const installing = args[0] === "install";
    const initializing = args[0] === "init";
    return fakeChild(installing || initializing ? "" : "2.3.4\n", () => {
      if (installing) {
        const entry = path.join(
          options.cwd,
          "node_modules",
          "@synsci",
          "openscience",
          "bin",
          "openscience",
        );
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, "#!/usr/bin/env node\n");
      }
      if (initializing) fs.mkdirSync(path.join(options.cwd, ".git"));
    });
  };
  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "openscience", action: "install" },
    {
      dataRoot,
      appRoot,
      env: {
        PATH: tools,
        PATHEXT: ".EXE",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
      },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(
    fs.existsSync(path.join(dataRoot, "openscience-cli", "node_modules", "@synsci", "openscience", "bin", "openscience")),
    true,
  );
  const workspace = path.join(dataRoot, "openscience-workspace");
  assert.equal(fs.existsSync(path.join(workspace, "package.json")), true);
  assert.equal(fs.existsSync(path.join(workspace, ".git")), true);
  assert.equal(fs.existsSync(path.join(appRoot, "openscience", "node_modules")), false);
  assert.equal(launches.length, 3);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    assert.ok(launch.options.cwd.startsWith(dataRoot));
  }
});

test("OpenWork copies a bounded source closure and installs only in Runtime data", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openwork-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openwork-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const source = path.join(appRoot, "openwork");
  for (const relative of [
    ["apps", "server", "src", "cli.ts"],
    ["packages", "paths", "index.ts"],
    ["packages", "types", "index.ts"],
    ["constants.json"],
  ]) {
    const target = path.join(source, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, relative.at(-1) === "constants.json" ? "{}\n" : "export {};\n");
  }
  fs.writeFileSync(
    path.join(source, "apps", "server", "package.json"),
    '{"name":"@openwork/server","version":"3.4.5","dependencies":{"@opencode-ai/sdk":"1.0.0"}}\n',
  );
  const bun = path.join(dataRoot, process.platform === "win32" ? "bun.exe" : "bun");
  fs.writeFileSync(bun, "fixture");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    const installing = args[0] === "install";
    return fakeChild(installing ? "installed\n" : "1.2.0\n", installing
      ? () => fs.mkdirSync(
          path.join(options.cwd, "node_modules", "@opencode-ai", "sdk"),
          { recursive: true },
        )
      : undefined);
  };
  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "openwork", action: "prepare-server" },
    {
      dataRoot,
      appRoot,
      env: {
        PATH: process.env.PATH,
        OPENWORK_BUN_PATH: bun,
        OPENAI_API_KEY: "provider-secret",
      },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  const prepared = path.join(dataRoot, "openwork-runtime");
  assert.equal(fs.existsSync(path.join(prepared, "apps", "server", "src", "cli.ts")), true);
  assert.equal(
    fs.existsSync(path.join(prepared, "apps", "server", "node_modules", "@opencode-ai", "sdk")),
    true,
  );
  assert.equal(fs.existsSync(path.join(prepared, "breadboard-source.json")), true);
  assert.equal(fs.existsSync(path.join(source, "apps", "server", "node_modules")), false);
  assert.equal(launches.length, 2);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
  }
});

test("MatrAIx installs into its Runtime service venv without an editable source write", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-matraix-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-matraix-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const root = path.join(appRoot, "MatrAIx-Persona-8B");
  for (const relative of [
    ["environment", "runtime", "harbor", "README.md"],
    ["src", "matraix", "cli.py"],
    ["pyproject.toml"],
    ["packages", "playground", "pyproject.toml"],
  ]) {
    const target = path.join(root, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# fixture\n");
  }
  const bridge = path.join(appRoot, "scripts", "matraix-bridge.py");
  fs.mkdirSync(path.dirname(bridge));
  fs.writeFileSync(bridge, "# fixture\n");
  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const uv = path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv");
  fs.writeFileSync(uv, "fixture");
  const venv = path.join(dataRoot, "runtime-v2", "services", "matraix", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    return fakeChild(command === python ? '{"event":"check.ok"}\n' : "", args[0] === "venv"
      ? () => {
          fs.mkdirSync(path.dirname(python), { recursive: true });
          fs.writeFileSync(python, "fixture");
        }
      : undefined);
  };
  const result = await executeManagedSetup(
    { protocolVersion: 1, operation: "matraix", action: "install-runtime" },
    {
      dataRoot,
      appRoot,
      env: { PATH: tools, PATHEXT: ".EXE", OPENAI_API_KEY: "provider-secret" },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(python), true);
  assert.equal(fs.existsSync(path.join(root, ".venv")), false);
  const install = launches.find((launch) => launch.args[0] === "pip");
  assert.ok(install);
  assert.equal(install.args.includes("-e"), false);
  assert.ok(install.args.includes(root));
  assert.ok(install.args.includes(path.join(root, "packages", "playground")));
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
  }
});

test("subsai builds and removes only its Runtime service environment", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-subsai-data-"));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-subsai-app-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  const root = path.join(appRoot, "subsai");
  for (const relative of [
    ["src", "subsai", "cli.py"],
    ["src", "subsai", "configs.py"],
    ["pyproject.toml"],
  ]) {
    const target = path.join(root, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# fixture\n");
  }
  const tools = path.join(dataRoot, "fixture-tools");
  fs.mkdirSync(tools);
  const uv = path.join(tools, process.platform === "win32" ? "uv.EXE" : "uv");
  fs.writeFileSync(uv, "fixture");
  const venv = path.join(dataRoot, "runtime-v2", "services", "subsai", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const launches = [];
  const spawnImpl = (command, args, options) => {
    launches.push({ command, args, options });
    return fakeChild(command === python ? "ok\n" : "", args[0] === "venv"
      ? () => {
          fs.mkdirSync(path.dirname(python), { recursive: true });
          fs.writeFileSync(python, "fixture");
        }
      : undefined);
  };
  const build = await executeManagedSetup(
    { protocolVersion: 1, operation: "subsai", action: "build-subtitles" },
    {
      dataRoot,
      appRoot,
      env: {
        PATH: tools,
        PATHEXT: ".EXE",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "runtime-secret",
      },
      signal: new AbortController().signal,
      spawnImpl,
    },
  );
  assert.equal(build.ok, true);
  assert.equal(fs.existsSync(path.join(venv, "breadboard-models.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".venv")), false);
  const dependencyInstall = launches.find((launch) => launch.args.includes("torch==2.2.0"));
  const packageInstall = launches.find((launch) => launch.args.includes("--no-deps"));
  assert.ok(dependencyInstall);
  assert.ok(packageInstall);
  assert.equal(packageInstall.args.at(-1), root);
  for (const launch of launches) {
    assert.equal(launch.options.detached, false);
    assert.equal(launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
  }
  const removed = await executeManagedSetup(
    { protocolVersion: 1, operation: "subsai", action: "remove-subtitles" },
    {
      dataRoot,
      appRoot,
      signal: new AbortController().signal,
      spawnImpl: () => { throw new Error("remove must not spawn"); },
    },
  );
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(venv), false);
});

test("cancellation kills the attached command root", async () => {
  const controller = new AbortController();
  let killed = false;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
      setImmediate(() => child.emit("close", null, null));
      return true;
    };
    setImmediate(() => controller.abort(new DOMException("cancelled", "AbortError")));
    return child;
  };
  await assert.rejects(
    runManagedSetupCommand("fixed", ["fixed"], {
      cwd: os.tmpdir(),
      env: {},
      signal: controller.signal,
      timeoutMs: 30_000,
      spawnImpl,
    }),
    /cancelled/u,
  );
  assert.equal(killed, true);
});

test("one fresh check worker writes a fenced result and exits", async (t) => {
  const current = jobFixture();
  t.after(() => fs.rmSync(current.dataRoot, { recursive: true, force: true }));
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env: { ...process.env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-32 * 1024); });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The managed setup worker did not exit."));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  const events = stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(events[0].type, "ready");
  assert.equal(events.at(-1).type, "complete");
  const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
  assert.deepEqual(result.identity, current.identity);
  assert.equal(result.completionSequence, events.at(-1).sequence);
  assert.equal(result.result.ok, false);
  assert.match(result.result.message, /not installed/u);
});

test("migrated setup routes have no direct installer fallback", () => {
  const services = [
    "bolt-slides",
    "career-ops",
    "deep-tutor",
    "deer-flow",
    "hyperframes",
    "legal",
    "matraix",
    "money-printer",
    "openmontage",
    "openscience",
    "openwork",
    "resource2skill",
    "shorts",
    "stock-analyst",
    "tradingagents",
    "vibe-trading",
    "wardrobe",
  ];
  for (const serviceId of services) {
    const route = fs.readFileSync(
      path.join(dashboardRoot, "src", "app", "api", serviceId, "setup", "route.ts"),
      "utf8",
    );
    const setup = fs.readFileSync(
      path.join(dashboardRoot, "src", "lib", serviceId, "setup.ts"),
      "utf8",
    );
    assert.match(route, /runManagedSetupJob\(\{/u, serviceId);
    assert.match(route, /signal: request\.signal/u, serviceId);
    assert.doesNotMatch(route, /node:child_process|\bspawn\s*\(|runSetupAction/u, serviceId);
    assert.doesNotMatch(
      setup,
      /node:child_process|\bspawn\s*\(|runCommand|rmSync|stopService/u,
      serviceId,
    );
  }
  const videoUseRoute = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "video-use", "setup", "route.ts"),
    "utf8",
  );
  const subsaiSetup = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "subsai", "setup.ts"),
    "utf8",
  );
  assert.match(videoUseRoute, /serviceId: "subsai"/u);
  assert.match(videoUseRoute, /signal: request\.signal/u);
  assert.doesNotMatch(videoUseRoute, /node:child_process|\bspawn\s*\(|buildEnvironment|removeEnvironment/u);
  assert.doesNotMatch(subsaiSetup, /node:child_process|\bspawn\s*\(|rmSync|run\(/u);
  const comfyUiRoute = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "comfyui", "route.ts"),
    "utf8",
  );
  const comfyUiServer = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "comfyui", "server.ts"),
    "utf8",
  );
  assert.match(comfyUiRoute, /submitManagedSetupJob\(\{/u);
  assert.match(comfyUiRoute, /serviceId: "comfyui"/u);
  assert.match(comfyUiRoute, /signal: request\.signal/u);
  assert.doesNotMatch(comfyUiRoute, /node:child_process|\bspawn\s*\(|detached:/u);
  assert.doesNotMatch(comfyUiServer, /node:child_process|\bspawn\s*\(|detached:/u);
  const client = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "runtime-v2", "managed-setup-job.ts"),
    "utf8",
  );
  assert.match(client, /jobType: "managed-setup"/u);
  assert.match(client, /operation: input\.serviceId/u);
  assert.match(client, /export async function submitManagedSetupJob/u);
  assert.match(client, /cancelRuntimeJob\(jobAuthority, jobId\)/u);
});

test("the setup worker source closure is self-contained and has no dynamic app module dispatch", () => {
  const executor = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-managed-setup-executor.mjs"),
    "utf8",
  );
  const worker = fs.readFileSync(workerPath, "utf8");
  assert.doesNotMatch(executor, /pathToFileURL|DYNAMIC_SETUP_DISPATCH|sourceRoot/u);
  assert.doesNotMatch(worker, /worker-src|sourceRoot/u);
  assert.match(executor, /detached: false/u);
  assert.match(executor, /PYTHONDONTWRITEBYTECODE = "1"/u);
});

test("Claude account routes cross the authenticated finite-job boundary", () => {
  const implementation = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "claude-code.ts"),
    "utf8",
  );
  const client = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "runtime-v2", "claude-account-job.ts"),
    "utf8",
  );
  assert.doesNotMatch(implementation, /node:child_process|\bexecFile\s*\(|\bspawn\s*\(/u);
  assert.match(implementation, /runClaudeAccountJob\(\{/u);
  assert.match(client, /jobType: "claude-account"/u);
  assert.match(client, /workerKind !== "claude-account-node"/u);
  assert.match(client, /cancelRuntimeJob\(jobAuthority, jobId\)/u);
  assert.match(client, /operation: "claude-code"/u);
  for (const relative of [
    ["cliproxy", "login", "route.ts"],
    ["cliproxy", "accounts", "route.ts"],
    ["cliproxy", "status", "route.ts"],
    ["cliproxy", "sync", "route.ts"],
  ]) {
    const route = fs.readFileSync(
      path.join(dashboardRoot, "src", "app", "api", ...relative),
      "utf8",
    );
    assert.match(route, /requireUserId\(\)/u);
    assert.doesNotMatch(route, /node:child_process|\bexecFile\s*\(|\bspawn\s*\(/u);
  }
});

test("developer provisioning scripts are explicit external boundaries with no product caller", () => {
  for (const name of ["setup-audio-analyzer.mjs", "setup-google-images.mjs"]) {
    const script = fs.readFileSync(path.join(repositoryRoot, "scripts", name), "utf8");
    assert.match(script, /EXTERNAL PROVISIONING BOUNDARY/u);
  }
  const productSources = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) {
        productSources.push(fs.readFileSync(target, "utf8"));
      }
    }
  };
  visit(path.join(repositoryRoot, "dashboard", "src"));
  visit(path.join(repositoryRoot, "desktop", "src"));
  const product = productSources.join("\n");
  assert.doesNotMatch(product, /setup-audio-analyzer\.mjs|setup-google-images\.mjs/u);
});
