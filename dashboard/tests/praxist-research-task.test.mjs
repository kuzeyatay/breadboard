import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";
import { prepareResearchTask } from "../src/lib/praxist/research-task.ts";

test("research tasks isolate each question and resolve real runtime roles without fixture evaluators", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "praxist-research-contract-"));
  try {
    const root = prepareResearchTask({ question: "Compare the supplied design alternatives", evidence: "Source A findings", reasoningEffort: "high" }, path.join(dir, "first"));
    const other = prepareResearchTask({ question: "Verify an unrelated financial calculation", evidence: "Source B findings", reasoningEffort: "low" }, path.join(dir, "second"));
    const config = yaml.load(fs.readFileSync(path.join(root, "task.yaml"), "utf8"));
    assert.equal(config.runner, undefined);
    assert.ok(!JSON.stringify(config).includes("fake"));
    assert.equal(config.praxist_plugins.workflow.stage, "workflow_stage:research_loop");
    assert.equal(fs.readFileSync(path.join(root, "evidence.md"), "utf8"), "Source A findings");
    assert.equal(fs.readFileSync(path.join(other, "question.md"), "utf8"), "Verify an unrelated financial calculation");
    for (const role of config.praxist_plugins.panel.roles) assert.ok(fs.existsSync(path.join(root, "roles", role.split(":")[1], "role.yaml")));
    const candidate = path.join(dir, "candidate.json"), output = path.join(dir, "receipt.json");
    fs.writeFileSync(candidate, JSON.stringify({ checks: [
      { label: "Correct check", expression: "(45 * 0.8) / 3", reported: 12, unit: "units", basis: "Illustrative inputs" },
      { label: "Wrong check", expression: "90 - 25", reported: 70, unit: "units", basis: "Illustrative inputs" },
      { label: "Not arithmetic", expression: "__import__('os').getcwd()", reported: 1, unit: "units", basis: "Rejected" },
    ] }));
    const python = path.resolve(process.cwd(), process.cwd().endsWith("dashboard") ? "../PRAXIST/.venv/Scripts/python.exe" : "PRAXIST/.venv/Scripts/python.exe");
    const execution = spawnSync(fs.existsSync(python) ? python : "python", [path.join(root, "evaluations/arithmetic/run.py"), "--candidate", candidate, "--output", output], { encoding: "utf8", windowsHide: true });
    assert.equal(execution.status, 0, execution.stderr);
    const receipt = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(receipt.metrics.verified_checks, 1);
    assert.equal(receipt.scored_complete, true);
    assert.equal(receipt.completed_required_eval_units, 3);
    assert.equal(receipt.total_required_eval_units, 3);
    assert.equal(config.evaluation.maturity_policy.require_ratio_gate, true);
    assert.deepEqual(receipt.checks.map(check => check.passed), [true, false, false]);
    assert.match(receipt.limitation, /scientific validity require independent review/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
