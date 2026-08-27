import {
  SupervisorResourceExhaustedError,
  type ResourceExhaustionResult,
} from "../supervisor-control.ts";
import type { RuntimeKind } from "./contracts.ts";

export type RuntimeStartupStage = "primary_create" | "fallback_create";

export interface SafeRuntimeStartupDiagnostic {
  runtimeKind: RuntimeKind;
  stage: RuntimeStartupStage;
  errorName: string;
  errorCode?: string | number;
  resource?: ResourceExhaustionResult["resource"];
  requiredHeadroomMb?: number;
  availableHeadroomMb?: number;
  denialReason?: ResourceExhaustionResult["denialReason"];
}

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u;

function safeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  return SAFE_IDENTIFIER.test(candidate) ? candidate : fallback;
}

function safeErrorCode(error: unknown): string | number | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "number" && Number.isSafeInteger(code)) return code;
  if (typeof code === "string" && SAFE_IDENTIFIER.test(code)) return code;
  return undefined;
}

/**
 * Produce operator evidence without copying an exception message or stack. Both
 * can contain bearer tokens, loopback URLs, or private filesystem paths.
 */
export function safeRuntimeStartupDiagnostic(input: {
  runtimeKind: RuntimeKind;
  stage: RuntimeStartupStage;
  error: unknown;
}): SafeRuntimeStartupDiagnostic {
  const errorName = input.error instanceof Error
    ? safeIdentifier(input.error.name, "Error")
    : "NonErrorThrow";
  const base: SafeRuntimeStartupDiagnostic = {
    runtimeKind: input.runtimeKind,
    stage: input.stage,
    errorName,
  };
  const errorCode = safeErrorCode(input.error);
  if (errorCode !== undefined) base.errorCode = errorCode;
  if (!(input.error instanceof SupervisorResourceExhaustedError)) return base;
  return {
    ...base,
    errorCode: input.error.result.code,
    resource: input.error.result.resource,
    requiredHeadroomMb: input.error.result.requiredHeadroomMb,
    availableHeadroomMb: input.error.result.availableHeadroomMb,
    ...(input.error.result.denialReason
      ? { denialReason: input.error.result.denialReason }
      : {}),
  };
}

export function runtimeStartupResourceFailure(error: unknown): {
  code: "runtime_resource_exhausted";
  message: string;
} | null {
  if (!(error instanceof SupervisorResourceExhaustedError)) return null;
  // SupervisorResourceExhaustedError builds this message exclusively from
  // bounded numeric evidence and static policy text, so it is browser-safe.
  return { code: "runtime_resource_exhausted", message: error.message };
}
