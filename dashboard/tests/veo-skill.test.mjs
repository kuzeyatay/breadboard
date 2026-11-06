import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";

process.env.HERMES_FIRST_PARTY_SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../hermes-skills/prebuilt");

test("Veo is Featured and attaches the subscription connection on both private chat surfaces", () => {
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const skill = listFirstPartySkills(surface, ["google-flow"]).find(skill => skill.slug === "veo");
    assert.ok(skill);
    assert.equal(skill.category, "Featured");
    assert.equal(skill.classification, "eligible_general");
    assert.equal(skill.availability, "ready", skill.unavailableReasons.join("; "));
    assert.deepEqual(skill.capabilityContract.requiredMcpServers, ["google-flow"]);
    assert.deepEqual(skill.capabilityContract.requiredTools, ["mcp_call", "artifact_import"]);
    assert.deepEqual(skill.capabilityContract.requiredArtifactKinds, ["video"]);
  }
});

test("Veo reports missing connection setup and stays unavailable on public Quartz", () => {
  const missing = listFirstPartySkills("garden_chat", []).find(skill => skill.slug === "veo");
  assert.notEqual(missing.availability, "ready");
  assert.ok(missing.compatibilityRequirements.some(requirement => requirement.target === "google-flow" && requirement.action === "connect_mcp"));
  const quartz = listFirstPartySkills("quartz_ai", ["google-flow"]).find(skill => skill.slug === "veo");
  assert.notEqual(quartz?.availability, "ready");
});
