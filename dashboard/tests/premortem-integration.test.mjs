import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolvePremortemRuntime,
  runPremortem,
  validatePremortemArguments,
} from "../src/lib/hermes/premortem-service.ts";
import {
  allowedToolsForSurface,
} from "../src/lib/hermes/tool-scopes.ts";
import {
  listApprovedSkills,
  listFirstPartySkills,
  listInstalledLocalSkills,
} from "../src/lib/hermes/skills.ts";
import {
  premortemCommandText,
} from "../src/lib/hermes/premortem-intent.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";

test("Premortem is a ready installed skill on authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listApprovedSkills(surface).find(
      (candidate) => candidate.slug === "premortem",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    // Integrity is pinned by the reviewed registry, so an edited SKILL.md
    // disables the skill instead of silently shipping unreviewed guidance.
    assert.equal(skill.enabled, true);
    assert.equal(skill.healthy, true);
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      "premortem_run",
      "artifact_create",
      "artifact_render",
    ]);
  }
  assert.equal(
    listApprovedSkills("quartz_ai").some(
      (candidate) =>
        candidate.slug === "premortem" &&
        candidate.availability === "ready",
    ),
    false,
  );
});

test("Premortem lives in the reviewed install store, not the prebuilt set", () => {
  assert.equal(
    fs.existsSync(
      new URL("../../hermes-skills/prebuilt/premortem", import.meta.url),
    ),
    false,
    "premortem must no longer ship as a prebuilt skill",
  );
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.equal(
      listFirstPartySkills(surface).some(
        (candidate) => candidate.slug === "premortem",
      ),
      false,
      `premortem must not appear in the Prebuilt tab on ${surface}`,
    );
    assert.equal(
      listInstalledLocalSkills(surface).some(
        (candidate) => candidate.slug === "premortem",
      ),
      true,
      `premortem must appear as an install on ${surface}`,
    );
  }
});

test("Premortem tool scope is Terminal and Garden only", () => {
  assert.equal(
    allowedToolsForSurface("dashboard_terminal").includes("premortem_run"),
    true,
  );
  assert.equal(
    allowedToolsForSurface("garden_chat").includes("premortem_run"),
    true,
  );
  assert.equal(
    allowedToolsForSurface("quartz_ai").includes("premortem_run"),
    false,
  );
});

test("Premortem command policy allows workflow operations and denies escape hatches", () => {
  assert.deepEqual(validatePremortemArguments(["agent-start"]), ["agent-start"]);
  assert.deepEqual(
    validatePremortemArguments([
      "graph",
      "add-node",
      "--label",
      "Partner trust erodes",
    ]),
    ["graph", "add-node", "--label", "Partner trust erodes"],
  );
  assert.throws(
    () => validatePremortemArguments(["persona", "delete", "p001"]),
    /subcommand is not available/i,
  );
  assert.throws(
    () => validatePremortemArguments(["init", "--force"]),
    /--force is not available/i,
  );
  assert.throws(
    () => validatePremortemArguments(["job", "generate", "personas"]),
    /command is not available/i,
  );
  assert.throws(
    () => validatePremortemArguments(["status", "--project-dir", "../other"]),
    /--project-dir is not available/i,
  );
  assert.throws(
    () => validatePremortemArguments(["report", "generate", "--output=../other.md"]),
    /--output=..\/other\.md is not available/i,
  );
});

test("Premortem intent starts explicitly and stays selected across approval turns", async () => {
  const command = premortemCommandText({
    text: "Run a premortem for our September launch",
    surface: "dashboard_terminal",
    authenticated: true,
  });
  assert.deepEqual(
    command,
    {
      text: "/premortem Run a premortem for our September launch",
      automatic: true,
    },
  );
  const resolved = await resolveCommandMessage(
    1,
    command.text,
    process.cwd(),
    {
      mode: "knowledge",
      surface: "dashboard_terminal",
    },
  );
  assert.deepEqual(
    resolved.invocations.map((invocation) => invocation.slug),
    ["premortem"],
  );
  assert.match(resolved.text, /Reviewed skill guidance: premortem/);
  assert.equal(
    premortemCommandText({
      text: "approved, continue",
      surface: "garden_chat",
      authenticated: true,
      priorMessages: [{
        role: "assistant",
        content: "Please approve or edit this completed-fact failure statement.",
      }],
    }).automatic,
    true,
  );
  assert.equal(
    premortemCommandText({
      text: "What is the weather?",
      surface: "dashboard_terminal",
      authenticated: true,
      priorMessages: [{
        role: "assistant",
        content: "The causal graph is ready for review.",
      }],
    }).automatic,
    false,
  );
  assert.equal(
    premortemCommandText({
      text: "/interactive-visualizer show the graph",
      surface: "dashboard_terminal",
      authenticated: true,
    }).automatic,
    false,
  );
  assert.equal(
    premortemCommandText({
      text: "Run a premortem",
      surface: "quartz_ai",
      authenticated: false,
    }).automatic,
    false,
  );
});

test("Premortem adapter invokes the cloned CLI with conversation-local state", async () => {
  const runtime = resolvePremortemRuntime();
  assert.ok(runtime, "the cloned Premortem runtime should be prepared");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bb-premortem-"));
  const otherWorkspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "bb-premortem-other-"),
  );
  try {
    const start = await runPremortem({
      arguments: ["agent-start"],
      workspaceDirectory: workspace,
      runtime,
    });
    assert.equal(start.exitCode, 0);
    assert.equal(start.envelope.ok, true);
    assert.equal(start.envelope.schema_version, "1.0");
    assert.equal(start.envelope.data.state.project_exists, false);

    const initialized = await runPremortem({
      arguments: [
        "init",
        "--initiative",
        "Conversation-scoped launch",
        "--failure",
        "The launch failed to reach its users and damaged partner confidence.",
        "--description",
        "A deterministic adapter integration fixture.",
      ],
      workspaceDirectory: workspace,
      runtime,
    });
    assert.equal(initialized.envelope.ok, true);
    assert.equal(fs.existsSync(path.join(workspace, ".premortem")), true);

    const isolatedStatus = await runPremortem({
      arguments: ["status"],
      workspaceDirectory: otherWorkspace,
      runtime,
    });
    assert.equal(isolatedStatus.envelope.ok, false);
    assert.equal(isolatedStatus.envelope.error.code, "ID_NOT_FOUND");
    assert.equal(
      fs.existsSync(path.join(otherWorkspace, ".premortem")),
      false,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(otherWorkspace, { recursive: true, force: true });
  }
});
