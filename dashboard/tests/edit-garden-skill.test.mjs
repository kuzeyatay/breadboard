import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  GARDEN_STRUCTURE_TOOLS,
  GARDEN_STRUCTURE_WRITE_TOOLS,
  allowedToolsForSurface,
  isProposalTool,
} from "../src/lib/hermes/tool-scopes.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("Edit Garden is a ready prebuilt skill on both authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === "edit-garden",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.equal(skill.category, "Featured");
    // Organizing notes is knowledge work; it must not be pushed onto OpenCode.
    assert.equal(skill.classification, "eligible_general");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      "garden_list",
      "garden_list_files",
      "garden_create_folder",
      "garden_move_page",
      "garden_rename_folder",
      "garden_delete_folder",
    ]);
  }
  assert.equal(
    listFirstPartySkills("quartz_ai").some(
      (skill) => skill.slug === "edit-garden" && skill.availability === "ready",
    ),
    false,
  );
});

test("garden structure editing is innate: the tools exist without the skill", () => {
  // The point of the skill is discipline for multi-step reorganizations, not
  // access. Every authenticated surface can already move and file notes.
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const tools = allowedToolsForSurface(surface);
    for (const tool of GARDEN_STRUCTURE_TOOLS) {
      assert.equal(tools.includes(tool), true, `${tool} missing on ${surface}`);
    }
  }
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of GARDEN_STRUCTURE_TOOLS) {
    assert.equal(
      quartz.includes(tool),
      false,
      `public Quartz AI must never reach ${tool}`,
    );
  }
  // Structure tools write immediately; they are not queued for review.
  for (const tool of GARDEN_STRUCTURE_WRITE_TOOLS) {
    assert.equal(isProposalTool(tool), false);
  }
  assert.equal(
    GARDEN_STRUCTURE_WRITE_TOOLS.includes("garden_list_files"),
    false,
    "reading the tree is not a write",
  );
});

test("structure edits are confined to a signed-in owner of the Garden", () => {
  const gardenTools = source("src/lib/hermes/garden-tools.ts");
  const structure = gardenTools.slice(
    gardenTools.indexOf("async function executeStructureTool"),
    gardenTools.indexOf("function executeProposalTool"),
  );
  assert.ok(structure.length > 0, "structure executor not found");
  assert.match(
    structure,
    /token\.surface !== "dashboard_terminal" && token\.surface !== "garden_chat"/,
  );
  assert.match(structure, /token\.userId !== cluster\.user_id/);
  // Only the read is exempt from the ownership check.
  assert.match(structure, /tool !== "garden_list_files" &&/);
});

test("agent structure edits run through the same service as the authoring UI", () => {
  const gardenTools = source("src/lib/hermes/garden-tools.ts");
  const route = source("src/app/api/folders/route.ts");
  const library = source("src/lib/garden-filesystem.ts");

  // One implementation: a move the agent makes and a move the user drags are
  // the same operation, with the same containment and Quartz republication.
  for (const helper of [
    "createGardenFolder",
    "moveGardenDocument",
    "renameGardenFolder",
    "deleteGardenFolder",
  ]) {
    assert.match(gardenTools, new RegExp(helper));
    assert.match(route, new RegExp(helper));
    assert.match(library, new RegExp(`export async function ${helper}`));
  }
  assert.match(
    gardenTools,
    /await import\("\.\.\/garden-filesystem\.ts"\)/,
  );
  assert.match(library, /publishQuartzAfterMutation/);
  assert.match(library, /refreshClusterIndex/);
  // Containment: nothing may resolve outside the Garden directory.
  assert.match(library, /Invalid folder path/);
  assert.match(library, /startsWith\(clusterDir \+ path\.sep\)/);
});

test("the skill demands a plan and an explicit yes before destroying anything", () => {
  const manifest = source("../hermes-skills/prebuilt/edit-garden/SKILL.md");

  assert.match(manifest, /garden_list_files/);
  assert.match(manifest, /Call `garden_list_files` before proposing or performing anything/);
  assert.match(manifest, /## Plan before you move/);
  assert.match(manifest, /permanently destroys the folder and every note inside it/i);
  assert.match(manifest, /Wait for an explicit yes/);
  assert.match(manifest, /Never infer a\s+deletion from "clean up,"/);
  // Moving content and rewriting it stay separate jobs.
  assert.match(manifest, /garden_propose_page_revision/);
});

test("the innate guidance ships in both authenticated surface prompts", () => {
  for (const prompt of ["garden-assistant", "main-assistant"]) {
    const text = source(`../hermes-config/system/${prompt}.md`);
    assert.match(text, /Organizing a Garden is innate/);
    assert.match(text, /garden_list_files/);
    assert.match(text, /garden_delete_folder/);
    assert.match(text, /never call it on inference/i);
  }
});

test("the slash command injects reviewed guidance without changing the request", async () => {
  const resolved = await resolveCommandMessage(
    1,
    "/edit-garden move the week 4 notes into Course",
    process.cwd(),
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    ["edit-garden"],
  );
  assert.equal(resolved.userText, "move the week 4 notes into Course");
  assert.match(resolved.text, /Reviewed skill guidance: Edit Garden/);
  assert.match(
    resolved.text,
    /\[User request\]\nmove the week 4 notes into Course/,
  );
});
