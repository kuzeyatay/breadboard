import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { createSessionForSurface } from "@/lib/openharness/session-service.ts";
import { listRuntimeSessionsForUser, listRuntimeMessages } from "@/lib/openharness/runtime-store.ts";
import { OPENHARNESS_SURFACES, type OpenHarnessSurface } from "@/lib/openharness/config.ts";

export const dynamic = "force-dynamic";

function parseSurface(value: unknown): OpenHarnessSurface {
  if (typeof value === "string" && (OPENHARNESS_SURFACES as readonly string[]).includes(value)) {
    return value as OpenHarnessSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

function parseMessages(row: { sources: string | null; token_usage: string | null; content: string; role: string }) {
  return {
    role: row.role,
    content: row.content,
    sources: row.sources ? (JSON.parse(row.sources) as string[]) : [],
    usage: row.token_usage ? JSON.parse(row.token_usage) : undefined,
  };
}

// GET: list this user's runtime sessions for a surface, with their persisted
// transcripts, so the UI can restore history after a refresh.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const surface = parseSurface(new URL(request.url).searchParams.get("surface"));
    const sessions = listRuntimeSessionsForUser(surface, userId).map((row) => ({
      id: row.id,
      title: (() => {
        try {
          return row.runtime_metadata ? (JSON.parse(row.runtime_metadata).title ?? "New chat") : "New chat";
        } catch {
          return "New chat";
        }
      })(),
      gardenId: row.garden_id,
      pageSlug: row.page_slug,
      status: row.last_runtime_status,
      updatedAt: row.updated_at,
      messages: listRuntimeMessages(row.id).map(parseMessages),
    }));
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
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
