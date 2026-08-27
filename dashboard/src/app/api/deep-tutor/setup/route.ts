import { NextResponse } from "next/server";
import db from "@/lib/db.ts";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { clearHome } from "@/lib/deep-tutor/home.ts";
import { resolveScope } from "@/lib/deep-tutor/materials.ts";
import { indexState } from "@/lib/deep-tutor/knowledge-base.ts";
import { invalidateEmbeddingsHealth } from "@/lib/deep-tutor/embeddings.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import {
  cancelDeepTutorIndex,
  rebuildDeepTutorIndex,
} from "@/lib/runtime-v2/deep-tutor-maintenance-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ClusterRow {
  slug: string;
  name: string;
  user_id: number;
}

function requireOwnGarden(userId: number, slug: string): ClusterRow {
  const row = db
    .prepare("SELECT slug, name, user_id FROM clusters WHERE slug = ?")
    .get(slug) as ClusterRow | undefined;
  if (!row) throw new RouteError(404, "garden_not_found");
  if (row.user_id !== userId) throw new RouteError(403, "garden_not_yours");
  return row;
}

function scopedGarden(userId: number, gardenSlug: string) {
  const garden = gardenSlug ? requireOwnGarden(userId, gardenSlug) : null;
  return resolveScope({
    userId,
    surface: garden ? "garden_chat" : "dashboard_terminal",
    clusterSlug: garden?.slug ?? null,
    gardenName: garden?.name ?? null,
  });
}

/**
 * Two kinds of setup step, both of which only the user can authorise: building
 * the clone's Python environment, and forgetting what the tutor has learned
 * about them in one scope.
 *
 * Forgetting is scoped rather than global on purpose — a learner who wants the
 * Signals tutor to start over rarely wants the Terminal one wiped too, and the
 * homes are already separate for exactly that reason.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (body.action === "reindex") {
      const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : "";
      const scope = scopedGarden(userId, gardenSlug);
      // The embedder may have been installed since the last probe; a rebuild
      // is exactly the moment to stop trusting a cached "unavailable".
      invalidateEmbeddingsHealth();
      const before = indexState(userId, scope);
      if (before.phase === "unsupported") {
        return NextResponse.json({
          ok: true,
          result: {
            ok: false,
            message: "Only a Garden is indexed. The Terminal reads files directly.",
            detail: "",
          },
        });
      }
      const { started, state } = await rebuildDeepTutorIndex(userId, scope, {
        signal: request.signal,
      });
      return NextResponse.json({
        ok: true,
        result: {
          ok: started,
          message: started
            ? `Indexing ${state.candidateCount} file${state.candidateCount === 1 ? "" : "s"} from ${scope.label}. You can keep asking questions while it runs.`
            : state.phase === "building"
              ? "An index is already being built for this Garden."
              : "There is nothing to index in this Garden yet.",
          detail: state.error ?? "",
        },
        index: state,
      });
    }

    if (body.action === "cancel-reindex") {
      const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : "";
      const scope = scopedGarden(userId, gardenSlug);
      const state = await cancelDeepTutorIndex(userId, scope);
      return NextResponse.json({
        ok: true,
        result: {
          ok: true,
          message: "Deep Tutor indexing was cancelled.",
          detail: state.error ?? "",
        },
        index: state,
      });
    }

    if (body.action === "forget") {
      const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : "";
      const scope = scopedGarden(userId, gardenSlug);
      // Do not race a Runtime-owned writer against deletion of its home.
      await cancelDeepTutorIndex(userId, scope);
      const removed = clearHome(userId, scope.id);
      return NextResponse.json({
        ok: true,
        result: {
          ok: true,
          message: removed
            ? `Deep Tutor has forgotten everything it knew about ${scope.label}.`
            : `Deep Tutor had nothing remembered about ${scope.label}.`,
          detail: "",
        },
      });
    }

    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (!["install", "reinstall", "remove"].includes(action)) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "deep-tutor",
      action,
      signal: request.signal,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof ManagedSetupExecutionError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
