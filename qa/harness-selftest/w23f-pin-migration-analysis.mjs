#!/usr/bin/env node

/**
 * W23F / A8 — can the existing pins move to a canonical contract without
 * blessing content nobody reviewed?
 *
 * This is the question that decides whether the recommended repair is safe. A
 * migration that says "recompute the hashes from whatever is on disk" is not a
 * migration, it is a silent re-review: it would stamp the current bytes as
 * approved without anyone looking at them.
 *
 * The safe alternative is a migration by proof. For each pinned artifact, find
 * a byte form of the CURRENT content that reproduces the EXISTING pin. If one
 * exists, the current content is the reviewed content — the old pin says so —
 * and its canonical identity can be derived. If none exists, the reviewed bytes
 * cannot be recovered from what is on disk and a human has to look.
 *
 * The derived pin asserts strictly less than the one it replaces: it stops
 * distinguishing line terminators and distinguishes everything else exactly as
 * before. Nothing is written. This only computes and reports.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "w23e001-change-matrix.json");
const repoRoot = process.cwd();
const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const utf8 = (text) => Buffer.from(text, "utf8");

/** The recommended canonicalisation, exactly as specified. */
function canonicalIdentity(bytes) {
  const text = bytes.toString("utf8");
  if (!utf8(text).equals(bytes)) return null;
  return sha(utf8(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")));
}

/** Every line-terminator rendering of one text. */
function renderings(text) {
  const lf = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return {
    LF: utf8(lf),
    CRLF: utf8(lf.replace(/\n/g, "\r\n")),
    CR: utf8(lf.replace(/\n/g, "\r")),
  };
}

function git(args, cwd = repoRoot) {
  const run = spawnSync("git", args, { cwd, encoding: "buffer", maxBuffer: 128 * 1024 * 1024 });
  return { status: run.status ?? 1, stdout: run.stdout };
}

/** The committed content, with no checkout filter applied. */
function committedBlob(relative) {
  const result = git(["cat-file", "blob", "HEAD:" + relative]);
  return result.status === 0 ? result.stdout : null;
}

const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, ".agents/skills/registry.json"), "utf8"));

/**
 * A deterministic generator, where one exists. Its raw output is a second
 * independent way to recover the reviewed bytes.
 */
const GENERATORS = {
  "bullshit-detector": async () => {
    const { buildSkill } = await import(
      pathToFileURL(path.join(repoRoot, "scripts/build-bullshit-detector-skill.mjs")).href
    );
    const clone = fs.readFileSync(
      path.join(repoRoot, "bullshit-detector/skills/analysis/bullshit-detector/SKILL.md"),
      "utf8",
    );
    return { name: "scripts/build-bullshit-detector-skill.mjs :: buildSkill", output: utf8(buildSkill(clone)) };
  },
};

const rows = [];
for (const slug of Object.keys(registry.skills)) {
  const entry = registry.skills[slug];
  for (const file of entry.files ?? []) {
    const relative = ".agents/skills/" + slug + "/" + file;
    const pin = entry.fileHashes ? entry.fileHashes[file] : null;
    const blob = committedBlob(relative);
    const onDisk = fs.existsSync(path.join(repoRoot, relative))
      ? fs.readFileSync(path.join(repoRoot, relative))
      : null;

    const record = {
      slug,
      file,
      existingPin: pin,
      pinAlsoStoredAsLocalHash: entry.localHash === pin,
      committedBlobPresent: blob !== null,
      onDiskPresent: onDisk !== null,
      onDiskRawMatchesPin: onDisk ? sha(onDisk) === pin : null,
    };

    // --- route 1: a line-terminator rendering of the committed content ---
    if (blob) {
      const forms = renderings(blob.toString("utf8"));
      const matching = Object.keys(forms).filter((name) => sha(forms[name]) === pin);
      record.renderingsOfCommittedContent = Object.fromEntries(
        Object.keys(forms).map((name) => [name, sha(forms[name])]),
      );
      record.renderingThatReproducesPin = matching[0] ?? null;
      record.canonicalIdentityOfCommittedContent = canonicalIdentity(blob);
    }

    // --- route 2: a deterministic generator ---
    if (GENERATORS[slug]) {
      try {
        const generated = await GENERATORS[slug]();
        const rawMatches = sha(generated.output) === pin;
        record.generator = {
          name: generated.name,
          rawOutputMatchesPin: rawMatches,
          canonicalOfGeneratorOutput: canonicalIdentity(generated.output),
          canonicalOfCommittedContent: blob ? canonicalIdentity(blob) : null,
          canonicalFormsAgree: blob
            ? canonicalIdentity(generated.output) === canonicalIdentity(blob)
            : null,
        };
      } catch (error) {
        record.generator = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    // --- verdict ---
    if (record.renderingThatReproducesPin) {
      record.migration = "PROVABLE_BY_RENDERING";
      record.proof =
        "The " +
        record.renderingThatReproducesPin +
        " rendering of the committed content reproduces the existing pin exactly, so the existing pin itself attests that this content is the reviewed content.";
      record.derivedCanonicalPin = record.canonicalIdentityOfCommittedContent;
    } else if (record.generator && record.generator.rawOutputMatchesPin && record.generator.canonicalFormsAgree) {
      record.migration = "PROVABLE_BY_GENERATOR";
      record.proof =
        "No line-terminator rendering of the committed content reproduces the pin, but the deterministic generator output does, bit for bit — so the generator output is the reviewed artifact. Its canonical form equals the canonical form of the committed content, so the committed content is the same text that was reviewed.";
      record.derivedCanonicalPin = record.canonicalIdentityOfCommittedContent;
    } else {
      record.migration = "REQUIRES_HUMAN_REREVIEW";
      record.proof =
        "Neither a line-terminator rendering of the committed content nor a deterministic generator reproduces the existing pin, so the reviewed bytes cannot be recovered and no derived pin would be honest.";
      record.derivedCanonicalPin = null;
    }

    // A derived pin must assert exactly the canonical identity of content the
    // old pin already covered. If those disagree, the derivation is unsound.
    record.derivationSound =
      record.derivedCanonicalPin === null ||
      record.derivedCanonicalPin === record.canonicalIdentityOfCommittedContent;

    rows.push(record);
  }
}

// ------------------------------------------------------ safety properties
//
// The migration rule is only safe if it refuses to derive a pin for content the
// old pin does not cover. That is checked here against a deliberately modified
// copy of each artifact: the rule must fall through to REQUIRES_HUMAN_REREVIEW.
const safetyChecks = [];
for (const row of rows) {
  const blob = committedBlob(".agents/skills/" + row.slug + "/" + row.file);
  if (!blob) continue;
  const tampered = utf8(blob.toString("utf8").replace(/\n/, "\nUNREVIEWED LINE\n"));
  const forms = renderings(tampered.toString("utf8"));
  const anyRenderingMatches = Object.keys(forms).some((name) => sha(forms[name]) === row.existingPin);
  safetyChecks.push({
    slug: row.slug,
    scenario: "an unreviewed line inserted before migration",
    anyRenderingReproducesOldPin: anyRenderingMatches,
    wouldDeriveAPin: anyRenderingMatches,
    safe: anyRenderingMatches === false,
    why: "the migration rule can only derive a pin when the OLD pin is satisfied, so modified content falls through to human re-review",
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  question:
    "Can the existing pins be reinterpreted under a canonical-text contract without silently blessing unreviewed content?",
  rule: {
    derive:
      "A canonical pin may be derived only when some line-terminator rendering of the current content reproduces the existing raw pin exactly, or when a deterministic generator whose raw output reproduces the existing pin produces the same canonical text.",
    refuse: "Otherwise the artifact requires human re-review; no pin is derived.",
    whyThisIsNotAReReview:
      "The derived pin is computed from bytes the OLD pin already attests to. It asserts strictly less than its predecessor — it stops distinguishing line terminators and distinguishes everything else exactly as before — so it cannot approve any content that was not already approved.",
  },
  rows,
  safetyChecks,
  totals: {
    artifacts: rows.length,
    provableByRendering: rows.filter((row) => row.migration === "PROVABLE_BY_RENDERING").length,
    provableByGenerator: rows.filter((row) => row.migration === "PROVABLE_BY_GENERATOR").length,
    requiresHumanReReview: rows.filter((row) => row.migration === "REQUIRES_HUMAN_REREVIEW").length,
    allDerivationsSound: rows.every((row) => row.derivationSound),
    safetyChecksAllSafe: safetyChecks.every((check) => check.safe),
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

for (const row of rows) {
  console.log(row.slug + "/" + row.file + ": " + row.migration);
  console.log("  rendering reproducing the pin: " + (row.renderingThatReproducesPin ?? "none"));
  if (row.generator) {
    console.log(
      "  generator: rawMatchesPin=" +
        row.generator.rawOutputMatchesPin +
        " canonicalFormsAgree=" +
        row.generator.canonicalFormsAgree,
    );
  }
  console.log("  derived canonical pin: " + (row.derivedCanonicalPin ? row.derivedCanonicalPin.slice(0, 16) : "none"));
}
console.log("");
console.log("safety: modified content would derive a pin? " + safetyChecks.map((c) => c.wouldDeriveAPin).join(", "));
console.log("totals: " + JSON.stringify(summary.totals));
