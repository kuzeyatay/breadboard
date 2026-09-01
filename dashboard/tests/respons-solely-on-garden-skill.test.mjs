import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("respons-solely-on-garden is a ready first-party grounding skill", () => {
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === "respons-solely-on-garden",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.equal(skill.category, "Featured");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      "garden_list",
      "garden_search",
      "garden_get_page",
    ]);
  }
});

test("the skill makes one Garden the complete evidence boundary", () => {
  const manifest = source(
    "../hermes-skills/prebuilt/respons-solely-on-garden/SKILL.md",
  );

  assert.match(manifest, /target Garden is the entire knowledge\s+boundary/);
  assert.match(manifest, /Do not use model memory/);
  assert.match(manifest, /Do not call non-Garden research or knowledge tools/);
  assert.match(manifest, /Never silently switch Gardens or combine material/);
  assert.match(manifest, /Call `garden_get_page` for every page/);
  assert.match(manifest, /A title or search-result snippet alone is not evidence/);
  assert.match(
    manifest,
    /I found no information in this Garden that answers your question/,
  );
});

test("the slash command injects the grounding rule without changing the question", async () => {
  const resolved = await resolveCommandMessage(
    1,
    "/respons-solely-on-garden What does the Garden say about spaced repetition?",
    process.cwd(),
    { mode: "knowledge", surface: "garden_chat" },
  );

  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    ["respons-solely-on-garden"],
  );
  assert.equal(
    resolved.userText,
    "What does the Garden say about spaced repetition?",
  );
  assert.match(
    resolved.text,
    /Reviewed skill guidance: respons-solely-on-garden/,
  );
  assert.match(
    resolved.text,
    /\[User request\]\nWhat does the Garden say about spaced repetition\?/,
  );
});
