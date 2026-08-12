import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { resolveConnectedRepository } from "@/lib/opencode/repository.ts";
import {
  agentEditPatch,
  finalizeRunSnapshot,
  isSnapshotId,
  summarizeAgentEdits,
  undoAgentEdits,
} from "@/lib/agent-edits/snapshot.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * What a coding agent changed in the Garden's repository, and how to put it
 * back. Every response is recomputed from the two snapshots, so a browser can
 * never talk this endpoint into touching a file the run did not.
 */

function repositoryFor(userId: number, gardenSlug: unknown): string {
  if (typeof gardenSlug !== "string" || !gardenSlug.trim()) {
    throw new RouteError(400, "garden_required");
  }
  return resolveConnectedRepository(userId, gardenSlug.trim()).path;
}

function snapshotRef(before: unknown, after: unknown): { before: string; after: string } {
  if (!isSnapshotId(before) || !isSnapshotId(after)) {
    throw new RouteError(400, "invalid_snapshot");
  }
  return { before, after };
}

function failure(error: unknown): NextResponse {
  if (error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  const code = error instanceof Error ? error.message : "internal_error";
  const status = ["garden_not_found", "repository_not_connected", "repository_unavailable"].includes(
    code,
  )
    ? 404
    : 500;
  return NextResponse.json({ ok: false, error: status === 404 ? code : "internal_error" }, { status });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const repositoryPath = repositoryFor(userId, params.get("gardenSlug"));
    const ref = snapshotRef(params.get("before"), params.get("after"));
    const summary = summarizeAgentEdits(repositoryPath, ref);

    const filePath = params.get("path");
    if (filePath === null) return NextResponse.json({ ok: true, ...summary });
    if (!summary.files.some((file) => file.path === filePath)) {
      throw new RouteError(404, "file_not_in_run");
    }
    return NextResponse.json({
      ok: true,
      path: filePath,
      patch: agentEditPatch(repositoryPath, ref, filePath),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const repositoryPath = repositoryFor(userId, body.gardenSlug);

    if (body.action === "finalize") {
      const runId = typeof body.runId === "string" ? body.runId.trim() : "";
      if (!runId) throw new RouteError(400, "run_required");
      const ref = finalizeRunSnapshot(runId, repositoryPath);
      // A run that started before this server did simply has no undo.
      if (!ref) return NextResponse.json({ ok: true, edits: null });
      return NextResponse.json({
        ok: true,
        edits: { ...ref, ...summarizeAgentEdits(repositoryPath, ref) },
      });
    }

    if (body.action === "undo") {
      const ref = snapshotRef(body.before, body.after);
      return NextResponse.json({ ok: true, ...undoAgentEdits(repositoryPath, ref) });
    }

    throw new RouteError(400, "unknown_action");
  } catch (error) {
    return failure(error);
  }
}
