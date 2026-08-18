#!/usr/bin/env node

/**
 * W23F / Part A — A1 threat model, A2 model comparison, A3 historical contract,
 * A9 recommendation, A10 authorisation.
 *
 * Run from the repository root with the run directory as the first argument.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: w23f-write-trust-analysis.mjs <run-dir>");
const at = (name) => path.join(runDir, name);
const readJson = (name) => JSON.parse(fs.readFileSync(at(name), "utf8"));
const write = (name, value) => fs.writeFileSync(at(name), JSON.stringify(value, null, 2) + "\n", "utf8");

const snapshot = readJson("execution-snapshot.json");
const candidates = readJson("w23e001-candidate-comparison.json");
const migration = readJson("w23e001-change-matrix.json");

// ------------------------------------------------------------ A1 threat model
const MUST_INVALIDATE = "MUST_INVALIDATE";
const MUST_NOT_INVALIDATE = "MUST_NOT_INVALIDATE";
const POLICY = "POLICY_DECISION_REQUIRED";

const threatModel = [
  {
    dimension: "text content changes",
    contract: MUST_INVALIDATE,
    why: "The whole point of the pin. Guidance a model follows is the product; changed words are changed behaviour.",
  },
  {
    dimension: "Unicode code-point changes",
    contract: MUST_INVALIDATE,
    why: "An invisible code point can change meaning or smuggle an instruction past a human reader. No Unicode normalisation is applied either: NFC and NFD forms are different content and must stay distinguishable.",
  },
  {
    dimension: "line-ending-only changes",
    contract: MUST_NOT_INVALIDATE,
    why: "This is the only dimension git rewrites on its own, under core.autocrlf, without any human touching the file. A pin that invalidates here is authenticating the checkout rather than the content, which is W23E-001.",
  },
  {
    dimension: "trailing newline changes",
    contract: MUST_INVALIDATE,
    decidedFrom:
      "Measured, not assumed: git checkout does not add or remove a terminal newline under any core.autocrlf setting. Tolerating it would give up discrimination and fix nothing.",
    why: "A missing or added terminal newline is a human edit. Keep it distinguishable.",
  },
  {
    dimension: "UTF-8 BOM changes",
    contract: MUST_INVALIDATE,
    decidedFrom: "git does not add or strip a BOM during checkout.",
    why: "A BOM is written by an editor, not by a checkout, and a leading U+FEFF can change how frontmatter parses. It is a content change.",
  },
  {
    dimension: "whitespace changes (indentation, trailing spaces, blank lines)",
    contract: MUST_INVALIDATE,
    why: "Markdown is whitespace-sensitive — indentation decides code blocks and list nesting — and a checkout never alters it.",
  },
  {
    dimension: "metadata / frontmatter changes",
    contract: MUST_INVALIDATE,
    why: "Frontmatter carries the skill name the registry keys on and the declared tool envelope. It is the most security-relevant text in the file.",
  },
  {
    dimension: "generated preamble changes",
    contract: MUST_INVALIDATE,
    why: "The preamble is what makes upstream guidance runnable inside Breadboard; it names tools and arguments.",
  },
  {
    dimension: "generated body changes",
    contract: MUST_INVALIDATE,
    why: "The body is the reviewed procedure.",
  },
  {
    dimension: "clone-derived content changes",
    contract: MUST_INVALIDATE,
    why: "An upstream bump is exactly the event the drift control exists to catch. It must force re-review, not be absorbed.",
  },
  {
    dimension: "arbitrary byte corruption",
    contract: MUST_INVALIDATE,
    why: "Corruption is indistinguishable from tampering at verification time.",
  },
  {
    dimension: "malicious modification",
    contract: MUST_INVALIDATE,
    why: "The threat the control exists for: unreviewed instructions reaching a model that acts on them.",
  },
  {
    dimension: "accidental checkout normalisation",
    contract: MUST_NOT_INVALIDATE,
    why: "Nobody edited anything. Refusing here disables a reviewed feature and teaches operators that a failed integrity check is routine noise, which is how a real one gets ignored.",
  },
  {
    dimension: "platform checkout differences",
    contract: MUST_NOT_INVALIDATE,
    why: "The same reviewed commit must mean the same thing on Windows, macOS and Linux. Measured: today it does not — no single checkout policy makes all three pinned skills verify.",
  },
];

// ------------------------------------------------------------ A3 evidence
const historicalContract = {
  question: "What did the pin historically promise?",
  candidates: {
    A: "These exact bytes were reviewed.",
    B: "This exact textual guidance was reviewed.",
    C: "This deterministic build output was reviewed.",
  },
  evidence: [
    {
      source: "docs/SKILLS_CATALOG_PROXY.md",
      quote: "Breadboard re-hashes the reviewed tree before promotion; changed content is rejected.",
      reading: "The stated unit of review is content, not bytes.",
      supports: "B",
    },
    {
      source: "docs/SKILLS_CATALOG_PROXY.md",
      quote: "A locally modified installation is marked for review and is not overwritten.",
      reading: "Again modification of content, not of representation.",
      supports: "B",
    },
    {
      source: "docs/SKILLS_CATALOG_PROXY.md",
      quote: "Files are written as UTF-8 with exclusive creation into a fresh isolated staging directory.",
      reading:
        "Skill files are declared text in a known encoding. An opaque-bytes contract would not need to say that.",
      supports: "B",
    },
    {
      source: "dashboard/tests/factcheck-integration.test.mjs",
      quote:
        "The registry pins the SKILL.md hash, so editing the shipped guidance without re-reviewing it disables the skill instead of shipping quietly.",
      reading: "The test states the contract in terms of editing guidance.",
      supports: "B",
    },
    {
      source: "dashboard/tests/premortem-integration.test.mjs",
      quote:
        "Integrity is pinned by the reviewed registry, so an edited SKILL.md disables the skill instead of silently shipping unreviewed guidance.",
      reading: "Same wording, independently written for a second skill.",
      supports: "B",
    },
    {
      source: "dashboard/src/lib/hermes/skills.ts :: inspectFiles",
      quote: "fileHashes = sha256(fs.readFileSync(file))",
      reading:
        "The implementation hashes raw bytes. In the quarantine and install flow this is sound, because those trees live under the data root and never round-trip through git, so bytes and text are the same thing there.",
      supports: "A (implementation), but only where bytes are stable",
    },
    {
      source: "dashboard/src/lib/hermes/skills.ts :: approvedRoot",
      quote: 'path.join(repoRoot(), ".agents", "skills")',
      reading:
        "The verified root is a COMMITTED directory. The same byte-hashing discipline was carried from a data-root artifact class, where bytes are stable, to a version-controlled one, where they are not. That transposition is the defect.",
      supports: "explains how A and B diverged",
    },
    {
      source: ".agents/skills/registry.json — the three pins themselves",
      quote:
        "premortem pinned in CRLF form, agent-loop-engineering in LF form, bullshit-detector in the generator raw mixed form",
      reading:
        "Three artifacts in one registry pinned in three different byte forms. If byte form were part of the contract, the contract would be internally inconsistent. The most economical explanation is that byte form was never intended to be meaningful and each pin simply captured whatever was on disk at install time.",
      supports: "B, decisively",
    },
    {
      source: "dashboard/src/lib/hermes/skills.ts :: listFirstPartySkills",
      quote: "enabled: true, healthy: true",
      reading:
        "Prebuilt first-party skills are also committed but are never hash-verified, so the pin is not a blanket policy over committed files. It is a control over the reviewed-install root specifically.",
      supports: "scope",
    },
  ],
  conclusion: "B",
  conclusionText:
    "The pin promises that the exact reviewed textual guidance is what ships. Raw-byte hashing was a faithful implementation of that promise in the quarantine and install flow, where the bytes cannot move. It stopped being faithful when the same discipline was applied to a committed directory, because git rewrites line terminators there and nothing else in the system treats that rewrite as a change.",
  confidence: "HIGH",
  strongestSingleEvidence:
    "Three pins, three different byte forms, one registry. A contract cannot be about bytes if its own instances disagree about which bytes.",
};

// ------------------------------------------------------------ A2/A7 compare
const byId = Object.fromEntries(candidates.models.map((model) => [model.model, model]));
const real = candidates.realCheckoutArms.perSkill;

const nonGitFormsAccepted = (model) =>
  model.representations.filter((entry) => !entry.gitCanProduce && entry.accepted).map((entry) => entry.form);

const modelAnalysis = [
  {
    model: "A",
    name: "raw bytes (current)",
    security: "Maximal discrimination. Zero false accepts across the adversarial matrix.",
    availability:
      "Broken. Measured on the real artifacts: premortem verifies only under core.autocrlf=true, agent-loop-engineering only under false or input, bullshit-detector under none. No single checkout policy makes all three work.",
    crossPlatform: "Validity depends on the checkout policy of the machine, so it is not portable.",
    falseAccepts: byId.A.falseAcceptCount,
    falseRejects: byId.A.checkoutReachableFalseRejectCount,
    migration: "n/a — this is the status quo",
    reviewImpact: "Operators learn that integrity failures are routine, which is how a real one gets ignored.",
    verdict: "REJECTED — it is the defect",
  },
  {
    model: "B",
    name: "canonical text, line terminators only (RECOMMENDED)",
    security:
      "Zero false accepts across all nine adversarial mutations, including a zero-width space, a widened allowed-tools line, an injected instruction and a single flipped bit. It also still rejects every representation change a checkout cannot cause: " +
      JSON.stringify(
        byId.B.representations.filter((entry) => !entry.gitCanProduce && !entry.accepted).map((entry) => entry.form),
      ),
    availability:
      "Fixed. Measured: the canonical identity of each of the three skills is identical across core.autocrlf true, false and input.",
    crossPlatform: "Portable by construction — the identity cannot depend on how the file was written to disk.",
    falseAccepts: byId.B.falseAcceptCount,
    falseRejects: byId.B.checkoutReachableFalseRejectCount,
    migration:
      "All three existing pins migrate by proof; none requires human re-review. See the change matrix.",
    reviewImpact:
      "The review question becomes exactly the question a reviewer actually answers: is this the text that was approved.",
    verdict: "RECOMMENDED",
  },
  {
    model: "B-wide",
    name: "canonical text plus trailing newline and BOM tolerance",
    security:
      "Also zero false accepts on this matrix, but it additionally accepts forms no checkout produces: " +
      JSON.stringify(nonGitFormsAccepted(byId["B-wide"])) +
      ". Those are human edits, so tolerating them gives up discrimination for nothing.",
    availability: "Fixed, same as B.",
    crossPlatform: "Portable, same as B.",
    falseAccepts: byId["B-wide"].falseAcceptCount,
    falseRejects: byId["B-wide"].checkoutReachableFalseRejectCount,
    migration: "Same as B.",
    reviewImpact: "A reviewer would have to be told that adding a BOM is not a change, which is not obviously true.",
    verdict:
      "REJECTED — strictly weaker than B with no availability benefit. The discriminator is the pair of forms above, which B rejects and B-wide accepts.",
  },
  {
    model: "C",
    name: "deterministic build artifact, raw hashing",
    security: "Same as A. Zero false accepts.",
    availability:
      "Only partly fixed. It removes the mixed-line-ending pin that no checkout can reproduce, but the artifact is still hashed as bytes, so it still fails wherever the checkout policy differs from the machine that pinned it. Measured false reject on CRLF: " +
      byId.C.checkoutReachableFalseRejectCount,
    crossPlatform: "Still checkout-dependent.",
    falseAccepts: byId.C.falseAcceptCount,
    falseRejects: byId.C.checkoutReachableFalseRejectCount,
    migration: "Requires re-pinning bullshit-detector, and re-pinning is the thing that must not happen blindly.",
    reviewImpact: "Neutral.",
    verdict:
      "NECESSARY BUT NOT SUFFICIENT — worth doing alongside B so the generator stops emitting mixed line endings, but it does not fix W23E-001 on its own.",
  },
  {
    model: "D",
    name: "raw bytes plus repository byte-preservation via .gitattributes",
    security: "Same as A. Zero false accepts, and no weakening of the hash at all.",
    availability:
      "Does not fix the existing pins. The committed blobs are already LF-normalised, so freezing bytes now yields LF everywhere — which premortem and bullshit-detector do not match. It would still require re-pinning two of three artifacts.",
    crossPlatform: "Portable once applied, but only for artifacts pinned after it is applied.",
    falseAccepts: byId.D.falseAcceptCount,
    falseRejects: byId.D.checkoutReachableFalseRejectCount,
    migration: "Requires blind re-pinning of two artifacts, which the standing constraints forbid.",
    reviewImpact:
      "Changes repository-wide checkout policy for a QA-adjacent reason, and W2-3C explicitly discouraged adding .gitattributes.",
    verdict:
      "REJECTED as the primary fix — it makes the pin stable going forward without making the existing pins correct, and it buys that with a repository-wide policy change.",
  },
];

write("trust-contract-analysis.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: snapshot.executionSnapshotId,
  finding: "W23E-001",
  scope: {
    verifiedRoot: ".agents/skills (approvedRoot) — the only hash-verified committed skill root",
    pinnedArtifacts: migration.totals.artifacts,
    notAffected: [
      "hermes-skills/quarantine and the install flow: under the data root, bytes never round-trip through git",
      "hermes-skills/prebuilt (listFirstPartySkills): committed but never hash-verified, enabled and healthy unconditionally",
      "17 further directories under .agents/skills with no registry entry, which listApprovedSkillsAtRoot skips",
    ],
  },
  threatModel,
  threatModelTotals: {
    mustInvalidate: threatModel.filter((entry) => entry.contract === MUST_INVALIDATE).length,
    mustNotInvalidate: threatModel.filter((entry) => entry.contract === MUST_NOT_INVALIDATE).length,
    policyDecisionRequired: threatModel.filter((entry) => entry.contract === POLICY).length,
  },
  historicalContract,
  modelAnalysis,
});

// ------------------------------------------------------ A9/A10 recommendation
const canonicalRule = {
  appliesTo:
    "Files in a hash-verified reviewed artifact set whose declared type is UTF-8 text (today: SKILL.md and any .md alongside it). Any other file is hashed raw, unchanged.",
  steps: [
    "1. Read the file as bytes.",
    "2. Decode as UTF-8 and re-encode. If the re-encoding is not byte-identical to the input, the file is not valid UTF-8: fail verification. Never let invalid bytes become U+FFFD and hash as if they were text.",
    "3. Replace every CRLF with LF, then every remaining lone CR with LF.",
    "4. Hash the UTF-8 encoding of the result with SHA-256.",
  ],
  affectsTheHash: [
    "every character, including invisible ones such as U+200B and U+FEFF",
    "every space and tab, including trailing whitespace and indentation",
    "the presence or absence of a terminal newline",
    "the number of blank lines",
    "frontmatter, including name and allowed-tools",
    "the order of lines",
    "the byte encoding, which must be valid UTF-8",
  ],
  ignoredByTheHash: [
    "whether a line ends CRLF, LF or lone CR — and nothing else",
  ],
  whyThisMatchesReview:
    "A reviewer approves the text of a skill. They do not, and cannot, review which byte a line ends with — no diff view shows it, and git rewrites it without asking. Every other dimension in the threat model is something a reviewer can see and would care about, so every other dimension still invalidates.",
  explicitlyNotDone: [
    "no Unicode normalisation (NFC/NFD stay distinct)",
    "no whitespace collapsing",
    "no trailing-newline tolerance",
    "no BOM stripping",
    "no case folding",
    "no markdown parsing or semantic comparison",
  ],
};

write("w23e001-recommendation.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: snapshot.executionSnapshotId,
  finding: "W23E-001",
  recommendation: "RECOMMEND",
  trustContract: "MODEL B — canonical text, line terminators only",
  statement:
    "The reviewed-artifact pin authenticates the exact reviewed text of the artifact, in UTF-8, independent of which line terminator the checkout wrote.",
  canonicalisation: canonicalRule,
  pairedChange: {
    change:
      "Make the bullshit-detector generator emit LF only, so the artifact it writes is self-consistent rather than a mixed-ending join.",
    why: "Model C on its own does not fix W23E-001, but the mixed-ending output is a latent defect that would keep producing artifacts whose raw hash no checkout can reproduce. It also makes the byte-exact rebuild assertion in factcheck-integration meaningful again on an LF checkout.",
    severity: "not required for the availability fix; recommended alongside it",
  },
  evidence: {
    falseAccepts: 0,
    adversarialMutationsRejected: candidates.models.find((model) => model.model === "B").adversarial.length,
    checkoutReachableFalseRejects: 0,
    canonicalIdentityStableAcrossCheckouts: real.every((entry) => entry.modelB_identicalAcrossAllCheckouts),
    checkoutPoliciesTested: candidates.realCheckoutArms.policiesTested,
  },
  migration: {
    rule: migration.rule,
    provableByRendering: migration.totals.provableByRendering,
    provableByGenerator: migration.totals.provableByGenerator,
    requiresHumanReReview: migration.totals.requiresHumanReReview,
    allDerivationsSound: migration.totals.allDerivationsSound,
    modifiedContentWouldNotDeriveAPin: migration.totals.safetyChecksAllSafe,
    note:
      "No pin is recomputed from whatever happens to be on disk. A canonical pin is derived only where the existing pin already attests to the current content, so the migration cannot approve anything a human did not approve.",
  },
  securityRisk: {
    residual:
      "A skill file whose meaning genuinely depends on CR versus LF would no longer be distinguished. For markdown guidance read by a model this does not arise, and the rule is scoped to declared UTF-8 text so a future binary or byte-sensitive artifact is still hashed raw.",
    notWeakened: [
      "the gate still fails closed",
      "all three guidance boundaries still apply it",
      "every content mutation in the adversarial matrix is still rejected",
      "invalid UTF-8 still fails verification rather than being coerced",
    ],
    severityOfResidual: "low",
  },
  compatibilityImpact: {
    quarantineAndInstallFlow:
      "Unchanged in effect. Those trees live under the data root where bytes are stable, so canonical and raw identity coincide; applying the same rule there is harmless and keeps one definition of identity in the codebase.",
    prebuiltFirstPartySkills: "Unaffected — never hash-verified.",
    multiFileSkills:
      "Handled: the rule is per file, so a skill shipping a binary alongside its markdown keeps raw hashing for the binary.",
    storedPinFormat:
      "Unchanged shape. fileHashes stays a map of relative path to hex digest; only how the digest is computed changes.",
  },
  whatThisDoesNotFix: [
    "The five failing tests stay red until the repair is actually applied and the pins migrated.",
    "factcheck-integration :: the shipped SKILL.md is the clone procedure plus a Breadboard preamble is a byte-exact comparison in the TEST, not in the product. Whether that assertion is correct depends on which trust contract is adopted, so it stays held rather than being corrected here.",
  ],
  authorization: {
    status: "SAFE_FOR_SH1_WITH_DEFINED_TRUST_CONTRACT",
    implemented: false,
    whyNotImplemented:
      "The standing human gate in qa/autonomous/loop-contract.yaml requires explicit approval for security_auth_capability_permission_or_sandbox_weakening, and README lists security-gate changes among the actions that stop for approval. Narrowing what an integrity hash distinguishes is such a change, however well justified. The gate policy does not treat a completed trust-contract selection as authorisation, so production mutation stops here.",
    approvalStringToProceed:
      "APPROVE LOOP ACTION: adopt canonical-text pin (Model B) + derive the three pins by proof / dashboard/src/lib/hermes/skills.ts + .agents/skills/registry.json + scripts/build-bullshit-detector-skill.mjs / revert the commit; the pins are derivable again from the same proof",
    whatWouldBeDoneOnApproval: [
      "Add one canonicalisation function and use it wherever a reviewed text artifact is hashed.",
      "Derive the three canonical pins by proof, refusing to derive any that is not attested by the existing pin.",
      "Make the generator emit LF.",
      "Add regression tests: same text in LF, CRLF and lone-CR form all verify; each of the nine adversarial mutations fails; invalid UTF-8 fails; a pin cannot be derived for content the old pin does not attest.",
      "Replay the five failing tests through the exact original scenario.",
    ],
  },
});

console.log("trust contract: " + historicalContract.conclusion + " (" + historicalContract.confidence + ")");
console.log("recommendation: MODEL B — canonical text, line terminators only");
console.log("authorization: SAFE_FOR_SH1_WITH_DEFINED_TRUST_CONTRACT, implemented=false");
