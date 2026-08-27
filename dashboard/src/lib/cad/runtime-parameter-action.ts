if (typeof window !== "undefined") {
  throw new Error("Parametric CAD Runtime parameter control is server-only.");
}

import { createHash, randomUUID } from "node:crypto";
import type { CadParameterValue } from "./project-store.ts";
import type { CADMeasurements, CADValidationIssue, CADStatus } from "./types.ts";

export interface RuntimeParameterUpdateInput {
  userId: number;
  projectId: string;
  conversationPublicId: string;
  values: Record<string, CadParameterValue>;
  requestId?: string;
  signal?: AbortSignal;
}

export interface RuntimeParameterUpdateResult {
  revision: number;
  artifactId: string | null;
  artifactVersion: number;
  changed: Array<{ id: string; from: CadParameterValue | null; to: CadParameterValue }>;
  status: CADStatus;
  validationPassed: boolean;
  measurements: CADMeasurements;
  issues: CADValidationIssue[];
}

export class CadParameterRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "CadParameterRuntimeError";
    this.code = code;
    this.status = status;
  }
}

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TERMINAL = new Set(["run.completed", "run.failed", "run.aborted"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorStatus(code: string): number {
  return code === "cad_project_not_found" || code === "revision_not_found" ? 404 : 400;
}

function parseResult(payload: Record<string, unknown>): RuntimeParameterUpdateResult {
  if (
    !Number.isSafeInteger(payload.revision) || (payload.revision as number) < 1 ||
    !(payload.artifactId === null || typeof payload.artifactId === "string") ||
    !Number.isSafeInteger(payload.artifactVersion) || (payload.artifactVersion as number) < 0 ||
    !Array.isArray(payload.changed) ||
    !["draft", "valid", "valid-with-warnings", "invalid"].includes(String(payload.status)) ||
    typeof payload.validationPassed !== "boolean" ||
    !isRecord(payload.measurements) ||
    !Array.isArray(payload.issues)
  ) {
    throw new CadParameterRuntimeError(
      "runtime_result_invalid",
      "The CAD Runtime returned an invalid parameter result.",
      502,
    );
  }
  return {
    revision: payload.revision as number,
    artifactId: payload.artifactId as string | null,
    artifactVersion: payload.artifactVersion as number,
    changed: payload.changed as RuntimeParameterUpdateResult["changed"],
    status: payload.status as CADStatus,
    validationPassed: payload.validationPassed,
    measurements: payload.measurements as unknown as CADMeasurements,
    issues: payload.issues as CADValidationIssue[],
  };
}

/** Submit and await one fresh, recoverable Runtime-owned parameter rebuild. */
export async function applyParameterUpdateViaRuntime(
  input: RuntimeParameterUpdateInput,
): Promise<RuntimeParameterUpdateResult> {
  const browserRequestId = input.requestId?.trim() || randomUUID();
  if (!REQUEST_ID.test(browserRequestId)) {
    throw new CadParameterRuntimeError(
      "invalid_request_id",
      "The parameter rebuild request identity is invalid.",
    );
  }
  const signature = JSON.stringify({
    projectId: input.projectId,
    conversationPublicId: input.conversationPublicId,
    values: input.values,
  });
  // Keep the native idempotency key bounded even when the browser supplies the
  // longest accepted identity. Hashing both fields preserves exact replay for
  // a retry while keeping distinct UI actions independent.
  const digest = createHash("sha256")
    .update(browserRequestId)
    .update("\u0000")
    .update(signature)
    .digest("hex");
  const requestId = `cad-param:${digest}`;
  const { startOuterAgentRun, readOuterAgentRunView, abortOuterAgentRun } = await import(
    "../runtime-v2/outer-agent-run.ts"
  );
  const run = await startOuterAgentRun({
    kind: "parametric-cad",
    userId: input.userId,
    requestId,
    requestPayload: {
      operation: "parameter-update",
      conversationPublicId: input.conversationPublicId,
      projectId: input.projectId,
      values: input.values,
    },
  });
  const stopForCaller = async (): Promise<never> => {
    await abortOuterAgentRun("parametric-cad", input.userId, run.runId).catch(() => undefined);
    throw new CadParameterRuntimeError(
      "parameter_update_aborted",
      "The CAD parameter rebuild was stopped.",
      499,
    );
  };
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (input.signal?.aborted) return stopForCaller();
    const view = await readOuterAgentRunView("parametric-cad", input.userId, run.runId, 0);
    const terminal = view.events.findLast((event) => TERMINAL.has(event.type));
    if (terminal?.type === "run.completed") return parseResult(terminal.payload);
    if (terminal?.type === "run.aborted") {
      throw new CadParameterRuntimeError(
        "parameter_update_aborted",
        typeof terminal.payload.summary === "string"
          ? terminal.payload.summary
          : "The CAD parameter rebuild was stopped.",
        499,
      );
    }
    if (terminal?.type === "run.failed") {
      const code = typeof terminal.payload.code === "string"
        ? terminal.payload.code
        : "execution_failed";
      throw new CadParameterRuntimeError(
        code,
        typeof terminal.payload.error === "string"
          ? terminal.payload.error
          : "The parameter change could not be built.",
        errorStatus(code),
      );
    }
    await wait(150);
  }
  await abortOuterAgentRun("parametric-cad", input.userId, run.runId).catch(() => undefined);
  throw new CadParameterRuntimeError(
    "parameter_update_timeout",
    "The CAD parameter rebuild did not finish in time.",
    504,
  );
}
