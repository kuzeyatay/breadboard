import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACCEPTED_PAGES_RELATIVE_PATH,
  acceptedPageInputHash,
  readAcceptedPage,
  writeAcceptedPage,
} from "../src/lib/learn-accepted-pages.ts";

const inputs = {
  pageRelPath: "learning/1. Sharing/1.1 Why.md",
  dossier: { subsectionTitle: "Why", learningUnit: { id: "U1", newConcepts: ["shared medium"] } },
  assignedVisualIds: ["S1.P15.F1"],
  taughtEarlier: [],
  taughtLater: ["TDMA"],
  sourceSetHash: "src",
  confirmedLearningMapId: "map",
};

test("the input hash depends on the page's inputs, never on prompts, and is key-order stable", () => {
  const a = acceptedPageInputHash(inputs);
  const b = acceptedPageInputHash({ ...inputs, dossier: { learningUnit: { newConcepts: ["shared medium"], id: "U1" }, subsectionTitle: "Why" } });
  assert.equal(a, b);
  assert.notEqual(a, acceptedPageInputHash({ ...inputs, taughtLater: ["TDMA", "FDMA"] }));
  assert.notEqual(a, acceptedPageInputHash({ ...inputs, assignedVisualIds: [] }));
});

test("an accepted page is reused from the staging garden only when its inputs still hash the same", () => {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "accepted-pages-"));
  try {
    const hash = acceptedPageInputHash(inputs);
    assert.equal(readAcceptedPage(staging, inputs.pageRelPath, hash), null);
    writeAcceptedPage(staging, inputs.pageRelPath, {
      inputHash: hash,
      pageBody: "Imagine four users...",
      visualIds: ["visual-u1"],
      visualizationOutcomes: [{ opportunityId: "visual-u1", status: "generated_published" }],
      acceptedAt: "2026-09-17T05:00:00.000Z",
      jobId: "learn_job_a",
    });
    assert.ok(fs.existsSync(path.join(staging, ACCEPTED_PAGES_RELATIVE_PATH)));
    const receipt = readAcceptedPage(staging, inputs.pageRelPath, hash);
    assert.equal(receipt.pageBody, "Imagine four users...");
    assert.deepEqual(receipt.visualIds, ["visual-u1"]);
    assert.equal(readAcceptedPage(staging, inputs.pageRelPath, acceptedPageInputHash({ ...inputs, sourceSetHash: "changed" })), null, "changed inputs invalidate the receipt");
    // A second page never disturbs the first.
    writeAcceptedPage(staging, "learning/1. Sharing/1.2 How.md", {
      inputHash: "x", pageBody: "b", visualIds: [], visualizationOutcomes: [], acceptedAt: "t", jobId: "j",
    });
    assert.equal(readAcceptedPage(staging, inputs.pageRelPath, hash).pageBody, "Imagine four users...");
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
});
