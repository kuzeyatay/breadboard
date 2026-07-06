import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recordSourceVisualAssignments,
  saveSourceVisuals,
} from "../src/lib/source-visuals.ts";

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

    assert.equal(visual.usageStatus, "intentionally_skipped");
    assert.equal(visual.conceptUsage, "explained_as_text_formula");
    assert.equal(visual.cropStatus, "omitted_unreliable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
