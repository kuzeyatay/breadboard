import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recordSourceVisualAssignments,
  saveSourceVisuals,
  extractSourceVisuals,
} from "../src/lib/source-visuals.ts";

/** Write N page-snapshot PNGs and return their garden-relative URLs. */
function seedPageImages(contentPath, garden, count) {
  const dir = path.join(contentPath, garden, "assets", "pages");
  fs.mkdirSync(dir, { recursive: true });
  const urls = [];
  for (let i = 1; i <= count; i += 1) {
    const name = `src-page-${String(i).padStart(3, "0")}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    urls.push(`/${garden}/assets/pages/${name}`);
  }
  return urls;
}

function fakeClient(create) {
  return { chat: { completions: { create } } };
}

test("recordSourceVisualAssignments splits formula concept usage from crop status", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-visuals-"));
  try {
    const garden = "garden";
    fs.mkdirSync(path.join(root, garden), { recursive: true });
    saveSourceVisuals(root, garden, [
      {
        sourceVisualId: "S1.P6.E3",
        sourceId: "src",
        pageNumber: 6,
        type: "equation",
        caption: "Total spike count summed over neurons and time steps",
        usageStatus: "unused",
      },
    ]);

    const [visual] = recordSourceVisualAssignments(
      root,
      garden,
      new Map(),
      () => "formula taught from source markdown",
      { conceptAnchorIds: ["S1.P6.E3"] },
    );

    assert.equal(visual.usageStatus, "assigned");
    assert.equal(visual.conceptUsage, "explained_as_text_formula");
    assert.equal(visual.cropStatus, "omitted_unreliable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractSourceVisuals surfaces a model failure instead of silently reporting no figures", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-fail-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 5);
    // Preserve a prior good extraction from a different source across the failure.
    saveSourceVisuals(root, garden, [
      { sourceVisualId: "S9.P1.F1", sourceId: "other", pageNumber: 1, type: "figure", caption: "kept", usageStatus: "unused" },
    ]);

    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      throw new Error("502 Bad Gateway");
    });

    await assert.rejects(
      () => extractSourceVisuals({ client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls }),
      /vision detection failed on \d+ page\(s\).*502/s,
    );
    // Fail-fast: stops after 3 consecutive detection failures, not all 5 pages.
    assert.ok(calls <= 3, `expected fail-fast within 3 calls, got ${calls}`);
    // The prior good ledger entry is preserved (not wiped by the failed run).
    const ledger = JSON.parse(fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json"), "utf-8"));
    assert.deepEqual(ledger.map((v) => v.sourceVisualId), ["S9.P1.F1"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractSourceVisuals treats a successful empty detection as genuinely no figures (no throw)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-empty-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 2);
    const client = fakeClient(async () => ({ choices: [{ message: { content: "[]" } }] }));
    const found = await extractSourceVisuals({ client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls });
    assert.deepEqual(found, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
