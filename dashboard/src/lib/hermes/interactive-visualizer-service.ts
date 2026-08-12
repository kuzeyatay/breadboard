import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import db from "../db.ts";
import {
  activateArtifactVersion,
  addArtifactProvenance,
  createArtifact,
  getArtifactById,
  getArtifactVersion,
  presentArtifact,
  publishValidatedArtifactVersion,
  recordArtifactPipelineEvent,
  type ArtifactRow,
  type CreateArtifactInput,
} from "./artifact-store.ts";
import {
  cancelInteractiveVisualizerWork,
  runInteractiveVisualizerBrowserTests,
} from "./interactive-visualizer-browser.ts";
import { bundleInteractiveVisualizer } from "./interactive-visualizer-runtime.ts";
import {
  bundleCustomInteractiveVisualizer,
  compileCustomInteractiveVisualizerPackage,
  isCustomInteractiveVisualizerPackage,
  type CustomInteractiveVisualizerPackage,
} from "./interactive-visualizer-custom.ts";
import {
  INTERACTIVE_VISUALIZER_MAX_REPAIR_ATTEMPTS,
  INTERACTIVE_VISUALIZER_RUNTIME_VERSION,
  INTERACTIVE_VISUALIZER_THREE_VERSION,
  type InteractiveVisualizerBrowserTests,
  type InteractiveVisualizerLifecycleStatus,
  type InteractiveVisualizerManifest,
  type InteractiveVisualizerPackage,
  type InteractiveVisualizerPlan,
  type InteractiveVisualizerValidation,
  type InteractiveVisualizerVersionManifest,
} from "./interactive-visualizer-types.ts";
import {
  compileInteractiveVisualizerPackage,
  validateInteractiveVisualizerPlan,
} from "./interactive-visualizer-validator.ts";
import { interactiveVisualizerConfig } from "./interactive-visualizer-config.ts";
import {
  isInlineInteractiveVisualizerSkill,
  isInteractiveVisualizerSkill,
} from "./interactive-visualizer-skills.ts";

interface InteractiveVisualizerRow {
  artifact_id: string;
  schema_version: number;
  lifecycle_status: InteractiveVisualizerLifecycleStatus;
  mode: "2d" | "3d";
  plan_json: string;
  active_version: number;
  current_job_id: string | null;
  repair_attempt: number;
  cancellation_requested: number;
  last_error_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface InteractiveVisualizerToolContext {
  userId: number;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  runId: string;
  assistantMessageId: number | null;
  toolCallId: string | null;
  surface: "dashboard_terminal" | "garden_chat";
  sourceSkill: "interactive-visualizer" | "interactive-visualizer-in-chat";
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function object(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function publicError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error || "Interactive visualization failed.");
  return {
    code: /cancel/i.test(raw) ? "interactive_visualizer_cancelled" : "interactive_visualizer_failed",
    message: raw
      .replace(/[A-Za-z]:[\\/][^\s]+|\/(?:home|Users)\/[^\s]+/gi, "[redacted path]")
      .slice(0, 700),
  };
}

function visualizerRow(artifactId: string): InteractiveVisualizerRow {
  const row = db.prepare(`
    SELECT * FROM hermes_interactive_visualizers WHERE artifact_id = ?
  `).get(artifactId) as InteractiveVisualizerRow | undefined;
  if (!row) throw new Error("This artifact is not an interactive visualizer.");
  return row;
}

function nextPublishedVersion(artifactId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM hermes_artifact_versions
    WHERE artifact_id = ? AND status = 'ready'
  `).get(artifactId) as { version: number };
  return Math.max(1, Number(row.version) + 1);
}

function updateArtifactMetadata(
  artifactId: string,
  patch: Record<string, unknown>,
  error?: { code: string; message: string } | null,
): void {
  const artifact = getArtifactById(artifactId);
  if (!artifact) return;
  const metadata = { ...object(artifact.metadata_json), ...patch };
  db.prepare(`
    UPDATE hermes_artifacts
    SET metadata_json = ?, error_json = ?, updated_at = ?
    WHERE id = ?
  `).run(json(metadata), error ? json(error) : null, new Date().toISOString(), artifactId);
}

function setLifecycle(input: {
  artifactId: string;
  status: InteractiveVisualizerLifecycleStatus;
  jobId?: string | null;
  repairAttempt?: number;
  cancellationRequested?: boolean;
  error?: { code: string; message: string } | null;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE hermes_interactive_visualizers
    SET lifecycle_status = ?,
        current_job_id = COALESCE(?, current_job_id),
        repair_attempt = COALESCE(?, repair_attempt),
        cancellation_requested = COALESCE(?, cancellation_requested),
        last_error_json = ?,
        updated_at = ?
    WHERE artifact_id = ?
  `).run(
    input.status,
    input.jobId === undefined ? null : input.jobId,
    input.repairAttempt === undefined ? null : input.repairAttempt,
    input.cancellationRequested === undefined ? null : Number(input.cancellationRequested),
    input.error ? json(input.error) : null,
    now,
    input.artifactId,
  );
  const preservesReadyVersion =
    (input.status === "failed" || input.status === "cancelled") &&
    visualizerRow(input.artifactId).active_version > 0;
  updateArtifactMetadata(
    input.artifactId,
    {
      lifecycleStatus: input.status,
      ...(preservesReadyVersion && input.error
        ? { lastInteractiveVisualizerError: input.error.message }
        : {}),
    },
    preservesReadyVersion ? null : input.error ?? null,
  );
}

function insertJob(input: {
  id: string;
  artifactId: string;
  runId: string;
  version: number;
  attempt: number;
  operation: "create" | "revise" | "rollback";
  revisionPrompt?: string;
  packageValue?: unknown;
}): void {
  db.prepare(`
    INSERT INTO hermes_interactive_visualizer_jobs (
      id, artifact_id, run_id, candidate_version, attempt, operation, status,
      revision_prompt, package_json, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'generating', ?, ?, ?)
  `).run(
    input.id,
    input.artifactId,
    input.runId,
    input.version,
    input.attempt,
    input.operation,
    input.revisionPrompt?.slice(0, 4_000) ?? null,
    input.packageValue === undefined ? null : json(input.packageValue),
    new Date().toISOString(),
  );
}

function updateJob(input: {
  id: string;
  status: Exclude<InteractiveVisualizerLifecycleStatus, "planned">;
  validation?: InteractiveVisualizerValidation;
  tests?: InteractiveVisualizerBrowserTests;
  manifest?: InteractiveVisualizerVersionManifest;
  error?: { code: string; message: string };
}): void {
  db.prepare(`
    UPDATE hermes_interactive_visualizer_jobs
    SET status = ?, validation_json = COALESCE(?, validation_json),
        tests_json = COALESCE(?, tests_json), manifest_json = COALESCE(?, manifest_json),
        error_json = ?, completed_at = CASE
          WHEN ? IN ('ready','failed','cancelled') THEN ?
          ELSE completed_at
        END
    WHERE id = ?
  `).run(
    input.status,
    input.validation ? json(input.validation) : null,
    input.tests ? json(input.tests) : null,
    input.manifest ? json(input.manifest) : null,
    input.error ? json(input.error) : null,
    input.status,
    new Date().toISOString(),
    input.id,
  );
}

function markBaseArtifactTerminalFailure(
  artifact: ArtifactRow,
  error: { code: string; message: string },
  cancelled: boolean,
  context: InteractiveVisualizerToolContext,
): void {
  if (visualizerRow(artifact.id).active_version > 0) {
    updateArtifactMetadata(artifact.id, {
      interactiveVisualizer: {
        ...((object(artifact.metadata_json).interactiveVisualizer as Record<string, unknown> | undefined) ?? {}),
        lastAttemptStatus: cancelled ? "cancelled" : "failed",
        lastError: error.message,
      },
    });
    recordArtifactPipelineEvent({
      artifact,
      runId: context.runId,
      assistantMessageId: context.assistantMessageId,
      type: "artifact.failed",
      status: "ready",
      payload: { cancelled, revisionPreserved: true, error },
    });
    return;
  }
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE hermes_artifacts
      SET status = 'failed', error_json = ?, updated_at = ?
      WHERE id = ?
    `).run(json(error), now, artifact.id);
    db.prepare(`
      UPDATE hermes_artifact_versions
      SET status = 'failed', error_json = ?, updated_at = ?
      WHERE artifact_id = ? AND version = 1
    `).run(json(error), now, artifact.id);
  });
  transaction.immediate();
  recordArtifactPipelineEvent({
    artifact: getArtifactById(artifact.id)!,
    runId: context.runId,
    assistantMessageId: context.assistantMessageId,
    type: "artifact.failed",
    status: "failed",
    payload: { cancelled, error },
  });
}

export function planInteractiveVisualizer(input: {
  context: InteractiveVisualizerToolContext;
  title: string;
  plan: unknown;
}): { artifact: ReturnType<typeof presentArtifact>; plan: InteractiveVisualizerPlan } {
  const checked = validateInteractiveVisualizerPlan(input.plan);
  if (!checked.plan) throw new Error(checked.errors.join("; "));
  const plan = checked.plan;
  const inlineInChat = isInlineInteractiveVisualizerSkill(input.context.sourceSkill);
  const artifactInput: CreateArtifactInput = {
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    toolCallId: input.context.toolCallId,
    surface: input.context.surface,
    kind: "html",
    rendererId: "interactive-visualizer",
    title: input.title,
    filename: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "visualization"}.html`,
    content: `${JSON.stringify({ plan }, null, 2)}\n`,
    metadata: {
      artifactType: "interactive-visualizer",
      lifecycleStatus: "planned",
      mode: plan.mode,
      prebuilt: true,
      ...(inlineInChat ? { inlineInChat: true } : {}),
    },
    sourceSkill: input.context.sourceSkill,
    sourceHermesTool: "interactive_visualizer_plan",
  };
  const artifact = createArtifact(artifactInput);
  addArtifactProvenance({
    artifactId: artifact.id,
    version: 1,
    sourceKind: "skill",
    sourceTool: input.context.sourceSkill,
  });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO hermes_interactive_visualizers (
      artifact_id, schema_version, lifecycle_status, mode, plan_json,
      active_version, repair_attempt, cancellation_requested, created_at, updated_at
    ) VALUES (?, 1, 'planned', ?, ?, 0, 0, 0, ?, ?)
  `).run(
    artifact.id,
    plan.mode === "hybrid" ? "3d" : plan.mode,
    json(plan),
    now,
    now,
  );
  recordArtifactPipelineEvent({
    artifact,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    type: "interactive_visualizer_planning",
    payload: {
      artifactType: "interactive-visualizer",
      mode: plan.mode,
      result: "planned",
    },
  });
  return { artifact: presentArtifact(artifact), plan };
}

/**
 * Gemini-style visual generation is a single model/tool pass. The server still
 * records the plan before publication, but the agent does not need to stop,
 * inspect files in a terminal, and make a second tool call merely to continue.
 */
export async function createInteractiveVisualizer(input: {
  context: InteractiveVisualizerToolContext;
  title: string;
  plan: unknown;
  packageValue: unknown;
}) {
  const planned = planInteractiveVisualizer({
    context: input.context,
    title: input.title,
    plan: input.plan,
  });
  const artifact = getArtifactById(planned.artifact.id);
  if (!artifact) throw new Error("The planned interactive visualizer could not be loaded.");
  return generateInteractiveVisualizer({
    context: input.context,
    artifact,
    packageValue: input.packageValue,
    operation: "create",
  });
}

function safeTempDirectory(): string {
  const base = path.resolve(os.tmpdir());
  const directory = path.resolve(fs.mkdtempSync(path.join(base, "breadboard-visualizer-")));
  const relation = path.relative(base, directory);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error("Could not create a controlled visualizer staging directory.");
  }
  return directory;
}

function removeTempDirectory(directory: string): void {
  const base = path.resolve(os.tmpdir());
  const target = path.resolve(directory);
  const relation = path.relative(base, target);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation) || !path.basename(target).startsWith("breadboard-visualizer-")) {
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

export async function generateInteractiveVisualizer(input: {
  context: InteractiveVisualizerToolContext;
  artifact: ArtifactRow;
  packageValue: unknown;
  operation: "create" | "revise";
  revisionPrompt?: string;
}): Promise<{
  artifact: ReturnType<typeof presentArtifact>;
  manifest?: InteractiveVisualizerVersionManifest;
  validation: InteractiveVisualizerValidation;
  tests?: InteractiveVisualizerBrowserTests;
  repairable: boolean;
  attemptsRemaining: number;
  failureCategory?: "validation" | "browser" | "cancelled" | "publication";
}> {
  if (
    input.artifact.renderer_id !== "interactive-visualizer" ||
    !isInteractiveVisualizerSkill(input.artifact.source_skill)
  ) {
    throw new Error("The artifact is not owned by an interactive visualizer skill.");
  }
  const visualizer = visualizerRow(input.artifact.id);
  const attempt = visualizer.repair_attempt + 1;
  const maxAttempts = Math.min(
    INTERACTIVE_VISUALIZER_MAX_REPAIR_ATTEMPTS,
    interactiveVisualizerConfig().maxAttempts,
  );
  if (attempt > maxAttempts) {
    throw new Error("The bounded repair limit has been exhausted. Start a new visualizer plan.");
  }
  const candidateVersion = visualizer.active_version === 0
    ? 1
    : nextPublishedVersion(input.artifact.id);
  const jobId = `ivj_${randomUUID()}`;
  insertJob({
    id: jobId,
    artifactId: input.artifact.id,
    runId: input.context.runId,
    version: candidateVersion,
    attempt,
    operation: input.operation,
    revisionPrompt: input.revisionPrompt,
    packageValue: input.packageValue,
  });
  setLifecycle({
    artifactId: input.artifact.id,
    status: "generating",
    jobId,
    repairAttempt: attempt,
    cancellationRequested: false,
  });
  recordArtifactPipelineEvent({
    artifact: input.artifact,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    type: "interactive_visualizer_generating",
    payload: {
      artifactType: "interactive-visualizer",
      phase: "generating",
      jobId,
      candidateVersion,
      attempt,
      operation: input.operation,
    },
  });

  const plan = JSON.parse(visualizer.plan_json) as InteractiveVisualizerPlan;
  setLifecycle({ artifactId: input.artifact.id, status: "validating" });
  updateJob({ id: jobId, status: "validating" });
  const compiled = isCustomInteractiveVisualizerPackage(input.packageValue)
    ? (() => {
        const custom = compileCustomInteractiveVisualizerPackage(plan, input.packageValue);
        return {
          definition: null,
          manifest: custom.manifest,
          plan: custom.plan,
          html: "",
          css: "",
          validation: custom.validation,
          sourceHash: custom.sourceHash,
          customPackage: custom.package,
        };
      })()
    : {
        ...compileInteractiveVisualizerPackage(plan, input.packageValue),
        customPackage: null,
      };
  recordArtifactPipelineEvent({
    artifact: input.artifact,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    type: "interactive_visualizer_validating",
    payload: {
      artifactType: "interactive-visualizer",
      phase: "validating",
      jobId,
      candidateVersion,
      valid: compiled.validation.valid,
    },
  });
  if (
    !compiled.validation.valid ||
    !compiled.manifest ||
    (!compiled.customPackage && !compiled.definition)
  ) {
    const error = {
      code: "interactive_visualizer_validation_failed",
      message: compiled.validation.errors.join("; ").slice(0, 700),
    };
    updateJob({ id: jobId, status: "failed", validation: compiled.validation, error });
    setLifecycle({ artifactId: input.artifact.id, status: "failed", error });
    if (attempt >= maxAttempts) {
      markBaseArtifactTerminalFailure(input.artifact, error, false, input.context);
      recordArtifactPipelineEvent({
        artifact: input.artifact,
        runId: input.context.runId,
        assistantMessageId: input.context.assistantMessageId,
        type: "interactive_visualizer_failed",
        status: visualizer.active_version > 0 ? "ready" : "failed",
        version: candidateVersion,
        payload: {
          artifactType: "interactive-visualizer",
          attempt,
          failureCategory: "validation",
          activeVersionPreserved: visualizer.active_version || null,
        },
      });
    } else {
      updateArtifactMetadata(input.artifact.id, {
        lifecycleStatus: "repairing",
        repairAttempt: attempt,
        attemptsRemaining: maxAttempts - attempt,
      }, visualizer.active_version > 0 ? null : error);
      recordArtifactPipelineEvent({
        artifact: input.artifact,
        runId: input.context.runId,
        assistantMessageId: input.context.assistantMessageId,
        type: "interactive_visualizer_repairing",
        version: candidateVersion,
        payload: {
          artifactType: "interactive-visualizer",
          attempt,
          attemptsRemaining: maxAttempts - attempt,
          failureCategory: "validation",
        },
      });
      recordArtifactPipelineEvent({
        artifact: input.artifact,
        runId: input.context.runId,
        assistantMessageId: input.context.assistantMessageId,
        type: "artifact.failed",
        status: visualizer.active_version > 0 ? "ready" : "generating",
        version: candidateVersion,
        payload: {
          artifactType: "interactive-visualizer",
          phase: "validation",
          jobId,
          repairable: true,
          attemptsRemaining: maxAttempts - attempt,
          activeVersionPreserved: visualizer.active_version || null,
          error,
        },
      });
    }
    return {
      artifact: presentArtifact(getArtifactById(input.artifact.id)!),
      validation: compiled.validation,
      repairable: attempt < maxAttempts,
      attemptsRemaining: maxAttempts - attempt,
      failureCategory: "validation",
    };
  }

  let tempDirectory = "";
  let tests: InteractiveVisualizerBrowserTests | undefined;
  try {
    updateArtifactMetadata(input.artifact.id, { lifecycleStatus: "building" });
    recordArtifactPipelineEvent({
      artifact: input.artifact,
      runId: input.context.runId,
      assistantMessageId: input.context.assistantMessageId,
      type: "interactive_visualizer_building",
      version: candidateVersion,
      payload: { artifactType: "interactive-visualizer", attempt },
    });
    const bundle = compiled.customPackage
      ? await bundleCustomInteractiveVisualizer(compiled.customPackage)
      : await bundleInteractiveVisualizer({
          definition: compiled.definition!,
          manifest: compiled.manifest as InteractiveVisualizerManifest,
          html: compiled.html,
          css: compiled.css,
        });
    setLifecycle({ artifactId: input.artifact.id, status: "browser_testing" });
    updateJob({ id: jobId, status: "browser_testing", validation: compiled.validation });
    recordArtifactPipelineEvent({
      artifact: input.artifact,
      runId: input.context.runId,
      assistantMessageId: input.context.assistantMessageId,
      type: "interactive_visualizer_browser_testing",
      version: candidateVersion,
      payload: { artifactType: "interactive-visualizer", attempt },
    });
    tempDirectory = safeTempDirectory();
    tests = await runInteractiveVisualizerBrowserTests({
      html: bundle.html,
      mode: compiled.manifest.mode,
      outputDir: tempDirectory,
      runtimeSessionId: input.context.runtimeSessionId,
    });
    if (!tests.passed) {
      const error = {
        code: "interactive_visualizer_browser_tests_failed",
        message: tests.checks
          .filter((check) => !check.passed)
          .map((check) => `${check.name}: ${check.detail ?? "failed"}`)
          .join("; ")
          .slice(0, 700),
      };
      updateJob({ id: jobId, status: "failed", validation: compiled.validation, tests, error });
      setLifecycle({ artifactId: input.artifact.id, status: "failed", error });
      if (attempt >= maxAttempts) {
        markBaseArtifactTerminalFailure(input.artifact, error, false, input.context);
        recordArtifactPipelineEvent({
          artifact: input.artifact,
          runId: input.context.runId,
          assistantMessageId: input.context.assistantMessageId,
          type: "interactive_visualizer_failed",
          status: visualizer.active_version > 0 ? "ready" : "failed",
          version: candidateVersion,
          payload: {
            artifactType: "interactive-visualizer",
            attempt,
            failureCategory: "browser",
            activeVersionPreserved: visualizer.active_version || null,
          },
        });
      } else {
        updateArtifactMetadata(input.artifact.id, {
          lifecycleStatus: "repairing",
          repairAttempt: attempt,
          attemptsRemaining: maxAttempts - attempt,
        }, visualizer.active_version > 0 ? null : error);
        recordArtifactPipelineEvent({
          artifact: input.artifact,
          runId: input.context.runId,
          assistantMessageId: input.context.assistantMessageId,
          type: "interactive_visualizer_repairing",
          version: candidateVersion,
          payload: {
            artifactType: "interactive-visualizer",
            attempt,
            attemptsRemaining: maxAttempts - attempt,
            failureCategory: "browser",
          },
        });
        recordArtifactPipelineEvent({
          artifact: input.artifact,
          runId: input.context.runId,
          assistantMessageId: input.context.assistantMessageId,
          type: "artifact.failed",
          status: visualizer.active_version > 0 ? "ready" : "generating",
          version: candidateVersion,
          payload: {
            artifactType: "interactive-visualizer",
            phase: "browser_testing",
            jobId,
            repairable: true,
            attemptsRemaining: maxAttempts - attempt,
            activeVersionPreserved: visualizer.active_version || null,
            error,
          },
        });
      }
      return {
        artifact: presentArtifact(getArtifactById(input.artifact.id)!),
        validation: compiled.validation,
        tests,
        repairable: attempt < maxAttempts,
        attemptsRemaining: maxAttempts - attempt,
        failureCategory: "browser",
      };
    }
    if (visualizerRow(input.artifact.id).cancellation_requested) {
      throw new Error("interactive visualizer cancelled by user");
    }
    const currentArtifact = getArtifactById(input.artifact.id)!;
    const sourcePackage = input.packageValue as
      | InteractiveVisualizerPackage
      | CustomInteractiveVisualizerPackage;
    const versionManifest: InteractiveVisualizerVersionManifest = {
      schemaVersion: 1,
      artifactType: "interactive-visualizer",
      artifactId: input.artifact.id,
      version: candidateVersion,
      previousVersion: visualizer.active_version || null,
      title: compiled.manifest.title,
      description: compiled.manifest.description,
      mode: compiled.manifest.mode,
      sourceHash: compiled.sourceHash,
      bundleHash: bundle.hash,
      runtimeVersion: compiled.manifest.runtime.version ?? INTERACTIVE_VISUALIZER_RUNTIME_VERSION,
      threeVersion: compiled.manifest.mode !== "2d"
        ? INTERACTIVE_VISUALIZER_THREE_VERSION
        : null,
      assumptions: sourcePackage.assumptions,
      limitations: sourcePackage.limitations,
      sourceReferences: sourcePackage.sourceReferences,
      status: "ready",
      generatedAt: new Date().toISOString(),
    };
    const published = publishValidatedArtifactVersion({
      artifact: currentArtifact,
      version: candidateVersion,
      expectedCurrentVersion: currentArtifact.current_version,
      sourceContent: `${JSON.stringify({
        plan,
        package: sourcePackage,
        validation: compiled.validation,
        tests,
        manifest: versionManifest,
      }, null, 2)}\n`,
      outputContent: bundle.html,
      metadata: {
        artifactType: "interactive-visualizer",
        lifecycleStatus: "ready",
        mode: compiled.manifest.mode,
        prebuilt: true,
        generationStyle: compiled.customPackage ? "prompt-specific-ui" : "declarative-runtime",
        ...(isInlineInteractiveVisualizerSkill(input.artifact.source_skill)
          ? { inlineInChat: true }
          : {}),
        interactiveVisualizer: {
          manifest: versionManifest,
          plan,
          validation: {
            valid: compiled.validation.valid,
            warnings: compiled.validation.warnings,
          },
          browserTests: {
            passed: tests.passed,
            viewports: tests.viewports,
            screenshotCreated: tests.screenshotCreated,
          },
          lastAttemptStatus: "ready",
        },
      },
      runId: input.context.runId,
      assistantMessageId: input.context.assistantMessageId,
    });
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE hermes_interactive_visualizers
        SET lifecycle_status = 'ready', active_version = ?, mode = ?,
            current_job_id = NULL, repair_attempt = 0,
            cancellation_requested = 0, last_error_json = NULL, updated_at = ?
        WHERE artifact_id = ?
      `).run(
        candidateVersion,
        compiled.manifest!.mode === "hybrid" ? "3d" : compiled.manifest!.mode,
        now,
        input.artifact.id,
      );
      updateJob({
        id: jobId,
        status: "ready",
        validation: compiled.validation,
        tests,
        manifest: versionManifest,
      });
    });
    transaction.immediate();
    recordArtifactPipelineEvent({
      artifact: published,
      runId: input.context.runId,
      assistantMessageId: input.context.assistantMessageId,
      type: "interactive_visualizer_ready",
      status: "ready",
      version: candidateVersion,
      payload: {
        artifactType: "interactive-visualizer",
        attempt,
        mode: compiled.manifest.mode,
        bundleHash: bundle.hash,
      },
    });
    return {
      artifact: presentArtifact(published),
      manifest: versionManifest,
      validation: compiled.validation,
      tests,
      repairable: false,
      attemptsRemaining: maxAttempts,
    };
  } catch (error) {
    const cancelled = /cancel/i.test(error instanceof Error ? error.message : String(error));
    const safe = publicError(error);
    updateJob({
      id: jobId,
      status: cancelled ? "cancelled" : "failed",
      validation: compiled.validation,
      tests,
      error: safe,
    });
    setLifecycle({
      artifactId: input.artifact.id,
      status: cancelled ? "cancelled" : "failed",
      cancellationRequested: cancelled,
      error: safe,
    });
    recordArtifactPipelineEvent({
      artifact: input.artifact,
      runId: input.context.runId,
      assistantMessageId: input.context.assistantMessageId,
      type: cancelled
        ? "interactive_visualizer_cancelled"
        : "interactive_visualizer_failed",
      status: visualizer.active_version > 0 ? "ready" : "failed",
      version: candidateVersion,
      payload: {
        artifactType: "interactive-visualizer",
        attempt,
        failureCategory: cancelled ? "cancelled" : "publication",
        activeVersionPreserved: visualizer.active_version || null,
      },
    });
    if (cancelled || attempt >= maxAttempts) {
      markBaseArtifactTerminalFailure(input.artifact, safe, cancelled, input.context);
    }
    return {
      artifact: presentArtifact(getArtifactById(input.artifact.id)!),
      validation: compiled.validation,
      tests,
      repairable: !cancelled && attempt < maxAttempts,
      attemptsRemaining: cancelled
        ? 0
        : maxAttempts - attempt,
      failureCategory: cancelled ? "cancelled" : "publication",
    };
  } finally {
    if (tempDirectory) removeTempDirectory(tempDirectory);
  }
}

export async function cancelInteractiveVisualizer(input: {
  context: InteractiveVisualizerToolContext;
  artifact: ArtifactRow;
}): Promise<{ cancelled: boolean; artifact: ReturnType<typeof presentArtifact> }> {
  const visualizer = visualizerRow(input.artifact.id);
  setLifecycle({
    artifactId: input.artifact.id,
    status: "cancelled",
    cancellationRequested: true,
    error: {
      code: "interactive_visualizer_cancelled",
      message: "Interactive visualizer generation was cancelled by the user.",
    },
  });
  const cancelled = await cancelInteractiveVisualizerWork(input.context.runtimeSessionId);
  if (visualizer.current_job_id) {
    updateJob({
      id: visualizer.current_job_id,
      status: "cancelled",
      error: {
        code: "interactive_visualizer_cancelled",
        message: "Interactive visualizer generation was cancelled by the user.",
      },
    });
  }
  recordArtifactPipelineEvent({
    artifact: input.artifact,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    type: "interactive_visualizer_cancelled",
    status: visualizer.active_version > 0 ? "ready" : input.artifact.status,
    payload: {
      artifactType: "interactive-visualizer",
      browserWorkTerminated: cancelled,
      activeVersionPreserved: visualizer.active_version || null,
    },
  });
  return { cancelled, artifact: presentArtifact(getArtifactById(input.artifact.id)!) };
}

export function rollbackInteractiveVisualizer(input: {
  context: InteractiveVisualizerToolContext;
  artifact: ArtifactRow;
  version: number;
}): { artifact: ReturnType<typeof presentArtifact>; version: number } {
  const visualizer = visualizerRow(input.artifact.id);
  const target = getArtifactVersion(input.artifact.id, input.version);
  const metadata = object(target.metadata_json);
  if (
    target.status !== "ready" ||
    metadata.artifactType !== "interactive-visualizer" ||
    !metadata.interactiveVisualizer
  ) {
    throw new Error("The requested version is not a validated interactive visualizer.");
  }
  const jobId = `ivj_${randomUUID()}`;
  insertJob({
    id: jobId,
    artifactId: input.artifact.id,
    runId: input.context.runId,
    version: input.version,
    attempt: 1,
    operation: "rollback",
  });
  const restored = activateArtifactVersion({
    artifact: input.artifact,
    version: input.version,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
  });
  const manifest = (metadata.interactiveVisualizer as Record<string, unknown>).manifest as
    | InteractiveVisualizerVersionManifest
    | undefined;
  db.prepare(`
    UPDATE hermes_interactive_visualizers
    SET lifecycle_status = 'ready', active_version = ?, mode = ?,
        current_job_id = NULL, repair_attempt = 0, cancellation_requested = 0,
        last_error_json = NULL, updated_at = ?
    WHERE artifact_id = ?
  `).run(
    input.version,
    manifest?.mode ?? visualizer.mode,
    new Date().toISOString(),
    input.artifact.id,
  );
  updateJob({
    id: jobId,
    status: "ready",
    ...(manifest ? { manifest } : {}),
  });
  recordArtifactPipelineEvent({
    artifact: restored,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    type: "interactive_visualizer_ready",
    status: "ready",
    version: input.version,
    payload: {
      artifactType: "interactive-visualizer",
      operation: "rollback",
      restoredVersion: input.version,
    },
  });
  return { artifact: presentArtifact(restored), version: input.version };
}
