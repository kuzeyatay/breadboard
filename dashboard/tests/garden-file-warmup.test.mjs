import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { gardenMarkdownFiles, warmGardenFiles } from "../src/lib/garden-file-warmup.ts";

test("warms the notes a knowledge scan reads, skipping assets and dot folders, and tolerates missing gardens", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-warmup-"));
  try {
    const garden = path.join(root, "g");
    for (const dir of ["sources", "assets", ".breadboard", "learn/unit-1"]) fs.mkdirSync(path.join(garden, dir), { recursive: true });
    for (const file of ["a.md", "sources/b.md", "learn/unit-1/c.md", "assets/skip.md", ".breadboard/skip.md", "sources/image.png"]) {
      fs.writeFileSync(path.join(garden, file), "# note");
    }
    const found = (await gardenMarkdownFiles(garden)).map(file => path.relative(garden, file).replaceAll("\\", "/")).sort();
    assert.deepEqual(found, ["a.md", "learn/unit-1/c.md", "sources/b.md"]);
    assert.equal(await warmGardenFiles(root, ["g", "missing"]), 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
