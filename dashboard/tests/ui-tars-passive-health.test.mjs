import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import {defaultAgentConfiguration, validateAgentConfiguration} from "../src/lib/ui-tars/config.ts";
import {providerRequiresStoredKey} from "../src/lib/ui-tars/model-provider.ts";
import {unavailableServiceMessage} from "../src/lib/runtime-v2/unavailable-service-message.ts";

function fixture() {
  const state = {native: true, snapshot: {state: "available-but-stopped"}, rows: [], probes: 0, reads: [], adapter: {status: "healthy", runtime: "agent-tars", realBrowser: true, operator: "browser", operators: ["browser"], version: "fixture"}};
  const modules = {
    "./client.ts": {UITarsClient: class {async health() {state.probes++; return state.adapter;}}, UITarsAdapterError: class extends Error {}},
    "./adapter-config.ts": {uiTarsMode: () => "optional", resolveUITarsConfig: () => ({secret: "fixture"})},
    "./store.ts": {listAgents: () => state.rows, presentAgent: row => row, listRuns: () => []},
    "./config.ts": {validateAgentConfiguration},
    "./model-provider.ts": {providerRequiresStoredKey},
    "./errors.ts": {UITarsServiceError: class extends Error {}},
    "./runtime-run-manager.ts": {refreshAgentRuns: async () => {}, syncRunProjection: async () => {}},
    "../runtime-v2/unavailable-service-message.ts": {unavailableServiceMessage},
    "../supervisor-control.ts": {SupervisorResourceExhaustedError: class extends Error {}, isRuntimeV2ServiceControlConfigured: () => state.native, readSupervisedServiceSnapshot: async id => {state.reads.push(id); return state.snapshot;}},
  };
  const source = fs.readFileSync(new URL("../src/lib/ui-tars/service.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const service = {};
  new Function("require", "exports", code)(id => {assert.ok(id in modules, `Unexpected import: ${id}`); return modules[id];}, service);
  return {state, service};
}

test("stopped native TARS is installed on demand without probing or claiming live operators", async () => {
  const {state, service} = fixture();
  for (const lifecycle of ["available-but-stopped", "stopped"]) {
    state.snapshot = {state: lifecycle};
    const result = await service.health();
    assert.equal(result.runtimeState, "available");
    assert.deepEqual(result.health, {status: "unavailable", runtime: null, realBrowser: false, operator: null, version: null});
  }
  for (const lifecycle of [null, "installation-unavailable", "resource-blocked", "failed", "pending", "starting"]) {
    state.snapshot = lifecycle ? {state: lifecycle} : null;
    assert.equal((await service.health()).runtimeState, ["pending", "starting"].includes(lifecycle) ? "starting" : "unavailable");
  }
  assert.equal(state.probes, 0);
  assert.ok(state.reads.every(id => id === "ui-tars"));
});

test("on-demand availability preserves disabled, configuration, credential and computer-operator gates", async () => {
  const {state, service} = fixture();
  const base = {id: "fixture", enabled: true, configuration: defaultAgentConfiguration({}), secretConfigured: false};
  state.rows = [
    {...base, id: "browser"},
    {...base, id: "disabled", enabled: false},
    {...base, id: "missing-model", configuration: {...base.configuration, model: ""}},
    {...base, id: "missing-key", configuration: {...base.configuration, provider: "openai"}},
    {...base, id: "computer", configuration: {...base.configuration, operator: "computer"}},
  ];
  const page = await service.agentsPage(7);
  assert.deepEqual(page.agents.map(agent => [agent.id, agent.runtimeState]), [["browser", "available"], ["disabled", "disabled"], ["missing-model", "misconfigured"], ["missing-key", "misconfigured"], ["computer", "unavailable"]]);
  assert.equal(page.adapter.realBrowser, false);
  assert.equal(state.probes, 0);
  state.snapshot = {state: "healthy"};
  assert.equal((await service.agentsPage(7)).agents.at(-1).runtimeState, "unavailable");
  state.adapter.operators.push("computer");
  assert.equal((await service.agentsPage(7)).agents.at(-1).runtimeState, "available");
});

test("a running or external adapter still supplies real health and operator evidence", async () => {
  const {state, service} = fixture();
  state.snapshot = {state: "healthy"};
  assert.equal((await service.health()).health.realBrowser, true);
  state.native = false;
  state.adapter = {...state.adapter, status: "unavailable", realBrowser: false};
  assert.equal((await service.health()).runtimeState, "unavailable");
  assert.equal(state.probes, 2);
  assert.deepEqual(state.reads, ["ui-tars"]);
});
