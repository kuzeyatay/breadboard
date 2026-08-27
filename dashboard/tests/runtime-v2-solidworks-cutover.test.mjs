import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(dashboardRoot);
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const runtimeService = await import("../src/lib/cad/solidworks/runtime-service.ts");

function environment(overrides = {}) {
  return {
    BREADBOARD_RUNTIME_V2_ACTIVE: "true",
    BREADBOARD_SUPERVISOR_CONTROL_URL: "http://127.0.0.1:7130",
    BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "c".repeat(48),
    BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED: "1",
    BREADBOARD_SOLIDWORKS_SERVICE_URL: "http://127.0.0.1:7131",
    BREADBOARD_SOLIDWORKS_SERVICE_TOKEN: "s".repeat(48),
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  return new Response(bytes, {
    status,
    headers: {
      "content-type": "application/json",
      "content-length": String(bytes.byteLength),
    },
  });
}

test("SolidWorks has separate sealed development and packaged Runtime profiles", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "desktop", "runtime-v2", "manifests", "services.json"), "utf8"),
  );
  const matches = manifest.services.filter((service) => service.id === "solidworks-mcp");
  assert.equal(matches.length, 1);
  const service = matches[0];
  assert.equal(service.startupPolicy, "on-demand");
  assert.equal(service.requirement, "optional");
  assert.deepEqual(service.dependencies, []);
  assert.equal(service.launchProfiles.length, 2);
  const development = service.launchProfiles.find((profile) => profile.modes.includes("lean"));
  const packaged = service.launchProfiles.find((profile) => profile.modes.includes("packaged"));
  assert.deepEqual(development.modes, ["lean", "hot"]);
  assert.deepEqual(packaged.modes, ["packaged"]);
  for (const profile of [development, packaged]) {
    assert.equal(profile.allowedExecutable, "runtimes/node/node.exe");
    assert.equal(profile.environmentSource, "solidworks-mcp");
    assert.match(JSON.stringify(profile.arguments), /runtime-v2-solidworks-mcp-service\.mjs/);
    assert.ok(
      profile.installProbe.files.some(
        (file) => file.path === "SolidworksMCP-python/src/solidworks_mcp/server.py",
      ),
    );
  }
  assert.ok(development.installProbe.files.some((file) => file.path === "bin/uv.exe"));
  assert.ok(development.installProbe.files.some((file) => file.path === "runtimes/python/python.exe"));
  assert.ok(
    packaged.installProbe.files.some(
      (file) => file.path === "runtimes/solidworks-python/runtime-artifact.json",
    ),
  );
  assert.ok(
    packaged.installProbe.files.some(
      (file) => file.path === "SolidworksMCP-python/runtime-artifact.json",
    ),
  );
  assert.ok(
    packaged.installProbe.files.some(
      (file) => file.path === "SolidworksMCP-python/pylock.packaged.toml",
    ),
  );
  assert.ok(!packaged.installProbe.files.some((file) => file.path === "bin/uv.exe"));
  assert.equal(service.idleTtlMs, 600_000);
});

test("Next CAD paths no longer own the SolidWorks process tree", () => {
  const backend = source("src/lib/cad/solidworks/backend.ts");
  const design = source("src/lib/cad/design-service.ts");
  const health = source("src/app/api/cad/health/route.ts");
  for (const text of [backend, design, health]) {
    assert.doesNotMatch(text, /node:child_process|from ["']\.\/solidworks\/bridge|solidworksBridge\(/);
  }
  assert.match(backend, /acquireSolidWorksRuntimeLease\(env\)/);
  assert.match(backend, /finally \{[\s\S]*releaseSolidWorksRuntimeLease\(lease, env\)/);
  assert.match(design, /readSolidWorksRuntimeStatus\(\)/);
  assert.match(health, /readSolidWorksRuntimeStatus\(\)/);

  const directBridge = source("src/lib/cad/solidworks/bridge.ts");
  assert.match(directBridge, /BREADBOARD_SOLIDWORKS_BRIDGE_OWNER/);
  assert.match(directBridge, /runtime-v2-service/);
  assert.match(directBridge, /BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME/);
  assert.match(directBridge, /immutable packaged Python runtime is missing or incomplete/);
  assert.ok(
    directBridge.indexOf("BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME") <
      directBridge.indexOf("directFile(env.BREADBOARD_UV_PATH)"),
    "immutable packaged mode must fail before resolving the development installer",
  );
  assert.match(
    source("src/lib/cad/solidworks/configuration.ts"),
    /immutable packaged Python runtime is (?:missing|incomplete)/,
  );
  const wrapper = source("scripts/runtime-v2-solidworks-mcp-service.mjs");
  assert.match(wrapper, /import\(moduleUrl\(sourceRoot, "lib\/cad\/solidworks\/bridge\.ts"\)\)/);
  assert.match(wrapper, /tokenEnvironmentName: "BREADBOARD_SOLIDWORKS_SERVICE_TOKEN"/);
  assert.match(wrapper, /maximumRequestBytes: 512 \* 1024/);
  assert.match(wrapper, /ALLOWED_TOOLS/);
  assert.match(wrapper, /solidworks_export_escaped_workspace/);
});

test("the private client sends one bounded authenticated tool RPC", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      ok: true,
      result: { data: { status: "success" }, text: "ok", isError: false, raw: {} },
    });
  };
  try {
    const bridge = runtimeService.solidWorksRuntimeBridge(environment());
    const result = await bridge.callTool("create_part", { name: "fixture" }, { timeoutMs: 5_000 });
    assert.equal(result.data.status, "success");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:7131/v1/call");
    assert.equal(calls[0].init.headers.authorization, `Bearer ${"s".repeat(48)}`);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      name: "create_part",
      arguments: { name: "fixture" },
      timeoutMs: 5_000,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("passive stopped status reads native state once and never calls the service", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      services: [{ id: "solidworks-mcp", state: "available-but-stopped" }],
    });
  };
  try {
    const status = await runtimeService.readSolidWorksRuntimeStatus(environment());
    assert.equal(status.bridge.running, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:7130/v1/status");
    assert.equal(calls[0].init.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("caller cancellation is preserved as solidworks_aborted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    await new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason ?? new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  const controller = new AbortController();
  try {
    const bridge = runtimeService.solidWorksRuntimeBridge(environment());
    const pending = bridge.callTool("create_part", {}, { timeoutMs: 5_000, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error?.code === "solidworks_aborted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("packaging pins the reviewed bridge source and never stages a venv", () => {
  const prepare = fs.readFileSync(
    path.join(repoRoot, "desktop", "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  const verify = fs.readFileSync(
    path.join(repoRoot, "desktop", "scripts", "verify-package.mjs"),
    "utf8",
  );
  for (const text of [prepare, verify]) {
    assert.match(text, /a6d1f1be409547c43503dc4a4dcf2c39e6d99096/);
    assert.match(text, /SolidworksMCP-python/);
    assert.match(text, /BREADBOARD_UPSTREAM_COMMIT/);
  }
  assert.match(verify, /forbidden SolidWorks MCP mutable\/cache file staged/);
});
