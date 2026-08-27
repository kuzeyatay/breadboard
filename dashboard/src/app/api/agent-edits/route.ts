import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { resolveConnectedRepository } from "@/lib/opencode/repository.ts";
import {
  agentEditsFromRunEvents,
  isSnapshotId,
  runAgentEditsOperation,
  streamAgentEditsArtifact,
} from "@/lib/agent-edits/runtime-client.ts";
import { readOuterAgentRunView } from "@/lib/runtime-v2/outer-agent-run.ts";
import { RuntimeJobControlError } from "@/lib/supervisor-control.ts";

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
  if (error instanceof RuntimeJobControlError) {
    return NextResponse.json(
      { ok: false, error: error.code, message: error.message },
      { status: error.status },
    );
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
    const filePath = params.get("path");
    const artifact = await runAgentEditsOperation({
      userId,
      operation: filePath === null ? "summary" : "patch",
      repositoryPath,
      ref,
      ...(filePath === null ? {} : { filePath }),
      signal: request.signal,
    });
    return streamAgentEditsArtifact(artifact);
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
      const agentKind =
        body.agentKind === "codex" ||
        body.agentKind === "opencode" ||
        body.agentKind === "ruflo"
          ? body.agentKind
          : null;
      if (!agentKind) throw new RouteError(400, "agent_kind_required");
      let view;
      try {
        view = await readOuterAgentRunView(agentKind, userId, runId, 0);
      } catch (error) {
        // A card saved by a pre-Runtime build has no durable job correlation
        // and therefore preserves its historical no-undo degradation.
        if (error instanceof Error && error.message === "run_not_found") {
          return NextResponse.json({ ok: true, edits: null });
        }
        throw error;
      }
      const ref = view.terminal ? agentEditsFromRunEvents(view.events) : null;
      if (!ref) return NextResponse.json({ ok: true, edits: null });
      const artifact = await runAgentEditsOperation({
        userId,
        operation: "finalize",
        repositoryPath,
        ref,
        signal: request.signal,
      });
      return streamAgentEditsArtifact(artifact);
    }

    if (body.action === "undo") {
      const ref = snapshotRef(body.before, body.after);
      const artifact = await runAgentEditsOperation({
        userId,
        operation: "undo",
        repositoryPath,
        ref,
        signal: request.signal,
      });
      return streamAgentEditsArtifact(artifact);
    }

    throw new RouteError(400, "unknown_action");
  } catch (error) {
    return failure(error);
  }
}
