import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import {
  createConversation,
  listConversationMessages,
  listConversationsForUser,
  presentConversation,
  presentConversationMessage,
} from "@/lib/conversations/store.ts";
import {
  authorizeGardenAccess,
  resolveConversationRuntime,
} from "@/lib/openharness/session-service.ts";
import { getRuntimeSessionByConversation } from "@/lib/openharness/runtime-store.ts";
import { OPENHARNESS_SURFACES, type OpenHarnessSurface } from "@/lib/openharness/config.ts";
import { getActiveRuntimeRun } from "@/lib/openharness/run-store.ts";

export const dynamic = "force-dynamic";

function parseSurface(value: unknown): OpenHarnessSurface {
  if (typeof value === "string" && (OPENHARNESS_SURFACES as readonly string[]).includes(value)) {
    return value as OpenHarnessSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

// All authenticated surfaces list the same canonical conversations. `surface`
// is retained as UI context only; it is not a persistence partition.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    parseSurface(new URL(request.url).searchParams.get("surface"));
    const sessions = listConversationsForUser(userId).map((conversation) => {
      const runtime = getRuntimeSessionByConversation(conversation.id);
      const activeRun = runtime ? getActiveRuntimeRun(runtime.id) : null;
      return {
        ...presentConversation(conversation),
        surface: runtime?.surface ?? null,
        gardenId: runtime?.garden_id ?? null,
        pageSlug: runtime?.page_slug ?? null,
        status: runtime?.last_runtime_status ?? "idle",
        activeDirectory: runtime?.active_directory ?? null,
        filesystemMode: runtime?.filesystem_mode ?? "restricted",
        capabilityMode: runtime?.capability_mode ?? "knowledge",
        activeRun: activeRun ? { id: activeRun.id, instruction: activeRun.instruction } : null,
        messages: listConversationMessages(conversation.id).map((message) => {
          const presented = presentConversationMessage(message);
          const calls = Array.isArray(presented.metadata.toolCalls)
            ? presented.metadata.toolCalls as Array<Record<string, unknown>>
            : [];
          return {
            ...presented,
            tools: calls.map((call, index) => ({
              toolCallId: String(call.toolCallId ?? `tool-${index}`),
              toolName: String(call.toolName ?? "tool"),
              summary: typeof call.summary === "string" ? call.summary : undefined,
              status: call.success === false ? "failed" : "completed",
            })),
            verification: presented.metadata.verification,
            proposal: presented.metadata.proposal,
            interrupted: presented.status === "aborted",
          };
        }),
      };
    });
    return NextResponse.json({ sessions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// New chats are durable before an OpenHarness runtime is needed. The returned
// id is opaque and remains stable across Terminal, Garden Chat, and Quartz.
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
