import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { resolveConnectedRepository } from "@/lib/opencode/repository.ts";
import {
  graftEnabledForGarden,
  prepareGraftIndex,
} from "@/lib/code-index/garden.ts";
import { startRun } from "@/lib/ruflo/run-manager.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { rufloDefaults } from "@/lib/agent-settings/defaults.ts";
import { resolveCommandMessage } from "@/lib/hermes/commands.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";
import { normalizeChatMessageAttachments } from "@/lib/chat-attachments.ts";
import {
  contextConversationFromBody,
  withConversationContext,
} from "@/lib/conversations/agent-context.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    // Four 10 MiB images expand by roughly one third when encoded as data URLs.
    if (text.length > 64 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const gardenSlug =
      typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : null;
    if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
      return NextResponse.json(
        { ok: false, error: "invalid_attachments" },
        { status: 400 },
      );
    }
    const attachments = normalizeChatMessageAttachments(body.attachments)
      .filter((attachment) => attachment.type === "image")
      .slice(0, 4);
    if (!task) {
      return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    }

    const repository = resolveConnectedRepository(userId, gardenSlug);
    const resolved = await resolveCommandMessage(userId, task, repository.path, {
      mode: "scoped_implementation",
      surface: gardenSlug ? "garden_chat" : "dashboard_terminal",
      requestedOutcome: task,
      executionTarget: "ruflo",
    });
    const selectedSkill = resolved.invocations.find(
      (invocation) => invocation.kind === "skill",
    );
    // The swarm's shape comes from the user's settings unless this request
    // states it. Before the settings page existed nothing sent these at all, so
    // every swarm ran at the hardcoded six strategic workers.
    const swarm = rufloDefaults(agentSettingsFor(userId, "ruflo"));
    const requestId =
      typeof body.clientMessageId === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.clientMessageId.trim())
        ? body.clientMessageId.trim()
        : undefined;
    const graftEnabled = graftEnabledForGarden(userId, repository.gardenSlug);
    if (graftEnabled) {
      await prepareGraftIndex(userId, repository.path);
    }
    const run = await startRun({
      userId,
      requestId,
      objective: task,
      // The chat this was typed into, so an objective that refers back to it
      // resolves instead of reaching the swarm as a bare fragment.
      instruction: withConversationContext(
        resolved.text,
        contextConversationFromBody(userId, body),
        { clientMessageId: typeof body.clientMessageId === "string" ? body.clientMessageId : undefined },
      ),
      skill: selectedSkill
        ? {
            id: selectedSkill.id,
            slug: selectedSkill.slug,
            contentHash: selectedSkill.contentHash,
          }
        : undefined,
      workers: body.workers ?? swarm.workers,
      queenType: body.queenType ?? swarm.queenType,
      consensus: body.consensus ?? swarm.consensus,
      topology: body.topology ?? swarm.topology,
      repositoryPath: repository.path,
      repositoryName: repository.name,
      gardenSlug: repository.gardenSlug,
      attachments,
      graftEnabled,
    });
    return NextResponse.json(
      {
        ok: true,
        run: {
          ...run,
          gardenSlug: repository.gardenSlug,
          repository: repository.name,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof ApiError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    const code = error instanceof Error ? error.message : "runtime_error";
    const status = [
      "garden_not_found",
      "repository_not_connected",
      "repository_unavailable",
      "garden_required",
      "invalid_image_attachment",
      "image_attachment_too_large",
    ].includes(code)
      ? 400
      : 502;
    return NextResponse.json({ ok: false, error: code }, { status });
  }
}
