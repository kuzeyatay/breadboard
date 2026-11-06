import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-graph-skill-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const { listFirstPartySkills } = await import("../src/lib/hermes/skills.ts");
const { registryItemsForUser, resolveCommandMessage } = await import("../src/lib/hermes/commands.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

for (const surface of ["dashboard_terminal", "garden_chat"]) {
  test(`/graph is executable knowledge work and appears in the ${surface} command picker`, () => {
    const skill = listFirstPartySkills(surface).find((item) => item.slug === "graph");
    assert.ok(skill);
    assert.equal(skill.classification, "eligible_general");
    assert.equal(skill.availability, "ready", skill.unavailableReasons.join("; "));
    assert.ok(skill.enabled && skill.healthy);
    assert.ok(skill.capabilityContract.requiredTools.includes("terminal_execute_command"));
    assert.ok(skill.capabilityContract.requiredTools.includes("workspace_write"));
    assert.ok(skill.capabilityContract.requiredTools.includes("artifact_import"));
    assert.deepEqual(skill.capabilityContract.requiredArtifactKinds, ["image"]);

    const item = registryItemsForUser(null, { mode: "knowledge", surface })
      .find((candidate) => candidate.slug === "graph");
    assert.ok(item);
    // The picker adds the slash; tokens themselves are stored without it.
    assert.equal(item.token, "graph");
    assert.equal(item.requiresOpenCode, false);
  });

  test(`/graph preserves the request and injects the complete MATLAB workflow on ${surface}`, async () => {
    const request = "plot sin(x) and cos(x) from 0 to 2*pi with a legend";
    const resolved = await resolveCommandMessage(null, `/graph ${request}`, undefined, {
      mode: "knowledge", surface,
    });
    assert.equal(resolved.userText, request);
    assert.deepEqual(resolved.invocations.map(({ kind, slug }) => [kind, slug]), [["skill", "graph"]]);
    const manifest = fs.readFileSync(new URL("../../hermes-skills/prebuilt/graph/SKILL.md", import.meta.url), "utf8");
    assert.ok(resolved.text.includes(manifest));
  });
}

test("the MATLAB workflow is unavailable on the read-only Quartz surface", () => {
  const skill = listFirstPartySkills("quartz_ai").find((item) => item.slug === "graph");
  assert.ok(skill);
  assert.equal(skill.availability, "unavailable");
  assert.ok(!registryItemsForUser(null, { mode: "knowledge", surface: "quartz_ai" })
    .some((item) => item.slug === "graph"));
});
