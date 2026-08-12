import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// ChatMock finds the unslop skill by walking up from its own module to a
// sibling `unslop/` directory. The dev repo has that clone, so unslop looks
// healthy there while a packaged build silently answers without the skill.
// These assertions keep the staged copy from being dropped again.

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("the desktop build stages the unslop skill beside chatmock", () => {
  const packager = source("../desktop/scripts/prepare-app-resources.mjs");
  assert.match(packager, /staging unslop skill/);
  assert.match(packager, /path\.join\(repoRoot, "unslop"\)/);
  assert.match(packager, /path\.join\(stagingRoot, "unslop"\)/);
  // A missing clone must break the build rather than ship a silent no-op.
  assert.match(packager, /unslop\/SKILL\.md is missing/);
});

test("the skill the packager stages is the one ChatMock loads", () => {
  const loader = source("../chatmock/chatmock/council/unslop.py");
  assert.match(loader, /base \/ "SKILL\.md"/);
  assert.match(loader, /parent \/ "unslop"/);
  assert.ok(
    fs.existsSync(new URL("../../unslop/SKILL.md", import.meta.url)),
    "the unslop clone is missing from the repo",
  );
});
