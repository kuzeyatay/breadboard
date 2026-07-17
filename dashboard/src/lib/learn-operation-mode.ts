/** Canonical user-visible Learn operations. */
export type LearnOperationMode =
  | "plan"
  | "generate"
  | "repair"
  | "full_rebuild"
  | "update_sources";

/** `regenerate` is accepted at API/storage boundaries only. */
export type LegacyLearnOperationMode = LearnOperationMode | "regenerate" | "update";

export interface StartLearnOperationRequest {
  gardenId: string;
  mode: LearnOperationMode;
  issueIds?: string[];
  unitIds?: string[];
  pageIds?: string[];
  forceFullRebuild?: boolean;
}

export class InvalidLearnOperationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLearnOperationRequestError";
  }
}

function stringIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].sort();
}

/** Legacy `regenerate` deliberately means bounded repair, never full rebuild. */
export function normalizeLearnOperationMode(value: unknown): LearnOperationMode {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "regenerate" || mode === "repair") return "repair";
  if (mode === "update") return "update_sources";
  if (["plan", "generate", "full_rebuild", "update_sources"].includes(mode)) {
    return mode as LearnOperationMode;
  }
  throw new InvalidLearnOperationRequestError(`Unsupported Learn operation mode: ${mode || "(missing)"}`);
}

export function parseStartLearnOperationRequest(
  gardenId: string,
  input: unknown,
  options: { legacyDefault?: "repair" } = {},
): StartLearnOperationRequest {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const rawMode = record.mode ?? options.legacyDefault;
  const mode = normalizeLearnOperationMode(rawMode);
  const forceFullRebuild = record.forceFullRebuild === true;
  if (forceFullRebuild && mode !== "full_rebuild") {
    throw new InvalidLearnOperationRequestError("forceFullRebuild is accepted only when mode is full_rebuild.");
  }
  if (mode === "full_rebuild" && !forceFullRebuild) {
    throw new InvalidLearnOperationRequestError("Rebuilding the entire garden requires explicit confirmation.");
  }
  return {
    gardenId,
    mode,
    issueIds: stringIds(record.issueIds),
    unitIds: stringIds(record.unitIds),
    pageIds: stringIds(record.pageIds),
    ...(forceFullRebuild ? { forceFullRebuild: true } : {}),
  };
}

export function isFullRebuildRequest(
  request: StartLearnOperationRequest,
): request is StartLearnOperationRequest & { mode: "full_rebuild"; forceFullRebuild: true } {
  return request.mode === "full_rebuild" && request.forceFullRebuild === true;
}
