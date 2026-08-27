// Automatic output scrubbing, at the seams rather than at the producers.
//
// The point of this suite is not that scrubbing works — `scrub-parity` proves
// that against the reference implementation. The point is that it cannot be
// *bypassed*. Ten different call sites produce artifacts and several pipelines
// produce answers; wiring the scrub into each of them would work today and rot
// the first time somebody adds an eleventh. So the scrub sits in the funnels
// every one of them already goes through, and these tests pin it there.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { scrubbed, scrubEnabled, scrubText } from "../src/lib/watermarks/scrub-text.ts";
import {
  scrubFileInPlace,
  scrubFileInPlaceViaRuntime,
  scrubbableFile,
} from "../src/lib/watermarks/scrub-file.ts";
import { createWatermarkRuntimeFixture } from "./helpers/watermark-runtime-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboard = path.join(repoRoot, "dashboard", "src");
const runtime = createWatermarkRuntimeFixture();
after(() => runtime.cleanup());

function read(...parts) {
  return fs.readFileSync(path.join(dashboard, ...parts), "utf8");
}

function workdir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scrub-wiring-")));
}

// ── the seams ───────────────────────────────────────────────────────────────

test("every finished answer is scrubbed, in the one place they all land", () => {
  const store = read("lib", "conversations", "store.ts");
  // finishAssistantMessage backs completeAssistantMessage and
  // failAssistantMessage, so both the answer and a partial answer are covered.
  const finish = store.slice(store.indexOf("function finishAssistantMessage"));
  assert.match(finish, /const content = scrubbed\(input\.content\);/, "answers must be scrubbed before they are stored");
  assert.match(finish.slice(0, finish.indexOf("`).run(") + 400), /\n\s*content,/, "the scrubbed value must be the one written");
});

test("every text artifact is scrubbed, in the one function all four paths call", () => {
  const store = read("lib", "hermes", "artifact-store.ts");
  const validate = store.slice(store.indexOf("function validateContent"), store.indexOf("function sanitizeFilename"));
  assert.match(validate, /scrubbed\(content\)/, "artifact content must be scrubbed");
  assert.match(validate, /return clean;/, "the scrubbed value must be the one returned");
  // create, update, append and validated-publish all funnel through it.
  assert.ok(
    (store.match(/validateContent\(/g) ?? []).length >= 5,
    "validateContent must remain the single funnel for artifact text",
  );
});

test("every imported file is scrubbed, on the staged copy, before it is verified", () => {
  const store = read("lib", "hermes", "artifact-store.ts");
  const copies = [...store.matchAll(/fs\.copyFileSync\(sourcePath, temporary, fs\.constants\.COPYFILE_EXCL\);/g)];
  assert.equal(copies.length, 2, "both import paths must still stage through a temporary");
  for (const match of copies) {
    const after = store.slice(match.index, match.index + 900);
    assert.match(
      after,
      /scrubProvenance !== false\)[\s\S]{0,500}await scrubFileInPlaceViaRuntime\(temporary/,
      "each staged copy must be scrubbed",
    );
    // Before the rename, so the stored bytes are the scrubbed ones.
    assert.ok(
      after.indexOf("scrubFileInPlace") < after.indexOf("fs.renameSync"),
      "the scrub must happen before the file is published",
    );
  }
});

test("the answer on screen is scrubbed too, at done rather than per delta", () => {
  const hook = read("app", "components", "hermes", "use-agent-session.ts");
  const done = hook.slice(hook.indexOf('case "done":'), hook.indexOf('case "done":') + 1600);
  assert.match(done, /scrubbed\(assistant\.content\)/, "the displayed answer must be scrubbed on completion");
  // Per-delta scrubbing would break emoji whose joiner lands in the next chunk.
  const deltas = hook.slice(hook.indexOf('case "assistant.delta"'), hook.indexOf('case "assistant.segment"'));
  assert.ok(!deltas.includes("scrubbed("), "deltas must not be scrubbed individually");
  // `done` runs after `assistant.completed`, so a late replacementText is
  // covered by the same single scrub rather than needing its own.
  assert.ok(
    hook.indexOf('case "assistant.completed"') < hook.indexOf('case "done"'),
    "the scrub at done must be the last word on the answer's content",
  );
});

test("garden prose is scrubbed while executability can preserve exact structured output", () => {
  const learn = read("lib", "learn.ts");
  const text = learn.slice(learn.indexOf("async function callCouncilText"), learn.indexOf("async function callCouncilJson"));
  assert.match(text, /scrubbed\(exactContent\.trim\(\)\)/, "generated page prose must be scrubbed");
  assert.match(
    text,
    /preserveExactContent\s*\?\s*exactContent\s*:\s*scrubbed/,
    "structured callers must retain exact provider text while prose still uses the scrubber",
  );
  const json = learn.slice(learn.indexOf("async function callCouncilJson"));
  const body = json.slice(0, json.indexOf("\n}\n"));
  assert.ok(!body.includes("scrubbed("), "structured output must not be reshaped on its way to a parser");
  assert.match(body, /preserveExactContent\s*=\s*false/);
  const executability = learn.slice(
    learn.indexOf("async function requestVisualizationContractExecutabilityReview"),
    learn.indexOf("async function planAndReviewVisualNecessity"),
  );
  assert.match(executability, /callCouncilText\(/);
  assert.doesNotMatch(executability, /callCouncilJson\(/);
  assert.match(executability, /preserveExactContent:\s*true/);
  assert.match(
    executability,
    /strictVisualContractExecutabilityResponseOrExactRaw\(result\.content\)/,
  );
});

test("a fetched document keeps its metadata; only produced files are scrubbed", () => {
  const getDoc = read("lib", "get-doc", "artifact.ts");
  assert.match(getDoc, /scrubProvenance: false/, "a downloaded paper must keep its authors and DOI");
  // The producers of Breadboard's own files must NOT opt out.
  for (const producer of [
    ["lib", "hermes", "artifact-image-service.ts"],
    ["lib", "manim", "artifact.ts"],
    ["lib", "sf3d", "artifact.ts"],
  ]) {
    assert.ok(
      !read(...producer).includes("scrubProvenance: false"),
      `${producer.join("/")} produces its own file and must not opt out of scrubbing`,
    );
  }
});

test("the kill switch reaches every path from one variable", () => {
  assert.equal(scrubEnabled({}), true, "scrubbing is on by default");
  for (const value of ["0", "false", "off", "OFF"]) {
    assert.equal(scrubEnabled({ BREADBOARD_SCRUB_OUTPUT: value }), false, `${value} should disable scrubbing`);
  }
  assert.equal(scrubEnabled({ BREADBOARD_SCRUB_OUTPUT: "1" }), true);
});

test("the switch is inside scrubbed(), not left to each call site to remember", () => {
  // A switch every seam had to check would reintroduce the per-producer
  // forgetting the seams exist to prevent.
  const source = read("lib", "watermarks", "scrub-text.ts");
  const fn = source.slice(source.indexOf("export function scrubbed("));
  assert.match(fn, /if \(!scrubEnabled\(\)\) return text;/, "scrubbed() must consult the switch itself");
  for (const seam of [
    ["lib", "conversations", "store.ts"],
    ["lib", "hermes", "artifact-store.ts"],
    ["lib", "learn.ts"],
  ]) {
    assert.ok(!read(...seam).includes("scrubEnabled() ?"), `${seam.join("/")} must not gate the scrub itself`);
  }
});

// ── the file scrubber ───────────────────────────────────────────────────────

test("a produced PNG loses its generator metadata and stays a PNG", async () => {
  const directory = workdir();
  const file = path.join(directory, "shot.png");
  fs.writeFileSync(file, pngWithText("Software", "Made with Firefly generative AI"));
  const before = fs.readFileSync(file);
  assert.ok(before.includes(Buffer.from("Firefly")), "the fixture must carry the metadata");

  const result = await scrubFileInPlaceViaRuntime(file, runtime.execution);
  assert.equal(result.scrubbed, true, `expected a scrub, got ${result.reason}`);
  const after = fs.readFileSync(file);
  assert.equal(after.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "it must still be a PNG");
  assert.ok(!after.includes(Buffer.from("Firefly")), "the generator string must be gone");
  // `--in-place` leaves a .bak; inside artifact storage that would be a second
  // permanent copy of the very metadata being removed.
  assert.deepEqual(
    fs.readdirSync(directory).sort(),
    ["shot.png"],
    "the scrub must not leave a backup or a scratch file behind",
  );
});

test("a text file is scrubbed in process, without an interpreter", () => {
  const file = path.join(workdir(), "notes.md");
  fs.writeFileSync(file, "Hello​world\n");
  assert.equal(scrubFileInPlace(file).scrubbed, true);
  assert.equal(fs.readFileSync(file, "utf8"), "Helloworld\n");
});

test("a format with no provenance to strip is left completely alone", () => {
  const file = path.join(workdir(), "clip.mp4");
  const bytes = Buffer.from("not really an mp4, but nothing here is a container we touch");
  fs.writeFileSync(file, bytes);
  const result = scrubFileInPlace(file);
  assert.equal(result.scrubbed, false);
  assert.equal(result.reason, "unsupported_format");
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(scrubbableFile("clip.mp4"), false);
  assert.equal(scrubbableFile("shot.png"), true);
});

test("scrubbing never throws, so delivery cannot fail because hygiene did", () => {
  assert.doesNotThrow(() => {
    const missing = scrubFileInPlace(path.join(workdir(), "gone.png"));
    assert.equal(missing.scrubbed, false);
    assert.equal(missing.reason, "not_a_file");
  });
  const directory = workdir();
  assert.doesNotThrow(() => {
    const result = scrubFileInPlace(directory);
    assert.equal(result.scrubbed, false);
  });
});

test("the switch turns the file scrubber off too", () => {
  const file = path.join(workdir(), "shot.png");
  const bytes = pngWithText("Software", "Firefly");
  fs.writeFileSync(file, bytes);
  const previous = process.env.BREADBOARD_SCRUB_OUTPUT;
  process.env.BREADBOARD_SCRUB_OUTPUT = "0";
  try {
    assert.equal(scrubFileInPlace(file).reason, "disabled");
    assert.deepEqual(fs.readFileSync(file), bytes, "nothing should have changed");
    assert.equal(scrubbed("a​b"), "a​b", "the text path reads the same switch");
  } finally {
    if (previous === undefined) delete process.env.BREADBOARD_SCRUB_OUTPUT;
    else process.env.BREADBOARD_SCRUB_OUTPUT = previous;
  }
});

// ── what must never be damaged ──────────────────────────────────────────────

test("an answer's meaning is never altered — only invisible characters go", () => {
  const answer = [
    "Here is the fix:",
    "```js",
    "const total = items.reduce((a, b) => a + b, 0);",
    "```",
    "The energy is $$E = mc^2$$ — see S1.P12.F1.",
    "Русский, 日本語, and emoji 👨‍👩‍👧 all survive.",
  ].join("\n");
  assert.equal(scrubbed(answer), answer, "clean prose must pass through untouched");

  const marked = `${answer}​`;
  const result = scrubText(marked);
  assert.equal(result.text, answer, "only the carrier should be removed");
  assert.equal(result.removed, 1);
});

/** A 1x1 PNG with one tEXt chunk, so the test needs no binary fixture. */
function pngWithText(keyword, value) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from(`${keyword}\0${value}`, "latin1")),
    chunk("IDAT", Buffer.from("789c626000000000ffff030000060005", "hex")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
