// The produced-file sweep as the chat streams call it. Kept apart from the
// sweep itself because this half reaches into the session, the capability
// decision and the grant store — the parts of the server the tests for the
// sweep have no reason to load.

import { externalRuntimePath as path } from "../external-runtime-path.ts";
import db from "../db.ts";
import { listFilesystemGrants } from "./filesystem-grant-store.ts";
import {
  normalizedProducedPathKey,
  publishProducedFilesForRun,
  type ProducedFilesReport,
} from "./produced-artifacts.ts";
import { getRuntimeRun } from "./run-store.ts";
import { getActiveCapabilityDecision, recordAuditEvent } from "./runtime-store.ts";
import type { AuthorizedRuntimeSession } from "./session-service.ts";

/**
 * The roots this session's turn could have written to: every root its
 * capability decision authorized, minus grants the user gave as read-only. A
 * read-only grant on Documents is how the user let the agent *look*; a file
 * they saved there themselves during the turn is not the agent's product.
 */
export function writableAuthorizedRoots(
  runtimeSessionId: number,
  userId: number,
): string[] {
  const decision = getActiveCapabilityDecision(runtimeSessionId);
  if (!decision) return [];
  const grants = listFilesystemGrants(userId);
  return decision.authorizedRoots.filter((root) => {
    const grant = grants.find(
      (item) => normalizedProducedPathKey(path.resolve(item.canonicalPath)) === normalizedProducedPathKey(path.resolve(root)),
    );
    return !grant || grant.permissions.create || grant.permissions.modify;
  });
}

/**
 * The sweep as the two chat streams call it, at the moment Hermes reports
 * idle: before the stream closes, so the new cards ride the same event
 * stream as the answer, and before the capability decision is revoked, so
 * the roots it names are still the ones this turn ran under. Never throws;
 * the answer is already persisted and nothing here may take it back.
 */
export async function publishProducedFilesForTurn(input: {
  session: AuthorizedRuntimeSession;
  runId: string;
  clientMessageId?: string | null;
}): Promise<ProducedFilesReport | null> {
  const { session } = input;
  const row = session.row;
  if (
    row.user_id === null ||
    row.conversation_id === null ||
    (row.surface !== "dashboard_terminal" && row.surface !== "garden_chat")
  ) {
    return null;
  }
  const run = getRuntimeRun(input.runId);
  if (!run) return null;
  try {
    const assistantMessage = input.clientMessageId
      ? (db
          .prepare(
            `SELECT id FROM conversation_messages
             WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
          )
          .get(row.conversation_id, input.clientMessageId) as { id: number } | undefined)
      : undefined;
    const report = await publishProducedFilesForRun({
      userId: row.user_id,
      runtimeSessionId: row.id,
      hermesSessionId: session.hermesSessionId,
      conversationId: row.conversation_id,
      clusterId: row.cluster_id,
      surface: row.surface,
      runId: run.id,
      startedAt: run.started_at,
      assistantMessageId: assistantMessage?.id ?? null,
      workspaceRoot: session.activeDirectory,
      authorizedRoots: writableAuthorizedRoots(row.id, row.user_id),
    });
    if (report.imported.length > 0 || report.skipped.length > 0) {
      recordAuditEvent({
        eventType: "artifact.produced_files_published",
        runtimeSessionId: row.id,
        userId: row.user_id,
        gardenId: row.garden_id,
        payload: {
          runId: run.id,
          imported: report.imported.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            filename: artifact.filename,
          })),
          skipped: report.skipped.slice(0, 50),
        },
      });
    }
    return report;
  } catch (error) {
    recordAuditEvent({
      eventType: "artifact.produced_files_failed",
      runtimeSessionId: row.id,
      userId: row.user_id,
      gardenId: row.garden_id,
      payload: {
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
}
