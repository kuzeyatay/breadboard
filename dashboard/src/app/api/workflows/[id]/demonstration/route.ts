// A demonstrated workflow's detail: what it learned, its version history, and
// its recent runs.
//
// This is what the Workflows detail page reads when the workflow it opened was
// taught rather than built on the canvas.

import { NextRequest, NextResponse } from "next/server";

import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { ensureTeachRecovery } from "@/lib/teach/recovery";
import * as store from "@/lib/teach/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const { id } = await context.params;

    const workflow = store.getDemonstratedWorkflow(userId, id);
    if (!workflow) throw new RouteError(404, "That workflow was not learned from a demonstration.");

    const versions = store.listProcedureVersions(id).map((version) => ({
      version: version.version,
      note: version.note,
      createdAt: version.created_at,
      demonstrationId: version.demonstration_id,
    }));

    const runs = store.listRuns(userId, id, 10).map((run) => {
      const view = store.runView(run);
      return {
        runId: view.runId,
        state: view.state,
        startedAt: view.startedAt,
        finishedAt: view.finishedAt,
        error: view.error,
        inputs: view.inputs,
      };
    });

    const demonstrations = store.listDemonstrationsForWorkflow(userId, id).map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      eventCount: row.event_count,
      transcriptAvailable: row.transcript_available === 1,
      // Says honestly whether the recording is still there. It usually is not:
      // a workflow runs from its compiled form, and the raw demonstration is
      // discarded once that exists.
      recordingRetained: row.recording_retained === 1,
      isReteach: row.reteach_workflow_id === id,
    }));

    return NextResponse.json(
      {
        id: workflow.row.id,
        name: workflow.row.name,
        description: workflow.row.description,
        version: workflow.row.procedure_version,
        updatedAt: workflow.row.updated_at,
        procedure: workflow.procedure,
        versions,
        runs,
        demonstrations,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { procedure?: unknown };

    const existing = store.getDemonstratedWorkflow(userId, id);
    if (!existing) throw new RouteError(404, "That workflow was not learned from a demonstration.");
    if (!body.procedure || typeof body.procedure !== "object") {
      throw new RouteError(400, "An edited workflow is required.");
    }

    // Editing saves a new version rather than overwriting the current one: the
    // representation that was working before an edit is the thing a user needs
    // when the edit turns out to be wrong.
    const { compileProcedure } = await import("@/lib/teach/compile");
    const { ensureApprovalBoundaries } = await import("@/lib/teach/approvals");
    const procedure = ensureApprovalBoundaries({
      ...existing.procedure,
      ...(body.procedure as Record<string, unknown>),
    } as typeof existing.procedure);

    const nextVersion = existing.row.procedure_version + 1;
    const compiled = compileProcedure(id, procedure, nextVersion);
    const version = store.saveProcedureVersion({
      userId,
      workflowId: id,
      procedure: { ...procedure, compiled },
      compiledDirectory: compiled.directory,
      demonstrationId: null,
      note: "Edited by hand.",
    });

    return NextResponse.json({ ok: true, version });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
