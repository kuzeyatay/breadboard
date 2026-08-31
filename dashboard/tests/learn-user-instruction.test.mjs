import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MAX_LEARN_USER_INSTRUCTION_CHARS,
  parseLearnUserInstruction,
} from "../src/lib/learn-route-errors.ts";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("Learn guidance is trimmed, optional, bounded, and type checked", () => {
  assert.equal(parseLearnUserInstruction({}), undefined);
  assert.equal(parseLearnUserInstruction({ userInstruction: "   " }), undefined);
  assert.equal(
    parseLearnUserInstruction({ userInstruction: "  Focus on Gauss's law.  " }),
    "Focus on Gauss's law.",
  );
  assert.throws(
    () => parseLearnUserInstruction({ userInstruction: 42 }),
    /must be a string/,
  );
  assert.throws(
    () =>
      parseLearnUserInstruction({
        userInstruction: "x".repeat(MAX_LEARN_USER_INSTRUCTION_CHARS + 1),
      }),
    /characters or fewer/,
  );
});

test("planning and rebuild routes carry guidance into the durable worker", () => {
  for (const route of [
    "src/app/api/gardens/[gardenId]/learn/plan/route.ts",
    "src/app/api/gardens/[gardenId]/learn/rebuild/route.ts",
  ]) {
    const source = read(route);
    assert.match(source, /parseLearnUserInstruction\(body\)/);
    assert.match(source, /userInstruction,/);
  }

  const background = read("src/lib/learn-background.ts");
  assert.match(background, /operation: "plan"[\s\S]*?userInstruction\?: string/);
  assert.match(background, /operation: "rebuild"[\s\S]*?userInstruction\?: string/);

  const executor = read("src/lib/learn-operation-executor.ts");
  assert.match(executor, /autoConfirmTopicMap: request\.autoConfirmTopicMap,[\s\S]*?userInstruction: request\.userInstruction/);
  assert.match(executor, /forceFullRebuild: true,[\s\S]*?userInstruction: request\.userInstruction/);
});

test("guidance persists on Learn jobs and reaches planning plus page prompts", () => {
  const learn = read("src/lib/learn.ts");
  const status = read("src/lib/learn-status-projection.ts");
  const projection = read("src/lib/learning-spine-prompt-projection.ts");

  assert.match(learn, /user_instruction\s+TEXT/);
  assert.match(learn, /ALTER TABLE learn_jobs ADD COLUMN user_instruction TEXT/);
  assert.match(learn, /userInstruction: effectiveUserInstruction/);
  assert.match(learn, /withLearnUserInstructionRules\([\s\S]*?SOURCE_MAP_PROMPT/);
  assert.match(learn, /withLearnUserInstructionRules\([\s\S]*?SCOPE_CONTRACT_PROMPT/);
  assert.match(learn, /withLearnUserInstructionRules\([\s\S]*?TOPIC_MAP_PROMPT/);
  assert.match(learn, /system: withLearnUserInstructionRules\([\s\S]*?OVERVIEW_PROMPT/);
  assert.match(learn, /task: "write_subsection",\s*userInstruction: effectiveUserInstruction/);
  assert.match(
    learn,
    /requestedUserInstruction \?\?[\s\S]*?getLearnJobById\(map\.jobId\)\?\.userInstruction/,
  );
  assert.match(status, /user_instruction/);
  assert.match(status, /userInstruction:/);
  assert.match(projection, /userInstruction\?: string/);
});
