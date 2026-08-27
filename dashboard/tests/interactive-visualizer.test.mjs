import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
import {
  activateArtifactVersion,
  createArtifact,
  publishValidatedArtifactVersion,
} from "../src/lib/hermes/artifact-store.ts";
import {
  bundleInteractiveVisualizer,
} from "../src/lib/hermes/interactive-visualizer-runtime.ts";
import {
  bundleCustomInteractiveVisualizer,
  compileCustomInteractiveVisualizerPackage,
} from "../src/lib/hermes/interactive-visualizer-custom.ts";
import {
  appendBoundedBrowserOutput,
  removeOwnedBrowserProfile,
  runInteractiveVisualizerBrowserTestsInWorker as runInteractiveVisualizerBrowserTests,
} from "../scripts/runtime-v2-interactive-visualizer-executor.mjs";
import {
  compileInteractiveVisualizerPackage,
} from "../src/lib/hermes/interactive-visualizer-validator.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  shouldAutoSelectInteractiveVisualizer,
  visualizerCommandText,
} from "../src/lib/hermes/interactive-visualizer-intent.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";
import { interactiveVisualizerConfig } from "../src/lib/hermes/interactive-visualizer-config.ts";

const sdkImport = 'import { defineVisualizer } from "@breadboard/interactive-visualizer-sdk"\n';

function plan(mode, intent) {
  return {
    schemaVersion: 1,
    title: intent,
    objective: `Help the learner understand ${intent}.`,
    mode,
    rationale: mode === "3d" ? "Depth and camera rotation are material." : "Depth is not material.",
    concepts: ["Cause and effect"],
    assumptions: ["The model is illustrative."],
    controls: [],
    outputs: [],
    interactions: ["Adjust controls and observe the scene update"],
    animation: { enabled: true, canPause: true, canReset: true },
    dataRequirements: [],
    assetRequirements: [],
    accessibilityRequirements: ["Every control has a label", "The scene has a non-visual description"],
    sourceReferences: [],
  };
}

function packageFor(mode, title, definition) {
  return {
    schemaVersion: 1,
    manifest: {
      schemaVersion: 1,
      artifactType: "interactive-visualizer",
      title,
      description: `Interactive ${title.toLowerCase()} model.`,
      accessibilityDescription: `A controllable ${title.toLowerCase()} visualization.`,
      mode,
      entry: "index.html",
      runtime: {
        id: "breadboard-interactive-visualizer",
        version: "1.0.0",
        ...(mode !== "2d" ? { threeVersion: "0.185.1" } : {}),
      },
    },
    assumptions: ["The model is illustrative and uses bounded inputs."],
    limitations: ["The visualizer prioritizes explanation over measurement precision."],
    sourceReferences: [],
    semanticTests: [{ name: "finite state", assertion: "Displayed numerical values remain finite." }],
    assets: [],
    files: {
      "index.html": '<!doctype html><html><body><main id="app"></main></body></html>',
      "styles.css": "#app { min-height: 100%; }",
      "main.ts": `${sdkImport}export default defineVisualizer(${JSON.stringify(definition, null, 2)})\n`,
    },
  };
}

function customWaveFixture() {
  const title = "Wave pulse boundary reflection";
  const visualPlan = plan("2d", title);
  const packageValue = {
    schemaVersion: 2,
    manifest: {
      schemaVersion: 2,
      artifactType: "interactive-visualizer",
      title,
      description: "Play a pulse reflecting from a fixed boundary.",
      accessibilityDescription: "An animated pulse travels toward a fixed boundary and returns inverted.",
      mode: "2d",
      entry: "index.html",
      runtime: { id: "breadboard-interactive-visualizer", version: "2.0.0" },
    },
    assumptions: ["The pulse travels without dispersion."],
    limitations: ["The model shows one idealized reflection."],
    sourceReferences: [],
    semanticTests: [
      { name: "finite wave", assertion: "Every plotted coordinate remains finite." },
      { name: "visual integrity", assertion: "The wave, boundary, labels, and controls stay aligned, legible, and unclipped." },
    ],
    assets: [],
    files: {
      "index.html": `<main id="app"><header><h1>${title}</h1><div class="tools"><button data-action="play-pause" aria-label="Pause animation" aria-pressed="true"><svg class="play" viewBox="0 0 24 24" aria-hidden="true" hidden><path d="M8 5v14l11-7z"></path></svg><svg class="pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg></button><button data-action="reset" aria-label="Reset animation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 11V5m0 6h-6"></path></svg></button></div></header><section class="stage" aria-label="Animated wave reflection"><canvas></canvas></section><script src="main.js"></script></main>`,
      "styles.css": `#app{display:grid;gap:18px}header{display:flex;align-items:center;justify-content:space-between}h1{margin:0;font-size:30px;font-weight:450}.tools{display:flex;gap:10px}.tools button{width:50px;height:50px;border:0;border-radius:50%;background:var(--viz-control)}.tools button:first-child{background:var(--viz-accent);color:var(--viz-accent-text)}.stage{height:430px;background:var(--viz-panel)}canvas{width:100%;height:100%}@media(max-width:600px){h1{font-size:23px}.stage{height:320px}}`,
      "main.js": `const canvas=document.querySelector("canvas");const ctx=canvas.getContext("2d");const pause=document.querySelector('[data-action="play-pause"]');const playIcon=pause.querySelector(".play");const pauseIcon=pause.querySelector(".pause");const reset=document.querySelector('[data-action="reset"]');const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;let running=!reduced;let phase=0;function sync(){playIcon.hidden=running;pauseIcon.hidden=!running;pause.setAttribute("aria-pressed",String(running));pause.setAttribute("aria-label",running?"Pause animation":"Play animation")}function size(){const ratio=Math.min(devicePixelRatio||1,2);const rect=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.floor(rect.width*ratio));canvas.height=Math.max(1,Math.floor(rect.height*ratio));ctx.setTransform(ratio,0,0,ratio,0,0)}function draw(){const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--viz-text");ctx.lineWidth=3;ctx.beginPath();for(let x=0;x<=w;x+=3){const center=(phase%(w+180))-90;const d=(x-center)/42;const y=h/2+70*Math.exp(-d*d)*(center>w/2?-1:1);if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.stroke()}function tick(){if(running&&!document.hidden)phase+=2;draw();requestAnimationFrame(tick)}pause.addEventListener("click",()=>{running=!running;sync()});reset.addEventListener("click",()=>{phase=0;draw()});addEventListener("breadboard:themechange",draw);new ResizeObserver(size).observe(canvas);sync();size();requestAnimationFrame(tick);`,
    },
  };
  return { plan: visualPlan, package: packageValue };
}

function customThreeFixture() {
  const title = "Frenet–Serret geometry";
  const visualPlan = plan("3d", title);
  const packageValue = {
    schemaVersion: 2,
    manifest: {
      schemaVersion: 2,
      artifactType: "interactive-visualizer",
      title,
      description: "Rotate a spatial curve and inspect its moving frame.",
      accessibilityDescription: "A rotating white space curve with three colored frame axes.",
      mode: "3d",
      entry: "index.html",
      runtime: {
        id: "breadboard-interactive-visualizer",
        version: "2.0.0",
        threeVersion: "0.185.1",
      },
    },
    assumptions: ["The curve is an illustrative helix."],
    limitations: ["The frame is sampled at one point."],
    sourceReferences: [],
    semanticTests: [
      { name: "finite frame", assertion: "The rendered transforms remain finite." },
      { name: "visual integrity", assertion: "The curve, frame axes, labels, and controls remain aligned, legible, and unclipped." },
    ],
    assets: [],
    files: {
      "index.html": `<main id="app"><header><h1>${title}</h1><div><button data-action="play-pause" aria-label="Pause rotation" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg></button><button data-action="reset" aria-label="Reset view"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 11V5m0 6h-6"></path></svg></button></div></header><section><canvas aria-label="Rotating three dimensional curve"></canvas></section><script src="main.js"></script></main>`,
      "styles.css": `#app{display:grid;gap:18px}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{margin:0;font-size:30px;font-weight:450}header div{display:flex;gap:8px}button{border:0;border-radius:999px;background:var(--viz-control);padding:12px 16px}button:first-child{background:var(--viz-accent);color:var(--viz-accent-text)}section{height:430px;background:var(--viz-panel)}canvas{width:100%;height:100%}@media(max-width:600px){h1{font-size:21px}button{padding:8px;font-size:11px}section{height:320px}}`,
      "main.js": `const canvas=document.querySelector("canvas");const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(40,1,.1,100);camera.position.set(5,4,7);camera.lookAt(0,0,0);const points=[];for(let i=0;i<180;i++){const t=i/179*Math.PI*4;points.push(new THREE.Vector3(Math.cos(t)*2,(i/179-0.5)*3,Math.sin(t)*2))}const curve=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xf5f5f2}));scene.add(curve);scene.add(new THREE.GridHelper(8,16,0x6d7380,0x343840));let running=!matchMedia("(prefers-reduced-motion: reduce)").matches;const pause=document.querySelector('[data-action="play-pause"]');const sync=()=>{pause.setAttribute("aria-pressed",String(running));pause.setAttribute("aria-label",running?"Pause rotation":"Play rotation")};pause.addEventListener("click",()=>{running=!running;sync()});document.querySelector('[data-action="reset"]').addEventListener("click",()=>{scene.rotation.set(0,0,0)});function resize(){const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix()}function frame(){if(running&&!document.hidden)scene.rotation.y+=.006;renderer.render(scene,camera);requestAnimationFrame(frame)}addEventListener("breadboard:themechange",()=>renderer.render(scene,camera));new ResizeObserver(resize).observe(canvas);sync();resize();requestAnimationFrame(frame);`,
    },
  };
  return { plan: visualPlan, package: packageValue };
}

const input = (id) => ({ kind: "input", id });
const constant = (value) => ({ kind: "constant", value });
const binary = (op, left, right) => ({ kind: "binary", op, left, right });
const unary = (op, argument) => ({ kind: "unary", op, argument });

function exponentialFixture() {
  const title = "Exponential growth";
  const definition = {
    schemaVersion: 1,
    title,
    description: "Change the initial population and growth rate.",
    controls: [
      { id: "initial", label: "Initial population", type: "slider", min: 1, max: 20, step: 1, defaultValue: 4 },
      { id: "rate", label: "Growth rate", type: "slider", min: 0.01, max: 0.8, step: 0.01, defaultValue: 0.24 },
    ],
    outputs: [{
      id: "atTen",
      label: "Population at t=10",
      expression: binary("multiply", input("initial"), unary("exp", binary("multiply", input("rate"), constant(10)))),
      precision: 1,
    }],
    scenes: [{
      kind: "plot2d",
      title: "Population over time",
      xLabel: "Time",
      yLabel: "Population",
      xMin: 0,
      xMax: 10,
      samples: 120,
      series: [{
        id: "growth",
        label: "Population",
        color: "#56735b",
        expression: binary("multiply", input("initial"), unary("exp", binary("multiply", input("rate"), input("x")))),
      }],
    }],
  };
  return { plan: plan("2d", title), package: packageFor("2d", title, definition) };
}

function pendulumFixture() {
  const title = "Double pendulum";
  const controls = [
    ["gravity", "Gravity", 1, 20, .1, 9.81],
    ["length1", "Upper arm length", .3, 2, .05, 1],
    ["length2", "Lower arm length", .3, 2, .05, 1],
    ["mass1", "Upper mass", .2, 3, .1, 1],
    ["mass2", "Lower mass", .2, 3, .1, 1],
    ["angle1", "Upper angle", -.9, .9, .01, .55],
    ["angle2", "Lower angle", -.9, .9, .01, -.35],
    ["speed", "Animation speed", .1, 3, .1, 1],
  ].map(([id, label, min, max, step, defaultValue]) => ({
    id, label, type: "slider", min, max, step, defaultValue,
  }));
  const definition = {
    schemaVersion: 1,
    title,
    description: "Adjust physical parameters and observe coupled nonlinear motion.",
    controls,
    outputs: [],
    scenes: [{
      kind: "double-pendulum",
      title: "Coupled motion",
      gravityInput: "gravity",
      length1Input: "length1",
      length2Input: "length2",
      mass1Input: "mass1",
      mass2Input: "mass2",
      angle1Input: "angle1",
      angle2Input: "angle2",
      speedInput: "speed",
      trail: true,
    }],
    animation: { autoplay: true, durationMs: 10_000, loop: true },
  };
  return { plan: plan("2d", title), package: packageFor("2d", title, definition) };
}

function orbitFixture() {
  const title = "3D orbital simulation";
  const definition = {
    schemaVersion: 1,
    title,
    description: "Drag to orbit the camera, zoom, and change gravity or initial velocity.",
    controls: [
      { id: "gravity", label: "Gravity", type: "slider", min: 0.25, max: 2.5, step: 0.05, defaultValue: 1, unit: "×" },
      { id: "velocity", label: "Initial velocity", type: "slider", min: 0.25, max: 2.5, step: 0.05, defaultValue: 1, unit: "×" },
      { id: "timeScale", label: "Time scale", type: "slider", min: 0.1, max: 4, step: 0.1, defaultValue: 1 },
      { id: "trails", label: "Show orbit paths", type: "toggle", defaultValue: true },
      { id: "vectors", label: "Show velocity arrows", type: "toggle", defaultValue: true },
    ],
    outputs: [],
    scenes: [{
      kind: "orbit3d",
      title: "Orbital system",
      timeScaleInput: "timeScale",
      gravityInput: "gravity",
      initialVelocityInput: "velocity",
      showTrailsInput: "trails",
      showVelocityVectorsInput: "vectors",
      trailSamples: 10,
      centralBody: { label: "Star", color: "#e8b755", radius: 1.5 },
      bodies: [
        { id: "inner", label: "Inner planet", color: "#6f9fc1", radius: .45, distance: 4, orbitSpeed: .8 },
        { id: "outer", label: "Outer planet", color: "#b67f62", radius: .7, distance: 7, orbitSpeed: .42, inclination: .22 },
      ],
    }],
    animation: { autoplay: true, durationMs: 12_000, loop: true },
  };
  return { plan: plan("3d", title), package: packageFor("3d", title, definition) };
}

async function compiledBundle(fixture) {
  const compiled = compileInteractiveVisualizerPackage(fixture.plan, fixture.package);
  assert.equal(compiled.validation.valid, true, compiled.validation.errors.join("\n"));
  assert.ok(compiled.definition);
  assert.ok(compiled.manifest);
  const bundle = await bundleInteractiveVisualizer({
    definition: compiled.definition,
    manifest: compiled.manifest,
    html: compiled.html,
    css: compiled.css,
  });
  assert.match(bundle.html, /Content-Security-Policy/);
  assert.doesNotMatch(bundle.html, /(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:/i);
  return { compiled, bundle };
}

test("exponential growth compiles as a deterministic 2D artifact", async () => {
  const first = await compiledBundle(exponentialFixture());
  const second = await compiledBundle(exponentialFixture());
  assert.equal(first.bundle.hash, second.bundle.hash);
  assert.equal(first.compiled.manifest.mode, "2d");
  assert.equal(first.bundle.html.includes("threeVersion"), false);
});

test("schema-2 custom visualizers publish a flat prompt-specific mini-app", async () => {
  const fixture = customWaveFixture();
  const compiled = compileCustomInteractiveVisualizerPackage(fixture.plan, fixture.package);
  assert.equal(compiled.validation.valid, true, compiled.validation.errors.join("\n"));
  assert.ok(compiled.package);
  const bundle = await bundleCustomInteractiveVisualizer(compiled.package);
  assert.match(bundle.html, /breadboard:interactive-visualizer:v1/);
  assert.match(bundle.html, /--viz-accent/);
  assert.doesNotMatch(bundle.html, /connect-src (?!'none')/);
  assert.doesNotMatch(fixture.package.files["styles.css"], /box-shadow|gradient/i);

  const unsafe = structuredClone(fixture.package);
  unsafe.files["main.js"] += '\nfetch("https://example.com")';
  const rejected = compileCustomInteractiveVisualizerPackage(fixture.plan, unsafe);
  assert.equal(rejected.validation.valid, false);
  assert.match(rejected.validation.errors.join("\n"), /external|fetch/i);
});

test("schema-2 accepts its local stylesheet convention without weakening host isolation", async () => {
  const fixture = customThreeFixture();
  fixture.package.files["index.html"] = `<!doctype html><html><head><link rel="stylesheet" href="styles.css"><style>.head-only{color:var(--viz-text)}</style></head><body>${fixture.package.files["index.html"]}</body></html>`;
  fixture.package.files["main.js"] += `
const rawTop=14,maxTop=24;
const top=Math.min(Math.max(7,rawTop),maxTop);
const tooltip=document.createElement("div");
tooltip.style.transform=\`translate(0px, \${top}px)\`;
const threeParent=scene.parent;
void threeParent;`;

  const compiled = compileCustomInteractiveVisualizerPackage(
    fixture.plan,
    fixture.package,
  );
  assert.equal(compiled.validation.valid, true, compiled.validation.errors.join("\n"));
  assert.ok(compiled.package);
  const bundle = await bundleCustomInteractiveVisualizer(compiled.package);
  assert.equal((bundle.html.match(/<!doctype html>/gi) ?? []).length, 1);
  assert.equal((bundle.html.match(/<html\b/gi) ?? []).length, 1);
  assert.doesNotMatch(bundle.html, /<link\b[^>]*styles\.css/i);
  assert.match(bundle.html, /#app\{display:grid/);
  assert.match(bundle.html, /\.head-only\{color:var\(--viz-text\)\}/);

  for (const escape of [
    "window.parent.document.body",
    'globalThis["top"].location',
    "self.opener",
    "top.location.href",
  ]) {
    const unsafe = structuredClone(fixture.package);
    unsafe.files["main.js"] += `\n${escape};`;
    const rejected = compileCustomInteractiveVisualizerPackage(fixture.plan, unsafe);
    assert.equal(rejected.validation.valid, false, escape);
    assert.match(rejected.validation.errors.join("\n"), /embedding page/i, escape);
  }

  const otherStylesheet = structuredClone(fixture.package);
  otherStylesheet.files["index.html"] = otherStylesheet.files["index.html"].replace(
    'href="styles.css"',
    'href="other.css"',
  );
  assert.match(
    compileCustomInteractiveVisualizerPackage(fixture.plan, otherStylesheet)
      .validation.errors.join("\n"),
    /forbidden embedded or navigational element/i,
  );

  const unsafeInlineStyle = structuredClone(fixture.package);
  unsafeInlineStyle.files["index.html"] = unsafeInlineStyle.files["index.html"].replace(
    ".head-only{color:var(--viz-text)}",
    ".head-only{background:linear-gradient(red,blue)}",
  );
  assert.match(
    compileCustomInteractiveVisualizerPackage(fixture.plan, unsafeInlineStyle)
      .validation.errors.join("\n"),
    /decorative gradients/i,
  );
});

test("browser output capture preserves DOM markers when a dump exceeds 750k", () => {
  const opening = '<html data-breadboard-runtime-tests="passed" data-breadboard-interaction-tests="passed" data-breadboard-webgl="ready">';
  const output = appendBoundedBrowserOutput(
    "",
    `${opening}${"x".repeat(800_000)}</html>`,
  );
  assert.match(output, /data-breadboard-runtime-tests="passed"/);
  assert.match(output, /data-breadboard-interaction-tests="passed"/);
  assert.match(output, /data-breadboard-webgl="ready"/);
  assert.match(output, /<\/html>$/);
  assert.ok(output.length <= 750_000);
});

test("owned browser profile cleanup retries transient Windows release races and fails closed", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-profile-cleanup-test-"));
  const realRemove = fs.rmSync.bind(fs);
  try {
    const recoveredProfile = fs.mkdtempSync(path.join(outputDir, ".browser-profile-"));
    let recoveredAttempts = 0;
    let recoveredElapsedMs = 0;
    await removeOwnedBrowserProfile(outputDir, recoveredProfile, {
      platform: "win32",
      now: () => recoveredElapsedMs,
      wait: async (milliseconds) => {
        recoveredElapsedMs += milliseconds;
      },
      remove: (target, options) => {
        recoveredAttempts += 1;
        if (recoveredAttempts <= 3) {
          const error = new Error("The browser profile is still releasing handles.");
          error.code = "EPERM";
          throw error;
        }
        realRemove(target, options);
      },
    });
    assert.equal(recoveredAttempts, 4);
    assert.equal(fs.existsSync(recoveredProfile), false);
    assert.ok(recoveredElapsedMs > 0 && recoveredElapsedMs < 5_000);

    const lockedProfile = fs.mkdtempSync(path.join(outputDir, ".browser-profile-"));
    let lockedElapsedMs = 0;
    await assert.rejects(
      removeOwnedBrowserProfile(outputDir, lockedProfile, {
        platform: "win32",
        now: () => lockedElapsedMs,
        wait: async (milliseconds) => {
          lockedElapsedMs += milliseconds;
        },
        remove: () => {
          const error = new Error("The browser profile remained locked.");
          error.code = "EPERM";
          throw error;
        },
      }),
      /remained locked/,
    );
    assert.equal(lockedElapsedMs, 5_000);
    assert.equal(fs.existsSync(lockedProfile), true);
  } finally {
    realRemove(outputDir, { recursive: true, force: true });
  }
});

test("schema-2 rejects theme-breaking text, ambiguous transport controls, and unreviewed geometry", () => {
  const fixture = customWaveFixture();

  const fixedTheme = structuredClone(fixture.package);
  fixedTheme.files["styles.css"] += "\nh1{color:#fff}";
  assert.match(
    compileCustomInteractiveVisualizerPackage(fixture.plan, fixedTheme)
      .validation.errors.join("\n"),
    /host token|fixed light\/dark color/i,
  );

  const glyphControl = structuredClone(fixture.package);
  glyphControl.files["index.html"] = glyphControl.files["index.html"].replace(
    /<button data-action="play-pause"[\s\S]*?<\/button>/,
    '<button data-action="play-pause" aria-label="Pause animation" aria-pressed="true">Pause</button>',
  );
  assert.match(
    compileCustomInteractiveVisualizerPackage(fixture.plan, glyphControl)
      .validation.errors.join("\n"),
    /inline SVG icon/i,
  );

  const uncheckedGeometry = structuredClone(fixture.package);
  uncheckedGeometry.semanticTests = uncheckedGeometry.semanticTests.filter(
    (entry) => entry.name !== "visual integrity",
  );
  assert.match(
    compileCustomInteractiveVisualizerPackage(fixture.plan, uncheckedGeometry)
      .validation.errors.join("\n"),
    /visual-integrity assertion/i,
  );
});

test("schema-2 custom visualizers pass the real responsive browser gate", { timeout: 90_000 }, async () => {
  const fixture = customWaveFixture();
  fixture.package.files["index.html"] = fixture.package.files["index.html"].replace(
    '<script src="main.js"></script>',
    `<p class="sr-only">${"A detailed accessible description. ".repeat(40)}</p><script src="main.js"></script>`,
  );
  fixture.package.files["styles.css"] +=
    ".sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";
  const compiled = compileCustomInteractiveVisualizerPackage(fixture.plan, fixture.package);
  assert.ok(compiled.package, compiled.validation.errors.join("\n"));
  const bundle = await bundleCustomInteractiveVisualizer(compiled.package);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-custom-visualizer-test-"));
  try {
    const result = await runInteractiveVisualizerBrowserTests({
      html: bundle.html,
      mode: "2d",
      outputDir,
      runtimeSessionId: 91_003,
    });
    assert.equal(result.passed, true, JSON.stringify(result.checks, null, 2));
    assert.equal(
      result.checks
        .filter((check) => /^(browser mount|desktop preview|mobile preview)/.test(check.name))
        .every((check) => /process tree closed/.test(check.detail)),
      true,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("schema-2 custom visualizers receive pinned Three.js and an accessible WebGL fallback", { timeout: 90_000 }, async () => {
  const fixture = customThreeFixture();
  const compiled = compileCustomInteractiveVisualizerPackage(fixture.plan, fixture.package);
  assert.ok(compiled.package, compiled.validation.errors.join("\n"));
  const bundle = await bundleCustomInteractiveVisualizer(compiled.package);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-custom-three-test-"));
  try {
    const result = await runInteractiveVisualizerBrowserTests({
      html: bundle.html,
      mode: "3d",
      outputDir,
      runtimeSessionId: 91_004,
    });
    assert.equal(result.passed, true, JSON.stringify(result.checks, null, 2));
    const fallback = result.checks.find(
      (check) => check.name === "WebGL unavailable fallback",
    );
    assert.equal(fallback?.passed, true);
    assert.match(fallback?.detail ?? "", /Accessible fallback rendered.*process tree closed/);
    assert.equal(
      result.checks
        .filter((check) => /^(browser mount|desktop preview|mobile preview)/.test(check.name))
        .every((check) => /process tree closed/.test(check.detail)),
      true,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("diagram constant-expression sizes are canonicalized to static numbers", () => {
  const title = "Spring damper diagram";
  const definition = {
    schemaVersion: 1,
    title,
    description: "A labelled spring damper schematic.",
    controls: [],
    outputs: [],
    scenes: [{
      kind: "diagram2d",
      title: "Mechanism",
      width: 760,
      height: 360,
      elements: [{
        id: "support",
        kind: "rect",
        label: "Fixed support",
        x: constant(70),
        y: constant(25),
        width: constant(620),
        height: constant(20),
        color: "#334155",
      }],
    }],
  };
  const compiled = compileInteractiveVisualizerPackage(
    plan("2d", title),
    packageFor("2d", title, definition),
  );
  assert.equal(compiled.validation.valid, true, compiled.validation.errors.join("\n"));
  assert.equal(compiled.definition.scenes[0].elements[0].width, 620);
  assert.equal(compiled.definition.scenes[0].elements[0].height, 20);
});

test("double pendulum mounts and exercises controls in a real browser", { timeout: 90_000 }, async () => {
  const { bundle } = await compiledBundle(pendulumFixture());
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-pendulum-test-"));
  try {
    const result = await runInteractiveVisualizerBrowserTests({
      html: bundle.html,
      mode: "2d",
      outputDir,
      runtimeSessionId: 91_001,
    });
    assert.equal(result.passed, true, JSON.stringify(result.checks, null, 2));
    assert.equal(result.screenshotCreated, true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("local pinned Three.js orbital simulation passes the real 3D browser gate", { timeout: 90_000 }, async () => {
  const { compiled, bundle } = await compiledBundle(orbitFixture());
  assert.equal(compiled.manifest.runtime.threeVersion, "0.185.1");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-orbit-test-"));
  try {
    const result = await runInteractiveVisualizerBrowserTests({
      html: bundle.html,
      mode: "3d",
      outputDir,
      runtimeSessionId: 91_002,
    });
    assert.equal(result.passed, true, JSON.stringify(result.checks, null, 2));
    assert.equal(result.screenshotCreated, true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("AST, HTML, and CSS validators block active capabilities and external resources", () => {
  const fixture = exponentialFixture();
  fixture.package.files["main.ts"] = `${sdkImport}fetch("https://example.com")\nexport default defineVisualizer({})`;
  fixture.package.files["index.html"] = '<main id="app"><script>alert(1)</script></main>';
  fixture.package.files["styles.css"] = '#app{background:url("https://example.com/pixel") }';
  const compiled = compileInteractiveVisualizerPackage(fixture.plan, fixture.package);
  assert.equal(compiled.validation.valid, false);
  assert.match(compiled.validation.errors.join("\n"), /fetch/);
  assert.match(compiled.validation.errors.join("\n"), /script|passive shell/);
  assert.match(compiled.validation.errors.join("\n"), /network|external/i);
});

test("malicious packages and pathological resource requests are rejected before bundling", () => {
  const sources = [
    'fetch("https://example.com")',
    'new WebSocket("wss://example.com")',
    "document.cookie",
    "localStorage.getItem('x')",
    "eval('1')",
    "new Function('return 1')",
    "import('three')",
    "WebAssembly.instantiate(new Uint8Array())",
    "new Worker('worker.js')",
    "window.open('https://example.com')",
    "Object.prototype.polluted = true",
    "while (true) {}",
  ];
  for (const malicious of sources) {
    const fixture = exponentialFixture();
    fixture.package.files["main.ts"] =
      `${sdkImport}${malicious}\nexport default defineVisualizer({})`;
    const compiled = compileInteractiveVisualizerPackage(fixture.plan, fixture.package);
    assert.equal(compiled.validation.valid, false, malicious);
  }

  for (const html of [
    '<main id="app"><form action="/escape"></form></main>',
    '<main id="app"><img src="https://example.com/pixel.png"></main>',
    '<main id="app"><script src="https://example.com/app.js"></script></main>',
    '<main id="app"><iframe srcdoc="<script>top.location=/</script>"></iframe></main>',
  ]) {
    const fixture = exponentialFixture();
    fixture.package.files["index.html"] = html;
    assert.equal(
      compileInteractiveVisualizerPackage(fixture.plan, fixture.package).validation.valid,
      false,
      html,
    );
  }

  const asset = exponentialFixture();
  asset.package.assets = [{ path: "oversized.bin", sizeBytes: 50_000_000 }];
  assert.equal(compileInteractiveVisualizerPackage(asset.plan, asset.package).validation.valid, false);

  const oversized = exponentialFixture();
  oversized.package.files["main.ts"] = `${sdkImport}//${"x".repeat(90_000)}`;
  assert.match(
    compileInteractiveVisualizerPackage(oversized.plan, oversized.package).validation.errors.join("\n"),
    /exceeds/,
  );

  const geometry = orbitFixture();
  geometry.package.manifest.mode = "3d";
  const definition = JSON.parse(
    geometry.package.files["main.ts"].slice(
      geometry.package.files["main.ts"].indexOf("defineVisualizer(") + "defineVisualizer(".length,
      geometry.package.files["main.ts"].lastIndexOf(")"),
    ),
  );
  definition.scenes[0].bodies = Array.from({ length: 17 }, (_, index) => ({
    id: `body${index}`,
    label: `Body ${index}`,
    color: "#6688aa",
    radius: 1,
    distance: index + 2,
    orbitSpeed: 0.1,
  }));
  geometry.package.files["main.ts"] =
    `${sdkImport}export default defineVisualizer(${JSON.stringify(definition)})`;
  assert.match(
    compileInteractiveVisualizerPackage(geometry.plan, geometry.package).validation.errors.join("\n"),
    /1-16 bodies/,
  );
});

test("browser testing can be cancelled and terminates its active process tree", { timeout: 45_000 }, async () => {
  const { bundle } = await compiledBundle(pendulumFixture());
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-cancel-test-"));
  const controller = new AbortController();
  try {
    const work = runInteractiveVisualizerBrowserTests({
      html: bundle.html,
      mode: "2d",
      outputDir,
      signal: controller.signal,
    });
    const rejected = assert.rejects(work, /cancel/i);
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort(new Error("interactive visualizer cancelled by user"));
    await rejected;
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

function artifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-interactive-artifact-"));
  const database = new Database(path.join(root, "artifact.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1);
    INSERT INTO conversations VALUES (10, 'conv_terminal', 1, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run_one', 20), ('run_two', 20), ('run_three', 20);
  `);
  ensureArtifactSchema(database);
  return { root, storage: path.join(root, "storage"), database };
}

test("validated publication, failed revision preservation, and rollback use canonical artifact versions", () => {
  const fixture = artifactFixture();
  try {
    let artifact = createArtifact({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 10,
      clusterId: null,
      runId: "run_one",
      assistantMessageId: null,
      surface: "dashboard_terminal",
      kind: "html",
      rendererId: "interactive-visualizer",
      title: "Growth",
      content: '{"plan":"pending"}',
      metadata: { artifactType: "interactive-visualizer" },
      sourceSkill: "interactive-visualizer",
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    artifact = publishValidatedArtifactVersion({
      artifact,
      version: 1,
      expectedCurrentVersion: 1,
      sourceContent: '{"version":1}',
      outputContent: "<!doctype html><main>v1</main>",
      metadata: { artifactType: "interactive-visualizer", interactiveVisualizer: { manifest: { version: 1 } } },
      runId: "run_one",
      assistantMessageId: null,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(artifact.current_version, 1);
    assert.equal(artifact.status, "ready");

    // A rejected v2 candidate never calls publication and therefore cannot
    // replace or corrupt the active v1 record.
    const rejected = compileInteractiveVisualizerPackage(
      exponentialFixture().plan,
      { ...exponentialFixture().package, files: { ...exponentialFixture().package.files, "main.ts": "fetch('https://invalid')" } },
    );
    assert.equal(rejected.validation.valid, false);
    assert.equal(artifact.current_version, 1);

    artifact = publishValidatedArtifactVersion({
      artifact,
      version: 2,
      expectedCurrentVersion: 1,
      sourceContent: '{"version":2}',
      outputContent: "<!doctype html><main>v2</main>",
      metadata: { artifactType: "interactive-visualizer", interactiveVisualizer: { manifest: { version: 2 } } },
      runId: "run_two",
      assistantMessageId: null,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(artifact.current_version, 2);

    artifact = activateArtifactVersion({
      artifact,
      version: 1,
      runId: "run_three",
      assistantMessageId: null,
      database: fixture.database,
    });
    assert.equal(artifact.current_version, 1);
    assert.equal(
      fixture.database.prepare("SELECT COUNT(*) AS count FROM hermes_artifact_versions WHERE artifact_id = ?").get(artifact.id).count,
      2,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("first-party skill and tools are available only to authenticated Terminal and Garden", () => {
  const terminalSkills = listFirstPartySkills("dashboard_terminal");
  const gardenSkills = listFirstPartySkills("garden_chat");
  const quartzSkills = listFirstPartySkills("quartz_ai");
  assert.equal(terminalSkills.some((skill) => skill.slug === "interactive-visualizer" && skill.availability === "ready"), true);
  assert.equal(gardenSkills.some((skill) => skill.slug === "interactive-visualizer" && skill.availability === "ready"), true);
  assert.equal(
    quartzSkills.some((skill) =>
      skill.slug === "interactive-visualizer" && skill.availability === "ready"),
    false,
  );

  const grant = (surface, userId) => brokerCapabilities({
    plan: planTask({ request: "Create an interactive visualization", authenticated: userId !== null }),
    surface,
    userId,
    grants: [],
    workspaceRoot: "/runtime/session",
    isolated: surface === "quartz_ai",
  }).allowedTools;
  assert.equal(grant("dashboard_terminal", 1).interactive_visualizer_create, true);
  assert.equal(grant("garden_chat", 1).interactive_visualizer_create, true);
  assert.equal(grant("quartz_ai", null).interactive_visualizer_create, false);
  assert.equal(grant("dashboard_terminal", 1).interactive_visualizer_generate, true);
  assert.equal(grant("garden_chat", 1).interactive_visualizer_generate, true);
  assert.equal(grant("quartz_ai", null).interactive_visualizer_generate, false);

  const hermesPlugin = fs.readFileSync(
    new URL("../../hermes-agent/plugins/breadboard/__init__.py", import.meta.url),
    "utf8",
  );
  const hermesManifest = fs.readFileSync(
    new URL("../../hermes-agent/plugins/breadboard/plugin.yaml", import.meta.url),
    "utf8",
  );
  for (const tool of [
    "interactive_visualizer_create",
    "interactive_visualizer_plan",
    "interactive_visualizer_generate",
    "interactive_visualizer_revise",
    "interactive_visualizer_rollback",
    "interactive_visualizer_cancel",
  ]) {
    assert.match(hermesPlugin, new RegExp(`"${tool}"`));
    assert.match(hermesManifest, new RegExp(`- ${tool}`));
  }
});

test("visualization intent selects the reviewed skill automatically without widening Quartz", async () => {
  const prompts = [
    "Show me how a double pendulum works. Let me change gravity and both arm lengths.",
    "Create an interactive 3D model showing how the Moon orbits Earth.",
    "Visualize exponential growth with adjustable starting value and growth rate.",
  ];
  for (const text of prompts) {
    assert.equal(shouldAutoSelectInteractiveVisualizer({
      text,
      surface: "garden_chat",
      authenticated: true,
    }), true);
  }
  assert.equal(shouldAutoSelectInteractiveVisualizer({
    text: "Generate a static image of the Moon.",
    surface: "garden_chat",
    authenticated: true,
  }), false);
  assert.equal(shouldAutoSelectInteractiveVisualizer({
    text: prompts[1],
    surface: "quartz_ai",
    authenticated: true,
  }), false);
  assert.equal(shouldAutoSelectInteractiveVisualizer({
    text: prompts[1],
    surface: "garden_chat",
    authenticated: true,
    env: { INTERACTIVE_VISUALIZER_ENABLED: "false" },
  }), false);
  const command = visualizerCommandText({
    text: prompts[2],
    surface: "dashboard_terminal",
    authenticated: true,
  });
  assert.equal(command.automatic, true);
  const retry = visualizerCommandText({
    text: "can you retry?",
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages: [{
      role: "assistant",
      content: "The interactive visualizer renderer rejected the diagram schema.",
    }],
  });
  assert.equal(retry.automatic, true);
  assert.match(retry.text, /^\/interactive-visualizer /);
  assert.equal(visualizerCommandText({
    text: "can you retry?",
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages: [{ role: "assistant", content: "The PDF export failed." }],
  }).automatic, false);
  // A Deep Research report handed back for synthesis is not a request. Its own
  // vocabulary used to select the skill — and the selection made a visualizer
  // mandatory for a turn that was only ever asked to summarise.
  const handback = [
    "Deep Research finished. This is its result, handed back to you:",
    "",
    "The highest return comes from software infrastructure layers such as fleet",
    "orchestration, simulation tooling and managed teleoperation, where control",
    "software rather than hardware carries the margin.",
  ].join("\n");
  assert.equal(shouldAutoSelectInteractiveVisualizer({
    text: handback,
    surface: "dashboard_terminal",
    authenticated: true,
  }), true);
  assert.equal(shouldAutoSelectInteractiveVisualizer({
    text: handback,
    surface: "dashboard_terminal",
    authenticated: true,
    internalContinuation: true,
  }), false);
  const continuation = visualizerCommandText({
    text: handback,
    surface: "dashboard_terminal",
    authenticated: true,
    internalContinuation: true,
  });
  assert.equal(continuation.automatic, false);
  assert.equal(continuation.text, handback);
  assert.equal(visualizerCommandText({
    text: "can you retry?",
    surface: "dashboard_terminal",
    authenticated: true,
    internalContinuation: true,
    priorMessages: [{
      role: "assistant",
      content: "The interactive visualizer renderer rejected the diagram schema.",
    }],
  }).automatic, false);
  const resolved = await resolveCommandMessage(1, command.text, process.cwd(), {
    mode: "knowledge",
    surface: "dashboard_terminal",
  });
  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    ["interactive-visualizer"],
  );
  assert.match(resolved.text, /Reviewed skill guidance: interactive-visualizer/);
  assert.equal(interactiveVisualizerConfig({
    INTERACTIVE_VISUALIZER_MAX_ATTEMPTS: "99",
  }).maxAttempts, 3);
});

test("viewer uses an opaque-origin script-only sandbox and strict message validation", () => {
  const viewer = fs.readFileSync(new URL("../src/app/components/hermes/artifact-viewer.tsx", import.meta.url), "utf8");
  const preview = fs.readFileSync(new URL("../src/app/api/hermes/artifacts/[artifactId]/preview/route.ts", import.meta.url), "utf8");
  assert.match(viewer, /sandbox="allow-scripts"/);
  assert.match(viewer, /event\.origin !== "null"/);
  assert.match(viewer, /event\.source !== frame\.contentWindow/);
  assert.match(viewer, /data\.protocol !== protocol/);
  assert.match(viewer, /data\.channel !== interactiveChannel/);
  assert.match(preview, /connect-src 'none'/);
  assert.match(preview, /worker-src 'none'/);
  assert.match(preview, /Permissions-Policy/);
});
