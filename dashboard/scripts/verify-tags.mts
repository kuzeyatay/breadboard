// Verification for the Zettelkasten-style tag normalizer.
//
// Run with:  node scripts/verify-tags.mts     (Node >= 22 strips TS types)
//
// Exits non-zero if any check fails.

import { normalizeTopicTags } from "../src/lib/tags.ts";

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  const status = condition ? "PASS" : "FAIL";
  console.log(`  [${status}] ${label}`);
  if (!condition) {
    failures += 1;
    if (detail !== undefined) console.log("         got:", detail);
  }
}

// ── Task 8: the prompt's sample input ──────────────────────────────────────
console.log("Case 1 — sample input from the task");
const sampleInput = [
  "Physics",
  "Formula",
  "Restoring force points toward equilibrium",
  "Amplitude is not total distance",
  "Angular frequency is phase rate",
  "standing waves",
  "source",
  "Important",
  "Boundary conditions create standing waves",
];

const sample = normalizeTopicTags(sampleInput, "", 10);
console.log("  output:", sample);

const mustContain = [
  "restoring-force-points-toward-equilibrium",
  "amplitude-is-not-total-distance",
  "angular-frequency-is-phase-rate",
  "boundary-conditions-create-standing-waves",
];
for (const tag of mustContain) {
  check(`keeps idea tag "${tag}"`, sample.includes(tag));
}

const mustReject = ["physics", "formula", "source", "important"];
for (const tag of mustReject) {
  check(`drops generic/broad tag "${tag}"`, !sample.includes(tag), sample);
}

// The four propositions should outrank the bare noun phrase "standing-waves".
const topFour = normalizeTopicTags(sampleInput, "", 4);
console.log("  top 4 (maxTags=4):", topFour);
check(
  "proposition tags are preferred over bare noun phrases (top 4 == the 4 idea tags)",
  mustContain.every((tag) => topFour.includes(tag)) && topFour.length === 4,
  topFour,
);
check(
  "standing-waves is only a lower-ranked optional tag, never displacing an idea tag",
  !topFour.includes("standing-waves"),
  topFour,
);

// ── Task 2/6: output is Quartz-compatible kebab-case ───────────────────────
console.log("Case 2 — Quartz-compatible kebab-case output");
check(
  "every tag is lowercase kebab-case with no spaces",
  sample.every((tag) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)),
  sample,
);

// ── Task 3: broad single-word category tags are banned ─────────────────────
console.log("Case 3 — broad category bans");
const broad = normalizeTopicTags(
  ["calculus", "math", "engineering", "wave", "force", "frequency", "oscillation"],
  "",
  10,
);
check("all broad single-word tags removed", broad.length === 0, broad);

// ── Task 7: over-fragmentation is avoided ──────────────────────────────────
console.log("Case 7 — over-fragmentation");
const fragmented = normalizeTopicTags(
  [
    "the left side of slide 14 shows the blue spring force arrow",
    "restoring force points toward equilibrium",
  ],
  "",
  10,
);
console.log("  output:", fragmented);
check(
  "rejects the over-specific slide-bound tag",
  !fragmented.some((tag) => tag.includes("slide")),
  fragmented,
);
check(
  "keeps the reusable idea tag",
  fragmented.includes("restoring-force-points-toward-equilibrium"),
  fragmented,
);

// A tag referencing a page/figure is layout-bound, never a connector.
const layout = normalizeTopicTags(
  ["see figure 3 for the phasor diagram", "angular frequency is phase rate"],
  "",
  10,
);
check(
  "rejects page/figure layout tags",
  !layout.some((tag) => /figure|page|slide/.test(tag)),
  layout,
);

// ── Limits: word count, char count, dedup, cap ─────────────────────────────
console.log("Case 8 — limits and dedup");
const tooLong = normalizeTopicTags(
  [
    "this is a very long tag that reads like a whole sentence and keeps going well past the atomic idea limit for tags",
  ],
  "",
  10,
);
check("rejects sentence-length tags (maxWords/maxChars)", tooLong.length === 0, tooLong);

const single = normalizeTopicTags(["eigenvalue"], "", 10);
check("rejects single-word tags (minWords = 2)", single.length === 0, single);

const dup = normalizeTopicTags(
  [
    "angular frequency is phase rate",
    "Angular Frequency Is Phase Rate",
    "angular  frequency   is  phase rate",
  ],
  "",
  10,
);
check("deduplicates equivalent tags", dup.length === 1, dup);

const capped = normalizeTopicTags(
  [
    "restoring force points toward equilibrium",
    "amplitude is not total distance",
    "angular frequency is phase rate",
    "boundary conditions create standing waves",
    "wave motion is not particle motion",
    "gradient points toward steepest increase",
  ],
  "",
  3,
);
check("caps the number of tags (maxTags)", capped.length === 3, capped);

// ── Task 5: grounding (drops a multi-word tag absent from the source) ───────
console.log("Case 5 — grounding to source");
const grounded = normalizeTopicTags(
  ["restoring force points toward equilibrium", "quantum chromodynamics confines quarks"],
  "",
  10,
  "A mass on a spring feels a restoring force that points back toward its equilibrium position.",
);
console.log("  output:", grounded);
check(
  "keeps the source-grounded idea tag",
  grounded.includes("restoring-force-points-toward-equilibrium"),
  grounded,
);
check(
  "drops the ungrounded idea tag",
  !grounded.some((tag) => tag.includes("chromodynamics")),
  grounded,
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All tag-normalization checks passed.");
