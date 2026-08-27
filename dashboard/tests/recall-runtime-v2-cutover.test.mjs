import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectRecallProcessState } from "../src/lib/recall/engine.ts";
import { DEFAULT_RECALL_SETTINGS } from "../src/lib/recall/policy.ts";
import {
  readRecallRuntimeStatus,
  recallRuntimeManaged,
  reconcileRecallRuntime,
} from "../src/lib/recall/runtime-service.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const managedEnv = {
  RECALL_RUNTIME_MANAGED: "1",
  BREADBOARD_SUPERVISOR_CONTROL_URL: "http://127.0.0.1:45678/",
  BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "x".repeat(32),
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Recall managed mode requires the exact server-only marker", () => {
  assert.equal(recallRuntimeManaged({ RECALL_RUNTIME_MANAGED: "1" }), true);
  assert.equal(recallRuntimeManaged({ RECALL_RUNTIME_MANAGED: "true" }), false);
  assert.equal(recallRuntimeManaged({ RECALL_RUNTIME_MANAGED: "0" }), false);
  assert.equal(recallRuntimeManaged({}), false);
});

test("status is observational, owner-scoped, bounded, and sends an exact empty body", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return jsonResponse({
      protocolVersion: 1,
      ok: true,
      serviceId: "recall",
      desiredState: "running",
      serviceState: "healthy",
      ownedByRequester: true,
      logTail: ["recorder ready"],
    });
  };
  try {
    const status = await readRecallRuntimeStatus(7, managedEnv);
    assert.equal(status?.serviceState, "healthy");
    assert.equal(status?.ownedByRequester, true);
    assert.deepEqual(status?.logTail, ["recorder ready"]);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "http://127.0.0.1:45678/v1/services/recall/status",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, {});
  assert.equal(calls[0].init.headers["x-breadboard-user-id"], "7");
  assert.equal(
    calls[0].init.headers.authorization,
    `Bearer ${managedEnv.BREADBOARD_SUPERVISOR_CONTROL_TOKEN}`,
  );
});

test("running reconcile sends only typed normalized privacy configuration", async () => {
  let request = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    return jsonResponse({
      protocolVersion: 1,
      ok: true,
      serviceId: "recall",
      desiredState: "running",
      serviceState: "healthy",
    });
  };
  try {
    await reconcileRecallRuntime(
      9,
      "running",
      {
        ...DEFAULT_RECALL_SETTINGS,
        captureAudio: false,
        excludedWindows: ["  1Password  ", "1PASSWORD", "Slack::#hr"],
      },
      managedEnv,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(request, {
    desiredState: "running",
    configuration: {
      captureAudio: false,
      excludedWindows: ["1Password", "Slack::#hr"],
    },
  });
  assert.equal("command" in request, false);
  assert.equal("env" in request, false);
  assert.equal("apiKey" in request, false);
});

test("stop reconcile has no configuration, command, path, or secret material", async () => {
  let request = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    return jsonResponse({
      protocolVersion: 1,
      ok: true,
      serviceId: "recall",
      desiredState: "stopped",
      serviceState: "stopped",
    });
  };
  try {
    await reconcileRecallRuntime(11, "stopped", null, managedEnv);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(request, { desiredState: "stopped" });
});

test("external mode is observable but never invents local lifecycle ownership", async () => {
  assert.equal(await readRecallRuntimeStatus(3, {}), null);
  await assert.rejects(
    reconcileRecallRuntime(3, "running", DEFAULT_RECALL_SETTINGS, {}),
    (error) => error?.code === "engine_start_failed",
  );
  assert.deepEqual(projectRecallProcessState(null, false), {
    running: false,
    pid: null,
    startedAt: null,
    launchedWith: null,
    managed: false,
  });
});

test("managed responses fail closed on extra fields and oversized diagnostics", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      protocolVersion: 1,
      ok: true,
      serviceId: "recall",
      desiredState: "running",
      serviceState: "healthy",
      ownedByRequester: true,
      logTail: [],
      command: "secret executable --secret",
    });
  try {
    await assert.rejects(
      readRecallRuntimeStatus(4, managedEnv),
      (error) => error?.code === "engine_unavailable",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Next contains no Recall recorder process owner or cold-starting read path", () => {
  const engine = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "recall", "engine.ts"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "recall", "service.ts"),
    "utf8",
  );
  const runtime = fs.readFileSync(
    path.join(
      repoRoot,
      "dashboard",
      "src",
      "lib",
      "recall",
      "runtime-service.ts",
    ),
    "utf8",
  );
  for (const source of [engine, service, runtime]) {
    assert.doesNotMatch(
      source,
      /from\s+["']child_process["']|\bspawn\s*\(|process\.kill\s*\(/,
    );
  }
  const readOnlyPrefix = service.slice(
    0,
    service.indexOf("export type RecallControlAction"),
  );
  assert.doesNotMatch(readOnlyPrefix, /reconcileRecallRuntime\s*\(/);
});
