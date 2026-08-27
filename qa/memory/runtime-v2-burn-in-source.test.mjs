import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateRuntimeV2BurnInSource } from "./runtime-v2-burn-in-contract.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(qaDir, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function sources(overrides = {}) {
  return {
    packageManifest: JSON.parse(read("package.json")),
    serviceManifest: JSON.parse(read("desktop/runtime-v2/manifests/services.json")),
    playwrightConfigSource: read("qa/electron/playwright.config.ts"),
    runnerSource: read("qa/memory/run-memory-qa.mjs"),
    fixtureSource: read("qa/electron/fixtures.ts"),
    environmentSource: read("qa/electron/environment.ts"),
    recorderSource: read("qa/electron/runtime-v2-burn-in-recorder.ts"),
    workloadSource: read("qa/electron/specs/runtime-v2-burn-in/completion-burn-in.spec.ts"),
    schema: JSON.parse(read("qa/memory/runtime-v2-burn-in-receipt.schema.json")),
    ...overrides,
  };
}

test("dedicated burn-in is an exact actual-Electron fail-closed source gate", () => {
  const result = validateRuntimeV2BurnInSource(sources());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("source gate rejects the former exploratory inventory command", () => {
  const input = sources();
  input.packageManifest.scripts["qa:runtime-v2:burn-in"] =
    "node qa/memory/run-memory-qa.mjs --mode=burn-in --workload-project=exploratory --workload-repeat-each=5";
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /dedicated one-pass Electron project/);
});

test("source gate rejects a skipped or blocked workload path", () => {
  const input = sources({
    workloadSource: `${read("qa/electron/specs/runtime-v2-burn-in/completion-burn-in.spec.ts")}\n` +
      `const forbidden = { classification: "BLOCKED" };\n`,
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /forbidden skip\/mock timing path/);
});

test("source gate rejects a schema that weakens the free-commit floor", () => {
  const input = sources();
  input.schema.$defs.operation.properties.minimumFreeCommitMb.exclusiveMinimum = 2_900;
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schema omits exact structural acceptance/);
});

test("source gate rejects a shortened burn-in timeout masquerading as endurance", () => {
  const input = sources({
    runnerSource: read("qa/memory/run-memory-qa.mjs")
      .replace("durationMs !== RUNTIME_V2_BURN_IN.requiredDurationMs", "durationMs < 5000"),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /durationMs !== RUNTIME_V2_BURN_IN\.requiredDurationMs/);
});

test("source gate requires a self-contained default settle window", () => {
  const input = sources({
    runnerSource: read("qa/memory/run-memory-qa.mjs")
      .replace("resolveRuntimeV2BurnInSettleWindowMs(", "omitDefaultSettleWindow("),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /self-contained default settle duration/);
});

test("source gate rejects mandatory-service manifest drift", () => {
  const input = sources();
  input.serviceManifest.services.find(({ id }) => id === "gbrain").requirement = "optional";
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /mandatory-service contract drifted|omits GBrain/);
});

test("source gate requires the fail-fast burn and all-service validators", () => {
  const input = sources();
  delete input.packageManifest.scripts["preqa:runtime-v2:burn-in"];
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /fail fast/);
});

test("source gate requires fresh packaged service-receipt preflight and recorder binding", () => {
  const missingPreflight = sources({
    runnerSource: read("qa/memory/run-memory-qa.mjs")
      .replaceAll("readLatestSuccessfulServiceEvidence({", "omitLatestServiceEvidence({"),
  });
  assert.match(
    validateRuntimeV2BurnInSource(missingPreflight).errors.join("\n"),
    /readLatestSuccessfulServiceEvidence/,
  );

  const latePreflightSource = read("qa/memory/run-memory-qa.mjs");
  const latePreflight = sources({
    runnerSource: `${latePreflightSource.replace(
      "readLatestSuccessfulServiceEvidence({",
      "omitLatestServiceEvidence({",
    )}\n// readLatestSuccessfulServiceEvidence({`,
  });
  assert.match(
    validateRuntimeV2BurnInSource(latePreflight).errors.join("\n"),
    /before workload launch/,
  );

  const missingRecorderBinding = sources({
    recorderSource: read("qa/electron/runtime-v2-burn-in-recorder.ts")
      .replaceAll("this.assertServiceEvidenceBindingFiles(true)", "omitServiceEvidencePreflight()"),
  });
  assert.match(
    validateRuntimeV2BurnInSource(missingRecorderBinding).errors.join("\n"),
    /assertServiceEvidenceBindingFiles/,
  );

  const weakSchema = sources();
  delete weakSchema.schema.properties.serviceEvidence;
  assert.match(
    validateRuntimeV2BurnInSource(weakSchema).errors.join("\n"),
    /schema omits exact structural acceptance/,
  );
});

test("source gate rejects missing mixed-cycle retrieval and Quartz UI evidence", () => {
  const input = sources({
    workloadSource: read("qa/electron/specs/runtime-v2-burn-in/completion-burn-in.spec.ts")
      .replaceAll("verifyQuartzBuild(", "unverifiedQuartzBuild("),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /verifyQuartzBuild/);
});

test("source gate rejects removal of browser-agent UI start/cancel evidence", () => {
  const input = sources({
    workloadSource: read("qa/electron/specs/runtime-v2-burn-in/completion-burn-in.spec.ts")
      .replaceAll("startBrowserAgentFromUi(page)", "omittedBrowserStart(page)"),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /startBrowserAgentFromUi/);
});

test("source gate accepts cancelled browser tree-exit proof without inventing a complete event", () => {
  const input = sources({
    recorderSource: read("qa/electron/runtime-v2-burn-in-recorder.ts")
      .replace(
        "const treeExit = this.treeExitEvidence(terminal!)",
        "const treeExit = this.completionEvidence(terminal!)",
      ),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /treeExitEvidence/);
});

test("source gate rejects removal of Postiz availability and Runtime activation evidence", () => {
  const input = sources({
    workloadSource: read("qa/electron/specs/runtime-v2-burn-in/completion-burn-in.spec.ts")
      .replaceAll("activatePostizThroughRuntime(page)", "omittedPostizActivation(page)"),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /activatePostizThroughRuntime/);
});

test("source gate rejects removal of partial Postiz Runtime cleanup", () => {
  const input = sources({
    workloadSource: read("qa/electron/specs/runtime-v2-burn-in/completion-burn-in.spec.ts")
      .replaceAll("stopPostizThroughRuntime(page)", "omitPostizCleanup(page)"),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /stopPostizThroughRuntime/);
});

test("source gate rejects moving conditional lifecycles out of every mixed cycle", () => {
  const input = sources({
    recorderSource: read("qa/electron/runtime-v2-burn-in-recorder.ts")
      .replace("const browserAgent = await actions.browserAgent()", "const browserAgent = { classification: 'PASS' }")
      .replace("const postiz = await actions.postiz()", "const postiz = { classification: 'PASS' }"),
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /actions\.browserAgent|actions\.postiz/);
});

test("source gate rejects conditional lifecycle markers moved after mixed-cycle settling", () => {
  const original = read("qa/electron/runtime-v2-burn-in-recorder.ts");
  const browserMarker = "const browserAgent = await actions.browserAgent()";
  const input = sources({
    recorderSource: `${original.replace(browserMarker, "const browserAgent = { classification: 'PASS' }")}\n` +
      `// ${browserMarker}\n`,
  });
  const result = validateRuntimeV2BurnInSource(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /full ordered mixed cycle/);
});

test("source gate rejects receipt schemas that omit either conditional disposition", () => {
  const browserInput = sources();
  delete browserInput.schema.properties.browserAgent;
  assert.match(
    validateRuntimeV2BurnInSource(browserInput).errors.join("\n"),
    /schema omits exact structural acceptance/,
  );

  const postizInput = sources();
  delete postizInput.schema.properties.postiz;
  assert.match(
    validateRuntimeV2BurnInSource(postizInput).errors.join("\n"),
    /schema omits exact structural acceptance/,
  );

  const cleanupInput = sources();
  delete cleanupInput.schema.$defs.postiz.properties.activationCleanup;
  assert.match(
    validateRuntimeV2BurnInSource(cleanupInput).errors.join("\n"),
    /schema omits exact structural acceptance/,
  );
});
