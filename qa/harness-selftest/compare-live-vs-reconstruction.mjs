#!/usr/bin/env node

/**
 * Does a failure belong to Breadboard, or to the QA reconstruction?
 *
 * The CRLF finding established the method: predict which test identities are
 * environment-sensitive, then verify by identity rather than by counting. This
 * applies the same partition to the remaining clusters.
 *
 *   fails in the reconstruction AND in the developer's tree
 *       → a genuine contract question: product versus test
 *   fails only in the reconstruction
 *       → an execution-environment artefact, like CRLF was
 *
 * Aggregate counts are deliberately not the evidence — the developer's tree
 * moves. A specific test identity that has failed across several reconstructions
 * over hours and passes live is a strong signal regardless of drift.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const liveLogPath = path.resolve(arg("--live-log", ""));
const reviewPath = path.resolve(arg("--review", ""));
const outPath = path.resolve(arg("--out", "live-vs-reconstruction.json"));

function failingIdentities(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("failing tests:"));
  const found = new Set();
  if (start < 0) return found;
  let file = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const location = /^test at (.+?):(\d+):(\d+)$/.exec(lines[index].trim());
    if (location) {
      file = location[1].split("\\").join("/");
      continue;
    }
    const name = /^✖ (.+?) \([\d.]+ms\)$/.exec(lines[index].trim());
    if (name) found.add(`${file} :: ${name[1]}`);
  }
  return found;
}

const live = failingIdentities(fs.readFileSync(liveLogPath, "utf8"));
const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));

const clusters = {};
const environmentOnly = [];
const genuine = [];

for (const row of review.rows) {
  const failsLive = live.has(row.testId);
  const bucket = (clusters[row.rootCauseId] ??= {
    failsInBoth: 0,
    reconstructionOnly: 0,
    reconstructionOnlyTests: [],
  });
  if (failsLive) {
    bucket.failsInBoth += 1;
    genuine.push(row.testId);
  } else {
    bucket.reconstructionOnly += 1;
    bucket.reconstructionOnlyTests.push(row.testId);
    environmentOnly.push(row.testId);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "The same dashboard suite was run in the developer's live tree and compared by test identity against the reconstruction failures. Counts are not the evidence; identities are.",
  liveFailureCount: live.size,
  reviewedFailures: review.rows.length,
  failsInBoth: genuine.length,
  reconstructionOnly: environmentOnly.length,
  interpretation: {
    failsInBoth: "A genuine contract question: the product and the test disagree in the developer's own tree.",
    reconstructionOnly:
      "An execution-environment artefact. The developer's tree passes; only the reconstruction fails. Same class as the CRLF defect.",
  },
  clusters,
  genuineContractFailures: genuine.sort(),
  environmentArtefactFailures: environmentOnly.sort(),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(`[partition] live-tree failures: ${live.size}`);
console.log(`[partition] reviewed failures: ${review.rows.length}`);
console.log(`[partition] fails in BOTH (genuine contract): ${genuine.length}`);
console.log(`[partition] reconstruction ONLY (environment artefact): ${environmentOnly.length}`);
console.log("");
for (const [id, bucket] of Object.entries(clusters).sort(
  (left, right) => right[1].failsInBoth + right[1].reconstructionOnly - (left[1].failsInBoth + left[1].reconstructionOnly),
)) {
  console.log(
    `  ${id}: both=${bucket.failsInBoth} reconstruction-only=${bucket.reconstructionOnly}`,
  );
}
