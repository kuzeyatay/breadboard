import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { inboxZeroDefaults } from "@/lib/agent-settings/defaults.ts";
import { startRun } from "@/lib/inbox-zero/runtime-run-manager.ts";
import {
  contextConversationFromBody,
  conversationContextFromBody,
} from "@/lib/conversations/agent-context.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    if (task.length > 20_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // The instruction reaches Inbox Zero's own assistant verbatim, so a stacked
    // `/skill` token would arrive as prose in the middle of it. Refuse the
    // combination in the same words every other surface uses.
    const conflict = findCapabilityConflict({
      text: task,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: "inbox-zero",
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    const stored = inboxZeroDefaults(agentSettingsFor(userId, "inbox-zero"));
    const { baseURL } = resolveChatmockBaseUrl(request);
    const conversation = contextConversationFromBody(userId, body);
    const run = await startRun({
      userId,
      task,
      allowActions:
        typeof body.allowActions === "boolean" ? body.allowActions : stored.allowActions,
      // Follow-ups in one chat continue one Inbox Zero conversation, so "archive
      // those too" still knows which ones.
      conversationKey:
        typeof body.chatSessionId === "number"
          ? `session:${body.chatSessionId}`
          : conversation
            ? `conversation:${conversation.public_id}`
            : `user:${userId}`,
      preferredEmail:
        (typeof body.mailbox === "string" ? body.mailbox.trim() : "") || stored.mailbox || undefined,
      chatmockBaseUrl: baseURL,
      model,
      ...(conversation ? { conversationPublicId: conversation.public_id } : {}),
      // The chat this was launched from, so a request that refers back to
      // it resolves instead of arriving as a bare fragment.
      conversationContext: conversationContextFromBody(userId, body),
    });
    return NextResponse.json({ ok: true, run }, { status: 201 });
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
