export interface ParityEvidencePackageRunContext {
  readonly kind: string;
  readonly runId: string;
  readonly packageVerification: unknown;
}

export function openParityEvidencePackageRun(options: {
  readonly repoRoot: string;
  readonly packageVerifierReceiptPath: string;
  readonly executablePath: string;
  readonly runId: string;
}): ParityEvidencePackageRunContext;

export function closeParityEvidencePackageRun(context: ParityEvidencePackageRunContext): void;

export function recordParityEvidenceObservation(options: {
  readonly repoRoot: string;
  readonly observationPath: string;
  readonly producerPath: string;
  readonly packageRunContext: unknown;
  readonly runId: string;
  readonly capabilityId: string;
  readonly evidenceType: string;
  readonly workflowIdentity: unknown;
  readonly operationId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly claims: unknown;
  readonly supportingArtifactPaths: readonly string[];
  readonly blocker?: unknown;
}): unknown;

export function recordParityEvidenceFailure(options: {
  readonly repoRoot: string;
  readonly observationPath: string;
  readonly producerPath: string;
  readonly packageRunContext: unknown;
  readonly runId: string;
  readonly capabilityId: string;
  readonly workflowIdentity: unknown;
  readonly operationId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly failureCode: string;
  readonly failureSummary: string;
  readonly claims: unknown;
  readonly supportingArtifactPaths: readonly string[];
}): unknown;
