// The TypeScript Layer A port against the Python it was ported from.
//
// `scrub-text.ts` runs on every string Breadboard emits, so it cannot afford a
// subprocess — but a hand-written reimplementation of a Unicode decision table
// is exactly the kind of code that drifts silently and corrupts real writing
// while looking fine in review. So the Python is treated as the specification
// and both are run over the same corpus, with byte-identical output required.
//
// The corpus is weighted towards the characters that must SURVIVE: emoji ZWJ
// sequences, Persian and Devanagari joiners, flag tags, Arabic orthographic
// marks. Removing an invisible carrier is easy; the port earns its place by
// not corrupting text that legitimately contains invisibles.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scrubText, scrubbed } from "../src/lib/watermarks/scrub-text.ts";
import { scriptsDir } from "../src/lib/watermarks/scripts.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const CASES = [
  // — nothing to do —
  "",
  "Plain ASCII prose with punctuation: it's fine, isn't it?",
  "Code: const x = {a: 1}; // comment\n\tindented\r\n",
  "LaTeX: $$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$ and an anchor S1.P12.F1",
  "Русский текст остаётся нетронутым.",
  "日本語のテキストはそのまま。",
  "Ελληνικά κείμενα επίσης.",
  "Combining marks: é (e + U+0301) and ǭ̇",

  // — carriers that must go —
  "Hello​world",
  "word⁠joiner",
  "soft­hyphen",
  "bom﻿inside",
  "bidi‮reversed‬",
  "lrm‎lrm rlm‏rlm",
  "tag󠀁carrier",
  "vs󠄀supplement",
  "invisible⁢times",
  "interlinear￹annotation￻",
  "khmer឴vowel",
  "hangulᅟfiller",
  "mongolian᠎vowel separator",
  "​‌‍⁠﻿",

  // — spaces —
  "no break space",
  "em space and thin space",
  "ideographic　space",
  "narrow nbsp and medium math",
  "ogham space",

  // — load-bearing invisibles that must SURVIVE —
  "family 👨‍👩‍👧 emoji",
  "heart on fire ❤️‍🔥 here",
  "scales ⚖️ with VS16",
  "text presentation ⚖︎ with VS15",
  "keycap 1️⃣ and #️⃣",
  "flag 🏴󠁧󠁢󠁳󠁣󠁴󠁿 scotland",
  "Persian: می‌روم",
  "Devanagari: क्‍ष",
  "Arabic number sign: ؀١٢",
  "Syriac abbreviation: ܏ܐ",
  "Kaithi: 𑂽 here",

  // — mixtures, where the contextual rule actually bites —
  "👨‍👩‍👧​stray after family",
  "‍ leading joiner with no base",
  "abc‍ def — joiner after ASCII is a carrier",
  "می‌روم​carrier after Persian",
  "🏴󠁧󠁢󠁳󠁣󠁴󠁿󠀁 tag after a flag run",
  "mixed 👨‍👩‍👧 and nbsp and​zwsp together",
  "emoji then space then joiner: 👨 ‍ 👩",
];

/** Clean every case with the vendored Python, in one process. */
function pythonClean(cases) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "scrub-parity-"));
  const input = path.join(workdir, "in.json");
  const output = path.join(workdir, "out.json");
  fs.writeFileSync(input, JSON.stringify(cases), "utf8");
  const program = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(scriptsDir())})`,
    "from text_unicode import clean_text",
    `cases = json.load(open(${JSON.stringify(input)}, encoding="utf-8"))`,
    "out = [clean_text(c)[0] for c in cases]",
    `json.dump(out, open(${JSON.stringify(output)}, "w", encoding="utf-8"))`,
  ].join("\n");
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  let ran = null;
  for (const python of candidates) {
    const result = spawnSync(python, ["-c", program], { encoding: "utf8", shell: false });
    if (!result.error && result.status === 0) {
      ran = result;
      break;
    }
    if (!result.error && result.status !== 0) {
      throw new Error(`the reference implementation failed: ${result.stderr}`);
    }
  }
  if (!ran) return null;
  const parsed = JSON.parse(fs.readFileSync(output, "utf8"));
  fs.rmSync(workdir, { recursive: true, force: true });
  return parsed;
}

/** Render a string as codepoints, so a failure names the character. */
function codepoints(value) {
  return [...value].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

test("the port matches the Python it was ported from, character for character", () => {
  const expected = pythonClean(CASES);
  if (expected === null) {
    // Python is how this claim is checked; without it the test would pass by
    // checking nothing, which is worse than failing.
    assert.fail("Python 3 is required to verify Layer A parity, and none was found on PATH.");
  }
  assert.equal(expected.length, CASES.length);
  const mismatches = [];
  CASES.forEach((input, index) => {
    const ours = scrubbed(input);
    if (ours !== expected[index]) {
      mismatches.push(
        `case ${index}: ${JSON.stringify(input)}\n` +
          `  python: ${codepoints(expected[index])}\n` +
          `  ours:   ${codepoints(ours)}`,
      );
    }
  });
  assert.equal(mismatches.join("\n\n"), "", `${mismatches.length} case(s) diverged from the reference`);
});

// ── the properties the port has to hold on its own ──────────────────────────

test("text with nothing to remove is returned unchanged, by reference", () => {
  const clean = "Ordinary prose, 日本語, код, and code: {a: 1}.";
  const result = scrubText(clean);
  assert.equal(result.changed, false);
  assert.equal(result.text, clean);
  // The common case must not allocate a rebuilt copy.
  assert.ok(Object.is(result.text, clean), "an unchanged string should be the original reference");
});

test("emoji sequences survive intact", () => {
  for (const emoji of ["👨‍👩‍👧", "❤️‍🔥", "⚖️", "1️⃣", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]) {
    assert.equal(scrubbed(`before ${emoji} after`), `before ${emoji} after`, `${codepoints(emoji)} was altered`);
  }
});

test("complex-script joiners survive, and the same codepoint after ASCII does not", () => {
  assert.equal(scrubbed("می‌روم"), "می‌روم", "Persian ZWNJ is orthographic");
  assert.equal(scrubbed("abc‌def"), "abcdef", "the same ZWNJ after ASCII is a carrier");
});

test("free-floating carriers are removed", () => {
  const result = scrubText("a​b‎c﻿d");
  assert.equal(result.text, "abcd");
  assert.equal(result.removed, 3);
});

test("exotic spaces become ordinary spaces, and are counted as replacements", () => {
  const result = scrubText("a b　c");
  assert.equal(result.text, "a b c");
  assert.equal(result.replaced, 2);
  assert.equal(result.removed, 0);
});

test("visible characters are never touched by default", () => {
  // Homoglyph folding rewrites real letters, so nothing automatic may enable
  // it: this Cyrillic must not become Latin.
  const cyrillic = "Ассоциация";
  assert.equal(scrubbed(cyrillic), cyrillic);
  assert.equal(scrubText(cyrillic, { aggressiveHomoglyphs: true }).changed, true);
});

test("scrubbing is idempotent", () => {
  for (const input of CASES) {
    const once = scrubbed(input);
    assert.equal(scrubbed(once), once, `not idempotent for ${JSON.stringify(input)}`);
  }
});

test("a non-string degrades to a pass-through rather than throwing mid-answer", () => {
  for (const value of [null, undefined, 42, {}]) {
    assert.equal(scrubbed(value), value);
  }
});

test("the port cites the vendored source it must track", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "watermarks", "scrub-text.ts"),
    "utf8",
  );
  assert.match(source, /text_unicode\.py/, "the port must name the file it mirrors");
  assert.ok(fs.existsSync(path.join(scriptsDir(), "text_unicode.py")), "the reference implementation must exist");
});
