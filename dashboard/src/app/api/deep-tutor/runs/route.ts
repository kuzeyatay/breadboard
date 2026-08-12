import { NextResponse } from "next/server";
import db from "@/lib/db.ts";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { parseTutorRequest } from "@/lib/deep-tutor/identity.ts";
import { startRun } from "@/lib/deep-tutor/run-manager.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { deepTutorDefaults } from "@/lib/agent-settings/defaults.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

interface ClusterRow {
  slug: string;
  name: string;
  user_id: number;
}

/**
 * The Garden a tutoring turn is scoped to, or a refusal.
 *
 * Ownership is checked here rather than trusted from the client because the
 * slug decides which directory the tutor may read. A shared or public Garden
 * someone else owns is deliberately not tutorable: reading every file in it is
 * a stronger thing than viewing its pages.
 */
function requireOwnGarden(userId: number, slug: string): ClusterRow {
  const row = db
    .prepare("SELECT slug, name, user_id FROM clusters WHERE slug = ?")
    .get(slug) as ClusterRow | undefined;
  if (!row) throw new RouteError(404, "garden_not_found");
  if (row.user_id !== userId) throw new RouteError(403, "garden_not_yours");
  return row;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : "";
    const requestedEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim().toLowerCase() : "";
    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    if (task.length > 16_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";

    // Stored preferences fill in what the message left unsaid; a flag typed in
    // the message still wins, which parseTutorRequest enforces.
    const tutorRequest = parseTutorRequest(
      task,
      deepTutorDefaults(agentSettingsFor(userId, "deep-tutor")),
    );
    if (!tutorRequest.message) {
      return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    }

    const garden = gardenSlug ? requireOwnGarden(userId, gardenSlug) : null;
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      request: tutorRequest,
      scope: {
        userId,
        surface: garden ? "garden_chat" : "dashboard_terminal",
        clusterSlug: garden?.slug ?? null,
        gardenName: garden?.name ?? null,
      },
      model,
      reasoningEffort,
      baseUrl: baseURL,
    });
    return NextResponse.json({ ok: true, run, request: tutorRequest }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime_error" },
      { status: 502 },
    );
  }
}
