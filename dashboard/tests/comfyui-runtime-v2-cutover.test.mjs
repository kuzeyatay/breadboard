import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  comfyUiStatus,
  renderComfyUiImage,
  startComfyUi,
} from "../src/lib/comfyui/service.ts";
import { SupervisorResourceExhaustedError } from "../src/lib/supervisor-control.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const controlOrigin = "http://127.0.0.1:43127";
const comfyOrigin = "http://127.0.0.1:43128";
const controlToken = "comfyui-runtime-v2-control-token-0123456789";

function comfyUiLeaseContract(url) {
  return url === `${controlOrigin}/v1/services/comfyui/lease-contract`
    ? Response.json({ protocolVersion: 1, serviceId: "comfyui", acquireTimeoutMs: 190_000 })
    : null;
}

function config(overrides = {}) {
  return {
    enabled: true,
    baseUrl: comfyOrigin,
    managed: true,
    cloneRoot: path.join(repositoryRoot, "comfyui"),
    envDir: path.join(repositoryRoot, ".runtime", "comfyui-venv"),
    statusFile: path.join(repositoryRoot, ".runtime", "qa-no-comfy-status.json"),
    logFile: path.join(repositoryRoot, ".runtime", "qa-no-comfy.log"),
    port: 43128,
    startTimeoutMs: 100,
    generateTimeoutMs: 100,
    ...overrides,
  };
}

async function withRuntimeControl(fetchImpl, operation) {
  const previous = {
    fetch: globalThis.fetch,
    url: process.env.BREADBOARD_SUPERVISOR_CONTROL_URL,
    token: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,
    active: process.env.BREADBOARD_RUNTIME_V2_ACTIVE,
  };
  globalThis.fetch = fetchImpl;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = controlOrigin;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = controlToken;
  process.env.BREADBOARD_RUNTIME_V2_ACTIVE = "true";
  try {
    return await operation();
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = previous.url;
    if (previous.token === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = previous.token;
    if (previous.active === undefined) delete process.env.BREADBOARD_RUNTIME_V2_ACTIVE;
    else process.env.BREADBOARD_RUNTIME_V2_ACTIVE = previous.active;
  }
}

function comfyResponse(url) {
  if (url.endsWith("/system_stats")) {
    return Response.json({ system: { comfyui_version: "qa" }, devices: [{ type: "cpu" }] });
  }
  if (url.endsWith("/object_info/CheckpointLoaderSimple")) {
    return Response.json({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["model.safetensors"], {}] } } },
    });
  }
  if (url.endsWith("/object_info/KSampler")) {
    return Response.json({
      KSampler: {
        input: {
          required: {
            sampler_name: [["euler"], {}],
            scheduler: [["normal"], {}],
          },
        },
      },
    });
  }
  if (url.endsWith("/prompt")) return Response.json({ prompt_id: "prompt-1" });
  if (url.endsWith("/history/prompt-1")) {
    return Response.json({
      "prompt-1": {
        status: { completed: true, status_str: "success" },
        outputs: { "7": { images: [{ filename: "image.png", subfolder: "", type: "output" }] } },
      },
    });
  }
  if (url.includes("/view?")) return new Response(new Uint8Array([1, 2, 3]));
  throw new Error(`unexpected ComfyUI request: ${url}`);
}

test("one cold Runtime lease is held through the final image read and then released", async () => {
  const calls = [];
  const result = await withRuntimeControl(async (input) => {
    const url = String(input);
    calls.push(url);
    const contract = comfyUiLeaseContract(url);
    if (contract) return contract;
    if (url.endsWith("/v1/services/comfyui/lease")) {
      return Response.json({ leaseId: "lease-render", serviceId: "comfyui" });
    }
    if (url.endsWith("/v1/leases/lease-render/release")) {
      return Response.json({ ok: true, released: true });
    }
    return comfyResponse(url);
  }, () => renderComfyUiImage({ prompt: "a small garden" }, { config: config() }));
  assert.deepEqual([...result.buffer], [1, 2, 3]);
  assert.equal(calls[0], `${controlOrigin}/v1/services/comfyui/lease-contract`);
  assert.equal(calls[1], `${controlOrigin}/v1/services/comfyui/lease`);
  assert.match(calls.at(-2), /\/view\?/);
  assert.equal(calls.at(-1), `${controlOrigin}/v1/leases/lease-render/release`);
  assert.equal(calls.filter((url) => url.endsWith("/v1/services/comfyui/lease")).length, 1);
});

test("cancellation after cold acquisition releases the lease without touching ComfyUI", async () => {
  const calls = [];
  const controller = new AbortController();
  await withRuntimeControl(async (input) => {
    const url = String(input);
    calls.push(url);
    const contract = comfyUiLeaseContract(url);
    if (contract) return contract;
    if (url.endsWith("/v1/services/comfyui/lease")) {
      controller.abort();
      return Response.json({ leaseId: "lease-cancel", serviceId: "comfyui" });
    }
    if (url.endsWith("/v1/leases/lease-cancel/release")) {
      return Response.json({ ok: true, released: true });
    }
    throw new Error(`unexpected request: ${url}`);
  }, async () => {
    await assert.rejects(
      renderComfyUiImage(
        { prompt: "cancelled" },
        { config: config(), signal: controller.signal },
      ),
      (error) => error?.code === "comfyui_generation_cancelled",
    );
  });
  assert.deepEqual(calls, [
    `${controlOrigin}/v1/services/comfyui/lease-contract`,
    `${controlOrigin}/v1/services/comfyui/lease`,
    `${controlOrigin}/v1/leases/lease-cancel/release`,
  ]);
});

test("status is observational and explicit Start releases into the manifest idle TTL", async () => {
  const calls = [];
  let started = false;
  await withRuntimeControl(async (input) => {
    const url = String(input);
    calls.push(url);
    const contract = comfyUiLeaseContract(url);
    if (contract) return contract;
    if (url.endsWith("/v1/status")) {
      return Response.json({
        services: [{ id: "comfyui", state: started ? "ready" : "available-but-stopped" }],
      });
    }
    if (url.endsWith("/v1/services/comfyui/lease")) {
      started = true;
      return Response.json({ leaseId: "lease-start", serviceId: "comfyui" });
    }
    if (url.endsWith("/v1/leases/lease-start/release")) {
      return Response.json({ ok: true, released: true });
    }
    return comfyResponse(url);
  }, async () => {
    assert.equal((await comfyUiStatus(config())).state, "stopped");
    assert.deepEqual(calls, [`${controlOrigin}/v1/status`]);
    calls.length = 0;
    assert.equal((await startComfyUi(config())).state, "ready");
  });
  assert.equal(calls[0], `${controlOrigin}/v1/services/comfyui/lease-contract`);
  assert.equal(calls[1], `${controlOrigin}/v1/services/comfyui/lease`);
  assert.equal(calls.at(-1), `${controlOrigin}/v1/leases/lease-start/release`);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "desktop", "runtime-v2", "manifests", "services.json"), "utf8"),
  );
  const service = manifest.services.find((candidate) => candidate.id === "comfyui");
  assert.equal(service.startupPolicy, "on-demand");
  assert.equal(service.idleTtlMs, 600_000);
});

test("resource admission stays structured and no integrated direct-spawn fallback exists", async () => {
  await withRuntimeControl(async (input) => {
    const url = String(input);
    const contract = comfyUiLeaseContract(url);
    if (contract) return contract;
    assert.equal(url, `${controlOrigin}/v1/services/comfyui/lease`);
    return Response.json(
      {
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        resource: "windows_commit",
        requiredHeadroomMb: 12_000,
        availableHeadroomMb: 8_000,
        retryable: false,
        state: "constrained",
      },
      { status: 503 },
    );
  }, async () => {
    await assert.rejects(
      renderComfyUiImage({ prompt: "denied" }, { config: config() }),
      (error) =>
        error instanceof SupervisorResourceExhaustedError &&
        error.result.requiredHeadroomMb === 12_000,
    );
  });

  const server = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "comfyui", "server.ts"), "utf8");
  assert.doesNotMatch(server, /function launch\(|__breadboardComfyUiStart|comfyUiReachable/);
  const startRoute = fs.readFileSync(path.join(dashboardRoot, "src", "app", "api", "comfyui", "route.ts"), "utf8");
  assert.match(
    startRoute,
    /export async function POST[\s\S]*SupervisorResourceExhaustedError[\s\S]*\.\.\.error\.result[\s\S]*status: 503/,
  );
});

test("explicit external mode remains observational and never asks Runtime for a lease", async () => {
  const previous = {
    fetch: globalThis.fetch,
    url: process.env.BREADBOARD_SUPERVISOR_CONTROL_URL,
    token: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,
    active: process.env.BREADBOARD_RUNTIME_V2_ACTIVE,
  };
  const calls = [];
  delete process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
  delete process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
  delete process.env.BREADBOARD_RUNTIME_V2_ACTIVE;
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return comfyResponse(url);
  };
  try {
    const status = await comfyUiStatus(config({ managed: false }));
    assert.equal(status.state, "ready");
    assert.ok(calls.every((url) => url.startsWith(comfyOrigin)));
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url !== undefined) process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = previous.url;
    if (previous.token !== undefined) process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = previous.token;
    if (previous.active !== undefined) process.env.BREADBOARD_RUNTIME_V2_ACTIVE = previous.active;
  }
});

test("the ComfyUI manifest uses only closed data/app authorities and never stages model authority", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "desktop", "runtime-v2", "manifests", "services.json"), "utf8"),
  );
  const service = manifest.services.find((candidate) => candidate.id === "comfyui");
  assert.ok(service);
  assert.deepEqual(
    service.launchProfiles.map((profile) => profile.modes),
    [["lean", "hot"], ["packaged"]],
  );
  const [managedProfile, packagedProfile] = service.launchProfiles;
  assert.equal(managedProfile.executableAuthority, "data-root");
  assert.equal(
    managedProfile.allowedExecutable,
    "runtime-v2/services/comfyui/.venv/Scripts/python.exe",
  );
  assert.ok(managedProfile.arguments.some(
    (argument) => argument.kind === "data-path" &&
      argument.path === "runtime-v2/toolchains/comfyui/main.py",
  ));
  assert.ok(managedProfile.installProbe.files.some(
    (probe) => probe.authority === "data-root" &&
      probe.path === "runtime-v2/toolchains/comfyui/main.py",
  ));
  assert.deepEqual(managedProfile.workingDirectory, {
    kind: "data-subdirectory",
    path: "runtime-v2/toolchains/comfyui",
  });

  assert.equal(packagedProfile.executableAuthority, "runtime-root");
  assert.equal(
    packagedProfile.allowedExecutable,
    "runtimes/comfyui-python/python.exe",
  );
  assert.ok(packagedProfile.arguments.some(
    (argument) => argument.kind === "app-path" && argument.path === "comfyui/main.py",
  ));
  assert.ok(packagedProfile.installProbe.files.some(
    (probe) => probe.authority === "runtime-root" &&
      probe.path === "runtimes/comfyui-python/python.exe",
  ));
  assert.ok(packagedProfile.installProbe.files.some(
    (probe) => probe.authority === "app-root" && probe.path === "comfyui/main.py",
  ));
  assert.deepEqual(packagedProfile.workingDirectory, {
    kind: "app-subdirectory",
    path: "comfyui",
  });

  const closedAuthorities = new Set(["app-root", "data-root", "runtime-root"]);
  for (const profile of service.launchProfiles) {
    assert.ok(closedAuthorities.has(profile.executableAuthority));
    const baseDirectoryIndex = profile.arguments.findIndex(
      (argument) => argument.kind === "literal" && argument.value === "--base-directory",
    );
    assert.notEqual(baseDirectoryIndex, -1);
    assert.deepEqual(profile.arguments[baseDirectoryIndex + 1], {
      kind: "data-path",
      path: "comfyui",
    });
    assert.ok(profile.installProbe.files.every((probe) => closedAuthorities.has(probe.authority)));
    assert.ok(profile.installProbe.files.every((probe) => !/models|cache|user/i.test(probe.path)));
  }
  assert.doesNotMatch(
    JSON.stringify(service),
    /"(?:executableAuthority|authority|kind)":"model-(?:root|path|subdirectory)"/u,
  );
});
