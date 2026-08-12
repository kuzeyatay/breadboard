// Renders the CAD artifact for real (esbuild -> CJS -> react-dom/server)
// rather than asserting on source, so a panel that stops rendering is caught.
//
// The three.js viewer needs a WebGL context, which server rendering does not
// have, so it is stubbed at the module boundary the way the blueprint suite
// stubs Wokwi's custom elements. Everything else — the parameter panel, the
// validation panel, the export list, the revision history — is the real
// component, rendered from a real manifest.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const artifactComponentSource = fs.readFileSync(
  path.join(dashboardRoot, "src", "app", "components", "cad", "parametric-cad-artifact.tsx"),
  "utf8",
);
fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-cad-artifact-"),
);

/** Replaces the WebGL viewer with an inert stand-in for server rendering. */
const stubPlugin = {
  name: "stub-browser-only",
  setup(build) {
    build.onResolve({ filter: /model-viewer$/ }, () => ({
      path: "model-viewer",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents:
        'const React = require("react");\n' +
        "module.exports = { __esModule: true, default: (props) =>\n" +
        "  React.createElement('div', { 'data-viewer-source': props.source, 'data-wireframe': String(props.wireframe), 'data-grid': String(props.showGrid), 'data-projection': props.projection }) };",
      loader: "js",
    }));
  },
};

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ParametricCadArtifact } from "@/app/components/cad/parametric-cad-artifact";
`,
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  plugins: [stubPlugin],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ParametricCadArtifact } = require(bundle);

const PROJECT = `cadp_${"a".repeat(32)}`;

function file(format, filename, mimeType, extra = {}) {
  return {
    projectId: PROJECT,
    revision: 2,
    format,
    filename,
    mimeType,
    byteSize: 4096,
    sha256: "d".repeat(64),
    ...extra,
  };
}

const DESIGN = {
  schemaVersion: 1,
  artifactType: "parametric-cad",
  projectId: PROJECT,
  revision: 2,
  title: "Raspberry Pi Enclosure",
  status: "valid-with-warnings",
  designSpec: {
    schemaVersion: 1,
    projectId: PROJECT,
    name: "raspberry-pi-enclosure",
    description: "A wall-mounted enclosure with a removable lid.",
    units: "mm",
    manufacturingProcess: "fdm",
    parameters: [
      {
        id: "internal_width",
        label: "Internal width",
        value: 92,
        unit: "mm",
        minimum: 20,
        maximum: 300,
        editable: true,
        source: "user",
        description: "The clear space inside the shell.",
      },
      { id: "wall", label: "Wall thickness", value: 2.4, unit: "mm", editable: true, source: "user" },
      {
        id: "lid_clearance",
        label: "Lid clearance",
        value: 0.35,
        unit: "mm",
        editable: true,
        source: "default",
      },
      { id: "vent_open", label: "Vents", value: true, editable: true, source: "default" },
      { id: "note", label: "Finish", value: "matte", editable: false, source: "derived" },
    ],
    components: [
      { id: "shell", name: "Shell", quantity: 1, bodyRole: "primary" },
      { id: "lid", name: "Lid", quantity: 1, bodyRole: "lid" },
    ],
    constraints: [
      { id: "c1", type: "clearance", description: "0.35 mm lid clearance", expected: 0.35 },
    ],
    assumptions: [
      { id: "a1", description: "0.35 mm lid clearance", reason: "Not stated.", userEditable: true },
    ],
    exportSettings: {
      stlLinearTolerance: 0.05,
      stlAngularTolerance: 0.2,
      generateStep: true,
      generateStl: true,
      generateGlb: true,
      generate3mf: true,
    },
    printerBed: { x: 220, y: 220, z: 250 },
  },
  source:
    'import cadquery as cq\n\nDEFAULT_PARAMS = {"internal_width": 92.0}\n\n\ndef build_model(params):\n    return {"shell": cq.Workplane("XY").box(96.8, 69.8, 30.4)}\n',
  entrypoint: "build_model",
  parameters: { internal_width: 92, wall: 2.4, lid_clearance: 0.35 },
  previewFile: file("glb", "model.glb", "model/gltf-binary", {
    linearTolerance: 0.05,
    angularTolerance: 0.2,
  }),
  exports: [
    file("step", "model.step", "model/step"),
    file("stl", "model.stl", "model/stl", { linearTolerance: 0.05, angularTolerance: 0.2 }),
    file("glb", "model.glb", "model/gltf-binary"),
    file("3mf", "model.3mf", "model/3mf"),
    file("source", "model.py", "text/x-python; charset=utf-8"),
    file("spec", "design-spec.json", "application/json; charset=utf-8"),
    file("report", "validation.json", "application/json; charset=utf-8"),
  ],
  measurements: {
    boundingBox: { x: 96.8, y: 69.8, z: 30.4, unit: "mm" },
    volume: 43_460,
    surfaceArea: 21_400,
    solidCount: 2,
    triangleCount: 8_348,
    bodies: [
      {
        name: "shell",
        volume: 30_000,
        surfaceArea: 15_000,
        boundingBox: { x: 96.8, y: 69.8, z: 30.4 },
        valid: true,
        watertight: true,
      },
      {
        name: "lid",
        volume: 13_460,
        surfaceArea: 6_400,
        boundingBox: { x: 91.3, y: 64.3, z: 2.4 },
        valid: true,
        watertight: true,
      },
    ],
  },
  validation: {
    passed: true,
    checkedAt: "2026-08-05T10:00:00.000Z",
    issues: [
      {
        code: "disconnected_bodies",
        severity: "warning",
        message: "These bodies do not touch any other body: shell, lid.",
        repairHint: "If they should be one piece, union them.",
      },
      {
        code: "wall_thickness_declared",
        severity: "info",
        message: "Wall thickness is checked against the declared value of 2.4 mm.",
        expected: 2.4,
      },
    ],
  },
  assumptions: ["0.35 mm lid clearance"],
  disclaimers: [
    "Validation here is geometric: it is not a mechanical engineering verification.",
  ],
  revisionHistory: [
    {
      revision: 1,
      parentRevision: null,
      status: "valid",
      instruction: "First build",
      parameterDiff: [],
      createdAt: "2026-08-05T09:00:00.000Z",
      validationPassed: true,
      errorCount: 0,
      warningCount: 0,
      boundingBox: { x: 96.8, y: 69.8, z: 30.4 },
    },
    {
      revision: 2,
      parentRevision: 1,
      status: "valid-with-warnings",
      instruction: "Thicker walls",
      parameterDiff: [{ id: "wall", from: 2.4, to: 3 }],
      createdAt: "2026-08-05T10:00:00.000Z",
      validationPassed: true,
      errorCount: 0,
      warningCount: 1,
      boundingBox: { x: 98, y: 71, z: 31 },
    },
  ],
  generationLog: [
    { at: "2026-08-05T10:00:00.000Z", stage: "execute", detail: "2 solid(s) in 2400 ms" },
  ],
  provenance: {
    engine: "cadquery",
    engineVersion: "2.6.0",
    kernel: "opencascade",
    kernelVersion: "7.8.1",
    pythonVersion: "3.12.13",
    serviceVersion: "1.0.0",
    model: "test-model",
    generatedAt: "2026-08-05T10:00:00.000Z",
    parentRevision: 1,
    buildDurationMs: 2400,
  },
};

function render(props = {}) {
  return renderToStaticMarkup(
    React.createElement(ParametricCadArtifact, {
      design: DESIGN,
      conversationId: "conv_test",
      ...props,
    }),
  );
}

test.after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

test("the artifact opens with the design named and measured", () => {
  const html = render();
  assert.match(html, /Raspberry Pi Enclosure/);
  assert.match(html, /Revision 2/);
  assert.match(html, /96\.8 × 69\.8 × 30\.4 mm/);
  assert.match(html, /2 bodies/);
  assert.match(html, /Validated with warnings/);
});

test("the 3D preview loads through the authenticated CAD route", () => {
  const html = render();
  assert.match(
    html,
    new RegExp(`/api/cad/projects/${PROJECT}/files/2/glb`),
    "the viewer is not pointed at the artifact download route",
  );
  // No filesystem path, no service address, no secret.
  assert.doesNotMatch(html, /127\.0\.0\.1|localhost:\d+/);
  assert.doesNotMatch(html, /[A-Za-z]:\\\\|\/home\/|\/Users\//);
});

test("every standard view and display control is offered", () => {
  const html = render();
  for (const label of ["Iso", "Front", "Rear", "Left", "Right", "Top", "Bottom"]) {
    assert.ok(html.includes(`>${label}<`), `the ${label} view button is missing`);
  }
  for (const label of ["Reset view", "Perspective", "Wireframe", "Grid", "Bounding box"]) {
    assert.ok(html.includes(label), `the ${label} control is missing`);
  }
});

test("the preview toolbar does not expose internal mesh names", () => {
  assert.doesNotMatch(artifactComponentSource, /onLoaded=\{setBodies\}/);
  assert.doesNotMatch(artifactComponentSource, /visibleBodies/);
  assert.doesNotMatch(artifactComponentSource, /toggleBody/);
  // Logical body names remain available in Validation; only raw preview-node
  // visibility chips such as shell_1 and lid_6 are removed from the toolbar.
  assert.doesNotMatch(artifactComponentSource, /hidden\.has\(name\)/);
});

test("the parameters panel exposes editable values with their ranges", () => {
  const html = render();
  const trigger = html.match(/<button[^>]*id="cad-parameters-trigger"[^>]*>/)?.[0] ?? "";
  assert.match(trigger, /aria-expanded="true"/);
  assert.match(trigger, /aria-controls="cad-parameters-panel"/);
  assert.match(
    html,
    /<section[^>]*id="cad-parameters-panel"[^>]*aria-labelledby="cad-parameters-trigger"/,
  );
  assert.match(html, /Named parameters/);
  assert.match(html, /Internal width/);
  assert.match(html, /value="92"/);
  assert.match(html, /min="20"/);
  assert.match(html, /max="300"/);
  assert.match(html, /Wall thickness/);
  assert.match(html, /Lid clearance/);
  // A boolean parameter renders as a select, not a number box.
  assert.match(html, /<select[^>]*>/);
  // A non-editable parameter is shown but disabled.
  assert.match(html, /disabled=""/);
  assert.match(html, /Rebuild with these values/);
  // Provenance of each value is visible: user, default or derived.
  for (const source of ["user", "default", "derived"]) {
    assert.ok(html.includes(source), `parameter source "${source}" is not shown`);
  }
});

test("an expanded CAD panel can be collapsed and reopened", () => {
  assert.match(artifactComponentSource, /useState<CadPanel \| null>\(initialPanel\)/);
  assert.match(
    artifactComponentSource,
    /setTab\(\(current\) => \(current === id \? null : id\)\)/,
  );
  for (const panel of ["parameters", "validation", "exports", "source", "history"]) {
    assert.match(artifactComponentSource, new RegExp(`${panel}: "cad-${panel}-panel"`));
  }
});

test("every panel is reachable and counts what it holds", () => {
  const html = render();
  assert.match(html, /Parameters \(4\)/);
  assert.match(html, /Validation \(1\)/);
  assert.match(html, /Exports \(7\)/);
  assert.match(html, /Revisions \(2\)/);
  assert.match(html, /Source/);
});

test("the validation panel shows measurements, findings and the disclaimer", () => {
  const html = render({ initialPanel: "validation" });
  assert.match(html, /96\.80 × 69\.80 × 30\.40 mm/);
  assert.match(html, /43\.46 cm³/);
  assert.match(html, /214\.00 cm²/);
  assert.match(html, /8348/);
  assert.match(html, /Fits 220×220×250 mm/);
  assert.match(html, /0\.05 mm \/ 0\.2 rad/);

  // Per-body soundness, named.
  assert.match(html, /shell/);
  assert.match(html, /watertight/);
  assert.match(html, /valid shape/);

  // A warning is shown even though every export succeeded.
  assert.match(html, /Warnings \(1\)/);
  assert.match(html, /disconnected_bodies/);
  assert.match(html, /If they should be one piece/);
  // Info-level notes are separated from warnings, not hidden.
  assert.match(html, /Notes \(1\)/);
  assert.match(html, /wall_thickness_declared/);

  assert.match(html, /Assumptions/);
  assert.match(html, /0\.35 mm lid clearance/);
  assert.match(html, /not a mechanical engineering verification/);
});

test("every export is downloadable through the authenticated route", () => {
  const html = render({ initialPanel: "exports" });
  for (const [format, label] of [
    ["step", "STEP · editable CAD"],
    ["stl", "STL · for slicing"],
    ["glb", "GLB · 3D preview"],
    ["3mf", "3MF · for slicing"],
    ["source", "CadQuery source"],
    ["spec", "Design specification"],
    ["report", "Validation report"],
  ]) {
    assert.ok(html.includes(label), `${format} has no download link`);
    assert.ok(
      html.includes(`/api/cad/projects/${PROJECT}/files/2/${format}`),
      `${format} is not downloaded through the authenticated route`,
    );
  }
  // The difference between an editable model and a mesh is explained, not assumed.
  assert.match(html, /STEP is the editable engineering model/);
  assert.match(html, /cannot be edited back into a parametric/);
});

test("the source panel shows the program and its provenance", () => {
  const html = render({ initialPanel: "source" });
  assert.match(html, /build_model\(params\)/);
  assert.match(html, /DEFAULT_PARAMS/);
  assert.match(html, /cadquery 2\.6\.0 on OpenCascade 7\.8\.1/);
  assert.match(html, /Generation log/);
  assert.match(html, /2 solid\(s\) in 2400 ms/);
});

test("the revision panel keeps every version and what changed", () => {
  const html = render({ initialPanel: "history" });
  assert.match(html, /Revision 1/);
  assert.match(html, /Revision 2/);
  assert.match(html, /· current/);
  assert.match(html, /Thicker walls/);
  assert.match(html, /wall: 2\.4 → 3/);
});

test("a design with no preview file says so instead of rendering an empty frame", () => {
  const html = render({ design: { ...DESIGN, previewFile: null } });
  assert.match(html, /no 3D preview file/);
});

test("an invalid design is labelled as such", () => {
  const html = render({
    design: {
      ...DESIGN,
      status: "invalid",
      validation: {
        passed: false,
        checkedAt: DESIGN.validation.checkedAt,
        issues: [
          {
            code: "not_watertight",
            severity: "error",
            message: "The body is not a closed volume.",
          },
        ],
      },
    },
  });
  assert.match(html, /Not valid/);
  assert.match(html, /Validation \(1\)/);
});

test("the panel refuses to submit without a conversation to publish into", () => {
  const html = render({ conversationId: undefined });
  // The rebuild button is present but disabled: a design opened outside its
  // conversation can be read, not revised.
  const button = /Rebuild with these values/.exec(html);
  assert.ok(button, "the rebuild button is missing");
  assert.match(html.slice(0, button.index), /disabled=""/);
});
