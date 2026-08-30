import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  learnSourceBindingRecord,
  matchingLearnSourceNormalizationReceipt,
  readLearnSourceNormalizationReceipt,
  sourceSetHashForBindingRecords,
  writeLearnSourceNormalizationReceipt,
} from "../src/lib/learn-source-normalization-receipt.ts";

const HASH = "a".repeat(64);

function record(body, overrides = {}) {
  return learnSourceBindingRecord({
    slug: "generic-source",
    relPath: "sources/generic-source.md",
    title: "Generic Source",
    description: "A generic source fixture",
    sourceFile: "generic.pdf",
    date: "2026-01-02T03:04:05.000Z",
    body,
    ...overrides,
  });
}

test("a deterministic source-link normalization receipt restores the exact pre-normalization binding", () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-normalization-"));
  try {
    const before = [record("## Coverage\n\n- [[generated-topic|Visible label]]")];
    const after = [record("## Coverage\n\n- Visible label")];
    const receipt = writeLearnSourceNormalizationReceipt({
      gardenDir,
      expectedCombinedSourceSetHash: HASH,
      sourceIds: ["generic-source"],
      before,
      after,
      createdAt: "2026-01-02T03:04:06.000Z",
    });

    assert.ok(receipt);
    assert.equal(
      sourceSetHashForBindingRecords(receipt.before),
      sourceSetHashForBindingRecords(before),
    );
    assert.deepEqual(
      matchingLearnSourceNormalizationReceipt({
        gardenDir,
        expectedCombinedSourceSetHash: HASH,
        sourceIds: ["generic-source"],
        current: after,
      }),
      receipt,
    );
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("a later source edit cannot reuse the normalization receipt", () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-normalization-"));
  try {
    const before = [record("- [[generated-topic|Visible label]]")];
    const after = [record("- Visible label")];
    writeLearnSourceNormalizationReceipt({
      gardenDir,
      expectedCombinedSourceSetHash: HASH,
      sourceIds: ["generic-source"],
      before,
      after,
    });

    assert.equal(
      matchingLearnSourceNormalizationReceipt({
        gardenDir,
        expectedCombinedSourceSetHash: HASH,
        sourceIds: ["generic-source"],
        current: [record("- Visible label\n\nUser-authored change")],
      }),
      null,
    );
    assert.equal(
      matchingLearnSourceNormalizationReceipt({
        gardenDir,
        expectedCombinedSourceSetHash: "b".repeat(64),
        sourceIds: ["generic-source"],
        current: after,
      }),
      null,
    );
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("tampered or reordered receipt authority fails closed", () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-normalization-"));
  try {
    const before = [record("- [[generated-topic|Visible label]]")];
    const after = [record("- Visible label")];
    writeLearnSourceNormalizationReceipt({
      gardenDir,
      expectedCombinedSourceSetHash: HASH,
      sourceIds: ["generic-source"],
      before,
      after,
    });
    const receiptPath = path.join(
      gardenDir,
      ".breadboard",
      "source-normalization-receipt.json",
    );
    const parsed = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    parsed.after[0].title = "Tampered";
    fs.writeFileSync(receiptPath, JSON.stringify(parsed));

    assert.equal(readLearnSourceNormalizationReceipt(gardenDir), null);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});
