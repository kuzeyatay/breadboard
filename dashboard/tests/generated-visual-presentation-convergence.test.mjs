import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
} from "../src/lib/generated-visual-capabilities.ts";
import {
  compileGeneratedVisualization,
  validateGeneratedVisualizationDefinition,
} from "../src/lib/generated-visuals.ts";

const workspaceRoot = path.resolve("..");
const sdkPath = path.join(workspaceRoot, "dashboard/src/lib/visual-sdk.ts");
const generatorPath = path.join(
  workspaceRoot,
  "dashboard/src/lib/generated-visuals.ts",
);
const runtimePath = path.join(
  workspaceRoot,
  "quartz/quartz/components/scripts/generatedVisualSandbox.inline.js",
);
const wrapperPath = path.join(
  workspaceRoot,
  "quartz/quartz/components/scripts/breadboardGeneratedVisual.inline.ts",
);
const wrapperStylePath = path.join(
  workspaceRoot,
  "quartz/quartz/components/styles/breadboardGeneratedVisual.inline.scss",
);

function browserPath() {
  return [
    process.env.BREADBOARD_VISUAL_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ]
    .filter(Boolean)
    .find((candidate) => fs.existsSync(candidate));
}

const input = (id) => ({ kind: "input", id });
const product = (leftId, rightId) => ({
  kind: "binary",
  op: "multiply",
  left: input(leftId),
  right: input(rightId),
});
const interiorPeak = (id) => ({
  kind: "binary",
  op: "multiply",
  left: { kind: "constant", value: 100 },
  right: {
    kind: "binary",
    op: "multiply",
    left: input(id),
    right: {
      kind: "binary",
      op: "subtract",
      left: { kind: "constant", value: 1 },
      right: input(id),
    },
  },
});

function convergenceDefinition() {
  return {
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    title: "Camera convergence",
    description:
      "Explore the same authored geometry in fixed and orbiting spatial views.",
    accessibilityDescription:
      "Labelled 2D and 3D views demonstrate readable diagrams, a fixed orthographic camera, and an interactive perspective camera.",
    controls: [
      {
        id: "factor_a",
        label: "Factor A",
        description: "Changes the first factor in the authored point position.",
        type: "slider",
        min: -10,
        max: 10,
        step: 1,
        defaultValue: 0,
      },
      {
        id: "factor_b",
        label: "Factor B",
        description:
          "Changes the second factor in the authored point position.",
        type: "slider",
        min: -10,
        max: 10,
        step: 1,
        defaultValue: 0,
      },
      {
        id: "curve_position",
        label: "Curve position",
        description: "Moves a point through an authored interior maximum.",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0,
      },
      {
        id: "bounded_number",
        kind: "variable",
        label: "Bounded number",
        description: "Keeps typed values inside the authored numeric domain.",
        type: "number",
        protocolRole: "prediction_input",
        min: -2,
        max: 2,
        step: 0.5,
        defaultValue: 0,
      },
      {
        id: "show_guides",
        label: "Show guides",
        description: "Exercises a synchronized toggle row.",
        type: "toggle",
        defaultValue: false,
      },
      {
        id: "commit_view",
        kind: "protocol_action",
        label: "Commit view",
        description:
          "Locks the authored prediction before the outcome can be revealed.",
        type: "button",
        protocolRole: "commit_prediction",
        defaultValue: 0,
      },
      {
        id: "reveal_view",
        kind: "protocol_action",
        label: "Reveal outcome",
        description: "Reveals the authored outcome only after commitment.",
        type: "button",
        protocolRole: "reveal_outcome",
        defaultValue: 0,
      },
    ],
    outputs: [
      {
        id: "factor_product",
        label: "Factor product",
        representation: "value",
        expression: product("factor_a", "factor_b"),
        precision: 2,
      },
      {
        id: "protocol_outcome",
        label: "Committed outcome",
        representation: "value",
        expression: {
          kind: "binary",
          op: "multiply",
          left: input("bounded_number"),
          right: product("commit_view", "reveal_view"),
        },
        precision: 2,
      },
    ],
    scenes: [
      {
        kind: "spatial",
        title: "Legacy fixed view",
        view: { azimuthDegrees: 35, elevationDegrees: 24, scale: 1 },
        groups: [
          {
            id: "legacy-items",
            label: "Legacy geometry",
            primitives: [
              {
                kind: "point",
                id: "legacy-origin",
                label: "Legacy origin",
                position: [0, 0, 0],
                color: "blue",
              },
              {
                kind: "point",
                id: "legacy-joint-point",
                label: "Legacy joint point",
                position: [product("factor_a", "factor_b"), 0, 1],
                color: "cyan",
              },
              {
                kind: "point",
                id: "legacy-interior-point",
                label: "Legacy interior point",
                position: [0, interiorPeak("curve_position"), -1],
                color: "amber",
              },
              {
                kind: "vector",
                id: "legacy-axis",
                label: "Legacy axis",
                from: [-1, 0, 0],
                to: [1, 0, 0],
                color: "green",
              },
            ],
          },
        ],
      },
      {
        kind: "diagram",
        title: "Two-dimensional labelled state",
        nodes: [
          {
            id: "state-node",
            label: "Authored state",
            x: 320,
            y: 180,
            shape: "circle",
            value: input("bounded_number"),
          },
        ],
        edges: [],
      },
      {
        kind: "plot",
        title: "Two-dimensional reference plot",
        xMin: -2,
        xMax: 2,
        samples: 32,
        xLabel: "Input x",
        yLabel: "Output x",
        series: [
          {
            id: "identity-series",
            label: "Identity",
            expression: input("x"),
          },
        ],
      },
      {
        kind: "spatial",
        title: "Authored orbit view",
        view: {
          azimuthDegrees: 0,
          elevationDegrees: 0,
          scale: 1,
          projection: "perspective",
          interaction: "orbit",
        },
        groups: [
          {
            id: "perspective-items",
            label: "Perspective geometry",
            primitives: [
              {
                kind: "sphere",
                id: "far-sphere",
                label: "Far sphere",
                center: [-1.2, -0.8, 0],
                radius: 0.3,
                color: "violet",
                pattern: "striped",
              },
              {
                kind: "sphere",
                id: "near-sphere",
                label: "Near sphere",
                center: [1.2, 0.8, 0],
                radius: 0.3,
                color: "amber",
                pattern: "dotted",
              },
              {
                kind: "point",
                id: "moving-point",
                label: "Moving point",
                position: [product("factor_a", "factor_b"), 0, 1],
                color: "cyan",
              },
              {
                kind: "point",
                id: "interior-point",
                label: "Interior point",
                position: [0, interiorPeak("curve_position"), -1],
                color: "red",
              },
              {
                kind: "point",
                id: "bounded-number-point",
                label: "Bounded number point",
                position: [input("bounded_number"), 0, -2],
                color: "gray",
              },
              {
                kind: "vector",
                id: "depth-axis",
                label: "Depth axis",
                from: [-2, 0, -0.8],
                to: [2, 0, -0.8],
                color: "green",
              },
            ],
          },
        ],
      },
      {
        kind: "spatial",
        title: "Dense labelled construction",
        view: { azimuthDegrees: 35, elevationDegrees: 24, scale: 0.9 },
        groups: [
          {
            id: "dense-items",
            label: "Dense construction",
            primitives: [
              {
                kind: "plane",
                id: "dense-x-surface",
                label: "First surface",
                center: [0, 0, 0],
                normal: [1, 0, 0],
                size: 4,
                color: "red",
                pattern: "striped",
              },
              {
                kind: "plane",
                id: "dense-y-surface",
                label: "Second surface",
                center: [0, 0, 0],
                normal: [0, 1, 0],
                size: 4,
                color: "green",
                pattern: "dotted",
              },
              {
                kind: "plane",
                id: "dense-z-surface",
                label: "Third surface",
                center: [0, 0, 0],
                normal: [0, 0, 1],
                size: 4,
                color: "blue",
                pattern: "crosshatch",
              },
              {
                kind: "point",
                id: "dense-shared-point",
                label: "Shared point",
                position: [0, 0, 0],
                size: 8,
                color: "amber",
              },
              {
                kind: "vector",
                id: "dense-first-direction",
                label: "First local direction",
                from: [0, 0, 0],
                to: [1.4, 0, 0],
                headSize: 8,
                color: "red",
              },
              {
                kind: "vector",
                id: "dense-second-direction",
                label: "Second local direction",
                from: [0, 0, 0],
                to: [0, 1.4, 0],
                headSize: 8,
                color: "green",
              },
              {
                kind: "vector",
                id: "dense-third-direction",
                label: "Third local direction",
                from: [0, 0, 0],
                to: [0, 0, 1.4],
                headSize: 8,
                color: "blue",
              },
            ],
          },
        ],
      },
    ],
    animation: { durationMs: 4000, loop: true, autoplay: true },
  };
}

test("Learn generated visuals expose the flat visual-first camera contract", () => {
  const sdk = fs.readFileSync(sdkPath, "utf8");
  const generator = fs.readFileSync(generatorPath, "utf8");
  const runtime = fs.readFileSync(runtimePath, "utf8");
  const wrapper = fs.readFileSync(wrapperPath, "utf8");
  const wrapperStyle = fs.readFileSync(wrapperStylePath, "utf8");

  assert.match(sdk, /projection\?:\s*"orthographic"\s*\|\s*"perspective"/);
  assert.match(sdk, /interaction\?:\s*"fixed"\s*\|\s*"orbit"/);
  assert.match(
    runtime,
    /===\s*"perspective"\s*\?\s*"perspective"\s*:\s*"orthographic"/,
  );
  assert.match(runtime, /===\s*"orbit"\s*\?\s*"orbit"\s*:\s*"fixed"/);
  for (const token of [
    "--viz-bg",
    "--viz-panel",
    "--viz-control",
    "--viz-text",
    "--viz-muted",
    "--viz-line",
    "--viz-accent",
  ]) {
    assert.match(runtime, new RegExp(token));
  }
  assert.doesNotMatch(
    `${runtime}\n${wrapperStyle}`,
    /box-shadow|(?:linear|radial)-gradient/i,
  );
  assert.match(runtime, /element\("h1"/);
  assert.ok(
    runtime.indexOf("app.appendChild(scenesHost)") <
      runtime.indexOf("app.appendChild(valuesHost)"),
  );
  assert.ok(
    runtime.indexOf("app.appendChild(valuesHost)") <
      runtime.indexOf("app.appendChild(controlsHost)"),
  );
  assert.match(runtime, /addEventListener\("pointerdown"/);
  assert.match(runtime, /addEventListener\(\s*"wheel"/);
  assert.match(runtime, /addEventListener\("keydown"/);
  assert.match(runtime, /event\.key === "Home"/);
  assert.match(runtime, /prefers-reduced-motion/);
  assert.match(runtime, /\.gv-status h3,\.gv-status strong,\.gv-status p \{ overflow-wrap:anywhere; \}/);
  assert.match(runtime, /visibilitychange/);
  assert.match(runtime, /document\.title\s*=\s*definition\.title/);
  assert.match(
    runtime,
    /document\.documentElement\.lang\s*=\s*safeLanguage\(language\)/,
  );
  assert.match(wrapper, /Intl\.getCanonicalLocales\(candidate\)/);
  assert.match(wrapper, /<html lang="\$\{language\}">/);
  assert.match(wrapper, /definition, theme: currentTheme\(\), language/);
  assert.match(runtime, /protocolRole\s*===\s*"commit_prediction"/);
  assert.match(runtime, /role\s*===\s*"reveal_outcome"/);
  assert.match(runtime, /protocolMutationAllowed/);
  assert.match(wrapper, /breadboard-generated-visual:theme/);
  assert.match(wrapper, /addEventListener\("themechange"/);
  assert.doesNotMatch(wrapper, /element\("h4",\s*"bgv-title"/);
  assert.match(wrapperStyle, /background:\s*transparent/);
  assert.match(generator, /projection\?:\"orthographic\"\|\"perspective\"/);
  assert.match(generator, /interaction\?:\"fixed\"\|\"orbit\"/);
  assert.match(generator, /legacy default is projection:/);
  assert.match(
    generator,
    /GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,\s*\n\s*VISUAL_SDK_VERSION/,
  );
});

test("camera modes validate and hash without injecting semantics into legacy artifacts", () => {
  assert.deepEqual(
    [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.projections],
    ["orthographic", "perspective"],
  );
  assert.deepEqual(
    [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.interactions],
    ["fixed", "orbit"],
  );
  assert.deepEqual(
    GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.defaults,
    {
      projection: "orthographic",
      interaction: "fixed",
    },
  );
  assert.equal(
    GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
    crypto
      .createHash("sha256")
      .update(JSON.stringify(GENERATED_VISUAL_CAPABILITY_MANIFEST))
      .digest("hex"),
  );

  const base = convergenceDefinition();
  const authoredSpatialIndex = base.scenes.findIndex(
    (scene) => scene.kind === "spatial" && scene.view?.interaction === "orbit",
  );
  assert.ok(authoredSpatialIndex >= 0);
  for (const projection of ["orthographic", "perspective"]) {
    for (const interaction of ["fixed", "orbit"]) {
      const candidate = structuredClone(base);
      candidate.scenes[authoredSpatialIndex].view.projection = projection;
      candidate.scenes[authoredSpatialIndex].view.interaction = interaction;
      const validation = validateGeneratedVisualizationDefinition(candidate);
      assert.ok(validation.definition, validation.errors.join("; "));
    }
  }
  const invalidProjection = structuredClone(base);
  invalidProjection.scenes[authoredSpatialIndex].view.projection = "isometric";
  assert.match(
    validateGeneratedVisualizationDefinition(invalidProjection).errors.join(
      "; ",
    ),
    /view\.projection must be orthographic or perspective/,
  );
  const invalidInteraction = structuredClone(base);
  invalidInteraction.scenes[authoredSpatialIndex].view.interaction = "pan";
  assert.match(
    validateGeneratedVisualizationDefinition(invalidInteraction).errors.join(
      "; ",
    ),
    /view\.interaction must be fixed or orbit/,
  );

  const legacy = structuredClone(base);
  delete legacy.scenes[authoredSpatialIndex].view.projection;
  delete legacy.scenes[authoredSpatialIndex].view.interaction;
  const sourceFor = (definition) =>
    `import { defineVisualization } from "@breadboard/visual-sdk";\nexport default defineVisualization(${JSON.stringify(definition)});`;
  const legacyCompilation = compileGeneratedVisualization(sourceFor(legacy));
  const authoredCompilation = compileGeneratedVisualization(sourceFor(base));
  assert.ok(
    legacyCompilation.definition,
    legacyCompilation.validation.errors.join("; "),
  );
  assert.ok(
    authoredCompilation.definition,
    authoredCompilation.validation.errors.join("; "),
  );
  assert.equal(
    Object.hasOwn(
      legacyCompilation.definition.scenes[authoredSpatialIndex].view,
      "projection",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      legacyCompilation.definition.scenes[authoredSpatialIndex].view,
      "interaction",
    ),
    false,
  );
  assert.notEqual(legacyCompilation.sourceHash, authoredCompilation.sourceHash);
  assert.notEqual(
    legacyCompilation.compiledHash,
    authoredCompilation.compiledHash,
  );
});

test("perspective orbit runtime works with touch, wheel, keyboard, reset, themes, and 375px", (t) => {
  const executable = browserPath();
  if (!executable) return t.skip("Chromium or Edge is not installed");
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-visual-convergence-"),
  );
  const htmlPath = path.join(outputDir, "convergence.html");
  try {
    const runtime = fs.readFileSync(runtimePath, "utf8");
    const serialized = JSON.stringify(convergenceDefinition()).replace(
      /</g,
      "\\u003c",
    );
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="breadboard-generated-visual-root"></div><script>
const requestedAuditWidth = Number(new URLSearchParams(location.search).get("auditWidth"));
if (Number.isFinite(requestedAuditWidth)) document.getElementById("breadboard-generated-visual-root").style.maxWidth = requestedAuditWidth + "px";
</script><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script><script>
window.postMessage({type:"breadboard-generated-visual:init",definition:${serialized},theme:"light",language:requestedAuditWidth <= 400 ? "tr-TR" : "not a language!"},"*");
setTimeout(() => {
  const orbit = () => document.querySelector('[data-spatial-interaction="orbit"]');
  const fixed = () => document.querySelector('[data-spatial-interaction="fixed"]');
  const camera = () => orbit()?.dataset.spatialCamera;
  const world = () => orbit()?.dataset.spatialWorldBounds;
  const fixedBounds = () => fixed()?.dataset.spatialCameraBounds;
  const anchor = () => document.querySelector('[data-spatial-id="moving-point"]')?.dataset.spatialAnchorX + "," + document.querySelector('[data-spatial-id="moving-point"]')?.dataset.spatialAnchorY;
  const initialCamera = camera();
  const initialWorld = world();
  const initialFixedBounds = fixedBounds();
  const initialAnchor = anchor();
  const initialFixedCamera = fixed()?.dataset.spatialCamera;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const playPause = document.querySelector('[data-action="play-pause"]');
  document.body.dataset.reducedMotionRespected = String(!reduced || playPause?.getAttribute("aria-pressed") === "false");
  if (playPause?.getAttribute("aria-pressed") === "true") playPause.click();
  const toggle = document.querySelector('[data-control-id="show_guides"]');
  const prediction = document.querySelector('[data-control-id="bounded_number"]');
  const commit = document.querySelector('[data-control-id="commit_view"]');
  const reveal = document.querySelector('[data-control-id="reveal_view"]');
  const protocolOutcome = () => Number(document.querySelector('[data-output-id="protocol_outcome"]')?.textContent);
  toggle.checked = true;
  toggle.dispatchEvent(new Event("change", { bubbles:true }));
  const protocolRowsInitiallyTruthful = document.querySelector('[data-control-readout="show_guides"]')?.textContent === "On" && !document.querySelector('[data-control-readout="commit_view"]') && !document.querySelector('[data-control-readout="reveal_view"]') && prediction?.disabled === false && commit?.disabled === false && reveal?.disabled === true;
  document.body.dataset.innerDocumentTitled = String(document.title === "Camera convergence");
  document.body.dataset.innerDocumentLanguage = String(document.documentElement.lang === (requestedAuditWidth <= 400 ? "tr-TR" : "en"));

  fixed()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, cancelable:true, pointerId:4, pointerType:"touch", isPrimary:true, button:0, clientX:20, clientY:20 }));
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles:true, cancelable:true, pointerId:4, pointerType:"touch", isPrimary:true, clientX:90, clientY:50 }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles:true, pointerId:4, pointerType:"touch", isPrimary:true, clientX:90, clientY:50 }));
  document.body.dataset.fixedCameraCompatible = String(fixed()?.dataset.spatialCamera === initialFixedCamera && !fixed()?.hasAttribute("tabindex") && fixed()?.dataset.spatialProjection === "orthographic");

  orbit()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, cancelable:true, pointerId:7, pointerType:"touch", isPrimary:true, button:0, clientX:100, clientY:100 }));
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles:true, cancelable:true, pointerId:7, pointerType:"touch", isPrimary:true, clientX:170, clientY:128 }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles:true, pointerId:7, pointerType:"touch", isPrimary:true, clientX:170, clientY:128 }));
  const draggedCamera = camera();
  document.body.dataset.touchOrbitChanged = String(draggedCamera !== initialCamera);

  orbit()?.dispatchEvent(new WheelEvent("wheel", { bubbles:true, cancelable:true, deltaY:-120 }));
  const wheelCamera = camera();
  document.body.dataset.wheelZoomChanged = String(wheelCamera?.split(",")[2] !== draggedCamera?.split(",")[2]);

  orbit()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, cancelable:true, key:"ArrowUp" }));
  const keyboardCamera = camera();
  document.body.dataset.keyboardOrbitChanged = String(keyboardCamera?.split(",")[1] !== wheelCamera?.split(",")[1]);
  document.body.dataset.keyboardFocusPreserved = String(document.activeElement === orbit());
  orbit()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, cancelable:true, key:"Home" }));
  document.body.dataset.homeRestored = String(camera() === initialCamera && anchor() === initialAnchor);

  orbit()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, cancelable:true, pointerId:9, pointerType:"mouse", isPrimary:true, button:0, clientX:100, clientY:100 }));
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles:true, cancelable:true, pointerId:9, pointerType:"mouse", isPrimary:true, clientX:140, clientY:100 }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles:true, pointerId:9, pointerType:"mouse", isPrimary:true }));
  for (const [id, value] of [["factor_a", "10"], ["factor_b", "10"], ["curve_position", "0.5"]]) {
    const control = document.querySelector('[data-control-id="' + id + '"]');
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles:true }));
  }
  const boundedNumber = prediction;
  boundedNumber.value = "999";
  boundedNumber.dispatchEvent(new Event("input", { bubbles:true }));
  document.body.dataset.numberDomainClamped = String(boundedNumber.value === "2" && document.querySelector('[data-control-readout="bounded_number"]')?.textContent === "2");
  const outcomeBeforeProtocol = protocolOutcome();
  reveal.click();
  reveal.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true }));
  const prematureRevealGuarded = reveal.disabled === true && protocolOutcome() === outcomeBeforeProtocol;
  commit.click();
  const commitOnlyGuarded = prediction.disabled === true && commit.disabled === true && reveal.disabled === false && protocolOutcome() === outcomeBeforeProtocol;
  boundedNumber.value = "-1.5";
  boundedNumber.dispatchEvent(new Event("input", { bubbles:true }));
  const committedPredictionLocked = boundedNumber.value === "2" && document.querySelector('[data-control-readout="bounded_number"]')?.textContent === "2" && protocolOutcome() === outcomeBeforeProtocol;
  reveal.click();
  const revealedOutcome = protocolOutcome();
  boundedNumber.value = "-1";
  boundedNumber.dispatchEvent(new Event("input", { bubbles:true }));
  const laterPredictionEditBlocked = boundedNumber.value === "2" && protocolOutcome() === revealedOutcome;
  document.body.dataset.protocolSequenceEnforced = String(prematureRevealGuarded && commitOnlyGuarded && committedPredictionLocked && revealedOutcome === 2 && laterPredictionEditBlocked);
  const pointsStayInside = ["moving-point", "legacy-joint-point", "interior-point", "legacy-interior-point", "bounded-number-point"].every((id) => {
    const point = document.querySelector('[data-spatial-id="' + id + '"]');
    const x = Number(point?.dataset.spatialAnchorX);
    const y = Number(point?.dataset.spatialAnchorY);
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 640 && y >= 0 && y <= 400;
  });
  const worldValues = String(world()).split(",").map(Number);
  document.body.dataset.authoredWorldStable = String(world() === initialWorld && fixedBounds() === initialFixedBounds);
  document.body.dataset.jointControlBoundsStable = String(pointsStayInside);
  document.body.dataset.interiorExtremumFramed = String(worldValues[4] >= 25 && pointsStayInside);
  document.querySelector('[data-action="reset"]').click();
  document.body.dataset.globalResetRestored = String(camera() === initialCamera && anchor() === initialAnchor);
  document.body.dataset.protocolRowsTruthful = String(protocolRowsInitiallyTruthful && toggle.checked === false && document.querySelector('[data-control-readout="show_guides"]')?.textContent === "Off" && prediction.disabled === false && prediction.value === "0" && commit.disabled === false && reveal.disabled === true && protocolOutcome() === 0);

  const perspectiveHost = orbit()?.closest(".gv-scene");
  const depths = Array.from(perspectiveHost?.querySelectorAll("[data-spatial-depth]") || []).map((node) => Number(node.dataset.spatialDepth));
  document.body.dataset.depthSorted = String(depths.every((value, index) => index === 0 || depths[index - 1] <= value));
  const nearRadius = Number(perspectiveHost?.querySelector('[data-spatial-id="near-sphere"] .gv-spatial-surface')?.getAttribute("r"));
  const farRadius = Number(perspectiveHost?.querySelector('[data-spatial-id="far-sphere"] .gv-spatial-surface')?.getAttribute("r"));
  document.body.dataset.perspectiveForeshortening = String(nearRadius > farRadius && Number.isFinite(nearRadius) && Number.isFinite(farRadius));
  document.body.dataset.orbitAccessible = String(orbit()?.getAttribute("aria-roledescription") && orbit()?.getAttribute("aria-keyshortcuts")?.includes("Home") && orbit()?.querySelector("desc")?.textContent.includes("arrow keys"));
  document.body.dataset.flatHierarchy = String(document.querySelectorAll("h1").length === 1 && document.querySelector(".gv-root")?.firstElementChild?.classList.contains("gv-header") && document.querySelector(".gv-header")?.nextElementSibling?.classList.contains("gv-scenes"));
  document.body.dataset.toolbarAccessible = String(Array.from(document.querySelectorAll(".gv-transport")).every((button) => button.getAttribute("aria-label") && button.querySelector("svg")));
  document.body.dataset.visualDominant = String((document.querySelector(".gv-scenes .gv-svg")?.getBoundingClientRect().height || 0) >= (requestedAuditWidth <= 400 ? 295 : 380));
  const lightBackground = getComputedStyle(document.documentElement).getPropertyValue("--viz-bg").trim();
  window.postMessage({type:"breadboard-generated-visual:theme",theme:"dark"},"*");
  setTimeout(() => {
    const darkBackground = getComputedStyle(document.documentElement).getPropertyValue("--viz-bg").trim();
    document.body.dataset.liveTheme = String(document.documentElement.dataset.theme === "dark" && darkBackground !== lightBackground);
    const shell = document.getElementById("breadboard-generated-visual-root");
    const app = shell?.querySelector(".gv-root");
    const shellRect = shell?.getBoundingClientRect();
    const contained = Boolean(shellRect) && Array.from(app?.querySelectorAll("*") || []).filter((node) => !node.closest("svg") && !node.classList.contains("gv-sr")).every((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width === 0 || (rect.left >= shellRect.left - 1 && rect.right <= shellRect.right + 1);
    });
    const overlaps = (left, right) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)) > 1;
    const header = app?.querySelector(".gv-header");
    const heading = app?.querySelector(".gv-heading")?.getBoundingClientRect();
    const toolbar = app?.querySelector(".gv-toolbar")?.getBoundingClientRect();
    const headerClear = !header || !heading || !toolbar || !overlaps(heading, toolbar);
    const controlsClear = Array.from(app?.querySelectorAll(".gv-control") || []).every((row) => {
      const nodes = [row.querySelector("label"), row.querySelector("input,select,button"), row.querySelector(".gv-readout")].filter(Boolean).map((node) => node.getBoundingClientRect());
      return nodes.every((rect, index) => nodes.slice(index + 1).every((candidate) => !overlaps(rect, candidate)));
    });
    const legendItems = Array.from(app?.querySelectorAll(".gv-spatial-legend li") || []).map((node) => node.getBoundingClientRect());
    const legendsClear = legendItems.every((rect, index) => legendItems.slice(index + 1).every((candidate) => !overlaps(rect, candidate)));
    const svgLabelSelectors = [".gv-spatial-label", ".gv-label:not(.gv-node-label)", ".gv-node-label", ".gv-tick"];
    const svgTextLegible = svgLabelSelectors.every((selector) => {
      const labels = Array.from(app?.querySelectorAll(selector) || []);
      return labels.length > 0 && labels.every((label) => {
        const svg = label.closest("svg");
        const renderedScale = (svg?.getBoundingClientRect().width || 0) / (svg?.viewBox?.baseVal?.width || 640);
        const renderedFontSize = parseFloat(getComputedStyle(label).fontSize) * renderedScale;
        return renderedFontSize >= 11.5 && label.getBoundingClientRect().height >= 11;
      });
    });
    const spatialLabelsClear = Array.from(app?.querySelectorAll(".gv-spatial-camera") || []).every((svg) => {
      const labels = Array.from(svg.querySelectorAll("[data-spatial-label-for]"));
      const boxes = labels.map((label) => label.getBBox());
      const geometry = Array.from(svg.querySelectorAll("[data-spatial-geometry-left]")).map((node) => ({
        x: Number(node.dataset.spatialGeometryLeft),
        y: Number(node.dataset.spatialGeometryTop),
        width: Number(node.dataset.spatialGeometryRight) - Number(node.dataset.spatialGeometryLeft),
        height: Number(node.dataset.spatialGeometryBottom) - Number(node.dataset.spatialGeometryTop),
      }));
      const overlapArea = (left, right) => Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
      return labels.length > 0 && boxes.every((box, index) =>
        box.x >= -1 && box.y >= -1 && box.x + box.width <= 641 && box.y + box.height <= 401 &&
        boxes.slice(index + 1).every((candidate) => overlapArea(box, candidate) <= 16) &&
        geometry.every((candidate) => overlapArea(box, candidate) <= 16) &&
        Boolean(labels[index].querySelector("title")?.textContent)
      );
    });
    document.body.dataset.mobileNoOverflow = String(Boolean(shell && app) && shell.scrollWidth <= shell.clientWidth + 1 && app.scrollWidth <= app.clientWidth + 1 && contained);
    document.body.dataset.mobileLayoutClear = String(headerClear && controlsClear && legendsClear);
    document.body.dataset.svgTextLegible = String(svgTextLegible);
    document.body.dataset.spatialLabelsClear = String(spatialLabelsClear);
  }, 20);
}, 80);
</script></body></html>`;
    fs.writeFileSync(htmlPath, html, "utf8");

    for (const [width, height, reduced] of [
      [1000, 800, false],
      [375, 720, true],
    ]) {
      const profilePath = path.join(
        outputDir,
        `edge-profile-${width}-${height}-${Date.now()}`,
      );
      const args = [
        `--user-data-dir=${profilePath}`,
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-first-run",
        `--window-size=${width},${height}`,
        "--virtual-time-budget=2500",
        "--dump-dom",
      ];
      if (reduced) args.push("--force-prefers-reduced-motion=reduce");
      args.push(`${pathToFileURL(htmlPath).href}?auditWidth=${width}`);
      const result = spawnSync(executable, args, {
        encoding: "utf8",
        timeout: 25_000,
        windowsHide: true,
      });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      assert.equal(
        result.status,
        0,
        result.error?.message ?? output.slice(-800),
      );
      for (const attribute of [
        "fixed-camera-compatible",
        "touch-orbit-changed",
        "wheel-zoom-changed",
        "keyboard-orbit-changed",
        "keyboard-focus-preserved",
        "home-restored",
        "authored-world-stable",
        "joint-control-bounds-stable",
        "interior-extremum-framed",
        "number-domain-clamped",
        "global-reset-restored",
        "protocol-rows-truthful",
        "protocol-sequence-enforced",
        "inner-document-titled",
        "inner-document-language",
        "depth-sorted",
        "perspective-foreshortening",
        "orbit-accessible",
        "flat-hierarchy",
        "toolbar-accessible",
        "visual-dominant",
        "live-theme",
        "mobile-no-overflow",
        "mobile-layout-clear",
        "svg-text-legible",
        "spatial-labels-clear",
        "reduced-motion-respected",
      ]) {
        assert.match(
          output,
          new RegExp(`data-${attribute}="true"`),
          `${attribute} failed at ${width}x${height}`,
        );
      }
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
