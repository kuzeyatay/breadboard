export interface LearnRouteConflict extends Error {
  requiresReplan?: boolean;
}

/**
 * Learn mutations must never reinterpret a missing, truncated, or non-object
 * request body as an empty set of defaults. A browser/navigation interruption
 * can otherwise turn an explicitly scoped run into an all-sources run.
 */
export class InvalidLearnRouteBodyError extends Error {
  constructor(message = "Learn requires a complete JSON object request body.") {
    super(message);
    this.name = "InvalidLearnRouteBodyError";
  }
}

/**
 * The model picker is mutable UI state, while a Learning Map belongs to the
 * model that planned it. Confirmation and generation carry that model as an
 * optimistic concurrency token so a picker change cannot silently continue
 * with a different model.
 */
export class LearnExpectedModelConflictError extends Error {
  readonly requiresReplan: boolean;

  constructor(
    message = "The selected Learn model changed after this Learning Map was reviewed. Restore the previously selected model, or run Learn planning again with the current selection.",
    options: { requiresReplan?: boolean } = {},
  ) {
    super(message);
    this.name = "LearnExpectedModelConflictError";
    this.requiresReplan = options.requiresReplan === true;
  }
}

export interface RequireExpectedLearnModelOptions {
  /**
   * Generation cannot continue from a map owned by a different model, but it
   * can recover by planning a replacement with the current selection. Other
   * consumers, such as confirmation, remain fail-closed by default.
   */
  requiresReplanOnConflict?: boolean;
}

/**
 * Any operation that consumes an existing Learning Map requires a non-empty
 * optimistic concurrency token. It must match the selection captured
 * synchronously for this request.
 */
export function requireExpectedLearnModel(
  body: Record<string, unknown>,
  selectedModel: string,
  options: RequireExpectedLearnModelOptions = {},
): string {
  if (
    !Object.prototype.hasOwnProperty.call(body, "expectedModel") ||
    typeof body.expectedModel !== "string" ||
    !body.expectedModel.trim()
  ) {
    throw new InvalidLearnRouteBodyError(
      "This Learn action requires expectedModel to be a non-empty string.",
    );
  }
  const expectedModel = body.expectedModel.trim();
  if (expectedModel !== selectedModel) {
    throw new LearnExpectedModelConflictError(undefined, {
      requiresReplan: options.requiresReplanOnConflict,
    });
  }
  return selectedModel;
}

export async function readLearnRouteJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InvalidLearnRouteBodyError();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InvalidLearnRouteBodyError(
      "Learn requires its request body to be a JSON object.",
    );
  }
  return body as Record<string, unknown>;
}

export interface ExplicitLearnPlanSelection {
  includedSourceIds: string[];
  syllabusSourceId: string | null;
}

/**
 * Planning must receive the selection the user actually confirmed. Keeping
 * `null` distinct from an absent syllabus prevents a retry or interrupted
 * request from silently falling back to the legacy all-documents behavior.
 */
export function parseExplicitLearnPlanSelection(
  body: Record<string, unknown>,
): ExplicitLearnPlanSelection {
  if (!Object.prototype.hasOwnProperty.call(body, "includedSourceIds")) {
    throw new InvalidLearnRouteBodyError(
      "Learn planning requires an explicit includedSourceIds selection.",
    );
  }
  if (!Array.isArray(body.includedSourceIds) || body.includedSourceIds.length === 0) {
    throw new InvalidLearnRouteBodyError(
      "Learn planning requires includedSourceIds to be a non-empty array of unique, non-empty strings.",
    );
  }

  const includedSourceIds: string[] = [];
  const includedSourceIdSet = new Set<string>();
  for (const candidate of body.includedSourceIds) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw new InvalidLearnRouteBodyError(
        "Learn planning requires includedSourceIds to be a non-empty array of unique, non-empty strings.",
      );
    }
    const sourceId = candidate.trim();
    if (includedSourceIdSet.has(sourceId)) {
      throw new InvalidLearnRouteBodyError(
        "Learn planning requires includedSourceIds to contain unique document IDs.",
      );
    }
    includedSourceIdSet.add(sourceId);
    includedSourceIds.push(sourceId);
  }

  if (!Object.prototype.hasOwnProperty.call(body, "syllabusSourceId")) {
    throw new InvalidLearnRouteBodyError(
      "Learn planning requires syllabusSourceId to be explicitly null or a non-empty string.",
    );
  }
  const rawSyllabusSourceId = body.syllabusSourceId;
  const syllabusSourceId =
    rawSyllabusSourceId === null
      ? null
      : typeof rawSyllabusSourceId === "string" && rawSyllabusSourceId.trim()
        ? rawSyllabusSourceId.trim()
        : undefined;
  if (syllabusSourceId === undefined) {
    throw new InvalidLearnRouteBodyError(
      "Learn planning requires syllabusSourceId to be explicitly null or a non-empty string.",
    );
  }
  if (syllabusSourceId !== null && includedSourceIdSet.has(syllabusSourceId)) {
    throw new InvalidLearnRouteBodyError(
      "The Learn syllabus cannot also be included as teaching source material.",
    );
  }

  return { includedSourceIds, syllabusSourceId };
}

const LEARN_CONFLICT_NAMES = new Set([
  "LearnExpectedModelConflictError",
  "LearnPipelineConflictError",
  "LearnRepairPendingMapError",
  "LearnWorkerConflictError",
  "LearnWorkerRepairPendingMapError",
]);

export function isLearnRouteConflict(error: unknown): error is LearnRouteConflict {
  return (
    error instanceof Error &&
    LEARN_CONFLICT_NAMES.has(error.name)
  );
}
