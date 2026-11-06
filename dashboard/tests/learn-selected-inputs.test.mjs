import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { seedDurableInputs } from "../src/lib/learn-build-workspace.ts";
import { stageSelectedLearnInputs, selectedLearnInputsUnchanged } from "../src/lib/learn-selected-inputs.ts";

test("generation stages selected personal Markdown and syllabus while leaving unrelated notes out", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-selected-inputs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repositoryGardenDir = path.join(root, "live");
  const stagingGardenDir = path.join(root, "staged");
  const files = ["notes/week-1/mine.md", "notes/guide.md", "notes/unused.md", "generated/saved.md", "plain.md"];
  for (const file of files) {
    const target = path.join(repositoryGardenDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `# ${file}\n\nMy study material.\n`);
    fs.utimesSync(target, new Date("2026-01-02"), new Date("2026-01-02"));
  }
  fs.mkdirSync(stagingGardenDir);
  seedDurableInputs(repositoryGardenDir, stagingGardenDir, true);
  assert.equal(fs.existsSync(path.join(stagingGardenDir, "notes")), false);
  const sourcePaths = files.filter((file) => file !== "notes/unused.md");
  const snapshot = stageSelectedLearnInputs({ repositoryGardenDir, stagingGardenDir, sourcePaths });
  for (const file of sourcePaths) {
    assert.equal(fs.readFileSync(path.join(stagingGardenDir, file), "utf8"), fs.readFileSync(path.join(repositoryGardenDir, file), "utf8"));
    assert.equal(fs.statSync(path.join(stagingGardenDir, file)).mtime.toISOString(), "2026-01-02T00:00:00.000Z");
  }
  assert.equal(fs.existsSync(path.join(stagingGardenDir, "notes/unused.md")), false);
  assert.equal(selectedLearnInputsUnchanged(repositoryGardenDir, snapshot), true);
  fs.appendFileSync(path.join(repositoryGardenDir, "notes/unused.md"), "An unrelated edit.");
  assert.equal(selectedLearnInputsUnchanged(repositoryGardenDir, snapshot), true);
  fs.appendFileSync(path.join(repositoryGardenDir, "notes/week-1/mine.md"), "Changed teaching content.");
  assert.equal(selectedLearnInputsUnchanged(repositoryGardenDir, snapshot), false, "changed input must block stale publication");
  const refreshed = stageSelectedLearnInputs({ repositoryGardenDir, stagingGardenDir, sourcePaths });
  assert.equal(selectedLearnInputsUnchanged(repositoryGardenDir, refreshed), true);
  fs.unlinkSync(path.join(repositoryGardenDir, "notes/guide.md"));
  assert.equal(selectedLearnInputsUnchanged(repositoryGardenDir, refreshed), false, "a deleted syllabus also blocks publication");
  assert.throws(() => stageSelectedLearnInputs({ repositoryGardenDir, stagingGardenDir, sourcePaths: ["../escape.md"] }), /Invalid selected Learn input/);
});
