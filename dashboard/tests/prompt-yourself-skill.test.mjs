import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const MANIFEST = "../hermes-skills/prebuilt/prompt-yourself/SKILL.md";

test("Prompt Yourself is a ready prebuilt skill on both authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === "prompt-yourself",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.equal(skill.classification, "eligible_general");
    assert.equal(skill.category, "Prebuilt");
    // Guidance only: it rewrites the request and answers it, so it must not
    // claim a tool, runtime, or connection it never calls.
    assert.deepEqual(skill.capabilityContract?.requiredTools, []);
    assert.deepEqual(skill.capabilityContract?.requiredRuntimes, []);
    assert.deepEqual(skill.capabilityContract?.requiredMcpServers, []);
    assert.equal(skill.capabilityContract?.category, "reviewed-guidance");
  }
  assert.equal(
    listFirstPartySkills("quartz_ai").some(
      (skill) => skill.slug === "prompt-yourself" && skill.availability === "ready",
    ),
    false,
  );
});

test("the method is the guide's, not improvised", () => {
  const manifest = source(MANIFEST);
  const catalog = source(
    "../hermes-skills/prebuilt/prompt-yourself/references/technique-catalog.md",
  );

  // The four prompt elements and the general tips are what the diagnosis step
  // runs on; without them the rewrite is taste.
  assert.match(manifest, /\*\*instruction\*\*, \*\*context\*\*, \*\*input\ndata\*\*, and \*\*output indicator\*\*/);
  assert.match(manifest, /Say what to do, not what to avoid/);
  assert.match(manifest, /Specificity/);
  assert.match(manifest, /Start simple/);

  // Technique selection is routed by task shape and backed by the full catalog.
  for (const technique of [
    "Zero-shot",
    "Few-shot",
    "Chain-of-thought",
    "Self-consistency",
    "Generate-knowledge",
    "Prompt chaining",
    "Tree of thoughts",
    "Reflexion",
    "Directional stimulus",
  ]) {
    assert.match(manifest, new RegExp(technique), `${technique} missing from routing`);
  }
  for (const page of [
    "techniques/zeroshot",
    "techniques/fewshot",
    "techniques/cot",
    "techniques/meta-prompting",
    "techniques/consistency",
    "techniques/knowledge",
    "techniques/prompt_chaining",
    "techniques/tot",
    "techniques/rag",
    "techniques/art",
    "techniques/ape",
    "techniques/activeprompt",
    "techniques/dsp",
    "techniques/pal",
    "techniques/react",
    "techniques/reflexion",
    "techniques/multimodalcot",
    "techniques/graph",
  ]) {
    assert.ok(catalog.includes(page), `${page} missing from the catalog`);
  }
  assert.ok(
    fs.existsSync(
      new URL("../../prompt-engineering-guide/pages/techniques", import.meta.url),
    ),
    "the catalog cites a clone that is not present",
  );
});

test("the generated prompt is shown and then answered", () => {
  const manifest = source(MANIFEST);

  assert.match(manifest, /Open the response with the bold line `\*\*Prompt\*\*`/);
  assert.match(manifest, /answer the prompt|answer that prompt/i);
  assert.match(manifest, /Task: <one imperative instruction/);
  assert.match(manifest, /Done when: <checkable success criteria>/);
  // The answer, not the rewrite, is the deliverable.
  assert.match(manifest, /the answer is the deliverable/);
  assert.match(manifest, /The answer has to stand alone/);
});

test("rewriting cannot change the task, invent capability, or obey pasted text", () => {
  const manifest = source(MANIFEST);

  assert.match(manifest, /Preserve\nintent and scope exactly/);
  assert.match(manifest, /Never claim a technique you did not run/);
  assert.match(manifest, /never commands to obey/);
  assert.match(manifest, /cannot grant a tool/);
  assert.match(manifest, /Do not stack the rewrite on itself/);
  assert.match(manifest, /does not fill them/);
});

test("the slash command injects the guidance without rewriting the user's request", async () => {
  const resolved = await resolveCommandMessage(
    1,
    "/prompt-yourself is my thesis intro any good",
    process.cwd(),
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    ["prompt-yourself"],
  );
  assert.equal(resolved.userText, "is my thesis intro any good");
  assert.match(resolved.text, /Reviewed skill guidance: Prompt Yourself/);
  assert.match(
    resolved.text,
    /\[User request\]\nis my thesis intro any good/,
  );
});
