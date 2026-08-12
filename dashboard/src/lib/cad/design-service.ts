// One way to design a part.
//
// Both callers go through here: the Parametric CAD agent's own run, and the
// Hardware Blueprint agent asking for an enclosure around a circuit it just
// compiled. Neither owns the loop, the attempt budget, or the safety decision —
// this module does, so a design produced by either route is held to the same
// rules and carries the same provenance.
//
// Publishing is deliberately left to the caller: an artifact belongs to the
// turn that asked for it, and the two callers hang theirs off different runs.

import { cadDefaults, type CadDefaults } from "./defaults.ts";
import { buildCadManifest } from "./artifact.ts";
import { runCadAgentLoop } from "./model-client.ts";
import { cadSystemPrompt, summariseProjectForModel } from "./prompts.ts";
import {
  getCadProject,
  readRevisionParameters,
  type CadProjectRow,
} from "./project-store.ts";
import {
  assessCadSafety,
  CAD_VALIDATION_DISCLAIMER,
  engineeringReviewNotice,
  type CadSafetyDecision,
} from "./safety.ts";
import type { CadToolContext } from "./tools.ts";
import { runCadTool } from "./tools.ts";
import type { CADDesignSpecDraft } from "./schemas.ts";
import type { CADUnits, ManufacturingProcess, ParametricCADArtifact } from "./types.ts";

/** Automatic model-driven builds per user turn, before the agent must stop. */
export const MAX_BUILD_ATTEMPTS = 3;

export interface DesignCadPartInput {
  userId: number;
  conversationId: number;
  clusterId: number | null;
  /** The design brief, in the user's words plus whatever context the caller adds. */
  brief: string;
  /** Provider endpoint and model. Never hardcoded — the caller passes what the user chose. */
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  process?: ManufacturingProcess;
  printerBed?: { x: number; y: number; z: number };
  units?: "mm" | "inch";
  /** An existing project to revise instead of starting a new one. */
  existingProject?: CadProjectRow | null;
  /** Bodies of the existing design, for the follow-up summary. */
  existingComponents?: Array<{ name: string; quantity: number; bodyRole: string }>;
  existingBoundingBox?: { x: number; y: number; z: number };
  signal?: AbortSignal;
  onUsage?: (usage: unknown) => void;
  emit?: (type: string, payload: Record<string, unknown>) => void;
  /** Deadline for one model turn; omitted for the CAD agent's long-form default. */
  modelRequestTimeoutMs?: number;
  /**
   * A deterministic geometry program the caller can supply when a model is
   * unavailable. Parametric CAD remains open-ended; this prevents known
   * hardware envelopes from disappearing because one completion timed out.
   */
  fallback?: CadDesignFallback;
}

export interface CadDesignFallback {
  name: string;
  units: CADUnits;
  designSpec: CADDesignSpecDraft;
  parameters: Record<string, number | string | boolean>;
  source: string;
  entrypoint?: string;
  note: string;
}

export type DesignCadPartOutcome =
  | {
      ok: true;
      manifest: ParametricCADArtifact;
      projectId: string;
      answer: string;
      attemptsUsed: number;
      safety: CadSafetyDecision;
      disclaimers: string[];
    }
  | {
      ok: false;
      reason: string;
      safety: CadSafetyDecision;
      attemptsUsed: number;
      /** True when the request itself was refused, not the build. */
      refused: boolean;
    };

export function cadDisclaimers(safety: CadSafetyDecision): string[] {
  const notice = engineeringReviewNotice(safety);
  return [CAD_VALIDATION_DISCLAIMER, ...(notice ? [notice] : [])];
}

export async function designCadPart(
  input: DesignCadPartInput,
): Promise<DesignCadPartOutcome> {
  const safety = assessCadSafety(input.brief);
  if (safety.level === "refused") {
    return {
      ok: false,
      refused: true,
      safety,
      attemptsUsed: 0,
      reason: `${safety.category} is outside what this agent designs. ${safety.reason}`,
    };
  }

  const base: CadDefaults = cadDefaults(input.process ?? "fdm");
  const defaults = input.printerBed ? { ...base, printerBed: input.printerBed } : base;

  let toolContext: CadToolContext = {
    userId: input.userId,
    conversationId: input.conversationId,
    clusterId: input.clusterId,
    model: input.model,
    instruction: input.brief,
    safety,
    defaults,
    attemptsRemaining: MAX_BUILD_ATTEMPTS,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.emit ? { emit: input.emit } : {}),
    ...(input.existingProject ? { projectId: input.existingProject.id } : {}),
  };

  const summary =
    input.existingProject && input.existingComponents
      ? summariseProjectForModel({
          projectId: input.existingProject.id,
          name: input.existingProject.name,
          revision: input.existingProject.current_revision,
          status: input.existingProject.status,
          parameters: readRevisionParameters(
            input.existingProject.id,
            input.existingProject.current_revision,
          ),
          components: input.existingComponents,
          ...(input.existingBoundingBox ? { boundingBox: input.existingBoundingBox } : {}),
        })
      : undefined;

  let loop;
  try {
    loop = await runCadAgentLoop({
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onUsage ? { onUsage: input.onUsage } : {}),
      ...(input.modelRequestTimeoutMs ? { requestTimeoutMs: input.modelRequestTimeoutMs } : {}),
      systemPrompt: cadSystemPrompt({
        defaults,
        safety,
        attemptBudget: MAX_BUILD_ATTEMPTS,
        ...(summary ? { existingProject: summary } : {}),
      }),
      userMessage: userMessageFor(input),
      toolContext,
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;

    // A model may have created and successfully built a project before its
    // final prose response times out. That valid revision is the deliverable;
    // replacing it with a new generic fallback project would throw away the
    // better CAD and can publish two artifacts for one turn.
    const partialProject = toolContext.projectId ? getCadProject(toolContext.projectId) : null;
    if (
      partialProject?.current_revision &&
      (partialProject.status === "valid" || partialProject.status === "valid-with-warnings")
    ) {
      input.emit?.("cad.model.response_incomplete", {
        projectId: partialProject.id,
        reason: error instanceof Error ? error.message : "The final model response was interrupted.",
      });
      loop = {
        answer:
          "The CAD model built and validated, but the model's final summary was interrupted.",
        projectId: partialProject.id,
        toolCalls: [],
        stoppedBecause: "answered" as const,
      };
    } else {
      if (!input.fallback) {
        return {
          ok: false,
          refused: false,
          safety,
          attemptsUsed: MAX_BUILD_ATTEMPTS - toolContext.attemptsRemaining,
          reason:
            error instanceof Error
              ? error.message
              : "The model-driven CAD pass failed before it produced a complete design.",
        };
      }
      input.emit?.("cad.fallback.started", {
        reason: error instanceof Error ? error.message : "The model-driven CAD pass failed.",
      });
      const fallback = await runCadFallback(input.fallback, {
        ...toolContext,
        model: `${input.model} + deterministic fallback`,
        attemptsRemaining: MAX_BUILD_ATTEMPTS,
        projectId: undefined,
        lastBuild: undefined,
      });
      toolContext = fallback.context;
      loop = fallback.loop;
    }
  }

  let projectId = loop.projectId ?? toolContext.projectId ?? input.existingProject?.id ?? null;
  let project = projectId ? getCadProject(projectId) : null;
  if ((!project || !project.current_revision) && input.fallback && !input.signal?.aborted) {
    input.emit?.("cad.fallback.started", {
      reason: failureReason(toolContext, loop.toolCalls, loop.answer),
    });
    const fallback = await runCadFallback(input.fallback, {
      ...toolContext,
      model: `${input.model} + deterministic fallback`,
      attemptsRemaining: MAX_BUILD_ATTEMPTS,
      projectId: undefined,
      lastBuild: undefined,
    });
    toolContext = fallback.context;
    loop = fallback.loop;
    projectId = loop.projectId ?? toolContext.projectId ?? null;
    project = projectId ? getCadProject(projectId) : null;
  }
  const attemptsUsed = MAX_BUILD_ATTEMPTS - toolContext.attemptsRemaining;

  if (!project || !project.current_revision) {
    return {
      ok: false,
      refused: false,
      safety,
      attemptsUsed,
      reason: failureReason(toolContext, loop.toolCalls, loop.answer),
    };
  }

  const disclaimers = cadDisclaimers(safety);
  const manifest = buildCadManifest({ projectId: project.id, disclaimers });
  if (!manifest) {
    return {
      ok: false,
      refused: false,
      safety,
      attemptsUsed,
      reason: "The built design could not be assembled for storage.",
    };
  }

  return {
    ok: true,
    manifest,
    projectId: project.id,
    answer: loop.answer,
    attemptsUsed,
    safety,
    disclaimers,
  };
}

async function runCadFallback(
  fallback: CadDesignFallback,
  context: CadToolContext,
): Promise<{
  context: CadToolContext;
  loop: Awaited<ReturnType<typeof runCadAgentLoop>>;
}> {
  const calls: Array<{ name: string; ok: boolean; summary: string }> = [];
  const created = await runCadTool(
    "cad_create_project",
    {
      name: fallback.name,
      units: fallback.units,
      design_spec: fallback.designSpec,
      parameters: fallback.parameters,
    },
    context,
  );
  calls.push({
    name: "cad_create_project",
    ok: created.ok !== false,
    summary: String(created.message ?? created.projectId ?? "project creation failed"),
  });
  const projectId = typeof created.projectId === "string" ? created.projectId : null;
  if (!projectId || created.ok === false) {
    return {
      context,
      loop: {
        answer: String(created.message ?? "The fallback CAD project could not be created."),
        projectId,
        toolCalls: calls,
        stoppedBecause: "answered",
      },
    };
  }

  const generated = await runCadTool(
    "cad_generate_model",
    {
      projectId,
      source: fallback.source,
      entrypoint: fallback.entrypoint ?? "build_model",
      parameters: fallback.parameters,
      timeoutMs: 45_000,
      note: fallback.note,
    },
    context,
  );
  calls.push({
    name: "cad_generate_model",
    ok: generated.ok !== false,
    summary: String(generated.message ?? generated.status ?? "fallback build finished"),
  });
  context.emit?.("cad.fallback.completed", {
    projectId,
    built: generated.ok !== false,
    status: generated.status ?? "invalid",
  });
  return {
    context,
    loop: {
      answer:
        generated.ok === false
          ? String(generated.message ?? "The deterministic fallback did not build.")
          : "The deterministic parametric fallback produced the CAD model.",
      projectId,
      toolCalls: calls,
      stoppedBecause: "answered",
    },
  };
}

function userMessageFor(input: DesignCadPartInput): string {
  const notes: string[] = [];
  if (input.process && input.process !== "unknown") {
    notes.push(`Manufacturing process: ${input.process.toUpperCase()}.`);
  }
  if (input.printerBed) {
    notes.push(
      `Printer bed: ${input.printerBed.x} × ${input.printerBed.y} × ${input.printerBed.z} mm.`,
    );
  }
  if (input.units === "inch") {
    notes.push(
      "The person works in inches; state dimensions both ways and keep the geometry metric.",
    );
  }
  return notes.length ? `${input.brief}\n\n${notes.join(" ")}` : input.brief;
}

/**
 * Why this turn produced nothing usable.
 *
 * The last tool call is often an unrelated refusal — the agent retrying
 * `cad_create_project` after a bad build, say — which says nothing about the
 * geometry. What the person needs is what the *build* found, so that is
 * reported first and the tool-call trail only fills in when no build happened.
 */
function failureReason(
  toolContext: CadToolContext,
  toolCalls: Array<{ name: string; ok: boolean; summary: string }>,
  answer: string,
): string {
  const build = toolContext.lastBuild;
  if (build?.failure) {
    return `No valid solid was produced. The last build failed: ${build.failure.message}`;
  }
  if (build) {
    const errors = build.issues.filter((issue) => issue.severity === "error");
    if (errors.length) {
      const listed = errors
        .slice(0, 4)
        .map((issue) => `${issue.code} — ${issue.message}`)
        .join(" ");
      return (
        `The design built but did not pass validation after ` +
        `${MAX_BUILD_ATTEMPTS - toolContext.attemptsRemaining} attempt(s). ` +
        `${errors.length} error${errors.length === 1 ? "" : "s"}: ${listed}` +
        (errors.length > 4 ? ` (+${errors.length - 4} more)` : "")
      );
    }
  }
  const failures = toolCalls.filter((call) => !call.ok).map((call) => call.summary);
  if (failures.length) {
    return `No valid solid was produced. ${failures[failures.length - 1]}`;
  }
  return answer
    ? `No valid solid was produced. ${answer.slice(0, 600)}`
    : "The agent finished without building a model.";
}
