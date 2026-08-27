import type { PackagedParityPlan } from "./packaged-parity-plan.mjs";
import type { RuntimeParitySnapshot } from "./packaged-parity-runtime";

export function assertMandatoryServiceRegistration(
  serviceManifest: unknown,
  snapshot: RuntimeParitySnapshot,
): readonly string[];

export function buildRuntimePassClaims(options: {
  readonly plan: PackagedParityPlan;
  readonly before: RuntimeParitySnapshot;
  readonly after: RuntimeParitySnapshot;
  readonly cancellationBefore: RuntimeParitySnapshot;
  readonly cancellationAfter: RuntimeParitySnapshot;
  readonly packageOpenedAtMs: number;
  readonly workflowStartedAtMs: number;
  readonly cancellationUi: {
    readonly requested: true;
    readonly terminalVisible: true;
    readonly controlCleared: true;
  } | null;
}): {
  readonly service: readonly Record<string, unknown>[];
  readonly worker: readonly Record<string, unknown>[];
  readonly cancellation: Record<string, unknown>;
};
