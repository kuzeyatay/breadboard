import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

test("Next instrumentation owns no scheduler or gateway process", () => {
  const entry = read("src/instrumentation.ts");
  const runtime = read("src/instrumentation-runtime.ts");
  const background = read("scripts/runtime-v2-background-executor.mjs");
  assert.match(entry, /import\("\.\/instrumentation-runtime\.ts"\)/);
  assert.doesNotMatch(entry, /instrumentation-node/);
  assert.match(runtime, /startRuntimeMemorySampling\(\)/);
  assert.doesNotMatch(runtime, /startBackgroundCoordinator|child_process|setInterval|setTimeout/);
  assert.match(background, /case "scheduled-chats"/);
  assert.match(background, /operation === "gateway-reconcile"/);
  assert.equal(fs.existsSync(path.join(dashboardRoot, "src/instrumentation-node.ts")), false);
});

test("runtime diagnostics are bounded and token gated", () => {
  const telemetry = read("src/lib/runtime-memory.ts");
  const route = read("src/app/api/internal/runtime-memory/route.ts");
  assert.match(telemetry, /currentState\.history\.splice\(0, excess\)/);
  assert.match(telemetry, /process\.memoryUsage\(\)/);
  assert.match(telemetry, /getHeapSpaceStatistics\(\)/);
  assert.match(route, /BREADBOARD_SUPERVISOR_CONTROL_TOKEN/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /Cache-Control.*no-store/);
});

test("the Terminal loads as part of the dashboard startup sequence", () => {
  const dashboard = read("src/app/dashboard/dashboard-client.tsx");
  const lazyTerminal = read("src/app/components/hermes/lazy-dashboard-agent-terminal.tsx");
  assert.match(dashboard, /LazyDashboardAgentTerminal/);
  assert.match(lazyTerminal, /import DashboardAgentTerminal from "\.\/dashboard-agent-terminal"/);
  assert.match(lazyTerminal, /<DashboardAgentTerminal \{\.\.\.props\} \/>/);
  assert.doesNotMatch(
    lazyTerminal,
    /next\/dynamic|loading:|Loading Terminal|setEnabled|onClick|sessionStorage\.getItem/,
  );
});
