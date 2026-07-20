import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { createSessionForSurface } from "@/lib/openharness/session-service.ts";
import {
  listRuntimeSessionsForUser,
  listRuntimeMessages,
  presentRuntimeMessage,
  runtimeSessionTitle,
} from "@/lib/openharness/runtime-store.ts";
import { OPENHARNESS_SURFACES, type OpenHarnessSurface } from "@/lib/openharness/config.ts";
import { getActiveRuntimeRun } from "@/lib/openharness/run-store.ts";

export const dynamic = "force-dynamic";

function parseSurface(value: unknown): OpenHarnessSurface {
  if (typeof value === "string" && (OPENHARNESS_SURFACES as readonly string[]).includes(value)) {
    return value as OpenHarnessSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

// GET: list this user's runtime sessions for a surface, with their persisted
// transcripts, so the UI can restore history after a refresh.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const surface = parseSurface(new URL(request.url).searchParams.get("surface"));
    const sessions = listRuntimeSessionsForUser(surface, userId).map((row) => {
      const activeRun = getActiveRuntimeRun(row.id);
      return {
        id: row.id,
        title: runtimeSessionTitle(row),
        gardenId: row.garden_id,
        pageSlug: row.page_slug,
        status: row.last_runtime_status,
        activeDirectory: row.active_directory,
        filesystemMode: row.filesystem_mode,
        capabilityMode: row.capability_mode ?? "knowledge",
        updatedAt: row.updated_at,
        activeRun: activeRun
          ? { id: activeRun.id, instruction: activeRun.instruction }
          : null,
        messages: listRuntimeMessages(row.id).map(presentRuntimeMessage),
      };
    });
    return NextResponse.json({ sessions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// POST: create a new runtime session for a surface (terminal by default).
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const surface = parseSurface(body.surface ?? "dashboard_terminal");
    const title = typeof body.title === "string" ? body.title.slice(0, 120) : undefined;
    const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug : undefined;
    const pageSlug = typeof body.pageSlug === "string" ? body.pageSlug : undefined;

    const session = await createSessionForSurface({
      userId,
      surface,
      title,
      gardenSlug,
      pageSlug,
    });

    return NextResponse.json({
      session: {
        id: session.row.id,
        surface: session.row.surface,
        agentName: session.agentName,
        gardenId: session.row.garden_id,
        pageSlug: session.row.page_slug,
        activeDirectory: session.activeDirectory,
        filesystemMode: session.filesystemMode,
        capabilityMode: "knowledge",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
