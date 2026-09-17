import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import {
  compileGardenVisualization,
  compileGeneratedVisualization,
} from "../src/lib/generated-visual-compiler.ts";
import { isLearnNativeVisualizer } from "../src/lib/learn-native-visualizer-contract.ts";
import {
  learnVisualizerAuthorPrompt,
  learnVisualRepairInstruction,
  loadLearnVisualizerSkill,
  parseLearnVisualizerResponse,
} from "../src/lib/learn-native-visualizer.ts";
import { runGeneratedVisualBrowserTestsLocally } from "../src/lib/generated-visual-browser-tests.ts";
import { verifyLearnPagePreservation } from "../src/lib/learn-visualizer-publication.ts";

function nativeFixture({ frozen = false, inert = false } = {}) {
  const icon =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3L17 10L5 17Z" fill="currentColor"/></svg>';
  return {
    sourceSkill: "interactive-visualizer-in-chat",
    skillHash: "a".repeat(64),
    plan: {
      schemaVersion: 1,
      title: "Phase and angular speed",
      objective: "See phase advance and speed change",
      mode: "2d",
      rationale: "A moving phase marker makes angular speed visible",
      concepts: ["phase"],
      assumptions: ["normalized radius"],
      controls: [
        {
          id: "speed",
          label: "Angular speed",
          type: "range",
          purpose: "Change angular speed",
        },
      ],
      outputs: [],
      interactions: ["Adjust speed and follow the marker"],
      animation: { enabled: true, canPause: true, canReset: true },
      dataRequirements: [],
      assetRequirements: [],
      accessibilityRequirements: ["Keyboard controls"],
      sourceReferences: [],
    },
    package: {
      schemaVersion: 2,
      manifest: {
        schemaVersion: 2,
        artifactType: "interactive-visualizer",
        title: "Phase and angular speed",
        description: "Follow a phase marker around a circle.",
        accessibilityDescription:
          "Play or pause the moving marker and change angular speed using the labelled slider.",
        mode: "2d",
        entry: "index.html",
        runtime: { id: "breadboard-interactive-visualizer", version: "2.0.0" },
      },
      assumptions: ["normalized radius"],
      limitations: ["teaching illustration"],
      sourceReferences: [],
      semanticTests: [
        {
          name: "visual integrity",
          assertion:
            "Labels remain legible and the marker stays attached to its orbit.",
        },
      ],
      assets: [],
      files: {
        "index.html": `<main id="app"><h1>Phase and angular speed</h1><button data-action="play-pause" aria-label="Pause" aria-pressed="true">${icon}</button><button data-action="reset" aria-label="Reset">${icon}</button><canvas width="500" height="260" aria-label="Moving phase marker"></canvas><label for="speed">Angular speed</label><input id="speed" type="range" min="1" max="3" step="1" value="1"></main><script src="main.js"></script>`,
        "styles.css":
          "#app{max-width:600px}button{width:32px;height:32px;background:var(--viz-control);border:1px solid var(--viz-line)}canvas{width:100%}input{max-width:100%}",
        "main.js": `const c=document.querySelector('canvas'),ctx=c.getContext('2d'),play=document.querySelector('[data-action="play-pause"]'),reset=document.querySelector('[data-action="reset"]'),speed=document.getElementById('speed');let t=0,last=0,running=!matchMedia('(prefers-reduced-motion: reduce)').matches;function sync(){play.setAttribute('aria-pressed',String(running));play.setAttribute('aria-label',running?'Pause':'Play')}function draw(){const s=getComputedStyle(document.documentElement);ctx.clearRect(0,0,500,260);ctx.strokeStyle=s.getPropertyValue('--viz-muted');ctx.beginPath();ctx.arc(250,130,85,0,Math.PI*2);ctx.stroke();ctx.fillStyle=s.getPropertyValue('--viz-accent');ctx.beginPath();ctx.arc(250+85*Math.cos(t),130+85*Math.sin(t),${inert ? "5" : "5+Number(speed.value)*3"},0,Math.PI*2);ctx.fill()}play.addEventListener('click',()=>{running=!running;sync()});reset.addEventListener('click',()=>{t=0;speed.value='1';running=false;sync();draw()});speed.addEventListener('input',draw);addEventListener('breadboard:themechange',draw);function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;if(running&&!document.hidden){${frozen ? "" : "t+=dt*Number(speed.value);"}}draw();requestAnimationFrame(frame)}sync();draw();requestAnimationFrame(frame);`,
      },
    },
  };
}

test("Learn and regeneration explicitly use the real native skill", () => {
  const skill = loadLearnVisualizerSkill();
  assert.match(
    learnVisualizerAuthorPrompt(skill.text),
    /Teaching difficult concepts/,
  );
  assert.match(skill.hash, /^[a-f0-9]{64}$/);
  for (const file of [
    "src/lib/learn.ts",
    "src/app/api/gardens/[gardenId]/visualizations/[visualId]/regenerate/route.ts",
  ]) {
    assert.match(
      fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      /sourceSkill: "interactive-visualizer-in-chat"/,
    );
  }
});
test("native response recovery accepts surplus braces but rejects a second response", () => {
  assert.deepEqual(parseLearnVisualizerResponse('{"code":"a}b\\\"c"}}'), {
    code: 'a}b"c',
  });
  assert.deepEqual(parseLearnVisualizerResponse('```json\n{"plan":{}}\n```'), {
    plan: {},
  });
  assert.throws(() =>
    parseLearnVisualizerResponse('{"plan":{}} {"replacement":true}'),
  );
  assert.throws(() => parseLearnVisualizerResponse('{"plan":'));
});
test("a visual repair names what failed browser checks require and demands the package", () => {
  const runtime = learnVisualRepairInstruction([
    "reduced-motion: pause freezes primary scene: failed",
    "reduced-motion: reset is deterministic: failed",
    "desktop-light: pause freezes primary scene: failed",
  ]);
  assert.match(runtime, /Repair these exact failures/);
  assert.match(runtime, /pixel-identical for at least 260 ms/);
  assert.match(runtime, /Clicking Reset twice/);
  assert.equal(runtime.match(/pixel-identical/g).length, 1);
  assert.match(runtime, /Return the complete corrected JSON object with plan and package only/);
  const validation = learnVisualRepairInstruction(["Return one valid JSON object with plan and package. Unexpected token"]);
  assert.doesNotMatch(validation, /What the failed browser checks require/);
  assert.match(validation, /Do not describe the changes/);
});
test("native response recovery drops a sentence of prose before the object", () => {
  assert.deepEqual(
    parseLearnVisualizerResponse(
      'I found the two blocking issues and repaired only those.\n\n{"plan":{"title":"a {b}"},"package":{}}',
    ),
    { plan: { title: "a {b}" }, package: {} },
  );
  assert.deepEqual(
    parseLearnVisualizerResponse(
      "I will return the requested `{plan, package}` object.\n\n```json\n{\"plan\":{}}\n```",
    ),
    { plan: {} },
  );
  assert.deepEqual(
    parseLearnVisualizerResponse('Use { as the opener, then:\n{"plan":{"ok":true}}'),
    { plan: { ok: true } },
  );
  assert.throws(() =>
    parseLearnVisualizerResponse('Here it is. {"plan":{}} {"replacement":true}'),
  );
  assert.throws(() =>
    parseLearnVisualizerResponse('Here it is. {"plan":{}} and a closing remark.'),
  );
  assert.throws(() =>
    parseLearnVisualizerResponse('Note. {"plan": oops, "package": {"k":1}}'),
  );
  assert.throws(() => parseLearnVisualizerResponse("I could not produce the package."));
});
test("visual replacement preserves the complete page set and every byte outside its fences", () => {
  const before = {
    "learning/lesson.md":
      "# Lesson\nExplain the concept.\n```breadboard-generated-visual\nid: visual-test\nversion: 1\n```\nKeep this equation.\n",
    "learning/another.md": "An untouched lesson.",
  };
  const after = {
    ...before,
    "learning/lesson.md": before["learning/lesson.md"].replace(
      "version: 1",
      "version: 2",
    ),
  };
  assert.doesNotThrow(() => verifyLearnPagePreservation(before, after));
  assert.throws(
    () =>
      verifyLearnPagePreservation(before, {
        "learning/lesson.md": after["learning/lesson.md"],
      }),
    /page set changed/,
  );
  assert.throws(
    () =>
      verifyLearnPagePreservation(before, {
        ...after,
        "learning/another.md": "Rewritten prose",
      }),
    /prose changed/,
  );
});
test("native package uses chat compiler and cannot enter through declarative source", async () => {
  const compiled = await compileGardenVisualization(
    JSON.stringify(nativeFixture()),
  );
  assert.equal(
    compiled.validation.valid,
    true,
    compiled.validation.errors.join(";"),
  );
  assert.equal(isLearnNativeVisualizer(compiled.definition), true);
  const ordinaryProperty = nativeFixture();
  ordinaryProperty.package.files["main.js"] += "const labels={methodRows:[]};";
  assert.equal(
    (await compileGardenVisualization(JSON.stringify(ordinaryProperty)))
      .validation.valid,
    true,
  );
  const externalUrl = nativeFixture();
  externalUrl.package.files["main.js"] +=
    'const remote="https://example.com/";';
  assert.equal(
    (await compileGardenVisualization(JSON.stringify(externalUrl))).validation
      .valid,
    false,
  );
  const bypass = compileGeneratedVisualization(
    `import {defineVisualization} from '@breadboard/visual-sdk';export default defineVisualization(${JSON.stringify(compiled.definition)});`,
  );
  assert.equal(bypass.validation.valid, false);
  const bad = nativeFixture();
  bad.package.files["main.js"] += 'fetch("x");';
  const rejected = await compileGardenVisualization(JSON.stringify(bad));
  assert.equal(rejected.validation.valid, false);
  assert.equal(
    rejected.validation.sourceBytes,
    Buffer.byteLength(JSON.stringify(bad)),
  );
});
test(
  "native browser gate distinguishes real animation from a frozen scene",
  { timeout: 180000 },
  async () => {
    for (const frozen of [false, true]) {
      const compiled = await compileGardenVisualization(
        JSON.stringify(nativeFixture({ frozen })),
      );
      const outputDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "bb-native-test-"),
      );
      try {
        const result = await runGeneratedVisualBrowserTestsLocally({
          definition: compiled.definition,
          outputDir,
        });
        const motion = result.tests.filter((t) =>
          t.name.includes("animation changes primary scene"),
        );
        assert.equal(motion.length, 4, JSON.stringify(result.tests));
        assert.equal(
          motion.every((t) => t.passed),
          !frozen,
          JSON.stringify(motion),
        );
        if (!frozen)
          assert.equal(
            result.tests.every((t) => t.passed),
            true,
            JSON.stringify(result.tests.filter((t) => !t.passed)),
          );
      } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    }
  },
);

test("Quartz publishes native envelopes only with matching source and skill evidence", async () => {
  const bundled = await build({
    stdin: {
      contents:
        'export {BreadboardGeneratedVisuals} from "./quartz/quartz/plugins/transformers/breadboardGeneratedVisual.ts";',
      resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "omit-browser-assets",
        setup(api) {
          api.onResolve({ filter: /\.inline(?:\.scss)?$/ }, () => ({
            path: "browser-asset",
            namespace: "empty",
          }));
          api.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
            contents: 'export default ""',
            loader: "js",
          }));
        },
      },
    ],
  });
  const { BreadboardGeneratedVisuals } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bb-native-quartz-"));
  try {
    const compilation = await compileGardenVisualization(
      JSON.stringify(nativeFixture()),
    );
    const artifact = path.join(
      temporary,
      ".breadboard/visuals/visual-phase/versions/2",
    );
    fs.mkdirSync(artifact, { recursive: true });
    fs.mkdirSync(path.join(temporary, "learning"));
    const manifest = {
      id: "visual-phase",
      version: 2,
      status: "published",
      targetPage: "learning/phase.md",
      targetHeading: "Phase",
      insertionAnchor: "learning-unit:phase",
      sourceHash: compilation.sourceHash,
      compiledHash: compilation.compiledHash,
      sourceSkill: "interactive-visualizer-in-chat",
      skillHash: "a".repeat(64),
      runtimeEngine: "breadboard-interactive-visualizer",
      title: "Phase",
    };
    for (const [name, value] of Object.entries({
      manifest,
      validation: { valid: true },
      tests: { passed: true },
      critic: { approved: true },
    }))
      fs.writeFileSync(
        path.join(artifact, name + ".json"),
        JSON.stringify(value),
      );
    fs.writeFileSync(
      path.join(artifact, "compiled.js"),
      compilation.compiledJavaScript,
    );
    fs.writeFileSync(
      path.join(artifact, "source.tsx"),
      JSON.stringify(nativeFixture()),
    );
    function transform() {
      const code = {
        type: "code",
        lang: "breadboard-generated-visual",
        value: "id: visual-phase\nversion: 2",
      };
      const tree = {
        type: "root",
        children: [
          {
            type: "heading",
            depth: 1,
            children: [{ type: "text", value: "Phase" }],
          },
          { type: "html", value: "<!-- learning-unit:phase -->" },
          code,
        ],
      };
      BreadboardGeneratedVisuals().markdownPlugins({
        argv: { directory: temporary },
      })[0]()(tree, {
        data: { filePath: path.join(temporary, "learning/phase.md") },
      });
      return code.data.hProperties;
    }
    assert.ok(transform()["data-generated-visual-definition"]);
    fs.writeFileSync(
      path.join(artifact, "manifest.json"),
      JSON.stringify({ ...manifest, skillHash: "b".repeat(64) }),
    );
    assert.match(transform()["data-generated-visual-error"], /provenance/);
    fs.writeFileSync(path.join(artifact, "source.tsx"), "tampered");
    assert.match(transform()["data-generated-visual-error"], /hash/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
