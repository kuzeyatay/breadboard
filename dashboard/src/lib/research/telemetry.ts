// Structured events for watching a research session behave.
//
// Everything emitted here is state, never reasoning: counts, transitions, stop
// reasons, budget figures, and the strategy names that were attempted. That
// boundary is deliberate — an audit trail that carried the model's deliberation
// would be chain-of-thought in a log file, and a log file is exactly where it
// must not be.

import "server-only";

import { recordAuditEvent } from "../hermes/runtime-store.ts";
import type { BeginResult, RecordResult, StatusResult } from "./session.ts";

export interface TelemetryContext {
  runtimeSessionId: number;
  userId: number | null;
  gardenId: string | null;
  conversationId: number;
}

function emit(
  context: TelemetryContext,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  recordAuditEvent({
    eventType,
    runtimeSessionId: context.runtimeSessionId,
    userId: context.userId,
    gardenId: context.gardenId,
    payload: { conversationId: context.conversationId, ...payload },
  });
}

export function recordBeginTelemetry(
  context: TelemetryContext,
  result: BeginResult,
): void {
  emit(context, "research.session_started", {
    sessionId: result.sessionId,
    intent: result.intent,
    applies: result.applies,
    completenessRequired: result.completenessRequired,
    phase: result.phase,
    temporalScope: result.temporalScope,
    requestedFields: result.requestedFields.map((field) => field.key),
    maxSearches: result.budget.maxSearches,
    maxIterations: result.budget.maxIterations,
    maxEnumerationRounds: result.budget.maxEnumerationRounds,
    maxEntities: result.budget.maxEntities,
  });
}

export function recordIngestTelemetry(
  context: TelemetryContext,
  result: RecordResult,
): void {
  emit(context, "research.round_recorded", {
    sessionId: result.sessionId,
    phase: result.phase,
    newEntities: result.newEntities.length,
    mergedAliases: result.mergedAliases.length,
    rejectedEntities: result.rejectedEntities.length,
    entityCount: result.entityCount,
    evidenceRecorded: result.evidenceRecorded,
    exhaustedGaps: result.exhaustedGaps,
    fillRate: result.coverage.fillRate,
    highPriorityOpen: result.coverage.highPriorityOpen,
    saturated: result.saturated,
    searchesUsed: result.searchesUsed,
    searchesRemaining: result.searchesRemaining,
  });
  if (result.conflictsDetected > 0) {
    emit(context, "research.conflicts_present", {
      sessionId: result.sessionId,
      conflicts: result.conflictsDetected,
      conflictingCells: result.coverage.conflicting,
    });
  }
  if (result.nextQueries.length) {
    emit(context, "research.strategies_planned", {
      sessionId: result.sessionId,
      strategies: result.nextQueries.map((query) => query.strategy),
      fields: [...new Set(result.nextQueries.map((query) => query.field))],
    });
  }
  if (result.stop.stop) {
    emit(context, "research.stopped", {
      sessionId: result.sessionId,
      reason: result.stop.reason,
      searchesUsed: result.searchesUsed,
      fillRate: result.coverage.fillRate,
      highPriorityOpen: result.coverage.highPriorityOpen,
    });
  }
}

export function recordStatusTelemetry(
  context: TelemetryContext,
  result: StatusResult,
): void {
  emit(context, "research.status_read", {
    sessionId: result.sessionId,
    phase: result.phase,
    stopping: result.stop.stop,
    reason: result.stop.reason,
    fillRate: result.coverage.fillRate,
    verified: result.coverage.verified,
    conflicting: result.coverage.conflicting,
    highPriorityOpen: result.coverage.highPriorityOpen,
    entities: result.coverage.entities,
    searchesUsed: result.searchesUsed,
    synthesisReleased: Boolean(result.synthesis),
  });
}
