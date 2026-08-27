export type PackagedParityDriver =
  | { readonly kind: "slash"; readonly slashCommand: string }
  | { readonly kind: "approval" | "artifact" | "attachment" | "surface" | "connection" | "connection-catalog" | "model" | "profile" | "provider" | "recovery" | "registry" | "repository" | "tool" | "workflow" };

export interface PackagedParityPlan {
  readonly capabilityId: string;
  readonly displayName: string;
  readonly category: string;
  readonly visibleEntryPoint: string;
  readonly driver: PackagedParityDriver;
  readonly services: readonly { readonly serviceId: string; readonly requirement: string; readonly startupPolicy: string; readonly associationAuthority: "manifest-capability-id" | "explicit-frozen-alias" }[];
  readonly workers: readonly { readonly workerKind: string; readonly jobTypes: readonly string[]; readonly gracefulCancellationMs: number; readonly associationAuthority: "manifest-capability-id" | "explicit-frozen-alias" }[];
  readonly declaredRuntimeRequirements: readonly string[];
  readonly prerequisites: readonly { readonly prerequisiteType: "CREDENTIAL" | "EXTERNAL_SERVICE" | "EXTERNAL_SOFTWARE"; readonly prerequisiteId: string; readonly frozenRequirement: string }[];
  readonly output: {
    readonly outputKind: string;
    readonly expectedType: string;
    readonly requiresOpenArtifact: boolean;
    readonly requiredArtifactTypes: readonly string[];
    readonly requiredOutputIdentities: readonly string[];
    readonly contractKind: "SINGLE_OUTPUT" | "ARTIFACT_KIND_MATRIX" | "RENDERER_MATRIX" | "RUNTIME_EVENT_FACETS" | "ROUTE_RESULT_FIELDS" | "LIFECYCLE_SEQUENCE";
    readonly driverKind: "GENERIC_SINGLE_OUTPUT" | null;
  };
  readonly cancellation: { readonly supported: boolean; readonly contract: string };
  readonly followUp: { readonly supported: boolean; readonly contract: string };
  readonly recovery: {
    readonly supported: boolean;
    readonly scenarioKind: string;
    readonly driverKind: "REFRESH" | "SOURCE_SELECTION_FAIL_CLOSED" | "STORED_SELECTION_APP_RESTART" | "CONVERSATION_RUN_RELOAD" | null;
    readonly selectionIdentity: string | null;
    readonly notApplicable: null | {
      readonly reasonCode: string;
      readonly sourceProvenPreMigrationSemantics: true;
      readonly evidence: readonly string[];
    };
    readonly contract: string;
  };
  readonly baseline: { readonly status: string; readonly evidence: readonly string[] };
  readonly contractCorrection: null | {
    readonly reasonCode: string;
    readonly correctionSha256: string;
    readonly frozenBaselineContractSha256: string;
    readonly authoritativeSourceRefs: readonly string[];
  };
}

export const PACKAGED_PARITY_RUNTIME_ALIASES: Readonly<{
  services: Readonly<Record<string, readonly string[]>>;
  workers: Readonly<Record<string, readonly string[]>>;
}>;

export function buildPackagedParityPlan(options: {
  inventory: unknown;
  serviceManifest: unknown;
  workerManifest: unknown;
}): readonly PackagedParityPlan[];

export function assertCompletePackagedParityOutcomes(
  plans: readonly PackagedParityPlan[],
  outcomes: readonly { readonly capabilityId: string }[],
): true;

export function packagedParityAcceptanceGaps(
  plans: readonly PackagedParityPlan[],
): readonly { readonly capabilityId: string; readonly code: string; readonly summary: string }[];

export function assertNoPackagedParityAcceptanceGaps(
  plans: readonly PackagedParityPlan[],
): true;

export function assertPublishableBlockedOutcome(
  plan: PackagedParityPlan,
  outcome: unknown,
): PackagedParityPlan["prerequisites"][number];
