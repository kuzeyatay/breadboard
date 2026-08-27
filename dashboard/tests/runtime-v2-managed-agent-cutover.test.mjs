import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const SERVICES = ["deer-flow", "vibe-trading", "stock-analyst"];
// All three finite runs now use disposable outer workers. Keep the old lease
// assertions structurally available until the compatibility suite itself is
// retired, but no product run manager belongs in this list anymore.
const LEASED_RUN_MANAGERS = [];

test("managed agent adapters contain no dashboard-owned process fallback", () => {
  for (const serviceId of ["deep-research", ...SERVICES]) {
    for (const name of fs.readdirSync(path.join(dashboardRoot, "src", "lib", serviceId))) {
      if (!/\.(?:ts|tsx)$/.test(name)) continue;
      const text = source(`src/lib/${serviceId}/${name}`);
      assert.doesNotMatch(
        text,
        /node:child_process|\bspawn\s*\(|\bexecFile\s*\(|detached\s*:/,
        `${serviceId}/${name} still owns a process`,
      );
    }
  }
});

test("status is observational and never acquires a service lease", () => {
  const deep = source("src/lib/deep-research/service.ts");
  const deepHealth = deep.slice(
    deep.indexOf("export async function health"),
    deep.indexOf("/** The launching chat"),
  );
  assert.match(deepHealth, /readSupervisedServiceSnapshot\("deep-research"\)/);
  assert.doesNotMatch(deepHealth, /holdDeepResearchService|ensureDeepResearchService/);

  for (const serviceId of SERVICES) {
    const runtime = source(`src/lib/${serviceId}/runtime.ts`);
    assert.match(runtime, new RegExp(`readSupervisedServiceSnapshot\\("${serviceId}"\\)`));
    assert.doesNotMatch(runtime, /acquireServiceLease|holdRuntimeAgentServiceLease/);
  }
});

test("run admission acquires before returning and releases after drive", () => {
  const leases = source("src/lib/runtime-v2/service-run-lease.ts");
  const hold = leases.slice(leases.indexOf("export async function holdRuntimeAgentServiceLease"));
  assert.ok(
    hold.indexOf("readSupervisedServiceSnapshot(serviceId)") <
      hold.indexOf("acquireServiceLease(serviceId"),
    "cold-start observation happens after the service is already acquired",
  );
  for (const serviceId of LEASED_RUN_MANAGERS) {
    const manager = source(`src/lib/${serviceId}/run-manager.ts`);
    const route = source(`src/app/api/${serviceId}/runs/route.ts`);
    assert.match(manager, /export async function startRun/);
    assert.ok(
      manager.indexOf("await holdRuntimeAgentServiceLease(") < manager.indexOf("runs.set(runId, run)"),
      `${serviceId} stores a run before Runtime admission`,
    );
    assert.match(
      manager,
      new RegExp(`\\.finally\\(async \\(\\) => \\{[\\s\\S]*?releaseRuntimeAgentServiceLease\\("${serviceId}"`),
    );
    assert.match(route, /const run = await startRun\(\{/);
    assert.match(route, /runtimeAuthorityErrorResponse\(error\)/);
    assert.match(manager, /runtimeAgentServiceLeaseWasColdStart\(/);
    assert.ok(
      !route.includes("error instanceof Error ? error.message"),
      `${serviceId} exposes internal failure detail to the renderer`,
    );
  }
});

test("cancellation waits for the upstream operation before publishing terminal state", () => {
  for (const serviceId of LEASED_RUN_MANAGERS) {
    const manager = source(`src/lib/${serviceId}/run-manager.ts`);
    const abortRoute = source(`src/app/api/${serviceId}/runs/[runId]/abort/route.ts`);
    assert.match(
      manager,
      /export async function abortRun[\s\S]*?await cancelUpstream\(run\);[\s\S]*?finish\(run, "aborted"/,
    );
    assert.match(abortRoute, /ok: await abortRun\(userId, runId\)/);
  }
  const deep = source("src/lib/deep-research/runtime-worker-run-manager.ts");
  const outerAdapter = source("scripts/runtime-v2-outer-agent-adapters.mjs");
  assert.match(
    deep,
    /abortUpstream[\s\S]*?await client\.abort\(run\.runId, run\.userId\)/,
  );
  assert.match(
    deep,
    /export async function abortRuntimeWorkerRun[\s\S]*?await run\.abortPromise/,
  );
  assert.match(
    outerAdapter,
    /stopPromise = Promise\.resolve\([\s\S]*?manager\.abortRuntimeWorkerRun[\s\S]*?await stop\(\)/,
  );
});

test("setup is a cancellable finite Runtime job, never a dashboard command", () => {
  const helper = source("src/lib/runtime-v2/managed-setup-job.ts");
  assert.match(helper, /submitRuntimeJob/);
  assert.match(helper, /jobType: "managed-setup"/);
  assert.match(helper, /operation: input\.serviceId/);
  assert.match(helper, /cancelRuntimeJob\(jobAuthority, jobId\)/);
  assert.match(helper, /BREADBOARD_RESOURCE_EXHAUSTED/);
  assert.match(helper, /if \(input\.signal\?\.aborted\) forwardAbort\(\)/);
  assert.ok(
    helper.indexOf("if (controller.signal.aborted)") < helper.lastIndexOf("submitRuntimeJob("),
    "an already-cancelled setup request still submits work",
  );

  for (const serviceId of SERVICES) {
    const setup = source(`src/lib/${serviceId}/setup.ts`);
    const route = source(`src/app/api/${serviceId}/setup/route.ts`);
    assert.doesNotMatch(setup, /node:fs|node:child_process|runCommand|rmSync|stopService/);
    assert.match(route, /runManagedSetupJob\(\{/);
    assert.match(route, /signal: request\.signal/);
    assert.match(route, new RegExp(`serviceId: "${serviceId}"`));
  }
});

test("service endpoints are closed, loopback-only, and remain server-side", () => {
  const endpoints = source("src/lib/runtime-v2/managed-service-endpoint.ts");
  assert.match(endpoints, /DEER_FLOW_SERVICE_URL/);
  assert.match(endpoints, /VIBE_TRADING_SERVICE_URL/);
  assert.match(endpoints, /VIBE_TRADING_SERVICE_API_KEY/);
  assert.match(endpoints, /STOCK_ANALYST_SERVICE_URL/);
  assert.match(endpoints, /url\.protocol !== "http:"/);
  assert.match(endpoints, /"127\.0\.0\.1", "localhost", "\[::1\]"/);
  assert.doesNotMatch(endpoints, /NEXT_PUBLIC_/);

  const components = fs
    .readdirSync(path.join(dashboardRoot, "src", "app", "components", "agents"))
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => source(`src/app/components/agents/${name}`))
    .join("\n");
  assert.doesNotMatch(
    components,
    /DEER_FLOW_SERVICE_URL|VIBE_TRADING_SERVICE_(?:URL|API_KEY)|STOCK_ANALYST_SERVICE_URL/,
  );
  for (const serviceId of SERVICES) {
    assert.doesNotMatch(
      source(`src/lib/${serviceId}/run-manager.ts`),
      /response\.text\(/,
      `${serviceId} forwards raw upstream error detail`,
    );
  }
});

test("legacy Deep Research disabled mode no longer hides the agent", () => {
  const config = source("src/lib/deep-research/config.ts");
  const hook = source("src/app/components/hermes/use-deep-research-agent.ts");
  assert.doesNotMatch(config, /DeepResearchMode = "disabled"/);
  assert.match(config, /Historical `disabled` values are[\s\S]*?normalized to optional/);
  assert.match(config, /export function deepResearchEnabled[\s\S]*?return true/);
  assert.doesNotMatch(hook, /deep_research_disabled|DEEP_RESEARCH_MODE=disabled/);
  assert.match(hook, /setAgent\(AGENT\)[\s\S]*?fetch\("\/api\/deep-research\/health"\)/);
});

test("observational health never prevents selecting a mandatory managed agent", () => {
  const surfaces = [
    source("src/app/components/hermes/dashboard-agent-terminal.tsx"),
    source("src/app/gardens/[clusterSlug]/workspace-client.tsx"),
  ];
  const selectors = [
    ["selectDeerFlow", "setDeerFlowAgent"],
    ["selectVibeTrading", "setVibeTradingAgent"],
    ["selectStockAnalyst", "setStockAnalystAgent"],
  ];
  for (const text of surfaces) {
    for (const [selector, setter] of selectors) {
      const starts = [
        text.indexOf(`const ${selector} =`),
        text.indexOf(`async function ${selector}(`),
      ].filter((index) => index !== -1);
      const start = starts.length ? Math.min(...starts) : -1;
      assert.notEqual(start, -1, `${selector} is missing`);
      const setterAt = text.indexOf(`${setter}(selected)`, start);
      const healthAt = text.indexOf("fetch(", start);
      assert.ok(
        setterAt !== -1 && healthAt !== -1 && setterAt < healthAt,
        `${selector} waits for health before selecting`,
      );
      assert.match(
        text.slice(start, start + 6_000),
        /catch \([^)]*\) \{[\s\S]*?return selected;/,
        `${selector} drops selection when observational health fails`,
      );
    }
  }
});

test("Deep Research SSE cancellation clears its polling timer", () => {
  const route = source("src/app/api/deep-research/runs/[runId]/events/route.ts");
  const helper = source("src/lib/runtime-v2/outer-agent-events-route.ts");
  assert.match(route, /outerAgentEventsResponse/);
  assert.match(route, /readOuterAgentRunView\("deep-research"/);
  assert.match(
    helper,
    /cancel\(\) \{[\s\S]*?if \(timer\) clearTimeout\(timer\);[\s\S]*?timer = null/,
  );
});
