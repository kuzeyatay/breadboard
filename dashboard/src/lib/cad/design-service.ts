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
import { DEFAULT_CAD_ENGINE, type CadEngineId } from "./engines.ts";
import { solidworksAvailability } from "./solidworks/availability.ts";
import { runCadAgentLoop, runCadProjectBuildPhase } from "./model-client.ts";
import { cadSystemPrompt, summariseProjectForModel } from "./prompts.ts";
import { getCadProject, readRevisionParameters, type CadProjectRow } from "./project-store.ts";
import {
  assessCadSafety,
  CAD_VALIDATION_DISCLAIMER,
  engineeringReviewNotice,
  type CadSafetyDecision,
} from "./safety.ts";
import type { CadToolContext } from "./tools.ts";
import type { CADValidationIssue, ManufacturingProcess, ParametricCADArtifact } from "./types.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

/** Automatic model-driven builds per user turn, before the agent must stop. */
export const MAX_BUILD_ATTEMPTS = 3;

export interface DesignCadPartInput {
  userId: number;
  conversationId: number;
  clusterId: number | null;
  /** The design brief, in the user's words plus whatever context the caller adds. */
  brief: string;
  /** The chat this was launched from, so a brief can refer back to it. */
  conversationContext?: string;
  /** Provider endpoint and model. Never hardcoded — the caller passes what the user chose. */
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  process?: ManufacturingProcess;
  printerBed?: { x: number; y: number; z: number };
  units?: "mm" | "inch";
  /**
   * Which CAD backend builds the part. Omitted means CadQuery, so every caller
   * that predates the setting keeps the behaviour it had.
   */
  engine?: CadEngineId;
  /**
   * True when the person chose this backend rather than it being inferred. An
   * explicit backend that cannot run makes the design fail with a reason; an
   * automatic one may fall back.
   */
  engineExplicit?: boolean;
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
  /** A shorter source-only deadline once a durable design specification exists. */
  modelBuildRequestTimeoutMs?: number;
  /** Maximum source-generation and repair turns after a durable plan exists. */
  maxModelBuildSteps?: number;
  /**
   * Requirements the kernel cannot check — that the product actually has the
   * clamp, seat or optical carrier it was asked for.
   *
   * Given here rather than applied afterwards for one reason: a design that
   * misses a required feature used to be built, measured, and then discarded by
   * the caller with nothing published. Now the model is told what is missing
   * while it still has an attempt left, and only a design that cannot be
   * repaired fails honestly instead of being published as a usable result.
   */
  acceptance?: (manifest: ParametricCADArtifact) => CADValidationIssue[];
}

export type DesignCadPartOutcome =
  | {
      ok: true;
      manifest: ParametricCADArtifact;
      projectId: string;
      /** Revision identity proving this turn built the manifest it returned. */
      builtRevision: number;
      /** Current revision when this turn started; a successful edit must advance it. */
      startingRevision: number;
      answer: string;
      attemptsUsed: number;
      safety: CadSafetyDecision;
      disclaimers: string[];
      /** Requirements still unmet after every model repair attempt. */
      acceptanceIssues: CADValidationIssue[];
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
  const startingRevision = input.existingProject?.current_revision ?? 0;

  // The backend is settled before a single model token is spent. A run that
  // cannot reach SolidWorks should say so in a second, not after two minutes of
  // planning a part it can never build — and an explicitly chosen backend is
  // never quietly swapped for the other one.
  const requested: CadEngineId = input.engine ?? DEFAULT_CAD_ENGINE;
  let engine = requested;
  if (requested === "solidworks") {
    const availability = await solidworksAvailability();
    if (!availability.available) {
      if (input.engineExplicit) {
        return {
          ok: false,
          refused: false,
          safety,
          attemptsUsed: 0,
          reason: availability.message,
        };
      }
      input.emit?.("cad.engine.fallback", {
        from: "solidworks",
        to: DEFAULT_CAD_ENGINE,
        reason: availability.message,
      });
      engine = DEFAULT_CAD_ENGINE;
    } else {
      input.emit?.("cad.engine.selected", {
        engine: "solidworks",
        solidworksRunning: availability.running,
      });
    }
  }

  const toolContext: CadToolContext = {
    userId: input.userId,
    conversationId: input.conversationId,
    clusterId: input.clusterId,
    model: input.model,
    instruction: input.brief,
    safety,
    defaults,
    engine,
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

  const disclaimers = cadDisclaimers(safety);
  /**
   * The caller's requirements, measured against what was actually built. Cheap
   * enough to run between attempts: it reads one stored revision.
   */
  const acceptanceIssuesFor = (id: string): CADValidationIssue[] => {
    if (!input.acceptance) return [];
    const built = buildCadManifest({ projectId: id, disclaimers });
    return built ? input.acceptance(built) : [];
  };

  let loop;
  try {
    if (input.existingProject?.current_revision === 0) {
      // A prior turn may have completed the expensive structured plan before
      // its source-generation response timed out. Resume that durable draft;
      // asking the model to plan it again only creates duplicate projects.
      toolContext.projectId = input.existingProject.id;
      loop = {
        answer: "Resuming the saved CAD specification.",
        projectId: input.existingProject.id,
        toolCalls: [],
        stoppedBecause: "step_limit" as const,
      };
      input.emit?.("cad.spec.resumed", { projectId: input.existingProject.id });
    } else {
      const isNewProject = !input.existingProject;
      loop = await runCadAgentLoop({
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: isNewProject
          ? stagedReasoningEffort(input.reasoningEffort)
          : input.reasoningEffort,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onUsage ? { onUsage: input.onUsage } : {}),
        ...(input.modelRequestTimeoutMs
          ? {
              requestTimeoutMs: isNewProject
                ? Math.min(input.modelRequestTimeoutMs, 240_000)
                : input.modelRequestTimeoutMs,
            }
          : isNewProject
            ? { requestTimeoutMs: 240_000 }
            : {}),
        systemPrompt: cadSystemPrompt({
          defaults,
          safety,
          engine,
          attemptBudget: MAX_BUILD_ATTEMPTS,
          ...(summary ? { existingProject: summary } : {}),
        }),
        userMessage: userMessageFor(input),
        toolContext,
        // A new design is deliberately two-phase. The first completion only
        // records the plan; a fresh, much smaller completion writes source.
        ...(isNewProject
          ? {
              maxSteps: 1,
              allowedToolNames: ["cad_create_project"],
              forcedToolName: "cad_create_project",
            }
          : {}),
      });
    }

    const plannedProjectId = loop.projectId ?? toolContext.projectId ?? null;
    const plannedProject = plannedProjectId ? getCadProject(plannedProjectId) : null;
    if (plannedProject?.current_revision === 0) {
      input.emit?.("cad.build.started", { projectId: plannedProject.id, resumed: Boolean(input.existingProject) });
      loop = await runCadProjectBuildPhase({
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onUsage ? { onUsage: input.onUsage } : {}),
        ...(input.modelBuildRequestTimeoutMs ?? input.modelRequestTimeoutMs
          ? {
              requestTimeoutMs:
                input.modelBuildRequestTimeoutMs ?? input.modelRequestTimeoutMs,
            }
          : {}),
        ...(input.maxModelBuildSteps
          ? { maxBuildSteps: input.maxModelBuildSteps }
          : {}),
        ...(input.acceptance ? { acceptance: acceptanceIssuesFor } : {}),
        project: plannedProject,
        toolContext,
      });
    }
  } catch (error) {
    if (input.signal?.aborted) throw error;

    // A model may have created and successfully built a project before its
    // final prose response times out. That valid revision is the deliverable.
    const partialProject = toolContext.projectId ? getCadProject(toolContext.projectId) : null;
    if (
      partialProject &&
      isCurrentBuildFromThisTurn(toolContext, partialProject, startingRevision)
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
      const message =
        error instanceof Error
          ? error.message
          : "The model-driven CAD pass failed before it produced a complete design.";
      return {
        ok: false,
        refused: false,
        safety,
        attemptsUsed: MAX_BUILD_ATTEMPTS - toolContext.attemptsRemaining,
        reason: failureReason(toolContext, [], message),
      };
    }
  }

  const projectId = loop.projectId ?? toolContext.projectId ?? input.existingProject?.id ?? null;
  const project = projectId ? getCadProject(projectId) : null;

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

  // `current_revision` deliberately stays on the last valid model when a new
  // build fails. That storage invariant protects the working design, but it
  // also means merely loading `project` cannot prove this turn produced it.
  // Require the final build recorded by this fresh tool context to be valid,
  // current, and newer than the revision this request began with. Otherwise a
  // failed/no-op edit could be republished as a successful new answer.
  if (!isCurrentBuildFromThisTurn(toolContext, project, startingRevision)) {
    return {
      ok: false,
      refused: false,
      safety,
      attemptsUsed,
      reason: noFreshBuildReason(toolContext, project, loop.toolCalls, loop.answer),
    };
  }

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
  const completedBuild = toolContext.lastBuild!;
  if (
    manifest.projectId !== completedBuild.projectId ||
    manifest.revision !== completedBuild.revision ||
    !manifest.validation.passed ||
    (manifest.status !== "valid" && manifest.status !== "valid-with-warnings")
  ) {
    return {
      ok: false,
      refused: false,
      safety,
      attemptsUsed,
      reason:
        "The newly built CAD revision could not be matched to a current validated manifest, so nothing was published.",
    };
  }

  const acceptanceIssues = input.acceptance ? input.acceptance(manifest) : [];
  if (acceptanceIssues.length) {
    input.emit?.("cad.acceptance.failed", {
      projectId: project.id,
      issues: acceptanceIssues.slice(0, 8),
      unmetCount: acceptanceIssues.length,
    });
    const listed = acceptanceIssues
      .slice(0, 4)
      .map((issue) => `${issue.code} — ${issue.message}`)
      .join(" ");
    return {
      ok: false,
      refused: false,
      safety,
      attemptsUsed,
      reason:
        `The geometry passed kernel validation but did not satisfy the requested product ` +
        `after ${attemptsUsed} attempt(s). ${listed}` +
        (acceptanceIssues.length > 4 ? ` (+${acceptanceIssues.length - 4} more)` : ""),
    };
  }

  return {
    ok: true,
    manifest,
    projectId: project.id,
    builtRevision: completedBuild.revision,
    startingRevision,
    answer: loop.answer,
    attemptsUsed,
    safety,
    disclaimers,
    acceptanceIssues,
  };
}

/**
 * A project row alone is not evidence that this request built anything: its
 * current revision can be an older valid revision retained after a bad edit.
 */
export function isCurrentBuildFromThisTurn(
  toolContext: Pick<CadToolContext, "lastBuild">,
  project: Pick<CadProjectRow, "id" | "current_revision">,
  startingRevision: number,
): boolean {
  const build = toolContext.lastBuild;
  return Boolean(
    build &&
      !build.failure &&
      build.projectId === project.id &&
      build.revision > startingRevision &&
      build.revision === project.current_revision &&
      (build.status === "valid" || build.status === "valid-with-warnings"),
  );
}

function stagedReasoningEffort(value: string): string {
  return ["none", "minimal", "low", "medium"].includes(value) ? value : "medium";
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
  const brief = notes.length ? `${input.brief}\n\n${notes.join(" ")}` : input.brief;
  // Kept out of `brief` on purpose: that string is also what the safety
  // assessment reads and what labels the run.
  return promptWithContext(brief, input.conversationContext);
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

function noFreshBuildReason(
  toolContext: CadToolContext,
  project: CadProjectRow,
  toolCalls: Array<{ name: string; ok: boolean; summary: string }>,
  answer: string,
): string {
  const build = toolContext.lastBuild;
  if (!build) {
    return "No new CAD revision was built for this request. The existing design was left unchanged and was not republished.";
  }
  if (
    build.failure ||
    build.status === "invalid" ||
    build.projectId !== project.id
  ) {
    return failureReason(toolContext, toolCalls, answer);
  }
  return (
    "The final CAD build did not become this project's current validated revision. " +
    "The existing design was left unchanged and was not republished."
  );
}
