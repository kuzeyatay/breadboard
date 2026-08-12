import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { isSetupAction, runSetupAction, SetupError } from "@/lib/deep-tutor/setup.ts";
import { clearHome } from "@/lib/deep-tutor/home.ts";
import { resolveScope } from "@/lib/deep-tutor/materials.ts";
import { indexState, rebuildIndex } from "@/lib/deep-tutor/knowledge-base.ts";
import { invalidateEmbeddingsHealth } from "@/lib/deep-tutor/embeddings.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      const scope = resolveScope({
        userId,
        surface: gardenSlug ? "garden_chat" : "dashboard_terminal",
        clusterSlug: gardenSlug || null,
      });
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
      const { started, state } = rebuildIndex(userId, scope);
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

    if (body.action === "forget") {
      const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : "";
      const scope = resolveScope({
        userId,
        surface: gardenSlug ? "garden_chat" : "dashboard_terminal",
        clusterSlug: gardenSlug || null,
      });
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
    if (!isSetupAction(action)) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runSetupAction(action);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof SetupError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
