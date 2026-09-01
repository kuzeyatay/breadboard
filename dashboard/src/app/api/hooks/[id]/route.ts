import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth.ts";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import db from "@/lib/db.ts";
import {
  deleteHook,
  CHAT_COMPLETED_PROVIDER,
  getHookByIdForUser,
  HookError,
  updateHook,
  type HookRow,
} from "@/lib/hooks/store.ts";
import { deleteTelegramSubscription } from "@/lib/sim/triggers/providers/telegram";
import { buildWebhookTriggerUrl } from "@/lib/sim/triggers/webhook-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function presentHook(hook: HookRow) {
  let providerConfig: Record<string, unknown> = {};
  try {
    providerConfig = JSON.parse(hook.provider_config || "{}");
  } catch {
    providerConfig = {};
  }
  const redacted = Object.fromEntries(
    Object.entries(providerConfig).filter(([key]) => !/token|secret|key/i.test(key)),
  );
  return {
    id: hook.id,
    name: hook.name,
    provider: hook.provider,
    mode: hook.mode,
    workflowId: hook.workflow_id,
    chatInstructions: hook.chat_instructions,
    providerConfig: redacted,
    enabled: hook.enabled === 1,
    gardenSlug: hook.garden_slug ?? null,
    createdAt: hook.created_at,
    lastFiredAt: hook.last_fired_at,
    fireCount: hook.fire_count,
    url:
      hook.provider === CHAT_COMPLETED_PROVIDER
        ? null
        : buildWebhookTriggerUrl(hook.id),
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await readJsonBody(request);

    const patch: Parameters<typeof updateHook>[2] = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.chatInstructions === "string" || body.chatInstructions === null) {
      patch.chatInstructions = body.chatInstructions;
    }
    if (typeof body.workflowId === "string" || body.workflowId === null) {
      patch.workflowId = body.workflowId;
    }
    if (body.providerConfig && typeof body.providerConfig === "object") {
      // Merge, not replace: the create response redacts secrets, so a PATCH
      // built from that response would otherwise wipe out a stored token the
      // caller never actually saw.
      const existing = getHookByIdForUser(id, userId, db);
      if (!existing) throw new HookError(404, "Hook not found.");
      let existingConfig: Record<string, unknown> = {};
      try {
        existingConfig = JSON.parse(existing.provider_config || "{}");
      } catch {
        existingConfig = {};
      }
      patch.providerConfig = { ...existingConfig, ...(body.providerConfig as Record<string, unknown>) };
    }

    const hook = updateHook(id, userId, patch, db);
    return NextResponse.json({ hook: presentHook(hook) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const existing = getHookByIdForUser(id, userId, db);
    if (!existing) throw new HookError(404, "Hook not found.");

    if (existing.provider === "telegram") {
      let providerConfig: Record<string, unknown> = {};
      try {
        providerConfig = JSON.parse(existing.provider_config || "{}");
      } catch {
        providerConfig = {};
      }
      const botToken = providerConfig.botToken as string | undefined;
      if (botToken) {
        await deleteTelegramSubscription(botToken);
      }
    }

    deleteHook(id, userId, db);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
