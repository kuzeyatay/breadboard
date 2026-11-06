import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { multisimRequest, runMultisim } from "../src/lib/hermes/multisim-service.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("native circuit requests cannot select a runtime, workspace or shell command", () => {
  for (const input of [{ action: "op; whoami" }, { action: "op", workspace: "/" }, { action: "op", arguments: [] },
    { action: "parameter_sweep", arguments: { timeout: 3600 } }]) {
    assert.throws(() => multisimRequest(input));
  }
  assert.deepEqual(multisimRequest({ action: "parameter_sweep", arguments: {} }), { action: "parameter_sweep", payload: '{"timeout":300}' });
  for (const surface of ["dashboard_terminal", "garden_chat"]) assert(allowedToolsForSurface(surface).includes("multisim"));
});

test("authenticated broker worker path runs real divider, persists across calls and isolates conversations", async (t) => {
  const config = path.join(root, ".runtime/multisim.json");
  if (!fs.existsSync(config)) return t.skip("Run npm run setup:multisim for native integration test");
  fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
  const workspace = fs.mkdtempSync(path.join(root, ".tmp/multisim-native-"));
  const second = fs.mkdtempSync(path.join(root, ".tmp/multisim-other-"));
  const circuit = JSON.parse(fs.readFileSync(path.join(root, "skills/multisim-agent/examples/divider.json"), "utf8"));
  // Runtime V2 uses \\?\C:\... paths on Windows. Exercise that actual boundary.
  const nativeWorkspace = path.toNamespacedPath(workspace);
  const invoke = (action, args = {}) => runMultisim(nativeWorkspace, { action, arguments: args }, { configPath: config });
  const status = await invoke("runtime_status");
  if (!status.backend.available) return t.skip("Real ngspice required");
  const state = await invoke("create_circuit", { circuit });
  const result = await invoke("run_circuit_experiment", { circuit_id: state.circuit_id, analysis: { kind: "op" }, render: false });
  assert.equal(result.success, true);
  const voltage = await invoke("measure_voltage", { run_id: result.run_id, node: "vout" });
  assert(Math.abs(voltage.value - 2.5) < 1e-8);
  assert.equal((await invoke("inspect_artifacts", { run_id: result.run_id })).integrity_ok, true);
  await assert.rejects(runMultisim(second, { action: "load_circuit", arguments: { circuit_id: state.circuit_id } }, { configPath: config }));
  await assert.rejects(invoke("load_circuit", { circuit_id: "../escape" }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runMultisim(workspace, { action: "runtime_status" }, { configPath: config, signal: controller.signal }));
});
