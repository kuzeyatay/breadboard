import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GBrainAdapterError,
  GBrainClient,
} from "../src/lib/gbrain/client.ts";
import { SupervisorResourceExhaustedError } from "../src/lib/supervisor-control.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const controlOrigin = "http://127.0.0.1:43121";
const adapterOrigin = "http://127.0.0.1:43124";
const controlToken = "gbrain-runtime-v2-control-token-0123456789";

function gbrainLeaseContract(url) {
  return url === `${controlOrigin}/v1/services/gbrain/lease-contract`
    ? Response.json({ protocolVersion: 1, serviceId: "gbrain", acquireTimeoutMs: 100_000 })
    : null;
}

function config(queryTimeoutMs = 100) {
  return {
    mode: "preferred",
    adapterUrl: adapterOrigin,
    secret: "gbrain-adapter-secret",
    queryTimeoutMs,
    embeddingProvider: "openai-compatible",
    embeddingModel: "local/bge-small-en-v1.5",
  };
}

async function withMockedControl(fetchImpl, operation) {
  const previous = {
    fetch: globalThis.fetch,
    url: process.env.BREADBOARD_SUPERVISOR_CONTROL_URL,
    token: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,
  };
  globalThis.fetch = fetchImpl;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = controlOrigin;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = controlToken;
  try {
    return await operation();
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = previous.url;
    if (previous.token === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = previous.token;
  }
}

test("the first retrieval survives a cold service lease and resumes the original request", async () => {
  const calls = [];
  await withMockedControl(async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    const contract = gbrainLeaseContract(url);
    if (contract) return contract;
    if (url === `${controlOrigin}/v1/services/gbrain/lease`) {
      // Longer than the query timeout: this time belongs to cold start and must
      // not consume the adapter request budget.
      await new Promise((resolve) => setTimeout(resolve, 30));
      return Response.json({ leaseId: "lease-cold-start", serviceId: "gbrain" });
    }
    if (url === `${adapterOrigin}/search`) {
      assert.equal(init.signal?.aborted, false);
      return Response.json({
        ok: true,
        data: { results: [], mode: "hybrid", warnings: [] },
      });
    }
    if (url === `${controlOrigin}/v1/leases/lease-cold-start/release`) {
      return Response.json({ ok: true, released: true });
    }
    throw new Error(`unexpected request: ${url}`);
  }, async () => {
    const result = await new GBrainClient(config(10)).search(
      { userId: "1", authorizedSourceIds: ["gbrain-src-cluster-1"] },
      "retained cold-start query",
    );
    assert.equal(result.mode, "hybrid");
  });
  assert.deepEqual(calls, [
    `${controlOrigin}/v1/services/gbrain/lease-contract`,
    `${controlOrigin}/v1/services/gbrain/lease`,
    `${adapterOrigin}/search`,
    `${controlOrigin}/v1/leases/lease-cold-start/release`,
  ]);
});

test("cancelling active retrieval releases its lease and never leaves an idle-stop blocker", async () => {
  const calls = [];
  let adapterStarted;
  const started = new Promise((resolve) => {
    adapterStarted = resolve;
  });
  const controller = new AbortController();
  const operation = withMockedControl(async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    const contract = gbrainLeaseContract(url);
    if (contract) return contract;
    if (url.endsWith("/v1/services/gbrain/lease")) {
      return Response.json({ leaseId: "lease-cancel", serviceId: "gbrain" });
    }
    if (url === `${adapterOrigin}/search`) {
      adapterStarted();
      return await new Promise((_, reject) => {
        const rejectAbort = () => reject(new DOMException("aborted", "AbortError"));
        if (init.signal?.aborted) rejectAbort();
        else init.signal?.addEventListener("abort", rejectAbort, { once: true });
      });
    }
    if (url.endsWith("/v1/leases/lease-cancel/release")) {
      return Response.json({ ok: true, released: true });
    }
    throw new Error(`unexpected request: ${url}`);
  }, async () => {
    const pending = new GBrainClient(config(1_000)).search(
      { userId: "1", authorizedSourceIds: ["gbrain-src-cluster-1"] },
      "cancel me",
      undefined,
      undefined,
      controller.signal,
    );
    await started;
    controller.abort();
    await assert.rejects(
      pending,
      (error) => error instanceof GBrainAdapterError && error.code === "cancelled",
    );
  });
  await operation;
  assert.equal(calls.at(-1), `${controlOrigin}/v1/leases/lease-cancel/release`);
});

test("resource admission denial remains a structured Runtime V2 result", async () => {
  await withMockedControl(async (input) => {
    const url = String(input);
    const contract = gbrainLeaseContract(url);
    if (contract) return contract;
    assert.equal(url, `${controlOrigin}/v1/services/gbrain/lease`);
    return Response.json(
      {
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        resource: "windows_commit",
        requiredHeadroomMb: 9_992,
        availableHeadroomMb: 7_100,
        retryable: false,
        state: "constrained",
      },
      { status: 503 },
    );
  }, async () => {
    await assert.rejects(
      new GBrainClient(config()).search(
        { userId: "1", authorizedSourceIds: ["gbrain-src-cluster-1"] },
        "denied",
      ),
      (error) =>
        error instanceof SupervisorResourceExhaustedError &&
        error.result.requiredHeadroomMb === 9_992 &&
        error.result.availableHeadroomMb === 7_100,
    );
  });
});

test("GBrain is a registered on-demand Runtime V2 service with a bounded idle restart policy", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "desktop", "runtime-v2", "manifests", "services.json"), "utf8"),
  );
  const service = manifest.services.find((candidate) => candidate.id === "gbrain");
  assert.ok(service, "GBrain must remain registered");
  assert.equal(service.startupPolicy, "on-demand");
  assert.equal(service.idleTtlMs, 10 * 60_000);
  assert.equal(service.resourceClass, "document-model");
  assert.deepEqual(service.dependencies, ["chatmock"]);
  assert.equal(service.launchProfiles[0].environmentSource, "gbrain");
  assert.equal(service.launchProfiles[0].allowedExecutable, "runtimes/node/node.exe");
  assert.deepEqual(service.launchProfiles[0].arguments, [
    { kind: "literal", value: "--no-warnings" },
    { kind: "literal", value: "--experimental-transform-types" },
    { kind: "app-path", path: "gbrain-adapter/src/node-entrypoint.mjs" },
  ]);
  assert.match(service.readiness.expectedBodyContains, /gbrain/);
});

test("status remains observational and GBrain has no Next or renderer spawn fallback", () => {
  const client = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "gbrain", "client.ts"), "utf8");
  const tools = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "hermes", "gbrain-tools.ts"), "utf8");
  const gbrainSources = fs
    .readdirSync(path.join(dashboardRoot, "src", "lib", "gbrain"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => fs.readFileSync(path.join(dashboardRoot, "src", "lib", "gbrain", name), "utf8"))
    .join("\n");
  assert.match(client, /withServiceLease\("gbrain", "retrieval"/);
  assert.match(tools, /readSupervisedServiceSnapshot\("gbrain"\)/);
  assert.match(tools, /available and will start automatically when retrieval is requested/);
  assert.doesNotMatch(client.match(/async health[\s\S]*?\n  search\(/)?.[0] ?? "", /withServiceLease/);
  assert.doesNotMatch(gbrainSources, /node:child_process|\bspawn(?:Sync)?\s*\(|\bexecFile(?:Sync)?\s*\(/);
  assert.doesNotMatch(gbrainSources, /NEXT_PUBLIC_|BREADBOARD_NODE_BINARY|GBRAIN_PATH/);
});

test("packaging contains the adapter, engine and dependencies without mutable index data", () => {
  const prepare = fs.readFileSync(
    path.join(repositoryRoot, "desktop", "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  const verify = fs.readFileSync(
    path.join(repositoryRoot, "desktop", "scripts", "verify-package.mjs"),
    "utf8",
  );
  assert.match(prepare, /staging GBrain adapter and vendored engine/);
  assert.match(prepare, /installBunProductionDependencies/);
  assert.match(prepare, /\["package\.json", "bun\.lock", "src"\]/);
  assert.doesNotMatch(prepare.match(/GBrain \(Runtime V2[\s\S]*?ui-tars-adapter/)?.[0] ?? "", /GBRAIN_DATA_DIR|pglite\//);
  assert.match(verify, /GBrain adapter entrypoint/);
  assert.match(verify, /vendored GBrain PGLite dependency/);
});
