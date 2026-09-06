import { createHash } from "crypto";
import os from "os";
import type OpenAI from "openai";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  createLearnRollbackTemporaryRoot,
  reclaimStaleLearnRollbackRoots,
  releaseLearnRollbackTemporaryRoot,
} from "./learn-rollback-temp.ts";
import db from "@/lib/db";
import { withCouncil, type CouncilMode, type CouncilTaskType } from "@/lib/council";
import {
  councilRequestHashV1,
  withResolvedCouncilIdentityV1,
  type CouncilRequestEnvelopeV1,
} from "@/lib/council-request-hash";
import { scrubbed } from "@/lib/watermarks/scrub-text";
import {
  DEFAULT_MODEL,
  cleanGeneratedText,
  refreshClusterIndex,
  scanClusterKnowledge,
} from "@/lib/knowledge";
import { isLearnAuthoredLesson } from "@/lib/learning-garden";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import {
  auditGardenForFinalization,
  finalizeGardenExport,
  repairLearningUnitsFromContract,
  sourceFormulaReviewFinalizationContextFromGarden,
  verifyFinalArtifactNoMutation,
  type SourceFormulaReviewFinalizationContext,
  type UnitRepairRequest,
} from "@/lib/garden-finalize";
import { createOpenAIRepairExecutor } from "@/lib/repair-executor";
import {
  buildCanonicalSourceAnchors,
  describeMissingAnchorFailure,
  missingRegistryAnchorIds,
  type CanonicalSourceAnchor,
} from "@/lib/final-garden-state";
import { freezeActiveGenerationByVersion } from "@/lib/learn-structure-reconciliation";
import { makeCriticArtifactRepair, runCriticLoop } from "@/lib/critic-loop";
import { createLearnFinalCriticProviders } from "@/lib/learn-final-critic";
import {
  LearnCouncilExpiredStartedReceiptError,
  LearnCouncilTerminalReceiptError,
  expiredStartedLearnCouncilReceiptProof,
} from "@/lib/learn-council-semantic-recovery";
import {
  appendGardenEvent,
  pruneVisualArtifacts,
} from "@/lib/visuals";
import {
  learningMapFromModelAuthoredUnits,
  figurePlacementProblems,
  modelAuthoredLearningUnitParseProblems,
  modelAuthoredSourceArtifactOmissionParseProblems,
  normalizeLearningUnits,
  projectModelAuthoredSourceArtifactAssignments,
  projectModelAuthoredSourceArtifactOmissions,
  reconcileLearningUnitSourceArtifacts,
  sameSourceArtifactAssignmentRecords,
  sourceArtifactCoverageProblems,
  sourceArtifactOwnershipProblems,
  validateLearningUnitContracts,
  type LearningUnitContract,
  type RegisteredSourceArtifact,
  type SourceArtifactAssignment,
  type SourceArtifactOmission,
} from "@/lib/learning-unit-contract";
import {
  buildModelAuthoredConceptRegistry,
  claimIdForPlan,
  projectModelAuthoredClaimsToStore,
  writeGardenConceptRegistryAndContract,
} from "@/lib/garden-semantics";
import {
  type SourceFigure,
} from "@/lib/visual-spec";
import {
  extractSourceVisuals,
  computeSourceFormulaReviewSetHash,
  ensureSourcePdfPageSnapshots,
  isFullPageSnapshotUrl,
  loadSourceFormulaReviewSetManifest,
  resolveSourceVisualSourceIdentityMap,
  loadSourceVisuals,
  recordSourceVisualAssignments,
  reviewRequiredSourceFormulaExactText,
  saveSourceFormulaReviewSetManifest,
  sourceSetHashWithReviewedFormulas,
  sourceVisualCachedPageImageUrls,
  sourceVisualScanCoverageProblems,
  sourceVisualSourceIdentityMapHash,
  sourceVisualEmbedUrl,
  sourceVisualMarkdown,
  validateSourceFormulaReviewSet,
  type SourceVisual,
  type SourceFormulaReviewResult,
  type SourceVisualSourceIdentity,
} from "@/lib/source-visuals";
import {
  MAX_SOURCE_MAP_EVIDENCE_REAUTHORS,
  selectedSourceArtifactInventorySnapshot,
  sourceMapArtifactKind,
  sourceMapPlanningEvidenceTransition,
} from "@/lib/learn-source-artifact-inventory";
import {
  learnSourceBindingRecord,
  matchingLearnSourceNormalizationReceipt,
  rebindLearnSourceNormalizationReceipt,
  sourceSetHashForBindingRecords,
} from "@/lib/learn-source-normalization-receipt";
import {
  buildSourceQuestionEvidenceCatalog,
  projectSourceQuestions,
  sourceQuestionAssignmentProblems,
  sourceQuestionPlanProblems,
  type SourceQuestionPlan,
} from "@/lib/learn-source-questions";
import {
  assessLessonQuality,
  buildLearningPageFrontmatter,
  canonicalizeLearnerWikilinks,
  containsRawVisualPlaceholder,
  excludeSyllabusFromSources,
  formatQualityProblemForRepair,
  parseJsonCandidate,
  publicLearningVersionId,
  removeRawVisualPlaceholders,
  safeLearnFileSegment,
  sanitizeLearnerTitle,
  selectLearnSources,
  selectLearnSyllabus,
  sourceVisualInventoryCoverageProblems,
  sourceSetHashForSources,
  sourceSetHashWithSyllabus,
  stripMarkdownFence,
  stripMarkdownFrontmatter,
  textbookPageFileName,
  textbookSectionFolder,
  validateLearningMapDepth,
  wikilinkForRelPath,
  yamlFrontmatter,
  type LearnConceptSummary,
  type LearnContextSummary,
  type LearnSourceSummary,
  type LearnStatus,
  type FormulaGroundingEntry,
  type QualityProblem,
  type LearningSectionPlan,
  type LearningSubsectionPlan,
  type ProposedLearningMap,
} from "@/lib/learn-utils";
import { extractVerbatimDisplayMath, normalizeQuartzMarkdown } from "@/lib/quartz-markdown";
import {
  attachLearnTokenUsageTracking,
  emptyLearnTokenUsage,
  type LearnTokenUsage,
  type LearnTokenUsageEvent,
} from "@/lib/learn-token-usage";
import {
  isAmbiguousModelTransportFailure,
  modelTransportFailureEvidence,
} from "@/lib/http-502-retry";
import {
  ensureLearnTokenUsagePersistenceSchema,
  discardPersistedLearnTokenUsageForProvenMissingReceipt,
  persistedLearnTokenUsageForJob,
  reconcilePersistedLearnTokenUsageFromReceipt,
  reconcilePersistedLearnTokenUsageForTerminalJob,
  reconcilePersistedLearnTokenUsageForStaleTerminalJobs,
  recordPersistedLearnTokenUsageEvent,
} from "@/lib/learn-token-usage-persistence";
import {
  appendDurablePlanningIssuanceEvent,
  classifyRecoveredLegacyPlanningOrigin,
  classifyLegacyStageIssuanceEvidence,
  completePlanningCheckpoint,
  completePlanningCheckpointWithAdoption,
  createStartedPlanningCheckpoint,
  dispatchAfterExactPlanningAuthority,
  dispatchAfterDurablePlanningIssuance,
  ensureLearnPlanningCheckpointSchema,
  exactStrictReceiptOriginBinding,
  hasExactExpiredStartedPlanningReceiptBoundary,
  hasCompletedNativePlanningCheckpoint,
  hasExactPlanningDispatchAuthority,
  materializeLegacyPlanningCheckpoint,
  materializedLegacyPlanningResults,
  planningCheckpointOriginCounts,
  planningCheckpointRecoveryDisposition,
  PlanningRecoveryBoundaryError,
  priorPlanningCheckpoints,
  priorRecoveredPlanningJobs,
  recoverBeforePlanningDispatch,
  recordExpiredStartedPlanningReceiptBoundary,
  resolveUniquePlanningCandidate,
  type PriorPlanningCheckpointRow,
  type PriorRecoveredPlanningJobRow,
} from "@/lib/learn-planning-checkpoints";
import {
  adoptCompletedLearnCouncilCheckpoint,
  adoptCompletedLearnCouncilCheckpointWithBoundary,
  adoptClaimedLearnCouncilRedispatch,
  assertUniqueLegacyLearnCouncilFailureWithoutCompletion,
  canStartLearnCouncilAfterLegacyAbsence,
  claimLearnCouncilMissingReceiptRecovery,
  claimLearnCouncilRedispatch,
  completeLearnCouncilReceiptChain,
  createStartedLearnCouncilCheckpoint,
  createStartedLearnCouncilCheckpointAfterLegacyFailure,
  currentLearnCouncilCheckpoint,
  ensureLearnCouncilCheckpointSchema,
  exactFailedLearnCouncilLineage,
  exactLearnCouncilRetryJobBinding,
  hasDurableLearnCouncilNoDispatchBoundary,
  hasNativeLearnCouncilCheckpoint,
  isExactLegacyLearnCouncilFailureShape,
  learnCouncilDispatchGenerationOwners,
  legacyLearnCouncilLineageQuiescenceDelayMs,
  learnCouncilRetryJob,
  materializeCompletedLegacyLearnCouncilCheckpoint,
  materializeCompletedLegacyLearnCouncilCheckpointAfterFailure,
  priorLearnCouncilCheckpoints,
  recordLearnCouncilNativeLineageBoundary,
  selectNewestCompletedLearnCouncilCheckpoint,
  LEARN_COUNCIL_PRE_DISPATCH_FAILURE_STEP,
  type LearnCouncilCheckpointRow,
  type LearnCouncilDispatchGenerationOwnerRow,
  type LegacyLearnCouncilFailureProof,
  type NativeLearnCouncilBoundaryProof,
} from "@/lib/learn-council-checkpoints";
import {
  assertExactOrdinaryLearnCouncilReceiptAttempt,
  completedLearnCouncilReceiptAttemptMatchesResult,
  learnCouncilReceiptOwnerPrefixIsExact,
  parseLearnCouncilReceiptAttempts,
  sumLearnCouncilReceiptAttemptUsage,
  type LearnCouncilReceiptAttempt,
} from "@/lib/learn-council-receipt-accounting";
import {
  assertLegacyPlanningWaiverContainsResult,
  assertLegacyPlanningWaiverFullyMaterialized,
  assertLegacyPlanningWaiverMatchesInventory,
  assertLegacyPlanningWaiverPredatesCurrentJob,
  assertNextLegacyPlanningWaiverResult,
  persistLegacyPlanningWaiverExercise,
  readExactLegacyPlanningWaiver,
  type LegacyPlanningWaiverBinding,
} from "@/lib/learn-planning-legacy-waiver";
import { strictChatMockInternalRecoveryUrl } from "@/lib/learn-planning-internal-url";
import { auditedLegacyPlanningInventory } from "@/lib/learn-planning-legacy-inventory";
import {
  expectedStrictLearnModelRoute,
  planningReceiptProvesOneExactModelCall,
} from "@/lib/learn-planning-route-proof";
import {
  monotonicLearnProgress,
  transitionLearnTimer,
} from "@/lib/learn-timer";
import { getLearnStatusSnapshot as projectLearnStatusSnapshot } from "@/lib/learn-status-projection";
import {
  authoredSyllabusLocatorCatalog,
  buildSyllabusCoverageSourceCatalog,
  detectUnavailableCitations,
  modelAuthoredSyllabusPlanProblems,
  projectModelAuthoredSyllabusPlan,
  projectModelAuthoredSyllabusCoverage,
  summarizeSyllabusCoverage,
  syllabusCoverageDecisionProblems,
  unavailableCitationProbes,
  type SyllabusCoverage,
  type SyllabusPlan,
  type UnavailableCitationProbe,
} from "@/lib/learn-syllabus";
import {
  runSyllabusCoverageEvidenceRecovery,
  syllabusCoverageHasTeachableUnits,
  syllabusCoverageRecoveryReceiptProblems,
  type SyllabusCoverageEvidenceRecoveryReceipt,
  type SyllabusCoverageRecoveryProviderRequest,
} from "@/lib/learn-syllabus-coverage-recovery";
import {
  loadVisualDecisionOverrides,
  saveVisualNecessityArtifacts,
  type GardenVisualNecessityPlan,
} from "@/lib/visual-necessity";
import {
  buildModelVisualNecessityPacket,
  runModelVisualNecessityPlanning,
} from "@/lib/model-visual-necessity";
import { runLearningSpineTargetedRepair } from "@/lib/model-learning-spine-repair";
import { projectCanonicalLearningSpinePacket } from "@/lib/learning-spine-prompt-projection";
import {
  describeLearningSpineRepairAttempts,
  learningSpineFullRepairFeedback,
  recordLearningSpineFullRepairCandidate,
  startLearningSpineFullRepairLineage,
  type LearningSpineFullRepairFeedback,
} from "@/lib/learning-spine-full-repair";
import {
  modelSourcePageAnchors,
  selectedStructuralSourcePageHints,
  type ModelSourcePageAnchorRecord,
  type SelectedStructuralSourcePageHint,
} from "@/lib/model-source-anchor-ledger";
import { learnBuildStateMode } from "@/lib/garden-build/mode";
import { runCanonicalGardenShadowBuild } from "@/lib/garden-build/shadow";
import {
  humanizeFinishedLearnBuild,
  readLearnHumanizerVersionState,
  resetLearnTreeToAiCopy,
  restoreLearnAiCopy,
  writeLearnHumanizerVersionState,
  type LearnHumanizerVersionState,
} from "@/lib/learn-humanizer";
import {
  buildVisualizationCoverageReport,
  applyVisualizationRoutesToLearningUnits,
  coverageGateMode,
  saveVisualizationCoverageReport,
  saveVisualizationPlan,
  type VisualizationPlan,
  type VisualizationPublicationOutcome,
} from "@/lib/visualization-opportunities";
import {
  buildVisualizationContractRepairPrompt,
  buildVisualizationPlanWithContractRepair,
  exactVisualizationContractRepairResponse,
  type VisualizationContractRepairPacket,
} from "@/lib/visualization-contract-repair";
import {
  canonicalVisualizationEvidenceByUnit,
  declaredVisualizationSourceAnchorIdsForUnit as declaredSourceAnchorIdsForUnit,
} from "@/lib/visualization-canonical-evidence";
import {
  AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH,
  renderAuthoritativeLearningUnitContractMarkdown,
} from "@/lib/learning-unit-contract-markdown";
import {
  buildVisualContractExecutabilityLedger,
  buildFinalVisualizationPlanFromRoutedContracts,
  reviewVisualizationPlanExecutability,
  saveVisualContractExecutabilityLedger,
  strictVisualContractExecutabilityResponseOrExactRaw,
  visualContractExecutabilityArtifactProvenanceProblems,
  visualContractExecutabilityLinkageProblems,
  VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH,
  type VisualContractExecutabilityLedger,
  type VisualContractExecutabilityLedgerContext,
  type VisualContractExecutabilityProviderRequest,
} from "@/lib/visualization-contract-executability";
import {
  buildGeneratedVisualBlock,
  createGeneratedVisualization,
  GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
} from "@/lib/generated-visuals";
import { compileGeneratedVisualization } from "@/lib/generated-visual-compiler";
import { runGeneratedVisualBrowserTestsLocally } from "@/lib/generated-visual-browser-tests";
import { stableGeneratedVisualCouncilRecoveryRoot } from "@/lib/generated-visual-council-receipts";
import {
  persistLearnVisualRejectedAttemptAudit,
  removeAllLearnVisualRejectedAttemptAudits,
  removeLearnVisualRejectedAttemptAudit,
} from "@/lib/learn-visual-rejected-attempt-audit";
import {
  normalizeLearnOperationMode,
  type LearnOperationMode,
  type LegacyLearnOperationMode,
  type StartLearnOperationRequest,
} from "@/lib/learn-operation-mode";
import {
  exactScopedModelRepairResponse,
  executeLearnScopedRepair,
  type LearnScopedRepairResult,
} from "@/lib/learn-scoped-repair";
import {
  acquireGardenLearnLease,
  acquireGardenLearnLock,
  LOCK_STALE_MS,
  promoteStagingGarden,
  type GardenLearnLease,
} from "@/lib/learn-atomic-promotion";
import {
  createLearnBuildWorkspace,
  disposeLearnBuildWorkspace,
  fingerprintDurableGardenState,
  learnWorkspaceRootCandidates,
  retainFailedLearnWorkspacesForJob,
  retainLearnBuildWorkspace,
  verifyAuthoritativeSourceAnchorLedger,
  type LearnBuildWorkspace,
} from "@/lib/learn-build-workspace";
import {
  incrementalLearningUnitPreservationProblems,
  incrementalSourceMapPreservationProblems,
  publishedLearningPagesByUnitId,
  readIncrementalLearnBaseline,
  type IncrementalLearnBaseline,
} from "@/lib/learn-incremental";
import {
  clearGeneratedLearnState,
  type LearnFilesystemClearResult,
} from "@/lib/learn-clear";
import {
  clearLearnDatabaseRecords,
  type LearnDatabaseClearResult,
} from "@/lib/learn-clear-database";
import { clearLearnSemanticChunks } from "@/lib/semantic-retrieval";
import type { GardenIssue } from "@/lib/garden-build/issues";

export type {
  LearnStatus,
  LearningSectionPlan,
  LearningSubsectionPlan,
  ProposedLearningMap,
};

export type LearnMode = LearnOperationMode;

export interface LearnJob {
  id: string;
  gardenId: string;
  userId?: number;
  model: string;
  status: LearnStatus;
  mode: LearnMode;
  currentStep: string;
  progressPercent: number;
  currentSectionTitle?: string;
  currentPageTitle?: string;
  error?: string;
  /** The failed operation invalidated its confirmed map; retry must replan. */
  requiresReplan: boolean;
  proposedLearningMapId?: string;
  confirmedLearningMapId?: string;
  latestTextbookVersionId?: string;
  sourceSetHash?: string;
  sourceIds: string[];
  /** Slug of the document designated as this run's syllabus (study guide). */
  syllabusSourceId?: string;
  /** User-authored natural-language direction applied to planning and writing. */
  userInstruction?: string;
  sourceOnly: boolean;
  includeSourceSnapshots: boolean;
  /** Set only while `status` is "paused": the status Resume returns to. */
  pausedFromStatus?: LearnStatus;
  tokenUsage: LearnTokenUsage;
  elapsedMs: number;
  timerStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredLearningMap {
  id: string;
  gardenId: string;
  jobId: string;
  status: "proposed" | "confirmed";
  sourceMap: unknown;
  scopeContract: unknown;
  learningMap: ProposedLearningMap;
  proposedOrder: LearningSectionPlan[];
  visualOpportunities: unknown[];
  coveragePlan: unknown;
  sourceSetHash: string;
  /** Exact selected-source visual inventory supplied to the authored Source Map. */
  sourceArtifactInventoryHash: string;
  sourceIds: string[];
  /** Slug of the document this map was planned against as its syllabus. Page
   * generation re-reads it so lessons follow the same study guide the plan did. */
  syllabusSourceId?: string;
  /** The syllabus read into units + the availability check of every work it
   * assigns. Persisted so page writing gates on the same answer planning did,
   * without a second model call that could resolve differently. */
  syllabusCoverage?: SyllabusCoverage | null;
  /** Complete model-approved visual route bundle. It is map-bound so lesson
   * generation never has to ask the model to allocate visuals a second time. */
  visualNecessityReview?: GardenVisualNecessityPlan;
  visualizationPlan?: VisualizationPlan;
  visualContractExecutabilityLedger?: VisualContractExecutabilityLedger;
  visualRouteBinding?: ConfirmedVisualRouteBinding;
  createdAt: string;
  confirmedAt?: string;
}

interface ConfirmedVisualRouteBinding {
  schemaVersion: 1;
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  sourceFormulaReviewSetHash: string;
  learningUnitContractSha256: string;
  visualNecessityReviewSha256: string;
  visualizationPlanSha256: string;
  visualContractExecutabilityLedgerSha256: string;
}

interface ConfirmedVisualRouteBundle {
  visualNecessityReview: GardenVisualNecessityPlan;
  visualizationPlan: VisualizationPlan;
  executabilityLedger: VisualContractExecutabilityLedger;
  binding: ConfirmedVisualRouteBinding;
}

export interface LearnStatusSnapshot {
  job: LearnJob | null;
  proposedLearningMap: ProposedLearningMap | null;
  confirmedLearningMapId?: string;
  /** Model recorded by the exact planning job that authored the confirmed map. */
  confirmedLearningMapModel?: string;
  latestTextbookVersionId?: string;
  humanizer: LearnHumanizerVersionState | null;
  hasSources: boolean;
  sourceCount: number;
  selectedSourceIds: string[];
  selectedSourceCount: number;
  /** Document designated as the syllabus, or null when the run has none. */
  syllabusSourceId: string | null;
  /** What the syllabus asked for versus what this garden can actually teach.
   * Null until a run has read the syllabus. */
  syllabusCoverage: {
    unitCount: number;
    materialCount: number;
    availableCount: number;
    missingCount: number;
    genericCount: number;
    missingCitations: string[];
  } | null;
  hasTextbook: boolean;
  sourceSetChanged: boolean;
  buttonLabel: string;
  validationReport?: LearnValidationReport | null;
  scopedRepair?: LearnScopedRepairSummary | null;
}

export interface LearnScopedRepairSummary {
  repairId: string;
  issueCount: number;
  unitIds: string[];
  pageIds: string[];
  sectionIds: string[];
  visualIds: string[];
  allowedFiles: string[];
  changedFiles: string[];
  modelCalls: number;
  blockersBefore: number;
  blockersAfter: number;
  unaffectedPageHashesVerified: boolean;
  accepted: boolean;
  publishReady: boolean;
  reason: string;
}

export interface LearnValidationReport {
  relativePath: string;
  url: string;
  markdown: string;
  truncated: boolean;
  accepted?: boolean;
  generatedAt?: string;
}

interface LearnJobRow {
  id: string;
  garden_id: string;
  user_id: number | null;
  model: string | null;
  status: LearnStatus;
  mode: LearnMode;
  current_step: string | null;
  progress_percent: number | null;
  current_section_title: string | null;
  current_page_title: string | null;
  error: string | null;
  requires_replan: number | null;
  proposed_learning_map_id: string | null;
  confirmed_learning_map_id: string | null;
  latest_textbook_version_id: string | null;
  source_set_hash: string | null;
  source_ids_json: string | null;
  syllabus_source_id: string | null;
  user_instruction: string | null;
  source_only: number | null;
  include_source_snapshots: number | null;
  paused_from_status: LearnStatus | null;
  active_elapsed_ms: number | null;
  timer_started_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LearnMapRow {
  id: string;
  garden_id: string;
  job_id: string;
  status: "proposed" | "confirmed";
  source_map_json: string;
  scope_contract_json: string;
  learning_map_json: string;
  proposed_order_json: string;
  visual_opportunities_json: string;
  coverage_plan_json: string;
  source_set_hash: string;
  source_artifact_inventory_hash: string;
  source_ids_json: string | null;
  syllabus_source_id: string | null;
  syllabus_coverage_json: string | null;
  visual_necessity_review_json: string | null;
  visualization_plan_json: string | null;
  visual_contract_executability_ledger_json: string | null;
  visual_route_binding_json: string | null;
  created_at: string;
  confirmed_at: string | null;
}

interface LearnVersionRow {
  id: string;
  garden_id: string;
  job_id: string;
  learning_map_id: string;
  source_set_hash: string;
  source_artifact_inventory_hash: string;
  page_count: number;
  backup_dir: string | null;
  created_at: string;
}

interface LearnSourceContext extends LearnContextSummary {
  baseSourceSetHash: string;
  sourceSetHash: string;
  sourceFormulaReviewSetHash?: string;
  /** Versioned canonical inventory of every selected planner-visible source artifact. */
  sourceArtifactInventoryHash: string;
  /** Durable garden-global S<n> ownership; never compacted to this run's selection. */
  sourceVisualSourceIdentityMap: SourceVisualSourceIdentity[];
  sourceFigures: SourceFigure[];
  existingTextbookPages: LearnSourceSummary[];
  conceptNodes: LearnConceptSummary[];
  /** The designated study guide, kept out of `sources` so it steers the lessons
   * instead of becoming one of them. */
  syllabus: LearnSourceSummary | null;
  /** Every document the user selected, syllabus included. Persisted on the job
   * and map so a confirmed run re-derives exactly this split later. */
  selectedSourceIds: string[];
}

interface CouncilCallResult {
  content: string;
  councilRunId?: string;
  councilMode?: string;
  /** True only when a durable prior Council result was adopted without a POST. */
  recovered?: boolean;
}

interface LearnPlanningRequestCheckpoint {
  jobId: string;
  contentPath: string;
  stageKey: string;
  stageLabel: string;
  semanticAttempt: number;
}

interface LearnOrdinaryRequestCheckpoint {
  jobId: string;
  contentPath: string;
  stageKey: string;
  stageLabel: string;
  semanticAttempt: number;
}

interface PromptlessCouncilRecoveryResult {
  councilRunId: string;
  councilMode?: string;
  finalAnswer: string;
  responseHash: string;
  requestedModel?: string;
  resolvedModel?: string;
  modelRouting: Array<Record<string, unknown>>;
  usageEstimated?: boolean;
  createdAt: string;
  updatedAt: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    callCount: number;
    reportedCallCount: number;
  };
}

interface StrictCouncilReceiptMetadata {
  dispatchGeneration: number;
  dispatchCount: number;
  redispatchCount: number;
  redispatchAllowed: boolean;
  failureCode?: string;
  attempts: LearnCouncilReceiptAttempt[];
}

interface LegacyCouncilFailureOutcome extends LegacyLearnCouncilFailureProof {
  finalAnswerPresent: false;
  candidateCount: 0;
  outcome: "failed";
  modelRouting: Array<Record<string, unknown>>;
}

interface PlanningReceiptRedispatch {
  kind: "same_receipt_redispatch";
  requestId: string;
  checkpointRequestId: string;
  requestHash: string;
  redispatchReason: "receipt_not_found" | "request_failed";
}

/** A 502 is replayable only after the strict ChatMock receipt proves that the
 * exact provider generation ended without a reusable answer. Keeping this
 * distinct from an arbitrary SDK/HTTP error lets the outer Learn call create a
 * fresh receipt without ever replaying an ambiguous in-flight request. */
class LearnCouncilHttp502ReceiptError extends LearnCouncilTerminalReceiptError {
  readonly status = 502;
  readonly cause: unknown;

  constructor(receipt: ConstructorParameters<typeof LearnCouncilTerminalReceiptError>[0], cause: unknown) {
    super(receipt);
    this.name = "LearnCouncilHttp502ReceiptError";
    this.cause = cause;
  }
}

function isPlanningReceiptRedispatch(
  value: CouncilCallResult | PlanningReceiptRedispatch | null,
): value is PlanningReceiptRedispatch {
  return Boolean(
    value &&
    "kind" in value &&
    value.kind === "same_receipt_redispatch",
  );
}

class LearnPlanningRecoveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnPlanningRecoveryConflictError";
  }
}

/** A promptless Council read is safe to repeat because it is a loopback-only
 * GET that cannot dispatch a model call. Keep transport failures distinct from
 * malformed/conflicting receipts so ordinary Learn recovery can wait through
 * a temporarily saturated ChatMock process without weakening fail-closed
 * receipt validation. */
class LearnCouncilResultObservationTransportError extends LearnPlanningRecoveryConflictError {
  constructor(message: string) {
    super(message);
    this.name = "LearnCouncilResultObservationTransportError";
  }
}

/**
 * Fallback model for Learn.
 *
 * Learn used to be pinned to this model on the grounds that a Council workload
 * should not drift with the interactive assistant's picker. That is no longer
 * the behaviour: the Learn panel runs on whatever model the user has selected,
 * so one choice governs every AI call Breadboard makes. This constant is what
 * that resolution falls back to when the user has expressed no preference.
 *
 * The trade-off is real — a model with a smaller context window or weaker
 * instruction-following will produce a weaker garden here than it does in chat.
 */
export const LEARN_MODEL = "gpt-5.6-sol";
// ChatMock exposes GPT-5.6's maximum reasoning tier as the UI's “Ultra”
// setting. Learn is a quality-first, bounded workflow, so use that tier for
// its selected GPT-5.6 model rather than silently running at a lower effort.
export const LEARN_REASONING = {
  effort: "max",
  summary: "detailed",
} as const;

type CouncilJsonResult = CouncilCallResult & { parsed: unknown | null };

interface GeneratedPageRecord {
  title: string;
  relPath: string;
  learningUnitId?: string;
  sourceAnchors: string[];
  visualIds: string[];
  sourceFigureIds: string[];
  sourceFormulaIds: string[];
  sourceTableIds: string[];
}

// --- Learn generation token-budget configuration ----------------------------
// Planning, page writing, and repair use configurable council modes guarded by
// deterministic quality gates. Defaults are token-efficient; env vars can
// loosen them for slower, heavier reasoning when needed.

const COUNCIL_MODE_VALUES: readonly CouncilMode[] = [
  "direct_council",
  "lite_council",
  "full_council",
  "evolution_council",
];

function envCouncilMode(name: string, fallback: CouncilMode): CouncilMode {
  const value = process.env[name];
  return (COUNCIL_MODE_VALUES as readonly string[]).includes(value ?? "")
    ? (value as CouncilMode)
    : fallback;
}

function envPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function envClampedPositiveInt(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(minimum, Math.min(maximum, envPositiveInt(name, fallback)));
}

const LEARN_FINALIZE_MAX_ROUNDS = envClampedPositiveInt(
  "LEARN_FINALIZE_MAX_ROUNDS",
  8,
  1,
  12,
);
const LEARN_FINALIZE_MAX_RUNTIME_MS = envClampedPositiveInt(
  "LEARN_FINALIZE_MAX_RUNTIME_MS",
  45 * 60 * 1000,
  30 * 1000,
  2 * 60 * 60 * 1000,
);

/** Council mode for normal subsection/page writing. Never full_council by default. */
const LEARN_GENERATION_COUNCIL_MODE = envCouncilMode(
  "LEARN_GENERATION_COUNCIL_MODE",
  "direct_council",
);
/**
 * Council mode for planning. `direct_council` is a single upstream model call
 * per stage; `lite_council` fans out to three sequential calls (candidate →
 * review → synthesis) and `full_council` to many. Planning runs THREE stages
 * back to back (source map → scope contract → learning spine), so a fan-out
 * mode multiplies upstream latency by ~3–9x and is the reason planning kept
 * exceeding the request timeout. Recoverable planning is therefore pinned to
 * the single-call path.
 */
// Durable planning receipts validate exactly one non-fallback route; allowing
// a fan-out mode here would make every correctly recovered result invalid.
const LEARN_PLANNING_COUNCIL_MODE: CouncilMode = "direct_council";
/** Council mode for revision/repair calls. Never full_council by default. */
const LEARN_REVISION_COUNCIL_MODE = envCouncilMode(
  "LEARN_REVISION_COUNCIL_MODE",
  "direct_council",
);
/**
 * A ChatMock provider generation has a finite total websocket lifetime. Once
 * that deadline plus a small final-receipt grace has elapsed, a receipt still
 * in `started` cannot belong to a live provider call. This lets a later Learn
 * retry cross a process-crash orphan without replaying an in-flight request.
 */
const LEARN_COUNCIL_WEBSOCKET_TOTAL_TIMEOUT_MS =
  envClampedPositiveInt(
    "CHATMOCK_COUNCIL_WEBSOCKET_TOTAL_TIMEOUT",
    1_800,
    901,
    21_600,
  ) * 1_000;
const LEARN_COUNCIL_STARTED_RECEIPT_MAX_AGE_MS =
  LEARN_COUNCIL_WEBSOCKET_TOTAL_TIMEOUT_MS + 60_000;
/**
 * Per-call planning timeout. It must outwait the provider websocket lifetime
 * and the final-receipt grace above; otherwise a still-live generation is
 * surfaced as a terminal client timeout before its authoritative receipt can
 * settle. An explicit LEARN_PLANNING_TIMEOUT_MS remains available for tightly
 * controlled deployments, while the safe default adds one more minute for the
 * response to cross the local proxy boundary.
 */
const LEARN_PLANNING_TIMEOUT_MS = envPositiveInt(
  "LEARN_PLANNING_TIMEOUT_MS",
  LEARN_COUNCIL_STARTED_RECEIPT_MAX_AGE_MS + 60_000,
);
const LEARN_VISUAL_MAX_REPEATED_INTERACTION_SIGNATURE = 1;
/** Explicit full-generation attempts per page. This loop is never entered by
 * scoped repair; only generate/full_rebuild may create fresh page drafts. */
const MAX_PAGE_ATTEMPTS = Math.max(
  1,
  Math.min(2, envPositiveInt("LEARN_MAX_PAGE_ATTEMPTS", 2)),
);
const MAX_TOTAL_SOURCE_CHARS_PER_PAGE = envPositiveInt(
  "LEARN_MAX_TOTAL_SOURCE_CHARS_PER_PAGE",
  24_000,
);
/** Compact JSON for prompts. Pretty-printed JSON is reserved for debug
 * artifacts on disk; whitespace in prompt JSON is pure token waste. */
function compactJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function logPromptBudget(
  label: string,
  system: string,
  user: string,
  sourceContext?: unknown,
): void {
  if (process.env.LEARN_LOG_PROMPT_BUDGET === "false") return;

  const sourceText = sourceContext ? JSON.stringify(sourceContext) : "";
  const totalChars = system.length + user.length + sourceText.length;

  console.log(`[learn-token-budget] ${label}`, {
    systemChars: system.length,
    userChars: user.length,
    sourceContextChars: sourceText.length,
    totalChars,
    approxInputTokens: approxTokens(system + user + sourceText),
  });
}

// Voice rules shared by every prose-producing prompt. The generated garden is a
// standalone lesson on the topic; the uploaded source grounds it silently.
const LEARNER_VOICE_RULES = `Voice rules (hard requirements):
- Write a direct lesson on the topic itself, never a commentary on the uploaded document.
- The learner must feel they are reading a lesson on the topic, not a review of a PDF.
- NEVER use the word "textbook" anywhere.
- NEVER frame content as "the paper says", "the source frames", "in this paper", "the source material explains", "source-derived", "source-central", "according to the source". The source grounds the content silently.
- Teaching sentences take the concept as their subject ("A spiking neuron carries information in discrete events"), never the document ("The paper introduces spiking neurons").
- Stay within what the source material supports; grounding is silent, not narrated.`;

const TITLE_RULES = `Title rules (hard requirements):
- Titles name the concept the learner will understand, standalone.
- Bad: "Why the Source Turns from Conventional Neural Networks to SNNs", "What Spiking Neural Networks Are in This Paper", "Source-Derived Comparative Results", "The Named Neuron Model LIF as Source-Central Evidence".
- Good: "Why Spiking Neural Networks Exist", "Spikes, Timing, and Event-Driven Computation", "The Leaky Integrate-and-Fire Neuron", "How SNNs Learn", "Accuracy, Latency, Energy, and Spike Count", "Choosing an SNN Training Strategy".
- Never contain "paper", "source", "textbook", or "overview" in a title.`;

const SOURCE_MAP_PROMPT = `You create the internal Source Map for a Breadboard learning garden. This document is internal planning data; learners never see it.
Return ONLY JSON with this exact top-level shape:
{
  "sources": [{
    "id": "exact supplied source id",
    "title": "exact supplied source title",
    "role": "what this source contributes",
    "centralConcepts": ["concise source-grounded concept"],
    "formulas": ["registered formula id plus concise purpose"],
    "examples": ["concise source-grounded example"],
    "questions": ["question the material can answer"],
    "caveats": ["only genuinely unsupported or unclear material"]
  }],
  "figures": [{
    "id": "exact id from supplied sourceVisuals",
    "sourceId": "exact supplied source id",
    "kind": "figure | graph | table | formula",
    "caption": "concise caption",
    "teachingValue": "what this registered artifact can teach"
  }],
  "sourceAnchors": [{
    "id": "exact id copied from supplied canonicalSourceAnchors",
    "sourceId": "exact supplied source id",
    "title": "short anchor title",
    "summary": "concise supported content"
  }],
  "sourceQuestions": [{
    "id": "Q1",
    "sourceId": "exact supplied source id",
    "label": "source label such as Problem 6.21",
    "prompt": "verbatim source-authored question text",
    "sourceAnchorIds": ["exact canonical source anchor id containing the question"],
    "relatedFigureIds": ["exact registered figure/graph id required by the question"],
    "syllabusAssignments": [{
      "unitId": "exact syllabus unit id",
      "reference": "exact question reference copied from that syllabus unit"
    }],
    "teachingValue": "what solving this question lets the learner practice"
  }],
  "unresolvedSyllabusQuestionReferences": [{
    "unitId": "exact syllabus unit id",
    "reference": "exact assigned question reference",
    "reason": "why the selected sources do not provide this question"
  }],
  "missingOrUnclear": ["only genuinely missing or unclear content"]
}
Return exactly one sources entry for every supplied source id and no unknown source. Keep the map concise: at most 30 central concepts, at most 40 selected sourceAnchors per source, and at most 20 entries in each other per-source list.
sourceContext.sourceVisuals is the authoritative normalized Source Map artifact catalog. The figures array is its complete registry projection: return exactly one entry for every supplied sourceVisuals record, and copy each id, sourceId, and kind verbatim. figures is exempt from the 20-entry concision cap. Its only valid kinds are figure, graph, table, and formula; never return detector labels such as diagram, photo, unknown, or equation.
Every sourceAnchors id must be copied verbatim from supplied canonicalSourceAnchors and must retain its matching sourceId. The catalog records structural Markdown pages and registered source artifacts; you decide which evidence matters, while code only verifies and projects your choices. Never invent, rewrite, or fuzzy-match an anchor id.
Question mapping rules (hard):
- sourceQuestionEvidence contains exact source pages selected mechanically because a registered figure caption points to a problem/question/exercise or because the syllabus explicitly assigns one. It is evidence, not a semantic decision: identify the actual question and its teaching section yourself.
- For every registered figure or graph whose caption names a problem/question/exercise, create sourceQuestions records for the named question(s), copy each complete prompt verbatim from the source, and put that artifact's exact id in relatedFigureIds. Never separate a figure-dependent question from its figure.
- A syllabus unit's questionReferences are exact assignments. Map every reference to the relevant sourceQuestions record(s) through exact syllabusAssignments pairs when the selected source contains it; otherwise put that exact pair in one unresolvedSyllabusQuestionReferences record with a specific reason. Never silently drop or guess an assigned question.
- sourceQuestions is a selected practice registry, not a duplicate concept summary. Include figure-linked and syllabus-assigned source questions; do not turn ordinary rhetorical prose into exercises.
- sourceAnchorIds must identify the exact source page(s) that contain the prompt. prompt must be copied verbatim, including the given values, subparts, and notation.
Availability rule (hard): any formula, equation, figure, table, or graph that has an extracted anchor or caption IS available source material. Never place it in missingOrUnclear, and never write caveats saying formulas/equations/notation/definitions/tables/figures are unavailable, "caption-only", "captions but not exact", or "not present" — pages will ground on those anchors. Caveat ONLY about content that has no extracted anchor at all.
Stay source-aware. If source-only mode is true, do not add outside facts.`;

const SCOPE_CONTRACT_PROMPT = `You create the internal Scope Contract for a Breadboard learning garden. This document is internal planning data; learners never see it.
Return ONLY JSON with exactly these six arrays of concise strings: included, excluded, background, deferred, sourceEmphasis, and caveats. included and sourceEmphasis must be non-empty. Do not return prose outside the JSON object.
The contract must protect source scope: no unsupported expansion, no disconnected topic cards, and no final Generated Subtopics pages.
Availability rule (hard): treat any extracted formula, equation, figure, table, or graph anchor as available. Do not add caveats claiming formulas, notation, definitions, tables, or figures are unavailable or caption-only when anchors for them exist.`;

const TOPIC_MAP_PROMPT = `You create the source-grounded Learning Unit Contract and its section spine for a Breadboard learning garden. Author every learning unit needed to cover the teachable syllabus and source scope at the required depth, then assign every unit to a model-authored section in the same response. Code will validate and project your section decisions verbatim; it will not cluster, title, or explain sections for you.
Return ONLY JSON with this shape:
{
  "title": "Topic title (the subject itself, e.g. 'Spiking Neural Networks')",
  "summary": "short description of what the learner will be able to do",
  "learningUnits": [
    {
      "id": "U1",
      "title": "One precise teaching step",
      "role": "motivation | core_concept | mechanism | formula | worked_example | training_method | metric | result_interpretation | comparison | application | limitation | synthesis",
      "learningQuestion": "one conceptual learner question this unit answers",
      "prerequisiteConcepts": ["..."],
      "newConcepts": ["..."],
      "syllabusUnitIds": ["exact syllabusCoverage.units[].unitId; empty when no syllabus is supplied"],
      "sourceAnchors": ["exact canonical source anchor ids"],
      "sourceFigures": [
        {
          "id": "S1.P4.F1",
          "placement": "inside_concept_explanation | after_formula_introduction | inside_result_interpretation | beside_worked_example | inside_comparison",
          "mustBeDiscussedWith": "nearby idea or paragraph",
          "interpretationGoal": "what the learner must notice"
        }
      ],
      "sourceFormulas": [
        {
          "id": "S1.P6.E1",
          "teachingGoal": "what the formula teaches",
          "termsToDefine": ["symbol or term"],
          "placement": "before_example | inside_metric_definition | inside_result_interpretation"
        }
      ],
      "sourceTables": [
        {
          "id": "S1.P7.T1",
          "teachingGoal": "what the comparison/result table teaches",
          "rowsOrColumnsToExplain": ["row or column"],
          "placement": "inside_comparison | inside_result_interpretation"
        }
      ],
      "sourceQuestions": [
        {
          "id": "exact id copied from sourceMap.sourceQuestions",
          "placement": "inside_worked_example | guided_practice | end_of_page_check",
          "teachingGoal": "what the learner practices by solving it"
        }
      ],
      "semanticConcepts": [
        {
          "slug": "stable-reusable-concept-slug",
          "preferredLabel": "Human-readable concept label",
          "role": "primary | supporting",
          "aliases": ["acronym or equivalent label"],
          "evidenceAnchors": ["source anchor ids"]
        }
      ],
      "knowledgeClaims": [
        {
          "text": "One readable source-grounded statement.",
          "subject": "canonical-concept-slug",
          "predicate": "prerequisite-of | causes | enables | derived-from | measured-by | contrasts-with | example-of | part-of | applies-to | limits | emits-when | related-to",
          "object": "optional-canonical-concept-slug",
          "evidenceAnchors": ["source anchor ids"]
        }
      ],
      "zettelNotes": [
        {
          "handle": "canonical-atomic-handle",
          "claim": "one readable atomic note",
          "connectedTo": ["another-canonical-handle"]
        }
      ],
      "mustNotRepeat": ["motif, framing, or example already used"],
      "expectedWordRange": [700, 1100],
      "sectionPlan": {
        "id": "S1",
        "title": "A specific learner-facing section title",
        "purpose": "What this section teaches and why these units belong together",
        "singleSubsectionReason": "required only when this section intentionally contains one unit"
      }
    }
  ],
  "sourceArtifactOmissions": [
    {
      "sourceArtifactId": "exact id copied from extractedSourceArtifacts",
      "disposition": "redundant_with_assigned_artifact|outside_learning_scope|non_instructional|unreliable_extraction",
      "artifactSummary": "specific description of what this artifact shows",
      "reason": "specific source-grounded pedagogical reason this artifact should not be taught in this garden",
      "alternativeArtifactId": "required exact assigned artifact id for redundant_with_assigned_artifact; otherwise null"
    }
  ],
  "warnings": ["..."]
}
${TITLE_RULES}
Contract rules:
- Generate learningUnits first and encode their section ownership in each unit's sectionPlan object. Do not return a separate nested section/subsection map.
- Author syllabusUnitIds from exact supplied syllabusCoverage unit IDs. With a syllabus, every learning unit must name at least one syllabus unit it serves; without one, return an empty array. Code never guesses this mapping from title overlap.
- Author sections in learner order according to semantic cohesion and syllabus depth, not a fixed total. A section normally owns 2-5 contiguous units. Create another section whenever that is needed to keep the teaching sequence coherent or to cover the syllabus fully; there is no maximum section count. If one unit must stand alone, repeat a precise singleSubsectionReason on that section's unit. Reuse the exact same section id, title, purpose, and singleSubsectionReason on every unit assigned to that section.
- Section titles and purposes are learner-facing semantic content. They must be specific to this garden; code will never synthesize or repair them.
- A unit is the smallest meaningful teaching step: one learner question, one conceptual move.
- Source-rich gardens normally need at least 15 units, and large syllabi may need substantially more. Never stop at an arbitrary unit or section total: create enough precise units to cover every teachable syllabus unit and all in-scope source material at the required depth. Do not produce a table-of-contents-style outline made mostly of one-subsection sections.
- role names the unit's teaching move, never the type of source artifact it owns. A verified formula may support any semantically appropriate role. Do not relabel a concept, mechanism, application, interpretation, synthesis, comparison, worked example, or practice unit as formula merely because that unit owns one or more equations. For a source-rich spine, use at least three appropriate roles, including at least one conceptual/mechanism role and at least one application/interpretation/synthesis/practice role.
- Partition every entry in extractedSourceArtifacts exactly once. Assign it to the one precise unit where it teaches best, or put its exact id in the garden-wide sourceArtifactOmissions array. Every omission must classify its disposition, specifically summarize what the artifact shows, explain why that content adds no safe in-scope teaching value, and name the different assigned replacement artifact when the disposition is redundant_with_assigned_artifact. Never forget an artifact, assign it twice, both assign and omit it, or invent a generic omission reason.
- extractedSourceArtifacts is the request's single canonical source-artifact catalog. sources.sourceArtifactCatalogRef and sourceMap.sourceArtifactCatalogRef point to that array instead of repeating it. Each artifact's optional sourceMapAnnotation preserves distinct model-authored Source Map semantics. Resolve every artifact only through its exact canonical id.
- sourceArtifactOmissions is required even when empty. Omissions are not learning-unit ownership: do not use sourceFigures.placement="not_used_with_reason" in the active contract.
- IDs in sourceFigures, sourceTables, and sourceFormulas may ONLY be copied verbatim from extractedSourceArtifacts. A figure-like ID mentioned in source prose is not a registered artifact and must never be used unless that exact ID is present in extractedSourceArtifacts.
- Every structured artifact ID (Sx.Py.Fn, Sx.Py.Gn, Sx.Py.Tn, or Sx.Py.En) used anywhere in a unit, including sourceAnchors and evidenceAnchors, must be present in extractedSourceArtifacts with the matching kind.
- Source figures must be planned for inline placement near their interpretation. Never plan a generic "Source Figures" dump.
- Partition every sourceMap.sourceQuestions record exactly once across learningUnits.sourceQuestions. Assign each question to the unit that teaches the concepts needed to solve it. The unit must also own every source anchor and related figure named by that question and must retain every syllabus unit attached to it.
- Do not assign an interactiveVisual or visualType in this response. A separate whole-garden AI review authors visual necessity, alternative-medium choice, and a typed learner-control contract after this learning spine passes validation.
- Describe each unit's learning question, dynamic behavior, comparisons, parameters, source figures, formulas, tables, and prerequisites precisely enough for that source-grounded model review. Code validates its evidence and behavior but never invents a pedagogical visual decision.
- Concepts are reusable identities, never complete claims, page-title summaries, filenames, locations, or planner phrases. Reuse an existing canonical slug or alias whenever possible.
- Every unit must explicitly contain semanticConcepts with one or two primary concepts. Code will never infer missing concepts or claims from titles, roles, or zettel notes.
- When a semanticConcept slug appears in multiple units, author exactly the same preferredLabel and exactly the same aliases array (the same values in the same order) for every occurrence. The concept registry rejects inconsistent repeated identities; code will never choose or merge a label or alias set for you.
- Every normalized alias must belong to exactly one concept. Never use another concept's slug or preferred label as an alias, and never assign the same alias to multiple concepts.
- Mark one or two genuinely central concepts primary. Use supporting concepts only when they materially help retrieval or graph traversal.
- Plan 1-5 public concepts per learner unit. Never add filler to satisfy a target count.
- Claims are readable source-grounded statements kept separately from public tags. Zero claims is valid when the material supports none.
- Never turn claim text into a concept slug and never create role-template claims. Claim endpoints must use concept slugs from semanticConcepts.
- First job: planning only. Do not generate final prose yet.`;

const INCREMENTAL_TOPIC_MAP_RULES = `Additive update rules (hard requirements):
- existingCurriculum.learningUnits is the already-published curriculum baseline. Return every supplied existing unit exactly, with the same id, fields, values, and relative order. Do not rewrite, condense, merge, split, retitle, delete, or reassign an existing unit.
- Express newly supplied material only through new learning-unit records with new ids. Insert each new unit at the pedagogically best position among the existing units; do not merely append all new material to the end unless that is genuinely the best teaching order.
- A new unit may reuse an existing sectionPlan verbatim when it belongs inside that section, or author a new sectionPlan when it needs a distinct section. Never edit an existing unit's sectionPlan to make room.
- existingCurriculum omits visual presentation fields deliberately. Do not add interactiveVisual, interactiveVisualPlan, or teachingMediumPlan in this response; the later whole-garden visual review owns those fields.
- Return a complete combined contract covering both the existing curriculum and the current source catalog. The existing lesson bodies will be reused by stable unit id; only genuinely new units will need new prose.`;

const SYLLABUS_READING_PROMPT = `You read a course syllabus / study guide and extract its structure. This is internal planning data; learners never see it.
Return ONLY JSON with this shape:
{
  "courseTitle": "the course's own title, if stated",
  "units": [
    {
      "id": "SU1",
      "label": "the syllabus's own numbering, e.g. 'Week 1', 'Module 2', 'Session 3'",
      "title": "what this unit teaches",
      "objectives": ["a learning objective or outcome exactly as the syllabus states it"],
      "topics": ["a topic this unit covers"],
      "questionReferences": ["an exact assigned problem/question/exercise identifier, such as 'Problem 6.21'"],
      "materialIds": ["ids of the referencedMaterials this unit assigns"]
    }
  ],
  "referencedMaterials": [
    {
      "id": "R1",
      "citation": "the reference exactly as the syllabus writes it",
      "title": "the work's title alone, without chapter/page numbers",
      "authors": ["surname or full name as written"],
      "kind": "textbook | chapter | paper | reading | lecture | slides | dataset | video | other",
      "locator": "the assigned part, e.g. 'ch. 3', 'pp. 40-58'",
      "required": true
    }
  ]
}
Extraction rules:
- Extract only what the syllabus actually says. Never invent a unit, objective, topic, author, or reading.
- Every book, chapter, paper, article, dataset, slide deck, or handout the syllabus points at belongs in referencedMaterials — required and optional alike, with "required" set accordingly.
- Put the work's own title in "title" and the assigned part in "locator". "Smith, Neural Dynamics, ch. 3" has title "Neural Dynamics" and locator "ch. 3".
- A reference with no identifiable work ("Readings TBD", "Lecture 4 slides") still belongs in the list; leave "title" empty.
- Link each unit to its readings through materialIds. A unit that assigns nothing gets an empty list.
- Copy every explicitly assigned problem, question, exercise, drill, or problem range into that unit's questionReferences. Keep the syllabus's exact wording (for example "Problems 6.21-6.24"). Do not mistake chapter/section reading ranges for question assignments. A unit that assigns no questions gets an empty list.
- If the document has no unit/week structure, return one unit covering the whole course.
- If the document is not a syllabus or study guide at all, return empty units and referencedMaterials.`;

const SYLLABUS_COVERAGE_PROMPT = `You decide which exact syllabus materials are present in the user's selected source documents and which syllabus units those sources can teach. This is a semantic evidence review. Code will only validate your JSON, exact IDs, copied citations, completeness, and internal consistency; code will never match titles, infer availability, or decide teachability for you.

Return ONLY JSON with this exact shape:
{
  "resolutions": [
    {
      "materialId": "exact referencedMaterials id",
      "citation": "exact citation copied byte-for-byte from referencedMaterials",
      "status": "available | missing | generic",
      "sourceIds": ["exact selected source id that satisfies this full citation"],
      "matchReason": "specific canonical raw page or unpaged source evidence for this verdict"
    }
  ],
  "units": [
    {
      "unitId": "exact syllabus unit id",
      "availableSourceIds": ["exact selected source id that can support this unit"],
      "missingCitations": ["exact citation of each assigned material you resolved missing"],
      "teachable": true,
      "coverageReason": "what the selected sources do or do not support for this unit"
    }
  ]
}

Hard rules:
- Return exactly one resolution for every referenced material and exactly one coverage record for every syllabus unit, in the supplied order. Never omit or add records.
- Judge each material from the supplied source catalog. \`selectedSourceCatalog.sourceRecords[].navigationMetadata\` (including title, description, excerpt, and planningIndex) is generated navigation context and can never prove a bibliographic title, author, chapter, page, or locator. Exact sourceId, sourceFile, and relPath are routing identity only. \`canonicalRawPageEvidence.pages\` and \`unpagedEvidence\` are the bounded verbatim source material: each page record carries its exact sourceId, pageNumber, and complete raw text in document order. Use only exact supplied source IDs.
- \`selectedSourceCatalog.authoredLocators\` copies the syllabus's locator strings verbatim. It never selects a source page or establishes that a source satisfies one. The catalog may omit complete raw pages only because of its explicit transport bounds. An omittedPageCount or truncated flag is transport metadata, never proof that a citation is present. When the supplied canonical raw evidence does not visibly establish the full citation's title/authors and locator, author \`missing\`; never infer it from navigation metadata, a filename, subject overlap, or a locator string alone.
- "available" requires direct evidence that an uploaded source satisfies the FULL citation. Match title/authors AND any locator such as chapter, section, or page range. A matching book title alone never proves that an assigned chapter or page range is present. Put one or more satisfying source IDs in sourceIds.
- "missing" means the citation identifies a work or assigned part but the supplied evidence does not establish that it is present. Use an empty sourceIds array. Do not guess from subject overlap.
- "generic" is only for a reference that identifies no checkable work, such as "Readings TBD". Use an empty sourceIds array.
- Preserve each citation exactly as supplied. In each unit, missingCitations must contain exactly its assigned materials resolved "missing", in syllabus material order. Distinct assigned material IDs can copy the same exact citation: retain one occurrence for every such missing material ID and never de-duplicate it. Generic references are not missing citations.
- For each unit, independently author whether the selected sources genuinely support its objectives and topics in full. teachable is the sole authorization for the planner to generate lessons. If true, select every source the planner should ground it in.
- Treat questionReferences as part of the unit's required coverage: check whether the selected source actually contains those assigned questions and their required figures. Describe missing or partial question evidence in coverageReason rather than pretending the assignment is present.
- An unteachable unit may still have partial or direct source support. When an assigned material is available, list at least one exact selected source for that material in availableSourceIds, keep teachable false if the evidence cannot support the unit in full, and explain that limitation in coverageReason. Use an empty availableSourceIds array only when no selected source directly supports an assigned available material. Never flip teachable merely to satisfy an array condition.
- A missing REQUIRED material is strong evidence against teachability, but another uploaded source may support the unit if its supplied content directly covers the objectives and topics; explain that evidence. A missing OPTIONAL material does not by itself make the unit unteachable. Required/optional is semantic input for your verdict, never a code rule.
- If an assigned material is available, the unit's availableSourceIds must include at least one source selected for that material.
- Never claim that a source contains a chapter, fact, process, example, or result that is not visible in the supplied evidence.`;

/**
 * Extra planning rules that apply only when the user designated a syllabus.
 * A syllabus is the course's own statement of what must be learned, so it
 * outranks the planner's judgment about scope, ordering, and emphasis — but it
 * can never invent material the sources do not support.
 */
const SYLLABUS_PLANNING_RULES = `
Syllabus (hard requirements):
- A syllabus (study guide / course outline) was provided as \`syllabus\`, already read into \`syllabusCoverage\`. It states what this course must teach, in what order, and to what depth.
- The syllabus is NOT source material and is NOT a topic. Never write a page about the syllabus, never cite it as a source, never treat its headings as content to summarize, and never mention it in learner-facing text.
- Treat \`syllabusCoverage.units\` as the required plan: work through them in order, cover each teachable unit's objectives and topics, and match the depth each is given. Every teachable syllabus unit ID must appear in at least one learning unit's syllabusUnitIds. An item the syllabus treats as central earns a full learning unit; background or optional items earn proportionally less. Never compress unrelated syllabus units together merely to hit a smaller unit or section count.
- Source material that no syllabus unit covers is out of scope. Exclude it rather than adding units for it.

Material availability (hard requirements — this is what stops fabrication):
- A separate source-grounded model has already reviewed every work the syllabus assigns against the exact selected-source catalog. Its authored coverage decision is authoritative for this run. Do not second-guess it.
- \`unit.availableSourceIds\` lists documents with direct support for at least part of that unit. For a unit whose \`teachable\` verdict is true, ground it heavily and specifically in those documents: its definitions, figures, formulas, numbers, and examples come from there first, and only then from the rest of the garden.
- \`unit.teachable\` is the sole authorization to create learning units. If it is false, do not plan or generate a learning unit for that syllabus item even when \`availableSourceIds\` records partial support. Partial support never overrides an unteachable verdict.
- \`unit.missingCitations\` lists works the syllabus assigns that NOBODY UPLOADED. You have never seen their contents. Never plan a unit, anchor, figure, formula, result, or claim that depends on them. Never summarize, paraphrase, characterize, or state what such a work says, argues, shows, or concludes. Never name one in learner-facing text.
- Cover a syllabus topic whose material is missing ONLY from the source material that IS present, and only as far as that material genuinely supports. If it does not support the topic, leave the topic uncovered and record it in warnings.
- \`syllabusCoverage.untaughtUnitTitles\` lists units the coverage review judged unteachable from the selected sources, including units with only partial support. Do not create learning units for them. Record each one in warnings as an uncoverable syllabus item.
- Every warning about missing material must name the syllabus item, never invent a substitute for it.`;

/** Page-writing rules that apply only when a syllabus is in play. */
const SYLLABUS_PAGE_RULES = `
Syllabus:
- \`dossier.syllabus\` is the course study guide. Use it only to judge what this page must cover and how deep to go.
- Never mention, quote, cite, or describe the syllabus in the lesson. The learner reads a lesson on the subject, not a walkthrough of their course outline.
- \`dossier.syllabusUnits[].objectives\` are what the learner must be able to do after this page. Teach to them.
- \`dossier.syllabusUnits[].questionReferences\` are explicit course assignments. The page dossier's requiredSourceQuestions resolves the ones present in the selected sources; include those questions on the mapped page and never invent the text of an unresolved assignment.
- \`dossier.unavailableCitations\` lists works the course assigns that are NOT in this garden. You have never read them. Never name, quote, summarize, paraphrase, or state the findings of anything on that list, and never imply the page is based on one. Teach only from the source material provided in this dossier.`;

/** Append syllabus rules to a base prompt only when a syllabus is present, so
 * runs without one keep their existing prompts byte-for-byte. */
function withSyllabusRules(basePrompt: string, rules: string, hasSyllabus: boolean): string {
  return hasSyllabus ? `${basePrompt}\n${rules}` : basePrompt;
}

const LEARN_USER_INSTRUCTION_RULES = `
User guidance:
- \`userInstruction\` is a direct request from the learner about this run. Treat it as a real requirement for scope, emphasis, ordering, inclusion, exclusion, or revision.
- Resolve natural references such as "after X", "from X onward", "only these topics", and "keep everything before X" against the authored course order and topic names.
- When the learner asks to redo only part of an existing course, preserve the meaning and ordering of material outside that target and change the requested range only.
- The request never overrides source grounding, unavailable-material gates, syllabus teachability, output schemas, or safety constraints. State an honest warning when the selected sources cannot support it.
- Never quote or discuss the instruction in learner-facing prose; carry it out.`;

function normalizeLearnUserInstruction(value: string | undefined): string | undefined {
  const instruction = value?.trim();
  if (!instruction) return undefined;
  if (instruction.length > 4_000) {
    throw new Error("Learn guidance must be 4,000 characters or fewer.");
  }
  return instruction;
}

function withLearnUserInstructionRules(
  basePrompt: string,
  userInstruction: string | undefined,
): string {
  return userInstruction
    ? `${basePrompt}\n${LEARN_USER_INSTRUCTION_RULES}`
    : basePrompt;
}

const OVERVIEW_PROMPT = `Write the Topic Overview page: the first page a learner reads in this Breadboard learning garden.
Return Markdown body only, no frontmatter.
${LEARNER_VOICE_RULES}
Include what the topic is about, how to learn it, the recommended reading order with wikilink-style labels for sections/subsections, and honest scope notes (what this garden does and does not cover) phrased around the topic, not around the uploaded files.
Do not create disconnected notes and do not include raw visual placeholders.`;

// Concrete style rules reused by the writing and revision prompts.
const DEPTH_RULES = `Teach from first principles so a motivated beginner with minimal background understands the concept:
1. Open with the simplest concrete situation that makes the concept necessary. A short scenario ("Imagine a sensor watching a mostly still scene…") beats an abstract statement.
2. Explain why the concept is needed — what breaks or is wasteful without it.
3. Build the mechanism one step at a time. Each sentence should add one idea the previous sentence set up.
4. Introduce a term only at the moment the learner needs it, and explain it in plain words the first time.
5. Introduce a formula only after motivating it, then define every symbol and say what the formula lets you compute.
6. Put at least one concrete example, analogy, or worked interpretation right after the idea it illustrates.
7. Weave assigned source figures/tables into the flow and INTERPRET them (what the shape/trend/number means), never just caption them.
8. Mention a common beginner confusion only when it genuinely helps, and resolve it by explaining the correct picture.
9. End by connecting the chain of ideas into a mental model — not a bullet summary and not a list of formulas.
Write at least ~700 words of real explanatory prose. Aim for genuine understanding, not coverage.`;

const ANTI_AIISM_RULES = `Banned writing patterns — do NOT use these:
- "The first/second/next/big idea is…", "X is not a side detail", "X is not just Y", "The point is not…", "This is not only X but also Y", "It is important to note that…", "This matters because…", "This highlights/underscores…", "The key takeaway is…", "In summary…".
Do not teach through contrastive negation (telling the learner what something is NOT). Explain directly what it IS, why it exists, how it works, and how to think about it.
Weak: "A second limitation appears in how information is represented. Continuous activations carry information through changing numerical values."
Strong: "Imagine a sensor watching a mostly still scene. A dense network keeps re-processing whole arrays of values even when nothing changes. A spiking system assumes silence is meaningful: when something changes, it sends a single event — a spike — at a particular time, and that timing is part of the message."`;

const PLACEHOLDER_FREE_PROSE_RULES = `Final-prose rules (hard requirements):
- Every line must be finished learner-facing prose, not a note about what someone should write later.
- Never include scaffold commands such as insert, add the example here, write the details here, fill in, expand this later, TODO, placeholder, or lorem ipsum. Never leave a marker saying that content is unfinished or reserved for a future writer.
- Never leave empty bullets, ellipsis-only bullets, bracketed instructions, or notes to yourself.
- If a source detail is thin or missing, write the supported explanation plainly instead of describing what should be added later.`;

const SUBSECTION_PROMPT = `Write one flowing lesson subsection for a Breadboard learning garden.
Return Markdown body only, no frontmatter, no code fence around the whole page.
${LEARNER_VOICE_RULES}
${DEPTH_RULES}
${ANTI_AIISM_RULES}
${PLACEHOLDER_FREE_PROSE_RULES}
Mechanics:
- One flowing lesson, not disconnected mini-sections; avoid over-segmentation and excessive headings.
- Treat dossier.learningUnit as the contract for this page: answer its learningQuestion, introduce its newConcepts, respect mustNotRepeat, use only its planned source artifacts, and use its zettelNotes as conceptual anchors.
- dossier.requiredSourceQuestions contains source-authored practice assigned to this page. Include EVERY entry using a **Question.** block whose prompt is copied verbatim, followed by an **Answer.** block that teaches a worked or guided solution matching its teachingGoal. When it has relatedFigureIds, keep the matching assigned source visual directly beside that question and use it in the solution. If no source questions are assigned, write the usual 1-2 learner questions yourself.
- The first paragraph must connect to prior ideas unless this is the first unit; later pages must not restart the whole motivation.
- If assignedSourceVisuals are provided, embed EACH one inline exactly where it supports the prose using its provided markdown snippet, with an interpretation of what the figure shows directly beside it. Never dump images at the end and never repeat a caption without interpreting it.
- dossier.requiredSourceFormulas is an exact-copy checklist. For every entry, reproduce its exactText verbatim in its own visible $$...$$ displayed equation; preserve every command, sign, bound, term, and aligned-row separator. Do not substitute an equivalent formula, combine equations, or invent different notation. Then teach the model-authored teachingGoal and define every listed term.
- The user message begins with a VERBATIM SOURCE FORMULA COPY SHEET when formulas are required. Those are literal Markdown display blocks, not JSON-escaped examples: copy every complete block character-for-character into the final lesson. Use that sheet rather than trying to reconstruct LaTex from escaped JSON.
- Never create a generic "## Source Figures" section. Every source figure/table/formula belongs inside the explanation where the contract placed it.
- Do NOT write any \`\`\`breadboard-visual code block yourself — interactive visuals are attached by the pipeline afterwards.
- Never leave [Interactive visual: ...] or any bracketed placeholder, and never write instructions to yourself (e.g. "use the page 10 materials").
- Include 1-2 real questions a learner would ask (or every assigned source question), using exactly:
  **Question.** ...
  **Answer.** ...
- Do not generate arbitrary executable JavaScript.`;

const SUBSECTION_REPAIR_PROMPT = `Repair one lesson page that failed specific hard quality checks. This is a focused repair, not a rewrite.
Return Markdown body only, no frontmatter.
${LEARNER_VOICE_RULES}
${ANTI_AIISM_RULES}
${PLACEHOLDER_FREE_PROSE_RULES}
Task:
- Fix ONLY the listed hard failures (failedProblems). Leave everything that already works untouched.
- Preserve correct existing content: explanations, examples, formulas, structure, and the Question./Answer. section.
- Do not restart from scratch unless the page is genuinely unusable.
- When a failedProblems entry includes \`offending text\`, treat that quote as diagnostic material from the rejected draft, not prose to preserve, discuss, or quote. Replace the whole sentence or bullet containing it with a finished learner explanation, then silently scan the completed Markdown before returning it.
- If a failure says the page is too short, lacks a concrete example, or lacks a **Question.** / **Answer.** pair, add the missing depth in the same flowing, beginner-friendly voice: motivate before mechanism, define terms as they appear, put a concrete example right after the idea it illustrates, and keep at least ~700 words of real explanatory prose.
- If failedProblems includes placeholder or empty-bullet-scaffold, replace the offending scaffold with finished explanatory sentences. Do not merely delete it unless the surrounding paragraph remains coherent and complete.
- If failedProblems includes missing-source-formula, copy each matching exactText from dossier.requiredSourceFormulas into its own visible $$...$$ displayed equation verbatim. Preserve every command, sign, bound, term, and aligned-row separator; do not substitute, shorten, combine, or restyle the equation. The literal replacement block overrides any instruction to preserve the old malformed formula: replace it rather than retaining or duplicating an equivalent variant.
- If failedProblems includes missing-source-question, copy the matching prompt from dossier.requiredSourceQuestions verbatim into a **Question.** block and add its **Answer.** directly after it. Keep every related source figure beside the question.
- The user message begins with a VERBATIM SOURCE FORMULA COPY SHEET when formulas are required. Those blocks are literal Markdown, not JSON-escaped examples. Copy every required block character-for-character into the repaired lesson.
- Rewrite any sentence that comments on "the paper", "the source", "source-derived", or similar document framing so it teaches the concept directly.
- Keep every embedded image markdown where it is and keep any \`\`\`breadboard-visual block byte-for-byte unchanged.
- Remove placeholder or self-instruction text.
- If source-only mode is true, do not add unsupported facts.
- Return only the final Markdown.`;

function ensureLearnTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learn_jobs (
      id                         TEXT PRIMARY KEY,
      garden_id                  TEXT NOT NULL,
      user_id                    INTEGER,
      model                      TEXT NOT NULL DEFAULT 'gpt-5.6-sol',
      status                     TEXT NOT NULL,
      mode                       TEXT NOT NULL,
      current_step               TEXT,
      progress_percent           INTEGER NOT NULL DEFAULT 0,
      current_section_title      TEXT,
      current_page_title         TEXT,
      error                      TEXT,
      requires_replan            INTEGER NOT NULL DEFAULT 0,
      proposed_learning_map_id   TEXT,
      confirmed_learning_map_id  TEXT,
      latest_textbook_version_id TEXT,
      source_set_hash            TEXT,
      source_ids_json            TEXT NOT NULL DEFAULT '[]',
      syllabus_source_id         TEXT,
      user_instruction           TEXT,
      source_only                INTEGER NOT NULL DEFAULT 1,
      include_source_snapshots   INTEGER NOT NULL DEFAULT 0,
      paused_from_status         TEXT,
      active_elapsed_ms          INTEGER NOT NULL DEFAULT 0,
      timer_started_at           TEXT,
      created_at                 TEXT NOT NULL,
      updated_at                 TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_jobs_garden_updated
      ON learn_jobs(garden_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS learn_job_token_usage (
      job_id                TEXT PRIMARY KEY REFERENCES learn_jobs(id) ON DELETE CASCADE,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      total_tokens          INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens   INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
      started_requests      INTEGER NOT NULL DEFAULT 0,
      completed_requests    INTEGER NOT NULL DEFAULT 0,
      reported_requests     INTEGER NOT NULL DEFAULT 0,
      estimated_requests    INTEGER NOT NULL DEFAULT 0,
      request_model         TEXT,
      reasoning_effort      TEXT,
      reasoning_summary     TEXT,
      policy_observed_requests INTEGER NOT NULL DEFAULT 0,
      policy_mismatch_requests INTEGER NOT NULL DEFAULT 0,
      usage_updated_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS learn_maps (
      id                        TEXT PRIMARY KEY,
      garden_id                 TEXT NOT NULL,
      job_id                    TEXT NOT NULL,
      status                    TEXT NOT NULL,
      source_map_json           TEXT NOT NULL,
      scope_contract_json       TEXT NOT NULL,
      learning_map_json         TEXT NOT NULL,
      proposed_order_json       TEXT NOT NULL,
      visual_opportunities_json TEXT NOT NULL,
      coverage_plan_json        TEXT NOT NULL,
      source_set_hash           TEXT NOT NULL,
      source_artifact_inventory_hash TEXT NOT NULL,
      source_ids_json           TEXT NOT NULL DEFAULT '[]',
      syllabus_source_id        TEXT,
      syllabus_coverage_json    TEXT,
      visual_necessity_review_json TEXT,
      visualization_plan_json   TEXT,
      visual_contract_executability_ledger_json TEXT,
      visual_route_binding_json TEXT,
      created_at                TEXT NOT NULL,
      confirmed_at              TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_learn_maps_garden_created
      ON learn_maps(garden_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS learn_versions (
      id                  TEXT PRIMARY KEY,
      garden_id           TEXT NOT NULL,
      job_id              TEXT NOT NULL,
      learning_map_id     TEXT NOT NULL,
      source_set_hash     TEXT NOT NULL,
      source_artifact_inventory_hash TEXT NOT NULL,
      page_count          INTEGER NOT NULL DEFAULT 0,
      backup_dir          TEXT,
      created_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_versions_garden_created
      ON learn_versions(garden_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS learn_clear_operations (
      id                  TEXT PRIMARY KEY,
      garden_id           TEXT NOT NULL,
      phase               TEXT NOT NULL,
      previous_garden_dir TEXT,
      pre_clear_fingerprint TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_clear_operations_updated
      ON learn_clear_operations(updated_at ASC);

    CREATE TABLE IF NOT EXISTS learn_publication_retries (
      garden_id   TEXT PRIMARY KEY,
      reason      TEXT NOT NULL,
      last_error  TEXT,
      requested_at TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `);

  ensureLearnTokenUsagePersistenceSchema(db);
  ensureLearnPlanningCheckpointSchema(db);
  ensureLearnCouncilCheckpointSchema(db);

  const duplicateClearJournal = db
    .prepare(
      `SELECT garden_id, COUNT(*) AS operation_count
       FROM learn_clear_operations
       GROUP BY garden_id HAVING COUNT(*) > 1 LIMIT 1`,
    )
    .get() as { garden_id: string; operation_count: number } | undefined;
  if (duplicateClearJournal) {
    throw new Error(
      `Garden ${duplicateClearJournal.garden_id} has ${duplicateClearJournal.operation_count} unresolved Learn Clear journals; refusing to guess recovery order.`,
    );
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_learn_clear_operations_garden
     ON learn_clear_operations(garden_id)`,
  );

  const learnJobColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_jobs)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnJobColumns.has("active_elapsed_ms")) {
    db.exec(
      "ALTER TABLE learn_jobs ADD COLUMN active_elapsed_ms INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!learnJobColumns.has("timer_started_at")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN timer_started_at TEXT");
  }
  if (!learnJobColumns.has("source_ids_json")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN source_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!learnJobColumns.has("syllabus_source_id")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN syllabus_source_id TEXT");
  }
  if (!learnJobColumns.has("user_instruction")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN user_instruction TEXT");
  }
  if (!learnJobColumns.has("model")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-5.6-sol'");
  }
  if (!learnJobColumns.has("paused_from_status")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN paused_from_status TEXT");
  }
  if (!learnJobColumns.has("requires_replan")) {
    db.exec("ALTER TABLE learn_jobs ADD COLUMN requires_replan INTEGER NOT NULL DEFAULT 0");
  }

  const learnMapColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_maps)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnMapColumns.has("source_ids_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN source_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!learnMapColumns.has("syllabus_source_id")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN syllabus_source_id TEXT");
  }
  if (!learnMapColumns.has("syllabus_coverage_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN syllabus_coverage_json TEXT");
  }
  if (!learnMapColumns.has("source_artifact_inventory_hash")) {
    db.exec(
      "ALTER TABLE learn_maps ADD COLUMN source_artifact_inventory_hash TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!learnMapColumns.has("visual_necessity_review_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN visual_necessity_review_json TEXT");
  }
  if (!learnMapColumns.has("visualization_plan_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN visualization_plan_json TEXT");
  }
  if (!learnMapColumns.has("visual_contract_executability_ledger_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN visual_contract_executability_ledger_json TEXT");
  }
  if (!learnMapColumns.has("visual_route_binding_json")) {
    db.exec("ALTER TABLE learn_maps ADD COLUMN visual_route_binding_json TEXT");
  }

  const learnVersionColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_versions)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnVersionColumns.has("source_artifact_inventory_hash")) {
    db.exec(
      "ALTER TABLE learn_versions ADD COLUMN source_artifact_inventory_hash TEXT NOT NULL DEFAULT ''",
    );
  }

  const learnClearOperationColumns = new Set(
    (db.prepare("PRAGMA table_info(learn_clear_operations)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!learnClearOperationColumns.has("pre_clear_fingerprint")) {
    db.exec("ALTER TABLE learn_clear_operations ADD COLUMN pre_clear_fingerprint TEXT");
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function pendingLearnClearOperation(gardenId: string): { id: string; phase: string } | null {
  ensureLearnTables();
  return (db
    .prepare(
      `SELECT id, phase FROM learn_clear_operations
       WHERE garden_id = ? ORDER BY created_at ASC LIMIT 1`,
    )
    .get(gardenId) as { id: string; phase: string } | undefined) ?? null;
}

function assertNoPendingLearnClear(gardenId: string): void {
  const pending = pendingLearnClearOperation(gardenId);
  if (pending) {
    throw new LearnPipelineConflictError(
      `Interrupted Learn Clear ${pending.id} (${pending.phase}) must recover before this garden can be changed.`,
    );
  }
}

function queueLearnPublicationRetry(
  gardenId: string,
  reason: string,
  error: unknown,
): string {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO learn_publication_retries (
       garden_id, reason, last_error, requested_at, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(garden_id) DO UPDATE SET
       reason = excluded.reason,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(gardenId, reason, errorMessage(error), timestamp, timestamp);
  return timestamp;
}

function clearLearnPublicationRetry(gardenId: string, updateToken: string): void {
  db.prepare(
    `DELETE FROM learn_publication_retries
     WHERE garden_id = ? AND updated_at = ?`,
  ).run(gardenId, updateToken);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSourceIds(value: string | null | undefined): string[] {
  const parsed = value ? parseJson(value) : null;
  if (!Array.isArray(parsed)) return [];
  return Array.from(
    new Set(
      parsed
        .filter((sourceId): sourceId is string => typeof sourceId === "string")
        .map((sourceId) => sourceId.trim())
        .filter(Boolean),
    ),
  );
}

function learnTokenUsageForJob(jobId: string): LearnTokenUsage {
  return persistedLearnTokenUsageForJob(db, jobId);
}

function recordLearnTokenUsageEvent(jobId: string, event: LearnTokenUsageEvent): void {
  recordPersistedLearnTokenUsageEvent(db, jobId, event, nowIso());
}

function userFacingLearnText(value: string): string {
  const text = value
    .replace(/\bChatMock\b/gi, "the AI service")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function rowToJob(row: LearnJobRow | undefined): LearnJob | null {
  if (!row) return null;
  return {
    id: row.id,
    gardenId: row.garden_id,
    userId: row.user_id ?? undefined,
    model: row.model?.trim() || LEARN_MODEL,
    status: row.status,
    mode: normalizeLearnOperationMode(row.mode),
    currentStep: userFacingLearnText(row.current_step ?? ""),
    progressPercent: Number(row.progress_percent ?? 0),
    currentSectionTitle: row.current_section_title ?? undefined,
    currentPageTitle: row.current_page_title ?? undefined,
    error: row.error ? userFacingLearnText(row.error) : undefined,
    requiresReplan: Boolean(row.requires_replan ?? 0),
    proposedLearningMapId: row.proposed_learning_map_id ?? undefined,
    confirmedLearningMapId: row.confirmed_learning_map_id ?? undefined,
    latestTextbookVersionId: row.latest_textbook_version_id ?? undefined,
    sourceSetHash: row.source_set_hash ?? undefined,
    sourceIds: parseSourceIds(row.source_ids_json),
    syllabusSourceId: row.syllabus_source_id ?? undefined,
    userInstruction: row.user_instruction?.trim() || undefined,
    sourceOnly: Boolean(row.source_only ?? 1),
    includeSourceSnapshots: Boolean(row.include_source_snapshots ?? 0),
    pausedFromStatus: row.paused_from_status ?? undefined,
    tokenUsage: learnTokenUsageForJob(row.id),
    elapsedMs: Math.max(0, Number(row.active_elapsed_ms ?? 0)),
    timerStartedAt: row.timer_started_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMap(row: LearnMapRow | undefined): StoredLearningMap | null {
  if (!row) return null;
  // The learning map is model-authored or it does not exist. A row whose stored
  // map is missing or unparseable is not a usable plan: reading it back as a
  // synthesized map would hand the garden a curriculum the model never wrote.
  const learningMap = parseJson(row.learning_map_json) as ProposedLearningMap | null;
  const coveragePlan = parseJson(row.coverage_plan_json);
  if (!learningMap || !Array.isArray(learningMap.sections) || learningMap.sections.length === 0) {
    return null;
  }
  return {
    id: row.id,
    gardenId: row.garden_id,
    jobId: row.job_id,
    status: row.status,
    sourceMap: parseJson(row.source_map_json),
    scopeContract: parseJson(row.scope_contract_json),
    learningMap,
    proposedOrder:
      (parseJson(row.proposed_order_json) as LearningSectionPlan[] | null) ?? [],
    visualOpportunities:
      (parseJson(row.visual_opportunities_json) as unknown[] | null) ?? [],
    coveragePlan,
    sourceSetHash: row.source_set_hash,
    sourceArtifactInventoryHash: row.source_artifact_inventory_hash ?? "",
    sourceIds: parseSourceIds(row.source_ids_json),
    syllabusSourceId: row.syllabus_source_id ?? undefined,
    syllabusCoverage:
      (parseJson(row.syllabus_coverage_json ?? "") as SyllabusCoverage | null) ?? null,
    visualNecessityReview:
      (parseJson(row.visual_necessity_review_json ?? "") as GardenVisualNecessityPlan | null) ??
      undefined,
    visualizationPlan:
      (parseJson(row.visualization_plan_json ?? "") as VisualizationPlan | null) ?? undefined,
    visualContractExecutabilityLedger:
      (parseJson(row.visual_contract_executability_ledger_json ?? "") as VisualContractExecutabilityLedger | null) ??
      undefined,
    visualRouteBinding:
      (parseJson(row.visual_route_binding_json ?? "") as ConfirmedVisualRouteBinding | null) ??
      undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

function createLearnJob({
  id,
  gardenId,
  userId,
  model,
  mode,
  sourceIds,
  syllabusSourceId,
  userInstruction,
  sourceOnly,
  includeSourceSnapshots,
}: {
  id?: string;
  gardenId: string;
  userId?: number;
  model: string;
  mode: LearnMode;
  sourceIds: string[];
  syllabusSourceId?: string;
  userInstruction?: string;
  sourceOnly: boolean;
  includeSourceSnapshots: boolean;
}): LearnJob {
  ensureLearnTables();
  const date = nowIso();
  const job: LearnJob = {
    id: id ?? makeId("learn_job"),
    gardenId,
    userId,
    model,
    status: "idle",
    mode,
    currentStep: "",
    progressPercent: 0,
    requiresReplan: false,
    sourceIds: [...sourceIds],
    syllabusSourceId,
    userInstruction: userInstruction?.trim() || undefined,
    sourceOnly,
    includeSourceSnapshots,
    tokenUsage: emptyLearnTokenUsage(),
    elapsedMs: 0,
    timerStartedAt: date,
    createdAt: date,
    updatedAt: date,
  };
  db.prepare(
    `INSERT INTO learn_jobs (
      id, garden_id, user_id, model, status, mode, current_step, progress_percent, requires_replan,
      source_ids_json, syllabus_source_id, user_instruction, source_only, include_source_snapshots,
      active_elapsed_ms, timer_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.gardenId,
    job.userId ?? null,
    job.model,
    job.status,
    job.mode,
    job.currentStep,
    job.progressPercent,
    job.requiresReplan ? 1 : 0,
    jsonString(job.sourceIds),
    job.syllabusSourceId ?? null,
    job.userInstruction ?? null,
    job.sourceOnly ? 1 : 0,
    job.includeSourceSnapshots ? 1 : 0,
    job.elapsedMs,
    job.timerStartedAt ?? null,
    job.createdAt,
    job.updatedAt,
  );
  db.prepare(
    `INSERT OR IGNORE INTO learn_job_token_usage (job_id, usage_updated_at)
     VALUES (?, ?)`,
  ).run(job.id, job.createdAt);
  return job;
}

/** Thrown when the user pressed Stop: the run aborts at the next checkpoint
 * and the job stays "cancelled" instead of being marked failed. */
export class LearnCancelledError extends Error {
  constructor() {
    super("Learn run stopped by the user.");
    this.name = "LearnCancelledError";
  }
}

const activeLearnAbortControllers = new Map<string, AbortController>();
const activeLearnCouncilDispatchAuthorities = new Map<string, () => boolean>();
const leaseLostLearnJobs = new Set<string>();
const LEARN_FAILURE_OWNERSHIP_RETRY_DELAYS_MS = [10, 25, 50, 100] as const;
const learnFailureOwnershipWait = new Int32Array(new SharedArrayBuffer(4));

/** Failure cleanup may mutate both SQLite and the garden, so it still requires
 * a freshly renewed exact lease. A mutation-guard collision or transient read
 * is uncertainty, though, not proof that another worker owns the garden. Give
 * those short-lived states a bounded chance to clear; only an exact renewed
 * token authorizes cleanup and a proven token mismatch fences it immediately. */
function confirmLearnLeaseForFailureCleanup(
  lease: GardenLearnLease,
  jobId: string,
): boolean {
  for (let attempt = 0; ; attempt += 1) {
    if (lease.lost || leaseLostLearnJobs.has(jobId)) return false;
    let ownership: ReturnType<GardenLearnLease["confirmOwnership"]>;
    try {
      ownership = lease.confirmOwnership();
    } catch {
      ownership = "uncertain";
    }
    if (ownership === "owned") return true;
    if (ownership === "lost") return false;
    const delay = LEARN_FAILURE_OWNERSHIP_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return false;
    Atomics.wait(learnFailureOwnershipWait, 0, 0, delay);
  }
}

/** Council receipt resolution and the final pre-POST gate need the same
 * fail-closed ownership proof as rollback cleanup. A mutation-guard collision
 * is transient uncertainty, not evidence that the lease was lost; retry the
 * exact fenced token briefly and authorize only a confirmed `owned` result. */
function confirmLearnLeaseForCouncilDispatch(
  lease: GardenLearnLease,
  jobId: string,
): boolean {
  return confirmLearnLeaseForFailureCleanup(lease, jobId);
}
const LEARN_JOB_HEARTBEAT_INTERVAL_MS = 15_000;
const LEARN_CANCELLATION_REQUESTED_STEP =
  "Cancellation requested; waiting for the Learn worker to stop";
const LEARN_PAUSE_REQUESTED_STEP =
  "Pause requested; finishing the step already in flight";
const LEARN_PAUSED_STEP = "Paused; press Resume to continue this run";
const LEARN_PAUSE_POLL_INTERVAL_MS = 500;
/**
 * A paused run is suspended, not saved: the worker keeps its in-memory run
 * state, its fenced garden lease, and its HTTP task alive so Resume can carry
 * straight on. None of that can be held indefinitely, so a pause that is never
 * resumed ends the same way Cancel would.
 */
const LEARN_MAX_PAUSE_MS = 60 * 60_000;
/**
 * Statuses whose phase reaches an awaitable checkpoint often enough for Pause
 * to land promptly. Scoped repair runs as one atomic transaction whose progress
 * callback is synchronous, and publication is the non-interruptible commit
 * section, so neither is offered a pause.
 */
const LEARN_PAUSABLE_STATUSES: readonly LearnStatus[] = [
  "planning",
  "generating_learning_pages",
  "generating_textbook",
  "generating_visuals",
  "building_navigation",
];
/** Publication is a short, non-cancellable commit section. Cancelling after the
 * atomic swap but before the DB/version commit could otherwise strand a valid
 * tree behind a cancelled job. */
const committingLearnJobs = new Set<string>();

function abortLearnWorkerAfterLeaseLoss(jobId: string): void {
  leaseLostLearnJobs.add(jobId);
  const controller = activeLearnAbortControllers.get(jobId);
  if (!controller?.signal.aborted) {
    controller?.abort(
      new LearnPipelineConflictError(
        "This Learn worker lost its fenced garden lease to another process.",
      ),
    );
  }
}

function jobStatusById(jobId: string): LearnStatus | null {
  const row = db
    .prepare("SELECT status FROM learn_jobs WHERE id = ?")
    .get(jobId) as { status?: LearnStatus } | undefined;
  return row?.status ?? null;
}

/** Cooperative cancellation checkpoint. The Stop button flips the job row to
 * "cancelled"; long-running pipelines call this between model calls / pages so
 * the run actually halts instead of finishing in the background. */
function throwIfLearnCancelled(jobId: string): void {
  if (leaseLostLearnJobs.has(jobId)) {
    throw new LearnPipelineConflictError(
      "This Learn worker lost its fenced garden lease to another process.",
    );
  }
  const status = jobStatusById(jobId);
  if (status === "cancelled") throw new LearnCancelledError();
  if (status === "failed") {
    throw new LearnPipelineConflictError(
      "This Learn worker lost ownership after recovery marked its job failed.",
    );
  }
}

/**
 * Cooperative pause. Unlike Cancel, this unwinds nothing: the worker parks here
 * with every local variable of the run intact until the row leaves "paused".
 * Cancel still wins while parked, and an unresumed pause eventually cancels.
 */
async function awaitLearnPauseGate(jobId: string): Promise<void> {
  if (jobStatusById(jobId) !== "paused") return;
  const pausedAtMs = Date.now();
  let announcedPause = false;
  for (;;) {
    throwIfLearnCancelled(jobId);
    if (jobStatusById(jobId) !== "paused") return;
    if (!announcedPause) {
      announcedPause = true;
      // The request only asked for a pause; this is the worker confirming it
      // actually reached a checkpoint and stopped.
      updateLearnJob(jobId, { currentStep: LEARN_PAUSED_STEP });
    }
    if (Date.now() - pausedAtMs >= LEARN_MAX_PAUSE_MS) {
      updateLearnJob(jobId, {
        status: "cancelled",
        currentStep: LEARN_CANCELLATION_REQUESTED_STEP,
        progressPercent: 0,
      });
      throw new LearnCancelledError();
    }
    await new Promise((resolve) => setTimeout(resolve, LEARN_PAUSE_POLL_INTERVAL_MS));
  }
}

/** Cancel and Pause are observed at the same boundaries: Cancel throws out of
 * the run, Pause holds it here. */
async function learnCheckpoint(jobId: string): Promise<void> {
  throwIfLearnCancelled(jobId);
  await awaitLearnPauseGate(jobId);
}

function isLearnCancellation(jobId: string, error: unknown): boolean {
  return error instanceof LearnCancelledError || jobStatusById(jobId) === "cancelled";
}

function exactPlanningDispatchAuthority(
  jobId: string,
  gardenId: string,
): boolean {
  const row = db.prepare(
    "SELECT id, garden_id, status FROM learn_jobs WHERE id = ?",
  ).get(jobId) as { id: string; garden_id: string; status: string } | undefined;
  const ownsLease = activeLearnCouncilDispatchAuthorities.get(jobId);
  return hasExactPlanningDispatchAuthority({
    job: row
      ? { id: row.id, gardenId: row.garden_id, status: row.status }
      : null,
    expectedJobId: jobId,
    expectedGardenId: gardenId,
    ownsLease: ownsLease ?? (() => false),
  });
}

function exactOrdinaryCouncilDispatchAuthority(
  jobId: string,
  gardenId: string,
): boolean {
  const row = db.prepare(
    "SELECT id, garden_id, status FROM learn_jobs WHERE id = ?",
  ).get(jobId) as { id: string; garden_id: string; status: string } | undefined;
  const ownsLease = activeLearnCouncilDispatchAuthorities.get(jobId);
  return Boolean(
    row &&
      row.id === jobId &&
      row.garden_id === gardenId &&
      !["failed", "cancelled", "complete", "paused"].includes(row.status) &&
      ownsLease?.(),
  );
}

function assertExactOrdinaryCouncilAuthority(
  jobId: string,
  gardenId: string,
): void {
  if (!exactOrdinaryCouncilDispatchAuthority(jobId, gardenId)) {
    throw new PlanningRecoveryBoundaryError("dispatch_authority_lost");
  }
}

function isLearnCancellationWithoutMaskingFailure(
  jobId: string,
  error: unknown,
): boolean {
  if (error instanceof LearnCancelledError) return true;
  try {
    return isLearnCancellation(jobId, error);
  } catch {
    // A failed status read cannot replace or reclassify the operation/provider
    // error that is already unwinding.
    return false;
  }
}

function attachLearnJobModelTracking({
  client,
  jobId,
  gardenId,
  contentPath,
}: {
  client: OpenAI;
  jobId: string;
  gardenId: string;
  contentPath: string;
}): () => void {
  const controller = new AbortController();
  activeLearnAbortControllers.set(jobId, controller);
  if (leaseLostLearnJobs.has(jobId)) {
    controller.abort(
      new LearnPipelineConflictError(
        "This Learn worker lost its fenced garden lease to another process.",
      ),
    );
  }
  const cancellationPoll = setInterval(() => {
    try {
      if (jobStatusById(jobId) === "cancelled" && !controller.signal.aborted) {
        controller.abort(new LearnCancelledError());
      }
    } catch {
      // The request still has the immediate cancel-path abort. Ignore polling
      // failures during process/database teardown rather than throwing from a timer.
    }
  }, 500);
  cancellationPoll.unref();
  const jobHeartbeat = setInterval(() => {
    try {
      if (leaseLostLearnJobs.has(jobId)) return;
      const status = jobStatusById(jobId);
      if (status && activeStatus(status)) {
        db.prepare("UPDATE learn_jobs SET updated_at = ? WHERE id = ?").run(nowIso(), jobId);
      }
    } catch {
      // Recovery treats a missing heartbeat as abandoned only after the garden
      // lease is stale too, so a transient database failure is harmless here.
    }
  }, LEARN_JOB_HEARTBEAT_INTERVAL_MS);
  jobHeartbeat.unref();

  attachLearnTokenUsageTracking(
    client,
    (event) => recordLearnTokenUsageEvent(jobId, event),
    {
      completionRequestOverrides: {
        reasoning: LEARN_REASONING,
        councilModeOverride: "direct_council",
        learnStrictRoute: true,
      },
      retryTransport: {
        signal: controller.signal,
        assertCanAttempt: () => throwIfLearnCancelled(jobId),
        onRejected: ({
          attempt,
          maxAttempts,
          rejectionCause,
          retryCause,
          httpStatus,
        }) => {
          const currentStep = `Model transport stopped without verified recovery (${rejectionCause})`;
          updateLearnJob(jobId, { currentStep });
          appendLearnEvent(contentPath, gardenId, "learn_model_transport_failure", {
            jobId,
            attempt,
            maxAttempts,
            rejectionCause,
            retryCause,
            httpStatus,
            currentStep,
          });
        },
      },
    },
  );

  return () => {
    clearInterval(cancellationPoll);
    clearInterval(jobHeartbeat);
    if (activeLearnAbortControllers.get(jobId) === controller) {
      activeLearnAbortControllers.delete(jobId);
    }
    leaseLostLearnJobs.delete(jobId);
  };
}

function updateLearnJob(jobId: string, updates: Partial<LearnJob>): LearnJob {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE id = ?")
    .get(jobId) as LearnJobRow | undefined;
  if (!row) throw new Error(`Learn job ${jobId} not found`);
  const current = rowToJob(row)!;
  // Terminal jobs stay fenced against a suspended/stale worker. Failed may
  // transition only to cancelled when the user explicitly discards its run;
  // retries always create a new job and lease.
  if (current.status === "cancelled" && updates.status !== "cancelled") {
    return current;
  }
  if (
    current.status === "failed" &&
    updates.status !== "failed" &&
    updates.status !== "cancelled"
  ) {
    return current;
  }
  if (current.status === "complete" && updates.status !== "complete") {
    return current;
  }
  const updatedAt = nowIso();
  const nextStatus = updates.status ?? current.status;
  const timer = transitionLearnTimer(
    { elapsedMs: current.elapsedMs, startedAt: current.timerStartedAt },
    nextStatus,
    updatedAt,
  );
  const next = {
    ...current,
    ...updates,
    progressPercent: monotonicLearnProgress(
      current.progressPercent,
      updates.progressPercent ?? current.progressPercent,
    ),
    // The status to resume into exists only while the row is paused. Any
    // transition off "paused" — Resume, Cancel, or a worker that raced past the
    // gate — drops it so a later pause can never resume into a stale phase.
    pausedFromStatus:
      nextStatus === "paused"
        ? (updates.pausedFromStatus ?? current.pausedFromStatus)
        : undefined,
    elapsedMs: timer.elapsedMs,
    timerStartedAt: timer.startedAt,
    updatedAt,
  };
  const result = db.prepare(
    `UPDATE learn_jobs
     SET status = ?,
         mode = ?,
         model = ?,
         current_step = ?,
         progress_percent = ?,
         current_section_title = ?,
         current_page_title = ?,
         error = ?,
         requires_replan = ?,
         proposed_learning_map_id = ?,
         confirmed_learning_map_id = ?,
         latest_textbook_version_id = ?,
         source_set_hash = ?,
         source_ids_json = ?,
         user_instruction = ?,
         source_only = ?,
         include_source_snapshots = ?,
         paused_from_status = ?,
         active_elapsed_ms = ?,
         timer_started_at = ?,
         updated_at = ?
     WHERE id = ? AND status = ?`,
  ).run(
    next.status,
    next.mode,
    next.model,
    next.currentStep,
    Math.max(0, Math.min(100, Math.round(next.progressPercent))),
    next.currentSectionTitle ?? null,
    next.currentPageTitle ?? null,
    next.error ?? null,
    next.requiresReplan ? 1 : 0,
    next.proposedLearningMapId ?? null,
    next.confirmedLearningMapId ?? null,
    next.latestTextbookVersionId ?? null,
    next.sourceSetHash ?? null,
    jsonString(next.sourceIds),
    next.userInstruction ?? null,
    next.sourceOnly ? 1 : 0,
    next.includeSourceSnapshots ? 1 : 0,
    next.pausedFromStatus ?? null,
    next.elapsedMs,
    next.timerStartedAt ?? null,
    next.updatedAt,
    jobId,
    current.status,
  );
  if (result.changes === 0) {
    const concurrent = db
      .prepare("SELECT * FROM learn_jobs WHERE id = ?")
      .get(jobId) as LearnJobRow | undefined;
    if (!concurrent) throw new Error(`Learn job ${jobId} disappeared during update`);
    return rowToJob(concurrent)!;
  }
  return next;
}

function updateLearnJobExpectStatus(
  jobId: string,
  updates: Partial<LearnJob> & { status: LearnStatus },
): LearnJob {
  const updated = updateLearnJob(jobId, updates);
  if (updated.status !== updates.status) {
    throw new LearnPipelineConflictError(
      `Learn job ${jobId} changed to ${updated.status} before it could commit ${updates.status}.`,
    );
  }
  return updated;
}

/** Commit startup recovery's terminal job state and its request-lifecycle
 * reconciliation as one SQLite transaction. If either write fails, neither is
 * visible, so a terminal row can never retain a permanently in-flight call. */
function commitRecoveredLearnJobTerminalState(
  jobId: string,
  updates: Partial<LearnJob> & { status: "failed" | "cancelled" },
): LearnJob {
  return db.transaction(() => {
    const terminalJob = updateLearnJobExpectStatus(jobId, updates);
    reconcilePersistedLearnTokenUsageForTerminalJob(
      db,
      jobId,
      terminalJob.updatedAt,
    );
    return {
      ...terminalJob,
      tokenUsage: learnTokenUsageForJob(jobId),
    };
  }).immediate();
}

export function getLatestLearnJob(gardenId: string): LearnJob | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE garden_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(gardenId) as LearnJobRow | undefined;
  return rowToJob(row);
}

function getLearnJobById(jobId: string): LearnJob | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_jobs WHERE id = ?")
    .get(jobId) as LearnJobRow | undefined;
  return rowToJob(row);
}

interface UnresolvedLearnJobRow {
  id: string;
  status: LearnStatus;
  current_step: string;
}

function learnJobNeedsExclusiveResolution(
  job: Pick<UnresolvedLearnJobRow, "status" | "current_step">,
): boolean {
  return (
    recoverableLearnStatus(job.status) ||
    job.status === "awaiting_confirmation" ||
    (job.status === "cancelled" &&
      job.current_step === LEARN_CANCELLATION_REQUESTED_STEP)
  );
}

function unresolvedLearnJob(
  gardenId: string,
  allowedJobId?: string,
): UnresolvedLearnJobRow | null {
  ensureLearnTables();
  const rows = db
    .prepare(
      `SELECT id, status, current_step
       FROM learn_jobs
       WHERE garden_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(gardenId) as UnresolvedLearnJobRow[];
  return (
    rows.find(
      (job) =>
        job.id !== allowedJobId && learnJobNeedsExclusiveResolution(job),
    ) ?? null
  );
}

/**
 * Older releases could leave a manual planning row awaiting forever after a
 * newer generation or scoped repair committed. Reconcile only that provably
 * superseded state, and only while the caller owns the garden lease.
 */
function reconcileSupersededAwaitingLearnJobs(gardenId: string): string[] {
  ensureLearnTables();
  const awaiting = db
    .prepare(
      `SELECT rowid AS job_rowid, id, created_at
       FROM learn_jobs
       WHERE garden_id = ? AND status = 'awaiting_confirmation'
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(gardenId) as Array<{
      job_rowid: number;
      id: string;
      created_at: string;
    }>;
  const reconciled: string[] = [];
  for (const waiting of awaiting) {
    const newer = db
      .prepare(
        `SELECT newer.rowid AS job_rowid, newer.id, newer.mode, newer.status
         FROM learn_jobs AS newer
         WHERE newer.garden_id = ?
           AND (newer.created_at > ? OR (newer.created_at = ? AND newer.rowid > ?))
           AND newer.status = 'complete'
           AND (
             newer.mode = 'repair'
             OR EXISTS (
               SELECT 1 FROM learn_versions AS version
               WHERE version.garden_id = newer.garden_id
                 AND version.job_id = newer.id
             )
           )
         ORDER BY newer.created_at DESC, newer.rowid DESC
         LIMIT 1`,
      )
      .get(
        gardenId,
        waiting.created_at,
        waiting.created_at,
        waiting.job_rowid,
      ) as
      | { job_rowid: number; id: string; mode: LearnMode; status: LearnStatus }
      | undefined;
    if (!newer) continue;
    updateLearnJobExpectStatus(waiting.id, {
      status: "complete",
      currentStep: `Planning result superseded by committed Learn job ${newer.id}`,
      progressPercent: 100,
      error: undefined,
    });
    reconciled.push(waiting.id);
  }
  return reconciled;
}

function assertNoUnresolvedLearnJob(
  gardenId: string,
  allowedJobId?: string,
): void {
  const conflict = unresolvedLearnJob(gardenId, allowedJobId);
  if (!conflict) return;
  throw new LearnPipelineConflictError(
    `Learn operation ${conflict.id} (${conflict.status}) must finish, be cancelled, or recover before another operation can change this garden.`,
  );
}

function getLearnMapById(mapId: string, gardenId: string): StoredLearningMap | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_maps WHERE id = ? AND garden_id = ?")
    .get(mapId, gardenId) as
    | LearnMapRow
    | undefined;
  return rowToMap(row);
}

function getLearnMapPlanningJob(
  map: Pick<StoredLearningMap, "id" | "jobId">,
  gardenId: string,
): LearnJob | null {
  const planningJob = getLearnJobById(map.jobId);
  return planningJob?.gardenId === gardenId &&
    planningJob.proposedLearningMapId === map.id
    ? planningJob
    : null;
}

function requireLearnMapPlanningModel(
  map: Pick<StoredLearningMap, "id" | "jobId">,
  gardenId: string,
  model: string,
): LearnJob {
  const planningJob = getLearnMapPlanningJob(map, gardenId);
  if (!planningJob) {
    throw new LearnPipelineConflictError(
      "The Learning Map is no longer bound to its exact planning job. Run Learn planning again before generating lessons.",
      { requiresReplan: true },
    );
  }
  if (planningJob.model !== model) {
    throw new LearnPipelineConflictError(
      "The selected Learn model does not match the model that planned this Learning Map. Restore the planning model, or run Learn planning again with the current selection.",
    );
  }
  return planningJob;
}

function getLatestProposedLearnMap(gardenId: string): StoredLearningMap | null {
  ensureLearnTables();
  const row = db
    .prepare("SELECT * FROM learn_maps WHERE garden_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(gardenId) as LearnMapRow | undefined;
  return rowToMap(row);
}

function getLatestConfirmedLearnMap(gardenId: string): StoredLearningMap | null {
  ensureLearnTables();
  const row = db
    .prepare(
      "SELECT * FROM learn_maps WHERE garden_id = ? AND status = 'confirmed' ORDER BY confirmed_at DESC, created_at DESC LIMIT 1",
    )
    .get(gardenId) as LearnMapRow | undefined;
  return rowToMap(row);
}

function insertLearnMap({
  gardenId,
  jobId,
  sourceMap,
  scopeContract,
  learningMap,
  coveragePlan,
  sourceSetHash,
  sourceArtifactInventoryHash,
  sourceIds,
  syllabusSourceId,
  syllabusCoverage,
}: {
  gardenId: string;
  jobId: string;
  sourceMap: unknown;
  scopeContract: unknown;
  learningMap: ProposedLearningMap;
  coveragePlan: unknown;
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  sourceIds: string[];
  syllabusSourceId?: string;
  syllabusCoverage?: SyllabusCoverage | null;
}): StoredLearningMap {
  ensureLearnTables();
  const createdAt = nowIso();
  const stored: StoredLearningMap = {
    id: makeId("learn_map"),
    gardenId,
    jobId,
    status: "proposed",
    sourceMap,
    scopeContract,
    learningMap,
    proposedOrder: learningMap.sections,
    visualOpportunities: learningMap.sections.flatMap((section) =>
      section.subsections.flatMap((subsection) =>
        subsection.visualOpportunities.map((opportunity) => ({
          section: section.title,
          subsection: subsection.title,
          opportunity,
        })),
      ),
    ),
    coveragePlan,
    sourceSetHash,
    sourceArtifactInventoryHash,
    sourceIds: [...sourceIds],
    syllabusSourceId,
    syllabusCoverage: syllabusCoverage ?? null,
    createdAt,
  };

  db.prepare(
    `INSERT INTO learn_maps (
      id, garden_id, job_id, status, source_map_json, scope_contract_json,
      learning_map_json, proposed_order_json, visual_opportunities_json,
      coverage_plan_json, source_set_hash, source_artifact_inventory_hash,
      source_ids_json, syllabus_source_id, syllabus_coverage_json,
      visual_necessity_review_json, visualization_plan_json,
      visual_contract_executability_ledger_json, visual_route_binding_json,
      created_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    stored.id,
    stored.gardenId,
    stored.jobId,
    stored.status,
    jsonString(stored.sourceMap),
    jsonString(stored.scopeContract),
    jsonString(stored.learningMap),
    jsonString(stored.proposedOrder),
    jsonString(stored.visualOpportunities),
    jsonString(stored.coveragePlan),
    stored.sourceSetHash,
    stored.sourceArtifactInventoryHash,
    jsonString(stored.sourceIds),
    stored.syllabusSourceId ?? null,
    stored.syllabusCoverage ? jsonString(stored.syllabusCoverage) : null,
    null,
    null,
    null,
    null,
    stored.createdAt,
    null,
  );
  return stored;
}

function getLatestLearnVersion(gardenId: string): LearnVersionRow | null {
  ensureLearnTables();
  return (db
    .prepare("SELECT * FROM learn_versions WHERE garden_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(gardenId) as LearnVersionRow | undefined) ?? null;
}

function insertLearnVersion({
  id,
  gardenId,
  jobId,
  learningMapId,
  sourceSetHash,
  sourceArtifactInventoryHash,
  pageCount,
  backupDir,
}: {
  id: string;
  gardenId: string;
  jobId: string;
  learningMapId: string;
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  pageCount: number;
  backupDir?: string;
}): void {
  ensureLearnTables();
  db.prepare(
    `INSERT INTO learn_versions (
      id, garden_id, job_id, learning_map_id, source_set_hash,
      source_artifact_inventory_hash, page_count, backup_dir, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    gardenId,
    jobId,
    learningMapId,
    sourceSetHash,
    sourceArtifactInventoryHash,
    pageCount,
    backupDir ?? null,
    nowIso(),
  );
}

function appendLearnEvent(
  contentPath: string,
  gardenId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  appendGardenEvent(contentPath, gardenId, type, {
    gardenId,
    timestamp: nowIso(),
    ...data,
  });
}

function gardenTitleFromDb(gardenId: string): string {
  try {
    const row = db.prepare("SELECT name FROM clusters WHERE slug = ?").get(gardenId) as
      | { name?: string }
      | undefined;
    return row?.name?.trim() || gardenId;
  } catch {
    return gardenId;
  }
}

function stripLocalFrontmatter(value: string): string {
  return stripMarkdownFrontmatter(value).trim();
}

/** Page snapshot URLs stored in a source note's frontmatter (source_images). */
function sourcePageImageUrls(rawContent: string): string[] {
  const match = rawContent.match(/^source_images:\s*\[([^\]]*)\]/m);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** SourceFigure view of the extracted SourceVisual ledger, for the visual-spec
 * anchor plumbing. Full-page fallbacks are excluded — they are not figures. */
function sourceFiguresFromVisuals(visuals: SourceVisual[]): SourceFigure[] {
  return visuals
    .filter((visual) => visual.type !== "full_page_fallback")
    .map((visual) => ({
      figureId: visual.sourceVisualId,
      sourceId: visual.sourceId,
      page: visual.pageNumber || undefined,
      kind:
        visual.type === "table"
          ? ("table" as const)
          : visual.type === "graph"
            ? ("graph" as const)
            : visual.type === "equation"
              ? ("formula" as const)
              : ("diagram" as const),
      caption: visual.caption,
      ...(visual.exactText ? { ocrText: visual.exactText } : {}),
    }));
}

/**
 * Return the exact selected visual ledger projection consumed by Source Map
 * prompts. This is deliberately broader than the reviewed-equation hash: a
 * late figure, graph, table, or diagram changes the model's required complete
 * artifact partition just as materially as a new equation does.
 */
function selectedSourceArtifactInventoryForContext(
  context: LearnSourceContext,
  visuals: readonly SourceVisual[],
) {
  return selectedSourceArtifactInventorySnapshot({
    selectedSourceIds: context.sources.map((source) => source.slug),
    sourceIdentityMap: context.sourceVisualSourceIdentityMap,
    visuals,
  });
}

function refreshSelectedSourceArtifactInventory(
  contentPath: string,
  gardenId: string,
  context: LearnSourceContext,
) {
  const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
  const ledger = loadSourceVisuals(contentPath, gardenId);
  const visuals = ledger.filter((visual) =>
    selectedSourceIds.has(visual.sourceId),
  );
  const inventory = selectedSourceArtifactInventoryForContext(context, ledger);
  context.sourceFigures = sourceFiguresFromVisuals(visuals);
  context.sourceArtifactInventoryHash = inventory.sourceArtifactInventoryHash;
  return inventory;
}

const STRUCTURED_SOURCE_ARTIFACT_RE = /^S(\d+)\.P(\d+)\.(?:F|G|T|E)\d+$/i;

function stableSourceVisualIndex(
  context: LearnSourceContext,
  sourceId: string,
): number {
  const sourceIndex = context.sourceVisualSourceIdentityMap.find(
    (entry) => entry.sourceId === sourceId,
  )?.sourceIndex;
  if (!sourceIndex) {
    throw new Error(`Stable source-visual identity is missing for source "${sourceId}".`);
  }
  return sourceIndex;
}

function registeredArtifactsFromFigures(sourceFigures: SourceFigure[]): RegisteredSourceArtifact[] {
  return sourceFigures.map((figure) => ({
    id: figure.figureId,
    kind: sourceMapArtifactKind(figure.kind),
  }));
}

/** Normalize detector labels only at the Source Map prompt boundary. The raw
 * source-visual ledger retains its richer detector taxonomy for all other
 * consumers. */
function sourceMapPromptFigures(sourceFigures: readonly SourceFigure[]) {
  return sourceFigures.map((figure) => ({
    ...figure,
    kind: sourceMapArtifactKind(figure.kind),
  }));
}

function sourceMapFigureAnchorPromptCatalog(sourceFigures: readonly SourceFigure[]) {
  return sourceFigures.map((figure) => ({
    id: figure.figureId,
    sourceId: figure.sourceId,
    page: figure.page,
    title: figure.caption,
    kind: sourceMapArtifactKind(figure.kind),
  }));
}

function registeredArtifactsForGarden(clusterDir: string): RegisteredSourceArtifact[] {
  const artifacts: RegisteredSourceArtifact[] = [];
  for (const anchor of Object.values(buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false }))) {
    if (anchor.origin !== "visual_ledger") continue;
    if (anchor.kind === "formula" || anchor.kind === "table" || anchor.kind === "graph" || anchor.kind === "figure") {
      artifacts.push({ id: anchor.id, kind: anchor.kind });
    }
  }
  return artifacts;
}

function structuredArtifactIdsFromUnits(units: LearningUnitContract[]): string[] {
  const ids = new Set<string>();
  const add = (value: string | undefined) => {
    const id = value?.trim() ?? "";
    if (STRUCTURED_SOURCE_ARTIFACT_RE.test(id)) ids.add(id);
  };
  for (const unit of units) {
    unit.sourceAnchors.forEach(add);
    unit.sourceFigures.forEach((artifact) => add(artifact.id));
    unit.sourceFormulas.forEach((artifact) => add(artifact.id));
    unit.sourceTables.forEach((artifact) => add(artifact.id));
    unit.interactiveVisual?.sourceAnchors.forEach(add);
    unit.interactiveVisualPlan?.decision.evidence.sourceAnchorIds.forEach(add);
    unit.interactiveVisualPlan?.visualIntent?.sourceAnchors.forEach(add);
    unit.semanticConcepts?.forEach((concept) => concept.evidenceAnchors.forEach(add));
    unit.knowledgeClaims?.forEach((claim) => {
      claim.evidenceAnchors.forEach(add);
      claim.derivationAnchors?.forEach(add);
    });
    add(unit.teachingMediumPlan?.sourceFigureAnchorId);
    unit.teachingMediumPlan?.formulaAnchorIds?.forEach(add);
  }
  return [...ids].sort();
}

/**
 * Candidate artifact labels emitted into each source's own Markdown during
 * ingestion. They are hints, not evidence: remap the local source number to
 * the durable garden-global source slot, then let PDF rendering + vision decide
 * which exact ids are real before the planner can use them.
 */
function structuredArtifactIdsMentionedBySources(context: LearnSourceContext): string[] {
  const ids = new Set<string>();
  context.sources.forEach((source) => {
    const sourceIndex = stableSourceVisualIndex(context, source.slug);
    const re = /\bS\d+\.P(\d+)\.([FGTE])(\d+)\b/gi;
    for (const match of (source.body ?? "").matchAll(re)) {
      const pageNumber = Number.parseInt(match[1], 10);
      const ordinal = Number.parseInt(match[3], 10);
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) continue;
      if (!Number.isSafeInteger(ordinal) || ordinal < 1) continue;
      ids.add(`S${sourceIndex}.P${pageNumber}.${match[2].toUpperCase()}${ordinal}`);
    }
  });
  return [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

/**
 * Resolve late-page artifact references against the preserved full PDF. PDF
 * upload keeps a small eager snapshot cache for responsiveness, but Learn is
 * not allowed to treat that cache boundary as the end of the source. Any
 * structured id proposed by a contract causes that exact PDF page to be
 * rendered and scanned before the id is accepted.
 */
async function ensureReferencedSourceArtifactsExtracted({
  client,
  model,
  contentPath,
  gardenId,
  context,
  units,
  candidateArtifactIds = [],
  explicitPageHints = [],
  checkpoint,
  onProgress,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  context: LearnSourceContext;
  units: LearningUnitContract[];
  candidateArtifactIds?: readonly string[];
  explicitPageHints?: readonly Pick<SelectedStructuralSourcePageHint, "sourceId" | "sourceIndex" | "pageNumber">[];
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}): Promise<{
  requestedIds: string[];
  requestedPages: Array<{ sourceIndex: number; pageNumber: number }>;
  discoveredIds: string[];
  unresolvedIds: string[];
}> {
  const registeredBefore = new Set(context.sourceFigures.map((figure) => figure.figureId));
  const requestedIds = [...new Set([
    ...structuredArtifactIdsFromUnits(units),
    ...candidateArtifactIds.filter((id) => STRUCTURED_SOURCE_ARTIFACT_RE.test(id)),
  ])].filter((id) => !registeredBefore.has(id));
  const pagesBySourceIndex = new Map<number, Set<number>>();
  const sourceIdentityById = new Map(
    context.sourceVisualSourceIdentityMap.map((entry) => [entry.sourceId, entry.sourceIndex]),
  );
  const selectedSourceByStableIndex = new Map(
    context.sources.map((source) => [stableSourceVisualIndex(context, source.slug), source]),
  );
  const addRequestedPage = (sourceIndex: number, pageNumber: number) => {
    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 1) return;
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return;
    const pages = pagesBySourceIndex.get(sourceIndex) ?? new Set<number>();
    pages.add(pageNumber);
    pagesBySourceIndex.set(sourceIndex, pages);
  };
  for (const id of requestedIds) {
    const match = id.match(STRUCTURED_SOURCE_ARTIFACT_RE);
    if (!match) continue;
    const sourceIndex = Number.parseInt(match[1], 10);
    const pageNumber = Number.parseInt(match[2], 10);
    addRequestedPage(sourceIndex, pageNumber);
  }
  for (const hint of explicitPageHints) {
    const stableSourceIndex = sourceIdentityById.get(hint.sourceId);
    if (stableSourceIndex) addRequestedPage(stableSourceIndex, hint.pageNumber);
  }

  const requestedPages = [...pagesBySourceIndex]
    .flatMap(([sourceIndex, pageNumbers]) => [...pageNumbers].map((pageNumber) => ({
      sourceIndex,
      pageNumber,
    })))
    .sort((left, right) =>
      left.sourceIndex - right.sourceIndex || left.pageNumber - right.pageNumber,
    );

  for (const [sourceIndex, pageNumbers] of pagesBySourceIndex) {
    checkpoint?.();
    const source = selectedSourceByStableIndex.get(sourceIndex);
    if (!source?.sourcePdf) continue;
    const sortedPages = [...pageNumbers].sort((left, right) => left - right);
    onProgress?.(
      `Rendering referenced source page${sortedPages.length === 1 ? "" : "s"} ${sortedPages.join(", ")}...`,
    );
    const pageImageUrls = await ensureSourcePdfPageSnapshots({
      contentPath,
      gardenSlug: gardenId,
      sourceId: source.slug,
      sourcePdfUrl: source.sourcePdf,
      pageNumbers: sortedPages,
      checkpoint,
      onProgress,
    });
    if (pageImageUrls.length === 0) continue;
    // Scan each demanded page independently. A stubborn page must not discard
    // registrations already proven on the other pages. The per-page cache lets
    // a later user-initiated run resume; this run makes one authoritative model
    // request and propagates any exact provider/protocol failure unchanged.
    for (const pageImageUrl of pageImageUrls) {
      checkpoint?.();
      await extractSourceVisuals({
        client,
        model,
        contentPath,
        gardenSlug: gardenId,
        sourceId: source.slug,
        sourceIndex,
        pageImageUrls: [pageImageUrl],
        checkpoint,
        onProgress,
      });
    }
  }

  const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
  const visualLedger = loadSourceVisuals(contentPath, gardenId);
  const visuals = visualLedger.filter((visual) =>
    selectedSourceIds.has(visual.sourceId),
  );
  context.sourceFigures = sourceFiguresFromVisuals(visuals);
  context.sourceArtifactInventoryHash = selectedSourceArtifactInventoryForContext(
    context,
    visualLedger,
  ).sourceArtifactInventoryHash;
  const registeredAfter = new Set(context.sourceFigures.map((figure) => figure.figureId));
  return {
    requestedIds,
    requestedPages,
    discoveredIds: context.sourceFigures
      .map((figure) => figure.figureId)
      .filter((figureId) => !registeredBefore.has(figureId)),
    unresolvedIds: requestedIds.filter((id) => !registeredAfter.has(id)),
  };
}

export function collectLearnSourceContext(
  contentPath: string,
  gardenId: string,
  includedSourceIds?: readonly string[],
  syllabusSourceId?: string | null,
): LearnSourceContext {
  // Context collection is a read path. Legacy source migration belongs to an
  // explicit owner-authorized ingestion/migration operation, never a status
  // request or a generation preflight.
  const knowledge = scanClusterKnowledge(contentPath, gardenId, {
    migrateSources: false,
  });
  const gardenTitle = gardenTitleFromDb(gardenId);
  const availableSources: LearnSourceSummary[] = knowledge.nodes
    .filter((node) => node.type === "source-document")
    .map((node) => ({
      id: node.slug,
      slug: node.slug,
      title: node.title,
      description: node.description,
      relPath: node.relPath,
      sourceType: node.sourceType,
      sourceFile: node.sourceFile,
      sourcePdf: node.sourcePdf,
      date: node.date,
      wordCount: node.wordCount,
      excerpt: node.excerpt,
      body: stripLocalFrontmatter(node.content),
      tags: node.tags,
      sourceImages: sourcePageImageUrls(node.content),
    }));
  const selectedSources = selectLearnSources(availableSources, includedSourceIds);
  // The syllabus resolves against every document, not just the selected ones, so
  // a study guide can steer a run without also being taught as subject matter.
  const syllabus = selectLearnSyllabus(availableSources, syllabusSourceId);
  const sources = excludeSyllabusFromSources(selectedSources, syllabus);
  if (syllabus && sources.length === 0) {
    throw new Error(
      `"${syllabus.title}" is set as the syllabus, so it is not taught as source material. Select at least one other document for Learn.`,
    );
  }
  const selectedSourceIdSet = new Set(sources.map((source) => source.slug));
  const sourceVisualSourceIdentityMap = resolveSourceVisualSourceIdentityMap({
    contentPath,
    gardenSlug: gardenId,
    sourceIds: sources.map((source) => source.slug),
    persist: false,
  });
  const conceptNodes: LearnConceptSummary[] = knowledge.nodes
    .filter(
      (node) =>
        node.type === "internal-concept" &&
        (includedSourceIds === undefined
          ? // No explicit selection means every document is in play — except
            // concepts mined from the syllabus, which describe the course rather
            // than the subject and would otherwise re-enter through this door.
            node.sourceDocument !== syllabus?.slug
          : Boolean(node.sourceDocument && selectedSourceIdSet.has(node.sourceDocument))),
    )
    .map((node) => ({
      title: node.title,
      excerpt: node.excerpt,
      sourceDocument: node.sourceDocument,
      locations: node.locations,
      tags: node.tags,
    }));
  const existingTextbookPages: LearnSourceSummary[] = knowledge.nodes
    .filter(isLearnAuthoredLesson)
    .map((node) => ({
      id: node.slug,
      slug: node.slug,
      title: node.title,
      relPath: node.relPath,
      date: node.date,
      wordCount: node.wordCount,
      excerpt: node.excerpt,
      body: stripLocalFrontmatter(node.content),
      tags: node.tags,
    }));
  // Figures come from the Stage-2 SourceVisual ledger (cropped, captioned).
  // Before extraction has run the list is simply empty — full-page snapshots
  // are never presented as figures.
  const sourceVisualLedger = loadSourceVisuals(contentPath, gardenId);
  const selectedSourceVisuals = sourceVisualLedger.filter((visual) =>
    selectedSourceIdSet.has(visual.sourceId),
  );
  const sourceFigures = sourceFiguresFromVisuals(selectedSourceVisuals);
  const sourceArtifactInventoryHash = selectedSourceArtifactInventorySnapshot({
    selectedSourceIds: sources.map((source) => source.slug),
    sourceIdentityMap: sourceVisualSourceIdentityMap,
    visuals: sourceVisualLedger,
  }).sourceArtifactInventoryHash;

  const rawBaseSourceSetHash = sourceSetHashWithSyllabus(
    sourceSetHashForSources(sources),
    syllabus,
  );
  const selectedSourceOrder = sources.map((source) => source.slug);
  const selectedFormulaIds = selectedSourceVisuals
    .filter((visual) => visual.type === "equation")
    .map((visual) => visual.sourceVisualId)
    .sort();
  const reviewManifest = loadSourceFormulaReviewSetManifest(contentPath, gardenId);
  let baseSourceSetHash = rawBaseSourceSetHash;
  if (reviewManifest && reviewManifest.baseSourceSetHash !== rawBaseSourceSetHash) {
    const currentBindingRecords = sources.map((source) =>
      learnSourceBindingRecord({
        slug: source.slug,
        relPath: source.relPath,
        title: source.title,
        description: source.description,
        sourceFile: source.sourceFile,
        date: source.date,
        wordCount: source.wordCount,
        body: source.body,
      }),
    );
    const normalizationReceipt = matchingLearnSourceNormalizationReceipt({
      gardenDir: path.join(contentPath, gardenId),
      expectedCombinedSourceSetHash: reviewManifest.combinedSourceSetHash,
      sourceIds: selectedSourceOrder,
      current: currentBindingRecords,
    });
    if (normalizationReceipt) {
      const receiptBaseSourceSetHash = sourceSetHashWithSyllabus(
        sourceSetHashForBindingRecords(normalizationReceipt.before),
        syllabus,
      );
      if (receiptBaseSourceSetHash === reviewManifest.baseSourceSetHash) {
        baseSourceSetHash = receiptBaseSourceSetHash;
      }
    }
  }
  let sourceFormulaReviewSetHash: string | undefined;
  let sourceSetHash = baseSourceSetHash;
  if (
    reviewManifest &&
    reviewManifest.baseSourceSetHash === baseSourceSetHash &&
    JSON.stringify(reviewManifest.sourceIds) === JSON.stringify(selectedSourceOrder) &&
    reviewManifest.sourceIdentityMapHash ===
      sourceVisualSourceIdentityMapHash(sourceVisualSourceIdentityMap) &&
    JSON.stringify(reviewManifest.sourceIdentityMap) ===
      JSON.stringify(sourceVisualSourceIdentityMap) &&
    JSON.stringify(reviewManifest.formulaIds) === JSON.stringify(selectedFormulaIds)
  ) {
    try {
      const recomputedReviewSetHash = computeSourceFormulaReviewSetHash(
        loadSourceVisuals(contentPath, gardenId),
        reviewManifest.formulaIds,
        reviewManifest.sourceIds,
        sourceVisualSourceIdentityMap,
        reviewManifest.topologyReviewPageReceipts,
      );
      if (recomputedReviewSetHash === reviewManifest.reviewSetHash) {
        sourceFormulaReviewSetHash = recomputedReviewSetHash;
      }
    } catch {
      // Status/context reads treat incomplete or stale review provenance as an
      // unreviewed source set. Pipeline/finalization paths run the full gate.
    }
    if (sourceFormulaReviewSetHash) {
      sourceSetHash = sourceSetHashWithReviewedFormulas(
        baseSourceSetHash,
        sourceFormulaReviewSetHash,
      );
    }
  }

  return {
    gardenId,
    gardenTitle,
    sources,
    concepts: conceptNodes,
    conceptNodes,
    existingTextbookPages,
    sourceFigures,
    sourceVisualSourceIdentityMap,
    syllabus,
    selectedSourceIds: selectedSources.map((source) => source.slug),
    sourceArtifactInventoryHash,
    baseSourceSetHash,
    sourceSetHash,
    ...(sourceFormulaReviewSetHash ? { sourceFormulaReviewSetHash } : {}),
  };
}

async function reviewAndBindSourceFormulas({
  client,
  model,
  contentPath,
  gardenId,
  context,
  checkpoint,
  onProgress,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  context: LearnSourceContext;
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}): Promise<SourceFormulaReviewResult> {
  checkpoint?.();
  const selectedSourceIds = context.sources.map((source) => source.slug);
  const selectedSourceIdSet = new Set(selectedSourceIds);
  const sourceIdentityMap = context.sourceVisualSourceIdentityMap;
  const sourceIdentityMapHash = sourceVisualSourceIdentityMapHash(sourceIdentityMap);
  const formulaIds = loadSourceVisuals(contentPath, gardenId)
    .filter((visual) => selectedSourceIdSet.has(visual.sourceId) && visual.type === "equation")
    .map((visual) => visual.sourceVisualId)
    .sort();
  const currentLedger = loadSourceVisuals(contentPath, gardenId);
  const existingManifest = loadSourceFormulaReviewSetManifest(contentPath, gardenId);
  const existingManifestMatchesSelectedEvidence = Boolean(
    existingManifest &&
    existingManifest.model === model &&
    existingManifest.baseSourceSetHash === context.baseSourceSetHash &&
    JSON.stringify(existingManifest.sourceIds) === JSON.stringify(selectedSourceIds) &&
    existingManifest.sourceIdentityMapHash === sourceIdentityMapHash &&
    JSON.stringify(existingManifest.sourceIdentityMap) === JSON.stringify(sourceIdentityMap) &&
    JSON.stringify(existingManifest.formulaIds) === JSON.stringify(formulaIds)
  );
  if (existingManifestMatchesSelectedEvidence && existingManifest) {
    let stableHash = "";
    try {
      stableHash = computeSourceFormulaReviewSetHash(
        currentLedger,
        formulaIds,
        selectedSourceIds,
        sourceIdentityMap,
        existingManifest.topologyReviewPageReceipts,
      );
    } catch {
      stableHash = "";
    }
    if (stableHash === existingManifest.reviewSetHash) {
      const existingValidation = validateSourceFormulaReviewSet({
        contentPath,
        gardenSlug: gardenId,
        requiredFormulaIds: formulaIds,
        expectedReviewSetHash: existingManifest.reviewSetHash,
        expectedModel: model,
        expectedSourceIds: selectedSourceIds,
        sourceIdentityMap,
        expectedTopologyReviewPageReceipts: existingManifest.topologyReviewPageReceipts,
      });
      if (existingValidation.problems.length === 0) {
        refreshSelectedSourceArtifactInventory(contentPath, gardenId, context);
        context.sourceFormulaReviewSetHash = existingManifest.reviewSetHash;
        context.sourceSetHash = existingManifest.combinedSourceSetHash;
        const reviewedFormulas = currentLedger.filter((visual) => formulaIds.includes(visual.sourceVisualId));
        return {
          visuals: currentLedger,
          formulaIds,
          reviewedFormulaSetHash: existingManifest.reviewSetHash,
          approvedFormulaIds: reviewedFormulas
            .filter((visual) => visual.formulaReview?.decision === "approved")
            .map((visual) => visual.sourceVisualId)
            .sort(),
          replacementFormulaIds: reviewedFormulas
            .filter((visual) => visual.formulaReview?.decision === "replaced")
            .map((visual) => visual.sourceVisualId)
            .sort(),
          newlyReplacedFormulaIds: [],
          cacheHitFormulaIds: [...formulaIds],
          modelCalls: 0,
          topologyReviewPageReceipts: [...existingManifest.topologyReviewPageReceipts],
        };
      }
    }
  }
  const review = await reviewRequiredSourceFormulaExactText({
    client,
    model,
    contentPath,
    gardenSlug: gardenId,
    selectedSourceIds,
    sourceIdentityMap,
    requiredFormulaIds: formulaIds,
    checkCancelled: checkpoint,
    onProgress,
  });
  checkpoint?.();
  // V5 whole-page recovery may merge, split, retire, or discover equation
  // slots. From this point onward the model-reviewed active inventory is
  // authoritative; the pre-review ledger ids must never be validated or
  // promoted into the manifest after a topology change.
  const reviewedFormulaIds = [...review.formulaIds];
  const projectedFormulaIds = review.visuals
    .filter((visual) => selectedSourceIdSet.has(visual.sourceId) && visual.type === "equation")
    .map((visual) => visual.sourceVisualId)
    .sort();
  if (JSON.stringify(reviewedFormulaIds) !== JSON.stringify(projectedFormulaIds)) {
    throw new Error(
      "Accepted source-formula review inventory does not match its projected active equation ledger.",
    );
  }
  const validation = validateSourceFormulaReviewSet({
    contentPath,
    gardenSlug: gardenId,
    requiredFormulaIds: reviewedFormulaIds,
    expectedReviewSetHash: review.reviewedFormulaSetHash,
    expectedModel: model,
    expectedSourceIds: selectedSourceIds,
    sourceIdentityMap,
    expectedTopologyReviewPageReceipts: review.topologyReviewPageReceipts,
  });
  if (validation.problems.length > 0) {
    throw new Error(
      `Accepted source-formula review provenance failed strict validation: ${validation.problems.join("; ")}`,
    );
  }
  const combinedSourceSetHash = sourceSetHashWithReviewedFormulas(
    context.baseSourceSetHash,
    review.reviewedFormulaSetHash,
  );
  saveSourceFormulaReviewSetManifest(contentPath, gardenId, {
    schemaVersion: 1,
    promptVersion: 2,
    model,
    sourceIds: selectedSourceIds,
    sourceIdentityMap: [...sourceIdentityMap],
    sourceIdentityMapHash,
    formulaIds: reviewedFormulaIds,
    topologyReviewPageReceipts: review.topologyReviewPageReceipts,
    reviewSetHash: review.reviewedFormulaSetHash,
    baseSourceSetHash: context.baseSourceSetHash,
    combinedSourceSetHash,
    createdAt: nowIso(),
  });
  rebindLearnSourceNormalizationReceipt({
    gardenDir: path.join(contentPath, gardenId),
    expectedCombinedSourceSetHash: combinedSourceSetHash,
    sourceIds: selectedSourceIds,
    current: context.sources.map((source) =>
      learnSourceBindingRecord({
        slug: source.slug,
        relPath: source.relPath,
        title: source.title,
        description: source.description,
        sourceFile: source.sourceFile,
        date: source.date,
        wordCount: source.wordCount,
        body: source.body,
      }),
    ),
  });
  refreshSelectedSourceArtifactInventory(contentPath, gardenId, context);
  context.sourceFormulaReviewSetHash = review.reviewedFormulaSetHash;
  context.sourceSetHash = combinedSourceSetHash;
  // Extraction can transiently replay an older signed detector/recovery
  // projection before ordinary formula review restores the exact already-bound
  // canonical set. In that case a replacement is new relative only to the
  // intermediate ledger, not to planning evidence. Preserve the safety signal
  // unless the complete final set (including identities, provenance, crops,
  // topology receipts, and accepted text) hashes back to the prior manifest.
  const restoredExistingBoundReviewSet = Boolean(
    existingManifestMatchesSelectedEvidence &&
    existingManifest &&
    JSON.stringify(existingManifest.formulaIds) === JSON.stringify(reviewedFormulaIds) &&
    existingManifest.reviewSetHash === review.reviewedFormulaSetHash &&
    existingManifest.combinedSourceSetHash === combinedSourceSetHash
  );
  return restoredExistingBoundReviewSet && review.newlyReplacedFormulaIds.length > 0
    ? { ...review, newlyReplacedFormulaIds: [] }
    : review;
}

/**
 * Stage 2: make sure every source's meaningful visuals are extracted into the
 * SourceVisual ledger (idempotent per source). For a visual-rich PDF this is
 * mandatory: if extraction yields zero real figures/tables (only full-page
 * fallbacks, or nothing), the whole job fails rather than silently producing
 * learner pages with no source figures.
 */
async function ensureSourceVisualsExtracted({
  client,
  model,
  contentPath,
  gardenId,
  context,
  deferEmptyVisualCheck = false,
  checkpoint,
  onProgress,
}: {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenId: string;
  context: LearnSourceContext;
  /** Let an immediate follow-up on-demand scan satisfy a visual-rich source. */
  deferEmptyVisualCheck?: boolean;
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}): Promise<SourceVisual[]> {
  context.sourceVisualSourceIdentityMap = resolveSourceVisualSourceIdentityMap({
    contentPath,
    gardenSlug: gardenId,
    sourceIds: context.sources.map((source) => source.slug),
    persist: true,
  });
  for (let index = 0; index < context.sources.length; index += 1) {
    checkpoint?.();
    const source = context.sources[index];
    const sourceIndex = stableSourceVisualIndex(context, source.slug);
    const pageImageUrls = [...new Set([
      ...(source.sourceImages ?? []).filter(isFullPageSnapshotUrl),
      ...sourceVisualCachedPageImageUrls(contentPath, gardenId, source.slug),
    ])];
    if (pageImageUrls.length === 0) continue;
    await extractSourceVisuals({
      client,
      model,
      contentPath,
      gardenSlug: gardenId,
      sourceId: source.slug,
      sourceIndex,
      pageImageUrls,
      checkpoint,
      onProgress,
    });
    const scanCoverageProblems = sourceVisualScanCoverageProblems({
      contentPath,
      gardenSlug: gardenId,
      sourceId: source.slug,
      pageImageUrls,
    });
    if (scanCoverageProblems.length > 0) {
      throw new Error(
        `Source visual extraction did not cover every supplied page snapshot: ${scanCoverageProblems.join("; ")}`,
      );
    }
  }

  const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
  const visualLedger = loadSourceVisuals(contentPath, gardenId);
  const visuals = visualLedger.filter((visual) =>
    selectedSourceIds.has(visual.sourceId),
  );
  context.sourceFigures = sourceFiguresFromVisuals(visuals);
  context.sourceArtifactInventoryHash = selectedSourceArtifactInventoryForContext(
    context,
    visualLedger,
  ).sourceArtifactInventoryHash;

  if (!deferEmptyVisualCheck) {
    const inventoryCoverageProblems = sourceVisualInventoryCoverageProblems(context.sources, visuals);
    if (inventoryCoverageProblems.length > 0) {
      throw new Error(
        `Source visual extraction completeness failed: ${inventoryCoverageProblems.join("; ")}. Refusing to plan or write learner pages from an incomplete figure registry.`,
      );
    }
  }

  return visuals;
}

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}\n[truncated]`;
}

/** How much of the study guide the planner sees. Syllabi are short documents;
 * this is generous enough for a full course outline without crowding out the
 * source material it is meant to organize. */
const MAX_SYLLABUS_PROMPT_CHARS = 12000;
/** Page writing only needs the outline as orientation, not the whole guide. */
const MAX_SYLLABUS_DOSSIER_CHARS = 3000;

/** The designated study guide, in the shape planning prompts read it. */
function promptSyllabus(
  context: LearnSourceContext,
  maxChars = MAX_SYLLABUS_PROMPT_CHARS,
): unknown {
  const syllabus = context.syllabus;
  if (!syllabus) return undefined;
  return {
    id: syllabus.slug,
    title: syllabus.title,
    description: syllabus.description,
    sourceFile: syllabus.sourceFile,
    content: truncate(syllabus.body, maxChars),
  };
}

function cleanStructuralAnchorText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function structuralAnchorTitle(text: string, fallback: string): string {
  const heading = text
    .split("\n")
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1]?.trim())
    .find((value): value is string => Boolean(value));
  return (heading || fallback).slice(0, 180);
}

/**
 * Project Markdown page boundaries into canonical text evidence. Code does not
 * decide what a page means or where it belongs; the planning model receives
 * this catalog and authors those semantic choices.
 */
function structuralSourceTextAnchorCatalog(context: LearnSourceContext): ModelSourcePageAnchorRecord[] {
  const anchors: ModelSourcePageAnchorRecord[] = modelSourcePageAnchors(context.sources);
  const paginatedSourceIds = new Set(anchors.map((anchor) => anchor.sourceId));
  context.sources.forEach((source) => {
    if (paginatedSourceIds.has(source.slug)) return;
    const body = String(source.body ?? "").replace(/\r\n/g, "\n");
    if (!body.trim()) return;

    // Non-paginated Markdown is divided only at paragraph boundaries and a
    // fixed transport ceiling. Segment numbers are structural positions.
    const paragraphs = body.split(/\n{2,}/).map(cleanStructuralAnchorText).filter(Boolean);
    const segments: string[] = [];
    let current = "";
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length + 2 > 12_000) {
        segments.push(current);
        current = paragraph;
      } else {
        current = current ? `${current}\n\n${paragraph}` : paragraph;
      }
    }
    if (current) segments.push(current);
    segments.forEach((exactText, segmentIndex) => {
      const page = segmentIndex + 1;
      const title = structuralAnchorTitle(exactText, `${source.title} — segment ${page}`);
      anchors.push({
        id: `text-${source.slug.replace(/[^A-Za-z0-9_.-]+/g, "-")}-segment-${page}`,
        sourceId: source.slug,
        page,
        kind: "guidance",
        title,
        exactText,
        provenance: {
          origin: "selected_source_markdown_page",
          sourceRelPath: source.relPath,
          extraction: "exact_markdown_page_block",
        },
      });
    });
  });
  return anchors;
}

function structuralSourceAnchorPromptCatalog(
  anchors: readonly ModelSourcePageAnchorRecord[],
): Array<Record<string, unknown>> {
  return anchors.map((anchor) => ({
    id: anchor.id,
    sourceId: anchor.sourceId,
    page: anchor.page,
    title: anchor.title,
    excerpt: compactFallbackText(anchor.exactText).slice(0, 240),
  }));
}

function persistSelectedStructuralSourceAnchors(input: {
  clusterDir: string;
  sourceMap: unknown;
  selectedSourceIds: readonly string[];
  catalog: readonly ModelSourcePageAnchorRecord[];
}): void {
  const sourceMap = planningRecord(input.sourceMap);
  const selectedIds = new Set(
    (Array.isArray(sourceMap.sourceAnchors) ? sourceMap.sourceAnchors : [])
      .map((entry) => planningRecord(entry).id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const catalogById = new Map(input.catalog.map((anchor) => [anchor.id, anchor]));
  const selectedRecords = [...selectedIds]
    .map((id) => catalogById.get(id))
    .filter((anchor): anchor is ModelSourcePageAnchorRecord => Boolean(anchor));
  const selectedRecordIds = new Set(selectedRecords.map((record) => record.id.toLowerCase()));
  const ledgerPath = path.join(input.clusterDir, ".breadboard", "source-anchors.json");
  const ledger = fs.existsSync(ledgerPath)
    ? planningRecord(JSON.parse(fs.readFileSync(ledgerPath, "utf-8")))
    : {};
  const selectedSourceIds = new Set(input.selectedSourceIds);
  const existingStructural = Array.isArray(ledger.sourceStructuralAnchors)
      ? ledger.sourceStructuralAnchors.filter((entry) => {
        const sourceId = planningRecord(entry).sourceId;
        const id = planningRecord(entry).id;
        const isProjectedPageText =
          typeof id === "string" && /^text-[A-Za-z0-9_.-]+-(?:page|segment)-\d+$/i.test(id);
        if (!isProjectedPageText) return true;
        if (typeof id === "string" && selectedRecordIds.has(id.toLowerCase())) return false;
        return typeof sourceId !== "string" || !selectedSourceIds.has(sourceId);
      })
    : [];
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify({
    ...ledger,
    sourceStructuralAnchors: [...existingStructural, ...selectedRecords],
  }, null, 2)}\n`, "utf-8");
}

function sourcePlanningIndex(body: string | undefined, maxChars: number): string {
  const text = String(body ?? "");
  const boundary = text.search(/^##\s+Internal planning\s*$/im);
  return truncate(boundary > 0 ? text.slice(0, boundary) : text, maxChars);
}

function promptSources(
  context: LearnSourceContext,
  options: { sourceMapArtifactKinds?: boolean } = {},
): unknown {
  const maxIndexCharsPerSource = Math.max(
    18_000,
    Math.floor(120_000 / Math.max(1, context.sources.length)),
  );
  const sourceFigures = options.sourceMapArtifactKinds
    ? sourceMapPromptFigures(context.sourceFigures)
    : context.sourceFigures;
  return {
    gardenId: context.gardenId,
    gardenTitle: context.gardenTitle,
    sourceSetHash: context.sourceSetHash,
    sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    sources: context.sources.map((source) => ({
      id: source.slug,
      sourceNumber: stableSourceVisualIndex(context, source.slug),
      title: source.title,
      description: source.description,
      relPath: source.relPath,
      sourceType: source.sourceType,
      sourceFile: source.sourceFile,
      tags: source.tags,
      excerpt: source.excerpt,
      content: sourcePlanningIndex(source.body, maxIndexCharsPerSource),
    })),
    conceptNodes: context.conceptNodes.slice(0, 80),
    sourceFigures,
    // Stage-2 extracted visuals, in the shape the planner assigns from.
    sourceVisuals: sourceFigures.map((figure) => ({
      sourceVisualId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      caption: figure.caption,
    })),
  };
}

/** Exact selected-source evidence for the model-authored syllabus coverage
 * decision. The per-source bound is transport-only: strings are copied from
 * the source record, never summarized, ranked, or matched by code. */
function promptSyllabusCoverageSourceCatalog(
  context: LearnSourceContext,
  syllabusPlan: SyllabusPlan,
): unknown {
  return {
    sourceRecords: buildSyllabusCoverageSourceCatalog(context.sources),
    // These exact strings remain syllabus input. They do not choose or match a
    // source page; the coverage model decides whether the raw source prefix
    // proves each locator.
    authoredLocators: authoredSyllabusLocatorCatalog(syllabusPlan.referencedMaterials),
  };
}

/** Body-free source context for downstream planning stages. The learning-spine
 * call already receives the source map and scope contract (which digested the
 * full text), so re-sending every 9k-char body only inflates the prompt and the
 * upstream latency. Keep titles, excerpts, tags, and figure metadata. */
function promptSourcesCompact(context: LearnSourceContext): unknown {
  return {
    gardenId: context.gardenId,
    gardenTitle: context.gardenTitle,
    sourceSetHash: context.sourceSetHash,
    sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    sources: context.sources.map((source) => ({
      id: source.slug,
      sourceNumber: stableSourceVisualIndex(context, source.slug),
      title: source.title,
      description: source.description,
      relPath: source.relPath,
      sourceType: source.sourceType,
      tags: source.tags,
      excerpt: truncate(source.excerpt || source.body, 1200),
    })),
    conceptNodes: context.conceptNodes.slice(0, 60),
    sourceVisuals: context.sourceFigures.map((figure) => ({
      sourceVisualId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      caption: figure.caption,
    })),
  };
}

interface CouncilTextInput {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  pageId?: string;
  system: string;
  user: string;
  sourceContext: unknown;
  councilModeOverride?: CouncilMode;
  /** Per-request timeout override. When set, SDK-internal retries remain
   * disabled so an ambiguous timeout cannot issue a duplicate model POST. */
  timeoutMs?: number;
  /** Structured-output callers need the exact provider text when strict JSON
   * parsing fails so a bounded AI rereview can see and wholly rewrite it. */
  preserveExactContent?: boolean;
  /** Present only for authoritative planning JSON calls. */
  planningCheckpoint?: LearnPlanningRequestCheckpoint;
  /** Durable identity for every other Learn Council call. */
  ordinaryCheckpoint?: LearnOrdinaryRequestCheckpoint;
}

async function callCouncilTextOnce({
  client,
  model,
  taskType,
  gardenId,
  pageId,
  system,
  user,
  sourceContext,
  councilModeOverride,
  timeoutMs,
  preserveExactContent = false,
  planningCheckpoint,
  ordinaryCheckpoint,
}: CouncilTextInput): Promise<CouncilCallResult> {
  if (ordinaryCheckpoint && councilModeOverride !== "direct_council") {
    throw new LearnPlanningRecoveryConflictError(
      "Durable ordinary Learn Council calls require the explicit direct_council route.",
    );
  }
  logPromptBudget(
    `${taskType}${pageId ? ` ${pageId}` : ""} (${councilModeOverride ?? "default"})`,
    system,
    user,
    sourceContext,
  );
  const completionRequest = buildCouncilCompletionRequest({
    model,
    taskType,
    gardenId,
    pageId,
    system,
    user,
    sourceContext,
    councilModeOverride,
  });
  if (Boolean(planningCheckpoint) === Boolean(ordinaryCheckpoint)) {
    throw new LearnPlanningRecoveryConflictError(
      "Every Learn Council request requires exactly one durable checkpoint kind.",
    );
  }
  const dispatchCouncilRequest = async (
    requestToDispatch: CouncilCompletionRequest,
    bindingToComplete: {
      requestId: string;
      checkpointRequestId: string;
      requestHash: string;
      sameReceiptRedispatch?: boolean;
    } | null,
  ): Promise<CouncilCallResult> => {
    type PlanningHttpResponse = {
      id: string;
      choices: Array<{ message?: { content?: string | null } }>;
      councilRunId?: string;
      councilMode?: string;
    };
    let response: PlanningHttpResponse;
    try {
      const post = async () => (await client.chat.completions.create(
        requestToDispatch as Parameters<typeof client.chat.completions.create>[0],
        timeoutMs ? { timeout: timeoutMs, maxRetries: 0 } : undefined,
      )) as unknown as PlanningHttpResponse;
      response = bindingToComplete
        ? await dispatchAfterExactPlanningAuthority({
            authorized: () => exactPlanningDispatchAuthority(
              planningCheckpoint!.jobId,
              gardenId,
            ),
            dispatch: post,
          })
        : await post();
    } catch (error) {
      if (bindingToComplete && modelHttpStatus(error) === 502) {
        const lookup = await promptlessCouncilResultGet(
          client,
          "/internal/council-results/resolve",
          {
            requestId: bindingToComplete.requestId,
            requestHash: bindingToComplete.requestHash,
          },
        );
        if (lookup.status === 200 && lookup.result) {
          return resolveCompletedPlanningReceipt({
            client,
            binding: bindingToComplete,
            expectedModel: model,
            preserveExactContent,
            ...(bindingToComplete.sameReceiptRedispatch
              ? {
                  adoption: {
                    jobId: planningCheckpoint!.jobId,
                    gardenId,
                    stageKey: planningCheckpoint!.stageKey,
                    semanticAttempt: planningCheckpoint!.semanticAttempt,
                  },
                }
              : {}),
            recovered: true,
          });
        }
        if (
          lookup.status === 409 &&
          lookup.code === "request_failed" &&
          lookup.receipt?.redispatchAllowed === true &&
          lookup.receipt.failureCode
        ) {
          try {
            updateLearnJob(planningCheckpoint!.jobId, {
              currentStep: `HTTP 502; automatically retrying ${planningCheckpoint!.stageLabel}`,
            });
          } catch {
            // The exact server receipt remains the retry authority.
          }
          await waitForLearnHttp502Retry(
            planningCheckpoint!.jobId,
            LEARN_HTTP_502_RETRY_BASE_DELAY_MS,
          );
          return dispatchCouncilRequest(
            { ...requestToDispatch, clientRequestRedispatch: true },
            bindingToComplete,
          );
        }
        if (
          lookup.status === 409 &&
          lookup.code === "request_failed" &&
          lookup.receipt?.redispatchAllowed === false &&
          lookup.receipt.failureCode
        ) {
          throw new LearnCouncilHttp502ReceiptError(
            {
              requestId: bindingToComplete.requestId,
              requestHash: bindingToComplete.requestHash,
              dispatchGeneration: lookup.receipt.dispatchGeneration,
              dispatchCount: lookup.receipt.dispatchCount,
              redispatchCount: lookup.receipt.redispatchCount,
              redispatchAllowed: false,
              failureCode: lookup.receipt.failureCode,
              proofKind: "terminal_receipt",
            },
            error,
          );
        }
      }
      if (
        bindingToComplete?.sameReceiptRedispatch &&
        modelHttpStatus(error) === 409
      ) {
        return resolveCompletedPlanningReceipt({
          client,
          binding: bindingToComplete,
          expectedModel: model,
          preserveExactContent,
          observeStartedRace: true,
          observationTimeoutMs: timeoutMs ?? LEARN_PLANNING_TIMEOUT_MS,
          adoption: {
            jobId: planningCheckpoint!.jobId,
            gardenId,
            stageKey: planningCheckpoint!.stageKey,
            semanticAttempt: planningCheckpoint!.semanticAttempt,
          },
          recovered: true,
        });
      }
      throw error;
    }
    const typed = response;
    const exactContent = response.choices[0]?.message?.content ?? "";
    const councilRunId = typed.councilRunId ?? response.id;
    if (bindingToComplete) {
      return resolveCompletedPlanningReceipt({
        client,
        binding: bindingToComplete,
        expectedModel: model,
        preserveExactContent,
        expectedHttpResult: {
          councilRunId,
          responseHash: createHash("sha256").update(exactContent, "utf8").digest("hex"),
        },
        ...(bindingToComplete.sameReceiptRedispatch
          ? {
              adoption: {
                jobId: planningCheckpoint!.jobId,
                gardenId,
                stageKey: planningCheckpoint!.stageKey,
                semanticAttempt: planningCheckpoint!.semanticAttempt,
              },
            }
          : {}),
        recovered: false,
      });
    }
    return {
    // Every piece of prose the pipeline writes into a garden page comes through
    // here, so this is where invisible-Unicode marks come out of it — before
    // any anchor is assigned or any gate counts a line. Only invisible
    // characters go; formulas, anchors and fenced blocks are untouched.
    // Strict structured callers can opt into the exact provider bytes so a
    // malformed response reaches their bounded AI rereview without reshaping.
      content: preserveExactContent ? exactContent : scrubbed(exactContent.trim()),
      councilRunId,
      councilMode: typed.councilMode,
    };
  };
  if (ordinaryCheckpoint) {
    return callOrdinaryCouncilTextWithReceipt({
      client,
      model,
      // The caller supplied direct_council and the check above failed closed on
      // any environment-driven policy drift. Hash and dispatch the unchanged
      // canonical request so the local checkpoint and server receipt agree.
      request: completionRequest,
      checkpoint: ordinaryCheckpoint,
      preserveExactContent,
      timeoutMs,
    });
  }
  if (!planningCheckpoint) {
    throw new LearnPlanningRecoveryConflictError(
      "Learn Council planning checkpoint is missing.",
    );
  }

  const requestHash = councilRequestHashV1(recoverablePlanningEnvelope(completionRequest));
  let sameReceiptRedispatch: PlanningReceiptRedispatch | null = null;
  return recoverBeforePlanningDispatch({
    recover: async () => {
      const resolution = await resolvePriorPlanningResult({
        client,
        requestHash,
        request: completionRequest,
        checkpoint: planningCheckpoint,
        taskType,
        preserveExactContent,
      });
      if (isPlanningReceiptRedispatch(resolution)) {
        sameReceiptRedispatch = resolution;
        return null;
      }
      return resolution;
    },
    dispatch: async () => {
      const requestId = sameReceiptRedispatch?.requestId ?? makeId("lrq");
      if (!sameReceiptRedispatch) {
        createStartedPlanningCheckpoint(db, {
          requestId,
          jobId: planningCheckpoint.jobId,
          gardenId,
          stageKey: planningCheckpoint.stageKey,
          semanticAttempt: planningCheckpoint.semanticAttempt,
          requestHash,
          now: nowIso(),
        });
      }
      return dispatchCouncilRequest(
        {
          ...completionRequest,
          clientRequestId: requestId,
          clientRequestHash: requestHash,
          ...(sameReceiptRedispatch?.redispatchReason === "request_failed"
            ? { clientRequestRedispatch: true }
            : {}),
        },
        {
          requestId,
          checkpointRequestId: sameReceiptRedispatch?.checkpointRequestId ?? requestId,
          requestHash,
          ...(sameReceiptRedispatch ? { sameReceiptRedispatch: true } : {}),
        },
      );
    },
  });
}

const LEARN_HTTP_502_RETRY_BASE_DELAY_MS = 2_000;
const LEARN_HTTP_502_RETRY_MAX_DELAY_MS = 30_000;

function learnHttp502RetryDelayMs(retryNumber: number): number {
  return Math.min(
    LEARN_HTTP_502_RETRY_MAX_DELAY_MS,
    LEARN_HTTP_502_RETRY_BASE_DELAY_MS * 2 ** Math.min(4, Math.max(0, retryNumber - 1)),
  );
}

async function waitForLearnHttp502Retry(jobId: string, delayMs: number): Promise<void> {
  const deadline = Date.now() + delayMs;
  while (Date.now() < deadline) {
    await learnCheckpoint(jobId);
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
    );
  }
  await learnCheckpoint(jobId);
}

/** Retry a proven 502 forever, using a new strict receipt only after the prior
 * receipt is terminal. The stage-key suffix gives each transport cycle a
 * durable local identity; the canonical request body and hash remain exactly
 * unchanged. Cancellation and pause checks stay live during every backoff. */
async function callCouncilText(input: CouncilTextInput): Promise<CouncilCallResult> {
  const checkpoint = input.planningCheckpoint ?? input.ordinaryCheckpoint;
  let retryNumber = 0;
  for (;;) {
    const stageKey = retryNumber === 0 || !checkpoint
      ? checkpoint?.stageKey
      : `${checkpoint.stageKey}:http-502-retry:${retryNumber}`;
    try {
      return await callCouncilTextOnce({
        ...input,
        ...(input.planningCheckpoint && stageKey
          ? { planningCheckpoint: { ...input.planningCheckpoint, stageKey } }
          : {}),
        ...(input.ordinaryCheckpoint && stageKey
          ? { ordinaryCheckpoint: { ...input.ordinaryCheckpoint, stageKey } }
          : {}),
      });
    } catch (error) {
      if (!(error instanceof LearnCouncilHttp502ReceiptError) || !checkpoint) {
        throw error;
      }
      retryNumber += 1;
      const delayMs = learnHttp502RetryDelayMs(retryNumber);
      try {
        updateLearnJob(checkpoint.jobId, {
          currentStep: `HTTP 502; automatically retrying ${checkpoint.stageLabel} (retry ${retryNumber})`,
        });
        appendLearnEvent(input.planningCheckpoint?.contentPath ?? input.ordinaryCheckpoint!.contentPath, input.gardenId, "learn_http_502_auto_retry_scheduled", {
          jobId: checkpoint.jobId,
          stageKey: checkpoint.stageKey,
          stageLabel: checkpoint.stageLabel,
          retryNumber,
          delayMs,
          priorReceiptRequestId: error.receipt.requestId,
          priorReceiptDispatchCount: error.receipt.dispatchCount,
        });
      } catch {
        // Retry authority comes from the strict receipt, never from telemetry.
      }
      await waitForLearnHttp502Retry(checkpoint.jobId, delayMs);
    }
  }
}

async function callCouncilJson({
  client,
  model,
  taskType,
  gardenId,
  system,
  user,
  sourceContext,
  councilModeOverride = "full_council",
  timeoutMs,
  preserveExactContent = false,
  planningCheckpoint,
  ordinaryCheckpoint,
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  system: string;
  user: string;
  sourceContext: unknown;
  councilModeOverride?: CouncilMode;
  timeoutMs?: number;
  preserveExactContent?: boolean;
  planningCheckpoint?: LearnPlanningRequestCheckpoint;
  ordinaryCheckpoint?: LearnOrdinaryRequestCheckpoint;
}): Promise<CouncilJsonResult> {
  const result = await callCouncilText({
    client,
    model,
    taskType,
    gardenId,
    system,
    user,
    sourceContext,
    councilModeOverride,
    timeoutMs,
    preserveExactContent,
    planningCheckpoint,
    ordinaryCheckpoint,
  });
  return { ...result, parsed: parseJsonCandidate(result.content) };
}

async function requestVisualizationContractRepair(input: {
  client: OpenAI;
  model: string;
  gardenId: string;
  contentPath: string;
  jobId: string;
  semanticAttempt: number;
  packet: VisualizationContractRepairPacket;
}): Promise<unknown> {
  const result = await callCouncilJson({
    client: input.client,
    model: input.model,
    taskType: "visualization_generation",
    gardenId: input.gardenId,
    system: buildVisualizationContractRepairPrompt(input.packet).system,
    user: buildVisualizationContractRepairPrompt(input.packet).user,
    sourceContext: input.packet,
    councilModeOverride: "direct_council",
    timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
    preserveExactContent: true,
    ordinaryCheckpoint: {
      jobId: input.jobId,
      contentPath: input.contentPath,
      stageKey: "planning:visual_contract_repair",
      stageLabel: "visualization contract repair",
      semanticAttempt: input.semanticAttempt,
    },
  });
  return exactVisualizationContractRepairResponse(result.content);
}

async function requestVisualizationContractExecutabilityReview(input: {
  client: OpenAI;
  model: string;
  gardenId: string;
  contentPath: string;
  jobId: string;
  request: VisualContractExecutabilityProviderRequest;
}): Promise<unknown> {
  const result = await callCouncilText({
    client: input.client,
    model: input.model,
    taskType: "visual_necessity_review",
    gardenId: input.gardenId,
    system: input.request.system,
    user: input.request.user,
    // The complete contract and canonical evidence are already present once
    // in the user payload. Council routing receives only bounded audit metadata.
    sourceContext: {
      gardenId: input.gardenId,
      taskType: "visual_contract_executability_review",
      attempt: input.request.attempt,
      unitIds: input.request.unitIds,
      previousProblemCount: input.request.problems.length,
      requestPurpose: input.request.requestPurpose,
      semanticCandidatesBeforeRequest: input.request.semanticCandidatesBeforeRequest,
      protocolRetriesBeforeRequest: input.request.protocolRetriesBeforeRequest,
    },
    councilModeOverride: "direct_council",
    timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
    preserveExactContent: true,
    ordinaryCheckpoint: {
      jobId: input.jobId,
      contentPath: input.contentPath,
      stageKey: "planning:visual_contract_executability",
      stageLabel: "visual contract executability review",
      semanticAttempt: input.request.attempt,
    },
  });
  // Preserve exact provider text—even valid JSON—so the bounded reviewer can
  // separate raw protocol retries from parsed semantic candidates without
  // JSON.parse/JSON.stringify normalizing model numbers. A true Council
  // transport exception deliberately escapes this boundary unchanged.
  return strictVisualContractExecutabilityResponseOrExactRaw(result.content);
}

async function planAndReviewVisualNecessity(input: {
  client: OpenAI;
  model: string;
  gardenId: string;
  contentPath: string;
  jobId: string;
  learningUnits: LearningUnitContract[];
}): Promise<GardenVisualNecessityPlan> {
  const gardenDir = clusterPath(input.contentPath, input.gardenId);
  const overrides = loadVisualDecisionOverrides(gardenDir);
  const packet = buildModelVisualNecessityPacket({
    gardenId: input.gardenId,
    learningUnits: input.learningUnits,
    canonicalEvidenceByUnit: canonicalVisualizationEvidenceByUnit(gardenDir, input.learningUnits),
    // These are safety ceilings, not targets. Allowing every unit keeps code
    // out of the pedagogical decision; the model must justify the actual set.
    budget: {
      maximumInteractiveUnits: input.learningUnits.length,
      maximumRequiredInteractiveUnits: input.learningUnits.length,
      maximumRepeatedInteractionSignature: LEARN_VISUAL_MAX_REPEATED_INTERACTION_SIGNATURE,
    },
    sectionByUnit: Object.fromEntries(
      input.learningUnits.flatMap((unit) =>
        unit.sectionPlan?.id ? [[unit.id, unit.sectionPlan.id]] : []),
    ),
    overrides,
  });
  const run = await runModelVisualNecessityPlanning({
    packet,
    learningUnits: input.learningUnits,
    provider: async (request) => {
      throwIfLearnCancelled(input.jobId);
      const { parsed } = await callCouncilJson({
        client: input.client,
        model: input.model,
        taskType: "visual_necessity_review",
        gardenId: input.gardenId,
        system: request.system,
        user: request.user,
        // Evidence is already present once in the user payload. Keep council
        // routing metadata compact so the same garden packet is not charged or
        // reasoned over twice.
        sourceContext: {
          gardenId: input.gardenId,
          taskType: "visual_necessity_review",
          attempt: request.attempt,
          unitIds: packet.units.map((unit) => unit.unitId),
        },
        councilModeOverride: "direct_council",
        timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
        ordinaryCheckpoint: {
          jobId: input.jobId,
          contentPath: input.contentPath,
          stageKey: "planning:visual_necessity:batch",
          stageLabel: "visual necessity review",
          semanticAttempt: request.attempt,
        },
      });
      // Malformed/absent structured model output is a semantic validation
      // failure and must enter the bounded model-repair loop. Only an actual
      // callCouncilJson transport exception escapes this provider.
      return parsed;
    },
    targetedRepairProvider: async (request) => {
      throwIfLearnCancelled(input.jobId);
      const { parsed } = await callCouncilJson({
        client: input.client,
        model: input.model,
        taskType: "visual_necessity_review",
        gardenId: input.gardenId,
        system: request.system,
        user: request.user,
        // The user payload contains only failed unit packets and their exact
        // canonical evidence. Routing metadata stays compact and never repeats
        // the complete garden or the untouched decision records.
        sourceContext: {
          gardenId: input.gardenId,
          taskType: "visual_necessity_targeted_repair",
          attempt: request.attempt,
          unitIds: request.unitIds,
        },
        councilModeOverride: "direct_council",
        timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
        ordinaryCheckpoint: {
          jobId: input.jobId,
          contentPath: input.contentPath,
          stageKey: `planning:visual_necessity:targeted:${createHash("sha256")
            .update(JSON.stringify([...request.unitIds].sort()))
            .digest("hex")}`,
          stageLabel: "targeted visual necessity repair",
          semanticAttempt: request.attempt,
        },
      });
      // Let the targeted response validator reject malformed model output;
      // transport exceptions still propagate from callCouncilJson unchanged.
      return parsed;
    },
  });
  appendLearnEvent(input.contentPath, input.gardenId, "learn_visual_necessity_review_completed", {
    jobId: input.jobId,
    decisionSource: "model_batch",
    modelCalls: run.calls,
    rejectedReviews: run.repairCalls,
    targetedRepairCalls: run.targetedRepairCalls,
    required: run.plan.counts.required,
    recommended: run.plan.counts.recommended,
    optional: run.plan.counts.optional,
    noInteraction: run.plan.counts.nonInteractive,
  });
  return {
    learningUnits: run.plan.learningUnits,
    decisions: run.plan.decisions,
    teachingMedia: run.plan.teachingMedia,
    budget: run.plan.budget,
    overrides: packet.overrides,
    reviewCalls: run.calls,
    rejectedReviews: run.repairCalls,
    decisionRecords: run.plan.decisionRecords,
    zeroVisualSafeguard: run.plan.zeroVisualSafeguard,
    unresolvedRecords: [],
  };
}

/**
 * Make exactly one authoritative planning request. A timeout, reset, broken
 * pipe, partial response, or comparable transport loss is ambiguous: the
 * provider may still have completed the request after this process stopped
 * observing it. Issuing the same request again could create two conflicting
 * planning outcomes, so record the exact cause graph and fail closed. Semantic
 * repairs remain separate calls made only after an invalid candidate was
 * actually returned and validated below.
 */
async function callPlanningJsonOnce({
  client,
  model,
  taskType,
  gardenId,
  system,
  user,
  sourceContext,
  contentPath,
  jobId,
  stageKey,
  stageLabel,
  semanticAttempt,
  preserveExactContent = false,
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  system: string;
  user: string;
  sourceContext: unknown;
  contentPath: string;
  jobId: string;
  stageKey: string;
  stageLabel: string;
  semanticAttempt: number;
  preserveExactContent?: boolean;
}): Promise<CouncilJsonResult> {
  try {
    return await callCouncilJson({
      client,
      model,
      taskType,
      gardenId,
      system,
      user,
      sourceContext,
      councilModeOverride: LEARN_PLANNING_COUNCIL_MODE,
      timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
      preserveExactContent,
      planningCheckpoint: {
        jobId,
        contentPath,
        stageKey,
        stageLabel,
        semanticAttempt,
      },
    });
  } catch (error) {
    if (
      isLearnCancellationWithoutMaskingFailure(jobId, error) ||
      !isAmbiguousModelTransportFailure(error)
    ) {
      throw error;
    }
    try {
      appendLearnEvent(contentPath, gardenId, "learn_planning_transport_ambiguous", {
        jobId,
        taskType,
        stageKey,
        stageLabel,
        semanticAttempt,
        error: errorMessage(error),
        transportFailure: modelTransportFailureEvidence(error),
        councilMode: LEARN_PLANNING_COUNCIL_MODE,
        retryIssued: false,
      });
    } catch {
      // Durable ambiguity telemetry is best-effort and cannot replace the
      // exact provider object that terminated the authoritative request.
    }
    throw error;
  }
}

function assertNonemptyPlanningCandidate(
  result: CouncilJsonResult,
  stageLabel: string,
): void {
  const exactCandidate = stripMarkdownFence(result.content).trim();
  if (
    !exactCandidate ||
    result.parsed === undefined ||
    (result.parsed === null && exactCandidate === "null")
  ) {
    throw new Error(
      `${stageLabel} returned no usable nonempty candidate; no semantic repair request was issued.`,
    );
  }
}

async function callValidatedPlanningJson({
  client,
  model,
  taskType,
  gardenId,
  system,
  user,
  sourceContext,
  contentPath,
  jobId,
  stageKey,
  stageLabel,
  validate,
  preserveExactContent = false,
}: {
  client: OpenAI;
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  system: string;
  user: string;
  sourceContext: unknown;
  contentPath: string;
  jobId: string;
  stageKey: string;
  stageLabel: string;
  validate: (value: unknown) => string[];
  preserveExactContent?: boolean;
}): Promise<CouncilJsonResult> {
  const originalRequest = parseJsonCandidate(user) ?? user;
  let result = await callPlanningJsonOnce({
    client,
    model,
    taskType,
    gardenId,
    system,
    user,
    sourceContext,
    contentPath,
    jobId,
    stageKey,
    stageLabel,
    semanticAttempt: 0,
    preserveExactContent,
  });
  assertNonemptyPlanningCandidate(result, stageLabel);
  let problems = validate(result.parsed);
  for (let repairAttempt = 1; repairAttempt <= 2 && problems.length > 0; repairAttempt += 1) {
    throwIfLearnCancelled(jobId);
    const invalidResponse = result.parsed ?? {
      unparsedResponse: result.content.slice(0, 12_000),
    };
    result = await dispatchAfterDurablePlanningIssuance({
      persist: () => appendDurablePlanningIssuanceEvent({
        contentPath,
        gardenId,
        type: "learn_planning_schema_repair_started",
        at: nowIso(),
        data: {
          jobId,
          taskType,
          stageKey,
          stageLabel,
          repairAttempt,
          problems,
        },
      }),
      dispatch: () => callPlanningJsonOnce({
        client,
        model,
        taskType,
        gardenId,
        system:
          `${system}\n\nYour previous ${stageLabel} response failed the supplied hard validation problems. ` +
          "Return a complete corrected replacement JSON object. Do not explain, patch, omit required entries, or rely on code to fill anything in.",
        user: compactJson({
          originalRequest,
          invalidResponse,
          validationProblems: problems,
          repairAttempt,
        }),
        sourceContext: {
          gardenId,
          taskType,
          stageLabel,
          repairAttempt,
        },
        contentPath,
        jobId,
        stageKey,
        stageLabel,
        semanticAttempt: repairAttempt,
        preserveExactContent,
      }),
    });
    assertNonemptyPlanningCandidate(result, stageLabel);
    problems = validate(result.parsed);
    try {
      appendLearnEvent(contentPath, gardenId, "learn_planning_schema_repair_reviewed", {
        jobId,
        taskType,
        stageLabel,
        repairAttempt,
        remainingProblems: problems,
      });
    } catch {
      // Review telemetry cannot replace an accepted or rejected model result.
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `${stageLabel} remained invalid after 3 bounded AI-authored attempts: ${problems.join("; ")}. No deterministic fallback was used.`,
    );
  }
  return result;
}

function modelTextCandidateOrThrow(
  rawContent: string,
  terminalMessage: string,
): string {
  const trimmed = rawContent.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const normalizedCandidate = (fenced?.[1] ?? trimmed).trim();
  if (!normalizedCandidate || normalizedCandidate === "null") {
    throw new Error(
      normalizedCandidate === "null"
        ? `${terminalMessage} The provider returned literal JSON null.`
        : terminalMessage,
    );
  }
  const candidate = cleanCouncilMarkdown(rawContent, "").trim();
  if (!candidate || candidate === "null") throw new Error(terminalMessage);
  return candidate;
}

/** Run a bounded text repair sequence without ever treating a thrown request,
 * an empty response, or unknown evidence as permission for another model call.
 * A later call is reachable only after a nonempty returned candidate has been
 * checked and produced one or more concrete semantic problems. */
async function runValidatedTextRepairLoop<TProblem>({
  maxAttempts,
  request,
  validate,
  emptyResponseMessage,
  onReviewed,
}: {
  maxAttempts: number;
  request: (input: {
    attempt: number;
    previousMarkdown: string;
    failedProblems: readonly TProblem[];
  }) => Promise<string>;
  validate: (markdown: string, attempt: number) => {
    markdown: string;
    problems: TProblem[];
  };
  emptyResponseMessage: string;
  onReviewed?: (input: {
    attempt: number;
    markdown: string;
    problems: readonly TProblem[];
  }) => void;
}): Promise<{
  markdown: string | null;
  lastMarkdown: string;
  problems: TProblem[];
}> {
  const boundedAttempts = Math.max(1, Math.floor(maxAttempts));
  let previousMarkdown = "";
  let failedProblems: TProblem[] = [];

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    if (attempt > 1 && (!previousMarkdown || failedProblems.length === 0)) {
      throw new Error(
        "Validated text repair cannot call the model without a nonempty rejected candidate and concrete problems.",
      );
    }
    const rawContent = await request({
      attempt,
      previousMarkdown,
      failedProblems: [...failedProblems],
    });
    const candidate = modelTextCandidateOrThrow(rawContent, emptyResponseMessage);

    const reviewed = validate(candidate, attempt);
    const problems = [...reviewed.problems];
    try {
      onReviewed?.({ attempt, markdown: candidate, problems });
    } catch {
      // Review telemetry is subordinate to the accepted/rejected model draft.
    }
    if (problems.length === 0) {
      const accepted = reviewed.markdown.trim();
      if (!accepted) throw new Error(emptyResponseMessage);
      return { markdown: accepted, lastMarkdown: candidate, problems: [] };
    }
    previousMarkdown = candidate;
    failedProblems = problems;
  }

  return {
    markdown: null,
    lastMarkdown: previousMarkdown,
    problems: failedProblems,
  };
}

type CouncilCompletionRequest = Record<string, unknown> & {
  model: string;
  messages: Array<{ role: string; content: string }>;
  reasoning: { effort: string; summary: string };
  taskType?: CouncilTaskType;
  gardenId?: string;
  pageId?: string;
  sourceContext?: unknown;
  councilModeOverride?: CouncilMode;
};

function buildCouncilCompletionRequest({
  model,
  taskType,
  gardenId,
  pageId,
  system,
  user,
  sourceContext,
  councilModeOverride,
}: {
  model: string;
  taskType: CouncilTaskType;
  gardenId: string;
  pageId?: string;
  system: string;
  user: string;
  sourceContext: unknown;
  councilModeOverride?: CouncilMode;
}): CouncilCompletionRequest {
  return withCouncil(
    {
      model,
      reasoning: LEARN_REASONING,
      messages: [
        { role: "system" as const, content: system },
        { role: "user" as const, content: user },
      ],
    },
    {
      taskType,
      gardenId,
      pageId,
      sourceContext,
      councilModeOverride,
    },
  ) as CouncilCompletionRequest;
}

function recoverablePlanningEnvelope(
  request: CouncilCompletionRequest,
): CouncilRequestEnvelopeV1 {
  const model = request.model;
  const reasoning = request.reasoning;
  const mode = request.councilModeOverride;
  if (!mode) {
    throw new LearnPlanningRecoveryConflictError(
      "Recoverable Learn planning requires an explicit Council mode.",
    );
  }
  const messages = withResolvedCouncilIdentityV1(request.messages, model, "chatgpt");
  return {
    schemaVersion: 1,
    messages,
    taskType: request.taskType ?? null,
    gardenId: request.gardenId ?? null,
    pageId: request.pageId ?? null,
    sourceContext: request.sourceContext ?? null,
    councilMode: mode,
    requestedModel: model,
    resolvedModel: model,
    reasoning: {
      effort: reasoning.effort,
      summary: reasoning.summary,
    },
    temperature:
      typeof request.temperature === "number" ? request.temperature : null,
    maxTokens:
      typeof request.max_tokens === "number"
        ? request.max_tokens
        : typeof request.max_completion_tokens === "number"
          ? request.max_completion_tokens
          : null,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function modelHttpStatus(error: unknown): number | null {
  let cursor: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && cursor && !seen.has(cursor); depth += 1) {
    seen.add(cursor);
    const record = recordValue(cursor);
    if (!record) return null;
    for (const key of ["status", "statusCode", "httpStatus"]) {
      const value = record[key];
      if (typeof value === "number" && Number.isInteger(value)) return value;
    }
    cursor = record.cause;
  }
  return null;
}

function learnEventsForJob(
  contentPath: string,
  gardenId: string,
  jobId: string,
): { events: Array<Record<string, unknown>>; malformed: boolean } {
  const eventsPath = path.join(clusterPath(contentPath, gardenId), ".breadboard", "events.jsonl");
  let lines: string[];
  try {
    lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/);
  } catch {
    return { events: [], malformed: true };
  }
  const events: Array<Record<string, unknown>> = [];
  let malformed = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = recordValue(JSON.parse(line));
      if (!event) {
        malformed = true;
      } else if (event.jobId === jobId) {
        events.push(event);
      }
    } catch {
      malformed = true;
    }
  }
  return { events, malformed };
}

function eventTime(event: Record<string, unknown>): number | null {
  for (const key of ["timestamp", "at"]) {
    const value = event[key];
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function exactStringArrayJson(value: string | null): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function exactPlanningOriginBinding(
  origin: PriorPlanningCheckpointRow | PriorRecoveredPlanningJobRow,
  current: LearnJobRow,
): boolean {
  const originSourceIds = exactStringArrayJson(origin.job_source_ids_json);
  const currentSourceIds = exactStringArrayJson(current.source_ids_json);
  const originCreatedAt = Date.parse(origin.job_created_at);
  const originUpdatedAt = Date.parse(origin.job_updated_at);
  const currentCreatedAt = Date.parse(current.created_at);
  if (
    origin.job_status !== "failed" ||
    origin.map_count !== 0 ||
    origin.version_count !== 0 ||
    origin.garden_id !== current.garden_id ||
    origin.job_garden_id !== current.garden_id ||
    origin.job_user_id !== current.user_id ||
    origin.job_model !== current.model ||
    typeof origin.job_source_set_hash !== "string" ||
    !origin.job_source_set_hash ||
    typeof current.source_set_hash !== "string" ||
    !current.source_set_hash ||
    origin.job_source_set_hash !== current.source_set_hash ||
    originSourceIds === null ||
    currentSourceIds === null ||
    originSourceIds !== currentSourceIds ||
    origin.job_syllabus_source_id !== current.syllabus_source_id ||
    Number(origin.job_source_only ?? 0) !== Number(current.source_only ?? 0) ||
    Number(origin.job_include_source_snapshots ?? 0) !==
      Number(current.include_source_snapshots ?? 0) ||
    origin.request_model !== current.model ||
    origin.reasoning_effort !== LEARN_REASONING.effort ||
    origin.reasoning_summary !== LEARN_REASONING.summary ||
    Number(origin.policy_mismatch_requests ?? 0) !== 0 ||
    Number(origin.policy_observed_requests ?? 0) <= 0 ||
    Number(origin.policy_observed_requests ?? 0) !== Number(origin.started_requests ?? 0) ||
    Number(origin.policy_observed_requests ?? 0) !== Number(origin.completed_requests ?? 0) ||
    !Number.isFinite(originCreatedAt) ||
    !Number.isFinite(originUpdatedAt) ||
    !Number.isFinite(currentCreatedAt) ||
    originCreatedAt > originUpdatedAt ||
    originUpdatedAt > currentCreatedAt
  ) {
    return false;
  }
  return true;
}

function legacyPlanningWaiverBinding(
  origin: PriorPlanningCheckpointRow | PriorRecoveredPlanningJobRow,
  recoveredAt: string,
): LegacyPlanningWaiverBinding {
  const sourceIds = JSON.parse(origin.job_source_ids_json ?? "null") as unknown;
  if (!Array.isArray(sourceIds) || !sourceIds.every((entry) => typeof entry === "string")) {
    throw new LearnPlanningRecoveryConflictError(
      "The abandoned job cannot produce an exact legacy waiver binding.",
    );
  }
  return {
    originJobId: origin.job_id,
    gardenId: origin.garden_id,
    userId: origin.job_user_id,
    model: origin.job_model!,
    sourceSetHash: origin.job_source_set_hash!,
    sourceIds,
    syllabusSourceId: origin.job_syllabus_source_id,
    sourceOnly: Boolean(origin.job_source_only),
    includeSourceSnapshots: Boolean(origin.job_include_source_snapshots),
    jobCreatedAt: origin.job_created_at,
    recoveredAt,
    startedRequests: Number(origin.started_requests),
    completedRequests: Number(origin.completed_requests),
    policyObservedRequests: Number(origin.policy_observed_requests),
  };
}

function exactAbandonedPlanningRecoveryLineage(
  origin: PriorPlanningCheckpointRow | PriorRecoveredPlanningJobRow,
  current: LearnJobRow,
  contentPath: string,
): {
  recoveredAt?: string;
  events: Array<Record<string, unknown>>;
  malformedEvents: boolean;
} | null {
  if (
    origin.job_current_step !== "Unresponsive Learn worker recovered; prior Learn state restored" ||
    origin.job_error !==
      "Learn stopped responding before completion. Your garden was restored and is safe to retry."
  ) {
    return null;
  }
  const eventLedger = learnEventsForJob(contentPath, current.garden_id, origin.job_id);
  const events = eventLedger.events;
  const createdAt = Date.parse(origin.job_created_at);
  const updatedAt = Date.parse(origin.job_updated_at);
  const currentCreatedAt = Date.parse(current.created_at);
  const recoveryEvents = events.filter(
    (event) => event.type === "learn_abandoned_job_recovered",
  );
  const validRecoveryEvents = recoveryEvents.filter((event) => {
    const at = eventTime(event);
    return (
      at !== null &&
      Number.isFinite(createdAt) &&
      Number.isFinite(updatedAt) &&
      Number.isFinite(currentCreatedAt) &&
      createdAt <= updatedAt &&
      at >= updatedAt &&
      at - updatedAt <= 5 * 60_000 &&
      at <= currentCreatedAt
    );
  });
  const recoveredAt =
    recoveryEvents.length === 1 && validRecoveryEvents.length === 1
      ? eventTime(validRecoveryEvents[0])
      : null;
  return {
    ...(recoveredAt === null ? {} : { recoveredAt: new Date(recoveredAt).toISOString() }),
    events,
    malformedEvents:
      eventLedger.malformed ||
      recoveryEvents.length > 1 ||
      (recoveryEvents.length === 1 && validRecoveryEvents.length !== 1),
  };
}

function chatMockInternalUrl(client: OpenAI, pathname: string): URL {
  const baseURL = (client as unknown as { baseURL?: unknown }).baseURL;
  try {
    return strictChatMockInternalRecoveryUrl(baseURL, pathname);
  } catch (error) {
    throw new LearnPlanningRecoveryConflictError(
      `ChatMock URL is unsafe for durable Learn result recovery: ${errorMessage(error)}`,
    );
  }
}

function parsePromptlessCouncilRecoveryResult(
  value: unknown,
): PromptlessCouncilRecoveryResult {
  const result = recordValue(value);
  const finalAnswer = result?.finalAnswer;
  const councilRunId = result?.councilRunId;
  const responseHash = result?.responseHash;
  const createdAt = result?.createdAt;
  const updatedAt = result?.updatedAt;
  const modelRouting = Array.isArray(result?.modelRouting)
    ? result.modelRouting
        .map(recordValue)
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const usageRecord = recordValue(result?.usage);
  const usageEstimated = result?.usageEstimated;
  const inputTokens = usageRecord?.inputTokens;
  const outputTokens = usageRecord?.outputTokens;
  const totalTokens = usageRecord?.totalTokens;
  const cachedInputTokens = usageRecord?.cachedInputTokens;
  const reasoningTokens = usageRecord?.reasoningTokens;
  const callCount = usageRecord?.callCount;
  const reportedCallCount = usageRecord?.reportedCallCount;
  if (
    typeof finalAnswer !== "string" ||
    !finalAnswer.trim() ||
    typeof councilRunId !== "string" ||
    !councilRunId ||
    typeof responseHash !== "string" ||
    responseHash !== createHash("sha256").update(finalAnswer, "utf8").digest("hex") ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string" ||
    (usageEstimated !== undefined && typeof usageEstimated !== "boolean") ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    Date.parse(createdAt) > Date.parse(updatedAt) ||
    ![
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens,
      reasoningTokens,
      callCount,
      reportedCallCount,
    ].every((entry) => Number.isSafeInteger(entry) && Number(entry) >= 0) ||
    Number(totalTokens) < Number(inputTokens) + Number(outputTokens) ||
    Number(cachedInputTokens) > Number(inputTokens) ||
    Number(reasoningTokens) > Number(outputTokens) ||
    Number(reportedCallCount) > Number(callCount)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Durable Council result resolution returned an invalid result binding.",
    );
  }
  return {
    councilRunId,
    finalAnswer,
    responseHash,
    modelRouting,
    ...(typeof usageEstimated === "boolean" ? { usageEstimated } : {}),
    createdAt,
    updatedAt,
    usage: {
      inputTokens: Number(inputTokens),
      outputTokens: Number(outputTokens),
      totalTokens: Number(totalTokens),
      cachedInputTokens: Number(cachedInputTokens),
      reasoningTokens: Number(reasoningTokens),
      callCount: Number(callCount),
      reportedCallCount: Number(reportedCallCount),
    },
    ...(typeof result?.councilMode === "string"
      ? { councilMode: result.councilMode }
      : {}),
    ...(typeof result?.requestedModel === "string"
      ? { requestedModel: result.requestedModel }
      : {}),
    ...(typeof result?.resolvedModel === "string"
      ? { resolvedModel: result.resolvedModel }
      : {}),
  };
}

async function promptlessCouncilResultGet(
  client: OpenAI,
  pathname: string,
  query: Record<string, string>,
): Promise<{
  status: number;
  code?: string;
  result?: PromptlessCouncilRecoveryResult;
  receipt?: StrictCouncilReceiptMetadata;
}> {
  const url = chatMockInternalUrl(client, pathname);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new LearnCouncilResultObservationTransportError(
      `Durable Council result resolution could not be observed: ${errorMessage(error)}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LearnPlanningRecoveryConflictError(
      `Durable Council result resolution returned non-JSON HTTP ${response.status}.`,
    );
  }
  const record = recordValue(body);
  const error = recordValue(record?.error);
  const result = recordValue(record?.result);
  const receipt = recordValue(record?.receipt);
  const dispatchGeneration = receipt?.dispatchGeneration;
  const dispatchCount = receipt?.dispatchCount;
  const redispatchCount = receipt?.redispatchCount;
  const redispatchAllowed = receipt?.redispatchAllowed;
  const failureCode = receipt?.failureCode;
  const strictMetadataScalars =
    Number.isSafeInteger(dispatchGeneration) &&
    (dispatchGeneration === 1 || dispatchGeneration === 2) &&
    Number.isSafeInteger(dispatchCount) &&
    (dispatchCount === 1 || dispatchCount === 2) &&
    dispatchGeneration === dispatchCount &&
    Number.isSafeInteger(redispatchCount) &&
    (redispatchCount === 0 || redispatchCount === 1) &&
    Number(redispatchCount) === Number(dispatchCount) - 1 &&
    typeof redispatchAllowed === "boolean";
  let strictReceiptMetadata: StrictCouncilReceiptMetadata | undefined;
  if (strictMetadataScalars) {
    const receiptState = record?.state;
    if (
      receiptState !== "started" &&
      receiptState !== "failed" &&
      receiptState !== "completed"
    ) {
      throw new LearnPlanningRecoveryConflictError(
        "Durable Council receipt metadata has no exact terminal state.",
      );
    }
    try {
      strictReceiptMetadata = {
        dispatchGeneration: Number(dispatchGeneration),
        dispatchCount: Number(dispatchCount),
        redispatchCount: Number(redispatchCount),
        redispatchAllowed: Boolean(redispatchAllowed),
        attempts: parseLearnCouncilReceiptAttempts(
          receipt?.attempts,
          Number(dispatchCount) as 1 | 2,
          receiptState,
        ),
        ...(typeof failureCode === "string" && failureCode
          ? { failureCode }
          : {}),
      };
    } catch (parseError) {
      throw new LearnPlanningRecoveryConflictError(
        `Durable Council receipt attempt accounting is invalid: ${errorMessage(parseError)}`,
      );
    }
  }
  if (!response.ok || !result) {
    return {
      status: response.status,
      ...(typeof error?.code === "string" ? { code: error.code } : {}),
      ...(strictReceiptMetadata ? { receipt: strictReceiptMetadata } : {}),
    };
  }
  const parsedResult = parsePromptlessCouncilRecoveryResult(result);
  return {
    status: response.status,
    result: parsedResult,
    ...(strictReceiptMetadata ? { receipt: strictReceiptMetadata } : {}),
  };
}

async function observeOrdinaryCouncilReceipt(input: {
  client: OpenAI;
  jobId: string;
  gardenId: string;
  requestId: string;
  requestHash: string;
  observationTimeoutMs: number;
}): Promise<Awaited<ReturnType<typeof promptlessCouncilResultGet>>> {
  const deadline = Date.now() + Math.max(1, input.observationTimeoutMs);
  for (;;) {
    assertExactOrdinaryCouncilAuthority(input.jobId, input.gardenId);
    let lookup: Awaited<ReturnType<typeof promptlessCouncilResultGet>>;
    try {
      lookup = await promptlessCouncilResultGet(
        input.client,
        "/internal/council-results/resolve",
        { requestId: input.requestId, requestHash: input.requestHash },
      );
    } catch (error) {
      assertExactOrdinaryCouncilAuthority(input.jobId, input.gardenId);
      if (
        !(error instanceof LearnCouncilResultObservationTransportError) ||
        Date.now() >= deadline
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
      );
      continue;
    }
    assertExactOrdinaryCouncilAuthority(input.jobId, input.gardenId);
    if (
      lookup.status !== 409 ||
      lookup.code !== "request_started" ||
      Date.now() >= deadline
    ) {
      return lookup;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
    );
    assertExactOrdinaryCouncilAuthority(input.jobId, input.gardenId);
  }
}

function learnCouncilDispatchStartedAt(
  source: LearnCouncilCheckpointRow,
): string {
  if (source.receipt_request_id) {
    const owner = learnCouncilDispatchGenerationOwners(
      db,
      source.receipt_request_id,
    ).find(
      (candidate) =>
        Number(candidate.dispatch_generation) === source.dispatch_attempt_count,
    );
    if (owner && Number.isFinite(Date.parse(owner.claimed_at))) {
      return owner.claimed_at;
    }
  }
  return Number.isFinite(Date.parse(source.updated_at))
    ? source.updated_at
    : source.created_at;
}

async function observeOrdinaryCouncilCheckpointReceipt(input: {
  client: OpenAI;
  jobId: string;
  gardenId: string;
  source: LearnCouncilCheckpointRow;
  requestHash: string;
  observationTimeoutMs: number;
}): Promise<Awaited<ReturnType<typeof promptlessCouncilResultGet>>> {
  if (!input.source.receipt_request_id) {
    throw new LearnPlanningRecoveryConflictError(
      "Started ordinary Learn checkpoint has no strict receipt id.",
    );
  }
  const startedAtMs = Date.parse(learnCouncilDispatchStartedAt(input.source));
  const remainingLifetimeMs = Number.isFinite(startedAtMs)
    ? startedAtMs + LEARN_COUNCIL_STARTED_RECEIPT_MAX_AGE_MS - Date.now()
    : input.observationTimeoutMs;
  if (remainingLifetimeMs <= 0) {
    assertExactOrdinaryCouncilAuthority(input.jobId, input.gardenId);
    const lookup = await promptlessCouncilResultGet(
      input.client,
      "/internal/council-results/resolve",
      {
        requestId: input.source.receipt_request_id,
        requestHash: input.requestHash,
      },
    );
    assertExactOrdinaryCouncilAuthority(input.jobId, input.gardenId);
    return lookup;
  }
  return observeOrdinaryCouncilReceipt({
    client: input.client,
    jobId: input.jobId,
    gardenId: input.gardenId,
    requestId: input.source.receipt_request_id,
    requestHash: input.requestHash,
    observationTimeoutMs: Math.max(
      1,
      Math.min(input.observationTimeoutMs, remainingLifetimeMs),
    ),
  });
}

function expiredStartedOrdinaryCouncilReceiptError(input: {
  source: LearnCouncilCheckpointRow;
  requestHash: string;
  lookup: Awaited<ReturnType<typeof promptlessCouncilResultGet>>;
}): LearnCouncilExpiredStartedReceiptError | null {
  if (
    input.lookup.status !== 409 ||
    input.lookup.code !== "request_started" ||
    !input.lookup.receipt ||
    !input.source.receipt_request_id
  ) {
    return null;
  }
  const proof = expiredStartedLearnCouncilReceiptProof({
    requestId: input.source.receipt_request_id,
    requestHash: input.requestHash,
    dispatchGeneration: input.lookup.receipt.dispatchGeneration,
    dispatchCount: input.lookup.receipt.dispatchCount,
    redispatchCount: input.lookup.receipt.redispatchCount,
    redispatchAllowed: input.lookup.receipt.redispatchAllowed,
    attemptCount: input.lookup.receipt.attempts.length,
    checkpointDispatchCount: input.source.dispatch_attempt_count,
    checkpointRedispatchCount: input.source.redispatch_count,
    startedAt: learnCouncilDispatchStartedAt(input.source),
    observedAt: nowIso(),
    maxStartedAgeMs: LEARN_COUNCIL_STARTED_RECEIPT_MAX_AGE_MS,
  });
  return proof ? new LearnCouncilExpiredStartedReceiptError(proof) : null;
}

const LEARN_LEGACY_COUNCIL_OUTCOME_OBSERVATION_TIMEOUT_MS = 60_000;
const LEARN_LEGACY_COUNCIL_OUTCOME_OBSERVATION_MAX_ATTEMPTS = 3;

async function promptlessLegacyCouncilOutcomeGet(
  client: OpenAI,
  query: {
    requestHash: string;
    createdAfter: string;
    createdBefore: string;
    reasoningEffort: string;
    reasoningSummary: string;
  },
): Promise<{
  status: number;
  code?: string;
  state?: "completed" | "failed";
  result?: PromptlessCouncilRecoveryResult;
  failure?: LegacyCouncilFailureOutcome;
}> {
  const url = chatMockInternalUrl(
    client,
    "/internal/council-results/legacy-outcome",
  );
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  let response: Response | undefined;
  let lastObservationError: unknown;
  // This prompt-free lookup is read-only and idempotent. Under concurrent
  // Council load the legacy ledger scan can legitimately exceed ten seconds;
  // failing the entire Learn run at that point turns a safe duplicate guard
  // into a false terminal error. Retry only the observation (never the model
  // request), with a finite per-attempt deadline and bounded backoff.
  for (
    let attempt = 1;
    attempt <= LEARN_LEGACY_COUNCIL_OUTCOME_OBSERVATION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(
          LEARN_LEGACY_COUNCIL_OUTCOME_OBSERVATION_TIMEOUT_MS,
        ),
      });
      break;
    } catch (error) {
      lastObservationError = error;
      if (
        attempt < LEARN_LEGACY_COUNCIL_OUTCOME_OBSERVATION_MAX_ATTEMPTS
      ) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  if (!response) {
    throw new LearnPlanningRecoveryConflictError(
      `Legacy Council outcome resolution could not be observed after ${LEARN_LEGACY_COUNCIL_OUTCOME_OBSERVATION_MAX_ATTEMPTS} bounded attempts: ${errorMessage(lastObservationError)}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LearnPlanningRecoveryConflictError(
      `Legacy Council outcome resolution returned non-JSON HTTP ${response.status}.`,
    );
  }
  const record = recordValue(body);
  const error = recordValue(record?.error);
  if (!response.ok) {
    return {
      status: response.status,
      ...(typeof error?.code === "string" ? { code: error.code } : {}),
    };
  }
  if (record?.legacy !== true || (record.state !== "completed" && record.state !== "failed")) {
    throw new LearnPlanningRecoveryConflictError(
      "Legacy Council outcome resolution returned an invalid envelope.",
    );
  }
  if (record.state === "completed") {
    return {
      status: response.status,
      state: "completed",
      result: parsePromptlessCouncilRecoveryResult(record.result),
    };
  }
  const failure = recordValue(record.failure);
  if (!isExactLegacyLearnCouncilFailureShape(record.failure)) {
    throw new LearnPlanningRecoveryConflictError(
      "Legacy Council outcome resolution returned an invalid failure proof.",
    );
  }
  const usage = recordValue(failure?.usage);
  const rawModelRouting = failure?.modelRouting;
  const modelRoutingValid =
    Array.isArray(rawModelRouting) &&
    rawModelRouting.every((entry) => recordValue(entry) !== null);
  const modelRouting = modelRoutingValid
    ? rawModelRouting.map((entry) => recordValue(entry)!)
    : [];
  const failurePhase = failure?.failurePhase;
  const partialOutput = failure?.partialOutput;
  const replaySafe = failure?.replaySafe;
  const parsed: LegacyCouncilFailureOutcome = {
    outcome: "failed",
    councilRunId: typeof failure?.councilRunId === "string"
      ? failure.councilRunId
      : "",
    finalAnswerPresent: false,
    candidateCount: 0,
    failureCode: typeof failure?.failureCode === "string"
      ? failure.failureCode
      : "",
    failurePhase: typeof failurePhase === "string" ? failurePhase : null,
    partialOutput: typeof partialOutput === "boolean" ? partialOutput : null,
    replaySafe: typeof replaySafe === "boolean" ? replaySafe : null,
    councilMode: typeof failure?.councilMode === "string"
      ? failure.councilMode
      : "",
    requestedModel: typeof failure?.requestedModel === "string"
      ? failure.requestedModel
      : "",
    resolvedModel: typeof failure?.resolvedModel === "string"
      ? failure.resolvedModel
      : "",
    callCount: typeof usage?.callCount === "number" ? usage.callCount : Number.NaN,
    reportedCallCount:
      typeof usage?.reportedCallCount === "number"
        ? usage.reportedCallCount
        : Number.NaN,
    modelRouting,
    createdAt: typeof failure?.createdAt === "string" ? failure.createdAt : "",
    updatedAt: typeof failure?.updatedAt === "string" ? failure.updatedAt : "",
  };
  if (
    failure?.outcome !== "failed" ||
    failure?.finalAnswerPresent !== false ||
    failure?.candidateCount !== 0 ||
    !modelRoutingValid ||
    !(
      failurePhase === null ||
      typeof failurePhase === "string"
    ) ||
    !(partialOutput === null || typeof partialOutput === "boolean") ||
    !(replaySafe === null || typeof replaySafe === "boolean") ||
    !parsed.councilRunId ||
    !parsed.failureCode ||
    !parsed.councilMode ||
    !parsed.requestedModel ||
    !parsed.resolvedModel ||
    !Number.isSafeInteger(parsed.callCount) ||
    parsed.callCount < 0 ||
    !Number.isSafeInteger(parsed.reportedCallCount) ||
    parsed.reportedCallCount < 0 ||
    parsed.reportedCallCount > parsed.callCount ||
    !Number.isFinite(Date.parse(parsed.createdAt)) ||
    !Number.isFinite(Date.parse(parsed.updatedAt)) ||
    Date.parse(parsed.createdAt) > Date.parse(parsed.updatedAt)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Legacy Council outcome resolution returned an invalid failure proof.",
    );
  }
  return { status: response.status, state: "failed", failure: parsed };
}

function assertCouncilOutcomeInsideJob(
  result: { createdAt: string; updatedAt: string },
  job: { created_at: string; updated_at: string },
): void {
  const createdAt = Date.parse(result.createdAt);
  const updatedAt = Date.parse(result.updatedAt);
  const jobCreatedAt = Date.parse(job.created_at);
  const jobUpdatedAt = Date.parse(job.updated_at);
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(jobCreatedAt) ||
    !Number.isFinite(jobUpdatedAt) ||
    createdAt < jobCreatedAt ||
    updatedAt > jobUpdatedAt ||
    createdAt > updatedAt
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Council outcome timestamps escape their exact Learn job fence.",
    );
  }
}

function assertExactOrdinaryCouncilResult(
  result: PromptlessCouncilRecoveryResult,
  expectedModel: string,
): void {
  if (!planningReceiptProvesOneExactModelCall(result, expectedModel)) {
    throw new LearnPlanningRecoveryConflictError(
      "Recovered ordinary Learn Council result does not prove one exact successful non-fallback direct-model call.",
    );
  }
}

function assertExactLegacyCouncilFailure(
  failure: LegacyCouncilFailureOutcome,
  expectedModel: string,
): void {
  const expected = expectedStrictLearnModelRoute(expectedModel);
  if (
    !expected ||
    failure.councilMode !== "direct_council" ||
    failure.requestedModel !== expected.requestedModel ||
    failure.resolvedModel !== expected.resolvedModel ||
    failure.finalAnswerPresent !== false ||
    failure.candidateCount !== 0 ||
    failure.callCount !== 1 ||
    (failure.reportedCallCount !== 0 && failure.reportedCallCount !== 1) ||
    failure.modelRouting.length !== 1 ||
    failure.modelRouting.some((route) =>
      route.endpoint !== "council" ||
      route.requestedModel !== expected.requestedModel ||
      route.resolvedModel !== expected.resolvedModel ||
      route.provider !== expected.provider ||
      route.upstreamModel !== expected.upstreamModel ||
      route.fallback !== false ||
      route.requestId !== failure.councilRunId ||
      route.outcome !== "failed")
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Legacy ordinary Learn Council failure does not prove an exact non-fallback no-result call.",
    );
  }
}

function reconcileOrdinaryCouncilUsage(input: {
  jobId: string;
  accountingId: string;
  lifecycleRequestId?: string;
  requestHash: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
  };
  providerCallCount: 1 | 2;
  reportedCallCount: 0 | 1 | 2;
  estimatedCallCount: 0 | 1 | 2;
  model: string;
  dispatchCount: 0 | 1 | 2;
  httpCompletionObserved: boolean;
}): void {
  reconcilePersistedLearnTokenUsageFromReceipt(
    db,
    input.jobId,
    {
      receiptId: input.accountingId,
      requestHash: input.requestHash,
      usage: input.usage,
      providerCallCount: input.providerCallCount,
      reportedCallCount: input.reportedCallCount,
      estimatedCallCount: input.estimatedCallCount,
      dispatchCount: input.dispatchCount,
      httpCompletionObserved: input.httpCompletionObserved,
      ...(input.lifecycleRequestId
        ? { lifecycleRequestId: input.lifecycleRequestId }
        : {}),
      requestEvidence: {
        model: input.model,
        reasoningEffort: LEARN_REASONING.effort,
        reasoningSummary: LEARN_REASONING.summary,
      },
    },
    nowIso(),
  );
}

function ordinaryGenerationAccountingId(
  receiptRequestId: string,
  ownerJobId: string,
  generations: readonly number[],
): string {
  return `lrga_${createHash("sha256")
    .update(JSON.stringify([receiptRequestId, ownerJobId, generations]), "utf8")
    .digest("hex")}`;
}

function assertCompletedReceiptAttemptMatchesResult(
  receipt: StrictCouncilReceiptMetadata,
  result: PromptlessCouncilRecoveryResult,
): void {
  const attempt = receipt.attempts.at(-1);
  if (!completedLearnCouncilReceiptAttemptMatchesResult(attempt, result)) {
    throw new LearnPlanningRecoveryConflictError(
      "The completed Council result conflicts with its per-generation receipt accounting.",
    );
  }
}

function reconcileOrdinaryCouncilReceiptAttempts(input: {
  receiptRequestId: string;
  requestHash: string;
  receipt: StrictCouncilReceiptMetadata;
  model: string;
  currentJobId: string;
  currentCheckpointId?: string;
  adoptFinalIntoCurrentJob: boolean;
  httpCompletionObserved: boolean;
  allowClaimedNextGeneration?: boolean;
}): void {
  const durableOwners = learnCouncilDispatchGenerationOwners(
    db,
    input.receiptRequestId,
  );
  if (
    !learnCouncilReceiptOwnerPrefixIsExact(
      durableOwners.map((owner) => Number(owner.dispatch_generation)),
      input.receipt.attempts.length,
      input.allowClaimedNextGeneration === true,
    ) ||
    durableOwners.some((owner) => owner.request_hash !== input.requestHash)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Council receipt attempts have no exact durable job-generation ownership.",
    );
  }
  const owners = durableOwners.slice(0, input.receipt.attempts.length);
  for (const attempt of input.receipt.attempts) {
    try {
      assertExactOrdinaryLearnCouncilReceiptAttempt(attempt, input.model);
    } catch (error) {
      throw new LearnPlanningRecoveryConflictError(errorMessage(error));
    }
  }

  const ownersByJob = new Map<string, LearnCouncilDispatchGenerationOwnerRow[]>();
  for (const owner of owners) {
    const rows = ownersByJob.get(owner.job_id) ?? [];
    rows.push(owner);
    ownersByJob.set(owner.job_id, rows);
  }
  for (const [ownerJobId, jobOwners] of ownersByJob) {
    const ownedAttempts = jobOwners.map((owner) => {
      const attempt = input.receipt.attempts[Number(owner.dispatch_generation) - 1];
      if (!attempt) {
        throw new LearnPlanningRecoveryConflictError(
          "Council receipt generation ownership references a missing attempt.",
        );
      }
      return attempt;
    });
    const accounting = sumLearnCouncilReceiptAttemptUsage(ownedAttempts);
    const generations = jobOwners.map((owner) => Number(owner.dispatch_generation));
    const ownsTerminalAttempt = generations.includes(input.receipt.dispatchCount);
    reconcileOrdinaryCouncilUsage({
      jobId: ownerJobId,
      accountingId: ordinaryGenerationAccountingId(
        input.receiptRequestId,
        ownerJobId,
        generations,
      ),
      lifecycleRequestId: input.receiptRequestId,
      requestHash: input.requestHash,
      usage: accounting.usage,
      providerCallCount: accounting.providerCallCount,
      reportedCallCount: accounting.reportedCallCount,
      estimatedCallCount: accounting.estimatedCallCount,
      model: input.model,
      dispatchCount: accounting.providerCallCount,
      httpCompletionObserved:
        ownerJobId === input.currentJobId &&
        ownsTerminalAttempt &&
        input.httpCompletionObserved,
    });
  }

  if (input.adoptFinalIntoCurrentJob && !ownersByJob.has(input.currentJobId)) {
    const finalAttempt = input.receipt.attempts.at(-1);
    if (!finalAttempt || !input.currentCheckpointId) {
      throw new LearnPlanningRecoveryConflictError(
        "Cross-job Council result adoption has no exact final-attempt alias.",
      );
    }
    const accounting = sumLearnCouncilReceiptAttemptUsage([finalAttempt]);
    reconcileOrdinaryCouncilUsage({
      jobId: input.currentJobId,
      accountingId: input.currentCheckpointId,
      requestHash: input.requestHash,
      usage: accounting.usage,
      providerCallCount: accounting.providerCallCount,
      reportedCallCount: accounting.reportedCallCount,
      estimatedCallCount: accounting.estimatedCallCount,
      model: input.model,
      dispatchCount: 0,
      httpCompletionObserved: false,
    });
  }
}

async function resolveCompletedOrdinaryReceipt(input: {
  client: OpenAI;
  model: string;
  source: LearnCouncilCheckpointRow;
  checkpoint: LearnOrdinaryRequestCheckpoint;
  preserveExactContent: boolean;
  /** HTTP POSTs observed by this invocation. The durable receipt remains the
   * authority for whether those reached Council generation 1 or 2. */
  executionDispatchCount: number;
  httpCompletionObserved: boolean;
  expectedHttpResult?: { councilRunId: string; responseHash: string };
}): Promise<CouncilCallResult> {
  const receiptRequestId = input.source.receipt_request_id;
  if (!receiptRequestId) {
    throw new LearnPlanningRecoveryConflictError(
      "Ordinary Learn receipt recovery has no strict request id.",
    );
  }
  const lookup = await observeOrdinaryCouncilReceipt({
    client: input.client,
    jobId: input.checkpoint.jobId,
    gardenId: input.source.garden_id,
    requestId: receiptRequestId,
    requestHash: input.source.request_hash,
    observationTimeoutMs: LEARN_PLANNING_TIMEOUT_MS,
  });
  if (
    lookup.status !== 200 ||
    !lookup.result ||
    !lookup.receipt ||
    lookup.receipt.dispatchGeneration !== lookup.receipt.dispatchCount
  ) {
    throw new LearnPlanningRecoveryConflictError(
      `The exact ordinary Learn Council receipt is not completed (${lookup.code ?? `HTTP ${lookup.status}`}).`,
    );
  }
  assertExactOrdinaryCouncilResult(lookup.result, input.model);
  assertCompletedReceiptAttemptMatchesResult(lookup.receipt, lookup.result);
  if (
    input.expectedHttpResult &&
    (input.expectedHttpResult.councilRunId !== lookup.result.councilRunId ||
      input.expectedHttpResult.responseHash !== lookup.result.responseHash)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "The ordinary Learn HTTP response conflicts with its durable Council receipt.",
    );
  }
  if (
    input.source.state === "completed" &&
    (input.source.council_run_id !== lookup.result.councilRunId ||
      input.source.response_hash !== lookup.result.responseHash ||
      input.source.receipt_dispatch_count !== lookup.receipt.dispatchCount)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "The local ordinary Learn checkpoint conflicts with its Council receipt.",
    );
  }
  const completedRows = completeLearnCouncilReceiptChain(db, {
    receiptRequestId,
    requestHash: input.source.request_hash,
    councilRunId: lookup.result.councilRunId,
    responseHash: lookup.result.responseHash,
    receiptDispatchCount: lookup.receipt.dispatchCount,
    now: nowIso(),
  });
  let current = completedRows.find(
    (row) => row.job_id === input.checkpoint.jobId,
  );
  if (!current) {
    const completedSource = completedRows.find(
      (row) => row.checkpoint_id === input.source.checkpoint_id,
    );
    if (!completedSource) {
      throw new LearnPlanningRecoveryConflictError(
        "Completed ordinary Learn receipt lost its source checkpoint.",
      );
    }
    current = adoptCompletedLearnCouncilCheckpoint(db, {
      checkpointId: makeId("lrqa"),
      source: completedSource,
      jobId: input.checkpoint.jobId,
      gardenId: input.source.garden_id,
      stageKey: input.checkpoint.stageKey,
      semanticAttempt: input.checkpoint.semanticAttempt,
      now: nowIso(),
    });
  }
  assertExactOrdinaryCouncilAuthority(
    input.checkpoint.jobId,
    input.source.garden_id,
  );
  reconcileOrdinaryCouncilReceiptAttempts({
    receiptRequestId,
    requestHash: input.source.request_hash,
    receipt: lookup.receipt,
    model: input.model,
    currentJobId: input.checkpoint.jobId,
    currentCheckpointId: current.checkpoint_id,
    adoptFinalIntoCurrentJob: true,
    httpCompletionObserved: input.httpCompletionObserved,
  });
  assertExactOrdinaryCouncilAuthority(
    input.checkpoint.jobId,
    input.source.garden_id,
  );
  return recoveredCouncilCallResult(
    lookup.result,
    input.preserveExactContent,
    !input.httpCompletionObserved,
  );
}

async function resolveCompletedLegacyOrdinaryCheckpoint(input: {
  client: OpenAI;
  model: string;
  source: LearnCouncilCheckpointRow;
  checkpoint: LearnOrdinaryRequestCheckpoint;
  preserveExactContent: boolean;
}): Promise<CouncilCallResult> {
  const origin = learnCouncilRetryJob(db, input.source.origin_job_id);
  const current = learnCouncilRetryJob(db, input.checkpoint.jobId);
  if (
    !origin ||
    !current ||
    !exactLearnCouncilRetryJobBinding(origin, current)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Legacy ordinary Learn checkpoint has no exact failed-job lineage.",
    );
  }
  const outcome = await promptlessLegacyCouncilOutcomeGet(input.client, {
    requestHash: input.source.request_hash,
    createdAfter: origin.created_at,
    createdBefore: origin.updated_at,
    reasoningEffort: LEARN_REASONING.effort,
    reasoningSummary: LEARN_REASONING.summary,
  });
  assertExactOrdinaryCouncilAuthority(
    input.checkpoint.jobId,
    input.source.garden_id,
  );
  if (outcome.status !== 200 || outcome.state !== "completed" || !outcome.result) {
    throw new LearnPlanningRecoveryConflictError(
      `Materialized legacy Learn result is no longer uniquely completed (${outcome.code ?? `HTTP ${outcome.status}`}).`,
    );
  }
  assertExactOrdinaryCouncilResult(outcome.result, input.model);
  assertCouncilOutcomeInsideJob(outcome.result, origin);
  if (
    input.source.council_run_id !== outcome.result.councilRunId ||
    input.source.response_hash !== outcome.result.responseHash
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Materialized legacy Learn result conflicts with its durable checkpoint.",
    );
  }
  let currentCheckpoint = input.source;
  if (input.source.job_id !== input.checkpoint.jobId) {
    currentCheckpoint = adoptCompletedLearnCouncilCheckpointWithBoundary(db, {
      checkpointId: makeId("lrqa_legacy"),
      boundaryProofId: makeId("lrqba_legacy"),
      source: input.source,
      jobId: input.checkpoint.jobId,
      gardenId: input.source.garden_id,
      stageKey: input.checkpoint.stageKey,
      semanticAttempt: input.checkpoint.semanticAttempt,
      now: nowIso(),
    });
  }
  reconcileOrdinaryCouncilUsage({
    jobId: input.checkpoint.jobId,
    accountingId: currentCheckpoint.checkpoint_id,
    requestHash: input.source.request_hash,
    usage: outcome.result.usage!,
    providerCallCount: 1,
    reportedCallCount: 1,
    estimatedCallCount: 0,
    model: input.model,
    dispatchCount: 0,
    httpCompletionObserved: false,
  });
  assertExactOrdinaryCouncilAuthority(
    input.checkpoint.jobId,
    input.source.garden_id,
  );
  return recoveredCouncilCallResult(
    outcome.result,
    input.preserveExactContent,
    true,
  );
}

function ordinaryHttpResultProof(response: unknown): {
  councilRunId: string;
  responseHash: string;
} {
  const record = recordValue(response);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const first = recordValue(choices[0]);
  const message = recordValue(first?.message);
  const content = message?.content;
  const councilRunId = record?.councilRunId ?? record?.id;
  if (
    typeof content !== "string" ||
    !content.trim() ||
    typeof councilRunId !== "string" ||
    !councilRunId
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Ordinary Learn Council HTTP response has no exact content/run binding.",
    );
  }
  return {
    councilRunId,
    responseHash: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

function learnCouncilStageComponent(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function terminalOrdinaryCouncilReceiptError(
  source: LearnCouncilCheckpointRow,
  requestHash: string,
  receipt: StrictCouncilReceiptMetadata,
): LearnCouncilTerminalReceiptError {
  if (!source.receipt_request_id || !receipt.failureCode) {
    throw new LearnPlanningRecoveryConflictError(
      "Terminal ordinary Learn receipt is missing its exact request/failure binding.",
    );
  }
  return new LearnCouncilTerminalReceiptError({
    requestId: source.receipt_request_id,
    requestHash,
    dispatchGeneration: receipt.dispatchGeneration,
    dispatchCount: receipt.dispatchCount,
    redispatchCount: receipt.redispatchCount,
    redispatchAllowed: receipt.redispatchAllowed,
    failureCode: receipt.failureCode,
    proofKind: "terminal_receipt",
  });
}

async function callOrdinaryCouncilTextWithReceipt(input: {
  client: OpenAI;
  model: string;
  request: CouncilCompletionRequest;
  checkpoint: LearnOrdinaryRequestCheckpoint;
  preserveExactContent: boolean;
  timeoutMs?: number;
}): Promise<CouncilCallResult> {
  const gardenId = input.request.gardenId;
  if (typeof gardenId !== "string" || !gardenId) {
    throw new LearnPlanningRecoveryConflictError(
      "Ordinary Learn Council request has no garden binding.",
    );
  }
  assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
  const requestHash = councilRequestHashV1(recoverablePlanningEnvelope(input.request));
  const execution = { dispatchCount: 0 };

  const reconcileFailedReceipt = (
    source: LearnCouncilCheckpointRow,
    receipt: StrictCouncilReceiptMetadata,
  ): void => {
    assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
    reconcileOrdinaryCouncilReceiptAttempts({
      receiptRequestId: source.receipt_request_id!,
      requestHash,
      receipt,
      model: input.model,
      currentJobId: input.checkpoint.jobId,
      currentCheckpointId: source.checkpoint_id,
      adoptFinalIntoCurrentJob: false,
      httpCompletionObserved: false,
      allowClaimedNextGeneration:
        source.redispatch_count === 1 &&
        source.redispatch_reason === "request_failed" &&
        receipt.dispatchCount === 1,
    });
  };

  const reconcileBeforeRedispatchOwnerTransfer = (
    source: LearnCouncilCheckpointRow,
    receipt: StrictCouncilReceiptMetadata,
    priorOwnerJobId: string,
    receiptRequestId: string,
    exactRequestHash: string,
  ): void => {
    // First account every provider generation the server proves exists. A
    // same-job owner of generations 1 and 2 is normalized here, including a
    // later generation-2 HTTP attempt which never reached the server.
    reconcileFailedReceipt(source, receipt);
    const observedOwnerJobs = new Set(
      learnCouncilDispatchGenerationOwners(db, receiptRequestId)
        .filter((owner) =>
          Number(owner.dispatch_generation) <= receipt.attempts.length)
        .map((owner) => owner.job_id),
    );
    if (!observedOwnerJobs.has(priorOwnerJobId)) {
      // In a chained handoff, generation 1 can belong to A while the unaccepted
      // generation-2 POST belongs to B. The gen-1 reconciliation cannot touch
      // B's exact zero-usage HTTP phantom, so remove it before owner 2 moves to
      // C. This callback runs inside the checkpoint transfer transaction.
      discardPersistedLearnTokenUsageForProvenMissingReceipt(
        db,
        priorOwnerJobId,
        receiptRequestId,
        exactRequestHash,
        nowIso(),
      );
    }
  };

  const dispatch = async (
    source: LearnCouncilCheckpointRow,
    redispatchReason?: "receipt_not_found" | "request_failed",
  ): Promise<CouncilCallResult> => {
    if (!source.receipt_request_id) {
      throw new LearnPlanningRecoveryConflictError(
        "Ordinary Learn dispatch has no strict receipt id.",
      );
    }
    const dispatchedRequest = {
      ...input.request,
      clientRequestId: source.receipt_request_id,
      clientRequestHash: requestHash,
      ...(redispatchReason === "request_failed"
        ? { clientRequestRedispatch: true }
        : {}),
    };
    let response: unknown;
    let attemptedThisDispatch = false;
    try {
      response = await dispatchAfterExactPlanningAuthority({
        authorized: () => exactOrdinaryCouncilDispatchAuthority(
          input.checkpoint.jobId,
          gardenId,
        ),
        dispatch: async () => {
          if (execution.dispatchCount >= 3) {
            throw new LearnPlanningRecoveryConflictError(
              "Ordinary Learn Council request exhausted its bounded dispatch budget.",
            );
          }
          attemptedThisDispatch = true;
          execution.dispatchCount += 1;
          return input.client.chat.completions.create(
            dispatchedRequest as Parameters<typeof input.client.chat.completions.create>[0],
            input.timeoutMs
              ? { timeout: input.timeoutMs, maxRetries: 0 }
              : { maxRetries: 0 },
          );
        },
      });
    } catch (dispatchError) {
      // Authority is checked before the callback increments this counter. A
      // denied lease/cancellation fence is not a transport attempt and must
      // never be reinterpreted as receipt absence or redispatch permission.
      if (!attemptedThisDispatch) throw dispatchError;
      const lookup = await observeOrdinaryCouncilReceipt({
        client: input.client,
        jobId: input.checkpoint.jobId,
        gardenId,
        requestId: source.receipt_request_id,
        requestHash,
        observationTimeoutMs: input.timeoutMs ?? LEARN_PLANNING_TIMEOUT_MS,
      });
      if (lookup.status === 200 && lookup.result) {
        return resolveCompletedOrdinaryReceipt({
          client: input.client,
          model: input.model,
          source,
          checkpoint: input.checkpoint,
          preserveExactContent: input.preserveExactContent,
          executionDispatchCount: execution.dispatchCount,
          httpCompletionObserved: false,
        });
      }
      if (
        lookup.status === 409 &&
        lookup.code === "request_failed" &&
        lookup.receipt
      ) {
        reconcileFailedReceipt(source, lookup.receipt);
      }
      const mayRedispatchMissing =
        !redispatchReason &&
        lookup.status === 404 &&
        lookup.code === "receipt_not_found";
      const mayRedispatchFailed =
        redispatchReason !== "request_failed" &&
        lookup.status === 409 &&
        lookup.code === "request_failed" &&
        lookup.receipt?.dispatchGeneration === 1 &&
        lookup.receipt.dispatchCount === 1 &&
        lookup.receipt.redispatchCount === 0 &&
        lookup.receipt.redispatchAllowed === true &&
        typeof lookup.receipt.failureCode === "string" &&
        Boolean(lookup.receipt.failureCode);
      if (mayRedispatchMissing || mayRedispatchFailed) {
        const reason = mayRedispatchFailed
          ? "request_failed"
          : "receipt_not_found";
        if (mayRedispatchFailed && modelHttpStatus(dispatchError) === 502) {
          try {
            updateLearnJob(input.checkpoint.jobId, {
              currentStep: `HTTP 502; automatically retrying ${input.checkpoint.stageLabel}`,
            });
          } catch {
            // The exact server receipt remains the retry authority.
          }
          await waitForLearnHttp502Retry(
            input.checkpoint.jobId,
            LEARN_HTTP_502_RETRY_BASE_DELAY_MS,
          );
        }
        const checkpointId = source.job_id === input.checkpoint.jobId
          ? source.checkpoint_id
          : makeId("lrqa");
        const claimed = reason === "request_failed"
          ? claimLearnCouncilRedispatch(db, {
              checkpointId,
              source,
              jobId: input.checkpoint.jobId,
              gardenId,
              stageKey: input.checkpoint.stageKey,
              semanticAttempt: input.checkpoint.semanticAttempt,
              requestHash,
              reason,
              now: nowIso(),
            })
          : claimLearnCouncilMissingReceiptRecovery(db, {
              claimId: makeId("lrqm"),
              checkpointId,
              source,
              jobId: input.checkpoint.jobId,
              gardenId,
              stageKey: input.checkpoint.stageKey,
              semanticAttempt: input.checkpoint.semanticAttempt,
              requestHash,
              now: nowIso(),
              beforeOwnerTransfer: (
                priorOwnerJobId,
                receiptRequestId,
                exactRequestHash,
              ) => {
                discardPersistedLearnTokenUsageForProvenMissingReceipt(
                  db,
                  priorOwnerJobId,
                  receiptRequestId,
                  exactRequestHash,
                  nowIso(),
                );
              },
            });
        return dispatch(claimed, reason);
      }
      if (
        lookup.status === 409 &&
        lookup.code === "request_failed" &&
        lookup.receipt
      ) {
        const terminalError = terminalOrdinaryCouncilReceiptError(
          source,
          requestHash,
          lookup.receipt,
        );
        if (modelHttpStatus(dispatchError) === 502) {
          throw new LearnCouncilHttp502ReceiptError(
            terminalError.receipt,
            dispatchError,
          );
        }
        throw terminalError;
      }
      const expiredStarted = expiredStartedOrdinaryCouncilReceiptError({
        source,
        requestHash,
        lookup,
      });
      if (expiredStarted) {
        appendLearnEvent(
          input.checkpoint.contentPath,
          gardenId,
          "learn_council_started_receipt_expired",
          {
            jobId: input.checkpoint.jobId,
            originJobId: source.origin_job_id,
            stageKey: input.checkpoint.stageKey,
            semanticAttempt: input.checkpoint.semanticAttempt,
            receiptRequestId: source.receipt_request_id,
            dispatchCount: expiredStarted.receipt.dispatchCount,
            startedAt: expiredStarted.receipt.startedAt,
            observedAt: expiredStarted.receipt.observedAt,
            maxStartedAgeMs: expiredStarted.receipt.maxStartedAgeMs,
            nextSemanticAttemptRequired: true,
          },
        );
        throw expiredStarted;
      }
      throw new LearnPlanningRecoveryConflictError(
        `Ordinary Learn Council dispatch ended as ${lookup.code ?? `HTTP ${lookup.status}`}; no further model request was authorized (${errorMessage(dispatchError)}).`,
      );
    }
    const proof = ordinaryHttpResultProof(response);
    assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
    return resolveCompletedOrdinaryReceipt({
      client: input.client,
      model: input.model,
      source,
      checkpoint: input.checkpoint,
      preserveExactContent: input.preserveExactContent,
      executionDispatchCount: execution.dispatchCount,
      httpCompletionObserved: true,
      expectedHttpResult: proof,
    });
  };

  const resolveStarted = async (
    source: LearnCouncilCheckpointRow,
  ): Promise<CouncilCallResult> => {
    if (!source.receipt_request_id) {
      throw new LearnPlanningRecoveryConflictError(
        "Started ordinary Learn checkpoint is not a strict receipt.",
      );
    }
    const lookup = await observeOrdinaryCouncilCheckpointReceipt({
      client: input.client,
      jobId: input.checkpoint.jobId,
      gardenId,
      source,
      requestHash,
      observationTimeoutMs: input.timeoutMs ?? LEARN_PLANNING_TIMEOUT_MS,
    });
    if (lookup.status === 200 && lookup.result) {
      return resolveCompletedOrdinaryReceipt({
        client: input.client,
        model: input.model,
        source,
        checkpoint: input.checkpoint,
        preserveExactContent: input.preserveExactContent,
        executionDispatchCount: 0,
        httpCompletionObserved: false,
      });
    }
    if (
      lookup.status === 409 &&
      lookup.code === "request_failed" &&
      lookup.receipt
    ) {
      reconcileFailedReceipt(source, lookup.receipt);
    }
    const missing =
      lookup.status === 404 && lookup.code === "receipt_not_found";
    const failed =
      lookup.status === 409 &&
      lookup.code === "request_failed" &&
      lookup.receipt?.dispatchGeneration === 1 &&
      lookup.receipt.dispatchCount === 1 &&
      lookup.receipt.redispatchCount === 0 &&
      lookup.receipt.redispatchAllowed === true &&
      typeof lookup.receipt.failureCode === "string" &&
      Boolean(lookup.receipt.failureCode);
    if (missing) {
      const claimed = claimLearnCouncilMissingReceiptRecovery(db, {
        claimId: makeId("lrqm"),
        checkpointId:
          source.job_id === input.checkpoint.jobId
            ? source.checkpoint_id
            : makeId("lrqa"),
        source,
        jobId: input.checkpoint.jobId,
        gardenId,
        stageKey: input.checkpoint.stageKey,
        semanticAttempt: input.checkpoint.semanticAttempt,
        requestHash,
        now: nowIso(),
        beforeOwnerTransfer: (
          priorOwnerJobId,
          receiptRequestId,
          exactRequestHash,
        ) => {
          discardPersistedLearnTokenUsageForProvenMissingReceipt(
            db,
            priorOwnerJobId,
            receiptRequestId,
            exactRequestHash,
            nowIso(),
          );
        },
      });
      return dispatch(claimed, "receipt_not_found");
    }
    const failedClaimAvailable =
      failed &&
      (source.redispatch_count === 0 ||
        (source.redispatch_count === 1 &&
          source.redispatch_reason === "receipt_not_found"));
    const failedClaimAlreadyDurable =
      failed &&
      source.redispatch_count === 1 &&
      source.redispatch_reason === "request_failed";
    if (failedClaimAvailable) {
      const reason = failed ? "request_failed" : "receipt_not_found";
      const claimed = claimLearnCouncilRedispatch(db, {
        checkpointId:
          source.job_id === input.checkpoint.jobId
            ? source.checkpoint_id
            : makeId("lrqa"),
        source,
        jobId: input.checkpoint.jobId,
        gardenId,
        stageKey: input.checkpoint.stageKey,
        semanticAttempt: input.checkpoint.semanticAttempt,
        requestHash,
        reason,
        now: nowIso(),
      });
      return dispatch(claimed, reason);
    }
    if (failedClaimAlreadyDurable) {
      // The process may have died after the local generation-2 claim but before
      // its POST. The server still proves generation 1 is the exact eligible
      // failure, so resume that already-claimed POST without another DB claim.
      const claimed = source.job_id === input.checkpoint.jobId
        ? source
        : adoptClaimedLearnCouncilRedispatch(db, {
            checkpointId: makeId("lrqa"),
            source,
            jobId: input.checkpoint.jobId,
            gardenId,
            stageKey: input.checkpoint.stageKey,
            semanticAttempt: input.checkpoint.semanticAttempt,
            requestHash,
            now: nowIso(),
            beforeOwnerTransfer: (
              priorOwnerJobId,
              receiptRequestId,
              exactRequestHash,
            ) =>
              reconcileBeforeRedispatchOwnerTransfer(
                source,
                lookup.receipt!,
                priorOwnerJobId,
                receiptRequestId,
                exactRequestHash,
              ),
          });
      return dispatch(claimed, "request_failed");
    }
    if (failed && lookup.receipt) {
      throw terminalOrdinaryCouncilReceiptError(
        source,
        requestHash,
        lookup.receipt,
      );
    }
    const expiredStarted = expiredStartedOrdinaryCouncilReceiptError({
      source,
      requestHash,
      lookup,
    });
    if (expiredStarted) {
      appendLearnEvent(
        input.checkpoint.contentPath,
        gardenId,
        "learn_council_started_receipt_expired",
        {
          jobId: input.checkpoint.jobId,
          originJobId: source.origin_job_id,
          stageKey: input.checkpoint.stageKey,
          semanticAttempt: input.checkpoint.semanticAttempt,
          receiptRequestId: source.receipt_request_id,
          dispatchCount: expiredStarted.receipt.dispatchCount,
          startedAt: expiredStarted.receipt.startedAt,
          observedAt: expiredStarted.receipt.observedAt,
          maxStartedAgeMs: expiredStarted.receipt.maxStartedAgeMs,
          nextSemanticAttemptRequired: true,
        },
      );
      throw expiredStarted;
    }
    throw new LearnPlanningRecoveryConflictError(
      `Ordinary Learn Council checkpoint is ${lookup.code ?? `HTTP ${lookup.status}`}; no model request was authorized.`,
    );
  };

  const current = currentLearnCouncilCheckpoint(db, {
    jobId: input.checkpoint.jobId,
    gardenId,
    stageKey: input.checkpoint.stageKey,
    semanticAttempt: input.checkpoint.semanticAttempt,
  });
  if (current) {
    if (current.request_hash !== requestHash) {
      throw new LearnPlanningRecoveryConflictError(
        "Current ordinary Learn checkpoint request hash changed; no model request was issued.",
      );
    }
    return current.result_origin === "legacy"
      ? resolveCompletedLegacyOrdinaryCheckpoint({
          client: input.client,
          model: input.model,
          source: current,
          checkpoint: input.checkpoint,
          preserveExactContent: input.preserveExactContent,
        })
      : current.state === "completed"
        ? resolveCompletedOrdinaryReceipt({
            client: input.client,
            model: input.model,
            source: current,
            checkpoint: input.checkpoint,
            preserveExactContent: input.preserveExactContent,
            executionDispatchCount: 0,
            httpCompletionObserved: false,
          })
        : resolveStarted(current);
  }

  const currentJob = learnCouncilRetryJob(db, input.checkpoint.jobId);
  if (!currentJob || currentJob.garden_id !== gardenId) {
    throw new LearnPlanningRecoveryConflictError(
      "Current ordinary Learn checkpoint job binding is invalid.",
    );
  }
  const prior = priorLearnCouncilCheckpoints(db, {
    currentJobId: input.checkpoint.jobId,
    gardenId,
    stageKey: input.checkpoint.stageKey,
    semanticAttempt: input.checkpoint.semanticAttempt,
  }).filter((candidate) =>
    exactLearnCouncilRetryJobBinding(candidate.job, currentJob),
  );
  // A completed checkpoint belongs to a closed request epoch. If an upstream
  // artifact legitimately changed, that closed epoch may have a different
  // request hash and is safe to ignore. A started checkpoint is different: its
  // provider outcome may still be unresolved, so fail closed rather than risk
  // dispatching a second request for the same semantic stage.
  const mismatched = prior.filter(
    (candidate) =>
      candidate.state !== "completed" && candidate.request_hash !== requestHash,
  );
  if (mismatched.length > 0) {
    throw new LearnPlanningRecoveryConflictError(
      "An exact prior ordinary Learn stage has a different request hash; no model request was issued.",
    );
  }
  const candidates = prior.filter((candidate) => candidate.request_hash === requestHash);
  if (candidates.length > 0) {
    const nativeBoundaryByCheckpoint = new Map<string, {
      source: LearnCouncilCheckpointRow & { job: { id: string } };
      proof: NativeLearnCouncilBoundaryProof;
    }>();
    const selection = await selectNewestCompletedLearnCouncilCheckpoint(
      candidates,
      async (source) => {
        if (!source.receipt_request_id) {
          throw new LearnPlanningRecoveryConflictError(
            "Prior ordinary Learn native checkpoint has no receipt id.",
          );
        }
        const lookup = await observeOrdinaryCouncilCheckpointReceipt({
          client: input.client,
          jobId: input.checkpoint.jobId,
          gardenId,
          source,
          requestHash,
          observationTimeoutMs: input.timeoutMs ?? LEARN_PLANNING_TIMEOUT_MS,
        });
        if (lookup.status === 200 && lookup.result) return "completed";
        const missing =
          lookup.status === 404 && lookup.code === "receipt_not_found";
        const started =
          lookup.status === 409 && lookup.code === "request_started";
        const failed = lookup.status === 409 && lookup.code === "request_failed";
        if (failed) {
          const owners = source.receipt_request_id
            ? learnCouncilDispatchGenerationOwners(db, source.receipt_request_id)
            : [];
          const exactCompletedLocalGeneration = Boolean(
            lookup.receipt &&
            lookup.receipt.dispatchCount === source.dispatch_attempt_count &&
            lookup.receipt.redispatchCount === source.redispatch_count,
          );
          const exactClaimedButUnpostedGenerationTwo = Boolean(
            lookup.receipt &&
            lookup.receipt.dispatchCount === 1 &&
            lookup.receipt.redispatchCount === 0 &&
            lookup.receipt.redispatchAllowed === true &&
            source.dispatch_attempt_count === 2 &&
            source.redispatch_count === 1 &&
            source.redispatch_reason === "request_failed" &&
            learnCouncilReceiptOwnerPrefixIsExact(
              owners.map((owner) => Number(owner.dispatch_generation)),
              lookup.receipt.attempts.length,
              true,
            ) &&
            owners.at(-1)?.job_id === source.job_id,
          );
          if (
            !lookup.receipt ||
            (!exactCompletedLocalGeneration &&
              !exactClaimedButUnpostedGenerationTwo) ||
            typeof lookup.receipt.failureCode !== "string" ||
            !lookup.receipt.failureCode
          ) {
            throw new LearnPlanningRecoveryConflictError(
              "Prior ordinary Learn failed receipt metadata conflicts with its checkpoint.",
            );
          }
          // A newer terminal failure may be skipped in favor of an older exact
          // completion, but its provider attempts still belong to their
          // durable generation owners. Account them before returning the
          // disposition so selection cannot silently lose failed-call usage.
          assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
          reconcileFailedReceipt(source, lookup.receipt);
        }
        if (!missing && !started && !failed) {
          throw new LearnPlanningRecoveryConflictError(
            `Prior ordinary Learn receipt is not safely resolvable (${lookup.code ?? `HTTP ${lookup.status}`}).`,
          );
        }
        if (!started && nativeBoundaryByCheckpoint.size === 0) {
          nativeBoundaryByCheckpoint.set(source.checkpoint_id, {
            source,
            proof: missing
              ? {
                  outcome: "receipt_not_found",
                  receiptRequestId: source.receipt_request_id,
                  dispatchGeneration: null,
                  dispatchCount: null,
                  redispatchCount: null,
                  redispatchAllowed: null,
                  failureCode: null,
                }
              : {
                  outcome: "request_failed",
                  receiptRequestId: source.receipt_request_id,
                  dispatchGeneration: lookup.receipt!.dispatchGeneration,
                  dispatchCount: lookup.receipt!.dispatchCount,
                  redispatchCount: lookup.receipt!.redispatchCount,
                  redispatchAllowed: lookup.receipt!.redispatchAllowed,
                  failureCode: lookup.receipt!.failureCode!,
                },
          });
        }
        return started
          ? "request_started"
          : failed
            ? "failed"
            : "receipt_not_found";
      },
    );
    const completed = selection.completed;
    if (completed) {
      if (selection.newestIncomplete) {
        const newestNativeBoundary = nativeBoundaryByCheckpoint.get(
          selection.newestIncomplete.checkpoint_id,
        );
        if (
          !newestNativeBoundary ||
          newestNativeBoundary.source.checkpoint_id !==
            selection.newestIncomplete.checkpoint_id
        ) {
          throw new LearnPlanningRecoveryConflictError(
            "Skipped native Learn boundary lost its exact observation proof.",
          );
        }
        assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
        recordLearnCouncilNativeLineageBoundary(db, {
          boundaryId: makeId("lrqnb"),
          originJobId: newestNativeBoundary.source.job.id,
          jobId: input.checkpoint.jobId,
          gardenId,
          stageKey: input.checkpoint.stageKey,
          semanticAttempt: input.checkpoint.semanticAttempt,
          requestHash,
          proof: newestNativeBoundary.proof,
          now: nowIso(),
        });
      }
      if (completed.result_origin === "legacy") {
        return resolveCompletedLegacyOrdinaryCheckpoint({
          client: input.client,
          model: input.model,
          source: completed,
          checkpoint: input.checkpoint,
          preserveExactContent: input.preserveExactContent,
        });
      }
      return resolveCompletedOrdinaryReceipt({
        client: input.client,
        model: input.model,
        source: completed,
        checkpoint: input.checkpoint,
        preserveExactContent: input.preserveExactContent,
        executionDispatchCount: 0,
        httpCompletionObserved: false,
      });
    }
    if (!selection.newestIncomplete) {
      throw new LearnPlanningRecoveryConflictError(
        "Prior ordinary Learn checkpoint lineage has no resolvable outcome.",
      );
    }
    if (selection.newestIncomplete.result_origin !== "receipt") {
        throw new LearnPlanningRecoveryConflictError(
          "Incomplete ordinary Learn checkpoint is not a native receipt.",
        );
    }
    return resolveStarted(selection.newestIncomplete);
  }

  const exactLineage = exactFailedLearnCouncilLineage(
    db,
    input.checkpoint.jobId,
  );
  // Stage-specific native checkpoints were already resolved above. A failed
  // predecessor that completed a native planning receipt or created any native
  // ordinary receipt is provably a post-migration strict worker: every ordinary
  // Council POST in that runtime synchronously persists this stage checkpoint
  // first. Its absence is exact negative issuance evidence, so it must not be
  // reclassified as legacy and extend the 37-minute pre-receipt quiescence
  // window. Generation-only retries have no planning checkpoint, so their
  // ordinary receipts are the migration-epoch proof. A strict worker can also
  // fail before its first receipt (for example while cloning a workspace or
  // while a recovery guard is still fail-closed); its exact terminal marker is
  // positive no-dispatch evidence. Pre-migration jobs (with none of these
  // proofs) retain the full legacy lookup + wait.
  const lineage = exactLineage.filter(
    (origin) =>
      !hasCompletedNativePlanningCheckpoint(db, origin.id) &&
      !hasNativeLearnCouncilCheckpoint(db, origin.id) &&
      !hasDurableLearnCouncilNoDispatchBoundary(origin),
  );
  if (lineage.length !== exactLineage.length) {
    appendLearnEvent(
      input.checkpoint.contentPath,
      gardenId,
      "learn_council_strict_predecessors_excluded_from_legacy_fallback",
      {
        jobId: input.checkpoint.jobId,
        stageKey: input.checkpoint.stageKey,
        semanticAttempt: input.checkpoint.semanticAttempt,
        exactPredecessorCount: exactLineage.length,
        legacyPredecessorCount: lineage.length,
      },
    );
  }
  if (
    lineage.some((job, index) =>
      index > 0 && job.created_at === lineage[index - 1].created_at)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "Ordinary Learn legacy lineage has ambiguous job ordering; no model request was issued.",
    );
  }
  let newestFailure: { originJobId: string; failure: LegacyCouncilFailureOutcome } | null = null;
  let legacyFailureCount = 0;
  let newestCompleted: {
    originJobId: string;
    result: PromptlessCouncilRecoveryResult;
  } | null = null;
  for (const origin of lineage) {
    const outcome = await promptlessLegacyCouncilOutcomeGet(input.client, {
      requestHash,
      createdAfter: origin.created_at,
      createdBefore: origin.updated_at,
      reasoningEffort: LEARN_REASONING.effort,
      reasoningSummary: LEARN_REASONING.summary,
    });
    assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
    if (outcome.status === 404 && outcome.code === "legacy_not_found") {
      continue;
    }
    if (outcome.status !== 200 || !outcome.state) {
      throw new LearnPlanningRecoveryConflictError(
        `Ordinary Learn legacy outcome is not uniquely resolvable (${outcome.code ?? `HTTP ${outcome.status}`}); no model request was issued.`,
      );
    }
    if (outcome.state === "failed" && outcome.failure) {
      assertExactLegacyCouncilFailure(outcome.failure, input.model);
      assertCouncilOutcomeInsideJob(outcome.failure, origin);
      newestFailure ??= { originJobId: origin.id, failure: outcome.failure };
      legacyFailureCount += 1;
      continue;
    }
    if (outcome.state === "completed" && outcome.result) {
      assertExactOrdinaryCouncilResult(outcome.result, input.model);
      assertCouncilOutcomeInsideJob(outcome.result, origin);
      newestCompleted = { originJobId: origin.id, result: outcome.result };
      break;
    }
    throw new LearnPlanningRecoveryConflictError(
      "Ordinary Learn legacy outcome is malformed; no model request was issued.",
    );
  }

  try {
    assertUniqueLegacyLearnCouncilFailureWithoutCompletion(
      legacyFailureCount,
      Boolean(newestCompleted),
    );
  } catch {
    throw new LearnPlanningRecoveryConflictError(
      "Multiple legacy failed/no-final outcomes match this ordinary Learn stage; no fresh receipt was authorized.",
    );
  }

  if (newestCompleted) {
    assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
    const now = nowIso();
    const materialized = newestFailure
      ? materializeCompletedLegacyLearnCouncilCheckpointAfterFailure(db, {
          proofId: makeId("lrqf_legacy"),
          failureOriginJobId: newestFailure.originJobId,
          completionOriginJobId: newestCompleted.originJobId,
          jobId: input.checkpoint.jobId,
          gardenId,
          stageKey: input.checkpoint.stageKey,
          semanticAttempt: input.checkpoint.semanticAttempt,
          requestHash,
          proof: newestFailure.failure,
          checkpointId: makeId("lrqa_legacy"),
          councilRunId: newestCompleted.result.councilRunId,
          responseHash: newestCompleted.result.responseHash,
          now,
        })
      : materializeCompletedLegacyLearnCouncilCheckpoint(db, {
          checkpointId: makeId("lrqa_legacy"),
          originJobId: newestCompleted.originJobId,
          jobId: input.checkpoint.jobId,
          gardenId,
          stageKey: input.checkpoint.stageKey,
          semanticAttempt: input.checkpoint.semanticAttempt,
          requestHash,
          councilRunId: newestCompleted.result.councilRunId,
          responseHash: newestCompleted.result.responseHash,
          now,
        });
    reconcileOrdinaryCouncilUsage({
      jobId: input.checkpoint.jobId,
      accountingId: materialized.checkpoint_id,
      requestHash,
      usage: newestCompleted.result.usage!,
      providerCallCount: 1,
      reportedCallCount: 1,
      estimatedCallCount: 0,
      model: input.model,
      dispatchCount: 0,
      httpCompletionObserved: false,
    });
    appendLearnEvent(
      input.checkpoint.contentPath,
      gardenId,
      "learn_council_legacy_result_recovered",
      {
        jobId: input.checkpoint.jobId,
        originJobId: newestCompleted.originJobId,
        stageKey: input.checkpoint.stageKey,
        semanticAttempt: input.checkpoint.semanticAttempt,
        councilRunId: newestCompleted.result.councilRunId,
      },
    );
    assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
    return recoveredCouncilCallResult(
      newestCompleted.result,
      input.preserveExactContent,
      true,
    );
  }

  let started: LearnCouncilCheckpointRow;
  assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
  if (newestFailure) {
    started = createStartedLearnCouncilCheckpointAfterLegacyFailure(db, {
      proofId: makeId("lrqf_legacy"),
      requestId: makeId("lrq"),
      originJobId: newestFailure.originJobId,
      jobId: input.checkpoint.jobId,
      gardenId,
      stageKey: input.checkpoint.stageKey,
      semanticAttempt: input.checkpoint.semanticAttempt,
      requestHash,
      proof: newestFailure.failure,
      now: nowIso(),
    });
  } else {
    const canStartAfterLegacyAbsence =
      canStartLearnCouncilAfterLegacyAbsence(db, input.checkpoint.jobId, {
        hasCompletedNativePlanningCheckpoint:
          hasCompletedNativePlanningCheckpoint(db, input.checkpoint.jobId),
      });
    const legacyQuiescenceDelayMs =
      legacyLearnCouncilLineageQuiescenceDelayMs(lineage, Date.now());
    if (
      lineage.length > 0 &&
      (!canStartAfterLegacyAbsence || legacyQuiescenceDelayMs === null)
    ) {
      throw new LearnPlanningRecoveryConflictError(
        "Prior exact Learn jobs are not durably quiescent or have no completed failure boundary; 404 absence cannot authorize a model request.",
      );
    }
    if (lineage.length > 0 && (legacyQuiescenceDelayMs ?? 0) > 0) {
      const waitMs = legacyQuiescenceDelayMs!;
      appendLearnEvent(
        input.checkpoint.contentPath,
        gardenId,
        "learn_council_legacy_quiescence_wait_started",
        {
          jobId: input.checkpoint.jobId,
          stageKey: input.checkpoint.stageKey,
          semanticAttempt: input.checkpoint.semanticAttempt,
          waitMs,
          predecessorCount: lineage.length,
        },
      );
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await learnCheckpoint(input.checkpoint.jobId);
        assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(1_000, Math.max(1, deadline - Date.now()))),
        );
      }
      await learnCheckpoint(input.checkpoint.jobId);
      assertExactOrdinaryCouncilAuthority(input.checkpoint.jobId, gardenId);
      appendLearnEvent(
        input.checkpoint.contentPath,
        gardenId,
        "learn_council_legacy_quiescence_wait_completed",
        {
          jobId: input.checkpoint.jobId,
          stageKey: input.checkpoint.stageKey,
          semanticAttempt: input.checkpoint.semanticAttempt,
          predecessorCount: lineage.length,
        },
      );
      // Re-observe every legacy outcome after the safe window. A result that
      // arrived while waiting must be recovered instead of duplicated.
      return callOrdinaryCouncilTextWithReceipt(input);
    }
    started = createStartedLearnCouncilCheckpoint(db, {
      requestId: makeId("lrq"),
      jobId: input.checkpoint.jobId,
      gardenId,
      stageKey: input.checkpoint.stageKey,
      semanticAttempt: input.checkpoint.semanticAttempt,
      requestHash,
      now: nowIso(),
    });
  }
  return dispatch(started);
}

async function promptlessLegacyPlanningInventoryGet(
  client: OpenAI,
  binding: LegacyPlanningWaiverBinding,
) {
  const url = chatMockInternalUrl(
    client,
    "/internal/council-results/legacy-inventory",
  );
  for (const [key, value] of Object.entries({
    createdAfter: binding.jobCreatedAt,
    createdBefore: binding.recoveredAt,
    reasoningEffort: LEARN_REASONING.effort,
    reasoningSummary: LEARN_REASONING.summary,
    gardenId: binding.gardenId,
    requestedModel: binding.model,
    sourceSetHash: binding.sourceSetHash,
    sourceIdsJson: JSON.stringify(binding.sourceIds),
  })) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new LearnPlanningRecoveryConflictError(
      `Live legacy Council inventory could not be observed: ${errorMessage(error)}`,
    );
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    throw new LearnPlanningRecoveryConflictError(
      `Live legacy Council inventory could not be read: ${errorMessage(error)}`,
    );
  }
  if (raw.length > 1_000_000) {
    throw new LearnPlanningRecoveryConflictError(
      "Live legacy Council inventory response is oversized.",
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new LearnPlanningRecoveryConflictError(
      `Live legacy Council inventory returned non-JSON HTTP ${response.status}.`,
    );
  }
  if (!response.ok) {
    const record = recordValue(body);
    const error = recordValue(record?.error);
    throw new LearnPlanningRecoveryConflictError(
      `Live legacy Council inventory failed (${typeof error?.code === "string" ? error.code : `HTTP ${response.status}`}).`,
    );
  }
  try {
    return auditedLegacyPlanningInventory({
      value: body,
      binding,
      model: binding.model,
    });
  } catch (error) {
    throw new LearnPlanningRecoveryConflictError(
      `Live legacy Council inventory is invalid: ${errorMessage(error)}`,
    );
  }
}

function recoveredCouncilCallResult(
  result: PromptlessCouncilRecoveryResult,
  preserveExactContent: boolean,
  recovered = true,
): CouncilCallResult {
  return {
    content: preserveExactContent
      ? result.finalAnswer
      : scrubbed(result.finalAnswer.trim()),
    councilRunId: result.councilRunId,
    councilMode: result.councilMode,
    ...(recovered ? { recovered: true } : {}),
  };
}

function assertExactRecoveredPlanningRouting(
  result: PromptlessCouncilRecoveryResult,
  expectedModel: string,
): void {
  if (!planningReceiptProvesOneExactModelCall(result, expectedModel)) {
    throw new LearnPlanningRecoveryConflictError(
      "Recovered Council result does not prove one exact successful non-fallback direct-model call.",
    );
  }
}

interface EligiblePriorPlanningCheckpoint {
  row: PriorPlanningCheckpointRow;
  abandonedFence?: {
    recoveredAt: string;
    events: Array<Record<string, unknown>>;
    malformedEvents: false;
  };
}

/** A failed job can leave a native checkpoint locally `started` even after its
 * server receipt has become terminal. When a later explicit retry changes the
 * canonical request (for example, after a prompt/code revision), that old hash
 * must still fail closed while it is in flight. It must not permanently block
 * the new request once the server proves that the old receipt is terminal.
 *
 * Completed mismatches are reconciled locally before being skipped. Failed
 * mismatches are skipped only when the strict receipt has exhausted its server
 * redispatch authority. Missing or still-started receipts remain eligible and
 * therefore retain the existing request-hash conflict fence. */
async function omitTerminallySettledMismatchedPlanningReceipts(input: {
  client: OpenAI;
  requestHash: string;
  expectedModel: string;
  checkpoint: LearnPlanningRequestCheckpoint;
  candidates: EligiblePriorPlanningCheckpoint[];
}): Promise<EligiblePriorPlanningCheckpoint[]> {
  const unresolved: EligiblePriorPlanningCheckpoint[] = [];
  for (const candidate of input.candidates) {
    const { row } = candidate;
    if (
      row.request_hash === input.requestHash ||
      row.result_origin !== "receipt" ||
      !row.receipt_request_id
    ) {
      unresolved.push(candidate);
      continue;
    }
    if (!exactPlanningDispatchAuthority(input.checkpoint.jobId, row.garden_id)) {
      throw new PlanningRecoveryBoundaryError("dispatch_authority_lost");
    }
    const lookup = await promptlessCouncilResultGet(
      input.client,
      "/internal/council-results/resolve",
      {
        requestId: row.receipt_request_id,
        requestHash: row.request_hash,
      },
    );
    if (!exactPlanningDispatchAuthority(input.checkpoint.jobId, row.garden_id)) {
      throw new PlanningRecoveryBoundaryError("dispatch_authority_lost");
    }
    if (lookup.status === 200 && lookup.result) {
      assertExactRecoveredPlanningRouting(lookup.result, input.expectedModel);
      if (row.state === "started") {
        completePlanningCheckpoint(db, {
          requestId: row.request_id,
          requestHash: row.request_hash,
          councilRunId: lookup.result.councilRunId,
          responseHash: lookup.result.responseHash,
          now: nowIso(),
        });
      }
      appendLearnEvent(
        input.checkpoint.contentPath,
        row.garden_id,
        "learn_terminal_mismatched_planning_receipt_omitted",
        {
          jobId: input.checkpoint.jobId,
          originJobId: row.job_id,
          stageKey: row.stage_key,
          semanticAttempt: row.semantic_attempt,
          outcome: "completed",
          receiptRequestId: row.receipt_request_id,
        },
      );
      continue;
    }
    if (
      lookup.status === 409 &&
      lookup.code === "request_failed" &&
      lookup.receipt?.redispatchAllowed === false &&
      Boolean(lookup.receipt.failureCode)
    ) {
      appendLearnEvent(
        input.checkpoint.contentPath,
        row.garden_id,
        "learn_terminal_mismatched_planning_receipt_omitted",
        {
          jobId: input.checkpoint.jobId,
          originJobId: row.job_id,
          stageKey: row.stage_key,
          semanticAttempt: row.semantic_attempt,
          outcome: "failed",
          receiptRequestId: row.receipt_request_id,
          dispatchCount: lookup.receipt.dispatchCount,
          failureCode: lookup.receipt.failureCode,
        },
      );
      continue;
    }
    // A missing, still-started, malformed, or redispatchable receipt can still
    // race with a provider call. Keep it eligible so the hash mismatch below
    // remains a hard no-POST boundary.
    unresolved.push(candidate);
  }
  return unresolved;
}

async function resolveCompletedPlanningReceipt(input: {
  client: OpenAI;
  binding: {
    requestId: string;
    checkpointRequestId: string;
    requestHash: string;
    sameReceiptRedispatch?: boolean;
  };
  expectedModel: string;
  preserveExactContent: boolean;
  expectedHttpResult?: { councilRunId: string; responseHash: string };
  observeStartedRace?: boolean;
  observationTimeoutMs?: number;
  adoption?: {
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
  };
  recovered: boolean;
}): Promise<CouncilCallResult> {
  const deadline = input.observeStartedRace
    ? Date.now() + Math.max(1, input.observationTimeoutMs ?? LEARN_PLANNING_TIMEOUT_MS)
    : Date.now();
  let lookup: Awaited<ReturnType<typeof promptlessCouncilResultGet>> | null = null;
  for (;;) {
    lookup = await promptlessCouncilResultGet(
      input.client,
      "/internal/council-results/resolve",
      {
        requestId: input.binding.requestId,
        requestHash: input.binding.requestHash,
      },
    );
    if (lookup.status === 200 && lookup.result) break;
    if (
      lookup.status !== 409 ||
      lookup.code !== "request_started" ||
      !input.observeStartedRace ||
      Date.now() >= deadline
    ) {
      break;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
    );
  }
  if (lookup?.status !== 200 || !lookup.result) {
    throw new LearnPlanningRecoveryConflictError(
      `The exact recoverable Council receipt did not produce one observable completed result (${lookup?.code ?? `HTTP ${lookup?.status ?? 0}`}).`,
    );
  }
  assertExactRecoveredPlanningRouting(lookup.result, input.expectedModel);
  if (
    input.expectedHttpResult &&
    (input.expectedHttpResult.councilRunId !== lookup.result.councilRunId ||
      input.expectedHttpResult.responseHash !== lookup.result.responseHash)
  ) {
    throw new LearnPlanningRecoveryConflictError(
      "The HTTP response conflicts with its durable Council receipt.",
    );
  }
  if (input.binding.sameReceiptRedispatch) {
    if (!input.adoption) {
      throw new LearnPlanningRecoveryConflictError(
        "A same-receipt redispatch completed without durable adoption lineage.",
      );
    }
    completePlanningCheckpointWithAdoption(db, {
      originRequestId: input.binding.checkpointRequestId,
      receiptRequestId: input.binding.requestId,
      requestHash: input.binding.requestHash,
      councilRunId: lookup.result.councilRunId,
      responseHash: lookup.result.responseHash,
      adoptionRequestId: makeId("lrqa"),
      adoptingJobId: input.adoption.jobId,
      gardenId: input.adoption.gardenId,
      stageKey: input.adoption.stageKey,
      semanticAttempt: input.adoption.semanticAttempt,
      now: nowIso(),
    });
  } else {
    completePlanningCheckpoint(db, {
      requestId: input.binding.checkpointRequestId,
      requestHash: input.binding.requestHash,
      councilRunId: lookup.result.councilRunId,
      responseHash: lookup.result.responseHash,
      now: nowIso(),
    });
  }
  return recoveredCouncilCallResult(
    lookup.result,
    input.preserveExactContent,
    input.recovered,
  );
}

async function resolvePriorPlanningResult({
  client,
  requestHash,
  request,
  checkpoint,
  taskType,
  preserveExactContent,
}: {
  client: OpenAI;
  requestHash: string;
  request: CouncilCompletionRequest;
  checkpoint: LearnPlanningRequestCheckpoint;
  taskType: CouncilTaskType;
  preserveExactContent: boolean;
}): Promise<CouncilCallResult | PlanningReceiptRedispatch | null> {
  const current = db.prepare("SELECT * FROM learn_jobs WHERE id = ?").get(checkpoint.jobId) as
    | LearnJobRow
    | undefined;
  if (!current || current.garden_id !== request.gardenId) {
    throw new LearnPlanningRecoveryConflictError(
      "The current Learn job no longer matches its recoverable planning request.",
    );
  }

  const priorRows = priorPlanningCheckpoints(db, {
    currentJobId: checkpoint.jobId,
    gardenId: current.garden_id,
    stageKey: checkpoint.stageKey,
    semanticAttempt: checkpoint.semanticAttempt,
  });
  const eligibleRows: EligiblePriorPlanningCheckpoint[] = [];
  for (const row of priorRows) {
    const exactBinding = row.result_origin === "receipt"
      ? exactStrictReceiptOriginBinding(row, current)
      : exactPlanningOriginBinding(row, current);
    if (
      exactBinding &&
      row.result_origin === "receipt" &&
      row.state === "started" &&
      hasExactExpiredStartedPlanningReceiptBoundary(db, row.request_id)
    ) {
      // This exact receipt was previously observed past the provider's finite
      // lifetime and durably sealed. It is no longer live ambiguity evidence,
      // so a later job may establish a fresh strict request identity.
      continue;
    }
    const abandonedLineage = exactBinding
      ? exactAbandonedPlanningRecoveryLineage(
          row,
          current,
          checkpoint.contentPath,
        )
      : null;
    const validAbandonedLineage =
      abandonedLineage &&
      !abandonedLineage.malformedEvents &&
      abandonedLineage.recoveredAt
        ? {
            recoveredAt: abandonedLineage.recoveredAt,
            events: abandonedLineage.events,
            malformedEvents: false as const,
          }
        : undefined;
    const disposition = planningCheckpointRecoveryDisposition({
      state: row.state,
      resultOrigin: row.result_origin,
      exactBinding,
      abandonedLineage: abandonedLineage
        ? validAbandonedLineage
          ? "valid"
          : "invalid"
        : "none",
    });
    if (disposition === "conflict") {
      throw new LearnPlanningRecoveryConflictError(
        "A prior Learn planning checkpoint has conflicting recovery lineage; no model request was issued.",
      );
    }
    if (disposition === "eligible") {
      // The still-started row is itself durable ambiguity evidence. It must be
      // resolved (or fail closed) even when the failed job's display error was
      // an ordinary timeout/reset rather than startup abandonment.
      eligibleRows.push({
        row,
        ...(validAbandonedLineage ? { abandonedFence: validAbandonedLineage } : {}),
      });
    }
    // A clean completed receipt from an ordinary semantic-failure job is not
    // replayed: it was already observed and knowingly rejected by that run.
  }
  const unresolvedEligibleRows =
    await omitTerminallySettledMismatchedPlanningReceipts({
      client,
      requestHash,
      expectedModel: request.model,
      checkpoint,
      candidates: eligibleRows,
    });
  let exactCheckpoint: (typeof unresolvedEligibleRows)[number] | null;
  try {
    exactCheckpoint = await resolveUniquePlanningCandidate({
      candidates: unresolvedEligibleRows.map((entry) => ({
        candidate: entry,
        disposition: "eligible" as const,
        requestHash: entry.row.request_hash,
      })),
      expectedRequestHash: requestHash,
      resolve: async (entry) => entry,
    });
  } catch (error) {
    if (!(error instanceof PlanningRecoveryBoundaryError)) throw error;
    const message = error.code === "request_hash_mismatch"
      ? "An eligible prior checkpoint for this exact stage and semantic attempt has a different request hash; no model request was issued."
      : "Multiple or conflicting exact Learn planning checkpoints exist; no model request was issued.";
    throw new LearnPlanningRecoveryConflictError(message);
  }
  if (exactCheckpoint) {
    const { row, abandonedFence } = exactCheckpoint;
    const lookup =
      row.result_origin === "legacy"
        ? await promptlessCouncilResultGet(client, "/internal/council-results/legacy-resolve", {
            requestHash,
            createdAfter: row.job_created_at,
            createdBefore: abandonedFence!.recoveredAt,
            reasoningEffort: LEARN_REASONING.effort,
            reasoningSummary: LEARN_REASONING.summary,
          })
        : await promptlessCouncilResultGet(client, "/internal/council-results/resolve", {
            requestId: row.receipt_request_id ?? row.request_id,
            requestHash,
          });
    if (lookup.status !== 200 || !lookup.result) {
      if (
        row.result_origin === "receipt" &&
        row.state === "started" &&
        lookup.status === 409 &&
        lookup.code === "request_started" &&
        lookup.receipt
      ) {
        const observedAt = nowIso();
        const boundary = recordExpiredStartedPlanningReceiptBoundary(db, {
          originRequestId: row.request_id,
          receiptRequestId: row.receipt_request_id ?? row.request_id,
          requestHash,
          dispatchGeneration: lookup.receipt.dispatchGeneration,
          dispatchCount: lookup.receipt.dispatchCount,
          redispatchCount: lookup.receipt.redispatchCount,
          redispatchAllowed: lookup.receipt.redispatchAllowed,
          attemptCount: lookup.receipt.attempts.length,
          observedAt,
          maxStartedAgeMs: LEARN_COUNCIL_STARTED_RECEIPT_MAX_AGE_MS,
        });
        if (boundary) {
          appendLearnEvent(
            checkpoint.contentPath,
            current.garden_id,
            "learn_planning_started_receipt_expired",
            {
              jobId: checkpoint.jobId,
              originJobId: row.job_id,
              stageKey: checkpoint.stageKey,
              semanticAttempt: checkpoint.semanticAttempt,
              receiptRequestId: boundary.receipt_request_id,
              dispatchCount: boundary.dispatch_count,
              startedAt: boundary.started_at,
              observedAt: boundary.observed_at,
              maxStartedAgeMs: boundary.max_started_age_ms,
              freshRequestAuthorized: true,
            },
          );
          return null;
        }
      }
      if (
        row.result_origin === "receipt" &&
        row.state === "started" &&
        lookup.status === 409 &&
        lookup.code === "request_failed" &&
        lookup.receipt?.dispatchGeneration === 1 &&
        lookup.receipt.dispatchCount === 1 &&
        lookup.receipt.redispatchCount === 0 &&
        lookup.receipt.redispatchAllowed === true &&
        typeof lookup.receipt.failureCode === "string" &&
        Boolean(lookup.receipt.failureCode)
      ) {
        // ChatMock durably proved that generation one terminated without a
        // reusable answer and explicitly authorized one bounded redispatch.
        // Reuse the exact receipt id/hash so the server's generation fence,
        // rather than a new logical request, decides the retry atomically.
        return {
          kind: "same_receipt_redispatch",
          requestId: row.receipt_request_id ?? row.request_id,
          checkpointRequestId: row.request_id,
          requestHash,
          redispatchReason: "request_failed",
        };
      }
      if (
        row.result_origin === "receipt" &&
        row.state === "started" &&
        lookup.status === 404 &&
        lookup.code === "receipt_not_found"
      ) {
        // The strict server receipt is created before provider dispatch. Its
        // exact absence proves the old process stopped in the local
        // checkpoint-to-HTTP gap. Reuse the same id/hash so a delayed old POST
        // and this retry still race through one O_EXCL server fence.
        return {
          kind: "same_receipt_redispatch",
          requestId: row.receipt_request_id ?? row.request_id,
          checkpointRequestId: row.request_id,
          requestHash,
          redispatchReason: "receipt_not_found",
        };
      }
      throw new LearnPlanningRecoveryConflictError(
        `An exact ambiguous Learn planning request has no unique reusable result (${lookup.code ?? `HTTP ${lookup.status}`}); no model request was issued.`,
      );
    }
    assertExactRecoveredPlanningRouting(lookup.result, request.model);
    if (row.result_origin === "legacy") {
      try {
        const waiver = readExactLegacyPlanningWaiver({
          contentPath: checkpoint.contentPath,
          expectedBinding: legacyPlanningWaiverBinding(row, abandonedFence!.recoveredAt),
        });
        if (waiver) {
          assertLegacyPlanningWaiverPredatesCurrentJob({
            receipt: waiver,
            currentJobCreatedAt: current.created_at,
          });
          assertLegacyPlanningWaiverContainsResult({
            receipt: waiver,
            candidate: {
              requestHash,
              councilRunId: lookup.result.councilRunId,
              responseHash: lookup.result.responseHash,
            },
          });
        }
      } catch (error) {
        throw new LearnPlanningRecoveryConflictError(
          `The exact legacy checkpoint conflicts with its migration waiver (${errorMessage(error)}); no model request was issued.`,
        );
      }
    }
    if (
      row.state === "completed" &&
      (row.council_run_id !== lookup.result.councilRunId ||
        row.response_hash !== lookup.result.responseHash)
    ) {
      throw new LearnPlanningRecoveryConflictError(
        "The durable Learn checkpoint conflicts with the recovered Council result.",
      );
    }
    if (row.result_origin === "receipt") {
      completePlanningCheckpointWithAdoption(db, {
        originRequestId: row.request_id,
        receiptRequestId: row.receipt_request_id ?? row.request_id,
        requestHash,
        councilRunId: lookup.result.councilRunId,
        responseHash: lookup.result.responseHash,
        adoptionRequestId: makeId("lrqa"),
        adoptingJobId: checkpoint.jobId,
        gardenId: current.garden_id,
        stageKey: checkpoint.stageKey,
        semanticAttempt: checkpoint.semanticAttempt,
        now: nowIso(),
      });
    } else if (row.state === "started") {
      // Legacy started rows are never expected under the current schema, but
      // retain the exact completion guard if an older migration produced one.
      completePlanningCheckpoint(db, {
        requestId: row.request_id,
        requestHash,
        councilRunId: lookup.result.councilRunId,
        responseHash: lookup.result.responseHash,
        now: nowIso(),
      });
    }
    appendLearnEvent(checkpoint.contentPath, current.garden_id, "learn_planning_result_recovered", {
      jobId: checkpoint.jobId,
      originJobId: row.job_id,
      stageKey: checkpoint.stageKey,
      semanticAttempt: checkpoint.semanticAttempt,
      councilRunId: lookup.result.councilRunId,
      legacy: row.result_origin === "legacy",
    });
    return recoveredCouncilCallResult(lookup.result, preserveExactContent);
  }

  const checkpointedOriginIds = new Set(priorRows.map((row) => row.job_id));
  const legacyCandidates: Array<{
    origin: PriorRecoveredPlanningJobRow;
    fence: {
      recoveredAt: string;
      events: Array<Record<string, unknown>>;
      malformedEvents: boolean;
    };
    result: PromptlessCouncilRecoveryResult;
  }> = [];
  const recoveredOrigins = priorRecoveredPlanningJobs(db, {
    currentJobId: checkpoint.jobId,
    gardenId: current.garden_id,
  });
  const currentHasNativePlanningEpoch = hasCompletedNativePlanningCheckpoint(
    db,
    checkpoint.jobId,
  );
  let migrationSealedAt: string | null = null;
  let migrationOriginJobId: string | null = null;
  if (!currentHasNativePlanningEpoch) {
    // A legacy waiver is also the explicit pre-run boundary after which every
    // planning POST uses the strict checkpoint-before-dispatch protocol. Find
    // that boundary before classifying any newer recovered job: the newer job
    // may itself be a zero-dispatch failure from this migration attempt.
    for (const origin of recoveredOrigins) {
      if (
        checkpointedOriginIds.has(origin.job_id) ||
        !exactPlanningOriginBinding(origin, current)
      ) {
        continue;
      }
      const originCounts = planningCheckpointOriginCounts(db, origin.job_id);
      if (originCounts.nativeReceiptCount > 0) continue;
      const fence = exactAbandonedPlanningRecoveryLineage(
        origin,
        current,
        checkpoint.contentPath,
      );
      if (!fence || fence.malformedEvents || !fence.recoveredAt) continue;
      let waiver: ReturnType<typeof readExactLegacyPlanningWaiver>;
      try {
        waiver = readExactLegacyPlanningWaiver({
          contentPath: checkpoint.contentPath,
          expectedBinding: legacyPlanningWaiverBinding(origin, fence.recoveredAt),
        });
        if (waiver) {
          assertLegacyPlanningWaiverPredatesCurrentJob({
            receipt: waiver,
            currentJobCreatedAt: current.created_at,
          });
        }
      } catch (error) {
        throw new LearnPlanningRecoveryConflictError(
          `The explicit legacy planning migration waiver is corrupt or stale (${errorMessage(error)}); no model request was issued.`,
        );
      }
      if (!waiver) continue;
      if (migrationOriginJobId !== null) {
        throw new LearnPlanningRecoveryConflictError(
          "Multiple legacy planning migration boundaries match this retry; no model request was issued.",
        );
      }
      migrationOriginJobId = origin.job_id;
      migrationSealedAt = waiver.createdAt;
    }
  }
  for (const origin of recoveredOrigins) {
    if (checkpointedOriginIds.has(origin.job_id)) continue;
    if (currentHasNativePlanningEpoch) {
      // One completed/adopted native receipt is the durable post-migration
      // epoch for this retry job. The singular legacy waiver may authorize
      // only the first exact boundary; downstream stages use native receipts.
      continue;
    }
    // A different immutable user/selection/model origin is legitimately
    // unrelated. If that durable base matches but the legacy-only
    // source/policy evidence is missing or corrupt, it is ambiguity rather
    // than permission to send another request.
    if (!exactStrictReceiptOriginBinding(origin, current)) continue;
    const originCounts = planningCheckpointOriginCounts(db, origin.job_id);
    if (originCounts.nativeReceiptCount > 0) {
      // Native receipt rows are handled only by the strict request-id resolver;
      // never mix post-deployment jobs into the pre-receipt ledger bridge.
      continue;
    }
    const originDisposition = classifyRecoveredLegacyPlanningOrigin({
      origin,
      current,
      checkpointCount:
        originCounts.nativeReceiptCount + originCounts.materializedLegacyCount,
      migrationSealedAt,
      expectedRequestModel: request.model,
      expectedReasoningEffort: LEARN_REASONING.effort,
      expectedReasoningSummary: LEARN_REASONING.summary,
    });
    if (originDisposition === "unrelated") continue;
    if (originDisposition === "proven_unissued") {
      const fence = exactAbandonedPlanningRecoveryLineage(
        origin,
        current,
        checkpoint.contentPath,
      );
      if (!fence || fence.malformedEvents || !fence.recoveredAt) {
        throw new LearnPlanningRecoveryConflictError(
          "A post-migration Learn job has no exact durable recovery/time fence; no model request was issued.",
        );
      }
      continue;
    }
    if (originDisposition !== "exact") {
      throw new LearnPlanningRecoveryConflictError(
        "An abandoned pre-receipt Learn job matches this selection but its legacy source/model policy evidence is incomplete; no model request was issued.",
      );
    }
    const fence = exactAbandonedPlanningRecoveryLineage(
      origin,
      current,
      checkpoint.contentPath,
    );
    if (!fence || fence.malformedEvents || !fence.recoveredAt) {
      throw new LearnPlanningRecoveryConflictError(
        "The abandoned pre-receipt job has no exact durable recovery/time fence; no model request was issued.",
      );
    }
    let waiver: ReturnType<typeof readExactLegacyPlanningWaiver>;
    try {
      waiver = readExactLegacyPlanningWaiver({
        contentPath: checkpoint.contentPath,
        expectedBinding: legacyPlanningWaiverBinding(origin, fence.recoveredAt),
      });
      if (waiver) {
        assertLegacyPlanningWaiverPredatesCurrentJob({
          receipt: waiver,
          currentJobCreatedAt: current.created_at,
        });
      }
    } catch (error) {
      throw new LearnPlanningRecoveryConflictError(
        `The explicit legacy planning migration waiver is corrupt or stale (${errorMessage(error)}); no model request was issued.`,
      );
    }
    // The exact envelope hash is stage-local proof. Probe it even when the old
    // best-effort schema-repair event is absent; unrelated global Learn model
    // counters must never be assigned to this logical stage.
    const lookup = await promptlessCouncilResultGet(
      client,
      "/internal/council-results/legacy-resolve",
      {
        requestHash,
        createdAfter: origin.job_created_at,
        createdBefore: fence.recoveredAt,
        reasoningEffort: LEARN_REASONING.effort,
        reasoningSummary: LEARN_REASONING.summary,
      },
    );
    if (lookup.status === 200 && lookup.result) {
      if (waiver) {
        try {
          assertNextLegacyPlanningWaiverResult({
            receipt: waiver,
            materialized: materializedLegacyPlanningResults(db, origin.job_id),
            candidate: {
              requestHash,
              councilRunId: lookup.result.councilRunId,
              responseHash: lookup.result.responseHash,
            },
          });
        } catch (error) {
          throw new LearnPlanningRecoveryConflictError(
            `The recovered legacy planning result conflicts with the sealed sequence (${errorMessage(error)}); no model request was issued.`,
          );
        }
      }
      legacyCandidates.push({
        origin,
        fence: { ...fence, recoveredAt: fence.recoveredAt },
        result: lookup.result,
      });
      continue;
    }
    if (lookup.status === 404) {
      if (lookup.code !== "legacy_not_found") {
        throw new LearnPlanningRecoveryConflictError(
          `The legacy Council lookup returned a non-authoritative not-found response (${lookup.code ?? "missing_code"}); no model request was issued.`,
        );
      }
      if (waiver) {
        try {
          assertLegacyPlanningWaiverFullyMaterialized({
            receipt: waiver,
            materialized: materializedLegacyPlanningResults(db, origin.job_id),
          });
        } catch (error) {
          throw new LearnPlanningRecoveryConflictError(
            `The sealed legacy planning sequence is incomplete (${errorMessage(error)}); no model request was issued.`,
          );
        }
        // A waiver is an explicit operator gate, not inferred negative proof.
        // Re-resolve every listed exact result so ledger deletion/tampering
        // invalidates the seal before a new native receipt can be created.
        for (const sealed of waiver.results) {
          const sealedLookup = await promptlessCouncilResultGet(
            client,
            "/internal/council-results/legacy-resolve",
            {
              requestHash: sealed.requestHash,
              createdAfter: origin.job_created_at,
              createdBefore: fence.recoveredAt,
              reasoningEffort: LEARN_REASONING.effort,
              reasoningSummary: LEARN_REASONING.summary,
            },
          );
          if (sealedLookup.status !== 200 || !sealedLookup.result) {
            throw new LearnPlanningRecoveryConflictError(
              "A Council result listed by the legacy migration waiver is no longer uniquely resolvable; no model request was issued.",
            );
          }
          assertExactRecoveredPlanningRouting(sealedLookup.result, request.model);
          if (
            sealedLookup.result.councilRunId !== sealed.councilRunId ||
            sealedLookup.result.responseHash !== sealed.responseHash
          ) {
            throw new LearnPlanningRecoveryConflictError(
              "A Council result conflicts with the legacy migration waiver; no model request was issued.",
            );
          }
        }
        // This full promptless inventory is deliberately the final network
        // observation before exercising the seal. It catches a completed
        // legacy snapshot that appeared after operator sealing but before the
        // first native dispatch boundary.
        const liveInventory = await promptlessLegacyPlanningInventoryGet(
          client,
          waiver.binding,
        );
        try {
          assertLegacyPlanningWaiverMatchesInventory({
            receipt: waiver,
            inventory: liveInventory,
          });
          persistLegacyPlanningWaiverExercise({
            contentPath: checkpoint.contentPath,
            currentJobId: checkpoint.jobId,
            gardenId: current.garden_id,
            stageKey: checkpoint.stageKey,
            semanticAttempt: checkpoint.semanticAttempt,
            requestHash,
            exactLookupCode: "legacy_not_found",
            originJobId: origin.job_id,
            waiverIntegrityHash: waiver.integrityHash,
            now: nowIso(),
          });
        } catch (error) {
          throw new LearnPlanningRecoveryConflictError(
            `The live legacy planning inventory or waiver exercise is invalid (${errorMessage(error)}); no model request was issued.`,
          );
        }
        continue;
      }
      const issuanceEvidence = classifyLegacyStageIssuanceEvidence({
        events: fence.events,
        taskType,
        stageKey: checkpoint.stageKey,
        stageLabel: checkpoint.stageLabel,
        semanticAttempt: checkpoint.semanticAttempt,
        initialPlanningStageKey: origin.job_syllabus_source_id
          ? "source_map:syllabus_reading"
          : "source_map:source_map:cycle:0",
        jobCreatedAt: origin.job_created_at,
        recoveredAt: fence.recoveredAt,
      });
      throw new LearnPlanningRecoveryConflictError(
        issuanceEvidence === "issued"
          ? "Durable stage-local evidence proves this exact legacy planning attempt may have started, but no reusable result exists; no model request was issued."
          : issuanceEvidence === "ambiguous"
            ? "The abandoned job's stage-local planning issuance evidence is corrupt; no model request was issued."
            : "A pre-receipt job may have crossed provider dispatch without persisting a counter, event, or ledger snapshot; absence of an exact result cannot authorize another model request.",
      );
    }
    throw new LearnPlanningRecoveryConflictError(
      `The pre-receipt Council ledger cannot uniquely resolve this exact planning request (${lookup.code ?? `HTTP ${lookup.status}`}); no model request was issued.`,
    );
  }
  if (legacyCandidates.length > 1) {
    throw new LearnPlanningRecoveryConflictError(
      "Multiple abandoned jobs prove issuance of this legacy planning request; no model request was issued.",
    );
  }
  if (legacyCandidates.length === 1) {
    const { origin, result } = legacyCandidates[0];
    assertExactRecoveredPlanningRouting(result, request.model);
    const legacyRequestId = makeId("lrq_legacy");
    materializeLegacyPlanningCheckpoint(db, {
      requestId: legacyRequestId,
      originJobId: origin.job_id,
      gardenId: current.garden_id,
      stageKey: checkpoint.stageKey,
      semanticAttempt: checkpoint.semanticAttempt,
      requestHash,
      councilRunId: result.councilRunId,
      responseHash: result.responseHash,
      now: nowIso(),
    });
    appendLearnEvent(checkpoint.contentPath, current.garden_id, "learn_planning_result_recovered", {
      jobId: checkpoint.jobId,
      originJobId: origin.job_id,
      stageKey: checkpoint.stageKey,
      semanticAttempt: checkpoint.semanticAttempt,
      councilRunId: result.councilRunId,
      legacy: true,
    });
    return recoveredCouncilCallResult(result, preserveExactContent);
  }
  return null;
}

function sourceMapPlanProblems(input: {
  value: unknown;
  sourceIds: readonly string[];
  sourceBodies: readonly { sourceId: string; body: string }[];
  registeredArtifacts: readonly Pick<SourceFigure, "figureId" | "sourceId" | "kind" | "page" | "caption">[];
  canonicalAnchors: readonly { id: string; sourceId: string }[];
  syllabusUnits: readonly { id: string; questionReferences: readonly string[] }[];
}): string[] {
  const record = planningRecord(input.value);
  const problems: string[] = [];
  const rawSources = Array.isArray(record.sources) ? record.sources : [];
  if (!Array.isArray(record.sources)) problems.push("sources must be an array");
  const expectedSourceIds = new Set(input.sourceIds);
  const seenSourceIds = new Set<string>();
  rawSources.forEach((rawSource, index) => {
    const source = planningRecord(rawSource);
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || !expectedSourceIds.has(id)) {
      problems.push(`sources[${index}].id must be an exact supplied source id`);
    } else if (seenSourceIds.has(id)) {
      problems.push(`source ${id} appears more than once`);
    } else {
      seenSourceIds.add(id);
    }
    if (typeof source.title !== "string" || !source.title.trim()) {
      problems.push(`sources[${index}].title is required`);
    }
    if (typeof source.role !== "string" || !source.role.trim()) {
      problems.push(`sources[${index}].role is required`);
    }
    for (const field of ["centralConcepts", "formulas", "examples", "questions", "caveats"]) {
      if (!Array.isArray(source[field]) || !(source[field] as unknown[]).every((item) => typeof item === "string")) {
        problems.push(`sources[${index}].${field} must be an array of strings`);
      }
    }
  });
  for (const sourceId of expectedSourceIds) {
    if (!seenSourceIds.has(sourceId)) problems.push(`source ${sourceId} is missing from the Source Map`);
  }

  const figures = Array.isArray(record.figures) ? record.figures : [];
  if (!Array.isArray(record.figures)) problems.push("figures must be an array");
  const registeredArtifactById = new Map<string, {
    sourceId: string;
    kind: RegisteredSourceArtifact["kind"];
  }>();
  for (const artifact of input.registeredArtifacts) {
    const sourceId = typeof artifact.sourceId === "string" ? artifact.sourceId : "";
    if (!artifact.figureId || !sourceId) {
      problems.push("registered source artifacts require exact ids and source ids");
      continue;
    }
    if (registeredArtifactById.has(artifact.figureId)) {
      problems.push(`registered source artifact ${artifact.figureId} appears more than once`);
      continue;
    }
    const kind = sourceMapArtifactKind(artifact.kind);
    registeredArtifactById.set(artifact.figureId, { sourceId, kind });
  }
  const registeredArtifactIds = new Set(registeredArtifactById.keys());
  const seenArtifactIds = new Set<string>();
  figures.forEach((rawFigure, index) => {
    const figure = planningRecord(rawFigure);
    const rawId = typeof figure.id === "string" ? figure.id : "";
    const id = rawId.trim();
    const rawSourceId = typeof figure.sourceId === "string" ? figure.sourceId : "";
    const sourceId = rawSourceId.trim();
    const registered = registeredArtifactById.get(id);
    if (!id || !registeredArtifactIds.has(id)) {
      problems.push(`figures[${index}].id must be copied from registered sourceVisuals`);
    } else if (rawId !== id) {
      problems.push(`figures[${index}].id must copy the registered artifact id exactly`);
    } else if (seenArtifactIds.has(id)) {
      problems.push(`registered artifact ${id} appears more than once`);
    } else {
      seenArtifactIds.add(id);
    }
    if (!expectedSourceIds.has(sourceId)) {
      problems.push(`figures[${index}].sourceId must be an exact supplied source id`);
    } else if (rawSourceId !== sourceId) {
      problems.push(`figures[${index}].sourceId must copy the registered source id exactly`);
    } else if (registered && registered.sourceId !== sourceId) {
      problems.push(`figures[${index}].sourceId must match registered artifact ${id}`);
    }
    const rawKind = typeof figure.kind === "string" ? figure.kind : "";
    if (!registered) {
      problems.push(`figures[${index}].kind must copy the registered artifact kind`);
    } else if (rawKind !== registered.kind) {
      problems.push(
        `figures[${index}].kind must match registered artifact ${id} (expected ${registered.kind}, received ${rawKind || "missing"})`,
      );
    }
  });
  for (const artifactId of registeredArtifactIds) {
    if (!seenArtifactIds.has(artifactId)) {
      problems.push(`registered source artifact ${artifactId} is missing from figures`);
    }
  }

  const anchors = Array.isArray(record.sourceAnchors) ? record.sourceAnchors : [];
  if (!Array.isArray(record.sourceAnchors)) problems.push("sourceAnchors must be an array");
  const canonicalAnchorById = new Map(input.canonicalAnchors.map((anchor) => [anchor.id, anchor]));
  const seenAnchorIds = new Set<string>();
  const anchoredSourceIds = new Set<string>();
  anchors.forEach((rawAnchor, index) => {
    const anchor = planningRecord(rawAnchor);
    const id = typeof anchor.id === "string" ? anchor.id.trim() : "";
    const canonical = canonicalAnchorById.get(id);
    if (!id || !canonical) {
      problems.push(`sourceAnchors[${index}].id must be copied from canonicalSourceAnchors`);
    } else if (seenAnchorIds.has(id)) {
      problems.push(`canonical source anchor ${id} appears more than once`);
    } else {
      seenAnchorIds.add(id);
    }
    const sourceId = typeof anchor.sourceId === "string" ? anchor.sourceId.trim() : "";
    if (!expectedSourceIds.has(sourceId)) {
      problems.push(`sourceAnchors[${index}].sourceId must be an exact supplied source id`);
    } else if (canonical && canonical.sourceId !== sourceId) {
      problems.push(`sourceAnchors[${index}].sourceId must match canonical anchor ${id}`);
    } else {
      anchoredSourceIds.add(sourceId);
    }
    if (typeof anchor.title !== "string" || !anchor.title.trim()) {
      problems.push(`sourceAnchors[${index}].title is required`);
    }
    if (typeof anchor.summary !== "string" || !anchor.summary.trim()) {
      problems.push(`sourceAnchors[${index}].summary is required`);
    }
  });
  for (const sourceId of expectedSourceIds) {
    if (!anchoredSourceIds.has(sourceId)) {
      problems.push(`source ${sourceId} must have at least one selected canonical source anchor`);
    }
  }
  if (!Array.isArray(record.missingOrUnclear) || !record.missingOrUnclear.every((item) => typeof item === "string")) {
    problems.push("missingOrUnclear must be an array of strings");
  }
  const authoredText = JSON.stringify(record);
  const unavailableClaim = (subject: RegExp) =>
    new RegExp(
      `${subject.source}[^.\\n]{0,100}(?:not (?:present|available|included|provided|detected)|unavailable|caption[- ]only)`,
      "i",
    ).test(authoredText);
  if (
    input.registeredArtifacts.some((artifact) => artifact.kind === "formula") &&
    unavailableClaim(/(?:formula|equation|mathematical notation|mathematical definition)s?/)
  ) {
    problems.push("Source Map contradicts the registry by claiming available formula/equation evidence is unavailable");
  }
  if (
    input.registeredArtifacts.some((artifact) => artifact.kind === "table") &&
    unavailableClaim(/tables?/)
  ) {
    problems.push("Source Map contradicts the registry by claiming available table evidence is unavailable");
  }
  if (
    input.registeredArtifacts.some((artifact) => artifact.kind !== "formula" && artifact.kind !== "table") &&
    unavailableClaim(/(?:figure|graph)s?/)
  ) {
    problems.push("Source Map contradicts the registry by claiming available figure/graph evidence is unavailable");
  }
  if (
    input.registeredArtifacts.some((artifact) => Number(artifact.page) > 24) &&
    /(?:truncated|available only|only available)[^.\n]{0,80}(?:page\s*24|first\s*24\s*pages)|later (?:pages|sections)[^.\n]{0,80}(?:not available|unavailable)/i.test(authoredText)
  ) {
    problems.push("Source Map contradicts the registry by claiming later source pages are unavailable");
  }
  problems.push(...sourceQuestionPlanProblems({
    value: input.value,
    sourceIds: input.sourceIds,
    sourceBodies: input.sourceBodies,
    canonicalAnchors: input.canonicalAnchors,
    registeredFigures: input.registeredArtifacts.filter((artifact) => {
      const kind = sourceMapArtifactKind(artifact.kind);
      return kind === "figure" || kind === "graph";
    }),
    syllabusUnits: input.syllabusUnits,
  }));
  return [...new Set(problems)];
}

function scopeContractProblems(value: unknown): string[] {
  const record = planningRecord(value);
  const problems: string[] = [];
  for (const field of ["included", "excluded", "background", "deferred", "sourceEmphasis", "caveats"]) {
    if (!Array.isArray(record[field]) || !(record[field] as unknown[]).every((item) => typeof item === "string")) {
      problems.push(`${field} must be an array of strings`);
    }
  }
  if (!Array.isArray(record.included) || record.included.length === 0) {
    problems.push("included must contain at least one model-authored scope item");
  }
  if (!Array.isArray(record.sourceEmphasis) || record.sourceEmphasis.length === 0) {
    problems.push("sourceEmphasis must contain at least one model-authored priority");
  }
  return [...new Set(problems)];
}

function errorMessage(error: unknown, fallback = "Request failed"): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : typeof error === "string" && error.trim()
        ? error.trim()
        : fallback;
  if (/^(connection error\.?|fetch failed)$/i.test(message) || /\beconnrefused\b/i.test(message)) {
    return "The AI service connection was lost during Learn. Retry Learn; if it fails again, restart Breadboard's AI service.";
  }
  return message;
}

async function rethrowAfterBestEffortLearnFailureCleanup(
  authoritativeError: unknown,
  cleanup: () => void | Promise<void>,
): Promise<never> {
  try {
    await cleanup();
  } catch {
    // Rollback, persistence, and telemetry are subordinate to the exact error
    // from the model/provider boundary that caused this unwind.
  }
  throw authoritativeError;
}

function importantSourceArtifactCount(context: LearnSourceContext): number {
  return context.sourceFigures.filter((figure) => Boolean(figure.figureId)).length;
}

function modelAuthoredLearningMapMetadataProblems(value: unknown): string[] {
  const record = planningRecord(value);
  const problems: string[] = [];
  if (typeof record.title !== "string" || !record.title.trim()) {
    problems.push("planner returned no model-authored garden title");
  } else if (sanitizeLearnerTitle(record.title.trim()) !== record.title.trim()) {
    problems.push(
      `model-authored garden title violates learner-facing title rules; return it already corrected as "${sanitizeLearnerTitle(record.title.trim())}"`,
    );
  }
  if (typeof record.summary !== "string" || !record.summary.trim()) {
    problems.push("planner returned no model-authored garden summary");
  }
  return problems;
}

function modelAuthoredUnitTitleProblems(units: readonly LearningUnitContract[]): string[] {
  const problems: string[] = [];
  for (const unit of units) {
    if (unit.title && sanitizeLearnerTitle(unit.title) !== unit.title) {
      problems.push(
        `unit "${unit.id}": model-authored title violates learner-facing title rules; return it already corrected as "${sanitizeLearnerTitle(unit.title)}"`,
      );
    }
    const sectionTitle = unit.sectionPlan?.title;
    if (sectionTitle && sanitizeLearnerTitle(sectionTitle) !== sectionTitle) {
      problems.push(
        `section "${unit.sectionPlan?.id}": model-authored title violates learner-facing title rules; return it already corrected as "${sanitizeLearnerTitle(sectionTitle)}"`,
      );
    }
  }
  return [...new Set(problems)];
}

function planningRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function learningMapFromPlanningCandidate({
  candidate,
  units,
  gardenId,
  sourceOnly,
  createdAt,
  warnings = [],
}: {
  candidate: unknown;
  units: LearningUnitContract[];
  gardenId: string;
  sourceOnly: boolean;
  createdAt: string;
  warnings?: string[];
}): ProposedLearningMap {
  const record = planningRecord(candidate);
  if (typeof record.title !== "string" || typeof record.summary !== "string") {
    throw new Error("Model-authored learning-map title and summary are required.");
  }
  return learningMapFromModelAuthoredUnits(units, {
    gardenId,
    title: record.title,
    summary: record.summary,
    sourceOnly,
    createdAt,
    warnings,
  });
}

function modelAuthoredLearningMapDepthProblems({
  candidate,
  units,
  gardenId,
  sourceOnly,
  context,
}: {
  candidate: unknown;
  units: LearningUnitContract[];
  gardenId: string;
  sourceOnly: boolean;
  context: LearnSourceContext;
}): string[] {
  try {
    return validateLearningMapDepth(
      learningMapFromPlanningCandidate({
        candidate,
        units,
        gardenId,
        sourceOnly,
        createdAt: nowIso(),
      }),
      context,
    );
  } catch {
    // Exact metadata and section-projection failures are already reported by
    // their dedicated hard validators in the same candidate evaluation.
    return [];
  }
}

function sourceCoveragePlan(
  context: LearnSourceContext,
  learningMap: ProposedLearningMap,
  learningUnits: LearningUnitContract[] = [],
  sourceArtifactAssignments: SourceArtifactAssignment[] = [],
  sourceArtifactOmissions: SourceArtifactOmission[] = [],
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>> = {},
  syllabusCoverage: SyllabusCoverage | null = null,
): unknown {
  const syllabusCoverageEvidenceRecovery = syllabusCoverage?.evidenceRecovery;
  const syllabusCoverageEvidenceRecoveryHash =
    syllabusCoverageEvidenceRecovery?.integritySha256 ?? "";
  return {
    sourceSetHash: context.sourceSetHash,
    sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
    sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    syllabusCoverageEvidenceRecoveryHash,
    ...(syllabusCoverageEvidenceRecovery
      ? { syllabusCoverageEvidenceRecovery }
      : {}),
    learningUnitContracts: learningUnits,
    sourceArtifactAssignments,
    sourceArtifactOmissions,
    sources: context.sources.map((source) => ({
      id: source.slug,
      title: source.title,
      plannedPages: learningMap.sections.flatMap((section) =>
        section.subsections
          .filter((subsection) => {
            const anchorIds = [...section.sourceAnchors, ...subsection.sourceAnchors];
            return anchorIds.some((anchorId) => canonicalSourceAnchors[anchorId]?.sourceId === source.slug);
          })
          .map((subsection) => `${section.title} / ${subsection.title}`),
      ),
    })),
    figures: context.sourceFigures.map((figure) => ({
      figureId: figure.figureId,
      sourceId: figure.sourceId,
      page: figure.page,
      kind: figure.kind,
      assignedLearningUnit:
        sourceArtifactAssignments.find((assignment) => assignment.sourceArtifactId === figure.figureId)
          ?.assignedLearningUnitId ?? "",
      omissionReason:
        sourceArtifactOmissions.find((omission) => omission.sourceArtifactId === figure.figureId)
          ?.reason ?? "",
      suggestedVisualTreatment: figure.suggestedVisualUse ?? "",
    })),
  };
}

function conceptRegistryAlignmentProblems(input: {
  clusterDir: string;
  sourceSetHash: string;
  units: readonly LearningUnitContract[];
}): string[] {
  try {
    buildModelAuthoredConceptRegistry({
      gardenId: path.basename(input.clusterDir),
      sourceSetHash: input.sourceSetHash,
      concepts: input.units.flatMap((unit) => unit.semanticConcepts ?? []),
    });
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function canonicalLearningSpineEvidenceByUnit(
  clusterDir: string,
  units: readonly LearningUnitContract[],
): Record<string, unknown[]> {
  const registry = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  return Object.fromEntries(units.map((unit) => [
    unit.id,
    declaredSourceAnchorIdsForUnit(unit).flatMap((anchorId) => {
      const anchor = registry[anchorId];
      if (!anchor) return [];
      return [{
        id: anchor.id,
        kind: anchor.kind,
        sourceId: anchor.sourceId,
        page: anchor.page,
        title: anchor.title,
        caption: anchor.caption,
        semanticSummary: anchor.semanticSummary,
        exactText: anchor.exactText,
      }];
    }),
  ]));
}

function sourceFormulaReviewSetHashFromCoveragePlan(value: unknown): string | undefined {
  const candidate = planningRecord(value).sourceFormulaReviewSetHash;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function sourceArtifactInventoryHashFromCoveragePlan(value: unknown): string | undefined {
  const candidate = planningRecord(value).sourceArtifactInventoryHash;
  return typeof candidate === "string" && /^[0-9a-f]{64}$/i.test(candidate)
    ? candidate.toLowerCase()
    : undefined;
}

function syllabusCoverageEvidenceRecoveryHashFromCoveragePlan(
  value: unknown,
): string | undefined {
  const candidate = planningRecord(value).syllabusCoverageEvidenceRecoveryHash;
  return typeof candidate === "string" && /^[0-9a-f]{64}$/.test(candidate)
    ? candidate
    : undefined;
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function confirmedVisualRouteBindingHash(binding: ConfirmedVisualRouteBinding): string {
  return sha256Json(binding);
}

/** Bind the model-authoritative contract shape, not incidental JSON key order
 * or optional-field spelling introduced while SQLite round-trips it. */
function learningUnitContractBindingSha256(
  learningUnits: LearningUnitContract[],
): string {
  return sha256Json(
    normalizeLearningUnits({ learningUnits }, { modelAuthoredOnly: true }),
  );
}

function createConfirmedVisualRouteBundle(input: {
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  sourceFormulaReviewSetHash: string | undefined;
  learningUnits: LearningUnitContract[];
  visualNecessityReview: GardenVisualNecessityPlan;
  visualizationPlan: VisualizationPlan;
  executabilityLedger: VisualContractExecutabilityLedger;
}): ConfirmedVisualRouteBundle {
  const sourceFormulaReviewSetHash = input.sourceFormulaReviewSetHash?.trim();
  if (!sourceFormulaReviewSetHash || !isSha256(sourceFormulaReviewSetHash)) {
    throw new LearnPipelineConflictError(
      "Cannot bind a visual route bundle without the confirmed source-formula review hash.",
      { requiresReplan: true },
    );
  }
  const binding: ConfirmedVisualRouteBinding = {
    schemaVersion: 1,
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    sourceFormulaReviewSetHash,
    learningUnitContractSha256: learningUnitContractBindingSha256(input.learningUnits),
    visualNecessityReviewSha256: sha256Json(input.visualNecessityReview),
    visualizationPlanSha256: sha256Json(input.visualizationPlan),
    visualContractExecutabilityLedgerSha256: sha256Json(input.executabilityLedger),
  };
  return {
    visualNecessityReview: structuredClone(input.visualNecessityReview),
    visualizationPlan: structuredClone(input.visualizationPlan),
    executabilityLedger: structuredClone(input.executabilityLedger),
    binding,
  };
}

function visualNecessityReviewBindingProblems(
  review: GardenVisualNecessityPlan | undefined,
  learningUnits: readonly LearningUnitContract[],
): string[] {
  if (!review ||
      !Array.isArray(review.decisions) ||
      !Array.isArray(review.teachingMedia) ||
      !Array.isArray(review.decisionRecords) ||
      !review.budget ||
      !Array.isArray(review.overrides) ||
      !review.zeroVisualSafeguard) {
    return ["the persisted visual-necessity review is missing or malformed"];
  }
  const expectedUnitIds = learningUnits.map((unit) => unit.id);
  const exactCoverageProblems = [
    ["decisions", review.decisions.map((decision) => decision.unitId)],
    ["teaching media", review.teachingMedia.map((medium) => medium.unitId)],
    ["decision records", review.decisionRecords.map((record) => record.unitId)],
  ].flatMap(([label, ids]) => {
    const unitIds = ids as string[];
    return JSON.stringify(unitIds) === JSON.stringify(expectedUnitIds)
      ? []
      : [`persisted visual-necessity ${label} do not exactly cover the confirmed Learning Unit Contract`];
  });
  return exactCoverageProblems;
}

function confirmedVisualRouteBundleProblems(input: {
  gardenId: string;
  map: StoredLearningMap;
  context: LearnSourceContext;
  learningUnits: LearningUnitContract[];
  canonicalEvidenceByUnit?: ReturnType<typeof canonicalVisualizationEvidenceByUnit>;
}): string[] {
  const { map } = input;
  const bundle = {
    visualNecessityReview: map.visualNecessityReview,
    visualizationPlan: map.visualizationPlan,
    executabilityLedger: map.visualContractExecutabilityLedger,
    binding: map.visualRouteBinding,
  };
  if (!bundle.visualizationPlan || !bundle.executabilityLedger || !bundle.binding) {
    return ["the confirmed visual route plan and executability ledger were not persisted with this Learning Map"];
  }
  const problems = visualNecessityReviewBindingProblems(
    bundle.visualNecessityReview,
    input.learningUnits,
  );
  const sourceFormulaReviewSetHash = sourceFormulaReviewSetHashFromCoveragePlan(map.coveragePlan);
  const binding = bundle.binding;
  if (!isSha256(binding.learningUnitContractSha256) ||
      !isSha256(binding.visualNecessityReviewSha256) ||
      !isSha256(binding.visualizationPlanSha256) ||
      !isSha256(binding.visualContractExecutabilityLedgerSha256)) {
    problems.push("the persisted visual route binding has malformed integrity hashes");
  }
  if (binding.schemaVersion !== 1 ||
      binding.sourceSetHash !== map.sourceSetHash ||
      binding.sourceSetHash !== input.context.sourceSetHash ||
      binding.sourceArtifactInventoryHash !== map.sourceArtifactInventoryHash ||
      binding.sourceArtifactInventoryHash !== input.context.sourceArtifactInventoryHash ||
      !sourceFormulaReviewSetHash ||
      binding.sourceFormulaReviewSetHash !== sourceFormulaReviewSetHash ||
      binding.sourceFormulaReviewSetHash !== input.context.sourceFormulaReviewSetHash) {
    problems.push("the persisted visual route binding no longer matches the confirmed source, inventory, or formula-review evidence");
  }
  if (bundle.visualNecessityReview) {
    const expected = createConfirmedVisualRouteBundle({
      sourceSetHash: map.sourceSetHash,
      sourceArtifactInventoryHash: map.sourceArtifactInventoryHash,
      sourceFormulaReviewSetHash,
      learningUnits: input.learningUnits,
      visualNecessityReview: bundle.visualNecessityReview,
      visualizationPlan: bundle.visualizationPlan,
      executabilityLedger: bundle.executabilityLedger,
    }).binding;
    if (JSON.stringify(binding) !== JSON.stringify(expected)) {
      problems.push("the persisted visual route bundle does not match its confirmed-map binding hashes");
    }
  }
  if (bundle.executabilityLedger.context.phase !== "planning" ||
      bundle.executabilityLedger.context.learningMapId !== map.id ||
      bundle.executabilityLedger.context.jobId !== map.jobId) {
    problems.push("the persisted executability ledger is not the planning review for this Learning Map");
  }
  problems.push(...visualContractExecutabilityLinkageProblems({
    gardenId: input.gardenId,
    ledger: bundle.executabilityLedger,
    finalLearningUnits: input.learningUnits,
    visualizationPlan: bundle.visualizationPlan,
    authoritativeCanonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
    expectedContext: bundle.executabilityLedger.context,
  }));
  return [...new Set(problems)];
}

function confirmedVisualRouteBundleForGeneration(input: {
  gardenId: string;
  map: StoredLearningMap;
  context: LearnSourceContext;
  learningUnits: LearningUnitContract[];
  canonicalEvidenceByUnit: ReturnType<typeof canonicalVisualizationEvidenceByUnit>;
}): ConfirmedVisualRouteBundle {
  const problems = confirmedVisualRouteBundleProblems(input);
  if (problems.length > 0 ||
      !input.map.visualNecessityReview ||
      !input.map.visualizationPlan ||
      !input.map.visualContractExecutabilityLedger ||
      !input.map.visualRouteBinding) {
    throw new LearnPipelineConflictError(
      `This confirmed Learning Map has a missing or stale visual route binding: ${problems.join("; ") || "bundle is incomplete"}. Run Learn planning again and confirm the new proposed map before generation.`,
      { requiresReplan: true },
    );
  }
  return {
    visualNecessityReview: structuredClone(input.map.visualNecessityReview),
    visualizationPlan: structuredClone(input.map.visualizationPlan),
    executabilityLedger: structuredClone(input.map.visualContractExecutabilityLedger),
    binding: structuredClone(input.map.visualRouteBinding),
  };
}

function syllabusCoverageRecoverySources(
  context: LearnSourceContext,
): Array<{ sourceId: string; relPath: string; body?: string }> {
  return context.sources.map((source) => ({
    sourceId: source.slug,
    relPath: source.relPath,
    body: source.body,
  }));
}

/**
 * A Source Map reauthor may legitimately follow a late formula review or a
 * newly registered source artifact. Those changes alter the combined
 * `sourceSetHash`, so that hash cannot distinguish a safe evidence rebind from
 * a user/source mutation. Compare the raw teaching/syllabus identities and
 * base source bytes separately, then let the model redo coverage against the
 * refreshed reviewed ledger.
 */
function syllabusCoverageRebindSourceBindingProblems(input: {
  before: LearnSourceContext;
  after: LearnSourceContext;
}): string[] {
  const problems: string[] = [];
  if (input.before.baseSourceSetHash !== input.after.baseSourceSetHash) {
    problems.push("selected teaching-source or syllabus raw evidence changed");
  }
  if (JSON.stringify(input.before.selectedSourceIds) !== JSON.stringify(input.after.selectedSourceIds)) {
    problems.push("selected source ids or their order changed");
  }
  const teachingSourceIdentity = (context: LearnSourceContext) => context.sources.map((source) => ({
    slug: source.slug,
    relPath: source.relPath,
    sourceFile: source.sourceFile ?? "",
  }));
  if (
    JSON.stringify(teachingSourceIdentity(input.before)) !==
      JSON.stringify(teachingSourceIdentity(input.after))
  ) {
    problems.push("selected teaching-source identity changed");
  }
  const syllabusIdentity = (context: LearnSourceContext) => {
    const syllabus = context.syllabus;
    return syllabus
      ? {
          slug: syllabus.slug,
          title: syllabus.title ?? "",
          description: syllabus.description ?? "",
          relPath: syllabus.relPath,
          sourceFile: syllabus.sourceFile ?? "",
        }
      : null;
  };
  if (
    JSON.stringify(syllabusIdentity(input.before)) !==
      JSON.stringify(syllabusIdentity(input.after))
  ) {
    problems.push("selected syllabus identity changed");
  }
  if (
    JSON.stringify(input.before.sourceVisualSourceIdentityMap) !==
      JSON.stringify(input.after.sourceVisualSourceIdentityMap)
  ) {
    problems.push("selected source stable-identity map changed");
  }
  return [...new Set(problems)];
}

function syllabusCoverageRecoveryBindingProblems(input: {
  context: LearnSourceContext;
  coveragePlan: unknown;
  syllabusCoverage: SyllabusCoverage | null | undefined;
}): string[] {
  const problems: string[] = [];
  if (input.context.syllabus && !input.syllabusCoverage) {
    return ["active syllabus has no persisted coverage decision"];
  }
  if (!input.context.syllabus && input.syllabusCoverage) {
    return ["persisted syllabus coverage has no active syllabus source"];
  }
  const receipt = input.syllabusCoverage?.evidenceRecovery as unknown;
  const receiptPresent = receipt !== undefined;
  const declaredReceipt = planningRecord(input.coveragePlan)
    .syllabusCoverageEvidenceRecovery;
  const declaredReceiptPresent = declaredReceipt !== undefined;
  const declaredHash = syllabusCoverageEvidenceRecoveryHashFromCoveragePlan(
    input.coveragePlan,
  );
  const rawDeclaredHash = planningRecord(input.coveragePlan)
    .syllabusCoverageEvidenceRecoveryHash;
  if (!receiptPresent) {
    if (declaredReceiptPresent) {
      problems.push("coverage plan carries a syllabus evidence-recovery receipt without persisted coverage provenance");
    }
    if (rawDeclaredHash !== undefined && rawDeclaredHash !== "") {
      problems.push("coverage plan declares a syllabus evidence-recovery hash without a receipt");
    }
    if (input.syllabusCoverage && !syllabusCoverageHasTeachableUnits(input.syllabusCoverage)) {
      problems.push("zero-teachable syllabus coverage cannot proceed without a recovered receipt");
    }
    return problems;
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return [...problems, "persisted syllabus evidence-recovery receipt is malformed"];
  }
  const typedReceipt = receipt as SyllabusCoverageEvidenceRecoveryReceipt;
  if (!declaredReceiptPresent ||
      JSON.stringify(declaredReceipt) !== JSON.stringify(typedReceipt)) {
    problems.push("coverage plan syllabus evidence-recovery receipt does not match persisted coverage provenance");
  }
  if (!declaredHash || declaredHash !== typedReceipt.integritySha256) {
    problems.push("coverage plan syllabus evidence-recovery hash does not match its receipt");
  }
  problems.push(...syllabusCoverageRecoveryReceiptProblems({
    receipt: typedReceipt,
    sources: syllabusCoverageRecoverySources(input.context),
    anchors: structuralSourceTextAnchorCatalog(input.context),
    coverage: input.syllabusCoverage ?? undefined,
    expectedSourceSetHash: input.context.sourceSetHash,
    expectedSourceArtifactInventoryHash: input.context.sourceArtifactInventoryHash,
  }));
  if (typedReceipt.outcome !== "recovered" ||
      !syllabusCoverageHasTeachableUnits(input.syllabusCoverage)) {
    problems.push("syllabus evidence recovery did not produce a teachable coverage decision");
  }
  return [...new Set(problems)];
}

function assertSyllabusCoverageRecoveryBinding(input: {
  context: LearnSourceContext;
  coveragePlan: unknown;
  syllabusCoverage: SyllabusCoverage | null | undefined;
  stage: string;
}): void {
  const problems = syllabusCoverageRecoveryBindingProblems(input);
  if (problems.length > 0) {
    throw new LearnPipelineConflictError(
      `${input.stage} syllabus coverage evidence recovery is stale or invalid: ${problems.join("; ")}`,
      { requiresReplan: true },
    );
  }
}

function exactCanonicalRepairSourceText(
  clusterDir: string,
  request: UnitRepairRequest,
): string | undefined {
  const registry = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  const requestedAnchorIds = request.sourceAnchors.flatMap((anchor) => [
    anchor.figureId,
    anchor.tableId,
    anchor.equationId,
    anchor.questionId,
    anchor.textAnchorId,
  ]).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const interactionAnchorIds = [
    ...(request.learningUnitContract.interactiveVisual?.sourceAnchors ?? []),
    ...(request.learningUnitContract.interactiveVisualPlan?.visualIntent?.sourceAnchors ?? []),
  ];
  const anchorIds = [...new Set([
    ...declaredSourceAnchorIdsForUnit(request.learningUnitContract),
    ...requestedAnchorIds,
    ...interactionAnchorIds,
  ])];
  const records = anchorIds.flatMap((anchorId) => {
    const anchor = registry[anchorId];
    if (!anchor) return [];
    const exactText = anchor.exactText?.trim();
    const registeredCaption =
      (anchor.kind === "figure" || anchor.kind === "graph" || anchor.kind === "table")
        ? anchor.caption?.trim()
        : "";
    const text = exactText || registeredCaption;
    return text ? [`[${anchorId}]\n${text}`] : [];
  });
  return records.length > 0 ? records.join("\n\n") : undefined;
}

function canonicalSourceAnchorProblems(
  clusterDir: string,
  units: readonly LearningUnitContract[],
): string[] {
  const registry = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  return units.flatMap((unit) => {
    const declared = declaredSourceAnchorIdsForUnit(unit);
    const problems = declared
      .filter((anchorId) => !registry[anchorId])
      .map((anchorId) => `unit "${unit.id}" references unregistered canonical source anchor "${anchorId}"`);
    if (!declared.some((anchorId) => Boolean(registry[anchorId]?.exactText))) {
      problems.push(
        `unit "${unit.id}" has no canonical exact-text source anchor; select at least one supplied Markdown page or verified formula anchor`,
      );
    }
    const exactTextChars = [...new Set(declared)].reduce(
      (total, anchorId) => total + (registry[anchorId]?.exactText?.trim().length ?? 0),
      0,
    );
    if (exactTextChars > MAX_TOTAL_SOURCE_CHARS_PER_PAGE) {
      problems.push(
        `unit "${unit.id}" selects ${exactTextChars} characters of exact source evidence, above the ${MAX_TOTAL_SOURCE_CHARS_PER_PAGE}-character page transport limit; choose fewer, more precise canonical anchors`,
      );
    }
    return problems;
  });
}

function syllabusUnitAssignmentProblems(
  units: readonly LearningUnitContract[],
  syllabusCoverage: SyllabusCoverage | null,
): string[] {
  if (!syllabusCoverage) {
    return units.flatMap((unit) =>
      (unit.syllabusUnitIds ?? []).length > 0
        ? [`unit "${unit.id}" must use an empty syllabusUnitIds array because no syllabus is active`]
        : []);
  }
  const coverageById = new Map(syllabusCoverage.units.map((unit) => [unit.unitId, unit]));
  const assignedTeachableIds = new Set<string>();
  const problems = units.flatMap((unit) => {
    const ids = unit.syllabusUnitIds ?? [];
    const problems: string[] = [];
    if (ids.length === 0) {
      problems.push(`unit "${unit.id}" must select at least one exact syllabus unit id`);
    }
    for (const id of ids) {
      const syllabusUnit = coverageById.get(id);
      if (!syllabusUnit) {
        problems.push(`unit "${unit.id}" references unknown syllabus unit "${id}"`);
      } else if (!syllabusUnit.teachable) {
        problems.push(`unit "${unit.id}" references syllabus unit "${id}" that the coverage review judged unteachable`);
      } else {
        assignedTeachableIds.add(id);
      }
    }
    return problems;
  });
  for (const syllabusUnit of syllabusCoverage.units) {
    if (syllabusUnit.teachable && !assignedTeachableIds.has(syllabusUnit.unitId)) {
      problems.push(
        `teachable syllabus unit "${syllabusUnit.unitId}" (${syllabusUnit.title}) is not covered by any learning unit`,
      );
    }
  }
  return problems;
}

function writeLearningUnitContractArtifacts({
  clusterDir,
  units,
  assignments,
  omissions,
  registeredArtifacts,
  sourceSetHash,
  sourceFormulaReviewSetHash,
  sourceArtifactInventoryHash,
  syllabusCoverageEvidenceRecovery,
  visualNecessityReview,
}: {
  clusterDir: string;
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  omissions: SourceArtifactOmission[];
  registeredArtifacts: RegisteredSourceArtifact[];
  sourceSetHash: string;
  sourceFormulaReviewSetHash?: string;
  sourceArtifactInventoryHash: string;
  syllabusCoverageEvidenceRecovery?: SyllabusCoverageEvidenceRecoveryReceipt;
  visualNecessityReview?: GardenVisualNecessityPlan;
}): {
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  omissions: SourceArtifactOmission[];
  removedArtifactIds: string[];
  semanticAliasRepairs: Array<{
    normalizedAlias: string;
    removedFrom: string[];
    reason: string;
  }>;
} {
  const deferredSourceAnchors: string[] = [];
  const canonicalSourceAnchors = buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false });
  const validateSourceAnchors = (anchors: string[] | undefined): void => {
    if (!Array.isArray(anchors) || anchors.length === 0) return;
    deferredSourceAnchors.push(...anchors.filter((anchor) => !canonicalSourceAnchors[anchor]));
  };
  for (const unit of units) {
    validateSourceAnchors(unit.sourceAnchors);
    for (const concept of unit.semanticConcepts ?? []) validateSourceAnchors(concept.evidenceAnchors);
    for (const claim of unit.knowledgeClaims ?? []) {
      validateSourceAnchors(claim.evidenceAnchors);
      validateSourceAnchors(claim.derivationAnchors);
    }
    validateSourceAnchors(unit.interactiveVisual?.sourceAnchors);
    validateSourceAnchors(unit.interactiveVisualPlan?.decision.evidence.sourceAnchorIds);
    validateSourceAnchors(unit.interactiveVisualPlan?.visualIntent?.sourceAnchors);
    for (const control of unit.interactiveVisualPlan?.controlContract ?? []) {
      validateSourceAnchors(control.evidence.map((evidence) => evidence.anchor));
    }
    validateSourceAnchors(unit.interactiveVisualPlan?.observable?.evidence.map((evidence) => evidence.anchor));
    validateSourceAnchors(unit.interactiveVisualPlan?.expectedInsightEvidence?.map((evidence) => evidence.anchor));
    validateSourceAnchors(unit.teachingMediumPlan?.sourceFigureAnchorId ? [unit.teachingMediumPlan.sourceFigureAnchorId] : []);
    validateSourceAnchors(unit.teachingMediumPlan?.formulaAnchorIds);
  }
  if (deferredSourceAnchors.length > 0) {
    throw new Error(
      `Model-authored source anchors could not be proven: ${[...new Set(deferredSourceAnchors)].join(", ")}. Repair the contract from registered source evidence.`,
    );
  }
  const ownershipProblems = sourceArtifactOwnershipProblems(units);
  if (ownershipProblems.length > 0) {
    throw new Error(`Model-authored source artifact ownership failed: ${ownershipProblems.join("; ")}`);
  }
  const artifactCoverageProblems = sourceArtifactCoverageProblems(
    units,
    omissions,
    registeredArtifacts,
  );
  if (artifactCoverageProblems.length > 0) {
    throw new Error(`Model-authored source artifact coverage failed: ${artifactCoverageProblems.join("; ")}`);
  }
  const expectedAssignments = projectModelAuthoredSourceArtifactAssignments(units);
  if (JSON.stringify(assignments) !== JSON.stringify(expectedAssignments)) {
    throw new Error("Source artifact assignment projection does not exactly match the model-authored Learning Unit Contract.");
  }
  const sourceArtifactReconciliation = reconcileLearningUnitSourceArtifacts(
    units,
    expectedAssignments,
    registeredArtifactsForGarden(clusterDir),
  );
  if (sourceArtifactReconciliation.removedArtifactIds.length > 0) {
    throw new Error(
      `Model-authored structured source artifacts are not registered: ${sourceArtifactReconciliation.removedArtifactIds.join(", ")}. Repair the contract instead of dropping them.`,
    );
  }
  const registryProblems = conceptRegistryAlignmentProblems({ clusterDir, sourceSetHash, units });
  if (registryProblems.length > 0) {
    throw new Error(`Model-authored concept registry alignment failed: ${registryProblems.join("; ")}`);
  }
  const registry = buildModelAuthoredConceptRegistry({
    gardenId: path.basename(clusterDir),
    sourceSetHash,
    concepts: units.flatMap((unit) => unit.semanticConcepts ?? []),
  });
  const reconciledUnits = units;
  const semanticAliasRepairs: Array<{
    normalizedAlias: string;
    removedFrom: string[];
    reason: string;
  }> = [];
  const finalAssignments = expectedAssignments;
  // Pedagogical visual decisions are model-authored before this writer runs.
  // This boundary may reconcile source registries mechanically, but it must
  // never replace those decisions with keyword scores, quotas, or inferred
  // media. Missing review data is therefore a hard planning error.
  if (!visualNecessityReview) {
    throw new Error("A validated model-authored visual-necessity plan is required before persisting the Learning Unit Contract.");
  }
  const decisionByUnit = new Map(
    visualNecessityReview.decisions.map((decision) => [decision.unitId, decision]),
  );
  const mediumByUnit = new Map(
    visualNecessityReview.teachingMedia.map((medium) => [medium.unitId, medium]),
  );
  const missingVisualPlans = reconciledUnits.filter((unit) =>
    !unit.interactiveVisualPlan ||
    !decisionByUnit.has(unit.id) ||
    !unit.teachingMediumPlan ||
    !mediumByUnit.has(unit.id));
  if (missingVisualPlans.length > 0) {
    throw new Error(
      `Model-authored visual-necessity coverage is missing for: ${missingVisualPlans.map((unit) => unit.id).join(", ")}`,
    );
  }
  saveVisualNecessityArtifacts(clusterDir, path.basename(clusterDir), {
    decisions: visualNecessityReview.decisions,
    teachingMedia: visualNecessityReview.teachingMedia,
    budget: visualNecessityReview.budget,
    overrides: visualNecessityReview.overrides,
    reviewCalls: visualNecessityReview.reviewCalls,
    rejectedReviews: visualNecessityReview.rejectedReviews,
    decisionRecords: visualNecessityReview.decisionRecords,
    zeroVisualSafeguard: visualNecessityReview.zeroVisualSafeguard,
    unresolvedRecords: visualNecessityReview.unresolvedRecords,
  });
  const payload = {
    sourceSetHash,
    sourceFormulaReviewSetHash,
    sourceArtifactInventoryHash,
    syllabusCoverageEvidenceRecoveryHash:
      syllabusCoverageEvidenceRecovery?.integritySha256 ?? "",
    ...(syllabusCoverageEvidenceRecovery
      ? { syllabusCoverageEvidenceRecovery }
      : {}),
    generatedAt: nowIso(),
    learningUnits: reconciledUnits,
    sourceArtifactAssignments: finalAssignments,
    sourceArtifactOmissions: omissions,
    ...(deferredSourceAnchors.length ? { deferredSourceAnchors: [...new Set(deferredSourceAnchors)] } : {}),
    ...(semanticAliasRepairs.length
      ? { semanticAliasRepairs }
      : {}),
  };
  const lines = [
    "# Learning Unit Contract",
    "",
    "<!--",
    "artifactRole: pre_executability_learning_unit_contract_summary",
    "interactionContractsAreAuthoritative: false",
    "supersededBy: .breadboard/learning-unit-contract.json, .breadboard/visualization-plan.json, .breadboard/visual-contract-executability-reviews.json",
    "-->",
    "",
    "> **Artifact role:** Pre-executability planning summary. Its interaction controls are not authoritative until the executability ledger and final JSON contract are persisted.",
    "",
    `Source set hash: ${sourceSetHash}`,
    `Source artifact inventory hash: ${sourceArtifactInventoryHash}`,
    `Learning units: ${reconciledUnits.length}`,
    `Source artifact assignments: ${finalAssignments.length}`,
    `Source artifact omissions: ${omissions.length}`,
    "",
    "## Units",
    "",
  ];
  for (const unit of reconciledUnits) {
    lines.push(`- ${unit.id}: ${unit.title} (${unit.role})`);
    lines.push(`  - Question: ${unit.learningQuestion || unit.title}`);
    const artifacts = finalAssignments
      .filter((assignment) => assignment.assignedLearningUnitId === unit.id)
      .map((assignment) => `${assignment.sourceArtifactId} -> ${assignment.placement}`);
    if (artifacts.length > 0) lines.push(`  - Artifacts: ${artifacts.join(", ")}`);
    if (unit.sourceQuestions.length > 0) {
      lines.push(`  - Source questions: ${unit.sourceQuestions.map((question) => question.id).join(", ")}`);
    }
    if (unit.interactiveVisual) {
      lines.push(`  - Interactive: ${unit.interactiveVisual.visualType} (${unit.interactiveVisual.uniqueConcept})`);
    }
    if (unit.interactiveVisualPlan) {
      lines.push(
        `  - Interactive requirement: ${unit.interactiveVisualPlan.requirement} (${unit.interactiveVisualPlan.decision.reason})`,
      );
    }
    if (unit.teachingMediumPlan) {
      lines.push(`  - Preferred medium: ${unit.teachingMediumPlan.preferredMedium}`);
    }
    const concepts = (unit.semanticConcepts ?? []).map((concept) => concept.slug);
    if (concepts.length > 0) lines.push(`  - Concepts: ${concepts.join(", ")}`);
    const claims = unit.knowledgeClaims ?? [];
    if (claims.length > 0) lines.push(`  - Claims: ${claims.map((claim) => claim.text).join(" | ")}`);
  }
  if (omissions.length > 0) {
    lines.push("", "## Model-authored omissions", "");
    for (const omission of omissions) {
      lines.push(
        `- ${omission.sourceArtifactId} [${omission.disposition}]: ${omission.artifactSummary}. ${omission.reason}` +
          (omission.alternativeArtifactId ? ` Replacement: ${omission.alternativeArtifactId}.` : ""),
      );
    }
  }
  writeGardenConceptRegistryAndContract({
    gardenDir: clusterDir,
    registry,
    contract: payload,
    planningMarkdown: `${lines.join("\n")}\n`,
    strictModelAuthored: true,
  });
  return {
    units: reconciledUnits,
    assignments: finalAssignments,
    omissions,
    removedArtifactIds: sourceArtifactReconciliation.removedArtifactIds,
    semanticAliasRepairs,
  };
}

function persistRoutedVisualPlans(
  clusterDir: string,
  units: LearningUnitContract[],
): void {
  const filePath = path.join(clusterDir, ".breadboard", "learning-unit-contract.json");
  if (!fs.existsSync(filePath)) {
    throw new Error("Cannot persist routed visuals because the Learning Unit Contract is missing.");
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  if (!Array.isArray(parsed.learningUnits)) {
    throw new Error("Cannot persist routed visuals because learningUnits is not an array.");
  }
  const rawUnits = parsed.learningUnits as Array<Record<string, unknown>>;
  const persistedIds = rawUnits.map((raw) => typeof raw?.id === "string" ? raw.id : "");
  const routedIds = units.map((unit) => unit.id);
  if (
    persistedIds.some((id) => !id) ||
    new Set(persistedIds).size !== persistedIds.length ||
    new Set(routedIds).size !== routedIds.length ||
    JSON.stringify(persistedIds) !== JSON.stringify(routedIds)
  ) {
    throw new Error(
      "Cannot persist routed visuals because persisted and in-memory learning-unit IDs do not match exactly.",
    );
  }
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  parsed.learningUnits = rawUnits.map((raw) => {
    const id = typeof raw.id === "string" ? raw.id : "";
    const unit = byId.get(id);
    if (!unit) return raw;
    const next: Record<string, unknown> = {
      ...raw,
      interactiveVisualPlan: unit.interactiveVisualPlan,
      teachingMediumPlan: unit.teachingMediumPlan,
    };
    if (unit.interactiveVisual) next.interactiveVisual = unit.interactiveVisual;
    else delete next.interactiveVisual;
    return next;
  });
  const jsonPayload = `${JSON.stringify(parsed, null, 2)}\n`;
  fs.writeFileSync(filePath, jsonPayload, "utf-8");
  const contractHash = createHash("sha256").update(jsonPayload).digest("hex");
  const planningMarkdownPath = path.join(
    clusterDir,
    ...AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH.split("/"),
  );
  fs.mkdirSync(path.dirname(planningMarkdownPath), { recursive: true });
  fs.writeFileSync(
    planningMarkdownPath,
    renderAuthoritativeLearningUnitContractMarkdown({
      units,
      authoritativeSourceSha256: contractHash,
    }),
    "utf-8",
  );
}

function learningUnitsFromCoveragePlan(plan: unknown): LearningUnitContract[] {
  const record = planningRecord(plan);
  const raw = { learningUnits: record.learningUnitContracts };
  const problems = modelAuthoredLearningUnitParseProblems(raw);
  if (problems.length > 0) {
    throw new Error(
      `Stored model-authored Learning Unit Contract is invalid: ${problems.join("; ")}`,
    );
  }
  return normalizeLearningUnits(
    raw,
    { modelAuthoredOnly: true },
  );
}

/** Reject incompatible legacy visual payloads before the dedicated model visual pass. */
function prematureVisualPlanningProblems(units: readonly LearningUnitContract[]): string[] {
  return units
    .filter((unit) => unit.interactiveVisual || unit.interactiveVisualPlan || unit.teachingMediumPlan)
    .map(
      (unit) =>
        `unit "${unit.id}" authored visual decisions during learning-spine planning; remove them so the dedicated whole-garden visual model can decide`,
    );
}

function isContractBackedLearningMap(map: StoredLearningMap | null | undefined): map is StoredLearningMap {
  if (!map || !/^[0-9a-f]{64}$/i.test(map.sourceArtifactInventoryHash)) return false;
  const coverageInventoryHash = sourceArtifactInventoryHashFromCoveragePlan(map.coveragePlan);
  const coverageRecord = planningRecord(map.coveragePlan);
  const persistedRecovery = map.syllabusCoverage?.evidenceRecovery as unknown;
  const plannedRecovery = coverageRecord.syllabusCoverageEvidenceRecovery;
  const persistedRecoveryPresent = persistedRecovery !== undefined;
  const plannedRecoveryPresent = plannedRecovery !== undefined;
  if (Boolean(map.syllabusSourceId) !== Boolean(map.syllabusCoverage)) return false;
  if (map.syllabusCoverage && !syllabusCoverageHasTeachableUnits(map.syllabusCoverage)) return false;
  if (persistedRecoveryPresent !== plannedRecoveryPresent) return false;
  if (persistedRecoveryPresent) {
    if (!persistedRecovery || typeof persistedRecovery !== "object" || Array.isArray(persistedRecovery)) {
      return false;
    }
    const receipt = persistedRecovery as SyllabusCoverageEvidenceRecoveryReceipt;
    if (receipt.outcome !== "recovered" ||
        !/^[0-9a-f]{64}$/.test(receipt.integritySha256) ||
        coverageRecord.syllabusCoverageEvidenceRecoveryHash !== receipt.integritySha256 ||
        JSON.stringify(plannedRecovery) !== JSON.stringify(receipt)) {
      return false;
    }
  } else if (coverageRecord.syllabusCoverageEvidenceRecoveryHash !== undefined &&
             coverageRecord.syllabusCoverageEvidenceRecoveryHash !== "") {
    return false;
  }
  return Boolean(
    coverageInventoryHash &&
    coverageInventoryHash === map.sourceArtifactInventoryHash.toLowerCase() &&
    learningUnitsFromCoveragePlan(map.coveragePlan).length > 0,
  );
}

function sourceArtifactAssignmentsFromCoveragePlan(plan: unknown): SourceArtifactAssignment[] {
  const raw = planningRecord(plan).sourceArtifactAssignments;
  if (!Array.isArray(raw)) return [];
  const assignments = raw
    .map((item) => (item && typeof item === "object" ? (item as SourceArtifactAssignment) : null))
    .filter((item): item is SourceArtifactAssignment => Boolean(item));
  const units = learningUnitsFromCoveragePlan(plan);
  const ownershipProblems = sourceArtifactOwnershipProblems(units);
  if (ownershipProblems.length > 0) {
    throw new Error(`Stored model-authored source artifact ownership is invalid: ${ownershipProblems.join("; ")}`);
  }
  const expected = projectModelAuthoredSourceArtifactAssignments(units);
  if (JSON.stringify(assignments) !== JSON.stringify(expected)) {
    throw new Error("Stored source artifact assignments do not exactly match the model-authored Learning Unit Contract.");
  }
  return assignments;
}

function sourceArtifactOmissionsFromCoveragePlan(plan: unknown): SourceArtifactOmission[] {
  const raw = {
    sourceArtifactOmissions: planningRecord(plan).sourceArtifactOmissions,
  };
  const problems = modelAuthoredSourceArtifactOmissionParseProblems(raw);
  if (problems.length > 0) {
    throw new Error(
      `Stored model-authored source artifact omissions are invalid: ${problems.join("; ")}`,
    );
  }
  return projectModelAuthoredSourceArtifactOmissions(raw);
}

function learningMapWithConfirmedUnitContracts(
  learningMap: ProposedLearningMap,
  units: LearningUnitContract[],
): ProposedLearningMap {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  return {
    ...learningMap,
    sections: learningMap.sections.map((section) => ({
      ...section,
      subsections: section.subsections.map((subsection) => {
        const unit = subsection.learningUnitId ? unitsById.get(subsection.learningUnitId) : undefined;
        if (!unit) return subsection;
        const interactiveVisuals = unit.interactiveVisual
          ? [
              {
                concept: unit.interactiveVisual.uniqueConcept,
                reason: unit.interactiveVisual.whyStaticSourceFigureIsNotEnough,
              },
            ]
          : [];
        return {
          ...subsection,
          sourceAnchors: unit.sourceAnchors,
          conceptTags: (unit.semanticConcepts ?? []).map((concept) => concept.slug),
          sourceVisualIds: [...new Set([
            ...unit.sourceFigures.filter((figure) => figure.placement !== "not_used_with_reason").map((figure) => figure.id),
            ...unit.sourceFormulas.map((formula) => formula.id),
            ...unit.sourceTables.map((table) => table.id),
          ])],
          interactiveVisuals,
          learningUnitRole: unit.role,
          learningQuestion: unit.learningQuestion,
          prerequisiteConcepts: unit.prerequisiteConcepts,
          newConcepts: unit.newConcepts,
          syllabusUnitIds: unit.syllabusUnitIds ?? [],
          mustNotRepeat: unit.mustNotRepeat,
          expectedWordRange: unit.expectedWordRange,
          sourceFigureContracts: unit.sourceFigures,
          sourceFormulaContracts: unit.sourceFormulas,
          sourceTableContracts: unit.sourceTables,
          sourceQuestionContracts: unit.sourceQuestions,
          sourceArtifactAssignments: projectModelAuthoredSourceArtifactAssignments([unit]),
          interactiveVisualContract: unit.interactiveVisual,
          interactiveVisualPlan: unit.interactiveVisualPlan,
          teachingMediumPlan: unit.teachingMediumPlan,
          zettelNotes: unit.zettelNotes,
        };
      }),
    })),
  };
}

export async function runLearnPlanning({
  gardenId,
  userId,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  includedSourceIds,
  syllabusSourceId,
  sourceOnly = true,
  includeSourceSnapshots = false,
  userInstruction,
  updateExisting = false,
  resetSourceMap = false,
  retainLeaseOnSuccess = false,
  yieldToResponse,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  includedSourceIds?: readonly string[];
  /** Slug of an uploaded document to use as the course study guide. */
  syllabusSourceId?: string | null;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  userInstruction?: string;
  /** Preserve the published curriculum and insert newly grounded units into
   * its existing teaching order. */
  updateExisting?: boolean;
  resetSourceMap?: boolean;
  /** Internal full-rebuild handoff: the caller must release retainedLease. */
  retainLeaseOnSuccess?: boolean;
  /** Cooperative route handoff after the durable job is visible to polling. */
  yieldToResponse?: (jobId: string) => Promise<void>;
}): Promise<{
  job: LearnJob;
  learningMap: StoredLearningMap;
  retainedLease?: GardenLearnLease;
}> {
  const effectiveUserInstruction = normalizeLearnUserInstruction(userInstruction);
  assertNoPendingLearnClear(gardenId);
  const gardenDir = clusterPath(contentPath, gardenId);
  const incrementalBaseline: IncrementalLearnBaseline | null = updateExisting
    ? readIncrementalLearnBaseline(gardenDir)
    : null;
  if (updateExisting && !incrementalBaseline) {
    throw new LearnPipelineConflictError(
      "This garden has learner pages but no valid Learning Unit Contract to extend. Repair it or explicitly rebuild the garden before adding material.",
    );
  }
  const publishedVersion = updateExisting ? getLatestLearnVersion(gardenId) : null;
  const publishedMap = publishedVersion
    ? getLearnMapById(publishedVersion.learning_map_id, gardenId)
    : null;
  if (updateExisting && (!publishedVersion || !publishedMap)) {
    throw new LearnPipelineConflictError(
      "The published Learn version is no longer bound to its Learning Map. Repair it or explicitly rebuild the garden before adding material.",
    );
  }
  if (incrementalBaseline) {
    const publishedPages = publishedLearningPagesByUnitId(gardenDir);
    const missingPublishedUnitIds = incrementalBaseline.learningUnits
      .map((unit) => unit.id)
      .filter((unitId) => !publishedPages.get(unitId)?.body);
    if (missingPublishedUnitIds.length > 0) {
      throw new LearnPipelineConflictError(
        `The published Learn is missing lesson pages for existing units: ${missingPublishedUnitIds.join(", ")}. Repair it or explicitly rebuild the garden before adding material.`,
      );
    }
  }
  const updateSourceIds = updateExisting
    ? [
        ...new Set([
          ...(publishedMap?.sourceIds ?? []).filter(
            (sourceId) => sourceId !== publishedMap?.syllabusSourceId,
          ),
          ...(includedSourceIds ?? []),
        ]),
      ]
    : includedSourceIds;
  const updateSyllabusSourceId = updateExisting
    ? (syllabusSourceId ?? publishedMap?.syllabusSourceId)
    : syllabusSourceId;
  const jobId = makeId("learn_job");
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId,
    buildId: `planning:${jobId}`,
  }, {
    onLeaseLost: () => abortLearnWorkerAfterLeaseLoss(jobId),
  });
  if (!leaseResult.acquired) {
    const message = `Another Learn operation (${leaseResult.conflict.jobId}) is already changing this garden.`;
    throw new LearnPipelineConflictError(message);
  }
  const lease = leaseResult.lease;
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
  } catch (error) {
    lease.release();
    throw error;
  }
  let context: LearnSourceContext;
  try {
    context = collectLearnSourceContext(
      contentPath,
      gardenId,
      updateSourceIds,
      updateSyllabusSourceId,
    );
  } catch (error) {
    lease.release();
    throw error;
  }
  let leaseTransferred = false;
  let job: LearnJob;
  try {
    if (resetSourceMap) {
      const previousJob = getLatestLearnJob(gardenId);
      if (previousJob?.status === "failed") {
        await rollbackLearnRun({
          gardenId,
          contentPath,
          jobId: previousJob.id,
          lease,
        });
        if (!lease.heartbeat()) {
          throw new LearnPipelineConflictError(
            "Learn planning lost its lease after restoring the previous failed run.",
          );
        }
        discardLearnRunSnapshot({
          gardenId,
          contentPath,
          jobId: previousJob.id,
        });
      }
    }
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease before creating its job.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
    job = createLearnJob({
      id: jobId,
      gardenId,
      userId,
      model,
      mode: resetSourceMap
        ? "full_rebuild"
        : updateExisting
          ? "update_sources"
          : "plan",
      // The full selection is persisted, syllabus included, so a later run
      // reproduces exactly the same teaching-set/syllabus split.
      sourceIds: context.selectedSourceIds,
      syllabusSourceId: context.syllabus?.slug,
      userInstruction: effectiveUserInstruction,
      sourceOnly,
      includeSourceSnapshots,
    });
  } catch (error) {
    lease.release();
    throw error;
  }
  let disposeModelTracking = (): void => {};
  try {
    createLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease while creating the rollback snapshot.",
      );
    }
    if (resetSourceMap) {
      const reset = clearSourceMapForRegeneration({ gardenId, contentPath });
      appendLearnEvent(contentPath, gardenId, "learn_regeneration_source_map_cleared", {
        jobId: job.id,
        removedPathCount: reset.removedPaths.length,
        deletedMaps: reset.deletedMaps,
        deletedVersions: reset.deletedVersions,
      });
    }
    disposeModelTracking = attachLearnJobModelTracking({
      client,
      jobId: job.id,
      gardenId,
      contentPath,
    });
    activeLearnCouncilDispatchAuthorities.set(
      job.id,
      () => confirmLearnLeaseForCouncilDispatch(lease, job.id),
    );
  } catch (error) {
    const message = errorMessage(error, "Planning workspace could not be prepared");
    if (!lease.lost && !leaseLostLearnJobs.has(job.id)) {
      try {
        await rollbackLearnRun({ gardenId, contentPath, jobId: job.id, lease });
        updateLearnJobExpectStatus(job.id, {
          status: "failed",
          currentStep: "Planning could not start; prior Learn state restored",
          error: message,
        });
        discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
      } catch (rollbackError) {
        appendLearnEvent(
          contentPath,
          gardenId,
          "learn_planning_setup_rollback_failed",
          { jobId: job.id, error: errorMessage(rollbackError) },
        );
      }
    }
    lease.release();
    throw error;
  }

  try {
    updateLearnJob(job.id, {
      status: "planning",
      currentStep: "Extracting source visuals",
      progressPercent: 2,
      sourceSetHash: context.sourceSetHash,
    });
    await yieldToResponse?.(job.id);
    // Stage 2 before planning: the planner assigns real extracted visuals.
    await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath,
      gardenId,
      context,
      deferEmptyVisualCheck: true,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });

    // Source Markdown can describe important figures from anywhere in the
    // retained PDF, including pages outside the small eager image cache. Scan
    // those mentioned pages now so extractedSourceArtifacts is complete before
    // the Learning Unit Contract is requested. A prose label alone is never
    // promoted; only the vision-registered result reaches the planner.
    const mentionedArtifactIds = structuredArtifactIdsMentionedBySources(context);
    if (mentionedArtifactIds.length > 0) {
      const discovery = await ensureReferencedSourceArtifactsExtracted({
        client,
        model,
        contentPath,
        gardenId,
        context,
        units: [],
        candidateArtifactIds: mentionedArtifactIds,
        checkpoint: () => throwIfLearnCancelled(job.id),
        onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
      });
      appendLearnEvent(contentPath, gardenId, "learn_source_markdown_artifacts_discovered", {
        jobId: job.id,
        candidateCount: mentionedArtifactIds.length,
        requestedIds: discovery.requestedIds,
        unresolvedIds: discovery.unresolvedIds,
      });
    }
    await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });

    const initialFormulaReview = await reviewAndBindSourceFormulas({
      client,
      model,
      contentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
      jobId: job.id,
      stage: "planning_initial",
      reviewSetHash: initialFormulaReview.reviewedFormulaSetHash,
      formulaCount: initialFormulaReview.formulaIds.length,
      replacementCount: initialFormulaReview.replacementFormulaIds.length,
      cacheHitCount: initialFormulaReview.cacheHitFormulaIds.length,
      modelCalls: initialFormulaReview.modelCalls,
    });

    let structuralSourceAnchors = structuralSourceTextAnchorCatalog(context);
    let canonicalSourceAnchorCatalog = [
      ...structuralSourceAnchorPromptCatalog(structuralSourceAnchors),
      ...sourceMapFigureAnchorPromptCatalog(context.sourceFigures),
    ];
    let promptSourceContext = promptSources(context, { sourceMapArtifactKinds: true });
    const hasSyllabus = Boolean(context.syllabus);
    let syllabusPayload = promptSyllabus(context);
    if (context.syllabus) {
      appendLearnEvent(contentPath, gardenId, "learn_syllabus_applied", {
        jobId: job.id,
        syllabusSourceId: context.syllabus.slug,
        syllabusTitle: context.syllabus.title,
      });
    }
    updateLearnJob(job.id, {
      status: "planning",
      currentStep: "Building source map",
      progressPercent: 5,
      sourceSetHash: context.sourceSetHash,
    });
    appendLearnEvent(contentPath, gardenId, "learn_planning_started", {
      jobId: job.id,
      sourceIds: context.sources.map((source) => source.slug),
    });

    // Planning sends the full context only in the user message; sourceContext
    // carries small routing metadata so council candidates/critics do not
    // duplicate the payload.
    const planningSourceMeta = {
      gardenId,
      sourceIds: context.sources.map((source) => source.slug),
      sourceSetHash: context.sourceSetHash,
      sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
    };
    const planningWarnings: string[] = [];
    let syllabusCoverageWarnings: string[] = [];

    // Stage 1b: one model reads the syllabus, then a separate source-grounded
    // model authors every material-availability and unit-teachability verdict.
    // Code checks exact IDs/citations and completeness but makes no semantic
    // match or fallback decision.
    let syllabusPlan: SyllabusPlan | null = null;
    let syllabusCoverage: SyllabusCoverage | null = null;
    if (context.syllabus) {
      updateLearnJob(job.id, {
        currentStep: "Reading the syllabus",
        progressPercent: 4,
      });
      await learnCheckpoint(job.id);
      const syllabusCall = await callValidatedPlanningJson({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: SYLLABUS_READING_PROMPT,
        user: compactJson({ syllabus: syllabusPayload }),
        sourceContext: { ...planningSourceMeta, taskType: "syllabus_reading" },
        contentPath,
        jobId: job.id,
        stageKey: "source_map:syllabus_reading",
        stageLabel: "Syllabus reading",
        validate: modelAuthoredSyllabusPlanProblems,
      });
      const initialSyllabusPlan = projectModelAuthoredSyllabusPlan(syllabusCall.parsed);
      syllabusPlan = initialSyllabusPlan;
      const syllabusSourceIds = context.sources.map((source) => source.slug);
      updateLearnJob(job.id, {
        currentStep: "Checking syllabus coverage against selected sources",
        progressPercent: 4,
      });
      await learnCheckpoint(job.id);
      const coverageCall = await callValidatedPlanningJson({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: SYLLABUS_COVERAGE_PROMPT,
        user: compactJson({
          syllabusPlan: initialSyllabusPlan,
          selectedSourceCatalog: promptSyllabusCoverageSourceCatalog(context, initialSyllabusPlan),
        }),
        sourceContext: { ...planningSourceMeta, taskType: "syllabus_coverage" },
        contentPath,
        jobId: job.id,
        stageKey: "source_map:syllabus_coverage",
        stageLabel: "Syllabus coverage review",
        validate: (value) =>
          syllabusCoverageDecisionProblems(value, initialSyllabusPlan, syllabusSourceIds),
        preserveExactContent: true,
      });
      syllabusCoverage = projectModelAuthoredSyllabusCoverage(
        initialSyllabusPlan,
        coverageCall.parsed,
        syllabusSourceIds,
      );

      // A complete all-false verdict makes the downstream Learning Unit
      // Contract impossible: the LUC author is forbidden to teach unteachable
      // syllabus units. Before asking for a map or contract, give an independent
      // model one bounded chance to select exact canonical page identities and
      // rereview the whole coverage decision from the complete selected pages.
      // Code never maps syllabus locators/topics/titles to source pages and it
      // never flips a semantic verdict.
      if (!syllabusCoverageHasTeachableUnits(syllabusCoverage)) {
        appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_started", {
          jobId: job.id,
          sourceSetHash: context.sourceSetHash,
          sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
          initialTeachableCount: 0,
          maximumSelectorCandidates: 1,
          maximumCoverageReviewCandidates: 1,
        });
        try {
          const recovery = await runSyllabusCoverageEvidenceRecovery({
            syllabusPlan: initialSyllabusPlan,
            initialCoverageRaw: coverageCall.content,
            initialCoverageDecision: coverageCall.parsed,
            sources: context.sources.map((source) => ({
              sourceId: source.slug,
              relPath: source.relPath,
              body: source.body,
            })),
            anchors: structuralSourceAnchors,
            sourceSetHash: context.sourceSetHash,
            sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
            model,
            checkpoint: () => throwIfLearnCancelled(job.id),
            provider: async (request: SyllabusCoverageRecoveryProviderRequest) => {
              await learnCheckpoint(job.id);
              const result = await callPlanningJsonOnce({
                client,
                model,
                taskType: "source_map",
                gardenId,
                system: request.system,
                user: request.user,
                sourceContext: {
                  ...planningSourceMeta,
                  ...request.sourceContext,
                },
                contentPath,
                jobId: job.id,
                stageKey: `source_map:syllabus_coverage_evidence:${request.phase}`,
                stageLabel: `Syllabus coverage evidence ${request.phase}`,
                semanticAttempt: request.attempt,
                preserveExactContent: true,
              });
              return {
                rawResponse: result.content,
                councilRunId: result.councilRunId,
                model,
              };
            },
          });
          syllabusCoverage = recovery.coverage;
          const recoveryLiveContext = collectLearnSourceContext(
            contentPath,
            gardenId,
            context.selectedSourceIds,
            context.syllabus?.slug,
          );
          const recoveryDriftProblems = syllabusCoverageRecoveryReceiptProblems({
            receipt: recovery.receipt,
            sources: syllabusCoverageRecoverySources(recoveryLiveContext),
            anchors: structuralSourceTextAnchorCatalog(recoveryLiveContext),
            coverage: recovery.coverage,
            expectedSourceSetHash: recoveryLiveContext.sourceSetHash,
            expectedSourceArtifactInventoryHash:
              recoveryLiveContext.sourceArtifactInventoryHash,
          });
          if (recoveryLiveContext.sourceSetHash !== context.sourceSetHash ||
              recoveryLiveContext.sourceArtifactInventoryHash !==
                context.sourceArtifactInventoryHash ||
              recoveryDriftProblems.length > 0) {
            throw new LearnPipelineConflictError(
              `Selected source or syllabus evidence changed during bounded coverage recovery: ${recoveryDriftProblems.join("; ") || "live evidence hashes changed"}. No Source Map or Learning Unit Contract was requested.`,
            );
          }
          try {
            appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_reviewed", {
              jobId: job.id,
              outcome: recovery.receipt.outcome,
              receiptHash: recovery.receipt.integritySha256,
              selectedPages: recovery.receipt.selectedPages.map((page) => ({
                anchorId: page.anchorId,
                sourceId: page.sourceId,
                pageNumber: page.pageNumber,
                exactTextSha256: page.exactTextSha256,
              })),
              selectorCouncilRunId: recovery.receipt.selectorAttempts[0].councilRunId,
              coverageReviewCouncilRunId: recovery.receipt.coverageReviewAttempts[0].councilRunId,
              semanticCandidates: 2,
            });
          } catch {
            // Recovery review telemetry cannot replace the settled model result.
          }
          if (!recovery.recovered) {
            try {
              appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_terminal", {
                jobId: job.id,
                outcome: recovery.receipt.outcome,
                receiptHash: recovery.receipt.integritySha256,
                sourceMapRequested: false,
                learningUnitContractRequested: false,
              });
            } catch {
              // Terminal telemetry cannot replace the deterministic outcome.
            }
            throw new Error(
              "Independent exact-page syllabus coverage rereview still found zero teachable units. No Source Map or Learning Unit Contract was requested.",
            );
          }
        } catch (error) {
          try {
            appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_failed", {
              jobId: job.id,
              error: errorMessage(error),
              sourceMapRequested: false,
              learningUnitContractRequested: false,
            });
          } catch {
            // Recovery telemetry cannot replace the exact terminal failure.
          }
          throw error;
        }
      }

      if (syllabusCoverage) {
        const summary = summarizeSyllabusCoverage(syllabusCoverage);
        appendLearnEvent(contentPath, gardenId, "learn_syllabus_materials_resolved", {
          jobId: job.id,
          ...summary,
          missingCitations: syllabusCoverage.missingCitations,
          untaughtUnitTitles: syllabusCoverage.untaughtUnitTitles,
        });
        if (syllabusCoverage.missingCitations.length > 0) {
          syllabusCoverageWarnings.push(
            `The syllabus assigns ${syllabusCoverage.missingCitations.length} work(s) that are not in this garden: ${syllabusCoverage.missingCitations
              .slice(0, 8)
              .join("; ")}. Lessons will not be written from them — upload them to have them covered.`,
          );
        }
        for (const unitTitle of syllabusCoverage.untaughtUnitTitles.slice(0, 8)) {
          syllabusCoverageWarnings.push(
            `Syllabus item "${unitTitle}" could not be fully supported by the available source material and was left uncovered.`,
          );
        }
      }
    }
    const syllabusCoveragePayload = () => syllabusCoverage
      ? {
          courseTitle: syllabusCoverage.courseTitle,
          units: syllabusCoverage.units,
          missingCitations: syllabusCoverage.missingCitations,
          untaughtUnitTitles: syllabusCoverage.untaughtUnitTitles,
        }
      : undefined;
    const replaceSyllabusCoverageWarnings = (coverage: SyllabusCoverage): void => {
      syllabusCoverageWarnings = [];
      if (coverage.missingCitations.length > 0) {
        syllabusCoverageWarnings.push(
          `The syllabus assigns ${coverage.missingCitations.length} work(s) that are not in this garden: ${coverage.missingCitations
            .slice(0, 8)
            .join("; ")}. Lessons will not be written from them; upload them to have them covered.`,
        );
      }
      for (const unitTitle of coverage.untaughtUnitTitles.slice(0, 8)) {
        syllabusCoverageWarnings.push(
          `Syllabus item "${unitTitle}" could not be fully supported by the available source material and was left uncovered.`,
        );
      }
    };
    const rebindSyllabusCoverage = async (reauthorCycle: number): Promise<void> => {
      if (!context.syllabus) return;
      const activeSyllabusPlan = syllabusPlan;
      if (!activeSyllabusPlan) {
        throw new LearnPipelineConflictError(
          "Syllabus coverage could not be rebound because its model-authored syllabus plan is unavailable.",
        );
      }
      planningSourceMeta.sourceIds = context.sources.map((source) => source.slug);
      planningSourceMeta.sourceSetHash = context.sourceSetHash;
      planningSourceMeta.sourceArtifactInventoryHash = context.sourceArtifactInventoryHash;
      syllabusPayload = promptSyllabus(context);
      updateLearnJob(job.id, {
        currentStep: "Rechecking syllabus coverage against refreshed source evidence",
        progressPercent: 5,
      });
      appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_rebind_started", {
        jobId: job.id,
        sourceSetHash: context.sourceSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
      });
      await learnCheckpoint(job.id);
      const syllabusSourceIds = context.sources.map((source) => source.slug);
      const coverageCall = await callValidatedPlanningJson({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: SYLLABUS_COVERAGE_PROMPT,
        user: compactJson({
          syllabusPlan: activeSyllabusPlan,
          selectedSourceCatalog: promptSyllabusCoverageSourceCatalog(
            context,
            activeSyllabusPlan,
          ),
        }),
        sourceContext: { ...planningSourceMeta, taskType: "syllabus_coverage_rebind" },
        contentPath,
        jobId: job.id,
        stageKey: `source_map:syllabus_coverage_rebind:cycle:${reauthorCycle}`,
        stageLabel: "Syllabus coverage rebind review",
        validate: (value) =>
          syllabusCoverageDecisionProblems(value, activeSyllabusPlan, syllabusSourceIds),
        preserveExactContent: true,
      });
      let reboundCoverage = projectModelAuthoredSyllabusCoverage(
        activeSyllabusPlan,
        coverageCall.parsed,
        syllabusSourceIds,
      );
      if (!syllabusCoverageHasTeachableUnits(reboundCoverage)) {
        appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_started", {
          jobId: job.id,
          stage: "source_map_rebind",
          sourceSetHash: context.sourceSetHash,
          sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
          initialTeachableCount: 0,
          maximumSelectorCandidates: 1,
          maximumCoverageReviewCandidates: 1,
        });
        try {
          const recovery = await runSyllabusCoverageEvidenceRecovery({
            syllabusPlan: activeSyllabusPlan,
            initialCoverageRaw: coverageCall.content,
            initialCoverageDecision: coverageCall.parsed,
            sources: syllabusCoverageRecoverySources(context),
            anchors: structuralSourceAnchors,
            sourceSetHash: context.sourceSetHash,
            sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
            model,
            checkpoint: () => throwIfLearnCancelled(job.id),
            provider: async (request: SyllabusCoverageRecoveryProviderRequest) => {
              await learnCheckpoint(job.id);
              const result = await callPlanningJsonOnce({
                client,
                model,
                taskType: "source_map",
                gardenId,
                system: request.system,
                user: request.user,
                sourceContext: {
                  ...planningSourceMeta,
                  ...request.sourceContext,
                },
                contentPath,
                jobId: job.id,
                stageKey: `source_map:syllabus_coverage_rebind_evidence:cycle:${reauthorCycle}:${request.phase}`,
                stageLabel: `Syllabus coverage rebind evidence ${request.phase}`,
                semanticAttempt: request.attempt,
                preserveExactContent: true,
              });
              return {
                rawResponse: result.content,
                councilRunId: result.councilRunId,
                model,
              };
            },
          });
          reboundCoverage = recovery.coverage;
          const recoveryLiveContext = collectLearnSourceContext(
            contentPath,
            gardenId,
            context.selectedSourceIds,
            context.syllabus?.slug,
          );
          const rawSourceBindingProblems = syllabusCoverageRebindSourceBindingProblems({
            before: context,
            after: recoveryLiveContext,
          });
          const recoveryDriftProblems = syllabusCoverageRecoveryReceiptProblems({
            receipt: recovery.receipt,
            sources: syllabusCoverageRecoverySources(recoveryLiveContext),
            anchors: structuralSourceTextAnchorCatalog(recoveryLiveContext),
            coverage: recovery.coverage,
            expectedSourceSetHash: recoveryLiveContext.sourceSetHash,
            expectedSourceArtifactInventoryHash:
              recoveryLiveContext.sourceArtifactInventoryHash,
          });
          if (rawSourceBindingProblems.length > 0 ||
              recoveryLiveContext.sourceSetHash !== context.sourceSetHash ||
              recoveryLiveContext.sourceArtifactInventoryHash !==
                context.sourceArtifactInventoryHash ||
              recoveryDriftProblems.length > 0) {
            throw new LearnPipelineConflictError(
              `Selected source or syllabus evidence changed during bounded coverage rebind recovery: ${[
                ...rawSourceBindingProblems,
                ...recoveryDriftProblems,
              ].join("; ") || "live evidence hashes changed"}. No Source Map or Learning Unit Contract was requested.`,
            );
          }
          try {
            appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_reviewed", {
              jobId: job.id,
              stage: "source_map_rebind",
              outcome: recovery.receipt.outcome,
              receiptHash: recovery.receipt.integritySha256,
              selectedPages: recovery.receipt.selectedPages.map((page) => ({
                anchorId: page.anchorId,
                sourceId: page.sourceId,
                pageNumber: page.pageNumber,
                exactTextSha256: page.exactTextSha256,
              })),
              selectorCouncilRunId: recovery.receipt.selectorAttempts[0].councilRunId,
              coverageReviewCouncilRunId: recovery.receipt.coverageReviewAttempts[0].councilRunId,
              semanticCandidates: 2,
            });
          } catch {
            // Recovery review telemetry cannot replace the settled model result.
          }
          if (!recovery.recovered) {
            try {
              appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_terminal", {
                jobId: job.id,
                stage: "source_map_rebind",
                outcome: recovery.receipt.outcome,
                receiptHash: recovery.receipt.integritySha256,
                sourceMapRequested: false,
                learningUnitContractRequested: false,
              });
            } catch {
              // Terminal telemetry cannot replace the deterministic outcome.
            }
            throw new Error(
              "Independent exact-page syllabus coverage rereview still found zero teachable units. No Source Map or Learning Unit Contract was requested.",
            );
          }
        } catch (error) {
          try {
            appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_evidence_recovery_failed", {
              jobId: job.id,
              stage: "source_map_rebind",
              error: errorMessage(error),
              sourceMapRequested: false,
              learningUnitContractRequested: false,
            });
          } catch {
            // Recovery telemetry cannot replace the exact terminal failure.
          }
          throw error;
        }
      }
      const coverageLiveContext = collectLearnSourceContext(
        contentPath,
        gardenId,
        context.selectedSourceIds,
        context.syllabus?.slug,
      );
      const rawSourceBindingProblems = syllabusCoverageRebindSourceBindingProblems({
        before: context,
        after: coverageLiveContext,
      });
      if (rawSourceBindingProblems.length > 0 ||
          coverageLiveContext.sourceSetHash !== context.sourceSetHash ||
          coverageLiveContext.sourceArtifactInventoryHash !==
            context.sourceArtifactInventoryHash) {
        throw new LearnPipelineConflictError(
          `Selected source or syllabus evidence changed during syllabus coverage rebind: ${rawSourceBindingProblems.join("; ") || "live evidence hashes changed"}. No Source Map or Learning Unit Contract was requested.`,
        );
      }
      syllabusCoverage = reboundCoverage;
      replaceSyllabusCoverageWarnings(reboundCoverage);
      const summary = summarizeSyllabusCoverage(reboundCoverage);
      appendLearnEvent(contentPath, gardenId, "learn_syllabus_materials_resolved", {
        jobId: job.id,
        stage: "source_map_rebind",
        ...summary,
        missingCitations: reboundCoverage.missingCitations,
        untaughtUnitTitles: reboundCoverage.untaughtUnitTitles,
      });
      appendLearnEvent(contentPath, gardenId, "learn_syllabus_coverage_rebound", {
        jobId: job.id,
        sourceSetHash: context.sourceSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
        evidenceRecoveryHash: reboundCoverage.evidenceRecovery?.integritySha256 ?? "",
      });
    };

    await learnCheckpoint(job.id);
    const requestSourceMap = async (reauthorCycle: number) => {
      // Snapshot immediately before the model call. Rebuilding the prompt from
      // this exact ledger means a scan or cache mutation during a long model
      // call cannot be silently adopted as the call's baseline afterward.
      const artifactInventory = refreshSelectedSourceArtifactInventory(
        contentPath,
        gardenId,
        context,
      );
      const sourceSetHash = context.sourceSetHash;
      canonicalSourceAnchorCatalog = [
        ...structuralSourceAnchorPromptCatalog(structuralSourceAnchors),
        ...sourceMapFigureAnchorPromptCatalog(context.sourceFigures),
      ];
      promptSourceContext = promptSources(context, { sourceMapArtifactKinds: true });
      planningSourceMeta.sourceSetHash = context.sourceSetHash;
      planningSourceMeta.sourceArtifactInventoryHash = context.sourceArtifactInventoryHash;
      const syllabusQuestionUnits = (syllabusCoverage?.units ?? []).map((unit) => ({
        id: unit.unitId,
        questionReferences: unit.questionReferences ?? [],
      }));
      const sourceQuestionEvidence = buildSourceQuestionEvidenceCatalog({
        anchors: structuralSourceAnchors,
        figures: context.sourceFigures.filter((figure) => {
          const kind = sourceMapArtifactKind(figure.kind);
          return kind === "figure" || kind === "graph";
        }),
        syllabusUnits: syllabusQuestionUnits,
      });
      const call = await callValidatedPlanningJson({
        client,
        model,
        taskType: "source_map",
        gardenId,
        system: withLearnUserInstructionRules(
          withSyllabusRules(
            incrementalBaseline
              ? `${SOURCE_MAP_PROMPT}\n\nAdditive update rule: existingSourceMap.sourceAnchors and existingSourceMap.sourceQuestions are already referenced by published lesson contracts. Copy every existing record in both arrays exactly and in the same relative order, then add newly discovered anchors or questions with new unique ids.`
              : SOURCE_MAP_PROMPT,
            SYLLABUS_PLANNING_RULES,
            hasSyllabus,
          ),
          effectiveUserInstruction,
        ),
        user: compactJson({
          sourceOnly,
          userInstruction: effectiveUserInstruction,
          syllabus: syllabusPayload,
          syllabusCoverage: syllabusCoveragePayload(),
          sourceContext: promptSourceContext,
          canonicalSourceAnchors: canonicalSourceAnchorCatalog,
          sourceQuestionEvidence,
          ...(publishedMap
            ? { existingSourceMap: publishedMap.sourceMap }
            : {}),
        }),
        sourceContext: { ...planningSourceMeta, taskType: "source_map" },
        contentPath,
        jobId: job.id,
        stageKey: `source_map:source_map:cycle:${reauthorCycle}`,
        stageLabel: "Source Map",
        validate: (value) => [
          ...sourceMapPlanProblems({
            value,
            sourceIds: context.sources.map((source) => source.slug),
            sourceBodies: context.sources.map((source) => ({
              sourceId: source.slug,
              body: source.body ?? "",
            })),
            registeredArtifacts: context.sourceFigures,
            canonicalAnchors: canonicalSourceAnchorCatalog.map((anchor) => ({
              id: String(anchor.id),
              sourceId: String(anchor.sourceId),
            })),
            syllabusUnits: syllabusQuestionUnits,
          }),
          ...incrementalSourceMapPreservationProblems(
            value,
            publishedMap?.sourceMap,
          ),
        ],
      });
      return { call, artifactInventory, sourceSetHash };
    };
    let sourceMapReauthorAttempts = 0;
    let sourceMapRequest = await requestSourceMap(sourceMapReauthorAttempts);
    let sourceMapCall = sourceMapRequest.call;
    await learnCheckpoint(job.id);
    let sourceMap = sourceMapCall.parsed as Record<string, unknown>;
    let sourceMapArtifactInventory = sourceMapRequest.artifactInventory;
    let sourceMapSourceSetHash = sourceMapRequest.sourceSetHash;

    // A small fixed number of complete model reauthoring cycles is allowed
    // when pages selected by the Source Map reveal a different registered
    // artifact inventory. Every iteration checks even when the map selects no
    // pages, so concurrent ledger drift cannot be laundered into scope
    // planning; the hard cap below still fails closed.
    for (;;) {
      persistSelectedStructuralSourceAnchors({
        clusterDir: clusterPath(contentPath, gardenId),
        sourceMap,
        selectedSourceIds: context.sources.map((source) => source.slug),
        catalog: structuralSourceAnchors,
      });
      const selectedSourcePageHints = selectedStructuralSourcePageHints({
        sourceMap,
        catalog: structuralSourceAnchors,
        selectedSources: context.sources,
      });
      if (selectedSourcePageHints.length > 0) {
        const selectedPageDiscovery = await ensureReferencedSourceArtifactsExtracted({
          client,
          model,
          contentPath,
          gardenId,
          context,
          units: [],
          explicitPageHints: selectedSourcePageHints,
          checkpoint: () => throwIfLearnCancelled(job.id),
          onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
        });
        appendLearnEvent(contentPath, gardenId, "learn_source_map_pages_scanned", {
          jobId: job.id,
          sourceMapAttempt: sourceMapReauthorAttempts + 1,
          selectedAnchorIds: selectedSourcePageHints.map((hint) => hint.anchorId),
          requestedPages: selectedPageDiscovery.requestedPages,
          discoveredArtifactIds: selectedPageDiscovery.discoveredIds,
        });
        const postSelectionReview = await reviewAndBindSourceFormulas({
          client,
          model,
          contentPath,
          gardenId,
          context,
          checkpoint: () => throwIfLearnCancelled(job.id),
          onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
        });
        appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
          jobId: job.id,
          stage: sourceMapReauthorAttempts > 0
            ? "planning_source_map_pages_replan"
            : "planning_source_map_pages",
          reviewSetHash: postSelectionReview.reviewedFormulaSetHash,
          formulaCount: postSelectionReview.formulaIds.length,
          replacementCount: postSelectionReview.replacementFormulaIds.length,
          cacheHitCount: postSelectionReview.cacheHitFormulaIds.length,
          modelCalls: postSelectionReview.modelCalls,
        });
      }

      // Recollect after every selected-page scan. Formula review can change
      // the combined source-set hash without adding a visible artifact, while
      // a source/syllabus edit is never safe to rebind mechanically.
      const refreshedPlanningContext = collectLearnSourceContext(
        contentPath,
        gardenId,
        context.selectedSourceIds,
        context.syllabus?.slug,
      );
      const rawSourceBindingProblems = syllabusCoverageRebindSourceBindingProblems({
        before: context,
        after: refreshedPlanningContext,
      });
      if (rawSourceBindingProblems.length > 0) {
        throw new LearnPipelineConflictError(
          `Selected source or syllabus identity/raw evidence changed while Source Map pages were scanned: ${rawSourceBindingProblems.join("; ")}. No stale map was retained.`,
        );
      }
      context = refreshedPlanningContext;
      structuralSourceAnchors = structuralSourceTextAnchorCatalog(context);
      canonicalSourceAnchorCatalog = [
        ...structuralSourceAnchorPromptCatalog(structuralSourceAnchors),
        ...sourceMapFigureAnchorPromptCatalog(context.sourceFigures),
      ];
      promptSourceContext = promptSources(context, { sourceMapArtifactKinds: true });
      syllabusPayload = promptSyllabus(context);
      planningSourceMeta.sourceIds = context.sources.map((source) => source.slug);
      planningSourceMeta.sourceSetHash = context.sourceSetHash;
      planningSourceMeta.sourceArtifactInventoryHash = context.sourceArtifactInventoryHash;
      const postSelectedPageArtifactInventory = refreshSelectedSourceArtifactInventory(
        contentPath,
        gardenId,
        context,
      );
      const evidenceTransition = sourceMapPlanningEvidenceTransition({
        before: {
          sourceSetHash: sourceMapSourceSetHash,
          sourceArtifactInventoryHash:
            sourceMapArtifactInventory.sourceArtifactInventoryHash,
        },
        after: {
          sourceSetHash: context.sourceSetHash,
          sourceArtifactInventoryHash:
            postSelectedPageArtifactInventory.sourceArtifactInventoryHash,
        },
        reauthorAttempts: sourceMapReauthorAttempts,
      });
      if (evidenceTransition === "stable") break;
      if (evidenceTransition === "fail") {
        throw new Error(
          `Selected source-artifact inventory changed after ${MAX_SOURCE_MAP_EVIDENCE_REAUTHORS} bounded Source Map reauthorizations, or its source-set binding drifted. Start Learn planning again so no map can be confirmed against stale artifact evidence.`,
        );
      }

      appendLearnEvent(contentPath, gardenId, "learn_source_artifact_inventory_changed", {
        jobId: job.id,
        stage: "planning_source_map_pages",
        beforeHash: sourceMapArtifactInventory.sourceArtifactInventoryHash,
        afterHash: postSelectedPageArtifactInventory.sourceArtifactInventoryHash,
        beforeSourceSetHash: sourceMapSourceSetHash,
        afterSourceSetHash: context.sourceSetHash,
        beforeArtifactCount: sourceMapArtifactInventory.artifacts.length,
        afterArtifactCount: postSelectedPageArtifactInventory.artifacts.length,
        reauthorAttempt: sourceMapReauthorAttempts + 1,
        reauthorLimit: MAX_SOURCE_MAP_EVIDENCE_REAUTHORS,
        action: "rebind_syllabus_coverage_and_reauthor_source_map",
      });
      // The coverage call is model-authored against the refreshed ledger. It
      // replaces (rather than rewrites) any older coverage receipt, so a stale
      // recovery hash cannot reach Source Map, LUC, or commit persistence.
      const reauthorCycle = sourceMapReauthorAttempts + 1;
      await rebindSyllabusCoverage(reauthorCycle);
      sourceMapReauthorAttempts = reauthorCycle;
      sourceMapRequest = await requestSourceMap(reauthorCycle);
      sourceMapCall = sourceMapRequest.call;
      await learnCheckpoint(job.id);
      sourceMap = sourceMapCall.parsed as Record<string, unknown>;
      sourceMapArtifactInventory = sourceMapRequest.artifactInventory;
      sourceMapSourceSetHash = sourceMapRequest.sourceSetHash;
    }

    // The model request validates its own candidate, but run the same strict
    // registry check immediately before downstream scope reasoning as well.
    // This protects against a cache/scan race and proves the final Source Map
    // still partitions the exact current selected artifact inventory.
    const currentSourceMapArtifactProblems = sourceMapPlanProblems({
      value: sourceMap,
      sourceIds: context.sources.map((source) => source.slug),
      sourceBodies: context.sources.map((source) => ({
        sourceId: source.slug,
        body: source.body ?? "",
      })),
      registeredArtifacts: context.sourceFigures,
      canonicalAnchors: canonicalSourceAnchorCatalog.map((anchor) => ({
        id: String(anchor.id),
        sourceId: String(anchor.sourceId),
      })),
      syllabusUnits: (syllabusCoverage?.units ?? []).map((unit) => ({
        id: unit.unitId,
        questionReferences: unit.questionReferences ?? [],
      })),
    });
    currentSourceMapArtifactProblems.push(
      ...incrementalSourceMapPreservationProblems(
        sourceMap,
        publishedMap?.sourceMap,
      ),
    );
    if (currentSourceMapArtifactProblems.length > 0) {
      throw new Error(
        `The accepted Source Map is not valid against the current selected source-artifact inventory: ${currentSourceMapArtifactProblems.join("; ")}`,
      );
    }
    const sourceQuestions = projectSourceQuestions(sourceMap);
    const sourceMapBoundArtifactInventoryHash =
      sourceMapArtifactInventory.sourceArtifactInventoryHash;
    appendLearnEvent(contentPath, gardenId, "learn_source_map_created", {
      jobId: job.id,
      councilRunId: sourceMapCall.councilRunId,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      currentStep: "Creating scope contract",
      progressPercent: 35,
    });

    await learnCheckpoint(job.id);
    const scopeCall = await callValidatedPlanningJson({
      client,
      model,
      taskType: "scope_contract",
      gardenId,
      system: withLearnUserInstructionRules(
        withSyllabusRules(SCOPE_CONTRACT_PROMPT, SYLLABUS_PLANNING_RULES, hasSyllabus),
        effectiveUserInstruction,
      ),
      // The scope contract reasons over the source map (already a digest of the
      // full text), so it takes the compacted map + a body-free source context.
      // The syllabus stays in full: it is what defines the scope.
      user: compactJson({
        sourceOnly,
        userInstruction: effectiveUserInstruction,
        syllabus: syllabusPayload,
        syllabusCoverage: syllabusCoveragePayload(),
        sourceMap,
        sources: promptSourcesCompact(context),
      }),
      sourceContext: { ...planningSourceMeta, taskType: "scope_contract" },
      contentPath,
      jobId: job.id,
      stageKey: "scope_contract:scope_contract",
      stageLabel: "Scope Contract",
      validate: scopeContractProblems,
    });
    await learnCheckpoint(job.id);
    const scopeContract = scopeCall.parsed as Record<string, unknown>;
    appendLearnEvent(contentPath, gardenId, "learn_scope_contract_created", {
      jobId: job.id,
      councilRunId: scopeCall.councilRunId,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      currentStep: "Creating learning map",
      progressPercent: 65,
    });

    // The spine receives the complete validated Source Map and Scope Contract.
    // Raw source bodies stay out, while the packet projection serializes the
    // canonical artifact catalog once and retains all non-artifact semantics.
    const spineSourceContext = promptSourcesCompact(context);
    const topicMapPlanningPacket = () => {
      const packet = projectCanonicalLearningSpinePacket({
        sourceOnly,
        userInstruction: effectiveUserInstruction,
        syllabus: syllabusPayload,
        syllabusCoverage: syllabusCoveragePayload(),
        sourceMap,
        scopeContract,
        sources: spineSourceContext,
        extractedSourceArtifacts: context.sourceFigures.map((figure) => ({
          id: figure.figureId,
          kind: sourceMapArtifactKind(figure.kind),
          sourceId: figure.sourceId ?? "",
          page: figure.page,
          caption: figure.caption,
          suggestedVisualUse: figure.suggestedVisualUse,
        })),
        responseShape: "LearningUnitContract JSON",
      });
      return incrementalBaseline
        ? {
            ...packet,
            updateMode: "additive",
            existingCurriculum: {
              learningUnits: incrementalBaseline.learningUnits,
              sourceArtifactOmissions:
                incrementalBaseline.sourceArtifactOmissions,
            },
          }
        : packet;
    };
    const topicMapSystemPrompt = incrementalBaseline
      ? `${TOPIC_MAP_PROMPT}\n\n${INCREMENTAL_TOPIC_MAP_RULES}`
      : TOPIC_MAP_PROMPT;
    const topicMapUser = (repair?: LearningSpineFullRepairFeedback) =>
      compactJson({
        ...topicMapPlanningPacket(),
        ...(repair
          ? {
              repair: {
                ...repair,
                instruction:
                  "The strongest rejected candidate below failed these hard checks. Return a complete corrected replacement JSON object, not a patch or prose explanation. The bounded repairHistory records the exact hard-check history and whether each prior response became the next repair incumbent. Preserve valid source assignments and complete omission records (disposition, artifactSummary, reason, and alternativeArtifactId), regenerate every precise learningUnit needed for full teachable-syllabus and in-scope source coverage without an arbitrary unit or section ceiling, partition every registered artifact exactly once between an owning unit and sourceArtifactOmissions, keep semanticConcepts separate from readable knowledgeClaims, and do not return sections first. Treat role as the teaching move rather than the owned artifact type: formulas may support any appropriate role, so never turn concept/mechanism/application/interpretation/synthesis/practice units into formula units merely because they own equations; a rich spine must use at least three appropriate roles including conceptual/mechanism and application/interpretation/synthesis/practice. If a semanticConcept slug appears in multiple units, every occurrence must use exactly the same preferredLabel and exactly the same aliases array in the same order; author that identity yourself because code will never choose or merge it.",
              },
            }
          : {}),
      });

    await learnCheckpoint(job.id);
    let topicMapCall = await callPlanningJsonOnce({
      client,
      model,
      taskType: "learning_spine",
      gardenId,
      system: withLearnUserInstructionRules(
        withSyllabusRules(topicMapSystemPrompt, SYLLABUS_PLANNING_RULES, hasSyllabus),
        effectiveUserInstruction,
      ),
      user: topicMapUser(),
      sourceContext: { ...planningSourceMeta, taskType: "learning_spine" },
      contentPath,
      jobId: job.id,
      stageKey: "learning_spine:initial",
      stageLabel: "Learning spine",
      semanticAttempt: 0,
      preserveExactContent: true,
    });
    assertNonemptyPlanningCandidate(topicMapCall, "Learning spine");
    await learnCheckpoint(job.id);
    let latestSourceArtifactProblems: string[] = [];
    const reconcilePlannedSourceArtifacts = async (
      candidateUnits: LearningUnitContract[],
      stage: "initial" | "repair",
    ): Promise<LearningUnitContract[]> => {
      const reviewHashBeforeExtraction = context.sourceFormulaReviewSetHash;
      const resolution = await ensureReferencedSourceArtifactsExtracted({
        client,
        model,
        contentPath,
        gardenId,
        context,
        units: candidateUnits,
        checkpoint: () => throwIfLearnCancelled(job.id),
        onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
      });
      const reconciledFormulaReview = await reviewAndBindSourceFormulas({
        client,
        model,
        contentPath,
        gardenId,
        context,
        checkpoint: () => throwIfLearnCancelled(job.id),
        onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
      });
      planningSourceMeta.sourceSetHash = context.sourceSetHash;
      appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
        jobId: job.id,
        stage: `planning_contract_${stage}`,
        reviewSetHash: reconciledFormulaReview.reviewedFormulaSetHash,
        formulaCount: reconciledFormulaReview.formulaIds.length,
        replacementCount: reconciledFormulaReview.replacementFormulaIds.length,
        cacheHitCount: reconciledFormulaReview.cacheHitFormulaIds.length,
        modelCalls: reconciledFormulaReview.modelCalls,
      });
      if (
        context.sourceFormulaReviewSetHash !== reviewHashBeforeExtraction ||
        context.sourceArtifactInventoryHash !== sourceMapBoundArtifactInventoryHash
      ) {
        throw new Error(
          "Referenced-page extraction changed the reviewed source-formula or full source-artifact inventory after the Source Map and Scope Contract were authored. No map was committed; restart Learn planning so every semantic plan is authored from the complete reviewed ledger.",
        );
      }
      const reconciliation = reconcileLearningUnitSourceArtifacts(
        candidateUnits,
        [],
        registeredArtifactsFromFigures(context.sourceFigures),
      );
      if (reconciliation.removedArtifactIds.length > 0 || resolution.requestedIds.length > 0) {
        appendLearnEvent(contentPath, gardenId, "learn_source_artifacts_reconciled", {
          jobId: job.id,
          stage,
          requestedIds: resolution.requestedIds,
          unresolvedIds: resolution.unresolvedIds,
          removedArtifactIds: reconciliation.removedArtifactIds,
        });
      }
      latestSourceArtifactProblems = [
        ...(reconciliation.removedArtifactIds.length > 0
          ? [
            `model referenced unregistered structured source artifacts: ${reconciliation.removedArtifactIds.join(", ")}; return a complete replacement contract using only registered extractedSourceArtifacts`,
          ]
          : []),
      ];
      return candidateUnits;
    };

    let learningUnits = normalizeLearningUnits(topicMapCall.parsed, { modelAuthoredOnly: true });
    let sourceArtifactOmissions = projectModelAuthoredSourceArtifactOmissions(topicMapCall.parsed);
    learningUnits = await reconcilePlannedSourceArtifacts(learningUnits, "initial");
    let artifactCount = importantSourceArtifactCount(context);
    let contractProblems = [
      ...modelAuthoredLearningMapMetadataProblems(topicMapCall.parsed),
      ...modelAuthoredLearningUnitParseProblems(topicMapCall.parsed),
      ...modelAuthoredSourceArtifactOmissionParseProblems(topicMapCall.parsed),
      ...modelAuthoredUnitTitleProblems(learningUnits),
      ...prematureVisualPlanningProblems(learningUnits),
      ...sourceArtifactOwnershipProblems(learningUnits),
      ...sourceArtifactCoverageProblems(
        learningUnits,
        sourceArtifactOmissions,
        registeredArtifactsFromFigures(context.sourceFigures),
      ),
      ...latestSourceArtifactProblems,
      ...canonicalSourceAnchorProblems(clusterPath(contentPath, gardenId), learningUnits),
      ...syllabusUnitAssignmentProblems(learningUnits, syllabusCoverage ?? null),
      ...sourceQuestionAssignmentProblems(learningUnits, sourceQuestions),
      ...incrementalLearningUnitPreservationProblems(
        learningUnits,
        incrementalBaseline?.learningUnits ?? [],
      ),
      ...conceptRegistryAlignmentProblems({
        clusterDir: clusterPath(contentPath, gardenId),
        sourceSetHash: context.sourceSetHash,
        units: learningUnits,
      }),
      ...(
      learningUnits.length === 0
        ? ["planner returned no learningUnits"]
        : validateLearningUnitContracts(learningUnits, {
            artifactCount,
            requireModelAuthoredSemantics: true,
            requireModelAuthoredSections: true,
          })
      ),
      ...modelAuthoredLearningMapDepthProblems({
        candidate: topicMapCall.parsed,
        units: learningUnits,
        gardenId,
        sourceOnly,
        context,
      }),
    ];

    let fullRepairLineage = startLearningSpineFullRepairLineage({
      payload: {
        call: topicMapCall,
        units: learningUnits,
        sourceArtifactOmissions,
      },
      invalidResponse: topicMapCall.content,
      unitCount: learningUnits.length,
      validationProblems: contractProblems,
    });

    // Invalid pedagogy is repaired by the model that authored it. Keep the
    // strongest model-authored candidate across two bounded full-contract repairs;
    // code never invents a generic curriculum to make the gate go green.
    for (let repairAttempt = 1; repairAttempt <= 2 && contractProblems.length > 0; repairAttempt += 1) {
      const repairFeedback = learningSpineFullRepairFeedback(fullRepairLineage, repairAttempt);
      const retryCall = await callPlanningJsonOnce({
        client,
        model,
        taskType: "learning_spine",
        gardenId,
        system: withLearnUserInstructionRules(
          withSyllabusRules(topicMapSystemPrompt, SYLLABUS_PLANNING_RULES, hasSyllabus),
          effectiveUserInstruction,
        ),
        user: topicMapUser(repairFeedback),
        sourceContext: {
          ...planningSourceMeta,
          taskType: "learning_spine_repair",
          repairAttempt,
          validationProblems: repairFeedback.validationProblems,
        },
        contentPath,
        jobId: job.id,
        stageKey: "learning_spine:full_repair",
        stageLabel: "Learning spine repair",
        semanticAttempt: repairAttempt,
        preserveExactContent: true,
      });
      assertNonemptyPlanningCandidate(retryCall, "Learning spine repair");
      let retryUnits = normalizeLearningUnits(retryCall.parsed, { modelAuthoredOnly: true });
      const retrySourceArtifactOmissions = projectModelAuthoredSourceArtifactOmissions(retryCall.parsed);
      retryUnits = await reconcilePlannedSourceArtifacts(retryUnits, "repair");
      artifactCount = importantSourceArtifactCount(context);
      const retryProblems = [
        ...modelAuthoredLearningMapMetadataProblems(retryCall.parsed),
        ...modelAuthoredLearningUnitParseProblems(retryCall.parsed),
        ...modelAuthoredSourceArtifactOmissionParseProblems(retryCall.parsed),
        ...modelAuthoredUnitTitleProblems(retryUnits),
        ...prematureVisualPlanningProblems(retryUnits),
        ...sourceArtifactOwnershipProblems(retryUnits),
        ...sourceArtifactCoverageProblems(
          retryUnits,
          retrySourceArtifactOmissions,
          registeredArtifactsFromFigures(context.sourceFigures),
        ),
        ...latestSourceArtifactProblems,
        ...canonicalSourceAnchorProblems(clusterPath(contentPath, gardenId), retryUnits),
        ...syllabusUnitAssignmentProblems(retryUnits, syllabusCoverage ?? null),
        ...sourceQuestionAssignmentProblems(retryUnits, sourceQuestions),
        ...incrementalLearningUnitPreservationProblems(
          retryUnits,
          incrementalBaseline?.learningUnits ?? [],
        ),
        ...conceptRegistryAlignmentProblems({
          clusterDir: clusterPath(contentPath, gardenId),
          sourceSetHash: context.sourceSetHash,
          units: retryUnits,
        }),
        ...(
        retryUnits.length === 0
          ? ["planner returned no learningUnits"]
          : validateLearningUnitContracts(retryUnits, {
              artifactCount,
              requireModelAuthoredSemantics: true,
              requireModelAuthoredSections: true,
            })
        ),
        ...modelAuthoredLearningMapDepthProblems({
          candidate: retryCall.parsed,
          units: retryUnits,
          gardenId,
          sourceOnly,
          context,
        }),
      ];
      fullRepairLineage = recordLearningSpineFullRepairCandidate({
        lineage: fullRepairLineage,
        semanticAttempt: repairAttempt + 1,
        candidate: {
          payload: {
            call: retryCall,
            units: retryUnits,
            sourceArtifactOmissions: retrySourceArtifactOmissions,
          },
          invalidResponse: retryCall.content,
          unitCount: retryUnits.length,
          validationProblems: retryProblems,
        },
      });
      const lineageReview = fullRepairLineage.history.at(-1);
      try {
        appendLearnEvent(contentPath, gardenId, "learn_learning_spine_repair_reviewed", {
          jobId: job.id,
          repairAttempt,
          candidateUnitCount: retryUnits.length,
          promotedToIncumbent: lineageReview?.promotedToIncumbent ?? false,
          incumbentUnitCount: fullRepairLineage.incumbent.unitCount,
          problemsBefore: repairFeedback.validationProblems,
          problemsAfter: retryProblems,
        });
      } catch {
        // Repair telemetry cannot replace the returned candidate or its review.
      }
      topicMapCall = fullRepairLineage.incumbent.payload.call;
      learningUnits = fullRepairLineage.incumbent.payload.units;
      sourceArtifactOmissions = fullRepairLineage.incumbent.payload.sourceArtifactOmissions;
      contractProblems = fullRepairLineage.incumbent.validationProblems;
    }

    // A whole-spine rewrite can leave one local identity failure while
    // disturbing dozens of already valid units. After the original initial +
    // two full replacements are exhausted, let the model replace only the
    // complete unit records explicitly implicated by unit-index/id failures or
    // concept conflicts. Any global/unscoped problem fails closed. The merge is
    // structural only; the model authors every field and all semantic choices.
    let targetedRepairOutcome: { calls: number; status: string } | undefined;
    if (contractProblems.length > 0) {
      const incumbentCandidateBeforeTargetedRepair = planningRecord(topicMapCall.parsed);
      const targetedRepair = await runLearningSpineTargetedRepair({
        candidate: incumbentCandidateBeforeTargetedRepair,
        units: learningUnits,
        validationProblems: contractProblems,
        canonicalPlanningPacket: topicMapPlanningPacket(),
        canonicalEvidenceByUnit: canonicalLearningSpineEvidenceByUnit(
          clusterPath(contentPath, gardenId),
          learningUnits,
        ),
        maxAttempts: 2,
        provider: async (request) => {
          await learnCheckpoint(job.id);
          const result = await callPlanningJsonOnce({
            client,
            model,
            taskType: "learning_spine",
            gardenId,
            system: withLearnUserInstructionRules(
              withSyllabusRules(request.system, SYLLABUS_PLANNING_RULES, hasSyllabus),
              effectiveUserInstruction,
            ),
            user: request.user,
            sourceContext: {
              ...planningSourceMeta,
              taskType: "learning_spine_targeted_repair",
              repairAttempt: request.attempt,
              unitIds: request.unitIds,
            },
            contentPath,
            jobId: job.id,
            stageKey: "learning_spine:targeted_repair",
            stageLabel: "Learning spine targeted repair",
            semanticAttempt: request.attempt,
          });
          assertNonemptyPlanningCandidate(result, "Learning spine targeted repair");
          // Nonempty malformed structured output is concrete returned evidence
          // for the bounded targeted loop. Missing/null output and provider or
          // transport exceptions propagate without consuming a semantic retry.
          return result.parsed;
        },
        validateCandidate: (candidate) => {
          const candidateUnits = normalizeLearningUnits(candidate, { modelAuthoredOnly: true });
          const candidateOmissions = projectModelAuthoredSourceArtifactOmissions(candidate);
          const unregisteredArtifacts = reconcileLearningUnitSourceArtifacts(
            candidateUnits,
            [],
            registeredArtifactsFromFigures(context.sourceFigures),
          ).removedArtifactIds;
          const candidateArtifactProblems = unregisteredArtifacts.length > 0
            ? [
                `model referenced unregistered structured source artifacts: ${unregisteredArtifacts.join(", ")}; return complete replacement units using only registered extractedSourceArtifacts`,
              ]
            : [];
          const problems = [
            ...modelAuthoredLearningMapMetadataProblems(candidate),
            ...modelAuthoredLearningUnitParseProblems(candidate),
            ...modelAuthoredSourceArtifactOmissionParseProblems(candidate),
            ...modelAuthoredUnitTitleProblems(candidateUnits),
            ...prematureVisualPlanningProblems(candidateUnits),
            ...sourceArtifactOwnershipProblems(candidateUnits),
            ...sourceArtifactCoverageProblems(
              candidateUnits,
              candidateOmissions,
              registeredArtifactsFromFigures(context.sourceFigures),
            ),
            ...candidateArtifactProblems,
            ...canonicalSourceAnchorProblems(clusterPath(contentPath, gardenId), candidateUnits),
            ...syllabusUnitAssignmentProblems(candidateUnits, syllabusCoverage ?? null),
            ...sourceQuestionAssignmentProblems(candidateUnits, sourceQuestions),
            ...incrementalLearningUnitPreservationProblems(
              candidateUnits,
              incrementalBaseline?.learningUnits ?? [],
            ),
            ...conceptRegistryAlignmentProblems({
              clusterDir: clusterPath(contentPath, gardenId),
              sourceSetHash: context.sourceSetHash,
              units: candidateUnits,
            }),
            ...(candidateUnits.length === 0
              ? ["planner returned no learningUnits"]
              : validateLearningUnitContracts(candidateUnits, {
                  artifactCount,
                  requireModelAuthoredSemantics: true,
                  requireModelAuthoredSections: true,
                })),
            ...modelAuthoredLearningMapDepthProblems({
              candidate,
              units: candidateUnits,
              gardenId,
              sourceOnly,
              context,
            }),
          ];
          return { units: candidateUnits, problems };
        },
      });
      for (const review of targetedRepair.reviews) {
        try {
          appendLearnEvent(contentPath, gardenId, "learn_learning_spine_targeted_repair_reviewed", {
            jobId: job.id,
            repairExecutorMode: "model",
            repairAttempt: review.attempt,
            unitIds: review.unitIds,
            responseProblems: review.responseProblems,
            problemsAfter: review.mergedProblems,
            accepted: review.accepted,
            introducedUnscopedProblems: review.introducedUnscopedProblems,
          });
        } catch {
          // Review telemetry is subordinate to the bounded repair result.
        }
      }
      try {
        appendLearnEvent(contentPath, gardenId, "learn_learning_spine_targeted_repair_completed", {
          jobId: job.id,
          repairExecutorMode: "model",
          status: targetedRepair.status,
          modelCalls: targetedRepair.calls,
          problemsBefore: contractProblems,
          problemsAfter: targetedRepair.problems,
          unscopedProblems: targetedRepair.unscopedProblems,
        });
      } catch {
        // Completion telemetry cannot replace the bounded repair result.
      }
      targetedRepairOutcome = {
        calls: targetedRepair.calls,
        status: targetedRepair.status,
      };
      if (targetedRepair.candidate !== incumbentCandidateBeforeTargetedRepair) {
        topicMapCall = {
          ...topicMapCall,
          parsed: targetedRepair.candidate,
          content: compactJson(targetedRepair.candidate),
        };
        learningUnits = targetedRepair.units;
        sourceArtifactOmissions = projectModelAuthoredSourceArtifactOmissions(targetedRepair.candidate);
      }
      contractProblems = targetedRepair.problems;
    }

    if (contractProblems.length > 0) {
      const attemptDescription = describeLearningSpineRepairAttempts({
        fullContractAttempts: 3,
        targetedCalls: targetedRepairOutcome?.calls ?? 0,
        targetedStatus: targetedRepairOutcome?.status ?? "not_run",
      });
      throw new Error(
        `The AI-authored Learning Unit Contract remained invalid ${attemptDescription}: ${contractProblems.join("; ")}. No fallback curriculum was written.`,
      );
    }

    await learnCheckpoint(job.id);
    const visualNecessityReview = await planAndReviewVisualNecessity({
      client,
      model,
      gardenId,
      contentPath,
      jobId: job.id,
      learningUnits,
    });
    // The reviewer propagates provider failures. Keep the durable cancellation
    // checkpoint immediately before any map/artifact commit as a final guard.
    throwIfLearnCancelled(job.id);
    learningUnits = visualNecessityReview.learningUnits;
    const incrementalPostVisualProblems =
      incrementalLearningUnitPreservationProblems(
        learningUnits,
        incrementalBaseline?.learningUnits ?? [],
      );
    if (incrementalPostVisualProblems.length > 0) {
      throw new Error(
        `The additive Learning Unit Contract changed published units during visual planning: ${incrementalPostVisualProblems.join("; ")}`,
      );
    }
    const planRecord = planningRecord(topicMapCall.parsed);
    const finalOwnershipProblems = sourceArtifactOwnershipProblems(learningUnits);
    if (finalOwnershipProblems.length > 0) {
      throw new Error(`Model-authored source artifact ownership remained invalid: ${finalOwnershipProblems.join("; ")}`);
    }
    const finalSourceArtifactCoverageProblems = sourceArtifactCoverageProblems(
      learningUnits,
      sourceArtifactOmissions,
      registeredArtifactsFromFigures(context.sourceFigures),
    );
    if (finalSourceArtifactCoverageProblems.length > 0) {
      throw new Error(
        `Model-authored source artifact coverage remained invalid: ${finalSourceArtifactCoverageProblems.join("; ")}`,
      );
    }
    let sourceArtifactAssignments = projectModelAuthoredSourceArtifactAssignments(learningUnits);
    let learningMap = learningMapFromPlanningCandidate({
      candidate: topicMapCall.parsed,
      units: learningUnits,
      gardenId,
      sourceOnly,
      createdAt: nowIso(),
      warnings: Array.from(
        new Set([
          ...(Array.isArray(planRecord.warnings) ? planRecord.warnings.filter((item): item is string => typeof item === "string") : []),
          ...planningWarnings,
          ...syllabusCoverageWarnings,
        ]),
      ),
    });
    const depthProblems = validateLearningMapDepth(learningMap, context);
    if (depthProblems.length > 0) {
      throw new Error(
        `Learning spine depth invariant failed after bounded model repair: ${depthProblems.join("; ")}`,
      );
    }
    const coveragePlan = sourceCoveragePlan(
      context,
      learningMap,
      learningUnits,
      sourceArtifactAssignments,
      sourceArtifactOmissions,
      buildCanonicalSourceAnchors(clusterPath(contentPath, gardenId), { allowInferredFormulaText: false }),
      syllabusCoverage,
    );
    const commitContext = collectLearnSourceContext(
      contentPath,
      gardenId,
      context.selectedSourceIds,
      context.syllabus?.slug,
    );
    if (
      commitContext.sourceSetHash !== context.sourceSetHash ||
      commitContext.sourceArtifactInventoryHash !== context.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected sources or their registered artifact inventory changed during planning. Run Learn again to review a map grounded in the current files.",
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context: commitContext,
      coveragePlan,
      syllabusCoverage,
      stage: "Planning commit",
    });
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease before committing artifacts.",
      );
    }
    const storedMap = db.transaction(() => {
      const stored = insertLearnMap({
        gardenId,
        jobId: job.id,
        sourceMap,
        scopeContract,
        learningMap,
        coveragePlan,
        sourceSetHash: context.sourceSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
        sourceIds: context.selectedSourceIds,
        syllabusSourceId: context.syllabus?.slug,
        syllabusCoverage,
      });
      // A failed semantic artifact commit rolls this database insert back, so
      // a failed Learn job cannot leave behind a confirmable orphan map.
      const contractWrite = writeLearningUnitContractArtifacts({
        clusterDir: clusterPath(contentPath, gardenId),
        units: learningUnits,
        assignments: sourceArtifactAssignments,
        omissions: sourceArtifactOmissions,
        registeredArtifacts: registeredArtifactsFromFigures(context.sourceFigures),
        sourceSetHash: context.sourceSetHash,
        sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
        syllabusCoverageEvidenceRecovery: syllabusCoverage?.evidenceRecovery,
        visualNecessityReview,
      });
      learningUnits = contractWrite.units;
      sourceArtifactAssignments = contractWrite.assignments;
      sourceArtifactOmissions = contractWrite.omissions;
      learningMap = learningMapWithConfirmedUnitContracts(learningMap, learningUnits);
      const repairedCoveragePlan = sourceCoveragePlan(
        context,
        learningMap,
        learningUnits,
        sourceArtifactAssignments,
        sourceArtifactOmissions,
        buildCanonicalSourceAnchors(clusterPath(contentPath, gardenId), { allowInferredFormulaText: false }),
        syllabusCoverage,
      );
      const mapContractUpdate = db.prepare(
        `UPDATE learn_maps
         SET learning_map_json = ?, proposed_order_json = ?, coverage_plan_json = ?
         WHERE id = ? AND source_artifact_inventory_hash = ?`,
      ).run(
        jsonString(learningMap),
        jsonString(learningMap.sections),
        jsonString(repairedCoveragePlan),
        stored.id,
        context.sourceArtifactInventoryHash,
      );
      if (mapContractUpdate.changes !== 1) {
        throw new LearnPipelineConflictError(
          "The proposed Learning Map artifact-inventory binding changed before its contract could commit.",
        );
      }
      return {
        ...stored,
        learningMap,
        proposedOrder: learningMap.sections,
        coveragePlan: repairedCoveragePlan,
      };
    })();
    const visualizationPlanningStartedAt = Date.now();
    let visualContractRepairSemanticAttempt = 0;
    const canonicalVisualEvidence = canonicalVisualizationEvidenceByUnit(
      clusterPath(contentPath, gardenId),
      learningUnits,
    );
    const visualizationPlanning = await buildVisualizationPlanWithContractRepair({
      gardenId,
      learningMap,
      learningUnits,
      visualBudget: visualNecessityReview.budget,
      canonicalEvidenceByUnit: canonicalVisualEvidence,
      necessityReviewCalls: visualNecessityReview.reviewCalls,
      rejectedNecessityReviews: visualNecessityReview.rejectedReviews,
      visualDecisionOverrides: visualNecessityReview.overrides,
      repairProvider: (packet) => requestVisualizationContractRepair({
        client,
        model,
        gardenId,
        contentPath,
        jobId: job.id,
        semanticAttempt: visualContractRepairSemanticAttempt++,
        packet,
      }),
      maxRepairAttempts: 2,
      checkCancelled: () => throwIfLearnCancelled(job.id),
      onEvent: (type, data) => appendLearnEvent(contentPath, gardenId, type, {
        jobId: job.id,
        learningMapId: storedMap.id,
        ...data,
      }),
    });
    const planningExecutabilityContext = {
      phase: "planning" as const,
      jobId: job.id,
      model,
      learningMapId: storedMap.id,
    };
    const executabilityReview = await reviewVisualizationPlanExecutability({
      gardenId,
      learningMap,
      learningUnits: visualizationPlanning.learningUnits,
      initialPlan: visualizationPlanning.plan,
      canonicalEvidenceByUnit: canonicalVisualEvidence,
      auditContext: planningExecutabilityContext,
      maximumRepeatedInteractionSignature: LEARN_VISUAL_MAX_REPEATED_INTERACTION_SIGNATURE,
      provider: (request) => requestVisualizationContractExecutabilityReview({
        client,
        model,
        gardenId,
        contentPath,
        jobId: job.id,
        request,
      }),
      checkCancelled: () => throwIfLearnCancelled(job.id),
      onEvent: (type, data) => appendLearnEvent(contentPath, gardenId, type, {
        jobId: job.id,
        learningMapId: storedMap.id,
        ...data,
      }),
    });
    learningUnits = executabilityReview.learningUnits;
    let visualizationPlan = executabilityReview.plan;
    learningUnits = applyVisualizationRoutesToLearningUnits(learningUnits, visualizationPlan);
    // Confirmation reloads the routed contracts through normalizeLearningUnits.
    // Build every persisted visual projection from that same canonical form so
    // whitespace/optional-field normalization cannot make the signed ledger
    // disagree with the Learning Unit Contract after its SQLite round-trip.
    learningUnits = normalizeLearningUnits(
      { learningUnits },
      { modelAuthoredOnly: true },
    );
    const finalSourceQuestionProblems = sourceQuestionAssignmentProblems(
      learningUnits,
      sourceQuestions,
    );
    if (finalSourceQuestionProblems.length > 0) {
      throw new Error(
        `Model-authored source-question mapping remained invalid: ${finalSourceQuestionProblems.join("; ")}`,
      );
    }
    visualizationPlan = buildFinalVisualizationPlanFromRoutedContracts({
      gardenId,
      learningMap,
      finalRoutedLearningUnits: learningUnits,
      reviewedPlan: visualizationPlan,
      canonicalEvidenceByUnit: canonicalVisualEvidence,
    });
    // Construct and validate the complete audit envelope before any of the
    // reviewed contracts or plan are persisted. A malformed review/audit can
    // therefore never leave a partially published contract set behind.
    const planningExecutabilityLedger = buildVisualContractExecutabilityLedger({
      gardenId,
      context: planningExecutabilityContext,
      review: executabilityReview,
      finalRoutedLearningUnits: learningUnits,
      finalVisualizationPlan: visualizationPlan,
      structuralContractRepair: {
        source: visualizationPlanning.repairSource,
        ...visualizationPlanning.repairAudit,
      },
    });
    // The visual allocation is a confirmed-map decision, not generation-time
    // advice. Persist its full pre-executability record, final route plan, and
    // signed review ledger together with the exact source/contract bindings.
    const confirmedVisualRouteBundle = createConfirmedVisualRouteBundle({
      sourceSetHash: context.sourceSetHash,
      sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
      sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
      learningUnits,
      visualNecessityReview,
      visualizationPlan,
      executabilityLedger: planningExecutabilityLedger,
    });
    persistRoutedVisualPlans(clusterPath(contentPath, gardenId), learningUnits);
    learningMap = learningMapWithConfirmedUnitContracts(learningMap, learningUnits);
    const routedCoveragePlan = sourceCoveragePlan(
      context,
      learningMap,
      learningUnits,
      sourceArtifactAssignments,
      sourceArtifactOmissions,
      buildCanonicalSourceAnchors(clusterPath(contentPath, gardenId), { allowInferredFormulaText: false }),
      syllabusCoverage,
    );
    const routedMapUpdate = db.prepare(
      `UPDATE learn_maps
       SET learning_map_json = ?, proposed_order_json = ?, coverage_plan_json = ?,
           visual_necessity_review_json = ?, visualization_plan_json = ?,
           visual_contract_executability_ledger_json = ?, visual_route_binding_json = ?
       WHERE id = ? AND source_artifact_inventory_hash = ?`,
    ).run(
      jsonString(learningMap),
      jsonString(learningMap.sections),
      jsonString(routedCoveragePlan),
      jsonString(confirmedVisualRouteBundle.visualNecessityReview),
      jsonString(confirmedVisualRouteBundle.visualizationPlan),
      jsonString(confirmedVisualRouteBundle.executabilityLedger),
      jsonString(confirmedVisualRouteBundle.binding),
      storedMap.id,
      context.sourceArtifactInventoryHash,
    );
    if (routedMapUpdate.changes !== 1) {
      throw new LearnPipelineConflictError(
        "The proposed Learning Map artifact-inventory binding changed during visual planning.",
      );
    }
    Object.assign(storedMap, {
      learningMap,
      proposedOrder: learningMap.sections,
      coveragePlan: routedCoveragePlan,
      visualNecessityReview: confirmedVisualRouteBundle.visualNecessityReview,
      visualizationPlan: confirmedVisualRouteBundle.visualizationPlan,
      visualContractExecutabilityLedger: confirmedVisualRouteBundle.executabilityLedger,
      visualRouteBinding: confirmedVisualRouteBundle.binding,
    });
    saveVisualizationPlan(clusterPath(contentPath, gardenId), visualizationPlan);
    saveVisualContractExecutabilityLedger({
      gardenDir: clusterPath(contentPath, gardenId),
      ledger: planningExecutabilityLedger,
    });
    appendLearnEvent(contentPath, gardenId, "visual_contract_executability_ledger_persisted", {
      jobId: job.id,
      learningMapId: storedMap.id,
      path: VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH,
      modelCalls: executabilityReview.calls,
      replacedUnitIds: executabilityReview.replacedUnitIds,
      phase: "planning",
      visualRouteBindingHash: confirmedVisualRouteBindingHash(
        confirmedVisualRouteBundle.binding,
      ),
    });
    appendLearnEvent(contentPath, gardenId, "visual_opportunity_analysis_completed", {
      jobId: job.id,
      learningMapId: storedMap.id,
      opportunitiesDetected: visualizationPlan.opportunities.length,
      durationMs: Date.now() - visualizationPlanningStartedAt,
      phase: "planning",
      visualRouteBindingHash: confirmedVisualRouteBindingHash(
        confirmedVisualRouteBundle.binding,
      ),
    });
    for (const opportunity of visualizationPlan.opportunities) {
      appendLearnEvent(contentPath, gardenId, "visual_opportunity_detected", {
        jobId: job.id,
        learningMapId: storedMap.id,
        visualizationId: opportunity.id,
        learningUnitId: opportunity.learningUnitId,
        priority: opportunity.priority,
        interactionGoal: opportunity.interactionGoal,
        sourceAnchors: opportunity.sourceAnchorIds,
      });
    }
    for (const decision of visualizationPlan.decisions) {
      appendLearnEvent(contentPath, gardenId, "visual_route_selected", {
        jobId: job.id,
        learningMapId: storedMap.id,
        visualizationId: decision.opportunityId,
        route: decision.route,
        selectedRenderer: decision.selectedRenderer,
        compatibilityScore: decision.compatibilityScore,
        reason: decision.reason,
        duplicateOf: decision.duplicateOf,
        phase: "planning",
        visualRouteBindingHash: confirmedVisualRouteBindingHash(
          confirmedVisualRouteBundle.binding,
        ),
      });
    }
    const finalPlanningContext = collectLearnSourceContext(
      contentPath,
      gardenId,
      context.selectedSourceIds,
      context.syllabus?.slug,
    );
    if (
      finalPlanningContext.sourceSetHash !== storedMap.sourceSetHash ||
      finalPlanningContext.sourceArtifactInventoryHash !==
        storedMap.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected sources or their artifact inventory changed before the Learning Map became confirmable. No stale map was retained; run Learn planning again.",
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context: finalPlanningContext,
      coveragePlan: storedMap.coveragePlan,
      syllabusCoverage: storedMap.syllabusCoverage,
      stage: "Final planning",
    });
    appendLearnEvent(contentPath, gardenId, "learn_learning_unit_contract_created", {
      jobId: job.id,
      councilRunId: topicMapCall.councilRunId,
      learningMapId: storedMap.id,
      unitCount: learningUnits.length,
      assignmentCount: sourceArtifactAssignments.length,
    });
    appendLearnEvent(contentPath, gardenId, "learn_learning_map_created", {
      jobId: job.id,
      councilRunId: topicMapCall.councilRunId,
      learningMapId: storedMap.id,
      sourceIds: context.sources.map((source) => source.slug),
    });
    appendLearnEvent(
      contentPath,
      gardenId,
      retainLeaseOnSuccess
        ? "learn_automatic_generation_handoff_ready"
        : "learn_awaiting_confirmation",
      {
      jobId: job.id,
      learningMapId: storedMap.id,
      },
    );
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn planning lost its garden lease before awaiting confirmation.",
      );
    }
    const nextJob = updateLearnJobExpectStatus(job.id, {
      status: retainLeaseOnSuccess ? "building_navigation" : "awaiting_confirmation",
      currentStep: retainLeaseOnSuccess
        ? "Planning complete; continuing to lesson generation"
        : "Awaiting section order confirmation",
      progressPercent: retainLeaseOnSuccess ? 55 : 100,
      proposedLearningMapId: storedMap.id,
      sourceSetHash: context.sourceSetHash,
    });
    leaseTransferred = retainLeaseOnSuccess;
    return {
      job: nextJob,
      learningMap: storedMap,
      retainedLease: retainLeaseOnSuccess ? lease : undefined,
    };
  } catch (error) {
    const stillOwnPlanningLease = (): boolean => {
      return confirmLearnLeaseForFailureCleanup(lease, job.id);
    };
    if (!stillOwnPlanningLease()) {
      // A fenced recovery/takeover now owns cleanup. The stale worker must not
      // touch either the repository or SQLite after losing that authority.
      throw error;
    }
    if (isLearnCancellation(job.id, error)) {
      // The Stop button already flipped the job to cancelled; remove anything
      // planning managed to write before the cancellation checkpoint fired.
      try {
        const cleanup = await cleanupLearnArtifactsAfterCancel({
          gardenId,
          contentPath,
          jobId: job.id,
          lease,
        });
        updateLearnJob(job.id, {
          status: "cancelled",
          currentStep: "Cancelled; latest Learn changes rolled back",
        });
        discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
        removeRejectedAttemptAuditsAfterTerminalLifecycle(contentPath, gardenId);
        appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
          jobId: job.id,
          removedPathCount: cleanup.removedPaths.length,
          restoredPathCount: cleanup.restoredPaths.length,
          deletedMaps: cleanup.deletedMaps,
          deletedVersions: cleanup.deletedVersions,
        });
      } catch {
        // Cleanup is best-effort during unwind; the cancel endpoint reports its
        // own cleanup errors when the user presses Stop.
      }
      throw error;
    }
    return rethrowAfterBestEffortLearnFailureCleanup(error, async () => {
      const message = errorMessage(error, "Learn planning failed");
      let lastInternalStep = "";
      try {
        const failedJob = getLatestLearnJob(gardenId);
        lastInternalStep = failedJob?.id === job.id
          ? failedJob.currentStep.trim()
          : "";
      } catch {
        // Reading diagnostic context must not prevent rollback.
      }

      let planningRolledBack = false;
      let rollback: Awaited<ReturnType<typeof rollbackLearnRun>> | undefined;
      try {
        rollback = await rollbackLearnRun({
          gardenId,
          contentPath,
          jobId: job.id,
          lease,
        });
        planningRolledBack = true;
      } catch (rollbackError) {
        if (!stillOwnPlanningLease()) return;
        try {
          appendLearnEvent(contentPath, gardenId, "learn_planning_rollback_failed", {
            jobId: job.id,
            error: errorMessage(rollbackError, "Planning rollback failed"),
          });
        } catch {
          // Rollback diagnostics are best-effort.
        }
      }

      if (!stillOwnPlanningLease()) return;
      if (rollback) {
        try {
          appendLearnEvent(contentPath, gardenId, "learn_planning_rolled_back", {
            jobId: job.id,
            removedPathCount: rollback.removedPaths.length,
            restoredPathCount: rollback.restoredPaths.length,
            deletedMaps: rollback.deletedMaps,
            deletedVersions: rollback.deletedVersions,
          });
        } catch {
          // Rollback diagnostics are best-effort.
        }
        let publicationToken: string | undefined;
        try {
          publicationToken = queueLearnPublicationRetry(
            gardenId,
            "failed Learn planning rollback",
            new Error("Publication pending"),
          );
        } catch {
          // The authoritative planning failure must still escape unchanged.
        }
        if (publicationToken) {
          try {
            void publishQuartzAfterMutation(
              `failed Learn planning rollback in ${gardenId}`,
              { requireSuccess: true, gardenSlug: gardenId },
            )
              .then(() => {
                try {
                  clearLearnPublicationRetry(gardenId, publicationToken);
                } catch {
                  // Retry bookkeeping is best-effort during failure unwind.
                }
              })
              .catch((publicationError) => {
                try {
                  queueLearnPublicationRetry(
                    gardenId,
                    "failed Learn planning rollback",
                    publicationError,
                  );
                } catch {
                  // Retry bookkeeping is best-effort during failure unwind.
                }
              });
          } catch {
            // Publication scheduling is subordinate to the original failure.
          }
        }
      }

      if (!stillOwnPlanningLease()) return;
      try {
        appendLearnEvent(contentPath, gardenId, "learn_failed", {
          jobId: job.id,
          error: message,
        });
      } catch {
        // Failure telemetry is best-effort.
      }
      try {
        updateLearnJob(job.id, {
          status: "failed",
          currentStep: lastInternalStep
            ? `Planning failed; last internal step: ${lastInternalStep}`
            : "Planning failed",
          error: message,
        });
      } catch {
        // Terminal persistence cannot replace the authoritative model error.
      }
      if (planningRolledBack) {
        try {
          discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
        } catch {
          // Snapshot cleanup is best-effort after a successful rollback.
        }
      }
    });
  } finally {
    activeLearnCouncilDispatchAuthorities.delete(job.id);
    try {
      disposeModelTracking();
    } catch {
      // Model tracking is observational and cannot replace workflow outcomes.
    }
    if (!leaseTransferred) {
      try {
        lease.release();
      } catch {
        // Lease cleanup cannot replace an authoritative provider failure.
      }
    }
  }
}

export function confirmLearningMap({
  gardenId,
  learningMapId,
  expectedModel,
  contentPath,
  gardenLease,
  requireProposed = false,
}: {
  gardenId: string;
  learningMapId: string;
  expectedModel: string;
  contentPath: string;
  /** Internal automatic handoff; external confirmation acquires its own lease. */
  gardenLease?: GardenLearnLease;
  /** Interactive requests must consume a proposal exactly once. */
  requireProposed?: boolean;
}): StoredLearningMap {
  ensureLearnTables();
  assertNoPendingLearnClear(gardenId);
  const requestedLearningMapId = learningMapId.trim();
  if (!requestedLearningMapId) {
    throw new LearnPipelineConflictError(
      "Confirming Learn requires the exact proposed Learning Map ID.",
    );
  }
  const requestedExpectedModel =
    typeof expectedModel === "string" ? expectedModel.trim() : "";
  if (!requestedExpectedModel) {
    throw new LearnPipelineConflictError(
      "Confirming Learn requires the exact model that authored the proposed Learning Map.",
    );
  }
  const gardenDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(gardenDir, { recursive: true });
  let lease = gardenLease;
  let ownsLease = false;
  if (lease) {
    if (lease.lost || !lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn lost its retained garden lease before map confirmation.",
      );
    }
  } else {
    const confirmationId = makeId("learn_confirm");
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: gardenId,
      jobId: confirmationId,
      buildId: `confirm:${confirmationId}`,
    });
    if (!leaseResult.acquired) {
      throw new LearnPipelineConflictError(
        `Another Learn operation (${leaseResult.conflict.jobId}) is changing this garden; confirmation was not applied.`,
      );
    }
    lease = leaseResult.lease;
    ownsLease = true;
  }
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn lost its garden lease before map confirmation.",
      );
    }
    const confirmTransaction = db.transaction(() => {
      const map = getLearnMapById(requestedLearningMapId, gardenId);
      if (!map) {
        throw new LearnPipelineConflictError(
          "The requested Learning Map does not belong to this garden or no longer exists.",
        );
      }
      assertNoUnresolvedLearnJob(gardenId, map.jobId);
      if (!isContractBackedLearningMap(map)) {
        throw new Error(
          "This learning map was created before Learning Unit Contracts existed. Run Learn again to draft a new source-grounded map.",
        );
      }
      const alreadyConfirmed = map.status === "confirmed";
      if (alreadyConfirmed && requireProposed) {
        throw new LearnPipelineConflictError(
          "The requested Learning Map is no longer awaiting confirmation. Refresh before confirming the current proposal.",
        );
      }
      if (!alreadyConfirmed && map.status !== "proposed") {
        throw new LearnPipelineConflictError(
          `Learning Map ${map.id} is ${map.status} and cannot be confirmed.`,
        );
      }
      const confirmationContext = collectLearnSourceContext(
        contentPath,
        gardenId,
        map.sourceIds.length > 0 ? map.sourceIds : undefined,
        map.syllabusSourceId,
      );
      if (
        confirmationContext.sourceSetHash !== map.sourceSetHash ||
        confirmationContext.sourceArtifactInventoryHash !==
          map.sourceArtifactInventoryHash
      ) {
        throw new LearnPipelineConflictError(
          "The selected sources or their artifact inventory changed after this Learning Map was authored. Run Learn planning again before confirmation.",
        );
      }
      assertSyllabusCoverageRecoveryBinding({
        context: confirmationContext,
        coveragePlan: map.coveragePlan,
        syllabusCoverage: map.syllabusCoverage,
        stage: "Map confirmation",
      });
      const confirmationLearningUnits = learningUnitsFromCoveragePlan(map.coveragePlan);
      let confirmationCanonicalEvidence: ReturnType<typeof canonicalVisualizationEvidenceByUnit>;
      try {
        confirmationCanonicalEvidence = canonicalVisualizationEvidenceByUnit(
          clusterPath(contentPath, gardenId),
          confirmationLearningUnits,
        );
      } catch (error) {
        throw new LearnPipelineConflictError(
          `The proposed Learning Map cannot prove its canonical visual evidence: ${errorMessage(error)}. Run Learn planning again before confirmation.`,
          { requiresReplan: true },
        );
      }
      const confirmedVisualRouteProblems = confirmedVisualRouteBundleProblems({
        gardenId,
        map,
        context: confirmationContext,
        learningUnits: confirmationLearningUnits,
        canonicalEvidenceByUnit: confirmationCanonicalEvidence,
      });
      if (confirmedVisualRouteProblems.length > 0) {
        throw new LearnPipelineConflictError(
          `The proposed Learning Map has no valid confirmed visual route bundle: ${confirmedVisualRouteProblems.join("; ")}. Run Learn planning again before confirmation.`,
          { requiresReplan: true },
        );
      }
      if (alreadyConfirmed) return { map, jobId: map.jobId, changed: false };
      const planningJob = getLearnJobById(map.jobId);
      if (
        !planningJob ||
        planningJob.gardenId !== gardenId ||
        planningJob.proposedLearningMapId !== map.id ||
        (planningJob.status !== "awaiting_confirmation" &&
          planningJob.status !== "building_navigation")
      ) {
        throw new LearnPipelineConflictError(
          "The proposed Learning Map is no longer the active planning result.",
        );
      }
      if (planningJob.model !== requestedExpectedModel) {
        throw new LearnPipelineConflictError(
          "The model bound to this Learning Map changed before confirmation. Restore the previously selected model, or run Learn planning again with the current selection.",
        );
      }
      const confirmedAt = nowIso();
      const mapUpdate = db.prepare(
        `UPDATE learn_maps
         SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND garden_id = ? AND status = 'proposed'
           AND source_set_hash = ? AND source_artifact_inventory_hash = ?`,
      ).run(
        confirmedAt,
        map.id,
        gardenId,
        map.sourceSetHash,
        map.sourceArtifactInventoryHash,
      );
      if (mapUpdate.changes !== 1) {
        throw new LearnPipelineConflictError(
          "The Learning Map changed before confirmation could commit.",
        );
      }
      const updatedJob = updateLearnJob(planningJob.id, {
        confirmedLearningMapId: map.id,
        currentStep: "Learning map confirmed",
      });
      if (
        updatedJob.status === "cancelled" ||
        updatedJob.status === "failed" ||
        updatedJob.status === "complete"
      ) {
        throw new LearnPipelineConflictError(
          `The planning job became ${updatedJob.status} before confirmation committed.`,
        );
      }
      return {
        map: getLearnMapById(map.id, gardenId)!,
        jobId: planningJob.id,
        changed: true,
      };
    });
    const confirmed = confirmTransaction.immediate();
    if (confirmed.changed) {
      appendLearnEvent(contentPath, gardenId, "learn_learning_map_confirmed", {
        jobId: confirmed.jobId,
        learningMapId: confirmed.map.id,
      });
    }
    return confirmed.map;
  } finally {
    if (ownsLease) lease.release();
  }
}

function renderObjectMarkdown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return `\`\`\`json\n${JSON.stringify(value ?? {}, null, 2)}\n\`\`\``;
}

// Learner-visible planning pages: the learning/ index, Topic Overview, and
// Learning Map. Everything else (Source Map, Scope Contract, Source Coverage)
// is internal. No planning page carries public tags — tags are reserved for
// learner lessons.
const VISIBLE_PLANNING_TYPES = new Set([
  "learning-index",
  "topic-overview",
  "learning-map",
]);

function learningPageFrontmatter(
  title: string,
  type: string,
  gardenId: string,
  learningVersionId: string,
  sourceSetHash: string,
): string {
  const visibleVersionId = publicLearningVersionId(learningVersionId);
  return yamlFrontmatter({
    title,
    date: nowIso(),
    knowledge_type: type,
    breadboardType: type.replace(/-/g, "_"),
    gardenId,
    internal: VISIBLE_PLANNING_TYPES.has(type) ? undefined : "true",
    generatedBy: "learn_button",
    generated_by: "learn_button",
    learningVersion: visibleVersionId,
    learningVersionId: visibleVersionId,
    sourceSetHash,
  });
}

// All learner-facing lesson sections live under this folder so the garden root
// only ever shows learning/, assets/, and the garden _index.
const LEARNING_ROOT = "learning";

/** Section folder for a lesson section, nested under learning/. */
function learningSectionFolder(sectionNumber: number, title: string): string {
  return `${LEARNING_ROOT}/${textbookSectionFolder(sectionNumber, title)}`;
}

/**
 * Collapse layout whitespace for exact source-expression verification. No
 * LaTeX command, symbol, variable, or notation is rewritten or inferred.
 */
function normalizedFormulaForFrontmatter(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedSourceQuestionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formulaGroundingEntries(
  contracts: readonly NonNullable<LearningSubsectionPlan["sourceFormulaContracts"]>[number][],
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>,
): FormulaGroundingEntry[] {
  return contracts.map((contract) => {
    const anchor = canonicalSourceAnchors[contract.id];
    const exactText = anchor?.kind === "formula" ? anchor.exactText?.trim() : "";
    if (!exactText) {
      throw new Error(
        `Formula projection failed: model-authored formula ${contract.id} has no verbatim canonical equation transcription.`,
      );
    }
    return {
      kind: "source_definition",
      text: exactText,
      normalizedText: normalizedFormulaForFrontmatter(exactText),
      groundingStatus: "source-anchored",
      sourceAnchor: contract.id,
      sourceAnchorTitle: anchor?.caption ?? anchor?.title ?? contract.id,
      matchReason: "exact model-authored sourceFormula contract projection",
      confidence: 1,
      justification: `The model-authored Learning Unit Contract assigns canonical source formula ${contract.id} to this page.`,
    };
  });
}

function assessModelAuthoredLessonQuality(
  body: string,
  options: {
    assignedVisualUrls: string[];
    assignedVisualRequirements: Array<{
      sourceVisualId: string;
      url: string;
      interpretationGoal: string;
    }>;
    unavailableCitations?: { detect: (prose: string) => string[] };
    subsection: LearningSubsectionPlan;
    canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>;
    requiredSourceQuestions: PageDossier["requiredSourceQuestions"];
  },
): ReturnType<typeof assessLessonQuality> {
  const base = assessLessonQuality(body, {
    assignedVisualUrls: options.assignedVisualUrls,
    unavailableCitations: options.unavailableCitations,
  });
  const figureProblems: QualityProblem[] = figurePlacementProblems(body, {
    maxFiguresPerPage: Math.max(3, options.assignedVisualRequirements.length),
    requiredInterpretations: options.assignedVisualRequirements,
  }).map((message) => ({
    code: message.includes("interpretation goal")
      ? "source-figure-interpretation"
      : "source-figure-placement",
    message,
    hard: true,
  }));
  const pageFormulas = new Set(
    extractVerbatimDisplayMath(body)
      .map((expression) => normalizedFormulaForFrontmatter(expression.formula))
      .filter(Boolean),
  );
  const formulaProblems: QualityProblem[] = (options.subsection.sourceFormulaContracts ?? [])
    .filter((formula) => {
      const anchor = options.canonicalSourceAnchors[formula.id];
      const exactText = anchor?.kind === "formula" ? anchor.exactText?.trim() : "";
      return !exactText || !pageFormulas.has(normalizedFormulaForFrontmatter(exactText));
    })
    .map((formula) => ({
      code: "missing-source-formula",
      message: `required source formula ${formula.id} has no verbatim matching displayed equation in the lesson; a non-identical variant may be present`,
      hard: true,
      evidence: [
        options.canonicalSourceAnchors[formula.id]?.exactText ?? "canonical equation transcription unavailable",
        formula.teachingGoal,
        ...(formula.termsToDefine ?? []),
      ].filter(Boolean),
    }));
  const normalizedBody = normalizedSourceQuestionText(body);
  const questionProblems: QualityProblem[] = options.requiredSourceQuestions
    .filter((question) => !normalizedBody.includes(normalizedSourceQuestionText(question.prompt)))
    .map((question) => ({
      code: "missing-source-question",
      message: `required source question ${question.id} is not reproduced verbatim in the lesson`,
      hard: true,
      evidence: [question.label, question.prompt, question.teachingGoal],
    }));
  const problems = [...base.problems, ...figureProblems, ...formulaProblems, ...questionProblems];
  return {
    ok: problems.length === 0,
    hardFail: problems.some((problem) => problem.hard),
    problems,
  };
}

function sourceFormulaFiguresForSubsection(
  context: LearnSourceContext,
  subsection: LearningSubsectionPlan,
): SourceFigure[] {
  // A page may only claim source-formula anchors selected for its own stable
  // learning unit. Supplying every extracted equation here allowed a helper
  // expression (for example spike count inside an energy derivation) to be
  // grounded to another unit's formula and then rejected by the pre-write
  // family guard. Pages without a formula contract get no source-formula
  // candidates; their math remains honestly conceptual unless reconciled later.
  const selectedIds = new Set((subsection.sourceFormulaContracts ?? []).map((formula) => formula.id));
  return sourceFormulaFigures(context).filter((formula) => selectedIds.has(formula.figureId));
}

function renderLearningMapMarkdown(map: ProposedLearningMap): string {
  const lines: string[] = [
    "# Learning Map",
    "",
    map.summary,
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = section.title;
    lines.push(`## ${sectionNumber}. ${sectionTitle}`, "", section.purpose, "");
    section.subsections.forEach((subsection, subsectionIndex) => {
      const subsectionTitle = subsection.title;
      const relPath = `${learningSectionFolder(sectionNumber, sectionTitle)}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsectionTitle,
      )}`;
      lines.push(`- ${sectionNumber}.${subsectionIndex + 1} ${wikilinkForRelPath(relPath, subsectionTitle)}`);
    });
    lines.push("");
  });
  if (map.warnings.length > 0) {
    lines.push("## Scope Notes", "", ...map.warnings.map((warning) => `- ${warning}`), "");
  }
  return `${lines.join("\n")}\n`;
}

function renderLearningIndexMarkdown(map: ProposedLearningMap): string {
  const lines = [
    `# ${map.title}`,
    "",
    map.summary,
    "",
    "## Sections",
    "",
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = section.title;
    const folder = learningSectionFolder(sectionNumber, sectionTitle);
    lines.push(`- ${wikilinkForRelPath(`${folder}/_index.md`, `${sectionNumber}. ${sectionTitle}`)}`);
    section.subsections.forEach((subsection, subsectionIndex) => {
      const relPath = `${folder}/${textbookPageFileName(
        sectionNumber,
        subsectionIndex + 1,
        subsection.title,
      )}`;
      lines.push(
        `  - ${wikilinkForRelPath(relPath, `${sectionNumber}.${subsectionIndex + 1} ${subsection.title}`)}`,
      );
    });
  });
  return `${lines.join("\n")}\n`;
}

function validateTopicOverview(
  markdown: string,
  map: ProposedLearningMap,
): { markdown: string; problems: string[] } {
  const problems: string[] = [];
  const generalQuality = assessLessonQuality(markdown, { minWords: 250 });
  for (const problem of generalQuality.problems) {
    if (problem.code === "no-qa" || problem.code === "no-example") continue;
    problems.push(formatQualityProblemForRepair(problem));
  }
  if (/```breadboard-visual/i.test(markdown) || containsRawVisualPlaceholder(markdown)) {
    problems.push("overview contains an interactive-visual block or placeholder");
  }
  for (const section of map.sections) {
    if (!markdown.toLocaleLowerCase().includes(section.title.toLocaleLowerCase())) {
      problems.push(`overview reading order omits section "${section.title}"`);
    }
  }
  const canonicalized = canonicalizeLearnerWikilinks(markdown, map);
  if (canonicalized.unresolved.length > 0) {
    problems.push(`overview contains unresolved wikilinks: ${canonicalized.unresolved.join(", ")}`);
  }
  return { markdown: canonicalized.markdown, problems: [...new Set(problems)] };
}

function sourceMapMarkdown(sourceMap: unknown, context: LearnSourceContext): string {
  return [
    "# Source Map",
    "",
    "## Relevant Sources Found",
    "",
    ...context.sources.map((source) => `- ${wikilinkForRelPath(source.relPath, source.title)} - ${source.sourceType || "source"}, ${source.wordCount ?? 0} words`),
    "",
    "## Source Figures, Graphs, Tables, And Formula Displays",
    "",
    ...(context.sourceFigures.length > 0
      ? context.sourceFigures.map(
          (figure) =>
            `- ${figure.figureId}: ${figure.caption ?? figure.kind} (${figure.kind})${figure.page ? `, page ${figure.page}` : ""}`,
        )
      : ["- No source figures were detected from markdown snapshots."]),
    "",
    "## Council Source Map",
    "",
    renderObjectMarkdown(sourceMap),
    "",
  ].join("\n");
}

function scopeContractMarkdown(scopeContract: unknown): string {
  return ["# Scope Contract", "", renderObjectMarkdown(scopeContract), ""].join("\n");
}

function sourceFormulaFigures(context: LearnSourceContext): SourceFigure[] {
  return context.sourceFigures.filter(
    (figure) => figure.kind === "formula" || /\.E\d+$/i.test(figure.figureId),
  );
}

function sourceCoverageMarkdown({
  context,
  generatedPages,
  unusedFigureReasons,
  sourceArtifactAssignments = [],
}: {
  context: LearnSourceContext;
  generatedPages: GeneratedPageRecord[];
  unusedFigureReasons: Map<string, string>;
  sourceArtifactAssignments?: SourceArtifactAssignment[];
}): string {
  const pageByUnit = new Map(
    generatedPages
      .filter((page) => page.learningUnitId)
      .map((page) => [page.learningUnitId as string, page]),
  );
  const assignedIds = new Set(sourceArtifactAssignments.map((assignment) => assignment.sourceArtifactId));
  const usedFigures = new Set(generatedPages.flatMap((page) => page.sourceFigureIds));
  const usedFormulas = new Set(generatedPages.flatMap((page) => page.sourceFormulaIds));
  const usedTables = new Set(generatedPages.flatMap((page) => page.sourceTableIds));
  const allFulfilledIds = new Set([...usedFigures, ...usedFormulas, ...usedTables]);
  const formulaFigures = sourceFormulaFigures(context);
  const assignmentByArtifact = new Map<string, SourceArtifactAssignment[]>();
  for (const assignment of sourceArtifactAssignments) {
    const list = assignmentByArtifact.get(assignment.sourceArtifactId) ?? [];
    list.push(assignment);
    assignmentByArtifact.set(assignment.sourceArtifactId, list);
  }
  const statusForAssignment = (assignment: SourceArtifactAssignment): string => {
    const page = pageByUnit.get(assignment.assignedLearningUnitId);
    if (!page) return "missing: assigned unit has no generated page";
    if (allFulfilledIds.has(assignment.sourceArtifactId)) return "fulfilled";
    return "missing: assigned artifact not present in final page metadata";
  };
  const sourceArtifactKind = (id: string): "formula" | "table" | "figure" => {
    if (/\.E\d+$/i.test(id)) return "formula";
    if (/\.T\d+$/i.test(id)) return "table";
    return "figure";
  };
  const coverageModes = new Map<string, string[]>([
    ["Embedded Source Crops", []],
    ["Explained as Text Formulas", []],
    ["Explained in Prose", []],
    ["Used as Interactive Grounding", []],
    ["Referenced Again in Synthesis", []],
    ["Crop Omitted With Text Fallback", []],
    ["Intentionally Omitted", []],
    ["Missing or Misplaced", []],
  ]);
  const addMode = (mode: string, line: string) => {
    coverageModes.get(mode)?.push(line);
  };
  const authoredOmissionReason = (artifactId: string): string => {
    const reason = unusedFigureReasons.get(artifactId)?.trim();
    if (!reason) {
      throw new Error(
        `Source coverage cannot project ${artifactId}: its model-authored omission reason is missing.`,
      );
    }
    return reason;
  };
  for (const assignment of sourceArtifactAssignments) {
    const page = pageByUnit.get(assignment.assignedLearningUnitId);
    const target = page ? wikilinkForRelPath(page.relPath, page.title) : `unit ${assignment.assignedLearningUnitId}`;
    const kind = sourceArtifactKind(assignment.sourceArtifactId);
    const line = `- ${assignment.sourceArtifactId}: ${target}; placement=${assignment.placement}; ${assignment.requiredInterpretation || assignment.reason}`;
    if (!page || !allFulfilledIds.has(assignment.sourceArtifactId)) {
      addMode("Missing or Misplaced", line);
    } else if (kind === "formula") {
      addMode("Explained as Text Formulas", line);
      addMode("Crop Omitted With Text Fallback", line);
    } else if (usedFigures.has(assignment.sourceArtifactId) || usedTables.has(assignment.sourceArtifactId)) {
      addMode("Embedded Source Crops", line);
    } else {
      addMode("Explained in Prose", line);
    }
  }
  for (const page of generatedPages) {
    if (page.visualIds.length === 0) continue;
    const anchors = [...page.sourceFigureIds, ...page.sourceFormulaIds, ...page.sourceTableIds];
    for (const id of anchors) {
      addMode("Used as Interactive Grounding", `- ${id}: ${wikilinkForRelPath(page.relPath, page.title)}; interactive visualIds=${page.visualIds.join(", ")}`);
    }
  }
  for (const page of generatedPages.filter((page) => /synthesis/i.test(page.title))) {
    const anchors = [...page.sourceFigureIds, ...page.sourceFormulaIds, ...page.sourceTableIds];
    for (const id of anchors) {
      addMode("Referenced Again in Synthesis", `- ${id}: ${wikilinkForRelPath(page.relPath, page.title)}`);
    }
  }
  for (const figure of context.sourceFigures.filter((figure) => !allFulfilledIds.has(figure.figureId) && !assignedIds.has(figure.figureId))) {
    addMode("Intentionally Omitted", `- ${figure.figureId}: ${authoredOmissionReason(figure.figureId)}`);
  }
  const lines = [
    "# Source Coverage",
    "",
    "Coverage is derived from the Learning Unit Contract artifact assignments and final page fulfillment only. It does not use title or keyword heuristics.",
    "",
    "## Sources Used",
    "",
    ...context.sources.map((source) => `- ${source.title} (${source.slug})`),
    "",
    "## Generated Pages By Source Anchor",
    "",
  ];
  for (const page of generatedPages) {
    lines.push(`- ${wikilinkForRelPath(page.relPath, page.title)}: ${page.sourceAnchors.join("; ") || "general source context"}`);
  }
  lines.push("", "## Contract Artifact Fulfillment", "");
  if (sourceArtifactAssignments.length > 0) {
    for (const assignment of sourceArtifactAssignments) {
      const page = pageByUnit.get(assignment.assignedLearningUnitId);
      lines.push(
        `- ${assignment.sourceArtifactId}: assigned to ${assignment.assignedLearningUnitId}${page ? ` (${wikilinkForRelPath(page.relPath, page.title)})` : ""}; ${statusForAssignment(assignment)}; placement=${assignment.placement}; ${assignment.requiredInterpretation || assignment.reason}`,
      );
    }
  } else {
    lines.push("- No source artifacts were assigned by the Learning Unit Contract.");
  }
  for (const [mode, entries] of coverageModes) {
    lines.push("", `## ${mode}`, "");
    lines.push(...(entries.length > 0 ? [...new Set(entries)] : ["- None."]));
  }
  if (formulaFigures.length > 0) {
    lines.push("", "## Formula Anchor Assignments", "");
    for (const formula of formulaFigures) {
      const assignments = assignmentByArtifact.get(formula.figureId) ?? [];
      if (assignments.length === 0) {
        lines.push(`- ${formula.figureId}: omitted; ${authoredOmissionReason(formula.figureId)}`);
        continue;
      }
      for (const assignment of assignments) {
        const page = pageByUnit.get(assignment.assignedLearningUnitId);
        lines.push(
          `- ${formula.figureId}: assigned to ${assignment.assignedLearningUnitId}${page ? ` (${wikilinkForRelPath(page.relPath, page.title)})` : ""}; ${statusForAssignment(assignment)}`,
        );
      }
    }
  }
  lines.push("", "## Figures Not Used", "");
  lines.push(
    ...(context.sourceFigures.filter((figure) => !allFulfilledIds.has(figure.figureId)).length > 0
      ? context.sourceFigures
          .filter((figure) => !allFulfilledIds.has(figure.figureId))
          .map(
            (figure) =>
              `- ${figure.figureId}: ${
                assignedIds.has(figure.figureId)
                  ? "assigned by the Learning Unit Contract but not fulfilled in final page metadata"
                  : authoredOmissionReason(figure.figureId)
              }`,
          )
      : ["- None."]),
  );
  lines.push("", "## Notes", "");
  lines.push("- Formula, example, and question coverage is tracked through source anchors on the generated learning pages.");
  return `${lines.join("\n")}\n`;
}

function clusterPath(contentPath: string, gardenId: string): string {
  return path.join(contentPath, gardenId);
}

export function getLearnValidationReport({
  gardenId,
  contentPath,
  maxChars = 30_000,
}: {
  gardenId: string;
  contentPath: string;
  maxChars?: number;
}): LearnValidationReport | null {
  const reportRelPath = ".breadboard/validation-report.md";
  const reportPath = path.join(clusterPath(contentPath, gardenId), reportRelPath);
  let markdown: string;
  try {
    markdown = fs.readFileSync(reportPath, "utf-8");
  } catch {
    return null;
  }
  const generatedAt = markdown.match(/^Generated:\s*(.+)$/m)?.[1]?.trim();
  const acceptedRaw = markdown.match(/^Accepted:\s*(yes|no)$/m)?.[1]?.trim().toLowerCase();
  const truncated = markdown.length > maxChars;
  return {
    relativePath: reportRelPath,
    url: `/api/gardens/${encodeURIComponent(gardenId)}/learn/validation-report`,
    markdown: truncated ? `${markdown.slice(0, maxChars).replace(/\s+$/, "")}\n\n[report truncated in dialog]` : markdown,
    truncated,
    ...(acceptedRaw ? { accepted: acceptedRaw === "yes" } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  };
}

function assertInsideCluster(clusterDir: string, filePath: string): void {
  const resolvedCluster = path.resolve(clusterDir);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile !== resolvedCluster && !resolvedFile.startsWith(`${resolvedCluster}${path.sep}`)) {
    throw new Error("Refusing to write outside the garden directory");
  }
}

function backupExistingMarkdown({
  clusterDir,
  filePath,
  textbookVersionId,
}: {
  clusterDir: string;
  filePath: string;
  textbookVersionId: string;
}): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  assertInsideCluster(clusterDir, filePath);
  const relPath = path.relative(clusterDir, filePath);
  const backupPath = path.join(clusterDir, ".breadboard", "backups", textbookVersionId, relPath);
  assertInsideCluster(clusterDir, backupPath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
  return path.relative(clusterDir, backupPath).replace(/\\/g, "/");
}

function writeMarkdownWithBackup({
  clusterDir,
  relPath,
  content,
  textbookVersionId,
}: {
  clusterDir: string;
  relPath: string;
  content: string;
  textbookVersionId: string;
}): { filePath: string; backedUpTo?: string } {
  const filePath = path.join(clusterDir, ...relPath.split("/"));
  assertInsideCluster(clusterDir, filePath);
  const backedUpTo = backupExistingMarkdown({ clusterDir, filePath, textbookVersionId });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalizeQuartzMarkdown(content), "utf-8");
  return { filePath, backedUpTo };
}

interface LearnCleanupResult {
  removedPaths: string[];
  restoredPaths: string[];
  prunedVisualIds: string[];
  deletedMaps: number;
  deletedVersions: number;
}

interface LearnRunSnapshotManifest {
  schemaVersion: 1;
  gardenId: string;
  jobId: string;
  createdAt: string;
  inheritedFromJobId?: string;
  capturedPaths?: string[];
  backupEntries?: string[];
  learnMaps?: LearnMapRow[];
  learnVersions?: LearnVersionRow[];
}

const LEARN_RUN_SNAPSHOT_ROOT = ".breadboard/learn-run-snapshots";
const LEARN_RUN_ROLLBACK_PATHS = [
  LEARNING_ROOT,
  "Learning",
  "assets/source-visuals",
  ".breadboard/Internal",
  ".breadboard/debug/failed-pages",
  ".breadboard/debug/failed-repairs",
  ".breadboard/planning",
  ".breadboard/source-snapshots",
  ".breadboard/visuals",
  ".breadboard/learning-unit-contract.json",
  ".breadboard/concept-registry.json",
  ".breadboard/claims.json",
  ".breadboard/claims-history.json",
  ".breadboard/concept-registry-history.json",
  ".breadboard/semantic-migration.json",
  ".breadboard/source-visuals.json",
  ".breadboard/source-visual-source-index.json",
  ".breadboard/source-formula-reviews",
  ".breadboard/source-formula-review-set.json",
  ".breadboard/source-normalization-receipt.json",
  ".breadboard/visual-index.json",
  ".breadboard/visual-contract-executability-reviews.json",
  ".breadboard/visual-decision-records.json",
  ".breadboard/visual-necessity-decisions.json",
  ".breadboard/visual-necessity-decisions.md",
  ".breadboard/visualization-plan.json",
  ".breadboard/visualization-coverage.json",
  ".breadboard/visualization-report.md",
  ".breadboard/source-anchors.json",
  ".breadboard/repair-log.json",
  ".breadboard/repair-report.md",
  ".breadboard/validation-report.md",
  ".breadboard/weak-anchor-self-healing.json",
  ".breadboard/weak-anchor-self-healing.md",
  ".breadboard/source-anchor-evidence.json",
  ".breadboard/source-anchor-evidence.md",
  ".breadboard/source-anchor-migration.json",
  ".breadboard/source-anchor-migration.md",
  ".breadboard/anchor-replacement-plan.json",
  ".breadboard/anchor-replacement-plan.md",
  ".breadboard/critic-issues.json",
  ".breadboard/critic-loop.json",
  ".breadboard/critic-report.md",
  ".breadboard/anchor-critic-decisions.json",
] as const;

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function clusterRelativePath(clusterDir: string, relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const result = path.join(clusterDir, ...normalized.split("/"));
  assertInsideCluster(clusterDir, result);
  return result;
}

function learnRunSnapshotDir(clusterDir: string, jobId: string): string {
  return clusterRelativePath(clusterDir, `${LEARN_RUN_SNAPSHOT_ROOT}/${jobId}`);
}

function readLearnRunSnapshot(clusterDir: string, jobId: string): LearnRunSnapshotManifest | null {
  const manifestPath = path.join(learnRunSnapshotDir(clusterDir, jobId), "manifest.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as LearnRunSnapshotManifest;
    return parsed.schemaVersion === 1 && parsed.jobId === jobId ? parsed : null;
  } catch {
    return null;
  }
}

function resolveLearnRunSnapshot(
  clusterDir: string,
  jobId: string,
): { jobId: string; manifest: LearnRunSnapshotManifest } | null {
  const visited = new Set<string>();
  let currentJobId = jobId;
  while (!visited.has(currentJobId)) {
    visited.add(currentJobId);
    const manifest = readLearnRunSnapshot(clusterDir, currentJobId);
    if (!manifest) return null;
    if (!manifest.inheritedFromJobId) return { jobId: currentJobId, manifest };
    currentJobId = manifest.inheritedFromJobId;
  }
  return null;
}

function generationRollbackInheritanceJobId({
  mapAtEntry,
  confirmsProposedMap,
}: {
  mapAtEntry: Pick<StoredLearningMap, "jobId" | "status"> | null;
  confirmsProposedMap: boolean;
}): string | undefined {
  // A map that was already confirmed when generation started is an input to
  // this run, even when its original planning snapshot still exists. Inheriting
  // that older snapshot would cross the generation ownership boundary and
  // delete/replace the confirmed input on Stop. Only a proposal promoted by
  // this generation belongs to the transient planning+generation workflow.
  return confirmsProposedMap && mapAtEntry?.status === "proposed"
    ? mapAtEntry.jobId
    : undefined;
}

function copySnapshotPath(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function createLearnRunSnapshot({
  gardenId,
  contentPath,
  jobId,
  inheritFromJobId,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
  inheritFromJobId?: string;
}): void {
  ensureLearnTables();
  const clusterDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(clusterDir, { recursive: true });
  const snapshotDir = learnRunSnapshotDir(clusterDir, jobId);
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.mkdirSync(snapshotDir, { recursive: true });

  const inherited = inheritFromJobId
    ? resolveLearnRunSnapshot(clusterDir, inheritFromJobId)
    : null;
  if (inherited) {
    const manifest: LearnRunSnapshotManifest = {
      schemaVersion: 1,
      gardenId,
      jobId,
      createdAt: nowIso(),
      inheritedFromJobId: inherited.jobId,
    };
    fs.writeFileSync(
      path.join(snapshotDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
    return;
  }

  // Only Learn-owned projections are rollback material. Capturing arbitrary
  // Markdown here used to let Stop overwrite source/user notes edited after a
  // plan began.
  const snapshotCandidates = [...LEARN_RUN_ROLLBACK_PATHS];
  const capturedPaths = Array.from(new Set(snapshotCandidates)).filter((relPath) => {
    const source = clusterRelativePath(clusterDir, relPath);
    if (!fs.existsSync(source)) return false;
    copySnapshotPath(source, path.join(snapshotDir, "files", ...relPath.split("/")));
    return true;
  });
  const backupsRoot = clusterRelativePath(clusterDir, ".breadboard/backups");
  const backupEntries = fs.existsSync(backupsRoot)
    ? fs.readdirSync(backupsRoot).sort()
    : [];
  const manifest: LearnRunSnapshotManifest = {
    schemaVersion: 1,
    gardenId,
    jobId,
    createdAt: nowIso(),
    capturedPaths,
    backupEntries,
    learnMaps: db
      .prepare("SELECT * FROM learn_maps WHERE garden_id = ? ORDER BY created_at ASC")
      .all(gardenId) as LearnMapRow[],
    learnVersions: db
      .prepare("SELECT * FROM learn_versions WHERE garden_id = ? ORDER BY created_at ASC")
      .all(gardenId) as LearnVersionRow[],
  };
  fs.writeFileSync(
    path.join(snapshotDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

function removeClusterPath(clusterDir: string, relPath: string, removedPaths: string[]): void {
  const target = clusterRelativePath(clusterDir, relPath);
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  removedPaths.push(normalizeRelPath(relPath));
}

function restoreLearnDatabaseSnapshot(
  gardenId: string,
  manifest: LearnRunSnapshotManifest,
): { deletedMaps: number; deletedVersions: number } {
  const baselineMaps = manifest.learnMaps ?? [];
  const baselineVersions = manifest.learnVersions ?? [];
  const baselineMapIds = new Set(baselineMaps.map((row) => row.id));
  const baselineVersionIds = new Set(baselineVersions.map((row) => row.id));
  const currentMaps = db
    .prepare("SELECT id FROM learn_maps WHERE garden_id = ?")
    .all(gardenId) as Array<{ id: string }>;
  const currentVersions = db
    .prepare("SELECT id FROM learn_versions WHERE garden_id = ?")
    .all(gardenId) as Array<{ id: string }>;

  db.transaction(() => {
    db.prepare("DELETE FROM learn_versions WHERE garden_id = ?").run(gardenId);
    db.prepare("DELETE FROM learn_maps WHERE garden_id = ?").run(gardenId);
    // The document selection and syllabus are restored explicitly: without them
    // a rolled-back map would silently fall back to "every document, no
    // syllabus" and quietly widen the next run's scope.
    const insertMap = db.prepare(
      `INSERT INTO learn_maps (
        id, garden_id, job_id, status, source_map_json, scope_contract_json,
        learning_map_json, proposed_order_json, visual_opportunities_json,
        coverage_plan_json, source_set_hash, source_artifact_inventory_hash,
        source_ids_json, syllabus_source_id, syllabus_coverage_json,
        visual_necessity_review_json, visualization_plan_json,
        visual_contract_executability_ledger_json, visual_route_binding_json,
        created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of baselineMaps) {
      insertMap.run(
        row.id,
        row.garden_id,
        row.job_id,
        row.status,
        row.source_map_json,
        row.scope_contract_json,
        row.learning_map_json,
        row.proposed_order_json,
        row.visual_opportunities_json,
        row.coverage_plan_json,
        row.source_set_hash,
        row.source_artifact_inventory_hash ?? "",
        // Snapshots taken before these columns existed have no value to restore.
        row.source_ids_json ?? "[]",
        row.syllabus_source_id ?? null,
        row.syllabus_coverage_json ?? null,
        row.visual_necessity_review_json ?? null,
        row.visualization_plan_json ?? null,
        row.visual_contract_executability_ledger_json ?? null,
        row.visual_route_binding_json ?? null,
        row.created_at,
        row.confirmed_at,
      );
    }
    const insertVersion = db.prepare(
      `INSERT INTO learn_versions (
        id, garden_id, job_id, learning_map_id, source_set_hash,
        source_artifact_inventory_hash, page_count, backup_dir, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of baselineVersions) {
      insertVersion.run(
        row.id,
        row.garden_id,
        row.job_id,
        row.learning_map_id,
        row.source_set_hash,
        row.source_artifact_inventory_hash ?? "",
        row.page_count,
        row.backup_dir,
        row.created_at,
      );
    }
  })();

  return {
    deletedMaps: currentMaps.filter((row) => !baselineMapIds.has(row.id)).length,
    deletedVersions: currentVersions.filter((row) => !baselineVersionIds.has(row.id)).length,
  };
}

function discardLearnRunSnapshot({
  gardenId,
  contentPath,
  jobId,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
}): void {
  const clusterDir = clusterPath(contentPath, gardenId);
  const resolved = resolveLearnRunSnapshot(clusterDir, jobId);
  fs.rmSync(learnRunSnapshotDir(clusterDir, jobId), {
    recursive: true,
    force: true,
  });
  if (resolved && resolved.jobId !== jobId) {
    fs.rmSync(learnRunSnapshotDir(clusterDir, resolved.jobId), {
      recursive: true,
      force: true,
    });
  }
}

function removeRejectedAttemptAuditsAfterTerminalLifecycle(
  contentPath: string,
  gardenId: string,
): void {
  try {
    removeAllLearnVisualRejectedAttemptAudits(clusterPath(contentPath, gardenId));
  } catch (auditCleanupError) {
    console.warn(
      `[learn] Rejected-attempt audit cleanup remains pending for ${gardenId}:`,
      auditCleanupError,
    );
  }
}

async function rollbackLearnRun({
  gardenId,
  contentPath,
  jobId,
  lease,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
  lease: GardenLearnLease;
}): Promise<LearnCleanupResult> {
  ensureLearnTables();
  if (lease.lost || !lease.heartbeat()) {
    throw new LearnPipelineConflictError(
      "Learn rollback lost its fenced garden lease before staging.",
    );
  }
  const clusterDir = clusterPath(contentPath, gardenId);
  const resolved = resolveLearnRunSnapshot(clusterDir, jobId);
  if (!resolved || resolved.manifest.gardenId !== gardenId) {
    return {
      removedPaths: [],
      restoredPaths: [],
      prunedVisualIds: [],
      deletedMaps: 0,
      deletedVersions: 0,
    };
  }

  const durableFingerprintBefore = fingerprintDurableGardenState(clusterDir);
  const fileFingerprintsBefore = fingerprintGardenFiles(clusterDir);
  const temporaryRoot = createLearnRollbackTemporaryRoot();
  const stagingGardenDir = path.join(temporaryRoot, gardenId);
  let previousGardenDir: string | undefined;
  try {
    fs.cpSync(clusterDir, stagingGardenDir, { recursive: true, force: true });
    if (
      fingerprintDurableGardenState(stagingGardenDir) !==
      durableFingerprintBefore
    ) {
      throw new LearnPipelineConflictError(
        "The garden changed while Learn prepared its rollback candidate.",
      );
    }

    const removedPaths: string[] = [];
    const restoredPaths: string[] = [];
    for (const relPath of LEARN_RUN_ROLLBACK_PATHS) {
      removeClusterPath(stagingGardenDir, relPath, removedPaths);
    }
    const snapshotDir = learnRunSnapshotDir(clusterDir, resolved.jobId);
    for (const relPath of resolved.manifest.capturedPaths ?? []) {
      const source = path.join(snapshotDir, "files", ...relPath.split("/"));
      if (!fs.existsSync(source)) continue;
      copySnapshotPath(source, clusterRelativePath(stagingGardenDir, relPath));
      restoredPaths.push(relPath);
    }

    const baselineBackupEntries = new Set(resolved.manifest.backupEntries ?? []);
    const backupsRoot = clusterRelativePath(stagingGardenDir, ".breadboard/backups");
    if (fs.existsSync(backupsRoot)) {
      for (const entry of fs.readdirSync(backupsRoot)) {
        if (!baselineBackupEntries.has(entry)) {
          removeClusterPath(
            stagingGardenDir,
            `.breadboard/backups/${entry}`,
            removedPaths,
          );
        }
      }
    }

    const allowedMutationRoots = [
      ...LEARN_RUN_ROLLBACK_PATHS,
      ".breadboard/backups",
      ".breadboard/events.jsonl",
    ];
    const candidateViolations = gardenClearBoundaryViolations({
      before: fileFingerprintsBefore,
      candidateGardenDir: stagingGardenDir,
      allowedMutationRoots,
    });
    if (candidateViolations.length > 0) {
      throw new Error(
        `Learn rollback candidate changed protected content: ${candidateViolations
          .slice(0, 6)
          .join("; ")}`,
      );
    }

    const promotion = await promoteStagingGarden({
      stagingGardenDir,
      destinationGardenDir: clusterDir,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: `rollback:${jobId}`,
      verifyCurrentDestination: (destinationDir) =>
        lease.heartbeat() &&
        fingerprintDurableGardenState(destinationDir) === durableFingerprintBefore,
      prepareIncomingForCommit: (incomingDir, destinationDir) => {
        mergeLearnEventLedgers(destinationDir, incomingDir);
        return true;
      },
      verifyManifest: (candidateDir) =>
        gardenClearBoundaryViolations({
          before: fileFingerprintsBefore,
          candidateGardenDir: candidateDir,
          allowedMutationRoots,
        }).length === 0,
    });
    previousGardenDir = promotion.previousPreservedAt;
    if (!promotion.promoted) {
      if (previousGardenDir) {
        await restorePreviousPromotedGarden(
          clusterDir,
          previousGardenDir,
          () => lease.heartbeat(),
        );
        previousGardenDir = undefined;
      }
      throw new LearnPipelineConflictError(
        `Learn rollback was not published: ${promotion.reason}`,
      );
    }
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn rollback lost its fenced garden lease before restoring SQLite.",
      );
    }

    let database: ReturnType<typeof restoreLearnDatabaseSnapshot>;
    try {
      database = restoreLearnDatabaseSnapshot(gardenId, resolved.manifest);
    } catch (databaseError) {
      if (!previousGardenDir) throw databaseError;
      try {
        await restorePreviousPromotedGarden(
          clusterDir,
          previousGardenDir,
          () => lease.heartbeat(),
        );
        previousGardenDir = undefined;
      } catch (restoreError) {
        throw new Error(
          `Learn rollback database restore failed (${errorMessage(databaseError)}), and the pre-rollback garden could not be restored (${errorMessage(restoreError)}).`,
          { cause: databaseError },
        );
      }
      throw databaseError;
    }

    if (previousGardenDir) {
      try {
        fs.rmSync(previousGardenDir, { recursive: true, force: true });
        previousGardenDir = undefined;
      } catch (cleanupError) {
        console.warn(
          `[learn] Pre-rollback garden remains at ${previousGardenDir}:`,
          cleanupError,
        );
      }
    }
    return {
      removedPaths: Array.from(new Set(removedPaths)),
      restoredPaths: Array.from(new Set(restoredPaths)),
      prunedVisualIds: [],
      ...database,
    };
  } finally {
    releaseLearnRollbackTemporaryRoot(temporaryRoot);
  }
}

function clearSourceMapForRegeneration({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): LearnCleanupResult {
  const clusterDir = clusterPath(contentPath, gardenId);
  const removedPaths: string[] = [];
  removeClusterPath(clusterDir, ".breadboard/planning", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/learning-unit-contract.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-contract-executability-reviews.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-decision-records.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-necessity-decisions.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visual-necessity-decisions.md", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visualization-plan.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visualization-coverage.json", removedPaths);
  removeClusterPath(clusterDir, ".breadboard/visualization-report.md", removedPaths);
  const deletedVersions = db.prepare("DELETE FROM learn_versions WHERE garden_id = ?").run(gardenId).changes;
  const deletedMaps = db.prepare("DELETE FROM learn_maps WHERE garden_id = ?").run(gardenId).changes;
  return {
    removedPaths,
    restoredPaths: [],
    prunedVisualIds: [],
    deletedMaps,
    deletedVersions,
  };
}

async function cleanupLearnArtifactsAfterCancel({
  gardenId,
  contentPath,
  jobId,
  lease,
  userId,
}: {
  gardenId: string;
  contentPath: string;
  jobId: string;
  lease: GardenLearnLease;
  userId?: number;
}): Promise<LearnCleanupResult> {
  const result = await rollbackLearnRun({ gardenId, contentPath, jobId, lease });
  // The rollback above is the cancellation commit point. Rebuilding Quartz can
  // take minutes and must not keep the Cancel request (or its UI) stuck after
  // the database and garden have already returned to the prior valid state.
  const publicationToken = queueLearnPublicationRetry(
    gardenId,
    "Learn cancellation cleanup",
    new Error("Publication pending"),
  );
  void publishQuartzAfterMutation(`learn cancellation cleanup in ${gardenId}`, {
    requireSuccess: true,
    gardenSlug: gardenId,
    userId,
  })
    .then(() => clearLearnPublicationRetry(gardenId, publicationToken))
    .catch((error) => {
      console.error("[learn] Background cancellation publication failed:", error);
      queueLearnPublicationRetry(gardenId, "Learn cancellation cleanup", error);
    });
  return result;
}

function isVisualSourceArtifactId(id: string): boolean {
  return /\.P\d+\.(?:F|G|T)\d+$/i.test(id);
}

function assignedVisualArtifactIdsForUnit(
  assignments: SourceArtifactAssignment[],
  unitId: string | undefined,
): string[] {
  if (!unitId) return [];
  return assignments
    .filter((assignment) => assignment.assignedLearningUnitId === unitId && isVisualSourceArtifactId(assignment.sourceArtifactId))
    .map((assignment) => assignment.sourceArtifactId);
}

/**
 * Stage 3 assignment for one page: project only the source visual IDs owned by
 * the model-authored Learning Unit Contract. `claimed` verifies one-page
 * ownership; code never ranks, substitutes, or caps the model's selection.
 */
function assignSourceVisualsForSubsection({
  visuals,
  subsection,
  claimed,
  sourceArtifactAssignments = [],
}: {
  visuals: SourceVisual[];
  subsection: LearningSubsectionPlan;
  section: LearningSectionPlan;
  claimed: Set<string>;
  sourceArtifactAssignments?: SourceArtifactAssignment[];
}): SourceVisual[] {
  const available = visuals.filter((visual) => {
    if (claimed.has(visual.sourceVisualId)) return false;
    if (visual.type === "full_page_fallback") return Boolean(sourceVisualEmbedUrl(visual));
    // A real extracted figure/table/equation without a crop should remain a
    // source anchor, not be embedded as a misleading full-page screenshot.
    return Boolean(visual.croppedImagePath);
  });

  const primaryIds = assignedVisualArtifactIdsForUnit(sourceArtifactAssignments, subsection.learningUnitId);
  const plannedIds = primaryIds.length > 0
    ? primaryIds
    : (sourceArtifactAssignments.length > 0 ? [] : (subsection.sourceVisualIds ?? []));
  const planned = plannedIds
    .map((id) => available.find((visual) => visual.sourceVisualId === id))
    .filter((visual): visual is SourceVisual => Boolean(visual));

  const chosen = planned;
  for (const visual of chosen) claimed.add(visual.sourceVisualId);
  return chosen;
}

const EMBEDDED_VISUAL_BLOCK_RE = /```breadboard-visual\r?\n([\s\S]*?)\r?\n```/g;

/**
 * Stage 6 reconciliation: one stable ID everywhere.
 *
 * - Model-authored ```breadboard-visual blocks are validated; valid ones are
 *   persisted to .breadboard/visuals/ + visual-index.json so the embedded ID,
 *   the spec file, and the index always agree. Invalid ones are removed —
 *   a broken visual never reaches the page.
 * - New interactive visuals are generated ONLY when the confirmed plan asked
 *   for them (interactiveVisuals), and only while the page has none.
 * - There is no generic fallback visual: a page that needs nothing gets nothing.
 *
 * Returns the final markdown and the IDs of the blocks actually embedded, which
 * callers must use verbatim as the page's frontmatter visualIds.
 */
async function reconcileInteractiveVisuals({
  client,
  model,
  contentPath,
  durableEventContentPath,
  gardenId,
  jobId,
  textbookVersionId,
  pageId,
  pageRelPath,
  markdown,
  subsection,
  sourceContext,
  sourceFigures,
  visualizationPlan,
  visualizationOutcomes,
  reusePublishedVisualsFromRetainedWorkspace,
}: {
  client: OpenAI;
  model: string;
  /** The mutable staging root that owns generated visual artifacts. */
  contentPath: string;
  /** Optional durable garden root for bounded, non-publishing browser
   * diagnostics. Successful artifacts and every other visual event remain
   * staged until promotion. */
  durableEventContentPath?: string;
  gardenId: string;
  jobId: string;
  textbookVersionId: string;
  pageId: string;
  pageRelPath: string;
  markdown: string;
  subsection: LearningSubsectionPlan;
  sourceContext: unknown;
  sourceFigures: SourceFigure[];
  visualizationPlan: VisualizationPlan;
  visualizationOutcomes: VisualizationPublicationOutcome[];
  /** True only when the isolated build was cloned from an exact compatible
   * failed workspace. It never changes deliberate regeneration semantics. */
  reusePublishedVisualsFromRetainedWorkspace: boolean;
}): Promise<{ markdown: string; visualIds: string[] }> {
  const keptIds: string[] = [];
  const opportunity = visualizationPlan.opportunities.find(
    (candidate) => candidate.learningUnitId === subsection.learningUnitId,
  );
  const routeDecision = opportunity
    ? visualizationPlan.decisions.find((candidate) => candidate.opportunityId === opportunity.id)
    : undefined;
  if (opportunity) {
    opportunity.targetPage = pageRelPath;
    opportunity.targetHeading = subsection.title;
    opportunity.insertionAnchor = `learning-unit:${opportunity.learningUnitId}:after-introduction`;
  }
  const recordOutcome = (outcome: VisualizationPublicationOutcome) => {
    const index = visualizationOutcomes.findIndex((candidate) => candidate.opportunityId === outcome.opportunityId);
    if (index >= 0) visualizationOutcomes[index] = outcome;
    else visualizationOutcomes.push(outcome);
  };

  // 1) Reconcile blocks the model wrote inline despite instructions. Only
  //    genuinely interactive types survive — there is no static-card fallback
  //    in the renderer, so anything else is removed rather than embedded.
  let nextMarkdown = markdown.replace(EMBEDDED_VISUAL_BLOCK_RE, "");

  // 2) Legacy bracket placeholders are removed, never replaced by filler.
  if (containsRawVisualPlaceholder(nextMarkdown)) {
    nextMarkdown = removeRawVisualPlaceholders(nextMarkdown, "");
  }

  if (!opportunity) {
    return { markdown: nextMarkdown, visualIds: keptIds };
  }
  if (!routeDecision) {
    throw new Error(`Visualization plan is missing a route decision for model-authored opportunity "${opportunity.id}".`);
  }
  if (routeDecision.route === "intentional_omission") {
    recordOutcome({
      opportunityId: opportunity.id,
      status: "intentional_omission",
      reason: routeDecision.reason,
    });
    appendLearnEvent(contentPath, gardenId, "learn_visual_skipped", {
      jobId,
      textbookVersionId,
      pageId,
      visualizationId: opportunity.id,
      reason: routeDecision.reason,
    });
    return { markdown: nextMarkdown, visualIds: keptIds };
  }
  if (routeDecision.route !== "generated_module") {
    throw new Error(
      `Visualization opportunity "${opportunity.id}" selected unsupported route "${routeDecision.route}"; ` +
        "active Learn visuals must use the model-authored generated-module contract.",
    );
  }

  {
    const marker = `<!-- ${opportunity.insertionAnchor} -->`;
    if (!nextMarkdown.includes(marker)) {
      const blocks = nextMarkdown.trim().split(/\n{2,}/);
      const introductionIndex = blocks.findIndex((block) => {
        const trimmed = block.trim();
        return Boolean(trimmed) && !trimmed.startsWith("#") && !trimmed.startsWith("![") && !trimmed.startsWith("<!--");
      });
      const insertionIndex = introductionIndex >= 0 ? introductionIndex + 1 : Math.min(1, blocks.length);
      blocks.splice(insertionIndex, 0, marker);
      nextMarkdown = blocks.join("\n\n");
    }

    const result = await createGeneratedVisualization({
      client,
      model,
      gardenDir: path.join(contentPath, gardenId),
      durableRecoveryDir: stableGeneratedVisualCouncilRecoveryRoot(
        path.join(durableEventContentPath ?? contentPath, gardenId),
      ),
      recoveryOwnerId: jobId,
      reusePublishedArtifactOnRecovery:
        reusePublishedVisualsFromRetainedWorkspace,
      opportunity,
      pageMarkdown: nextMarkdown,
      sourceContext,
      sourceFigureSummaries: sourceFigures,
      formulaDefinitions: subsection.sourceFormulaContracts ?? [],
      compilerRunner: async (sourceCode, compilerOpportunity) =>
        compileGeneratedVisualization(sourceCode, compilerOpportunity),
      browserTestRunner: (browserInput) =>
        runGeneratedVisualBrowserTestsLocally({
          ...browserInput,
          requireMobileValidation: false,
        }),
      // Every interaction in this plan was explicitly selected by the model.
      // Give each one the same bounded repair budget; code may not silently
      // demote a recommended or optional model decision after planning.
      maxAttempts: GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
      availableSourceAnchorIds: new Set(
        Object.keys(buildCanonicalSourceAnchors(path.join(contentPath, gardenId), { allowInferredFormulaText: false })),
      ),
      ...(durableEventContentPath
        ? {
            onRejectedAttempt: (rejectedAttempt) =>
              persistLearnVisualRejectedAttemptAudit({
                gardenDir: path.join(durableEventContentPath, gardenId),
                gardenId,
                jobId,
                rejectedAttempt,
              }),
          }
        : {}),
      onCouncilReceipt: (receipt) => {
        if (
          receipt.dispatchCount !== 0 &&
          receipt.dispatchCount !== 1 &&
          receipt.dispatchCount !== 2
        ) {
          throw new Error(
            `Generated-visual Council receipt reported invalid dispatch count ${receipt.dispatchCount}.`,
          );
        }
        reconcilePersistedLearnTokenUsageFromReceipt(
          db,
          jobId,
          {
            receiptId: receipt.requestId,
            requestHash: receipt.requestHash,
            usage: receipt.usage,
            providerCallCount: 1,
            reportedCallCount: 1,
            estimatedCallCount: 0,
            dispatchCount: receipt.dispatchCount,
            httpCompletionObserved: receipt.httpCompletionObserved,
            requestEvidence: {
              model: receipt.requestedModel,
              reasoningEffort: "max",
              reasoningSummary: "detailed",
            },
          },
          nowIso(),
        );
      },
      onEvent: (event) => {
        const eventData = {
          ...event.data,
          jobId,
          textbookVersionId,
          pageId,
        };
        appendLearnEvent(contentPath, gardenId, event.type, eventData);
        // A failed generation disposes its staging directory. Preserve bounded,
        // allowlisted receipts at the durable root without publishing a visual
        // artifact or any raw browser/process diagnostics.
        if (
          durableEventContentPath &&
          durableEventContentPath !== contentPath &&
          event.type === "visual_browser_tests_completed" &&
          event.data.previewMatrixReceipt
        ) {
          appendLearnEvent(
            durableEventContentPath,
            gardenId,
            "learn_visual_preview_matrix_observed",
            {
              ...eventData,
              stage: "staging_unpublished",
            },
          );
        }
        if (
          durableEventContentPath &&
          durableEventContentPath !== contentPath &&
          event.type === "learn_visual_rejected_attempt_audit_failed"
        ) {
          appendLearnEvent(
            durableEventContentPath,
            gardenId,
            event.type,
            {
              ...eventData,
              stage: "staging_unpublished",
            },
          );
        }
      },
      checkCancelled: () => throwIfLearnCancelled(jobId),
    });
    if (result.manifest) {
      if (durableEventContentPath) {
        try {
          removeLearnVisualRejectedAttemptAudit({
            gardenDir: path.join(durableEventContentPath, gardenId),
            jobId,
            visualizationId: opportunity.id,
          });
        } catch {
          // A published visual is authoritative even when best-effort
          // diagnostic garbage collection cannot complete immediately.
        }
      }
      const block = buildGeneratedVisualBlock(result.manifest.id, result.manifest.version);
      nextMarkdown = nextMarkdown.replace(marker, `${marker}\n\n${block}`);
      keptIds.push(result.manifest.id);
      recordOutcome({ opportunityId: opportunity.id, status: "generated_published" });
    } else {
      const status: VisualizationPublicationOutcome["status"] =
        result.failureCategory === "runtime"
          ? "failed_runtime_tests"
          : result.failureCategory === "critic"
            ? "failed_critic"
            : result.failureCategory === "compilation"
              ? "failed_compilation"
              : "failed_validation";
      recordOutcome({ opportunityId: opportunity.id, status, reason: result.errors.join("; ") });
      const criticReviewDidNotComplete =
        result.failureCategory === "critic" &&
        result.errors.some((error) => /^Critic review could not complete\b/i.test(error));
      if (criticReviewDidNotComplete) {
        throw new Error(
          `Model-approved ${opportunity.requirement} interactive visual "${opportunity.id}" compiled and passed its validation and runtime gates, ` +
            `but critic review could not complete: ${result.errors.join("; ")}.`,
        );
      }
      throw new Error(
        `Model-approved ${opportunity.requirement} interactive visual "${opportunity.id}" could not be generated after its bounded repair attempts` +
          `${result.failureCategory ? ` (${result.failureCategory})` : ""}: ${result.errors.join("; ") || "no valid visual was produced"}.`,
      );
    }
    return { markdown: nextMarkdown, visualIds: keptIds };
  }

  return { markdown: nextMarkdown, visualIds: keptIds };
}

function cleanCouncilMarkdown(value: string, fallback: string): string {
  const cleaned = stripMarkdownFrontmatter(stripMarkdownFence(cleanGeneratedText(value))).trim();
  return cleaned || fallback;
}

function compactFallbackText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[#>*_`|[\](){}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- PageDossier: compact per-page context for subsection writing -----------
// A subsection prompt no longer receives the full source map, scope contract,
// and learning spine. It receives one exact local projection of the
// model-authored contract, its cited canonical source excerpts, and its
// assigned visuals. Code does not choose semantically similar source text.

type PageDossier = {
  gardenTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
  subsectionPurpose?: string;
  learningGoal?: string;
  learningUnit?: {
    id?: string;
    role?: string;
    learningQuestion?: string;
    prerequisiteConcepts?: string[];
    newConcepts?: string[];
    syllabusUnitIds?: string[];
    sourceFigures?: LearningSubsectionPlan["sourceFigureContracts"];
    sourceFormulas?: LearningSubsectionPlan["sourceFormulaContracts"];
    sourceTables?: LearningSubsectionPlan["sourceTableContracts"];
    sourceQuestions?: LearningSubsectionPlan["sourceQuestionContracts"];
    sourceArtifactAssignments?: SourceArtifactAssignment[];
    interactiveVisual?: LearningSubsectionPlan["interactiveVisualContract"];
    interactiveVisualPlan?: LearningSubsectionPlan["interactiveVisualPlan"];
    teachingMediumPlan?: LearningSubsectionPlan["teachingMediumPlan"];
    zettelNotes?: LearningSubsectionPlan["zettelNotes"];
    semanticConcepts?: LearningSubsectionPlan["semanticConcepts"];
    knowledgeClaims?: LearningSubsectionPlan["knowledgeClaims"];
    mustNotRepeat?: string[];
    expectedWordRange?: [number, number];
  };

  /** Exact source-formula strings required as visible display equations on this
   * page. This is a transport projection, not a code-authored lesson edit. */
  requiredSourceFormulas: Array<{
    id: string;
    exactText: string;
    teachingGoal: string;
    termsToDefine: string[];
    placement: string;
  }>;

  /** Exact source-authored practice prompts assigned by the Learning Unit Contract. */
  requiredSourceQuestions: Array<{
    id: string;
    label: string;
    prompt: string;
    sourceAnchorIds: string[];
    relatedFigureIds: string[];
    syllabusAssignments: SourceQuestionPlan["syllabusAssignments"];
    teachingValue: string;
    placement: string;
    teachingGoal: string;
  }>;

  mustCover: string[];
  avoid: string[];

  /** The course study guide, when one was designated. Orientation only — it
   * never appears in the lesson. */
  syllabus?: {
    title: string;
    outline: string;
  };

  /** Exact syllabus units selected for this page by the learning-spine model. */
  syllabusUnits?: Array<{
    unitId: string;
    label?: string;
    title: string;
    objectives: string[];
    topics: string[];
    questionReferences: string[];
  }>;

  /** Works the course assigns that this garden does not contain. The page must
   * not name, summarize, or teach from any of them. */
  unavailableCitations?: string[];

  relevantSourceSnippets: Array<{
    sourceId: string;
    title: string;
    excerpt: string;
  }>;

  assignedSourceVisuals: Array<{
    sourceVisualId: string;
    sourceId?: string;
    title?: string;
    caption?: string;
    type?: string;
    markdown?: string;
  }>;

  localAnchors?: string[];
  sourceOnly: boolean;
};

/** Short scope reminders for the dossier's avoid list. */
function scopeAvoidList(scopeContract: unknown): string[] {
  if (!scopeContract || typeof scopeContract !== "object") return [];
  const excluded = (scopeContract as Record<string, unknown>).excluded;
  if (!Array.isArray(excluded)) return [];
  return excluded
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 200))
    .slice(0, 5);
}

function exactSourceSnippetsForAnchors(input: {
  anchors: readonly string[];
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>;
  sources: readonly LearnSourceSummary[];
}): Array<{ sourceId: string; title: string; excerpt: string }> {
  const sourceById = new Map(input.sources.map((source) => [source.slug, source]));
  const snippets: Array<{ sourceId: string; title: string; excerpt: string }> = [];
  let projectedChars = 0;
  for (const anchorId of input.anchors) {
    const anchor = input.canonicalSourceAnchors[anchorId];
    if (!anchor?.exactText || !anchor.sourceId) continue;
    const source = sourceById.get(anchor.sourceId);
    if (!source) continue;
    const excerpt = anchor.exactText.trim();
    if (!excerpt) continue;
    projectedChars += excerpt.length;
    if (projectedChars > MAX_TOTAL_SOURCE_CHARS_PER_PAGE) {
      throw new Error(
        `Model-authored source evidence for this page exceeds the ${MAX_TOTAL_SOURCE_CHARS_PER_PAGE}-character transport limit. Repair the Learning Unit Contract with fewer, more precise canonical anchors.`,
      );
    }
    snippets.push({ sourceId: source.slug, title: source.title, excerpt });
  }
  return snippets;
}

function requiredSourceFormulaDossierEntries(
  contracts: readonly NonNullable<LearningSubsectionPlan["sourceFormulaContracts"]>[number][],
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>,
): PageDossier["requiredSourceFormulas"] {
  return contracts.map((contract) => {
    const anchor = canonicalSourceAnchors[contract.id];
    const exactText = anchor?.kind === "formula" ? anchor.exactText?.trim() : "";
    if (!exactText) {
      throw new Error(
        `Page dossier cannot project required source formula ${contract.id} without its verbatim canonical equation transcription.`,
      );
    }
    return {
      id: contract.id,
      exactText,
      teachingGoal: contract.teachingGoal,
      termsToDefine: [...contract.termsToDefine],
      placement: contract.placement,
    };
  });
}

function buildPageDossier({
  gardenTitle,
  sectionTitle,
  sectionPurpose,
  subsection,
  anchors,
  scopeContract,
  sources,
  syllabus,
  syllabusCoverage,
  assignedVisuals,
  sourceQuestions,
  sourceArtifactAssignments,
  canonicalSourceAnchors,
  sourceOnly,
}: {
  gardenTitle: string;
  sectionTitle: string;
  sectionPurpose?: string;
  subsection: LearningSubsectionPlan;
  anchors: string[];
  scopeContract: unknown;
  sources: LearnSourceSummary[];
  syllabus?: LearnSourceSummary | null;
  syllabusCoverage?: SyllabusCoverage | null;
  assignedVisuals: SourceVisual[];
  sourceQuestions: SourceQuestionPlan[];
  sourceArtifactAssignments?: SourceArtifactAssignment[];
  canonicalSourceAnchors: Readonly<Record<string, CanonicalSourceAnchor>>;
  sourceOnly: boolean;
}): PageDossier {
  const subsectionTitle = subsection.title;
  const assignedArtifactsForUnit = subsection.learningUnitId && sourceArtifactAssignments
    ? sourceArtifactAssignments.filter((assignment) => assignment.assignedLearningUnitId === subsection.learningUnitId)
    : (subsection.sourceArtifactAssignments ?? []);

  const syllabusCoverageById = new Map(
    (syllabusCoverage?.units ?? []).map((unit) => [unit.unitId, unit]),
  );
  const matchedSyllabusUnits = (subsection.syllabusUnitIds ?? [])
    .map((unitId) => syllabusCoverageById.get(unitId))
    .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
  const sourceQuestionById = new Map(sourceQuestions.map((question) => [question.id, question]));
  const requiredSourceQuestions = (subsection.sourceQuestionContracts ?? []).map((contract) => {
    const question = sourceQuestionById.get(contract.id);
    if (!question) {
      throw new Error(
        `Page dossier cannot project source question ${contract.id} because it is missing from the confirmed Source Map registry.`,
      );
    }
    return {
      ...question,
      placement: contract.placement,
      teachingGoal: contract.teachingGoal,
    };
  });
  const dossierSourceAnchorIds = [...new Set([
    ...anchors,
    ...(subsection.semanticConcepts ?? []).flatMap((concept) => concept.evidenceAnchors),
    ...(subsection.knowledgeClaims ?? []).flatMap((claim) => [
      ...claim.evidenceAnchors,
      ...(claim.derivationAnchors ?? []),
    ]),
    ...(subsection.sourceFigureContracts ?? []).map((figure) => figure.id),
    ...(subsection.sourceFormulaContracts ?? []).map((formula) => formula.id),
    ...(subsection.sourceTableContracts ?? []).map((table) => table.id),
    ...requiredSourceQuestions.flatMap((question) => question.sourceAnchorIds),
  ])];
  return {
    gardenTitle,
    sectionTitle,
    subsectionTitle,
    subsectionPurpose: subsection.purpose || undefined,
    learningGoal: sectionPurpose || undefined,
    learningUnit: subsection.learningUnitId
      ? {
          id: subsection.learningUnitId,
          role: subsection.learningUnitRole,
          learningQuestion: subsection.learningQuestion,
          prerequisiteConcepts: subsection.prerequisiteConcepts,
          newConcepts: subsection.newConcepts,
          syllabusUnitIds: subsection.syllabusUnitIds,
          sourceFigures: subsection.sourceFigureContracts,
          sourceFormulas: subsection.sourceFormulaContracts,
          sourceTables: subsection.sourceTableContracts,
          sourceQuestions: subsection.sourceQuestionContracts,
          sourceArtifactAssignments: assignedArtifactsForUnit,
          interactiveVisual: subsection.interactiveVisualContract,
          interactiveVisualPlan: subsection.interactiveVisualPlan,
          teachingMediumPlan: subsection.teachingMediumPlan,
          zettelNotes: subsection.zettelNotes,
          semanticConcepts: subsection.semanticConcepts,
          knowledgeClaims: subsection.knowledgeClaims,
          mustNotRepeat: subsection.mustNotRepeat,
          expectedWordRange: subsection.expectedWordRange,
        }
      : undefined,
    requiredSourceFormulas: requiredSourceFormulaDossierEntries(
      subsection.sourceFormulaContracts ?? [],
      canonicalSourceAnchors,
    ),
    requiredSourceQuestions,
    mustCover: (subsection.conceptTags ?? [])
      .map((tag) => tag.split("/").at(-1)?.replace(/-/g, " ") ?? "")
      .filter(Boolean)
      .slice(0, 8),
    avoid: scopeAvoidList(scopeContract),
    syllabus: syllabus
      ? {
          title: syllabus.title,
          outline: truncate(syllabus.body, MAX_SYLLABUS_DOSSIER_CHARS),
        }
      : undefined,
    syllabusUnits: matchedSyllabusUnits.length > 0
      ? matchedSyllabusUnits.map((unit) => ({
          unitId: unit.unitId,
          label: unit.label,
          title: unit.title,
          objectives: unit.objectives,
          topics: unit.topics,
          questionReferences: unit.questionReferences ?? [],
        }))
      : undefined,
    unavailableCitations: matchedSyllabusUnits.some((unit) => unit.missingCitations.length > 0)
      ? [...new Set(matchedSyllabusUnits.flatMap((unit) => unit.missingCitations))]
      : undefined,
    relevantSourceSnippets: exactSourceSnippetsForAnchors({
      anchors: dossierSourceAnchorIds,
      canonicalSourceAnchors,
      sources,
    }),
    assignedSourceVisuals: assignedVisuals
      .map((visual) => ({
        sourceVisualId: visual.sourceVisualId,
        sourceId: visual.sourceId,
        caption: visual.caption,
        type: visual.type,
        markdown: sourceVisualMarkdown(visual) ?? undefined,
      })),
    localAnchors: anchors.slice(0, 8),
    sourceOnly,
  };
}

/**
 * Prompt JSON necessarily escapes backslashes and newlines. For a source
 * formula that must be copied character-for-character, give the writing model
 * a second, literal transport channel before the JSON packet. This only carries
 * canonical source evidence into a model request; it never inserts or changes
 * learner Markdown in code.
 */
function withVerbatimSourceFormulaCopySheet(
  payload: string,
  formulas: readonly PageDossier["requiredSourceFormulas"][number][],
): string {
  if (formulas.length === 0) return payload;
  const blocks = formulas.map(({ id, exactText }) => [
    `Formula ${id}: copy this complete display block character-for-character.`,
    "$$",
    exactText,
    "$$",
  ].join("\n")).join("\n\n");
  return [
    "VERBATIM SOURCE FORMULA COPY SHEET",
    "The following are literal Markdown display blocks, not JSON strings. Copy every block into the final lesson exactly as printed, including every backslash and aligned-row separator. When an aligned row shows two ASCII backslashes before &, keep exactly two; never add or remove a backslash.",
    blocks,
    payload,
  ].join("\n\n");
}

function sourceFormulasNeedingVerbatimRepair(
  formulas: readonly PageDossier["requiredSourceFormulas"][number][],
  problems: readonly Parameters<typeof formatQualityProblemForRepair>[0][],
): PageDossier["requiredSourceFormulas"] {
  const missingFormulaIds = new Set(
    problems
      .filter((problem) => problem.code === "missing-source-formula")
      .map((problem) => problem.message.match(/^required source formula (\S+)\b/)?.[1])
      .filter((id): id is string => Boolean(id)),
  );
  return formulas.filter((formula) => missingFormulaIds.has(formula.id));
}

function formatModelAuthoredLessonQualityProblemForRepair(
  problem: Parameters<typeof formatQualityProblemForRepair>[0],
): string {
  if (problem.code === "missing-source-formula") {
    return `${problem.code}: ${problem.message}; copy the named replacement from the VERBATIM SOURCE FORMULA COPY SHEET exactly.`;
  }
  return formatQualityProblemForRepair(problem);
}

function snapshotSourceContext({
  clusterDir,
  textbookVersionId,
  pageId,
  sourceContext,
}: {
  clusterDir: string;
  textbookVersionId: string;
  pageId: string;
  sourceContext: unknown;
}): void {
  const fileName = `${safeLearnFileSegment(pageId, "page").replace(/\s+/g, "-")}.json`;
  const filePath = path.join(clusterDir, ".breadboard", "source-snapshots", textbookVersionId, fileName);
  assertInsideCluster(clusterDir, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sourceContext, null, 2), "utf-8");
}

export async function runTextbookGeneration({
  gardenId,
  userId,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  confirmedLearningMapId,
  mode = "generate",
  sourceOnly = true,
  includeSourceSnapshots = false,
  userInstruction,
  autoConfirmTopicMap = false,
  confirmProposedLearningMap = false,
  gardenLease,
  yieldToResponse,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  confirmedLearningMapId?: string;
  mode?: Exclude<LearnMode, "plan">;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  userInstruction?: string;
  /**
   * Noninteractive/test escape hatch. When true, a proposed (unconfirmed) topic
   * map is auto-promoted to confirmed so page generation can proceed without a
   * human review gate. Off by default: interactive runs MUST go through
   * `confirmLearningMap` after reviewing the proposed map.
   */
  autoConfirmTopicMap?: boolean;
  /**
   * Interactive exact-ID handoff. Confirmation happens only after generation
   * owns the garden lease, so a route-process crash cannot strand a confirmed
   * map between the UI action and creation of its generation job.
   */
  confirmProposedLearningMap?: boolean;
  /** Internal full-rebuild handoff. The caller retains release ownership. */
  gardenLease?: GardenLearnLease;
  /** Cooperative route handoff after the durable job is visible to polling. */
  yieldToResponse?: (jobId: string) => Promise<void>;
}): Promise<{ job: LearnJob; textbookVersionId: string; pageCount: number }> {
  const requestedUserInstruction = normalizeLearnUserInstruction(userInstruction);
  if (mode === "repair") {
    throw new Error("Scoped repair must use runLearnRepairOperation; it cannot enter the full page-generation loop.");
  }
  // Reject an exact-map retry before acquiring a lease or reconciling any
  // workflow rows. The same binding is checked again under the lease below.
  if (confirmedLearningMapId) {
    const requestedMap = getLearnMapById(confirmedLearningMapId, gardenId);
    if (!requestedMap) {
      throw new LearnPipelineConflictError(
        "The requested confirmed Learning Map does not belong to this garden or no longer exists.",
      );
    }
    requireLearnMapPlanningModel(requestedMap, gardenId, model);
  }
  assertNoPendingLearnClear(gardenId);
  const repositoryGardenDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(repositoryGardenDir, { recursive: true });
  const publishedPages = mode === "update_sources"
    ? publishedLearningPagesByUnitId(repositoryGardenDir)
    : new Map();
  if (mode === "update_sources" && publishedPages.size === 0) {
    throw new LearnPipelineConflictError(
      "Additive Learn could not find the published unit pages to preserve. Repair the garden or explicitly rebuild it before adding material.",
    );
  }
  const jobId = gardenLease?.lock.jobId ?? makeId("learn_job");
  let lease: GardenLearnLease;
  let ownsLease = false;
  if (gardenLease) {
    if (gardenLease.lost || !gardenLease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "The full rebuild lost its garden lease before generation could start.",
      );
    }
    lease = gardenLease;
  } else {
    const leaseResult = acquireGardenLearnLease(repositoryGardenDir, {
      gardenSlug: gardenId,
      jobId,
      buildId: `generation:${jobId}`,
    }, {
      onLeaseLost: () => abortLearnWorkerAfterLeaseLoss(jobId),
    });
    if (!leaseResult.acquired) {
      const message = `Another Learn operation (${leaseResult.conflict.jobId}) is already changing this garden.`;
      throw new LearnPipelineConflictError(message);
    }
    lease = leaseResult.lease;
    ownsLease = true;
  }
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
  } catch (error) {
    if (ownsLease) {
      try {
        lease.release();
      } catch {
        // Lease cleanup must not replace setup failure.
      }
    }
    throw error;
  }

  let map: StoredLearningMap;
  let context: LearnSourceContext;
  let sourceFormulaReviewFinalizationContext!: SourceFormulaReviewFinalizationContext;
  let effectiveUserInstruction: string | undefined;
  let handoffJobId: string | undefined;
  let inheritedPlanningSnapshotJobId: string | undefined;
  try {
    let selectedMap = confirmedLearningMapId
      ? getLearnMapById(confirmedLearningMapId, gardenId)
      : getLatestConfirmedLearnMap(gardenId);
    if (confirmedLearningMapId && !selectedMap) {
      throw new LearnPipelineConflictError(
        "The requested confirmed Learning Map does not belong to this garden or no longer exists.",
      );
    }
    if (confirmProposedLearningMap && !confirmedLearningMapId) {
      throw new LearnPipelineConflictError(
        "Interactive generation requires the exact proposed Learning Map ID.",
      );
    }
    let proposedForAutoConfirm: StoredLearningMap | null = null;
    if ((!selectedMap || selectedMap.status !== "confirmed") && autoConfirmTopicMap) {
      proposedForAutoConfirm = confirmedLearningMapId
        ? getLearnMapById(confirmedLearningMapId, gardenId)
        : getLatestProposedLearnMap(gardenId);
    }
    const workflowMap = selectedMap ?? proposedForAutoConfirm;
    inheritedPlanningSnapshotJobId = generationRollbackInheritanceJobId({
      mapAtEntry: workflowMap,
      confirmsProposedMap: confirmProposedLearningMap || autoConfirmTopicMap,
    });
    // A manual confirmation normally leaves its planning row waiting. It is
    // the one row this generation is allowed to hand off; every other active,
    // pending-cancel, or awaiting workflow must be reconciled first.
    const workflowJob = workflowMap
      ? requireLearnMapPlanningModel(workflowMap, gardenId, model)
      : null;
    handoffJobId =
      workflowJob?.gardenId === gardenId &&
      (workflowJob.status === "awaiting_confirmation" ||
        workflowJob.status === "building_navigation")
        ? workflowJob.id
        : undefined;
    assertNoUnresolvedLearnJob(gardenId, handoffJobId);
    if (!gardenLease && inheritedPlanningSnapshotJobId) {
      // Persist the alias before either automatic or interactive confirmation
      // can promote the proposal. Until this write completes, the still-active
      // planning job remains the sole recovery owner of its original snapshot.
      createLearnRunSnapshot({
        gardenId,
        contentPath,
        jobId,
        inheritFromJobId: inheritedPlanningSnapshotJobId,
      });
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn generation lost its garden lease while creating the inherited rollback checkpoint.",
        );
      }
    }
    if (proposedForAutoConfirm) {
      // This mutation is deliberately inside the fenced garden lease.
      if (proposedForAutoConfirm.status !== "confirmed") {
        confirmLearningMap({
          gardenId,
          learningMapId: proposedForAutoConfirm.id,
          expectedModel: model,
          contentPath,
          gardenLease: lease,
        });
      }
      selectedMap = getLearnMapById(proposedForAutoConfirm.id, gardenId);
    }
    const exactInteractiveProposal =
      confirmProposedLearningMap && selectedMap?.status === "proposed";
    if (
      !selectedMap ||
      (selectedMap.status !== "confirmed" && !exactInteractiveProposal)
    ) {
      throw new Error(
        "Confirm a learning map before generating lessons (status must be 'confirmed'; " +
          "pass autoConfirmTopicMap:true only in noninteractive/test runs).",
      );
    }
    if (!isContractBackedLearningMap(selectedMap)) {
      throw new LearnPipelineConflictError(
        "This confirmed learning map was created before Learning Unit Contracts existed. Start Learn again to draft a new source-grounded learning map.",
        { requiresReplan: true },
      );
    }
    if (!selectedMap.visualNecessityReview ||
        !selectedMap.visualizationPlan ||
        !selectedMap.visualContractExecutabilityLedger ||
        !selectedMap.visualRouteBinding) {
      throw new LearnPipelineConflictError(
        "This confirmed Learning Map predates its durable visual route bundle. Run Learn planning again and confirm the new proposed map before generation.",
        { requiresReplan: true },
      );
    }
    if (gardenLease && selectedMap.jobId !== jobId) {
      throw new LearnPipelineConflictError(
        "The retained planning lease does not own the confirmed Learning Map.",
      );
    }
    map = selectedMap;
    effectiveUserInstruction =
      requestedUserInstruction ??
      normalizeLearnUserInstruction(getLearnJobById(map.jobId)?.userInstruction);
    // Reload source state only after lease acquisition. A confirmed map owns
    // its exact document/syllabus selection, so a concurrent rebuild cannot
    // leave this worker generating from stale pre-lock bytes.
    context = collectLearnSourceContext(
      contentPath,
      gardenId,
      map.sourceIds.length > 0 ? map.sourceIds : undefined,
      map.syllabusSourceId,
    );
    const confirmedFormulaReviewSetHash = sourceFormulaReviewSetHashFromCoveragePlan(
      map.coveragePlan,
    );
    const confirmedArtifactInventoryHash =
      sourceArtifactInventoryHashFromCoveragePlan(map.coveragePlan);
    if (!confirmedFormulaReviewSetHash) {
      throw new LearnPipelineConflictError(
        "This confirmed Learning Map predates AI source-formula fidelity review. Run Learn planning again and review the new map before generating lessons.",
        { requiresReplan: true },
      );
    }
    if (context.sourceFormulaReviewSetHash !== confirmedFormulaReviewSetHash) {
      throw new LearnPipelineConflictError(
        "The reviewed source-formula evidence changed after this Learning Map was created. Run Learn planning again before generating lessons.",
        { requiresReplan: true },
      );
    }
    if (context.sourceSetHash !== map.sourceSetHash) {
      throw new LearnPipelineConflictError(
        "The selected sources changed after this Learning Map was created. Run Learn planning again and review the updated map before generating lessons.",
        { requiresReplan: true },
      );
    }
    if (
      !confirmedArtifactInventoryHash ||
      confirmedArtifactInventoryHash !== map.sourceArtifactInventoryHash ||
      context.sourceArtifactInventoryHash !== confirmedArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected source-artifact inventory changed after this Learning Map was created. Run Learn planning again before generating lessons.",
        { requiresReplan: true },
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context,
      coveragePlan: map.coveragePlan,
      syllabusCoverage: map.syllabusCoverage,
      stage: "Generation preflight",
    });
    const confirmedReviewManifest = loadSourceFormulaReviewSetManifest(contentPath, gardenId);
    if (
      !confirmedReviewManifest ||
      confirmedReviewManifest.reviewSetHash !== confirmedFormulaReviewSetHash ||
      confirmedReviewManifest.combinedSourceSetHash !== map.sourceSetHash ||
      JSON.stringify(confirmedReviewManifest.sourceIds) !==
        JSON.stringify(context.sources.map((source) => source.slug)) ||
      confirmedReviewManifest.sourceIdentityMapHash !==
        sourceVisualSourceIdentityMapHash(context.sourceVisualSourceIdentityMap) ||
      JSON.stringify(confirmedReviewManifest.sourceIdentityMap) !==
        JSON.stringify(context.sourceVisualSourceIdentityMap)
    ) {
      throw new LearnPipelineConflictError(
        "The promoted source-formula review manifest does not match the confirmed Learning Map. Run planning again before generation.",
        { requiresReplan: true },
      );
    }
    const confirmedReviewValidation = validateSourceFormulaReviewSet({
      contentPath,
      gardenSlug: gardenId,
      requiredFormulaIds: confirmedReviewManifest.formulaIds,
      expectedReviewSetHash: confirmedReviewManifest.reviewSetHash,
      expectedModel: confirmedReviewManifest.model,
      expectedSourceIds: confirmedReviewManifest.sourceIds,
      sourceIdentityMap: context.sourceVisualSourceIdentityMap,
      expectedTopologyReviewPageReceipts: confirmedReviewManifest.topologyReviewPageReceipts,
    });
    if (confirmedReviewValidation.problems.length > 0) {
      throw new LearnPipelineConflictError(
        `The promoted source-formula review evidence failed strict validation: ${confirmedReviewValidation.problems.join("; ")} Run Learn planning again before generating lessons.`,
        { requiresReplan: true },
      );
    }
    sourceFormulaReviewFinalizationContext = {
      reviewSetHash: confirmedReviewManifest.reviewSetHash,
      combinedSourceSetHash: map.sourceSetHash,
      sourceArtifactInventoryHash: confirmedArtifactInventoryHash,
      syllabusCoverageEvidenceRecoveryHash:
        syllabusCoverageEvidenceRecoveryHashFromCoveragePlan(map.coveragePlan) ?? "",
      ...(map.syllabusCoverage?.evidenceRecovery !== undefined
        ? {
            syllabusCoverageEvidenceRecovery: JSON.parse(JSON.stringify(
              map.syllabusCoverage.evidenceRecovery,
            )) as SyllabusCoverageEvidenceRecoveryReceipt,
          }
        : {}),
      formulaIds: [...confirmedReviewManifest.formulaIds],
      sourceIds: [...confirmedReviewManifest.sourceIds],
      sourceIdentityMap: context.sourceVisualSourceIdentityMap.map((entry) => ({ ...entry })),
      topologyReviewPageReceipts: confirmedReviewManifest.topologyReviewPageReceipts.map(
        (receipt) => ({
          ...receipt,
          activeFormulaIds: [...receipt.activeFormulaIds],
        }),
      ),
      model: confirmedReviewManifest.model,
    };
  } catch (error) {
    if (ownsLease) lease.release();
    throw error;
  }

  let job: LearnJob;
  try {
    if (confirmProposedLearningMap) {
      if (!confirmedLearningMapId || !handoffJobId || map.status !== "proposed") {
        throw new LearnPipelineConflictError(
          "The exact proposed Learning Map is no longer awaiting generation handoff.",
        );
      }
      // Make the handoff recoverable before the irreversible confirmation.
      // If this worker dies from here onward, startup recovery sees an active
      // planning row and restores its exact snapshot instead of leaving a
      // confirmed map with no generation owner.
      updateLearnJobExpectStatus(handoffJobId, {
        status: "building_navigation",
        currentStep: "Confirmation accepted; preparing lesson generation",
        progressPercent: 100,
      });
      try {
        map = confirmLearningMap({
          gardenId,
          learningMapId: confirmedLearningMapId,
          expectedModel: model,
          contentPath,
          gardenLease: lease,
          requireProposed: true,
        });
      } catch (error) {
        // A validation conflict before confirmation is still reviewable. If
        // confirmation actually committed and only a later evidence write
        // failed, retain the active recovery marker so rollback—not a guessed
        // status rewrite—owns reconciliation.
        if (getLearnMapById(confirmedLearningMapId, gardenId)?.status !== "confirmed") {
          updateLearnJobExpectStatus(handoffJobId, {
            status: "awaiting_confirmation",
            currentStep: "Learning map ready for review",
            progressPercent: 100,
          });
        }
        throw error;
      }
    }
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease before creating or adopting its job.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    if (!gardenLease && !inheritedPlanningSnapshotJobId) {
      // The rollback checkpoint must exist before the planning workflow hands
      // ownership to a new generation job. A proposal already wrote its
      // inherited alias before promotion; an already-confirmed input gets this
      // fresh baseline so Stop preserves that map.
      createLearnRunSnapshot({
        gardenId,
        contentPath,
        jobId,
      });
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn generation lost its garden lease while creating the rollback checkpoint.",
        );
      }
    }
    const currentHandoffJob = handoffJobId
      ? getLearnJobById(handoffJobId)
      : null;
    handoffJobId =
      currentHandoffJob?.gardenId === gardenId &&
      (currentHandoffJob.status === "awaiting_confirmation" ||
        currentHandoffJob.status === "building_navigation")
        ? currentHandoffJob.id
        : undefined;
    assertNoUnresolvedLearnJob(gardenId, handoffJobId);
    if (gardenLease) {
      throwIfLearnCancelled(jobId);
      const retainedJob = getLearnJobById(jobId);
      if (!retainedJob || retainedJob.gardenId !== gardenId) {
        throw new LearnPipelineConflictError(
          "The retained planning job no longer exists for this garden.",
        );
      }
      job = updateLearnJob(jobId, {
        model,
        mode,
        sourceIds: context.selectedSourceIds,
        syllabusSourceId: context.syllabus?.slug,
        userInstruction: effectiveUserInstruction,
        sourceOnly,
        includeSourceSnapshots,
        confirmedLearningMapId: map.id,
        currentStep: "Preparing isolated lesson workspace",
      });
      if (job.status === "cancelled" || job.status === "failed" || job.status === "complete") {
        throw new LearnPipelineConflictError(
          `The retained Learn workflow is already ${job.status}.`,
        );
      }
    } else {
      job = db.transaction(() => {
        const planningJob = getLearnJobById(map.jobId);
        if (
          planningJob?.gardenId === gardenId &&
          (planningJob.status === "awaiting_confirmation" ||
            planningJob.status === "building_navigation")
        ) {
          updateLearnJobExpectStatus(planningJob.id, {
            status: "complete",
            currentStep: `Learning map confirmed; lesson generation handed off to ${jobId}`,
            progressPercent: 100,
            confirmedLearningMapId: map.id,
          });
        }
        return createLearnJob({
          id: jobId,
          gardenId,
          userId,
          model,
          mode,
          sourceIds: context.selectedSourceIds,
          syllabusSourceId: context.syllabus?.slug,
          userInstruction: effectiveUserInstruction,
          sourceOnly,
          includeSourceSnapshots,
        });
      }).immediate();
    }
  } catch (error) {
    if (ownsLease) lease.release();
    throw error;
  }

  let workspace: LearnBuildWorkspace | null = null;
  let disposeModelTracking = (): void => {};
  try {
    activeLearnCouncilDispatchAuthorities.set(
      job.id,
      () => confirmLearnLeaseForCouncilDispatch(lease, job.id),
    );
    updateLearnJob(job.id, {
      status: "generating_learning_pages",
      currentStep: "Preparing isolated lesson workspace",
      progressPercent: 2,
      confirmedLearningMapId: map.id,
      sourceSetHash: context.sourceSetHash,
    });
    throwIfLearnCancelled(job.id);
    await yieldToResponse?.(job.id);
    throwIfLearnCancelled(job.id);
    workspace = createLearnBuildWorkspace({
      gardenSlug: gardenId,
      jobId: job.id,
      mode:
        mode === "update_sources"
          ? "update"
          : mode === "generate"
            ? "generate"
            : "regenerate",
      repositoryGardenDir,
      contractFingerprint: createHash("sha256")
        .update(JSON.stringify(map.coveragePlan ?? null))
        .digest("hex"),
      sourceSetFingerprint: context.sourceSetHash,
      stagingDirectoryName: gardenId,
      requireAuthoritativeSourceAnchorLedger: true,
    });
    if (workspace.resumedFromJobId) {
      const resumedJob = getLearnJobById(workspace.resumedFromJobId);
      updateLearnJob(job.id, {
        currentStep: "Resuming retained lesson workspace",
        // The new job replays idempotent preflight work, but its visible
        // progress starts at the durable high-water mark of the workspace it
        // cloned. Cap below 100 because completed jobs are not resumable.
        progressPercent: Math.min(99, resumedJob?.progressPercent ?? 0),
      });
      appendLearnEvent(contentPath, gardenId, "learn_build_workspace_resumed", {
        jobId: job.id,
        buildId: workspace.buildId,
        resumedFromJobId: workspace.resumedFromJobId,
        resumedFromBuildId: workspace.resumedFromBuildId,
        contractFingerprint: workspace.contractFingerprint,
        sourceSetFingerprint: workspace.sourceSetFingerprint,
      });
    }
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease while seeding the isolated workspace.",
      );
    }
    const stagedContext = collectLearnSourceContext(
      workspace.workspaceRoot,
      gardenId,
      map.sourceIds.length > 0 ? map.sourceIds : undefined,
      map.syllabusSourceId,
    );
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease while validating staged sources.",
      );
    }
    if (
      stagedContext.sourceFormulaReviewSetHash !==
      sourceFormulaReviewSetHashFromCoveragePlan(map.coveragePlan)
    ) {
      throw new LearnPipelineConflictError(
        "The staged reviewed source-formula evidence does not match the confirmed Learning Map. Run planning again before generating lessons.",
        { requiresReplan: true },
      );
    }
    if (stagedContext.sourceSetHash !== map.sourceSetHash) {
      throw new LearnPipelineConflictError(
        "The selected sources changed while Learn was preparing its isolated workspace. Run planning again before generating lessons.",
        { requiresReplan: true },
      );
    }
    if (
      stagedContext.sourceArtifactInventoryHash !==
      map.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "The selected source-artifact inventory changed while Learn was preparing its isolated workspace. Run planning again before generating lessons.",
        { requiresReplan: true },
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context: stagedContext,
      coveragePlan: map.coveragePlan,
      syllabusCoverage: map.syllabusCoverage,
      stage: "Staged generation preflight",
    });
    // The workspace was seeded from the previously committed contract. Compare
    // its independent receipt copy to the confirmed-map expectation before a
    // generation writer can overwrite either field. This makes deletion from
    // the map/coverage plan observable instead of laundering it into a fresh
    // receipt-free contract.
    const stagedPersistedSourceContext =
      sourceFormulaReviewFinalizationContextFromGarden(workspace.stagingGardenDir);
    const expectedRecoveryReceipt =
      sourceFormulaReviewFinalizationContext.syllabusCoverageEvidenceRecovery;
    const stagedRecoveryReceipt =
      stagedPersistedSourceContext?.syllabusCoverageEvidenceRecovery;
    if (!stagedPersistedSourceContext ||
        stagedPersistedSourceContext.syllabusCoverageEvidenceRecoveryHash !==
          sourceFormulaReviewFinalizationContext.syllabusCoverageEvidenceRecoveryHash ||
        (stagedRecoveryReceipt !== undefined) !==
          (expectedRecoveryReceipt !== undefined) ||
        (stagedRecoveryReceipt !== undefined &&
          JSON.stringify(stagedRecoveryReceipt) !==
            JSON.stringify(expectedRecoveryReceipt))) {
      throw new LearnPipelineConflictError(
        "The staged Learning Unit Contract syllabus evidence-recovery receipt does not match the confirmed Learning Map. Run planning again before generation.",
        { requiresReplan: true },
      );
    }
    context = stagedContext;
    disposeModelTracking = attachLearnJobModelTracking({
      client,
      jobId: job.id,
      gardenId,
      contentPath,
    });
  } catch (error) {
    if (workspace) {
      try {
        disposeLearnBuildWorkspace(workspace);
      } catch {
        // Workspace cleanup must not replace setup failure.
      }
    }
    const stillOwnSetupLease = (): boolean => {
      return confirmLearnLeaseForFailureCleanup(lease, job.id);
    };
    if (!stillOwnSetupLease()) {
      if (ownsLease) {
        try {
          lease.release();
        } catch {
          // Preserve setup failure.
        }
      }
      throw error;
    }
    try {
      if (isLearnCancellationWithoutMaskingFailure(job.id, error)) {
        try {
          const cleanup = await cleanupLearnArtifactsAfterCancel({
            gardenId,
            contentPath,
            jobId: job.id,
            lease,
          });
          try {
            updateLearnJob(job.id, {
              status: "cancelled",
              currentStep: "Cancelled; latest Learn changes rolled back",
            });
          } catch {
            // Preserve exact cancellation/provider identity.
          }
          try {
            discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
            removeRejectedAttemptAuditsAfterTerminalLifecycle(contentPath, gardenId);
            appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
              jobId: job.id,
              removedPathCount: cleanup.removedPaths.length,
              restoredPathCount: cleanup.restoredPaths.length,
              deletedMaps: cleanup.deletedMaps,
              deletedVersions: cleanup.deletedVersions,
            });
          } catch {
            // Cancellation cleanup/telemetry is best-effort.
          }
        } catch {
          // The cancel endpoint/recovery can retry cleanup.
        }
        throw error;
      }
      let message = "Generation workspace could not be prepared";
      let requiresReplan = false;
      try {
        message = errorMessage(error, message);
        requiresReplan = learnFailureRequiresReplan(error);
      } catch {
        // Formatting/classification is best-effort.
      }
      try {
        appendLearnEvent(contentPath, gardenId, "learn_failed", {
          jobId: job.id,
          error: message,
          requiresReplan,
        });
      } catch {
        // Preserve exact setup failure.
      }
      try {
        updateLearnJob(job.id, {
          status: "failed",
          currentStep: "Generation could not start",
          error: message,
          requiresReplan,
        });
      } catch {
        // Preserve exact setup failure.
      }
      throw error;
    } finally {
      if (ownsLease) {
        try {
          lease.release();
        } catch {
          // Lease cleanup must not replace setup failure.
        }
      }
    }
  }
  const artifactContentPath = workspace.workspaceRoot;
  const clusterDir = workspace.stagingGardenDir;
  let previousPromotedGardenDir: string | undefined;
  let promotionCommitted = false;
  let retainWorkspaceAfterFailure = false;
  let retainedWorkspaceFailureStage = "Lesson generation failed";
  // Built once from the confirmed map's own availability check, so every page in
  // this run is judged against the same answer planning used. Empty when there
  // is no syllabus or nothing it assigns is missing, in which case the gate
  // costs nothing and never fires.
  const missingCitationProbes: UnavailableCitationProbe[] = unavailableCitationProbes(
    map.syllabusCoverage ?? null,
  );
  const unavailableCitationGate = missingCitationProbes.length
    ? { detect: (prose: string) => detectUnavailableCitations(prose, missingCitationProbes) }
    : undefined;
  let confirmedLearningUnits: LearningUnitContract[] = [];
  let confirmedSourceQuestions: SourceQuestionPlan[] = [];
  let confirmedSourceArtifactAssignments: SourceArtifactAssignment[] = [];
  let confirmedSourceArtifactOmissions: SourceArtifactOmission[] = [];
  // Version ids are learning_* so nothing named "textbook" can leak into a
  // visible file name, event, or frontmatter value.
  const textbookVersionId = makeId("learning");
  const backupDir = `.breadboard/backups/${textbookVersionId}`;
  const generatedAt = nowIso();
  const generatedPages: GeneratedPageRecord[] = [];
  const preservedPublishedPagePaths = new Set<string>();
  const unusedFigureReasons = new Map<string, string>();
  // Stage 3 bookkeeping: which SourceVisual landed on which page.
  const visualAssignments = new Map<string, { pageId: string; sectionId?: string }>();
  const claimedVisualIds = new Set<string>();
  let visualizationPlan: VisualizationPlan | null = null;
  const visualizationOutcomes: VisualizationPublicationOutcome[] = [];

  try {
    confirmedLearningUnits = learningUnitsFromCoveragePlan(map.coveragePlan);
    confirmedSourceQuestions = projectSourceQuestions(map.sourceMap);
    confirmedSourceArtifactAssignments = sourceArtifactAssignmentsFromCoveragePlan(map.coveragePlan);
    confirmedSourceArtifactOmissions = sourceArtifactOmissionsFromCoveragePlan(map.coveragePlan);
    const storedSyllabusAssignmentProblems = syllabusUnitAssignmentProblems(
      confirmedLearningUnits,
      map.syllabusCoverage ?? null,
    );
    if (storedSyllabusAssignmentProblems.length > 0) {
      throw new LearnPipelineConflictError(
        `The confirmed Learning Unit Contract needs model replanning before generation: ${storedSyllabusAssignmentProblems.join("; ")}`,
        { requiresReplan: true },
      );
    }
    const storedSourceQuestionProblems = sourceQuestionAssignmentProblems(
      confirmedLearningUnits,
      confirmedSourceQuestions,
    );
    if (storedSourceQuestionProblems.length > 0) {
      throw new LearnPipelineConflictError(
        `The confirmed Learning Unit Contract needs source-question replanning before generation: ${storedSourceQuestionProblems.join("; ")}`,
        { requiresReplan: true },
      );
    }
    appendLearnEvent(contentPath, gardenId, "learn_generation_started", {
      jobId: job.id,
      textbookVersionId,
      learningMapId: map.id,
      sourceIds: context.sources.map((source) => source.slug),
    });
    updateLearnJob(job.id, {
      status: "generating_learning_pages",
      currentStep: "Extracting source visuals",
      progressPercent: 2,
      confirmedLearningMapId: map.id,
      latestTextbookVersionId: textbookVersionId,
      sourceSetHash: context.sourceSetHash,
    });
    // Stage 2 FIRST (idempotent): the required production order is
    // extract → verify formula identities → plan assignments → persist
    // contract → write pages. Extraction therefore precedes the contract
    // write, so every source formula has a canonical identity BEFORE any
    // assignment is persisted.
    let ledgerVisuals = await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      deferEmptyVisualCheck: true,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    const referencedArtifactResolution = await ensureReferencedSourceArtifactsExtracted({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      units: confirmedLearningUnits,
      candidateArtifactIds: structuredArtifactIdsMentionedBySources(context),
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    ledgerVisuals = loadSourceVisuals(artifactContentPath, gardenId).filter((visual) =>
      context.sources.some((source) => source.slug === visual.sourceId),
    );
    ledgerVisuals = await ensureSourceVisualsExtracted({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    const generationFormulaReview = await reviewAndBindSourceFormulas({
      client,
      model,
      contentPath: artifactContentPath,
      gardenId,
      context,
      checkpoint: () => throwIfLearnCancelled(job.id),
      onProgress: (step) => updateLearnJob(job.id, { currentStep: step }),
    });
    ledgerVisuals = generationFormulaReview.visuals.filter((visual) =>
      context.sources.some((source) => source.slug === visual.sourceId),
    );
    appendLearnEvent(contentPath, gardenId, "learn_source_formulas_reviewed", {
      jobId: job.id,
      textbookVersionId,
      stage: "generation",
      reviewSetHash: generationFormulaReview.reviewedFormulaSetHash,
      formulaCount: generationFormulaReview.formulaIds.length,
      replacementCount: generationFormulaReview.replacementFormulaIds.length,
      newlyReplacedFormulaIds: generationFormulaReview.newlyReplacedFormulaIds,
      cacheHitCount: generationFormulaReview.cacheHitFormulaIds.length,
      modelCalls: generationFormulaReview.modelCalls,
    });
    const confirmedFormulaReviewSetHash = sourceFormulaReviewSetHashFromCoveragePlan(
      map.coveragePlan,
    );
    if (
      generationFormulaReview.newlyReplacedFormulaIds.length > 0 ||
      !confirmedFormulaReviewSetHash ||
      generationFormulaReview.reviewedFormulaSetHash !== confirmedFormulaReviewSetHash ||
      context.sourceSetHash !== map.sourceSetHash ||
      context.sourceArtifactInventoryHash !== map.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        `Source formula fidelity review or source-artifact extraction found evidence that is not bound to the confirmed Learning Map${
          generationFormulaReview.newlyReplacedFormulaIds.length > 0
            ? ` (new replacements: ${generationFormulaReview.newlyReplacedFormulaIds.join(", ")})`
            : ""
        }. No learner pages were written; run Learn planning again and confirm the fresh AI-authored map.`,
        { requiresReplan: true },
      );
    }
    if (
      JSON.stringify(generationFormulaReview.formulaIds) !==
        JSON.stringify(sourceFormulaReviewFinalizationContext.formulaIds) ||
      JSON.stringify(context.sources.map((source) => source.slug)) !==
        JSON.stringify(sourceFormulaReviewFinalizationContext.sourceIds) ||
      context.sourceArtifactInventoryHash !==
        sourceFormulaReviewFinalizationContext.sourceArtifactInventoryHash
    ) {
      throw new LearnPipelineConflictError(
        "Generation discovered a different source-formula/source identity/artifact inventory than the confirmed review context. No learner pages were written; replan first.",
        { requiresReplan: true },
      );
    }
    assertSyllabusCoverageRecoveryBinding({
      context,
      coveragePlan: map.coveragePlan,
      syllabusCoverage: map.syllabusCoverage,
      stage: "Post-extraction generation",
    });
    const sourceArtifactReconciliation = reconcileLearningUnitSourceArtifacts(
      confirmedLearningUnits,
      confirmedSourceArtifactAssignments,
      registeredArtifactsFromFigures(context.sourceFigures),
    );
    if (sourceArtifactReconciliation.removedArtifactIds.length > 0) {
      throw new LearnPipelineConflictError(
        `The confirmed model-authored contract references source artifacts that could not be registered after targeted extraction: ${sourceArtifactReconciliation.removedArtifactIds.join(", ")}. The contract was not rewritten; rerun planning so the model can repair it.`,
        { requiresReplan: true },
      );
    }
    if (!sameSourceArtifactAssignmentRecords(
      sourceArtifactReconciliation.assignments,
      confirmedSourceArtifactAssignments,
    )) {
      throw new LearnPipelineConflictError(
        "Source artifact registry reconciliation attempted to rewrite the model-authored assignment projection. Repair the contract instead.",
        { requiresReplan: true },
      );
    }
    const confirmedArtifactCoverageProblems = sourceArtifactCoverageProblems(
      confirmedLearningUnits,
      confirmedSourceArtifactOmissions,
      registeredArtifactsFromFigures(context.sourceFigures),
    );
    if (confirmedArtifactCoverageProblems.length > 0) {
      throw new LearnPipelineConflictError(
        `The confirmed model-authored artifact partition is invalid: ${confirmedArtifactCoverageProblems.join("; ")}. Rerun planning so the authoring model can repair it.`,
        { requiresReplan: true },
      );
    }
    appendLearnEvent(contentPath, gardenId, "learn_source_artifacts_reconciled", {
      jobId: job.id,
      textbookVersionId,
      stage: "generation",
      requestedIds: referencedArtifactResolution.requestedIds,
      unresolvedIds: referencedArtifactResolution.unresolvedIds,
      removedArtifactIds: sourceArtifactReconciliation.removedArtifactIds,
    });
    const selectedSourceIds = new Set(context.sources.map((source) => source.slug));
    verifyAuthoritativeSourceAnchorLedger(workspace);
    const selectedCanonicalSourceAnchors = Object.fromEntries(
      Object.entries(buildCanonicalSourceAnchors(clusterDir, { allowInferredFormulaText: false })).filter(([, anchor]) =>
        typeof anchor.sourceId === "string" && selectedSourceIds.has(anchor.sourceId),
      ),
    );
    const sourceFormulaIdentityById = new Map(
      Object.values(selectedCanonicalSourceAnchors)
        .filter((anchor) => anchor.kind === "formula" && Boolean(anchor.exactText?.trim()))
        .map((anchor) => [anchor.id, anchor]),
    );
    // Formula ownership and placement remain exactly as authored in the
    // confirmed contract. This gate verifies only that each claimed identity
    // exists in the canonical source registry.
    for (const unit of confirmedLearningUnits) {
      for (const formula of unit.sourceFormulas) {
        if (!sourceFormulaIdentityById.has(formula.id)) {
          throw new LearnPipelineConflictError(
            `Model-authored formula assignment ${formula.id} on ${unit.id} has no canonical source record. Repair the learning-unit contract.`,
            { requiresReplan: true },
          );
        }
      }
    }
    // Visual necessity, routing, and executability are all part of the map the
    // user confirmed. Rehydrate that exact bundle only after the independent
    // source/formula gates above have proven that its bindings still hold.
    const confirmedCanonicalVisualEvidence = canonicalVisualizationEvidenceByUnit(
      clusterDir,
      confirmedLearningUnits,
    );
    const confirmedVisualRouteBundle = confirmedVisualRouteBundleForGeneration({
      gardenId,
      map,
      context,
      learningUnits: confirmedLearningUnits,
      canonicalEvidenceByUnit: confirmedCanonicalVisualEvidence,
    });
    const generationVisualNecessityReview = confirmedVisualRouteBundle.visualNecessityReview;
    const generationExecutabilityLedger = confirmedVisualRouteBundle.executabilityLedger;
    // Preserve the actual planning review context. Relabelling it as a fresh
    // generation model review would fabricate provenance the model never saw.
    const generationExecutabilityContext: VisualContractExecutabilityLedgerContext =
      generationExecutabilityLedger.context;
    visualizationPlan = confirmedVisualRouteBundle.visualizationPlan;
    verifyAuthoritativeSourceAnchorLedger(workspace);
    // The writer may reconcile source/formula registry integrity, but it can
    // never replace the confirmed visual pedagogy or route allocation.
    const contractWrite = writeLearningUnitContractArtifacts({
      clusterDir,
      units: confirmedLearningUnits,
      assignments: confirmedSourceArtifactAssignments,
      omissions: confirmedSourceArtifactOmissions,
      registeredArtifacts: registeredArtifactsFromFigures(context.sourceFigures),
      sourceSetHash: context.sourceSetHash,
      sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
      sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
      syllabusCoverageEvidenceRecovery: map.syllabusCoverage?.evidenceRecovery,
      visualNecessityReview: generationVisualNecessityReview,
    });
    confirmedLearningUnits = contractWrite.units;
    confirmedSourceArtifactAssignments = contractWrite.assignments;
    confirmedSourceArtifactOmissions = contractWrite.omissions;
    if (
      learningUnitContractBindingSha256(confirmedLearningUnits) !==
      confirmedVisualRouteBundle.binding.learningUnitContractSha256
    ) {
      throw new LearnPipelineConflictError(
        "Generation would alter the confirmed Learning Unit Contract after visual routing. Run Learn planning again and confirm a new map.",
        { requiresReplan: true },
      );
    }
    let repairedCoveragePlan = {
      ...planningRecord(map.coveragePlan),
      learningUnitContracts: confirmedLearningUnits,
      sourceArtifactAssignments: confirmedSourceArtifactAssignments,
      sourceArtifactOmissions: confirmedSourceArtifactOmissions,
    };
    let repairedLearningMap = learningMapWithConfirmedUnitContracts(
      map.learningMap,
      confirmedLearningUnits,
    );
    map = {
      ...map,
      coveragePlan: repairedCoveragePlan,
      learningMap: repairedLearningMap,
      proposedOrder: repairedLearningMap.sections,
    };
    persistRoutedVisualPlans(clusterDir, confirmedLearningUnits);
    repairedCoveragePlan = {
      ...repairedCoveragePlan,
      learningUnitContracts: confirmedLearningUnits,
      sourceArtifactAssignments: confirmedSourceArtifactAssignments,
    };
    repairedLearningMap = learningMapWithConfirmedUnitContracts(
      repairedLearningMap,
      confirmedLearningUnits,
    );
    map = {
      ...map,
      coveragePlan: repairedCoveragePlan,
      learningMap: repairedLearningMap,
      proposedOrder: repairedLearningMap.sections,
    };
    saveVisualizationPlan(clusterDir, visualizationPlan);
    saveVisualContractExecutabilityLedger({
      gardenDir: clusterDir,
      ledger: generationExecutabilityLedger,
    });
    const rehydratedArtifactProvenanceProblems =
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: clusterDir,
        gardenId,
        ledger: generationExecutabilityLedger,
        finalLearningUnits: confirmedLearningUnits,
      });
    if (rehydratedArtifactProvenanceProblems.length > 0) {
      throw new LearnPipelineConflictError(
        `The confirmed visual route bundle could not be rehydrated exactly: ${rehydratedArtifactProvenanceProblems.join("; ")}. Run Learn planning again and confirm a new map.`,
        { requiresReplan: true },
      );
    }
    appendLearnEvent(contentPath, gardenId, "visual_route_plan_rehydrated", {
      jobId: job.id,
      textbookVersionId,
      learningMapId: map.id,
      phase: "generation",
      provenance: "confirmed_map",
      planningJobId: generationExecutabilityLedger.context.jobId,
      planningModel: generationExecutabilityLedger.context.model,
      visualRouteBindingHash: confirmedVisualRouteBindingHash(
        confirmedVisualRouteBundle.binding,
      ),
      visualizationPlanSha256: confirmedVisualRouteBundle.binding.visualizationPlanSha256,
      visualContractExecutabilityLedgerSha256:
        confirmedVisualRouteBundle.binding.visualContractExecutabilityLedgerSha256,
    });
    appendLearnEvent(contentPath, gardenId, "visual_contract_executability_ledger_persisted", {
      jobId: job.id,
      textbookVersionId,
      path: VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH,
      modelCalls: 0,
      replacedUnitIds: [],
      phase: "generation",
      provenance: "confirmed_map_rehydrated",
      ledgerContextPhase: generationExecutabilityLedger.context.phase,
      visualRouteBindingHash: confirmedVisualRouteBindingHash(
        confirmedVisualRouteBundle.binding,
      ),
    });
    for (const decision of visualizationPlan.decisions) {
      if (decision.route === "intentional_omission") {
        visualizationOutcomes.push({
          opportunityId: decision.opportunityId,
          status: "intentional_omission",
          reason: decision.reason,
        });
      }
    }
    if (contractWrite.semanticAliasRepairs.length > 0) {
      appendLearnEvent(contentPath, gardenId, "learn_concept_aliases_reconciled", {
        jobId: job.id,
        learningMapId: map.id,
        repairs: contractWrite.semanticAliasRepairs,
      });
    }
    // Strict pre-write gate (unchanged): every formula that can reach a
    // learner page must have a verified identity and must match its contract
    // unit. After the assignment plan this is a pure backstop; it stops the
    // run before page frontmatter is created if anything slipped through.
    for (const unit of confirmedLearningUnits) {
      for (const formula of unit.sourceFormulas) {
        const identity = sourceFormulaIdentityById.get(formula.id);
        if (!identity) throw new Error(`Formula pre-write guard: ${formula.id} has no canonical source record.`);
      }
    }
    await learnCheckpoint(job.id);
    updateLearnJob(job.id, {
      status: "generating_learning_pages",
      currentStep: "Writing overview pages",
      progressPercent: 3,
    });

    const overviewOutcome = await runValidatedTextRepairLoop<string>({
      maxAttempts: 3,
      emptyResponseMessage: "The overview model returned an empty response; no repair request was issued.",
      request: async ({ attempt, previousMarkdown, failedProblems }) => {
        await learnCheckpoint(job.id);
        const overviewCall = await callCouncilText({
          client,
          model,
          taskType: "source_synthesis",
          gardenId,
          pageId: "learning/Topic Overview",
          system: withLearnUserInstructionRules(
            OVERVIEW_PROMPT,
            effectiveUserInstruction,
          ),
          user: compactJson({
            task: attempt === 1 ? "write_topic_overview" : "repair_topic_overview",
            userInstruction: effectiveUserInstruction,
            learningMap: map.learningMap,
            scopeContract: map.scopeContract,
            sourceOnly,
            ...(attempt > 1
              ? {
                  previousMarkdown,
                  failedProblems,
                  instruction: "Return a complete corrected Markdown body. Do not explain the repair.",
                }
              : {}),
          }),
          sourceContext: {
            gardenId,
            pageId: "learning/Topic Overview",
            taskType: attempt === 1 ? "source_synthesis" : "source_synthesis_repair",
            sourceIds: context.sources.map((source) => source.slug),
            repairAttempt: attempt - 1,
          },
          councilModeOverride: LEARN_GENERATION_COUNCIL_MODE,
          ordinaryCheckpoint: {
            jobId: job.id,
            contentPath,
            stageKey: "generation:topic_overview",
            stageLabel: "topic overview",
            semanticAttempt: attempt - 1,
          },
        });
        return overviewCall.content;
      },
      validate: (markdown) => validateTopicOverview(markdown, map.learningMap),
      onReviewed: ({ attempt, problems }) => {
        appendLearnEvent(contentPath, gardenId, "learn_overview_reviewed", {
          jobId: job.id,
          attempt,
          problems,
        });
      },
    });
    const overviewBody = overviewOutcome.markdown;
    if (!overviewBody) {
      throw new Error(
        `The AI-authored Topic Overview remained invalid after 3 bounded attempts: ${overviewOutcome.problems.join("; ")}. No fallback overview was written.`,
      );
    }
    await learnCheckpoint(job.id);

    // Learner-facing planning pages live in learning/. Everything else is
    // internal and is written under .breadboard/planning/ so it never appears
    // in the published garden or the knowledge graph.
    const learningRelPaths = [
      {
        relPath: `${LEARNING_ROOT}/_index.md`,
        title: map.learningMap.title,
        type: "learning-index",
        body: renderLearningIndexMarkdown(map.learningMap),
      },
      {
        relPath: `${LEARNING_ROOT}/Topic Overview.md`,
        title: "Topic Overview",
        type: "topic-overview",
        body: overviewBody,
      },
      {
        relPath: `${LEARNING_ROOT}/Learning Map.md`,
        title: "Learning Map",
        type: "learning-map",
        body: renderLearningMapMarkdown(map.learningMap),
      },
    ];
    const internalPlanningPages = [
      {
        relPath: ".breadboard/planning/Source Map.md",
        title: "Source Map",
        type: "source-map",
        body: sourceMapMarkdown(map.sourceMap, context),
      },
      {
        relPath: ".breadboard/planning/Scope Contract.md",
        title: "Scope Contract",
        type: "scope-contract",
        body: scopeContractMarkdown(map.scopeContract),
      },
    ];

    for (const page of learningRelPaths) {
      await learnCheckpoint(job.id);
      writeMarkdownWithBackup({
        clusterDir,
        relPath: page.relPath,
        textbookVersionId,
        content:
          learningPageFrontmatter(
            page.title,
            page.type,
            gardenId,
            textbookVersionId,
            context.sourceSetHash,
          ) + page.body,
      });
    }
    for (const page of internalPlanningPages) {
      await learnCheckpoint(job.id);
      writeMarkdownWithBackup({
        clusterDir,
        relPath: page.relPath,
        textbookVersionId,
        content:
          learningPageFrontmatter(
            page.title,
            page.type,
            gardenId,
            textbookVersionId,
            context.sourceSetHash,
          ) + page.body,
      });
    }

    const totalSubsections = map.learningMap.sections.reduce(
      (count, section) => count + section.subsections.length,
      0,
    );
    let completed = 0;

    for (let sectionIndex = 0; sectionIndex < map.learningMap.sections.length; sectionIndex += 1) {
      const section = map.learningMap.sections[sectionIndex];
      const sectionNumber = sectionIndex + 1;
      // Older stored maps may predate title sanitation — enforce it at render.
      const sectionTitle = section.title;
      const sectionFolder = learningSectionFolder(sectionNumber, sectionTitle);
      const sectionIndexRelPath = `${sectionFolder}/_index.md`;
      await learnCheckpoint(job.id);
      writeMarkdownWithBackup({
        clusterDir,
        relPath: sectionIndexRelPath,
        textbookVersionId,
        content:
          yamlFrontmatter({
            title: `${sectionNumber}. ${sectionTitle}`,
            date: generatedAt,
            knowledge_type: "learning-section",
            breadboardType: "learning_section",
            gardenId,
            generatedBy: "learn_button",
            generated_by: "learn_button",
            learningVersion: publicLearningVersionId(textbookVersionId),
            sourceSetHash: context.sourceSetHash,
          }) +
          `# ${sectionNumber}. ${sectionTitle}\n\n${section.purpose}\n`,
      });

      for (let subsectionIndex = 0; subsectionIndex < section.subsections.length; subsectionIndex += 1) {
        // Pause lands between whole pages, so a resumed run never restarts
        // half-written Markdown.
        await learnCheckpoint(job.id);
        const subsection = section.subsections[subsectionIndex];
        const subsectionNumber = subsectionIndex + 1;
        const subsectionTitle = subsection.title;
        const pageTitle = `${sectionNumber}.${subsectionNumber} ${subsectionTitle}`;
        const pageFileName = textbookPageFileName(sectionNumber, subsectionNumber, subsectionTitle);
        const pageRelPath = `${sectionFolder}/${pageFileName}`;
        const pageId = pageRelPath.replace(/\.md$/i, "");
        const anchors = subsection.sourceAnchors;
        // Stage 3: which extracted source visuals belong on this page.
        const assignedVisuals = assignSourceVisualsForSubsection({
          visuals: ledgerVisuals,
          subsection,
          section,
          claimed: claimedVisualIds,
          sourceArtifactAssignments: confirmedSourceArtifactAssignments,
        });
        const metricFormulaAnchorIds = (subsection.sourceFormulaContracts ?? []).map((formula) => formula.id);
        for (const anchorId of metricFormulaAnchorIds) {
          const identity = sourceFormulaIdentityById.get(anchorId);
          if (!identity) {
            throw new Error(`Formula pre-write guard: ${anchorId} cannot be resolved to a verified unit assignment.`);
          }
        }
        const sourceFigures = sourceFiguresFromVisuals(assignedVisuals);
        const pageSourceFormulaFigures = sourceFormulaFiguresForSubsection(context, subsection);
        const interactiveSourceFigures =
          metricFormulaAnchorIds.length > 0
            ? [
                ...sourceFigures,
                ...pageSourceFormulaFigures.filter(
                  (formula) => !sourceFigures.some((figure) => figure.figureId === formula.figureId),
                ),
              ]
            : sourceFigures;
        // Compact per-page packet: everything the model needs to write THIS
        // subsection, nothing else. The full source map / scope contract /
        // learning spine never ride into page prompts anymore.
        const pageDossier = buildPageDossier({
          gardenTitle: map.learningMap.title,
          sectionTitle,
          sectionPurpose: section.purpose,
          subsection,
          anchors,
          scopeContract: map.scopeContract,
          sources: context.sources,
          syllabus: context.syllabus,
          syllabusCoverage: map.syllabusCoverage,
          assignedVisuals,
          sourceQuestions: confirmedSourceQuestions,
          sourceArtifactAssignments: confirmedSourceArtifactAssignments,
          canonicalSourceAnchors: selectedCanonicalSourceAnchors,
          sourceOnly,
        });
        // sourceContext carries small routing metadata only during page
        // writing; the dossier lives in the user message.
        const pageSourceMeta = {
          gardenId,
          pageId,
          sourceIds: [...new Set(pageDossier.relevantSourceSnippets.map((s) => s.sourceId))],
          visualIds: pageDossier.assignedSourceVisuals.map((v) => v.sourceVisualId),
          sourceOnly,
        };

        appendLearnEvent(contentPath, gardenId, "learn_page_started", {
          jobId: job.id,
          textbookVersionId,
          pageId,
          sourceIds: context.sources.map((source) => source.slug),
        });
        updateLearnJob(job.id, {
          status: "generating_learning_pages",
          currentStep: "Writing lesson subsection",
          progressPercent: 10 + Math.floor((completed / Math.max(1, totalSubsections)) * 70),
          currentSectionTitle: sectionTitle,
          currentPageTitle: pageTitle,
        });

        if (includeSourceSnapshots) {
          snapshotSourceContext({
            clusterDir,
            textbookVersionId,
            pageId,
            sourceContext: { dossier: pageDossier, sourceContextMeta: pageSourceMeta },
          });
        }

        const assignedVisualUrls = assignedVisuals
          .map((visual) => sourceVisualEmbedUrl(visual))
          .filter((url): url is string => Boolean(url));
        const assignedVisualRequirements = assignedVisuals.map((visual) => {
          const url = sourceVisualEmbedUrl(visual);
          if (!url) {
            throw new Error(
              `Assigned source visual ${visual.sourceVisualId} has no embeddable crop; omit it with a reviewed disposition or repair extraction before generation.`,
            );
          }
          const figureContract = (subsection.sourceFigureContracts ?? []).find(
            (figure) => figure.id === visual.sourceVisualId,
          );
          const tableContract = (subsection.sourceTableContracts ?? []).find(
            (table) => table.id === visual.sourceVisualId,
          );
          const assignment = confirmedSourceArtifactAssignments.find(
            (candidate) => candidate.sourceArtifactId === visual.sourceVisualId,
          );
          const interpretationGoal = figureContract?.interpretationGoal ||
            (tableContract
              ? `${tableContract.teachingGoal}; explain ${tableContract.rowsOrColumnsToExplain.join(", ")}`
              : assignment?.requiredInterpretation ?? "");
          if (!interpretationGoal.trim()) {
            throw new Error(
              `Assigned source visual ${visual.sourceVisualId} has no model-authored interpretation goal.`,
            );
          }
          return {
            sourceVisualId: visual.sourceVisualId,
            url,
            interpretationGoal,
          };
        });

        // Stage 4: bounded model generation and repair. Code evaluates the
        // returned lesson but never rewrites its pedagogy, inserts a Q&A, adds
        // a formula, or places a source visual on the model's behalf.
        let pageBody: string | null = null;
        let subsectionRunId: string | undefined;
        let revisionRunId: string | undefined;
        let lastQuality: ReturnType<typeof assessLessonQuality> | null = null;
        let lastAttemptBody = "";

        // Additive Learn keeps the already-published prose for every stable
        // unit whenever it still satisfies the current source/contract gates.
        // Navigation numbers and frontmatter are rebuilt below, so the page can
        // move to the AI-selected position without rewriting its lesson body.
        const publishedPage = subsection.learningUnitId
          ? publishedPages.get(subsection.learningUnitId)
          : undefined;
        if (publishedPage?.body) {
          const publishedQuality = assessModelAuthoredLessonQuality(
            publishedPage.body,
            {
              assignedVisualUrls,
              assignedVisualRequirements,
              unavailableCitations: unavailableCitationGate,
              subsection,
              canonicalSourceAnchors: selectedCanonicalSourceAnchors,
              requiredSourceQuestions: pageDossier.requiredSourceQuestions,
            },
          );
          lastQuality = publishedQuality;
          lastAttemptBody = publishedPage.body;
          if (!publishedQuality.hardFail) {
            pageBody = publishedPage.body;
            preservedPublishedPagePaths.add(pageRelPath);
            appendLearnEvent(
              contentPath,
              gardenId,
              "learn_page_body_reused",
              {
                jobId: job.id,
                textbookVersionId,
                learningUnitId: subsection.learningUnitId,
                previousPath: publishedPage.relPath,
                mergedPath: pageRelPath,
              },
            );
          }
        }

        for (
          let attempt = 0;
          attempt < MAX_PAGE_ATTEMPTS && pageBody === null;
          attempt += 1
        ) {
          const failedProblemCodes = (lastQuality?.problems ?? [])
            .filter((problem) => problem.hard)
            .map((problem) => problem.code);
          if (
            attempt > 0 &&
            (!lastAttemptBody.trim() || failedProblemCodes.length === 0)
          ) {
            throw new Error(
              "Lesson repair cannot call the model without a nonempty rejected draft and concrete hard-quality problems.",
            );
          }
          const placeholderFailure = failedProblemCodes.some(
            (code) => code === "placeholder" || code === "empty-bullet-scaffold",
          );
          const retryNote =
            attempt === 0
              ? undefined
              : [
                  `This is retry ${attempt}. The previous draft failed hard quality checks (${failedProblemCodes.join(", ") || "unknown"}).`,
                  placeholderFailure
                    ? "The previous draft contained unfinished author-facing wording. Return a self-contained final lesson and silently check that every line teaches the concept rather than directing a future writer or commenting on the draft."
                    : "",
                  'Write a longer, deeper, fully-written lesson (at least 700 words) with a concrete example and a real Question./Answer. Teach the concept directly; never comment on "the paper" or "the source".',
                ]
                  .filter(Boolean)
                  .join(" ");

          let attemptBody: string | null = null;
          const generated = await callCouncilText({
              client,
              model,
              taskType: "subsection_generation",
              gardenId,
              pageId,
              system: withLearnUserInstructionRules(
                withSyllabusRules(
                  SUBSECTION_PROMPT,
                  SYLLABUS_PAGE_RULES,
                  Boolean(context.syllabus),
                ),
                effectiveUserInstruction,
              ),
              user: withVerbatimSourceFormulaCopySheet(
                compactJson({
                  task: "write_subsection",
                  userInstruction: effectiveUserInstruction,
                  dossier: pageDossier,
                  instructions: {
                    style: "flowing beginner-friendly textbook subsection",
                    sourceAware: true,
                    includeQuestions: true,
                    includeVisualsWhereRelevant: true,
                  },
                  ...(retryNote ? { retryNote } : {}),
                }),
                pageDossier.requiredSourceFormulas,
              ),
              sourceContext: { ...pageSourceMeta, taskType: "subsection_generation" },
              councilModeOverride: LEARN_GENERATION_COUNCIL_MODE,
              ordinaryCheckpoint: {
                jobId: job.id,
                contentPath,
                stageKey: `generation:page:${learnCouncilStageComponent(pageId)}:draft`,
                stageLabel: `lesson draft ${pageId}`,
                semanticAttempt: attempt,
              },
          });
          subsectionRunId = generated.councilRunId;
          attemptBody = modelTextCandidateOrThrow(
            generated.content,
            `Lesson "${pageTitle}" returned an empty model response; no repair request was issued.`,
          );

          let quality = assessModelAuthoredLessonQuality(attemptBody, {
            assignedVisualUrls,
            assignedVisualRequirements,
            unavailableCitations: unavailableCitationGate,
            subsection,
            canonicalSourceAnchors: selectedCanonicalSourceAnchors,
            requiredSourceQuestions: pageDossier.requiredSourceQuestions,
          });

          // Hard-fail-only repair: one focused call that fixes the listed
          // problems in place. Minor style issues never trigger a rewrite.
          if (quality.hardFail) {
            const hardQualityProblems = quality.problems.filter((problem) => problem.hard);
            const formulasNeedingRepair = sourceFormulasNeedingVerbatimRepair(
              pageDossier.requiredSourceFormulas,
              hardQualityProblems,
            );
            const repaired = await callCouncilText({
                client,
                model,
                taskType: "subsection_repair",
                gardenId,
                pageId,
                system: withLearnUserInstructionRules(
                  SUBSECTION_REPAIR_PROMPT,
                  effectiveUserInstruction,
                ),
                user: withVerbatimSourceFormulaCopySheet(
                  compactJson({
                  pageMarkdown: attemptBody,
                  userInstruction: effectiveUserInstruction,
                  failedProblems: hardQualityProblems
                    .map(formatModelAuthoredLessonQualityProblemForRepair),
                  dossier: pageDossier,
                  repairRules: [
                    "Fix only the listed hard failures.",
                    "Preserve correct existing content.",
                    ...(formulasNeedingRepair.length > 0
                      ? [
                          "For each missing source formula, the literal copy-sheet replacement overrides preserving the malformed draft math. Replace the variant; do not retain or duplicate it.",
                        ]
                      : []),
                    "Do not restart from scratch unless the page is unusable.",
                    "Keep the section flowing and beginner-friendly.",
                    "Turn every unfinished or author-facing line into a self-contained learner explanation; do not reproduce diagnostic wording.",
                    "Remove empty or ellipsis-only bullets instead of returning scaffold bullets.",
                    "Keep source-only constraints.",
                    "Keep assigned visuals embedded where relevant.",
                    ...(unavailableCitationGate
                      ? [
                          "If unavailable-citation is listed, the page wrote about a work this garden does not contain. Delete every sentence that names, summarizes, or draws on it, and re-teach that point from the dossier's own source snippets — or drop the point entirely. Never replace it with a rephrased version of the same claim.",
                        ]
                      : []),
                    "Return only the final markdown.",
                    ],
                  }),
                  formulasNeedingRepair,
                ),
                sourceContext: {
                  ...pageSourceMeta,
                  taskType: "subsection_repair",
                  failedProblemCount: quality.problems.length,
                },
                councilModeOverride: LEARN_REVISION_COUNCIL_MODE,
                ordinaryCheckpoint: {
                  jobId: job.id,
                  contentPath,
                  stageKey: `generation:page:${learnCouncilStageComponent(pageId)}:quality_repair`,
                  stageLabel: `lesson quality repair ${pageId}`,
                  semanticAttempt: attempt,
                },
            });
            revisionRunId = repaired.councilRunId ?? revisionRunId;
            const repairedBody = modelTextCandidateOrThrow(
              repaired.content,
              `Lesson "${pageTitle}" repair returned an empty model response; no further request was issued.`,
            );
            attemptBody = repairedBody;
            quality = assessModelAuthoredLessonQuality(attemptBody, {
              assignedVisualUrls,
              assignedVisualRequirements,
              unavailableCitations: unavailableCitationGate,
              subsection,
              canonicalSourceAnchors: selectedCanonicalSourceAnchors,
              requiredSourceQuestions: pageDossier.requiredSourceQuestions,
            });
          }
          lastQuality = quality;
          lastAttemptBody = attemptBody;
          if (!quality.hardFail) {
            pageBody = attemptBody;
            break;
          }
        }

        throwIfLearnCancelled(job.id);
        if (pageBody === null) {
          // Quarantine the last draft for a human to inspect, then fail the job.
          // No fallback learner page is ever written.
          try {
            const debugRelPath = `.breadboard/debug/failed-pages/${safeLearnFileSegment(pageId, "page").replace(/\s+/g, "-")}.md`;
            const debugContent = lastAttemptBody ?? "";
            writeMarkdownWithBackup({
              clusterDir,
              relPath: debugRelPath,
              textbookVersionId,
              content: `<!-- FAILED QUALITY GATES — NOT A LEARNER PAGE -->\n\n${debugContent}\n`,
            });
          } catch {
            // Debug quarantine is best-effort; failing the job is what matters.
          }
          throw new Error(
            `Lesson "${pageTitle}" failed quality gates after ${MAX_PAGE_ATTEMPTS} attempts (${(lastQuality?.problems ?? [])
              .filter((problem) => problem.hard)
              .map((problem) =>
                problem.evidence?.length
                  ? `${problem.message} [${problem.evidence.map((line) => JSON.stringify(line)).join(", ")}]`
                  : problem.message,
              )
              .join("; ") || "no usable draft produced"}). No fallback learner page was written.`,
          );
        }

        updateLearnJob(job.id, {
          status: "generating_visuals",
          currentStep: "Reconciling interactive visuals",
          currentSectionTitle: sectionTitle,
          currentPageTitle: pageTitle,
        });
        // Stage 6: validated, ID-consistent, plan-selected interactives only.
        const visualized = await reconcileInteractiveVisuals({
          client,
          model,
          contentPath: artifactContentPath,
          durableEventContentPath: contentPath,
          gardenId,
          jobId: job.id,
          textbookVersionId,
          pageId,
          pageRelPath,
          markdown: pageBody,
          subsection,
          sourceContext: pageDossier,
          sourceFigures: interactiveSourceFigures,
          visualizationPlan,
          visualizationOutcomes,
          reusePublishedVisualsFromRetainedWorkspace: Boolean(
            workspace.resumedFromJobId || mode === "update_sources",
          ),
        });
        pageBody = visualized.markdown;
        throwIfLearnCancelled(job.id);

        // Stage 7: public tags are the registry-backed union of primary and
        // supporting concepts. Readable claims remain in the claim store.
        const plannedConcepts = subsection.semanticConcepts ?? [];
        const primaryConcepts = plannedConcepts
          .filter((concept) => concept.role === "primary")
          .map((concept) => concept.slug);
        const supportingConcepts = plannedConcepts
          .filter((concept) => concept.role === "supporting")
          .map((concept) => concept.slug)
          .filter((slug) => !primaryConcepts.includes(slug));
        const zettelTags = [...new Set([...primaryConcepts, ...supportingConcepts])].slice(0, 5);
        const claimIds = (subsection.knowledgeClaims ?? []).map((claim) =>
          claimIdForPlan(subsection.learningUnitId ?? pageId, claim),
        );
        const assignedVisualIds = assignedVisuals.map((visual) => visual.sourceVisualId);
        const formulas = formulaGroundingEntries(
          subsection.sourceFormulaContracts ?? [],
          selectedCanonicalSourceAnchors,
        );
        for (const formula of formulas) {
          if (!formula.sourceAnchor) continue;
          if (!sourceFormulaIdentityById.has(formula.sourceAnchor)) {
            throw new Error(`Formula page pre-write guard: ${formula.sourceAnchor} has no verified unit identity.`);
          }
        }
        const finalContent =
          buildLearningPageFrontmatter({
            gardenId,
            sectionNumber,
            subsectionNumber,
            title: pageTitle,
            sourceAnchors: anchors,
            tags: zettelTags,
            primaryConcepts,
            supportingConcepts,
            claimIds,
            visualIds: visualized.visualIds,
            sourceVisualIds: assignedVisualIds,
            sourceFormulaAnchors: metricFormulaAnchorIds,
            formulas,
            learningUnitId: subsection.learningUnitId,
            learningUnitRole: subsection.learningUnitRole,
            learningVersionId: textbookVersionId,
            sourceSetHash: context.sourceSetHash,
            sourceFormulaReviewSetHash: context.sourceFormulaReviewSetHash,
            generatedAt,
          }) + `${pageBody.trim()}\n`;

        updateLearnJob(job.id, {
          status: "writing_quartz",
          currentStep: "Writing Quartz Markdown",
          currentSectionTitle: sectionTitle,
          currentPageTitle: pageTitle,
        });
        throwIfLearnCancelled(job.id);
        writeMarkdownWithBackup({
          clusterDir,
          relPath: pageRelPath,
          content: finalContent,
          textbookVersionId,
        });
        for (const visual of assignedVisuals) {
          visualAssignments.set(visual.sourceVisualId, {
            pageId,
            sectionId: sectionFolder,
          });
        }
        generatedPages.push({
          title: pageTitle,
          relPath: pageRelPath,
          learningUnitId: subsection.learningUnitId,
          sourceAnchors: anchors,
          visualIds: visualized.visualIds,
          sourceFigureIds: assignedVisualIds,
          sourceFormulaIds: metricFormulaAnchorIds,
          sourceTableIds: (subsection.sourceTableContracts ?? []).map((table) => table.id),
        });
        appendLearnEvent(contentPath, gardenId, "learn_page_written", {
          jobId: job.id,
          textbookVersionId,
          pageId,
          councilRunId: revisionRunId ?? subsectionRunId,
          sourceIds: context.sources.map((source) => source.slug),
        });
        completed += 1;
      }
    }

    // The contract owns claim semantics; once every final page path exists,
    // project those claims verbatim into the canonical store and require each
    // page's claimIds to match. No claim is derived from prose or zettel notes.
    const claimProjectionPages = generatedPages.map((page) => {
      if (!page.learningUnitId) {
        throw new Error(`Model-authored claim projection failed: ${page.relPath} has no learningUnitId.`);
      }
      return { learningUnitId: page.learningUnitId, relPath: page.relPath };
    });
    const claimProjection = projectModelAuthoredClaimsToStore({
      gardenDir: clusterDir,
      gardenId,
      sourceSetHash: context.sourceSetHash,
      units: confirmedLearningUnits,
      pages: claimProjectionPages,
    });
    appendLearnEvent(contentPath, gardenId, "learn_model_authored_claims_projected", {
      jobId: job.id,
      textbookVersionId,
      claimCount: claimProjection.claimCount,
      pageCount: claimProjection.pageCount,
      changedFiles: claimProjection.changedFiles,
    });

    // Stale-artifact cleanup: the visual index merges on every save, so IDs
    // from earlier runs linger. Rewrite it to exactly the interactive visuals
    // this run embedded, and delete orphan spec files, so the index never
    // advertises a visual no current page references.
    await learnCheckpoint(job.id);
    {
      const liveVisualIds = new Set(generatedPages.flatMap((page) => page.visualIds));
      const pruned = pruneVisualArtifacts(artifactContentPath, gardenId, liveVisualIds);
      if (pruned.removedFromIndex.length > 0 || pruned.removedSpecFiles.length > 0) {
        appendLearnEvent(contentPath, gardenId, "learn_visual_index_pruned", {
          jobId: job.id,
          textbookVersionId,
          removedFromIndex: pruned.removedFromIndex,
          removedSpecFiles: pruned.removedSpecFiles,
        });
      }
    }

    if (!visualizationPlan) throw new Error("Visualization plan was not initialized.");
    saveVisualizationPlan(clusterDir, visualizationPlan);
    const visualizationCoverage = buildVisualizationCoverageReport({
      plan: visualizationPlan,
      outcomes: visualizationOutcomes,
      gate: coverageGateMode(),
    });
    saveVisualizationCoverageReport(clusterDir, visualizationCoverage);
    appendLearnEvent(contentPath, gardenId, "visual_coverage_completed", {
      jobId: job.id,
      textbookVersionId,
      ...visualizationCoverage,
    });
    if (visualizationCoverage.trustedVisualsPublished + visualizationCoverage.generatedVisualsPublished === 0) {
      appendLearnEvent(contentPath, gardenId, "visual_zero_publish_warning", {
        jobId: job.id,
        textbookVersionId,
        opportunitiesDetected: visualizationCoverage.opportunitiesDetected,
        explanations: visualizationCoverage.explanations,
      });
    }
    if (visualizationCoverage.status === "fail") {
      throw new Error(
        `Visualization coverage gate failed: ${visualizationCoverage.explanations.join(" ") || "critical opportunities are uncovered"}`,
      );
    }

    // Stage 3 closeout: every extracted visual is either assigned to the page
    // that embedded it, taught from its canonical text identity, or omitted
    // with the planning model's exact reason. This is an exact projection of
    // the validated partition; closeout never authors a fallback rationale.
    const authoredArtifactDispositionReason = new Map<string, string>();
    for (const assignment of confirmedSourceArtifactAssignments) {
      authoredArtifactDispositionReason.set(
        assignment.sourceArtifactId,
        assignment.requiredInterpretation || assignment.reason,
      );
    }
    for (const omission of confirmedSourceArtifactOmissions) {
      authoredArtifactDispositionReason.set(omission.sourceArtifactId, omission.reason);
    }
    const finalLedger = recordSourceVisualAssignments(
      artifactContentPath,
      gardenId,
      visualAssignments,
      (visual) => authoredArtifactDispositionReason.get(visual.sourceVisualId) ?? "",
      {
        conceptAnchorIds: generatedPages.flatMap((page) => page.sourceFormulaIds),
        trackedArtifactIds: context.sourceFigures.map((figure) => figure.figureId),
      },
    );
    for (const visual of finalLedger) {
      if (visual.usageStatus === "intentionally_skipped" && visual.skipReason) {
        unusedFigureReasons.set(visual.sourceVisualId, visual.skipReason);
      }
    }

    await learnCheckpoint(job.id);
    writeMarkdownWithBackup({
      clusterDir,
      relPath: ".breadboard/planning/Source Coverage.md",
      textbookVersionId,
      content:
        learningPageFrontmatter(
          "Source Coverage",
          "source-coverage",
          gardenId,
          textbookVersionId,
          context.sourceSetHash,
        ) +
        sourceCoverageMarkdown({
          context,
          generatedPages,
          unusedFigureReasons,
          sourceArtifactAssignments: confirmedSourceArtifactAssignments,
        }),
    });

    updateLearnJob(job.id, {
      status: "building_navigation",
      currentStep: "Refreshing Quartz navigation",
      progressPercent: 95,
      currentSectionTitle: undefined,
      currentPageTitle: undefined,
    });
    await learnCheckpoint(job.id);
    refreshClusterIndex(artifactContentPath, gardenId, { migrateSources: false });

    updateLearnJob(job.id, {
      status: "building_navigation",
      currentStep: "Repairing semantic lesson issues",
      progressPercent: 96,
      currentSectionTitle: undefined,
      currentPageTitle: undefined,
    });
    await learnCheckpoint(job.id);
    // Learner-facing repair is model-only. Validation remains deterministic;
    // a rejected or unavailable model candidate leaves the blocker visible.
    const repairExecutorMode = "model" as const;
    // Stages 8a+8b (repair -> export finalize -> verify) run as a bounded
    // convergence loop instead of a single pass followed by a hard fail. Each
    // pass repairs the flagged pages with a model candidate, then validates
    // the on-disk tree exactly as Quartz
    // sees it, and verifies it. When the deterministic gate still finds
    // problems, ChatMock gets another focused pass: `collectUnitRepairRequests`
    // re-derives requests from exactly what still fails, and re-running the
    // repair loop also refreshes the repair-log so a page fixed by a later
    // deterministic pass is not blocked by a stale "unresolved" record. The
    // loop only gives up (and the terminal throw below fires) once ChatMock can
    // no longer make progress, so a healthy model self-heals gate failures
    // rather than ending generation on the first attempt.

    // Stage 7a (structural generation freeze): a Learn run must own exactly ONE
    // active generation before any semantic reconciliation. If a previous
    // generation's learner tree is still on disk (in-place generation left the
    // old pages behind), it now coexists with this run's pages — producing
    // duplicate unit mappings, obsolete unknown-unit pages (e.g. a dropped U24),
    // and stale-claim/tag cascades that the finalizer would otherwise surface as
    // a terminal "failed critical validation". This deterministic pass keeps the
    // pages whose embedded learningVersionId is THIS run's version and quarantines
    // every page from any other generation (and any page whose unit is not in the
    // current contract) out of the active tree, then removes emptied section
    // folders. It never consults modification time and never calls ChatMock; with
    // a single generation present it is a no-op.
    try {
      const generationFreeze = freezeActiveGenerationByVersion(clusterDir, confirmedLearningUnits, {
        currentVersion: publicLearningVersionId(textbookVersionId),
      });
      if (generationFreeze.changed) {
        appendLearnEvent(contentPath, gardenId, "learn_generation_freeze_completed", {
          jobId: job.id,
          textbookVersionId,
          currentVersion: generationFreeze.currentVersion,
          versionsSeen: generationFreeze.versionsSeen,
          pagesKept: generationFreeze.pagesKept.length,
          pagesQuarantined: generationFreeze.pagesQuarantined.length,
          staleSectionsRemoved: generationFreeze.staleSectionsRemoved,
          reason: generationFreeze.reason,
        });
      }
    } catch (freezeError) {
      appendLearnEvent(contentPath, gardenId, "learn_generation_freeze_skipped", {
        jobId: job.id,
        reason: freezeError instanceof Error ? freezeError.message : String(freezeError),
      });
    }

    // Canonical build-state migration is opt-in and diagnostic. Both `shadow`
    // and the reserved `canonical` value keep the legacy pipeline authoritative
    // in this phase: canonical state is imported, repaired in memory, rendered
    // outside the live garden, and parity diagnostics are written under
    // .breadboard/canonical-shadow. It never publishes or changes learner files.
    const buildStateMode = learnBuildStateMode();
    if (buildStateMode !== "legacy") {
      try {
        const shadow = await runCanonicalGardenShadowBuild(clusterDir, gardenId, {
          enableModelRepairs: false,
          writeDiagnostics: true,
        });
        appendLearnEvent(contentPath, gardenId, "learn_canonical_shadow_completed", {
          jobId: job.id,
          textbookVersionId,
          requestedMode: buildStateMode,
          buildId: shadow.repairedState.buildId,
          importedIssueCount: shadow.importIssues.length,
          typedAtSourceIssueCount: shadow.issueMetrics.typedAtSource,
          legacyAdapterIssueCount: shadow.issueMetrics.producedByLegacyAdapter,
          canonicalBlockerCount: shadow.finalIssues.filter((issue) => issue.severity === "blocking").length,
          canonicalWarningCount: shadow.finalIssues.filter((issue) => issue.severity !== "blocking").length,
          transactionCount: shadow.transactions.length,
          canonicalDeterministicRepairs: shadow.deterministicRepairCount,
          canonicalVerifiedModelRepairs: shadow.verifiedModelRepairCount,
          projectionIssueCount: shadow.projection?.issues.length ?? 0,
          semanticParityDifferenceCount: shadow.parity.semanticParityDifferenceCount,
          unexpectedRegressionCount: shadow.parity.unexpectedRegressionCount,
          acceptanceDisagreement: shadow.parity.acceptanceDisagreement,
          acceptedSnapshotCreated: Boolean(shadow.snapshot),
          stoppedReason: shadow.stoppedReason,
        });
      } catch (shadowError) {
        appendLearnEvent(contentPath, gardenId, "learn_canonical_shadow_failed", {
          jobId: job.id,
          textbookVersionId,
          requestedMode: buildStateMode,
          diagnosticOnly: true,
          reason: shadowError instanceof Error ? shadowError.message : String(shadowError),
        });
      }
    }

    // Final repair is an L3 local-write loop: let repair continue while the
    // meaningful garden state is changing, but bound it by both rounds and
    // wall-clock time. Reports, logs, and events are excluded from the audit
    // fingerprint, so bookkeeping churn cannot masquerade as repair progress.
    const finalizeLoopStartedAt = Date.now();
    const seenFailedStates = new Set<string>();
    let repairRun!: Awaited<ReturnType<typeof repairLearningUnitsFromContract>>;
    let finalizeReport!: ReturnType<typeof finalizeGardenExport>;
    let verification!: ReturnType<typeof verifyFinalArtifactNoMutation>;
    let passesUsed = 0;
    let lastStateFingerprint: string | undefined;
    let lastBlockerFingerprint: string | undefined;
    let finalizationStopReason: "passed" | "no_progress" | "max_rounds" | "max_runtime" = "max_rounds";
    for (let pass = 1; pass <= LEARN_FINALIZE_MAX_ROUNDS; pass += 1) {
      // Cancellation remains authoritative even when the retry budget has also
      // expired. A started pass is allowed to reach verification; the runtime
      // cap prevents starting another potentially expensive repair pass.
      throwIfLearnCancelled(job.id);
      if (pass > 1) {
        if (Date.now() - finalizeLoopStartedAt >= LEARN_FINALIZE_MAX_RUNTIME_MS) {
          finalizationStopReason = "max_runtime";
          break;
        }
        updateLearnJob(job.id, {
          status: "building_navigation",
          currentStep: `Repairing remaining lesson issues (pass ${pass})`,
          progressPercent: 96,
          currentSectionTitle: undefined,
          currentPageTitle: undefined,
        });
      }
      passesUsed = pass;
      repairRun = await repairLearningUnitsFromContract({
        gardenDir: clusterDir,
        gardenSlug: gardenId,
        repairExecutor: repairExecutorMode,
        preserveModelAuthoredVisuals: true,
        preserveModelAuthoredContent: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
        // Repair is model-only: there is no deterministic executor to fall back
        // to, so the repair pass always carries a live model executor.
        modelRepair: createOpenAIRepairExecutor({
          client,
          model,
          gardenId,
          timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
          sourceTextForRequest: (request) => exactCanonicalRepairSourceText(clusterDir, request),
        }),
      });
      appendLearnEvent(contentPath, gardenId, "learn_semantic_repair_completed", {
        jobId: job.id,
        textbookVersionId,
        pass,
        repairExecutorMode,
        requestCount: repairRun.requests.length,
        repairCount: repairRun.repairs.length,
        modelRepairCount: repairRun.repairs.filter((entry) => entry.executorUsed === "model").length,
        unresolvedCount: repairRun.repairs.filter((entry) => entry.result === "unresolved").length,
        changedFiles: repairRun.changedFiles,
      });

      // Validation-only export finalize + hard gate. Structural paths and
      // projections may be normalized, but learner content remains model-owned.
      throwIfLearnCancelled(job.id);
      finalizeReport = finalizeGardenExport({
        gardenDir: clusterDir,
        gardenSlug: gardenId,
        preserveModelAuthoredContent: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
      });
      appendLearnEvent(contentPath, gardenId, "learn_export_finalized", {
        jobId: job.id,
        textbookVersionId,
        pass,
        removed: finalizeReport.removed,
        changedCount: finalizeReport.changed.length,
        criticalProblems: finalizeReport.criticalProblems,
        warnings: finalizeReport.warnings,
      });
      verification = verifyFinalArtifactNoMutation({
        gardenDir: clusterDir,
        gardenSlug: gardenId,
        strictModelApprovedVisuals: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
      });
      appendLearnEvent(contentPath, gardenId, "learn_final_artifact_verified", {
        jobId: job.id,
        textbookVersionId,
        pass,
        accepted: verification.accepted,
        mutatedFiles: verification.mutatedFiles,
        validationFailures: verification.validationFailures,
        unresolvedRepairFailures: verification.unresolvedRepairFailures,
      });

      const audit = auditGardenForFinalization(clusterDir, gardenId, {
        strictModelApprovedVisuals: true,
        expectedVisualContractExecutabilityContext: generationExecutabilityContext,
        expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
      });
      lastStateFingerprint = audit.stateFingerprint;
      if (finalizeReport.criticalProblems.length === 0 && verification.accepted) {
        finalizationStopReason = "passed";
        break;
      }

      const blockerSignature = JSON.stringify(
        [...new Set([
          ...finalizeReport.criticalProblems,
          ...verification.validationFailures,
          ...verification.unresolvedRepairFailures,
          ...verification.mutatedFiles.map((file) => `mutated during verification: ${file}`),
        ].map((problem) => problem.trim()).filter(Boolean))].sort(),
      );
      const blockerFingerprint = createHash("sha256").update(blockerSignature).digest("hex");
      lastBlockerFingerprint = blockerFingerprint;
      const failedStateKey = `${blockerFingerprint}:${audit.stateFingerprint}`;

      // Retry when either the blockers or meaningful on-disk state changed.
      // Repeating the same pair proves a fixed point (or a cycle returning to
      // one), so another model call would only spend tokens without progress.
      if (seenFailedStates.has(failedStateKey)) {
        finalizationStopReason = "no_progress";
        break;
      }
      seenFailedStates.add(failedStateKey);

      if (Date.now() - finalizeLoopStartedAt >= LEARN_FINALIZE_MAX_RUNTIME_MS) {
        finalizationStopReason = "max_runtime";
        break;
      }
      if (pass >= LEARN_FINALIZE_MAX_ROUNDS) {
        finalizationStopReason = "max_rounds";
        break;
      }

      appendLearnEvent(contentPath, gardenId, "learn_finalization_retry_scheduled", {
        jobId: job.id,
        textbookVersionId,
        pass,
        nextPass: pass + 1,
        blockerFingerprint,
        stateFingerprint: audit.stateFingerprint,
        elapsedMs: Date.now() - finalizeLoopStartedAt,
      });
    }

    appendLearnEvent(
      contentPath,
      gardenId,
      finalizationStopReason === "passed"
        ? "learn_finalization_loop_completed"
        : "learn_finalization_loop_stopped",
      {
        jobId: job.id,
        textbookVersionId,
        stoppedReason: finalizationStopReason,
        passesUsed,
        maxRounds: LEARN_FINALIZE_MAX_ROUNDS,
        elapsedMs: Date.now() - finalizeLoopStartedAt,
        maxRuntimeMs: LEARN_FINALIZE_MAX_RUNTIME_MS,
        stateFingerprint: lastStateFingerprint,
        blockerFingerprint: lastBlockerFingerprint,
      },
    );

    // Surface incomplete source-formula extraction as a distinct, non-blocking
    // signal so the cause (usually the vision model being unavailable at
    // extraction time) is visible rather than silently publishing ungrounded
    // formulas. Re-running extraction with the vision model recovers them. The
    // full text is also written to .breadboard/validation-report.md under
    // "Non-blocking warnings".
    if (finalizeReport.warnings.length > 0) {
      appendLearnEvent(contentPath, gardenId, "learn_source_formula_extraction_incomplete", {
        jobId: job.id,
        textbookVersionId,
        warnings: finalizeReport.warnings,
      });
    }

    if (finalizeReport.criticalProblems.length > 0) {
      // Fix 6: when the blocker is unregistered source anchors, lead with the
      // clear, actionable explanation before the raw audit lines.
      const missingAnchors = missingRegistryAnchorIds(finalizeReport.criticalProblems);
      const anchorGuidance = missingAnchors.length > 0 ? `${describeMissingAnchorFailure(missingAnchors)}\n\n` : "";
      throw new Error(
        `${anchorGuidance}Export finalize failed critical validation for ${gardenId}: ${finalizeReport.criticalProblems.join("; ")}. ` +
          "The garden was not published. See .breadboard/validation-report.md and .breadboard/repair-report.md.",
      );
    }
    if (!verification.accepted) {
      throw new Error(
        `Export verification failed for ${gardenId}: ${
          [
            ...verification.validationFailures,
            ...verification.unresolvedRepairFailures,
            ...verification.mutatedFiles.map((file) => `mutated during verification: ${file}`),
          ].join("; ") || "final artifact was not accepted"
        }. The garden was not published. See .breadboard/validation-report.md and .breadboard/repair-report.md.`,
      );
    }

    // Stage 8c (end-stage semantic critic): ChatMock reviews the FINAL exported
    // state and drives targeted repair rounds. When enabled, critic acceptance
    // is a publication gate alongside deterministic validation; an unavailable
    // critic or unresolved blocker leaves the published garden untouched.
    try {
      if ((process.env.BREADBOARD_CRITIC_ENABLED ?? "true").trim() !== "false") {
        // Every end-stage model call uses the same durable Council receipt
        // boundary as lesson generation. A transport timeout first observes
        // and adopts the exact result; only an authoritative terminal receipt
        // may advance to one new semantic attempt with a changed request.
        const finalCriticProviders = createLearnFinalCriticProviders({
          execute: (request) => callCouncilText({
            client,
            model,
            taskType: request.taskType,
            gardenId,
            pageId: request.pageId,
            system: request.system,
            user: request.user,
            sourceContext: request.sourceContext,
            councilModeOverride: "direct_council",
            timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
            preserveExactContent: true,
            ordinaryCheckpoint: {
              jobId: job.id,
              contentPath,
              stageKey: request.stageKey,
              stageLabel: request.stageLabel,
              semanticAttempt: request.semanticAttempt,
            },
          }),
          maxSemanticAttempts: 2,
          onTerminalReceipt: ({
            kind,
            semanticAttempt,
            nextSemanticAttempt,
            receipt,
          }) => {
            appendLearnEvent(
              contentPath,
              gardenId,
              "learn_final_critic_terminal_receipt_retry",
              {
                jobId: job.id,
                kind,
                semanticAttempt,
                nextSemanticAttempt,
                proofKind: receipt.proofKind ?? "terminal_receipt",
                failureCode: receipt.failureCode,
                dispatchCount: receipt.dispatchCount,
                redispatchCount: receipt.redispatchCount,
                duplicateRequestSuppressed: true,
              },
            );
          },
        });
        // The model rewrites any flagged semantic content. Structural validators
        // re-audit the result without substituting heuristic lesson prose or a
        // canned visual contract for a rejected candidate.
        const criticLoop = await runCriticLoop({
          gardenDir: clusterDir,
          gardenSlug: gardenId,
          critic: finalCriticProviders.critic,
          // Low-confidence generated source anchors are sent to ChatMock to
          // confirm, replace, create a better anchor, or reject — inside the
          // same critic-loop rounds. Unresolved ones keep publishReady false.
          anchorConfirm: finalCriticProviders.anchorConfirm,
          repair: makeCriticArtifactRepair({
            modelRepair: finalCriticProviders.modelRepair,
            allowDeterministicRepairs: false,
            validateModelCandidate: (candidateDir, candidateGardenSlug) =>
              auditGardenForFinalization(candidateDir, candidateGardenSlug, {
                strictModelApprovedVisuals: true,
                expectedVisualContractExecutabilityContext:
                  generationExecutabilityContext,
                expectedSourceFormulaReviewContext:
                  sourceFormulaReviewFinalizationContext,
              }).passed,
          }),
          // Let the loop audit the live state so anchor resolution counts toward
          // publish-readiness. Deterministic critical failures already threw above.
          structuralFailure: false,
          // Fix 2: this is FINALIZATION on a migrated ledger — any legacy
          // text_concept record still unresolved keeps the garden out of
          // publish-ready, derived from the ledger (never a migration report).
          enforceLegacyFinalization: true,
        });
        appendLearnEvent(contentPath, gardenId, "learn_critic_loop_completed", {
          jobId: job.id,
          textbookVersionId,
          draftGenerated: criticLoop.status.draftGenerated,
          lifecycleStatus: criticLoop.status.lifecycleStatus,
          accepted: criticLoop.status.accepted,
          publishReady: criticLoop.status.publishReady,
          deterministicPass: criticLoop.status.deterministicPass,
          criticRequired: criticLoop.status.criticRequired,
          criticAvailabilityStatus: criticLoop.status.criticAvailabilityStatus,
          criticPass: criticLoop.status.criticPass,
          rounds: criticLoop.rounds.length,
          unresolvedBlocking: criticLoop.finalBlockingIssues.length,
          warnings: criticLoop.finalWarnings.length,
          reason: criticLoop.status.reason,
        });
        if (!criticLoop.status.publishReady || criticLoop.finalBlockingIssues.length > 0) {
          throw new Error(
            `Semantic critic did not approve publication: ${criticLoop.status.reason || `${criticLoop.finalBlockingIssues.length} blocking issue(s) remain`}.`,
          );
        }
      }
    } catch (criticError) {
      try {
        appendLearnEvent(contentPath, gardenId, "learn_critic_loop_failed", {
          jobId: job.id,
          reason: criticError instanceof Error ? criticError.message : String(criticError),
        });
      } catch {
        // Diagnostics must not replace the exact critic/provider failure.
      }
      throw criticError;
    }

    // Optional final prose pass. It deliberately runs after the whole learner
    // tree has been generated, finalized, verified, and approved by the critic
    // so no in-flight page or internal planning artifact is ever rewritten.
    // The helper captures every original, offers only learning/**/*.md to the
    // local humanizer, then restores the entire candidate unless the same hard
    // final-artifact verifier accepts it.
    const humanizerRun = await humanizeFinishedLearnBuild({
      userId,
      gardenDir: clusterDir,
      versionId: textbookVersionId,
      preserveFilePaths: [...preservedPublishedPagePaths].map((relPath) =>
        path.join(clusterDir, ...relPath.split("/")),
      ),
      checkCancelled: () => throwIfLearnCancelled(job.id),
      onStart: (fileCount) =>
        updateLearnJob(job.id, {
          status: "building_navigation",
          currentStep: `Rewriting ${fileCount} finished lesson${fileCount === 1 ? "" : "s"} naturally`,
          progressPercent: 98,
          currentSectionTitle: undefined,
          currentPageTitle: undefined,
        }),
      validate: () => {
        const finalCheck = verifyFinalArtifactNoMutation({
          gardenDir: clusterDir,
          gardenSlug: gardenId,
          strictModelApprovedVisuals: true,
          expectedVisualContractExecutabilityContext: generationExecutabilityContext,
          expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
        });
        return {
          accepted: finalCheck.accepted,
          problems: [
            ...finalCheck.validationFailures,
            ...finalCheck.unresolvedRepairFailures,
            ...finalCheck.mutatedFiles.map(
              (file) => `mutated during verification: ${file}`,
            ),
          ],
        };
      },
    });
    if (humanizerRun.requested) {
      appendLearnEvent(contentPath, gardenId, "learn_humanizer_completed", {
        jobId: job.id,
        textbookVersionId,
        adopted: humanizerRun.adopted,
        reason: humanizerRun.reason,
        filesConsidered: humanizerRun.filesConsidered,
        candidateFiles: humanizerRun.candidateFiles,
        adoptedFiles: humanizerRun.adoptedFiles,
        chunks: humanizerRun.chunks,
        validationProblems: humanizerRun.validationProblems,
      });
    }

    // The critic and optional humanizer run after the earlier finalizer. Refresh
    // the deterministic report and re-verify their final tree immediately before
    // promotion so the copied candidate cannot carry a stale state fingerprint.
    const prePublicationFinalizeReport = finalizeGardenExport({
      gardenDir: clusterDir,
      gardenSlug: gardenId,
      preserveModelAuthoredContent: true,
      expectedVisualContractExecutabilityContext: generationExecutabilityContext,
      expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
    });
    if (prePublicationFinalizeReport.criticalProblems.length > 0) {
      throw new Error(
        `Pre-publication export finalize failed for ${gardenId}: ${prePublicationFinalizeReport.criticalProblems.join("; ")}.`,
      );
    }
    const prePublicationVerification = verifyFinalArtifactNoMutation({
      gardenDir: clusterDir,
      gardenSlug: gardenId,
      updateRepairReport: false,
      strictModelApprovedVisuals: true,
      expectedVisualContractExecutabilityContext: generationExecutabilityContext,
      expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
    });
    if (!prePublicationVerification.accepted) {
      throw new Error(
        `Pre-publication verification failed for ${gardenId}: ${[
          ...prePublicationVerification.validationFailures,
          ...prePublicationVerification.unresolvedRepairFailures,
          ...prePublicationVerification.mutatedFiles.map(
            (file) => `mutated during verification: ${file}`,
          ),
        ].join("; ") || "final artifact was not accepted"}.`,
      );
    }

    throwIfLearnCancelled(job.id);
    mergeLearnEventLedgers(repositoryGardenDir, clusterDir);
    updateLearnJobExpectStatus(job.id, {
      status: "writing_quartz",
      currentStep: "Publishing validated garden",
      progressPercent: 99,
    });
    committingLearnJobs.add(job.id);
    const promotion = await promoteStagingGarden({
      stagingGardenDir: clusterDir,
      destinationGardenDir: repositoryGardenDir,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: job.id,
      verifyCurrentDestination: (destinationDir) =>
        lease.heartbeat() &&
        fingerprintDurableGardenState(destinationDir) === workspace!.durableInputFingerprint,
      prepareIncomingForCommit: (incomingDir, destinationDir) => {
        mergeLearnEventLedgers(destinationDir, incomingDir);
        return true;
      },
      verifyManifest: (candidateDir) =>
        verifyFinalArtifactNoMutation({
          gardenDir: candidateDir,
          gardenSlug: gardenId,
          updateRepairReport: false,
          strictModelApprovedVisuals: true,
          expectedVisualContractExecutabilityContext: generationExecutabilityContext,
          expectedSourceFormulaReviewContext: sourceFormulaReviewFinalizationContext,
        }).accepted,
    });
    previousPromotedGardenDir = promotion.previousPreservedAt;
    if (!promotion.promoted) {
      throw new LearnPipelineConflictError(
        `Validated Learn output was not published: ${promotion.reason}`,
      );
    }
    await publishQuartzAfterMutation(`learn textbook generation in ${gardenId}`, {
      requireSuccess: true,
      gardenSlug: gardenId,
    });
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn generation lost its garden lease after Quartz publication.",
      );
    }

    appendLearnEvent(contentPath, gardenId, "learn_generation_completed", {
      jobId: job.id,
      textbookVersionId,
      pageCount: generatedPages.length,
      sourceIds: context.sources.map((source) => source.slug),
    });
    const mapToCommit = map;
    const finalJob = db.transaction(() => {
      const mapUpdate = db.prepare(
        `UPDATE learn_maps
         SET coverage_plan_json = ?, learning_map_json = ?, proposed_order_json = ?
         WHERE id = ? AND garden_id = ? AND status = 'confirmed'
           AND source_set_hash = ? AND source_artifact_inventory_hash = ?`,
      ).run(
        jsonString(mapToCommit.coveragePlan),
        jsonString(mapToCommit.learningMap),
        jsonString(mapToCommit.proposedOrder),
        mapToCommit.id,
        gardenId,
        mapToCommit.sourceSetHash,
        mapToCommit.sourceArtifactInventoryHash,
      );
      if (mapUpdate.changes !== 1) {
        throw new LearnPipelineConflictError(
          "The confirmed Learning Map disappeared before generation could commit.",
        );
      }
      insertLearnVersion({
        id: textbookVersionId,
        gardenId,
        jobId: job.id,
        learningMapId: mapToCommit.id,
        sourceSetHash: context.sourceSetHash,
        sourceArtifactInventoryHash: context.sourceArtifactInventoryHash,
        pageCount: generatedPages.length + learningRelPaths.length + 1,
        backupDir,
      });
      return updateLearnJobExpectStatus(job.id, {
        status: "complete",
        currentStep: "Lessons complete",
        progressPercent: 100,
        confirmedLearningMapId: mapToCommit.id,
        latestTextbookVersionId: textbookVersionId,
        sourceSetHash: context.sourceSetHash,
      });
    })();
    // Filesystem publication, Quartz, and the SQLite version/job pair are now
    // committed. Everything after this point is best-effort garbage collection
    // and must never turn a successful run into a failed/rolled-back one.
    promotionCommitted = true;
    try {
      removeAllLearnVisualRejectedAttemptAudits(repositoryGardenDir);
    } catch (auditCleanupError) {
      console.warn(
        `[learn] Rejected-attempt audit cleanup remains pending for ${job.id}:`,
        auditCleanupError,
      );
    }
    if (previousPromotedGardenDir && lease.heartbeat()) {
      try {
        fs.rmSync(previousPromotedGardenDir, { recursive: true, force: true });
        previousPromotedGardenDir = undefined;
      } catch (cleanupError) {
        console.warn(
          `[learn] Previous published garden remains at ${previousPromotedGardenDir}:`,
          cleanupError,
        );
      }
    }
    return {
      job: finalJob,
      textbookVersionId,
      pageCount: generatedPages.length,
    };
  } catch (error) {
    const cancelledGeneration = isLearnCancellationWithoutMaskingFailure(
      job.id,
      error,
    );
    // Set this before any lease/rollback diagnostics. Even if failure cleanup
    // itself cannot proceed, the exact staged candidate must survive.
    retainWorkspaceAfterFailure = !cancelledGeneration;
    const stillOwnGenerationLease = (): boolean => {
      return confirmLearnLeaseForFailureCleanup(lease, job.id);
    };
    if (!stillOwnGenerationLease()) {
      throw error;
    }
    if (cancelledGeneration) {
      // The Stop button already flipped the job to cancelled; sweep any
      // partial Learn output that was written before the checkpoint fired.
      try {
        const cleanup = await cleanupLearnArtifactsAfterCancel({
          gardenId,
          contentPath,
          jobId: job.id,
          lease,
        });
        updateLearnJob(job.id, {
          status: "cancelled",
          currentStep: "Cancelled; latest Learn changes rolled back",
        });
        discardLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
        removeRejectedAttemptAuditsAfterTerminalLifecycle(contentPath, gardenId);
        appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
          jobId: job.id,
          removedPathCount: cleanup.removedPaths.length,
          restoredPathCount: cleanup.restoredPaths.length,
          deletedMaps: cleanup.deletedMaps,
          deletedVersions: cleanup.deletedVersions,
        });
      } catch {
        // Cleanup is best-effort during unwind; the cancel endpoint reports its
        // own cleanup errors when the user presses Stop.
      }
      throw error;
    }
    return rethrowAfterBestEffortLearnFailureCleanup(error, async () => {
      let restorePending = false;
      if (previousPromotedGardenDir && !promotionCommitted) {
        let restored = false;
        try {
          await restorePreviousPromotedGarden(
            repositoryGardenDir,
            previousPromotedGardenDir,
            stillOwnGenerationLease,
          );
          if (!stillOwnGenerationLease()) return;
          previousPromotedGardenDir = undefined;
          restored = true;
        } catch (restoreError) {
          restorePending = true;
          try {
            appendLearnEvent(contentPath, gardenId, "learn_publication_restore_failed", {
              jobId: job.id,
              error: errorMessage(restoreError, "Generation restore failed"),
            });
          } catch {
            // Restore diagnostics are subordinate to the generation failure.
          }
          try {
            updateLearnJob(job.id, {
              status: "writing_quartz",
              currentStep: "Filesystem restore pending retry",
              error: errorMessage(restoreError),
            });
          } catch {
            // Preserve the exact generation/provider error.
          }
        }
        if (restored && stillOwnGenerationLease()) {
          let publicationToken: string | undefined;
          try {
            publicationToken = queueLearnPublicationRetry(
              gardenId,
              "restored failed Learn generation",
              new Error("Publication pending"),
            );
          } catch {
            // Retry-ledger persistence is best-effort during unwind.
          }
          try {
            await publishQuartzAfterMutation(
              `rolled back failed Learn generation in ${gardenId}`,
              { requireSuccess: true, gardenSlug: gardenId },
            );
            if (publicationToken) {
              try {
                clearLearnPublicationRetry(gardenId, publicationToken);
              } catch {
                // Publication succeeded; stale retry-ledger cleanup is optional.
              }
            }
          } catch (republishError) {
            try {
              queueLearnPublicationRetry(
                gardenId,
                "restored failed Learn generation",
                republishError,
              );
            } catch {
              // Preserve the exact generation/provider error.
            }
            try {
              appendLearnEvent(contentPath, gardenId, "learn_publication_republish_queued", {
                jobId: job.id,
                error: errorMessage(republishError),
              });
            } catch {
              // Preserve the exact generation/provider error.
            }
          }
        }
      }
      if (!stillOwnGenerationLease()) return;
      let message = "Lesson generation failed";
      let requiresReplan = false;
      try {
        message = errorMessage(error, message);
        requiresReplan = learnFailureRequiresReplan(error);
      } catch {
        // Formatting/classification is optional diagnostic context.
      }
      let lastInternalStep = "";
      try {
        const failedJob = getLatestLearnJob(gardenId);
        lastInternalStep = failedJob?.id === job.id
          ? failedJob.currentStep.trim()
          : "";
        retainedWorkspaceFailureStage = lastInternalStep || retainedWorkspaceFailureStage;
      } catch {
        // The last-step annotation is optional diagnostic context.
      }
      try {
        appendLearnEvent(contentPath, gardenId, "learn_failed", {
          jobId: job.id,
          textbookVersionId,
          error: message,
          requiresReplan,
        });
      } catch {
        // Event persistence is best-effort during exact-error propagation.
      }
      try {
        const failedBeforeFirstCouncilDispatch =
          error instanceof LearnPlanningRecoveryConflictError &&
          !hasNativeLearnCouncilCheckpoint(db, job.id);
        updateLearnJob(job.id, {
          status: restorePending ? "writing_quartz" : "failed",
          currentStep: restorePending
            ? "Filesystem restore pending retry"
            : failedBeforeFirstCouncilDispatch
              ? LEARN_COUNCIL_PRE_DISPATCH_FAILURE_STEP
            : lastInternalStep
              ? `Lesson generation failed; last internal step: ${lastInternalStep}`
              : "Lesson generation failed",
          error: message,
          requiresReplan,
        });
      } catch {
        // Terminal status diagnostics must not replace the original failure.
      }
    });
  } finally {
    committingLearnJobs.delete(job.id);
    activeLearnCouncilDispatchAuthorities.delete(job.id);
    try {
      disposeModelTracking();
    } catch {
      // Tracking cleanup is subordinate to the operation result.
    }
    if (workspace) {
      if (!promotionCommitted && retainWorkspaceAfterFailure) {
        try {
          retainLearnBuildWorkspace(workspace, {
            reason: "generation_failure",
            failureStage: retainedWorkspaceFailureStage,
          });
          appendLearnEvent(contentPath, gardenId, "learn_failed_workspace_retained", {
            jobId: job.id,
            buildId: workspace.buildId,
            failureStage: retainedWorkspaceFailureStage,
          });
        } catch {
          // A descriptor update is diagnostic only. Most importantly, never
          // fall through to deletion after a non-cancelled generation failure.
        }
      } else {
        try {
          disposeLearnBuildWorkspace(workspace);
        } catch {
          // Finished/cancelled staging cleanup must not replace the outcome.
        }
      }
    }
    if (ownsLease) {
      try {
        lease.release();
      } catch {
        // Lease cleanup must not replace the operation result.
      }
    }
  }
}

export interface FullRebuildOptions {
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  includedSourceIds?: readonly string[];
  /** Slug of an uploaded document to use as the course study guide. */
  syllabusSourceId?: string | null;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  userInstruction?: string;
  /** Destructive confirmation. The literal true is required at runtime too. */
  forceFullRebuild: true;
}

function mergeLearnEventLedgers(repositoryGardenDir: string, stagingGardenDir: string): void {
  const relative = path.join(".breadboard", "events.jsonl");
  const livePath = path.join(repositoryGardenDir, relative);
  const stagingPath = path.join(stagingGardenDir, relative);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const eventPath of [livePath, stagingPath]) {
    let raw = "";
    try {
      raw = fs.readFileSync(eventPath, "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line || seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  if (lines.length === 0) return;
  fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
  fs.writeFileSync(stagingPath, `${lines.join("\n")}\n`, "utf-8");
}

async function restorePreviousPromotedGarden(
  destinationGardenDir: string,
  previousGardenDir?: string,
  ownsLease?: () => boolean,
): Promise<void> {
  const failedDir = path.join(
    path.dirname(destinationGardenDir),
    `.${path.basename(destinationGardenDir)}.failed-commit-${Date.now().toString(36)}`,
  );
  const retryRename = async (
    source: string,
    destination: string,
    requireOwnership = true,
  ): Promise<string | null> => {
    let lastError = "";
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      if (requireOwnership && ownsLease && !ownsLease()) {
        return "lost the fenced garden lease before filesystem restore";
      }
      try {
        fs.renameSync(source, destination);
        return null;
      } catch (error) {
        lastError = errorMessage(error);
        if (attempt < 6) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(1_500, 100 * 2 ** (attempt - 1))),
          );
        }
      }
    }
    return lastError;
  };

  const hadDestination = fs.existsSync(destinationGardenDir);
  if (hadDestination) {
    const displaceError = await retryRename(destinationGardenDir, failedDir);
    if (displaceError) {
      throw new Error(
        `Could not move the current garden aside for restore; destination remains intact. ${displaceError}`,
      );
    }
  }

  let restoreError: string | null = null;
  if (previousGardenDir && fs.existsSync(previousGardenDir)) {
    restoreError = await retryRename(previousGardenDir, destinationGardenDir);
  } else if (hadDestination) {
    restoreError = "The retained previous garden is missing; refusing a destructive restore.";
  }

  if (restoreError) {
    let fallbackError: string | null = null;
    if (
      hadDestination &&
      !fs.existsSync(destinationGardenDir) &&
      fs.existsSync(failedDir)
    ) {
      // Restoring the tree we displaced is a compensating action: once this
      // worker made the destination absent it must repair that absence, even if
      // fencing was lost in the meantime. It never overwrites a new destination.
      fallbackError = await retryRename(failedDir, destinationGardenDir, false);
    }
    if (fallbackError) {
      throw new Error(
        `Previous garden restore failed (${restoreError}); restoring the displaced live garden also failed (${fallbackError}). Recovery copies remain at ${previousGardenDir ?? "(missing previous)"} and ${failedDir}.`,
      );
    }
    throw new Error(
      `Previous garden restore failed (${restoreError}); the displaced live garden was restored and the retained previous copy remains at ${previousGardenDir ?? "(missing previous)"}.`,
    );
  }
  if ((!ownsLease || ownsLease()) && fs.existsSync(failedDir)) {
    try {
      fs.rmSync(failedDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(
        `[learn] Restored the previous garden; displaced failed tree remains at ${failedDir}:`,
        cleanupError,
      );
    }
  }
}

export class LearnPipelineConflictError extends Error {
  /**
   * Set when the confirmed Learning Map itself is the obstacle: its promoted
   * evidence no longer describes the sources on disk, so no amount of retrying
   * generation can clear it and only a fresh planning run will. Callers use
   * this to route the user forward instead of leaving Learn dead-ended on a map
   * that can never generate.
   */
  readonly requiresReplan: boolean;

  constructor(message: string, options?: { requiresReplan?: boolean }) {
    super(message);
    this.name = "LearnPipelineConflictError";
    this.requiresReplan = options?.requiresReplan === true;
  }
}

function learnFailureRequiresReplan(error: unknown): boolean {
  return error instanceof LearnPipelineConflictError && error.requiresReplan;
}

export interface LearnHumanizerSwitchResult {
  versionId: string;
  changed: boolean;
  state: LearnHumanizerVersionState;
}

function finishedLearnHumanizerValidation(
  gardenDir: string,
  gardenId: string,
): { accepted: boolean; problems: string[] } {
  const verification = verifyFinalArtifactNoMutation({
    gardenDir,
    gardenSlug: gardenId,
    updateRepairReport: false,
    strictModelApprovedVisuals: true,
  });
  return {
    accepted: verification.accepted,
    problems: [
      ...verification.validationFailures,
      ...verification.unresolvedRepairFailures,
      ...verification.mutatedFiles.map(
        (file) => `mutated during verification: ${file}`,
      ),
    ],
  };
}

/**
 * Apply a Rewrite naturally toggle to the latest already-published Learn
 * version. The complete garden is staged, verified, and atomically promoted;
 * the published tree is never rewritten page-by-page in place.
 */
export async function switchFinishedLearnHumanizer({
  gardenId,
  userId,
  contentPath,
  enabled,
  expectedVersionId,
  yieldToResponse,
}: {
  gardenId: string;
  userId: number;
  contentPath: string;
  enabled: boolean;
  expectedVersionId?: string;
  /** Cooperative route handoff after the durable state marker is written. */
  yieldToResponse?: (operationId: string) => Promise<void>;
}): Promise<LearnHumanizerSwitchResult> {
  ensureLearnTables();
  const version = getLatestLearnVersion(gardenId);
  if (!version) {
    throw new LearnPipelineConflictError(
      "Rewrite naturally needs a completed Learn version.",
    );
  }
  if (expectedVersionId && version.id !== expectedVersionId) {
    throw new LearnPipelineConflictError(
      "The completed Learn version changed before its prose could be switched.",
    );
  }
  const latestJob = getLatestLearnJob(gardenId);
  if (
    latestJob &&
    (activeStatus(latestJob.status) ||
      latestJob.status === "awaiting_confirmation")
  ) {
    throw new LearnPipelineConflictError(
      "Wait for the active Learn job to finish before switching its prose copy.",
    );
  }

  const repositoryGardenDir = clusterPath(contentPath, gardenId);
  if (!fs.existsSync(repositoryGardenDir)) {
    throw new LearnPipelineConflictError("The completed Learn garden is missing.");
  }
  const priorState = readLearnHumanizerVersionState(
    repositoryGardenDir,
    version.id,
  );
  const targetCopy = enabled ? "humanized" : "ai";
  if (
    priorState.activeCopy === targetCopy &&
    priorState.status !== "running" &&
    priorState.status !== "restoring_ai" &&
    priorState.status !== "failed"
  ) {
    return { versionId: version.id, changed: false, state: priorState };
  }

  const operationId = makeId("learn_humanizer");
  const acquired = acquireGardenLearnLease(repositoryGardenDir, {
    gardenSlug: gardenId,
    jobId: operationId,
    buildId: operationId,
  });
  if (!acquired.acquired) {
    throw new LearnPipelineConflictError(
      "Another Learn operation is already changing this garden.",
    );
  }
  const lease = acquired.lease;
  let temporaryRoot: string | undefined;
  let previousPromotedGardenDir: string | undefined;
  let promotionCommitted = false;
  try {
    writeLearnHumanizerVersionState(repositoryGardenDir, {
      versionId: version.id,
      requested: enabled,
      activeCopy: priorState.activeCopy,
      status: enabled ? "running" : "restoring_ai",
    });

    await yieldToResponse?.(operationId);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "The humanizer lost ownership before it could stage the garden.",
      );
    }

    const durableFingerprintBefore = fingerprintDurableGardenState(
      repositoryGardenDir,
    );
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "breadboard-learn-humanizer-"),
    );
    const stagingGardenDir = path.join(temporaryRoot, gardenId);
    fs.cpSync(repositoryGardenDir, stagingGardenDir, {
      recursive: true,
      force: true,
    });
    if (
      fingerprintDurableGardenState(stagingGardenDir) !==
      durableFingerprintBefore
    ) {
      throw new LearnPipelineConflictError(
        "The garden changed while the humanizer prepared its staging copy.",
      );
    }

    let changed = false;
    let reason = "";
    let validationProblems: string[] = [];
    if (enabled) {
      // Repeat passes always begin from the preserved AI version, never from a
      // humanizer's previous output.
      resetLearnTreeToAiCopy(stagingGardenDir, version.id);
      const outcome = await humanizeFinishedLearnBuild({
        userId,
        gardenDir: stagingGardenDir,
        versionId: version.id,
        force: true,
        strictStatePersistence: true,
        checkCancelled: () => {
          if (!lease.heartbeat()) {
            throw new LearnPipelineConflictError(
              "The humanizer lost ownership while rewriting the garden.",
            );
          }
        },
        validate: () =>
          finishedLearnHumanizerValidation(stagingGardenDir, gardenId),
      });
      changed = outcome.adopted;
      reason = outcome.reason;
      validationProblems = outcome.validationProblems;
    } else {
      const outcome = restoreLearnAiCopy({
        gardenDir: stagingGardenDir,
        versionId: version.id,
        validate: () =>
          finishedLearnHumanizerValidation(stagingGardenDir, gardenId),
      });
      changed = outcome.restored;
      reason = outcome.reason;
      validationProblems = outcome.validationProblems;
      if (outcome.reason === "original_copy_missing") {
        throw new Error(
          "The saved AI copy for this Learn version is missing; the humanized lessons were left unchanged.",
        );
      }
      if (outcome.reason === "validation_failed") {
        throw new Error(
          `The saved AI copy did not pass final validation: ${validationProblems.join("; ")}`,
        );
      }
    }

    appendLearnEvent(
      contentPath,
      gardenId,
      enabled ? "learn_humanizer_enabled" : "learn_humanizer_disabled",
      {
        operationId,
        userId,
        textbookVersionId: version.id,
        changed,
        reason,
        validationProblems,
      },
    );
    mergeLearnEventLedgers(repositoryGardenDir, stagingGardenDir);
    const promotion = await promoteStagingGarden({
      stagingGardenDir,
      destinationGardenDir: repositoryGardenDir,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: operationId,
      verifyCurrentDestination: (destinationDir) =>
        lease.heartbeat() &&
        fingerprintDurableGardenState(destinationDir) ===
          durableFingerprintBefore,
      prepareIncomingForCommit: (incomingDir, destinationDir) => {
        mergeLearnEventLedgers(destinationDir, incomingDir);
        return true;
      },
      verifyManifest: (candidateDir) =>
        finishedLearnHumanizerValidation(candidateDir, gardenId).accepted,
    });
    previousPromotedGardenDir = promotion.previousPreservedAt;
    if (!promotion.promoted) {
      throw new LearnPipelineConflictError(
        `The finished Learn prose was not switched: ${promotion.reason}`,
      );
    }
    if (changed) {
      await publishQuartzAfterMutation(
        `${enabled ? "humanized" : "restored AI"} Learn copy in ${gardenId}`,
        { requireSuccess: true, gardenSlug: gardenId },
      );
    }
    promotionCommitted = true;
    if (previousPromotedGardenDir && lease.heartbeat()) {
      try {
        fs.rmSync(previousPromotedGardenDir, { recursive: true, force: true });
        previousPromotedGardenDir = undefined;
      } catch (cleanupError) {
        console.warn(
          `[learn] Previous humanizer garden remains at ${previousPromotedGardenDir}:`,
          cleanupError,
        );
      }
    }
    return {
      versionId: version.id,
      changed,
      state: readLearnHumanizerVersionState(repositoryGardenDir, version.id),
    };
  } catch (error) {
    if (previousPromotedGardenDir && !promotionCommitted) {
      await restorePreviousPromotedGarden(
        repositoryGardenDir,
        previousPromotedGardenDir,
        () => !lease.lost && lease.heartbeat(),
      );
      previousPromotedGardenDir = undefined;
      const publicationToken = queueLearnPublicationRetry(
        gardenId,
        "restored failed Learn humanizer switch",
        new Error("Publication pending"),
      );
      try {
        await publishQuartzAfterMutation(
          `rolled back failed Learn humanizer switch in ${gardenId}`,
          { requireSuccess: true, gardenSlug: gardenId },
        );
        clearLearnPublicationRetry(gardenId, publicationToken);
      } catch (republishError) {
        queueLearnPublicationRetry(
          gardenId,
          "restored failed Learn humanizer switch",
          republishError,
        );
        appendLearnEvent(
          contentPath,
          gardenId,
          "learn_humanizer_republish_queued",
          { operationId, error: errorMessage(republishError) },
        );
      }
    }
    try {
      writeLearnHumanizerVersionState(repositoryGardenDir, {
        versionId: version.id,
        requested: enabled,
        activeCopy: priorState.activeCopy,
        status: "failed",
        reason: "switch_failed",
        error: errorMessage(error),
      });
    } catch {
      // The original published copy remains authoritative even when writing the
      // diagnostic marker itself fails.
    }
    throw error;
  } finally {
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
    lease.release();
  }
}

/** The only Learn flow allowed to discard and recreate the plan, contract,
 * learner pages, and visuals. It is never called as a repair fallback. */
export async function rebuildEntireGarden(
  gardenId: string,
  options: FullRebuildOptions,
  yieldToResponse?: (jobId: string) => Promise<void>,
): Promise<LearnJob> {
  if (options.forceFullRebuild !== true) {
    throw new Error("Rebuilding the entire garden requires explicit confirmation.");
  }
  let rebuildLease: GardenLearnLease | undefined;
  let planningJobId: string | undefined;
  try {
    const planning = await runLearnPlanning({
      gardenId,
      userId: options.userId,
      client: options.client,
      model: options.model ?? DEFAULT_MODEL,
      contentPath: options.contentPath,
      includedSourceIds: options.includedSourceIds,
      syllabusSourceId: options.syllabusSourceId,
      sourceOnly: options.sourceOnly ?? true,
      includeSourceSnapshots: options.includeSourceSnapshots ?? false,
      userInstruction: options.userInstruction,
      resetSourceMap: true,
      retainLeaseOnSuccess: true,
      yieldToResponse,
    });
    rebuildLease = planning.retainedLease;
    planningJobId = planning.job.id;
    if (!rebuildLease) {
      throw new Error("Full rebuild planning did not retain its garden lease.");
    }
    throwIfLearnCancelled(planning.job.id);
    const confirmed = confirmLearningMap({
      gardenId,
      learningMapId: planning.learningMap.id,
      expectedModel: options.model ?? DEFAULT_MODEL,
      contentPath: options.contentPath,
      gardenLease: rebuildLease,
    });
    const generation = await runTextbookGeneration({
      gardenId,
      userId: options.userId,
      client: options.client,
      model: options.model ?? DEFAULT_MODEL,
      contentPath: options.contentPath,
      confirmedLearningMapId: confirmed.id,
      mode: "full_rebuild",
      sourceOnly: options.sourceOnly ?? true,
      includeSourceSnapshots: options.includeSourceSnapshots ?? false,
      userInstruction: options.userInstruction,
      gardenLease: rebuildLease,
      yieldToResponse,
    });
    return generation.job;
  } catch (error) {
    const stillOwnRebuildLease = (): boolean => {
      if (!planningJobId || !rebuildLease) return false;
      return confirmLearnLeaseForFailureCleanup(rebuildLease, planningJobId);
    };
    if (
      planningJobId &&
      rebuildLease &&
      !stillOwnRebuildLease()
    ) {
      throw error;
    }
    return rethrowAfterBestEffortLearnFailureCleanup(error, async () => {
      if (!planningJobId || !rebuildLease) return;
      const cancelled = isLearnCancellationWithoutMaskingFailure(planningJobId, error);
      let rollback: Awaited<ReturnType<typeof rollbackLearnRun>> | undefined;
      try {
        rollback = await rollbackLearnRun({
          gardenId,
          contentPath: options.contentPath,
          jobId: planningJobId,
          lease: rebuildLease,
        });
      } catch (rollbackError) {
        if (!stillOwnRebuildLease()) return;
        try {
          appendLearnEvent(options.contentPath, gardenId, "learn_full_rebuild_rollback_failed", {
            jobId: planningJobId,
            error: errorMessage(rollbackError, "Full rebuild rollback failed"),
          });
        } catch {
          // Rollback diagnostics are best-effort.
        }
        if (!cancelled) {
          try {
            updateLearnJob(planningJobId, {
              status: "failed",
              currentStep: "Full rebuild failed; rollback pending retry",
              error: errorMessage(error, "Full rebuild failed"),
            });
          } catch {
            // Preserve the authoritative planning/generation error.
          }
        }
        return;
      }
      if (!stillOwnRebuildLease()) return;
      try {
        appendLearnEvent(options.contentPath, gardenId, "learn_full_rebuild_rolled_back", {
          jobId: planningJobId,
          restoredPathCount: rollback.restoredPaths.length,
          deletedMaps: rollback.deletedMaps,
          deletedVersions: rollback.deletedVersions,
        });
      } catch {
        // Rollback diagnostics are best-effort.
      }
      if (!cancelled) {
        try {
          updateLearnJob(planningJobId, {
            status: "failed",
            currentStep: "Full rebuild failed; prior garden restored",
            error: errorMessage(error, "Full rebuild failed"),
          });
        } catch {
          // Preserve the authoritative planning/generation error.
        }
      }
      try {
        discardLearnRunSnapshot({
          gardenId,
          contentPath: options.contentPath,
          jobId: planningJobId,
        });
      } catch {
        // Snapshot cleanup is best-effort after a completed rollback.
      }
      if (cancelled) {
        try {
          removeRejectedAttemptAuditsAfterTerminalLifecycle(
            options.contentPath,
            gardenId,
          );
        } catch {
          // Rejected-attempt cleanup is best-effort.
        }
      }
      let publicationToken: string | undefined;
      try {
        publicationToken = queueLearnPublicationRetry(
          gardenId,
          "failed Learn rebuild rollback",
          new Error("Publication pending"),
        );
      } catch {
        // Retry-ledger persistence is best-effort during unwind.
      }
      try {
        await publishQuartzAfterMutation(`failed Learn rebuild rollback in ${gardenId}`, {
          requireSuccess: true,
          gardenSlug: gardenId,
        });
        if (publicationToken) {
          try {
            clearLearnPublicationRetry(gardenId, publicationToken);
          } catch {
            // Publication succeeded; stale retry-ledger cleanup is optional.
          }
        }
      } catch (publicationError) {
        try {
          queueLearnPublicationRetry(
            gardenId,
            "failed Learn rebuild rollback",
            publicationError,
          );
        } catch {
          // Preserve the authoritative planning/generation error.
        }
      }
    });
  } finally {
    try {
      rebuildLease?.release();
    } catch {
      // Lease cleanup must not replace the operation result.
    }
  }
}

export class LearnRepairPendingMapError extends Error {
  constructor(jobId: string) {
    super(
      `Discard pending Learning Map ${jobId} before starting scoped repair.`,
    );
    this.name = "LearnRepairPendingMapError";
  }
}

export async function runLearnRepairOperation({
  gardenId,
  userId,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  request,
  yieldToResponse,
}: {
  gardenId: string;
  userId?: number;
  client: OpenAI;
  model?: string;
  contentPath: string;
  request: StartLearnOperationRequest;
  /** Cooperative route handoff after the durable job is visible to polling. */
  yieldToResponse?: (jobId: string) => Promise<void>;
}): Promise<{ job: LearnJob; repair: LearnScopedRepairResult }> {
  if (request.mode !== "repair" || request.gardenId !== gardenId) {
    throw new Error("Repair request garden/mode does not match the Learn operation.");
  }
  const latestJob = getLatestLearnJob(gardenId);
  if (latestJob?.status === "awaiting_confirmation") {
    throw new LearnRepairPendingMapError(latestJob.id);
  }
  assertNoPendingLearnClear(gardenId);
  const gardenDir = clusterPath(contentPath, gardenId);
  const jobId = makeId("learn_job");
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId,
    buildId: `repair:${jobId}`,
  }, {
    onLeaseLost: () => abortLearnWorkerAfterLeaseLoss(jobId),
  });
  if (!leaseResult.acquired) {
    const message = `Another Learn operation (${leaseResult.conflict.jobId}) is already active for this garden.`;
    throw new LearnPipelineConflictError(message);
  }
  const lease = leaseResult.lease;
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
  } catch (error) {
    lease.release();
    throw error;
  }
  const context = collectLearnSourceContext(contentPath, gardenId);
  let job: LearnJob;
  try {
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn repair lost its garden lease before creating its job.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
    job = createLearnJob({
      id: jobId,
      gardenId,
      userId,
      model,
      mode: "repair",
      sourceIds: context.sources.map((source) => source.slug),
      sourceOnly: true,
      includeSourceSnapshots: false,
    });
  } catch (error) {
    lease.release();
    throw error;
  }
  let disposeModelTracking = () => {};
  let previousRepairGardenDir: string | undefined;
  let repairCommitRecorded = false;
  try {
    activeLearnCouncilDispatchAuthorities.set(
      job.id,
      () => confirmLearnLeaseForCouncilDispatch(lease, job.id),
    );
    updateLearnJob(job.id, {
      status: "analyzing_issues",
      currentStep: "Analyzing validation issues",
      progressPercent: 5,
      sourceSetHash: context.sourceSetHash,
    });
    await yieldToResponse?.(job.id);
    disposeModelTracking = attachLearnJobModelTracking({
      client,
      jobId: job.id,
      gardenId,
      contentPath,
    });
    createLearnRunSnapshot({ gardenId, contentPath, jobId: job.id });
    throwIfLearnCancelled(job.id);
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn repair lost its garden lease while creating the rollback snapshot.",
      );
    }
    appendLearnEvent(contentPath, gardenId, "learn_scoped_repair_started", { jobId: job.id, request });
    const scopedRepairAttemptsByIssue = new Map<string, number>();
    const repair = await executeLearnScopedRepair({
      gardenDir,
      gardenId,
      request,
      recoveryOwnerId: job.id,
      verifyLease: () => lease.heartbeat(),
      modelRepair: async (packet: unknown, issue: GardenIssue) => {
        const semanticAttempt = scopedRepairAttemptsByIssue.get(issue.issueId) ?? 0;
        scopedRepairAttemptsByIssue.set(issue.issueId, semanticAttempt + 1);
        const result = await callCouncilJson({
          client,
          model,
          taskType: "critique",
          gardenId,
          system: [
            "Repair exactly one typed Breadboard validation issue.",
            "Return STRICT JSON: {\"operations\":[typed operations] }.",
            "Use only entity IDs, source anchors, actions, and context present in the packet.",
            "Never return a directory, Markdown tree, replacement garden, unrestricted page, or invented source anchor.",
            "For visual-only failures, modify only the owned visual spec/block. For metadata failures, never rewrite prose.",
          ].join(" "),
          user: JSON.stringify(packet),
          sourceContext: packet,
          councilModeOverride: "direct_council",
          timeoutMs: LEARN_PLANNING_TIMEOUT_MS,
          preserveExactContent: true,
          ordinaryCheckpoint: {
            jobId: job.id,
            contentPath,
            stageKey: `repair:issue:${learnCouncilStageComponent(issue.issueId)}`,
            stageLabel: `scoped repair ${issue.issueId}`,
            semanticAttempt,
          },
        });
        try {
          appendLearnEvent(contentPath, gardenId, "learn_scoped_model_decision", {
            jobId: job.id,
            issueId: issue.issueId,
            issueType: issue.type,
            returnedTypedDecision: Boolean(result.parsed),
          });
        } catch {
          // Durable telemetry must not replace an accepted provider response.
        }
        return exactScopedModelRepairResponse(result.content);
      },
      onProgress: ({ step, issue, scope }) => {
        throwIfLearnCancelled(job.id);
        const lower = step.toLowerCase();
        const status: LearnStatus = lower.includes("analyzing") ? "analyzing_issues"
          : lower.includes("revalidating") ? "revalidating"
            : lower.includes("publishing") ? "publishing_repair" : "repairing";
        if (status === "publishing_repair") {
          if (!lease.heartbeat()) {
            throw new LearnPipelineConflictError(
              "Learn repair lost its garden lease before publication.",
            );
          }
          committingLearnJobs.add(job.id);
        }
        const progressPercent = status === "analyzing_issues" ? 10 : status === "repairing" ? 55 : status === "revalidating" ? 85 : 95;
        const progressUpdate = {
          status, currentStep: step, progressPercent,
          currentPageTitle: issue?.target.pageId,
          currentSectionTitle: scope?.sectionIds.join(", ") || undefined,
        };
        if (status === "publishing_repair") {
          updateLearnJobExpectStatus(job.id, progressUpdate);
        } else {
          updateLearnJob(job.id, progressUpdate);
        }
      },
    });
    previousRepairGardenDir = repair.promotion.previousPreservedAt;
    throwIfLearnCancelled(job.id);
    if (!repair.transaction.committed || !repair.accepted || !repair.publishReady) {
      const remaining = repair.transaction.blockersAfter.length;
      throw new Error(`Scoped repair stopped without publishing because its safety/progress gate failed. ${remaining} blocker(s) remain. Inspect .breadboard/scoped-repair.md; Full rebuild remains a separate action.`);
    }
    updateLearnJobExpectStatus(job.id, { status: "publishing_repair", currentStep: "Publishing repaired projection", progressPercent: 96 });
    await publishQuartzAfterMutation(`scoped Learn repair in ${gardenId}`, {
      requireSuccess: true,
      gardenSlug: gardenId,
    });
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn repair lost its garden lease after Quartz publication.",
      );
    }
    appendLearnEvent(contentPath, gardenId, "learn_scoped_repair_completed", {
      jobId: job.id, repairId: repair.scope.repairId, changedFiles: repair.files.changedFiles,
      preservedPageCount: repair.scope.explicitlyExcludedPageIds.length,
      modelCalls: repair.transaction.modelCalls, blockersBefore: repair.transaction.blockersBefore.length,
      blockersAfter: repair.transaction.blockersAfter.length, accepted: repair.accepted, publishReady: repair.publishReady,
    });
    const finalJob = updateLearnJobExpectStatus(job.id, {
      status: "complete", currentStep: "Repair complete", progressPercent: 100,
      sourceSetHash: context.sourceSetHash,
    });
    repairCommitRecorded = true;
    try {
      fs.rmSync(learnRunSnapshotDir(gardenDir, job.id), {
        recursive: true,
        force: true,
      });
    } catch (snapshotCleanupError) {
      console.warn(
        `[learn] Completed repair snapshot remains for ${job.id}:`,
        snapshotCleanupError,
      );
    }
    if (previousRepairGardenDir && lease.heartbeat()) {
      try {
        fs.rmSync(previousRepairGardenDir, { recursive: true, force: true });
        previousRepairGardenDir = undefined;
      } catch (cleanupError) {
        console.warn(
          `[learn] Previous repaired garden remains at ${previousRepairGardenDir}:`,
          cleanupError,
        );
      }
    }
    return { job: finalJob, repair };
  } catch (error) {
    const stillOwnRepairLease = (): boolean => {
      return confirmLearnLeaseForFailureCleanup(lease, job.id);
    };
    if (!stillOwnRepairLease()) {
      throw error;
    }
    const restoreFailedRepairBestEffort = async (): Promise<boolean> => {
      if (!previousRepairGardenDir || repairCommitRecorded) return false;
      let restored = false;
      try {
        await restorePreviousPromotedGarden(
          gardenDir,
          previousRepairGardenDir,
          stillOwnRepairLease,
        );
        if (!stillOwnRepairLease()) return true;
        previousRepairGardenDir = undefined;
        restored = true;
      } catch (restoreError) {
        try {
          appendLearnEvent(contentPath, gardenId, "learn_repair_restore_failed", {
            jobId: job.id,
            error: errorMessage(restoreError, "Repair restore failed"),
          });
        } catch {
          // Restore diagnostics are subordinate to the repair/provider error.
        }
        try {
          updateLearnJob(job.id, {
            status: "publishing_repair",
            currentStep: "Repair filesystem restore pending retry",
            error: errorMessage(restoreError),
          });
        } catch {
          // Preserve the authoritative repair/provider error.
        }
        return true;
      }
      if (restored && stillOwnRepairLease()) {
        let publicationToken: string | undefined;
        try {
          publicationToken = queueLearnPublicationRetry(
            gardenId,
            "restored failed Learn repair",
            new Error("Publication pending"),
          );
        } catch {
          // Retry-ledger persistence is best-effort during unwind.
        }
        try {
          await publishQuartzAfterMutation(
            `rolled back failed Learn repair in ${gardenId}`,
            { requireSuccess: true, gardenSlug: gardenId },
          );
          if (publicationToken) {
            try {
              clearLearnPublicationRetry(gardenId, publicationToken);
            } catch {
              // Publication succeeded; stale retry-ledger cleanup is optional.
            }
          }
        } catch (republishError) {
          try {
            queueLearnPublicationRetry(
              gardenId,
              "restored failed Learn repair",
              republishError,
            );
          } catch {
            // Preserve the authoritative repair/provider error.
          }
          try {
            appendLearnEvent(contentPath, gardenId, "learn_repair_republish_queued", {
              jobId: job.id,
              error: errorMessage(republishError),
            });
          } catch {
            // Preserve the authoritative repair/provider error.
          }
        }
      }
      return false;
    };
    if (isLearnCancellationWithoutMaskingFailure(job.id, error)) {
      try {
        await restoreFailedRepairBestEffort();
      } catch {
        // Restore is already best-effort and cancellation remains canonical.
      }
      try {
        updateLearnJob(job.id, {
          status: "cancelled",
          currentStep: "Cancelled; scoped repair changes were not published",
          progressPercent: 0,
        });
      } catch {
        // Preserve canonical cancellation.
      }
      try {
        appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
          jobId: job.id,
          operation: "repair",
        });
      } catch {
        // Preserve canonical cancellation.
      }
      throw error;
    }
    return rethrowAfterBestEffortLearnFailureCleanup(error, async () => {
      const restorePending = await restoreFailedRepairBestEffort();
      if (!stillOwnRepairLease()) return;
      let raw = "Learn repair failed";
      try {
        raw = errorMessage(error, raw);
      } catch {
        // Formatting is optional diagnostic context.
      }
      const message = raw.length > 700 ? `${raw.slice(0, 697)}...` : raw;
      try {
        appendLearnEvent(contentPath, gardenId, "learn_scoped_repair_failed", {
          jobId: job.id,
          error: message,
        });
      } catch {
        // Failure telemetry must not replace the repair/provider error.
      }
      try {
        updateLearnJob(job.id, {
          status: restorePending ? "publishing_repair" : "failed",
          currentStep: restorePending
            ? "Repair filesystem restore pending retry"
            : "Repair stopped with remaining blockers",
          error: message,
        });
      } catch {
        // Terminal status is best-effort during exact-error propagation.
      }
    });
  } finally {
    if (
      !lease.lost &&
      !leaseLostLearnJobs.has(job.id) &&
      lease.heartbeat() &&
      !previousRepairGardenDir
    ) {
      try {
        fs.rmSync(learnRunSnapshotDir(gardenDir, job.id), {
          recursive: true,
          force: true,
        });
      } catch {
        // Preserve the primary repair result; abandoned snapshot cleanup is
        // best-effort once no retained rollback tree remains.
      }
    }
    committingLearnJobs.delete(job.id);
    activeLearnCouncilDispatchAuthorities.delete(job.id);
    try {
      disposeModelTracking();
    } catch {
      // Tracking cleanup is subordinate to the operation result.
    }
    try {
      lease.release();
    } catch {
      // Lease cleanup is subordinate to the operation result.
    }
  }
}

export async function runLearnPipeline({
  gardenId,
  userId,
  mode,
  confirmedLearningMapId,
  includedSourceIds,
  syllabusSourceId,
  sourceOnly = true,
  includeSourceSnapshots = false,
  userInstruction,
  autoConfirmTopicMap = false,
  client,
  model = DEFAULT_MODEL,
  contentPath,
  yieldToResponse,
}: {
  gardenId: string;
  userId?: number;
  mode: LegacyLearnOperationMode;
  confirmedLearningMapId?: string;
  includedSourceIds?: readonly string[];
  /** Slug of an uploaded document to use as the course study guide. */
  syllabusSourceId?: string | null;
  sourceOnly?: boolean;
  includeSourceSnapshots?: boolean;
  userInstruction?: string;
  autoConfirmTopicMap?: boolean;
  client: OpenAI;
  model?: string;
  contentPath: string;
  /** Cooperative route handoff after the durable job is visible to polling. */
  yieldToResponse?: (jobId: string) => Promise<void>;
}): Promise<unknown> {
  const operationMode = normalizeLearnOperationMode(mode);
  if (operationMode === "repair") {
    return runLearnRepairOperation({
      gardenId, userId, client, model, contentPath,
      request: { gardenId, mode: "repair" },
      yieldToResponse,
    });
  }
  if (operationMode === "full_rebuild") {
    throw new Error("Use rebuildEntireGarden with explicit destructive confirmation.");
  }
  if (operationMode === "plan" || operationMode === "update_sources") {
    const updateExisting = operationMode === "update_sources";
    const planning = await runLearnPlanning({
      gardenId,
      userId,
      client,
      model,
      contentPath,
      includedSourceIds,
      syllabusSourceId,
      sourceOnly,
      includeSourceSnapshots,
      userInstruction,
      updateExisting,
      retainLeaseOnSuccess: autoConfirmTopicMap,
      yieldToResponse,
    });
    if (!autoConfirmTopicMap) return planning;
    const retainedLease = planning.retainedLease;
    if (!retainedLease) {
      throw new Error("Automatic Learn continuation did not retain its garden lease.");
    }
    try {
      throwIfLearnCancelled(planning.job.id);
      const learningMap = confirmLearningMap({
        gardenId,
        learningMapId: planning.learningMap.id,
        expectedModel: model,
        contentPath,
        gardenLease: retainedLease,
      });
      const generation = await runTextbookGeneration({
        gardenId,
        userId,
        client,
        model,
        contentPath,
        confirmedLearningMapId: learningMap.id,
        mode: updateExisting ? "update_sources" : "generate",
        sourceOnly,
        includeSourceSnapshots,
        userInstruction,
        gardenLease: retainedLease,
        yieldToResponse,
      });
      const publicPlanning = {
        job: planning.job,
        learningMap: planning.learningMap,
      };
      return { planning: publicPlanning, learningMap, generation };
    } catch (error) {
      if (
        !retainedLease.lost &&
        isLearnCancellation(planning.job.id, error)
      ) {
        try {
          const cleanup = await cleanupLearnArtifactsAfterCancel({
            gardenId,
            contentPath,
            jobId: planning.job.id,
            lease: retainedLease,
          });
          updateLearnJobExpectStatus(planning.job.id, {
            status: "cancelled",
            currentStep: "Cancelled; latest Learn changes rolled back",
            progressPercent: 0,
          });
          discardLearnRunSnapshot({
            gardenId,
            contentPath,
            jobId: planning.job.id,
          });
          removeRejectedAttemptAuditsAfterTerminalLifecycle(contentPath, gardenId);
          appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
            jobId: planning.job.id,
            removedPathCount: cleanup.removedPaths.length,
            restoredPathCount: cleanup.restoredPaths.length,
            deletedMaps: cleanup.deletedMaps,
            deletedVersions: cleanup.deletedVersions,
          });
        } catch {
          // Leave the durable cancellation-request marker and snapshot intact;
          // startup recovery can retry after this retained lease is released.
        }
      }
      throw error;
    } finally {
      retainedLease.release();
    }
  }
  return runTextbookGeneration({
    gardenId,
    userId,
    client,
    model,
    contentPath,
    confirmedLearningMapId,
    mode: operationMode,
    sourceOnly,
    includeSourceSnapshots,
    userInstruction,
    autoConfirmTopicMap,
    yieldToResponse,
  });
}

export class LearnCancelConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnCancelConflictError";
  }
}

export class LearnPauseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnPauseConflictError";
  }
}

/**
 * Hold the running Learn worker at its next checkpoint. Nothing is rolled back
 * and nothing is committed: the run keeps its pages, its lease, and its place
 * in the pipeline, and the stopwatch stops because "paused" is not a running
 * status. Stop remains available while paused.
 */
export function pauseLatestLearnJob({
  gardenId,
  contentPath,
  expectedJobId,
}: {
  gardenId: string;
  contentPath: string;
  expectedJobId?: string;
}): LearnJob {
  assertNoPendingLearnClear(gardenId);
  const latest = getLatestLearnJob(gardenId);
  if (!latest) {
    throw new LearnPauseConflictError(
      "The pending Learn operation no longer exists. Refresh and try again.",
    );
  }
  if (expectedJobId && latest.id !== expectedJobId) {
    throw new LearnPauseConflictError(
      `The visible Learn operation (${expectedJobId}) is no longer current. Refresh before pausing ${latest.id}.`,
    );
  }
  if (latest.status === "paused") return latest;
  if (committingLearnJobs.has(latest.id) || !LEARN_PAUSABLE_STATUSES.includes(latest.status)) {
    throw new LearnPauseConflictError(
      `Learn operation ${latest.id} is ${latest.status} and cannot be paused. Scoped repair and publication run as single atomic steps; use Cancel to end the run instead.`,
    );
  }
  const next = updateLearnJobExpectStatus(latest.id, {
    status: "paused",
    pausedFromStatus: latest.status,
    currentStep: LEARN_PAUSE_REQUESTED_STEP,
  });
  appendLearnEvent(contentPath, gardenId, "learn_pause_requested", {
    jobId: latest.id,
    pausedFromStatus: latest.status,
  });
  return next;
}

/** Release a paused worker back into the phase it was holding. */
export function resumeLatestLearnJob({
  gardenId,
  contentPath,
  expectedJobId,
}: {
  gardenId: string;
  contentPath: string;
  expectedJobId?: string;
}): LearnJob {
  assertNoPendingLearnClear(gardenId);
  const latest = getLatestLearnJob(gardenId);
  if (!latest) {
    throw new LearnPauseConflictError(
      "The pending Learn operation no longer exists. Refresh and try again.",
    );
  }
  if (expectedJobId && latest.id !== expectedJobId) {
    throw new LearnPauseConflictError(
      `The visible Learn operation (${expectedJobId}) is no longer current. Refresh before resuming ${latest.id}.`,
    );
  }
  // A worker that raced past the gate before the pause landed is already
  // running again; that is the requested end state, not an error.
  if (latest.status !== "paused" && activeStatus(latest.status)) return latest;
  if (latest.status !== "paused") {
    throw new LearnPauseConflictError(
      `Learn operation ${latest.id} is ${latest.status} and is no longer paused.`,
    );
  }
  const resumeStatus = latest.pausedFromStatus;
  if (!resumeStatus || !LEARN_PAUSABLE_STATUSES.includes(resumeStatus)) {
    throw new LearnPauseConflictError(
      `Learn operation ${latest.id} did not record the phase it paused in and cannot be resumed. Cancel the run and start again.`,
    );
  }
  const next = updateLearnJobExpectStatus(latest.id, {
    status: resumeStatus,
    pausedFromStatus: undefined,
    currentStep: "Resuming the paused Learn run",
  });
  appendLearnEvent(contentPath, gardenId, "learn_resumed", {
    jobId: latest.id,
    resumedIntoStatus: resumeStatus,
  });
  return next;
}

export async function cancelLatestLearnJob({
  gardenId,
  contentPath,
  expectedJobId,
  userId,
}: {
  gardenId: string;
  contentPath: string;
  expectedJobId?: string;
  userId: number;
}): Promise<LearnJob | null> {
  assertNoPendingLearnClear(gardenId);
  const latest = getLatestLearnJob(gardenId);
  if (!latest) {
    if (expectedJobId) {
      throw new LearnCancelConflictError(
        "The pending Learn operation no longer exists. Refresh and try again.",
      );
    }
    return null;
  }
  if (expectedJobId && latest.id !== expectedJobId) {
    throw new LearnCancelConflictError(
      `The visible Learn operation (${expectedJobId}) is no longer current. Refresh before cancelling ${latest.id}.`,
    );
  }
  if (
    committingLearnJobs.has(latest.id) ||
    latest.status === "writing_quartz" ||
    latest.status === "publishing_repair"
  ) {
    throw new LearnCancelConflictError(
      "Learn has finished validation and is atomically committing the garden. Wait for publication to complete before starting another operation.",
    );
  }
  const cancellationCleanupPending =
    latest.status === "cancelled" &&
    latest.currentStep === LEARN_CANCELLATION_REQUESTED_STEP;
  if (latest.status === "cancelled" && !cancellationCleanupPending) return latest;
  if (
    !cancellationCleanupPending &&
    !activeStatus(latest.status) &&
    latest.status !== "awaiting_confirmation"
  ) {
    throw new LearnCancelConflictError(
      `Learn operation ${latest.id} is already ${latest.status} and can no longer be cancelled.`,
    );
  }
  const activeController = activeLearnAbortControllers.get(latest.id);
  const next = cancellationCleanupPending
    ? latest
    : updateLearnJobExpectStatus(latest.id, {
        status: "cancelled",
        currentStep: LEARN_CANCELLATION_REQUESTED_STEP,
        progressPercent: 0,
        currentSectionTitle: undefined,
        currentPageTitle: undefined,
        proposedLearningMapId: undefined,
        confirmedLearningMapId: undefined,
        latestTextbookVersionId: undefined,
      });
  activeController?.abort(new LearnCancelledError());
  if (!cancellationCleanupPending) {
    appendLearnEvent(contentPath, gardenId, "learn_cancellation_requested", {
      jobId: latest.id,
    });
  }
  // The running worker owns rollback after it has left every write-capable
  // section. Rolling back here used to race the still-unwinding pipeline and
  // allowed artifacts to reappear after Stop returned.
  if (activeController) {
    return next;
  }
  const gardenDir = clusterPath(contentPath, gardenId);
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId: latest.id,
    buildId: `cancel:${latest.id}`,
  });
  if (!leaseResult.acquired) {
    // A worker in another process still owns the garden. Its durable status
    // poll will observe `cancelled`, abort, and perform rollback under its own
    // lease; this process must never race that cleanup.
    return next;
  }
  try {
    assertNoPendingLearnClear(gardenId);
    const cleanup = await cleanupLearnArtifactsAfterCancel({
      gardenId,
      contentPath,
      jobId: latest.id,
      lease: leaseResult.lease,
      userId,
    });
    const cancelled = updateLearnJobExpectStatus(latest.id, {
      status: "cancelled",
      currentStep: "Cancelled; latest Learn changes rolled back",
      progressPercent: 0,
    });
    discardLearnRunSnapshot({ gardenId, contentPath, jobId: latest.id });
    removeRejectedAttemptAuditsAfterTerminalLifecycle(contentPath, gardenId);
    appendLearnEvent(contentPath, gardenId, "learn_cancelled", {
      jobId: latest.id,
      removedPathCount: cleanup.removedPaths.length,
      restoredPathCount: cleanup.restoredPaths.length,
      deletedMaps: cleanup.deletedMaps,
      deletedVersions: cleanup.deletedVersions,
    });
    return cancelled;
  } finally {
    leaseResult.lease.release();
  }
}

export class LearnClearConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnClearConflictError";
  }
}

export interface ClearLearnDataResult {
  gardenId: string;
  removedPaths: string[];
  removedLearnerPagePaths: string[];
  removedVisualIds: string[];
  removedEventCount: number;
  resetSourceVisualCount: number;
  deletedJobs: number;
  deletedTokenUsageRows: number;
  deletedMaps: number;
  deletedVersions: number;
  deletedSemanticChunks: number;
  deletedSemanticFtsRows: number;
  preservedFileCount: number;
  publicationAttempts: number;
}

interface GardenFileFingerprints {
  [relativePath: string]: string;
}

interface ClearLearnDatabaseResult extends LearnDatabaseClearResult {
  deletedChunks: number;
  deletedFtsRows: number;
}

type LearnClearOperationPhase =
  | "prepared"
  | "filesystem_promoted"
  | "restored_pending_publication"
  | "database_committed";

interface LearnClearOperationRow {
  id: string;
  garden_id: string;
  phase: LearnClearOperationPhase;
  previous_garden_dir: string | null;
  pre_clear_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

function clearRecoveryFingerprint(files: GardenFileFingerprints): string {
  const stableEntries = Object.entries(files)
    .filter(([relativePath]) => {
      const normalized = normalizeRelPath(relativePath).toLowerCase();
      return (
        normalized !== ".breadboard/events.jsonl" &&
        normalized !== ".breadboard/learn-build.lock.json"
      );
    })
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256")
    .update(JSON.stringify(stableEntries))
    .digest("hex");
}

function createLearnClearOperation(
  clearId: string,
  gardenId: string,
  preClearFingerprint: string,
): void {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO learn_clear_operations (
       id, garden_id, phase, previous_garden_dir, pre_clear_fingerprint,
       created_at, updated_at
     ) VALUES (?, ?, 'prepared', NULL, ?, ?, ?)`,
  ).run(clearId, gardenId, preClearFingerprint, timestamp, timestamp);
}

function updateLearnClearOperation(
  clearId: string,
  phase: LearnClearOperationPhase,
  previousGardenDir?: string | null,
): void {
  db.prepare(
    `UPDATE learn_clear_operations
     SET phase = ?, previous_garden_dir = ?, updated_at = ?
     WHERE id = ?`,
  ).run(phase, previousGardenDir ?? null, nowIso(), clearId);
}

function deleteLearnClearOperation(clearId: string): void {
  db.prepare("DELETE FROM learn_clear_operations WHERE id = ?").run(clearId);
}

const STATIC_LEARN_CLEAR_REMOVAL_ROOTS = [
  ".breadboard/internal",
  ".breadboard/backups",
  ".breadboard/build-workspace.json",
  ".breadboard/canonical-shadow",
  ".breadboard/debug/failed-pages",
  ".breadboard/debug/failed-repairs",
  ".breadboard/humanizer",
  ".breadboard/learn-run-snapshots",
  ".breadboard/planning",
  ".breadboard/quarantine",
  ".breadboard/source-snapshots",
  ".breadboard/acceptance-status.json",
  ".breadboard/active-build-manifest.json",
  ".breadboard/anchor-critic-decisions.json",
  ".breadboard/anchor-replacement-plan.json",
  ".breadboard/anchor-replacement-plan.md",
  ".breadboard/claims.json",
  ".breadboard/claims-history.json",
  ".breadboard/concept-registry.json",
  ".breadboard/concept-registry-history.json",
  ".breadboard/critic-issues.json",
  ".breadboard/critic-loop.json",
  ".breadboard/critic-report.md",
  ".breadboard/formula-assignment-plan.json",
  ".breadboard/formula-identities.json",
  ".breadboard/learn-build.lock.json",
  ".breadboard/learning-unit-contract.json",
  ".breadboard/repair-log.json",
  ".breadboard/repair-report.md",
  ".breadboard/render-manifest.json",
  ".breadboard/scoped-repair.json",
  ".breadboard/scoped-repair.md",
  ".breadboard/semantic-migration.json",
  ".breadboard/source-anchor-evidence.json",
  ".breadboard/source-anchor-evidence.md",
  ".breadboard/source-anchor-migration.json",
  ".breadboard/source-anchor-migration.md",
  ".breadboard/source-anchors.json",
  ".breadboard/source-visual-scan-cache.json",
  ".breadboard/validation-report.md",
  ".breadboard/visual-necessity-decisions.json",
  ".breadboard/visual-necessity-decisions.md",
  ".breadboard/visual-decision-records.json",
  ".breadboard/visual-contract-executability-reviews.json",
  ".breadboard/visualization-plan.json",
  ".breadboard/visualization-coverage.json",
  ".breadboard/visualization-coverage.md",
  ".breadboard/visualization-events.json",
  ".breadboard/visualization-report.md",
  ".breadboard/weak-anchor-self-healing.json",
  ".breadboard/weak-anchor-self-healing.md",
] as const;

const STATIC_LEARN_CLEAR_MODIFIED_FILES = new Set([
  ".breadboard/events.jsonl",
  ".breadboard/source-visuals.json",
  ".breadboard/visual-index.json",
]);

function hasIndependentLearnFrontmatter(gardenDir: string, relativePath: string): boolean {
  if (!relativePath.toLowerCase().endsWith(".md")) return false;
  const root = path.resolve(gardenDir);
  const target = path.resolve(root, ...relativePath.split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return false;
  let markdown: string;
  try {
    markdown = fs.readFileSync(target, "utf8");
  } catch {
    return false;
  }
  const raw = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)?.[1];
  if (!raw) return false;
  if (/^generated(?:By|_by)\s*:\s*["']?(?:learn|learn_button|breadboard_learn)["']?\s*$/im.test(raw)) {
    return true;
  }
  if (/^generatedByBuildId\s*:\s*\S+/im.test(raw)) return true;
  const hasPageId = /^pageId\s*:\s*\S+/im.test(raw);
  const hasUnitId = /^(?:learningUnitId|generatedFromUnitId)\s*:\s*\S+/im.test(raw);
  const hasVersion = /^learningVersion(?:Id)?\s*:\s*\S+/im.test(raw);
  return (hasPageId && hasUnitId) || (hasUnitId && hasVersion);
}

function learnClearMutationPolicyViolations(
  gardenDir: string,
  result: LearnFilesystemClearResult,
): string[] {
  const removedLearnerPages = new Set(
    result.removedLearnerPagePaths.map((item) => normalizeRelPath(item).toLowerCase()),
  );
  const removedVisualRoots = result.removedVisualIds.map(
    (visualId) => `.breadboard/visuals/${visualId}`.toLowerCase(),
  );
  const isStaticRemoval = (relativePath: string): boolean =>
    STATIC_LEARN_CLEAR_REMOVAL_ROOTS.some(
      (root) => relativePath === root || relativePath.startsWith(`${root}/`),
    );
  const violations: string[] = [];

  for (const item of result.removedPaths) {
    const normalized = normalizeRelPath(item).toLowerCase();
    const isLearningTree = normalized === "learning" || normalized.startsWith("learning/");
    const isOwnedVisual = removedVisualRoots.some(
      (root) => normalized === root || normalized === `${root}.json` || normalized.startsWith(`${root}/`),
    );
    const isVerifiedExternalPage =
      removedLearnerPages.has(normalized) &&
      !normalized.startsWith("sources/") &&
      !normalized.startsWith("assets/") &&
      !normalized.startsWith(".breadboard/") &&
      hasIndependentLearnFrontmatter(gardenDir, normalizeRelPath(item));
    if (!isLearningTree && !isStaticRemoval(normalized) && !isOwnedVisual && !isVerifiedExternalPage) {
      violations.push(`cleanup requested an unauthorized removal: ${item}`);
    }
  }
  for (const item of result.modifiedPaths) {
    const normalized = normalizeRelPath(item).toLowerCase();
    if (!STATIC_LEARN_CLEAR_MODIFIED_FILES.has(normalized)) {
      violations.push(`cleanup requested an unauthorized modification: ${item}`);
    }
  }
  return violations;
}

function fingerprintGardenFiles(gardenDir: string): GardenFileFingerprints {
  const fingerprints: GardenFileFingerprints = {};
  if (!fs.existsSync(gardenDir)) return fingerprints;

  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const relativePath = normalizeRelPath(path.relative(gardenDir, absolutePath));
        fingerprints[relativePath] = createHash("sha256")
          .update(`symlink:${fs.readlinkSync(absolutePath)}`)
          .digest("hex");
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeRelPath(path.relative(gardenDir, absolutePath));
      fingerprints[relativePath] = createHash("sha256")
        .update(fs.readFileSync(absolutePath))
        .digest("hex");
    }
  };
  visit(gardenDir);
  return fingerprints;
}

function pathWithinAllowedMutation(
  relativePath: string,
  allowedMutationRoots: readonly string[],
): boolean {
  const normalized = normalizeRelPath(relativePath).toLowerCase();
  return allowedMutationRoots.some((root) => {
    const normalizedRoot = normalizeRelPath(root).replace(/\/$/, "").toLowerCase();
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
}

function gardenClearBoundaryViolations({
  before,
  candidateGardenDir,
  allowedMutationRoots,
}: {
  before: GardenFileFingerprints;
  candidateGardenDir: string;
  allowedMutationRoots: readonly string[];
}): string[] {
  const after = fingerprintGardenFiles(candidateGardenDir);
  const violations: string[] = [];

  for (const [relativePath, fingerprint] of Object.entries(before)) {
    if (pathWithinAllowedMutation(relativePath, allowedMutationRoots)) continue;
    if (!after[relativePath]) violations.push(`protected file was removed: ${relativePath}`);
    else if (after[relativePath] !== fingerprint) {
      violations.push(`protected file changed: ${relativePath}`);
    }
  }
  for (const relativePath of Object.keys(after)) {
    if (before[relativePath] || pathWithinAllowedMutation(relativePath, allowedMutationRoots)) {
      continue;
    }
    violations.push(`unexpected file was created: ${relativePath}`);
  }
  return violations;
}

async function restoreGardenAfterClearDatabaseFailure({
  gardenDir,
  previousGardenDir,
  clearId,
  ownsLease,
}: {
  gardenDir: string;
  previousGardenDir: string;
  clearId: string;
  ownsLease?: () => boolean;
}): Promise<{ restored: boolean; reason: string }> {
  const parent = path.dirname(path.resolve(gardenDir));
  const previous = path.resolve(previousGardenDir);
  if (path.dirname(previous) !== parent) {
    return { restored: false, reason: "previous garden path escaped the garden parent" };
  }
  let lastError = "";
  const displacedCopies: string[] = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (ownsLease && !ownsLease()) {
      return {
        restored: false,
        reason: "lost the fenced garden lease before filesystem recovery",
      };
    }
    const displaced = path.resolve(
      parent,
      `.${path.basename(gardenDir)}.failed-clear-${clearId}-${attempt}-${Date.now().toString(36)}`,
    );
    if (path.dirname(displaced) !== parent) {
      return { restored: false, reason: "computed recovery path escaped the garden parent" };
    }
    let currentMovedAside = false;
    try {
      if (fs.existsSync(gardenDir)) {
        fs.renameSync(gardenDir, displaced);
        currentMovedAside = true;
        displacedCopies.push(displaced);
      }
      fs.renameSync(previous, gardenDir);
      if (!ownsLease || ownsLease()) {
        for (const displacedCopy of displacedCopies) {
          try {
            fs.rmSync(displacedCopy, { recursive: true, force: true });
          } catch {
            // The previous garden is already restored. Locked displaced copies
            // remain as explicit recovery material; never delete them before a
            // verified destination exists.
          }
        }
      }
      return { restored: true, reason: `restored previous garden on attempt ${attempt}` };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (currentMovedAside && !fs.existsSync(gardenDir) && fs.existsSync(displaced)) {
        try {
          fs.renameSync(displaced, gardenDir);
        } catch {
          // Retry can still recover from either sibling copy.
        }
      }
      if (attempt < 6) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(1_500, 100 * 2 ** (attempt - 1))));
      }
    }
  }
  return {
    restored: false,
    reason:
      `could not restore the previous garden after 6 attempts: ${lastError}` +
      (displacedCopies.length > 0
        ? `. Displaced garden copies were preserved at ${displacedCopies.join(", ")}`
        : ""),
  };
}

/**
 * Permanently remove generated Learn state for one garden. Source documents,
 * extracted source assets, and ordinary notes outside the generated Learning
 * tree are protected by a byte-fingerprint boundary before atomic promotion.
 */
export async function clearAllLearnData({
  gardenId,
  contentPath,
  confirmClearLearnData,
}: {
  gardenId: string;
  contentPath: string;
  confirmClearLearnData: true;
}): Promise<ClearLearnDataResult> {
  if (confirmClearLearnData !== true) {
    throw new Error("Clearing Learn data requires explicit confirmation.");
  }
  ensureLearnTables();
  assertNoPendingLearnClear(gardenId);

  const jobsAtStart = db
    .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ? ORDER BY updated_at DESC")
    .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
  const jobIdsAtStart = new Set(jobsAtStart.map((job) => job.id));
  const activeJob = jobsAtStart.find(
    (job) => activeStatus(job.status),
  );
  if (activeJob) {
    throw new LearnClearConflictError(
      `Stop the active Learn operation (${activeJob.id}) before clearing Learn data.`,
    );
  }

  const gardenDir = clusterPath(contentPath, gardenId);
  fs.mkdirSync(gardenDir, { recursive: true });
  const clearId = makeId("learn_clear");
  const leaseResult = acquireGardenLearnLease(gardenDir, {
    gardenSlug: gardenId,
    jobId: clearId,
    buildId: `clear:${clearId}`,
  });
  if (!leaseResult.acquired) {
    throw new LearnClearConflictError(
      `Another Learn operation (${leaseResult.conflict.jobId}) is still writing this garden. Stop it before clearing Learn data.`,
    );
  }
  const lease = leaseResult.lease;
  try {
    assertNoPendingLearnClear(gardenId);
    reconcileSupersededAwaitingLearnJobs(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
  } catch (error) {
    lease.release();
    throw error;
  }

  let temporaryRoot: string | undefined;
  try {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-learn-clear-"));
    const jobsAfterLock = db
      .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ? ORDER BY updated_at DESC")
      .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
    const racingJob = jobsAfterLock.find(
      (job) => !jobIdsAtStart.has(job.id) || activeStatus(job.status),
    );
    if (racingJob) {
      throw new LearnClearConflictError(
        `A Learn operation (${racingJob.id}) started while Clear was acquiring the garden. Stop it and try again.`,
      );
    }

    const fingerprintsBefore = fingerprintGardenFiles(gardenDir);
    const stagingContentPath = path.join(temporaryRoot, "content");
    const stagingGardenDir = path.join(stagingContentPath, gardenId);
    fs.mkdirSync(stagingContentPath, { recursive: true });
    fs.cpSync(gardenDir, stagingGardenDir, { recursive: true, force: true });

    const filesystemResult = clearGeneratedLearnState(stagingGardenDir);
    const mutationPolicyViolations = learnClearMutationPolicyViolations(
      gardenDir,
      filesystemResult,
    );
    if (mutationPolicyViolations.length > 0) {
      throw new Error(
        `Learn clear was rolled back by the static mutation policy: ${mutationPolicyViolations
          .slice(0, 6)
          .join("; ")}`,
      );
    }
    const stagingLock = acquireGardenLearnLock(stagingGardenDir, {
      gardenSlug: gardenId,
      jobId: clearId,
      buildId: `clear:${clearId}`,
    });
    if (!stagingLock.acquired) {
      throw new LearnClearConflictError(
        `The staged garden unexpectedly contains another Learn lock (${stagingLock.conflict.jobId}).`,
      );
    }
    refreshClusterIndex(stagingContentPath, gardenId, { migrateSources: false });

    const allowedMutationRoots = Array.from(
      new Set([
        ...filesystemResult.removedPaths,
        ...filesystemResult.modifiedPaths,
        "_index.md",
        "sources/_index.md",
      ]),
    );
    const stagingViolations = gardenClearBoundaryViolations({
      before: fingerprintsBefore,
      candidateGardenDir: stagingGardenDir,
      allowedMutationRoots,
    });
    if (stagingViolations.length > 0) {
      throw new Error(
        `Learn clear was rolled back because protected garden content changed: ${stagingViolations
          .slice(0, 6)
          .join("; ")}`,
      );
    }

    // This SQLite journal is created before the filesystem swap and advanced
    // in the same transaction as database deletion. Startup recovery can
    // therefore distinguish rollback from post-commit cleanup after a crash.
    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn Clear lost its garden lease while creating its staging copy.",
      );
    }
    assertNoPendingLearnClear(gardenId);
    assertNoUnresolvedLearnJob(gardenId);
    createLearnClearOperation(
      clearId,
      gardenId,
      clearRecoveryFingerprint(fingerprintsBefore),
    );

    let promotedViolations: string[] = [];
    let destinationViolations: string[] = [];
    let concurrentLearnJobId: string | undefined;
    const publication = await promoteStagingGarden({
      stagingGardenDir,
      destinationGardenDir: gardenDir,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: clearId,
      verifyManifest: (candidateDir) => {
        promotedViolations = gardenClearBoundaryViolations({
          before: fingerprintsBefore,
          candidateGardenDir: candidateDir,
          allowedMutationRoots,
        });
        return promotedViolations.length === 0;
      },
      verifyCurrentDestination: (currentDestinationDir) => {
        if (!lease.heartbeat()) return false;
        const currentJobs = db
          .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ?")
          .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
        concurrentLearnJobId = currentJobs.find(
          (job) => !jobIdsAtStart.has(job.id) || activeStatus(job.status),
        )?.id;
        if (concurrentLearnJobId) return false;
        destinationViolations = gardenClearBoundaryViolations({
          before: fingerprintsBefore,
          candidateGardenDir: currentDestinationDir,
          allowedMutationRoots: [],
        });
        return destinationViolations.length === 0;
      },
    });
    if (!publication.promoted) {
      if (publication.previousPreservedAt) {
        const recovery = await restoreGardenAfterClearDatabaseFailure({
          gardenDir,
          previousGardenDir: publication.previousPreservedAt,
          clearId,
          ownsLease: () => lease.heartbeat(),
        });
        if (!recovery.restored) {
          throw new Error(
            `${publication.reason}; the Clear journal and retained garden were preserved because recovery could not finish: ${recovery.reason}`,
          );
        }
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after a failed promotion; its journal was retained for recovery.",
        );
      }
      deleteLearnClearOperation(clearId);
      const violations = [...destinationViolations, ...promotedViolations];
      const violationDetail = concurrentLearnJobId
        ? ` A concurrent Learn operation started (${concurrentLearnJobId}).`
        : violations.length > 0
        ? ` ${violations.slice(0, 6).join("; ")}`
        : "";
      throw new Error(`${publication.reason}${violationDetail}`);
    }
    updateLearnClearOperation(
      clearId,
      "filesystem_promoted",
      publication.previousPreservedAt,
    );

    try {
      await publishQuartzAfterMutation(`cleared Learn data in ${gardenId}`, {
        requireSuccess: true,
        gardenSlug: gardenId,
      });
    } catch (publicationError) {
      const previousGardenDir = publication.previousPreservedAt;
      const recovery = previousGardenDir
        ? await restoreGardenAfterClearDatabaseFailure({
            gardenDir,
            previousGardenDir,
            clearId,
            ownsLease: () => lease.heartbeat(),
          })
        : { restored: false, reason: "atomic promotion did not retain a previous garden" };
      if (!recovery.restored) {
        throw new Error(
          `Learn Clear publication failed (${errorMessage(publicationError)}), and filesystem recovery failed: ${recovery.reason}`,
          { cause: publicationError },
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after restoring a failed publication; its journal was retained for recovery.",
        );
      }
      updateLearnClearOperation(clearId, "restored_pending_publication");
      try {
        await publishQuartzAfterMutation(
          `rolled back failed Learn Clear publication in ${gardenId}`,
          { requireSuccess: true, gardenSlug: gardenId },
        );
      } catch (republishError) {
        throw new Error(
          `Learn Clear publication failed (${errorMessage(publicationError)}). The repository was restored, but republishing that restored garden also failed (${errorMessage(republishError)}).`,
          { cause: publicationError },
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after republishing the restored garden; its journal was retained for recovery.",
        );
      }
      deleteLearnClearOperation(clearId);
      throw publicationError;
    }

    if (!lease.heartbeat()) {
      throw new LearnPipelineConflictError(
        "Learn Clear lost its garden lease after publication; the journal was retained for recovery.",
      );
    }

    let databaseResult: ClearLearnDatabaseResult;
    try {
      databaseResult = db.transaction(() => {
        const currentJobs = db
          .prepare("SELECT id, status FROM learn_jobs WHERE garden_id = ?")
          .all(gardenId) as Array<{ id: string; status: LearnStatus }>;
        const concurrentJob = currentJobs.find(
          (job) => !jobIdsAtStart.has(job.id) || activeStatus(job.status),
        );
        if (concurrentJob) {
          throw new LearnClearConflictError(
            `A concurrent Learn operation started (${concurrentJob.id}); its database state was not cleared.`,
          );
        }
        const semantic = clearLearnSemanticChunks(
          {
            gardenSlug: gardenId,
            verifiedGeneratedPageRelPaths: filesystemResult.removedLearnerPagePaths,
          },
          db,
        );
        const learnRows = clearLearnDatabaseRecords(db, gardenId);
        updateLearnClearOperation(
          clearId,
          "database_committed",
          publication.previousPreservedAt,
        );
        return {
          ...semantic,
          ...learnRows,
        };
      })();
    } catch (error) {
      const previousGardenDir = publication.previousPreservedAt;
      const recovery = previousGardenDir
        ? await restoreGardenAfterClearDatabaseFailure({
            gardenDir,
            previousGardenDir,
            clearId,
            ownsLease: () => lease.heartbeat(),
          })
        : { restored: false, reason: "atomic promotion did not retain a previous garden" };
      if (!recovery.restored) {
        const databaseMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Learn data database cleanup failed (${databaseMessage}), and filesystem recovery failed: ${recovery.reason}`,
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after restoring a failed database commit; its journal was retained for recovery.",
        );
      }
      updateLearnClearOperation(clearId, "restored_pending_publication");
      try {
        await publishQuartzAfterMutation(
          `rolled back failed Learn Clear database commit in ${gardenId}`,
          { requireSuccess: true, gardenSlug: gardenId },
        );
      } catch (republishError) {
        throw new Error(
          `Learn data database cleanup failed (${errorMessage(error)}). The repository was restored, but republishing that restored garden also failed (${errorMessage(republishError)}).`,
          { cause: error },
        );
      }
      if (!lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Learn Clear lost its garden lease after republishing the database rollback; its journal was retained for recovery.",
        );
      }
      deleteLearnClearOperation(clearId);
      throw error;
    }

    if (publication.previousPreservedAt) {
      const previousGardenDir = path.resolve(publication.previousPreservedAt);
      try {
        if (path.dirname(previousGardenDir) !== path.dirname(path.resolve(gardenDir))) {
          throw new Error("previous garden cleanup path escaped the garden parent");
        }
        fs.rmSync(previousGardenDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(
          `[learn] Previous garden cleanup remains at ${publication.previousPreservedAt}:`,
          error,
        );
      }
    }
    deleteLearnClearOperation(clearId);

    const preservedFileCount = Object.keys(fingerprintsBefore).filter(
      (relativePath) => !pathWithinAllowedMutation(relativePath, allowedMutationRoots),
    ).length;
    return {
      gardenId,
      removedPaths: filesystemResult.removedPaths,
      removedLearnerPagePaths: filesystemResult.removedLearnerPagePaths,
      removedVisualIds: filesystemResult.removedVisualIds,
      removedEventCount: filesystemResult.removedEventCount,
      resetSourceVisualCount: filesystemResult.resetSourceVisualCount,
      deletedJobs: databaseResult.deletedJobs,
      deletedTokenUsageRows: databaseResult.deletedTokenUsageRows,
      deletedMaps: databaseResult.deletedMaps,
      deletedVersions: databaseResult.deletedVersions,
      deletedSemanticChunks: databaseResult.deletedChunks,
      deletedSemanticFtsRows: databaseResult.deletedFtsRows,
      preservedFileCount,
      publicationAttempts: publication.attempts,
    };
  } finally {
    try {
      if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch {
      // The clear result is already committed; a locked temp copy can be
      // reclaimed by the operating system later.
    }
    lease.release();
  }
}

export const LEARN_JOB_ABANDONED_AFTER_MS = LOCK_STALE_MS + 60_000;

interface AbandonedLearnJobRow {
  job_rowid: number;
  id: string;
  garden_id: string;
  mode: LearnMode;
  status: LearnStatus;
  current_step: string;
  created_at: string;
  updated_at: string;
}

function recoverableAbandonedJob(job: Pick<AbandonedLearnJobRow, "status" | "current_step">): boolean {
  return (
    recoverableLearnStatus(job.status) ||
    (job.status === "cancelled" &&
      job.current_step === LEARN_CANCELLATION_REQUESTED_STEP)
  );
}

function exactPreviousGardenForOwner(
  gardenDir: string,
  ownerId: string,
): string | null {
  const parent = path.dirname(gardenDir);
  const prefix = `.${path.basename(gardenDir)}.previous-`;
  const ownerSuffix = `-${createHash("sha256")
    .update(ownerId)
    .digest("hex")
    .slice(0, 16)}`;
  try {
    return (
      fs
        .readdirSync(parent, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith(prefix) &&
            entry.name.endsWith(ownerSuffix),
        )
        .map((entry) => path.join(parent, entry.name))
        .sort()
        .at(-1) ?? null
    );
  } catch {
    return null;
  }
}

function previousGardenForClearOperation(
  gardenDir: string,
  operation: LearnClearOperationRow,
): string | null {
  if (operation.previous_garden_dir) {
    const candidate = path.resolve(operation.previous_garden_dir);
    const expectedParent = path.dirname(path.resolve(gardenDir));
    const expectedSuffix = `-${createHash("sha256")
      .update(operation.id)
      .digest("hex")
      .slice(0, 16)}`;
    if (
      path.dirname(candidate) === expectedParent &&
      path.basename(candidate).startsWith(`.${path.basename(gardenDir)}.previous-`) &&
      path.basename(candidate).endsWith(expectedSuffix) &&
      fs.existsSync(candidate)
    ) {
      return candidate;
    }
  }
  return exactPreviousGardenForOwner(gardenDir, operation.id);
}

async function recoverInterruptedLearnClears(contentPath: string): Promise<void> {
  const operations = db
    .prepare(
      `SELECT id, garden_id, phase, previous_garden_dir, pre_clear_fingerprint, created_at, updated_at
       FROM learn_clear_operations
       ORDER BY created_at ASC`,
    )
    .all() as LearnClearOperationRow[];
  for (const operation of operations) {
    const gardenDir = clusterPath(contentPath, operation.garden_id);
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: operation.garden_id,
      jobId: operation.id,
      buildId: `clear-recovery:${operation.id}`,
    });
    if (!leaseResult.acquired) continue;
    try {
      const current = db
        .prepare(
          `SELECT id, garden_id, phase, previous_garden_dir, pre_clear_fingerprint, created_at, updated_at
           FROM learn_clear_operations WHERE id = ?`,
        )
        .get(operation.id) as LearnClearOperationRow | undefined;
      if (!current) continue;
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Interrupted Clear recovery lost its garden lease.",
        );
      }
      const previousGarden = previousGardenForClearOperation(gardenDir, current);

      if (current.phase === "database_committed") {
        if (previousGarden) {
          fs.rmSync(previousGarden, { recursive: true, force: true });
        }
        deleteLearnClearOperation(current.id);
        continue;
      }

      if (current.phase === "restored_pending_publication") {
        await publishQuartzAfterMutation(
          `resumed restored Learn Clear publication in ${current.garden_id}`,
          { requireSuccess: true, gardenSlug: current.garden_id },
        );
        if (!leaseResult.lease.heartbeat()) {
          throw new LearnPipelineConflictError(
            "Clear recovery lost its lease after restored publication.",
          );
        }
        deleteLearnClearOperation(current.id);
        continue;
      }

      if (!previousGarden) {
        const liveMatchesPreClear = Boolean(
          current.pre_clear_fingerprint &&
          fs.existsSync(gardenDir) &&
          clearRecoveryFingerprint(fingerprintGardenFiles(gardenDir)) ===
            current.pre_clear_fingerprint,
        );
        if (current.phase === "filesystem_promoted" && liveMatchesPreClear) {
          updateLearnClearOperation(current.id, "restored_pending_publication");
          await publishQuartzAfterMutation(
            `completed restored Learn Clear publication in ${current.garden_id}`,
            { requireSuccess: true, gardenSlug: current.garden_id },
          );
          if (!leaseResult.lease.heartbeat()) {
            throw new LearnPipelineConflictError(
              "Clear recovery lost its lease after restored publication.",
            );
          }
          deleteLearnClearOperation(current.id);
          continue;
        }
        if (current.phase === "filesystem_promoted") {
          throw new Error(
            "The Clear journal says the filesystem was promoted, but its exact retained garden is missing.",
          );
        }
        // Prepared with no owner-tagged backup means the process stopped before
        // the destination swap only when the full pre-clear fingerprint proves
        // the live tree is unchanged. Missing recovery evidence fails closed.
        if (liveMatchesPreClear) {
          deleteLearnClearOperation(current.id);
          continue;
        }
        throw new Error(
          "Prepared Clear has neither an exact retained garden nor a live pre-clear fingerprint match.",
        );
      }

      const recovery = await restoreGardenAfterClearDatabaseFailure({
        gardenDir,
        previousGardenDir: previousGarden,
        clearId: current.id,
        ownsLease: () => leaseResult.lease.heartbeat(),
      });
      if (!recovery.restored) throw new Error(recovery.reason);
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Clear recovery lost its lease after restoring the retained garden.",
        );
      }
      updateLearnClearOperation(current.id, "restored_pending_publication");
      await publishQuartzAfterMutation(
        `recovered interrupted Learn Clear in ${current.garden_id}`,
        { requireSuccess: true, gardenSlug: current.garden_id },
      );
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Clear recovery lost its lease after restored publication.",
        );
      }
      deleteLearnClearOperation(current.id);
    } catch (error) {
      console.error(
        `[learn] Could not recover interrupted Clear ${operation.id}:`,
        error,
      );
    } finally {
      leaseResult.lease.release();
    }
  }
}

interface LearnPublicationRetryRow {
  garden_id: string;
  user_id: number;
  reason: string;
  last_error: string | null;
  requested_at: string;
  updated_at: string;
}

async function recoverPendingLearnPublications(contentPath: string): Promise<void> {
  const pending = db
    .prepare(
      `SELECT retry.garden_id, cluster.user_id, retry.reason, retry.last_error,
              retry.requested_at, retry.updated_at
       FROM learn_publication_retries AS retry
       JOIN clusters AS cluster ON cluster.slug = retry.garden_id
       ORDER BY retry.requested_at ASC`,
    )
    .all() as LearnPublicationRetryRow[];
  for (const publication of pending) {
    if (pendingLearnClearOperation(publication.garden_id)) continue;
    const gardenDir = clusterPath(contentPath, publication.garden_id);
    const retryId = `learn_publish_${createHash("sha256")
      .update(`${publication.garden_id}:${publication.updated_at}`)
      .digest("hex")
      .slice(0, 16)}`;
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: publication.garden_id,
      jobId: retryId,
      buildId: `publication-retry:${retryId}`,
    });
    if (!leaseResult.acquired) continue;
    try {
      reconcileSupersededAwaitingLearnJobs(publication.garden_id);
      if (
        pendingLearnClearOperation(publication.garden_id) ||
        unresolvedLearnJob(publication.garden_id)
      ) {
        continue;
      }
      await publishQuartzAfterMutation(
        `retrying ${publication.reason} in ${publication.garden_id}`,
        {
          requireSuccess: true,
          gardenSlug: publication.garden_id,
          userId: publication.user_id,
        },
      );
      if (!leaseResult.lease.heartbeat()) {
        throw new LearnPipelineConflictError(
          "Publication retry lost its garden lease before acknowledging success.",
        );
      }
      db.prepare(
        `DELETE FROM learn_publication_retries
         WHERE garden_id = ? AND updated_at = ?`,
      ).run(publication.garden_id, publication.updated_at);
    } catch (error) {
      db.prepare(
        `UPDATE learn_publication_retries
         SET last_error = ?, updated_at = ?
         WHERE garden_id = ? AND updated_at = ?`,
      ).run(
        errorMessage(error),
        nowIso(),
        publication.garden_id,
        publication.updated_at,
      );
    } finally {
      leaseResult.lease.release();
    }
  }
}

function previousGardenForAbandonedJob(
  gardenDir: string,
  job: Pick<AbandonedLearnJobRow, "id">,
): string | null {
  const parent = path.dirname(gardenDir);
  const prefix = `.${path.basename(gardenDir)}.previous-`;
  let candidates: Array<{ path: string; name: string; promotedAt: number }> = [];
  try {
    candidates = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => ({
        path: path.join(parent, entry.name),
        name: entry.name,
        promotedAt: Number.parseInt(entry.name.slice(prefix.length), 36),
      }))
      .filter((candidate) => Number.isFinite(candidate.promotedAt))
      .sort((left, right) => right.promotedAt - left.promotedAt);
  } catch {
    return null;
  }
  const exactOwnerSuffix = `-${createHash("sha256")
    .update(job.id)
    .digest("hex")
    .slice(0, 16)}`;
  const exactOwned = candidates.find((candidate) =>
    candidate.name.endsWith(exactOwnerSuffix),
  );
  if (exactOwned) return exactOwned.path;

  const snapshotted = candidates.find((candidate) =>
    fs.existsSync(learnRunSnapshotDir(candidate.path, job.id)),
  );
  if (snapshotted) return snapshotted.path;
  return null;
}

/** Remove every known staging root only after cancellation or supersession.
 * Failed candidates are retained by the separate failure lifecycle. */
function disposeAbandonedLearnWorkspaces(gardenId: string, jobId: string): void {
  for (const abandonedWorkspace of learnWorkspaceRootCandidates(gardenId, jobId)) {
    try {
      fs.rmSync(abandonedWorkspace, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(
        `[learn] Abandoned workspace remains at ${abandonedWorkspace}:`,
        cleanupError,
      );
    }
  }
}

/**
 * Recover work whose process disappeared. This is intentionally run by the
 * Node startup sweeper, never by a GET/status request: status remains a pure
 * read, while a stale job still becomes retryable after a restart. A recovery
 * must own the same fenced garden lease before touching either SQLite or files.
 */
export async function recoverAbandonedLearnJobs({
  contentPath,
  nowMs = Date.now(),
}: {
  contentPath: string;
  nowMs?: number;
}): Promise<{ recoveredJobIds: string[]; skippedJobIds: string[] }> {
  reclaimStaleLearnRollbackRoots({ nowMs });
  ensureLearnTables();
  await recoverInterruptedLearnClears(contentPath);
  const recoveryNow = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - LEARN_JOB_ABANDONED_AFTER_MS).toISOString();
  const reconciledUsageJobIds =
    reconcilePersistedLearnTokenUsageForStaleTerminalJobs(
      db,
      cutoff,
      recoveryNow,
    );
  if (reconciledUsageJobIds.length > 0) {
    console.info(
      `[learn] Reconciled terminal token usage for ${reconciledUsageJobIds.length} abandoned job(s).`,
    );
  }
  const candidates = db
    .prepare(
      `SELECT rowid AS job_rowid, id, garden_id, mode, status, current_step, created_at, updated_at
       FROM learn_jobs
       WHERE updated_at <= ?
         AND (
           status IN (
             'idle', 'planning', 'analyzing_issues', 'repairing', 'revalidating',
             'publishing_repair', 'generating_learning_pages',
             'generating_textbook', 'generating_visuals', 'writing_quartz',
             'building_navigation',
             -- A live pause heartbeats every 15s, so only a paused job whose
             -- worker actually died can fall past the abandoned cutoff.
             'paused'
           )
           OR (status = 'cancelled' AND current_step = ?)
         )
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(cutoff, LEARN_CANCELLATION_REQUESTED_STEP) as AbandonedLearnJobRow[];
  const recoveredJobIds: string[] = [];
  const skippedJobIds: string[] = [];

  for (const candidate of candidates) {
    try {
      if (!recoverableAbandonedJob(candidate)) continue;
      if (pendingLearnClearOperation(candidate.garden_id)) {
        skippedJobIds.push(candidate.id);
        continue;
      }
      const gardenDir = clusterPath(contentPath, candidate.garden_id);
      const leaseResult = acquireGardenLearnLease(gardenDir, {
        gardenSlug: candidate.garden_id,
        jobId: candidate.id,
        buildId: `recovery:${candidate.id}`,
      });
      if (!leaseResult.acquired) {
        skippedJobIds.push(candidate.id);
        continue;
      }
      const lease = leaseResult.lease;
      try {
        const current = db
          .prepare("SELECT rowid AS job_rowid, id, garden_id, mode, status, current_step, created_at, updated_at FROM learn_jobs WHERE id = ?")
          .get(candidate.id) as AbandonedLearnJobRow | undefined;
        if (
          !current ||
          !recoverableAbandonedJob(current) ||
          Date.parse(current.updated_at) > Date.parse(cutoff)
        ) {
          skippedJobIds.push(candidate.id);
          continue;
        }

        const newerJob = db
          .prepare(
            `SELECT rowid AS job_rowid, id, garden_id, mode, status, current_step, created_at, updated_at
             FROM learn_jobs
             WHERE garden_id = ?
               AND (created_at > ? OR (created_at = ? AND rowid > ?))
             ORDER BY created_at DESC, rowid DESC
             LIMIT 1`,
          )
          .get(
            current.garden_id,
            current.created_at,
            current.created_at,
            current.job_rowid,
          ) as AbandonedLearnJobRow | undefined;
        if (newerJob) {
          const newerVersionCommitted = Boolean(
            db.prepare(
              "SELECT 1 FROM learn_versions WHERE garden_id = ? AND job_id = ? LIMIT 1",
            ).get(current.garden_id, newerJob.id),
          );
          const newerGardenStateCommitted =
            newerJob.status === "awaiting_confirmation" ||
            (newerJob.status === "complete" &&
              (newerJob.mode === "repair" || newerVersionCommitted));
          if (newerGardenStateCommitted) {
            if (!lease.heartbeat()) {
              throw new LearnPipelineConflictError(
                "Abandoned-job recovery lost its lease before recording a superseded job.",
              );
            }
            const wasCancellation = current.status === "cancelled";
            commitRecoveredLearnJobTerminalState(
              current.id,
              wasCancellation
                ? {
                    status: "cancelled",
                    currentStep: `Cancelled operation superseded by newer Learn job ${newerJob.id}; no rollback applied`,
                    error: undefined,
                  }
                : {
                    status: "failed",
                    currentStep: `Interrupted operation superseded by newer Learn job ${newerJob.id}; no rollback applied`,
                    error:
                      "A newer Learn result was committed, so recovery preserved that newer garden instead of restoring this older snapshot.",
                  },
            );
            appendLearnEvent(
              contentPath,
              current.garden_id,
              "learn_abandoned_job_superseded",
              { jobId: current.id, newerJobId: newerJob.id },
            );
            disposeAbandonedLearnWorkspaces(current.garden_id, current.id);
            recoveredJobIds.push(current.id);
            continue;
          }
          if (learnJobNeedsExclusiveResolution(newerJob)) {
            skippedJobIds.push(current.id);
            continue;
          }
        }

        const previousGarden = previousGardenForAbandonedJob(gardenDir, current);
        if (previousGarden) {
          await restorePreviousPromotedGarden(
            gardenDir,
            previousGarden,
            () => lease.heartbeat(),
          );
        }
        const hasRollbackSnapshot = Boolean(
          resolveLearnRunSnapshot(gardenDir, candidate.id),
        );
        if (
          !previousGarden &&
          !hasRollbackSnapshot &&
          current.status !== "idle"
        ) {
          throw new Error(
            "No exact retained garden or Learn snapshot exists; automatic recovery refused to guess.",
          );
        }
        const rollback = await rollbackLearnRun({
          gardenId: candidate.garden_id,
          contentPath,
          jobId: candidate.id,
          lease,
        });
        const publicationToken = queueLearnPublicationRetry(
          candidate.garden_id,
          "abandoned Learn job recovery",
          new Error("Publication pending"),
        );
        const cancellationRecovery = current.status === "cancelled";
        commitRecoveredLearnJobTerminalState(
          candidate.id,
          cancellationRecovery
            ? {
                status: "cancelled",
                currentStep: "Cancelled; latest Learn changes rolled back",
                error: undefined,
              }
            : {
                status: "failed",
                currentStep: "Unresponsive Learn worker recovered; prior Learn state restored",
                error: "Learn stopped responding before completion. Your garden was restored and is safe to retry.",
              },
        );
        discardLearnRunSnapshot({
          gardenId: candidate.garden_id,
          contentPath,
          jobId: candidate.id,
        });
        if (cancellationRecovery) {
          removeRejectedAttemptAuditsAfterTerminalLifecycle(
            contentPath,
            candidate.garden_id,
          );
        }
        appendLearnEvent(contentPath, candidate.garden_id, "learn_abandoned_job_recovered", {
          jobId: candidate.id,
          restoredPromotedGarden: Boolean(previousGarden),
          removedPathCount: rollback.removedPaths.length,
          restoredPathCount: rollback.restoredPaths.length,
          deletedMaps: rollback.deletedMaps,
          deletedVersions: rollback.deletedVersions,
        });
        try {
          await publishQuartzAfterMutation(
            `recovered abandoned Learn operation in ${candidate.garden_id}`,
            { requireSuccess: true, gardenSlug: candidate.garden_id },
          );
          clearLearnPublicationRetry(candidate.garden_id, publicationToken);
        } catch (error) {
          queueLearnPublicationRetry(
            candidate.garden_id,
            "abandoned Learn job recovery",
            error,
          );
          appendLearnEvent(
            contentPath,
            candidate.garden_id,
            "learn_abandoned_job_republish_failed",
            { jobId: candidate.id, error: errorMessage(error) },
          );
        }
        if (cancellationRecovery) {
          disposeAbandonedLearnWorkspaces(candidate.garden_id, candidate.id);
        } else {
          const retainedWorkspaceRoots = retainFailedLearnWorkspacesForJob({
            gardenSlug: candidate.garden_id,
            jobId: candidate.id,
            reason: "abandoned_worker",
            failureStage: current.current_step,
            retainedAt: recoveryNow,
          });
          appendLearnEvent(
            contentPath,
            candidate.garden_id,
            "learn_failed_workspace_retained",
            {
              jobId: candidate.id,
              retainedWorkspaceCount: retainedWorkspaceRoots.length,
              failureStage: current.current_step,
            },
          );
        }
        recoveredJobIds.push(candidate.id);
      } finally {
        lease.release();
      }
    } catch (error) {
      if (!skippedJobIds.includes(candidate.id)) skippedJobIds.push(candidate.id);
      console.error(
        `[learn] Could not recover abandoned job ${candidate.id}; continuing sweep:`,
        error,
      );
      try {
        appendLearnEvent(
          contentPath,
          candidate.garden_id,
          "learn_abandoned_job_recovery_failed",
          { jobId: candidate.id, error: errorMessage(error) },
        );
      } catch {
        // A corrupt/unreadable garden must not prevent later candidates from
        // being recovered by this sweep.
      }
    }
  }

  // Publication retries run only after abandoned filesystem/database work has
  // been reconciled. Publishing first could expose an uncommitted promoted tree.
  await recoverPendingLearnPublications(contentPath);
  return { recoveredJobIds, skippedJobIds };
}

function activeStatus(status: LearnStatus): boolean {
  return [
    "planning",
    "analyzing_issues",
    "repairing",
    "revalidating",
    "publishing_repair",
    "generating_learning_pages",
    "generating_textbook",
    "generating_visuals",
    "writing_quartz",
    "building_navigation",
    // A paused job still owns a live worker and the garden lease, so every
    // guard that keeps a second run out — and the heartbeat that keeps
    // recovery from reclaiming it — must treat it as active.
    "paused",
  ].includes(status);
}

function recoverableLearnStatus(status: LearnStatus): boolean {
  return status === "idle" || activeStatus(status);
}

export function getLearnStatusSnapshot({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): LearnStatusSnapshot {
  return projectLearnStatusSnapshot({ gardenId, contentPath }) as LearnStatusSnapshot;
}
