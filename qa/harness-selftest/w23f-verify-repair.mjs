#!/usr/bin/env node

/**
 * W2-3F / A6, A10, A13, A14 — verify the W23E-001 repair.
 *
 * Four questions, in order of how badly getting them wrong would hurt:
 *
 *   A14/A10  does the gate still fail closed? A repair to a trust boundary that
 *            widens what it accepts is worse than the defect it fixed.
 *   A13      is the regression non-vacuous? It must fail against a verifier that
 *            gets the contract wrong in each specific way, not merely against
 *            one whose output differs.
 *   A6       do the three shipped skills verify under every checkout policy?
 *   A9       do all six line-ending shapes canonicalise identically?
 *
 * Run from the repaired worktree's `dashboard/` with --experimental-strip-types.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = path.resolve(process.argv[2] ?? ".");
const dashboardRoot = process.cwd();
const worktreeRoot = path.resolve(dashboardRoot, "..");
const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, relative)).href);

const { canonicalizeReviewedText, reviewedTextPin, listApprovedSkills } = await load(
  "src/lib/hermes/skills.ts",
);
const { skillAvailableForContext } = await load("src/lib/hermes/commands.ts");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const utf8 = (text) => Buffer.from(text, "utf8");
const write = (name, value) =>
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2) + "\n", "utf8");

// ================================================ A9: line-ending shapes
/**
 * No blank lines, deliberately. A blank line makes mixed terminators ambiguous:
 * a CR ending one line, followed by an empty line ending in LF, IS a CRLF pair,
 * so folding it to a single newline is correct and the rendering is genuinely a
 * different text rather than the same text differently terminated. Testing
 * canonicalisation on ambiguous input measures the probe, not the product.
 */
const SAMPLE = "---\nname: x\n---\n# Heading\nLine one.\nLine two.\n";
/**
 * Build a rendering by choosing a terminator per line break, so every shape
 * carries exactly the same characters and differs only in terminators. An
 * earlier version appended CR to alternate lines, which added a terminator the
 * original did not have — the shapes then genuinely differed and the matrix
 * reported two identities for what looked like one text.
 */
function render(text, pick) {
  const lines = text.split("\n");
  return lines
    .slice(0, -1)
    .map((line, index) => line + pick(index))
    .join("") + lines[lines.length - 1];
}
const LF = () => "\n";
const CRLF = () => "\r\n";
const CR = () => "\r";
const shapes = {
  "LF only": render(SAMPLE, LF),
  "CRLF only": render(SAMPLE, CRLF),
  "CR only": render(SAMPLE, CR),
  "mixed LF + CRLF": render(SAMPLE, (index) => (index % 2 ? "\r\n" : "\n")),
  "mixed CR + LF": render(SAMPLE, (index) => (index % 2 ? "\r" : "\n")),
  "mixed all three": render(SAMPLE, (index) => ["\n", "\r\n", "\r"][index % 3]),
};
const shapeResults = Object.entries(shapes).map(([name, text]) => ({
  shape: name,
  rawSha256: sha(utf8(text)),
  canonicalPin: reviewedTextPin(utf8(text)),
}));
const canonicalSet = new Set(shapeResults.map((entry) => entry.canonicalPin));
const rawSet = new Set(shapeResults.map((entry) => entry.rawSha256));

write("canonicalization-matrix.json", {
  generatedAt: new Date().toISOString(),
  sampleDescription: "the same reviewed text rendered in every line-ending shape",
  shapes: shapeResults,
  distinctCanonicalIdentities: canonicalSet.size,
  distinctRawIdentities: rawSet.size,
  allShapesShareOneIdentity: canonicalSet.size === 1,
  rawIdentitiesGenuinelyDiffer: rawSet.size > 1,
  conclusion:
    canonicalSet.size === 1 && rawSet.size > 1
      ? "Every line-ending shape of the same text has one canonical identity, while the raw bytes genuinely differ — so this is canonicalisation, not a coincidence."
      : "The canonicalisation does not collapse every line-ending shape, or the shapes were not genuinely different bytes.",
});

// ============================================== A8: invalid UTF-8 closed
const invalidCases = {
  "lone continuation byte": Buffer.from([0x41, 0x80, 0x42]),
  "truncated 3-byte sequence": Buffer.from([0x41, 0xe2, 0x82]),
  "truncated 4-byte sequence": Buffer.from([0x41, 0xf0, 0x9f, 0x92]),
  "invalid start byte": Buffer.from([0x41, 0xff, 0x42]),
  "overlong encoding": Buffer.from([0xc0, 0xaf]),
  "unpaired surrogate bytes": Buffer.from([0xed, 0xa0, 0x80]),
};
const invalidResults = Object.entries(invalidCases).map(([name, bytes]) => {
  const lossy = bytes.toString("utf8");
  return {
    case: name,
    canonicalises: canonicalizeReviewedText(bytes) !== null,
    producesPin: reviewedTextPin(bytes) !== null,
    lossyDecodeWouldProduceReplacementChars: lossy.includes("�"),
    failsClosed: canonicalizeReviewedText(bytes) === null && reviewedTextPin(bytes) === null,
  };
});
const validSample = utf8("# Título\n\nemoji \u{1F9EA}\n");
write("invalid-utf8-results.json", {
  generatedAt: new Date().toISOString(),
  principle:
    "A lossy decode would turn an invalid sequence into U+FFFD and then hash happily, so a pin could verify against bytes nobody reviewed. Verification must refuse instead.",
  invalid: invalidResults,
  allFailClosed: invalidResults.every((entry) => entry.failsClosed),
  everyCaseWouldHaveBeenLossilyDecoded: invalidResults.every(
    (entry) => entry.lossyDecodeWouldProduceReplacementChars,
  ),
  validMultibyteStillAccepted: reviewedTextPin(validSample) !== null,
});

// ================================= A13: the regression must be non-vacuous
//
// Four wrong verifiers. Each must disagree with the approved one on at least one
// case the regression asserts, or the regression is not distinguishing the
// contract.
const approved = (bytes) => {
  const canonical = canonicalizeReviewedText(bytes);
  return canonical === null ? null : sha(canonical);
};
const wrongVerifiers = {
  "old raw-byte verifier": (bytes) => sha(bytes),
  "canonicalisation with CRLF folding removed": (bytes) => {
    const text = bytes.toString("utf8");
    if (!utf8(text).equals(bytes)) return null;
    return sha(utf8(text));
  },
  "canonicalisation that also collapses arbitrary whitespace": (bytes) => {
    const text = bytes.toString("utf8");
    if (!utf8(text).equals(bytes)) return null;
    return sha(utf8(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ")));
  },
  "lossy decode that accepts invalid UTF-8": (bytes) =>
    sha(utf8(bytes.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"))),
};

const probes = {
  "LF form": utf8(SAMPLE),
  "CRLF form of the same text": utf8(SAMPLE.replace(/\n/g, "\r\n")),
  "trailing whitespace added": utf8(SAMPLE.replace("Line one.", "Line one.   ")),
  "double space collapsed": utf8(SAMPLE.replace("Line one.", "Line  one.")),
  "invalid UTF-8": Buffer.from([0x41, 0xff, 0x42]),
};

const nonVacuity = Object.entries(wrongVerifiers).map(([name, verifier]) => {
  const disagreements = [];
  const base = approved(utf8(SAMPLE));
  for (const [probeName, bytes] of Object.entries(probes)) {
    // Two separate questions. "Same identity as the reviewed text" is what a
    // pin comparison asks. "Produced an identity at all" is what refusal means:
    // a lossy verifier hands back a hash for bytes the approved one refuses,
    // and comparing only equality would miss that difference entirely.
    const approvedVerdict = {
      accepts: approved(bytes) !== null,
      sameAsReviewed: approved(bytes) === base,
    };
    let wrongVerdict;
    try {
      const value = verifier(bytes);
      wrongVerdict = { accepts: value !== null, sameAsReviewed: value === verifier(utf8(SAMPLE)) };
    } catch {
      wrongVerdict = { accepts: false, sameAsReviewed: false };
    }
    if (
      approvedVerdict.accepts !== wrongVerdict.accepts ||
      approvedVerdict.sameAsReviewed !== wrongVerdict.sameAsReviewed
    ) {
      disagreements.push({ probe: probeName, approved: approvedVerdict, wrongVerifier: wrongVerdict });
    }
  }
  return {
    wrongVerifier: name,
    distinguished: disagreements.length > 0,
    disagreements,
  };
});

// ============================== A10/A14: the gate must still fail closed
const closedCases = [];
const template = listApprovedSkills("dashboard_terminal")[0] ?? {
  slug: "stand-in",
  classification: "eligible_general",
  availability: "ready",
  compatibleSurfaces: ["assistant", "garden", "quartz"],
};
for (const [label, overrides] of [
  ["integrity failed", { enabled: false, healthy: false }],
  ["enabled but unhealthy", { enabled: true, healthy: false }],
  ["healthy but disabled", { enabled: false, healthy: true }],
  ["integrity passed", { enabled: true, healthy: true }],
]) {
  const candidate = { ...template, classification: "eligible_general", availability: "ready", compatibleSurfaces: ["assistant", "garden", "quartz"], ...overrides };
  closedCases.push({
    case: label,
    ...overrides,
    dispatchAllowed: skillAvailableForContext(candidate, { surface: "dashboard_terminal", mode: "knowledge" }),
  });
}

/**
 * The verification-level negatives, run against a real temporary reviewed root
 * so the product's own loader decides — not a stand-in.
 */
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "w23f-gate-"));
const scenarios = [];
function buildRoot(name, { content, pin, extraFile = null, omitPin = false, registryEntry = true }) {
  const root = path.join(sandbox, name);
  const skillDir = path.join(root, "probe-skill");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
  if (extraFile) fs.writeFileSync(path.join(skillDir, extraFile.name), extraFile.content);
  const entry = {
    name: "probe-skill",
    slug: "probe-skill",
    slashCommand: "probe-skill",
    upstreamId: "breadboard:probe-skill",
    source: "Breadboard",
    files: ["SKILL.md"],
    reviewState: "approved",
    classification: {
      classification: "eligible_general",
      category: "Knowledge work",
      classifierVersion: "breadboard-skill-policy-v2",
      compatibleModes: ["knowledge"],
      compatibleSurfaces: ["assistant", "garden"],
    },
  };
  if (!omitPin) entry.fileHashes = { "SKILL.md": pin };
  fs.writeFileSync(
    path.join(root, "registry.json"),
    JSON.stringify({ skills: registryEntry ? { "probe-skill": entry } : {} }, null, 2),
  );
  return root;
}

const GOOD = "---\nname: probe-skill\ndescription: probe\n---\n\nReviewed text.\n";
const goodPin = reviewedTextPin(utf8(GOOD));

const cases = [
  { name: "correct-pin", content: GOOD, pin: goodPin, expectHealthy: true, why: "control: an unmodified reviewed artifact must verify" },
  { name: "wrong-pin", content: GOOD, pin: "text-v1:" + "0".repeat(64), expectHealthy: false, why: "a pin that does not match must not verify" },
  { name: "changed-content", content: GOOD.replace("Reviewed text.", "Unreviewed text."), pin: goodPin, expectHealthy: false, why: "edited guidance must not ship" },
  { name: "crlf-rendering", content: GOOD.replace(/\n/g, "\r\n"), pin: goodPin, expectHealthy: true, why: "the repair: a checkout rendering must still verify" },
  { name: "invalid-utf8", content: Buffer.concat([utf8("---\nname: probe-skill\n---\n"), Buffer.from([0xff, 0xfe])]), pin: goodPin, expectHealthy: false, why: "invalid UTF-8 must fail closed, not decode lossily" },
  { name: "missing-pin", content: GOOD, pin: goodPin, omitPin: true, expectHealthy: null, why: "measured, not asserted: a registry entry with no pinned hashes" },
  { name: "extra-unpinned-file", content: GOOD, pin: goodPin, extraFile: { name: "EXTRA.md", content: "unreviewed\n" }, expectHealthy: false, why: "a file nobody reviewed must not appear inside a verified skill" },
  { name: "raw-pin-legacy", content: GOOD, pin: sha(utf8(GOOD)), expectHealthy: true, why: "a bare hex pin keeps its raw-byte meaning" },
  { name: "raw-pin-legacy-crlf", content: GOOD.replace(/\n/g, "\r\n"), pin: sha(utf8(GOOD)), expectHealthy: false, why: "a legacy raw pin must NOT silently gain canonical semantics" },
];

for (const testCase of cases) {
  const root = buildRoot(testCase.name, testCase);
  process.env.HERMES_SKILLS_APPROVED = root;
  // The loader reads the root per call, so a fresh list reflects this sandbox.
  const listed = listApprovedSkills("dashboard_terminal").find((entry) => entry.slug === "probe-skill");
  scenarios.push({
    case: testCase.name,
    why: testCase.why,
    listed: Boolean(listed),
    enabled: listed?.enabled ?? null,
    healthy: listed?.healthy ?? null,
    dispatchAllowed: listed
      ? skillAvailableForContext(listed, { surface: "dashboard_terminal", mode: "knowledge" })
      : false,
    expectedHealthy: testCase.expectHealthy,
    matchesExpectation:
      testCase.expectHealthy === null ? null : (listed?.healthy ?? false) === testCase.expectHealthy,
  });
}
delete process.env.HERMES_SKILLS_APPROVED;
fs.rmSync(sandbox, { recursive: true, force: true });

write("security-regression-results.json", {
  generatedAt: new Date().toISOString(),
  principle:
    "The repaired code is a trust boundary. Widening what it accepts would be worse than the availability defect it fixed, so every negative is executed against the product's own loader rather than a stand-in.",
  dispatchGate: closedCases,
  dispatchGateStillClosed:
    closedCases.filter((entry) => entry.case !== "integrity passed").every((entry) => entry.dispatchAllowed === false) &&
    closedCases.find((entry) => entry.case === "integrity passed")?.dispatchAllowed === true,
  verificationScenarios: scenarios,
  allExpectationsMet: scenarios
    .filter((entry) => entry.matchesExpectation !== null)
    .every((entry) => entry.matchesExpectation === true),
  measuredNotAsserted: scenarios.filter((entry) => entry.expectedHealthy === null),
});

write("regression-non-vacuity.json", {
  generatedAt: new Date().toISOString(),
  principle:
    "A regression that passes against the repaired code proves nothing unless it also fails against a verifier that gets the contract wrong.",
  wrongVerifiers: nonVacuity,
  allDistinguished: nonVacuity.every((entry) => entry.distinguished),
});

console.log("A9 canonicalisation: " + canonicalSet.size + " canonical identity across " + rawSet.size + " raw forms");
console.log("A8 invalid UTF-8 fails closed: " + invalidResults.every((entry) => entry.failsClosed));
for (const entry of nonVacuity) {
  console.log("A13 " + (entry.distinguished ? "DISTINGUISHED" : "NOT DISTINGUISHED") + "  " + entry.wrongVerifier);
}
for (const entry of scenarios) {
  console.log(
    "A10 " + entry.case.padEnd(22) + " healthy=" + String(entry.healthy).padEnd(5) +
      " expected=" + String(entry.expectedHealthy).padEnd(5) +
      (entry.matchesExpectation === null ? "  (measured)" : entry.matchesExpectation ? "  ok" : "  MISMATCH"),
  );
}
