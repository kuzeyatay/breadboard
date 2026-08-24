import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  UNLAZY_UPSTREAM_REVISION,
  unlazyDiagnostics,
} from "../src/lib/hermes/unlazy.ts";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(dashboardRoot, "..");

const baseDecision = {
  mode: "knowledge",
  requestedOutcome: "Answer a question",
  implementationRequired: false,
  decisionReason: "Knowledge task",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: [],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const diagnostics = unlazyDiagnostics();
assert.equal(diagnostics.present, true);
assert.equal(diagnostics.sourceRevision, UNLAZY_UPSTREAM_REVISION);
assert.equal(diagnostics.sourceRevision, "754d9a6");
assert.equal(
  path.normalize(diagnostics.manifestPath),
  path.join(repoRoot, "hermes-skills", "prebuilt", "unlazy", "SKILL.md"),
);

const manifest = fs.readFileSync(diagnostics.manifestPath, "utf8");
assert.match(manifest, /^---\r?\nname: unlazy\r?\n/);
assert.match(manifest, /source: https:\/\/github\.com\/Leonxlnx\/unlazy/);
assert.match(manifest, /upstream_revision: 754d9a6/);
assert.match(manifest, /trivial replies and single factual answers/i);
assert.match(manifest, /never grants[\s\S]*filesystem, shell, network/i);
assert.equal(
  fs.existsSync(
    path.join(repoRoot, "hermes-skills", "prebuilt", "unlazy", "LICENSE"),
  ),
  true,
);

for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
  const skill = listFirstPartySkills(surface).find(
    (candidate) => candidate.slug === "unlazy",
  );
  assert.ok(skill, `${surface} lost the internal Unlazy skill`);
  assert.equal(skill.enabled, true);
  assert.equal(skill.healthy, true);
  assert.equal(skill.classification, "eligible_general");
  assert.equal(skill.availability, "ready");
  assert.match(skill.contentHash ?? "", /^[a-f0-9]{64}$/);

  for (const mode of ["knowledge", "technical_read", "scoped_implementation"]) {
    const decision = {
      ...baseDecision,
      mode,
      selectedConditionalSkills: [],
    };
    const prompt = composeHermesSystemPrompt({
      surface,
      decision,
      userText: "hi",
    });
    assert.equal(
      prompt.match(/^# always_on_unlazy$/gm)?.length,
      1,
      `${surface}/${mode} did not receive exactly one Unlazy section`,
    );
    assert.match(prompt, /Pick the lightest honest mode/);
    assert.match(prompt, /Never claim a\s+file or runnable check exists/i);
    assert.ok(
      prompt.indexOf("# always_on_unlazy") <
        prompt.indexOf("# server_capability_decision"),
    );
    assert.deepEqual(
      decision.selectedConditionalSkills,
      [],
      "always-on guidance must not widen the capability decision",
    );
  }
}

const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
assert.match(gitignore, /^\/unlazy\/$/m);
assert.match(gitignore, /^\/\.unlazy\/$/m);

console.log("unlazy integration verification passed");
