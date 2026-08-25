import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

test("Next instrumentation keeps scheduler imports in a child coordinator", () => {
  const entry = read("src/instrumentation.ts");
  const runtime = read("src/instrumentation-runtime.ts");
  const background = read("src/instrumentation-node.ts");
  assert.match(entry, /import\("\.\/instrumentation-runtime\.ts"\)/);
  assert.doesNotMatch(entry, /instrumentation-node/);
  assert.match(runtime, /startRuntimeMemorySampling\(\)/);
  assert.match(runtime, /startBackgroundCoordinator\(\)/);
  assert.match(background, /startScheduledChatScheduler\(\)/);
  assert.match(background, /autostartWhatsAppGateway\(\)/);
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

test("the Terminal is a real user-triggered compilation boundary", () => {
  const dashboard = read("src/app/dashboard/dashboard-client.tsx");
  const lazyTerminal = read("src/app/components/hermes/lazy-dashboard-agent-terminal.tsx");
  assert.match(dashboard, /LazyDashboardAgentTerminal/);
  assert.match(lazyTerminal, /dynamic\(\(\) => import\("\.\/dashboard-agent-terminal"\)/);
  assert.match(lazyTerminal, /onClick=\{\(\) => setEnabled\(true\)\}/);
  assert.match(lazyTerminal, /sessionStorage\.getItem\(OPEN_STATE_KEY\)/);
});
