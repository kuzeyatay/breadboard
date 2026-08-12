import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const identity = await import("../src/lib/career-ops/identity.ts");
const {
  availableScripts,
  looksLikePath,
  parseCommand,
  resolveInsideRoot,
  resolveReadablePath,
  resolveWritablePath,
} = await import("../src/lib/career-ops/commands.ts");
const { modeFilePath } = await import("../src/lib/career-ops/skill-prompt.ts");

const source = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

/**
 * A miniature career-ops clone. The policy is defined against the real one's
 * shape — root-level .mjs scripts, a modes/ tree, data/reports/output — so a
 * fixture is enough and the tests never depend on the user's own workspace.
 */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-career-ops-"));
for (const dir of ["modes", "modes/interview", "data", "reports", "output", "config", "docs"]) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
}
for (const script of [
  "tracker.mjs",
  "set-status.mjs",
  "generate-pdf.mjs",
  "doctor.mjs",
  "update-system.mjs",
  "openai-eval.mjs",
  "test-all.mjs",
  "set-status-tests.mjs",
]) {
  fs.writeFileSync(path.join(ROOT, script), "// fixture\n");
}
fs.writeFileSync(path.join(ROOT, "modes", "tracker.md"), "# tracker\n");
fs.writeFileSync(path.join(ROOT, "modes", "interview", "plan.md"), "# plan\n");
fs.writeFileSync(path.join(ROOT, "modes", "_shared.md"), "# shared\n");
fs.writeFileSync(path.join(ROOT, "cv.md"), "# cv\n");

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const parse = (command) => parseCommand(command, ROOT);
const refusal = (command) => {
  const decision = parse(command);
  assert.equal(decision.ok, false, `expected "${command}" to be refused`);
  return decision.reason;
};
const accepted = (command) => {
  const decision = parse(command);
  assert.equal(decision.ok, true, `expected "${command}" to be accepted`);
  return decision.command;
};

test("Career Ops has one canonical slash command", () => {
  assert.equal(identity.CAREER_OPS_COMMAND, "/agents:career-ops");
  assert.equal(
    identity.careerOpsUserMessage("evaluate this posting"),
    "/agents:career-ops evaluate this posting",
  );
  assert.equal(
    identity.taskFromCareerOpsCommand("  /AGENTS:CAREER-OPS  tracker "),
    "tracker",
  );
  assert.equal(identity.taskFromCareerOpsCommand("/agents:career-ops"), "");
  assert.equal(identity.taskFromCareerOpsCommand("/agents:agent-reach task"), null);
});

test("stacked slash tokens survive the command split", () => {
  // The capability resolver has to still see a stacked token, so it is kept in
  // front of the task rather than swallowed by it.
  assert.equal(
    identity.taskFromCareerOpsCommand("/my-skill /agents:career-ops tracker"),
    "/my-skill tracker",
  );
});

test("the request parser recognizes router modes and leaves prose alone", () => {
  assert.deepEqual(identity.parseCareerOpsRequest("tracker"), {
    task: "tracker",
    mode: "tracker",
    argument: "",
  });
  assert.deepEqual(identity.parseCareerOpsRequest("cover acme-engineer"), {
    task: "cover acme-engineer",
    mode: "cover",
    argument: "acme-engineer",
  });
  // Both spellings of a nested mode reach the same file.
  assert.equal(identity.parseCareerOpsRequest("interview plan tomorrow").mode, "interview/plan");
  assert.equal(identity.parseCareerOpsRequest("interview/plan tomorrow").mode, "interview/plan");
  // Upstream documents every example with its own /career-ops prefix.
  assert.equal(identity.parseCareerOpsRequest("/career-ops scan").mode, "scan");
  // A pasted posting is not a mode: the router decides it is auto-pipeline.
  const pasted = identity.parseCareerOpsRequest("We are looking for a Senior Engineer at Acme");
  assert.equal(pasted.mode, null);
  assert.match(pasted.task, /^We are looking/);
});

test("only the clone's own scripts run, and only through Node", () => {
  assert.deepEqual(accepted("node tracker.mjs").args, ["tracker.mjs"]);
  // The bare form appears in some mode files; it means the same thing.
  assert.deepEqual(accepted("tracker.mjs").args, ["tracker.mjs"]);
  assert.deepEqual(accepted("node set-status.mjs 42 Applied --on 2026-08-01").args, [
    "set-status.mjs",
    "42",
    "Applied",
    "--on",
    "2026-08-01",
  ]);
  assert.match(refusal("node missing-script.mjs"), /no missing-script\.mjs/);
  assert.match(refusal("npm run tracker"), /Package managers are not available/);
  assert.match(refusal("./cops doctor"), /Docker/);
  assert.match(refusal("rm -rf data"), /Only career-ops's own scripts/);
  assert.match(refusal("node ../../evil.mjs"), /Only career-ops's own scripts/);
});

test("no command reaches a shell", () => {
  assert.match(refusal("node tracker.mjs && rm -rf /"), /Chaining and redirection/);
  assert.match(refusal("node tracker.mjs > out.txt"), /Chaining and redirection/);
  assert.match(refusal("node tracker.mjs $(whoami)"), /Command substitution/);
  assert.match(refusal("node tracker.mjs\nnode doctor.mjs"), /one single-line command/);
});

test("scripts that leave the job get refused with a reason", () => {
  assert.match(refusal("node update-system.mjs apply"), /the user's decision/);
  assert.match(refusal("node openai-eval.mjs"), /Breadboard is already the model layer/);
  assert.match(refusal("node test-all.mjs"), /test harnesses/);
  assert.match(refusal("node set-status-tests.mjs"), /test harnesses/);
  // …and they never appear in the list the prompt advertises.
  const scripts = availableScripts(ROOT);
  assert.ok(scripts.includes("tracker.mjs"));
  assert.ok(!scripts.includes("update-system.mjs"));
  assert.ok(!scripts.includes("test-all.mjs"));
  assert.ok(!scripts.includes("set-status-tests.mjs"));
});

test("path arguments are confined to the workspace", () => {
  assert.deepEqual(accepted("node generate-pdf.mjs cv.html output/cv.pdf").args, [
    "generate-pdf.mjs",
    "cv.html",
    "output/cv.pdf",
  ]);
  assert.match(refusal("node generate-pdf.mjs cv.html ../../escape.pdf"), /outside the career-ops/);
  assert.match(
    refusal(`node generate-pdf.mjs cv.html ${path.join(os.tmpdir(), "escape.pdf")}`),
    /outside the career-ops/,
  );
  // Free text and URLs are not paths and must pass through untouched.
  assert.ok(!looksLikePath("Head of Applied AI"));
  assert.ok(!looksLikePath("https://acme.com/jobs/123"));
  assert.ok(!looksLikePath("--summary"));
  assert.ok(looksLikePath("data/applications.md"));
  assert.deepEqual(accepted('node tracker.mjs "Head of Applied AI"').args, [
    "tracker.mjs",
    "Head of Applied AI",
  ]);
});

test("writes reach user data and nothing else", () => {
  assert.equal(resolveWritablePath("reports/042-acme.md", ROOT).ok, true);
  assert.equal(resolveWritablePath("data/applications.md", ROOT).ok, true);
  assert.equal(resolveWritablePath("cv.md", ROOT).ok, true);
  assert.equal(resolveWritablePath("modes/_custom.md", ROOT).ok, true);
  // A run that could rewrite the scripts could rewrite its own policy, and one
  // that could rewrite a mode file could rewrite its own brief.
  assert.equal(resolveWritablePath("set-status.mjs", ROOT).ok, false);
  assert.equal(resolveWritablePath("modes/oferta.md", ROOT).ok, false);
  assert.equal(resolveWritablePath("package.json", ROOT).ok, false);
  assert.equal(resolveWritablePath("../escape.md", ROOT).ok, false);
});

test("reads cover the workspace but never its secrets", () => {
  assert.equal(resolveReadablePath("docs/SCRIPTS.md", ROOT).ok, true);
  assert.equal(resolveReadablePath("modes/tracker.md", ROOT).ok, true);
  assert.equal(resolveReadablePath(".env", ROOT).ok, false);
  assert.equal(resolveReadablePath(".env.local", ROOT).ok, false);
  assert.equal(resolveReadablePath("node_modules/js-yaml/index.js", ROOT).ok, false);
  assert.equal(resolveReadablePath("../secrets.txt", ROOT).ok, false);
  assert.equal(resolveInsideRoot("reports", ROOT).relative, "reports");
});

test("a mode argument cannot walk out of modes/", () => {
  assert.equal(modeFilePath(ROOT, "tracker"), path.join(ROOT, "modes", "tracker.md"));
  assert.equal(
    modeFilePath(ROOT, "interview/plan"),
    path.join(ROOT, "modes", "interview", "plan.md"),
  );
  assert.equal(modeFilePath(ROOT, "../cv"), null);
  assert.equal(modeFilePath(ROOT, "a/b/c"), null);
  assert.equal(modeFilePath(ROOT, "nonexistent"), null);
});

test("ChatMock's inlined reasoning never reaches the transcript", async () => {
  const { splitReasoning } = await import("../src/lib/career-ops/run-manager.ts");
  const split = splitReasoning("<think>weighing the score</think>Global: 4.2/5");
  assert.equal(split.thinking, "weighing the score");
  assert.equal(split.answer, "Global: 4.2/5");
  // A reply cut off mid-reasoning must not leak the open block as the answer.
  assert.equal(splitReasoning("<think>still deciding").answer, "");
});

test("Career Ops is registered as a runtime agent everywhere it is reachable", async () => {
  const { runtimeAgentById, runtimeAgentByToken } = await import(
    "../src/lib/hermes/capability-combinations.ts"
  );
  const agent = runtimeAgentById("career-ops");
  assert.ok(agent, "career-ops must be a known runtime agent");
  assert.equal(agent.command, identity.CAREER_OPS_COMMAND);
  assert.equal(runtimeAgentByToken("agents:career-ops")?.id, "career-ops");
  // Both chat surfaces have a runner, so both must be declared.
  assert.deepEqual([...agent.surfaces].sort(), ["dashboard_terminal", "garden_chat"]);

  const { EXTERNAL_AGENT_RUN_KINDS, parseExternalAgentRun, externalAgentMessageFields } =
    await import("../src/lib/conversations/external-agent-runs.ts");
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("career_ops"));
  const run = parseExternalAgentRun({ kind: "career_ops", runId: "corun_1", task: "tracker" });
  assert.deepEqual(run, { kind: "career_ops", runId: "corun_1", task: "tracker" });
  assert.deepEqual(
    externalAgentMessageFields({
      externalAgent: true,
      externalAgentRun: run,
      externalAgentOutcome: "running",
    }).careerOpsRun,
    { runId: "corun_1", task: "tracker" },
  );
});

test("both chat surfaces route the command and render the run", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const [name, text] of [
    ["terminal", terminal],
    ["garden chat", garden],
  ]) {
    assert.match(text, /taskFromCareerOpsCommand/, `${name} must route the slash command`);
    assert.match(text, /\/api\/career-ops\/runs/, `${name} must start the run`);
    // Persisting the run kind is what makes the card survive a reload; the two
    // surfaces reach it differently (a run descriptor vs. a message field).
    assert.match(
      text,
      /career_ops|careerOpsRun/,
      `${name} must persist the run on the turn`,
    );
  }
  assert.match(garden, /InlineCareerOpsRun/, "garden chat must render the run card");
  assert.match(
    source("src/app/components/hermes/agent-runtime-panel.tsx"),
    /InlineCareerOpsRun/,
    "the terminal transcript must render the run card",
  );
  assert.match(
    source("src/app/components/hermes/command-hub.tsx"),
    /CAREER_OPS_COMMAND/,
    "the slash palette must offer the agent",
  );
  assert.match(
    source("src/app/components/hermes/agent-settings-dialog.tsx"),
    /CareerOpsSetup/,
    "the agent's settings panel must carry the setup only the user can authorize",
  );
});

test("the run manager never spawns anything but Node, and never a shell", () => {
  const manager = source("src/lib/career-ops/run-manager.ts");
  const runtime = source("src/lib/career-ops/runtime.ts");
  // Every command goes through the policy before a process exists.
  assert.match(manager, /parseCommand\(raw, run\.root\)/);
  assert.ok(!/shell:\s*true/.test(manager), "the run manager must never use a shell");
  assert.ok(!/shell:\s*true/.test(runtime), "the runtime must never use a shell");
  assert.match(runtime, /spawn\(process\.execPath/);
});
