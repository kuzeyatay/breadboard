import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import {
  createConversation,
  listConversationsForUser,
  presentConversation,
  summarizeConversationMessages,
} from "@/lib/conversations/store.ts";
import {
  authorizeGardenAccess,
  resolveConversationRuntime,
} from "@/lib/hermes/session-service.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import { presentHermesSessionSummary } from "@/lib/hermes/session-presentation.ts";

export const dynamic = "force-dynamic";

function parseSurface(value: unknown): HermesSurface {
  if (typeof value === "string" && (HERMES_SURFACES as readonly string[]).includes(value)) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

// Conversations are bound to the server-created surface. This prevents a
// browser from relabelling a Garden/Quartz conversation as a Terminal session.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const surface = parseSurface(new URL(request.url).searchParams.get("surface"));
    const conversations = listConversationsForUser(userId)
      .filter((conversation) => conversation.surface === surface);
    const messageSummaries = summarizeConversationMessages(
      conversations.map((conversation) => conversation.id),
    );
    const sessions = conversations.map((conversation) =>
      presentHermesSessionSummary(
        conversation,
        messageSummaries.get(conversation.id),
      ),
    );
    return NextResponse.json({ sessions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// New chats are durable before an Hermes runtime is needed. The returned
// id is opaque and stable, but deliberately scoped to its creation surface.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const surface = parseSurface(body.surface ?? "dashboard_terminal");
    const title = typeof body.title === "string" ? body.title.slice(0, 200) : undefined;
    const gardenSlug = typeof body.gardenSlug === "string" && body.gardenSlug.trim()
      ? body.gardenSlug.trim()
      : undefined;
    const garden = gardenSlug ? authorizeGardenAccess(userId, gardenSlug) : null;
    const conversation = createConversation({
      userId,
      title,
      surface,
      scopeKind: surface === "quartz_ai" && garden
        ? "page"
        : garden
          ? "garden"
          : "global",
      defaultGardenId: garden?.clusterId ?? null,
    });
    const runtime = await resolveConversationRuntime({
      conversation,
      surface,
      activeGardenSlug: garden?.slug ?? null,
      activePageSlug: typeof body.pageSlug === "string" ? body.pageSlug.slice(0, 500) : null,
    });
    return NextResponse.json({
      session: {
        ...presentConversation(conversation),
        surface,
        agentName: "breadboard-assistant",
        gardenId: garden?.slug ?? null,
        pageSlug: typeof body.pageSlug === "string" ? body.pageSlug.slice(0, 500) : null,
        activeDirectory: runtime.activeDirectory,
        filesystemMode: "restricted",
        capabilityMode: "knowledge",
        messages: [],
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
