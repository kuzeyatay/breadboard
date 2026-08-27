import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertSafeDashboardTraces } from "../scripts/dashboard-trace-safety.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dashboard-trace-"));
  const manifest = path.join(
    root,
    "dashboard",
    ".next-desktop",
    "server",
    "app",
    "route.js.nft.json",
  );
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  return { root, manifest };
}

function writeTrace(manifest, targets) {
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      version: 1,
      files: targets.map((target) => path.relative(path.dirname(manifest), target)),
    }),
  );
}

test("safe dashboard program traces pass without filtering", () => {
  const { root, manifest } = fixture();
  const source = path.join(root, "dashboard", "src", "route.ts");
  const chunk = path.join(root, "dashboard", ".next-desktop", "server", "chunks", "route.js");
  const publicAsset = path.join(root, "dashboard", "public", "asset.svg");
  const dependency = path.join(root, "node_modules", "dependency", "index.js");
  const packageJson = path.join(root, "dashboard", "package.json");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(chunk), { recursive: true });
  fs.mkdirSync(path.dirname(publicAsset), { recursive: true });
  fs.mkdirSync(path.dirname(dependency), { recursive: true });
  fs.writeFileSync(source, "export {};\n");
  fs.writeFileSync(chunk, "// chunk\n");
  fs.writeFileSync(publicAsset, "<svg/>\n");
  fs.writeFileSync(dependency, "module.exports = {};\n");
  fs.writeFileSync(packageJson, "{}\n");
  writeTrace(manifest, [source, chunk, publicAsset, dependency, packageJson]);

  try {
    assert.deepEqual(assertSafeDashboardTraces(root), { manifests: 1, tracedFiles: 5 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard traces reject protected roots and normalized path escapes", () => {
  const { root, manifest } = fixture();
  const cases = [
    path.join(root, "dashboard", "src", "..", "db", "profile.sqlite"),
    path.join(root, "dashboard", ".env.local"),
    path.join(root, "dashboard", ".runtime", "worker.json"),
    path.join(root, "dashboard", "cad-projects", "project.json"),
    path.join(root, "dashboard", "chat-documents", "document.pdf"),
    path.join(root, "dashboard", "chat-videos", "video.mp4"),
    path.join(root, "dashboard", "goal-mode", "goal.json"),
    path.join(root, "dashboard", "hyperframes-runs", "run.json"),
    path.join(root, "dashboard", "loopx-goals", "goal.json"),
    path.join(root, "dashboard", "openwork-state", "runtime.sqlite"),
    path.join(root, "dashboard", "openscience-workspace", "job.json"),
    path.join(root, "dashboard", "postiz", "credentials.json"),
    path.join(root, "dashboard", "undefined", "cliproxy.key"),
    path.join(root, "dashboard", "video-use", "source.mp4"),
    path.join(root, "dashboard", "hyperframes-cli", "runtime.js"),
    path.join(root, "dashboard", "openscience-cli", "runtime.py"),
    path.join(root, "dashboard", "openwork-runtime", "server.ts"),
    path.join(root, ".runtime", "chromium", "Cookies"),
    path.join(root, ".git", "config"),
    path.join(root, "quartz", "content", "private.md"),
    path.join(root, "dashboard", "tests", "fixture.json"),
    path.join(root, "dashboard", ".next-production", "server.js"),
    path.join(root, "dashboard", ".next-stale-anything", "server.js"),
    path.join(root, "Resource2Skill", "core", "agent_executor.py"),
    path.join(root, "opencode", "packages", "runtime.js"),
    path.join(root, "hyperframes", "src", "index.ts"),
    path.join(root, "ruflo", "src", "index.ts"),
    path.join(root, "MatrAIx", "src", "index.py"),
    path.join(root, "deer-flow", "src", "server.py"),
    path.join(root, "DeepTutor", "src", "server.py"),
    path.join(root, "Vibe-Trading", "src", "main.py"),
  ];

  try {
    for (const target of cases) {
      writeTrace(manifest, [target]);
      assert.throws(
        () => assertSafeDashboardTraces(root),
        (error) => error?.code === "BREADBOARD_UNSAFE_DASHBOARD_TRACE",
        target,
      );
    }

    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside`, "secret.txt");
    writeTrace(manifest, [outside]);
    assert.throws(
      () => assertSafeDashboardTraces(root),
      (error) => error?.code === "BREADBOARD_UNSAFE_DASHBOARD_TRACE" && /escapes/.test(error.message),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard traces report every unsafe entry from a build before rejecting it", () => {
  const { root, manifest } = fixture();
  const agents = path.join(root, "dashboard", "AGENTS.md");
  const runtime = path.join(root, "dashboard", "hyperframes-runs", "owner.json");
  writeTrace(manifest, [agents, runtime]);

  try {
    assert.throws(
      () => assertSafeDashboardTraces(root),
      (error) =>
        error?.code === "BREADBOARD_UNSAFE_DASHBOARD_TRACE" &&
        Array.isArray(error.violations) &&
        error.violations.length === 2 &&
        error.message.includes("dashboard/AGENTS.md") &&
        error.message.includes("dashboard/hyperframes-runs/owner.json"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard traces reject dependency junctions into service source", () => {
  const { root, manifest } = fixture();
  const serviceSource = path.join(root, "external-service", "src");
  const serviceFile = path.join(serviceSource, "index.js");
  const dependencyLink = path.join(
    root,
    "dashboard",
    "node_modules",
    "external-service",
  );
  fs.mkdirSync(serviceSource, { recursive: true });
  fs.mkdirSync(path.dirname(dependencyLink), { recursive: true });
  fs.writeFileSync(serviceFile, "export {};\n");
  fs.symlinkSync(
    path.join(root, "external-service"),
    dependencyLink,
    process.platform === "win32" ? "junction" : "dir",
  );

  try {
    writeTrace(manifest, [path.join(dependencyLink, "src", "index.js")]);
    assert.throws(
      () => assertSafeDashboardTraces(root),
      (error) =>
        error?.code === "BREADBOARD_UNSAFE_DASHBOARD_TRACE" &&
        /approved standalone program roots/.test(error.message),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard traces reject compiler and renderer dependencies reserved for disposable workers", () => {
  const { root, manifest } = fixture();
  const cases = [
    ["dashboard", "node_modules", "esbuild", "lib", "main.js"],
    ["dashboard", "node_modules", "@esbuild", "win32-x64", "esbuild.exe"],
    ["node_modules", "typescript", "lib", "typescript.js"],
    ["node_modules", "wrapper", "node_modules", "three", "build", "three.module.js"],
    ["dashboard", "node_modules", "@embedpdf", "pdfium", "dist", "pdfium.wasm"],
  ];

  try {
    for (const segments of cases) {
      const target = path.join(root, ...segments);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "worker-only\n");
      writeTrace(manifest, [target]);
      assert.throws(
        () => assertSafeDashboardTraces(root),
        (error) =>
          error?.code === "BREADBOARD_UNSAFE_DASHBOARD_TRACE" &&
          /worker-only dependency/.test(error.message),
        target,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard traces reject invalid manifests instead of treating them as empty", () => {
  const { root, manifest } = fixture();
  fs.writeFileSync(manifest, "{\"version\":1}");
  try {
    assert.throws(
      () => assertSafeDashboardTraces(root),
      (error) => error?.code === "BREADBOARD_INVALID_DASHBOARD_TRACE",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
