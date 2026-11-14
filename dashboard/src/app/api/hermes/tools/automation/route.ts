import { NextResponse } from "next/server";

import db from "@/lib/db.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { AUTOMATION_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { getScheduledChatJobStore } from "@/lib/schedules/instance.ts";
import { presentScheduledChatJob, ScheduleError } from "@/lib/schedules/store.ts";
import {
  createHook,
  deleteHook,
  getHookByIdForUser,
  HookError,
  hookAction,
  listHooksForUser,
  type HookRow,
} from "@/lib/hooks/store.ts";
import { isLifecycleHookProvider } from "@/lib/hooks/natural-language.ts";
import { buildWebhookTriggerUrl } from "@/lib/sim/triggers/webhook-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal endpoint for the Hermes `schedule_*` and `hook_*` tools, so "check
 * my inbox every morning at 9" becomes a real scheduled chat instead of
 * instructions for the user to click through the Scheduled panel.
 *
 * Same trust model as the calendar tools: the user, surface and garden come
 * from the verified session, never from arguments. Hooks are limited to chat
 * mode — the agent cannot persist a shell command that runs on every trigger,
 * and secrets (bot tokens, signing secrets) still go through the Hooks panel.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 64 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!AUTOMATION_TOOLS.includes(toolName as (typeof AUTOMATION_TOOLS)[number])) {
      throw new ApiError(400, "automation_unknown_tool", "Unknown automation tool.");
    }
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "automation_capability_denied", "Automations are not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "automation_session_scope_mismatch", "Automation session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(403, "automation_tool_not_granted", "Automations are not available on this turn.");
    }
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    // Runtime garden_id is the garden's URL slug.
    const gardenSlug = session.surface === "garden_chat" ? session.garden_id : null;
    const data = executeAutomationTool(toolName, session.user_id, gardenSlug, args);
    recordAuditEvent({
      eventType: "automation.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { tool: toolName },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "automation.tool_failed",
        runtimeSessionId,
        payload: { tool: toolName, reason: error instanceof ApiError ? error.code : "automation_tool_failed" },
      });
    }
    if (error instanceof ScheduleError || error instanceof HookError) {
      // "Invalid cron", "a chat hook needs instructions" — pass the reason
      // through so the model can correct its call instead of retrying blind.
      return NextResponse.json(
        { ok: false, error: error.message, code: "automation_invalid_request" },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function presentHook(hook: HookRow) {
  let matcher: unknown = null;
  try {
    matcher = JSON.parse(hook.provider_config || "{}").matcher ?? null;
  } catch {
    matcher = null;
  }
  return {
    id: hook.id,
    name: hook.name,
    provider: hook.provider,
    mode: hookAction(hook),
    chatInstructions: hook.chat_instructions,
    matcher,
    enabled: hook.enabled === 1,
    gardenSlug: hook.garden_slug,
    fireCount: hook.fire_count,
    lastFiredAt: hook.last_fired_at,
    // External providers fire by POSTing here; the user pastes it into that
    // service's webhook settings.
    url: isLifecycleHookProvider(hook.provider) ? null : buildWebhookTriggerUrl(hook.id),
  };
}

function executeAutomationTool(
  tool: string,
  userId: number,
  gardenSlug: string | null,
  args: Record<string, unknown>,
): unknown {
  const schedules = getScheduledChatJobStore();
  switch (tool) {
    case "schedule_list":
      return { schedules: schedules.list(userId).map((row) => presentScheduledChatJob(row)) };
    case "schedule_create": {
      const runAt = text(args.runAt) || null;
      const created = schedules.create(userId, {
        prompt: text(args.prompt),
        // A one-shot still needs a syntactically valid cron; runAt decides when.
        cron: text(args.cron) || (runAt ? "0 0 * * *" : ""),
        oneShot: runAt !== null,
        runAt,
        surface: gardenSlug ? "garden_chat" : "dashboard_terminal",
        gardenSlug,
        model: text(args.model) || undefined,
        enabled: true,
      });
      return { schedule: presentScheduledChatJob(created) };
    }
    case "schedule_delete": {
      const id = Number(args.id);
      if (!Number.isInteger(id) || !schedules.delete(userId, id)) {
        throw new ScheduleError(404, "This schedule no longer exists.");
      }
      return { deleted: true, id };
    }
    case "hook_list":
      return { hooks: listHooksForUser(userId, db, { gardenSlug }).map(presentHook) };
    case "hook_create": {
      const matcher = text(args.matcher);
      const hook = createHook(
        userId,
        {
          name: text(args.name),
          provider: text(args.provider),
          mode: "chat",
          chatInstructions: text(args.instructions),
          providerConfig: matcher ? { matcher } : {},
          enabled: true,
          gardenSlug,
        },
        db,
      );
      return { hook: presentHook(hook) };
    }
    case "hook_delete": {
      const id = text(args.id);
      const existing = getHookByIdForUser(id, userId, db);
      if (!existing) throw new HookError(404, "Hook not found.");
      if (existing.provider === "telegram") {
        // Deleting it must also unregister the bot's webhook; the panel does that.
        throw new HookError(409, "Telegram hooks are removed from the Hooks panel.");
      }
      deleteHook(id, userId, db);
      return { deleted: true, id };
    }
    default:
      throw new ApiError(400, "automation_unknown_tool", `Unhandled tool ${tool}.`);
  }
}
