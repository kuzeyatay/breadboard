// Renders the blueprint artifact for real (esbuild -> CJS -> react-dom/server)
// rather than asserting on source, so a section that stops rendering is caught.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
// Built inside node_modules so the CJS bundle resolves react from the app's
// own installation rather than from a temp directory with no dependencies.
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-hardware-artifact-"),
);

/** Replaces browser-only modules with inert stand-ins for server rendering. */
const stubPlugin = {
  name: "stub-browser-only",
  setup(build) {
    build.onResolve({ filter: /^@wokwi\/elements$/ }, () => ({
      path: "wokwi-elements",
      namespace: "stub",
    }));
    build.onResolve({ filter: /chat-markdown$/ }, () => ({
      path: "chat-markdown",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) =>
      args.path === "chat-markdown"
        ? {
            contents:
              'const React = require("react");\n' +
              "module.exports = { __esModule: true, default: ({ content }) => React.createElement('pre', null, content) };",
            loader: "js",
          }
        : { contents: "module.exports = {};", loader: "js" },
    );
  },
};

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as HardwareBlueprintArtifact } from "@/app/components/hardware/hardware-blueprint-artifact";
export { default as WiringView, contentBox } from "@/app/components/hardware/wiring-view";
export { default as SchematicView } from "@/app/components/hardware/schematic-view";
export { default as FirmwareView } from "@/app/components/hardware/firmware-view";
export { computeFit } from "@/app/components/hardware/use-fit-view";
export { buildDesign } from "@/lib/hardware/design.ts";
export { designOverview } from "@/lib/hardware/overview.ts";
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
const artifactModule = require(bundle);

const {
  HardwareBlueprintArtifact,
  WiringView,
  SchematicView,
  FirmwareView,
  buildDesign,
  computeFit,
  contentBox,
  designOverview,
} = artifactModule;

const WEATHER_STATION = {
  purpose: "Build an ESP32 weather station with a BME280 and a 128x64 OLED",
  controller: "ESP32",
  inputs: [{ type: "BME280", quantity: 1 }],
  outputs: [{ type: "128x64 OLED", quantity: 1 }],
  communication: ["i2c", "wifi"],
  power: { source: "usb" },
  prototypeType: "breadboard",
  firmware: { platform: "platformio", language: "cpp" },
  constraints: { beginnerFriendly: true, preferredComponents: [], forbiddenComponents: [] },
};

const { design } = buildDesign({ request: WEATHER_STATION, designId: "hwd_artifact_test" });
const EMPTY = { componentIds: [], netIds: [] };

function render(element) {
  return renderToStaticMarkup(element);
}

test.after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

test("the artifact opens on Overview and offers every section", () => {
  const markup = render(React.createElement(HardwareBlueprintArtifact, { design }));
  for (const section of [
    "Overview",
    "Wiring",
    "Schematic",
    "BOM",
    "Assembly",
    "Firmware",
    "Validation",
    "Data",
  ]) {
    assert.ok(markup.includes(`>${section}</button>`), `the ${section} tab is missing`);
  }
  assert.ok(markup.includes(design.title));
  assert.ok(markup.includes("Ready to build"));
  assert.ok(markup.includes("ESP32 DevKit V1"));
  assert.ok(markup.includes("Design decisions"));
  assert.ok(markup.includes("does not replace reading each part"), "the safety notice is missing");
  assert.ok(/Estimated current[\s\S]{0,200}mA typical/.test(markup));
});

test("the overview says what every part is there to do and how it is reached", () => {
  const markup = render(React.createElement(HardwareBlueprintArtifact, { design }));
  assert.ok(markup.includes("What each part does"), "the part breakdown is missing");

  // Every placed part is accounted for by reference, not just the ones the
  // request named — the resistors and the breadboard have a job too.
  for (const instance of design.components) {
    assert.ok(
      markup.includes(`>${instance.reference}</span>`),
      `${instance.reference} is not in the overview`,
    );
  }

  // Grouped by what the part contributes, not by library category.
  for (const heading of ["Control", "Sensing", "Output"]) {
    assert.ok(markup.includes(`>${heading}</h4>`), `the ${heading} group is missing`);
  }

  // The wiring is spelled out with the compiler's own pin labels.
  assert.ok(markup.includes("Shares the I²C bus"), "the bus wiring is not explained");
  assert.match(markup, /Wired<\/span>/, "no part says how it is wired");
  assert.match(markup, /Power<\/span>/, "no part says what feeds it");
  assert.match(markup, /Draw<\/span>/, "no part says what it draws");
  assert.match(markup, /returning through ground/, "the ground return is not described");

  // Rails and buses are summarised with their real loads.
  assert.ok(markup.includes("Rails and buses"));
  assert.ok(markup.includes("mA typical."), "no rail reports its load");
});

test("the overview reads its figures from the design, never from its own prose", () => {
  const overview = designOverview(design);
  assert.ok(design.powerEstimate, "the design carries no power estimate");
  assert.equal(overview.power.typicalMa, design.powerEstimate.totalTypicalMa);
  assert.equal(overview.power.maximumMa, design.powerEstimate.totalMaximumMa);

  // A design stored before the estimate existed still shows a figure, read
  // back out of the prose — which is why it is only good to the milliamp the
  // summary rounded to, and why new designs no longer go through it.
  const legacy = structuredClone(design);
  delete legacy.powerEstimate;
  const fallback = designOverview(legacy);
  assert.ok(
    Math.abs(fallback.power.typicalMa - design.powerEstimate.totalTypicalMa) < 1,
    "the fallback figure does not match the compiler's",
  );

  // And one with neither says so rather than inventing a number.
  const bare = structuredClone(legacy);
  bare.summary = "A project.";
  bare.decisions = [];
  assert.equal(designOverview(bare).power.typicalMa, undefined);
  const markup = render(React.createElement(HardwareBlueprintArtifact, { design: bare }));
  assert.ok(markup.includes("not estimated"));
});

test("a part the compiler added explains itself as the compiler's doing", () => {
  const { design: driven } = buildDesign({
    request: {
      ...WEATHER_STATION,
      purpose: "Switch a motor from an ESP32",
      inputs: [],
      outputs: [{ type: "DC motor", quantity: 1 }],
    },
    designId: "hwd_overview_driver",
  });
  const overview = designOverview(driven);
  const flyback = overview.groups
    .flatMap((group) => group.parts)
    .find((part) => part.componentId.includes("diode") || part.name.includes("1N4007"));
  assert.ok(flyback, "the flyback diode is missing from the overview");
  assert.equal(flyback.automatic, true);
  assert.ok(flyback.job.length > 0);

  const markup = render(React.createElement(HardwareBlueprintArtifact, { design: driven }));
  assert.ok(markup.includes("added automatically"), "inserted parts are not marked as inserted");
  assert.ok(markup.includes("Support parts"), "inserted parts have no group of their own");
});

test("an invalid design surfaces its errors instead of looking healthy", () => {
  const broken = structuredClone(design);
  broken.status = "needs-changes";
  broken.validationResults = [
    {
      id: "v1",
      rule: "LOGIC_LEVEL_MISMATCH",
      severity: "error",
      title: "U2 ECHO drives 5 V into a 3.3 V pin",
      message: "The echo output exceeds the controller's maximum.",
      componentIds: [design.components[1].id],
      netIds: [],
      remediation: "Add a level shifter.",
    },
  ];
  const markup = render(React.createElement(HardwareBlueprintArtifact, { design: broken }));
  assert.ok(markup.includes("Needs changes"));
  assert.ok(markup.includes("1 error"));
});

const FINDINGS = [
  {
    id: "v_error",
    rule: "LOGIC_LEVEL_MISMATCH",
    severity: "error",
    title: "U2 ECHO drives 5 V into a 3.3 V pin",
    // No apostrophes anywhere in these fixtures: the assertions below match
    // rendered markup, where they would come back as entities.
    message: "The echo output exceeds the maximum rating of that controller pin.",
    componentIds: [],
    netIds: [],
    remediation: "Add a level shifter.",
  },
  {
    id: "v_warning",
    rule: "BOOT_STRAP_PIN_WARNING",
    severity: "warning",
    title: "A strapping pin was used",
    message: "This pin decides how the board boots.",
    componentIds: [],
    netIds: [],
  },
  {
    id: "v_info",
    rule: "UNKNOWN_ELECTRICAL_VALUE",
    severity: "info",
    title: "One draw is not documented",
    message: "The library has no figure for this part.",
    componentIds: [],
    netIds: [],
  },
];

function withFindings(base) {
  const copy = structuredClone(base);
  copy.status = "needs-changes";
  copy.validationResults = FINDINGS.map((finding) => ({
    ...finding,
    componentIds: [base.components[1].id],
    netIds: [base.nets[0].id],
  }));
  return copy;
}

test("validation explains each finding in place instead of jumping to the diagram", () => {
  const broken = withFindings(design);
  const markup = render(
    React.createElement(HardwareBlueprintArtifact, {
      design: broken,
      initialSection: "Validation",
    }),
  );

  // Every finding is readable where it is: it is an article, not a button that
  // navigates away the moment you click anything on it.
  assert.equal((markup.match(/<article/g) ?? []).length, 3, "the findings are not laid out as cards");
  for (const finding of FINDINGS) {
    assert.ok(markup.includes(finding.title), `${finding.id} is missing`);
    assert.ok(markup.includes(finding.message), `${finding.id} has no message`);
  }
  assert.ok(markup.includes("Add a level shifter."), "the remediation is missing");

  // Severities are named in words, and the note severity is no longer dropped.
  for (const label of ["Error", "Warning", "Note"]) {
    assert.ok(markup.includes(`>${label}</p>`), `the ${label} severity is not labelled`);
  }
  assert.ok(markup.includes("Errors 1") && markup.includes("Notes 1"), "no severity filters");

  // Going to the diagram is an explicit action, and the affected parts and
  // nets are named rather than shown as raw ids.
  assert.equal(
    (markup.match(/Show in wiring/g) ?? []).length,
    3,
    "a finding has no way to reach the diagram",
  );
  assert.ok(markup.includes(broken.components[1].reference));
  assert.ok(markup.includes(broken.nets[0].name));
  assert.ok(!markup.includes(broken.components[1].id), "a raw component id leaked into the page");

  // A finding says what its rule actually checks.
  assert.ok(
    markup.includes("No signal drives a pin past its own maximum voltage"),
    "the rule is shown as a bare name with no explanation",
  );
  assert.ok(markup.includes("What was checked"), "the rule list is missing");
  assert.ok(
    markup.includes("does not replace reading each part"),
    "the safety notice does not appear on the page that needs it",
  );
});

test("a design with nothing to report still says what ran", () => {
  const markup = render(
    React.createElement(HardwareBlueprintArtifact, { design, initialSection: "Validation" }),
  );
  assert.equal(design.validationResults.length, 0);
  assert.ok(markup.includes("Every check passed"));
  assert.ok(markup.includes("None of them fired."));
  assert.ok(/\d+ rules ran against the compiled circuit/.test(markup), "the rule count is missing");
  assert.ok(!markup.includes("read the notice on"), "the empty state still points somewhere else");
  assert.ok(markup.includes("does not replace reading each part"));
});

test("the wiring view draws a wire for every net and labels each part", () => {
  const markup = render(
    React.createElement(WiringView, { design, selection: EMPTY, onSelect: () => {} }),
  );
  assert.ok(markup.includes("<svg"), "no SVG overlay was rendered");
  for (const instance of design.components) {
    assert.ok(markup.includes(`>${instance.reference}`), `${instance.reference} has no label`);
  }
  for (const net of design.nets) {
    assert.ok(markup.includes(net.name), `${net.name} has no wire or tooltip`);
  }
  assert.ok(markup.includes("Reset view"));
  assert.ok(markup.includes("Zoom in"));
  // The legend names roles in words, not colour alone.
  assert.ok(markup.includes(">Ground</li>") || markup.includes("Ground"));
  assert.ok(markup.includes("I²C data"));
});

test("selecting a net dims everything that net does not reach", () => {
  const neutral = render(
    React.createElement(WiringView, { design, selection: EMPTY, onSelect: () => {} }),
  );
  assert.ok(!neutral.includes('opacity="0.15"'), "the neutral view already dims wires");
  assert.ok(!neutral.includes("opacity-25"), "the neutral view already dims parts");

  const selected = render(
    React.createElement(WiringView, {
      design,
      selection: { componentIds: [], netIds: ["net_i2c_sda"] },
      onSelect: () => {},
    }),
  );
  assert.ok(selected.includes("Clear selection"), "no selection was registered");
  assert.ok(selected.includes('opacity="0.15"'), "the power and ground wires stayed lit");
  // The breadboard is on no net, so it dims; the two I²C devices stay lit.
  assert.ok(selected.includes("opacity-25"), "no part was dimmed by the net selection");
  assert.equal(
    (selected.match(/opacity-25/g) ?? []).length,
    design.components.length - 3,
    "the wrong number of parts stayed lit for the SDA net",
  );
});

test("selecting a component lights up every net it touches", () => {
  // The sensor sits on power, ground and both I²C lines, so selecting it
  // leaves no wire dimmed — only the parts it shares nothing with.
  const sensor = design.components.find((instance) => instance.definitionId === "bme280");
  const markup = render(
    React.createElement(WiringView, {
      design,
      selection: { componentIds: [sensor.id], netIds: [] },
      onSelect: () => {},
    }),
  );
  assert.ok(markup.includes("Clear selection"));
  assert.ok(markup.includes('aria-pressed="true"'), "the selected part is not marked pressed");
  assert.ok(!markup.includes('opacity="0.15"'), "a wire the sensor sits on was dimmed");
});

test("selecting an assembly step highlights that step's parts and nets", () => {
  const busStep = design.assemblySteps.find((step) => step.title.includes("I2C_SDA"));
  assert.ok(busStep, "the design has no I²C wiring step");
  const markup = render(
    React.createElement(WiringView, {
      design,
      selection: { componentIds: busStep.componentIds, netIds: busStep.netIds },
      onSelect: () => {},
    }),
  );
  assert.ok(markup.includes("Clear selection"));
  // Every part on the step is lit; the power rails, which the step does not
  // touch, are dimmed.
  const rails = design.components.find((instance) => instance.definitionId === "power-rails");
  assert.ok(!busStep.componentIds.includes(rails.id));
  assert.ok(markup.includes("opacity-25"), "nothing outside the step was dimmed");

  // The artifact hands the step's own ids straight to the wiring view.
  const artifactSource = fs.readFileSync(
    path.join(dashboardRoot, "src/app/components/hardware/hardware-blueprint-artifact.tsx"),
    "utf8",
  );
  assert.match(
    artifactSource,
    /setSelection\(\{ componentIds: step\.componentIds, netIds: step\.netIds \}\)/,
  );
});

test("the schematic draws a symbol per wired part with its references and nets", () => {
  const markup = render(
    React.createElement(SchematicView, { design, selection: EMPTY, onSelect: () => {} }),
  );
  assert.ok(markup.includes("<svg"));
  for (const reference of ["U1", "U2", "U3"]) {
    assert.ok(markup.includes(`>${reference}</text>`), `${reference} has no symbol`);
  }
  assert.ok(markup.includes("I2C_SDA"), "the SDA net is not labelled");
  assert.ok(markup.includes("GND"), "the ground rail is not labelled");
  assert.ok(markup.includes("+3.3V"), "the power rail is not labelled");
});

test("the firmware view lists every file with build and upload steps", () => {
  const markup = render(
    React.createElement(FirmwareView, {
      firmware: design.firmware,
      onDownloadFile: () => {},
      onDownloadProject: () => {},
    }),
  );
  for (const file of design.firmware.files) {
    assert.ok(markup.includes(file.path), `${file.path} is missing from the file tree`);
  }
  assert.ok(markup.includes("Copy all files"));
  assert.ok(markup.includes("Download project ZIP"));
  assert.ok(markup.includes("pio run"));
  assert.ok(markup.includes("Expected serial output"));
  // The entry file's source is shown, and it uses the generated constants.
  assert.ok(markup.includes("PIN_I2C_SDA"));
});

test("the parts the compiler inserts all have a graphic of their own", () => {
  // A driver stage and a level converter between two domains, in one design.
  const { design: driven } = buildDesign({
    request: {
      ...WEATHER_STATION,
      purpose: "Switch a motor and read a distance sensor from an ESP32",
      inputs: [{ type: "HC-SR04", quantity: 1 }],
      outputs: [{ type: "DC motor", quantity: 1 }],
    },
    designId: "hwd_inserted_parts",
  });
  for (const definitionId of [
    "logic-level-converter",
    "mosfet-logic-level",
    "diode-1n4007",
    "dc-motor-5v",
  ]) {
    assert.ok(
      driven.components.some((instance) => instance.definitionId === definitionId),
      `${definitionId} was not inserted`,
    );
  }

  const markup = render(
    React.createElement(WiringView, { design: driven, selection: EMPTY, onSelect: () => {} }),
  );
  for (const instance of driven.components) {
    assert.ok(markup.includes(`>${instance.reference}`), `${instance.reference} has no label`);
    assert.ok(
      markup.includes(`left:${instance.position.x}px`),
      `${instance.reference} was not placed`,
    );
  }
  // Each fallback graphic draws itself rather than falling through to the
  // generic module box.
  assert.ok(markup.includes("LEVEL SHIFT"), "the level converter has no graphic");
  assert.ok(markup.includes("1N4007"), "the diode has no graphic");
  assert.ok(markup.includes(">M</text>"), "the motor has no graphic");
  assert.ok(markup.includes(">G</text>"), "the MOSFET pins are not labelled");

  const schematic = render(
    React.createElement(SchematicView, { design: driven, selection: EMPTY, onSelect: () => {} }),
  );
  assert.ok(schematic.includes(">Q1</text>"), "the MOSFET has no schematic symbol");
  assert.ok(schematic.includes("M1_GATE"), "the gate net is not labelled");
});

test("a diagram opens centred in its stage rather than pinned to the corner", () => {
  // The parts are laid out from the top-left of a drawing space that is larger
  // than they need, so an identity transform leaves them in the corner.
  const box = contentBox(design);
  assert.ok(box.width > 0 && box.height > 0);

  // A stage roomier than the circuit: no shrinking, but real centring.
  const roomy = computeFit({ stageWidth: box.width + 400, stageHeight: box.height + 300, box });
  assert.equal(roomy.zoom, 1, "a circuit that already fits was scaled");
  // Equal slack on both sides is what centred means: 400 spare pixels across
  // put 200 to the left of the content's own origin, and 300 spare put 150 above.
  assert.equal(Math.round(roomy.pan.x + box.x), 200, "the circuit is not horizontally centred");
  assert.equal(Math.round(roomy.pan.y + box.y), 150, "the circuit is not vertically centred");

  // A stage smaller than the circuit: scaled down, still centred, and the
  // scale leaves the padding the view asks for.
  const tight = computeFit({ stageWidth: box.width / 2, stageHeight: box.height / 2, box });
  assert.ok(tight.zoom < 1, "an oversized circuit was not shrunk to fit");
  assert.ok(tight.zoom >= 0.35, "the fit went below the minimum zoom");
  assert.equal(
    Math.round(tight.pan.x + box.x * tight.zoom),
    Math.round((box.width / 2 - box.width * tight.zoom) / 2),
    "the shrunken circuit is not centred",
  );

  // Nothing to measure yet is not a reason to guess a transform.
  assert.equal(computeFit({ stageWidth: 0, stageHeight: 0, box }), null);

  // Both diagrams go through the same fitting, so neither can drift.
  for (const file of [
    "src/app/components/hardware/wiring-view.tsx",
    "src/app/components/hardware/schematic-view.tsx",
  ]) {
    const text = fs.readFileSync(path.join(dashboardRoot, file), "utf8");
    assert.match(text, /useFitView\(/, `${file} does not use the shared fitted view`);
    assert.match(text, /transform: view\.transform/, `${file} does not apply the fitted transform`);
  }
});

test("a firmware-less design says so instead of rendering an empty tab", () => {
  const markup = render(
    React.createElement(FirmwareView, {
      firmware: undefined,
      onDownloadFile: () => {},
      onDownloadProject: () => {},
    }),
  );
  assert.ok(markup.includes("No firmware was generated"));
});
