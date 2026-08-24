import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  GENERATED_VISUAL_BROWSER_MOUNT_MAX_ATTEMPTS,
  GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS,
  GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES,
  compileGeneratedVisualization,
  generateVisualizationCandidate,
  planGeneratedVisualSelectPreviewStates,
  runGeneratedVisualBrowserTests,
  runGeneratedVisualDeterministicTests,
  validateGeneratedVisualizationCandidateEnvelope,
  validateGeneratedVisualizationDefinition,
} from "../src/lib/generated-visuals.ts";
import { runObservedGeneratedVisualBrowserProcess } from "../src/lib/generated-visual-browser-process.ts";

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

function spatialCameraFrameDefinition(scale) {
  const definition = spatialDefinition();
  definition.scenes[0] = {
    kind: "spatial",
    title: "Camera-frame vector",
    view: { azimuthDegrees: 0, elevationDegrees: 0, scale },
    groups: [{
      id: "field-vectors",
      label: "Field vectors",
      primitives: [{
        kind: "vector",
        id: "e_field_bot",
        label: "Bottom field vector",
        from: [0, 0, 0],
        to: [0, 0, -4],
        headSize: 20,
        color: "blue",
      }],
    }],
  };
  return definition;
}

function mobilePrimarySpatialViewportDefinition({ spatialFirst = false } = {}) {
  const definition = spatialCameraFrameDefinition(0.55);
  const spatial = definition.scenes[0];
  spatial.groups.unshift({
    id: "always-visible-reference",
    label: "Reference",
    primitives: [{
      kind: "point",
      id: "reference-point",
      label: "Reference point",
      position: [0, 0, 0],
      size: 8,
      color: "red",
    }],
  });
  spatial.groups[1].visibleWhen = visibleCase(1);
  const precedingPlot = {
    kind: "plot",
    title: "Reference curve",
    xLabel: "Position",
    yLabel: "Reference value",
    xMin: 0,
    xMax: 1,
    samples: 20,
    series: [{
      id: "reference",
      label: "Reference",
      expression: { kind: "constant", value: 1 },
    }],
  };
  definition.scenes = spatialFirst
    ? [spatial, precedingPlot]
    : [precedingPlot, spatial];
  return definition;
}

function diagramLayoutDefinition({
  crowded = false,
  capped = false,
  targetLabel = false,
  valueBearingLabels = false,
} = {}) {
  const nodes = crowded
    ? [80, 200, 320, 440, 560].map((x, index) => ({
      id: `stencil-${index}`,
      // A deliberately unbreakable first label proves the renderer keeps its
      // bounded cap visible to the runtime diagnostic instead of silently
      // shrinking or truncating source text.
      label: capped && index === 0
        ? "Unbreakable-supercalifragilisticexpialidocious-identifier"
        : "Potential V(d/4)",
      x,
      y: 180,
      value: { kind: "input", id: "iteration" },
    }))
    : [170, 320, 470].map((x, index) => ({
      id: `state-${index}`,
      label: valueBearingLabels
        ? ["q2", "P target", "E total"][index]
        : targetLabel && index === 1
          ? "P target"
          : `V${index}`,
      x,
      y: 180,
      ...(valueBearingLabels
        ? { value: { kind: "input", id: "iteration" } }
        : {}),
    }));
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: crowded ? "Crowded stencil" : "Compact stencil",
    description: "A generic diagram layout fixture.",
    accessibilityDescription: "A labelled iteration control changes the shown value. Reset restores the documented default state.",
    controls: [{
      id: "iteration",
      kind: "process_position",
      label: "Iteration",
      type: "slider",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
    }],
    outputs: [{
      id: "iteration_value",
      label: "Iteration value",
      representation: "value",
      expression: { kind: "input", id: "iteration" },
    }],
    scenes: [{
      kind: "diagram",
      title: crowded ? "Crowded horizontal stencil" : "Compact representative stencil",
      nodes,
      edges: crowded
        ? nodes.slice(0, -1).map((node, index) => ({
          from: node.id,
          to: nodes[index + 1].id,
          label: "step h",
          directed: true,
        }))
        : [],
    }],
  };
}

function offscreenDiagramFootprintDefinition() {
  const definition = diagramLayoutDefinition();
  // The self-test focuses the only slider after these scenes, intentionally
  // scrolling this SVG above the viewport before it checks control and Reset.
  definition.scenes.unshift(spatialCameraFrameDefinition(0.55).scenes[0]);
  definition.scenes[1] = {
    ...definition.scenes[1],
    title: "Measured node footprint",
    nodes: [
      { id: "v_step", label: "V surface", x: 140, y: 180 },
      { id: "grad_v", label: "Grad V", x: 320, y: 180 },
      { id: "field_e", label: "Vector E", x: 500, y: 180 },
    ],
    edges: [],
  };
  return definition;
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

test("a high-spatial reviewed route rejects a flowchart substitute and requires its physical primitives", () => {
  const boundaryOpportunity = {
    ...opportunity,
    id: "visual-boundary-fixture",
    similarityFingerprint: "boundary-fixture",
    learnerAction:
      "Apply an external electric field to a conductor boundary and inspect its surface-normal vector.",
    necessityDecision: {
      spatialValue: 0.95,
      learningGoal: "Relate an electric field to a conductor boundary.",
      reason: "A boundary interface needs physical geometry.",
      teachingMediumReason:
        "Interactive surface pillbox manipulation clarifies boundary component behavior.",
      interaction: {
        uniqueConcept: "Conductor boundary conditions",
        whyStaticSourceFigureIsNotEnough:
          "Static vectors do not show the pillbox crossing the interface.",
        learnerAction:
          "Apply an external electric field to a conductor boundary.",
      },
    },
  };
  const flowchart = spatialDefinition();
  flowchart.scenes = [{
    kind: "diagram",
    title: "Free to metal path",
    nodes: [
      { id: "free", label: "Free", x: 140, y: 180 },
      { id: "bound", label: "Bound", x: 320, y: 180 },
      { id: "metal", label: "Metal", x: 500, y: 180 },
    ],
    edges: [
      { from: "free", to: "bound", label: "changes", directed: true },
      { from: "bound", to: "metal", label: "changes", directed: true },
    ],
  }];
  const source = moduleSource(flowchart);
  assert.ok(
    compileGeneratedVisualization(source, opportunity).definition,
    "the identical source remains valid when no reviewed spatial route exists",
  );
  const missingScene = compileGeneratedVisualization(source, boundaryOpportunity);
  assert.equal(missingScene.definition, null);
  assert.match(
    missingScene.validation.errors.join("; "),
    /reviewed_spatial_representation\.missing_spatial_scene/,
  );

  const vectorOnly = spatialDefinition();
  vectorOnly.scenes[0].groups = [{
    id: "field-only",
    label: "Field only",
    primitives: [{
      kind: "vector",
      id: "external-field",
      label: "External field",
      from: [0, 0, 0],
      to: [0, 1, 0],
      color: "blue",
    }],
  }];
  const missingSurface = compileGeneratedVisualization(
    moduleSource(vectorOnly),
    boundaryOpportunity,
  );
  assert.equal(missingSurface.definition, null);
  assert.match(
    missingSurface.validation.errors.join("; "),
    /reviewed_spatial_representation\.missing_surface_primitive/,
  );

  const surfaceOnly = spatialDefinition();
  surfaceOnly.scenes[0].groups = [{
    id: "surface-only",
    label: "Surface only",
    primitives: [{
      kind: "plane",
      id: "interface",
      label: "Conductor interface",
      center: [0, 0, 0],
      normal: [0, 1, 0],
      size: 4,
      color: "gray",
    }],
  }];
  const missingVector = compileGeneratedVisualization(
    moduleSource(surfaceOnly),
    boundaryOpportunity,
  );
  assert.equal(missingVector.definition, null);
  assert.match(
    missingVector.validation.errors.join("; "),
    /reviewed_spatial_representation\.missing_vector_primitive/,
  );

  const valid = compileGeneratedVisualization(
    moduleSource(spatialDefinition()),
    boundaryOpportunity,
  );
  assert.ok(valid.definition, valid.validation.errors.join("; "));
});

test("the final reviewed learner action outranks stale high-spatial necessity prose", () => {
  const dependencyOpportunity = {
    ...opportunity,
    id: "visual-reviewed-dependency-fixture",
    similarityFingerprint: "reviewed-dependency-fixture",
    learnerAction:
      "Select a case and inspect the highlighted branch of a persistent node-link dependency diagram.",
    necessityDecision: {
      spatialValue: 0.99,
      learningGoal: "Compare vector contributions in a physical orientation.",
      reason:
        "The earlier necessity pass expected a cross product and directional field vectors.",
      teachingMediumReason:
        "Rotate a spatial vector construction to compare orientations.",
      interaction: {
        uniqueConcept: "Two contributions combine through a dependency relation.",
        whyStaticSourceFigureIsNotEnough:
          "The obsolete proposal asked for physical vector orientations.",
        learnerAction:
          "Select a case and inspect the highlighted branch of a persistent node-link dependency diagram.",
      },
    },
  };
  const dependencyDiagram = spatialDefinition();
  dependencyDiagram.scenes = [{
    kind: "diagram",
    title: "Persistent dependency branches",
    nodes: [
      { id: "first", label: "A", x: 140, y: 120 },
      { id: "second", label: "B", x: 140, y: 240 },
      { id: "result", label: "R", x: 500, y: 180 },
    ],
    edges: [
      { from: "first", to: "result", directed: true },
      { from: "second", to: "result", directed: true },
    ],
  }];
  const reviewedDiagram = compileGeneratedVisualization(
    moduleSource(dependencyDiagram),
    dependencyOpportunity,
  );
  assert.ok(
    reviewedDiagram.definition,
    reviewedDiagram.validation.errors.join("; "),
  );

  const pathOpportunity = {
    ...dependencyOpportunity,
    learnerAction:
      "Trace a point along a spatial integration path and inspect the changing construction.",
  };
  assert.match(
    compileGeneratedVisualization(
      moduleSource(dependencyDiagram),
      pathOpportunity,
    ).validation.errors.join("; "),
    /reviewed_spatial_representation\.missing_spatial_scene/,
    "an explicit final spatial-path action still requires physical geometry",
  );

  const vectorOpportunity = {
    ...dependencyOpportunity,
    learnerAction:
      "Rotate the field vector and inspect its direction in the shared physical frame.",
  };
  const pointOnly = spatialDefinition();
  pointOnly.scenes[0].groups = [{
    id: "point-only",
    label: "Point",
    primitives: [{
      kind: "point",
      id: "sample-point",
      label: "Sample point",
      position: [0, 0, 0],
    }],
  }];
  assert.match(
    compileGeneratedVisualization(
      moduleSource(pointOnly),
      vectorOpportunity,
    ).validation.errors.join("; "),
    /reviewed_spatial_representation\.missing_vector_primitive/,
    "an explicit final vector action still requires a vector primitive",
  );

  const uiFieldOpportunity = {
    ...dependencyOpportunity,
    learnerAction:
      "Adjust the numeric input field and inspect the dependency diagram.",
  };
  const uiFieldDiagram = compileGeneratedVisualization(
    moduleSource(dependencyDiagram),
    uiFieldOpportunity,
  );
  assert.ok(
    uiFieldDiagram.definition,
    uiFieldDiagram.validation.errors.join("; "),
  );

  for (const learnerAction of [
    "Rotate the dependency diagram and inspect the selected branch.",
    "Rotate the orientation of the dependency diagram and inspect its branches.",
    "Inspect the orientation of the node-link graph and compare its branches.",
  ]) {
    const diagramOrientationOpportunity = {
      ...dependencyOpportunity,
      learnerAction,
    };
    const diagramOrientationResult = compileGeneratedVisualization(
      moduleSource(dependencyDiagram),
      diagramOrientationOpportunity,
    );
    assert.ok(
      diagramOrientationResult.definition,
      `${learnerAction}: ${diagramOrientationResult.validation.errors.join("; ")}`,
    );
  }

  const physicalRotationBesideDiagram = {
    ...dependencyOpportunity,
    learnerAction:
      "Rotate the field vector beside the dependency diagram and inspect its direction.",
  };
  assert.match(
    compileGeneratedVisualization(
      moduleSource(dependencyDiagram),
      physicalRotationBesideDiagram,
    ).validation.errors.join("; "),
    /reviewed_spatial_representation\.missing_spatial_scene/,
    "diagram context must not erase an explicitly physical rotation object",
  );

  const observedGeometryOpportunity = {
    ...dependencyOpportunity,
    learnerAction:
      "Compare the Gaussian surface normal with the field direction as it crosses the interface.",
  };
  assert.match(
    compileGeneratedVisualization(
      moduleSource(dependencyDiagram),
      observedGeometryOpportunity,
    ).validation.errors.join("; "),
    /reviewed_spatial_representation\.missing_spatial_scene/,
    "an explicit physical-geometry comparison remains spatial even without a manipulation verb",
  );
});

test("browser runtime keeps a long plot axis label inside the mobile SVG frame", (t) => {
  if (!browserPath()) {
    t.skip("no supported browser binary is available");
    return;
  }
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-plot-axis-frame-"),
  );
  try {
    const definition = {
      schemaVersion: 1,
      sdkVersion: "1.0.0",
      title: "Normal flux density",
      description: "Inspect a source-grounded normal flux density profile.",
      accessibilityDescription:
        "A chart shows normal flux density over normal distance, with both axes explicitly labelled.",
      controls: [],
      outputs: [{
        id: "normal_flux_density",
        label: "Normal flux density",
        representation: "chart",
      }],
      scenes: [{
        kind: "plot",
        title: "Normal flux density profile",
        xMin: 0,
        xMax: 1,
        samples: 24,
        xLabel: "Normal distance",
        yLabel: "Normal Flux Density D_N (C/m²)",
        series: [{
          id: "normal-flux",
          label: "Normal flux density",
          expression: { kind: "input", id: "x" },
        }],
      }],
    };
    const browser = runGeneratedVisualBrowserTests({ definition, outputDir });
    assert.ok(
      browser.tests.every((entry) => entry.passed),
      JSON.stringify(browser.tests, null, 2),
    );
    assert.ok(
      !browser.tests.some((entry) => /axis_label_out_of_frame/.test(entry.detail)),
      JSON.stringify(browser.tests, null, 2),
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("spatial validation rejects unsafe bounds, malformed vectors, and degenerate geometry", () => {
  const invalid = spatialDefinition();
  invalid.scenes[0].view = { azimuthDegrees: 181, elevationDegrees: 86, scale: 3 };
  invalid.scenes[0].groups[1].primitives[0] = {
    ...invalid.scenes[0].groups[1].primitives[0],
    normal: [0, 0, 0],
    color: "#00ff00",
    pattern: "gradient",
    labelMode: "outside",
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
  assert.match(messages, /labelMode must be inline or legend_only/);
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

test("diagram source coordinates reject values the renderer would otherwise clamp", () => {
  const rendererBounds = diagramLayoutDefinition();
  Object.assign(rendererBounds.scenes[0].nodes[0], { x: 72, y: 48 });
  Object.assign(rendererBounds.scenes[0].nodes[2], { x: 568, y: 312 });
  assert.deepEqual(
    validateGeneratedVisualizationDefinition(rendererBounds).errors,
    [],
  );

  const compactMobileLayout = diagramLayoutDefinition();
  compactMobileLayout.scenes[0].nodes[0].x = 100;
  compactMobileLayout.scenes[0].nodes[2].x = 500;
  assert.deepEqual(
    validateGeneratedVisualizationDefinition(compactMobileLayout).errors,
    [],
    "the conservative text-bearing mobile interior is advisory, not a hard schema bound",
  );

  const silentlyClamped = diagramLayoutDefinition();
  Object.assign(silentlyClamped.scenes[0].nodes[0], { x: 71, y: 47 });
  Object.assign(silentlyClamped.scenes[0].nodes[1], { x: 569, y: 313 });
  const errors = validateGeneratedVisualizationDefinition(silentlyClamped).errors.join("; ");
  assert.match(
    errors,
    /scenes\[0\]\.nodes\[0\] must use runtime-safe source coordinates inside x=72-568 and y=48-312/,
  );
  assert.match(
    errors,
    /scenes\[0\]\.nodes\[1\] must use runtime-safe source coordinates inside x=72-568 and y=48-312/,
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

test("iterative simulate-system opportunities require a changing runtime clock instead of a static definition", () => {
  const iterativeOpportunity = {
    ...opportunity,
    id: "visual-iterative-fixture",
    interactionGoal: "simulate_system",
    learnerAction: "Run iterative relaxation and observe numerical convergence.",
    requiredInputs: [{
      id: "iteration",
      kind: "process_position",
      label: "Iteration",
      type: "slider",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
    }],
    requiredOutputs: [{
      id: "iteration_value",
      label: "Iteration value",
      representation: "value",
    }],
  };
  const staticDefinition = diagramLayoutDefinition();
  const staticValidation = validateGeneratedVisualizationDefinition(
    staticDefinition,
    iterativeOpportunity,
  );
  assert.match(
    staticValidation.errors.join("; "),
    /simulate_system process is not executable:.*cannot be a static definition: add animation and a t-dependent numeric output or scene expression/,
  );

  const dynamicDefinition = structuredClone(staticDefinition);
  dynamicDefinition.animation = { durationMs: 2000, loop: false, autoplay: false };
  dynamicDefinition.outputs[0].expression = {
    kind: "binary",
    op: "add",
    left: { kind: "input", id: "iteration" },
    right: { kind: "input", id: "t" },
  };
  const dynamicValidation = validateGeneratedVisualizationDefinition(
    dynamicDefinition,
    iterativeOpportunity,
  );
  assert.ok(dynamicValidation.definition, dynamicValidation.errors.join("; "));
  const deterministic = runGeneratedVisualDeterministicTests({
    definition: dynamicValidation.definition,
    opportunity: iterativeOpportunity,
    testCases: [],
  });
  assert.equal(deterministic.passed, true, JSON.stringify(deterministic));
  assert.equal(
    deterministic.semanticTests.find((entry) => /runtime clock/.test(entry.name))?.passed,
    true,
  );
});

test("candidate parser accepts a sole fenced JSON envelope", async () => {
  const definition = spatialDefinition();
  const expected = {
    title: "Spatial construction",
    explanation: "The selector compares source-grounded geometry.",
    sourceCode: moduleSource(definition),
    testCases: [],
    accessibilityDescription: definition.accessibilityDescription,
    pedagogicalClaims: ["The interaction compares the declared cases."],
  };
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`` } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      },
    },
  };

  const candidate = await generateVisualizationCandidate({
    client,
    model: "test-model",
    opportunity,
    pageMarkdown: "Local teaching text.",
  });
  assert.deepEqual(candidate, { ...expected, tokenUsage: {
    inputTokens: 10,
    outputTokens: 10,
    reasoningTokens: 0,
    totalTokens: 20,
  } });
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
  const repairErrors = [
    "AST exceeds 2500 nodes",
    "reviewed_spatial_representation.missing_spatial_scene: the reviewed route requires a source-grounded spatial scene; a diagram node-link graph, flowchart, or plot cannot substitute for physical geometry",
    "plot.default.scene[0].axis_label_out_of_frame: axis=y; overflow=top=38",
    "scenes[2].groups[0].primitives[8].to must contain exactly three spatial scalars",
    "scenes[1].nodes[0].value: expression is invalid or too deeply nested",
    "',' expected.",
    "Argument expression expected.",
    "Expression expected.",
    "executable syntax is not allowed (Identifier)",
    "default export must be defineVisualization({ ...literal definition... })",
    "Diagram edge labels H_N2/H_N1=mu1/mu2 and B_N2/B_N1=1 collide with the Interface node and arrow; the status panel heading clips on 375px mobile.",
    "The spatial camera scale and orientation leave the source-essential plane and vectors off-center and clipped at the bottom of the narrow mobile preview.",
    "The 3D spatial camera view (azimuth 35°, elevation 20°) causes severe perspective projection foreshortening, placing a source point directly adjacent to its target and clustering field vectors with overlapping inline labels on mobile.",
    "spatial.after_control_change.host[0].geometry_out_of_frame: primitive=e_field_bot; overflow=bottom=41; authoredScale=0.85; scaleAtMost=0.55",
    "In the circular cylindrical coordinate mode, the intersection point P(2, 0, 1) lies directly on the boundary edge/seam between cyl_facet_1 and cyl_facet_6, and neither facet's face normal is parallel to the displayed radial normal unit vector a_rho ([1, 0, 0]).",
    "The gradient expression uses a hardcoded unexplained distance interval; explicitly define and label the symbol, value, and unit, and introduce every variable.",
    "The required output expression, plot series, and plot marker are mathematically inconsistent with the rendered spatial field vectors; the scalar is half the vector magnitude.",
    "The diagram nodes overflow and get cropped off on mobile viewports, node labels collide with node value readouts inside the node circles, and the visual calculates static closed-form ratios rather than showing numerical relaxation convergence.",
    "browser mount 1280x800 reduced-motion: runtime self-check failures: diagram.after_control_change.scene[0].node_label_footprint: node=v_step; label=x=348,y=-492.6,width=113.1,height=27; footprint=x=361.5,y=-513.6,width=86,height=86; diagram.after_reset.scene[0].node_label_footprint: node=v_step; label=x=348,y=-492.6,width=113.1,height=27; footprint=x=361.5,y=-513.6,width=86,height=86.",
    "Adjust diagram node horizontal coordinates so all grid stencil nodes fit within a 375px mobile viewport without right-edge cropping.",
    "In the narrow mobile viewport (375x667), node Q2 in the Point Charge Arrangement diagram is cropped on the right edge due to node coordinates exceeding the readable viewport width.",
    "The persistent dependency diagram does not visibly distinguish the selected branch for selector branch_case.",
    "The required selector is not visibly available before the observable scenes.",
    "A signed scalar multiplies each displayed contribution direction, but the explanation does not state that a negative sign reverses the result.",
    "Add a complete non-visual explanation and ensure every control is keyboard-readable and explicitly labelled.",
  ];
  await assert.rejects(
    generateVisualizationCandidate({
      client,
      model: "test-model",
      opportunity,
      pageMarkdown: "Local teaching text.",
      previousSourceCode,
      errors: repairErrors,
    }),
    /candidate envelope is invalid:.*candidate\.title is required.*candidate\.pedagogicalClaims must be an array/,
  );
  const system = request.messages.find((message) => message.role === "system").content;
  assert.match(system, /exactly these six fields/);
  assert.match(system, /diagram is only a 2D node-link graph/i);
  assert.match(system, /never author parallel or reverse labelled edges that share an endpoint pair.*labels stack at the same midpoint/i);
  assert.match(system, /Use at most one short conceptual relationship label per endpoint pair; put equations, ratios, equality signs, and other wide formula text in an annotation or formula scene/i);
  assert.match(system, /status scene.*title and state labels render in a narrow text panel.*fit at 375px/i);
  assert.match(system, /output\.representation is metadata and does not force scene\.kind/);
  assert.match(system, /source-authored xLabel and yLabel are visible SVG text.*concise, source-grounded, and fully legible.*mobile and desktop plot frame.*annotation or formula scene/i);
  assert.match(system, /A spatial scene is exactly/);
  assert.match(system, /spatialRepresentationRequirement is the reviewed route constraint after final learner-action precedence.*not a stale necessity score or earlier rationale.*actual spatial scene.*diagram node-link graph, flowchart, state-transition graph, or plot.*requiresSurfacePrimitive.*requiresVectorPrimitive/i);
  assert.match(system, /diagram edge may use strength as an authored numeric expression.*abs\(strength\) clamped to 0\.5-6.*single option.*exclusive emphasized branch.*combined\/both\/all\/sum\/total\/\+ option.*union/i);
  assert.match(system, /trusted runtime renders every exact immutable control before numeric outputs and observable scenes.*DOM order and rendered visibility at mobile.*sourceCode cannot and must not duplicate, reposition, or replace/i);
  assert.match(system, /displayed direction is multiplied by an uncontrolled signed scalar.*fixed-sign assumption.*opposite sign.*unsigned\/field term.*sign-dependent reversal/i);
  assert.match(system, /labelMode\?.*legend_only/);
  assert.match(system, /Projection overlap is a hard failure even when world coordinates differ.*named source-essential points, vector arrowheads, endpoints, and inline labels.*every exact desktop and narrow-mobile state.*labelMode:"legend_only"/i);
  assert.match(system, /first rendered spatial scene with primitives.*primary narrow-mobile preview scene.*ahead of supporting plot, formula, annotation, status, or secondary-scene content.*initial 375x667 document viewport.*SVG-local safe frame is not sufficient.*unitless display-scale factor.*arbitrary unmentioned multiplier/i);
  assert.match(system, /Every non-structural scalar or symbol that represents a physical or conceptual quantity.*source-grounded and visibly introduced with its symbol, value, unit when applicable, and role/i);
  assert.match(system, /Do not hide a learner-relevant interval or scale as a bare coordinate or expression literal/i);
  assert.match(system, /When a required output, plot series, plot marker, status, formula, or annotation displays a component, resultant, or magnitude of rendered vector contributions.*identical relationship through every representation.*stale scaled or half-magnitude expression/i);
  assert.match(system, /plane\(center,normal,size\).*polygon\(points with 3-12 coplanar non-collinear SpatialVectors in boundary order\).*sphere\(center,radius\).*cylinder\(center,axis,radius,height\).*cone\(apex,axis,radius,height\).*point\(position,size\?\).*vector\(from,to,headSize\?\)/);
  assert.match(system, /plane is a centered full rectangular patch extending to both sides of its center/);
  assert.match(system, /Use ordered polygon vertices, not plane, whenever the visible surface must be clipped, sector-shaped, one-sided, triangular, or a half-plane patch/);
  assert.match(system, /Group or primitive visibleWhen counts as scene influence/);
  assert.match(system, /at least one allowed alternate control state must change by more than 1e-9 the evaluated value of an output\.expression or numeric scene expression/i);
  assert.match(system, /claim-to-primitive audit.*vector unit or normalized.*Euclidean norm must be exactly 1/i);
  assert.match(system, /named-point normal\/tangent\/basis claim.*strictly inside one displayed face.*ordered-vertex cross product.*shared facet edge, seam, vertex, cap, or an off-point chord/i);
  assert.match(system, /Do not call a direction vector unit or normalized by implication: from:\[0,0,0\] to:\[1,0,0\] has magnitude 1, while to:\[1,1,1\] has magnitude sqrt\(3\)/i);
  assert.match(system, /Hard compilation budget: AST node count must not exceed 2500; target at most 1600 nodes/i);
  assert.match(system, /six plane faces \(literal normal, one dynamic center component, dynamic scalar size\) are the compact faithful representation/i);
  assert.match(system, /Every vector from and to must be written as exactly three \[x, y, z\] entries/i);
  assert.match(system, /Every expression has hard limits of 16 nested levels and 300 nodes; target at most 6 nested levels and 40 nodes/i);
  assert.match(system, /In a spatial coordinate, use a literal, an input, or a one-operation expression only; never paste a full derived calculation/i);
  assert.match(system, /Never use condition\/then\/else or min\/max as a binary op/i);
  assert.match(system, /Before returning sourceCode, check it as one complete module: every object\/array delimiter is balanced/i);
  assert.match(system, /Diagram node\.value is normally omitted.*\{kind:"constant",value:<finite>\}.*never a bare numeric value such as value: 1/i);
  assert.match(system, /text-bearing mobile diagram.*conservative interior x=112-528 and y=72-288.*at most three text-bearing nodes/i);
  assert.match(system, /At every default, changed-control, and Reset state, each rendered node label and tspan must fit inside its actual SVG node footprint; prefer a 1-6-character identifier.*full phrases, equations, step descriptions, and live values outside the graph/i);
  assert.match(system, /Diagram source coordinates are strictly validated at x=72-568 and y=48-312.*renderer's non-clamped limits.*will not repair an out-of-range authored coordinate.*x=112-528 and y=72-288/i);
  assert.match(system, /simulate, iterate, relax, converge, evolve, or step through a process.*definition\.animation.*reserved runtime expression \{kind:"input",id:"t"\}/i);
  assert.match(system, /make an internal checklist from every exactErrors and exactHistory entry/i);
  assert.match(system, /highPriorityRepairInstructions.*replacing the affected sourceCode structure/i);
  assert.match(system, /FINAL NON-NEGOTIABLE SELF-CHECK BEFORE THE JSON RESPONSE/i);
  assert.match(system, /below 16,000 bytes/);
  assert.match(system, /complete syntactically valid spatial module template/);
  const spatialTemplateMarker = "complete syntactically valid spatial module template; replace its generic labels and geometry with source-grounded content:\n";
  const promptedSpatialSource = system.slice(system.indexOf(spatialTemplateMarker) + spatialTemplateMarker.length).trim();
  const promptedSpatialCompilation = compileGeneratedVisualization(promptedSpatialSource);
  assert.ok(promptedSpatialCompilation.definition, promptedSpatialCompilation.validation.errors.join("; "));
  assert.ok(Buffer.byteLength(promptedSpatialSource) < 16_000);
  assert.match(promptedSpatialSource, /label: "Unit x direction", from: \[0, 0, 0\], to: \[1, 0, 0\]/);
  const userPacket = JSON.parse(request.messages.find((message) => message.role === "user").content);
  assert.equal(userPacket.repairContext.previousSourceCode, previousSourceCode);
  assert.deepEqual(userPacket.repairContext.exactErrors, repairErrors);
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /reviewed route explicitly requires source-grounded spatial topology.*diagram node-link graph, flowchart, state-transition graph, or plot substitute.*boundary, interface, pillbox, or surface.*field, flux, normal, tangential direction, or vector.*not solve this by relabelling a 2D graph/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /browser found a plot-axis label outside its SVG frame.*source-authored xLabel or yLabel.*mobile and desktop previews.*CSS, clipping, truncation, or an unexplained abbreviation.*annotation or formula scene/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /complete replacement targeted below 1600 AST nodes/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /exactly three-item \[x, y, z\] array/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /at most 6 nested levels and 40 nodes/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /never write a bare numeric value such as value: 1/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /sourceCode did not parse as a complete visualization module or used executable syntax.*fresh, compact, standalone module.*exactly two top-level statements.*Do not declare const\/let\/var.*never JavaScript like gain, x, t, result, config, or definition/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /spatial coordinate entries.*at most a one-operation expression.*never min or max/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /prior rendered layout is not legible.*parallel or reverse labelled edges.*exact same midpoint.*short natural-language title and state label.*375px panel.*labelMode:"legend_only"/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /previous diagram does not fit.*at most three text-bearing nodes.*x=112-528 and y=72-288.*node\.value.*value, status, plot, formula, or annotation scene/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /browser found a diagram node label overflowing its measured SVG footprint after a state transition or Reset.*literal scene\.nodes entry identified by node=.*compact 1-6-character identifier.*omit node\.value.*annotation, formula, status, value, or plot scene.*every tspan fit inside.*default, changed-control, and reset.*all supplied desktop and mobile.*Do not change CSS.*renderer expansion or capping.*different line/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /critic found a source-authored diagram coordinate.*scene\.nodes literal x\/y.*runtime clamping.*x=72-568 and y=48-312.*text-bearing narrow-mobile node.*x=112-528 and y=72-288.*x=140,320,500/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /critic found a spatial-camera projection collision.*literal physical coordinates, endpoints, topology.*scene\.view azimuthDegrees, elevationDegrees, scale, and projection.*named points, vector arrowheads, and endpoints.*desktop and narrow-mobile.*labelMode:"legend_only".*illustrative or normalized.*CSS, runtime auto-fit, prose, or relabelling.*default, changed-control, and Reset/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /critic found that the spatial scene missed the initial narrow-mobile preview viewport.*first source-essential spatial scene.*ahead of supporting plot, formula, annotation, status, or secondary-scene content.*375x667 initial viewport.*CSS, scrolling instructions, runtime auto-fit, or a local SVG-only frame claim.*desktop, mobile, changed-control, and Reset/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /prior spatial camera framing is not usable.*authored view.*azimuthDegrees, elevationDegrees, scale.*narrow-mobile state.*Preserve the literal primitive topology and domain/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /geometry_out_of_frame or label_out_of_frame.*lower the literal affected scene\.view\.scale to the reported scaleAtMost or lower.*vector endpoint, arrowhead, primitive envelope, and inline-label box.*runtime auto-fit/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /named-point normal claim is geometrically invalid.*strictly in the relative interior of one face.*cross product \(p1-p0\) x \(p2-p0\).*curved cylindrical or spherical concept.*tangent plane or bounded tangent polygon.*shared facet boundary pass through the point/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /critic found a literal mathematical mismatch.*actual to-from endpoint deltas, components, sum, and magnitude.*affected required output\.expression.*matching plot series expression and plot marker coordinate.*exact feedback supplies a corrected expression.*old scaled, rounded, or half-magnitude expression.*Do not change only prose or labels/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /critic found an ungrounded spatial-vector display scale.*same source-grounded relationship.*required output, plot series, markers, formula, and status.*unitless display-scale factor.*illustrative\/normalized.*arbitrary fit factor.*direction, sign, units, and topology/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /unexplained learner-facing constant or symbol.*visibly define its symbol, value, unit when applicable, and role.*formula\/annotation, diagram, plot, or status scene.*pure rendering coordinates/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /static closed-form result.*iterative or converging process.*definition\.animation.*\{kind:"input",id:"t"\}.*default, a Step state, and the settled state/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /candidate accessibilityDescription and definition\.accessibilityDescription.*standalone, specific non-visual walkthrough.*keyboard navigation plus Reset behavior/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /state-dependent branch highlighting in a persistent diagram.*every node and edge present.*edge's authored strength expression.*single option has an exclusive emphasized branch.*combined\/both\/all\/sum\/total\/\+ option emphasizes their union.*node\.value as selection styling.*CSS\/runtime changes/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /Preserve the immutable control exactly once.*trusted SDK runtime.*before outputs and scenes.*candidate fields cannot author DOM order.*Do not duplicate a selector/i,
  );
  assert.match(
    userPacket.highPriorityRepairInstructions.join(" "),
    /directional claim omitted the sign of a multiplying scalar.*fixed sign.*opposite sign.*underlying terms inside the signed expression.*planner-owned control/i,
  );
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
  const domBySlug = new Map();
  try {
    const definition = spatialDefinition();
    const result = runGeneratedVisualBrowserTests({
      definition,
      outputDir,
      timeoutMs: 25_000,
      browserRunner: (invocation) => {
        const observed = runObservedGeneratedVisualBrowserProcess(invocation);
        if (invocation.slug === "375x667-light")
          domBySlug.set(invocation.slug, observed.stdout ?? "");
        return observed;
      },
    });
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
    for (const attempt of (result.browser?.mountReceipts ?? []).flatMap(
      (receipt) => receipt.attempts,
    )) {
      assert.equal(attempt.cleanupConfirmed, true);
      assert.ok(
        attempt.timedOut
          ? attempt.completion === "deadline"
          : ["observed_dom", "process_exit"].includes(attempt.completion),
      );
      assert.ok(attempt.durationMs >= 0 && attempt.durationMs < 30_000);
    }
    for (const receipt of result.browser?.previewMatrixReceipt?.cells ?? []) {
      assert.equal(receipt.captured, true, JSON.stringify(receipt));
      assert.ok(
        receipt.attempts.some(
          (attempt) => attempt.screenshotCreated && !attempt.timedOut,
        ),
        JSON.stringify(receipt),
      );
      for (const attempt of receipt.attempts) {
        assert.equal(attempt.cleanupConfirmed, true);
        assert.ok(
          attempt.timedOut
            ? attempt.completion === "deadline"
            : ["observed_capture", "process_exit"].includes(attempt.completion),
        );
        assert.ok(attempt.durationMs >= 0 && attempt.durationMs < 30_000);
      }
    }
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
    const mobileDom = domBySlug.get("375x667-light") ?? "";
    assert.ok(mobileDom, "the exercised 375x667 runtime DOM must be observed");
    assert.ok(
      mobileDom.indexOf('class="gv-controls"') <
        mobileDom.indexOf('class="gv-scenes"'),
      "trusted runtime controls must precede the first observable scene host",
    );
    for (const control of definition.controls) {
      const escapedId = control.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const controlTag = mobileDom.match(
        new RegExp(`<[^>]+data-control-id="${escapedId}"[^>]*>`),
      )?.[0];
      assert.ok(controlTag, `missing rendered control ${control.id}`);
      assert.match(controlTag, /data-control-precedes-scenes="true"/);
      assert.match(controlTag, /data-control-rendered="true"/);
      assert.match(
        controlTag,
        /data-control-mobile-initial-viewport-visible="true"/,
      );
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser self-test rejects unsafe authored spatial camera framing with a scale repair hint", (t) => {
  if (!browserPath()) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-camera-frame-"));
  try {
    const unsafe = runGeneratedVisualBrowserTests({
      definition: spatialCameraFrameDefinition(2),
      outputDir: path.join(outputDir, "unsafe"),
      timeoutMs: 25_000,
    });
    const unsafeMobile = unsafe.tests.find(
      (entry) => entry.name === "browser mount 375x667 light",
    );
    assert.equal(unsafeMobile?.passed, false, JSON.stringify(unsafe.tests));
    assert.match(
      unsafeMobile?.detail ?? "",
      /runtime self-check failures: spatial\.after_control_change\.host\[0\]\.geometry_out_of_frame: primitive=e_field_bot; overflow=.*(?:top|bottom)=.*; authoredScale=2; scaleAtMost=/,
    );

    const repaired = runGeneratedVisualBrowserTests({
      definition: spatialCameraFrameDefinition(0.55),
      outputDir: path.join(outputDir, "repaired"),
      timeoutMs: 25_000,
    });
    assert.ok(repaired.tests.every((entry) => entry.passed), JSON.stringify(repaired.tests));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("mobile preview rejects a primary spatial scene below the document viewport and accepts source ordering repair", (t) => {
  if (!browserPath()) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-preview-viewport-"));
  try {
    const belowFold = runGeneratedVisualBrowserTests({
      definition: mobilePrimarySpatialViewportDefinition(),
      outputDir: path.join(outputDir, "below-fold"),
      timeoutMs: 25_000,
    });
    const frameGate = belowFold.tests.find(
      (entry) => entry.name === "mobile primary spatial preview frame",
    );
    assert.equal(frameGate?.passed, false, JSON.stringify(belowFold.tests));
    assert.match(
      frameGate?.detail ?? "",
      /mobile-375x667-light--case_mode-1: runtime preview-frame failures: spatial\.preview_primary_viewport_out_of_frame: scene=\d+; overflow=bottom=.*; viewport=\d+x\d+/,
    );
    const axialMobile = belowFold.browser?.previewMatrixReceipt?.cells.find(
      (entry) => entry.id === "mobile-375x667-light--case_mode-1",
    );
    assert.equal(axialMobile?.captured, false, JSON.stringify(axialMobile));
    assert.equal(
      axialMobile?.attempts.at(-1)?.previewPrimarySpatialFrameValidated,
      false,
      JSON.stringify(axialMobile),
    );
    const axialDesktop = belowFold.browser?.previewMatrixReceipt?.cells.find(
      (entry) => entry.id === "desktop-1000x720-light--case_mode-1",
    );
    assert.equal(axialDesktop?.captured, true, JSON.stringify(axialDesktop));

    const repaired = runGeneratedVisualBrowserTests({
      definition: mobilePrimarySpatialViewportDefinition({ spatialFirst: true }),
      outputDir: path.join(outputDir, "reordered"),
      timeoutMs: 25_000,
    });
    assert.ok(
      repaired.tests.every((entry) => entry.passed),
      JSON.stringify(repaired.tests),
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser self-test rejects crowded diagram labels before critic review and accepts a compact mobile stencil", (t) => {
  if (!browserPath()) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-diagram-layout-"));
  try {
    const crowdedDom = [];
    const crowded = runGeneratedVisualBrowserTests({
      definition: diagramLayoutDefinition({ crowded: true, capped: true }),
      outputDir: path.join(outputDir, "crowded"),
      timeoutMs: 25_000,
      browserRunner: ({ executable, args }) => {
        const result = spawnSync(executable, args, {
          encoding: "utf8",
          timeout: 25_000,
          windowsHide: true,
        });
        if (args.includes("--dump-dom")) crowdedDom.push(result.stdout ?? "");
        return result;
      },
    });
    assert.match(crowdedDom[0] ?? "", /data-diagram-scene="true"/);
    assert.match(
      crowdedDom[0] ?? "",
      /data-diagram-node-footprint="capped"/,
      "a cap-exceeding source label must remain observable as a runtime failure",
    );
    const crowdedMobile = crowded.tests.find(
      (entry) => entry.name === "browser mount 375x667 light",
    );
    assert.equal(crowdedMobile?.passed, false, JSON.stringify(crowded.tests));
    assert.match(
      crowdedMobile?.detail ?? "",
      /runtime self-check failures: diagram\.after_control_change\.scene\[0\]\.(?:node_label_footprint|node_label_line_overlap|label_out_of_bounds|label_overlap|edge_label_node_overlap|node_overlap)/,
    );

    const compact = runGeneratedVisualBrowserTests({
      // Regression: source labels and meaningful live values must remain
      // visible in their measured, expanded authored footprints.
      definition: diagramLayoutDefinition({
        targetLabel: true,
        valueBearingLabels: true,
      }),
      outputDir: path.join(outputDir, "compact"),
      timeoutMs: 25_000,
    });
    assert.ok(compact.tests.every((entry) => entry.passed), JSON.stringify(compact.tests));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser self-test fits an offscreen V surface node after focused control and Reset", (t) => {
  if (!browserPath()) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-diagram-offscreen-layout-"));
  try {
    const domByScenario = new Map();
    const result = runGeneratedVisualBrowserTests({
      definition: offscreenDiagramFootprintDefinition(),
      outputDir,
      timeoutMs: 25_000,
      browserRunner: ({ executable, args, slug }) => {
        const browser = spawnSync(executable, args, {
          encoding: "utf8",
          timeout: 25_000,
          windowsHide: true,
        });
        if (args.includes("--dump-dom")) domByScenario.set(slug, browser.stdout ?? "");
        return browser;
      },
    });
    const reducedMotion = result.tests.find(
      (entry) => entry.name === "browser mount 1280x800 reduced-motion",
    );
    // The sandbox self-test diagnoses both after_control_change and
    // after_reset; passing here proves the offscreen focused path settled.
    assert.equal(reducedMotion?.passed, true, JSON.stringify(result.tests));
    const reducedMotionDom = domByScenario.get("1280x800-reduced-motion") ?? "";
    const vStep = [...reducedMotionDom.matchAll(/<circle\b[^>]*>/g)]
      .map((match) => match[0])
      .find((markup) => markup.includes('data-diagram-node="v_step"'));
    assert.ok(vStep, reducedMotionDom);
    const radius = Number(/\br="([^"]+)"/.exec(vStep)?.[1]);
    assert.ok(
      Number.isFinite(radius) && radius > 32.1,
      `V surface should receive a measured adaptive footprint, got ${String(radius)}`,
    );
    assert.match(vStep, /data-diagram-node-footprint="expanded"/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser mount retries a transient Edge launch timeout with a fresh profile and bounded receipt", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-mount-retry-"));
  const mountProfilesByScenario = new Map();
  const mountAttemptsByScenario = new Map();
  const retryDelays = [];
  try {
    const result = runGeneratedVisualBrowserTests({
      definition: spatialDefinition(),
      outputDir,
      browserExecutable: "fake-edge",
      browserMountRetryBackoff: (delayMs) => retryDelays.push(delayMs),
      browserRunner: ({ args, profilePath, slug }) => {
        const screenshotArg = args.find((arg) => arg.startsWith("--screenshot="));
        if (screenshotArg) {
          fs.writeFileSync(screenshotArg.slice("--screenshot=".length), "fake png");
          return {
            status: 0,
            stdout: '<body data-breadboard-preview-primary-spatial-frame="passed"></body>',
          };
        }
        if (args.includes("--dump-dom")) {
          assert.ok(args.includes("--disable-gpu-shader-disk-cache"), JSON.stringify(args));
          assert.ok(args.includes("--disable-skia-graphite"), JSON.stringify(args));
          assert.ok(args.includes("--disable-features=SkiaGraphiteUsePersistentCache"), JSON.stringify(args));
          const attempts = (mountAttemptsByScenario.get(slug) ?? 0) + 1;
          mountAttemptsByScenario.set(slug, attempts);
          const profiles = mountProfilesByScenario.get(slug) ?? [];
          profiles.push(profilePath);
          mountProfilesByScenario.set(slug, profiles);
          if (slug === "375x667-light" && attempts === 1) {
            return {
              status: null,
              signal: "SIGTERM",
              durationMs: 20_000,
              timedOut: true,
              stderr: "generic Edge launch stderr",
              stdout: "<html><body>incomplete launch output",
              error: {
                code: "ETIMEDOUT",
                message: "spawnSync C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe ETIMEDOUT",
              },
            };
          }
          return {
            status: 0,
            stdout: '<body data-breadboard-runtime-tests="passed"></body>',
          };
        }
        assert.fail(JSON.stringify(args));
      },
    });

    assert.ok(result.tests.every((entry) => entry.passed), JSON.stringify(result.tests));
    assert.deepEqual(retryDelays, [125]);
    const receipt = result.browser?.mountReceipts?.find(
      (entry) => entry.scenario === "375x667 light",
    );
    assert.ok(receipt, JSON.stringify(result.browser?.mountReceipts));
    assert.equal(receipt.mounted, true);
    assert.equal(receipt.attempts.length, GENERATED_VISUAL_BROWSER_MOUNT_MAX_ATTEMPTS);
    assert.equal(receipt.attempts[0].status, null);
    assert.equal(receipt.attempts[0].signal, "SIGTERM");
    assert.equal(receipt.attempts[0].mounted, false);
    assert.equal(receipt.attempts[0].transientFailureCode, "ETIMEDOUT");
    assert.equal(receipt.attempts[0].durationMs, 20_000);
    assert.equal(receipt.attempts[0].timedOut, true);
    assert.equal(receipt.attempts[0].errorCode, "ETIMEDOUT");
    assert.match(receipt.attempts[0].stderr ?? "", /generic Edge launch stderr/);
    assert.match(receipt.attempts[0].stdoutTail ?? "", /incomplete launch output/);
    assert.equal(receipt.attempts[0].retryDelayMs, 125);
    assert.match(receipt.attempts[0].detail ?? "", /ETIMEDOUT/);
    assert.doesNotMatch(JSON.stringify(receipt), /C:\\Program Files|msedge\.exe/i);
    assert.match(JSON.stringify(receipt), /<path>/);
    assert.equal(receipt.attempts[1].status, 0);
    assert.equal(receipt.attempts[1].mounted, true);
    assert.match(
      result.tests.find((entry) => entry.name === "browser mount 375x667 light")?.detail ?? "",
      /mounted and self-tested after transient browser retry 2\/2 \(ETIMEDOUT\)/,
    );
    const retryProfiles = mountProfilesByScenario.get("375x667-light");
    assert.equal(retryProfiles.length, GENERATED_VISUAL_BROWSER_MOUNT_MAX_ATTEMPTS);
    assert.notEqual(retryProfiles[0], retryProfiles[1]);
    for (const profilePath of retryProfiles) {
      assert.equal(
        fs.existsSync(path.dirname(profilePath)),
        false,
        "retry profiles must be cleaned with the disposable root",
      );
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser completion is artifact-observed and cleans a stalled disposable process tree", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-observed-browser-"));
  const fakeBrowserPath = path.join(outputDir, "generic-stalled-browser.mjs");
  const descendantPidLedger = path.join(outputDir, "descendant-pids.txt");
  const retryDelays = [];
  fs.writeFileSync(
    fakeBrowserPath,
    `import fs from "node:fs";
import { spawn } from "node:child_process";
const [pidLedger, ...browserArgs] = process.argv.slice(2);
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  windowsHide: true,
  stdio: "ignore",
});
descendant.unref();
fs.appendFileSync(pidLedger, String(descendant.pid) + "\\n", "utf8");
const screenshotArg = browserArgs.find((arg) => arg.startsWith("--screenshot="));
if (screenshotArg) {
  const screenshotPath = screenshotArg.slice("--screenshot=".length);
  const screenshot = Buffer.from("generic screenshot bytes");
  fs.writeFileSync(screenshotPath, screenshot);
  process.stdout.write('<!doctype html><html><body data-breadboard-preview-primary-spatial-frame="passed"></body></html>');
  process.stderr.write(String(screenshot.length) + " bytes written to file " + screenshotPath + "\\n");
} else {
  process.stdout.write('<!doctype html><html><body data-breadboard-runtime-tests="passed"></body></html>');
}
setInterval(() => {}, 1000);
`,
    "utf8",
  );
  try {
    const result = runGeneratedVisualBrowserTests({
      definition: spatialDefinition(),
      outputDir,
      browserExecutable: "generic-fake-browser",
      browserMountRetryBackoff: (delayMs) => retryDelays.push(delayMs),
      previewCaptureRetryBackoff: (delayMs) => retryDelays.push(delayMs),
      browserRunner: ({ args, timeoutMs }) =>
        runObservedGeneratedVisualBrowserProcess({
          executable: process.execPath,
          args: [fakeBrowserPath, descendantPidLedger, ...args],
          timeoutMs,
        }),
    });

    assert.ok(result.tests.every((entry) => entry.passed), JSON.stringify(result.tests));
    assert.deepEqual(retryDelays, [], "completed artifacts must not consume a retry");
    const mountAttempts = (result.browser?.mountReceipts ?? [])
      .flatMap((receipt) => receipt.attempts);
    const captureAttempts = (result.browser?.previewMatrixReceipt?.cells ?? [])
      .flatMap((receipt) => receipt.attempts);
    assert.equal(mountAttempts.length, 3);
    assert.equal(captureAttempts.length, 6);
    for (const attempt of mountAttempts) {
      assert.equal(attempt.status, 0);
      assert.equal(attempt.timedOut, false);
      assert.equal(attempt.completion, "observed_dom");
      assert.equal(attempt.browserExitedNaturally, false);
      assert.equal(attempt.cleanupConfirmed, true);
      assert.ok(attempt.durationMs >= 0 && attempt.durationMs < 20_000);
    }
    for (const attempt of captureAttempts) {
      assert.equal(attempt.status, 0);
      assert.equal(attempt.timedOut, false);
      assert.equal(attempt.completion, "observed_capture");
      assert.equal(attempt.browserExitedNaturally, false);
      assert.equal(attempt.cleanupConfirmed, true);
      assert.equal(attempt.screenshotCreated, true);
      assert.ok(attempt.screenshotBytes > 0);
    }
    const descendantPids = fs.readFileSync(descendantPidLedger, "utf8")
      .trim()
      .split(/\s+/)
      .map(Number);
    assert.equal(descendantPids.length, 9);
    if (process.platform === "win32") {
      for (const pid of descendantPids) {
        assert.throws(
          () => process.kill(pid, 0),
          (error) => error?.code === "ESRCH",
          `descendant ${pid} should be gone after taskkill /T /F`,
        );
      }
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser deadline rejects an unconfirmed screenshot and preserves diagnostics separately", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-browser-deadline-"));
  const fakeBrowserPath = path.join(outputDir, "generic-incomplete-browser.mjs");
  const screenshotPath = path.join(outputDir, "unconfirmed.png");
  fs.writeFileSync(
    fakeBrowserPath,
    `import fs from "node:fs";
const screenshotArg = process.argv.find((arg) => arg.startsWith("--screenshot="));
const screenshotPath = screenshotArg.slice("--screenshot=".length);
fs.writeFileSync(screenshotPath, "partial screenshot");
process.stdout.write('<!doctype html><html><body data-generic="rendered"></body></html>');
process.stderr.write("999 bytes written to file " + screenshotPath + "\\n");
setInterval(() => {}, 1000);
`,
    "utf8",
  );
  try {
    const result = runObservedGeneratedVisualBrowserProcess({
      executable: process.execPath,
      args: [fakeBrowserPath, `--screenshot=${screenshotPath}`],
      timeoutMs: 250,
    });
    assert.equal(result.status, null);
    assert.equal(result.timedOut, true);
    assert.equal(result.error?.code, "ETIMEDOUT");
    assert.match(result.stderr, /999 bytes written to file/);
    assert.match(result.stdout, /data-generic="rendered"/);
    assert.equal(result.completion, undefined);
    assert.equal(result.cleanupConfirmed, true);
    assert.ok(result.durationMs >= 200 && result.durationMs < 5_000, JSON.stringify(result));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser output overflow cannot inherit a successful process status", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-browser-overflow-"));
  const fakeBrowserPath = path.join(outputDir, "generic-overflow-browser.mjs");
  fs.writeFileSync(
    fakeBrowserPath,
    `process.stdout.write("x".repeat(17 * 1024 * 1024));
process.exitCode = 0;
`,
    "utf8",
  );
  try {
    const result = runObservedGeneratedVisualBrowserProcess({
      executable: process.execPath,
      args: [fakeBrowserPath],
      timeoutMs: 5_000,
    });
    assert.equal(result.status, null, JSON.stringify({
      status: result.status,
      signal: result.signal,
      error: result.error,
    }));
    assert.equal(result.timedOut, false);
    assert.equal(result.error?.code, "ENOBUFS");
    assert.equal(result.completion, undefined);
    assert.equal(result.cleanupConfirmed, true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("browser mount does not retry a sandbox runtime self-check failure", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-mount-semantic-"));
  let failedScenarioInvocations = 0;
  const retryDelays = [];
  try {
    const result = runGeneratedVisualBrowserTests({
      definition: spatialDefinition(),
      outputDir,
      browserExecutable: "fake-edge",
      browserMountRetryBackoff: (delayMs) => retryDelays.push(delayMs),
      browserRunner: ({ args, slug }) => {
        const screenshotArg = args.find((arg) => arg.startsWith("--screenshot="));
        if (screenshotArg) {
          fs.writeFileSync(screenshotArg.slice("--screenshot=".length), "fake png");
          return {
            status: 0,
            stdout: '<body data-breadboard-preview-primary-spatial-frame="passed"></body>',
          };
        }
        if (args.includes("--dump-dom")) {
          if (slug === "375x667-light") {
            failedScenarioInvocations += 1;
            return {
              status: 0,
              stdout: '<body data-breadboard-runtime-tests="failed" data-breadboard-runtime-diagnostics="%5B%22semantic%20ETIMEDOUT%20must%20not%20retry%22%5D"></body>',
            };
          }
          return {
            status: 0,
            stdout: '<body data-breadboard-runtime-tests="passed"></body>',
          };
        }
        assert.fail(JSON.stringify(args));
      },
    });

    assert.equal(
      failedScenarioInvocations,
      1,
      JSON.stringify({ retryDelays, mountReceipts: result.browser?.mountReceipts }),
    );
    assert.deepEqual(retryDelays, []);
    const receipt = result.browser?.mountReceipts?.find(
      (entry) => entry.scenario === "375x667 light",
    );
    assert.ok(receipt, JSON.stringify(result.browser?.mountReceipts));
    assert.equal(receipt.mounted, false);
    assert.equal(receipt.attempts.length, 1);
    assert.equal(receipt.attempts[0].transientFailureCode, undefined);
    assert.match(receipt.attempts[0].detail ?? "", /semantic ETIMEDOUT must not retry/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("preview capture retries transient Edge-style failures with fresh profiles and a bounded backoff", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-preview-retry-"));
  const captureProfiles = new Map();
  const captureAttempts = new Map();
  const retryDelays = [];
  try {
    const result = runGeneratedVisualBrowserTests({
      definition: spatialDefinition(),
      outputDir,
      browserExecutable: "fake-edge",
      previewCaptureRetryBackoff: (delayMs) => retryDelays.push(delayMs),
      browserRunner: ({ args, profilePath }) => {
        assert.ok(args.includes("--disable-gpu-shader-disk-cache"), JSON.stringify(args));
        assert.ok(args.includes("--disable-skia-graphite"), JSON.stringify(args));
        assert.ok(args.includes("--disable-features=SkiaGraphiteUsePersistentCache"), JSON.stringify(args));
        const screenshotArg = args.find((arg) => arg.startsWith("--screenshot="));
        if (screenshotArg) {
          const screenshotPath = screenshotArg.slice("--screenshot=".length);
          const attempts = (captureAttempts.get(screenshotPath) ?? 0) + 1;
          captureAttempts.set(screenshotPath, attempts);
          const profiles = captureProfiles.get(screenshotPath) ?? [];
          profiles.push(profilePath);
          captureProfiles.set(screenshotPath, profiles);
          assert.ok(profilePath.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
          assert.equal(
            profilePath.startsWith(`${path.resolve(outputDir)}${path.sep}`),
            false,
            "browser profiles must stay out of a potentially deep visual staging directory",
          );
          if (attempts === 1) {
            fs.writeFileSync(screenshotPath, "");
            return { status: 1, stderr: "simulated Edge EBUSY" };
          }
          fs.writeFileSync(screenshotPath, "fake png");
          return {
            status: 0,
            stdout: '<body data-breadboard-preview-primary-spatial-frame="passed"></body>',
          };
        }
        if (args.includes("--dump-dom")) {
          return {
            status: 0,
            stdout: '<body data-breadboard-runtime-tests="passed"></body>',
          };
        }
        assert.fail(JSON.stringify(args));
      },
    });

    assert.ok(result.tests.every((entry) => entry.passed), JSON.stringify(result.tests));
    assert.equal(result.browser?.previewMatrixComplete, true);
    assert.equal(result.browser?.previewCount, 6);
    assert.equal(result.browser?.previewMatrixReceipt?.expectedCount, 6);
    assert.equal(result.browser?.previewMatrixReceipt?.capturedCount, 6);
    assert.equal(result.browser?.previewMatrixReceipt?.cells.length, 6);
    assert.deepEqual(retryDelays, Array(6).fill(125));
    assert.equal(captureProfiles.size, 6);
    for (const receipt of result.browser?.previewMatrixReceipt?.cells ?? []) {
      assert.equal(receipt.captured, true, receipt.id);
      assert.equal(receipt.attempts.length, 2, receipt.id);
      assert.equal(receipt.attempts[0].status, 1);
      assert.match(receipt.attempts[0].detail ?? "", /simulated Edge EBUSY/);
      assert.equal(receipt.attempts[0].retryDelayMs, 125);
      assert.equal(receipt.attempts[1].status, 0);
      assert.equal(receipt.attempts[1].screenshotCreated, true);
      assert.ok(receipt.attempts[1].screenshotBytes > 0);
    }
    for (const profiles of captureProfiles.values()) {
      assert.equal(profiles?.length, 2);
      assert.notEqual(profiles?.[0], profiles?.[1]);
      for (const profilePath of profiles ?? []) {
        assert.equal(
          fs.existsSync(path.dirname(profilePath)),
          false,
          "the short-lived browser profile root must be removed after the run",
        );
      }
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("a permanently failed labelled preview remains a complete-or-fail matrix rejection with a bounded receipt", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-preview-receipt-"));
  const failedCellProfiles = [];
  const retryDelays = [];
  try {
    const result = runGeneratedVisualBrowserTests({
      definition: spatialDefinition(),
      outputDir,
      browserExecutable: "fake-edge",
      previewCaptureRetryBackoff: (delayMs) => retryDelays.push(delayMs),
      browserRunner: ({ args, profilePath }) => {
        const screenshotArg = args.find((arg) => arg.startsWith("--screenshot="));
        if (screenshotArg) {
          const screenshotPath = screenshotArg.slice("--screenshot=".length);
          if (screenshotPath.endsWith("preview-mobile-375x667-light-case_mode-1.png")) {
            failedCellProfiles.push(profilePath);
            return {
              status: 1,
              stderr:
                "simulated persistent Edge EBUSY at C:\\Users\\agent\\AppData\\Local\\Temp\\profile; file:///C:/Users/agent/preview.html",
            };
          }
          fs.writeFileSync(screenshotPath, "fake png");
          return {
            status: 0,
            stdout: '<body data-breadboard-preview-primary-spatial-frame="passed"></body>',
          };
        }
        if (args.includes("--dump-dom")) {
          return {
            status: 0,
            stdout: '<body data-breadboard-runtime-tests="passed"></body>',
          };
        }
        assert.fail(JSON.stringify(args));
      },
    });

    assert.equal(result.browser?.screenshotCreated, true, "the default desktop preview still succeeds");
    assert.equal(result.browser?.previewCount, 5);
    assert.equal(result.browser?.previewMatrixComplete, false);
    assert.equal(
      result.tests.find((entry) => entry.name === "preview screenshot")?.passed,
      true,
    );
    const matrixGate = result.tests.find((entry) => entry.name === "repair preview matrix");
    assert.equal(matrixGate?.passed, false);
    assert.equal(matrixGate?.detail, "captured 5/6 required labelled previews");
    const receipt = result.browser?.previewMatrixReceipt?.cells.find(
      (entry) => entry.id === "mobile-375x667-light--case_mode-1",
    );
    assert.ok(receipt, JSON.stringify(result.browser?.previewMatrixReceipt));
    assert.equal(receipt.captured, false);
    assert.equal(receipt.attempts.length, GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS);
    assert.ok(receipt.attempts.every((attempt) => attempt.status === 1));
    assert.ok(
      receipt.attempts.every((attempt) =>
        /simulated persistent Edge EBUSY/.test(attempt.detail ?? ""),
      ),
    );
    assert.ok(
      receipt.attempts.every((attempt) =>
        !/C:\\Users\\agent|file:\/\/\/C:\/Users/i.test(attempt.detail ?? ""),
      ),
      JSON.stringify(receipt),
    );
    assert.ok(
      receipt.attempts.every((attempt) => /<path>|<file-path>/.test(attempt.detail ?? "")),
      JSON.stringify(receipt),
    );
    assert.deepEqual(retryDelays, [125, 250]);
    assert.equal(failedCellProfiles.length, GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS);
    assert.equal(new Set(failedCellProfiles).size, GENERATED_VISUAL_PREVIEW_CAPTURE_MAX_ATTEMPTS);
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
  definition.scenes = [{
    kind: "annotation",
    title: "Diagnostic isolation",
    text: "This fixture isolates bounded output diagnostics from spatial viewport checks.",
  }];
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

test("legend-only spatial labels retain their legend and ARIA name", (t) => {
  const executable = browserPath();
  if (!executable) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-spatial-legend-only-"));
  const htmlPath = path.join(outputDir, "legend-only.html");
  try {
    const definition = denseIntersectingSpatialDefinition();
    const legendOnly = definition.scenes[0].groups[0].primitives[0];
    legendOnly.labelMode = "legend_only";
    const validation = validateGeneratedVisualizationDefinition(definition);
    assert.equal(validation.errors.length, 0, validation.errors.join("; "));
    const runtime = fs.readFileSync(
      path.resolve("../quartz/quartz/components/scripts/generatedVisualSandbox.inline.js"),
      "utf8",
    );
    const serialized = JSON.stringify(definition).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><body><div id="breadboard-generated-visual-root"></div><script>window.__BREADBOARD_VISUAL_TEST_MODE__=true;</script><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>
window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:"light"},"*");
setTimeout(() => {
  const object = document.querySelector('[data-spatial-id="${legendOnly.id}"]');
  const legend = document.querySelector('[data-spatial-legend-id="${legendOnly.id}"]');
  const inlineLabel = document.querySelector('[data-spatial-label-for="${legendOnly.id}"]');
  const defaultInlineLabel = document.querySelector('[data-spatial-label-for="y-surface"]');
  document.body.dataset.spatialLegendOnlyAccessible = String(
    object?.dataset.spatialLabelMode === "legend_only" &&
    !inlineLabel &&
    Boolean(legend?.textContent?.includes("${legendOnly.label}")) &&
    Boolean(object?.getAttribute("aria-label")?.includes("${legendOnly.label}")) &&
    object?.getAttribute("tabindex") === "0",
  );
  document.body.dataset.spatialDefaultInlinePreserved = String(Boolean(defaultInlineLabel));
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
      "--window-size=375,667",
      "--virtual-time-budget=1500",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], { encoding: "utf8", timeout: 25_000, windowsHide: true });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, result.error?.message ?? output.slice(-500));
    assert.match(output, /data-spatial-legend-only-accessible="true"/);
    assert.match(output, /data-spatial-default-inline-preserved="true"/);
    assert.match(output, /data-breadboard-runtime-tests="passed"/);
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
