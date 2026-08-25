import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relative) =>
  fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("runtime install discovery cannot make Turbopack enumerate sibling workspaces", () => {
  const config = source("src/lib/cad/solidworks/config.ts");
  assert.match(
    config,
    /path\.join\(\/\* turbopackIgnore: true \*\/ base, name\)/,
  );
  assert.match(config, /existsSync\(\/\* turbopackIgnore: true \*\/ candidate\)/);
  assert.match(config, /statSync\(\/\* turbopackIgnore: true \*\/ candidate\)/);
  assert.match(config, /readdirSync\(\/\* turbopackIgnore: true \*\/ candidate\)/);
  assert.doesNotMatch(config, /C:\\Users\\/);
});

test("the repo-wide Turbopack graph resolves linked modules without bundling mem0 natives", () => {
  const nextConfig = source("next.config.ts");
  const bridge = source("src/lib/mem0/mem0ai-oss-runtime.ts");
  assert.match(
    nextConfig,
    /const bundlerRoot = path\.resolve\(process\.cwd\(\), "\.\."\)/,
  );
  assert.match(nextConfig, /outputFileTracingRoot:\s*bundlerRoot/);
  assert.match(nextConfig, /turbopack:\s*\{[\s\S]*?root:\s*bundlerRoot/);
  assert.match(
    nextConfig,
    /['"]mem0ai\/oss['"]:\s*['"]\.\/src\/lib\/mem0\/mem0ai-oss-runtime\.ts['"]/,
  );
  assert.match(bridge, /const importRuntimeExternal = Function\(/);
  assert.match(bridge, /importRuntimeExternal\("mem0ai\/oss"\)/);
  assert.doesNotMatch(bridge, /await import\("mem0ai\/oss"\)/);
});

test("the server-level production trace excludes mutable dashboard data", () => {
  const nextConfig = source("next.config.ts");
  assert.match(nextConfig, /['"]next-server['"]:\s*dataTraceExcludes/);
});
