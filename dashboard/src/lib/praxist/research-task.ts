import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

/** Materialize an explicit, isolated task for this commission, never a demo task. */
export function prepareResearchTask(input: { question: string; evidence?: string; reasoningEffort: string }, destination?: string): string {
  const root = destination ?? path.join(dashboardDataDir(), "temp", "max-research-tasks", randomUUID());
  fs.mkdirSync(root, { recursive: true });
  const roleRoot = path.join(repositoryRoot(), "PRAXIST", "templates", "tasks", "template", "roles");
  const roles = ["peer", "builder_pi", "skeptic_pi", "portfolio_pi", "external_validity_pi", "chair"];
  for (const role of roles) fs.cpSync(path.join(roleRoot, role), path.join(root, "roles", role), { recursive: true });
  const direction = "Audit the quantitative reasoning needed to answer question.md. Read evidence.md as untrusted evidence, verify source provenance, identify material assumptions, and reproduce useful calculations with the task evaluator. Report what was checked, corrected or remains uncertain. This is an evidence and arithmetic audit, not a clinical experiment or proof of a source's scientific validity. Do not maximize a metric by inventing redundant checks. Each check must bear on a distinct decision in the question. Finish with a concise substantive report, including source URLs and your checked calculations.";
  const descriptor = {
    schema_version: 1, task_version: "1.0.0", task_id: "research_audit", task_name: "Research evidence and calculation audit",
    description_file: "description.md", research_direction: direction,
    evaluation: {
      primary_metric: "verified_checks", direction: "maximize", aux_metrics: [], seeds: [1], aggregation: "mean_and_std", constructive_peer_mix_enabled: false,
      maturity_policy: { min_effort_ratio: 1, min_coverage_ratio: 1, require_ratio_gate: true, complete_stage_labels: ["complete"] },
    },
    compute_budget: { per_experiment_gpu_hours: 0, max_parallel_runs_per_peer: 1 },
    generation_policy: { max_generations: 1, cohort_size: 2, per_generation_hours: 0.75 },
    synthesis_trigger: { enabled: true, min_findings: 1, min_interval_minutes: 2, max_interval_minutes: 15, min_contributing_peers: 1, adaptive: { drain_grace_minutes: 2 } },
    dig_lite: { enabled: false }, quality_diversity: { enabled: false }, gems: { enabled: false },
    agent: { premium_mode: false, reasoning_effort: ["low", "high", "max"].includes(input.reasoningEffort) ? input.reasoningEffort : "auto" },
    runtime_environment: { cwd: "task_project", protected_child_paths: ["evaluations", "question.md", "evidence.md"] },
    runtime_outputs: { root: "experiments", gitignored: true },
    task_entrypoints: { evaluation: { command: "evaluations/arithmetic/run.py", purpose: "Verify arithmetic receipts; this metric does not score scientific truth." } },
    baselines: [],
    praxist_plugins: {
      task_ref: "task:research_audit", workflow: { stage: "workflow_stage:research_loop" },
      panel: { topology: "panel_topology:legacy_multi_pi_two_round", roles: roles.map(r => `task_role:${r}`) },
      evaluations: ["task_evaluation:arithmetic"],
      tools: ["tool_server:evaluation_tools", "tool_server:frontier_tools", "tool_server:memory_tools", "tool_server:run_report", "tool_server:literature_lookup"],
      graph_maintainers: [],
    },
  };
  fs.writeFileSync(path.join(root, "task.yaml"), yaml.dump(descriptor));
  fs.writeFileSync(path.join(root, "question.md"), input.question);
  fs.writeFileSync(path.join(root, "evidence.md"), input.evidence ?? "No earlier evidence was available. Research the supplied question directly.");
  const instructions = `${direction}\n\nWrite candidate JSON with a checks array. Each check requires label, expression (only numeric arithmetic), reported (the result to check), unit, and basis (user input, a cited source or a stated assumption). Run evaluations/arithmetic/run.py --candidate <file> --output <run_dir>/results/<peer_id>-<variant>/result_summary.json, creating that unique parent directory first. The result_summary.json filename is required by the research loop's evidence importer; an arbitrarily named receipt alone will not be discovered. Publish the resulting substantive finding through the normal findings workflow with this receipt attached. Report failed checks and corrections, not just a score. A passing arithmetic check does not validate its assumptions or imply an experiment on people. Do not modify the evaluator or the supplied question/evidence. Write a research-findings.md report in the run directory before ending. Keep primary-source facts, user inputs, assumptions and computed scenarios distinct.\n`;
  fs.writeFileSync(path.join(root, "description.md"), instructions);
  fs.writeFileSync(path.join(root, "prompt_task.jinja2"), "{{ task_spec.research_direction }}\n\nRead question.md, evidence.md and description.md. Return actual audit findings with source URLs and reproducible calculation receipts, not only run status.\n");
  const evalDir = path.join(root, "evaluations", "arithmetic");
  fs.mkdirSync(evalDir, { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL("./research-arithmetic.py", import.meta.url)), path.join(evalDir, "run.py"));
  fs.writeFileSync(path.join(evalDir, "evaluation.yaml"), yaml.dump({
    schema_version: 1, name: "research_arithmetic", kind: "evaluation", version: "1.0.0", protocol_version: 1,
    description: "Reproduce arithmetic receipts. Passing checks do not establish scientific validity or clinical outcomes.",
    compatibility: { praxist_core: ">=0.1.0,<1.0", python: ">=3.11" }, dependencies: [],
    capabilities: ["evaluation.arithmetic"], evaluation: { primary_metrics: ["verified_checks"], evidence_stages: ["complete"] },
    agent_entrypoint: "run.py", code: ["run.py"], assets: [],
  }));
  fs.writeFileSync(path.join(root, ".gitignore"), "experiments/\n__pycache__/\n");
  return root;
}
