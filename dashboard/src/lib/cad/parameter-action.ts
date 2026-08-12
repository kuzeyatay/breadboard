// Editing a parameter from the artifact's own panel.
//
// The panel submits an authenticated server-side action; no CAD code ever runs
// in the browser. The action rebuilds the existing program with the new values,
// re-validates, and publishes a new artifact version. The prior revision stays
// exactly where it was — a parameter change that produces an invalid solid
// leaves the last good design as the project's current one.

import { cadDefaults } from "./defaults.ts";
import { CadServiceError } from "./errors.ts";
import {
  buildCadManifest,
  closeCadArtifactContext,
  openCadArtifactContext,
  publishCadDesign,
} from "./artifact.ts";
import {
  getCadProject,
  getCadRevision,
  readRevisionParameters,
  type CadParameterValue,
} from "./project-store.ts";
import {
  assessCadSafety,
  CAD_VALIDATION_DISCLAIMER,
  engineeringReviewNotice,
} from "./safety.ts";
import { buildAndRecord, type CadToolContext } from "./tools.ts";
import type { CADDesignSpec, ParametricCADArtifact } from "./types.ts";
import type Database from "better-sqlite3";

export interface ParameterUpdateInput {
  userId: number;
  projectId: string;
  conversationPublicId: string;
  values: Record<string, CadParameterValue>;
  database?: Database.Database;
  storageRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ParameterUpdateResult {
  manifest: ParametricCADArtifact;
  artifactId: string | null;
  artifactVersion: number;
  revision: number;
  changed: Array<{ id: string; from: CadParameterValue | null; to: CadParameterValue }>;
}

export async function applyParameterUpdate(
  input: ParameterUpdateInput,
): Promise<ParameterUpdateResult> {
  const project = getCadProject(input.projectId, input.database);
  if (!project || project.user_id !== input.userId) {
    throw new CadServiceError("cad_project_not_found", "That CAD project was not found.");
  }
  const base = project.current_revision || project.latest_revision;
  const revision = base ? getCadRevision(project.id, base, input.database) : null;
  if (!revision) {
    throw new CadServiceError(
      "revision_not_found",
      "This project has no built revision to change.",
    );
  }

  const spec = JSON.parse(project.design_spec_json) as CADDesignSpec;
  const editable = new Map(
    spec.parameters.filter((parameter) => parameter.editable).map((p) => [p.id, p]),
  );
  const changes: Record<string, CadParameterValue> = {};
  for (const [id, value] of Object.entries(input.values)) {
    const parameter = editable.get(id);
    if (!parameter) {
      throw new CadServiceError(
        "parameter_not_editable",
        `"${id}" is not an editable parameter of this design.`,
      );
    }
    if (typeof value !== typeof parameter.value) {
      throw new CadServiceError(
        "parameter_type_mismatch",
        `"${parameter.label}" expects a ${typeof parameter.value}.`,
      );
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new CadServiceError("parameter_out_of_range", `"${parameter.label}" must be a number.`);
      }
      if (parameter.minimum !== undefined && value < parameter.minimum) {
        throw new CadServiceError(
          "parameter_out_of_range",
          `"${parameter.label}" must be at least ${parameter.minimum}.`,
        );
      }
      if (parameter.maximum !== undefined && value > parameter.maximum) {
        throw new CadServiceError(
          "parameter_out_of_range",
          `"${parameter.label}" must be at most ${parameter.maximum}.`,
        );
      }
    }
    changes[id] = value;
  }
  if (!Object.keys(changes).length) {
    throw new CadServiceError("no_parameter_changes", "No parameter values were supplied.");
  }

  const previous = readRevisionParameters(project.id, base, input.database);
  const parameters = { ...previous, ...changes };
  const safety = assessCadSafety(`${spec.name} ${spec.description}`);
  const instruction = `Parameter change: ${Object.entries(changes)
    .map(([id, value]) => `${id}=${String(value)}`)
    .join(", ")}`;

  const context: CadToolContext = {
    userId: input.userId,
    conversationId: project.conversation_id,
    clusterId: project.cluster_id,
    model: "parameter-panel",
    instruction,
    safety,
    defaults: cadDefaults(project.process),
    attemptsRemaining: 1,
    projectId: project.id,
    ...(input.database ? { database: input.database } : {}),
    ...(input.storageRoot ? { storageRoot: input.storageRoot } : {}),
    ...(input.env ? { env: input.env } : {}),
  };

  const outcome = await buildAndRecord({
    project,
    spec,
    source: revision.source,
    entrypoint: revision.entrypoint,
    parameters,
    instruction,
    timeoutMs: 45_000,
    context,
  });
  if (!outcome.ok || !outcome.revision) {
    throw new CadServiceError(
      outcome.failure?.code ?? "execution_failed",
      outcome.failure?.message ?? "The parameter change did not build.",
      { retryable: outcome.failure?.retryable ?? true },
    );
  }

  const notice = engineeringReviewNotice(safety);
  const manifest = buildCadManifest({
    projectId: project.id,
    revision: outcome.revision,
    disclaimers: [CAD_VALIDATION_DISCLAIMER, ...(notice ? [notice] : [])],
    ...(input.database ? { database: input.database } : {}),
  });
  if (!manifest) {
    throw new CadServiceError(
      "manifest_unavailable",
      "The rebuilt design could not be assembled for storage.",
    );
  }

  // Publishing is best effort in the same sense as the run's: the revision is
  // already durable, so a chat that can no longer host an artifact must not
  // discard a design the user asked for.
  let artifactId: string | null = null;
  let artifactVersion = 0;
  const artifactContext = openCadArtifactContext({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    brief: instruction,
    agentRunId: `param_${project.id}`,
  });
  try {
    if (artifactContext) {
      const artifact = await publishCadDesign({
        context: artifactContext,
        manifest,
        previousArtifactId: project.artifact_id,
        ...(input.database ? { database: input.database } : {}),
      });
      artifactId = artifact?.id ?? null;
      artifactVersion = artifact?.current_version ?? 0;
    }
  } finally {
    closeCadArtifactContext(artifactContext, "completed");
  }

  return {
    manifest,
    artifactId,
    artifactVersion,
    revision: outcome.revision,
    changed: Object.entries(changes).map(([id, value]) => ({
      id,
      from: previous[id] ?? null,
      to: value,
    })),
  };
}
