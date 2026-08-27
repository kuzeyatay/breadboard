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

test("the dashboard-only Turbopack graph excludes Runtime-owned service trees", () => {
  const nextConfig = source("next.config.ts");
  const service = source("scripts/runtime-v2-mem0-service.mjs");
  const servicesManifest = source("../desktop/runtime-v2/manifests/services.json");
  assert.match(
    nextConfig,
    /const bundlerRoot = path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/,
  );
  assert.doesNotMatch(nextConfig, /const turbopackRoot|process\.cwd\(\), "\.\."/);
  assert.match(nextConfig, /outputFileTracingRoot:\s*bundlerRoot/);
  assert.match(nextConfig, /turbopack:\s*\{[\s\S]*?root:\s*bundlerRoot/);
  assert.doesNotMatch(nextConfig, /["']\.\.\//);
  assert.doesNotMatch(nextConfig, /mem0ai\/oss|mem0ai-oss-runtime/);
  assert.match(service, /import \{ Memory \} from "mem0ai\/oss"/);
  assert.match(servicesManifest, /"id": "mem0-semantic-engine"/);
  assert.match(servicesManifest, /dashboard\/scripts\/runtime-v2-mem0-service\.mjs/);
});

test("the server-level production trace excludes mutable dashboard data", () => {
  const nextConfig = source("next.config.ts");
  assert.match(nextConfig, /['"]next-server['"]:\s*dataTraceExcludes/);
});
