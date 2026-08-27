import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { globTouchesMutableData, guardTraceOptions, isMutableDataPath } = require("../scripts/next-trace-guard.cjs");
const picomatch = require("../../dashboard/node_modules/next/dist/compiled/picomatch");

function dashboardTracePolicy() {
  const config = fs.readFileSync(
    new URL("../../dashboard/next.config.ts", import.meta.url),
    "utf8",
  );
  const declaration = config.match(/const dataTraceExcludes = \[([\s\S]*?)\n\];/);
  assert.ok(declaration, "next.config.ts must declare dataTraceExcludes");
  return {
    config,
    patterns: Array.from(
      declaration[1].matchAll(/^\s*["']([^"']+)["'],?\s*$/gm),
      (match) => match[1],
    ),
  };
}

test("Next trace globs cannot enter mutable dashboard data", () => {
  assert.equal(globTouchesMutableData("dashboard/**/*"), true);
  assert.equal(globTouchesMutableData("dashboard/db/**/*"), true);
  assert.equal(globTouchesMutableData("dashboard/src/**/*.ts"), false);
  assert.equal(globTouchesMutableData("dashboard/src/lib/runtime-paths.ts"), false);
});

test("one-shot NFT asset globs are never retained by the trace guard", () => {
  for (let index = 0; index < 4_096; index += 1) {
    assert.equal(
      globTouchesMutableData(`dashboard/src/generated-${index}/**/*`),
      false,
    );
    assert.equal(
      globTouchesMutableData(`dashboard/{db,generated-${index}}/**/*`),
      true,
    );
  }

  const guard = fs.readFileSync(
    new URL("../scripts/next-trace-guard.cjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(guard, /matcherCache|new Map\s*\(/);
});

test("build-time directory scans cannot enter mutable runtime roots", () => {
  assert.equal(isMutableDataPath(new URL("../../dashboard/db/profile", import.meta.url)), true);
  assert.equal(isMutableDataPath(new URL("../../dashboard/database/brain.db", import.meta.url)), true);
  assert.equal(isMutableDataPath(new URL("../../dashboard/src/lib", import.meta.url)), false);
  assert.deepEqual(fsReaddirSync(new URL("../../dashboard/db", import.meta.url)), []);
});

test("the trace guard preserves Next's existing ignore function", () => {
  const options = guardTraceOptions({ ignore: (candidate) => candidate === "already-ignored" });
  assert.equal(options.ignore("dashboard/**/*"), true);
  assert.equal(options.ignore("already-ignored"), true);
  assert.equal(options.ignore("dashboard/src/**/*.ts"), false);
});

test("the production trace policy excludes data and build roots without touching program roots", () => {
  const { patterns } = dashboardTracePolicy();
  const dashboard = fileURLToPath(new URL("../../dashboard/", import.meta.url))
    .split(path.sep)
    .join("/")
    .replace(/\/$/, "");
  const matchesPolicy = picomatch(
    patterns.map((pattern) => `${dashboard}/${pattern}`),
    { dot: true, contains: true },
  );
  const matches = (relative) => matchesPolicy(`${dashboard}/${relative}`);

  const denied = [
    ".claudeignore",
    ".gitignore",
    ".env.local",
    "AGENTS.md",
    "operator.log",
    ".tmp-runner.mjs",
    "tmp-status.py",
    "brain.db",
    "brain.db-shm",
    "brain.db-wal",
    "cache.sqlite",
    "cache.sqlite3-wal",
    "desktop.key",
    "desktop.pem",
    "desktop.p12",
    "desktop.pfx",
    "Video Project.mp4",
    "recording.mov",
    "recording.mkv",
    "recording.webm",
    "recording.avi",
    "recording.mp3",
    "recording.wav",
    "recording.m4a",
    "recording.ogg",
    "recording.flac",
    "bun.lock",
    "package-lock.json",
    "eslint.config.mjs",
    "next-env.d.ts",
    "next.config.ts",
    "postcss.config.mjs",
    "tsconfig.desktop.json",
    "tsconfig.tsbuildinfo",
    ".claude/settings.json",
    ".runtime/state.json",
    ".vercel/project.json",
    "artifacts/result.bin",
    "cad-projects/part.step",
    "chat-documents/document.pdf",
    "chat-videos/video.mp4",
    "database/brain.db",
    "db/profile/History",
    "goal-mode/state.json",
    "hyperframes-cli/bin/hyperframes.exe",
    "hyperframes-runs/run.json",
    "loopx-goals/goal.json",
    "openscience-cli/bin/openscience.exe",
    "openscience-state/state.json",
    "openscience-workspace/result.md",
    "openwork-runtime/bin/openwork.exe",
    "openwork-state/state.json",
    "openwork-workspace/task.md",
    "postiz/session.json",
    "video-use/session.json",
    "undefined/state.json",
    "tests/fixture.ts",
    "test-results/result.json",
    "neumorphic-before/screenshot.png",
    "neumorphic-after/screenshot.png",
    "scripts/build-helper.mjs",
    ".next/server/app.js",
    ".next-dev/server/app.js",
    ".next-memory-turbopack/server/app.js",
    ".next-production-webpack-final/server/app.js",
    ".next-stale-turbopack-1/server/app.js",
    "node_modules/@embedpdf/pdfium",
    "node_modules/@embedpdf/pdfium/index.js",
    "node_modules/@esbuild",
    "node_modules/@esbuild/win32-x64/esbuild.exe",
    "node_modules/esbuild",
    "node_modules/esbuild/lib/main.js",
    "node_modules/three",
    "node_modules/three/build/three.module.js",
    "node_modules/typescript",
    "node_modules/typescript/lib/typescript.js",
    "node_modules/parent/node_modules/esbuild/lib/main.js",
  ];
  for (const sample of denied) {
    assert.equal(matches(sample), true, `${sample} must be excluded from standalone traces`);
  }

  const allowed = [
    ".next-desktop/server/app/api/chat/route.js",
    ".next-desktop/standalone/server.js",
    "src/lib/runtime-v2/client.ts",
    "public/breadboard.svg",
    "node_modules/next/package.json",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "package.json",
  ];
  for (const sample of allowed) {
    assert.equal(matches(sample), false, `${sample} must remain available to standalone traces`);
  }
});

test("the data trace policy is global and contains no overbroad program-root exclusion", () => {
  const { config, patterns } = dashboardTracePolicy();
  assert.match(config, /['"]\/\*['"]:\s*dataTraceExcludes/);
  assert.match(config, /['"]\/\*\*['"]:\s*dataTraceExcludes/);
  assert.match(config, /['"]next-server['"]:\s*dataTraceExcludes/);

  for (const forbidden of [
    "**/*",
    ".next*/**",
    ".next-desktop/**",
    "src/**",
    "public/**",
    "node_modules/**",
    "package.json",
  ]) {
    assert.equal(patterns.includes(forbidden), false, `${forbidden} is too broad for the global denylist`);
  }
});

function fsReaddirSync(directory) {
  return require("node:fs").readdirSync(directory);
}

test("the standalone dashboard build uses the isolated Rust graph compiler", () => {
  const buildScript = fs.readFileSync(new URL("../scripts/build-dashboard.mjs", import.meta.url), "utf8");
  const leanScript = fs.readFileSync(new URL("../scripts/dev-fast.mjs", import.meta.url), "utf8");
  const nextConfig = fs.readFileSync(new URL("../../dashboard/next.config.ts", import.meta.url), "utf8");
  assert.match(buildScript, /const dashboardBuildHeapMb = 8_192/);
  assert.match(buildScript, /`--max-old-space-size=\$\{dashboardBuildHeapMb\}`/);
  assert.match(buildScript, /mem0\.status !== 0[\s\S]*process\.exit\(mem0\.status \?\? 1\)/);
  assert.doesNotMatch(buildScript, /mem0 provisioning failed[\s\S]*fall back to lexical/);
  assert.match(buildScript, /"--require",[\s\S]*traceGuard,[\s\S]*nextBin,[\s\S]*"build",[\s\S]*"--turbopack"/);
  assert.doesNotMatch(buildScript, /"--webpack"/);
  assert.match(leanScript, /:\s*11_264;/);
  assert.match(nextConfig, /webpackBuildWorker:\s*true/);
  assert.match(nextConfig, /const bundlerRoot = path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/);
  assert.doesNotMatch(nextConfig, /const turbopackRoot|process\.cwd\(\), "\.\."/);
  assert.match(nextConfig, /outputFileTracingRoot:\s*bundlerRoot/);
  assert.match(nextConfig, /turbopack:\s*\{[\s\S]*?root:\s*bundlerRoot/);
  assert.doesNotMatch(nextConfig, /["']\.\.\//);
  assert.match(nextConfig, /breadboard-learn-status-runtime[\s\S]*?learn-status-runtime\.production\.ts/);
  assert.match(nextConfig, /breadboard-learn-operation-runtime[\s\S]*?learn-operation-runtime\.production\.ts/);
  assert.match(nextConfig, /'pdf-parse':\s*'pdf-parse\/dist\/pdf-parse\/cjs\/index\.cjs'/);
});
