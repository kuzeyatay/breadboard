import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES,
  compileGeneratedVisualization,
  generateVisualizationCandidate,
  planGeneratedVisualSelectPreviewStates,
  runGeneratedVisualBrowserTests,
  runGeneratedVisualDeterministicTests,
  validateGeneratedVisualizationCandidateEnvelope,
  validateGeneratedVisualizationDefinition,
} from "../src/lib/generated-visuals.ts";

const visibleCase = (index) => ({
  kind: "conditional",
  comparison: "eq",
  left: { kind: "input", id: "case_mode" },
  right: { kind: "constant", value: index },
  whenTrue: { kind: "constant", value: 1 },
  whenFalse: { kind: "constant", value: 0 },
});

function spatialDefinition() {
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "General spatial construction",
    description: "Choose one of three generic geometric cases in a shared frame.",
    accessibilityDescription: "A labelled selector changes the visible spatial construction while a fixed point remains in place. Every object is named by type and pattern in a text legend.",
    controls: [{
      id: "case_mode",
      kind: "select_case",
      label: "Construction",
      type: "select",
      options: ["Planar", "Axial", "Radial"],
      defaultValue: "Planar",
    }],
    outputs: [{ id: "case_view", label: "Selected construction", representation: "diagram" }],
    scenes: [{
      kind: "spatial",
      title: "Shared spatial frame",
      view: { azimuthDegrees: 38, elevationDegrees: 26, scale: 1 },
      groups: [
        {
          id: "common-items",
          label: "Common",
          primitives: [
            { kind: "point", id: "fixed-point", label: "Fixed point", position: [1, 1, 1], size: 8, color: "red" },
            { kind: "vector", id: "reference-vector", label: "Reference direction", from: [0, 0, 0], to: [1, 1, 1], headSize: 7, color: "gray", pattern: "dotted" },
          ],
        },
        {
          id: "planar-case",
          label: "Planar",
          visibleWhen: visibleCase(0),
          primitives: [
            { kind: "plane", id: "sample-plane", label: "Sample plane", center: [0, 0, 0], normal: [0, 0, 1], size: 5, color: "blue", pattern: "striped", opacity: 0.35 },
            {
              kind: "polygon",
              id: "sample-polygon",
              label: "Clipped surface patch",
              points: [
                [0, 0, -1],
                [{ kind: "binary", op: "add", left: { kind: "constant", value: 3 }, right: { kind: "input", id: "t" } }, 0, -1],
                [{ kind: "binary", op: "add", left: { kind: "constant", value: 3 }, right: { kind: "input", id: "t" } }, 0, 1],
                [0, 0, 1],
              ],
              color: "cyan",
              pattern: "dotted",
              opacity: 0.35,
            },
          ],
        },
        {
          id: "axial-case",
          label: "Axial",
          visibleWhen: visibleCase(1),
          primitives: [
            { kind: "cylinder", id: "sample-cylinder", label: "Sample cylinder", center: [0, 0, 0], axis: [0, 0, 1], radius: 1.4, height: 5, color: "amber", pattern: "crosshatch" },
          ],
        },
        {
          id: "radial-case",
          label: "Radial",
          visibleWhen: visibleCase(2),
          primitives: [
            { kind: "sphere", id: "sample-sphere", label: "Sample sphere", center: [0, 0, 0], radius: 2.2, color: "green", pattern: "dotted" },
            { kind: "cone", id: "sample-cone", label: "Sample cone", apex: [0, 0, -2.5], axis: [0, 0, 1], radius: 1.8, height: 5, color: "violet", pattern: "solid" },
          ],
        },
      ],
    }],
  };
}

function denseIntersectingSpatialDefinition() {
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Intersecting spatial surfaces",
    description: "Inspect several labelled surfaces and directions that meet at one point.",
    accessibilityDescription: "Three patterned surfaces and three labelled vectors meet at one labelled point. Leaders keep labels associated with dense geometry.",
    controls: [],
    outputs: [{ id: "dense_view", label: "Intersecting construction", representation: "diagram" }],
    scenes: [{
      kind: "spatial",
      title: "Dense construction",
      view: { azimuthDegrees: 35, elevationDegrees: 24, scale: 0.9 },
      groups: [{
        id: "dense-items",
        label: "Construction",
        primitives: [
          { kind: "plane", id: "x-surface", label: "First surface", center: [0, 0, 0], normal: [1, 0, 0], size: 4, color: "red", pattern: "striped" },
          { kind: "plane", id: "y-surface", label: "Second surface", center: [0, 0, 0], normal: [0, 1, 0], size: 4, color: "green", pattern: "dotted" },
          { kind: "plane", id: "z-surface", label: "Third surface", center: [0, 0, 0], normal: [0, 0, 1], size: 4, color: "blue", pattern: "crosshatch" },
          { kind: "point", id: "shared-point", label: "Shared point", position: [0, 0, 0], size: 8, color: "amber" },
          { kind: "vector", id: "first-direction", label: "First local direction", from: [0, 0, 0], to: [1.4, 0, 0], headSize: 8, color: "red" },
          { kind: "vector", id: "second-direction", label: "Second local direction", from: [0, 0, 0], to: [0, 1.4, 0], headSize: 8, color: "green" },
          { kind: "vector", id: "third-direction", label: "Third local direction", from: [0, 0, 0], to: [0, 0, 1.4], headSize: 8, color: "blue" },
        ],
      }],
    }],
  };
}

const opportunity = {
  id: "visual-spatial-fixture",
  gardenId: "test-garden",
  learningUnitId: "U1",
  targetPage: "learning/spatial-fixture.md",
  similarityFingerprint: "spatial-fixture",
  requiredInputs: [{
    id: "case_mode",
    kind: "select_case",
    label: "Construction",
    type: "select",
    options: ["Planar", "Axial", "Radial"],
    defaultValue: "Planar",
  }],
  requiredOutputs: [{ id: "case_view", label: "Selected construction", representation: "diagram" }],
  sourceAnchorIds: [],
};

function moduleSource(definition) {
  return `import { defineVisualization } from "@breadboard/visual-sdk";\nexport default defineVisualization(${JSON.stringify(definition)});`;
}

function browserPath() {
  return [
    process.env.BREADBOARD_VISUAL_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate));
}

test("compiler accepts bounded model-authored spatial groups and every primitive kind", () => {
  const definition = spatialDefinition();
  const sourceCode = moduleSource(definition);
  assert.ok(Buffer.byteLength(sourceCode) < 16_000, `fixture is ${Buffer.byteLength(sourceCode)} bytes`);

  const compilation = compileGeneratedVisualization(sourceCode, opportunity);
  assert.ok(compilation.definition, compilation.validation.errors.join("; "));
  assert.ok(compilation.validation.astNodeCount < 2_500);
  assert.match(compilation.compiledJavaScript, /"kind":"spatial"/);

  const tests = runGeneratedVisualDeterministicTests({
    definition: compilation.definition,
    opportunity,
    testCases: [],
  });
  assert.equal(tests.passed, true, JSON.stringify(tests));
  assert.equal(
    tests.semanticTests.find((entry) => /Construction changes/.test(entry.name))?.passed,
    true,
    "group visibleWhen must count as control influence",
  );
  assert.equal(
    tests.runtimeTests.find((entry) => /spatial geometry remains/.test(entry.name))?.passed,
    true,
  );
});

test("spatial validation rejects unsafe bounds, malformed vectors, and degenerate geometry", () => {
  const invalid = spatialDefinition();
  invalid.scenes[0].view = { azimuthDegrees: 181, elevationDegrees: 86, scale: 3 };
  invalid.scenes[0].groups[1].primitives[0] = {
    ...invalid.scenes[0].groups[1].primitives[0],
    normal: [0, 0, 0],
    color: "#00ff00",
    pattern: "gradient",
    opacity: 0.01,
  };
  invalid.scenes[0].groups[2].primitives[0].axis = [0, 0];
  invalid.scenes[0].groups[3].primitives.push({
    kind: "vector",
    id: "zero-vector",
    label: "Zero vector",
    from: [1, 1, 1],
    to: [1, 1, 1],
  });
  invalid.scenes[0].groups[3].primitives.push({
    kind: "polygon",
    id: "too-short-polygon",
    label: "Too short polygon",
    points: [[0, 0, 0], [1, 0, 0]],
  });
  invalid.scenes[0].groups[3].primitives.push({
    kind: "polygon",
    id: "noncoplanar-polygon",
    label: "Noncoplanar polygon",
    points: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 1]],
  });
  invalid.scenes[0].groups[3].primitives.push({
    kind: "polygon",
    id: "bow-tie-polygon",
    label: "Bow tie polygon",
    points: [[0, 0, 0], [2, 2, 0], [0, 2, 0], [2, 0, 0]],
  });
  invalid.scenes[0].groups[3].primitives.push({
    kind: "polygon",
    id: "duplicate-polygon",
    label: "Duplicate polygon",
    points: [[0, 0, 0], [2, 0, 0], [2, 0, 0], [0, 2, 0]],
  });
  invalid.scenes[0].groups[3].primitives.push({
    kind: "polygon",
    id: "collinear-polygon",
    label: "Collinear polygon",
    points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
  });
  invalid.scenes[0].groups[3].primitives.push({
    kind: "polygon",
    id: "oversized-polygon",
    label: "Oversized polygon",
    points: Array.from({ length: 13 }, (_, index) => [index, index % 2, 0]),
  });
  const validation = validateGeneratedVisualizationDefinition(invalid);
  const messages = validation.errors.join("; ");
  assert.match(messages, /azimuthDegrees must be between -180 and 180/);
  assert.match(messages, /elevationDegrees must be between -85 and 85/);
  assert.match(messages, /view\.scale must be between 0\.25 and 2/);
  assert.match(messages, /normal must be non-zero/);
  assert.match(messages, /safe spatial palette token/);
  assert.match(messages, /pattern must be solid, striped, dotted, or crosshatch/);
  assert.match(messages, /opacity must be between 0\.1 and 1/);
  assert.match(messages, /axis must contain exactly three spatial scalars/);
  assert.match(messages, /distinct from and to points/);
  assert.match(messages, /points must contain 3-12 spatial vectors/);
  assert.match(messages, /points must be coplanar/);
  assert.match(messages, /points must form a non-self-intersecting boundary/);
  assert.match(messages, /points must be distinct/);
  assert.match(messages, /points must contain at least three non-collinear points/);

  const tooMany = spatialDefinition();
  tooMany.scenes[0].groups = Array.from({ length: 13 }, (_, index) => ({
    id: `group-${index}`,
    label: `Group ${index}`,
    primitives: [{ kind: "point", id: `point-${index}`, label: `Point ${index}`, position: [index, 0, 0] }],
  }));
  assert.match(
    validateGeneratedVisualizationDefinition(tooMany).errors.join("; "),
    /spatial scene needs 1-12 groups/,
  );
});

test("dynamic spatial degeneracy fails deterministic runtime validation", () => {
  const definition = spatialDefinition();
  definition.scenes[0].groups[0].primitives[1].to = [
    { kind: "input", id: "case_mode" },
    { kind: "input", id: "case_mode" },
    { kind: "input", id: "case_mode" },
  ];
  const structural = validateGeneratedVisualizationDefinition(definition, opportunity);
  assert.equal(structural.errors.length, 0, structural.errors.join("; "));
  const result = runGeneratedVisualDeterministicTests({ definition, opportunity, testCases: [] });
  const spatial = result.runtimeTests.find((entry) => /spatial geometry remains/.test(entry.name));
  assert.equal(spatial?.passed, false);
  assert.match(spatial?.detail ?? "", /zero-length vector/);
});

test("polygon validation accepts a simple concave boundary", () => {
  const definition = spatialDefinition();
  definition.scenes[0].groups[1].primitives[1].points = [
    [0, 0, 0],
    [3, 0, 0],
    [3, 2, 0],
    [1.5, 1, 0],
    [0, 2, 0],
  ];
  const validation = validateGeneratedVisualizationDefinition(definition, opportunity);
  assert.equal(validation.errors.length, 0, validation.errors.join("; "));
});

test("expression-backed polygon geometry is checked across authored control states", () => {
  const definition = spatialDefinition();
  definition.scenes[0].groups[0].primitives.push({
    kind: "polygon",
    id: "dynamic-polygon",
    label: "Dynamic polygon",
    points: [
      [0, 0, 0],
      [2, 0, 0],
      [2, 2, { kind: "input", id: "case_mode" }],
      [0, 2, 0],
    ],
    color: "violet",
  });
  const structural = validateGeneratedVisualizationDefinition(definition, opportunity);
  assert.equal(structural.errors.length, 0, structural.errors.join("; "));
  const result = runGeneratedVisualDeterministicTests({ definition, opportunity, testCases: [] });
  const spatial = result.runtimeTests.find((entry) => /spatial geometry remains/.test(entry.name));
  assert.equal(spatial?.passed, false);
  assert.match(spatial?.detail ?? "", /points must be coplanar/);
});

test("candidate envelope fails closed and the Council-visible prompt discloses the exact shape and spatial schema", async () => {
  const definition = spatialDefinition();
  const valid = validateGeneratedVisualizationCandidateEnvelope({
    title: "Spatial construction",
    explanation: "The selector compares source-grounded geometry.",
    sourceCode: moduleSource(definition),
    testCases: [],
    accessibilityDescription: definition.accessibilityDescription,
    pedagogicalClaims: ["The interaction compares the declared cases."],
  });
  assert.ok(valid.candidate, valid.errors.join("; "));

  const missing = validateGeneratedVisualizationCandidateEnvelope({ sourceCode: moduleSource(definition), testCases: [] });
  assert.equal(missing.candidate, null);
  assert.match(missing.errors.join("; "), /candidate\.title is required/);
  assert.match(missing.errors.join("; "), /candidate\.pedagogicalClaims must be an array/);

  let request;
  const client = {
    chat: {
      completions: {
        create: async (body) => {
          request = body;
          return {
            choices: [{ message: { content: JSON.stringify({ sourceCode: moduleSource(definition), testCases: [] }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  };
  const previousSourceCode = `${"x".repeat(12_050)}END`;
  await assert.rejects(
    generateVisualizationCandidate({
      client,
      model: "test-model",
      opportunity,
      pageMarkdown: "Local teaching text.",
      previousSourceCode,
      errors: ["prior candidate needs repair"],
    }),
    /candidate envelope is invalid:.*candidate\.title is required.*candidate\.pedagogicalClaims must be an array/,
  );
  const system = request.messages.find((message) => message.role === "system").content;
  assert.match(system, /exactly these six fields/);
  assert.match(system, /diagram is only a 2D node-link graph/i);
  assert.match(system, /output\.representation is metadata and does not force scene\.kind/);
  assert.match(system, /A spatial scene is exactly/);
  assert.match(system, /plane\(center,normal,size\).*polygon\(points with 3-12 coplanar non-collinear SpatialVectors in boundary order\).*sphere\(center,radius\).*cylinder\(center,axis,radius,height\).*cone\(apex,axis,radius,height\).*point\(position,size\?\).*vector\(from,to,headSize\?\)/);
  assert.match(system, /plane is a centered full rectangular patch extending to both sides of its center/);
  assert.match(system, /Use ordered polygon vertices, not plane, whenever the visible surface must be clipped, sector-shaped, one-sided, triangular, or a half-plane patch/);
  assert.match(system, /Group or primitive visibleWhen counts as scene influence/);
  assert.match(system, /below 16,000 bytes/);
  assert.match(system, /complete syntactically valid spatial module template/);
  const spatialTemplateMarker = "complete syntactically valid spatial module template; replace its generic labels and geometry with source-grounded content:\n";
  const promptedSpatialSource = system.slice(system.indexOf(spatialTemplateMarker) + spatialTemplateMarker.length).trim();
  const promptedSpatialCompilation = compileGeneratedVisualization(promptedSpatialSource);
  assert.ok(promptedSpatialCompilation.definition, promptedSpatialCompilation.validation.errors.join("; "));
  assert.ok(Buffer.byteLength(promptedSpatialSource) < 16_000);
  const userPacket = JSON.parse(request.messages.find((message) => message.role === "user").content);
  assert.equal(userPacket.repairContext.previousSourceCode, previousSourceCode);
  assert.deepEqual(userPacket.repairContext.exactErrors, ["prior candidate needs repair"]);
});

test("select preview planning covers mixed reviewed select kinds, remains bounded, and marks unrendered combinations explicitly", () => {
  const definition = spatialDefinition();
  definition.controls.push({
    id: "comparison_mode",
    kind: "process_position",
    label: "Comparison",
    type: "select",
    options: ["First", "Second", "Third"],
    defaultValue: "First",
  });

  const states = planGeneratedVisualSelectPreviewStates(definition);

  assert.equal(states.length, GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES);
  assert.equal(states[0].id, "default");
  assert.equal(states[0].defaultState, true);
  assert.ok(states.every((state) => state.selectStateCoverageTruncated));
  assert.ok(
    states.every((state) => state.selectState.length === 2),
    "each bounded preview identity must name every rendered select value",
  );
  assert.ok(
    states.some((state) =>
      state.selectState.some(
        (entry) => entry.controlId === "case_mode" && entry.optionLabel === "Axial",
      ),
    ),
  );
  assert.ok(
    states.some((state) =>
      state.selectState.some(
        (entry) =>
          entry.controlId === "comparison_mode" && entry.optionLabel === "Second",
      ),
    ),
    "a process_position select cannot disappear when select_case is also present",
  );
});

test("spatial runtime mounts accessibly at browser viewports and captures every bounded select-case preview", (t) => {
  if (!browserPath()) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-browser-"));
  try {
    const result = runGeneratedVisualBrowserTests({ definition: spatialDefinition(), outputDir, timeoutMs: 25_000 });
    assert.ok(result.tests.every((entry) => entry.passed), JSON.stringify(result.tests));
    assert.ok(
      result.tests
        .filter((entry) => entry.name.startsWith("browser mount"))
        .every((entry) => entry.detail === "mounted and self-tested"),
    );
    assert.equal(result.browser?.screenshotCreated, true);
    assert.equal(result.browser?.previewMatrixComplete, true);
    assert.equal(result.browser?.selectStateCount, 3);
    assert.equal(result.browser?.previewCount, 6);
    assert.equal(result.browser?.selectStateCoverageTruncated, false);
    assert.equal(result.previews?.length, 6);
    const previewIds = result.previews.map((preview) => preview.id).sort();
    assert.deepEqual(previewIds, [
      "desktop-1000x720-light--case_mode-1",
      "desktop-1000x720-light--case_mode-2",
      "desktop-1000x720-light--default",
      "mobile-375x667-light--case_mode-1",
      "mobile-375x667-light--case_mode-2",
      "mobile-375x667-light--default",
    ]);
    for (const preview of result.previews) {
      assert.equal(preview.theme, "light");
      assert.deepEqual(preview.selectStateCoverageTruncated, false);
      assert.equal(preview.selectState.length, 1);
      assert.equal(preview.selectState[0].controlId, "case_mode");
      assert.ok(["Planar", "Axial", "Radial"].includes(preview.selectState[0].optionLabel));
      assert.ok(
        (preview.viewport.width === 375 && preview.viewport.height === 667) ||
          (preview.viewport.width === 1000 && preview.viewport.height === 720),
      );
      assert.ok(fs.statSync(preview.path).size > 0, preview.id);
    }
    assert.equal(
      result.previews.find((preview) => preview.defaultState && preview.viewport.width === 1000)?.path,
      path.join(outputDir, "preview.png"),
    );
    assert.ok(fs.statSync(path.join(outputDir, "preview.png")).size > 0);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser self-test diagnostics are bounded, preserve the primary cause, and decode authored identifiers safely", (t) => {
  if (!browserPath()) return t.skip("Chromium or Edge is not installed");
  const definition = spatialDefinition();
  const primaryOutputId = `case_view<&\"${"x".repeat(305)}😀${"y".repeat(133)}`;
  definition.outputs = Array.from({ length: 20 }, (_, index) => ({
    id: index === 0 ? primaryOutputId : `case_view_${index}`,
    label: `Selected construction ${index}`,
    representation: "diagram",
    expression: {
      kind: "binary",
      op: "divide",
      left: { kind: "constant", value: 1 },
      right: {
        kind: "binary",
        op: "subtract",
        left: { kind: "constant", value: 1 },
        right: { kind: "input", id: "case_mode" },
      },
    },
  }));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-browser-diagnostics-"));
  try {
    const result = runGeneratedVisualBrowserTests({ definition, outputDir, timeoutMs: 25_000 });
    const mountTests = result.tests.filter((entry) => entry.name.startsWith("browser mount"));
    assert.equal(mountTests.length, 3);
    for (const entry of mountTests) {
      assert.equal(entry.passed, false);
      assert.match(
        entry.detail ?? "",
        /runtime self-check failures: output\.after_control_change\.nonfinite: outputId=case_view<&"x/,
      );
      assert.match(entry.detail ?? "", /\[truncated:500\]/);
      assert.match(entry.detail ?? "", /additional_failures:\d+/);
      assert.doesNotMatch(entry.detail ?? "", /&(?:amp|lt|quot);/);
      assert.ok((entry.detail?.length ?? 0) < 5_000, entry.detail);
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser projection keeps a common authored point fixed while selector groups change", (t) => {
  const executable = browserPath();
  if (!executable) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-stability-"));
  const htmlPath = path.join(outputDir, "stable-camera.html");
  try {
    const runtime = fs.readFileSync(
      path.resolve("../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
      "utf8",
    );
    const serialized = JSON.stringify(spatialDefinition()).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><body><div id="breadboard-generated-visual-root"></div><script>
const requestedAuditWidth = Number(new URLSearchParams(location.search).get("auditWidth"));
if (Number.isFinite(requestedAuditWidth)) document.getElementById("breadboard-generated-visual-root").style.width = requestedAuditWidth + "px";
</script><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>
window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:"light"},"*");
setTimeout(() => {
  const fixed = () => document.querySelector('[data-spatial-id="fixed-point"]');
  const position = () => fixed()?.dataset.spatialAnchorX + "," + fixed()?.dataset.spatialAnchorY;
  const cameraBounds = () => document.querySelector('[data-spatial-projection="orthographic"]')?.dataset.spatialCameraBounds;
  const labelsClear = () => {
    const boxes = Array.from(document.querySelectorAll('[data-spatial-label-for]')).map((label) => label.getBBox());
    return boxes.every((box, index) => boxes.slice(index + 1).every((candidate) => {
      const width = Math.max(0, Math.min(box.x + box.width, candidate.x + candidate.width) - Math.max(box.x, candidate.x));
      const height = Math.max(0, Math.min(box.y + box.height, candidate.y + candidate.height) - Math.max(box.y, candidate.y));
      return width * height <= 16;
    }));
  };
  const seen = new Set(Array.from(document.querySelectorAll("[data-spatial-kind]")).map((node) => node.dataset.spatialKind));
  const first = position();
  const firstBounds = cameraBounds();
  let allLabelsClear = labelsClear();
  const select = document.querySelector('[data-control-id="case_mode"]');
  for (const index of [1, 2]) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    Array.from(document.querySelectorAll("[data-spatial-kind]")).forEach((node) => seen.add(node.dataset.spatialKind));
    if (position() !== first) document.body.dataset.spatialCameraStable = "false";
    if (cameraBounds() !== firstBounds) document.body.dataset.spatialCameraStable = "false";
    allLabelsClear = allLabelsClear && labelsClear();
  }
  if (!document.body.dataset.spatialCameraStable) document.body.dataset.spatialCameraStable = "true";
  document.body.dataset.spatialAllKinds = String(["plane","polygon","sphere","cylinder","cone","point","vector"].every((kind) => seen.has(kind)));
  document.body.dataset.spatialLegendAccessible = String(Array.from(document.querySelectorAll("[data-spatial-kind]")).every((node) => node.getAttribute("aria-label") && node.getAttribute("tabindex") === "0"));
  document.body.dataset.spatialLabelsClear = String(allLabelsClear);
}, 25);
</script></body></html>`;
    fs.writeFileSync(htmlPath, html, "utf8");
    const profilePath = path.join(outputDir, `edge-profile-${process.pid}-${Date.now()}`);
    const result = spawnSync(executable, [
      `--user-data-dir=${profilePath}`,
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--window-size=1000,720",
      "--virtual-time-budget=1500",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], { encoding: "utf8", timeout: 25_000, windowsHide: true });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, result.error?.message ?? output.slice(-500));
    assert.match(output, /data-spatial-camera-stable="true"/);
    assert.match(output, /data-spatial-all-kinds="true"/);
    assert.match(output, /data-spatial-legend-accessible="true"/);
    assert.match(output, /data-spatial-labels-clear="true"/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser labels use leaders outside dense intersecting spatial geometry", (t) => {
  const executable = browserPath();
  if (!executable) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-dense-labels-"));
  const htmlPath = path.join(outputDir, "dense-labels.html");
  try {
    const definition = denseIntersectingSpatialDefinition();
    const validation = validateGeneratedVisualizationDefinition(definition);
    assert.equal(validation.errors.length, 0, validation.errors.join("; "));
    const runtime = fs.readFileSync(
      path.resolve("../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
      "utf8",
    );
    const serialized = JSON.stringify(definition).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><body><div id="breadboard-generated-visual-root"></div><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>
window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:"light"},"*");
setTimeout(() => {
  const labels = Array.from(document.querySelectorAll("[data-spatial-label-for]"));
  const geometry = Array.from(document.querySelectorAll("[data-spatial-geometry-left]")).map((object) => ({
    left: Number(object.dataset.spatialGeometryLeft),
    right: Number(object.dataset.spatialGeometryRight),
    top: Number(object.dataset.spatialGeometryTop),
    bottom: Number(object.dataset.spatialGeometryBottom),
  }));
  const clear = labels.every((label) => {
    const box = label.getBBox();
    const labelBox = { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
    const overlap = geometry.reduce((total, candidate) => {
      const width = Math.max(0, Math.min(labelBox.right, candidate.right) - Math.max(labelBox.left, candidate.left));
      const height = Math.max(0, Math.min(labelBox.bottom, candidate.bottom) - Math.max(labelBox.top, candidate.top));
      return total + width * height;
    }, 0);
    return overlap <= 16;
  });
  document.body.dataset.spatialLabelsOffGeometry = String(clear);
  document.body.dataset.spatialLeaderCount = String(document.querySelectorAll(".gv-spatial-leader").length);
}, 25);
</script></body></html>`;
    fs.writeFileSync(htmlPath, html, "utf8");
    for (const [width, height] of [[1000, 720], [375, 667]]) {
      const profilePath = path.join(outputDir, `edge-profile-${width}-${height}-${process.pid}-${Date.now()}`);
      const result = spawnSync(executable, [
        `--user-data-dir=${profilePath}`,
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-first-run",
        `--window-size=${width},${height}`,
        "--virtual-time-budget=1500",
        "--dump-dom",
        `${pathToFileURL(htmlPath).href}?auditWidth=${width}`,
      ], { encoding: "utf8", timeout: 25_000, windowsHide: true });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      assert.equal(result.status, 0, result.error?.message ?? output.slice(-500));
      assert.match(output, /data-spatial-labels-off-geometry="true"/);
      const leaderCount = Number(output.match(/data-spatial-leader-count="(\d+)"/)?.[1] ?? 0);
      assert.ok(leaderCount >= 4, `expected at least four leaders at ${width}x${height}, saw ${leaderCount}`);
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser projection does not auto-follow a t-driven moving point", (t) => {
  const executable = browserPath();
  if (!executable) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-motion-"));
  const htmlPath = path.join(outputDir, "stable-motion-camera.html");
  try {
    const runtime = fs.readFileSync(
      path.resolve("../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
      "utf8",
    );
    const definition = {
      schemaVersion: 1,
      sdkVersion: "1.0.0",
      title: "Moving point",
      description: "Step through a generic point path.",
      accessibilityDescription: "A labelled point moves through a stable orthographic spatial frame when the learner presses Step.",
      controls: [],
      outputs: [{ id: "motion_view", label: "Point motion", representation: "animation" }],
      scenes: [{
        kind: "spatial",
        title: "Point path",
        groups: [{
          id: "moving-items",
          label: "Motion",
          primitives: [{
            kind: "point",
            id: "moving-point",
            label: "Moving point",
            position: [{ kind: "input", id: "t" }, 0, 0],
            color: "blue",
          }],
        }],
      }],
      animation: { durationMs: 2000, loop: false, autoplay: false },
    };
    const validation = validateGeneratedVisualizationDefinition(definition);
    assert.equal(validation.errors.length, 0, validation.errors.join("; "));
    const serialized = JSON.stringify(definition).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><body><div id="breadboard-generated-visual-root"></div><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>
window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:"light"},"*");
setTimeout(() => {
  const point = () => document.querySelector('[data-spatial-id="moving-point"]');
  const position = () => point()?.dataset.spatialAnchorX + "," + point()?.dataset.spatialAnchorY;
  const bounds = () => document.querySelector('[data-spatial-projection="orthographic"]')?.dataset.spatialCameraBounds;
  const firstPosition = position();
  const firstBounds = bounds();
  const step = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Step");
  for (let index = 0; index < 10; index += 1) step.click();
  document.body.dataset.spatialMovingPointMoved = String(position() !== firstPosition);
  document.body.dataset.spatialMotionBoundsStable = String(bounds() === firstBounds);
}, 25);
</script></body></html>`;
    fs.writeFileSync(htmlPath, html, "utf8");
    const profilePath = path.join(outputDir, `edge-profile-${process.pid}-${Date.now()}`);
    const result = spawnSync(executable, [
      `--user-data-dir=${profilePath}`,
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--window-size=1000,720",
      "--virtual-time-budget=1500",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], { encoding: "utf8", timeout: 25_000, windowsHide: true });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, result.error?.message ?? output.slice(-500));
    assert.match(output, /data-spatial-moving-point-moved="true"/);
    assert.match(output, /data-spatial-motion-bounds-stable="true"/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser camera bounds include the full t-driven polygon domain", (t) => {
  const executable = browserPath();
  if (!executable) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-polygon-motion-"));
  const htmlPath = path.join(outputDir, "stable-polygon-camera.html");
  try {
    const runtime = fs.readFileSync(
      path.resolve("../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
      "utf8",
    );
    const tValue = { kind: "input", id: "t" };
    const tPlusOne = {
      kind: "binary",
      op: "add",
      left: { kind: "input", id: "t" },
      right: { kind: "constant", value: 1 },
    };
    const definition = {
      schemaVersion: 1,
      sdkVersion: "1.0.0",
      title: "Moving polygon",
      description: "Step through a bounded polygon path.",
      accessibilityDescription: "A labelled polygon moves across a stable orthographic frame when the learner presses Step.",
      controls: [],
      outputs: [{ id: "motion_view", label: "Polygon motion", representation: "animation" }],
      scenes: [{
        kind: "spatial",
        title: "Polygon path",
        view: { azimuthDegrees: 90, elevationDegrees: 0, scale: 1 },
        groups: [{
          id: "moving-items",
          label: "Motion",
          primitives: [{
            kind: "polygon",
            id: "moving-polygon",
            label: "Moving polygon",
            points: [[tValue, 0, 0], [tPlusOne, 0, 0], [tPlusOne, 1, 0], [tValue, 1, 0]],
            color: "cyan",
            pattern: "striped",
          }],
        }],
      }],
      animation: { durationMs: 2000, loop: false, autoplay: false },
    };
    const validation = validateGeneratedVisualizationDefinition(definition);
    assert.equal(validation.errors.length, 0, validation.errors.join("; "));
    const serialized = JSON.stringify(definition).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><body><div id="breadboard-generated-visual-root"></div><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>
window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:"light"},"*");
setTimeout(() => {
  const polygon = () => document.querySelector('[data-spatial-id="moving-polygon"]');
  const position = () => polygon()?.dataset.spatialAnchorX + "," + polygon()?.dataset.spatialAnchorY;
  const bounds = () => document.querySelector('[data-spatial-projection="orthographic"]')?.dataset.spatialCameraBounds;
  const firstPosition = position();
  const firstBounds = bounds();
  const step = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Step");
  for (let index = 0; index < 10; index += 1) step.click();
  document.body.dataset.spatialPolygonMoved = String(position() !== firstPosition);
  document.body.dataset.spatialPolygonBoundsStable = String(bounds() === firstBounds);
  document.body.dataset.spatialPolygonBounds = firstBounds;
}, 25);
</script></body></html>`;
    fs.writeFileSync(htmlPath, html, "utf8");
    const profilePath = path.join(outputDir, `edge-profile-${process.pid}-${Date.now()}`);
    const result = spawnSync(executable, [
      `--user-data-dir=${profilePath}`,
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--window-size=1000,720",
      "--virtual-time-budget=1500",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], { encoding: "utf8", timeout: 25_000, windowsHide: true });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, result.error?.message ?? output.slice(-500));
    assert.match(output, /data-spatial-polygon-moved="true"/);
    assert.match(output, /data-spatial-polygon-bounds-stable="true"/);
    assert.match(output, /data-spatial-polygon-bounds="-2\.000000,0\.000000,0\.000000,0\.000000"/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
