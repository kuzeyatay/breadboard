import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";

process.env.HERMES_FIRST_PARTY_SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../hermes-skills/prebuilt");

test("Blender is a native Featured skill on both private chat surfaces", () => {
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const skill = listFirstPartySkills(surface, ["blender"]).find(skill => skill.slug === "blender");
    assert.ok(skill);
    assert.equal(skill.category, "Featured");
    assert.equal(skill.classification, "eligible_general");
    assert.equal(skill.availability, "ready", skill.unavailableReasons.join("; "));
    assert.deepEqual(skill.capabilityContract.requiredMcpServers, ["blender"]);
    assert.deepEqual(skill.capabilityContract.requiredTools, ["mcp_call", "artifact_import"]);
    assert.deepEqual(skill.capabilityContract.requiredArtifactKinds, ["image", "model"]);
  }
});

test("Blender requires its connection and cannot run on public Quartz", () => {
  const missing = listFirstPartySkills("garden_chat", []).find(skill => skill.slug === "blender");
  assert.equal(missing.availability, "unavailable");
  assert.ok(missing.compatibilityRequirements.some(requirement => requirement.target === "blender" && requirement.action === "connect_mcp"));
  const quartz = listFirstPartySkills("quartz_ai", ["blender"]).find(skill => skill.slug === "blender");
  assert.notEqual(quartz?.availability, "ready");
});
