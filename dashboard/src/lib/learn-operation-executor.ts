import "server-only";

import db from "@/lib/db";
import { createChatmockClient } from "@/lib/knowledge";
import {
  confirmLearningMap,
  getLearnStatusSnapshot,
  LearnPipelineConflictError,
  rebuildEntireGarden,
  runLearnPipeline,
  runLearnRepairOperation,
  runTextbookGeneration,
  switchFinishedLearnHumanizer,
} from "@/lib/learn";
import type { LearnWorkerRequest } from "@/lib/learn-background";
import { withCapabilityLease } from "@/lib/supervisor-control";

function rejectExistingLearnerContent(): never {
  throw new LearnPipelineConflictError(
    "This garden already has learner content. Use Repair issues, or explicitly confirm Rebuild entire garden to recreate it.",
  );
}

function requireCurrentProposal(
  request: Extract<LearnWorkerRequest, { operation: "confirm" | "confirm_generate" }>,
) {
  const status = getLearnStatusSnapshot({
    gardenId: request.gardenId,
    contentPath: request.contentPath,
  });
  if (status.latestTextbookVersionId || status.hasTextbook) {
    rejectExistingLearnerContent();
  }
  if (
    status.job?.status !== "awaiting_confirmation" ||
    status.job.proposedLearningMapId !== request.proposedLearningMapId ||
    !status.proposedLearningMap
  ) {
    throw new LearnPipelineConflictError(
      "That Learning Map is no longer the current proposal. Refresh and review the latest map before confirming.",
    );
  }
  if (
    status.job.model !== request.expectedModel ||
    (request.operation === "confirm_generate" &&
      request.model !== request.expectedModel)
  ) {
    throw new LearnPipelineConflictError(
      "The model bound to this Learning Map changed before confirmation. Restore the previously selected model, or run Learn planning again with the current selection.",
    );
  }
  return status.proposedLearningMap;
}

/**
 * The single heavy operation boundary shared by the unbundled development
 * worker and the production `after()` runtime. Route-specific validation lives
 * here so moving work out of Next does not weaken its 400/409 semantics.
 */
async function executeLearnOperationInner(
  request: LearnWorkerRequest,
  yieldToResponse?: (jobId: string) => Promise<void>,
): Promise<unknown> {
  const ownedGarden = db
    .prepare("SELECT 1 FROM clusters WHERE user_id = ? AND slug = ?")
    .get(request.userId, request.gardenId);
  if (!ownedGarden) {
    throw new LearnPipelineConflictError(
      "Garden ownership changed after this Learn request was authorized.",
    );
  }
  switch (request.operation) {
    case "plan": {
      const status = getLearnStatusSnapshot({
        gardenId: request.gardenId,
        contentPath: request.contentPath,
      });
      if (status.latestTextbookVersionId || status.hasTextbook) {
        rejectExistingLearnerContent();
      }
      return runLearnPipeline({
        gardenId: request.gardenId,
        userId: request.userId,
        mode: "plan",
        client: createChatmockClient(request.baseURL),
        contentPath: request.contentPath,
        includedSourceIds: request.includedSourceIds,
        syllabusSourceId: request.syllabusSourceId,
        model: request.model,
        sourceOnly: request.sourceOnly,
        includeSourceSnapshots: request.includeSourceSnapshots,
        autoConfirmTopicMap: request.autoConfirmTopicMap,
        yieldToResponse,
      });
    }
    case "generate": {
      const status = getLearnStatusSnapshot({
        gardenId: request.gardenId,
        contentPath: request.contentPath,
      });
      const mayResumeFailedInitialGeneration =
        !status.latestTextbookVersionId &&
        status.hasTextbook &&
        status.job?.mode === "generate" &&
        status.job.status === "failed";
      if (
        (status.latestTextbookVersionId || status.hasTextbook) &&
        !mayResumeFailedInitialGeneration
      ) {
        rejectExistingLearnerContent();
      }
      if (status.job?.status === "failed" && status.job.requiresReplan) {
        throw new LearnPipelineConflictError(
          status.job.error ??
            "The previous generation invalidated its confirmed Learning Map. Start planning again before generating lessons.",
          { requiresReplan: true },
        );
      }
      const requestedSourceIdSet = request.includedSourceIds
        ? new Set(request.includedSourceIds)
        : null;
      const confirmedSelectionMatches =
        !requestedSourceIdSet ||
        (requestedSourceIdSet.size === status.selectedSourceIds.length &&
          status.selectedSourceIds.every((sourceId) =>
            requestedSourceIdSet.has(sourceId),
          ));
      if (
        !status.confirmedLearningMapId ||
        request.requestedConfirmedLearningMapId !==
          status.confirmedLearningMapId ||
        !confirmedSelectionMatches
      ) {
        throw new LearnPipelineConflictError(
          "Generate requires the current confirmed Learning Map and matching source selection. Start planning explicitly for a new garden.",
        );
      }
      if (!status.confirmedLearningMapModel) {
        throw new LearnPipelineConflictError(
          "The confirmed Learning Map is no longer bound to its exact planning model. Run Learn planning again before generating lessons.",
          { requiresReplan: true },
        );
      }
      if (
        request.expectedModel !== status.confirmedLearningMapModel ||
        request.model !== request.expectedModel
      ) {
        throw new LearnPipelineConflictError(
          "The selected Learn model does not match the model that planned this confirmed Learning Map. Restore the planning model, or run Learn planning again with the current selection.",
          { requiresReplan: true },
        );
      }
      return runTextbookGeneration({
        gardenId: request.gardenId,
        userId: request.userId,
        client: createChatmockClient(request.baseURL),
        contentPath: request.contentPath,
        confirmedLearningMapId: status.confirmedLearningMapId,
        model: request.model,
        sourceOnly: request.sourceOnly,
        includeSourceSnapshots: request.includeSourceSnapshots,
        yieldToResponse,
      });
    }
    case "confirm": {
      requireCurrentProposal(request);
      return confirmLearningMap({
        gardenId: request.gardenId,
        learningMapId: request.proposedLearningMapId,
        expectedModel: request.expectedModel,
        contentPath: request.contentPath,
        requireProposed: true,
      });
    }
    case "confirm_generate": {
      const learningMap = requireCurrentProposal(request);
      const generation = await runTextbookGeneration({
        gardenId: request.gardenId,
        userId: request.userId,
        client: createChatmockClient(request.baseURL),
        contentPath: request.contentPath,
        confirmedLearningMapId: request.proposedLearningMapId,
        model: request.model,
        sourceOnly: request.sourceOnly,
        includeSourceSnapshots: request.includeSourceSnapshots,
        confirmProposedLearningMap: true,
        yieldToResponse,
      });
      return { learningMap, generation };
    }
    case "repair":
      return runLearnRepairOperation({
        gardenId: request.gardenId,
        userId: request.userId,
        client: createChatmockClient(request.baseURL),
        model: request.model,
        contentPath: request.contentPath,
        request: request.request,
        yieldToResponse,
      });
    case "rebuild":
      return rebuildEntireGarden(
        request.gardenId,
        {
          userId: request.userId,
          client: createChatmockClient(request.baseURL),
          contentPath: request.contentPath,
          includedSourceIds: request.includedSourceIds,
          syllabusSourceId: request.syllabusSourceId,
          model: request.model,
          sourceOnly: request.sourceOnly,
          includeSourceSnapshots: request.includeSourceSnapshots,
          forceFullRebuild: true,
        },
        yieldToResponse,
      );
    case "humanizer":
      return switchFinishedLearnHumanizer({
        gardenId: request.gardenId,
        userId: request.userId,
        contentPath: request.contentPath,
        enabled: request.enabled,
        expectedVersionId: request.expectedVersionId,
        yieldToResponse,
      });
  }
}

export function executeLearnOperation(
  request: LearnWorkerRequest,
  yieldToResponse?: (jobId: string) => Promise<void>,
): Promise<unknown> {
  return withCapabilityLease(
    "learn-worker",
    `learn-${request.operation}`,
    () => executeAdmittedLearnOperation(request, yieldToResponse),
  );
}

/**
 * Execute after the dedicated worker has acquired its Learn capability lease.
 * Keeping this entry point separate prevents that worker from acquiring twice,
 * while the production in-process fallback above remains independently gated.
 */
export function executeAdmittedLearnOperation(
  request: LearnWorkerRequest,
  yieldToResponse?: (jobId: string) => Promise<void>,
): Promise<unknown> {
  return executeLearnOperationInner(request, yieldToResponse);
}
