import "server-only";

// The executable form of a learned workflow.
//
// Understudy's teach pipeline ends in a skill directory -- a SKILL.md the model
// reads, a machine-readable workflow file, and the anchors that let a step be
// found again. Breadboard keeps that shape because it is genuinely the right one
// for grounded replay, and drops the part where it becomes a skill.
//
// What gets written here is owned by ONE workflow, lives inside that workflow's
// own directory, is versioned with it, and is deleted with it. It is never
// registered in the skills catalog, never listed on the Skills page, and cannot
// be edited or removed on its own -- the workflow is the thing the user has, and
// this is how that thing runs.

import fs from "node:fs";
import path from "node:path";

import { ensureDirectory, workflowCompiledDirectory } from "./artifacts.ts";
import { teachLog } from "./redaction.ts";
import type { DemonstratedProcedure, WorkflowStep } from "./types.ts";

export interface CompiledRepresentation {
  type: "understudy-skill";
  directory: string;
  files: string[];
}

/** A grounding anchor: everything known about how to find one step's target. */
export interface StepAnchor {
  stepId: string;
  target?: string;
  role?: string;
  visibleText?: string;
  app?: string;
  windowHint?: string;
  /** What the demonstration observed, kept as evidence and never as instructions. */
  observed?: {
    app?: string;
    windowTitle?: string;
  };
}

function quotedText(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const match = target.match(/"([^"]{1,120})"/u);
  return match ? match[1] : undefined;
}

function roleOf(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const match = target.match(
    /\b(button|link|hyperlink|checkbox|radio ?button|toggle|tab|menu ?item|text ?field|edit|input|list ?item|row|cell|combo ?box|dropdown|slider|tree ?item|document)\b/iu,
  );
  return match ? match[1].toLowerCase().replace(/\s+/gu, " ") : undefined;
}

export function buildAnchors(procedure: DemonstratedProcedure): StepAnchor[] {
  return procedure.steps.map((step) => ({
    stepId: step.id,
    ...(step.target ? { target: step.target } : {}),
    ...(roleOf(step.target) ? { role: roleOf(step.target) } : {}),
    ...(quotedText(step.target) ? { visibleText: quotedText(step.target) } : {}),
    ...(step.app ? { app: step.app } : {}),
    ...(step.windowHint ? { windowHint: step.windowHint } : {}),
  }));
}

function renderStep(step: WorkflowStep, index: number): string[] {
  const lines = [`### ${index + 1}. ${step.instruction}`, ""];
  const facts: string[] = [`- Action: \`${step.action}\` via ${step.route}`];
  if (step.fallbackRoutes.length > 0) {
    facts.push(`- Fall back to: ${step.fallbackRoutes.join(", ")}`);
  }
  if (step.app) facts.push(`- Application: ${step.app}`);
  if (step.windowHint) facts.push(`- Window: ${step.windowHint}`);
  if (step.target) facts.push(`- Target: ${step.target}`);
  if (step.actionArgs && Object.keys(step.actionArgs).length > 0) {
    for (const [key, value] of Object.entries(step.actionArgs)) {
      facts.push(`- ${key}: \`${value}\``);
    }
  }
  if (step.precondition) facts.push(`- Before acting, confirm: ${step.precondition}`);
  if (step.expectation) facts.push(`- After acting, expect: ${step.expectation}`);
  if (step.optional) facts.push("- Optional: skip this step if its target is not present.");
  if (step.approvalRequired) {
    facts.push(`- **Ask the user before doing this.** ${step.approvalReason ?? ""}`.trim());
  }
  if (step.uncertain) facts.push("- The demonstration was unclear here; verify before continuing.");
  lines.push(...facts, "");
  return lines;
}

/**
 * The procedure as prose, for the grounding model that carries out each step.
 *
 * This is the file that gets read at replay time, so it leads with the rules and
 * the definition of done rather than burying them under the step list: a model
 * that reads the steps first and the constraints last has already decided what
 * to do by the time it learns what it must not.
 */
export function renderProcedureMarkdown(procedure: DemonstratedProcedure): string {
  const lines: string[] = [
    `# ${procedure.name}`,
    "",
    procedure.description || procedure.goal,
    "",
    "## Goal",
    "",
    procedure.goal,
    "",
  ];

  if (procedure.inputs.length > 0) {
    lines.push("## Inputs", "");
    for (const input of procedure.inputs) {
      const parts = [`- \`${input.name}\` — ${input.label}`, `(${input.type}${input.required ? ", required" : ", optional"})`];
      lines.push(parts.join(" "));
      if (input.notes) lines.push(`  - ${input.notes}`);
    }
    lines.push("");
  }

  const never = procedure.constraints.filter((constraint) => constraint.kind === "never");
  const always = procedure.constraints.filter((constraint) => constraint.kind === "always");
  const notes = procedure.constraints.filter((constraint) => constraint.kind === "note");
  if (procedure.constraints.length > 0) {
    lines.push("## Rules", "");
    for (const constraint of never) lines.push(`- **Never** ${constraint.text.replace(/^never\s+/iu, "")}`);
    for (const constraint of always) lines.push(`- **Always** ${constraint.text.replace(/^always\s+/iu, "")}`);
    for (const constraint of notes) lines.push(`- ${constraint.text}`);
    lines.push("");
  }

  if (procedure.approvals.length > 0) {
    lines.push("## Approvals", "");
    lines.push("Stop and ask the user before these steps. A rejection means the action does not happen.", "");
    for (const approval of procedure.approvals) {
      const step = procedure.steps.find((candidate) => candidate.id === approval.stepId);
      lines.push(`- ${step ? step.instruction : approval.stepId} — ${approval.reason}`);
    }
    lines.push("");
  }

  lines.push("## Steps", "");
  procedure.steps.forEach((step, index) => lines.push(...renderStep(step, index)));

  if (procedure.successCriteria.length > 0) {
    lines.push("## Done when", "");
    for (const criterion of procedure.successCriteria) lines.push(`- ${criterion.text}`);
    lines.push("");
  }
  if (procedure.failureCriteria.length > 0) {
    lines.push("## Failed when", "");
    for (const criterion of procedure.failureCriteria) lines.push(`- ${criterion.text}`);
    lines.push("");
  }
  if (procedure.recovery.length > 0) {
    lines.push("## If a step does not ground", "");
    for (const entry of procedure.recovery) lines.push(`- ${entry}`);
    lines.push("");
  }

  lines.push(
    "## Grounding",
    "",
    "Targets are described, not located. At each step, look at the screen as it is now, find the control the description names, and act on that. The coordinates from the demonstration are not part of this procedure and must not be used.",
    "",
  );

  return lines.join("\n");
}

/**
 * Write the compiled form into the workflow's own directory.
 *
 * Returns a descriptor the workflow record stores, so the run coordinator knows
 * where the executable form is without having to guess a layout.
 */
export function compileProcedure(
  workflowId: string,
  procedure: DemonstratedProcedure,
  version: number,
): CompiledRepresentation {
  const directory = ensureDirectory(path.join(workflowCompiledDirectory(workflowId), `v${version}`));

  const files: Array<{ name: string; contents: string }> = [
    { name: "PROCEDURE.md", contents: renderProcedureMarkdown(procedure) },
    {
      name: "workflow.json",
      contents: `${JSON.stringify(
        {
          schema: "breadboard.demonstrated-workflow/1",
          workflowId,
          version,
          name: procedure.name,
          goal: procedure.goal,
          description: procedure.description,
          inputs: procedure.inputs,
          steps: procedure.steps,
          constraints: procedure.constraints,
          approvals: procedure.approvals,
          successCriteria: procedure.successCriteria,
          failureCriteria: procedure.failureCriteria,
          recovery: procedure.recovery,
          confidence: procedure.confidence,
        },
        null,
        2,
      )}\n`,
    },
    {
      name: "anchors.json",
      contents: `${JSON.stringify({ schema: "breadboard.step-anchors/1", anchors: buildAnchors(procedure) }, null, 2)}\n`,
    },
    {
      name: "metadata.json",
      contents: `${JSON.stringify(
        {
          schema: "breadboard.demonstrated-workflow-metadata/1",
          workflowId,
          version,
          source: "demonstration",
          compiledAt: new Date().toISOString(),
          sourceDemonstration: procedure.sourceDemonstration,
          ambiguitiesResolved: procedure.ambiguities.filter((entry) => Boolean(entry.resolution)).length,
          ambiguitiesOpen: procedure.ambiguities.filter((entry) => !entry.resolution).length,
          // Says out loud what this directory is, for anyone who finds it later.
          note:
            "Internal executable form of one Breadboard workflow. Not a user skill: it is not registered in any skill catalog and is deleted with the workflow it belongs to.",
        },
        null,
        2,
      )}\n`,
    },
  ];

  for (const file of files) {
    fs.writeFileSync(path.join(directory, file.name), file.contents, "utf8");
  }

  teachLog("compile", "compiled a demonstrated workflow", { workflowId, version, files: files.length });

  return {
    type: "understudy-skill",
    directory,
    files: files.map((file) => file.name),
  };
}

/** Read back a compiled version, for replay or for showing what will run. */
export function readCompiledProcedure(
  compiled: { directory: string } | undefined,
): DemonstratedProcedure | null {
  if (!compiled) return null;
  try {
    const contents = fs.readFileSync(path.join(compiled.directory, "workflow.json"), "utf8");
    return JSON.parse(contents) as DemonstratedProcedure;
  } catch {
    return null;
  }
}
