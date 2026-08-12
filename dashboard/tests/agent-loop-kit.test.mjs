import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_LOOP_COMMANDS,
  containedWorkspacePath,
  resolveAgentLoopRuntime,
  runAgentLoopKit,
  validateAgentLoopArguments,
} from "../src/lib/hermes/agent-loop-service.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import {
  listApprovedSkills,
  listFirstPartySkills,
  listInstalledLocalSkills,
} from "../src/lib/hermes/skills.ts";
import { agentLoopCommandText } from "../src/lib/hermes/agent-loop-intent.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";

const workspaces = [];

function workspace(prefix = "bb-agent-loop-") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  workspaces.push(directory);
  return directory;
}

test.after(() => {
  for (const directory of workspaces) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Agent loop engineering is a ready installed skill on authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listApprovedSkills(surface).find(
      (candidate) => candidate.slug === "agent-loop-engineering",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    // The reviewed registry pins the manifest hash, so edited guidance
    // disables the skill instead of shipping silently.
    assert.equal(skill.enabled, true);
    assert.equal(skill.healthy, true);
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      "agent_loop_run",
      "artifact_create",
      "artifact_render",
    ]);
  }
  assert.equal(
    listApprovedSkills("quartz_ai").some(
      (candidate) =>
        candidate.slug === "agent-loop-engineering" &&
        candidate.availability === "ready",
    ),
    false,
  );
});

test("Agent loop engineering lives in the reviewed install store", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.equal(
      listFirstPartySkills(surface).some(
        (candidate) => candidate.slug === "agent-loop-engineering",
      ),
      false,
      `it must not appear in the Prebuilt tab on ${surface}`,
    );
    assert.equal(
      listInstalledLocalSkills(surface).some(
        (candidate) => candidate.slug === "agent-loop-engineering",
      ),
      true,
      `it must appear as an install on ${surface}`,
    );
  }
});

test("agent_loop_run is scoped to Terminal and Garden Chat", () => {
  assert.equal(
    allowedToolsForSurface("dashboard_terminal").includes("agent_loop_run"),
    true,
  );
  assert.equal(
    allowedToolsForSurface("garden_chat").includes("agent_loop_run"),
    true,
  );
  assert.equal(
    allowedToolsForSurface("quartz_ai").includes("agent_loop_run"),
    false,
  );
});

test("Only the kit's contract commands are reachable", () => {
  assert.deepEqual(AGENT_LOOP_COMMANDS, [
    "init",
    "validate",
    "score",
    "evaluate",
    "dry-run",
    "render-receipt",
    "privacy-scan",
  ]);
  const root = workspace();
  assert.deepEqual(
    validateAgentLoopArguments(["validate", "loops/a.yaml", "--json"], root),
    { command: "validate", args: ["validate", "--json", "loops/a.yaml"] },
  );
  assert.deepEqual(
    validateAgentLoopArguments(
      ["dry-run", "a.yaml", "--out", "runs/1", "--min-score", "90"],
      root,
    ),
    {
      command: "dry-run",
      args: ["dry-run", "--out", "runs/1", "--min-score", "90", "a.yaml"],
    },
  );
  // `smoke` shells out to bash and pytest in the working directory upstream.
  assert.throws(
    () => validateAgentLoopArguments(["smoke"], root),
    /is not available/i,
  );
  assert.throws(
    () => validateAgentLoopArguments(["dry-run", "a.yaml"], root),
    /requires --out/i,
  );
  assert.throws(
    () => validateAgentLoopArguments(["validate", "a.yaml", "--quiet"], root),
    /--quiet is not available/i,
  );
  assert.throws(
    () =>
      validateAgentLoopArguments(
        ["dry-run", "a.yaml", "--out", "runs/1", "--min-score", "200"],
        root,
      ),
    /--min-score/i,
  );
  assert.throws(
    () => validateAgentLoopArguments(["render-receipt"], root),
    /exactly 1 workspace/i,
  );
});

test("Every path argument is contained inside the conversation workspace", () => {
  const root = workspace();
  assert.equal(containedWorkspacePath(root, "loops/spec.yaml"), "loops/spec.yaml");
  assert.equal(containedWorkspacePath(root, "loops\\spec.yaml"), "loops/spec.yaml");
  // The workspace root itself is contained, not an escape.
  assert.equal(containedWorkspacePath(root, "."), ".");
  for (const escape of [
    "../secrets.yaml",
    "loops/../../secrets.yaml",
    "/etc/passwd",
    "C:/Users/someone/.ssh/id_rsa",
    "~/.ssh/id_rsa",
  ]) {
    assert.throws(
      () => containedWorkspacePath(root, escape),
      /must stay inside/i,
      escape,
    );
  }
  // The same containment applies through the argv validator, including flags.
  assert.throws(
    () => validateAgentLoopArguments(["privacy-scan", "C:/"], root),
    /must stay inside/i,
  );
  assert.throws(
    () =>
      validateAgentLoopArguments(
        ["dry-run", "a.yaml", "--out=../elsewhere"],
        root,
      ),
    /must stay inside/i,
  );
});

test("Loop intent is explicit and never hijacks a scheduling request", async () => {
  const command = agentLoopCommandText({
    text: "Help me turn this into an agent loop I can trust",
    surface: "dashboard_terminal",
    authenticated: true,
  });
  assert.equal(command.automatic, true);
  assert.equal(
    command.text,
    "/agent-loop-engineering Help me turn this into an agent loop I can trust",
  );
  const resolved = await resolveCommandMessage(1, command.text, process.cwd(), {
    mode: "knowledge",
    surface: "dashboard_terminal",
  });
  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    ["agent-loop-engineering"],
  );
  assert.match(
    resolved.text,
    /Reviewed skill guidance: agent-loop-engineering/,
  );
  // Breadboard's own scheduler owns recurrence wording.
  assert.equal(
    agentLoopCommandText({
      text: "Send me a briefing every morning at 8",
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    false,
  );
  // A turn that already carries a capability token keeps it.
  assert.equal(
    agentLoopCommandText({
      text: "/premortem review the loop spec",
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    false,
  );
  assert.equal(
    agentLoopCommandText({
      text: "raise max_iterations to 3",
      surface: "garden_chat",
      authenticated: true,
      priorMessages: [{
        role: "assistant",
        content: "The stop conditions and human gates are set; review them.",
      }],
    }).automatic,
    true,
  );
  assert.equal(
    agentLoopCommandText({
      text: "What is the weather?",
      surface: "dashboard_terminal",
      authenticated: true,
      priorMessages: [{
        role: "assistant",
        content: "The loop spec is ready for review.",
      }],
    }).automatic,
    false,
  );
  assert.equal(
    agentLoopCommandText({
      text: "design an agent loop",
      surface: "quartz_ai",
      authenticated: false,
    }).automatic,
    false,
  );
});

test("The cloned kit runs its golden path inside an isolated workspace", async (t) => {
  const runtime = resolveAgentLoopRuntime();
  if (!runtime) {
    t.skip(
      "agent-loop-engineering-kit/.venv is not prepared in this environment",
    );
    return;
  }
  const root = workspace();

  const created = await runAgentLoopKit({
    arguments: ["init", "loops/daily.yaml"],
    workspaceDirectory: root,
    runtime,
  });
  assert.equal(created.exitCode, 0);
  assert.equal(fs.existsSync(path.join(root, "loops", "daily.yaml")), true);

  const validated = await runAgentLoopKit({
    arguments: ["validate", "loops/daily.yaml", "--json"],
    workspaceDirectory: root,
    runtime,
  });
  assert.equal(validated.exitCode, 0);
  assert.equal(JSON.parse(validated.stdout).ok, true);

  const scored = await runAgentLoopKit({
    arguments: ["score", "loops/daily.yaml", "--json"],
    workspaceDirectory: root,
    runtime,
  });
  assert.equal(typeof JSON.parse(scored.stdout).results[0].score, "number");

  const dryRun = await runAgentLoopKit({
    arguments: ["dry-run", "loops/daily.yaml", "--out", "runs/first", "--json"],
    workspaceDirectory: root,
    runtime,
  });
  assert.equal(dryRun.exitCode, 0);
  assert.equal(JSON.parse(dryRun.stdout).ok, true);
  assert.equal(
    fs.existsSync(path.join(root, "runs", "first", "run-record.yaml")),
    true,
  );

  const receipt = await runAgentLoopKit({
    arguments: ["render-receipt", "runs/first/run-record.yaml"],
    workspaceDirectory: root,
    runtime,
  });
  assert.match(receipt.stdout, /# Loop Run Receipt/);
  // A dry run is a contract check, never an execution of the loop's task.
  assert.match(receipt.stdout, /Status: `DRY_RUN`/);

  const scan = await runAgentLoopKit({
    arguments: ["privacy-scan", "loops", "--json"],
    workspaceDirectory: root,
    runtime,
  });
  assert.equal(JSON.parse(scan.stdout).ok, true);

  // A second conversation's workspace shares no state with the first.
  const other = workspace("bb-agent-loop-other-");
  await assert.rejects(
    runAgentLoopKit({
      arguments: ["validate", "loops/daily.yaml", "--json"],
      workspaceDirectory: other,
      runtime,
    }).then((result) => {
      assert.notEqual(result.exitCode, 0);
      throw new Error("expected a missing-spec failure");
    }),
    /expected a missing-spec failure/,
  );
});
