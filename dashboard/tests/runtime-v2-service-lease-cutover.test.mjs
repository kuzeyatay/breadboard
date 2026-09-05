import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testStateKey = "__breadboardQuartzLeaseCutoverTest";

function source(...segments) {
  return fs.readFileSync(path.join(dashboardRoot, ...segments), "utf8");
}

async function loadQuartzLeaseModule() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "quartz-view-lease.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "quartz-lease-control-stub",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "quartz-lease-stub",
        }));
        build.onResolve({ filter: /supervisor-control$/ }, () => ({
          path: "supervisor-control",
          namespace: "quartz-lease-stub",
        }));
        build.onResolve({ filter: /quartz-publish$/ }, () => ({
          path: "quartz-publish",
          namespace: "quartz-lease-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "quartz-lease-stub" }, (args) => {
          if (args.path === "server-only") return { loader: "js", contents: "" };
          if (args.path === "quartz-publish") {
            return {
              loader: "js",
              contents: `
                const state = () => globalThis[${JSON.stringify(testStateKey)}];
                export async function ensureQuartzPublicationForView(userId) {
                  state().events.push({ type: "publish-ready", userId });
                  if (state().publishError) throw state().publishError;
                }
              `,
            };
          }
          return {
            loader: "js",
            contents: `
              const state = () => globalThis[${JSON.stringify(testStateKey)}];
              export async function acquireServiceLease(serviceId, reason) {
                state().events.push({ type: "acquire", serviceId, reason });
                if (state().error) throw state().error;
                const id = "lease-" + (++state().nextLease);
                return { id, targetId: serviceId };
              }
              export async function releaseSupervisorLease(lease) {
                if (lease) state().events.push({ type: "release", id: lease.id });
              }
            `,
          };
        });
      },
    }],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#quartz-lease`
  );
}

async function loadCliproxyLeaseModule() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "cliproxy", "runtime-lease.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "cliproxy-lease-control-stub",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "cliproxy-lease-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "cliproxy-lease-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "cliproxy-lease-stub" }, (args) => {
          if (args.path === "server-only") return { loader: "js", contents: "" };
          return {
            loader: "js",
            contents: `
              const state = () => globalThis[${JSON.stringify(testStateKey)}];
              export async function acquireServiceLease(serviceId, reason) {
                state().events.push({ type: "acquire", serviceId, reason });
                if (state().error) throw state().error;
                const id = "lease-" + (++state().nextLease);
                return { id, targetId: serviceId };
              }
              export async function releaseSupervisorLease(lease) {
                if (lease) state().events.push({ type: "release", id: lease.id });
              }
            `,
          };
        });
      },
    }],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#cliproxy-lease`
  );
}

const quartzLease = await loadQuartzLeaseModule();
const cliproxyLease = await loadCliproxyLeaseModule();

function freshLeaseState() {
  const value = { events: [], nextLease: 0, error: null, publishError: null };
  globalThis[testStateKey] = value;
  return value;
}

test("Quartz cold views single-flight and never return the native lease capability", async () => {
  const state = freshLeaseState();
  const viewId = "123e4567-e89b-42d3-a456-426614174000";
  const [first, second] = await Promise.all([
    quartzLease.renewQuartzViewLease(7, viewId),
    quartzLease.renewQuartzViewLease(7, viewId),
  ]);
  assert.deepEqual(first, { expiresInMs: quartzLease.QUARTZ_VIEW_HOLD_TTL_MS });
  assert.deepEqual(second, first);
  assert.equal(Object.hasOwn(first, "leaseId"), false);
  assert.equal(state.events.filter((event) => event.type === "acquire").length, 1);
  assert.deepEqual(state.events.slice(0, 2), [
    { type: "publish-ready", userId: 7 },
    { type: "acquire", serviceId: "quartz", reason: "active-garden-view" },
  ]);
  await quartzLease.releaseQuartzViewLease(7, viewId);
  assert.deepEqual(state.events.at(-1), { type: "release", id: "lease-1" });
});

test("Quartz rotation acquires the replacement before releasing the visible view's old lease", async () => {
  const state = freshLeaseState();
  const viewId = "223e4567-e89b-42d3-a456-426614174000";
  const startedAt = Date.now();
  await quartzLease.renewQuartzViewLease(8, viewId, startedAt);
  for (const elapsed of [60_000, 120_000, 180_000, 240_000]) {
    await quartzLease.renewQuartzViewLease(8, viewId, startedAt + elapsed);
  }
  await quartzLease.renewQuartzViewLease(
    8,
    viewId,
    startedAt + quartzLease.QUARTZ_VIEW_LEASE_ROTATION_MS + 1,
  );
  assert.deepEqual(state.events.slice(0, 4), [
    { type: "publish-ready", userId: 8 },
    { type: "acquire", serviceId: "quartz", reason: "active-garden-view" },
    { type: "acquire", serviceId: "quartz", reason: "active-garden-view" },
    { type: "release", id: "lease-1" },
  ]);
  await quartzLease.releaseQuartzViewLease(8, viewId);
  assert.deepEqual(state.events.at(-1), { type: "release", id: "lease-2" });
});

test("Quartz does not start the static service when cold publication fails", async () => {
  const state = freshLeaseState();
  state.publishError = new Error("publisher unavailable");
  await assert.rejects(
    quartzLease.renewQuartzViewLease(
      9,
      "323e4567-e89b-42d3-a456-426614174000",
    ),
    /publisher unavailable/u,
  );
  assert.deepEqual(state.events, [{ type: "publish-ready", userId: 9 }]);
});

test("Quartz frames acquire through the authenticated dashboard route before receiving a source", () => {
  const route = source("src", "app", "api", "quartz", "view-lease", "route.ts");
  assert.match(route, /const userId = await requireUserId\(\);[\s\S]*renewQuartzViewLease\(userId, viewId\)/);
  assert.match(route, /\{ ok: true, expiresInMs: lease\.expiresInMs \}/);
  assert.doesNotMatch(route, /leaseId|CONTROL_TOKEN|CONTROL_URL/);

  for (const file of [
    ["src", "app", "garden", "library-garden-client.tsx"],
    ["src", "app", "garden", "[clusterSlug]", "garden-client.tsx"],
    ["src", "app", "garden", "garden-quartz-frame.tsx"],
    ["src", "app", "components", "knowledge-graph.tsx"],
  ]) {
    const client = source(...file);
    assert.match(client, /useQuartzViewLease/);
    assert.match(client, /src=\{\s*quartzLease\.ready|src=\{quartzLease\.ready/);
  }
  assert.doesNotMatch(source("src", "app", "garden", "page.tsx"), /withServiceLease/);
  // The Server Component takes the first hold so the global navigation bar
  // reports the wait; the frames must never paint a loading state of their own.
  for (const page of [
    ["src", "app", "garden", "page.tsx"],
    ["src", "app", "garden", "[clusterSlug]", "page.tsx"],
  ]) {
    assert.match(source(...page), /const quartzViewId = await openQuartzViewLease\(userId\)/);
    assert.match(source(...page), /quartzViewId=\{quartzViewId\}/);
  }
  for (const file of [
    ["src", "app", "garden", "library-garden-client.tsx"],
    ["src", "app", "garden", "[clusterSlug]", "garden-client.tsx"],
    ["src", "app", "garden", "garden-quartz-frame.tsx"],
  ]) {
    const client = source(...file);
    assert.match(client, /useQuartzViewLease\(true, quartzViewId\)/);
    assert.doesNotMatch(client, /Preparing Quartz|animate-pulse/);
  }
  assert.doesNotMatch(
    source("src", "app", "garden", "[clusterSlug]", "page.tsx"),
    /withServiceLease/,
  );
});

test("CLIProxy operations lease through completion and OAuth holds release on terminal poll", async () => {
  const state = freshLeaseState();
  const result = await cliproxyLease.withCliproxyLease("subscription-model-sync", async () => {
    state.events.push({ type: "operation-complete" });
    return "models";
  });
  assert.equal(result, "models");
  assert.deepEqual(state.events, [
    { type: "acquire", serviceId: "cliproxy", reason: "subscription-model-sync" },
    { type: "operation-complete" },
    { type: "release", id: "lease-1" },
  ]);

  state.events.length = 0;
  await cliproxyLease.beginCliproxyLogin(19, async () => ({
    state: "oauth-state-19",
    expiresIn: 300,
  }));
  assert.deepEqual(state.events, [
    { type: "acquire", serviceId: "cliproxy", reason: "subscription-login" },
  ]);
  assert.equal(
    await cliproxyLease.pollCliproxyLogin(19, "oauth-state-19", async () => false),
    false,
  );
  assert.equal(state.events.some((event) => event.type === "release"), false);
  assert.equal(
    await cliproxyLease.pollCliproxyLogin(19, "oauth-state-19", async () => true),
    true,
  );
  assert.deepEqual(state.events.at(-1), { type: "release", id: "lease-2" });
});

test("CLIProxy status stays observational while login cancel releases server-side authority", () => {
  const status = source("src", "app", "api", "cliproxy", "status", "route.ts");
  assert.doesNotMatch(status, /withCliproxyLease|acquireServiceLease/);

  const login = source("src", "app", "api", "cliproxy", "login", "route.ts");
  assert.match(login, /beginCliproxyLogin/);
  assert.match(login, /pollCliproxyLogin/);
  assert.match(login, /export async function DELETE/);
  assert.doesNotMatch(login, /as SupervisedServiceId|as never/);

  const panel = source("src", "app", "components", "settings-accounts.tsx");
  assert.match(panel, /\/api\/cliproxy\/login\?state=.*method: "DELETE"/s);
});

test("legacy service adapters retain leases through work, preserve cancellation, and keep status observational", () => {
  const cad = source("src", "lib", "cad", "service.ts");
  const cadRun = source("src", "lib", "cad", "run-manager.ts");
  const hardware = source("src", "lib", "hardware", "run-manager.ts");
  assert.match(cad, /withServiceLease\("cad", "cad-task", perform, env\)/);
  assert.match(cad, /ensureCadServiceReady[\s\S]*withServiceLease\("cad", "cad-preflight"/);
  assert.doesNotMatch(cadRun, /cadServiceListening/);
  assert.doesNotMatch(hardware, /cadServiceListening/);

  const uiTars = source("src", "lib", "ui-tars", "service.ts");
  const uiTarsFacade = source("src", "lib", "ui-tars", "runtime-run-manager.ts");
  const uiTarsWorker = source("src", "lib", "ui-tars", "runtime-worker-run-manager.ts");
  const uiTarsClient = source("src", "lib", "ui-tars", "client.ts");
  const uiTarsConfig = source("src", "lib", "ui-tars", "adapter-config.ts");
  const uiTarsEvents = source(
    "src", "app", "api", "ui-tars", "agents", "[agentId]", "runs", "[runId]", "events", "route.ts",
  );
  const workerManifest = JSON.parse(
    source("..", "desktop", "runtime-v2", "manifests", "workers.json"),
  ).workers.find((worker) => worker.kind === "outer-agent-tars-node");
  assert.match(uiTarsFacade, /startOuterAgentRun\(\{[\s\S]*kind: "agent-tars"/);
  assert.match(uiTarsFacade, /readOuterAgentRunView\("agent-tars"/);
  assert.match(uiTarsFacade, /abortOuterAgentRun\("agent-tars"/);
  assert.match(uiTarsWorker, /loadUITarsRunProfile/);
  assert.match(uiTarsWorker, /new UITarsRuntimeWorkerClient\(\)/);
  assert.match(uiTarsWorker, /await ensureAbort\(run\)/);
  assert.match(uiTarsEvents, /outerAgentEventsResponse/);
  assert.doesNotMatch(uiTarsEvents, /setInterval\(/);
  assert.match(uiTarsClient, /withServiceLease\("ui-tars", "browser-screenshot", read\)/);
  assert.doesNotMatch(uiTarsClient, /active-browser-run/);
  assert.deepEqual(workerManifest.serviceDependencies, [
    { serviceId: "ui-tars", condition: "always" },
  ]);
  assert.equal(workerManifest.exitAfterJob, true);
  assert.doesNotMatch(uiTars, /client\(\)\.createRun|holdUITarsRunLease/);
  assert.doesNotMatch(uiTars, /runtime_disabled|m === "disabled"/);
  assert.doesNotMatch(uiTarsConfig, /return raw === "disabled"/);

  const colpali = source("src", "lib", "colpali", "service.ts");
  const retrieval = source("src", "lib", "colpali", "retrieval.ts");
  assert.match(colpali, /init\.signal\?\.addEventListener\("abort"/);
  assert.match(retrieval, /colpaliSearch\(attachment\.blobId, query, env, topK, signal\)/);

  const humanizer = source("src", "lib", "humanizer", "service.ts");
  assert.match(humanizer, /withServiceLease\("humanizer", "rewrite", perform, env\)/);

  const voiceboxStatus = source("src", "app", "api", "speech", "status", "route.ts");
  const voiceboxClient = source("src", "lib", "speech", "voicebox-client.ts");
  const voiceboxPreparation = source("src", "lib", "speech", "prepare-client.ts");
  const voiceboxSettings = source("src", "app", "components", "settings-speech.tsx");
  assert.doesNotMatch(voiceboxStatus, /voiceboxJson/);
  assert.match(voiceboxStatus, /voiceboxObservationJson/);
  assert.match(voiceboxSettings, /prepareLocalSpeech\(\)/);
  assert.match(voiceboxPreparation, /fetchSpeechApi\("\/api\/speech\/prepare"/);
  assert.match(voiceboxClient, /SupervisorResourceExhaustedError\) throw error/);

  const scriberr = source("src", "lib", "scriberr", "job-runner.ts");
  assert.match(scriberr, /transcription-cancel-\$\{jobId\}[\s\S]*killJob/);
  assert.doesNotMatch(scriberr, /withScriberrLease\?/);
  assert.doesNotMatch(scriberr, /:\s*operation\(\)/);
  assert.match(
    source("src", "lib", "scriberr", "errors.ts"),
    /BREADBOARD_RESOURCE_EXHAUSTED/,
  );
});
