import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveGardenNoteSlug } from "../src/lib/garden-note-navigation.ts";

test("Garden navigation resolves nested and historical basename note links", (t) => {
  const contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-note-link-"));
  t.after(() => fs.rmSync(contentRoot, { recursive: true, force: true }));
  const firstDir = path.join(contentRoot, "physics", "Concepts", "1. Fields");
  const secondDir = path.join(contentRoot, "physics", "Concepts", "2. Charges");
  fs.mkdirSync(firstDir, { recursive: true });
  fs.mkdirSync(secondDir, { recursive: true });
  fs.writeFileSync(path.join(firstDir, "vector-fields.md"), "# Vector fields\n");
  fs.writeFileSync(path.join(secondDir, "vector-fields.md"), "# Charge fields\n");

  assert.equal(
    resolveGardenNoteSlug(
      contentRoot,
      "physics",
      "Concepts/2. Charges/vector-fields",
    ),
    "Concepts/2. Charges/vector-fields",
  );
  assert.equal(
    resolveGardenNoteSlug(contentRoot, "physics", "vector-fields"),
    "Concepts/1. Fields/vector-fields",
  );
  assert.equal(
    resolveGardenNoteSlug(contentRoot, "physics", "../outside"),
    null,
  );
});
