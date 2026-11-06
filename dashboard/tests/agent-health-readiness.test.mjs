import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateKey = "__breadboardAgentHealthReadinessTest";
const state = () => globalThis[stateKey];
const stateSource = `const state = () => globalThis[${JSON.stringify(stateKey)}];`;

async function load(relative) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, relative)], bundle: true, format: "esm",
    platform: "node", target: "node22", write: false,
    plugins: [{ name: "readiness-fixtures", setup(build) {
      const stubs = {
        "server-only": "export {};",
        "runtime-paths.ts": `
          export const repositoryRoot = () => "/fixture";
          export const dashboardDataDir = () => "/fixture/data";
          export const runtimeV2ServiceVenv = id => "/fixture/data/" + id + "/.venv";
        `,
        "supervisor-control.ts": `${stateSource}
          export const isRuntimeV2ServiceControlConfigured = () => state().managed;
          export const readSupervisedServiceSnapshot = async id => ({ id, state: state().lifecycle });
          export class SupervisorResourceExhaustedError extends Error {}
          export const withServiceLease = async (id, reason, fn) => {
            state().leases.push({id, reason}); return fn();
          };
        `,
        "managed-service-endpoint.ts": `
          export const resolveManagedServiceEndpoint = () => ({url:"http://127.0.0.1:1",apiKey:"fixture"});
        `,
        "external-runtime-filesystem.ts": `${stateSource}
          export const externalRuntimePathExists = candidate =>
            /[\\\\/]\\.venv[\\\\/]/u.test(candidate) ? state().environmentReady : state().cloneExists;
          export const externalRuntimeReadUtf8 = () => 'version = "1.0.0"';
          export const externalRuntimeStat = () => ({size: 1});
        `,
        "runtime-agent-service.ts": `${stateSource}
          export const withRuntimeAgentServiceLease = async (id, reason, fn) => {
            state().leases.push({id, reason}); return fn();
          };
          export const callRuntimeAgentService = async () => {
            state().serviceCalls++; return {availability: {available: true}, service: null, log: ""};
          };
          export const inspectRuntimeAgentService = async () => ({snapshot: null, status: null});
          export const scopedAgentRequest = (scope, input) => ({scope, ...input});
        `,
      };
      if (relative.includes("money-printer")) {
        stubs["node:fs"] = `${stateSource}
          export default {
            existsSync: candidate => /[\\\\/]\\.venv[\\\\/]/u.test(candidate)
              ? state().environmentReady : state().cloneExists,
            statSync: () => ({size: 1}),
            readFileSync: () => 'version = "1.0.0"',
          };`;
        stubs["node:child_process"] = `export const spawn = () => { throw new Error("Status must not spawn"); };`;
      }
      build.onResolve({filter: /.*/}, args => {
        const name = args.path.startsWith("node:") ? args.path : args.path.split(/[\\/]/u).at(-1);
        return Object.hasOwn(stubs, name) ? {path: name, namespace: "readiness"} : null;
      });
      build.onLoad({filter: /.*/, namespace: "readiness"}, args => ({loader: "js", contents: stubs[args.path]}));
    }}],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

function reset(overrides = {}) {
  globalThis[stateKey] = {
    cloneExists: true, environmentReady: false, lifecycle: "available-but-stopped",
    managed: true, leases: [], serviceCalls: 0, ...overrides,
  };
}

for (const id of ["vibe-trading", "stock-analyst", "deer-flow"]) {
  test(`${id} requires managed Python even when its registered controller is ready`, async () => {
    reset();
    const runtime = await load(`src/lib/${id}/runtime.ts`);
    for (const lifecycle of ["available-but-stopped", "ready", "healthy"]) {
      state().lifecycle = lifecycle;
      const status = await runtime.health({force: true});
      assert.equal(status.available, false);
      assert.equal(status.environmentReady, false);
      assert.equal(status.packageInstalled, false);
      assert.match(status.reason, /environment is not installed/u);
    }
    state().environmentReady = true;
    state().lifecycle = "available-but-stopped";
    assert.equal((await runtime.health({force: true})).available, true);
    state().lifecycle = "installation-unavailable";
    assert.equal((await runtime.health({force: true})).available, false);
    assert.deepEqual(state().leases, []);
  });
}

test("MoneyPrinter missing clone or Python returns unavailable without starting a service", async () => {
  reset();
  const runtime = await load("src/lib/money-printer/runtime-service.ts");
  for (const cloneExists of [false, true]) {
    state().cloneExists = cloneExists;
    const status = await runtime.readMoneyPrinterRuntimeStatus({userId: 1}, true);
    assert.equal(status.availability.available, false);
    assert.equal(status.availability.cloned, cloneExists);
    assert.equal(status.availability.environmentReady, false);
    assert.match(status.availability.reason, cloneExists ? /environment has not been built/u : /clone was not found/u);
    assert.equal(status.service, null);
  }
  assert.deepEqual(state().leases, []);
  assert.equal(state().serviceCalls, 0);
  state().environmentReady = true;
  assert.equal((await runtime.readMoneyPrinterRuntimeStatus({userId: 1})).availability.available, true);
  assert.equal(state().leases.length, 1);
  assert.equal(state().serviceCalls, 1);
});

test("CAD status does not probe or start a stopped service; a design can warm it", async () => {
  reset();
  const runtime = await load("src/lib/cad/service.ts");
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return Response.json({status: "ok", engines: ["cadquery"]});
  };
  const env = {CAD_SERVICE_URL: "http://127.0.0.1:1", CAD_SERVICE_SECRET: "fixture"};
  try {
    await assert.rejects(runtime.cadServiceHealth(env), error => error.code === "cad_service_stopped");
    assert.equal(fetches, 0);
    assert.deepEqual(state().leases, []);
    assert.equal((await runtime.ensureCadServiceReady(env)).status, "ok");
    assert.equal(fetches, 1);
    assert.deepEqual(state().leases, [{id: "cad", reason: "cad-preflight"}]);
  } finally { globalThis.fetch = previousFetch; }
});

test("CAD status aborts a listening service that never answers within five seconds", async () => {
  reset({lifecycle: "healthy"});
  const runtime = await load("src/lib/cad/service.ts");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, {signal}) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {once: true});
  });
  const started = Date.now();
  try {
    await assert.rejects(
      runtime.cadServiceHealth({CAD_SERVICE_URL: "http://127.0.0.1:1", CAD_SERVICE_SECRET: "fixture"}),
      error => error.code === "execution_timeout",
    );
    assert.ok(Date.now() - started < 7_000);
    assert.deepEqual(state().leases, []);
  } finally { globalThis.fetch = previousFetch; }
});
