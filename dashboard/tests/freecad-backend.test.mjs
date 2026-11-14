import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseParametricCadRequest } from "../src/lib/cad/identity.ts";
import { parseHardwareBlueprintRequest } from "../src/lib/hardware/identity.ts";
import { cadEngineFromProvenance, resolveCadEngine } from "../src/lib/cad/engines.ts";
import { freecadAvailability, freecadExecutable } from "../src/lib/cad/freecad/config.ts";
import { buildWithFreeCAD } from "../src/lib/cad/freecad/backend.ts";
import { cadToolDefinitions } from "../src/lib/cad/tools.ts";
import { cadSystemPrompt } from "../src/lib/cad/prompts.ts";
import { CAD_FILE_DESCRIPTORS } from "../src/lib/cad/blob-store.ts";
import { findConfigurableAgent, normalizeAgentSettings } from "../src/lib/agent-settings/catalog.ts";
import { validateRuntimeV2ParametricCadRequest } from "../scripts/runtime-v2-outer-agent-adapters.mjs";

test("FreeCAD is selected by flag, natural request and saved preference without changing CadQuery defaults", () => {
  assert.equal(resolveCadEngine({}).engine, "cadquery");
  assert.equal(parseParametricCadRequest("--cad freecad make a washer").cadBackend, "freecad");
  assert.equal(parseParametricCadRequest("make a FreeCAD washer", { cadBackend: "auto" }).cadBackend, "freecad");
  assert.equal(parseParametricCadRequest("make a washer", { cadBackend: "freecad" }).cadBackend, "freecad");
  assert.equal(parseParametricCadRequest("--cad cadquery make a FreeCAD washer").cadBackend, "cadquery");
  assert.equal(parseHardwareBlueprintRequest("--cad freecad make an enclosure").cadBackend, "freecad");
  assert.equal(cadEngineFromProvenance('{"engine":"freecad"}'), "freecad");
  assert.throws(() => cadEngineFromProvenance('{"engine":"unknown"}'));
  for (const id of ["hardware-blueprint", "parametric-cad"]) {
    const agent = findConfigurableAgent(id);
    assert.equal(normalizeAgentSettings(agent, { cadBackend: "freecad" }).cadBackend, "freecad");
  }
});

test("FreeCAD requests cross the sealed Runtime request boundary, including old saved requests", () => {
  const request = {
    operation: "run", conversationPublicId: `conv_${"a".repeat(24)}`,
    clientMessageId: "", brief: "make a washer", parsed: parseParametricCadRequest("--cad freecad make a washer"),
    model: "model", reasoningEffort: "medium", baseUrl: "http://127.0.0.1:8000/v1",
  };
  assert.equal(validateRuntimeV2ParametricCadRequest(request), request);
  const legacy = { ...request, parsed: parseParametricCadRequest("make a washer") };
  assert.equal(validateRuntimeV2ParametricCadRequest(legacy), legacy);
  assert.throws(() => validateRuntimeV2ParametricCadRequest({ ...request, parsed: { ...request.parsed, cadBackend: "other" } }));
  assert.throws(() => validateRuntimeV2ParametricCadRequest({ ...request, parsed: { ...request.parsed, executable: "arbitrary" } }));
});

test("FreeCAD generation contracts describe the native API and native deliverables", () => {
  const tool = cadToolDefinitions("freecad").find((item) => item.name === "cad_generate_model");
  assert.match(tool.parameters.properties.source.description, /build_model\(doc, params\)/);
  assert.match(tool.description, /FCStd/);
  assert.doesNotMatch(tool.parameters.properties.source.description, /import cadquery/);
  const prompt = cadSystemPrompt({ engine: "freecad", attemptBudget: 3, safety: { level: "supported" } });
  assert.match(prompt, /neka-nat\/freecad-mcp/);
  assert.match(prompt, /PartDesign::Pad/);
  assert.equal(CAD_FILE_DESCRIPTORS.fcstd.filename, "model.FCStd");
  assert.match(CAD_FILE_DESCRIPTORS["freecad-source"].label, /FreeCAD/);
});

test("availability is passive and explicit missing executable overrides discovery", () => {
  const env = { ...process.env, BREADBOARD_FREECAD_CMD: path.join(os.tmpdir(), "nonexistent-freecad.exe") };
  assert.equal(freecadExecutable(env), null);
  assert.equal(freecadAvailability(env).code, "freecad_not_installed");
});

test("MCP success without produced native files cannot publish a design", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecad-missing-"));
  try {
    await assert.rejects(buildWithFreeCAD({
      source: "def build_model(doc, params): return {}",
      request: { source: "", entrypoint: "build_model", parameters: {}, timeoutMs: 1000, exports: [], expectations: {} },
      env: { ...process.env, BREADBOARD_FREECAD_HOME: home },
      execute: async () => "success",
      convert: async () => { assert.fail("must not convert missing files"); },
    }), (error) => error.code === "freecad_export_missing");
    assert.deepEqual(fs.readdirSync(path.join(home, "builds")), []);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
